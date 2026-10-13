import { Module } from '@nestjs/common';
import { IntegrationModule } from '../integration/integration.module';
import { SyncController } from './sync.controller';
import { SyncScheduler } from './sync.scheduler';
import { SyncService } from './sync.service';

@Module({
  imports: [IntegrationModule],
  controllers: [SyncController],
  providers: [SyncService, SyncScheduler],
  exports: [SyncService],
})
export class SyncModule {}
