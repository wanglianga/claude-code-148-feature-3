// 同步中心：离线草稿批量上传（幂等），失败可重试；访视草稿与拒访记录分别走各自接口
import { useState } from 'react'
import { api } from '../../api'
import { useDrafts, type Draft } from '../../store/drafts'
import { useNet } from '../../store/net'
import { Badge, Empty, toast } from '../../components/ui'

export default function SyncCenter() {
  const { drafts, remove, markFailed } = useDrafts()
  const { offline, setOffline } = useNet()
  const [busy, setBusy] = useState(false)

  async function syncBatch(kind: 'visit' | 'refusal', batch: Draft[]) {
    if (batch.length === 0) return
    const path = kind === 'refusal' ? '/api/sync/refusals' : '/api/sync/visits'
    const key = kind === 'refusal' ? 'refusals' : 'visits'
    const r = await api.post<{ results: { client_id: string; ok: boolean; duplicated?: boolean; error?: string }[] }>(
      path, { [key]: batch.map((d) => d.payload) },
    )
    let okCount = 0
    for (const res of r.results) {
      if (res.ok) { remove(res.client_id); okCount++ }
      else markFailed(res.client_id, res.error || '同步失败')
    }
    if (okCount > 0) toast(`已同步 ${okCount} 条${kind === 'refusal' ? '拒访' : '访视'}记录`)
    if (r.results.length - okCount > 0) toast(`失败 ${r.results.length - okCount} 条，可重试`)
  }

  async function syncAll() {
    if (offline) return toast('当前处于离线模式，请先切回在线')
    if (drafts.length === 0) return
    setBusy(true)
    try {
      await syncBatch('visit', drafts.filter((d) => d.kind === 'visit'))
      await syncBatch('refusal', drafts.filter((d) => d.kind === 'refusal'))
    } catch (e: any) {
      toast(`同步失败：${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="page-title">草稿与同步</div>
      <div className="page-sub">上门现场网络不稳定时，访视与拒访记录先保存本地草稿；回到社区网络恢复后在此批量补齐同步</div>

      <div className="card row between">
        <div>
          <div className="strong">当前网络</div>
          <div className="small muted">{offline ? '📵 离线模式（草稿仅保存在本机）' : '📶 在线，可以同步'}</div>
        </div>
        <button className="btn ghost sm" onClick={() => setOffline(!offline)}>{offline ? '切换为在线' : '切换为离线'}</button>
      </div>

      {drafts.length === 0 && <Empty text="没有待同步的离线草稿" icon="📡" />}
      {drafts.map((d) => (
        <div key={d.clientId} className="card">
          <div className="row between">
            <span className="strong">{d.label}</span>
            <div className="row">
              <Badge color={d.kind === 'refusal' ? 'coral' : 'teal'}>{d.kind === 'refusal' ? '拒访记录' : '访视记录'}</Badge>
              <Badge color={d.status === '待同步' ? 'amber' : 'red'}>{d.status}</Badge>
            </div>
          </div>
          <div className="small muted mt8">保存于 {d.savedAt}</div>
          {d.kind === 'visit' && (
            <div className="small muted">
              体重 {(d.payload as any).weight ?? '-'}g · 黄疸 {(d.payload as any).bilirubin ?? '-'} µmol/L
              {(d.payload as any).device_issue ? ' · 设备故障手工记录' : ''}
            </div>
          )}
          {d.kind === 'refusal' && (
            <div className="small muted">
              到达 {(d.payload as any).arrived_at?.replace?.('T', ' ') || '-'} · {(d.payload as any).reason_code} · 看到婴儿：{(d.payload as any).baby_visible}
            </div>
          )}
          {d.error && <div className="small" style={{ color: 'var(--red)' }}>{d.error}</div>}
          <div className="row mt8">
            <button className="btn danger sm" onClick={() => { if (window.confirm('确定删除该草稿？删除后不可恢复')) remove(d.clientId) }}>删除</button>
          </div>
        </div>
      ))}

      {drafts.length > 0 && (
        <button className="btn primary block" disabled={busy || offline} onClick={syncAll}>
          {busy ? '同步中…' : `⬆ 立即同步 ${drafts.length} 条草稿`}
        </button>
      )}
    </div>
  )
}
