<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import { LockOutlined, UserOutlined } from '@ant-design/icons-vue';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const auth = useAuthStore();
const loading = ref(false);
const form = reactive({ username: '', password: '' });

async function submit() {
  if (!form.username.trim() || !form.password) {
    message.warning('Inserisci username e password');
    return;
  }
  loading.value = true;
  try {
    await auth.login(form.username.trim(), form.password);
    await router.push('/dashboard');
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-shell">
    <section class="login-brand">
      <img class="brand-logo" src="/orderez-mark.svg" alt="OrderEZ" />
      <div>
        <h1>OrderEZ</h1>
        <p>Portale gestione fornitori</p>
      </div>
    </section>

    <section class="login-panel">
      <div class="login-card">
        <h2>Accedi</h2>
        <p class="lead">Inserisci le credenziali fornite dall'amministratore.</p>
        <a-form layout="vertical" @submit.prevent="submit">
          <a-form-item label="Username">
            <a-input v-model:value="form.username" size="large" autofocus placeholder="nome utente">
              <template #prefix><UserOutlined /></template>
            </a-input>
          </a-form-item>
          <a-form-item label="Password">
            <a-input-password v-model:value="form.password" size="large" placeholder="password">
              <template #prefix><LockOutlined /></template>
            </a-input-password>
          </a-form-item>
          <a-button type="primary" size="large" block :loading="loading" @click="submit">
            Accedi
          </a-button>
        </a-form>
      </div>
      <p class="foot">OrderEZ · Gestione fornitori · Fuso orario Europe/Rome</p>
    </section>
  </div>
</template>

<style scoped>
.login-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(320px, 42%) 1fr;
}

.login-brand {
  background: var(--gray-950);
  color: var(--gray-050);
  padding: 48px;
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.brand-logo {
  width: 46px;
  height: 46px;
  border-radius: 10px;
  object-fit: cover;
  flex: 0 0 auto;
}

.login-brand h1 {
  margin: 0;
  font-family: var(--oe-font-display);
  font-size: 30px;
  letter-spacing: 0.04em;
}

.login-brand p {
  margin: 6px 0 0;
  color: var(--gray-400);
}

.login-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
}

.login-card {
  width: 100%;
  max-width: 380px;
}

.login-card h2 {
  margin: 0 0 6px;
  font-family: var(--oe-font-display);
  font-size: 26px;
}

.lead {
  margin: 0 0 22px;
  color: var(--oe-text-muted);
}

.foot {
  margin-top: 40px;
  color: var(--oe-text-muted);
  font-size: 12.5px;
}

@media (max-width: 860px) {
  .login-shell {
    grid-template-columns: 1fr;
  }

  .login-brand {
    padding: 22px 24px;
  }

  .login-panel {
    justify-content: flex-start;
    padding-top: 40px;
  }
}
</style>
