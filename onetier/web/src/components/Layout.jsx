import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Home, Zap, Table2, LayoutTemplate, Bot, Network, History, UserCheck, Inbox, Blocks, Cable, Plug, Code2, Library, Settings, Search, Plus,
  Bell, Sparkles, Menu as MenuIcon, ChevronsUpDown, LogOut, Moon, Sun, User, Gauge, Check, Building2, Wand2, X, CheckCheck, Trash2,
} from 'lucide-react';
import api from '../lib/api.js';
import { useAuth, useFetch, useToast, useDialog } from '../lib/context.jsx';
import { timeAgo, fmtNum, getTheme, setTheme } from '../lib/util.js';
import { Logo, Menu, Avatar, Button, Spinner } from './ui.jsx';
import CopilotPanel from './CopilotPanel.jsx';

const NAV = [
  { items: [{ to: '/', label: 'Home', icon: Home, end: true }] },
  { section: 'Build', items: [
    { to: '/flows', label: 'Flows', icon: Zap }, { to: '/tables', label: 'Tables', icon: Table2 }, { to: '/interfaces', label: 'Interfaces', icon: LayoutTemplate },
    { to: '/chatbots', label: 'Chatbots', icon: Bot }, { to: '/canvas', label: 'Canvas', icon: Network }, { to: '/templates', label: 'Templates', icon: Library },
  ] },
  { section: 'Monitor', items: [
    { to: '/history', label: 'History', icon: History }, { to: '/approvals', label: 'Approvals', icon: UserCheck, badge: 'approvals' }, { to: '/inbox', label: 'Inbox', icon: Inbox, badge: 'mail' },
  ] },
  { section: 'Connect', items: [
    { to: '/apps', label: 'Apps', icon: Blocks }, { to: '/connections', label: 'Connections', icon: Plug }, { to: '/mcp', label: 'MCP', icon: Cable }, { to: '/developer', label: 'Developer', icon: Code2 },
  ] },
];

export default function Layout() {
  const { me, logout, switchWorkspace } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [copilot, setCopilot] = useState(false);
  const [theme, setThemeState] = useState(getTheme());
  const { data: dash, reload: reloadCounts } = useFetch('dashboard');
  const dialog = useDialog();
  const toast = useToast();

  useEffect(() => { setMobileOpen(false); }, [loc.pathname]);
  useEffect(() => { const t = setInterval(reloadCounts, 30000); return () => clearInterval(t); }, [reloadCounts]);
  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); setCopilot((p) => !p); }
    };
    window.addEventListener('keydown', h);
    const open = () => setCopilot(true);
    window.addEventListener('onetier:copilot', open);
    return () => { window.removeEventListener('keydown', h); window.removeEventListener('onetier:copilot', open); };
  }, []);

  const badges = { approvals: dash?.pendingApprovals, mail: dash?.counts?.unreadMail };
  const usage = me.usage;
  const toggleTheme = () => { const t = theme === 'dark' ? 'light' : 'dark'; setTheme(t); setThemeState(t); };

  const newWorkspace = async () => {
    const name = await dialog.prompt({ title: 'Create workspace', label: 'Workspace name', placeholder: 'Acme Inc.', confirmText: 'Create' });
    if (!name) return;
    try { await api.post('workspaces', { name }); window.location.href = '/'; } catch (e) { toast.error(e.message); }
  };
  const create = async (kind) => {
    try {
      if (kind === 'flow') { const r = await api.post('flows', { name: 'Untitled flow' }); nav(`/flows/${r.id}`); }
      if (kind === 'table') { const r = await api.post('tables', { name: 'Untitled table' }); nav(`/tables/${r.id}`); }
      if (kind === 'interface') { const r = await api.post('interfaces', { name: 'Untitled interface' }); nav(`/interfaces/${r.id}`); }
      if (kind === 'chatbot') { const r = await api.post('chatbots', { name: 'New chatbot' }); nav(`/chatbots/${r.id}`); }
      if (kind === 'canvas') { const r = await api.post('canvases', { name: 'Untitled canvas' }); nav(`/canvas/${r.id}`); }
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div className="shell">
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="sidebar-head">
          <NavLink to="/" style={{ textDecoration: 'none' }}><Logo /></NavLink>
          <Button className="mobile-menu-btn" variant="ghost" size="sm" icon={X} style={{ marginLeft: 'auto' }} onClick={() => setMobileOpen(false)} aria-label="Close menu" />
        </div>
        <div style={{ padding: '10px 10px 0' }}>
          <Menu width={230} align="left" trigger={
            <button className="btn btn-secondary btn-block" style={{ justifyContent: 'flex-start', height: 42 }}>
              <span className="app-icon" style={{ width: 24, height: 24, background: 'var(--brand)', fontSize: 12 }}>{me.workspace.name[0]?.toUpperCase()}</span>
              <span className="grow truncate" style={{ textAlign: 'left' }}>{me.workspace.name}</span><ChevronsUpDown size={14} />
            </button>}
            items={[
              { section: 'Workspaces' },
              ...me.workspaces.map((w) => ({ label: w.name, icon: w.id === me.workspace.id ? Check : Building2, hint: w.plan, onClick: () => w.id !== me.workspace.id && switchWorkspace(w.id) })),
              { divider: true },
              { label: 'Create workspace', icon: Plus, onClick: newWorkspace },
              { label: 'Workspace settings', icon: Settings, onClick: () => nav('/settings/workspace') },
            ]} />
        </div>
        <nav className="sidebar-nav" aria-label="Main">
          {NAV.map((g, i) => (
            <div key={i}>
              {g.section && <div className="nav-section">{g.section}</div>}
              {g.items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                  <it.icon />{it.label}{it.badge && badges[it.badge] > 0 && <span className="nav-count">{badges[it.badge]}</span>}
                </NavLink>
              ))}
            </div>
          ))}
          <div className="nav-section">Account</div>
          <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Settings />Settings</NavLink>
        </nav>
        <div className="sidebar-foot">
          <NavLink to="/settings/usage" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="row between small"><span className="muted">Tasks this month</span><span className="bold">{fmtNum(usage.tasks)}</span></div>
            <div className="row between tiny subtle mt-8"><span>Free · unlimited everything</span><span style={{ color: 'var(--success)', fontWeight: 600 }}>$0</span></div>
          </NavLink>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <Button className="mobile-menu-btn" variant="ghost" icon={MenuIcon} onClick={() => setMobileOpen(true)} aria-label="Open menu" />
          <button className="searchbar" onClick={() => setPalette(true)}><Search /><span className="grow searchbar-text" style={{ textAlign: 'left' }}>Search or jump to…</span><span className="kbd">⌘K</span></button>
          <div className="grow topbar-spacer" />
          <Menu width={220} trigger={<Button variant="primary" icon={Plus} aria-label="Create"><span className="btn-label">Create</span></Button>} items={[
            { label: 'Flow', icon: Zap, onClick: () => create('flow') },
            { label: 'Flow with Copilot', icon: Wand2, onClick: () => setCopilot(true) },
            { label: 'Flow from template', icon: Library, onClick: () => nav('/templates') },
            { divider: true },
            { label: 'Table', icon: Table2, onClick: () => create('table') },
            { label: 'Interface', icon: LayoutTemplate, onClick: () => create('interface') },
            { label: 'Chatbot', icon: Bot, onClick: () => create('chatbot') },
            { label: 'Canvas', icon: Network, onClick: () => create('canvas') },
          ]} />
          <Button variant="secondary" icon={Sparkles} onClick={() => setCopilot((c) => !c)} title="Copilot (⌘J)" aria-label="Copilot"><span className="btn-label">Copilot</span></Button>
          <Notifications />
          <Menu width={230} trigger={<button className="btn btn-ghost btn-icon" aria-label="Account menu"><Avatar name={me.user.name} color={me.user.avatar_color} /></button>} items={[
            { section: `${me.user.name} · ${me.role}` },
            { label: 'Profile', icon: User, onClick: () => nav('/settings/profile') },
            { label: 'Usage', icon: Gauge, onClick: () => nav('/settings/usage') },
            { label: theme === 'dark' ? 'Light mode' : 'Dark mode', icon: theme === 'dark' ? Sun : Moon, onClick: toggleTheme },
            { divider: true },
            { label: 'Log out', icon: LogOut, onClick: logout, danger: true },
          ]} />
        </header>
        <main className="content"><Outlet /></main>
      </div>
      {mobileOpen && <div className="overlay" style={{ zIndex: 85, background: 'rgba(0,0,0,.3)' }} onClick={() => setMobileOpen(false)} />}
      {palette && <CommandPalette onClose={() => setPalette(false)} onCreate={create} onCopilot={() => { setPalette(false); setCopilot(true); }} />}
      {copilot && <CopilotPanel onClose={() => setCopilot(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------- notifications popover
function Notifications() {
  const [open, setOpen] = useState(false);
  const { data, reload, setData } = useFetch('notifications');
  const nav = useNavigate();
  const ref = useRef(null);
  useEffect(() => { const t = setInterval(reload, 20000); return () => clearInterval(t); }, [reload]);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const readAll = async () => { await api.post('notifications/read-all'); setData((d) => ({ items: d.items.map((n) => ({ ...n, read: 1 })), unread: 0 })); };
  const clear = async () => { await api.del('notifications'); setData({ items: [], unread: 0 }); };
  const openItem = async (n) => {
    if (!n.read) { await api.post(`notifications/${n.id}/read`); reload(); }
    setOpen(false);
    if (n.link) nav(n.link);
  };
  const color = { error: 'dot-red', usage: 'dot-yellow', approval: 'dot-blue' };
  return (
    <div className="menu-anchor" ref={ref}>
      <button className="btn btn-ghost btn-icon" aria-label="Notifications" onClick={() => setOpen((o) => !o)} style={{ position: 'relative' }}>
        <Bell />{data?.unread > 0 && <span style={{ position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16, borderRadius: 99, background: 'var(--danger)', color: '#fff', fontSize: 10, fontWeight: 700, display: 'grid', placeItems: 'center', padding: '0 4px' }}>{data.unread > 9 ? '9+' : data.unread}</span>}
      </button>
      {open && (
        <div className="menu" style={{ right: 0, top: 'calc(100% + 6px)', width: 380, padding: 0 }}>
          <div className="row between" style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
            <h3>Notifications</h3>
            <div className="row gap-4"><Button size="xs" variant="ghost" icon={CheckCheck} onClick={readAll}>Mark all read</Button><Button size="xs" variant="ghost" icon={Trash2} onClick={clear} aria-label="Clear all" /></div>
          </div>
          <div style={{ maxHeight: 420, overflow: 'auto' }}>
            {!data ? <div className="center" style={{ padding: 30 }}><Spinner /></div> : !data.items.length ? <p className="muted center" style={{ padding: 30 }}>You're all caught up.</p> :
              data.items.map((n) => (
                <button key={n.id} className="menu-item" style={{ padding: '10px 14px', borderRadius: 0, alignItems: 'flex-start', background: n.read ? undefined : 'var(--brand-50)' }} onClick={() => openItem(n)}>
                  <span className={`dot ${color[n.type] || 'dot-gray'}`} style={{ marginTop: 6 }} />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <div className="bold small">{n.title}</div>
                    {n.body && <div className="tiny muted" style={{ whiteSpace: 'normal' }}>{n.body}</div>}
                    <div className="tiny subtle">{timeAgo(n.created_at)}</div>
                  </span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- command palette (⌘K)
function CommandPalette({ onClose, onCreate, onCopilot }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [idx, setIdx] = useState(0);
  const nav = useNavigate();
  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(async () => { try { setResults(await api.get(`search?q=${encodeURIComponent(q)}`)); setIdx(0); } catch { /* ignore */ } }, 150);
    return () => clearTimeout(t);
  }, [q]);
  const actions = [
    { title: 'Create a new flow', run: () => onCreate('flow'), icon: Zap },
    { title: 'Ask Copilot to build a flow', run: onCopilot, icon: Sparkles },
    { title: 'Go to History', run: () => nav('/history'), icon: History },
    { title: 'Go to Templates', run: () => nav('/templates'), icon: Library },
    { title: 'Go to Usage', run: () => nav('/settings/usage'), icon: Gauge },
    { title: 'Explore apps', run: () => nav('/apps'), icon: Blocks },
  ].filter((a) => !q || a.title.toLowerCase().includes(q.toLowerCase()));
  const items = [...results.map((r) => ({ title: r.title, sub: r.type, run: () => nav(r.url) })), ...actions];
  const go = (it) => { onClose(); it.run(); };
  return (
    <div className="overlay" style={{ alignItems: 'flex-start', paddingTop: '12vh' }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 600 }}>
        <div className="row" style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <Search size={18} className="subtle" />
          <input autoFocus className="grow" style={{ border: 0, outline: 0, font: 'inherit', fontSize: 15, background: 'transparent', color: 'var(--text)' }}
            placeholder="Search flows, tables, interfaces, apps…" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
              if (e.key === 'Enter' && items[idx]) go(items[idx]);
            }} />
          <span className="kbd">esc</span>
        </div>
        <div style={{ maxHeight: 400, overflow: 'auto', padding: 6 }}>
          {!items.length && <p className="muted center" style={{ padding: 24 }}>No results for “{q}”.</p>}
          {items.map((it, i) => (
            <button key={i} className="menu-item" style={{ background: i === idx ? 'var(--surface-3)' : undefined }} onMouseEnter={() => setIdx(i)} onClick={() => go(it)}>
              {it.icon ? <it.icon /> : <Search />}<span className="grow">{it.title}</span>{it.sub && <span className="badge">{it.sub}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
