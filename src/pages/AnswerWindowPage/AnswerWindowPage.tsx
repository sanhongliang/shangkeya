import { useCallback, useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emit } from '@tauri-apps/api/event';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { tempDir, join } from '@tauri-apps/api/path';

interface AnswerData {
  answerUrl?: string;
  nextUrl?: string;
  hasAnswer?: boolean;
  enableNext?: boolean;
  frameIndex?: number;
}

/**
 * 答案窗口页（应用内路由，完整 Tauri API）：
 * 分组页「答案 / 下页预览」——问题页优先显示答案；非问题页（开启下页预览）显示下页预览。
 * 无标题栏：右上角关闭按钮 + 顶部 tab 条空白区域拖动。
 * 数据从课堂窗口写入的临时 JSON 读取（shangkeya-answer-<label>.json）。
 */
export default function AnswerWindowPage() {
  const [data, setData] = useState<AnswerData | null>(null);
  const [tab, setTab] = useState<'answer' | 'next'>('answer');

  // 键盘左右键翻页课件（答案窗口获得焦点时翻页课堂课件）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      void emit('cw:pageNav', { dir: e.key === 'ArrowLeft' ? -1 : 1 });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    let alive = true;
    let un: (() => void) | undefined;
    let un2: (() => void) | undefined;
    (async () => {
      try {
        const w = getCurrentWindow();
        const dir = await tempDir();
        const p = await join(dir, `shangkeya-answer-${w.label}.json`);
        const txt = await readTextFile(p);
        const d = JSON.parse(txt) as AnswerData;
        if (alive) {
          setData(d);
          // 初始激活默认分组：答案优先，否则下页预览
          setTab(d.hasAnswer && d.answerUrl ? 'answer' : 'next');
        }
        // 实时保存位置/大小（移动或缩放时），避免在关闭流程中异步保存阻塞关闭按钮
        const saveRect = async () => {
          try {
            const [pos, size] = await Promise.all([w.outerPosition(), w.outerSize()]);
            localStorage.setItem(
              'win:answer:rect',
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
        /* 读取失败：保持空态 */
      }
    })();
    return () => {
      alive = false;
      void un?.();
      void un2?.();
    };
  }, []);

  const hasAnswer = !!(data?.hasAnswer && data.answerUrl);
  const hasNext = !!(data?.enableNext && data.nextUrl);

  const closeWin = useCallback(() => {
    getCurrentWindow()
      .close()
      .catch(() => undefined);
  }, []);

  const dragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.tab')) return;
    if (e.button !== 0) return;
    getCurrentWindow()
      .startDragging()
      .catch(() => undefined);
  }, []);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#f5f5f5', overflow: 'hidden', fontFamily: 'system-ui, sans-serif' }}>
      <div
        onMouseDown={dragStart}
        style={{
          display: 'flex',
          alignItems: 'center',
          background: '#e8e8e8',
          padding: '4px 36px 0 4px',
          borderBottom: '1px solid #ccc',
          userSelect: 'none',
          flexShrink: 0,
          height: 33,
          boxSizing: 'border-box',
        }}
      >
        {hasAnswer && (
          <button
            type="button"
            className="tab"
            onClick={() => setTab('answer')}
            style={{
              padding: '6px 16px',
              cursor: 'pointer',
              border: 'none',
              background: 'transparent',
              fontSize: 13,
              color: tab === 'answer' ? '#111' : '#555',
              borderBottom: tab === 'answer' ? '2px solid #2563eb' : '2px solid transparent',
              fontWeight: tab === 'answer' ? 600 : 400,
            }}
          >
            答案
          </button>
        )}
        {hasNext && (
          <button
            type="button"
            className="tab"
            onClick={() => setTab('next')}
            style={{
              padding: '6px 16px',
              cursor: 'pointer',
              border: 'none',
              background: 'transparent',
              fontSize: 13,
              color: tab === 'next' ? '#111' : '#555',
              borderBottom: tab === 'next' ? '2px solid #2563eb' : '2px solid transparent',
              fontWeight: tab === 'next' ? 600 : 400,
            }}
          >
            下页预览
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={closeWin}
        title="关闭"
        style={{
          position: 'fixed',
          top: 5,
          right: 6,
          zIndex: 10,
          width: 26,
          height: 26,
          border: 'none',
          borderRadius: 4,
          background: '#e8e8e8',
          fontSize: 15,
          lineHeight: 1,
          color: '#666',
          cursor: 'pointer',
        }}
        onMouseOver={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = '#e5484d';
          (e.currentTarget as HTMLButtonElement).style.color = '#fff';
        }}
        onMouseOut={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = '#e8e8e8';
          (e.currentTarget as HTMLButtonElement).style.color = '#666';
        }}
      >
        ×
      </button>
      {tab === 'answer' && hasAnswer && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', background: '#fff' }}>
          <img src={data?.answerUrl} alt="答案" style={{ display: 'block', width: '100%', height: 'auto' }} />
        </div>
      )}
      {tab === 'next' && hasNext && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', background: '#fff' }}>
          <img src={data?.nextUrl} alt="下页预览" style={{ display: 'block', width: '100%', height: 'auto' }} />
        </div>
      )}
      {!hasAnswer && !hasNext && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 13 }}>
          暂无内容
        </div>
      )}
    </div>
  );
}
