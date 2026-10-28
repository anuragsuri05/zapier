import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Repeat, ExternalLink, CheckCircle2, XCircle, MinusCircle, Hourglass, Loader2, CircleDot, ChevronDown, ChevronRight, UserCheck, Check, X, AlertTriangle,
} from 'lucide-react';
import api from '../../lib/api.js';
import { useApps, useToast } from '../../lib/context.jsx';
import { fmtDate, timeAgo, duration, fmtNum } from '../../lib/util.js';
import {
  Button, Badge, RunStatus, Callout, JsonView, Tabs, Loading, ErrorState, EmptyState, AppIcon, Textarea, Field, Modal, Menu,
} from '../../components/ui.jsx';
import '../core.css';

const STEP_ICON = { success: CheckCircle2, error: XCircle, halted: XCircle, filtered: MinusCircle, skipped: MinusCircle, waiting: Hourglass, running: Loader2 };
const STEP_LABEL = { success: 'Success', error: 'Error', halted: 'Halted', filtered: 'Stopped', skipped: 'Skipped', waiting: 'Waiting', running: 'Running' };
const STEP_BADGE = { success: 'green', error: 'red', halted: 'red', filtered: 'yellow', skipped: 'yellow', waiting: 'blue', running: 'brand' };

export default function RunDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);
  const [replaying, setReplaying] = useState(null);

  const load = useCallback(async () => {
    try { setRun(await api.get(`runs/${id}`)); setError(null); } catch (e) { setError(e); }
  }, [id]);
  useEffect(() => { setRun(null); load(); }, [load]);
  const live = run && ['running', 'waiting'].includes(run.status);
  useEffect(() => { if (!live) return undefined; const t = setInterval(load, 3000); return () => clearInterval(t); }, [live, load]);

  const replay = async (original) => {
    setReplaying(original ? 'original' : 'latest');
    try {
      const r = await api.post(`runs/${id}/replay`, original ? { version: 'original' } : {});
      toast.success(r.status === 'success' ? 'Replay succeeded' : `Replay finished: ${r.status}`);
      if (r.runId) nav(`/history/${r.runId}`);
    } catch (e) { toast.error(e.message); } finally { setReplaying(null); }
  };

  if (error && !run) return <div className="page"><BackLink /><ErrorState error={error} onRetry={load} /></div>;
  if (!run) return <div className="page"><Loading /></div>;

  const totalBillable = run.steps.reduce((a, s) => a + (s.billable || 0), 0);

  return (
    <div className="page page-narrow" style={{ maxWidth: 1000 }}>
      <BackLink />
      <div className="page-header">
        <div style={{ minWidth: 0 }}>
          <div className="row wrap"><RunStatus status={run.status} />{live && <span className="tiny subtle row gap-4"><Loader2 size={12} className="spin" />Live — updating every 3s</span>}</div>
          <h1 className="mt-8 truncate">{run.flow_name || 'Deleted flow'}</h1>
          <p className="muted small mono" style={{ marginTop: 4 }}>{run.id}</p>
        </div>
        <div className="row wrap">
          {run.flow_id && <Button icon={ExternalLink} onClick={() => nav(`/flows/${run.flow_id}`)}>Open flow</Button>}
          <div className="row" style={{ gap: 0 }}>
            <Button variant="primary" icon={Repeat} loading={replaying === 'latest'} disabled={Boolean(replaying) || !run.flow_id} onClick={() => replay(false)}
              style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}>Replay</Button>
            <Menu width={260} trigger={<Button variant="primary" icon={ChevronDown} aria-label="More replay options" disabled={Boolean(replaying) || !run.flow_id}
              style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: '1px solid rgba(255,255,255,.25)' }} />} items={[
              { label: 'Replay with latest version', icon: Repeat, onClick: () => replay(false) },
              { label: `Replay with original version${run.version ? ` (v${run.version})` : ''}`, icon: Repeat, onClick: () => replay(true) },
            ]} />
          </div>
        </div>
      </div>

      {run.error && (
        <div className="mb-16"><Callout type={run.status === 'filtered' ? 'warning' : 'danger'} icon={AlertTriangle}>
          <b>{run.status === 'filtered' ? 'Stopped' : 'Error'}:</b> {run.error}
        </Callout></div>
      )}

      {run.approval?.status === 'pending' && <ApprovalBox approval={run.approval} onDone={load} />}

      <div className="card card-pad mb-16">
        <div className="run-meta">
          <Meta k="Flow" v={run.flow_id ? <Link to={`/flows/${run.flow_id}`}>{run.flow_name}</Link> : run.flow_name || '—'} />
          <Meta k="Source" v={<Badge className="source-badge">{run.source}</Badge>} />
          <Meta k="Version" v={run.version ? `v${run.version}` : 'Draft'} />
          <Meta k="Started" v={<span title={timeAgo(run.started_at)}>{fmtDate(run.started_at)}</span>} />
          <Meta k="Finished" v={run.finished_at ? fmtDate(run.finished_at) : live ? 'In progress' : '—'} />
          <Meta k="Duration" v={run.finished_at ? duration(run.started_at, run.finished_at) : '—'} />
          <Meta k="Tasks used" v={fmtNum(run.tasks_used)} />
          {run.replay_of && <Meta k="Replay of" v={<Link to={`/history/${run.replay_of}`} className="mono small">{run.replay_of}</Link>} />}
        </div>
      </div>

      <div className="section-title" style={{ marginTop: 8 }}><h2>Steps</h2><span className="small muted">{run.steps.length} step{run.steps.length === 1 ? '' : 's'} · {totalBillable} billable task{totalBillable === 1 ? '' : 's'}</span></div>
      <div className="timeline">
        <TriggerItem run={run} />
        {run.steps.map((s) => <StepItem key={s.id} step={s} />)}
        {!run.steps.length && <EmptyState title="No steps ran">{run.status === 'halted' ? 'The run was halted before any step executed.' : 'This run has no recorded steps.'}</EmptyState>}
      </div>
    </div>
  );
}

const BackLink = () => <Link to="/history" className="row small muted mb-16" style={{ gap: 4, display: 'inline-flex' }}><ArrowLeft size={14} />History</Link>;
const Meta = ({ k, v }) => <div style={{ minWidth: 0 }}><div className="k">{k}</div><div className="v">{v}</div></div>;

function TriggerItem({ run }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tl-item">
      <div className="tl-dot tl-running"><CircleDot /></div>
      <div className="card tl-card">
        <div className="card-header" onClick={() => setOpen((o) => !o)} role="button" aria-expanded={open}>
          <div className="row grow" style={{ minWidth: 0 }}>{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}<span className="bold">Trigger data</span><Badge className="source-badge">{run.source}</Badge></div>
          <span className="tiny subtle">{fmtDate(run.started_at)}</span>
        </div>
        {open && <div className="card-body"><JsonView data={run.trigger_data ?? {}} maxHeight={360} /></div>}
      </div>
    </div>
  );
}

function StepItem({ step }) {
  const { getApp } = useApps();
  const [open, setOpen] = useState(step.status === 'error');
  const [tab, setTab] = useState(step.status === 'error' ? 'in' : 'out');
  const app = getApp(step.app);
  const act = app?.actions?.[step.action];
  const Icon = STEP_ICON[step.status] || CircleDot;
  return (
    <div className="tl-item">
      <div className={`tl-dot tl-${step.status}`}><Icon className={step.status === 'running' ? 'spin' : undefined} /></div>
      <div className="card tl-card">
        <div className="card-header" onClick={() => setOpen((o) => !o)} role="button" aria-expanded={open}>
          <div className="row grow" style={{ minWidth: 0 }}>
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <AppIcon app={app} size={26} />
            <div style={{ minWidth: 0 }}>
              <div className="bold truncate">{step.seq}. {step.title || act?.name || step.action}</div>
              <div className="tiny subtle truncate">{app?.name || step.app}{act ? ` · ${act.name}` : ''}</div>
            </div>
          </div>
          <div className="row wrap" style={{ justifyContent: 'flex-end' }}>
            {step.attempts > 1 && <Badge color="yellow">{step.attempts} attempts</Badge>}
            {step.billable > 0 && <Badge>{step.billable} task{step.billable === 1 ? '' : 's'}</Badge>}
            <Badge color={STEP_BADGE[step.status]} dot>{STEP_LABEL[step.status] || step.status}</Badge>
            <span className="tiny subtle nowrap">{step.finished_at ? duration(step.started_at, step.finished_at) : '…'}</span>
          </div>
        </div>
        {step.error && <div style={{ padding: '10px 16px', color: 'var(--danger)', fontSize: 13, borderBottom: open ? '1px solid var(--border)' : 0, wordBreak: 'break-word' }}>{step.error}</div>}
        {open && (
          <div className="card-body" style={{ paddingTop: 4 }}>
            <Tabs value={tab} onChange={setTab} tabs={[{ value: 'in', label: 'Data in' }, { value: 'out', label: 'Data out' }]} />
            <JsonView data={tab === 'in' ? step.input ?? {} : step.output ?? (step.status === 'waiting' ? 'Waiting…' : null)} maxHeight={420} />
            <div className="tiny subtle mt-8">Started {fmtDate(step.started_at)}{step.finished_at ? ` · finished ${fmtDate(step.finished_at)}` : ''} · step id <span className="mono">{step.step_id}</span></div>
          </div>
        )}
      </div>
    </div>
  );
}

function ApprovalBox({ approval, onDone }) {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState('');
  const decide = async (decision) => {
    setBusy(decision);
    try {
      await api.post(`approvals/${approval.id}/decide`, { decision, comment });
      toast.success(decision === 'approve' ? 'Approved — the run is continuing' : 'Rejected — the run was stopped');
      setRejecting(false);
      onDone();
    } catch (e) { toast.error(e.message); onDone(); } finally { setBusy(null); }
  };
  return (
    <div className="card mb-16" style={{ borderColor: 'var(--info)' }}>
      <div className="card-header"><div className="row"><UserCheck size={18} style={{ color: 'var(--info)' }} /><h3>Waiting for approval</h3></div><span className="tiny subtle">Requested {timeAgo(approval.created_at)}</span></div>
      <div className="card-body">
        <div className="bold">{approval.title || 'Approval required'}</div>
        {approval.details && <div className="approval-details">{approval.details}</div>}
        <Field label="Comment (optional)" className="mt-16"><Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add context for the decision…" /></Field>
        <div className="row mt-16">
          <Button variant="success" icon={Check} loading={busy === 'approve'} disabled={Boolean(busy)} onClick={() => decide('approve')}>Approve</Button>
          <Button variant="danger" icon={X} disabled={Boolean(busy)} onClick={() => setRejecting(true)}>Reject</Button>
        </div>
      </div>
      {rejecting && (
        <Modal title="Reject this request?" size="sm" onClose={() => setRejecting(false)}
          footer={<><Button onClick={() => setRejecting(false)}>Cancel</Button><Button variant="danger" loading={busy === 'reject'} onClick={() => decide('reject')}>Reject</Button></>}>
          <p className="muted mb-16">The run will stop at this step.</p>
          <Field label="Reason (optional)"><Textarea autoFocus rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Why is this being rejected?" /></Field>
        </Modal>
      )}
    </div>
  );
}
