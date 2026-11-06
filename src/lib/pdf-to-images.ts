// PDF → 图片组（课堂页逐页展示 + 可书写）
// 用 pdf.js 在浏览器端逐页渲染为图片 dataURL，避免依赖后端转换服务。
//
// 版本约束：pdfjs-dist 固定 4.x。
// pdf.js v6（pdfjs-dist 6.4.299）要求 Safari 18.4+（依赖 Iterator helpers 等新 API），
// macOS 14 / 15 自带的 WKWebView（Safari 17.x / 18.3）跑不起来，会直接抛错导致
// “PDF 解析失败，请确认文件有效”。v4 支持 Safari 16.4+，覆盖现有 Mac 机型。
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let workerReady = false;

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

/** 将 PDF Blob 逐页渲染为 JPEG dataURL 数组 */
export async function pdfToImages(
  blob: Blob,
  { scale = 1.5, maxPages = 120, onProgress }: PdfToImagesOptions = {},
): Promise<string[]> {
  if (!workerReady) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    workerReady = true;
  }
  const buf = await blob.arrayBuffer();
  let pdf: pdfjsLib.PDFDocumentProxy;
  try {
    pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  } catch (e) {
    throw new Error('打开 PDF 失败（' + describe(e) + '）');
  }
  const total = Math.min(pdf.numPages, maxPages);
  const out: string[] = [];
  for (let i = 1; i <= total; i += 1) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
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
    out.push(canvas.toDataURL('image/jpeg', 0.85));
    onProgress?.(i, total);
  }
  return out;
}
