// 家属拒访登记：护士按约到达但家属拒绝开门、只愿电话沟通
// 记录：到达时间、沟通对象/语气、拒访原因、电话内容、是否看到婴儿（状态）、到达照片
// 规则：拒访不关闭访视任务，首次拒访必须约定再次上门时间；连续 2 次自动升级社区医生/妇幼专员
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../api'
import type { ArchiveDetail } from '../../types'
import { Badge, Empty, Seg, fmtTime, toast } from '../../components/ui'
import { PhotoInput } from '../../components/PhotoInput'
import { ESCALATE_AFTER } from './refusalConstants'

const now16 = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const TONES = ['配合', '平静', '不耐烦', '抵触', '敌对']
const RELATIONS = ['产妇本人', '丈夫', '父母/公婆', '其他亲属']
const REASON_PRESETS = ['产妇/婴儿在休息，怕被打扰', '自认为宝宝正常，无需上门', '对入户访视有顾虑', '家庭内部意见不统一', '其他']
const SEEN_PRESETS = ['安静清醒', '哭闹', '皮肤黄染明显', '精神萎靡/嗜睡', '入睡中']
const UNSEEN_PRESETS = ['隔门听到婴儿哭声', '隔门短暂看到婴儿', '家属出示照片/视频', '完全无婴儿信息']

export default function RefusalForm() {
  const [sp] = useSearchParams()
  const archiveId = Number(sp.get('archiveId'))
  const appointmentId = sp.get('appointmentId') ? Number(sp.get('appointmentId')) : null
  const [d, setD] = useState<ArchiveDetail | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()

  const [f, setF] = useState({
    arrived_at: now16(), contact_name: '', contact_relation: '丈夫', tone: '不耐烦',
    reason: '', phone_content: '', baby_seen: 0, baby_status: '', next_time: '', photos: [] as string[],
    level: '社区医生',
  })
  const set = (k: string, v: any) => setF((s) => ({ ...s, [k]: v }))

  useEffect(() => {
    api.get<ArchiveDetail>(`/api/archives/${archiveId}`)
      .then(setD).catch((e) => setErr(`档案加载失败：${e.message}`))
  }, [archiveId])

  if (err) return <div className="alert-box danger">{err}</div>
  if (!d) return <Empty text="档案加载中…" icon="⏳" />
  const a = d.archive
  const prevRefusals = d.refusals.length
  const willEscalate = prevRefusals + 1 >= ESCALATE_AFTER

  async function submit() {
    if (!f.reason.trim()) return toast('请选择或填写拒访原因')
    if (!f.phone_content.trim()) return toast('请记录电话沟通内容')
    if (!f.contact_name.trim()) return toast('请填写电话沟通对象')
    if (!willEscalate && !f.next_time) return toast('首次拒访必须与家属约定再次上门时间（明确后续安排）')
    setBusy(true)
    try {
      const r = await api.post<{ escalatedNow?: boolean; streak: number }>('/api/refusals', {
        archive_id: archiveId, appointment_id: appointmentId,
        arrived_at: f.arrived_at.replace('T', ' '),
        contact_name: f.contact_name, contact_relation: f.contact_relation, tone: f.tone,
        reason: f.reason, phone_content: f.phone_content,
        baby_seen: f.baby_seen, baby_status: f.baby_status,
        level: f.level,
        photos: f.photos, next_time: f.next_time ? f.next_time.replace('T', ' ') : undefined,
      })
      if (r.escalatedNow) {
        toast(`已连续 ${r.streak} 次拒访，自动升级社区医生处置`)
        nav('/nurse/escalations')
      } else if (willEscalate) {
        toast('拒访已记录，并补充到升级工单')
        nav('/nurse/escalations')
      } else {
        toast('拒访已记录，已生成再次上门预约（访视任务未关闭）')
        nav(`/nurse/archives/${archiveId}`)
      }
    } catch (e: any) {
      toast(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="page-title">家属拒访登记</div>

      <div className="card">
        <div className="row between">
          <span className="strong">{a.mother_name} · {a.baby_name}</span>
          {prevRefusals > 0 && <Badge color="red">已拒访 {prevRefusals} 次</Badge>}
        </div>
        <div className="small muted mt8">📍 {a.address} · 📞 {a.contact_name} {a.contact_phone}</div>
        <div className="small muted">预约：{appointmentId ? fmtTime(d.appointments.find((x) => x.id === appointmentId)?.scheduled_time) : '补录'}</div>
      </div>

      {willEscalate && (
        <div className="alert-box danger">
          ⚠ 本户已连续拒访 {prevRefusals} 次，本次提交后将<b>自动升级</b>，由其决定上门复核或联系街道；访视任务不会被关闭。
          <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
            <label style={{ color: '#8f2b2b' }}>升级对象</label>
            <Seg options={['社区医生', '妇幼专员']} value={f.level} onChange={(v) => set('level', v)} />
          </div>
        </div>
      )}
      {!willEscalate && (
        <div className="alert-box warn">
          家属拒绝开门、只愿电话沟通时请如实记录。拒访不会关闭访视任务，必须与家属约定明确的再次上门时间；连续 {ESCALATE_AFTER} 次拒访将自动升级。
        </div>
      )}

      <div className="card">
        <div className="card-title"><span className="dot" />到达与电话沟通</div>
        <div className="field">
          <label>护士到达时间</label>
          <input type="datetime-local" value={f.arrived_at} onChange={(e) => set('arrived_at', e.target.value)} />
        </div>
        <div className="grid2">
          <div className="field">
            <label>沟通对象姓名</label>
            <input value={f.contact_name} onChange={(e) => set('contact_name', e.target.value)} placeholder="如：何先生" />
          </div>
          <div className="field">
            <label>与母婴关系</label>
            <Seg options={RELATIONS} value={f.contact_relation} onChange={(v) => set('contact_relation', v)} />
          </div>
        </div>
        <div className="field">
          <label>对方语气</label>
          <Seg options={TONES} value={f.tone} onChange={(v) => set('tone', v)} />
        </div>
        <div className="field">
          <label>拒访原因</label>
          <Seg options={REASON_PRESETS} value={f.reason} onChange={(v) => set('reason', v)} />
          <textarea className="mt8" style={{ minHeight: 56 }} placeholder="也可补充或自行填写具体原因（必填）"
            value={REASON_PRESETS.includes(f.reason) ? '' : f.reason}
            onChange={(e) => set('reason', e.target.value)} />
        </div>
        <div className="field">
          <label>电话沟通内容（必填）</label>
          <textarea rows={3} placeholder="记录电话中家属陈述、护士告知与沟通结果" value={f.phone_content}
            onChange={(e) => set('phone_content', e.target.value)} />
        </div>
      </div>

      <div className="card">
        <div className="card-title"><span className="dot" style={{ background: 'var(--red)' }} />是否看到婴儿</div>
        <div className="field">
          <Seg options={['未看到婴儿', '看到婴儿']} value={f.baby_seen ? '看到婴儿' : '未看到婴儿'}
            onChange={(v) => { set('baby_seen', v === '看到婴儿' ? 1 : 0); set('baby_status', '') }} />
        </div>
        <div className="field">
          <label>{f.baby_seen ? '婴儿状态' : '未入户情况下了解到的婴儿情况'}</label>
          <Seg teal options={f.baby_seen ? SEEN_PRESETS : UNSEEN_PRESETS} value={f.baby_status}
            onChange={(v) => set('baby_status', v)} />
          <input className="mt8" placeholder="可补充具体描述（如隔门听到哭声、家属称吃奶睡眠正常）"
            value={UNSEEN_PRESETS.includes(f.baby_status) || SEEN_PRESETS.includes(f.baby_status) ? '' : f.baby_status}
            onChange={(e) => set('baby_status', e.target.value)} />
        </div>
      </div>

      <div className="card">
        <div className="card-title"><span className="dot" style={{ background: 'var(--teal)' }} />到达现场照片</div>
        <div className="small muted mb8">留存门牌/隔门沟通现场，复核时自动带入，避免重复询问引起家属抵触。</div>
        <PhotoInput photos={f.photos} onChange={(p) => set('photos', p)} label="📷 拍摄到达现场" />
      </div>

      {!willEscalate && (
        <div className="card">
          <div className="card-title"><span className="dot" style={{ background: 'var(--amber)' }} />明确后续安排</div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>与家属约定再次上门时间（必填）</label>
            <input type="datetime-local" value={f.next_time} onChange={(e) => set('next_time', e.target.value)} />
            <div className="hint">提交后系统自动生成新的待访视预约，原任务保持开放直至真正完成访视。</div>
          </div>
        </div>
      )}

      <div className="row">
        <button className="btn ghost grow" onClick={() => nav(-1)}>取消</button>
        <button className="btn danger grow" disabled={busy} onClick={submit}>
          {busy ? '提交中…' : willEscalate ? '提交并升级' : '提交拒访记录'}
        </button>
      </div>
    </div>
  )
}
