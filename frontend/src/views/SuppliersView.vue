<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { message } from 'ant-design-vue';
import { CloudSyncOutlined, ReloadOutlined } from '@ant-design/icons-vue';
import { listSuppliers, syncSuppliers } from '../api';
import { api } from '../api/client';
import type { Supplier } from '../types';
import { formatDateTime } from '../utils/format';
import StatusTag from '../components/StatusTag.vue';

interface SupplierUser {
  id: number;
  username: string;
  status: number;
  createdAt?: string;
}

interface SupplierDetail extends Supplier {
  users?: SupplierUser[];
  stats?: { orders: number; shipments: number; pending: number };
}

const rows = ref<Supplier[]>([]);
const loading = ref(false);
const syncing = ref(false);
const drawerOpen = ref(false);
const detail = ref<SupplierDetail | null>(null);
const detailLoading = ref(false);

const columns = [
  { title: 'Fornitore', dataIndex: 'supplierName', key: 'supplierName' },
  { title: 'Codice', dataIndex: 'clientNum', key: 'clientNum', width: 130 },
  { title: 'Contatto', dataIndex: 'contact', key: 'contact' },
  { title: 'Telefono', dataIndex: 'mobile', key: 'mobile', width: 150 },
  { title: 'Ordini', dataIndex: ['_count', 'orders'], key: 'orders', width: 90, align: 'right' },
  { title: 'Spedizioni', dataIndex: ['_count', 'shipments'], key: 'shipments', width: 110, align: 'right' },
  { title: 'Account', dataIndex: ['_count', 'users'], key: 'users', width: 90, align: 'right' },
  { title: '', key: 'actions', width: 100 },
];

async function load() {
  loading.value = true;
  try {
    rows.value = (await listSuppliers()).rows;
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    loading.value = false;
  }
}

async function sync() {
  syncing.value = true;
  try {
    await syncSuppliers();
    message.success('Fornitori sincronizzati');
    await load();
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    syncing.value = false;
  }
}

async function openDetail(record: Supplier) {
  drawerOpen.value = true;
  detailLoading.value = true;
  detail.value = null;
  try {
    const response = await api.get<SupplierDetail>(`/suppliers/${record.id}`);
    detail.value = response.data;
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    detailLoading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="page">
    <header class="page-heading">
      <div>
        <h1>Fornitori</h1>
        <p>Anagrafica fornitori sincronizzata dal gestionale ERP.</p>
      </div>
      <div class="heading-actions">
        <a-button @click="load">
          <template #icon><ReloadOutlined /></template>
          Aggiorna
        </a-button>
        <a-button type="primary" :loading="syncing" @click="sync">
          <template #icon><CloudSyncOutlined /></template>
          Sincronizza da ERP
        </a-button>
      </div>
    </header>

    <section class="panel">
      <a-table
        row-key="id"
        :columns="columns"
        :data-source="rows"
        :loading="loading"
        :pagination="false"
        :scroll="{ x: 1080 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'supplierName'">{{ record.supplierName }}</template>
          <template v-else-if="column.key === 'clientNum'">{{ record.clientNum || '—' }}</template>
          <template v-else-if="column.key === 'contact'">{{ record.contact || '—' }}</template>
          <template v-else-if="column.key === 'mobile'">{{ record.mobile || '—' }}</template>
          <template v-else-if="column.key === 'orders'">{{ record._count?.orders ?? 0 }}</template>
          <template v-else-if="column.key === 'shipments'">{{ record._count?.shipments ?? 0 }}</template>
          <template v-else-if="column.key === 'users'">{{ record._count?.users ?? 0 }}</template>
          <template v-else-if="column.key === 'actions'">
            <a-button type="link" size="small" @click="openDetail(record)">Dettaglio</a-button>
          </template>
        </template>
      </a-table>
    </section>

    <a-drawer v-model:open="drawerOpen" title="Dettaglio fornitore" :width="440">
      <a-spin :spinning="detailLoading">
        <template v-if="detail">
          <h3 class="name">{{ detail.supplierName }}</h3>
          <div class="summary-strip">
            <div><span class="kpi-label">Ordini</span><strong>{{ detail.stats?.orders ?? 0 }}</strong></div>
            <div><span class="kpi-label">Da evadere</span><strong>{{ detail.stats?.pending ?? 0 }}</strong></div>
            <div><span class="kpi-label">Spedizioni</span><strong>{{ detail.stats?.shipments ?? 0 }}</strong></div>
          </div>
          <div class="detail-grid">
            <div class="detail-item"><span class="label">Codice</span><span class="value">{{ detail.clientNum || '—' }}</span></div>
            <div class="detail-item"><span class="label">Contatto</span><span class="value">{{ detail.contact || '—' }}</span></div>
            <div class="detail-item"><span class="label">Telefono</span><span class="value">{{ detail.mobile || '—' }}</span></div>
          </div>

          <h4 class="sub">Account collegati</h4>
          <a-table
            row-key="id"
            :columns="[
              { title: 'Username', dataIndex: 'username', key: 'username' },
              { title: 'Stato', dataIndex: 'status', key: 'status', width: 110 },
              { title: 'Creato il', dataIndex: 'createdAt', key: 'createdAt', width: 140 },
            ]"
            :data-source="detail.users || []"
            :pagination="false"
            size="small"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'status'">
                <StatusTag kind="account" :status="String(record.status)" />
              </template>
              <template v-else-if="column.key === 'createdAt'">{{ formatDateTime(record.createdAt) }}</template>
            </template>
            <template #emptyText>Nessun account.</template>
          </a-table>
        </template>
      </a-spin>
    </a-drawer>
  </div>
</template>

<style scoped>
.heading-actions {
  display: flex;
  gap: 10px;
}

.name {
  margin: 0 0 12px;
  font-family: var(--oe-font-display);
  font-size: 20px;
}

.summary-strip {
  gap: 22px;
}

.summary-strip > div {
  display: flex;
  flex-direction: column;
}

.kpi-label {
  font-size: 12px;
  color: var(--oe-text-muted);
}

.sub {
  margin: 22px 0 10px;
  font-family: var(--oe-font-display);
  font-size: 16px;
}
</style>
