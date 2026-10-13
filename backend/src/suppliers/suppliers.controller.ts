import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { Query } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SuppliersService } from './suppliers.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';

@Controller('suppliers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  /** 管理员建账号时需要供应商下拉，供应商角色也可读自己的 */
  @Get()
  @Roles('admin')
  list() {
    return this.suppliers.list();
  }

  /** 供应商角色读自己的档案（归属由 JWT 决定，不接受前端传 id） */
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.suppliers.detailForSupplier(user.supplierId);
  }

  /** Articoli di catalogo senza fornitore mappato (rotta prima di :id). */
  @Get('unmapped-goods')
  @Roles('admin')
  unmappedGoods(@Query('take') take = '200') {
    return this.suppliers.unmappedGoods(Number(take) || 200);
  }

  @Get(':id')
  @Roles('admin')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.suppliers.detail(id);
  }

  @Post('sync')
  @Roles('admin')
  sync() {
    return this.suppliers.syncFromErp();
  }

  /**
   * Mappatura articolo -> fornitore: accetta righe strutturate o testo incollato
   * dall'esportazione della lista articoli dell'ERP.
   */
  @Post('goods-map')
  @Roles('admin')
  importGoodsMap(@Body() body: { rows?: unknown[]; text?: string }) {
    if (Array.isArray(body?.rows) && body.rows.length) {
      return this.suppliers.importGoodsMap(body.rows as Array<{ goodsNum?: unknown; supplierName?: unknown }>);
    }
    return this.suppliers.importGoodsMapText(String(body?.text ?? ''));
  }
}
