import { Router } from 'express';
import crypto from 'node:crypto';
import { get, all, run, uid, now, j, s } from '../db.js';
import { authenticate, requireRole, sha256 } from '../auth.js';
import { listApps, getApp, customAppDef, serializeApp } from '../apps/registry.js';
import { usageFor, planOf } from '../plans.js';
import * as svc from '../services.js';
import { aiConfigured } from '../ai.js';

export const misc = Router();
misc.use(authenticate);
const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 400).json({ error: e.message }); } };
import { publicUrl } from '../url.js';

// ---------------------------------------------------------------- dashboard
misc.get('/dashboard', (req, res) => {
  const ws = req.ws.id;
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const flowCounts = Object.fromEntries(all('SELECT status, COUNT(*) c FROM flows WHERE workspace_id = ? AND deleted_at IS NULL GROUP BY status', ws).map((r) => [r.status, r.c]));
  const daily = all(`SELECT substr(started_at,1,10) day, COUNT(*) runs, SUM(tasks_used) tasks, SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) errors
    FROM runs WHERE workspace_id = ? AND started_at >= ? GROUP BY day ORDER BY day`, ws, since);
  res.json({
    flows: { on: flowCounts.on || 0, off: flowCounts.off || 0, draft: flowCounts.draft || 0, total: Object.values(flowCounts).reduce((a, b) => a + b, 0) },
    usage: usageFor(ws),
    runs14d: daily,
    recentRuns: all('SELECT id, flow_id, flow_name, status, source, tasks_used, started_at, error FROM runs WHERE workspace_id = ? ORDER BY started_at DESC LIMIT 8', ws),
    recentFlows: all('SELECT id, name, status, updated_at FROM flows WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 6', ws),
    pendingApprovals: get("SELECT COUNT(*) c FROM approvals WHERE workspace_id = ? AND status = 'pending'", ws).c,
    counts: {
      tables: get('SELECT COUNT(*) c FROM tables_ WHERE workspace_id = ?', ws).c, interfaces: get('SELECT COUNT(*) c FROM interfaces WHERE workspace_id = ?', ws).c,
      chatbots: get('SELECT COUNT(*) c FROM chatbots WHERE workspace_id = ?', ws).c, canvases: get('SELECT COUNT(*) c FROM canvases WHERE workspace_id = ?', ws).c,
      connections: get('SELECT COUNT(*) c FROM connections WHERE workspace_id = ?', ws).c, unreadMail: get('SELECT COUNT(*) c FROM mailbox WHERE workspace_id = ? AND read = 0', ws).c,
    },
    errors7d: get("SELECT COUNT(*) c FROM runs WHERE workspace_id = ? AND status = 'error' AND started_at >= ?", ws, new Date(Date.now() - 7 * 864e5).toISOString()).c,
    ai: aiConfigured(ws),
  });
});

// ---------------------------------------------------------------- search (command palette)
misc.get('/search', (req, res) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  if (q === '%%') return res.json([]);
  const ws = req.ws.id;
  const out = [
    ...all('SELECT id, name FROM flows WHERE workspace_id = ? AND deleted_at IS NULL AND name LIKE ? LIMIT 8', ws, q).map((r) => ({ type: 'flow', id: r.id, title: r.name, url: `/flows/${r.id}` })),
    ...all('SELECT id, name FROM tables_ WHERE workspace_id = ? AND name LIKE ? LIMIT 5', ws, q).map((r) => ({ type: 'table', id: r.id, title: r.name, url: `/tables/${r.id}` })),
    ...all('SELECT id, name FROM interfaces WHERE workspace_id = ? AND name LIKE ? LIMIT 5', ws, q).map((r) => ({ type: 'interface', id: r.id, title: r.name, url: `/interfaces/${r.id}` })),
    ...all('SELECT id, name FROM chatbots WHERE workspace_id = ? AND name LIKE ? LIMIT 5', ws, q).map((r) => ({ type: 'chatbot', id: r.id, title: r.name, url: `/chatbots/${r.id}` })),
    ...all('SELECT id, name FROM canvases WHERE workspace_id = ? AND name LIKE ? LIMIT 5', ws, q).map((r) => ({ type: 'canvas', id: r.id, title: r.name, url: `/canvas/${r.id}` })),
  ];
  const needle = String(req.query.q).toLowerCase();
  for (const a of listApps(ws)) if (a.name.toLowerCase().includes(needle)) out.push({ type: 'app', id: a.key, title: a.name, url: `/apps/${a.key}` });
  res.json(out.slice(0, 25));
});

// ---------------------------------------------------------------- notifications
misc.get('/notifications', (req, res) => {
  const rows = all('SELECT * FROM notifications WHERE workspace_id = ? AND (user_id IS NULL OR user_id = ?) ORDER BY created_at DESC LIMIT 60', req.ws.id, req.user.id);
  res.json({ items: rows, unread: rows.filter((r) => !r.read).length });
});
misc.post('/notifications/read-all', (req, res) => { run('UPDATE notifications SET read = 1 WHERE workspace_id = ?', req.ws.id); res.json({ ok: true }); });
misc.post('/notifications/:id/read', (req, res) => { run('UPDATE notifications SET read = 1 WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id); res.json({ ok: true }); });
misc.delete('/notifications', (req, res) => { run('DELETE FROM notifications WHERE workspace_id = ?', req.ws.id); res.json({ ok: true }); });

// ---------------------------------------------------------------- mailbox (OneTier Inbox)
misc.get('/mailbox', (req, res) => res.json(all('SELECT * FROM mailbox WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 200', req.ws.id)));
misc.post('/mailbox/:id/read', (req, res) => { run('UPDATE mailbox SET read = 1 WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id); res.json({ ok: true }); });
misc.delete('/mailbox/:id', (req, res) => { run('DELETE FROM mailbox WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id); res.json({ ok: true }); });
misc.delete('/mailbox', (req, res) => { run('DELETE FROM mailbox WHERE workspace_id = ?', req.ws.id); res.json({ ok: true }); });

// ---------------------------------------------------------------- audit log
misc.get('/audit', requireRole('admin'), (req, res) => {
  const since = new Date(Date.now() - planOf(req.ws).auditDays * 864e5).toISOString();
  const q = req.query.q ? `%${req.query.q}%` : '%';
  res.json(all('SELECT * FROM audit_logs WHERE workspace_id = ? AND created_at >= ? AND (action LIKE ? OR target LIKE ? OR user_name LIKE ?) ORDER BY created_at DESC LIMIT 500', req.ws.id, since, q, q, q)
    .map((r) => ({ ...r, meta: j(r.meta, {}) })));
});

// ---------------------------------------------------------------- storage
misc.get('/storage', (req, res) => res.json(svc.kv.list(req.ws.id)));
misc.put('/storage/:key', (req, res) => { svc.kv.set(req.ws.id, req.params.key, req.body.value); res.json({ ok: true }); });
misc.delete('/storage/:key', (req, res) => { svc.kv.remove(req.ws.id, req.params.key); res.json({ ok: true }); });

// ---------------------------------------------------------------- API keys
misc.get('/api-keys', (req, res) => res.json(all('SELECT k.id, k.name, k.prefix, k.created_at, k.last_used_at, u.name AS created_by FROM api_keys k LEFT JOIN users u ON u.id = k.created_by WHERE workspace_id = ? ORDER BY k.created_at DESC', req.ws.id)));
misc.post('/api-keys', requireRole('admin'), (req, res) => {
  const name = String(req.body.name || 'API key').trim();
  const key = `ot_${crypto.randomBytes(24).toString('base64url')}`;
  run('INSERT INTO api_keys (id, workspace_id, name, prefix, key_hash, created_by, created_at) VALUES (?,?,?,?,?,?,?)', uid('key_'), req.ws.id, name, key.slice(0, 10), sha256(key), req.user.id, now());
  svc.audit(req.ws.id, req.user, 'api_key.created', name);
  res.json({ key, name });
});
misc.delete('/api-keys/:id', requireRole('admin'), (req, res) => { run('DELETE FROM api_keys WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id); svc.audit(req.ws.id, req.user, 'api_key.revoked', req.params.id); res.json({ ok: true }); });

// ---------------------------------------------------------------- MCP servers
const mcpOut = (m, req) => ({ ...m, tools: j(m.tools, []), url: `${publicUrl(req)}/mcp/${m.token}` });
misc.get('/mcp-servers', (req, res) => res.json(all('SELECT * FROM mcp_servers WHERE workspace_id = ? ORDER BY created_at DESC', req.ws.id).map((m) => mcpOut(m, req))));
misc.post('/mcp-servers', wrap((req, res) => {
  const id = uid('mcp_');
  run('INSERT INTO mcp_servers (id, workspace_id, name, token, tools, created_at) VALUES (?,?,?,?,?,?)', id, req.ws.id, String(req.body.name || 'My MCP server').trim(), crypto.randomBytes(24).toString('base64url'), s(req.body.tools || [{ type: 'builder' }]), now());
  svc.audit(req.ws.id, req.user, 'mcp.created', req.body.name || '');
  res.json(mcpOut(get('SELECT * FROM mcp_servers WHERE id = ?', id), req));
}));
misc.put('/mcp-servers/:id', wrap((req, res) => {
  const m = get('SELECT * FROM mcp_servers WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id);
  if (!m) throw new Error('Server not found');
  for (const t of req.body.tools || []) { const a = getApp(t.app, req.ws.id); if (!a?.actions?.[t.action] && !['flow', 'builder'].includes(t.type)) throw new Error(`Unknown action ${t.app}.${t.action}`); }
  run('UPDATE mcp_servers SET name = COALESCE(?, name), tools = COALESCE(?, tools) WHERE id = ?', req.body.name ?? null, req.body.tools ? s(req.body.tools) : null, m.id);
  res.json(mcpOut(get('SELECT * FROM mcp_servers WHERE id = ?', m.id), req));
}));
misc.post('/mcp-servers/:id/rotate', wrap((req, res) => {
  run('UPDATE mcp_servers SET token = ? WHERE id = ? AND workspace_id = ?', crypto.randomBytes(24).toString('base64url'), req.params.id, req.ws.id);
  res.json(mcpOut(get('SELECT * FROM mcp_servers WHERE id = ?', req.params.id), req));
}));
misc.delete('/mcp-servers/:id', (req, res) => { run('DELETE FROM mcp_servers WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id); res.json({ ok: true }); });

// ---------------------------------------------------------------- Developer platform (custom apps)
const devOut = (r) => ({ ...r, auth: j(r.auth, {}), operations: j(r.operations, []), app_key: `custom_${r.key}` });
misc.get('/developer/apps', (req, res) => res.json(all('SELECT * FROM custom_apps WHERE workspace_id = ? ORDER BY updated_at DESC', req.ws.id).map(devOut)));
misc.get('/developer/apps/:id', wrap((req, res) => {
  const r = get('SELECT * FROM custom_apps WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id);
  if (!r) throw Object.assign(new Error('App not found'), { status: 404 });
  res.json(devOut(r));
}));
misc.post('/developer/apps', wrap((req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw new Error('App name is required');
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'app';
  if (get('SELECT 1 FROM custom_apps WHERE workspace_id = ? AND key = ?', req.ws.id, key)) throw new Error('An app with this name already exists');
  const id = uid('app_');
  run('INSERT INTO custom_apps (id, workspace_id, key, name, description, color, base_url, auth, operations, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    id, req.ws.id, key, name, req.body.description || '', req.body.color || '#5B3DF5', req.body.base_url || '', s(req.body.auth || { type: 'none' }), s(req.body.operations || []), now(), now());
  svc.audit(req.ws.id, req.user, 'developer.app_created', name);
  res.json({ id });
}));
misc.put('/developer/apps/:id', wrap((req, res) => {
  const r = get('SELECT * FROM custom_apps WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id);
  if (!r) throw new Error('App not found');
  const ops = req.body.operations;
  if (ops) {
    const keys = new Set();
    for (const op of ops) {
      if (!/^[a-z][a-z0-9_]*$/.test(op.key || '')) throw new Error(`Operation key "${op.key}" must be lowercase letters, numbers and underscores.`);
      if (keys.has(op.key)) throw new Error(`Duplicate operation key "${op.key}"`); keys.add(op.key);
      if (!op.request?.url) throw new Error(`Operation "${op.name || op.key}" needs a request URL.`);
    }
  }
  const bump = req.body.bumpVersion ? r.version.split('.').map(Number).map((n, i) => (i === 2 ? n + 1 : n)).join('.') : r.version;
  run(`UPDATE custom_apps SET name = COALESCE(?, name), description = COALESCE(?, description), color = COALESCE(?, color), base_url = COALESCE(?, base_url),
       auth = COALESCE(?, auth), operations = COALESCE(?, operations), version = ?, status = COALESCE(?, status), updated_at = ? WHERE id = ?`,
    req.body.name ?? null, req.body.description ?? null, req.body.color ?? null, req.body.base_url ?? null, req.body.auth ? s(req.body.auth) : null, ops ? s(ops) : null, bump, req.body.status ?? null, now(), r.id);
  res.json(devOut(get('SELECT * FROM custom_apps WHERE id = ?', r.id)));
}));
misc.delete('/developer/apps/:id', (req, res) => { run('DELETE FROM custom_apps WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id); res.json({ ok: true }); });
misc.post('/developer/apps/:id/test', wrap(async (req, res) => {
  const r = get('SELECT * FROM custom_apps WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id);
  if (!r) throw new Error('App not found');
  const app = customAppDef(r);
  const { operation, params = {}, credentials = {} } = req.body;
  const action = app.actions[operation]; const trigger = app.triggers[operation];
  const started = Date.now();
  try {
    const out = action ? await action.run({ params, creds: credentials }) : await trigger.poll({ params, creds: credentials });
    res.json({ ok: true, output: out, ms: Date.now() - started });
  } catch (e) { res.json({ ok: false, error: e.message, ms: Date.now() - started }); }
}));
misc.get('/developer/apps/:id/definition', wrap((req, res) => {
  const r = get('SELECT * FROM custom_apps WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id);
  if (!r) throw new Error('App not found');
  res.json(serializeApp(customAppDef(r)));
}));
