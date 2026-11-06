import { useState } from 'react';
import { Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAppData } from '@/data/app-store';
import type { IStudent } from '@/data/types';
import { addDays, endOfMonth, endOfRange, parseISO, startOfMonth, startOfWeek, startOfYear, toISO } from '@/lib/dates';
import { computeRangeStats, formatMoney } from '@/lib/stats';

export default function SalaryPage() {
  const { data } = useAppData();
  const now = new Date();
  // 默认统计整月：规划(预排)按月内全部排课计，完成只算已标记完成的
  const [from, setFrom] = useState<string>(toISO(startOfMonth(now)));
  const [to, setTo] = useState<string>(toISO(endOfMonth(now)));

  const studentsById: Record<string, IStudent> = {};
  for (const s of data.students) studentsById[s.id] = s;

  const statsCustom = computeRangeStats(
    data.courses,
    studentsById,
    parseISO(from),
    endOfRange(parseISO(to)),
  );

  // 快捷区间一律取到该区间末尾：规划=区间内全部排课，完成的课不会有未来日期，故完成数不受影响
  const quick: { label: string; from: Date; to: Date }[] = [
    { label: '今日', from: now, to: endOfRange(now) },
    { label: '本周', from: startOfWeek(now), to: endOfRange(addDays(startOfWeek(now), 6)) },
    { label: '本月', from: startOfMonth(now), to: endOfMonth(now) },
    { label: '今年', from: startOfYear(now), to: new Date(now.getFullYear(), 11, 31, 23, 59, 59) },
  ];

  return (
    <div className="mx-auto flex h-[calc(100vh-96px)] max-w-[1500px] flex-col">
      <Card className="flex min-h-0 flex-1 flex-col shadow-sm">
        <CardContent className="min-h-0 flex-1 space-y-4 overflow-y-auto pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Wallet className="h-4 w-4 text-primary" />
              选择时间
            </span>
            <Input
              type="date"
              className="h-9 w-48"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <span className="text-muted-foreground">到</span>
            <Input
              type="date"
              className="h-9 w-48"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            {quick.map((q) => (
              <Button
                key={q.label}
                size="sm"
                variant="outline"
                onClick={() => {
                  setFrom(toISO(q.from));
                  setTo(toISO(q.to));
                }}
              >
                {q.label}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3 rounded-md border bg-muted/30 p-4">
            <div className="rounded-md bg-background p-4 text-center">
              <div className="text-sm font-semibold text-muted-foreground">总课时数（节）</div>
              <div className="mt-1 text-3xl font-bold text-emerald-500 tabular-nums">
                {statsCustom.doneCount}
              </div>
              <div className="mt-1 text-sm font-semibold text-muted-foreground">
                规划 {statsCustom.plannedCount}节
              </div>
            </div>
            <div className="rounded-md bg-background p-4 text-center">
              <div className="text-sm font-semibold text-muted-foreground">总时长(小时)</div>
              <div className="mt-1 text-3xl font-bold text-orange-500 tabular-nums">
                {statsCustom.doneHours.toFixed(1)}
              </div>
              <div className="mt-1 text-sm font-semibold text-muted-foreground">
                规划 {statsCustom.plannedHours.toFixed(1)}小时
              </div>
            </div>
            <div className="rounded-md bg-background p-4 text-center">
              <div className="text-sm font-semibold text-muted-foreground">薪资收入（元）</div>
              <div className="mt-1 text-3xl font-bold text-sky-500 tabular-nums">
                {Math.round(statsCustom.doneIncome)}
              </div>
              <div className="mt-1 text-sm font-semibold text-muted-foreground">
                规划 {formatMoney(statsCustom.plannedIncome)}
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            自定义区间：{from} 至 {to}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
