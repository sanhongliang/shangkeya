// 学员头像底色：稳定哈希选色，保证同一学员颜色固定。
// 学校关联给老师的学员（校长端创建）可能没有 boardColor，这里按学员 id 稳定取色；
// 色池 12 色高区分度，相邻学员颜色基本不重复。
export const STUDENT_BOARD_COLORS = [
  '#1677ff', '#52c41a', '#fa8c16', '#722ed1', '#13c2c2',
  '#eb2f96', '#f5222d', '#2f54eb', '#a0d911', '#531dab',
  '#08979c', '#d4380d',
];

export function studentBoardColor(key?: string | number | null): string {
  const k = String(key ?? '');
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return STUDENT_BOARD_COLORS[h % STUDENT_BOARD_COLORS.length];
}
