import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { emit, listen } from '@tauri-apps/api/event';
import type { WebviewWindow as WebviewWindowType } from '@tauri-apps/api/webviewWindow';
import {
  CalendarDays,
  ChevronRight,
  Download,
  FileText,
  Folder,
  Loader2,
  MonitorPlay,
  Plus,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAppData } from '@/data/app-store';
import type { ICourseNode, ISettings } from '@/data/types';
import {
  deleteCoursewareFile,
  getCoursewareFile,
  isAudio,
  isHtml,
  isImage,
  isPdf,
  isPpt,
  isTiff,
  isVideo,
  loadCoursewareBlob,
  mimeForFile,
  saveCoursewareFile,
} from '@/lib/courseware-files';
import { pdfToImages } from '@/lib/pdf-to-images';
import { decodeTiffDeferred, type TiffDeferred } from '@/lib/tiff-frames';
import { pad2 } from '@/lib/dates';
import { cn } from '@/lib/utils';
import BoardCanvas, { type BoardCanvasHandle } from './BoardCanvas';
import MediaPlayer, { type MediaInfo, type MediaPlayerHandle } from '@/components/MediaPlayer';
import HtmlOverlay, { type HtmlInfo, type HtmlOverlayHandle } from '@/components/HtmlOverlay';
import { COLORS, LINE_STYLES, PEN_SIZES, TOOLS, type LineStyle, type ToolId } from './tools';

const DEFAULT_BRANCH = '1通用版|1高一|1暑期';
const PAGE_COUNT = 10;
// 桌面端「导入 PPT」转换结果的虚拟课件 ID
const PPT_IMPORT_ID = '__ppt_import__';
// 桌面端「本机图集课件（TIFF）」的虚拟课件 ID
const TIFF_IMPORT_ID = '__tiff_import__';

/** 黑板画面比例：按设置返回宽高比（16:9 / 9:16=竖板资料 878×494 / 自由比例跟随占位区 / 自定义宽高） */
function boardAspectFromSettings(s: ISettings, zoneAspect?: number): number {
  switch (s.boardAspectMode) {
    case '16:9':
      return 878 / 494; // 16:9 = 878:494（当前写死的黑板比例）
    case '9:16':
      return 210 / 297; // A4 纸尺寸（竖版资料）：真实比例 210:297
    case '4:3':
      return 4 / 3;
    case 'free':
      // 动态比例（跟随窗口）：跟随课件占位区当前宽高比动态设置（宽=占位区宽-20、高=占位区高-20 由调用处计算）
      return zoneAspect && zoneAspect > 0 ? zoneAspect : 878 / 494;
    case 'followCw':
      // 动态比例（跟随课件）：无课件时按自由比例满铺（boardAspectFree=true）；加载课件时由课件图片比例驱动（见 bcStateRef/推送动态计算）
      return zoneAspect && zoneAspect > 0 ? zoneAspect : 878 / 494;
    case 'custom': {
      const w = s.freeBoardAspectW ?? 878;
      const h = s.freeBoardAspectH ?? 494;
      return h > 0 ? w / h : 878 / 494;
    }
    default:
      return 878 / 494;
  }
}

/** 本机课件目录树节点（Tauri scan_courseware_tree 返回） */
interface LocalCwNode {
  name: string;
  path: string;
  kind: string;
  children?: LocalCwNode[];
}

/** 课件根目录（与课件管理页共享 localStorage） */
interface RootEntry {
  path: string;
  name: string;
}
const ROOTS_KEY = 'shangkeya:coursewareRoots';

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

export default function ClassroomPage() {
  const { data, setData } = useAppData();
  const [searchParams] = useSearchParams();
  // 课程维度持久化 key：加入本课/本机目录课件按课程隔离，新课程不会带入旧课程的课件
  const cwCourseId = searchParams.get('courseId') ?? '';
  const cwPersistKey = cwCourseId || 'none';

  const [tool, setTool] = useState<ToolId>('pencil');
  const [color, setColor] = useState(COLORS[1]);
  const [penSize, setPenSize] = useState(2);
  const [lineStyle, setLineStyle] = useState<LineStyle>('solid');
  // 文字工具：字体与字号（字号下拉显示 px，内部存相对画布高比例，基准 500）
  const FONT_OPTIONS = ['微软雅黑', '宋体', '黑体', '楷体', '仿宋', 'Arial', 'Georgia', 'Courier New'];
  const SIZE_OPTIONS = [16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72];
  const [fontFamily, setFontFamily] = useState('微软雅黑');
  const [textSizePx, setTextSizePx] = useState(24);
  const textSize = textSizePx / 500;
  const [page, setPage] = useState(0);
  const [seconds, setSeconds] = useState(0);
  // 视频/音频课件播放信息（黑板窗口播放；浏览器模式课堂占位区播放）
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  // HTML 网页课件显示信息（黑板窗口播放；浏览器模式课堂占位区显示）
  const [htmlInfo, setHtmlInfo] = useState<HtmlInfo | null>(null);

  const closeMedia = () => {
    setMediaInfo((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    void emit('bc:media', null);
  };

  const closeHtml = () => {
    setHtmlInfo(null);
    void emit('bc:html', null);
  };

  const [cwSelId, setCwSelId] = useState<string | null>(null);
  // 前节内容选中（只选中不打开，不影响黑板当前内容）
  const [prevSelId, setPrevSelId] = useState<string | null>(null);
  // 前节内容 → 加入本课的课件 id 集合（持久化，重启/刷新后恢复；按课程隔离）
  const [lessonExtraIds, setLessonExtraIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(`skey_lesson_extra_${cwPersistKey}`) ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  // 「加入本课」的本地课件（本机目录 tab 选中 → 加入本课课件列表；不打开到黑板；按课程隔离）
  const [localLessonIds, setLocalLessonIds] = useState<string[]>(() => {
    try {
      const nodes = JSON.parse(localStorage.getItem(`skey_local_lesson_nodes_${cwPersistKey}`) ?? '[]') as ICourseNode[];
      return nodes.map((n) => n.id);
    } catch {
      return [];
    }
  });
  // 本地课件节点缓存：从持久化数据恢复（重启后仍可显示/打开；按课程隔离）
  const localNodeCacheRef = useRef<Map<string, ICourseNode>>(
    (() => {
      try {
        const nodes = JSON.parse(localStorage.getItem(`skey_local_lesson_nodes_${cwPersistKey}`) ?? '[]') as ICourseNode[];
        const m = new Map<string, ICourseNode>();
        for (const n of nodes) if (n.id && n.file?.path) m.set(n.id, n);
        return m;
      } catch {
        return new Map();
      }
    })(),
  );
  const [addCwOpen, setAddCwOpen] = useState(false);
  // 本次课堂新添加的课件 id（属于本课内容，不进入「前节内容」）
  const [addedCwIds, setAddedCwIds] = useState<string[]>([]);
  // 黑板比例：按 tiff 课件首页尺寸固定（无课件时黑板也保持该比例）
  const [tiffAspect, setTiffAspect] = useState<number | undefined>(undefined);
  const [newName, setNewName] = useState('');
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const cwFileInputRef = useRef<HTMLInputElement>(null);
  const boardRef = useRef<BoardCanvasHandle>(null);
  // 课件书写层操作句柄（HTML/视频书写中，工具栏撤销/清空路由到书写画布）
  const htmlOverlayRef = useRef<HtmlOverlayHandle>(null);
  const mediaOverlayRef = useRef<MediaPlayerHandle>(null);
  // 课件预览：PDF/图片 → 转图片组作为黑板背景（可书写）；PPT → 提示导出 PDF
  const [pdfForId, setPdfForId] = useState<string | null>(null);
  const [pdfImages, setPdfImages] = useState<string[] | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  // 后台预解析缓存：添加 PDF/TIFF 时后台解析并缓存，之后点开直接显示（不重新解析、不打断黑板）
  const pdfParseCacheRef = useRef<Map<string, string[]>>(new Map());
  const tiffParseCacheRef = useRef<Map<string, TiffDeferred>>(new Map());
  // 后台解析中的课件 id 集合：课件目录中对应条目灰度显示、不可选择
  const [parsingIds, setParsingIds] = useState<Set<string>>(new Set());
  const [previewForId, setPreviewForId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  // 桌面端（Tauri）：可直接把 PPT 转成 PDF 再渲染进黑板
  const [tauriMode] = useState<boolean>(
    () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window,
  );
  const [pptConverting, setPptConverting] = useState(false);
  // TIFF 图集课件：本机目录扫描 + 帧加载 + 问题帧答案独立窗口
  const [localTree, setLocalTree] = useState<LocalCwNode[] | null>(null);
  // 「本机目录」tab：课件目录下拉 + 版本/年级/学期下拉（与课件管理页同一逻辑）
  const [roots, setRoots] = useState<RootEntry[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(ROOTS_KEY) ?? '[]') as RootEntry[];
    } catch {
      return [];
    }
  });
  const [curRoot, setCurRoot] = useState('');
  const [impTree, setImpTree] = useState<ImportedVersion[] | null>(null);
  const [verList, setVerList] = useState<string[]>([]);
  const [selVer, setSelVer] = useState<string | null>(null);
  const [gradeList, setGradeList] = useState<string[]>([]);
  const [selGrade, setSelGrade] = useState<string | null>(null);
  const [semList, setSemList] = useState<string[]>([]);
  const [selSem, setSelSem] = useState<string | null>(null);
  const [impLoading, setImpLoading] = useState(false);
  const [impExpanded, setImpExpanded] = useState<Set<string>>(new Set());
  // 本机目录树中当前选中的课件文件（点「加入课堂」才打开到黑板）
  const [selImpNode, setSelImpNode] = useState<ImportedNode | null>(null);
  // 历史课程记录：展开状态（key = course.id）
  const [histOpen, setHistOpen] = useState<Set<string>>(new Set());
  const toggleHist = (id: string) =>
    setHistOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [currentOpenPath, setCurrentOpenPath] = useState<string | null>(null);
  const [tiffMeta, setTiffMeta] = useState<TiffDeferred | null>(null);
  const [tiffLoading, setTiffLoading] = useState(false);
  // 逐帧解码：当前帧图片（按需加载）
  const [tiffPageUrl, setTiffPageUrl] = useState<string | null>(null);
  // 渗透显示：下一页课件帧图片（书写工具渗透框内容；多页 TIFF 才有）
  const [penetrateNextUrl, setPenetrateNextUrl] = useState<string | null>(null);
  // 首页「掌门」封面页检测：命中则跳过首页（不占页数、不参与翻页）
  const [tiffSkipFirst, setTiffSkipFirst] = useState(false);
  // 答案独立窗口：全局只开一个（label 固定 answer-<课堂label>），连续问题刷新显示
  const answerWinRef = useRef<WebviewWindowType | null>(null);
  // 页面备注窗口：黑板子窗口，翻页时当下页为 211×489 竖版备注帧则打开/刷新，否则关闭
  const remarkWinRef = useRef<WebviewWindowType | null>(null);

  const timerText = `${pad2(Math.floor(seconds / 60))}:${pad2(seconds % 60)}`;

  // 独立窗口（win=1）识别：课程信息移动到窗口标题处
  const inSeparateWin = searchParams.get('win') === '1';

  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // 时间标签显示当前页停留时间：翻页或切换课件后重置为 00:00
  // （依赖只用 state 变量，避免引用未初始化的派生值）
  useEffect(() => {
    setSeconds(0);
  }, [page, pdfForId, cwSelId]);

  // 课堂信息：优先取课程记录，其次取学员+时间
  const courseId = cwCourseId || null;
  const studentId = searchParams.get('studentId') ?? '';
  const timeLabel = searchParams.get('time') ?? '';

  const course = useMemo(
    () => (courseId ? data.courses.find((c) => c.id === courseId) ?? null : null),
    [courseId, data.courses],
  );
  const student = course
    ? data.students.find((s) => s.id === course.studentId)
    : data.students.find((s) => s.id === studentId) ?? null;

  const title = course
    ? `${student?.name ?? '学员'} ${course.date} ${course.start}（${course.durationMin}分钟）`
    : student
      ? `${student.name}${timeLabel ? ' ' + timeLabel : ''}`
      : '今日课程';

  // 课程信息（学员 + 时间）移动到窗口标题处
  useEffect(() => {
    if (!title || title === '今日课程') return;
    if (tauriMode) {
      void import('@tauri-apps/api/window')
        .then((m) => m.getCurrentWindow().setTitle(`上课鸭-课堂 · ${title}`))
        .catch(() => {});
    } else {
      document.title = `上课鸭-课堂 · ${title}`;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  const removeNode = (ns: ICourseNode[], id: string): ICourseNode[] => {
    const out: ICourseNode[] = [];
    for (const n of ns) {
      if (n.id === id) continue;
      if (n.children) out.push({ ...n, children: removeNode(n.children, id) });
      else out.push(n);
    }
    return out;
  };

  const allFiles = (ns: ICourseNode[]): ICourseNode[] =>
    ns.flatMap((n) => (n.type === 'file' ? [n] : n.children ? allFiles(n.children) : []));

  // 全部课件：按 版本|年级|学期 分支分组显示（目录导入可产生多分支）
  const cwBranches = Object.entries(data.courseware)
    .filter(([, ns]) => ns.length > 0)
    .map(([key, nodes]) => ({ key, label: key.replace(/\|/g, ' / '), nodes }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const cwFiles = allFiles(cwBranches.flatMap((b) => b.nodes));
  // 该学生的全部课程（按日期倒序，供上节课定位 / 历史课程记录）
  const sameStudentCourses = useMemo(
    () =>
      student
        ? data.courses
            .filter((c) => c.studentId === student.id)
            .sort((a, b) => b.date.localeCompare(a.date) || b.start.localeCompare(a.start))
        : [],
    [student, data.courses],
  );
  // 前节内容：该学生本节课之前时间最近的一节课（上节课）的课件目录（云端保存的 course.files）；
  // 无本节课时取该学生最近一节历史课的课件。本课内容：其余课件 + 已「加入本课」的前节文件 + 已「加入课堂」的本地课件
  const curKey = course ? `${course.date} ${course.start}` : null;
  const prevCourse = curKey
    ? sameStudentCourses.find((c) => `${c.date} ${c.start}` < curKey)
    : sameStudentCourses[0] ?? null;
  const prevFiles = prevCourse?.files ?? [];
  const prevIds = new Set(prevFiles.map((f) => f.id));
  const localLessonNodes = localLessonIds
    .map((id) => localNodeCacheRef.current.get(id))
    .filter((n): n is ICourseNode => !!n);
  // 本课内容：优先使用云端保存的本节课文件目录（course.files）；
  // 无云端目录（新课程/尚未绑定）时不自动带入全局课件库，只显示主动加入本课的文件：
  //   前节内容「加入本课」 + 本次课堂「添加课件」 + 本机目录「加入课堂」
  const courseFiles = course?.files && course.files.length > 0 ? course.files : null;
  const derivedLesson = [
    ...prevFiles.filter((f) => lessonExtraIds.includes(f.id)),
    ...cwFiles.filter((f) => addedCwIds.includes(f.id)),
    ...localLessonNodes,
  ];
  const lessonFiles = courseFiles
    ? [...courseFiles, ...derivedLesson.filter((f) => !courseFiles.some((cf) => cf.id === f.id))]
    : derivedLesson;
  // 当前选中课件：本课内容优先，其次历史课程（该同学已上过课程）的课件
  const histAllFiles = sameStudentCourses.flatMap((c) => c.files ?? []);
  const selectedCw =
    lessonFiles.find((f) => f.id === cwSelId) ??
    histAllFiles.find((f) => f.id === cwSelId) ??
    null;

  // 本节课使用的课件目录 → 写入 course.files（随 courses 同步到云端，保存文件路径）
  useEffect(() => {
    if (!course) return;
    const files = lessonFiles.map((f) => ({ ...f, children: f.children ? [...f.children] : undefined }));
    if (JSON.stringify(course.files ?? null) !== JSON.stringify(files)) {
      setData((prev) => ({
        ...prev,
        courses: prev.courses.map((c) => (c.id === course.id ? { ...c, files } : c)),
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course, lessonFiles]);

  // 历史课程记录：当前学员的全部课程（按日期倒序）
  const histCourses = sameStudentCourses;

  // 进入课堂默认显示黑板空白页：不自动恢复上次打开的课件（保留写入，供手动恢复场景使用）
  useEffect(() => {
    if (cwSelId) localStorage.setItem('skey_last_open_cw', cwSelId);
  }, [cwSelId]);

  // 持久化：前节内容加入本课的课件 id（按课程隔离）
  useEffect(() => {
    try {
      localStorage.setItem(`skey_lesson_extra_${cwPersistKey}`, JSON.stringify(lessonExtraIds));
    } catch {
      /* 忽略存储异常 */
    }
  }, [lessonExtraIds, cwPersistKey]);
  // 持久化：本机目录加入本课的课件节点（含本机路径，重启后可恢复显示与打开；按课程隔离）
  useEffect(() => {
    try {
      const nodes = [...localNodeCacheRef.current.values()].filter((n) =>
        localLessonIds.includes(n.id),
      );
      localStorage.setItem(`skey_local_lesson_nodes_${cwPersistKey}`, JSON.stringify(nodes));
    } catch {
      /* 忽略存储异常 */
    }
  }, [localLessonIds, cwPersistKey]);

  // 加入本课：前节内容选中的文件加入本课课件列表（不影响黑板内容）
  const addToLesson = () => {
    if (!prevSelId) return;
    setLessonExtraIds((prev) => (prev.includes(prevSelId) ? prev : [...prev, prevSelId]));
    toast.success('已加入本课');
    // 与添加课件一致：PDF/TIFF 后台预解析并缓存（解析期间灰度显示，方便快速点击打开）
    const f = cwFiles.find((x) => x.id === prevSelId);
    if (f?.file && /\.(pdf|tiff?)$/i.test(f.file.name)) {
      void preparseCourseware(f);
    }
  };

  // 桌面端：加载本机目录里的课件文件（tiff 图集 → 逐帧；pdf → 图片组；图片 → 单张）
  const loadLocalFile = async (node: LocalCwNode) => {
    if (node.children) return;
    if (!tauriMode) {
      toast.error('本机课件目录仅桌面版（EXE）可用');
      return;
    }
    const ext = node.kind.toLowerCase();
    if (!['tiff', 'tif', 'pdf', 'png', 'jpg', 'jpeg'].includes(ext)) return;
    setTiffLoading(true);
    setCurrentOpenPath(node.path);
    try {
      // 大文件用 fs 插件二进制读取（invoke 的 JSON 数组传输 9MB 会卡死）
      const { readFile } = await import('@tauri-apps/plugin-fs');
      const bytes = await readFile(node.path);
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      if (ext === 'tiff' || ext === 'tif') {
        setTiffSkipFirst(false);
        const deferred = await decodeTiffDeferred(buf);
        setTiffMeta(deferred);
        if (deferred.frames[0]) setTiffAspect(deferred.frames[0].width / deferred.frames[0].height);
        setTiffPageUrl(null);
        setPdfForId(TIFF_IMPORT_ID);
        setPage(0);
        // 跳过课件首页（设置项开启）：首页不是问题页 → 直接跳过，不做文字识别
        if (
          data.settings.skipCoursewareHome &&
          deferred.frames[0] &&
          deferred.frames[0].kind !== '问题'
        ) {
          setTiffSkipFirst(true);
          toast.success('已跳过课件首页');
        }
        toast.success(
          `已加载「${node.name}」共 ${deferred.total} 帧（${deferred.total - deferred.frames.filter((f) => f.kind === '答案').length} 页课件）`,
        );
      } else if (ext === 'pdf') {
        const imgs = await pdfToImages(new Blob([buf], { type: 'application/pdf' }));
        setPdfImages(imgs);
        setPdfForId(TIFF_IMPORT_ID);
        setPage(0);
        toast.success(`已加载 PDF 共 ${imgs.length} 页`);
      } else {
        const blob = new Blob([buf]);
        const url = URL.createObjectURL(blob);
        setPdfImages([url]);
        setPdfForId(TIFF_IMPORT_ID);
        setPage(0);
        toast.success('已加载图片课件');
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setTiffLoading(false);
    }
  };

  // ── 「本机目录」tab：课件管理页同一套加载逻辑 ──────────────────────────
  const toggleImp = (k: string) =>
    setImpExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const loadImpRoot = async (path: string) => {
    setCurRoot(path);
    if (!tauriMode) {
      toast.error('本机课件目录仅桌面版（EXE）可用');
      return;
    }
    setImpLoading(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const res = await invoke<ImportResult>('import_courseware_dir', { dir: path });
      setImpTree(res.versions);
      const vers = res.versions.map((v) => v.version);
      setVerList(vers);
      setSelVer(vers[0] ?? null);
      const v0 = res.versions[0];
      setGradeList(v0?.grades.map((g) => g.grade) ?? []);
      setSelGrade(v0?.grades[0]?.grade ?? null);
      const g0 = v0?.grades[0];
      setSemList(g0?.semesters.map((s) => s.semester) ?? []);
      setSelSem(g0?.semesters[0]?.semester ?? null);
      setImpExpanded(new Set());
      if (res.versions.length === 0) toast.info('该目录下未发现课件文件');
    } catch (e) {
      toast.error(String(e));
      setImpTree([]);
      setVerList([]);
      setSelVer(null);
      setGradeList([]);
      setSelGrade(null);
      setSemList([]);
      setSelSem(null);
    } finally {
      setImpLoading(false);
    }
  };

  // 本机目录：默认选择第一个课件目录；若该学员上次打开过则恢复上次的目录
  useEffect(() => {
    if (!tauriMode || roots.length === 0) return;
    const saved = localStorage.getItem(`skey_imp_root_${studentId}`);
    const target =
      saved && roots.some((r) => r.path === saved) ? saved : roots[0].path;
    void loadImpRoot(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots]);

  const pickVer = (v: string) => {
    setSelVer(v);
    const ver = impTree?.find((x) => x.version === v) ?? null;
    setGradeList(ver?.grades.map((g) => g.grade) ?? []);
    setSelGrade(ver?.grades[0]?.grade ?? null);
    const g0 = ver?.grades[0];
    setSemList(g0?.semesters.map((s) => s.semester) ?? []);
    setSelSem(g0?.semesters[0]?.semester ?? null);
  };

  const pickGrade = (g: string) => {
    setSelGrade(g);
    const ver = impTree?.find((x) => x.version === selVer) ?? null;
    const grd = ver?.grades.find((x) => x.grade === g) ?? null;
    setSemList(grd?.semesters.map((s) => s.semester) ?? []);
    setSelSem(grd?.semesters[0]?.semester ?? null);
  };

  const curSem =
    impTree
      ?.find((v) => v.version === selVer)
      ?.grades.find((g) => g.grade === selGrade)
      ?.semesters.find((s) => s.semester === selSem) ?? null;

  /** 渲染导入的 章节/文件 层（可展开折叠；根目录(第一层)默认展开；点文件 → 仅选中，点「加入课堂」才打开） */
  const renderImpTree = (ns: ImportedNode[], depth: number, prefix: string) =>
    ns.map((n, i) => {
      const key = `${prefix}/n:${i}-${n.name}`;
      const isFolder = !!n.children;
      const open = impExpanded.has(key) || depth === 0;
      return (
        <div key={key}>
          <button
            type="button"
            className={cn(
              'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors',
              isFolder
                ? 'text-foreground hover:bg-muted'
                : selImpNode === n
                  ? 'bg-accent font-medium text-primary'
                  : 'text-foreground hover:bg-muted',
            )}
            style={{ paddingLeft: 8 + depth * 12 }}
            onClick={() => {
              if (isFolder) toggleImp(key);
              else {
                setSelImpNode((prev) => (prev === n ? null : n));
              }
            }}
          >
            {isFolder ? (
              <>
                <ChevronRight
                  className={cn(
                    'h-3 w-3 shrink-0 text-muted-foreground transition-transform',
                    open && 'rotate-90',
                  )}
                />
                <Folder className="h-3.5 w-3.5 shrink-0 text-warning" />
              </>
            ) : (
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{n.name}</span>
            {isFolder && (
              <span className="ml-auto text-[10px] text-muted-foreground">{n.children?.length}</span>
            )}
          </button>
          {isFolder && open && n.children ? renderImpTree(n.children, depth + 1, key) : null}
        </div>
      );
    });

  /** 加入课堂：把选中的本机课件加入本课课件列表（不打开到黑板；未选中时按钮置灰） */
  const addToClassroom = () => {
    if (!selImpNode) {
      toast.error('请先在目录树中选择课件');
      return;
    }
    const node = selImpNode;
    const mime = mimeForFile(node.name);
    const id = `local-${node.path}`;
    localNodeCacheRef.current.set(id, {
      id,
      name: node.name,
      type: 'file',
      file: { name: node.name, size: 0, mime, path: node.path },
    });
    setLocalLessonIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    toast.success(`已加入本课课件列表：${node.name}`);
    // 与添加课件一致：PDF/TIFF 后台预解析并缓存（解析期间灰度显示，方便快速点击打开）
    if (/\.(pdf|tiff?)$/i.test(node.name)) {
      const cached = localNodeCacheRef.current.get(id);
      if (cached) void preparseCourseware(cached);
    }
  };

  // 选中文件课件 → 加载：PDF/图片转图片组作为画布背景（可书写）；PPT 显示导出提示
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    const sel = selectedCw;
    if (sel?.file) {
      setCurrentOpenPath(null);
      const kind = isTiff(sel.file.mime, sel.file.name)
        ? 'tiff'
        : isPdf(sel.file.mime, sel.file.name)
          ? 'pdf'
          : isImage(sel.file.mime, sel.file.name)
            ? 'img'
            : isPpt(sel.file.mime, sel.file.name)
              ? 'ppt'
              : isVideo(sel.file.mime, sel.file.name)
                ? 'video'
                : isAudio(sel.file.mime, sel.file.name)
                  ? 'audio'
                  : isHtml(sel.file.mime, sel.file.name)
                    ? 'html'
                    : null;
      if (kind !== 'video' && kind !== 'audio') {
        // 切到非媒体课件：关闭播放器（黑板窗口同步）
        setMediaInfo((prev) => {
          if (prev) URL.revokeObjectURL(prev.url);
          return null;
        });
        void emit('bc:media', null);
      }
      if (kind !== 'html') {
        // 切到非 HTML 课件：关闭网页课件 overlay（黑板窗口同步）
        setHtmlInfo(null);
        void emit('bc:html', null);
      }
      if (kind === 'pdf') {
        const cached = pdfParseCacheRef.current.get(sel.id);
        if (cached) {
          // 后台预解析缓存命中：直接显示，不重新解析
          setPdfImages(cached);
          setPdfForId(sel.id);
          setPage(0);
        } else {
          loadCoursewareBlob(sel)
            .then(async (blob) => {
              if (cancelled || !blob) return;
              setPdfLoading(true);
              const imgs = await pdfToImages(blob);
              if (cancelled) return;
              setPdfImages(imgs);
              setPdfForId(sel.id);
              setPage(0);
            })
            .catch(() => toast.error('PDF 解析失败，请确认文件有效'))
            .finally(() => {
              if (!cancelled) setPdfLoading(false);
            });
        }
      } else if (kind === 'tiff') {
        const cached = tiffParseCacheRef.current.get(sel.id);
        const useCached = async (deferred: TiffDeferred) => {
          if (cancelled) return;
          // 「跳过课件首页」开启且首页非问题页 → 跳过首页（不做文字识别）
          setTiffSkipFirst(
            data.settings.skipCoursewareHome &&
              !!deferred.frames[0] &&
              deferred.frames[0].kind !== '问题',
          );
          setTiffMeta(deferred);
          if (deferred.frames[0]) setTiffAspect(deferred.frames[0].width / deferred.frames[0].height);
          setTiffPageUrl(null);
          setPdfForId(sel.id);
          setPage(0);
        };
        if (cached) {
          void useCached(cached);
        } else {
          loadCoursewareBlob(sel)
            .then(async (blob) => {
              if (cancelled || !blob) return;
              setTiffLoading(true);
              const deferred = await decodeTiffDeferred(await blob.arrayBuffer());
              if (cancelled) return;
              await useCached(deferred);
            })
            .catch(() => toast.error('TIFF 图集解析失败，请确认文件有效'))
            .finally(() => {
              if (!cancelled) setTiffLoading(false);
            });
        }
      } else if (kind === 'img') {
        loadCoursewareBlob(sel)
          .then((blob) => {
            if (cancelled || !blob) return;
            url = URL.createObjectURL(blob);
            setPdfImages([url]);
            setPdfForId(sel.id);
            setPage(0);
          })
          .catch(() => toast.error('课件文件读取失败'));
      } else if (kind === 'ppt') {
        loadCoursewareBlob(sel)
          .then((blob) => {
            if (cancelled || !blob) return;
            url = URL.createObjectURL(blob);
            setPreviewForId(sel.id);
            setPreviewUrl(url);
            setShowPreview(true);
          })
          .catch(() => toast.error('课件文件读取失败'));
      } else if (kind === 'video' || kind === 'audio') {
        // 视频/音频课件：读取文件 → 播放器（黑板窗口 overlay，浏览器模式课堂占位区显示）
        setPdfImages(null);
        setPdfForId(sel.id);
        setPage(0);
        loadCoursewareBlob(sel)
          .then((blob) => {
            if (cancelled || !blob) return;
            url = URL.createObjectURL(blob);
            const info: MediaInfo = {
              url,
              kind,
              name: sel.file?.name || sel.name,
            };
            setMediaInfo(info);
            // 仅「独立黑板窗口」模式需要把媒体同步到黑板窗口 overlay；浏览器模式 / 课堂黑板一体模式直接在课堂占位区播放
            if (tauriMode && data.settings.boardWindowMode === 'separate') {
              void emit('bc:media', info);
            }
          })
          .catch(() => toast.error('课件文件读取失败'));
      } else if (kind === 'html') {
        // HTML 网页课件：读取内容 → iframe overlay 全幅显示（黑板窗口 overlay，浏览器模式课堂占位区显示）
        setPdfImages(null);
        setPdfForId(sel.id);
        setPage(0);
        loadCoursewareBlob(sel)
          .then(async (blob) => {
            if (cancelled || !blob) return;
            const srcDoc = await blob.text();
            const info: HtmlInfo = { srcDoc, name: sel.file?.name || sel.name };
            setHtmlInfo(info);
            if (tauriMode && data.settings.boardWindowMode === 'separate') {
              void emit('bc:html', info);
            }
          })
          .catch(() => toast.error('HTML 课件读取失败'));
      }
    }
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [selectedCw]);

  // 当前生效的图片组（仅当与当前选中课件匹配时使用，避免切换残留）
  const selectedIsTiff = selectedCw?.file
    ? isTiff(selectedCw.file.mime, selectedCw.file.name)
    : false;
  const isTiffMode =
    pdfForId === TIFF_IMPORT_ID || (pdfForId === cwSelId && selectedIsTiff);
  // TIFF 课件页 = 过滤掉答案帧（答案帧不占页数、不参与翻页，单独开窗口显示）
  // 「跳过课件首页」开启且首页非问题页时，首页一并跳过（tiffSkipFirst，按原始帧下标 0 精确过滤）
  const tiffPages = useMemo(
    () =>
      tiffMeta
        ? tiffMeta.frames
            .filter((f) => f.kind !== '答案')
            .filter((f) => !(tiffSkipFirst && f.index === 0))
        : null,
    [tiffMeta, tiffSkipFirst],
  );
  // TIFF 逐帧：当前帧已解码 url 作为黑板背景
  const activeImages = isTiffMode
    ? tiffPageUrl
      ? [tiffPageUrl]
      : null
    : pdfForId === cwSelId || pdfForId === PPT_IMPORT_ID
      ? pdfImages
      : null;
  const bgImage = isTiffMode
    ? tiffPageUrl
    : activeImages
      ? (activeImages[page] ?? null)
      : null;

  // 答案独立窗口：全局只开一个（label 固定 answer-<课堂label>），连续问题刷新内容显示；
  // 分组页「答案 / 下页预览」：问题页优先显示答案；非问题页（开启下页预览时）显示下页预览；
  // 不可最大化 / 不可最小化
  const openAnswerWindow = useCallback(
    async (
      imgUrl: string,
      ownerKey: string,
      frameIndex: number,
      opts?: { nextUrl?: string | null; enableNext?: boolean; hasAnswer?: boolean },
    ) => {
      const hasAnswer = !!opts?.hasAnswer;
      const enableNext = !!opts?.enableNext;
      const nextUrl = opts?.nextUrl || '';
      if (!tauriMode) {
        const label = `answer-${ownerKey}-${frameIndex}`;
        const w = window.open('', label, 'width=520,height=320,resizable=yes,scrollbars=yes');
        if (w) {
          const src = hasAnswer && imgUrl ? imgUrl : nextUrl;
          w.document.open();
          w.document.write(
            `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#f5f5f5}img{display:block;max-width:100%;margin:0 auto;background:#fff}</style></head><body>${src ? `<img src="${src}" alt="答案"/>` : ''}</body></html>`,
          );
          w.document.close();
        }
        return;
      }
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const mw = getCurrentWindow();
        const label = `answer-${mw.label}`;
        // 写答案窗口数据 JSON（应用路由页 AnswerWindowPage 读取）
        const { tempDir, join } = await import('@tauri-apps/api/path');
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');
        const dir = await tempDir();
        const p = await join(dir, `shangkeya-answer-${label}.json`);
        await writeTextFile(
          p,
          JSON.stringify({
            answerUrl: hasAnswer ? imgUrl : '',
            nextUrl: enableNext ? nextUrl : '',
            hasAnswer,
            enableNext,
            frameIndex,
          }),
        );
        const existing = answerWinRef.current;
        if (existing) {
          // 已有窗口：恢复黑板（若被系统收起）→ 显示 → 刷新内容（连续问题刷新显示）
          const bw = boardWinRef.current;
          if (bw) {
            try {
              if (await bw.isMinimized()) await bw.unminimize();
              if (!(await bw.isVisible())) await bw.show();
            } catch {
              /* 黑板窗口可能已关闭 */
            }
          }
          await existing.show();
          await existing.setTitle(`答案 · 第 ${frameIndex + 1} 帧`);
          // 用 Rust 端 eval 刷新（窗口不重建、不闪烁）
          await import('@tauri-apps/api/core').then(({ invoke }) =>
            invoke('reload_webview', { label }).catch(() => undefined),
          );
          return;
        }
        // 初始位置：优先上次保存（win:answer:rect，物理坐标）；否则课堂窗口内右下角
        let position: { x: number; y: number } | undefined;
        let winW = 520;
        let winH = 320;
        try {
          const saved = localStorage.getItem('win:answer:rect');
          if (saved) {
            const r = JSON.parse(saved) as { x?: number; y?: number; w?: number; h?: number };
            if (typeof r.x === 'number' && typeof r.y === 'number') position = { x: r.x, y: r.y };
            if (typeof r.w === 'number' && r.w >= 200) winW = r.w;
            if (typeof r.h === 'number' && r.h >= 120) winH = r.h;
          }
          if (!position) {
            const [pos, size, scale] = await Promise.all([
              mw.innerPosition(),
              mw.innerSize(),
              mw.scaleFactor(),
            ]);
            position = {
              x: Math.round(pos.x + (size.width - 560) * scale),
              y: Math.round(pos.y + (size.height - 360) * scale),
            };
          }
        } catch {
          /* 位置计算失败则使用默认 */
        }
        // 打开答案窗口前记录黑板窗口状态：创建答案窗口会让系统连带收起黑板，
        // 创建完成后按原状态恢复——黑板原本可见则保持可见；原本被收起则保持收起（不弹回）
        let bwWasVisible = true;
        let bwWasMinimized = false;
        const bwBefore = boardWinRef.current;
        if (bwBefore) {
          try {
            bwWasVisible = await bwBefore.isVisible();
            bwWasMinimized = await bwBefore.isMinimized();
          } catch {
            /* 状态读取失败则按默认处理 */
          }
        }
        const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        // 加载应用内路由页（完整 Tauri API：关闭/拖动直接可用）
        const winUrl = window.location.origin + '/#/answer-window';
        const win = new WebviewWindow(label, {
          title: `答案 · 第 ${frameIndex + 1} 帧`,
          width: winW,
          height: winH,
          minWidth: 200,
          minHeight: 120,
          // 无标题栏（decorations: false），右上角自定义关闭按钮；tab 条为拖拽区域
          decorations: false,
          url: winUrl,
          ...(position ? { x: position.x, y: position.y } : {}),
          focus: false,
          // 答案窗口作为黑板窗口的子窗口（owned）：永远显示在黑板窗口上方，不被黑板遮挡
          parent: boardWinRef.current ? 'blackboard-canvas' : mw.label,
        });
        answerWinRef.current = win;
        win.once('tauri://error', () => {
          if (answerWinRef.current === win) answerWinRef.current = null;
        });
        win.once('tauri://destroyed', () => {
          if (answerWinRef.current === win) answerWinRef.current = null;
        });
        win.once('tauri://created', () => {
          // 按打开答案窗口前的黑板状态恢复（仅此一次，不做持续监控）
          window.setTimeout(async () => {
            const cur = boardWinRef.current;
            if (!cur) return;
            try {
              if (bwWasVisible && !bwWasMinimized) {
                if (await cur.isMinimized()) await cur.unminimize();
                if (!(await cur.isVisible())) await cur.show();
              }
            } catch {
              /* 黑板窗口可能已关闭 */
            }
          }, 300);
        });
      } catch {
        /* 静默：答案窗口创建失败不影响黑板 */
      }
    },
    [tauriMode],
  );

  // 隐藏答案窗口（非问题页时调用）
  const hideAnswerWindow = useCallback(() => {
    void answerWinRef.current?.hide().catch(() => undefined);
  }, []);

  // 页面备注窗口（黑板子窗口，固定 211×489 客户区，无最大化/最小化）：
  // 打开时写临时 JSON（应用路由页 RemarkWindowPage 读取），复用窗口时重写 JSON + 刷新
  const openRemarkWindow = useCallback(
    async (imgUrl: string) => {
      if (!tauriMode) return;
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const mw = getCurrentWindow();
        const label = `remark-${mw.label}`;
        const { tempDir, join } = await import('@tauri-apps/api/path');
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');
        const dir = await tempDir();
        const p = await join(dir, `shangkeya-remark-${label}.json`);
        await writeTextFile(p, JSON.stringify({ imgUrl }));
        const existing = remarkWinRef.current;
        if (existing) {
          await existing.show();
          await import('@tauri-apps/api/core').then(({ invoke }) =>
            invoke('reload_webview', { label }).catch(() => undefined),
          );
          return;
        }
        // 默认位置：优先上次保存（win:remark:pos）；否则课堂窗口内右侧偏下
        let position: { x: number; y: number } | undefined;
        try {
          const saved = localStorage.getItem('win:remark:pos');
          if (saved) {
            const r = JSON.parse(saved) as { x?: number; y?: number };
            if (typeof r.x === 'number' && typeof r.y === 'number') position = { x: r.x, y: r.y };
          }
          if (!position) {
            const [pos, size] = await Promise.all([mw.innerPosition(), mw.innerSize()]);
            position = { x: Math.round(pos.x + size.width - 230), y: Math.round(pos.y + size.height - 540) };
          }
        } catch {
          /* 位置计算失败则使用默认 */
        }
        const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const win = new WebviewWindow(label, {
          title: '页面备注',
          width: 211,
          height: 489,
          // 客户区固定：不可缩放、不可最大化/最小化
          resizable: false,
          maximizable: false,
          minimizable: false,
          // 无标题栏（无最大化/最小化按钮）
          decorations: false,
          url: window.location.origin + '/#/remark-window',
          ...(position ? { x: position.x, y: position.y } : {}),
          focus: false,
          // 备注窗口作为黑板窗口的子窗口（owned）：永远显示在黑板窗口上方
          parent: boardWinRef.current ? 'blackboard-canvas' : mw.label,
        });
        remarkWinRef.current = win;
        win.once('tauri://error', () => {
          if (remarkWinRef.current === win) remarkWinRef.current = null;
        });
        win.once('tauri://destroyed', () => {
          if (remarkWinRef.current === win) remarkWinRef.current = null;
        });
      } catch {
        /* 静默 */
      }
    },
    [tauriMode],
  );

  // 关闭备注窗口（翻页后下页不再是 211×489 备注帧时）
  const hideRemarkWindow = useCallback(() => {
    void remarkWinRef.current?.close().catch(() => undefined);
    remarkWinRef.current = null;
  }, []);

  // 添加课件弹窗：课堂窗口子窗口（跟随课堂、显示顺序高于黑板窗口）
  const openAddCoursewareWindow = useCallback(async () => {
    if (!tauriMode || addcwWinRef.current) return;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const mw = getCurrentWindow();
      const label = `addcw-${mw.label}`;
      // 打开位置：优先上次保存（win:addcw:rect）；否则课堂窗口正中间（物理像素）
      let winW = 420;
      let winH = 300;
      let x: number;
      let y: number;
      try {
        const saved = localStorage.getItem('win:addcw:rect');
        if (saved) {
          const r = JSON.parse(saved) as { x?: number; y?: number; w?: number; h?: number };
          if (typeof r.x === 'number' && typeof r.y === 'number') {
            x = r.x;
            y = r.y;
          } else {
            throw new Error('no-pos');
          }
          if (typeof r.w === 'number' && r.w >= 360) winW = r.w;
          if (typeof r.h === 'number' && r.h >= 260) winH = r.h;
        } else {
          throw new Error('no-saved');
        }
      } catch {
        const [pos, size] = await Promise.all([mw.innerPosition(), mw.innerSize()]);
        x = Math.round(pos.x + (size.width - winW) / 2);
        y = Math.round(pos.y + (size.height - winH) / 2);
      }
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const win = new WebviewWindow(label, {
        title: '添加课件',
        width: winW,
        height: winH,
        minWidth: 360,
        minHeight: 260,
        x,
        y,
        // 不可最大化 / 不可最小化
        maximizable: false,
        minimizable: false,
        // 添加课件弹窗作为黑板窗口的子窗口（owned）：永远显示在黑板窗口上方，不被黑板遮挡
        parent: boardWinRef.current ? 'blackboard-canvas' : mw.label,
        url: 'index.html#/add-courseware',
      });
      win.once('tauri://error', () => {
        addcwWinRef.current = null;
        toast.error('添加课件弹窗创建失败');
      });
      win.once('tauri://created', () => {
        addcwWinRef.current = win;
        // 创建新窗口可能被系统连带收起黑板窗口：按打开前状态恢复（仅此一次）
        window.setTimeout(async () => {
          const bw = boardWinRef.current;
          if (!bw) return;
          try {
            if (await bw.isMinimized()) await bw.unminimize();
            if (!(await bw.isVisible())) await bw.show();
          } catch {
            /* 黑板窗口可能已关闭 */
          }
        }, 300);
      });
      win.once('tauri://destroyed', () => {
        addcwWinRef.current = null;
        setAddCwOpen(false);
        setPickedFile(null);
        pickedFilePromiseRef.current = null;
      });
    } catch (e) {
      addcwWinRef.current = null;
      toast.error(`添加课件弹窗打开失败：${String(e)}`);
    }
  }, [tauriMode]);

  // 清空本页确认弹窗：独立窗口（与添加课件同方式），显示顺序高于黑板
  const confirmClearWinRef = useRef<WebviewWindowType | null>(null);
  const openConfirmClearWindow = useCallback(async () => {
    if (!tauriMode) {
      // 非桌面端：黑板在页面内，直接使用页面级确认
      if (window.confirm('确定清空本页全部板书吗？此操作不可撤销。')) {
        boardRef.current?.clear();
        toast.info('本页板书已清空');
      }
      return;
    }
    if (confirmClearWinRef.current) {
      void confirmClearWinRef.current.setFocus();
      return;
    }
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const mw = getCurrentWindow();
      const label = `confirm-${mw.label}`;
      const W = 300;
      const H = 170;
      // 打开默认位置：课堂窗口正中间（物理像素）
      const [pos, size] = await Promise.all([mw.innerPosition(), mw.innerSize()]);
      const x = Math.round(pos.x + (size.width - W) / 2);
      const y = Math.round(pos.y + (size.height - H) / 2);
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const win = new WebviewWindow(label, {
        title: '清空本页',
        width: W,
        height: H,
        minWidth: 280,
        minHeight: 160,
        x,
        y,
        resizable: false,
        // 不可最大化 / 不可最小化
        maximizable: false,
        minimizable: false,
        // 清空确认弹窗作为黑板窗口的子窗口（owned）：永远显示在黑板窗口上方，不被黑板遮挡
        parent: boardWinRef.current ? 'blackboard-canvas' : mw.label,
        url: 'index.html#/confirm-clear',
      });
      win.once('tauri://error', () => {
        confirmClearWinRef.current = null;
        toast.error('清空确认弹窗创建失败');
      });
      win.once('tauri://created', () => {
        confirmClearWinRef.current = win;
        // 创建新窗口可能被系统连带收起黑板窗口：按打开前状态恢复（仅此一次）
        window.setTimeout(async () => {
          const bw = boardWinRef.current;
          if (!bw) return;
          try {
            if (await bw.isMinimized()) await bw.unminimize();
            if (!(await bw.isVisible())) await bw.show();
          } catch {
            /* 黑板窗口可能已关闭 */
          }
        }, 300);
      });
      win.once('tauri://destroyed', () => {
        confirmClearWinRef.current = null;
      });
    } catch (e) {
      confirmClearWinRef.current = null;
      toast.error(`清空确认弹窗打开失败：${String(e)}`);
    }
  }, [tauriMode]);

  // 点击清空本页：课件书写层激活时直接清空课件批注；否则桌面端走独立确认弹窗，确认后清空黑板
  const handleClearClick = useCallback(() => {
    const ov = mediaInfo ? mediaOverlayRef.current : htmlInfo ? htmlOverlayRef.current : null;
    if (ov && ov.isWriting()) {
      ov.clear();
      return;
    }
    if (tauriMode) {
      void openConfirmClearWindow();
    } else {
      if (window.confirm('确定清空本页全部板书吗？此操作不可撤销。')) {
        boardRef.current?.clear();
        toast.info('本页板书已清空');
      }
    }
  }, [tauriMode, openConfirmClearWindow, mediaInfo, htmlInfo]);

  // 清空确认弹窗事件桥接
  useEffect(() => {
    if (!tauriMode) return;
    // 竞态安全注册：listen 是异步注册，若 effect 重挂载时旧监听注册未完成，
    // 旧监听会残留导致事件重复触发。disposed 标记让迟到完成的旧监听立即注销。
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    const regs: Promise<() => void>[] = [];
    const collect = (p: Promise<() => void>) => {
      regs.push(p);
      p.then((u) => {
        if (disposed) u();
        else unlisteners.push(u);
      }).catch(() => undefined);
    };
    collect(
      listen('confirm-clear:ok', () => {
        // 板书画布在黑板窗口内：发 bc:clear 让黑板窗口清空画布（课堂页内画布仅为占位，不持有板书）
        sendToBoard('bc:clear');
        sendToBoard('bc:toast', { msg: '本页板书已清空' });
        void confirmClearWinRef.current?.close().catch(() => undefined);
      }),
    );
    collect(
      listen('confirm-clear:cancel', () => {
        void confirmClearWinRef.current?.close().catch(() => undefined);
      }),
    );
    void Promise.all(regs).catch(() => undefined);
    return () => {
      disposed = true;
      unlisteners.forEach((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tauriMode]);

  // 添加课件子窗口 → 主窗口 事件桥接（用 ref 持有最新处理函数，避免闭包过期）
  const addcwHandlersRef = useRef({ pick: () => void 0, add: () => void 0 });
  // 最新状态镜像：addcw 监听 effect 只注册一次（依赖动态 state 会导致 effect 重挂载、
  // 异步注册的旧监听来不及注销，新旧监听并存 → 点一次触发两次对话框）
  const pptConvertingRef = useRef(pptConverting);
  useEffect(() => {
    pptConvertingRef.current = pptConverting;
  }, [pptConverting]);
  const pickedFileRef = useRef(pickedFile);
  useEffect(() => {
    pickedFileRef.current = pickedFile;
  }, [pickedFile]);
  useEffect(() => {
    if (!tauriMode) return;
    // 竞态安全注册：与清空确认监听一致，防止 effect 重挂载时旧监听残留导致事件重复触发
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    const regs: Promise<() => void>[] = [];
    const collect = (p: Promise<() => void>) => {
      regs.push(p);
      p.then((u) => {
        if (disposed) u();
        else unlisteners.push(u);
      }).catch(() => undefined);
    };
    collect(
      listen('addcw:pick', () => {
        void addcwHandlersRef.current.pick();
      }),
    );
    collect(
      listen('addcw:name', (e) => {
        const nm = (e.payload as { name?: string } | undefined)?.name;
        if (typeof nm === 'string') setNewName(nm);
      }),
    );
    collect(
      listen('addcw:confirm', (e) => {
        // 弹窗输入的名称同步到课堂侧
        const nm = (e.payload as { name?: string } | undefined)?.name;
        if (typeof nm === 'string') setNewName(nm);
        void addcwHandlersRef.current.add();
      }),
    );
    collect(
      listen('addcw:ready', () => {
        // 子窗口就绪 → 推送当前状态（读 ref 拿最新值）
        void emit('addcw:state', {
          converting: pptConvertingRef.current,
          pickedName: pickedFileRef.current?.name,
          error: undefined,
        });
      }),
    );
    collect(
      listen('addcw:cancel', () => {
        setAddCwOpen(false);
        setPickedFile(null);
        pickedFilePromiseRef.current = null;
        void addcwWinRef.current?.close().catch(() => undefined);
      }),
    );
    void Promise.all(regs).catch(() => undefined);
    return () => {
      disposed = true;
      unlisteners.forEach((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tauriMode]);

  // 切回黑板（取消选中课件）
  const showBlackboard = () => {
    // 点击「黑板」切换到空白页：关闭正在播放的视频/音频与 HTML 网页课件
    closeMedia();
    closeHtml();
    setCwSelId(null);
    setPdfForId(null);
    setPdfImages(null);
    setCurrentOpenPath(null);
    setPage(0);
  };

  // ── 黑板独立窗口：课堂页打开时自动创建无边框窗口，书写/课件加载/翻页/缩放都在窗口内 ──
  const boardWinRef = useRef<WebviewWindowType | null>(null);
  const boardWinCreatingRef = useRef(false);
  const [boardWinOk, setBoardWinOk] = useState(false);
  const boardPlaceholderRef = useRef<HTMLDivElement | null>(null);
  const [boardZoom, setBoardZoom] = useState(1);
  // 宽度填满基准（100%）：由黑板侧回传；缩放范围 10%-100%（相对该基准）
  const [boardFill, setBoardFill] = useState(1);
  // 添加课件弹窗（课堂窗口子窗口，显示顺序高于黑板）
  const addcwWinRef = useRef<WebviewWindowType | null>(null);
  // 诊断：黑板窗口是否已收到位置广播并贴合
  const [boardAck, setBoardAck] = useState(false);
  const boardPageCount = useMemo(
    () =>
      isTiffMode && tiffPages
        ? Math.max(tiffPages.length, 1)
        : activeImages
          ? Math.max(activeImages.length, 1)
          : PAGE_COUNT,
    [isTiffMode, tiffPages, activeImages],
  );

  // 键盘左右键翻页课件（排除输入/编辑状态；黑板独立窗口焦点时由黑板窗口自行处理）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setPage((p) => Math.max(0, p - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setPage((p) => Math.min(boardPageCount - 1, p + 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [boardPageCount]);

  // 黑板窗口同步状态的最新值（供就绪握手全量补推）
  // 「动态比例（跟随课件）」：加载课件图片后缓存其原始尺寸比例，驱动窗口/容器按图片比例调整（内容充满窗口）
  const [cwImgSize, setCwImgSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (data.settings.boardAspectMode !== 'followCw' || !bgImage) {
      setCwImgSize(null);
      return;
    }
    const img = new Image();
    img.onload = () => setCwImgSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => setCwImgSize(null);
    img.src = bgImage;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [bgImage, data.settings.boardAspectMode]);

  const bcStateRef = useRef({
    tool,
    color,
    penSize,
    lineStyle,
    fontFamily,
    textSize,
    boardStyle: data.settings.boardStyle,
    customBoardImage: undefined as string | undefined,
    customBoardImage: data.settings.customBoardImage,
    hideQuestionInfo: data.settings.hideQuestionInfo,
    hideQuestionTimeRegion: data.settings.hideQuestionTimeRegion,
    boardAspect: boardAspectFromSettings(data.settings),
    boardAspectFree: data.settings.boardAspectMode === 'free',
    timerText,
    pdfForId,
    cwSelId,
    bgImage,
    isTiffMode,
    tiffPages,
    activeImages,
    page,
    zoom: boardZoom,
    penetrateNextUrl,
  });
  useEffect(() => {
    const mode = data.settings.boardAspectMode;
    // 动态比例（跟随课件）：有课件时按课件图片原始比例 contain（内容充满窗口）；无课件按自由比例满铺
    const hasCwImg = mode === 'followCw' && !!bgImage && !!cwImgSize;
    bcStateRef.current = {
      tool,
      color,
      penSize,
      lineStyle,
      fontFamily,
      textSize,
      boardStyle: data.settings.boardStyle,
    customBoardImage: data.settings.customBoardImage,
      hideQuestionInfo: data.settings.hideQuestionInfo,
      hideQuestionTimeRegion: data.settings.hideQuestionTimeRegion,
      boardAspect:
        mode === 'followCw'
          ? hasCwImg
            ? cwImgSize!.w / cwImgSize!.h
            : 878 / 494
          : boardAspectFromSettings(data.settings),
      boardAspectFree: mode === 'followCw' ? !hasCwImg : mode === 'free',
      timerText,
      pdfForId,
      cwSelId,
      bgImage,
      isTiffMode,
      tiffPages,
      activeImages,
      page,
      zoom: boardZoom,
      penetrateNextUrl,
    };
  }, [tool, color, penSize, lineStyle, fontFamily, textSize, tiffAspect, timerText, data.settings.boardStyle, data.settings.customBoardImage, data.settings.boardAspectMode, data.settings.freeBoardAspectW, data.settings.freeBoardAspectH, data.settings.hideQuestionInfo, data.settings.hideQuestionTimeRegion, pdfForId, cwSelId, bgImage, cwImgSize, isTiffMode, tiffPages, activeImages, page, boardZoom, penetrateNextUrl]);

  // 向黑板窗口发送事件：统一走 Rust 端分发。
  // 前端 emitTo 到 owned 子窗口（黑板）偶发丢失（实测撤销/清空事件收不到），Rust 端 w.emit 可靠
  const sendToBoard = useCallback((event: string, payload?: unknown) => {
    if (!tauriMode) return;
    void import('@tauri-apps/api/core').then(({ invoke }) =>
      invoke('board_emit', { event, payload: payload ?? null }).catch(() => undefined),
    );
  }, [tauriMode]);

  // 全量推送黑板窗口状态（创建完成 / 窗口就绪握手时调用）
  const pushBcFull = useCallback(async () => {
    if (!tauriMode) return;
    const s = bcStateRef.current;
    const pageCount =
      s.isTiffMode && s.tiffPages
        ? Math.max(s.tiffPages.length, 1)
        : s.activeImages
          ? Math.max(s.activeImages.length, 1)
          : PAGE_COUNT;
    sendToBoard('bc:init', {
      boardStyle: s.boardStyle,
      customBoardImage: s.customBoardImage,
      hideQuestionInfo: s.hideQuestionInfo,
      hideQuestionTimeRegion: s.hideQuestionTimeRegion,
      tool: s.tool,
      color: s.color,
      penSize: s.penSize,
      lineStyle: s.lineStyle,
      fontFamily: s.fontFamily,
      textSize: s.textSize,
      boardAspect: s.boardAspect,
      boardAspectFree: s.boardAspectFree,
      timerText: s.timerText,
      pageCount,
      isTiffMode: s.isTiffMode,
      penetrateNextUrl: s.penetrateNextUrl,
    });
    sendToBoard('bc:props', {
      tool: s.tool,
      color: s.color,
      penSize: s.penSize,
      lineStyle: s.lineStyle,
      fontFamily: s.fontFamily,
      textSize: s.textSize,
      boardStyle: s.boardStyle,
      customBoardImage: s.customBoardImage,
      hideQuestionInfo: s.hideQuestionInfo,
      hideQuestionTimeRegion: s.hideQuestionTimeRegion,
      boardAspect: s.boardAspect,
      boardAspectFree: s.boardAspectFree,
      timerText: s.timerText,
      penetrateNextUrl: s.penetrateNextUrl,
    });
    sendToBoard('bc:resetKey', s.pdfForId ?? s.cwSelId ?? 'plain');
    sendToBoard('bc:image', s.bgImage ?? null);
    sendToBoard('bc:pageCount', pageCount);
    sendToBoard('bc:page', s.page);
    sendToBoard('bc:zoom', s.zoom);
  }, [sendToBoard]);

  const createBoardWindow = useCallback(async () => {
    if (!tauriMode || boardWinRef.current || boardWinCreatingRef.current) return;
    boardWinCreatingRef.current = true;
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      // 默认打开位置/尺寸：直接按课堂占位区计算（与黑板页贴合逻辑一致），避免先出现在别处再跳
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const mw = getCurrentWindow();
      const [pos, scale] = await Promise.all([mw.innerPosition(), mw.scaleFactor()]);
      const rect = boardPlaceholderRef.current?.getBoundingClientRect();
      const zoneW = Math.round((rect?.width ?? 800) * scale);
      const zoneH = Math.round((rect?.height ?? 500) * scale);
      // 黑板窗口初始尺寸按设置页黑板画面比例（16:9→878:494、9:16→494:878、4:3、自定义）；
      // 自由比例：宽=占位区宽-20、高=占位区高-20（充满占位区，每边 10px，不 contain）；
      // 贴合/跟随规则保持独立窗口实现方式（创建后由 bc 推送比例 + winPos 贴合持续校正）
      const isFree = data.settings.boardAspectMode === 'free';
      let wPx: number;
      let hPx: number;
      if (isFree) {
        wPx = Math.max(300, zoneW - 20);
        hPx = Math.max(200, zoneH - 20);
      } else {
        const aspect = boardAspectFromSettings(data.settings, zoneW / zoneH);
        wPx = Math.max(300, zoneW - 20);
        hPx = Math.round(wPx / aspect);
        if (hPx > Math.max(200, zoneH - 20)) {
          hPx = Math.max(200, zoneH - 20);
          wPx = Math.round(hPx * aspect);
        }
      }
      const x = Math.round(pos.x + (rect?.left ?? 0) * scale + (zoneW - wPx) / 2);
      const y = Math.round(pos.y + (rect?.top ?? 0) * scale + (zoneH - hPx) / 2);
      const win = new WebviewWindow('blackboard-canvas', {
        title: '上课鸭 · 黑板',
        width: wPx,
        height: hPx,
        x,
        y,
        minWidth: 300,
        minHeight: 200,
        decorations: false,
        resizable: true,
        url: 'index.html#/blackboard-canvas',
        // 黑板作为课堂窗口的子窗口（owned）：Windows 原生保证永远显示在课堂窗口上方、随课堂移动，
        // 层级不再需要任何手动 Z 序代码；课堂关闭时 owned 子窗口自动随父关闭（Rust Destroyed 双保险）
        parent: mw.label,
      });
      win.once('tauri://error', () => {
        boardWinCreatingRef.current = false;
        toast.error('黑板窗口创建失败，已恢复为窗口内黑板');
      });
      win.once('tauri://created', () => {
        boardWinCreatingRef.current = false;
        boardWinRef.current = win;
        setBoardWinOk(true);
        // 窗口页面可能仍在加载：延迟补推一次，就绪握手兜底
        window.setTimeout(() => void pushBcFull(), 400);
      });
      win.once('tauri://destroyed', () => {
        boardWinRef.current = null;
        setBoardWinOk(false);
      });
    } catch (e) {
      boardWinCreatingRef.current = false;
      toast.error(`黑板窗口打开失败：${String(e)}`);
    }
  }, [
    tauriMode,
    tool,
    color,
    penSize,
    lineStyle,
    fontFamily,
    textSize,
    tiffAspect,
    timerText,
    data.settings.boardStyle,
    isTiffMode,
    tiffPages,
    activeImages,
    pushBcFull,
  ]);

  // 课堂页打开时自动创建黑板独立窗口（仅首次自动创建；黑板被手动关闭后不自动重开，
  // 由底部「黑板窗口」按钮手动重开，避免关闭课堂/黑板时被 effect 重新拉起）
  const autoCreatedRef = useRef(false);
  useEffect(() => {
    // 仅「独立黑板窗口」模式自动创建黑板窗口；「课堂黑板一体」模式黑板内嵌课堂占位区
    if (
      tauriMode &&
      data.settings.boardWindowMode === 'separate' &&
      !autoCreatedRef.current
    ) {
      autoCreatedRef.current = true;
      void createBoardWindow();
    }
  }, [tauriMode, createBoardWindow, data.settings.boardWindowMode]);

  // 切换到「不使用独立黑板窗口（课堂黑板一体）」时销毁遗留的独立黑板窗口，
  // 让占位区回到内嵌黑板渲染路径（与浏览器模式完全一致）
  useEffect(() => {
    if (!tauriMode) return;
    if (data.settings.boardWindowMode === 'inline' && boardWinRef.current) {
      void boardWinRef.current.destroy().catch(() => {});
    }
  }, [data.settings.boardWindowMode, tauriMode]);

  // 独立黑板窗口位置：黑板窗口自己贴合——课堂窗口广播自身位置与黑板区尺寸（自控，绝对可靠）
  useEffect(() => {
    if (!tauriMode) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const { emit } = await import('@tauri-apps/api/event');
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const mw = getCurrentWindow();
        const ip = await mw.innerPosition();
        const scale = await mw.scaleFactor();
        const rect = boardPlaceholderRef.current?.getBoundingClientRect();
        void emit('bc:winPos', {
          ipX: ip.x,
          ipY: ip.y,
          scale,
          rectLeft: rect?.left ?? 0,
          rectTop: rect?.top ?? 0,
          rectW: rect?.width ?? 800,
          rectH: rect?.height ?? 500,
        });
      } catch (e) {
        console.error('黑板跟随广播失败', e);
      }
    };
    const iv = window.setInterval(() => void tick(), 100);
    void tick();
    return () => {
      stop = true;
      window.clearInterval(iv);
    };
  }, [tauriMode]);

  // 黑板窗口就绪握手：窗口监听注册完成后请求全量补推（避免加载慢导致事件丢失）。
  // 黑板窗口可能高频重发 bc:ready（如每笔书写后收到背景更新触发渲染），全量推送含 bc:image/init/props，
  // 每次全量重发会导致黑板窗口反复重载背景、缩放回传形成循环 → 背景逐笔缩小。
  // 用防抖：短时间内只响应一次全量推送。
  useEffect(() => {
    if (!tauriMode) return;
    let un: (() => void) | undefined;
    let cancelled = false;
    let lastPush = 0;
    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen('bc:ready', () => {
          if (cancelled) return;
          const now = Date.now();
          if (now - lastPush < 500) return;
          lastPush = now;
          void pushBcFull();
        }),
      )
      .then((u) => {
        un = u;
      });
    return () => {
      cancelled = true;
      un?.();
    };
  }, [tauriMode, pushBcFull]);

  // 黑板窗口课件自动填充缩放回传 → 主窗口控制栏百分比联动
  // 监听在应用启动即注册（不依赖黑板窗口状态），确保 fillZoom 初始化回传不丢失
  useEffect(() => {
    if (!tauriMode) return;
    let un: (() => void) | undefined;
    let cancelled = false;
    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen('bc:zoomChanged', (e) => {
          if (cancelled) return;
          const p = e.payload as { zoom?: number; fill?: number } | undefined;
          if (p && typeof p === 'object' && typeof p.zoom === 'number') {
            setBoardZoom(p.zoom);
            if (typeof p.fill === 'number' && p.fill > 0) setBoardFill(p.fill);
          } else if (typeof e.payload === 'number') {
            setBoardZoom(e.payload);
          }
        }),
      )
      .then((u) => {
        un = u;
      });
    return () => {
      cancelled = true;
      if (un) un();
    };
  }, [tauriMode]);

  // 黑板配置同步：工具/颜色/线宽等变化推送共享窗口
  useEffect(() => {
    if (!tauriMode || !boardWinOk) return;
    const mode = data.settings.boardAspectMode;
    const hasCwImg = mode === 'followCw' && !!bgImage && !!cwImgSize;
    sendToBoard('bc:props', {
      tool,
      color,
      penSize,
      lineStyle,
      fontFamily,
      textSize,
      boardStyle: data.settings.boardStyle,
    customBoardImage: data.settings.customBoardImage,
      hideQuestionInfo: data.settings.hideQuestionInfo,
      hideQuestionTimeRegion: data.settings.hideQuestionTimeRegion,
      boardAspect:
        mode === 'followCw'
          ? hasCwImg
            ? cwImgSize!.w / cwImgSize!.h
            : 878 / 494
          : boardAspectFromSettings(data.settings),
      boardAspectFree: mode === 'followCw' ? !hasCwImg : mode === 'free',
      timerText,
      penetrateNextUrl,
    });
  }, [tauriMode, boardWinOk, sendToBoard, tool, color, penSize, lineStyle, fontFamily, textSize, tiffAspect, timerText, data.settings.boardStyle, data.settings.hideQuestionInfo, data.settings.hideQuestionTimeRegion, data.settings.boardAspectMode, data.settings.freeBoardAspectW, data.settings.freeBoardAspectH, bgImage, cwImgSize, penetrateNextUrl]);

  // 课件切换 → 重置共享窗口画布
  useEffect(() => {
    if (!tauriMode || !boardWinOk) return;
    sendToBoard('bc:resetKey', pdfForId ?? cwSelId ?? 'plain');
  }, [tauriMode, boardWinOk, sendToBoard, pdfForId, cwSelId]);

  // 当前页背景 / 页码 / 页数同步（值去重：即使 effect 因依赖变化重跑，值不变也不重发，
  // 避免高频重发背景导致黑板窗口反复重载、缩放循环 → 背景逐笔缩小）
  const lastPageSyncRef = useRef<{ bg: string | null | undefined; page: number; pc: number } | null>(null);
  useEffect(() => {
    if (!tauriMode || !boardWinOk) return;
    const pc = isTiffMode && tiffPages
      ? Math.max(tiffPages.length, 1)
      : activeImages
        ? Math.max(activeImages.length, 1)
        : PAGE_COUNT;
    const cur = { bg: bgImage ?? null, page, pc };
    const last = lastPageSyncRef.current;
    if (last && last.bg === cur.bg && last.page === cur.page && last.pc === cur.pc) return;
    lastPageSyncRef.current = cur;
    sendToBoard('bc:image', bgImage ?? null);
    sendToBoard('bc:pageCount', pc);
    sendToBoard('bc:page', page);
  }, [tauriMode, boardWinOk, sendToBoard, bgImage, isTiffMode, tiffPages, activeImages, page]);

  // 黑板缩放：主窗口控制栏按钮直接推送（不再由 boardZoom 变化 effect 自动发送，
  // 避免初始默认值 1 覆盖黑板宽度填满值，也避免回传触发的循环发送）
  const pushBoardZoom = useCallback(
    (nz: number) => {
      setBoardZoom(nz);
      sendToBoard('bc:zoom', nz);
    },
    [sendToBoard],
  );

  // 课堂窗口关闭联动：不注册任何关闭事件处理器（注册后 Tauri 关闭流程会被挂起，课堂关不掉）。
  // 改为极速心跳：课堂窗口每 100ms 广播位置，黑板窗口 300ms 收不到即自行关闭 → 视觉上同时关闭。

  // 黑板窗口已自行关闭 → 恢复窗口内黑板（回退）
  useEffect(() => {
    if (!tauriMode) return;
    let un: (() => void) | undefined;
    let cancelled = false;
    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen('bc:closed', () => {
          if (cancelled) return;
          boardWinRef.current = null;
          setBoardWinOk(false);
        }),
      )
      .then((u) => {
        un = u;
      });
    return () => {
      cancelled = true;
      un?.();
    };
  }, [tauriMode]);

  // 黑板窗口贴合确认（诊断）
  useEffect(() => {
    if (!tauriMode) return;
    let un: (() => void) | undefined;
    let cancelled = false;
    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen('bc:winPosAck', () => {
          if (!cancelled) setBoardAck(true);
        }),
      )
      .then((u) => {
        un = u;
      });
    return () => {
      cancelled = true;
      un?.();
    };
  }, [tauriMode]);

  // 共享窗口翻页回传 → 主窗口页码联动
  useEffect(() => {
    if (!tauriMode || !boardWinOk) return;
    let un: (() => void) | undefined;
    let cancelled = false;
    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen('bc:pageChanged', (e) => {
          if (!cancelled) setPage(Number(e.payload) || 0);
        }),
      )
      .then((u) => {
        un = u;
      });
    return () => {
      cancelled = true;
      un?.();
    };
  }, [tauriMode, boardWinOk]);

  // 备注/答案窗口键盘左右键翻页回传（相对翻页指令 → 主窗口页码联动）
  useEffect(() => {
    if (!tauriMode) return;
    let un: (() => void) | undefined;
    let cancelled = false;
    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen('cw:pageNav', (e) => {
          if (cancelled) return;
          const dir = Number((e.payload as { dir?: number } | null)?.dir ?? 0);
          if (dir === 0) return;
          setPage((p) => Math.max(0, Math.min(boardPageCount - 1, p + dir)));
        }),
      )
      .then((u) => {
        un = u;
      });
    return () => {
      cancelled = true;
      un?.();
    };
  }, [tauriMode, boardPageCount]);

  // 组件卸载时关闭黑板窗口
  useEffect(
    () => () => {
      if (boardWinRef.current) {
        try {
          boardWinRef.current.close();
        } catch {
          /* 已关闭 */
        }
      }
    },
    [],
  );

  // TIFF 逐帧：页码变化时按需解码当前帧；问题帧的答案图在独立窗口打开；
  // 非问题页时隐藏答案窗口（连续问题翻页时自动刷新显示）
  useEffect(() => {
    // 非 TIFF 课件（PDF / 图片 / 空白页）或课件切换后：答案窗口与备注窗口隐藏
    if (!isTiffMode || !tiffMeta || !tiffPages) {
      hideAnswerWindow();
      hideRemarkWindow();
      return;
    }
    let cancelled = false;
    const f = tiffPages[page];
    if (!f) {
      hideAnswerWindow();
      hideRemarkWindow();
      setPenetrateNextUrl(null);
      return;
    }
    // 题目信息条隐藏模式（在帧解码为图像数据时应用，黑板加载的即为处理后的帧）
    const qMode: 'full' | 'time' | 'none' = data.settings.hideQuestionInfo
      ? 'full'
      : data.settings.hideQuestionTimeRegion
        ? 'time'
        : 'none';
    const isQuestion = f.kind === '问题';
    const showAnswer = data.settings.showAnswer && isQuestion && f.answerIndex != null;
    const enableNext = data.settings.enableNextPreview;
    const nextFrame = enableNext ? tiffPages[page + 1] : undefined; // 下页课件帧（tiffPages 已过滤答案帧）
    const owner = cwSelId ?? currentOpenPath ?? 'cw';
    // 页面备注（tiff）：当前页加载时判断下页（原始顺序 f.index+1）是否为 211×489 竖版备注帧
    const showRemark = data.settings.showPageRemark;
    const nextRaw = showRemark ? tiffMeta.frames[f.index + 1] : undefined;
    const isRemarkNext = !!nextRaw && nextRaw.width === 211 && nextRaw.height === 489;
    // 渗透显示：下一页课件帧（独立于「下页预览」设置，始终可用；无下一页则为空）
    const penNext = tiffPages[page + 1];
    (async () => {
      try {
        const [au, nu, ru, pnu] = await Promise.all([
          showAnswer ? tiffMeta.getImage(f.answerIndex as number, qMode) : Promise.resolve(null),
          nextFrame ? tiffMeta.getImage(nextFrame.index, qMode) : Promise.resolve(null),
          showRemark && isRemarkNext ? tiffMeta.getImage(nextRaw.index, qMode) : Promise.resolve(null),
          penNext ? tiffMeta.getImage(penNext.index, qMode) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setPenetrateNextUrl(pnu);
        if (au) {
          // 问题页：优先显示答案，同时带「下页预览」分组
          void openAnswerWindow(au, owner, f.index, { nextUrl: nu, enableNext: !!nu, hasAnswer: true });
        } else if (nu) {
          // 非问题页（开启下页预览）：显示下页预览分组
          void openAnswerWindow('', owner, f.index, { nextUrl: nu, enableNext: true, hasAnswer: false });
        } else {
          // 无答案且无下页预览 → 隐藏
          hideAnswerWindow();
        }
        // 页面备注窗口：下页是 211×489 备注帧则打开/刷新，否则关闭
        if (showRemark) {
          if (ru) void openRemarkWindow(ru);
          else hideRemarkWindow();
        }
      } catch {
        if (!cancelled) toast.error('当前帧解码失败');
      }
    })();
    // 当前帧背景图
    tiffMeta.getImage(f.index, qMode).then((u) => {
      if (!cancelled) setTiffPageUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [isTiffMode, tiffMeta, tiffPages, page, pdfForId, cwSelId, currentOpenPath, openAnswerWindow, hideAnswerWindow, openRemarkWindow, hideRemarkWindow, data.settings.hideQuestionInfo, data.settings.hideQuestionTimeRegion, data.settings.showAnswer, data.settings.enableNextPreview, data.settings.showPageRemark]);

  // 当前打开课件目录：沿本机目录树还原完整路径层级
  const currentOpenDir = useMemo(() => {
    if (!currentOpenPath) return null;
    const find = (ns: LocalCwNode[], target: string, trail: string[]): string[] | null => {
      for (const n of ns) {
        const t = [...trail, n.name];
        if (n.path === target) return t;
        if (n.children) {
          const r = find(n.children, target, t);
          if (r) return r;
        }
      }
      return null;
    };
    if (localTree) {
      const p = find(localTree, currentOpenPath, []);
      if (p) return p;
    }
    return [currentOpenPath];
  }, [currentOpenPath, localTree]);

  // 当前帧（TIFF 图集模式，答案帧已过滤，不参与课件页）
  const currentFrame = isTiffMode && tiffPages ? (tiffPages[page] ?? null) : null;

  const deleteCourseware = () => {
    if (!selectedCw) {
      toast.error('请先选择要删除的课件');
      return;
    }
    // 从本课内容移除（course.files，随课程同步到云端）
    if (course) {
      setData((prev) => ({
        ...prev,
        courses: prev.courses.map((c) =>
          c.id === course.id
            ? { ...c, files: (c.files ?? []).filter((f) => f.id !== selectedCw.id) }
            : c,
        ),
      }));
    }
    // 本地课件（本机目录加入本课）：仅从本课列表移除，不删除磁盘文件
    if (selectedCw.id.startsWith('local-')) {
      setLocalLessonIds((prev) => prev.filter((id) => id !== selectedCw.id));
      localNodeCacheRef.current.delete(selectedCw.id);
      setCwSelId(null);
      toast.success('已从本课内容移除');
      return;
    }
    if (selectedCw.file) {
      deleteCoursewareFile(selectedCw.id).catch(() => undefined);
    }
    // 找到课件所在分支并删除
    const branchKey = Object.entries(data.courseware).find(([, ns]) =>
      allFiles(ns).some((f) => f.id === selectedCw.id),
    )?.[0];
    if (branchKey) {
      setData((prev) => ({
        ...prev,
        courseware: {
          ...prev.courseware,
          [branchKey]: removeNode(prev.courseware[branchKey] ?? [], selectedCw.id),
        },
      }));
    }
    setCwSelId(null);
    toast.success('课件已删除');
  };

  // 桌面端（Tauri）：原生对话框选择课件文件；选到 PPT 自动转换为 PDF
  const pickingRef = useRef(false);
  // 选择文件后的字节读取 Promise：立即显示文件名、字节后台读取，添加时等待完成
  const pickedFilePromiseRef = useRef<Promise<File | null> | null>(null);
  const pickCoursewareFile = async () => {
    // 防重入：文件对话框已打开时忽略重复触发（避免同时打开多个对话框、最终重复添加课件）
    if (pickingRef.current) return;
    pickingRef.current = true;
    try {
    if (!tauriMode) {
      cwFileInputRef.current?.click();
      return;
    }
    // 打开原生对话框前记录黑板可见状态；对话框打开期间系统可能把黑板收起，
    // 因此轮询恢复（不抢焦点），对话框关闭后停止轮询并再恢复一次
    const bwBefore = boardWinRef.current;
    let bwWasVisible = true;
    if (bwBefore) {
      try {
        bwWasVisible = await bwBefore.isVisible();
      } catch {
        bwWasVisible = true;
      }
    }
    const restoreBoard = async () => {
      const cur = boardWinRef.current;
      if (!cur || !bwWasVisible) return;
      try {
        if (await cur.isMinimized()) await cur.unminimize();
        if (!(await cur.isVisible())) await cur.show();
      } catch {
        /* 黑板窗口可能已关闭 */
      }
    };
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      // 原生对话框 owner 绑定到添加课件弹窗（作为 addcw 的子窗口）：
      // 模态只影响 addcw/课堂窗口链，黑板窗口不受任何影响
      const pollRestore = window.setInterval(() => {
        void restoreBoard();
      }, 200);
      const sel = await invoke<string | null>('pick_courseware_dialog', {
        parent:
          addcwWinRef.current?.label ??
          (await import('@tauri-apps/api/window')).getCurrentWindow().label,
      });
      window.clearInterval(pollRestore);
      // 对话框已关闭 → 恢复黑板窗口（即使后续转换耗时，黑板不再消失）
      void restoreBoard();
      if (!sel) return;
      if (/\.(ppt|pptx)$/i.test(sel)) {
        setPptConverting(true);
        void emit('addcw:state', { converting: true });
        try {
          const bytes = await invoke<number[]>('convert_ppt_to_pdf', { src: sel });
          const name = sel.split(/[\\/]/).pop()!.replace(/\.(ppt|pptx)$/i, '.pdf');
          const pdfFile = new File([new Uint8Array(bytes)], name, { type: 'application/pdf' });
          // 转换成功 → 显示转换后的 PDF 文件名，等待用户点击「添加」确认入库（不自动添加）
          setPickedFile(pdfFile);
          pickedFilePromiseRef.current = Promise.resolve(pdfFile);
          setNewName(name.replace(/\.pdf$/i, ''));
          void emit('addcw:state', { converting: false, pickedName: name });
        } catch (e) {
          toast.error(`PPT 转换失败：${String(e)}`);
          void emit('addcw:state', { converting: false, error: `PPT 转换失败：${String(e)}` });
        } finally {
          setPptConverting(false);
        }
        return;
      }
      // 非 PPT：立即显示文件名（从路径取，不等字节读取）；文件字节后台读取，
      // 大文件经 IPC 传输较慢，不阻塞文件名显示；点「添加」时若尚未读完则等待完成
      const name = sel.split(/[\\/]/).pop() || '课件';
      const mime = mimeForFile(name);
      setNewName(name.replace(/\.[^.]+$/, ''));
      void emit('addcw:state', { converting: false, pickedName: name });
      const p = invoke<number[]>('read_courseware_file', { path: sel })
        .then((bytes) => new File([new Uint8Array(bytes)], name, { type: mime }))
        .catch(() => null);
      pickedFilePromiseRef.current = p;
      void p.then((f) => {
        if (f) setPickedFile(f);
      });
    } catch (e) {
      void restoreBoard();
      toast.error(String(e));
      void emit('addcw:state', { converting: false, error: String(e) });
    }
    } finally {
      pickingRef.current = false;
    }
  };

  // 后台预解析（PDF/TIFF）：解析期间课件目录中该条目灰度显示、不可选择；完成后缓存，点开直接显示
  const preparseDoneRef = useRef<Set<string>>(new Set());
  const preparseCourseware = useCallback(async (f: ICourseNode) => {
    if (!f.file || !/\.(pdf|tiff?)$/i.test(f.file.name)) return;
    if (preparseDoneRef.current.has(f.id)) return;
    preparseDoneRef.current.add(f.id);
    setParsingIds((prev) => new Set(prev).add(f.id));
    try {
      const blob = await loadCoursewareBlob(f);
      if (!blob) return;
      if (/\.pdf$/i.test(f.file.name)) {
        const imgs = await pdfToImages(blob);
        pdfParseCacheRef.current.set(f.id, imgs);
      } else {
        const deferred = await decodeTiffDeferred(await blob.arrayBuffer());
        tiffParseCacheRef.current.set(f.id, deferred);
      }
    } catch {
      /* 后台解析失败：点开时按常规重新解析 */
    } finally {
      setParsingIds((prev) => {
        const next = new Set(prev);
        next.delete(f.id);
        return next;
      });
    }
  }, []);

  // 课堂打开：课件目录 + 本机目录加入本课的 PDF/TIFF 课件逐个后台预解析（不打断黑板；解析中灰度不可选）
  useEffect(() => {
    const all = [...cwFiles, ...localLessonNodes];
    if (all.length === 0) return;
    const targets = all.filter(
      (f) =>
        f.file &&
        /\.(pdf|tiff?)$/i.test(f.file.name) &&
        !preparseDoneRef.current.has(f.id),
    );
    if (targets.length === 0) return;
    let cancelled = false;
    const run = async () => {
      for (const f of targets) {
        if (cancelled) break;
        await preparseCourseware(f);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, localLessonNodes]);

  const addCourseware = async () => {
    if (!newName.trim()) {
      toast.error('请输入课件名称');
      return;
    }
    // 选择文件后字节后台读取中：点「添加」时等待读取完成（保证文件本体入库）
    const fileObj = pickedFile ?? (await pickedFilePromiseRef.current) ?? null;
    if (pickedFile === null && pickedFilePromiseRef.current) setPickedFile(fileObj);
    if (fileObj && /\.(ppt|pptx)$/i.test(fileObj.name) && !tauriMode) {
      toast.error('PPT 课件请先在 PowerPoint / WPS 中另存为 PDF 再添加');
      return;
    }
    const file: ICourseNode = {
      id: `w-${Date.now()}`,
      name: newName.trim(),
      type: 'file',
      file: fileObj
        ? { name: fileObj.name, size: fileObj.size, mime: fileObj.type || '' }
        : null,
    };
    if (fileObj) {
      try {
        await saveCoursewareFile(file.id, fileObj);
      } catch {
        toast.error('课件文件保存失败');
        return;
      }
    }
    setData((prev) => ({
      ...prev,
      courseware: {
        ...prev.courseware,
        [DEFAULT_BRANCH]: [...(prev.courseware[DEFAULT_BRANCH] ?? []), file],
      },
    }));
    setNewName('');
    setPickedFile(null);
    setAddCwOpen(false);
    setAddedCwIds((prev) => [...prev, file.id]);
    toast.success('课件已添加');
    // PDF / TIFF：添加后不选中、不打断黑板，后台预解析并缓存；解析期间课件目录中灰度显示、不可选择
    if (file.file && /\.(pdf|tiff?)$/i.test(file.file.name)) {
      void preparseCourseware(file);
    }
    void emit('addcw:done');
    // 双保险：直接关闭添加课件弹窗（不依赖弹窗收到 done 后自行关闭）
    void addcwWinRef.current?.close().catch(() => undefined);
  };

  // 持有最新处理函数（供子窗口事件桥接使用，避免闭包过期）
  addcwHandlersRef.current = { pick: pickCoursewareFile, add: addCourseware };

  const renderTree = (ns: ICourseNode[], depth: number) =>
    ns.map((n) => {
      const parsing = n.type === 'file' && parsingIds.has(n.id);
      return (
        <button
          key={n.id}
          type="button"
          disabled={parsing}
          className={cn(
            'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors',
            parsing
              ? 'cursor-not-allowed opacity-50'
              : cwSelId === n.id
                ? 'bg-accent font-medium text-primary'
                : 'text-foreground hover:bg-muted',
          )}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => n.type === 'file' && !parsing && setCwSelId(n.id)}
        >
          {n.type === 'folder' ? (
            <Folder className="h-3.5 w-3.5 shrink-0 text-warning" />
          ) : (
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{n.name}</span>
        </button>
      );
    });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* 左侧书写工具栏：距窗口左边 9px；右侧分界线独立、距工具栏右缘 5px */}
        <div className="ml-[9px] flex shrink-0">
          <div className="flex w-[4.5rem] flex-col items-center gap-2.5 overflow-y-auto bg-card py-3">
          <div className="grid grid-cols-2 gap-0.5">
            {TOOLS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                    tool === t.id
                      ? 'bg-accent text-primary'
                      : 'text-gray-600 hover:bg-muted',
                  )}
                  onClick={() => setTool(t.id)}
                  aria-label={t.label}
                >
                  <t.icon className="h-4 w-4" />
                </button>
              ))}
            </div>
            {/* 撤销 + 清空本页（并入画图工具组） */}
            <div className="flex gap-0.5">
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-muted"
                    onClick={() => {
                      // 课件书写层激活：撤销课件书写（HTML/视频书写批注）
                      const ov = mediaInfo ? mediaOverlayRef.current : htmlInfo ? htmlOverlayRef.current : null;
                      if (ov && ov.isWriting()) {
                        ov.undo();
                        return;
                      }
                      // 板书在黑板窗口画布：向黑板窗口发 bc:undo 撤销；窗口内黑板（占位）直接调本页画布
                      if (tauriMode && boardWinOk) {
                        void import('@tauri-apps/api/core').then(({ invoke }) =>
                          invoke('board_emit', { event: 'bc:undo', payload: null }).catch(() => undefined),
                        );
                      } else {
                        boardRef.current?.undo();
                      }
                    }}
                    aria-label="撤销"
                  >
                    <Undo2 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-destructive transition-colors hover:bg-muted"
                    onClick={handleClearClick}
                    aria-label="清空本页"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
            </div>
          <div className="h-px w-12 bg-border" />
          <div className="flex w-full flex-col gap-1 px-1">
            <span className="text-center text-[10px] leading-none text-black">线型</span>
            <div className="flex flex-col gap-1">
              {LINE_STYLES.map((ls) => (
                <button
                  key={ls.id}
                  type="button"
                  className={cn(
                    'flex h-6 w-full items-center justify-center rounded-md transition-colors',
                    lineStyle === ls.id
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                  onClick={() => setLineStyle(ls.id)}
                  aria-label={ls.label}
                >
                  <ls.icon className="h-3.5 w-12" />
                </button>
              ))}
            </div>
          </div>
          <div className="h-px w-12 bg-border" />
          <div className="grid grid-cols-2 gap-0.5">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={cn(
                  'h-5 w-5 rounded-sm border-2 transition-transform',
                  color === c ? 'scale-110 border-primary' : 'border-white/70',
                )}
                style={{ backgroundColor: c }}
                onClick={() => setColor(c)}
                aria-label={`颜色 ${c}`}
              />
            ))}
          </div>
          <div className="h-px w-12 bg-border" />
          <div className="flex w-full flex-col gap-1 px-1">
            <span className="text-center text-[10px] leading-none text-black">粗细</span>
            <div className="flex flex-col gap-1">
              {PEN_SIZES.map((ps) => (
                <button
                  key={ps.id}
                  type="button"
                  className={cn(
                    'flex h-6 w-full items-center justify-center rounded-md transition-colors',
                    penSize === ps.id
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                  onClick={() => setPenSize(ps.id)}
                  aria-label={ps.label}
                >
                  <ps.icon className="h-3.5 w-12" />
                </button>
              ))}
            </div>
          </div>
          </div>
          <div className="w-[5px] shrink-0" />
          <div className="w-px shrink-0 bg-border" />
        </div>

        {/* 中间画板（课件图片组作为背景，可书写） */}
        {/* 占位区贴边：右侧/左侧与分割线距离 0；顶部下移 3px、底部上移 10px（与独立窗口提示区一致） */}
        <div className="relative min-w-0 flex-1 overflow-hidden px-0 pt-[3px] pb-[10px]">
          {/* 文字工具浮动条：字体 / 字号（位于占位区下方工具条内最左边） */}
          {tool === 'text' && (
            <div className="absolute bottom-[5px] left-3 z-30 flex items-center gap-2 px-3 py-1.5">
              <label className="flex items-center gap-1 text-xs text-black">
                字体
                <select
                  className="h-7 rounded border bg-white px-1 text-xs"
                  value={fontFamily}
                  onChange={(e) => setFontFamily(e.target.value)}
                >
                  {FONT_OPTIONS.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1 text-xs text-black">
                字号
                <select
                  className="h-7 rounded border bg-white px-1 text-xs"
                  value={textSizePx}
                  onChange={(e) => setTextSizePx(Number(e.target.value))}
                >
                  {SIZE_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}px</option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {tauriMode && boardWinOk && data.settings.boardWindowMode === 'separate' ? (
            <div className="flex h-full min-h-0 flex-col">
              <div
                ref={boardPlaceholderRef}
                className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-md border bg-[#3a3a3a] p-4 text-center text-xs text-gray-300"
                style={{ marginTop: 3 }}
              >
                <p className="text-sm text-white/80">黑板已移至独立无边框窗口</p>
                <p className="text-[11px] opacity-70">
                  书写 / 课件显示在无边框黑板窗口内 · 位置随本窗口联动
                </p>
                <p className="text-[10px] opacity-50">
                  诊断：tauri:{tauriMode ? 'Y' : 'N'} · 黑板窗口:{boardWinOk ? 'Y' : 'N'} · 跟随连接:{boardAck ? 'Y' : 'N'}
                </p>
              </div>
              <div className="relative mb-[10px] flex items-center justify-end border-t bg-card px-3 py-1.5 text-xs text-black">
                {/* 中间：翻页按钮 + 时间标签（右侧挨着翻页） */}
                <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-3">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="rounded px-2 py-0.5 hover:bg-muted disabled:opacity-40"
                      disabled={page === 0}
                      onClick={() => setPage(Math.max(0, page - 1))}
                    >
                      &lt;
                    </button>
                    <span>
                      {page + 1}/{boardPageCount}
                    </span>
                    <button
                      type="button"
                      className="rounded px-2 py-0.5 hover:bg-muted disabled:opacity-40"
                      disabled={page >= boardPageCount - 1}
                      onClick={() => setPage(Math.min(boardPageCount - 1, page + 1))}
                    >
                      &gt;
                    </button>
                  </div>
                  <span className="tabular-nums">{timerText}</span>
                </div>
                {/* 最右侧：放大缩小按钮 */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      className="rounded border px-2 py-0.5 hover:bg-muted disabled:opacity-40"
                      disabled={isTiffMode || !bgImage || boardZoom <= boardFill * 0.1 + 1e-6}
                      onClick={() => pushBoardZoom(Math.max(boardFill * 0.1, +(boardZoom - boardFill * 0.1).toFixed(4)))}
                    >
                      −
                    </button>
                    <span className="w-12 text-center tabular-nums">
                      {Math.round((boardZoom / (boardFill || 1)) * 100)}%
                    </span>
                    <button
                      type="button"
                      className="rounded border px-2 py-0.5 hover:bg-muted disabled:opacity-40"
                      disabled={isTiffMode || !bgImage || boardZoom >= boardFill - 1e-6}
                      onClick={() => pushBoardZoom(Math.min(boardFill, +(boardZoom + boardFill * 0.1).toFixed(4)))}
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <BoardCanvas
              ref={boardRef}
              key={pdfForId ?? cwSelId ?? 'plain'}
              boardStyle={data.settings.boardStyle}
              customBoardImage={data.settings.customBoardImage}
              boardBackground="#3a3a3a"
              fitContainer
              tool={tool}
              color={color}
              penSize={penSize}
              lineStyle={lineStyle}
              fontFamily={fontFamily}
              textSize={textSize}
              boardAspect={
                data.settings.boardAspectMode === 'followCw'
                  ? bgImage && cwImgSize
                    ? cwImgSize.w / cwImgSize.h
                    : 878 / 494
                  : boardAspectFromSettings(data.settings)
              }
              boardAspectFree={
                data.settings.boardAspectMode === 'followCw'
                  ? !(bgImage && cwImgSize)
                  : data.settings.boardAspectMode === 'free'
              }
              currentPage={page}
              pageCount={
                mediaInfo
                  ? 1
                  : isTiffMode && tiffPages
                    ? Math.max(tiffPages.length, 1)
                    : activeImages
                      ? Math.max(activeImages.length, 1)
                      : PAGE_COUNT
              }
              bgImage={bgImage}
              penetrateNextUrl={
                isTiffMode && tiffPages && tiffPages.length > 1 ? penetrateNextUrl : null
              }
              timerText={timerText}
              onToggleShare={
                tauriMode && data.settings.boardWindowMode === 'separate'
                  ? createBoardWindow
                  : undefined
              }
              onPageChange={setPage}
              onClear={() => toast.info('本页板书已清空')}
            />
          )}
          {(!tauriMode || data.settings.boardWindowMode === 'inline') && (
            <MediaPlayer
              ref={mediaOverlayRef}
              media={mediaInfo}
              onClose={closeMedia}
              tool={tool}
              color={color}
              penSize={penSize}
              lineStyle={lineStyle}
              fontFamily={fontFamily}
              textSize={textSize}
            />
          )}
          {(!tauriMode || data.settings.boardWindowMode === 'inline') && (
            <HtmlOverlay
              ref={htmlOverlayRef}
              html={htmlInfo}
              onClose={closeHtml}
              tool={tool}
              color={color}
              penSize={penSize}
              lineStyle={lineStyle}
              fontFamily={fontFamily}
              textSize={textSize}
            />
          )}
          {pdfLoading && (pdfForId !== cwSelId || !pdfImages || pdfImages.length === 0) && (
            <div className="absolute top-5 left-1/2 z-20 -translate-x-1/2 rounded-full border bg-background/90 px-3 py-1 text-xs text-muted-foreground shadow">
              PDF 解析中…
            </div>
          )}
          {tiffLoading && (
            <div className="absolute top-5 left-1/2 z-20 -translate-x-1/2 rounded-full border bg-background/90 px-3 py-1 text-xs text-muted-foreground shadow">
              课件加载中…
            </div>
          )}
          {showPreview && previewForId === cwSelId && previewUrl && (
            <div className="absolute inset-3 z-10 flex flex-col overflow-hidden rounded-lg border bg-background shadow-xl">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
                <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                  <FileText className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate">{selectedCw?.name ?? '课件'}</span>
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="sm" variant="outline" asChild>
                    <a href={previewUrl} download={selectedCw?.file?.name ?? selectedCw?.name}>
                      <Download className="mr-1 h-3.5 w-3.5" />
                      下载
                    </a>
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowPreview(false)}>
                    <X className="mr-1 h-3.5 w-3.5" />
                    收起
                  </Button>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4">
                <FileText className="h-14 w-14 text-primary" />
                <p className="font-medium">{selectedCw?.name}</p>
                <p className="max-w-md text-center text-sm text-muted-foreground">
                  PPT 课件无法在浏览器内直接转换，请先用 PowerPoint / WPS 将其另存为
                  PDF，再上传 PDF 课件，即可在课堂页逐页展示并直接书写。
                </p>
                <Button variant="outline" asChild>
                  <a href={previewUrl} download={selectedCw?.file?.name ?? selectedCw?.name}>
                    <Download className="mr-1 h-4 w-4" />
                    下载课件
                  </a>
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* 右侧课件资料 */}
        <div className="flex w-64 shrink-0 flex-col overflow-x-hidden border-l bg-card">
          <Tabs defaultValue="all" className="flex min-h-0 flex-1 flex-col px-4 pt-3">
            <TabsList className="w-full bg-transparent">
              <TabsTrigger
                value="all"
                className="bg-transparent hover:bg-transparent data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
              >
                本课内容
              </TabsTrigger>
              <TabsTrigger
                value="prev"
                className="bg-transparent hover:bg-transparent data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
              >
                前节内容
              </TabsTrigger>
              {tauriMode && (
                <TabsTrigger
                  value="local"
                  className="bg-transparent hover:bg-transparent data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
                >
                  本机目录
                </TabsTrigger>
              )}
            </TabsList>
            <TabsContent value="prev" className="min-h-0 flex-1">
              <div className="flex h-full flex-col">
                {/* 上节课程内容 */}
                <p className="mb-1 shrink-0 pl-3 text-[13px] text-foreground">
                  上节课程内容
                </p>
                {/* 前节课件列表 */}
                <div
                  className="shrink-0 overflow-y-auto rounded-md border bg-muted/20"
                  style={{ maxHeight: '33vh' }}
                >
                  <div className="space-y-0.5 p-1.5">
                    {prevFiles.length === 0 ? (
                      <p className="py-4 text-center text-xs text-muted-foreground">暂无前节课件</p>
                    ) : (
                      prevFiles.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          className={cn(
                            'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors',
                            prevSelId === f.id
                              ? 'bg-accent font-medium text-primary'
                              : 'text-foreground hover:bg-muted',
                          )}
                          onClick={() => setPrevSelId(f.id)}
                        >
                          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{f.name}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                {/* 删除（灰度无效）+ 加入本课 */}
                <div className="my-1.5 flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled
                    className="h-6 flex-1 gap-1 px-2 text-xs opacity-40"
                  >
                    <Trash2 className="h-3 w-3" />
                    删除
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 flex-1 gap-1 px-2 text-xs"
                    disabled={!prevSelId || !prevIds.has(prevSelId)}
                    onClick={addToLesson}
                  >
                    <Plus className="h-3 w-3" />
                    加入本课
                  </Button>
                </div>

                {/* 历史课程记录：首层=课程内容（无内容用第一个课件标题），展开显示课件标题 */}
                <div className="mb-[15px] flex min-h-0 flex-1 flex-col">
                  <p className="mb-1 shrink-0 pl-3 text-[13px] text-foreground">
                    历史课程记录
                  </p>
                  <div className="min-h-0 flex-1 overflow-y-auto rounded-md border bg-muted/20">
                    <div className="space-y-0.5 p-1.5">
                      {histCourses.length === 0 ? (
                        <p className="py-3 text-center text-xs text-muted-foreground">暂无历史课程</p>
                      ) : (
                        histCourses.map((c) => {
                          const open = histOpen.has(c.id);
                          // 标题用日期时间（如 2026-10-16 08:00-09:00）；右侧显示课程内容
                          const label = `${c.date} ${c.start ?? ''}${c.end ? `-${c.end}` : ''}`.trim();
                          return (
                            <div key={c.id}>
                              <button
                                type="button"
                                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-foreground hover:bg-muted"
                                onClick={() => toggleHist(c.id)}
                              >
                                <ChevronRight
                                  className={cn(
                                    'h-3 w-3 shrink-0 text-muted-foreground transition-transform',
                                    open && 'rotate-90',
                                  )}
                                />
                                <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span className="truncate">{label}</span>
                                <span className="ml-auto max-w-[40%] shrink-0 truncate text-[10px] text-muted-foreground">
                                  {c.content}
                                </span>
                              </button>
                              {open && (
                                <div className="space-y-0.5">
                                  {(c.files ?? []).length === 0 ? (
                                    <p
                                      className="px-2 py-1 text-xs text-muted-foreground"
                                      style={{ paddingLeft: 8 + 16 }}
                                    >
                                      暂无课件
                                    </p>
                                  ) : (
                                    (c.files ?? []).map((f) => (
                                      <button
                                        key={f.id}
                                        type="button"
                                        className="flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left text-xs text-muted-foreground hover:bg-muted"
                                        style={{ paddingLeft: 8 + 16 }}
                                        onClick={() => setCwSelId(f.id)}
                                      >
                                        <FileText className="h-3 w-3 shrink-0" />
                                        <span className="truncate">{f.name}</span>
                                      </button>
                                    ))
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="local" className="min-h-0 flex-1">
              <div className="flex h-full flex-col gap-1.5">
                {/* 目录 标签 + 下拉框 */}
                <div className="flex items-center gap-1 pl-3">
                  <Label className="w-10 shrink-0 text-[13px] text-foreground">目录</Label>
                  <Select
                    value={curRoot}
                    onValueChange={(v) => {
                      localStorage.setItem(`skey_imp_root_${studentId}`, v);
                      void loadImpRoot(v);
                    }}
                  >
                    <SelectTrigger className="!h-[26px] !min-h-[26px] !py-0 flex-1 text-xs">
                      <SelectValue placeholder="选择课件目录" />
                    </SelectTrigger>
                    <SelectContent>
                      {roots.length === 0 ? (
                        <p className="px-2 py-1.5 text-xs text-muted-foreground">暂无目录</p>
                      ) : (
                        roots.map((r) => (
                          <SelectItem key={r.path} value={r.path} className="text-xs">
                            {r.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1 pl-3">
                  <Label className="w-10 shrink-0 text-[13px] text-foreground">版本</Label>
                  <Select
                    value={selVer ?? ''}
                    onValueChange={pickVer}
                    disabled={verList.length === 0}
                  >
                    <SelectTrigger className="!h-[26px] !min-h-[26px] !py-0 flex-1 text-xs">
                      <SelectValue placeholder="选择版本" />
                    </SelectTrigger>
                    <SelectContent>
                      {verList.map((v) => (
                        <SelectItem key={v} value={v} className="text-xs">
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1 pl-3">
                  <Label className="w-10 shrink-0 text-[13px] text-foreground">年级</Label>
                  <Select
                    value={selGrade ?? ''}
                    onValueChange={pickGrade}
                    disabled={gradeList.length === 0}
                  >
                    <SelectTrigger className="!h-[26px] !min-h-[26px] !py-0 flex-1 text-xs">
                      <SelectValue placeholder="选择年级" />
                    </SelectTrigger>
                    <SelectContent>
                      {gradeList.map((g) => (
                        <SelectItem key={g} value={g} className="text-xs">
                          {g}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1 pl-3">
                  <Label className="w-10 shrink-0 text-[13px] text-foreground">学期</Label>
                  <Select
                    value={selSem ?? ''}
                    onValueChange={(s) => setSelSem(s)}
                    disabled={semList.length === 0}
                  >
                    <SelectTrigger className="!h-[26px] !min-h-[26px] !py-0 flex-1 text-xs">
                      <SelectValue placeholder="选择学期" />
                    </SelectTrigger>
                    <SelectContent>
                      {semList.map((s) => (
                        <SelectItem key={s} value={s} className="text-xs">
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/* 树状图：随下拉联动显示当前学期下内容，根目录(第一层)默认展开；自适应窗口高度 */}
                <div className="min-h-0 flex-1 overflow-y-auto rounded-md border bg-muted/20">
                  <div className="space-y-0.5 p-1.5">
                    {!impTree ? (
                      <p className="py-4 text-center text-xs text-muted-foreground">
                        {roots.length === 0 ? '请先添加课件目录' : '选择课件目录加载'}
                      </p>
                    ) : impTree.length === 0 ? (
                      <p className="py-4 text-center text-xs text-muted-foreground">未发现课件文件</p>
                    ) : !curSem ? (
                      <p className="py-4 text-center text-xs text-muted-foreground">
                        该层级下暂无学期课件
                      </p>
                    ) : (
                      renderImpTree(curSem.nodes, 0, 'sem')
                    )}
                  </div>
                </div>
                {/* 加入课堂：把选中的本机课件加入本课课件列表 */}
                <Button
                  size="sm"
                  className="mb-[15px] h-7 w-full shrink-0 gap-1 text-xs"
                  disabled={!selImpNode}
                  onClick={addToClassroom}
                >
                  <Plus className="h-3 w-3" />
                  加入课堂
                </Button>
              </div>
            </TabsContent>
            <TabsContent value="all" className="min-h-0 flex-1">
              <div className="flex h-full flex-col">
                {/* 课件列表：高度自适应，最多占屏幕 1/3 */}
                <div
                  className="shrink-0 overflow-y-auto rounded-md border bg-muted/20"
                  style={{ maxHeight: '33vh' }}
                >
                  <div className="space-y-0.5 p-1.5">
                    <button
                      type="button"
                      className={cn(
                        'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors',
                        !cwSelId && pdfForId == null
                          ? 'bg-accent font-medium text-primary'
                          : 'text-foreground hover:bg-muted',
                      )}
                      onClick={showBlackboard}
                    >
                      <MonitorPlay className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">黑板</span>
                    </button>
                    {lessonFiles.length === 0 ? (
                      <p className="py-4 text-center text-xs text-muted-foreground">
                        暂无课件，请点击「添加课件」
                      </p>
                    ) : (
                      lessonFiles.map((f) => {
                        const parsing = parsingIds.has(f.id);
                        return (
                          <button
                            key={f.id}
                            type="button"
                            disabled={parsing}
                            className={cn(
                              'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors',
                              parsing
                                ? 'cursor-not-allowed opacity-50'
                                : cwSelId === f.id
                                  ? 'bg-accent font-medium text-primary'
                                  : 'text-foreground hover:bg-muted',
                            )}
                            onClick={() => !parsing && setCwSelId(f.id)}
                          >
                            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{f.name}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* 删除课件 添加课件 */}
                <div className="my-1.5 flex shrink-0 items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 flex-1 gap-1 px-2 text-xs"
                    onClick={deleteCourseware}
                  >
                    <Trash2 className="h-3 w-3" />
                    删除课件
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 flex-1 gap-1 px-2 text-xs"
                    onClick={() => {
                      if (tauriMode) void openAddCoursewareWindow();
                      else setAddCwOpen(true);
                    }}
                  >
                    <Plus className="h-3 w-3" />
                    添加课件
                  </Button>
                </div>

                {/* 当前打开课件页码表 */}
                <div className="mb-[15px] min-h-0 flex-1 overflow-y-auto rounded-md border bg-muted/20">
                  <div className="p-1.5">
                    <p className="mb-1 text-[13px] text-foreground">
                      当前打开课件页码
                    </p>
                    {isTiffMode && tiffPages ? (
                      <div className="grid grid-cols-5 gap-1 p-1 pb-2">
                        {tiffPages.map((f, i) => (
                          <button
                            key={f.index}
                            type="button"
                            onClick={() => setPage(i)}
                            className={cn(
                              'aspect-square w-full rounded text-[11px] font-medium transition-colors',
                              page === i
                                ? 'bg-primary text-primary-foreground'
                                : f.kind === '问题'
                                  ? 'bg-slate-300 text-black hover:bg-slate-400'
                                  : 'bg-muted/40 text-foreground hover:bg-muted',
                            )}
                          >
                            {i + 1}
                          </button>
                        ))}
                      </div>
                    ) : pdfImages && pdfImages.length > 0 ? (
                      // PDF/图片课件：与 TIFF 一致只显示页码序号，不做问题页等验证
                      <div className="grid grid-cols-5 gap-1 p-1 pb-2">
                        {pdfImages.map((_, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setPage(i)}
                            className={cn(
                              'aspect-square w-full rounded text-[11px] font-medium transition-colors',
                              page === i
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted/40 text-foreground hover:bg-muted',
                            )}
                          >
                            {i + 1}
                          </button>
                        ))}
                      </div>
                    ) : currentOpenDir ? (
                      <div className="space-y-0.5">
                        {currentOpenDir.map((seg, i) => (
                          <div
                            key={`${i}-${seg}`}
                            className="truncate text-xs text-foreground"
                            style={{ paddingLeft: i * 14 }}
                          >
                            {i === currentOpenDir.length - 1 ? (
                              <span className="font-medium text-primary">{seg}</span>
                            ) : (
                              seg
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="py-2 text-center text-xs text-muted-foreground">
                        未打开本机课件
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* 添加课件弹窗（支持上传 PPT/PDF/图片）：桌面端为课堂窗口子窗口（显示顺序高于黑板） */}
      <Dialog
        open={addCwOpen}
        onOpenChange={(v) => {
          setAddCwOpen(v);
          if (!v) setPickedFile(null);
        }}
      >
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>添加课件</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label>选择文件（支持 PDF / PPT / 图片，PPT 将自动转换为 PDF）</Label>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start"
              disabled={pptConverting}
              onClick={pickCoursewareFile}
            >
              {pptConverting ? (
                <>
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  PPT 转换中…
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 shrink-0" />
                  <span className="truncate">
                    {pickedFile ? pickedFile.name : '选择本地课件文件'}
                  </span>
                </>
              )}
            </Button>
            <input
              ref={cwFileInputRef}
              type="file"
              accept=".pdf,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.tif,.tiff,.mp4,.webm,.mov,.avi,.mkv,.flv,.wmv,.mp3,.wav,.m4a,.flac,.ogg,.aac,.html,.htm"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setPickedFile(f);
                if (f) setNewName(f.name.replace(/\.[^.]+$/, ''));
                e.target.value = '';
              }}
            />
            <div className="space-y-1.5 pt-1">
              <Label>课件名称</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCourseware()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddCwOpen(false)}>
              取消
            </Button>
            <Button onClick={addCourseware}>添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
