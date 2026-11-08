// PDF → 图片组（课堂页逐页展示 + 可书写）
// 用 pdf.js 在浏览器端逐页渲染为图片 dataURL，避免依赖后端转换服务。
//
// 版本约束：pdfjs-dist 固定 4.x。
// pdf.js v6（pdfjs-dist 6.4.299）要求 Safari 18.4+（依赖 Iterator helpers 等新 API），
// macOS 14 / 15 自带的 WKWebView（Safari 17.x / 18.3）跑不起来，会直接抛错导致
// “PDF 解析失败，请确认文件有效”。v4 支持 Safari 16.4+，覆盖现有 Mac 机型。
import * as pdfjsLib from 'pdfjs-dist';

let workerReady = false;

// pdf.js 的 worker 用静态资源 public/pdf.worker.patched.<版本>.mjs（构建时由
// scripts/patch-pdf-worker.mjs 拼上旧内核缺少的 Promise.withResolvers / Iterator 等 polyfill）。
// BASE_URL 在桌面构建是 './'、网页版是 '/'，两端都能取到正确地址。
// 文件名带版本号，刷新后不会被旧缓存命中；也不用 query，避免 tauri:// 资源协议解析异常。
const WORKER_SRC = `${import.meta.env.BASE_URL}pdf.worker.patched.${pdfjsLib.version}.mjs`;
const OPEN_TIMEOUT_MS = 20_000;

export interface PdfToImagesOptions {
  scale?: number; // 渲染缩放（默认 1.5，约 800-1100px 宽）
  maxPages?: number; // 最多渲染页数，防止超大 PDF 卡死
  onProgress?: (done: number, total: number) => void;
}

/** 把底层异常转成一句话，便于界面直接展示 */
function describe(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** 将 PDF Blob 逐页渲染为 JPEG dataURL 数组
 *
 * 清晰度：按「课件在课堂窗口里的实际显示宽度」反推渲染分辨率。
 * 以前固定 scale=1.5（A4 约 1190px 宽），在高分屏/宽窗口里被放大显示，
 * 教科书的小字、公式就会糊。这里改成按窗口宽度 × 像素比计算目标像素宽，
 * 再把 JPEG 质量提到 0.92。
 */
export async function pdfToImages(
  blob: Blob,
  { scale = 1.5, maxPages = 120, onProgress }: PdfToImagesOptions = {},
): Promise<string[]> {
  if (!workerReady) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_SRC;
    workerReady = true;
  }
  const buf = await blob.arrayBuffer();
  let pdf: pdfjsLib.PDFDocumentProxy;
  try {
    // 加超时兜底：worker 没能启动时 getDocument 会一直 pending，
    // 界面就“卡住”且没有任何提示；超时后抛出可读错误，让调用方恢复状态
    const task = pdfjsLib.getDocument({ data: buf });
    pdf = await Promise.race([
      task.promise,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          void task.destroy();
          reject(new Error('解析超时，PDF 解析组件未能启动'));
        }, OPEN_TIMEOUT_MS);
        task.promise.then(() => clearTimeout(timer), () => clearTimeout(timer));
      }),
    ]);
  } catch (e) {
    throw new Error('打开 PDF 失败（' + describe(e) + '）');
  }
  const total = Math.min(pdf.numPages, maxPages);
  // 目标像素宽：窗口宽度 × 像素比（最多按 2 倍算）× 1.15 冗余，夹在 1600~2600 之间。
  // 黑板按容器宽度等比显示，渲染宽 ≥ 显示宽 × dpr 时才不会糊。
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  const winW = typeof window !== 'undefined' ? window.innerWidth || 1280 : 1280;
  const targetPx = Math.min(2600, Math.max(1600, Math.round(winW * dpr * 1.15)));
  const out: string[] = [];
  for (let i = 1; i <= total; i += 1) {
    const page = await pdf.getPage(i);
    const baseW = page.getViewport({ scale: 1 }).width;
    const renderScale = Math.min(4, Math.max(scale, targetPx / (baseW || 1)));
    const viewport = page.getViewport({ scale: renderScale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      out.push('');
      continue;
    }
    try {
      // v4 用 canvasContext，v5+ 改用 canvas；两个都传，跨版本都成立
      await page.render({ canvas, canvasContext: ctx, viewport } as unknown as Parameters<
        typeof page.render
      >[0]).promise;
    } catch (e) {
      throw new Error(`渲染第 ${i} 页失败（${describe(e)}）`);
    }
    out.push(canvas.toDataURL('image/jpeg', 0.92));
    onProgress?.(i, total);
  }
  return out;
}
