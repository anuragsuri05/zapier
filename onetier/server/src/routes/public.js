import { Router } from 'express';
import { get, all, run, uid, now, j, s } from '../db.js';
import { apiKeyAuth } from '../auth.js';
import { handleWebhook } from '../engine/triggers.js';
import { callFlow, runSingleAction } from '../engine/index.js';
import { getApp, listApps, serializeApp } from '../apps/registry.js';
import * as svc from '../services.js';
import { chatbotReply } from '../chatbot.js';
import { builderTools } from '../mcp-builder.js';

export const hooks = Router();
export const publicApi = Router();
export const v1 = Router();
export const mcp = Router();

// ---------------------------------------------------------------- Webhooks
hooks.all('/catch/:flowId/:secret', async (req, res) => {
  try {
    const r = await handleWebhook(req.params.flowId, req.params.secret, req);
    res.status(r.status).json(r.body);
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// ---------------------------------------------------------------- Public interfaces
function publicInterface(slug, req) {
  const i = get('SELECT * FROM interfaces WHERE slug = ?', slug);
  if (!i || !i.published) throw Object.assign(new Error('This page is not published.'), { status: 404 });
  const config = j(i.config, {});
  if (config.access === 'password' && config.password && (req.headers['x-interface-password'] || req.body?.password) !== config.password) throw Object.assign(new Error('Password required'), { status: 401, passwordRequired: true });
  return { i, config };
}
const pwrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 400).json({ error: e.message, passwordRequired: e.passwordRequired }); } };

publicApi.get('/interfaces/:slug', pwrap((req, res) => {
  const { i, config } = publicInterface(req.params.slug, req);
  const blocks = (config.blocks || []).map((b) => {
    if (b.type === 'chatbot' && b.chatbotId) { const bot = get('SELECT slug, name, config FROM chatbots WHERE id = ? AND published = 1', b.chatbotId); return { ...b, chatbot: bot ? { slug: bot.slug, name: bot.name, greeting: j(bot.config, {}).greeting, theme: j(bot.config, {}).theme } : null }; }
    if (b.type === 'button') return { ...b, flowId: undefined, hasFlow: Boolean(b.flowId) };
    if (b.type === 'form') return { ...b, saveToTable: undefined };
    if (b.type === 'table') return { ...b, tableId: undefined };
    return b;
  });
  res.json({ name: i.name, theme: config.theme || {}, blocks });
}));
publicApi.post('/interfaces/:slug/submit', pwrap((req, res) => {
  const { i, config } = publicInterface(req.params.slug, req);
  const block = (config.blocks || []).find((b) => b.id === req.body.blockId && b.type === 'form');
  if (!block) throw new Error('Form not found');
  const input = req.body.data || {};
  const data = {}; const errors = {};
  for (const f of block.fields || []) {
    let v = input[f.id] ?? input[f.label];
    if (typeof v === 'string') v = v.trim();
    if (f.required && (v === undefined || v === '' || v === false || (Array.isArray(v) && !v.length))) errors[f.id] = `${f.label} is required`;
    else if (v && f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errors[f.id] = 'Enter a valid email';
    else if (v !== undefined && v !== '' && f.type === 'number' && isNaN(Number(v))) errors[f.id] = 'Enter a number';
    data[f.label] = f.type === 'number' && v !== '' && v !== undefined ? Number(v) : v ?? '';
  }
  if (Object.keys(errors).length) return res.status(422).json({ error: 'Please fix the highlighted fields.', errors });
  data.submitted_at = now();
  const sid = uid('sub_');
  run('INSERT INTO submissions (id, interface_id, block_id, data, created_at) VALUES (?,?,?,?,?)', sid, i.id, block.id, s(data), now());
  if (block.saveToTable) { try { svc.createRecord(i.workspace_id, block.saveToTable, data, { source: 'interface' }); } catch (e) { console.error('[interface→table]', e.message); } }
  svc.bus.emit('interface.submitted', { wsId: i.workspace_id, interfaceId: i.id, blockId: block.id, data: { ...data, submission_id: sid, interface: i.name } });
  res.json({ ok: true, message: block.successMessage || 'Thanks! Your response was recorded.', redirect: block.redirectUrl || null });
}));
publicApi.post('/interfaces/:slug/button', pwrap(async (req, res) => {
  const { i, config } = publicInterface(req.params.slug, req);
  const block = (config.blocks || []).find((b) => b.id === req.body.blockId && b.type === 'button');
  if (!block) throw new Error('Button not found');
  const data = { interface: i.name, button: block.label, clicked_at: now(), inputs: req.body.inputs || {} };
  if (block.flowId) {
    const r = await callFlow(i.workspace_id, block.flowId, data, { source: 'interface' });
    if (r.status === 'error' || r.status === 'halted') throw new Error(r.error || 'The automation failed.');
    return res.json({ ok: true, message: block.successMessage || 'Done!', result: r.returnValue ?? null });
  }
  svc.bus.emit('interface.button', { wsId: i.workspace_id, interfaceId: i.id, data });
  res.json({ ok: true, message: block.successMessage || 'Done!' });
}));
publicApi.get('/interfaces/:slug/table/:blockId', pwrap((req, res) => {
  const { i, config } = publicInterface(req.params.slug, req);
  const block = (config.blocks || []).find((b) => b.id === req.params.blockId && b.type === 'table');
  if (!block?.tableId) throw new Error('Table block not found');
  const t = svc.getTable(i.workspace_id, block.tableId);
  const visible = t.fields.filter((f) => !block.fields?.length || block.fields.includes(f.id));
  const q = String(req.query.q || '').toLowerCase();
  let recs = all('SELECT * FROM table_records WHERE table_id = ? ORDER BY created_at DESC LIMIT 500', t.id).map((r) => ({ id: r.id, data: j(r.data, {}), created_at: r.created_at }));
  if (q) recs = recs.filter((r) => JSON.stringify(r.data).toLowerCase().includes(q));
  res.json({ fields: visible.map((f) => ({ id: f.id, name: f.name, type: f.type, options: f.options })), records: recs.slice(0, 200).map((r) => ({ id: r.id, data: Object.fromEntries(visible.map((f) => [f.id, r.data[f.id]])), created_at: r.created_at })), allowAdd: Boolean(block.allowAdd) });
}));
publicApi.post('/interfaces/:slug/table/:blockId', pwrap((req, res) => {
  const { i, config } = publicInterface(req.params.slug, req);
  const block = (config.blocks || []).find((b) => b.id === req.params.blockId && b.type === 'table');
  if (!block?.allowAdd) throw new Error('Adding records is not allowed here.');
  res.json(svc.createRecord(i.workspace_id, block.tableId, req.body.data || {}, { source: 'interface' }));
}));

// ---------------------------------------------------------------- Public chatbots
publicApi.get('/chatbots/:slug', pwrap((req, res) => {
  const b = get('SELECT * FROM chatbots WHERE slug = ?', req.params.slug);
  if (!b || !b.published) throw Object.assign(new Error('This chatbot is not published.'), { status: 404 });
  const c = j(b.config, {});
  res.json({ name: b.name, greeting: c.greeting, suggested: c.suggested || [], theme: c.theme || {} });
}));
publicApi.post('/chatbots/:slug/message', pwrap(async (req, res) => {
  const b = get('SELECT * FROM chatbots WHERE slug = ?', req.params.slug);
  if (!b || !b.published) throw Object.assign(new Error('This chatbot is not published.'), { status: 404 });
  if (!String(req.body.message || '').trim()) throw new Error('Message is empty');
  res.json(await chatbotReply(b, { conversationId: req.body.conversationId, message: req.body.message, visitor: req.body.visitor || 'Visitor' }));
}));

// ---------------------------------------------------------------- REST API v1 (API keys)
v1.use(apiKeyAuth);
const vwrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 400).json({ error: e.message }); } };
v1.get('/me', (req, res) => res.json({ workspace: { id: req.ws.id, name: req.ws.name, plan: req.ws.plan } }));
v1.get('/flows', (req, res) => res.json(all('SELECT id, name, status, version, updated_at, last_run_at FROM flows WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC', req.ws.id)));
v1.post('/flows/:id/run', vwrap(async (req, res) => {
  const p = callFlow(req.ws.id, req.params.id, req.body?.data ?? req.body ?? {}, { source: 'api' });
  if (req.query.wait === 'false') { p.catch(() => {}); return res.status(202).json({ accepted: true }); }
  const r = await p; res.json({ run_id: r.runId, status: r.status, return: r.returnValue ?? null, error: r.error });
}));
v1.get('/runs/:id', vwrap((req, res) => {
  const r = get('SELECT id, flow_id, flow_name, status, source, tasks_used, error, started_at, finished_at FROM runs WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id);
  if (!r) throw Object.assign(new Error('Run not found'), { status: 404 });
  res.json({ ...r, steps: all('SELECT seq, title, status, error, output FROM run_steps WHERE run_id = ? ORDER BY seq', r.id).map((x) => ({ ...x, output: j(x.output) })) });
}));
v1.get('/tables', (req, res) => res.json(all('SELECT id, name, fields FROM tables_ WHERE workspace_id = ?', req.ws.id).map((t) => ({ ...t, fields: j(t.fields, []) }))));
v1.get('/tables/:id/records', vwrap((req, res) => {
  const t = svc.getTable(req.ws.id, req.params.id);
  res.json(all('SELECT * FROM table_records WHERE table_id = ? ORDER BY created_at DESC LIMIT ?', t.id, Math.min(1000, Number(req.query.limit) || 100)).map((r) => svc.presentRecord(t, r)));
}));
v1.post('/tables/:id/records', vwrap((req, res) => res.json(svc.createRecord(req.ws.id, req.params.id, req.body?.data || req.body || {}, { source: 'api' }))));
v1.patch('/tables/:id/records/:rid', vwrap((req, res) => res.json(svc.updateRecord(req.ws.id, req.params.id, req.params.rid, req.body?.data || req.body || {}, { source: 'api' }))));
v1.delete('/tables/:id/records/:rid', vwrap((req, res) => res.json(svc.deleteRecord(req.ws.id, req.params.id, req.params.rid))));
v1.get('/apps', (req, res) => res.json(listApps(req.ws.id).map((a) => ({ key: a.key, name: a.name, category: a.category, triggers: Object.keys(a.triggers || {}), actions: Object.keys(a.actions || {}) }))));
v1.post('/actions/:app/:action', vwrap(async (req, res) => {
  const r = await runSingleAction({ wsId: req.ws.id, app: req.params.app, action: req.params.action, params: req.body?.params || {}, connectionId: req.body?.connectionId, source: 'api' });
  res.status(r.status === 'success' ? 200 : 400).json(r);
}));

// ---------------------------------------------------------------- MCP server (Model Context Protocol, streamable HTTP / JSON)
const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
function mcpTools(server, req) {
  const out = [];
  for (const t of j(server.tools, [])) {
    if (t.type === 'builder') {
      for (const b of builderTools(server.workspace_id, req)) out.push({ def: { type: 'builder', run: b.run }, name: b.name, description: b.description, inputSchema: b.inputSchema });
      continue;
    }
    if (t.type === 'flow') {
      const f = get('SELECT id, name, description, status FROM flows WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL', t.flowId, server.workspace_id);
      if (!f) continue;
      out.push({ def: t, name: `run_flow_${f.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}`, description: t.description || `Run the OneTier flow "${f.name}". ${f.description || ''}`.trim(),
        inputSchema: { type: 'object', properties: { inputs: { type: 'object', description: 'Input values passed to the flow trigger' } } } });
      continue;
    }
    const app = getApp(t.app, server.workspace_id);
    const act = app?.actions?.[t.action];
    if (!act?.run) continue;
    const props = {}; const required = [];
    for (const f of act.fields || []) {
      if (t.params?.[f.key] !== undefined && t.params[f.key] !== '') continue;
      props[f.key] = { type: f.type === 'number' ? 'number' : f.type === 'boolean' ? 'boolean' : 'string', description: `${f.label}${f.help ? `. ${f.help}` : ''}` };
      if (f.options) props[f.key].enum = f.options.map((o) => o.value);
      if (f.required) required.push(f.key);
    }
    out.push({ def: t, name: (t.name || `${app.key}_${t.action}`).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64), description: t.description || `${app.name}: ${act.name}. ${act.description || app.description || ''}`.trim(), inputSchema: { type: 'object', properties: props, required } });
  }
  return out;
}

mcp.get('/:token', (req, res) => res.status(405).set('allow', 'POST').json({ error: 'Use POST with JSON-RPC (MCP streamable HTTP transport).' }));
mcp.delete('/:token', (req, res) => res.status(200).end());
mcp.post('/:token', async (req, res) => {
  const server = get('SELECT * FROM mcp_servers WHERE token = ?', req.params.token);
  if (!server) return res.status(404).json({ jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32001, message: 'Unknown MCP server URL' } });
  run('UPDATE mcp_servers SET last_used_at = ? WHERE id = ?', now(), server.id);
  const handle = async (msg) => {
    const { id, method, params = {} } = msg || {};
    const ok = (result) => ({ jsonrpc: '2.0', id, result });
    const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
    if (id === undefined || id === null) return null; // notification
    switch (method) {
      case 'initialize': {
        const v = SUPPORTED.includes(params.protocolVersion) ? params.protocolVersion : SUPPORTED[0];
        return ok({ protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: { name: `OneTier · ${server.name}`, version: '1.0.0' }, instructions: 'Tools run real actions in this OneTier workspace. Builder tools (onetier_*) let you design automations: call onetier_list_apps and onetier_get_app_details to learn exact app/field keys, then onetier_create_flow, test it with onetier_run_flow (test=true), fix issues, and onetier_publish_flow. Share the editor_url with the user.' });
      }
      case 'ping': return ok({});
      case 'tools/list': return ok({ tools: mcpTools(server, req).map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      case 'tools/call': {
        const tool = mcpTools(server, req).find((t) => t.name === params.name);
        if (!tool) return fail(-32602, `Unknown tool: ${params.name}`);
        const args = params.arguments || {};
        let r;
        if (tool.def.type === 'builder') {
          try {
            const out = await tool.def.run(args);
            return ok({ content: [{ type: 'text', text: JSON.stringify(out, null, 2).slice(0, 80000) }], structuredContent: Array.isArray(out) ? { items: out } : out });
          } catch (e) { return ok({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true }); }
        }
        if (tool.def.type === 'flow') {
          try { r = await callFlow(server.workspace_id, tool.def.flowId, { inputs: args.inputs || args, source: 'mcp' }, { source: 'mcp' }); r = { status: r.status === 'success' ? 'success' : 'error', output: { run_id: r.runId, status: r.status, return: r.returnValue ?? null }, error: r.error }; }
          catch (e) { r = { status: 'error', error: e.message }; }
        } else {
          r = await runSingleAction({ wsId: server.workspace_id, app: tool.def.app, action: tool.def.action, params: { ...(tool.def.params || {}), ...args }, connectionId: tool.def.connectionId, source: 'mcp', runLabel: `MCP · ${tool.name}` });
        }
        if (r.status !== 'success') return ok({ content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true });
        return ok({ content: [{ type: 'text', text: JSON.stringify(r.output, null, 2).slice(0, 50000) }], structuredContent: typeof r.output === 'object' && !Array.isArray(r.output) ? r.output : { result: r.output } });
      }
      case 'resources/list': return ok({ resources: [] });
      case 'prompts/list': return ok({ prompts: [] });
      default: return fail(-32601, `Method not found: ${method}`);
    }
  };
  try {
    if (Array.isArray(req.body)) {
      const out = (await Promise.all(req.body.map(handle))).filter(Boolean);
      return out.length ? res.json(out) : res.status(202).end();
    }
    const out = await handle(req.body);
    if (!out) return res.status(202).end();
    res.json(out);
  } catch (e) { res.status(500).json({ jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32603, message: e.message } }); }
});

export { serializeApp };
