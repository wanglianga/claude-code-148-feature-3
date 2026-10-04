// 母婴档案列表：搜索 + 风险筛选（未访视/异常黄疸/产妇风险/待闭环）
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../api'
import type { Archive } from '../../types'
import { AgeText, Badge, Empty, RiskBadge, fmtTime } from '../../components/ui'

const FILTERS = [
  { key: '', label: '全部' },
  { key: 'unvisited', label: '未访视' },
  { key: 'jaundice', label: '异常黄疸' },
  { key: 'maternal', label: '产妇风险' },
  { key: 'refusal', label: '拒访升级' },
  { key: 'unclosed', label: '待闭环' },
]

export default function Archives() {
  const [sp, setSp] = useSearchParams()
  const filter = sp.get('filter') || ''
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<Archive[]>([])
  const [loading, setLoading] = useState(true)
  const nav = useNavigate()

  useEffect(() => {
    setLoading(true)
    api.get<{ archives: Archive[] }>(`/api/archives?filter=${filter}&q=${encodeURIComponent(q)}`)
      .then((r) => setRows(r.archives)).finally(() => setLoading(false))
  }, [filter, q])

  return (
    <div>
      <div className="page-title">母婴档案</div>
      <div className="field">
        <input placeholder="搜索产妇 / 宝宝 / 地址 / 电话" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="tabs">
        {FILTERS.map((f) => (
          <div key={f.key} className={`tab ${filter === f.key ? 'on' : ''}`}
            onClick={() => setSp(f.key ? { filter: f.key } : {})}>{f.label}</div>
        ))}
      </div>
      {loading && <Empty text="加载中…" icon="⏳" />}
      {!loading && rows.length === 0 && <Empty text="没有符合条件的档案" icon="📁" />}
      {rows.map((a) => (
        <div key={a.id} className="list-item" onClick={() => nav(`/nurse/archives/${a.id}`)}>
          <div className="row between">
            <span className="strong">{a.mother_name} · {a.baby_name}（{a.baby_gender}）</span>
            <RiskBadge level={a.last_risk} />
          </div>
          <div className="row wrap mt8 small muted">
            <AgeText birthDate={a.birth_date} /><span>·</span><span>{a.birth_weight}g</span><span>·</span>
            <span>{a.delivery_mode}</span><span>·</span><span>{a.feeding_type}</span>
            <Badge color={a.jaundice_risk === '高' ? 'coral' : a.jaundice_risk === '中' ? 'amber' : 'green'}>黄疸风险{a.jaundice_risk}</Badge>
          </div>
          <div className="row wrap small muted" style={{ marginTop: 4 }}>
            {a.pending_appts ? <Badge color="amber">待访视 ×{a.pending_appts}</Badge> : null}
            {a.open_escalation ? <Badge color="red">拒访升级中</Badge> : null}
            {a.refusal_count ? <Badge color="gray">拒访 ×{a.refusal_count}</Badge> : null}
            {a.open_followups ? <Badge color="teal">待闭环 ×{a.open_followups}</Badge> : null}
            {a.last_bilirubin != null && <span>最近黄疸 {a.last_bilirubin} µmol/L</span>}
            {a.next_appt && <span>下次预约 {fmtTime(a.next_appt)}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}
