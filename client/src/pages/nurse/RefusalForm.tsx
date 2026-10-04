// 家属拒访登记：护士按预约到达但家属拒绝开门、只愿电话沟通
// 记录：到达时间、到达照片、电话沟通对象与内容、拒访原因、家属语气、是否看到婴儿
// 关键约束：拒访不关闭访视任务，必须登记明确后续安排；同一家庭连续拒访 2 次自动升级
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../api'
import type { ArchiveDetail, RefusalPayload } from '../../types'
import { Badge, Empty, fmtTime, toast } from '../../components/ui'
import PhotoInput from '../../components/PhotoInput'
import { isOfflineNow } from '../../store/net'
import { newClientId, useDrafts } from '../../store/drafts'

const now16 = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const REASONS = ['不信任访视', '担心打扰/休息', '家庭内部矛盾', '不愿暴露婴儿状况', '隐私顾虑', '已自行就医', '其他']
const TONES = ['平和', '回避', '抵触', '激动', '不配合']
const BABY = ['是', '否', '不确定']

function Seg({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="seg">
      {options.map((o) => <span key={o} className={`opt ${value === o ? 'on' : ''}`} onClick={() => onChange(o)}>{o}</span>)}
    </div>
  )
}

export default function RefusalForm() {
  const [sp] = useSearchParams()
  const archiveId = Number(sp.get('archiveId'))
  const appointmentId = sp.get('appointmentId') ? Number(sp.get('appointmentId')) : null
  const [detail, setDetail] = useState<ArchiveDetail | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()
  const saveDraft = useDrafts((s) => s.save)

  const [f, setF] = useState<RefusalPayload>({
    archive_id: archiveId,
    appointment_id: appointmentId,
    arrived_at: now16(),
    photos: [],
    contact_role: '',
    phone_content: '',
    reason_code: REASONS[1], reason_detail: '',
    tone: '平和', baby_visible: '否',
    followup_kind: '再次预约', followup_time: '', followup_note: '',
  })
  const set = (k: keyof RefusalPayload, v: any) => setF((s) => ({ ...s, [k]: v }))

  useEffect(() => {
    api.get<ArchiveDetail>(`/api/archives/${archiveId}`)
      .then((d) => {
        setDetail(d)
        setF((s) => ({ ...s, contact_role: s.contact_role || d.archive.contact_name }))
      })
      .catch((e) => setErr(`档案加载失败：${e.message}`))
  }, [archiveId])

  if (err) return <div className="alert-box danger">{err}</div>
  if (!detail) return <Empty text="档案加载中…" icon="⏳" />

  const a = detail.archive
  const prevCount = detail.refusals.length
  const hasOpenEsc = detail.escalations.some((e) => e.status !== '已闭环')
  // 服务端规则：本次拒访后该家庭累计拒访 ≥ 2 次且没有进行中的升级单 → 自动升级
  const willEscalate = prevCount + 1 >= 2 && !hasOpenEsc

  function payload(): RefusalPayload {
    return {
      ...f,
      archive_id: archiveId,
      appointment_id: appointmentId,
      followup_time: f.followup_time ? String(f.followup_time).replace('T', ' ') : null,
    }
  }

  function toDraft(clientId?: string) {
    const id = clientId || newClientId()
    saveDraft({
      clientId: id,
      kind: 'refusal',
      label: `拒访 · ${a.baby_name}（${a.mother_name}）· 第 ${prevCount + 1} 次`,
      savedAt: new Date().toLocaleString('zh-CN'),
      status: '待同步',
      payload: { ...payload(), client_id: id },
    })
    return id
  }

  function validate(): string | null {
    if (!f.phone_content.trim()) return '请记录电话沟通内容'
    if (f.followup_kind === '再次预约' && !f.followup_time) return '选择「再次预约」必须填写再约时间——拒访不能没有后续安排'
    if (!f.contact_role?.trim()) return '请填写电话沟通对象'
    return null
  }

  async function submit() {
    const v = validate()
    if (v) return toast(v)
    setBusy(true)
    try {
      if (isOfflineNow()) {
        toDraft()
        toast('📵 当前离线：拒访记录已保存本地草稿，回到社区后在「同步」页上传')
        nav('/nurse/sync')
        return
      }
      const path = appointmentId ? `/api/appointments/${appointmentId}/refusal` : '/api/refusals'
      try {
        const r = await api.post<{ escalated?: boolean }>(path, payload())
        if (r.escalated) toast('已登记。该家庭连续拒访，已自动升级给社区医生/妇幼专员')
        else if (willEscalate) toast('拒访已登记，系统已升级')
        else toast('✔ 拒访已登记，已生成明确的后续安排（访视任务未关闭）')
        nav(`/nurse/archives/${archiveId}`)
      } catch (e: any) {
        if (e instanceof TypeError || /fetch|网络/i.test(e.message)) {
          toDraft()
          toast('网络异常：拒访记录已转存本地草稿，稍后在「同步」页上传')
          nav('/nurse/sync')
        } else {
          toast(e.message)
        }
      }
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
          <Badge color="amber">历史拒访 {prevCount} 次</Badge>
        </div>
        <div className="small muted mt8">📍 {a.address} · 📞 {a.contact_name} {a.contact_phone}</div>
        <div className="small muted">预约时间：{fmtTime((detail.appointments.find((x) => x.id === appointmentId) || {}).scheduled_time)}</div>
      </div>

      {hasOpenEsc && (
        <div className="alert-box danger">
          ⛔ 该家庭已在{detail.escalations.find((e) => e.status !== '已闭环')?.level || '社区医生'}升级流程中（连续拒访 {prevCount} 次），本次拒访与联系记录会继续追加到升级流程。
        </div>
      )}
      {!hasOpenEsc && prevCount > 0 && (
        <div className={`alert-box ${willEscalate ? 'danger' : 'warn'}`}>
          {willEscalate
            ? '⚠ 该家庭此前已有拒访记录，本次登记后将构成连续拒访，系统会自动升级给社区医生（再次升级则转妇幼专员）。'
            : `该家庭此前有 ${prevCount} 次拒访，请尽量通过电话沟通争取配合；连续拒访 2 次将自动升级。`}
        </div>
      )}

      <div className="card">
        <div className="card-title"><span className="dot" />到达记录</div>
        <div className="field">
          <label>护士到达时间</label>
          <input type="datetime-local" value={f.arrived_at} onChange={(e) => set('arrived_at', e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>到达现场照片（门牌/门外留影，便于复核）</label>
          <PhotoInput photos={f.photos || []} onChange={(p) => set('photos', p)} label="📷 到达拍照" />
        </div>
      </div>

      <div className="card">
        <div className="card-title"><span className="dot" style={{ background: 'var(--red)' }} />电话沟通（家属隔门、仅电话沟通）</div>
        <div className="field">
          <label>沟通对象（与谁通话）</label>
          <input value={f.contact_role} onChange={(e) => set('contact_role', e.target.value)} placeholder="如：产妇本人 / 丈夫 / 婆婆" />
        </div>
        <div className="field">
          <label>拒访原因</label>
          <Seg options={REASONS} value={f.reason_code} onChange={(v) => set('reason_code', v)} />
        </div>
        <div className="field">
          <label>原因补充说明</label>
          <input value={f.reason_detail} onChange={(e) => set('reason_detail', e.target.value)} placeholder="家属原话或具体顾虑（选填）" />
        </div>
        <div className="field">
          <label>家属语气</label>
          <Seg options={TONES} value={f.tone} onChange={(v) => set('tone', v)} />
        </div>
        <div className="field">
          <label>是否看到婴儿</label>
          <Seg options={BABY} value={f.baby_visible} onChange={(v) => set('baby_visible', v)} />
          <div className="hint">隔门/视频中瞥见可选「不确定」</div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>电话沟通内容（必填，原话要点）</label>
          <textarea rows={4} value={f.phone_content} onChange={(e) => set('phone_content', e.target.value)}
            placeholder="如：家属称老人忌讳外人进门，产妇在休息，只隔门应答；提到宝宝有黄疸但拒绝测量……" />
        </div>
      </div>

      <div className="card">
        <div className="card-title"><span className="dot" style={{ background: 'var(--amber)' }} />明确后续安排（拒访不关闭访视任务）</div>
        <div className="field">
          <Seg options={['再次预约', '电话随访', '等待家属联系']} value={f.followup_kind}
            onChange={(v) => set('followup_kind', v as RefusalPayload['followup_kind'])} />
        </div>
        {f.followup_kind !== '等待家属联系' && (
          <div className="field">
            <label>{f.followup_kind === '再次预约' ? '再约上门时间' : '计划再次电话联系时间'}</label>
            <input type="datetime-local" value={(f.followup_time || '').replace(' ', 'T').slice(0, 16)}
              onChange={(e) => set('followup_time', e.target.value)} />
          </div>
        )}
        <div className="field" style={{ marginBottom: 0 }}>
          <label>后续安排说明</label>
          <textarea rows={2} value={f.followup_note} onChange={(e) => set('followup_note', e.target.value)}
            placeholder="如：家属勉强同意次日下午再试 / 先电话争取信任" />
        </div>
      </div>

      <div className="row">
        <button className="btn ghost grow" onClick={() => { toDraft(); toast('已保存本地草稿'); nav('/nurse/sync') }}>存草稿</button>
        <button className="btn primary grow" disabled={busy} onClick={submit}>{busy ? '提交中…' : '提交拒访记录'}</button>
      </div>
    </div>
  )
}
