import { BadRequestException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GatewayClient } from '../integration/gateway.client';
import { RawDelivery, RawGoods, RawOrder, RawOrderItem, RawSupplier } from '../integration/types';
import { beijingToUtc } from '../common/time.util';
import {
  DEFAULT_SUPPLIER_FIELD,
  SUPPLIER_FIELD_KEYS,
  SupplierIndex,
  buildSupplierIndex,
  resolveSupplierValue,
} from '../common/supplier-match.util';
import { SETTING_KEYS } from '../settings/settings.service';
import { toDecimal, toNumber } from '../common/format.util';
import { Prisma, Order, OrderItem } from '@prisma/client';

const WATERMARK_KEY = 'order_last_create_date';
const PAGE_SIZE = 100;
const MAX_PAGES = 200;


/** Campo personalizzato dell'ERP risolto in anagrafica fornitori. */
interface SupplierResolution {
  fieldKey: string | null;
  index: SupplierIndex | null;
}

interface SupplierMatchStats {
  matched: number;
  unmatched: Map<string, number>;
}

/** Esito dell'azzeramento dati per il passaggio a un altro gestionale. */
export interface ResetDataResult {
  deleted: {
    shipments: number;
    shipmentItems: number;
    orders: number;
    orderItems: number;
    products: number;
    suppliers: number;
    accounts: number;
    logs: number;
    watermarks: number;
  };
}

/** Host pubblico delle immagini articolo dell'ERP (goods_picture e' un percorso relativo). */
const ERP_IMAGE_BASE = `${(process.env.ERP_IMAGE_BASE_URL?.trim() || 'https://img.example.com').replace(/\/+$/, '')}/`;

function productImageUrl(picture?: string | null): string | null {
  const path = picture?.trim();
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${ERP_IMAGE_BASE}${path.replace(/^\/+/, '')}`;
}

@Injectable()
export class SyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SyncService.name);

  /** 供应商字段缺失只告警一次，避免刷屏 */
  private warnedNoSupplier = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: GatewayClient,
  ) {}

  /**
   * All'avvio riapplica la mappatura articolo -> fornitore e ricalcola il fornitore
   * degli ordini: cosi' dopo ogni riavvio il portale e' subito coerente senza attendere
   * il cron notturno.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const orders = await this.resolveAllOrderSuppliers();
      if (orders.assigned || orders.cleared) {
        this.logger.log(
          `Assegnazione fornitori agli ordini: ${orders.assigned} assegnati, ${orders.cleared} azzerati`,
        );
      }
    } catch (error) {
      this.logger.warn(`Assegnazione fornitori all'avvio non applicata: ${(error as Error).message}`);
    }
  }

  // ------------------------------------------------------------- 供应商同步
  /**
   * true quando le credenziali ERP sono configurate. Senza credenziali non esiste
   * alcun dataset di ripiego: le sincronizzazioni restano sospese.
   */
  async integrationReady(): Promise<boolean> {
    return this.gateway.isConfigured();
  }

  /**
   * Blocca le sincronizzazioni quando mancano le credenziali: senza di esse l'ERP
   * reale non e' raggiungibile e non esiste alcun dataset di ripiego.
   */
  private async assertRealIntegration(): Promise<void> {
    if (await this.gateway.isConfigured()) return;
    throw new BadRequestException(
      'Credenziali ERP non configurate: configurare numero seriale e password prima di sincronizzare.',
    );
  }


  async syncSuppliers(): Promise<{ count: number }> {
    const started = Date.now();
    await this.assertRealIntegration();
    let count = 0;
    try {
      // dhb_supplier_list 分页从 0 起（文档 §5.1 注）
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const { rows, total } = await this.gateway.listSuppliers({ page, pageSize: PAGE_SIZE });
        if (!rows.length) break;
        await this.upsertSuppliers(rows);
        count += rows.length;
        if (total != null && count >= total) break;
      }
      await this.log('supplier', 'ok', `Sincronizzati ${count} fornitori`, { count });
      return { count };
    } catch (error) {
      await this.log('supplier', 'fail', (error as Error).message);
      throw error;
    } finally {
      this.logger.log(`syncSuppliers: ${count} righe in ${Date.now() - started}ms`);
    }
  }

  async upsertSuppliers(rows: RawSupplier[]): Promise<void> {
    for (const row of rows) {
      const name = (row.client_name ?? '').trim();
      if (!name) continue;
      await this.prisma.supplier.upsert({
        where: { supplierName: name },
        create: {
          supplierName: name,
          erpClientId: row.client_id != null ? String(row.client_id) : null,
          erpBaseClientId: row.erp_base_client_id != null ? String(row.erp_base_client_id) : null,
          clientNum: row.client_num != null ? String(row.client_num) : null,
          contact: row.contact ?? null,
          mobile: row.mobile ?? null,
          status: row.status != null ? String(row.status) : null,
          syncedAt: new Date(),
        },
        update: {
          erpClientId: row.client_id != null ? String(row.client_id) : undefined,
          erpBaseClientId: row.erp_base_client_id != null ? String(row.erp_base_client_id) : undefined,
          clientNum: row.client_num != null ? String(row.client_num) : undefined,
          contact: row.contact ?? undefined,
          mobile: row.mobile ?? undefined,
          status: row.status != null ? String(row.status) : undefined,
          syncedAt: new Date(),
        },
      });
    }
  }

  /** 根据 supplier_name 匹配供应商；未匹配时自动建档并告警（文档 §6.1 d） */
  async ensureSupplier(name: string): Promise<number | null> {
    const supplierName = name?.trim();
    if (!supplierName) return null;
    const existing = await this.prisma.supplier.findUnique({ where: { supplierName } });
    if (existing) return existing.id;

    const created = await this.prisma.supplier.create({ data: { supplierName } });
    await this.log('supplier', 'fail', `Fornitore non presente in anagrafica, creato automaticamente: ${supplierName}`, {
      supplierName,
    });
    this.logger.warn(`Supplier auto-creato: ${supplierName}`);
    return created.id;
  }

  // --------------------------------------------------------------- 商品同步

  async syncProducts(): Promise<{ count: number }> {
    await this.assertRealIntegration();
    let count = 0;
    try {
      // dhb_goods_list 分页从 0 起
      let rawSeen = 0;
      const resolution = await this.supplierResolution();
      const stats: SupplierMatchStats = { matched: 0, unmatched: new Map() };
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const { rows, total, rawCount } = await this.gateway.listGoods({ page, pageSize: PAGE_SIZE });
        if (!rows.length) break;
        await this.upsertProducts(rows, resolution, stats);
        count += rows.length;
        // Paginazione sull'ultima pagina grezza: le varianti moltiplicano le righe mappate,
        // quindi confrontare count (mappato) con total (grezzo) tagliava il catalogo.
        const pageRaw = rawCount ?? rows.length;
        rawSeen += pageRaw;
        if (pageRaw < PAGE_SIZE) break;
        if (total != null && rawSeen >= total) break;
      }
      // Il fornitore dell'articolo non arriva dall'ERP: applico la mappatura locale
      // (solo articoli ancora senza fornitore) e ricalcolo il fornitore degli ordini,
      // cosi' un articolo appena mappato rende subito visibile l'ordine al fornitore.
      const orders = await this.resolveAllOrderSuppliers();
      const unmapped = await this.prisma.product.count({ where: { supplierName: null } });
      if (stats.unmatched.size) {
        const sample = [...stats.unmatched.entries()]
          .slice(0, 5)
          .map(([value, count]) => `${value} (${count})`)
          .join(', ');
        this.logger.warn(`Fornitore non riconosciuto in ${resolution.fieldKey}: ${sample}`);
      }
      await this.log(
        'product',
        'ok',
        `Sincronizzati ${count} articoli (ordini assegnati: ${orders.assigned}, articoli senza fornitore: ${unmapped})`,
        // I valori non riconosciuti non bloccano la sincronizzazione: finiscono nel payload del log riuscito.
        {
          count,
          ordersAssigned: orders.assigned,
          unmapped,
          supplierField: resolution.fieldKey,
          supplierMatched: stats.matched,
          supplierUnmatched: Object.fromEntries([...stats.unmatched.entries()].slice(0, 20)),
        },
      );
      return { count };
    } catch (error) {
      await this.log('product', 'fail', (error as Error).message);
      throw error;
    }
  }

  /**

  /**
   * Campo personalizzato dell'ERP usato come fornitore + indice dell'anagrafica
   * fornitori per riconoscere i valori (per nome, numero cliente o id ERP).
   */
  private async supplierResolution(): Promise<SupplierResolution> {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEYS.supplierField } });
    const fieldKey = (row?.value ?? DEFAULT_SUPPLIER_FIELD).trim();
    if (!fieldKey || !(SUPPLIER_FIELD_KEYS as readonly string[]).includes(fieldKey)) {
      return { fieldKey: null, index: null };
    }
    const suppliers = await this.prisma.supplier.findMany({
      select: { supplierName: true, clientNum: true, erpClientId: true },
    });
    return { fieldKey, index: buildSupplierIndex(suppliers) };
  }

  /**
   * Fornitore della riga articolo: prima il campo nativo ERP (se mai esposto), poi il
   * campo personalizzato configurato, ma solo se il valore esiste in anagrafica fornitori.
   * Un valore non riconosciuto non viene inventato: resta senza fornitore.
   */
  private resolveRowSupplier(row: RawGoods, resolution: SupplierResolution, stats: SupplierMatchStats): string | null {
    const fromErp = typeof row.supplier_name === 'string' ? row.supplier_name.trim() : '';
    if (fromErp) return fromErp;

    const { fieldKey, index } = resolution;
    if (!fieldKey || !index) return null;
    const raw = row.custom_fields?.[fieldKey];
    if (!raw) return null;

    const matched = resolveSupplierValue(raw, index);
    if (matched) return matched;

    stats.unmatched.set(raw, (stats.unmatched.get(raw) ?? 0) + 1);
    return null;
  }

  private async upsertProducts(rows: RawGoods[], resolution: SupplierResolution, stats: SupplierMatchStats): Promise<void> {
    for (const row of rows) {
      // 唯一键两列都不允许 NULL（否则 Postgres 唯一约束失效、商品会重复插入）
      const erpGoodsId = row.goods_id != null ? String(row.goods_id) : '';
      const erpOptionsId = row.options_id != null ? String(row.options_id) : '';
      if (!erpGoodsId) continue;

      const supplierName = this.resolveRowSupplier(row, resolution, stats);
      if (supplierName) stats.matched += 1;

      const data = {
        erpGoodsId,
        erpOptionsId,
        goodsNum: row.goods_num ?? row.options_goods_num ?? null,
        goodsName: row.goods_name ?? null,
        optionsName: row.options_name ?? null,
        supplierName,
        wholePrice: toNumber(row.whole_price),
        purchasePrice: toNumber(row.purchase_price),
        baseUnits: row.base_units ?? null,
        conversionNumber: toNumber(row.conversion_number),
        imageUrl: productImageUrl(row.picture),
        raw: row as unknown as object,
        syncedAt: new Date(),
      };

      await this.prisma.product.upsert({
        where: { erpGoodsId_erpOptionsId: { erpGoodsId, erpOptionsId } },
        create: data,
        // Il fornitore dell'articolo e' la fonte di verita' del gestionale: se la sorgente non lo
        // espone (campo fornitore vuoto) la colonna resta vuota, senza ereditare valori vecchi.
        update: {
          ...data,
          supplierName,
          // Come per il fornitore: se la sorgente non manda l'immagine, tieni quella gia' nota.
          imageUrl: row.picture ? productImageUrl(row.picture) : undefined,
        },
      });
    }
  }

  // --------------------------------------------------------------- 订单拉取

  async syncOrders(options: { lookbackDays?: number; full?: boolean } = {}): Promise<{
    pulled: number;
    created: number;
    updated: number;
    watermark: string | null;
  }> {
    const lookbackDays = options.lookbackDays ?? Number(process.env.SYNC_LOOKBACK_DAYS ?? 30);
    await this.assertRealIntegration();
    const now = new Date();

    let watermark = options.full ? null : await this.getWatermark();
    if (!watermark) {
      watermark = new Date(now.getTime() - lookbackDays * 24 * 3600 * 1000);
    }

    let page = 1; // dhb_orders 分页从 1 起（文档 §5.1 注）
    let pulled = 0;
    let created = 0;
    let updated = 0;
    let maxCreateDate = watermark;
    let lastError: Error | null = null;

    try {
      for (; page <= MAX_PAGES; page += 1) {
        const { rows } = await this.gateway.listOrders(watermark, now, { page, pageSize: PAGE_SIZE });
        if (!rows.length) break;

        for (const raw of rows) {
          pulled += 1;
          const result = await this.upsertOrder(raw);
          if (result === 'created') created += 1;
          else if (result === 'updated') updated += 1;
          const created2 = beijingToUtc(raw.create_date as never);
          if (created2 && (!maxCreateDate || created2 > maxCreateDate)) maxCreateDate = created2;
        }

        if (rows.length < PAGE_SIZE) break;
      }

      await this.setWatermark(maxCreateDate);
      await this.log('order', 'ok', `Pull completato: ${pulled} ordini (${created} nuovi, ${updated} aggiornati)`, {
        pulled,
        created,
        updated,
        watermark: maxCreateDate?.toISOString() ?? null,
      });
      return { pulled, created, updated, watermark: maxCreateDate?.toISOString() ?? null };
    } catch (error) {
      lastError = error as Error;
      await this.log('order', 'fail', lastError.message, { pulled, created, updated, page });
      throw error;
    } finally {
      this.logger.log(
        `syncOrders: ${pulled} ordini (${created} nuovi, ${updated} aggiornati)${lastError ? ` — errore: ${lastError.message}` : ''}`,
      );
    }
  }

  /** 每日回扫近 N 天订单，更新状态（文档 §6.1 步 7） */
  async refreshRecentOrders(days = 7): Promise<{ refreshed: number }> {
    await this.assertRealIntegration();
    const from = new Date(Date.now() - days * 24 * 3600 * 1000);
    const to = new Date();
    let refreshed = 0;

    try {
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const { rows } = await this.gateway.listOrders(from, to, { page, pageSize: PAGE_SIZE });
        if (!rows.length) break;
        for (const raw of rows) {
          await this.upsertOrder(raw);
          refreshed += 1;
        }
        if (rows.length < PAGE_SIZE) break;
      }
      await this.log('order', 'ok', `Ricontrollati ${refreshed} ordini (ultimi ${days} giorni)`, { refreshed });
      return { refreshed };
    } catch (error) {
      await this.log('order', 'fail', (error as Error).message);
      throw error;
    }
  }

  /** 单订单入库（幂等：ON CONFLICT erp_orders_id DO UPDATE） */
  // ------------------------------------------------------- 发货单同步（对账）

  /**
   * 把上游 ERP 的出库/发货单（getShipsList）导入本地 shipments / shipment_items。
   * 门户只记录了自己点过发货的订单，直接在上游 ERP 发货的单据此前完全不可见，
   * 这正是报表与首页热销商品为空的原因。
   */
  async syncShipments(options: { days?: number; from?: Date; to?: Date } = {}): Promise<{
    scanned: number;
    created: number;
    updated: number;
    unmatched: number;
    skipped: number;
  }> {
    const days = options.days ?? Number(process.env.SYNC_SHIP_DAYS ?? 120);
    await this.assertRealIntegration();
    const to = options.to ?? new Date();
    const from = options.from ?? new Date(to.getTime() - days * 24 * 3600 * 1000);

    let scanned = 0;
    let created = 0;
    let updated = 0;
    let unmatched = 0;
    let skipped = 0;

    try {
      const deliveries = await this.gateway.listDeliveries(from, to);

      for (const delivery of deliveries) {
        const ordersNum = String(delivery.orders_num ?? '').trim();
        if (!ordersNum) {
          skipped += 1;
          continue;
        }
        scanned += 1;

        const order = await this.prisma.order.findUnique({
          where: { erpOrdersNum: ordersNum },
          include: { items: true },
        });
        if (!order) {
          unmatched += 1;
          continue;
        }

        const result = await this.materializeShipment(order, delivery);
        if (result === 'created') created += 1;
        else if (result === 'updated') updated += 1;
        else skipped += 1;
      }

      await this.log(
        'ship',
        'ok',
        `Importate ${created} nuove spedizioni (${updated} aggiornate, ${unmatched} ordini non trovati)`,
        { scanned, created, updated, unmatched, skipped, days },
      );
      return { scanned, created, updated, unmatched, skipped };
    } catch (error) {
      await this.log('ship', 'fail', (error as Error).message);
      throw error;
    }
  }

  /**
   * 根据上游 ERP 发货单创建/更新本地发货单，并快照进货价。
   * 金额口径与 ShipmentsService.finalize 一致：行金额 = 数量 × 进货价，HALF_UP 到 2 位。
   */
  private async materializeShipment(
    order: Order & { items: OrderItem[] },
    delivery: RawDelivery,
  ): Promise<'created' | 'updated' | 'skipped'> {
    const status = String(delivery.status ?? '').toLowerCase();
    if (status === 'cancelled') return 'skipped';

    const shippedAt = beijingToUtc(delivery.ships_date as never) ?? new Date();

    const products = order.items.length
      ? await this.prisma.product.findMany({
          where: {
            OR: order.items.map((item) => ({
              erpGoodsId: item.erpGoodsId ?? '',
              erpOptionsId: item.erpOptionsId ?? '',
            })),
          },
        })
      : [];

    const existing = await this.prisma.shipment.findUnique({ where: { orderId: order.id } });

    const shipment = await this.prisma.shipment.upsert({
      where: { orderId: order.id },
      create: {
        orderId: order.id,
        supplierId: order.supplierId,
        erpShipsSn: delivery.ships_num ?? null,
        shippedAt,
        status: 'receivedin',
        raw: delivery as unknown as object,
      },
      update: {
        erpShipsSn: delivery.ships_num ?? existing?.erpShipsSn ?? null,
        status: 'receivedin',
        ...(delivery.ships_date ? { shippedAt } : {}),
      },
      select: { id: true },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.shipmentItem.deleteMany({ where: { shipmentId: shipment.id } });
      if (!order.items.length) return;
      await tx.shipmentItem.createMany({
        data: order.items.map((item) => {
          const hit = products.find(
            (p) => p.erpGoodsId === (item.erpGoodsId ?? '') && p.erpOptionsId === (item.erpOptionsId ?? ''),
          );
          // 上游 ERP 的 purchase 字段常为 0（未维护进货价）→ 回退到订单行价格
          const rawPrice = hit?.purchasePrice;
          const purchasePrice =
            rawPrice && Number(rawPrice) > 0 ? toDecimal(rawPrice) : toDecimal(item.ordersPrice ?? 0);
          const qty = toDecimal(item.ordersNumber ?? 0);
          return {
            shipmentId: shipment.id,
            orderItemId: item.id,
            productId: hit?.id ?? null,
            erpGoodsId: item.erpGoodsId,
            erpOptionsId: item.erpOptionsId,
            goodsNum: item.goodsNum,
            goodsName: item.goodsName,
            optionsName: item.optionsName,
            baseUnits: item.baseUnits,
            qtyShipped: qty,
            purchasePrice,
            amountEur: purchasePrice.mul(qty).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
          };
        }),
      });
    });

    return existing ? 'updated' : 'created';
  }

  private async upsertOrder(raw: RawOrder): Promise<'created' | 'updated' | 'skipped'> {
    const erpOrdersNum = raw.orders_num != null ? String(raw.orders_num) : null;
    if (!erpOrdersNum) return 'skipped';
    const erpOrdersId = String(raw.orders_id ?? erpOrdersNum);

    // 一次拿齐订单头 + 明细（getOrderContent）
    const { head, items } = await this.gateway.getOrderContent(raw);

    // 上游 ERP 的销售订单明细不携带供应商字段，
    // 因此保持为 null；归属规则待业务方确认后再补映射。
    const supplierName = items.find((item) => item.supplier_name)?.supplier_name ?? null;
    const supplierId = supplierName ? await this.ensureSupplier(supplierName) : null;
    if (!supplierName && !this.warnedNoSupplier) {
      this.warnedNoSupplier = true;
      this.logger.warn('Gli ordini non hanno fornitore associato: il campo non esiste nella API ERP');
    }

    const createDate = beijingToUtc((head.create_date ?? raw.create_date) as never);
    const updateDate = beijingToUtc((head.update_date ?? raw.update_date) as never);

    const existing = await this.prisma.order.findUnique({ where: { erpOrdersId } });

    const data = {
      erpOrdersId,
      erpOrdersNum,
      supplierId,
      supplierName,
      clientName: head.client_name ?? raw.client_name ?? null,
      clientNum: head.client_num ?? raw.client_num ?? null,
      status: raw.status ?? head.status ?? null,
      statusName: raw.status_name ?? head.status_name ?? null,
      payStatus: head.pay_status ?? raw.pay_status ?? null,
      payStatusName: head.pay_status_name ?? raw.pay_status_name ?? null,
      consignee: head.consignee ?? null,
      consigneeContact: head.consignee_contact ?? null,
      consigneePhone: head.consignee_phone ?? null,
      consigneeAddress: head.consignee_address ?? null,
      discountTotal: toNumber(head.discount_total ?? raw.discount_total),
      freight: toNumber(head.freight ?? raw.freight),
      erpCreateDate: createDate,
      erpUpdateDate: updateDate,
      raw: { head: head as unknown as object, list: raw as unknown as object },
      syncedAt: new Date(),
    };

    const order = await this.prisma.order.upsert({
      where: { erpOrdersId },
      create: data,
      update: data,
    });

    // 明细整单重建，保持与上游 ERP 一致
    await this.prisma.orderItem.deleteMany({ where: { orderId: order.id } });
    if (items.length) {
      await this.prisma.orderItem.createMany({
        data: items.map((item) => this.mapItem(order.id, item)),
      });
    }

    // 归属供应商：订单明细本身不带供应商（ERP 接口限制），改从商品档案反推。
    await this.resolveOrderSupplier(order.id);

    return existing ? 'updated' : 'created';
  }

  /**
   * 根据订单商品反推供应商：商品档案里每个商品属于一个供应商。
   * 只有当一个订单的所有商品都指向同一供应商时，才给订单打上该供应商；
   * 多供应商订单不设唯一供应商，列表里供应商列留空。
   */
  private async resolveOrderSupplier(orderId: number): Promise<void> {
    const items = await this.prisma.orderItem.findMany({
      where: { orderId },
      select: { goodsNum: true },
    });
    const codes = [...new Set(items.map((item) => item.goodsNum).filter((code): code is string => !!code))];
    if (!codes.length) return;

    const products = await this.prisma.product.findMany({
      where: { goodsNum: { in: codes }, supplierName: { not: null } },
      select: { supplierName: true },
    });
    const names = [...new Set(products.map((row) => row.supplierName).filter((name): name is string => !!name))];
    if (names.length !== 1) return;

    const supplierName = names[0];
    const supplierId = await this.ensureSupplier(supplierName);
    await this.prisma.order.update({
      where: { id: orderId },
      data: { supplierName, supplierId },
    });
  }

  /**
   * Ricalcola in blocco il fornitore di tutti gli ordini dalla mappatura articolo->fornitore.
   * Un ordine ha un fornitore unico solo se TUTTI i suoi articoli risultano mappati
   * allo stesso fornitore; gli ordini misti restano senza (colonna Fornitore vuota).
   */
  async resolveAllOrderSuppliers(): Promise<{ assigned: number; cleared: number }> {
    const assigned = await this.prisma.$executeRawUnsafe(`
      WITH item_suppliers AS (
        SELECT oi.order_id AS order_id,
               COUNT(DISTINCT p.supplier_name) AS supplier_count,
               MIN(p.supplier_name) AS supplier_name,
               COUNT(*) AS mapped_items
        FROM order_items oi
        JOIN products p ON p.goods_num = oi.goods_num AND p.supplier_name IS NOT NULL
        GROUP BY oi.order_id
      ),
      item_totals AS (
        SELECT order_id, COUNT(*) AS total_items FROM order_items GROUP BY order_id
      )
      UPDATE orders o
      SET supplier_name = item_suppliers.supplier_name,
          supplier_id = s.id
      FROM item_suppliers
      JOIN item_totals t ON t.order_id = item_suppliers.order_id
      JOIN suppliers s ON s.supplier_name = item_suppliers.supplier_name
      WHERE o.id = item_suppliers.order_id
        AND item_suppliers.supplier_count = 1
        AND item_suppliers.mapped_items = t.total_items
        AND o.supplier_id IS DISTINCT FROM s.id
    `);

    const cleared = await this.prisma.$executeRawUnsafe(`
      WITH mapped AS (
        SELECT oi.order_id AS order_id,
               COUNT(DISTINCT p.supplier_name) AS supplier_count
        FROM order_items oi
        JOIN products p ON p.goods_num = oi.goods_num AND p.supplier_name IS NOT NULL
        GROUP BY oi.order_id
      ),
      with_items AS (
        SELECT DISTINCT order_id FROM order_items
      )
      UPDATE orders o
      SET supplier_name = NULL, supplier_id = NULL
      FROM with_items w
      LEFT JOIN mapped m ON m.order_id = w.order_id
      WHERE o.id = w.order_id
        AND (o.supplier_id IS NOT NULL OR o.supplier_name IS NOT NULL)
        -- ordini con articoli non piu' mappati (m.order_id IS NULL) o con fornitori misti
        AND (m.order_id IS NULL OR m.supplier_count > 1)
    `);

    return { assigned: Number(assigned), cleared: Number(cleared) };
  }

  private mapItem(orderId: number, item: RawOrderItem) {
    return {
      orderId,
      erpOrdersListId: item.orders_list_id != null ? String(item.orders_list_id) : null,
      erpGoodsId: item.goods_id != null ? String(item.goods_id) : null,
      erpOptionsId: item.options_id != null ? String(item.options_id) : null,
      goodsNum: item.goods_num ?? item.options_goods_num ?? null,
      goodsName: item.goods_name ?? null,
      optionsName: item.options_name ?? null,
      supplierName: item.supplier_name ?? null,
      ordersNumber: toNumber(item.orders_number),
      ordersPrice: toNumber(item.orders_price),
      actualAmount: toNumber(item.actual_amount),
      baseUnits: item.base_units ?? null,
      conversionNumber: toNumber(item.conversion_number),
      raw: item as unknown as object,
    };
  }

  // ------------------------------------------------------------------ 水位
  // ------------------------------------------------------------- reset dati

  /**
   * Azzera i dati di esercizio per passare a un altro gestionale
   * (nuovo numero seriale + password).
   *
   * Le credenziali salvate NON vengono toccate: si aggiornano dalla pagina Integrazione.
   * L'utente amministratore resta; gli account fornitore vengono rimossi perche'
   * legati all'anagrafica del vecchio gestionale.
   */
  async resetData(): Promise<ResetDataResult> {
    const deleted = await this.prisma.$transaction(
      async (tx) => {
        // Ordine dettato dalle foreign key: prima i figli, poi i padri.
        const shipmentItems = await tx.shipmentItem.deleteMany({});
        const shipments = await tx.shipment.deleteMany({});
        const orderItems = await tx.orderItem.deleteMany({});
        const orders = await tx.order.deleteMany({});
        const products = await tx.product.deleteMany({});
        // Gli utenti fornitore puntano a suppliers: vanno rimossi prima dell'anagrafica.
        const accounts = await tx.user.deleteMany({ where: { role: { not: 'admin' } } });
        const suppliers = await tx.supplier.deleteMany({});
        const logs = await tx.syncLog.deleteMany({});
        const watermarks = await tx.syncWatermark.deleteMany({});
        await tx.setting.deleteMany({ where: { key: 'demo.mode' } });
        return {
          shipments: shipments.count,
          shipmentItems: shipmentItems.count,
          orders: orders.count,
          orderItems: orderItems.count,
          products: products.count,
          suppliers: suppliers.count,
          accounts: accounts.count,
          logs: logs.count,
          watermarks: watermarks.count,
        };
      },
      { timeout: 60000 },
    );

    this.logger.warn(
      `Dati azzerati: ${deleted.orders} ordini, ${deleted.products} articoli, ${deleted.suppliers} fornitori, ${deleted.accounts} account fornitore`,
    );
    // Il log va scritto dopo l'azzeramento, altrimenti verrebbe cancellato subito.
    await this.log('product', 'ok', 'Dati azzerati per cambio gestionale', deleted);
    return { deleted };
  }


  async getWatermark(): Promise<Date | null> {
    const row = await this.prisma.syncWatermark.findUnique({ where: { key: WATERMARK_KEY } });
    return row?.value ?? null;
  }

  async setWatermark(value: Date | null): Promise<void> {
    if (!value) return;
    await this.prisma.syncWatermark.upsert({
      where: { key: WATERMARK_KEY },
      create: { key: WATERMARK_KEY, value },
      update: { value },
    });
  }

  async log(type: string, status: 'ok' | 'fail', message: string, payload?: unknown): Promise<void> {
    await this.prisma.syncLog.create({
      data: { type, status, message, payload: (payload ?? undefined) as never },
    });
  }
}
