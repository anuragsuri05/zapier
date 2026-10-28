import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Plus, Upload, Download, Columns3, Sparkles, Zap, Filter, ArrowUpDown, ArrowUp, ArrowDown, Trash2, Maximize2, X,
  ChevronUp, ChevronDown, Workflow, Table2, MoreHorizontal,
} from 'lucide-react';
import api from '../../lib/api.js';
import { useToast, useDialog } from '../../lib/context.jsx';
import { fmtDate, plural, clone } from '../../lib/util.js';
import {
  Button, Field, Input, Textarea, Select, Modal, Drawer, Menu, EmptyState, Loading, ErrorState, Callout, Badge, SearchInput, Pagination,
} from '../../components/ui.jsx';
import FieldInput, { StarRating, MultiSelectChips } from './FieldInput.jsx';
import { FIELD_TYPES, fieldTypeMeta, fmtCurrency, fmtDateValue, optionsOf, toDateInput, parseCSV, readFileText } from './fieldTypes.js';
import './tables.css';

const PAGE = 100;
const POPOVER_TYPES = ['long_text', 'json', 'multi_select'];
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const isLimitError = (e) => /limit/i.test(e?.message || '');

function toDraft(field, v) {
  if (field.type === 'json') return typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v, null, 2);
  if (field.type === 'multi_select') return Array.isArray(v) ? v : [];
  if (field.type === 'date') return toDateInput(v);
  return v == null ? '' : String(v);
}
function fromDraft(field, d) {
  if (['number', 'currency'].includes(field.type)) return d === '' || d == null ? null : Number(d);
  return d;
}

// ---------------------------------------------------------------- Cell
function Cell({ field, value, onSave, autoEdit, onAutoEdited }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraftState] = useState('');
  const draftRef = useRef('');
  const ref = useRef(null);
  const setDraft = (v) => { draftRef.current = v; setDraftState(v); };
  const begin = useCallback(() => { setDraft(toDraft(field, value)); setEditing(true); }, [field, value]);
  const commit = useCallback((v = draftRef.current) => {
    setEditing(false);
    const nv = fromDraft(field, v);
    if (field.type === 'number' || field.type === 'currency') { if (nv !== null && isNaN(nv)) return; }
    if (!same(nv, field.type === 'date' ? toDateInput(value) : value) && !(nv === '' && (value == null || value === ''))) onSave(nv);
  }, [field, value, onSave]);
  const cancel = () => setEditing(false);

  useEffect(() => { if (autoEdit) { begin(); onAutoEdited?.(); } }, [autoEdit]); // eslint-disable-line react-hooks/exhaustive-deps
  // close popovers on outside click (commits)
  useEffect(() => {
    if (!editing || !POPOVER_TYPES.includes(field.type)) return undefined;
    const h = (e) => { if (!ref.current?.contains(e.target)) commit(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [editing, field.type, commit]);

  const cls = `tv-cell ${['long_text', 'json', 'ai'].includes(field.type) ? 'wide' : ['checkbox', 'rating', 'number', 'currency'].includes(field.type) ? 'narrow' : ''} ${editing ? 'editing' : ''}`;
  const keyOpen = (e) => { if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); begin(); } };

  if (field.type === 'checkbox') {
    return <td className={cls}><div className="tv-check"><input type="checkbox" aria-label={field.name} checked={Boolean(value)} onChange={(e) => onSave(e.target.checked)} /></div></td>;
  }
  if (field.type === 'rating') {
    return <td className={cls}><div className="disp"><StarRating value={value} onChange={onSave} size={15} /></div></td>;
  }

  if (editing) {
    const inputKeys = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    };
    let editor;
    if (field.type === 'select') {
      editor = (
        <select autoFocus className="cell-input" value={draft} onChange={(e) => commit(e.target.value)} onBlur={cancel} onKeyDown={(e) => e.key === 'Escape' && cancel()}>
          <option value="">—</option>
          {optionsOf(field).map((o) => <option key={o} value={o}>{o}</option>)}
          {draft && !optionsOf(field).includes(draft) && <option value={draft}>{draft}</option>}
        </select>
      );
    } else if (field.type === 'long_text' || field.type === 'json') {
      editor = (
        <div className="tv-pop">
          <textarea autoFocus className={field.type === 'json' ? 'mono' : ''} value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); } if (e.key === 'Escape') { e.preventDefault(); cancel(); } }} />
          <div className="row between"><span className="tiny subtle">⌘/Ctrl + Enter to save</span><div className="row"><Button size="xs" variant="ghost" onClick={cancel}>Cancel</Button><Button size="xs" variant="primary" onClick={() => commit()}>Save</Button></div></div>
        </div>
      );
    } else if (field.type === 'multi_select') {
      editor = (
        <div className="tv-pop" onKeyDown={(e) => e.key === 'Escape' && cancel()}>
          <MultiSelectChips options={optionsOf(field)} value={draft} onChange={setDraft} />
          <div className="row" style={{ justifyContent: 'flex-end' }}><Button size="xs" variant="ghost" onClick={cancel}>Cancel</Button><Button size="xs" variant="primary" onClick={() => commit()}>Done</Button></div>
        </div>
      );
    } else {
      const type = { number: 'number', currency: 'number', date: 'date', email: 'email', url: 'url', phone: 'tel' }[field.type] || 'text';
      editor = <input autoFocus className="cell-input" type={type} step={field.type === 'currency' ? '0.01' : undefined} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => commit()} onKeyDown={inputKeys} />;
    }
    return <td className={cls} ref={ref}>{POPOVER_TYPES.includes(field.type) ? <><div className="disp" />{editor}</> : editor}</td>;
  }

  let content;
  const empty = value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length);
  if (empty) content = <span className="empty-hint" />;
  else if (field.type === 'url') content = <a className="txt" href={/^https?:\/\//i.test(value) ? value : `https://${value}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{value}</a>;
  else if (field.type === 'email') content = <a className="txt" href={`mailto:${value}`} onClick={(e) => e.stopPropagation()}>{value}</a>;
  else if (field.type === 'currency') content = <span className="txt">{fmtCurrency(value)}</span>;
  else if (field.type === 'date') content = <span className="txt">{fmtDateValue(value)}</span>;
  else if (field.type === 'select') content = <span className="tv-chip">{value}</span>;
  else if (field.type === 'multi_select') content = (Array.isArray(value) ? value : [value]).map((v) => <span key={v} className="tv-chip">{v}</span>);
  else if (field.type === 'json') content = <span className="txt mono">{typeof value === 'string' ? value : JSON.stringify(value)}</span>;
  else if (field.type === 'ai') content = <><Sparkles size={13} style={{ color: 'var(--brand)', flexShrink: 0 }} /><span className="txt">{String(value)}</span></>;
  else content = <span className="txt">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>;
  return (
    <td className={cls} ref={ref}>
      <div className={`disp ${['number', 'currency'].includes(field.type) ? 'num' : ''}`} tabIndex={0} role="gridcell" title={empty ? `Edit ${field.name}` : undefined} onClick={begin} onKeyDown={keyOpen}>{content}</div>
    </td>
  );
}

// ---------------------------------------------------------------- Record modal
function RecordModal({ table, record, onClose, onSaved, onDelete }) {
  const toast = useToast();
  const [draft, setDraft] = useState(() => clone(record.data) || {});
  const [busy, setBusy] = useState(false);
  const changed = table.fields.filter((f) => !same(draft[f.id], record.data[f.id]));
  const save = async () => {
    if (!changed.length) { onClose(); return; }
    setBusy(true);
    try {
      const data = Object.fromEntries(changed.map((f) => [f.id, draft[f.id]]));
      const r = await api.patch(`tables/${table.id}/records/${record.id}`, { data });
      onSaved({ ...record, data: r._fields, updated_at: r.updated_at });
      toast.success('Record saved');
      onClose();
    } catch (e) { toast.error(e.message); setBusy(false); }
  };
  return (
    <Modal title="Record" subtitle={`Created ${fmtDate(record.created_at)}${record.updated_at ? ` · Updated ${fmtDate(record.updated_at)}` : ''}`} size="lg" onClose={onClose}
      footer={<>
        <Button variant="danger-ghost" icon={Trash2} onClick={() => onDelete(record)} style={{ marginRight: 'auto' }}>Delete</Button>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={save}>{changed.length ? `Save ${plural(changed.length, 'change')}` : 'Done'}</Button>
      </>}>
      <div className="col gap-16">
        {table.fields.map((f) => {
          const I = fieldTypeMeta(f.type).icon;
          return (
            <Field key={f.id} label={<span className="row gap-4"><I size={13} />{f.name}</span>} help={f.type === 'ai' ? 'Filled by AI fill — you can also edit it manually.' : undefined}>
              <FieldInput field={f.type === 'ai' ? { ...f, type: 'long_text' } : f} value={draft[f.id]} onChange={(v) => setDraft((d) => ({ ...d, [f.id]: v }))} />
            </Field>
          );
        })}
        <div className="tiny subtle mono">ID {record.id}</div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Import modal
function ImportModal({ table, onClose, onDone }) {
  const toast = useToast();
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => (csv.trim() ? parseCSV(csv) : []), [csv]);
  const header = rows[0] || [];
  const newCols = header.filter((h) => h.trim() && !table.fields.some((f) => f.name.toLowerCase() === h.trim().toLowerCase()));
  const pick = async (file) => { if (!file) return; try { setCsv(await readFileText(file)); } catch (e) { toast.error(e.message); } };
  const submit = async () => {
    setBusy(true);
    try { const r = await api.post(`tables/${table.id}/import`, { csv }); toast.success(`Imported ${plural(r.imported, 'record')}`); onDone(); }
    catch (e) { toast.error(isLimitError(e) ? `${e.message} Some rows may have been imported before the limit was reached.` : e.message); setBusy(false); if (isLimitError(e)) onDone(); }
  };
  return (
    <Modal title="Import CSV" subtitle="The first row must be a header. Columns are matched to fields by name." size="lg" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={Upload} loading={busy} disabled={rows.length < 2} onClick={submit}>{rows.length > 1 ? `Import ${plural(rows.length - 1, 'row')}` : 'Import'}</Button></>}>
      <div className="col gap-12">
        <div className="row"><label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}><Upload />Choose file<input type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e) => pick(e.target.files?.[0])} /></label><span className="small muted">or paste CSV below</span></div>
        <Textarea rows={9} className="mono" value={csv} placeholder={'Name,Email\nAda Lovelace,ada@example.com'} onChange={(e) => setCsv(e.target.value)} />
        {rows.length > 0 && rows.length < 2 && <Callout type="warning">Add at least one data row under the header.</Callout>}
        {rows.length > 1 && (
          <Callout type="info">
            {plural(rows.length - 1, 'row')} detected with columns <b>{header.join(', ')}</b>.
            {newCols.length > 0 && <> New text fields will be created for: <b>{newCols.join(', ')}</b>.</>}
          </Callout>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Fields drawer
function FieldsDrawer({ table, onClose, onSaved }) {
  const toast = useToast();
  const dialog = useDialog();
  const [fields, setFields] = useState(() => clone(table.fields).map((f) => ({ ...f, options: optionsOf(f) })));
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const promptRefs = useRef({});
  const set = (i, patch) => setFields((fs) => fs.map((f, k) => (k === i ? { ...f, ...patch } : f)));
  const move = (i, d) => setFields((fs) => { const n = [...fs]; const j = i + d; if (j < 0 || j >= n.length) return fs; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const add = () => {
    let n = fields.length + 1; while (fields.some((f) => f.name.toLowerCase() === `field ${n}`)) n++;
    const key = `new_${Date.now()}`;
    setFields((fs) => [...fs, { _key: key, name: `Field ${n}`, type: 'text', options: [] }]);
    setOpen(key);
  };
  const remove = async (i) => {
    const f = fields[i];
    if (f.id) {
      const ok = await dialog.confirm({ title: `Delete field “${f.name}”?`, message: 'Values stored in this field will no longer be shown or exported. Flows that map this field may break.', danger: true, confirmText: 'Delete field' });
      if (!ok) return;
    }
    setFields((fs) => fs.filter((_, k) => k !== i));
  };
  const insertToken = (i, name) => {
    const el = promptRefs.current[i];
    const cur = fields[i].prompt || '';
    const token = `{{${name}}}`;
    const pos = el?.selectionStart ?? cur.length;
    set(i, { prompt: cur.slice(0, pos) + token + cur.slice(el?.selectionEnd ?? pos) });
    setTimeout(() => { el?.focus(); el?.setSelectionRange(pos + token.length, pos + token.length); }, 0);
  };
  const save = async () => {
    const names = fields.map((f) => f.name.trim().toLowerCase());
    if (names.some((n) => !n)) { toast.error('Every field needs a name.'); return; }
    if (new Set(names).size !== names.length) { toast.error('Field names must be unique.'); return; }
    setBusy(true);
    try {
      const payload = fields.map(({ _key, ...f }) => ({
        ...f, name: f.name.trim(),
        options: ['select', 'multi_select'].includes(f.type) ? (f.options || []).map((o) => o.trim()).filter(Boolean) : undefined,
        prompt: f.type === 'ai' ? f.prompt || '' : undefined,
      }));
      const r = await api.patch(`tables/${table.id}`, { fields: payload });
      toast.success('Fields saved');
      onSaved(r.fields);
      onClose();
    } catch (e) { toast.error(e.message); setBusy(false); }
  };
  return (
    <Drawer title="Fields" onClose={onClose}
      footer={<><Button icon={Plus} variant="ghost" onClick={add} style={{ marginRight: 'auto' }}>Add field</Button><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save fields</Button></>}>
      {!fields.length && <EmptyState icon={Columns3} title="No fields">Add a field to start storing data.</EmptyState>}
      {fields.map((f, i) => {
        const key = f.id || f._key;
        const I = fieldTypeMeta(f.type).icon;
        const expanded = open === key;
        const hasExtra = ['select', 'multi_select', 'ai'].includes(f.type);
        return (
          <div key={key} className="fd-field">
            <div className="fd-field-head">
              <span className="type-ico"><I /></span>
              <Input className="grow" value={f.name} aria-label="Field name" onChange={(e) => set(i, { name: e.target.value })} style={{ minWidth: 0, flex: 1 }} />
              <Select value={f.type} options={FIELD_TYPES.map((t) => ({ value: t.value, label: t.label }))} aria-label="Field type"
                onChange={(e) => { set(i, { type: e.target.value }); if (['select', 'multi_select', 'ai'].includes(e.target.value)) setOpen(key); }} />
              <Menu trigger={<Button variant="ghost" size="sm" icon={MoreHorizontal} aria-label="Field actions" />} items={[
                hasExtra && { label: expanded ? 'Hide settings' : f.type === 'ai' ? 'Edit prompt' : 'Edit options', icon: Columns3, onClick: () => setOpen(expanded ? null : key) },
                { label: 'Move up', icon: ChevronUp, disabled: i === 0, onClick: () => move(i, -1) },
                { label: 'Move down', icon: ChevronDown, disabled: i === fields.length - 1, onClick: () => move(i, 1) },
                { divider: true },
                { label: 'Delete field', icon: Trash2, danger: true, onClick: () => remove(i) },
              ]} />
            </div>
            {hasExtra && (expanded || (f.type === 'ai' && !f.prompt) || (f.type !== 'ai' && !(f.options || []).length)) && (
              <div className="fd-field-body">
                {f.type === 'ai' ? (
                  <Field label="Prompt" help="Runs for each record when you click AI fill. Reference other fields with {{Field Name}}.">
                    <Textarea rows={4} value={f.prompt || ''} placeholder="Summarise {{Notes}} in one sentence."
                      onChange={(e) => set(i, { prompt: e.target.value })} onFocus={(e) => { promptRefs.current[i] = e.target; }} />
                    <div className="fd-insert mt-8">
                      {fields.filter((x, k) => k !== i && x.name.trim()).map((x) => <button key={x.id || x._key} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertToken(i, x.name.trim())}>+ {x.name}</button>)}
                    </div>
                  </Field>
                ) : (
                  <Field label="Options" help="One option per line.">
                    <Textarea rows={4} value={(f.options || []).join('\n')} placeholder={'New\nIn progress\nDone'} onChange={(e) => set(i, { options: e.target.value.split('\n') })} />
                  </Field>
                )}
              </div>
            )}
          </div>
        );
      })}
    </Drawer>
  );
}

// ---------------------------------------------------------------- Page
export default function TableView() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const [table, setTable] = useState(null);
  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [filter, setFilter] = useState({ field: '', value: '' });
  const [sort, setSort] = useState({ field: '', dir: 'asc' });
  const [showFilter, setShowFilter] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState(() => new Set());
  const [autoEdit, setAutoEdit] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [limitError, setLimitError] = useState('');
  const [aiError, setAiError] = useState('');
  const [busy, setBusy] = useState('');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');

  useEffect(() => { const t = setTimeout(() => setDebouncedQ(q), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setOffset(0); }, [debouncedQ, filter.field, filter.value, sort.field, sort.dir]);

  const load = useCallback(async (silent) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (debouncedQ) params.set('q', debouncedQ);
      if (sort.field) { params.set('sort', sort.field); params.set('dir', sort.dir); }
      if (filter.field && filter.value !== '') { params.set('filterField', filter.field); params.set('filterValue', filter.value); }
      const t = await api.get(`tables/${id}?${params}`);
      setTable(t); setRecords(t.records); setTotal(t.total); setError(null);
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  }, [id, offset, debouncedQ, sort.field, sort.dir, filter.field, filter.value]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (table) { setName(table.name); setDesc(table.description || ''); } }, [table?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSelected(new Set()); }, [offset, debouncedQ, filter.value]);

  const fields = table?.fields || [];
  const aiFields = fields.filter((f) => f.type === 'ai');

  const saveMeta = async (patch) => {
    try { await api.patch(`tables/${id}`, patch); setTable((t) => ({ ...t, ...patch })); }
    catch (e) { toast.error(e.message); }
  };

  const saveCell = useCallback(async (rid, fid, value) => {
    let prev;
    setRecords((rs) => rs.map((r) => { if (r.id !== rid) return r; prev = r.data[fid]; return { ...r, data: { ...r.data, [fid]: value } }; }));
    try {
      const r = await api.patch(`tables/${id}/records/${rid}`, { data: { [fid]: value } });
      setRecords((rs) => rs.map((x) => (x.id === rid ? { ...x, data: r._fields, updated_at: r.updated_at } : x)));
    } catch (e) {
      setRecords((rs) => rs.map((r) => (r.id === rid ? { ...r, data: { ...r.data, [fid]: prev } } : r)));
      toast.error(`Couldn't save: ${e.message}`);
    }
  }, [id, toast]);

  const addRecord = async () => {
    setBusy('add');
    try {
      const r = await api.post(`tables/${id}/records`, { data: {} });
      setRecords((rs) => [{ id: r.id, data: r._fields || {}, created_at: r.created_at, updated_at: r.updated_at }, ...rs]);
      setTotal((n) => n + 1);
      setLimitError('');
      const first = fields.find((f) => !['checkbox', 'rating'].includes(f.type));
      if (first) setAutoEdit(`${r.id}:${first.id}`);
      document.querySelector('.tv-grid-wrap')?.scrollTo({ top: 0 });
    } catch (e) {
      if (isLimitError(e)) setLimitError(e.message);
      toast.error(e.message);
    } finally { setBusy(''); }
  };

  const deleteRecord = async (rec) => {
    const ok = await dialog.confirm({ title: 'Delete this record?', message: 'This cannot be undone.', danger: true, confirmText: 'Delete record' });
    if (!ok) return;
    try {
      await api.del(`tables/${id}/records/${rec.id}`);
      setRecords((rs) => rs.filter((r) => r.id !== rec.id)); setTotal((n) => Math.max(0, n - 1));
      setSelected((s) => { const n = new Set(s); n.delete(rec.id); return n; });
      setExpanded(null);
      toast.success('Record deleted');
    } catch (e) { toast.error(e.message); }
  };
  const bulkDelete = async () => {
    const ids = [...selected];
    const ok = await dialog.confirm({ title: `Delete ${plural(ids.length, 'record')}?`, message: 'This cannot be undone.', danger: true, confirmText: 'Delete' });
    if (!ok) return;
    try {
      const r = await api.post(`tables/${id}/records/bulk-delete`, { ids });
      toast.success(`Deleted ${plural(r.deleted, 'record')}`);
      setSelected(new Set());
      load(true);
    } catch (e) { toast.error(e.message); }
  };
  const exportCsv = async () => {
    try { await api.download(`tables/${id}/export`, `${(table?.name || 'table').replace(/[^\w-]+/g, '_')}.csv`); } catch (e) { toast.error(e.message); }
  };
  const aiFill = async (f) => {
    setBusy(`ai:${f.id}`); setAiError('');
    try {
      const r = await api.post(`tables/${id}/ai-fill`, { fieldId: f.id });
      toast.success(r.filled ? `AI filled ${plural(r.filled, 'record')} in “${f.name}”` : `Nothing to fill — every record already has a “${f.name}” value.`);
      load(true);
    } catch (e) {
      if (/not configured/i.test(e.message)) setAiError(e.message);
      else if (/prompt/i.test(e.message)) { toast.error(e.message); setFieldsOpen(true); }
      else toast.error(e.message);
    } finally { setBusy(''); }
  };
  const createFlow = async () => {
    try {
      const r = await api.post('flows', { name: `When a record is added to ${table.name}`, definition: { trigger: { app: 'tables', event: 'new_record', params: { tableId: id } }, steps: [] } });
      nav(`/flows/${r.id}`);
    } catch (e) { toast.error(e.message); }
  };
  const toggleSort = (fid) => setSort((s) => (s.field !== fid ? { field: fid, dir: 'asc' } : s.dir === 'asc' ? { field: fid, dir: 'desc' } : { field: '', dir: 'asc' }));

  if (loading && !table) return <div className="page page-wide"><Loading /></div>;
  if (error && !table) {
    return (
      <div className="page page-wide">
        {error.status === 404 ? <div className="card"><EmptyState icon={Table2} title="Table not found" action={<Button onClick={() => nav('/tables')}>Back to tables</Button>}>It may have been deleted.</EmptyState></div>
          : <ErrorState error={error} onRetry={() => load()} />}
      </div>
    );
  }

  const allOnPage = records.length > 0 && records.every((r) => selected.has(r.id));
  const filtering = Boolean(debouncedQ || (filter.field && filter.value !== ''));
  const filterField = fields.find((f) => f.id === filter.field);

  return (
    <div className="page page-wide">
      <div className="tv-head">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => nav('/tables')} aria-label="Back to tables" />
        <div className="grow">
          <input className="tv-title" aria-label="Table name" value={name} onChange={(e) => setName(e.target.value)}
            onBlur={() => { const n = name.trim(); if (!n) setName(table.name); else if (n !== table.name) saveMeta({ name: n }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setName(table.name); setTimeout(() => e.target.blur()); } }} />
          <input className="tv-desc" aria-label="Table description" value={desc} placeholder="Add a description…" onChange={(e) => setDesc(e.target.value)}
            onBlur={() => { if (desc !== (table.description || '')) saveMeta({ description: desc }); }} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
        </div>
        <Badge>{plural(total, 'record')}{filtering ? ' matching' : ''}</Badge>
      </div>

      {limitError && <div className="mb-16"><Callout type="warning"><b>{limitError}</b></Callout></div>}
      {aiError && <div className="mb-16"><Callout type="info" icon={Sparkles}><span className="row between wrap"><span>{aiError} <Link to="/settings">Open settings</Link></span><Button size="xs" variant="ghost" icon={X} onClick={() => setAiError('')} aria-label="Dismiss" /></span></Callout></div>}

      <div className="tv-toolbar">
        <div className="search"><SearchInput value={q} onChange={setQ} placeholder="Search records…" /></div>
        <Button icon={Filter} variant={filter.field && filter.value !== '' ? 'primary' : 'secondary'} onClick={() => setShowFilter((s) => !s)}>
          Filter{filter.field && filter.value !== '' ? ': 1' : ''}
        </Button>
        <Menu width={220} trigger={<Button icon={ArrowUpDown} variant={sort.field ? 'primary' : 'secondary'}>{sort.field ? `Sort: ${fields.find((f) => f.id === sort.field)?.name || '…'}` : 'Sort'}</Button>} items={[
          { section: 'Sort by' },
          ...fields.map((f) => ({ label: f.name, icon: sort.field === f.id ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : undefined, hint: sort.field === f.id ? sort.dir : undefined, onClick: () => toggleSort(f.id) })),
          sort.field && { divider: true },
          sort.field && { label: sort.dir === 'asc' ? 'Descending' : 'Ascending', icon: sort.dir === 'asc' ? ArrowDown : ArrowUp, onClick: () => setSort((s) => ({ ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' })) },
          sort.field && { label: 'Clear sort', icon: X, onClick: () => setSort({ field: '', dir: 'asc' }) },
        ]} />
        <div className="grow" />
        <Button variant="primary" icon={Plus} loading={busy === 'add'} onClick={addRecord} disabled={!fields.length}>Add record</Button>
        <Button icon={Columns3} onClick={() => setFieldsOpen(true)}>Fields</Button>
        {aiFields.length > 0 && (
          <Menu trigger={<Button icon={Sparkles} loading={busy.startsWith('ai:')}>AI fill</Button>} items={[
            { section: 'Fill empty values in' },
            ...aiFields.map((f) => ({ label: f.name, icon: Sparkles, onClick: () => aiFill(f) })),
          ]} />
        )}
        <Menu width={260} trigger={<Button icon={Zap}>Automate</Button>} items={[
          { section: 'Flows using this table' },
          ...(table.flows?.length ? table.flows.map((f) => ({ label: f.name, icon: Workflow, hint: f.status, onClick: () => nav(`/flows/${f.id}`) })) : [{ label: 'No flows yet', disabled: true }]),
          { divider: true },
          { label: 'Create flow when a record is added', icon: Plus, onClick: createFlow },
        ]} />
        <Menu trigger={<Button icon={MoreHorizontal} aria-label="More table actions" />} items={[
          { label: 'Import CSV', icon: Upload, onClick: () => setImportOpen(true) },
          { label: 'Export CSV', icon: Download, onClick: exportCsv },
        ]} />
      </div>

      {showFilter && (
        <div className="card card-pad mb-16" style={{ padding: 12 }}>
          <div className="row wrap">
            <span className="small bold">Show records where</span>
            <Select value={filter.field} placeholder="Choose a field" options={fields.map((f) => ({ value: f.id, label: f.name }))} onChange={(e) => setFilter({ field: e.target.value, value: '' })} style={{ width: 180 }} />
            <span className="small muted">is</span>
            {filterField && ['select'].includes(filterField.type) ? (
              <Select value={filter.value} placeholder="Any value" options={optionsOf(filterField)} onChange={(e) => setFilter((f) => ({ ...f, value: e.target.value }))} style={{ width: 180 }} />
            ) : filterField?.type === 'checkbox' ? (
              <Select value={filter.value} placeholder="Any value" options={[{ value: 'true', label: 'Checked' }, { value: 'false', label: 'Unchecked' }]} onChange={(e) => setFilter((f) => ({ ...f, value: e.target.value }))} style={{ width: 180 }} />
            ) : (
              <Input value={filter.value} disabled={!filter.field} placeholder="Exact value" onChange={(e) => setFilter((f) => ({ ...f, value: e.target.value }))} style={{ width: 200 }} />
            )}
            {(filter.field || filter.value) && <Button size="sm" variant="ghost" icon={X} onClick={() => setFilter({ field: '', value: '' })}>Clear</Button>}
          </div>
        </div>
      )}

      {selected.size > 0 && (
        <div className="tv-bulk">
          <span>{plural(selected.size, 'record')} selected</span>
          <Button size="xs" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          <div className="grow" />
          <Button size="sm" variant="danger" icon={Trash2} onClick={bulkDelete}>Delete selected</Button>
        </div>
      )}

      {!fields.length ? (
        <div className="card"><EmptyState icon={Columns3} title="This table has no fields" action={<Button variant="primary" icon={Plus} onClick={() => setFieldsOpen(true)}>Add fields</Button>}>Fields define the columns of your table.</EmptyState></div>
      ) : (
        <div className="tv-grid-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
          <table className="tv-grid" role="grid" aria-label={table.name}>
            <thead>
              <tr>
                <th className="col-sel"><div className="sel-inner"><input type="checkbox" aria-label="Select all on this page" checked={allOnPage}
                  onChange={(e) => setSelected(e.target.checked ? new Set(records.map((r) => r.id)) : new Set())} /></div></th>
                {fields.map((f) => {
                  const I = fieldTypeMeta(f.type).icon;
                  return (
                    <th key={f.id} aria-sort={sort.field === f.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <div className="th-inner" onClick={() => toggleSort(f.id)} onDoubleClick={() => setFieldsOpen(true)} title="Click to sort · double-click to edit fields">
                        <I /><span className="truncate">{f.name}</span>
                        {sort.field === f.id && <span className="sort-ind">{sort.dir === 'asc' ? <ArrowUp /> : <ArrowDown />}</span>}
                      </div>
                    </th>
                  );
                })}
                <th className="col-actions" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {records.map((r, idx) => (
                <tr key={r.id} className={selected.has(r.id) ? 'selected' : ''}>
                  <td className="col-sel">
                    <div className="sel-inner">
                      <input type="checkbox" aria-label="Select record" checked={selected.has(r.id)}
                        onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} />
                      <span className="rownum">{offset + idx + 1}</span>
                      <Button size="xs" variant="ghost" icon={Maximize2} aria-label="Expand record" onClick={() => setExpanded(r)} />
                    </div>
                  </td>
                  {fields.map((f) => (
                    <Cell key={f.id} field={f} value={r.data[f.id]} onSave={(v) => saveCell(r.id, f.id, v)}
                      autoEdit={autoEdit === `${r.id}:${f.id}`} onAutoEdited={() => setAutoEdit(null)} />
                  ))}
                  <td className="col-actions"><Button size="xs" variant="danger-ghost" icon={Trash2} aria-label="Delete record" onClick={() => deleteRecord(r)} /></td>
                </tr>
              ))}
              {!records.length && (
                <tr><td colSpan={fields.length + 2} style={{ height: 'auto' }}>
                  <EmptyState icon={Table2} title={filtering ? 'No matching records' : 'No records yet'}
                    action={filtering ? <Button onClick={() => { setQ(''); setFilter({ field: '', value: '' }); }}>Clear search & filter</Button> : <div className="row"><Button variant="primary" icon={Plus} onClick={addRecord}>Add record</Button><Button icon={Upload} onClick={() => setImportOpen(true)}>Import CSV</Button></div>}>
                    {filtering ? 'Try a different search or filter.' : 'Add a record, import a CSV, or let a flow, form or chatbot fill this table.'}
                  </EmptyState>
                </td></tr>
              )}
              {records.length > 0 && (
                <tr className="tv-add-row"><td colSpan={fields.length + 2} style={{ position: 'sticky', left: 0 }}><button type="button" onClick={addRecord}><Plus />Add record</button></td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <Pagination total={total} limit={PAGE} offset={offset} onChange={setOffset} />

      {expanded && <RecordModal table={table} record={expanded} onClose={() => setExpanded(null)} onDelete={deleteRecord}
        onSaved={(rec) => setRecords((rs) => rs.map((x) => (x.id === rec.id ? rec : x)))} />}
      {importOpen && <ImportModal table={table} onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); load(true); }} />}
      {fieldsOpen && <FieldsDrawer table={table} onClose={() => setFieldsOpen(false)} onSaved={(fs) => { setTable((t) => ({ ...t, fields: fs })); load(true); }} />}
    </div>
  );
}

