// EXPORTS: formatDuration, formatMoney, computeRangeStats, IRangeStats
import type { ICourse, IStudent } from '@/data/types';
import { inRange } from './dates';

export interface IRangeStats {
  plannedHours: number;
  doneHours: number;
  plannedIncome: number;
  doneIncome: number;
  plannedCount: number;
  doneCount: number;
  plannedStudents: number;
  doneStudents: number;
}

export function formatDuration(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = Math.round(totalMin % 60);
  if (h === 0) return `${m}分钟`;
  if (m === 0) return `${h}小时`;
  return `${h}小时${m}分钟`;
}

export function formatMoney(n: number): string {
  return `${Math.round(n)}元`;
}

/**
 * 计算一段日期区间内的课时 / 收入 / 节数 / 人数统计（完成 vs 预排）。
 * 收入按学生课时价格 × 课时小时数计算。
 */
export function computeRangeStats(
  courses: ICourse[],
  studentsById: Record<string, IStudent>,
  from: Date,
  to: Date,
): IRangeStats {
  const stats: IRangeStats = {
    plannedHours: 0,
    doneHours: 0,
    plannedIncome: 0,
    doneIncome: 0,
    plannedCount: 0,
    doneCount: 0,
    plannedStudents: 0,
    doneStudents: 0,
  };
  const plannedSet = new Set<string>();
  const doneSet = new Set<string>();

  for (const c of courses) {
    if (!inRange(c.date, from, to)) continue;
    const student = studentsById[c.studentId];
    const hours = c.durationMin / 60;
    const price = student ? student.price : 0;
    stats.plannedCount += 1;
    stats.plannedHours += hours;
    stats.plannedIncome += hours * price;
    if (student) plannedSet.add(student.id);
    if (c.done) {
      stats.doneCount += 1;
      stats.doneHours += hours;
      stats.doneIncome += hours * price;
      if (student) doneSet.add(student.id);
    }
  }
  stats.plannedStudents = plannedSet.size;
  stats.doneStudents = doneSet.size;
  return stats;
}
