import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Code2, Crown, Boxes, Puzzle, Plug } from 'lucide-react';
import { useApps } from '../../lib/context.jsx';
import { PageHeader, SearchInput, AppIcon, Badge, EmptyState, Loading, Toggle, Button } from '../../components/ui.jsx';
import { plural } from '../../lib/util.js';
import './apps.css';

export default function AppsDirectory() {
  const { apps, loaded, refresh } = useApps();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  const [builtinOnly, setBuiltinOnly] = useState(false);

  const categories = useMemo(() => {
    const counts = {};
    for (const a of apps) counts[a.category || 'Other'] = (counts[a.category || 'Other'] || 0) + 1;
    return Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
  }, [apps]);

  const list = apps.filter((a) => {
    if (cat !== 'All' && (a.category || 'Other') !== cat) return false;
    if (builtinOnly && !a.builtin) return false;
    if (q) {
      const hay = `${a.name} ${a.description} ${a.category} ${Object.values(a.triggers).map((t) => t.name).join(' ')} ${Object.values(a.actions).map((t) => t.name).join(' ')}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="page">
      <PageHeader title="Apps" description={`Browse the ${apps.length || ''} apps and built-in tools you can use in flows, MCP servers and chatbots.`}
        actions={<><Button icon={Plug} onClick={() => nav('/connections')}>My connections</Button><Button variant="primary" icon={Code2} onClick={() => nav('/developer')}>Build an app</Button></>} />
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Search apps, triggers and actions…" style={{ width: 340, maxWidth: '100%' }} />
        <div className="grow" />
        <Toggle checked={builtinOnly} onChange={setBuiltinOnly} label={<span className="small">Built-in</span>} />
      </div>
      <div className="ap-chips mb-16" role="tablist" aria-label="Categories">
        <button type="button" className={`ap-chip ${cat === 'All' ? 'active' : ''}`} onClick={() => setCat('All')}>All <span>{apps.length}</span></button>
        {categories.map(([c, n]) => <button key={c} type="button" className={`ap-chip ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>{c} <span>{n}</span></button>)}
      </div>
      {!loaded ? <Loading /> : !apps.length ? (
        <div className="card"><EmptyState icon={Boxes} title="Couldn't load apps" action={<Button onClick={refresh}>Retry</Button>}>The app catalog is unavailable right now.</EmptyState></div>
      ) : (
        <div className="grid-auto">
          {list.map((a) => {
            const t = Object.keys(a.triggers).length; const ac = Object.keys(a.actions).length;
            return (
              <Link key={a.key} to={`/apps/${a.key}`} className="card card-hover ap-card">
                <div className="row gap-12" style={{ alignItems: 'flex-start' }}>
                  <AppIcon app={a} size={40} />
                  <div className="grow">
                    <div className="row between"><span className="bold truncate" style={{ color: 'var(--text)' }}>{a.name}</span>
                      <span className="row gap-4">{a.builtin && <Badge color="brand">Built-in</Badge>}{a.custom && <Badge color="blue">Custom</Badge>}</span></div>
                    <div className="tiny subtle">{a.category}</div>
                  </div>
                </div>
                <p className="small muted ap-desc">{a.description}</p>
                <div className="row tiny subtle" style={{ marginTop: 'auto' }}>
                  {t > 0 && <span>{plural(t, 'trigger')}</span>}{t > 0 && ac > 0 && <span>·</span>}{ac > 0 && <span>{plural(ac, 'action')}</span>}
                  {a.auth && <><span>·</span><span>Requires connection</span></>}
                </div>
              </Link>
            );
          })}
          <Link to="/developer" className="card card-hover ap-card ap-build">
            <div className="row gap-12"><span className="empty-icon" style={{ width: 40, height: 40, margin: 0 }}><Puzzle size={20} /></span><span className="bold" style={{ color: 'var(--text)' }}>Build your own app</span></div>
            <p className="small muted ap-desc">Missing an integration? Connect any REST API in minutes with the Developer Platform — no code required.</p>
            <span className="small bold" style={{ marginTop: 'auto' }}>Open Developer Platform →</span>
          </Link>
        </div>
      )}
      {loaded && apps.length > 0 && !list.length && <div className="card mt-16"><EmptyState title="No apps match your filters">Try a different search or category — or build a custom app for any REST API.</EmptyState></div>}
    </div>
  );
}
