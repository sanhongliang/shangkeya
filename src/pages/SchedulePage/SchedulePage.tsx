import { Fragment, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Pencil,
  PlayCircle,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ClassSummaryDialog from '@/components/ClassSummaryDialog';
import { useAppData } from '@/data/app-store';
import type { ICourse, IScheduleItem, ISummary, IStudent } from '@/data/types';
import { api } from '@/api/client';
import { addDays, pad2, startOfWeek, toISO, WEEKDAYS_CN } from '@/lib/dates';
import { openClassroomWindow } from '@/lib/classroom-window';
import { cn } from '@/lib/utils';
import { WEEKDAY_LABELS } from './constants';
import {
  AddScheduleDialog,
  EditScheduleDialog,
  type AddScheduleValues,
  type EditScheduleValues,
} from './ScheduleDialogs';

const HOUR_START = 0; // 全天 0-24 小时
const HOUR_COUNT = 24;
const SLOT_H = 48;
const GRID_H = HOUR_COUNT * SLOT_H;

/** 学员课程块配色盘：不同学员显示不同背景色 */
const COURSE_PALETTE = [
  '#1677ff', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4',
  '#84cc16', '#f97316', '#ec4899', '#6366f1', '#14b8a6', '#a855f7',
];

function courseColorOf(studentId: string, students: IStudent[]): string {
  const idx = students.findIndex((s) => s.id === studentId);
  return COURSE_PALETTE[idx < 0 ? 0 : idx % COURSE_PALETTE.length];
}

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

export default function SchedulePage() {
  const { data, setData, refresh } = useAppData();
  const [activeTable, setActiveTable] = useState<1 | 2>(2);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [calMonth, setCalMonth] = useState<Date>(() => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryCourse, setSummaryCourse] = useState<ICourse | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const weekGridRef = useRef<HTMLDivElement | null>(null);

  // 默认从 8 点开始显示（滚动到 8:00 位置）
  useEffect(() => {
    if (weekGridRef.current) {
      weekGridRef.current.scrollTop = 8 * SLOT_H;
    }
  }, []);

  const studentsById: Record<string, IStudent> = {};
  for (const s of data.students) studentsById[s.id] = s;

  const weekStart = startOfWeek(selectedDate);
  const weekDates = WEEKDAY_LABELS.map((_, i) => addDays(weekStart, i));
  const items = data.schedule.filter((k) => k.table === activeTable);
  const selectedCourse = data.courses.find((c) => c.id === selectedItemId) ?? null;

  const cells = buildMonthCells(calMonth.getFullYear(), calMonth.getMonth());
  const todayStr = toISO(new Date());

  const changeTable = (v: string) => {
    setActiveTable(v === '1' ? 1 : 2);
    setSelectedItemId(null);
  };

  /** 由课次 start+durationMin 推算结束时间 HH:mm */
  const courseEnd = (c: { start: string; durationMin?: number }) => {
    const sh = parseInt(c.start.slice(0, 2), 10) || 0;
    const sm = parseInt(c.start.slice(3, 5), 10) || 0;
    const total = sh * 60 + sm + (c.durationMin || 60);
    return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
  };

  /** 删除课次时同步删除对应周模板（按学员+日期+开始时间匹配） */
  const removeMatchingTemplate = (prev: {
    courses: ICourse[];
    schedule: IScheduleItem[];
  }, c: ICourse): { courses: ICourse[]; schedule: IScheduleItem[] } => {
    const sh = parseInt(c.start.slice(0, 2), 10) || 0;
    const sm = parseInt(c.start.slice(3, 5), 10) || 0;
    return {
      courses: prev.courses.filter((x) => x.id !== c.id),
      schedule: prev.schedule.filter(
        (k) => !(k.studentId === c.studentId && k.date === c.date && k.startHour === sh && k.startMin === sm),
      ),
    };
  };

  const addItems = (values: AddScheduleValues) => {
    const start = new Date(`${values.startDate}T00:00:00`);
    const generated: IScheduleItem[] = [];
    const generatedCourses: ICourse[] = [];
    for (let i = 0; i < values.count; i += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + (values.mode === 'weekly' ? i * 7 : i));
      const weekday = ((date.getDay() + 6) % 7) + 1;
      const endTotal = values.startHour * 60 + values.startMin + values.durationMin;
      generated.push({
        id: `k${Date.now()}-${i}`,
        table: activeTable,
        date: toISO(date),
        weekday,
        startHour: values.startHour,
        startMin: values.startMin,
        endHour: Math.floor(endTotal / 60),
        endMin: endTotal % 60,
        studentId: values.studentId,
        content: '',
        done: false,
      });
      generatedCourses.push({
        id: `c${Date.now()}-${i}`,
        studentId: values.studentId,
        date: toISO(date),
        start: `${pad2(values.startHour)}:${pad2(values.startMin)}`,
        durationMin: values.durationMin,
        content: '',
        remark: '',
        done: false,
        prep: false,
      });
    }
    setData((prev) => ({
      ...prev,
      schedule: [...prev.schedule, ...generated],
      courses: [...prev.courses, ...generatedCourses],
    }));
  };

  const deleteItem = async () => {
    if (!selectedCourse) {
      toast.error('请先选择要删除的课程');
      return;
    }
    // 同步为“只增不删”，删除必须显式调服务器删除接口，否则刷新后会恢复
    await api('/api/desktop/course-delete', { method: 'POST', body: { fid: selectedCourse.id } }).catch(() => undefined);
    setData((prev) => ({ ...prev, ...removeMatchingTemplate(prev, selectedCourse) }));
    setSelectedItemId(null);
    toast.success('课程已删除');
  };

  const saveEditedItem = (values: EditScheduleValues) => {
    if (!selectedCourse) return;
    const start = `${pad2(values.startHour)}:${pad2(values.startMin)}`;
    const d = new Date(`${values.date}T00:00:00`);
    const endTotal = values.startHour * 60 + values.startMin + values.durationMin;
    const sh = parseInt(selectedCourse.start.slice(0, 2), 10) || 0;
    const sm = parseInt(selectedCourse.start.slice(3, 5), 10) || 0;
    setData((prev) => ({
      ...prev,
      courses: prev.courses.map((c) =>
        c.id === selectedCourse.id
          ? { ...c, studentId: values.studentId, date: values.date, start, durationMin: values.durationMin }
          : c,
      ),
      schedule: prev.schedule.map((k) =>
        k.studentId === selectedCourse.studentId && k.date === selectedCourse.date && k.startHour === sh && k.startMin === sm
          ? {
              ...k,
              studentId: values.studentId,
              date: values.date,
              weekday: ((d.getDay() + 6) % 7) + 1,
              startHour: values.startHour,
              startMin: values.startMin,
              endHour: Math.floor(endTotal / 60),
              endMin: endTotal % 60,
            }
          : k,
      ),
    }));
  };

  const confirmDone = () => {
    if (!selectedCourse) {
      toast.error('请先选择课程');
      return;
    }
    setData((prev) => ({
      ...prev,
      courses: prev.courses.map((c) => (c.id === selectedCourse.id ? { ...c, done: true } : c)),
    }));
    toast.success('课程已确认完成');
  };

  const openSummary = () => {
    if (!selectedCourse) return;
    setSummaryCourse({
      ...selectedCourse,
      remark: selectedCourse.remark ?? '',
      done: selectedCourse.done,
      prep: true,
    });
    setSummaryOpen(true);
  };

  const saveSummary = (summary: ISummary) => {
    if (!summaryCourse) return;
    const existing = data.courses.some((c) => c.id === summaryCourse.id);
    setData((prev) => ({
      ...prev,
      courses: existing
        ? prev.courses.map((c) => (c.id === summaryCourse.id ? { ...c, summary } : c))
        : [
            ...prev.courses,
            {
              id: summaryCourse.id,
              studentId: summaryCourse.studentId,
              date: summaryCourse.date,
              start: summaryCourse.start,
              durationMin: summaryCourse.durationMin,
              content: summaryCourse.content,
              remark: '',
              done: true,
              prep: true,
              summary,
            },
          ],
    }));
    toast.success('课堂总结已保存，并记入开课记录');
  };

  const enterClassroom = () => {
    if (!selectedCourse) {
      toast.error('请先选择课程');
      return;
    }
    const start = selectedCourse.start;
    const end = courseEnd(selectedCourse);
    openClassroomWindow(
      `?studentId=${selectedCourse.studentId}&time=${selectedCourse.date} ${start}-${end}&courseId=${selectedCourse.id}`,
    );
  };

  return (
    <div className="mx-auto flex max-w-[1500px] items-start gap-4">
      {/* 课表主体 */}
      <Card className="flex min-h-0 min-w-0 max-h-[calc(100vh-96px)] flex-1 flex-col">
        <CardContent className="flex min-h-0 flex-1 flex-col pt-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <Tabs value={String(activeTable)} onValueChange={changeTable}>
              <TabsList>
                <TabsTrigger value="1">月课表</TabsTrigger>
                <TabsTrigger value="2">周课表</TabsTrigger>
              </TabsList>
            </Tabs>

            {/* 月导航：上一月/本月/下一月（与月课表按钮同行，最右侧，无边框） */}
            {activeTable === 1 && (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  上一月
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setCalMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
                >
                  本月
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1))}
                >
                  下一月
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            {/* 周导航：上一周/本周/下一周（与周课表按钮同行，最右侧，无边框） */}
            {activeTable === 2 && (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => setSelectedDate(addDays(selectedDate, -7))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  上一周
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setSelectedDate(new Date())}
                >
                  本周
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => setSelectedDate(addDays(selectedDate, 7))}
                >
                  下一周
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={async () => {
                    const ok = await refresh();
                    if (ok) toast.success('已同步服务器数据');
                    else toast.error('同步失败，请检查网络或登录状态');
                  }}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  刷新
                </Button>
              </div>
            )}
          </div>

          {activeTable === 1 ? (
            /* ===== 月课表：当月日历月视图 ===== */
            <div className="list-scroll min-h-0 flex-1 overflow-y-auto">
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAY_LABELS.map((w) => (
                <div
                  key={w}
                  className="border-b py-1.5 text-center text-sm font-medium text-muted-foreground"
                >
                  {w}
                </div>
              ))}
              {cells.map((d, i) => {
                if (d === null) {
                  return <div key={i} className="min-h-[92px]" />;
                }
                const date = new Date(calMonth.getFullYear(), calMonth.getMonth(), d);
                const weekday = ((date.getDay() + 6) % 7) + 1;
                const dayItems = data.courses.filter((c) => c.date === toISO(date));
                const isToday = toISO(date) === todayStr;
                const isSelected = toISO(date) === toISO(selectedDate);
                return (
                  <div
                    key={i}
                    className={cn(
                      'min-h-[92px] cursor-pointer rounded-md border p-1.5 transition-colors',
                      isSelected
                        ? 'border-primary bg-accent'
                        : isToday
                          ? 'border-primary/50 bg-primary/5'
                          : 'border-border hover:bg-muted',
                    )}
                    onClick={() => {
                      setSelectedDate(date);
                      setSelectedItemId(null);
                    }}
                  >
                    <div className={cn('text-xs font-medium', isToday && 'text-primary')}>{d}</div>
                    <div className="mt-1 space-y-0.5">
                      {dayItems.map((k) => {
                        const student = studentsById[k.studentId];
                        const cc = courseColorOf(k.studentId, data.students);
                        const isSel = selectedCourse?.id === k.id;
                        return (
                          <button
                            key={k.id}
                            type="button"
                            className={cn(
                              'block w-full truncate rounded px-1 text-left text-[11px] leading-4 text-black transition-colors',
                              isSel
                                ? 'bg-primary/10 ring-1 ring-primary'
                                : 'hover:brightness-95',
                              k.done && 'opacity-60',
                            )}
                            style={{
                              backgroundColor: isSel ? undefined : `${cc}18`,
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedItemId(k.id);
                              setSelectedDate(date);
                            }}
                          >
                            {student?.name ?? '—'} {k.start}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            </div>
          ) : (
            /* ===== 周课表：时间网格 ===== */
            <>
              {/* 表头 */}
              <div className="grid" style={{ gridTemplateColumns: '56px repeat(7, 1fr)' }}>
                <div />
                {WEEKDAY_LABELS.map((w, i) => (
                  <div
                    key={w}
                    className={cn(
                      'border-b py-1.5 text-center text-sm font-medium',
                      toISO(weekDates[i]) === todayStr && 'text-primary',
                    )}
                  >
                    {w}({weekDates[i].getDate()}日)
                  </div>
                ))}
              </div>

              {/* 网格 + 课程块（0-24 小时，可滚动） */}
              <div ref={weekGridRef} className="list-scroll min-h-0 flex-1 overflow-y-auto">
                <div className="relative" style={{ height: GRID_H }}>
                  <div
                    className="absolute inset-0 grid"
                    style={{
                      gridTemplateColumns: '56px repeat(7, 1fr)',
                      gridTemplateRows: `repeat(${HOUR_COUNT}, ${SLOT_H}px)`,
                    }}
                  >
                    {Array.from({ length: HOUR_COUNT }, (_, hi) => {
                      const hour = HOUR_START + hi;
                      return (
                        <Fragment key={hour}>
                          <div className="border-b pr-2 text-right text-xs leading-[48px] text-black">
                            {pad2(hour)}:00
                          </div>
                          {WEEKDAY_LABELS.map((_, di) => (
                            <div key={di} className="border-b border-r" />
                          ))}
                        </Fragment>
                      );
                    })}
                  </div>
                  {/* 课程块 */}
                  {WEEKDAY_LABELS.map((_, di) => (
                    <div
                      key={di}
                      className="absolute inset-y-0"
                      style={{
                        left: `calc(56px + ${di} * (100% - 56px) / 7)`,
                        width: 'calc((100% - 56px) / 7)',
                      }}
                    >
                      {data.courses
                        .filter((c) => c.date === toISO(weekDates[di]))
                        .map((k) => {
                          const startTotal =
                            (parseInt(k.start.slice(0, 2), 10) || 0) * 60 +
                            (parseInt(k.start.slice(3, 5), 10) || 0);
                          const dur = k.durationMin || 60;
                          const student = studentsById[k.studentId];
                          const cc = courseColorOf(k.studentId, data.students);
                          const isSel = selectedCourse?.id === k.id;
                          return (
                            <button
                              key={k.id}
                              type="button"
                              className={cn(
                                'absolute inset-x-1 overflow-hidden rounded border px-1.5 py-1 text-left text-xs leading-tight transition-colors',
                                isSel
                                  ? 'border-primary shadow-sm ring-2 ring-primary'
                                  : 'hover:brightness-95',
                                k.done && 'opacity-60',
                              )}
                              style={{
                                top: (startTotal / 60) * SLOT_H + 2,
                                height: (dur / 60) * SLOT_H - 4,
                                backgroundColor: isSel ? `${cc}2E` : `${cc}18`,
                                borderColor: `${cc}40`,
                                color: '#000',
                              }}
                              onClick={() => setSelectedItemId(k.id)}
                            >
                              <span className="block truncate font-medium">
                                {student?.name ?? '—'}
                              </span>
                              <span className="block truncate text-muted-foreground">
                                {k.start}-{courseEnd(k)}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 右侧：日历 + 操作 */}
      <div className="w-64 shrink-0 space-y-4">
        <Card>
          <CardContent className="pt-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold">
                {calMonth.getFullYear()}年{calMonth.getMonth() + 1}月
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center">
              {WEEKDAY_LABELS.map((w) => (
                <div key={w} className="py-1 text-xs text-muted-foreground">
                  {w.replace('周', '')}
                </div>
              ))}
              {cells.map((d, i) => (
                <button
                  key={i}
                  type="button"
                  className={cn(
                    'flex h-7 items-center justify-center rounded text-xs',
                    d === null && 'invisible',
                    d !== null && toISO(new Date(calMonth.getFullYear(), calMonth.getMonth(), d)) === todayStr
                      ? 'bg-primary font-semibold text-white'
                      : d !== null &&
                          toISO(selectedDate) === toISO(new Date(calMonth.getFullYear(), calMonth.getMonth(), d))
                        ? 'bg-accent font-semibold text-primary'
                        : 'hover:bg-muted',
                  )}
                  onClick={() => d !== null && setSelectedDate(new Date(calMonth.getFullYear(), calMonth.getMonth(), d))}
                >
                  {d}
                </button>
              ))}
            </div>
            <div className="mt-2 border-t pt-2 text-xs text-muted-foreground">
              今天:{todayStr.replace(/-/g, '/')}/{WEEKDAYS_CN[new Date().getDay()]}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2.5 pt-4">
            <Button size="sm" className="w-full" onClick={() => setAddOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              添加课程
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              disabled={!selectedCourse}
              onClick={() => setConfirmDeleteOpen(true)}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              删除课程
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              disabled={!selectedCourse}
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="mr-1 h-4 w-4" />
              修改课程
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              disabled={!selectedCourse}
              onClick={openSummary}
            >
              <FileText className="mr-1 h-4 w-4" />
              编辑总结
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              disabled={!selectedCourse || selectedCourse.done}
              onClick={confirmDone}
            >
              <CheckCircle2 className="mr-1 h-4 w-4" />
              确认完成
            </Button>
            <Button size="sm" className="w-full" onClick={enterClassroom}>
              <PlayCircle className="mr-1 h-4 w-4" />
              进入课堂
            </Button>
          </CardContent>
        </Card>
      </div>

      <AddScheduleDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        students={data.students}
        courses={data.courses}
        onAdd={addItems}
      />
      <EditScheduleDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        students={data.students}
        courses={data.courses}
        item={selectedCourse}
        onSave={saveEditedItem}
      />
      <ClassSummaryDialog
        open={summaryOpen}
        onOpenChange={setSummaryOpen}
        course={summaryCourse}
        studentName={summaryCourse ? (studentsById[summaryCourse.studentId]?.name ?? '') : ''}
        remainingHours={
          summaryCourse ? (studentsById[summaryCourse.studentId]?.remainingHours ?? 0) : 0
        }
        onSave={saveSummary}
      />
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除课程</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除
              {selectedCourse
                ? `${studentsById[selectedCourse.studentId]?.name ?? '该学员'} ${selectedCourse.start}`
                : '该'}
              课程吗？删除后不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmDeleteOpen(false);
                deleteItem();
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
