<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();
</script>

<template>
  <div class="notfound">
    <h1>404</h1>
    <p>La pagina richiesta non esiste.</p>
    <a-button type="primary" @click="router.push('/dashboard')">Torna alla panoramica</a-button>
  </div>
</template>

<style scoped>
.notfound {
  min-height: 100vh;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 10px;
  text-align: center;
}

.notfound h1 {
  margin: 0;
  font-family: var(--oe-font-display);
  font-size: 64px;
  color: var(--oe-text-muted);
}
</style>
