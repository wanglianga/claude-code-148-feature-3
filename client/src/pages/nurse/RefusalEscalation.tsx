// 拒访与连续拒访升级面板：
// - 拒访记录：到达时间/照片、电话对象与内容、拒访原因、语气、是否看到婴儿、后续安排
// - 升级流程：每次联系对象/语气/拒访原因/婴儿可见性；社区医生处置（上门复核/联系街道…）；闭环
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api'
import type { ArchiveDetail, Escalation, EscalationContactPayload } from '../../types'
import { Badge, Empty, Modal, fmtTime, toast } from '../../components/ui'
import { useAuth } from '../../store/auth'

const TONES = ['平和', '回避', '抵触', '激动', '不配合']
const REASONS = ['不信任访视', '担心打扰/休息', '家庭内部矛盾', '不愿暴露婴儿状况', '隐私顾虑', '已自行就医', '其他']
const BABY = ['是', '否', '不确定']
const CHANNELS = ['电话', '上门', '微信', '街道协同']

function Seg({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="seg">
      {options.map((o) => <span key={o} className={`opt ${value === o ? 'on' : ''}`} onClick={() => onChange(o)}>{o}</span>)}
    </div>
  )
}

const ESC_STATUS_COLOR: Record<string, string> = { 待处置: 'red', 处置中: 'amber', 已闭环: 'green' }

export function RefusalTab({ d, onChanged }: { d: ArchiveDetail; onChanged: () => void }) {
  const nav = useNavigate()
  const user = useAuth((s) => s.user)
  const openEsc = d.escalations.find((e) => e.status !== '已闭环')
  return (
    <div>
      {user?.role === 'nurse' && (
        <button className="btn danger block mb12"
          onClick={() => nav(`/nurse/refusal/new?archiveId=${d.archive.id}`)}>
          ＋ 登记本次上门被拒（仅电话沟通）
        </button>
      )}

      {d.escalations.map((e) => (
        <EscalationCard key={e.id} esc={e} onChanged={onChanged} doctor={user?.role === 'doctor'} className="" />
      ))}

      <div className="card">
        <div className="card-title"><span className="dot" style={{ background: 'var(--red)' }} />拒访记录（共 {d.refusals.length} 次）</div>
        {d.refusals.length === 0 && <Empty text="暂无拒访记录" icon="🚪" />}
        {d.refusals.map((r) => (
          <div key={r.id} className="list-item" style={{ borderBottom: '1px dashed var(--line)' }}>
            <div className="row between">
              <span className="strong">第 {r.seq} 次拒访 · {fmtTime(r.arrived_at)}</span>
              <div className="row">
                {r.escalation_id ? <Badge color="red">已升级</Badge> : null}
                {r.created_offline ? <Badge color="teal">离线补录</Badge> : null}
                <Badge color="gray">{r.tone}</Badge>
              </div>
            </div>
            <div className="small mt8">📞 沟通对象：{r.contact_role || '-'} · 是否看到婴儿：<b>{r.baby_visible}</b></div>
            <div className="small">拒访原因：{r.reason_code}{r.reason_detail ? `（${r.reason_detail}）` : ''}</div>
            <div className="small muted" style={{ marginTop: 4 }}>电话内容：{r.phone_content}</div>
            {r.photos.length > 0 && (
              <div className="photo-row mt8">{r.photos.map((p, i) => <img key={i} src={p} alt={`第${r.seq}次到达照片${i + 1}`} />)}</div>
            )}
            <div className="small" style={{ color: 'var(--amber)', marginTop: 6 }}>
              后续安排：{r.followup_kind}{r.followup_time ? ` · ${fmtTime(r.followup_time)}` : ''}{r.followup_note ? ` · ${r.followup_note}` : ''}
            </div>
          </div>
        ))}
      </div>

      {openEsc && (
        <div className="alert-box warn">
          连续拒访升级流程进行中，该家庭的访视任务未关闭；每次联系都需记录对象、语气、拒访原因与是否看到婴儿。
        </div>
      )}
    </div>
  )
}

export function EscalationCard({ esc, onChanged, doctor, className = '' }: {
  esc: Escalation; onChanged: () => void; doctor?: boolean; className?: string
}) {
  const [contacting, setContacting] = useState(false)
  const [deciding, setDeciding] = useState(false)
  const [closing, setClosing] = useState(false)
  const open = esc.status !== '已闭环'
  return (
    <div className={`card ${className}`}>
      <div className="row between">
        <span className="strong">⛔ 连续拒访升级单 #{esc.id}（{esc.refusal_count} 次拒访）</span>
        <div className="row">
          <Badge color="red">{esc.level}</Badge>
          <Badge color={ESC_STATUS_COLOR[esc.status] || 'gray'}>{esc.status}</Badge>
        </div>
      </div>
      <div className="small muted mt8">处理方：{esc.handler}{esc.decided_by ? ` · 决定人：${esc.decided_by}` : ''}</div>
      {esc.decision && (
        <div className="small" style={{ color: 'var(--coral)' }}>
          处置决定：{esc.decision}{esc.decision_note ? ` — ${esc.decision_note}` : ''}
          {esc.review_appointment_id ? '（已生成复核预约，访视完成后自动闭环）' : ''}
        </div>
      )}
      {esc.status === '已闭环' && (
        <div className="small" style={{ color: 'var(--green)' }}>✔ {fmtTime(esc.closed_at)} {esc.closed_by} 闭环：{esc.close_note}</div>
      )}

      <div className="card-title" style={{ marginTop: 10 }}><span className="dot" style={{ background: 'var(--teal)' }} />每次联系记录</div>
      {esc.contacts.length === 0 && <Empty text="暂无联系记录，上门/电话后请逐条登记" icon="📞" />}
      {esc.contacts.map((c) => (
        <div key={c.id} className="small" style={{ padding: '6px 0', borderBottom: '1px dashed var(--line)' }}>
          <div className="row between">
            <span><b>{fmtTime(c.contact_at)}</b> · {c.contact_by_role} {c.contact_by} → {c.target}（{c.channel}）</span>
            <Badge color="gray">{c.tone}</Badge>
          </div>
          <div className="muted" style={{ marginTop: 2 }}>
            拒访原因：{c.refusal_reason || '-'} · 看到婴儿：<b>{c.baby_visible}</b>{c.note ? ` · ${c.note}` : ''}
          </div>
        </div>
      ))}

      {open && (
        <div className="row wrap mt8">
          <button className="btn teal sm" onClick={() => setContacting(true)}>＋ 记录联系</button>
          {doctor && <button className="btn primary sm" onClick={() => setDeciding(true)}>医生/专员处置</button>}
          <button className="btn ghost sm" onClick={() => setClosing(true)}>闭环升级单</button>
        </div>
      )}

      {contacting && <ContactModal esc={esc} onClose={() => setContacting(false)} onDone={() => { setContacting(false); onChanged(); toast('联系记录已保存') }} />}
      {deciding && <DecideModal esc={esc} onClose={() => setDeciding(false)} onDone={() => { setDeciding(false); onChanged(); toast('处置决定已保存') }} />}
      {closing && <CloseEscalationModal esc={esc} onClose={() => setClosing(false)} onDone={() => { setClosing(false); onChanged(); toast('升级单已闭环') }} />}
    </div>
  )
}

function ContactModal({ esc, onClose, onDone }: { esc: Escalation; onClose: () => void; onDone: () => void }) {
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const [f, setF] = useState<EscalationContactPayload>({
    contact_at: `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}:${p(now.getMinutes())}`,
    target: '', channel: '电话', tone: '平和', refusal_reason: REASONS[0], baby_visible: '否', note: '',
  })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof EscalationContactPayload, v: any) => setF((s) => ({ ...s, [k]: v }))
  async function ok() {
    if (!f.target.trim()) return toast('请填写联系对象')
    setBusy(true)
    try {
      await api.post(`/api/escalations/${esc.id}/contact`, { ...f, contact_at: f.contact_at?.replace('T', ' ') })
      onDone()
    } catch (e: any) { toast(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal title={`记录联系 - 升级单 #${esc.id}`} onClose={onClose}>
      <div className="grid2">
        <div className="field">
          <label>联系时间</label>
          <input type="datetime-local" value={f.contact_at} onChange={(e) => set('contact_at', e.target.value)} />
        </div>
        <div className="field">
          <label>联系方式</label>
          <Seg options={CHANNELS} value={f.channel!} onChange={(v) => set('channel', v)} />
        </div>
      </div>
      <div className="field">
        <label>联系对象</label>
        <input value={f.target} onChange={(e) => set('target', e.target.value)} placeholder="如：产妇本人 / 丈夫 / 婆婆 / 街道王主任" />
      </div>
      <div className="field">
        <label>家属语气</label>
        <Seg options={TONES} value={f.tone} onChange={(v) => set('tone', v)} />
      </div>
      <div className="field">
        <label>拒访原因</label>
        <Seg options={REASONS} value={f.refusal_reason!} onChange={(v) => set('refusal_reason', v)} />
      </div>
      <div className="field">
        <label>是否看到婴儿</label>
        <Seg options={BABY} value={f.baby_visible} onChange={(v) => set('baby_visible', v)} />
      </div>
      <div className="field">
        <label>沟通要点</label>
        <textarea rows={3} value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="家属陈述、婴儿状况线索、下一步约定等" />
      </div>
      <button className="btn primary block" disabled={busy} onClick={ok}>{busy ? '提交中…' : '保存联系记录'}</button>
    </Modal>
  )
}

const DECISIONS = ['上门复核', '联系街道', '电话随访', '转妇幼专员', '继续观察']

function DecideModal({ esc, onClose, onDone }: { esc: Escalation; onClose: () => void; onDone: () => void }) {
  const [decision, setDecision] = useState(esc.level === '妇幼专员' ? '上门复核' : '上门复核')
  const [time, setTime] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  async function ok() {
    if (decision === '上门复核' && !time) return toast('上门复核必须安排复核时间')
    if (decision === '联系街道' && !note.trim()) return toast('联系街道需说明协同事项')
    if ((decision === '电话随访' || decision === '继续观察') && !time) return toast('必须填写下次联系时间，拒访家庭不能无后续安排')
    setBusy(true)
    try {
      await api.post(`/api/escalations/${esc.id}/decide`, { decision, note, followup_time: time ? time.replace('T', ' ') : null })
      onDone()
    } catch (e: any) { toast(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal title={`处置拒访升级 - 升级单 #${esc.id}（${esc.level}）`} onClose={onClose}>
      <div className="field">
        <label>处置决定</label>
        <Seg options={DECISIONS} value={decision} onChange={setDecision} />
      </div>
      {decision === '上门复核' && (
        <div className="alert-box warn small">上门复核时，系统将自动为复核护士带入：上次护士到达照片、全部电话沟通记录、未完成测量项，减少重复询问。</div>
      )}
      {decision !== '联系街道' && (
        <div className="field">
          <label>{decision === '上门复核' ? '复核上门时间' : '下次联系/跟进时间'}</label>
          <input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      )}
      <div className="field">
        <label>{decision === '联系街道' ? '街道/居委会协同事项（必填）' : '处置意见'}</label>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder={decision === '联系街道' ? '如：请居委会陪同上门核实婴儿安全，社区担心婴儿黄疸未得到处置…' : '综合婴儿未见到、拒访原因与家属语气的判断'} />
      </div>
      <button className="btn primary block" disabled={busy} onClick={ok}>{busy ? '提交中…' : '提交处置决定'}</button>
    </Modal>
  )
}

function CloseEscalationModal({ esc, onClose, onDone }: { esc: Escalation; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState(esc.review_appointment_id ? '复核访视已完成' : '')
  const [busy, setBusy] = useState(false)
  async function ok() {
    setBusy(true)
    try {
      await api.post(`/api/escalations/${esc.id}/close`, { note })
      onDone()
    } catch (e: any) { toast(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal title={`闭环升级单 #${esc.id}`} onClose={onClose}>
      {esc.review_appointment_id
        ? <div className="alert-box warn">该升级单安排了上门复核：只有复核访视提交完成后才能闭环（提交复核访视会自动闭环）。</div>
        : <div className="field">
          <label>闭环依据（街道反馈 / 家属恢复配合 / 电话核实结果）</label>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>}
      <button className="btn primary block" disabled={busy} onClick={ok}>{busy ? '提交中…' : '确认闭环'}</button>
    </Modal>
  )
}
