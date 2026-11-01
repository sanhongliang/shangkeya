import { useState } from 'react';
import { toast } from 'sonner';
import { useAppData } from '@/data/app-store';
import type { IAppData, IStudent } from '@/data/types';
import { api } from '@/api/client';
import { STUDENT_BOARD_COLORS } from '@/lib/studentColor';
import RecordsSection from './RecordsSection';
import StudentInfoSection from './StudentInfoSection';
import StudentListSection from './StudentListSection';

function emptyStudent(name: string, colorIdx: number): IStudent {
  return {
    id: `s${Date.now()}`,
    name,
    gender: '男',
    boardColor: STUDENT_BOARD_COLORS[colorIdx % STUDENT_BOARD_COLORS.length],
    grade: '高一',
    textbook: '通用版',
    other: '',
    price: 150,
    referrer: '',
    referralRule: '',
    rechargeTotal: 0,
    usedHours: 0,
    remainingHours: 0,
    note: '',
  };
}

/** 学员列表排序：按添加时间倒序（新添加的在前）；本地新加尚未同步（无 created_at）的排最前 */
function sortByCreatedDesc(a: IStudent, b: IStudent): number {
  const ta = a.created_at || '';
  const tb = b.created_at || '';
  if (!ta && !tb) return 0;
  if (!ta) return -1;
  if (!tb) return 1;
  return ta < tb ? 1 : ta > tb ? -1 : 0;
}

/** 由充值记录 / 开课记录动态计算学员课时统计 */
function calcStudentStats(s: IStudent | null, data: IAppData) {
  if (!s) return { recharge: 0, used: 0, remaining: 0 };
  const recharge = data.recharges
    .filter((r) => r.studentId === s.id)
    .reduce((sum, r) => sum + r.amount, 0);
  const used =
    Math.round(
      (data.courses
        .filter((c) => c.studentId === s.id && c.done)
        .reduce((sum, c) => sum + c.durationMin, 0) /
        60) *
        10,
    ) / 10;
  const bought = s.price > 0 ? Math.floor(recharge / s.price) : 0;
  const remaining = Math.max(0, bought - used);
  return { recharge, used, remaining };
}

export default function StudentsPage() {
  const { data, setData } = useAppData();
  const [mode, setMode] = useState<'current' | 'archived'>('current');
  const [selectedId, setSelectedId] = useState<string | null>(data.students[0]?.id ?? null);

  const list = [...(mode === 'current' ? data.students : data.archivedStudents)].sort(sortByCreatedDesc);
  const selected = list.find((s) => s.id === selectedId) ?? null;

  const handleSave = (student: IStudent) => {
    setData((prev) => ({
      ...prev,
      students: prev.students.map((s) => (s.id === student.id ? student : s)),
    }));
  };

  // 当前学员：删除 = 移入历史学员
  const handleArchive = (id: string) => {
    const target = data.students.find((s) => s.id === id);
    if (!target) return;
    setData((prev) => ({
      ...prev,
      students: prev.students.filter((s) => s.id !== id),
      archivedStudents: [...prev.archivedStudents, target],
      courses: prev.courses.filter((c) => c.studentId !== id),
      recharges: prev.recharges.filter((r) => r.studentId !== id),
      scores: Object.fromEntries(Object.entries(prev.scores).filter(([k]) => k !== id)),
    }));
    setSelectedId((prevId) => (prevId === id ? list[0]?.id ?? null : prevId));
    toast.success(`学员「${target.name}」已移入历史学员`);
  };

  // 历史学员：删除 = 彻底删除（同步删除服务器数据，防止刷新后恢复）
  const handleDeleteForever = async (id: string) => {
    const target = data.archivedStudents.find((s) => s.id === id);
    if (!target) return;
    await api('/api/desktop/student-delete', { method: 'POST', body: { fid: id } }).catch(() => undefined);
    setData((prev) => ({
      ...prev,
      archivedStudents: prev.archivedStudents.filter((s) => s.id !== id),
    }));
    setSelectedId((prevId) => (prevId === id ? data.archivedStudents[0]?.id ?? null : prevId));
    toast.success(`学员「${target.name}」已彻底删除`);
  };

  // 历史学员：恢复回当前学员
  const handleRestore = (id: string) => {
    const target = data.archivedStudents.find((s) => s.id === id);
    if (!target) return;
    setData((prev) => ({
      ...prev,
      students: [...prev.students, target],
      archivedStudents: prev.archivedStudents.filter((s) => s.id !== id),
    }));
    setMode('current');
    setSelectedId(target.id);
    toast.success(`学员「${target.name}」已恢复`);
  };

  const handleAdd = () => {
    const name = `新学员${data.students.length + 1}`;
    const student = emptyStudent(name, data.students.length);
    setData((prev) => ({ ...prev, students: [...prev.students, student] }));
    setSelectedId(student.id);
    toast.success('已添加新学员，请完善信息');
  };

  const switchMode = (m: 'current' | 'archived') => {
    setMode(m);
    const nextList = [...(m === 'current' ? data.students : data.archivedStudents)].sort(sortByCreatedDesc);
    setSelectedId(nextList[0]?.id ?? null);
  };

  return (
    <div className="mx-auto flex h-full max-w-[1500px] items-stretch gap-4">
      <StudentListSection
        students={list}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onAdd={handleAdd}
        onArchive={handleArchive}
        onDeleteForever={handleDeleteForever}
        onRestore={handleRestore}
        mode={mode}
        onSwitchMode={switchMode}
      />
      <div className="flex min-w-0 max-h-[calc(100vh-96px)] flex-1 flex-col gap-4">
        <StudentInfoSection
          key={selected?.id ?? 'none'}
          student={selected}
          stats={calcStudentStats(selected, data)}
          readonly={mode === 'archived'}
          onSave={handleSave}
          onAdd={handleAdd}
          onDeleteForever={handleDeleteForever}
          onRestore={handleRestore}
        />
        <RecordsSection student={selected} />
      </div>
    </div>
  );
}
