// PDF → 图片组（课堂页逐页展示 + 可书写）
// 用 pdf.js 在浏览器端逐页渲染为图片 dataURL，避免依赖后端转换服务。
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let workerReady = false;

export interface PdfToImagesOptions {
  scale?: number; // 渲染缩放（默认 1.5，约 800-1100px 宽）
  maxPages?: number; // 最多渲染页数，防止超大 PDF 卡死
  onProgress?: (done: number, total: number) => void;
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
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
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
    await page.render({ canvas, viewport }).promise;
    out.push(canvas.toDataURL('image/jpeg', 0.85));
    onProgress?.(i, total);
  }
  return out;
}
