// 数据库连接与表结构（SQLite，文件持久化）
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data')
fs.mkdirSync(DATA_DIR, { recursive: true })

const db = new Database(path.join(DATA_DIR, 'neonatal.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('nurse','family','doctor')),
  name TEXT NOT NULL,
  title TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS archives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_user_id INTEGER REFERENCES users(id),
  mother_name TEXT NOT NULL,
  baby_name TEXT NOT NULL,
  baby_gender TEXT DEFAULT '女',
  birth_date TEXT NOT NULL,            -- 出生日期时间 ISO
  birth_weight REAL NOT NULL,          -- 出生体重 g
  delivery_mode TEXT NOT NULL,         -- 顺产/剖宫产/产钳助产
  feeding_type TEXT NOT NULL,          -- 母乳喂养/配方奶喂养/混合喂养
  jaundice_risk TEXT DEFAULT '低',     -- 黄疸风险 低/中/高
  maternal_wound TEXT DEFAULT '愈合良好', -- 产妇伤口
  address TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  discharge_date TEXT,                 -- 出院日期
  care_ability TEXT DEFAULT '良好',    -- 家庭照护能力 良好/一般/薄弱
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id INTEGER NOT NULL REFERENCES archives(id),
  nurse_id INTEGER REFERENCES users(id),
  type TEXT NOT NULL DEFAULT '初访',    -- 初访/复查/加访
  scheduled_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '待访视', -- 待访视/已完成/已改约/未开门/已取消
  reason TEXT DEFAULT '',              -- 改约/未开门等原因
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT UNIQUE,               -- 离线草稿幂等键
  appointment_id INTEGER REFERENCES appointments(id),
  archive_id INTEGER NOT NULL REFERENCES archives(id),
  nurse_id INTEGER REFERENCES users(id),
  visit_time TEXT NOT NULL,
  weight REAL,                         -- 婴儿体重 g
  bilirubin REAL,                      -- 经皮黄疸值 µmol/L
  bilirubin_site TEXT DEFAULT '额头',
  cord TEXT DEFAULT '干燥',            -- 脐带情况
  stool_count INTEGER DEFAULT 0,
  stool_color TEXT DEFAULT '黄色',
  urine_count INTEGER DEFAULT 0,
  feeding_type TEXT DEFAULT '',
  feeding_freq INTEGER DEFAULT 0,      -- 喂养频次 次/日
  spit_up TEXT DEFAULT '无',           -- 吐奶
  sleep TEXT DEFAULT '正常',           -- 睡眠
  breast TEXT DEFAULT '正常',          -- 产妇乳房
  mood TEXT DEFAULT '平稳',            -- 产妇情绪
  wound_check TEXT DEFAULT '愈合良好', -- 产妇伤口复查
  care_ability TEXT DEFAULT '良好',    -- 家庭照护能力（现场评估）
  device_issue INTEGER DEFAULT 0,      -- 社区设备故障，手工记录
  photos TEXT DEFAULT '[]',            -- JSON [dataUrl]
  advice TEXT DEFAULT '',              -- 护理建议（家属可见）
  risk_level TEXT DEFAULT '低',        -- 低/中/高/危急
  flags TEXT DEFAULT '[]',             -- JSON 风险标记
  need_recheck INTEGER DEFAULT 0,
  need_referral INTEGER DEFAULT 0,
  need_lactation INTEGER DEFAULT 0,
  need_phone INTEGER DEFAULT 0,
  created_offline INTEGER DEFAULT 0,   -- 是否离线草稿补录
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id INTEGER NOT NULL REFERENCES archives(id),
  visit_id INTEGER REFERENCES visits(id),
  type TEXT NOT NULL,                  -- 复查/转诊/母乳指导/电话随访/线上咨询/再次预约
  title TEXT NOT NULL,
  detail TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT '待处理', -- 待处理/进行中/已闭环
  due_date TEXT,
  created_by TEXT DEFAULT '系统',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  closed_at TEXT,
  closed_by TEXT,
  close_note TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id INTEGER NOT NULL REFERENCES archives(id),
  uploader_id INTEGER REFERENCES users(id),
  type TEXT NOT NULL,                  -- 出生证明/出院小结/喂养记录/其他
  filename TEXT NOT NULL,
  data_url TEXT DEFAULT '',            -- base64（演示环境小文件）
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS consults (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id INTEGER NOT NULL REFERENCES archives(id),
  user_id INTEGER REFERENCES users(id),
  question TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '待回复', -- 待回复/已回复
  reply TEXT DEFAULT '',
  replied_by TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  replied_at TEXT
);

CREATE TABLE IF NOT EXISTS refusals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT UNIQUE,               -- 离线补录幂等键
  appointment_id INTEGER REFERENCES appointments(id),
  archive_id INTEGER NOT NULL REFERENCES archives(id),
  nurse_id INTEGER REFERENCES users(id),
  seq INTEGER NOT NULL DEFAULT 1,       -- 该家庭第几次拒访
  arrived_at TEXT NOT NULL,             -- 护士到达时间
  photos TEXT DEFAULT '[]',             -- 到达现场照片 JSON [dataUrl]
  contact_role TEXT DEFAULT '',         -- 电话沟通对象身份（产妇本人/丈夫/婆婆…）
  phone_content TEXT NOT NULL DEFAULT '',-- 电话沟通内容
  reason_code TEXT NOT NULL,            -- 拒访原因分类
  reason_detail TEXT DEFAULT '',
  tone TEXT DEFAULT '平和',             -- 家属语气：平和/回避/抵触/激动/不配合
  baby_visible TEXT DEFAULT '否',       -- 是否看到婴儿：是/否/不确定（隔门/视频）
  followup_kind TEXT NOT NULL,          -- 明确后续安排：再次预约/电话随访/等待家属联系
  followup_time TEXT,                   -- 后续安排时间
  followup_note TEXT DEFAULT '',
  followup_appointment_id INTEGER,      -- 再次预约生成的新预约
  escalation_id INTEGER,                -- 触发/关联的升级单
  created_offline INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- 连续拒访升级单：升级给社区医生/妇幼专员，决定上门复核或联系街道
CREATE TABLE IF NOT EXISTS escalations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id INTEGER NOT NULL REFERENCES archives(id),
  status TEXT NOT NULL DEFAULT '待处置', -- 待处置/处置中/已闭环
  level TEXT NOT NULL DEFAULT '社区医生', -- 社区医生/妇幼专员
  handler TEXT NOT NULL DEFAULT '社区医生',
  trigger_refusal_id INTEGER REFERENCES refusals(id),
  refusal_count INTEGER NOT NULL DEFAULT 0, -- 升级时连续拒访次数
  decision TEXT DEFAULT '',             -- 上门复核/联系街道/电话随访/转妇幼专员/继续观察
  decision_note TEXT DEFAULT '',
  decided_by TEXT DEFAULT '',
  decided_at TEXT,
  review_appointment_id INTEGER,
  closed_at TEXT,
  closed_by TEXT DEFAULT '',
  close_note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- 升级流程中每次联系的完整记录：对象、语气、拒访原因、是否看到婴儿
CREATE TABLE IF NOT EXISTS escalation_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  escalation_id INTEGER NOT NULL REFERENCES escalations(id),
  archive_id INTEGER NOT NULL REFERENCES archives(id),
  contact_at TEXT NOT NULL,
  contact_by TEXT NOT NULL,
  contact_by_role TEXT DEFAULT '护士',  -- 护士/社区医生/妇幼专员
  target TEXT NOT NULL,                 -- 联系对象（产妇/丈夫/婆婆/街道…）
  channel TEXT DEFAULT '电话',          -- 电话/上门/微信/街道协同
  tone TEXT DEFAULT '平和',
  refusal_reason TEXT DEFAULT '',
  baby_visible TEXT DEFAULT '否',
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id INTEGER NOT NULL REFERENCES archives(id),
  kind TEXT NOT NULL,                  -- 预约/改约/未开门/拒访/访视/复查/转诊/指导/材料/咨询/决策/升级/联系/闭环
  title TEXT NOT NULL,
  detail TEXT DEFAULT '',
  actor TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_appt_archive ON appointments(archive_id);
CREATE INDEX IF NOT EXISTS idx_appt_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_visit_archive ON visits(archive_id);
CREATE INDEX IF NOT EXISTS idx_followup_status ON followups(status);
CREATE INDEX IF NOT EXISTS idx_events_archive ON events(archive_id);
CREATE INDEX IF NOT EXISTS idx_refusal_archive ON refusals(archive_id);
CREATE INDEX IF NOT EXISTS idx_escalation_archive ON escalations(archive_id);
CREATE INDEX IF NOT EXISTS idx_esc_contact ON escalation_contacts(escalation_id);
`)

export function addEvent(archiveId, kind, title, detail = '', actor = '') {
  db.prepare('INSERT INTO events (archive_id, kind, title, detail, actor) VALUES (?,?,?,?,?)')
    .run(archiveId, kind, title, detail, actor)
}

export default db
