// End-to-end test: boots a fresh OneTier server and exercises the whole platform over HTTP.
// Run: node server/test/e2e.mjs   (from the onetier/ folder)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onetier-e2e-'));

const proc = spawn(process.execPath, [path.join(here, '..', 'src', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), ONETIER_DATA_DIR: dataDir, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', ONETIER_LOCAL_AI_ACCOUNTS: 'off', PUBLIC_URL: BASE },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
proc.stdout.on('data', (d) => { serverLog += d; });
proc.stderr.on('data', (d) => { serverLog += d; });

let passed = 0; let failed = 0;
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ok(cond, name, extra) {
  if (cond) { passed++; results.push(`  ✓ ${name}`); }
  else { failed++; results.push(`  ✗ ${name}${extra ? `\n      → ${typeof extra === 'string' ? extra : JSON.stringify(extra).slice(0, 400)}` : ''}`); }
}
async function call(method, url, body, token, headers = {}) {
  const res = await fetch(BASE + url, {
    method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}
const section = (t) => results.push(`\n${t}`);

async function waitFor(fn, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(200); }
  return null;
}

async function main() {
  await waitFor(async () => { try { return (await fetch(`${BASE}/health`)).ok; } catch { return false; } }, 10000);

  section('Auth & workspace');
  let r = await call('POST', '/api/auth/signup', { name: 'Ada Lovelace', email: 'ada@example.com', password: 'password123' });
  ok(r.status === 200 && r.data.token, 'sign up', r.data);
  const T = r.data.token;
  r = await call('POST', '/api/auth/signup', { name: 'Ada', email: 'ada@example.com', password: 'password123' });
  ok(r.status === 409, 'duplicate email rejected');
  r = await call('POST', '/api/auth/login', { email: 'ada@example.com', password: 'wrong' });
  ok(r.status === 401, 'wrong password rejected');
  r = await call('GET', '/api/auth/me', undefined, T);
  ok(r.data.workspace?.plan === 'free' && r.data.plan.unlimited && !('trial_ends_at' in r.data.workspace), 'workspace is free with everything unlimited', r.data.workspace);
  r = await call('GET', '/api/apps', undefined, T);
  ok(Array.isArray(r.data) && r.data.length >= 30, `app catalog (${r.data.length} apps)`);

  section('Seeded flow: Interface form → Formatter → Email → Notification');
  r = await call('GET', '/api/flows', undefined, T);
  const seeded = r.data.find((f) => f.name === 'Welcome new contacts');
  ok(seeded, 'seeded flow exists');
  r = await call('POST', `/api/flows/${seeded.id}/publish`, {}, T);
  ok(r.status === 200 && r.data.version === 1, 'publish seeded flow', r.data);
  const ifaces = (await call('GET', '/api/interfaces', undefined, T)).data;
  const iface = ifaces[0];
  const form = iface.config.blocks.find((b) => b.type === 'form');
  r = await call('POST', `/api/public/interfaces/${iface.slug}/submit`, { blockId: form.id, data: {} });
  ok(r.status === 422 && r.data.errors, 'public form validates required fields');
  const vals = Object.fromEntries(form.fields.map((f) => [f.id, f.label === 'Email' ? 'grace@example.com' : f.label === 'Name' ? 'grace hopper' : 'Navy']));
  r = await call('POST', `/api/public/interfaces/${iface.slug}/submit`, { blockId: form.id, data: vals });
  ok(r.status === 200 && r.data.ok, 'public form submission accepted', r.data);
  const run1 = await waitFor(async () => (await call('GET', `/api/runs?flowId=${seeded.id}`, undefined, T)).data.runs.find((x) => x.status !== 'running'));
  ok(run1?.status === 'success', 'form submission triggered a successful run', run1);
  r = await call('GET', '/api/mailbox', undefined, T);
  ok(r.data.some((m) => m.subject === 'Thanks for contacting us, Grace Hopper!'), 'email delivered with mapped + formatted fields', r.data.map((m) => m.subject));
  r = await call('GET', `/api/runs/${run1.id}`, undefined, T);
  ok(r.data.steps.length === 4 && r.data.steps.every((s) => s.status === 'success'), 'run detail has 4 successful steps');
  ok(r.data.tasks_used === 1, `activity counter (email counted once) = ${r.data.tasks_used}`);
  const leads = (await call('GET', '/api/tables', undefined, T)).data.find((t) => t.name === 'Leads');
  ok(leads.record_count === 5, 'form block also saved the submission into the Leads table');

  section('Webhook flow: filter, code, formatter, storage, sync response');
  r = await call('POST', '/api/flows', { name: 'Webhook pipeline' }, T);
  const wf = r.data.id;
  const def = {
    trigger: { app: 'webhook', event: 'catch_hook', params: {} },
    steps: [
      { id: 's1', app: 'filter', action: 'check', params: { conditions: [[{ left: '{{trigger.body.amount}}', op: 'gt', right: '10' }]] } },
      { id: 's2', app: 'code', action: 'javascript', params: { inputData: [{ key: 'name', value: '{{trigger.body.name}}' }, { key: 'amount', value: '{{trigger.body.amount}}' }], code: 'return { shout: inputData.name.toUpperCase(), cents: Math.round(Number(inputData.amount) * 100) };' } },
      { id: 's3', app: 'formatter', action: 'number', params: { transform: 'currency', input: '{{trigger.body.amount}}', currency: 'USD' } },
      { id: 's4', app: 'storage', action: 'increment', params: { key: 'orders', by: 1 } },
      { id: 's5', app: 'subflow', action: 'return', params: { values: [{ key: 'message', value: '{{s2.shout}} paid {{s3.output}} ({{s2.cents}} cents) — order #{{s4.value}}' }] } },
    ],
  };
  await call('PUT', `/api/flows/${wf}`, { definition: def }, T);
  r = await call('GET', `/api/flows/${wf}`, undefined, T);
  const hook = r.data.hook_url;
  ok(hook?.includes('/hooks/catch/'), 'flow exposes a webhook URL');
  await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'sample', amount: 5 }) });
  r = await call('POST', `/api/flows/${wf}/test-trigger`, {}, T);
  ok(r.data.samples?.[0]?.body?.name === 'sample', 'test trigger returns the captured webhook sample', r.data);
  r = await call('POST', `/api/flows/${wf}/test-step`, { stepId: 's2', sampleSteps: { trigger: { body: { name: 'ada', amount: 3 } } } }, T);
  ok(r.data.output?.shout === 'ADA', 'test-step runs the code step with sample data', r.data);
  r = await call('POST', `/api/flows/${wf}/publish`, {}, T);
  ok(r.status === 200, 'publish webhook flow', r.data);
  let h = await (await fetch(`${hook}?wait=true`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'ada', amount: 49.5 }) })).json();
  ok(h.status === 'success' && h.return?.message === 'ADA paid $49.50 (4950 cents) — order #1', 'webhook sync run returns sub-flow return value', h);
  h = await (await fetch(`${hook}?wait=true`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'bob', amount: 3 }) })).json();
  ok(h.status === 'filtered', 'filter stops runs that do not match', h);
  h = await (await fetch(hook.replace(/\/[^/]+$/, '/wrongsecret'), { method: 'POST' }));
  ok(h.status === 404, 'wrong webhook secret is rejected');
  r = await call('GET', '/api/storage', undefined, T);
  ok(r.data.find((x) => x.key === 'orders')?.value === 1, 'storage incremented');

  section('Paths, looping, delay, sub-flows (manual trigger)');
  r = await call('POST', '/api/flows', { name: 'Helper sub-flow' }, T);
  const sub = r.data.id;
  await call('PUT', `/api/flows/${sub}`, { definition: { trigger: { app: 'subflow', event: 'start', params: {} }, steps: [
    { id: 'a1', app: 'formatter', action: 'text', params: { transform: 'slugify', input: '{{trigger.inputs.title}}' } },
    { id: 'a2', app: 'subflow', action: 'return', params: { values: [{ key: 'slug', value: '{{a1.output}}' }] } },
  ] } }, T);
  ok((await call('POST', `/api/flows/${sub}/publish`, {}, T)).status === 200, 'publish sub-flow');
  r = await call('POST', '/api/flows', { name: 'Router' }, T);
  const router = r.data.id;
  await call('PUT', `/api/flows/${router}`, { definition: { trigger: { app: 'manual', event: 'run', params: { inputs: ['kind', 'items'] } }, steps: [
    { id: 'p', app: 'paths', action: 'split', params: {}, paths: [
      { id: 'pa', name: 'VIP', conditions: [[{ left: '{{trigger.inputs.kind}}', op: 'equals', right: 'vip' }]], steps: [
        { id: 'v1', app: 'storage', action: 'set', params: { key: 'path_taken', value: 'vip' } }] },
      { id: 'pb', name: 'Other', fallback: true, conditions: [], steps: [
        { id: 'o1', app: 'storage', action: 'set', params: { key: 'path_taken', value: 'other' } }] },
    ] },
    { id: 'l', app: 'looping', action: 'loop', params: { items: '{{trigger.inputs.items}}' }, steps: [
      { id: 'l1', app: 'storage', action: 'push', params: { key: 'looped', value: '{{loop.iteration}}:{{loop.item}}' } }] },
    { id: 'd', app: 'delay', action: 'for', params: { amount: 1, unit: 'seconds' } },
    { id: 'c', app: 'subflow', action: 'call', params: { flowId: sub, inputs: [{ key: 'title', value: 'Hello World Again' }] } },
  ] } }, T);
  ok((await call('POST', `/api/flows/${router}/publish`, {}, T)).status === 200, 'publish router flow');
  r = await call('POST', `/api/flows/${router}/run`, { mode: 'live', data: { inputs: { kind: 'vip', items: 'a, b, c' } } }, T);
  ok(r.data.status === 'success', 'manual run succeeds', r.data);
  const kv = Object.fromEntries((await call('GET', '/api/storage', undefined, T)).data.map((x) => [x.key, x.value]));
  ok(kv.path_taken === 'vip', 'paths: matching branch ran');
  ok(JSON.stringify(kv.looped) === JSON.stringify(['1:a', '2:b', '3:c']), 'looping ran nested steps per item', kv.looped);
  ok(r.data.steps?.c?.result?.slug === 'hello-world-again', 'sub-flow call returned value', r.data.steps?.c);
  r = await call('POST', `/api/flows/${router}/run`, { mode: 'live', data: { inputs: { kind: 'x', items: 'z' } } }, T);
  const kv2 = Object.fromEntries((await call('GET', '/api/storage', undefined, T)).data.map((x) => [x.key, x.value]));
  ok(kv2.path_taken === 'other', 'paths: fallback branch ran when nothing matched');

  section('Human approval + long delay (paused runs)');
  r = await call('POST', '/api/flows', { name: 'Approval flow' }, T);
  const apf = r.data.id;
  await call('PUT', `/api/flows/${apf}`, { definition: { trigger: { app: 'manual', event: 'run', params: {} }, steps: [
    { id: 'ap', app: 'approval', action: 'request', params: { title: 'Refund $50?', details: 'Customer asked nicely', timeoutHours: 1 } },
    { id: 'n', app: 'storage', action: 'set', params: { key: 'approved_by', value: '{{ap.decided_by}}' } },
  ] } }, T);
  await call('POST', `/api/flows/${apf}/publish`, {}, T);
  r = await call('POST', `/api/flows/${apf}/run`, { mode: 'live', data: {} }, T);
  ok(r.data.status === 'waiting', 'approval pauses the run', r.data);
  const apRun = r.data.runId;
  r = await call('GET', '/api/approvals', undefined, T);
  const ap = r.data.find((a) => a.run_id === apRun);
  ok(ap?.status === 'pending', 'approval request listed');
  r = await call('POST', `/api/approvals/${ap.id}/decide`, { decision: 'approve', comment: 'ok' }, T);
  ok(r.data.run?.status === 'success', 'approving resumes and completes the run', r.data);
  ok((await call('GET', '/api/storage', undefined, T)).data.find((x) => x.key === 'approved_by')?.value === 'Ada Lovelace', 'later step sees approver name');
  r = await call('POST', `/api/approvals/${ap.id}/decide`, { decision: 'approve' }, T);
  ok(r.status === 409, 'double decision rejected');

  r = await call('POST', '/api/flows', { name: 'Delayed' }, T);
  const dly = r.data.id;
  await call('PUT', `/api/flows/${dly}`, { definition: { trigger: { app: 'manual', event: 'run', params: {} }, steps: [
    { id: 'd', app: 'delay', action: 'for', params: { amount: 7, unit: 'seconds' } },
    { id: 'n', app: 'storage', action: 'set', params: { key: 'delayed_done', value: 'yes' } },
  ] } }, T);
  await call('POST', `/api/flows/${dly}/publish`, {}, T);
  r = await call('POST', `/api/flows/${dly}/run`, { mode: 'live', data: {} }, T);
  ok(r.data.status === 'waiting', 'long delay pauses the run');
  const resumed = await waitFor(async () => (await call('GET', `/api/runs/${r.data.runId}`, undefined, T)).data.status === 'success', 25000);
  ok(resumed, 'scheduler resumes the delayed run');

  section('Tables, triggers on records, CSV');
  r = await call('POST', '/api/tables', { name: 'Orders', fields: [{ name: 'Item', type: 'text' }, { name: 'Qty', type: 'number' }, { name: 'Paid', type: 'checkbox' }] }, T);
  const tbl = r.data.id;
  r = await call('POST', '/api/flows', { name: 'On new order' }, T);
  const tf = r.data.id;
  await call('PUT', `/api/flows/${tf}`, { definition: { trigger: { app: 'tables', event: 'new_record', params: { tableId: tbl } }, steps: [
    { id: 'n', app: 'storage', action: 'set', params: { key: 'last_order', value: '{{trigger.Item}} x{{trigger.Qty}}' } }] } }, T);
  await call('POST', `/api/flows/${tf}/publish`, {}, T);
  r = await call('POST', `/api/tables/${tbl}/records`, { data: { Item: 'Widget', Qty: '3', Paid: 'yes' } }, T);
  ok(r.data.Qty === 3 && r.data.Paid === true, 'record values coerced to field types', r.data);
  ok(await waitFor(async () => (await call('GET', '/api/storage', undefined, T)).data.find((x) => x.key === 'last_order')?.value === 'Widget x3'), 'new record triggered its flow');
  r = await call('POST', `/api/tables/${tbl}/import`, { csv: 'Item,Qty,Paid,Notes\n"Gadget, deluxe",2,no,"multi\nline"\nThing,1,yes,' }, T);
  ok(r.data.imported === 2, 'CSV import (quoted commas/newlines, new column)', r.data);
  const exp = await fetch(`${BASE}/api/tables/${tbl}/export`, { headers: { authorization: `Bearer ${T}` } });
  const csv = await exp.text();
  ok(csv.includes('"Gadget, deluxe"') && csv.split('\n')[0].includes('Notes'), 'CSV export');
  r = await call('GET', `/api/tables/${tbl}?q=gadget`, undefined, T);
  ok(r.data.total === 1, 'table search');

  section('Free forever: no billing, no limits');
  r = await call('GET', '/api/billing', undefined, T);
  ok(r.status === 404, 'there is no billing endpoint');
  r = await call('POST', '/api/billing/change', { plan: 'team' }, T);
  ok(r.status === 404, 'there is no way to change or buy a plan');
  r = await call('GET', '/api/audit', undefined, T);
  ok(r.status === 200, 'audit log available for free');
  r = await call('POST', '/api/workspace/invites', { email: 'grace@example.com', role: 'admin' }, T);
  ok(r.status === 200 && r.data.token, 'invite teammates for free');
  r = await call('POST', '/api/auth/signup', { name: 'Grace Hopper', email: 'grace@example.com', password: 'password123', inviteToken: r.data.token });
  const G = r.data.token;
  r = await call('GET', '/api/auth/me', undefined, G);
  ok(r.data.workspace.name === "Ada's workspace" && r.data.role === 'admin', 'invited member joined the workspace as admin', r.data.workspace);
  for (let i = 0; i < 3; i++) ok((await call('POST', '/api/workspace/invites', { email: `t${i}@example.com` }, T)).status === 200, `unlimited invites (${i + 1})`);
  r = await call('POST', '/api/workspaces', { name: 'Second WS' }, T);
  r = await call('GET', '/api/auth/me', undefined, T);
  ok(r.data.workspace.name === 'Second WS' && r.data.workspace.plan === 'free', 'extra workspaces are free too');
  r = await call('POST', '/api/flows', { name: 'Long flow' }, T);
  await call('PUT', `/api/flows/${r.data.id}`, { definition: { trigger: { app: 'manual', event: 'run', params: {} }, steps:
    Array.from({ length: 8 }, (_, i) => ({ id: `x${i}`, app: 'storage', action: 'set', params: { key: `k${i}`, value: String(i) } })) } }, T);
  const longId = r.data.id;
  r = await call('POST', `/api/flows/${longId}/publish`, {}, T);
  ok(r.status === 200, '9-step flow publishes with no upgrade', r.data);
  r = await call('POST', `/api/flows/${longId}/run`, { mode: 'live', data: {} }, T);
  ok(r.data.status === 'success', 'long flow runs', r.data);
  const wsList = (await call('GET', '/api/auth/me', undefined, T)).data.workspaces;
  await call('POST', '/api/auth/switch', { workspaceId: wsList[0].id }, T);

  section('Connections, Copilot, Chatbots, Canvas');
  r = await call('POST', '/api/connections', { app: 'slack', credentials: { webhook_url: 'https://example.com/not-slack' } }, T);
  ok(r.status === 400, 'invalid connection is rejected on test');
  r = await call('POST', '/api/copilot/flow', { prompt: 'When a form is submitted, summarize it with AI then post to Slack and save to a table', create: true }, T);
  ok(r.data.id && r.data.trigger.app === 'interfaces' && r.data.steps.map((s) => s.app).join(',') === 'ai,slack,tables', 'Copilot drafts a flow (heuristic mode)', r.data);
  const bots = (await call('GET', '/api/chatbots', undefined, T)).data;
  r = await call('POST', `/api/public/chatbots/${bots[0].slug}/message`, { message: 'How much does pricing cost?' });
  ok(r.status === 200 && /free/i.test(r.data.reply), 'chatbot answers from knowledge (fallback mode)', r.data);
  r = await call('POST', `/api/public/chatbots/${bots[0].slug}/message`, { conversationId: r.data.conversationId, message: 'please email me at kj@nasa.gov' });
  ok(r.data.actions?.[0]?.type === 'lead', 'chatbot captures a lead', r.data);
  r = await call('POST', '/api/canvases', { name: 'Gen', description: 'Customer signs up. Then we send welcome email. Is the account verified? Then onboarding call' }, T);
  r = await call('GET', `/api/canvases/${r.data.id}`, undefined, T);
  ok(r.data.data.nodes.length === 4 && r.data.data.edges.length === 3, 'canvas generated from description');

  section('Versions, duplicate, trash, export/import');
  r = await call('GET', `/api/flows/${wf}/versions`, undefined, T);
  ok(r.data.length === 1, 'version history recorded');
  r = await call('POST', `/api/flows/${wf}/duplicate`, {}, T);
  ok(r.data.id, 'duplicate flow');
  const exported = await call('GET', `/api/flows/${wf}/export`, undefined, T);
  r = await call('POST', '/api/flows/import', { json: exported.data }, T);
  ok(r.data.id, 'export → import flow');
  r = await call('DELETE', `/api/flows/${r.data.id}`, undefined, T);
  r = await call('GET', '/api/flows?trash=1', undefined, T);
  ok(r.data.length === 1, 'deleted flow goes to trash');
  r = await call('POST', `/api/runs/${run1.id}/replay`, {}, T);
  ok(r.data.status === 'success', 'replay a run', r.data);

  section('API keys, REST API v1, MCP, Developer platform');
  r = await call('POST', '/api/api-keys', { name: 'CI' }, T);
  const KEY = r.data.key;
  r = await call('POST', `/api/v1/flows/${router}/run`, { data: { inputs: { kind: 'vip', items: 'q' } } }, KEY);
  ok(r.data.status === 'success', 'REST API runs a flow with an API key', r.data);
  r = await call('GET', '/api/v1/flows', undefined, 'ot_bogus');
  ok(r.status === 401, 'bad API key rejected');
  r = await call('POST', '/api/mcp-servers', { name: 'Claude', tools: [{ app: 'formatter', action: 'text', params: { transform: 'uppercase' } }, { type: 'flow', flowId: router }] }, T);
  const mcpUrl = new URL(r.data.url).pathname;
  const rpc = (method, params, id = 1) => call('POST', mcpUrl, { jsonrpc: '2.0', id, method, params });
  r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  ok(r.data.result?.protocolVersion === '2025-06-18', 'MCP initialize');
  r = await rpc('tools/list', {});
  const tools = r.data.result?.tools || [];
  ok(tools.length === 2 && tools[0].inputSchema.properties.input && !tools[0].inputSchema.properties.transform, 'MCP tools/list (fixed params hidden)', tools);
  const before = (await call('GET', '/api/usage', undefined, T)).data.tasks;
  r = await rpc('tools/call', { name: tools[0].name, arguments: { input: 'hello mcp' } });
  ok(r.data.result?.structuredContent?.output === 'HELLO MCP', 'MCP tools/call executes the action', r.data);
  const after = (await call('GET', '/api/usage', undefined, T)).data.tasks;
  ok(after - before === 0, `MCP calls to built-in tools are not even counted (${after - before})`);
  r = await call('POST', '/api/developer/apps', { name: 'Status API', base_url: BASE }, T);
  const devId = r.data.id;
  r = await call('PUT', `/api/developer/apps/${devId}`, { operations: [{ key: 'get_health', name: 'Get health', type: 'search', fields: [], request: { method: 'GET', url: '/health' } }], bumpVersion: true }, T);
  ok(r.data.version === '1.0.1', 'custom app saved + version bumped');
  r = await call('POST', `/api/developer/apps/${devId}/test`, { operation: 'get_health' }, T);
  ok(r.data.ok && r.data.output.name === 'OneTier', 'custom app operation calls the API', r.data);
  r = await call('GET', '/api/apps/custom_status_api', undefined, T);
  ok(r.data.actions?.get_health, 'custom app appears in the catalog');

  section('AI providers & MCP agent builder');
  r = await call('GET', '/api/ai/status', undefined, T);
  ok(r.status === 200 && 'claude-cli' in r.data.available && r.data.cli.enabled === false && r.data.active === null, 'AI status lists providers (none active in test env)', r.data.available);
  r = await call('POST', '/api/ai/test', {}, T);
  ok(r.status === 400 && /Claude or ChatGPT account/.test(r.data.error), 'clear message when no AI is connected', r.data);
  r = await call('PUT', '/api/ai/settings', { provider: 'openai' }, T);
  ok(r.status === 200 && r.data.settings.provider === 'openai', 'choose preferred AI provider');
  r = await call('POST', '/api/mcp-servers', { name: 'Agent' }, T);
  ok(r.data.tools.some((t) => t.type === 'builder'), 'new MCP servers include the agent builder');
  const bUrl = new URL(r.data.url).pathname;
  const brpc = (name, args) => call('POST', bUrl, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  r = await call('POST', bUrl, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
  ok(r.data.result.tools.filter((t) => t.name.startsWith('onetier_')).length === 18, 'builder exposes 18 tools');
  r = await brpc('onetier_get_app_details', { app: 'formatter' });
  ok(r.data.result.structuredContent.actions.some((a) => a.key === 'text'), 'agent can read app field details');
  r = await brpc('onetier_create_flow', { name: 'Agent made', trigger: { app: 'manual', event: 'run' }, steps: [
    { id: 's1', app: 'formatter', action: 'text', params: { transform: 'titlecase', input: '{{trigger.inputs.name}}' } },
    { id: 's2', app: 'storage', action: 'set', params: { key: 'agent_greeting', value: 'Hi {{s1.output}}' } }] });
  const af = r.data.result.structuredContent;
  ok(af.id && af.issues.length === 0 && af.editor_url.includes('/flows/'), 'agent creates a valid draft flow', af);
  r = await brpc('onetier_run_flow', { flow_id: af.id, test: true, data: { inputs: { name: 'grace hopper' } } });
  ok(r.data.result.structuredContent.status === 'success', 'agent test-runs the draft');
  r = await brpc('onetier_publish_flow', { flow_id: af.id });
  ok(r.data.result.structuredContent.published === true, 'agent publishes the flow');
  r = await brpc('onetier_run_flow', { flow_id: af.id, data: { inputs: { name: 'grace hopper' } } });
  ok((await call('GET', '/api/storage', undefined, T)).data.find((x) => x.key === 'agent_greeting')?.value === 'Hi Grace Hopper', 'agent-built flow runs live');
  r = await brpc('onetier_create_flow', { name: 'Bad', trigger: { app: 'nope', event: 'x' }, steps: [] });
  ok(r.data.result.structuredContent.issues.length > 0, 'agent gets actionable validation issues');
  r = await brpc('onetier_create_table', { name: 'Agent table', fields: [{ name: 'Title', type: 'text' }] });
  const at = r.data.result.structuredContent.id;
  r = await brpc('onetier_add_records', { table_id: at, records: [{ Title: 'one' }, { Title: 'two' }] });
  ok(r.data.result.structuredContent.added.length === 2, 'agent creates tables and records');

  section('Dashboard, usage, search, notifications');
  r = await call('GET', '/api/dashboard', undefined, T);
  ok(r.data.flows.on >= 5 && r.data.runs14d.length >= 1, 'dashboard stats');
  r = await call('GET', '/api/usage', undefined, T);
  ok(r.data.tasks > 0 && r.data.byFlow.length > 0, 'usage breakdown');
  r = await call('GET', '/api/search?q=router', undefined, T);
  ok(r.data.some((x) => x.type === 'flow'), 'global search');
  r = await call('GET', '/api/notifications', undefined, T);
  ok(r.data.items.length > 0, 'notifications');
}

const timer = setTimeout(() => { console.error('Timed out'); proc.kill(); process.exit(1); }, 120000);
main().catch((e) => { failed++; results.push(`  ✗ crashed: ${e.stack}`); }).finally(() => {
  clearTimeout(timer);
  proc.kill();
  console.log(results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) console.log('\n--- server log ---\n' + serverLog.slice(-3000));
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
});
