import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SyncService } from '../sync/sync.service';

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
  ) {}

  /**
   * Importa la mappatura articolo -> fornitore.
   * L'API ERP di Dinghuobao non espone il fornitore dell'articolo, quindi la mappatura
   * arriva dall'esportazione della lista articoli; da qui gli ordini ereditano il fornitore.
   */
  async importGoodsMap(rows: Array<{ goodsNum?: unknown; supplierName?: unknown }>) {
    const clean = (Array.isArray(rows) ? rows : [])
      .map((row) => ({
        goodsNum: String(row?.goodsNum ?? '').trim(),
        supplierName: String(row?.supplierName ?? '').trim(),
      }))
      .filter((row) => row.goodsNum && row.supplierName);

    if (!clean.length) {
      return { received: 0, updated: 0, ordersAssigned: 0, ordersCleared: 0, unknownSuppliers: [] as string[] };
    }

    // Solo fornitori presenti in anagrafica (devono arrivare da Dinghuobao, non inventati in locale).
    const known = await this.prisma.supplier.findMany({ select: { supplierName: true } });
    const knownNames = new Set(known.map((row) => row.supplierName.trim()));

    let updated = 0;
    const unknownSuppliers = new Set<string>();
    for (const row of clean) {
      if (!knownNames.has(row.supplierName)) {
        unknownSuppliers.add(row.supplierName);
        continue;
      }
      const result = await this.prisma.product.updateMany({
        where: { goodsNum: row.goodsNum },
        data: { supplierName: row.supplierName },
      });
      updated += result.count;
    }

    const orders = await this.sync.resolveAllOrderSuppliers();
    return {
      received: clean.length,
      updated,
      ordersAssigned: orders.assigned,
      ordersCleared: orders.cleared,
      unknownSuppliers: [...unknownSuppliers].slice(0, 30),
    };
  }

  /**
   * Importa la mappatura da testo incollato/esportato (CSV, TSV o Excel incollato).
   * Individua le colonne dall'intestazione (numero articolo e fornitore).
   */
  async importGoodsMapText(text: string) {
    const lines = String(text ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return this.importGoodsMap([]);

    const splitLine = (line: string): string[] =>
      (line.includes('\t') ? line.split('\t') : line.includes(';') ? line.split(';') : line.split(','))
        .map((cell) => cell.trim().replace(/^"/, '').replace(/"$/, ''));

    const header = splitLine(lines[0]);
    const codeIndex = header.findIndex((cell) => /\u7f16\u53f7|\u8d27\u53f7|\u7f16\u7801|codice|coding|code|sku|articolo|goods/i.test(cell));
    const supplierIndex = header.findIndex((cell) => /\u4f9b\u5e94\u5546|fornitore|supplier/i.test(cell));

    const rows: Array<{ goodsNum: string; supplierName: string }> = [];
    const hasHeader = codeIndex >= 0 && supplierIndex >= 0 && codeIndex !== supplierIndex;
    const cIdx = hasHeader ? codeIndex : 0;
    const sIdx = hasHeader ? supplierIndex : header.length - 1;

    for (const line of hasHeader ? lines.slice(1) : lines) {
      const cells = splitLine(line);
      const goodsNum = cells[cIdx]?.trim();
      const supplierName = cells[sIdx]?.trim();
      if (goodsNum && supplierName) rows.push({ goodsNum, supplierName });
    }
    return this.importGoodsMap(rows);
  }
  async list() {
    const rows = await this.prisma.supplier.findMany({
      orderBy: { supplierName: 'asc' },
      include: {
        _count: { select: { orders: true, users: true, shipments: true } },
      },
    });
    return { rows, total: rows.length };
  }

  async detail(id: number) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: { users: { select: { id: true, username: true, status: true, createdAt: true } } },
    });
    if (!supplier) throw new NotFoundException('Fornitore non trovato');

    const [orders, shipments, pending] = await Promise.all([
      this.prisma.order.count({ where: { supplierId: id } }),
      this.prisma.shipment.count({ where: { supplierId: id, status: 'receivedin' } }),
      this.prisma.order.count({ where: { supplierId: id, status: { in: ['stockup', 'pending'] } } }),
    ]);
    return { ...supplier, stats: { orders, shipments, pending } };
  }

  /** 供应商角色的自助查询：只允许看自己那一条 */
  async detailForSupplier(supplierId: number | null) {
    if (!supplierId) throw new NotFoundException('Fornitore non trovato');
    return this.detail(supplierId);
  }

  /**
   * Articoli di catalogo ancora senza fornitore: senza questa mappatura un ordine
   * non puo' essere assegnato a nessun fornitore e resta invisibile al fornitore.
   */
  async unmappedGoods(take = 200) {
    const limit = Math.min(Math.max(Number(take) || 200, 1), 1000);
    // Solo gli articoli che compaiono davvero in un ordine: sono quelli che bloccano
    // l'assegnazione del fornitore. Il catalogo Dinghuobao contiene anche articoli
    // di altre attivita' che non servono a questo portale.
    const rows = await this.prisma.$queryRaw<
      Array<{ goodsNum: string | null; goodsName: string | null; orders: bigint }>
    >`
      SELECT p.goods_num AS "goodsNum",
             p.goods_name AS "goodsName",
             COUNT(DISTINCT oi.order_id) AS "orders"
      FROM products p
      JOIN order_items oi ON oi.goods_num = p.goods_num
      JOIN orders o ON o.id = oi.order_id
      WHERE p.supplier_name IS NULL
        AND o.supplier_id IS NULL
        AND o.erp_create_date >= now() - interval '30 days'
      GROUP BY p.goods_num, p.goods_name
      ORDER BY COUNT(DISTINCT oi.order_id) DESC, p.goods_num ASC
      LIMIT ${limit}
    `;
    const totals = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(DISTINCT p.goods_num) AS "total"
      FROM products p
      JOIN order_items oi ON oi.goods_num = p.goods_num
      JOIN orders o ON o.id = oi.order_id
      WHERE p.supplier_name IS NULL
        AND o.supplier_id IS NULL
        AND o.erp_create_date >= now() - interval '30 days'
    `;
    return {
      total: Number(totals[0]?.total ?? 0),
      rows: rows.map((row) => ({ ...row, orders: Number(row.orders) })),
    };
  }

  async syncFromErp() {
    return this.sync.syncSuppliers();
  }
}
