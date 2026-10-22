// 迁移：账号到期时间 + 充值卡改为续期天数 + 管理员账号重置
// 用法：cd <backend> && node scripts/migrate-cards.mjs  （读取 PG* 环境变量）
import pg from 'pg';
import bcrypt from 'bcryptjs';

const pool = new pg.Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'shangkeya',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '',
});

const ADMIN_USER = 'sanhongliang';
const ADMIN_PASS = 'shl778877.';

async function run() {
  const steps = [];
  // 1) accounts 增加 expires_at
  await pool.query('ALTER TABLE accounts ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ');
  // 2) cards 增加 duration_days（旧表无此列），移除旧 amount 面额列
  await pool.query('ALTER TABLE cards ADD COLUMN IF NOT EXISTS duration_days INTEGER NOT NULL DEFAULT 30');
  await pool.query('ALTER TABLE cards DROP COLUMN IF EXISTS amount');
  // 3) 清空旧卡（旧的"给学员充值"测试卡，语义已变）
  const del = await pool.query('DELETE FROM cards');
  steps.push(`cards cleared: ${del.rowCount}`);
  // 4) 老师账号补 7 天试用（无到期时间的）
  const trial = await pool.query(
    `UPDATE accounts SET expires_at = now() + interval '7 days'
     WHERE role = 'teacher' AND expires_at IS NULL`,
  );
  steps.push(`teachers trial granted: ${trial.rowCount}`);
  // 5) 管理员账号重置：改名 + 改密码（保留原 admin 记录改为新账号）
  const hash = bcrypt.hashSync(ADMIN_PASS, 10);
  const upd = await pool.query(
    `UPDATE accounts SET username = $1, password_hash = $2, name = '管理员'
     WHERE role = 'admin' AND username = 'admin'
     RETURNING id`,
    [ADMIN_USER, hash],
  );
  if (upd.rowCount > 0) {
    steps.push(`admin renamed -> ${ADMIN_USER} (id=${upd.rows[0].id})`);
  } else {
    const ins = await pool.query(
      `INSERT INTO accounts (org_id, username, password_hash, name, role, active)
       VALUES (1, $1, $2, '管理员', 'admin', true)
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id`,
      [ADMIN_USER, hash],
    );
    steps.push(`admin created/updated -> ${ADMIN_USER} (id=${ins.rows[0].id})`);
  }
  // 6) 校验
  const acc = await pool.query(
    `SELECT id, username, role, expires_at FROM accounts ORDER BY id`,
  );
  steps.push(`accounts: ${acc.rows.map((a) => `${a.username}(${a.role},exp=${a.expires_at ? a.expires_at.toISOString().slice(0,10) : 'null'})`).join(', ')}`);
  console.log(steps.join('\n'));
  await pool.end();
}

run().catch(async (e) => {
  console.error('MIGRATE_FAIL:', e?.message ?? e);
  await pool.end();
  process.exit(1);
});
