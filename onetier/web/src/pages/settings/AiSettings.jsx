import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, CheckCircle2, AlertTriangle, Info, LogIn, LogOut, KeyRound, RefreshCw, Terminal, ExternalLink, Cable, Zap, Globe, X } from 'lucide-react';
import api from '../../lib/api.js';
import { useAuth, useToast, useDialog, useFetch } from '../../lib/context.jsx';
import { Button, Field, Badge, Callout, Select, Input, Loading, ErrorState, CopyField, Spinner } from '../../components/ui.jsx';
import { SectionHead } from './shared.jsx';
import { PasswordInput } from '../auth/AuthShell.jsx';
import './ai-settings.css';

const ACCOUNTS = [
  { key: 'claude', provider: 'claude-cli', title: 'Claude account', product: 'Claude Code', color: '#D97757', letter: 'C',
    blurb: 'Sign in with your Claude (Pro / Max / Team) account. OneTier runs AI through Claude Code on this computer — no API key.',
    models: [{ value: 'sonnet', label: 'Sonnet (balanced, default)' }, { value: 'opus', label: 'Opus (most capable)' }, { value: 'haiku', label: 'Haiku (fastest)' }] },
  { key: 'codex', provider: 'codex-cli', title: 'ChatGPT account', product: 'Codex CLI', color: '#10A37F', letter: 'G',
    blurb: 'Sign in with your ChatGPT (Plus / Pro / Team) account. OneTier runs AI through OpenAI’s Codex CLI on this computer — no API key.' },
];

export default function AiSettings() {
  const { isAdmin, me, refresh } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload, setData } = useFetch('ai/status');
  const [testing, setTesting] = useState('');

  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const update = (d) => { setData(d); refresh(); };
  const test = async (provider) => {
    setTesting(provider || 'active');
    try { const r = await api.post('ai/test', { provider }); toast.success(`${r.reply} (${r.model || 'model'}${r.via ? ` via ${r.via}` : ''}, ${(r.ms / 1000).toFixed(1)}s)`); }
    catch (e) { toast.error(e.message); } finally { setTesting(''); }
  };
  const saveSettings = async (patch) => {
    try { update(await api.put('ai/settings', patch)); toast.success('AI settings saved'); } catch (e) { toast.error(e.message); }
  };

  const options = [{ value: 'auto', label: 'Automatic — use whatever is connected' },
    ...Object.entries(data.providers).map(([k, label]) => ({ value: k, label: `${label}${data.available[k] ? '' : ' (not connected)'}`, disabled: !data.available[k] }))];

  return (
    <div className="settings-section">
      <SectionHead title="AI" description="Power AI steps, Copilot and Chatbots with your own Claude or ChatGPT account — or an API key if you have one."
        actions={<><Button icon={RefreshCw} onClick={async () => setData(await api.post('ai/refresh'))}>Re-check</Button>
          <Button variant="primary" icon={Zap} loading={testing === 'active'} disabled={!data.active} onClick={() => test()}>Test AI</Button></>} />

      <div className={`card card-pad ai-active ${data.active ? 'on' : ''}`}>
        {data.active ? <CheckCircle2 className="ai-active-icon" /> : <AlertTriangle className="ai-active-icon" />}
        <div className="grow">
          <div className="bold">{data.active ? `AI is on — using your ${data.active.label}` : 'AI is not set up yet'}</div>
          <div className="small muted">{data.active
            ? `Model: ${data.active.model || 'default'}. AI steps, Copilot and chatbot previews use this.`
            : 'Sign in with a Claude or ChatGPT account below, or add an API key. Until then Copilot uses keyword drafting and chatbots answer by keyword search.'}</div>
        </div>
        {isAdmin && <div style={{ minWidth: 260 }}>
          <Field label="Which one to use" className="mb-0">
            <Select value={data.settings.provider || 'auto'} options={options} onChange={(e) => saveSettings({ provider: e.target.value })} />
          </Field>
        </div>}
      </div>

      <h3 className="ai-group-title"><LogIn size={16} />Use your account — no API key needed</h3>
      <div className="grid-2">
        {ACCOUNTS.map((a) => <AccountCard key={a.key} acc={a} data={data} isAdmin={isAdmin} isOwner={me.role === 'owner'} onUpdate={update} onTest={() => test(a.provider)} testing={testing === a.provider} onSettings={saveSettings} />)}
      </div>
      <Callout type="info" icon={Info}>
        Account sign-in runs the official Claude Code / Codex CLI login on the computer where OneTier is running, and requests go through that account (they count toward its plan limits).
        For privacy and the providers’ terms, <b>public chatbots answering website visitors never use your personal account</b> — they need an API key{data.publicProvider ? ` (currently: ${data.providers[data.publicProvider]})` : ' (none added — they’ll answer by keyword search)'}.
      </Callout>

      <h3 className="ai-group-title"><KeyRound size={16} />Use an API key</h3>
      <div className="grid-2">
        <KeyCard provider="anthropic" title="Anthropic API key" color="#D97757" letter="A" placeholder="sk-ant-…"
          hint={<>From <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>. Default model: Claude Opus 5.5.</>}
          saved={data.keys.anthropic} env={data.keys.anthropicEnv} conn={data.keys.anthropicConnection} isAdmin={isAdmin} onUpdate={update} onTest={() => test('anthropic')} testing={testing === 'anthropic'} />
        <KeyCard provider="openai" title="OpenAI API key" color="#10A37F" letter="O" placeholder="sk-…"
          hint={<>From <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com</a>.</>}
          saved={data.keys.openai} env={data.keys.openaiEnv} isAdmin={isAdmin} onUpdate={update} onTest={() => test('openai')} testing={testing === 'openai'}
          extra={data.keys.openai && data.keys.openaiModels.length > 0 && (
            <Field label="Model">
              <Select value={data.settings.openaiModel || ''} disabled={!isAdmin} options={data.keys.openaiModels.map((m) => ({ value: m, label: m }))} onChange={(e) => saveSettings({ openaiModel: e.target.value })} />
            </Field>
          )} />
      </div>

      <h3 className="ai-group-title"><Cable size={16} />Or let ChatGPT / Claude be your agent</h3>
      <div className="card card-pad">
        <p>Prefer working inside the ChatGPT or Claude app? Connect OneTier to it as an <b>MCP connector</b>. Your ChatGPT or Claude account then builds, publishes and runs flows for you through OneTier’s agent-builder tools — just ask: <i>“Build a flow that saves new Stripe customers to a table and pings me on Slack.”</i></p>
        <ol className="small muted ai-steps">
          <li>Open <Link to="/mcp">MCP</Link> and create a server — the <b>Agent builder</b> tools are included automatically.</li>
          <li><b>Claude:</b> Settings → Connectors → Add custom connector → paste the server URL. <b>Claude Code:</b> <code>claude mcp add --transport http onetier &lt;url&gt;</code></li>
          <li><b>ChatGPT:</b> Settings → Apps &amp; Connectors → Advanced → Developer mode → Create connector → paste the URL (no authentication).</li>
        </ol>
        <p className="tiny subtle mt-8"><Globe size={12} /> The ChatGPT and Claude web apps run in the cloud, so they need a public URL for OneTier (e.g. a Cloudflare or ngrok tunnel and the PUBLIC_URL setting). Claude Code and Claude Desktop can use localhost directly.</p>
        <div className="mt-16"><Link className="btn btn-primary" to="/mcp"><Cable />Set up MCP connector</Link></div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- account sign-in card
function AccountCard({ acc, data, isAdmin, isOwner, onUpdate, onTest, testing, onSettings }) {
  const toast = useToast();
  const dialog = useDialog();
  const st = data.cli[acc.key] || {};
  const [login, setLogin] = useState(data.login[acc.key]);
  const [code, setCode] = useState('');
  const opened = useRef(false);
  const running = login?.state === 'running';

  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(async () => {
      try {
        const s = await api.get(`ai/login/${acc.key}`);
        setLogin(s);
        if (s.url && !opened.current) { opened.current = true; window.open(s.url, '_blank', 'noopener'); }
        if (s.state === 'done') { toast.success(`Signed in to your ${acc.title}`); onUpdate(await api.post('ai/refresh')); }
        if (s.state === 'failed') toast.error(s.error || 'Sign-in failed');
      } catch { /* keep polling */ }
    }, 1500);
    return () => clearInterval(t);
  }, [running, acc.key, acc.title, onUpdate, toast]);

  const start = async () => {
    opened.current = false;
    try { setLogin(await api.post(`ai/login/${acc.key}`)); } catch (e) { toast.error(e.message); }
  };
  const sendCode = async () => {
    try { setLogin(await api.post(`ai/login/${acc.key}/code`, { code })); setCode(''); toast.info('Code sent — finishing sign-in…'); } catch (e) { toast.error(e.message); }
  };
  const cancel = async () => { try { setLogin(await api.del(`ai/login/${acc.key}`)); } catch (e) { toast.error(e.message); } };
  const signOut = async () => {
    if (!await dialog.confirm({ title: `Sign out of your ${acc.title}?`, message: `${acc.product} on this computer will be signed out, and OneTier will stop using this account.`, danger: true, confirmText: 'Sign out' })) return;
    try { onUpdate(await api.post(`ai/logout/${acc.key}`)); toast.success('Signed out'); } catch (e) { toast.error(e.message); }
  };

  let body;
  if (!data.cli.enabled) {
    body = <Callout type="warning">Account sign-in is turned off on this server (ONETIER_LOCAL_AI_ACCOUNTS=off). Use an API key instead.</Callout>;
  } else if (!st.installed) {
    body = (
      <>
        <p className="small muted">{acc.product} isn’t installed on this computer yet. Install it once, then come back and sign in:</p>
        <CopyField value={data.cli.install[acc.key]} />
        <Button size="sm" className="mt-8" icon={RefreshCw} onClick={async () => onUpdate(await api.post('ai/refresh'))}>I’ve installed it</Button>
      </>
    );
  } else if (st.loggedIn) {
    body = (
      <>
        <div className="row wrap small"><Badge color="green" dot>Signed in</Badge>{st.email && <span className="muted">{st.email}</span>}{st.method && <span className="subtle">· {st.method === 'claude.ai' ? 'Claude subscription' : st.method === 'chatgpt' ? 'ChatGPT subscription' : st.method}</span>}</div>
        {acc.models ? (
          <Field label="Model" className="mt-16">
            <Select value={data.settings.claudeModel || 'sonnet'} disabled={!isAdmin} options={acc.models} onChange={(e) => onSettings({ claudeModel: e.target.value })} />
          </Field>
        ) : (
          <Field label="Model (optional)" help="Leave empty to use Codex’s default model." className="mt-16">
            <Input defaultValue={data.settings.codexModel || ''} disabled={!isAdmin} placeholder="default" onBlur={(e) => e.target.value !== (data.settings.codexModel || '') && onSettings({ codexModel: e.target.value.trim() })} />
          </Field>
        )}
        <div className="row wrap">
          <Button size="sm" icon={Zap} loading={testing} onClick={onTest}>Test</Button>
          {isOwner && <Button size="sm" variant="danger-ghost" icon={LogOut} onClick={signOut}>Sign out</Button>}
        </div>
      </>
    );
  } else if (running) {
    body = (
      <div className="col">
        <div className="row small"><Spinner size={14} /> Waiting for you to finish signing in…</div>
        {login.url ? <a className="btn btn-primary btn-sm" href={login.url} target="_blank" rel="noreferrer"><ExternalLink />Open {acc.title.split(' ')[0]} sign-in page</a>
          : <p className="tiny subtle">Starting {acc.product}… a sign-in page will open in your browser.</p>}
        <p className="tiny subtle">If the page shows a code to paste back, paste it here:</p>
        <div className="input-group"><Input value={code} placeholder="Authentication code" onChange={(e) => setCode(e.target.value)} /><Button disabled={!code.trim()} onClick={sendCode}>Submit</Button></div>
        {login.output && <details className="tiny"><summary className="subtle">Details</summary><pre className="json" style={{ maxHeight: 140 }}>{login.output}</pre></details>}
        <div><Button size="xs" variant="ghost" icon={X} onClick={cancel}>Cancel</Button></div>
      </div>
    );
  } else {
    body = (
      <>
        {login?.state === 'failed' && <Callout type="danger">{login.error || 'Sign-in failed.'}</Callout>}
        <Button variant="primary" icon={LogIn} disabled={!isAdmin} onClick={start} className="mt-8">Sign in with {acc.title.split(' ')[0]}</Button>
        {!isAdmin && <p className="tiny subtle mt-8">Ask a workspace admin to sign in.</p>}
        <p className="tiny subtle mt-8"><Terminal size={12} /> Or run <code>{acc.key === 'claude' ? 'claude auth login' : 'codex login'}</code> in a terminal, then click Re-check.</p>
      </>
    );
  }

  return (
    <div className="card card-pad ai-card">
      <div className="row gap-12">
        <span className="app-icon" style={{ width: 36, height: 36, background: acc.color, fontSize: 16 }}>{acc.letter}</span>
        <div className="grow"><h3>{acc.title}</h3><div className="tiny subtle">via {acc.product}</div></div>
        {data.active?.type === acc.provider && <Badge color="brand"><Sparkles />In use</Badge>}
      </div>
      <p className="small muted">{acc.blurb}</p>
      {body}
    </div>
  );
}

// ---------------------------------------------------------------- API key card
function KeyCard({ provider, title, color, letter, placeholder, hint, saved, env, conn, isAdmin, onUpdate, onTest, testing, extra }) {
  const toast = useToast();
  const dialog = useDialog();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    try { onUpdate(await api.post(`ai/keys/${provider}`, { key: key.trim() })); setKey(''); toast.success(`${title} saved and verified`); }
    catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!await dialog.confirm({ title: `Remove ${title}?`, message: 'AI features using this key will switch to another connected option, if any.', danger: true, confirmText: 'Remove key' })) return;
    try { onUpdate(await api.del(`ai/keys/${provider}`)); toast.success('Key removed'); } catch (err) { toast.error(err.message); }
  };
  const active = saved || env || conn;
  return (
    <div className="card card-pad ai-card">
      <div className="row gap-12">
        <span className="app-icon" style={{ width: 36, height: 36, background: color, fontSize: 16 }}>{letter}</span>
        <div className="grow"><h3>{title}</h3><div className="tiny subtle">{hint}</div></div>
        {active ? <Badge color="green" dot>Connected</Badge> : <Badge>Not added</Badge>}
      </div>
      {saved ? (
        <>
          <p className="small muted">A key is saved (encrypted). Paste a new one below to replace it.</p>
          {extra}
        </>
      ) : env ? <p className="small muted">Using the key from the server’s environment.</p>
        : conn ? <p className="small muted">Using the key from your Anthropic app connection.</p> : null}
      {isAdmin && (
        <form onSubmit={save} className="col">
          <PasswordInput value={key} autoComplete="off" placeholder={placeholder} onChange={(e) => setKey(e.target.value)} />
          <div className="row wrap">
            <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!key.trim()}>{saved ? 'Replace key' : 'Save & verify'}</Button>
            {active && <Button size="sm" icon={Zap} loading={testing} onClick={onTest}>Test</Button>}
            {saved && <Button size="sm" variant="danger-ghost" onClick={remove}>Remove</Button>}
          </div>
        </form>
      )}
    </div>
  );
}
