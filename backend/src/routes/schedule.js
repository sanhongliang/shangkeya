// 课表 CRUD（核心：手机端查看/编辑）
import { Router } from 'express';
import { query } from '../db.js';
import { err } from '../auth.js';

const router = Router();

const LIST_SQL = `
  SELECT s.id, s.student_id, s.course_id, s.start_at, s.end_at, s.teacher_id,
         s.status, s.notes, s.payload, s.payload->>'summary' AS summary, s.created_at, s.updated_at,
         st.name AS student_name, st.grade AS student_grade,
         COALESCE(c.name, s.payload->'course'->>'content') AS course_name,
         COALESCE(c.subject, s.payload->'course'->>'subject') AS course_subject,
         a.name AS teacher_name
  FROM schedule s
  JOIN students st ON st.id = s.student_id
  LEFT JOIN courses c ON c.id = s.course_id
  LEFT JOIN accounts a ON a.id = s.teacher_id
  WHERE s.org_id = $1 AND s.owner_id = $2`;

// GET /api/schedule?from=2026-10-01&to=2026-10-31&student_id=3&status=
// from/to 按本地时区日界（返回 ISO 字符串，前端按本地时区解析）
router.get('/', async (req, res) => {
  const { from, to, student_id, status } = req.query;
  const cond = ['s.org_id = $1', 's.owner_id = $2'];
  const params = [req.user.org_id ?? 1, req.user.uid];
  if (from) { params.push(from); cond.push(`s.start_at >= $${params.length}`); }
  if (to) { params.push(to + ' 23:59:59'); cond.push(`s.start_at <= $${params.length}`); }
  if (student_id) { params.push(Number(student_id)); cond.push(`s.student_id = $${params.length}`); }
  if (status) { params.push(String(status)); cond.push(`s.status = $${params.length}`); }
  try {
    const extra = cond.slice(2).length ? ' AND ' + cond.slice(2).join(' AND ') : '';
    const r = await query(LIST_SQL + extra + ' ORDER BY s.start_at', params);
    res.json({ schedule: r.rows });
  } catch (e) {
    err(res, 'DB_ERROR', '查询课表失败：' + (e?.message ?? e), 500);
  }
});

// GET /api/schedule/:id
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const r = await query(LIST_SQL + ' AND s.id = $3', [req.user.org_id ?? 1, req.user.uid, id]);
    if (!r.rows[0]) return err(res, 'NOT_FOUND', '课次不存在', 404);
    res.json({ entry: r.rows[0] });
  } catch (e) {
    err(res, 'DB_ERROR', '查询课次失败：' + (e?.message ?? e), 500);
  }
});

// POST /api/schedule  { student_id, course_id, start_at, end_at, status, notes, payload, teacher_id }
router.post('/', async (req, res) => {
  const { student_id, course_id, start_at, end_at, status, notes, payload, teacher_id } = req.body || {};
  if (!student_id || !start_at || !end_at) {
    return err(res, 'MISSING_FIELDS', '学员、开始/结束时间必填');
  }
  try {
    const r = await query(
      `INSERT INTO schedule (org_id, owner_id, student_id, course_id, start_at, end_at, teacher_id, status, notes, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user.org_id ?? 1, req.user.uid, Number(student_id), course_id ? Number(course_id) : null, new Date(start_at), new Date(end_at),
        teacher_id ? Number(teacher_id) : null, status ?? 'scheduled', notes ?? null,
        JSON.stringify(payload ?? {})],
    );
    res.status(201).json({ entry: r.rows[0] });
  } catch (e) {
    err(res, 'DB_ERROR', '新增课次失败：' + (e?.message ?? e), 500);
  }
});

// PUT /api/schedule/:id
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  if (!Number.isFinite(id)) return err(res, 'BAD_ID', '课次 ID 无效');
  const hasCourse = Object.prototype.hasOwnProperty.call(body, 'course_id');
  const hasStudent = Object.prototype.hasOwnProperty.call(body, 'student_id');
  try {
    const sets = [];
    const params = [id];
    let n = 2;
    if (hasStudent) { sets.push(`student_id = $${n}::bigint`); params.push(Number(body.student_id)); n++; }
    if (hasCourse) { sets.push(`course_id = $${n}::bigint`); params.push(body.course_id ? Number(body.course_id) : null); n++; }
    sets.push(`start_at = COALESCE($${n}, start_at)`); params.push(body.start_at ? new Date(body.start_at) : null); n++;
    sets.push(`end_at = COALESCE($${n}, end_at)`); params.push(body.end_at ? new Date(body.end_at) : null); n++;
    sets.push(`teacher_id = CASE WHEN $${n}::text = '' THEN NULL ELSE COALESCE($${n}::bigint, teacher_id) END`);
    params.push(body.teacher_id == null ? null : String(body.teacher_id)); n++;
    sets.push(`status = COALESCE($${n}, status)`); params.push(body.status ?? null); n++;
    sets.push(`notes = COALESCE($${n}, notes)`); params.push(body.notes ?? null); n++;
    sets.push(`payload = CASE WHEN $${n}::text IS NULL THEN payload ELSE $${n}::jsonb END`);
    params.push(body.payload == null ? null : JSON.stringify(body.payload)); n++;
    params.push(req.user.org_id ?? 1);
    params.push(req.user.uid);
    const sql = `UPDATE schedule SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND org_id = $${n} AND owner_id = $${n + 1} RETURNING *`;
    const r = await query(sql, params);
    if (!r.rows[0]) return err(res, 'NOT_FOUND', '课次不存在', 404);
    res.json({ entry: r.rows[0] });
  } catch (e) {
    err(res, 'DB_ERROR', '更新课次失败：' + (e?.message ?? e), 500);
  }
});

// DELETE /api/schedule/:id
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const r = await query('DELETE FROM schedule WHERE id = $1 AND org_id = $2 AND owner_id = $3', [id, req.user.org_id ?? 1, req.user.uid]);
    if (!r.rowCount) return err(res, 'NOT_FOUND', '课次不存在', 404);
    res.json({ ok: true });
  } catch (e) {
    err(res, 'DB_ERROR', '删除课次失败：' + (e?.message ?? e), 500);
  }
});

export default router;
