// 本地备份（加密）：老师登录 / 启动恢复会话加载云端数据后，把学员信息、课程信息等业务数据
// 备份到应用数据目录（安装目录\app-data）的 backup 文件夹。
// 加密：AES-256-GCM；密钥由「登录用户名 + 应用固定盐」经 PBKDF2-SHA256 派生，
// 不生成、不保存任何密钥文件——备份文件明文部分保留 username，解密时用同一用户名即可还原。
import type { IAppData } from '@/data/types';

/** 备份文件内容（加密后） */
export interface BackupPayload {
  v: number;
  alg: string;
  username: string;
  backupAt: string;
  iv: string;
  data: string;
}

/** 应用固定盐（仅用于用户名派生密钥；即使知道也无法脱离用户名还原） */
const SALT = new TextEncoder().encode('shangkeya-backup-v1');
/** PBKDF2 迭代次数（提高暴力破解成本） */
const PBKDF2_ITER = 100_000;
const BACKUP_ALG = 'aes-256-gcm';
/** 旧版密钥文件名（升级清理用） */
const LEGACY_KEY_FILE = 'backup-key.json';

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 由登录用户名派生 AES-256-GCM 密钥（PBKDF2-SHA256，100k 迭代） */
async function deriveKey(username: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(username),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: SALT, iterations: PBKDF2_ITER, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** 业务数据块（与云端同步字段一致） */
function buildBlock(data: Partial<IAppData>): Partial<IAppData> {
  return {
    students: data.students ?? [],
    archivedStudents: data.archivedStudents ?? [],
    courses: data.courses ?? [],
    schedule: data.schedule ?? [],
    recharges: data.recharges ?? [],
    scores: data.scores ?? {},
    settings: data.settings ?? {},
    announcement: data.announcement ?? { title: '', content: '', expireAt: '' },
  };
}

/**
 * 把业务数据加密备份到本地（应用数据目录 backup 文件夹）：
 * - 密钥由登录用户名派生（不落盘任何密钥文件）
 * - 每次写「带时间戳」的备份文件（保留历史），同时覆盖 latest.json
 * - username 缺失（未登录）时跳过备份
 * 非桌面（浏览器）环境 / 失败时返回 false，不抛出。
 */
export async function backupBusinessData(
  data: Partial<IAppData>,
  username?: string,
): Promise<boolean> {
  if (!username) return false;
  try {
    const { appDataDir, join } = await import('@tauri-apps/api/path');
    const { exists, mkdir, writeTextFile } = await import('@tauri-apps/plugin-fs');
    const dir = await appDataDir();
    const backupDir = await join(dir, 'backup');
    if (!(await exists(backupDir))) {
      await mkdir(backupDir, { recursive: true });
    }
    // 升级清理：删除旧版密钥文件（本版不再使用密钥文件）
    try {
      const { removeFile } = await import('@tauri-apps/plugin-fs');
      const legacy = await join(dir, LEGACY_KEY_FILE);
      if (await exists(legacy)) await removeFile(legacy);
    } catch {
      /* 旧密钥文件删除失败忽略 */
    }
    const key = await deriveKey(username);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = JSON.stringify({ username, backupAt: now.toISOString(), data: buildBlock(data) });
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(plain),
    );
    const payload: BackupPayload = {
      v: 1,
      alg: BACKUP_ALG,
      username,
      backupAt: now.toISOString(),
      iv: b64(iv),
      data: b64(ct),
    };
    const text = JSON.stringify(payload);
    await writeTextFile(await join(backupDir, `shangkeya-backup-${ts}.json`), text);
    await writeTextFile(await join(backupDir, 'latest.json'), text);
    // 清理旧版本产生的明文备份（防泄露）：仅删除非加密格式的历史备份文件
    try {
      const { readDir, readTextFile, removeFile } = await import('@tauri-apps/plugin-fs');
      for (const e of await readDir(backupDir)) {
        if (e.name && e.name.startsWith('shangkeya-backup-') && e.name.endsWith('.json')) {
          try {
            const t = await readTextFile(await join(backupDir, e.name));
            if (!t.includes('"alg"')) await removeFile(await join(backupDir, e.name));
          } catch {
            /* 单个文件失败忽略 */
          }
        }
      }
    } catch {
      /* 清理失败不影响备份 */
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 解密备份文件内容（恢复/查看用）：传入备份文件 JSON 文本，
 * 密钥由备份文件明文中记录的 username 派生（无需密钥文件）。
 */
export async function decryptBackupFile(text: string): Promise<{ username?: string; backupAt: string; data: Partial<IAppData> } | null> {
  try {
    const payload = JSON.parse(text) as BackupPayload;
    if (!payload.username) return null;
    const key = await deriveKey(payload.username);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(payload.iv) },
      key,
      unb64(payload.data),
    );
    return JSON.parse(new TextDecoder().decode(pt));
  } catch {
    return null;
  }
}
