import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { ListOrdersDto } from './dto/list-orders.dto';
import { ExportOrdersDto } from './dto/export-orders.dto';
import { amountDecimal, eurNumber, toDecimal, toNumber } from '../common/format.util';
import { formatRomeDate, formatRomeDateTime, romeLocalToUtc } from '../common/time.util';
import { orderStatusLabelIt, payStatusLabelIt } from '../common/labels.util';
import type { JwtPayload } from '../auth/auth.service';

/** Limite di sicurezza per l'export Excel degli ordini. */
const MAX_EXPORT_ROWS = 5000;

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(dto: ListOrdersDto, user: JwtPayload) {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;
    const where = this.buildWhere(dto, user);

    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: [{ erpCreateDate: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          _count: { select: { items: true } },
          shipments: { select: { id: true, status: true, erpShipsSn: true, shippedAt: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return { rows, total, page, pageSize };
  }

  /** Ultimo ordine visibile all'utente, usato dal frontend per gli avvisi vocali. */
  async latestNotification(user: JwtPayload) {
    const where = this.buildWhere({} as ListOrdersDto, user);
    const order = await this.prisma.order.findFirst({
      where,
      orderBy: { id: 'desc' },
      select: { id: true, syncedAt: true },
    });

    return {
      latestOrderId: order?.id ?? null,
      latestOrderAt: order?.syncedAt?.toISOString() ?? null,
    };
  }

  private buildWhere(dto: ListOrdersDto, user: JwtPayload): Prisma.OrderWhereInput {
    const where: Prisma.OrderWhereInput = {};

    // 供应商角色只能看自己的单（文档 §一）
    if (user.role === 'supplier') {
      if (!user.supplierId) return { id: -1 };
      where.supplierId = user.supplierId;
    } else if (dto.supplierId) {
      where.supplierId = dto.supplierId;
    }

    if (dto.status) where.status = dto.status;
    if (dto.payStatus) where.payStatus = dto.payStatus;
    // Filtro per stato della spedizione locale (collegamenti dalla Panoramica)
    if (dto.shipmentState === 'failed') where.shipments = { some: { status: 'failed' } };
    if (dto.shipmentState === 'awaiting') where.shipments = { some: { status: 'receivedin' } };
    if (dto.shipmentState === 'sent') where.shipments = { some: { erpShipsSn: { not: null } } };
    if (dto.keyword?.trim()) {
      const keyword = dto.keyword.trim();
      where.OR = [
        { erpOrdersNum: { contains: keyword, mode: 'insensitive' } },
        { clientName: { contains: keyword, mode: 'insensitive' } },
        { consignee: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    const from = dto.dateFrom ? romeLocalToUtc(dto.dateFrom, false) : null;
    const to = dto.dateTo ? romeLocalToUtc(dto.dateTo, true) : null;
    if (from || to) {
      where.erpCreateDate = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }
    return where;
  }

  async detail(id: number, user: JwtPayload) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        supplier: true,
        items: { orderBy: { id: 'asc' } },
        shipments: { orderBy: { id: 'desc' }, include: { items: true, operator: true } },
      },
    });
    if (!order) throw new NotFoundException('Ordine non trovato');
    if (user.role === 'supplier' && order.supplierId !== user.supplierId) {
      throw new ForbiddenException('Ordine non appartenente al fornitore');
    }
    return { ...order, items: await this.itemsWithImages(order.items) };
  }

  /** Allega l'immagine articolo alle righe: match su (erpGoodsId, erpOptionsId). */
  private async itemsWithImages<T extends { erpGoodsId: string | null; erpOptionsId: string | null }>(
    items: T[],
  ): Promise<(T & { imageUrl: string | null })[]> {
    if (!items.length) return [];
    const products = await this.prisma.product.findMany({
      where: {
        OR: items.map((item) => ({ erpGoodsId: item.erpGoodsId ?? '', erpOptionsId: item.erpOptionsId ?? '' })),
      },
      select: { erpGoodsId: true, erpOptionsId: true, imageUrl: true },
    });
    const key = (goodsId?: string | null, optionsId?: string | null) => `${goodsId ?? ''}|${optionsId ?? ''}`;
    const images = new Map(products.map((p) => [key(p.erpGoodsId, p.erpOptionsId), p.imageUrl]));
    return items.map((item) => ({
      ...item,
      imageUrl: images.get(key(item.erpGoodsId, item.erpOptionsId)) ?? null,
    }));
  }

  /**
   * Ordine precedente / successivo nella stessa lista (stesso ordinamento della tabella:
   * erpCreateDate DESC, id DESC). Lo scope del fornitore e' sempre rispettato.
   */
  async neighbors(id: number, user: JwtPayload) {
    const current = await this.prisma.order.findUnique({
      where: { id },
      select: { id: true, erpCreateDate: true, supplierId: true },
    });
    if (!current) throw new NotFoundException('Ordine non trovato');
    if (user.role === 'supplier' && current.supplierId !== user.supplierId) {
      throw new ForbiddenException('Ordine non appartenente al fornitore');
    }

    const scope: Prisma.OrderWhereInput = user.role === 'supplier' ? { supplierId: user.supplierId ?? -1 } : {};
    const select = { id: true, erpOrdersNum: true } as const;

    // Ordini senza data (dato ERP mancante): fallback sull'id, cosi' la navigazione resta coerente.
    if (!current.erpCreateDate) {
      const [prev, next] = await Promise.all([
        this.prisma.order.findFirst({
          where: { ...scope, id: { gt: current.id } },
          orderBy: { id: 'asc' },
          select,
        }),
        this.prisma.order.findFirst({
          where: { ...scope, id: { lt: current.id } },
          orderBy: { id: 'desc' },
          select,
        }),
      ]);
      return { prev, next };
    }

    const [prev, next] = await Promise.all([
      this.prisma.order.findFirst({
        where: {
          ...scope,
          OR: [
            { erpCreateDate: { gt: current.erpCreateDate } },
            { erpCreateDate: current.erpCreateDate, id: { gt: current.id } },
          ],
        },
        orderBy: [{ erpCreateDate: 'asc' }, { id: 'asc' }],
        select,
      }),
      this.prisma.order.findFirst({
        where: {
          ...scope,
          OR: [
            { erpCreateDate: { lt: current.erpCreateDate } },
            { erpCreateDate: current.erpCreateDate, id: { lt: current.id } },
          ],
        },
        orderBy: [{ erpCreateDate: 'desc' }, { id: 'desc' }],
        select,
      }),
    ]);
    return { prev, next };
  }

  /**
   * Export Excel degli ordini: gli id selezionati, oppure gli stessi filtri della lista.
   * Lo scope del fornitore e' sempre applicato (buildWhere), quindi un fornitore non puo' esportare ordini altrui.
   */
  async exportExcel(dto: ExportOrdersDto, user: JwtPayload): Promise<{ filename: string; buffer: Buffer }> {
    const where = this.buildWhere(dto, user);
    if (dto.ids?.length) where.id = { in: dto.ids.slice(0, MAX_EXPORT_ROWS) };

    const orders = await this.prisma.order.findMany({
      where,
      orderBy: [{ erpCreateDate: 'desc' }, { id: 'desc' }],
      take: MAX_EXPORT_ROWS,
      include: { _count: { select: { items: true } }, items: { orderBy: { id: 'asc' } } },
    });

    const generatedAt = formatRomeDateTime(new Date());
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'OrderEZ';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Ordini', {
      views: [{ state: 'frozen', ySplit: 3 }],
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true },
    });

    sheet.mergeCells('A1:M1');
    sheet.getCell('A1').value = 'Ordini';
    sheet.getCell('A1').font = { size: 16, bold: true };

    sheet.mergeCells('A2:M2');
    sheet.getCell('A2').value = `Esportati: ${orders.length}   Generato: ${generatedAt} (Europe/Rome)   Valuta: EUR`;
    sheet.getCell('A2').font = { size: 11, color: { argb: 'FF666666' } };

    const headers = [
      'Numero ordine',
      'Data e ora (Europe/Rome)',
      'Cliente',
      'Codice cliente',
      'Fornitore',
      'Destinatario',
      'Telefono',
      'Indirizzo',
      'Righe',
      'Stato',
      'Pagamento',
      'Sconto (EUR)',
      'Trasporto (EUR)',
    ];
    const headerRow = sheet.addRow(headers);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3D3D3A' } };
      cell.alignment = { vertical: 'middle' };
    });

    for (const order of orders) {
      sheet.addRow([
        order.erpOrdersNum,
        formatRomeDateTime(order.erpCreateDate),
        order.clientName ?? '',
        order.clientNum ?? '',
        order.supplierName ?? '',
        order.consignee ?? '',
        order.consigneePhone ?? '',
        order.consigneeAddress ?? '',
        order._count?.items ?? 0,
        orderStatusLabelIt(order.status),
        payStatusLabelIt(order.payStatus),
        eurNumber(toNumber(order.discountTotal) ?? 0),
        eurNumber(toNumber(order.freight) ?? 0),
      ]);
    }

    sheet.eachRow({ includeEmpty: false }, (row, index) => {
      if (index <= 3) return;
      row.getCell(12).numFmt = '#.##0,00';
      row.getCell(13).numFmt = '#.##0,00';
    });

    headers.forEach((_, index) => {
      sheet.getColumn(index + 1).width = [18, 24, 26, 14, 22, 26, 16, 40, 8, 22, 18, 14, 14][index] ?? 16;
    });

    // ---- Foglio 2: dettaglio articoli (una riga per riga d'ordine) ----
    // La sola testata non basta al fornitore: gli articoli sono il dato chiave del confronto.
    const itemsSheet = workbook.addWorksheet('Righe ordine', {
      views: [{ state: 'frozen', ySplit: 3 }],
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true },
    });
    const totalLines = orders.reduce((sum, order) => sum + (order.items?.length ?? 0), 0);

    itemsSheet.mergeCells('A1:K1');
    itemsSheet.getCell('A1').value = 'Righe ordine - dettaglio articoli';
    itemsSheet.getCell('A1').font = { size: 16, bold: true };

    itemsSheet.mergeCells('A2:K2');
    itemsSheet.getCell('A2').value = `Ordini: ${orders.length}   Righe: ${totalLines}   Generato: ${generatedAt} (Europe/Rome)   Valuta: EUR`;
    itemsSheet.getCell('A2').font = { size: 11, color: { argb: 'FF666666' } };

    const itemHeaders = [
      'Numero ordine',
      'Data e ora (Europe/Rome)',
      'Cliente',
      'Fornitore',
      'Codice articolo',
      'Descrizione',
      'Variante',
      'Quantità',
      'Unità',
      'Prezzo unitario (EUR)',
      'Importo riga (EUR)',
    ];
    const itemHeaderRow = itemsSheet.addRow(itemHeaders);
    itemHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    itemHeaderRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3D3D3A' } };
      cell.alignment = { vertical: 'middle' };
    });

    for (const order of orders) {
      for (const item of order.items ?? []) {
        const qty = toDecimal(item.ordersNumber ?? 0);
        const unitPrice = item.ordersPrice ?? toDecimal(0);
        // Stesso criterio dei report: importo riga = quantità × prezzo, HALF_UP a 2 decimali
        const lineAmount = item.actualAmount ?? amountDecimal(qty, unitPrice);
        itemsSheet.addRow([
          order.erpOrdersNum,
          formatRomeDateTime(order.erpCreateDate),
          order.clientName ?? '',
          order.supplierName ?? '',
          item.goodsNum ?? '',
          item.goodsName ?? '',
          item.optionsName ?? '',
          qty.toNumber(),
          item.baseUnits ?? '',
          unitPrice.toNumber(),
          lineAmount.toNumber(),
        ]);
      }
    }

    itemsSheet.eachRow({ includeEmpty: false }, (row, index) => {
      if (index <= 3) return;
      row.getCell(8).numFmt = '#.##0,0000';
      row.getCell(10).numFmt = '#.##0,0000';
      row.getCell(11).numFmt = '#.##0,00';
    });

    itemHeaders.forEach((_, index) => {
      itemsSheet.getColumn(index + 1).width = [18, 24, 26, 22, 18, 46, 20, 12, 10, 18, 18][index] ?? 16;
    });

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return { filename: `ordini_${formatRomeDate(new Date())}.xlsx`, buffer: Buffer.from(arrayBuffer) };
  }

  /** 打印数据（文档 §九） */
  async printData(id: number, user: JwtPayload) {
    const order = await this.detail(id, user);
    return {
      order: {
        id: order.id,
        ordersNum: order.erpOrdersNum,
        clientName: order.clientName,
        clientNum: order.clientNum,
        supplierName: order.supplierName,
        status: order.status,
        statusName: order.statusName,
        consignee: order.consignee,
        consigneeContact: order.consigneeContact,
        consigneePhone: order.consigneePhone,
        consigneeAddress: order.consigneeAddress,
        createdAt: order.erpCreateDate,
        freight: order.freight,
        discountTotal: order.discountTotal,
        // Momento di stampa in ora italiana (Europe/Rome), con i secondi
        printedAt: formatRomeDateTime(new Date()),
      },
      items: order.items.map((item) => ({
        goodsNum: item.goodsNum,
        goodsName: item.goodsName,
        optionsName: item.optionsName,
        qty: item.ordersNumber,
        unit: item.baseUnits,
        unitPrice: item.ordersPrice,
        amount: item.actualAmount,
      })),
    };
  }
}
