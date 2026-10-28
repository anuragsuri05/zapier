// "Builder" MCP tools: let an AI client (ChatGPT, Claude, Cursor…) signed in with the user's own account
// design, create, publish and run OneTier flows — the user's AI subscription becomes OneTier's agent.
import { get, all, run, j, s, now } from './db.js';
import { listApps, getApp } from './apps/registry.js';
import { createFlow, validate, publishFlow } from './routes/flows.js';
import { callFlow, executeFlow } from './engine/index.js';
import * as svc from './services.js';
import { TEMPLATES } from './templates.js';
import { publicUrl } from './url.js';

const str = (description) => ({ type: 'string', description });
const obj = (properties, required = [], description) => ({ type: 'object', properties, required, ...(description ? { description } : {}) });

const STEP_DOC = `A step is {"id":"s1","app":"<app key>","action":"<action key>","params":{...},"connection_id":"<id if the app needs an account>","title":"optional"}.
Map data from earlier steps with {{trigger.<field>}} or {{s1.<field>}} (use step ids s1, s2, … in order).
Filters: {"id":"s2","app":"filter","action":"check","params":{"conditions":[[{"left":"{{trigger.amount}}","op":"gt","right":"100"}]]}} (outer list = OR, inner = AND; ops: equals, not_equals, contains, not_contains, starts_with, ends_with, gt, lt, gte, lte, exists, not_exists, is_true, is_false).
Paths: {"id":"s3","app":"paths","action":"split","paths":[{"id":"p1","name":"VIP","conditions":[[…]],"steps":[…]},{"id":"p2","name":"Everyone else","fallback":true,"conditions":[],"steps":[…]}]}.
Loops: {"id":"s4","app":"looping","action":"loop","params":{"items":"{{trigger.items}}"},"steps":[… use {{loop.item}} …]}.
keyvalue / tablefields params are lists of {"key","value"}. Call get_app_details first to learn exact field keys.`;

const flowShape = obj({
  trigger: obj({ app: str('Trigger app key'), event: str('Trigger event key'), connection_id: str('Connection id if the app needs an account'), params: { type: 'object' } }, ['app', 'event']),
  steps: { type: 'array', items: { type: 'object' }, description: STEP_DOC },
});

/** connection_id → connectionId, recursively; generate missing step ids. */
function normalizeDef(def) {
  let n = 0;
  const fix = (st) => {
    const out = { ...st };
    if (out.connection_id !== undefined) { out.connectionId = out.connection_id; delete out.connection_id; }
    if (!out.id) out.id = `s${++n}_${Math.random().toString(36).slice(2, 6)}`;
    out.params = out.params || {};
    if (Array.isArray(out.steps)) out.steps = out.steps.map(fix);
    if (Array.isArray(out.paths)) out.paths = out.paths.map((p, i) => ({ id: p.id || `p${i + 1}`, name: p.name || `Path ${i + 1}`, fallback: Boolean(p.fallback), conditions: p.conditions || [], steps: (p.steps || []).map(fix) }));
    return out;
  };
  const trigger = { ...(def.trigger || {}), params: def.trigger?.params || {} };
  if (trigger.connection_id !== undefined) { trigger.connectionId = trigger.connection_id; delete trigger.connection_id; }
  return { trigger, steps: (def.steps || []).map(fix) };
}

function flowOut(f, req) {
  const def = j(f.definition, {});
  return { id: f.id, name: f.name, description: f.description, status: f.status, version: f.version, definition: def,
    editor_url: `${publicUrl(req)}/flows/${f.id}`, webhook_url: def.trigger?.app === 'webhook' ? `${publicUrl(req)}/hooks/catch/${f.id}/${f.hook_secret}` : undefined };
}

export function builderTools(wsId, req) {
  const ws = () => get('SELECT * FROM workspaces WHERE id = ?', wsId);
  const flow = (id) => {
    const f = get('SELECT * FROM flows WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL', id, wsId);
    if (!f) throw new Error(`Flow ${id} not found`);
    return f;
  };
  const user = { id: null, name: 'AI agent (MCP)' };
  return [
    { name: 'onetier_list_apps', description: 'List the apps available in OneTier with their trigger and action keys. Use search to filter.',
      inputSchema: obj({ search: str('Optional text to filter apps') }),
      run: ({ search }) => listApps(wsId).filter((a) => !search || `${a.name} ${a.key} ${a.description}`.toLowerCase().includes(String(search).toLowerCase()))
        .map((a) => ({ key: a.key, name: a.name, category: a.category, needs_account: Boolean(a.auth), triggers: Object.entries(a.triggers || {}).map(([k, v]) => `${k}: ${v.name}`), actions: Object.entries(a.actions || {}).map(([k, v]) => `${k}: ${v.name}`) })) },
    { name: 'onetier_get_app_details', description: 'Get the exact fields (keys, types, required, options) of an app\'s triggers and actions, plus the user\'s connected accounts for it.',
      inputSchema: obj({ app: str('App key, e.g. "slack" or "formatter"') }, ['app']),
      run: ({ app }) => {
        const a = getApp(app, wsId);
        if (!a) throw new Error(`Unknown app "${app}". Call onetier_list_apps.`);
        const fields = (fs) => (fs || []).map((f) => ({ key: f.key, label: f.label, type: f.type, required: Boolean(f.required), ...(f.options ? { options: f.options.map((o) => o.value) } : {}), ...(f.help ? { help: f.help } : {}), ...(f.default !== undefined ? { default: f.default } : {}) }));
        return {
          key: a.key, name: a.name, description: a.description, needs_account: Boolean(a.auth),
          connections: all('SELECT id, name FROM connections WHERE workspace_id = ? AND app = ?', wsId, a.key),
          triggers: Object.entries(a.triggers || {}).map(([k, v]) => ({ key: k, name: v.name, type: v.type, fields: fields(v.fields), sample_output: v.sample })),
          actions: Object.entries(a.actions || {}).map(([k, v]) => ({ key: k, name: v.name, fields: fields(v.fields), sample_output: v.sample })),
        };
      } },
    { name: 'onetier_list_connections', description: 'List connected app accounts (use their id as connection_id in steps).',
      inputSchema: obj({}), run: () => all('SELECT id, app, name, status FROM connections WHERE workspace_id = ? ORDER BY app', wsId) },
    { name: 'onetier_list_flows', description: 'List the workspace\'s flows.',
      inputSchema: obj({}), run: () => all('SELECT id, name, description, status, version, updated_at FROM flows WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC', wsId) },
    { name: 'onetier_get_flow', description: 'Get a flow\'s full definition, status and webhook URL.',
      inputSchema: obj({ flow_id: str('Flow id') }, ['flow_id']), run: ({ flow_id }) => flowOut(flow(flow_id), req) },
    { name: 'onetier_create_flow', description: `Create a new flow (saved as a draft). Returns its id and any problems to fix before publishing.\n${STEP_DOC}`,
      inputSchema: obj({ name: str('Flow name'), description: str('What the flow does'), ...flowShape.properties }, ['name', 'trigger', 'steps']),
      run: ({ name, description, trigger, steps }) => {
        const def = normalizeDef({ trigger, steps });
        const id = createFlow(ws(), user, { name, description: description || '', definition: def });
        return { ...flowOut(flow(id), req), issues: validate(def, ws()).map((i) => i.message) };
      } },
    { name: 'onetier_update_flow', description: 'Replace a flow\'s name, description, trigger and/or steps (draft). Publish again for changes to go live.',
      inputSchema: obj({ flow_id: str('Flow id'), name: str('New name'), description: str('New description'), ...flowShape.properties }, ['flow_id']),
      run: ({ flow_id, name, description, trigger, steps }) => {
        const f = flow(flow_id);
        const cur = j(f.definition, {});
        const def = normalizeDef({ trigger: trigger || cur.trigger, steps: steps || cur.steps });
        run('UPDATE flows SET name = COALESCE(?, name), description = COALESCE(?, description), definition = ?, updated_at = ? WHERE id = ?', name ?? null, description ?? null, s(def), now(), f.id);
        return { ...flowOut(flow(flow_id), req), issues: validate(def, ws()).map((i) => i.message) };
      } },
    { name: 'onetier_publish_flow', description: 'Publish a flow and turn it on. Returns problems to fix if it is not ready.',
      inputSchema: obj({ flow_id: str('Flow id') }, ['flow_id']),
      run: ({ flow_id }) => {
        const r = publishFlow(ws(), user, flow(flow_id), 'Published by AI agent');
        return r.ok ? { published: true, version: r.version, ...flowOut(flow(flow_id), req) } : { published: false, issues: r.issues.map((i) => i.message) };
      } },
    { name: 'onetier_set_flow_status', description: 'Turn a published flow on or off.',
      inputSchema: obj({ flow_id: str('Flow id'), on: { type: 'boolean' } }, ['flow_id', 'on']),
      run: ({ flow_id, on }) => {
        const f = flow(flow_id);
        if (on && !f.published) throw new Error('Publish the flow first.');
        run('UPDATE flows SET status = ? WHERE id = ?', on ? 'on' : 'off', f.id);
        return { id: f.id, status: on ? 'on' : 'off' };
      } },
    { name: 'onetier_run_flow', description: 'Run a flow now with the given trigger data. test=true runs the draft without it being published.',
      inputSchema: obj({ flow_id: str('Flow id'), data: { type: 'object', description: 'Trigger data, e.g. {"inputs":{...}} for manual triggers or {"body":{...}} for webhooks' }, test: { type: 'boolean' } }, ['flow_id']),
      run: async ({ flow_id, data, test }) => {
        const f = flow(flow_id);
        const r = test ? await executeFlow(f, data || j(f.definition, {}).trigger?.sample || {}, { source: 'mcp', testMode: true, definition: j(f.definition) })
          : await callFlow(wsId, f.id, data || {}, { source: 'mcp' });
        const steps = all('SELECT seq, title, status, error, output FROM run_steps WHERE run_id = ? ORDER BY seq', r.runId).map((x) => ({ ...x, output: j(x.output) }));
        return { run_id: r.runId, status: r.status, error: r.error || null, steps };
      } },
    { name: 'onetier_list_runs', description: 'List recent runs (optionally for one flow) with status and errors.',
      inputSchema: obj({ flow_id: str('Optional flow id'), limit: { type: 'number' } }),
      run: ({ flow_id, limit }) => all(`SELECT id, flow_id, flow_name, status, source, error, started_at FROM runs WHERE workspace_id = ? ${flow_id ? 'AND flow_id = ?' : ''} ORDER BY started_at DESC LIMIT ?`,
        ...(flow_id ? [wsId, flow_id] : [wsId]), Math.min(50, Number(limit) || 10)) },
    { name: 'onetier_get_run', description: 'Get one run with each step\'s input, output and error — use it to debug.',
      inputSchema: obj({ run_id: str('Run id') }, ['run_id']),
      run: ({ run_id }) => {
        const r = get('SELECT id, flow_id, flow_name, status, error, started_at, finished_at FROM runs WHERE id = ? AND workspace_id = ?', run_id, wsId);
        if (!r) throw new Error('Run not found');
        return { ...r, steps: all('SELECT seq, title, status, error, input, output FROM run_steps WHERE run_id = ? ORDER BY seq', r.id).map((x) => ({ ...x, input: j(x.input), output: j(x.output) })) };
      } },
    { name: 'onetier_list_templates', description: 'List ready-made flow templates.',
      inputSchema: obj({}), run: () => TEMPLATES.map((t) => ({ id: t.id, name: t.name, category: t.category, description: t.description })) },
    { name: 'onetier_create_flow_from_template', description: 'Create a draft flow from a template id.',
      inputSchema: obj({ template_id: str('Template id') }, ['template_id']),
      run: ({ template_id }) => {
        const t = TEMPLATES.find((x) => x.id === template_id);
        if (!t) throw new Error('Unknown template');
        const id = createFlow(ws(), user, { name: t.name, description: t.description, definition: structuredClone(t.definition) });
        return { ...flowOut(flow(id), req), issues: validate(j(flow(id).definition), ws()).map((i) => i.message) };
      } },
    { name: 'onetier_list_tables', description: 'List OneTier Tables with their fields.',
      inputSchema: obj({}), run: () => all('SELECT id, name, fields FROM tables_ WHERE workspace_id = ?', wsId).map((t) => ({ id: t.id, name: t.name, fields: j(t.fields, []).map((f) => ({ name: f.name, type: f.type })) })) },
    { name: 'onetier_create_table', description: 'Create a Table. Field types: text, long_text, number, email, url, phone, checkbox, date, select, multi_select, currency, rating, json.',
      inputSchema: obj({ name: str('Table name'), fields: { type: 'array', items: obj({ name: str('Field name'), type: str('Field type'), options: { type: 'array', items: { type: 'string' } } }, ['name']) } }, ['name', 'fields']),
      run: ({ name, fields }) => {
        const id = `tbl_${Math.random().toString(36).slice(2, 14)}`;
        const fl = (fields || []).map((f) => ({ id: `fld_${Math.random().toString(36).slice(2, 12)}`, name: f.name, type: svc.FIELD_TYPES.includes(f.type) ? f.type : 'text', options: f.options }));
        run('INSERT INTO tables_ (id, workspace_id, name, description, fields, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', id, wsId, name, '', s(fl), now(), now());
        return { id, name, fields: fl.map((f) => ({ name: f.name, type: f.type })) };
      } },
    { name: 'onetier_add_records', description: 'Add records to a Table (keys are field names).',
      inputSchema: obj({ table_id: str('Table id'), records: { type: 'array', items: { type: 'object' } } }, ['table_id', 'records']),
      run: ({ table_id, records }) => ({ added: (records || []).slice(0, 200).map((r) => svc.createRecord(wsId, table_id, r, { source: 'mcp' }).id) }) },
    { name: 'onetier_find_records', description: 'Search a Table. Optionally match one field exactly.',
      inputSchema: obj({ table_id: str('Table id'), field: str('Optional field name'), value: str('Value to match') }, ['table_id']),
      run: ({ table_id, field, value }) => svc.findRecords(wsId, table_id, field ? { field, value, limit: 50 } : { limit: 50 }) },
  ];
}
