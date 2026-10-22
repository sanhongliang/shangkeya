import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toISO } from '@/lib/dates';
import { cn } from '@/lib/utils';
import type { ICourse } from '@/data/types';

/* ---------------- 添加充值记录 ---------------- */

export interface AddRechargeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (fields: { time: string; amount: number; method: string; note: string }) => void;
}

export function AddRechargeDialog({ open, onOpenChange, onAdd }: AddRechargeDialogProps) {
  const now = new Date();
  const [time, setTime] = useState(`${toISO(now)} ${String(now.getHours()).padStart(2, '0')}:00`);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('微信');
  const [note, setNote] = useState('');

  const handleSave = () => {
    const num = Number(amount);
    if (!amount || Number.isNaN(num) || num <= 0) {
      toast.error('请输入正确的充值金额');
      return;
    }
    onAdd({ time, amount: num, method, note: note.trim() });
    setAmount('');
    setNote('');
    onOpenChange(false);
    toast.success(`充值 ${num} 元已记录`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>添加充值记录</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-1.5">
            <Label>时间</Label>
            <Input
              type="datetime-local"
              className="w-full"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>金额（元）</Label>
            <Input type="number" className="w-full" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>方式</Label>
            <div className="flex gap-2">
              {['微信', '支付宝', '银行卡', '现金'].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className="flex-1 rounded-md border px-2 py-2 text-sm transition-colors"
                  style={{
                    borderColor: method === m ? '#2563eb' : '#d1d5db',
                    background: method === m ? '#eff6ff' : '#fff',
                    color: method === m ? '#2563eb' : '#374151',
                    fontWeight: method === m ? 600 : 400,
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>备注</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave}>添加</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- 学员月度课表 ---------------- */

const WEEK_CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function buildMonthCells(year: number, month: number): (number | null)[] {
  const first = new Date(year, month, 1);
  const startDow = (first.getDay() + 6) % 7; // 周一起
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export interface MonthScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentName: string;
  courses: ICourse[];
}

export function MonthScheduleDialog({ open, onOpenChange, studentName, courses }: MonthScheduleDialogProps) {
  const now = new Date();
  const [month, setMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));

  const prefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
  const byDate = new Map<string, ICourse[]>();
  for (const c of courses) {
    if (!c.date.startsWith(prefix)) continue;
    const list = byDate.get(c.date) ?? [];
    list.push(c);
    byDate.set(c.date, list);
  }
  const cells = buildMonthCells(month.getFullYear(), month.getMonth());
  const todayStr = now.toISOString().slice(0, 10);

  const prevMonth = () => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  const nextMonth = () => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[calc(100vw-3rem)] sm:h-[calc(100vh-3rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>学员月度课表 - {studentName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 w-8 p-0"
                onClick={prevMonth}
                aria-label="上一月"
              >
                ‹
              </Button>
              <span className="w-28 text-center text-sm font-medium">
                {month.getFullYear()}年{month.getMonth() + 1}月
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 w-8 p-0"
                onClick={nextMonth}
                aria-label="下一月"
              >
                ›
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="ml-2"
                onClick={() => setMonth(new Date(now.getFullYear(), now.getMonth(), 1))}
              >
                本月
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">
              共 {byDate.size} 天有课，{Array.from(byDate.values()).reduce((s, l) => s + l.length, 0)} 节
            </span>
          </div>

          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border bg-border">
            {WEEK_CN.map((w) => (
              <div key={w} className="bg-muted/50 px-2 py-1.5 text-center text-xs font-medium">
                {w}
              </div>
            ))}
            {cells.map((d, idx) => {
              if (d === null) return <div key={`e${idx}`} className="min-h-[104px] bg-background" />;
              const dateStr = `${prefix}-${String(d).padStart(2, '0')}`;
              const list = byDate.get(dateStr) ?? [];
              const isToday = dateStr === todayStr;
              return (
                <div
                  key={dateStr}
                  className={cn(
                    'min-h-[104px] bg-background p-1',
                    isToday && 'bg-accent/40',
                  )}
                >
                  <div
                    className={cn(
                      'mb-1 text-xs font-medium text-muted-foreground',
                      isToday && 'text-primary',
                    )}
                  >
                    {d}
                  </div>
                  <div className="space-y-0.5">
                    {list.map((c) => (
                      <div
                        key={c.id}
                        className={cn(
                          'rounded px-1 py-0.5 text-xs leading-tight',
                          c.done ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary',
                        )}
                        title={`${c.start}（${c.durationMin}min） ${c.content || ''}`}
                      >
                        <div className="font-medium">
                          {c.start}（{c.durationMin}min）
                        </div>
                        <div className="truncate">{c.content || '未填内容'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
