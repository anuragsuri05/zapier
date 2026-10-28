import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, ExternalLink, Copy, Pencil, Heading, AlignLeft, FileText, Table2, MousePointerClick, Bot, ImageIcon, Minus, Link2, ChevronUp, ChevronDown,
  Trash2, Plus, X, Check, CloudOff, Loader2, Hammer, Inbox, Zap, Settings, Eye, Download, RotateCcw, Workflow, LayoutTemplate,
} from 'lucide-react';
import api from '../../lib/api.js';
import { useFetch, useToast, useDialog } from '../../lib/context.jsx';
import { clone, uid, fmtDate, timeAgo, plural, copyText } from '../../lib/util.js';
import {
  Button, Field, Input, Textarea, Select, Toggle, Checkbox, Tabs, Segmented, Menu, Modal, EmptyState, Loading, ErrorState, Callout, Badge, FlowStatus,
} from '../../components/ui.jsx';
import { Block, InterfacePage, DEFAULT_THEME } from './BlockRenderer.jsx';
import { toCSV, downloadText } from '../tables/fieldTypes.js';
import './interfaces.css';

const PALETTE = [
  { type: 'heading', label: 'Heading', hint: 'Page or section title', icon: Heading },
  { type: 'text', label: 'Text', hint: 'Paragraph of text', icon: AlignLeft },
  { type: 'form', label: 'Form', hint: 'Collect submissions', icon: FileText },
  { type: 'table', label: 'Table', hint: 'Show table records', icon: Table2 },
  { type: 'button', label: 'Button', hint: 'Run a flow on click', icon: MousePointerClick },
  { type: 'chatbot', label: 'Chatbot', hint: 'Embed a chatbot', icon: Bot },
  { type: 'image', label: 'Image', hint: 'Picture from a URL', icon: ImageIcon },
  { type: 'divider', label: 'Divider', hint: 'Horizontal line', icon: Minus },
  { type: 'link', label: 'Link button', hint: 'Link to another page', icon: Link2 },
];
const paletteMeta = (t) => PALETTE.find((p) => p.type === t) || PALETTE[0];
const FORM_FIELD_TYPES = [
  { value: 'text', label: 'Short text' }, { value: 'textarea', label: 'Long text' }, { value: 'email', label: 'Email' }, { value: 'number', label: 'Number' },
  { value: 'phone', label: 'Phone' }, { value: 'url', label: 'URL' }, { value: 'date', label: 'Date' }, { value: 'select', label: 'Dropdown' }, { value: 'checkbox', label: 'Checkbox' },
];

function newBlock(type) {
  const id = uid('blk');
  switch (type) {
    case 'heading': return { id, type, text: 'New heading', size: 'lg' };
    case 'text': return { id, type, text: 'Write something helpful here.' };
    case 'form': return { id, type, title: 'Form', submitText: 'Submit', successMessage: 'Thanks! Your response was recorded.', redirectUrl: '', saveToTable: '',
      fields: [{ id: uid('ff'), label: 'Name', type: 'text', required: true }, { id: uid('ff'), label: 'Email', type: 'email', required: true }] };
    case 'table': return { id, type, title: '', tableId: '', fields: [], allowAdd: false };
    case 'button': return { id, type, label: 'Run automation', flowId: '', successMessage: 'Done!', confirmText: '', style: 'primary' };
    case 'chatbot': return { id, type, chatbotId: '' };
    case 'image': return { id, type, url: '', alt: '' };
    case 'link': return { id, type, label: 'Learn more', url: 'https://' };
    default: return { id, type };
  }
}

// ---------------------------------------------------------------- Properties panels
function FormFieldsEditor({ fields, onChange }) {
  const [open, setOpen] = useState(null);
  const set = (i, patch) => onChange(fields.map((f, k) => (k === i ? { ...f, ...patch } : f)));
  const move = (i, d) => { const n = [...fields]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; onChange(n); };
  return (
    <div>
      {fields.map((f, i) => (
        <div key={f.id} className="ib-ff">
          <div className="ib-ff-head" onClick={() => setOpen(open === f.id ? null : f.id)}>
            <span className="grow truncate small bold">{f.label || 'Untitled'}{f.required && <span style={{ color: 'var(--danger)' }}> *</span>}</span>
            <Badge>{FORM_FIELD_TYPES.find((t) => t.value === f.type)?.label || f.type}</Badge>
            <span onClick={(e) => e.stopPropagation()} className="row gap-4">
              <Button size="xs" variant="ghost" icon={ChevronUp} aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
              <Button size="xs" variant="ghost" icon={ChevronDown} aria-label="Move down" disabled={i === fields.length - 1} onClick={() => move(i, 1)} />
              <Button size="xs" variant="danger-ghost" icon={Trash2} aria-label="Remove field" onClick={() => onChange(fields.filter((_, k) => k !== i))} />
            </span>
          </div>
          {open === f.id && (
            <div className="ib-ff-body">
              <Field label="Label"><Input value={f.label} onChange={(e) => set(i, { label: e.target.value })} /></Field>
              <Field label="Type"><Select value={f.type} options={FORM_FIELD_TYPES} onChange={(e) => set(i, { type: e.target.value })} /></Field>
              {f.type !== 'checkbox' && <Field label="Placeholder"><Input value={f.placeholder || ''} onChange={(e) => set(i, { placeholder: e.target.value })} /></Field>}
              {f.type === 'select' && (
                <Field label="Options" help="One per line.">
                  <Textarea rows={3} value={Array.isArray(f.options) ? f.options.join('\n') : f.options || ''} onChange={(e) => set(i, { options: e.target.value.split('\n') })} />
                </Field>
              )}
              <Checkbox checked={f.required} onChange={(v) => set(i, { required: v })} label="Required" />
            </div>
          )}
        </div>
      ))}
      <Button size="sm" variant="ghost" icon={Plus} onClick={() => { const f = { id: uid('ff'), label: `Field ${fields.length + 1}`, type: 'text', required: false }; onChange([...fields, f]); setOpen(f.id); }}>Add field</Button>
    </div>
  );
}

function TableFieldsPicker({ tableId, value, onChange }) {
  const { data, loading, error } = useFetch(tableId ? `tables/${tableId}?limit=1` : null);
  if (!tableId) return null;
  if (loading || (!data && !error)) return <Loading label="Loading fields…" />;
  if (error) return <Callout type="danger">{error.message}</Callout>;
  const sel = value || [];
  return (
    <Field label="Visible fields" help="Leave all unchecked to show every field.">
      <div className="col gap-4">
        {data.fields.map((f) => (
          <Checkbox key={f.id} checked={sel.includes(f.id)} label={f.name} onChange={(v) => onChange(v ? data.fields.filter((x) => x.id === f.id || sel.includes(x.id)).map((x) => x.id) : sel.filter((x) => x !== f.id))} />
        ))}
      </div>
    </Field>
  );
}

function Properties({ block, update, options }) {
  const set = (patch) => update({ ...block, ...patch });
  switch (block.type) {
    case 'heading': return (
      <>
        <Field label="Text"><Input value={block.text || ''} onChange={(e) => set({ text: e.target.value })} /></Field>
        <Field label="Size"><Segmented value={block.size || 'xl'} onChange={(v) => set({ size: v })} options={[{ value: 'xl', label: 'Large' }, { value: 'lg', label: 'Medium' }, { value: 'md', label: 'Small' }]} /></Field>
      </>
    );
    case 'text': return <Field label="Text"><Textarea rows={6} value={block.text || ''} onChange={(e) => set({ text: e.target.value })} /></Field>;
    case 'form': return (
      <>
        <Field label="Form title"><Input value={block.title || ''} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Fields"><FormFieldsEditor fields={block.fields || []} onChange={(fields) => set({ fields })} /></Field>
        <Field label="Submit button text"><Input value={block.submitText || ''} onChange={(e) => set({ submitText: e.target.value })} /></Field>
        <Field label="Success message"><Textarea rows={2} value={block.successMessage || ''} onChange={(e) => set({ successMessage: e.target.value })} /></Field>
        <Field label="Redirect after submit" help="Optional. Send people to this URL instead of showing the success message.">
          <Input value={block.redirectUrl || ''} placeholder="https://example.com/thanks" onChange={(e) => set({ redirectUrl: e.target.value })} />
        </Field>
        <Field label="Save submissions to table" help="Values are matched to table fields by label.">
          <Select value={block.saveToTable || ''} placeholder="Don't save to a table" options={options.tables} onChange={(e) => set({ saveToTable: e.target.value })} />
        </Field>
      </>
    );
    case 'table': return (
      <>
        <Field label="Title"><Input value={block.title || ''} placeholder="Optional" onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Table"><Select value={block.tableId || ''} placeholder="Choose a table" options={options.tables} onChange={(e) => set({ tableId: e.target.value, fields: [] })} /></Field>
        <TableFieldsPicker tableId={block.tableId} value={block.fields} onChange={(fields) => set({ fields })} />
        <Toggle checked={block.allowAdd} onChange={(v) => set({ allowAdd: v })} label="Let visitors add records" />
        {block.tableId && <Callout type="warning">Anyone who can open this page can see the visible fields of this table.</Callout>}
      </>
    );
    case 'button': return (
      <>
        <Field label="Label"><Input value={block.label || ''} onChange={(e) => set({ label: e.target.value })} /></Field>
        <Field label="Flow to run" help="Without a flow, clicks trigger “Button Clicked” flows for this interface.">
          <Select value={block.flowId || ''} placeholder="No flow" options={options.flows} onChange={(e) => set({ flowId: e.target.value })} />
        </Field>
        <Field label="Success message"><Input value={block.successMessage || ''} onChange={(e) => set({ successMessage: e.target.value })} /></Field>
        <Field label="Confirmation" help="Optional. Ask people to confirm before running."><Input value={block.confirmText || ''} placeholder="Are you sure?" onChange={(e) => set({ confirmText: e.target.value })} /></Field>
        <Field label="Style"><Segmented value={block.style || 'primary'} onChange={(v) => set({ style: v })} options={[{ value: 'primary', label: 'Primary' }, { value: 'secondary', label: 'Secondary' }]} /></Field>
      </>
    );
    case 'chatbot': return (
      <Field label="Chatbot" help="Only published chatbots appear on the live page.">
        <Select value={block.chatbotId || ''} placeholder="Choose a chatbot" options={options.chatbots} onChange={(e) => set({ chatbotId: e.target.value })} />
      </Field>
    );
    case 'image': return (
      <>
        <Field label="Image URL"><Input value={block.url || ''} placeholder="https://…/image.png" onChange={(e) => set({ url: e.target.value })} /></Field>
        <Field label="Alt text" help="Describes the image for screen readers."><Input value={block.alt || ''} onChange={(e) => set({ alt: e.target.value })} /></Field>
      </>
    );
    case 'link': return (
      <>
        <Field label="Label"><Input value={block.label || ''} onChange={(e) => set({ label: e.target.value })} /></Field>
        <Field label="URL"><Input value={block.url || ''} onChange={(e) => set({ url: e.target.value })} /></Field>
      </>
    );
    case 'divider': return <p className="muted small">Dividers have no settings.</p>;
    default: return null;
  }
}

// ---------------------------------------------------------------- Build tab
function BuildTab({ config, setConfig, selected, setSelected, options }) {
  const blocks = config.blocks || [];
  const setBlocks = (fn) => setConfig((c) => ({ ...c, blocks: fn(c.blocks || []) }));
  const add = (type) => {
    const b = newBlock(type);
    setBlocks((bs) => { const i = bs.findIndex((x) => x.id === selected); const n = [...bs]; n.splice(i >= 0 ? i + 1 : n.length, 0, b); return n; });
    setSelected(b.id);
    setTimeout(() => document.getElementById(`ib-${b.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };
  const move = (id, d) => setBlocks((bs) => { const i = bs.findIndex((b) => b.id === id); const j = i + d; if (j < 0 || j >= bs.length) return bs; const n = [...bs]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const dup = (id) => setBlocks((bs) => {
    const i = bs.findIndex((b) => b.id === id); const c = clone(bs[i]); c.id = uid('blk');
    if (c.fields && c.type === 'form') c.fields = c.fields.map((f) => ({ ...f, id: uid('ff') }));
    const n = [...bs]; n.splice(i + 1, 0, c); setTimeout(() => setSelected(c.id)); return n;
  });
  const remove = (id) => { setBlocks((bs) => bs.filter((b) => b.id !== id)); if (selected === id) setSelected(null); };
  const update = (b) => setBlocks((bs) => bs.map((x) => (x.id === b.id ? b : x)));
  const sel = blocks.find((b) => b.id === selected);
  const addMenu = PALETTE.map((p) => ({ label: p.label, icon: p.icon, onClick: () => add(p.type) }));

  return (
    <div className="editor-body">
      <aside className="ib-palette" aria-label="Blocks">
        <h4>Add a block</h4>
        {PALETTE.map((p) => (
          <button key={p.type} type="button" className="ib-pal-item" onClick={() => add(p.type)}>
            <span className="ico"><p.icon /></span><span><span className="bold small">{p.label}</span><small>{p.hint}</small></span>
          </button>
        ))}
      </aside>
      <div className="editor-canvas ib-canvas-inner" onClick={() => setSelected(null)}>
        <div className="ib-mobile-add" onClick={(e) => e.stopPropagation()}><Menu align="left" trigger={<Button size="sm" icon={Plus}>Add block</Button>} items={addMenu} /></div>
        <InterfacePage theme={config.theme}>
          {!blocks.length && <EmptyState icon={LayoutTemplate} title="This page is empty">Add blocks from the panel on the left.</EmptyState>}
          {blocks.map((b, i) => (
            <div key={b.id} id={`ib-${b.id}`} className={`ib-block ${selected === b.id ? 'selected' : ''}`} tabIndex={0} role="button" aria-label={`${paletteMeta(b.type).label} block`}
              onClick={(e) => { e.stopPropagation(); setSelected(b.id); }} onKeyDown={(e) => { if (e.key === 'Enter') setSelected(b.id); if (e.key === 'Delete' && e.target === e.currentTarget) remove(b.id); }}>
              <span className="ib-block-label">{paletteMeta(b.type).label}</span>
              <div className="ib-block-tools" onClick={(e) => e.stopPropagation()}>
                <Button size="xs" variant="ghost" icon={ChevronUp} aria-label="Move up" disabled={i === 0} onClick={() => move(b.id, -1)} />
                <Button size="xs" variant="ghost" icon={ChevronDown} aria-label="Move down" disabled={i === blocks.length - 1} onClick={() => move(b.id, 1)} />
                <Button size="xs" variant="ghost" icon={Copy} aria-label="Duplicate" onClick={() => dup(b.id)} />
                <Button size="xs" variant="danger-ghost" icon={Trash2} aria-label="Delete" onClick={() => remove(b.id)} />
              </div>
              <div className="ib-block-content"><Block block={b} mode="preview" /></div>
            </div>
          ))}
        </InterfacePage>
      </div>
      {sel ? (
        <aside className="editor-side" aria-label="Block properties">
          <div className="editor-side-header">
            {(() => { const I = paletteMeta(sel.type).icon; return <I size={16} />; })()}
            <h3 className="grow">{paletteMeta(sel.type).label}</h3>
            <Button size="sm" variant="danger-ghost" icon={Trash2} aria-label="Delete block" onClick={() => remove(sel.id)} />
            <Button size="sm" variant="ghost" icon={X} aria-label="Close properties" onClick={() => setSelected(null)} />
          </div>
          <div className="editor-side-body col gap-16"><Properties key={sel.id} block={sel} update={update} options={options} /></div>
        </aside>
      ) : (
        <aside className="editor-side ib-side-empty-wrap"><div className="ib-side-empty"><MousePointerClick size={28} /><p className="mt-8">Select a block in the preview to edit its settings.</p></div></aside>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Settings tab
function SettingsTab({ config, setConfig }) {
  const theme = { ...DEFAULT_THEME, ...(config.theme || {}) };
  const setTheme = (patch) => setConfig((c) => ({ ...c, theme: { ...DEFAULT_THEME, ...(c.theme || {}), ...patch } }));
  const color = (key, label) => (
    <Field label={label}>
      <div className="ib-color">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(theme[key]) ? theme[key] : '#000000'} onChange={(e) => setTheme({ [key]: e.target.value })} aria-label={label} />
        <Input value={theme[key] || ''} onChange={(e) => setTheme({ [key]: e.target.value })} style={{ width: 130 }} invalid={!/^#[0-9a-f]{6}$/i.test(theme[key] || '')} />
      </div>
    </Field>
  );
  const pwMissing = config.access === 'password' && !config.password;
  return (
    <div className="page page-narrow">
      <div className="card mb-16">
        <div className="card-header"><h3>Theme</h3></div>
        <div className="card-body col gap-16">
          <div className="grid-2">{color('primary', 'Primary colour')}{color('background', 'Background colour')}</div>
          <Field label="Layout"><Segmented value={theme.layout} onChange={(v) => setTheme({ layout: v })} options={[{ value: 'centered', label: 'Centered' }, { value: 'wide', label: 'Wide' }]} /></Field>
        </div>
      </div>
      <div className="card">
        <div className="card-header"><h3>Access</h3></div>
        <div className="card-body col gap-16">
          <Segmented value={config.access === 'password' ? 'password' : 'public'} onChange={(v) => setConfig((c) => ({ ...c, access: v }))}
            options={[{ value: 'public', label: 'Anyone with the link' }, { value: 'password', label: 'Password protected' }]} />
          {config.access === 'password' && (
            <Field label="Password" required error={pwMissing ? 'Set a password, otherwise the page stays open to everyone.' : undefined} help="Share it with the people who should see this page.">
              <Input value={config.password || ''} invalid={pwMissing} onChange={(e) => setConfig((c) => ({ ...c, password: e.target.value }))} />
            </Field>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Submissions tab
function SubmissionsTab({ iface }) {
  const toast = useToast();
  const dialog = useDialog();
  const { data, error, loading, reload, setData } = useFetch(`interfaces/${iface.id}/submissions`);
  const [view, setView] = useState(null);
  const forms = Object.fromEntries((iface.config.blocks || []).filter((b) => b.type === 'form').map((b) => [b.id, b.title || 'Form']));
  const cols = useMemo(() => {
    const keys = [];
    for (const s of data || []) for (const k of Object.keys(s.data || {})) if (k !== 'submitted_at' && !keys.includes(k)) keys.push(k);
    return keys;
  }, [data]);
  const exportCsv = () => {
    const rows = [['id', 'form', ...cols, 'submitted_at'], ...(data || []).map((s) => [s.id, forms[s.block_id] || s.block_id, ...cols.map((c) => s.data[c]), s.created_at])];
    downloadText(toCSV(rows), `${iface.name.replace(/[^\w-]+/g, '_')}-submissions.csv`);
  };
  const remove = async (s) => {
    const ok = await dialog.confirm({ title: 'Delete this submission?', message: 'This cannot be undone.', danger: true, confirmText: 'Delete' });
    if (!ok) return;
    try { await api.del(`interfaces/${iface.id}/submissions/${s.id}`); setData((xs) => xs.filter((x) => x.id !== s.id)); setView(null); toast.success('Submission deleted'); }
    catch (e) { toast.error(e.message); }
  };
  const fmt = (v) => (v === true ? 'Yes' : v === false ? 'No' : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const shown = cols.slice(0, 5);
  return (
    <div className="page">
      <div className="page-header">
        <div><h1>Submissions</h1><p>Responses collected by the forms on this page.</p></div>
        <div className="row"><Button icon={RotateCcw} onClick={reload}>Refresh</Button><Button icon={Download} disabled={!data?.length} onClick={exportCsv}>Export CSV</Button></div>
      </div>
      {loading && !data ? <Loading /> : error ? <ErrorState error={error} onRetry={reload} /> : !data.length ? (
        <div className="card"><EmptyState icon={Inbox} title="No submissions yet">{iface.published ? 'Share the page link to start collecting responses.' : 'Publish the page and share its link to start collecting responses.'}</EmptyState></div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr>{Object.keys(forms).length > 1 && <th>Form</th>}{shown.map((c) => <th key={c}>{c}</th>)}<th>Submitted</th><th /></tr></thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id} className="clickable" onClick={() => setView(s)}>
                  {Object.keys(forms).length > 1 && <td>{forms[s.block_id] || '—'}</td>}
                  {shown.map((c) => <td key={c} style={{ maxWidth: 240 }} className="truncate">{fmt(s.data[c])}</td>)}
                  <td className="nowrap muted" title={fmtDate(s.created_at)}>{timeAgo(s.created_at)}</td>
                  <td className="right nowrap" onClick={(e) => e.stopPropagation()}>
                    <Button size="xs" variant="ghost" icon={Eye} aria-label="View submission" onClick={() => setView(s)} />
                    <Button size="xs" variant="danger-ghost" icon={Trash2} aria-label="Delete submission" onClick={() => remove(s)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view && (
        <Modal title="Submission" subtitle={`${forms[view.block_id] || 'Form'} · ${fmtDate(view.created_at)}`} onClose={() => setView(null)}
          footer={<><Button variant="danger-ghost" icon={Trash2} onClick={() => remove(view)} style={{ marginRight: 'auto' }}>Delete</Button><Button onClick={() => setView(null)}>Close</Button></>}>
          <div className="col gap-12">
            {Object.entries(view.data).map(([k, v]) => (
              <div key={k}><div className="tiny subtle bold" style={{ textTransform: 'uppercase', letterSpacing: '.04em' }}>{k}</div><div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{fmt(v) || <span className="subtle">—</span>}</div></div>
            ))}
            <div className="tiny subtle mono">ID {view.id}</div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Automations tab
function AutomationsTab({ iface }) {
  const nav = useNavigate();
  const toast = useToast();
  const [state, setState] = useState({ loading: true, error: null, flows: [] });
  const [blockId, setBlockId] = useState('');
  const [busy, setBusy] = useState(false);
  const forms = (iface.config.blocks || []).filter((b) => b.type === 'form');
  const buttons = (iface.config.blocks || []).filter((b) => b.type === 'button' && b.flowId);
  useEffect(() => { if (!blockId && forms[0]) setBlockId(forms[0].id); }, [forms.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const all = await api.get('flows');
      const candidates = all.filter((f) => f.apps?.includes('interfaces') || buttons.some((b) => b.flowId === f.id));
      const details = await Promise.all(candidates.map((f) => api.get(`flows/${f.id}`).catch(() => null)));
      const flows = details.filter(Boolean).map((f) => {
        const t = f.definition?.trigger || {};
        const triggered = t.app === 'interfaces' && t.params?.interfaceId === iface.id;
        const button = buttons.find((b) => b.flowId === f.id);
        if (!triggered && !button) return null;
        const why = triggered
          ? t.event === 'form_submitted' ? `When “${forms.find((b) => b.id === t.params?.blockId)?.title || (t.params?.blockId ? 'a form' : 'any form')}” is submitted` : 'When a button is clicked'
          : `Runs from the “${button.label}” button`;
        return { ...f, why };
      }).filter(Boolean);
      setState({ loading: false, error: null, flows });
    } catch (e) { setState({ loading: false, error: e, flows: [] }); }
  }, [iface.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const form = forms.find((f) => f.id === blockId);
      const r = await api.post('flows', { name: `${iface.name}: ${form?.title || 'form'} submissions`, definition: { trigger: { app: 'interfaces', event: 'form_submitted', params: { interfaceId: iface.id, blockId: blockId || '' } }, steps: [] } });
      nav(`/flows/${r.id}`);
    } catch (e) { toast.error(e.message); setBusy(false); }
  };

  return (
    <div className="page page-narrow">
      <div className="page-header"><div><h1>Automations</h1><p>Flows that run when people use this page.</p></div></div>
      <div className="card card-pad mb-16">
        <h3>Create a flow for form submissions</h3>
        <p className="muted small mt-8">Start a new flow that triggers every time someone submits a form on this page.</p>
        {forms.length ? (
          <div className="row wrap mt-16">
            {forms.length > 1 && <Select value={blockId} options={forms.map((f) => ({ value: f.id, label: f.title || 'Form' }))} onChange={(e) => setBlockId(e.target.value)} style={{ width: 240 }} />}
            <Button variant="primary" icon={Zap} loading={busy} onClick={create}>Create flow</Button>
          </div>
        ) : <div className="mt-16"><Callout type="info">Add a Form block on the Build tab first.</Callout></div>}
      </div>
      <div className="card">
        <div className="card-header"><h3>Connected flows</h3><Button size="xs" variant="ghost" icon={RotateCcw} onClick={load}>Refresh</Button></div>
        {state.loading ? <Loading /> : state.error ? <ErrorState error={state.error} onRetry={load} /> : !state.flows.length ? (
          <EmptyState icon={Workflow} title="No flows yet">Create a flow above, or attach a flow to a Button block.</EmptyState>
        ) : state.flows.map((f) => (
          <div key={f.id} className="list-item clickable" onClick={() => nav(`/flows/${f.id}`)} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && nav(`/flows/${f.id}`)}>
            <Workflow size={18} style={{ color: 'var(--text-3)' }} />
            <div className="grow"><div className="bold truncate">{f.name}</div><div className="small muted">{f.why}</div></div>
            <FlowStatus status={f.status} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Page
export default function InterfaceBuilder() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const [iface, setIface] = useState(null);
  const [config, setConfigState] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState('');
  const [tab, setTab] = useState('build');
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState('saved');
  const [publishing, setPublishing] = useState(false);
  const savedRef = useRef('');
  const pendingRef = useRef(null);
  const timer = useRef(null);
  const tables = useFetch('dynamic/tables');
  const flows = useFetch('dynamic/flows');
  const chatbots = useFetch('dynamic/chatbots');
  const options = { tables: tables.data || [], flows: flows.data || [], chatbots: chatbots.data || [] };

  const load = useCallback(async () => {
    try {
      const i = await api.get(`interfaces/${id}`);
      setIface(i); setName(i.name);
      const cfg = { theme: { ...DEFAULT_THEME, ...(i.config.theme || {}) }, blocks: i.config.blocks || [], access: i.config.access || 'public', ...(i.config.password ? { password: i.config.password } : {}) };
      savedRef.current = JSON.stringify(i.config);
      setConfigState(cfg);
      setError(null);
    } catch (e) { setError(e); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const cfg = pendingRef.current;
    if (!cfg) return;
    pendingRef.current = null;
    setStatus('saving');
    try {
      const r = await api.put(`interfaces/${id}`, { config: cfg });
      savedRef.current = JSON.stringify(cfg);
      setIface((x) => ({ ...x, config: r.config, updated_at: r.updated_at }));
      setStatus(pendingRef.current ? 'unsaved' : 'saved');
    } catch (e) { setStatus('error'); pendingRef.current = pendingRef.current || cfg; toast.error(`Couldn't save: ${e.message}`); }
  }, [id, toast]);

  const setConfig = useCallback((fn) => {
    setConfigState((c) => {
      const next = typeof fn === 'function' ? fn(c) : fn;
      if (JSON.stringify(next) !== savedRef.current) {
        pendingRef.current = next;
        setStatus('unsaved');
        clearTimeout(timer.current);
        timer.current = setTimeout(() => flush(), 900);
      }
      return next;
    });
  }, [flush]);

  // flush pending changes when leaving the page
  useEffect(() => () => {
    clearTimeout(timer.current);
    if (pendingRef.current) api.put(`interfaces/${id}`, { config: pendingRef.current }).catch(() => {});
  }, [id]);
  useEffect(() => {
    const h = (e) => { if (pendingRef.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  const saveName = async () => {
    const n = name.trim();
    if (!n) { setName(iface.name); return; }
    if (n === iface.name) return;
    try { await api.put(`interfaces/${id}`, { name: n }); setIface((x) => ({ ...x, name: n })); } catch (e) { toast.error(e.message); setName(iface.name); }
  };
  const editSlug = async () => {
    const v = await dialog.prompt({ title: 'Page URL', message: `${window.location.origin}/p/…`, label: 'URL slug', defaultValue: iface.slug, confirmText: 'Save URL' });
    if (!v?.trim() || v.trim() === iface.slug) return;
    const slug = v.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    if (slug.length < 3) { toast.error('The URL must be at least 3 characters (letters, numbers and dashes).'); return; }
    try { const r = await api.put(`interfaces/${id}`, { slug }); setIface((x) => ({ ...x, slug: r.slug })); toast.success('URL updated'); }
    catch (e) { toast.error(e.message); }
  };
  const togglePublish = async (v) => {
    if (v && config.access === 'password' && !config.password) { toast.error('Set a password in Settings before publishing a protected page.'); setTab('settings'); return; }
    setPublishing(true);
    try { await flush(); const r = await api.put(`interfaces/${id}`, { published: v }); setIface((x) => ({ ...x, published: r.published })); toast.success(r.published ? 'Page published' : 'Page unpublished'); }
    catch (e) { toast.error(e.message); }
    finally { setPublishing(false); }
  };

  if (error) {
    return (
      <div className="editor-shell"><div className="page">
        {error.status === 404 ? <div className="card"><EmptyState icon={LayoutTemplate} title="Interface not found" action={<Button onClick={() => nav('/interfaces')}>Back to interfaces</Button>}>It may have been deleted.</EmptyState></div>
          : <ErrorState error={error} onRetry={load} />}
      </div></div>
    );
  }
  if (!iface || !config) return <div className="editor-shell"><Loading /></div>;

  const link = `${window.location.origin}/p/${iface.slug}`;
  const statusEl = {
    saved: <span className="ib-status"><Check size={13} />Saved</span>,
    saving: <span className="ib-status"><Loader2 size={13} className="spin" />Saving…</span>,
    unsaved: <span className="ib-status unsaved">● Unsaved</span>,
    error: <span className="ib-status err" role="button" tabIndex={0} onClick={flush} style={{ cursor: 'pointer' }}><CloudOff size={13} />Not saved · retry</span>,
  }[status];

  return (
    <div className="editor-shell">
      <div className="editor-top">
        <Button variant="ghost" size="sm" icon={ArrowLeft} aria-label="Back to interfaces" onClick={async () => { await flush(); nav('/interfaces'); }} />
        <input className="inline-title" value={name} aria-label="Interface name" onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} style={{ minWidth: 80 }} />
        <button type="button" className="ib-top-slug ib-hide-sm" onClick={editSlug} title="Edit page URL"><span>/p/{iface.slug}</span><Pencil /></button>
        <div className="grow" />
        {statusEl}
        <Toggle checked={iface.published} disabled={publishing} onChange={togglePublish} label={<span className="small bold ib-hide-sm">{iface.published ? 'Published' : 'Draft'}</span>} title="Publish" />
        <Button size="sm" icon={ExternalLink} disabled={!iface.published} title={iface.published ? 'Open the live page' : 'Publish to open the live page'} onClick={() => window.open(link, '_blank', 'noopener')}><span className="ib-hide-sm">Open</span></Button>
        <Button size="sm" icon={Copy} onClick={async () => { await copyText(link); toast.success('Link copied'); }} aria-label="Copy link"><span className="ib-hide-sm">Copy link</span></Button>
      </div>
      <div className="ib-tabs">
        <Tabs value={tab} onChange={setTab} tabs={[
          { value: 'build', label: 'Build', icon: Hammer },
          { value: 'submissions', label: 'Submissions', icon: Inbox, count: iface.submissions || undefined },
          { value: 'automations', label: 'Automations', icon: Zap },
          { value: 'settings', label: 'Settings', icon: Settings },
        ]} />
      </div>
      {tab === 'build' ? (
        <BuildTab config={config} setConfig={setConfig} selected={selected} setSelected={setSelected} options={options} />
      ) : (
        <div className="ib-scroll">
          {tab === 'submissions' && <SubmissionsTab iface={iface} />}
          {tab === 'automations' && <AutomationsTab iface={{ ...iface, config }} />}
          {tab === 'settings' && <SettingsTab config={config} setConfig={setConfig} />}
        </div>
      )}
    </div>
  );
}
