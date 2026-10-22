// 创建初始管理员账号
// 用法：node scripts/seed-admin.js [username] [password] [name]
//       （不传参数则用 .env 的 ADMIN_USER/ADMIN_PASS，缺省 admin / admin123）
import 'dotenv/config';
import { query } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

const username = process.argv[2] || process.env.ADMIN_USER || 'admin';
const password = process.argv[3] || process.env.ADMIN_PASS || 'admin123';
const name = process.argv[4] || '管理员';

async function main() {
  const r = await query(
    `INSERT INTO accounts (org_id, username, password_hash, name, role)
     VALUES (1, $1, $2, $3, 'admin')
     ON CONFLICT (username) DO UPDATE SET password_hash = $2, name = $3, active = true
     RETURNING id, username, name, role`,
    [username, hashPassword(password), name],
  );
  console.log('admin ready:', r.rows[0]);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
