// EXPORTS: ToolId, TOOLS, COLORS, LINE_STYLES, LineStyle, PEN_SIZES
import type React from 'react';
import {
  ArrowUpRight,
  BoxSelect,
  Eraser,
  Image as ImageIcon,
  MousePointer2,
  Pencil,
  Slash,
  Spline,
  Square,
  Type,
  Undo2,
} from 'lucide-react';

export type ToolId =
  | 'select'
  | 'pencil'
  | 'eraser'
  | 'line'
  | 'arrow'
  | 'arc'
  | 'circleDiameter'
  | 'circleRadius'
  | 'ellipse'
  | 'rect'
  | 'text'
  | 'coords'
  | 'image'
  | 'boxDelete'
  | 'penetrate';

/** 直径圆：圆 + 穿过圆心的直径线 */
function DiameterCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="8" />
      <line x1="4" y1="12" x2="20" y2="12" />
    </svg>
  );
}

/** 半径圆：圆 + 从圆心到圆周的半径线 + 圆心点 */
function RadiusCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="8" />
      <line x1="12" y1="12" x2="18.8" y2="7.3" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 坐标系：直角坐标系图标（水平 X 轴 + 垂直 Y 轴，原点在左下，轴带箭头） */
function CoordinateIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Y 轴（垂直向上，箭头朝上） */}
      <line x1="5" y1="4" x2="5" y2="20" />
      <line x1="3.5" y1="6" x2="5" y2="4" />
      <line x1="6.5" y1="6" x2="5" y2="4" />
      {/* X 轴（水平向右，箭头朝右） */}
      <line x1="5" y1="20" x2="20" y2="20" />
      <line x1="18" y1="18.5" x2="20" y2="20" />
      <line x1="18" y1="21.5" x2="20" y2="20" />
    </svg>
  );
}

/** 渗透显示：外框 + 内部小窗口（预览下一页对应位置） */
function PenetrateIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="2.5" y="4" width="19" height="16" rx="1.5" />
      <rect x="6.5" y="8" width="11" height="8" rx="1" />
      <path d="M6.5 12 H17.5" strokeDasharray="2.4 2" />
    </svg>
  );
}

/** 椭圆：扁平椭圆轮廓 */
function EllipseIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <ellipse cx="12" cy="12" rx="10" ry="6.5" />
    </svg>
  );
}

/** 线型：实线图标（两端圆帽的实横线） */
function SolidLineIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.8"
      strokeLinecap="round"
      className={className}
    >
      <line x1="2.5" y1="12" x2="21.5" y2="12" />
    </svg>
  );
}

/** 线型：虚线图标（均匀断开的横虚线） */
function DashedLineIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeDasharray="4.6 3.4"
      className={className}
    >
      <line x1="2.5" y1="12" x2="21.5" y2="12" />
    </svg>
  );
}

/** 粗细：细 / 中 / 粗 图标（横线粗细梯度 1.2 / 2.8 / 5，直观示意） */
function ThinLineIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" className={className}>
      <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  );
}

function MediumLineIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" className={className}>
      <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  );
}

function ThickLineIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" className={className}>
      <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  );
}

export const TOOLS: { id: ToolId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'select', label: '鼠标', icon: MousePointer2 },
  { id: 'pencil', label: '画笔', icon: Pencil },
  { id: 'eraser', label: '橡皮', icon: Eraser },
  { id: 'line', label: '直线', icon: Slash },
  { id: 'arrow', label: '箭头', icon: ArrowUpRight },
  { id: 'arc', label: '画弧', icon: Spline },
  { id: 'circleDiameter', label: '直径圆', icon: DiameterCircleIcon },
  { id: 'circleRadius', label: '半径圆', icon: RadiusCircleIcon },
  { id: 'ellipse', label: '椭圆', icon: EllipseIcon },
  { id: 'rect', label: '矩形', icon: Square },
  { id: 'text', label: '文字', icon: Type },
  { id: 'coords', label: '坐标系', icon: CoordinateIcon },
  { id: 'image', label: '图片', icon: ImageIcon },
  { id: 'boxDelete', label: '框选删除', icon: BoxSelect },
  { id: 'penetrate', label: '渗透显示', icon: PenetrateIcon },
];

export type LineStyle = 'solid' | 'dashed';

export const LINE_STYLES: { id: LineStyle; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'solid', label: '实线', icon: SolidLineIcon },
  { id: 'dashed', label: '虚线', icon: DashedLineIcon },
];

/** 8 色矩阵（黑 红 蓝 绿 橙 紫 青 灰） */
export const COLORS = [
  '#111111',
  '#e03535',
  '#1677ff',
  '#52c41a',
  '#faad14',
  '#722ed1',
  '#13c2c2',
  '#8c8c8c',
];

export const PEN_SIZES: { id: number; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 1, label: '细', icon: ThinLineIcon },
  { id: 2, label: '中', icon: MediumLineIcon },
  { id: 3, label: '粗', icon: ThickLineIcon },
];

