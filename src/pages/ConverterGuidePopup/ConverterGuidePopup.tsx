/**
 * 转换器缺失引导（独立置顶小窗口）：三个出口并存——
 * 「直接下载」（官方安装包直链，浏览器点开即下载）、「打开官网下载页」、「关闭」。
 * 页面内 Dialog 会被黑板/添加课件等子窗口遮挡，故用独立窗口承载。
 */
import { useState } from 'react';

export default function ConverterGuidePopup() {
  const isMac = /Mac/i.test(navigator.userAgent);
  const downloadPage = 'https://www.libreoffice.org/download/download-libreoffice/';
  const [busy, setBusy] = useState<'direct' | 'page' | null>(null);
  const [tip, setTip] = useState('');

  const openUrl = async (url: string) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_external', { url });
      return true;
    } catch {
      // 原生打开失败时退回浏览器直接打开
      try {
        window.open(url, '_blank');
        return true;
      } catch {
        return false;
      }
    }
  };

  const closeWin = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    } catch {
      window.close();
    }
  };

  const directDownload = async () => {
    if (busy) return;
    setBusy('direct');
    setTip('正在获取最新版安装包地址…');
    let url = '';
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      url = String(await invoke('converter_download_url'));
    } catch {
      url = '';
    }
    if (!url) {
      setBusy(null);
      setTip('没拿到安装包直链（网络不通或官网结构变了），请用「打开官网下载页」。');
      return;
    }
    setTip('已开始下载，若浏览器没有反应请点「打开官网下载页」。');
    const okOpen = await openUrl(url);
    setBusy(null);
    if (!okOpen) setTip('无法打开浏览器，请用「打开官网下载页」。');
    else window.setTimeout(() => void closeWin(), 400);
  };

  const openPage = async () => {
    if (busy) return;
    setBusy('page');
    const okOpen = await openUrl(downloadPage);
    setBusy(null);
    if (okOpen) window.setTimeout(() => void closeWin(), 400);
    else setTip('无法打开浏览器，请手动访问 libreoffice.org 下载。');
  };

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        padding: '14px 16px',
        fontFamily: "'Microsoft YaHei', sans-serif",
        fontSize: 13,
        background: '#fafafa',
        color: '#1f2937',
        userSelect: 'none',
      }}
    >
      <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600 }}>未找到可用的文档转换器</h3>
      <div style={{ fontSize: 12.5, lineHeight: 1.7, color: '#374151' }}>
        添加 PPT / Word 课件需要先把文档转成 PDF，但本机没有找到可用的转换器。
        {isMac ? (
          <>
            <div>办法一：安装免费的 LibreOffice，装好后重启上课鸭再添加；</div>
            <div>办法二：用 Keynote / PowerPoint / WPS 把课件另存为 PDF，再直接添加 PDF。</div>
          </>
        ) : (
          <>
            <div>办法一：安装 WPS 或 Office，或免费的 LibreOffice，装好后重启上课鸭再添加；</div>
            <div>办法二：先用 WPS / Office 把课件另存为 PDF，再直接添加 PDF。</div>
          </>
        )}
      </div>

      {tip && (
        <p style={{ margin: '8px 0 0', fontSize: 12, color: tip.startsWith('没拿到') || tip.startsWith('无法') ? '#dc2626' : '#2563eb' }}>
          {tip}
        </p>
      )}

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          onClick={() => void directDownload()}
          disabled={busy !== null}
          style={{
            height: 32,
            border: 'none',
            borderRadius: 6,
            background: '#2563eb',
            color: '#fff',
            fontSize: 13,
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy === 'direct' ? '获取地址中…' : '直接下载 LibreOffice'}
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => void openPage()}
            disabled={busy !== null}
            style={{
              flex: 1,
              height: 30,
              border: '1px solid #d1d5db',
              borderRadius: 6,
              background: '#fff',
              fontSize: 13,
              color: '#374151',
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy === 'page' ? '打开中…' : '打开官网下载页'}
          </button>
          <button
            onClick={() => void closeWin()}
            style={{
              flex: 1,
              height: 30,
              border: '1px solid #d1d5db',
              borderRadius: 6,
              background: '#fff',
              fontSize: 13,
              color: '#374151',
              cursor: 'pointer',
            }}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
