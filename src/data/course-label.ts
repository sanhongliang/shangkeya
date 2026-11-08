/** 课程展示文案（课堂「历史课程记录」右侧、学员列表课程内容列、首页课表卡片共用同一口径）：
 *  1) 有课堂总结就显示总结内容（课堂里真正写下的内容）
 *  2) 没有总结就用排课时填写的课程内容
 *  3) 两者都没有，回退到该课加载的第一个课件名（去掉扩展名），避免整列空白
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
  const first = (c.files?.[0]?.name ?? '').trim();
  if (!first) return '';
  return first.replace(/\.(pdf|pptx?|docx?|tiff?|tif|png|jpe?g|bmp)$/i, '');
}
