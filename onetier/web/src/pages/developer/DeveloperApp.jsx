import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Save, Trash2, Pencil, Play, Undo2, Boxes, Copy, MoreHorizontal, FlaskConical } from 'lucide-react';
import api from '../../lib/api.js';
import { useApps, useDialog, useToast } from '../../lib/context.jsx';
import { Button, Field, Input, Textarea, Select, Tabs, Badge, Loading, ErrorState, EmptyState, JsonView, Callout, AppIcon, Menu, Checkbox, Segmented } from '../../components/ui.jsx';
import { timeAgo } from '../../lib/util.js';
import OperationModal from './OperationModal.jsx';
import { ColorPicker } from './DeveloperList.jsx';
import './developer.css';

const AUTH_TYPES = [
  { value: 'none', label: 'No authentication' },
  { value: 'api_key', label: 'API key' },
  { value: 'bearer', label: 'Bearer token' },
  { value: 'basic', label: 'Basic auth (username & password)' },
];
const CRED_FIELDS = {
  none: [],
  api_key: [{ key: 'api_key', label: 'API key', secret: true }],
  bearer: [{ key: 'token', label: 'Access token', secret: true }],
  basic: [{ key: 'username', label: 'Username' }, { key: 'password', label: 'Password', secret: true }],
};
const pick = (a) => ({ name: a.name, description: a.description || '', color: a.color || '#5B3DF5', base_url: a.base_url || '', status: a.status || 'private', auth: { type: 'none', ...(a.auth || {}) }, operations: a.operations || [] });

export default function DeveloperApp() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const { refresh } = useApps();
  const [app, setApp] = useState(null);
  const [draft, setDraft] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState('overview');
  const [saving, setSaving] = useState(false);
  const [bump, setBump] = useState(false);
  const [opModal, setOpModal] = useState(null); // {index?}

  const load = useCallback(async () => {
    setErr(null);
    try { const a = await api.get(`developer/apps/${id}`); setApp(a); setDraft(pick(a)); } catch (e) { setErr(e); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const dirty = app && draft && JSON.stringify(pick(app)) !== JSON.stringify(draft);
  useEffect(() => {
    const h = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  if (err) return <div className="page"><Link to="/developer" className="row small mb-16" style={{ gap: 4 }}><ArrowLeft size={15} />Developer Platform</Link><ErrorState error={err} onRetry={err.status === 404 ? undefined : load} /></div>;
  if (!draft) return <div className="page"><Loading /></div>;

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setAuth = (patch) => setDraft((d) => ({ ...d, auth: { ...d.auth, ...patch } }));

  const save = async (bumpVersion = bump) => {
    if (!draft.name.trim()) { setTab('overview'); return toast.error('App name is required'); }
    if (draft.base_url && !/^https?:\/\/\S+$/.test(draft.base_url.trim())) { setTab('overview'); return toast.error('Base URL must start with http:// or https://'); }
    setSaving(true);
    try {
      const auth = { type: draft.auth.type };
      if (draft.auth.type === 'api_key') { auth.placement = draft.auth.placement || 'header'; auth.paramName = draft.auth.paramName?.trim() || (auth.placement === 'query' ? 'api_key' : 'X-API-Key'); }
      if (draft.auth.type !== 'none' && draft.auth.testUrl?.trim()) auth.testUrl = draft.auth.testUrl.trim();
      const out = await api.put(`developer/apps/${id}`, { ...draft, name: draft.name.trim(), base_url: draft.base_url.trim(), auth, bumpVersion });
      setApp(out); setDraft(pick(out)); setBump(false);
      toast.success(bumpVersion ? `Saved as v${out.version}` : 'App saved');
      refresh();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  const remove = async () => {
    if (!(await dialog.confirm({ title: 'Delete custom app?', message: `“${app.name}” will be removed from the catalog. Flows and MCP tools that use ${app.app_key} will stop working.`, danger: true, confirmText: 'Delete app' }))) return;
    try { await api.del(`developer/apps/${id}`); refresh(); toast.success('App deleted'); nav('/developer'); } catch (e) { toast.error(e.message); }
  };
  const saveOp = (op) => {
    const ops = opModal.index != null ? draft.operations.map((o, i) => (i === opModal.index ? op : o)) : [...draft.operations, op];
    set({ operations: ops }); setOpModal(null);
  };
  const removeOp = async (i) => {
    const op = draft.operations[i];
    if (!(await dialog.confirm({ title: 'Delete operation?', message: `“${op.name}” will be removed when you save. Flows using it will stop working.`, danger: true, confirmText: 'Delete' }))) return;
    set({ operations: draft.operations.filter((_, k) => k !== i) });
  };
  const duplicateOp = (i) => {
    const op = draft.operations[i];
    let key = `${op.key}_copy`; let n = 2;
    while (draft.operations.some((o) => o.key === key)) key = `${op.key}_copy${n++}`;
    set({ operations: [...draft.operations, { ...structuredClone(op), key, name: `${op.name} (copy)` }] });
  };

  const iconApp = { name: draft.name || '?', color: draft.color, letter: (draft.name[0] || '?').toUpperCase() };
  return (
    <div className="page">
      <Link to="/developer" className="row small mb-16" style={{ gap: 4 }}><ArrowLeft size={15} />Developer Platform</Link>
      <div className="page-header">
        <div className="row gap-12" style={{ minWidth: 0 }}>
          <AppIcon app={iconApp} size={48} />
          <div style={{ minWidth: 0 }}>
            <div className="row wrap"><h1 className="truncate">{draft.name || 'Untitled app'}</h1><Badge className="mono">v{app.version}</Badge>
              <Badge color={draft.status === 'published' ? 'green' : undefined} dot>{draft.status === 'published' ? 'Published' : 'Private'}</Badge>
              {dirty && <Badge color="yellow">Unsaved changes</Badge>}</div>
            <div className="small subtle mt-8"><code>{app.app_key}</code> · updated {timeAgo(app.updated_at)}</div>
          </div>
        </div>
        <div className="row wrap">
          <Button icon={Boxes} onClick={() => nav(`/apps/${app.app_key}`)}>View in directory</Button>
          <Menu trigger={<Button icon={MoreHorizontal} aria-label="More actions" />} items={[{ label: 'Delete app', icon: Trash2, danger: true, onClick: remove }]} />
          <Button variant="primary" icon={Save} loading={saving} disabled={!dirty && !bump} onClick={() => save()}>{bump ? 'Save & bump version' : 'Save'}</Button>
        </div>
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'overview', label: 'Overview' },
        { value: 'auth', label: 'Authentication' },
        { value: 'ops', label: 'Operations', count: draft.operations.length },
        { value: 'test', label: 'Test' },
        { value: 'definition', label: 'Definition' },
      ]} />

      {tab === 'overview' && (
        <div className="card card-pad" style={{ maxWidth: 760 }}>
          <Field label="App name" required><Input value={draft.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Description" help="Shown in the app directory and to AI clients via MCP."><Textarea rows={3} value={draft.description} onChange={(e) => set({ description: e.target.value })} /></Field>
          <Field label="Colour"><ColorPicker value={draft.color} onChange={(c) => set({ color: c })} /></Field>
          <Field label="Base URL" help="Relative operation URLs are appended to this."><Input className="mono" value={draft.base_url} onChange={(e) => set({ base_url: e.target.value })} placeholder="https://api.example.com/v1" /></Field>
          <div className="grid-2" style={{ gap: 12 }}>
            <Field label="Version" help="Use “Save & bump version” to increment the patch version."><Input className="mono" value={`v${app.version}`} readOnly /></Field>
            <Field label="Status" help="Published apps are marked as ready for your team.">
              <Select value={draft.status} onChange={(e) => set({ status: e.target.value })} options={[{ value: 'private', label: 'Private (in development)' }, { value: 'published', label: 'Published' }]} />
            </Field>
          </div>
          <Field label="Catalog key" help="Apps are always private to this workspace."><Input className="mono" value={app.app_key} readOnly /></Field>
        </div>
      )}

      {tab === 'auth' && (
        <div className="card card-pad" style={{ maxWidth: 760 }}>
          <Field label="Authentication type"><Select value={draft.auth.type} onChange={(e) => setAuth({ type: e.target.value })} options={AUTH_TYPES} /></Field>
          {draft.auth.type === 'api_key' && (
            <div className="grid-2" style={{ gap: 12 }}>
              <Field label="Send the key in"><Segmented value={draft.auth.placement || 'header'} onChange={(v) => setAuth({ placement: v })} options={[{ value: 'header', label: 'Header' }, { value: 'query', label: 'Query string' }]} /></Field>
              <Field label={draft.auth.placement === 'query' ? 'Query parameter name' : 'Header name'}>
                <Input className="mono" value={draft.auth.paramName || ''} onChange={(e) => setAuth({ paramName: e.target.value })} placeholder={draft.auth.placement === 'query' ? 'api_key' : 'X-API-Key'} />
              </Field>
            </div>
          )}
          {draft.auth.type !== 'none' && (
            <>
              <Field label="Test URL" help="Optional. A GET request made when someone connects an account — a 2xx response means the credentials work. Relative to the base URL or absolute.">
                <Input className="mono" value={draft.auth.testUrl || ''} onChange={(e) => setAuth({ testUrl: e.target.value })} placeholder="/me" />
              </Field>
              <div className="panel small">
                <div className="bold mb-8">How users connect</div>
                <p className="muted">When someone connects {draft.name || 'this app'} they'll be asked for: {CRED_FIELDS[draft.auth.type].map((f) => <b key={f.key}>{f.label} </b>)}.
                  {draft.auth.type === 'api_key' && <> The key is sent as {draft.auth.placement === 'query' ? <>the <code>{draft.auth.paramName || 'api_key'}</code> query parameter</> : <>the <code>{draft.auth.paramName || 'X-API-Key'}</code> header</>}.</>}
                  {draft.auth.type === 'bearer' && <> It's sent as <code>Authorization: Bearer …</code>.</>}
                  {draft.auth.type === 'basic' && <> They're sent as an <code>Authorization: Basic …</code> header.</>}
                  {' '}You can also reference credentials in templates with {CRED_FIELDS[draft.auth.type].map((f) => <code key={f.key}>{`{{auth.${f.key}}}`} </code>)}.</p>
              </div>
            </>
          )}
          {draft.auth.type === 'none' && <Callout type="info">The API is public or authenticated another way (e.g. a token baked into the URL). No connection is needed to use this app.</Callout>}
        </div>
      )}

      {tab === 'ops' && (
        <div className="card">
          <div className="card-header"><div><h3>Operations</h3><div className="tiny subtle">Triggers start flows; actions and searches run as steps.</div></div>
            <Button size="sm" variant="primary" icon={Plus} onClick={() => setOpModal({})}>Add operation</Button></div>
          {!draft.operations.length ? (
            <EmptyState title="No operations yet" action={<Button variant="primary" icon={Plus} onClick={() => setOpModal({})}>Add operation</Button>}>
              Each operation is one HTTP request — e.g. “Create contact” (POST /contacts) or “New order” (GET /orders, polled for new items).
            </EmptyState>
          ) : draft.operations.map((op, i) => (
            <div key={op.key + i} className="dv-op" onClick={() => setOpModal({ index: i })} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpModal({ index: i })}>
              <span className={`dv-method ${op.request?.method || 'GET'}`}>{op.request?.method || 'GET'}</span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row wrap"><span className="bold">{op.name}</span><Badge color={op.type === 'trigger' ? 'green' : op.type === 'search' ? 'blue' : 'brand'}>{op.type}</Badge></div>
                <div className="tiny subtle truncate"><code>{op.key}</code> · <span className="mono">{op.request?.url}</span> · {op.fields?.length || 0} field{op.fields?.length === 1 ? '' : 's'}</div>
              </div>
              <span onClick={(e) => e.stopPropagation()}>
                <Menu trigger={<Button size="sm" variant="ghost" icon={MoreHorizontal} aria-label="Operation actions" />} items={[
                  { label: 'Edit', icon: Pencil, onClick: () => setOpModal({ index: i }) },
                  { label: 'Duplicate', icon: Copy, onClick: () => duplicateOp(i) },
                  { label: 'Test', icon: FlaskConical, onClick: () => setTab('test') },
                  { divider: true },
                  { label: 'Delete', icon: Trash2, danger: true, onClick: () => removeOp(i) },
                ]} />
              </span>
            </div>
          ))}
        </div>
      )}

      {tab === 'test' && <TestTab appId={id} draft={draft} saved={app} dirty={dirty} onSave={() => save(false)} saving={saving} />}
      {tab === 'definition' && <DefinitionTab appId={id} version={app.version + app.updated_at} dirty={dirty} />}

      {(dirty || bump) && (
        <div className="dv-savebar card card-pad row wrap" style={{ padding: '10px 16px', boxShadow: 'var(--shadow-lg)' }}>
          <span className="grow small">{dirty ? <b>You have unsaved changes.</b> : 'Ready to save a new version.'}</span>
          <Checkbox checked={bump} onChange={setBump} label={<span className="small">Bump version (v{app.version} → v{app.version.split('.').map((n, k) => (k === 2 ? Number(n) + 1 : n)).join('.')})</span>} />
          {dirty && <Button size="sm" variant="ghost" icon={Undo2} onClick={() => setDraft(pick(app))}>Discard</Button>}
          <Button size="sm" variant="primary" icon={Save} loading={saving} onClick={() => save()}>{bump ? 'Save & bump version' : 'Save'}</Button>
        </div>
      )}

      {opModal && (
        <OperationModal initial={opModal.index != null ? draft.operations[opModal.index] : null} baseUrl={draft.base_url}
          existingKeys={draft.operations.filter((_, i) => i !== opModal.index).map((o) => o.key)} onClose={() => setOpModal(null)} onSave={saveOp} />
      )}
    </div>
  );
}

function TestTab({ appId, draft, saved, dirty, onSave, saving }) {
  const ops = saved.operations;
  const [opKey, setOpKey] = useState(ops[0]?.key || '');
  const [params, setParams] = useState({});
  const [creds, setCreds] = useState({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  useEffect(() => { if (!ops.some((o) => o.key === opKey)) setOpKey(ops[0]?.key || ''); }, [ops, opKey]);
  const op = ops.find((o) => o.key === opKey);
  const authType = saved.auth?.type || 'none';

  const run = async () => {
    setBusy(true); setResult(null);
    try {
      const p = {};
      for (const f of op.fields || []) {
        const v = params[f.key];
        if (v === undefined || v === '') continue;
        p[f.key] = f.type === 'number' ? Number(v) : f.type === 'boolean' ? v === true || v === 'true' : v;
      }
      setResult(await api.post(`developer/apps/${appId}/test`, { operation: opKey, params: p, credentials: creds }));
    } catch (e) { setResult({ ok: false, error: e.message }); } finally { setBusy(false); }
  };

  if (!ops.length) return <div className="card"><EmptyState icon={FlaskConical} title="Nothing to test yet">{dirty ? 'Save your new operations first, then test them here.' : 'Add an operation on the Operations tab, save, then test it here.'}</EmptyState></div>;
  const missing = (op?.fields || []).filter((f) => f.required && f.type !== 'boolean' && !String(params[f.key] ?? '').trim());
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <div className="card card-pad">
        {dirty && <div className="mb-16"><Callout type="warning"><div className="row wrap"><span className="grow">Tests use the last saved version. Save to test your changes.</span><Button size="xs" loading={saving} onClick={onSave}>Save now</Button></div></Callout></div>}
        <Field label="Operation"><Select value={opKey} onChange={(e) => { setOpKey(e.target.value); setParams({}); setResult(null); }} options={ops.map((o) => ({ value: o.key, label: `${o.name} (${o.type})` }))} /></Field>
        {op && <div className="panel small mb-16 row" style={{ gap: 8 }}><span className={`dv-method ${op.request?.method}`}>{op.request?.method}</span><span className="mono truncate grow">{op.request?.url}</span></div>}
        {authType !== 'none' && (
          <>
            <div className="dv-section" style={{ marginTop: 0 }}>Credentials</div>
            {CRED_FIELDS[authType].map((f) => (
              <Field key={f.key} label={f.label}><Input type={f.secret ? 'password' : 'text'} autoComplete="off" value={creds[f.key] || ''} onChange={(e) => setCreds((c) => ({ ...c, [f.key]: e.target.value }))} /></Field>
            ))}
            <p className="tiny subtle mb-16">Used only for this test request — not stored.</p>
          </>
        )}
        {op?.fields?.length > 0 && <div className="dv-section" style={{ marginTop: 0 }}>Input</div>}
        {op?.fields?.map((f) => (
          <Field key={f.key} label={f.label || f.key} required={f.required} help={f.help}>
            {f.type === 'boolean' ? <Checkbox checked={params[f.key] === true} onChange={(v) => setParams((p) => ({ ...p, [f.key]: v }))} label={<span className="small">True</span>} />
              : f.type === 'textarea' ? <Textarea rows={3} value={params[f.key] || ''} onChange={(e) => setParams((p) => ({ ...p, [f.key]: e.target.value }))} />
                : <Input type={f.type === 'number' ? 'number' : 'text'} value={params[f.key] || ''} onChange={(e) => setParams((p) => ({ ...p, [f.key]: e.target.value }))} />}
          </Field>
        ))}
        <Button variant="primary" icon={Play} loading={busy} disabled={!op || missing.length > 0} onClick={run}>Send test request</Button>
        {missing.length > 0 && <p className="tiny subtle mt-8">Fill in the required fields: {missing.map((f) => f.label || f.key).join(', ')}.</p>}
      </div>
      <div className="card card-pad">
        <div className="row between mb-16"><h3>Result</h3>{result && <span className="row">{result.ok ? <Badge color="green" dot>Success</Badge> : <Badge color="red" dot>Failed</Badge>}{result.ms != null && <span className="tiny subtle">{result.ms}ms</span>}</span>}</div>
        {!result ? <p className="muted small">Send a request to see the response. Trigger operations return the parsed list of items.</p>
          : result.ok ? <JsonView data={result.output} maxHeight={520} /> : <Callout type="danger">{result.error}</Callout>}
        {result?.ok && op?.type === 'trigger' && Array.isArray(result.output) && <p className="tiny subtle mt-8">{result.output.length} item(s) found. New IDs start the flow.</p>}
      </div>
    </div>
  );
}

function DefinitionTab({ appId, version, dirty }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let live = true;
    setState({ loading: true });
    api.get(`developer/apps/${appId}/definition`).then((d) => live && setState({ data: d })).catch((e) => live && setState({ error: e }));
    return () => { live = false; };
  }, [appId, version]);
  if (state.loading) return <Loading />;
  if (state.error) return <ErrorState error={state.error} />;
  return (
    <div className="card card-pad">
      <div className="row between wrap mb-16">
        <div><h3>Catalog definition</h3><p className="small muted">This is how the app appears in the catalog as <code>{state.data.key}</code> — in the flow editor, MCP tool picker and app directory.</p></div>
        {dirty && <Badge color="yellow">Shows the last saved version</Badge>}
      </div>
      <JsonView data={state.data} maxHeight={600} />
    </div>
  );
}
