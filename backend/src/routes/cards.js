// 充值卡（学习鸭方式：管理后台生成卡密，老师端凭卡号给自己的账号续期）
// 卡号格式：XXXX-XXXX-XXXX-XXXX（16 位，去易混淆字符）
// 卡类型：周卡 7 天 / 月卡 30 天 / 半年卡 180 天 / 年卡 365 天（gen 可传 type 或 days）
import { Router } from 'express';
import { query, withTx } from '../db.js';
import { err, verifyToken, verifyPassword, signToken } from '../auth.js';

const router = Router();

const CARD_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const DURATION_MAP = { week: 7, month: 30, half_year: 180, year: 365 };
const TYPE_LABEL = { 7: '周卡', 30: '月卡', 180: '半年卡', 365: '年卡' };

function typeLabel(days) {
  const n = Number(days);
  return TYPE_LABEL[n] || `${n}天卡`;
}

function genCode() {
  for (;;) {
    let raw = '';
    for (let i = 0; i < 16; i += 1) {
      raw += CARD_CHARS[Math.floor(Math.random() * CARD_CHARS.length)];
    }
    const code = raw.match(/.{1,4}/g).join('-');
    return code;
  }
}

function orgId(req) {
  return Number(req.user?.org_id ?? 1);
}

function isAdmin(req) {
  return req.user?.role === 'admin';
}

/** 校验管理员权限 */
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return err(res, 'FORBIDDEN', '需要管理员权限', 403);
  next();
}

// GET /api/cards/health  → 卡类型配置（登录可用）
router.get('/health', async (_req, res) => {
  try {
    res.json({ ok: true, types: [{ type: 'week', label: '周卡(7天)', days: 7 }, { type: 'month', label: '月卡(30天)', days: 30 }, { type: 'half_year', label: '半年卡(180天)', days: 180 }, { type: 'year', label: '年卡(365天)', days: 365 }] });
  } catch (e) {
    err(res, 'DB_ERROR', '查询失败：' + (e?.message ?? e), 500);
  }
});

// POST /api/cards/redeem  { code } 或 { code, username, password }
// - 已登录：给当前账号续期
// - 未登录：校验账号密码后给该账号续期（到期账号自救），成功返回新 token
export async function redeemHandler(req, res) {
  const { code, username, password } = req.body || {};
  if (!code) return err(res, 'MISSING_FIELDS', '请输入充值卡号');
  const cd = String(code).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (cd.length !== 16) return err(res, 'BAD_CODE', '充值卡号无效（应为 16 位）');

  // 1) 解析目标账号：优先当前登录；无 token 则用账号密码
  let uid = null;
  let needLogin = false; // 无登录兑换成功 → 返回 token 自动登录
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) {
    try {
      const t = verifyToken(h.slice(7));
      uid = Number(t.uid);
    } catch { /* token 无效 → 走账号密码 */ }
  }
  if (!uid) {
    if (!username || !password) return err(res, 'MISSING_FIELDS', '请登录后兑换，或输入账号和密码');
    try {
      const acc = await query(
        'SELECT * FROM accounts WHERE username = $1 AND active = true',
        [String(username).trim()],
      );
      if (!acc.rows[0] || !verifyPassword(String(password), acc.rows[0].password_hash)) {
        return err(res, 'BAD_CREDENTIALS', '账号或密码错误', 401);
      }
      uid = Number(acc.rows[0].id);
      needLogin = true;
    } catch (e) {
      return err(res, 'DB_ERROR', '验证失败：' + (e?.message ?? e), 500);
    }
  }

  try {
    const r = await withTx(async (client) => {
      const card = await client.query(
        'SELECT * FROM cards WHERE org_id = $1 AND REPLACE(code, \'-\', \'\') = $2 FOR UPDATE',
        [orgId(req), cd],
      );
      const c = card.rows[0];
      if (!c) return { error: '卡号不存在或不属于当前机构' };
      if (c.status === 'used') return { error: '该充值卡已被使用' };
      if (c.status === 'disabled') return { error: '该充值卡已停用' };
      const acc = await client.query(
        'SELECT id, username, expires_at FROM accounts WHERE id = $1 AND active = true',
        [uid],
      );
      if (!acc.rows[0]) return { error: '账号不存在' };
      const up = await client.query(
        `UPDATE accounts
         SET expires_at = GREATEST(COALESCE(expires_at, now()), now()) + ($1 || ' days')::interval,
             updated_at = now()
         WHERE id = $2
         RETURNING id, username, role, org_id, expires_at`,
        [c.duration_days, uid],
      );
      await client.query(
        `UPDATE cards SET status = 'used', used_by = $1, used_at = now() WHERE id = $2`,
        [uid, c.id],
      );
      const result = { ok: true, days: Number(c.duration_days), type: typeLabel(c.duration_days), code: c.code, expires_at: up.rows[0].expires_at };
      if (needLogin) result.token = signToken(up.rows[0]);
      return result;
    });
    if (r.error) return err(res, 'REDEEM_FAILED', r.error, 400);
    res.json(r);
  } catch (e) {
    err(res, 'DB_ERROR', '兑换失败：' + (e?.message ?? e), 500);
  }
}

// ---------------- 管理后台：充值卡管理（仅 admin） ----------------

// POST /api/cards/gen  { type? | days?, count } → 批量生成卡密
router.post('/gen', requireAdmin, async (req, res) => {
  const b = req.body || {};
  let days = Number(b.days);
  if (!Number.isFinite(days) || days <= 0) {
    days = DURATION_MAP[String(b.type || 'month')] || 30;
  }
  days = Math.max(1, Math.min(3650, Math.floor(days)));
  let count = Number(b.count || 1);
  count = Math.max(1, Math.min(500, Number.isFinite(count) ? Math.floor(count) : 1));
  try {
    const codes = [];
    await withTx(async (client) => {
      for (let i = 0; i < count; i += 1) {
        const code = genCode();
        await client.query(
          'INSERT INTO cards (org_id, code, duration_days, status) VALUES ($1, $2, $3, \'unused\')',
          [orgId(req), code, days],
        );
        codes.push(code);
      }
    });
    res.status(201).json({ ok: true, count, days, type: typeLabel(days), codes });
  } catch (e) {
    err(res, 'DB_ERROR', '生成失败：' + (e?.message ?? e), 500);
  }
});

// GET /api/cards/list?status=unused|used|disabled|all&page=1&size=50
router.get('/list', requireAdmin, async (req, res) => {
  const status = String(req.query.status || 'all');
  const page = Math.max(1, Number(req.query.page || 1));
  const size = Math.min(200, Math.max(1, Number(req.query.size || 50)));
  const cond = ['c.org_id = $1'];
  const params = [orgId(req)];
  if (['unused', 'used', 'disabled'].includes(status)) {
    params.push(status);
    cond.push(`c.status = $${params.length}`);
  }
  try {
    const totalR = await query(`SELECT COUNT(*) n FROM cards c WHERE ${cond.join(' AND ')}`, params);
    const rows = await query(
      `SELECT c.id, c.code, c.duration_days, c.status, c.used_by, c.used_at, c.created_at,
              a.username AS account_name
       FROM cards c LEFT JOIN accounts a ON a.id = c.used_by
       WHERE ${cond.join(' AND ')} ORDER BY c.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, size, (page - 1) * size],
    );
    const cards = rows.rows.map((c) => ({ ...c, type: typeLabel(c.duration_days) }));
    res.json({ ok: true, total: Number(totalR.rows[0].n), page, size, cards });
  } catch (e) {
    err(res, 'DB_ERROR', '查询失败：' + (e?.message ?? e), 500);
  }
});

// POST /api/cards/toggle  { id, status }  → disabled / unused
router.post('/toggle', requireAdmin, async (req, res) => {
  const { id, status } = req.body || {};
  if (!['disabled', 'unused'].includes(status)) return err(res, 'BAD_STATUS', '状态无效');
  try {
    await query('UPDATE cards SET status = $1 WHERE id = $2 AND org_id = $3', [status, Number(id), orgId(req)]);
    res.json({ ok: true });
  } catch (e) {
    err(res, 'DB_ERROR', '更新失败：' + (e?.message ?? e), 500);
  }
});

// GET /api/cards/stats  → 卡统计 + 老师到期统计（admin）
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const [cardsR, teachersR] = await Promise.all([
      query(
        `SELECT status, COUNT(*) n, COALESCE(SUM(duration_days),0) total FROM cards
         WHERE org_id = $1 GROUP BY status`,
        [orgId(req)],
      ),
      query(
        `SELECT COUNT(*) n,
                COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at > now()) AS normal,
                COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at > now() AND expires_at <= now() + interval '7 days') AS soon,
                COUNT(*) FILTER (WHERE expires_at IS NULL OR expires_at <= now()) AS expired
         FROM accounts WHERE org_id = $1 AND role = 'teacher'`,
        [orgId(req)],
      ),
    ]);
    const by = {};
    for (const row of cardsR.rows) by[row.status] = { count: Number(row.n), total: Number(row.total) };
    res.json({ ok: true, stats: by, teachers: teachersR.rows[0] });
  } catch (e) {
    err(res, 'DB_ERROR', '统计失败：' + (e?.message ?? e), 500);
  }
});

// GET /api/cards/teachers  → 老师列表（admin）：用户名/注册时间/到期时间/剩余天数/状态
router.get('/teachers', requireAdmin, async (req, res) => {
  try {
    const r = await query(
      `SELECT id, username, name, created_at, expires_at,
              CASE WHEN expires_at IS NULL THEN NULL
                   ELSE ROUND((EXTRACT(EPOCH FROM (expires_at - now())) / 86400)::numeric, 1)
              END AS days_left
       FROM accounts
       WHERE org_id = $1 AND role = 'teacher'
       ORDER BY id DESC`,
      [orgId(req)],
    );
    const teachers = r.rows.map((t) => {
      let status = 'normal';
      if (t.expires_at == null || Number(t.days_left) <= 0) status = 'expired';
      else if (Number(t.days_left) <= 7) status = 'soon';
      return { ...t, days_left: t.days_left == null ? null : Number(t.days_left), status };
    });
    res.json({ ok: true, teachers });
  } catch (e) {
    err(res, 'DB_ERROR', '查询失败：' + (e?.message ?? e), 500);
  }
});

export default router;
