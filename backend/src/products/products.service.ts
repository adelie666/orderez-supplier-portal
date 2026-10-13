import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SyncService } from '../sync/sync.service';
import type { JwtPayload } from '../auth/auth.service';

export interface ProductListQuery {
  page?: number | string;
  pageSize?: number | string;
  keyword?: string;
  supplierId?: number | string;
  onlyUnmapped?: boolean | string;
}

const MAX_PAGE_SIZE = 200;
const NO_SUPPLIER = '__none__';

/**
 * Elenco articoli sincronizzati dal gestionale.
 *
 * L'API ERP non espone il fornitore dell'articolo: la mappatura vive nel portale e
 * l'amministratore la imposta da qui. Gli ordini ereditano il fornitore degli articoli.
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
  ) {}

  private static pageParams(query: ProductListQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const rawSize = Number(query.pageSize) || 20;
    const pageSize = Math.min(Math.max(rawSize, 1), MAX_PAGE_SIZE);
    return { page, pageSize, skip: (page - 1) * pageSize };
  }

  /** Un fornitore vede solo i propri articoli; l'amministratore vede tutto. */
  private async scopeFor(user: JwtPayload): Promise<Prisma.ProductWhereInput> {
    if (user.role !== 'supplier') return {};
    if (!user.supplierId) return { supplierName: NO_SUPPLIER };
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: user.supplierId },
      select: { supplierName: true },
    });
    return { supplierName: supplier?.supplierName ?? NO_SUPPLIER };
  }

  private normalizeUnmapped(value: boolean | string | undefined): boolean {
    return value === true || value === 'true' || value === '1';
  }

  async list(user: JwtPayload, query: ProductListQuery) {
    const { page, pageSize, skip } = ProductsService.pageParams(query);
    const scope = await this.scopeFor(user);
    const where: Prisma.ProductWhereInput = { ...scope };

    if (user.role === 'admin') {
      const onlyUnmapped = this.normalizeUnmapped(query.onlyUnmapped);
      const supplierId = Number(query.supplierId) || null;
      if (onlyUnmapped) {
        where.supplierName = null;
      } else if (supplierId) {
        const supplier = await this.prisma.supplier.findUnique({
          where: { id: supplierId },
          select: { supplierName: true },
        });
        where.supplierName = supplier?.supplierName ?? NO_SUPPLIER;
      }
    }

    const keyword = String(query.keyword ?? '').trim();
    if (keyword) {
      where.AND = [
        {
          OR: [
            { goodsNum: { contains: keyword, mode: 'insensitive' } },
            { goodsName: { contains: keyword, mode: 'insensitive' } },
            { optionsName: { contains: keyword, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const [rows, total, unmapped, catalogTotal] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: [{ supplierName: 'asc' }, { goodsNum: 'asc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.product.count({ where }),
      this.prisma.product.count({ where: { supplierName: null } }),
      this.prisma.product.count({ where: scope }),
    ]);

    return { rows, total, page, pageSize, unmapped, catalogTotal };
  }

  /** Assegna (o azzera) il fornitore di un articolo e ricalcola gli ordini collegati. */
  async assignSupplier(productId: number, supplierId: number | null) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Articolo non trovato');

    let supplierName: string | null = null;
    if (supplierId != null) {
      const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier) throw new BadRequestException('Fornitore non trovato in anagrafica');
      supplierName = supplier.supplierName;
    }

    // Tutte le varianti condividono il codice articolo: la mappatura va applicata a tutte,
    // altrimenti un ordine puo' risultare misto per colpa di una variante non allineata.
    const target = product.goodsNum
      ? { goodsNum: product.goodsNum }
      : { id: product.id };
    const result = await this.prisma.product.updateMany({ where: target, data: { supplierName } });
    const orders = await this.sync.resolveAllOrderSuppliers();

    return {
      updated: result.count,
      goodsNum: product.goodsNum,
      supplierName,
      ordersAssigned: orders.assigned,
      ordersCleared: orders.cleared,
    };
  }
}
