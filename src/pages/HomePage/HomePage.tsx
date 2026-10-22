import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlarmClock,
  Bell,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
  PlayCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import ClassSummaryDialog from '@/components/ClassSummaryDialog';
import RechargeDialog from '@/components/RechargeDialog';
import { fetchMyAccount } from '@/api/desktop';
import { useAppData } from '@/data/app-store';
import type { ICourse, IStudent } from '@/data/types';
import { startOfMonth, toISO } from '@/lib/dates';
import { computeRangeStats, formatDuration, formatMoney } from '@/lib/stats';
import { openClassroomWindow } from '@/lib/classroom-window';
import { cn } from '@/lib/utils';

/** 由开始时间 + 时长（分钟）计算结束时间，返回 "H:MM"（小时不带前导零） */
function formatEnd(start: string, durationMin: number): string {
  const [h, m] = start.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return start;
  const total = h * 60 + m + durationMin;
  const eh = Math.floor(total / 60) % 24;
  const em = total % 60;
  return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
}

function StatItem({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn('text-sm', strong ? 'font-semibold text-primary' : 'font-medium')}>
        {value}
      </span>
    </div>
  );
}

export default function HomePage() {
  const { data, setData } = useAppData();
  const navigate = useNavigate();
  const now = new Date();
  const [selectedDate, setSelectedDate] = useState<string>(toISO(now));
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryCourse, setSummaryCourse] = useState<ICourse | null>(null);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [expiry, setExpiry] = useState<string | null>(null);
  const [expiryChecked, setExpiryChecked] = useState(false);

  // 账号到期时间（老师账号续期提醒）
  useEffect(() => {
    fetchMyAccount()
      .then((r) => {
        if (r.ok) setExpiry(r.expires_at ?? null);
      })
      .catch(() => {})
      .finally(() => setExpiryChecked(true));
  }, []);

  // 首页窗口标题
  useEffect(() => {
    const tauriMode = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (tauriMode) {
      void import('@tauri-apps/api/window')
        .then((m) => m.getCurrentWindow().setTitle('上课鸭—教学课程管理系统'))
        .catch(() => {});
    } else {
      document.title = '上课鸭—教学课程管理系统';
    }
  }, []);

  const studentsById: Record<string, IStudent> = {};
  for (const s of data.students) {
    studentsById[s.id] = s;
  }

  const monthStats = computeRangeStats(data.courses, studentsById, startOfMonth(now), now);
  const dayCourses = data.courses
    .filter((c) => c.date === selectedDate)
    .sort((a, b) => (a.start < b.start ? -1 : 1));

  const openSummary = (course: ICourse) => {
    setSummaryCourse(course);
    setSummaryOpen(true);
  };

  const markDone = (course: ICourse) => {
    setData((prev) => ({
      ...prev,
      courses: prev.courses.map((c) => (c.id === course.id ? { ...c, done: true } : c)),
    }));
    toast.success(`「${course.content}」已标记完成`);
  };

  const enterClassroom = (course: ICourse) => {
    openClassroomWindow(`?courseId=${course.id}`);
  };

  return (
    <div className="mx-auto h-[calc(100vh-96px)] max-w-[1500px]">
      <div className="grid h-full grid-cols-[minmax(340px,2fr)_3fr] grid-rows-[minmax(0,1fr)] gap-5">
        {/* 左列：公告（弹性可调 + 纵向滚动）+ 本月课时进度（固定高） */}
        <div className="flex min-h-0 flex-col gap-5">
          <Card className="flex min-h-0 flex-1 flex-col">
            <CardHeader className="shrink-0 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Bell className="h-4 w-4 text-primary" />
                {data.announcement.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="list-scroll min-h-0 flex-1 overflow-y-auto">
              <p className="text-sm leading-relaxed text-foreground">{data.announcement.content}</p>
            </CardContent>
            {expiryChecked && (
              <div className="shrink-0 px-5 pb-4">
                <div
                  className={cn(
                    'flex items-center gap-3 rounded-md border px-3 py-2 text-sm',
                    !expiry || new Date(expiry).getTime() <= Date.now()
                      ? 'border-destructive/40 bg-destructive/10 text-destructive'
                      : 'border-primary/25 bg-primary/5 text-primary',
                  )}
                >
                  <AlarmClock className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    账号到期：
                    {expiry
                      ? `${new Date(expiry).toLocaleDateString('zh-CN')} ${
                          new Date(expiry).getTime() > Date.now()
                            ? `（剩余 ${Math.max(0, Math.ceil((new Date(expiry).getTime() - Date.now()) / 86400000))} 天）`
                            : '，请及时续期'
                        }`
                      : '未设置，请及时续期'}
                  </span>
                </div>
              </div>
            )}
          </Card>

          <Card className="shrink-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">本月课时进度</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                <StatItem label="预排课时" value={formatDuration(monthStats.plannedHours * 60)} />
                <StatItem
                  label="完成课时"
                  value={formatDuration(monthStats.doneHours * 60)}
                  strong
                />
                <StatItem label="预排收入" value={formatMoney(monthStats.plannedIncome)} />
                <StatItem label="完成收入" value={formatMoney(monthStats.doneIncome)} strong />
                <StatItem label="预排人数" value={`${monthStats.plannedStudents}人`} />
                <StatItem label="完成人数" value={`${monthStats.doneStudents}人`} strong />
                <StatItem label="预排节数" value={`${monthStats.plannedCount}节`} />
                <StatItem label="完成节数" value={`${monthStats.doneCount}节`} strong />
              </div>
              <button
                type="button"
                className="mt-4 text-xs text-primary hover:underline"
                onClick={() => navigate('/salary')}
              >
                *更多薪资问题请查看薪资详细*
              </button>
            </CardContent>
          </Card>
        </div>

        {/* 右列：今日课程 */}
        <Card className="flex min-h-0 min-w-0 flex-1 flex-col">
          <CardHeader className="shrink-0 pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarDays className="h-4 w-4 text-primary" />
                今日课程
              </CardTitle>
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                日期时间
                <Input
                  type="date"
                  className="h-8 w-44"
                  value={selectedDate}
                  onChange={(e) => {
                    setSelectedDate(e.target.value);
                  }}
                />
              </span>
            </div>
          </CardHeader>
          <CardContent className="list-scroll min-h-0 flex-1 space-y-3 overflow-y-auto">
            {dayCourses.length === 0 ? (
              <div className="flex h-44 flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-muted/20 text-muted-foreground">
                <CalendarDays className="h-9 w-9 text-muted-foreground/60" />
                <span className="text-sm">当日暂无课程安排</span>
              </div>
            ) : (
              dayCourses.map((c, idx) => {
                const student = studentsById[c.studentId];
                return (
                  <div
                    key={c.id}
                    className="group flex items-center gap-4 rounded-xl border bg-card p-3.5 shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
                  >
                    {/* 序号 */}
                    <div className="flex w-8 shrink-0 items-center justify-center">
                      <span className="text-base font-semibold text-muted-foreground">
                        {idx + 1}
                      </span>
                    </div>

                    {/* 学生 / 时间 / 内容 */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2.5">
                        <span className="truncate text-sm font-semibold text-foreground">
                          {student?.name ?? '—'}
                        </span>
                        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          {c.start}-{formatEnd(c.start, c.durationMin)}（{c.durationMin}min）
                        </span>
                      </div>
                      <p className="mt-1 truncate text-sm text-muted-foreground">{c.content}</p>
                      <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <BookOpen className="h-3.5 w-3.5" />
                          备课：
                          {c.prep ? (
                            <span className="font-medium text-success">已备</span>
                          ) : (
                            <span>未备</span>
                          )}
                        </span>
                        <span
                          className={cn(
                            'flex items-center gap-1',
                            c.done ? 'font-medium text-success' : 'text-muted-foreground',
                          )}
                        >
                          {c.done ? (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          ) : (
                            <Clock className="h-3.5 w-3.5" />
                          )}
                          {c.done ? '已完成' : '待上课'}
                        </span>
                        {c.summary?.content && (
                          <span className="flex items-center gap-1">
                            <FileText className="h-3.5 w-3.5" />
                            已有总结
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1 px-2.5 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          openSummary(c);
                        }}
                      >
                        <FileText className="h-3.5 w-3.5" />
                        总结
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1 px-2.5 text-xs"
                        disabled={c.done}
                        onClick={(e) => {
                          e.stopPropagation();
                          markDone(c);
                        }}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        完成
                      </Button>
                      <Button
                        size="sm"
                        className="h-8 gap-1 px-2.5 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          enterClassroom(c);
                        }}
                      >
                        <PlayCircle className="h-3.5 w-3.5" />
                        进入课堂
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      <ClassSummaryDialog
        open={summaryOpen}
        onOpenChange={setSummaryOpen}
        course={summaryCourse}
        studentName={summaryCourse ? (studentsById[summaryCourse.studentId]?.name ?? '') : ''}
        remainingHours={
          summaryCourse ? (studentsById[summaryCourse.studentId]?.remainingHours ?? 0) : 0
        }
        onSave={(summary) => {
          if (!summaryCourse) return;
          setData((prev) => ({
            ...prev,
            courses: prev.courses.map((c) =>
              c.id === summaryCourse.id ? { ...c, summary } : c,
            ),
          }));
          toast.success('课堂总结已保存');
        }}
      />
      <RechargeDialog open={rechargeOpen} onOpenChange={setRechargeOpen} />
    </div>
  );
}
