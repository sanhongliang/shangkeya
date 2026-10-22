// EXPORTS: BoardCanvas, IShape
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ISettings } from '@/data/types';
import { cn } from '@/lib/utils';
import type { LineStyle, ToolId } from './tools';

export interface IShape {
  type: ToolId;
  color: string;
  size: number;
  lineStyle?: LineStyle;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  points: { x: number; y: number }[];
  text?: string;
  /** 三点弧：圆心(x0,y0) → 起点(x1,y1) → 终点 points[0] */
  arcMode?: 'three';
  /** 三点弧有向扫过角（弧度，可 >π 或 <-π，支持大于 180° 的弧；缺省时按终点投影角规约短弧） */
  arcSweep?: number;
  /** 三点弧动态预览辅助线（圆心到当前端点的虚线） */
  auxLine?: boolean;
  /** 文字工具：字体与字号（字号为相对画布高的比例） */
  fontFamily?: string;
  fontSize?: number;
  /** 图片工具：objectURL 与原始像素尺寸 */
  imageUrl?: string;
  imgW?: number;
  imgH?: number;
}

export interface BoardCanvasProps {
  boardStyle: ISettings['boardStyle'];
  /** 自定义背景板图片（dataURL，boardStyle=custom 且无课件时作为黑板背景） */
  customBoardImage?: string;
  tool: ToolId;
  color: string;
  penSize: number;
  lineStyle: LineStyle;
  /** 文字工具：字体与字号（比例，相对画布高） */
  fontFamily: string;
  textSize: number;
  currentPage: number;
  pageCount: number;
  /** 当前页背景图（课件图片组当前页 / 单图）；为空则显示黑板背景 */
  bgImage?: string | null;
  /** 黑板（无背景时）宽高比：按 tiff 课件首页尺寸固定 */
  boardAspect?: number;
  /** 黑板独立窗口：主窗口回退显示时点击重新打开（共享窗口内不显示） */
  onToggleShare?: () => void;
  /** 占位区背景色（容器外圈）：课堂占位区传深灰 #3a3a3a，独立黑板窗口传黑 #000 */
  boardBackground?: string;
  /** 课件加载进标签容器：true 时课件按图片比例 contain 到容器内（100%=容器内完整填充、不超出容器）；
   *  false（独立黑板窗口）保持原始像素×zoom（超出由滚动查看） */
  fitContainer?: boolean;
  /** 黑板画面比例 = 自由比例：画布按容器满铺（四周各 10px）；false = 按黑板画面比例 contain 占位区居中 */
  boardAspectFree?: boolean;
  /** 隐藏底部控制栏（黑板独立窗口只显示画布；控制栏留在主窗口原位置） */
  showControls?: boolean;
  /** 外部缩放同步：主窗口控制栏缩放值（null = 不外部控制） */
  zoomSync?: number | null;
  /** 内部缩放变化上报（课件自动填充 / 控制栏操作时）：z=当前缩放，fill=宽度填满基准（100%） */
  onZoomSync?: (z: number, fill?: number) => void;
  /** TIFF 课件：缩放锁定 100% 不可编辑 */
  isTiffMode?: boolean;
  /** 渗透显示：下一页课件帧图像 URL（多页课件才有；为空则渗透框不显示内容） */
  penetrateNextUrl?: string | null;
  timerText: string;
  onPageChange: (page: number) => void;
  onClear: () => void;
  /** 透明覆盖书写模式（课件 HTML/视频 书写层）：画布透明（不画黑板背景/边框），尺寸=容器全尺寸，
   *  完全复用黑板书写工具在课件上批注 */
  overlayMode?: boolean;
}

const PAGE_COUNT = 10;

/** 图片缓存：shape 重绘时复用已加载图片 */
const imageCache = new Map<string, HTMLImageElement>();

/** 线宽：细=2 / 中=3 / 粗=4（固定数值线宽） */
function strokeWidth(s: IShape, w: number, h: number): number {
  void w;
  void h;
  if (s.size <= 1) return 2;
  if (s.size === 2) return 3;
  return 4;
}

/** 应用线型（实线/虚线）与公共描边属性 */
function beginStroke(ctx: CanvasRenderingContext2D, s: IShape, w: number, h: number) {
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  const lw = strokeWidth(s, w, h);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.lineStyle === 'dashed') ctx.setLineDash([lw * 4, lw * 3]);
  else ctx.setLineDash([]);
}

/** 画箭头头部（线条式：从尖端到两翼两条线，与擦除后剩余段样式一致，更清爽美观） */
function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  head: number,
) {
  const ang = Math.atan2(by - ay, bx - ax);
  const wing = 0.38; // 约 22°，更尖锐美观
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx - head * Math.cos(ang - wing), by - head * Math.sin(ang - wing));
  ctx.moveTo(bx, by);
  ctx.lineTo(bx - head * Math.cos(ang + wing), by - head * Math.sin(ang + wing));
  ctx.stroke();
}

/** 画弧线（两点 + 控制点 的二次贝塞尔曲线，控制点跟随鼠标垂向偏移） */
function drawArcPath(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cx?: number,
  cy?: number,
) {
  if (cx === undefined || cy === undefined) {
    // 兼容旧数据：以两点为弦的半圆弧
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const r = Math.hypot(dx, dy) / 2;
    if (r < 1e-6) return;
    const nx = -dy / r / 2;
    const ny = dx / r / 2;
    const start = Math.atan2(y0 - my - ny, x0 - mx - nx);
    const end = start + Math.PI;
    ctx.beginPath();
    ctx.arc(mx + nx, my + ny, r, start, end);
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(cx, cy, x1, y1);
  ctx.stroke();
}

function drawShape(ctx: CanvasRenderingContext2D, s: IShape, w: number, h: number) {
  if (s.type === 'image' && s.imageUrl) {
    const img = imageCache.get(s.imageUrl);
    if (!img) return;
    // 实际渲染尺寸：x1-x0 为归一化宽（兼容旧数据：x1=x0 时回退 0.28 画布宽）
    const iw = s.x1 > s.x0 ? (s.x1 - s.x0) * w : w * 0.28;
    const ih = s.y1 > s.y0 ? (s.y1 - s.y0) * h : iw * (s.imgW && s.imgH ? s.imgH / s.imgW : 0.75);
    ctx.save();
    ctx.drawImage(img, s.x0 * w, s.y0 * h, iw, ih);
    ctx.restore();
    return;
  }
  ctx.save();
  beginStroke(ctx, s, w, h);
  if (s.type === 'pencil') {
    if (s.points.length === 1) {
      // 点击（不拖动）：在点击位置画一个实心圆点
      const pt = s.points[0];
      const r = Math.max(2, strokeWidth(s, w, h) / 2);
      ctx.beginPath();
      ctx.arc(pt.x * w, pt.y * h, r, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (s.points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(s.points[0].x * w, s.points[0].y * h);
    for (let i = 1; i < s.points.length; i += 1) ctx.lineTo(s.points[i].x * w, s.points[i].y * h);
    ctx.stroke();
  } else if (s.type === 'line') {
    ctx.beginPath();
    ctx.moveTo(s.x0 * w, s.y0 * h);
    ctx.lineTo(s.x1 * w, s.y1 * h);
    ctx.stroke();
  } else if (s.type === 'arrow') {
    const x0 = s.x0 * w;
    const y0 = s.y0 * h;
    const x1 = s.x1 * w;
    const y1 = s.y1 * h;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    drawArrowHead(ctx, x0, y0, x1, y1, Math.max(14, strokeWidth(s, w, h) * 4));
  } else if (s.type === 'arc') {
    if (s.auxLine) {
      // 三点弧动态预览：半径虚线（圆心→起点，选起点时随光标、定起点后固定）+ 起点沿圆到投影端点的动态弧段
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(s.x0 * w, s.y0 * h);
      ctx.lineTo(s.x1 * w, s.y1 * h);
      ctx.stroke();
      ctx.setLineDash([]);
      if (s.points && s.points.length) {
        // 弧段：起点(x1,y1) 沿圆到投影终点 points[0]
        const cx = s.x0 * w;
        const cy = s.y0 * h;
        const ax = s.x1 * w;
        const ay = s.y1 * h;
        const bx = s.points[0].x * w;
        const by = s.points[0].y * h;
        const r = Math.hypot(ax - cx, ay - cy) || 0.0001;
        const sa = Math.atan2(ay - cy, ax - cx);
        const ea = Math.atan2(by - cy, bx - cx);
        let d = s.arcSweep !== undefined ? s.arcSweep : ea - sa;
        if (s.arcSweep === undefined) {
          if (d > Math.PI) d -= Math.PI * 2;
          if (d < -Math.PI) d += Math.PI * 2;
        }
        ctx.beginPath();
        ctx.arc(cx, cy, r, sa, sa + d, d < 0);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    if (s.arcMode === 'three' && s.points && s.points.length) {
      // 三点弧：圆心(x0,y0)、起点(x1,y1)、终点 points[0]，画短弧
      const cx = s.x0 * w;
      const cy = s.y0 * h;
      const ax = s.x1 * w;
      const ay = s.y1 * h;
      const bx = s.points[0].x * w;
      const by = s.points[0].y * h;
      const r = Math.hypot(ax - cx, ay - cy) || 0.0001;
      const sa = Math.atan2(ay - cy, ax - cx);
      const ea = Math.atan2(by - cy, bx - cx);
      // 有向扫过角：arcSweep 优先（支持 >180° 弧）；旧数据按投影角差规约短弧
      let d = s.arcSweep !== undefined ? s.arcSweep : ea - sa;
      if (s.arcSweep === undefined) {
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
      }
      ctx.beginPath();
      ctx.arc(cx, cy, r, sa, sa + d, d < 0);
      ctx.stroke();
    } else {
      const c = s.points && s.points.length ? s.points[0] : undefined;
      drawArcPath(ctx, s.x0 * w, s.y0 * h, s.x1 * w, s.y1 * h, c ? c.x * w : undefined, c ? c.y * h : undefined);
    }
  } else if (s.type === 'circleDiameter') {
    const cx = ((s.x0 + s.x1) / 2) * w;
    const cy = ((s.y0 + s.y1) / 2) * h;
    const r = Math.hypot((s.x1 - s.x0) * w, (s.y1 - s.y0) * h) / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  } else if (s.type === 'circleRadius') {
    const r = Math.hypot((s.x1 - s.x0) * w, (s.y1 - s.y0) * h);
    ctx.beginPath();
    ctx.arc(s.x0 * w, s.y0 * h, r, 0, Math.PI * 2);
    ctx.stroke();
  } else if (s.type === 'rect') {
    ctx.strokeRect(s.x0 * w, s.y0 * h, (s.x1 - s.x0) * w, (s.y1 - s.y0) * h);
  } else if (s.type === 'penetrate') {
    // 渗透显示框：边框与框内下一页预览由 DOM 层渲染（画布不画，避免双重描边）
    return;
  } else if (s.type === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(
      ((s.x0 + s.x1) / 2) * w,
      ((s.y0 + s.y1) / 2) * h,
      Math.abs((s.x1 - s.x0) * w) / 2,
      Math.abs((s.y1 - s.y0) * h) / 2,
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  } else if (s.type === 'text' && s.text) {
    const fs = s.fontSize ?? (s.size <= 1 ? 0.05 : s.size === 2 ? 0.08 : 0.11);
    const fontSize = fs * h;
    ctx.font = `${Math.max(12, fontSize)}px ${s.fontFamily ?? "'Microsoft YaHei'"}, sans-serif`;
    ctx.fillStyle = s.color;
    ctx.textBaseline = 'alphabetic';
    if (s.x1 > s.x0 && s.y1 > s.y0) {
      // 矩形文字区域：按宽度自动换行多行绘制（与输入时一致：按实际字形宽度换行、纵向完整显示）
      // 文字起点与编辑框 textarea 一致：从选中点横纵偏移 3px。
      // 行盒模拟：textarea 首行字形顶 = content 顶 + 半行距（line-height 1.15 → 0.075em），
      // 故 baseline = 偏移点 + 0.075em + 整段文字实际字形 ascent
      const rx0 = s.x0 * w + 3;
      const ry0 = s.y0 * h + 3;
      const rectWpx = (s.x1 - s.x0) * w;
      const t = s.text;
      let line = '';
      let lineW = 0;
      const tmT = ctx.measureText(t);
      const ascentT =
        tmT && typeof (tmT as { actualBoundingBoxAscent?: number }).actualBoundingBoxAscent === 'number'
          ? ((tmT as { actualBoundingBoxAscent: number }).actualBoundingBoxAscent)
          : fontSize * 0.8;
      let y = ry0 + fontSize * 0.075 + ascentT;
      const flush = () => {
        if (line) {
          ctx.fillText(line, rx0, y);
          y += fs * h * 1.15;
          line = '';
          lineW = 0;
        }
      };
      for (const ch of t) {
        if (ch === '\n') {
          flush();
          continue;
        }
        const chW = ctx.measureText(ch).width;
        if (line && lineW + chW > rectWpx) flush();
        line += ch;
        lineW += chW;
      }
      flush();
    } else {
      // 单行：与多行一致——字形顶 = 偏移点 + 0.075em（半行距）
      const tmS = ctx.measureText(s.text);
      const ascS =
        tmS && typeof (tmS as { actualBoundingBoxAscent?: number }).actualBoundingBoxAscent === 'number'
          ? ((tmS as { actualBoundingBoxAscent: number }).actualBoundingBoxAscent)
          : fontSize * 0.8;
      ctx.fillText(s.text, s.x0 * w + 3, s.y0 * h + 3 + fontSize * 0.075 + ascS);
    }
  } else if (s.type === 'text') {
    // 文字拖拽预览：黑白相间虚线矩形（位置固定，不偏移）
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#000';
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(s.x0 * w, s.y0 * h, (s.x1 - s.x0) * w, (s.y1 - s.y0) * h);
    ctx.strokeStyle = '#fff';
    ctx.lineDashOffset = 4;
    ctx.strokeRect(s.x0 * w, s.y0 * h, (s.x1 - s.x0) * w, (s.y1 - s.y0) * h);
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    ctx.restore();
  } else if (s.type === 'coords') {
    // 坐标系：矩形区域内画 X/Y 轴（带箭头与刻度），原点位于中心
    const x0 = s.x0 * w;
    const y0 = s.y0 * h;
    const rw = (s.x1 - s.x0) * w;
    const rh = (s.y1 - s.y0) * h;
    const cx = x0 + rw / 2;
    const cy = y0 + rh / 2;
    const tick = Math.max(6, strokeWidth(s, w, h) * 2);
    // X 轴
    ctx.beginPath();
    ctx.moveTo(x0, cy);
    ctx.lineTo(x0 + rw, cy);
    ctx.stroke();
    drawArrowHead(ctx, x0, cy, x0 + rw, cy, Math.max(9, strokeWidth(s, w, h) * 3.5));
    // Y 轴
    ctx.beginPath();
    ctx.moveTo(cx, y0 + rh);
    ctx.lineTo(cx, y0);
    ctx.stroke();
    drawArrowHead(ctx, cx, y0 + rh, cx, y0, Math.max(9, strokeWidth(s, w, h) * 3.5));
    // 刻度短线
    ctx.beginPath();
    for (let i = -3; i <= 3; i++) {
      if (i === 0) continue;
      const px = cx + (rw / 2 / 4) * i;
      ctx.moveTo(px, cy - tick);
      ctx.lineTo(px, cy + tick);
    }
    for (let j = -3; j <= 3; j++) {
      if (j === 0) continue;
      const py = cy + (rh / 2 / 4) * j;
      ctx.moveTo(cx - tick, py);
      ctx.lineTo(cx + tick, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** 形状包围盒（归一化坐标） */
function shapeBox(s: IShape, ar?: number): { x0: number; y0: number; x1: number; y1: number } {
  if (s.type === 'image') {
    if (s.x1 > s.x0 && s.y1 > s.y0) {
      return { x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 };
    }
    const a = ar ?? 0.76;
    const iw = 0.28;
    const ih = s.imgW && s.imgH ? iw * (s.imgH / s.imgW) * a : iw * 0.75 * a;
    return { x0: s.x0, y0: s.y0, x1: s.x0 + iw, y1: s.y0 + ih };
  }
  const pts = s.points.length ? s.points : [{ x: s.x0, y: s.y0 }, { x: s.x1, y: s.y1 }];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x0: minX, y0: minY, x1: maxX, y1: maxY };
}

/** 两个形状包围盒是否相交 */
function boxIntersect(a: { x0: number; y0: number; x1: number; y1: number }, b: { x0: number; y0: number; x1: number; y1: number }): boolean {
  return !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1);
}

/** 图片/文字的可编辑包围盒（归一化坐标）；其他形状不可选中编辑 */
/** 三点弧痕迹点列：按物理半径（宽高比换算 rx/ry）与归一化角度采样，匹配实际绘制弧线 */
function arcPoints(s: IShape, ar?: number): { x: number; y: number }[] {
  if (s.arcMode === 'three' && s.points && s.points.length) {
    const a = ar ?? 1.78; // 宽高比 w/h
    const cx = s.x0;
    const cy = s.y0;
    const ax = s.x1;
    const ay = s.y1;
    const bx = s.points[0].x;
    const by = s.points[0].y;
    const dx = ax - cx;
    const dy = ay - cy;
    const rx = Math.hypot(dx, dy / a) || 0.0001; // x 方向归一化半径（物理半径/宽）
    const ry = rx * a; // y 方向归一化半径（物理半径/高）
    // 物理角度：atan2(Δy·h, Δx·w) = atan2(Δy/a, Δx)（h/w = 1/a），与绘制弧线一致
    const sa = Math.atan2(dy / a, dx);
    const ea = Math.atan2((by - cy) / a, bx - cx);
    // 有向扫过角：arcSweep 优先（支持 >180° 弧）；旧数据按投影角差规约短弧
    let d = s.arcSweep !== undefined ? s.arcSweep : ea - sa;
    if (s.arcSweep === undefined) {
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
    }
    const out: { x: number; y: number }[] = [];
    const n = Math.max(8, Math.ceil(Math.abs(d) / 0.08));
    for (let i = 0; i <= n; i++) {
      const t = sa + (d * i) / n;
      out.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
    }
    return out;
  }
  return [];
}

function selectBox(s: IShape, ar?: number): { x0: number; y0: number; x1: number; y1: number } | null {
  if (s.type === 'image') {
    // 图片按实际渲染尺寸（x1-x0 为归一化宽；旧数据 x1=x0 时回退 0.28 宽）
    if (s.x1 > s.x0 && s.y1 > s.y0) {
      return { x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 };
    }
    const a = ar ?? 0.76;
    const iw = 0.28;
    const ih = s.imgW && s.imgH ? iw * (s.imgH / s.imgW) * a : iw * 0.75 * a;
    return { x0: s.x0, y0: s.y0, x1: s.x0 + iw, y1: s.y0 + ih };
  }
  if (s.type === 'text') {
    if (s.x1 > s.x0 && s.y1 > s.y0 && s.text) {
      // 矩形文字区域：直接使用实际矩形（显示区域），保证拖角时选中框与光标同步
      return { x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 };
    }
    const fs = s.fontSize ?? (s.size <= 1 ? 0.05 : s.size === 2 ? 0.08 : 0.11);
    const w = (s.text?.length ?? 1) * fs * 0.52;
    return { x0: s.x0, y0: s.y0 - fs * 1.15, x1: s.x0 + w, y1: s.y0 + fs * 0.2 };
  }
  // 直径圆/半径圆：坐标是归一化（x 相对宽、y 相对高），物理半径须按宽高比换算；
  // 包围盒 = 圆心 ± (rx, ry)，rx/ry 分别按 x/y 尺度换算，保证框住整个正圆
  const a = ar ?? 1.78; // 宽高比 w/h（黑板 878:494 ≈ 1.78）
  if (s.type === 'circleDiameter') {
    const cx = (s.x0 + s.x1) / 2;
    const cy = (s.y0 + s.y1) / 2;
    const dx = Math.abs(s.x1 - s.x0) / 2;
    const dy = Math.abs(s.y1 - s.y0) / 2;
    const rx = Math.hypot(dx, dy / a);
    const ry = Math.hypot(dx * a, dy);
    return { x0: cx - rx, y0: cy - ry, x1: cx + rx, y1: cy + ry };
  }
  if (s.type === 'circleRadius') {
    const dx = Math.abs(s.x1 - s.x0);
    const dy = Math.abs(s.y1 - s.y0);
    const rx = Math.hypot(dx, dy / a);
    const ry = Math.hypot(dx * a, dy);
    return { x0: s.x0 - rx, y0: s.y0 - ry, x1: s.x0 + rx, y1: s.y0 + ry };
  }
  // 三点弧：包围盒 = 弧段痕迹点列的范围（完整框住实际弧线）
  if (s.type === 'arc') {
    const pts = arcPoints(s, ar);
    if (pts.length >= 2) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const pt of pts) {
        minX = Math.min(minX, pt.x);
        maxX = Math.max(maxX, pt.x);
        minY = Math.min(minY, pt.y);
        maxY = Math.max(maxY, pt.y);
      }
      return { x0: minX, y0: minY, x1: maxX, y1: maxY };
    }
  }
  // 直线/圆/椭圆/矩形/弧线/箭头等：通用包围盒（x0/x1 与 points 合并范围）
  let minX = Math.min(s.x0, s.x1);
  let maxX = Math.max(s.x0, s.x1);
  let minY = Math.min(s.y0, s.y1);
  let maxY = Math.max(s.y0, s.y1);
  if (s.points && s.points.length) {
    for (const pt of s.points) {
      minX = Math.min(minX, pt.x);
      maxX = Math.max(maxX, pt.x);
      minY = Math.min(minY, pt.y);
      maxY = Math.max(maxY, pt.y);
    }
  }
  return { x0: minX, y0: minY, x1: maxX, y1: maxY };
}

type Corner = 'nw' | 'ne' | 'se' | 'sw';
const CORNERS: Corner[] = ['nw', 'ne', 'se', 'sw'];

function cornerPoint(box: { x0: number; y0: number; x1: number; y1: number }, c: Corner) {
  return {
    x: c === 'nw' || c === 'sw' ? box.x0 : box.x1,
    y: c === 'nw' || c === 'ne' ? box.y0 : box.y1,
  };
}

function oppositeCorner(c: Corner): Corner {
  return c === 'nw' ? 'se' : c === 'ne' ? 'sw' : c === 'se' ? 'nw' : 'ne';
}

export interface BoardCanvasHandle {
  undo: () => void;
  clear: () => void;
  /** 当前黑板画面（含课件背景与板书）JPEG dataURL，供共享窗口实时镜像 */
  getFrame: () => string | null;
}

export default forwardRef<BoardCanvasHandle, BoardCanvasProps>(function BoardCanvas(
  {
    boardStyle,
    customBoardImage,
    tool,
    color,
    penSize,
    lineStyle,
    fontFamily,
    textSize,
    currentPage,
    pageCount,
    bgImage,
    boardAspect,
    timerText,
    onToggleShare,
    boardBackground = '#000',
    fitContainer = false,
    boardAspectFree = false,
    showControls = true,
    zoomSync,
    onZoomSync,
    isTiffMode,
    penetrateNextUrl,
    onPageChange,
    onClear,
    overlayMode = false,
  }: BoardCanvasProps,
  ref,
) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgRef = useRef<HTMLImageElement | null>(null);
  const customBoardRef = useRef<HTMLImageElement | null>(null);
  const redrawRef = useRef<() => void>(() => undefined);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const imagePosRef = useRef<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [pages, setPages] = useState<IShape[][]>(() => Array.from({ length: PAGE_COUNT }, () => []));
  const [draft, setDraft] = useState<IShape | null>(null);
  const [eraserPath, setEraserPath] = useState<{ x: number; y: number }[] | null>(null);
  const [textBox, setTextBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // 调试对比：确认后保留输入文字（红色半透明），与画布确认文字叠加，用于核对位置
  const [textCommitted, setTextCommitted] = useState(false);
  const [textValue, setTextValue] = useState('');
  const [caretPos, setCaretPos] = useState<{ x: number; y: number } | null>(null);
  // 选中编辑：图片/文字 可移动与缩放（鼠标工具）
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  // 三点弧：0=等待圆心 1=等待起点 2=确认终点
  const arcPhaseRef = useRef(0);
  // 三点弧终点拖动累积角：last=上一鼠标物理角，total=累积扫过角（支持 >180° 弧）
  const arcAngleRef = useRef({ last: 0, total: 0 });
  const draftRef = useRef<IShape | null>(null);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const selectDragRef = useRef<{
    idx: number;
    mode: 'move' | 'resize' | 'point';
    corner: Corner;
    which?: 'p0' | 'p1' | 'center' | 'start' | 'end' | 'radius';
    sx: number;
    sy: number;
    init: IShape;
    initBox: { x0: number; y0: number; x1: number; y1: number };
    /** 点调节累积角度（弧的起点/终点手柄）：last=上一鼠标物理角，totalDelta=累积增量 */
    lastAngle?: number;
    totalDelta?: number;
  } | null>(null);
  // 撤销历史：每次提交（绘画/擦除/框选删除/文字/图片/清空）前保存整页快照
  const pagesRef = useRef(pages);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);
  const historyRef = useRef<IShape[][][]>([]);
  const pushHistory = useCallback(() => {
    historyRef.current = [...historyRef.current, structuredClone(pagesRef.current)];
  }, []);
  const undo = useCallback(() => {
    const h = historyRef.current;
    if (!h.length) return;
    const prev = h[h.length - 1];
    historyRef.current = h.slice(0, -1);
    setPages(prev);
  }, []);
  useImperativeHandle(ref, () => ({
    undo,
    clear: () => {
      pushHistory();
      onClear();
      setPages((prev) => prev.map((pg, i) => (i === currentPage ? [] : pg)));
    },
    getFrame: () => canvasRef.current?.toDataURL('image/jpeg', 0.72) ?? null,
    getHistoryCount: () => historyRef.current.length,
  }), [undo, onClear, currentPage, pushHistory]);
  // 课件图片组：缩放比例与图片原始像素尺寸（真实像素 1:1 显示）
  const [zoom, setZoom] = useState(1);
  const [bgSize, setBgSize] = useState<{ w: number; h: number } | null>(null);
  // 课件宽度「完全填充」只初始化一次（打开课件时），翻页/手动缩放不再重置；
  // 存值 = 宽度填满时的 zoom（水平不溢出的上限），0 = 尚未初始化
  const fillZoomRef = useRef(0);

  const hasBg = !!bgImage && !!bgSize;
  // 标签容器（承载黑板 / 课件画布）：放在占位区之内，容器与占位区任意一边距离最小 10px（四周各留 10px → 可用尺寸各减 20px），
  // 画布（黑板区域）尺寸按设置页「黑板画面比例」确定：
  // 非自由比例（16:9→878:494、9:16→494:878、4:3→4/3、自定义→宽/高）：画布按该比例 contain 占位区正中间；
  // 自由比例（boardAspectFree）：宽=占位区宽-20、高=占位区高-20（充满占位区，每边 10px）
  const aspect = boardAspect ?? 878 / 494;
  const availW = Math.max(1, size.w - 20);
  const availH = Math.max(1, size.h - 20);
  const fitFree = fitContainer && boardAspectFree;
  // 画布 contain 尺寸（按设置比例居中；自由比例 = 占位区满铺 -20）
  const boardW = fitFree ? availW : Math.max(1, Math.round(Math.min(availW, availH * aspect)));
  const boardH = fitFree ? availH : Math.max(1, Math.round(Math.min(availH, availW / aspect)));
  // 课件/图片/PDF（hasBg）：课堂容器（fitContainer）与独立窗口一致——画布 = 图片原始像素 × zoom，
  // 加载时 zoom = 容器宽/图片宽（水平方向 100% 填充容器，取消倍数限制：小图放大填满、大图正确缩小），
  // 高度按图片比例 = 原始高 × zoom，溢出容器时纵向滚动条查看；缩放比例 100% = 水平填充，调节范围 10%-100%
  // fitContainer=false（独立黑板窗口）：独立窗口本身 = 容器——画布 = 窗口全尺寸（无 10px 内边距）
  // 透明覆盖书写模式（课件书写层）：画布=容器全尺寸，无比例 contain/内边距/缩放
  const contentW = overlayMode
    ? Math.max(1, size.w)
    : hasBg
      ? Math.max(1, Math.round(bgSize!.w * zoom))
      : fitContainer
        ? boardW
        : Math.max(1, size.w);
  const contentH = overlayMode
    ? Math.max(1, size.h)
    : hasBg
      ? Math.max(1, Math.round(bgSize!.h * zoom))
      : fitContainer
        ? boardH
        : Math.max(1, size.h);
  // 文字/坐标基准 = 画布本身（课件拉伸铺满画布，无 contain 偏移）
  const imgW = contentW;
  const imgH = contentH;
  const imgDx = 0;
  const imgDy = 0;
  // 画布容器（canvas 外层固定区）：浏览器模式（fitContainer）有课件时 = 878:494 容器固定（boardW×boardH，比例任何条件下不变），
  // canvas 在容器内水平填充（宽=boardW）、高度按图片比例可超容器 → 容器自身纵向滚动查看；其余情况 = 画布本身
  const boxW = overlayMode ? contentW : hasBg && fitContainer ? boardW : contentW;
  const boxH = overlayMode ? contentH : hasBg && fitContainer ? boardH : contentH;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // 自定义背景板图片：加载到缓存 ref，无课件时由画布拉伸铺满（与黑板样式预览一致）
  useEffect(() => {
    if (boardStyle === 'custom' && customBoardImage) {
      const img = new Image();
      img.onload = () => {
        customBoardRef.current = img;
        redrawRef.current();
      };
      img.onerror = () => {
        customBoardRef.current = null;
      };
      img.src = customBoardImage;
    } else {
      customBoardRef.current = null;
    }
  }, [boardStyle, customBoardImage]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // 形状坐标基准：统一以「标签容器」（canvas 画布）为标准——
    // 课件图片用原始像素尺寸（缩放由画布物理尺寸体现，笔迹随图同步缩放）；
    // 无背景（空白页）直接用 canvas 实际物理尺寸（canvas.width/height = 容器尺寸，坐标不偏移）
    const bw = hasBg ? bgSize!.w : canvas.width;
    const bh = hasBg ? bgSize!.h : canvas.height;
    // fitContainer（课堂容器）：课件拉伸铺满画布（水平填充容器宽、高度按比例），坐标基准 = 画布本身；
    // 否则 = 全画布物理尺寸
    let cw: number;
    let ch: number;
    let dxF = 0;
    let dyF = 0;
    if (hasBg) {
      cw = Math.max(1, Math.round(bgSize!.w * zoom));
      ch = Math.max(1, Math.round(bgSize!.h * zoom));
    } else {
      cw = canvas.width;
      ch = canvas.height;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (bgRef.current) {
      // 画完整背景（题目信息条隐藏已在帧解码阶段处理，黑板加载的即为处理后的帧）
      ctx.drawImage(bgRef.current, 0, 0, cw, ch);
    } else if (!hasBg && !overlayMode) {
      // 无课件：画布内绘制黑板样式（占位区为深灰背景，黑板画布按比例居中）
      // overlayMode（课件书写层）：保持透明，不绘制黑板背景/边框
      const cwReal = canvas.width;
      const chReal = canvas.height;
      if (boardStyle === 'custom' && customBoardRef.current) {
        // 自定义背景板：拉伸铺满整个画布
        ctx.drawImage(customBoardRef.current, 0, 0, cwReal, chReal);
      } else {
        const bgFill =
          boardStyle === 'green'
            ? '#1f5e36'
            : boardStyle === 'black'
              ? '#0f172a'
              : '#f8fafc';
        ctx.fillStyle = bgFill;
        ctx.fillRect(0, 0, cwReal, chReal);
        if (boardStyle === 'green') {
          // 绿板黄色边框（对应原 border-8 border-[#c9a227]）
          ctx.strokeStyle = '#c9a227';
          ctx.lineWidth = 8;
          ctx.strokeRect(4, 4, cwReal - 8, chReal - 8);
        } else if (boardStyle === 'white') {
          // 白板黑色边框（对应原 border-2 border-black）
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 2;
          ctx.strokeRect(1, 1, cwReal - 2, chReal - 2);
        }
      }
    }
    // 形状/笔迹绘制统一用画布物理尺寸（cw/ch）：归一化坐标 × 物理尺寸 = 屏幕位置，
    // 与书写光标位置一致（课件缩放后不再偏移）
    // 确认后文字：保持 textarea 显示（输入位置不变），canvas 不再重画该文字（其他文字正常绘制）
    const hasFitOffset = dxF !== 0 || dyF !== 0;
    if (hasFitOffset) {
      ctx.save();
      ctx.translate(dxF, dyF);
    }
    for (const s of pages[currentPage] ?? []) {
      if (
        textCommitted &&
        textBox &&
        s.type === 'text' &&
        Math.abs(s.x0 - textBox.x0) < 0.001 &&
        Math.abs(s.y0 - textBox.y0) < 0.001
      )
        continue;
      drawShape(ctx, s, cw, ch);
    }
    if (draft) {
      if (draft.type === 'boxDelete') {
        // 框选删除预览：黑白相间动态虚线框
        const bx = Math.min(draft.x0, draft.x1) * cw;
        const by = Math.min(draft.y0, draft.y1) * ch;
        const bw = Math.abs(draft.x1 - draft.x0) * cw;
        const bh = Math.abs(draft.y1 - draft.y0) * ch;
        ctx.save();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#000';
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(bx, by, bw, bh);
        ctx.strokeStyle = '#fff';
        ctx.lineDashOffset = 4;
        ctx.strokeRect(bx, by, bw, bh);
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        ctx.restore();
      } else {
        drawShape(ctx, draft, cw, ch);
      }
    }
    // 文字输入中：黑白相间虚线框（与框选删除预览一致）；确认后不再显示
    if (textBox && !textCommitted) {
      ctx.save();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#000';
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(textBox.x0 * cw, textBox.y0 * ch, (textBox.x1 - textBox.x0) * cw, (textBox.y1 - textBox.y0) * ch);
      ctx.strokeStyle = '#fff';
      ctx.lineDashOffset = 4;
      ctx.strokeRect(textBox.x0 * cw, textBox.y0 * ch, (textBox.x1 - textBox.x0) * cw, (textBox.y1 - textBox.y0) * ch);
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      ctx.restore();
    }
    // 选中框：图片/文字 蓝色虚线框 + 四角缩放手柄
    const selIdx = selectedIdx;
    const selShape = selIdx !== null ? pages[currentPage]?.[selIdx] : undefined;
    if (selShape) {
      if (selShape.type === 'arc' && selShape.arcMode === 'three' && selShape.points && selShape.points.length) {
        // 弧：扇形框选（圆心→起点半径线 → 弧段 → 圆心→弧实际末尾半径线）+ 调节点（圆心/起点/弧实际末端/弧段中点半径点）
        const cx = selShape.x0 * cw;
        const cy = selShape.y0 * ch;
        const ax = selShape.x1 * cw;
        const ay = selShape.y1 * ch;
        const r = Math.hypot(ax - cx, ay - cy) || 0.0001;
        const sa = Math.atan2(ay - cy, ax - cx);
        const ea = Math.atan2(selShape.points[0].y * ch - cy, selShape.points[0].x * cw - cx);
        let d = selShape.arcSweep !== undefined ? selShape.arcSweep : ea - sa;
        if (selShape.arcSweep === undefined) {
          if (d > Math.PI) d -= Math.PI * 2;
          if (d < -Math.PI) d += Math.PI * 2;
        }
        ctx.save();
        ctx.strokeStyle = '#1677ff';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        // 两条半径虚线（终点线画到弧实际末尾）+ 弧段
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(ax, ay);
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + r * Math.cos(sa + d), cy + r * Math.sin(sa + d));
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, r, sa, sa + d, d < 0);
        ctx.stroke();
        ctx.setLineDash([]);
        // 手柄：圆心、起点、弧实际末端（终点）、弧段中点（半径调节点）
        const endP = { x: cx + r * Math.cos(sa + d), y: cy + r * Math.sin(sa + d) };
        const radP = { x: cx + r * Math.cos(sa + d / 2), y: cy + r * Math.sin(sa + d / 2) };
        const pts = [
          { x: selShape.x0, y: selShape.y0 },
          { x: selShape.x1, y: selShape.y1 },
          { x: endP.x / cw, y: endP.y / ch },
          { x: radP.x / cw, y: radP.y / ch },
        ];
        ctx.fillStyle = '#ffffff';
        for (const pt of pts) {
          const px = pt.x * cw;
          const py = pt.y * ch;
          ctx.fillRect(px - 6, py - 6, 12, 12);
          ctx.strokeRect(px - 6, py - 6, 12, 12);
        }
        ctx.restore();
      } else if (selShape.type === 'circleDiameter' || selShape.type === 'circleRadius') {
        // 圆：圆形虚线框包围（按宽高比换算 rx/ry）+ 可调点手柄（直径圆两点 / 半径圆一点）
        const a = cw / ch;
        let ccx: number, ccy: number, rrx: number, rry: number;
        if (selShape.type === 'circleDiameter') {
          ccx = (selShape.x0 + selShape.x1) / 2;
          ccy = (selShape.y0 + selShape.y1) / 2;
          const dx = Math.abs(selShape.x1 - selShape.x0) / 2;
          const dy = Math.abs(selShape.y1 - selShape.y0) / 2;
          rrx = Math.hypot(dx, dy / a);
          rry = Math.hypot(dx * a, dy);
        } else {
          ccx = selShape.x0;
          ccy = selShape.y0;
          const dx = Math.abs(selShape.x1 - selShape.x0);
          const dy = Math.abs(selShape.y1 - selShape.y0);
          rrx = Math.hypot(dx, dy / a);
          rry = Math.hypot(dx * a, dy);
        }
        ctx.save();
        ctx.strokeStyle = '#1677ff';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.ellipse(ccx * cw, ccy * ch, Math.max(1, rrx * cw), Math.max(1, rry * ch), 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        const pts: { x: number; y: number }[] =
          selShape.type === 'circleDiameter'
            ? [{ x: selShape.x0, y: selShape.y0 }, { x: selShape.x1, y: selShape.y1 }]
            : [{ x: selShape.x0, y: selShape.y0 }, { x: selShape.x1, y: selShape.y1 }];
        ctx.fillStyle = '#ffffff';
        for (const pt of pts) {
          const px = pt.x * cw;
          const py = pt.y * ch;
          ctx.fillRect(px - 6, py - 6, 12, 12);
          ctx.strokeRect(px - 6, py - 6, 12, 12);
        }
        ctx.restore();
      } else if (selShape.type === 'penetrate') {
        // 渗透显示框：选中高亮（虚线包围盒 + 四角手柄）由 DOM 层渲染（画布高亮会被渗透预览层覆盖，统一走 DOM）
      } else {
        const box = selectBox(selShape, cw / ch);
        if (box) {
          const x0 = box.x0 * cw;
          const y0 = box.y0 * ch;
          const x1 = box.x1 * cw;
          const y1 = box.y1 * ch;
          ctx.save();
          ctx.strokeStyle = '#1677ff';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
          ctx.setLineDash([]);
          ctx.fillStyle = '#ffffff';
          for (const c of CORNERS) {
            const cp = cornerPoint(box, c);
            const px = cp.x * cw;
            const py = cp.y * ch;
            ctx.fillRect(px - 6, py - 6, 12, 12);
            ctx.strokeRect(px - 6, py - 6, 12, 12);
          }
          ctx.restore();
        }
      }
    }
    if (eraserPath) {
      // 橡皮路径预览：方形笔刷（物理坐标，与擦除位置一致）
      ctx.save();
      ctx.strokeStyle = 'rgba(220,38,38,0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      const r = eraserRadius(cw);
      ctx.beginPath();
      for (const p of eraserPath) {
        ctx.rect(p.x * cw - r, p.y * ch - r, r * 2, r * 2);
      }
      ctx.stroke();
      ctx.restore();
    }
    if (hasFitOffset) {
      ctx.restore();
    }
  }, [pages, currentPage, draft, eraserPath, size, bgSize, hasBg, zoom, selectedIdx]);
  useEffect(() => {
    redrawRef.current = redraw;
  }, [redraw]);

  // 键盘删除：选中文字/图片（及任意选中形状）时，Delete/Backspace 删除选中项
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 文字输入中：删除键用于删字符，不触发删除选中项
      if (textBox) return;
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (selectedIdx === null) return;
      e.preventDefault();
      pushHistory();
      setPages((prev) =>
        prev.map((pg, i) => (i === currentPage ? pg.filter((_, j) => j !== selectedIdx) : pg)),
      );
      // 删除的是确认文字（textarea 显示）：一并清除输入层（否则文字删了文本框还留在屏幕）
      setTextBox(null);
      setTextValue('');
      setTextCommitted(false);
      setSelectedIdx(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textBox, selectedIdx, currentPage]);

  // 外部缩放同步（黑板独立窗口：主窗口控制栏缩放 → 推送）
  useEffect(() => {
    // 锁定模式（黑板空白页 / TIFF 课件）：缩放固定 100% 不可编辑，忽略外部缩放
    if (!fillZoomRef.current || isTiffMode) return;
    if (zoomSync != null && Math.abs(zoomSync - zoom) > 1e-6) {
      // 缩放范围 10%-100%（相对宽度填满基准 fillZoom）：zoom ∈ [fillZoom×0.1, fillZoom]
      const fill = fillZoomRef.current;
      setZoom(Math.min(fill, Math.max(fill * 0.1, zoomSync)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomSync, isTiffMode]);

  // 背景图（课件当前页）：加载后记录原始像素尺寸并重绘；首次加载按「宽度填满」适配：
  // zoom = 容器宽 / 图片宽，高度按比例可超出容器 → 容器纵向滚动查看完整内容
  useEffect(() => {
    if (bgImage) {
      const img = new Image();
      img.onload = () => {
        bgRef.current = img;
        setBgSize({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
        // 每次课件/图片加载都强制按容器宽 100% 填满初始化（容器当作之前的窗口）：
        // zoom = 容器宽/图片宽 → 画布宽 = 容器宽（水平 100% 填充容器、不溢出、四周距占位区 ≥10px），
        // 高度按图片比例 = 原始高×zoom，超出容器由纵向滚动条查看；
        // 不能只在首次初始化（fillZoomRef 已有值时切换课件会用旧缩放 → 画布超容器跑到占位区）
        const el = wrapRef.current;
        // 容器可用宽：fitContainer（课堂）= 黑板容器宽 boardW（画布区域固定：黑板页/课件页画布宽一致，切换课件大小不变）；
        // 独立黑板窗口保持窗口全宽（窗口本身 = 容器，不改）
        const cw = fitContainer ? boardW : el ? Math.max(1, el.clientWidth) : 0;
        if (cw > 0) {
          // 课堂容器（fitContainer）与独立窗口一致的加载方式：zoom = 容器/窗口宽 ÷ 图片宽（水平 100% 填充），
          // 取消倍数限制：小尺寸图片放大填满、大尺寸图片正确缩小，高度按比例可超容器 → 纵向滚动条查看
          const z = cw / (img.naturalWidth || 1);
          fillZoomRef.current = z;
          setZoom(z);
          onZoomSync?.(z, z);
        }
        redrawRef.current();
      };
      img.src = bgImage;
      return () => {
        if (bgRef.current === img) bgRef.current = null;
      };
    }
    bgRef.current = null;
    fillZoomRef.current = 0;
    redrawRef.current();
    return undefined;
  }, [bgImage]);

  // 容器尺寸变化（黑板窗口贴合完成/窗口调整）：课件若未手动缩放则按新容器宽重新填满，
  // 消除贴合过程中按中间尺寸初始化导致的「宽度不满、边缘黑框」
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !bgImage || !bgSize) return;
    const ro = new ResizeObserver(() => {
      // 容器可用宽：fitContainer（课堂）= 黑板容器宽 boardW；独立黑板窗口保持窗口全宽
      const cw = fitContainer ? boardW : Math.max(1, el.clientWidth);
      if (!cw || cw <= 0) return;
      if (!fillZoomRef.current) {
        // 补初始化：首次容器就绪时按宽度填满（覆盖 bgImage 加载时容器尚未就绪的情况）
        const z = cw / bgSize.w;
        fillZoomRef.current = z;
        setZoom(z);
        onZoomSync?.(z, z);
        return;
      }
      const prevFill = fillZoomRef.current;
      const newFill = cw / bgSize.w;
      fillZoomRef.current = newFill;
      // 用户未手动缩放（zoom 仍等于旧填满值）或内容宽度已超新容器 → 按新宽度填满/收敛
      if (Math.abs(zoom - prevFill) < 1e-6 || zoom > newFill) {
        setZoom(newFill);
        onZoomSync?.(newFill, newFill);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgImage, bgSize, boardW]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  // 切页清空选中
  useEffect(() => {
    setSelectedIdx(null);
  }, [currentPage]);

  const toNorm = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  /** 橡皮半径（固定尺寸，不随线宽变化；归一化坐标 ≈1% 画布宽） */
  /** 橡皮半径（归一化坐标，相对画布宽）：固定小尺寸 ≈0.8%宽（不随线宽档位变化），精准擦除 */
  const eraserRadius = (cw: number) => (cw * 0.008) / cw;

  /** 形状 → 轮廓点序列（用于逐段擦除/框选删除）：线型直接取 points，矩形/圆/椭圆采样轮廓；圆按宽高比换算物理半径 */
  const shapeOutline = (s: IShape, ar?: number): { x: number; y: number }[] => {
    if (s.type === 'arrow') {
      // 箭头轮廓：直线 + 头部三角两翼（头在终点 x1/y1），供橡皮/框选沿实际痕迹擦除
      const W = 878, H = 494;
      const x0p = s.x0 * W, y0p = s.y0 * H, x1p = s.x1 * W, y1p = s.y1 * H;
      // 头部翼长 = 与绘制 drawArrowHead 完全一致的物理像素（不随箭头长度变化）
      const head = Math.max(14, strokeWidth(s, 1, 1) * 4);
      const ang = Math.atan2(y1p - y0p, x1p - x0p); // 物理角度（与绘制一致）
      const wing = 0.38;
      const N = (px: number, py: number) => ({ x: px / W, y: py / H });
      return [
        N(x0p, y0p),
        N(x1p, y1p),
        N(x1p - head * Math.cos(ang - wing), y1p - head * Math.sin(ang - wing)),
        N(x1p, y1p),
        N(x1p - head * Math.cos(ang + wing), y1p - head * Math.sin(ang + wing)),
        N(x1p, y1p),
      ];
    }
    if (s.type === 'coords') {
      // 坐标系轮廓：X/Y 轴主线 + 箭头翼线 + 刻度短线（按物理像素计算后分别用宽/高归一化，与绘制一致）
      const W = 878, H = 494;
      const x0 = s.x0, y0 = s.y0, x1 = s.x1, y1 = s.y1;
      const rw = x1 - x0, rh = y1 - y0;
      const cx = x0 + rw / 2, cy = y0 + rh / 2;
      const sw = strokeWidth(s, 1, 1);
      const tick = Math.max(6, sw * 2);
      const head = Math.max(9, sw * 3.5);
      const N = (px: number, py: number) => ({ x: px / W, y: py / H });
      const out: { x: number; y: number }[] = [];
      const seg = (ax: number, ay: number, bx: number, by: number) => {
        out.push(N(ax, ay), N(bx, by));
      };
      // X 轴主线 + 箭头两翼（头在右端）
      const exX = x0 * W + rw * W, eyX = cy * H;
      seg(x0 * W, eyX, exX, eyX);
      seg(exX, eyX, exX - head * Math.cos(0.38), eyX + head * Math.sin(0.38));
      seg(exX, eyX, exX - head * Math.cos(0.38), eyX - head * Math.sin(0.38));
      // Y 轴主线 + 箭头两翼（头在上端）
      const exY = cx * W, eyY = y0 * H;
      seg(exY, (y0 + rh) * H, exY, eyY);
      seg(exY, eyY, exY + head * Math.sin(0.38), eyY + head * Math.cos(0.38));
      seg(exY, eyY, exY - head * Math.sin(0.38), eyY + head * Math.cos(0.38));
      // 刻度短线（物理 tick，跳过原点）
      for (let i = -3; i <= 3; i++) {
        if (i === 0) continue;
        const px = cx * W + (rw * W / 2 / 4) * i;
        seg(px, cy * H - tick, px, cy * H + tick);
      }
      for (let j = -3; j <= 3; j++) {
        if (j === 0) continue;
        const py = cy * H + (rh * H / 2 / 4) * j;
        seg(cx * W - tick, py, cx * W + tick, py);
      }
      return out;
    }
    if (s.type === 'rect' || s.type === 'penetrate') {
      const { x0, y0, x1, y1 } = s;
      return [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
        { x: x0, y: y0 },
      ];
    }
    if (s.type === 'circleRadius') {
      // 半径圆：圆心 x0/y0，半径 = 圆心到 x1/y1 的物理距离（按宽高比换算 rx/ry）
      const a = ar ?? 1.78;
      const dx = Math.abs(s.x1 - s.x0);
      const dy = Math.abs(s.y1 - s.y0);
      const rx = Math.hypot(dx, dy / a) || 0.0001;
      const ry = Math.hypot(dx * a, dy) || 0.0001;
      const out: { x: number; y: number }[] = [];
      for (let t = 0; t <= Math.PI * 2; t += 0.08)
        out.push({ x: s.x0 + rx * Math.cos(t), y: s.y0 + ry * Math.sin(t) });
      return out;
    }
    if (s.type === 'circleDiameter') {
      const a = ar ?? 1.78;
      const cx = (s.x0 + s.x1) / 2;
      const cy = (s.y0 + s.y1) / 2;
      const dx = Math.abs(s.x1 - s.x0) / 2;
      const dy = Math.abs(s.y1 - s.y0) / 2;
      const rx = Math.hypot(dx, dy / a) || 0.0001;
      const ry = Math.hypot(dx * a, dy) || 0.0001;
      const out: { x: number; y: number }[] = [];
      for (let t = 0; t <= Math.PI * 2; t += 0.08)
        out.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
      return out;
    }
    if (s.type === 'ellipse') {
      const cx = (s.x0 + s.x1) / 2;
      const cy = (s.y0 + s.y1) / 2;
      const rx = Math.abs(s.x1 - s.x0) / 2;
      const ry = Math.abs(s.y1 - s.y0) / 2;
      const out: { x: number; y: number }[] = [];
      for (let a = 0; a <= Math.PI * 2; a += 0.08)
        out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
      return out;
    }
    if (s.points && s.points.length >= 2) return s.points;
    return [
      { x: s.x0, y: s.y0 },
      { x: s.x1, y: s.y1 },
    ];
  };

  /** 坐标图独立线段（X/Y 轴主线 + 箭头两翼 + 刻度短线，每条独立参与擦除/框选判定，避免碎线） */
  const coordsLines = (s: IShape): { a: { x: number; y: number }; b: { x: number; y: number } }[] => {
    const W = 878, H = 494; // 黑板固定物理尺寸（比例恒定）
    const x0 = s.x0, y0 = s.y0, x1 = s.x1, y1 = s.y1;
    const rw = x1 - x0, rh = y1 - y0;
    const cx = x0 + rw / 2, cy = y0 + rh / 2;
    const sw = strokeWidth(s, 1, 1);
    const tick = Math.max(6, sw * 2); // 物理像素（与绘制一致）
    const head = Math.max(9, sw * 3.5); // 物理像素
    const N = (px: number, py: number) => ({ x: px / W, y: py / H });
    const L: { a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
    // X 轴主线 + 两翼（头在右端）
    const exX = x0 * W + rw * W, eyX = cy * H;
    L.push({ a: N(x0 * W, eyX), b: N(exX, eyX) });
    L.push({ a: N(exX, eyX), b: N(exX - head * Math.cos(0.38), eyX + head * Math.sin(0.38)) });
    L.push({ a: N(exX, eyX), b: N(exX - head * Math.cos(0.38), eyX - head * Math.sin(0.38)) });
    // Y 轴主线 + 两翼（头在上端）
    const exY = cx * W, eyY = y0 * H;
    L.push({ a: N(exY, (y0 + rh) * H), b: N(exY, eyY) });
    L.push({ a: N(exY, eyY), b: N(exY + head * Math.sin(0.38), eyY + head * Math.cos(0.38)) });
    L.push({ a: N(exY, eyY), b: N(exY - head * Math.sin(0.38), eyY + head * Math.cos(0.38)) });
    // 刻度短线（X 方向垂直短线 + Y 方向水平短线，物理 tick，跳过原点）
    for (let i = -3; i <= 3; i++) {
      if (i === 0) continue;
      const px = cx * W + (rw * W / 2 / 4) * i;
      L.push({ a: N(px, cy * H - tick), b: N(px, cy * H + tick) });
    }
    for (let j = -3; j <= 3; j++) {
      if (j === 0) continue;
      const py = cy * H + (rh * H / 2 / 4) * j;
      L.push({ a: N(cx * W - tick, py), b: N(cx * W + tick, py) });
    }
    return L;
  };

  /** 橡皮擦除：手写笔画与图形逐段擦除（像真橡皮），图片/文字不可擦除 */
  const eraseAt = (pts: { x: number; y: number }[], pageIdx: number, r: number) => {
    setPages((prev) =>
      prev.map((pg, i) => {
        if (i !== pageIdx) return pg;
        const next: IShape[] = [];
        for (const s of pg) {
          // 图片与文字：橡皮不可擦除
          if (s.type === 'image' || s.type === 'text') {
            next.push(s);
            continue;
          }
          if (s.type === 'coords') {
            // 坐标图：独立线段组擦除（长轴局部擦除、短刻度整条判定），剩余段转铅笔并丢弃极短残段，避免碎线
            const lines = coordsLines(s);
            const outShapes: IShape[] = [];
            let changed = false;
            for (const ln of lines) {
              const a = ln.a, b = ln.b;
              const len = Math.hypot(b.x - a.x, b.y - a.y);
              if (len < 1e-6) continue;
              const n = Math.ceil(len / r);
              const detailed: { x: number; y: number }[] = [];
              for (let k = 0; k <= n; k++)
                detailed.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
              const segs2: { x: number; y: number }[][] = [];
              let cur: { x: number; y: number }[] = [detailed[0]];
              let lineHit = false;
              for (let k = 1; k < detailed.length; k++) {
                const p1 = detailed[k - 1], p2 = detailed[k];
                const hit = pts.some((p) => distToSeg(p.x, p.y, p1.x, p1.y, p2.x, p2.y) < r);
                if (hit) lineHit = true;
                if (!hit) {
                  cur.push(p2);
                } else {
                  if (cur.length >= 2) segs2.push(cur);
                  cur = [p2];
                }
              }
              if (cur.length >= 2) segs2.push(cur);
              if (!lineHit) {
                outShapes.push({
                  ...s, type: 'pencil', points: [a, b], arcMode: undefined, auxLine: undefined, text: undefined,
                  imageUrl: undefined, imgW: undefined, imgH: undefined, fontFamily: undefined, fontSize: undefined,
                });
                continue;
              }
              changed = true;
              for (const sp of segs2) {
                let sLen = 0;
                for (let i = 1; i < sp.length; i++) sLen += Math.hypot(sp[i].x - sp[i - 1].x, sp[i].y - sp[i - 1].y);
                if (sLen < r * 1.5) continue; // 丢弃极短残段，避免碎片
                outShapes.push({
                  ...s, type: 'pencil', points: sp, arcMode: undefined, auxLine: undefined, text: undefined,
                  imageUrl: undefined, imgW: undefined, imgH: undefined, fontFamily: undefined, fontSize: undefined,
                });
              }
            }
            if (!changed) next.push(s);
            else next.push(...outShapes);
            continue;
          }
          if (s.type === 'penetrate') {
            // 渗透显示框：橡皮命中框内任意点 → 整个删除（区域工具，不沿线切残段）
            const bx0 = Math.min(s.x0, s.x1), bx1 = Math.max(s.x0, s.x1);
            const by0 = Math.min(s.y0, s.y1), by1 = Math.max(s.y0, s.y1);
            const hit = pts.some((p) => p.x >= bx0 && p.x <= bx1 && p.y >= by0 && p.y <= by1);
            if (!hit) next.push(s);
            continue;
          }
          const outline = s.type === 'arc' ? arcOutline(s, contentW / contentH) : shapeOutline(s, contentW / contentH);
          if (outline.length < 2) {
            next.push(s);
            continue;
          }
          // 沿线细分：段长超过橡皮方块半径则采样细分（长直线/矩形边等），
          // 保证只有光标方块覆盖的小段被擦除，其余部分保留（像真橡皮逐点擦）
          const subdiv = (a: { x: number; y: number }, b: { x: number; y: number }) => {
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            if (len <= r) return [a, b];
            const n = Math.ceil(len / r);
            const out: { x: number; y: number }[] = [];
            for (let i = 0; i <= n; i++)
              out.push({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n });
            return out;
          };
          const detailed: { x: number; y: number }[] = [outline[0]];
          for (let k = 1; k < outline.length; k++) {
            const sub = subdiv(outline[k - 1], outline[k]);
            for (let i = 1; i < sub.length; i++) detailed.push(sub[i]);
          }
          // 逐小段判断：被橡皮方块覆盖的段删除，剩余连续段保留为多个子笔画
          const segs: { x: number; y: number }[][] = [];
          let cur: { x: number; y: number }[] = [detailed[0]];
          for (let k = 1; k < detailed.length; k++) {
            const a = detailed[k - 1];
            const b = detailed[k];
            const hit = pts.some((p) => distToSeg(p.x, p.y, a.x, a.y, b.x, b.y) < r);
            if (!hit) {
              cur.push(b);
            } else {
              if (cur.length >= 2) segs.push(cur);
              cur = [b];
            }
          }
          if (cur.length >= 2) segs.push(cur);
          // 未被擦到 → 原样保留
          if (segs.length === 1 && segs[0].length === outline.length) {
            next.push(s);
            continue;
          }
          // 全部擦除
          if (segs.length === 0) continue;
          // 被擦到 → 剩余连续段保存为铅笔子笔画（颜色/线宽继承）
          for (const sp of segs) {
            next.push({
              ...s,
              type: 'pencil',
              points: sp,
              arcMode: undefined,
              auxLine: undefined,
              text: undefined,
              imageUrl: undefined,
              imgW: undefined,
              imgH: undefined,
              fontFamily: undefined,
              fontSize: undefined,
            });
          }
        }
        return next;
      }),
    );
  };

  /** 点到线段最近点的方形（切比雪夫）距离：橡皮按光标方块覆盖判断，方块内的笔记被擦除 */
  const distToSeg = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.max(Math.abs(px - x1), Math.abs(py - y1));
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const qx = x1 + t * dx;
    const qy = y1 + t * dy;
    return Math.max(Math.abs(px - qx), Math.abs(py - qy));
  };

  /** 点到线段最短欧氏距离（选中命中用） */
  const distSeg = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  };

  /** 弧线痕迹点列（沿弧段采样，用于选中命中；按宽高比换算物理半径） */
  const arcOutline = (s: IShape, ar?: number): { x: number; y: number }[] => {
    const pts = arcPoints(s, ar);
    if (pts.length >= 2) return pts;
    return shapeOutline(s);
  };

  const handleDown = (e: React.PointerEvent) => {
    const p = toNorm(e);
    // 确认后的文字静态层：点击画布任意处即固定（textarea 消失，交由 canvas 绘制）
    if (textCommitted && textBox) {
      setTextCommitted(false);
      setTextBox(null);
      setTextValue('');
      setCaretPos(null);
    }
    if (tool === 'select') {
      // 选中编辑：优先命中当前选中形状的角手柄 → 缩放；其次形状内部 → 移动
      const pg = pages[currentPage] ?? [];
      let corner: Corner | null = null;
      let pointWhich: 'p0' | 'p1' | 'center' | 'start' | 'end' | null = null;
      if (selectedIdx === null) {
        // 未选中时：点击位置若命中某个弧/圆的可调点手柄，直接选中该形状并进入点调节（圆心不在弧线上，必须先这样选中）
        const hitPx = 22;
        let anyWhich: 'p0' | 'p1' | 'center' | 'start' | 'end' | null = null;
        let anyIdx: number | null = null;
        for (let j = 0; j < pg.length; j++) {
          const sh = pg[j];
          if (!sh) continue;
          if (sh.type === 'arc' && sh.arcMode === 'three' && sh.points && sh.points.length) {
            const a = contentW / contentH;
            const cx0 = sh.x0, cy0 = sh.y0;
            const dx0 = sh.x1 - cx0, dy0 = sh.y1 - cy0;
            const rx = Math.hypot(dx0, dy0 / a) || 0.0001;
            const ry = rx * a;
            const sa = Math.atan2(dy0 / a, dx0);
            const ea = Math.atan2((sh.points[0].y - cy0) / a, sh.points[0].x - cx0);
            let d = sh.arcSweep !== undefined ? sh.arcSweep : ea - sa;
            if (sh.arcSweep === undefined) {
              if (d > Math.PI) d -= Math.PI * 2;
              if (d < -Math.PI) d += Math.PI * 2;
            }
            const handles = [
              { x: sh.x0, y: sh.y0 },
              { x: sh.x1, y: sh.y1 },
              { x: cx0 + rx * Math.cos(sa + d), y: cy0 + ry * Math.sin(sa + d) },
              { x: cx0 + rx * Math.cos(sa + d / 2), y: cy0 + ry * Math.sin(sa + d / 2) },
            ];
            const names: ('center' | 'start' | 'end' | 'radius')[] = ['center', 'start', 'end', 'radius'];
            for (let hi = 0; hi < 4; hi++) {
              if (Math.hypot((p.x - handles[hi].x) * contentW, (p.y - handles[hi].y) * contentH) <= hitPx) {
                anyWhich = names[hi];
                anyIdx = j;
                break;
              }
            }
          } else if (sh.type === 'circleDiameter' || sh.type === 'circleRadius') {
            const distPx = (pt: { x: number; y: number }) =>
              Math.hypot((p.x - pt.x) * contentW, (p.y - pt.y) * contentH);
            if (sh.type === 'circleDiameter') {
              if (distPx({ x: sh.x0, y: sh.y0 }) <= hitPx) { anyWhich = 'p0'; anyIdx = j; }
              else if (distPx({ x: sh.x1, y: sh.y1 }) <= hitPx) { anyWhich = 'p1'; anyIdx = j; }
            } else {
              if (distPx({ x: sh.x0, y: sh.y0 }) <= hitPx) { anyWhich = 'p0'; anyIdx = j; }
              else if (distPx({ x: sh.x1, y: sh.y1 }) <= hitPx) { anyWhich = 'p1'; anyIdx = j; }
            }
          }
          if (anyIdx !== null) break;
        }
        if (anyIdx !== null) {
          const sel = pg[anyIdx];
          setSelectedIdx(anyIdx);
          pushHistory();
          const arcA = contentW / contentH;
          selectDragRef.current = {
            idx: anyIdx,
            mode: 'point',
            corner: 'se',
            which: anyWhich!,
            sx: p.x,
            sy: p.y,
            init: { ...sel },
            initBox: selectBox(sel, contentW / contentH)!,
            lastAngle: anyWhich === 'end' || anyWhich === 'start'
              ? Math.atan2((p.y - sel.y0) / arcA, p.x - sel.x0)
              : undefined,
            totalDelta: 0,
          };
          return;
        }
      }
      if (selectedIdx !== null) {
        const sel = pg[selectedIdx];
        if (sel && (sel.type === 'circleDiameter' || sel.type === 'circleRadius')) {
          // 圆的可调点手柄优先：直径圆两个端点（p0/p1）、半径圆圆心（p0）+ 半径端点（p1）
          // 用实际画布物理尺寸（contentW/contentH）判定（x/y 尺度不同，避免竖直方向命中区域偏差；滚动/缩放时与显示一致）
          const hitPx = 22;
          const distPx = (pt: { x: number; y: number }) =>
            Math.hypot((p.x - pt.x) * contentW, (p.y - pt.y) * contentH);
          if (sel.type === 'circleDiameter') {
            if (distPx({ x: sel.x0, y: sel.y0 }) <= hitPx) pointWhich = 'p0';
            else if (distPx({ x: sel.x1, y: sel.y1 }) <= hitPx) pointWhich = 'p1';
          } else {
            // 半径圆：圆心（p0）+ 半径端点（p1）
            if (distPx({ x: sel.x0, y: sel.y0 }) <= hitPx) pointWhich = 'p0';
            else if (distPx({ x: sel.x1, y: sel.y1 }) <= hitPx) pointWhich = 'p1';
          }
        } else if (sel && sel.type === 'arc' && sel.arcMode === 'three' && sel.points && sel.points.length) {
          // 弧的可调点手柄：圆心（center 平移）、起点（start 调起始角）、终点（end 在弧实际末端调终止角）、半径点（radius 调半径）
          const hitPx = 22;
          const a = contentW / contentH;
          const cx0 = sel.x0, cy0 = sel.y0;
          const dx0 = sel.x1 - cx0, dy0 = sel.y1 - cy0;
          const rx = Math.hypot(dx0, dy0 / a) || 0.0001;
          const ry = rx * a;
          const sa = Math.atan2(dy0 / a, dx0);
          const ea = Math.atan2((sel.points[0].y - cy0) / a, sel.points[0].x - cx0);
          let d = sel.arcSweep !== undefined ? sel.arcSweep : ea - sa;
          if (sel.arcSweep === undefined) {
            if (d > Math.PI) d -= Math.PI * 2;
            if (d < -Math.PI) d += Math.PI * 2;
          }
          const endP = { x: cx0 + rx * Math.cos(sa + d), y: cy0 + ry * Math.sin(sa + d) };
          const radP = { x: cx0 + rx * Math.cos(sa + d / 2), y: cy0 + ry * Math.sin(sa + d / 2) };
          const arcHandles: ('center' | 'start' | 'end' | 'radius')[] = ['center', 'start', 'end', 'radius'];
          const arcPts = [{ x: sel.x0, y: sel.y0 }, { x: sel.x1, y: sel.y1 }, endP, radP];
          for (let hi = 0; hi < 4; hi++) {
            if (Math.hypot((p.x - arcPts[hi].x) * contentW, (p.y - arcPts[hi].y) * contentH) <= hitPx) {
              pointWhich = arcHandles[hi];
              break;
            }
          }
        }
        const box = sel ? selectBox(sel, contentW / contentH) : null;
        if (box) {
          const hitPx = 22;
          for (const c of CORNERS) {
            const cp = cornerPoint(box, c);
            if (Math.hypot((p.x - cp.x) * contentW, (p.y - cp.y) * contentH) <= hitPx) {
              corner = c;
              break;
            }
          }
        }
      }
      if (pointWhich && selectedIdx !== null) {
        const sel = pg[selectedIdx];
        const box = selectBox(sel, contentW / contentH)!;
        pushHistory();
        const arcA = contentW / contentH;
        selectDragRef.current = {
          idx: selectedIdx,
          mode: 'point',
          corner: 'se',
          which: pointWhich,
          sx: p.x,
          sy: p.y,
          init: { ...sel },
          initBox: { ...box },
          lastAngle: pointWhich === 'end' || pointWhich === 'start'
            ? Math.atan2((p.y - sel.y0) / arcA, p.x - sel.x0)
            : undefined,
          totalDelta: 0,
        };
        return;
      }
      if (corner && selectedIdx !== null) {
        const sel = pg[selectedIdx];
        const box = selectBox(sel, contentW / contentH)!;
        pushHistory();
        selectDragRef.current = { idx: selectedIdx, mode: 'resize', corner, sx: p.x, sy: p.y, init: { ...sel }, initBox: { ...box } };
        return;
      }
      let hitIdx: number | null = null;
      // 命中规则：点中图形实际痕迹（描边/笔迹）才选中；文字/图片保留包围盒命中
      const hitR = 22 / Math.max(contentW, contentH);
      for (let i = pg.length - 1; i >= 0; i--) {
        const s = pg[i];
        let hit = false;
        if (s.type === 'text' || s.type === 'image' || s.type === 'penetrate') {
          // 文字/图片：包围盒命中；渗透显示框：区域对象，点击框内任意处即选中
          const box = selectBox(s, contentW / contentH);
          hit = !!(box && p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1);
        } else if (s.type === 'circleDiameter' || s.type === 'circleRadius') {
          // 圆命中：按实际画布物理尺寸（contentW/contentH，滚动/缩放时与显示一致）计算「点到圆心距离 − 半径」之差
          const cx = s.type === 'circleDiameter' ? (s.x0 + s.x1) / 2 : s.x0;
          const cy = s.type === 'circleDiameter' ? (s.y0 + s.y1) / 2 : s.y0;
          const rpx =
            Math.hypot((s.x1 - s.x0) * contentW, (s.y1 - s.y0) * contentH) /
            (s.type === 'circleDiameter' ? 2 : 1);
          const dp = Math.hypot((p.x - cx) * contentW, (p.y - cy) * contentH);
          // 命中：只有对准圆周附近才能选中（22px 物理带宽）
          if (Math.abs(dp - rpx) < 22) hit = true;
        } else {
          const outline = s.type === 'arc' ? arcOutline(s, contentW / contentH) : shapeOutline(s);
          for (let k = 1; k < outline.length; k++) {
            const a = outline[k - 1];
            const b = outline[k];
            if (distSeg(p.x, p.y, a.x, a.y, b.x, b.y) < hitR) {
              hit = true;
              break;
            }
          }
        }
        if (hit) {
          hitIdx = i;
          break;
        }
      }
      if (hitIdx !== null) {
        const sel = pg[hitIdx];
        const box = selectBox(sel, contentW / contentH)!;
        if (selectedIdx !== hitIdx) setSelectedIdx(hitIdx);
        pushHistory();
        selectDragRef.current = { idx: hitIdx, mode: 'move', corner: 'se', sx: p.x, sy: p.y, init: { ...sel }, initBox: { ...box } };
      } else {
        setSelectedIdx(null);
      }
      return;
    }
    if (tool === 'arc') {
      // 三点弧：①定圆心 → ②定起点 → ③拖动预览后确认终点
      const ph = arcPhaseRef.current;
      if (ph === 0) {
        const nd = {
          type: 'arc' as const,
          color,
          size: penSize,
          lineStyle,
          x0: p.x,
          y0: p.y,
          x1: p.x,
          y1: p.y,
          points: [],
          arcMode: 'three' as const,
        };
        draftRef.current = nd;
        setDraft(nd);
        arcPhaseRef.current = 1;
      } else if (ph === 1) {
        const prev = draftRef.current;
        if (prev && prev.type === 'arc') {
          const nd2 = { ...prev, x1: p.x, y1: p.y, points: [], auxLine: true };
          draftRef.current = nd2;
          setDraft(nd2);
          // 起点确定：记录起始物理角，累积扫过角清零（后续拖动按鼠标路径累积，支持 >180° 弧）
          const a = contentW / contentH;
          arcAngleRef.current = { last: Math.atan2((p.y - prev.y0) / a, p.x - prev.x0), total: 0 };
        }
        arcPhaseRef.current = 2;
      } else {
        // 确认终点：提交已预览的弧（去除辅助虚线标记）
        const raw = draftRef.current;
        if (raw && raw.points && raw.points.length) {
          const cur = { ...raw, auxLine: false } as IShape;
          pushHistory();
          setPages((prev) => {
            const list =
              currentPage >= prev.length
                ? [...prev, ...Array.from({ length: currentPage - prev.length + 1 }, () => [] as IShape[])]
                : prev;
            return list.map((pg, i) => (i === currentPage ? [...pg, cur] : pg));
          });
        }
        setDraft(null);
        draftRef.current = null;
        arcPhaseRef.current = 0;
      }
      return;
    }
    if (tool === 'text') {
      // 拖拽出虚线矩形定义文字区域
      setDraft({
        type: 'text',
        color,
        size: penSize,
        lineStyle,
        x0: p.x,
        y0: p.y,
        x1: p.x,
        y1: p.y,
        points: [],
      });
      return;
    }
    if (tool === 'image') {
      imagePosRef.current = p;
      fileRef.current?.click();
      return;
    }
    if (tool === 'eraser') {
      pushHistory();
      const r = eraserRadius(contentW);
      const pts = [p];
      setEraserPath(pts);
      eraseAt(pts, currentPage, r);
      return;
    }
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      // 部分合成/受限输入环境无活跃指针，忽略捕获失败，拖拽仍可用
    }
    setDraft({
      type: tool,
      color,
      size: penSize,
      lineStyle,
      x0: p.x,
      y0: p.y,
      x1: p.x,
      y1: p.y,
      points: tool === 'pencil' ? [p] : [],
    });
  };

  const handleMove = (e: React.PointerEvent) => {
    const p = toNorm(e);
    if (tool === 'select') {
      const dr = selectDragRef.current;
      if (!dr) return;
      const idx = dr.idx;
      if (dr.mode === 'point') {
        // 点手柄：圆的端点/圆心调节 + 弧的圆心/起点/终点调节
        // 弧的起点/终点手柄：先在 updater 外累积鼠标角度增量（updater 可能重复执行，必须在外部改 dr 累积状态）
        let arcTotal = 0;
        if (dr.which === 'start' || dr.which === 'end') {
          const a = contentW / contentH;
          const cx0 = dr.init.x0, cy0 = dr.init.y0;
          const newA = Math.atan2((p.y - cy0) / a, p.x - cx0);
          let delta = newA - (dr.lastAngle ?? newA);
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          dr.totalDelta = (dr.totalDelta ?? 0) + delta;
          dr.lastAngle = newA;
          arcTotal = dr.totalDelta;
        }
        setPages((prev) =>
          prev.map((pg, i) => {
            if (i !== currentPage) return pg;
            return pg.map((s, j) => {
              if (j !== idx) return s;
              if (dr.which === 'center') {
                // 只改变圆心位置：起点/终点绝对坐标保持不变，弧的半径/起止角随圆心重新计算（弧度变化）
                const dx = p.x - dr.sx;
                const dy = p.y - dr.sy;
                const init = dr.init;
                return { ...s, x0: init.x0 + dx, y0: init.y0 + dy };
              }
              if (dr.which === 'start') {
                // 弧起点：按鼠标路径累积起始角（可 >180°），半径不变、扫过角不变（弧整体旋转，终点跟随）
                const a = contentW / contentH;
                const cx0 = s.x0, cy0 = s.y0;
                const initStart = dr.init;
                const dx0 = initStart.x1 - cx0, dy0 = initStart.y1 - cy0;
                const rx = Math.hypot(dx0, dy0 / a) || 0.0001;
                const ry = rx * a;
                const baseSa = Math.atan2(dy0 / a, dx0);
                const sa = baseSa + arcTotal;
                // 扫过角保持（原 arcSweep，旧数据按投影角差规约）
                const initEnd = initStart.points?.[0];
                const initEa = initEnd ? Math.atan2((initEnd.y - cy0) / a, initEnd.x - cx0) : baseSa;
                let sweep = initStart.arcSweep !== undefined ? initStart.arcSweep : initEa - baseSa;
                if (initStart.arcSweep === undefined) {
                  if (sweep > Math.PI) sweep -= Math.PI * 2;
                  if (sweep < -Math.PI) sweep += Math.PI * 2;
                }
                return {
                  ...s,
                  x1: cx0 + rx * Math.cos(sa),
                  y1: cy0 + ry * Math.sin(sa),
                  points: [{ x: cx0 + rx * Math.cos(sa + sweep), y: cy0 + ry * Math.sin(sa + sweep) }],
                  arcSweep: sweep,
                };
              }
              if (dr.which === 'end') {
                // 弧终点（在弧实际末端）：按鼠标路径累积终止角（可 >180°），半径不变（起点 x1/y1 不动）
                const a = contentW / contentH;
                const cx0 = s.x0, cy0 = s.y0;
                const initStart = dr.init;
                const dx0 = initStart.x1 - cx0, dy0 = initStart.y1 - cy0;
                const rx = Math.hypot(dx0, dy0 / a) || 0.0001;
                const ry = rx * a;
                const sa = Math.atan2(dy0 / a, dx0);
                // 原扫过角（arcSweep 优先，旧数据规约投影角差）
                const initEnd = initStart.points?.[0];
                const initEa = initEnd ? Math.atan2((initEnd.y - cy0) / a, initEnd.x - cx0) : sa;
                let initSweep = initStart.arcSweep !== undefined ? initStart.arcSweep : initEa - sa;
                if (initStart.arcSweep === undefined) {
                  if (initSweep > Math.PI) initSweep -= Math.PI * 2;
                  if (initSweep < -Math.PI) initSweep += Math.PI * 2;
                }
                const sweep = initSweep + arcTotal;
                return {
                  ...s,
                  points: [{ x: cx0 + rx * Math.cos(sa + sweep), y: cy0 + ry * Math.sin(sa + sweep) }],
                  arcSweep: sweep,
                };
              }
              if (dr.which === 'radius') {
                // 弧半径点：调半径（起止角绝对角保持，起点/终点重投影到新半径）
                const a = contentW / contentH;
                const cx0 = s.x0, cy0 = s.y0;
                const dxn = p.x - cx0, dyn = p.y - cy0;
                const rx = Math.hypot(dxn, dyn / a) || 0.0001;
                const ry = rx * a;
                const init = dr.init;
                const dx0 = init.x1 - cx0, dy0 = init.y1 - cy0;
                const sa = Math.atan2(dy0 / a, dx0);
                const initEnd = init.points?.[0];
                const ea = initEnd ? Math.atan2((initEnd.y - cy0) / a, initEnd.x - cx0) : sa;
                return {
                  ...s,
                  x1: cx0 + rx * Math.cos(sa),
                  y1: cy0 + ry * Math.sin(sa),
                  points: [{ x: cx0 + rx * Math.cos(ea), y: cy0 + ry * Math.sin(ea) }],
                };
              }
              if (dr.which === 'p0') return { ...s, x0: p.x, y0: p.y };
              return { ...s, x1: p.x, y1: p.y };
            });
          }),
        );
        return;
      }
      if (dr.mode === 'move') {
        const dx = p.x - dr.sx;
        const dy = p.y - dr.sy;
        // 基于按下时的初始快照做绝对偏移（避免连续 move 累加导致元素飞走）
        const init = dr.init;
        // 移动确认文字：同步 textarea（确认后文字只由 textarea 显示，位置需随 shape 一起移动）
        if (init.type === 'text' && textCommitted) {
          setTextBox((tb) =>
            tb
              ? {
                  x0: init.x0 + dx,
                  y0: init.y0 + dy,
                  x1: init.x1 + dx,
                  y1: init.y1 + dy,
                }
              : tb,
          );
        }
        setPages((prev) =>
          prev.map((pg, i) => {
            if (i !== currentPage) return pg;
            return pg.map((s, j) => {
              if (j !== idx) return s;
              // 移动：x0/x1 偏移 + points（弧线/铅笔等）同步偏移
              const moved: IShape = {
                ...s,
                x0: init.x0 + dx,
                y0: init.y0 + dy,
                x1: init.x1 + dx,
                y1: init.y1 + dy,
              };
              const basePts = init.points ?? s.points;
              if (basePts && basePts.length) {
                moved.points = basePts.map((pt) => ({ x: pt.x + dx, y: pt.y + dy }));
              }
              return moved;
            });
          }),
        );
      } else {
        // 缩放：对角固定，按拖动距离比例
        const opp = oppositeCorner(dr.corner);
        const op = cornerPoint(dr.initBox, opp);
        // 缩放确认文字：同步 textarea 框（与 setPages 内 text 分支计算一致：选中角跟随光标、对角固定、字号不变）
        if (dr.init.type === 'text' && textCommitted) {
          const isL = dr.corner === 'nw' || dr.corner === 'sw';
          const isT = dr.corner === 'nw' || dr.corner === 'ne';
          const nw = isL ? Math.max(0.02, op.x - p.x) : Math.max(0.02, p.x - op.x);
          const nh = isT ? Math.max(0.02, op.y - p.y) : Math.max(0.02, p.y - op.y);
          const nx = isL ? op.x - nw : op.x;
          const ny = isT ? op.y - nh : op.y;
          setTextBox((tb) => (tb ? { x0: nx, y0: ny, x1: nx + nw, y1: ny + nh } : tb));
        }
        const initCorner = cornerPoint(dr.initBox, dr.corner);
        const initDist = Math.max(0.0001, Math.hypot(initCorner.x - op.x, initCorner.y - op.y));
        const newDist = Math.max(0.0001, Math.hypot(p.x - op.x, p.y - op.y));
        const k = newDist / initDist;
        setPages((prev) =>
          prev.map((pg, i) => {
            if (i !== currentPage) return pg;
            return pg.map((s, j) => {
              if (j !== idx) return s;
              if (s.type === 'image') {
                const iw = dr.initBox.x1 - dr.initBox.x0;
                const ih = dr.initBox.y1 - dr.initBox.y0;
                const nw = Math.max(0.03, iw * k);
                const nh = Math.max(0.02, ih * k);
                const nx = dr.corner === 'nw' || dr.corner === 'sw' ? op.x - nw : op.x;
                const ny = dr.corner === 'nw' || dr.corner === 'ne' ? op.y - nh : op.y;
                return { ...s, x0: nx, y0: ny, x1: nx + nw, y1: ny + nh };
              }
              if (s.type === 'text') {
                // 拖动角只调整文字框区域：选中角直接跟随光标（对角固定），字号保持不变
                const minW = 0.02;
                const minH = 0.02;
                const isL = dr.corner === 'nw' || dr.corner === 'sw';
                const isT = dr.corner === 'nw' || dr.corner === 'ne';
                const nw = isL ? Math.max(minW, op.x - p.x) : Math.max(minW, p.x - op.x);
                const nh = isT ? Math.max(minH, op.y - p.y) : Math.max(minH, p.y - op.y);
                const nx = isL ? op.x - nw : op.x;
                const ny = isT ? op.y - nh : op.y;
                return { ...s, x0: nx, y0: ny, x1: nx + nw, y1: ny + nh };
              }
              // 直线/圆/椭圆/矩形/弧线/箭头/铅笔等：拖动角直接跟随光标（对角固定），
              // 坐标与 points 用按下时的初始快照相对框映射（避免连续 move 用当前值混合旧框导致漂移）
              const initBox = dr.initBox;
              const iw = Math.max(0.0001, initBox.x1 - initBox.x0);
              const ih = Math.max(0.0001, initBox.y1 - initBox.y0);
              const isL = dr.corner === 'nw' || dr.corner === 'sw';
              const isT = dr.corner === 'nw' || dr.corner === 'ne';
              const nw = isL ? Math.max(0.005, op.x - p.x) : Math.max(0.005, p.x - op.x);
              const nh = isT ? Math.max(0.005, op.y - p.y) : Math.max(0.005, p.y - op.y);
              const nxx = isL ? op.x - nw : op.x;
              const nyy = isT ? op.y - nh : op.y;
              const mapPt = (pt: { x: number; y: number }) => ({
                x: nxx + ((pt.x - initBox.x0) / iw) * nw,
                y: nyy + ((pt.y - initBox.y0) / ih) * nh,
              });
              const initS = dr.init;
              const p0 = mapPt({ x: initS.x0, y: initS.y0 });
              const p1 = mapPt({ x: initS.x1, y: initS.y1 });
              const nextS: IShape = { ...s, x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y };
              const basePts = initS.points;
              if (basePts && basePts.length) {
                nextS.points = basePts.map(mapPt);
              }
              return nextS;
            });
          }),
        );
      }
      return;
    }
    if (tool === 'image') return;
    if (tool === 'eraser') {
      if (!eraserPath) return;
      const pts = [...eraserPath, p];
      setEraserPath(pts);
      eraseAt(pts, currentPage, eraserRadius(contentW));
      return;
    }
    if (tool === 'arc' && arcPhaseRef.current === 2) {
      // 三点弧：终点跟随鼠标（按鼠标路径累积扫过角，可 >180°），显示圆心→终点虚线
      const prevA = draftRef.current;
      if (!prevA || prevA.type !== 'arc') return;
      const cx = prevA.x0;
      const cy = prevA.y0;
      const ax = prevA.x1;
      const ay = prevA.y1;
      const a = contentW / contentH;
      const rx = Math.hypot(ax - cx, (ay - cy) / a) || 0.0001;
      const ry = rx * a;
      const sa = Math.atan2((ay - cy) / a, ax - cx);
      // 鼠标路径累积：当前物理角 - 上一物理角（取最短增量），累加到 total
      const newA = Math.atan2((p.y - cy) / a, p.x - cx);
      let delta = newA - arcAngleRef.current.last;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      arcAngleRef.current.total += delta;
      arcAngleRef.current.last = newA;
      const total = arcAngleRef.current.total;
      // 终点投影到圆上（归一化椭圆 = 物理正圆，与最终绘制一致）
      const bx = cx + rx * Math.cos(sa + total);
      const by = cy + ry * Math.sin(sa + total);
      const nd = { ...prevA, points: [{ x: bx, y: by }], auxLine: true, arcSweep: total };
      draftRef.current = nd;
      setDraft(nd);
      return;
    }
    if (tool === 'arc' && arcPhaseRef.current === 1) {
      // 指定起点阶段：圆心 → 鼠标 直虚线预览
      const prevB = draftRef.current;
      if (!prevB || prevB.type !== 'arc') return;
      const nd2 = { ...prevB, x1: p.x, y1: p.y, points: [], auxLine: true };
      draftRef.current = nd2;
      setDraft(nd2);
      return;
    }
    if (!draft) return;
    setDraft((prev) => {
      if (!prev) return prev;
      if (prev.type === 'pencil') return { ...prev, points: [...prev.points, p] };
      if (prev.type === 'arc' && prev.arcMode !== 'three') {
        // 旧式曲线（兼容）：控制点 = 中点 + 鼠标垂向偏移
        const ax = prev.x0;
        const ay = prev.y0;
        const bx = p.x;
        const by = p.y;
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy) || 0.0001;
        const ux = dx / len;
        const uy = dy / len;
        const relx = p.x - mx;
        const rely = p.y - my;
        const perp = relx * uy - rely * ux;
        const maxOff = len * 0.6;
        const off = Math.max(-maxOff, Math.min(maxOff, perp * 0.8));
        return { ...prev, x1: p.x, y1: p.y, points: [{ x: mx - off * uy, y: my + off * ux }] };
      }
      return { ...prev, x1: p.x, y1: p.y };
    });
  };

  const handleUp = () => {
    if (tool === 'select') {
      selectDragRef.current = null;
      return;
    }
    if (tool === 'arc') {
      // 三点弧：不在松开时提交，等待第三次按下确认终点
      return;
    }
    if (tool === 'text') {
      // 拖拽结束：确定文字区域矩形 → 显示输入框
      if (draft && draft.type === 'text') {
        const bx = {
          x0: Math.min(draft.x0, draft.x1),
          y0: Math.min(draft.y0, draft.y1),
          x1: Math.max(draft.x0, draft.x1),
          y1: Math.max(draft.y0, draft.y1),
        };
        if (bx.x1 - bx.x0 > 0.005 && bx.y1 - bx.y0 > 0.005) {
          setTextBox(bx);
          setTextValue('');
          setCaretPos(null);
          setTextCommitted(false);
        }
      }
      setDraft(null);
      return;
    }
    if (tool === 'eraser') {
      setEraserPath(null);
      return;
    }
    if (!draft) return;
    if (draft.type === 'boxDelete') {
      // 框选删除：只删除框选区域内的部分（沿线细分，框内段删除、框外保留），图片/文字不可删除
      pushHistory();
      const box = { x0: Math.min(draft.x0, draft.x1), y0: Math.min(draft.y0, draft.y1), x1: Math.max(draft.x0, draft.x1), y1: Math.max(draft.y0, draft.y1) };
      setPages((prev) =>
        prev.map((pg, i) => {
          if (i !== currentPage) return pg;
          const next: IShape[] = [];
          for (const s of pg) {
            // 图片与文字：框选不可删除
            if (s.type === 'image' || s.type === 'text') {
              next.push(s);
              continue;
            }
            // 渗透显示框：区域对象，框选区域命中其包围盒 → 整个删除（不切残段）
            if (s.type === 'penetrate') {
              const pbx0 = Math.min(s.x0, s.x1), pbx1 = Math.max(s.x0, s.x1);
              const pby0 = Math.min(s.y0, s.y1), pby1 = Math.max(s.y0, s.y1);
              const overlaps =
                pbx0 <= box.x1 && pbx1 >= box.x0 && pby0 <= box.y1 && pby1 >= box.y0;
              if (overlaps) continue; // 删除
              next.push(s);
              continue;
            }
            if (s.type === 'coords') {
              // 坐标图：独立线段组框选删除（框内段删除、框外保留、丢弃短残段），避免碎线
              const step = 0.008;
              const inBox2 = (pt: { x: number; y: number }) =>
                pt.x >= box.x0 && pt.x <= box.x1 && pt.y >= box.y0 && pt.y <= box.y1;
              const lines = coordsLines(s);
              const outShapes: IShape[] = [];
              let changed = false;
              for (const ln of lines) {
                const a = ln.a, b = ln.b;
                const len = Math.hypot(b.x - a.x, b.y - a.y);
                if (len < 1e-6) continue;
                const n = Math.ceil(len / step);
                const detailed: { x: number; y: number }[] = [];
                for (let k = 0; k <= n; k++)
                  detailed.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
                const segs2: { x: number; y: number }[][] = [];
                let cur: { x: number; y: number }[] = [detailed[0]];
                let lineHit = false;
                for (let k = 1; k < detailed.length; k++) {
                  const p1 = detailed[k - 1], p2 = detailed[k];
                  const hit = inBox2(p1) && inBox2(p2);
                  if (hit) lineHit = true;
                  if (!hit) {
                    cur.push(p2);
                  } else {
                    if (cur.length >= 2) segs2.push(cur);
                    cur = [p2];
                  }
                }
                if (cur.length >= 2) segs2.push(cur);
                if (!lineHit) {
                  outShapes.push({
                    ...s, type: 'pencil', points: [a, b], arcMode: undefined, auxLine: undefined, text: undefined,
                    imageUrl: undefined, imgW: undefined, imgH: undefined, fontFamily: undefined, fontSize: undefined,
                  });
                  continue;
                }
                changed = true;
                for (const sp of segs2) {
                  let sLen = 0;
                  for (let i = 1; i < sp.length; i++) sLen += Math.hypot(sp[i].x - sp[i - 1].x, sp[i].y - sp[i - 1].y);
                  if (sLen < step * 1.5) continue; // 丢弃极短残段，避免碎片
                  outShapes.push({
                    ...s, type: 'pencil', points: sp, arcMode: undefined, auxLine: undefined, text: undefined,
                    imageUrl: undefined, imgW: undefined, imgH: undefined, fontFamily: undefined, fontSize: undefined,
                  });
                }
              }
              if (!changed) next.push(s);
              else next.push(...outShapes);
              continue;
            }
            const outline = s.type === 'arc' ? arcOutline(s, contentW / contentH) : shapeOutline(s, contentW / contentH);
            if (outline.length < 2) {
              next.push(s);
              continue;
            }
            // 沿线细分（粒度 ≤ 橡皮方块），逐小段判断：段完全在框内 → 删除，其余保留为多个子笔画
            const step = 0.008;
            const subdiv = (a: { x: number; y: number }, b: { x: number; y: number }) => {
              const len = Math.hypot(b.x - a.x, b.y - a.y);
              if (len <= step) return [a, b];
              const n = Math.ceil(len / step);
              const out: { x: number; y: number }[] = [];
              for (let k = 0; k <= n; k++)
                out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
              return out;
            };
            const detailed: { x: number; y: number }[] = [outline[0]];
            for (let k = 1; k < outline.length; k++) {
              const sub = subdiv(outline[k - 1], outline[k]);
              for (let j = 1; j < sub.length; j++) detailed.push(sub[j]);
            }
            const inBox = (pt: { x: number; y: number }) =>
              pt.x >= box.x0 && pt.x <= box.x1 && pt.y >= box.y0 && pt.y <= box.y1;
            const segs: { x: number; y: number }[][] = [];
            let cur: { x: number; y: number }[] = [detailed[0]];
            for (let k = 1; k < detailed.length; k++) {
              const a = detailed[k - 1];
              const b = detailed[k];
              const hit = inBox(a) && inBox(b);
              if (!hit) {
                cur.push(b);
              } else {
                if (cur.length >= 2) segs.push(cur);
                cur = [b];
              }
            }
            if (cur.length >= 2) segs.push(cur);
            if (segs.length === 0) continue; // 全部在框内 → 删除
            if (segs.length === 1 && segs[0].length === detailed.length) {
              next.push(s); // 完全在框外 → 原样保留
              continue;
            }
            // 框内段被删除 → 剩余段保存为铅笔子笔画（颜色/线宽继承）
            for (const sp of segs) {
              next.push({
                ...s,
                type: 'pencil',
                points: sp,
                arcMode: undefined,
                auxLine: undefined,
                text: undefined,
                imageUrl: undefined,
                imgW: undefined,
                imgH: undefined,
                fontFamily: undefined,
                fontSize: undefined,
              });
            }
          }
          return next;
        }),
      );
      setDraft(null);
      return;
    }
    pushHistory();
    setPages((prev) => {
      // 课件页数可能超过默认 10 页，动态扩展
      const list =
        currentPage >= prev.length
          ? [...prev, ...Array.from({ length: currentPage - prev.length + 1 }, () => [] as IShape[])]
          : prev;
      return list.map((pg, i) => (i === currentPage ? [...pg, draft] : pg));
    });
    setDraft(null);
  };

  const commitText = () => {
    if (textCommitted || !textBox) return; // 已确认/无输入框时不重复提交
    // 从 DOM 直接读值（规避 state 异步延迟导致提交时读到旧值）
    const domVal = textInputRef.current?.value ?? '';
    const v = domVal.trim() || textValue.trim();
    if (textBox && v) {
      pushHistory();
      // 按与 drawShape 一致的 measureText 换行算法，计算文字实际渲染行数
      let nLines = 1;      try {
        const tmp = document.createElement('canvas').getContext('2d');
        if (tmp) {
          const fsPx = Math.max(1, textSize * imgH);
          tmp.font = `${fsPx}px ${fontFamily}`;
          const maxW = Math.max(1, (textBox.x1 - textBox.x0) * imgW);
          let lineW = 0;
          nLines = 1;
          for (const ch of v) {
            if (ch === '\n') {
              nLines += 1;
              lineW = 0;
              continue;
            }
            const cw = tmp.measureText(ch).width;
            lineW += cw;
            if (lineW > maxW) {
              nLines += 1;
              lineW = cw;
            }
          }
        }
      } catch {
        /* 测量失败时按单行处理 */
      }
      const newY1 = textBox.y0 + textSize * 1.15 * nLines + textSize * 0.2;
      const s: IShape = {
        type: 'text',
        color,
        size: penSize,
        lineStyle,
        x0: textBox.x0,
        y0: textBox.y0,
        x1: textBox.x1,
        y1: Math.max(textBox.y1, newY1),
        points: [],
        text: v,
        fontFamily,
        fontSize: textSize,
      };
      setPages((prev) => {
        const list =
          currentPage >= prev.length
            ? [...prev, ...Array.from({ length: currentPage - prev.length + 1 }, () => [] as IShape[])]
            : prev;
        return list.map((pg, i) => (i === currentPage ? [...pg, s] : pg));
      });
      // 确认后：文字保持 textarea 显示（位置与输入时一致），去掉光标；canvas 不再重画
      setCaretPos(null);
      setTextCommitted(true);
      return;
    }
    setTextBox(null);
    setTextValue('');
    setTextCommitted(false);
  };

  // 翻页/切换课件：文字输入与确认静态层一并清除
  useEffect(() => {
    setTextCommitted(false);
    setTextBox(null);
    setTextValue('');
    setCaretPos(null);
  }, [currentPage]);

  // 文字输入框：出现时强制聚焦（WebView2 下 autoFocus 不可靠，多保险）
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const focusTimer = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (textBox) {
      const doFocus = () => textInputRef.current?.focus();
      doFocus();
      const id1 = window.setTimeout(doFocus, 60);
      const id2 = window.setTimeout(doFocus, 300);
      const id3 = window.requestAnimationFrame(doFocus);
      focusTimer.current = id2;
      return () => {
        window.clearTimeout(id1);
        window.clearTimeout(id2);
        window.cancelAnimationFrame(id3);
      };
    }
    return undefined;
  }, [textBox]);

  /** 图片工具：选本地图片插入到点击位置 */
  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const pos = imagePosRef.current;
    if (!file || !pos) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      imageCache.set(url, img);
      pushHistory();
      // 实际渲染尺寸：宽 0.28 画布宽，高按原图宽高比（归一化坐标写入 x1/y1）
      const ar = contentW / contentH;
      const iw = 0.28;
      const ih = iw * (img.naturalHeight / img.naturalWidth) * ar;
      const s: IShape = {
        type: 'image',
        color,
        size: penSize,
        lineStyle,
        x0: pos.x,
        y0: pos.y,
        x1: pos.x + iw,
        y1: pos.y + ih,
        points: [],
        imageUrl: url,
        imgW: img.naturalWidth,
        imgH: img.naturalHeight,
      };
      setPages((prev) => {
        const list =
          currentPage >= prev.length
            ? [...prev, ...Array.from({ length: currentPage - prev.length + 1 }, () => [] as IShape[])]
            : prev;
        return list.map((pg, i) => (i === currentPage ? [...pg, s] : pg));
      });
    };
    img.src = url;
  };

  const eraserSvgCursor = useMemo(() => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26"><rect x="4" y="4" width="18" height="18" rx="2" fill="rgba(255,255,255,0.85)" stroke="#333" stroke-width="1.5"/><rect x="9" y="9" width="8" height="8" rx="1" fill="#e03535"/></svg>`;
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") 13 13, crosshair`;
  }, []);

  // 画笔笔形光标：黑色外轮廓 + 白色内描边 + 深灰填充 + 白色笔尖（任何背景均清晰），热点在笔尖
  const penSvgCursor = useMemo(() => {
    const d = 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24"><path d="${d}" fill="#374151" stroke="#000000" stroke-width="3"/><path d="${d}" fill="none" stroke="#ffffff" stroke-width="1.2"/><circle cx="3.2" cy="20.6" r="1.6" fill="#ffffff"/></svg>`;
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") 3 21, crosshair`;
  }, []);

  /** 各工具光标：铅笔=笔形、橡皮=橡皮、鼠标=默认，其余工具统一十字 */
  const toolCursor = useMemo(() => {
    switch (tool) {
      case 'select':
        return 'default';
      case 'eraser':
        return eraserSvgCursor;
      case 'pencil':
        return penSvgCursor;
      default:
        return 'crosshair';
    }
  }, [tool, eraserSvgCursor, penSvgCursor]);

  const updateCaret = () => {
    if (textCommitted) {
      // 已确认：不显示光标（readOnly 文本框点击/选择也会触发此函数）
      setCaretPos(null);
      return;
    }
    const el = textInputRef.current;
    if (!el || !textBox) return;
    const v = el.value;
    const pos = el.selectionStart ?? v.length;
    const fsPx = Math.max(12, Math.round(textSize * imgH));
    const maxW = Math.max(1, (textBox.x1 - textBox.x0) * imgW);
    let line = 0;
    let colW = 0;
    try {
      const tmp = document.createElement('canvas').getContext('2d');
      if (tmp) tmp.font = `${fsPx}px ${fontFamily || 'Microsoft YaHei'}`;
      for (let i = 0; i < pos; i++) {
        const ch = v[i];
        if (ch === '\n') {
          line += 1;
          colW = 0;
          continue;
        }
        const cw = tmp ? tmp.measureText(ch).width : fsPx;
        colW += cw;
        if (colW > maxW) {
          line += 1;
          colW = cw;
        }
      }
    } catch {
      /* 测量失败时按首行处理 */
    }
    setCaretPos({ x: colW, y: line });
  };

  return (
    // 根背景：占位区背景色（课堂占位区深灰 #3a3a3a；独立黑板窗口纯黑 #000，由 prop boardBackground 区分）；
    // 覆盖书写模式（课件书写层）根背景透明，让下方课件透出
    <div className="flex h-full flex-col" style={{ background: overlayMode ? 'transparent' : boardBackground }}>
      <style>{`@keyframes skeyCaretBlink{0%,49%{opacity:1}50%,100%{opacity:0}}`}</style>
      <div
        ref={wrapRef}
        className={cn(
          'relative flex-1 list-scroll',
          // 独立黑板窗口（无容器）：课件高度溢出由外层纵向滚动查看；浏览器模式滚动在固定 878:494 容器内；
          // 覆盖书写模式：无滚动
          overlayMode ? 'overflow-hidden' : hasBg && !fitContainer ? 'overflow-x-hidden overflow-y-auto' : 'overflow-hidden',
        )}
      >
        {/* 画布容器：固定 878:494（hasBg+fitContainer），canvas 在其内水平填充、高度按图片比例溢出 → 容器自身纵向滚动；其余情况 = 画布本身居中 */}
        <div className="flex h-full min-w-full">
          <div
            className={cn(
              'relative',
              // 浏览器模式（fitContainer）：flex + m-auto 使画布在固定容器内居中（不超时居中、超高时顶部对齐滚动，用户确认正常）；
              // 独立黑板窗口（fitContainer=false）：画布容器 m-auto 居中于窗口（小图片居中显示，超高时顶部对齐滚动查看）
              fitContainer ? 'm-auto flex' : 'm-auto',
              hasBg && fitContainer ? 'overflow-y-auto overflow-x-hidden bg-white' : 'overflow-hidden',
            )}
            style={{ width: boxW, height: boxH }}
          >
            {/* 画布定位层 = canvas 尺寸：浏览器模式在固定 878:494 容器内水平垂直居中（缩放后小于容器时图片居中显示）；
                超出容器时 auto margin 归零 → 顶部对齐、底部由容器纵向滚动查看（内容/文字/光标相对此层定位）；
                独立黑板窗口（fitContainer=false）无容器——此层即画布本身，直接填满窗口 */}
            <div className="relative m-auto" style={{ width: contentW, height: contentH }}>
              <canvas
                ref={canvasRef}
                width={contentW}
                height={contentH}
                className="block touch-none"
                style={{ cursor: toolCursor }}
                onPointerDown={handleDown}
                onPointerMove={handleMove}
                onPointerUp={handleUp}
                onPointerLeave={handleUp}
              />
            {/* 渗透显示：当前页渗透框 + 拖拽中的草稿 —— 框内透出下一页课件对应位置（下一页图拉伸铺满画布尺寸，严格坐标对应）；无下一页时只显示边框 */}
            {(pages[currentPage] ?? []).map((s, idx) =>
              s.type !== 'penetrate'
                ? null
                : (() => {
                      const px0 = Math.min(s.x0, s.x1) * contentW;
                      const py0 = Math.min(s.y0, s.y1) * contentH;
                      const pw = Math.abs(s.x1 - s.x0) * contentW;
                      const ph = Math.abs(s.y1 - s.y0) * contentH;
                      if (pw < 1 || ph < 1) return null;
                      const sel = selectedIdx === idx;
                      // 四角手柄：相对渗透框 div 的坐标（0,0 左上 → pw,ph 右下），渲染在框内不被 overflow 裁剪
                      const corners: { x: number; y: number }[] = sel
                        ? [
                            { x: 0, y: 0 },
                            { x: pw, y: 0 },
                            { x: pw, y: ph },
                            { x: 0, y: ph },
                          ]
                        : [];
                      return (
                        <div
                          key={idx}
                          style={{
                            position: 'absolute',
                            left: px0,
                            top: py0,
                            width: pw,
                            height: ph,
                            overflow: 'hidden',
                            // 确认后无边框（只显示框内透出的下一页内容）；选中显示蓝色虚线高亮包围盒
                            border: sel ? '1.5px dashed #1677ff' : 'none',
                            boxSizing: 'border-box',
                            pointerEvents: 'none',
                            zIndex: sel ? 4 : 5,
                          }}
                        >
                          <div
                            style={{
                              position: 'absolute',
                              left: -px0,
                              top: -py0,
                              width: contentW,
                              height: contentH,
                              backgroundImage: penetrateNextUrl ? `url(${penetrateNextUrl})` : undefined,
                              backgroundSize: `${contentW}px ${contentH}px`,
                              backgroundRepeat: 'no-repeat',
                              // 内容层低于边框层（选中虚线边框/手柄始终显示在下一页内容之上）
                              zIndex: 1,
                            }}
                          />
                          {/* 选中：四角缩放手柄（白底蓝框小方块） */}
                          {sel &&
                            corners.map((c, ci) => (
                              <div
                                key={ci}
                                style={{
                                  position: 'absolute',
                                  left: c.x - 6,
                                  top: c.y - 6,
                                  width: 12,
                                  height: 12,
                                  background: '#fff',
                                  border: '1.5px solid #1677ff',
                                  boxSizing: 'border-box',
                                }}
                              />
                            ))}
                        </div>
                      );
                    })(),
              )}
            {draft && draft.type === 'penetrate' && (() => {
              const px0 = Math.min(draft.x0, draft.x1) * contentW;
              const py0 = Math.min(draft.y0, draft.y1) * contentH;
              const pw = Math.abs(draft.x1 - draft.x0) * contentW;
              const ph = Math.abs(draft.y1 - draft.y0) * contentH;
              if (pw < 1 || ph < 1) return null;
              return (
                <div
                  key="pen-draft"
                  style={{
                    position: 'absolute',
                    left: px0,
                    top: py0,
                    width: pw,
                    height: ph,
                    overflow: 'hidden',
                    pointerEvents: 'none',
                    zIndex: 5,
                  }}
                >
                  {/* 拖动时：黑白相间虚线框（黑虚线外层 + 白虚线内层错开）——置于内容层之上，不被下一页预览覆盖 */}
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      width: pw,
                      height: ph,
                      border: '2px dashed #000',
                      boxSizing: 'border-box',
                      zIndex: 3,
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      left: 1,
                      top: 1,
                      width: pw - 2,
                      height: ph - 2,
                      border: '2px dashed #fff',
                      boxSizing: 'border-box',
                      zIndex: 3,
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      left: -px0,
                      top: -py0,
                      width: contentW,
                      height: contentH,
                      backgroundImage: penetrateNextUrl ? `url(${penetrateNextUrl})` : undefined,
                      backgroundSize: `${contentW}px ${contentH}px`,
                      backgroundRepeat: 'no-repeat',
                      zIndex: 1,
                    }}
                  />
                </div>
              );
            })()}
            {textBox && (
              <textarea
                ref={textInputRef}
                autoFocus                className="absolute resize-none overflow-hidden border-0 bg-transparent outline-none"
                readOnly={textCommitted}
                style={{
                  left: `calc(${((imgDx + textBox.x0 * imgW) / (contentW || 1)) * 100}% + 3px)`,
                  top: `calc(${((imgDy + textBox.y0 * imgH) / (contentH || 1)) * 100}% + 3px)`,
                  width: `${((textBox.x1 - textBox.x0) * imgW) / (contentW || 1) * 100}%`,
                  minHeight: `${((textBox.y1 - textBox.y0) * imgH) / (contentH || 1) * 100}%`,
                  padding: 0,
                  color,
                  fontFamily: `${fontFamily || "'Microsoft YaHei'"}, sans-serif`,
                  fontSize: `${Math.max(12, Math.round(textSize * imgH))}px`,
                  lineHeight: 1.15,
                  wordBreak: 'break-all', // 逐字断行，与画布 measureText 换行算法一致
                  caretColor: 'transparent',
                  // 确认后的只读文字：鼠标工具悬停不再显示文字输入光标（I 形），且不拦截画布事件
                  //（鼠标工具可整体选中/拖动该文字；文字输入工具在附近点击可正常新建输入框），禁止文本选择
                  cursor: textCommitted ? 'default' : 'text',
                  pointerEvents: textCommitted ? 'none' : 'auto',
                  userSelect: textCommitted ? 'none' : undefined,
                }}
                value={textValue}
                onChange={(e) => {
                  setTextValue(e.target.value);
                  // 高度自适应内容：多出的行完整显示在选框下方（不被裁剪）
                  e.target.style.height = 'auto';
                  e.target.style.height = `${e.target.scrollHeight}px`;
                  updateCaret();
                }}
                onKeyUp={updateCaret}
                onClick={updateCaret}
                onSelect={updateCaret}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.currentTarget.focus();
                  setTimeout(updateCaret, 30);
                }}
                onKeyDown={(e) => {
                  // Enter 提交、Shift+Enter 换行
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    commitText();
                  }
                  if (e.key === 'Escape') {
                    setTextBox(null);
                    setTextValue('');
                    setTextCommitted(false);
                    setCaretPos(null);
                  }
                }}
                onBlur={commitText}
              />
            )}
            {caretPos && textBox && !textCommitted && (
              <div
                className="pointer-events-none absolute"
                style={{
                  left: imgDx + textBox.x0 * imgW + caretPos.x + 3,
                  top: imgDy + textBox.y0 * imgH + caretPos.y * Math.max(12, Math.round(textSize * imgH)) * 1.15 + 3,
                  width: 3,
                  height: Math.max(12, Math.round(textSize * imgH)) * 1.15,
                  background: color,
                  animation: 'skeyCaretBlink 1s step-end infinite',
                }}
              />
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
              className="hidden"
              onChange={onPickImage}
            />
            </div>
          </div>
        </div>
      </div>
      {showControls && (
        <div className="relative flex items-center justify-end border-t bg-card px-3 py-1.5 text-xs text-muted-foreground">
          <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-3">
            <button
              type="button"
              className="rounded px-2 py-0.5 hover:bg-muted disabled:opacity-40"
              disabled={currentPage === 0}
              onClick={() => onPageChange(currentPage - 1)}
            >
              &lt;
            </button>
            <span>
              {currentPage + 1}/{pageCount}
            </span>
            <button
              type="button"
              className="rounded px-2 py-0.5 hover:bg-muted disabled:opacity-40"
              disabled={currentPage >= pageCount - 1}
              onClick={() => onPageChange(currentPage + 1)}
            >
              &gt;
            </button>
            <span className="tabular-nums">{timerText}</span>
          </div>
          <div className="flex items-center gap-3">
            {hasBg ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="rounded border px-2 py-0.5 hover:bg-muted disabled:opacity-40"
                  disabled={fitContainer ? zoom <= (fillZoomRef.current || 1) * 0.1 : zoom <= 0.25}
                  onClick={() =>
                    setZoom((z) =>
                      fitContainer
                        ? Math.max(
                            (fillZoomRef.current || 1) * 0.1,
                            +((z - (fillZoomRef.current || 1) * 0.1) * 10).toFixed(1) / 10,
                          )
                        : Math.max(0.25, +(z - 0.25).toFixed(2)),
                    )
                  }
                >
                  −
                </button>
                <span className="w-12 text-center tabular-nums">
                  {Math.round((fitContainer ? zoom / (fillZoomRef.current || 1) : zoom) * 100)}%
                </span>
                <button
                  type="button"
                  className="rounded border px-2 py-0.5 hover:bg-muted disabled:opacity-40"
                  disabled={fitContainer ? zoom >= (fillZoomRef.current || 1) : zoom >= 3}
                  onClick={() =>
                    setZoom((z) =>
                      fitContainer
                        ? Math.min(
                            fillZoomRef.current || 1,
                            +((z + (fillZoomRef.current || 1) * 0.1) * 10).toFixed(1) / 10,
                          )
                        : Math.min(3, +(z + 0.25).toFixed(2)),
                    )
                  }
                >
                  +
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled
                  className="rounded border px-2 py-0.5 opacity-40"
                >
                  −
                </button>
                <span className="w-12 text-center tabular-nums">100%</span>
                <button
                  type="button"
                  disabled
                  className="rounded border px-2 py-0.5 opacity-40"
                >
                  +
                </button>
              </div>
            )}
            {onToggleShare && (
              <button
                type="button"
                onClick={onToggleShare}
                className="ml-2 rounded border px-2 py-0.5 text-xs hover:bg-muted"
              >
                黑板窗口
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
