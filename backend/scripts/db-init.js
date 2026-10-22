// 数据库初始化：建库 + 建表 + 种子管理员
// 用法：
//   生产：node scripts/db-init.js            （读 .env 连接真实 PG）
//   本地验证：node scripts/db-init.js --embedded（用 embedded-postgres 启动本地临时 PG）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');

async function withEmbedded(fn) {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const DATA_DIR = 'C:\\Users\\Administrator\\.shangkeya-pgdata';
  const pg = new EmbeddedPostgres({
    // 数据目录必须在无中文的绝对路径（PG 在 Windows 中文路径下 initdb 会编码报错）
    databaseDir: DATA_DIR,
    user: 'postgres',
    password: 'postgres',
    port: 55432,
    persistent: true,
    initdbFlags: ['--locale=C', '--encoding=UTF8'],
  });
  if (!fs.existsSync(path.join(DATA_DIR, 'PG_VERSION'))) {
    await pg.initialise();
  }
  await pg.start();
  const { Client } = await import('pg');
  const client = new Client({ host: 'localhost', port: 55432, user: 'postgres', password: 'postgres' });
  await client.connect();
  try {
    await fn(client);
  } finally {
    await client.end();
    await pg.stop();
  }
}

async function withRemote(fn) {
  const { Client } = await import('pg');
  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'postgres',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
  });
  await client.connect();
  try {
    await fn(client);
  } finally {
    await client.end();
  }
}

async function main() {
  const embedded = process.argv.includes('--embedded');
  const run = async (client) => {
    // 建库
    const db = process.env.PGDATABASE || 'shangkeya';
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [db]);
    if (exists.rowCount === 0) {
      await client.query(`CREATE DATABASE ${db}`);
      console.log('created database', db);
    } else {
      console.log('database exists', db);
    }
    // 连接业务库执行建表
    const biz = await import('pg');
    const b = new biz.Client({
      host: process.env.PGHOST || 'localhost',
      port: embedded ? 55432 : Number(process.env.PGPORT || 5432),
      database: db,
      user: process.env.PGUSER || 'postgres',
      password: embedded ? 'postgres' : process.env.PGPASSWORD || '',
    });
    await b.connect();
    try {
      await b.query(SCHEMA);
      console.log('schema applied');
    } finally {
      await b.end();
    }
  };
  if (embedded) {
    await withEmbedded(run);
  } else {
    await withRemote(run);
  }
  console.log('db-init done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
