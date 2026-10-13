/**
 * 数字 / 金额格式 —— 规划 §七：欧元、意大利数字格式。
 * 服务端用于 Excel 导出与文本模板；前端用同规则的 Intl。
 */
import { Prisma } from '@prisma/client';

const ROUNDING = Prisma.Decimal.ROUND_HALF_UP;

/** 统一把入参规整为 Decimal：财务运算一律走 Decimal，不用二进制浮点累加。 */
export function toDecimal(value: unknown): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) return value;
  if (value === null || value === undefined || value === '') return new Prisma.Decimal(0);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return new Prisma.Decimal(0);
    return new Prisma.Decimal(value.toString());
  }
  const raw = String(value).replace(/\s/g, '');
  // 兼容意式写法：1.234,56 -> 1234.56
  const normalized = /,\d{1,}$/.test(raw) ? raw.replace(/\./g, '').replace(',', '.') : raw;
  try {
    return new Prisma.Decimal(normalized);
  } catch {
    return new Prisma.Decimal(0);
  }
}

/** 1.234,56 € */
export function formatEur(value: number | string | null | undefined): string {
  const n = toNumber(value);
  if (n === null) return '';
  // 显式开启分组：默认 auto 在部分运行时（含 Jest 的 VM 环境）会退化成无分隔符
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    useGrouping: true,
  }).format(n);
}

/** 1.234,5600（数量：4 位小数，逗号小数点） */
export function formatQty(value: number | string | null | undefined): string {
  const n = toNumber(value);
  if (n === null) return '';
  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
    useGrouping: true,
  }).format(n);
}

/** Excel 用：意式数字（不带动画字符），保留 2 位。 */
export function eurNumber(value: number | string | null | undefined): number {
  return toDecimal(value).toDecimalPlaces(2, ROUNDING).toNumber();
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  // Prisma Decimal / 字符串
  const raw = typeof value === 'object' && value !== null && 'toString' in value ? String(value) : String(value);
  const normalized = raw.replace(/\s/g, '').replace(/,/g, '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** 金额 = 数量 × 单价，四舍五入到 4 位（与 DB Decimal(14,4) 对齐）。 */
export function amountOf(qty: unknown, price: unknown): number {
  return amountDecimal(qty, price).toNumber();
}

/** 金额 = 数量 × 单价，按行 HALF_UP 到 2 位（财务口径）。 */
export function amountDecimal(qty: unknown, price: unknown): Prisma.Decimal {
  return toDecimal(qty).mul(toDecimal(price)).toDecimalPlaces(2, ROUNDING);
}
