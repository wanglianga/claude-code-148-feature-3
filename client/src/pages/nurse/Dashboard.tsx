// 护士工作台：未访视家庭、异常黄疸、产妇风险、拒访升级、随访闭环一览
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../../api'
import type { Dashboard } from '../../types'
import { APPT_STATUS_COLOR, Badge, Empty, ESCALATION_STATUS_COLOR, RiskBadge, Stat, fmtTime } from '../../components/ui'
import { useDrafts } from '../../store/drafts'

export default function Dashboard() {
  const [data, setData] = useState<Dashboard | null>(null)
  const [err, setErr] = useState('')
  const drafts = useDrafts((s) => s.drafts)
  const nav = useNavigate()

  useEffect(() => {
    api.get<Dashboard>('/api/dashboard').then(setData).catch((e) => setErr(e.message))
  }, [])

  if (err) return <div className="alert-box danger">{err}</div>
  if (!data) return <Empty text="加载中…" icon="⏳" />
  const s = data.stats

  return (
    <div>
      <div className="page-title">工作台</div>
      <div className="grid4 mb12">
        <Stat num={s.unvisited} label="未访视家庭" color="amber" onClick={() => nav('/nurse/appointments')} />
        <Stat num={s.jaundiceAlerts} label="异常黄疸/复查" color="coral" onClick={() => nav('/nurse/archives?filter=jaundice')} />
        <Stat num={s.refusalEscalations} label="拒访升级" color="red" onClick={() => nav('/nurse/escalations')} />
        <Stat num={s.openFollowups} label="待闭环事项" color="teal" onClick={() => nav('/nurse/followups')} />
      </div>

      {drafts.length > 0 && (
        <div className="alert-box warn row between">
          <span>📡 有 {drafts.length} 条离线访视草稿待同步</span>
          <Link to="/nurse/sync" className="btn sm primary">去同步</Link>
        </div>
      )}

      {data.openEscalations.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--red)' }}>
          <div className="card-title"><span className="dot" style={{ background: 'var(--red)' }} />连续拒访升级（访视任务开放中，需明确后续安排）</div>
          {data.openEscalations.map((e) => (
            <div key={e.id} className="list-item" onClick={() => nav(`/nurse/escalations?id=${e.id}`)}>
              <div className="row between">
                <span className="strong">{e.mother_name} · {e.baby_name}</span>
                <Badge color={ESCALATION_STATUS_COLOR[e.status] || 'red'}>{e.status}</Badge>
              </div>
              <div className="small muted mt8">连续拒访 {e.refusal_count} 次 · 升级至{e.level} · {e.title}</div>
              <div className="small muted">📍 {e.address} · 📞 {e.contact_name} {e.contact_phone}</div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-title"><span className="dot" />今日待访视（含逾期未访）</div>
        {data.todayAppointments.length === 0 && <Empty text="今日暂无待访视家庭" icon="🎉" />}
        {data.todayAppointments.map((a) => (
          <div key={a.id} className="list-item" onClick={() => nav(`/nurse/archives/${a.archive_id}`)}>
            <div className="row between">
              <span className="strong">{a.mother_name} · {a.baby_name}</span>
              <Badge color={APPT_STATUS_COLOR[a.status]}>{a.type} {fmtTime(a.scheduled_time).slice(11)}</Badge>
            </div>
            <div className="small muted mt8">📍 {a.address}</div>
            <div className="small muted">📞 {a.contact_name} {a.contact_phone} · 黄疸风险{a.jaundice_risk}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-title"><span className="dot" style={{ background: 'var(--red)' }} />近期高风险访视</div>
        {data.recentHighRiskVisits.length === 0 && <Empty text="暂无高风险记录" />}
        {data.recentHighRiskVisits.map((v) => (
          <div key={v.id} className="list-item" onClick={() => nav(`/nurse/archives/${v.archive_id}`)}>
            <div className="row between">
              <span className="strong">{v.mother_name} · {v.baby_name}</span>
              <RiskBadge level={v.risk_level} />
            </div>
            <div className="small muted mt8">
              {fmtTime(v.visit_time)} · 黄疸 {v.bilirubin ?? '-'} µmol/L · 体重 {v.weight ?? '-'} g
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-title"><span className="dot" style={{ background: 'var(--teal)' }} />待闭环事项分布</div>
        <div className="row wrap">
          {Object.entries(data.followupsByType).length === 0 && <span className="muted small">全部闭环 🎉</span>}
          {Object.entries(data.followupsByType).map(([t, n]) => (
            <Badge key={t} color="teal">{t} × {n}</Badge>
          ))}
        </div>
      </div>
    </div>
  )
}
