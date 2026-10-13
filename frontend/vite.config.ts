import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

/** 本地后端地址；`npm run preview` 同样需要它，否则打包产物无法访问接口。 */
const API_TARGET = process.env.VITE_DEV_API_TARGET ?? 'http://127.0.0.1:3100';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5273,
    strictPort: true,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  // preview 是「打包产物 + 真实接口」的自检入口，代理规则与开发服务器保持一致。
  preview: {
    port: 5273,
    strictPort: true,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
