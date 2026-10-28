import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, addEdge, useNodesState, useEdgesState, useReactFlow,
  Handle, Position, MarkerType, ConnectionMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowLeft, PlayCircle, CircleStop, Hand, Zap, Diamond, Table2, LayoutTemplate, Bot, StickyNote, Sparkles, Maximize, Download, Trash2,
  Cloud, CloudOff, Loader2, Check, ExternalLink, Plus, X, Unlink, Workflow,
} from 'lucide-react';
import api from '../../lib/api.js';
import { useToast, useDialog } from '../../lib/context.jsx';
import { Button, Field, Input, Textarea, Select, Modal, Loading, ErrorState, Callout, Segmented, FlowStatus, Badge } from '../../components/ui.jsx';
import { uid } from '../../lib/util.js';
import './canvas.css';

export const KINDS = {
  start: { label: 'Start', icon: PlayCircle, hint: 'Where the process begins' },
  manual: { label: 'Manual step', icon: Hand, hint: 'Done by a person' },
  flow: { label: 'Automated', icon: Zap, hint: 'Runs as a OneTier flow' },
  decision: { label: 'Decision', icon: Diamond, hint: 'A yes/no branch' },
  table: { label: 'Table', icon: Table2, hint: 'Data stored in a table' },
  interface: { label: 'Interface', icon: LayoutTemplate, hint: 'A form or page' },
  chatbot: { label: 'Chatbot', icon: Bot, hint: 'An AI chatbot' },
  note: { label: 'Note', icon: StickyNote, hint: 'A sticky note' },
  end: { label: 'End', icon: CircleStop, hint: 'Where the process ends' },
};
const DEFAULT_LABEL = { start: 'Start', end: 'End', manual: 'Manual step', flow: 'Automated step', decision: 'Is it approved?', table: 'Table', interface: 'Form', chatbot: 'Chatbot', note: 'Add a note…' };
const EDGE_DEFAULTS = { type: 'smoothstep', animated: true, markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 } };

function useThemeMode() {
  const read = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const [mode, setMode] = useState(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setMode(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return mode;
}

// ---------------------------------------------------------------- custom node
function Handles() {
  return (
    <>
      <Handle id="t" type="target" position={Position.Top} />
      <Handle id="l" type="target" position={Position.Left} />
      <Handle id="b" type="source" position={Position.Bottom} />
      <Handle id="r" type="source" position={Position.Right} />
    </>
  );
}
const ProcessNode = memo(({ data }) => {
  const kind = KINDS[data.kind] ? data.kind : 'manual';
  const K = KINDS[kind];
  const I = K.icon;
  if (kind === 'decision') {
    return (
      <div className="cvn cvn-diamond">
        <div className="cvn-diamond-shape" />
        <div className="cvn-diamond-text"><div className="cvn-kind"><I />Decision</div>{data.label}</div>
        <Handles />
      </div>
    );
  }
  if (kind === 'start' || kind === 'end') {
    return <div className={`cvn cvn-${kind}`} style={{ minWidth: 0 }}><div className="cvn-box cvn-pill"><div className="cvn-label">{data.label}</div></div><Handles /></div>;
  }
  if (['table', 'interface', 'chatbot'].includes(kind)) {
    return (
      <div className={`cvn cvn-${kind}`}>
        <div className="cvn-box row" style={{ alignItems: 'flex-start', gap: 10 }}>
          <span className="cvn-icon"><I /></span>
          <div className="grow"><div className="cvn-kind" style={{ marginBottom: 2 }}>{K.label}</div><div className="cvn-label">{data.label}</div>{data.notes && <div className="cvn-notes">{data.notes}</div>}</div>
        </div>
        <Handles />
      </div>
    );
  }
  return (
    <div className={`cvn cvn-${kind}`}>
      <div className="cvn-box">
        <div className="cvn-kind"><I />{kind === 'note' ? 'Note' : K.label}</div>
        <div className="cvn-label">{data.label}</div>
        {data.notes && <div className="cvn-notes">{data.notes}</div>}
        {kind === 'flow' && (
          <div className="cvn-flowlink">
            {data.flowId ? (data.flowStatus === 'missing'
              ? <span>Linked flow was deleted</span>
              : <><Workflow size={13} /><span className="grow truncate">{data.flowName || 'Linked flow'}</span><FlowStatus status={data.flowStatus || 'draft'} /></>)
              : <span style={{ opacity: .85 }}>Not linked to a flow yet</span>}
          </div>
        )}
        {kind === 'manual' && data.flowId && <div className="tiny subtle mt-8 row gap-4"><Workflow size={12} />{data.flowName || 'Linked flow'}</div>}
      </div>
      <Handles />
    </div>
  );
});
const nodeTypes = { process: ProcessNode };

// ---------------------------------------------------------------- helpers
const toFlowEdge = (e) => ({ ...EDGE_DEFAULTS, ...e, label: e.label || undefined });
const toFlowNode = (n) => ({ ...n, type: 'process', position: n.position || { x: 0, y: 0 }, data: { ...n.data, kind: n.data?.kind || 'manual', label: n.data?.label ?? '' } });
function serialize(nodes, edges) {
  return {
    nodes: nodes.map((n) => {
      const d = { kind: n.data.kind, label: n.data.label };
      if (n.data.notes) d.notes = n.data.notes;
      if (n.data.flowId) d.flowId = n.data.flowId;
      return { id: n.id, type: 'process', position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: d };
    }),
    edges: edges.map((e) => {
      const o = { id: e.id, source: e.source, target: e.target };
      if (e.sourceHandle) o.sourceHandle = e.sourceHandle;
      if (e.targetHandle) o.targetHandle = e.targetHandle;
      if (e.label) o.label = e.label;
      return o;
    }),
  };
}

export default function CanvasEditor() {
  return <ReactFlowProvider><Editor /></ReactFlowProvider>;
}

function Editor() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const rf = useReactFlow();
  const colorMode = useThemeMode();
  const wrapRef = useRef(null);

  const [loadState, setLoadState] = useState({ loading: true, error: null });
  const [name, setName] = useState('');
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [saveState, setSaveState] = useState('saved'); // saved | unsaved | saving | error
  const [flows, setFlows] = useState({ options: [], status: {} });
  const [genOpen, setGenOpen] = useState(false);
  const lastSaved = useRef(null);
  const timer = useRef(null);

  const loadFlows = useCallback(async () => {
    try {
      const [opts, list] = await Promise.all([api.get('dynamic/flows'), api.get('flows').catch(() => [])]);
      setFlows({ options: opts, status: Object.fromEntries(list.map((f) => [f.id, f.status])) });
    } catch { /* non-fatal */ }
  }, []);

  const load = useCallback(async () => {
    setLoadState({ loading: true, error: null });
    try {
      const c = await api.get(`canvases/${id}`);
      const ns = (c.data?.nodes || []).map(toFlowNode);
      const es = (c.data?.edges || []).map(toFlowEdge);
      setName(c.name); setNodes(ns); setEdges(es);
      lastSaved.current = JSON.stringify({ name: c.name, ...serialize(ns, es) });
      setSaveState('saved');
      setLoadState({ loading: false, error: null });
      setTimeout(() => rf.fitView({ padding: 0.2, maxZoom: 1.1 }), 60);
    } catch (e) { setLoadState({ loading: false, error: e }); }
  }, [id, rf, setNodes, setEdges]);
  useEffect(() => { load(); loadFlows(); }, [load, loadFlows]);

  // ---- autosave (debounced)
  const current = useMemo(() => JSON.stringify({ name, ...serialize(nodes, edges) }), [name, nodes, edges]);
  const save = useCallback(async (snapshot) => {
    const body = JSON.parse(snapshot);
    if (!body.name.trim()) { setSaveState('unsaved'); return; }
    setSaveState('saving');
    try {
      await api.put(`canvases/${id}`, { name: body.name.trim(), data: { nodes: body.nodes, edges: body.edges } });
      lastSaved.current = snapshot;
      setSaveState((s) => (s === 'saving' ? 'saved' : s));
    } catch (e) { setSaveState('error'); toast.error(`Couldn't save canvas: ${e.message}`); }
  }, [id, toast]);
  useEffect(() => {
    if (loadState.loading || lastSaved.current === null || current === lastSaved.current) return;
    setSaveState('unsaved');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(current), 800);
    return () => clearTimeout(timer.current);
  }, [current, loadState.loading, save]);
  useEffect(() => {
    const h = (e) => { if (lastSaved.current !== null && current !== lastSaved.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [current]);

  // ---- graph ops
  const onConnect = useCallback((c) => setEdges((es) => addEdge({ ...c, ...EDGE_DEFAULTS, id: uid('e') }, es)), [setEdges]);
  const selectedNodes = nodes.filter((n) => n.selected);
  const selectedEdges = edges.filter((e) => e.selected);
  const selNode = selectedNodes.length === 1 && !selectedEdges.length ? selectedNodes[0] : null;
  const selEdge = selectedEdges.length === 1 && !selectedNodes.length ? selectedEdges[0] : null;

  const addNode = (kind) => {
    const r = wrapRef.current?.getBoundingClientRect();
    const center = r ? rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : { x: 0, y: 0 };
    const jitter = () => Math.round((Math.random() - 0.5) * 60);
    const n = { id: uid('n'), type: 'process', position: { x: center.x - 85 + jitter(), y: center.y - 30 + jitter() }, data: { kind, label: DEFAULT_LABEL[kind] }, selected: true };
    setNodes((ns) => [...ns.map((x) => ({ ...x, selected: false })), n]);
    setEdges((es) => es.map((e) => ({ ...e, selected: false })));
  };
  const updateNodeData = (nid, patch) => setNodes((ns) => ns.map((n) => (n.id === nid ? { ...n, data: { ...n.data, ...patch } } : n)));
  const updateEdge = (eid, patch) => setEdges((es) => es.map((e) => (e.id === eid ? { ...e, ...patch } : e)));
  const deleteSelection = () => {
    const ids = new Set(selectedNodes.map((n) => n.id));
    setNodes((ns) => ns.filter((n) => !n.selected));
    setEdges((es) => es.filter((e) => !e.selected && !ids.has(e.source) && !ids.has(e.target)));
  };
  const editEdgeLabel = async (_, edge) => {
    const label = await dialog.prompt({ title: 'Edge label', label: 'Label', defaultValue: edge.label || '', placeholder: 'e.g. Yes', required: false });
    if (label === null || label === undefined) return;
    updateEdge(edge.id, { label: label.trim() || undefined });
  };
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ format: 'onetier.canvas/v1', name, exported_at: new Date().toISOString(), ...serialize(nodes, edges) }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(name || 'canvas').replace(/[^\w-]+/g, '_')}.canvas.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const applyGenerated = (data, mode) => {
    const gNodes = (data.nodes || []).map(toFlowNode);
    const gEdges = (data.edges || []).map(toFlowEdge);
    if (mode === 'replace' || !nodes.length) {
      setNodes(gNodes); setEdges(gEdges);
    } else {
      const maxX = Math.max(...nodes.map((n) => n.position.x)) + 320;
      const minY = Math.min(...nodes.map((n) => n.position.y));
      const map = {};
      const ns = gNodes.map((n) => { const nid = uid('n'); map[n.id] = nid; return { ...n, id: nid, position: { x: n.position.x + maxX, y: n.position.y + minY } }; });
      const es = gEdges.map((e) => ({ ...e, id: uid('e'), source: map[e.source], target: map[e.target] })).filter((e) => e.source && e.target);
      setNodes((cur) => [...cur.map((n) => ({ ...n, selected: false })), ...ns]);
      setEdges((cur) => [...cur, ...es]);
    }
    setTimeout(() => rf.fitView({ padding: 0.2, maxZoom: 1.1, duration: 300 }), 80);
  };

  if (loadState.loading) return <div className="editor-shell"><Loading label="Loading canvas…" /></div>;
  if (loadState.error) {
    return (
      <div className="editor-shell">
        <div className="editor-top"><Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => nav('/canvas')}>Canvases</Button></div>
        <div className="page page-narrow"><ErrorState error={loadState.error} onRetry={loadState.error.status === 404 ? undefined : load} />
          {loadState.error.status === 404 && <div style={{ padding: '0 20px' }}><Link to="/canvas">Back to all canvases</Link></div>}</div>
      </div>
    );
  }

  const SaveIcon = { saved: Check, unsaved: Cloud, saving: Loader2, error: CloudOff }[saveState];
  const saveText = { saved: 'All changes saved', unsaved: 'Unsaved changes', saving: 'Saving…', error: 'Save failed' }[saveState];

  return (
    <div className="editor-shell">
      <div className="editor-top">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => nav('/canvas')} aria-label="Back to canvases" />
        <input className="inline-title grow" style={{ maxWidth: 420 }} value={name} aria-label="Canvas name" onChange={(e) => setName(e.target.value)}
          onBlur={() => !name.trim() && setName('Untitled canvas')} />
        <span className="cv-savestatus" style={{ color: saveState === 'error' ? 'var(--danger)' : undefined }} title={saveText}>
          <SaveIcon style={saveState === 'saving' ? { animation: 'spin .8s linear infinite' } : undefined} /><span className="cv-hide-sm">{saveText}</span>
        </span>
        {saveState === 'error' && <Button size="sm" onClick={() => save(current)}>Retry</Button>}
        <div className="grow" />
        <span className="tiny subtle cv-hide-sm">{nodes.length} nodes · {edges.length} connections</span>
      </div>
      <div className="editor-body">
        <div className="editor-canvas" ref={wrapRef} style={{ overflow: 'hidden' }}>
          <div className="cv-toolbar" role="toolbar" aria-label="Canvas tools">
            {Object.entries(KINDS).map(([k, K]) => (
              <button key={k} type="button" className="cv-tool" title={`Add ${K.label.toLowerCase()} — ${K.hint}`} onClick={() => addNode(k)}><K.icon />{K.label.replace(' step', '')}</button>
            ))}
            <span className="sep" />
            <button type="button" className="cv-tool" onClick={() => setGenOpen(true)} style={{ color: 'var(--brand)' }}><Sparkles />Generate</button>
            <button type="button" className="cv-tool" onClick={() => rf.fitView({ padding: 0.2, duration: 300 })}><Maximize />Fit view</button>
            <button type="button" className="cv-tool" onClick={exportJson}><Download />Export</button>
            <button type="button" className="cv-tool" onClick={deleteSelection} disabled={!selectedNodes.length && !selectedEdges.length} title="Delete selection (Backspace)"><Trash2 />Delete</button>
          </div>
          <ReactFlow className="cv-flow" nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={onConnect} onEdgeDoubleClick={editEdgeLabel} connectionMode={ConnectionMode.Loose} defaultEdgeOptions={EDGE_DEFAULTS}
            colorMode={colorMode} deleteKeyCode={['Backspace', 'Delete']} snapToGrid snapGrid={[10, 10]} minZoom={0.2} maxZoom={2}
            proOptions={{ hideAttribution: true }} fitView>
            <Background gap={20} size={1.2} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="cv-hide-sm" nodeColor={(n) => ({ start: '#12a150', end: '#8d8b9d', flow: '#5b3df5', decision: '#c27803', note: '#e9d77a' }[n.data?.kind] || '#c9c8d6')} />
          </ReactFlow>
          {!nodes.length && (
            <div className="center" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              <div className="card card-pad" style={{ pointerEvents: 'auto', textAlign: 'center', maxWidth: 360 }}>
                <h3>Empty canvas</h3>
                <p className="muted small mt-8">Add steps from the toolbar, or describe your process and let AI draw it.</p>
                <div className="row mt-16" style={{ justifyContent: 'center' }}>
                  <Button size="sm" icon={Plus} onClick={() => addNode('start')}>Add start</Button>
                  <Button size="sm" variant="primary" icon={Sparkles} onClick={() => setGenOpen(true)}>Generate</Button>
                </div>
              </div>
            </div>
          )}
        </div>
        {(selNode || selEdge) && (
          <aside className="editor-side cv-side">
            {selNode ? (
              <NodeInspector key={selNode.id} node={selNode} flows={flows} reloadFlows={loadFlows} onChange={(p) => updateNodeData(selNode.id, p)}
                onDelete={deleteSelection} onClose={() => setNodes((ns) => ns.map((n) => ({ ...n, selected: false })))} />
            ) : (
              <EdgeInspector edge={selEdge} nodes={nodes} onChange={(p) => updateEdge(selEdge.id, p)} onDelete={deleteSelection}
                onClose={() => setEdges((es) => es.map((e) => ({ ...e, selected: false })))} />
            )}
          </aside>
        )}
      </div>
      {genOpen && <GenerateModal hasNodes={nodes.length > 0} onClose={() => setGenOpen(false)} onApply={applyGenerated} />}
    </div>
  );
}

// ---------------------------------------------------------------- inspectors
function NodeInspector({ node, flows, reloadFlows, onChange, onDelete, onClose }) {
  const nav = useNavigate();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const d = node.data;
  const flowOptions = flows.options.map((o) => ({ value: o.value, label: o.label }));
  const linkFlow = (flowId) => {
    if (!flowId) return onChange({ flowId: undefined, flowName: undefined, flowStatus: undefined });
    const o = flows.options.find((x) => x.value === flowId);
    onChange({ flowId, flowName: o?.label, flowStatus: flows.status[flowId] || 'draft', ...(d.kind === 'manual' ? { kind: 'flow' } : {}) });
  };
  const createFlow = async () => {
    setCreating(true);
    try {
      const flowName = d.label?.trim() || 'Untitled flow';
      const { id } = await api.post('flows', { name: flowName, description: d.notes || '' });
      onChange({ flowId: id, flowName, flowStatus: 'draft', ...(['manual', 'decision', 'note'].includes(d.kind) ? { kind: 'flow' } : {}) });
      toast.success('Flow created and linked to this step');
      reloadFlows();
    } catch (e) { toast.error(e.message); } finally { setCreating(false); }
  };
  const K = KINDS[d.kind] || KINDS.manual;
  return (
    <>
      <div className="editor-side-header">
        <K.icon size={18} style={{ color: 'var(--brand)' }} /><h3 className="grow">{K.label}</h3>
        <Button variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Close inspector" />
      </div>
      <div className="editor-side-body">
        <Field label="Label"><Textarea rows={2} style={{ minHeight: 56 }} value={d.label} onChange={(e) => onChange({ label: e.target.value })} autoFocus /></Field>
        <Field label="Kind">
          <div className="cv-kindgrid">
            {Object.entries(KINDS).map(([k, X2]) => <button key={k} type="button" className={d.kind === k ? 'active' : ''} onClick={() => onChange({ kind: k })}><X2.icon />{X2.label.replace(' step', '')}</button>)}
          </div>
        </Field>
        <Field label="Notes" help="Who does this, which tools are involved, SLAs…"><Textarea rows={4} value={d.notes || ''} onChange={(e) => onChange({ notes: e.target.value })} /></Field>
        {!['start', 'end', 'note'].includes(d.kind) && (
          <div className="panel">
            <div className="row mb-8"><Workflow size={16} /><span className="bold grow">Automation</span>{d.flowId && d.flowStatus !== 'missing' && <FlowStatus status={d.flowStatus || 'draft'} />}</div>
            {d.flowId && d.flowStatus === 'missing' && <div className="mb-8"><Callout type="warning">The linked flow no longer exists.</Callout></div>}
            <Field label="Linked flow">
              <Select value={d.flowId || ''} onChange={(e) => linkFlow(e.target.value)} placeholder="Not linked"
                options={d.flowId && !flowOptions.some((o) => o.value === d.flowId) ? [...flowOptions, { value: d.flowId, label: d.flowName || 'Missing flow' }] : flowOptions} />
            </Field>
            <div className="row wrap">
              {d.flowId && d.flowStatus !== 'missing'
                ? <Button size="sm" variant="primary" icon={ExternalLink} onClick={() => nav(`/flows/${d.flowId}`)}>Open flow</Button>
                : <Button size="sm" variant="primary" icon={Plus} loading={creating} onClick={createFlow}>Create flow from this step</Button>}
              {d.flowId && <Button size="sm" variant="ghost" icon={Unlink} onClick={() => linkFlow('')}>Unlink</Button>}
            </div>
          </div>
        )}
      </div>
      <div className="editor-side-footer"><Button variant="danger-ghost" size="sm" icon={Trash2} onClick={onDelete}>Delete node</Button></div>
    </>
  );
}

function EdgeInspector({ edge, nodes, onChange, onDelete, onClose }) {
  const label = (nid) => nodes.find((n) => n.id === nid)?.data?.label || nid;
  return (
    <>
      <div className="editor-side-header"><h3 className="grow">Connection</h3><Button variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Close inspector" /></div>
      <div className="editor-side-body">
        <div className="panel small mb-16"><span className="muted">From</span> <b>{label(edge.source)}</b><br /><span className="muted">To</span> <b>{label(edge.target)}</b></div>
        <Field label="Label" help="Shown on the arrow — e.g. “Yes” / “No” after a decision.">
          <Input autoFocus value={edge.label || ''} onChange={(e) => onChange({ label: e.target.value || undefined })} placeholder="e.g. Yes" />
        </Field>
        <div className="row wrap">{['Yes', 'No', 'Approved', 'Rejected'].map((l) => <Badge key={l} className="badge-outline" style={{ cursor: 'pointer' }} onClick={() => onChange({ label: l })}>{l}</Badge>)}</div>
        <Field label="Animated" className="mt-16">
          <Segmented value={edge.animated === false ? 'no' : 'yes'} onChange={(v) => onChange({ animated: v === 'yes' })} options={[{ value: 'yes', label: 'Animated' }, { value: 'no', label: 'Static' }]} />
        </Field>
      </div>
      <div className="editor-side-footer"><Button variant="danger-ghost" size="sm" icon={Trash2} onClick={onDelete}>Delete connection</Button></div>
    </>
  );
}

function GenerateModal({ hasNodes, onClose, onApply }) {
  const [desc, setDesc] = useState('');
  const [mode, setMode] = useState(hasNodes ? 'append' : 'replace');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    if (desc.trim().length < 10) return setErr('Describe the process in a sentence or two.');
    setBusy(true); setErr('');
    try {
      const data = await api.post('canvases/generate', { description: desc.trim() });
      if (!data?.nodes?.length) throw new Error('Nothing was generated — try describing the steps in more detail.');
      onApply(data, mode); onClose();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Generate with AI" subtitle="Describe the process; each sentence or “then” becomes a step." onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={Sparkles} loading={busy} onClick={submit}>Generate</Button></>}>
      <Field label="Process description" required>
        <Textarea autoFocus rows={6} value={desc} onChange={(e) => setDesc(e.target.value)}
          placeholder="New hire signs the offer. Then IT creates their accounts. Is the laptop in stock? Then ship the laptop. Then the manager schedules onboarding." />
      </Field>
      {hasNodes && (
        <Field label="What should happen to the current diagram?">
          <Segmented value={mode} onChange={setMode} options={[{ value: 'append', label: 'Add alongside' }, { value: 'replace', label: 'Replace everything' }]} />
        </Field>
      )}
      {mode === 'replace' && hasNodes && <Callout type="warning">Replacing removes every existing node and connection on this canvas.</Callout>}
      {err && <div className="mt-16"><Callout type="danger">{err}</Callout></div>}
    </Modal>
  );
}
