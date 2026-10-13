<script setup lang="ts">
import { computed } from 'vue';
import { orderStatusLabel, shipmentStatusLabel, syncStatusLabel } from '../utils/format';

const props = defineProps<{
  status?: string | number | null;
  kind?: 'order' | 'shipment' | 'sync' | 'account';
}>();

const label = computed(() => {
  if (props.kind === 'shipment') return shipmentStatusLabel(props.status as string);
  if (props.kind === 'sync') return syncStatusLabel(props.status as string);
  if (props.kind === 'account') return Number(props.status) === 1 ? 'Attivo' : 'Disattivato';
  return orderStatusLabel(props.status as string);
});

const color = computed(() => {
  if (props.kind === 'account') return Number(props.status) === 1 ? 'green' : 'default';
  const map: Record<string, string> = {
    pricing: 'purple',
    pending: 'gold',
    stockup: 'orange',
    shipped: 'cyan',
    received: 'blue',
    receiveding: 'blue',
    receivedin: 'blue',
    finished: 'green',
    forcedone: 'green',
    cancelled: 'default',
    failed: 'red',
    ok: 'green',
    fail: 'red',
  };
  return map[String(props.status ?? '')] ?? 'default';
});
</script>

<template>
  <a-tag :color="color">{{ label }}</a-tag>
</template>
