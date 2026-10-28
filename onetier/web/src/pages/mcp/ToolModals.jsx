import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useApps, useFetch } from '../../lib/context.jsx';
import ConnectModal from '../../components/ConnectModal.jsx';
import { Modal, Button, Field, Input, Textarea, Select, KeyValueEditor, AppIcon, Callout, Loading, Badge } from '../../components/ui.jsx';

export const toolName = (t) => (t.name || `${t.app}_${t.action}`).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);

/** Add (or edit) an action tool: app → action → connection → fixed params → name/description. */
export function ActionToolModal({ initial, onClose, onSave }) {
  const { apps, getApp } = useApps();
  const conns = useFetch('connections');
  const [appKey, setAppKey] = useState(initial?.app || '');
  const [action, setAction] = useState(initial?.action || '');
  const [connectionId, setConnectionId] = useState(initial?.connectionId || '');
  const [params, setParams] = useState(Object.entries(initial?.params || {}).map(([key, value]) => ({ key, value: typeof value === 'string' ? value : JSON.stringify(value) })));
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [connectOpen, setConnectOpen] = useState(false);
  const [err, setErr] = useState('');

  const eligible = useMemo(() => apps.filter((a) => !a.control && Object.keys(a.actions || {}).length).sort((a, b) => a.name.localeCompare(b.name)), [apps]);
  const app = getApp(appKey);
  const act = app?.actions?.[action];
  const appConns = (conns.data || []).filter((c) => c.app === appKey);

  const pickApp = (k) => {
    setAppKey(k); setParams([]); setErr('');
    const a = getApp(k);
    const first = Object.keys(a?.actions || {})[0] || '';
    setAction(first);
    const c = (conns.data || []).find((x) => x.app === k);
    setConnectionId(c?.id || '');
  };

  const submit = () => {
    if (!app) return setErr('Choose an app.');
    if (!act) return setErr('Choose an action.');
    if (app.auth && !connectionId) return setErr(`Connect a ${app.name} account so the tool can run.`);
    if (name && !/^[a-zA-Z0-9_-]{1,64}$/.test(name)) return setErr('Tool names may only contain letters, numbers, underscores and dashes (max 64).');
    const p = {};
    for (const r of params) {
      if (!r.key?.trim()) continue;
      const f = act.fields?.find((x) => x.key === r.key.trim());
      let v = r.value;
      if (f?.type === 'number' && v !== '' && !Number.isNaN(Number(v))) v = Number(v);
      else if (f?.type === 'boolean') v = v === 'true' || v === true;
      p[r.key.trim()] = v;
    }
    onSave({ type: 'action', app: appKey, action, ...(app.auth ? { connectionId } : {}), params: p, ...(name.trim() ? { name: name.trim() } : {}), ...(description.trim() ? { description: description.trim() } : {}) });
  };

  const usedKeys = new Set(params.map((r) => r.key));
  return (
    <Modal title={initial ? 'Edit action tool' : 'Add action tool'} subtitle="Expose one app action as a tool AI clients can call." size="lg" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>{initial ? 'Update tool' : 'Add tool'}</Button></>}>
      <div className="grid-2" style={{ gap: 12 }}>
        <Field label="App" required>
          <Select value={appKey} onChange={(e) => pickApp(e.target.value)} placeholder="Choose an app…" options={eligible.map((a) => ({ value: a.key, label: `${a.name}${a.premium ? ' (Premium)' : ''}` }))} />
        </Field>
        <Field label="Action" required>
          <Select value={action} disabled={!app} onChange={(e) => { setAction(e.target.value); setParams([]); }} placeholder={app ? 'Choose an action…' : 'Pick an app first'}
            options={Object.values(app?.actions || {}).map((a) => ({ value: a.key, label: a.name }))} />
        </Field>
      </div>
      {app && act && (
        <div className="panel row gap-12 mb-16" style={{ alignItems: 'flex-start' }}>
          <AppIcon app={app} size={32} />
          <div className="grow"><div className="bold">{app.name}: {act.name}</div>{act.description && <div className="small muted">{act.description}</div>}
            {act.aiTasks > 0 && <div className="tiny subtle mt-8">This action may use extra AI tasks.</div>}</div>
        </div>
      )}
      {app?.auth && (
        <Field label="Connection" required help="The tool acts as this account.">
          {conns.loading && !conns.data ? <Loading /> : (
            <div className="row">
              <Select className="grow" value={connectionId} onChange={(e) => setConnectionId(e.target.value)} placeholder={appConns.length ? 'Choose an account…' : 'No accounts connected yet'}
                options={appConns.map((c) => ({ value: c.id, label: `${c.name}${c.status !== 'ok' ? ' (error)' : ''}` }))} />
              <Button icon={Plus} onClick={() => setConnectOpen(true)}>Connect</Button>
            </div>
          )}
        </Field>
      )}
      {act && (
        <Field label="Fixed parameters" help="Optional. Fixed values are hidden from the AI and always used. Everything else becomes a tool argument the AI fills in.">
          {act.fields?.length > 0 && (
            <div className="row wrap mb-8" style={{ gap: 4 }}>
              {act.fields.filter((f) => !usedKeys.has(f.key)).map((f) => (
                <Badge key={f.key} className="badge-outline" style={{ cursor: 'pointer' }} title={f.help || f.label}
                  onClick={() => setParams((p) => [...p.filter((r) => r.key), { key: f.key, value: f.default != null ? String(f.default) : '' }])}>+ {f.label}{f.required ? ' *' : ''}</Badge>
              ))}
            </div>
          )}
          <KeyValueEditor value={params} onChange={setParams} keyPlaceholder="field key" valuePlaceholder="fixed value"
            renderValue={(v, set, i) => {
              const f = act.fields?.find((x) => x.key === params[i]?.key);
              if (f?.options?.length) return <Select value={v} onChange={(e) => set(e.target.value)} placeholder="Choose…" options={f.options.map((o) => ({ value: o.value, label: o.label }))} />;
              if (f?.type === 'boolean') return <Select value={String(v)} onChange={(e) => set(e.target.value)} options={['true', 'false']} />;
              return <Input value={v} onChange={(e) => set(e.target.value)} placeholder={f ? f.label : 'fixed value'} />;
            }} />
        </Field>
      )}
      <div className="grid-2" style={{ gap: 12 }}>
        <Field label="Tool name" help={`Default: ${appKey && action ? toolName({ app: appKey, action }) : 'app_action'}`}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. post_to_slack" /></Field>
        <Field label="Tool description" help="Helps the AI decide when to call it."><Textarea rows={2} style={{ minHeight: 36 }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" /></Field>
      </div>
      {err && <Callout type="danger">{err}</Callout>}
      {connectOpen && <ConnectModal appKey={appKey} onClose={() => setConnectOpen(false)} onConnected={(c) => { conns.reload(); setConnectionId(c.id); }} />}
    </Modal>
  );
}

export function FlowToolModal({ onClose, onSave, existing = [] }) {
  const flows = useFetch('dynamic/flows');
  const [flowId, setFlowId] = useState('');
  const [description, setDescription] = useState('');
  const [err, setErr] = useState('');
  const submit = () => {
    if (!flowId) return setErr('Choose a flow.');
    if (existing.includes(flowId)) return setErr('That flow is already a tool on this server.');
    onSave({ type: 'flow', flowId, ...(description.trim() ? { description: description.trim() } : {}) });
  };
  return (
    <Modal title="Add flow tool" subtitle="Let AI clients run one of your flows. The tool accepts an `inputs` object passed to the trigger." onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>Add tool</Button></>}>
      {flows.loading && !flows.data ? <Loading /> : flows.error ? <Callout type="danger">{flows.error.message}</Callout> : !flows.data.length ? (
        <Callout type="info">You don't have any flows yet. Create a flow (a Manual or Sub-flow trigger works best), then add it here.</Callout>
      ) : (
        <>
          <Field label="Flow" required><Select value={flowId} onChange={(e) => setFlowId(e.target.value)} placeholder="Choose a flow…" options={flows.data} /></Field>
          <Field label="Tool description" help="Optional — what the flow does and when the AI should use it."><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <p className="tiny subtle">Only flows that are turned on will run successfully.</p>
        </>
      )}
      {err && <div className="mt-16"><Callout type="danger">{err}</Callout></div>}
    </Modal>
  );
}
