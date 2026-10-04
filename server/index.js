// 社区新生儿上门访视与黄疸随访 - API 服务
import express from 'express'
import { createHash, randomBytes } from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import db, { addEvent } from './db.js'
import { seed } from './seed.js'
import { createVisit, closeFollowup } from './service.js'
import { assessVisit } from './risk.js'
import {
  recordRefusal, addContact, resolveEscalation, getEscalation,
  listEscalations, refusalsOfArchive, escalationOfArchive,
} from './escalation.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json({ limit: '10mb' }))

seed() // 首次启动自动写入演示数据

const hash = (s) => createHash('sha256').update('nbv:' + s).digest('hex')

// ---------- 鉴权 ----------
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const row = token && db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?`).get(token)
  if (!row) return res.status(401).json({ error: '未登录或会话已过期' })
  req.user = row
  next()
}
const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: '无权访问' })

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {}
  const user = db.prepare('SELECT * FROM users WHERE username=? AND password_hash=?').get(String(username || ''), hash(String(password || '')))
  if (!user) return res.status(401).json({ error: '用户名或密码错误' })
  const token = randomBytes(24).toString('hex')
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?,?)').run(token, user.id)
  res.json({ token, user: pubUser(user) })
})
app.post('/api/auth/logout', auth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.user.id)
  res.json({ ok: true })
})
app.get('/api/me', auth, (req, res) => res.json({ user: pubUser(req.user) }))
const pubUser = (u) => ({ id: u.id, username: u.username, role: u.role, name: u.name, title: u.title, phone: u.phone })

// ---------- 工作台 ----------
app.get('/api/dashboard', auth, requireRole('nurse', 'doctor'), (req, res) => {
  const today = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const todayStr = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`
  const appts = db.prepare(`
    SELECT a.*, ar.mother_name, ar.baby_name, ar.birth_date, ar.address, ar.contact_name, ar.contact_phone, ar.jaundice_risk
    FROM appointments a JOIN archives ar ON ar.id=a.archive_id
    WHERE a.status='待访视' AND date(a.scheduled_time) <= date(?) ORDER BY a.scheduled_time`).all(todayStr + ' 23:59')
  const openFollowups = db.prepare(`SELECT * FROM followups WHERE status!='已闭环'`).all()
  const byType = {}
  for (const f of openFollowups) byType[f.type] = (byType[f.type] || 0) + 1
  const cnt = (sql, ...args) => db.prepare(sql).get(...args).c
  res.json({
    stats: {
      unvisited: appts.length,
      jaundiceAlerts: cnt(`SELECT COUNT(DISTINCT archive_id) c FROM followups WHERE status!='已闭环' AND type IN ('复查','转诊')`),
      maternalRisks: cnt(`SELECT COUNT(DISTINCT archive_id) c FROM followups WHERE status!='已闭环' AND type='电话随访'`),
      openFollowups: openFollowups.length,
      refusalEscalations: cnt(`SELECT COUNT(*) c FROM escalations WHERE status IN ('待处置','处置中','已联系街道','已恢复访视')`),
      todayAppointments: cnt(`SELECT COUNT(*) c FROM appointments WHERE date(scheduled_time)=date(?) AND status='待访视'`, todayStr + ' 12:00'),
    },
    followupsByType: byType,
    todayAppointments: appts,
    openEscalations: listEscalations('open').slice(0, 5),
    recentHighRiskVisits: db.prepare(`
      SELECT v.id, v.visit_time, v.risk_level, v.bilirubin, v.weight, ar.id archive_id, ar.mother_name, ar.baby_name
      FROM visits v JOIN archives ar ON ar.id=v.archive_id
      WHERE v.risk_level IN ('高','危急') ORDER BY v.created_at DESC LIMIT 8`).all(),
  })
})

// ---------- 预约 ----------
app.get('/api/appointments', auth, (req, res) => {
  const { status } = req.query
  let rows
  if (req.user.role === 'family') {
    rows = db.prepare(`SELECT a.*, ar.mother_name, ar.baby_name, ar.address FROM appointments a
      JOIN archives ar ON ar.id=a.archive_id WHERE ar.family_user_id=? ORDER BY a.scheduled_time DESC`).all(req.user.id)
  } else {
    rows = status
      ? db.prepare(`SELECT a.*, ar.mother_name, ar.baby_name, ar.address, ar.contact_name, ar.contact_phone, ar.jaundice_risk
                    FROM appointments a JOIN archives ar ON ar.id=a.archive_id WHERE a.status=? ORDER BY a.scheduled_time`).all(status)
      : db.prepare(`SELECT a.*, ar.mother_name, ar.baby_name, ar.address, ar.contact_name, ar.contact_phone, ar.jaundice_risk
                    FROM appointments a JOIN archives ar ON ar.id=a.archive_id ORDER BY a.scheduled_time DESC LIMIT 100`).all()
  }
  res.json({ appointments: rows })
})

app.post('/api/appointments', auth, requireRole('nurse', 'doctor'), (req, res) => {
  const { archiveId, scheduledTime, type = '加访', reason = '' } = req.body || {}
  if (!archiveId || !scheduledTime) return res.status(400).json({ error: '缺少档案或时间' })
  const info = db.prepare(`INSERT INTO appointments (archive_id, nurse_id, type, scheduled_time, reason) VALUES (?,?,?,?,?)`)
    .run(archiveId, req.user.id, type, String(scheduledTime).replace('T', ' '), reason)
  addEvent(archiveId, '预约', `新增${type}预约`, `时间 ${scheduledTime}`, req.user.name)
  res.json({ appointment: db.prepare('SELECT * FROM appointments WHERE id=?').get(info.lastInsertRowid) })
})

app.post('/api/appointments/:id/reschedule', auth, (req, res) => {
  const appt = db.prepare('SELECT a.*, ar.family_user_id FROM appointments a JOIN archives ar ON ar.id=a.archive_id WHERE a.id=?').get(req.params.id)
  if (!appt) return res.status(404).json({ error: '预约不存在' })
  if (req.user.role === 'family' && appt.family_user_id !== req.user.id) return res.status(403).json({ error: '无权操作' })
  const { scheduledTime, reason = '' } = req.body || {}
  if (!scheduledTime) return res.status(400).json({ error: '缺少新的预约时间' })
  const t = String(scheduledTime).replace('T', ' ')
  db.prepare(`UPDATE appointments SET scheduled_time=?, status='待访视', reason=?, updated_at=datetime('now','localtime') WHERE id=?`)
    .run(t, reason || appt.reason, appt.id)
  addEvent(appt.archive_id, '改约', `预约改期至 ${t}`, reason, req.user.name)
  res.json({ appointment: db.prepare('SELECT * FROM appointments WHERE id=?').get(appt.id) })
})

app.post('/api/appointments/:id/no-show', auth, requireRole('nurse'), (req, res) => {
  const appt = db.prepare('SELECT * FROM appointments WHERE id=?').get(req.params.id)
  if (!appt) return res.status(404).json({ error: '预约不存在' })
  const note = req.body?.note || '上门无人应答'
  db.prepare(`UPDATE appointments SET status='未开门', reason=?, updated_at=datetime('now','localtime') WHERE id=?`).run(note, appt.id)
  db.prepare(`INSERT INTO followups (archive_id, type, title, detail, created_by) VALUES (?,?,?,?,?)`)
    .run(appt.archive_id, '再次预约', '家属未开门，需再次预约上门', note, req.user.name)
  addEvent(appt.archive_id, '未开门', '上门访视家属未开门', note, req.user.name)
  res.json({ ok: true })
})

// ---------- 母婴档案 ----------
app.get('/api/archives', auth, requireRole('nurse', 'doctor'), (req, res) => {
  const { filter, q } = req.query
  let rows = db.prepare(`
    SELECT ar.*,
      (SELECT COUNT(*) FROM appointments a WHERE a.archive_id=ar.id AND a.status='待访视') pending_appts,
      (SELECT COUNT(*) FROM followups f WHERE f.archive_id=ar.id AND f.status!='已闭环') open_followups,
      (SELECT v.risk_level FROM visits v WHERE v.archive_id=ar.id ORDER BY v.visit_time DESC LIMIT 1) last_risk,
      (SELECT v.bilirubin FROM visits v WHERE v.archive_id=ar.id ORDER BY v.visit_time DESC LIMIT 1) last_bilirubin,
      (SELECT MIN(a.scheduled_time) FROM appointments a WHERE a.archive_id=ar.id AND a.status='待访视') next_appt,
      (SELECT COUNT(*) FROM refusals r WHERE r.archive_id=ar.id) refusal_count,
      (SELECT COUNT(*) FROM escalations e WHERE e.archive_id=ar.id AND e.status!='已闭环') open_escalations
    FROM archives ar ORDER BY ar.created_at DESC`).all()
  if (q) {
    const s = String(q).toLowerCase()
    rows = rows.filter(r => [r.mother_name, r.baby_name, r.address, r.contact_phone].join(' ').toLowerCase().includes(s))
  }
  if (filter === 'unvisited') rows = rows.filter(r => r.pending_appts > 0)
  if (filter === 'jaundice') rows = rows.filter(r => r.last_bilirubin != null && ['高', '危急'].includes(r.last_risk))
  if (filter === 'maternal') rows = rows.filter(r =>
    db.prepare(`SELECT COUNT(*) c FROM followups WHERE archive_id=? AND status!='已闭环' AND type='电话随访'`).get(r.id).c > 0)
  if (filter === 'refusal') rows = rows.filter(r => r.refusal_count > 0)
  if (filter === 'unclosed') rows = rows.filter(r => r.open_followups > 0)
  res.json({ archives: rows })
})

app.get('/api/archives/:id', auth, (req, res) => {
  const archive = db.prepare('SELECT * FROM archives WHERE id=?').get(req.params.id)
  if (!archive) return res.status(404).json({ error: '档案不存在' })
  if (req.user.role === 'family' && archive.family_user_id !== req.user.id) return res.status(403).json({ error: '无权访问' })
  const visits = db.prepare('SELECT * FROM visits WHERE archive_id=? ORDER BY visit_time DESC').all(archive.id)
    .map(v => ({ ...v, flags: JSON.parse(v.flags || '[]'), photos: JSON.parse(v.photos || '[]') }))
  res.json({
    archive,
    appointments: db.prepare('SELECT a.*, u.name nurse_name FROM appointments a LEFT JOIN users u ON u.id=a.nurse_id WHERE a.archive_id=? ORDER BY a.scheduled_time DESC').all(archive.id),
    visits,
    followups: db.prepare('SELECT * FROM followups WHERE archive_id=? ORDER BY created_at DESC').all(archive.id),
    refusals: refusalsOfArchive(archive.id),
    escalations: escalationOfArchive(archive.id),
    documents: db.prepare('SELECT id, archive_id, type, filename, data_url, note, created_at FROM documents WHERE archive_id=? ORDER BY created_at DESC').all(archive.id),
    consults: db.prepare('SELECT * FROM consults WHERE archive_id=? ORDER BY created_at DESC').all(archive.id),
    events: db.prepare('SELECT * FROM events WHERE archive_id=? ORDER BY created_at DESC, id DESC LIMIT 100').all(archive.id),
  })
})

// ---------- 访视 ----------
app.post('/api/visits/assess', auth, requireRole('nurse', 'doctor'), (req, res) => {
  const archive = db.prepare('SELECT * FROM archives WHERE id=?').get(req.body?.archive_id)
  if (!archive) return res.status(404).json({ error: '档案不存在' })
  res.json({ assessment: assessVisit(archive, { ...req.body, visit_time: req.body.visit_time || new Date().toISOString() }) })
})

app.post('/api/visits', auth, requireRole('nurse'), (req, res) => {
  try {
    const result = createVisit(req.body || {}, req.user)
    res.status(result.duplicated ? 200 : 201).json(result)
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message })
  }
})

// 离线草稿批量同步（幂等：client_id 去重）
app.post('/api/sync/visits', auth, requireRole('nurse'), (req, res) => {
  const items = Array.isArray(req.body?.visits) ? req.body.visits : []
  const results = items.map(item => {
    try {
      const r = createVisit({ ...item, created_offline: 1 }, req.user)
      return { client_id: item.client_id, ok: true, duplicated: r.duplicated, visit_id: r.visit.id }
    } catch (e) {
      return { client_id: item.client_id, ok: false, error: e.message }
    }
  })
  res.json({ results })
})

// ---------- 随访闭环 ----------
app.get('/api/followups', auth, requireRole('nurse', 'doctor'), (req, res) => {
  const openOnly = req.query.status !== 'all'
  const rows = db.prepare(`
    SELECT f.*, ar.mother_name, ar.baby_name, ar.birth_date, ar.address, ar.contact_name, ar.contact_phone
    FROM followups f JOIN archives ar ON ar.id=f.archive_id
    ${openOnly ? `WHERE f.status!='已闭环'` : ''}
    ORDER BY CASE f.status WHEN '待处理' THEN 0 WHEN '进行中' THEN 1 ELSE 2 END, f.created_at DESC`).all()
  res.json({ followups: rows })
})

app.post('/api/followups/:id/close', auth, requireRole('nurse', 'doctor'), (req, res) => {
  const f = closeFollowup(Number(req.params.id), req.user.name, req.body?.note || '')
  if (!f) return res.status(404).json({ error: '随访事项不存在' })
  res.json({ followup: f })
})

// 社区医生决策：复查 / 转诊 / 电话随访 / 母乳指导 / 继续观察
app.post('/api/followups/:id/decide', auth, requireRole('doctor', 'nurse'), (req, res) => {
  const f = db.prepare('SELECT * FROM followups WHERE id=?').get(req.params.id)
  if (!f) return res.status(404).json({ error: '随访事项不存在' })
  const { decision, note = '', dueDate } = req.body || {}
  const valid = ['复查', '转诊', '电话随访', '母乳指导', '继续观察']
  if (!valid.includes(decision)) return res.status(400).json({ error: '无效决策' })
  addEvent(f.archive_id, '决策', `医生决策：${decision}`, note || `针对【${f.type}】${f.title}`, req.user.name)
  closeFollowup(f.id, req.user.name, `医生决策：${decision}${note ? ' - ' + note : ''}`)
  if (decision !== '继续观察') {
    db.prepare(`INSERT INTO followups (archive_id, visit_id, type, title, detail, due_date, created_by)
                VALUES (?,?,?,?,?,?,?)`)
      .run(f.archive_id, f.visit_id, decision, `医生决策：${decision}`, note || `来源：【${f.type}】${f.title}`,
        dueDate || null, req.user.name)
    if (decision === '复查' && dueDate) {
      db.prepare(`INSERT INTO appointments (archive_id, nurse_id, type, scheduled_time, reason) VALUES (?,?,?,?,?)`)
        .run(f.archive_id, null, '复查', `${dueDate} 09:00`, '医生决策安排')
    }
  }
  res.json({ ok: true })
})

// ---------- 家属拒访与连续拒访升级 ----------
app.post('/api/refusals', auth, requireRole('nurse'), (req, res) => {
  try {
    const r = recordRefusal(req.body || {}, req.user)
    res.status(201).json(r)
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message })
  }
})

app.get('/api/escalations', auth, requireRole('nurse', 'doctor'), (req, res) => {
  res.json({ escalations: listEscalations(req.query.status || 'open') })
})

app.get('/api/escalations/:id', auth, requireRole('nurse', 'doctor'), (req, res) => {
  const e = getEscalation(Number(req.params.id))
  if (!e) return res.status(404).json({ error: '升级工单不存在' })
  res.json({ escalation: e })
})

// 升级流程中记录一次联系：对象 / 语气 / 拒访原因 / 是否看到婴儿
app.post('/api/escalations/:id/contacts', auth, requireRole('nurse', 'doctor'), (req, res) => {
  try {
    res.status(201).json(addContact(Number(req.params.id), req.body || {}, req.user))
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message })
  }
})

// 社区医生/妇幼专员处置：recheck 上门复核（自动带入照片/电话/未完成项）/ street 联系街道 / resume 恢复访视
app.post('/api/escalations/:id/resolve', auth, requireRole('nurse', 'doctor'), (req, res) => {
  try {
    res.json(resolveEscalation(Number(req.params.id), req.body || {}, req.user))
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message })
  }
})

// 护士打开「复核」预约的访视表单时，取自动带入的现场资料
app.get('/api/rechecks/by-appointment/:appointmentId', auth, requireRole('nurse', 'doctor'), (req, res) => {
  const r = db.prepare('SELECT * FROM rechecks WHERE appointment_id=?').get(req.params.appointmentId)
  if (!r) return res.json({ recheck: null })
  res.json({
    recheck: {
      ...r,
      pending_items: JSON.parse(r.pending_items || '[]'),
      carried_photos: JSON.parse(r.carried_photos || '[]'),
    },
  })
})

// ---------- 家属端 ----------
app.get('/api/family/overview', auth, requireRole('family'), (req, res) => {
  const archive = db.prepare('SELECT * FROM archives WHERE family_user_id=?').get(req.user.id)
  if (!archive) return res.status(404).json({ error: '未关联母婴档案' })
  const visits = db.prepare('SELECT * FROM visits WHERE archive_id=? ORDER BY visit_time DESC').all(archive.id)
    .map(v => ({ ...v, flags: JSON.parse(v.flags || '[]'), photos: JSON.parse(v.photos || '[]') }))
  const followups = db.prepare(`SELECT * FROM followups WHERE archive_id=? AND status!='已闭环' ORDER BY created_at DESC`).all(archive.id)
  const nextAppt = db.prepare(`SELECT * FROM appointments WHERE archive_id=? AND status='待访视' ORDER BY scheduled_time LIMIT 1`).get(archive.id)
  res.json({
    archive, visits, followups, nextAppointment: nextAppt || null,
    appointments: db.prepare('SELECT * FROM appointments WHERE archive_id=? ORDER BY scheduled_time DESC').all(archive.id),
    documents: db.prepare('SELECT id, type, filename, data_url, note, created_at FROM documents WHERE archive_id=? ORDER BY created_at DESC').all(archive.id),
    consults: db.prepare('SELECT * FROM consults WHERE archive_id=? ORDER BY created_at DESC').all(archive.id),
  })
})

app.post('/api/documents', auth, (req, res) => {
  const { type, filename, dataUrl = '', note = '' } = req.body || {}
  if (!type || !filename) return res.status(400).json({ error: '缺少材料类型或文件名' })
  let archiveId = req.body.archiveId
  if (req.user.role === 'family') {
    const arch = db.prepare('SELECT id FROM archives WHERE family_user_id=?').get(req.user.id)
    if (!arch) return res.status(404).json({ error: '未关联母婴档案' })
    archiveId = arch.id
  }
  if (!archiveId) return res.status(400).json({ error: '缺少档案' })
  if (dataUrl && dataUrl.length > 6_000_000) return res.status(413).json({ error: '文件过大（限 4MB 左右）' })
  const info = db.prepare('INSERT INTO documents (archive_id, uploader_id, type, filename, data_url, note) VALUES (?,?,?,?,?,?)')
    .run(archiveId, req.user.id, type, filename, dataUrl, note)
  addEvent(archiveId, '材料', `补充材料：${type}`, filename, req.user.name)
  res.status(201).json({ document: db.prepare('SELECT id, type, filename, note, created_at FROM documents WHERE id=?').get(info.lastInsertRowid) })
})

app.post('/api/consults', auth, requireRole('family'), (req, res) => {
  const question = String(req.body?.question || '').trim()
  if (!question) return res.status(400).json({ error: '请填写咨询内容' })
  const arch = db.prepare('SELECT id FROM archives WHERE family_user_id=?').get(req.user.id)
  if (!arch) return res.status(404).json({ error: '未关联母婴档案' })
  const info = db.prepare('INSERT INTO consults (archive_id, user_id, question) VALUES (?,?,?)').run(arch.id, req.user.id, question)
  db.prepare(`INSERT INTO followups (archive_id, type, title, detail, created_by) VALUES (?,?,?,?,?)`)
    .run(arch.id, '线上咨询', '家属线上咨询待回复', question, req.user.name)
  addEvent(arch.id, '咨询', '家属发起线上咨询', question, req.user.name)
  res.status(201).json({ consult: db.prepare('SELECT * FROM consults WHERE id=?').get(info.lastInsertRowid) })
})

app.post('/api/consults/:id/reply', auth, requireRole('nurse', 'doctor'), (req, res) => {
  const c = db.prepare('SELECT * FROM consults WHERE id=?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '咨询不存在' })
  const reply = String(req.body?.reply || '').trim()
  if (!reply) return res.status(400).json({ error: '请填写回复内容' })
  db.prepare(`UPDATE consults SET status='已回复', reply=?, replied_by=?, replied_at=datetime('now','localtime') WHERE id=?`)
    .run(reply, req.user.name, c.id)
  const f = db.prepare(`SELECT * FROM followups WHERE archive_id=? AND type='线上咨询' AND status!='已闭环'`).get(c.archive_id)
  if (f) closeFollowup(f.id, req.user.name, `已回复咨询 #${c.id}`)
  addEvent(c.archive_id, '咨询', '回复线上咨询', reply, req.user.name)
  res.json({ consult: db.prepare('SELECT * FROM consults WHERE id=?').get(c.id) })
})

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }))

// ---------- 生产模式：托管前端构建产物 ----------
const dist = path.join(__dirname, '..', 'client', 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get('*', (req, res, next) => (req.path.startsWith('/api/') ? next() : res.sendFile(path.join(dist, 'index.html'))))
}

const PORT = process.env.PORT || 8080
app.listen(PORT, () => console.log(`✔ 服务已启动: http://localhost:${PORT}`))
