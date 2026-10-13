import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ErpClient } from '../integration/erp.client';
import { GatewayClient } from '../integration/gateway.client';
import { QueueService } from '../queue/queue.service';
import { amountDecimal, toDecimal } from '../common/format.util';
import { romeLocalToUtc } from '../common/time.util';
import { SHIPPABLE_STATUSES } from '../orders/dto/list-orders.dto';
import { ShipOrderDto } from './dto/ship-order.dto';
import { ListShipmentsDto } from './dto/list-shipments.dto';
import type { JwtPayload } from '../auth/auth.service';

const JOB_SHIP = 'ship-order';

@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger(ShipmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly erp: ErpClient,
    private readonly gateway: GatewayClient,
    private readonly queue: QueueService,
  ) {
    // 发货失败重试（文档 §6.2 步 5）
    this.queue.register(JOB_SHIP, async (payload: { shipmentId: number }) => {
      await this.attemptShipment(payload.shipmentId);
    });
  }

  async list(dto: ListShipmentsDto, user: JwtPayload) {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;
    const where: Prisma.ShipmentWhereInput = {};

    if (user.role === 'supplier') {
      where.supplierId = user.supplierId ?? -1;
    } else if (dto.supplierId) {
      where.supplierId = dto.supplierId;
    }
    if (dto.status) where.status = dto.status;
    if (dto.keyword?.trim()) {
      const keyword = dto.keyword.trim();
      where.OR = [
        { erpShipsSn: { contains: keyword, mode: 'insensitive' } },
        { order: { erpOrdersNum: { contains: keyword, mode: 'insensitive' } } },
        { order: { clientName: { contains: keyword, mode: 'insensitive' } } },
      ];
    }
    const from = dto.dateFrom ? romeLocalToUtc(dto.dateFrom, false) : null;
    const to = dto.dateTo ? romeLocalToUtc(dto.dateTo, true) : null;
    if (from || to) {
      where.shippedAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    }

    const [rows, total] = await Promise.all([
      this.prisma.shipment.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          order: { select: { id: true, erpOrdersNum: true, clientName: true } },
          supplier: { select: { id: true, supplierName: true } },
          operator: { select: { id: true, username: true } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.shipment.count({ where }),
    ]);
    return { rows, total, page, pageSize };
  }

  async detail(id: number, user: JwtPayload) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
      include: { order: true, supplier: true, operator: true, items: true },
    });
    if (!shipment) throw new NotFoundException('Spedizione non trovata');
    if (user.role === 'supplier' && shipment.supplierId !== user.supplierId) {
      throw new ForbiddenException('Spedizione non appartenente al fornitore');
    }
    return shipment;
  }

  /**
   * 该订单在订货宝是否已有出库（发货）单 —— 只读。
   * 详情页用它解释「为什么这单不能在这里发货」，而不是只把按钮置灰。
   */
  async erpShipment(orderId: number, user: JwtPayload) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, erpOrdersNum: true, erpCreateDate: true, supplierId: true },
    });
    if (!order) throw new NotFoundException('Ordine non trovato');
    if (user.role === 'supplier' && order.supplierId !== user.supplierId) {
      throw new ForbiddenException('Ordine non appartenente al fornitore');
    }
    return this.findExistingDelivery(order);
  }

  /** 供应商点“发货”（文档 §6.2） */
  async ship(orderId: number, dto: ShipOrderDto, user: JwtPayload) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Ordine non trovato');

    // 1. 校验归属 + 状态 + 未发过
    if (user.role === 'supplier' && order.supplierId !== user.supplierId) {
      throw new ForbiddenException('Ordine non appartenente al fornitore');
    }
    if (!SHIPPABLE_STATUSES.includes(order.status as never)) {
      throw new BadRequestException(`Stato ordine non spedibile: ${order.status ?? 'sconosciuto'}`);
    }
    if (!order.items.length) throw new BadRequestException('Ordine senza righe');

    // 先落一条待处理意图行，便于失败重试与审计。
    // 并发保护两层：SELECT ... FOR UPDATE 行锁 + shipments.order_id 唯一约束。
    // 双击 / 双请求交错时，第二个请求会被唯一约束拦住，不会重复调 addAllShips。
    let shipment: { id: number };
    try {
      shipment = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM orders WHERE id = ${order.id} FOR UPDATE`;
        const existing = await tx.shipment.findUnique({ where: { orderId: order.id } });
        if (existing) {
          if (existing.status === 'receivedin') throw new ConflictException('Ordine già spedito');
          if (existing.status === 'pending') throw new ConflictException('Spedizione in corso');
          // failed → 复用同一条记录重试：既不撞 order_id 唯一约束，又保留失败审计
          return tx.shipment.update({
            where: { id: existing.id },
            data: {
              status: 'pending',
              operatorId: user.sub,
              consignmentNo: dto.consignmentNo ?? null,
              consignmentName: dto.consignmentName ?? null,
              remark: dto.remark?.trim() || null,
              lastError: null,
            },
            select: { id: true },
          });
        }
        return tx.shipment.create({
          data: {
            orderId: order.id,
            supplierId: order.supplierId,
            operatorId: user.sub,
            status: 'pending',
            consignmentNo: dto.consignmentNo ?? null,
            consignmentName: dto.consignmentName ?? null,
            remark: dto.remark?.trim() || null,
          },
          select: { id: true },
        });
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      // P2002 = violazione di vincolo univoco: un'altra richiesta ha gia creato la spedizione
      if ((error as { code?: string })?.code === 'P2002') throw new ConflictException('Spedizione in corso');
      throw error;
    }

    try {
      const result = await this.callErp(order.erpOrdersNum, dto, user.username);
      if (!result.ok) throw new Error(result.message ?? 'addAllShips ha restituito esito negativo');
      await this.finalize(shipment.id, order.id, result.shipsSn, result.raw);
      return { ok: true, shipmentId: shipment.id, shipsSn: result.shipsSn ?? null, message: 'Spedizione completata' };
    } catch (error) {
      const message = (error as Error).message;
      await this.prisma.shipment.update({
        where: { id: shipment.id },
        data: { status: 'failed', lastError: message, attempts: { increment: 1 } },
      });
      await this.prisma.syncLog.create({
        data: {
          type: 'ship',
          status: 'fail',
          message: `Spedizione ordine ${order.erpOrdersNum} fallita: ${message}`,
          payload: { orderId: order.id, shipmentId: shipment.id } as never,
        },
      });
      // 2. 失败入队重试（3 次，指数退避）
      await this.queue.add(JOB_SHIP, { shipmentId: shipment.id }, { attempts: 3 });
      throw new BadRequestException(this.italianErpError(message));
    }
  }

  /** 把订货宝返回的中文错误翻译成意大利语提示（操作员是意大利人） */
  private italianErpError(message: string): string {
    if (/不为待出库状态|不允许出库/.test(message)) {
      return 'Dinghuobao ha rifiutato la spedizione: l\'ordine non è in stato "Da evadere". Sincronizza lo stato e riprova.';
    }
    if (/已经存在|重复|已出库/.test(message)) {
      return 'Dinghuobao segnala una spedizione già registrata per questo ordine.';
    }
    if (/不存在|无效|错误/.test(message)) {
      return 'Dinghuobao ha rifiutato la spedizione: dati dell\'ordine non validi.';
    }
    return message;
  }

  /** 管理员手动重试失败的发货 */
  async retry(shipmentId: number) {
    const shipment = await this.prisma.shipment.findUnique({ where: { id: shipmentId }, include: { order: true } });
    if (!shipment) throw new NotFoundException('Spedizione non trovata');
    if (shipment.status === 'receivedin') return { ok: true, alreadyDone: true };
    await this.attemptShipment(shipmentId);
    return { ok: true };
  }

  /** 重试入口（队列/手动共用） */
  private async attemptShipment(shipmentId: number): Promise<void> {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: { order: true, operator: { select: { username: true } } },
    });
    if (!shipment || shipment.status === 'receivedin') return;

    // 重发前先对账（文档 §风险 10）：若 ERP 端其实已落单，只回填状态，
    // 绝不再调一次 addAllShips —— 这是重复发货的最后一道防线
    const delivered = await this.findExistingDelivery(shipment.order);
    if (delivered) {
      await this.finalize(shipment.id, shipment.orderId, delivered.ships_num, { reconciled: true });
      return;
    }

    const result = await this.callErp(shipment.order.erpOrdersNum, {
      consignmentNo: shipment.consignmentNo ?? undefined,
      consignmentName: shipment.consignmentName ?? undefined,
      remark: shipment.remark ?? undefined,
    }, shipment.operator?.username);
    if (!result.ok) throw new Error(result.message ?? 'Esito negativo');
    await this.finalize(shipment.id, shipment.orderId, result.shipsSn, result.raw);
  }

  /**
   * 查该订单在订货宝是否已有出库（发货）单 —— 发货前对账，只读。
   * 时间窗从订单创建日往前 1 天到现在，避免每次都把 1000+ 条发货单全拉下来。
   */
  private async findExistingDelivery(order: { erpOrdersNum: string; erpCreateDate?: Date | null }) {
    try {
      const to = new Date();
      const orderDate = order.erpCreateDate ? new Date(order.erpCreateDate) : null;
      const from =
        orderDate && !Number.isNaN(orderDate.getTime())
          ? new Date(orderDate.getTime() - 24 * 3600 * 1000)
          : new Date(to.getTime() - 7 * 24 * 3600 * 1000);
      const list = await this.gateway.listDeliveries(from, to);
      return list.find((row) => String(row.orders_num ?? '') === order.erpOrdersNum) ?? null;
    } catch (error) {
      // 对账失败不阻断重试，但记日志
      this.logger.warn(`Riconciliazione ${order.erpOrdersNum} non riuscita: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * 发货回写订货宝。operatorName 会作为发货单备注回传，这样订货宝的「操作日志 /
   * 发货单」能查到是门户里哪个账号点的发货（订货宝 API 调用本身没有登录人）。
   */
  private callErp(orderSn: string, dto: ShipOrderDto, operatorName?: string) {
    // La nota del fornitore e' il contenuto principale; l'attribuzione dell'operatore
    // resta in coda, cosi' su Dinghuobao si vede comunque chi ha spedito.
    const note = dto.remark?.trim();
    const attribution = operatorName ? `OrderEZ - spedito da: ${operatorName}` : '';
    const consignmentRemark = [note, attribution].filter(Boolean).join(' | ');
    return this.erp.addAllShips({
      orderSn,
      forceStatus: 'receivedin',
      consignmentNO: dto.consignmentNo,
      consignmentName: dto.consignmentName,
      consignmentRemark: consignmentRemark || undefined,
    });
  }

  /** 成功落库：发货明细（进货价快照）+ 订单状态（文档 §6.2 步 4） */
  private async finalize(shipmentId: number, orderId: number, shipsSn?: string, raw?: unknown) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) throw new NotFoundException('Ordine non trovato');

    const products = await this.prisma.product.findMany({
      where: {
        OR: order.items.map((item) => ({
          erpGoodsId: item.erpGoodsId ?? '',
          erpOptionsId: item.erpOptionsId ?? '',
        })),
      },
    });
    const priceOf = (goodsId?: string | null, optionsId?: string | null) => {
      const hit = products.find((p) => p.erpGoodsId === (goodsId ?? '') && p.erpOptionsId === (optionsId ?? ''));
      // 订货宝的 purchase 字段常为 0（未维护进货价）→ 视为未知，回退到订单行价格
      const value = hit?.purchasePrice;
      return value && Number(value) > 0 ? value : null;
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.shipmentItem.deleteMany({ where: { shipmentId } });
      await tx.shipmentItem.createMany({
        data: order.items.map((item) => {
          // 结算价 = 进货价；商品改价不影响历史（文档 §2.3 原则 4）
          const purchasePrice = priceOf(item.erpGoodsId, item.erpOptionsId) ?? item.ordersPrice ?? toDecimal(0);
          const qty = item.ordersNumber ?? toDecimal(0);
          return {
            shipmentId,
            orderItemId: item.id,
            productId:
              products.find(
                (p) => p.erpGoodsId === (item.erpGoodsId ?? '') && p.erpOptionsId === (item.erpOptionsId ?? ''),
              )?.id ?? null,
            erpGoodsId: item.erpGoodsId,
            erpOptionsId: item.erpOptionsId,
            goodsNum: item.goodsNum,
            goodsName: item.goodsName,
            optionsName: item.optionsName,
            baseUnits: item.baseUnits,
            qtyShipped: qty,
            purchasePrice,
            amountEur: amountDecimal(qty, purchasePrice),
          };
        }),
      });

      await tx.shipment.update({
        where: { id: shipmentId },
        data: {
          status: 'receivedin',
          erpShipsSn: shipsSn ?? undefined,
          shippedAt: new Date(),
          lastError: null,
          raw: (raw ?? undefined) as never,
        },
      });

      // 订单状态用订货宝订单状态值 received（待收货）；receivedin 是发货单状态，不能混用
      await tx.order.update({ where: { id: orderId }, data: { status: 'received' } });
    });

    await this.prisma.syncLog.create({
      data: {
        type: 'ship',
        status: 'ok',
        message: `Ordine ${order.erpOrdersNum} spedito${shipsSn ? ` (${shipsSn})` : ''}`,
        payload: { orderId, shipmentId, shipsSn } as never,
      },
    });
    this.logger.log(`Spedizione ${shipmentId} completata per ordine ${order.erpOrdersNum}`);
  }
}
