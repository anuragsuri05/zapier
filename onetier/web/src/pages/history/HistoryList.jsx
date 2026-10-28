import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { History, RefreshCw, Repeat, Trash2, X } from 'lucide-react';
import api from '../../lib/api.js';
import { useAuth, useFetch, useToast, useDialog } from '../../lib/context.jsx';
import { timeAgo, fmtDate, duration, fmtNum, plural, RUN_STATUS } from '../../lib/util.js';
import {
  Button, Select, SearchInput, Input, Checkbox, Toggle, Badge, RunStatus, Pagination, Loading, ErrorState, EmptyState, PageHeader, Spinner,
} from '../../components/ui.jsx';
import '../core.css';

const LIMIT = 50;
export const SOURCES = ['trigger', 'webhook', 'schedule', 'poll', 'event', 'manual', 'test', 'replay', 'api', 'mcp', 'agent', 'interface', 'chatbot', 'subflow'];

export default function HistoryList() {
  const nav = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const { isAdmin } = useAuth();
  const [params, setParams] = useSearchParams();
  const flowId = params.get('flowId') || '';
  const status = params.get('status') || '';
  const [source, setSource] = useState('');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [auto, setAuto] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [replaying, setReplaying] = useState(false);
  const { data: flows } = useFetch('flows');

  const setParam = (k, v) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };

  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setOffset(0); setSelected(new Set()); }, [flowId, status, source, debounced, from, to]);

  const query = useMemo(() => {
    const p = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
    if (flowId) p.set('flowId', flowId);
    if (status) p.set('status', status);
    if (source) p.set('source', source);
    if (debounced) p.set('q', debounced);
    if (from) p.set('from', new Date(`${from}T00:00:00`).toISOString());
    if (to) p.set('to', new Date(`${to}T23:59:59.999`).toISOString());
    return p.toString();
  }, [flowId, status, source, debounced, from, to, offset]);

  const load = useCallback(async (quiet) => {
    if (!quiet) setLoading(true);
    try { setData(await api.get(`runs?${query}`)); setError(null); } catch (e) { setError(e); } finally { setLoading(false); }
  }, [query]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!auto) return undefined; const t = setInterval(() => load(true), 10000); return () => clearInterval(t); }, [auto, load]);

  const runs = data?.runs || [];
  const counts = data?.counts || {};
  const total30 = Object.values(counts).reduce((a, b) => a + b, 0);
  const filtersOn = flowId || status || source || q || from || to;
  const clear = () => { setParams({}, { replace: true }); setSource(''); setQ(''); setFrom(''); setTo(''); };

  const allChecked = runs.length > 0 && runs.every((r) => selected.has(r.id));
  const toggleAll = (v) => setSelected(v ? new Set(runs.map((r) => r.id)) : new Set());
  const toggleOne = (id, v) => setSelected((s) => { const n = new Set(s); if (v) n.add(id); else n.delete(id); return n; });

  const replaySelected = async () => {
    const ids = [...selected];
    if (ids.length > 50) { toast.error('You can replay up to 50 runs at once.'); return; }
    if (!(await dialog.confirm({ title: `Replay ${plural(ids.length, 'run')}?`, message: 'Each run is executed again with its original trigger data, using the latest published version of its flow. Replays use tasks.', confirmText: 'Replay' }))) return;
    setReplaying(true);
    try {
      const { results } = await api.post('runs/replay-bulk', { ids });
      const ok = results.filter((r) => r.status === 'success').length;
      const failed = results.length - ok;
      if (failed) toast.info(`${plural(results.length, 'replay')} finished: ${ok} succeeded, ${failed} did not.`);
      else toast.success(`${plural(ok, 'run')} replayed successfully`);
      setSelected(new Set());
      load();
    } catch (e) { toast.error(e.message); } finally { setReplaying(false); }
  };
  const purge = async () => {
    if (!(await dialog.confirm({ title: 'Delete runs older than 30 days?', message: 'Run history older than 30 days (except runs waiting on approvals or delays) will be permanently deleted.', danger: true, confirmText: 'Delete runs' }))) return;
    try { const r = await api.del('runs'); toast.success(`${plural(r.deleted, 'run')} deleted`); load(); } catch (e) { toast.error(e.message); }
  };

  const flowOptions = (flows || []).map((f) => ({ value: f.id, label: f.name }));
  if (flowId && flows && !flows.some((f) => f.id === flowId)) flowOptions.unshift({ value: flowId, label: 'Selected flow' });

  return (
    <div className="page page-wide" style={{ maxWidth: 1400 }}>
      <PageHeader title="History" description="Every run of every flow, with step-by-step data."
        actions={<>
          <Toggle checked={auto} onChange={setAuto} label={<span className="small">Auto-refresh</span>} />
          <Button icon={RefreshCw} onClick={() => load()} loading={loading && Boolean(data)}>Refresh</Button>
          {isAdmin && <Button variant="danger-ghost" icon={Trash2} onClick={purge}>Delete runs older than 30 days</Button>}
        </>} />

      <div className="chips" style={{ marginTop: 0, marginBottom: 14 }}>
        <button className={`chip ${!status ? 'active' : ''}`} onClick={() => setParam('status', '')}>All <span className="count">{fmtNum(total30)}</span></button>
        {Object.keys(RUN_STATUS).map((s) => (
          <button key={s} className={`chip ${status === s ? 'active' : ''}`} onClick={() => setParam('status', status === s ? '' : s)}>
            {RUN_STATUS[s].label} <span className="count">{fmtNum(counts[s] || 0)}</span>
          </button>
        ))}
        <span className="tiny subtle" style={{ alignSelf: 'center' }}>Counts cover the last 30 days</span>
      </div>

      <div className="filters">
        <Select value={flowId} onChange={(e) => setParam('flowId', e.target.value)} placeholder="All flows" options={flowOptions} aria-label="Flow" />
        <Select value={status} onChange={(e) => setParam('status', e.target.value)} placeholder="Any status" options={Object.entries(RUN_STATUS).map(([v, s]) => ({ value: v, label: s.label }))} aria-label="Status" />
        <Select value={source} onChange={(e) => setSource(e.target.value)} placeholder="Any source" options={SOURCES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))} aria-label="Source" />
        <SearchInput value={q} onChange={setQ} placeholder="Search data or errors…" />
        <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" title="From" />
        <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" title="To" />
      </div>
      {filtersOn && <div className="mb-16"><Button size="xs" variant="ghost" icon={X} onClick={clear}>Clear filters</Button></div>}

      {selected.size > 0 && (
        <div className="bulk-bar">
          <span className="bold small">{selected.size} selected</span>
          <div className="grow" />
          <Button size="sm" variant="primary" icon={Repeat} loading={replaying} onClick={replaySelected}>Replay selected</Button>
          <Button size="sm" variant="ghost" icon={X} onClick={() => setSelected(new Set())} aria-label="Clear selection" />
        </div>
      )}

      {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={() => load()} /> : !runs.length ? (
        <div className="card">
          {filtersOn ? <EmptyState icon={History} title="No runs match these filters" action={<Button onClick={clear}>Clear filters</Button>}>Try widening the date range or removing a filter.</EmptyState>
            : <EmptyState icon={History} title="No runs yet" action={<Button variant="primary" onClick={() => nav('/flows')}>Go to flows</Button>}>When your flows run, every run shows up here with the data for each step.</EmptyState>}
        </div>
      ) : (
        <>
          <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .15s' }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}><Checkbox checked={allChecked} onChange={toggleAll} aria-label="Select all runs" /></th>
                  <th>Status</th><th>Flow</th><th>Source</th><th>Started</th><th className="right">Duration</th><th className="right">Tasks</th><th>Error</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className={`clickable ${selected.has(r.id) ? 'selected' : ''}`} onClick={() => nav(`/history/${r.id}`)}>
                    <td onClick={(e) => e.stopPropagation()}><Checkbox checked={selected.has(r.id)} onChange={(v) => toggleOne(r.id, v)} aria-label="Select run" /></td>
                    <td className="nowrap">{r.status === 'running' ? <span className="row gap-4"><Spinner size={12} /><RunStatus status={r.status} /></span> : <RunStatus status={r.status} />}</td>
                    <td style={{ minWidth: 180 }}>
                      <Link to={`/history/${r.id}`} className="bold" onClick={(e) => e.stopPropagation()}>{r.flow_name || 'Deleted flow'}</Link>
                      {r.replay_of && <div className="tiny subtle">Replay</div>}
                    </td>
                    <td><Badge className="source-badge">{r.source}</Badge></td>
                    <td className="nowrap small">{fmtDate(r.started_at)} <span className="subtle">· {timeAgo(r.started_at)}</span></td>
                    <td className="right nowrap small muted">{r.finished_at ? duration(r.started_at, r.finished_at) : '—'}</td>
                    <td className="right small">{fmtNum(r.tasks_used)}</td>
                    <td><div className="err-snippet" title={r.error || ''}>{r.error || ''}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={data.total} limit={LIMIT} offset={offset} onChange={(o) => { setOffset(o); setSelected(new Set()); window.scrollTo({ top: 0 }); }} />
          {data.total <= LIMIT && <div className="tiny subtle mt-8">{plural(data.total, 'run')}</div>}
        </>
      )}
    </div>
  );
}
