// EXPORTS: formatDuration, formatMoney, computeRangeStats, effectivePrice, IRangeStats
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
 * 某节课适用的小时价格（元/小时）。
 * 规则优先：学员设置了「有效、且该课日期落在规则区间内」的薪资规则时用规则金额；
 * 多条同时命中时取最后添加的一条（新规则优先）。没有命中任何规则才回落到原有 price。
 */
export function effectivePrice(student: IStudent, date: string): number {
  const rules = student.salaryRules ?? [];
  const hits: typeof rules = [];
  for (const r of rules) {
    if (!r.active) continue;
    if (r.start && date < r.start) continue;
    if (r.end && date > r.end) continue;
    hits.push(r);
  }
  if (hits.length === 0) return student.price;
  return hits[hits.length - 1].amount;
}

/**
 * 计算一段日期区间内的课时 / 收入 / 节数 / 人数统计（完成 vs 预排）。
 * 收入按学生课时价格 × 课时小时数计算；有薪资规则命中时按规则金额。
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
    const price = student ? effectivePrice(student, c.date) : 0;
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
