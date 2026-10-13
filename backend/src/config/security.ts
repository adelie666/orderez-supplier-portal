import { randomBytes } from 'crypto';

let devSecret: string | null = null;

/**
 * JWT 密钥：
 *  - 生产（NODE_ENV=production）必须显式配置，否则直接拒绝启动
 *  - 开发环境缺配置时用每次进程启动随机生成的密钥（重启即失效，属预期）
 *
 * 不再使用 'change-me-in-production' 这种可预测的兜底值。
 */
export function jwtSecret(): string {
  const configured = process.env.JWT_SECRET?.trim();
  if (configured) return configured;

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET non configurato: avvio rifiutato in produzione');
  }

  if (!devSecret) {
    devSecret = randomBytes(32).toString('hex');
    // eslint-disable-next-line no-console
    console.warn('[security] JWT_SECRET non configurato: uso una chiave casuale di sviluppo (i token decadono al riavvio)');
  }
  return devSecret;
}
