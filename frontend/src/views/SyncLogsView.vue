<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { message } from 'ant-design-vue';
import { CloudDownloadOutlined, ReloadOutlined, SyncOutlined } from '@ant-design/icons-vue';
import { pullOrders, refreshOrders, syncCatalog, syncLogs, syncShipments, syncStatus } from '../api';
import type { SyncLog } from '../types';
import { formatDateTime } from '../utils/format';
import StatusTag from '../components/StatusTag.vue';

/** Quando incorporato nella pagina Integrazione, nasconde l'intestazione di pagina. */
defineProps<{ embedded?: boolean }>();

const rows = ref<SyncLog[]>([]);
const loading = ref(false);
const watermark = ref<string | null>(null);
const busy = ref<string | null>(null);
const page = ref(1);
const pageSize = ref(50);
const total = ref(0);
const options = reactive({ lookbackDays: 7, days: 7, shipDays: 120, full: false });

const columns = [
  { title: 'ID', dataIndex: 'id', key: 'id', width: 80 },
  { title: 'Tipo', dataIndex: 'type', key: 'type', width: 120 },
  { title: 'Esito', dataIndex: 'status', key: 'status', width: 130 },
  { title: 'Messaggio', dataIndex: 'message', key: 'message' },
  { title: 'Data', dataIndex: 'createdAt', key: 'createdAt', width: 180 },
];

async function load() {
  loading.value = true;
  try {
    const [status, logs] = await Promise.all([
      syncStatus(),
      syncLogs({ page: page.value, pageSize: pageSize.value }),
    ]);
    watermark.value = status.watermark;
    rows.value = logs.rows;
    total.value = logs.total;
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    loading.value = false;
  }
}

async function run(key: string, action: () => Promise<unknown>, successMessage: string) {
  busy.value = key;
  try {
    await action();
    message.success(successMessage);
    await load();
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    busy.value = null;
  }
}

function onPageChange(next: number, size: number) {
  page.value = next;
  pageSize.value = size;
  load();
}

onMounted(load);
</script>

<template>
  <div :class="embedded ? '' : 'page'">
    <header v-if="!embedded" class="page-heading">
      <div>
        <h1>Log sincronizzazione</h1>
        <p>Storico delle importazioni dal gateway e delle spedizioni inviate all'ERP.</p>
      </div>
      <div class="heading-actions">
        <a-button @click="load">
          <template #icon><ReloadOutlined /></template>
          Aggiorna
        </a-button>
      </div>
    </header>

    <section class="panel action-panel">
      <div class="panel-body actions">
        <div class="action">
          <a-button
            type="primary"
            :loading="busy === 'orders'"
            @click="run('orders', () => pullOrders({ lookbackDays: options.lookbackDays, full: options.full }), 'Ordini importati')"
          >
            <template #icon><CloudDownloadOutlined /></template>
            Importa ordini
          </a-button>
          <a-input-number v-model:value="options.lookbackDays" :min="1" :max="365" addon-before="Giorni" />
        </div>
        <div class="action">
          <a-button :loading="busy === 'refresh'" @click="run('refresh', () => refreshOrders(options.days), 'Ordini aggiornati')">
            <template #icon><SyncOutlined /></template>
            Aggiorna ultimi giorni
          </a-button>
          <a-input-number v-model:value="options.days" :min="1" :max="90" addon-before="Giorni" />
        </div>
        <div class="action">
          <a-button :loading="busy === 'catalog'" @click="run('catalog', () => syncCatalog(), 'Catalogo sincronizzato')">
            Sincronizza catalogo
          </a-button>
        </div>
        <div class="action">
          <a-button
            :loading="busy === 'shipments'"
            @click="run('shipments', () => syncShipments(options.shipDays), 'Spedizioni importate')"
          >
            <template #icon><CloudDownloadOutlined /></template>
            Importa spedizioni
          </a-button>
          <a-input-number v-model:value="options.shipDays" :min="1" :max="365" addon-before="Giorni" />
        </div>
      </div>
      <div class="watermark">
        Ultima sincronizzazione ordini:
        <strong>{{ watermark ? formatDateTime(watermark) : 'nessuna' }}</strong>
      </div>
    </section>

    <section class="panel">
      <a-table
        row-key="id"
        :columns="columns"
        :data-source="rows"
        :loading="loading"
        :pagination="false"
        :scroll="{ x: 900 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'type'">{{ record.type || '—' }}</template>
          <template v-else-if="column.key === 'status'">
            <StatusTag kind="sync" :status="record.status" />
          </template>
          <template v-else-if="column.key === 'message'">{{ record.message || '—' }}</template>
          <template v-else-if="column.key === 'createdAt'">{{ formatDateTime(record.createdAt) }}</template>
        </template>
      </a-table>
      <div class="pager">
        <a-pagination
          :current="page"
          :page-size="pageSize"
          :total="total"
          show-total
          @change="onPageChange"
        />
      </div>
    </section>
  </div>
</template>

<style scoped>
.heading-actions {
  display: flex;
  gap: 10px;
}

.action-panel {
  margin-bottom: 20px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
}

.action {
  display: flex;
  align-items: center;
  gap: 10px;
}

.watermark {
  padding: 12px 20px;
  border-top: 1px solid var(--oe-border);
  color: var(--oe-text-muted);
  font-size: 13px;
}

.pager {
  display: flex;
  justify-content: flex-end;
  padding: 14px 18px;
  border-top: 1px solid var(--oe-border);
}
</style>
