// 成绩 / 公告 / 设置
import { Router } from 'express';
import { query } from '../db.js';
import { err } from '../auth.js';

const router = Router();

// —— 成绩 ——
// GET /api/scores?student_id=
router.get('/scores', async (req, res) => {
  const { student_id } = req.query;
  const cond = ['s.org_id = $1', 's.owner_id = $2'];
  const params = [req.user.org_id ?? 1, req.user.uid];
  if (student_id) { params.push(Number(student_id)); cond.push(`s.student_id = $${params.length}`); }
  try {
    const r = await query(
      `SELECT s.id, s.student_id, s.exam_name, s.subject, s.score, s.total, s.note, s.payload, s.created_at,
         st.name AS student_name
       FROM scores s JOIN students st ON st.id = s.student_id
       WHERE ${cond.join(' AND ')} ORDER BY s.created_at DESC`, params);
    res.json({ scores: r.rows });
  } catch (e) {
    err(res, 'DB_ERROR', '查询成绩失败：' + (e?.message ?? e), 500);
  }
});

// POST /api/scores
router.post('/scores', async (req, res) => {
  const { student_id, exam_name, subject, score, total, note, payload } = req.body || {};
  if (!student_id) return err(res, 'MISSING_FIELDS', '请选择学员');
  try {
    const r = await query(
      `INSERT INTO scores (org_id, owner_id, student_id, exam_name, subject, score, total, note, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user.org_id ?? 1, req.user.uid, Number(student_id), exam_name ?? null, subject ?? null,
        score ?? null, total ?? null, note ?? null, JSON.stringify(payload ?? {})],
    );
    res.status(201).json({ score: r.rows[0] });
  } catch (e) {
    err(res, 'DB_ERROR', '新增成绩失败：' + (e?.message ?? e), 500);
  }
});

// DELETE /api/scores/:id
router.delete('/scores/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const r = await query('DELETE FROM scores WHERE id = $1 AND org_id = $2 AND owner_id = $3', [id, req.user.org_id ?? 1, req.user.uid]);
    if (!r.rowCount) return err(res, 'NOT_FOUND', '成绩不存在', 404);
    res.json({ ok: true });
  } catch (e) {
    err(res, 'DB_ERROR', '删除成绩失败：' + (e?.message ?? e), 500);
  }
});

// —— 公告 ——
// GET /api/announcements
router.get('/announcements', async (req, res) => {
  try {
    const r = await query(
      'SELECT id, title, content, active, payload, created_at FROM announcements WHERE org_id = $1 ORDER BY created_at DESC',
      [req.user.org_id ?? 1]);
    res.json({ announcements: r.rows });
  } catch (e) {
    err(res, 'DB_ERROR', '查询公告失败：' + (e?.message ?? e), 500);
  }
});

// POST /api/announcements
router.post('/announcements', async (req, res) => {
  const { title, content } = req.body || {};
  if (!title) return err(res, 'MISSING_FIELDS', '公告标题必填');
  try {
    const r = await query(
      'INSERT INTO announcements (org_id, title, content) VALUES ($1,$2,$3) RETURNING *',
      [req.user.org_id ?? 1, String(title).trim(), content ?? null]);
    res.status(201).json({ announcement: r.rows[0] });
  } catch (e) {
    err(res, 'DB_ERROR', '新增公告失败：' + (e?.message ?? e), 500);
  }
});

// PUT /api/announcements/:id  { title, content, active, expireAt }
router.put('/announcements/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { title, content, active, expireAt } = req.body || {};
  try {
    const old = await query('SELECT payload FROM announcements WHERE id = $1 AND org_id = $2', [
      id,
      req.user.org_id ?? 1,
    ]);
    if (!old.rows[0]) return err(res, 'NOT_FOUND', '公告不存在', 404);
    const payload = { ...(old.rows[0].payload ?? {}) };
    if (expireAt !== undefined) payload.expireAt = String(expireAt).trim();
    const r = await query(
      `UPDATE announcements SET title = COALESCE($2, title), content = COALESCE($3, content),
        active = COALESCE($4, active), payload = $5 WHERE id = $1 AND org_id = $6 RETURNING *`,
      [id, title ?? null, content ?? null, active ?? null, JSON.stringify(payload), req.user.org_id ?? 1]);
    res.json({ announcement: r.rows[0] });
  } catch (e) {
    err(res, 'DB_ERROR', '更新公告失败：' + (e?.message ?? e), 500);
  }
});

// DELETE /api/announcements/:id
router.delete('/announcements/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const r = await query('DELETE FROM announcements WHERE id = $1 AND org_id = $2', [id, req.user.org_id ?? 1]);
    if (!r.rowCount) return err(res, 'NOT_FOUND', '公告不存在', 404);
    res.json({ ok: true });
  } catch (e) {
    err(res, 'DB_ERROR', '删除公告失败：' + (e?.message ?? e), 500);
  }
});

// —— 设置（JSONB 整体读写，按账号隔离）——
// GET /api/settings
router.get('/settings', async (req, res) => {
  try {
    const r = await query('SELECT payload FROM settings WHERE org_id = $1 AND owner_id = $2', [
      req.user.org_id ?? 1,
      req.user.uid,
    ]);
    res.json({ settings: r.rows[0]?.payload ?? {} });
  } catch (e) {
    err(res, 'DB_ERROR', '读取设置失败：' + (e?.message ?? e), 500);
  }
});

// PUT /api/settings  { settings: {...} }  整体替换（前端保存全量设置）
router.put('/settings', async (req, res) => {
  const { settings } = req.body || {};
  if (!settings || typeof settings !== 'object') return err(res, 'MISSING_FIELDS', '设置内容无效');
  try {
    await query(
      `INSERT INTO settings (org_id, owner_id, payload) VALUES ($1, $2, $3)
       ON CONFLICT (org_id, owner_id) DO UPDATE SET payload = $3, updated_at = now()`,
      [req.user.org_id ?? 1, req.user.uid, JSON.stringify(settings)]);
    res.json({ ok: true, settings });
  } catch (e) {
    err(res, 'DB_ERROR', '保存设置失败：' + (e?.message ?? e), 500);
  }
});

export default router;
