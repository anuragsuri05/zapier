import { Router } from 'express';
import crypto from 'node:crypto';
import { get, all, run, uid, now, j, s, encrypt, decrypt } from '../db.js';
import { authenticate, requireRole } from '../auth.js';
import { getApp, listApps, serializeApp } from '../apps/registry.js';
import { executeFlow, testStep, replayRun, decideApproval, countSteps } from '../engine/index.js';
import { pollFlow, nextScheduleTime } from '../engine/triggers.js';
import { audit } from '../services.js';
import { TEMPLATES } from '../templates.js';

export const flows = Router();
flows.use(authenticate);

import { publicUrl } from '../url.js';
export const hookUrl = (f, req) => `${publicUrl(req)}/hooks/catch/${f.id}/${f.hook_secret}`;

function loadFlow(req, res) {
  const f = get('SELECT * FROM flows WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id);
  if (!f) { res.status(404).json({ error: 'Flow not found' }); return null; }
  return f;
}

function walk(steps, fn) { for (const st of steps || []) { fn(st); if (st.app === 'paths') for (const p of st.paths || []) walk(p.steps, fn); if (st.app === 'looping') walk(st.steps, fn); } }

// Test samples are editor scratch data; they shouldn't count as unpublished changes.
const stripSamples = (v) => JSON.stringify(j(v, {}), (k, x) => (k === 'sample' ? undefined : x));

function flowSummary(f) {
  const def = j(f.definition, {});
  const apps = [def.trigger?.app];
  walk(def.steps, (st) => apps.push(st.app));
  const stats = get(`SELECT COUNT(*) AS runs, SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors, SUM(tasks_used) AS tasks FROM runs WHERE flow_id = ? AND started_at >= ?`, f.id, new Date(Date.now() - 30 * 864e5).toISOString());
  const owner = f.created_by ? get('SELECT name FROM users WHERE id = ?', f.created_by) : null;
  return {
    id: f.id, name: f.name, description: f.description, status: f.status, folder_id: f.folder_id, version: f.version,
    apps: [...new Set(apps.filter(Boolean))], steps: countSteps(def.steps) + 1, has_unpublished: f.published ? stripSamples(f.definition) !== stripSamples(f.published) : true,
    created_at: f.created_at, updated_at: f.updated_at, last_run_at: f.last_run_at, owner: owner?.name || null,
    stats: { runs: stats.runs || 0, errors: stats.errors || 0, tasks: stats.tasks || 0 }, deleted_at: f.deleted_at,
  };
}

/** Validate a definition before publishing. Returns a list of human-readable issues. */
export function validate(def, ws) {
  const issues = [];
  const t = def.trigger || {};
  const tApp = getApp(t.app, ws.id);
  if (!tApp) issues.push({ stepId: 'trigger', message: 'Choose a trigger app.' });
  else if (!tApp.triggers?.[t.event]) issues.push({ stepId: 'trigger', message: 'Choose a trigger event.' });
  else {
    if (tApp.auth && !t.connectionId) issues.push({ stepId: 'trigger', message: `Connect a ${tApp.name} account.` });
    for (const f of tApp.triggers[t.event].fields || []) if (f.required && (t.params?.[f.key] === undefined || t.params?.[f.key] === '')) issues.push({ stepId: 'trigger', message: `Trigger: "${f.label}" is required.` });
  }
  if (!def.steps?.length) issues.push({ stepId: null, message: 'Add at least one action.' });
  walk(def.steps, (st) => {
    const app = getApp(st.app, ws.id);
    if (!app) return issues.push({ stepId: st.id, message: 'Choose an app for this step.' });
    const act = app.actions?.[st.action];
    if (!act) return issues.push({ stepId: st.id, message: `Choose an action for ${app.name}.` });
    if (app.auth && !st.connectionId) issues.push({ stepId: st.id, message: `Connect a ${app.name} account.` });
    if (st.app === 'filter' && !st.params?.conditions?.flat?.().length) issues.push({ stepId: st.id, message: 'Add at least one filter condition.' });
    if (st.app === 'paths' && !(st.paths || []).length) issues.push({ stepId: st.id, message: 'Add at least one path.' });
    for (const f of act.fields || []) {
      if (!f.required || ['conditions'].includes(f.type)) continue;
      const v = st.params?.[f.key];
      if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) issues.push({ stepId: st.id, message: `${app.name}: "${f.label}" is required.` });
    }
  });
  return issues;
}

// ---------------------------------------------------------------- apps & dynamic options
flows.get('/apps', (req, res) => res.json(listApps(req.ws.id).map(serializeApp)));
flows.get('/apps/:key', (req, res) => {
  const a = getApp(req.params.key, req.ws.id);
  if (!a) return res.status(404).json({ error: 'App not found' });
  const usage = all('SELECT id, name, status FROM flows WHERE workspace_id = ? AND deleted_at IS NULL AND definition LIKE ?', req.ws.id, `%"app":"${a.key}"%`);
  res.json({ ...serializeApp(a), flows: usage, connections: all('SELECT id, name, status, created_at FROM connections WHERE workspace_id = ? AND app = ?', req.ws.id, a.key) });
});
flows.get('/dynamic/:kind', (req, res) => {
  const ws = req.ws.id;
  const opt = (rows) => rows.map((r) => ({ value: r.id, label: r.name }));
  switch (req.params.kind) {
    case 'tables': return res.json(opt(all('SELECT id, name FROM tables_ WHERE workspace_id = ? ORDER BY name', ws)));
    case 'tableFields': { const t = get('SELECT fields FROM tables_ WHERE id = ? AND workspace_id = ?', req.query.tableId, ws); return res.json((j(t?.fields, [])).map((f) => ({ value: f.name, label: f.name, type: f.type, options: f.options }))); }
    case 'interfaces': return res.json(opt(all('SELECT id, name FROM interfaces WHERE workspace_id = ? ORDER BY name', ws)));
    case 'forms': { const i = get('SELECT config FROM interfaces WHERE id = ? AND workspace_id = ?', req.query.interfaceId, ws); return res.json((j(i?.config, {}).blocks || []).filter((b) => b.type === 'form').map((b) => ({ value: b.id, label: b.title || 'Form', fields: b.fields.map((f) => f.label) }))); }
    case 'chatbots': return res.json(opt(all('SELECT id, name FROM chatbots WHERE workspace_id = ? ORDER BY name', ws)));
    case 'flows': return res.json(opt(all('SELECT id, name FROM flows WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY name', ws)));
    case 'subflows': return res.json(opt(all(`SELECT id, name FROM flows WHERE workspace_id = ? AND deleted_at IS NULL AND definition LIKE '%"app":"subflow"%' ORDER BY name`, ws)));
    case 'manualFlows': return res.json(opt(all(`SELECT id, name FROM flows WHERE workspace_id = ? AND deleted_at IS NULL AND (definition LIKE '%"app":"manual"%') ORDER BY name`, ws)));
    default: return res.status(404).json({ error: 'Unknown option source' });
  }
});

// ---------------------------------------------------------------- connections
const mask = (v) => { const x = String(v ?? ''); return !x ? '' : x.length < 12 ? '••••••••' : `${x.slice(0, 4)}••••${x.slice(-2)}`; };
const connOut = (c) => ({ id: c.id, app: c.app, name: c.name, status: c.status, created_at: c.created_at, last_tested_at: c.last_tested_at,
  used_by: get(`SELECT COUNT(*) c FROM flows WHERE workspace_id = ? AND deleted_at IS NULL AND (definition LIKE ? OR published LIKE ?)`, c.workspace_id, `%${c.id}%`, `%${c.id}%`).c,
  fields: Object.fromEntries(Object.entries(decrypt(c.credentials)).map(([k, v]) => [k, mask(v)])) });
flows.get('/connections', (req, res) => res.json(all('SELECT * FROM connections WHERE workspace_id = ? ORDER BY created_at DESC', req.ws.id).map(connOut)));
flows.post('/connections', async (req, res) => {
  const { app: key, name, credentials = {} } = req.body || {};
  const app = getApp(key, req.ws.id);
  if (!app?.auth) return res.status(400).json({ error: 'This app does not need a connection' });
  for (const f of app.auth.fields) if (f.required && !credentials[f.key]) return res.status(400).json({ error: `${f.label} is required` });
  let label = name;
  try { const r = await app.auth.test(credentials); label = name || `${app.name} · ${r?.label || 'account'}`; }
  catch (e) { return res.status(400).json({ error: `Couldn't connect to ${app.name}: ${e.message}` }); }
  const id = uid('con_');
  run('INSERT INTO connections (id, workspace_id, app, name, credentials, status, created_by, created_at, last_tested_at) VALUES (?,?,?,?,?,?,?,?,?)', id, req.ws.id, key, label, encrypt(credentials), 'ok', req.user.id, now(), now());
  audit(req.ws.id, req.user, 'connection.created', label, { app: key });
  res.json(connOut(get('SELECT * FROM connections WHERE id = ?', id)));
});
flows.post('/connections/:id/test', async (req, res) => {
  const c = get('SELECT * FROM connections WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id);
  if (!c) return res.status(404).json({ error: 'Connection not found' });
  const app = getApp(c.app, req.ws.id);
  try { const r = await app.auth.test(decrypt(c.credentials)); run("UPDATE connections SET status = 'ok', last_tested_at = ? WHERE id = ?", now(), c.id); res.json({ ok: true, label: r?.label }); }
  catch (e) { run("UPDATE connections SET status = 'error', last_tested_at = ? WHERE id = ?", now(), c.id); res.status(400).json({ ok: false, error: e.message }); }
});
flows.patch('/connections/:id', async (req, res) => {
  const c = get('SELECT * FROM connections WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id);
  if (!c) return res.status(404).json({ error: 'Connection not found' });
  if (req.body.credentials) {
    const merged = { ...decrypt(c.credentials), ...Object.fromEntries(Object.entries(req.body.credentials).filter(([, v]) => v)) };
    try { await getApp(c.app, req.ws.id).auth.test(merged); } catch (e) { return res.status(400).json({ error: `Reconnect failed: ${e.message}` }); }
    run("UPDATE connections SET credentials = ?, status = 'ok', last_tested_at = ? WHERE id = ?", encrypt(merged), now(), c.id);
  }
  if (req.body.name) run('UPDATE connections SET name = ? WHERE id = ?', req.body.name, c.id);
  audit(req.ws.id, req.user, 'connection.updated', c.name);
  res.json(connOut(get('SELECT * FROM connections WHERE id = ?', c.id)));
});
flows.delete('/connections/:id', (req, res) => {
  const c = get('SELECT * FROM connections WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id);
  if (!c) return res.status(404).json({ error: 'Connection not found' });
  run('DELETE FROM connections WHERE id = ?', c.id);
  audit(req.ws.id, req.user, 'connection.deleted', c.name);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- folders
flows.get('/folders', (req, res) => res.json(all(`SELECT f.*, (SELECT COUNT(*) FROM flows WHERE folder_id = f.id AND deleted_at IS NULL) AS count FROM folders f WHERE workspace_id = ? ORDER BY name`, req.ws.id)));
flows.post('/folders', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Folder name is required' });
  const id = uid('fld_');
  run('INSERT INTO folders (id, workspace_id, name, created_at) VALUES (?,?,?,?)', id, req.ws.id, name, now());
  res.json({ id, name });
});
flows.patch('/folders/:id', (req, res) => { run('UPDATE folders SET name = ? WHERE id = ? AND workspace_id = ?', String(req.body.name || '').trim(), req.params.id, req.ws.id); res.json({ ok: true }); });
flows.delete('/folders/:id', (req, res) => {
  run('UPDATE flows SET folder_id = NULL WHERE folder_id = ? AND workspace_id = ?', req.params.id, req.ws.id);
  run('DELETE FROM folders WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- templates
flows.get('/templates', (req, res) => res.json(TEMPLATES.map((t) => {
  const apps = [t.definition.trigger.app]; walk(t.definition.steps, (st) => apps.push(st.app));
  return { ...t, apps: [...new Set(apps)] };
})));

// ---------------------------------------------------------------- flows CRUD
const blankDef = () => ({ trigger: { app: null, event: null, params: {} }, steps: [] });

export function createFlow(ws, user, { name, description = '', definition, folderId = null }) {
  const id = uid('flw_');
  const t = now();
  run('INSERT INTO flows (id, workspace_id, folder_id, name, description, status, definition, hook_secret, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    id, ws.id, folderId, name || 'Untitled flow', description, 'draft', s(definition || blankDef()), crypto.randomBytes(12).toString('hex'), user?.id || null, t, t);
  audit(ws.id, user, 'flow.created', name || 'Untitled flow');
  return id;
}

flows.get('/flows', (req, res) => {
  const { folder, status, q, trash } = req.query;
  let rows = all(`SELECT * FROM flows WHERE workspace_id = ? AND deleted_at IS ${trash ? 'NOT ' : ''}NULL ORDER BY updated_at DESC`, req.ws.id);
  if (folder) rows = rows.filter((f) => (folder === 'none' ? !f.folder_id : f.folder_id === folder));
  if (status) rows = rows.filter((f) => f.status === status);
  if (q) rows = rows.filter((f) => `${f.name} ${f.description}`.toLowerCase().includes(String(q).toLowerCase()));
  res.json(rows.map(flowSummary));
});
flows.post('/flows', (req, res) => {
  const { name, description, definition, folderId, templateId } = req.body || {};
  let def = definition;
  let nm = name;
  if (templateId) {
    const tpl = TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return res.status(404).json({ error: 'Template not found' });
    def = structuredClone(tpl.definition); nm = nm || tpl.name;
  }
  const id = createFlow(req.ws, req.user, { name: nm, description: description || '', definition: def, folderId });
  res.json({ id });
});
flows.post('/flows/import', (req, res) => {
  const data = typeof req.body.json === 'string' ? j(req.body.json) : req.body.json;
  if (!data?.definition?.trigger || !Array.isArray(data.definition.steps)) return res.status(400).json({ error: 'That file is not a OneTier flow export.' });
  const def = structuredClone(data.definition);
  if (def.trigger) delete def.trigger.connectionId;
  walk(def.steps, (st) => delete st.connectionId);
  const id = createFlow(req.ws, req.user, { name: `${data.name || 'Imported flow'}`, description: data.description || '', definition: def });
  res.json({ id });
});
flows.post('/flows/bulk', (req, res) => {
  const { ids = [], action, folderId } = req.body || {};
  let n = 0;
  for (const id of ids) {
    const f = get('SELECT * FROM flows WHERE id = ? AND workspace_id = ?', id, req.ws.id);
    if (!f) continue;
    if (action === 'on' && f.published) run("UPDATE flows SET status = 'on' WHERE id = ?", id);
    else if (action === 'off') run("UPDATE flows SET status = CASE WHEN published IS NULL THEN 'draft' ELSE 'off' END WHERE id = ?", id);
    else if (action === 'delete') run("UPDATE flows SET deleted_at = ?, status = CASE WHEN status = 'on' THEN 'off' ELSE status END WHERE id = ?", now(), id);
    else if (action === 'move') run('UPDATE flows SET folder_id = ? WHERE id = ?', folderId || null, id);
    else continue;
    n++;
  }
  audit(req.ws.id, req.user, `flow.bulk_${action}`, `${n} flows`);
  res.json({ ok: true, updated: n });
});
flows.get('/flows/:id', (req, res) => {
  const f = loadFlow(req, res); if (!f) return;
  const st = j(f.trigger_state, {});
  delete st.seen;
  res.json({ ...flowSummary(f), definition: j(f.definition), published: j(f.published), settings: j(f.settings, {}), trigger_state: st, hook_url: hookUrl(f, req) });
});
flows.put('/flows/:id', (req, res) => {
  const f = loadFlow(req, res); if (!f) return;
  const { name, description, definition, settings, folderId } = req.body || {};
  if (definition && (typeof definition !== 'object' || !Array.isArray(definition.steps))) return res.status(400).json({ error: 'Invalid flow definition' });
  run(`UPDATE flows SET name = COALESCE(?, name), description = COALESCE(?, description), definition = COALESCE(?, definition),
       settings = COALESCE(?, settings), folder_id = ?, updated_at = ? WHERE id = ?`,
    name ?? null, description ?? null, definition ? s(definition) : null, settings ? s({ ...j(f.settings, {}), ...settings }) : null,
    folderId === undefined ? f.folder_id : folderId || null, now(), f.id);
  res.json({ ok: true, updated_at: now() });
});
flows.post('/flows/:id/validate', (req, res) => {
  const f = loadFlow(req, res); if (!f) return;
  res.json({ issues: validate(j(f.definition), req.ws) });
});
/** Validate and publish a flow's draft as a new version. Returns {ok, version} or {ok:false, issues}. */
export function publishFlow(ws, user, f, note = '') {
  const def = j(f.definition);
  const issues = validate(def, ws);
  if (issues.length) return { ok: false, issues };
  const version = f.version + 1;
  const st = j(f.trigger_state, {});
  const prevTrig = j(f.published)?.trigger;
  if (JSON.stringify(prevTrig) !== JSON.stringify(def.trigger)) { delete st.nextAt; delete st.seen; delete st.seeded; }
  run("UPDATE flows SET published = definition, version = ?, status = 'on', trigger_state = ?, updated_at = ? WHERE id = ?", version, s(st), now(), f.id);
  run('INSERT INTO flow_versions (id, flow_id, version, definition, note, created_by, created_at) VALUES (?,?,?,?,?,?,?)', uid('ver_'), f.id, version, f.definition, note, user?.id || null, now());
  audit(ws.id, user, 'flow.published', f.name, { version });
  // Seed polling triggers so only *new* items fire.
  const app = getApp(def.trigger.app, ws.id);
  if (app?.triggers?.[def.trigger.event]?.type === 'polling') pollFlow(get('SELECT * FROM flows WHERE id = ?', f.id), { seedOnly: true }).catch(() => {});
  return { ok: true, version };
}

flows.post('/flows/:id/publish', (req, res) => {
  const f = loadFlow(req, res); if (!f) return;
  const r = publishFlow(req.ws, req.user, f, req.body?.note || '');
  if (!r.ok) return res.status(422).json({ error: 'Fix these issues before publishing.', issues: r.issues });
  res.json(r);
});
flows.post('/flows/:id/status', (req, res) => {
  const f = loadFlow(req, res); if (!f) return;
  const { status } = req.body || {};
  if (status === 'on' && !f.published) return res.status(400).json({ error: 'Publish the flow before turning it on.' });
  if (!['on', 'off'].includes(status)) return res.status(400).json({ error: 'Status must be on or off' });
  const st = j(f.trigger_state, {});
  if (status === 'on') { delete st.nextAt; st.consecutiveErrors = 0; }
  run('UPDATE flows SET status = ?, trigger_state = ? WHERE id = ?', status, s(st), f.id);
  audit(req.ws.id, req.user, status === 'on' ? 'flow.turned_on' : 'flow.turned_off', f.name);
  res.json({ ok: true });
});
flows.post('/flows/:id/duplicate', (req, res) => {
  const f = loadFlow(req, res); if (!f) return;
  const id = createFlow(req.ws, req.user, { name: `${f.name} (copy)`, description: f.description, definition: j(f.definition), folderId: f.folder_id });
  res.json({ id });
});
flows.delete('/flows/:id', (req, res) => {
  const f = loadFlow(req, res); if (!f) return;
  if (req.query.permanent === 'true') {
    run('DELETE FROM flows WHERE id = ?', f.id);
    audit(req.ws.id, req.user, 'flow.deleted_permanently', f.name);
  } else {
    run("UPDATE flows SET deleted_at = ?, status = CASE WHEN status = 'on' THEN 'off' ELSE status END WHERE id = ?", now(), f.id);
    audit(req.ws.id, req.user, 'flow.trashed', f.name);
  }
  res.json({ ok: true });
});
flows.post('/flows/:id/restore', (req, res) => {
  const f = loadFlow(req, res); if (!f) return;
  run('UPDATE flows SET deleted_at = NULL WHERE id = ?', f.id);
  audit(req.ws.id, req.user, 'flow.restored', f.name);
  res.json({ ok: true });
});
flows.get('/flows/:id/export', (req, res) => {
  const f = loadFlow(req, res); if (!f) return;
  const def = j(f.definition);
  res.setHeader('content-disposition', `attachment; filename="${f.name.replace(/[^\w-]+/g, '_')}.onetier.json"`);
  res.json({ format: 'onetier.flow/v1', name: f.name, description: f.description, exported_at: now(), definition: def });
});
flows.get('/flows/:id/versions', (req, res) => {
  const f = loadFlow(req, res); if (!f) return;
  res.json(all('SELECT v.id, v.version, v.note, v.created_at, u.name AS author FROM flow_versions v LEFT JOIN users u ON u.id = v.created_by WHERE flow_id = ? ORDER BY version DESC', f.id));
});
flows.get('/flows/:id/versions/:version', (req, res) => {
  const f = loadFlow(req, res); if (!f) return;
  const v = get('SELECT * FROM flow_versions WHERE flow_id = ? AND version = ?', f.id, Number(req.params.version));
  if (!v) return res.status(404).json({ error: 'Version not found' });
  res.json({ ...v, definition: j(v.definition) });
});
flows.post('/flows/:id/versions/:version/restore', (req, res) => {
  const f = loadFlow(req, res); if (!f) return;
  const v = get('SELECT * FROM flow_versions WHERE flow_id = ? AND version = ?', f.id, Number(req.params.version));
  if (!v) return res.status(404).json({ error: 'Version not found' });
  run('UPDATE flows SET definition = ?, updated_at = ? WHERE id = ?', v.definition, now(), f.id);
  audit(req.ws.id, req.user, 'flow.version_restored', f.name, { version: v.version });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- testing
flows.post('/flows/:id/test-trigger', async (req, res) => {
  const f = loadFlow(req, res); if (!f) return;
  const def = j(f.definition);
  const t = def.trigger || {};
  const app = getApp(t.app, req.ws.id);
  const tdef = app?.triggers?.[t.event];
  if (!tdef) return res.status(400).json({ error: 'Choose a trigger app and event first.' });
  const st = j(f.trigger_state, {});
  let samples = [];
  let note = '';
  try {
    if (t.app === 'webhook') {
      samples = st.samples || [];
      note = samples.length ? `Latest request received ${st.lastSampleAt}.` : `No requests yet. Send a request to ${hookUrl(f, req)} and test again.`;
    } else if (tdef.type === 'polling') {
      const r = await pollFlow({ ...f, published: f.definition }, { seedOnly: true });
      samples = r.samples; note = samples.length ? `Found ${r.found} items. Showing the most recent.` : 'No items found. Add one in the source app and test again.';
    } else if (tdef.type === 'schedule') {
      const at = nextScheduleTime(t.params);
      samples = [{ ...tdef.sample, iso: at.toISOString(), date: at.toISOString().slice(0, 10) }];
      note = `Next run: ${at.toString()}`;
    } else if (t.app === 'tables' && t.params?.tableId) {
      const { findRecords } = await import('../services.js');
      samples = findRecords(req.ws.id, t.params.tableId, { limit: 3 });
      note = samples.length ? 'Showing the latest records.' : 'This table has no records yet.';
    } else if (t.app === 'interfaces' && t.params?.interfaceId) {
      samples = all('SELECT data, created_at FROM submissions WHERE interface_id = ? ORDER BY created_at DESC LIMIT 3', t.params.interfaceId).map((r) => ({ ...j(r.data, {}), submitted_at: r.created_at }));
      note = samples.length ? 'Showing the latest submissions.' : 'No submissions yet — showing sample data.';
    } else if (t.app === 'manual') {
      const inputs = Object.fromEntries((t.params?.inputs || []).map((k) => [k, `sample ${k}`]));
      samples = [{ triggered_by: req.user.name, inputs, triggered_at: now() }];
    }
  } catch (e) { return res.status(400).json({ error: e.message }); }
  if (!samples.length) samples = [tdef.sample || {}];
  def.trigger.sample = samples[0];
  run('UPDATE flows SET definition = ?, updated_at = ? WHERE id = ?', s(def), now(), f.id);
  res.json({ samples, note });
});
flows.post('/flows/:id/test-step', async (req, res) => {
  const f = loadFlow(req, res); if (!f) return;
  try { res.json(await testStep(f, req.body.stepId, req.body.sampleSteps || {})); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
flows.post('/flows/:id/run', async (req, res) => {
  const f = loadFlow(req, res); if (!f) return;
  const mode = req.body?.mode || 'live';
  const def = j(f.definition);
  const data = req.body?.data ?? def.trigger?.sample ?? {};
  if (mode === 'live' && f.status !== 'on') return res.status(409).json({ error: 'Turn the flow on to run it live, or run a test.' });
  const r = await executeFlow(f, data, { source: 'manual', testMode: mode === 'test', definition: mode === 'test' ? def : undefined });
  res.json(r);
});
flows.post('/flows/:id/poll', async (req, res) => {
  const f = loadFlow(req, res); if (!f) return;
  if (f.status !== 'on') return res.status(409).json({ error: 'Turn the flow on first.' });
  try { res.json(await pollFlow(f, { force: true })); } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------------------------------------------------------------- runs / history
flows.get('/runs', (req, res) => {
  const { flowId, status, source, q, from, to } = req.query;
  const limit = Math.min(200, Number(req.query.limit) || 50);
  const offset = Number(req.query.offset) || 0;
  const where = ['workspace_id = ?']; const p = [req.ws.id];
  if (flowId) { where.push('flow_id = ?'); p.push(flowId); }
  if (status) { where.push('status = ?'); p.push(status); }
  if (source) { where.push('source = ?'); p.push(source); }
  if (q) { where.push('(flow_name LIKE ? OR trigger_data LIKE ? OR error LIKE ?)'); p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (from) { where.push('started_at >= ?'); p.push(from); }
  if (to) { where.push('started_at <= ?'); p.push(to); }
  const total = get(`SELECT COUNT(*) c FROM runs WHERE ${where.join(' AND ')}`, ...p).c;
  const rows = all(`SELECT id, flow_id, flow_name, source, status, tasks_used, error, version, replay_of, started_at, finished_at FROM runs WHERE ${where.join(' AND ')} ORDER BY started_at DESC LIMIT ? OFFSET ?`, ...p, limit, offset);
  const counts = Object.fromEntries(all(`SELECT status, COUNT(*) c FROM runs WHERE workspace_id = ? AND started_at >= ? GROUP BY status`, req.ws.id, new Date(Date.now() - 30 * 864e5).toISOString()).map((r) => [r.status, r.c]));
  res.json({ total, runs: rows, counts });
});
flows.get('/runs/:id', (req, res) => {
  const r = get('SELECT * FROM runs WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id);
  if (!r) return res.status(404).json({ error: 'Run not found' });
  const steps = all('SELECT * FROM run_steps WHERE run_id = ? ORDER BY seq', r.id).map((x) => ({ ...x, input: j(x.input), output: j(x.output) }));
  const approval = get('SELECT * FROM approvals WHERE run_id = ? ORDER BY created_at DESC LIMIT 1', r.id);
  res.json({ ...r, trigger_data: j(r.trigger_data), state: undefined, steps, approval });
});
flows.post('/runs/:id/replay', async (req, res) => {
  const r = get('SELECT * FROM runs WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id);
  if (!r) return res.status(404).json({ error: 'Run not found' });
  try { const out = await replayRun(r.id, { latest: req.body?.version !== 'original' }); audit(req.ws.id, req.user, 'run.replayed', r.flow_name); res.json(out); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
flows.post('/runs/replay-bulk', async (req, res) => {
  const results = [];
  for (const id of (req.body?.ids || []).slice(0, 50)) {
    const r = get('SELECT id FROM runs WHERE id = ? AND workspace_id = ?', id, req.ws.id);
    if (!r) continue;
    try { results.push(await replayRun(id)); } catch (e) { results.push({ runId: id, status: 'error', error: e.message }); }
  }
  res.json({ results });
});
flows.delete('/runs', requireRole('admin'), (req, res) => {
  const before = req.query.before || new Date(Date.now() - 30 * 864e5).toISOString();
  const r = run("DELETE FROM runs WHERE workspace_id = ? AND started_at < ? AND status != 'waiting'", req.ws.id, before);
  audit(req.ws.id, req.user, 'runs.purged', `${r.changes} runs`);
  res.json({ deleted: r.changes });
});

// ---------------------------------------------------------------- approvals
flows.get('/approvals', (req, res) => {
  const status = req.query.status || 'pending';
  res.json(all(`SELECT a.*, f.name AS flow_name FROM approvals a LEFT JOIN flows f ON f.id = a.flow_id WHERE a.workspace_id = ? ${status === 'all' ? '' : 'AND a.status = ?'} ORDER BY a.created_at DESC LIMIT 100`,
    ...(status === 'all' ? [req.ws.id] : [req.ws.id, status])));
});
flows.post('/approvals/:id/decide', async (req, res) => {
  const ap = get('SELECT * FROM approvals WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id);
  if (!ap) return res.status(404).json({ error: 'Approval not found' });
  try {
    const r = await decideApproval(ap.id, req.user, req.body.decision, req.body.comment || '');
    audit(req.ws.id, req.user, `approval.${req.body.decision}`, ap.title);
    res.json(r);
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
