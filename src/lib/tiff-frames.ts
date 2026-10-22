// TIFF 课件图集解码：多页 TIFF → 逐帧图片 + 帧类型（讲解/问题/答案） + 问题↔答案配对
// 帧类型规则（用户给定）：
//   高度 > 494 且 宽度 = 878 → 问题页
//   宽度 < 878             → 答案
//   高度 = 494 且 宽度 = 878 → 讲解页
// 若该课件无任何帧命中上述规则（不同尺寸），按自适应规则兜底：
//   出现最多的宽高组合为「讲解基准」；高度更大 → 问题；宽度更小 → 答案
import UTIF from 'utif';

export type TiffFrameKind = '讲解' | '问题' | '答案';

export interface TiffFrame {
  index: number;
  url: string; // 帧图片（dataURL），供黑板背景 / 答案小窗使用
  width: number;
  height: number;
  kind: TiffFrameKind;
  /** 问题帧对应的答案帧下标；非问题帧为 null */
  answerIndex: number | null;
}

/** 从 IFD 读取帧像素尺寸：UTIF 仅在 decodeImage 后才填充 width/height，须直接读 t256/t257 标签 */
function ifdSize(ifd: Record<string, unknown>): { w: number; h: number } {
  const w = Number((ifd['t256'] as number[] | undefined)?.[0] ?? ifd.width ?? 0);
  const h = Number((ifd['t257'] as number[] | undefined)?.[0] ?? ifd.height ?? 0);
  return { w, h };
}

/**
 * 答案帧解密：按「易语言答案图像置换算法」对 RGBA 像素做 3 轮行列交换。
 * 算法（原文 1-based 下标）：
 *   第 A 段：逐列（i:1..宽）垂直成对交换，偏移量 = (i×125)%高；奇数行向前移、偶数行向后移
 *   第 B 段：逐行（j:1..高）水平成对交换，偏移量 = (j×125)%宽；奇数列向前移、偶数列向后移
 *   共 3 轮。交换操作对称，解密 = 再次执行同一算法。
 */
function decryptAnswerImage(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): void {
  const px = (x: number, y: number) => (y * w + x) * 4;
  const swap = (x1: number, y1: number, x2: number, y2: number) => {
    const a = px(x1, y1);
    const b = px(x2, y2);
    for (let k = 0; k < 4; k++) {
      const t = rgba[a + k] as number;
      rgba[a + k] = rgba[b + k] as number;
      rgba[b + k] = t;
    }
  };
  for (let round = 0; round < 3; round++) {
    // 每列垂直方向按偏移量成对交换（i:1..宽，j:高..1）
    for (let i = 1; i <= w; i++) {
      const off = (i * 125) % h;
      for (let j = h; j >= 1; j--) {
        const j1 =
          i % 2 === 1
            ? ((j - 1 + off) % h) + 1
            : ((j - 1 - off + h) % h) + 1;
        swap(i - 1, j - 1, i - 1, j1 - 1);
      }
    }
    // 每行水平方向按偏移量成对交换（j:1..高，i:宽..1）
    for (let j = 1; j <= h; j++) {
      const off = (j * 125) % w;
      for (let i = w; i >= 1; i--) {
        const i1 =
          j % 2 === 1
            ? ((i - 1 + off) % w) + 1
            : ((i - 1 - off + w) % w) + 1;
        swap(i - 1, j - 1, i1 - 1, j - 1);
      }
    }
  }
}

/** 分类规则判定（精确规则优先，自适应兜底） */
function classifyFrames(sizes: { w: number; h: number }[]): TiffFrameKind[] {
  const kinds: TiffFrameKind[] = [];
  const exactOk = sizes.some((s) => s.h > 494 && s.w === 878) || sizes.some((s) => s.w < 878);
  if (exactOk) {
    for (const s of sizes) {
      if (s.w < 878) kinds.push('答案');
      else if (s.h > 494 && s.w === 878) kinds.push('问题');
      else kinds.push('讲解');
    }
    return kinds;
  }
  // 自适应：出现最多的 (w,h) 作为讲解基准
  const freq = new Map<string, number>();
  for (const s of sizes) {
    const k = `${s.w}x${s.h}`;
    freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  let baseW = 0;
  let baseH = 0;
  let max = 0;
  for (const [k, c] of freq) {
    if (c > max) {
      max = c;
      const [w, h] = k.split('x').map(Number);
      baseW = w;
      baseH = h;
    }
  }
  for (const s of sizes) {
    if (s.w < baseW) kinds.push('答案');
    else if (s.h > baseH) kinds.push('问题');
    else kinds.push('讲解');
  }
  return kinds;
}

/** 题目信息条隐藏模式：full=隐藏整条；time=只隐藏地域时间（保留难度左对齐）；none=不处理 */
export type QuestionStripMode = 'none' | 'full' | 'time';

/**
 * 去除题目信息 —— 易语言「去除题目信息」100% 还原，在 RGBA 像素上执行：
 * 探测 x∈[25,425)、y∈[45,65)（位图 0-based = 易语言 i+24/j+44）；三行颜色探测
 * （第1行 R>250 且 224<G<235 且 110<B<130；第2/3行 y+2、y+4 R>250 且 210<G<235 且 80<B<130），
 * 扫描顺序取第一个命中。覆盖（源与目标同 y，仅水平移动）：
 *   full：源 x=星级左+77（星级右侧纯白）→ 目标 x=25 起 400 宽 → 隐藏整条
 *   time：源 x=星级左-41（「难度: 」段）→ 目标 x=25 起 400 宽 → 难度左对齐
 * 高 18（星级顶+1 起）。返回是否执行了覆盖。
 */
export function applyQuestionStrip(
  rgba: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  mode: QuestionStripMode,
): boolean {
  if (mode === 'none' || w < 425 || h < 65) return false;
  const x0s = 25;
  const x1s = Math.min(425, w);
  const y0s = 45;
  const y1s = Math.min(65, h);
  if (x1s <= x0s || y1s <= y0s) return false;
  const yellow1 = (x: number, y: number) => {
    if (y >= h) return false;
    const i = (y * w + x) * 4;
    const r = rgba[i] as number;
    const g = rgba[i + 1] as number;
    const b = rgba[i + 2] as number;
    return r > 250 && g < 235 && g > 224 && b < 130 && b > 110;
  };
  const yellow2 = (x: number, y: number) => {
    if (y >= h) return false;
    const i = (y * w + x) * 4;
    const r = rgba[i] as number;
    const g = rgba[i + 1] as number;
    const b = rgba[i + 2] as number;
    return r > 250 && g < 235 && g > 210 && b < 130 && b > 80;
  };
  let mx = -1;
  let my = -1;
  outer: for (let y = y0s; y < y1s; y++) {
    for (let x = x0s; x < x1s; x++) {
      if (yellow1(x, y) && yellow2(x, y + 2) && yellow2(x, y + 4)) {
        mx = x;
        my = y;
        break outer;
      }
    }
  }
  if (mx < 0) return false;
  // 覆盖参数（易语言原版位图坐标）：
  const y0 = Math.min(h - 1, my + 1); // 覆盖顶 = 星级顶 + 1（j+44+n，j 从 1 开始）
  const y1 = Math.min(h, y0 + 18); // 高 18
  const x0 = 25; // 目标行首 x=i+24，i=1 → 25
  const xw = 400; // 宽 400
  const srcStart = mode === 'full' ? Math.max(0, mx + 77) : Math.max(0, mx - 41); // 星级左+77 / 左-41
  for (let y = y0; y < y1; y++) {
    for (let tx = x0; tx < x0 + xw && tx < w; tx++) {
      const sx = srcStart + (tx - x0);
      if (sx < 0 || sx >= w) continue;
      const di = (y * w + tx) * 4;
      const si = (y * w + sx) * 4;
      rgba[di] = rgba[si] as number;
      rgba[di + 1] = rgba[si + 1] as number;
      rgba[di + 2] = rgba[si + 2] as number;
      rgba[di + 3] = rgba[si + 3] as number;
    }
  }
  return true;
}

/** 解码多页 TIFF → 帧列表（每帧转 dataURL 图片）
 *  onProgress：每帧完成回调（done, total），调用方用于显示进度；
 *  解码过程中定期让出主线程，避免大图集解码导致界面卡死。
 *  qMode：题目信息条隐藏模式（none/full/time），在帧转 dataURL 前应用到图像数据。
 */
export async function decodeTiffToFrames(
  arrayBuffer: ArrayBuffer,
  quality = 0.88,
  onProgress?: (done: number, total: number) => void,
  qMode: QuestionStripMode = 'none',
): Promise<TiffFrame[]> {
  const u8 = new Uint8Array(arrayBuffer);
  const ifds = UTIF.decode(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
  if (!ifds.length) throw new Error('TIFF 文件无有效页');

  const sizes = ifds.map((ifd) => ifdSize(ifd));
  const kinds = classifyFrames(sizes);

  // 问题帧答案配对：向后找最近的答案帧
  const answerOf = new Array<number | null>(ifds.length).fill(null);
  for (let i = 0; i < ifds.length; i++) {
    if (kinds[i] !== '问题') continue;
    for (let j = i + 1; j < ifds.length; j++) {
      if (kinds[j] === '答案') {
        answerOf[i] = j;
        break;
      }
    }
  }

  const frames: TiffFrame[] = [];
  const total = ifds.length;
  for (let i = 0; i < total; i++) {
    // 解码当前帧为 RGBA
    UTIF.decodeImage(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength), ifds[i]);
    const rgba = UTIF.toRGBA8(ifds[i]);
    // 答案帧按易语言置换算法解密；211×489 竖版帧为「页面备注」，不参与置换，直接显示原图
    if (kinds[i] === '答案' && !(ifds[i].width === 211 && ifds[i].height === 489)) {
      decryptAnswerImage(rgba, ifds[i].width, ifds[i].height);
    }
    // 题目信息条隐藏（易语言覆盖）——在转 dataURL 前应用到图像数据
    applyQuestionStrip(rgba, ifds[i].width, ifds[i].height, qMode);
    const canvas = document.createElement('canvas');
    canvas.width = ifds[i].width;
    canvas.height = ifds[i].height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建画布');
    const imgData = new ImageData(new Uint8ClampedArray(rgba), ifds[i].width, ifds[i].height);
    ctx.putImageData(imgData, 0, 0);
    const url = canvas.toDataURL('image/jpeg', quality);
    frames.push({
      index: i,
      url,
      width: ifds[i].width,
      height: ifds[i].height,
      kind: kinds[i],
      answerIndex: answerOf[i],
    });
    onProgress?.(i + 1, total);
    // 定期让出主线程（每 2 帧一次），界面保持可响应
    if (i % 2 === 1) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return frames;
}

/** 帧元信息（不含图片数据），用于逐帧按需加载 */
export interface TiffFrameInfo {
  index: number;
  width: number;
  height: number;
  kind: TiffFrameKind;
  /** 问题帧对应的答案帧下标；非问题帧为 null */
  answerIndex: number | null;
}

export interface TiffDeferred {
  total: number;
  frames: TiffFrameInfo[];
  /** 按帧下标解码图片（dataURL），带缓存；重复调用直接返回；qMode 变化会重新解码 */
  getImage: (index: number, qMode?: QuestionStripMode) => Promise<string>;
  /** 释放全部已解码图片 */
  release: () => void;
}

/**
 * 惰性逐帧解码：只解析 IFD 结构（快），图片按需（翻页时）逐帧解码。
 * 适用于大图集（如 59 帧 TIFF）避免一次性全量解码卡顿/占内存。
 */
export async function decodeTiffDeferred(
  arrayBuffer: ArrayBuffer,
  quality = 0.88,
): Promise<TiffDeferred> {
  const u8 = new Uint8Array(arrayBuffer);
  const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  const ifds = UTIF.decode(buf);
  if (!ifds.length) throw new Error('TIFF 文件无有效页');

  const sizes = ifds.map((ifd) => ifdSize(ifd));
  const kinds = classifyFrames(sizes);

  // 问题帧答案配对：向后找最近的答案帧
  const answerOf = new Array<number | null>(ifds.length).fill(null);
  for (let i = 0; i < ifds.length; i++) {
    if (kinds[i] !== '问题') continue;
    for (let j = i + 1; j < ifds.length; j++) {
      if (kinds[j] === '答案') {
        answerOf[i] = j;
        break;
      }
    }
  }

  const frames: TiffFrameInfo[] = ifds.map((ifd, i) => {
    const s = ifdSize(ifd);
    return {
      index: i,
      width: s.w,
      height: s.h,
      kind: kinds[i],
      answerIndex: answerOf[i],
    };
  });

  const cache = new Map<string, string>();
  const getImage = async (index: number, qMode: QuestionStripMode = 'none'): Promise<string> => {
    if (index < 0 || index >= ifds.length) throw new Error(`帧下标越界：${index}`);
    const key = `${index}:${qMode}`;
    const hit = cache.get(key);
    if (hit) return hit;
    // 解码当前帧为 RGBA（单帧很快，不阻塞）
    UTIF.decodeImage(buf, ifds[index]);
    const rgba = UTIF.toRGBA8(ifds[index]);
    // 答案帧按易语言置换算法解密；211×489 竖版帧为「页面备注」，不参与置换，直接显示原图
    if (kinds[index] === '答案' && !(ifds[index].width === 211 && ifds[index].height === 489)) {
      decryptAnswerImage(rgba, ifds[index].width, ifds[index].height);
    }
    // 题目信息条隐藏（易语言覆盖）——在转 dataURL 前应用到图像数据
    applyQuestionStrip(rgba, ifds[index].width, ifds[index].height, qMode);
    const canvas = document.createElement('canvas');
    canvas.width = ifds[index].width;
    canvas.height = ifds[index].height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建画布');
    const imgData = new ImageData(new Uint8ClampedArray(rgba), ifds[index].width, ifds[index].height);
    ctx.putImageData(imgData, 0, 0);
    const url = canvas.toDataURL('image/jpeg', quality);
    cache.set(key, url);
    return url;
  };

  return {
    total: ifds.length,
    frames,
    getImage,
    release: () => cache.forEach((u) => {
      /* dataURL 无 objectURL 需释放 */
    }),
  };
}
