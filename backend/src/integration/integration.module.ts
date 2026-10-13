import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { ErpClient } from './erp.client';
import { GatewayClient } from './gateway.client';

@Module({
  imports: [SettingsModule],
  providers: [GatewayClient, ErpClient],
  exports: [GatewayClient, ErpClient],
})
export class IntegrationModule {}
