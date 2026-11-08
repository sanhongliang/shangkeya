/** 课件文件名去扩展名（用于「上课内容」回退展示） */
const stripExt = (name?: string): string =>
  (name ?? '').trim().replace(/\.(pdf|pptx?|docx?|tiff?|tif|png|jpe?g|bmp)$/i, '');

/** 该课加载过的全部课件名（顿号分隔），没有课件时返回空串 */
export function courseFilesLabel(c?: { files?: Array<{ name?: string }> } | null): string {
  const names = (c?.files ?? []).map((f) => stripExt(f.name)).filter((n) => !!n);
  return names.join('、');
}

/** 课程展示文案（课堂「历史课程记录」、首页课表卡片等窄位置用）：
 *  1) 有课堂总结显示总结内容 2) 否则显示排课填写的课程内容 3) 都没有时显示该课第一个课件名
 */
export function courseLabel(
  c?: {
    content?: string;
    summary?: { content?: string } | null;
    files?: Array<{ name?: string }>;
  } | null,
): string {
  if (!c) return '';
  const summary = (c.summary?.content ?? '').trim();
  if (summary) return summary;
  const content = (c.content ?? '').trim();
  if (content) return content;
  return (courseFilesLabel(c) || '').split('、')[0] ?? '';
}

/** 较宽位置的展示文案（学员管理页「上课内容」列）：
 *  内容为空时把该课加载过的课件名全部列出来（顿号分隔），而不是只给第一个
 */
export function courseLabelLong(
  c?: {
    content?: string;
    summary?: { content?: string } | null;
    files?: Array<{ name?: string }>;
  } | null,
): string {
  if (!c) return '';
  const summary = (c.summary?.content ?? '').trim();
  if (summary) return summary;
  const content = (c.content ?? '').trim();
  if (content) return content;
  return courseFilesLabel(c);
}
