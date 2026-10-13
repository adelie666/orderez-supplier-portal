import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { SettingsService, IntegrationConfig } from '../settings/settings.service';
import { AddAllShipsRequest, AddAllShipsResult } from './types';

/**
 * 上游 ERP 客户端 —— 唯一的 ERP 集成入口（读 + 写走同一套凭证）。
 *
 * 协议：
 *   POST {base}/home/index/erpIndex
 *   Content-Type: application/json
 *   Body: {"f": "<方法名>", "v": { ...参数, "sKey": "<token>" }}
 *   响应: {"rStatus":100, "message":"...", "rData":..., "rTotal":"51"}
 *
 * 鉴权：getTokenValue(SerialNumber, Password) → rData.token（有效期约 7.5h）。
 * 关键 rStatus：100 成功 / 101 成功但有警告 / 201 账号密码不匹配 /
 *              203 sKey 过期（自动刷新重试一次）/ 209 参数错误 / 210 方法不存在。
 *
 * 说明：读接口（getOrderList / getGoodsList / getSupplierList）与写接口共用同一套
 * 凭证与端点，因此统一为一处配置，界面上也只保留一个填写入口。
 */
export const ERP_ENDPOINT = 'home/index/erpIndex';

export const ERP_STATUS = {
  OK: 100,
  WARNING: 101,
  AUTH_FAIL: 201,
  TOKEN_EXPIRED: 203,
  PARAM_ERROR: 209,
  NO_METHOD: 210,
  SERVER_ERROR: 500,
} as const;

export interface ErpEnvelope<T = unknown> {
  rStatus: number;
  message?: string;
  rData: T;
  rTotal?: string | number;
}

/** 业务异常：保留 rStatus，便于区分「sKey 过期」等可重试错误。 */
export class ErpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ErpError';
  }
}

@Injectable()
export class ErpClient {
  private readonly logger = new Logger(ErpClient.name);
  private readonly http: AxiosInstance = axios.create({ timeout: 60000, validateStatus: () => true });

  /** sKey 缓存（提前 10 分钟过期，避开边界） */
  private token: { value: string; expiresAt: number } | null = null;
  /** single-flight：并发时共享同一次取 token */
  private tokenPromise: Promise<string> | null = null;

  constructor(private readonly settings: SettingsService) {}

  /** 凭证齐全时为 true */
  /** 凭证已配置时为 true。未配置时任何调用都会报错，不再返回伪造数据。 */
  async isConfigured(): Promise<boolean> {
    const config = await this.settings.integration();
    return config.erpConfigured;
  }

  async getToken(force = false): Promise<string> {
    const config = await this.settings.integration();
    if (!config.erpConfigured) {
      throw new ErpError(
        'Credenziali ERP non configurate: impostare numero seriale e password.',
        ERP_STATUS.AUTH_FAIL,
      );
    }

    if (!force && this.token && this.token.expiresAt > Date.now()) return this.token.value;
    if (this.tokenPromise) return this.tokenPromise;

    this.tokenPromise = this.refreshToken(config).finally(() => {
      this.tokenPromise = null;
    });
    return this.tokenPromise;
  }

  /** 清空缓存的 sKey（改凭证后调用） */
  invalidateToken(): void {
    this.token = null;
  }

  private async refreshToken(config: IntegrationConfig): Promise<string> {
    const data = await this.call<{ token?: string; expires_in?: number }>(
      'getTokenValue',
      { SerialNumber: config.erpSerialNumber, Password: config.erpPassword },
      { auth: false },
    );
    const value = data?.token;
    if (!value) throw new ErpError('getTokenValue non ha restituito il token', -1);

    const expiresIn = Number(data?.expires_in ?? 27000);
    this.token = {
      value: String(value),
      expiresAt: Date.now() + Math.max(60, expiresIn - 600) * 1000,
    };
    this.logger.log(`sKey aggiornata (validita ${expiresIn}s)`);
    return this.token.value;
  }

  /** 通用调用，返回 rData。 */
  async call<T>(
    f: string,
    params: Record<string, unknown> = {},
    options: { auth?: boolean; timeout?: number } = {},
  ): Promise<T> {
    const envelope = await this.envelope<T>(f, params, options);
    return envelope.rData;
  }

  /** 通用调用，返回整个信封（含 rTotal，分页总数用）。 */
  async envelope<T>(
    f: string,
    params: Record<string, unknown> = {},
    options: { auth?: boolean; timeout?: number } = {},
  ): Promise<ErpEnvelope<T>> {
    const auth = options.auth !== false;
    const body = auth
      ? { f, v: { sKey: await this.getToken(), ...params } }
      : { f, v: { ...params } };

    const first = await this.post<T>(body, options.timeout);

    // sKey 过期：刷新后重试一次（规划 §风险 6）
    if (first.rStatus === ERP_STATUS.TOKEN_EXPIRED && auth) {
      const fresh = await this.getToken(true);
      return this.post<T>({ f, v: { ...params, sKey: fresh } }, options.timeout);
    }
    return first;
  }

  private async post<T>(
    body: { f: string; v: Record<string, unknown> },
    timeout?: number,
  ): Promise<ErpEnvelope<T>> {
    const config = await this.settings.integration();
    const url = `${config.erpBaseUrl.replace(/\/+$/, '')}/${ERP_ENDPOINT}`;

    let raw: unknown;
    try {
      const response = await this.http.post(url, body, {
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        timeout: timeout ?? 60000,
      });
      if (response.status >= 400) {
        throw new ErpError(`ERP ${body.f} HTTP ${response.status}: ${String(response.data).slice(0, 300)}`, response.status);
      }
      raw = response.data;
    } catch (error) {
      if (error instanceof ErpError) throw error;
      throw new ErpError(`ERP ${body.f} non raggiungibile: ${(error as Error).message}`, -1);
    }

    const data = typeof raw === 'string' ? this.tryParse(raw) : (raw as Record<string, unknown>);
    const status = Number(data?.rStatus ?? -1);
    const message = String(data?.message ?? '');

    if (status !== ERP_STATUS.OK && status !== ERP_STATUS.WARNING) {
      throw new ErpError(`ERP ${body.f} errore ${status}: ${message || 'sconosciuto'}`, status);
    }
    return { rStatus: status, message, rData: data?.rData as T, rTotal: data?.rTotal as string | number | undefined };
  }

  private tryParse(text: string): Record<string, unknown> {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { rStatus: -1, message: text.slice(0, 300) };
    }
  }

  // ------------------------------------------------------------------ 写接口

  /** 发货回写：上游 ERP 订单 → 待收货（receivedin） */
  async addAllShips(req: AddAllShipsRequest): Promise<AddAllShipsResult> {
    const payload = await this.call<Record<string, unknown>>('addAllShips', {
      orderSn: req.orderSn,
      forceStatus: req.forceStatus ?? 'receivedin',
      consignmentNO: req.consignmentNO ?? '',
      consignmentName: req.consignmentName ?? '',
      consignmentRemark: req.consignmentRemark ?? '',
    });

    const shipsSn = payload?.ships_num ?? payload?.shipsSn ?? payload?.ShipsSN;
    return {
      ok: true,
      shipsSn: shipsSn ? String(shipsSn) : undefined,
      message: 'Spedizione registrata',
      raw: payload,
    };
  }

  /** 标记已下载（可选；规划 §5.2） */
  async writeOrderDownloadStatus(orderSns: string[], apiStatus = 'T'): Promise<boolean> {
    await this.call('writeOrderDownloadStatus', { orders_sn: orderSns.join(','), apiStatus });
    return true;
  }

  /** 连接自检：只取 token，不产生业务数据。 */
  async testConnection(): Promise<{ ok: boolean; message: string; expiresIn?: number }> {
    const config = await this.settings.integration();
    if (!config.erpSerialNumber || !config.erpPassword) {
      return { ok: false, message: 'Numero seriale e password sono obbligatori' };
    }
    try {
      const data = await this.call<{ token?: string; expires_in?: number }>(
        'getTokenValue',
        { SerialNumber: config.erpSerialNumber, Password: config.erpPassword },
        { auth: false, timeout: 20000 },
      );
      if (!data?.token) return { ok: false, message: 'Risposta senza token' };
      return { ok: true, message: 'Connessione riuscita', expiresIn: Number(data.expires_in ?? 0) };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  }
}
