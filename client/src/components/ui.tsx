// 通用小组件
import { useEffect, useState, type ReactNode } from 'react'

export const RISK_COLOR: Record<string, string> = { 低: 'green', 中: 'amber', 高: 'coral', 危急: 'red' }

export function RiskBadge({ level }: { level?: string | null }) {
  if (!level) return <span className="badge gray">未评估</span>
  return <span className={`badge ${RISK_COLOR[level] || 'gray'}`}>风险 {level}</span>
}

export function Badge({ color = 'gray', children }: { color?: string; children: ReactNode }) {
  return <span className={`badge ${color}`}>{children}</span>
}

export function Stat({ num, label, color, onClick }: { num: ReactNode; label: string; color?: string; onClick?: () => void }) {
  return (
    <div className={`stat ${color || ''}`} onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className="num">{num}</div>
      <div className="label">{label}</div>
    </div>
  )
}

export function Empty({ text = '暂无数据', icon = '🌿' }: { text?: string; icon?: string }) {
  return <div className="empty"><div className="big">{icon}</div>{text}</div>
}

export function AgeText({ birthDate }: { birthDate: string }) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(birthDate.replace(' ', 'T')).getTime()) / 86400000))
  return <span>出生第 {days + 1} 天</span>
}

export function fmtTime(s?: string | null) {
  if (!s) return '-'
  return s.replace('T', ' ').slice(0, 16)
}
export function fmtDate(s?: string | null) {
  if (!s) return '-'
  return s.slice(0, 10)
}

// 轻提示
let toastTimer: ReturnType<typeof setTimeout> | null = null
export function Toast() {
  const [msg, setMsg] = useState('')
  useEffect(() => {
    ;(window as any).__toast = (m: string) => {
      setMsg(m)
      if (toastTimer) clearTimeout(toastTimer)
      toastTimer = setTimeout(() => setMsg(''), 2600)
    }
  }, [])
  if (!msg) return null
  return <div className="toast">{msg}</div>
}
export const toast = (m: string) => (window as any).__toast?.(m)

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row between mb12">
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button className="btn ghost sm" onClick={onClose}>关闭</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export const APPT_STATUS_COLOR: Record<string, string> = {
  待访视: 'amber', 已完成: 'green', 已改约: 'teal', 拒访: 'red', 未开门: 'gray', 已取消: 'gray',
}
export const FOLLOWUP_TYPE_COLOR: Record<string, string> = {
  复查: 'coral', 转诊: 'red', 母乳指导: 'teal', 电话随访: 'amber', 线上咨询: 'teal', 再次预约: 'amber',
  拒访升级: 'red', 上门复核: 'coral', 联系街道: 'teal',
}
