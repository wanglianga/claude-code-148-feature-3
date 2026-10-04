import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './store/auth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/nurse/Dashboard'
import Appointments from './pages/nurse/Appointments'
import Archives from './pages/nurse/Archives'
import ArchiveDetail from './pages/nurse/ArchiveDetail'
import VisitForm from './pages/nurse/VisitForm'
import RefusalForm from './pages/nurse/RefusalForm'
import Followups from './pages/nurse/Followups'
import SyncCenter from './pages/nurse/SyncCenter'
import FamilyHome from './pages/family/FamilyHome'
import FamilyVisits from './pages/family/FamilyVisits'
import FamilyDocs from './pages/family/FamilyDocs'
import FamilyConsult from './pages/family/FamilyConsult'

function homeOf(role?: string) {
  if (role === 'nurse') return '/nurse'
  if (role === 'doctor') return '/doctor'
  if (role === 'family') return '/family'
  return '/login'
}

function Guard({ children }: { children: JSX.Element }) {
  const user = useAuth((s) => s.user)
  if (!user) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  const user = useAuth((s) => s.user)
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Navigate to={homeOf(user?.role)} replace />} />
      <Route element={<Guard><Layout /></Guard>}>
        <Route path="/nurse" element={<Dashboard />} />
        <Route path="/nurse/appointments" element={<Appointments />} />
        <Route path="/nurse/archives" element={<Archives />} />
        <Route path="/nurse/archives/:id" element={<ArchiveDetail />} />
        <Route path="/nurse/visit/new" element={<VisitForm />} />
        <Route path="/nurse/refusal/new" element={<RefusalForm />} />
        <Route path="/nurse/followups" element={<Followups />} />
        <Route path="/nurse/sync" element={<SyncCenter />} />
        <Route path="/doctor" element={<Followups doctor />} />
        <Route path="/family" element={<FamilyHome />} />
        <Route path="/family/visits" element={<FamilyVisits />} />
        <Route path="/family/docs" element={<FamilyDocs />} />
        <Route path="/family/consult" element={<FamilyConsult />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
