// Right-hand panel: step-wise setup of the selected trigger / action / path.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  X, ChevronRight, Plus, AlertTriangle, FlaskConical, Play, RefreshCw, CheckCircle2, Info, Split, Trash2, Clock, Webhook, Crown, Lock,
} from 'lucide-react';
import api from '../../../lib/api.js';
import { useApps, useToast, useDialog } from '../../../lib/context.jsx';
import { timeAgo, fmtDate } from '../../../lib/util.js';
import {
  Button, Field, Input, Select, Toggle, AppIcon, Callout, CopyField, JsonView, Badge, Tabs, Spinner,
} from '../../../components/ui.jsx';
import { useEditor, VarCtx } from './context.js';
import AppPicker from './AppPicker.jsx';
import { FieldRow, ConditionsEditor } from './fields.jsx';
import {
  findStep, findPath, updateStep, updatePath, produce, priorSteps, defaultParams, isEmptyValue, newPathId, conditionSummary,
} from './defUtils.js';

// ---------------------------------------------------------------- variables available to a step
export function useVarGroups(def, targetId) {
  const { getApp } = useApps();
  const { numbers, testOutputs } = useEditor();
  return useMemo(() => {
    const groups = [];
    const t = def.trigger || {};
    if (targetId === 'trigger') return { groups, scopes: {} };
    const tApp = getApp(t.app);
    const tdef = tApp?.triggers?.[t.event];
    if (tApp) {
      groups.push({
        key: 'trigger', app: tApp, label: `1. ${tApp.name} · ${tdef?.name || 'Trigger'}`,
        data: testOutputs.trigger ?? t.sample ?? tdef?.sample ?? {}, hint: t.sample ? '' : 'example data',
      });
    }
    const { steps, inLoop } = priorSteps(def, targetId);
    let loopStep = null;
    for (const st of steps) {
      const app = getApp(st.app);
      const act = app?.actions?.[st.action];
      if (st.app === 'looping') loopStep = st;
      if (!app) continue;
      const tested = testOutputs[st.id] ?? st.sample;
      groups.push({
        key: st.id, app, label: `${numbers[st.id] || '?'}. ${st.title || `${app.name} · ${act?.name || 'Action'}`}`,
        data: tested ?? act?.sample ?? {}, hint: tested ? '' : 'example data',
      });
    }
    if (inLoop) {
      const items = loopStep ? (testOutputs[loopStep.id] ?? loopStep.sample)?.items : null;
      const total = Array.isArray(items) ? items.length : 3;
      groups.push({ key: 'loop', label: 'Current loop item', data: { item: Array.isArray(items) ? items[0] : 'sample item', index: 0, iteration: 1, total, is_last: total === 1 } });
    }
    const scopes = Object.fromEntries(groups.map((g) => [g.key, g.data]));
    return { groups, scopes };
  }, [def, targetId, getApp, numbers, testOutputs]);
}

// ---------------------------------------------------------------- panel shell
export default function SidePanel({ selection, onClose, onSelect }) {
  if (!selection) return null;
  if (selection.type === 'path') return <PathPanel key={`${selection.stepId}:${selection.pathId}`} selection={selection} onClose={onClose} onSelect={onSelect} />;
  return <NodePanel key={selection.type === 'trigger' ? 'trigger' : selection.id} selection={selection} onClose={onClose} onSelect={onSelect} />;
}

function NodePanel({ selection, onClose, onSelect }) {
  const { getApp } = useApps();
  const { def, setDef, numbers, plan, issues, connections } = useEditor();
  const isTrigger = selection.type === 'trigger';
  const id = isTrigger ? 'trigger' : selection.id;
  const node = isTrigger ? def.trigger : findStep(def, id)?.step;
  const app = node ? getApp(node.app) : null;
  const evKey = isTrigger ? node?.event : node?.action;
  const ev = app ? (isTrigger ? app.triggers : app.actions)?.[evKey] : null;
  const [stage, setStage] = useState(() => (!app || !ev || (app.auth && !node?.connectionId) ? 'setup' : 'configure'));
  const [showErrors, setShowErrors] = useState(false);
  const vars = useVarGroups(def, id);

  if (!node) return null;

  const patch = (p) => setDef((d) => (isTrigger
    ? produce(d, (x) => { x.trigger = typeof p === 'function' ? p(x.trigger) : { ...x.trigger, ...p }; })
    : updateStep(d, id, p)));
  const setParam = (key, value) => patch((n) => ({ ...n, params: { ...(n.params || {}), [key]: value } }));

  const pickApp = (a) => {
    const evs = (isTrigger ? a.triggers : a.actions) || {};
    const keys = Object.keys(evs);
    const only = keys.length === 1 ? keys[0] : null;
    patch((n) => {
      const next = { ...n, app: a.key, connectionId: undefined, params: only ? defaultParams(evs[only].fields) : {}, sample: undefined };
      if (isTrigger) next.event = only; else next.action = only;
      if (!isTrigger && a.key === 'paths' && !(n.paths || []).length) {
        next.paths = [
          { id: newPathId(), name: 'Path A', conditions: [], steps: [] },
          { id: newPathId(), name: 'Path B', conditions: [], steps: [] },
        ];
      }
      if (!isTrigger && a.key === 'looping' && !Array.isArray(n.steps)) next.steps = [];
      if (!isTrigger && a.key !== 'paths') delete next.paths;
      if (!isTrigger && a.key !== 'looping') delete next.steps;
      return next;
    });
    const conns = connections.filter((c) => c.app === a.key);
    if (a.auth && conns.length === 1) patch({ connectionId: conns[0].id });
  };
  const pickEvent = (key) => patch((n) => ({ ...n, [isTrigger ? 'event' : 'action']: key || null, params: key ? { ...defaultParams((isTrigger ? app.triggers : app.actions)[key]?.fields), ...pickCompatible(n.params, (isTrigger ? app.triggers : app.actions)[key]?.fields) } : {}, sample: undefined }));

  const missing = (ev?.fields || []).filter((f) => f.required && f.type !== 'conditions' && isEmptyValue(node.params?.[f.key])).map((f) => f.key);
  const setupDone = Boolean(app && ev && (!app.auth || node.connectionId));
  const stages = [
    { value: 'setup', label: <span className="row gap-4">{setupDone ? <CheckCircle2 size={14} className="fe-ok" /> : <span className="fe-stage-num">1</span>}Setup</span> },
    { value: 'configure', label: <span className="row gap-4">{setupDone && !missing.length ? <CheckCircle2 size={14} className="fe-ok" /> : <span className="fe-stage-num">2</span>}Configure</span> },
    { value: 'test', label: <span className="row gap-4">{(isTrigger ? node.sample : node.sample) ? <CheckCircle2 size={14} className="fe-ok" /> : <span className="fe-stage-num">3</span>}Test</span> },
  ];
  const next = () => {
    if (stage === 'setup') setStage('configure');
    else if (stage === 'configure') { setShowErrors(true); setStage('test'); }
    else onClose();
  };
  const nodeIssues = issues[id] || [];
  const title = node.title || (app ? `${app.name}${ev ? ` · ${ev.name}` : ''}` : isTrigger ? 'Choose a trigger' : 'Choose an action');

  return (
    <aside className="editor-side fe-side" aria-label="Step settings">
      <div className="editor-side-header">
        <AppIcon app={app} size={34} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="tiny subtle bold fe-upper">{numbers[id]}. {isTrigger ? 'Trigger' : 'Action'}</div>
          <div className="bold truncate" title={title}>{title}</div>
        </div>
        <Button variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Close panel" />
      </div>
      <div className="fe-side-tabs"><Tabs tabs={stages} value={stage} onChange={setStage} /></div>
      <VarCtx.Provider value={vars}>
        <div className="editor-side-body">
          {nodeIssues.length > 0 && stage !== 'setup' && showErrors && (
            <Callout type="warning" icon={AlertTriangle}><div className="bold mb-8" style={{ marginBottom: 4 }}>This step needs attention</div>{nodeIssues.map((m, i) => <div key={i}>• {m}</div>)}</Callout>
          )}
          {stage === 'setup' && (
            <SetupStage isTrigger={isTrigger} node={node} app={app} ev={ev} pickApp={pickApp} pickEvent={pickEvent} patch={patch} plan={plan} />
          )}
          {stage === 'configure' && (
            !app || !ev ? <Callout type="info" icon={Info}>Choose an app and {isTrigger ? 'trigger event' : 'action'} in Setup first.</Callout>
              : <ConfigureStage node={node} app={app} ev={ev} setParam={setParam} showErrors={showErrors} missing={missing} isTrigger={isTrigger} onSelect={onSelect} />
          )}
          {stage === 'test' && (
            !app || !ev ? <Callout type="info" icon={Info}>Finish setting up this step before testing it.</Callout>
              : isTrigger ? <TriggerTest node={node} app={app} ev={ev} patch={patch} /> : <ActionTest node={node} app={app} ev={ev} patch={patch} vars={vars} />
          )}
        </div>
      </VarCtx.Provider>
      <div className="editor-side-footer">
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button variant="primary" onClick={next} disabled={stage === 'setup' && !(app && ev)}>
          {stage === 'test' ? 'Done' : 'Continue'}{stage !== 'test' && <ChevronRight />}
        </Button>
      </div>
    </aside>
  );
}

/** Keep params whose keys exist in the new field list (when switching events). */
function pickCompatible(params, fields) {
  const keys = new Set((fields || []).map((f) => f.key));
  return Object.fromEntries(Object.entries(params || {}).filter(([k, v]) => keys.has(k) && !isEmptyValue(v)));
}

// ---------------------------------------------------------------- setup
function SetupStage({ isTrigger, node, app, ev, pickApp, pickEvent, patch, plan }) {
  const [changing, setChanging] = useState(!app);
  const { connections, openConnect } = useEditor();
  if (changing || !app) {
    return (
      <div>
        <div className="row between mb-8"><h4>{isTrigger ? 'Choose the app that starts this flow' : 'Choose an app for this step'}</h4>
          {app && <Button size="xs" variant="ghost" onClick={() => setChanging(false)}>Cancel</Button>}</div>
        <AppPicker mode={isTrigger ? 'trigger' : 'action'} current={node.app} onPick={(a) => { pickApp(a); setChanging(false); }} />
      </div>
    );
  }
  const evs = Object.values((isTrigger ? app.triggers : app.actions) || {});
  const conns = connections.filter((c) => c.app === app.key);
  return (
    <div>
      <Field label="App" required>
        <div className="fe-chosen">
          <AppIcon app={app} size={30} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="bold truncate">{app.name}</div>
            <div className="tiny subtle truncate">{app.description}</div>
          </div>
          <Button size="sm" onClick={() => setChanging(true)}>Change</Button>
        </div>
      </Field>
      <Field label={isTrigger ? 'Trigger event' : 'Action event'} required help={ev?.description}>
        <div className="fe-events">
          {evs.map((e) => (
            <button key={e.key} type="button" className={`fe-event ${evKeyOf(node, isTrigger) === e.key ? 'selected' : ''}`} onClick={() => pickEvent(e.key)}>
              <span className="fe-radio" />
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="bold small">{e.name}</span>
                {e.description && <span className="tiny subtle fe-event-desc">{e.description}</span>}
              </span>
              {isTrigger && e.type && <span className="badge">{e.type === 'instant' ? 'Instant' : e.type === 'polling' ? 'Polling' : e.type === 'schedule' ? 'Scheduled' : 'Event'}</span>}
              {!isTrigger && e.kind === 'search' && <span className="badge badge-blue">Search</span>}
            </button>
          ))}
        </div>
      </Field>
      {app.auth && (
        <Field label="Account" required help={conns.length ? 'Credentials are stored encrypted and shared with this workspace.' : undefined}>
          <div className="row" style={{ gap: 6 }}>
            <Select className="grow" value={node.connectionId || ''} placeholder={conns.length ? 'Choose an account…' : `No ${app.name} accounts yet`}
              options={conns.map((c) => ({ value: c.id, label: `${c.name}${c.status === 'error' ? ' (needs reconnect)' : ''}` }))}
              onChange={(e) => patch({ connectionId: e.target.value || undefined })} />
          </div>
          <div className="mt-8"><Button size="sm" icon={Plus} onClick={() => openConnect(app.key, (c) => patch({ connectionId: c.id }))}>Connect a new account</Button></div>
          {conns.find((c) => c.id === node.connectionId)?.status === 'error' && <div className="error-text">This connection failed its last test. Reconnect it from Connections.</div>}
        </Field>
      )}
    </div>
  );
}
const evKeyOf = (node, isTrigger) => (isTrigger ? node.event : node.action);

// ---------------------------------------------------------------- configure
function ConfigureStage({ node, app, ev, setParam, showErrors, missing, isTrigger, onSelect }) {
  const { setDef } = useEditor();
  const fields = ev.fields || [];
  if (!isTrigger && node.app === 'paths') {
    const addPath = () => setDef((d) => updateStep(d, node.id, (s) => ({ ...s, paths: [...(s.paths || []), { id: newPathId(), name: `Path ${String.fromCharCode(65 + (s.paths || []).length)}`, conditions: [], steps: [] }] })));
    return (
      <div>
        <p className="muted small mb-16">Each path runs its own steps when its conditions match. Click a path to edit its rules.</p>
        <div className="col">
          {(node.paths || []).map((p) => (
            <button key={p.id} type="button" className="fe-pathrow" onClick={() => onSelect({ type: 'path', stepId: node.id, pathId: p.id })}>
              <Split size={16} className="subtle" />
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="bold small truncate" style={{ display: 'block' }}>{p.name || 'Untitled path'}</span>
                <span className="tiny subtle truncate" style={{ display: 'block' }}>{p.fallback ? 'Fallback — runs when no other path matches' : conditionSummary(p.conditions)}</span>
              </span>
              <span className="badge">{(p.steps || []).length} step{(p.steps || []).length === 1 ? '' : 's'}</span>
              <ChevronRight size={16} className="subtle" />
            </button>
          ))}
        </div>
        <div className="mt-16"><Button size="sm" icon={Plus} onClick={addPath}>Add path</Button></div>
      </div>
    );
  }
  if (!fields.length) {
    return <Callout type="info" icon={Info}>{isTrigger ? 'This trigger has nothing to configure.' : 'This action has nothing to configure.'} Continue to test it.</Callout>;
  }
  return (
    <div>
      {node.app === 'looping' && <Callout type="info" icon={Info}>Steps inside the loop run once per item. Map <code>{'{{loop.item}}'}</code> in them to use the current value.</Callout>}
      {node.app === 'looping' && <div className="mb-16" />}
      {fields.map((f) => (
        <FieldRow key={f.key} field={f} value={node.params?.[f.key]} params={node.params || {}} invalid={showErrors && missing.includes(f.key)}
          onChange={(v) => setParam(f.key, v)} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- trigger test
function TriggerTest({ node, app, ev, patch }) {
  const { flow, flush, refreshFlow, setTestOutput } = useEditor();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const st = flow.trigger_state || {};
  const isWebhook = node.app === 'webhook';
  const isPolling = ev.type === 'polling';
  const isSchedule = ev.type === 'schedule';

  const run = async () => {
    setBusy(true); setError(null);
    try {
      await flush();
      const r = await api.post(`flows/${flow.id}/test-trigger`);
      setResult(r);
      if (r.samples?.[0]) { patch({ sample: r.samples[0] }); setTestOutput('trigger', r.samples[0]); }
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const pollNow = async () => {
    setPolling(true);
    try { const r = await api.post(`flows/${flow.id}/poll`); toast.success(`Checked for new items: found ${r.found}, started ${r.triggered} run${r.triggered === 1 ? '' : 's'}.`); }
    catch (e) { toast.error(e.message); } finally { setPolling(false); refreshFlow(); }
  };
  const curl = `curl -X POST '${flow.hook_url}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"name": "Ada Lovelace", "email": "ada@example.com"}'`;
  const chosen = node.sample;

  return (
    <div>
      {isWebhook && (
        <div className="mb-16">
          <Field label="Your webhook URL" help="Send a POST, PUT or GET request to this URL. Requests are captured as sample data even while the flow is off.">
            <CopyField value={flow.hook_url || ''} />
          </Field>
          <details className="fe-details">
            <summary className="small muted">Sample curl command</summary>
            <pre className="code-block mt-8" style={{ whiteSpace: 'pre-wrap' }}>{curl}</pre>
          </details>
          {st.lastSampleAt && <div className="tiny subtle mt-8">Last request received {timeAgo(st.lastSampleAt)}.</div>}
        </div>
      )}
      {isPolling && flow.status === 'on' && (
        <div className="panel mb-16">
          <div className="row between">
            <div>
              <div className="small bold">Polling</div>
              <div className="tiny subtle">{st.lastPollAt ? `Last checked ${timeAgo(st.lastPollAt)}` : 'Not checked yet'}{st.nextAt ? ` · next check ${timeAgo(st.nextAt)}` : ''}</div>
            </div>
            <Button size="sm" icon={RefreshCw} loading={polling} onClick={pollNow}>Poll now</Button>
          </div>
          {st.lastPollError && <div className="mt-8"><Callout type="danger" icon={AlertTriangle}>Last poll failed: {st.lastPollError}</Callout></div>}
        </div>
      )}
      {isSchedule && (
        <div className="panel mb-16 row"><Clock size={16} className="subtle" />
          <div className="small">{flow.status === 'on' && st.nextAt ? <>Next run <b>{fmtDate(st.nextAt)}</b> ({timeAgo(st.nextAt)})</> : 'Test the trigger to see when it will next run.'}</div>
        </div>
      )}
      <p className="muted small mb-16">
        {isWebhook ? 'After sending a request, test the trigger to pull in the data so you can map it in later steps.'
          : isPolling ? `We’ll look for recent items in ${app.name} so you can pick one as sample data.`
          : 'Load sample data so you can map trigger fields in later steps.'}
      </p>
      <Button variant="primary" icon={isWebhook ? Webhook : FlaskConical} loading={busy} onClick={run}>{result ? 'Test again' : 'Test trigger'}</Button>
      {error && <div className="mt-16"><Callout type="danger" icon={AlertTriangle}>{error}</Callout></div>}
      {result?.note && <div className="mt-16"><Callout type="info" icon={Info}>{result.note}</Callout></div>}
      {result?.samples?.length > 1 && (
        <div className="mt-16">
          <div className="label mb-8">Choose a sample record</div>
          <div className="col" style={{ gap: 6 }}>
            {result.samples.map((s, i) => {
              const sel = JSON.stringify(s) === JSON.stringify(chosen);
              return (
                <button key={i} type="button" className={`fe-event ${sel ? 'selected' : ''}`} onClick={() => { patch({ sample: s }); setTestOutput('trigger', s); }}>
                  <span className="fe-radio" />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="bold small">Record {String.fromCharCode(65 + i)}</span>
                    <span className="tiny subtle fe-event-desc truncate">{summarize(s)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {chosen && (
        <div className="mt-16">
          <div className="row between mb-8"><span className="label">Sample data in use</span><Badge color="green"><CheckCircle2 />Ready to map</Badge></div>
          <JsonView data={chosen} maxHeight={320} />
        </div>
      )}
    </div>
  );
}
const summarize = (o) => {
  const flat = [];
  const walk = (v, d = 0) => { if (flat.length > 4 || d > 3) return; if (v && typeof v === 'object') Object.values(v).forEach((x) => walk(x, d + 1)); else if (v !== '' && v != null) flat.push(String(v)); };
  walk(o);
  return flat.join(' · ') || '(empty)';
};

// ---------------------------------------------------------------- action test
function ActionTest({ node, app, ev, patch, vars }) {
  const { flow, flush, setTestOutput, testOutputs } = useEditor();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const sideEffect = !app.control && ev.kind !== 'search';
  const output = result?.output ?? testOutputs[node.id] ?? node.sample;

  const run = async () => {
    setBusy(true); setError(null);
    try {
      await flush();
      const sampleSteps = Object.fromEntries(vars.groups.filter((g) => g.key !== 'loop').map((g) => [g.key, g.data]));
      const r = await api.post(`flows/${flow.id}/test-step`, { stepId: node.id, sampleSteps });
      setResult(r);
      setTestOutput(node.id, r.output);
      patch({ sample: r.output });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div>
      {node.disabled && <div className="mb-16"><Callout type="info" icon={Info}>This step is disabled and will be skipped during runs.</Callout></div>}
      {sideEffect ? (
        <Callout type="warning" icon={AlertTriangle}>
          Testing <b>really runs</b> this action with your sample data{app.key === 'email' ? ' — it will send the email' : ` in ${app.name}`}. Test runs don’t use tasks.
        </Callout>
      ) : (
        <Callout type="info" icon={Info}>{app.control ? 'Control steps show what they would output with your sample data.' : 'Searches don’t change anything — safe to test.'}</Callout>
      )}
      <div className="mt-16 row wrap">
        <Button variant="primary" icon={Play} loading={busy} onClick={run}>{output ? 'Retest step' : 'Test step'}</Button>
        {!vars.groups.find((g) => g.key === 'trigger')?.hint ? null : <span className="tiny subtle">Using example trigger data — test the trigger for real data.</span>}
      </div>
      {error && <div className="mt-16"><Callout type="danger" icon={AlertTriangle}><div className="bold">Test failed</div>{error}</Callout></div>}
      {result?.note && <div className="mt-16"><Callout type="info" icon={Info}>{result.note}</Callout></div>}
      {output && !error && (
        <div className="mt-16">
          <div className="row between mb-8">
            <span className="label">{result ? 'Output' : 'Saved sample output'}</span>
            {node.app === 'filter' ? <Badge color={output.passed ? 'green' : 'yellow'}>{output.passed ? 'Would continue' : 'Would stop'}</Badge>
              : <Badge color="green"><CheckCircle2 />Mappable in later steps</Badge>}
          </div>
          <JsonView data={output} maxHeight={320} />
        </div>
      )}
      {result?.params && (
        <details className="fe-details mt-16">
          <summary className="small muted">Data sent</summary>
          <div className="mt-8"><JsonView data={result.params} maxHeight={240} /></div>
        </details>
      )}
      {busy && <div className="row small muted mt-16"><Spinner size={14} /> Running {ev.name}…</div>}
    </div>
  );
}

// ---------------------------------------------------------------- path branch panel
function PathPanel({ selection, onClose, onSelect }) {
  const { def, setDef, numbers } = useEditor();
  const dialog = useDialog();
  const { stepId, pathId } = selection;
  const path = findPath(def, stepId, pathId);
  const vars = useVarGroups(def, stepId);
  const [name, setName] = useState(path?.name || '');
  useEffect(() => { setName(path?.name || ''); }, [path?.name]);
  if (!path) return null;
  const set = (p) => setDef((d) => updatePath(d, stepId, pathId, p));
  const remove = async () => {
    const n = (path.steps || []).length;
    if (!(await dialog.confirm({ title: `Delete “${path.name}”?`, message: n ? `This also deletes the ${n} step${n === 1 ? '' : 's'} inside this path.` : 'This path will be removed.', danger: true, confirmText: 'Delete path' }))) return;
    setDef((d) => updateStep(d, stepId, (s) => ({ ...s, paths: (s.paths || []).filter((p) => p.id !== pathId) })));
    onSelect({ type: 'step', id: stepId });
  };
  return (
    <aside className="editor-side fe-side" aria-label="Path settings">
      <div className="editor-side-header">
        <span className="fe-path-icon"><Split size={18} /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="tiny subtle bold fe-upper">Path in step {numbers[stepId]}</div>
          <div className="bold truncate">{path.name || 'Untitled path'}</div>
        </div>
        <Button variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Close panel" />
      </div>
      <VarCtx.Provider value={vars}>
        <div className="editor-side-body">
          <Field label="Path name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== path.name && set({ name: name.trim() })}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
          </Field>
          <div className="panel mb-16">
            <Toggle checked={Boolean(path.fallback)} onChange={(v) => set({ fallback: v })} label="Fallback path" />
            <div className="help mt-8">A fallback path runs only when none of the other paths match. Only one path can be the fallback.</div>
          </div>
          {path.fallback ? (
            <Callout type="info" icon={Info}>Conditions are ignored for the fallback path.</Callout>
          ) : (
            <Field label="Only run this path if…" help="Conditions in a group must all match (AND). Any matching group runs the path (OR).">
              <ConditionsEditor value={path.conditions} onChange={(c) => set({ conditions: c })} />
            </Field>
          )}
          <hr />
          <Button variant="danger-ghost" size="sm" icon={Trash2} onClick={remove}>Delete path</Button>
        </div>
      </VarCtx.Provider>
      <div className="editor-side-footer">
        <Button variant="ghost" onClick={() => onSelect({ type: 'step', id: stepId })}>Back to Paths step</Button>
        <Button variant="primary" onClick={onClose}>Done</Button>
      </div>
    </aside>
  );
}
