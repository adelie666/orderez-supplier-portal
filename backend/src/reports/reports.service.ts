import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { ReportQueryDto } from './dto/report-query.dto';
import { formatRomeDate, romeLocalToUtc } from '../common/time.util';
import { eurNumber, toDecimal, toNumber } from '../common/format.util';
import type { JwtPayload } from '../auth/auth.service';

const ROUNDING = Prisma.Decimal.ROUND_HALF_UP;

interface ReportRow {
  key: string;
  goodsNum: string | null;
  goodsName: string | null;
  optionsName: string | null;
  baseUnits: string | null;
  supplierName: string | null;
  ordersNum: string[];
  qty: Prisma.Decimal;
  amount: Prisma.Decimal;
  /** Riferimento articolo usato per risolvere l'immagine (solo raggruppamento prodotto). */
  imageRef?: { goodsId: string; optionsId: string } | null;
}

interface ProductFieldDef {
  header: string;
  width: number;
  numFmt?: string;
  value: (row: ProductReportRow) => string | number;
}

interface ProductReportRow {
  goodsNum: string | null;
  goodsName: string | null;
  optionsName: string | null;
  baseUnits: string | null;
  supplierName: string | null;
  qty: number;
  purchasePrice: number;
  amount: number;
  ordersCount: number;
}

/**
 * Colonne disponibili per il report raggruppato per prodotto.
 * L'utente sceglie quali mostrare / esportare (parametro `fields`).
 */
const PRODUCT_FIELDS: Record<string, ProductFieldDef> = {
  goodsNum: { header: 'Codice', width: 18, value: (row) => row.goodsNum ?? '' },
  label: { header: 'Descrizione', width: 46, value: (row) => row.goodsName ?? row.optionsName ?? '' },
  optionsName: { header: 'Variante', width: 22, value: (row) => row.optionsName ?? '' },
  baseUnits: { header: 'Unita', width: 12, value: (row) => row.baseUnits ?? '' },
  supplierName: { header: 'Fornitore', width: 22, value: (row) => row.supplierName ?? '' },
  qty: { header: 'Quantita', width: 16, numFmt: '#.##0,0000', value: (row) => row.qty },
  purchasePrice: {
    header: 'Prezzo acquisto (EUR)',
    width: 22,
    numFmt: '#.##0,0000',
    value: (row) => eurNumber(row.purchasePrice),
  },
  amount: { header: 'Importo (EUR)', width: 18, numFmt: '#.##0,00', value: (row) => eurNumber(row.amount) },
  ordersCount: { header: 'N. ordini', width: 12, value: (row) => row.ordersCount },
};

const PRODUCT_FIELD_ORDER = [
  'goodsNum',
  'label',
  'optionsName',
  'baseUnits',
  'supplierName',
  'qty',
  'purchasePrice',
  'amount',
  'ordersCount',
];

const PRODUCT_FIELD_DEFAULT = ['goodsNum', 'label', 'baseUnits', 'qty', 'purchasePrice', 'amount'];

/** Stati ordine esclusi dal report: merce annullata, non da riconciliare con il fornitore. */
const EXCLUDED_ORDER_STATUSES = ['cancelled'];

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 时间段（意大利本地）→ UTC 区间 */
  private range(dto: ReportQueryDto) {
    const to = romeLocalToUtc(dto.dateTo ?? new Date(), true);
    const from = dto.dateFrom
      ? romeLocalToUtc(dto.dateFrom, false)
      : new Date((to as Date).getTime() - 30 * 24 * 3600 * 1000);
    return { from, to };
  }

  private supplierFilter(dto: ReportQueryDto, user: JwtPayload) {
    if (user.role === 'supplier') return user.supplierId ?? -1;
    return dto.supplierId ?? null;
  }

  /** Mappa "goodsId|optionsId" -> URL immagine, risolta in un'unica query. */
  private async productImages(rows: ReportRow[]): Promise<Map<string, string | null>> {
    const refs = rows
      .map((row) => row.imageRef)
      .filter((ref): ref is { goodsId: string; optionsId: string } => !!ref);
    if (!refs.length) return new Map();
    const products = await this.prisma.product.findMany({
      where: { OR: refs.map((ref) => ({ erpGoodsId: ref.goodsId, erpOptionsId: ref.optionsId })) },
      select: { erpGoodsId: true, erpOptionsId: true, imageUrl: true },
    });
    return new Map(products.map((p) => [`${p.erpGoodsId}|${p.erpOptionsId}`, p.imageUrl]));
  }

  /**
   * Righe del report.
   * Fonte: righe d'ordine dell'ERP (order_items + orders), filtrate per data ordine in ora
   * italiana. Gli ordini annullati sono esclusi: non sono merce da riconciliare.
   * Il report serve al fornitore e alla piattaforma per confrontare, in un periodo, quanto
   * di ogni articolo e' stato venduto e per quale importo.
   */
  private async lines(dto: ReportQueryDto, user: JwtPayload) {
    const { from, to } = this.range(dto);
    const supplierId = this.supplierFilter(dto, user);

    return this.prisma.orderItem.findMany({
      where: {
        order: {
          status: { notIn: EXCLUDED_ORDER_STATUSES },
          erpCreateDate: { gte: from as Date, lte: to as Date },
          ...(supplierId ? { supplierId } : {}),
        },
      },
      include: {
        order: {
          select: {
            id: true,
            erpOrdersNum: true,
            supplierId: true,
            supplier: { select: { supplierName: true } },
          },
        },
      },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * Il fornitore dell'articolo non arriva dalle righe d'ordine (order_items.supplier_name e'
   * sempre vuoto nell'API): lo risolvo dal catalogo articoli per codice articolo.
   */
  private async catalogFor(lines: Array<{ goodsNum: string | null }>) {
    type CatalogEntry = { supplierName: string | null; imageRef: { goodsId: string; optionsId: string } };
    const codes = [
      ...new Set(lines.map((line) => line.goodsNum).filter((code): code is string => !!code)),
    ];
    const map = new Map<string, CatalogEntry>();
    if (!codes.length) return map;

    const products = await this.prisma.product.findMany({
      where: { goodsNum: { in: codes } },
      select: { goodsNum: true, supplierName: true, erpGoodsId: true, erpOptionsId: true },
    });
    for (const product of products) {
      const code = product.goodsNum;
      if (!code || map.has(code)) continue;
      map.set(code, {
        supplierName: product.supplierName,
        imageRef: { goodsId: product.erpGoodsId, optionsId: product.erpOptionsId },
      });
    }
    return map;
  }

  async summary(dto: ReportQueryDto, user: JwtPayload) {
    const { from, to } = this.range(dto);
    const supplierId = this.supplierFilter(dto, user);
    const lines = await this.lines(dto, user);

    // Il fornitore dell'articolo non arriva dalle righe d'ordine: lo risolvo dal catalogo.
    const catalog = await this.catalogFor(lines);

    const groupBy = dto.groupBy ?? 'product';
    const map = new Map<string, ReportRow>();

    for (const line of lines) {
      const catalogEntry = line.goodsNum ? catalog.get(line.goodsNum) : undefined;
      const supplierName = catalogEntry?.supplierName ?? line.order.supplier?.supplierName ?? null;
      const key =
        groupBy === 'supplier'
          ? `S:${supplierName}`
          : groupBy === 'order'
            ? `O:${line.order.erpOrdersNum}`
            : `P:${line.erpGoodsId}:${line.erpOptionsId}`;

      const current = map.get(key) ?? {
        key,
        goodsNum: groupBy === 'product' ? line.goodsNum : null,
        goodsName: groupBy === 'product' ? line.goodsName : groupBy === 'supplier' ? supplierName : null,
        optionsName: groupBy === 'product' ? line.optionsName : null,
        baseUnits: groupBy === 'product' ? line.baseUnits : null,
        supplierName,
        imageRef:
          groupBy === 'product'
            ? (catalogEntry?.imageRef ?? { goodsId: line.erpGoodsId ?? '', optionsId: line.erpOptionsId ?? '' })
            : null,
        ordersNum: [],
        qty: new Prisma.Decimal(0),
        amount: new Prisma.Decimal(0),
      };

      if (line.order.erpOrdersNum && !current.ordersNum.includes(line.order.erpOrdersNum)) {
        current.ordersNum.push(line.order.erpOrdersNum);
      }
      current.qty = current.qty.add(toDecimal(line.ordersNumber));
      current.amount = current.amount.add(toDecimal(line.actualAmount));
      map.set(key, current);
    }

    const rows = Array.from(map.values()).sort((a, b) => b.amount.comparedTo(a.amount));
    const imageMap = await this.productImages(rows);
    const totals = rows.reduce(
      (acc, row) => ({
        qty: acc.qty.add(row.qty),
        amount: acc.amount.add(row.amount),
      }),
      { qty: new Prisma.Decimal(0), amount: new Prisma.Decimal(0) },
    );

    return {
      range: { from, to, dateFrom: dto.dateFrom ?? formatRomeDate(from), dateTo: dto.dateTo ?? formatRomeDate(to) },
      groupBy,
      rows: rows.map(({ imageRef, ...row }) => ({
        ...row,
        imageUrl: imageRef
          ? imageMap.get(`${imageRef.goodsId}|${imageRef.optionsId}`) ?? null
          : null,
        qty: toNumber(row.qty.toDecimalPlaces(4, ROUNDING)) ?? 0,
        // Prezzo di acquisto medio ponderato del periodo (importo / quantita)
        purchasePrice:
          toNumber(
            row.qty.isZero()
              ? toDecimal(0)
              : row.amount.div(row.qty).toDecimalPlaces(4, ROUNDING),
          ) ?? 0,
        amount: toNumber(row.amount.toDecimalPlaces(2, ROUNDING)) ?? 0,
        ordersCount: row.ordersNum.length,
      })),
      totals: {
        qty: toNumber(totals.qty.toDecimalPlaces(4, ROUNDING)) ?? 0,
        amount: toNumber(totals.amount.toDecimalPlaces(2, ROUNDING)) ?? 0,
        lines: lines.length,
      },
    };
  }

  /** 导出 Excel（EUR / 意式数字格式，文档 §七） */
  async exportExcel(dto: ReportQueryDto, user: JwtPayload): Promise<{ filename: string; buffer: Buffer }> {
    const report = await this.summary(dto, user);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'OrderEZ';
    workbook.created = new Date();

    // Il report e' per articolo (venduto nel periodo), non per spedizione.
    const sheet = workbook.addWorksheet('Report articoli', {
      views: [{ state: 'frozen', ySplit: 4 }],
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true },
    });

    // Colonne del report per prodotto: scelte dall'utente (parametro `fields`), altrimenti default.
    const requested = String(dto.fields ?? '')
      .split(',')
      .map((key) => key.trim())
      .filter((key) => key in PRODUCT_FIELDS);
    const productKeys =
      report.groupBy === 'product'
        ? PRODUCT_FIELD_ORDER.filter((key) =>
            requested.length ? requested.includes(key) : PRODUCT_FIELD_DEFAULT.includes(key),
          )
        : [];
    const productDefs = productKeys.map((key) => PRODUCT_FIELDS[key]);

    const headers =
      report.groupBy === 'supplier'
        ? ['Fornitore', 'Ordini', 'Quantita', 'Importo (EUR)']
        : report.groupBy === 'order'
          ? ['Numero ordine', 'Fornitore', 'Quantita', 'Importo (EUR)']
          : productDefs.map((def) => def.header);

    const lastCol = String.fromCharCode(64 + Math.max(headers.length, 1));
    sheet.mergeCells(`A1:${lastCol}1`);
    sheet.getCell('A1').value = 'Report articoli';
    sheet.getCell('A1').font = { size: 16, bold: true };

    sheet.mergeCells(`A2:${lastCol}2`);
    sheet.getCell('A2').value = `Periodo: ${report.range.dateFrom} - ${report.range.dateTo} (Europe/Rome)   Valuta: EUR`;
    sheet.getCell('A2').font = { size: 11, color: { argb: 'FF666666' } };

    const headerRow = sheet.addRow(headers);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3D3D3A' } };
      cell.alignment = { vertical: 'middle' };
    });

    for (const row of report.rows) {
      if (report.groupBy === 'supplier') {
        sheet.addRow([row.supplierName ?? '', row.ordersCount, row.qty, eurNumber(row.amount)]);
      } else if (report.groupBy === 'order') {
        sheet.addRow([row.ordersNum[0] ?? '', row.supplierName ?? '', row.qty, eurNumber(row.amount)]);
      } else {
        sheet.addRow(productDefs.map((def) => def.value(row)));
      }
    }

    // 合计行
    let totalValues: (string | number)[];
    if (report.groupBy === 'product') {
      totalValues = productKeys.map(() => '');
      const qtyIdx = productKeys.indexOf('qty');
      const amountIdx = productKeys.indexOf('amount');
      const labelIdx =
        productKeys.indexOf('label') >= 0 ? productKeys.indexOf('label') : productKeys.indexOf('goodsNum');
      if (qtyIdx >= 0) totalValues[qtyIdx] = report.totals.qty;
      if (amountIdx >= 0) totalValues[amountIdx] = eurNumber(report.totals.amount);
      if (labelIdx >= 0) totalValues[labelIdx] = 'Totale';
    } else {
      totalValues = ['Totale', '', report.totals.qty, eurNumber(report.totals.amount)];
    }
    const totalRow = sheet.addRow(totalValues);
    totalRow.font = { bold: true };

    // 意式格式：千分位点，小数逗号
    const fmtFor = (col: number): string | undefined => {
      if (report.groupBy === 'product') return productDefs[col - 1]?.numFmt;
      if (col === 3) return '#.##0,0000';
      if (col === 4) return '#.##0,00';
      return undefined;
    };
    sheet.eachRow({ includeEmpty: false }, (row, index) => {
      if (index <= 3) return;
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        const fmt = fmtFor(col);
        if (fmt) cell.numFmt = fmt;
      });
    });

    headers.forEach((_, index) => {
      sheet.getColumn(index + 1).width =
        report.groupBy === 'product' ? productDefs[index]?.width ?? 16 : [16, 42, 10, 14][index] ?? 16;
    });

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const filename = `report-articoli_${report.range.dateFrom}_${report.range.dateTo}.xlsx`;
    return { filename, buffer: Buffer.from(arrayBuffer) };
  }
}
