// 云端 API 基础封装：BASE_URL / token / fetch / 统一错误
const NS = 'shangkeya';

/** 后端 API 地址：可在桌面端设置页/配置文件覆盖；dev 走本地后端，生产构建走云端服务器 */
export function getBaseUrl(): string {
  const custom = (window as any).__SHANGKEYA_API__;
  if (custom) return custom;
  return import.meta.env.DEV ? 'http://localhost:3000' : 'http://82.156.240.204';
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(`${NS}:token`);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(`${NS}:token`, token);
    else localStorage.removeItem(`${NS}:token`);
  } catch {
    /* ignore */
  }
}

export interface ApiResult<T = unknown> {
  status: number;
  ok: boolean;
  data: T;
  error?: { code: string; message: string };
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<ApiResult<T>> {
  const { method = 'GET', body, auth = true } = opts;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    const t = getToken();
    if (t) headers.Authorization = 'Bearer ' + t;
  }
  let res: Response;
  try {
    res = await fetch(getBaseUrl() + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    return { status: 0, ok: false, data: null as unknown as T, error: { code: 'NETWORK', message: '无法连接服务器：' + (e instanceof Error ? e.message : String(e)) } };
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* 非 JSON */
  }
  const bodyObj = (data ?? {}) as { error?: { code?: string; message?: string } };
  if (res.status === 401) {
    // 登录态失效：清 token，前端跳转登录
    setToken(null);
  }
  if (!res.ok) {
    return {
      status: res.status,
      ok: false,
      data: null as unknown as T,
      error: { code: bodyObj.error?.code ?? 'ERROR', message: bodyObj.error?.message ?? `请求失败(${res.status})` },
    };
  }
  return { status: res.status, ok: true, data: data as T };
}
