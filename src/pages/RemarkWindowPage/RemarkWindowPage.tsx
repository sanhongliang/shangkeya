import { useEffect, useState, useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emit } from '@tauri-apps/api/event';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { tempDir, join } from '@tauri-apps/api/path';

/**
 * 页面备注窗口（应用内路由页，完整 Tauri API）：
 * 显示 211×489 竖版备注帧（已解密）；窗口无最大化/最小化、客户区固定 211×489（创建窗口时控制）。
 * 数据由课堂窗口写入临时 JSON（shangkeya-remark-<label>.json），翻页后无备注帧时由课堂逻辑关闭。
 */
export default function RemarkWindowPage() {
  const [url, setUrl] = useState('');

  // 键盘左右键翻页课件（备注窗口获得焦点时翻页课堂课件）
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
        const p = await join(dir, `shangkeya-remark-${w.label}.json`);
        const d = JSON.parse(await readTextFile(p));
        if (alive && d && d.imgUrl) setUrl(d.imgUrl);
        // 实时保存窗口位置（移动时），避免在关闭流程中异步保存阻塞关闭按钮
        const savePos = async () => {
          try {
            const pos = await w.outerPosition();
            localStorage.setItem('win:remark:pos', JSON.stringify({ x: pos.x, y: pos.y }));
          } catch {
            /* 保存失败忽略 */
          }
        };
        un = await w.onMoved(() => {
          void savePos();
        });
        un2 = await w.onResized(() => {
          void savePos();
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

  const closeWin = useCallback(() => {
    getCurrentWindow()
      .close()
      .catch(() => undefined);
  }, []);

  // 无标题栏窗口拖动：按住顶部拖拽条（非关闭按钮）可移动窗口
  const dragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    if (e.button !== 0) return;
    getCurrentWindow()
      .startDragging()
      .catch(() => undefined);
  }, []);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: '#fff',
        position: 'relative',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {url ? (
        <img src={url} alt="页面备注" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'fill' }} />
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ccc', fontSize: 12 }}>
          暂无备注
        </div>
      )}
      {/* 顶部拖拽条（无标题栏窗口移动） */}
      <div
        onMouseDown={dragStart}
        title="拖动窗口"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 22,
          background: 'rgba(0,0,0,0.18)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'move',
          userSelect: 'none',
          zIndex: 9,
        }}
      >
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.85)' }}>页面备注</span>
      </div>
      <button
        type="button"
        onClick={closeWin}
        title="关闭"
        style={{
          position: 'fixed',
          top: 2,
          right: 2,
          zIndex: 10,
          width: 18,
          height: 18,
          border: 'none',
          borderRadius: 3,
          background: 'rgba(0,0,0,0.35)',
          fontSize: 11,
          lineHeight: 1,
          color: '#fff',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}
