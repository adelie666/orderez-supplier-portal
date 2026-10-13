<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { message } from 'ant-design-vue';
import {
  DownloadOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
} from '@ant-design/icons-vue';
import { exportReport, reportSummary } from '../api';
import { formatEur, formatQty, formatPrice, todayRome } from '../utils/format';
import { useAuthStore } from '../stores/auth';
import { useTableAreaHeight } from '../utils/useTableAreaHeight';
import ColumnPicker from '../components/ColumnPicker.vue';
import ProductThumb from '../components/ProductThumb.vue';

interface ReportRow {
  key: string;
  goodsNum?: string | null;
  goodsName?: string | null;
  optionsName?: string | null;
  baseUnits?: string | null;
  qty: number;
  purchasePrice: number;
  amount: number;
  imageUrl?: string | null;
  ordersCount: number;
}

const auth = useAuthStore();
const { cardRef, filterRef, tableY } = useTableAreaHeight();
const loading = ref(false);
const exporting = ref(false);

const firstOfMonth = (() => {
  const today = todayRome();
  return `${today.slice(0, 7)}-01`;
})();

const range = ref<[string, string]>([firstOfMonth, todayRome()]);

const rows = ref<ReportRow[]>([]);
const totals = ref({ qty: 0, amount: 0, lines: 0 });
const page = ref(1);
const pageSize = ref(20);

interface ReportColDef {
  key: string;
  title: string;
  width: number;
  align?: 'left' | 'right';
  className?: string;
  adminOnly?: boolean;
}

/** Catalogo dei campi del report (le chiavi coincidono con il parametro `fields` dell'export). */
const REPORT_CATALOG: ReportColDef[] = [
  { key: 'label', title: 'Descrizione', width: 320 },
  { key: 'goodsNum', title: 'Codice', width: 150 },
  { key: 'optionsName', title: 'Variante', width: 180 },
  { key: 'baseUnits', title: 'Unità', width: 90 },
  { key: 'supplierName', title: 'Fornitore', width: 170, adminOnly: true },
  { key: 'qty', title: 'Quantità venduta', width: 150, align: 'right', className: 'oe-num' },
  { key: 'purchasePrice', title: 'Prezzo acquisto (EUR)', width: 170, align: 'right', className: 'oe-num' },
  { key: 'amount', title: 'Importo EUR', width: 160, align: 'right', className: 'oe-amount' },
  { key: 'ordersCount', title: 'N. ordini', width: 110, align: 'right', className: 'oe-num' },
];

const REPORT_DEFAULT_VISIBLE = ['label', 'goodsNum', 'baseUnits', 'qty', 'purchasePrice', 'amount'];
const REPORT_COLS_STORAGE = 'orderez-report-columns-v1';

interface ReportColState {
  order: string[];
  hidden: string[];
}

function readReportCols(): ReportColState | null {
  try {
    const raw = localStorage.getItem(REPORT_COLS_STORAGE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ReportColState>;
    return {
      order: Array.isArray(parsed.order) ? parsed.order.filter((k) => typeof k === 'string') : [],
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter((k) => typeof k === 'string') : [],
    };
  } catch {
    return null;
  }
}

function defaultReportCols(): ReportColState {
  return {
    order: [],
    hidden: REPORT_CATALOG.filter((c) => !REPORT_DEFAULT_VISIBLE.includes(c.key)).map((c) => c.key),
  };
}

const reportColState = reactive<ReportColState>(readReportCols() ?? defaultReportCols());

function persistReportCols() {
  localStorage.setItem(
    REPORT_COLS_STORAGE,
    JSON.stringify({ order: reportColState.order, hidden: reportColState.hidden }),
  );
}

const availableReportCols = computed(() => REPORT_CATALOG.filter((c) => !c.adminOnly || auth.isAdmin));

const orderedReportKeys = computed(() => {
  const known = availableReportCols.value.map((c) => c.key);
  const saved = reportColState.order.filter((k) => known.includes(k));
  const rest = known.filter((k) => !saved.includes(k));
  return [...saved, ...rest];
});

const visibleReportKeys = computed(() =>
  orderedReportKeys.value.filter((k) => !reportColState.hidden.includes(k)),
);

function reportColumnTitle(key: string): string {
  return REPORT_CATALOG.find((c) => c.key === key)?.title ?? key;
}

function toggleReportColumn(key: string) {
  const index = reportColState.hidden.indexOf(key);
  if (index >= 0) reportColState.hidden.splice(index, 1);
  else reportColState.hidden.push(key);
  persistReportCols();
}

function moveReportColumn(key: string, direction: -1 | 1) {
  const keys = [...orderedReportKeys.value];
  const index = keys.indexOf(key);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= keys.length) return;
  [keys[index], keys[next]] = [keys[next], keys[index]];
  reportColState.order = keys;
  persistReportCols();
}

function resetReportColumns() {
  const fresh = defaultReportCols();
  reportColState.order = fresh.order;
  reportColState.hidden = fresh.hidden;
  persistReportCols();
  message.success('Colonne ripristinate');
}

/** Voci del pannello colonne (ordine corrente + etichetta). */
const reportColItems = computed(() =>
  orderedReportKeys.value.map((key) => ({ key, title: reportColumnTitle(key) })),
);

function applyReportColumnOrder(keys: string[]) {
  reportColState.order = keys;
  persistReportCols();
}

const columns = computed(() => {
  const list: Record<string, unknown>[] = [
    // L'intestazione di questa colonna ospita l'ingranaggio di scelta campi (slot headerCell).
    { title: '', key: '_index', width: 64, fixed: 'left', className: 'oe-col-index' },
  ];
  const IMAGE_COL = { title: 'Immagine', key: 'image', width: 88 };
  // Immagine articolo subito prima della descrizione (colonna non esportata in Excel).
  if (!visibleReportKeys.value.includes('label')) list.push({ ...IMAGE_COL });
  for (const key of visibleReportKeys.value) {
    if (key === 'label') list.push({ ...IMAGE_COL });
    const def = availableReportCols.value.find((c) => c.key === key);
    if (!def) continue;
    list.push({ title: def.title, key: def.key, width: def.width, align: def.align, className: def.className });
  }
  return list;
});

const scrollX = computed(() => columns.value.reduce((sum, col) => sum + Number(col.width ?? 0), 0));

const pagedRows = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return rows.value.slice(start, start + pageSize.value);
});

/** Periodo: il report aggrega i prodotti venduti nel periodo scelto (righe d'ordine). */
function params(): Record<string, unknown> {
  const result: Record<string, unknown> = { groupBy: 'product' };
  result.fields = visibleReportKeys.value.join(',');
  if (range.value?.[0]) result.dateFrom = range.value[0];
  if (range.value?.[1]) result.dateTo = range.value[1];
  return result;
}

function labelOf(row: ReportRow): string {
  return row.goodsName || row.optionsName || row.goodsNum || '—';
}

function subLabelOf(row: ReportRow): string {
  return row.optionsName || '';
}

async function load() {
  loading.value = true;
  page.value = 1;
  try {
    const data = await reportSummary(params());
    rows.value = data.rows;
    totals.value = data.totals;
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    loading.value = false;
  }
}

async function exportExcel() {
  exporting.value = true;
  try {
    await exportReport(params());
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    exporting.value = false;
  }
}

function reset() {
  range.value = [firstOfMonth, todayRome()];
  load();
}

function onPageChange(next: number, size: number) {
  page.value = next;
  pageSize.value = size;
}

onMounted(load);
</script>

<template>
  <div class="oe-list-page oe-list-page--fill">
    <div class="oe-bread-area">
      <div class="oe-bread-left">
        <h1 class="oe-bread-title">{{ auth.isSupplier ? 'Il mio report' : 'Report articoli' }}</h1>
        <span class="oe-bread-sub">Prodotti venduti nel periodo. Importi in EUR, IVA esclusa.</span>
      </div>
      <div class="oe-bread-actions">
        <a-popover trigger="click" placement="bottomRight">
          <a-button>
            <template #icon><SettingOutlined class="oe-gear-icon" /></template>
            Colonne
          </a-button>
          <template #content>
            <ColumnPicker
              :items="reportColItems"
              :hidden="reportColState.hidden"
              @toggle="toggleReportColumn"
              @move="moveReportColumn"
              @reorder="applyReportColumnOrder"
              @reset="resetReportColumns"
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
        <div class="oe-kpi-strip">
          <div class="oe-kpi">
            <span class="oe-kpi-label">Prodotti venduti</span>
            <strong class="oe-kpi-value">{{ rows.length }}</strong>
          </div>
          <div class="oe-kpi">
            <span class="oe-kpi-label">Quantità totale</span>
            <strong class="oe-kpi-value">{{ formatQty(totals.qty) }}</strong>
          </div>
          <div class="oe-kpi">
            <span class="oe-kpi-label">Importo totale</span>
            <strong class="oe-kpi-value">{{ formatEur(totals.amount) }}</strong>
          </div>
        </div>

        <div ref="cardRef" class="oe-main-card">
          <div ref="filterRef" class="oe-filter-wrap">
            <div class="oe-fline oe-fline--actions">
              <div class="oe-g--3">
                <a-range-picker v-model:value="range" value-format="YYYY-MM-DD" style="width: 100%" />
              </div>
              <div class="oe-filter-actions">
                <a-button @click="reset">
                  <template #icon><ReloadOutlined /></template>
                  Azzera
                </a-button>
                <a-button type="primary" @click="load">
                  <template #icon><SearchOutlined /></template>
                  Applica
                </a-button>
              </div>
            </div>
          </div>

          <a-table
            row-key="key"
            class="oe-list-table oe-list-table--zebra oe-list-table--compact"
            :columns="columns"
            :data-source="pagedRows"
            :loading="loading"
            :pagination="false"
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
                      :items="reportColItems"
                      :hidden="reportColState.hidden"
                      @toggle="toggleReportColumn"
                      @move="moveReportColumn"
                      @reorder="applyReportColumnOrder"
                      @reset="resetReportColumns"
                    />
                  </template>
                </a-popover>
              </template>
              <template v-else>{{ column.title }}</template>
            </template>
            <template #bodyCell="{ column, record, index }">
              <template v-if="column.key === '_index'">{{ (page - 1) * pageSize + index + 1 }}</template>
              <template v-else-if="column.key === 'image'">
                <ProductThumb :src="record.imageUrl" :alt="labelOf(record)" />
              </template>
              <template v-else-if="column.key === 'label'">
                <div class="oe-cell-main">{{ labelOf(record) }}</div>
                <div v-if="subLabelOf(record)" class="oe-cell-sub">{{ subLabelOf(record) }}</div>
              </template>
              <template v-else-if="column.key === 'goodsNum'">{{ record.goodsNum || '—' }}</template>
              <template v-else-if="column.key === 'optionsName'">{{ record.optionsName || '—' }}</template>
              <template v-else-if="column.key === 'supplierName'">{{ record.supplierName || '—' }}</template>
              <template v-else-if="column.key === 'ordersCount'">{{ record.ordersCount }}</template>
              <template v-else-if="column.key === 'baseUnits'">{{ record.baseUnits || '—' }}</template>
              <template v-else-if="column.key === 'qty'">{{ formatQty(record.qty) }}</template>
              <template v-else-if="column.key === 'purchasePrice'">{{ formatPrice(record.purchasePrice) }}</template>
              <template v-else-if="column.key === 'amount'">{{ formatEur(record.amount) }}</template>
            </template>
          </a-table>
        </div>
      </div>

      <div class="oe-footer-bar">
        <div class="oe-footer-left">
          <a-button type="primary" :loading="exporting" :disabled="!rows.length" @click="exportExcel">
            <template #icon><DownloadOutlined /></template>
            Esporta Excel
          </a-button>
          <span class="oe-footer-selected">{{ rows.length }} prodotti · {{ totals.lines }} righe d'ordine</span>
        </div>
        <div class="oe-footer-right">
          <a-pagination
            :current="page"
            :page-size="pageSize"
            :total="rows.length"
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
