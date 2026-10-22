// 学员 CRUD
import { Router } from 'express';
import { query } from '../db.js';
import { err } from '../auth.js';

const router = Router();
const LIST_SQL = `SELECT id, name, phone, grade, school, parent_phone, notes, balance, payload, active,
  created_at, updated_at FROM students WHERE org_id = $1 AND owner_id = $2`;
const ORDER = ' ORDER BY active DESC, created_at DESC';

// GET /api/students?name=&grade=&active=
router.get('/', async (req, res) => {
  const { name, grade, active } = req.query;
  const cond = ['org_id = $1', 'owner_id = $2'];
  const params = [req.user.org_id ?? 1, req.user.uid];
  if (name) { params.push(String(name).trim()); cond.push(`name ILIKE '%' || $${params.length} || '%'`); }
  if (grade) { params.push(String(grade).trim()); cond.push(`grade = $${params.length}`); }
  if (active === 'true' || active === 'false') { params.push(active === 'true'); cond.push(`active = $${params.length}`); }
  try {
    const r = await query(LIST_SQL.replace('WHERE org_id = $1 AND owner_id = $2', 'WHERE ' + cond.join(' AND ')) + ORDER, params);
    res.json({ students: r.rows });
  } catch (e) {
    err(res, 'DB_ERROR', '查询学员失败：' + (e?.message ?? e), 500);
  }
});

// POST /api/students
router.post('/', async (req, res) => {
  const { name, phone, grade, school, parent_phone, notes, balance, payload } = req.body || {};
  if (!name) return err(res, 'MISSING_FIELDS', '学员姓名必填');
  try {
    const r = await query(
      `INSERT INTO students (org_id, owner_id, name, phone, grade, school, parent_phone, notes, balance, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user.org_id ?? 1, req.user.uid, String(name).trim(), phone ?? null, grade ?? null, school ?? null,
        parent_phone ?? null, notes ?? null, balance ?? 0, JSON.stringify(payload ?? {})],
    );
    res.status(201).json({ student: r.rows[0] });
  } catch (e) {
    err(res, 'DB_ERROR', '新增学员失败：' + (e?.message ?? e), 500);
  }
});

// PUT /api/students/:id
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { name, phone, grade, school, parent_phone, notes, balance, payload, active } = req.body || {};
  if (!Number.isFinite(id)) return err(res, 'BAD_ID', '学员 ID 无效');
  if (name === '') return err(res, 'MISSING_FIELDS', '学员姓名不能为空');
  try {
    const r = await query(
      `UPDATE students SET name = COALESCE($2, name), phone = COALESCE($3, phone),
        grade = COALESCE($4, grade), school = COALESCE($5, school),
        parent_phone = COALESCE($6, parent_phone), notes = COALESCE($7, notes),
        balance = COALESCE($8, balance), payload = CASE WHEN $9::text IS NULL THEN payload ELSE $9::jsonb END,
        active = COALESCE($10, active), updated_at = now()
       WHERE id = $1 AND org_id = $11 AND owner_id = $12 RETURNING *`,
      [id, name ?? null, phone ?? null, grade ?? null, school ?? null, parent_phone ?? null,
        notes ?? null, balance ?? null, payload == null ? null : JSON.stringify(payload),
        active ?? null, req.user.org_id ?? 1, req.user.uid],
    );
    if (!r.rows[0]) return err(res, 'NOT_FOUND', '学员不存在', 404);
    res.json({ student: r.rows[0] });
  } catch (e) {
    err(res, 'DB_ERROR', '更新学员失败：' + (e?.message ?? e), 500);
  }
});

// DELETE /api/students/:id
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const r = await query('DELETE FROM students WHERE id = $1 AND org_id = $2 AND owner_id = $3', [id, req.user.org_id ?? 1, req.user.uid]);
    if (!r.rowCount) return err(res, 'NOT_FOUND', '学员不存在', 404);
    res.json({ ok: true });
  } catch (e) {
    err(res, 'DB_ERROR', '删除学员失败：' + (e?.message ?? e), 500);
  }
});

export default router;
