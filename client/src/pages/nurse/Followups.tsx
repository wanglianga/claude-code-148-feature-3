// 随访闭环中心：护士处理闭环，社区医生决策（复查/转诊/电话随访/母乳指导/继续观察）
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api'
import type { Followup, Escalation } from '../../types'
import { AgeText, Badge, Empty, FOLLOWUP_TYPE_COLOR, fmtTime } from '../../components/ui'
import { FollowupsTab } from './ArchiveDetail'
import { EscalationCard } from './RefusalEscalation'
import { useAuth } from '../../store/auth'

export default function Followups({ doctor }: { doctor?: boolean }) {
  const [rows, setRows] = useState<Followup[]>([])
  const [escalations, setEscalations] = useState<Escalation[]>([])
  const [showAll, setShowAll] = useState(false)
  const [loading, setLoading] = useState(true)
  const nav = useNavigate()
  const user = useAuth((s) => s.user)
  const isDoctor = doctor || user?.role === 'doctor'

  function load() {
    setLoading(true)
    Promise.all([
      api.get<{ followups: Followup[] }>(`/api/followups${showAll ? '?status=all' : ''}`),
      api.get<{ escalations: Escalation[] }>(showAll ? '/api/escalations?status=all' : '/api/escalations'),
    ]).then(([f, e]) => { setRows(f.followups); setEscalations(e.escalations) }).finally(() => setLoading(false))
  }
  useEffect(load, [showAll])

  const open = rows.filter((r) => r.status !== '已闭环')

  return (
    <div>
      <div className="page-title">{isDoctor ? '随访决策' : '随访闭环'}</div>
      <div className="page-sub">
        {isDoctor ? '综合出生天数、体重变化、喂养、排便、产妇恢复与家庭照护能力，决定复查、转诊或电话随访；连续拒访家庭在此决定上门复核或联系街道' : '异常黄疸、产妇风险、拒访、咨询等事项的处理闭环'}
      </div>
      <div className="tabs">
        <div className={`tab ${!showAll ? 'on' : ''}`} onClick={() => setShowAll(false)}>待处理（{open.length}）</div>
        <div className={`tab ${showAll ? 'on' : ''}`} onClick={() => setShowAll(true)}>全部记录</div>
      </div>
      {loading && <Empty text="加载中…" icon="⏳" />}
      {!loading && escalations.length > 0 && (
        <div className="mb12">
          <div className="card-title"><span className="dot" style={{ background: 'var(--red)' }} />连续拒访升级（{escalations.length}）</div>
          {escalations.map((e) => (
            <EscalationCard key={e.id} esc={e} onChanged={load} doctor={isDoctor} />
          ))}
        </div>
      )}
      {!loading && rows.length === 0 && escalations.length === 0 && <Empty text="暂无待处理事项，全部闭环 🎉" icon="🎉" />}
      {!loading && rows.length > 0 && (
        doctorGrouped(rows, nav, load, isDoctor)
      )}
    </div>
  )
}

// 按档案分组展示，便于把同一份随访记录放在一起决策
function doctorGrouped(rows: Followup[], nav: (s: string) => void, reload: () => void, isDoctor: boolean) {
  const groups = new Map<number, Followup[]>()
  for (const r of rows) {
    if (!groups.has(r.archive_id)) groups.set(r.archive_id, [])
    groups.get(r.archive_id)!.push(r)
  }
  return [...groups.entries()].map(([archiveId, items]) => {
    const first = items[0]
    return (
      <div key={archiveId} className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="row between" style={{ padding: '12px 14px', background: '#fffaf6', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}
          onClick={() => nav(`/nurse/archives/${archiveId}`)}>
          <div>
            <span className="strong">{first.mother_name} · {first.baby_name}</span>
            <span className="small muted">（{first.birth_date ? <AgeText birthDate={first.birth_date} /> : ''}）</span>
            <div className="small muted">📍 {first.address} · 📞 {first.contact_name} {first.contact_phone}</div>
          </div>
          <Badge color="teal">档案 →</Badge>
        </div>
        <div style={{ padding: '10px 14px' }}>
          <FollowupsTab followups={items} onChanged={reload} doctor={isDoctor} />
        </div>
      </div>
    )
  })
}
