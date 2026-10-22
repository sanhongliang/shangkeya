-- 上课鸭 数据库建表（PostgreSQL）
-- 库：shangkeya（执行前 CREATE DATABASE shangkeya;）
-- 说明：业务数据（学员/课程/课表/充值/成绩/公告/设置）上云；课件留本地不入库。

-- 账号
CREATE TABLE IF NOT EXISTS accounts (
  id            BIGSERIAL PRIMARY KEY,
  org_id        BIGINT DEFAULT 1,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,                 -- bcrypt
  name          TEXT,
  role          TEXT DEFAULT 'teacher',        -- teacher/admin
  active        BOOLEAN DEFAULT true,
  expires_at    TIMESTAMPTZ,                   -- 账号到期时间（注册送7天试用，卡密续期）
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- 学员
CREATE TABLE IF NOT EXISTS students (
  id            BIGSERIAL PRIMARY KEY,
  org_id        BIGINT DEFAULT 1,
  name          TEXT NOT NULL,
  phone         TEXT,
  grade         TEXT,
  school        TEXT,
  parent_phone  TEXT,
  notes         TEXT,
  balance       NUMERIC(12,2) DEFAULT 0,       -- 剩余课时/余额
  payload       JSONB DEFAULT '{}',            -- 前端扩展字段（gender/boardColor 等，透传）
  active        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_students_org ON students(org_id);

-- 课程
CREATE TABLE IF NOT EXISTS courses (
  id            BIGSERIAL PRIMARY KEY,
  org_id        BIGINT DEFAULT 1,
  name          TEXT NOT NULL,
  subject       TEXT,
  grade         TEXT,
  duration_min  INTEGER DEFAULT 60,
  price         NUMERIC(12,2),
  notes         TEXT,
  payload       JSONB DEFAULT '{}',            -- 前端扩展字段
  active        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_courses_org ON courses(org_id);

-- 课表（核心：手机端查看/编辑）
CREATE TABLE IF NOT EXISTS schedule (
  id            BIGSERIAL PRIMARY KEY,
  org_id        BIGINT DEFAULT 1,
  student_id    BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_id     BIGINT REFERENCES courses(id) ON DELETE SET NULL,  -- 课程可空
  start_at      TIMESTAMPTZ NOT NULL,
  end_at        TIMESTAMPTZ NOT NULL,
  teacher_id    BIGINT REFERENCES accounts(id),
  status        TEXT DEFAULT 'scheduled',      -- scheduled/done/canceled/absent
  notes         TEXT,
  payload       JSONB DEFAULT '{}',            -- 前端扩展字段（prep/summary 等）
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_schedule_start ON schedule(org_id, start_at);
CREATE INDEX IF NOT EXISTS idx_schedule_student ON schedule(org_id, student_id);

-- 周课表模板（桌面端 IScheduleItem；手机端不涉及）
CREATE TABLE IF NOT EXISTS week_schedule (
  id            BIGSERIAL PRIMARY KEY,
  org_id        BIGINT DEFAULT 1,
  payload       JSONB NOT NULL DEFAULT '{}',   -- 整条前端 IScheduleItem
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_week_schedule_org ON week_schedule(org_id);

-- 充值/扣费
CREATE TABLE IF NOT EXISTS recharges (
  id            BIGSERIAL PRIMARY KEY,
  org_id        BIGINT DEFAULT 1,
  student_id    BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  amount        NUMERIC(12,2) NOT NULL,
  type          TEXT DEFAULT 'recharge',       -- recharge/consume/refund
  note          TEXT,
  payload       JSONB DEFAULT '{}',            -- 前端扩展字段（method 等）
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recharges_student ON recharges(org_id, student_id);

-- 充值卡（学习鸭方式：卡密给老师账号续期，管理后台生成，老师端凭卡号兑换）
CREATE TABLE IF NOT EXISTS cards (
  id            BIGSERIAL PRIMARY KEY,
  org_id        BIGINT DEFAULT 1,
  code          TEXT NOT NULL UNIQUE,           -- 卡号 XXXX-XXXX-XXXX-XXXX
  duration_days INTEGER NOT NULL DEFAULT 30,    -- 续期天数（周7/月30/半年180/年365）
  status        TEXT DEFAULT 'unused',          -- unused/used/disabled
  used_by       BIGINT,                          -- 使用老师账号 id
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cards_org ON cards(org_id);

-- 成绩
CREATE TABLE IF NOT EXISTS scores (
  id            BIGSERIAL PRIMARY KEY,
  org_id        BIGINT DEFAULT 1,
  student_id    BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  exam_name     TEXT,
  subject       TEXT,
  score         NUMERIC(8,2),
  total         NUMERIC(8,2),
  note          TEXT,
  payload       JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scores_student ON scores(org_id, student_id);

-- 公告
CREATE TABLE IF NOT EXISTS announcements (
  id            BIGSERIAL PRIMARY KEY,
  org_id        BIGINT DEFAULT 1,
  title         TEXT NOT NULL,
  content       TEXT,
  payload       JSONB DEFAULT '{}',            -- expireAt 等前端字段
  active        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 设置（黑板样式/画面比例/隐藏题目等，JSONB）
CREATE TABLE IF NOT EXISTS settings (
  org_id        BIGINT PRIMARY KEY DEFAULT 1,
  payload       JSONB NOT NULL DEFAULT '{}',
  updated_at    TIMESTAMPTZ DEFAULT now()
);
