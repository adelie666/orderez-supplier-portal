import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

/**
 * 重试队列 —— 规划 §三 缓存/队列（Redis + BullMQ）。
 * 有 REDIS_URL 时用 BullMQ；没有时退回进程内指数退避，保证本地开发与
 * 小流量部署无需 Redis 也能自动重试。
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private queue?: Queue;
  private worker?: Worker;
  private connection?: IORedis;
  private handlers = new Map<string, (payload: any, attempt: number) => Promise<void>>();
  private readonly timers = new Set<NodeJS.Timeout>();

  readonly enabled = Boolean(process.env.REDIS_URL);

  constructor() {
    if (this.enabled) {
      this.connection = new IORedis(process.env.REDIS_URL as string, { maxRetriesPerRequest: null });
      this.queue = new Queue('orderez-it', { connection: this.connection });
      this.worker = new Worker(
        'orderez-it',
        async (job) => {
          const handler = this.handlers.get(String(job.name));
          if (!handler) return;
          await handler(job.data, job.attemptsMade + 1);
        },
        { connection: this.connection, concurrency: 2 },
      );
      this.worker.on('failed', (job, error) => {
        this.logger.error(`Job ${job?.name} fallito (tentativo ${job?.attemptsMade}): ${error.message}`);
      });
    } else {
      this.logger.warn('REDIS_URL non configurato: coda in-process con retry esponenziale');
    }
  }

  /** 注册任务处理器（key = job name） */
  register(name: string, handler: (payload: any, attempt: number) => Promise<void>) {
    this.handlers.set(name, handler);
  }

  async add(name: string, payload: any, options: { attempts?: number; delayMs?: number } = {}) {
    const attempts = options.attempts ?? 3;
    if (this.queue) {
      await this.queue.add(name, payload, {
        attempts,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      });
      return;
    }
    await this.runWithRetry(name, payload, attempts, options.delayMs ?? 30_000);
  }

  private async runWithRetry(name: string, payload: any, attempts: number, baseDelay: number, attempt = 1) {
    const handler = this.handlers.get(name);
    if (!handler) return;
    try {
      await handler(payload, attempt);
    } catch (error) {
      const message = (error as Error).message;
      if (attempt >= attempts) {
        this.logger.error(`Job ${name} esaurito dopo ${attempt} tentativi: ${message}`);
        throw error;
      }
      this.logger.warn(`Job ${name} tentativo ${attempt} fallito: ${message} — retry tra ${baseDelay * attempt}ms`);
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        void this.runWithRetry(name, payload, attempts, baseDelay, attempt + 1).catch(() => undefined);
      }, baseDelay * attempt);
      this.timers.add(timer);
    }
  }

  async onModuleDestroy() {
    this.timers.forEach((timer) => clearTimeout(timer));
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }
}
