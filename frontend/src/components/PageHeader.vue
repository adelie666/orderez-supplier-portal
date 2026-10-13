<script setup lang="ts">
defineProps<{ title: string; description?: string }>();
</script>

<template>
  <header class="page-heading">
    <div>
      <h1>{{ title }}</h1>
      <p v-if="description">{{ description }}</p>
    </div>
    <div class="heading-actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.heading-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
</style>
