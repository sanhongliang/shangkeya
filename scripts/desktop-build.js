// 桌面（Tauri）构建入口：注入跳过妙搭整理的开关后调用 vite build
process.env.MIAODA_SKIP_OUTPUT = '1';
import { build } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// 桌面产物后处理：
// 1) 去掉 crossorigin —— Tauri 自定义协议(tauri://localhost)下带 crossorigin 的模块脚本
//    在 WKWebView 上会被 CORS 规则拦掉，导致 JS 加载失败、页面全白（Windows WebView2 较宽松）；
// 2) 注入错误捕获脚本 —— 启动期任何报错/脚本加载失败直接画到页面上，避免只有白屏无从排查。
function postProcess() {
  const distDir = path.resolve(import.meta.dirname, '..', 'dist', 'client');
  const idx = path.join(distDir, 'index.html');
  if (!fs.existsSync(idx)) return;
  let html = fs.readFileSync(idx, 'utf8');

  html = html.replace(/\scrossorigin(?:="[^"]*")?/g, '');

  const capture = `<script>
(function(){
  // 只在“启动阶段”（页面还没渲染出内容）才整页显示错误；
  // 运行期零星的报错/未处理拒绝只写控制台，避免把已经正常使用的页面盖成红字“崩了”。
  function isStartupPhase(){
    try{
      var r=document.getElementById('root');
      return !r || r.childElementCount===0;
    }catch(_){ return true; }
  }
  function show(msg){
    if(!isStartupPhase()){
      try{ console.error('[页面错误]', msg); }catch(_){}
      return;
    }
    try{
      var d=document.createElement('div');
      d.style.cssText='position:fixed;left:0;top:0;right:0;bottom:0;padding:24px;background:#fff;color:#b00020;font:13px/1.6 monospace;white-space:pre-wrap;z-index:99999;overflow:auto';
      d.textContent='[启动错误]\\n'+msg;
      document.body.appendChild(d);
    }catch(_){}
  }
  window.addEventListener('error',function(e){
    if(e.target&&e.target.tagName==='SCRIPT'){show('脚本加载失败：'+(e.target.src||'?'));return;}
    show((e.message||'')+'\\n'+(e.filename||'')+':'+(e.lineno||0)+':'+(e.colno||0)+'\\n'+((e.error&&e.error.stack)||''));
  },true);
  window.addEventListener('unhandledrejection',function(e){
    var r=e.reason||{};show('未处理的 Promise 拒绝：'+(r.stack||r.message||String(r)));
  });
})();
</script>`;
  html = html.replace('</head>', capture + '</head>');
  fs.writeFileSync(idx, html);
}

build()
  .then(() => {
    try {
      postProcess();
      console.log('desktop post-process done');
    } catch (err) {
      console.error('post-process failed', err);
    }
    console.log('desktop build done');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
