// 母婴档案详情：访视、测量、照片、建议、复查、转诊、材料、咨询、时间线统一视图
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../../api'
import type { ArchiveDetail as Detail, Followup, Visit } from '../../types'
import { AgeText, APPT_STATUS_COLOR, Badge, Empty, ESCALATION_STATUS_COLOR, FOLLOWUP_TYPE_COLOR, Modal, RiskBadge, TONE_COLOR, fmtTime, toast } from '../../components/ui'
import { EscalationDetail } from './Escalations'
import { useAuth } from '../../store/auth'

const TABS = ['概览', '访视记录', '复查转诊', '拒访升级', '材料咨询', '时间线']

export default function ArchiveDetail() {
  const { id } = useParams()
  const [data, setData] = useState<Detail | null>(null)
  const [tab, setTab] = useState('概览')
  const [err, setErr] = useState('')
  const nav = useNavigate()
  const user = useAuth((s) => s.user)

  function load() {
    api.get<Detail>(`/api/archives/${id}`).then(setData).catch((e) => setErr(e.message))
  }
  useEffect(load, [id])

  if (err) return <div className="alert-box danger">{err}</div>
  if (!data) return <Empty text="加载中…" icon="⏳" />
  const a = data.archive
  const openFollowups = data.followups.filter((f) => f.status !== '已闭环')
  const openEsc = data.escalations.find((e) => e.status !== '已闭环')
  const reload = load

  return (
    <div>
      <div className="row between">
        <div className="page-title" style={{ margin: 0 }}>{a.mother_name} · {a.baby_name}</div>
        <RiskBadge level={data.visits[0]?.risk_level} />
      </div>
      <div className="page-sub"><AgeText birthDate={a.birth_date} /> · {a.birth_weight}g · {a.delivery_mode} · {a.feeding_type}</div>

      {openEsc && (
        <div className="alert-box danger">
          🚪 连续拒访 <b>{openEsc.refusal_count}</b> 次，已升级{openEsc.level}（{openEsc.status}）——访视任务保持开放，请到「拒访升级」页签落实后续安排。
        </div>
      )}
      {openFollowups.length > 0 && (
        <div className="alert-box warn">
          待闭环 {openFollowups.length} 项：{openFollowups.map((f) => f.type).join('、')}
        </div>
      )}

      {user?.role === 'nurse' && (
        <div className="row wrap mb12">
          <button className="btn primary" onClick={() => nav(`/nurse/visit/new?archiveId=${a.id}`)}>＋ 记录访视</button>
          <button className="btn danger" onClick={() => nav(`/nurse/refusal/new?archiveId=${a.id}`)}>家属拒访登记</button>
          <button className="btn ghost" onClick={() => nav('/nurse/appointments')}>预约管理</button>
        </div>
      )}

      <div className="tabs">
        {TABS.map((t) => <div key={t} className={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{t}</div>)}
      </div>

      {tab === '概览' && <OverviewTab d={data} />}
      {tab === '访视记录' && <VisitsTab visits={data.visits} />}
      {tab === '复查转诊' && <FollowupsTab followups={data.followups} onChanged={load} />}
      {tab === '拒访升级' && <RefusalTab d={data} isDoctor={user?.role === 'doctor'} onChanged={reload} />}
      {tab === '材料咨询' && <DocsConsultsTab d={data} onChanged={load} />}
      {tab === '时间线' && (
        <div className="card">
          <div className="card-title"><span className="dot" />随访时间线</div>
          {data.events.length === 0 && <Empty text="暂无事件" />}
          <div className="timeline">
            {data.events.map((e) => (
              <div key={e.id} className={`tl-item ${['转诊', '升级', '拒访'].includes(e.kind) ? 'alert' : ['复查', '未开门', '改约', '联系', '复核'].includes(e.kind) ? 'warn' : ['闭环', '访视'].includes(e.kind) ? 'done' : ''}`}>
                <div className="row between">
                  <span className="strong small">{e.title}</span>
                  <Badge color="gray">{e.kind}</Badge>
                </div>
                {e.detail && <div className="small muted">{e.detail}</div>}
                <div className="small muted">{fmtTime(e.created_at)} · {e.actor}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function RefusalTab({ d, isDoctor, onChanged }: { d: Detail; isDoctor: boolean; onChanged: () => void }) {
  const nav = useNavigate()
  if (d.refusals.length === 0 && d.escalations.length === 0) {
    return (
      <div>
        <Empty text="暂无拒访记录" icon="🚪" />
        <button className="btn danger block" onClick={() => nav(`/nurse/refusal/new?archiveId=${d.archive.id}`)}>
          护士按约到达但家属拒绝开门、只愿电话沟通 → 登记拒访
        </button>
      </div>
    )
  }
  return (
    <div>
      {d.refusals.map((r) => (
        <div key={r.id} className="card">
          <div className="row between">
            <span className="strong">第 {r.seq} 次拒访 · 到达 {fmtTime(r.arrived_at)}</span>
            <Badge color={TONE_COLOR[r.tone] || 'gray'}>{r.tone}</Badge>
          </div>
          <div className="small mt8">沟通对象：{r.contact_name}（{r.contact_relation}）</div>
          <div className="small">拒访原因：{r.reason}</div>
          <div className="small muted">📞 {r.phone_content}</div>
          <div className="small mt8">
            {r.baby_seen ? <Badge color="amber">看到婴儿</Badge> : <Badge color="red">未看到婴儿</Badge>}{' '}
            <span className="muted">{r.baby_status || '无婴儿状态描述'}</span>
          </div>
          {r.photos.length > 0 && (
            <div className="photo-row mt8">{r.photos.map((p, i) => <img key={i} src={p} alt={`到达照片${i + 1}`} />)}</div>
          )}
          {r.follow_up && <div className="small mt8" style={{ color: 'var(--teal)' }}>后续安排：{r.follow_up}</div>}
        </div>
      ))}
      {d.escalations.map((e) => (
        <div key={e.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="row between" style={{ padding: '10px 14px', background: '#fff3f3', borderBottom: '1px solid var(--line)' }}>
            <span className="strong">升级工单 #{e.id} · {e.level}</span>
            <Badge color={ESCALATION_STATUS_COLOR[e.status] || 'gray'}>{e.status}</Badge>
          </div>
          <div style={{ padding: 10 }}>
            <EscalationDetail e={e} isDoctor={isDoctor} onChanged={onChanged}
              onRecheck={(apptId) => nav(`/nurse/visit/new?appointmentId=${apptId}&archiveId=${d.archive.id}&recheck=1`)} />
          </div>
        </div>
      ))}
    </div>
  )
}

function OverviewTab({ d }: { d: Detail }) {
  const a = d.archive
  const last = d.visits[0]
  return (
    <div>
      <div className="card">
        <div className="card-title"><span className="dot" />婴儿信息</div>
        <dl className="kv">
          <dt>出生日期</dt><dd>{fmtTime(a.birth_date)}（<AgeText birthDate={a.birth_date} />）</dd>
          <dt>出生体重</dt><dd>{a.birth_weight} g{last?.weight ? `，最近 ${last.weight} g` : ''}</dd>
          <dt>分娩方式</dt><dd>{a.delivery_mode}</dd>
          <dt>喂养方式</dt><dd>{a.feeding_type}</dd>
          <dt>黄疸风险</dt><dd><Badge color={a.jaundice_risk === '高' ? 'coral' : a.jaundice_risk === '中' ? 'amber' : 'green'}>{a.jaundice_risk}</Badge></dd>
        </dl>
      </div>
      <div className="card">
        <div className="card-title"><span className="dot" style={{ background: 'var(--teal)' }} />产妇与家庭</div>
        <dl className="kv">
          <dt>产妇伤口</dt><dd>{a.maternal_wound}</dd>
          <dt>出院日期</dt><dd>{a.discharge_date || '-'}</dd>
          <dt>家庭住址</dt><dd>{a.address}</dd>
          <dt>家属联系人</dt><dd>{a.contact_name} {a.contact_phone}</dd>
          <dt>照护能力</dt><dd>{a.care_ability}</dd>
          {a.notes && <><dt>备注</dt><dd>{a.notes}</dd></>}
        </dl>
      </div>
      <div className="card">
        <div className="card-title"><span className="dot" style={{ background: 'var(--amber)' }} />预约记录</div>
        {d.appointments.length === 0 && <Empty text="暂无预约" icon="📅" />}
        {d.appointments.map((p) => (
          <div key={p.id} className="row between small" style={{ padding: '6px 0', borderBottom: '1px dashed var(--line)' }}>
            <span>{p.type} · {fmtTime(p.scheduled_time)}{p.nurse_name ? ` · ${p.nurse_name}` : ''}</span>
            <Badge color={APPT_STATUS_COLOR[p.status] || 'gray'}>{p.status}</Badge>
          </div>
        ))}
      </div>
    </div>
  )
}

function VisitsTab({ visits }: { visits: Visit[] }) {
  if (visits.length === 0) return <Empty text="暂无访视记录" icon="🩺" />
  return (
    <div>
      {visits.map((v) => (
        <div key={v.id} className="card">
          <div className="row between">
            <span className="strong">{fmtTime(v.visit_time)}</span>
            <div className="row">
              {v.device_issue ? <Badge color="amber">设备故障·手工记录</Badge> : null}
              {v.created_offline ? <Badge color="teal">离线补录</Badge> : null}
              <RiskBadge level={v.risk_level} />
            </div>
          </div>
          <div className="grid2 mt8 small">
            <div>⚖️ 体重 <b>{v.weight ?? '-'} g</b></div>
            <div>🟡 黄疸 <b>{v.bilirubin ?? '-'} µmol/L</b>（{v.bilirubin_site}）</div>
            <div>脐带：{v.cord}</div>
            <div>大便 {v.stool_count} 次/{v.stool_color} · 小便 {v.urine_count} 次</div>
            <div>喂养：{v.feeding_type} {v.feeding_freq} 次/日</div>
            <div>吐奶：{v.spit_up} · 睡眠：{v.sleep}</div>
            <div>乳房：{v.breast} · 情绪：{v.mood}</div>
            <div>伤口：{v.wound_check} · 照护：{v.care_ability}</div>
          </div>
          {v.flags.length > 0 && (
            <div className="alert-box warn mt8" style={{ marginBottom: 8 }}>
              <ul className="flag-list">{v.flags.map((f, i) => <li key={i}>{f}</li>)}</ul>
            </div>
          )}
          <div className="row wrap small mb8">
            {v.need_recheck ? <Badge color="coral">需复查</Badge> : null}
            {v.need_referral ? <Badge color="red">需转诊</Badge> : null}
            {v.need_lactation ? <Badge color="teal">母乳指导</Badge> : null}
            {v.need_phone ? <Badge color="amber">电话随访</Badge> : null}
          </div>
          <div className="advice-pre">{v.advice}</div>
          {v.photos.length > 0 && (
            <div className="photo-row mt8">{v.photos.map((p, i) => <img key={i} src={p} alt={`访视照片${i + 1}`} />)}</div>
          )}
        </div>
      ))}
    </div>
  )
}

export function FollowupsTab({ followups, onChanged, doctor }: { followups: Followup[]; onChanged: () => void; doctor?: boolean }) {
  const [closing, setClosing] = useState<Followup | null>(null)
  const [deciding, setDeciding] = useState<Followup | null>(null)
  if (followups.length === 0) return <Empty text="暂无随访事项" icon="🔄" />
  return (
    <div>
      {followups.map((f) => (
        <div key={f.id} className="card">
          <div className="row between">
            <span className="strong">【{f.type}】{f.title}</span>
            <Badge color={f.status === '已闭环' ? 'green' : FOLLOWUP_TYPE_COLOR[f.type] || 'amber'}>{f.status}</Badge>
          </div>
          {f.detail && <div className="small muted mt8">{f.detail}</div>}
          <div className="small muted" style={{ marginTop: 4 }}>
            创建 {fmtTime(f.created_at)} · {f.created_by}
            {f.due_date ? ` · 截止 ${f.due_date}` : ''}
          </div>
          {f.status === '已闭环' && (
            <div className="small" style={{ color: 'var(--green)' }}>✔ {fmtTime(f.closed_at)} 由 {f.closed_by} 闭环{f.close_note ? `：${f.close_note}` : ''}</div>
          )}
          {f.status !== '已闭环' && (
            <div className="row wrap mt8">
              <button className="btn teal sm" onClick={() => setClosing(f)}>标记闭环</button>
              {doctor && <button className="btn primary sm" onClick={() => setDeciding(f)}>医生决策</button>}
            </div>
          )}
        </div>
      ))}
      {closing && <CloseModal f={closing} onClose={() => setClosing(null)} onDone={() => { setClosing(null); onChanged(); toast('已闭环') }} />}
      {deciding && <DecideModal f={deciding} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); onChanged(); toast('已记录医生决策') }} />}
    </div>
  )
}

function CloseModal({ f, onClose, onDone }: { f: Followup; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  async function ok() {
    setBusy(true)
    try { await api.post(`/api/followups/${f.id}/close`, { note }); onDone() }
    catch (e: any) { toast(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal title={`闭环 - 【${f.type}】${f.title}`} onClose={onClose}>
      <div className="field">
        <label>处理结果说明（如：已电话随访 / 已上门指导 / 已就诊反馈）</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="记录处理过程与结果" />
      </div>
      <button className="btn primary block" disabled={busy} onClick={ok}>{busy ? '提交中…' : '确认闭环'}</button>
    </Modal>
  )
}

function DecideModal({ f, onClose, onDone }: { f: Followup; onClose: () => void; onDone: () => void }) {
  const [decision, setDecision] = useState('复查')
  const [note, setNote] = useState('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  async function ok() {
    setBusy(true)
    try { await api.post(`/api/followups/${f.id}/decide`, { decision, note, dueDate: due || undefined }); onDone() }
    catch (e: any) { toast(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal title={`医生决策 - 【${f.type}】${f.title}`} onClose={onClose}>
      <div className="field">
        <label>处置决定</label>
        <div className="seg">
          {['复查', '转诊', '电话随访', '母乳指导', '继续观察'].map((d) => (
            <span key={d} className={`opt ${decision === d ? 'on' : ''}`} onClick={() => setDecision(d)}>{d}</span>
          ))}
        </div>
      </div>
      {decision === '复查' && (
        <div className="field">
          <label>复查日期</label>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
      )}
      <div className="field">
        <label>决策意见</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="综合出生天数、体重变化、喂养、排便、产妇恢复与家庭照护能力的判断" />
      </div>
      <button className="btn primary block" disabled={busy} onClick={ok}>{busy ? '提交中…' : '提交决策'}</button>
    </Modal>
  )
}

function DocsConsultsTab({ d, onChanged }: { d: Detail; onChanged: () => void }) {
  const [replyTo, setReplyTo] = useState<number | null>(null)
  const [reply, setReply] = useState('')
  const user = useAuth((s) => s.user)

  async function sendReply(id: number) {
    if (!reply.trim()) return toast('请填写回复内容')
    await api.post(`/api/consults/${id}/reply`, { reply })
    setReplyTo(null); setReply(''); onChanged(); toast('已回复')
  }
  async function uploadDoc() {
    const type = window.prompt('材料类型（出生证明/出院小结/喂养记录/其他）', '喂养记录')
    if (!type) return
    const filename = window.prompt('文件名', `${type}.jpg`)
    if (!filename) return
    await api.post('/api/documents', { archiveId: d.archive.id, type, filename, note: '护士代录' })
    onChanged(); toast('已登记材料')
  }

  return (
    <div>
      <div className="card">
        <div className="row between mb8">
          <div className="card-title" style={{ margin: 0 }}><span className="dot" />家属补充材料</div>
          {user?.role === 'nurse' && <button className="btn ghost sm" onClick={uploadDoc}>代录材料</button>}
        </div>
        {d.documents.length === 0 && <Empty text="暂无材料" icon="📎" />}
        {d.documents.map((doc) => (
          <div key={doc.id} className="row between small" style={{ padding: '6px 0', borderBottom: '1px dashed var(--line)' }}>
            <span><Badge color="teal">{doc.type}</Badge> {doc.filename} <span className="muted">{doc.note}</span></span>
            <span className="muted">{fmtTime(doc.created_at)}</span>
          </div>
        ))}
        {d.documents.some((x) => x.data_url) && (
          <div className="photo-row mt8">
            {d.documents.filter((x) => x.data_url).map((x) => <img key={x.id} src={x.data_url} alt={x.filename} />)}
          </div>
        )}
      </div>
      <div className="card">
        <div className="card-title"><span className="dot" style={{ background: 'var(--teal)' }} />线上咨询</div>
        {d.consults.length === 0 && <Empty text="暂无咨询" icon="💬" />}
        {d.consults.map((c) => (
          <div key={c.id} className="mb12">
            <div className="row between">
              <Badge color={c.status === '已回复' ? 'green' : 'amber'}>{c.status}</Badge>
              <span className="small muted">{fmtTime(c.created_at)}</span>
            </div>
            <div className="small mt8">问：{c.question}</div>
            {c.reply && <div className="small" style={{ color: 'var(--teal)' }}>答（{c.replied_by}）：{c.reply}</div>}
            {c.status !== '已回复' && (
              replyTo === c.id ? (
                <div className="mt8">
                  <div className="field"><textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="输入回复内容" /></div>
                  <div className="row">
                    <button className="btn primary sm" onClick={() => sendReply(c.id)}>发送</button>
                    <button className="btn ghost sm" onClick={() => setReplyTo(null)}>取消</button>
                  </div>
                </div>
              ) : <button className="btn ghost sm mt8" onClick={() => setReplyTo(c.id)}>回复</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
