// Shared domain services used by both HTTP routes and app actions.
import { EventEmitter } from 'node:events';
import { get, all, run, uid, now, j, s } from './db.js';

export const bus = new EventEmitter();
bus.setMaxListeners(100);

export const FIELD_TYPES = ['text', 'long_text', 'number', 'email', 'url', 'phone', 'checkbox', 'date', 'select', 'multi_select', 'currency', 'rating', 'json', 'ai'];

// ---------------- Tables ----------------
export function getTable(wsId, tableId) {
  const t = get('SELECT * FROM tables_ WHERE id = ? AND workspace_id = ?', tableId, wsId);
  if (!t) throw Object.assign(new Error('Table not found'), { status: 404 });
  return { ...t, fields: j(t.fields, []) };
}

function coerce(field, v) {
  if (v === undefined) return undefined;
  switch (field.type) {
    case 'number': case 'currency': case 'rating': return v === '' || v == null ? null : Number(v);
    case 'checkbox': return v === true || ['true', '1', 'yes', 'on'].includes(String(v).toLowerCase());
    case 'multi_select': return Array.isArray(v) ? v : String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    case 'json': if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } } return v;
    default: return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
}

/** Map incoming data (keyed by field id OR field name) to field ids. */
export function normalizeRecord(table, data = {}) {
  const out = {};
  for (const f of table.fields) {
    let v = data[f.id];
    if (v === undefined) v = data[f.name];
    if (v === undefined) {
      const key = Object.keys(data).find((k) => k.toLowerCase() === f.name.toLowerCase());
      if (key) v = data[key];
    }
    const c = coerce(f, v);
    if (c !== undefined) out[f.id] = c;
  }
  return out;
}

/** Present a record keyed by field name (friendlier for mapping) plus ids. */
export function presentRecord(table, rec) {
  const data = j(rec.data, {});
  const byName = {};
  for (const f of table.fields) byName[f.name] = data[f.id] ?? null;
  return { id: rec.id, table_id: table.id, ...byName, _fields: data, created_at: rec.created_at, updated_at: rec.updated_at };
}

export function createRecord(wsId, tableId, data, { source = 'user' } = {}) {
  const table = getTable(wsId, tableId);
  const ws = get('SELECT * FROM workspaces WHERE id = ?', wsId);
  const count = get('SELECT COUNT(*) c FROM table_records r JOIN tables_ t ON t.id = r.table_id WHERE t.workspace_id = ?', wsId).c;
  const id = uid('rec_');
  const t = now();
  run('INSERT INTO table_records (id, table_id, data, created_at, updated_at) VALUES (?,?,?,?,?)', id, tableId, s(normalizeRecord(table, data)), t, t);
  run('UPDATE tables_ SET updated_at = ? WHERE id = ?', t, tableId);
  const rec = presentRecord(table, get('SELECT * FROM table_records WHERE id = ?', id));
  bus.emit('table.record.created', { wsId, tableId, record: rec, source });
  return rec;
}

export function updateRecord(wsId, tableId, recordId, data, { source = 'user' } = {}) {
  const table = getTable(wsId, tableId);
  const rec = get('SELECT * FROM table_records WHERE id = ? AND table_id = ?', recordId, tableId);
  if (!rec) throw Object.assign(new Error('Record not found'), { status: 404 });
  const merged = { ...j(rec.data, {}), ...normalizeRecord(table, data) };
  const t = now();
  run('UPDATE table_records SET data = ?, updated_at = ? WHERE id = ?', s(merged), t, recordId);
  const out = presentRecord(table, get('SELECT * FROM table_records WHERE id = ?', recordId));
  bus.emit('table.record.updated', { wsId, tableId, record: out, source });
  return out;
}

export function deleteRecord(wsId, tableId, recordId) {
  getTable(wsId, tableId);
  const r = run('DELETE FROM table_records WHERE id = ? AND table_id = ?', recordId, tableId);
  if (!r.changes) throw Object.assign(new Error('Record not found'), { status: 404 });
  bus.emit('table.record.deleted', { wsId, tableId, recordId });
  return { deleted: true, id: recordId };
}

export function findRecords(wsId, tableId, { field, value, op = 'equals', limit = 50 } = {}) {
  const table = getTable(wsId, tableId);
  const f = table.fields.find((x) => x.id === field || x.name.toLowerCase() === String(field || '').toLowerCase());
  const rows = all('SELECT * FROM table_records WHERE table_id = ? ORDER BY created_at DESC', tableId);
  const res = [];
  for (const r of rows) {
    const d = j(r.data, {});
    if (f) {
      const v = String(d[f.id] ?? '').toLowerCase();
      const target = String(value ?? '').toLowerCase();
      const ok = op === 'contains' ? v.includes(target) : v === target;
      if (!ok) continue;
    }
    res.push(presentRecord(table, r));
    if (res.length >= limit) break;
  }
  return res;
}

// ---------------- Notifications / mailbox / audit ----------------
export function notify(wsId, { userId = null, type = 'info', title, body = '', link = '' }) {
  const id = uid('ntf_');
  run('INSERT INTO notifications (id, workspace_id, user_id, type, title, body, link, created_at) VALUES (?,?,?,?,?,?,?,?)',
    id, wsId, userId, type, title, body, link, now());
  bus.emit('notification', { wsId, id });
  return { id, title, body };
}

export function deliverMail(wsId, { to, fromName = 'OneTier', subject, body, html = false, runId = null }) {
  const id = uid('mail_');
  run('INSERT INTO mailbox (id, workspace_id, to_addr, from_name, subject, body, html, run_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    id, wsId, to, fromName, subject, body, html ? 1 : 0, runId, now());
  return { id, to, subject, delivered_to: 'OneTier Inbox' };
}

export function audit(wsId, user, action, target = '', meta = {}) {
  run('INSERT INTO audit_logs (id, workspace_id, user_id, user_name, action, target, meta, created_at) VALUES (?,?,?,?,?,?,?,?)',
    uid('aud_'), wsId, user?.id || null, user?.name || 'System', action, target, s(meta), now());
}

// ---------------- Storage (KV) ----------------
export const kv = {
  get(wsId, key) { const r = get('SELECT value FROM kv WHERE workspace_id = ? AND key = ?', wsId, key); return r ? j(r.value) : null; },
  set(wsId, key, value) {
    run('INSERT INTO kv (workspace_id, key, value, updated_at) VALUES (?,?,?,?) ON CONFLICT(workspace_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      wsId, key, s(value), now());
    return value;
  },
  remove(wsId, key) { run('DELETE FROM kv WHERE workspace_id = ? AND key = ?', wsId, key); },
  list(wsId) { return all('SELECT key, value, updated_at FROM kv WHERE workspace_id = ? ORDER BY key', wsId).map((r) => ({ ...r, value: j(r.value) })); },
};
