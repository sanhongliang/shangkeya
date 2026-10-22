import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAppData } from '@/data/app-store';
import type { ICourseNode } from '@/data/types';
import {
  isHtml,
  isImage,
  isPdf,
  isPpt,
  isTiff,
  loadCoursewareBlob,
  saveCoursewareFile,
} from '@/lib/courseware-files';
import { decodeTiffToFrames } from '@/lib/tiff-frames';
import { cn } from '@/lib/utils';

/** Tauri import_courseware_dir 返回结构（版本 → 年级 → 学期 → 章节/文件） */
interface ImportedNode {
  name: string;
  kind: string;
  path: string;
  children?: ImportedNode[];
}
interface ImportedSemester {
  semester: string;
  nodes: ImportedNode[];
}
interface ImportedGrade {
  grade: string;
  semesters: ImportedSemester[];
}
interface ImportedVersion {
  version: string;
  grades: ImportedGrade[];
}
interface ImportResult {
  ok: boolean;
  message: string;
  versions: ImportedVersion[];
}

/** 课件根目录（持久化于 localStorage） */
interface RootEntry {
  path: string;
  name: string;
}
const ROOTS_KEY = 'shangkeya:coursewareRoots';
/** 浏览器模式导入的目录（文件存 IndexedDB，树来自应用数据） */
const BROWSER_ROOT = '__browser__';

function loadRoots(): RootEntry[] {
  try {
    return JSON.parse(localStorage.getItem(ROOTS_KEY) ?? '[]') as RootEntry[];
  } catch {
    return [];
  }
}

export default function CoursewarePage() {
  const { data, setData } = useAppData();
  const [roots, setRoots] = useState<RootEntry[]>(loadRoots);
  const [curRoot, setCurRoot] = useState<string>('');
  const [tree, setTree] = useState<ImportedVersion[] | null>(null);
  // 版本标签：根目录第一层文件夹（横向并列）
  const [versionList, setVersionList] = useState<string[]>([]);
  const [selVersion, setSelVersion] = useState<string | null>(null);
  // 年级标签：版本下第一层文件夹
  const [gradeList, setGradeList] = useState<string[]>([]);
  const [selGrade, setSelGrade] = useState<string | null>(null);
  // 学期标签：年级下第一层文件夹
  const [semesterList, setSemesterList] = useState<string[]>([]);
  const [selSemester, setSelSemester] = useState<string | null>(null);
  const [browserBranches, setBrowserBranches] = useState<{ key: string; label: string; nodes: ICourseNode[] }[]>([]);
  const [selNode, setSelNode] = useState<ImportedNode | null>(null);
  const [selBrowserNode, setSelBrowserNode] = useState<ICourseNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [tauriMode] = useState<boolean>(
    () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window,
  );
  const dirInputRef = useRef<HTMLInputElement>(null);
  // 预览状态
  const [previewFrames, setPreviewFrames] = useState<string[] | null>(null);
  const [previewPage, setPreviewPage] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState<'pdf' | 'img' | 'ppt' | 'tiff' | 'html' | null>(null);
  // TIFF 解码进度（避免大图集解码时界面无反馈）
  const [tiffProgress, setTiffProgress] = useState<{ done: number; total: number } | null>(null);
  // 目录树展开状态：存已展开的节点 key（默认只展开根目录层）
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  // 删除课件目录确认弹框
  const [delOpen, setDelOpen] = useState(false);

  const toggleNode = (key: string) =>
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /** 选中学期 → 左侧树状图直接展示该学期文件夹内容 */
  const pickSemester = (s: string) => setSelSemester(s);

  // 进入页面默认加载第一个已保存根目录（版本/年级/学期标签直接显示）
  useEffect(() => {
    if (roots.length > 0 && !curRoot) {
      void loadRoot(roots[0].path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 点击「添加课件目录」→ 选择本地课件根目录 → 不做验证，直接存入下拉框 */
  const addRoot = async () => {
    if (tauriMode) {
      setLoading(true);
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const dir = await open({
          directory: true,
          multiple: false,
          title: '选择课件根目录（第一层为版本，第二层为年级，第三层为学期）',
        });
        if (!dir || Array.isArray(dir)) return;
        const entry: RootEntry = { path: dir, name: dir.split(/[\\/]/).pop() || dir };
        const next = roots.some((r) => r.path === dir) ? roots : [...roots, entry];
        setRoots(next);
        localStorage.setItem(ROOTS_KEY, JSON.stringify(next));
        setCurRoot(dir);
        toast.success(`已添加课件目录：${dir}`);
        await loadRoot(dir);
      } catch (e) {
        toast.error(String(e));
      } finally {
        setLoading(false);
      }
    } else {
      dirInputRef.current?.click();
    }
  };

  /** 选择下拉框中的根目录 → 扫描加载课件树（不做验证，仅展示目录内容） */
  const loadRoot = async (path: string) => {
    setCurRoot(path);
    setSelNode(null);
    setSelBrowserNode(null);
    setPreviewFrames(null);
    setPreviewUrl(null);
    setPreviewHtml(null);
    setPreviewKind(null);
    if (path === BROWSER_ROOT) {
      const branches = Object.entries(data.courseware)
        .filter(([, ns]) => ns.length > 0)
        .map(([key, nodes]) => ({ key, label: key.replace(/\|/g, ' / '), nodes }))
        .sort((a, b) => a.key.localeCompare(b.key));
      setBrowserBranches(branches);
      setTree(null);
      setVersionList([]);
      setSelVersion(null);
      setGradeList([]);
      setSelGrade(null);
      setSemesterList([]);
      setSelSemester(null);
      return;
    }
    setLoading(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const res = await invoke<ImportResult>('import_courseware_dir', { dir: path });
      // 无论验证是否通过，目录内容树照常展示（仅用于浏览）
      if (res.versions.length > 0) {
        setTree(res.versions);
        // 版本标签：根目录第一层文件夹，横向并列
        const vers = res.versions.map((v) => v.version);
        setVersionList(vers);
        setSelVersion((prev) => (prev && vers.includes(prev) ? prev : vers[0] ?? null));
        // 默认展开第一个版本的年级
        const firstVer = res.versions.find((v) => v.version === (vers[0] ?? ''));
        setGradeList(firstVer?.grades.map((g) => g.grade) ?? []);
        setSelGrade(firstVer?.grades[0]?.grade ?? null);
        const firstGrade = firstVer?.grades[0];
        setSemesterList(firstGrade?.semesters.map((s) => s.semester) ?? []);
        setSelSemester(firstGrade?.semesters[0]?.semester ?? null);
      } else {
        toast.info('该目录下未发现课件文件');
        setTree([]);
        setVersionList([]);
        setSelVersion(null);
        setGradeList([]);
        setSelGrade(null);
        setSemesterList([]);
        setSelSemester(null);
      }
    } catch (e) {
      toast.error(String(e));
      setTree([]);
      setVersionList([]);
      setSelVersion(null);
    } finally {
      setLoading(false);
    }
  };

  /** 删除当前选中的课件根目录（弹框确认后） */
  const removeRoot = () => {
    if (!curRoot || curRoot === BROWSER_ROOT) return;
    // Tauri 模式：同步删除该目录的导入缓存（扫描路径文件记录）
    if (tauriMode) {
      void invoke('remove_import_cache', { dir: curRoot }).catch(() => {});
    }
    const next = roots.filter((r) => r.path !== curRoot);
    setRoots(next);
    localStorage.setItem(ROOTS_KEY, JSON.stringify(next));
    setCurRoot('');
    setTree(null);
    setVersionList([]);
    setSelVersion(null);
    setGradeList([]);
    setSelGrade(null);
    setSemesterList([]);
    setSelSemester(null);
    setSelNode(null);
    setSelBrowserNode(null);
    setPreviewFrames(null);
    setPreviewUrl(null);
    setPreviewHtml(null);
    setPreviewKind(null);
    toast.success(`已删除课件目录：${curRoot}`);
    // 若仍有目录，自动加载第一个
    if (next.length > 0) {
      void loadRoot(next[0].path);
    }
  };

  /** 浏览器模式：webkitdirectory 选择文件夹 → 导入 IndexedDB + 应用数据 */
  const handleDirFiles = async (files: FileList) => {
    const list = Array.from(files).filter((f) => f.size > 0);
    if (list.length === 0) return;
    setLoading(true);
    try {
      const byBranch = new Map<string, { relPath: string; file: File }[]>();
      const kinds = new Set<string>();
      for (const f of list) {
        const rel = f.webkitRelativePath.replace(/\\/g, '/');
        const parts = rel.split('/');
        if (parts.length < 4) continue;
        const key = `${parts[0]}|${parts[1]}|${parts[2]}`;
        if (!byBranch.has(key)) byBranch.set(key, []);
        byBranch.get(key)!.push({ relPath: parts.slice(3).join('/'), file: f });
        kinds.add(f.name.split('.').pop()?.toLowerCase() ?? '');
      }
      const hasCw = ['ppt', 'pptx', 'pdf', 'tiff', 'tif', 'html', 'htm'].some((k) => kinds.has(k));
      if (!hasCw) {
        toast.error('目录验证未通过：子孙文件中没有发现 PPT / PDF / TIFF / HTML 课件文件');
        return;
      }
      let added = 0;
      const next: Record<string, ICourseNode[]> = { ...data.courseware };
      for (const [key, items] of byBranch) {
        const tree: ICourseNode[] = [];
        for (const it of items) {
          const segs = it.relPath.split('/');
          const fileName = segs.pop()!;
          const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
          if (!['ppt', 'pptx', 'pdf', 'tiff', 'tif', 'png', 'jpg', 'jpeg', 'html', 'htm'].includes(ext)) continue;
          const id = `w-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          let level = tree;
          for (const seg of segs) {
            if (!seg) continue;
            let folder = level.find((n) => n.type === 'folder' && n.name === seg);
            if (!folder) {
              folder = {
                id: `w-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                name: seg,
                type: 'folder',
                children: [],
              };
              level.push(folder);
            }
            level = folder.children!;
          }
          level.push({
            id,
            name: fileName,
            type: 'file',
            file: { name: fileName, size: it.file.size, mime: it.file.type || '' },
          });
          try {
            await saveCoursewareFile(id, it.file);
            added++;
          } catch {
            // 单个文件保存失败不阻断
          }
        }
        next[key] = [...(next[key] ?? []), ...tree];
      }
      setData((prev) => ({ ...prev, courseware: next }));
      const entry: RootEntry = { path: BROWSER_ROOT, name: '浏览器导入的课件目录' };
      const rootsNext = roots.some((r) => r.path === BROWSER_ROOT)
        ? roots
        : [...roots, entry];
      setRoots(rootsNext);
      localStorage.setItem(ROOTS_KEY, JSON.stringify(rootsNext));
      setCurRoot(BROWSER_ROOT);
      const branches = Object.entries(next)
        .filter(([, ns]) => ns.length > 0)
        .map(([key, nodes]) => ({ key, label: key.replace(/\|/g, ' / '), nodes }))
        .sort((a, b) => a.key.localeCompare(b.key));
      setBrowserBranches(branches);
      setTree(null);
      toast.success(`目录导入成功：共写入 ${byBranch.size} 个分支、${added} 个课件文件`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
      if (dirInputRef.current) dirInputRef.current.value = '';
    }
  };

  /** 点击课件文件 → 右下角预览（本机 path 或 IndexedDB） */
  const previewNode = async (n: ImportedNode) => {
    setSelNode(n);
    setPreviewFrames(null);
    setPreviewUrl(null);
    setPreviewHtml(null);
    setPreviewKind(null);
    if (!n.path) return;
    const kind = isPdf(null, n.name)
      ? 'pdf'
      : isTiff(null, n.name)
        ? 'tiff'
        : isImage(null, n.name)
          ? 'img'
          : isPpt(null, n.name)
            ? 'ppt'
            : isHtml(null, n.name)
              ? 'html'
              : null;
    if (!kind) return;
    const kindMime: Record<string, string> = {
      pdf: 'application/pdf',
      tiff: 'image/tiff',
      tif: 'image/tiff',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      html: 'text/html',
      htm: 'text/html',
    };
    try {
      const blob = await loadCoursewareBlob({
        id: n.path,
        file: { name: n.name, size: 0, mime: kindMime[n.kind] ?? '', path: n.path },
      });
      if (!blob) {
        toast.error('课件文件读取失败');
        return;
      }
      if (kind === 'tiff') {
        setTiffProgress({ done: 0, total: 0 });
        const frames = await decodeTiffToFrames(await blob.arrayBuffer(), 0.88, (done, total) =>
          setTiffProgress({ done, total }),
        );
        setPreviewFrames(frames.map((f) => f.url));
        setPreviewPage(0);
        setPreviewKind('tiff');
        setTiffProgress(null);
      } else if (kind === 'html') {
        const text = await blob.text();
        setPreviewHtml(text);
        setPreviewKind('html');
      } else if (kind === 'pdf') {
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setPreviewKind('pdf');
      } else if (kind === 'img') {
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setPreviewKind('img');
      } else {
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setPreviewKind('ppt');
      }
    } catch (e) {
      toast.error(kind === 'tiff' ? 'TIFF 图集解析失败，请确认文件有效' : String(e));
    }
  };

  /** 点击浏览器导入的文件节点 → 预览 */
  const previewBrowserNode = async (n: ICourseNode) => {
    setSelBrowserNode(n);
    setSelNode(null);
    setPreviewFrames(null);
    setPreviewUrl(null);
    setPreviewHtml(null);
    setPreviewKind(null);
    if (!n.file) return;
    const kind = isPdf(n.file.mime, n.file.name)
      ? 'pdf'
      : isTiff(n.file.mime, n.file.name)
        ? 'tiff'
        : isImage(n.file.mime, n.file.name)
          ? 'img'
          : isPpt(n.file.mime, n.file.name)
            ? 'ppt'
            : isHtml(n.file.mime, n.file.name)
              ? 'html'
              : null;
    if (!kind) return;
    try {
      const blob = await loadCoursewareBlob(n);
      if (!blob) {
        toast.error('课件文件读取失败');
        return;
      }
      if (kind === 'tiff') {
        setTiffProgress({ done: 0, total: 0 });
        const frames = await decodeTiffToFrames(await blob.arrayBuffer(), 0.88, (done, total) =>
          setTiffProgress({ done, total }),
        );
        setPreviewFrames(frames.map((f) => f.url));
        setPreviewPage(0);
        setPreviewKind('tiff');
        setTiffProgress(null);
      } else if (kind === 'html') {
        const text = await blob.text();
        setPreviewHtml(text);
        setPreviewKind('html');
      } else {
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setPreviewKind(kind);
      }
    } catch (e) {
      toast.error(kind === 'tiff' ? 'TIFF 图集解析失败，请确认文件有效' : String(e));
    }
  };

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 选中版本 → 遍历其下文件夹生成「年级」标签行 */
  const onPickVersion = (v: string) => {
    setSelVersion(v);
    const ver = tree?.find((x) => x.version === v) ?? null;
    setGradeList(ver?.grades.map((g) => g.grade) ?? []);
    setSelGrade(ver?.grades[0]?.grade ?? null);
    const g0 = ver?.grades[0];
    setSemesterList(g0?.semesters.map((s) => s.semester) ?? []);
    if (g0?.semesters[0]?.semester) pickSemester(g0.semesters[0].semester);
    else setSelSemester(null);
  };

  /** 选中年级 → 遍历其下文件夹生成「学期」标签行 */
  const onPickGrade = (g: string) => {
    setSelGrade(g);
    const ver = tree?.find((x) => x.version === selVersion) ?? null;
    const grd = ver?.grades.find((x) => x.grade === g) ?? null;
    setSemesterList(grd?.semesters.map((s) => s.semester) ?? []);
    if (grd?.semesters[0]?.semester) pickSemester(grd.semesters[0].semester);
    else setSelSemester(null);
  };

  // 当前选中层级的引用
  const curVer = tree?.find((v) => v.version === selVersion) ?? null;
  const curGrade = curVer?.grades.find((g) => g.grade === selGrade) ?? null;
  const curSem = curGrade?.semesters.find((s) => s.semester === selSemester) ?? null;

  /** 渲染导入的 版本 → 年级 → 学期 → 章节/文件 层级树（默认只展开根目录层） */
  const renderVersions = (versions: ImportedVersion[], depth = 0, prefix = 'v') =>
    versions.map((ver) => {
      const vKey = `${prefix}/${ver.version}`;
      const vOpen = depth === 0 ? true : expandedKeys.has(vKey);
      return (
        <div key={vKey}>
          <button
            type="button"
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted"
            style={{ paddingLeft: 8 + depth * 16 }}
            onClick={() => (depth === 0 ? undefined : toggleNode(vKey))}
          >
            <ChevronRight
              className={cn(
                'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                vOpen && 'rotate-90',
              )}
            />
            <Folder className="h-4 w-4 shrink-0 text-warning" />
            <span className="truncate">{ver.version}</span>
          </button>
          {vOpen &&
            ver.grades.map((g) => {
              const gKey = `${vKey}/g:${g.grade}`;
              const gOpen = expandedKeys.has(gKey);
              return (
                <div key={gKey}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
                    style={{ paddingLeft: 8 + (depth + 1) * 16 }}
                    onClick={() => toggleNode(gKey)}
                  >
                    <ChevronRight
                      className={cn(
                        'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                        gOpen && 'rotate-90',
                      )}
                    />
                    <Folder className="h-4 w-4 shrink-0 text-warning" />
                    <span className="truncate">{g.grade}</span>
                  </button>
                  {gOpen &&
                    g.semesters.map((s) => {
                      const sKey = `${gKey}/s:${s.semester}`;
                      const sOpen = expandedKeys.has(sKey);
                      return (
                        <div key={sKey}>
                          <button
                            type="button"
                            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
                            style={{ paddingLeft: 8 + (depth + 2) * 16 }}
                            onClick={() => toggleNode(sKey)}
                          >
                            <ChevronRight
                              className={cn(
                                'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                                sOpen && 'rotate-90',
                              )}
                            />
                            <Folder className="h-4 w-4 shrink-0 text-warning" />
                            <span className="truncate">{s.semester}</span>
                          </button>
                          {sOpen && renderImported(s.nodes, depth + 3, sKey)}
                        </div>
                      );
                    })}
                </div>
              );
            })}
        </div>
      );
    });

  /** 渲染导入的 章节/文件 层（根目录第一层默认展开，其余可折叠） */
  const renderImported = (ns: ImportedNode[], depth: number, prefix: string) =>
    ns.map((n, i) => {
      const key = `${prefix}/n:${i}-${n.name}`;
      const isFolder = !!n.children;
      const open = expandedKeys.has(key) || depth === 0;
      return (
        <div key={key}>
          <button
            type="button"
            className={cn(
              'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
              selNode === n ? 'bg-accent font-medium text-primary' : 'text-foreground hover:bg-muted',
            )}
            style={{ paddingLeft: 8 + depth * 16 }}
            onClick={() => {
              if (isFolder) {
                setSelNode(n);
                toggleNode(key);
              } else {
                void previewNode(n);
              }
            }}
          >
            {isFolder ? (
              <>
                <ChevronRight
                  className={cn(
                    'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                    open && 'rotate-90',
                  )}
                />
                <Folder className="h-4 w-4 shrink-0 text-warning" />
              </>
            ) : (
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{n.name}</span>
          </button>
          {isFolder && open ? renderImported(n.children!, depth + 1, key) : null}
        </div>
      );
    });

  /** 渲染浏览器导入的分支树 */
  const renderBrowserTree = (ns: ICourseNode[], depth: number) =>
    ns.map((n) => (
      <div key={n.id}>
        <button
          type="button"
          className={cn(
            'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
            selBrowserNode === n
              ? 'bg-accent font-medium text-primary'
              : 'text-foreground hover:bg-muted',
          )}
          style={{ paddingLeft: 8 + depth * 16 }}
          onClick={() => (n.type === 'folder' ? setSelBrowserNode(n) : void previewBrowserNode(n))}
        >
          {n.type === 'folder' ? (
            <Folder className="h-4 w-4 shrink-0 text-warning" />
          ) : (
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{n.name}</span>
        </button>
        {n.children ? renderBrowserTree(n.children, depth + 1) : null}
      </div>
    ));

  const previewName =
    selNode?.children == null && selNode ? selNode.name : selBrowserNode?.name ?? '课件预览';
  const previewNodeObj = selNode && selNode.children == null ? selNode : selBrowserNode;

  return (
    <div className="mx-auto flex h-full w-full max-w-[1500px] flex-col">
      {/* 顶栏：下拉选择课件根目录 + 添加课件目录 */}
      <div className="-mt-2 flex items-center gap-2 border-b py-2">
        <h2 className="ml-[2em] mr-2 text-sm font-semibold">课件目录</h2>
        <Select value={curRoot} onValueChange={(v) => void loadRoot(v)}>
          <SelectTrigger className="!h-[26px] !min-h-[26px] w-[320px]">
            <SelectValue placeholder="选择课件根目录" />
          </SelectTrigger>
          <SelectContent>
            {roots.length === 0 && (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                暂无目录，点击右侧「添加课件目录」
              </div>
            )}
            {roots.map((r) => (
              <SelectItem key={r.path} value={r.path}>
                {r.path}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void addRoot()}>
          {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
          添加课件目录
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-destructive hover:text-destructive"
          disabled={!curRoot || curRoot === BROWSER_ROOT}
          onClick={() => setDelOpen(true)}
        >
          <Trash2 className="mr-1 h-4 w-4" />
          删除课件目录
        </Button>
        <input
          ref={dirInputRef}
          type="file"
          multiple
          className="hidden"
          {...({ webkitdirectory: '' } as Record<string, string>)}
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) void handleDirFiles(files);
          }}
        />
      </div>

      {/* 版本标签行：根目录第一层文件夹，横向并列（始终显示） */}
      <div className="flex items-center gap-3 border-b py-1.5">
        <span className="ml-[2em] shrink-0 text-sm font-semibold">版本</span>
        <div className="flex flex-wrap gap-1.5">
          {!curRoot || curRoot === BROWSER_ROOT ? (
            <span className="text-sm text-muted-foreground">（请先在上方选择课件根目录）</span>
          ) : versionList.length > 0 ? (
            versionList.map((v) => (
              <button
                key={v}
                type="button"
                className={cn(
                  'w-[90px] truncate rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  selVersion === v
                    ? 'bg-primary/5 text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => onPickVersion(v)}
              >
                {v}
              </button>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">（该目录第一层无文件夹）</span>
          )}
        </div>
      </div>

      {/* 年级标签行：版本下第一层文件夹，横向并列（始终显示） */}
      <div className="flex items-center gap-3 border-b py-1.5">
        <span className="ml-[2em] shrink-0 text-sm font-semibold">年级</span>
        <div className="flex flex-wrap gap-1.5">
          {!curRoot || curRoot === BROWSER_ROOT ? (
            <span className="text-sm text-muted-foreground">（请先选择课件根目录）</span>
          ) : gradeList.length > 0 ? (
            gradeList.map((g) => (
              <button
                key={g}
                type="button"
                className={cn(
                  'w-[90px] truncate rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  selGrade === g
                    ? 'bg-primary/5 text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => onPickGrade(g)}
              >
                {g}
              </button>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">（无年级文件夹）</span>
          )}
        </div>
      </div>

      {/* 学期标签行：年级下第一层文件夹，横向并列（始终显示） */}
      <div className="flex items-center gap-3 border-b py-1.5">
        <span className="ml-[2em] shrink-0 text-sm font-semibold">学期</span>
        <div className="flex flex-wrap gap-1.5">
          {!curRoot || curRoot === BROWSER_ROOT ? (
            <span className="text-sm text-muted-foreground">（请先选择课件根目录）</span>
          ) : semesterList.length > 0 ? (
            semesterList.map((s) => (
              <button
                key={s}
                type="button"
                className={cn(
                  'w-[90px] truncate rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  selSemester === s
                    ? 'bg-primary/5 text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => pickSemester(s)}
              >
                {s}
              </button>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">（无学期文件夹）</span>
          )}
        </div>
      </div>

      <div className="mt-2 flex min-h-0 flex-1 gap-3">
        {/* 左侧树型框：完整层级（版本 → 年级 → 学期 → 章节/文件），默认打开根目录 */}
        <Card className="flex w-[300px] shrink-0 flex-col">
          <CardContent className="min-h-0 flex-1 overflow-y-auto p-0">
            <ScrollArea className="h-full">
              <div className="space-y-0.5 p-2">
                {!curRoot ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    请在上方选择课件根目录
                    <br />
                    或点击「添加课件目录」
                  </p>
                ) : loading ? (
                  <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    扫描目录…
                  </div>
                ) : tree ? (
                  curSem ? (
                    /* 已选中学期 → 树状图直接遍历「学期选中的文件夹」内部内容
                       （不再显示 版本/年级/学期 三个目录节点） */
                    <div className="space-y-0.5">
                      {renderImported(curSem.nodes, 0, 'focus-sem')}
                    </div>
                  ) : (
                    renderVersions(
                      selVersion ? tree.filter((v) => v.version === selVersion) : tree,
                      0,
                    )
                  )
                ) : browserBranches.length > 0 ? (
                  browserBranches.map((b) => (
                    <div key={b.key}>
                      <div className="mb-0.5 mt-1 truncate rounded bg-muted/60 px-2 py-1 text-[11px] font-semibold">
                        {b.label}
                      </div>
                      {renderBrowserTree(b.nodes, 0)}
                    </div>
                  ))
                ) : (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    该目录下未发现课件
                  </p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* 右侧预览区 */}
        <Card className="flex min-w-0 flex-1 flex-col">
          <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-3">
            {previewKind === 'tiff' && previewFrames ? (
              <div className="flex h-full w-full min-h-0 items-center justify-center overflow-hidden bg-muted/20 p-2">
                <img
                  src={previewFrames[previewPage]}
                  alt={`第 ${previewPage + 1} 帧`}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            ) : previewKind === 'html' && previewHtml ? (
              <iframe
                title={previewName}
                sandbox="allow-scripts allow-forms allow-modals"
                srcDoc={previewHtml}
                className="h-full w-full min-h-0 bg-white"
              />
            ) : previewKind === 'pdf' && previewUrl ? (
              <iframe
                src={previewUrl}
                title={previewName}
                className="h-full w-full min-h-0"
              />
            ) : previewKind === 'img' && previewUrl ? (
              <div className="flex h-full w-full min-h-0 items-center justify-center overflow-hidden bg-muted/20">
                <img src={previewUrl} alt={previewName} className="max-h-full max-w-full object-contain" />
              </div>
            ) : previewKind === 'ppt' && previewUrl ? (
              <div className="flex flex-col items-center gap-3">
                <FileText className="h-16 w-16 text-primary" />
                <p className="font-medium">{previewName}</p>
                <p className="max-w-[420px] text-center text-sm text-muted-foreground">
                  PPT 课件不支持浏览器内预览，可下载后用 PowerPoint / WPS 打开播放
                </p>
                <Button size="sm" variant="outline" asChild>
                  <a href={previewUrl} download={previewName}>
                    <Download className="mr-1 h-4 w-4" />
                    下载课件
                  </a>
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <FolderOpen className="h-16 w-16 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  {tiffProgress
                    ? `课件加载中… ${tiffProgress.done}/${tiffProgress.total} 帧`
                    : previewNodeObj
                      ? '课件加载中…'
                      : '从左侧选择课件，课件将在此处预览'}
                </p>
              </div>
            )}
          </CardContent>
          {/* 底栏：左侧课件名称，右侧页数翻页 */}
          <div className="flex min-h-0 items-center justify-between gap-2 border-t px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <FileText className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate text-sm font-medium">{previewName}</span>
              {previewNodeObj && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {previewNodeObj.name.split('.').pop()?.toUpperCase() ?? ''}
                </span>
              )}
            </div>
            {previewKind === 'tiff' && previewFrames ? (
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={previewPage <= 0}
                  onClick={() => setPreviewPage((p) => Math.max(0, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground">
                  页数：{previewFrames.length} 当前：{previewPage + 1}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={previewPage >= previewFrames.length - 1}
                  onClick={() => setPreviewPage((p) => Math.min(previewFrames.length - 1, p + 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <span className="shrink-0 text-sm text-muted-foreground">1/1</span>
            )}
          </div>
        </Card>
      </div>

      {/* 删除课件目录确认弹框 */}
      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除课件目录</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除课件目录「{curRoot}」吗？删除后需重新添加才能使用。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => removeRoot()}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
