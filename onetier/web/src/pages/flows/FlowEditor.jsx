// Full-screen flow editor: top bar, step canvas and the step configuration panel.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Play, Rocket, MoreHorizontal, History, Sparkles, CopyPlus, Download, Link as LinkIcon, Trash2, Settings, Layers,
  CloudCheck, CloudOff, Loader2, AlertTriangle, RotateCcw, MousePointerClick, Lock,
} from 'lucide-react';
import api from '../../lib/api.js';
import { useAuth, useApps, useToast, useDialog } from '../../lib/context.jsx';
import { copyText, timeAgo } from '../../lib/util.js';
import { Button, Menu, Badge, Toggle, Loading, EmptyState, ErrorState, Callout } from '../../components/ui.jsx';
import ConnectModal from '../../components/ConnectModal.jsx';
import CopilotPanel from '../../components/CopilotPanel.jsx';
import { EditorCtx } from './editor/context.js';
import Canvas from './editor/Canvas.jsx';
import SidePanel from './editor/SidePanel.jsx';
import { TestRunModal, IssuesModal, RunNowModal, VersionsDrawer, SettingsDrawer } from './editor/Modals.jsx';
import {
  normalizeDef, numberSteps, computeIssues, countSteps, insertStep, updateStep, removeStep, moveStep, duplicateStep, findStep, findPath,
  updatePath, newStepId, newPathId, defaultParams, walkSteps,
} from './editor/defUtils.js';
import './editor/editor.css';

const stripSamples = (d) => JSON.stringify(d ?? null, (k, v) => (k === 'sample' ? undefined : v));

export default function FlowEditorRoute() {
  const { id } = useParams();
  return <FlowEditor key={id} id={id} />;
}

function FlowEditor({ id }) {
  const navigate = useNavigate();
  const { me } = useAuth();
  const { getApp, loaded: appsLoaded } = useApps();
  const toast = useToast();
  const dialog = useDialog();
  const plan = me?.plan;

  const [flow, setFlow] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [def, setDefState] = useState(null);
  const [selection, setSelection] = useState(null);
  const [saveState, setSaveState] = useState('saved');
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [connections, setConnections] = useState([]);
  const [connect, setConnect] = useState(null);
  const [testOutputs, setTestOutputs] = useState({});
  const [serverIssues, setServerIssues] = useState(null);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [testRun, setTestRun] = useState(null);
  const [runNow, setRunNow] = useState(false);
  const [drawer, setDrawer] = useState(null);
  const [copilot, setCopilot] = useState(false);
  const [busy, setBusy] = useState({});
  const [name, setName] = useState('');

  // ---------------------------------------------------------------- loading
  const defRef = useRef(null);
  const dirtyRef = useRef(false);
  const timer = useRef(null);
  const lastSavedRef = useRef(null);
  const chain = useRef(Promise.resolve());
  const validateAfterSave = useRef(false);
  const loadFlow = useCallback(async ({ resetDef = false } = {}) => {
    try {
      const f = await api.get(`flows/${id}`);
      setFlow(f);
      if (resetDef) { dirtyRef.current = false; const d = normalizeDef(f.definition); lastSavedRef.current = JSON.stringify(d); defRef.current = d; setDefState(d); setName(f.name); }
      return f;
    } catch (e) { setLoadError(e); return null; }
  }, [id]);
  const refreshFlow = useCallback(() => loadFlow(), [loadFlow]);
  const reloadConnections = useCallback(async () => {
    try { const c = await api.get('connections'); setConnections(c); return c; } catch { return []; }
  }, []);
  useEffect(() => { loadFlow({ resetDef: true }); reloadConnections(); }, [loadFlow, reloadConnections]);

  // ---------------------------------------------------------------- autosave

  const doSave = useCallback(() => {
    clearTimeout(timer.current); timer.current = null;
    const snapshot = defRef.current;
    if (!snapshot) return chain.current;
    chain.current = chain.current.then(async () => {
      const json = JSON.stringify(snapshot);
      if (json === lastSavedRef.current) { if (defRef.current === snapshot) setSaveState('saved'); return; }
      setSaveState('saving');
      try {
        await api.put(`flows/${id}`, { definition: snapshot });
        lastSavedRef.current = json;
        setLastSavedAt(new Date());
        setSaveState(JSON.stringify(defRef.current) === json ? 'saved' : 'unsaved');
        if (validateAfterSave.current) api.post(`flows/${id}/validate`).then((r) => setServerIssues(r.issues)).catch(() => {});
      } catch (e) {
        setSaveState('error');
        toast.error(`Couldn’t save your changes: ${e.message}`);
      }
    });
    return chain.current;
  }, [id, toast]);

  const flush = useCallback(async () => {
    if (timer.current || JSON.stringify(defRef.current) !== lastSavedRef.current) await doSave();
    else await chain.current;
    if (JSON.stringify(defRef.current) !== lastSavedRef.current) throw new Error('Your latest changes haven’t been saved yet. Check your connection and try again.');
  }, [doSave]);

  useEffect(() => {
    defRef.current = def;
    if (!dirtyRef.current || !def) return;
    setSaveState('unsaved');
    clearTimeout(timer.current);
    timer.current = setTimeout(doSave, 700);
  }, [def, doSave]);

  // save on leave
  useEffect(() => () => { if (timer.current) doSave(); }, [doSave]);
  useEffect(() => {
    if (saveState === 'saved') return undefined;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [saveState]);

  const setDef = useCallback((u) => {
    dirtyRef.current = true;
    // server-side issues are re-fetched after the next save; drop stale ones now
    if (validateAfterSave.current) setServerIssues(null);
    setDefState((d) => (typeof u === 'function' ? u(d) : u));
  }, []);

  // copilot opens inside the editor too
  useEffect(() => {
    const h = () => setCopilot(true);
    window.addEventListener('onetier:copilot', h);
    return () => window.removeEventListener('onetier:copilot', h);
  }, []);

  // ---------------------------------------------------------------- derived
  const numbers = useMemo(() => (def ? numberSteps(def) : {}), [def]);
  const clientIssues = useMemo(() => (def && appsLoaded ? computeIssues(def, getApp, plan) : { byStep: {}, general: [] }), [def, appsLoaded, getApp, plan]);
  const issues = useMemo(() => {
    const by = { ...clientIssues.byStep };
    for (const it of serverIssues || []) {
      if (!it.stepId) continue;
      if (it.stepId !== 'trigger' && !findStep(def, it.stepId)) continue;
      if (!by[it.stepId]) by[it.stepId] = [it.message];
    }
    return by;
  }, [clientIssues, serverIssues, def]);
  const totalSteps = def ? countSteps(def.steps) + 1 : 0;
  const hasUnpublished = Boolean(flow && def && flow.version > 0 && stripSamples(def) !== stripSamples(flow.published));
  const issueCount = Object.values(issues).reduce((n, l) => n + l.length, 0) + clientIssues.general.length;

  const select = useCallback((sel) => setSelection(sel), []);
  const setTestOutput = useCallback((key, out) => setTestOutputs((t) => ({ ...t, [key]: out })), []);
  const openConnect = useCallback((appKey, cb) => setConnect({ appKey, cb }), []);
  const run = async (key, fn) => { setBusy((b) => ({ ...b, [key]: true })); try { return await fn(); } finally { setBusy((b) => ({ ...b, [key]: false })); } };

  // ---------------------------------------------------------------- step operations
  const titleOf = useCallback((node, isTrigger) => {
    const app = getApp(node?.app);
    const ev = app ? (isTrigger ? app.triggers?.[node.event] : app.actions?.[node.action]) : null;
    return node?.title || (app ? `${app.name}${ev ? ` · ${ev.name}` : ''}` : isTrigger ? 'Trigger' : 'Untitled step');
  }, [getApp]);

  const ops = useMemo(() => ({
    async addStep(loc, index, preset) {
      const step = { id: newStepId(), app: null, action: null, params: {} };
      if (preset) {
        const app = getApp(preset);
        const key = { filter: 'check', paths: 'split', looping: 'loop', delay: 'for' }[preset];
        step.app = preset; step.action = key;
        step.params = defaultParams(app?.actions?.[key]?.fields);
        if (preset === 'filter') step.params.conditions = [];
        if (preset === 'paths') step.paths = [{ id: newPathId(), name: 'Path A', conditions: [], steps: [] }, { id: newPathId(), name: 'Path B', conditions: [], steps: [] }];
        if (preset === 'looping') step.steps = [];
      }
      setDef((d) => insertStep(d, loc, index, step));
      setSelection({ type: 'step', id: step.id });
    },
    async rename(stepId) {
      const node = stepId === 'trigger' ? defRef.current.trigger : findStep(defRef.current, stepId)?.step;
      if (!node) return;
      const v = await dialog.prompt({ title: 'Rename step', label: 'Step name', defaultValue: titleOf(node, stepId === 'trigger'), required: false, confirmText: 'Rename', message: 'Leave empty to use the default name.' });
      if (v === null) return;
      const title = v.trim() || undefined;
      if (stepId === 'trigger') setDef((d) => ({ ...d, trigger: { ...d.trigger, title } }));
      else setDef((d) => updateStep(d, stepId, (s) => { const n = { ...s, title }; if (!title) delete n.title; return n; }));
    },
    duplicate(stepId) {
      let newId = null;
      setDef((d) => { const r = duplicateStep(d, stepId); newId = r.newId; return r.def; });
      setTimeout(() => newId && setSelection({ type: 'step', id: newId }), 0);
    },
    move(stepId, dir) { setDef((d) => moveStep(d, stepId, dir)); },
    toggleDisabled(stepId) { setDef((d) => updateStep(d, stepId, (s) => { const n = { ...s, disabled: !s.disabled }; if (!n.disabled) delete n.disabled; return n; })); },
    setOnError(stepId, mode) { setDef((d) => updateStep(d, stepId, { onError: mode })); },
    async remove(stepId) {
      const f = findStep(defRef.current, stepId);
      if (!f) return;
      let nested = 0;
      walkSteps([f.step], () => { nested += 1; });
      nested -= 1;
      const ok = await dialog.confirm({
        title: `Delete step ${numbers[stepId]}?`,
        message: `“${titleOf(f.step)}” will be removed${nested ? ` along with ${nested} nested step${nested === 1 ? '' : 's'}` : ''}. Fields mapped from it in later steps will stop working.`,
        danger: true, confirmText: 'Delete step',
      });
      if (!ok) return;
      setDef((d) => removeStep(d, stepId));
      setSelection((sel) => {
        if (!sel || sel.type === 'trigger') return sel;
        const sid = sel.type === 'path' ? sel.stepId : sel.id;
        let inside = sid === stepId;
        walkSteps([f.step], (s) => { if (s.id === sid) inside = true; });
        return inside ? null : sel;
      });
    },
    addPath(stepId) {
      let pid = null;
      setDef((d) => updateStep(d, stepId, (s) => { pid = newPathId(); return { ...s, paths: [...(s.paths || []), { id: pid, name: `Path ${String.fromCharCode(65 + (s.paths || []).length)}`, conditions: [], steps: [] }] }; }));
      setTimeout(() => pid && setSelection({ type: 'path', stepId, pathId: pid }), 0);
    },
    async renamePath(stepId, pathId) {
      const p = findPath(defRef.current, stepId, pathId);
      const v = await dialog.prompt({ title: 'Rename path', label: 'Path name', defaultValue: p?.name || '', confirmText: 'Rename' });
      if (v?.trim()) setDef((d) => updatePath(d, stepId, pathId, { name: v.trim() }));
    },
    setFallback(stepId, pathId, on) { setDef((d) => updatePath(d, stepId, pathId, { fallback: on })); },
    async removePath(stepId, pathId) {
      const p = findPath(defRef.current, stepId, pathId);
      const n = (p?.steps || []).length;
      if (!(await dialog.confirm({ title: `Delete “${p?.name || 'path'}”?`, message: n ? `This also deletes the ${n} step${n === 1 ? '' : 's'} inside it.` : 'This path will be removed.', danger: true, confirmText: 'Delete path' }))) return;
      setDef((d) => updateStep(d, stepId, (s) => ({ ...s, paths: (s.paths || []).filter((x) => x.id !== pathId) })));
      setSelection((sel) => (sel?.type === 'path' && sel.pathId === pathId ? { type: 'step', id: stepId } : sel));
    },
  }), [plan, totalSteps, dialog, getApp, setDef, titleOf, toast, numbers]);

  // ---------------------------------------------------------------- top bar actions
  const saveName = async () => {
    const n = name.trim();
    if (!n) { setName(flow.name); return; }
    if (n === flow.name) return;
    try { await api.put(`flows/${id}`, { name: n }); setFlow((f) => ({ ...f, name: n })); toast.success('Flow renamed'); }
    catch (e) { toast.error(e.message); setName(flow.name); }
  };

  const testRunFlow = () => run('test', async () => {
    try {
      await flush();
      if (!defRef.current.steps.length) { toast.info('Add at least one action before running a test.'); return; }
      const r = await api.post(`flows/${id}/run`, { mode: 'test' });
      setTestRun(r);
    } catch (e) { toast.error(e.message); }
  });

  const publish = async () => {
    const note = await dialog.prompt({
      title: flow.version ? 'Publish changes' : 'Publish flow',
      message: flow.version ? 'Your changes go live immediately and the flow is turned on.' : 'Publishing makes this flow live and turns it on.',
      label: 'Version note (optional)', placeholder: 'What changed?', required: false, confirmText: 'Publish',
    });
    if (note === null) return;
    await run('publish', async () => {
      try {
        await flush();
        const r = await api.post(`flows/${id}/publish`, { note: note.trim() });
        toast.success(`Published version ${r.version}. Your flow is on.`);
        setServerIssues(null); validateAfterSave.current = false;
        await refreshFlow();
      } catch (e) {
        if (e.status === 422 && e.data?.issues) { setServerIssues(e.data.issues); validateAfterSave.current = true; setIssuesOpen(true); }
        else toast.error(e.message);
      }
    });
  };

  const setStatus = (on) => run('status', async () => {
    try { await api.post(`flows/${id}/status`, { status: on ? 'on' : 'off' }); toast.success(on ? 'Flow turned on' : 'Flow turned off'); await refreshFlow(); }
    catch (e) { toast.error(e.message); }
  });

  const restoreFromTrash = () => run('restore', async () => {
    try { await api.post(`flows/${id}/restore`); toast.success('Flow restored from trash'); await loadFlow({ resetDef: true }); }
    catch (e) { toast.error(e.message); }
  });

  const pickIssue = (stepId) => {
    if (stepId === 'trigger') setSelection({ type: 'trigger' });
    else if (stepId && findStep(defRef.current, stepId)) setSelection({ type: 'step', id: stepId });
  };

  const menuItems = flow ? [
    { label: 'Versions', icon: Layers, onClick: async () => { try { await flush(); } catch { /* still allow viewing */ } setDrawer('versions'); } },
    { label: 'Settings', icon: Settings, onClick: () => setDrawer('settings') },
    { label: 'View history', icon: History, onClick: () => navigate(`/history?flowId=${id}`) },
    { label: 'Ask Copilot', icon: Sparkles, onClick: () => window.dispatchEvent(new Event('onetier:copilot')) },
    { divider: true },
    { label: 'Duplicate', icon: CopyPlus, onClick: () => run('dup', async () => {
      try { await flush(); const r = await api.post(`flows/${id}/duplicate`); toast.success('Flow duplicated'); navigate(`/flows/${r.id}`); } catch (e) { toast.error(e.message); }
    }) },
    { label: 'Export JSON', icon: Download, onClick: async () => {
      try { await flush(); await api.download(`flows/${id}/export`, `${flow.name.replace(/[^\w-]+/g, '_')}.onetier.json`); } catch (e) { toast.error(e.message); }
    } },
    def?.trigger?.app === 'webhook' && { label: 'Copy webhook URL', icon: LinkIcon, onClick: async () => { await copyText(flow.hook_url); toast.success('Webhook URL copied'); } },
    { divider: true },
    { label: 'Move to trash', icon: Trash2, danger: true, onClick: async () => {
      if (!(await dialog.confirm({ title: 'Move this flow to trash?', message: flow.status === 'on' ? 'The flow will be turned off and stop running. You can restore it from the trash.' : 'You can restore it from the trash later.', danger: true, confirmText: 'Move to trash' }))) return;
      try { clearTimeout(timer.current); timer.current = null; await api.del(`flows/${id}`); toast.success('Flow moved to trash'); navigate('/flows'); } catch (e) { toast.error(e.message); }
    } },
  ] : [];

  // ---------------------------------------------------------------- render states
  if (loadError) {
    return (
      <div className="editor-shell">
        <div className="editor-top"><Link to="/flows" className="btn btn-ghost btn-sm"><ArrowLeft />Flows</Link></div>
        {loadError.status === 404
          ? <EmptyState icon={AlertTriangle} title="Flow not found" action={<Link className="btn btn-primary" to="/flows">Back to flows</Link>}>It may have been deleted permanently, or it belongs to another workspace.</EmptyState>
          : <ErrorState error={loadError} onRetry={() => { setLoadError(null); loadFlow({ resetDef: true }); }} />}
      </div>
    );
  }
  if (!flow || !def || !appsLoaded) return <div className="editor-shell"><Loading label="Loading flow…" /></div>;

  if (flow.deleted_at) {
    return (
      <div className="editor-shell">
        <div className="editor-top"><Link to="/flows" className="btn btn-ghost btn-sm"><ArrowLeft />Flows</Link><span className="bold truncate">{flow.name}</span></div>
        <EmptyState icon={Trash2} title="This flow is in the trash"
          action={<div className="row"><Link className="btn btn-secondary" to="/flows">Back to flows</Link><Button variant="primary" icon={RotateCcw} loading={busy.restore} onClick={restoreFromTrash}>Restore flow</Button></div>}>
          It was moved to the trash {timeAgo(flow.deleted_at)}. Restore it to edit or run it again.
        </EmptyState>
      </div>
    );
  }

  const isManual = def.trigger?.app === 'manual';
  const published = flow.version > 0;
  const ctx = {
    flow, def, setDef, plan, me, numbers, issues, ops, selection, select, connections, reloadConnections, openConnect, flush, refreshFlow,
    testOutputs, setTestOutput,
  };

  return (
    <EditorCtx.Provider value={ctx}>
      <div className="editor-shell fe-shell">
        <header className="editor-top fe-top">
          <Link to="/flows" className="btn btn-ghost btn-sm btn-icon" aria-label="Back to flows" title="Back to flows"><ArrowLeft /></Link>
          <div className="fe-title">
            <input className="inline-title" value={name} aria-label="Flow name" maxLength={120}
              onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setName(flow.name); e.currentTarget.blur(); } }} />
            <div className="fe-status">
              {!published ? <Badge color="yellow" dot>Draft</Badge> : flow.status === 'on' ? <Badge color="green" dot>On</Badge> : <Badge dot>Off</Badge>}
              {hasUnpublished && <Badge color="brand">Unpublished changes</Badge>}
              <SaveIndicator state={saveState} at={lastSavedAt} onRetry={doSave} />
            </div>
          </div>
          <div className="fe-top-actions">
            {published && (
              <label className="fe-onoff" title={flow.status === 'on' ? 'Turn flow off' : 'Turn flow on'}>
                <Toggle checked={flow.status === 'on'} disabled={busy.status} onChange={setStatus} />
                <span className="fe-hide-sm small bold">{flow.status === 'on' ? 'On' : 'Off'}</span>
              </label>
            )}
            {isManual && flow.status === 'on' && (
              <Button size="sm" icon={MousePointerClick} onClick={() => setRunNow(true)}><span className="fe-hide-sm">Run now</span></Button>
            )}
            <Button size="sm" icon={Play} loading={busy.test} onClick={testRunFlow} title="Run every step with sample data"><span className="fe-hide-sm">Test run</span></Button>
            <Button size="sm" variant="primary" icon={Rocket} loading={busy.publish} onClick={publish} disabled={published && !hasUnpublished && flow.status === 'on' && saveState === 'saved'}
              title={issueCount ? `${issueCount} issue${issueCount === 1 ? '' : 's'} to fix` : undefined}>
              <span className="fe-hide-xs">{published ? (hasUnpublished ? 'Publish changes' : 'Published') : 'Publish'}</span>
            </Button>
            <Menu width={220} items={menuItems} trigger={<Button size="sm" variant="ghost" icon={MoreHorizontal} aria-label="More options" />} />
          </div>
        </header>

        <div className="editor-body">
          <Canvas def={def} onBackgroundClick={() => setSelection(null)}>
          </Canvas>
          <SidePanel selection={selection} onClose={() => setSelection(null)} onSelect={setSelection} />
        </div>
      </div>

      {connect && (
        <ConnectModal appKey={connect.appKey} onClose={() => setConnect(null)}
          onConnected={async (c) => { await reloadConnections(); connect.cb?.(c); }} />
      )}
      {testRun && <TestRunModal result={testRun} onClose={() => setTestRun(null)} />}
      {issuesOpen && serverIssues && <IssuesModal issues={serverIssues} numbers={numbers} onPick={pickIssue} onClose={() => setIssuesOpen(false)} />}
      {runNow && <RunNowModal flow={flow} inputs={def.trigger?.params?.inputs} onClose={() => setRunNow(false)} onDone={(r) => r?.runId && refreshFlow()} />}
      {drawer === 'versions' && <VersionsDrawer flow={flow} onClose={() => setDrawer(null)} onRestored={() => { setSelection(null); setTestOutputs({}); loadFlow({ resetDef: true }); }} />}
      {drawer === 'settings' && <SettingsDrawer flow={flow} plan={plan} onClose={() => setDrawer(null)} onSaved={refreshFlow} />}
      {copilot && <CopilotPanel onClose={() => setCopilot(false)} flowId={id} />}
    </EditorCtx.Provider>
  );
}

function SaveIndicator({ state, at, onRetry }) {
  if (state === 'saving') return <span className="fe-save"><Loader2 className="fe-spin" />Saving…</span>;
  if (state === 'unsaved') return <span className="fe-save"><Loader2 className="fe-spin" />Unsaved changes</span>;
  if (state === 'error') return <button type="button" className="fe-save fe-save-err" onClick={onRetry}><CloudOff />Not saved — retry</button>;
  return <span className="fe-save" title={at ? `Saved ${at.toLocaleTimeString()}` : 'All changes saved'}><CloudCheck />Saved</span>;
}
