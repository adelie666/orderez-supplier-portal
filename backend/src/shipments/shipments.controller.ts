import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';
import { ShipmentsService } from './shipments.service';
import { ShipOrderDto } from './dto/ship-order.dto';
import { ListShipmentsDto } from './dto/list-shipments.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}

  @Get('shipments')
  list(@Query() query: ListShipmentsDto, @CurrentUser() user: JwtPayload) {
    return this.shipments.list(query, user);
  }

  @Get('shipments/:id')
  detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.shipments.detail(id, user);
  }

  /** 发货（供应商与管理员均可，供应商限自己的单） */
  /** 该订单在上游 ERP 已有的出库（发货）单；用于解释为什么不能在这里发货 */
  @Get('orders/:id/erp-shipment')
  erpShipment(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.shipments.erpShipment(id, user);
  }

  @Post('orders/:id/ship')
  ship(@Param('id', ParseIntPipe) id: number, @Body() dto: ShipOrderDto, @CurrentUser() user: JwtPayload) {
    return this.shipments.ship(id, dto, user);
  }

  @Post('shipments/:id/retry')
  @Roles('admin')
  retry(@Param('id', ParseIntPipe) id: number) {
    return this.shipments.retry(id);
  }
}
