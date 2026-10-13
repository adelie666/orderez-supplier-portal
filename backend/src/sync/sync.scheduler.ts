import { Injectable, Logger } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { SyncService } from './sync.service';

/** 拉模式定时任务 —— 规划 §6.1 */
@Injectable()
export class SyncScheduler {
  private readonly logger = new Logger(SyncScheduler.name);
  private running = false;
  private warnedNoCredentials = false;
  private static lastRun = 0;

  constructor(private readonly sync: SyncService) {}

  private get enabled() {
    return String(process.env.SYNC_ENABLED ?? 'true').toLowerCase() !== 'false';
  }

  /** 每 SYNC_INTERVAL_MINUTES 分钟拉一次单（默认 5） */
  /**
   * Senza credenziali ERP l'ERP reale non e' interrogabile: il sync automatico resta
   * sospeso e viene registrato un avviso (una sola volta per processo).
   */
  private async integrationReady(): Promise<boolean> {
    const ready = await this.sync.integrationReady();
    if (!ready && !this.warnedNoCredentials) {
      this.logger.warn('Credenziali ERP non configurate: sincronizzazione automatica sospesa.');
      this.warnedNoCredentials = true;
    }
    if (ready) this.warnedNoCredentials = false;
    return ready;
  }

  @Interval(60_000)
  async tick() {
    if (!this.enabled || this.running) return;
    if (!(await this.integrationReady())) return;
    const intervalMs = Math.max(1, Number(process.env.SYNC_INTERVAL_MINUTES ?? 1)) * 60_000;
    if (Date.now() - SyncScheduler.lastRun < intervalMs) return;

    SyncScheduler.lastRun = Date.now();
    this.running = true;
    try {
      await this.sync.syncOrders();
    } catch (error) {
      this.logger.error(`Pull ordini fallito: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** 每日 03:00（罗马时间）回扫近 7 天订单状态 —— 文档 §6.1 步 7 */
  @Cron('0 0 3 * * *', { timeZone: 'Europe/Rome' })
  async dailyRefresh() {
    if (!this.enabled) return;
    if (!(await this.integrationReady())) return;
    try {
      await this.sync.refreshRecentOrders(7);
    } catch (error) {
      this.logger.error(`Refresh ordini fallito: ${(error as Error).message}`);
    }
  }

  /** 每日 02:30（罗马时间）同步商品与供应商档案 */
  @Cron('0 30 2 * * *', { timeZone: 'Europe/Rome' })
  async dailyCatalog() {
    if (!this.enabled) return;
    if (!(await this.integrationReady())) return;
    try {
      // 先商品后供应商：只有商品档案变动（新增商品/改供应商）才可能带来新供应商，
      // 所以供应商不单独轮询，跟着商品同步走一次即可。
      await this.sync.syncProducts();
      await this.sync.syncSuppliers();
    } catch (error) {
      this.logger.error(`Sync catalogo fallito: ${(error as Error).message}`);
    }
  }
}
