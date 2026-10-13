<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { message } from 'ant-design-vue';
import { PrinterOutlined, ReloadOutlined } from '@ant-design/icons-vue';
import { api } from '../api/client';
import OrderPrintSheet from './OrderPrintSheet.vue';
import type { OrderPrintData } from '../types/print';

/**
 * Stampa in pagina: apre i fogli in una modale, cosi' l'operatore resta nel gestionale
 * e chiude la finestra senza passare da un'altra scheda del browser.
 * Supporta piu' ordini: uno per foglio, ognuno su una pagina separata in stampa.
 */
const props = defineProps<{
  open: boolean;
  orderIds: number[];
}>();

const emit = defineEmits<{ 'update:open': [value: boolean] }>();

const sheets = ref<OrderPrintData[]>([]);
const loading = ref(false);

/** Classe sul body: il CSS di stampa nasconde l'applicazione sottostante. */
function setPrintingClass(on: boolean) {
  if (typeof document === 'undefined') return;
  document.body.classList.toggle('oe-printing', on);
}

async function loadSheets() {
  const ids = props.orderIds ?? [];
  if (!ids.length) {
    sheets.value = [];
    return;
  }
  loading.value = true;
  try {
    // Sequenziale: la stampa in blocco puo' includere molti ordini e non serve
    // aprire decine di richieste insieme; ogni scheda e' una lettura locale.
    const results: OrderPrintData[] = [];
    for (const id of ids) {
      const response = await api.get<OrderPrintData>(`/orders/${id}/print`);
      results.push(response.data);
    }
    sheets.value = results;
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    loading.value = false;
  }
}

function doPrint() {
  if (!sheets.value.length) return;
  // Attende il frame successivo: il foglio e' gia' montato, ma il browser
  // deve applicare gli stili di stampa prima di aprire il dialogo.
  window.requestAnimationFrame(() => window.print());
}

function close() {
  setPrintingClass(false);
  emit('update:open', false);
}

watch(
  () => props.open,
  (open) => {
    setPrintingClass(open);
    if (open) void loadSheets();
  },
);

watch(
  () => props.orderIds,
  () => {
    if (props.open) void loadSheets();
  },
);

// Se si cambia pagina con la modale aperta la classe resterebbe sul body.
onBeforeUnmount(() => setPrintingClass(false));
</script>

<template>
  <a-modal
    :open="open"
    :footer="null"
    :width="1180"
    :title="`Stampa ${orderIds.length === 1 ? 'ordine' : 'ordini'} (${orderIds.length})`"
    wrap-class-name="oe-print-modal"
    :destroy-on-close="true"
    @cancel="close"
  >
    <div class="oe-print-toolbar">
      <a-button :loading="loading" @click="loadSheets">
        <template #icon><ReloadOutlined /></template>
        Ricarica
      </a-button>
      <div class="oe-print-toolbar-actions">
        <a-button type="primary" :loading="loading" :disabled="!sheets.length" @click="doPrint">
          <template #icon><PrinterOutlined /></template>
          Stampa
        </a-button>
        <a-button @click="close">Chiudi</a-button>
      </div>
    </div>

    <div class="oe-print-scroll">
      <div v-if="loading" class="oe-print-loading">Caricamento…</div>
      <template v-else>
        <OrderPrintSheet v-for="(sheet, index) in sheets" :key="index" :data="sheet" class="oe-print-sheet-item" />
        <p v-if="!sheets.length" class="oe-print-loading">Nessun ordine da stampare.</p>
      </template>
    </div>
  </a-modal>
</template>

<style scoped>
.oe-print-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--oe-border-light);
  margin-bottom: 14px;
}

.oe-print-toolbar-actions {
  display: flex;
  gap: 8px;
}

.oe-print-scroll {
  max-height: calc(100vh - 260px);
  overflow: auto;
  padding: 4px 2px 8px;
  background: var(--gray-100);
}

/* Un foglio per blocco, separati visivamente a schermo; in stampa vanno su pagine diverse. */
.oe-print-sheet-item {
  margin: 0 auto 16px;
  max-width: 900px;
}

.oe-print-sheet-item:last-child {
  margin-bottom: 0;
}

.oe-print-loading {
  padding: 48px;
  text-align: center;
  color: var(--oe-text-muted);
}
</style>
