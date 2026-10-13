<script setup lang="ts">
import { ref } from 'vue';
import { ArrowDownOutlined, ArrowUpOutlined, HolderOutlined } from '@ant-design/icons-vue';

interface PickerItem {
  key: string;
  title: string;
}

withDefaults(
  defineProps<{
    items: PickerItem[];
    hidden: string[];
    heading?: string;
    resetLabel?: string;
    gripTitle?: string;
  }>(),
  {
    heading: 'Colonne visibili',
    resetLabel: 'Ripristina',
    gripTitle: 'Trascina per riordinare',
  },
);

const emit = defineEmits<{
  (e: 'toggle', key: string): void;
  (e: 'move', key: string, direction: -1 | 1): void;
  (e: 'reorder', keys: string[]): void;
  (e: 'reset'): void;
}>();

const dragKey = ref<string | null>(null);
const overKey = ref<string | null>(null);

function onDragStart(key: string) {
  dragKey.value = key;
}

function onDragOver(key: string) {
  if (dragKey.value && dragKey.value !== key) overKey.value = key;
}

function onDragEnd() {
  dragKey.value = null;
  overKey.value = null;
}

/** Rilascia sopra un'altra voce: la voce trascinata prende la posizione di quella di destinazione. */
function onDrop(targetKey: string, items: PickerItem[]) {
  const from = dragKey.value;
  onDragEnd();
  if (!from || from === targetKey) return;
  const keys = items.map((i) => i.key);
  const fromIdx = keys.indexOf(from);
  if (fromIdx < 0 || !keys.includes(targetKey)) return;
  keys.splice(fromIdx, 1);
  keys.splice(keys.indexOf(targetKey), 0, from);
  emit('reorder', keys);
}
</script>

<template>
  <div class="oe-colset">
    <div class="oe-colset-head">
      <span>{{ heading }}</span>
      <a @click="emit('reset')">{{ resetLabel }}</a>
    </div>
    <ul class="oe-colset-list">
      <li
        v-for="(item, index) in items"
        :key="item.key"
        class="oe-colset-row"
        :class="{ 'is-dragging': dragKey === item.key, 'is-over': overKey === item.key }"
        @dragover.prevent="onDragOver(item.key)"
        @drop.prevent="onDrop(item.key, items)"
      >
        <span
          class="oe-colset-grip"
          draggable="true"
          :title="gripTitle"
          @dragstart="onDragStart(item.key)"
          @dragend="onDragEnd"
        >
          <HolderOutlined />
        </span>
        <a-checkbox :checked="!hidden.includes(item.key)" @change="emit('toggle', item.key)">
          {{ item.title }}
        </a-checkbox>
        <span class="oe-colset-move">
          <a-button type="text" size="small" :disabled="index === 0" @click="emit('move', item.key, -1)">
            <template #icon><ArrowUpOutlined /></template>
          </a-button>
          <a-button
            type="text"
            size="small"
            :disabled="index === items.length - 1"
            @click="emit('move', item.key, 1)"
          >
            <template #icon><ArrowDownOutlined /></template>
          </a-button>
        </span>
      </li>
    </ul>
  </div>
</template>
