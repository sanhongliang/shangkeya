import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import AppProvider from '@/components/AppProvider';
import RequireAuth from '@/components/RequireAuth';
import { Toaster } from '@/components/ui/sonner';
import LoginPage from '@/pages/LoginPage/LoginPage';
import HomePage from '@/pages/HomePage/HomePage';
import StudentsPage from '@/pages/StudentsPage/StudentsPage';
import SchedulePage from '@/pages/SchedulePage/SchedulePage';
import CoursewarePage from '@/pages/CoursewarePage/CoursewarePage';
import SalaryPage from '@/pages/SalaryPage/SalaryPage';
import SettingsPage from '@/pages/SettingsPage/SettingsPage';
import ClassroomPage from '@/pages/ClassroomPage/ClassroomPage';
import BlackboardCanvasPage from '@/pages/BlackboardCanvasPage/BlackboardCanvasPage';
import AddCoursewarePopup from '@/pages/AddCoursewarePopup/AddCoursewarePopup';
import ConfirmClearPopup from '@/pages/ConfirmClearPopup/ConfirmClearPopup';
import AnswerWindowPage from '@/pages/AnswerWindowPage/AnswerWindowPage';
import RemarkWindowPage from '@/pages/RemarkWindowPage/RemarkWindowPage';
import ConverterGuidePopup from '@/pages/ConverterGuidePopup/ConverterGuidePopup';
import NotFoundPage from '@/pages/NotFoundPage/NotFoundPage';

/** 是否运行在桌面客户端（Tauri）；网页版无此标记 */
const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
/** 给根节点打网页版标记，供全局样式在手机窄屏时锁定 1280×720 画布 */
if (typeof document !== 'undefined' && !IS_TAURI) {
  document.documentElement.classList.add('web-mode');
}

/** 网页版访问课件管理时的提示（网页版无法读取本地课件目录，该页仅在桌面端提供） */
function WebCoursewareNotice() {
  return (
    <div className="mx-auto mt-20 max-w-md rounded-lg border bg-card p-8 text-center shadow-sm">
      <div className="text-base font-semibold">课件管理仅支持桌面端</div>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        网页版无法读取本地课件目录，因此未提供课件管理页面。
        请下载「上课鸭」桌面客户端，在那里添加课件目录与管理课件。
      </p>
    </div>
  );
}

/** 判断窗口矩形（屏幕坐标）是否与当前任一显示器有交集；用于恢复位置前校验（避免恢复到屏幕外导致窗口不可见） */
async function isRectOnAnyMonitor(
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<boolean> {
  try {
    const { availableMonitors } = await import('@tauri-apps/api/window');
    const monitors = await availableMonitors();
    for (const m of monitors) {
      const px = m.position.x;
      const py = m.position.y;
      const pw = m.size.width;
      const ph = m.size.height;
      // 两矩形相交判定（含边界相接：至少 1px 重叠才视为在屏内）
      const overlapW = Math.min(x + w, px + pw) - Math.max(x, px);
      const overlapH = Math.min(y + h, py + ph) - Math.max(y, py);
      if (overlapW > 0 && overlapH > 0) return true;
    }
    return false;
  } catch {
    // 无法获取显示器信息时按「在屏内」处理（不阻断位置恢复）
    return true;
  }
}

export default function App() {
  // 主窗口（课堂/登录窗口）关闭时保存大小位置，下次启动恢复到上次位置与大小
  useEffect(() => {
    const isTauri = '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
    if (!isTauri) return;
    let un: (() => void) | undefined;
    let un2: (() => void) | undefined;
    (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const { PhysicalPosition, PhysicalSize } = await import('@tauri-apps/api/dpi');
        const w = getCurrentWindow();
        // 仅课堂主窗口/课堂独立窗口保存恢复（子窗口各自处理）
        if (
          w.label === 'blackboard-canvas' ||
          w.label.startsWith('answer-') ||
          w.label.startsWith('remark-') ||
          w.label.startsWith('addcw-') ||
          w.label.startsWith('confirm-')
        ) {
          return;
        }
        // 窗口身份 → 独立保存 key：主窗口（main）与课堂独立窗口（classroom-*）互不覆盖
        const rectKey = w.label.startsWith('classroom-') ? 'win:classroom:rect' : 'win:main:rect';
        // 恢复上次保存的位置/大小
        try {
          const saved = localStorage.getItem(rectKey);
          if (saved) {
            const r = JSON.parse(saved) as { x?: number; y?: number; w?: number; h?: number };
            if (typeof r.w === 'number' && typeof r.h === 'number') {
              await w.setSize(new PhysicalSize(r.w, r.h)).catch(() => undefined);
            }
            if (typeof r.x === 'number' && typeof r.y === 'number') {
              // 屏幕边界校验：位置须与当前任一显示器有交集，否则视为上次在屏幕外（换显示器/分辨率变化），不恢复位置（保持窗口默认居中）
              const rectInAnyMonitor = await isRectOnAnyMonitor(r.x, r.y, r.w ?? 100, r.h ?? 100);
              if (rectInAnyMonitor) {
                await w.setPosition(new PhysicalPosition(r.x, r.y)).catch(() => undefined);
              }
            }
          }
        } catch {
          /* 无保存记录 */
        }
        // 实时保存位置/大小（移动或缩放时），关闭流程无需再保存（避免阻塞关闭按钮）
        const saveRect = async () => {
          try {
            const [pos, size] = await Promise.all([w.outerPosition(), w.outerSize()]);
            localStorage.setItem(
              rectKey,
              JSON.stringify({ x: pos.x, y: pos.y, w: size.width, h: size.height }),
            );
          } catch {
            /* 保存失败忽略 */
          }
        };
        un = await w.onMoved(() => {
          void saveRect();
        });
        un2 = await w.onResized(() => {
          void saveRect();
        });
      } catch {
        /* 非 Tauri 环境 */
      }
    })();
    return () => {
      void un?.();
      void un2?.();
    };
  }, []);

  return (
    <AppProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route path="home" element={<HomePage />} />
            <Route path="students" element={<StudentsPage />} />
            <Route path="schedule" element={<SchedulePage />} />
            <Route
              path="courseware"
              element={IS_TAURI ? <CoursewarePage /> : <WebCoursewareNotice />}
            />
            <Route path="salary" element={<SalaryPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route
          path="/classroom"
          element={
            <RequireAuth>
              <ClassroomPage />
            </RequireAuth>
          }
        />
        <Route path="/blackboard-canvas" element={<BlackboardCanvasPage />} />
        <Route path="/add-courseware" element={<AddCoursewarePopup />} />
        <Route path="/confirm-clear" element={<ConfirmClearPopup />} />
        <Route path="/answer-window" element={<AnswerWindowPage />} />
        <Route path="/remark-window" element={<RemarkWindowPage />} />
        <Route path="/converter-guide" element={<ConverterGuidePopup />} />
        <Route index element={<Navigate to="/home" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <Toaster />
    </AppProvider>
  );
}
