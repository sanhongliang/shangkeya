import { useState } from 'react';
import { CalendarRange, CheckCircle2, Plus, Trash2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import ReactECharts from 'echarts-for-react';
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
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAppData } from '@/data/app-store';
import type { ICourse, IScoreEntry, IStudent } from '@/data/types';
import { api } from '@/api/client';
import { cn } from '@/lib/utils';
import { pad2, toISO } from '@/lib/dates';

/** 排课时间本地化显示：MM-DD HH:mm */
function fmtCreated(v?: string): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
import {
  AddScheduleDialog,
  type AddScheduleValues,
} from '../SchedulePage/ScheduleDialogs';
import { AddRechargeDialog, MonthScheduleDialog } from './RecordDialogs';

export interface RecordsSectionProps {
  student: IStudent | null;
}

export default function RecordsSection({ student }: RecordsSectionProps) {
  const { data, setData } = useAppData();
  const [addCourseOpen, setAddCourseOpen] = useState(false);
  const [addRechargeOpen, setAddRechargeOpen] = useState(false);
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [monthOpen, setMonthOpen] = useState(false);

  const courses = data.courses
    .filter((c) => c.studentId === student?.id)
    .sort((a, b) => (a.date === b.date ? (a.start < b.start ? 1 : -1) : a.date < b.date ? 1 : -1));
  const recharges = data.recharges.filter((r) => r.studentId === student?.id);
  const scores = student ? (data.scores[student.id] ?? []) : [];

  if (!student) {
    return (
      <Card className="flex min-w-0 flex-1 items-center justify-center text-muted-foreground">
        <CardContent className="py-16 text-center text-sm">
          选择学员后查看开课记录、充值记录与成绩走势
        </CardContent>
      </Card>
    );
  }

  const markDone = (id: string) => {
    setData((prev) => ({
      ...prev,
      courses: prev.courses.map((c) => (c.id === id ? { ...c, done: true } : c)),
    }));
    toast.success('课程已标记完成');
  };

  // 成绩按日期升序（图表展示用）
  const sortedScores = [...scores].sort((a, b) => (a.date < b.date ? -1 : 1));

  const chartOption = {
    tooltip: { trigger: 'axis' as const },
    grid: { left: 44, right: 24, top: 30, bottom: 40 },
    xAxis: { type: 'category' as const, data: sortedScores.map((s) => s.date), boundaryGap: false },
    yAxis: { type: 'value' as const, min: 0, max: 150, name: '成绩' },
    series: [
      {
        name: '成绩',
        type: 'line' as const,
        smooth: true,
        symbolSize: 7,
        data: sortedScores.map((s) => s.score),
        lineStyle: { width: 3, color: '#1677ff' },
        itemStyle: { color: '#1677ff' },
        areaStyle: { color: 'rgba(22,119,255,0.12)' },
      },
    ],
  };

  const updateScore = (sortedIdx: number, patch: Partial<IScoreEntry>) => {
    const originalIdx = scores.indexOf(sortedScores[sortedIdx]);
    if (originalIdx < 0) return;
    setData((prev) => {
      const list = [...(prev.scores[student.id] ?? [])];
      list[originalIdx] = { ...list[originalIdx], ...patch };
      return { ...prev, scores: { ...prev.scores, [student.id]: list } };
    });
  };

  const removeScore = (sortedIdx: number) => {
    const target = sortedScores[sortedIdx];
    setData((prev) => {
      const list = (prev.scores[student.id] ?? []).filter((s) => s !== target);
      const scores = { ...prev.scores };
      if (list.length === 0) delete scores[student.id];
      else scores[student.id] = list;
      return { ...prev, scores };
    });
    toast.success('成绩记录已删除');
  };

  const addScore = () => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    setData((prev) => ({
      ...prev,
      scores: {
        ...prev.scores,
        [student.id]: [...(prev.scores[student.id] ?? []), { date: month, score: 80 }],
      },
    }));
    toast.success('已添加成绩记录，请编辑日期与分数');
  };

  return (
    <Card className="flex min-h-0 min-w-0 flex-1 flex-col">
      <CardContent className="flex h-full flex-col pt-4">
        <Tabs defaultValue="courses" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="w-fit gap-1">
            <TabsTrigger
              value="courses"
              className="rounded-md px-3 py-1.5 text-sm data-[state=active]:bg-primary/5 data-[state=active]:text-primary"
            >
              开课记录
            </TabsTrigger>
            <TabsTrigger
              value="recharges"
              className="rounded-md px-3 py-1.5 text-sm data-[state=active]:bg-primary/5 data-[state=active]:text-primary"
            >
              充值记录
            </TabsTrigger>
            <TabsTrigger
              value="scores"
              className="rounded-md px-3 py-1.5 text-sm data-[state=active]:bg-primary/5 data-[state=active]:text-primary"
            >
              成绩走势
            </TabsTrigger>
          </TabsList>
          <div className="my-3 border-b border-border" />

          {/* 开课记录 */}
          <TabsContent value="courses" className="flex min-h-0 flex-1 flex-col">
            <div className="mb-2 flex items-center gap-2">
              <Button
                size="sm"
                variant={deleteMode ? 'destructive' : 'outline'}
                onClick={() => {
                  if (deleteMode) {
                    if (selectedIds.length === 0) {
                      toast.error('请先勾选要删除的课程');
                      return;
                    }
                    setConfirmDeleteOpen(true);
                  } else {
                    setDeleteMode(true);
                    setSelectedIds([]);
                  }
                }}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                {deleteMode ? `删除 (${selectedIds.length})` : '批量删除'}
              </Button>
              {deleteMode && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDeleteMode(false);
                    setSelectedIds([]);
                  }}
                >
                  退出
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setAddCourseOpen(true)}>
                <Plus className="mr-1 h-4 w-4" />
                添加课程
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                onClick={() => setMonthOpen(true)}
              >
                <CalendarRange className="mr-1 h-4 w-4" />
                生成月度课表
              </Button>
            </div>
            <div className="list-scroll w-full flex-1 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 whitespace-nowrap">序号</TableHead>
                    <TableHead className="whitespace-nowrap">上课时间</TableHead>
                    <TableHead className="whitespace-nowrap">上课内容</TableHead>
                    <TableHead className="whitespace-nowrap">备注</TableHead>
                    <TableHead className="whitespace-nowrap">完成</TableHead>
                    {deleteMode && (
                      <TableHead className="w-12 whitespace-nowrap">
                        <Checkbox
                          checked={
                            selectedIds.length === courses.filter((x) => !x.done).length &&
                            courses.some((x) => !x.done)
                          }
                          onCheckedChange={(v) =>
                            setSelectedIds(
                              v ? courses.filter((x) => !x.done).map((c) => c.id) : [],
                            )
                          }
                          aria-label="全选"
                        />
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {courses.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={deleteMode ? 6 : 5} className="h-24 text-center text-muted-foreground">
                        暂无开课记录
                      </TableCell>
                    </TableRow>
                  )}
                  {courses.map((c, idx) => {
                    const isSelected = selectedIds.includes(c.id);
                    return (
                      <TableRow
                        key={c.id}
                        className={cn(
                          deleteMode && !c.done && isSelected && 'bg-primary/5',
                          deleteMode && !c.done && 'cursor-pointer',
                        )}
                        onClick={() => {
                          if (!deleteMode || c.done) return;
                          setSelectedIds((prev) =>
                            isSelected ? prev.filter((x) => x !== c.id) : [...prev, c.id],
                          );
                        }}
                      >
                        <TableCell className="whitespace-nowrap text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {c.date} {c.start}（{c.durationMin}min）
                          {c.ownerName ? (
                            <span className="ml-1 text-xs text-muted-foreground">
                              · {c.ownerName}排
                              {c.createdAt ? ` ${fmtCreated(c.createdAt)}` : ''}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <span className="block max-w-[240px] truncate">{c.content}</span>
                        </TableCell>
                        <TableCell>
                          <span className="block max-w-[160px] truncate text-muted-foreground">
                            {c.remark || '—'}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {c.done ? (
                            <CheckCircle2 className="h-4 w-4 text-success" />
                          ) : (
                            <button
                              type="button"
                              className="rounded px-1.5 py-0.5 text-xs text-primary hover:bg-accent"
                              onClick={() => markDone(c.id)}
                            >
                              标记完成
                            </button>
                          )}
                        </TableCell>
                        {deleteMode && (
                          <TableCell className="whitespace-nowrap">
                            <Checkbox
                              checked={isSelected}
                              disabled={c.done}
                              onCheckedChange={(v) => {
                                if (c.done) return;
                                setSelectedIds((prev) =>
                                  v ? [...prev, c.id] : prev.filter((x) => x !== c.id),
                                );
                              }}
                              onClick={(e) => e.stopPropagation()}
                              aria-label="选择"
                            />
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* 充值记录 */}
          <TabsContent value="recharges" className="mt-3 flex min-h-0 flex-1 flex-col">
            <div className="mb-2 flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setAddRechargeOpen(true)}>
                <Wallet className="mr-1 h-4 w-4" />
                添加充值
              </Button>
              <span className="ml-auto text-sm text-muted-foreground">
                累计充值：<span className="font-semibold text-foreground">{student.rechargeTotal}元</span>
              </span>
            </div>
            <div className="list-scroll w-full flex-1 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 whitespace-nowrap">序号</TableHead>
                    <TableHead className="whitespace-nowrap">时间</TableHead>
                    <TableHead className="whitespace-nowrap">金额</TableHead>
                    <TableHead className="whitespace-nowrap">方式</TableHead>
                    <TableHead className="whitespace-nowrap">备注</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recharges.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                        暂无充值记录
                      </TableCell>
                    </TableRow>
                  )}
                  {recharges.map((r, idx) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.time}</TableCell>
                      <TableCell className="whitespace-nowrap font-semibold text-success">{r.amount}元</TableCell>
                      <TableCell className="whitespace-nowrap">{r.method}</TableCell>
                      <TableCell>
                        <span className="block max-w-[200px] truncate text-muted-foreground">
                          {r.note || '—'}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* 成绩走势：左成绩列表（可编辑） + 右折线图 */}
          <TabsContent value="scores" className="mt-3 flex min-h-0 flex-1 flex-col">
            <div className="mb-2 flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={addScore}>
                <Plus className="mr-1 h-4 w-4" />
                添加成绩
              </Button>
              <span className="ml-auto text-sm text-muted-foreground">
                最近一次成绩：
                <span className="font-semibold text-foreground">
                  {sortedScores.length > 0 ? `${sortedScores[sortedScores.length - 1].score}分` : '—'}
                </span>
              </span>
            </div>
            <div className="flex min-h-0 flex-1 gap-4">
              {/* 左侧：成绩列表（可编辑） */}
              <div className="list-scroll w-[42%] shrink-0 overflow-y-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8 whitespace-nowrap">序号</TableHead>
                      <TableHead className="whitespace-nowrap">日期</TableHead>
                      <TableHead className="w-20 whitespace-nowrap">成绩</TableHead>
                      <TableHead className="w-12 whitespace-nowrap">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedScores.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                          暂无成绩数据
                        </TableCell>
                      </TableRow>
                    )}
                    {sortedScores.map((s, idx) => (
                      <TableRow key={`${s.date}-${idx}`}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Input
                            type="month"
                            value={s.date}
                            onChange={(e) => updateScore(idx, { date: e.target.value })}
                            className="h-8 w-[150px]"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            max={150}
                            value={s.score}
                            onChange={(e) =>
                              updateScore(idx, { score: Math.min(150, Math.max(0, Number(e.target.value) || 0)) })
                            }
                            className="h-8 w-20"
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                            onClick={() => removeScore(idx)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {/* 右侧：折线图 */}
              <div className="min-w-0 flex-1 rounded-lg border p-3">
                {sortedScores.length === 0 ? (
                  <div className="flex h-[440px] items-center justify-center text-sm text-muted-foreground">
                    暂无成绩数据，点击「添加成绩」开始记录
                  </div>
                ) : (
                  <ReactECharts option={chartOption} style={{ height: 440 }} />
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>

      <AddScheduleDialog
        open={addCourseOpen}
        onOpenChange={setAddCourseOpen}
        students={data.students}
        items={data.schedule.filter((k) => k.table === 2)}
        defaultStudentId={student.id}
        lockStudent
        onAdd={(values: AddScheduleValues) => {
          const start = new Date(`${values.startDate}T00:00:00`);
          const generated: ICourse[] = [];
          for (let i = 0; i < values.count; i += 1) {
            const date = new Date(start);
            date.setDate(start.getDate() + (values.mode === 'weekly' ? i * 7 : i));
            generated.push({
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
            courses: [...prev.courses, ...generated],
          }));
        }}
      />
      <AddRechargeDialog
        open={addRechargeOpen}
        onOpenChange={setAddRechargeOpen}
        onAdd={(fields) => {
          setData((prev) => ({
            ...prev,
            recharges: [...prev.recharges, { id: `r${Date.now()}`, studentId: student.id, ...fields }],
            students: prev.students.map((s) =>
              s.id === student.id ? { ...s, rechargeTotal: s.rechargeTotal + fields.amount } : s,
            ),
          }));
        }}
      />
      <MonthScheduleDialog
        open={monthOpen}
        onOpenChange={setMonthOpen}
        studentName={student.name}
        courses={data.courses}
      />

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除选中的 {selectedIds.length} 条开课记录吗？删除后不可恢复。
              已确认完成的课程不可删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setSelectedIds([]);
                setDeleteMode(false);
              }}
            >
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async () => {
                // 同步为“只增不删”，删除必须显式调服务器接口，否则刷新后会恢复
                for (const cid of selectedIds) {
                  await api('/api/desktop/course-delete', { method: 'POST', body: { fid: cid } }).catch(() => undefined);
                }
                setData((prev) => ({
                  ...prev,
                  courses: prev.courses.filter((x) => !selectedIds.includes(x.id)),
                }));
                toast.success(`已删除 ${selectedIds.length} 条开课记录`);
                setSelectedIds([]);
                setDeleteMode(false);
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
