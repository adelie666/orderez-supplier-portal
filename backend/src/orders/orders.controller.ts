import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';
import { OrdersService } from './orders.service';
import { ListOrdersDto } from './dto/list-orders.dto';
import { ExportOrdersDto } from './dto/export-orders.dto';

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@Query() query: ListOrdersDto, @CurrentUser() user: JwtPayload) {
    return this.orders.list(query, user);
  }

  /** Ultimo ordine visibile: il frontend confronta l'id per rilevare i nuovi arrivi. */
  @Get('latest-notification')
  latestNotification(@CurrentUser() user: JwtPayload) {
    return this.orders.latestNotification(user);
  }

  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.orders.detail(id, user);
  }

  /** Ordine precedente / successivo nella lista (per la navigazione avanti-indietro). */
  @Get(':id/neighbors')
  neighbors(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.orders.neighbors(id, user);
  }

  /** Export Excel: id selezionati oppure filtri correnti */
  @Post('export')
  async export(@Body() dto: ExportOrdersDto, @CurrentUser() user: JwtPayload, @Res() res: Response) {
    const { filename, buffer } = await this.orders.exportExcel(dto, user);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  @Get(':id/print')
  print(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.orders.printData(id, user);
  }
}
