import { api, downloadFile, downloadFilePost } from './client';
import type { Account, Order, Paged, Product, Shipment, Supplier, SyncLog, User } from '../types';
import { todayRome } from '../utils/format';

export async function login(username: string, password: string) {
  const { data } = await api.post<{ token: string; user: User }>('/auth/login', { username, password });
  return data;
}

export async function me() {
  const { data } = await api.get<User>('/auth/me');
  return data;
}

export async function changePassword(oldPassword: string, newPassword: string) {
  await api.post('/auth/password', { oldPassword, newPassword });
}

export async function dashboard() {
  const { data } = await api.get<{
    kpi: { toShip: number; shippedToday: number; monthAmount: number; monthQty: number };
    queue: { stockup: number; pending: number; failedShipments: number; awaitingReceipt: number };
    topProducts: {
      goodsNum: string;
      goodsName: string;
      optionsName: string;
      imageUrl?: string | null;
      qty: number;
      amount: number;
    }[];
  }>('/dashboard');
  return data;
}

export async function listOrders(params: Record<string, unknown>) {
  const { data } = await api.get<Paged<Order>>('/orders', { params });
  return data;
}

/** Ultimo ordine visibile all'utente, per gli avvisi vocali del frontend. */
export async function latestOrderNotification() {
  const { data } = await api.get<{ latestOrderId: number | null; latestOrderAt: string | null }>(
    '/orders/latest-notification',
  );
  return data;
}

export async function getOrder(id: number) {
  const { data } = await api.get<Order>(`/orders/${id}`);
  return data;
}

/** Ordine precedente / successivo nella lista, per la navigazione avanti-indietro. */
export async function getOrderNeighbors(id: number) {
  const { data } = await api.get<{
    prev: { id: number; erpOrdersNum: string } | null;
    next: { id: number; erpOrdersNum: string } | null;
  }>(`/orders/${id}/neighbors`);
  return data;
}

/** Documento di spedizione già presente sul gestionale per questo ordine (solo lettura). */
export async function getErpShipment(orderId: number) {
  const { data } = await api.get<{ ships_num?: string; orders_num?: string; status?: string } | null>(
    `/orders/${orderId}/erp-shipment`,
  );
  return data;
}

export async function shipOrder(
  id: number,
  payload: { consignmentNo?: string; consignmentName?: string; remark?: string },
) {
  const { data } = await api.post(`/orders/${id}/ship`, payload);
  return data;
}

export async function listShipments(params: Record<string, unknown>) {
  const { data } = await api.get<Paged<Shipment>>('/shipments', { params });
  return data;
}

export async function retryShipment(id: number) {
  const { data } = await api.post(`/shipments/${id}/retry`);
  return data;
}

export async function reportSummary(params: Record<string, unknown>) {
  const { data } = await api.get('/reports/summary', { params });
  return data;
}

export async function exportReport(params: Record<string, unknown>) {
  const from = String(params.dateFrom ?? 'inizio');
  const to = String(params.dateTo ?? 'oggi');
  await downloadFile('/reports/export', params, `report-spedizioni_${from}_${to}.xlsx`);
}

export async function exportOrders(payload: Record<string, unknown>) {
  await downloadFilePost('/orders/export', payload, `ordini_${todayRome()}.xlsx`);
}

export async function listSuppliers() {
  const { data } = await api.get<{ rows: Supplier[]; total: number }>('/suppliers');
  return data;
}

export async function syncSuppliers() {
  const { data } = await api.post('/suppliers/sync');
  return data;
}

export interface ProductPage {
  rows: Product[];
  total: number;
  page: number;
  pageSize: number;
  unmapped: number;
  catalogTotal: number;
}

/** Elenco articoli: l'amministratore vede tutto, il fornitore solo i propri. */
export async function listProducts(params: Record<string, unknown>) {
  const { data } = await api.get<ProductPage>('/products', { params });
  return data;
}

export async function listAccounts() {
  const { data } = await api.get<{ rows: Account[]; total: number }>('/accounts');
  return data;
}

export async function createAccount(payload: { username: string; password: string; supplierId: number }) {
  const { data } = await api.post<Account>('/accounts', payload);
  return data;
}

export async function updateAccount(id: number, payload: { status?: number; supplierId?: number }) {
  const { data } = await api.patch<Account>(`/accounts/${id}`, payload);
  return data;
}

export async function resetAccountPassword(id: number, password: string) {
  await api.post(`/accounts/${id}/password`, { password });
}

export async function deleteAccount(id: number) {
  await api.delete(`/accounts/${id}`);
}

export async function getSettings() {
  const { data } = await api.get('/settings');
  return data;
}

export async function saveSettings(payload: Record<string, string | undefined>) {
  const { data } = await api.put('/settings', payload);
  return data;
}


export async function testSettings() {
  const { data } = await api.post<{ ok: boolean; message: string; expiresIn?: number }>('/settings/test');
  return data;
}
export async function syncStatus() {
  const { data } = await api.get<{ watermark: string | null; logs: SyncLog[] }>('/sync/status');
  return data;
}

export async function syncLogs(params: Record<string, unknown>) {
  const { data } = await api.get<Paged<SyncLog>>('/sync/logs', { params });
  return data;
}

export async function pullOrders(payload: { lookbackDays?: number; full?: boolean } = {}) {
  const { data } = await api.post('/sync/orders', payload);
  return data;
}

export async function refreshOrders(days = 7) {
  const { data } = await api.post('/sync/refresh', { days });
  return data;
}

export async function syncCatalog() {
  const { data } = await api.post('/sync/catalog');
  return data;
}

export interface ResetResult {
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

/** Azzera i dati di esercizio per collegare un altro gestionale. */
export async function resetData() {
  const { data } = await api.post<ResetResult>('/sync/reset', { confirm: 'REINIZIALIZZA' });
  return data;
}

/** Importa dal gestionale le spedizioni registrate fuori dal portale (getShipsList). */
export async function syncShipments(days = 120) {
  const { data } = await api.post('/sync/shipments', { days });
  return data as { scanned: number; created: number; updated: number; unmatched: number; skipped: number };
}

export async function health() {
  const { data } = await api.get('/health');
  return data;
}
