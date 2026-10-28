// Modals and drawers used by the flow editor.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ExternalLink, RotateCcw, Eye, ArrowLeft, ChevronRight, CheckCircle2 } from 'lucide-react';
import api from '../../../lib/api.js';
import { useApps, useToast, useDialog, useFetch } from '../../../lib/context.jsx';
import { fmtDate, timeAgo, duration } from '../../../lib/util.js';
import {
  Modal, Drawer, Button, Field, Input, Textarea, Select, Toggle, RunStatus, Loading, ErrorState, EmptyState, JsonView, AppIcon, Callout, Badge,
} from '../../../components/ui.jsx';
import { walkSteps, countSteps } from './defUtils.js';

// ---------------------------------------------------------------- test run result
export function TestRunModal({ result, onClose }) {
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!result?.runId) return;
    api.get(`runs/${result.runId}`).then(setRun).catch(setError);
  }, [result?.runId]);
  const status = run?.status || result?.status;
  return (
    <Modal title="Test run finished" size="lg" onClose={onClose}
      subtitle="Test runs use your sample trigger data and don’t count toward tasks. Actions really execute."
      footer={<>
        <Button onClick={onClose}>Close</Button>
        {result?.runId && <Link className="btn btn-primary" to={`/history/${result.runId}`}><ExternalLink />Open in history</Link>}
      </>}>
      <div className="row between mb-16">
        <div className="row"><span className="bold">Result</span>{status && <RunStatus status={status} />}</div>
        {run && <span className="small muted">{duration(run.started_at, run.finished_at)}</span>}
      </div>
      {(run?.error || result?.error) && <div className="mb-16"><Callout type={status === 'filtered' ? 'warning' : 'danger'} icon={AlertTriangle}>{run?.error || result?.error}</Callout></div>}
      {error && <ErrorState error={error} />}
      {!run && !error && <Loading label="Loading step results…" />}
      {run && (
        <div className="fe-runsteps">
          {run.steps.map((s) => <RunStepRow key={s.id} s={s} />)}
          {!run.steps.length && <EmptyState title="No steps ran">The run stopped before any step executed.</EmptyState>}
        </div>
      )}
    </Modal>
  );
}
function RunStepRow({ s }) {
  const { getApp } = useApps();
  const [open, setOpen] = useState(false);
  return (
    <div className="fe-runstep">
      <button type="button" className="fe-runstep-head" onClick={() => setOpen((o) => !o)}>
        <AppIcon app={getApp(s.app)} size={26} />
        <span className="grow truncate small bold">{s.seq}. {s.title}</span>
        <RunStatus status={s.status} />
        <ChevronRight size={16} className={`subtle fe-chev ${open ? 'open' : ''}`} />
      </button>
      {s.error && <div className="fe-runstep-err small">{s.error}</div>}
      {open && (
        <div className="fe-runstep-body">
          {s.input && Object.keys(s.input).length > 0 && <><div className="label mb-8">Data in</div><JsonView data={s.input} maxHeight={200} /></>}
          <div className="label mb-8 mt-8">Data out</div><JsonView data={s.output ?? null} maxHeight={240} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- publish issues
export function IssuesModal({ issues, numbers, onPick, onClose, title = 'Fix these issues before publishing' }) {
  return (
    <Modal title={title} onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Got it</Button>}>
      <p className="muted small mb-16">Click an issue to jump to the step.</p>
      <div className="fe-issues">
        {issues.map((it, i) => (
          <button key={i} type="button" className="fe-issue" disabled={!it.stepId} onClick={() => { onPick(it.stepId); onClose(); }}>
            <AlertTriangle size={16} />
            <span className="grow">{it.message}</span>
            {it.stepId && <span className="badge">{it.stepId === 'trigger' ? 'Trigger' : `Step ${numbers[it.stepId] ?? ''}`}</span>}
          </button>
        ))}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- run now (manual trigger)
export function RunNowModal({ flow, inputs, onClose, onDone }) {
  const toast = useToast();
  const names = (inputs || []).map((x) => String(x).trim()).filter(Boolean);
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true);
    try {
      const r = await api.post(`flows/${flow.id}/run`, { mode: 'live', data: { inputs: values, triggered_at: new Date().toISOString() } });
      if (r.status === 'success' || r.status === 'waiting') toast.success(r.status === 'waiting' ? 'Run started and is waiting (delay or approval).' : 'Flow ran successfully.');
      else toast.error(r.error || `Run finished with status “${r.status}”.`);
      onDone?.(r);
      onClose();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Run “${flow.name}”`} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Run flow</Button></>}>
      <form onSubmit={submit}>
        {!names.length && <p className="muted">This flow has no input fields. It will run with the current time and your name as trigger data.</p>}
        {names.map((n) => (
          <Field key={n} label={n}><Input value={values[n] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [n]: e.target.value }))} autoFocus={n === names[0]} /></Field>
        ))}
        <p className="tiny subtle mt-8">Live runs use tasks and appear in history.</p>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- versions
export function VersionsDrawer({ flow, onClose, onRestored }) {
  const { getApp } = useApps();
  const toast = useToast();
  const dialog = useDialog();
  const { data, error, loading, reload } = useFetch(`flows/${flow.id}/versions`);
  const [viewing, setViewing] = useState(null);
  const [busy, setBusy] = useState(null);
  const view = async (v) => {
    setBusy(v.version);
    try { setViewing(await api.get(`flows/${flow.id}/versions/${v.version}`)); } catch (e) { toast.error(e.message); } finally { setBusy(null); }
  };
  const restore = async (v) => {
    if (!(await dialog.confirm({ title: `Restore version ${v.version}?`, message: 'Your current draft will be replaced with this version. The live (published) flow is not changed until you publish again.', confirmText: 'Restore' }))) return;
    try { await api.post(`flows/${flow.id}/versions/${v.version}/restore`); toast.success(`Version ${v.version} restored to your draft`); onRestored(); onClose(); }
    catch (e) { toast.error(e.message); }
  };
  const stepsOf = (def) => { const out = [{ app: def?.trigger?.app, label: def?.trigger?.title, ev: getApp(def?.trigger?.app)?.triggers?.[def?.trigger?.event]?.name }]; walkSteps(def?.steps, (s) => out.push({ app: s.app, label: s.title, ev: getApp(s.app)?.actions?.[s.action]?.name })); return out; };
  return (
    <Drawer title={viewing ? `Version ${viewing.version}` : 'Version history'} onClose={onClose}
      headerRight={viewing && <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={() => setViewing(null)}>All versions</Button>}
      footer={viewing && <><Button onClick={() => setViewing(null)}>Back</Button><Button variant="primary" icon={RotateCcw} onClick={() => restore(viewing)}>Restore this version</Button></>}>
      {viewing ? (
        <div>
          <div className="small muted mb-16">Published {fmtDate(viewing.created_at)}{viewing.note ? ` — “${viewing.note}”` : ''} · {countSteps(viewing.definition?.steps) + 1} steps</div>
          <div className="col mb-16" style={{ gap: 6 }}>
            {stepsOf(viewing.definition).map((s, i) => {
              const app = getApp(s.app);
              return <div key={i} className="row small"><span className="subtle" style={{ width: 22 }}>{i + 1}.</span><AppIcon app={app} size={22} /><span className="truncate">{s.label || `${app?.name || s.app || 'Empty'}${s.ev ? ` · ${s.ev}` : ''}`}</span></div>;
            })}
          </div>
          <div className="label mb-8">Definition</div>
          <JsonView data={viewing.definition} maxHeight={480} />
        </div>
      ) : loading ? <Loading /> : error ? <ErrorState error={error} onRetry={reload} /> : !data?.length ? (
        <EmptyState title="No versions yet">Each time you publish, a version is saved here so you can review or restore it.</EmptyState>
      ) : (
        <div className="fe-versions">
          {data.map((v) => (
            <div key={v.id} className="fe-version">
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row"><span className="bold">Version {v.version}</span>{v.version === flow.version && <Badge color="green">Live</Badge>}</div>
                <div className="tiny subtle">{fmtDate(v.created_at)} ({timeAgo(v.created_at)}){v.author ? ` · ${v.author}` : ''}</div>
                {v.note && <div className="small muted mt-8">“{v.note}”</div>}
              </div>
              <Button size="sm" variant="ghost" icon={Eye} loading={busy === v.version} onClick={() => view(v)}>View</Button>
              <Button size="sm" icon={RotateCcw} onClick={() => restore(v)}>Restore</Button>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------- settings
export function SettingsDrawer({ flow, onClose, onSaved, plan }) {
  const toast = useToast();
  const folders = useFetch('folders');
  const [form, setForm] = useState({
    description: flow.description || '',
    folderId: flow.folder_id || '',
    autoreplay: flow.settings?.autoreplay ?? Boolean(plan?.autoreplay),
    notifyOnError: flow.settings?.notifyOnError !== false,
    autoOffAfter: flow.settings?.autoOffAfter ?? 10,
  });
  const [busy, setBusy] = useState(false);
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  const n = Number(form.autoOffAfter);
  const invalid = !Number.isInteger(n) || n < 1 || n > 1000;
  const save = async () => {
    if (invalid) return;
    setBusy(true);
    try {
      await api.put(`flows/${flow.id}`, {
        description: form.description,
        folderId: form.folderId || null,
        settings: { autoreplay: form.autoreplay, notifyOnError: form.notifyOnError, autoOffAfter: n },
      });
      toast.success('Flow settings saved');
      onSaved();
      onClose();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Drawer title="Flow settings" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={invalid} onClick={save}>Save settings</Button></>}>
      <Field label="Description" help="Helps your team understand what this flow does.">
        <Textarea value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="e.g. Routes new leads to Slack and logs them in the CRM table" />
      </Field>
      <Field label="Folder">
        {folders.error ? <div className="error-text">{folders.error.message}</div> : (
          <Select value={form.folderId} onChange={(e) => set({ folderId: e.target.value })} placeholder={folders.loading ? 'Loading…' : 'No folder'}
            options={(folders.data || []).map((f) => ({ value: f.id, label: f.name }))} />
        )}
      </Field>
      <hr />
      <div className="fe-setting">
        <div className="grow"><div className="bold small">Autoreplay</div><div className="help">Automatically retry failed steps up to 3 times.</div></div>
        <Toggle checked={form.autoreplay} onChange={(v) => set({ autoreplay: v })} />
      </div>
      <div className="fe-setting">
        <div className="grow"><div className="bold small">Notify me on errors</div><div className="help">Send an in-app notification when a run fails.</div></div>
        <Toggle checked={form.notifyOnError} onChange={(v) => set({ notifyOnError: v })} />
      </div>
      <div className="fe-setting">
        <div className="grow"><div className="bold small">Turn off after consecutive errors</div><div className="help">Protects you from runaway failures.</div></div>
        <Input type="number" min={1} max={1000} style={{ width: 90 }} value={form.autoOffAfter} invalid={invalid} onChange={(e) => set({ autoOffAfter: e.target.value })} />
      </div>
      {invalid && <div className="error-text">Enter a whole number between 1 and 1000.</div>}
      <hr />
      <div className="tiny subtle">Created {fmtDate(flow.created_at)}{flow.owner ? ` by ${flow.owner}` : ''} · last edited {timeAgo(flow.updated_at)}</div>
      {flow.version > 0 && <div className="tiny subtle mt-8"><CheckCircle2 size={12} /> Published version {flow.version}</div>}
    </Drawer>
  );
}
