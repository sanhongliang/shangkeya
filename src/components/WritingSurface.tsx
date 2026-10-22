import { useEffect, useRef, useState } from 'react';

/** 画笔状态（与黑板书写工具栏一致） */
export type PenLineStyle = 'solid' | 'dashed' | 'dotted';

export interface PenState {
  color: string;
  size: number;
  lineStyle?: PenLineStyle;
}

/** 书写批注形状类型（与黑板工具栏一致；select/image/coords/boxDelete/penetrate 不适合作临时批注） */
export type WritingTool =
  | 'pencil'
  | 'eraser'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'circleDiameter'
  | 'circleRadius'
  | 'arc'
  | 'text';

type Op =
  | { kind: 'stroke'; eraser: boolean; pts: { x: number; y: number }[]; color: string; size: number; lineStyle?: PenLineStyle }
  | { kind: 'shape'; type: WritingTool; x0: number; y0: number; x1: number; y1: number; color: string; size: number; lineStyle?: PenLineStyle }
  | { kind: 'text'; x: number; y: number; text: string; color: string; size: number; fontPx: number };

/** 把任意工具归一到可书写工具（select/image/coords/boxDelete/penetrate → pencil） */
function normalizeTool(t: string | undefined): WritingTool {
  if (
    t === 'pencil' || t === 'eraser' || t === 'line' || t === 'arrow' || t === 'rect' ||
    t === 'ellipse' || t === 'circleDiameter' || t === 'circleRadius' || t === 'arc' || t === 'text'
  ) {
    return t as WritingTool;
  }
  return 'pencil';
}

/**
 * 书写表面（WritingSurface）：课件（HTML/视频）上的完整批注书写层。
 * - 全尺寸透明拦截层（显式 top/left/right/bottom + zIndex 5000），覆盖在课件之上，拦截一切鼠标事件；
 * - 画笔样式与黑板工具栏一致（pen：颜色/粗细/线型）；工具跟随黑板当前工具（tool）；
 *   支持：画笔、橡皮、直线、箭头、矩形、椭圆、直径圆、半径圆、弧线、文字；
 * - 双层 canvas：底层画视频冻结帧（仅视频场景），上层为批注层（可被橡皮擦除）；
 * - 退出书写（active=false）自动卸载清空，恢复视频播放/页面操作。
 */
export default function WritingSurface({
  active,
  videoRef,
  pen,
  tool,
}: {
  active: boolean;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  pen?: PenState;
  tool?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLCanvasElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const opsRef = useRef<Op[]>([]);
  const draftRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const strokeRef = useRef<{ x: number; y: number }[]>([]);
  const curTool = normalizeTool(tool);
  const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!active) return;
    const wrap = wrapRef.current;
    const frame = frameRef.current;
    const ink = inkRef.current;
    if (!wrap || !ink) return;
    const ctx = ink.getContext('2d');
    if (!ctx) return;

    const p = pen ?? { color: '#000', size: 3, lineStyle: 'solid' };
    const t = curTool;

    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, ink.clientWidth);
      const h = Math.max(1, ink.clientHeight);
      ink.width = Math.round(w * dpr);
      ink.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (frame) {
        frame.width = Math.round(w * dpr);
        frame.height = Math.round(h * dpr);
        const fctx = frame.getContext('2d');
        if (fctx) {
          fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          fctx.clearRect(0, 0, w, h);
          // 视频场景：冻结当前帧到底层画布（作为书写底图）
          if (videoRef?.current) {
            try {
              fctx.drawImage(videoRef.current, 0, 0, w, h);
            } catch {
              /* 忽略 */
            }
          }
        }
      }
      redraw();
    };

    const redraw = () => {
      ctx.clearRect(0, 0, ctx.canvas.width / (window.devicePixelRatio || 1), ctx.canvas.height / (window.devicePixelRatio || 1));
      for (const op of opsRef.current) {
        if (op.kind === 'stroke') {
          ctx.globalCompositeOperation = op.eraser ? 'destination-out' : 'source-over';
          ctx.strokeStyle = op.color;
          ctx.lineWidth = op.eraser ? Math.max(op.size * 2, 8) : op.size;
          applyDash(ctx, op.lineStyle);
          ctx.beginPath();
          op.pts.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
          ctx.stroke();
        } else if (op.kind === 'shape') {
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = op.color;
          ctx.lineWidth = op.size;
          applyDash(ctx, op.lineStyle);
          strokeShape(ctx, op.type, op.x0, op.y0, op.x1, op.y1);
        } else {
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = op.color;
          ctx.font = `${op.fontPx}px "Microsoft YaHei", sans-serif`;
          ctx.textBaseline = 'top';
          op.text.split('\n').forEach((ln, i) => ctx.fillText(ln, op.x, op.y + i * (op.fontPx + 4)));
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      // 当前预览形状
      const d = draftRef.current;
      if (d) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        applyDash(ctx, p.lineStyle);
        strokeShape(ctx, t, d.x0, d.y0, d.x1, d.y1);
      }
    };

    const applyDash = (c: CanvasRenderingContext2D, ls?: PenLineStyle) => {
      if (ls === 'dashed') c.setLineDash([8, 6]);
      else if (ls === 'dotted') c.setLineDash([2, 5]);
      else c.setLineDash([]);
    };

    const pos = (e: PointerEvent | MouseEvent) => {
      const rect = ink.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const down = (e: PointerEvent | MouseEvent) => {
      if (t === 'text') {
        setTextAt(pos(e));
        return;
      }
      e.preventDefault();
      drawingRef.current = true;
      lastRef.current = pos(e);
      if (t === 'pencil' || t === 'eraser') {
        strokeRef.current = [pos(e)];
      } else {
        draftRef.current = { x0: pos(e).x, y0: pos(e).y, x1: pos(e).x, y1: pos(e).y };
      }
    };
    const move = (e: PointerEvent | MouseEvent) => {
      if (!drawingRef.current || !lastRef.current) return;
      e.preventDefault();
      const p2 = pos(e);
      if (t === 'pencil' || t === 'eraser') {
        strokeRef.current.push(p2);
        ctx.globalCompositeOperation = t === 'eraser' ? 'destination-out' : 'source-over';
        ctx.strokeStyle = t === 'eraser' ? '#000' : p.color;
        ctx.lineWidth = t === 'eraser' ? Math.max(p.size * 2, 8) : p.size;
        applyDash(ctx, p.lineStyle);
        ctx.beginPath();
        ctx.moveTo(lastRef.current.x, lastRef.current.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      } else if (draftRef.current) {
        draftRef.current.x1 = p2.x;
        draftRef.current.y1 = p2.y;
        redraw();
      }
      lastRef.current = p2;
    };
    const up = (e: PointerEvent | MouseEvent) => {
      if (t === 'text') return;
      if (drawingRef.current) e.preventDefault();
      if (t === 'pencil' || t === 'eraser') {
        if (strokeRef.current.length > 0) {
          opsRef.current.push({
            kind: 'stroke',
            eraser: t === 'eraser',
            pts: strokeRef.current,
            color: p.color,
            size: p.size,
            lineStyle: p.lineStyle,
          });
        }
      } else if (draftRef.current) {
        const d = draftRef.current;
        if (Math.abs(d.x1 - d.x0) > 2 || Math.abs(d.y1 - d.y0) > 2) {
          opsRef.current.push({ kind: 'shape', type: t, x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1, color: p.color, size: p.size, lineStyle: p.lineStyle });
        }
      }
      draftRef.current = null;
      drawingRef.current = false;
      lastRef.current = null;
      redraw();
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(ink);

    const hasPointer = typeof window !== 'undefined' && 'PointerEvent' in window;
    if (hasPointer) {
      wrap.addEventListener('pointerdown', down);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    } else {
      wrap.addEventListener('mousedown', down);
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    }
    return () => {
      ro.disconnect();
      if (hasPointer) {
        wrap.removeEventListener('pointerdown', down);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      } else {
        wrap.removeEventListener('mousedown', down);
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, videoRef, pen?.color, pen?.size, pen?.lineStyle, curTool]);

  // 退出书写时清空批注
  useEffect(() => {
    if (!active) {
      opsRef.current = [];
      draftRef.current = null;
    }
  }, [active]);

  if (!active) return null;

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 5000,
        cursor: curTool === 'text' ? 'text' : 'crosshair',
        touchAction: 'none',
        background: 'transparent',
      }}
    >
      {/* 底层：视频冻结帧（仅视频场景绘制） */}
      <canvas
        ref={frameRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      />
      {/* 上层：批注层 */}
      <canvas
        ref={inkRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          display: 'block',
          background: 'transparent',
        }}
      />
      {/* 文字输入框（text 工具） */}
      {textAt && (
        <textarea
          autoFocus
          placeholder="输入文字，回车确认"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              const val = e.currentTarget.value;
              const p = pen ?? { color: '#000', size: 3 };
              const fontPx = Math.max(14, Math.round(p.size * 8));
              if (val.trim()) {
                opsRef.current.push({ kind: 'text', x: textAt.x, y: textAt.y, text: val, color: p.color, size: p.size, fontPx });
                // 强制重绘：直接操作 canvas
                const ink = inkRef.current;
                if (ink) {
                  const ctx = ink.getContext('2d');
                  if (ctx) {
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.fillStyle = p.color;
                    ctx.font = `${fontPx}px "Microsoft YaHei", sans-serif`;
                    ctx.textBaseline = 'top';
                    val.split('\n').forEach((ln, i) => ctx.fillText(ln, textAt.x, textAt.y + i * (fontPx + 4)));
                  }
                }
              }
              setTextAt(null);
            }
          }}
          onBlur={() => setTextAt(null)}
          style={{
            position: 'absolute',
            left: textAt.x,
            top: textAt.y,
            zIndex: 6000,
            minWidth: 160,
            minHeight: 28,
            padding: '4px 6px',
            border: '1px dashed #666',
            borderRadius: 4,
            background: 'rgba(255,255,255,.92)',
            fontSize: Math.max(14, Math.round((pen?.size ?? 3) * 8)),
            color: pen?.color ?? '#000',
            fontFamily: '"Microsoft YaHei", sans-serif',
            outline: 'none',
            resize: 'both',
          }}
        />
      )}
    </div>
  );
}

/** 按工具绘制形状（坐标均为 CSS 像素，画布已做 dpr 变换） */
function strokeShape(
  ctx: CanvasRenderingContext2D,
  type: WritingTool,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  const w = x1 - x0;
  const h = y1 - y0;
  switch (type) {
    case 'line':
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      break;
    case 'arrow': {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const len = 12 + Math.min(8, Math.hypot(w, h) * 0.15);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - len * Math.cos(ang - 0.42), y1 - len * Math.sin(ang - 0.42));
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - len * Math.cos(ang + 0.42), y1 - len * Math.sin(ang + 0.42));
      ctx.stroke();
      break;
    }
    case 'rect':
      ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(w), Math.abs(h));
      break;
    case 'ellipse': {
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(1, Math.abs(w) / 2), Math.max(1, Math.abs(h) / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'circleDiameter': {
      const r = Math.hypot(w, h) / 2;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - r, cy);
      ctx.lineTo(cx + r, cy);
      ctx.stroke();
      break;
    }
    case 'circleRadius': {
      const r = Math.hypot(w, h);
      const cx = x0;
      const cy = y0;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'arc': {
      // 两点画半圆弧（起点→终点，圆心在中点）
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const r = Math.hypot(w, h) / 2;
      const a = Math.atan2(y1 - y0, x1 - x0);
      ctx.beginPath();
      ctx.arc(cx, cy, r, a, a + Math.PI);
      ctx.stroke();
      break;
    }
    default:
      break;
  }
}
