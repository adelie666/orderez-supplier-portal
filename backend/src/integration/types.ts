/**
 * 上游 ERP（新网关 / 旧 ERP）原始记录 → 内部规范化模型
 * 字段名对齐规划 §5.1 / §5.2，未确认字段用 optional 保留，联调时补全。
 */

export interface RawSupplier {
  client_id?: string | number;
  client_name?: string;
  erp_base_client_id?: string | number;
  client_num?: string;
  contact?: string;
  mobile?: string;
  status?: string | number;
}

export interface RawOrder {
  orders_id?: string | number;
  orders_num?: string;
  status?: string;
  status_name?: string;
  pay_status?: string;
  pay_status_name?: string;
  client_name?: string;
  client_num?: string;
  discount_total?: string | number;
  freight?: string | number;
  create_date?: string | number;
  update_date?: string | number;
  consignee?: string;
  consignee_contact?: string;
  consignee_phone?: string;
  consignee_address?: string;
}

export interface RawOrderItem {
  orders_list_id?: string | number;
  goods_id?: string | number;
  options_id?: string | number;
  goods_num?: string;
  goods_name?: string;
  options_name?: string;
  options_goods_num?: string;
  supplier_name?: string;
  orders_number?: string | number;
  orders_price?: string | number;
  actual_amount?: string | number;
  base_units?: string;
  conversion_number?: string | number;
}

export interface RawGoods {
  goods_id?: string | number;
  options_id?: string | number;
  goods_num?: string;
  options_goods_num?: string;
  goods_name?: string;
  options_name?: string;
  supplier_name?: string;
  /** Campi personalizzati dell'ERP (field_1..field_6), solo quelli valorizzati. */
  custom_fields?: Record<string, string>;
  whole_price?: string | number;
  purchase_price?: string | number;
  base_units?: string;
  conversion_number?: string | number;
  picture?: string | null;
}

export interface RawDelivery {
  ships_num?: string;
  orders_num?: string;
  status?: string;
  /** Data documento in ora di Pechino (yyyy-MM-dd HH:mm:ss) */
  ships_date?: string;
}

export interface PageRequest {
  page: number;
  pageSize: number;
}

export interface ListResult<T> {
  rows: T[];
  total?: number;
  /** Righe grezze restituite dall'ERP (prima dell'espansione delle varianti). */
  rawCount?: number;
}

export interface AddAllShipsRequest {
  orderSn: string;
  forceStatus?: string;
  consignmentNO?: string;
  consignmentName?: string;
  /** 发货单备注 —— 门户把「谁点的发货」写在这里，上游 ERP 的操作日志/发货单能看到 */
  consignmentRemark?: string;
}

export interface AddAllShipsResult {
  ok: boolean;
  shipsSn?: string;
  message?: string;
  raw?: unknown;
}

/**
 * 上游 ERP（{base}/home/index/erpIndex）原始字段。
 * 以下键名来自实际接口响应，不是文档猜测。
 */
export interface ErpSupplier {
  guid?: string | number;
  client_name?: string;
  client_num?: string | number;
  contact?: string;
  mobile?: string;
  phone?: string;
  email?: string;
  address?: string;
  remark?: string;
}

export interface ErpOrderLine {
  orders_list_id?: string | number;
  skuNo?: string;
  options_goods_num?: string;
  Name?: string;
  Coding?: string;
  ContentPrice?: string | number;
  ContentNumber?: string | number;
  ContentPurchasePrice?: string | number;
  ActualAmount?: string | number;
  Units?: string;
  orders_units_name?: string;
  ConversionNumber?: string | number;
  StockGuid?: string;
}

/** getOrderContent：订单头 + body[] 明细 */
/** getOrderList：订单头（列表） */
export interface ErpOrder {
  OrderSN?: string;
  OrderDate?: number;
  OrderStatus?: string;
  PayStatus?: string;
  OrderTotal?: string | number;
  ClientNO?: string | number;
  ClientGUID?: string | number;
  OrderUpdateTime?: string;
  OrderRemark?: string;
  OrderSendType?: string;
}

/** getOrderContent：订单头 + body[] 明细 */
export interface ErpOrderContent extends ErpOrder {
  ClientName?: string;
  CreateDate?: string;
  UpdateDate?: string;
  OrderPayStatus?: string;
  OrderFreight?: string | number;
  DiscountTotal?: string | number;
  OrderReceiveName?: string;
  OrderReceivePhone?: string;
  OrderReceiveCompany?: string;
  OrderReceiveAdd?: string;
  OrderReceiveAddTwo?: string;
  Province?: string;
  City?: string;
  District?: string;
  body?: ErpOrderLine[];
  Ships?: unknown[];
}

export interface ErpGoodsMulti {
  options_id?: string | number;
  options_goods_num?: string;
  multiName?: string;
  barcode?: string;
  whole?: string | number;
  selling?: string | number;
  purchase?: string | number;
}

export interface ErpGoods {
  guid?: string | number;
  name?: string;
  coding?: string;
  supplier_name?: string;
  /** Campi personalizzati configurati in "系统初始化" (label non esposte dall'API). */
  field_1?: string;
  field_2?: string;
  field_3?: string;
  field_4?: string;
  field_5?: string;
  field_6?: string;
  units?: string;
  conversionnumber?: string | number;
  /** Percorso relativo dell'immagine articolo (sull'host immagini configurato). */
  goods_picture?: string | null;
  multi?: ErpGoodsMulti[];
}

/** getShipsList：出库/发货单 */
export interface ErpShip {
  OrdersSn?: string;
  ShipsSN?: string;
  ships_num?: string;
  orders_num?: string;
  ShipsStatus?: string;
  status?: string;
  ShipsDate?: string;
  ships_date?: string;
}

/** 上游 ERP 分页返回：{ page, page_size, total, total_page, data[] } */
export interface ErpPaged<T> {
  page?: number;
  page_size?: number;
  total?: number;
  total_page?: number;
  data?: T[];
}
