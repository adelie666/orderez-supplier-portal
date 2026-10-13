<script setup lang="ts">
import { ConfigProvider } from 'ant-design-vue';
import itIT from 'ant-design-vue/es/locale/it_IT';
import dayjs from 'dayjs';
import 'dayjs/locale/it';

dayjs.locale('it');
</script>

<template>
  <ConfigProvider
    :locale="itIT"
    :theme="{
      token: {
        colorPrimary: '#c6613f',
        colorInfo: '#2c84db',
        colorSuccess: '#788c5d',
        colorError: '#bf4d43',
        borderRadius: 6,
        fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Arial, sans-serif',
      },
    }"
  >
    <RouterView />
  </ConfigProvider>
</template>
