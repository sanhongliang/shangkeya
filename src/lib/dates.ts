// EXPORTS: toISO, parseISO, isSameDay, startOfWeek, startOfMonth, startOfYear, endOfRange, formatCN, formatTimeCN, WEEKDAYS_CN, WEEK_FULL_CN, HOURS_CN, inRange, addDays, pad2
export const WEEKDAYS_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export const WEEK_FULL_CN = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export const pad2 = (n: number): string => String(n).padStart(2, '0');

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + n);
  return nd;
}

export function isSameDay(a: Date, b: Date): boolean {
  return toISO(a) === toISO(b);
}

/** 本周一（从周一开始） */
export function startOfWeek(d: Date): Date {
  const nd = new Date(d);
  const dow = (nd.getDay() + 6) % 7;
  nd.setDate(nd.getDate() - dow);
  return nd;
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1);
}

/** 区间末端（含当天，23:59:59） */
export function endOfRange(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
}

/** date 字符串是否在 [from, to] 区间内 */
export function inRange(dateStr: string, from: Date, to: Date): boolean {
  const t = parseISO(dateStr).getTime();
  return t >= from.getTime() && t <= to.getTime();
}

export function formatCN(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日，${WEEKDAYS_CN[d.getDay()]}`;
}

export function formatTimeCN(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEK_FULL_CN[d.getDay()]}`;
}

export const HOURS_CN = Array.from({ length: 13 }, (_, i) => `${8 + i}:00`);
