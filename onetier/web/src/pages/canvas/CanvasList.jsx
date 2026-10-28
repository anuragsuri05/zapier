import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Sparkles, MoreHorizontal, Pencil, Trash2, Shapes, ExternalLink } from 'lucide-react';
import api from '../../lib/api.js';
import { useFetch, useToast, useDialog } from '../../lib/context.jsx';
import { Button, PageHeader, EmptyState, Loading, ErrorState, Modal, Field, Input, Textarea, Menu, Callout, SearchInput } from '../../components/ui.jsx';
import { timeAgo, plural } from '../../lib/util.js';
import './canvas.css';

const EXAMPLES = [
  'A lead fills in the website form. Then we check whether they are a good fit? Then sales books a demo call. Then send a welcome email. Then save the deal to the CRM table.',
  'An employee submits an expense. Then a manager reviews it. Is it over $500? Then finance approves the payment. Then notify the employee on Slack.',
  'A support ticket arrives. Then classify the urgency with AI. Is it urgent? Then page the on-call engineer. Then send the customer an update.',
];

export default function CanvasList() {
  const nav = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const { data, error, loading, reload, setData } = useFetch('canvases');
  const [q, setQ] = useState('');
  const [aiOpen, setAiOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const createBlank = async () => {
    setCreating(true);
    try { const { id } = await api.post('canvases', { name: 'Untitled canvas' }); nav(`/canvas/${id}`); }
    catch (e) { toast.error(e.message); } finally { setCreating(false); }
  };
  const rename = async (c) => {
    const name = await dialog.prompt({ title: 'Rename canvas', label: 'Name', defaultValue: c.name });
    if (!name?.trim()) return;
    try { await api.put(`canvases/${c.id}`, { name: name.trim() }); setData((d) => d.map((x) => (x.id === c.id ? { ...x, name: name.trim() } : x))); toast.success('Canvas renamed'); }
    catch (e) { toast.error(e.message); }
  };
  const remove = async (c) => {
    if (!(await dialog.confirm({ title: 'Delete canvas?', message: `“${c.name}” will be permanently deleted. Linked flows are not affected.`, danger: true, confirmText: 'Delete' }))) return;
    try { await api.del(`canvases/${c.id}`); setData((d) => d.filter((x) => x.id !== c.id)); toast.success('Canvas deleted'); }
    catch (e) { toast.error(e.message); }
  };

  const list = (data || []).filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="page">
      <PageHeader title="Canvas" description="Map your business processes visually, then turn each step into an automated flow."
        actions={<>
          <Button icon={Sparkles} onClick={() => setAiOpen(true)}>Generate with AI</Button>
          <Button variant="primary" icon={Plus} loading={creating} onClick={createBlank}>New canvas</Button>
        </>} />
      {loading && !data ? <Loading /> : error ? <ErrorState error={error} onRetry={reload} /> : !data.length ? (
        <div className="card"><EmptyState icon={Shapes} title="No canvases yet" action={<div className="row wrap" style={{ justifyContent: 'center' }}>
          <Button icon={Sparkles} onClick={() => setAiOpen(true)}>Generate with AI</Button><Button variant="primary" icon={Plus} onClick={createBlank}>New canvas</Button></div>}>
          Sketch how work moves through your team — manual steps, decisions and automated flows — on one shared diagram.
        </EmptyState></div>
      ) : (
        <>
          <div className="toolbar"><SearchInput value={q} onChange={setQ} placeholder="Search canvases…" style={{ width: 300, maxWidth: '100%' }} /></div>
          {!list.length ? <div className="card"><EmptyState title="No matches">No canvas matches “{q}”.</EmptyState></div> : (
            <div className="grid-auto">
              {list.map((c) => (
                <div key={c.id} className="card card-hover cv-card" onClick={() => nav(`/canvas/${c.id}`)} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && nav(`/canvas/${c.id}`)}>
                  <div className="cv-thumb"><CanvasThumb count={c.nodes} /></div>
                  <div className="row between" style={{ padding: '12px 14px' }}>
                    <div className="grow">
                      <div className="bold truncate">{c.name}</div>
                      <div className="tiny subtle">{plural(c.nodes, 'step')} · updated {timeAgo(c.updated_at)}</div>
                    </div>
                    <Menu trigger={<Button variant="ghost" size="sm" icon={MoreHorizontal} aria-label="Canvas actions" />} items={[
                      { label: 'Open', icon: ExternalLink, onClick: () => nav(`/canvas/${c.id}`) },
                      { label: 'Rename', icon: Pencil, onClick: () => rename(c) },
                      { divider: true },
                      { label: 'Delete', icon: Trash2, danger: true, onClick: () => remove(c) },
                    ]} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {aiOpen && <GenerateModal onClose={() => setAiOpen(false)} onCreated={(id) => nav(`/canvas/${id}`)} />}
    </div>
  );
}

function CanvasThumb({ count }) {
  const n = Math.max(1, Math.min(5, count || 1));
  const pts = Array.from({ length: n }, (_, i) => ({ x: n === 1 ? 100 : 30 + (i * 140) / (n - 1), y: i % 2 ? 56 : 30 }));
  return (
    <svg viewBox="0 0 200 90" width="100%" height="100%" aria-hidden="true">
      {pts.slice(1).map((p, i) => <line key={`l${i}`} x1={pts[i].x} y1={pts[i].y + 7} x2={p.x} y2={p.y + 7} stroke="var(--border-strong)" strokeWidth="1.5" />)}
      {pts.map((p, i) => (
        <rect key={i} x={p.x - 16} y={p.y} width="32" height="14" rx={i === 0 || (i === n - 1 && n > 1) ? 7 : 3}
          fill={i === 0 ? 'var(--success)' : i === n - 1 ? 'var(--text-3)' : i % 2 ? 'var(--brand)' : 'var(--surface)'} stroke="var(--border-strong)" />
      ))}
    </svg>
  );
}

function GenerateModal({ onClose, onCreated }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    if (desc.trim().length < 10) return setErr('Describe the process in a sentence or two.');
    setBusy(true); setErr('');
    try { const { id } = await api.post('canvases', { name: name.trim() || 'AI-generated process', description: desc.trim() }); toast.success('Canvas generated'); onCreated(id); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Generate a canvas with AI" subtitle="Describe a process step by step. OneTier maps it into a diagram you can refine and automate." onClose={onClose} size="lg"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={Sparkles} loading={busy} onClick={submit}>Generate canvas</Button></>}>
      <Field label="Canvas name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lead intake" /></Field>
      <Field label="Process description" required help="Tip: separate steps with “then” or new lines. Questions become decision nodes.">
        <Textarea rows={6} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="A customer submits an order. Then we check stock. Is it in stock? Then ship it and email the customer." />
      </Field>
      <div className="col" style={{ gap: 6 }}>
        <span className="tiny subtle bold">TRY AN EXAMPLE</span>
        {EXAMPLES.map((ex) => <button key={ex} type="button" className="cv-example" onClick={() => setDesc(ex)}>{ex}</button>)}
      </div>
      {err && <div className="mt-16"><Callout type="danger">{err}</Callout></div>}
    </Modal>
  );
}
