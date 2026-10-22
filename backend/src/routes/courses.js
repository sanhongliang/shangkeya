// 课程 CRUD
import { Router } from 'express';
import { query } from '../db.js';
import { err } from '../auth.js';

const router = Router();

// GET /api/courses?subject=&grade=&active=
router.get('/', async (req, res) => {
  const { subject, grade, active } = req.query;
  const cond = ['org_id = $1', 'owner_id = $2'];
  const params = [req.user.org_id ?? 1, req.user.uid];
  if (subject) { params.push(String(subject).trim()); cond.push(`subject = $${params.length}`); }
  if (grade) { params.push(String(grade).trim()); cond.push(`grade = $${params.length}`); }
  if (active === 'true' || active === 'false') { params.push(active === 'true'); cond.push(`active = $${params.length}`); }
  try {
    const r = await query(
      `SELECT id, name, subject, grade, duration_min, price, notes, active, created_at, updated_at
       FROM courses WHERE ${cond.join(' AND ')} ORDER BY active DESC, name`, params);
    res.json({ courses: r.rows });
  } catch (e) {
    err(res, 'DB_ERROR', '查询课程失败：' + (e?.message ?? e), 500);
  }
});

// POST /api/courses
router.post('/', async (req, res) => {
  const { name, subject, grade, duration_min, price, notes } = req.body || {};
  if (!name) return err(res, 'MISSING_FIELDS', '课程名称必填');
  try {
    const r = await query(
      `INSERT INTO courses (org_id, owner_id, name, subject, grade, duration_min, price, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.org_id ?? 1, req.user.uid, String(name).trim(), subject ?? null, grade ?? null,
        duration_min ?? 60, price ?? null, notes ?? null],
    );
    res.status(201).json({ course: r.rows[0] });
  } catch (e) {
    err(res, 'DB_ERROR', '新增课程失败：' + (e?.message ?? e), 500);
  }
});

// PUT /api/courses/:id
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { name, subject, grade, duration_min, price, notes, active } = req.body || {};
  if (!Number.isFinite(id)) return err(res, 'BAD_ID', '课程 ID 无效');
  if (name === '') return err(res, 'MISSING_FIELDS', '课程名称不能为空');
  try {
    const r = await query(
      `UPDATE courses SET name = COALESCE($2, name), subject = COALESCE($3, subject),
        grade = COALESCE($4, grade), duration_min = COALESCE($5, duration_min),
        price = COALESCE($6, price), notes = COALESCE($7, notes),
        active = COALESCE($8, active), updated_at = now()
       WHERE id = $1 AND org_id = $9 AND owner_id = $10 RETURNING *`,
      [id, name ?? null, subject ?? null, grade ?? null, duration_min ?? null,
        price ?? null, notes ?? null, active ?? null, req.user.org_id ?? 1, req.user.uid],
    );
    if (!r.rows[0]) return err(res, 'NOT_FOUND', '课程不存在', 404);
    res.json({ course: r.rows[0] });
  } catch (e) {
    err(res, 'DB_ERROR', '更新课程失败：' + (e?.message ?? e), 500);
  }
});

// DELETE /api/courses/:id
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const r = await query('DELETE FROM courses WHERE id = $1 AND org_id = $2 AND owner_id = $3', [id, req.user.org_id ?? 1, req.user.uid]);
    if (!r.rowCount) return err(res, 'NOT_FOUND', '课程不存在', 404);
    res.json({ ok: true });
  } catch (e) {
    err(res, 'DB_ERROR', '删除课程失败：' + (e?.message ?? e), 500);
  }
});

export default router;
