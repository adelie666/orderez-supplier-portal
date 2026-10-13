import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { romeLocalToUtc, formatRomeDate } from '../common/time.util';
import { toDecimal, toNumber } from '../common/format.util';
import type { JwtPayload } from '../auth/auth.service';

const ROUNDING = Prisma.Decimal.ROUND_HALF_UP;

/** Ordini annullati: esclusi da classifiche e totali, non sono merce movimentata. */
const EXCLUDED_ORDER_STATUSES = ['cancelled'];

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Panoramica operativa: KPI + coda di lavoro + prodotti piu' spediti.
   * Niente elenco ordini e niente log di sincronizzazione: l'operatore ha gia'
   * le pagine Ordini e Log sincronizzazione per quelli.
   */
  async overview(user: JwtPayload) {
    const supplierId = user.role === 'supplier' ? user.supplierId : null;
    const scope = supplierId ? { supplierId } : {};

    const today = formatRomeDate(new Date());
    const todayStart = romeLocalToUtc(today, false) as Date;
    const todayEnd = romeLocalToUtc(today, true) as Date;
    const monthStart = romeLocalToUtc(`${today.slice(0, 7)}-01`, false) as Date;

    const [stockup, pending, shippedToday, monthAgg, failedShipments, awaitingReceipt] = await Promise.all([
      this.prisma.order.count({ where: { ...scope, status: 'stockup' } }),
      this.prisma.order.count({ where: { ...scope, status: 'pending' } }),
      this.prisma.shipment.count({
        where: { ...scope, status: 'receivedin', shippedAt: { gte: todayStart, lte: todayEnd } },
      }),
      // Importo e quantita' venduti nel mese: dalle righe d'ordine Dinghuobao, non dalle
      // spedizioni (le spedizioni esistono solo quando si spedisce dal portale).
      this.prisma.orderItem.aggregate({
        _sum: { actualAmount: true, ordersNumber: true },
        where: {
          order: {
            ...scope,
            status: { notIn: EXCLUDED_ORDER_STATUSES },
            erpCreateDate: { gte: monthStart },
          },
        },
      }),
      this.prisma.shipment.count({ where: { ...scope, status: 'failed' } }),
      this.prisma.shipment.count({ where: { ...scope, status: 'receivedin' } }),
    ]);

    // Prodotti piu' venduti del mese (intel operativa, non elenco ordini)
    const grouped = await this.prisma.orderItem.groupBy({
      by: ['goodsNum', 'goodsName', 'optionsName'],
      _sum: { ordersNumber: true, actualAmount: true },
      where: {
        order: {
          ...scope,
          status: { notIn: EXCLUDED_ORDER_STATUSES },
          erpCreateDate: { gte: monthStart },
        },
      },
      orderBy: { _sum: { ordersNumber: 'desc' } },
      take: 6,
    });

    // Immagine e unita' di misura dagli articoli in classifica (una sola query)
    const codes = grouped
      .map((row) => row.goodsNum)
      .filter((code): code is string => !!code);
    const products = codes.length
      ? await this.prisma.product.findMany({
          where: { goodsNum: { in: codes } },
          select: { goodsNum: true, imageUrl: true, baseUnits: true },
        })
      : [];
    const productInfo = new Map(products.map((p) => [p.goodsNum as string, p]));

    return {
      kpi: {
        toShip: stockup,
        shippedToday,
        monthAmount:
          toNumber(toDecimal(monthAgg._sum.actualAmount).toDecimalPlaces(2, ROUNDING)) ?? 0,
        monthQty: toNumber(toDecimal(monthAgg._sum.ordersNumber).toDecimalPlaces(4, ROUNDING)) ?? 0,
      },
      queue: {
        stockup,
        pending,
        failedShipments,
        awaitingReceipt,
      },
      topProducts: grouped.map((row) => ({
        goodsNum: row.goodsNum ?? '',
        imageUrl: row.goodsNum ? productInfo.get(row.goodsNum)?.imageUrl ?? null : null,
        // Unita' di misura dell'articolo, mostrata accanto alla quantita' in classifica.
        baseUnits: row.goodsNum ? productInfo.get(row.goodsNum)?.baseUnits ?? null : null,
        goodsName: row.goodsName ?? row.optionsName ?? '',
        optionsName: row.optionsName ?? '',
        qty: toNumber(toDecimal(row._sum.ordersNumber).toDecimalPlaces(4, ROUNDING)) ?? 0,
        amount: toNumber(toDecimal(row._sum.actualAmount).toDecimalPlaces(2, ROUNDING)) ?? 0,
      })),
    };
  }
}
