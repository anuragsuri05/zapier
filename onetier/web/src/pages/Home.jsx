import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Sparkles, ArrowRight, Zap, Gauge, Activity, AlertTriangle, Table2, LayoutTemplate, Bot, Network, UserCheck, KeyRound, Library, Plus,
} from 'lucide-react';
import api from '../lib/api.js';
import { useAuth, useApps, useFetch, useToast } from '../lib/context.jsx';
import { timeAgo, fmtNum } from '../lib/util.js';
import { Button, Loading, ErrorState, RunStatus, FlowStatus, Callout, BarChart, AppIconStack, EmptyState, Badge } from '../components/ui.jsx';
import './core.css';

export const COPILOT_EXAMPLES = [
  'When a form is submitted, save it to a table and email me',
  'Every morning, send me a Slack summary of new RSS posts',
  'When a Stripe payment comes in, post to Slack only if amount is over 100',
  'Classify new support emails with AI and notify the team',
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** Fill the last 14 days, oldest first, with zeros where there were no runs. */
function fill14(rows = []) {
  const byDay = Object.fromEntries(rows.map((r) => [r.day, r]));
  const out = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5);
    const key = d.toISOString().slice(0, 10);
    const r = byDay[key];
    out.push({ label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), value: r?.runs || 0, value2: r?.errors || 0 });
  }
  return out;
}

export default function Home() {
  const { me } = useAuth();
  const { getApp } = useApps();
  const toast = useToast();
  const nav = useNavigate();
  const { data: dash, error, loading, reload } = useFetch('dashboard');
  const { data: templates } = useFetch('templates');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [usingTpl, setUsingTpl] = useState(null);

  const chart = useMemo(() => fill14(dash?.runs14d), [dash]);
  const popular = useMemo(() => {
    if (!templates) return [];
    return [...templates.filter((t) => t.popular), ...templates.filter((t) => !t.popular)].slice(0, 4);
  }, [templates]);

  const firstName = (me?.user?.name || '').split(/\s+/)[0] || 'there';

  const submit = async (e) => {
    e?.preventDefault();
    const p = prompt.trim();
    if (p.length < 5) { toast.error('Describe the workflow you want in a sentence or two.'); return; }
    setBusy(true);
    try {
      const r = await api.post('copilot/flow', { prompt: p, create: true });
      if (r.explanation) toast.info(r.explanation);
      nav(`/flows/${r.id}`);
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const applyTemplate = async (t) => {
    setUsingTpl(t.id);
    try { const r = await api.post('flows', { templateId: t.id }); nav(`/flows/${r.id}`); }
    catch (err) { toast.error(err.message); setUsingTpl(null); }
  };

  const createFlow = async () => {
    try { const r = await api.post('flows', { name: 'Untitled flow' }); nav(`/flows/${r.id}`); } catch (err) { toast.error(err.message); }
  };

  if (loading && !dash) return <div className="page"><Loading /></div>;
  if (error && !dash) return <div className="page"><ErrorState error={error} onRetry={reload} /></div>;

  const usage = dash.usage || { tasks: 0, limit: 0 };
  const pct = Math.min(100, Math.round(((usage.tasks || 0) / Math.max(1, usage.limit)) * 100));
  const runs14 = chart.reduce((a, d) => a + d.value, 0);
  const errs14 = chart.reduce((a, d) => a + d.value2, 0);

  const products = [
    { to: '/tables', label: 'Tables', icon: Table2, color: '#0CA678', count: dash.counts?.tables, noun: 'table' },
    { to: '/interfaces', label: 'Interfaces', icon: LayoutTemplate, color: '#1971C2', count: dash.counts?.interfaces, noun: 'interface' },
    { to: '/chatbots', label: 'Chatbots', icon: Bot, color: '#C2255C', count: dash.counts?.chatbots, noun: 'chatbot' },
    { to: '/canvas', label: 'Canvas', icon: Network, color: '#E8590C', count: dash.counts?.canvases, noun: 'canvas', plural: 'canvases' },
  ];

  return (
    <div className="page">
      <section className="home-hero">
        <h1>{greeting()}, {firstName}</h1>
        <p className="hero-sub">What would you like to automate today?</p>
        <form className="copilot-box" onSubmit={submit}>
          <textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="Describe what you want to automate"
            placeholder="Describe what you want to automate…"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} />
          <Button type="submit" variant="primary" icon={Sparkles} loading={busy} disabled={!prompt.trim()}>Build with Copilot</Button>
        </form>
        <div className="chips">
          {COPILOT_EXAMPLES.map((ex) => <button key={ex} type="button" className="chip" onClick={() => setPrompt(ex)}>{ex}</button>)}
        </div>
      </section>

      <div className="col" style={{ gap: 10, marginBottom: 20 }}>
        {dash.pendingApprovals > 0 && (
          <Callout type="warning" icon={UserCheck}>
            <div className="row between wrap">
              <span><b>{dash.pendingApprovals}</b> approval{dash.pendingApprovals === 1 ? '' : 's'} waiting for a decision.</span>
              <Link to="/approvals" className="bold">Review approvals →</Link>
            </div>
          </Callout>
        )}
        {dash.ai === false && (
          <Callout type="info" icon={KeyRound}>
            <div className="row between wrap">
              <span>AI isn't set up yet. Sign in with your Claude or ChatGPT account (no API key needed) or add an API key to turn on AI steps and full Copilot.</span>
              <Link to="/settings/ai" className="bold">Set up AI →</Link>
            </div>
          </Callout>
        )}
      </div>

      <div className="grid-4">
        <div className="card stat">
          <div className="stat-label"><span className="stat-icon"><Zap /></span>Active flows</div>
          <div className="stat-value">{fmtNum(dash.flows.on)} <span className="muted" style={{ fontSize: 15, fontWeight: 500 }}>/ {fmtNum(dash.flows.total)}</span></div>
          <div className="tiny subtle">{dash.flows.draft} draft · {dash.flows.off} off</div>
        </div>
        <Link to="/settings/usage" className="card stat card-hover" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="stat-label"><span className="stat-icon"><Gauge /></span>Tasks this month</div>
          <div className="stat-value">{fmtNum(usage.tasks)} <span className="muted" style={{ fontSize: 15, fontWeight: 500 }}>· unlimited</span></div>
          <div className={`progress mt-8 ${pct >= 100 ? 'danger' : pct >= 80 ? 'warn' : ''}`}><div style={{ width: `${pct}%` }} /></div>
        </Link>
        <Link to="/history" className="card stat card-hover" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="stat-label"><span className="stat-icon"><Activity /></span>Runs · last 14 days</div>
          <div className="stat-value">{fmtNum(runs14)}</div>
          <div className="tiny subtle">{fmtNum(errs14)} with errors</div>
        </Link>
        <Link to="/history?status=error" className="card stat card-hover" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="stat-label"><span className="stat-icon" style={dash.errors7d ? { background: 'var(--danger-bg)', color: 'var(--danger)' } : undefined}><AlertTriangle /></span>Errors · last 7 days</div>
          <div className="stat-value" style={dash.errors7d ? { color: 'var(--danger)' } : undefined}>{fmtNum(dash.errors7d)}</div>
          <div className="tiny subtle">{dash.errors7d ? 'Open History to investigate' : 'Everything is running smoothly'}</div>
        </Link>
      </div>

      <div className="home-cols mt-16">
        <div className="card">
          <div className="card-header">
            <h3>Runs · last 14 days</h3>
            <span className="legend"><span><i style={{ background: 'var(--brand)' }} />Runs</span><span><i style={{ background: 'var(--danger)' }} />Errors</span></span>
          </div>
          <div className="card-body">
            {runs14 ? <BarChart data={chart} height={170} valueLabel="runs" /> : (
              <EmptyState icon={Activity} title="No runs yet">Turn on a flow and its runs will show up here.</EmptyState>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3>Recent runs</h3><Link to="/history" className="small">View all</Link></div>
          {!dash.recentRuns.length ? <p className="muted small" style={{ padding: 20 }}>No runs yet.</p> : dash.recentRuns.map((r) => (
            <div key={r.id} className="list-item clickable" onClick={() => nav(`/history/${r.id}`)}>
              <RunStatus status={r.status} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="truncate bold small">{r.flow_name || 'Deleted flow'}</div>
                {r.error && <div className="truncate tiny" style={{ color: 'var(--danger)' }}>{r.error}</div>}
              </div>
              <span className="tiny subtle nowrap">{timeAgo(r.started_at)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="section-title">
        <h2>Recent flows</h2>
        <div className="row"><Button size="sm" icon={Plus} onClick={createFlow}>New flow</Button><Link to="/flows" className="small">All flows</Link></div>
      </div>
      {!dash.recentFlows.length ? (
        <div className="card"><EmptyState title="Create your first flow" action={<Button variant="primary" icon={Plus} onClick={createFlow}>Create flow</Button>}>
          Flows connect a trigger to one or more actions. Start from scratch, a template, or describe it to Copilot above.
        </EmptyState></div>
      ) : (
        <div className="grid-3">
          {dash.recentFlows.map((f) => (
            <Link key={f.id} to={`/flows/${f.id}`} className="card card-hover card-pad" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="row between"><span className="bold truncate">{f.name}</span><FlowStatus status={f.status} /></div>
              <div className="tiny subtle mt-8">Edited {timeAgo(f.updated_at)}</div>
            </Link>
          ))}
        </div>
      )}

      <div className="section-title"><h2>Start from a template</h2><Link to="/templates" className="small">Browse all templates</Link></div>
      {!templates ? <Loading /> : (
        <div className="grid-4">
          {popular.map((t) => (
            <div key={t.id} className="card tpl-card">
              <div className="row between"><AppIconStack apps={t.apps.map(getApp)} size={24} />{t.popular && <Badge color="brand">Popular</Badge>}</div>
              <div className="bold">{t.name}</div>
              <p>{t.description}</p>
              <Button size="sm" icon={ArrowRight} loading={usingTpl === t.id} onClick={() => applyTemplate(t)}>Use template</Button>
            </div>
          ))}
        </div>
      )}

      <div className="section-title"><h2>Build more with OneTier</h2></div>
      <div className="grid-4">
        {products.map((p) => (
          <Link key={p.to} to={p.to} className="card card-hover product-tile">
            <span className="pt-icon" style={{ background: p.color }}><p.icon /></span>
            <div style={{ minWidth: 0 }}>
              <div className="bold">{p.label}</div>
              <div className="tiny subtle">{fmtNum(p.count || 0)} {p.count === 1 ? p.noun : (p.plural || `${p.noun}s`)}</div>
            </div>
            <ArrowRight size={16} className="subtle" style={{ marginLeft: 'auto' }} />
          </Link>
        ))}
      </div>
      <div className="row mt-16 small muted"><Library size={14} /> Tip: press <span className="kbd">⌘J</span> to open Copilot anywhere.</div>
    </div>
  );
}
