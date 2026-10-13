<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { Modal, message } from 'ant-design-vue';
import { ApiOutlined, DeleteOutlined, InfoCircleOutlined, SaveOutlined } from '@ant-design/icons-vue';
import { getSettings, resetData, saveSettings, testSettings } from '../api';
import SyncLogsView from './SyncLogsView.vue';

/** "Integrazione" raggruppa credenziali e log di sincronizzazione in un'unica voce di menu. */
const activeTab = ref('credenziali');
interface SettingsResponse {
  values: { baseUrl: string; serialNumber: string; password: string; supplierField: string };
  status: { configured: boolean; baseUrl: string };
}

const loading = ref(true);
const saving = ref(false);
const resetting = ref(false);
const testing = ref(false);
const status = ref<SettingsResponse['status'] | null>(null);
const testResult = ref<{ ok: boolean; message: string; expiresIn?: number } | null>(null);


/** Campo personalizzato Dinghuobao usato per il fornitore dell'articolo. */
const supplierFieldOptions = [
  { value: 'field_1', label: 'Campo personalizzato 1' },
  { value: 'field_2', label: 'Campo personalizzato 2' },
  { value: 'field_3', label: 'Campo personalizzato 3' },
  { value: 'field_4', label: 'Campo personalizzato 4' },
  { value: 'field_5', label: 'Campo personalizzato 5' },
  { value: 'field_6', label: 'Campo personalizzato 6' },
];

const form = reactive({ baseUrl: '', serialNumber: '', password: '', supplierField: 'field_6' });

function apply(data: SettingsResponse) {
  status.value = data.status;
  form.baseUrl = data.values.baseUrl ?? '';
  form.serialNumber = data.values.serialNumber ?? '';
  form.password = data.values.password ?? '';
  form.supplierField = data.values.supplierField || 'field_6';
}

async function load() {
  loading.value = true;
  try {
    apply((await getSettings()) as SettingsResponse);
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    loading.value = false;
  }
}

async function save() {
  saving.value = true;
  testResult.value = null;
  try {
    const data = (await saveSettings({
      baseUrl: form.baseUrl,
      serialNumber: form.serialNumber,
      password: form.password,
      supplierField: form.supplierField,
    })) as SettingsResponse;
    apply(data);
    message.success('Configurazione salvata');
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    saving.value = false;
  }
}

async function test() {
  testing.value = true;
  testResult.value = null;
  try {
    testResult.value = await testSettings();
  } catch (error) {
    testResult.value = { ok: false, message: (error as Error).message };
  } finally {
    testing.value = false;
  }
}

function expiresLabel(seconds?: number): string {
  if (!seconds) return '';
  return ` (valido circa ${Math.round(seconds / 3600)} ore)`;
}

onMounted(load);

/** Azzera i dati di esercizio quando si collega un altro gestionale Dinghuobao. */
function onReset() {
  Modal.confirm({
    title: 'Reinizializzare tutti i dati?',
    content:
      'Vengono eliminati ordini, articoli, fornitori, spedizioni, account fornitore e log di sincronizzazione. Le credenziali restano invariate. L operazione non puo essere annullata.',
    okText: 'Reinizializza',
    okType: 'danger',
    cancelText: 'Annulla',
    async onOk() {
      resetting.value = true;
      try {
        const result = await resetData();
        message.success(
          `Dati azzerati: ${result.deleted.orders} ordini, ${result.deleted.products} articoli, ${result.deleted.accounts} account fornitore`,
        );
        await load();
      } catch (error) {
        message.error((error as Error).message);
      } finally {
        resetting.value = false;
      }
    },
  });
}
</script>

<template>
  <div class="page">
    <header class="page-heading">
      <div>
        <h1>Integrazione</h1>
        <p>Credenziali Dinghuobao, mappatura articoli e log di sincronizzazione.</p>
      </div>
      <div v-if="activeTab === 'credenziali'" class="heading-actions">
        <a-button :loading="testing" :disabled="loading" @click="test">
          <template #icon><ApiOutlined /></template>
          Verifica connessione
        </a-button>
        <a-button type="primary" :loading="saving" @click="save">
          <template #icon><SaveOutlined /></template>
          Salva
        </a-button>
      </div>
    </header>

    <a-tabs v-model:activeKey="activeTab">
      <a-tab-pane key="credenziali" tab="Credenziali">
    <a-alert
      v-if="status && !status.configured"
      type="warning"
      show-icon
      class="settings-alert"
      message="Credenziali Dinghuobao non configurate"
      description="La sincronizzazione e sospesa finche non salvi numero seriale e password."
    />

    <a-alert
      v-if="testResult"
      :type="testResult.ok ? 'success' : 'error'"
      show-icon
      class="settings-alert"
      :message="testResult.ok ? 'Connessione riuscita' : 'Connessione non riuscita'"
      :description="`${testResult.message}${expiresLabel(testResult.expiresIn)}`"
    />

    <a-spin :spinning="loading">
      <a-form layout="vertical">
        <section class="panel">
          <div class="panel-head">
            <div>
              <h2>Dinghuobao ERP</h2>
              <p class="muted">Stesso accesso per lettura ordini, articoli e anagrafiche e per la registrazione delle spedizioni.</p>
            </div>
            <span class="credential-state" :class="{ configured: status?.configured }">
              <span class="dot" />
              {{ status?.configured ? 'Configurato' : 'Non configurato' }}
            </span>
          </div>
          <div class="panel-body">
            <div class="form-grid">
              <a-form-item class="span-all" label="URL base">
                <a-input v-model:value="form.baseUrl" :placeholder="status?.baseUrl" />
              </a-form-item>
              <a-form-item label="Numero seriale">
                <a-input v-model:value="form.serialNumber" class="mono-input" placeholder="Numero seriale fornito da Dinghuobao" />
              </a-form-item>
              <a-form-item label="Password">
                <a-input v-model:value="form.password" class="mono-input" placeholder="Password fornita da Dinghuobao" />
              </a-form-item>
              <a-form-item class="span-all" label="Campo fornitore articolo">
                <a-select v-model:value="form.supplierField" :options="[{ value: '', label: 'Nessuno' }, ...supplierFieldOptions]" />
              </a-form-item>
            </div>
            <p class="hint">
              <InfoCircleOutlined />
              Le credenziali sono cifrate nel database. Lascia invariato il valore mascherato (****) per non modificare un dato già salvato.
            </p>
            <p class="hint">
              <InfoCircleOutlined />
              Il valore di questo campo personalizzato in Dinghuobao diventa il fornitore dell'articolo, ma solo se corrisponde a un fornitore presente in anagrafica. Gli altri valori vengono ignorati.
            </p>
          </div>
        </section>

        <section class="panel danger-panel">
          <div class="panel-head">
            <div>
              <h2>Cambio gestionale</h2>
              <p class="muted">Collega un altro numero seriale Dinghuobao: prima salva le nuove credenziali, poi azzera i dati di esercizio.</p>
            </div>
          </div>
          <div class="panel-body">
            <p class="hint">
              <InfoCircleOutlined />
              Vengono eliminati ordini, articoli, fornitori, spedizioni, account fornitore e log di sincronizzazione. Le credenziali restano invariate. Ordine corretto: salva le nuove credenziali e verifica la connessione, poi reinizializza e sincronizza.
            </p>
            <a-alert
              v-if="status && !status.configured"
              type="warning"
              show-icon
              message="Credenziali Dinghuobao non configurate"
              description="La sincronizzazione e sospesa. Salva prima numero seriale e password."
            />
            <a-button danger :loading="resetting" :disabled="!status?.configured" @click="onReset">
              <template #icon><DeleteOutlined /></template>
              Reinizializza dati
            </a-button>
          </div>
        </section>
      </a-form>
        </a-spin>
      </a-tab-pane>
      <a-tab-pane key="log" tab="Log sincronizzazione">
        <SyncLogsView embedded />
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<style scoped>
.settings-alert {
  margin-bottom: 16px;
}

.heading-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.panel {
  margin-bottom: 20px;
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--oe-border);
}

.panel-head h2 {
  margin: 0;
  font-family: var(--oe-font-display);
  font-size: 19px;
}

.panel-head p {
  margin: 4px 0 0;
}

.span-all {
  grid-column: 1 / -1;
}

.mono-input :deep(input) {
  font-family: var(--oe-font-mono);
  letter-spacing: 0.02em;
}

.hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0 0;
  color: var(--oe-text-muted);
  font-size: 13px;
}

/* Zona pericolosa: cambio gestionale Dinghuobao con azzeramento dei dati. */
.danger-panel {
  border-color: var(--oe-danger);
}

.danger-panel .panel-head h2 {
  color: var(--oe-danger);
}

.danger-panel .panel-body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}

.danger-panel .hint {
  align-items: flex-start;
}
</style>
