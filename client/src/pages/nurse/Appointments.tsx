// 预约列表：按状态筛选，支持改约、标记未开门、进入访视
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api'
import type { Appointment } from '../../types'
import { APPT_STATUS_COLOR, Badge, Empty, Modal, fmtTime, toast } from '../../components/ui'

const TABS = ['待访视', '已完成', '未开门', '家属拒访', '全部'] as const

export default function Appointments() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('待访视')
  const [rows, setRows] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [rescheduleOf, setRescheduleOf] = useState<Appointment | null>(null)
  const nav = useNavigate()

  function load() {
    setLoading(true)
    const q = tab === '全部' ? '/api/appointments' : `/api/appointments?status=${encodeURIComponent(tab)}`
    api.get<{ appointments: Appointment[] }>(q).then((r) => setRows(r.appointments)).finally(() => setLoading(false))
  }
  useEffect(load, [tab])

  async function noShow(a: Appointment) {
    const note = window.prompt('记录未开门情况说明', '上门敲门无人应答，电话未接通')
    if (note == null) return
    await api.post(`/api/appointments/${a.id}/no-show`, { note })
    toast('已标记未开门，并生成「再次预约」随访事项')
    load()
  }

  return (
    <div>
      <div className="page-title">访视预约</div>
      <div className="tabs">
        {TABS.map((t) => <div key={t} className={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{t}</div>)}
      </div>
      {loading && <Empty text="加载中…" icon="⏳" />}
      {!loading && rows.length === 0 && <Empty text={`暂无「${tab}」预约`} icon="📅" />}
      {rows.map((a) => (
        <div key={a.id} className="card">
          <div className="row between">
            <span className="strong">{a.mother_name} · {a.baby_name}</span>
            <Badge color={APPT_STATUS_COLOR[a.status] || 'gray'}>{a.status}</Badge>
          </div>
          <div className="small muted mt8">🕐 {fmtTime(a.scheduled_time)} · {a.type}</div>
          <div className="small muted">📍 {a.address}</div>
          <div className="small muted">📞 {a.contact_name} {a.contact_phone}</div>
          {a.reason && <div className="small" style={{ color: 'var(--amber)' }}>备注：{a.reason}</div>}
          {a.status === '待访视' && (
            <div className="row wrap mt8">
              <button className="btn primary sm" onClick={() => nav(`/nurse/visit/new?appointmentId=${a.id}&archiveId=${a.archive_id}`)}>开始访视</button>
              <button className="btn ghost sm" onClick={() => setRescheduleOf(a)}>改约</button>
              <button className="btn danger sm" onClick={() => nav(`/nurse/refusal/new?appointmentId=${a.id}&archiveId=${a.archive_id}`)}>家属拒访·只愿电话</button>
              <button className="btn ghost sm" onClick={() => noShow(a)}>无人应答</button>
              <button className="btn ghost sm" onClick={() => nav(`/nurse/archives/${a.archive_id}`)}>档案</button>
            </div>
          )}
          {(a.status === '家属拒访' || a.status === '未开门') && (
            <div className="alert-box warn mt8" style={{ marginBottom: 0 }}>
              {a.status === '家属拒访'
                ? <>家属拒绝开门、只愿电话沟通——访视任务<b>未关闭</b>，需再约或由社区医生升级处置。<a onClick={() => nav(`/nurse/escalations`)} style={{ marginLeft: 6 }}>查看升级 →</a></>
                : a.reason}
            </div>
          )}
          {a.status !== '待访视' && (
            <div className="row mt8">
              <button className="btn ghost sm" onClick={() => nav(`/nurse/archives/${a.archive_id}`)}>查看档案</button>
            </div>
          )}
        </div>
      ))}

      {rescheduleOf && (
        <RescheduleModal appt={rescheduleOf} onClose={() => setRescheduleOf(null)}
          onDone={() => { setRescheduleOf(null); load(); toast('已改约') }} />
      )}
    </div>
  )
}

export function RescheduleModal({ appt, onClose, onDone }: { appt: Appointment; onClose: () => void; onDone: () => void }) {
  const [time, setTime] = useState(appt.scheduled_time.replace(' ', 'T').slice(0, 16))
  const [reason, setReason] = useState('家庭临时改约')
  const [busy, setBusy] = useState(false)
  async function ok() {
    setBusy(true)
    try {
      await api.post(`/api/appointments/${appt.id}/reschedule`, { scheduledTime: time, reason })
      onDone()
    } catch (e: any) { toast(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal title={`改约 - ${appt.mother_name || ''} ${appt.baby_name || ''}`} onClose={onClose}>
      <div className="field">
        <label>新的上门时间</label>
        <input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
      </div>
      <div className="field">
        <label>改约原因</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如：家庭临时改约" />
      </div>
      <button className="btn primary block" disabled={busy} onClick={ok}>{busy ? '提交中…' : '确认改约'}</button>
    </Modal>
  )
}
