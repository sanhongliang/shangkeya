// 充值/扣费 与 学员余额联动
import { Router } from 'express';
import { query, withTx } from '../db.js';
import { err } from '../auth.js';

const router = Router();

// GET /api/recharges?student_id=
router.get('/', async (req, res) => {
  const { student_id } = req.query;
  const cond = ['org_id = $1', 'owner_id = $2'];
  const params = [req.user.org_id ?? 1, req.user.uid];
  if (student_id) { params.push(Number(student_id)); cond.push(`student_id = $${params.length}`); }
  try {
    const r = await query(
      `SELECT id, student_id, amount, type, note, payload, created_at FROM recharges
       WHERE ${cond.join(' AND ')} ORDER BY created_at DESC`, params);
    res.json({ recharges: r.rows });
  } catch (e) {
    err(res, 'DB_ERROR', '查询记录失败：' + (e?.message ?? e), 500);
  }
});

// POST /api/recharges  { student_id, amount, type, note, payload }
// type: recharge(充值) consume(扣费/消课) refund(退款)；余额同步增减
router.post('/', async (req, res) => {
  const { student_id, amount, type, note, payload } = req.body || {};
  if (!student_id || amount == null) return err(res, 'MISSING_FIELDS', '学员与金额必填');
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt === 0) return err(res, 'BAD_AMOUNT', '金额无效');
  const t = type ?? 'recharge';
  try {
    const r = await withTx(async (client) => {
      const ins = await client.query(
        `INSERT INTO recharges (org_id, owner_id, student_id, amount, type, note, payload) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [req.user.org_id ?? 1, req.user.uid, Number(student_id), amt, t, note ?? null, JSON.stringify(payload ?? {})],
      );
      const delta = t === 'consume' ? -amt : amt;
      const upd = await client.query(
        'UPDATE students SET balance = balance + $1, updated_at = now() WHERE id = $2 AND org_id = $3 AND owner_id = $4 RETURNING balance',
        [delta, Number(student_id), req.user.org_id ?? 1, req.user.uid],
      );
      return { record: ins.rows[0], balance: upd.rows[0]?.balance ?? null };
    });
    res.status(201).json(r);
  } catch (e) {
    err(res, 'DB_ERROR', '操作失败：' + (e?.message ?? e), 500);
  }
});

export default router;
