// 课件文件存储：IndexedDB（键 = 课件节点 id，值为 File/Blob）
// localStorage 有 5MB 上限，PPT/PDF 课件可能数 MB~数十 MB，故用 IndexedDB 保存文件本体，
// 元数据（名称/大小/类型）随 ICourseNode.file 存在应用数据里。

const DB_NAME = 'shangkeya-courseware';
const STORE = 'files';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 保存课件文件本体（覆盖式） */
export async function saveCoursewareFile(id: string, blob: Blob): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/** 读取课件文件本体；不存在返回 null */
export async function getCoursewareFile(id: string): Promise<Blob | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => {
      db.close();
      resolve((req.result as Blob | undefined) ?? null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

/** 删除课件文件本体 */
export async function deleteCoursewareFile(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/** 读取课件文件本体：目录导入的走本机 path（Tauri fs 二进制），手动添加的走 IndexedDB */
export async function loadCoursewareBlob(node: {
  id: string;
  file?: { name: string; size: number; mime: string; path?: string } | null;
}): Promise<Blob | null> {
  if (node.file?.path) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const bytes = await invoke<number[]>('read_courseware_file', { path: node.file.path });
      return new Blob([new Uint8Array(bytes)]);
    } catch {
      return getCoursewareFile(node.id);
    }
  }
  return getCoursewareFile(node.id);
}

/** 课件文件类型判断 */
export function isPdf(mime?: string | null, name = ''): boolean {
  if (mime) return mime === 'application/pdf' || mime.includes('pdf');
  return name.toLowerCase().endsWith('.pdf');
}

export function isImage(mime?: string | null, name = ''): boolean {
  if (mime) return mime.startsWith('image/');
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(name);
}

export function isPpt(mime?: string | null, name = ''): boolean {
  if (mime) return mime.includes('powerpoint') || mime.includes('presentation');
  return /\.pptx?$/i.test(name);
}

/** TIFF 图集课件（多页讲解/问题/答案图集） */
export function isTiff(mime?: string | null, name = ''): boolean {
  if (mime) return mime.includes('tiff');
  return /\.tiff?$/i.test(name);
}

/** HTML 网页课件（交互课件/网页课件） */
export function isHtml(mime?: string | null, name = ''): boolean {
  if (mime) return mime.includes('html');
  return /\.html?$/i.test(name);
}

/** 视频课件 */
export function isVideo(mime?: string | null, name = ''): boolean {
  if (mime) return mime.startsWith('video/');
  return /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|mpg|mpeg)$/i.test(name);
}

/** 音频课件 */
export function isAudio(mime?: string | null, name = ''): boolean {
  if (mime) return mime.startsWith('audio/');
  return /\.(mp3|wav|m4a|flac|ogg|oga|aac|wma|opus)$/i.test(name);
}

/** 按文件名（扩展名）映射 MIME：课件文件入库用（PDF/TIFF/图片/视频/音频） */
export function mimeForFile(name: string): string {
  const ext = (name.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase();
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'html':
    case 'htm':
      return 'text/html';
    case 'tiff':
    case 'tif':
      return 'image/tiff';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'mp4':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'mov':
      return 'video/quicktime';
    case 'avi':
      return 'video/x-msvideo';
    case 'mkv':
      return 'video/x-matroska';
    case 'flv':
      return 'video/x-flv';
    case 'wmv':
      return 'video/x-ms-wmv';
    case 'm4v':
      return 'video/x-m4v';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'm4a':
      return 'audio/mp4';
    case 'flac':
      return 'audio/flac';
    case 'ogg':
    case 'oga':
      return 'audio/ogg';
    case 'aac':
      return 'audio/aac';
    case 'wma':
      return 'audio/x-ms-wma';
    default:
      return 'application/octet-stream';
  }
}
