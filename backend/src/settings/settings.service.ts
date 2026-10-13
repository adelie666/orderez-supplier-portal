import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret, encryptSecret, isEncryptedSecret } from '../config/credentials-crypto';

/**
 * 集成配置 —— 只有一处凭证：订货宝 ERP（erp.dhb168.com）。
 *
 * 早期规划假设「读走新网关 X-Api-Key、写走旧 ERP sKey」，实测客户账号只有一套
 * sKey 凭证且读写接口齐备，故合并为单一配置，界面也只保留一个填写入口。
 */
export const SETTING_KEYS = {
  erpBaseUrl: 'erp.base_url',
  erpSerialNumber: 'erp.serial_number',
  erpPassword: 'erp.password',
  /** Campo personalizzato Dinghuobao usato come fornitore dell'articolo (field_1..field_6). */
  supplierField: 'erp.supplier_field',
} as const;

/** 敏感键：落库前 AES-256-GCM 加密，接口只回掩码 */
export const SECRET_SETTING_KEYS = new Set<string>([SETTING_KEYS.erpSerialNumber, SETTING_KEYS.erpPassword]);

export const DEFAULT_ERP_BASE_URL = 'https://erp.dhb168.com/';
export const ERP_ENDPOINT = 'home/index/erpIndex';

export interface IntegrationConfig {
  erpSerialNumber: string | null;
  erpPassword: string | null;
  erpBaseUrl: string;
  /** 凭证齐全时为 true。缺失时同步暂停并直接报错，不存在任何 mock 回退。 */
  erpConfigured: boolean;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  expiresIn?: number;
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async allRaw(): Promise<Record<string, string>> {
    const rows = await this.prisma.setting.findMany();
    return rows.reduce<Record<string, string>>((acc, row) => {
      acc[row.key] = row.value ?? '';
      return acc;
    }, {});
  }

  /** 解密后的配置（密钥明文，仅供服务端内部使用） */
  async all(): Promise<Record<string, string>> {
    const map = await this.allRaw();
    for (const key of SECRET_SETTING_KEYS) {
      const value = map[key];
      if (value) map[key] = decryptSecret(value);
    }
    return map;
  }

  async get(key: string): Promise<string | null> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    const value = row?.value?.trim();
    if (!value) return null;
    return SECRET_SETTING_KEYS.has(key) ? decryptSecret(value) : value;
  }

  async setMany(entries: Record<string, string | null | undefined>): Promise<void> {
    const ops = Object.entries(entries)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => {
        const normalized = value ?? '';
        const stored =
          SECRET_SETTING_KEYS.has(key) && normalized && !isEncryptedSecret(normalized)
            ? encryptSecret(normalized)
            : normalized;
        return this.prisma.setting.upsert({
          where: { key },
          create: { key, value: stored },
          update: { value: stored },
        });
      });
    if (!ops.length) return;
    await this.prisma.$transaction(ops);
  }

  async integration(): Promise<IntegrationConfig> {
    const map = await this.all();
    const erpSerialNumber = map[SETTING_KEYS.erpSerialNumber]?.trim() || null;
    const erpPassword = map[SETTING_KEYS.erpPassword]?.trim() || null;

    return {
      erpSerialNumber,
      erpPassword,
      erpBaseUrl: map[SETTING_KEYS.erpBaseUrl]?.trim() || DEFAULT_ERP_BASE_URL,
      erpConfigured: Boolean(erpSerialNumber && erpPassword),
    };
  }

  /** 连接自检：只调 getTokenValue，不产生任何业务数据。 */
  async testConnection(): Promise<ConnectionTestResult> {
    const config = await this.integration();
    if (!config.erpSerialNumber || !config.erpPassword) {
      return { ok: false, message: 'Numero seriale e password sono obbligatori' };
    }

    const url = `${config.erpBaseUrl.replace(/\/+$/, '')}/${ERP_ENDPOINT}`;
    try {
      const response = await axios.post(
        url,
        { f: 'getTokenValue', v: { SerialNumber: config.erpSerialNumber, Password: config.erpPassword } },
        { headers: { 'Content-Type': 'application/json' }, timeout: 20000, validateStatus: () => true },
      );

      const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
      const status = Number(data?.rStatus ?? -1);
      if (status !== 100 && status !== 101) {
        return { ok: false, message: `Errore ${status}: ${data?.message ?? 'sconosciuto'}` };
      }
      if (!data?.rData?.token) return { ok: false, message: 'Risposta senza token' };

      return { ok: true, message: 'Connessione riuscita', expiresIn: Number(data.rData.expires_in ?? 0) };
    } catch (error) {
      return { ok: false, message: `Server non raggiungibile: ${(error as Error).message}` };
    }
  }
}
