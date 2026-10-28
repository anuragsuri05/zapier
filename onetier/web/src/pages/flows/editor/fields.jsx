// Field renderer for trigger/action configuration — supports every field type the server catalog uses.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Trash2, X } from 'lucide-react';
import api from '../../../lib/api.js';
import { useApps } from '../../../lib/context.jsx';
import { Button, Field, Input, Select, Toggle, KeyValueEditor, AppIcon, Spinner } from '../../../components/ui.jsx';
import { MappableInput } from './variables.jsx';
import { useEditor } from './context.js';
import { OPERATORS, isUnary } from './defUtils.js';

const optList = (opts) => (opts || []).map((o) => (typeof o === 'string' ? { value: o, label: o } : { value: String(o.value), label: o.label ?? String(o.value) }));
const hasToken = (v) => typeof v === 'string' && v.includes('{{');

// ---------------------------------------------------------------- dynamic options
export function useDynamicOptions(kind, query) {
  const qs = new URLSearchParams(Object.entries(query || {}).filter(([, v]) => v)).toString();
  const [state, setState] = useState({ options: [], loading: Boolean(kind), error: null });
  const load = useCallback(async () => {
    if (!kind) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try { setState({ options: await api.get(`dynamic/${kind}${qs ? `?${qs}` : ''}`), loading: false, error: null }); }
    catch (e) { setState({ options: [], loading: false, error: e }); }
  }, [kind, qs]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

const dynQuery = (kind, params) => {
  if (kind === 'tableFields') return { tableId: params?.tableId };
  if (kind === 'forms') return { interfaceId: params?.interfaceId };
  return {};
};
const DYN_EMPTY = {
  tables: 'No tables yet — create one in Tables.', interfaces: 'No interfaces yet — create one in Interfaces.', chatbots: 'No chatbots yet.',
  subflows: 'No sub-flows yet — create a flow that starts with “Start a Sub-Flow”.', forms: 'This interface has no form blocks.', tableFields: 'This table has no fields.',
};

function DynamicSelect({ field, value, onChange, params }) {
  const query = dynQuery(field.dynamic, params);
  const waiting = (field.dynamic === 'tableFields' && !query.tableId) || (field.dynamic === 'forms' && !query.interfaceId);
  const { options, loading, error, reload } = useDynamicOptions(waiting ? null : field.dynamic, query);
  const opts = optList(options);
  if (value && !opts.some((o) => o.value === String(value)) && !loading) opts.unshift({ value: String(value), label: hasToken(value) ? value : `${value} (not found)` });
  return (
    <div>
      <div className="row" style={{ gap: 6 }}>
        <Select className="grow" value={value ?? ''} onChange={(e) => onChange(e.target.value)} options={opts}
          placeholder={waiting ? (field.dynamic === 'forms' ? 'Choose an interface first' : 'Choose a table first') : loading ? 'Loading…' : field.required ? 'Choose…' : 'Any / none'} disabled={waiting} />
        <Button size="sm" variant="ghost" icon={RefreshCw} onClick={reload} disabled={waiting} aria-label="Refresh options" title="Refresh options" />
      </div>
      {error && <div className="error-text">{error.message}</div>}
      {!loading && !waiting && !error && !options.length && <div className="help">{DYN_EMPTY[field.dynamic] || 'No options available.'}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- list of strings
function ListEditor({ value, onChange, placeholder = 'Value' }) {
  const rows = Array.isArray(value) ? value : typeof value === 'string' && value ? value.split(',').map((x) => x.trim()) : [];
  const shown = rows.length ? rows : [''];
  return (
    <div className="col" style={{ gap: 6 }}>
      {shown.map((r, i) => (
        <div key={i} className="row" style={{ gap: 6 }}>
          <Input value={r} placeholder={placeholder} onChange={(e) => onChange(shown.map((x, k) => (k === i ? e.target.value : x)))} />
          <Button size="sm" variant="ghost" icon={X} aria-label="Remove" onClick={() => onChange(shown.filter((_, k) => k !== i))} />
        </div>
      ))}
      <div><Button size="xs" variant="ghost" icon={Plus} onClick={() => onChange([...shown, ''])}>Add item</Button></div>
    </div>
  );
}

// ---------------------------------------------------------------- conditions (OR of AND groups)
export function ConditionsEditor({ value, onChange }) {
  const groups = Array.isArray(value) && value.length ? value : [[{ left: '', op: 'equals', right: '' }]];
  const emit = (g) => onChange(g.filter((x) => x.length));
  const setRow = (gi, ri, patch) => emit(groups.map((g, i) => (i === gi ? g.map((r, k) => (k === ri ? { ...r, ...patch } : r)) : g)));
  return (
    <div className="col" style={{ gap: 0 }}>
      {groups.map((g, gi) => (
        <div key={gi}>
          {gi > 0 && <div className="fe-or">OR</div>}
          <div className="fe-cond-group">
            {g.map((r, ri) => (
              <div key={ri}>
                {ri > 0 && <div className="fe-and">AND</div>}
                <div className="fe-cond-row">
                  <MappableInput value={r.left} placeholder="Field (map a value)" onChange={(v) => setRow(gi, ri, { left: v })} />
                  <div className="row" style={{ gap: 6 }}>
                    <Select value={r.op || 'equals'} onChange={(e) => setRow(gi, ri, { op: e.target.value })} options={OPERATORS.map((o) => ({ value: o.value, label: o.label }))} style={{ flex: '0 0 46%' }} />
                    <div className="grow">{!isUnary(r.op) && <MappableInput value={r.right} placeholder="Value" onChange={(v) => setRow(gi, ri, { right: v })} />}</div>
                    <Button size="sm" variant="ghost" icon={Trash2} aria-label="Remove condition"
                      onClick={() => emit(groups.map((x, i) => (i === gi ? x.filter((_, k) => k !== ri) : x)))} />
                  </div>
                </div>
              </div>
            ))}
            <Button size="xs" variant="ghost" icon={Plus} onClick={() => emit(groups.map((x, i) => (i === gi ? [...x, { left: '', op: 'equals', right: '' }] : x)))}>AND condition</Button>
          </div>
        </div>
      ))}
      <div className="mt-8"><Button size="xs" variant="secondary" icon={Plus} onClick={() => emit([...groups, [{ left: '', op: 'equals', right: '' }]])}>OR group</Button></div>
    </div>
  );
}

// ---------------------------------------------------------------- table fields (one input per column)
function TableFieldsEditor({ value, onChange, params }) {
  const tableId = params?.tableId;
  const { options: cols, loading, error, reload } = useDynamicOptions(tableId && !hasToken(tableId) ? 'tableFields' : null, { tableId });
  const rows = Array.isArray(value) ? value : value && typeof value === 'object' ? Object.entries(value).map(([key, v]) => ({ key, value: v })) : [];
  const get = (k) => rows.find((r) => r.key === k)?.value ?? '';
  const set = (k, v) => {
    const next = rows.some((r) => r.key === k) ? rows.map((r) => (r.key === k ? { ...r, value: v } : r)) : [...rows, { key: k, value: v }];
    onChange(next.filter((r) => r.value !== '' && r.value !== undefined));
  };
  if (!tableId) return <div className="help">Choose a table first — its fields will appear here.</div>;
  if (loading) return <div className="row small muted"><Spinner size={14} /> Loading table fields…</div>;
  if (error) return <div className="error-text">{error.message} <Button size="xs" variant="ghost" onClick={reload}>Retry</Button></div>;
  const known = new Set(cols.map((c) => c.value));
  const extra = rows.filter((r) => !known.has(r.key));
  return (
    <div className="fe-tablefields">
      {!cols.length && <div className="help">This table has no fields yet.</div>}
      {cols.map((c) => (
        <div key={c.value} className="fe-tf-row">
          <div className="fe-tf-label"><span className="truncate">{c.label}</span>{c.type && <span className="badge">{c.type}</span>}</div>
          <MappableInput value={get(c.value)} onChange={(v) => set(c.value, v)}
            placeholder={Array.isArray(c.options) && c.options.length ? `One of: ${optList(c.options).map((o) => o.label).join(', ')}` : `Value for ${c.label}`} />
        </div>
      ))}
      {extra.length > 0 && (
        <div className="mt-8">
          <div className="help mb-8">These values are for fields no longer in the table:</div>
          {extra.map((r) => (
            <div key={r.key} className="row small" style={{ gap: 6 }}>
              <span className="badge badge-yellow">{r.key}</span><span className="truncate grow mono">{String(r.value)}</span>
              <Button size="xs" variant="ghost" icon={X} aria-label="Remove" onClick={() => onChange(rows.filter((x) => x.key !== r.key))} />
            </div>
          ))}
        </div>
      )}
      <div className="mt-8"><Button size="xs" variant="ghost" icon={RefreshCw} onClick={reload}>Refresh fields</Button></div>
    </div>
  );
}

// ---------------------------------------------------------------- AI agent tools
function ToolsEditor({ value, onChange }) {
  const { apps, getApp } = useApps();
  const { connections, openConnect } = useEditor();
  const rows = Array.isArray(value) ? value : [];
  const toolApps = useMemo(() => apps.filter((a) => !a.control && Object.keys(a.actions || {}).length).sort((a, b) => a.name.localeCompare(b.name)), [apps]);
  const set = (i, patch) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <div className="col" style={{ gap: 10 }}>
      {!rows.length && <div className="help">No tools yet. The agent will only reason over the context you give it.</div>}
      {rows.map((r, i) => {
        const app = getApp(r.app);
        const act = app?.actions?.[r.action];
        const conns = connections.filter((c) => c.app === r.app);
        return (
          <div key={i} className="fe-tool">
            <div className="row" style={{ gap: 8 }}>
              <AppIcon app={app} size={24} />
              <Select className="grow" value={r.app || ''} placeholder="Choose an app…" options={toolApps.map((a) => ({ value: a.key, label: a.name }))}
                onChange={(e) => set(i, { app: e.target.value, action: '', connectionId: undefined, params: {} })} />
              <Button size="sm" variant="ghost" icon={Trash2} aria-label="Remove tool" onClick={() => onChange(rows.filter((_, k) => k !== i))} />
            </div>
            {app && (
              <Select value={r.action || ''} placeholder="Choose an action…" options={Object.values(app.actions).map((a) => ({ value: a.key, label: a.name }))}
                onChange={(e) => set(i, { action: e.target.value, params: {} })} />
            )}
            {app?.auth && (
              <div className="row" style={{ gap: 6 }}>
                <Select className="grow" value={r.connectionId || ''} placeholder={conns.length ? 'Choose an account…' : 'No accounts connected'}
                  options={conns.map((c) => ({ value: c.id, label: c.name }))} onChange={(e) => set(i, { connectionId: e.target.value || undefined })} />
                <Button size="sm" onClick={() => openConnect(app.key, (c) => set(i, { connectionId: c.id }))}>Connect</Button>
              </div>
            )}
            {act && act.fields?.length > 0 && (
              <details className="fe-tool-fixed">
                <summary className="small muted">Fixed values (optional) — leave blank to let the agent decide</summary>
                {act.fields.filter((f) => !['tools', 'tablefields', 'conditions', 'keyvalue'].includes(f.type)).map((f) => (
                  <Field key={f.key} label={f.label}>
                    {f.type === 'select' && f.options
                      ? <Select value={r.params?.[f.key] ?? ''} placeholder="Agent decides" options={optList(f.options)} onChange={(e) => set(i, { params: { ...r.params, [f.key]: e.target.value || undefined } })} />
                      : <MappableInput value={r.params?.[f.key] ?? ''} placeholder="Agent decides" onChange={(v) => set(i, { params: { ...r.params, [f.key]: v === '' ? undefined : v } })} />}
                  </Field>
                ))}
              </details>
            )}
          </div>
        );
      })}
      <div><Button size="sm" icon={Plus} onClick={() => onChange([...rows, { app: '', action: '', params: {} }])}>Add tool</Button></div>
    </div>
  );
}

// ---------------------------------------------------------------- JSON
function JsonInput({ value, onChange }) {
  const str = typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value, null, 2);
  let err = null;
  if (str.trim() && !hasToken(str)) { try { JSON.parse(str); } catch (e) { err = e.message; } }
  return (
    <div>
      <MappableInput multiline rows={6} mono value={str} onChange={onChange} placeholder='{"key": "value"}' invalid={Boolean(err)} />
      {err && <div className="error-text">Invalid JSON: {err}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- dispatcher
export function FieldInput({ field, value, onChange, params }) {
  const f = field;
  switch (f.type) {
    case 'textarea': return <MappableInput multiline rows={4} value={value} onChange={onChange} placeholder={f.placeholder} />;
    case 'code': return <MappableInput multiline rows={10} mono value={value} onChange={onChange} placeholder={f.placeholder} />;
    case 'number': return (
      <MappableInput value={value} inputMode="decimal" placeholder={f.placeholder ?? (f.default !== undefined ? String(f.default) : '')}
        onChange={(v) => onChange(v === '' ? '' : !hasToken(v) && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : v)} />
    );
    case 'boolean': return (
      <div className="row"><Toggle checked={value === undefined ? Boolean(f.default) : value === true || value === 'true'} onChange={onChange} />
        <span className="small muted">{(value === undefined ? f.default : value === true || value === 'true') ? 'Yes' : 'No'}</span></div>
    );
    case 'select':
      if (f.dynamic) return <DynamicSelect field={f} value={value} onChange={onChange} params={params} />;
      return <Select value={value ?? ''} onChange={(e) => onChange(e.target.value)} options={optList(f.options)} placeholder={f.required && value !== undefined && value !== '' ? undefined : 'Choose…'} />;
    case 'keyvalue': return (
      <KeyValueEditor value={Array.isArray(value) ? value : value && typeof value === 'object' ? Object.entries(value).map(([key, v]) => ({ key, value: v })) : []}
        onChange={onChange}
        renderValue={(v, set) => <MappableInput value={v} onChange={set} placeholder="Value" />} />
    );
    case 'list': return <ListEditor value={value} onChange={onChange} placeholder={f.placeholder || 'Name'} />;
    case 'conditions': return <ConditionsEditor value={value} onChange={onChange} />;
    case 'tools': return <ToolsEditor value={value} onChange={onChange} />;
    case 'tablefields': return <TableFieldsEditor value={value} onChange={onChange} params={params} />;
    case 'json': return <JsonInput value={value} onChange={onChange} />;
    case 'password': return <Input type="password" autoComplete="off" value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} />;
    default: return <MappableInput value={value} onChange={onChange} placeholder={f.placeholder} />;
  }
}

export function FieldRow({ field, value, onChange, params, invalid }) {
  return (
    <Field label={field.label} required={field.required} help={field.help} error={invalid ? `${field.label} is required.` : undefined}>
      <FieldInput field={field} value={value} onChange={onChange} params={params} />
    </Field>
  );
}
