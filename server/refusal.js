// 家属拒访与连续拒访升级的领域服务
// 规则：
//  - 拒访不关闭访视任务，必须登记明确后续安排（再次预约 / 电话随访 / 等待家属联系）
//  - 同一家庭连续拒访达到 2 次，自动升级给社区医生；升级单闭环后再次拒访，升级至妇幼专员
//  - 升级流程中每次联系都记录对象、语气、拒访原因、是否看到婴儿
//  - 社区医生决定上门复核后，生成复核预约；复核访视完成后升级单才可闭环
import db, { addEvent } from './db.js'
import { closeFollowup } from './service.js'

export const REFUSAL_REASONS = ['不信任访视', '担心打扰/休息', '家庭内部矛盾', '不愿暴露婴儿状况', '隐私顾虑', '已自行就医', '其他']
export const TONES = ['平和', '回避', '抵触', '激动', '不配合']
export const BABY_VISIBLE = ['是', '否', '不确定']
export const ESCALATE_AFTER = 2

const parseJson = (s, d) => { try { return JSON.parse(s || '') ?? d } catch { return d } }

export function refusalRow(r) {
  return r ? { ...r, photos: parseJson(r.photos, []), created_offline: !!r.created_offline } : r
}

/** 登记一次家属拒访（隔门、仅电话沟通） */
function createRefusalImpl(payload, nurse) {
  const archive = db.prepare('SELECT * FROM archives WHERE id=?').get(payload.archive_id)
  if (!archive) throw Object.assign(new Error('母婴档案不存在'), { status: 404 })
  if (!payload.phone_content || !String(payload.phone_content).trim())
    throw Object.assign(new Error('请记录电话沟通内容'), { status: 400 })
  if (!payload.followup_kind)
    throw Object.assign(new Error('拒访不能直接结束，必须选择明确的后续安排'), { status: 400 })
  const followTime = payload.followup_time ? String(payload.followup_time).replace('T', ' ') : null
  if (payload.followup_kind === '再次预约' && !followTime)
    throw Object.assign(new Error('再次预约必须填写预约时间'), { status: 400 })

  if (payload.client_id) {
    const dup = db.prepare('SELECT * FROM refusals WHERE client_id=?').get(payload.client_id)
    if (dup) return { refusal: refusalRow(dup), duplicated: true, escalated: !!dup.escalation_id }
  }

  const seq = db.prepare('SELECT COUNT(*) c FROM refusals WHERE archive_id=?').get(archive.id).c + 1
  const nurseId = nurse?.id || payload.nurse_id || null
  const nurseName = nurse?.name || '护士'

  const info = db.prepare(`INSERT INTO refusals
    (client_id, appointment_id, archive_id, nurse_id, seq, arrived_at, photos, contact_role,
     phone_content, reason_code, reason_detail, tone, baby_visible, followup_kind, followup_time,
     followup_note, created_offline)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      payload.client_id || null, payload.appointment_id || null, archive.id, nurseId, seq,
      payload.arrived_at || new Date().toISOString().slice(0, 16),
      JSON.stringify(payload.photos || []),
      payload.contact_role || archive.contact_name || '',
      String(payload.phone_content).trim(),
      payload.reason_code || '其他', payload.reason_detail || '',
      payload.tone || '平和', payload.baby_visible || '否',
      payload.followup_kind, payload.followup_time || null, payload.followup_note || '',
      payload.created_offline ? 1 : 0,
    )
  const refusalId = info.lastInsertRowid

  // 预约标记为「拒访」（区别于无人应答的「未开门」）
  if (payload.appointment_id) {
    db.prepare(`UPDATE appointments SET status='拒访', reason=?, updated_at=datetime('now','localtime') WHERE id=?`)
      .run(`家属拒访：${payload.reason_code}`, payload.appointment_id)
  }

  // 明确后续安排 —— 拒访绝不直接关闭访视任务，一律留下开放事项/预约
  let followupAppointmentId = null
  if (payload.followup_kind === '再次预约') {
    const src = payload.appointment_id ? db.prepare('SELECT type FROM appointments WHERE id=?').get(payload.appointment_id) : null
    const ai = db.prepare(`INSERT INTO appointments (archive_id, nurse_id, type, scheduled_time, status, reason)
      VALUES (?,?,?,?, '待访视', ?)`)
      .run(archive.id, nurseId, src?.type || '初访', followTime, `第 ${seq} 次拒访后约定再次上门`).lastInsertRowid
    followupAppointmentId = ai
    db.prepare(`INSERT INTO followups (archive_id, type, title, detail, due_date, created_by) VALUES (?,?,?,?,?,?)`)
      .run(archive.id, '再次预约', `第 ${seq} 次拒访，已约定再次上门`,
        `电话沟通：${payload.phone_content}；再约时间 ${followTime}`, followTime.slice(0, 10), nurseName)
    addEvent(archive.id, '改约', `拒访后再次预约 ${followTime}`, payload.phone_content, nurseName)
  } else if (payload.followup_kind === '电话随访') {
    db.prepare(`INSERT INTO followups (archive_id, type, title, detail, due_date, created_by) VALUES (?,?,?,?,?,?)`)
      .run(archive.id, '电话随访', `家属拒访，安排电话随访`,
        `电话沟通：${payload.phone_content}${followTime ? `；计划再次联系 ${followTime}` : ''}`,
        followTime ? followTime.slice(0, 10) : null, nurseName)
  } else {
    // 等待家属联系：仍是开放事项，必须跟进
    db.prepare(`INSERT INTO followups (archive_id, type, title, detail, due_date, created_by) VALUES (?,?,?,?,?,?)`)
      .run(archive.id, '再次预约', `家属拒访，等待家属主动联系后安排上门`,
        `电话沟通：${payload.phone_content}；家属表示将主动联系，护士需持续跟进`, null, nurseName)
  }
  if (followupAppointmentId) db.prepare('UPDATE refusals SET followup_appointment_id=? WHERE id=?').run(followupAppointmentId, refusalId)

  addEvent(archive.id, '拒访', `第 ${seq} 次上门被拒（仅电话沟通）`,
    `到达 ${payload.arrived_at || ''}；对象 ${payload.contact_role || '-'}；原因：${payload.reason_code}${payload.reason_detail ? '（' + payload.reason_detail + '）' : ''}；语气：${payload.tone}；看到婴儿：${payload.baby_visible}；电话内容：${payload.phone_content}`,
    nurseName)

  // 连续拒访升级
  let escalated = false
  if (seq >= ESCALATE_AFTER) {
    const openEsc = db.prepare(`SELECT * FROM escalations WHERE archive_id=? AND status!='已闭环'`).get(archive.id)
    if (!openEsc) {
      const prior = db.prepare('SELECT COUNT(*) c FROM escalations WHERE archive_id=?').get(archive.id).c
      const level = prior > 0 ? '妇幼专员' : '社区医生'
      const eid = db.prepare(`INSERT INTO escalations
        (archive_id, status, level, handler, trigger_refusal_id, refusal_count)
        VALUES (?, '待处置', ?, ?, ?, ?)`)
        .run(archive.id, level, level, refusalId, seq).lastInsertRowid
      db.prepare('UPDATE refusals SET escalation_id=? WHERE id=?').run(eid, refusalId)
      db.prepare(`INSERT INTO followups (archive_id, type, title, detail, created_by) VALUES (?,?,?,?,?)`)
        .run(archive.id, '拒访升级', `连续 ${seq} 次拒访，升级${level}`,
          `家属连续拒访，仅能电话沟通；请${level}评估上门复核或联系街道`, '系统')
      addEvent(archive.id, '升级', `连续 ${seq} 次拒访，自动升级${level}`,
        `最近一次拒访原因：${payload.reason_code}；语气：${payload.tone}；看到婴儿：${payload.baby_visible}`, '系统')
      escalated = true
    }
  }

  return {
    refusal: refusalRow(db.prepare('SELECT * FROM refusals WHERE id=?').get(refusalId)),
    duplicated: false,
    escalated,
    followup_appointment_id: followupAppointmentId,
  }
}

// 整笔登记在事务内执行：任一步骤校验失败都不会留下孤儿拒访记录/被改状态的预约
export const createRefusal = db.transaction((payload, nurse) => createRefusalImpl(payload, nurse))

/** 升级流程中追加一次联系记录（对象、语气、拒访原因、是否看到婴儿） */
function addContactImpl(escalationId, payload, user) {
  const esc = db.prepare('SELECT * FROM escalations WHERE id=?').get(escalationId)
  if (!esc) throw Object.assign(new Error('升级单不存在'), { status: 404 })
  if (esc.status === '已闭环') throw Object.assign(new Error('升级单已闭环，不能再追加联系记录'), { status: 400 })
  if (!payload.target || !String(payload.target).trim())
    throw Object.assign(new Error('请填写联系对象'), { status: 400 })

  const role = user?.role === 'doctor' ? '社区医生' : user?.title === '妇幼专员' ? '妇幼专员' : (payload.contact_by_role || '护士')
  const info = db.prepare(`INSERT INTO escalation_contacts
    (escalation_id, archive_id, contact_at, contact_by, contact_by_role, target, channel, tone, refusal_reason, baby_visible, note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      escalationId, esc.archive_id,
      payload.contact_at || new Date().toISOString().slice(0, 16),
      user?.name || payload.contact_by || '工作人员', role,
      String(payload.target).trim(), payload.channel || '电话',
      payload.tone || '平和', payload.refusal_reason || '', payload.baby_visible || '否',
      payload.note || '',
    )
  if (esc.status === '待处置') db.prepare(`UPDATE escalations SET status='处置中' WHERE id=?`).run(escalationId)
  addEvent(esc.archive_id, '联系', `${role}联系${payload.target}`,
    `渠道：${payload.channel || '电话'}；语气：${payload.tone || '平和'}；拒访原因：${payload.refusal_reason || '-'}；看到婴儿：${payload.baby_visible || '否'}${payload.note ? '；' + payload.note : ''}`,
    user?.name || '工作人员')
  return db.prepare('SELECT * FROM escalation_contacts WHERE id=?').get(info.lastInsertRowid)
}
export const addContact = db.transaction((escalationId, payload, user) => addContactImpl(escalationId, payload, user))

/** 社区医生/妇幼专员处置：上门复核 / 联系街道 / 电话随访 / 转妇幼专员 / 继续观察 */
function decideEscalationImpl(escalationId, payload, user) {
  const esc = db.prepare('SELECT * FROM escalations WHERE id=?').get(escalationId)
  if (!esc) throw Object.assign(new Error('升级单不存在'), { status: 404 })
  if (esc.status === '已闭环') throw Object.assign(new Error('升级单已闭环'), { status: 400 })
  const valid = ['上门复核', '联系街道', '电话随访', '转妇幼专员', '继续观察']
  const decision = payload.decision
  if (!valid.includes(decision)) throw Object.assign(new Error('无效处置决定'), { status: 400 })

  let level = esc.level
  let reviewAppointmentId = esc.review_appointment_id
  const followTime = payload.followup_time ? String(payload.followup_time).replace('T', ' ') : null

  if (decision === '上门复核') {
    if (!followTime) throw Object.assign(new Error('上门复核必须安排复核时间'), { status: 400 })
    reviewAppointmentId = db.prepare(`INSERT INTO appointments (archive_id, nurse_id, type, scheduled_time, status, reason)
      VALUES (?,?,?,?,'待访视',?)`)
      .run(esc.archive_id, null, '复核', followTime, `${user.name}决定上门复核（连续拒访升级）`).lastInsertRowid
    db.prepare(`INSERT INTO followups (archive_id, type, title, detail, due_date, created_by) VALUES (?,?,?,?,?,?)`)
      .run(esc.archive_id, '上门复核', '社区医生/妇幼专员决定上门复核',
        `${payload.note || '连续拒访，上门核实婴儿状况'}；复核时间 ${followTime}。复核时自动带入上次到达照片、电话记录与未完成测量项`,
        followTime.slice(0, 10), user.name)
  } else if (decision === '联系街道') {
    if (!payload.note || !String(payload.note).trim())
      throw Object.assign(new Error('联系街道需说明协同事项'), { status: 400 })
    db.prepare(`INSERT INTO followups (archive_id, type, title, detail, due_date, created_by) VALUES (?,?,?,?,?,?)`)
      .run(esc.archive_id, '联系街道', '联系街道/居委会协同上门',
        `${payload.note}${followTime ? '；计划时间 ' + followTime : ''}`, followTime ? followTime.slice(0, 10) : null, user.name)
  } else if (decision === '转妇幼专员') {
    level = '妇幼专员'
    db.prepare(`INSERT INTO followups (archive_id, type, title, detail, due_date, created_by) VALUES (?,?,?,?,?,?)`)
      .run(esc.archive_id, '拒访升级', '升级至妇幼专员处理',
        payload.note || '社区医生评估后转妇幼专员', followTime ? followTime.slice(0, 10) : null, user.name)
  } else {
    // 电话随访 / 继续观察：同样必须有明确的后续联系安排
    if (!followTime) throw Object.assign(new Error('必须填写下次联系/跟进时间，拒访家庭不能无后续安排'), { status: 400 })
    db.prepare(`INSERT INTO followups (archive_id, type, title, detail, due_date, created_by) VALUES (?,?,?,?,?,?)`)
      .run(esc.archive_id, '电话随访', decision === '继续观察' ? '继续观察并定时联系' : '拒访升级后电话随访',
        [payload.note || '', followTime ? `计划下次联系 ${followTime}` : ''].filter(Boolean).join('；'),
        followTime.slice(0, 10), user.name)
  }

  db.prepare(`UPDATE escalations SET status='处置中', level=?, handler=?, decision=?, decision_note=?,
    decided_by=?, decided_at=datetime('now','localtime'), review_appointment_id=? WHERE id=?`)
    .run(level, decision === '转妇幼专员' ? '妇幼专员' : (user.name || esc.handler), decision,
      payload.note || '', user.name, reviewAppointmentId, escalationId)

  addEvent(esc.archive_id, '决策', `${user.name}处置拒访升级：${decision}`,
    [payload.note || '', followTime ? `时间 ${followTime}` : ''].filter(Boolean).join('；'), user.name)
  return db.prepare('SELECT * FROM escalations WHERE id=?').get(escalationId)
}
export const decideEscalation = db.transaction((escalationId, payload, user) => decideEscalationImpl(escalationId, payload, user))

/** 闭环升级单：安排了上门复核的，必须等复核访视完成 */
function closeEscalationImpl(escalationId, user, note = '') {
  const esc = db.prepare('SELECT * FROM escalations WHERE id=?').get(escalationId)
  if (!esc) return null
  if (esc.status === '已闭环') return esc
  if (esc.review_appointment_id) {
    const appt = db.prepare('SELECT status FROM appointments WHERE id=?').get(esc.review_appointment_id)
    if (appt && appt.status !== '已完成')
      throw Object.assign(new Error('上门复核尚未完成（复核预约未标记已完成），不能闭环升级单'), { status: 400 })
  } else if (!note.trim()) {
    throw Object.assign(new Error('请说明闭环依据（如街道反馈/家属恢复配合/电话核实结果）'), { status: 400 })
  }
  db.prepare(`UPDATE escalations SET status='已闭环', closed_at=datetime('now','localtime'),
    closed_by=?, close_note=? WHERE id=?`).run(user?.name || '系统', note, escalationId)
  for (const f of db.prepare(`SELECT * FROM followups WHERE archive_id=? AND status!='已闭环' AND type IN ('拒访升级','上门复核','联系街道')`).all(esc.archive_id)) {
    closeFollowup(f.id, user?.name || '系统', `拒访升级单 #${escalationId} 闭环：${note}`)
  }
  addEvent(esc.archive_id, '闭环', `拒访升级单闭环`, note, user?.name || '系统')
  return db.prepare('SELECT * FROM escalations WHERE id=?').get(escalationId)
}
export const closeEscalation = db.transaction((escalationId, user, note) => closeEscalationImpl(escalationId, user, note))

/**
 * 复核信息包：社区医生决定上门复核时自动带入
 * 前一次护士到达照片、全部电话沟通记录、未完成测量项，减少重复询问
 */
export function reviewBrief(archiveId) {
  const lastRefusal = db.prepare('SELECT * FROM refusals WHERE archive_id=? ORDER BY seq DESC, id DESC LIMIT 1').get(archiveId)
  const refusals = db.prepare('SELECT * FROM refusals WHERE archive_id=? ORDER BY seq DESC, id DESC').all(archiveId).map(refusalRow)
  // 最近一次带到达照片的拒访记录（可能第 2 次上门未拍照，则带回第 1 次的）
  const photoRefusal = refusals.find((r) => Array.isArray(r.photos) && r.photos.length > 0) || null
  const escalation = db.prepare(`SELECT * FROM escalations WHERE archive_id=? AND status!='已闭环' ORDER BY id DESC LIMIT 1`).get(archiveId)
  const contacts = escalation
    ? db.prepare('SELECT * FROM escalation_contacts WHERE escalation_id=? ORDER BY id DESC').all(escalation.id)
    : []

  // 未完成测量项：取最近一次访视中未采集/为默认空值的项目；从未访视过则全部待完成
  const lastVisit = db.prepare('SELECT * FROM visits WHERE archive_id=? ORDER BY visit_time DESC, id DESC LIMIT 1').get(archiveId)
  const ITEMS = [
    ['weight', '体重'], ['bilirubin', '经皮黄疸'], ['cord', '脐带情况'],
    ['stool_count', '大便次数/颜色'], ['urine_count', '小便次数'],
    ['feeding_freq', '喂养方式与频次'], ['spit_up', '吐奶情况'], ['sleep', '睡眠状态'],
    ['breast', '产妇乳房'], ['mood', '产妇情绪'], ['wound_check', '产妇伤口'],
    ['care_ability', '家庭照护能力'],
  ]
  const pendingMeasurements = lastVisit
    ? ITEMS.filter(([k]) => lastVisit[k] === null || lastVisit[k] === 0 || lastVisit[k] === '').map(([, label]) => label)
    : ITEMS.map(([, label]) => label)

  return {
    hasOpenEscalation: !!escalation,
    escalation: escalation || null,
    lastRefusal: lastRefusal ? refusalRow(lastRefusal) : null,
    photoRefusal,
    refusals,
    contacts,
    lastVisit: lastVisit
      ? { ...lastVisit, flags: parseJson(lastVisit.flags, []), photos: parseJson(lastVisit.photos, []) }
      : null,
    pendingMeasurements,
  }
}

/** 复核访视完成后自动闭环升级流程（由 createVisit 调用） */
function closeEscalationAfterReviewImpl(archiveId, visitId, nurseName) {
  const esc = db.prepare(`SELECT * FROM escalations WHERE archive_id=? AND status!='已闭环'
    AND decision='上门复核' ORDER BY id DESC LIMIT 1`).get(archiveId)
  if (!esc) return null
  if (esc.review_appointment_id) {
    db.prepare(`UPDATE appointments SET status='已完成', updated_at=datetime('now','localtime') WHERE id=?`)
      .run(esc.review_appointment_id)
  }
  // 拒访链路上遗留的电话随访事项，随复核完成一并闭环
  for (const f of db.prepare(`SELECT * FROM followups WHERE archive_id=? AND status!='已闭环'
    AND type='电话随访' AND title LIKE '%拒访%'`).all(archiveId)) {
    closeFollowup(f.id, nurseName, `上门复核访视 #${visitId} 已完成，拒访电话随访随之闭环`)
  }
  const closed = closeEscalation(esc.id, { name: nurseName }, `上门复核访视 #${visitId} 已完成，婴儿状况已现场核实`)
  addEvent(archiveId, '闭环', '上门复核完成，连续拒访升级流程自动闭环',
    `复核访视 #${visitId}`, nurseName)
  return closed
}
export const closeEscalationAfterReview = db.transaction((archiveId, visitId, nurseName) =>
  closeEscalationAfterReviewImpl(archiveId, visitId, nurseName))

export function escalationRow(e) {
  if (!e) return e
  return {
    ...e,
    contacts: db.prepare('SELECT * FROM escalation_contacts WHERE escalation_id=? ORDER BY id').all(e.id),
  }
}
