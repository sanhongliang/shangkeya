// 学员头像底色：与 seed.ts 默认调色板一致的稳定哈希选色。
// 学校关联给老师的学员（校长端创建）可能没有 boardColor，这里按学员 id 稳定取色，保证同一学员颜色固定。
export const STUDENT_BOARD_COLORS = ['#1677ff', '#52c41a', '#fa8c16', '#722ed1', '#13c2c2'];

export function studentBoardColor(key?: string | number | null): string {
  const k = String(key ?? '');
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return STUDENT_BOARD_COLORS[h % STUDENT_BOARD_COLORS.length];
}
