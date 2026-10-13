<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { PictureOutlined } from '@ant-design/icons-vue';

const props = withDefaults(
  defineProps<{
    src?: string | null;
    alt?: string;
    size?: number;
  }>(),
  { size: 38 },
);

const failed = ref(false);
watch(
  () => props.src,
  () => {
    failed.value = false;
  },
);

const show = computed(() => !!props.src && !failed.value);
</script>

<template>
  <span class="oe-thumb" :style="{ width: `${size}px`, height: `${size}px` }">
    <!-- Il server immagini dell'ERP blocca l'hotlinking se arriva un Referer: va omesso.
         referrerpolicy="no-referrer" e' obbligatorio, altrimenti l'immagine da 403. -->
    <img
      v-if="show"
      :src="src ?? ''"
      :alt="alt || ''"
      loading="lazy"
      referrerpolicy="no-referrer"
      @error="failed = true"
    />
    <PictureOutlined v-else class="oe-thumb-fallback" />
  </span>
</template>

<style scoped>
.oe-thumb {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid var(--oe-border-light);
  border-radius: 6px;
  background: var(--gray-050, #faf9f7);
  flex: 0 0 auto;
}

.oe-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.oe-thumb-fallback {
  color: var(--oe-text-muted);
  font-size: 16px;
}
</style>
