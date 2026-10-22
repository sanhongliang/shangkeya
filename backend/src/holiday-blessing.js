// 节假日节日祝福公告：每天检查当天是否节假日，若是则自动写入公告（去重：同日同节日只推一次）
import { Solar, Lunar } from 'lunar-javascript';
import { query } from './db.js';

// 节日祝福语表（key 为节日名，与 lunar-javascript 返回的节日名/节气名匹配）
const BLESSINGS = {
  元旦节: { title: '元旦快乐', content: '元旦快乐！新的一年，祝您工作顺利、万事如意、身体健康！' },
  除夕: { title: '除夕快乐', content: '除夕快乐！辞旧迎新，愿您阖家团圆、岁岁平安、新春纳福！' },
  春节: { title: '新春快乐', content: '新春快乐！祝您阖家幸福、财源广进，新的一年万事如意、桃李满园！' },
  元宵节: { title: '元宵节快乐', content: '元宵节快乐！祝您团团圆圆、甜甜蜜蜜，生活美满！' },
  龙头节: { title: '龙抬头快乐', content: '二月二龙抬头！愿您鸿运当头、精神抖擞，一年顺遂！' },
  清明: { title: '清明安康', content: '清明时节，愿您与家人平安健康，缅怀过去，珍惜当下！' },
  劳动节: { title: '劳动节快乐', content: '五一劳动节快乐！辛苦了，祝您假期愉快、劳逸结合！' },
  端午节: { title: '端午安康', content: '端午安康！愿您和家人幸福平安，粽叶飘香、情意绵长！' },
  七夕节: { title: '七夕快乐', content: '七夕节快乐！愿您爱情甜蜜、生活美满、幸福常伴！' },
  中秋节: { title: '中秋快乐', content: '中秋节快乐！愿您阖家团圆、幸福美满，月圆人更圆！' },
  国庆节: { title: '国庆快乐', content: '国庆节快乐！祝您假期愉快，祝愿祖国繁荣昌盛、家国同庆！' },
  重阳节: { title: '重阳安康', content: '重阳节快乐！祝您和家中长辈健康长寿、福寿安康！' },
  圣诞节: { title: '圣诞快乐', content: '圣诞快乐！愿您心想事成、幸福安康，收获满满的喜悦！' },
  情人节: { title: '情人节快乐', content: '情人节快乐！愿您爱情甜蜜、幸福美满！' },
  妇女节: { title: '妇女节快乐', content: '妇女节快乐！愿您青春常驻、美丽绽放，被世界温柔以待！' },
  儿童节: { title: '儿童节快乐', content: '儿童节快乐！愿孩子们健康快乐成长，童心未泯、梦想成真！' },
  教师节: { title: '教师节快乐', content: '教师节快乐！桃李满天下、春晖遍四方，感谢您的辛勤付出！' },
  腊八节: { title: '腊八快乐', content: '腊八节快乐！一碗腊八粥，暖身更暖心，祝您幸福安康！' },
};

const ORG_ID = 1;

/** 返回当天命中的节日名数组（公历节日 + 农历节日 + 清明节气） */
export function holidaysOf(date = new Date()) {
  const names = new Set();
  try {
    for (const f of Solar.fromDate(date).getFestivals() || []) names.add(f);
  } catch (e) { /* 忽略 */ }
  try {
    for (const f of Lunar.fromDate(date).getFestivals() || []) names.add(f);
  } catch (e) { /* 忽略 */ }
  try {
    const jq = Lunar.fromDate(date).getJieQi();
    if (jq) names.add(jq); // 节气名：如 清明 / 冬至 等
  } catch (e) { /* 忽略 */ }
  return [...names].filter((n) => n && BLESSINGS[n]);
}

/** 检查并推送当天节日祝福公告（幂等：同日同节日只推一次） */
export async function pushHolidayBlessing(now = new Date()) {
  const d = new Date(now);
  const dateStr =
    d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const names = holidaysOf(d);
  if (!names.length) return { pushed: [] };
  const pushed = [];
  for (const name of names) {
    const b = BLESSINGS[name];
    try {
      const dup = await query(
        `SELECT 1 FROM announcements WHERE org_id = $1 AND active AND payload->>'holiday' = $2 AND payload->>'date' = $3 LIMIT 1`,
        [ORG_ID, name, dateStr],
      );
      if (dup.rows.length) continue;
      await query(
        `INSERT INTO announcements (org_id, title, content, payload) VALUES ($1,$2,$3,$4)`,
        [
          ORG_ID,
          b.title,
          b.content,
          JSON.stringify({ expireAt: dateStr + ' 23:59', holiday: name, date: dateStr, source: 'auto' }),
        ],
      );
      pushed.push(name);
      console.log('[holiday-blessing] pushed', name, dateStr);
    } catch (e) {
      console.error('[holiday-blessing] fail', name, e?.message ?? e);
    }
  }
  return { pushed };
}

/** 每小时调度：8:00 检查一次当天节日 */
export function startHolidayScheduler(now = new Date()) {
  // 启动后 5 秒先检查一次（避免重启当天错过）
  const run = () => {
    pushHolidayBlessing().catch((e) => console.error('[holiday-blessing] scheduler', e?.message ?? e));
  };
  setTimeout(run, 5000);
  // 每小时检查一次，小时为 8 时执行（可覆盖跨天/时区变化）
  setInterval(() => {
    if (new Date().getHours() === 8) run();
  }, 60 * 60 * 1000);
  // 启动日志
  const h = holidaysOf(now);
  console.log('[holiday-blessing] scheduler started, today holidays:', h.length ? h.join('、') : '无');
}
