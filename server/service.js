// 访视落库与随访闭环的领域服务：种子数据与 HTTP 路由共用，保证行为一致
import db, { addEvent } from './db.js'
import { assessVisit } from './risk.js'
import { settleEscalationAfterVisit } from './escalation.js'

const VISIT_COLS = ['client_id','appointment_id','archive_id','nurse_id','visit_time','weight','bilirubin',
  'bilirubin_site','cord','stool_count','stool_color','urine_count','feeding_type','feeding_freq','spit_up',
  'sleep','breast','mood','wound_check','care_ability','device_issue','photos','advice','risk_level','flags',
  'need_recheck','need_referral','need_lactation','need_phone','created_offline']

function openFollowup(archiveId, type, title, detail, dueDate, visitId, createdBy = '系统') {
  db.prepare(`INSERT INTO followups (archive_id, visit_id, type, title, detail, due_date, created_by)
              VALUES (?,?,?,?,?,?,?)`).run(archiveId, visitId ?? null, type, title, detail, dueDate, createdBy)
  addEvent(archiveId, type, title, detail, createdBy)
}

export function closeFollowup(id, closedBy, note = '') {
  const f = db.prepare('SELECT * FROM followups WHERE id=?').get(id)
  if (!f) return null
  if (f.status !== '已闭环') {
    db.prepare(`UPDATE followups SET status='已闭环', closed_at=datetime('now','localtime'),
                closed_by=?, close_note=? WHERE id=?`).run(closedBy, note, id)
    addEvent(f.archive_id, '闭环', `【${f.type}】${f.title} 已闭环`, note, closedBy)
  }
  return db.prepare('SELECT * FROM followups WHERE id=?').get(id)
}

/** 提交一次访视：风险评估 → 落库 → 更新预约 → 生成/闭环随访事项 → 写时间线 */
export function createVisit(payload, nurse) {
  const archive = db.prepare('SELECT * FROM archives WHERE id=?').get(payload.archive_id)
  if (!archive) throw Object.assign(new Error('母婴档案不存在'), { status: 404 })

  // 幂等：离线草稿补录带 client_id，重复提交返回已有记录
  if (payload.client_id) {
    const dup = db.prepare('SELECT * FROM visits WHERE client_id=?').get(payload.client_id)
    if (dup) return { visit: dup, duplicated: true, assessment: JSON.parse(dup.flags) }
  }

  const v = {
    client_id: payload.client_id || null,
    appointment_id: payload.appointment_id || null,
    archive_id: archive.id,
    nurse_id: nurse?.id || payload.nurse_id || null,
    visit_time: payload.visit_time || new Date().toISOString().slice(0, 16),
    weight: num(payload.weight), bilirubin: num(payload.bilirubin),
    bilirubin_site: payload.bilirubin_site || '额头',
    cord: payload.cord || '干燥',
    stool_count: int(payload.stool_count), stool_color: payload.stool_color || '黄色',
    urine_count: int(payload.urine_count),
    feeding_type: payload.feeding_type || archive.feeding_type,
    feeding_freq: int(payload.feeding_freq),
    spit_up: payload.spit_up || '无', sleep: payload.sleep || '正常',
    breast: payload.breast || '正常', mood: payload.mood || '平稳',
    wound_check: payload.wound_check || archive.maternal_wound || '愈合良好',
    care_ability: payload.care_ability || archive.care_ability || '良好',
    device_issue: payload.device_issue ? 1 : 0,
    photos: JSON.stringify(payload.photos || []),
    created_offline: payload.created_offline ? 1 : 0,
  }
  const r = assessVisit(archive, v)
  v.risk_level = r.riskLevel
  v.flags = JSON.stringify(r.flags)
  v.need_recheck = r.needRecheck; v.need_referral = r.needReferral
  v.need_lactation = r.needLactation; v.need_phone = r.needPhone
  v.advice = (payload.advice && payload.advice.trim()) || r.advice

  const cols = VISIT_COLS.join(',')
  const marks = VISIT_COLS.map(() => '?').join(',')
  const info = db.prepare(`INSERT INTO visits (${cols}) VALUES (${marks})`)
    .run(...VISIT_COLS.map(c => v[c]))
  const visitId = info.lastInsertRowid

  // 预约状态联动
  if (v.appointment_id) {
    db.prepare(`UPDATE appointments SET status='已完成', updated_at=datetime('now','localtime') WHERE id=?`)
      .run(v.appointment_id)
  }
  // 本次访视即完成了此前开放的“复查/再次预约”事项 → 自动闭环
  const doneTypes = ['复查', '再次预约']
  for (const f of db.prepare(`SELECT * FROM followups WHERE archive_id=? AND status!='已闭环'`).all(archive.id)) {
    if (doneTypes.includes(f.type)) closeFollowup(f.id, nurse?.name || '系统', `访视 #${visitId} 已完成`)
  }

  // 生成新的随访事项
  const nurseName = nurse?.name || '系统'
  const summary = `黄疸 ${v.bilirubin ?? '-'} µmol/L（第 ${r.ageDays} 天，阈值 ${r.threshold}），体重 ${v.weight ?? '-'} g` +
    (r.weightLossPct != null ? `（较出生 ${r.weightLossPct}%）` : '') + `，喂养 ${v.feeding_freq} 次/日`
  if (v.need_referral) {
    openFollowup(archive.id, '转诊', '转诊儿科评估', summary + '。' + r.flags.join('；'),
      null, visitId, nurseName)
  }
  if (v.need_recheck) {
    const due = plusDays(v.visit_time, 1)
    openFollowup(archive.id, '复查', '黄疸/体重复查', summary + '。建议 24~48 小时内复查。',
      due, visitId, nurseName)
    db.prepare(`INSERT INTO appointments (archive_id, nurse_id, type, scheduled_time, status, reason)
                VALUES (?,?,?,?, '待访视', '系统按风险自动生成')`)
      .run(archive.id, v.nurse_id, '复查', `${due} 09:00:00`)
  }
  if (v.need_lactation) openFollowup(archive.id, '母乳指导', '安排母乳喂养指导', summary, null, visitId, nurseName)
  if (v.need_phone) openFollowup(archive.id, '电话随访', '电话随访（产妇情绪/家庭照护）', summary, null, visitId, nurseName)

  addEvent(archive.id, '访视', `完成访视（风险：${v.risk_level}）`,
    summary + (v.device_issue ? '。【设备故障，手工记录】' : '') + (v.created_offline ? '。【离线草稿补录同步】' : ''),
    nurseName)

  // 若该户处于连续拒访升级流程，成功上门即落实后续安排：完成复核、闭环升级工单
  settleEscalationAfterVisit(archive.id, visitId, nurseName)

  return { visit: db.prepare('SELECT * FROM visits WHERE id=?').get(visitId), duplicated: false, assessment: r }
}

function num(x) { return x === undefined || x === null || x === '' ? null : Number(x) }
function int(x) { const n = parseInt(x, 10); return Number.isFinite(n) ? n : 0 }
function plusDays(isoLike, days) {
  const d = new Date(String(isoLike).replace(' ', 'T'))
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
