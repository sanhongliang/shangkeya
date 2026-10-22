// 后端 API 冒烟测试：登录 → 学员/课程/课表/充值/成绩/公告/设置 全流程
// 用法：node scripts/smoke-test.js [baseUrl] [username] [password]
const BASE = process.argv[2] || 'http://localhost:3000';
const USER = process.argv[3] || 'admin';
const PASS = process.argv[4] || 'admin123';

let pass = 0, fail = 0;
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

async function api(path, { method = 'GET', body, token } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
}

async function main() {
  console.log('== 登录 ==');
  const login = await api('/api/auth/login', { method: 'POST', body: { username: USER, password: PASS } });
  check('login 200 + token', login.status === 200 && !!login.token);
  check('login 返回 user', !!login.user?.id);
  const token = login.token;

  console.log('== 未授权拦截 ==');
  const unauth = await api('/api/students');
  check('无 token 401', unauth.status === 401 && unauth.error?.code === 'UNAUTHORIZED');

  console.log('== 学员 ==');
  const s1 = await api('/api/students', { method: 'POST', body: { name: '测试学员A', grade: '初二', phone: '13800000001' }, token });
  check('新增学员', s1.status === 201 && s1.student?.id);
  const sid = s1.student?.id;
  const s2 = await api('/api/students', { method: 'POST', body: { name: '测试学员B', grade: '初三' }, token });
  check('新增学员B', s2.status === 201);
  const list = await api('/api/students?name=测试', { token });
  check('搜索学员(ILIKE)', list.status === 200 && list.students?.length >= 2);
  const upd = await api(`/api/students/${sid}`, { method: 'PUT', body: { balance: 20 }, token });
  check('编辑学员(balance=20)', upd.status === 200 && upd.student?.balance == 20);

  console.log('== 课程 ==');
  const c1 = await api('/api/courses', { method: 'POST', body: { name: '数学强化', subject: '数学', grade: '初二', duration_min: 90, price: 200 }, token });
  check('新增课程', c1.status === 201 && c1.course?.id);
  const cid = c1.course?.id;
  const clist = await api('/api/courses?subject=数学', { token });
  check('搜索课程(subject)', clist.status === 200 && clist.courses?.length >= 1);

  console.log('== 课表 ==');
  const sch = await api('/api/schedule', {
    method: 'POST',
    body: { student_id: sid, course_id: cid, start_at: '2026-10-20T09:00:00+08:00', end_at: '2026-10-20T10:30:00+08:00', status: 'scheduled' },
    token,
  });
  check('新增课次', sch.status === 201 && sch.entry?.id);
  const eid = sch.entry?.id;
  const slist = await api('/api/schedule?from=2026-10-19&to=2026-10-21', { token });
  check('按日期范围查课表', slist.status === 200 && slist.schedule?.some(e => e.id == eid));
  check('联表返回学员/课程名', slist.schedule?.[0]?.student_name && slist.schedule?.[0]?.course_name);
  const supd = await api(`/api/schedule/${eid}`, { method: 'PUT', body: { status: 'done' }, token });
  check('编辑课次状态 done', supd.status === 200 && supd.entry?.status === 'done');

  console.log('== 充值/余额联动 ==');
  const rec = await api('/api/recharges', { method: 'POST', body: { student_id: sid, amount: 100, type: 'recharge' }, token });
  check('充值 +100', rec.status === 201 && rec.balance == 120); // 20 + 100
  const consume = await api('/api/recharges', { method: 'POST', body: { student_id: sid, amount: 30, type: 'consume' }, token });
  check('扣费 -30', consume.status === 201 && consume.balance == 90);
  const rlist = await api(`/api/recharges?student_id=${sid}`, { token });
  check('充值记录查询', rlist.status === 200 && rlist.recharges?.length === 2);

  console.log('== 成绩 ==');
  const score = await api('/api/scores', { method: 'POST', body: { student_id: sid, exam_name: '期中', subject: '数学', score: 95, total: 100 }, token });
  check('新增成绩', score.status === 201 && score.score?.id);
  const sl = await api('/api/scores?student_id=' + sid, { token });
  check('成绩查询', sl.status === 200 && sl.scores?.length === 1);

  console.log('== 公告 ==');
  const ann = await api('/api/announcements', { method: 'POST', body: { title: '国庆放假通知', content: '10月1-7日停课' }, token });
  check('新增公告', ann.status === 201 && ann.announcement?.id);
  const al = await api('/api/announcements', { token });
  check('公告列表', al.status === 200 && al.announcements?.length >= 1);

  console.log('== 设置 ==');
  const set1 = await api('/api/settings', { method: 'PUT', body: { settings: { boardStyle: 'green', ratio: '16:9', hideTitle: true } }, token });
  check('保存设置', set1.status === 200);
  const set2 = await api('/api/settings', { token });
  check('读取设置(JSONB)', set2.status === 200 && set2.settings?.boardStyle === 'green');

  console.log('== 删除 ==');
  const d1 = await api(`/api/schedule/${eid}`, { method: 'DELETE', token });
  check('删除课次', d1.status === 200 && d1.ok);
  const d2 = await api(`/api/students/${sid}`, { method: 'DELETE', token });
  check('删除学员(级联)', d2.status === 200 && d2.ok);
  const cld = await api('/api/announcements/' + ann.announcement?.id, { method: 'DELETE', token });
  check('删除公告', cld.status === 200);

  console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('smoke test error:', e);
  process.exit(1);
});
