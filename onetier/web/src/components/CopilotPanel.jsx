import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { Sparkles, X, Wand2, MessageSquare, Send, ArrowRight, KeyRound, Zap, RotateCcw, Lightbulb } from 'lucide-react';
import api from '../lib/api.js';
import { useAuth, useApps, useToast } from '../lib/context.jsx';
import { Button, Tabs, Textarea, AppIcon, Badge, Spinner } from './ui.jsx';
import '../pages/core.css';

const EXAMPLES = [
  'When a form is submitted, save it to a table and email me',
  'Every morning, send a Slack message with new RSS posts',
  'When a Stripe payment comes in, post to Slack only if amount is over 100',
  'When a new GitHub issue is opened, summarize it with AI and post to Discord',
  'Catch a webhook, classify it with AI, then send a notification',
];
const SUGGESTIONS = [
  'How do I trigger a flow from a webhook?',
  'How are tasks counted?',
  'How do I branch with Paths?',
  'A run failed — how do I fix and replay it?',
  'How do I connect Claude via MCP?',
];

const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);

/** Which required fields of a step/trigger are still empty. */
function missingFields(def, params = {}) {
  return (def?.fields || []).filter((f) => f.required && f.type !== 'conditions' && isEmpty(params[f.key])).map((f) => f.label || f.key);
}

export default function CopilotPanel({ onClose }) {
  const { me } = useAuth();
  const [tab, setTab] = useState('build');
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  const aiOn = Boolean(me?.workspace?.settings?.aiConfigured);

  return createPortal(
    <>
      <div className="copilot-overlay" onMouseDown={onClose} />
      <aside className="copilot-panel" role="dialog" aria-modal="true" aria-label="Copilot">
        <div className="copilot-head">
          <span className="cp-mark"><Sparkles /></span>
          <div className="grow"><h3>Copilot</h3><div className="tiny subtle">{aiOn ? 'Powered by Claude' : 'Keyword mode'} · Esc to close</div></div>
          <Button variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Close Copilot" />
        </div>
        <div className="copilot-tabs">
          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'build', label: 'Build a flow', icon: Wand2 }, { value: 'ask', label: 'Ask', icon: MessageSquare }]} />
        </div>
        {!aiOn && (
          <div style={{ padding: '12px 16px 0' }}>
            <div className="callout callout-info" style={{ fontSize: 12.5 }}>
              <KeyRound />
              <div className="grow">AI isn't configured, so Copilot drafts flows with keyword matching and gives built-in help answers.{' '}
                <Link to="/settings/ai" onClick={onClose} className="bold">Sign in with Claude or ChatGPT, or add an API key</Link> for full AI drafting.</div>
            </div>
          </div>
        )}
        {tab === 'build' ? <BuildTab onClose={onClose} /> : <AskTab />}
      </aside>
    </>,
    document.body,
  );
}

function BuildTab({ onClose }) {
  const nav = useNavigate();
  const toast = useToast();
  const { getApp } = useApps();
  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState('');

  const valid = prompt.trim().length >= 5;
  const makeDraft = async () => {
    if (!valid) { setErr('Describe the workflow you want in a sentence or two.'); return; }
    setBusy('draft'); setErr('');
    try { setDraft(await api.post('copilot/flow', { prompt: prompt.trim() })); } catch (e) { setErr(e.message); } finally { setBusy(null); }
  };
  const create = async () => {
    if (!valid) { setErr('Describe the workflow you want in a sentence or two.'); return; }
    setBusy('create'); setErr('');
    try {
      const r = await api.post('copilot/flow', { prompt: prompt.trim(), create: true });
      toast.success(`Created “${r.name}”. Review the steps and fill in any missing fields.`);
      onClose?.();
      nav(`/flows/${r.id}`);
    } catch (e) { setErr(e.message); setBusy(null); }
  };

  const tApp = draft && getApp(draft.trigger?.app);
  const tDef = tApp?.triggers?.[draft?.trigger?.event];
  const tMissing = draft ? missingFields(tDef, draft.trigger.params) : [];
  const stepInfo = (draft?.steps || []).map((s) => {
    const app = getApp(s.app);
    const act = app?.actions?.[s.action];
    return { s, app, act, missing: missingFields(act, s.params), needsConn: Boolean(app?.auth) };
  });
  const totalMissing = tMissing.length + stepInfo.reduce((a, x) => a + x.missing.length, 0);

  return (
    <>
      <div className="copilot-body">
        <div>
          <label className="label" htmlFor="cp-prompt" style={{ marginBottom: 6, display: 'block' }}>Describe what you want to automate</label>
          <Textarea id="cp-prompt" rows={4} value={prompt} placeholder="When… then…" invalid={Boolean(err)}
            onChange={(e) => { setPrompt(e.target.value); setErr(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); makeDraft(); } }} />
          {err ? <div className="error-text">{err}</div> : <div className="help tiny subtle mt-8">Tip: mention the app that starts it and what should happen next. ⌘↵ to draft.</div>}
        </div>

        {!draft && (
          <div className="col" style={{ gap: 6 }}>
            <div className="tiny subtle bold row gap-4"><Lightbulb size={13} />Try an example</div>
            {EXAMPLES.map((ex) => <button key={ex} type="button" className="cp-example" onClick={() => { setPrompt(ex); setDraft(null); setErr(''); }}>{ex}</button>)}
          </div>
        )}

        {draft && (
          <div className="col" style={{ gap: 10 }}>
            <div className="row between"><h3 className="truncate">{draft.name}</h3><Button size="xs" variant="ghost" icon={RotateCcw} onClick={() => setDraft(null)}>Start over</Button></div>
            {draft.explanation && <p className="small muted">{draft.explanation}</p>}
            <div className="cp-step" style={{ background: 'var(--brand-50)', borderColor: 'var(--brand-100)' }}>
              <AppIcon app={tApp} size={28} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="tiny subtle row gap-4"><Zap size={11} />Trigger · {tApp?.name || draft.trigger.app}</div>
                <div className="bold small">{tDef?.name || draft.trigger.event}</div>
                {tMissing.length > 0 && <div className="cp-missing">Needs: {tMissing.join(', ')}</div>}
                {tApp?.auth && <div className="cp-missing">Connect a {tApp.name} account</div>}
              </div>
            </div>
            {stepInfo.map(({ s, app, act, missing, needsConn }, i) => (
              <div key={s.id || i} className="cp-step">
                <AppIcon app={app} size={28} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="tiny subtle">Step {i + 1} · {app?.name || s.app}</div>
                  <div className="bold small">{s.title || act?.name || s.action}</div>
                  {act && s.title && s.title !== act.name && <div className="tiny subtle">{act.name}</div>}
                  {missing.length > 0 && <div className="cp-missing">Needs: {missing.join(', ')}</div>}
                  {needsConn && <div className="cp-missing">Connect a {app.name} account</div>}
                </div>
              </div>
            ))}
            {totalMissing === 0 ? <Badge color="green">All required fields have values</Badge>
              : <Badge color="yellow">{totalMissing} field{totalMissing === 1 ? '' : 's'} still need values</Badge>}
          </div>
        )}
      </div>
      <div className="copilot-foot">
        <Button icon={Wand2} loading={busy === 'draft'} disabled={Boolean(busy) || !prompt.trim()} onClick={makeDraft}>{draft ? 'Redraft' : 'Draft'}</Button>
        <div className="grow" />
        <Button variant="primary" icon={ArrowRight} loading={busy === 'create'} disabled={Boolean(busy) || !prompt.trim()} onClick={create}>Create flow</Button>
      </div>
    </>
  );
}

function AskTab() {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  const send = async (content) => {
    const c = (content ?? text).trim();
    if (!c || busy) return;
    const next = [...messages, { role: 'user', content: c }];
    setMessages(next); setText(''); setBusy(true);
    try {
      const r = await api.post('copilot/chat', { messages: next, context: window.location.pathname });
      setMessages((m) => [...m, { role: 'assistant', content: r.reply }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `Sorry — ${e.message}`, error: true }]);
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="copilot-body">
        {!messages.length && (
          <div className="col" style={{ gap: 6 }}>
            <p className="small muted">Ask about building flows, pricing, features or debugging a run. Copilot knows which page you're on.</p>
            {SUGGESTIONS.map((s) => <button key={s} type="button" className="cp-example" onClick={() => send(s)}>{s}</button>)}
          </div>
        )}
        {messages.map((m, i) => <div key={i} className={`msg msg-${m.role}`} style={m.error ? { color: 'var(--danger)' } : undefined}>{m.content}</div>)}
        {busy && <div className="msg msg-assistant row gap-4"><Spinner size={12} /> Thinking…</div>}
        <div ref={endRef} />
      </div>
      <form className="copilot-foot" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <Textarea rows={1} value={text} placeholder="Ask Copilot…" aria-label="Message" style={{ minHeight: 38, resize: 'none' }}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        {messages.length > 0 && <Button variant="ghost" icon={RotateCcw} onClick={() => setMessages([])} aria-label="Clear conversation" title="Clear conversation" />}
        <Button type="submit" variant="primary" icon={Send} disabled={!text.trim() || busy} aria-label="Send" />
      </form>
    </>
  );
}
