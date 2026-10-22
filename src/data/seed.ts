// EXPORTS: buildSeed, DEFAULT_SETTINGS
import type {
  IAppData,
  ICourse,
  ICourseNode,
  IRecharge,
  IScheduleItem,
  IScoreEntry,
  ISettings,
  IStudent,
} from './types';

export const DEFAULT_SETTINGS: ISettings = {
  skipCoursewareHome: false,
  hideQuestionTimeRegion: false,
  hideQuestionInfo: false,
  showAnswer: false,
  showPageRemark: false,
  enableNextPreview: true,
  boardStyle: 'green',
  boardAspectMode: '16:9', // 16:9 = 878:494（当前写好的黑板比例）；9:16 = 494:878 竖板资料
  freeBoardAspectW: 878,
  freeBoardAspectH: 494,
  boardWindowMode: 'separate',
  answerWindowTop: true,
  coursewareWindowTop: false,
  addCoursewareInClass: true,
};

const TEXTBOOKS = ['通用版', '新人教版', '上海专用', '浙江专用', '鲁科版', '粤教版'];
const GRADES = ['高一', '高二', '高三'];
const PRICES = [150, 130, 160, 180, 140, 170];

const STUDENT_NAMES = [
  '张一诺', '李沐宸', '王子涵', '刘思远', '陈嘉禾', '杨子萱', '赵宇航', '孙语彤', '周浩然', '吴梦琪',
  '郑博文', '王诗涵', '冯俊熙', '蒋雨欣', '沈天佑', '韩欣怡', '秦朗', '许静怡', '何俊杰', '罗晓彤',
  '林晨曦', '徐嘉怡', '胡宇轩', '郭雨桐', '高子墨', '梁静怡', '宋致远', '唐可欣',
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 返回相对今天偏移 offset 天的 YYYY-MM-DD */
function day(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function buildStudents(): IStudent[] {
  return STUDENT_NAMES.map((name, i) => {
    const fromYao = /姚/.test(name);
    return {
      id: `s${i + 1}`,
      name,
      gender: i % 3 === 0 ? '女' : '男',
      boardColor: ['#1677ff', '#52c41a', '#fa8c16', '#722ed1', '#13c2c2'][i % 5],
      grade: GRADES[i % 3],
      textbook: TEXTBOOKS[i % 6],
      other: i === 0 ? '试听学员' : '',
      price: PRICES[i % 6],
      referrer: fromYao ? '姚尧' : '',
      referralRule: fromYao ? '10%' : '',
      rechargeTotal: 4800 + i * 1400,
      usedHours: Math.round((18 + i * 3.4) * 10) / 10,
      remainingHours: 36 + i * 2.5,
      note: i === 1 ? '续费客户' : '',
    };
  });
}

const CONTENT_POOL = [
  '速度变化快慢的描述——加速度',
  '质点_参考系',
  '机械能守恒定律【提高版】',
  '运动的描述【提高版】',
  '位移、时间和时刻【提高版】',
  '匀速直线运动位移与时间的关系【提高版】',
  '电磁感应中的能量问题【基础版】',
  '电路和电路图【基础版】',
  '浮力的计算专题【提高版】',
  '牛顿第一定律',
  '万有引力理论的成就——题型',
  '力与运动的联系',
];

// [offsetDays, hour, min, durationMin, studentIndex, contentIndex, done, prep]
type CourseSpec = [number, number, number, number, number, number, boolean, boolean];

const COURSE_SPECS: CourseSpec[] = [
  [0, 8, 0, 60, 0, 0, false, true],
  [0, 13, 0, 60, 14, 2, false, true],
  [0, 15, 0, 60, 13, 3, false, true],
  [-1, 19, 0, 60, 0, 1, true, true],
  [-2, 13, 0, 60, 14, 4, true, true],
  [-2, 15, 0, 60, 13, 6, true, true],
  [-3, 10, 0, 60, 1, 7, true, true],
  [-4, 16, 0, 40, 2, 8, true, true],
  [-5, 9, 0, 60, 3, 9, false, false],
  [-7, 20, 0, 40, 0, 10, true, true],
  [-10, 14, 0, 60, 4, 11, true, true],
  [-13, 11, 0, 60, 5, 1, false, false],
  [-16, 18, 0, 60, 6, 0, true, true],
  [-20, 15, 0, 60, 7, 2, true, true],
  [-25, 19, 0, 60, 0, 4, true, true],
  [-30, 10, 0, 60, 8, 7, true, true],
  [-45, 16, 0, 60, 9, 9, true, true],
  [-60, 14, 0, 60, 10, 6, true, true],
  [-90, 9, 0, 60, 0, 10, true, true],
  [-120, 19, 0, 60, 11, 0, true, true],
  [-150, 15, 0, 60, 12, 3, true, true],
  [-180, 20, 0, 60, 0, 2, true, true],
  [-220, 13, 0, 60, 14, 4, true, true],
  [-260, 15, 0, 60, 13, 11, true, true],
  [-300, 10, 0, 60, 15, 7, true, true],
  [-340, 19, 0, 60, 0, 1, true, true],
  [-400, 14, 0, 60, 16, 8, true, true],
];

function buildCourses(): ICourse[] {
  return COURSE_SPECS.map((spec, i) => {
    const [offset, hour, min, dur, stuIdx, contentIdx, done, prep] = spec;
    return {
      id: `c${i + 1}`,
      studentId: `s${stuIdx + 1}`,
      date: day(offset),
      start: `${pad2(hour)}:${pad2(min)}`,
      durationMin: dur,
      content: CONTENT_POOL[contentIdx],
      remark: '',
      done,
      prep,
      summary: done && i < 6 ? { content: CONTENT_POOL[contentIdx], knowledge: '核心概念与题型训练', behavior: 4, mastery: 4, homework: 4 } : undefined,
    };
  });
}

function buildRecharges(): IRecharge[] {
  const specs: [number, number, string, string, number, string][] = [
    [-11, 10, '00', '微信', 6000, '续费'],
    [-7, 15, '00', '支付宝', 3600, '新开课'],
    [-24, 11, '00', '微信', 4800, '续费'],
    [-4, 20, '00', '现金', 3000, ''],
    [-19, 9, '00', '微信', 7200, '年卡'],
    [-1, 18, '00', '支付宝', 5400, ''],
  ];
  return specs.map((spec, i) => {
    const [offset, hour, min, method, amount, note] = spec;
    return {
      id: `r${i + 1}`,
      studentId: `s${[0, 1, 2, 3, 14, 13][i] + 1}`,
      time: `${day(offset)} ${pad2(hour)}:${min}`,
      amount,
      method,
      note,
    };
  });
}

// [table, weekday, startHour, startMin, durationMin, studentIndex, contentIndex]
type ScheduleSpec = [1 | 2, number, number, number, number, number, number];

const SCHEDULE_SPECS: ScheduleSpec[] = [
  [1, 6, 9, 0, 60, 1, 1],
  [1, 7, 14, 0, 60, 2, 0],
  [1, 4, 19, 0, 60, 3, 2],
  [1, 5, 16, 0, 60, 4, 4],
  [2, 3, 8, 0, 60, 0, 0],
  [2, 1, 13, 0, 60, 14, 2],
  [2, 2, 13, 0, 60, 14, 2],
  [2, 1, 15, 0, 60, 13, 3],
  [2, 2, 15, 0, 60, 13, 3],
  [2, 6, 10, 0, 60, 1, 7],
];

function buildSchedule(): IScheduleItem[] {
  return SCHEDULE_SPECS.map((spec, i) => {
    const [table, weekday, startHour, startMin, dur, stuIdx, contentIdx] = spec;
    const endTotal = startHour * 60 + startMin + dur;
    return {
      id: `k${i + 1}`,
      table,
      weekday,
      startHour,
      startMin,
      endHour: Math.floor(endTotal / 60),
      endMin: endTotal % 60,
      studentId: `s${stuIdx + 1}`,
      content: CONTENT_POOL[contentIdx],
      done: false,
    };
  });
}

function nameCode(name: string): number {
  let sum = 0;
  for (let i = 0; i < name.length; i += 1) sum += name.charCodeAt(i);
  return sum;
}

function buildScores(): Record<string, IScoreEntry[]> {
  const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
  const out: Record<string, IScoreEntry[]> = {};
  STUDENT_NAMES.forEach((name, i) => {
    const base = nameCode(name);
    const entries = months.map((m, j) => ({
      date: m,
      score: Math.min(98, Math.max(58, 62 + ((base + i * 7 + j * 13) % 34))),
    }));
    if (i === 0) {
      out[`s${i + 1}`] = [
        { date: '2026-04', score: 68 },
        { date: '2026-05', score: 74 },
        { date: '2026-06', score: 81 },
        { date: '2026-07', score: 88 },
        { date: '2026-08', score: 92 },
        { date: '2026-09', score: 95 },
      ];
    } else {
      out[`s${i + 1}`] = entries;
    }
  });
  return out;
}

const COURSEWARE_BRANCH = '1通用版|1高一|1暑期';

function buildCourseware(): Record<string, ICourseNode[]> {
  return {
    [COURSEWARE_BRANCH]: [
      {
        id: 'w1',
        name: '1_衔接',
        type: 'folder',
        children: [
          { id: 'w1-1', name: '1.数学要求及复习', type: 'file' },
          { id: 'w1-2', name: '2.物体的运动', type: 'file' },
          { id: 'w1-3', name: '3.认识生活中常见的力', type: 'file' },
          { id: 'w1-4', name: '4.力与运动的联系', type: 'file' },
        ],
      },
      {
        id: 'w2',
        name: '2_力学基础',
        type: 'folder',
        children: [
          { id: 'w2-1', name: '1.质点_参考系', type: 'file' },
          { id: 'w2-2', name: '2.速度变化快慢的描述——加速度', type: 'file' },
        ],
      },
      {
        id: 'w3',
        name: '3_专题提高',
        type: 'folder',
        children: [
          { id: 'w3-1', name: '机械能守恒定律【提高版】', type: 'file' },
          { id: 'w3-2', name: '电磁感应中的能量问题【基础版】', type: 'file' },
        ],
      },
    ],
  };
}

export function buildSeed(): IAppData {
  return {
    students: buildStudents(),
    archivedStudents: [],
    courses: buildCourses(),
    recharges: buildRecharges(),
    schedule: buildSchedule(),
    scores: buildScores(),
    settings: { ...DEFAULT_SETTINGS },
    announcement: { title: '公告', content: '欢迎使用', expireAt: '2032-11-24 10:20:52' },
    courseware: buildCourseware(),
    accounts: [{ username: 'teacher', password: '123456', name: '姚老师' }],
  };
}
