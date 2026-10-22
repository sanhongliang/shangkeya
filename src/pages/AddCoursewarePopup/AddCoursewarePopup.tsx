import { useEffect, useRef, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';

/** 主窗口推送的状态 */
interface AddcwState {
  pickedName?: string;
  converting?: boolean;
  error?: string;
}

/**
 * 添加课件弹窗（课堂窗口子窗口）：显示顺序高于黑板窗口。
 * 仅做 UI 与事件转发，文件选择 / PPT 转换 / 入库逻辑都在课堂主窗口执行。
 */
export default function AddCoursewarePopup() {
  const [st, setSt] = useState<AddcwState>({});
  const [name, setName] = useState('');
  const [confirming, setConfirming] = useState(false);
  // 记录用户是否手动编辑过名称：自动填充默认值不覆盖用户输入
  const nameEditedRef = useRef(false);

  useEffect(() => {
    const us: (() => void)[] = [];
    const regs: Promise<() => void>[] = [];
    regs.push(
      listen<AddcwState>('addcw:state', (e) => {
        const payload = e.payload ?? {};
        setSt(payload);
        // 选择文件后自动填充默认课件名称（文件名去掉扩展名；用户已手动输入则不覆盖）
        if (payload.pickedName && !nameEditedRef.current) {
          setName(payload.pickedName.replace(/\.[^.]+$/, ''));
        }
      }),
    );
    regs.push(listen('addcw:done', () => window.close()));
    Promise.all(regs)
      .then((fns) => us.push(...fns))
      .catch(() => undefined);
    // 通知主窗口：弹窗已就绪，可推送初始状态
    void emit('addcw:ready');
    return () => us.forEach((f) => f());
  }, []);

  // 实时保存窗口位置/大小（移动或缩放时），避免在关闭流程中异步保存阻塞关闭按钮
  useEffect(() => {
    let un: (() => void) | undefined;
    let un2: (() => void) | undefined;
    (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const w = getCurrentWindow();
        const saveRect = async () => {
          try {
            const [pos, size] = await Promise.all([w.outerPosition(), w.outerSize()]);
            localStorage.setItem(
              'win:addcw:rect',
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

  const converting = !!st.converting;

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        padding: '14px 16px',
        fontFamily: "'Microsoft YaHei', sans-serif",
        fontSize: 13,
        background: '#fafafa',
        color: '#1f2937',
        userSelect: 'none',
      }}
    >
      <h3 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 600 }}>添加课件</h3>
      <button
        onClick={() => void emit('addcw:pick')}
        disabled={converting}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          height: 34,
          padding: '0 10px',
          border: '1px solid #d1d5db',
          borderRadius: 6,
          background: '#fff',
          fontSize: 13,
          color: converting ? '#9ca3af' : '#374151',
          cursor: converting ? 'wait' : 'pointer',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ flexShrink: 0, color: '#2563eb' }}>
          {converting ? '⏳' : '📄'}
        </span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {converting ? 'PPT 转换中…' : st.pickedName || '选择本地课件文件（PDF / PPT / 图片 / 视频 / 音频 / HTML）'}
        </span>
      </button>
      {st.error && (
        <p style={{ margin: '6px 0 0', color: '#dc2626', fontSize: 12 }}>{st.error}</p>
      )}
      <label style={{ marginTop: 10, fontSize: 12, color: '#6b7280' }}>课件名称</label>
      <input
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          nameEditedRef.current = true;
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onConfirm();
        }}
        style={{
          marginTop: 4,
          height: 32,
          padding: '0 10px',
          border: '1px solid #d1d5db',
          borderRadius: 6,
          fontSize: 13,
          outline: 'none',
        }}
      />
      <div
        style={{
          marginTop: 'auto',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
        }}
      >
        <button
          onClick={() => void emit('addcw:cancel')}
          disabled={confirming}
          style={{
            height: 30,
            padding: '0 14px',
            border: '1px solid #d1d5db',
            borderRadius: 6,
            background: '#fff',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          取消
        </button>
        <button
          onClick={onConfirm}
          disabled={confirming || converting}
          style={{
            height: 30,
            padding: '0 18px',
            border: 'none',
            borderRadius: 6,
            background: '#2563eb',
            color: '#fff',
            fontSize: 13,
            cursor: confirming || converting ? 'not-allowed' : 'pointer',
            opacity: confirming || converting ? 0.6 : 1,
          }}
        >
          {confirming ? '添加中…' : '添加'}
        </button>
      </div>
    </div>
  );

  function onConfirm() {
    if (confirming) return;
    setConfirming(true);
    void emit('addcw:confirm', { name });
  }
}
