// 桌面（Tauri）构建入口：注入跳过妙搭整理的开关后调用 vite build
process.env.MIAODA_SKIP_OUTPUT = '1';
import { build } from 'vite';

build()
  .then(() => {
    console.log('desktop build done');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
