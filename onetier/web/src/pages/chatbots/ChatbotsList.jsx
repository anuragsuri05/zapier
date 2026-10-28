import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, MoreHorizontal, ExternalLink, Globe, EyeOff, Trash2, Bot, MessageSquare, Clock, Pencil } from 'lucide-react';
import api from '../../lib/api.js';
import { useFetch, useToast, useDialog } from '../../lib/context.jsx';
import { timeAgo, plural } from '../../lib/util.js';
import { Button, Field, Input, Modal, Menu, EmptyState, Loading, ErrorState, PageHeader, Badge, Callout } from '../../components/ui.jsx';
import { Avatar as BotAvatar } from './ChatWidget.jsx';
import './chatbots.css';

function CreateModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e?.preventDefault();
    if (!name.trim()) { setError('Give the chatbot a name.'); return; }
    setBusy(true);
    try { const { id } = await api.post('chatbots', { name: name.trim() }); onCreated(id); }
    catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Modal title="Create a chatbot" size="sm" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Create</Button></>}>
      <form onSubmit={submit}>
        <Field label="Name" required error={error}><Input autoFocus value={name} invalid={Boolean(error)} placeholder="e.g. Support assistant" onChange={(e) => { setName(e.target.value); setError(''); }} /></Field>
      </form>
    </Modal>
  );
}

export default function ChatbotsList() {
  const nav = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const { data, error, loading, reload, setData } = useFetch('chatbots');
  const [creating, setCreating] = useState(false);

  const togglePublish = async (b) => {
    try {
      const r = await api.put(`chatbots/${b.id}`, { published: !b.published });
      setData((xs) => xs.map((x) => (x.id === b.id ? { ...x, published: r.published } : x)));
      toast.success(r.published ? `“${b.name}” is live` : `“${b.name}” unpublished`);
    } catch (e) { toast.error(e.message); }
  };
  const rename = async (b) => {
    const name = await dialog.prompt({ title: 'Rename chatbot', label: 'Name', defaultValue: b.name, confirmText: 'Rename' });
    if (!name?.trim() || name.trim() === b.name) return;
    try { await api.put(`chatbots/${b.id}`, { name: name.trim() }); reload(); toast.success('Chatbot renamed'); } catch (e) { toast.error(e.message); }
  };
  const remove = async (b) => {
    const ok = await dialog.confirm({ title: `Delete “${b.name}”?`, message: `The chatbot and its ${plural(b.conversations, 'conversation')} will be deleted. Embedded widgets will stop working.`, danger: true, confirmText: 'Delete chatbot' });
    if (!ok) return;
    try { await api.del(`chatbots/${b.id}`); toast.success('Chatbot deleted'); reload(); } catch (e) { toast.error(e.message); }
  };

  return (
    <div className="page">
      <PageHeader title="Chatbots" description="AI chatbots trained on your knowledge that capture leads and run your flows."
        actions={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>New chatbot</Button>} />
      {loading && !data ? <Loading /> : error ? <ErrorState error={error} onRetry={reload} /> : !data.length ? (
        <div className="card"><EmptyState icon={Bot} title="No chatbots yet" action={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Create a chatbot</Button>}>
          Give a chatbot your FAQs and docs, then share a link or embed it on your site.
        </EmptyState></div>
      ) : (
        <div className="grid-auto">
          {data.map((b) => (
            <div key={b.id} className="card card-hover cb-card" role="link" tabIndex={0} onClick={() => nav(`/chatbots/${b.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/chatbots/${b.id}`)}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <BotAvatar theme={b.config?.theme} size={40} />
                <div className="grow">
                  <h3 className="truncate">{b.name}</h3>
                  <div className="mt-8">{b.published ? <Badge color="green" dot>Published</Badge> : <Badge dot>Draft</Badge>}</div>
                </div>
                <Menu trigger={<Button variant="ghost" size="sm" icon={MoreHorizontal} aria-label="Chatbot actions" />} items={[
                  { label: 'Open', icon: ExternalLink, onClick: () => nav(`/chatbots/${b.id}`) },
                  { label: 'Rename', icon: Pencil, onClick: () => rename(b) },
                  b.published && { label: 'View public page', icon: Globe, onClick: () => window.open(`/c/${b.slug}`, '_blank', 'noopener') },
                  { label: b.published ? 'Unpublish' : 'Publish', icon: b.published ? EyeOff : Globe, onClick: () => togglePublish(b) },
                  { divider: true },
                  { label: 'Delete', icon: Trash2, danger: true, onClick: () => remove(b) },
                ]} />
              </div>
              <p className="muted small" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{b.config?.greeting || 'No greeting'}</p>
              <div className="meta">
                <span><MessageSquare />{plural(b.conversations, 'conversation')}</span>
                <span><Clock />Updated {timeAgo(b.updated_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {creating && <CreateModal onClose={() => setCreating(false)} onCreated={(id) => nav(`/chatbots/${id}`)} />}
    </div>
  );
}
