import { useState } from 'react';
import { Play, Plug, Terminal, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button, Field, Select, Textarea, JsonView, Callout, Badge } from '../../components/ui.jsx';

const PROTOCOL = '2025-06-18';

/** Path of the MCP URL on this origin (the server URL is /mcp/<token>). */
export function mcpPath(url) {
  try { return new URL(url).pathname; } catch { return url; }
}

async function rpc(url, method, params, id) {
  const res = await fetch(mcpPath(url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': PROTOCOL },
    body: JSON.stringify(id == null ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params }),
  });
  if (res.status === 202) return null;
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { throw new Error(`Unexpected response (${res.status}): ${text.slice(0, 200)}`); }
  if (data.error) throw Object.assign(new Error(data.error.message), { rpc: data });
  return data;
}

function sampleArgs(schema) {
  const out = {};
  for (const [k, p] of Object.entries(schema?.properties || {})) {
    if (!(schema.required || []).includes(k) && Object.keys(schema.properties).length > 4) continue;
    out[k] = p.enum ? p.enum[0] : p.type === 'number' ? 0 : p.type === 'boolean' ? false : p.type === 'object' ? {} : '';
  }
  return out;
}

export default function TestConsole({ server, dirty }) {
  const [state, setState] = useState({ phase: 'idle' }); // idle | connecting | ready | error
  const [log, setLog] = useState([]);
  const [tool, setTool] = useState('');
  const [args, setArgs] = useState('{}');
  const [argErr, setArgErr] = useState('');
  const [calling, setCalling] = useState(false);
  const [result, setResult] = useState(null);
  const push = (entry) => setLog((l) => [...l.slice(-20), { at: new Date().toLocaleTimeString(), ...entry }]);

  const connect = async () => {
    setState({ phase: 'connecting' }); setResult(null); setLog([]);
    try {
      const init = await rpc(server.url, 'initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'OneTier test console', version: '1.0.0' } }, 1);
      push({ method: 'initialize', ok: true, summary: `${init.result.serverInfo?.name} · protocol ${init.result.protocolVersion}` });
      await rpc(server.url, 'notifications/initialized', {}, null);
      const list = await rpc(server.url, 'tools/list', {}, 2);
      const tools = list.result.tools || [];
      push({ method: 'tools/list', ok: true, summary: `${tools.length} tool${tools.length === 1 ? '' : 's'}` });
      setState({ phase: 'ready', info: init.result, tools });
      if (tools[0]) { setTool(tools[0].name); setArgs(JSON.stringify(sampleArgs(tools[0].inputSchema), null, 2)); }
    } catch (e) { push({ method: 'initialize', ok: false, summary: e.message }); setState({ phase: 'error', error: e.message }); }
  };

  const pick = (name) => {
    setTool(name); setResult(null); setArgErr('');
    const t = state.tools.find((x) => x.name === name);
    setArgs(JSON.stringify(sampleArgs(t?.inputSchema), null, 2));
  };

  const call = async () => {
    let parsed;
    try { parsed = args.trim() ? JSON.parse(args) : {}; if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Arguments must be a JSON object'); }
    catch (e) { setArgErr(e.message); return; }
    setArgErr(''); setCalling(true); setResult(null);
    const started = performance.now();
    try {
      const r = await rpc(server.url, 'tools/call', { name: tool, arguments: parsed }, Date.now());
      const ms = Math.round(performance.now() - started);
      setResult({ ...r.result, ms });
      push({ method: `tools/call ${tool}`, ok: !r.result.isError, summary: r.result.isError ? 'Tool returned an error' : `Success in ${ms}ms` });
    } catch (e) { setResult({ isError: true, content: [{ type: 'text', text: e.message }], ms: Math.round(performance.now() - started) }); push({ method: `tools/call ${tool}`, ok: false, summary: e.message }); }
    finally { setCalling(false); }
  };

  const current = state.tools?.find((t) => t.name === tool);
  return (
    <div className="card">
      <div className="card-header">
        <div><h3 className="row gap-4"><Terminal size={16} />Test console</h3><div className="tiny subtle">Talks to your server URL over JSON-RPC, exactly like an AI client. Tool calls run for real and use 2 tasks each.</div></div>
        <Button size="sm" variant={state.phase === 'ready' ? 'secondary' : 'primary'} icon={Plug} loading={state.phase === 'connecting'} onClick={connect}>{state.phase === 'ready' ? 'Reconnect' : 'Connect'}</Button>
      </div>
      <div className="card-body">
        {dirty && <div className="mb-16"><Callout type="warning" icon={AlertTriangle}>You have unsaved tool changes. The console uses the saved configuration — save first to test them.</Callout></div>}
        {state.phase === 'idle' && <p className="muted small">Click <b>Connect</b> to run <code>initialize</code> and <code>tools/list</code> against this server.</p>}
        {state.phase === 'error' && <Callout type="danger">{state.error}</Callout>}
        {state.phase === 'ready' && (
          !state.tools.length ? <Callout type="info">Connected, but the server exposes no tools. Add a tool above and save.</Callout> : (
            <>
              <Field label="Tool">
                <Select value={tool} onChange={(e) => pick(e.target.value)} options={state.tools.map((t) => ({ value: t.name, label: t.name }))} />
              </Field>
              {current && <p className="small muted mb-16">{current.description}</p>}
              {current && Object.keys(current.inputSchema?.properties || {}).length > 0 && (
                <div className="row wrap mb-8" style={{ gap: 4 }}>
                  {Object.entries(current.inputSchema.properties).map(([k, p]) => (
                    <Badge key={k} title={p.description} color={(current.inputSchema.required || []).includes(k) ? 'brand' : undefined}>{k}: {p.enum ? p.enum.slice(0, 4).join('|') : p.type}</Badge>
                  ))}
                </div>
              )}
              <Field label="Arguments (JSON)" error={argErr}>
                <Textarea className="code-input" style={{ minHeight: 120 }} value={args} onChange={(e) => setArgs(e.target.value)} spellCheck={false} invalid={Boolean(argErr)} />
              </Field>
              <Button variant="primary" icon={Play} loading={calling} onClick={call}>Run tools/call</Button>
              {result && (
                <div className="mt-16">
                  <div className="row mb-8">{result.isError ? <Badge color="red" dot>isError: true</Badge> : <Badge color="green" dot>Success</Badge>}<span className="tiny subtle">{result.ms}ms</span></div>
                  {(result.content || []).map((c, i) => <JsonView key={i} data={c.type === 'text' ? c.text : c} maxHeight={300} />)}
                </div>
              )}
            </>
          )
        )}
        {log.length > 0 && (
          <div className="mt-16">
            <div className="tiny subtle bold mb-8">PROTOCOL LOG</div>
            <div className="mcp-log">
              {log.map((l, i) => (
                <div key={i} className="row small" style={{ gap: 8 }}>
                  {l.ok ? <CheckCircle2 size={14} style={{ color: 'var(--success)' }} /> : <AlertTriangle size={14} style={{ color: 'var(--danger)' }} />}
                  <span className="subtle tiny mono">{l.at}</span><code>{l.method}</code><span className="muted truncate grow">{l.summary}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
