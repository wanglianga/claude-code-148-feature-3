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
  status TEXT NOT NULL DEFAULT '待访视', -- 待访视/已完成/已改约/未开门/家属拒访/已取消
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

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id INTEGER NOT NULL REFERENCES archives(id),
  kind TEXT NOT NULL,                  -- 预约/改约/未开门/拒访/升级/联系/复核/访视/复查/转诊/指导/材料/咨询/决策/闭环
  title TEXT NOT NULL,
  detail TEXT DEFAULT '',
  actor TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS refusals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id INTEGER NOT NULL REFERENCES archives(id),
  appointment_id INTEGER REFERENCES appointments(id),
  nurse_id INTEGER REFERENCES users(id),
  seq INTEGER NOT NULL DEFAULT 1,        -- 本户第几次拒访
  arrived_at TEXT NOT NULL,             -- 护士到达时间
  contact_name TEXT DEFAULT '',         -- 电话沟通对象（产妇本人/丈夫/婆婆…）
  contact_relation TEXT DEFAULT '',     -- 与母婴关系
  tone TEXT DEFAULT '平静',             -- 对方语气：配合/平静/不耐烦/抵触/敌对
  reason TEXT NOT NULL DEFAULT '',      -- 拒访原因
  phone_content TEXT DEFAULT '',        -- 电话沟通内容
  baby_seen INTEGER NOT NULL DEFAULT 0, -- 是否看到婴儿
  baby_status TEXT DEFAULT '',          -- 婴儿状态（看到/隔着门听到等）
  photos TEXT DEFAULT '[]',             -- 到达现场照片 JSON [dataUrl]
  follow_up TEXT DEFAULT '',            -- 明确后续安排（再约时间/已上报升级）
  escalation_id INTEGER,                -- 触发或关联的升级工单
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS escalations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id INTEGER NOT NULL REFERENCES archives(id),
  level TEXT NOT NULL DEFAULT '社区医生', -- 社区医生/妇幼专员
  status TEXT NOT NULL DEFAULT '待处置',  -- 待处置/处置中/已恢复访视/已联系街道/已闭环
  refusal_count INTEGER NOT NULL DEFAULT 2, -- 升级时连续拒访次数
  last_refusal_id INTEGER REFERENCES refusals(id),
  title TEXT NOT NULL DEFAULT '',
  detail TEXT DEFAULT '',
  created_by TEXT DEFAULT '系统',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  resolved_at TEXT,
  resolved_by TEXT,
  resolution TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS escalation_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  escalation_id INTEGER NOT NULL REFERENCES escalations(id),
  channel TEXT DEFAULT '电话',           -- 电话/上门/微信/短信
  contact_name TEXT DEFAULT '',          -- 联系对象
  contact_relation TEXT DEFAULT '',      -- 与母婴关系
  tone TEXT DEFAULT '平静',              -- 语气
  refusal_reason TEXT DEFAULT '',        -- 本次拒访/不配合原因
  baby_seen INTEGER NOT NULL DEFAULT 0,  -- 是否看到婴儿
  baby_status TEXT DEFAULT '',           -- 婴儿状态
  content TEXT DEFAULT '',               -- 沟通内容
  contacted_by TEXT DEFAULT '',          -- 记录人
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS rechecks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  escalation_id INTEGER NOT NULL REFERENCES escalations(id),
  archive_id INTEGER NOT NULL REFERENCES archives(id),
  appointment_id INTEGER REFERENCES appointments(id),
  decided_by TEXT DEFAULT '',
  scheduled_time TEXT DEFAULT '',
  pending_items TEXT DEFAULT '[]',       -- 未完成测量项 JSON（自动带入）
  carried_photos TEXT DEFAULT '[]',      -- 前次护士到达照片 JSON（自动带入）
  carried_phone_log TEXT DEFAULT '',     -- 前次电话沟通记录（自动带入）
  carried_refusal_reason TEXT DEFAULT '',-- 前次拒访原因（便于沟通）
  status TEXT DEFAULT '待上门',           -- 待上门/已完成
  result_note TEXT DEFAULT '',
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
CREATE INDEX IF NOT EXISTS idx_escalation_status ON escalations(status);
CREATE INDEX IF NOT EXISTS idx_escalation_contact ON escalation_contacts(escalation_id);
CREATE INDEX IF NOT EXISTS idx_recheck_escalation ON rechecks(escalation_id);
`)

export function addEvent(archiveId, kind, title, detail = '', actor = '') {
  db.prepare('INSERT INTO events (archive_id, kind, title, detail, actor) VALUES (?,?,?,?,?)')
    .run(archiveId, kind, title, detail, actor)
}

export default db
