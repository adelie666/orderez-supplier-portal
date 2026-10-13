import { Injectable, Logger } from '@nestjs/common';
import { ErpClient } from './erp.client';
import { formatBeijing } from '../common/time.util';
import { SUPPLIER_FIELD_KEYS } from '../common/supplier-match.util';
import {
  ErpGoods,
  ErpOrder,
  ErpOrderContent,
  ErpOrderLine,
  ErpPaged,
  ErpShip,
  ErpSupplier,
  ListResult,
  PageRequest,
  RawDelivery,
  RawGoods,
  RawOrder,
  RawOrderItem,
  RawSupplier,
} from './types';

/**
 * 只读适配层：把订货宝 ERP 的原始字段翻译成内部规范化模型（Raw*）。
 *
 * 早期版本假设读接口来自「新网关 gateway.shiju.cloud + X-Api-Key」，实测客户账号
 * 只有 erp.dhb168.com 的 sKey 接口，且读接口齐备，故改为复用 ErpClient。
 *
 * 分页：订货宝列表接口用 begin（偏移）+ step（条数，最大 1000）。
 */
const MAX_DELIVERY_PAGES = 20;

@Injectable()
export class GatewayClient {
  private readonly logger = new Logger(GatewayClient.name);

  constructor(private readonly erp: ErpClient) {}

  private pageParams(page: number, pageSize: number, base: 0 | 1 = 0) {
    return { begin: Math.max(0, (page - base) * pageSize), step: pageSize };
  }

  /** true quando le credenziali ERP sono configurate (l'ERP reale e' l'unica sorgente dati). */
  async isConfigured(): Promise<boolean> {
    return this.erp.isConfigured();
  }

  // ---------------------------------------------------------------- 供应商

  /** 供应商列表（getSupplierList）。page 从 0 起。 */
  async listSuppliers(req: PageRequest): Promise<ListResult<RawSupplier>> {
    const envelope = await this.erp.envelope<ErpSupplier[]>(
      'getSupplierList',
      // data_type 是 getSupplierList 的隐藏开关：1=未同步（默认，只有老档案）、
      // 2=已同步、3=全部。默认值会把新建的供应商整批漏掉（2026-10-08 实测：默认只回 16 条，
      // 传 3 才拿得到 后来新增的供应商），所以固定传 3。
      { ...this.pageParams(req.page, req.pageSize, 0), data_type: 3 },
    );
    return { rows: (envelope.rData ?? []).map(mapSupplier), total: Number(envelope.rTotal) || undefined };
  }

  // ------------------------------------------------------------------- 商品

  /** 商品列表（getGoodsList），多规格按 multi[] 摊平。page 从 0 起。 */
  async listGoods(req: PageRequest): Promise<ListResult<RawGoods>> {
    const envelope = await this.erp.envelope<ErpGoods[]>('getGoodsList', this.pageParams(req.page, req.pageSize, 0));
    const raw = envelope.rData ?? [];
    // Un articolo con piu' varianti si espande in piu' righe: il conteggio grezzo serve
    // per la paginazione, altrimenti il ciclo si ferma dopo la prima pagina.
    const rows = raw.flatMap(mapGoods);
    return { rows, total: Number(envelope.rTotal) || undefined, rawCount: raw.length };
  }

  // ------------------------------------------------------------------- 订单

  /**
   * 订单头列表（getOrderList）。page 从 1 起。
   *
   * 订货宝默认只返回「未下载（apiStatus=F）」且「后台配置状态（默认待出库）」的订单，
   * 且拉取后会自动标记已下载、同一订单不再出现。门户需要持续跟踪订单状态，
   * 因此固定 apiStatus=all / order_status_val=all，并用 updateGe/updateLe 做增量。
   */
  async listOrders(
    startTime: Date | null,
    endTime: Date | null,
    req: PageRequest,
  ): Promise<ListResult<RawOrder>> {
    const params: Record<string, unknown> = {
      ...this.pageParams(req.page, req.pageSize, 1),
      apiStatus: 'all',
      order_status_val: 'all',
    };
    if (startTime) params.updateGe = formatBeijing(startTime);
    if (endTime) params.updateLe = formatBeijing(endTime);

    const envelope = await this.erp.envelope<ErpOrder[]>('getOrderList', params);
    return { rows: (envelope.rData ?? []).map(mapOrderHead), total: Number(envelope.rTotal) || undefined };
  }

  /** 订单详情（getOrderContent）：一次拿到订单头 + 明细行。 */
  async getOrderContent(order: RawOrder): Promise<{ head: RawOrder; items: RawOrderItem[] }> {
    const orderSn = String(order.orders_num ?? '');
    const payload = await this.erp.call<ErpOrderContent>('getOrderContent', { orderSn });
    const head = mapOrderContent(payload, order);
    const items = (payload?.body ?? []).map(mapOrderLine);
    return { head, items };
  }

  // ----------------------------------------------------------------- 发货单

  /** 已有发货单（getShipsList），用于发货前的对账。 */
  /**
   * 已有发货单（getShipsList），用于发货前的对账。
   * 注意：rData 是分页对象 { page, total, data[] }，不是数组；早期版本按数组解析会导致对账永远失败。
   * 该接口用 page/page_size 分页，且默认 is_api=F（只返回未下载的），对账必须显式带 is_api=T,F。
   */
  async listDeliveries(startTime: Date, endTime: Date): Promise<RawDelivery[]> {
    const rows: ErpShip[] = [];
    const pageSize = 1000;
    for (let page = 1; page <= MAX_DELIVERY_PAGES; page += 1) {
      const envelope = await this.erp.envelope<ErpPaged<ErpShip> | ErpShip[]>('getShipsList', {
        page,
        page_size: pageSize,
        is_api: 'T,F',
        status: 'shipped,receivedin,received,cancelled',
        create_date_egt: formatBeijing(startTime),
        create_date_elt: formatBeijing(endTime),
      });
      const raw = envelope.rData;
      const batch = Array.isArray(raw) ? raw : raw?.data ?? [];
      rows.push(...batch);
      const total = Array.isArray(raw) ? batch.length : Number(raw?.total) || batch.length;
      if (!batch.length || rows.length >= total) break;
    }

    return rows.map((row) => ({
      ships_num: row.ShipsSN ?? row.ships_num ?? undefined,
      orders_num: row.OrdersSn ?? row.orders_num ?? undefined,
      status: row.ShipsStatus ?? row.status ?? undefined,
      ships_date: row.ShipsDate ?? row.ships_date ?? undefined,
    }));
  }
}

// --------------------------------------------------------------- 字段映射

function mapSupplier(row: ErpSupplier): RawSupplier {
  return {
    client_id: row.guid != null ? String(row.guid) : undefined,
    client_name: row.client_name ?? undefined,
    client_num: row.client_num != null ? String(row.client_num) : undefined,
    contact: row.contact || row.phone || undefined,
    mobile: row.mobile || undefined,
    status: undefined,
  };
}

function mapOrderHead(row: ErpOrder): RawOrder {
  const orderSn = row.OrderSN != null ? String(row.OrderSN) : undefined;
  return {
    orders_id: orderSn,
    orders_num: orderSn,
    status: row.OrderStatus ?? undefined,
    pay_status: row.PayStatus ?? undefined,
    client_num: row.ClientNO != null ? String(row.ClientNO) : undefined,
    discount_total: row.OrderTotal ?? undefined,
    create_date: row.OrderDate ?? undefined,
    update_date: row.OrderUpdateTime ?? undefined,
  };
}

function mapOrderContent(payload: ErpOrderContent, fallback: RawOrder): RawOrder {
  const orderSn = payload?.OrderSN != null ? String(payload.OrderSN) : fallback.orders_num;
  const address = [payload?.OrderReceiveAdd, payload?.OrderReceiveAddTwo].filter(Boolean).join(' ') || undefined;
  return {
    orders_id: orderSn,
    orders_num: orderSn,
    status: payload?.OrderStatus ?? fallback.status,
    status_name: undefined,
    pay_status: payload?.OrderPayStatus ?? payload?.PayStatus ?? fallback.pay_status,
    client_name: payload?.ClientName ?? fallback.client_name,
    client_num: payload?.ClientNO != null ? String(payload.ClientNO) : fallback.client_num,
    discount_total: payload?.OrderTotal ?? fallback.discount_total,
    freight: payload?.OrderFreight ?? undefined,
    create_date: payload?.CreateDate ?? fallback.create_date,
    update_date: payload?.UpdateDate ?? fallback.update_date,
    consignee: payload?.OrderReceiveCompany || payload?.OrderReceiveName || undefined,
    consignee_contact: payload?.OrderReceiveName || undefined,
    consignee_phone: payload?.OrderReceivePhone || undefined,
    consignee_address: address,
  };
}

function mapOrderLine(row: ErpOrderLine): RawOrderItem {
  // 订货宝销售明细不返回商品 guid / options_id，只能按「商品编码 + 规格编码」匹配，
  // 因此 products 也用 coding / options_goods_num 作为业务键。
  const goodsCode = row.Coding != null ? String(row.Coding) : undefined;
  const optionCode = row.options_goods_num != null ? String(row.options_goods_num) : row.skuNo;
  return {
    orders_list_id: row.orders_list_id != null ? String(row.orders_list_id) : undefined,
    goods_id: goodsCode,
    options_id: optionCode != null ? String(optionCode) : undefined,
    goods_num: goodsCode,
    options_goods_num: optionCode != null ? String(optionCode) : undefined,
    goods_name: row.Name ?? undefined,
    options_name: undefined,
    orders_number: row.ContentNumber ?? undefined,
    orders_price: row.ContentPrice ?? undefined,
    actual_amount: row.ActualAmount ?? undefined,
    base_units: row.orders_units_name || row.Units || undefined,
    conversion_number: row.ConversionNumber ?? undefined,
  };
}

function mapGoods(row: ErpGoods): RawGoods[] {
  const goodsCode = row.coding != null ? String(row.coding) : row.guid != null ? String(row.guid) : null;
  if (!goodsCode) return [];

  const multi = row.multi?.length ? row.multi : [{ options_goods_num: goodsCode }];
  return multi.map((option) => ({
    goods_id: goodsCode,
    options_id: option.options_goods_num != null ? String(option.options_goods_num) : goodsCode,
    goods_num: goodsCode,
    options_goods_num: option.options_goods_num ?? goodsCode,
    goods_name: row.name ?? null,
    options_name: option.multiName || null,
    supplier_name: row.supplier_name ?? undefined,
    custom_fields: pickCustomFields(row),
    whole_price: option.whole ?? null,
    purchase_price: option.purchase ?? null,
    base_units: row.units ?? null,
    conversion_number: row.conversionnumber ?? null,
    picture: row.goods_picture ?? null,
  }));
}

/** Estrae i campi personalizzati valorizzati: l'API espone solo i valori, non le etichette. */
export function pickCustomFields(row: ErpGoods): Record<string, string> | undefined {
  const fields: Record<string, string> = {};
  for (const key of SUPPLIER_FIELD_KEYS) {
    const value = row[key];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) fields[key] = trimmed;
  }
  return Object.keys(fields).length ? fields : undefined;
}
