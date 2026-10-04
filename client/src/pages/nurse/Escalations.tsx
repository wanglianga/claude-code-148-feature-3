// 连续拒访升级处置台（社区医生 / 妇幼专员，护士可协同记录联系）
// 升级后每次联系都记录：对象、语气、拒访原因、是否看到婴儿及状态
// 医生决定：上门复核（自动带入前次到达照片/电话记录/未完成测量项）、联系街道、家属同意恢复访视
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../api'
import type { Escalation, EscalationContact, Recheck } from '../../types'
import { AgeText, Badge, Empty, ESCALATION_STATUS_COLOR, Modal, Seg, TONE_COLOR, fmtTime, toast } from '../../components/ui'
import { useAuth } from '../../store/auth'

const TABS = [
  { key: 'open', label: '待处置' },
  { key: 'all', label: '全部工单' },
]
const TONES = ['配合', '平静', '不耐烦', '抵触', '敌对']
const RELATIONS = ['产妇本人', '丈夫', '父母/公婆', '其他亲属']
const CHANNELS = ['电话', '上门', '微信', '短信']

export default function Escalations({ doctor }: { doctor?: boolean }) {
  const [sp] = useSearchParams()
  const [tab, setTab] = useState(sp.get('status') || 'open')
  const [rows, setRows] = useState<Escalation[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<number | null>(sp.get('id') ? Number(sp.get('id')) : null)
  const [detail, setDetail] = useState<Escalation | null>(null)
  const user = useAuth((s) => s.user)
  const isDoctor = doctor || user?.role === 'doctor'
  const nav = useNavigate()

  function load() {
    setLoading(true)
    api.get<{ escalations: Escalation[] }>(`/api/escalations?status=${tab}`)
      .then((r) => setRows(r.escalations)).finally(() => setLoading(false))
  }
  useEffect(load, [tab])
  function loadDetail(id: number) {
    api.get<{ escalation: Escalation }>(`/api/escalations/${id}`).then((r) => setDetail(r.escalation))
  }
  useEffect(() => { if (openId) loadDetail(openId) }, [openId])

  return (
    <div>
      <div className="page-title">{isDoctor ? '拒访升级处置' : '拒访升级协同'}</div>
      <div className="page-sub">
        连续拒访家庭已升级{isDoctor ? '，请综合情况决定上门复核、联系街道或恢复访视；拒访期间访视任务保持开放' : '，配合社区医生记录每次联系，落实后续安排'}
      </div>
      <div className="tabs">
        {TABS.map((t) => <div key={t.key} className={`tab ${tab === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>{t.label}</div>)}
      </div>

      {loading && <Empty text="加载中…" icon="⏳" />}
      {!loading && rows.length === 0 && <Empty text="暂无拒访升级工单 🎉" icon="🏠" />}
      {rows.map((e) => (
        <div key={e.id} className="card" style={openId === e.id ? { borderColor: 'var(--primary)' } : undefined}>
          <div className="row between">
            <span className="strong">#{e.id} {e.mother_name} · {e.baby_name}</span>
            <Badge color={ESCALATION_STATUS_COLOR[e.status] || 'gray'}>{e.status}</Badge>
          </div>
          <div className="small muted mt8">{e.title}</div>
          <div className="small muted">
            <AgeText birthDate={e.birth_date || ''} /> · 连续拒访 <b style={{ color: 'var(--red)' }}>{e.refusal_count}</b> 次 · 升级至{e.level}
          </div>
          <div className="small muted">📍 {e.address} · 📞 {e.contact_name} {e.contact_phone}</div>
          <div className="row wrap mt8">
            <button className="btn ghost sm" onClick={() => { setOpenId(openId === e.id ? null : e.id); setDetail(null) }}>
              {openId === e.id ? '收起详情' : '查看拒访与联系记录'}
            </button>
            <button className="btn ghost sm" onClick={() => nav(`/nurse/archives/${e.archive_id}`)}>母婴档案</button>
            {e.status !== '已闭环' && <Badge color="red">访视任务开放中</Badge>}
          </div>

          {openId === e.id && (
            detail ? (
              <EscalationDetail e={detail} isDoctor={!!isDoctor}
                onChanged={() => { loadDetail(e.id); load() }}
                onRecheck={(apptId) => nav(`/nurse/visit/new?appointmentId=${apptId}&archiveId=${e.archive_id}&recheck=1`)} />
            ) : <Empty text="加载中…" icon="⏳" />
          )}
        </div>
      ))}
    </div>
  )
}

export function EscalationDetail({ e, isDoctor, onChanged, onRecheck }: {
  e: Escalation; isDoctor: boolean; onChanged: () => void; onRecheck: (apptId: number) => void
}) {
  const [contacting, setContacting] = useState(false)
  const [acting, setActing] = useState<'recheck' | 'street' | 'resume' | null>(null)
  const open = e.status !== '已闭环'

  return (
    <div className="mt12">
      {/* 拒访经过 */}
      <div className="card" style={{ background: '#fffaf6' }}>
        <div className="card-title" style={{ marginBottom: 8 }}><span className="dot" />护士上门拒访记录（{e.refusals?.length || 0} 次）</div>
        {e.refusals?.map((r) => (
          <div key={r.id} className="mb12" style={{ borderLeft: '3px solid var(--red)', paddingLeft: 10 }}>
            <div className="row between small">
              <span className="strong">第 {r.seq} 次 · 到达 {fmtTime(r.arrived_at)}</span>
              <Badge color={TONE_COLOR[r.tone] || 'gray'}>{r.tone}</Badge>
            </div>
            <div className="small mt8">沟通对象：{r.contact_name}（{r.contact_relation}）</div>
            <div className="small">拒访原因：{r.reason}</div>
            <div className="small muted">📞 {r.phone_content}</div>
            <div className="small">
              {r.baby_seen ? <Badge color="amber">看到婴儿</Badge> : <Badge color="red">未看到婴儿</Badge>}{' '}
              <span className="muted">{r.baby_status || '无婴儿状态描述'}</span>
            </div>
            {r.photos.length > 0 && (
              <div className="photo-row mt8">{r.photos.map((p, i) => <img key={i} src={p} alt={`到达照片${i + 1}`} />)}</div>
            )}
            {r.follow_up && <div className="small" style={{ color: 'var(--teal)' }}>后续安排：{r.follow_up}</div>}
          </div>
        ))}
      </div>

      {/* 升级后的每次联系 */}
      <div className="card" style={{ background: '#f7fcfa' }}>
        <div className="row between mb8">
          <div className="card-title" style={{ margin: 0 }}><span className="dot" style={{ background: 'var(--teal)' }} />升级后联系记录（{e.contacts?.length || 0}）</div>
          {open && <button className="btn teal sm" onClick={() => setContacting(true)}>＋ 记录联系</button>}
        </div>
        {(e.contacts?.length || 0) === 0 && <div className="small muted">暂无联系记录</div>}
        {e.contacts?.map((c: EscalationContact) => (
          <div key={c.id} className="mb8" style={{ borderLeft: '3px solid var(--teal)', paddingLeft: 10 }}>
            <div className="row between small">
              <span className="strong">{c.channel} · {c.contact_name || '未署名'}（{c.contact_relation}）</span>
              <Badge color={TONE_COLOR[c.tone] || 'gray'}>{c.tone}</Badge>
            </div>
            {c.refusal_reason && <div className="small">拒访原因：{c.refusal_reason}</div>}
            <div className="small muted">{c.content}</div>
            <div className="small">
              {c.baby_seen ? <Badge color="amber">看到婴儿</Badge> : <Badge color="gray">未看到婴儿</Badge>}{' '}
              <span className="muted">{c.baby_status || '无婴儿状态描述'}</span>
            </div>
            <div className="small muted">{fmtTime(c.created_at)} · {c.contacted_by}</div>
          </div>
        ))}
      </div>

      {/* 复核安排（自动带入资料） */}
      {e.rechecks && e.rechecks.length > 0 && (
        <div className="card" style={{ background: '#fff' }}>
          <div className="card-title"><span className="dot" style={{ background: 'var(--amber)' }} />上门复核（资料已自动带入）</div>
          {e.rechecks.map((rc: Recheck) => (
            <div key={rc.id} className="mb12">
              <div className="row between">
                <span className="small strong">计划 {fmtTime(rc.scheduled_time)} · {rc.decided_by} 决定</span>
                <Badge color={rc.status === '已完成' ? 'green' : 'amber'}>{rc.status}</Badge>
              </div>
              <div className="small mt8"><b>未完成测量项：</b>{rc.pending_items.length ? rc.pending_items.join('、') : '首次访视项目均无记录，需全套测量'}</div>
              <div className="small"><b>前次拒访原因：</b>{rc.carried_refusal_reason}</div>
              <div className="advice-pre mt8" style={{ whiteSpace: 'pre-wrap' }}><b>电话沟通记录（自动带入）：</b>{'\n'}{rc.carried_phone_log}</div>
              {rc.carried_photos.length > 0 && (
                <div className="mt8">
                  <div className="small strong mb8">前次护士到达照片（自动带入）：</div>
                  <div className="photo-row">{rc.carried_photos.map((p, i) => <img key={i} src={p} alt={`前次到达照片${i + 1}`} />)}</div>
                </div>
              )}
              {rc.status === '待上门' && !isDoctor && (
                <button className="btn primary sm mt8" onClick={() => onRecheck(rc.appointment_id!)}>前往复核（沿用带入资料，减少重复询问）</button>
              )}
              {rc.status === '待上门' && isDoctor && (
                <div className="small mt8" style={{ color: 'var(--teal)' }}>已生成复核预约，由护士按此时间上门并完成带入的测量项。</div>
              )}
              {rc.status === '已完成' && <div className="small" style={{ color: 'var(--green)' }}>✔ {rc.result_note}</div>}
            </div>
          ))}
        </div>
      )}

      {/* 处置结果 */}
      {e.status === '已闭环' && (
        <div className="alert-box info">✔ 已闭环：{e.resolution}（{e.resolved_by} · {fmtTime(e.resolved_at)}）</div>
      )}

      {/* 处置动作 */}
      {open && (
        <div className="card">
          <div className="card-title"><span className="dot" style={{ background: 'var(--red)' }} />{isDoctor ? '社区医生/妇幼专员处置' : '处置（社区医生主导，护士可代办）'}</div>
          <div className="row wrap">
            <button className="btn primary sm" onClick={() => setActing('recheck')}>决定上门复核</button>
            <button className="btn ghost sm" onClick={() => setActing('resume')}>家属同意恢复访视</button>
            <button className="btn danger sm" onClick={() => setActing('street')}>联系街道/居委会</button>
          </div>
          <div className="hint mt8">无论哪种处置都会生成明确后续安排；只有真正完成上门访视，升级工单才会闭环。</div>
        </div>
      )}

      {contacting && <ContactModal e={e} onClose={() => setContacting(false)} onDone={() => { setContacting(false); onChanged(); toast('联系记录已保存') }} />}
      {acting === 'recheck' && <RecheckModal e={e} onClose={() => setActing(null)}
        onDone={(apptId) => { setActing(null); onChanged(); toast('已安排上门复核，前次资料与未完成项已带入'); if (apptId && !isDoctor) onRecheck(apptId) }} />}
      {acting === 'resume' && <ResumeModal e={e} onClose={() => setActing(null)} onDone={() => { setActing(null); onChanged(); toast('已安排恢复访视') }} />}
      {acting === 'street' && <StreetModal e={e} onClose={() => setActing(null)} onDone={() => { setActing(null); onChanged(); toast('已记录街道协调') }} />}
    </div>
  )
}

function ContactModal({ e, onClose, onDone }: { e: Escalation; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    channel: '电话', contact_name: '', contact_relation: '产妇本人', tone: '平静',
    refusal_reason: '', baby_seen: 0, baby_status: '', content: '',
  })
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: any) => setF((s) => ({ ...s, [k]: v }))
  async function ok() {
    if (!f.content.trim()) return toast('请记录沟通内容')
    if (!f.contact_name.trim()) return toast('请填写联系对象')
    setBusy(true)
    try {
      await api.post(`/api/escalations/${e.id}/contacts`, f)
      onDone()
    } catch (err: any) { toast(err.message) } finally { setBusy(false) }
  }
  return (
    <Modal title={`记录联系 - ${e.mother_name}家`} onClose={onClose}>
      <div className="grid2">
        <div className="field"><label>联系方式</label><Seg teal options={CHANNELS} value={f.channel} onChange={(v) => set('channel', v)} /></div>
        <div className="field"><label>与母婴关系</label><Seg options={RELATIONS} value={f.contact_relation} onChange={(v) => set('contact_relation', v)} /></div>
      </div>
      <div className="field"><label>联系对象姓名</label><input value={f.contact_name} onChange={(ev) => set('contact_name', ev.target.value)} placeholder="如：林芳 / 何先生" /></div>
      <div className="field"><label>对方语气</label><Seg options={TONES} value={f.tone} onChange={(v) => set('tone', v)} /></div>
      <div className="field"><label>本次拒访/不配合原因</label><input value={f.refusal_reason} onChange={(ev) => set('refusal_reason', ev.target.value)} placeholder="如：丈夫不在家不敢做主" /></div>
      <div className="field">
        <label>是否看到婴儿</label>
        <Seg options={['未看到婴儿', '看到婴儿']} value={f.baby_seen ? '看到婴儿' : '未看到婴儿'}
          onChange={(v) => { set('baby_seen', v === '看到婴儿' ? 1 : 0); set('baby_status', '') }} />
      </div>
      <div className="field"><label>婴儿状态</label><input value={f.baby_status} onChange={(ev) => set('baby_status', ev.target.value)}
        placeholder={f.baby_seen ? '如：皮肤黄染、精神反应可' : '如：隔门听到哭声 / 家属视频展示'} /></div>
      <div className="field"><label>沟通内容</label><textarea rows={3} value={f.content} onChange={(ev) => set('content', ev.target.value)} /></div>
      <button className="btn teal block" disabled={busy} onClick={ok}>{busy ? '提交中…' : '保存联系记录'}</button>
    </Modal>
  )
}

function timeDefault() {
  const d = new Date(Date.now() + 86400000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T09:30`
}

function RecheckModal({ e, onClose, onDone }: { e: Escalation; onClose: () => void; onDone: (apptId: number | null) => void }) {
  const [time, setTime] = useState(timeDefault())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  async function ok() {
    setBusy(true)
    try {
      const r = await api.post<{ appointment_id: number }>(`/api/escalations/${e.id}/resolve`,
        { action: 'recheck', scheduled_time: time.replace('T', ' '), note })
      onDone(r.appointment_id ?? null)
    } catch (err: any) { toast(err.message); setBusy(false) }
  }
  return (
    <Modal title="决定上门复核" onClose={onClose}>
      <div className="alert-box info">
        系统将把<b>前一次护士到达照片、历次电话沟通记录、未完成测量项</b>自动带入复核访视表单，避免重复询问引起家属抵触。
      </div>
      <div className="field"><label>复核上门时间</label><input type="datetime-local" value={time} onChange={(ev) => setTime(ev.target.value)} /></div>
      <div className="field"><label>复核要点/给上门护士的说明</label><textarea rows={2} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="如：优先经门外观测黄疸，先取得家属信任" /></div>
      <button className="btn primary block" disabled={busy} onClick={ok}>{busy ? '提交中…' : '确认安排并进入复核'}</button>
    </Modal>
  )
}

function ResumeModal({ e, onClose, onDone }: { e: Escalation; onClose: () => void; onDone: () => void }) {
  const [time, setTime] = useState(timeDefault())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  async function ok() {
    setBusy(true)
    try {
      await api.post(`/api/escalations/${e.id}/resolve`, { action: 'resume', scheduled_time: time.replace('T', ' '), note })
      onDone()
    } catch (err: any) { toast(err.message); setBusy(false) }
  }
  return (
    <Modal title="家属同意恢复访视" onClose={onClose}>
      <div className="field"><label>约定上门时间</label><input type="datetime-local" value={time} onChange={(ev) => setTime(ev.target.value)} /></div>
      <div className="field"><label>沟通说明</label><textarea rows={2} value={note} onChange={(ev) => setNote(ev.target.value)} /></div>
      <button className="btn primary block" disabled={busy} onClick={ok}>{busy ? '提交中…' : '确认恢复访视'}</button>
    </Modal>
  )
}

function StreetModal({ e, onClose, onDone }: { e: Escalation; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  async function ok() {
    if (!note.trim()) return toast('请填写对接人及协调事项')
    setBusy(true)
    try {
      await api.post(`/api/escalations/${e.id}/resolve`, { action: 'street', note })
      onDone()
    } catch (err: any) { toast(err.message); setBusy(false) }
  }
  return (
    <Modal title="联系街道/居委会" onClose={onClose}>
      <div className="field">
        <label>对接人、协调事项与后续安排（必填）</label>
        <textarea rows={4} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="如：已联系幸福里居委会王主任，将由网格员陪同，周三上午共同上门核实婴儿状况" />
      </div>
      <button className="btn danger block" disabled={busy} onClick={ok}>{busy ? '提交中…' : '记录并继续跟进'}</button>
    </Modal>
  )
}
