import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';
import { ProductListQuery, ProductsService } from './products.service';

@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /** Elenco articoli: l'amministratore vede tutto, il fornitore solo i propri. */
  @Get()
  list(@CurrentUser() user: JwtPayload, @Query() query: ProductListQuery) {
    return this.products.list(user, query);
  }

  /** Imposta il fornitore di un articolo (solo amministratore). */
  @Patch(':id/supplier')
  @Roles('admin')
  assignSupplier(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { supplierId?: number | null },
  ) {
    const raw = body?.supplierId;
    const supplierId = raw === null || raw === undefined ? null : Number(raw);
    return this.products.assignSupplier(id, Number.isFinite(supplierId) ? supplierId : null);
  }
}
