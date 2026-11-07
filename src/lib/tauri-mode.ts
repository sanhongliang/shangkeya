/**
 * 是否运行在 Tauri 桌面客户端。
 * 网页版（浏览器）里没有 __TAURI_INTERNALS__，调用 Tauri 的 emit / listen / invoke
 * 会抛出 TypeError: Cannot read properties of undefined (reading 'invoke')，
 * 未处理时会被入口页的全局错误层接住，整页盖成红字“启动错误”。
 */
export const IS_TAURI_MODE: boolean =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * 安全的事件广播：
 * - 网页版直接跳过（浏览器没有 Tauri 事件系统），不会抛错；
 * - 桌面端即便发送失败也吞掉，不产生未处理的 Promise 拒绝。
 */
export async function emitSafe(event: string, payload?: unknown): Promise<void> {
  if (!IS_TAURI_MODE) return;
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit(event, payload);
  } catch {
    /* 事件发送失败忽略：不影响页面功能 */
  }
}
