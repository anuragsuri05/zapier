// Renders interface blocks. Shared by the public page (/p/:slug) and the builder's live preview so they look identical.
import { useEffect, useState } from 'react';
import { CheckCircle2, ImageIcon, Plus, Search, ExternalLink, Table2, Bot, AlertCircle } from 'lucide-react';
import api from '../../lib/api.js';
import { useDialog } from '../../lib/context.jsx';
import { Spinner } from '../../components/ui.jsx';
import FieldInput from '../tables/FieldInput.jsx';
import { formatValue } from '../tables/fieldTypes.js';
import ChatWidget, { contrastText } from '../chatbots/ChatWidget.jsx';
import { publicChatSender } from '../chatbots/PublicChatbot.jsx';
import './interfaces.css';

export const DEFAULT_THEME = { primary: '#5B3DF5', background: '#F7F6FF', layout: 'centered' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isHex = (c) => /^#[0-9a-f]{6}$/i.test(String(c || ''));

/** Public API client for one interface (adds the password header when set). */
export function publicClient(slug, password) {
  const opts = password ? { headers: { 'x-interface-password': password } } : undefined;
  const base = `/api/public/interfaces/${encodeURIComponent(slug)}`;
  return {
    get: (path = '') => api.get(`${base}${path}`, opts),
    post: (path, body) => api.post(`${base}${path}`, body, opts),
  };
}

/** Page wrapper that applies the interface theme. */
export function InterfacePage({ theme = {}, children, footer, className = '' }) {
  const t = { ...DEFAULT_THEME, ...theme };
  const primary = isHex(t.primary) ? t.primary : DEFAULT_THEME.primary;
  const bg = isHex(t.background) ? t.background : DEFAULT_THEME.background;
  return (
    <div className={`pi-page ${className}`} style={{ '--pi-primary': primary, '--pi-on-primary': contrastText(primary), '--pi-bg': bg }}>
      <div className={`pi-container ${t.layout === 'wide' ? 'wide' : ''}`}>
        <div className="pi-surface">{children}</div>
        {footer}
      </div>
    </div>
  );
}

function HeadingBlock({ block }) {
  const Tag = block.size === 'md' ? 'h3' : block.size === 'lg' ? 'h2' : 'h1';
  return <Tag className={`pi-heading pi-h-${block.size || 'xl'}`}>{block.text || 'Heading'}</Tag>;
}

function FormField({ f, value, onChange, error }) {
  const id = `ff-${f.id}`;
  const common = { id, 'aria-invalid': Boolean(error), 'aria-describedby': error ? `${id}-err` : undefined, className: `input ${error ? 'invalid' : ''}` };
  let control;
  switch (f.type) {
    case 'textarea': control = <textarea {...common} className={`textarea ${error ? 'invalid' : ''}`} rows={4} placeholder={f.placeholder} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />; break;
    case 'select': control = (
      <select {...common} className={`select ${error ? 'invalid' : ''}`} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">{f.placeholder || 'Choose…'}</option>
        {(Array.isArray(f.options) ? f.options : String(f.options || '').split(/\n|,/)).map((o) => String(o).trim()).filter(Boolean).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    ); break;
    case 'checkbox': return (
      <div className="field">
        <label className="checkbox" htmlFor={id}><input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />{f.label}{f.required && <span className="req" style={{ color: 'var(--danger)' }}> *</span>}</label>
        {error && <div className="error-text" id={`${id}-err`}>{error}</div>}
      </div>
    );
    default: {
      const type = { email: 'email', number: 'number', date: 'date', phone: 'tel', url: 'url' }[f.type] || 'text';
      control = <input {...common} type={type} placeholder={f.placeholder} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    }
  }
  return (
    <div className="field">
      <label htmlFor={id}><span>{f.label}{f.required && <span className="req"> *</span>}</span></label>
      {control}
      {error && <div className="error-text" id={`${id}-err`}>{error}</div>}
    </div>
  );
}

function validate(fields, values) {
  const errors = {};
  for (const f of fields) {
    const v = typeof values[f.id] === 'string' ? values[f.id].trim() : values[f.id];
    const empty = v === undefined || v === '' || v === false || v === null;
    if (f.required && empty) errors[f.id] = `${f.label} is required`;
    else if (!empty && f.type === 'email' && !EMAIL_RE.test(v)) errors[f.id] = 'Enter a valid email';
    else if (!empty && f.type === 'number' && isNaN(Number(v))) errors[f.id] = 'Enter a number';
    else if (!empty && f.type === 'url' && !/^https?:\/\/\S+\.\S+/i.test(v)) errors[f.id] = 'Enter a full URL starting with https://';
  }
  return errors;
}

function FormBlock({ block, mode, client }) {
  const fields = block.fields || [];
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    const errs = validate(fields, values);
    setErrors(errs);
    if (Object.keys(errs).length) { document.getElementById(`ff-${Object.keys(errs)[0]}`)?.focus(); return; }
    if (mode !== 'public') { setDone({ message: block.successMessage || 'Thanks! Your response was recorded.', preview: true }); return; }
    setBusy(true);
    try {
      const r = await client.post('/submit', { blockId: block.id, data: values });
      if (r.redirect && /^https?:\/\//i.test(r.redirect)) { window.location.href = r.redirect; return; }
      setDone({ message: r.message });
      setValues({});
    } catch (err) {
      if (err.data?.errors) setErrors(err.data.errors);
      setFormError(err.message);
    } finally { setBusy(false); }
  };
  if (done) {
    return (
      <div className="pi-form pi-success" role="status">
        <CheckCircle2 />
        <p>{done.message}</p>
        {done.preview && <p className="tiny subtle">Preview — responses are only recorded on the published page.</p>}
        <button type="button" className="pi-btn pi-btn-secondary" onClick={() => { setDone(null); setErrors({}); }}>Submit another response</button>
      </div>
    );
  }
  return (
    <form className="pi-form" onSubmit={submit} noValidate>
      {block.title && <h3 className="pi-form-title">{block.title}</h3>}
      {!fields.length && <p className="muted small">This form has no fields yet.</p>}
      {fields.map((f) => (
        <FormField key={f.id} f={f} value={values[f.id]} error={errors[f.id]}
          onChange={(v) => { setValues((x) => ({ ...x, [f.id]: v })); if (errors[f.id]) setErrors((x) => { const n = { ...x }; delete n[f.id]; return n; }); }} />
      ))}
      {formError && <div className="pi-alert"><AlertCircle />{formError}</div>}
      <div><button type="submit" className="pi-btn" disabled={busy}>{busy && <Spinner />}{block.submitText || 'Submit'}</button></div>
    </form>
  );
}

function TableBlock({ block, mode, client }) {
  const [state, setState] = useState({ loading: true, error: null, fields: [], records: [], allowAdd: false });
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [addError, setAddError] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    let alive = true;
    if (!block.tableId) { setState({ loading: false, error: null, fields: [], records: [], allowAdd: false }); return undefined; }
    setState((s) => ({ ...s, loading: true }));
    const p = mode === 'public'
      ? client.get(`/table/${block.id}${dq ? `?q=${encodeURIComponent(dq)}` : ''}`)
      : api.get(`tables/${block.tableId}?limit=20${dq ? `&q=${encodeURIComponent(dq)}` : ''}`).then((t) => {
        const fields = t.fields.filter((f) => !block.fields?.length || block.fields.includes(f.id));
        return { fields, records: t.records, allowAdd: Boolean(block.allowAdd) };
      });
    p.then((r) => alive && setState({ loading: false, error: null, ...r })).catch((e) => alive && setState((s) => ({ ...s, loading: false, error: e })));
    return () => { alive = false; };
  }, [block.tableId, block.id, (block.fields || []).join(','), block.allowAdd, dq, mode, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!block.tableId) return <div className="pi-placeholder"><Table2 />Choose a table to display.</div>;
  const addRecord = async (e) => {
    e.preventDefault();
    if (mode !== 'public') { setAdding(false); return; }
    setBusy(true); setAddError('');
    try { await client.post(`/table/${block.id}`, { data: draft }); setDraft({}); setAdding(false); setTick((n) => n + 1); }
    catch (err) { setAddError(err.message); }
    finally { setBusy(false); }
  };
  const editable = state.fields.filter((f) => f.type !== 'ai');
  return (
    <div className="pi-table-block">
      <div className="pi-table-head">
        {block.title ? <h3 className="grow">{block.title}</h3> : <div className="grow" />}
        <div className="pi-search"><Search /><input value={q} placeholder="Search…" aria-label="Search records" onChange={(e) => setQ(e.target.value)} /></div>
        {state.allowAdd && <button type="button" className="pi-btn pi-btn-sm" onClick={() => setAdding((a) => !a)}><Plus />Add</button>}
      </div>
      {adding && (
        <form className="pi-add" onSubmit={addRecord}>
          <div className="pi-add-grid">
            {editable.map((f) => (
              <div key={f.id} className="field"><label><span>{f.name}</span></label>
                <FieldInput field={f} value={draft[f.id]} onChange={(v) => setDraft((d) => ({ ...d, [f.id]: v }))} />
              </div>
            ))}
          </div>
          {addError && <div className="pi-alert"><AlertCircle />{addError}</div>}
          <div className="row"><button type="submit" className="pi-btn pi-btn-sm" disabled={busy}>{busy && <Spinner />}Save record</button><button type="button" className="pi-btn pi-btn-sm pi-btn-secondary" onClick={() => setAdding(false)}>Cancel</button></div>
        </form>
      )}
      {state.error ? <div className="pi-alert"><AlertCircle />{state.error.message}</div> : (
        <div className="pi-table-wrap">
          <table className="pi-table">
            <thead><tr>{state.fields.map((f) => <th key={f.id}>{f.name}</th>)}</tr></thead>
            <tbody>
              {state.records.map((r) => (
                <tr key={r.id}>{state.fields.map((f) => {
                  const v = r.data[f.id];
                  const text = formatValue(f, v);
                  return <td key={f.id} className={['number', 'currency'].includes(f.type) ? 'num' : ''}>
                    {f.type === 'url' && v ? <a href={/^https?:/i.test(v) ? v : `https://${v}`} target="_blank" rel="noreferrer">{v}</a> : f.type === 'email' && v ? <a href={`mailto:${v}`}>{v}</a> : text}
                  </td>;
                })}</tr>
              ))}
              {!state.loading && !state.records.length && <tr><td colSpan={Math.max(1, state.fields.length)} className="pi-empty">{dq ? 'No matching records.' : 'No records yet.'}</td></tr>}
              {state.loading && !state.records.length && <tr><td colSpan={Math.max(1, state.fields.length)} className="pi-empty"><Spinner /></td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ButtonBlock({ block, mode, client }) {
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const click = async () => {
    setMsg(null);
    if (block.confirmText) {
      const ok = await dialog.confirm({ title: block.label || 'Are you sure?', message: block.confirmText, confirmText: 'Continue' });
      if (!ok) return;
    }
    if (mode !== 'public') { setMsg({ ok: true, text: `${block.successMessage || 'Done!'} (preview — the flow only runs on the published page)` }); return; }
    setBusy(true);
    try {
      const r = await client.post('/button', { blockId: block.id });
      const result = r.result != null && typeof r.result !== 'object' ? ` ${r.result}` : '';
      setMsg({ ok: true, text: `${r.message}${result}` });
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(false); }
  };
  return (
    <div className="pi-button-block">
      <button type="button" className={`pi-btn ${block.style === 'secondary' ? 'pi-btn-secondary' : ''}`} onClick={click} disabled={busy}>{busy && <Spinner />}{block.label || 'Button'}</button>
      {msg && <div className={msg.ok ? 'pi-ok' : 'pi-alert'} role="status">{msg.ok ? <CheckCircle2 /> : <AlertCircle />}{msg.text}</div>}
    </div>
  );
}

function ChatbotBlock({ block, mode }) {
  const [bot, setBot] = useState(mode === 'public' ? block.chatbot : null);
  useEffect(() => {
    if (mode === 'public' || !block.chatbotId) return undefined;
    let alive = true;
    api.get(`chatbots/${block.chatbotId}`).then((b) => alive && setBot({ name: b.name, greeting: b.config.greeting, theme: b.config.theme, published: b.published, slug: b.slug })).catch(() => alive && setBot(null));
    return () => { alive = false; };
  }, [block.chatbotId, mode]);
  if (mode !== 'public' && !block.chatbotId) return <div className="pi-placeholder"><Bot />Choose a chatbot to embed.</div>;
  if (!bot) return <div className="pi-placeholder"><Bot />{mode === 'public' ? 'This chatbot is not available right now.' : 'Loading chatbot…'}</div>;
  return (
    <div className="pi-chat">
      <ChatWidget name={bot.name} greeting={bot.greeting} theme={bot.theme || {}} compact
        send={mode === 'public' ? publicChatSender(bot.slug) : async () => ({})} storageKey={mode === 'public' ? `onetier-chat:${bot.slug}` : undefined}
        disabledNote={mode !== 'public' ? (bot.published === false ? 'This chatbot is not published — it will be hidden on the live page.' : 'Chat is live on the published page.') : undefined} />
    </div>
  );
}

export function Block({ block, mode = 'public', client }) {
  switch (block.type) {
    case 'heading': return <HeadingBlock block={block} />;
    case 'text': return <p className="pi-text">{block.text}</p>;
    case 'form': return <FormBlock block={block} mode={mode} client={client} />;
    case 'table': return <TableBlock block={block} mode={mode} client={client} />;
    case 'button': return <ButtonBlock block={block} mode={mode} client={client} />;
    case 'chatbot': return <ChatbotBlock block={block} mode={mode} />;
    case 'image': return block.url ? <img className="pi-image" src={block.url} alt={block.alt || ''} loading="lazy" /> : <div className="pi-placeholder"><ImageIcon />Add an image URL.</div>;
    case 'divider': return <hr className="pi-divider" />;
    case 'link': return block.url
      ? <a className="pi-btn pi-btn-secondary pi-link" href={block.url} target={/^https?:/i.test(block.url) ? '_blank' : undefined} rel="noreferrer">{block.label || block.url}<ExternalLink /></a>
      : <div className="pi-placeholder">Add a link URL.</div>;
    default: return null;
  }
}
