import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import BoardCanvas, { type BoardCanvasHandle } from '@/pages/ClassroomPage/BoardCanvas';
import type { LineStyle } from '@/pages/ClassroomPage/tools';

/** HTML 网页课件显示信息 */
export interface HtmlInfo {
  srcDoc: string;
  name: string;
}

/** 课件书写层操作句柄（工具栏撤销/清空路由到此处） */
export interface HtmlOverlayHandle {
  undo: () => void;
  clear: () => void;
  isWriting: () => boolean;
}

/**
 * HTML 课件 overlay：iframe 全幅显示（沙箱隔离，不能访问程序内部数据）。
 * 右上角「书写」按钮：点击后画面冻结（iframe 不再响应鼠标），
 * 在网页上叠加黑板画布（overlayMode 透明覆盖），**完全复用黑板左侧书写工具栏**
 * （工具/颜色/粗细/线型/文字/形状/橡皮擦等全部与黑板一致）；再次点击退出书写恢复页面操作。
 * 书写状态下工具栏撤销/清空经 handle 路由到书写画布。
 */
const HtmlOverlay = forwardRef<HtmlOverlayHandle, {
  html: HtmlInfo | null;
  onClose: () => void;
  /** 黑板书写工具状态（与黑板完全一致） */
  tool: string;
  color: string;
  penSize: number;
  lineStyle: LineStyle;
  fontFamily: string;
  textSize: number;
}>(
  function HtmlOverlay(
    { html, onClose, tool, color, penSize, lineStyle, fontFamily, textSize },
    ref,
  ) {
    const boardRef = useRef<BoardCanvasHandle>(null);
    const [writing, setWriting] = useState(false);

    useImperativeHandle(ref, () => ({
      undo: () => {
        if (writing) boardRef.current?.undo();
      },
      clear: () => {
        if (writing) boardRef.current?.clear();
      },
      isWriting: () => writing,
    }), [writing]);

    if (!html) return null;

    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 40,
          background: 'rgba(0,0,0,.45)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: "'Microsoft YaHei', sans-serif",
        }}
      >
        <iframe
          title={html.name || 'HTML 课件'}
          sandbox="allow-scripts allow-forms allow-modals allow-popups"
          srcDoc={html.srcDoc}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            background: '#fff',
            pointerEvents: writing ? 'none' : 'auto',
          }}
        />
        {/* 书写层：黑板画布透明覆盖（完全复用黑板书写工具） */}
        {writing && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 5000 }}>
            <BoardCanvas
              ref={boardRef}
              overlayMode
              fitContainer
              showControls={false}
              boardStyle="white"
              boardBackground="transparent"
              tool={tool}
              color={color}
              penSize={penSize}
              lineStyle={lineStyle}
              fontFamily={fontFamily}
              textSize={textSize}
              timerText=""
              currentPage={0}
              pageCount={1}
              onPageChange={() => undefined}
              onClear={() => undefined}
            />
          </div>
        )}
        <button
          onClick={() => setWriting((w) => !w)}
          title={writing ? '退出书写' : '书写'}
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            zIndex: 6000,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            height: 34,
            padding: '0 14px',
            border: 'none',
            borderRadius: 8,
            background: writing ? '#16a34a' : 'rgba(17,24,39,.85)',
            color: '#fff',
            fontSize: 13,
            cursor: 'pointer',
            boxShadow: '0 2px 10px rgba(0,0,0,.35)',
          }}
        >
          ✎ {writing ? '退出书写' : '书写'}
        </button>
      </div>
    );
  },
);

export default HtmlOverlay;
