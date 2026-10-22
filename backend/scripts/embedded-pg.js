// 本地开发用：启动嵌入式 PostgreSQL 并保持运行（供后端 API 连接）
// 用法：node scripts/embedded-pg.js
import { default as EmbeddedPostgres } from 'embedded-postgres';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = 'C:\\Users\\Administrator\\.shangkeya-pgdata';

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: 'postgres',
  password: 'postgres',
  port: 55432,
  persistent: true,
  initdbFlags: ['--locale=C', '--encoding=UTF8'],
});

// 目录已初始化（有 PG_VERSION）则跳过 initdb，直接启动
if (!fs.existsSync(path.join(DATA_DIR, 'PG_VERSION'))) {
  await pg.initialise();
}
await pg.start();
console.log('embedded postgres ready on port 55432 (press Ctrl+C to stop)');

// 保持进程常驻
const timer = setInterval(() => {}, 1000);
process.on('SIGINT', async () => {
  clearInterval(timer);
  await pg.stop();
  process.exit(0);
});
