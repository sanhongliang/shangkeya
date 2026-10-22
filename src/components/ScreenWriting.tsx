import { useEffect, useRef } from 'react';

/**
 * 屏幕书写层：覆盖在 HTML/视频课件之上，鼠标绘制黑色线条（临时批注）。
 * 显示期间拦截一切鼠标事件（页面无法操作）；隐藏/卸载后批注自动清除。
 *
 * 绘制说明：
 * - 画布局部坐标 = 事件 clientX/clientY - canvas 左上角（课堂 inline 模式黑板区不在视口左上角，必须换算）；
 * - pointerdown 绑在 canvas，move/up 绑在 window：即使指针移出 canvas 也能连续画线（模拟 pointer capture）；
 * - 不支持 PointerEvent 的 WebView 自动降级为 mouse 事件；
 * - 事件均 preventDefault，阻止 iframe/页面滚动与文本选择。
 */
export default function ScreenWriting({ visible }: { visible: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!visible) return;
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.max(1, Math.round(cv.clientWidth * dpr));
      cv.height = Math.max(1, Math.round(cv.clientHeight * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(cv);

    const pos = (e: PointerEvent | MouseEvent) => {
      const rect = cv.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const down = (e: PointerEvent | MouseEvent) => {
      e.preventDefault();
      drawingRef.current = true;
      lastRef.current = pos(e);
      if ('pointerId' in e) {
        try {
          cv.setPointerCapture((e as PointerEvent).pointerId);
        } catch {
          /* 忽略 */
        }
      }
    };
    const move = (e: PointerEvent | MouseEvent) => {
      if (!drawingRef.current || !lastRef.current) return;
      e.preventDefault();
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(lastRef.current.x, lastRef.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      lastRef.current = p;
    };
    const up = (e: PointerEvent | MouseEvent) => {
      if (e) e.preventDefault();
      drawingRef.current = false;
      lastRef.current = null;
    };

    const hasPointer = typeof window !== 'undefined' && 'PointerEvent' in window;
    if (hasPointer) {
      cv.addEventListener('pointerdown', down);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    } else {
      cv.addEventListener('mousedown', down);
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    }
    return () => {
      ro.disconnect();
      if (hasPointer) {
        cv.removeEventListener('pointerdown', down);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      } else {
        cv.removeEventListener('mousedown', down);
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      }
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <canvas
      ref={ref}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 999,
        cursor: 'crosshair',
        touchAction: 'none',
        pointerEvents: 'auto',
      }}
    />
  );
}
