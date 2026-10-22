// 认证路由：登录 / 注册(图形验证码) / 修改密码
import { Router } from 'express';
import { query } from '../db.js';
import { signToken, verifyPassword, hashPassword, err, requireAuth } from '../auth.js';
import { randomCaptchaText, makeCaptchaSvg } from '../captcha.js';

const router = Router();

// ---------------- 图形验证码（注册用，内存一次性，5 分钟有效） ----------------
const CAPTCHA_TTL = 5 * 60 * 1000;
const _captchas = new Map(); // captcha_id -> { text, expires }

function cleanCaptchas() {
  const now = Date.now();
  for (const [k, v] of _captchas) {
    if (v.expires < now) _captchas.delete(k);
  }
}

// GET /api/auth/captcha  → { captcha_id, img(dataURL) }
router.get('/captcha', (_req, res) => {
  cleanCaptchas();
  try {
    const text = randomCaptchaText(4);
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const img = makeCaptchaSvg(text);
    _captchas.set(id, { text, expires: Date.now() + CAPTCHA_TTL });
    res.json({ captcha_id: id, img });
  } catch (e) {
    err(res, 'CAPTCHA_ERROR', '验证码生成失败：' + (e?.message ?? e), 500);
  }
});

// POST /api/auth/register  { username, password, captcha_id, captcha }
// 注册教师账号（org_id 默认 1），赠送 7 天试用
router.post('/register', async (req, res) => {
  const { username, password, captcha_id, captcha } = req.body || {};
  if (!username || !password) return err(res, 'MISSING_FIELDS', '请输入用户名和密码');
  const u = String(username).trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(u)) {
    return err(res, 'BAD_USERNAME', '账号需为3~20位字母、数字或下划线');
  }
  if (String(password).length < 6 || String(password).length > 32) {
    return err(res, 'BAD_PASSWORD', '密码长度需为6~32位');
  }
  const cid = String(captcha_id || '').trim();
  const code = String(captcha || '').trim().toUpperCase();
  cleanCaptchas();
  const item = _captchas.get(cid);
  if (cid) _captchas.delete(cid); // 一次性：无论成败均作废
  if (!item || item.expires < Date.now()) {
    return err(res, 'CAPTCHA_EXPIRED', '验证码已失效，请刷新后重试');
  }
  if (item.text !== code) {
    return err(res, 'CAPTCHA_WRONG', '验证码错误，请重新输入');
  }
  try {
    await query(
      `INSERT INTO accounts (org_id, username, password_hash, name, role, active, expires_at)
       VALUES (1, $1, $2, $3, 'teacher', true, now() + interval '7 days')`,
      [u, hashPassword(String(password)), u],
    );
    const r = await query('SELECT * FROM accounts WHERE username = $1 AND active = true', [u]);
    const user = r.rows[0];
    res.status(201).json({
      token: signToken(user),
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        org_id: user.org_id,
        expires_at: user.expires_at,
      },
    });
  } catch (e) {
    if (String(e?.message ?? '').includes('duplicate') || String(e?.message ?? '').includes('unique')) {
      return err(res, 'USER_EXISTS', `账号 ${u} 已存在，请直接登录`);
    }
    err(res, 'DB_ERROR', '注册失败：' + (e?.message ?? e), 500);
  }
});

// POST /api/auth/login  { username, password }
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return err(res, 'MISSING_FIELDS', '请输入用户名和密码');
  try {
    const r = await query('SELECT * FROM accounts WHERE username = $1 AND active = true', [username.trim()]);
    const user = r.rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      return err(res, 'BAD_CREDENTIALS', '用户名或密码错误', 401);
    }
    // 账号到期拦截：教师账号到期后不能登录（管理员不受限）
    if (user.role === 'teacher' && (!user.expires_at || new Date(user.expires_at).getTime() <= Date.now())) {
      return err(res, 'ACCOUNT_EXPIRED', '账号已到期，请先充值续期', 403);
    }
    res.json({
      token: signToken(user),
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        org_id: user.org_id,
        expires_at: user.expires_at,
      },
    });
  } catch (e) {
    err(res, 'DB_ERROR', '登录失败：' + (e?.message ?? e), 500);
  }
});

// GET /api/auth/me  → 当前账号信息（含到期时间，登录态）
router.get('/me', requireAuth, async (req, res) => {
  try {
    const r = await query(
      'SELECT id, username, name, role, org_id, expires_at FROM accounts WHERE id = $1 AND active = true',
      [req.user.uid],
    );
    if (!r.rows[0]) return err(res, 'NOT_FOUND', '账号不存在', 404);
    res.json({ ok: true, user: r.rows[0] });
  } catch (e) {
    err(res, 'DB_ERROR', '查询失败：' + (e?.message ?? e), 500);
  }
});

// POST /api/auth/change-password  { oldPassword, newPassword }
router.post('/change-password', requireAuth, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) return err(res, 'MISSING_FIELDS', '请输入旧密码和新密码');
  if (String(newPassword).length < 6) return err(res, 'WEAK_PASSWORD', '新密码至少 6 位');
  try {
    const r = await query('SELECT * FROM accounts WHERE id = $1', [req.user.uid]);
    const user = r.rows[0];
    if (!user || !verifyPassword(oldPassword, user.password_hash)) {
      return err(res, 'BAD_CREDENTIALS', '旧密码错误', 400);
    }
    await query('UPDATE accounts SET password_hash = $1, updated_at = now() WHERE id = $2', [
      hashPassword(newPassword),
      req.user.uid,
    ]);
    res.json({ ok: true });
  } catch (e) {
    err(res, 'DB_ERROR', '修改失败：' + (e?.message ?? e), 500);
  }
});

export default router;
