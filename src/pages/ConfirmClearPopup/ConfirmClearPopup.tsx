import { useEffect } from 'react';
import { emit, listen } from '@tauri-apps/api/event';

/**
 * 清空本页确认弹窗（课堂子弹窗，独立窗口）：显示顺序高于黑板窗口。
 * 确认 → 广播 confirm-clear:ok（课堂侧清空黑板并关闭本窗口）；取消 → confirm-clear:cancel。
 */
export default function ConfirmClearPopup() {
  useEffect(() => {
    const us: (() => void)[] = [];
    const regs: Promise<() => void>[] = [];
    regs.push(listen('confirm-clear:ok', () => window.close()));
    regs.push(listen('confirm-clear:cancel', () => window.close()));
    Promise.all(regs)
      .then((fns) => us.push(...fns))
      .catch(() => undefined);
    return () => us.forEach((f) => f());
  }, []);

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        padding: '16px 18px',
        fontFamily: "'Microsoft YaHei', sans-serif",
        fontSize: 13,
        background: '#fafafa',
        color: '#1f2937',
        userSelect: 'none',
      }}
    >
      <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600 }}>清空本页</h3>
      <p style={{ margin: 0, fontSize: 13, color: '#374151', lineHeight: 1.6 }}>
        确定清空本页全部板书吗？
        <br />
        此操作不可撤销。
      </p>
      <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button
          onClick={() => void emit('confirm-clear:cancel')}
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
          onClick={() => void emit('confirm-clear:ok')}
          style={{
            height: 30,
            padding: '0 18px',
            border: 'none',
            borderRadius: 6,
            background: '#2563eb',
            color: '#fff',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          确定清空
        </button>
      </div>
    </div>
  );
}
