<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import {
  ArrowLeftOutlined,
  LeftOutlined,
  PrinterOutlined,
  RightOutlined,
  SettingOutlined,
} from '@ant-design/icons-vue';
import { getErpShipment, getOrder, getOrderNeighbors, shipOrder } from '../api';
import type { Order } from '../types';
import { formatDate, formatDateTime, formatEur, formatQty, orderStatusLabel, shipmentStatusLabel } from '../utils/format';
import StatusTag from '../components/StatusTag.vue';
import ColumnPicker from '../components/ColumnPicker.vue';
import OrderPrintModal from '../components/OrderPrintModal.vue';
import ProductThumb from '../components/ProductThumb.vue';

const route = useRoute();
const router = useRouter();

const order = ref<Order | null>(null);
const loading = ref(true);
const shipping = ref(false);
const shipOpen = ref(false);
const printOpen = ref(false);
/** Documento di spedizione già presente sul gestionale (solo se l'ordine non è spedibile qui). */
const erpShipment = ref<{ ships_num?: string; orders_num?: string; status?: string } | null>(null);
const shipForm = reactive({ consignmentNo: '', consignmentName: '', remark: '' });

interface FieldDef {
  key: string;
  label: string;
}

/** Campi della scheda ordine: Sconto/Trasporto sono nascosti di default (due righe). */
const INFO_FIELDS: FieldDef[] = [
  { key: 'clientName', label: 'Cliente' },
  { key: 'clientNum', label: 'Codice cliente' },
  { key: 'supplierName', label: 'Fornitore' },
  { key: 'consignee', label: 'Destinatario' },
  { key: 'consigneePhone', label: 'Telefono' },
  { key: 'consigneeAddress', label: 'Indirizzo' },
  { key: 'discountTotal', label: 'Sconto' },
  { key: 'freight', label: 'Trasporto' },
];

const INFO_STORAGE = 'orderez-order-info-hidden-v1';
const INFO_DEFAULT_HIDDEN = ['discountTotal', 'freight'];

function readHidden(key: string, fallback: string[]): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [...fallback];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : [...fallback];
  } catch {
    return [...fallback];
  }
}

const infoHidden = ref<string[]>(readHidden(INFO_STORAGE, INFO_DEFAULT_HIDDEN));

function toggleInfo(key: string) {
  const index = infoHidden.value.indexOf(key);
  if (index >= 0) infoHidden.value.splice(index, 1);
  else infoHidden.value.push(key);
  localStorage.setItem(INFO_STORAGE, JSON.stringify(infoHidden.value));
}

function resetInfoFields() {
  infoOrder.value = [];
  writeOrder(INFO_ORDER_STORAGE, []);
  infoHidden.value = [...INFO_DEFAULT_HIDDEN];
  localStorage.setItem(INFO_STORAGE, JSON.stringify(infoHidden.value));
}

const INFO_ORDER_STORAGE = 'orderez-order-info-order-v1';

/** Ordine dei campi salvato dall'utente (trascinamento o frecce). */
function readOrder(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

const infoOrder = ref<string[]>(readOrder(INFO_ORDER_STORAGE));

function writeOrder(storageKey: string, keys: string[]) {
  localStorage.setItem(storageKey, JSON.stringify(keys));
}

function orderList(catalog: { key: string }[], saved: string[]): string[] {
  const known = catalog.map((c) => c.key);
  const head = saved.filter((k) => known.includes(k));
  const rest = known.filter((k) => !head.includes(k));
  return [...head, ...rest];
}

const orderedInfoFields = computed(() =>
  orderList(INFO_FIELDS, infoOrder.value).map((k) => INFO_FIELDS.find((f) => f.key === k)!),
);

const infoItems = computed(() => orderedInfoFields.value.map((f) => ({ key: f.key, title: f.label })));

function moveInfoField(key: string, direction: -1 | 1) {
  const keys = orderList(INFO_FIELDS, infoOrder.value);
  const index = keys.indexOf(key);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= keys.length) return;
  [keys[index], keys[next]] = [keys[next], keys[index]];
  infoOrder.value = keys;
  writeOrder(INFO_ORDER_STORAGE, keys);
}

function applyInfoOrder(keys: string[]) {
  infoOrder.value = keys;
  writeOrder(INFO_ORDER_STORAGE, keys);
}

const visibleInfo = computed(() => {
  const o = order.value;
  if (!o) return [];
  const values: Record<string, string> = {
    clientName: o.clientName || '—',
    clientNum: o.clientNum || '—',
    supplierName: o.supplierName || '—',
    consignee: o.consignee || '—',
    consigneePhone: o.consigneePhone || '—',
    consigneeAddress: o.consigneeAddress || '—',
    discountTotal: formatEur(o.discountTotal),
    freight: formatEur(o.freight),
  };
  return orderedInfoFields.value.filter((field) => !infoHidden.value.includes(field.key)).map((field) => ({
    key: field.key,
    label: field.label,
    value: values[field.key] ?? '—',
  }));
});

interface ItemColDef {
  key: string;
  title: string;
  width?: number;
  align?: 'left' | 'right';
  dataIndex?: string;
}

/** Colonne delle righe ordine: la Variante è nascosta di default. */
const ITEM_CATALOG: ItemColDef[] = [
  { key: 'goodsNum', title: 'Codice', width: 150 },
  { key: 'image', title: 'Immagine', width: 88, dataIndex: 'imageUrl' },
  { key: 'goodsName', title: 'Descrizione' },
  { key: 'optionsName', title: 'Variante' },
  { key: 'ordersNumber', title: 'Q.tà', width: 120, align: 'right' },
  { key: 'baseUnits', title: 'Unità', width: 90 },
  { key: 'ordersPrice', title: 'Prezzo', width: 120, align: 'right' },
  { key: 'actualAmount', title: 'Importo', width: 130, align: 'right' },
];

const ITEM_STORAGE = 'orderez-order-items-hidden-v1';
const ITEM_DEFAULT_HIDDEN = ['optionsName'];

const itemHidden = ref<string[]>(readHidden(ITEM_STORAGE, ITEM_DEFAULT_HIDDEN));

function toggleItemColumn(key: string) {
  const index = itemHidden.value.indexOf(key);
  if (index >= 0) itemHidden.value.splice(index, 1);
  else itemHidden.value.push(key);
  localStorage.setItem(ITEM_STORAGE, JSON.stringify(itemHidden.value));
}

function resetItemColumns() {
  itemOrder.value = [];
  writeOrder(ITEM_ORDER_STORAGE, []);
  itemHidden.value = [...ITEM_DEFAULT_HIDDEN];
  localStorage.setItem(ITEM_STORAGE, JSON.stringify(itemHidden.value));
}

const ITEM_ORDER_STORAGE = 'orderez-order-items-order-v1';
const itemOrder = ref<string[]>(readOrder(ITEM_ORDER_STORAGE));

const orderedItemCatalog = computed(() =>
  orderList(ITEM_CATALOG, itemOrder.value).map((k) => ITEM_CATALOG.find((c) => c.key === k)!),
);

/** L'immagine resta ancorata subito prima della descrizione, anche con un ordine salvato. */
const itemCatalogWithImageFirst = computed(() => {
  const list = orderedItemCatalog.value.slice();
  const imageIdx = list.findIndex((c) => c.key === 'image');
  if (imageIdx >= 0) {
    const [image] = list.splice(imageIdx, 1);
    const nameIdx = list.findIndex((c) => c.key === 'goodsName');
    list.splice(nameIdx >= 0 ? nameIdx : list.length, 0, image);
  }
  return list;
});

const itemItems = computed(() =>
  itemCatalogWithImageFirst.value.map((c) => ({ key: c.key, title: c.title })),
);

function moveItemColumn(key: string, direction: -1 | 1) {
  const keys = orderList(ITEM_CATALOG, itemOrder.value);
  const index = keys.indexOf(key);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= keys.length) return;
  [keys[index], keys[next]] = [keys[next], keys[index]];
  itemOrder.value = keys;
  writeOrder(ITEM_ORDER_STORAGE, keys);
}

function applyItemOrder(keys: string[]) {
  itemOrder.value = keys;
  writeOrder(ITEM_ORDER_STORAGE, keys);
}

const itemColumns = computed(() =>
  itemCatalogWithImageFirst.value.filter((col) => !itemHidden.value.includes(col.key)).map((col) => ({
    title: col.title,
    dataIndex: col.dataIndex ?? col.key,
    key: col.key,
    width: col.width,
    align: col.align,
  })),
);

const itemScrollX = computed(() =>
  itemColumns.value.reduce((sum, col) => sum + Number(col.width ?? 220), 0),
);

/** Ordini adiacenti per la navigazione avanti/indietro. */
const neighbors = ref<{
  prev: { id: number; erpOrdersNum: string } | null;
  next: { id: number; erpOrdersNum: string } | null;
}>({ prev: null, next: null });

function goToOrder(target: { id: number } | null) {
  if (target) router.push(`/orders/${target.id}`);
}

const shipmentColumns = [
  { title: 'ID', dataIndex: 'id', key: 'id', width: 80 },
  { title: 'Stato', dataIndex: 'status', key: 'status', width: 180 },
  { title: 'N. spedizione ERP', dataIndex: 'erpShipsSn', key: 'erpShipsSn', width: 190 },
  { title: 'Nota', dataIndex: 'remark', key: 'remark' },
  { title: 'Dettaglio', dataIndex: 'lastError', key: 'lastError' },
  { title: 'Data', dataIndex: 'shippedAt', key: 'shippedAt', width: 170 },
];

/** Solo "Da evadere" (stockup) è spedibile: il gestionale rifiuta ogni altro stato. */
const shipState = computed(() => {
  const o = order.value;
  if (!o) return { canShip: false, reason: '' };

  const active = o.shipments?.find((s) => s.status === 'receivedin' || s.status === 'pending');
  if (active?.status === 'receivedin') return { canShip: false, reason: 'Ordine già spedito.' };
  if (active?.status === 'pending') return { canShip: false, reason: 'Spedizione in corso.' };

  if (o.status !== 'stockup') {
    return {
      canShip: false,
      reason: `Ordine non spedibile: stato attuale "${orderStatusLabel(o.status)}". Sul gestionale l'ordine deve essere in stato "Da evadere".`,
    };
  }
  if (!o.items?.length) return { canShip: false, reason: 'Ordine senza righe.' };
  return { canShip: true, reason: '' };
});

const canShip = computed(() => shipState.value.canShip);

const shipHint = computed(() => {
  const o = order.value;
  if (!o || canShip.value) return '';
  // Se sul gestionale esiste già un documento di spedizione, quello è il motivo vero.
  const doc = erpShipment.value;
  if (doc?.ships_num) {
    const stato = doc.status ? ` (${shipmentStatusLabel(doc.status)})` : '';
    return `Già spedito: ${doc.ships_num}${stato}. Gestibile solo dal gestionale.`;
  }
  return shipState.value.reason;
});

async function load() {
  loading.value = true;
  erpShipment.value = null;
  try {
    const data = await getOrder(Number(route.params.id));
    order.value = data;
    // Solo quando non c'è nulla da spedire qui: verifica se il gestionale ha già spedito.
    if (!data.shipments?.length && data.status !== 'stockup') {
      erpShipment.value = await getErpShipment(data.id).catch(() => null);
    }
    neighbors.value = await getOrderNeighbors(data.id).catch(() => ({ prev: null, next: null }));
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    loading.value = false;
  }
}

function openShip() {
  shipForm.consignmentNo = '';
  shipForm.consignmentName = '';
  shipForm.remark = '';
  shipOpen.value = true;
}

async function confirmShip() {
  if (!order.value) return;
  shipping.value = true;
  try {
    await shipOrder(order.value.id, {
      consignmentNo: shipForm.consignmentNo.trim() || undefined,
      consignmentName: shipForm.consignmentName.trim() || undefined,
      remark: shipForm.remark.trim() || undefined,
    });
    message.success('Spedizione completata');
    shipOpen.value = false;
    await load();
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    shipping.value = false;
  }
}

function print() {
  printOpen.value = true;
}

onMounted(load);

/** Cambio ordine senza ricreare il componente (stessa rotta, id diverso). */
watch(
  () => route.params.id,
  (value) => {
    if (value && route.name === 'order-detail') void load();
  },
);
</script>

<template>
  <div class="page">
    <header class="page-heading">
      <div>
        <a-button type="link" class="back" @click="router.push('/orders')">
          <template #icon><ArrowLeftOutlined /></template>
          Ordini
        </a-button>
        <div class="heading-line">
          <h1>Ordine {{ order?.erpOrdersNum || '—' }}</h1>
          <p v-if="order" class="order-meta">
            <StatusTag kind="order" :status="order.status" />
            <span class="muted"> creato il {{ formatDate(order.erpCreateDate) }}</span>
            <a-popover trigger="click" placement="bottomLeft">
              <button type="button" class="gear-btn" title="Campi visualizzati">
                <SettingOutlined />
              </button>
              <template #content>
                <ColumnPicker
                  :items="infoItems"
                  :hidden="infoHidden"
                  heading="Campi visualizzati"
                  @toggle="toggleInfo"
                  @move="moveInfoField"
                  @reorder="applyInfoOrder"
                  @reset="resetInfoFields"
                />
              </template>
            </a-popover>
          </p>
        </div>
      </div>
      <div class="heading-actions">
        <a-button :disabled="!neighbors.prev" @click="goToOrder(neighbors.prev)">
          <template #icon><LeftOutlined /></template>
          Precedente
        </a-button>
        <a-button :disabled="!neighbors.next" @click="goToOrder(neighbors.next)">
          Successivo
          <template #icon><RightOutlined /></template>
        </a-button>
      </div>
    </header>

    <a-spin :spinning="loading">
      <template v-if="order">
        <a-alert
          v-if="shipHint"
          :type="erpShipment?.ships_num ? 'info' : 'warning'"
          show-icon
          class="ship-hint"
          :message="shipHint"
        />
        <section class="panel">
          <div class="panel-body">
            <div class="detail-grid detail-grid--4">
              <div
                v-for="item in visibleInfo"
                :key="item.key"
                class="detail-item"
                :class="{ 'detail-item--address': item.key === 'consigneeAddress' }"
              >
                <span class="label">{{ item.label }}</span>
                <span class="value">{{ item.value }}</span>
              </div>
            </div>
          </div>
        </section>

        <div class="section-bar">
          <h2 class="section-title">Righe ordine</h2>
          <a-popover trigger="click" placement="bottomLeft">
            <button type="button" class="gear-btn" title="Colonne visibili">
              <SettingOutlined />
            </button>
            <template #content>
              <ColumnPicker
                :items="itemItems"
                :hidden="itemHidden"
                @toggle="toggleItemColumn"
                @move="moveItemColumn"
                @reorder="applyItemOrder"
                @reset="resetItemColumns"
              />
            </template>
          </a-popover>
          <div class="section-actions">
            <a-button :disabled="!order" @click="print">
              <template #icon><PrinterOutlined /></template>
              Stampa
            </a-button>
            <a-tooltip :title="canShip ? '' : shipState.reason">
              <span class="ship-btn-wrap">
                <a-button type="primary" :disabled="!canShip" :loading="shipping" @click="openShip">Spedisci</a-button>
              </span>
            </a-tooltip>
          </div>
        </div>
        <section class="panel">
          <a-table
            row-key="id"
            :columns="itemColumns"
            :data-source="order.items || []"
            :pagination="false"
            :scroll="{ x: itemScrollX }"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'image'">
                <ProductThumb :src="record.imageUrl" :alt="record.goodsName || record.goodsNum" />
              </template>
              <template v-else-if="column.key === 'goodsNum'">{{ record.goodsNum || '—' }}</template>
              <template v-else-if="column.key === 'goodsName'">{{ record.goodsName || '—' }}</template>
              <template v-else-if="column.key === 'optionsName'">{{ record.optionsName || '—' }}</template>
              <template v-else-if="column.key === 'ordersNumber'">{{ formatQty(record.ordersNumber) }}</template>
              <template v-else-if="column.key === 'baseUnits'">{{ record.baseUnits || '—' }}</template>
              <template v-else-if="column.key === 'ordersPrice'">{{ formatEur(record.ordersPrice) }}</template>
              <template v-else-if="column.key === 'actualAmount'">{{ formatEur(record.actualAmount) }}</template>
            </template>
          </a-table>
        </section>

        <h2 class="section-title">Spedizioni</h2>
        <section class="panel">
          <a-table
            row-key="id"
            :columns="shipmentColumns"
            :data-source="order.shipments || []"
            :pagination="false"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'status'">
                <StatusTag kind="shipment" :status="record.status" />
              </template>
              <template v-else-if="column.key === 'erpShipsSn'">{{ record.erpShipsSn || '—' }}</template>
              <template v-else-if="column.key === 'remark'">{{ record.remark || '—' }}</template>
              <template v-else-if="column.key === 'lastError'">
                <a-tooltip v-if="record.lastError" :title="record.lastError">
                  <span class="err-text">Rifiutata dal gestionale</span>
                </a-tooltip>
                <span v-else class="muted">—</span>
              </template>
              <template v-else-if="column.key === 'shippedAt'">{{ formatDateTime(record.shippedAt) }}</template>
            </template>
            <template #emptyText>Nessuna spedizione per questo ordine.</template>
          </a-table>
        </section>
      </template>
    </a-spin>

    <a-modal
      v-model:open="shipOpen"
      title="Conferma spedizione"
      :confirm-loading="shipping"
      ok-text="Spedisci"
      cancel-text="Annulla"
      @ok="confirmShip"
    >
      <p class="muted">I dati vengono inviati al gestionale ERP con stato "In attesa di ricezione".</p>
      <a-form layout="vertical">
        <a-form-item label="Numero collo / spedizione (opzionale)">
          <a-input v-model:value="shipForm.consignmentNo" placeholder="es. 123456789" />
        </a-form-item>
        <a-form-item label="Corriere (opzionale)">
          <a-input v-model:value="shipForm.consignmentName" placeholder="es. DHL, BRT" />
        </a-form-item>
        <a-form-item label="Nota per il gestionale (opzionale)">
          <a-textarea
            v-model:value="shipForm.remark"
            :rows="3"
            :maxlength="500"
            show-count
            placeholder="es. consegnare al piano, citofono, orario preferito..."
          />
          <span class="muted">La nota viene registrata sulla spedizione nel gestionale.</span>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Stampa in pagina: niente scheda separata del browser. -->
    <OrderPrintModal v-model:open="printOpen" :order-ids="order ? [order.id] : []" />
  </div>
</template>

<style scoped>
.back {
  padding: 0;
  height: auto;
  margin-bottom: 6px;
}

/* Titolo ordine + stato/data/ingranaggio su una sola riga */
.heading-line {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.heading-line h1 {
  margin: 0;
}

/* Anagrafica ordine: 4 campi in prima riga; telefono + indirizzo largo in seconda. */
.detail-grid--4 {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.detail-item--address {
  grid-column: span 3;
}

@media (max-width: 1100px) {
  .detail-grid--4 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .detail-item--address {
    grid-column: 1 / -1;
  }
}

@media (max-width: 760px) {
  .detail-grid--4 {
    grid-template-columns: 1fr;
  }

  .detail-item--address {
    grid-column: auto;
  }
}

.ship-btn-wrap {
  display: inline-block;
}

.heading-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.ship-hint {
  margin-bottom: 16px;
}

.err-text {
  color: var(--oe-danger);
  font-weight: 500;
}

.section-title {
  margin: 24px 0 10px;
  font-family: var(--oe-font-display);
  font-size: 19px;
}

span.muted {
  margin-left: 8px;
}

.order-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  flex-wrap: wrap;
}

/* Ingranaggio per la scelta dei campi/colonne */
.gear-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--oe-border);
  border-radius: 5px;
  background: var(--gray-000);
  color: var(--oe-text-muted);
  font-size: 16px;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.gear-btn:hover {
  color: var(--oe-primary);
  border-color: var(--oe-primary);
}

/* Titolo sezione + ingranaggio a sinistra, azioni (Stampa/Spedisci) a destra */
.section-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 24px 0 10px;
}

.section-bar .section-title {
  margin: 0;
}

.section-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}
</style>
