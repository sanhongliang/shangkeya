// 桌面端整包同步：GET /api/desktop/state（组装前端 IAppData 业务块）
//              PUT /api/desktop/sync（事务全量替换；courses 块已由前端与手机端合并）
import { Router } from 'express';
import { query, withTx } from '../db.js';
import { err } from '../auth.js';

const router = Router();

// 学员头像底色：学校关联给老师的学员（校长端创建）可能没有 boardColor，按 fid 稳定取色
const BOARD_COLORS = ['#1677ff', '#52c41a', '#fa8c16', '#722ed1', '#13c2c2'];
function boardColorOf(key) {
  const k = String(key ?? '');
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return BOARD_COLORS[h % BOARD_COLORS.length];
}

/** 前端学员记录 <-> students 表（payload 存前端扩展字段，_fid 匹配前端 id） */
function studentToRow(s) {
  return {
    name: s.name ?? '',
    grade: s.grade ?? null,
    notes: s.note ?? s.notes ?? null,
    payload: { ...(s.payload ?? {}), _fid: s.id, student: s },
  };
}

/** 前端课次 ICourse <-> schedule 表 */
function courseToRow(c, studentIdMap) {
  const sid = studentIdMap[c.studentId] ?? null;
  const startAt = `${c.date}T${c.start.padStart(5, '0')}:00`;
  const endMs = new Date(startAt).getTime() + (c.durationMin || 60) * 60000;
  return {
    student_id: sid,
    start_at: startAt,
    end_at: new Date(endMs).toISOString(),
    status: c.done ? 'done' : 'scheduled',
    payload: { _fid: c.id, content: c.content ?? '', remark: c.remark ?? '', done: !!c.done, prep: !!c.prep, summary: c.summary ?? null, course: c },
  };
}

// GET /api/desktop/state → 组装前端业务块
router.get('/state', async (req, res) => {
  const org = req.user.org_id ?? 1;
  const uid = req.user.uid;
  try {
    const [stu, sch, wk, rec, sco, set, ann, stuArch] = await Promise.all([
      // 学员：自己添加的 + 学校师生关系分配给该老师的（校长端建立关系后自动出现；已解除的进入历史学员）
      query(`SELECT st.* FROM students st WHERE (st.org_id = $1 AND st.owner_id = $2)
             OR st.id IN (SELECT ts.student_id FROM teacher_students ts WHERE ts.teacher_id = $3 AND ts.archived_at IS NULL) ORDER BY st.id`, [org, uid, uid]),
      // 课次：自己的 + 学校为其排的课（校长排课 teacher_id 指向该老师）；带排课人名字（owner_id=1 → 校长）
      query(`SELECT s.*, ao.username AS owner_username, mo.name AS owner_name
             FROM schedule s
             LEFT JOIN accounts ao ON ao.id = s.owner_id
             LEFT JOIN LATERAL (SELECT name FROM school_members WHERE account_id = s.owner_id LIMIT 1) mo ON true
             WHERE (s.org_id = $1 AND s.owner_id = $2) OR s.teacher_id = $3 ORDER BY s.start_at`, [org, uid, uid]),
      query('SELECT * FROM week_schedule WHERE org_id = $1 AND owner_id = $2', [org, uid]),
      query('SELECT * FROM recharges WHERE org_id = $1 AND owner_id = $2', [org, uid]),
      query('SELECT * FROM scores WHERE org_id = $1 AND owner_id = $2', [org, uid]),
      query('SELECT payload FROM settings WHERE org_id = $1 AND owner_id = $2', [org, uid]),
      query('SELECT * FROM announcements WHERE org_id = $1 AND active ORDER BY created_at DESC LIMIT 1', [org]),
      // 已解除师生关系的学校学员 → 老师端历史学员（数据与历史课程/记录保留，不消失）
      query(`SELECT st.* FROM students st JOIN teacher_students ts ON ts.student_id = st.id
             WHERE ts.teacher_id = $1 AND ts.archived_at IS NOT NULL ORDER BY st.id`, [uid]),
    ]);

    // 学校关联学员 fid 集合（标记共享来源：学校学员老师端不能删除）——仅关联中的
    const tsFidRes = await query(
      `SELECT st.payload->'student'->>'id' AS fid, st.payload->>'_fid' AS pfid, 'stu-' || st.id AS sid
       FROM students st JOIN teacher_students ts ON ts.student_id = st.id
       WHERE ts.teacher_id = $1 AND ts.archived_at IS NULL`,
      [uid],
    );
    const sharedFidSet = new Set();
    for (const r of tsFidRes.rows) {
      if (r.fid) sharedFidSet.add(r.fid);
      if (r.pfid) sharedFidSet.add(r.pfid);
      if (r.sid) sharedFidSet.add(r.sid);
    }

    // students 还原（payload.student 或基础字段），按前端 fid 去重：
    // 同一学员可能同时以「自己添加」和「师生关系共享」出现（或历史版本残留多份），只保留一份
    // 学校关系状态主导学员归属：关联中 → 当前学员；已解除 → 历史学员（不受老师端历史副本 active=false 影响）
    const removedArchFids = new Set();
    for (const row of stuArch.rows) {
      removedArchFids.add(row.payload?._fid ?? (row.payload?.student?.id ?? `stu-${row.id}`));
    }
    const seenStudents = new Map(); // fid → { s, isSelf, active }
    for (const row of stu.rows) {
      const p = row.payload ?? {};
      const orig = p.student ?? {
        id: p._fid ?? `stu-${row.id}`,
        name: row.name,
        grade: row.grade ?? '',
        note: row.notes ?? '',
      };
      const s = { ...orig, name: orig.name ?? row.name };
      if (!s.boardColor) s.boardColor = boardColorOf(s.id ?? p._fid ?? `stu-${row.id}`);
      const isSelf = Number(row.owner_id) === Number(uid);
      const key = s.id ?? p._fid ?? `stu-${row.id}`;
      const isSchoolStudent = sharedFidSet.has(key);   // 关联中
      const isRemovedSchool = removedArchFids.has(key); // 已解除
      if (isRemovedSchool) {
        // 已解除的学校学员：历史学员，保留共享/学校来源标记（不可删除）
        s._shared = true;
        s._schoolStudent = true;
      } else if (isSelf) {
        delete s._shared; // 自己名下的不显示共享标记
        if (isSchoolStudent) s._schoolStudent = true; // 但保留学校来源标记（前端据此禁止删除）
      } else {
        s._shared = true; // 他人创建、师生关系共享 → 只读标记
        if (isSchoolStudent) s._schoolStudent = true;
      }
      // 学校关系状态决定归属；非学校学员按数据库 active 字段
      const effActive = isSchoolStudent ? true : isRemovedSchool ? false : row.active;
      const prev = seenStudents.get(key);
      if (!prev) {
        seenStudents.set(key, { s, isSelf, active: effActive });
      } else if (isSelf && !prev.isSelf) {
        // 同 fid：自己创建的版本优先（含最新编辑）；归属仍由学校关系状态主导
        seenStudents.set(key, { s, isSelf, active: effActive });
      }
    }
    // 已解除师生关系的学校学员 → 历史学员（保留 _shared/_schoolStudent：学校数据，老师端不可删除）
    const removedByKey = new Map();
    for (const row of stuArch.rows) {
      const p = row.payload ?? {};
      const orig = p.student ?? {
        id: p._fid ?? `stu-${row.id}`,
        name: row.name,
        grade: row.grade ?? '',
        note: row.notes ?? '',
      };
      const s = { ...orig, name: orig.name ?? row.name };
      if (!s.boardColor) s.boardColor = boardColorOf(s.id ?? p._fid ?? `stu-${row.id}`);
      s._shared = true;
      s._schoolStudent = true;
      const key = s.id ?? p._fid ?? `stu-${row.id}`;
      if (!removedByKey.has(key)) removedByKey.set(key, s);
    }

    const students = [];
    const archivedStudents = [];
    for (const { s, active } of seenStudents.values()) {
      if (active) students.push(s);
      else archivedStudents.push(s);
    }
    // 已解除的学校学员进历史学员：当前学员已有同 fid（老师自建/恢复的版本）则跳过，历史列表去重
    for (const [key, s] of removedByKey) {
      if (students.some((x) => x.id === key)) continue;
      if (!archivedStudents.some((x) => x.id === key)) archivedStudents.push(s);
    }

    // 课次还原（schedule 表 → 前端 ICourse）——同 fid 只保留一份（学校主记录/更早的记录优先，防历史副本重复）
    // studentId 解析覆盖全部学员行（含已解除关联的学校学员，保证历史课程/记录不消失）
    const allStuRows = [...stu.rows, ...stuArch.rows];
    const seenCourse = new Set();
    const courses = [];
    for (const row of sch.rows) {
      const p = row.payload ?? {};
      const d = new Date(row.start_at);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const start = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const cid = p._fid ?? `c-${row.id}`;
      if (seenCourse.has(cid)) continue;
      seenCourse.add(cid);
      courses.push({
        id: cid,
        studentId: p.course?.studentId ?? findStudentByRow(allStuRows, row.student_id),
        date,
        start,
        durationMin: Math.round((new Date(row.end_at) - d) / 60000) || 60,
        content: p.content ?? '',
        remark: p.remark ?? '',
        done: p.done ?? row.status === 'done',
        prep: !!p.prep,
        ownerId: row.owner_id ?? null,
        ownerName: Number(row.owner_id) === 1 ? '校长' : (row.owner_name ?? row.owner_username ?? ''),
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
        ...(p.summary ? { summary: p.summary } : {}),
      });
    }

    // 周课表还原
    const schedule = wk.rows.map((row) => row.payload?.item ?? row.payload);

    // 充值还原
    const recharges = rec.rows.map((row) => {
      const p = row.payload ?? {};
      return p.rec ?? {
        id: p._fid ?? `r-${row.id}`,
        studentId: p._fid ? undefined : findStudentByRow(allStuRows, row.student_id),
        time: row.created_at ? new Date(row.created_at).toISOString().slice(0, 16).replace('T', ' ') : '',
        amount: Number(row.amount),
        method: p.method ?? '',
        note: row.note ?? '',
      };
    }).filter((r) => r.studentId);

    // 成绩还原（Record<studentId, IScoreEntry[]>）
    const scores = {};
    for (const row of sco.rows) {
      const p = row.payload ?? {};
      const sid = p.sid ?? findStudentByRow(allStuRows, row.student_id);
      if (!sid) continue;
      const entry = { date: p.date ?? (row.exam_name ?? ''), score: Number(row.score) };
      if (!scores[sid]) scores[sid] = [];
      scores[sid].push(entry);
    }

    // 设置 / 公告
    const settings = set.rows[0]?.payload ?? {};
    const announcement = ann.rows[0]
      ? { title: ann.rows[0].title, content: ann.rows[0].content ?? '', expireAt: ann.rows[0].payload?.expireAt ?? '' }
      : { title: '', content: '', expireAt: '' };

    res.json({ students, archivedStudents, courses, schedule, recharges, scores, settings, announcement });
  } catch (e) {
    err(res, 'DB_ERROR', '加载数据失败：' + (e?.message ?? e), 500);
  }
});

function findStudentByRow(rows, backendId) {
  const row = rows.find((r) => r.id === backendId);
  return row ? (row.payload?._fid ?? `stu-${row.id}`) : null;
}

// PUT /api/desktop/sync → 事务全量替换（body: { students, archivedStudents, courses, schedule, recharges, scores, settings, announcement }）
router.put('/sync', async (req, res) => {
  const org = req.user.org_id ?? 1;
  const uid = req.user.uid;
  const b = req.body ?? {};
  try {
    await withTx(async (client) => {
      // 学员（active / archived）——仅当前账号；按前端 fid 去重（防缓存残留重复再入库）
      await client.query('DELETE FROM students WHERE org_id = $1 AND owner_id = $2', [org, uid]);
      // 学校关联分配给该老师的学生（_shared）也写入老师名下副本：
      // 教师端数据与学校端数据彼此独立——老师对共享学员的修改保存在自己的副本里，不触碰学校原始行（owner 非本账号）
      // 学校已解除关系的学员 fid 集合：即使老师端本地仍标记为当前学员，也强制写为历史（active=false，防止解除后又被 sync 拉回当前）
      const removedRes = await client.query(
        `SELECT st.payload->'student'->>'id' AS fid, st.payload->>'_fid' AS pfid, 'stu-' || st.id AS sid
         FROM students st JOIN teacher_students ts ON ts.student_id = st.id
         WHERE ts.teacher_id = $1 AND ts.archived_at IS NOT NULL`,
        [uid],
      );
      const removedFids = new Set();
      for (const r of removedRes.rows) {
        if (r.fid) removedFids.add(r.fid);
        if (r.pfid) removedFids.add(r.pfid);
        if (r.sid) removedFids.add(r.sid);
      }
      const allStudents = [...(b.students ?? []), ...(b.archivedStudents ?? [])];
      const seenSid = new Set();
      for (const s of allStudents) {
        if (!s || !s.id || seenSid.has(s.id)) continue;
        // 学校共享来源标记保留在副本上（前端据此禁止删除学校学员）
        if (s._shared) s._schoolStudent = true;
        seenSid.add(s.id);
        // 已解除关系的学校学员强制写为历史学员（active=false）
        const removed = removedFids.has(s.id);
        await client.query(
          `INSERT INTO students (org_id, owner_id, name, grade, notes, payload, active)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [org, uid, s.name ?? '', s.grade ?? null, s.note ?? s.notes ?? null,
            JSON.stringify(studentToRow(s).payload), s.id?.startsWith('arc-') ? false : removed ? false : true],
        );
      }

      // 课次（schedule 表；studentId 前端 → 后端 id）——仅当前账号
      // 规则：已确认完成的课（done=true）不可删除——删除时保留已完成课原行，只删未完成课
      const doneRes = await client.query(
        `SELECT payload->>'_fid' AS fid FROM schedule
         WHERE org_id = $1 AND owner_id = $2 AND (status = 'done' OR payload->>'done' = 'true')`,
        [org, uid],
      );
      const doneFids = new Set(doneRes.rows.map((r) => r.fid).filter(Boolean));
      await client.query(
        `DELETE FROM schedule WHERE org_id = $1 AND owner_id = $2
         AND NOT (status = 'done' OR payload->>'done' = 'true')`,
        [org, uid],
      );
      // 学校排给该老师的课（owner 非本账号、teacher_id 指向本老师）——老师端只读显示，不写副本，防止双写重复
      const schoolCourseRes = await client.query(
        `SELECT id, payload->>'_fid' AS cfid, 'c-' || id AS cid, status, payload->>'done' AS pdone FROM schedule
         WHERE teacher_id = $1 AND COALESCE(owner_id, 0) <> $2`,
        [uid, uid],
      );
      const schoolCourseFids = new Set();
      for (const r of schoolCourseRes.rows) {
        if (r.cfid) schoolCourseFids.add(r.cfid);
        if (r.cid) schoolCourseFids.add(r.cid);
      }
      // 前端已删除的学校排课（未完成课）→ 同步删除后端行；已完成课保留
      const bodyCidSet = new Set((b.courses ?? []).map((c) => c.id));
      for (const r of schoolCourseRes.rows) {
        if (r.status === 'done' || r.pdone === 'true') continue; // 已完成课不可删除
        if (r.cfid && bodyCidSet.has(r.cfid)) continue;
        if (bodyCidSet.has(r.cid)) continue;
        await client.query('DELETE FROM schedule WHERE id = $1', [r.id]);
      }
      const stuRows = (await client.query('SELECT id, payload FROM students WHERE org_id = $1 AND owner_id = $2', [org, uid])).rows;
      const sidMap = {};
      for (const r of stuRows) { if (r.payload?._fid) sidMap[r.payload._fid] = r.id; }
      const seenCid = new Set();
      for (const c of b.courses ?? []) {
        const row = courseToRow(c, sidMap);
        if (!row.student_id) continue;
        // 学校排的课（teacher_id 指向本老师）不落副本；前端同 fid 重复只写一份
        if (schoolCourseFids.has(c.id) || schoolCourseFids.has(row.payload._fid)) continue;
        // 已完成课保留原行，不重插（防止同一课出现两份）
        if (doneFids.has(c.id)) continue;
        if (seenCid.has(c.id)) continue;
        seenCid.add(c.id);
        await client.query(
          `INSERT INTO schedule (org_id, owner_id, student_id, start_at, end_at, status, payload)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [org, uid, row.student_id, row.start_at, row.end_at, row.status, JSON.stringify(row.payload)],
        );
      }

      // 周课表模板——仅当前账号
      await client.query('DELETE FROM week_schedule WHERE org_id = $1 AND owner_id = $2', [org, uid]);
      for (const item of b.schedule ?? []) {
        await client.query(
          'INSERT INTO week_schedule (org_id, owner_id, payload) VALUES ($1,$2,$3)',
          [org, uid, JSON.stringify({ item })],
        );
      }

      // 充值——仅当前账号
      await client.query('DELETE FROM recharges WHERE org_id = $1 AND owner_id = $2', [org, uid]);
      for (const r of b.recharges ?? []) {
        const sid = sidMap[r.studentId];
        if (!sid) continue;
        await client.query(
          `INSERT INTO recharges (org_id, owner_id, student_id, amount, note, payload)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [org, uid, sid, Number(r.amount) || 0, r.note ?? '', JSON.stringify({ rec: r, _fid: r.id })],
        );
      }

      // 成绩——仅当前账号
      await client.query('DELETE FROM scores WHERE org_id = $1 AND owner_id = $2', [org, uid]);
      for (const [sidF, entries] of Object.entries(b.scores ?? {})) {
        const sid = sidMap[sidF];
        if (!sid) continue;
        for (const e of entries ?? []) {
          await client.query(
            `INSERT INTO scores (org_id, owner_id, student_id, exam_name, score, payload)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [org, uid, sid, e.date ?? '', Number(e.score) || 0, JSON.stringify({ sid: sidF, date: e.date, score: e.score })],
          );
        }
      }

      // 设置——按账号
      await client.query(
        `INSERT INTO settings (org_id, owner_id, payload) VALUES ($1,$2,$3)
         ON CONFLICT (org_id, owner_id) DO UPDATE SET payload = $3, updated_at = now()`,
        [org, uid, JSON.stringify(b.settings ?? {})],
      );

      // 公告：由管理后台维护，桌面端同步不覆盖（避免空公告覆盖后台设置）
      // （announcements 表数据仅通过 /api/announcements 管理）
    });
    res.json({ ok: true });
  } catch (e) {
    err(res, 'DB_ERROR', '保存失败：' + (e?.message ?? e), 500);
  }
});

// POST /api/desktop/course-delete → 显式删除单节课（未完成课可删；已确认完成的不可删）
// 覆盖本账号自建课与学校排给本老师的课；与 sync 的删除联动互为兜底
router.post('/course-delete', async (req, res) => {
  const org = req.user.org_id ?? 1;
  const uid = req.user.uid;
  const fid = (req.body ?? {}).fid;
  if (!fid) return err(res, 'BAD_REQUEST', '缺少课程 fid', 400);
  try {
    const found = await query(
      `SELECT id, status, payload->>'done' AS pdone, payload->>'_fid' AS cfid
       FROM schedule WHERE (org_id = $1 AND owner_id = $2) OR teacher_id = $3`,
      [org, uid, uid],
    );
    let row = null;
    for (const r of found.rows) {
      if ((r.cfid && r.cfid === fid) || `c-${r.id}` === fid) { row = r; break; }
    }
    if (!row) return err(res, 'NOT_FOUND', '课程不存在或已删除', 404);
    if (row.status === 'done' || row.pdone === 'true') {
      return err(res, 'DONE_LOCKED', '已确认完成的课程不能删除', 403);
    }
    await query('DELETE FROM schedule WHERE id = $1', [row.id]);
    return res.json({ ok: true, deleted: 1 });
  } catch (e) {
    err(res, 'DB_ERROR', '删除失败：' + (e?.message ?? e), 500);
  }
});

export default router;
