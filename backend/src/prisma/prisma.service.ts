import { INestApplication, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /**
   * 启动连接带重试：
   *  - 容器里后端常比数据库先起来
   *  - 本机偶发首次连接抖动（P1003）
   */
  async onModuleInit() {
    const attempts = Math.max(1, Number(process.env.DB_CONNECT_RETRIES ?? 6));
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.$connect();
        await this.$queryRaw`SELECT 1`;
        if (attempt > 1) this.logger.log(`Database connesso al tentativo ${attempt}`);
        return;
      } catch (error) {
        if (attempt >= attempts) throw error;
        const delay = Math.min(500 * 2 ** (attempt - 1), 5000);
        this.logger.warn(
          `Connessione DB fallita (tentativo ${attempt}/${attempts}): ${String((error as Error).message).split('\n')[0]} — riprovo tra ${delay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', () => {
      void app.close();
    });
  }
}
