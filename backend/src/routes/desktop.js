// 桌面端整包同步：GET /api/desktop/state（组装前端 IAppData 业务块）
//              PUT /api/desktop/sync（事务全量替换；courses 块已由前端与手机端合并）
import { Router } from 'express';
import { query, withTx } from '../db.js';
import { err } from '../auth.js';

const router = Router();

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
    const [stu, sch, wk, rec, sco, set, ann] = await Promise.all([
      query('SELECT * FROM students WHERE org_id = $1 AND owner_id = $2', [org, uid]),
      query('SELECT * FROM schedule WHERE org_id = $1 AND owner_id = $2 ORDER BY start_at', [org, uid]),
      query('SELECT * FROM week_schedule WHERE org_id = $1 AND owner_id = $2', [org, uid]),
      query('SELECT * FROM recharges WHERE org_id = $1 AND owner_id = $2', [org, uid]),
      query('SELECT * FROM scores WHERE org_id = $1 AND owner_id = $2', [org, uid]),
      query('SELECT payload FROM settings WHERE org_id = $1 AND owner_id = $2', [org, uid]),
      query('SELECT * FROM announcements WHERE org_id = $1 AND active ORDER BY created_at DESC LIMIT 1', [org]),
    ]);

    // students 还原（payload.student 或基础字段）
    const students = [];
    const archivedStudents = [];
    for (const row of stu.rows) {
      const p = row.payload ?? {};
      const orig = p.student ?? {
        id: p._fid ?? `stu-${row.id}`,
        name: row.name,
        grade: row.grade ?? '',
        note: row.notes ?? '',
      };
      const s = { ...orig, name: orig.name ?? row.name };
      if (row.active) students.push(s);
      else archivedStudents.push(s);
    }

    // 课次还原（schedule 表 → 前端 ICourse）
    const courses = sch.rows.map((row) => {
      const p = row.payload ?? {};
      const d = new Date(row.start_at);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const start = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      return {
        id: p._fid ?? `c-${row.id}`,
        studentId: p.course?.studentId ?? findStudentByRow(stu.rows, row.student_id),
        date,
        start,
        durationMin: Math.round((new Date(row.end_at) - d) / 60000) || 60,
        content: p.content ?? '',
        remark: p.remark ?? '',
        done: p.done ?? row.status === 'done',
        prep: !!p.prep,
        ...(p.summary ? { summary: p.summary } : {}),
      };
    });

    // 周课表还原
    const schedule = wk.rows.map((row) => row.payload?.item ?? row.payload);

    // 充值还原
    const recharges = rec.rows.map((row) => {
      const p = row.payload ?? {};
      return p.rec ?? {
        id: p._fid ?? `r-${row.id}`,
        studentId: p._fid ? undefined : findStudentByRow(stu.rows, row.student_id),
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
      const sid = p.sid ?? findStudentByRow(stu.rows, row.student_id);
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
      // 学员（active / archived）——仅当前账号
      await client.query('DELETE FROM students WHERE org_id = $1 AND owner_id = $2', [org, uid]);
      const allStudents = [...(b.students ?? []), ...(b.archivedStudents ?? [])];
      for (const s of allStudents) {
        await client.query(
          `INSERT INTO students (org_id, owner_id, name, grade, notes, payload, active)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [org, uid, s.name ?? '', s.grade ?? null, s.note ?? s.notes ?? null,
            JSON.stringify(studentToRow(s).payload), s.id?.startsWith('arc-') ? false : true],
        );
      }

      // 课次（schedule 表；studentId 前端 → 后端 id）——仅当前账号
      await client.query('DELETE FROM schedule WHERE org_id = $1 AND owner_id = $2', [org, uid]);
      const stuRows = (await client.query('SELECT id, payload FROM students WHERE org_id = $1 AND owner_id = $2', [org, uid])).rows;
      const sidMap = {};
      for (const r of stuRows) { if (r.payload?._fid) sidMap[r.payload._fid] = r.id; }
      for (const c of b.courses ?? []) {
        const row = courseToRow(c, sidMap);
        if (!row.student_id) continue;
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

export default router;
