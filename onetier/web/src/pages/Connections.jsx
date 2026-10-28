import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Plug, MoreHorizontal, RefreshCw, Pencil, Trash2, FlaskConical, ArrowUpDown, ShieldCheck } from 'lucide-react';
import api from '../lib/api.js';
import { useApps, useDialog, useFetch, useToast } from '../lib/context.jsx';
import ConnectModal from '../components/ConnectModal.jsx';
import { Button, PageHeader, AppIcon, Badge, EmptyState, Loading, ErrorState, Menu, Modal, SearchInput, Select, Toggle } from '../components/ui.jsx';
import { timeAgo, fmtDay } from '../lib/util.js';

const SORTS = [
  { value: 'app', label: 'Sort: App' },
  { value: 'name', label: 'Sort: Name' },
  { value: 'created', label: 'Sort: Newest' },
  { value: 'tested', label: 'Sort: Last tested' },
  { value: 'status', label: 'Sort: Errors first' },
];

export default function Connections() {
  const { getApp } = useApps();
  const toast = useToast();
  const dialog = useDialog();
  const { data, error, loading, reload, setData } = useFetch('connections');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('app');
  const [grouped, setGrouped] = useState(true);
  const [picker, setPicker] = useState(false);
  const [connect, setConnect] = useState(null); // {appKey, connection?}
  const [testing, setTesting] = useState(null);

  const rows = useMemo(() => {
    const list = (data || []).filter((c) => `${c.name} ${getApp(c.app)?.name || c.app}`.toLowerCase().includes(q.toLowerCase()));
    const appName = (c) => (getApp(c.app)?.name || c.app).toLowerCase();
    const cmp = {
      app: (a, b) => appName(a).localeCompare(appName(b)) || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
      created: (a, b) => (b.created_at || '').localeCompare(a.created_at || ''),
      tested: (a, b) => (b.last_tested_at || '').localeCompare(a.last_tested_at || ''),
      status: (a, b) => (a.status === 'ok') - (b.status === 'ok') || appName(a).localeCompare(appName(b)),
    }[sort];
    const sorted = [...list].sort(cmp);
    if (!grouped) return [{ key: null, items: sorted }];
    const groups = new Map();
    for (const c of sorted) { if (!groups.has(c.app)) groups.set(c.app, []); groups.get(c.app).push(c); }
    return [...groups.entries()].sort((a, b) => (getApp(a[0])?.name || a[0]).localeCompare(getApp(b[0])?.name || b[0])).map(([key, items]) => ({ key, items }));
  }, [data, q, sort, grouped, getApp]);

  const test = async (c) => {
    setTesting(c.id);
    try { const r = await api.post(`connections/${c.id}/test`); toast.success(`${c.name}: connection works${r.label ? ` (${r.label})` : ''}`); }
    catch (e) { toast.error(`${c.name}: ${e.message}`); }
    finally { setTesting(null); reload(); }
  };
  const rename = async (c) => {
    const name = await dialog.prompt({ title: 'Rename connection', label: 'Name', defaultValue: c.name });
    if (!name?.trim()) return;
    try { const out = await api.patch(`connections/${c.id}`, { name: name.trim() }); setData((d) => d.map((x) => (x.id === c.id ? out : x))); toast.success('Connection renamed'); }
    catch (e) { toast.error(e.message); }
  };
  const remove = async (c) => {
    const ok = await dialog.confirm({
      title: 'Delete connection?', danger: true, confirmText: 'Delete connection',
      message: c.used_by > 0
        ? `Warning: “${c.name}” is used by ${c.used_by} flow${c.used_by === 1 ? '' : 's'}. Those steps will fail until a new account is connected.`
        : `“${c.name}” will be permanently removed. Stored credentials are deleted.`,
    });
    if (!ok) return;
    try { await api.del(`connections/${c.id}`); setData((d) => d.filter((x) => x.id !== c.id)); toast.success('Connection deleted'); }
    catch (e) { toast.error(e.message); }
  };

  const errors = (data || []).filter((c) => c.status !== 'ok').length;

  return (
    <div className="page">
      <PageHeader title="Connections" description="Accounts your flows, chatbots and MCP servers use to act in other apps. Credentials are encrypted at rest."
        actions={<Button variant="primary" icon={Plus} onClick={() => setPicker(true)}>Add connection</Button>} />
      {loading && !data ? <Loading /> : error ? <ErrorState error={error} onRetry={reload} /> : !data.length ? (
        <div className="card"><EmptyState icon={Plug} title="No connections yet" action={<Button variant="primary" icon={Plus} onClick={() => setPicker(true)}>Add connection</Button>}>
          Connect accounts like Slack, GitHub or Stripe once and reuse them across every flow.
        </EmptyState></div>
      ) : (
        <>
          {errors > 0 && <div className="callout callout-danger mb-16"><span className="grow">{errors} connection{errors === 1 ? ' has' : 's have'} an error. Reconnect to keep flows running.</span></div>}
          <div className="toolbar">
            <SearchInput value={q} onChange={setQ} placeholder="Search connections…" style={{ width: 280, maxWidth: '100%' }} />
            <Select value={sort} onChange={(e) => setSort(e.target.value)} options={SORTS} style={{ width: 180 }} aria-label="Sort" />
            <Toggle checked={grouped} onChange={setGrouped} label={<span className="small">Group by app</span>} />
            <div className="grow" />
            <span className="small subtle row gap-4"><ArrowUpDown size={14} />{data.length} total</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>App</th><th>Connection</th><th>Status</th><th>Credentials</th><th>Used by</th><th>Created</th><th>Last tested</th><th /></tr></thead>
              <tbody>
                {rows.map((g) => (
                  <Fragment key={g.key || 'all'}>
                    {g.key && grouped && (
                      <tr><td colSpan={8} style={{ background: 'var(--surface-2)', padding: '8px 14px' }}>
                        <Link to={`/apps/${g.key}`} className="row bold small" style={{ color: 'var(--text)' }}><AppIcon app={getApp(g.key)} size={20} />{getApp(g.key)?.name || g.key}<span className="subtle" style={{ fontWeight: 400 }}>· {g.items.length}</span></Link>
                      </td></tr>
                    )}
                    {g.items.map((c) => {
                      const app = getApp(c.app);
                      return (
                        <tr key={c.id}>
                          <td><div className="row nowrap"><AppIcon app={app} size={26} /><Link to={`/apps/${c.app}`}>{app?.name || c.app}</Link></div></td>
                          <td className="bold" style={{ maxWidth: 240 }}><div className="truncate">{c.name}</div></td>
                          <td><Badge color={c.status === 'ok' ? 'green' : 'red'} dot>{c.status === 'ok' ? 'Connected' : 'Error'}</Badge></td>
                          <td><div className="col" style={{ gap: 2 }}>{Object.entries(c.fields || {}).slice(0, 2).map(([k, v]) => <span key={k} className="tiny mono subtle nowrap">{k}: {v || '—'}</span>)}</div></td>
                          <td className="nowrap">{c.used_by ? <span className="bold">{c.used_by} flow{c.used_by === 1 ? '' : 's'}</span> : <span className="subtle">—</span>}</td>
                          <td className="nowrap small muted">{fmtDay(c.created_at)}</td>
                          <td className="nowrap small muted">{timeAgo(c.last_tested_at)}</td>
                          <td className="right nowrap">
                            <Button size="xs" icon={FlaskConical} loading={testing === c.id} onClick={() => test(c)}>Test</Button>{' '}
                            <Menu trigger={<Button size="xs" variant="ghost" icon={MoreHorizontal} aria-label="Connection actions" />} items={[
                              { label: 'Reconnect', icon: RefreshCw, onClick: () => setConnect({ appKey: c.app, connection: c }) },
                              { label: 'Rename', icon: Pencil, onClick: () => rename(c) },
                              { divider: true },
                              { label: 'Delete', icon: Trash2, danger: true, onClick: () => remove(c) },
                            ]} />
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
                {!rows.some((g) => g.items.length) && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 30 }}>No connections match “{q}”.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="tiny subtle mt-16 row gap-4"><ShieldCheck size={14} />Secrets are masked and never shown again after you save them.</p>
        </>
      )}
      {picker && <AppPicker onClose={() => setPicker(false)} onPick={(k) => { setPicker(false); setConnect({ appKey: k }); }} />}
      {connect && getApp(connect.appKey)?.auth && (
        <ConnectModal appKey={connect.appKey} connection={connect.connection} onClose={() => setConnect(null)} onConnected={() => reload()} />
      )}
    </div>
  );
}

export function AppPicker({ onClose, onPick, title = 'Add a connection' }) {
  const { apps } = useApps();
  const [q, setQ] = useState('');
  const list = apps.filter((a) => a.auth && `${a.name} ${a.category}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Modal title={title} subtitle="Choose the app you want to connect an account for." onClose={onClose} size="lg">
      <SearchInput value={q} onChange={setQ} placeholder="Search apps…" />
      <div className="grid-auto mt-16" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
        {list.map((a) => (
          <button key={a.key} type="button" className="card card-hover row gap-12" style={{ padding: 12, font: 'inherit', textAlign: 'left', color: 'var(--text)' }} onClick={() => onPick(a.key)}>
            <AppIcon app={a} size={32} /><div className="grow"><div className="bold truncate">{a.name}</div><div className="tiny subtle truncate">{a.category}</div></div>
          </button>
        ))}
      </div>
      {!list.length && <p className="muted small mt-16">No apps that need a connection match “{q}”.</p>}
    </Modal>
  );
}
