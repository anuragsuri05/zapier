import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Modal, Button, Field, Input, Textarea, Select, KeyValueEditor, Checkbox, Callout, Segmented } from '../../components/ui.jsx';

export const OP_TYPES = [
  { value: 'action', label: 'Action' },
  { value: 'search', label: 'Search' },
  { value: 'trigger', label: 'Trigger' },
];
const FIELD_TYPES = ['text', 'textarea', 'number', 'boolean'];
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export const blankOp = () => ({ key: '', name: '', type: 'action', description: '', fields: [], request: { method: 'GET', url: '', headers: {}, body: '' }, listPath: '', idField: 'id', sample: '' });

const toKey = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[^a-z]+/, '').slice(0, 40);

export default function OperationModal({ initial, existingKeys, baseUrl, onClose, onSave }) {
  const [op, setOp] = useState(() => ({ ...blankOp(), ...initial, request: { ...blankOp().request, ...(initial?.request || {}) }, sample: typeof initial?.sample === 'string' ? initial.sample : initial?.sample ? JSON.stringify(initial.sample, null, 2) : '' }));
  const [headers, setHeaders] = useState(Object.entries(initial?.request?.headers || {}).map(([key, value]) => ({ key, value })));
  const [keyTouched, setKeyTouched] = useState(Boolean(initial?.key));
  const [errors, setErrors] = useState({});
  const set = (patch) => setOp((o) => ({ ...o, ...patch }));
  const setReq = (patch) => setOp((o) => ({ ...o, request: { ...o.request, ...patch } }));
  const setField = (i, patch) => set({ fields: op.fields.map((f, k) => (k === i ? { ...f, ...patch } : f)) });

  const submit = () => {
    const e = {};
    if (!op.name.trim()) e.name = 'Name is required';
    if (!/^[a-z][a-z0-9_]*$/.test(op.key)) e.key = 'Use lowercase letters, numbers and underscores, starting with a letter';
    else if (existingKeys.includes(op.key)) e.key = 'Another operation already uses this key';
    if (!op.request.url.trim()) e.url = 'Request URL is required';
    else if (!/^https?:\/\//.test(op.request.url) && !baseUrl) e.url = 'Relative URLs need a base URL (set it on the Overview tab) — or use an absolute URL';
    const fkeys = new Set();
    op.fields.forEach((f, i) => {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(f.key || '')) e[`f${i}`] = 'Field keys must be letters, numbers or underscores';
      else if (fkeys.has(f.key)) e[`f${i}`] = 'Duplicate field key';
      fkeys.add(f.key);
    });
    if (op.request.body?.trim() && !['GET', 'HEAD'].includes(op.request.method)) {
      try { JSON.parse(op.request.body.replace(/\{\{\s*[\w.]+\s*\}\}/g, '0')); } catch { /* bodies may be form text; only warn */ e.bodyWarn = true; }
    }
    if (op.sample?.trim()) { try { JSON.parse(op.sample); } catch { e.sample = 'Sample output must be valid JSON'; } }
    const blocking = Object.keys(e).filter((k) => k !== 'bodyWarn');
    setErrors(e);
    if (blocking.length) return;
    const out = {
      key: op.key, name: op.name.trim(), type: op.type, description: op.description.trim(),
      fields: op.fields.map((f) => ({ key: f.key, label: f.label?.trim() || f.key, type: f.type || 'text', required: Boolean(f.required), ...(f.help?.trim() ? { help: f.help.trim() } : {}) })),
      request: { method: op.request.method, url: op.request.url.trim(), headers: Object.fromEntries(headers.filter((h) => h.key?.trim()).map((h) => [h.key.trim(), h.value ?? ''])), ...(op.request.body?.trim() && op.request.method !== 'GET' ? { body: op.request.body } : {}) },
      ...(op.type === 'trigger' ? { listPath: op.listPath.trim(), idField: op.idField.trim() || 'id' } : {}),
      ...(op.sample?.trim() ? { sample: op.sample.trim() } : {}),
    };
    onSave(out);
  };

  const vars = op.fields.filter((f) => f.key).map((f) => `{{${f.key}}}`);
  return (
    <Modal title={initial?.key ? `Edit operation · ${initial.name}` : 'New operation'} size="lg" onClose={onClose} closeOnOverlay={false}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>{initial?.key ? 'Update operation' : 'Add operation'}</Button></>}>
      <Field label="Type">
        <Segmented value={op.type} onChange={(v) => set({ type: v })} options={OP_TYPES} />
      </Field>
      <p className="tiny subtle" style={{ marginTop: -8, marginBottom: 14 }}>
        {op.type === 'trigger' ? 'Triggers poll the endpoint and start a flow for each new item in the returned list.' : op.type === 'search' ? 'Searches look up existing records and return the result to later steps.' : 'Actions create or change something in the API.'}
      </p>
      <div className="grid-2" style={{ gap: 12 }}>
        <Field label="Name" required error={errors.name}>
          <Input autoFocus value={op.name} onChange={(e) => set({ name: e.target.value, ...(keyTouched ? {} : { key: toKey(e.target.value) }) })} placeholder="Create contact" />
        </Field>
        <Field label="Key" required error={errors.key} help="lowercase_snake, unique in this app">
          <Input className="mono" value={op.key} onChange={(e) => { setKeyTouched(true); set({ key: e.target.value }); }} placeholder="create_contact" />
        </Field>
      </div>
      <Field label="Description"><Input value={op.description} onChange={(e) => set({ description: e.target.value })} placeholder="Creates a new contact in Acme CRM." /></Field>

      <div className="dv-section">Input fields</div>
      {!op.fields.length && <p className="small muted mb-8">No input fields. Add fields the user (or AI) fills in — reference them in the request as <code>{'{{key}}'}</code>.</p>}
      {op.fields.map((f, i) => (
        <div key={i}>
          <div className="dv-fieldrow">
            <Input className="mono input-sm" value={f.key} placeholder="key" onChange={(e) => setField(i, { key: e.target.value })} invalid={Boolean(errors[`f${i}`])} />
            <Input className="input-sm" value={f.label} placeholder="Label" onChange={(e) => setField(i, { label: e.target.value })} />
            <Select className="input-sm" value={f.type || 'text'} onChange={(e) => setField(i, { type: e.target.value })} options={FIELD_TYPES} />
            <Checkbox checked={f.required} onChange={(v) => setField(i, { required: v })} label={<span className="small">Required</span>} />
            <Button size="sm" variant="ghost" icon={X} aria-label="Remove field" onClick={() => set({ fields: op.fields.filter((_, k) => k !== i) })} />
            <Input className="input-sm help-in" value={f.help || ''} placeholder="Help text (optional)" onChange={(e) => setField(i, { help: e.target.value })} />
          </div>
          {errors[`f${i}`] && <div className="error-text mb-8">{errors[`f${i}`]}</div>}
        </div>
      ))}
      <Button size="xs" variant="ghost" icon={Plus} onClick={() => set({ fields: [...op.fields, { key: '', label: '', type: 'text', required: false, help: '' }] })}>Add field</Button>

      <div className="dv-section">Request</div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Select value={op.request.method} onChange={(e) => setReq({ method: e.target.value })} options={METHODS} style={{ width: 110 }} aria-label="HTTP method" />
        <Field className="grow" error={errors.url} help={baseUrl ? <>Relative to <code>{baseUrl}</code>, or an absolute URL. Supports <code>{'{{field}}'}</code> and <code>{'{{auth.field}}'}</code>.</> : <>Absolute URL (no base URL set). Supports <code>{'{{field}}'}</code> and <code>{'{{auth.field}}'}</code>.</>}>
          <Input className="mono" value={op.request.url} onChange={(e) => setReq({ url: e.target.value })} placeholder={baseUrl ? '/contacts/{{contact_id}}' : 'https://api.example.com/contacts'} />
        </Field>
      </div>
      <Field label="Headers" help="Authentication headers are added automatically from the Authentication tab.">
        <KeyValueEditor value={headers} onChange={setHeaders} keyPlaceholder="Header" valuePlaceholder="Value, e.g. application/json" />
      </Field>
      {op.request.method !== 'GET' && (
        <Field label="Body template" help={<>JSON with placeholders, e.g. <code>{'{"email": "{{email}}"}'}</code>. Sent as JSON when it parses as JSON.</>}>
          <Textarea className="code-input" style={{ minHeight: 110 }} spellCheck={false} value={op.request.body || ''} onChange={(e) => setReq({ body: e.target.value })}
            placeholder={'{\n  "name": "{{name}}"\n}'} />
          {errors.bodyWarn && <div className="help" style={{ color: 'var(--warning)' }}>This body isn't valid JSON — it will be sent as plain text.</div>}
        </Field>
      )}
      {vars.length > 0 && <div className="row wrap tiny subtle mb-16" style={{ gap: 4 }}>Available: {vars.map((v) => <code key={v}>{v}</code>)}</div>}

      {op.type === 'trigger' && (
        <>
          <div className="dv-section">Trigger settings</div>
          <div className="grid-2" style={{ gap: 12 }}>
            <Field label="List path" help="Dot path to the array in the response, e.g. data.items. Leave empty if the response is the array."><Input className="mono" value={op.listPath} onChange={(e) => set({ listPath: e.target.value })} placeholder="data.items" /></Field>
            <Field label="ID field" help="Used to detect new items."><Input className="mono" value={op.idField} onChange={(e) => set({ idField: e.target.value })} placeholder="id" /></Field>
          </div>
        </>
      )}
      <Field label="Sample output (JSON)" error={errors.sample} help="Shown in the flow editor so later steps can map fields before a real test.">
        <Textarea className="code-input" style={{ minHeight: 90 }} spellCheck={false} value={op.sample} onChange={(e) => set({ sample: e.target.value })} placeholder={'{\n  "id": "123",\n  "email": "ada@example.com"\n}'} invalid={Boolean(errors.sample)} />
      </Field>
      {Object.keys(errors).filter((k) => k !== 'bodyWarn').length > 0 && <Callout type="danger">Fix the highlighted fields.</Callout>}
    </Modal>
  );
}
