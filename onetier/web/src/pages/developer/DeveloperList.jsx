import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Code2, Trash2, MoreHorizontal, ExternalLink, Globe, KeyRound, ListChecks, FlaskConical, Boxes } from 'lucide-react';
import api from '../../lib/api.js';
import { useApps, useDialog, useFetch, useToast } from '../../lib/context.jsx';
import { Button, PageHeader, EmptyState, Loading, ErrorState, Modal, Field, Input, Textarea, Badge, Menu, AppIcon, Callout } from '../../components/ui.jsx';
import { timeAgo } from '../../lib/util.js';
import './developer.css';

export const COLORS = ['#5B3DF5', '#0EA5E9', '#12A150', '#F59E0B', '#E03131', '#DB2777', '#7C3AED', '#0F766E', '#334155'];

export default function DeveloperList() {
  const nav = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const { refresh } = useApps();
  const { data, error, loading, reload, setData } = useFetch('developer/apps');
  const [createOpen, setCreateOpen] = useState(false);

  const remove = async (a) => {
    if (!(await dialog.confirm({ title: 'Delete custom app?', message: `“${a.name}” will be removed from the app catalog. Flows, connections and MCP tools that use ${a.app_key} will stop working.`, danger: true, confirmText: 'Delete app' }))) return;
    try { await api.del(`developer/apps/${a.id}`); setData((d) => d.filter((x) => x.id !== a.id)); refresh(); toast.success('App deleted'); }
    catch (e) { toast.error(e.message); }
  };

  return (
    <div className="page">
      <PageHeader title="Developer Platform" description="Build a private integration for any REST API without code. Custom apps appear in the flow editor, MCP servers and the app directory."
        actions={<Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>Create app</Button>} />
      <div className="grid-4 mb-16 dv-intro">
        {[
          [Globe, 'Point at an API', 'Set a base URL — any REST/JSON API works.'],
          [KeyRound, 'Add authentication', 'API key, bearer token or basic auth. Stored encrypted.'],
          [ListChecks, 'Define operations', 'Triggers that poll for new items, actions and searches.'],
          [FlaskConical, 'Test & use', 'Test live requests, then use the app in any flow.'],
        ].map(([I, t, d]) => (
          <div key={t} className="card card-pad row gap-12" style={{ alignItems: 'flex-start', padding: 16 }}>
            <span className="empty-icon" style={{ width: 34, height: 34, margin: 0, borderRadius: 9 }}><I size={17} /></span>
            <div><div className="bold small">{t}</div><div className="tiny muted">{d}</div></div>
          </div>
        ))}
      </div>
      {loading && !data ? <Loading /> : error ? <ErrorState error={error} onRetry={reload} /> : !data.length ? (
        <div className="card"><EmptyState icon={Code2} title="No custom apps yet" action={<Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>Create your first app</Button>}>
          Connect an internal tool or any API that isn't in the catalog. Define its operations once and your whole team can use it in flows.
        </EmptyState></div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>App</th><th>Key</th><th>Version</th><th>Status</th><th>Operations</th><th>Updated</th><th /></tr></thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id} className="clickable" onClick={() => nav(`/developer/${a.id}`)}>
                  <td><div className="row" style={{ minWidth: 200 }}><AppIcon app={{ name: a.name, color: a.color, letter: a.name[0]?.toUpperCase() }} size={30} />
                    <div style={{ minWidth: 0 }}><div className="bold truncate">{a.name}</div><div className="tiny subtle truncate" style={{ maxWidth: 280 }}>{a.description || a.base_url || '—'}</div></div></div></td>
                  <td><code className="small">{a.app_key}</code></td>
                  <td className="mono small">v{a.version}</td>
                  <td><Badge color={a.status === 'published' ? 'green' : undefined} dot>{a.status === 'published' ? 'Published' : 'Private'}</Badge></td>
                  <td>{a.operations.length ? <span className="row gap-4 wrap">{['trigger', 'action', 'search'].map((t) => { const n = a.operations.filter((o) => o.type === t).length; return n ? <Badge key={t}>{n} {t}{n === 1 ? '' : 's'}</Badge> : null; })}</span> : <span className="subtle small">None yet</span>}</td>
                  <td className="small muted nowrap">{timeAgo(a.updated_at)}</td>
                  <td className="right" onClick={(e) => e.stopPropagation()}>
                    <Menu trigger={<Button size="sm" variant="ghost" icon={MoreHorizontal} aria-label="App actions" />} items={[
                      { label: 'Edit', icon: ExternalLink, onClick: () => nav(`/developer/${a.id}`) },
                      { label: 'View in directory', icon: Boxes, onClick: () => nav(`/apps/${a.app_key}`) },
                      { divider: true },
                      { label: 'Delete', icon: Trash2, danger: true, onClick: () => remove(a) },
                    ]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {createOpen && <CreateModal onClose={() => setCreateOpen(false)} onCreated={(id) => { refresh(); nav(`/developer/${id}`); }} />}
    </div>
  );
}

function CreateModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', description: '', color: COLORS[0], base_url: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e?.preventDefault();
    if (!form.name.trim()) return setErr('App name is required.');
    if (form.base_url && !/^https?:\/\/\S+$/.test(form.base_url.trim())) return setErr('Base URL must start with http:// or https://');
    setBusy(true); setErr('');
    try { const { id } = await api.post('developer/apps', { ...form, name: form.name.trim(), base_url: form.base_url.trim() }); onCreated(id); }
    catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  const key = form.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
  return (
    <Modal title="Create a custom app" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Create app</Button></>}>
      <form onSubmit={submit}>
        <div className="row gap-12" style={{ alignItems: 'flex-start' }}>
          <AppIcon app={{ name: form.name || '?', color: form.color, letter: (form.name[0] || '?').toUpperCase() }} size={44} />
          <Field label="App name" required className="grow" help={key ? <>Catalog key: <code>custom_{key}</code></> : 'E.g. “Acme CRM”'}>
            <Input autoFocus value={form.name} onChange={set('name')} placeholder="Acme CRM" />
          </Field>
        </div>
        <Field label="Description"><Textarea rows={2} value={form.description} onChange={set('description')} placeholder="What this integration does" /></Field>
        <Field label="Colour"><ColorPicker value={form.color} onChange={(c) => setForm((f) => ({ ...f, color: c }))} /></Field>
        <Field label="Base URL" help="Operation URLs are relative to this. You can change it later."><Input value={form.base_url} onChange={set('base_url')} placeholder="https://api.acme.com/v1" /></Field>
        {err && <Callout type="danger">{err}</Callout>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function ColorPicker({ value, onChange }) {
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      {COLORS.map((c) => <button key={c} type="button" className={`dv-swatch ${value?.toLowerCase() === c.toLowerCase() ? 'active' : ''}`} style={{ background: c }} aria-label={`Colour ${c}`} onClick={() => onChange(c)} />)}
      <input type="color" className="dv-colorinput" value={value || '#5B3DF5'} onChange={(e) => onChange(e.target.value)} aria-label="Custom colour" />
    </div>
  );
}
