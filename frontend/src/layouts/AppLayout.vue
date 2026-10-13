<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  AppstoreOutlined,
  BarChartOutlined,
  CloseOutlined,
  DashboardOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  KeyOutlined,
  LogoutOutlined,
  MenuOutlined,
  ReloadOutlined,
  ShoppingOutlined,
  SettingOutlined,
  SoundFilled,
  SoundOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons-vue';
import { message } from 'ant-design-vue';
import { changePassword, health, latestOrderNotification } from '../api';
import { useAuthStore } from '../stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const mobileOpen = ref(false);
const demoMode = ref(false);

const nav = computed(() => {
  if (auth.isSupplier) {
    return [
      { to: '/dashboard', label: 'Panoramica', icon: DashboardOutlined },
      { to: '/orders', label: 'I miei ordini', icon: FileTextOutlined },
      { to: '/reports', label: 'Il mio report', icon: BarChartOutlined },
      { to: '/products', label: 'I miei articoli', icon: ShoppingOutlined },
    ];
  }
  return [
    { to: '/dashboard', label: 'Panoramica', icon: DashboardOutlined },
    { to: '/orders', label: 'Ordini', icon: FileTextOutlined },
    { to: '/reports', label: 'Report', icon: BarChartOutlined },
    { to: '/products', label: 'Articoli', icon: ShoppingOutlined },
    { to: '/accounts', label: 'Account', icon: TeamOutlined },
    { to: '/settings', label: 'Integrazione', icon: SettingOutlined },
  ];
});

/** Tabelle di lavoro nella testata: si aprono navigando e si chiudono con la "x" (stile gestionale). */
interface OpenTab {
  path: string;
  label: string;
  icon: unknown;
}

const TABS_STORAGE = 'orderez-open-tabs-v1';

/** Le pagine di dettaglio (/orders/12) afferiscono alla tab della lista (/orders). */
function basePath(path: string): string {
  const matches = nav.value.filter((item) => path === item.to || path.startsWith(`${item.to}/`));
  return matches.length ? matches[matches.length - 1].to : path;
}

function tabMeta(path: string) {
  return nav.value.find((item) => item.to === path) ?? { label: 'OrderEZ', icon: AppstoreOutlined };
}

function readTabs(): OpenTab[] {
  try {
    const raw = localStorage.getItem(TABS_STORAGE);
    if (!raw) return [];
    const paths = JSON.parse(raw) as unknown;
    if (!Array.isArray(paths)) return [];
    return paths
      .filter((p): p is string => typeof p === 'string')
      .filter((p) => nav.value.some((item) => item.to === p))
      .map((p) => ({ path: p, ...tabMeta(p) }));
  } catch {
    return [];
  }
}

const openTabs = ref<OpenTab[]>(readTabs());

function persistTabs() {
  localStorage.setItem(TABS_STORAGE, JSON.stringify(openTabs.value.map((tab) => tab.path)));
}

function syncTabs(path: string) {
  const clean = basePath(path);
  if (!nav.value.some((item) => item.to === clean)) return;
  if (openTabs.value.some((tab) => tab.path === clean)) return;
  openTabs.value.push({ path: clean, ...tabMeta(clean) });
  persistTabs();
}

syncTabs(route.path);

watch(
  () => [route.path, auth.user?.role] as const,
  () => {
    // Al cambio di ruolo (login/logout) si scartano le tab non piu' valide.
    openTabs.value = openTabs.value.filter((tab) => nav.value.some((item) => item.to === tab.path));
    syncTabs(route.path);
  },
);

function selectTab(path: string) {
  if (route.path !== path) router.push(path);
}

function closeTab(path: string) {
  const index = openTabs.value.findIndex((tab) => tab.path === path);
  if (index < 0) return;
  openTabs.value.splice(index, 1);
  persistTabs();
  if (basePath(route.path) !== path) return;
  const next = openTabs.value[index] ?? openTabs.value[index - 1];
  router.push(next ? next.path : '/dashboard');
}

function clearTabs() {
  openTabs.value = [];
  localStorage.removeItem(TABS_STORAGE);
}
/** Orologio di testata: data + ora di Roma con i secondi, aggiornato ogni secondo */
const ROME = 'Europe/Rome';
const dateFmt = new Intl.DateTimeFormat('it-IT', {
  timeZone: ROME,
  weekday: 'long',
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});
const timeFmt = new Intl.DateTimeFormat('it-IT', {
  timeZone: ROME,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const now = ref(new Date());
let clockTimer: ReturnType<typeof setInterval> | undefined;
const dateLabel = computed(() => dateFmt.format(now.value));
const timeLabel = computed(() => timeFmt.format(now.value));

/** Avvisi vocali: confronta periodicamente l'ultimo ordine visibile con l'ultimo gia' notificato. */
const VOICE_ALERTS_STORAGE = 'orderez-voice-alerts-v1';
const VOICE_MARKER_STORAGE = 'orderez-voice-last-order-v1';
const VOICE_ORDER_MESSAGE = 'Hai ricevuto un nuovo ordine. Controllalo.';
const VOICE_POLL_MS = 30_000;
const speechSupported = computed(
  () => 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window,
);
const voiceEnabled = ref(localStorage.getItem(VOICE_ALERTS_STORAGE) === 'on' && speechSupported.value);
const voicePanelOpen = ref(false);
let voiceTimer: ReturnType<typeof setInterval> | undefined;
let voiceKickoffTimer: ReturnType<typeof setTimeout> | undefined;
let voiceCheckRunning = false;

function voiceMarkerKey() {
  return `${VOICE_MARKER_STORAGE}:${auth.user?.id ?? 'anonymous'}`;
}

function readVoiceMarker(): number | null {
  const raw = localStorage.getItem(voiceMarkerKey());
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function writeVoiceMarker(orderId: number) {
  localStorage.setItem(voiceMarkerKey(), String(orderId));
}

function stopVoicePolling() {
  if (voiceTimer) clearInterval(voiceTimer);
  if (voiceKickoffTimer) clearTimeout(voiceKickoffTimer);
  voiceTimer = undefined;
  voiceKickoffTimer = undefined;
}

function speakVoiceMessage(text: string) {
  if (!speechSupported.value) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'it-IT';
  utterance.rate = 0.98;
  const italianVoice = synth.getVoices().find((voice) => voice.lang.toLowerCase().startsWith('it'));
  if (italianVoice) utterance.voice = italianVoice;
  synth.speak(utterance);
}

async function primeVoiceMarker() {
  const { latestOrderId } = await latestOrderNotification();
  writeVoiceMarker(latestOrderId ?? 0);
}

async function checkNewOrders() {
  if (!voiceEnabled.value || voiceCheckRunning) return;
  voiceCheckRunning = true;
  try {
    const { latestOrderId } = await latestOrderNotification();
    if (latestOrderId === null) return;
    const previousId = readVoiceMarker();
    if (previousId === null || latestOrderId <= previousId) {
      if (previousId === null) writeVoiceMarker(latestOrderId);
      return;
    }
    writeVoiceMarker(latestOrderId);
    speakVoiceMessage(VOICE_ORDER_MESSAGE);
  } catch {
    // Un errore di rete temporaneo non deve disturbare l'operatore.
  } finally {
    voiceCheckRunning = false;
  }
}

function startVoicePolling(delayFirstCheckMs = 0) {
  stopVoicePolling();
  if (delayFirstCheckMs > 0) {
    voiceKickoffTimer = setTimeout(() => void checkNewOrders(), delayFirstCheckMs);
  } else {
    void checkNewOrders();
  }
  voiceTimer = setInterval(() => void checkNewOrders(), VOICE_POLL_MS);
}

async function setVoiceEnabled(enabled: boolean) {
  if (!enabled) {
    voiceEnabled.value = false;
    localStorage.setItem(VOICE_ALERTS_STORAGE, 'off');
    stopVoicePolling();
    if (speechSupported.value) window.speechSynthesis.cancel();
    return;
  }
  if (!speechSupported.value) {
    message.warning('Il browser non supporta gli avvisi vocali');
    return;
  }
  if (readVoiceMarker() === null) {
    try {
      await primeVoiceMarker();
    } catch {
      // Se la rete non e' disponibile il primo controllo fara' da baseline.
    }
  }
  voiceEnabled.value = true;
  localStorage.setItem(VOICE_ALERTS_STORAGE, 'on');
  speakVoiceMessage('Avvisi vocali attivati.');
  startVoicePolling(2500);
}

function onVoiceSwitch(checked: boolean) {
  void setVoiceEnabled(checked);
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible' && voiceEnabled.value) void checkNewOrders();
}

async function initializeVoiceAlerts() {
  if (readVoiceMarker() === null) {
    try {
      await primeVoiceMarker();
    } catch {
      // Il prossimo controllo imposta la baseline senza annunciare gli ordini storici.
    }
  }
  if (voiceEnabled.value) startVoicePolling();
}

onMounted(() => {
  clockTimer = setInterval(() => {
    now.value = new Date();
  }, 1000);
  document.addEventListener('visibilitychange', onVisibilityChange);
  void initializeVoiceAlerts();
  void health()
    .then((result) => {
      demoMode.value = Boolean(result?.demoMode);
    })
    .catch(() => undefined);
});

onBeforeUnmount(() => {
  if (clockTimer) clearInterval(clockTimer);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  stopVoicePolling();
  if (speechSupported.value) window.speechSynthesis.cancel();
});

function navigate(path: string) {
  mobileOpen.value = false;
  router.push(path);
}

const passwordOpen = ref(false);
const passwordSaving = ref(false);
const passwordForm = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' });

function openPasswordDialog() {
  passwordForm.oldPassword = '';
  passwordForm.newPassword = '';
  passwordForm.confirmPassword = '';
  passwordOpen.value = true;
}

async function submitPassword() {
  if (!passwordForm.oldPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
    message.warning('Compila tutti i campi');
    return;
  }
  if (passwordForm.newPassword.length < 8) {
    message.warning('La nuova password deve avere almeno 8 caratteri');
    return;
  }
  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    message.warning('Le nuove password non coincidono');
    return;
  }
  passwordSaving.value = true;
  try {
    await changePassword(passwordForm.oldPassword, passwordForm.newPassword);
    message.success('Password aggiornata. Puoi continuare a usare la sessione corrente.');
    passwordOpen.value = false;
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    passwordSaving.value = false;
  }
}

function logout() {
  clearTabs();
  auth.logout();
  router.push('/login');
}

/** Ricarica la pagina corrente: logo e icona in testata usano lo stesso comportamento. */
function refreshPage() {
  window.location.reload();
}
</script>

<template>
  <div class="shell">
    <aside class="sidebar" :class="{ open: mobileOpen }">
      <button type="button" class="brand" title="Aggiorna pagina" @click="refreshPage">
        <img class="brand-logo" src="/orderez-mark.svg" alt="OrderEZ" />
        <div>
          <strong>OrderEZ</strong>
          <span>Gestione fornitori</span>
        </div>
      </button>
      <nav>
        <button
          v-for="item in nav"
          :key="item.to"
          class="nav-item"
          :class="{ active: route.path === item.to || route.path.startsWith(`${item.to}/`) }"
          type="button"
          @click="navigate(item.to)"
        >
          <component :is="item.icon" />
          <span>{{ item.label }}</span>
        </button>
      </nav>
      <div class="sidebar-foot">
        <span>{{ auth.user?.role === 'admin' ? 'Amministratore' : auth.user?.supplierName || 'Fornitore' }}</span>
        <small>{{ auth.user?.username }}</small>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <button class="mobile-menu" type="button" aria-label="Apri menu" @click="mobileOpen = !mobileOpen">
          <MenuOutlined />
        </button>
        <div class="tabbar" role="tablist">
          <button
            v-for="tab in openTabs"
            :key="tab.path"
            type="button"
            class="tab"
            :class="{ active: basePath(route.path) === tab.path }"
            @click="selectTab(tab.path)"
          >
            <component :is="tab.icon" class="tab-icon" />
            <span class="tab-label">{{ tab.label }}</span>
            <span
              class="tab-close"
              role="button"
              tabindex="0"
              :aria-label="`Chiudi ${tab.label}`"
              @click.stop="closeTab(tab.path)"
              @keydown.enter.stop="closeTab(tab.path)"
            >
              <CloseOutlined />
            </span>
          </button>
        </div>
        <div class="topbar-meta">
          <a-button type="text" class="topbar-refresh" title="Aggiorna pagina" aria-label="Aggiorna pagina" @click="refreshPage">
            <template #icon><ReloadOutlined /></template>
          </a-button>
          <a-popover v-model:open="voicePanelOpen" placement="bottomRight" trigger="click" :overlay-style="{ minWidth: '180px' }">
            <a-button
              type="text"
              class="topbar-voice"
              :class="{ active: voiceEnabled }"
              :title="voiceEnabled ? 'Avvisi vocali attivi' : 'Avvisi vocali disattivati'"
              aria-label="Avvisi vocali"
            >
              <template #icon>
                <SoundFilled v-if="voiceEnabled" />
                <SoundOutlined v-else />
              </template>
            </a-button>
            <template #content>
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 24px">
                <span>Avvisi vocali</span>
                <a-switch size="small" :checked="voiceEnabled" @change="onVoiceSwitch" />
              </div>
            </template>
          </a-popover>
          <span class="clock">
            <span class="clock-date">{{ dateLabel }}</span>
            <span class="clock-time">{{ timeLabel }}</span>
          </span>
          <a-dropdown placement="bottomRight" :trigger="['click']">
            <button type="button" class="account-menu">
              <UserOutlined />
              <span class="account-name">{{ auth.user?.username }}</span>
            </button>
            <template #overlay>
              <a-menu>
                <a-menu-item key="password" @click="openPasswordDialog">
                  <template #icon><KeyOutlined /></template>
                  Modifica password
                </a-menu-item>
                <a-menu-divider />
                <a-menu-item key="logout" @click="logout">
                  <template #icon><LogoutOutlined /></template>
                  Esci
                </a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>
        </div>
      </header>
      <main class="content">
        <div v-if="demoMode" class="demo-banner" role="status">
          <InfoCircleOutlined />
          <span>Ambiente dimostrativo · Dati fittizi</span>
        </div>
        <RouterView />
      </main>
    </div>
    <a-modal
      v-model:open="passwordOpen"
      title="Modifica password"
      :confirm-loading="passwordSaving"
      ok-text="Salva"
      cancel-text="Annulla"
      @ok="submitPassword"
    >
      <a-form layout="vertical">
        <a-form-item label="Password attuale">
          <a-input-password v-model:value="passwordForm.oldPassword" autocomplete="current-password" />
        </a-form-item>
        <a-form-item label="Nuova password">
          <a-input-password
            v-model:value="passwordForm.newPassword"
            autocomplete="new-password"
            placeholder="Minimo 8 caratteri"
          />
        </a-form-item>
        <a-form-item label="Conferma nuova password">
          <a-input-password v-model:value="passwordForm.confirmPassword" autocomplete="new-password" />
        </a-form-item>
      </a-form>
    </a-modal>

    <div v-if="mobileOpen" class="backdrop" @click="mobileOpen = false" />
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  display: flex;
}

.sidebar {
  width: 168px;
  flex: 0 0 168px;
  min-height: 100vh;
  background: var(--oe-sidebar-bg);
  color: var(--oe-sidebar-text);
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 0;
  height: 100vh;
  z-index: 30;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 16px 12px 14px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.brand:hover .brand-logo {
  filter: brightness(1.06);
}

.brand-logo {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  object-fit: cover;
}

.brand strong {
  display: block;
  letter-spacing: 0.06em;
  font-size: 15px;
}

.brand span {
  display: block;
  color: var(--gray-400);
  font-size: 12px;
  margin-top: 2px;
}

nav {
  padding: 8px 8px;
  display: grid;
  gap: 2px;
}

.nav-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--gray-400);
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease, color 0.15s ease;
}

.nav-item :deep(svg) {
  font-size: 16px;
}

.nav-item:hover {
  color: var(--gray-050);
  background: var(--gray-800);
}

.nav-item.active {
  background: rgba(217, 119, 87, 0.16);
  color: var(--gray-050);
  box-shadow: inset 3px 0 0 var(--clay);
}

.sidebar-foot {
  margin-top: auto;
  padding: 16px 14px 20px;
  border-top: 1px solid var(--gray-800);
}

.sidebar-foot span {
  display: block;
  font-weight: 500;
}

.sidebar-foot small {
  color: var(--gray-500);
}

.main {
  flex: 1;
  min-width: 0;
}


.content {
  min-height: calc(100vh - 58px);
}

.demo-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 34px;
  padding: 7px 16px;
  background: #fff3d6;
  border-bottom: 1px solid #e7c56b;
  color: #6d4c00;
  font-size: 13px;
  font-weight: 600;
}

.backdrop {
  display: none;
}

.topbar {
  height: 58px;
  background: var(--gray-950);
  border-bottom: 1px solid var(--gray-800);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  position: sticky;
  top: 0;
  z-index: 20;
}

.tabbar {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.tabbar::-webkit-scrollbar {
  display: none;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 10px 0 12px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--gray-400);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
}

.tab:hover {
  color: var(--gray-050);
  background: rgba(255, 255, 255, 0.08);
}

.tab.active {
  color: var(--gray-950);
  background: var(--gray-050);
  border-color: var(--gray-050);
  font-weight: 600;
}

.tab-icon {
  font-size: 14px;
}

.tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  font-size: 10px;
  color: inherit;
  opacity: 0.6;
}

.tab-close:hover {
  opacity: 1;
  background: rgba(0, 0, 0, 0.12);
}

.topbar-meta {
  display: flex;
  align-items: center;
  gap: 16px;
}

.clock {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.2;
}

.clock-date {
  color: var(--gray-400);
  font-size: 12px;
  text-transform: capitalize;
}

.clock-time {
  font-family: var(--oe-font-mono);
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--gray-050);
}

.account-menu {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--gray-050);
  font-size: 13px;
  cursor: pointer;
}

.account-menu:hover {
  background: rgba(255, 255, 255, 0.1);
}

.account-name {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.topbar-refresh {
  color: var(--gray-050) !important;
  font-size: 16px;
}

.topbar-refresh:hover {
  background: rgba(255, 255, 255, 0.1) !important;
  color: var(--gray-050) !important;
}

.topbar-voice {
  color: var(--gray-400) !important;
  font-size: 16px;
}

.topbar-voice:hover {
  background: rgba(255, 255, 255, 0.1) !important;
  color: var(--gray-050) !important;
}

.topbar-voice.active {
  color: var(--clay) !important;
}

@media (max-width: 960px) {
  .account-name,
  .clock-date {
    display: none;
  }
}

.mobile-menu {
  display: none;
  border: 0;
  background: transparent;
  color: var(--gray-050);
  font-size: 18px;
}

@media (max-width: 920px) {
  .sidebar {
    position: fixed;
    left: -190px;
    transition: left 0.2s ease;
  }

  .sidebar.open {
    left: 0;
  }

  .mobile-menu {
    display: inline-flex;
  }

  .topbar {
    padding: 0 14px;
    gap: 10px;
  }

  .tabbar {
    margin-right: auto;
  }

  .backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(20, 20, 19, 0.32);
    z-index: 25;
  }
}
</style>
