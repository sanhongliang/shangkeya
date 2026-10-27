// 学员 CRUD
import { Router } from 'express';
import { query } from '../db.js';
import { err } from '../auth.js';

const router = Router();
const ORDER = ' ORDER BY active DESC, created_at DESC';

// 学员头像底色：校长端创建的学生可能没有 boardColor，按 fid 稳定取色（与桌面端 seed 调色板一致）
const BOARD_COLORS = ['#1677ff', '#52c41a', '#fa8c16', '#722ed1', '#13c2c2'];
function boardColorOf(key) {
  const k = String(key ?? '');
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return BOARD_COLORS[h % BOARD_COLORS.length];
}

// GET /api/students?name=&grade=&active=
// 返回：自己添加的学生 + 学校师生关系中分配给该老师的学生
// 注意：name/grade/active 是对归属结果再筛选（AND），不能 OR，否则会把本组织其他老师的学生也拉出来
router.get('/', async (req, res) => {
  const { name, grade, active } = req.query;
  const params = [req.user.org_id ?? 1, req.user.uid];
  const base =
    '(st.org_id = $1 AND st.owner_id = $2)' +
    " OR st.id IN (SELECT ts.student_id FROM teacher_students ts WHERE ts.teacher_id = $2 AND ts.archived_at IS NULL)";
  const filters = [];
  if (name) { params.push(String(name).trim()); filters.push(`st.name ILIKE '%' || $${params.length} || '%'`); }
  if (grade) { params.push(String(grade).trim()); filters.push(`st.grade = $${params.length}`); }
  if (active === 'true' || active === 'false') { params.push(active === 'true'); filters.push(`st.active = $${params.length}`); }
  const where = `(${base})` + (filters.length ? ' AND ' + filters.join(' AND ') : '');
  try {
    const r = await query(
      `SELECT st.id, st.name, st.phone, st.grade, st.school, st.parent_phone, st.notes, st.balance, st.payload, st.active,
              st.created_at, st.updated_at, st.owner_id
       FROM students st WHERE ${where}${ORDER}`,
      params,
    );
    // 按前端 fid 去重 + 标记共享来源（同一学员可能以「自己添加」与「师生关系共享」同时出现）
    const seen = new Map(); // fid → row
    for (const row of r.rows) {
      const fid = row.payload?._fid ?? (row.payload?.student?.id ?? `stu-${row.id}`);
      const isSelf = Number(row.owner_id) === Number(req.user.uid);
      const prev = seen.get(fid);
      if (!prev) {
        seen.set(fid, { ...row, shared: !isSelf });
      } else if (isSelf && prev.shared) {
        seen.set(fid, { ...row, shared: false });
      }
    }
    const out = [];
    for (const row of seen.values()) {
      const { owner_id, shared, ...rest } = row;
      const fid = rest.payload?._fid ?? (rest.payload?.student?.id ?? `stu-${rest.id}`);
      const payload = { ...(rest.payload ?? {}), student: { ...(rest.payload?.student ?? {}), boardColor: rest.payload?.student?.boardColor || boardColorOf(fid) } };
      out.push({ ...rest, payload, ...(shared ? { shared: true } : {}) });
    }
    res.json({ students: out });
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
    // 学校关联学员（机构分配学员）老师端不能删除——按 fid 匹配 teacher_students
    const fidRes = await query(
      `SELECT payload->'student'->>'id' AS fid, payload->>'_fid' AS pfid FROM students WHERE id = $1`,
      [id],
    );
    const fid = fidRes.rows[0]?.fid ?? fidRes.rows[0]?.pfid ?? (fidRes.rows[0] ? `stu-${id}` : null);
    if (fid) {
      const ts = await query(
        `SELECT 1 FROM teacher_students ts JOIN students st ON ts.student_id = st.id
         WHERE ts.teacher_id = $1 AND (st.payload->'student'->>'id' = $2 OR st.payload->>'_fid' = $2 OR 'stu-' || st.id = $2) LIMIT 1`,
        [req.user.uid, fid],
      );
      if (ts.rows.length) return err(res, 'FORBIDDEN', '学校学员不能删除', 403);
    }
    const r = await query('DELETE FROM students WHERE id = $1 AND org_id = $2 AND owner_id = $3', [id, req.user.org_id ?? 1, req.user.uid]);
    if (!r.rowCount) return err(res, 'NOT_FOUND', '学员不存在', 404);
    res.json({ ok: true });
  } catch (e) {
    err(res, 'DB_ERROR', '删除学员失败：' + (e?.message ?? e), 500);
  }
});

export default router;
