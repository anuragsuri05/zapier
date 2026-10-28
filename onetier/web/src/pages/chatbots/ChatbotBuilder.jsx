import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Save, Upload, Plus, X, Trash2, Globe, ExternalLink, RotateCcw, MessageSquare, Settings, Palette, Share2, Inbox, Zap, Bot, UserCheck,
} from 'lucide-react';
import api from '../../lib/api.js';
import { useFetch, useToast, useDialog } from '../../lib/context.jsx';
import { clone, fmtDate, timeAgo, plural } from '../../lib/util.js';
import {
  Button, Field, Input, Textarea, Select, Toggle, Tabs, Segmented, Badge, EmptyState, Loading, ErrorState, Callout, CopyField, CopyButton,
} from '../../components/ui.jsx';
import ChatWidget, { ActionMarkers, Avatar as BotAvatar, contrastText } from './ChatWidget.jsx';
import { readFileText } from '../tables/fieldTypes.js';
import './chatbots.css';

const MODELS = [
  { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — fastest' },
  { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — balanced' },
  { value: 'claude-opus-5-5', label: 'Claude Opus 5.5 — most capable' },
];
const EMOJIS = ['💬', '🤖', '👋', '✨', '🧠', '🛟', '🎧', '🛍️', '📚', '🦊', '🌱', '⚡'];
const COLORS = ['#5B3DF5', '#1971C2', '#0CA678', '#E64980', '#F76707', '#212529'];

function Configure({ config, set, tables, flows }) {
  const toast = useToast();
  const upload = async (file) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error('That file is larger than 2 MB.'); return; }
    try {
      const text = (await readFileText(file)).trim();
      set({ knowledge: [config.knowledge?.trim(), `# ${file.name}\n${text}`].filter(Boolean).join('\n\n') });
      toast.success(`Added ${file.name} to the knowledge base`);
    } catch (e) { toast.error(e.message); }
  };
  const suggested = config.suggested || [];
  const actions = config.flowActions || [];
  const setAction = (i, patch) => set({ flowActions: actions.map((a, k) => (k === i ? { ...a, ...patch } : a)) });
  return (
    <div className="col gap-16">
      <Field label="Greeting" help="The first message visitors see.">
        <Textarea rows={2} value={config.greeting || ''} onChange={(e) => set({ greeting: e.target.value })} />
      </Field>
      <Field label="Instructions" help="How the chatbot should behave — tone, what to answer, what to avoid.">
        <Textarea rows={4} value={config.instructions || ''} onChange={(e) => set({ instructions: e.target.value })} />
      </Field>
      <Field label="Knowledge" help={`Facts, FAQs and docs the chatbot answers from. ${(config.knowledge || '').length.toLocaleString()} characters.`}
        right={<label className="btn btn-ghost btn-xs" style={{ cursor: 'pointer' }}><Upload />Upload .txt/.md<input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} /></label>}>
        <Textarea rows={8} value={config.knowledge || ''} placeholder={'Our support hours are 9am–6pm, Monday to Friday.\nRefunds are available within 30 days.'} onChange={(e) => set({ knowledge: e.target.value })} />
      </Field>
      <Field label="Model" help="Public visitors need an Anthropic or OpenAI API key (Settings → AI); otherwise the bot answers by matching your knowledge text. Previews here can also use your Claude/ChatGPT account.">
        <Select value={config.model || 'claude-haiku-5-5'} options={MODELS} onChange={(e) => set({ model: e.target.value })} />
      </Field>
      <Field label="Suggested questions" help="Shown as quick-reply chips before the visitor's first message.">
        {suggested.map((s, i) => (
          <div key={i} className="cbb-list-row">
            <Input value={s} placeholder="e.g. What plans do you offer?" onChange={(e) => set({ suggested: suggested.map((x, k) => (k === i ? e.target.value : x)) })} />
            <Button variant="ghost" size="sm" icon={X} aria-label="Remove question" onClick={() => set({ suggested: suggested.filter((_, k) => k !== i) })} />
          </div>
        ))}
        <div><Button size="xs" variant="ghost" icon={Plus} disabled={suggested.length >= 6} onClick={() => set({ suggested: [...suggested, ''] })}>Add question</Button></div>
      </Field>
      <hr style={{ margin: 0 }} />
      <div className="col">
        <Toggle checked={config.leadCapture} onChange={(v) => set({ leadCapture: v })} label={<span className="bold">Lead capture</span>} />
        <p className="small muted">When a visitor shares their email, save them as a lead and trigger “New lead” flows.</p>
        {config.leadCapture && (
          <Field label="Save leads to table" help="Leads are saved with Name, Email, Notes and Status fields when they exist.">
            <Select value={config.leadTableId || ''} placeholder="Don't save to a table" options={tables} onChange={(e) => set({ leadTableId: e.target.value })} />
          </Field>
        )}
      </div>
      <hr style={{ margin: 0 }} />
      <Field label="Actions" help="Flows the chatbot can run during a conversation (requires AI to be configured). Describe when to use each one.">
        {actions.map((a, i) => (
          <div key={i} className="cbb-action">
            <div className="row">
              <Select value={a.flowId || ''} placeholder="Choose a flow" options={flows} onChange={(e) => setAction(i, { flowId: e.target.value, name: a.name || flows.find((f) => f.value === e.target.value)?.label || '' })} />
              <Button variant="ghost" size="sm" icon={Trash2} aria-label="Remove action" onClick={() => set({ flowActions: actions.filter((_, k) => k !== i) })} />
            </div>
            <Input value={a.name || ''} placeholder="Action name, e.g. Book a demo" onChange={(e) => setAction(i, { name: e.target.value })} />
            <Textarea rows={2} value={a.description || ''} placeholder="When should the chatbot run this? e.g. When the visitor wants to book a demo." onChange={(e) => setAction(i, { description: e.target.value })} />
          </div>
        ))}
        <div className="row">
          <Button size="xs" variant="ghost" icon={Plus} onClick={() => set({ flowActions: [...actions, { flowId: '', name: '', description: '' }] })}>Add action</Button>
          {!flows.length && <span className="tiny subtle"><Link to="/flows">Create a flow</Link> first.</span>}
        </div>
      </Field>
    </div>
  );
}

function Appearance({ config, set }) {
  const theme = config.theme || {};
  const setTheme = (patch) => set({ theme: { ...theme, ...patch } });
  const valid = /^#[0-9a-f]{6}$/i.test(theme.primary || '');
  return (
    <div className="col gap-16">
      <Field label="Primary colour">
        <div className="cbb-color">
          <input type="color" value={valid ? theme.primary : '#5B3DF5'} onChange={(e) => setTheme({ primary: e.target.value })} aria-label="Pick colour" />
          <Input value={theme.primary || ''} onChange={(e) => setTheme({ primary: e.target.value })} style={{ width: 120 }} invalid={!valid} />
          <div className="row gap-4">{COLORS.map((c) => <button key={c} type="button" aria-label={c} onClick={() => setTheme({ primary: c })} style={{ width: 22, height: 22, borderRadius: 6, background: c, border: theme.primary === c ? '2px solid var(--text)' : '1px solid var(--border)', cursor: 'pointer' }} />)}</div>
        </div>
      </Field>
      <Field label="Avatar" help="Any emoji works — type one in the box.">
        <div className="row wrap">
          <Input value={theme.avatar || ''} maxLength={4} onChange={(e) => setTheme({ avatar: e.target.value })} style={{ width: 64, textAlign: 'center', fontSize: 18 }} aria-label="Avatar emoji" />
          <div className="cbb-emoji">{EMOJIS.map((e) => <button key={e} type="button" className={theme.avatar === e ? 'on' : ''} onClick={() => setTheme({ avatar: e })}>{e}</button>)}</div>
        </div>
      </Field>
      <Field label="Widget position" help="Where the embedded widget sits on your site.">
        <Segmented value={theme.position || 'right'} onChange={(v) => setTheme({ position: v })} options={[{ value: 'left', label: 'Bottom left' }, { value: 'right', label: 'Bottom right' }]} />
      </Field>
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="row" style={{ padding: 12, background: valid ? theme.primary : '#5B3DF5', color: contrastText(valid ? theme.primary : '#5B3DF5') }}>
          <BotAvatar theme={theme} size={34} /><b>Header preview</b>
        </div>
      </div>
    </div>
  );
}

function Share({ bot, togglePublish, publishing }) {
  const origin = window.location.origin;
  const link = `${origin}/c/${bot.slug}`;
  const side = (bot.config.theme?.position || 'right') === 'left' ? 'left' : 'right';
  const snippet = `<iframe src="${origin}/embed/chatbot/${bot.slug}" title="${bot.name.replace(/"/g, '&quot;')}" allow="clipboard-write"\n  style="position:fixed;bottom:20px;${side}:20px;width:380px;height:600px;max-width:calc(100vw - 40px);max-height:calc(100vh - 40px);border:0;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.18);z-index:2147483000"></iframe>`;
  return (
    <div className="col gap-16">
      <div className="card card-pad row between wrap">
        <div>
          <div className="row"><b>Published</b>{bot.published ? <Badge color="green" dot>Live</Badge> : <Badge dot>Draft</Badge>}</div>
          <p className="small muted mt-8">{bot.published ? 'Anyone with the link can chat with this bot.' : 'Publish to make the link and embed work.'}</p>
        </div>
        <Toggle checked={bot.published} disabled={publishing} onChange={togglePublish} />
      </div>
      <Field label="Public link">
        <CopyField value={link} />
        <div className="mt-8"><Button size="sm" icon={ExternalLink} disabled={!bot.published} onClick={() => window.open(link, '_blank', 'noopener')}>Open public page</Button></div>
      </Field>
      <Field label="Embed on your website" help="Paste before the closing </body> tag.">
        <div className="cbb-snippet">{snippet}</div>
        <div className="mt-8"><CopyButton text={snippet} label="Copy embed code" /></div>
      </Field>
      {!bot.published && <Callout type="warning">The link and embed show “unavailable” until the chatbot is published.</Callout>}
    </div>
  );
}

function Conversations({ botId, theme }) {
  const { data, error, loading, reload } = useFetch(`chatbots/${botId}/conversations`);
  const [sel, setSel] = useState(null);
  useEffect(() => { if (data?.length && !sel) setSel(data[0].id); }, [data, sel]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data.length) return <EmptyState icon={Inbox} title="No conversations yet">Conversations from the public page, embeds and the preview appear here.</EmptyState>;
  const conv = data.find((c) => c.id === sel);
  const firstUser = (c) => c.messages.find((m) => m.role === 'user')?.content || 'No messages yet';
  const hasLead = (c) => c.messages.some((m) => m.actions?.some((a) => a.type === 'lead'));
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="card-header" style={{ padding: '10px 14px' }}><span className="small muted">{plural(data.length, 'conversation')}</span><Button size="xs" variant="ghost" icon={RotateCcw} onClick={reload}>Refresh</Button></div>
      <div className="cbb-conv">
        <div className="cbb-conv-list">
          {data.map((c) => (
            <div key={c.id} className={`cbb-conv-item ${c.id === sel ? 'on' : ''}`} onClick={() => setSel(c.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSel(c.id)}>
              <div className="row between"><span className="small bold truncate">{c.visitor}</span><span className="tiny subtle nowrap">{timeAgo(c.updated_at)}</span></div>
              <div className="tiny muted truncate">{firstUser(c)}</div>
              <div className="row gap-4 mt-8" style={{ marginTop: 4 }}>
                <Badge>{plural(c.messages.filter((m) => m.role === 'user').length, 'message')}</Badge>
                {hasLead(c) && <Badge color="green"><UserCheck />Lead</Badge>}
              </div>
            </div>
          ))}
        </div>
        <div className="cbb-transcript" style={{ '--cw-primary': theme?.primary || '#5B3DF5', '--cw-on-primary': contrastText(theme?.primary) }}>
          {conv ? (
            <>
              <div className="tiny subtle center">Started {fmtDate(conv.created_at)} · {conv.visitor}</div>
              {conv.messages.map((m, i) => (
                <div key={i} className={`cw-row ${m.role === 'user' ? 'me' : ''}`}>
                  {m.role !== 'user' && <BotAvatar theme={theme} size={24} />}
                  <div className="cw-bubble-wrap">
                    <div className="cw-bubble">{m.content}</div>
                    <ActionMarkers actions={m.actions} />
                    {m.at && <span className="tiny subtle">{fmtDate(m.at)}</span>}
                  </div>
                </div>
              ))}
            </>
          ) : <span className="muted">Select a conversation.</span>}
        </div>
      </div>
    </div>
  );
}

export default function ChatbotBuilder() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const [bot, setBot] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState('');
  const [config, setConfig] = useState(null);
  const [tab, setTab] = useState('configure');
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const tablesOpt = useFetch('dynamic/tables');
  const flowsOpt = useFetch('dynamic/flows');

  const load = useCallback(async () => {
    try { const b = await api.get(`chatbots/${id}`); setBot(b); setName(b.name); setConfig(clone(b.config)); setError(null); }
    catch (e) { setError(e); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(() => bot && config && (name !== bot.name || JSON.stringify(config) !== JSON.stringify(bot.config)), [bot, config, name]);
  useEffect(() => {
    if (!dirty) return undefined;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const set = (patch) => setConfig((c) => ({ ...c, ...patch }));
  const save = useCallback(async () => {
    if (!name.trim()) { toast.error('The chatbot needs a name.'); return; }
    const cfg = { ...config, suggested: (config.suggested || []).map((s) => s.trim()).filter(Boolean), flowActions: (config.flowActions || []).filter((a) => a.flowId) };
    if (cfg.theme?.primary && !/^#[0-9a-f]{6}$/i.test(cfg.theme.primary)) { toast.error('Primary colour must be a hex value like #5B3DF5.'); return; }
    setSaving(true);
    try {
      const b = await api.put(`chatbots/${id}`, { name: name.trim(), config: cfg });
      setBot(b); setName(b.name); setConfig(clone(b.config));
      toast.success('Chatbot saved');
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }, [config, id, name, toast]);
  useEffect(() => {
    const h = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (dirty && !saving) save(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [dirty, saving, save]);

  const togglePublish = async (v) => {
    setPublishing(true);
    try { const b = await api.put(`chatbots/${id}`, { published: v }); setBot((x) => ({ ...x, published: b.published })); toast.success(b.published ? 'Chatbot published' : 'Chatbot unpublished'); }
    catch (e) { toast.error(e.message); }
    finally { setPublishing(false); }
  };
  const back = async () => {
    if (dirty && !(await dialog.confirm({ title: 'Discard unsaved changes?', message: 'You have changes that have not been saved.', danger: true, confirmText: 'Discard' }))) return;
    nav('/chatbots');
  };

  if (error) {
    return <div className="page">{error.status === 404
      ? <div className="card"><EmptyState icon={Bot} title="Chatbot not found" action={<Button onClick={() => nav('/chatbots')}>Back to chatbots</Button>}>It may have been deleted.</EmptyState></div>
      : <ErrorState error={error} onRetry={load} />}</div>;
  }
  if (!bot || !config) return <div className="page"><Loading /></div>;

  const send = (message, conversationId) => api.post(`chatbots/${id}/preview`, { conversationId: conversationId || undefined, message });

  return (
    <div className="page page-wide" style={{ maxWidth: 1400 }}>
      <div className="row wrap mb-16" style={{ gap: 10 }}>
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={back} aria-label="Back to chatbots" />
        <BotAvatar theme={config.theme} size={34} />
        <input className="inline-title" style={{ fontSize: 20, fontWeight: 700 }} value={name} aria-label="Chatbot name" onChange={(e) => setName(e.target.value)} />
        {bot.published ? <Badge color="green" dot>Published</Badge> : <Badge dot>Draft</Badge>}
        <div className="grow" />
        {dirty ? <span className="small" style={{ color: 'var(--warning)' }}>● Unsaved changes</span> : <span className="small subtle">All changes saved</span>}
        {bot.published && <Button icon={ExternalLink} onClick={() => window.open(`/c/${bot.slug}`, '_blank', 'noopener')}>Open</Button>}
        <Button icon={Globe} onClick={() => togglePublish(!bot.published)} loading={publishing}>{bot.published ? 'Unpublish' : 'Publish'}</Button>
        <Button variant="primary" icon={Save} loading={saving} disabled={!dirty} onClick={save}>Save</Button>
      </div>
      <div className="cbb">
        <div className="card">
          <div style={{ padding: '4px 16px 0' }}>
            <Tabs value={tab} onChange={setTab} tabs={[
              { value: 'configure', label: 'Configure', icon: Settings },
              { value: 'appearance', label: 'Appearance', icon: Palette },
              { value: 'share', label: 'Share', icon: Share2 },
              { value: 'conversations', label: 'Conversations', icon: MessageSquare, count: bot.conversations },
            ]} />
          </div>
          <div style={{ padding: '0 20px 20px' }}>
            {tab === 'configure' && <Configure config={config} set={set} tables={tablesOpt.data || []} flows={flowsOpt.data || []} />}
            {tab === 'appearance' && <Appearance config={config} set={set} />}
            {tab === 'share' && <Share bot={bot} togglePublish={togglePublish} publishing={publishing} />}
            {tab === 'conversations' && <Conversations botId={id} theme={config.theme} />}
          </div>
        </div>
        <div className="cbb-preview">
          <div className="cbb-preview-head">
            <Zap size={14} /><span className="grow">Live preview{dirty ? ' · save to apply your latest changes' : ''}</span>
            <Button size="xs" variant="ghost" icon={RotateCcw} onClick={() => setPreviewKey((k) => k + 1)}>Reset conversation</Button>
          </div>
          <ChatWidget key={previewKey} name={name || 'Chatbot'} greeting={config.greeting} suggested={(config.suggested || []).filter((s) => s.trim())}
            theme={config.theme} send={send} subtitle="Preview · conversations are logged as “Preview”" />
        </div>
      </div>
    </div>
  );
}
