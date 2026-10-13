import { randomBytes } from 'crypto';
import { Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 首次启动自动建立管理员账号。
 *
 * 一套全新的部署起来后库里一个用户都没有，登录页就是个死胡同 ——
 * 不先进服务器跑一条命令就没人能进去。这里把这一步吃掉：
 *
 *  - 只在 users 表**一条记录都没有**时触发；库里已经有任何用户就完全不介入，
 *    所以它不会覆盖、也不会重置任何人的密码。
 *  - 密码优先取 SEED_ADMIN_PASSWORD；没配就随机生成，并且**只打印这一次**，
 *    日志滚过去就没了，必须马上保存。
 *  - 由 main.ts 在服务启动时调用，而不是挂在 Nest 生命周期上：
 *    seed / demo-seed 脚本会创建 application context，挂生命周期会被它们顺带触发。
 */
export async function ensureFirstAdmin(prisma: PrismaService): Promise<void> {
  if ((await prisma.user.count()) > 0) return;

  const username = process.env.SEED_ADMIN_USERNAME?.trim() || 'admin';
  const configured = process.env.SEED_ADMIN_PASSWORD?.trim();
  const password = configured || randomBytes(12).toString('hex');

  await prisma.user.create({
    data: {
      username,
      passwordHash: await bcrypt.hash(password, 10),
      role: 'admin',
      status: 1,
    },
  });

  new Logger('AdminBootstrap').warn(
    [
      '',
      '==============================================================',
      ' Nessun account presente: creato il primo amministratore.',
      ' 库中没有任何账号，已自动创建第一个管理员：',
      `   username / 账号 : ${username}`,
      `   password / 密码 : ${password}`,
      configured
        ? '   （取自 SEED_ADMIN_PASSWORD）'
        : '   （随机生成，只打印这一次，请立刻保存）',
      ' 首次登录后请立即修改密码。 / Cambia subito la password.',
      '==============================================================',
      '',
    ].join('\n'),
  );
}
