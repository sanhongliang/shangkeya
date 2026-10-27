-- 上课鸭 校长端新增表（PostgreSQL）
-- 执行前已存在库 shangkeya；幂等可重复执行

-- 学校（校长端）：每个学校拥有独立 org_id 数据空间
CREATE TABLE IF NOT EXISTS schools (
  id          BIGSERIAL PRIMARY KEY,
  org_id      BIGINT NOT NULL UNIQUE,        -- 学校独立数据空间（复用现有 org 隔离）
  school_code TEXT NOT NULL UNIQUE,          -- 老师申请用学校ID（6位大写字母数字）
  name        TEXT NOT NULL,
  owner_id    BIGINT NOT NULL REFERENCES accounts(id),
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 学校成员（老师申请加入，校长审批；hourly_rate 为老师在本校时薪）
CREATE TABLE IF NOT EXISTS school_members (
  id          BIGSERIAL PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  account_id  BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status      TEXT DEFAULT 'pending',        -- pending/approved/rejected
  hourly_rate NUMERIC(10,2) DEFAULT 0,       -- 老师时薪（校长设置，元/小时）
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(school_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_school_members_school ON school_members(school_id, status);

-- 师生关系（校长建立：老师 ↔ 学校学员 + 学科备注）
CREATE TABLE IF NOT EXISTS teacher_students (
  id          BIGSERIAL PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  teacher_id  BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  student_id  BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject     TEXT,                          -- 学科备注
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(school_id, teacher_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_teacher_students_school ON teacher_students(school_id);
CREATE INDEX IF NOT EXISTS idx_teacher_students_teacher ON teacher_students(teacher_id);
