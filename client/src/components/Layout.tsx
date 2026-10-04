// 应用框架：顶部栏（含离线模式开关）+ 底部标签导航
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { useNet } from '../store/net'
import { useDrafts } from '../store/drafts'
import { Toast } from './ui'

const NAVS: Record<string, { to: string; ico: string; label: string }[]> = {
  nurse: [
    { to: '/nurse', ico: '🏠', label: '工作台' },
    { to: '/nurse/appointments', ico: '📅', label: '预约' },
    { to: '/nurse/archives', ico: '📁', label: '档案' },
    { to: '/nurse/escalations', ico: '🚪', label: '拒访' },
    { to: '/nurse/followups', ico: '🔄', label: '闭环' },
    { to: '/nurse/sync', ico: '📡', label: '同步' },
  ],
  doctor: [
    { to: '/doctor', ico: '🩺', label: '随访决策' },
    { to: '/doctor/escalations', ico: '🚪', label: '拒访升级' },
    { to: '/nurse/archives', ico: '📁', label: '档案' },
  ],
  family: [
    { to: '/family', ico: '🏠', label: '首页' },
    { to: '/family/visits', ico: '📋', label: '访视建议' },
    { to: '/family/docs', ico: '📎', label: '材料' },
    { to: '/family/consult', ico: '💬', label: '咨询改约' },
  ],
}

export default function Layout() {
  const { user, logout } = useAuth()
  const { offline, setOffline } = useNet()
  const drafts = useDrafts((s) => s.drafts)
  const nav = useNavigate()
  if (!user) return null
  const navs = NAVS[user.role] || []
  const pending = drafts.length

  return (
    <div>
      <div className="header">
        <div className="header-inner">
          <div className="logo"><span className="icon">👶</span>新生儿访视</div>
          <div className="grow" />
          {user.role === 'nurse' && (
            <button className={`net-toggle ${offline ? 'off' : ''}`} onClick={() => setOffline(!offline)}
              title="模拟上门现场网络不稳定">
              {offline ? '📵 离线模式' : '📶 在线'}
            </button>
          )}
          <span className="small muted">{user.title || ''} {user.name}</span>
          <button className="btn ghost sm" onClick={() => { logout(); nav('/login') }}>退出</button>
        </div>
        {offline && (
          <div className="offline-bar">
            离线模式：访视记录将先保存为本地草稿，回到社区网络恢复后在「同步」页上传
            {pending > 0 ? `（待同步 ${pending} 条）` : ''}
          </div>
        )}
      </div>
      <div className="page">
        <Outlet />
      </div>
      <div className="navbar">
        <div className="navbar-inner">
          {navs.map((n) => (
            <NavLink key={n.to} to={n.to} end className={({ isActive }) => (isActive ? 'on' : '')}>
              <span className="ico">{n.ico}</span>
              {n.label}
              {n.to === '/nurse/sync' && pending > 0 && (
                <span className="badge coral" style={{ position: 'absolute', marginLeft: 28, marginTop: -4 }}>{pending}</span>
              )}
            </NavLink>
          ))}
        </div>
      </div>
      <Toast />
    </div>
  )
}
