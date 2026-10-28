import { lazy, Suspense } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { User, Building2, Users, CreditCard, BarChart3, KeyRound, Sparkles, ScrollText, Database, Shield } from 'lucide-react';
import { Loading, PageHeader, Select } from '../../components/ui.jsx';
import './settings.css';

const Profile = lazy(() => import('./Profile.jsx'));
const Workspace = lazy(() => import('./Workspace.jsx'));
const Members = lazy(() => import('./Members.jsx'));
const Usage = lazy(() => import('./Usage.jsx'));
const ApiKeys = lazy(() => import('./ApiKeys.jsx'));
const AiSettings = lazy(() => import('./AiSettings.jsx'));
const AuditLog = lazy(() => import('./AuditLog.jsx'));
const Storage = lazy(() => import('./Storage.jsx'));
const Security = lazy(() => import('./Security.jsx'));

const NAV = [
  { group: 'Account' },
  { to: 'profile', label: 'Profile', icon: User, el: Profile },
  { group: 'Workspace' },
  { to: 'workspace', label: 'General', icon: Building2, el: Workspace },
  { to: 'members', label: 'Members', icon: Users, el: Members },
  { to: 'usage', label: 'Usage', icon: BarChart3, el: Usage },
  { group: 'Advanced' },
  { to: 'api-keys', label: 'API keys', icon: KeyRound, el: ApiKeys },
  { to: 'ai', label: 'AI', icon: Sparkles, el: AiSettings },
  { to: 'audit', label: 'Audit log', icon: ScrollText, el: AuditLog },
  { to: 'storage', label: 'Storage', icon: Database, el: Storage },
  { to: 'security', label: 'Security', icon: Shield, el: Security },
];
const PAGES = NAV.filter((n) => n.to);

export default function Settings() {
  const loc = useLocation();
  const navigate = useNavigate();
  const current = PAGES.find((p) => loc.pathname.startsWith(`/settings/${p.to}`))?.to || 'profile';
  return (
    <div className="page">
      <PageHeader title="Settings" description="Manage your profile, workspace, team and developer access." />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings">
          {NAV.map((n, i) => (n.group
            ? <div key={i} className="nav-group">{n.group}</div>
            : <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><n.icon />{n.label}</NavLink>))}
        </nav>
        <div className="settings-mobile-nav">
          <Select aria-label="Settings section" value={current} onChange={(e) => navigate(`/settings/${e.target.value}`)}
            options={PAGES.map((p) => ({ value: p.to, label: p.label }))} />
        </div>
        <div style={{ minWidth: 0 }}>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route index element={<Navigate to="profile" replace />} />
              {PAGES.map((p) => <Route key={p.to} path={`${p.to}/*`} element={<p.el />} />)}
              <Route path="billing" element={<Navigate to="/settings/usage" replace />} />
              <Route path="*" element={<Navigate to="/settings/profile" replace />} />
            </Routes>
          </Suspense>
        </div>
      </div>
    </div>
  );
}
