<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { message } from 'ant-design-vue';
import { api } from '../api/client';
import OrderPrintSheet from '../components/OrderPrintSheet.vue';
import type { OrderPrintData } from '../types/print';

/**
 * Pagina di stampa dedicata (/print/order/:id).
 * La stampa usata dal gestionale e' in modale (OrderPrintModal): questa rotta resta
 * per i link diretti e per chi vuole il foglio a pagina intera.
 */
const route = useRoute();
const data = ref<OrderPrintData | null>(null);
const loading = ref(true);

function doPrint() {
  window.print();
}

function closeWindow() {
  window.close();
}

onMounted(async () => {
  try {
    const response = await api.get<OrderPrintData>(`/orders/${route.params.id}/print`);
    data.value = response.data;
    setTimeout(() => window.print(), 350);
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="print-page">
    <div class="toolbar no-print">
      <a-button type="primary" @click="doPrint">Stampa</a-button>
      <a-button @click="closeWindow">Chiudi</a-button>
    </div>

    <div v-if="loading" class="loading">Caricamento…</div>
    <OrderPrintSheet v-else-if="data" :data="data" />
  </div>
</template>

<style scoped>
.print-page {
  padding: 24px;
  max-width: 900px;
  margin: 0 auto;
}

.toolbar {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-bottom: 16px;
}

.loading {
  padding: 60px;
  text-align: center;
  color: var(--oe-text-muted);
}

@media print {
  .print-page {
    padding: 0;
    max-width: none;
  }
}
</style>
