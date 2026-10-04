// 家属拒访 → 连续拒访升级 → 社区医生/妇幼专员处置 → 上门复核 的领域服务
// 关键规则：
// 1. 拒访不关闭访视任务：预约标记为「家属拒访」，但必须生成明确后续安排（再约 / 升级）
// 2. 连续拒访达到阈值自动升级给社区医生或妇幼专员
// 3. 升级后每次联系都记录：对象、语气、拒访原因、是否看到婴儿（状态）
// 4. 医生决定上门复核时，自动带入前次护士到达照片、电话沟通记录与未完成测量项
import db, { addEvent } from './db.js'
import { closeFollowup } from './service.js'

export const ESCALATE_AFTER = 2 // 连续拒访 2 次升级

// 首次访视应完成的标准测量/评估项（用于复核时计算“未完成测量项”）
const STANDARD_ITEMS = [
  { key: 'weight', label: '体重测量', done: (v) => v && v.weight != null },
  { key: 'bilirubin', label: '经皮胆红素测量', done: (v) => v && v.bilirubin != null },
  { key: 'cord', label: '脐带检查', done: (v) => !!v },
  { key: 'feeding', label: '喂养评估（方式/频次）', done: (v) => !!v && Number(v.feeding_freq) > 0 },
  { key: 'excretion', label: '大小便记录', done: (v) => !!v },
  { key: 'wound', label: '产妇伤口检查', done: (v) => !!v },
  { key: 'mood', label: '产妇情绪评估', done: (v) => !!v },
]

export const TONE_OPTIONS = ['配合', '平静', '不耐烦', '抵触', '敌对']

/** 自最近一次成功访视以来的连续拒访次数（无成功访视则为全部拒访次数） */
export function refusalStreak(archiveId) {
  const last = db.prepare('SELECT visit_time FROM visits WHERE archive_id=? ORDER BY visit_time DESC LIMIT 1').get(archiveId)
  const since = last ? last.visit_time : '1970-01-01'
  return db.prepare(`SELECT COUNT(*) c FROM refusals WHERE archive_id=? AND arrived_at > ?`)
    .get(archiveId, since).c
}

function openEscalation(archiveId) {
  return db.prepare(`SELECT * FROM escalations WHERE archive_id=? AND status NOT IN ('已闭环') ORDER BY id DESC LIMIT 1`)
    .get(archiveId)
}

/** 登记一次家属拒访 */
export function recordRefusal(payload, nurse) {
  const archive = db.prepare('SELECT * FROM archives WHERE id=?').get(payload.archive_id)
  if (!archive) throw Object.assign(new Error('母婴档案不存在'), { status: 404 })
  const reason = String(payload.reason || '').trim()
  if (!reason) throw Object.assign(new Error('请填写拒访原因'), { status: 400 })
  const phoneContent = String(payload.phone_content || '').trim()
  if (!phoneContent) throw Object.assign(new Error('请记录电话沟通内容'), { status: 400 })

  const seq = db.prepare('SELECT COUNT(*) c FROM refusals WHERE archive_id=?').get(archive.id).c + 1
  const arrivedAt = String(payload.arrived_at || new Date().toISOString().slice(0, 16)).replace('T', ' ')
  const nurseName = nurse?.name || '系统'

  // 已存在升级工单则关联本次拒访
  const existing = openEscalation(archive.id)
  // 计入本次后的连续拒访次数（本次尚未写入，故 +1）
  const streak = refusalStreak(archive.id) + 1
  const willEscalate = streak >= ESCALATE_AFTER && !existing

  // 首次（非升级）拒访必须明确后续安排——先校验，再写库，避免产生无后续安排的拒访记录
  let nextTime = ''
  if (!willEscalate && !existing) {
    nextTime = payload.next_time ? String(payload.next_time).replace('T', ' ') : ''
    if (!nextTime) throw Object.assign(new Error('首次拒访必须与家属约定再次上门时间（明确后续安排）'), { status: 400 })
  }

  const info = db.prepare(`INSERT INTO refusals
    (archive_id, appointment_id, nurse_id, seq, arrived_at, contact_name, contact_relation, tone,
     reason, phone_content, baby_seen, baby_status, photos, follow_up, escalation_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    archive.id, payload.appointment_id || null, nurse?.id || null, seq, arrivedAt,
    String(payload.contact_name || ''), String(payload.contact_relation || ''),
    payload.tone || '平静', reason, phoneContent,
    payload.baby_seen ? 1 : 0, String(payload.baby_status || ''),
    JSON.stringify(payload.photos || []), '', existing?.id || null)
  const refusalId = info.lastInsertRowid

  // 预约标记为「家属拒访」——不关闭访视任务，后续必须有明确安排
  if (payload.appointment_id) {
    db.prepare(`UPDATE appointments SET status='家属拒访', reason=?, updated_at=datetime('now','localtime') WHERE id=?`)
      .run(`第${seq}次拒访：${reason}`, payload.appointment_id)
  }

  let escalation = existing || null
  let escalatedNow = false

  if (willEscalate) {
    // —— 连续拒访：自动升级社区医生 ——
    const e = db.prepare(`INSERT INTO escalations
      (archive_id, level, status, refusal_count, last_refusal_id, title, detail, created_by)
      VALUES (?,?, '待处置', ?, ?, ?, ?, ?)`).run(
      archive.id, payload.level === '妇幼专员' ? '妇幼专员' : '社区医生', streak, refusalId,
      `连续 ${streak} 次拒访，需${payload.level === '妇幼专员' ? '妇幼专员' : '社区医生'}介入`,
      `护士已连续 ${streak} 次上门被拒（最近一次：${reason}），家属仅接受电话沟通，需评估上门复核或联系街道。`,
      nurseName)
    escalation = db.prepare('SELECT * FROM escalations WHERE id=?').get(e.lastInsertRowid)
    escalatedNow = true
    db.prepare('UPDATE refusals SET escalation_id=?, follow_up=? WHERE id=?')
      .run(escalation.id, '已升级社区医生/妇幼专员处置', refusalId)
    db.prepare(`INSERT INTO followups (archive_id, type, title, detail, created_by) VALUES (?,?,?,?,?)`)
      .run(archive.id, '拒访升级', `连续${streak}次拒访，等待${escalation.level}处置`,
        `最近一次拒访原因：${reason}；电话沟通：${phoneContent}`, nurseName)
    addEvent(archive.id, '升级', `连续 ${streak} 次拒访，自动升级${escalation.level}`,
      `拒访原因：${reason}`, nurseName)
  } else if (existing) {
    db.prepare('UPDATE escalations SET refusal_count=?, last_refusal_id=? WHERE id=?')
      .run(streak, refusalId, existing.id)
    db.prepare('UPDATE refusals SET follow_up=? WHERE id=?').run('已记录并补充到升级工单', refusalId)
    addEvent(archive.id, '拒访', `第 ${seq} 次上门被拒（升级处置中）`,
      `对象：${payload.contact_name || '未署名'}；原因：${reason}`, nurseName)
  } else {
    // —— 首次拒访：已校验再约时间，落实明确后续安排 ——
    db.prepare('UPDATE refusals SET follow_up=? WHERE id=?').run(`已再约 ${nextTime} 上门`, refusalId)
    db.prepare(`INSERT INTO appointments (archive_id, nurse_id, type, scheduled_time, status, reason)
                VALUES (?,?,?,?,'待访视',?)`)
      .run(archive.id, nurse?.id || null, '初访', nextTime, `家属拒访后再约（第${seq}次）`)
    db.prepare(`INSERT INTO followups (archive_id, type, title, detail, created_by) VALUES (?,?,?,?,?)`)
      .run(archive.id, '再次预约', `家属拒访（愿电话沟通），已再约 ${nextTime} 上门`,
        `拒访原因：${reason}；电话沟通：${phoneContent}`, nurseName)
    addEvent(archive.id, '拒访', `护士按约到达，家属拒访（第 ${seq} 次）`,
      `到达 ${arrivedAt}；对象：${payload.contact_name || '未署名'}；原因：${reason}；已再约 ${nextTime}`, nurseName)
  }

  return {
    refusal: db.prepare('SELECT * FROM refusals WHERE id=?').get(refusalId),
    escalation,
    escalatedNow,
    streak,
  }
}

/** 升级流程中记录一次联系（每次都留对象/语气/拒访原因/是否看到婴儿） */
export function addContact(escalationId, payload, user) {
  const esc = db.prepare('SELECT * FROM escalations WHERE id=?').get(escalationId)
  if (!esc) throw Object.assign(new Error('升级工单不存在'), { status: 404 })
  const content = String(payload.content || '').trim()
  if (!content) throw Object.assign(new Error('请记录沟通内容'), { status: 400 })
  const info = db.prepare(`INSERT INTO escalation_contacts
    (escalation_id, channel, contact_name, contact_relation, tone, refusal_reason,
     baby_seen, baby_status, content, contacted_by)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    esc.id, payload.channel || '电话',
    String(payload.contact_name || ''), String(payload.contact_relation || ''),
    payload.tone || '平静', String(payload.refusal_reason || ''),
    payload.baby_seen ? 1 : 0, String(payload.baby_status || ''),
    content, user?.name || '系统')
  if (esc.status === '待处置') {
    db.prepare(`UPDATE escalations SET status='处置中' WHERE id=?`).run(esc.id)
  }
  addEvent(esc.archive_id, '联系', `联系家属：${payload.contact_name || '未署名'}（${payload.tone || '平静'}）`,
    `${payload.refusal_reason ? '拒访原因：' + payload.refusal_reason + '；' : ''}${content}`, user?.name || '系统')
  return { contact: db.prepare('SELECT * FROM escalation_contacts WHERE id=?').get(info.lastInsertRowid) }
}

function phoneLogOf(archiveId, esc) {
  const lines = []
  const refusals = db.prepare('SELECT * FROM refusals WHERE archive_id=? ORDER BY arrived_at').all(archiveId)
  for (const r of refusals) {
    lines.push(`第${r.seq}次拒访 ${String(r.arrived_at).slice(5, 16)} 与${r.contact_name || '家属'}（${r.tone}）：${r.phone_content}` +
      `｜${r.baby_seen ? '看到婴儿：' + r.baby_status : '未看到婴儿'}`)
  }
  const contacts = db.prepare('SELECT * FROM escalation_contacts WHERE escalation_id=? ORDER BY created_at').all(esc.id)
  for (const c of contacts) {
    lines.push(`${c.created_at.slice(5, 16)} ${c.channel}联系${c.contact_name || '家属'}（${c.tone}）：${c.content}` +
      `｜${c.baby_seen ? '看到婴儿：' + c.baby_status : '未看到婴儿'}（${c.contacted_by}）`)
  }
  return lines.join('\n')
}

function pendingItemsOf(archiveId) {
  const last = db.prepare('SELECT * FROM visits WHERE archive_id=? ORDER BY visit_time DESC LIMIT 1').get(archiveId)
  return STANDARD_ITEMS.filter((it) => !it.done(last)).map((it) => it.label)
}

/** 社区医生/妇幼专员处置：上门复核 / 联系街道 / 家属同意恢复访视 */
export function resolveEscalation(escalationId, payload, user) {
  const esc = db.prepare('SELECT * FROM escalations WHERE id=?').get(escalationId)
  if (!esc) throw Object.assign(new Error('升级工单不存在'), { status: 404 })
  const action = payload.action
  const note = String(payload.note || '').trim()
  const userName = user?.name || '系统'
  const lastRefusal = esc.last_refusal_id
    ? db.prepare('SELECT * FROM refusals WHERE id=?').get(esc.last_refusal_id)
    : db.prepare('SELECT * FROM refusals WHERE archive_id=? ORDER BY arrived_at DESC LIMIT 1').get(esc.archive_id)

  if (action === 'recheck') {
    const time = payload.scheduled_time ? String(payload.scheduled_time).replace('T', ' ') : ''
    if (!time) throw Object.assign(new Error('请确定上门复核时间（明确后续安排）'), { status: 400 })
    // 自动带入：前次到达照片 + 电话沟通记录 + 未完成测量项
    const appt = db.prepare(`INSERT INTO appointments (archive_id, nurse_id, type, scheduled_time, status, reason)
                VALUES (?,?,?,?,'待访视',?)`)
      .run(esc.archive_id, user?.id || null, '复核', time,
        `${esc.level}决定上门复核（连续拒访 ${esc.refusal_count} 次）`)
    const r = db.prepare(`INSERT INTO rechecks
      (escalation_id, archive_id, appointment_id, decided_by, scheduled_time,
       pending_items, carried_photos, carried_phone_log, carried_refusal_reason, status)
      VALUES (?,?,?,?,?,?,?,?,?, '待上门')`).run(
      esc.id, esc.archive_id, appt.lastInsertRowid, userName, time,
      JSON.stringify(pendingItemsOf(esc.archive_id)),
      lastRefusal?.photos || '[]', phoneLogOf(esc.archive_id, esc), lastRefusal?.reason || '')
    db.prepare(`UPDATE escalations SET status='处置中' WHERE id=?`).run(esc.id)
    addEvent(esc.archive_id, '复核', `${esc.level}决定上门复核：${time}`,
      `已自动带入前次到达照片、电话沟通记录与未完成测量项，减少重复询问。${note ? '说明：' + note : ''}`, userName)
    return { recheck: db.prepare('SELECT * FROM rechecks WHERE id=?').get(r.lastInsertRowid), appointment_id: appt.lastInsertRowid }
  }

  if (action === 'street') {
    if (!note) throw Object.assign(new Error('联系街道需记录对接人与协调事项（明确后续安排）'), { status: 400 })
    db.prepare(`UPDATE escalations SET status='已联系街道' WHERE id=?`).run(esc.id)
    addEvent(esc.archive_id, '联系', `已联系街道/居委会协调上门`, note, userName)
    db.prepare(`INSERT INTO followups (archive_id, type, title, detail, created_by) VALUES (?,?,?,?,?)`)
      .run(esc.archive_id, '拒访升级', '街道已介入，待协调后上门复核', note, userName)
    return { ok: true }
  }

  if (action === 'resume') {
    const time = payload.scheduled_time ? String(payload.scheduled_time).replace('T', ' ') : ''
    if (!time) throw Object.assign(new Error('请与家属约定恢复访视的上门时间'), { status: 400 })
    db.prepare(`INSERT INTO appointments (archive_id, nurse_id, type, scheduled_time, status, reason)
                VALUES (?,?,?,?,'待访视',?)`)
      .run(esc.archive_id, null, '初访', time, '家属同意恢复访视（升级沟通后）')
    db.prepare(`UPDATE escalations SET status='已恢复访视', resolution=? WHERE id=?`)
      .run(`家属同意恢复访视，约 ${time} 上门。${note}`, esc.id)
    addEvent(esc.archive_id, '联系', `家属同意恢复访视，约 ${time} 上门`, note, userName)
    return { ok: true }
  }

  throw Object.assign(new Error('无效处置动作'), { status: 400 })
}

/** 成功访视后联动：完成待上门复核、闭环升级工单与「拒访升级」随访事项 */
export function settleEscalationAfterVisit(archiveId, visitId, nurseName) {
  const esc = openEscalation(archiveId)
  if (!esc) return
  const visit = db.prepare('SELECT appointment_id FROM visits WHERE id=?').get(visitId)
  const re = db.prepare(`SELECT * FROM rechecks WHERE archive_id=? AND status='待上门' ORDER BY id DESC LIMIT 1`)
    .get(archiveId)
  if (re && (!re.appointment_id || re.appointment_id === visit?.appointment_id || !visit?.appointment_id)) {
    db.prepare(`UPDATE rechecks SET status='已完成', result_note=? WHERE id=?`)
      .run(`随访视 #${visitId} 完成复核`, re.id)
  }
  db.prepare(`UPDATE escalations SET status='已闭环', resolved_at=datetime('now','localtime'),
              resolved_by=?, resolution=? WHERE id=?`)
    .run(nurseName, `上门访视 #${visitId} 已完成，连续拒访状态解除`, esc.id)
  for (const f of db.prepare(`SELECT * FROM followups WHERE archive_id=? AND status!='已闭环' AND type IN ('拒访升级','再次预约')`)
    .all(archiveId)) {
    closeFollowup(f.id, nurseName, `访视 #${visitId} 已完成，拒访后续安排落实`)
  }
  addEvent(archiveId, '闭环', `拒访升级工单已闭环`, `访视 #${visitId} 完成`, nurseName)
}

// ---------- 查询聚合 ----------
function parseRefusal(r) { return { ...r, photos: JSON.parse(r.photos || '[]') } }

export function getEscalation(id) {
  const esc = db.prepare('SELECT * FROM escalations WHERE id=?').get(id)
  if (!esc) return null
  const archive = db.prepare('SELECT * FROM archives WHERE id=?').get(esc.archive_id)
  const refusals = db.prepare('SELECT * FROM refusals WHERE archive_id=? ORDER BY arrived_at').all(esc.archive_id).map(parseRefusal)
  const contacts = db.prepare('SELECT * FROM escalation_contacts WHERE escalation_id=? ORDER BY created_at').all(esc.id)
  const rechecks = db.prepare('SELECT * FROM rechecks WHERE escalation_id=? ORDER BY created_at').all(esc.id)
    .map((r) => ({ ...r, pending_items: JSON.parse(r.pending_items || '[]'), carried_photos: JSON.parse(r.carried_photos || '[]') }))
  return { ...esc, archive, refusals, contacts, rechecks }
}

export function listEscalations(status) {
  let where = ''
  const args = []
  if (status === 'open') {
    where = `WHERE e.status != '已闭环'`
  } else if (status && status !== 'all') {
    where = `WHERE e.status=?`
    args.push(status)
  }
  return db.prepare(`
    SELECT e.*, ar.mother_name, ar.baby_name, ar.birth_date, ar.address,
           ar.contact_name, ar.contact_phone
    FROM escalations e JOIN archives ar ON ar.id=e.archive_id
    ${where}
    ORDER BY CASE e.status WHEN '待处置' THEN 0 WHEN '处置中' THEN 1 WHEN '已联系街道' THEN 2
                           WHEN '已恢复访视' THEN 3 ELSE 4 END, e.created_at DESC`).all(...args)
}

export function refusalsOfArchive(archiveId) {
  return db.prepare('SELECT * FROM refusals WHERE archive_id=? ORDER BY arrived_at').all(archiveId).map(parseRefusal)
}

export function escalationOfArchive(archiveId) {
  const rows = db.prepare('SELECT * FROM escalations WHERE archive_id=? ORDER BY created_at DESC').all(archiveId)
  return rows.map((e) => getEscalation(e.id))
}
