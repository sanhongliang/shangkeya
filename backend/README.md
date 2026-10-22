# 上课鸭 云服务端

课件本地、业务数据上云（PostgreSQL）的服务端：学员/课程/课表/充值/成绩/公告/设置 REST API。

## 技术栈
Node.js + Express + pg + JWT(bcrypt)

## 本地开发（无需安装 PostgreSQL）

```bash
npm install
npm run db:init -- --embedded   # 启动嵌入式 PG（.pgdata 目录）并建库建表
node scripts/seed-admin.js admin admin123 管理员   # 需要嵌入式 PG 运行时执行；或先跑后端再连
npm run dev                       # 启动 API（端口 3000）
```

注意：嵌入式 PG 由 `db-init --embedded` 启动后随即停止（每次跑脚本临时起停）。连本地嵌入 PG 开发时，
需同时跑一个常驻嵌入式 PG 进程：见 `scripts/embedded-pg.js`。

## 生产部署（Linux 服务器）

```bash
# 1. 安装 PostgreSQL，创建库和账号
sudo apt install postgresql postgresql-client
sudo -u postgres createuser --pwprompt shangkeya
sudo -u postgres createdb -O shangkeya shangkeya

# 2. 配置环境变量（backend/.env）
PGHOST=localhost
PGPORT=5432
PGDATABASE=shangkeya
PGUSER=shangkeya
PGPASSWORD=********
PORT=3000
JWT_SECRET=<随机长字符串>

# 3. 建表 + 初始管理员
npm run db:init
node scripts/seed-admin.js admin <初始密码> 管理员

# 4. 运行（systemd 或 PM2）
npm start
```

## API 一览（前缀 /api，除 /auth/login 外均需 `Authorization: Bearer <jwt>`）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/auth/login | 登录 |
| POST | /api/auth/change-password | 修改密码 |
| GET/POST | /api/students | 学员列表/新增 |
| PUT/DELETE | /api/students/:id | 编辑/删除学员 |
| GET/POST | /api/courses | 课程列表/新增 |
| PUT/DELETE | /api/courses/:id | 编辑/删除课程 |
| GET/POST | /api/schedule | 课表查询/新增课次 |
| PUT/DELETE | /api/schedule/:id | 编辑/删除课次 |
| GET/POST | /api/recharges | 充值扣费记录/操作 |
| GET/POST | /api/scores | 成绩 |
| DELETE | /api/scores/:id | 删除成绩 |
| GET/POST | /api/announcements | 公告 |
| PUT/DELETE | /api/announcements/:id | 编辑/删除公告 |
| GET/PUT | /api/settings | 机构设置（JSONB） |
