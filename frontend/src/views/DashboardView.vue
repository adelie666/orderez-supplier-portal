<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import { ReloadOutlined } from '@ant-design/icons-vue';
import { dashboard } from '../api';
import { formatEur, formatQty } from '../utils/format';
import { useAuthStore } from '../stores/auth';
import ProductThumb from '../components/ProductThumb.vue';

interface TopProduct {
  goodsNum: string;
  goodsName: string;
  optionsName: string;
  imageUrl?: string | null;
  baseUnits?: string | null;
  qty: number;
  amount: number;
}


const router = useRouter();
const auth = useAuthStore();
const loading = ref(true);

const kpi = ref({ toShip: 0, shippedToday: 0, monthAmount: 0, monthQty: 0 });
const queue = ref({ stockup: 0, pending: 0, failedShipments: 0, awaitingReceipt: 0 });
const topProducts = ref<TopProduct[]>([]);


const greeting = computed(() => {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).format(new Date()),
  );
  if (hour < 12) return 'Buongiorno';
  if (hour < 18) return 'Buon pomeriggio';
  return 'Buonasera';
});

const displayName = computed(() => auth.user?.supplierName || auth.user?.username || '');

/** Coda di lavoro: ogni voce porta alla pagina che la risolve. */
const queueItems = computed(() => {
  const items = [
    {
      key: 'stockup',
      label: 'Ordini da evadere',
      count: queue.value.stockup,
      to: '/orders?status=stockup',
      tone: 'warn' as const,
    },
    {
      key: 'pending',
      label: 'Ordini in attesa di approvazione',
      count: queue.value.pending,
      to: '/orders?status=pending',
      tone: 'muted' as const,
    },
    {
      key: 'failed',
      label: 'Spedizioni in errore',
      count: queue.value.failedShipments,
      to: '/orders?shipmentState=failed',
      tone: 'danger' as const,
    },
    {
      key: 'awaiting',
      label: 'Spedizioni in attesa di ricezione',
      count: queue.value.awaitingReceipt,
      to: '/orders?shipmentState=awaiting',
      tone: 'info' as const,
    },
  ];
  return items;
});

const maxQty = computed(() => Math.max(1, ...topProducts.value.map((product) => product.qty)));

function barWidth(qty: number): string {
  return `${Math.max(4, Math.round((qty / maxQty.value) * 100))}%`;
}

async function load() {
  loading.value = true;
  try {
    const data = await dashboard();
    kpi.value = data.kpi;
    queue.value = data.queue ?? { stockup: 0, pending: 0, failedShipments: 0, awaitingReceipt: 0 };
    topProducts.value = data.topProducts ?? [];

  } catch (error) {
    message.error((error as Error).message);
  } finally {
    loading.value = false;
  }
}

function go(path: string) {
  router.push(path);
}

onMounted(load);
</script>

<template>
  <div class="oe-list-page">
    <div class="oe-bread-area">
      <div class="oe-bread-left">
        <h1 class="oe-bread-title">Panoramica</h1>
        <span class="oe-bread-sub">{{ greeting }}, {{ displayName }}. Stato operativo di oggi.</span>
      </div>
      <div class="oe-bread-actions">
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
            <span class="oe-kpi-label">Ordini da evadere</span>
            <strong class="oe-kpi-value">{{ kpi.toShip }}</strong>
          </div>
          <div class="oe-kpi">
            <span class="oe-kpi-label">Spedizioni di oggi</span>
            <strong class="oe-kpi-value">{{ kpi.shippedToday }}</strong>
          </div>
          <div class="oe-kpi">
            <span class="oe-kpi-label">Importo ordinato nel mese</span>
            <strong class="oe-kpi-value">{{ formatEur(kpi.monthAmount) }}</strong>
            <span class="oe-kpi-foot">{{ formatQty(kpi.monthQty) }} unità</span>
          </div>

        </div>

        <div class="dash-grid">
          <section class="oe-main-card">
            <header class="dash-head">
              <h2>Coda di lavoro</h2>
              <span class="dash-head-hint">Da gestire oggi</span>
            </header>
            <div class="dash-queue">
              <button
                v-for="item in queueItems"
                :key="item.key"
                type="button"
                class="dash-queue-item"
                :class="{ 'is-empty': !item.count }"
                @click="go(item.to)"
              >
                <span class="dash-queue-label">{{ item.label }}</span>
                <span class="dash-queue-count" :data-tone="item.tone">{{ item.count }}</span>
              </button>
            </div>
          </section>

          <section class="oe-main-card">
            <header class="dash-head">
              <h2>Prodotti più venduti</h2>
              <span class="dash-head-hint">Mese corrente</span>
            </header>
            <div v-if="topProducts.length" class="dash-rank">
              <div v-for="(item, index) in topProducts" :key="item.goodsNum + item.optionsName" class="dash-rank-row">
                <span class="dash-rank-idx">{{ index + 1 }}</span>
                <ProductThumb :src="item.imageUrl" :alt="item.goodsName || item.goodsNum" :size="40" />
                <div class="dash-rank-body">
                  <span class="dash-rank-name">{{ item.goodsName || item.goodsNum }}</span>
                  <span class="dash-rank-meta">{{ item.goodsNum }} · {{ formatEur(item.amount) }}</span>
                  <span class="dash-rank-bar"><i :style="{ width: barWidth(item.qty) }" /></span>
                </div>
                <strong class="dash-rank-qty">
                  {{ formatQty(item.qty) }}
                  <span v-if="item.baseUnits" class="dash-rank-unit">{{ item.baseUnits }}</span>
                </strong>
              </div>
            </div>
            <p v-else class="dash-empty">Nessun ordine registrato nel mese corrente.</p>
          </section>


        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.oe-kpi-foot {
  color: var(--oe-text-muted);
  font-size: 12.5px;
}

.dash-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: stretch;
}

.dash-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--oe-border-light);
}

.dash-head h2 {
  margin: 0;
  font-family: var(--oe-font-display);
  font-size: 17px;
  font-weight: 600;
}

.dash-head-hint {
  color: var(--oe-text-muted);
  font-size: 12.5px;
}

.dash-queue {
  display: grid;
}

.dash-queue-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 13px 18px;
  border: 0;
  border-bottom: 1px solid var(--oe-border-light);
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.dash-queue-item:last-child {
  border-bottom: 0;
}

.dash-queue-item:hover {
  background: var(--gray-150);
}

.dash-queue-item.is-empty .dash-queue-label {
  color: var(--oe-text-muted);
}

.dash-queue-label {
  font-size: 14px;
  color: var(--oe-text);
}

.dash-queue-count {
  min-width: 34px;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--gray-100);
  color: var(--oe-text-secondary);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.dash-queue-count[data-tone='warn'] {
  background: rgba(217, 119, 87, 0.16);
  color: var(--clay-dark);
}

.dash-queue-count[data-tone='danger'] {
  background: rgba(191, 77, 67, 0.14);
  color: var(--oe-danger);
}

.dash-queue-count[data-tone='info'] {
  background: rgba(106, 155, 204, 0.16);
  color: #34688f;
}

.dash-rank {
  display: grid;
  /* La traccia deve poter restringere: altrimenti i nomi lunghi allargano la riga oltre la card. */
  grid-template-columns: minmax(0, 1fr);
}

.dash-rank-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 11px 18px;
  border-bottom: 1px solid var(--oe-border-light);
}

.dash-rank-row:last-child {
  border-bottom: 0;
}

.dash-rank-idx {
  width: 20px;
  color: var(--oe-text-muted);
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.dash-rank-body {
  flex: 1;
  min-width: 0;
}

.dash-rank-name {
  display: block;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dash-rank-meta {
  display: block;
  margin-top: 2px;
  color: var(--oe-text-muted);
  font-size: 12.5px;
}

.dash-rank-bar {
  display: block;
  height: 4px;
  margin-top: 6px;
  border-radius: 2px;
  background: var(--gray-150);
  overflow: hidden;
}

.dash-rank-bar i {
  display: block;
  height: 100%;
  background: var(--clay);
}

.dash-rank-qty {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* Unita' di misura accanto alla quantita' venduta (kg, pz, ct...) */
.dash-rank-unit {
  margin-left: 3px;
  color: var(--oe-text-muted);
  font-size: 12px;
  font-weight: 500;
}

.dash-empty {
  margin: 0;
  padding: 22px 18px;
  color: var(--oe-text-muted);
  text-align: center;
}

@media (max-width: 1100px) {
  .dash-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
