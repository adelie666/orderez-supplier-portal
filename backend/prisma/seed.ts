/**
 * 种子数据：
 *  1. 管理员账号（SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD）
 *  2. 拉取一次供应商 / 商品 / 订单（需要已配置真实的订货宝凭证）
 *  3. 可选：给前 3 个供应商各开通一个演示账号（SEED_DEMO_SUPPLIERS=true 才执行）
 *
 * 运行：pnpm seed
 */
import { NestFactory } from '@nestjs/core';
import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SyncService } from '../src/sync/sync.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const sync = app.get(SyncService);

  const username = process.env.SEED_ADMIN_USERNAME ?? 'admin';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'OrderEZ@2026';

  // update 里也写 passwordHash：这个脚本的语义是「把管理员恢复成 .env 里那个账号」，
  // 所以重跑一次就等于重置密码 —— 忘了密码时这是唯一的恢复入口。
  const passwordHash = await bcrypt.hash(password, 10);
  const admin = await prisma.user.upsert({
    where: { username },
    create: { username, passwordHash, role: 'admin', status: 1 },
    update: { passwordHash, role: 'admin', status: 1 },
  });
  console.log(`Amministratore pronto: ${admin.username}（密码已重置为 SEED_ADMIN_PASSWORD）`);

  try {
    const suppliers = await sync.syncSuppliers();
    const products = await sync.syncProducts();
    const orders = await sync.syncOrders({ full: true, lookbackDays: 30 });
    console.log(
      `Sync completata: ${suppliers.count} fornitori, ${products.count} articoli, ${orders.pulled} ordini`,
    );
  } catch (error) {
    console.warn(`Sync non riuscita (${(error as Error).message}) — procedo con gli account`);
  }

  // Gli account fornitore di comodo sono opt-in: in produzione non si creano
  // utenti con password nota. Serve SEED_DEMO_SUPPLIERS=true per crearli.
  if (String(process.env.SEED_DEMO_SUPPLIERS ?? 'false').toLowerCase() === 'true') {
    const demoSources = await prisma.supplier.findMany({ orderBy: { id: 'asc' }, take: 3 });
    const demoPassword = await bcrypt.hash(
      process.env.SEED_DEMO_SUPPLIER_PASSWORD ?? 'Fornitore@2026',
      10,
    );
    for (const supplier of demoSources) {
      const demoUsername = `fornitore${supplier.id}`;
      await prisma.user.upsert({
        where: { username: demoUsername },
        create: {
          username: demoUsername,
          passwordHash: demoPassword,
          role: 'supplier',
          supplierId: supplier.id,
          status: 1,
        },
        update: { supplierId: supplier.id },
      });
      console.log(`Account fornitore: ${demoUsername} → ${supplier.supplierName}`);
    }
  }

  await app.close();
  console.log('Seed completato.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
