// EXPORTS: IStudent, ICourse, IRecharge, IScheduleItem, IScoreEntry, ISummary, ISettings, IAnnouncement, ICourseNode, IAppData, IAuthUser

export interface IStudent {
  id: string;
  name: string;
  gender: '男' | '女';
  boardColor: string; // 课表底色
  grade: string; // 年级（后续会动态变化）
  textbook: string; // 教材版本
  other: string; // 其他信息
  price: number; // 课时价格（元/小时）
  referrer: string; // 推荐人
  referralRule: string; // 推荐规则
  rechargeTotal: number; // 累计充值
  usedHours: number; // 已上课时
  remainingHours: number; // 剩余课时
  note: string; // 备注
}

export interface ISummary {
  content: string; // 上课内容
  knowledge: string; // 涉及知识点
  behavior: number; // 课堂表现 1-5
  mastery: number; // 掌握情况 1-5
  homework: number; // 上节作业 1-5
}

export interface ICourse {
  id: string;
  studentId: string;
  date: string; // YYYY-MM-DD
  start: string; // HH:mm
  durationMin: number;
  content: string; // 上课内容
  remark: string; // 备注
  done: boolean; // 完成
  prep: boolean; // 备课
  summary?: ISummary; // 课堂总结
  /** 本节课使用的课件/图片等文件（含本机路径；随 courses 同步到云端，换机可恢复目录） */
  files?: ICourseNode[];
}

export interface IRecharge {
  id: string;
  studentId: string;
  time: string; // YYYY-MM-DD HH:mm
  amount: number;
  method: string; // 微信 / 支付宝 / 现金 / 银行卡
  note: string;
}

export interface IScheduleItem {
  id: string;
  table: 1 | 2; // 课表1 / 课表2
  date?: string; // YYYY-MM-DD 具体日期（可选，周课表条目）
  weekday: number; // 1-7 周一至周日
  startHour: number;
  startMin: number;
  endHour: number;
  endMin: number;
  studentId: string;
  content: string;
  done: boolean;
}

export interface IScoreEntry {
  date: string; // YYYY-MM
  score: number; // 0-100
}

export interface ISettings {
  skipCoursewareHome: boolean; // 跳过课件首页
  hideQuestionTimeRegion: boolean; // 隐藏题目时间地域
  hideQuestionInfo: boolean; // 隐藏题目信息
  showAnswer: boolean; // 显示题目答案
  showPageRemark: boolean; // 显示页面备注
  enableNextPreview: boolean; // 启用下页预览
  boardStyle: 'white' | 'black' | 'green' | 'custom'; // 白板/黑板/边框绿版/自定义背景板
  customBoardImage?: string; // 自定义背景板图片（dataURL，选中 custom 时作为黑板背景）
  boardAspectMode: '16:9' | '9:16' | '4:3' | 'free' | 'custom' | 'followCw'; // 黑板画面比例；9:16=210:297 A4纸尺寸（竖版资料）；free=动态比例（跟随窗口）；followCw=动态比例（跟随课件，无课件按自由满铺）；custom=自定义宽高
  freeBoardAspectW?: number; // 自定义比例：宽
  freeBoardAspectH?: number; // 自定义比例：高
  boardWindowMode: 'separate' | 'inline'; // 黑板窗口模式：独立黑板窗口（方便腾讯会议共享）/ 课堂黑板一体
  answerWindowTop: boolean; // 答案窗口置顶
  coursewareWindowTop: boolean; // 课件显示界面置顶
  addCoursewareInClass: boolean; // 添加课件页面在课堂窗口内打开
}

export interface IAnnouncement {
  title: string;
  content: string;
  expireAt: string;
}

export interface ICourseFileMeta {
  name: string;
  size: number;
  mime: string;
  /** 本机课件路径（Tauri 目录导入）；为空则文件本体存 IndexedDB（key = id） */
  path?: string;
}

export interface ICourseNode {
  id: string;
  name: string;
  type: 'folder' | 'file';
  children?: ICourseNode[];
  file?: ICourseFileMeta | null; // 文件课件：元数据，文件本体存 IndexedDB（key = id）或本机 path
}

export interface IAppData {
  students: IStudent[];
  archivedStudents: IStudent[];
  courses: ICourse[];
  recharges: IRecharge[];
  schedule: IScheduleItem[];
  scores: Record<string, IScoreEntry[]>;
  settings: ISettings;
  announcement: IAnnouncement;
  courseware: Record<string, ICourseNode[]>; // key = 版本|年级|学期
  accounts: { username: string; password: string; name: string }[];
}

export interface IAuthUser {
  username: string;
  name: string;
}
