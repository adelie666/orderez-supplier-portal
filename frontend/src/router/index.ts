import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { public: true } },
    {
      path: '/',
      component: () => import('../layouts/AppLayout.vue'),
      children: [
        { path: '', redirect: '/dashboard' },
        { path: 'dashboard', name: 'dashboard', component: () => import('../views/DashboardView.vue') },
        { path: 'orders', name: 'orders', component: () => import('../views/OrdersView.vue') },
        { path: 'orders/:id', name: 'order-detail', component: () => import('../views/OrderDetailView.vue') },
        { path: 'reports', name: 'reports', component: () => import('../views/ReportsView.vue') },
        { path: 'products', name: 'products', component: () => import('../views/ProductsView.vue') },
        { path: 'accounts', name: 'accounts', component: () => import('../views/AccountsView.vue'), meta: { admin: true } },
        { path: 'suppliers', redirect: '/accounts' },
        { path: 'settings', name: 'settings', component: () => import('../views/SettingsView.vue'), meta: { admin: true } },
        { path: 'logs', redirect: '/settings' },
      ],
    },
    { path: '/print/order/:id', name: 'print-order', component: () => import('../views/PrintOrderView.vue') },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('../views/NotFoundView.vue') },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.ready) await auth.fetchMe();
  if (to.meta.public) return auth.token ? '/dashboard' : true;
  if (!auth.token) return { name: 'login' };
  if (to.meta.admin && auth.user?.role !== 'admin') return { name: 'dashboard' };
  return true;
});

export default router;
