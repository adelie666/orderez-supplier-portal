<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message, Modal } from 'ant-design-vue';
import {
  DownloadOutlined,
  PrinterOutlined,
  ReloadOutlined,
  SearchOutlined,
  SendOutlined,
  SettingOutlined,
} from '@ant-design/icons-vue';
import { exportOrders, listOrders, shipOrder } from '../api';
import type { Order } from '../types';
import { formatDate, formatDateTime, formatEur, payStatusLabel, shipmentStatusLabel } from '../utils/format';
import { useAuthStore } from '../stores/auth';
import StatusTag from '../components/StatusTag.vue';
import ColumnPicker from '../components/ColumnPicker.vue';
import OrderPrintModal from '../components/OrderPrintModal.vue';
import { useTableAreaHeight } from '../utils/useTableAreaHeight';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const { cardRef, filterRef, tableY } = useTableAreaHeight();

const rows = ref<Order[]>([]);

const loading = ref(false);
const exporting = ref(false);
const batchShipping = ref(false);
const printOpen = ref(false);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const selectedRowKeys = ref<number[]>([]);

const filters = reactive<{ keyword: string; status?: string; shipmentState?: string }>({
  keyword: '',
});
const range = ref<[string, string] | null>(null);

const statusOptions = [
  { value: 'pricing', label: 'In attesa di prezzo' },
  { value: 'pending', label: 'In attesa di approvazione' },
  { value: 'stockup', label: 'Da evadere' },
  { value: 'shipped', label: 'Da spedire' },
  { value: 'received', label: 'In attesa di ricezione' },
  { value: 'finished', label: 'Completato' },
  { value: 'forcedone', label: 'Completato forzatamente' },
  { value: 'cancelled', label: 'Annullato' },
];

/** Stato della spedizione locale (documento ERP / errore / attesa) */
const shipmentStateOptions = [
  { value: 'sent', label: 'Trasmessa' },
  { value: 'awaiting', label: 'In attesa di ricezione' },
  { value: 'failed', label: 'In errore' },
];

/* ------------------------------------------------------------------ colonne */

interface ColDef {
  key: string;
  title: string;
  width: number;
  align?: 'left' | 'right';
  className?: string;
  adminOnly?: boolean;
}

/**
 * Catalogo completo dei campi disponibili sull'ordine: la tabella ne mostra
 * solo una parte e l'ordine e' configurabile dall'utente (pulsante "Colonne").
 * "#", "Numero ordine" e la colonna azioni restano sempre fissi.
 */
const COLUMN_CATALOG: ColDef[] = [
  { key: 'clientName', title: 'Cliente', width: 150 },
  { key: 'supplierName', title: 'Fornitore', width: 150, adminOnly: true },
  { key: 'clientNum', title: 'N. cliente', width: 110 },
  { key: 'consignee', title: 'Destinatario', width: 150 },
  { key: 'consigneeContact', title: 'Contatto', width: 130 },
  { key: 'consigneePhone', title: 'Telefono', width: 130 },
  { key: 'consigneeAddress', title: 'Indirizzo', width: 220 },
  { key: 'items', title: 'Righe', width: 72, align: 'right', className: 'oe-num' },
  { key: 'shipment', title: 'Spedizione', width: 190, className: 'oe-col-ship' },
  { key: 'status', title: 'Stato', width: 190, className: 'oe-col-status' },
  { key: 'payStatus', title: 'Pagamento', width: 120 },
  { key: 'discountTotal', title: 'Sconto', width: 110, align: 'right', className: 'oe-num' },
  { key: 'freight', title: 'Trasporto', width: 110, align: 'right', className: 'oe-num' },
  { key: 'erpCreateDate', title: 'Data ordine', width: 116 },
  { key: 'erpUpdateDate', title: 'Aggiornato', width: 116 },
  { key: 'orderTime', title: 'Data e ora ordine (IT)', width: 150 },
];

const DEFAULT_VISIBLE = [
  'clientName',
  'supplierName',
  'consignee',
  'items',
  'shipment',
  'status',
  'payStatus',
  'erpCreateDate',
  'orderTime',
];

const COLS_STORAGE = 'orderez-orders-columns-v1';

interface ColState {
  order: string[];
  hidden: string[];
}

function readColState(): ColState | null {
  try {
    const raw = localStorage.getItem(COLS_STORAGE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ColState>;
    return {
      order: Array.isArray(parsed.order) ? parsed.order.filter((k) => typeof k === 'string') : [],
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter((k) => typeof k === 'string') : [],
    };
  } catch {
    return null;
  }
}

function defaultColState(): ColState {
  return {
    order: [],
    hidden: COLUMN_CATALOG.filter((c) => !DEFAULT_VISIBLE.includes(c.key)).map((c) => c.key),
  };
}

const colState = reactive<ColState>(readColState() ?? defaultColState());

function persistCols() {
  localStorage.setItem(COLS_STORAGE, JSON.stringify({ order: colState.order, hidden: colState.hidden }));
}

/** Colonne disponibili per il ruolo corrente (il fornitore non vede "Fornitore"). */
const availableColumns = computed(() => COLUMN_CATALOG.filter((c) => !c.adminOnly || auth.isAdmin));

/** Ordine effettivo: prima l'ordine salvato, poi le colonne nuove del catalogo. */
const orderedKeys = computed(() => {
  const known = availableColumns.value.map((c) => c.key);
  const saved = colState.order.filter((k) => known.includes(k));
  const rest = known.filter((k) => !saved.includes(k));
  return [...saved, ...rest];
});

const visibleKeys = computed(() => orderedKeys.value.filter((k) => !colState.hidden.includes(k)));

function columnTitle(key: string): string {
  return COLUMN_CATALOG.find((c) => c.key === key)?.title ?? key;
}

function toggleColumn(key: string) {
  const index = colState.hidden.indexOf(key);
  if (index >= 0) colState.hidden.splice(index, 1);
  else colState.hidden.push(key);
  persistCols();
}

function moveColumn(key: string, direction: -1 | 1) {
  const keys = [...orderedKeys.value];
  const index = keys.indexOf(key);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= keys.length) return;
  [keys[index], keys[next]] = [keys[next], keys[index]];
  colState.order = keys;
  persistCols();
}

function resetColumns() {
  const fresh = defaultColState();
  colState.order = fresh.order;
  colState.hidden = fresh.hidden;
  persistCols();
  message.success('Colonne ripristinate');
}

/** Voci del pannello colonne (ordine corrente + etichetta). */
const colItems = computed(() => orderedKeys.value.map((key) => ({ key, title: columnTitle(key) })));

/** Riordino tramite trascinamento: salva l'ordine completo restituito dal pannello. */
function applyColumnOrder(keys: string[]) {
  colState.order = keys;
  persistCols();
}

const columns = computed(() => {
  const list: Record<string, unknown>[] = [
    { title: '', key: '_index', width: 64, fixed: 'left', className: 'oe-col-index' },
    { title: 'Numero ordine', key: 'erpOrdersNum', width: 176, fixed: 'left' },
  ];
  for (const key of visibleKeys.value) {
    const def = availableColumns.value.find((c) => c.key === key);
    if (!def) continue;
    list.push({ title: def.title, key: def.key, width: def.width, align: def.align, className: def.className });
  }
  list.push({ title: '', key: 'actions', width: 88, fixed: 'right', className: 'oe-col-actions' });
  return list;
});

// scroll.x = somma esatta delle larghezze: evita che la colonna azioni copra i dati
const scrollX = computed(() => columns.value.reduce((sum, col) => sum + Number(col.width ?? 0), 0));

/* ------------------------------------------------------------------- dati */

const pageIds = computed(() => rows.value.map((row) => row.id));
const allSelected = computed(
  () => pageIds.value.length > 0 && pageIds.value.every((id) => selectedRowKeys.value.includes(id)),
);
const someSelected = computed(() => selectedRowKeys.value.length > 0 && !allSelected.value);

const rowSelection = computed(() => ({
  selectedRowKeys: selectedRowKeys.value,
  preserveSelectedRowKeys: true,
  onChange: (keys: (string | number)[]) => {
    selectedRowKeys.value = keys.map(Number);
  },
}));

function toggleAll(event: { target: { checked: boolean } }) {
  if (event.target.checked) {
    selectedRowKeys.value = Array.from(new Set([...selectedRowKeys.value, ...pageIds.value]));
  } else {
    const current = new Set(pageIds.value);
    selectedRowKeys.value = selectedRowKeys.value.filter((id) => !current.has(id));
  }
}

/** Documento di spedizione collegato all'ordine: e' l'esito del ritorno a Dinghuobao. */
function shipmentInfo(record: Order) {
  const shipment = record.shipments?.[0];
  if (!shipment) return null;
  const sn = shipment.erpShipsSn || '';
  if (shipment.status === 'receivedin') return { label: 'Trasmessa', color: 'green', sn };
  if (shipment.status === 'pending') return { label: 'In corso', color: 'blue', sn };
  if (shipment.status === 'failed') return { label: 'Errore', color: 'red', sn };
  return { label: shipmentStatusLabel(shipment.status), color: 'default', sn };
}

function cellText(record: Order, key: string): string {
  const value = (record as unknown as Record<string, unknown>)[key];
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function bodyParams(): Record<string, unknown> {
  const params: Record<string, unknown> = {
    page: page.value,
    pageSize: pageSize.value,
  };
  if (filters.keyword.trim()) params.keyword = filters.keyword.trim();
  if (filters.status) params.status = filters.status;
  if (filters.shipmentState) params.shipmentState = filters.shipmentState;
  if (range.value?.[0]) params.dateFrom = range.value[0];
  if (range.value?.[1]) params.dateTo = range.value[1];
  return params;
}

async function load() {
  loading.value = true;
  try {
    const data = await listOrders(bodyParams());
    rows.value = data.rows;
    total.value = data.total;
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    loading.value = false;
  }
}

function search() {
  page.value = 1;
  selectedRowKeys.value = [];
  load();
}

function reset() {
  filters.keyword = '';
  filters.status = undefined;
  filters.shipmentState = undefined;
  range.value = null;
  page.value = 1;
  selectedRowKeys.value = [];
  load();
}

function onPageChange(next: number, size: number) {
  page.value = next;
  pageSize.value = size;
  load();
}

function openOrder(record: Order) {
  router.push(`/orders/${record.id}`);
}

/** La Panoramica apre la lista con un filtro gia' applicato (?status= / ?shipmentState=). */
function applyQueryFilters() {
  const { status, shipmentState } = route.query;
  if (typeof status === 'string' && statusOptions.some((o) => o.value === status)) filters.status = status;
  if (typeof shipmentState === 'string' && shipmentStateOptions.some((o) => o.value === shipmentState)) {
    filters.shipmentState = shipmentState;
  }
}

/* ---------------------------------------------------------------- azioni */

/** Export: gli ordini selezionati, oppure tutti quelli che rispettano i filtri correnti. */
async function runExport(ids?: number[]) {
  exporting.value = true;
  try {
    const payload: Record<string, unknown> = bodyParams();
    delete payload.page;
    delete payload.pageSize;
    if (ids?.length) payload.ids = ids;
    await exportOrders(payload);
    message.success('Export Excel generato');
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    exporting.value = false;
  }
}

/** Spedizione in blocco: invia a Dinghuobao gli ordini selezionati, uno per volta. */
async function doBatchShip(ids: number[]) {
  batchShipping.value = true;
  let done = 0;
  const errors: string[] = [];
  try {
    for (const id of ids) {
      try {
        await shipOrder(id, {});
        done += 1;
      } catch (error) {
        const num = rows.value.find((r) => r.id === id)?.erpOrdersNum ?? `#${id}`;
        errors.push(`${num}: ${(error as Error).message}`);
      }
    }
  } finally {
    batchShipping.value = false;
  }
  if (done) message.success(`${done} spedizioni inviate a Dinghuobao`);
  if (errors.length) {
    message.warning(`${errors.length} ordini non spediti — ${errors[0]}`);
  }
  selectedRowKeys.value = [];
  await load();
}

function runBatchShip() {
  const ids = [...selectedRowKeys.value];
  if (!ids.length) return;
  Modal.confirm({
    title: 'Spedisci gli ordini selezionati',
    content: `Verranno inviati a Dinghuobao ${ids.length === 1 ? '1 ordine' : `${ids.length} ordini`}. Gli ordini non in stato Da evadere o gia' spediti verranno rifiutati dal gestionale.`,
    okText: 'Spedisci',
    cancelText: 'Annulla',
    onOk: () => doBatchShip(ids),
  });
}

/** Stampa in blocco: apre le schede degli ordini selezionati in una modale, in pagina. */
function runBatchPrint() {
  if (!selectedRowKeys.value.length) return;
  printOpen.value = true;
}

onMounted(() => {
  applyQueryFilters();
  load();
});
</script>

<template>
  <div class="oe-list-page oe-list-page--fill">
    <div class="oe-bread-area">
      <div class="oe-bread-left">
        <h1 class="oe-bread-title">{{ auth.isSupplier ? 'I miei ordini' : 'Ordini' }}</h1>
        <span class="oe-bread-sub">Ordini da evadere e storico completo.</span>
      </div>
      <div class="oe-bread-actions">
        <a-popover trigger="click" placement="bottomRight">
          <a-button>
            <template #icon><SettingOutlined class="oe-gear-icon" /></template>
            Colonne
          </a-button>
          <template #content>
            <ColumnPicker
              :items="colItems"
              :hidden="colState.hidden"
              @toggle="toggleColumn"
              @move="moveColumn"
              @reorder="applyColumnOrder"
              @reset="resetColumns"
            />
          </template>
        </a-popover>
        <a-button :loading="loading" @click="load">
          <template #icon><ReloadOutlined /></template>
          Aggiorna
        </a-button>
      </div>
    </div>

    <div class="oe-page-body">
      <div class="oe-page-scroll">
        <div ref="cardRef" class="oe-main-card">
          <div ref="filterRef" class="oe-filter-wrap">
            <div class="oe-fline oe-fline--actions">
              <div class="oe-g--2">
                <a-input
                  v-model:value="filters.keyword"
                  placeholder="Numero ordine, cliente, destinatario"
                  allow-clear
                  @press-enter="search"
                >
                  <template #prefix><SearchOutlined /></template>
                </a-input>
              </div>
              <div>
                <a-select
                  v-model:value="filters.status"
                  placeholder="Tutti gli stati"
                  allow-clear
                  :options="statusOptions"
                />
              </div>
              <div>
                <a-select
                  v-model:value="filters.shipmentState"
                  placeholder="Tutte"
                  allow-clear
                  :options="shipmentStateOptions"
                />
              </div>
              <div class="oe-g--2">
                <a-range-picker v-model:value="range" value-format="YYYY-MM-DD" style="width: 100%" />
              </div>
              <div class="oe-filter-actions">
                <a-button @click="reset">
                  <template #icon><ReloadOutlined /></template>
                  Azzera
                </a-button>
                <a-button type="primary" @click="search">
                  <template #icon><SearchOutlined /></template>
                  Cerca
                </a-button>
              </div>
            </div>
          </div>

          <a-table
            row-key="id"
            class="oe-list-table oe-list-table--zebra oe-list-table--compact"
            :columns="columns"
            :data-source="rows"
            :loading="loading"
            :pagination="false"
            :row-selection="rowSelection"
            :scroll="{ x: scrollX, y: tableY }"
          >
            <template #headerCell="{ column }">
              <template v-if="column.key === '_index'">
                <a-popover trigger="click" placement="bottomLeft">
                  <span class="oe-col-hash" title="Scegli le colonne">
                    <SettingOutlined />
                  </span>
                  <template #content>
                    <ColumnPicker
                      :items="colItems"
                      :hidden="colState.hidden"
                      @toggle="toggleColumn"
                      @move="moveColumn"
                      @reorder="applyColumnOrder"
                      @reset="resetColumns"
                    />
                  </template>
                </a-popover>
              </template>
              <template v-else>{{ column.title }}</template>
            </template>
            <template #bodyCell="{ column, record, index }">
              <template v-if="column.key === '_index'">
                {{ (page - 1) * pageSize + index + 1 }}
              </template>
              <template v-else-if="column.key === 'erpOrdersNum'">
                <a class="oe-cell-link" @click="openOrder(record)">{{ record.erpOrdersNum }}</a>
              </template>
              <template v-else-if="column.key === 'actions'">
                <a class="oe-cell-link" @click="openOrder(record)">Apri</a>
              </template>
              <template v-else-if="column.key === 'status'">
                <StatusTag kind="order" :status="record.status" />
              </template>
              <template v-else-if="column.key === 'payStatus'">
                <span class="oe-cell-sub">{{ payStatusLabel(record.payStatus) || '—' }}</span>
              </template>
              <template v-else-if="column.key === 'items'">{{ record._count?.items ?? 0 }}</template>
              <template v-else-if="column.key === 'shipment'">
                <template v-if="shipmentInfo(record)">
                  <a-tag :color="shipmentInfo(record)?.color">{{ shipmentInfo(record)?.label }}</a-tag>
                  <span v-if="shipmentInfo(record)?.sn" class="oe-cell-sub">{{ shipmentInfo(record)?.sn }}</span>
                </template>
                <span v-else class="oe-cell-sub">—</span>
              </template>
              <template v-else-if="column.key === 'discountTotal'">{{ formatEur(record.discountTotal) }}</template>
              <template v-else-if="column.key === 'freight'">{{ formatEur(record.freight) }}</template>
              <template v-else-if="column.key === 'erpCreateDate'">{{ formatDate(record.erpCreateDate) }}</template>
              <template v-else-if="column.key === 'orderTime'">{{ formatDateTime(record.erpCreateDate) }}</template>
              <template v-else-if="column.key === 'erpUpdateDate'">{{ formatDate(record.erpUpdateDate) }}</template>
              <template v-else>{{ cellText(record, String(column.key)) }}</template>
            </template>
          </a-table>
        </div>
      </div>

      <div class="oe-footer-bar">
        <div class="oe-footer-left">
          <a-checkbox :checked="allSelected" :indeterminate="someSelected" @change="toggleAll">
            Seleziona pagina
          </a-checkbox>
          <span v-if="selectedRowKeys.length" class="oe-footer-selected">
            {{ selectedRowKeys.length }} selezionati
          </span>
          <a-button
            type="primary"
            :disabled="!selectedRowKeys.length"
            :loading="batchShipping"
            @click="runBatchShip"
          >
            <template #icon><SendOutlined /></template>
            Spedisci selezionati
          </a-button>
          <a-button
            :disabled="!selectedRowKeys.length"
            :loading="exporting"
            @click="runExport(selectedRowKeys)"
          >
            <template #icon><DownloadOutlined /></template>
            Esporta selezionati
          </a-button>
          <a-button :disabled="!selectedRowKeys.length" @click="runBatchPrint">
            <template #icon><PrinterOutlined /></template>
            Stampa selezionati
          </a-button>
          <a-button :loading="exporting" @click="runExport()">
            <template #icon><DownloadOutlined /></template>
            Esporta tutto
          </a-button>
        </div>
        <div class="oe-footer-right">
          <span class="oe-footer-total">{{ total }} ordini</span>
          <a-pagination
            :current="page"
            :page-size="pageSize"
            :total="total"
            :show-size-changer="true"
            :page-size-options="['10', '20', '50', '100']"
            @change="onPageChange"
            @show-size-change="onPageChange"
          />
        </div>
      </div>
    </div>

    <!-- Stampa ordini in pagina (uno o piu'), senza aprire un'altra scheda. -->
    <OrderPrintModal v-model:open="printOpen" :order-ids="selectedRowKeys" />
  </div>
</template>
