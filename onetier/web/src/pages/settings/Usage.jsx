import { Link } from 'react-router-dom';
import { BarChart3, RefreshCw, Zap, TrendingUp, AlertTriangle, Gauge } from 'lucide-react';
import { useFetch } from '../../lib/context.jsx';
import { fmtNum } from '../../lib/util.js';
import { Button, BarChart, Loading, ErrorState, EmptyState, Badge } from '../../components/ui.jsx';
import { SectionHead } from './shared.jsx';

const SOURCE_LABEL = { trigger: 'Triggers', poll: 'Polling', webhook: 'Webhooks', schedule: 'Schedules', manual: 'Manual / test', api: 'REST API', mcp: 'MCP', interface: 'Interfaces', chatbot: 'Chatbots', replay: 'Replays', subflow: 'Sub-flows', email: 'Email', table: 'Tables', agent: 'Agents', event: 'App events', import: 'Imports', test: 'Tests' };
const monthLabel = (p) => new Date(`${p}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

export default function Usage() {
    const { data, error, loading, reload } = useFetch('usage');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const { period, tasks, daily, byFlow, bySource, history } = data;
  const [y, m] = period.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const byDay = Object.fromEntries(daily.map((d) => [d.day, d]));
  const chart = Array.from({ length: daysInMonth }, (_, i) => {
    const day = `${period}-${String(i + 1).padStart(2, '0')}`;
    const d = byDay[day];
    return { label: new Date(y, m - 1, i + 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), value: d?.tasks || 0 };
  });
  const runs = daily.reduce((a, d) => a + (d.runs || 0), 0);
  const errors = daily.reduce((a, d) => a + (d.errors || 0), 0);
  const maxFlow = Math.max(1, ...byFlow.map((f) => f.tasks || 0));
  const totalSource = Math.max(1, bySource.reduce((a, s) => a + (s.tasks || 0), 0));
  const resets = new Date(y, m, 1);
  const today = new Date();
  const dayOfMonth = today.getFullYear() === y && today.getMonth() === m - 1 ? today.getDate() : daysInMonth;
  const projected = dayOfMonth ? Math.round((tasks / dayOfMonth) * daysInMonth) : tasks;

  return (
    <div className="settings-section">
      <SectionHead title="Usage" description={`Activity for ${monthLabel(period)}. OneTier is free — tasks are unlimited and never billed.`}
        actions={<Button icon={RefreshCw} onClick={reload} loading={loading}>Refresh</Button>} />

      <div className="grid-4">
        <div className="card stat"><div className="stat-label"><Zap size={14} />Tasks used</div><div className="stat-value">{fmtNum(tasks)}</div><div className="small muted">unlimited · free</div></div>
        <div className="card stat"><div className="stat-label"><TrendingUp size={14} />Projected</div><div className="stat-value">{fmtNum(projected)}</div><div className="small muted">by {resets.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at this pace</div></div>
        <div className="card stat"><div className="stat-label"><Gauge size={14} />Cost</div><div className="stat-value">$0</div><div className="small muted">always free</div></div>
        <div className="card stat"><div className="stat-label"><AlertTriangle size={14} />Runs · errors</div><div className="stat-value">{fmtNum(runs)}</div><div className="small muted">{fmtNum(errors)} errored</div></div>
      </div>

      <div className="card">
        <div className="card-header"><h3>Daily tasks</h3><span className="small muted">{monthLabel(period)}</span></div>
        <div className="card-body">{tasks ? <BarChart data={chart} height={170} /> : <EmptyState icon={BarChart3} title="No tasks used yet this month">Tasks are counted for each successful action step your flows run.</EmptyState>}</div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header"><h3>Top flows by tasks</h3></div>
          {byFlow.length === 0 ? <EmptyState icon={Zap} title="No flow runs this month" /> : byFlow.map((f) => (
            <div key={f.flow_id || f.flow_name} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <div className="row between">
                {f.flow_id ? <Link to={`/flows/${f.flow_id}`} className="truncate bold">{f.flow_name || 'Untitled flow'}</Link> : <span className="truncate bold">{f.flow_name || 'Untitled flow'}</span>}
                <span className="small nowrap"><b>{fmtNum(f.tasks)}</b> <span className="muted">tasks · {fmtNum(f.runs)} runs</span></span>
              </div>
              <div className="progress" style={{ height: 5 }}><div style={{ width: `${((f.tasks || 0) / maxFlow) * 100}%` }} /></div>
            </div>
          ))}
        </div>
        <div className="card">
          <div className="card-header"><h3>Usage by source</h3></div>
          {bySource.length === 0 ? <EmptyState icon={BarChart3} title="Nothing yet" /> : [...bySource].sort((a, b) => (b.tasks || 0) - (a.tasks || 0)).map((s) => (
            <div key={s.source || 'other'} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <div className="row between">
                <span className="bold">{SOURCE_LABEL[s.source] || s.source || 'Other'}</span>
                <span className="small nowrap"><b>{fmtNum(s.tasks || 0)}</b> <span className="muted">tasks · {fmtNum(s.runs)} runs · {Math.round(((s.tasks || 0) / totalSource) * 100)}%</span></span>
              </div>
              <div className="progress" style={{ height: 5 }}><div style={{ width: `${((s.tasks || 0) / totalSource) * 100}%`, background: 'var(--accent)' }} /></div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3>Monthly history</h3></div>
        {history.length === 0 ? <EmptyState icon={BarChart3} title="No history yet">Each month's task total is recorded here.</EmptyState> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>Month</th><th className="right">Tasks</th><th /></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.period}>
                    <td className="nowrap">{monthLabel(h.period)}</td>
                    <td className="right">{fmtNum(h.tasks)}</td>
                    <td className="right">{h.period === period && <Badge color="brand">Current</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
