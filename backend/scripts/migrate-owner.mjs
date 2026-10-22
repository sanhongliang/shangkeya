// 迁移：业务表增加 owner_id（账号级数据隔离），现有数据默认归管理员账号 1
// 用法：设置 PG* 环境变量后执行
import pg from 'pg';

const pool = new pg.Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'shangkeya',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '',
});

const TABLES = ['students', 'schedule', 'scores', 'recharges', 'week_schedule', 'courses'];
try {
  for (const t of TABLES) {
    await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS owner_id INT NOT NULL DEFAULT 1`);
    console.log('owner_id added:', t);
  }
  await pool.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS owner_id INT NOT NULL DEFAULT 1');
  console.log('owner_id added: settings');
  // settings 唯一键改 (org_id, owner_id)
  await pool.query('ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_pkey');
  await pool.query('ALTER TABLE settings ADD PRIMARY KEY (org_id, owner_id)');
  console.log('settings PK -> (org_id, owner_id)');
  // 为其他表 owner_id 建索引（性能）
  for (const t of TABLES) {
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${t}_owner ON ${t} (org_id, owner_id)`);
  }
  await pool.query('CREATE INDEX IF NOT EXISTS idx_settings_owner ON settings (org_id, owner_id)');
  console.log('indexes created');
  console.log('MIGRATE_OK');
} catch (e) {
  console.error('MIGRATE_FAIL:', e?.message ?? e);
  process.exit(1);
} finally {
  await pool.end();
}
