import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Crown, Plus, RefreshCw, Trash2, ShieldCheck, Zap, Workflow, Plug, Clock, Radio, Timer, Play, Code2, MoreHorizontal } from 'lucide-react';
import api from '../../lib/api.js';
import { useFetch, useToast, useDialog } from '../../lib/context.jsx';
import ConnectModal from '../../components/ConnectModal.jsx';
import { Button, AppIcon, Badge, Tabs, Loading, ErrorState, EmptyState, FlowStatus, Menu } from '../../components/ui.jsx';
import { timeAgo, fmtDay } from '../../lib/util.js';
import './apps.css';

const TYPE = {
  instant: { label: 'Instant', color: 'green', icon: Zap },
  polling: { label: 'Polling', color: 'blue', icon: RefreshCw },
  schedule: { label: 'Schedule', color: 'yellow', icon: Clock },
  internal: { label: 'Instant', color: 'green', icon: Radio },
};

export default function AppDetail() {
  const { key } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data: app, error, loading, reload } = useFetch(`apps/${key}`);
  const conns = useFetch('connections');
  const [tab, setTab] = useState('ops');
  const [creating, setCreating] = useState(false);

  if (loading && !app) return <div className="page"><Loading /></div>;
  if (error) return <div className="page"><Link to="/apps" className="row small mb-16"><ArrowLeft size={15} />All apps</Link><ErrorState error={error} onRetry={error.status === 404 ? undefined : reload} /></div>;

  const triggers = Object.values(app.triggers || {});
  const actions = Object.values(app.actions || {});
  const myConns = (conns.data || []).filter((c) => c.app === app.key);

  const useInFlow = async () => {
    setCreating(true);
    try {
      const trigger = triggers.length ? { app: app.key, event: triggers[0].key, params: {} } : { app: 'manual', event: 'run', params: {} };
      const steps = actions.length ? [{ id: `s_${Math.random().toString(36).slice(2, 10)}`, app: app.key, action: actions[0].key, params: {} }] : [];
      const { id } = await api.post('flows', { name: `${app.name} flow`, definition: { trigger, steps } });
      nav(`/flows/${id}`);
    } catch (e) { toast.error(e.message); setCreating(false); }
  };

  return (
    <div className="page">
      <Link to="/apps" className="row small mb-16" style={{ gap: 4 }}><ArrowLeft size={15} />All apps</Link>
      <div className="card card-pad mb-16">
        <div className="ap-hero">
          <AppIcon app={app} size={64} />
          <div className="grow" style={{ minWidth: 220 }}>
            <div className="row wrap"><h1>{app.name}</h1>{app.builtin && <Badge color="brand">Built-in</Badge>}{app.custom && <Badge color="blue">Custom app</Badge>}</div>
            <div className="small subtle mt-8">{app.category}</div>
            <p className="muted mt-8" style={{ maxWidth: 720 }}>{app.description}</p>
            <div className="row wrap small muted mt-16" style={{ gap: 16 }}>
              <span>{triggers.length} triggers</span><span>{actions.length} actions</span>
              {app.auth ? <span className="row gap-4"><ShieldCheck size={15} />Requires a connected account</span> : <span>No account needed</span>}
            </div>
          </div>
          <div className="row wrap">
            {app.custom && app.key.startsWith('custom_') && <Button icon={Code2} onClick={() => api.get('developer/apps').then((l) => { const m = l.find((x) => x.app_key === app.key); if (m) nav(`/developer/${m.id}`); }).catch((e) => toast.error(e.message))}>Edit app</Button>}
            {app.auth && <ConnectButton app={app} onConnected={() => { conns.reload(); reload(); }} />}
            <Button variant="primary" icon={Workflow} loading={creating} onClick={useInFlow}>Use in a flow</Button>
          </div>
        </div>
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'ops', label: 'Triggers & actions', count: triggers.length + actions.length },
        ...(app.auth ? [{ value: 'conns', label: 'Connections', count: myConns.length }] : []),
        { value: 'flows', label: 'Used in flows', count: app.flows?.length || 0 },
      ]} />

      {tab === 'ops' && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <OpList title="Triggers" subtitle="Events that start a flow" items={triggers} trigger />
          <OpList title="Actions" subtitle="Things a flow can do" items={actions} />
        </div>
      )}
      {tab === 'conns' && <AppConnections app={app} conns={conns} myConns={myConns} />}
      {tab === 'flows' && (
        <div className="card">
          {!app.flows?.length ? <EmptyState icon={Workflow} title={`No flows use ${app.name} yet`} action={<Button variant="primary" icon={Plus} loading={creating} onClick={useInFlow}>Use in a flow</Button>} /> :
            app.flows.map((f) => (
              <Link key={f.id} to={`/flows/${f.id}`} className="list-item clickable" style={{ color: 'var(--text)', textDecoration: 'none' }}>
                <Workflow size={18} className="subtle" /><span className="grow truncate bold">{f.name}</span><FlowStatus status={f.status} />
              </Link>
            ))}
        </div>
      )}
    </div>
  );
}

function ConnectButton({ app, onConnected }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button icon={Plug} onClick={() => setOpen(true)}>Connect account</Button>
    {open && <ConnectModal appKey={app.key} onClose={() => setOpen(false)} onConnected={onConnected} />}
  </>;
}

function OpList({ title, subtitle, items, trigger }) {
  return (
    <div className="card">
      <div className="card-header"><div><h3>{title}</h3><div className="tiny subtle">{subtitle}</div></div><Badge>{items.length}</Badge></div>
      {!items.length ? <p className="muted small" style={{ padding: 20 }}>This app has no {title.toLowerCase()}.</p> : items.map((op) => {
        const T = trigger ? TYPE[op.type] || { label: op.type, color: '' } : null;
        return (
          <div key={op.key} className="ap-op">
            <div className="row wrap">
              {trigger ? <T.icon size={15} className="subtle" /> : op.kind === 'search' ? <Timer size={15} className="subtle" /> : <Play size={15} className="subtle" />}
              <span className="bold">{op.name}</span>
              {T && <Badge color={T.color}>{T.label}</Badge>}
              {!trigger && op.kind === 'search' && <Badge color="blue">Search</Badge>}
              {!trigger && op.billable === false && <Badge>Free</Badge>}
              {!trigger && op.aiTasks > 0 && <Badge color="brand">{op.aiTasks} tasks</Badge>}
              <code className="tiny subtle" style={{ marginLeft: 'auto' }}>{op.key}</code>
            </div>
            {op.description && <p className="small muted mt-8">{op.description}</p>}
            {op.fields?.length > 0 && (
              <div className="ap-fields">
                {op.fields.map((f) => <span key={f.key} className="ap-field" title={f.help || f.label}>{f.label}{f.required && <span className="req">*</span>}</span>)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AppConnections({ app, conns, myConns }) {
  const toast = useToast();
  const dialog = useDialog();
  const [modal, setModal] = useState(null); // {connection?}
  const [testing, setTesting] = useState(null);
  const test = async (c) => {
    setTesting(c.id);
    try { const r = await api.post(`connections/${c.id}/test`); toast.success(`Connection works${r.label ? ` · ${r.label}` : ''}`); }
    catch (e) { toast.error(`Test failed: ${e.message}`); } finally { setTesting(null); conns.reload(); }
  };
  const remove = async (c) => {
    if (!(await dialog.confirm({ title: 'Delete connection?', danger: true, confirmText: 'Delete',
      message: c.used_by > 0 ? `“${c.name}” is used by ${c.used_by} flow(s). Those flows will fail until they are reconnected.` : `“${c.name}” will be removed from this workspace.` }))) return;
    try { await api.del(`connections/${c.id}`); toast.success('Connection deleted'); conns.reload(); } catch (e) { toast.error(e.message); }
  };
  if (conns.loading && !conns.data) return <Loading />;
  if (conns.error) return <ErrorState error={conns.error} onRetry={conns.reload} />;
  return (
    <div className="card">
      <div className="card-header"><h3>{app.name} accounts</h3><Button size="sm" variant="primary" icon={Plus} onClick={() => setModal({})}>Connect account</Button></div>
      {!myConns.length ? <EmptyState icon={Plug} title={`No ${app.name} accounts connected`}>Connect an account to use {app.name} in flows and MCP tools.</EmptyState> : myConns.map((c) => (
        <div key={c.id} className="list-item">
          <AppIcon app={app} size={30} />
          <div className="grow">
            <div className="bold truncate">{c.name}</div>
            <div className="tiny subtle">Added {fmtDay(c.created_at)} · tested {timeAgo(c.last_tested_at)} · used by {c.used_by} flow{c.used_by === 1 ? '' : 's'}</div>
          </div>
          <Badge color={c.status === 'ok' ? 'green' : 'red'} dot>{c.status === 'ok' ? 'Connected' : 'Error'}</Badge>
          <Button size="sm" loading={testing === c.id} onClick={() => test(c)}>Test</Button>
          <Menu trigger={<Button size="sm" variant="ghost" icon={MoreHorizontal} aria-label="More" />} items={[
            { label: 'Reconnect', icon: RefreshCw, onClick: () => setModal({ connection: c }) },
            { label: 'Delete', icon: Trash2, danger: true, onClick: () => remove(c) },
          ]} />
        </div>
      ))}
      {modal && <ConnectModal appKey={app.key} connection={modal.connection} onClose={() => setModal(null)} onConnected={() => conns.reload()} />}
    </div>
  );
}
