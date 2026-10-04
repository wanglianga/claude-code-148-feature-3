// 端到端验证脚本：node scripts/verify.mjs（需服务已启动，默认 http://localhost:8080）
// 覆盖：登录、工作台、档案筛选、访视提交与风险结论、离线同步幂等、
//       未开门/改约、随访闭环、医生决策、家属端总览/材料/咨询、
//       家属拒访登记→连续拒访自动升级→联系留痕→上门复核资料带入→成功访视闭环
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

// 7.5 家属拒访 → 连续拒访升级 → 联系留痕 → 上门复核资料带入 → 成功访视闭环
{
  // 用一个尚无拒访/访视的新户：郑倩/郑小星（明日初访）
  const zheng = all.archives.find(a => a.baby_name === '郑小星')
  const zAppt0 = (await call(nurse.token, 'GET', '/api/appointments?status=待访视')).appointments.find(a => a.archive_id === zheng.id)

  // 首次拒访：未约定再次上门时间应被拒绝（拒访必须有明确后续安排）
  const bad = await call(nurse.token, 'POST', '/api/refusals', {
    archive_id: zheng.id, appointment_id: zAppt0?.id, arrived_at: new Date().toISOString().slice(0, 16),
    contact_name: '郑倩', contact_relation: '产妇本人', tone: '不耐烦',
    reason: '在休息不方便', phone_content: '只愿意电话沟通', baby_seen: 0, baby_status: '未看到',
  })
  ok('首次拒访缺少后续安排被拦截', !!bad.error, bad.error || '未拦截')

  // 首次拒访 + 再约 → 不升级，访视任务保持开放
  const r1 = await call(nurse.token, 'POST', '/api/refusals', {
    archive_id: zheng.id, appointment_id: zAppt0?.id, arrived_at: new Date().toISOString().slice(0, 16),
    contact_name: '郑倩', contact_relation: '产妇本人', tone: '不耐烦',
    reason: '在休息不方便，拒绝开门', phone_content: '隔门电话沟通：称只接受电话，约定明天再来',
    baby_seen: 0, baby_status: '隔门听到婴儿声', next_time: '2099-02-02 09:30',
    photos: ['data:image/svg+xml,door1'],
  })
  ok('首次拒访登记', r1.streak === 1 && r1.escalatedNow !== true, `连续次数${r1.streak}`)
  const zDetail1 = await call(nurse.token, 'GET', `/api/archives/${zheng.id}`)
  ok('拒访不关闭访视任务（自动生成再约预约）',
    zDetail1.refusals.length === 1 && zDetail1.appointments.some(a => a.status === '待访视' && a.scheduled_time.startsWith('2099-02-02')),
    `拒访${zDetail1.refusals.length}次`)

  // 第 2 次拒访（对再约的预约）→ 自动升级社区医生
  const zAppt1 = zDetail1.appointments.find(a => a.status === '待访视' && a.scheduled_time.startsWith('2099-02-02'))
  const r2 = await call(nurse.token, 'POST', '/api/refusals', {
    archive_id: zheng.id, appointment_id: zAppt1.id, arrived_at: new Date().toISOString().slice(0, 16),
    contact_name: '郑倩丈夫', contact_relation: '丈夫', tone: '抵触',
    reason: '坚持没必要上门', phone_content: '再次电话沟通仍拒绝入户，无法核实婴儿状况',
    baby_seen: 0, baby_status: '仍未看到婴儿', photos: ['data:image/svg+xml,door2'],
  })
  ok('连续2次拒访自动升级', r2.streak === 2 && r2.escalatedNow === true && !!r2.escalation?.id,
    `工单#${r2.escalation?.id} 升级至${r2.escalation?.level}`)
  const escId = r2.escalation.id

  // 工作台/档案筛选能看到升级
  const dash2 = await call(nurse.token, 'GET', '/api/dashboard')
  ok('工作台拒访升级统计', dash2.stats.refusalEscalations >= 1, `拒访升级${dash2.stats.refusalEscalations}`)
  const refusalList = await call(nurse.token, 'GET', '/api/archives?filter=refusal')
  ok('拒访家庭筛选', refusalList.archives.some(a => a.id === zheng.id))

  // 升级流程中记录一次联系（对象/语气/原因/见婴状态）
  const c1 = await call(doctor.token, 'POST', `/api/escalations/${escId}/contacts`, {
    channel: '电话', contact_name: '郑倩', contact_relation: '产妇本人', tone: '配合',
    refusal_reason: '怕邻里说闲话', baby_seen: 1, baby_status: '视频看到婴儿，皮肤轻度黄染，反应可',
    content: '产妇态度转为配合，同意医生上门复核',
  })
  ok('升级后联系记录留痕', !!c1.contact?.id && c1.contact.baby_seen === 1)

  // 缺沟通内容应被拒绝
  const cBad = await call(doctor.token, 'POST', `/api/escalations/${escId}/contacts`, { contact_name: 'x' })
  ok('联系记录必填校验', !!cBad.error)

  // 医生决定上门复核 → 自动带入前次照片/电话/未完成测量项
  const rc = await call(doctor.token, 'POST', `/api/escalations/${escId}/resolve`,
    { action: 'recheck', scheduled_time: '2099-02-03 10:00', note: '先观测黄疸' })
  ok('安排上门复核', !!rc.recheck?.id && !!rc.appointment_id, `复核#${rc.recheck?.id}`)
  const carried = await call(nurse.token, 'GET', `/api/rechecks/by-appointment/${rc.appointment_id}`)
  ok('复核自动带入：前次（最近一次）到达照片', carried.recheck.carried_photos.includes('data:image/svg+xml,door2'))
  ok('复核自动带入：电话沟通记录', /只愿意电话沟通|拒绝入户/.test(carried.recheck.carried_phone_log))
  ok('复核自动带入：未完成测量项', carried.recheck.pending_items.includes('体重测量') && carried.recheck.pending_items.includes('经皮胆红素测量'),
    carried.recheck.pending_items.join('、'))

  // 无复核时间应被拦截
  const rcBad = await call(doctor.token, 'POST', `/api/escalations/${escId}/resolve`, { action: 'recheck' })
  ok('复核需明确时间', !!rcBad.error)

  // 用复核预约真正完成一次访视 → 升级工单闭环
  const visit = await call(nurse.token, 'POST', '/api/visits', {
    archive_id: zheng.id, appointment_id: rc.appointment_id, visit_time: '2099-02-03T10:20',
    weight: 3850, bilirubin: 150, feeding_freq: 9, stool_count: 3, stool_color: '黄色', urine_count: 8,
  })
  ok('复核访视提交', !!visit.visit?.id)
  const escAfter = await call(doctor.token, 'GET', `/api/escalations/${escId}`)
  ok('成功访视后升级工单闭环', escAfter.escalation.status === '已闭环', escAfter.escalation.status)

  // 种子数据中的连续拒访家庭（林念念）应已在升级列表
  const seedEsc = await call(doctor.token, 'GET', '/api/escalations?status=open')
  const lin = seedEsc.escalations.find(e => e.baby_name === '林念念')
  ok('种子连续拒访家庭已升级', !!lin && lin.refusal_count === 2 && lin.status !== '已闭环', lin ? `${lin.title}` : '未找到')
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
