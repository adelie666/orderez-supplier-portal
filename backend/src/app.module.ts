import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { AuthModule } from './auth/auth.module';
import { SettingsModule } from './settings/settings.module';
import { IntegrationModule } from './integration/integration.module';
import { SyncModule } from './sync/sync.module';
import { OrdersModule } from './orders/orders.module';
import { ShipmentsModule } from './shipments/shipments.module';
import { ReportsModule } from './reports/reports.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { ProductsModule } from './products/products.module';
import { UsersModule } from './users/users.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    QueueModule,
    AuthModule,
    SettingsModule,
    IntegrationModule,
    SyncModule,
    OrdersModule,
    ShipmentsModule,
    ReportsModule,
    SuppliersModule,
    ProductsModule,
    UsersModule,
    DashboardModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
