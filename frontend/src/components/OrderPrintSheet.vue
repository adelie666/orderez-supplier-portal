<script setup lang="ts">
import { formatDateTime } from '../utils/format';
import type { OrderPrintData } from '../types/print';

/**
 * Scheda ordine/spedizione stampabile (un foglio per ordine).
 * Usata sia nella modale di stampa in pagina sia nella pagina di stampa dedicata.
 */
defineProps<{ data: OrderPrintData }>();

function num(value: unknown, digits = 2): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toFixed(digits) : '0.00';
}
</script>

<template>
  <article class="oe-print-sheet sheet">
    <header class="sheet-head">
      <div class="brand">
        <div class="brand-line">
          <img class="brand-logo" src="/orderez-mark.svg" alt="OrderEZ" />
          <h1>OrderEZ</h1>
        </div>
        <p>Scheda ordine / spedizione</p>
      </div>
      <div class="meta-right">
        <div><span>Ordine</span><strong>{{ data.order.ordersNum }}</strong></div>
        <div><span>Data e ora ordine</span><strong>{{ formatDateTime(data.order.createdAt) }}</strong></div>
        <div><span>Stampato il</span><strong>{{ data.order.printedAt }}</strong></div>
      </div>
    </header>

    <section class="info-grid">
      <div><span>Cliente</span>{{ data.order.clientName || '—' }}</div>
      <div><span>Stato</span>{{ data.order.statusName || data.order.status || '—' }}</div>
      <div><span>Contatto</span>{{ data.order.consigneeContact || '—' }}</div>
      <div><span>Telefono</span>{{ data.order.consigneePhone || '—' }}</div>
      <div class="wide"><span>Indirizzo</span>{{ data.order.consigneeAddress || '—' }}</div>
    </section>

    <table class="lines">
      <thead>
        <tr>
          <th>Codice</th>
          <th>Descrizione</th>
          <th class="right">Q.tà</th>
          <th>Unità</th>
          <th class="right">Prezzo</th>
          <th class="right">Importo</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(item, index) in data.items" :key="index">
          <td>{{ item.goodsNum || '—' }}</td>
          <td>{{ item.goodsName || item.optionsName || '—' }}</td>
          <td class="right">{{ num(item.qty, 4) }}</td>
          <td>{{ item.unit || '—' }}</td>
          <td class="right">{{ num(item.unitPrice) }}</td>
          <td class="right">{{ num(item.amount) }}</td>
        </tr>
        <tr v-if="!data.items.length">
          <td colspan="6" class="empty">Nessuna riga</td>
        </tr>
      </tbody>
    </table>

    <footer class="sheet-foot">
      <span>Sconto: {{ num(data.order.discountTotal) }} EUR</span>
      <span>Trasporto: {{ num(data.order.freight) }} EUR</span>
    </footer>
  </article>
</template>

<style scoped>
.sheet {
  border: 1px solid var(--oe-border);
  border-radius: 8px;
  padding: 28px;
  background: #fff;
}

.sheet-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  border-bottom: 2px solid var(--gray-900);
  padding-bottom: 14px;
}

.brand-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.brand-logo {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  object-fit: cover;
}

.sheet-head h1 {
  margin: 0;
  font-family: var(--oe-font-display);
  letter-spacing: 0.06em;
}

.sheet-head p {
  margin: 2px 0 0;
  color: var(--oe-text-muted);
}

.meta-right {
  display: grid;
  grid-template-columns: repeat(3, auto);
  gap: 2px 28px;
  text-align: right;
}

.meta-right div {
  margin: 0;
}

.meta-right span,
.info-grid span {
  display: block;
  color: var(--oe-text-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px 20px;
  margin: 16px 0;
}

.info-grid .wide {
  grid-column: 1 / -1;
}

.lines {
  width: 100%;
  border-collapse: collapse;
  margin-top: 8px;
}

.lines th,
.lines td {
  border-bottom: 1px solid var(--oe-border);
  padding: 8px 10px;
  text-align: left;
}

.lines th {
  background: var(--gray-100);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.lines .right {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.empty {
  text-align: center;
  color: var(--oe-text-muted);
}

.sheet-foot {
  display: flex;
  justify-content: flex-end;
  gap: 28px;
  margin-top: 16px;
  font-weight: 600;
}
</style>
