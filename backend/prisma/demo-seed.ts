/**
 * OrderEZ · 演示数据（虚构数据，与任何真实客户无关）
 *
 * 用途：让任何人 clone 仓库后，不需要真实订货宝凭证，也能看到完整的
 * 仪表盘 / 订单 / 发货 / 报表效果。
 *
 * 运行：
 *   npm run seed:demo
 *
 * 幂等：每次运行会先清空业务数据，再写入一套固定结构的虚构数据。
 */
import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** 意大利语状态文案，与真实同步时的口径保持一致。 */
const ORDER_STATUS_NAME: Record<string, string> = {
  pricing: 'In attesa di prezzo',
  pending: 'In attesa di approvazione',
  stockup: 'Da evadere',
  shipped: 'Da spedire',
  received: 'In attesa di ricezione',
  receiveding: 'In attesa di ricezione',
  finished: 'Completato',
  forcedone: 'Completato forzatamente',
  cancelled: 'Annullato',
};

const PAY_STATUS_NAME: Record<string, string> = {
  oblig: 'Da pagare',
  uncollect: 'Parzialmente pagato',
  paided: 'Pagato',
  cancelled: 'Annullato',
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function daysAgo(days: number, hour = 10, minute = 0): Date {
  const date = new Date();
  date.setUTCHours(hour, minute, 0, 0);
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

/** 虚构供应商，全部为演示数据，不指向任何真实企业。 */
const SUPPLIERS = [
  {
    supplierName: 'Aurora Food Italia S.r.l.',
    erpClientId: 'DEMO-AUR-01',
    erpBaseClientId: 'DEMO-AUR',
    clientNum: 'DEMO-AUR-01',
    contact: 'Marco Bianchi',
    mobile: '+39 000 000 0001',
    status: '1',
  },
  {
    supplierName: 'Verdi Distribuzione S.p.A.',
    erpClientId: 'DEMO-VER-02',
    erpBaseClientId: 'DEMO-VER',
    clientNum: 'DEMO-VER-02',
    contact: 'Giulia Verdi',
    mobile: '+39 000 000 0002',
    status: '1',
  },
  {
    supplierName: 'Mare Blu Alimentari S.r.l.',
    erpClientId: 'DEMO-MAR-03',
    erpBaseClientId: 'DEMO-MAR',
    clientNum: 'DEMO-MAR-03',
    contact: 'Luca Romano',
    mobile: '+39 000 000 0003',
    status: '1',
  },
  {
    supplierName: 'Dolce Toscana S.r.l.',
    erpClientId: 'DEMO-DOL-04',
    erpBaseClientId: 'DEMO-DOL',
    clientNum: 'DEMO-DOL-04',
    contact: 'Sofia Conti',
    mobile: '+39 000 000 0004',
    status: '1',
  },
];

/** 虚构商品目录。 */
const PRODUCTS = [
  {
    erpGoodsId: 'DEMO-001',
    goodsNum: 'DEMO-001',
    goodsName: 'Pomodori pelati San Marzano',
    optionsName: '400 g x 24',
    supplierName: SUPPLIERS[0].supplierName,
    wholePrice: 21.9,
    purchasePrice: 18.4,
    baseUnits: 'cartone',
    conversionNumber: 24,
  },
  {
    erpGoodsId: 'DEMO-002',
    goodsNum: 'DEMO-002',
    goodsName: "Olio extravergine di oliva",
    optionsName: '1 L x 12',
    supplierName: SUPPLIERS[0].supplierName,
    wholePrice: 78.5,
    purchasePrice: 66.2,
    baseUnits: 'cartone',
    conversionNumber: 12,
  },
  {
    erpGoodsId: 'DEMO-003',
    goodsNum: 'DEMO-003',
    goodsName: 'Pasta di semola trafilata al bronzo',
    optionsName: '500 g x 20',
    supplierName: SUPPLIERS[1].supplierName,
    wholePrice: 24.8,
    purchasePrice: 20.1,
    baseUnits: 'cartone',
    conversionNumber: 20,
  },
  {
    erpGoodsId: 'DEMO-004',
    goodsNum: 'DEMO-004',
    goodsName: 'Farina tipo 00',
    optionsName: '1 kg x 10',
    supplierName: SUPPLIERS[1].supplierName,
    wholePrice: 13.4,
    purchasePrice: 10.9,
    baseUnits: 'cartone',
    conversionNumber: 10,
  },
  {
    erpGoodsId: 'DEMO-005',
    goodsNum: 'DEMO-005',
    goodsName: 'Mozzarella di bufala DOP',
    optionsName: '125 g x 12',
    supplierName: SUPPLIERS[2].supplierName,
    wholePrice: 42.0,
    purchasePrice: 35.6,
    baseUnits: 'cartone',
    conversionNumber: 12,
  },
  {
    erpGoodsId: 'DEMO-006',
    goodsNum: 'DEMO-006',
    goodsName: 'Parmigiano Reggiano 24 mesi',
    optionsName: '1 kg',
    supplierName: SUPPLIERS[2].supplierName,
    wholePrice: 18.9,
    purchasePrice: 15.7,
    baseUnits: 'kg',
    conversionNumber: 1,
  },
  {
    erpGoodsId: 'DEMO-007',
    goodsNum: 'DEMO-007',
    goodsName: 'Prosciutto crudo di Parma DOP',
    optionsName: '500 g x 6',
    supplierName: SUPPLIERS[2].supplierName,
    wholePrice: 96.0,
    purchasePrice: 82.4,
    baseUnits: 'cartone',
    conversionNumber: 6,
  },
  {
    erpGoodsId: 'DEMO-008',
    goodsNum: 'DEMO-008',
    goodsName: 'Vino rosso Chianti DOCG',
    optionsName: '750 ml x 6',
    supplierName: SUPPLIERS[3].supplierName,
    wholePrice: 39.9,
    purchasePrice: 32.5,
    baseUnits: 'cartone',
    conversionNumber: 6,
  },
  {
    erpGoodsId: 'DEMO-009',
    goodsNum: 'DEMO-009',
    goodsName: 'Aceto balsamico di Modena',
    optionsName: '250 ml x 12',
    supplierName: SUPPLIERS[3].supplierName,
    wholePrice: 45.6,
    purchasePrice: 38.2,
    baseUnits: 'cartone',
    conversionNumber: 12,
  },
  {
    erpGoodsId: 'DEMO-010',
    goodsNum: 'DEMO-010',
    goodsName: 'Biscotti cantuccini',
    optionsName: '200 g x 20',
    supplierName: SUPPLIERS[3].supplierName,
    wholePrice: 28.4,
    purchasePrice: 23.3,
    baseUnits: 'cartone',
    conversionNumber: 20,
  },
  {
    erpGoodsId: 'DEMO-011',
    goodsNum: 'DEMO-011',
    goodsName: 'Caffè macinato',
    optionsName: '250 g x 12',
    supplierName: SUPPLIERS[0].supplierName,
    wholePrice: 52.0,
    purchasePrice: 44.8,
    baseUnits: 'cartone',
    conversionNumber: 12,
  },
  {
    erpGoodsId: 'DEMO-012',
    goodsNum: 'DEMO-012',
    goodsName: 'Passata di pomodoro',
    optionsName: '700 ml x 12',
    supplierName: SUPPLIERS[1].supplierName,
    wholePrice: 16.9,
    purchasePrice: 13.8,
    baseUnits: 'cartone',
    conversionNumber: 12,
  },
];

/** 虚构订单：天数 / 供应商索引 / 状态 / 付款状态 / 明细 / 是否已发货。 */
const ORDERS: Array<{
  days: number;
  supplier: number;
  status: string;
  payStatus: string;
  ship?: 'ok' | 'failed';
  items: Array<{ product: number; qty: number }>;
}> = [
  { days: 0, supplier: 0, status: 'stockup', payStatus: 'oblig', items: [{ product: 0, qty: 4 }, { product: 1, qty: 2 }] },
  { days: 0, supplier: 1, status: 'stockup', payStatus: 'paided', items: [{ product: 2, qty: 6 }] },
  { days: 1, supplier: 2, status: 'stockup', payStatus: 'uncollect', items: [{ product: 4, qty: 3 }, { product: 5, qty: 5 }] },
  { days: 2, supplier: 3, status: 'stockup', payStatus: 'oblig', items: [{ product: 7, qty: 2 }, { product: 8, qty: 2 }] },
  { days: 3, supplier: 0, status: 'received', payStatus: 'paided', ship: 'ok', items: [{ product: 0, qty: 8 }, { product: 10, qty: 3 }] },
  { days: 4, supplier: 1, status: 'received', payStatus: 'paided', ship: 'ok', items: [{ product: 3, qty: 5 }, { product: 11, qty: 4 }] },
  { days: 5, supplier: 2, status: 'shipped', payStatus: 'uncollect', items: [{ product: 6, qty: 1 }] },
  { days: 6, supplier: 3, status: 'finished', payStatus: 'paided', ship: 'ok', items: [{ product: 9, qty: 4 }, { product: 8, qty: 3 }] },
  { days: 8, supplier: 0, status: 'finished', payStatus: 'paided', ship: 'ok', items: [{ product: 1, qty: 5 }, { product: 10, qty: 4 }] },
  { days: 10, supplier: 1, status: 'finished', payStatus: 'paided', ship: 'ok', items: [{ product: 2, qty: 10 }, { product: 3, qty: 6 }] },
  { days: 12, supplier: 2, status: 'finished', payStatus: 'paided', ship: 'ok', items: [{ product: 4, qty: 4 }, { product: 6, qty: 2 }] },
  { days: 15, supplier: 3, status: 'finished', payStatus: 'oblig', ship: 'ok', items: [{ product: 7, qty: 6 }] },
  { days: 18, supplier: 0, status: 'finished', payStatus: 'paided', ship: 'ok', items: [{ product: 0, qty: 12 }] },
  { days: 21, supplier: 1, status: 'finished', payStatus: 'paided', ship: 'ok', items: [{ product: 11, qty: 8 }, { product: 2, qty: 4 }] },
  { days: 24, supplier: 2, status: 'finished', payStatus: 'uncollect', ship: 'ok', items: [{ product: 5, qty: 10 }] },
  { days: 27, supplier: 3, status: 'finished', payStatus: 'paided', ship: 'failed', items: [{ product: 8, qty: 5 }] },
  { days: 5, supplier: 1, status: 'cancelled', payStatus: 'cancelled', items: [{ product: 3, qty: 2 }] },
  { days: 13, supplier: 2, status: 'cancelled', payStatus: 'cancelled', items: [{ product: 6, qty: 1 }] },
];

async function resetBusinessData(): Promise<void> {
  // Il seed demo non deve mai poter riusare credenziali ERP reali per errore.
  await prisma.setting.deleteMany({
    where: { key: { in: ['erp.serial_number', 'erp.password'] } },
  });
  await prisma.shipmentItem.deleteMany();
  await prisma.shipment.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.product.deleteMany();
  await prisma.user.deleteMany({ where: { role: 'supplier' } });
  await prisma.supplier.deleteMany();
  await prisma.syncLog.deleteMany();
  await prisma.syncWatermark.deleteMany();
}

async function main(): Promise<void> {
  const adminUsername = process.env.SEED_ADMIN_USERNAME ?? 'admin';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'OrderEZ@2026';
  const supplierPassword = process.env.SEED_DEMO_SUPPLIER_PASSWORD ?? 'Fornitore@2026';

  await resetBusinessData();

  // 管理员
  const admin = await prisma.user.upsert({
    where: { username: adminUsername },
    create: {
      username: adminUsername,
      passwordHash: await bcrypt.hash(adminPassword, 10),
      role: 'admin',
      status: 1,
    },
    update: {
      passwordHash: await bcrypt.hash(adminPassword, 10),
      role: 'admin',
      status: 1,
    },
  });

  // 供应商
  const suppliers = [];
  for (const supplier of SUPPLIERS) {
    suppliers.push(await prisma.supplier.create({ data: supplier }));
  }

  // 商品
  const products = [];
  for (const product of PRODUCTS) {
    products.push(
      await prisma.product.create({
        data: {
          ...product,
          purchasePrice: new Prisma.Decimal(product.purchasePrice),
          wholePrice: new Prisma.Decimal(product.wholePrice),
          conversionNumber: new Prisma.Decimal(product.conversionNumber),
          imageUrl: null,
          raw: { demo: true },
        },
      }),
    );
  }

  // 演示供应商账号（仅用于本地体验，请勿在生产环境使用默认密码）
  const demoPasswordHash = await bcrypt.hash(supplierPassword, 10);
  for (let index = 0; index < suppliers.length; index += 1) {
    await prisma.user.create({
      data: {
        username: `fornitore${index + 1}`,
        passwordHash: demoPasswordHash,
        role: 'supplier',
        supplierId: suppliers[index].id,
        status: 1,
      },
    });
  }

  // 订单 + 明细 + 发货
  for (let index = 0; index < ORDERS.length; index += 1) {
    const spec = ORDERS[index];
    const supplier = suppliers[spec.supplier];
    const createdAt = daysAgo(spec.days, 9 + (index % 6), (index * 7) % 60);
    const updatedAt = daysAgo(Math.max(0, spec.days - 1), 14, (index * 11) % 60);
    const orderNum = `DEMO-${String(2026000 + index + 1)}`;

    const items = spec.items.map(({ product, qty }, itemIndex) => {
      const catalog = PRODUCTS[product];
      const unitPrice = catalog.wholePrice;
      return {
        erpOrdersListId: `${orderNum}-${itemIndex + 1}`,
        erpGoodsId: catalog.erpGoodsId,
        erpOptionsId: '',
        goodsNum: catalog.goodsNum,
        goodsName: catalog.goodsName,
        optionsName: catalog.optionsName,
        supplierName: catalog.supplierName,
        ordersNumber: new Prisma.Decimal(qty),
        ordersPrice: new Prisma.Decimal(unitPrice),
        actualAmount: new Prisma.Decimal(round2(qty * unitPrice)),
        baseUnits: catalog.baseUnits,
        conversionNumber: new Prisma.Decimal(catalog.conversionNumber),
        raw: { demo: true },
      };
    });

    const order = await prisma.order.create({
      data: {
        erpOrdersId: orderNum,
        erpOrdersNum: orderNum,
        supplierId: supplier.id,
        supplierName: supplier.supplierName,
        clientName: 'Cliente Demo S.r.l.',
        clientNum: 'CLI-DEMO-001',
        status: spec.status,
        statusName: ORDER_STATUS_NAME[spec.status] ?? spec.status,
        payStatus: spec.payStatus,
        payStatusName: PAY_STATUS_NAME[spec.payStatus] ?? spec.payStatus,
        consignee: 'Magazzino Demo',
        consigneeContact: 'Referente Demo',
        consigneePhone: '+39 000 000 0000',
        consigneeAddress: 'Via Demo 1, 20100 Milano (MI), Italia',
        discountTotal: new Prisma.Decimal(0),
        freight: new Prisma.Decimal(0),
        erpCreateDate: createdAt,
        erpUpdateDate: updatedAt,
        syncedAt: updatedAt,
        raw: { demo: true },
        items: { create: items },
      },
      include: { items: true },
    });

    if (spec.ship) {
      const shippedAt = daysAgo(Math.max(0, spec.days - 1), 15, 0);
      const shipmentItems = order.items.map((item, itemIndex) => {
        const catalog = PRODUCTS[spec.items[itemIndex].product];
        const qty = Number(item.ordersNumber ?? 0);
        const purchasePrice = catalog.purchasePrice;
        return {
          orderItemId: item.id,
          productId: products[spec.items[itemIndex].product].id,
          erpGoodsId: catalog.erpGoodsId,
          erpOptionsId: '',
          goodsNum: catalog.goodsNum,
          goodsName: catalog.goodsName,
          optionsName: catalog.optionsName,
          baseUnits: catalog.baseUnits,
          qtyShipped: new Prisma.Decimal(qty),
          purchasePrice: new Prisma.Decimal(purchasePrice),
          amountEur: new Prisma.Decimal(round2(qty * purchasePrice)),
        };
      });

      await prisma.shipment.create({
        data: {
          orderId: order.id,
          supplierId: supplier.id,
          erpShipsSn: `SHIP-DEMO-${index + 1}`,
          shippedAt,
          operatorId: admin.id,
          status: spec.ship === 'failed' ? 'failed' : 'receivedin',
          consignmentNo: `BRT-${100000 + index}`,
          consignmentName: 'Corriere Demo',
          remark: spec.ship === 'failed' ? 'Invio dimostrativo non riuscito' : 'Spedizione dimostrativa',
          attempts: spec.ship === 'failed' ? 2 : 1,
          lastError: spec.ship === 'failed' ? 'Timeout ERP (dato dimostrativo)' : null,
          raw: { demo: true },
          items: { create: shipmentItems },
        },
      });
    }
  }

  // 同步日志 + 水位
  await prisma.syncLog.createMany({
    data: [
      {
        type: 'supplier',
        status: 'ok',
        message: 'Dati demo caricati: 4 fornitori',
        payload: { demo: true },
        createdAt: daysAgo(0, 8, 30),
      },
      {
        type: 'product',
        status: 'ok',
        message: 'Dati demo caricati: 12 articoli',
        payload: { demo: true },
        createdAt: daysAgo(0, 8, 31),
      },
      {
        type: 'order',
        status: 'ok',
        message: 'Dati demo caricati: 18 ordini',
        payload: { demo: true },
        createdAt: daysAgo(0, 8, 32),
      },
    ],
  });

  await prisma.syncWatermark.upsert({
    where: { key: 'order_last_create_date' },
    create: { key: 'order_last_create_date', value: daysAgo(0, 8, 0) },
    update: { value: daysAgo(0, 8, 0) },
  });

  // 标记演示模式，前端据此显示提示条
  for (const [key, value] of Object.entries({
    'demo.mode': 'true',
    'erp.base_url': 'https://erp.dhb168.com/',
    'erp.supplier_field': 'field_6',
  })) {
    await prisma.setting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  console.log('');
  console.log('Dati demo OrderEZ caricati.');
  console.log(`  Admin:      ${adminUsername} / ${adminPassword}`);
  console.log(`  Fornitore:  fornitore1..${suppliers.length} / ${supplierPassword}`);
  console.log(`  Fornitori:  ${suppliers.length} · Articoli: ${products.length} · Ordini: ${ORDERS.length}`);
  console.log('');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
