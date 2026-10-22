import { useState } from 'react';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ICourse, ISummary } from '@/data/types';
import { cn } from '@/lib/utils';

export interface ClassSummaryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course: ICourse | null;
  studentName: string;
  remainingHours: number;
  onSave: (summary: ISummary) => void;
}

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className="p-0.5 rounded hover:bg-muted"
          onClick={() => onChange(n)}
          aria-label={`${n} 星`}
        >
          <Star
            className={cn(
              'h-5 w-5',
              n <= value ? 'fill-warning text-warning' : 'text-muted-foreground/40',
            )}
          />
        </button>
      ))}
    </div>
  );
}

export default function ClassSummaryDialog({
  open,
  onOpenChange,
  course,
  studentName,
  remainingHours,
  onSave,
}: ClassSummaryDialogProps) {
  const [content, setContent] = useState('');
  const [knowledge, setKnowledge] = useState('');
  const [behavior, setBehavior] = useState(4);
  const [mastery, setMastery] = useState(4);
  const [homework, setHomework] = useState(4);

  // 打开弹窗或切换课程时，以当前课程预填
  const handleOpenChange = (v: boolean) => {
    if (v && course) {
      setContent(course.summary?.content ?? course.content ?? '');
      setKnowledge(course.summary?.knowledge ?? '');
      setBehavior(course.summary?.behavior ?? 4);
      setMastery(course.summary?.mastery ?? 4);
      setHomework(course.summary?.homework ?? 4);
    }
    onOpenChange(v);
  };

  const handleSave = () => {
    if (!course) return;
    onSave({ content, knowledge, behavior, mastery, homework });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[373px]">
        <DialogHeader>
          <DialogTitle>课堂总结</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="flex items-center gap-2">
            <Label className="w-20 shrink-0 text-right">姓名</Label>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {studentName}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Label className="w-20 shrink-0 text-right">时间</Label>
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
              {course ? `${course.date} ${course.start} · ${course.durationMin}分钟` : '—'}
            </span>
          </div>
          <div className="flex items-start gap-2">
            <Label className="w-20 shrink-0 pt-2 text-right">内容</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={2}
              className="min-w-0 flex-1"
            />
          </div>
          <div className="flex items-start gap-2">
            <Label className="w-20 shrink-0 pt-2 text-right">涉及知识点</Label>
            <Textarea
              value={knowledge}
              onChange={(e) => setKnowledge(e.target.value)}
              rows={2}
              className="min-w-0 flex-1"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label className="w-20 shrink-0 text-right">课堂表现</Label>
            <StarRating value={behavior} onChange={setBehavior} />
          </div>
          <div className="flex items-center gap-2">
            <Label className="w-20 shrink-0 text-right">掌握情况</Label>
            <StarRating value={mastery} onChange={setMastery} />
          </div>
          <div className="flex items-center gap-2">
            <Label className="w-20 shrink-0 text-right">上节作业</Label>
            <StarRating value={homework} onChange={setHomework} />
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-20 shrink-0 text-right">课时剩余</Label>
            <span className="text-sm font-medium text-foreground">
              {Number.isFinite(remainingHours) ? `${remainingHours}小时` : '—'}
            </span>
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
