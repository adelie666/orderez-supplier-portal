import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import * as authApi from '../api';
import { TOKEN_KEY } from '../api/client';
import type { User } from '../types';

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem(TOKEN_KEY));
  const user = ref<User | null>(null);
  const ready = ref(false);

  const isAdmin = computed(() => user.value?.role === 'admin');
  const isSupplier = computed(() => user.value?.role === 'supplier');

  async function login(username: string, password: string) {
    const result = await authApi.login(username, password);
    token.value = result.token;
    user.value = result.user;
    localStorage.setItem(TOKEN_KEY, result.token);
  }

  async function fetchMe() {
    if (!token.value) {
      ready.value = true;
      return null;
    }
    try {
      user.value = await authApi.me();
    } catch {
      logout();
    } finally {
      ready.value = true;
    }
    return user.value;
  }

  function logout() {
    token.value = null;
    user.value = null;
    localStorage.removeItem(TOKEN_KEY);
  }

  return { token, user, ready, isAdmin, isSupplier, login, fetchMe, logout };
});
