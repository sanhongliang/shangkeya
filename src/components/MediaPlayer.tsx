import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import BoardCanvas, { type BoardCanvasHandle } from '@/pages/ClassroomPage/BoardCanvas';
import type { LineStyle } from '@/pages/ClassroomPage/tools';

/** 媒体课件播放信息 */
export interface MediaInfo {
  url: string;
  kind: 'video' | 'audio';
  name: string;
}

/** 课件书写层操作句柄（工具栏撤销/清空路由到此处） */
export interface MediaPlayerHandle {
  undo: () => void;
  clear: () => void;
  isWriting: () => boolean;
}

/**
 * 媒体课件播放器 overlay：视频居中 contain 显示带控制条；音频底部小播放器。
 * 视频：右上角「书写」按钮——点击暂停画面并冻结当前帧（按容器 contain 截帧），
 * 把冻结帧作为黑板画布背景，**完全复用黑板左侧书写工具栏**在画面上书写批注；
 *       再点「退出书写」清空批注并恢复播放。书写期间视频不可操作。
 * 书写状态下工具栏撤销/清空经 handle 路由到书写画布。
 * 音频：保持右上角关闭按钮。
 */
const MediaPlayer = forwardRef<MediaPlayerHandle, {
  media: MediaInfo | null;
  onClose: () => void;
  /** 黑板书写工具状态（与黑板完全一致） */
  tool: string;
  color: string;
  penSize: number;
  lineStyle: LineStyle;
  fontFamily: string;
  textSize: number;
}>(
  function MediaPlayer(
    { media, onClose, tool, color, penSize, lineStyle, fontFamily, textSize },
    ref,
  ) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const boardRef = useRef<BoardCanvasHandle>(null);
    const [writing, setWriting] = useState(false);
    const [frameUrl, setFrameUrl] = useState<string | null>(null);

    useImperativeHandle(ref, () => ({
      undo: () => {
        if (writing) boardRef.current?.undo();
      },
      clear: () => {
        if (writing) boardRef.current?.clear();
      },
      isWriting: () => writing,
    }), [writing]);

    // 切换媒体 / 关闭时重置
    useEffect(() => {
      if (media) {
        const els = document.querySelectorAll<HTMLMediaElement>('video[data-mp], audio[data-mp]');
        els.forEach((el) => {
          el.pause();
        });
      }
    }, [media?.url, media?.kind]);

    // 切换媒体时退出书写状态
    useEffect(() => {
      setWriting(false);
      setFrameUrl(null);
    }, [media?.url]);

    const freezeFrame = () => {
      const v = videoRef.current;
      const wrap = wrapRef.current;
      if (!v || !wrap) return;
      const w = Math.max(1, wrap.clientWidth);
      const h = Math.max(1, wrap.clientHeight);
      const tc = document.createElement('canvas');
      tc.width = w;
      tc.height = h;
      const c = tc.getContext('2d');
      if (!c) return;
      c.fillStyle = '#000';
      c.fillRect(0, 0, w, h);
      const vw = v.videoWidth || w;
      const vh = v.videoHeight || h;
      const s = Math.min(w / vw, h / vh);
      const dw = vw * s;
      const dh = vh * s;
      try {
        c.drawImage(v, (w - dw) / 2, (h - dh) / 2, dw, dh);
      } catch {
        /* 截帧失败忽略 */
      }
      setFrameUrl(tc.toDataURL('image/jpeg', 0.82));
    };

    const toggleWriting = () => {
      setWriting((w) => {
        const next = !w;
        const v = videoRef.current;
        if (v) {
          if (next) {
            v.pause();
            // 帧冻结在下一渲染循环执行（暂停后帧就绪）
            setTimeout(freezeFrame, 30);
          } else {
            void v.play().catch(() => undefined);
            setFrameUrl(null);
          }
        }
        return next;
      });
    };

    if (!media) return null;

    return (
      <div
        ref={wrapRef}
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
        {media.kind === 'video' ? (
          <>
            <video
              data-mp
              ref={videoRef}
              src={media.url}
              controls
              autoPlay
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                background: '#000',
                outline: 'none',
                display: writing ? 'none' : 'block',
              }}
            />
            {/* 书写层：冻结帧作黑板背景，完全复用黑板书写工具（画布=容器全尺寸，不套比例容器） */}
            {writing && frameUrl && (
              <div style={{ position: 'absolute', inset: 0, zIndex: 5000 }}>
                <BoardCanvas
                  ref={boardRef}
                  showControls={false}
                  boardStyle="white"
                  boardBackground="transparent"
                  bgImage={frameUrl}
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
              onClick={toggleWriting}
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
          </>
        ) : (
          <div
            style={{
              position: 'absolute',
              left: '50%',
              bottom: 24,
              transform: 'translateX(-50%)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              maxWidth: '92%',
              padding: '8px 12px',
              borderRadius: 8,
              background: 'rgba(17,24,39,.92)',
              color: '#fff',
              fontSize: 13,
              boxShadow: '0 2px 10px rgba(0,0,0,.4)',
              pointerEvents: 'auto',
            }}
          >
            <span
              style={{
                maxWidth: 140,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flexShrink: 1,
              }}
            >
              {media.name || '音频课件'}
            </span>
            <audio data-mp src={media.url} controls autoPlay style={{ height: 32 }} />
          </div>
        )}
        {media.kind === 'audio' && (
          <button
            onClick={onClose}
            title="关闭"
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              width: 30,
              height: 30,
              border: 'none',
              borderRadius: 6,
              background: 'rgba(17,24,39,.75)',
              color: '#fff',
              fontSize: 16,
              lineHeight: 1,
              cursor: 'pointer',
              zIndex: 6000,
            }}
          >
            ✕
          </button>
        )}
      </div>
    );
  },
);

export default MediaPlayer;
