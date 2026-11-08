// 生成 public/pdf.worker.patched.<版本>.mjs
//
// 为什么需要它：
// 1. pdfjs-dist 4.x 的 worker 里也用到了 Promise.withResolvers（ES2024），
//    旧版 macOS WKWebView（Safari < 17.4）没有这个 API，worker 启动即抛错；
// 2. index.html 里的 polyfill 只作用于主线程，进不到 worker 上下文；
// 3. 所以这里把一小段 polyfill 拼到 worker 源码最前面，输出成固定命名的静态资源
//    （文件名带 pdfjs 版本，天然避免缓存），由 pdf.js 用 workerSrc 加载。
import fs from 'node:fs';
import path from 'node:path';

const POLYFILL = `/* 旧内核补齐：Promise.withResolvers / Iterator helpers / Uint8Array base64 */
(function () {
  if (typeof Promise.withResolvers !== 'function') {
    Promise.withResolvers = function withResolvers() {
      var resolve;
      var reject;
      var promise = new Promise(function (res, rej) {
        resolve = res;
        reject = rej;
      });
      return { promise: promise, resolve: resolve, reject: reject };
    };
  }
})();
(function () {
  if (typeof self.Iterator !== 'undefined') return;
  var proto = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
  var It = function Iterator() {};
  It.prototype = proto;
  if (typeof proto.join !== 'function') {
    proto.join = function (sep) { return Array.from(this).join(sep); };
  }
  if (typeof It.from !== 'function') {
    It.from = function (src) {
      if (src == null) throw new TypeError('Iterator.from: source is null');
      if (typeof src[Symbol.iterator] === 'function') return src[Symbol.iterator]();
      if (typeof src.next === 'function') return src;
      throw new TypeError('Iterator.from: source is not iterable');
    };
  }
  self.Iterator = It;
})();
(function () {
  if (typeof self.Uint8Array.prototype.toBase64 !== 'function') {
    self.Uint8Array.prototype.toBase64 = function () {
      var bin = '';
      for (var i = 0; i < this.length; i++) bin += String.fromCharCode(this[i]);
      return btoa(bin);
    };
  }
  if (typeof self.Uint8Array.fromBase64 !== 'function') {
    self.Uint8Array.fromBase64 = function (s) {
      var bin = atob(s);
      var out = new self.Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    };
  }
})();
`;

/** 输出文件名（与 src/lib/pdf-to-images.ts 里的拼法保持一致，前端用 pdfjsLib.version 拼） */
export function patchedWorkerName(version) {
  return `pdf.worker.patched.${version}.mjs`;
}

/** 确保 public 下的 patched worker 存在且内容最新；内容没变就不重写（保留 mtime） */
export function ensurePatchedPdfWorker(root = process.cwd()) {
  const srcPath = path.join(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs');
  const pkgPath = path.join(root, 'node_modules/pdfjs-dist/package.json');
  if (!fs.existsSync(srcPath) || !fs.existsSync(pkgPath)) return;
  const version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
  const outDir = path.join(root, 'public');
  const outPath = path.join(outDir, patchedWorkerName(version));
  const content = POLYFILL + fs.readFileSync(srcPath, 'utf8');
  fs.mkdirSync(outDir, { recursive: true });
  // 清掉历史版本，避免 public 里堆一堆 worker
  for (const f of fs.readdirSync(outDir)) {
    if (/^pdf\.worker\.patched\.[0-9]/.test(f) && f !== path.basename(outPath)) {
      fs.rmSync(path.join(outDir, f), { force: true });
    }
  }
  if (fs.existsSync(outPath) && fs.readFileSync(outPath, 'utf8') === content) return;
  fs.writeFileSync(outPath, content);
  console.log(`[pdf-worker] 已生成 ${outPath}`);
}
