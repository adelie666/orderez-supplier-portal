export type Role = 'admin' | 'supplier';

export interface User {
  id: number;
  username: string;
  role: Role;
  supplierId: number | null;
  supplierName?: string | null;
  sub?: number;
}

export interface OrderItem {
  id: number;
  goodsNum?: string | null;
  goodsName?: string | null;
  optionsName?: string | null;
  supplierName?: string | null;
  ordersNumber?: string | number | null;
  ordersPrice?: string | number | null;
  actualAmount?: string | number | null;
  imageUrl?: string | null;
  baseUnits?: string | null;
}

export interface ShipmentSummary {
  id: number;
  status: string;
  erpShipsSn?: string | null;
  remark?: string | null;
  shippedAt?: string | null;
}

export interface Order {
  id: number;
  erpOrdersId: string;
  erpOrdersNum: string;
  supplierId?: number | null;
  supplierName?: string | null;
  clientName?: string | null;
  clientNum?: string | null;
  status?: string | null;
  statusName?: string | null;
  payStatus?: string | null;
  consignee?: string | null;
  consigneeContact?: string | null;
  consigneePhone?: string | null;
  consigneeAddress?: string | null;
  discountTotal?: string | number | null;
  freight?: string | number | null;
  erpCreateDate?: string | null;
  items?: OrderItem[];
  shipments?: ShipmentSummary[];
  _count?: { items: number };
}

export interface ShipmentItem {
  id: number;
  goodsNum?: string | null;
  goodsName?: string | null;
  optionsName?: string | null;
  qtyShipped: string | number;
  purchasePrice: string | number;
  amountEur: string | number;
}

export interface Shipment {
  id: number;
  orderId: number;
  supplierId?: number | null;
  erpShipsSn?: string | null;
  shippedAt: string;
  status: string;
  consignmentNo?: string | null;
  consignmentName?: string | null;
  attempts?: number;
  lastError?: string | null;
  order?: Pick<Order, 'id' | 'erpOrdersNum' | 'clientName'>;
  supplier?: { id: number; supplierName: string };
  operator?: { id: number; username: string };
  items?: ShipmentItem[];
  _count?: { items: number };
}

export interface Product {
  id: number;
  erpGoodsId: string;
  erpOptionsId: string;
  goodsNum?: string | null;
  goodsName?: string | null;
  optionsName?: string | null;
  supplierName?: string | null;
  wholePrice?: string | number | null;
  purchasePrice?: string | number | null;
  baseUnits?: string | null;
  conversionNumber?: string | number | null;
  imageUrl?: string | null;
  syncedAt?: string | null;
}

export interface Supplier {
  id: number;
  supplierName: string;
  clientNum?: string | null;
  contact?: string | null;
  mobile?: string | null;
  status?: string | null;
  _count?: { orders: number; users: number; shipments: number };
}

export interface Account {
  id: number;
  username: string;
  role: Role;
  status: number;
  supplierId?: number | null;
  supplier?: { id: number; supplierName: string } | null;
  createdAt?: string;
}

export interface SyncLog {
  id: number;
  type?: string | null;
  status?: string | null;
  message?: string | null;
  createdAt: string;
}

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}
