// 种子数据：8 个母婴档案覆盖全部业务场景（未访视/异常黄疸/体重下降/产妇情绪/
// 未开门/设备故障/线上咨询/已闭环），日期相对“今天”生成，任何时候演示都有当日数据
import { createHash } from 'node:crypto'
import db, { addEvent } from './db.js'
import { createVisit } from './service.js'
import { createRefusal, addContact } from './refusal.js'

const hash = (s) => createHash('sha256').update('nbv:' + s).digest('hex')
const day = 86400000
const at = (offsetDays, hm = '09:00') => {
  const d = new Date(Date.now() + offsetDays * day)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}:00`
}
const iso = (offsetDays, hm = '08:00') => at(offsetDays, hm).replace(' ', 'T').slice(0, 16)

export function seed() {
  const count = db.prepare('SELECT COUNT(*) c FROM users').get().c
  if (count > 0) return false

  const insUser = db.prepare('INSERT INTO users (username, password_hash, role, name, title, phone) VALUES (?,?,?,?,?,?)')
  const nurse = insUser.run('nurse', hash('nurse123'), 'nurse', '王芳', '社区护士', '13800000001').lastInsertRowid
  const nurse2 = insUser.run('nurse2', hash('nurse123'), 'nurse', '刘洋', '社区护士', '13800000002').lastInsertRowid
  const doctor = insUser.run('doctor', hash('doctor123'), 'doctor', '张启明', '社区医生', '13800000003').lastInsertRowid
  const fam1 = insUser.run('family', hash('family123'), 'family', '李婷家属', '', '13900000001').lastInsertRowid
  const fam2 = insUser.run('family2', hash('family123'), 'family', '王雪家属', '', '13900000002').lastInsertRowid

  const insArch = db.prepare(`INSERT INTO archives
    (family_user_id, mother_name, baby_name, baby_gender, birth_date, birth_weight, delivery_mode,
     feeding_type, jaundice_risk, maternal_wound, address, contact_name, contact_phone, discharge_date,
     care_ability, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  const arch = (familyUserId, mother, baby, gender, birthOffset, weight, delivery, feeding, risk, wound, addr, contact, phone, dischargeOffset, care, notes) =>
    insArch.run(familyUserId, mother, baby, gender, iso(birthOffset, '08:30'), weight, delivery, feeding, risk,
      wound, addr, contact, phone, at(dischargeOffset, '10:00'), care, notes).lastInsertRowid

  // 1 李婷/李安安：今天待初访（家属账号 family）
  const a1 = arch(fam1, '李婷', '李安安', '女', -5, 3200, '顺产', '母乳喂养', '中', '会阴切口愈合良好',
    '幸福里小区 3 栋 2 单元 502', '李婷丈夫 陈先生', '13900000001', -3, '良好', '母亲 O 型血，注意观察黄疸')
  // 2 王雪/王乐乐：D-2 访视黄疸接近阈值，今天复查（家属账号 family2）
  const a2 = arch(fam2, '王雪', '王乐乐', '男', -8, 2800, '剖宫产', '混合喂养', '高', '剖宫产切口愈合良好',
    '康宁花园 7 栋 1 单元 301', '王雪母亲', '13900000002', -6, '一般', '母亲 O 型、父亲 B 型，ABO 溶血风险')
  // 3 陈静/陈小米：已访视正常，闭环样例
  const a3 = arch(null, '陈静', '陈小米', '女', -13, 3500, '顺产', '配方奶喂养', '低', '会阴切口愈合良好',
    '朝阳社区 12 栋 601', '陈静', '13900000003', -11, '良好', '')
  // 4 赵敏/赵豆豆：低体重儿，体重下降+喂养不足+产妇情绪低落
  const a4 = arch(null, '赵敏', '赵豆豆', '男', -6, 2500, '顺产', '母乳喂养', '高', '会阴切口愈合良好',
    '幸福里小区 5 栋 3 单元 202', '赵敏丈夫', '13900000004', -4, '薄弱', '低出生体重儿，产妇自述休息差')
  // 5 孙丽/孙果果：昨日上门家属未开门，今日再约
  const a5 = arch(null, '孙丽', '孙果果', '女', -7, 3100, '顺产', '母乳喂养', '中', '会阴切口愈合良好',
    '滨河小区 9 栋 2 单元 1101', '孙丽婆婆', '13900000005', -5, '一般', '电话联系家属称白天常不在家')
  // 6 周洁/周小贝：访视正常，家属发起线上咨询待回复
  const a6 = arch(null, '周洁', '周小贝', '男', -15, 3300, '顺产', '母乳喂养', '低', '会阴切口愈合良好',
    '康宁花园 2 栋 402', '周洁', '13900000006', -13, '良好', '')
  // 7 吴倩/吴小满：体重下降>10%+黄疸接近阈值+设备故障 → 转诊儿科待闭环
  const a7 = arch(null, '吴倩', '吴小满', '女', -11, 3420, '顺产', '母乳喂养', '高', '会阴切口愈合良好',
    '朝阳社区 4 栋 2 单元 501', '吴倩丈夫', '13900000007', -9, '一般', '访视当日经皮胆红素仪故障')
  // 8 郑倩/郑小星：明天初访
  const a8 = arch(null, '郑倩', '郑小星', '男', -3, 3900, '剖宫产', '混合喂养', '中', '剖宫产切口愈合良好',
    '滨河小区 1 栋 101', '郑倩', '13900000008', -1, '良好', '巨大儿，注意喂养与血糖观察')
  // 9 钱芳/钱小宝：连续两次拒访（隔门电话沟通），已自动升级社区医生待处置
  const a9 = arch(null, '钱芳', '钱小宝', '女', -6, 3050, '顺产', '母乳喂养', '中', '会阴切口愈合良好',
    '幸福里小区 8 栋 1 单元 603', '钱芳丈夫 马先生', '13900000009', -4, '一般', '家属对社区访视有顾虑，两次上门均未开门只愿电话沟通；始终未见到婴儿')

  const insAppt = db.prepare(`INSERT INTO appointments (archive_id, nurse_id, type, scheduled_time, status, reason)
                              VALUES (?,?,?,?,?,?)`)

  // —— 预约 ——
  insAppt.run(a1, nurse, '初访', at(0, '09:30'), '待访视', '')
  insAppt.run(a8, nurse2, '初访', at(1, '09:00'), '待访视', '')
  const appt5a = insAppt.run(a5, nurse, '初访', at(-1, '10:00'), '未开门', '上门敲门无人应答，电话未接').lastInsertRowid
  insAppt.run(a5, nurse, '初访', at(0, '16:00'), '待访视', '家属临时改约至今日下午')
  const appt3 = insAppt.run(a3, nurse, '初访', at(-8, '09:30'), '已完成', '').lastInsertRowid
  const appt4 = insAppt.run(a4, nurse, '初访', at(-1, '09:00'), '已完成', '').lastInsertRowid
  const appt6 = insAppt.run(a6, nurse2, '初访', at(-5, '14:00'), '已完成', '').lastInsertRowid
  const appt7 = insAppt.run(a7, nurse, '初访', at(-3, '10:30'), '已完成', '').lastInsertRowid
  const appt2 = insAppt.run(a2, nurse, '初访', at(-2, '09:30'), '已完成', '').lastInsertRowid
  const appt9a = insAppt.run(a9, nurse, '初访', at(-2, '09:30'), '待访视', '').lastInsertRowid

  // —— 访视记录（走统一 createVisit，风险引擎自动生成复查/转诊/指导/电话随访） ——
  const nurseRow = db.prepare('SELECT * FROM users WHERE id=?').get(nurse)
  const nurse2Row = db.prepare('SELECT * FROM users WHERE id=?').get(nurse2)

  createVisit({ appointment_id: appt3, archive_id: a3, visit_time: iso(-8, '09:40'), weight: 3360,
    bilirubin: 128, bilirubin_site: '额头', cord: '干燥', stool_count: 3, stool_color: '黄色', urine_count: 7,
    feeding_freq: 8, spit_up: '无', sleep: '正常', breast: '正常', mood: '平稳', care_ability: '良好' }, nurseRow)

  createVisit({ appointment_id: appt4, archive_id: a4, visit_time: iso(-1, '09:20'), weight: 2320,
    bilirubin: 176, bilirubin_site: '胸口', cord: '结痂', stool_count: 2, stool_color: '黄绿色', urine_count: 5,
    feeding_freq: 6, spit_up: '偶尔', sleep: '易惊', breast: '涨奶', mood: '低落', care_ability: '薄弱' }, nurseRow)

  createVisit({ appointment_id: appt6, archive_id: a6, visit_time: iso(-5, '14:20'), weight: 3250,
    bilirubin: 152, bilirubin_site: '额头', cord: '已脱落', stool_count: 4, stool_color: '黄色', urine_count: 8,
    feeding_freq: 9, spit_up: '偶尔', sleep: '正常', breast: '正常', mood: '平稳', care_ability: '良好' }, nurse2Row)

  createVisit({ appointment_id: appt7, archive_id: a7, visit_time: iso(-3, '10:50'), weight: 3050,
    bilirubin: 289, bilirubin_site: '额头', cord: '渗液', stool_count: 2, stool_color: '黄绿色', urine_count: 5,
    feeding_freq: 7, spit_up: '频繁', sleep: '嗜睡', breast: '乳头皲裂', mood: '焦虑', care_ability: '一般',
    device_issue: 1 }, nurseRow)

  createVisit({ appointment_id: appt2, archive_id: a2, visit_time: iso(-2, '09:40'), weight: 2700,
    bilirubin: 262, bilirubin_site: '额头', cord: '干燥', stool_count: 3, stool_color: '黄色', urine_count: 6,
    feeding_freq: 8, spit_up: '偶尔', sleep: '正常', breast: '正常', mood: '平稳', care_ability: '一般' }, nurseRow)

  // —— 未开门事件 + 再次预约事项 ——
  addEvent(a5, '未开门', '上门访视家属未开门', '敲门无人应答，电话未接通，已留联系卡', '王芳')
  db.prepare(`INSERT INTO followups (archive_id, type, title, detail, due_date, created_by)
              VALUES (?,?,?,?,?,?)`)
    .run(a5, '再次预约', '家属未开门，需再次预约上门', '昨日初访未成功，已与家属电话改约今日 16:00',
      at(0, '16:00').slice(0, 10), '王芳')

  // —— 连续拒访（钱小宝家）：两次隔门电话沟通，第二次后自动升级社区医生 ——
  createRefusal({
    appointment_id: appt9a, archive_id: a9, arrived_at: iso(-2, '09:35'),
    contact_role: '钱芳丈夫 马先生',
    phone_content: '隔门通话，马先生称家里老人忌讳外人进门，产妇也不想被打扰；只隔门应答，没有开门。',
    reason_code: '担心打扰/休息', reason_detail: '老人忌讳外人进门',
    tone: '回避', baby_visible: '否',
    followup_kind: '再次预约', followup_time: iso(-1, '15:00'),
    followup_note: '家属勉强同意次日下午再试',
  }, nurseRow)
  const appt9b = db.prepare(`SELECT id FROM appointments WHERE archive_id=? AND status='待访视' ORDER BY scheduled_time`).get(a9).id
  createRefusal({
    appointment_id: appt9b, archive_id: a9, arrived_at: iso(-1, '15:05'),
    contact_role: '钱芳丈夫 马先生',
    phone_content: '再次上门仍不开门，马先生语气抵触，称宝宝有黄疸但已自行找中医看过，不相信社区测量，拒绝入户。',
    reason_code: '不信任访视', reason_detail: '已自行找中医看黄疸，拒绝社区测量',
    tone: '抵触', baby_visible: '否',
    followup_kind: '电话随访', followup_time: iso(0, '10:00'),
    followup_note: '先电话沟通争取信任，同时升级社区医生评估',
  }, nurseRow)
  const esc9 = db.prepare(`SELECT id FROM escalations WHERE archive_id=? ORDER BY id LIMIT 1`).get(a9)?.id
  if (esc9) {
    addContact(esc9, {
      target: '钱芳丈夫 马先生', channel: '电话', tone: '回避',
      refusal_reason: '不信任访视', baby_visible: '否',
      note: '护士今晨电话回访，家属仍拒绝入户，未透露婴儿黄疸与吃奶情况，建议升级由社区医生出面。',
      contact_at: iso(0, '10:20'),
    }, nurseRow)
  }

  // —— 家属补充材料 ——
  const insDoc = db.prepare('INSERT INTO documents (archive_id, uploader_id, type, filename, note) VALUES (?,?,?,?,?)')
  insDoc.run(a1, fam1, '出生证明', '出生医学证明.jpg', '家属上传')
  insDoc.run(a1, fam1, '出院小结', '出院小结.pdf', '家属上传')
  insDoc.run(a2, fam2, '喂养记录', '喂养记录-近3天.jpg', '每日喂养与大小便记录')
  addEvent(a1, '材料', '家属补充材料：出生证明、出院小结', '', '李婷家属')
  addEvent(a2, '材料', '家属补充材料：喂养记录', '', '王雪家属')

  // —— 线上咨询 ——
  db.prepare('INSERT INTO consults (archive_id, user_id, question) VALUES (?,?,?)')
    .run(a6, null, '宝宝黄疸还没退干净，可以晒太阳吗？晒多久合适？')
  db.prepare(`INSERT INTO followups (archive_id, type, title, detail, created_by) VALUES (?,?,?,?,?)`)
    .run(a6, '线上咨询', '家属线上咨询待回复', '宝宝黄疸还没退干净，可以晒太阳吗？晒多久合适？', '周洁家属')
  addEvent(a6, '咨询', '家属发起线上咨询', '宝宝黄疸还没退干净，可以晒太阳吗？', '周洁家属')

  console.log('✔ 种子数据已写入')
  return true
}

// 直接运行：node server/seed.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const created = seed()
  console.log(created ? '完成' : '已有数据，跳过（如需重置请删除 server/data/neonatal.db）')
}
