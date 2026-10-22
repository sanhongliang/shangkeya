import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ICourse, IStudent } from '@/data/types';
import { toISO } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { SCHEDULE_MODES, START_HOURS, START_MINUTES } from './constants';

export interface ScheduleFormValues {
  studentId: string;
  weekday: number;
  startHour: number;
  startMin: number;
  durationMin: number;
  content: string;
}

export interface AddScheduleValues {
  studentId: string;
  startDate: string; // YYYY-MM-DD
  startHour: number;
  startMin: number;
  durationMin: number;
  mode: 'weekly' | 'daily';
  count: number;
}

export interface AddScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  students: IStudent[];
  courses: ICourse[];
  defaultStudentId?: string;
  lockStudent?: boolean;
  onAdd: (values: AddScheduleValues) => void;
}

/** 指定日期内与 [startTotal, endTotal) 时间重叠的课次标签 */
function findOverlaps(courses: ICourse[], students: IStudent[], date: string, startTotal: number, endTotal: number): string[] {
  const labels: string[] = [];
  for (const c of courses) {
    if (c.date !== date) continue;
    const sh = parseInt(c.start.slice(0, 2), 10) || 0;
    const sm = parseInt(c.start.slice(3, 5), 10) || 0;
    const es = sh * 60 + sm;
    const ee = es + (c.durationMin || 60);
    if (startTotal < ee && es < endTotal) {
      const name = students.find((s) => s.id === c.studentId)?.name ?? '该学员';
      const end = `${String(Math.floor(ee / 60)).padStart(2, '0')}:${String(ee % 60).padStart(2, '0')}`;
      labels.push(`${name} ${c.start}-${end}`);
    }
  }
  return labels;
}

const pad2 = (v: number) => String(v).padStart(2, '0');

export function AddScheduleDialog({
  open,
  onOpenChange,
  students,
  courses,
  defaultStudentId,
  lockStudent,
  onAdd,
}: AddScheduleDialogProps) {
  const [studentId, setStudentId] = useState(defaultStudentId ?? students[0]?.id ?? '');
  const [startDate, setStartDate] = useState(toISO(new Date()));
  const [startHour, setStartHour] = useState('8');
  const [startMin, setStartMin] = useState('0');
  const [durationMin, setDurationMin] = useState('60');
  const [mode, setMode] = useState<'weekly' | 'daily'>('weekly');
  const [count, setCount] = useState('1');
  const [durOpen, setDurOpen] = useState(false);
  const [hOpen, setHOpen] = useState(false);
  const [mOpen, setMOpen] = useState(false);
  const [countOpen, setCountOpen] = useState(false);

  const bumpCount = (delta: number) => {
    const cur = count === '' ? 1 : Number(count);
    let next = cur + delta;
    if (next > 8) next = 1;
    if (next < 1) next = 8;
    setCount(String(next));
  };

  const bumpDur = (delta: number) => {
    const cur = durationMin === '' ? 60 : Number(durationMin);
    let next = cur + delta * 10;
    if (next > 120) next = 10;
    if (next < 10) next = 120;
    setDurationMin(String(next));
  };

  const bumpHour = (delta: number) => {
    const cur = startHour === '' ? 0 : Number(startHour);
    let next = cur + delta;
    if (next > 23) next = 0;
    if (next < 0) next = 23;
    setStartHour(String(next));
  };

  const bumpMin = (delta: number) => {
    const cur = startMin === '' ? 0 : Number(startMin);
    let next = cur + delta * 10;
    if (next > 59) next = 0;
    if (next < 0) next = 50;
    setStartMin(String(next));
  };

  const handleSave = () => {
    if (!studentId) {
      toast.error('请选择学员');
      return;
    }
    if (!startDate) {
      toast.error('请选择日期');
      return;
    }
    const h = Number(startHour);
    const mi = Number(startMin);
    if (!Number.isInteger(h) || h < 0 || h > 23 || !Number.isInteger(mi) || mi < 0 || mi > 59) {
      toast.error('请输入有效时间（时 0-23，分 0-59）');
      return;
    }
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 60) {
      toast.error('请输入有效次数（1-8）');
      return;
    }
    const d = Number(durationMin);
    if (!Number.isFinite(d) || d < 10 || d > 120) {
      toast.error('请输入有效时长（10-120分钟）');
      return;
    }
    // 时间冲突检测：新增课次的每个日期与已存在同日期课次时间重叠即阻止
    const startTotal = h * 60 + mi;
    const endTotal = startTotal + d;
    const conflicts: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const date = new Date(`${startDate}T00:00:00`);
      date.setDate(date.getDate() + (mode === 'weekly' ? i * 7 : i));
      const dateStr = toISO(date);
      const labels = findOverlaps(courses, students, dateStr, startTotal, endTotal);
      for (const label of labels) if (!conflicts.includes(label)) conflicts.push(label);
    }
    if (conflicts.length > 0) {
      toast.error(`时间冲突：${conflicts.slice(0, 3).join('、')}${conflicts.length > 3 ? ' 等' : ''}`);
      return;
    }
    onAdd({
      studentId,
      startDate,
      startHour: h,
      startMin: mi,
      durationMin: d,
      mode,
      count: n,
    });
    onOpenChange(false);
    toast.success(`已生成 ${n} 节课程`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle>添加课程</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="flex items-center gap-3">
            <Label className="w-8 shrink-0 text-right">学员</Label>
            {lockStudent ? (
              <div className="flex min-h-9 w-full items-center rounded-md border bg-muted/40 px-3 text-sm">
                {students.find((s) => s.id === studentId)?.name ?? ''}
              </div>
            ) : (
              <div className="min-w-0 flex-1">
                <select
                  className="flex min-h-9 w-full items-center rounded-md border bg-transparent px-3 text-sm outline-none"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                >
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-8 shrink-0 text-right">日期</Label>
            <Input
              type="date"
              className="min-w-0 flex-1"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-8 shrink-0 text-right">时间</Label>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {/* 小时 */}
              <div className="relative w-24">
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={2}
                  className="w-full pr-14 text-center"
                  value={startHour === '' ? '' : startHour.padStart(2, '0')}
                  onChange={(e) => setStartHour(e.target.value.replace(/\D/g, '').slice(0, 2))}
                />
                <div className="absolute inset-y-0 right-0 flex items-center">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      className="flex h-3.5 w-5 items-center justify-center rounded-t text-muted-foreground hover:bg-muted"
                      onClick={() => bumpHour(1)}
                      aria-label="小时加一"
                    >
                      <ChevronUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      className="flex h-3.5 w-5 items-center justify-center rounded-b text-muted-foreground hover:bg-muted"
                      onClick={() => bumpHour(-1)}
                      aria-label="小时减一"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="flex h-full w-8 items-center justify-center rounded-r-md text-muted-foreground hover:bg-muted"
                    onClick={() => setHOpen((o) => !o)}
                    aria-label="打开小时选项"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
                {hOpen && (
                  <>
                    <div data-no-drag className="fixed inset-0 z-40" onClick={() => setHOpen(false)} />
                    <div className="absolute right-0 top-full z-50 mt-1 min-w-[72px] max-h-56 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
                      {START_HOURS.map((h) => (
                        <button
                          key={h}
                          type="button"
                          className={cn(
                            'block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted',
                            startHour === String(h) && 'bg-accent text-primary',
                          )}
                          onClick={() => {
                            setStartHour(String(h));
                            setHOpen(false);
                          }}
                        >
                          {String(h).padStart(2, '0')}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <span className="shrink-0 text-sm text-muted-foreground">时</span>
              {/* 分钟 */}
              <div className="relative w-24">
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={2}
                  className="w-full pr-14 text-center"
                  value={startMin === '' ? '' : startMin.padStart(2, '0')}
                  onChange={(e) => setStartMin(e.target.value.replace(/\D/g, '').slice(0, 2))}
                />
                <div className="absolute inset-y-0 right-0 flex items-center">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      className="flex h-3.5 w-5 items-center justify-center rounded-t text-muted-foreground hover:bg-muted"
                      onClick={() => bumpMin(1)}
                      aria-label="分钟加十"
                    >
                      <ChevronUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      className="flex h-3.5 w-5 items-center justify-center rounded-b text-muted-foreground hover:bg-muted"
                      onClick={() => bumpMin(-1)}
                      aria-label="分钟减十"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="flex h-full w-8 items-center justify-center rounded-r-md text-muted-foreground hover:bg-muted"
                    onClick={() => setMOpen((o) => !o)}
                    aria-label="打开分钟选项"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
                {mOpen && (
                  <>
                    <div data-no-drag className="fixed inset-0 z-40" onClick={() => setMOpen(false)} />
                    <div className="absolute right-0 top-full z-50 mt-1 min-w-[72px] max-h-56 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
                      {START_MINUTES.map((m) => (
                        <button
                          key={m}
                          type="button"
                          className={cn(
                            'block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted',
                            startMin === String(m) && 'bg-accent text-primary',
                          )}
                          onClick={() => {
                            setStartMin(String(m));
                            setMOpen(false);
                          }}
                        >
                          {String(m).padStart(2, '0')}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <span className="shrink-0 text-sm text-muted-foreground">分</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-8 shrink-0 text-right">时长</Label>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="relative w-24">
                <Input
                  type="number"
                  min={10}
                  max={120}
                  step={10}
                  className="no-spinner w-full pr-14 text-center"
                  value={durationMin}
                  onChange={(e) => setDurationMin(e.target.value)}
                />
                <div className="absolute inset-y-0 right-0 flex items-center">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      className="flex h-3.5 w-5 items-center justify-center rounded-t text-muted-foreground hover:bg-muted"
                      onClick={() => bumpDur(1)}
                      aria-label="时长加十"
                    >
                      <ChevronUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      className="flex h-3.5 w-5 items-center justify-center rounded-b text-muted-foreground hover:bg-muted"
                      onClick={() => bumpDur(-1)}
                      aria-label="时长减十"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="flex h-full w-8 items-center justify-center rounded-r-md text-muted-foreground hover:bg-muted"
                    onClick={() => setDurOpen((o) => !o)}
                    aria-label="打开时长选项"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
                {durOpen && (
                  <>
                    <div data-no-drag className="fixed inset-0 z-40" onClick={() => setDurOpen(false)} />
                    <div className="absolute right-0 top-full z-50 mt-1 min-w-[88px] max-h-56 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
                      {Array.from({ length: 12 }, (_, i) => (i + 1) * 10).map((d) => (
                        <button
                          key={d}
                          type="button"
                          className={cn(
                            'block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted',
                            durationMin === String(d) && 'bg-accent text-primary',
                          )}
                          onClick={() => {
                            setDurationMin(String(d));
                            setDurOpen(false);
                          }}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <span className="shrink-0 text-sm text-muted-foreground">分钟</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-8 shrink-0 text-right">方式</Label>
            <div className="min-w-0 flex-1">
              <Select value={mode} onValueChange={(v) => setMode(v as 'weekly' | 'daily')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCHEDULE_MODES.map((m) => (
                    <SelectItem key={m} value={m === '连续多周' ? 'weekly' : 'daily'}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-8 shrink-0 text-right">次数</Label>
            <div className="relative w-24">
              <Input
                type="number"
                min={1}
                max={8}
                step={1}
                className="no-spinner w-full pr-14 text-center"
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
              <div className="absolute inset-y-0 right-0 flex items-center">
                <div className="flex flex-col">
                  <button
                    type="button"
                    className="flex h-3.5 w-5 items-center justify-center rounded-t text-muted-foreground hover:bg-muted"
                    onClick={() => bumpCount(1)}
                    aria-label="次数加一"
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    className="flex h-3.5 w-5 items-center justify-center rounded-b text-muted-foreground hover:bg-muted"
                    onClick={() => bumpCount(-1)}
                    aria-label="次数减一"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </div>
                <button
                  type="button"
                  className="flex h-full w-8 items-center justify-center rounded-r-md text-muted-foreground hover:bg-muted"
                  onClick={() => setCountOpen((o) => !o)}
                  aria-label="打开次数选项"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
              {countOpen && (
                <>
                  <div data-no-drag className="fixed inset-0 z-40" onClick={() => setCountOpen(false)} />
                  <div className="absolute right-0 top-full z-50 mt-1 min-w-[72px] max-h-56 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
                    {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={cn(
                          'block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted',
                          count === String(n) && 'bg-accent text-primary',
                        )}
                        onClick={() => {
                          setCount(String(n));
                          setCountOpen(false);
                        }}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
          {mode === 'daily' ? (
            <p className="text-xs text-muted-foreground">
              将从所选日期起连续多天排课，共 {count || 0} 节
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              将从所选日期起每周同一天排课，共 {count || 0} 节
            </p>
          )}
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

export interface EditScheduleValues {
  studentId: string;
  date: string; // YYYY-MM-DD
  startHour: number;
  startMin: number;
  durationMin: number;
}

export interface EditScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  students: IStudent[];
  courses: ICourse[];
  item: ICourse | null;
  onSave: (values: EditScheduleValues) => void;
}

export function EditScheduleDialog({ open, onOpenChange, students, courses, item, onSave }: EditScheduleDialogProps) {
  const [studentId, setStudentId] = useState(item?.studentId ?? students[0]?.id ?? '');
  const [date, setDate] = useState(toISO(new Date()));
  const [startHour, setStartHour] = useState('8');
  const [startMin, setStartMin] = useState('0');
  const [durationMin, setDurationMin] = useState('60');
  const [durOpen, setDurOpen] = useState(false);
  const [hOpen, setHOpen] = useState(false);
  const [mOpen, setMOpen] = useState(false);

  const bumpDur = (delta: number) => {
    const cur = durationMin === '' ? 60 : Number(durationMin);
    let next = cur + delta * 10;
    if (next > 120) next = 10;
    if (next < 10) next = 120;
    setDurationMin(String(next));
  };

  const bumpHour = (delta: number) => {
    const cur = startHour === '' ? 0 : Number(startHour);
    let next = cur + delta;
    if (next > 23) next = 0;
    if (next < 0) next = 23;
    setStartHour(String(next));
  };

  const bumpMin = (delta: number) => {
    const cur = startMin === '' ? 0 : Number(startMin);
    let next = cur + delta * 10;
    if (next > 59) next = 0;
    if (next < 0) next = 50;
    setStartMin(String(next));
  };

  const handleSave = () => {
    if (!studentId) {
      toast.error('请选择学员');
      return;
    }
    if (!date) {
      toast.error('请选择日期');
      return;
    }
    const h = Number(startHour);
    const mi = Number(startMin);
    if (!Number.isInteger(h) || h < 0 || h > 23 || !Number.isInteger(mi) || mi < 0 || mi > 59) {
      toast.error('请输入有效时间（时 0-23，分 0-59）');
      return;
    }
    const d = Number(durationMin);
    if (!Number.isFinite(d) || d < 10 || d > 120) {
      toast.error('请输入有效时长（10-120分钟）');
      return;
    }
    // 冲突检测：同日期其他课次时间重叠即阻止（排除当前编辑的课次）
    const startTotal = h * 60 + mi;
    const endTotal = startTotal + d;
    const others = item ? courses.filter((c) => c.id !== item.id) : courses;
    const labels = findOverlaps(others, students, date, startTotal, endTotal);
    if (labels.length > 0) {
      toast.error(`时间冲突：${labels.slice(0, 3).join('、')}${labels.length > 3 ? ' 等' : ''}`);
      return;
    }
    onSave({ studentId, date, startHour: h, startMin: mi, durationMin: d });
    onOpenChange(false);
    toast.success('课程已修改');
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v && item) {
          setStudentId(item.studentId);
          setDate(item.date);
          setStartHour(item.start.slice(0, 2));
          setStartMin(item.start.slice(3, 5));
          setDurationMin(String(item.durationMin || 60));
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle>修改课程</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="flex items-center gap-3">
            <Label className="w-8 shrink-0 text-right">学员</Label>
            <div className="min-w-0 flex-1">
              <select
                className="flex min-h-9 w-full items-center rounded-md border bg-transparent px-3 text-sm outline-none"
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
              >
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-8 shrink-0 text-right">日期</Label>
            <Input
              type="date"
              className="min-w-0 flex-1"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-8 shrink-0 text-right">时间</Label>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {/* 小时 */}
              <div className="relative w-24">
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={2}
                  className="w-full pr-14 text-center"
                  value={startHour === '' ? '' : startHour.padStart(2, '0')}
                  onChange={(e) => setStartHour(e.target.value.replace(/\D/g, '').slice(0, 2))}
                />
                <div className="absolute inset-y-0 right-0 flex items-center">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      className="flex h-3.5 w-5 items-center justify-center rounded-t text-muted-foreground hover:bg-muted"
                      onClick={() => bumpHour(1)}
                      aria-label="小时加一"
                    >
                      <ChevronUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      className="flex h-3.5 w-5 items-center justify-center rounded-b text-muted-foreground hover:bg-muted"
                      onClick={() => bumpHour(-1)}
                      aria-label="小时减一"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="flex h-full w-8 items-center justify-center rounded-r-md text-muted-foreground hover:bg-muted"
                    onClick={() => setHOpen((o) => !o)}
                    aria-label="打开小时选项"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
                {hOpen && (
                  <>
                    <div data-no-drag className="fixed inset-0 z-40" onClick={() => setHOpen(false)} />
                    <div className="absolute right-0 top-full z-50 mt-1 min-w-[72px] max-h-56 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
                      {START_HOURS.map((h) => (
                        <button
                          key={h}
                          type="button"
                          className={cn(
                            'block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted',
                            startHour === String(h) && 'bg-accent text-primary',
                          )}
                          onClick={() => {
                            setStartHour(String(h));
                            setHOpen(false);
                          }}
                        >
                          {String(h).padStart(2, '0')}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <span className="shrink-0 text-sm text-muted-foreground">时</span>
              {/* 分钟 */}
              <div className="relative w-24">
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={2}
                  className="w-full pr-14 text-center"
                  value={startMin === '' ? '' : startMin.padStart(2, '0')}
                  onChange={(e) => setStartMin(e.target.value.replace(/\D/g, '').slice(0, 2))}
                />
                <div className="absolute inset-y-0 right-0 flex items-center">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      className="flex h-3.5 w-5 items-center justify-center rounded-t text-muted-foreground hover:bg-muted"
                      onClick={() => bumpMin(1)}
                      aria-label="分钟加十"
                    >
                      <ChevronUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      className="flex h-3.5 w-5 items-center justify-center rounded-b text-muted-foreground hover:bg-muted"
                      onClick={() => bumpMin(-1)}
                      aria-label="分钟减十"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="flex h-full w-8 items-center justify-center rounded-r-md text-muted-foreground hover:bg-muted"
                    onClick={() => setMOpen((o) => !o)}
                    aria-label="打开分钟选项"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
                {mOpen && (
                  <>
                    <div data-no-drag className="fixed inset-0 z-40" onClick={() => setMOpen(false)} />
                    <div className="absolute right-0 top-full z-50 mt-1 min-w-[72px] max-h-56 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
                      {START_MINUTES.map((m) => (
                        <button
                          key={m}
                          type="button"
                          className={cn(
                            'block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted',
                            startMin === String(m) && 'bg-accent text-primary',
                          )}
                          onClick={() => {
                            setStartMin(String(m));
                            setMOpen(false);
                          }}
                        >
                          {String(m).padStart(2, '0')}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <span className="shrink-0 text-sm text-muted-foreground">分</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-8 shrink-0 text-right">时长</Label>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="relative w-24">
                <Input
                  type="number"
                  min={10}
                  max={120}
                  step={10}
                  className="no-spinner w-full pr-14 text-center"
                  value={durationMin}
                  onChange={(e) => setDurationMin(e.target.value)}
                />
                <div className="absolute inset-y-0 right-0 flex items-center">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      className="flex h-3.5 w-5 items-center justify-center rounded-t text-muted-foreground hover:bg-muted"
                      onClick={() => bumpDur(1)}
                      aria-label="时长加十"
                    >
                      <ChevronUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      className="flex h-3.5 w-5 items-center justify-center rounded-b text-muted-foreground hover:bg-muted"
                      onClick={() => bumpDur(-1)}
                      aria-label="时长减十"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="flex h-full w-8 items-center justify-center rounded-r-md text-muted-foreground hover:bg-muted"
                    onClick={() => setDurOpen((o) => !o)}
                    aria-label="打开时长选项"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
                {durOpen && (
                  <>
                    <div data-no-drag className="fixed inset-0 z-40" onClick={() => setDurOpen(false)} />
                    <div className="absolute right-0 top-full z-50 mt-1 min-w-[88px] max-h-56 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
                      {Array.from({ length: 12 }, (_, i) => (i + 1) * 10).map((d) => (
                        <button
                          key={d}
                          type="button"
                          className={cn(
                            'block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted',
                            durationMin === String(d) && 'bg-accent text-primary',
                          )}
                          onClick={() => {
                            setDurationMin(String(d));
                            setDurOpen(false);
                          }}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <span className="shrink-0 text-sm text-muted-foreground">分钟</span>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
