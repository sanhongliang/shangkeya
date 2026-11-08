// pdf.js 的 worker 入口（pdfjs-dist 4.x 的 worker 内部也会调用 Promise.withResolvers）
// 旧版 macOS WKWebView（Safari < 17.4）没有这个 API，而主线程 index.html 里的 polyfill
// 不会进到 worker 上下文，所以这里在加载真正的 worker 代码之前先补齐，再用动态 import 引入。
// 注意必须用 await import()：ESM 的静态 import 会被提升到文件最前面执行，polyfill 就来不及了。

type PromiseWithResolvers = <T>() => {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

const PromiseCtor = Promise as unknown as { withResolvers?: PromiseWithResolvers };

if (typeof PromiseCtor.withResolvers !== 'function') {
  PromiseCtor.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

void import('pdfjs-dist/build/pdf.worker.min.mjs');
