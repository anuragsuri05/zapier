import { useState } from 'react';
import { KeyRound, Plus, Trash2, AlertTriangle, Info } from 'lucide-react';
import api from '../../lib/api.js';
import { useAuth, useToast, useDialog, useFetch } from '../../lib/context.jsx';
import { fmtDay, timeAgo } from '../../lib/util.js';
import { Button, Field, Input, Modal, CopyField, CopyButton, Callout, Loading, ErrorState, EmptyState, Tabs } from '../../components/ui.jsx';
import { SectionHead } from './shared.jsx';

export default function ApiKeys() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const { data, error, loading, reload } = useFetch('api-keys');
  const [creating, setCreating] = useState(false);

  const revoke = async (k) => {
    if (!await dialog.confirm({ title: `Revoke "${k.name}"?`, message: 'Any script or integration using this key will immediately get 401 errors. This cannot be undone.', danger: true, confirmText: 'Revoke key' })) return;
    try { await api.del(`api-keys/${k.id}`); toast.success('API key revoked'); reload(); } catch (err) { toast.error(err.message); }
  };

  return (
    <div className="settings-section">
      <SectionHead title="API keys" description="Use the OneTier REST API to list and run flows and read or write table records."
        actions={isAdmin && <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Create API key</Button>} />
      {!isAdmin && <Callout type="info" icon={Info}>Only workspace admins can create or revoke API keys.</Callout>}

      {loading && !data ? <Loading /> : error ? <ErrorState error={error} onRetry={reload} /> : data.length === 0 ? (
        <div className="card"><EmptyState icon={KeyRound} title="No API keys yet" action={isAdmin && <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Create API key</Button>}>
          API keys let scripts and other services call OneTier on behalf of this workspace.
        </EmptyState></div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Key</th><th>Created by</th><th>Created</th><th>Last used</th>{isAdmin && <th aria-label="Actions" />}</tr></thead>
            <tbody>
              {data.map((k) => (
                <tr key={k.id}>
                  <td className="bold" style={{ minWidth: 140 }}>{k.name}</td>
                  <td><code className="nowrap">{k.prefix}…</code></td>
                  <td className="nowrap">{k.created_by || '—'}</td>
                  <td className="nowrap muted">{fmtDay(k.created_at)}</td>
                  <td className="nowrap muted">{k.last_used_at ? timeAgo(k.last_used_at) : 'Never'}</td>
                  {isAdmin && <td className="right"><Button size="sm" variant="danger-ghost" icon={Trash2} onClick={() => revoke(k)}>Revoke</Button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <QuickStart />
      {creating && <CreateKeyModal onClose={() => setCreating(false)} onCreated={reload} />}
    </div>
  );
}

function CreateKeyModal({ onClose, onCreated }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(null);
  const submit = async (e) => {
    e?.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try { const r = await api.post('api-keys', { name: name.trim() }); setKey(r.key); onCreated(); }
    catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  if (key) {
    return (
      <Modal title="Your new API key" size="sm" onClose={onClose} closeOnOverlay={false} footer={<Button variant="primary" onClick={onClose}>I've saved it</Button>}>
        <Callout type="warning" icon={AlertTriangle}>Copy this key now — for security it will <b>never be shown again</b>. Store it somewhere safe, like a secrets manager.</Callout>
        <div className="mt-16"><CopyField value={key} /></div>
        <p className="small muted mt-8">Send it as <code>Authorization: Bearer {key.slice(0, 10)}…</code></p>
      </Modal>
    );
  }
  return (
    <Modal title="Create API key" size="sm" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={submit}>Create key</Button></>}>
      <form onSubmit={submit}>
        <Field label="Name" required help="Something to recognise it by, e.g. “Production server” or “Zapier migration script”.">
          <Input autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Production server" />
        </Field>
      </form>
    </Modal>
  );
}

function QuickStart() {
  const [tab, setTab] = useState('flows');
  const origin = window.location.origin;
  const snippets = {
    flows: { title: 'List flows', body: `curl ${origin}/api/v1/flows \\\n  -H "Authorization: Bearer $ONETIER_API_KEY"` },
    run: {
      title: 'Run a flow',
      body: `curl -X POST ${origin}/api/v1/flows/<flow_id>/run \\\n  -H "Authorization: Bearer $ONETIER_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"data": {"email": "ada@example.com", "plan": "pro"}}'\n\n# Returns {"run_id", "status", "return", "error"}. Add ?wait=false to run in the background (202).`,
    },
    records: {
      title: 'Create a table record',
      body: `curl -X POST ${origin}/api/v1/tables/<table_id>/records \\\n  -H "Authorization: Bearer $ONETIER_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"data": {"Name": "Ada Lovelace", "Status": "New"}}'`,
    },
  };
  const s = snippets[tab];
  return (
    <div className="card">
      <div className="card-header"><h3>Quick start</h3><span className="small muted">Base URL: <code>{origin}/api/v1</code></span></div>
      <div className="card-body">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'flows', label: 'GET /flows' }, { value: 'run', label: 'POST /flows/:id/run' }, { value: 'records', label: 'POST /tables/:id/records' }]} />
        <div className="row between mb-8"><h4>{s.title}</h4><CopyButton text={s.body} size="xs" /></div>
        <pre className="code-block">{s.body}</pre>
        <p className="small muted mt-16">Also available: <code>GET /me</code>, <code>GET /runs/:id</code>, <code>GET /tables</code>, <code>GET /tables/:id/records</code>, <code>PATCH</code>/<code>DELETE /tables/:id/records/:rid</code>, <code>GET /apps</code> and <code>POST /actions/:app/:action</code>. You can also send the key in an <code>X-API-Key</code> header.</p>
      </div>
    </div>
  );
}
