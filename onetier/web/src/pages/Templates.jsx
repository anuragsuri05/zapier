import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Eye, Library, GitBranch, Repeat, Zap, Wand2 } from 'lucide-react';
import api from '../lib/api.js';
import { useApps, useFetch, useToast } from '../lib/context.jsx';
import { plural } from '../lib/util.js';
import { Button, Badge, AppIcon, AppIconStack, SearchInput, Modal, Loading, ErrorState, EmptyState, PageHeader } from '../components/ui.jsx';
import './core.css';

function countSteps(steps = []) {
  let n = 0;
  for (const s of steps) {
    n++;
    if (s.app === 'paths') for (const p of s.paths || []) n += countSteps(p.steps);
    if (s.app === 'looping') n += countSteps(s.steps);
  }
  return n;
}

export default function Templates() {
  const nav = useNavigate();
  const toast = useToast();
  const { getApp } = useApps();
  const { data, error, loading, reload } = useFetch('templates');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(null);

  const categories = useMemo(() => {
    const c = {};
    for (const t of data || []) c[t.category] = (c[t.category] || 0) + 1;
    return Object.entries(c).sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data || [])
      .filter((t) => (cat === 'All' || (cat === 'Popular' ? t.popular : t.category === cat)))
      .filter((t) => !needle || `${t.name} ${t.description} ${t.category} ${t.apps.map((a) => getApp(a)?.name || a).join(' ')}`.toLowerCase().includes(needle))
      .sort((a, b) => Number(Boolean(b.popular)) - Number(Boolean(a.popular)));
  }, [data, q, cat, getApp]);

  const apply = async (t) => {
    setBusy(t.id);
    try { const r = await api.post('flows', { templateId: t.id }); toast.success('Template added — fill in the highlighted fields, then publish.'); nav(`/flows/${r.id}`); }
    catch (e) { toast.error(e.message); setBusy(null); }
  };

  return (
    <div className="page">
      <PageHeader title="Templates" description="Ready-made flows you can customize in minutes."
        actions={<Button icon={Wand2} onClick={() => window.dispatchEvent(new CustomEvent('onetier:copilot'))}>Describe your own</Button>} />

      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Search templates or apps…" style={{ flex: '1 1 260px', maxWidth: 420 }} />
      </div>
      <div className="chips" style={{ marginTop: 0, marginBottom: 20 }}>
        <button className={`chip ${cat === 'All' ? 'active' : ''}`} onClick={() => setCat('All')}>All <span className="count">{data?.length ?? ''}</span></button>
        <button className={`chip ${cat === 'Popular' ? 'active' : ''}`} onClick={() => setCat('Popular')}>Popular <span className="count">{data?.filter((t) => t.popular).length ?? ''}</span></button>
        {categories.map(([c, n]) => <button key={c} className={`chip ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>{c} <span className="count">{n}</span></button>)}
      </div>

      {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : !rows.length ? (
        <div className="card"><EmptyState icon={Library} title="No templates match"
          action={<Button onClick={() => { setQ(''); setCat('All'); }}>Clear filters</Button>}>Try another search, or ask Copilot to draft a flow from a description.</EmptyState></div>
      ) : (
        <div className="grid-auto">
          {rows.map((t) => (
            <div key={t.id} className="card card-hover tpl-card" onClick={() => setPreview(t)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setPreview(t)}>
              <div className="row between">
                <AppIconStack apps={t.apps.map(getApp)} size={28} />
                {t.popular && <Badge color="brand">Popular</Badge>}
              </div>
              <div className="bold">{t.name}</div>
              <p>{t.description}</p>
              <div className="row between">
                <span className="tiny subtle">{t.category} · {plural(countSteps(t.definition.steps) + 1, 'step')}</span>
                <div className="row gap-4" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="ghost" icon={Eye} onClick={() => setPreview(t)} aria-label={`Preview ${t.name}`} />
                  <Button size="sm" variant="primary" loading={busy === t.id} onClick={() => apply(t)}>Use</Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <Modal title={preview.name} subtitle={`${preview.category}${preview.popular ? ' · Popular' : ''}`} size="lg" onClose={() => setPreview(null)}
          footer={<><Button onClick={() => setPreview(null)}>Close</Button><Button variant="primary" icon={ArrowRight} loading={busy === preview.id} onClick={() => apply(preview)}>Use template</Button></>}>
          <p className="muted" style={{ marginBottom: 16 }}>{preview.description}</p>
          <StepTree definition={preview.definition} />
        </Modal>
      )}
    </div>
  );
}

/** Read-only view of a flow definition: trigger + steps (with nested paths and loops). */
export function StepTree({ definition }) {
  const { getApp } = useApps();
  const t = definition.trigger || {};
  const tApp = getApp(t.app);
  let n = 1;
  const renderSteps = (steps) => steps.map((s) => {
    const app = getApp(s.app);
    const act = app?.actions?.[s.action];
    const num = ++n;
    return (
      <div key={s.id} className="col" style={{ gap: 8 }}>
        <div className="tpl-step">
          <span className="ts-num">{num}.</span>
          <AppIcon app={app} size={30} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="bold small truncate">{s.title || act?.name || s.action}</div>
            <div className="tiny subtle truncate">{app?.name || s.app}{act ? ` · ${act.name}` : ''}</div>
          </div>
          {s.app === 'paths' && <Badge><GitBranch size={12} /> {plural((s.paths || []).length, 'path')}</Badge>}
          {s.app === 'looping' && <Badge><Repeat size={12} /> Loop</Badge>}
        </div>
        {s.app === 'paths' && (s.paths || []).map((p) => (
          <div key={p.id} className="tpl-nest">
            <div className="tpl-path-label"><GitBranch size={13} />{p.name || 'Path'}{p.fallback && <Badge>Fallback</Badge>}</div>
            {p.steps?.length ? renderSteps(p.steps) : <span className="tiny subtle">No steps</span>}
          </div>
        ))}
        {s.app === 'looping' && (
          <div className="tpl-nest">
            <div className="tpl-path-label"><Repeat size={13} />For each item</div>
            {s.steps?.length ? renderSteps(s.steps) : <span className="tiny subtle">No steps</span>}
          </div>
        )}
      </div>
    );
  });
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="tpl-step" style={{ borderColor: 'var(--brand-100)', background: 'var(--brand-50)' }}>
        <span className="ts-num">1.</span>
        <AppIcon app={tApp} size={30} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="bold small truncate">{tApp?.triggers?.[t.event]?.name || t.event || 'Choose a trigger'}</div>
          <div className="tiny subtle truncate">Trigger · {tApp?.name || t.app || '—'}</div>
        </div>
        <Badge color="brand"><Zap size={12} /> Trigger</Badge>
      </div>
      {renderSteps(definition.steps || [])}
    </div>
  );
}
