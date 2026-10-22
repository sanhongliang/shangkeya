// 课堂页「单独窗口」打开：Tauri 模式创建独立 WebviewWindow，浏览器模式 window.open 新窗口
// 用法：openClassroomWindow('?courseId=xxx') —— 传完整 query 字符串（含问号）
// 注：应用使用 HashRouter，独立窗口 URL 必须带 # 前缀（pathname 形式会落到默认路由）
export function openClassroomWindow(query: string): void {
  const q = query.startsWith('?') ? query : `?${query}`;
  // 标记独立窗口，课堂页据此把返回按钮变为关闭窗口
  const hashUrl = `#/classroom${q}${q === '?' ? 'win=1' : '&win=1'}`;

  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (isTauri) {
    // 动态引入 Tauri webviewWindow API（仅桌面端存在）
    void import('@tauri-apps/api/webviewWindow')
      .then(({ WebviewWindow }) => {
        const win = new WebviewWindow(`classroom-${Date.now()}`, {
          url: `index.html${hashUrl}`,
          title: '上课鸭-课堂',
          width: 1280,
          height: 800,
          minWidth: 960,
          minHeight: 640,
          resizable: true,
          center: true,
        });
        win.once('tauri://error', (e) => {
          console.error('课堂独立窗口创建失败', e);
        });
      })
      .catch((err) => {
        console.error('加载 Tauri webview API 失败，回退 window.open', err);
        window.open(hashUrl, '_blank', 'width=1280,height=800');
      });
  } else {
    window.open(hashUrl, '_blank', 'width=1280,height=800');
  }
}

// 判断当前是否课堂独立窗口（URL 带 win=1；HashRouter 下查询参数在 hash 内）
export function isClassroomWindow(): boolean {
  if (typeof window === 'undefined') return false;
  const src = window.location.hash || window.location.search;
  const qs = src.includes('?') ? src.slice(src.indexOf('?')) : '';
  return new URLSearchParams(qs).get('win') === '1';
}
