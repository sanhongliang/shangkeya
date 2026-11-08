// 窗口几何：跨平台取「内容区（webview）左上角」的屏幕物理坐标。
//
// 为什么不用 window.innerPosition()：
// 在 macOS 上它返回的是窗口外框位置（没有减去标题栏），而 Tauri 创建窗口的
// x/y 指外框位置。于是「父窗内容区坐标 + 页面内 rect 偏移」算出来的子窗口
// 位置会整体偏上一个标题栏高度——表现就是窗口顶到标题栏、竖直方向不在正中。
// 这里统一用 outerPosition + (outerSize - innerSize) 自己算，Windows / macOS
// 都成立，也不再依赖各平台 innerPosition 的语义差异。
import type { Window } from '@tauri-apps/api/window';

export interface ContentOrigin {
  /** 内容区左上角的屏幕坐标（物理像素） */
  x: number;
  y: number;
  /** 外框相对内容区的偏移（物理像素）：dx 一般为边框宽，dy 为标题栏高度 */
  dx: number;
  dy: number;
  outerW: number;
  outerH: number;
  innerW: number;
  innerH: number;
}

export async function contentOrigin(mw: Window): Promise<ContentOrigin> {
  const [op, os, isz] = await Promise.all([
    mw.outerPosition(),
    mw.outerSize(),
    mw.innerSize(),
  ]);
  const dx = Math.max(0, Math.round((os.width - isz.width) / 2));
  const dy = Math.max(0, Math.round(os.height - isz.height));
  return {
    x: op.x + dx,
    y: op.y + dy,
    dx,
    dy,
    outerW: os.width,
    outerH: os.height,
    innerW: isz.width,
    innerH: isz.height,
  };
}
