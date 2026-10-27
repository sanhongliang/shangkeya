import { useState } from 'react';
import { Archive, ChevronDown, ChevronUp, Pencil, RotateCcw, Save, Trash2, UserPlus, X } from 'lucide-react';
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { IStudent } from '@/data/types';
import { cn } from '@/lib/utils';
import { studentBoardColor } from '@/lib/studentColor';

export interface StudentInfoSectionProps {
  student: IStudent | null;
  stats?: { recharge: number; used: number; remaining: number };
  readonly?: boolean;
  onSave: (student: IStudent) => void;
  onAdd: () => void;
  onDeleteForever?: (id: string) => void;
  onRestore?: (id: string) => void;
}

const TEXTBOOKS = ['通用版', '新人教版', '上海专用', '浙江专用', '鲁科版', '粤教版'];
const GRADES = [
  '一年级',
  '二年级',
  '三年级',
  '四年级',
  '五年级',
  '六年级',
  '初一',
  '初二',
  '初三',
  '高一',
  '高二',
  '高三',
];

export default function StudentInfoSection({
  student,
  stats,
  readonly = false,
  onSave,
  onAdd,
  onDeleteForever,
  onRestore,
}: StudentInfoSectionProps) {
  const [draft, setDraft] = useState<IStudent | null>(student);
  const [editing, setEditing] = useState(false);
  const [gradeOpen, setGradeOpen] = useState(false);
  const [textbookOpen, setTextbookOpen] = useState(false);

  const patch = (partial: Partial<IStudent>) => {
    setDraft((prev) => (prev ? { ...prev, ...partial } : prev));
  };

  const handleSave = () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error('学员姓名不能为空');
      return;
    }
    onSave(draft);
    setEditing(false);
    toast.success('学员信息已保存');
  };

  const handleCancel = () => {
    setDraft(student);
    setEditing(false);
  };

  if (!student) {
    return (
      <Card className="flex w-full shrink-0 flex-col items-center justify-center gap-3 text-muted-foreground">
        <CardContent className="py-16 text-center">
          <p>请选择左侧学员，或添加新学员</p>
          <Button className="mt-4" variant="outline" onClick={onAdd}>
            <UserPlus className="mr-1 h-4 w-4" />
            添加学员
          </Button>
        </CardContent>
      </Card>
    );
  }

  const display = draft ?? student;

  return (
    <Card className="w-full shrink-0">
      <CardContent className="space-y-4 pt-5">
        {/* 头部：头像 + 姓名 + 只读信息文字 */}
        <div className="flex items-center gap-3">
          <span
            className="flex h-12 w-12 shrink-0 translate-y-0.5 items-center justify-center rounded-full text-base font-bold text-white shadow-sm"
            style={{ backgroundColor: display.boardColor || studentBoardColor(display.id) }}
          >
            {display.name.charAt(0)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <div className="truncate text-base font-semibold">{display.name}</div>
                <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {display.grade}
                </span>
                <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {display.textbook}
                </span>
                <span className="truncate text-xs text-muted-foreground">性别：{display.gender}</span>
              </div>
              {readonly ? (
                <span className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-muted px-2.5 text-xs font-medium text-muted-foreground">
                  <Archive className="h-3.5 w-3.5" />
                  历史学员
                </span>
              ) : editing ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 gap-1 px-2.5 text-xs"
                  onClick={handleCancel}
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                  收起编辑
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 gap-1 px-2.5 text-xs"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  编辑
                </Button>
              )}
            </div>
            {/* 只读信息：第二行（统计由充值记录 / 开课记录计算） */}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>课时价格：{display.price}元</span>
              <span>累计充值：{stats?.recharge ?? 0}元</span>
              <span>已上课时：{stats?.used ?? 0}h</span>
              <span className="font-medium text-primary">剩余课时：{stats?.remaining ?? 0}h</span>
            </div>
          </div>
        </div>

        {/* 编辑模式：展开可编辑表单 */}
        {editing && (
          <div className="space-y-4 rounded-lg border bg-muted/20 p-3">
            {/* 基本信息 */}
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                基本信息
              </div>
              <div className="grid grid-cols-4 gap-x-8 gap-y-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Label className="w-16 shrink-0 text-right text-sm">学员姓名</Label>
                  <Input
                    value={display.name}
                    onChange={(e) => patch({ name: e.target.value })}
                    className="h-9 min-w-0 flex-1"
                  />
                </div>
                <div className="flex min-w-0 items-center gap-3">
                  <Label className="w-16 shrink-0 text-right text-sm">性别</Label>
                  <RadioGroup
                    value={display.gender}
                    onValueChange={(v) => patch({ gender: v as IStudent['gender'] })}
                    className="flex min-w-0 flex-1 items-center gap-2"
                  >
                    <div className="flex items-center gap-1">
                      <RadioGroupItem value="男" id="g-male" />
                      <Label htmlFor="g-male">男</Label>
                    </div>
                    <div className="flex items-center gap-1">
                      <RadioGroupItem value="女" id="g-female" />
                      <Label htmlFor="g-female">女</Label>
                    </div>
                  </RadioGroup>
                </div>
                <div className="flex min-w-0 items-center gap-3">
                  <Label className="w-16 shrink-0 text-right text-sm">年级</Label>
                  <div className="relative min-w-0 flex-1">
                    <Input
                      value={display.grade}
                      onChange={(e) => patch({ grade: e.target.value })}
                      className="h-9 w-full pr-8"
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 flex w-8 items-center justify-center rounded-r-md text-muted-foreground hover:bg-muted"
                      onClick={() => setGradeOpen((o) => !o)}
                      aria-label="打开年级选项"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    {gradeOpen && (
                      <>
                        <div data-no-drag className="fixed inset-0 z-40" onClick={() => setGradeOpen(false)} />
                        <div className="absolute right-0 top-full z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
                          {GRADES.map((g) => (
                            <button
                              key={g}
                              type="button"
                              className={cn(
                                'block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted',
                                display.grade === g && 'bg-accent text-primary',
                              )}
                              onClick={() => {
                                patch({ grade: g });
                                setGradeOpen(false);
                              }}
                            >
                              {g}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex min-w-0 items-center gap-3">
                  <Label className="w-16 shrink-0 text-right text-sm">教材版本</Label>
                  <div className="relative min-w-0 flex-1">
                    <Input
                      value={display.textbook}
                      onChange={(e) => patch({ textbook: e.target.value })}
                      className="h-9 w-full pr-8"
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 flex w-8 items-center justify-center rounded-r-md text-muted-foreground hover:bg-muted"
                      onClick={() => setTextbookOpen((o) => !o)}
                      aria-label="打开教材版本选项"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    {textbookOpen && (
                      <>
                        <div data-no-drag className="fixed inset-0 z-40" onClick={() => setTextbookOpen(false)} />
                        <div className="absolute right-0 top-full z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
                          {TEXTBOOKS.map((t) => (
                            <button
                              key={t}
                              type="button"
                              className={cn(
                                'block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted',
                                display.textbook === t && 'bg-accent text-primary',
                              )}
                              onClick={() => {
                                patch({ textbook: t });
                                setTextbookOpen(false);
                              }}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
              {/* 课费信息（无标签，排备注上方）：课时价格 / 推荐人 / 推荐规则 */}
              <div className="grid grid-cols-4 gap-x-8 gap-y-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Label className="w-16 shrink-0 text-right text-sm">课时价格</Label>
                  <Input
                    type="number"
                    value={display.price}
                    onChange={(e) => patch({ price: Number(e.target.value) || 0 })}
                    className="h-9 min-w-0 flex-1"
                  />
                </div>
                <div className="flex min-w-0 items-center gap-3">
                  <Label className="w-16 shrink-0 text-right text-sm">推荐人</Label>
                  <Input
                    value={display.referrer}
                    onChange={(e) => patch({ referrer: e.target.value })}
                    className="h-9 min-w-0 flex-1"
                  />
                </div>
                <div className="flex min-w-0 items-center gap-3">
                  <Label className="w-16 shrink-0 text-right text-sm">推荐规则</Label>
                  <Input
                    value={display.referralRule}
                    onChange={(e) => patch({ referralRule: e.target.value })}
                    className="h-9 min-w-0 flex-1"
                  />
                </div>
                {/* 对齐占位（不可见）：空标签 + 空输入框 */}
                <div className="invisible flex min-w-0 items-center gap-3" aria-hidden="true">
                  <Label className="w-16 shrink-0 text-right text-sm" />
                  <Input className="h-9 min-w-0 flex-1" tabIndex={-1} readOnly />
                </div>
              </div>
              {/* 备注 */}
              <div className="flex items-center gap-3">
                <Label className="w-16 shrink-0 text-right text-sm">备注</Label>
                <Input
                  value={display.note}
                  onChange={(e) => patch({ note: e.target.value })}
                  className="h-9 min-w-0 flex-1"
                />
              </div>
            </div>

            {/* 编辑模式操作 */}
            <div className="flex items-center justify-end gap-2 border-t pt-3">
              <Button variant="outline" size="sm" onClick={handleCancel}>
                <X className="mr-1 h-4 w-4" />
                取消
              </Button>
              <Button size="sm" onClick={handleSave}>
                <Save className="mr-1 h-4 w-4" />
                保存修改
              </Button>
            </div>
          </div>
        )}

        {/* 历史学员：恢复 / 彻底删除 */}
        {readonly && (
          <div className="flex items-center justify-end gap-2 border-t pt-4">
            <Button variant="outline" size="sm" className="gap-1" onClick={() => onRestore?.(student.id)}>
              <RotateCcw className="mr-1 h-4 w-4" />
              恢复学员
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1"
                  disabled={!!(student._shared || student._schoolStudent)}
                  title={(student._shared || student._schoolStudent) ? '学校学员不能删除' : undefined}
                >
                  <Trash2 className="mr-1 h-4 w-4" />
                  彻底删除学员
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>彻底删除学员</AlertDialogTitle>
                  <AlertDialogDescription>
                    确定彻底删除历史学员「{display.name}」吗？此操作不可恢复。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onDeleteForever?.(student.id)}>
                    彻底删除
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
