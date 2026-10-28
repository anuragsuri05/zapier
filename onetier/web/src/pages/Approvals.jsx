import { useState } from 'react';
import { Link } from 'react-router-dom';
import { UserCheck, Check, X, ExternalLink, Clock, RefreshCw } from 'lucide-react';
import api from '../lib/api.js';
import { useFetch, useToast } from '../lib/context.jsx';
import { fmtDate, timeAgo } from '../lib/util.js';
import { Button, Badge, Tabs, Modal, Field, Textarea, Loading, ErrorState, EmptyState, PageHeader } from '../components/ui.jsx';
import './core.css';

const STATUS_BADGE = { pending: ['blue', 'Pending'], approved: ['green', 'Approved'], rejected: ['red', 'Rejected'] };

export default function Approvals() {
  const toast = useToast();
  const [tab, setTab] = useState('pending');
  const { data, error, loading, reload, setData } = useFetch(`approvals?status=${tab}`);
  const pending = useFetch('approvals?status=pending');
  const [busy, setBusy] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [comment, setComment] = useState('');

  const decide = async (ap, decision, note = '') => {
    setBusy(`${ap.id}:${decision}`);
    try {
      await api.post(`approvals/${ap.id}/decide`, { decision, comment: note });
      toast.success(decision === 'approve' ? `Approved “${ap.title || 'request'}” — the run is continuing` : `Rejected “${ap.title || 'request'}”`);
      setRejecting(null); setComment('');
      if (tab === 'pending') setData((rows) => rows.filter((r) => r.id !== ap.id));
      reload(); pending.reload();
    } catch (e) { toast.error(e.message); reload(); pending.reload(); } finally { setBusy(null); }
  };

  return (
    <div className="page page-narrow">
      <PageHeader title="Approvals" description="Flows with a human-approval step pause here until someone approves or rejects them."
        actions={<Button icon={RefreshCw} onClick={() => { reload(); pending.reload(); }}>Refresh</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'pending', label: 'Pending', count: pending.data?.length },
        { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }, { value: 'all', label: 'All' },
      ]} />

      {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : !data?.length ? (
        <div className="card">
          <EmptyState icon={UserCheck} title={tab === 'pending' ? 'Nothing waiting for you' : `No ${tab === 'all' ? '' : `${tab} `}approvals yet`}>
            {tab === 'pending' ? 'Add a “Request approval” step to a flow and requests will appear here.' : 'Decided approvals are listed here for reference.'}
          </EmptyState>
        </div>
      ) : (
        <div className="col" style={{ gap: 12, opacity: loading ? 0.6 : 1 }}>
          {data.map((ap) => {
            const [color, label] = STATUS_BADGE[ap.status] || ['', ap.status];
            return (
              <div key={ap.id} className="card">
                <div className="card-body">
                  <div className="row between wrap" style={{ alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <h3>{ap.title || 'Approval required'}</h3>
                      <div className="small muted mt-8 row wrap" style={{ gap: 6 }}>
                        <Clock size={13} /><span title={fmtDate(ap.created_at)}>Requested {timeAgo(ap.created_at)}</span>
                        {ap.flow_name && <>· <Link to={`/flows/${ap.flow_id}`}>{ap.flow_name}</Link></>}
                      </div>
                    </div>
                    <Badge color={color} dot>{label}</Badge>
                  </div>
                  {ap.details && <div className="approval-details">{ap.details}</div>}
                  {ap.status !== 'pending' && (
                    <div className="small mt-16 muted">
                      {label} by <b style={{ color: 'var(--text)' }}>{ap.decided_by || 'System'}</b>{ap.decided_at ? ` · ${fmtDate(ap.decided_at)}` : ''}
                      {ap.comment && <div className="mt-8" style={{ whiteSpace: 'pre-wrap', color: 'var(--text)' }}>“{ap.comment}”</div>}
                    </div>
                  )}
                  <div className="row wrap mt-16">
                    {ap.status === 'pending' && <>
                      <Button variant="success" icon={Check} loading={busy === `${ap.id}:approve`} disabled={Boolean(busy)} onClick={() => decide(ap, 'approve')}>Approve</Button>
                      <Button variant="danger" icon={X} disabled={Boolean(busy)} onClick={() => { setComment(''); setRejecting(ap); }}>Reject</Button>
                    </>}
                    <div className="grow" />
                    <Link to={`/history/${ap.run_id}`} className="btn btn-ghost btn-sm"><ExternalLink />View run</Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {rejecting && (
        <Modal title="Reject request" subtitle={rejecting.title} size="sm" onClose={() => setRejecting(null)}
          footer={<><Button onClick={() => setRejecting(null)}>Cancel</Button><Button variant="danger" loading={busy === `${rejecting.id}:reject`} onClick={() => decide(rejecting, 'reject', comment)}>Reject</Button></>}>
          <p className="muted mb-16">The run stops at the approval step. The comment is saved with the decision.</p>
          <Field label="Comment (optional)"><Textarea autoFocus rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Why is this being rejected?" /></Field>
        </Modal>
      )}
    </div>
  );
}
