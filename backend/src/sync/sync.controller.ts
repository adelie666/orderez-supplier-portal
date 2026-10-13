import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SyncService } from './sync.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('sync')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class SyncController {
  constructor(
    private readonly sync: SyncService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('status')
  async status() {
    const [watermark, lastLogs] = await Promise.all([
      this.sync.getWatermark(),
      this.prisma.syncLog.findMany({ orderBy: { id: 'desc' }, take: 20 }),
    ]);
    return { watermark, logs: lastLogs };
  }

  @Post('orders')
  async pullOrders(@Body() body: { lookbackDays?: number; full?: boolean }) {
    return this.sync.syncOrders({ lookbackDays: body?.lookbackDays, full: body?.full });
  }

  @Post('refresh')
  async refresh(@Body() body: { days?: number }) {
    return this.sync.refreshRecentOrders(body?.days ?? 7);
  }

  @Post('catalog')
  async catalog() {
    const suppliers = await this.sync.syncSuppliers();
    const products = await this.sync.syncProducts();
    return { suppliers, products };
  }

  /** Importa le spedizioni registrate direttamente sul gestionale (getShipsList). */
  /**
   * Azzera tutti i dati di esercizio per collegare un altro gestionale.
   * Richiede una conferma esplicita: evita cancellazioni con un click sbagliato.
   */
  @Post('reset')
  async reset(@Body() body: { confirm?: string }) {
    if ((body?.confirm ?? '').trim().toUpperCase() !== 'REINIZIALIZZA') {
      throw new BadRequestException('Conferma non valida per azzerare i dati.');
    }
    return this.sync.resetData();
  }

  @Post('shipments')
  async shipments(@Body() body: { days?: number }) {
    return this.sync.syncShipments({ days: body?.days });
  }

  @Get('logs')
  async logs(@Query('page') page = '1', @Query('pageSize') pageSize = '50') {
    const take = Math.min(Number(pageSize) || 50, 200);
    const skip = ((Number(page) || 1) - 1) * take;
    const [rows, total] = await Promise.all([
      this.prisma.syncLog.findMany({ orderBy: { id: 'desc' }, take, skip }),
      this.prisma.syncLog.count(),
    ]);
    return { rows, total, page: Number(page) || 1, pageSize: take };
  }
}
