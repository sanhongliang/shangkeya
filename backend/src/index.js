// 上课鸭 云服务端入口
import express from 'express';
import cors from 'cors';
import 'dotenv/config';

import authRoutes from './routes/auth.js';
import studentsRoutes from './routes/students.js';
import coursesRoutes from './routes/courses.js';
import scheduleRoutes from './routes/schedule.js';
import rechargesRoutes from './routes/recharges.js';
import cardsRoutes, { redeemHandler } from './routes/cards.js';
import miscRoutes from './routes/misc.js';
import desktopRoutes from './routes/desktop.js';
import { requireAuth } from './auth.js';
import { startHolidayScheduler } from './holiday-blessing.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// 健康检查
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// 公开：登录 / 卡密兑换（未登录可用账号密码自救续期）
app.use('/api/auth', authRoutes);
app.post('/api/cards/redeem', redeemHandler);

// 以下全部需要登录
app.use('/api/students', requireAuth, studentsRoutes);
app.use('/api/courses', requireAuth, coursesRoutes);
app.use('/api/schedule', requireAuth, scheduleRoutes);
app.use('/api/recharges', requireAuth, rechargesRoutes);
app.use('/api/cards', requireAuth, cardsRoutes);
app.use('/api/desktop', requireAuth, desktopRoutes);
app.use('/api', requireAuth, miscRoutes); // scores / announcements / settings

// 404
app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } }));

// 错误兜底
// eslint-disable-next-line no-unused-vars
app.use((e, _req, res, _next) => {
  console.error('[api error]', e);
  res.status(500).json({ error: { code: 'INTERNAL', message: '服务器内部错误' } });
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`shangkeya API listening on http://0.0.0.0:${PORT}`);
  // 节假日节日祝福公告定时推送
  startHolidayScheduler();
});
