import { useState } from 'react';
import { Database, Plus, Pencil, Trash2, Info } from 'lucide-react';
import api from '../../lib/api.js';
import { useToast, useDialog, useFetch } from '../../lib/context.jsx';
import { timeAgo } from '../../lib/util.js';
import { Button, Field, Input, Textarea, Modal, Badge, SearchInput, Loading, ErrorState, EmptyState, Callout } from '../../components/ui.jsx';
import { SectionHead } from './shared.jsx';

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'list' : typeof v === 'object' ? 'object' : typeof v);
const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
const toText = (v) => (v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v, null, 2));
/** Numbers, booleans, null, objects and lists are stored as JSON; anything else as text. */
const parse = (text) => { const t = text.trim(); if (!t) return ''; try { return JSON.parse(t); } catch { return text; } };

export default function Storage() {
  const toast = useToast();
  const dialog = useDialog();
  const { data, error, loading, reload } = useFetch('storage');
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState('');

  const remove = async (row) => {
    if (!await dialog.confirm({ title: `Delete "${row.key}"?`, message: 'Flows that read this key will get an empty value.', danger: true, confirmText: 'Delete' })) return;
    try { await api.del(`storage/${encodeURIComponent(row.key)}`); toast.success('Entry deleted'); reload(); } catch (err) { toast.error(err.message); }
  };
  const rows = (data || []).filter((r) => !q || r.key.toLowerCase().includes(q.toLowerCase()) || show(r.value).toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="settings-section">
      <SectionHead title="Storage" description="Key/value data saved by “Storage by OneTier” steps. Use it for counters, cursors and small bits of state between runs."
        actions={<Button variant="primary" icon={Plus} onClick={() => setEditing({ isNew: true, key: '', value: '' })}>Add entry</Button>} />
      <Callout type="info" icon={Info}>Flows read and write these values with the <b>Storage by OneTier</b> app (set, get, increment, push onto list, remove). Values are shared across every flow in this workspace.</Callout>
      {data?.length > 0 && <SearchInput value={q} onChange={setQ} placeholder="Search keys and values…" style={{ maxWidth: 360 }} />}
      {loading && !data ? <Loading /> : error ? <ErrorState error={error} onRetry={reload} /> : data.length === 0 ? (
        <div className="card"><EmptyState icon={Database} title="No stored values yet" action={<Button icon={Plus} onClick={() => setEditing({ isNew: true, key: '', value: '' })}>Add entry</Button>}>
          Add a “Storage by OneTier” step to a flow, or create an entry here.
        </EmptyState></div>
      ) : rows.length === 0 ? <div className="card"><EmptyState icon={Database} title="No matches" /></div> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Key</th><th>Value</th><th>Type</th><th>Updated</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td><code className="bold" style={{ wordBreak: 'break-all' }}>{r.key}</code></td>
                  <td style={{ maxWidth: 380 }}><div className="mono small truncate" title={show(r.value)}>{show(r.value) || <span className="subtle">(empty)</span>}</div></td>
                  <td><Badge>{typeOf(r.value)}</Badge></td>
                  <td className="nowrap muted">{timeAgo(r.updated_at)}</td>
                  <td className="right nowrap">
                    <Button size="sm" variant="ghost" icon={Pencil} aria-label={`Edit ${r.key}`} title="Edit" onClick={() => setEditing({ key: r.key, value: toText(r.value) })} />
                    <Button size="sm" variant="danger-ghost" icon={Trash2} aria-label={`Delete ${r.key}`} title="Delete" onClick={() => remove(r)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <EntryModal entry={editing} existing={(data || []).map((r) => r.key)} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function EntryModal({ entry, existing, onClose, onSaved }) {
  const toast = useToast();
  const [key, setKey] = useState(entry.key);
  const [value, setValue] = useState(typeof entry.value === 'string' ? entry.value : toText(entry.value));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const parsed = parse(value);
  const submit = async (e) => {
    e?.preventDefault();
    const k = key.trim();
    if (!k) return setErr('Key is required');
    if (k.length > 200) return setErr('Keys can be up to 200 characters');
    if (entry.isNew && existing.includes(k)) return setErr('A value with this key already exists — edit it instead');
    setBusy(true);
    try { await api.put(`storage/${encodeURIComponent(k)}`, { value: parsed }); toast.success(entry.isNew ? 'Entry added' : 'Entry saved'); onSaved(); }
    catch (error) { toast.error(error.message); setBusy(false); }
  };
  return (
    <Modal title={entry.isNew ? 'Add storage entry' : `Edit ${entry.key}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Save</Button></>}>
      <form onSubmit={submit}>
        <Field label="Key" required error={err}>
          <Input value={key} autoFocus={entry.isNew} disabled={!entry.isNew} invalid={err} className="mono" placeholder="e.g. last_processed_id" onChange={(e) => { setKey(e.target.value); setErr(''); }} />
        </Field>
        <Field label="Value" help={<>Detected type: <b>{typeOf(parsed)}</b>. Numbers, true/false, null, JSON objects and lists are stored as JSON; anything else is stored as text.</>}>
          <Textarea className="code-input" style={{ minHeight: 140, whiteSpace: 'pre-wrap' }} value={value} onChange={(e) => setValue(e.target.value)} autoFocus={!entry.isNew} />
        </Field>
      </form>
    </Modal>
  );
}
