// 桌面端云端数据服务：登录 / 加载云端状态 / 整包同步（含课次与手机端合并）
import { api, setToken } from './client';
import type { IAppData, ICourse } from '@/data/types';

export interface CloudUser {
  id: number;
  username: string;
  name: string;
  role: string;
  org_id: number;
  expires_at?: string | null; // 账号到期时间（老师账号）
}

/** 云端登录 */
export async function cloudLogin(username: string, password: string): Promise<{ ok: boolean; user?: CloudUser; message?: string }> {
  const r = await api<{ token: string; user: CloudUser }>('/api/auth/login', {
    method: 'POST',
    body: { username, password },
    auth: false,
  });
  if (r.ok && r.data.token) {
    setToken(r.data.token);
    return { ok: true, user: r.data.user };
  }
  return { ok: false, message: r.error?.message ?? '登录失败' };
}

/** 获取注册图形验证码（SVG dataURL + captcha_id） */
export async function fetchCaptcha(): Promise<{ captcha_id: string; img: string } | null> {
  const r = await api<{ captcha_id: string; img: string }>('/api/auth/captcha', { auth: false });
  return r.ok ? r.data : null;
}

/** 云端注册（需图形验证码）；成功后自动写入 token */
export async function cloudRegister(
  username: string,
  password: string,
  captchaId: string,
  captcha: string,
): Promise<{ ok: boolean; message?: string }> {
  const r = await api<{ token: string; user: CloudUser }>('/api/auth/register', {
    method: 'POST',
    body: { username, password, captcha_id: captchaId, captcha },
    auth: false,
  });
  if (r.ok && r.data.token) {
    setToken(r.data.token);
    return { ok: true };
  }
  return { ok: false, message: r.error?.message ?? '注册失败' };
}

/** 充值卡兑换续期：已登录给当前账号；未登录可传账号密码自救（成功返回 token 自动登录） */
export async function redeemCard(
  code: string,
  creds?: { username?: string; password?: string },
): Promise<{
  ok: boolean;
  message?: string;
  days?: number;
  type?: string;
  expires_at?: string;
  token?: string;
}> {
  const r = await api<{ ok: boolean; days: number; type: string; expires_at: string; token?: string }>(
    '/api/cards/redeem',
    {
      method: 'POST',
      body: { code, ...(creds?.username ? { username: creds.username, password: creds.password } : {}) },
    },
  );
  if (r.ok) {
    const out: { ok: true; days: number; type: string; expires_at: string; token?: string } = {
      ok: true,
      days: Number(r.data.days),
      type: r.data.type,
      expires_at: r.data.expires_at,
    };
    if (r.data.token) out.token = r.data.token;
    return out;
  }
  return { ok: false, message: r.error?.message ?? '兑换失败' };
}

/** 当前账号信息（含到期时间） */
export async function fetchMyAccount(): Promise<{ ok: boolean; expires_at?: string | null; message?: string }> {
  const r = await api<{ user: { expires_at?: string | null } }>('/api/auth/me');
  if (r.ok) return { ok: true, expires_at: r.data.user.expires_at ?? null };
  return { ok: false, message: r.error?.message ?? '获取账号信息失败' };
}

/** 拉取云端业务状态（组装 IAppData 业务块；courseware 由本地提供） */
export async function loadCloudState(): Promise<Partial<IAppData>> {
  const r = await api<Partial<IAppData>>('/api/desktop/state');
  if (!r.ok) throw new Error(r.error?.message ?? '加载云端数据失败');
  return r.data;
}

/** 课次合并：本地 courses 与云端课次（手机端可能改动）合并
 *  - 云端有、本地无 → 并入本地（手机端新建的课次保留）
 *  - 本地有、云端无 → 保留本地（随 sync 上传）
 *  - 都有 → 以本地为准（桌面端编辑优先）
 */
export function mergeCourses(local: ICourse[], remote: ICourse[]): ICourse[] {
  const key = (c: ICourse) => `${c.studentId}|${c.date}|${c.start}`;
  const localKeys = new Set(local.map(key));
  const remoteKeys = new Set(remote.map(key));
  const merged = [...local];
  for (const rc of remote) {
    const k = key(rc);
    if (!localKeys.has(k)) {
      merged.push(rc); // 手机端新建的课次
    } else if (!remoteKeys.has(k)) {
      // 本地有、云端无 → 本地已存在（上面已包含）
    }
  }
  // 排序：按日期+时间
  merged.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  return merged;
}

/** 整包同步到云端（courses 块先与云端合并，避免覆盖手机端课次改动） */
export async function syncCloudState(data: IAppData): Promise<void> {
  // 先拉云端课次（手机端可能编辑过）
  const remote = await loadCloudState();
  const remoteCourses = remote.courses ?? [];
  const mergedCourses = mergeCourses(data.courses ?? [], remoteCourses);

  const body = {
    students: data.students ?? [],
    archivedStudents: data.archivedStudents ?? [],
    courses: mergedCourses,
    schedule: data.schedule ?? [],
    recharges: data.recharges ?? [],
    scores: data.scores ?? {},
    settings: data.settings ?? {},
    announcement: data.announcement ?? { title: '', content: '', expireAt: '' },
  };
  const r = await api('/api/desktop/sync', { method: 'PUT', body });
  if (!r.ok) throw new Error(r.error?.message ?? '保存到服务器失败');
}
