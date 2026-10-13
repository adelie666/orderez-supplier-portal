/**
 * 时间转换 —— 规划 §七
 * 存储一律 UTC；上游 ERP 时间为北京时间（UTC+8）；展示/筛选为 Europe/Rome。
 */

/** 上游 ERP 北京时间字符串/时间戳 → UTC Date。 */
export function beijingToUtc(input: string | number | Date | null | undefined): Date | null {
  if (input === null || input === undefined || input === '') return null;
  if (input instanceof Date) return new Date(input.getTime());

  if (typeof input === 'number') {
    // 秒级时间戳（上游 ERP 常见）
    const ms = input < 1e11 ? input * 1000 : input;
    return new Date(ms);
  }

  const text = input.trim();
  if (!text) return null;

  // 纯数字：当作时间戳
  if (/^\d{10}$/.test(text)) return new Date(Number(text) * 1000);
  if (/^\d{13}$/.test(text)) return new Date(Number(text));

  // "2026-10-08 12:30:00" / "2026-10-08T12:30:00" 视为北京时间
  const normalized = text.replace(' ', 'T').replace(/\/+$/, '');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(normalized)) {
    const withSeconds = normalized.length === 16 ? `${normalized}:00` : normalized;
    return new Date(`${withSeconds}+08:00`);
  }

  // 其它情况（已带时区）交给原生解析
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const ROME = 'Europe/Rome';

/** 取某时区在某时刻的 UTC 偏移毫秒数。 */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  // formatToParts 只到秒：先把基准时间截到秒，否则毫秒部分会污染偏移量
  const base = Math.floor(date.getTime() / 1000) * 1000;
  return asUtc - base;
}

/**
 * 意大利本地挂钟时间 → UTC。自动处理 CET/CEST（含 3/10 月切换）。
 * @param localDate 'YYYY-MM-DD' 或 Date（按本地挂钟字段取值）
 * @param endOfDay 为 true 时取当天 23:59:59.999
 */
export function romeLocalToUtc(localDate: string | Date, endOfDay = false): Date | null {
  if (!localDate) return null;
  let y: number, m: number, d: number;

  if (typeof localDate === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(localDate.trim());
    if (!match) return null;
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
  } else {
    y = localDate.getUTCFullYear();
    m = localDate.getUTCMonth() + 1;
    d = localDate.getUTCDate();
  }

  const h = endOfDay ? 23 : 0;
  const mi = endOfDay ? 59 : 0;
  const s = endOfDay ? 59 : 0;
  const ms = endOfDay ? 999 : 0;

  // 先按 UTC 假定，再用该时刻的罗马偏移校正（一次迭代足够，跨切换点用两次收敛）
  let guess = new Date(Date.UTC(y, m - 1, d, h, mi, s, ms));
  for (let i = 0; i < 2; i += 1) {
    const offset = zoneOffsetMs(guess, ROME);
    const next = new Date(Date.UTC(y, m - 1, d, h, mi, s, ms) - offset);
    if (next.getTime() === guess.getTime()) break;
    guess = next;
  }
  return guess;
}

/** 把 UTC 时间格式化为意大利本地字符串（默认紧凑 yyyy-MM-dd HH:mm）。 */
export function formatRome(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('it-IT', {
    timeZone: ROME,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

/** 意大利本地日期（yyyy-MM-dd），用于打印单 / 导出。 */
export function formatRomeDate(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ROME,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * 意大利本地日期 + 时分秒（DD/MM/YYYY HH:mm:ss）。
 * 打印单与 Excel 导出统一用它，保证看到的是意大利时间且精确到秒。
 */
export function formatRomeDateTime(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('it-IT', {
    timeZone: ROME,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

export const ROME_TIMEZONE = ROME;

/**
 * 把 UTC 时间格式化为上游 ERP 要求的北京时间字符串（yyyy-MM-dd HH:mm:ss）。
 * updateGe / updateLe / starttime / endtime 都按 G8（UTC+8）解析，无夏令时。
 */
export function formatBeijing(date: Date | string | number | null | undefined): string {
  if (date === null || date === undefined || date === '') return '';
  const d = date instanceof Date ? date : new Date(typeof date === 'number' ? date : String(date));
  if (Number.isNaN(d.getTime())) return '';
  const shifted = new Date(d.getTime() + 8 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())} ${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}:${p(shifted.getUTCSeconds())}`;
}
