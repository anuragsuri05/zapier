import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, MoreHorizontal, Pencil, Copy, Globe, EyeOff, Trash2, LayoutTemplate, ExternalLink, Inbox, Clock, FileText, Square } from 'lucide-react';
import api from '../../lib/api.js';
import { useFetch, useToast, useDialog } from '../../lib/context.jsx';
import { timeAgo, plural, copyText } from '../../lib/util.js';
import { Button, Field, Input, Modal, Menu, EmptyState, Loading, ErrorState, PageHeader, Badge, Callout } from '../../components/ui.jsx';
import './interfaces.css';

function CreateModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e?.preventDefault();
    if (!name.trim()) { setError('Give the page a name.'); return; }
    setBusy(true);
    try { const { id } = await api.post('interfaces', { name: name.trim(), kind }); onCreated(id); }
    catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Modal title="Create an interface" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Create</Button></>}>
      <form onSubmit={submit} className="col gap-16">
        <Field label="Name" required error={error && !/plan/i.test(error) ? error : undefined}>
          <Input autoFocus value={name} placeholder="e.g. Customer intake form" onChange={(e) => { setName(e.target.value); setError(''); }} />
        </Field>
        <Field label="Start with">
          <div className="grid-2" style={{ gap: 10 }}>
            <button type="button" className={`il-kind ${kind === 'form' ? 'on' : ''}`} onClick={() => setKind('form')} aria-pressed={kind === 'form'}>
              <FileText /><b>Form</b><span className="small muted">A heading, intro text and a ready-to-use contact form.</span>
            </button>
            <button type="button" className={`il-kind ${kind === 'blank' ? 'on' : ''}`} onClick={() => setKind('blank')} aria-pressed={kind === 'blank'}>
              <Square /><b>Blank page</b><span className="small muted">Just a heading — add tables, buttons and chatbots.</span>
            </button>
          </div>
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export default function InterfacesList() {
  const nav = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const { data, error, loading, reload, setData } = useFetch('interfaces');
  const [creating, setCreating] = useState(false);
  const url = (i) => `${window.location.origin}/p/${i.slug}`;

  const duplicate = async (i) => {
    try { await api.post(`interfaces/${i.id}/duplicate`, {}); toast.success(`Duplicated “${i.name}”`); reload(); } catch (e) { toast.error(e.message); }
  };
  const togglePublish = async (i) => {
    try {
      const r = await api.put(`interfaces/${i.id}`, { published: !i.published });
      setData((xs) => xs.map((x) => (x.id === i.id ? { ...x, published: r.published } : x)));
      toast.success(r.published ? `“${i.name}” is live` : `“${i.name}” unpublished`);
    } catch (e) { toast.error(e.message); }
  };
  const remove = async (i) => {
    const ok = await dialog.confirm({ title: `Delete “${i.name}”?`, message: `The page and its ${plural(i.submissions, 'submission')} will be deleted, and its public link will stop working.`, danger: true, confirmText: 'Delete interface' });
    if (!ok) return;
    try { await api.del(`interfaces/${i.id}`); toast.success('Interface deleted'); reload(); } catch (e) { toast.error(e.message); }
  };

  return (
    <div className="page">
      <PageHeader title="Interfaces" description="Build forms, portals and internal tools that feed your tables and trigger flows."
        actions={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>New interface</Button>} />
      {loading && !data ? <Loading /> : error ? <ErrorState error={error} onRetry={reload} /> : !data.length ? (
        <div className="card"><EmptyState icon={LayoutTemplate} title="No interfaces yet" action={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Create an interface</Button>}>
          Interfaces are pages with forms, tables, buttons and chatbots that anyone with the link can use.
        </EmptyState></div>
      ) : (
        <div className="grid-auto">
          {data.map((i) => (
            <div key={i.id} className="card card-hover il-card" role="link" tabIndex={0} onClick={() => nav(`/interfaces/${i.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/interfaces/${i.id}`)}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <span className="il-icon"><LayoutTemplate /></span>
                <div className="grow">
                  <h3 className="truncate">{i.name}</h3>
                  <div className="mt-8">{i.published ? <Badge color="green" dot>Published</Badge> : <Badge color="yellow" dot>Draft</Badge>}</div>
                </div>
                <Menu trigger={<Button variant="ghost" size="sm" icon={MoreHorizontal} aria-label="Interface actions" />} items={[
                  { label: 'Edit', icon: Pencil, onClick: () => nav(`/interfaces/${i.id}`) },
                  { label: 'Duplicate', icon: Copy, onClick: () => duplicate(i) },
                  { label: i.published ? 'Unpublish' : 'Publish', icon: i.published ? EyeOff : Globe, onClick: () => togglePublish(i) },
                  { divider: true },
                  { label: 'Delete', icon: Trash2, danger: true, onClick: () => remove(i) },
                ]} />
              </div>
              <div className="il-url" onClick={(e) => e.stopPropagation()}>
                <span title={url(i)}>/p/{i.slug}</span>
                <Button size="xs" variant="ghost" icon={ExternalLink} aria-label="Open public page" title={i.published ? 'Open public page' : 'Publish to open the public page'}
                  disabled={!i.published} onClick={() => window.open(url(i), '_blank', 'noopener')} />
                <Button size="xs" variant="ghost" icon={Copy} aria-label="Copy link" onClick={async () => { await copyText(url(i)); toast.success('Link copied'); }} />
              </div>
              <div className="il-meta">
                <span><Inbox />{plural(i.submissions, 'submission')}</span>
                <span><Clock />Updated {timeAgo(i.updated_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {creating && <CreateModal onClose={() => setCreating(false)} onCreated={(id) => nav(`/interfaces/${id}`)} />}
    </div>
  );
}
