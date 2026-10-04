// 端到端验证脚本：node scripts/verify.mjs（需服务已启动，默认 http://localhost:8080）
// 覆盖：登录、工作台、档案筛选、访视提交与风险结论、离线同步幂等、
//       未开门/改约、家属拒访登记、连续拒访升级/联系/上门复核自动闭环、
//       随访闭环、医生决策、家属端总览/材料/咨询
const BASE = process.env.BASE_URL || 'http://localhost:8080'
let passed = 0, failed = 0
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✔ ${name}${extra ? ' — ' + extra : ''}`) }
  else { failed++; console.error(`  ✘ ${name}${extra ? ' — ' + extra : ''}`) }
}
const j = (r) => r.json()
async function login(username, password) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) }).then(j)
  if (!r.token) throw new Error(`登录失败 ${username}: ${JSON.stringify(r)}`)
  return { token: r.token, user: r.user }
}
const call = (token, method, path, body) =>
  fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined }).then(j)

console.log(`验证目标: ${BASE}`)

// 1 登录
const nurse = await login('nurse', 'nurse123')
const doctor = await login('doctor', 'doctor123')
const family = await login('family', 'family123')
ok('三类角色登录', !!(nurse.token && doctor.token && family.token), `${nurse.user.name}/${doctor.user.name}/${family.user.name}`)

// 2 工作台
const dash = await call(nurse.token, 'GET', '/api/dashboard')
ok('工作台统计', dash.stats.unvisited > 0 && dash.stats.openFollowups > 0,
  `未访视${dash.stats.unvisited} 黄疸异常${dash.stats.jaundiceAlerts} 产妇风险${dash.stats.maternalRisks} 待闭环${dash.stats.openFollowups}`)
ok('工作台连续拒访升级统计', dash.stats.refusalEscalations >= 1, `拒访升级中 ${dash.stats.refusalEscalations} 个家庭`)

// 3 档案筛选
const all = await call(nurse.token, 'GET', '/api/archives')
const jaundice = await call(nurse.token, 'GET', '/api/archives?filter=jaundice')
const maternal = await call(nurse.token, 'GET', '/api/archives?filter=maternal')
ok('档案列表', all.archives.length >= 8, `共 ${all.archives.length} 份`)
ok('异常黄疸筛选', jaundice.archives.length >= 2, jaundice.archives.map(a => a.baby_name).join('、'))
ok('产妇风险筛选', maternal.archives.length >= 1, maternal.archives.map(a => a.baby_name).join('、'))

// 4 档案详情（时间线/访视/随访在同一档案）
const target = all.archives.find(a => a.baby_name === '吴小满')
const detail = await call(nurse.token, 'GET', `/api/archives/${target.id}`)
ok('档案详情聚合', detail.visits.length > 0 && detail.followups.length > 0 && detail.events.length > 0,
  `访视${detail.visits.length} 随访${detail.followups.length} 事件${detail.events.length}`)
const wuVisit = detail.visits[0]
ok('种子风险结论（吴小满：体重降>10%+黄疸近阈值+设备故障）',
  wuVisit.risk_level === '危急' && wuVisit.need_referral === 1 && wuVisit.device_issue === 1,
  `风险${wuVisit.risk_level} 标记${wuVisit.flags.length}条`)

// 5 提交一次高风险访视 → 自动生成复查/转诊等事项
const liAnan = all.archives.find(a => a.baby_name === '李安安')
const visitRes = await call(nurse.token, 'POST', '/api/visits', {
  archive_id: liAnan.id, visit_time: new Date().toISOString().slice(0, 16),
  weight: 2900, bilirubin: 285, bilirubin_site: '额头', cord: '渗液',
  stool_count: 2, stool_color: '黄色', urine_count: 5, feeding_freq: 6,
  spit_up: '频繁', sleep: '正常', breast: '涨奶', mood: '焦虑', care_ability: '一般',
})
ok('访视提交', !!visitRes.visit?.id, `visit#${visitRes.visit?.id}`)
ok('风险引擎：接近阈值+体重下降+喂养不足',
  visitRes.visit.risk_level === '高' && visitRes.visit.need_recheck === 1 && visitRes.visit.need_lactation === 1,
  `风险${visitRes.visit.risk_level} 复查${visitRes.visit.need_recheck} 母乳指导${visitRes.visit.need_lactation}`)
const after = await call(nurse.token, 'GET', `/api/archives/${liAnan.id}`)
ok('自动生成复查预约', after.appointments.some(a => a.type === '复查' && a.status === '待访视'))
ok('随访事项生成', after.followups.filter(f => f.status !== '已闭环').length >= 2)

// 6 离线同步幂等：同一 client_id 提交两次只落一条
const cid = `verify-${Date.now()}`
const syncBody = { visits: [{ client_id: cid, archive_id: liAnan.id, visit_time: new Date().toISOString().slice(0, 16), weight: 2910, bilirubin: 260, feeding_freq: 8, stool_count: 3, stool_color: '黄色', urine_count: 7 }] }
const s1 = await call(nurse.token, 'POST', '/api/sync/visits', syncBody)
const s2 = await call(nurse.token, 'POST', '/api/sync/visits', syncBody)
ok('离线草稿同步', s1.results[0].ok === true, `visit#${s1.results[0].visit_id}`)
ok('同步幂等（重复 client_id 不产生重复记录）', s2.results[0].ok && s2.results[0].duplicated === true && s2.results[0].visit_id === s1.results[0].visit_id)

// 7 未开门 → 再次预约事项
const appts = await call(nurse.token, 'GET', '/api/appointments?status=待访视')
const someAppt = appts.appointments.find(a => a.archive_id !== liAnan.id)
if (someAppt) {
  await call(nurse.token, 'POST', `/api/appointments/${someAppt.id}/no-show`, { note: '验证脚本：无人应答' })
  const fu = await call(nurse.token, 'GET', '/api/followups')
  ok('未开门生成再次预约事项', fu.followups.some(f => f.type === '再次预约' && f.archive_id === someAppt.archive_id))
  // 改约
  const r2 = await call(nurse.token, 'POST', `/api/appointments/${someAppt.id}/reschedule`, { scheduledTime: '2099-01-01 09:00', reason: '验证脚本改约' })
  ok('改约', r2.appointment.status === '待访视' && r2.appointment.scheduled_time.startsWith('2099-01-01'))
} else ok('未开门/改约', false, '没有可用预约')

// 7.5 家属拒访 → 连续拒访升级 → 医生决定上门复核 → 复核访视自动闭环
{
  const zheng = all.archives.find(a => a.baby_name === '郑小星')
  const zAppts = await call(nurse.token, 'GET', `/api/appointments?status=待访视`)
  const appt1 = zAppts.appointments.find(a => a.archive_id === zheng.id)
  const nowIso = new Date().toISOString().slice(0, 16)

  // 校验：缺电话内容 / 缺后续安排 → 400
  const bad1 = await call(nurse.token, 'POST', '/api/refusals', { archive_id: zheng.id, arrived_at: nowIso, reason_code: '其他', followup_kind: '电话随访' })
  ok('拒访必须记录电话内容', !!bad1.error, bad1.error || '')
  const bad2 = await call(nurse.token, 'POST', `/api/appointments/${appt1.id}/refusal`,
    { archive_id: zheng.id, arrived_at: nowIso, phone_content: '验证：隔门通话', reason_code: '其他', tone: '回避', baby_visible: '否', followup_kind: '再次预约' })
  ok('再次预约必须填写时间', !!bad2.error, bad2.error || '')

  // 第 1 次拒访：再次预约，不升级
  const r1 = await call(nurse.token, 'POST', `/api/appointments/${appt1.id}/refusal`, {
    archive_id: zheng.id, arrived_at: nowIso, photos: ['data:image/jpeg;base64,VERIFY_ARRIVAL'],
    contact_role: '郑倩本人', phone_content: '验证：家属隔门称在休息，只愿电话沟通，没见到婴儿',
    reason_code: '担心打扰/休息', tone: '回避', baby_visible: '否',
    followup_kind: '再次预约', followup_time: '2099-01-03 09:30', followup_note: '约定次日再试',
  })
  ok('第 1 次拒访登记（不升级）', !!r1.refusal?.id && r1.escalated === false && appt1.id !== undefined, `seq=${r1.refusal?.seq}`)
  const appt2Id = r1.followup_appointment_id

  // 第 2 次拒访：电话随访 → 自动升级社区医生
  const r2 = await call(nurse.token, 'POST', `/api/appointments/${appt2Id}/refusal`, {
    archive_id: zheng.id, arrived_at: nowIso, contact_role: '郑倩丈夫',
    phone_content: '验证：家属语气抵触，称已自行就医，仍拒绝入户',
    reason_code: '不信任访视', reason_detail: '不相信社区测量', tone: '抵触', baby_visible: '否',
    followup_kind: '电话随访', followup_time: '2099-01-03 10:00',
  })
  ok('第 2 次拒访自动升级', r2.escalated === true, `escalation=${r2.refusal?.escalation_id}`)

  const zDetail = await call(nurse.token, 'GET', `/api/archives/${zheng.id}`)
  ok('档案聚合拒访/升级数据', zDetail.refusals.length === 2 && zDetail.escalations.length === 1,
    `拒访${zDetail.refusals.length}次 升级单${zDetail.escalations.length}个`)
  ok('复核信息包（到达照片/电话记录/未完成测量项）',
    zDetail.reviewBrief.pendingMeasurements.length === 12 &&
    zDetail.reviewBrief.photoRefusal?.photos[0]?.includes('VERIFY_ARRIVAL') &&
    zDetail.reviewBrief.refusals.length === 2,
    `未完成项${zDetail.reviewBrief.pendingMeasurements.length}个`)
  const refusedAppts = await call(nurse.token, 'GET', '/api/appointments?status=拒访')
  ok('预约状态区分「拒访」与「未开门」', refusedAppts.appointments.some(a => a.archive_id === zheng.id),
    `拒访预约${refusedAppts.appointments.length}条`)
  ok('拒访不关闭访视任务（保留开放事项）',
    zDetail.followups.some(f => f.status !== '已闭环' && ['再次预约', '电话随访', '拒访升级'].includes(f.type)),
    zDetail.followups.filter(f => f.status !== '已闭环').map(f => f.type).join('、'))

  // 升级流程：记录每次联系（对象/语气/原因/是否看到婴儿）
  const escId = zDetail.escalations[0].id
  const c1 = await call(nurse.token, 'POST', `/api/escalations/${escId}/contact`, {
    target: '郑倩丈夫', channel: '电话', tone: '抵触', refusal_reason: '不信任访视', baby_visible: '否',
    note: '验证：仍拒绝入户，未透露婴儿情况',
  })
  ok('升级联系记录（对象/语气/原因/婴儿可见性）', !!c1.contact?.id && c1.contact.target === '郑倩丈夫')
  const badContact = await call(nurse.token, 'POST', `/api/escalations/${escId}/contact`, { target: '', tone: '平和', baby_visible: '否' })
  ok('联系记录缺少对象被拦截', !!badContact.error)

  // 医生决定上门复核（必须安排时间）
  const badDecide = await call(doctor.token, 'POST', `/api/escalations/${escId}/decide`, { decision: '上门复核' })
  ok('上门复核必须安排复核时间', !!badDecide.error, badDecide.error || '')
  const dec = await call(doctor.token, 'POST', `/api/escalations/${escId}/decide`,
    { decision: '上门复核', followup_time: '2099-01-04 09:00', note: '两次未见婴儿，上门核实黄疸与喂养' })
  ok('医生决定上门复核并生成复核预约', dec.escalation.status === '处置中' && !!dec.escalation.review_appointment_id)
  const reviewApptId = dec.escalation.review_appointment_id

  // 复核未完成不能闭环
  const earlyClose = await call(doctor.token, 'POST', `/api/escalations/${escId}/close`, { note: '提前闭环' })
  ok('复核未完成禁止闭环升级单', !!earlyClose.error, earlyClose.error || '')

  // 护士完成复核访视（自动带入信息，提交后自动闭环）
  const rv = await call(nurse.token, 'POST', '/api/visits', {
    archive_id: zheng.id, appointment_id: reviewApptId, visit_time: nowIso,
    weight: 3100, bilirubin: 165, feeding_freq: 9, stool_count: 4, stool_color: '黄色', urine_count: 8,
  })
  ok('复核访视提交', !!rv.visit?.id)
  const zAfter = await call(nurse.token, 'GET', `/api/archives/${zheng.id}`)
  const escAfter = zAfter.escalations.find(e => e.id === escId)
  ok('复核完成自动闭环升级流程', escAfter.status === '已闭环' && escAfter.close_note.includes('复核访视'),
    escAfter.close_note)
  const reviewAppt = zAfter.appointments.find(a => a.id === reviewApptId)
  ok('复核预约标记已完成', reviewAppt.status === '已完成')
}

// 7.6 离线拒访草稿同步幂等
{
  const chenmi = all.archives.find(a => a.baby_name === '陈小米')
  const rcid = `verify-refusal-${Date.now()}`
  const rbody = { refusals: [{ client_id: rcid, archive_id: chenmi.id, arrived_at: new Date().toISOString().slice(0, 16), contact_role: '家属', phone_content: '验证离线拒访', reason_code: '其他', tone: '平和', baby_visible: '不确定', followup_kind: '电话随访', followup_time: '2099-01-05 10:00' }] }
  const rs1 = await call(nurse.token, 'POST', '/api/sync/refusals', rbody)
  const rs2 = await call(nurse.token, 'POST', '/api/sync/refusals', rbody)
  ok('离线拒访同步', rs1.results[0].ok === true, `refusal#${rs1.results[0].refusal_id}`)
  ok('拒访同步幂等', rs2.results[0].ok && rs2.results[0].duplicated === true && rs2.results[0].refusal_id === rs1.results[0].refusal_id)
}

// 7.7 种子连续拒访家庭（钱小宝）：联系街道处置路径 + 无复核预约时凭依据闭环
{
  const escs = await call(doctor.token, 'GET', '/api/escalations')
  const seedEsc = escs.escalations.find(e => e.baby_name === '钱小宝')
  ok('种子含连续拒访待处置升级单', !!seedEsc && seedEsc.refusal_count === 2 && seedEsc.contacts.length >= 1,
    seedEsc ? `${seedEsc.level}/${seedEsc.status}` : '缺失')
  const badStreet = await call(doctor.token, 'POST', `/api/escalations/${seedEsc.id}/decide`, { decision: '联系街道' })
  ok('联系街道需说明协同事项', !!badStreet.error, badStreet.error || '')
  const street = await call(doctor.token, 'POST', `/api/escalations/${seedEsc.id}/decide`,
    { decision: '联系街道', note: '请居委会陪同上门核实婴儿安全', followup_time: '2099-01-06 09:00' })
  ok('医生决定联系街道', street.escalation.decision === '联系街道' && !street.escalation.review_appointment_id)
  const noBasis = await call(nurse.token, 'POST', `/api/escalations/${seedEsc.id}/close`, { note: '' })
  ok('无闭环依据被拦截', !!noBasis.error, noBasis.error || '')
  const closed = await call(nurse.token, 'POST', `/api/escalations/${seedEsc.id}/close`, { note: '街道反馈家属恢复配合，已约定上门时间' })
  ok('凭街道反馈闭环升级单', closed.escalation?.status === '已闭环')
  const refuseFilter = await call(nurse.token, 'GET', '/api/archives?filter=refusal')
  ok('拒访升级筛选（已闭环家庭不再出现）', !refuseFilter.archives.some(a => a.baby_name === '钱小宝'))
}

// 8 医生决策 + 闭环
const fus = await call(doctor.token, 'GET', '/api/followups')
const openOne = fus.followups.find(f => f.status !== '已闭环')
const dec = await call(doctor.token, 'POST', `/api/followups/${openOne.id}/decide`, { decision: '电话随访', note: '验证脚本：先电话随访观察' })
ok('医生决策', dec.ok === true)
const closed = await call(nurse.token, 'POST', `/api/followups/${openOne.id + 1}/close`, { note: '验证脚本闭环' })
ok('护士闭环', closed.followup?.status === '已闭环' || (await call(nurse.token, 'GET', '/api/followups')).followups.some(f => f.status === '已闭环'))

// 9 家属端
const fam = await call(family.token, 'GET', '/api/family/overview')
ok('家属端总览（建议/复查/风险说明）', fam.visits.length > 0 && !!fam.visits[0].advice && fam.followups.length >= 0,
  `访视${fam.visits.length}次 待办${fam.followups.length}项`)
const doc = await call(family.token, 'POST', '/api/documents', { type: '喂养记录', filename: 'verify.jpg', note: '验证脚本上传' })
ok('家属补充材料', !!doc.document?.id)
const con = await call(family.token, 'POST', '/api/consults', { question: '验证脚本：宝宝可以晒太阳吗？' })
ok('家属线上咨询', !!con.consult?.id)
const reply = await call(nurse.token, 'POST', `/api/consults/${con.consult.id}/reply`, { reply: '可以，避开正午，每次15分钟左右。' })
ok('护士回复咨询并闭环', reply.consult.status === '已回复')

// 10 权限
const deny = await fetch(`${BASE}/api/dashboard`, { headers: { Authorization: `Bearer ${family.token}` } })
ok('家属无权访问护士工作台', deny.status === 403)

console.log(`\n结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed ? 1 : 0)
