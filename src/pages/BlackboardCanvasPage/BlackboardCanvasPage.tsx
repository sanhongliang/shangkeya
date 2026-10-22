import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import BoardCanvas, { type BoardCanvasHandle } from '@/pages/ClassroomPage/BoardCanvas';
import MediaPlayer, { type MediaInfo, type MediaPlayerHandle } from '@/components/MediaPlayer';
import HtmlOverlay, { type HtmlInfo, type HtmlOverlayHandle } from '@/components/HtmlOverlay';
import type { LineStyle } from '@/pages/ClassroomPage/tools';

/** 主窗口推送的初始黑板配置 */
interface BcInit {
  boardStyle: ComponentProps<typeof BoardCanvas>['boardStyle'];
  customBoardImage?: string;
  tool: ComponentProps<typeof BoardCanvas>['tool'];
  color: string;
  penSize: number;
  lineStyle: ComponentProps<typeof BoardCanvas>['lineStyle'];
  fontFamily: string;
  textSize: number;
  boardAspect?: number;
  /** 黑板画面比例 = 自由比例：宽=占位区宽-20、高=占位区高-20（充满占位区，每边 10px） */
  boardAspectFree?: boolean;
  timerText: string;
  pageCount: number;
  isTiffMode?: boolean;
  /** 渗透显示：下一页课件帧图像 URL（多页 TIFF 才有） */
  penetrateNextUrl?: string | null;
}

/**
 * 黑板独立窗口：课堂页打开时创建的无边框窗口，承载真正的黑板画布。
 * 书写、课件加载、翻页、缩放都在本窗口内进行；工具选择等控制由主窗口经事件同步。
 * 位置独立：初始由课堂窗口在占位区中间定位一次，之后黑板窗口位置/大小独立保存恢复（不按课堂容器持续贴合调整）。
 */
export default function BlackboardCanvasPage() {
  const boardRef = useRef<BoardCanvasHandle>(null);
  // 课件书写层操作句柄（HTML/视频书写中，工具栏撤销/清空路由到书写画布）
  const mediaOverlayRef = useRef<MediaPlayerHandle>(null);
  const htmlOverlayRef = useRef<HtmlOverlayHandle>(null);
  const [init, setInit] = useState<BcInit | null>(null);
  const [patch, setPatch] = useState<Partial<BcInit>>({});
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [bgImage, setBgImage] = useState<string | null | undefined>(null);
  // 渗透显示：下一页课件帧图像 URL（主窗口推送）
  const [penetrateNextUrl, setPenetrateNextUrl] = useState<string | null>(null);
  const [key, setKey] = useState('plain');
  const [zoomSync, setZoomSync] = useState<number | null>(null);
  // 视频/音频课件播放信息（课堂窗口经 bc:media 推送，黑板窗口 overlay 播放）
  const [media, setMedia] = useState<MediaInfo | null>(null);
  // HTML 网页课件（课堂窗口经 bc:html 推送，黑板窗口 overlay 显示）
  const [htmlInfo, setHtmlInfo] = useState<HtmlInfo | null>(null);
  // 黑板窗口宽高比：按设置页「黑板画面比例」确定（16:9→878:494、9:16→494:878、4:3→4/3、自定义→宽/高）
  // bc:init / bc:props 推送 boardAspect 时更新；贴合/跟随/大小规则保持独立窗口实现方式不变
  // 自由比例（boardAspectFree=true）：宽=占位区宽-20、高=占位区高-20（充满占位区，每边 10px，不 contain）
  const aspectRef = useRef(878 / 494);
  // 自由比例标志用 ref（bc:winPos 监听只注册一次，闭包捕获的 patch/init 是首次渲染旧值，需 ref 跟随最新推送）
  const freeRef = useRef(false);

  useEffect(() => {
    // 黑板窗口层级：不做全局置顶——课堂窗口获得焦点时由 Rust 端抬升黑板到课堂之上（只停留在课堂上边）
    const unsubs: (() => void)[] = [];
    const regs: Promise<() => void>[] = [];
    regs.push(
      listen('bc:init', (e) => {
        const p = e.payload as BcInit;
        setInit(p);
        setPageCount(p.pageCount ?? 1);
        if (typeof p.boardAspect === 'number' && p.boardAspect > 0) {
          aspectRef.current = p.boardAspect;
        }
        freeRef.current = p.boardAspectFree === true;
        if (p.penetrateNextUrl !== undefined) setPenetrateNextUrl(p.penetrateNextUrl);
      }),
    );
    regs.push(
      listen('bc:props', (e) => {
        // 黑板窗口比例按设置页黑板画面比例（不随课件变化；跟随课件模式随课件图片比例变化）
        const payload = e.payload as Partial<BcInit>;
        setPatch((prev) => ({ ...prev, ...payload }));
        if (typeof payload.boardAspect === 'number' && payload.boardAspect > 0) {
          aspectRef.current = payload.boardAspect;
        }
        freeRef.current = payload.boardAspectFree === true;
        if (payload.penetrateNextUrl !== undefined) setPenetrateNextUrl(payload.penetrateNextUrl);
      }),
    );
    regs.push(listen('bc:image', (e) => setBgImage(e.payload as string | null)));
    regs.push(listen('bc:page', (e) => setPage(Number(e.payload) || 0)));
    regs.push(listen('bc:pageCount', (e) => setPageCount(Number(e.payload) || 1)));
    regs.push(
      listen('bc:undo', () => {
        // 课件书写层激活：撤销课件书写批注；否则撤销黑板
        const ov = mediaOverlayRef.current || htmlOverlayRef.current;
        if (ov && ov.isWriting()) ov.undo();
        else boardRef.current?.undo();
      }),
    );
    regs.push(
      listen('bc:clear', () => {
        // 课件书写层激活：清空课件书写批注；否则清空黑板
        const ov = mediaOverlayRef.current || htmlOverlayRef.current;
        if (ov && ov.isWriting()) ov.clear();
        else boardRef.current?.clear();
      }),
    );
    // 主窗口提示（课堂窗口内的提示会被黑板窗口盖住，改在本窗口显示）
    regs.push(
      listen('bc:toast', (e) => {
        const msg = (e.payload as { msg?: string } | undefined)?.msg;
        if (typeof msg === 'string') showToast(msg);
      }),
    );
    regs.push(listen('bc:resetKey', (e) => setKey(String(e.payload))));
    regs.push(listen('bc:zoom', (e) => setZoomSync(Number(e.payload) || 1)));
    // 视频/音频课件播放：课堂窗口推送媒体信息（url/kind/name），null 表示关闭
    regs.push(
      listen('bc:media', (e) => {
        setMedia((e.payload as MediaInfo | null) ?? null);
      }),
    );
    // HTML 网页课件显示：课堂窗口推送网页内容（srcDoc/name），null 表示关闭
    regs.push(
      listen('bc:html', (e) => {
        setHtmlInfo((e.payload as HtmlInfo | null) ?? null);
      }),
    );
    // 位置跟随：主窗口广播自身位置/黑板区尺寸 → 本窗口自己贴合
    regs.push(
      listen('bc:winPos', (e) => {
        void applyWinPos(e.payload as WinPos);
      }),
    );
    // 课堂窗口关闭 → 本窗口关闭
    regs.push(
      listen('bc:close', () => {
        void closeSelf();
      }),
    );
    // 注册是异步的：StrictMode 开发模式双挂载时，第一次挂载的监听可能尚未注册完成就被清理，
    // 若直接跳过会导致旧监听残留、事件重复触发（撤销一次回退两步）。
    // 用 disposed 标志：注册完成后若组件已卸载则立即注销，避免残留重复监听。
    let disposed = false;
    Promise.all(regs)
      .then((us) => {
        if (disposed) {
          us.forEach((f) => f());
          return;
        }
        unsubs.push(...us);
        // 监听注册完成 → 通知主窗口补推全量状态（避免窗口加载慢导致事件丢失）
        void emit('bc:ready');
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubs.forEach((f) => f());
    };
  }, []);

  // 键盘左右键翻页课件（黑板窗口焦点时使用；排除输入/编辑状态）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setPage((p) => {
          const np = Math.max(0, p - 1);
          if (np !== p) void emit('bc:pageChanged', np);
          return np;
        });
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setPage((p) => {
          const np = Math.min(pageCount - 1, p + 1);
          if (np !== p) void emit('bc:pageChanged', np);
          return np;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pageCount]);

  // 黑板窗口自控位置：黑板是独立窗口，setPosition 使用「屏幕坐标」——
  // 课堂窗口屏幕位置 + 占位区相对课堂窗口的偏移 × 缩放
  // 一次性校准缓存：无边框可缩放窗口存在系统隐藏边框偏移（客户区比外框偏右下方几像素）
  const calibRef = useRef<{ dx: number; dy: number; done: boolean }>({ dx: 0, dy: 0, done: false });
  // 用极值初始化而非 NaN：Math.abs(tx - NaN) > 1 恒为 false，会导致首次贴合被永久跳过（窗口不再跟随）
  const lastPosRef = useRef({ x: Number.MIN_SAFE_INTEGER, y: Number.MIN_SAFE_INTEGER });
  const lastSizeRef = useRef({ w: Number.MIN_SAFE_INTEGER, h: Number.MIN_SAFE_INTEGER });
  // 串行执行：广播 100ms 一次，校准需等待生效，若并发执行会互相覆盖导致读数错乱（黑板位置偏右）
  const busyRef = useRef(false);
  const pendingRef = useRef<WinPos | null>(null);

  // 入口：缓存最新广播；若上一轮尚未完成则跳过（由串行循环消费最后状态）
  const applyWinPos = (p: WinPos) => {
    pendingRef.current = p;
    if (busyRef.current) return;
    busyRef.current = true;
    void (async () => {
      try {
        while (pendingRef.current) {
          const cur = pendingRef.current;
          pendingRef.current = null;
          await doApplyWinPos(cur);
        }
      } catch (e) {
        console.error('黑板窗口贴合失败', e);
      } finally {
        busyRef.current = false;
      }
    })();
  };

  const doApplyWinPos = async (p: WinPos) => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const { PhysicalPosition, PhysicalSize } = await import('@tauri-apps/api/dpi');
    const w = getCurrentWindow();
    const rectW = p.rectW > 0 ? p.rectW : 800;
    const rectH = p.rectH > 0 ? p.rectH : 500;
    // 原占位区（物理像素）
    const zoneW = Math.round(rectW * p.scale);
    const zoneH = Math.round(rectH * p.scale);
    // 占位区四周预留 10px：黑板窗口比占位区四周各小 10px（与课堂黑板容器一致）
    const availW = Math.max(300, zoneW - 20);
    const availH = Math.max(200, zoneH - 20);
    // 按设置页黑板画面比例 + 四周至少 10px：
    // 非自由比例（16:9→878:494、9:16→494:878、4:3、自定义）：宽度优先按比例，超高则改为高度受限（contain 适配）；
    // 自由比例（boardAspectFree）：宽=占位区宽-20、高=占位区高-20（充满占位区，每边 10px，不 contain）
    const isFree = freeRef.current;
    let wPx: number;
    let hPx: number;
    if (isFree) {
      wPx = availW;
      hPx = availH;
    } else {
      const aspect = aspectRef.current;
      wPx = availW;
      hPx = Math.round(availW / aspect);
      if (hPx > availH) {
        hPx = availH;
        wPx = Math.round(availH * aspect);
      }
    }
    // 黑板窗口在占位区内居中显示（四周间距 ≥6px）
    const x = Math.round(p.ipX + p.rectLeft * p.scale + (zoneW - wPx) / 2);
    const y = Math.round(p.ipY + p.rectTop * p.scale + (zoneH - hPx) / 2);
    // 一次性校准：仅首次，等待生效后读客户区实际位置，缓存边框偏移。
    // 偏差超过 ±20px 或读取失败视为窗口未稳定：本次改用无偏移继续贴合（不阻塞 setPosition/setSize），
    // 由后续 100ms tick 持续校正——否则一旦校准卡住，课堂窗口移动时黑板窗口将永久不跟随
    if (!calibRef.current.done) {
      await w.setPosition(new PhysicalPosition(x, y));
      await new Promise((r) => setTimeout(r, 250));
      try {
        const actual = await w.innerPosition();
        if (Math.abs(actual.x - x) <= 20 && Math.abs(actual.y - y) <= 20) {
          calibRef.current = { dx: actual.x - x, dy: actual.y - y, done: true };
        } else {
          calibRef.current = { dx: 0, dy: 0, done: true };
        }
      } catch {
        calibRef.current = { dx: 0, dy: 0, done: true };
      }
    }
    const tx = x - calibRef.current.dx;
    const ty = y - calibRef.current.dy;
    // 位置变化超过阈值才设置（课堂窗口不动时不重复 setPosition，避免晃动）
    if (Math.abs(tx - lastPosRef.current.x) > 1 || Math.abs(ty - lastPosRef.current.y) > 1) {
      await w.setPosition(new PhysicalPosition(tx, ty));
      lastPosRef.current = { x: tx, y: ty };
    }
    // 尺寸变化超过阈值才设置（减少 onResized 触发，避免比例校正拉锯）
    if (Math.abs(wPx - lastSizeRef.current.w) > 2 || Math.abs(hPx - lastSizeRef.current.h) > 2) {
      await w.setSize(new PhysicalSize(wPx, hPx));
      lastSizeRef.current = { w: wPx, h: hPx };
    }
    void emit('bc:winPosAck');
  };

  // 关闭自己（通知主窗口回退，然后关闭）
  const closeSelf = async () => {
    try {
      void emit('bc:closed');
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    } catch {
      /* 忽略 */
    }
  };

  const onPageChange = (p: number) => {
    setPage(p);
    void emit('bc:pageChanged', p);
  };

  // 黑板窗口内提示（课堂窗口的提示会被黑板窗口盖住，改在本窗口显示）
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const showToast = (msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMsg(null), 2200);
  };

  if (!init) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#111',
          color: 'rgba(255,255,255,.5)',
          fontSize: 14,
        }}
      >
        等待主窗口连接…
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', background: '#3a3a3a', overflow: 'hidden', position: 'relative' }}>
      <BoardCanvas
        key={key}
        ref={boardRef}
        showControls={false}
        boardBackground="#ffffff"
        zoomSync={zoomSync}
        onZoomSync={(z, f) => void emit('bc:zoomChanged', { zoom: z, fill: f ?? z })}
        isTiffMode={patch.isTiffMode ?? init.isTiffMode}
        boardStyle={(patch.boardStyle ?? init.boardStyle) as ComponentProps<typeof BoardCanvas>['boardStyle']}
        customBoardImage={patch.customBoardImage ?? init.customBoardImage}
        tool={(patch.tool ?? init.tool) as ComponentProps<typeof BoardCanvas>['tool']}
        color={(patch.color ?? init.color) as string}
        penSize={(patch.penSize ?? init.penSize) as number}
        lineStyle={(patch.lineStyle ?? init.lineStyle) as ComponentProps<typeof BoardCanvas>['lineStyle']}
        fontFamily={(patch.fontFamily ?? init.fontFamily) as string}
        textSize={(patch.textSize ?? init.textSize) as number}
        boardAspect={patch.boardAspect ?? init.boardAspect}
        timerText={(patch.timerText ?? init.timerText) as string}
        currentPage={page}
        pageCount={pageCount}
        bgImage={bgImage}
        penetrateNextUrl={penetrateNextUrl}
        onPageChange={onPageChange}
        onClear={() => undefined}
      />
      {media && (
        <MediaPlayer
          ref={mediaOverlayRef}
          media={media}
          onClose={() => setMedia(null)}
          tool={(patch.tool ?? init.tool) as string}
          color={(patch.color ?? init.color) as string}
          penSize={(patch.penSize ?? init.penSize) as number}
          lineStyle={(patch.lineStyle ?? init.lineStyle) as LineStyle}
          fontFamily={(patch.fontFamily ?? init.fontFamily) as string}
          textSize={(patch.textSize ?? init.textSize) as number}
        />
      )}
      {htmlInfo && (
        <HtmlOverlay
          ref={htmlOverlayRef}
          html={htmlInfo}
          onClose={() => setHtmlInfo(null)}
          tool={(patch.tool ?? init.tool) as string}
          color={(patch.color ?? init.color) as string}
          penSize={(patch.penSize ?? init.penSize) as number}
          lineStyle={(patch.lineStyle ?? init.lineStyle) as LineStyle}
          fontFamily={(patch.fontFamily ?? init.fontFamily) as string}
          textSize={(patch.textSize ?? init.textSize) as number}
        />
      )}
      {toastMsg && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 28,
            transform: 'translateX(-50%)',
            padding: '7px 16px',
            borderRadius: 6,
            background: 'rgba(17,24,39,.88)',
            color: '#fff',
            fontSize: 13,
            fontFamily: "'Microsoft YaHei', sans-serif",
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 10,
          }}
        >
          {toastMsg}
        </div>
      )}
    </div>
  );
}
