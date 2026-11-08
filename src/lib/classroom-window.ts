// 课堂页「单独窗口」打开：Tauri 模式创建独立 WebviewWindow，浏览器模式 window.open 新窗口
// 用法：openClassroomWindow('?courseId=xxx') —— 传完整 query 字符串（含问号）
// 注：应用使用 HashRouter，独立窗口 URL 必须带 # 前缀（pathname 形式会落到默认路由）
// 同时只允许一个课堂窗口：已开同一节课 → 只把它切到前台；已开另一节课 → 关掉旧窗口再开，
// 保证不会出现多个课堂窗口叠在一起（板书/页码存本机，重开会自动读回）。
const CLASSROOM_LABEL = 'classroom-main';
let lastCourseId: string | null = null;

function courseIdOf(query: string): string {
  const qs = query.startsWith('?') ? query.slice(1) : query;
  try {
    return new URLSearchParams(qs).get('courseId') ?? '';
  } catch {
    return '';
  }
}

export function openClassroomWindow(query: string): void {
  const q = query.startsWith('?') ? query : `?${query}`;
  // 标记独立窗口，课堂页据此把返回按钮变为关闭窗口
  const hashUrl = `#/classroom${q}${q === '?' ? 'win=1' : '&win=1'}`;
  const courseId = courseIdOf(q);

  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (isTauri) {
    void import('@tauri-apps/api/webviewWindow')
      .then(async ({ WebviewWindow }) => {
        const create = () =>
          new WebviewWindow(CLASSROOM_LABEL, {
            url: `index.html${hashUrl}`,
            title: '上课鸭-课堂',
            width: 1280,
            height: 800,
            minWidth: 960,
            minHeight: 640,
            resizable: true,
            center: true,
          });
        // 已有课堂窗口：同一节课只切前台；不同课程则关掉旧窗口再重开
        try {
          const existing = await WebviewWindow.getByLabel(CLASSROOM_LABEL);
          if (existing) {
            if (lastCourseId === courseId) {
              await existing.setFocus();
              return;
            }
            await existing.close();
            // 等旧窗口销毁、label 释放，否则新建会报 label 已存在
            await new Promise((r) => setTimeout(r, 400));
          }
        } catch {
          /* 查询/关闭失败按“无旧窗口”处理 */
        }
        lastCourseId = courseId;
        const win = create();
        win.once('tauri://error', () => {
          // label 仍被占用的兜底：稍后再建一次
          setTimeout(() => {
            try {
              create();
            } catch {
              /* 忽略 */
            }
          }, 800);
        });
      })
      .catch((err) => {
        console.error('加载 Tauri webview API 失败，回退 window.open', err);
        window.open(hashUrl, 'shangkeya-classroom', 'width=1280,height=800');
      });
  } else {
    // 浏览器模式：固定 target 名，重复点开复用同一个标签页（不再叠加多个课堂页）
    window.open(hashUrl, 'shangkeya-classroom', 'width=1280,height=800');
  }
}

// 判断当前是否课堂独立窗口（URL 带 win=1；HashRouter 下查询参数在 hash 内）
export function isClassroomWindow(): boolean {
  if (typeof window === 'undefined') return false;
  const src = window.location.hash || window.location.search;
  const qs = src.includes('?') ? src.slice(src.indexOf('?')) : '';
  return new URLSearchParams(qs).get('win') === '1';
}
