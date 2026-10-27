// 校长端：学校开通（admin）/ 老师申请加入 / 校长管理（学员/师生关系/排课/统计）
import { Router } from 'express';
import { query } from '../db.js';
import { err, requireAuth } from '../auth.js';

const router = Router();

function isAdmin(req) { return req.user?.role === 'admin'; }
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return err(res, 'FORBIDDEN', '需要管理员权限', 403);
  next();
}

// 校长身份：登录用户必须是某学校 owner
async function requirePrincipal(req, res, next) {
  if (!req.user) return err(res, 'UNAUTHORIZED', '未登录', 401);
  try {
    const r = await query('SELECT * FROM schools WHERE owner_id = $1 AND active = true', [req.user.uid]);
    const school = r.rows[0];
    if (!school) return err(res, 'NOT_PRINCIPAL', '当前账号不是校长', 403);
    req.school = school;
    req.schoolId = school.id;
    req.orgId = Number(school.org_id);
    next();
  } catch (e) {
    err(res, 'DB_ERROR', '查询失败：' + (e?.message ?? e), 500);
  }
}

const CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function genSchoolCode() {
  let c = '';
  for (let i = 0; i < 6; i += 1) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

// ---------------- 管理后台：学校开通 / 列表 ----------------

// POST /api/schools { name, ownerUsername } → 开通学校（生成学校ID+独立org）
router.post('/schools', requireAdmin, async (req, res) => {
  const { name, ownerUsername } = req.body || {};
  if (!name || !ownerUsername) return err(res, 'MISSING_FIELDS', '请填写学校名称和校长账号');
  try {
    const acc = await query('SELECT * FROM accounts WHERE username = $1', [String(ownerUsername).trim()]);
    if (!acc.rows[0]) return err(res, 'NOT_FOUND', '校长账号不存在');
    const owner = acc.rows[0];
    if (owner.role === 'admin') return err(res, 'BAD_OWNER', '管理员账号不能作为校长');
    const has = await query('SELECT id FROM schools WHERE owner_id = $1', [owner.id]);
    if (has.rows[0]) return err(res, 'ALREADY_PRINCIPAL', '该账号已是其他学校的校长');
    const mx = await query('SELECT COALESCE(MAX(org_id), 1) + 1 AS n FROM schools');
    let orgId = Number(mx.rows[0].n);
    if (orgId < 2) orgId = 2; // 避开默认 org 1
    let code = genSchoolCode();
    for (let i = 0; i < 5; i += 1) {
      const ex = await query('SELECT id FROM schools WHERE school_code = $1', [code]);
      if (!ex.rows[0]) break;
      code = genSchoolCode();
    }
    const r = await query(
      'INSERT INTO schools (org_id, school_code, name, owner_id) VALUES ($1,$2,$3,$4) RETURNING id, org_id, school_code, name',
      [orgId, code, String(name).trim(), owner.id],
    );
    res.status(201).json({ ok: true, school: r.rows[0] });
  } catch (e) {
    err(res, 'DB_ERROR', '开通失败：' + (e?.message ?? e), 500);
  }
});

// GET /api/schools → 学校列表（admin）
router.get('/schools', requireAdmin, async (req, res) => {
  try {
    const r = await query(
      `SELECT s.id, s.school_code, s.name, s.created_at, s.active, a.username AS owner,
              (SELECT COUNT(*) FROM school_members m WHERE m.school_id = s.id AND m.status = 'approved') AS teacher_count,
              (SELECT COUNT(*) FROM students st WHERE st.org_id = s.org_id) AS student_count
       FROM schools s LEFT JOIN accounts a ON a.id = s.owner_id
       ORDER BY s.id DESC`,
    );
    res.json({ ok: true, schools: r.rows });
  } catch (e) {
    err(res, 'DB_ERROR', '查询失败：' + (e?.message ?? e), 500);
  }
});

// PUT /api/schools/:id { name?, ownerUsername? } → 修改学校（名称/校长）
router.put('/schools/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { name, ownerUsername } = req.body || {};
  if (!id) return err(res, 'BAD_REQ', '缺少学校ID', 400);
  try {
    if (name && String(name).trim()) {
      await query('UPDATE schools SET name = $1 WHERE id = $2', [String(name).trim(), id]);
    }
    if (ownerUsername && String(ownerUsername).trim()) {
      const acc = await query('SELECT * FROM accounts WHERE username = $1', [String(ownerUsername).trim()]);
      if (!acc.rows[0]) return err(res, 'NOT_FOUND', '校长账号不存在');
      const owner = acc.rows[0];
      if (owner.role === 'admin') return err(res, 'BAD_OWNER', '管理员账号不能作为校长');
      const has = await query('SELECT id FROM schools WHERE owner_id = $1 AND id <> $2', [owner.id, id]);
      if (has.rows[0]) return err(res, 'ALREADY_PRINCIPAL', '该账号已是其他学校的校长');
      await query('UPDATE schools SET owner_id = $1 WHERE id = $2', [owner.id, id]);
    }
    res.json({ ok: true });
  } catch (e) {
    err(res, 'DB_ERROR', '修改失败：' + (e?.message ?? e), 500);
  }
});

// POST /api/schools/:id/toggle → 禁用/启用学校
router.post('/schools/:id/toggle', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return err(res, 'BAD_REQ', '缺少学校ID', 400);
  try {
    const r = await query('UPDATE schools SET active = NOT active WHERE id = $1 RETURNING id, active', [id]);
    if (!r.rows[0]) return err(res, 'NOT_FOUND', '学校不存在');
    res.json({ ok: true, active: r.rows[0].active });
  } catch (e) {
    err(res, 'DB_ERROR', '操作失败：' + (e?.message ?? e), 500);
  }
});

// DELETE /api/schools/:id → 删除学校（级联删除该校所有数据）
router.delete('/schools/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return err(res, 'BAD_REQ', '缺少学校ID', 400);
  try {
    const s = await query('SELECT org_id FROM schools WHERE id = $1', [id]);
    if (!s.rows[0]) return err(res, 'NOT_FOUND', '学校不存在');
    const orgId = Number(s.rows[0].org_id);
    await query('BEGIN');
    await query('DELETE FROM recharges WHERE org_id = $1', [orgId]);
    await query('DELETE FROM schedule WHERE org_id = $1', [orgId]);
    await query('DELETE FROM teacher_students WHERE school_id = $1', [id]);
    await query('DELETE FROM school_members WHERE school_id = $1', [id]);
    await query('DELETE FROM students WHERE org_id = $1', [orgId]);
    await query('DELETE FROM schools WHERE id = $1', [id]);
    await query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await query('ROLLBACK').catch(() => {});
    err(res, 'DB_ERROR', '删除失败：' + (e?.message ?? e), 500);
  }
});

// ---------------- 老师申请加入学校（登录即可） ----------------

// POST /api/principal/apply { schoolCode, name, subject }
router.post('/principal/apply', requireAuth, async (req, res) => {
  const { schoolCode, name, subject } = req.body || {};
  if (!schoolCode) return err(res, 'MISSING_FIELDS', '请输入学校ID');
  const realName = name ? String(name).trim() : null;
  const realSubject = subject ? String(subject).trim() : null;
  try {
    const sc = String(schoolCode).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const s = await query('SELECT * FROM schools WHERE school_code = $1 AND active = true', [sc]);
    if (!s.rows[0]) return err(res, 'NOT_FOUND', '学校ID不存在或已停用');
    const school = s.rows[0];
    if (school.owner_id === req.user.uid) return err(res, 'SELF_APPLY', '不能申请加入自己的学校');
    const ex = await query('SELECT * FROM school_members WHERE school_id = $1 AND account_id = $2', [school.id, req.user.uid]);
    if (ex.rows[0]) {
      if (ex.rows[0].status === 'pending') return err(res, 'ALREADY_PENDING', '已提交申请，请等待校长审批');
      if (ex.rows[0].status === 'approved') return err(res, 'ALREADY_MEMBER', '你已是该学校老师');
      await query("UPDATE school_members SET status = 'pending', name = COALESCE($1, name), subject = COALESCE($2, subject), created_at = now() WHERE id = $3",
        [realName, realSubject, ex.rows[0].id]);
      return res.json({ ok: true, message: '已重新提交申请，等待校长审批' });
    }
    await query("INSERT INTO school_members (school_id, account_id, status, name, subject) VALUES ($1,$2,'pending',$3,$4)",
      [school.id, req.user.uid, realName, realSubject]);
    res.status(201).json({ ok: true, message: '申请已提交，等待校长审批' });
  } catch (e) {
    err(res, 'DB_ERROR', '申请失败：' + (e?.message ?? e), 500);
  }
});

// GET /api/principal/my-applications → 我的申请记录（老师）
router.get('/principal/my-applications', requireAuth, async (req, res) => {
  try {
    const r = await query(
      `SELECT m.id, m.status, m.created_at, m.name, m.subject, s.id AS school_id, s.name AS school_name, s.school_code
       FROM school_members m JOIN schools s ON s.id = m.school_id
       WHERE m.account_id = $1 ORDER BY m.id DESC`,
      [req.user.uid],
    );
    res.json({ ok: true, applications: r.rows });
  } catch (e) {
    err(res, 'DB_ERROR', '查询失败：' + (e?.message ?? e), 500);
  }
});

// DELETE /api/principal/apply/:schoolId → 老师退出学校
router.delete('/principal/apply/:schoolId', requireAuth, async (req, res) => {
  try {
    const r = await query('DELETE FROM school_members WHERE school_id = $1 AND account_id = $2 RETURNING id',
      [Number(req.params.schoolId), req.user.uid]);
    if (!r.rows[0]) return err(res, 'NOT_FOUND', '未加入该学校');
    await query('DELETE FROM teacher_students WHERE school_id = $1 AND teacher_id = $2', [Number(req.params.schoolId), req.user.uid]);
    res.json({ ok: true });
  } catch (e) {
    err(res, 'DB_ERROR', '退出失败：' + (e?.message ?? e), 500);
  }
});

// ---------------- 校长端 ----------------

// GET /api/principal/me → 校长身份 + 学校信息
router.get('/principal/me', requirePrincipal, (req, res) => {
  res.json({
    ok: true,
    school: { id: req.school.id, org_id: req.school.org_id, name: req.school.name, school_code: req.school.school_code },
    user: { id: req.user.uid, username: req.user.username },
  });
});

// GET /api/principal/applications → 待审批申请（校长）
router.get('/principal/applications', requirePrincipal, async (req, res) => {
  try {
    const r = await query(
      `SELECT m.id, m.account_id, m.status, m.created_at, m.name, m.subject, a.username
       FROM school_members m JOIN accounts a ON a.id = m.account_id
       WHERE m.school_id = $1 AND m.status = 'pending'
       ORDER BY m.id DESC`,
      [req.schoolId],
    );
    res.json({ ok: true, applications: r.rows });
  } catch (e) {
    err(res, 'DB_ERROR', '查询失败：' + (e?.message ?? e), 500);
  }
});

// POST /api/principal/applications/:id { action: approve|reject }
router.post('/principal/applications/:id', requirePrincipal, async (req, res) => {
  const { action } = req.body || {};
  if (!['approve', 'reject'].includes(action)) return err(res, 'BAD_ACTION', '操作无效');
  try {
    const r = await query(
      `UPDATE school_members m SET status = $1
       WHERE m.id = $2 AND m.school_id = $3
       RETURNING m.id, m.status, m.account_id`,
      [action === 'approve' ? 'approved' : 'rejected', Number(req.params.id), req.schoolId],
    );
    if (!r.rows[0]) return err(res, 'NOT_FOUND', '申请不存在');
    res.json({ ok: true, status: r.rows[0].status });
  } catch (e) {
    err(res, 'DB_ERROR', '操作失败：' + (e?.message ?? e), 500);
  }
});

// GET /api/principal/teachers → 学校老师（approved 成员 + 时薪）
router.get('/principal/teachers', requirePrincipal, async (req, res) => {
  try {
    const r = await query(
      `SELECT m.id AS member_id, a.id, a.username, a.phone, m.name, m.subject, m.stage, m.note, m.hourly_rate, m.created_at
       FROM school_members m JOIN accounts a ON a.id = m.account_id
       WHERE m.school_id = $1 AND m.status = 'approved'
       ORDER BY m.id DESC`,
      [req.schoolId],
    );
    res.json({ ok: true, teachers: r.rows });
  } catch (e) {
    err(res, 'DB_ERROR', '查询失败：' + (e?.message ?? e), 500);
  }
});

// PUT /api/principal/teachers/:id { name?, subject?, phone?, stage?, note? } → 校长编辑老师信息
router.put('/principal/teachers/:id', requirePrincipal, async (req, res) => {
  const b = req.body || {};
  try {
    const r = await query(
      `UPDATE school_members SET
         name = COALESCE($1, name),
         subject = COALESCE($2, subject),
         stage = COALESCE($3, stage),
         note = COALESCE($4, note)
       WHERE school_id = $5 AND account_id = $6 AND status = 'approved'
       RETURNING id, name, subject, stage, note`,
      [b.name ? String(b.name).trim() : null, b.subject ? String(b.subject).trim() : null, b.stage || null, b.note ? String(b.note).trim() : null, req.schoolId, Number(req.params.id)],
    );
    if (!r.rows[0]) return err(res, 'NOT_FOUND', '老师不在本学校');
    if (b.phone !== undefined && b.phone !== null) {
      await query('UPDATE accounts SET phone = $1 WHERE id = $2', [String(b.phone).trim(), Number(req.params.id)]);
    }
    res.json({ ok: true, teacher: r.rows[0] });
  } catch (e) {
    err(res, 'DB_ERROR', '修改失败：' + (e?.message ?? e), 500);
  }
});

// DELETE /api/principal/teachers/:id → 校长删除老师（:id 为 account_id）
router.delete('/principal/teachers/:id', requirePrincipal, async (req, res) => {
  try {
    const r = await query(
      "DELETE FROM school_members WHERE school_id = $1 AND account_id = $2 AND status = 'approved' RETURNING id",
      [req.schoolId, Number(req.params.id)]);
    if (!r.rows[0]) return err(res, 'NOT_FOUND', '老师不在本学校');
    await query('DELETE FROM teacher_students WHERE school_id = $1 AND teacher_id = $2', [req.schoolId, Number(req.params.id)]);
    res.json({ ok: true });
  } catch (e) {
    err(res, 'DB_ERROR', '删除失败：' + (e?.message ?? e), 500);
  }
});

// POST /api/principal/teachers/:id/hourly { rate } → 设置老师时薪（:id 为 account_id）
router.post('/principal/teachers/:id/hourly', requirePrincipal, async (req, res) => {
  let rate = Number(req.body?.rate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100000) return err(res, 'BAD_RATE', '时薪无效');
  rate = Math.round(rate * 100) / 100;
  try {
    const r = await query(
      `UPDATE school_members SET hourly_rate = $1
       WHERE school_id = $2 AND account_id = $3 AND status = 'approved'
       RETURNING id, hourly_rate`,
      [rate, req.schoolId, Number(req.params.id)],
    );
    if (!r.rows[0]) return err(res, 'NOT_FOUND', '老师不在本学校');
    res.json({ ok: true, hourly_rate: r.rows[0].hourly_rate });
  } catch (e) {
    err(res, 'DB_ERROR', '设置失败：' + (e?.message ?? e), 500);
  }
});

// GET /api/principal/students → 学校学员
router.get('/principal/students', requirePrincipal, async (req, res) => {
  try {
    const r = await query(
      `SELECT st.id, st.name, st.gender, st.phone, st.grade, st.school, st.notes, st.balance, st.hourly_fee, st.payload, st.created_at,
              (SELECT COUNT(*) FROM recharges rc WHERE rc.student_id = st.id AND rc.type = 'recharge') AS recharge_count
       FROM students st WHERE st.org_id = $1 ORDER BY st.id DESC`,
      [req.orgId],
    );
    res.json({ ok: true, students: r.rows });
  } catch (e) {
    err(res, 'DB_ERROR', '查询失败：' + (e?.message ?? e), 500);
  }
});

// POST /api/principal/students { name, gender?, phone?, grade?, school?, notes?, balance? } → 添加学校学员
router.post('/principal/students', requirePrincipal, async (req, res) => {
  const b = req.body || {};
  if (!b.name) return err(res, 'MISSING_FIELDS', '请填写学员姓名');
  let balance = Number(b.balance || 0);
  if (!Number.isFinite(balance)) balance = 0;
  try {
    const r = await query(
      `INSERT INTO students (org_id, name, gender, phone, grade, school, notes, balance, hourly_fee, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, name`,
      [req.orgId, String(b.name).trim(), b.gender || null, b.phone || null, b.grade || null, b.school || null, b.notes || null, balance,
       b.hourly_fee != null && b.hourly_fee !== '' ? Number(b.hourly_fee) : 0, b.payload || {}],
    );
    res.status(201).json({ ok: true, student: r.rows[0] });
  } catch (e) {
    err(res, 'DB_ERROR', '添加失败：' + (e?.message ?? e), 500);
  }
});

// PUT /api/principal/students/:id → 修改学校学员
router.put('/principal/students/:id', requirePrincipal, async (req, res) => {
  const b = req.body || {};
  try {
    const r = await query(
      `UPDATE students SET
         name = COALESCE($1, name),
         gender = COALESCE($2, gender),
         phone = COALESCE($3, phone),
         grade = COALESCE($4, grade),
         school = COALESCE($5, school),
         notes = COALESCE($6, notes),
         hourly_fee = COALESCE($7, hourly_fee),
         updated_at = now()
       WHERE id = $8 AND org_id = $9
       RETURNING id, name`,
      [b.name || null, b.gender ?? null, b.phone ?? null, b.grade ?? null, b.school ?? null, b.notes ?? null,
       b.hourly_fee != null && b.hourly_fee !== '' ? Number(b.hourly_fee) : null, Number(req.params.id), req.orgId],
    );
    if (!r.rows[0]) return err(res, 'NOT_FOUND', '学员不存在');
    res.json({ ok: true, student: r.rows[0] });
  } catch (e) {
    err(res, 'DB_ERROR', '修改失败：' + (e?.message ?? e), 500);
  }
});

// DELETE /api/principal/students/:id → 删除学校学员（级联删除师生关系/课表/充值）
router.delete('/principal/students/:id', requirePrincipal, async (req, res) => {
  try {
    const r = await query('DELETE FROM students WHERE id = $1 AND org_id = $2 RETURNING id', [Number(req.params.id), req.orgId]);
    if (!r.rows[0]) return err(res, 'NOT_FOUND', '学员不存在');
    res.json({ ok: true });
  } catch (e) {
    err(res, 'DB_ERROR', '删除失败：' + (e?.message ?? e), 500);
  }
});

// PUT /api/principal/recharges/:id { amount, note, type } → 修改充值记录（同步余额）
router.put('/principal/recharges/:id', requirePrincipal, async (req, res) => {
  const b = req.body || {};
  const id = Number(req.params.id);
  const amount = Number(b.amount);
  if (!id || !Number.isFinite(amount)) return err(res, 'BAD_REQ', '参数错误', 400);
  const type = b.type === 'consume' ? 'consume' : 'recharge';
  const signed = type === 'consume' ? -Math.abs(amount) : Math.abs(amount);
  try {
    const r = await query(
      `SELECT rc.id, rc.amount, rc.student_id, st.balance
       FROM recharges rc JOIN students st ON st.id = rc.student_id
       WHERE rc.id = $1 AND rc.org_id = $2`, [id, req.orgId]);
    if (!r.rows[0]) return err(res, 'NOT_FOUND', '记录不存在', 404);
    const oldSigned = Number(r.rows[0].amount);
    const newBalance = Number(r.rows[0].balance) - oldSigned + signed;
    await query('UPDATE recharges SET amount = $2, note = $3, type = $4 WHERE id = $1', [id, signed, String(b.note || ''), type]);
    await query('UPDATE students SET balance = $2 WHERE id = $1', [r.rows[0].student_id, newBalance]);
    res.json({ ok: true });
  } catch (e) {
    err(res, 'DB_ERROR', '修改记录失败：' + (e?.message ?? e), 500);
  }
});

// DELETE /api/principal/recharges/:id → 删除充值记录（同步余额）
router.delete('/principal/recharges/:id', requirePrincipal, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return err(res, 'BAD_REQ', '参数错误', 400);
  try {
    const r = await query(
      `SELECT rc.id, rc.amount, rc.student_id, st.balance
       FROM recharges rc JOIN students st ON st.id = rc.student_id
       WHERE rc.id = $1 AND rc.org_id = $2`, [id, req.orgId]);
    if (!r.rows[0]) return err(res, 'NOT_FOUND', '记录不存在', 404);
    const newBalance = Number(r.rows[0].balance) - Number(r.rows[0].amount);
    await query('DELETE FROM recharges WHERE id = $1', [id]);
    await query('UPDATE students SET balance = $2 WHERE id = $1', [r.rows[0].student_id, newBalance]);
    res.json({ ok: true });
  } catch (e) {
    err(res, 'DB_ERROR', '删除记录失败：' + (e?.message ?? e), 500);
  }
});

// POST /api/principal/students/:id/recharge { amount, note } → 学员充值
router.get('/principal/students/:id/recharges', requirePrincipal, async (req, res) => {
  try {
    const r = await query(
      `SELECT id, amount, type, note, created_at FROM recharges WHERE student_id = $1 AND org_id = $2 ORDER BY created_at DESC, id DESC LIMIT 100`,
      [Number(req.params.id), req.orgId]
    );
    res.json({ ok: true, records: r.rows });
  } catch (e) {
    err(res, 'DB_ERROR', '查询充值记录失败：' + (e?.message ?? e), 500);
  }
});
router.post('/principal/students/:id/recharge', requirePrincipal, async (req, res) => {
  let amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount === 0) return err(res, 'BAD_AMOUNT', '金额无效（0 或非数字）');
  amount = Math.round(amount * 100) / 100;
  const type = amount > 0 ? 'recharge' : 'consume';
  try {
    const st = await query('SELECT id FROM students WHERE id = $1 AND org_id = $2', [Number(req.params.id), req.orgId]);
    if (!st.rows[0]) return err(res, 'NOT_FOUND', '学员不存在');
    await query('INSERT INTO recharges (org_id, student_id, amount, type, note) VALUES ($1,$2,$3,$4,$5)',
      [req.orgId, Number(req.params.id), amount, type, req.body?.note || null]);
    await query('UPDATE students SET balance = balance + $1, updated_at = now() WHERE id = $2', [amount, Number(req.params.id)]);
    res.json({ ok: true });
  } catch (e) {
    err(res, 'DB_ERROR', '充值失败：' + (e?.message ?? e), 500);
  }
});

// ---------------- 师生关系 ----------------

// GET /api/principal/scores?student_id= → 学校内成绩（按学员，含全部老师录入）
router.get('/principal/scores', requirePrincipal, async (req, res) => {
  const { student_id } = req.query;
  try {
    if (student_id) {
      const st = await query('SELECT id FROM students WHERE id = $1 AND org_id = $2', [Number(student_id), req.orgId]);
      if (!st.rows[0]) return res.json({ ok: true, scores: [] });
      const r = await query(
        `SELECT s.id, s.student_id, s.exam_name, s.subject, s.score, s.total, s.note, s.created_at,
           st.name AS student_name
         FROM scores s JOIN students st ON st.id = s.student_id
         WHERE s.student_id = $1 ORDER BY s.created_at DESC`, [Number(student_id)]);
      return res.json({ ok: true, scores: r.rows });
    }
    const r = await query(
      `SELECT s.id, s.student_id, s.exam_name, s.subject, s.score, s.total, s.note, s.created_at,
         st.name AS student_name
       FROM scores s JOIN students st ON st.id = s.student_id
       WHERE st.org_id = $1 ORDER BY s.created_at DESC`, [req.orgId]);
    res.json({ ok: true, scores: r.rows });
  } catch (e) {
    err(res, 'DB_ERROR', '查询成绩失败：' + (e?.message ?? e), 500);
  }
});

// POST /api/principal/scores { studentId, examName, subject, score, total, note } → 添加成绩
router.post('/principal/scores', requirePrincipal, async (req, res) => {
  const b = req.body || {};
  const sid = Number(b.studentId);
  if (!sid) return err(res, 'BAD_REQ', '缺少学员', 400);
  try {
    const st = await query('SELECT id FROM students WHERE id = $1 AND org_id = $2', [sid, req.orgId]);
    if (!st.rows[0]) return err(res, 'NOT_FOUND', '学员不在本学校', 404);
    const r = await query(
      `INSERT INTO scores (org_id, student_id, exam_name, subject, score, total, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [req.orgId, sid, String(b.examName || ''), String(b.subject || ''),
       b.score != null && b.score !== '' ? Number(b.score) : null,
       b.total != null && b.total !== '' ? Number(b.total) : null,
       String(b.note || '')]
    );
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) {
    err(res, 'DB_ERROR', '添加成绩失败：' + (e?.message ?? e), 500);
  }
});

// PUT /api/principal/scores/:id { examName, subject, score, total, note } → 修改成绩
router.put('/principal/scores/:id', requirePrincipal, async (req, res) => {
  const b = req.body || {};
  const id = Number(req.params.id);
  if (!id) return err(res, 'BAD_REQ', '参数错误', 400);
  try {
    const chk = await query(
      `SELECT s.id FROM scores s JOIN students st ON st.id = s.student_id WHERE s.id = $1 AND st.org_id = $2`,
      [id, req.orgId]
    );
    if (!chk.rows[0]) return err(res, 'NOT_FOUND', '成绩不存在', 404);
    await query(
      `UPDATE scores SET exam_name = $2, subject = $3, score = $4, total = $5, note = $6 WHERE id = $1`,
      [id, String(b.examName || ''), String(b.subject || ''),
       b.score != null && b.score !== '' ? Number(b.score) : null,
       b.total != null && b.total !== '' ? Number(b.total) : null,
       String(b.note || '')]
    );
    res.json({ ok: true });
  } catch (e) {
    err(res, 'DB_ERROR', '修改成绩失败：' + (e?.message ?? e), 500);
  }
});

// DELETE /api/principal/scores/:id
router.delete('/principal/scores/:id', requirePrincipal, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return err(res, 'BAD_REQ', '参数错误', 400);
  try {
    const chk = await query(
      `SELECT s.id FROM scores s JOIN students st ON st.id = s.student_id WHERE s.id = $1 AND st.org_id = $2`,
      [id, req.orgId]
    );
    if (!chk.rows[0]) return err(res, 'NOT_FOUND', '成绩不存在', 404);
    await query('DELETE FROM scores WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (e) {
    err(res, 'DB_ERROR', '删除成绩失败：' + (e?.message ?? e), 500);
  }
});

// GET /api/principal/relations → 学校师生关系
router.get('/principal/relations', requirePrincipal, async (req, res) => {
  try {
    const r = await query(
      `SELECT ts.id, ts.teacher_id, ts.student_id, ts.subject,
              COALESCE(m.name, a.username) AS teacher_name, st.name AS student_name
       FROM teacher_students ts
       JOIN accounts a ON a.id = ts.teacher_id
       LEFT JOIN school_members m ON m.account_id = a.id AND m.school_id = $1
       JOIN students st ON st.id = ts.student_id
       WHERE ts.school_id = $1 AND ts.archived_at IS NULL ORDER BY ts.id DESC`,
      [req.schoolId],
    );
    res.json({ ok: true, relations: r.rows });
  } catch (e) {
    err(res, 'DB_ERROR', '查询失败：' + (e?.message ?? e), 500);
  }
});

// POST /api/principal/relations { teacherId, studentId, subject } → 建立师生关系
router.post('/principal/relations', requirePrincipal, async (req, res) => {
  const { teacherId, studentId, subject } = req.body || {};
  const tid = Number(teacherId);
  const sid = Number(studentId);
  if (!tid || !sid) return err(res, 'MISSING_FIELDS', '请选择老师和学员');
  try {
    const teacher = await query(
      "SELECT m.id FROM school_members m WHERE m.school_id = $1 AND m.account_id = $2 AND m.status = 'approved'",
      [req.schoolId, tid],
    );
    if (!teacher.rows[0]) return err(res, 'NOT_FOUND', '老师不在本学校');
    const st = await query('SELECT id FROM students WHERE id = $1 AND org_id = $2', [sid, req.orgId]);
    if (!st.rows[0]) return err(res, 'NOT_FOUND', '学员不在本学校');
    const r = await query(
      `INSERT INTO teacher_students (school_id, teacher_id, student_id, subject)
       VALUES ($1,$2,$3,$4) ON CONFLICT (school_id, teacher_id, student_id)
       DO UPDATE SET subject = EXCLUDED.subject, archived_at = NULL
       RETURNING id`,
      [req.schoolId, tid, sid, subject || null],
    );
    res.status(201).json({ ok: true, id: r.rows[0].id });
  } catch (e) {
    err(res, 'DB_ERROR', '操作失败：' + (e?.message ?? e), 500);
  }
});

// DELETE /api/principal/relations/:id → 解除师生关系（软删：标记 archived_at，老师端该学员转入历史学员，课程/记录保留）
router.delete('/principal/relations/:id', requirePrincipal, async (req, res) => {
  try {
    const r = await query(
      'UPDATE teacher_students SET archived_at = now() WHERE id = $1 AND school_id = $2 RETURNING id',
      [Number(req.params.id), req.schoolId],
    );
    if (!r.rows[0]) return err(res, 'NOT_FOUND', '关系不存在');
    res.json({ ok: true });
  } catch (e) {
    err(res, 'DB_ERROR', '操作失败：' + (e?.message ?? e), 500);
  }
});

// PUT /api/principal/relations/:id { subject } → 修改师生关系备注学科
router.put('/principal/relations/:id', requirePrincipal, async (req, res) => {
  const subject = String(req.body?.subject ?? '').trim() || null;
  try {
    const r = await query('UPDATE teacher_students SET subject = $2 WHERE id = $1 AND school_id = $3 RETURNING id',
      [Number(req.params.id), subject, req.schoolId]);
    if (!r.rows[0]) return err(res, 'NOT_FOUND', '关系不存在');
    res.json({ ok: true });
  } catch (e) {
    err(res, 'DB_ERROR', '修改失败：' + (e?.message ?? e), 500);
  }
});

// ---------------- 排课 ----------------

// GET /api/principal/schedule?teacherId=&studentId=&from=&to=
router.get('/principal/schedule', requirePrincipal, async (req, res) => {
  const cond = ['s.org_id = $1'];
  const params = [req.orgId, req.schoolId];
  const { teacherId, studentId, from, to } = req.query;
  if (teacherId) { params.push(Number(teacherId)); cond.push(`s.teacher_id = $${params.length}`); }
  if (studentId) { params.push(Number(studentId)); cond.push(`s.student_id = $${params.length}`); }
  if (from) { params.push(from); cond.push(`s.start_at >= $${params.length}::timestamptz`); }
  if (to) { params.push(to); cond.push(`s.start_at < $${params.length}::timestamptz`); }
  try {
    const r = await query(
      `SELECT s.id, s.student_id, s.teacher_id, s.course_id, s.start_at, s.end_at, s.status, s.notes, s.owner_id, s.created_at,
              st.name AS student_name, COALESCE(m.name, a.username) AS teacher_name, c.name AS course_name,
              ts.subject,
              CASE WHEN s.owner_id = 1 THEN '校长' ELSE COALESCE(mo.name, ao.username) END AS owner_name
       FROM schedule s
       JOIN students st ON st.id = s.student_id
       LEFT JOIN accounts a ON a.id = s.teacher_id
       LEFT JOIN school_members m ON m.account_id = a.id AND m.school_id = $2
       LEFT JOIN courses c ON c.id = s.course_id
       LEFT JOIN teacher_students ts ON ts.teacher_id = s.teacher_id AND ts.student_id = s.student_id AND ts.school_id = $2
       LEFT JOIN accounts ao ON ao.id = s.owner_id
       LEFT JOIN school_members mo ON mo.account_id = ao.id AND mo.school_id = $2
       WHERE ${cond.join(' AND ')} ORDER BY s.start_at`,
      params,
    );
    res.json({ ok: true, schedule: r.rows });
  } catch (e) {
    err(res, 'DB_ERROR', '查询失败：' + (e?.message ?? e), 500);
  }
});

// POST /api/principal/schedule { studentId | studentIds, teacherId, courseId?, startAt, endAt | slots:[{startAt,endAt}], notes? } → 排课（支持批量学员 × 多时段）
router.post('/principal/schedule', requirePrincipal, async (req, res) => {
  const b = req.body || {};
  const sids = Array.isArray(b.studentIds) ? b.studentIds.map(Number)
    : (b.studentId ? [Number(b.studentId)] : []);
  const tid = Number(b.teacherId);
  const slots = Array.isArray(b.slots) && b.slots.length
    ? b.slots.map((s) => ({ startAt: s.startAt, endAt: s.endAt }))
    : (b.startAt && b.endAt ? [{ startAt: b.startAt, endAt: b.endAt }] : []);
  if (!sids.length || !tid || !slots.length) return err(res, 'MISSING_FIELDS', '请选择学员、老师和上课时间');
  for (const s of slots) {
    if (!s.startAt || !s.endAt || new Date(s.endAt).getTime() <= new Date(s.startAt).getTime()) {
      return err(res, 'BAD_TIME', '结束时间需晚于开始时间');
    }
  }
  try {
    const teacher = await query(
      "SELECT m.id FROM school_members m WHERE m.school_id = $1 AND m.account_id = $2 AND m.status = 'approved'",
      [req.schoolId, tid],
    );
    if (!teacher.rows[0]) return err(res, 'NOT_FOUND', '老师不在本学校');
    const items = [];
    for (const sid of sids) {
      const st = await query('SELECT id FROM students WHERE id = $1 AND org_id = $2', [sid, req.orgId]);
      if (!st.rows[0]) continue;
      for (const s of slots) {
        const r = await query(
          `INSERT INTO schedule (org_id, student_id, course_id, start_at, end_at, teacher_id, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, start_at, end_at`,
          [req.orgId, sid, b.courseId ? Number(b.courseId) : null, s.startAt, s.endAt, tid, b.notes || null],
        );
        items.push(r.rows[0]);
      }
    }
    if (!items.length) return err(res, 'NOT_FOUND', '所选学员都不在本学校');
    res.status(201).json({ ok: true, count: items.length, items });
  } catch (e) {
    err(res, 'DB_ERROR', '排课失败：' + (e?.message ?? e), 500);
  }
});

// PUT /api/principal/schedule/:id { studentId, startAt, endAt, notes? } → 编辑课程
router.put('/principal/schedule/:id', requirePrincipal, async (req, res) => {
  const b = req.body || {};
  const sid = Number(b.studentId);
  const start = b.startAt, end = b.endAt;
  if (!sid || !start || !end) return err(res, 'MISSING_FIELDS', '请选择学员和上课时间');
  if (new Date(end).getTime() <= new Date(start).getTime()) return err(res, 'BAD_TIME', '结束时间需晚于开始时间');
  try {
    const r = await query(
      'UPDATE schedule SET student_id=$1, start_at=$2, end_at=$3, notes=$4 WHERE id=$5 AND org_id=$6 RETURNING id',
      [sid, start, end, b.notes || null, Number(req.params.id), req.orgId],
    );
    if (!r.rows[0]) return err(res, 'NOT_FOUND', '课不存在');
    res.json({ ok: true });
  } catch (e) {
    err(res, 'DB_ERROR', '保存失败：' + (e?.message ?? e), 500);
  }
});

// DELETE /api/principal/schedule/batch { ids: [] } → 批量删除课程（已完成课不可删除，跳过并返回 skipped）
router.delete('/principal/schedule/batch', requirePrincipal, async (req, res) => {
  const raw = (req.body && req.body.ids) || req.query.ids || '';
  const ids = String(raw).split(',').map((x) => Number(String(x).trim())).filter((x) => Number.isFinite(x) && x > 0);
  if (!ids.length) return err(res, 'BAD_IDS', '请选择要删除的课程');
  try {
    const r = await query(
      `DELETE FROM schedule WHERE org_id = $1 AND id = ANY($2::int[])
       AND NOT (status = 'done' OR payload->>'done' = 'true') RETURNING id`,
      [req.orgId, ids],
    );
    res.json({ ok: true, deleted: r.rows.length, skipped: ids.length - r.rows.length });
  } catch (e) {
    err(res, 'DB_ERROR', '删除失败：' + (e?.message ?? e), 500);
  }
});

// DELETE /api/principal/schedule/:id（已完成课不可删除）
router.delete('/principal/schedule/:id', requirePrincipal, async (req, res) => {
  try {
    const r = await query(
      `DELETE FROM schedule WHERE id = $1 AND org_id = $2
       AND NOT (status = 'done' OR payload->>'done' = 'true') RETURNING id`,
      [Number(req.params.id), req.orgId],
    );
    if (!r.rows[0]) return err(res, 'FORBIDDEN', '课不存在或已完成课程不能删除', 403);
    res.json({ ok: true });
  } catch (e) {
    err(res, 'DB_ERROR', '删除失败：' + (e?.message ?? e), 500);
  }
});

// ---------------- 统计 ----------------

// GET /api/principal/statistics?from=&to= → 学生费用 + 老师薪资
router.get('/principal/statistics', requirePrincipal, async (req, res) => {
  const from = req.query.from || null;
  const to = req.query.to || null;
  const timeCond = (alias) => {
    const conds = [];
    if (from) conds.push(`${alias} >= '${from}'::timestamptz`);
    if (to) conds.push(`${alias} < '${to}'::timestamptz`);
    return conds.length ? conds.join(' AND ') : null;
  };
  try {
    // 学生费用：充值/消耗/课时/余额
    const stCond = timeCond('rc.created_at');
    const stSchCond = timeCond('s2.start_at');
    const stSql = `
      SELECT st.id, st.name,
             COALESCE(SUM(rc.amount) FILTER (WHERE rc.type = 'recharge'), 0) AS recharged,
             COALESCE(SUM(rc.amount) FILTER (WHERE rc.type = 'consume'), 0) AS consumed,
             COALESCE((
               SELECT SUM(EXTRACT(EPOCH FROM (s2.end_at - s2.start_at)) / 3600)
               FROM schedule s2 WHERE s2.student_id = st.id AND s2.org_id = $1 ${stSchCond ? `AND (${stSchCond})` : ''}
             ), 0) AS hours,
             st.balance
      FROM students st LEFT JOIN recharges rc ON rc.student_id = st.id AND rc.org_id = $1
      WHERE st.org_id = $1 ${stCond ? `AND (${stCond})` : ''}
      GROUP BY st.id ORDER BY st.id DESC`;
    const studentsR = await query(stSql, [req.orgId]);

    // 老师薪资：课时小时 × 时薪
    const schCond = timeCond('s.start_at');
    const salarySql = `
      SELECT a.id, a.username, m.hourly_rate,
             COUNT(s.id) AS lessons,
             COALESCE(SUM(EXTRACT(EPOCH FROM (s.end_at - s.start_at)) / 3600), 0) AS hours,
             COALESCE(SUM(EXTRACT(EPOCH FROM (s.end_at - s.start_at)) / 3600 * m.hourly_rate), 0) AS salary
      FROM school_members m
      JOIN accounts a ON a.id = m.account_id
      LEFT JOIN schedule s ON s.teacher_id = a.id AND s.org_id = $1 ${schCond ? `AND (${schCond})` : ''}
      WHERE m.school_id = $2 AND m.status = 'approved'
      GROUP BY a.id, a.username, m.hourly_rate ORDER BY salary DESC`;
    const teachersR = await query(salarySql, [req.orgId, req.schoolId]);

    const students = studentsR.rows.map((x) => ({ ...x, recharged: Number(x.recharged), consumed: Number(x.consumed), hours: Number(x.hours), balance: Number(x.balance) }));
    const teachers = teachersR.rows.map((x) => ({ ...x, hourly_rate: Number(x.hourly_rate), lessons: Number(x.lessons), hours: Number(x.hours), salary: Number(x.salary) }));
    const totalRecharged = students.reduce((a, x) => a + x.recharged, 0);
    const totalConsumed = students.reduce((a, x) => a + x.consumed, 0);
    const totalSalary = teachers.reduce((a, x) => a + x.salary, 0);
    res.json({
      ok: true,
      from, to,
      totals: { totalRecharged, totalConsumed, totalSalary },
      students, teachers,
    });
  } catch (e) {
    err(res, 'DB_ERROR', '统计失败：' + (e?.message ?? e), 500);
  }
});

// ============ 老师薪资：按月统计 + 结算备注 ============
// GET /api/principal/salary?teacherId= → 按月课程统计 + 结算状态
router.get('/principal/salary', requirePrincipal, async (req, res) => {
  const teacherId = Number(req.query.teacherId);
  if (!teacherId) return err(res, 'BAD_REQ', '缺少 teacherId', 400);
  try {
    // 校验老师属于本学校
    const mem = await query(`SELECT id, hourly_rate FROM school_members WHERE account_id = $1 AND school_id = $2 AND status = 'approved'`, [teacherId, req.schoolId]);
    if (!mem.rows.length) return err(res, 'NOT_FOUND', '老师不在本学校', 404);
    const monthly = await query(
      `SELECT to_char(s.start_at, 'YYYY-MM') AS ym,
              COUNT(s.id) AS lessons,
              COALESCE(SUM(EXTRACT(EPOCH FROM (s.end_at - s.start_at)) / 3600), 0) AS hours,
              COALESCE(SUM(EXTRACT(EPOCH FROM (s.end_at - s.start_at)) / 3600 * $2), 0) AS salary
       FROM schedule s
       WHERE s.teacher_id = $1
       GROUP BY ym ORDER BY ym DESC`,
      [teacherId, mem.rows[0].hourly_rate || 0]
    );
    const settle = await query(`SELECT teacher_id, ym, note, settled_at FROM salary_settle WHERE teacher_id = $1`, [teacherId]);
    const settleMap = {};
    settle.rows.forEach((x) => { settleMap[x.ym] = x; });
    const list = monthly.rows.map((x) => ({
      ym: x.ym,
      lessons: Number(x.lessons),
      hours: Number(x.hours),
      salary: Number(x.salary),
      hourly_rate: Number(mem.rows[0].hourly_rate || 0),
      note: settleMap[x.ym]?.note || '',
      settled: !!settleMap[x.ym]?.settled_at,
      settled_at: settleMap[x.ym]?.settled_at || null,
    }));
    res.json({ ok: true, list, teacher_id: teacherId, hourly_rate: Number(mem.rows[0].hourly_rate || 0) });
  } catch (e) {
    err(res, 'DB_ERROR', '薪资统计失败：' + (e?.message ?? e), 500);
  }
});

// POST /api/principal/salary/settle { teacherId, ym, note } → 标记结算
router.post('/principal/salary/settle', requirePrincipal, async (req, res) => {
  const b = req.body || {};
  const teacherId = Number(b.teacherId), ym = String(b.ym || '');
  if (!teacherId || !/^\d{4}-\d{2}$/.test(ym)) return err(res, 'BAD_REQ', '参数错误', 400);
  try {
    await query(
      `INSERT INTO salary_settle (teacher_id, ym, note, settled_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (teacher_id, ym) DO UPDATE SET note = EXCLUDED.note, settled_at = now()`,
      [teacherId, ym, String(b.note || '')]
    );
    res.json({ ok: true });
  } catch (e) {
    err(res, 'DB_ERROR', '结算失败：' + (e?.message ?? e), 500);
  }
});

// POST /api/principal/salary/unsettle { teacherId, ym } → 取消结算
router.post('/principal/salary/unsettle', requirePrincipal, async (req, res) => {
  const b = req.body || {};
  const teacherId = Number(b.teacherId), ym = String(b.ym || '');
  if (!teacherId || !/^\d{4}-\d{2}$/.test(ym)) return err(res, 'BAD_REQ', '参数错误', 400);
  try {
    await query(`UPDATE salary_settle SET settled_at = NULL WHERE teacher_id = $1 AND ym = $2`, [teacherId, ym]);
    res.json({ ok: true });
  } catch (e) {
    err(res, 'DB_ERROR', '操作失败：' + (e?.message ?? e), 500);
  }
});

// POST /api/principal/salary/note { teacherId, ym, note } → 保存备注
router.post('/principal/salary/note', requirePrincipal, async (req, res) => {
  const b = req.body || {};
  const teacherId = Number(b.teacherId), ym = String(b.ym || '');
  if (!teacherId || !/^\d{4}-\d{2}$/.test(ym)) return err(res, 'BAD_REQ', '参数错误', 400);
  try {
    await query(
      `INSERT INTO salary_settle (teacher_id, ym, note) VALUES ($1, $2, $3)
       ON CONFLICT (teacher_id, ym) DO UPDATE SET note = EXCLUDED.note`,
      [teacherId, ym, String(b.note || '')]
    );
    res.json({ ok: true });
  } catch (e) {
    err(res, 'DB_ERROR', '备注保存失败：' + (e?.message ?? e), 500);
  }
});

export default router;
