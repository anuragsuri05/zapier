import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Inbox as InboxIcon, Mail, MailOpen, RefreshCw, Trash2, ArrowLeft, ExternalLink, Send, Server } from 'lucide-react';
import api from '../lib/api.js';
import { useToast, useDialog, useFetch } from '../lib/context.jsx';
import { timeAgo } from '../lib/util.js';
import { Button, PageHeader, SearchInput, Loading, ErrorState, EmptyState, Avatar, Badge } from '../components/ui.jsx';
import './settings/settings.css';

const stripHtml = (html = '') => html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const snippet = (m) => (m.html ? stripHtml(m.body) : String(m.body || '').replace(/\s+/g, ' ').trim()).slice(0, 160);
const FRAME_CSS = '<style>html,body{margin:0;padding:16px 20px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.55;color:#16151f;background:#fff;word-wrap:break-word}img{max-width:100%;height:auto}table{max-width:100%}</style>';

export default function Inbox() {
  const toast = useToast();
  const dialog = useDialog();
  const [params, setParams] = useSearchParams();
  const { data, error, loading, reload, setData } = useFetch('mailbox');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const selectedId = params.get('m');

  const mails = useMemo(() => (data || []).filter((m) => {
    if (filter === 'unread' && m.read) return false;
    if (!q) return true;
    const n = q.toLowerCase();
    return [m.subject, m.to_addr, m.from_name, m.html ? stripHtml(m.body) : m.body].some((v) => String(v || '').toLowerCase().includes(n));
  }), [data, q, filter]);
  const selected = (data || []).find((m) => m.id === selectedId) || null;
  const unread = (data || []).filter((m) => !m.read).length;

  const open = async (m) => {
    setParams((p) => { const x = new URLSearchParams(p); x.set('m', m.id); return x; }, { replace: Boolean(selectedId) });
    if (!m.read) {
      setData((list) => list.map((x) => (x.id === m.id ? { ...x, read: 1 } : x)));
      try { await api.post(`mailbox/${m.id}/read`); } catch { /* non-critical */ }
    }
  };
  const close = () => setParams((p) => { const x = new URLSearchParams(p); x.delete('m'); return x; });
  const remove = async (m) => {
    if (!await dialog.confirm({ title: 'Delete this email?', message: `“${m.subject || '(no subject)'}” will be removed from the OneTier Inbox.`, danger: true, confirmText: 'Delete' })) return;
    try {
      await api.del(`mailbox/${m.id}`);
      const idx = mails.findIndex((x) => x.id === m.id);
      const next = mails[idx + 1] || mails[idx - 1];
      setData((list) => list.filter((x) => x.id !== m.id));
      if (next && window.innerWidth > 900) open(next); else close();
      toast.success('Email deleted');
    } catch (err) { toast.error(err.message); }
  };
  const clearAll = async () => {
    if (!await dialog.confirm({ title: 'Clear the inbox?', message: `All ${data.length} email${data.length === 1 ? '' : 's'} will be permanently deleted.`, danger: true, confirmText: 'Clear inbox' })) return;
    try { await api.del('mailbox'); setData([]); close(); toast.success('Inbox cleared'); } catch (err) { toast.error(err.message); }
  };

  return (
    <div className="page page-wide" style={{ maxWidth: 1400 }}>
      <PageHeader title="OneTier Inbox"
        description="Emails sent by “Email by OneTier” steps land here when no SMTP connection is set up."
        actions={<>
          <Button icon={RefreshCw} loading={loading && Boolean(data)} onClick={reload}>Refresh</Button>
          {data?.length > 0 && <Button variant="danger-ghost" icon={Trash2} onClick={clearAll}>Clear inbox</Button>}
        </>} />

      {loading && !data ? <Loading /> : error ? <ErrorState error={error} onRetry={reload} /> : data.length === 0 ? (
        <div className="card">
          <EmptyState icon={InboxIcon} title="Your inbox is empty"
            action={<div className="row wrap" style={{ justifyContent: 'center' }}><Link className="btn btn-primary" to="/flows"><Send />Build a flow</Link><Link className="btn btn-secondary" to="/apps/smtp"><Server />Connect SMTP</Link></div>}>
            Add an <b>Email by OneTier → Send Outbound Email</b> step to any flow. While no SMTP connection exists, messages are delivered here so you can test safely. Connect an SMTP server to send real email instead.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="toolbar">
            <SearchInput value={q} onChange={setQ} placeholder="Search mail…" style={{ flex: '1 1 240px', maxWidth: 360 }} />
            <div className="seg">
              <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All ({data.length})</button>
              <button type="button" className={filter === 'unread' ? 'active' : ''} onClick={() => setFilter('unread')}>Unread ({unread})</button>
            </div>
          </div>
          <div className={`card inbox ${selected ? 'has-selection' : ''}`}>
            <div className="inbox-list" role="listbox" aria-label="Emails">
              {mails.length === 0 ? <EmptyState icon={Mail} title="No matching emails" /> : mails.map((m) => (
                <button key={m.id} type="button" role="option" aria-selected={m.id === selectedId}
                  className={`inbox-item ${m.read ? '' : 'unread'} ${m.id === selectedId ? 'active' : ''}`} onClick={() => open(m)}>
                  <div className="row between" style={{ gap: 8 }}>
                    <span className="inbox-to truncate small">To: {m.to_addr || '(no recipient)'}</span>
                    <span className="tiny subtle nowrap" title={new Date(m.created_at).toLocaleString()}>{timeAgo(m.created_at)}</span>
                  </div>
                  <div className="inbox-subject truncate">{m.subject || '(no subject)'}</div>
                  <div className="inbox-snippet">{snippet(m) || '(empty message)'}</div>
                </button>
              ))}
            </div>
            <div className="inbox-view">
              {selected ? <MailView mail={selected} onBack={close} onDelete={() => remove(selected)} /> : (
                <EmptyState icon={MailOpen} title="Select an email">Pick a message on the left to read it.</EmptyState>
              )}
            </div>
          </div>
          <p className="small muted mt-16">Want real delivery? <Link to="/apps/smtp">Connect an SMTP server</Link> and Email by OneTier steps will send through it instead.</p>
        </>
      )}
    </div>
  );
}

function MailView({ mail, onBack, onDelete }) {
  return (
    <>
      <div className="inbox-view-head">
        <div className="row between wrap" style={{ gap: 8, marginBottom: 10 }}>
          <Button size="sm" variant="ghost" icon={ArrowLeft} className="inbox-back" onClick={onBack}>Back</Button>
          <div className="row" style={{ marginLeft: 'auto' }}>
            {mail.run_id && <Link className="btn btn-secondary btn-sm" to={`/history/${mail.run_id}`}><ExternalLink />View run</Link>}
            <Button size="sm" variant="danger-ghost" icon={Trash2} onClick={onDelete}>Delete</Button>
          </div>
        </div>
        <h2 style={{ wordBreak: 'break-word' }}>{mail.subject || '(no subject)'}</h2>
        <div className="row mt-8" style={{ gap: 10, alignItems: 'flex-start' }}>
          <Avatar name={mail.from_name || 'OneTier'} color="var(--brand)" size={34} />
          <div className="grow small">
            <div><b>{mail.from_name || 'OneTier'}</b> <span className="subtle">via OneTier</span></div>
            <div className="muted truncate">To: {mail.to_addr}</div>
          </div>
          <div className="tiny subtle nowrap">{new Date(mail.created_at).toLocaleString()}</div>
        </div>
        <div className="row mt-8"><Badge>{mail.html ? 'HTML' : 'Plain text'}</Badge><Badge color="blue">Delivered to OneTier Inbox</Badge></div>
      </div>
      <div className="inbox-view-body">
        {mail.html
          ? <iframe title={`Email: ${mail.subject || 'no subject'}`} sandbox="" srcDoc={`<!doctype html><meta charset="utf-8">${FRAME_CSS}${mail.body || ''}`} />
          : <pre>{mail.body || ''}</pre>}
      </div>
      {mail.html && <div className="tiny subtle" style={{ padding: '8px 16px', borderTop: '1px solid var(--border)' }}>HTML is shown in a sandbox — scripts, forms and links are disabled.</div>}
    </>
  );
}
