import { useState } from 'react';
import { Archive, Plus, RotateCcw, Search, Trash2, Users } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import type { IStudent } from '@/data/types';
import { cn } from '@/lib/utils';
import { studentBoardColor } from '@/lib/studentColor';

export type StudentListMode = 'current' | 'archived';

export interface StudentListSectionProps {
  students: IStudent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onArchive: (id: string) => void;
  onDeleteForever: (id: string) => void;
  onRestore: (id: string) => void;
  mode: StudentListMode;
  onSwitchMode: (mode: StudentListMode) => void;
}

export default function StudentListSection({
  students,
  selectedId,
  onSelect,
  onAdd,
  onArchive,
  onDeleteForever,
  onRestore,
  mode,
  onSwitchMode,
}: StudentListSectionProps) {
  const [keyword, setKeyword] = useState('');
  const kw = keyword.trim();
  const filtered = kw ? students.filter((s) => s.name.includes(kw)) : students;
  const selectedStudent = students.find((s) => s.id === selectedId);
  const selectedName = selectedStudent?.name ?? '';
  // 学校学员（学校分配）老师端不能删除
  const selectedIsSchool = !!selectedStudent && (!!selectedStudent._shared || !!selectedStudent._schoolStudent);

  return (
    <div className="flex h-full max-h-[calc(100vh-96px)] w-60 shrink-0 flex-col rounded-xl border bg-card shadow-sm">
      {/* 模式切换：当前学员 / 历史学员 */}
      <div className="flex items-center gap-1 border-b p-2">
        <Button
          variant={mode === 'current' ? 'default' : 'ghost'}
          size="sm"
          className="h-8 flex-1 gap-1 text-xs"
          onClick={() => onSwitchMode('current')}
        >
          <Users className="h-3.5 w-3.5" />
          当前学员
        </Button>
        <Button
          variant={mode === 'archived' ? 'default' : 'ghost'}
          size="sm"
          className="h-8 flex-1 gap-1 text-xs"
          onClick={() => onSwitchMode('archived')}
        >
          <Archive className="h-3.5 w-3.5" />
          历史学员
        </Button>
      </div>

      <div className="flex items-center justify-between px-4 py-2.5">
        <span className="text-sm font-semibold">
          {mode === 'current' ? '学员列表' : '历史学员'}
        </span>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          {students.length}人
        </span>
      </div>

      <div className="border-b p-2.5">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索学员姓名"
            className="h-8 pl-8"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
      </div>

      <div className="list-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-1 p-2">
          {filtered.length === 0 && (
            <div className="px-2 py-10 text-center text-xs text-muted-foreground">
              {mode === 'current' ? '未找到匹配学员' : '暂无历史学员'}
            </div>
          )}
          {filtered.map((s) => (
            <button
              key={s.id}
              type="button"
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all',
                selectedId === s.id
                  ? 'bg-primary/10 ring-1 ring-primary/30'
                  : 'hover:bg-muted',
              )}
              onClick={() => onSelect(s.id)}
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white shadow-sm"
                style={{ backgroundColor: s.boardColor || studentBoardColor(s.id) }}
              >
                {s.name.charAt(0)}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block truncate text-sm font-medium',
                    selectedId === s.id ? 'text-primary' : 'text-foreground',
                  )}
                >
                  {s.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {s.grade} · {s.textbook}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 底部操作：添加 / 删除（移入历史）｜恢复 / 彻底删除 */}
      <div className="border-t p-2.5">
        {mode === 'current' ? (
          <div className="grid min-w-0 grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 min-w-0 gap-1 whitespace-nowrap px-1.5 text-xs"
              onClick={onAdd}
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              添加学员
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-8 min-w-0 gap-1 whitespace-nowrap px-1.5 text-xs"
                  disabled={!selectedId || selectedIsSchool}
                  title={selectedIsSchool ? '学校学员不能删除' : undefined}
                >
                  <Trash2 className="h-3.5 w-3.5 shrink-0" />
                  删除学员
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>删除学员</AlertDialogTitle>
                  <AlertDialogDescription>
                    确定将学员「{selectedName}」移入历史学员吗？其开课记录、充值记录与成绩将一并归档。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={() => selectedId && onArchive(selectedId)}>
                    删除
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : (
          <div className="grid min-w-0 grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 min-w-0 gap-1 whitespace-nowrap px-1.5 text-xs"
              disabled={!selectedId}
              onClick={() => selectedId && onRestore(selectedId)}
            >
              <RotateCcw className="h-3.5 w-3.5 shrink-0" />
              恢复学员
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-8 min-w-0 gap-1 whitespace-nowrap px-1.5 text-xs"
                  disabled={!selectedId || selectedIsSchool}
                  title={selectedIsSchool ? '学校学员不能删除' : undefined}
                >
                  <Trash2 className="h-3.5 w-3.5 shrink-0" />
                  彻底删除
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>彻底删除学员</AlertDialogTitle>
                  <AlertDialogDescription>
                    确定彻底删除历史学员「{selectedName}」吗？此操作不可恢复。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={() => selectedId && onDeleteForever(selectedId)}>
                    彻底删除
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>
    </div>
  );
}
