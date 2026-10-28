import { Fragment, useEffect, useState } from 'react';
import { ScrollText, ChevronRight, ChevronDown, RefreshCw, Download } from 'lucide-react';
import { useAuth, useFetch } from '../../lib/context.jsx';
import { fmtDate, timeAgo } from '../../lib/util.js';
import { Button, SearchInput, JsonView, Badge, Loading, ErrorState, EmptyState, Callout } from '../../components/ui.jsx';
import { SectionHead, downloadText } from './shared.jsx';

const colorFor = (action = '') => {
  if (/deleted|removed|revoked|left|failed/.test(action)) return 'red';
  if (/created|joined|invited/.test(action)) return 'green';
  if (/login|password|sso|api_key/.test(action)) return 'blue';
  return 'brand';
};

export default function AuditLog() {
  const { me, isAdmin } = useAuth();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const { data, error, loading, reload } = useFetch(isAdmin ? `audit${debounced ? `?q=${encodeURIComponent(debounced)}` : ''}` : null);

  const head = <SectionHead title="Audit log" description="Who did what in this workspace — sign-ins, member changes, API keys and every flow change."
    actions={isAdmin && data && !error && <>
      <Button icon={RefreshCw} onClick={reload} loading={loading}>Refresh</Button>
      <Button icon={Download} disabled={!data.length} onClick={() => downloadText(`onetier-audit-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(data))}>Export CSV</Button>
    </>} />;

  if (!isAdmin) return <div className="settings-section">{head}<Callout type="info">Only workspace admins and owners can view the audit log.</Callout></div>;
  return (
    <div className="settings-section">
      {head}
      <SearchInput value={q} onChange={setQ} placeholder="Search by action, target or person…" style={{ maxWidth: 420 }} />
      {loading && !data ? <Loading /> : error ? <ErrorState error={error} onRetry={reload} /> : data.length === 0 ? (
        <div className="card"><EmptyState icon={ScrollText} title={debounced ? 'No matching events' : 'No events yet'}>{debounced ? 'Try a different search term.' : 'Events appear as people use the workspace.'}</EmptyState></div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th style={{ width: 28 }} /><th>Time</th><th>User</th><th>Action</th><th>Target</th></tr></thead>
            <tbody>
              {data.map((r) => {
                const hasMeta = r.meta && Object.keys(r.meta).length > 0;
                const isOpen = open === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr className={`audit-row ${hasMeta ? 'clickable' : ''}`} onClick={() => hasMeta && setOpen(isOpen ? null : r.id)}>
                      <td className="subtle">{hasMeta && (isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />)}</td>
                      <td className="nowrap" title={new Date(r.created_at).toLocaleString()}>{fmtDate(r.created_at)}<div className="tiny subtle">{timeAgo(r.created_at)}</div></td>
                      <td className="nowrap">{r.user_name || 'System'}</td>
                      <td><Badge color={colorFor(r.action)}>{r.action}</Badge></td>
                      <td style={{ maxWidth: 320, wordBreak: 'break-word' }}>{r.target || <span className="subtle">—</span>}</td>
                    </tr>
                    {isOpen && <tr className="expand-row"><td /><td colSpan={4}><JsonView data={r.meta} maxHeight={240} /></td></tr>}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data?.length === 500 && <p className="small muted">Showing the 500 most recent matching events. Narrow your search to see older ones.</p>}
    </div>
  );
}

function toCsv(rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return ['time,user,action,target,metadata', ...rows.map((r) => [r.created_at, r.user_name, r.action, r.target, JSON.stringify(r.meta || {})].map(esc).join(','))].join('\n');
}
