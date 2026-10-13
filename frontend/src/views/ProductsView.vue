<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { message } from 'ant-design-vue';
import { ReloadOutlined, SearchOutlined, SettingOutlined, SyncOutlined } from '@ant-design/icons-vue';
import { listProducts, listSuppliers, syncCatalog } from '../api';
import type { Product, Supplier } from '../types';
import { formatDateTime, formatEur } from '../utils/format';
import { useAuthStore } from '../stores/auth';
import ProductThumb from '../components/ProductThumb.vue';
import ColumnPicker from '../components/ColumnPicker.vue';
import { useTableAreaHeight } from '../utils/useTableAreaHeight';

const auth = useAuthStore();
const { cardRef, filterRef, tableY } = useTableAreaHeight();

/** "none" = articoli senza fornitore: e' il filtro che serve a trovare i buchi di mappatura. */
const NO_SUPPLIER = 'none';

const rows = ref<Product[]>([]);
const suppliers = ref<Supplier[]>([]);
const loading = ref(false);
const syncing = ref(false);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const unmapped = ref(0);
const catalogTotal = ref(0);

const filters = reactive<{ keyword: string; supplier?: string }>({ keyword: '' });

const supplierOptions = computed(() => [
  { value: NO_SUPPLIER, label: 'Senza fornitore' },
  ...suppliers.value.map((s) => ({ value: String(s.id), label: s.supplierName })),
]);

/* ------------------------------------------------------------------ colonne */

interface ColDef {
  key: string;
  title: string;
  width: number;
  align?: 'left' | 'right';
  className?: string;
  adminOnly?: boolean;
}

const COLUMN_CATALOG: ColDef[] = [
  { key: 'goodsName', title: 'Descrizione', width: 340 },
  { key: 'optionsName', title: 'Variante', width: 170 },
  { key: 'supplierName', title: 'Fornitore', width: 240, adminOnly: true },
  { key: 'purchasePrice', title: 'Prezzo acquisto', width: 140, align: 'right', className: 'oe-num' },
  { key: 'wholePrice', title: 'Prezzo ingrosso', width: 140, align: 'right', className: 'oe-num' },
  { key: 'baseUnits', title: 'Unità', width: 110 },
  { key: 'syncedAt', title: 'Sincronizzato', width: 150 },
];

const DEFAULT_VISIBLE = ['goodsName', 'supplierName', 'purchasePrice', 'wholePrice', 'baseUnits'];
const COLS_STORAGE = 'orderez-products-columns-v1';

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

const availableColumns = computed(() => COLUMN_CATALOG.filter((c) => !c.adminOnly || auth.isAdmin));

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

function applyColumnOrder(keys: string[]) {
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

const colItems = computed(() => orderedKeys.value.map((key) => ({ key, title: columnTitle(key) })));

const columns = computed(() => {
  const list: Record<string, unknown>[] = [
    { title: '', key: '_thumb', width: 64, fixed: 'left', className: 'oe-col-index' },
    { title: 'Codice', key: 'goodsNum', width: 160, fixed: 'left' },
  ];
  for (const key of visibleKeys.value) {
    const def = availableColumns.value.find((c) => c.key === key);
    if (!def) continue;
    list.push({ title: def.title, key: def.key, width: def.width, align: def.align, className: def.className });
  }
  return list;
});

const scrollX = computed(() => columns.value.reduce((sum, col) => sum + Number(col.width ?? 0), 0));

/* ------------------------------------------------------------------- dati */

function bodyParams(): Record<string, unknown> {
  const params: Record<string, unknown> = { page: page.value, pageSize: pageSize.value };
  if (filters.keyword.trim()) params.keyword = filters.keyword.trim();
  if (auth.isAdmin && filters.supplier === NO_SUPPLIER) params.onlyUnmapped = true;
  else if (auth.isAdmin && filters.supplier) params.supplierId = Number(filters.supplier);
  return params;
}

async function load() {
  loading.value = true;
  try {
    const data = await listProducts(bodyParams());
    rows.value = data.rows;
    total.value = data.total;
    unmapped.value = data.unmapped;
    catalogTotal.value = data.catalogTotal;
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    loading.value = false;
  }
}

async function loadSuppliers() {
  if (!auth.isAdmin) return;
  try {
    suppliers.value = (await listSuppliers()).rows;
  } catch (error) {
    message.error((error as Error).message);
  }
}

function search() {
  page.value = 1;
  load();
}

function reset() {
  filters.keyword = '';
  filters.supplier = undefined;
  page.value = 1;
  load();
}

function onPageChange(next: number, size: number) {
  page.value = next;
  pageSize.value = size;
  load();
}

/**
 * Rilegge articoli e fornitori da Dinghuobao (compreso il campo fornitore dell'articolo).
 * "Aggiorna" ricarica solo la lista locale: senza questo passaggio la pagina continua a
 * mostrare l'ultimo dato importato anche se in Dinghuobao e' cambiato.
 */
async function syncCatalogNow() {
  syncing.value = true;
  try {
    const result = await syncCatalog();
    message.success(
      `Catalogo sincronizzato: ${result?.products?.count ?? 0} articoli, ${result?.suppliers?.count ?? 0} fornitori`,
    );
    await loadSuppliers();
    await load();
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    syncing.value = false;
  }
}

onMounted(() => {
  loadSuppliers();
  load();
});
</script>

<template>
  <div class="oe-list-page oe-list-page--fill">
    <div class="oe-bread-area">
      <div class="oe-bread-left">
        <h1 class="oe-bread-title">{{ auth.isSupplier ? 'I miei articoli' : 'Articoli' }}</h1>
        <span class="oe-bread-sub">
          Articoli sincronizzati da Dinghuobao.
          <template v-if="auth.isAdmin">
            {{ catalogTotal }} articoli &middot; {{ unmapped }} senza fornitore.
          </template>
        </span>
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
        <a-button v-if="auth.isAdmin" :loading="syncing" @click="syncCatalogNow">
          <template #icon><SyncOutlined /></template>
          Sincronizza da ERP
        </a-button>
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
                  placeholder="Codice o descrizione articolo"
                  allow-clear
                  @press-enter="search"
                >
                  <template #prefix><SearchOutlined /></template>
                </a-input>
              </div>
              <div v-if="auth.isAdmin">
                <a-select
                  v-model:value="filters.supplier"
                  placeholder="Tutti i fornitori"
                  allow-clear
                  :options="supplierOptions"
                />
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
            :scroll="{ x: scrollX, y: tableY }"
          >
            <template #headerCell="{ column }">
              <template v-if="column.key === '_thumb'">
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
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === '_thumb'">
                <ProductThumb :src="record.imageUrl" :alt="record.goodsName || record.goodsNum || ''" />
              </template>
              <template v-else-if="column.key === 'goodsNum'">
                <span class="oe-cell-mono">{{ record.goodsNum || '—' }}</span>
                <span v-if="record.optionsName" class="oe-cell-sub">{{ record.optionsName }}</span>
              </template>
              <template v-else-if="column.key === 'goodsName'">
                {{ record.goodsName || '—' }}
              </template>
              <template v-else-if="column.key === 'supplierName'">
                <span class="oe-cell-sub">{{ record.supplierName || '' }}</span>
              </template>
              <template v-else-if="column.key === 'purchasePrice'">
                <span>{{ formatEur(record.purchasePrice) }}</span>
              </template>
              <template v-else-if="column.key === 'wholePrice'">{{ formatEur(record.wholePrice) }}</template>
              <template v-else-if="column.key === 'baseUnits'">{{ record.baseUnits || '—' }}</template>
              <template v-else-if="column.key === 'syncedAt'">{{ formatDateTime(record.syncedAt) }}</template>
              <template v-else>{{ record[column.key as keyof Product] ?? '—' }}</template>
            </template>
          </a-table>
        </div>
      </div>

      <div class="oe-footer-bar">
        <div class="oe-footer-left">
          <span class="oe-cell-sub">Articoli sincronizzati da Dinghuobao</span>
        </div>
        <div class="oe-footer-right">
          <span class="oe-footer-total">{{ total }} articoli</span>
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
  </div>
</template>

<style scoped>
.oe-cell-mono {
  font-family: var(--oe-font-mono);
}
</style>
