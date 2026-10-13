<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { message, Modal } from 'ant-design-vue';
import { ReloadOutlined, SyncOutlined } from '@ant-design/icons-vue';
import {
  createAccount,
  deleteAccount,
  listAccounts,
  listSuppliers,
  resetAccountPassword,
  syncSuppliers,
  updateAccount,
} from '../api';
import type { Account, Supplier } from '../types';
import { formatDateTime } from '../utils/format';
import StatusTag from '../components/StatusTag.vue';

const rows = ref<Account[]>([]);
const suppliers = ref<Supplier[]>([]);
const loading = ref(false);
const saving = ref(false);
const open = ref(false);
const form = reactive({ username: '', password: '', supplierId: undefined as number | undefined });
const resetOpen = ref(false);
const resetTarget = ref<Account | null>(null);
const resetValue = ref('');
const resetting = ref(false);
const supplierSyncing = ref(false);

const columns = [
  { title: 'ID', dataIndex: 'id', key: 'id', width: 70 },
  { title: 'Username', dataIndex: 'username', key: 'username' },
  { title: 'Ruolo', dataIndex: 'role', key: 'role', width: 130 },
  { title: 'Fornitore', dataIndex: ['supplier', 'supplierName'], key: 'supplierName' },
  { title: 'Stato', dataIndex: 'status', key: 'status', width: 130 },
  { title: 'Creato il', dataIndex: 'createdAt', key: 'createdAt', width: 170 },
  { title: '', key: 'actions', width: 260 },
];

async function load() {
  loading.value = true;
  try {
    const [accounts, supplierList] = await Promise.all([listAccounts(), listSuppliers()]);
    rows.value = accounts.rows;
    suppliers.value = supplierList.rows;
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    loading.value = false;
  }
}

/** Rilegge l'elenco fornitori dal gestionale: i fornitori creati di recente compaiono solo dopo questa sincronizzazione. */
async function refreshSuppliersFromErp() {
  supplierSyncing.value = true;
  try {
    const result = (await syncSuppliers()) as { count?: number };
    suppliers.value = (await listSuppliers()).rows;
    message.success(`Elenco fornitori aggiornato (${result?.count ?? suppliers.value.length})`);
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    supplierSyncing.value = false;
  }
}

function openCreate() {
  form.username = '';
  form.password = '';
  form.supplierId = undefined;
  open.value = true;
}

async function submitCreate() {
  if (!form.username.trim() || form.password.length < 8 || !form.supplierId) {
    message.warning('Compila username, password (min. 8 caratteri) e fornitore');
    return;
  }
  saving.value = true;
  try {
    await createAccount({ username: form.username.trim(), password: form.password, supplierId: form.supplierId });
    message.success('Account creato');
    open.value = false;
    await load();
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    saving.value = false;
  }
}

async function toggleStatus(record: Account) {
  try {
    await updateAccount(record.id, { status: record.status === 1 ? 0 : 1 });
    message.success('Stato aggiornato');
    await load();
  } catch (error) {
    message.error((error as Error).message);
  }
}

function resetPassword(record: Account) {
  resetTarget.value = record;
  resetValue.value = '';
  resetOpen.value = true;
}

async function confirmReset() {
  if (!resetTarget.value) return;
  if (resetValue.value.length < 8) {
    message.warning('La password deve avere almeno 8 caratteri');
    return;
  }
  resetting.value = true;
  try {
    await resetAccountPassword(resetTarget.value.id, resetValue.value);
    message.success('Password aggiornata');
    resetOpen.value = false;
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    resetting.value = false;
  }
}

function remove(record: Account) {
  Modal.confirm({
    title: `Eliminare l'account ${record.username}?`,
    content: "L'operazione non può essere annullata.",
    okText: 'Elimina',
    okType: 'danger',
    cancelText: 'Annulla',
    async onOk() {
      await deleteAccount(record.id);
      message.success('Account eliminato');
      await load();
    },
  });
}

onMounted(load);
</script>

<template>
  <div class="page">
    <header class="page-heading">
      <div>
        <h1>Account</h1>
        <p>Gestione degli accessi al portale per i fornitori.</p>
      </div>
      <div class="heading-actions">
        <a-button @click="load">
          <template #icon><ReloadOutlined /></template>
          Aggiorna
        </a-button>
        <a-button type="primary" @click="openCreate">
          <template #icon><PlusOutlined /></template>
          Nuovo account
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
          <template v-if="column.key === 'role'">
            {{ record.role === 'admin' ? 'Amministratore' : 'Fornitore' }}
          </template>
          <template v-else-if="column.key === 'supplierName'">{{ record.supplier?.supplierName || '—' }}</template>
          <template v-else-if="column.key === 'status'">
            <StatusTag kind="account" :status="String(record.status)" />
          </template>
          <template v-else-if="column.key === 'createdAt'">{{ formatDateTime(record.createdAt) }}</template>
          <template v-else-if="column.key === 'actions'">
            <a-button v-if="record.role !== 'admin'" type="link" size="small" @click="toggleStatus(record)">
              {{ record.status === 1 ? 'Disattiva' : 'Attiva' }}
            </a-button>
            <a-button type="link" size="small" @click="resetPassword(record)">Password</a-button>
            <a-button v-if="record.role !== 'admin'" type="link" size="small" danger @click="remove(record)">
              Elimina
            </a-button>
          </template>
        </template>
      </a-table>
    </section>

    <a-modal
      v-model:open="open"
      title="Nuovo account fornitore"
      :confirm-loading="saving"
      ok-text="Crea"
      cancel-text="Annulla"
      @ok="submitCreate"
    >
      <a-form layout="vertical">
        <a-form-item label="Fornitore">
          <a-select
            v-model:value="form.supplierId"
            placeholder="Seleziona fornitore"
            show-search
            option-filter-prop="label"
            :options="suppliers.map((s) => ({ value: s.id, label: s.supplierName }))"
          />
          <a-button
            type="link"
            size="small"
            :loading="supplierSyncing"
            style="padding-left: 0; margin-top: 4px"
            @click="refreshSuppliersFromErp"
          >
            <template #icon><SyncOutlined /></template>
            Aggiorna elenco fornitori dal gestionale
          </a-button>
        </a-form-item>
        <a-form-item label="Username">
          <a-input v-model:value="form.username" placeholder="es. fornitore4" />
        </a-form-item>
        <a-form-item label="Password">
          <a-input-password v-model:value="form.password" placeholder="Minimo 8 caratteri" />
        </a-form-item>
      </a-form>
    </a-modal>

    <a-modal
      v-model:open="resetOpen"
      :title="`Reimposta password · ${resetTarget?.username ?? ''}`"
      :confirm-loading="resetting"
      ok-text="Reimposta"
      cancel-text="Annulla"
      @ok="confirmReset"
    >
      <a-form layout="vertical">
        <a-form-item label="Nuova password">
          <a-input-password v-model:value="resetValue" placeholder="Minimo 8 caratteri" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<style scoped>
.heading-actions {
  display: flex;
  gap: 10px;
}
</style>
