import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppDataContext } from '@/data/app-store';
import type { IAppDataApi, IAuthUser } from '@/data/app-store';
import type { IAppData } from '@/data/types';
import { buildSeed } from '@/data/seed';
import { cloudLogin, loadCloudState, syncCloudState, getLastSyncedSnap, markLastSyncedSnap, snapOfBusiness } from '@/api/desktop';
import { backupBusinessData } from '@/api/backup';
import { getToken, setToken } from '@/api/client';

const NS = 'shangkeya';

function emptySeed(): IAppData {
  return buildSeed();
}

function loadAuth(): IAuthUser | null {
  try {
    const raw = localStorage.getItem(`${NS}:auth`);
    if (raw) return JSON.parse(raw) as IAuthUser;
  } catch {
    /* ignore */
  }
  return null;
}

function saveAuth(user: IAuthUser | null): void {
  try {
    if (user) localStorage.setItem(`${NS}:auth`, JSON.stringify(user));
    else localStorage.removeItem(`${NS}:auth`);
  } catch {
    /* ignore */
  }
}

export default function AppProvider({ children }: { children: ReactNode }) {
  const [data, setDataState] = useState<IAppData>(() => emptySeed());
  const [authUser, setAuthUser] = useState<IAuthUser | null>(() => loadAuth());
  const [cloudReady, setCloudReady] = useState(false); // 云端数据是否已加载（未就绪前不推送，避免覆盖云端）
  const [syncing, setSyncing] = useState(false);
  const loadedRef = useRef(false); // 是否完成首次云端加载
  const dataRef = useRef(data);
  useEffect(() => { dataRef.current = data; }, [data]);
  const syncingRef = useRef(syncing);
  useEffect(() => { syncingRef.current = syncing; }, [syncing]);

  // 启动：若存在 token，恢复会话并加载云端数据
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!getToken()) return;
      try {
        const cloud = await loadCloudState();
        if (cancelled) return;
        setDataState((prev) => {
          const merged: IAppData = {
            ...prev,
            students: cloud.students ?? prev.students,
            archivedStudents: cloud.archivedStudents ?? prev.archivedStudents,
            courses: cloud.courses ?? prev.courses,
            schedule: cloud.schedule ?? prev.schedule,
            recharges: cloud.recharges ?? prev.recharges,
            scores: cloud.scores ?? prev.scores,
            settings: { ...prev.settings, ...(cloud.settings ?? {}) },
            announcement: cloud.announcement ?? prev.announcement,
          };
          return merged;
        });
        loadedRef.current = true;
        setCloudReady(true);
        // 登录后/会话恢复后：学员与课程信息备份到本地
        void backupBusinessData(cloud, authUser?.username).catch(() => undefined);
      } catch {
        // 加载失败：保留本地状态，登录后重试
        setToken(null);
        setAuthUser(null);
        saveAuth(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 数据变更 → 防抖推送云端（排除 courseware / accounts / archivedStudents 本地部分）
  useEffect(() => {
    if (!cloudReady) return;
    if (!authUser) return;
    const timer = setTimeout(() => {
      void (async () => {
        if (syncing) return;
        const payload: IAppData = data;
        const snap = snapOfBusiness(payload);
        if (getLastSyncedSnap() === snap) return; // 无变化（含“已立即同步”的数据）
        setSyncing(true);
        try {
          await syncCloudState(payload);
          markLastSyncedSnap(snap);
        } catch (e) {
          console.error('[cloud sync] 保存失败：', e);
        } finally {
          setSyncing(false);
        }
      })();
    }, 800);
    return () => clearTimeout(timer);
  }, [data, cloudReady, authUser, syncing]);

  const setData: IAppDataApi['setData'] = useCallback((updater) => {
    setDataState((prev) => updater(prev));
  }, []);

  const login: IAppDataApi['login'] = useCallback(
    async (username, password) => {
      const r = await cloudLogin(username, password);
      if (!r.ok) return { ok: false, message: r.message ?? '登录失败' };
      const user: IAuthUser = { username: r.user!.username, name: r.user!.name ?? r.user!.username };
      setAuthUser(user);
      saveAuth(user);
      // 登录后加载云端数据
      try {
        const cloud = await loadCloudState();
        setDataState((prev) => {
          const merged: IAppData = {
            ...prev,
            students: cloud.students ?? prev.students,
            archivedStudents: cloud.archivedStudents ?? prev.archivedStudents,
            courses: cloud.courses ?? prev.courses,
            schedule: cloud.schedule ?? prev.schedule,
            recharges: cloud.recharges ?? prev.recharges,
            scores: cloud.scores ?? prev.scores,
            settings: { ...prev.settings, ...(cloud.settings ?? {}) },
            announcement: cloud.announcement ?? prev.announcement,
          };
          return merged;
        });
        loadedRef.current = true;
        setCloudReady(true);
        // 登录后：学员与课程信息备份到本地（不阻塞登录）
        void backupBusinessData(cloud, username).catch(() => undefined);
      } catch {
        // 云端加载失败仍放行（本地空数据），后续变更会尝试推送
        setCloudReady(true);
      }
      return { ok: true };
    },
    [],
  );

  const register: IAppDataApi['register'] = useCallback(async () => {
    // 云端账号由管理员创建；桌面端不再支持本地注册
    return false;
  }, []);

  const logout = useCallback(() => {
    setAuthUser(null);
    saveAuth(null);
    setToken(null);
  }, []);

  /** 手动刷新：从服务器拉取最新数据并合并到本地显示 */
  const refresh: IAppDataApi['refresh'] = useCallback(async () => {
    try {
      const cloud = await loadCloudState();
      setDataState((prev) => {
        const merged: IAppData = {
          ...prev,
          students: cloud.students ?? prev.students,
          archivedStudents: cloud.archivedStudents ?? prev.archivedStudents,
          courses: cloud.courses ?? prev.courses,
          schedule: cloud.schedule ?? prev.schedule,
          recharges: cloud.recharges ?? prev.recharges,
          scores: cloud.scores ?? prev.scores,
          settings: { ...prev.settings, ...(cloud.settings ?? {}) },
          announcement: cloud.announcement ?? prev.announcement,
        };
        return merged;
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  // 登录后：每 60 秒 + 窗口重新聚焦时自动刷新云端。
  // 校长端解除师生关系/新增学员/新排课等学校侧变更，老师端无需重启即可联动（如解除后学员移入历史学员）
  useEffect(() => {
    if (!authUser) return;
    let stop = false;
    const doAutoRefresh = async () => {
      try {
        // 先推送本地变更（如删除课程/修改信息），再拉云端覆盖——
        // 避免"本地删除尚未上传就被云端旧数据覆盖"导致删除的课程刷新后复活
        if (!syncingRef.current) {
          const payload = dataRef.current;
          const snap = snapOfBusiness(payload);
          if (getLastSyncedSnap() !== snap) {
            await syncCloudState(payload);
            markLastSyncedSnap(snap);
          }
        }
        const cloud = await loadCloudState();
        if (stop) return;
        setDataState((prev) => {
          const merged: IAppData = {
            ...prev,
            students: cloud.students ?? prev.students,
            archivedStudents: cloud.archivedStudents ?? prev.archivedStudents,
            courses: cloud.courses ?? prev.courses,
            schedule: cloud.schedule ?? prev.schedule,
            recharges: cloud.recharges ?? prev.recharges,
            scores: cloud.scores ?? prev.scores,
            settings: { ...prev.settings, ...(cloud.settings ?? {}) },
            announcement: cloud.announcement ?? prev.announcement,
          };
          return merged;
        });
      } catch {
        /* 网络抖动忽略，下次轮询再试 */
      }
    };
    const timer = setInterval(doAutoRefresh, 60000);
    window.addEventListener('focus', doAutoRefresh);
    return () => {
      stop = true;
      clearInterval(timer);
      window.removeEventListener('focus', doAutoRefresh);
    };
  }, [authUser]);

  return (
    <AppDataContext.Provider value={{ data, setData, authUser, login, register, logout, refresh }}>
      {children}
    </AppDataContext.Provider>
  );
}
