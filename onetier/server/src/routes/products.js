import { Router } from 'express';
import crypto from 'node:crypto';
import { get, all, run, uid, now, j, s } from '../db.js';
import { authenticate } from '../auth.js';
import * as svc from '../services.js';
import { aiText, aiConfigured } from '../ai.js';
import { draftFlow, draftCanvas, copilotChat } from '../copilot.js';
import { chatbotReply } from '../chatbot.js';
import { createFlow } from './flows.js';

export const products = Router();
products.use(authenticate);

const slugify = (n) => `${String(n || 'page').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'page'}-${crypto.randomBytes(3).toString('hex')}`;
const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 400).json({ error: e.message }); } };

// ---------------------------------------------------------------- Tables
const fieldId = () => uid('fld_');
products.get('/tables', (req, res) => {
  res.json(all(`SELECT t.*, (SELECT COUNT(*) FROM table_records r WHERE r.table_id = t.id) AS record_count FROM tables_ t WHERE workspace_id = ? ORDER BY updated_at DESC`, req.ws.id)
    .map((t) => ({ ...t, fields: j(t.fields, []) })));
});
products.post('/tables', wrap((req, res) => {
  const name = String(req.body.name || '').trim() || 'Untitled table';
  const fields = (req.body.fields?.length ? req.body.fields : [{ name: 'Name', type: 'text' }, { name: 'Notes', type: 'long_text' }])
    .map((f) => ({ id: fieldId(), name: f.name, type: svc.FIELD_TYPES.includes(f.type) ? f.type : 'text', options: f.options }));
  const id = uid('tbl_');
  run('INSERT INTO tables_ (id, workspace_id, name, description, fields, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', id, req.ws.id, name, req.body.description || '', s(fields), now(), now());
  svc.audit(req.ws.id, req.user, 'table.created', name);
  res.json({ id });
}));
products.get('/tables/:id', wrap((req, res) => {
  const t = svc.getTable(req.ws.id, req.params.id);
  const q = String(req.query.q || '').toLowerCase();
  const sort = req.query.sort; const dir = req.query.dir === 'asc' ? 1 : -1;
  let recs = all('SELECT * FROM table_records WHERE table_id = ? ORDER BY created_at DESC', t.id).map((r) => ({ id: r.id, data: j(r.data, {}), created_at: r.created_at, updated_at: r.updated_at }));
  if (q) recs = recs.filter((r) => JSON.stringify(r.data).toLowerCase().includes(q));
  if (req.query.filterField && req.query.filterValue !== undefined) recs = recs.filter((r) => String(r.data[req.query.filterField] ?? '').toLowerCase() === String(req.query.filterValue).toLowerCase());
  if (sort) recs.sort((a, b) => { const x = a.data[sort] ?? ''; const y = b.data[sort] ?? ''; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir; });
  const total = recs.length;
  const limit = Math.min(500, Number(req.query.limit) || 100); const offset = Number(req.query.offset) || 0;
  const flows = all(`SELECT id, name, status FROM flows WHERE workspace_id = ? AND deleted_at IS NULL AND definition LIKE ?`, req.ws.id, `%${t.id}%`);
  res.json({ ...t, total, records: recs.slice(offset, offset + limit), flows });
}));
products.patch('/tables/:id', wrap((req, res) => {
  const t = svc.getTable(req.ws.id, req.params.id);
  let fields = t.fields;
  if (req.body.fields) {
    fields = req.body.fields.map((f) => ({ id: f.id || fieldId(), name: String(f.name || 'Field').trim(), type: svc.FIELD_TYPES.includes(f.type) ? f.type : 'text', options: f.options, prompt: f.prompt, required: f.required }));
    const names = fields.map((f) => f.name.toLowerCase());
    if (new Set(names).size !== names.length) throw new Error('Field names must be unique');
  }
  run('UPDATE tables_ SET name = COALESCE(?, name), description = COALESCE(?, description), fields = ?, updated_at = ? WHERE id = ?', req.body.name ?? null, req.body.description ?? null, s(fields), now(), t.id);
  res.json({ ok: true, fields });
}));
products.delete('/tables/:id', wrap((req, res) => {
  const t = svc.getTable(req.ws.id, req.params.id);
  run('DELETE FROM tables_ WHERE id = ?', t.id);
  svc.audit(req.ws.id, req.user, 'table.deleted', t.name);
  res.json({ ok: true });
}));
products.post('/tables/:id/duplicate', wrap((req, res) => {
  const t = svc.getTable(req.ws.id, req.params.id);
  const id = uid('tbl_');
  run('INSERT INTO tables_ (id, workspace_id, name, description, fields, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', id, req.ws.id, `${t.name} (copy)`, t.description, s(t.fields), now(), now());
  if (req.body?.withRecords !== false) for (const r of all('SELECT data FROM table_records WHERE table_id = ?', t.id)) run('INSERT INTO table_records (id, table_id, data, created_at, updated_at) VALUES (?,?,?,?,?)', uid('rec_'), id, r.data, now(), now());
  res.json({ id });
}));
products.post('/tables/:id/records', wrap((req, res) => res.json(svc.createRecord(req.ws.id, req.params.id, req.body.data || {}))));
products.patch('/tables/:id/records/:rid', wrap((req, res) => res.json(svc.updateRecord(req.ws.id, req.params.id, req.params.rid, req.body.data || {}))));
products.delete('/tables/:id/records/:rid', wrap((req, res) => res.json(svc.deleteRecord(req.ws.id, req.params.id, req.params.rid))));
products.post('/tables/:id/records/bulk-delete', wrap((req, res) => {
  svc.getTable(req.ws.id, req.params.id);
  let n = 0; for (const rid of req.body.ids || []) n += run('DELETE FROM table_records WHERE id = ? AND table_id = ?', rid, req.params.id).changes;
  res.json({ deleted: n });
}));
function parseCSV(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
products.post('/tables/:id/import', wrap((req, res) => {
  const t = svc.getTable(req.ws.id, req.params.id);
  const rows = parseCSV(String(req.body.csv || ''));
  if (rows.length < 2) throw new Error('CSV needs a header row and at least one data row.');
  const header = rows[0].map((h) => h.trim());
  let fields = t.fields;
  if (req.body.createFields !== false) {
    for (const h of header) if (h && !fields.some((f) => f.name.toLowerCase() === h.toLowerCase())) fields = [...fields, { id: fieldId(), name: h, type: 'text' }];
    run('UPDATE tables_ SET fields = ? WHERE id = ?', s(fields), t.id);
  }
  let n = 0;
  for (const r of rows.slice(1)) { svc.createRecord(req.ws.id, t.id, Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])), { source: 'import' }); n++; }
  svc.audit(req.ws.id, req.user, 'table.imported', t.name, { rows: n });
  res.json({ imported: n });
}));
products.get('/tables/:id/export', wrap((req, res) => {
  const t = svc.getTable(req.ws.id, req.params.id);
  const esc = (v) => { const x = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  const lines = [['id', ...t.fields.map((f) => f.name), 'created_at'].map(esc).join(',')];
  for (const r of all('SELECT * FROM table_records WHERE table_id = ? ORDER BY created_at', t.id)) { const d = j(r.data, {}); lines.push([r.id, ...t.fields.map((f) => d[f.id]), r.created_at].map(esc).join(',')); }
  res.setHeader('content-type', 'text/csv');
  res.setHeader('content-disposition', `attachment; filename="${t.name.replace(/[^\w-]+/g, '_')}.csv"`);
  res.send(lines.join('\n'));
}));
products.post('/tables/:id/ai-fill', wrap(async (req, res) => {
  const t = svc.getTable(req.ws.id, req.params.id);
  const field = t.fields.find((f) => f.id === req.body.fieldId);
  if (!field || field.type !== 'ai') throw new Error('Choose an AI field.');
  if (!field.prompt) throw new Error('Give the AI field a prompt first (edit the field).');
  if (!aiConfigured(req.ws.id)) throw new Error('AI is not configured. Add an Anthropic API key in Settings → AI.');
  const recs = all('SELECT * FROM table_records WHERE table_id = ? ORDER BY created_at', t.id).filter((r) => !j(r.data, {})[field.id] || req.body.overwrite).slice(0, 50);
  let n = 0;
  for (const r of recs) {
    const d = j(r.data, {});
    const ctx = t.fields.filter((f) => f.id !== field.id).map((f) => `${f.name}: ${d[f.id] ?? ''}`).join('\n');
    const prompt = field.prompt.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, name) => String(d[t.fields.find((f) => f.name === name)?.id] ?? ''));
    const out = await aiText({ wsId: req.ws.id, effort: 'low', model: 'claude-haiku-5-5', prompt: `${prompt}\n\nRecord:\n${ctx}\n\nRespond with only the value.` });
    d[field.id] = out.text; run('UPDATE table_records SET data = ?, updated_at = ? WHERE id = ?', s(d), now(), r.id); n++;
  }
  res.json({ filled: n });
}));

// ---------------------------------------------------------------- Interfaces
const ifaceOut = (i) => ({ ...i, config: j(i.config, {}), published: Boolean(i.published), submissions: get('SELECT COUNT(*) c FROM submissions WHERE interface_id = ?', i.id).c });
products.get('/interfaces', (req, res) => res.json(all('SELECT * FROM interfaces WHERE workspace_id = ? ORDER BY updated_at DESC', req.ws.id).map(ifaceOut)));
products.post('/interfaces', wrap((req, res) => {
  const count = get('SELECT COUNT(*) c FROM interfaces WHERE workspace_id = ?', req.ws.id).c;
  const name = String(req.body.name || 'Untitled interface').trim();
  const kind = req.body.kind || 'form';
  const blocks = kind === 'blank' ? [{ id: uid('blk_'), type: 'heading', text: name, size: 'xl' }] : [
    { id: uid('blk_'), type: 'heading', text: name, size: 'xl' },
    { id: uid('blk_'), type: 'text', text: 'Fill out the form below.' },
    { id: uid('blk_'), type: 'form', title: 'Form', submitText: 'Submit', successMessage: 'Thanks! Your response was recorded.', fields: [
      { id: uid('ff_'), label: 'Name', type: 'text', required: true }, { id: uid('ff_'), label: 'Email', type: 'email', required: true }, { id: uid('ff_'), label: 'Message', type: 'textarea' }] },
  ];
  const id = uid('ifc_');
  run('INSERT INTO interfaces (id, workspace_id, name, slug, config, published, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)', id, req.ws.id, name, slugify(name),
    s({ theme: { primary: '#5B3DF5', background: '#F7F6FF', font: 'Inter', layout: 'centered' }, blocks, access: 'public' }), 0, now(), now());
  svc.audit(req.ws.id, req.user, 'interface.created', name);
  res.json({ id });
}));
products.get('/interfaces/:id', wrap((req, res) => {
  const i = get('SELECT * FROM interfaces WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id);
  if (!i) throw Object.assign(new Error('Interface not found'), { status: 404 });
  res.json(ifaceOut(i));
}));
products.put('/interfaces/:id', wrap((req, res) => {
  const i = get('SELECT * FROM interfaces WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id);
  if (!i) throw Object.assign(new Error('Interface not found'), { status: 404 });
  let slug = i.slug;
  if (req.body.slug && req.body.slug !== i.slug) {
    slug = String(req.body.slug).toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 60);
    if (get('SELECT 1 FROM interfaces WHERE slug = ? AND id != ?', slug, i.id)) throw new Error('That URL is already taken.');
  }
  run('UPDATE interfaces SET name = COALESCE(?, name), slug = ?, config = COALESCE(?, config), published = COALESCE(?, published), updated_at = ? WHERE id = ?',
    req.body.name ?? null, slug, req.body.config ? s(req.body.config) : null, req.body.published === undefined ? null : req.body.published ? 1 : 0, now(), i.id);
  if (req.body.published !== undefined) svc.audit(req.ws.id, req.user, req.body.published ? 'interface.published' : 'interface.unpublished', i.name);
  res.json(ifaceOut(get('SELECT * FROM interfaces WHERE id = ?', i.id)));
}));
products.delete('/interfaces/:id', wrap((req, res) => { run('DELETE FROM interfaces WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id); res.json({ ok: true }); }));
products.post('/interfaces/:id/duplicate', wrap((req, res) => {
  const i = get('SELECT * FROM interfaces WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id);
  if (!i) throw new Error('Interface not found');
  const id = uid('ifc_');
  run('INSERT INTO interfaces (id, workspace_id, name, slug, config, published, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)', id, req.ws.id, `${i.name} (copy)`, slugify(i.name), i.config, 0, now(), now());
  res.json({ id });
}));
products.get('/interfaces/:id/submissions', wrap((req, res) => {
  const i = get('SELECT id FROM interfaces WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id);
  if (!i) throw new Error('Interface not found');
  res.json(all('SELECT * FROM submissions WHERE interface_id = ? ORDER BY created_at DESC LIMIT 500', i.id).map((r) => ({ ...r, data: j(r.data, {}) })));
}));
products.delete('/interfaces/:id/submissions/:sid', wrap((req, res) => { run('DELETE FROM submissions WHERE id = ? AND interface_id IN (SELECT id FROM interfaces WHERE workspace_id = ?)', req.params.sid, req.ws.id); res.json({ ok: true }); }));

// ---------------------------------------------------------------- Chatbots
const botOut = (b) => ({ ...b, config: j(b.config, {}), published: Boolean(b.published), conversations: get('SELECT COUNT(*) c FROM conversations WHERE chatbot_id = ?', b.id).c });
products.get('/chatbots', (req, res) => res.json(all('SELECT * FROM chatbots WHERE workspace_id = ? ORDER BY updated_at DESC', req.ws.id).map(botOut)));
products.post('/chatbots', wrap((req, res) => {
  const count = get('SELECT COUNT(*) c FROM chatbots WHERE workspace_id = ?', req.ws.id).c;
  const name = String(req.body.name || 'New chatbot').trim();
  const id = uid('bot_');
  run('INSERT INTO chatbots (id, workspace_id, name, slug, config, published, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)', id, req.ws.id, name, slugify(name), s({
    greeting: 'Hi there! How can I help you today?', instructions: 'You are a helpful, concise assistant for our business.', knowledge: '', model: 'claude-haiku-5-5',
    leadCapture: false, leadTableId: '', suggested: [], flowActions: [], theme: { primary: '#5B3DF5', avatar: '💬', position: 'right' },
  }), 0, now(), now());
  svc.audit(req.ws.id, req.user, 'chatbot.created', name);
  res.json({ id });
}));
products.get('/chatbots/:id', wrap((req, res) => {
  const b = get('SELECT * FROM chatbots WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id);
  if (!b) throw Object.assign(new Error('Chatbot not found'), { status: 404 });
  res.json(botOut(b));
}));
products.put('/chatbots/:id', wrap((req, res) => {
  const b = get('SELECT * FROM chatbots WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id);
  if (!b) throw new Error('Chatbot not found');
  run('UPDATE chatbots SET name = COALESCE(?, name), config = COALESCE(?, config), published = COALESCE(?, published), updated_at = ? WHERE id = ?',
    req.body.name ?? null, req.body.config ? s(req.body.config) : null, req.body.published === undefined ? null : req.body.published ? 1 : 0, now(), b.id);
  res.json(botOut(get('SELECT * FROM chatbots WHERE id = ?', b.id)));
}));
products.delete('/chatbots/:id', wrap((req, res) => { run('DELETE FROM chatbots WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id); res.json({ ok: true }); }));
products.get('/chatbots/:id/conversations', wrap((req, res) => {
  const b = get('SELECT id FROM chatbots WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id);
  if (!b) throw new Error('Chatbot not found');
  res.json(all('SELECT * FROM conversations WHERE chatbot_id = ? ORDER BY updated_at DESC LIMIT 200', b.id).map((c) => ({ ...c, messages: j(c.messages, []) })));
}));
products.post('/chatbots/:id/preview', wrap(async (req, res) => {
  const b = get('SELECT * FROM chatbots WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id);
  if (!b) throw new Error('Chatbot not found');
  res.json(await chatbotReply(b, { conversationId: req.body.conversationId, message: req.body.message, preview: true }));
}));

// ---------------------------------------------------------------- Canvas
products.get('/canvases', (req, res) => res.json(all('SELECT id, name, created_at, updated_at, data FROM canvases WHERE workspace_id = ? ORDER BY updated_at DESC', req.ws.id)
  .map((c) => { const d = j(c.data, {}); return { ...c, data: undefined, nodes: d.nodes?.length || 0 }; })));
products.post('/canvases', wrap(async (req, res) => {
  const name = String(req.body.name || 'Untitled canvas').trim();
  let data = { nodes: [{ id: 'n1', type: 'process', position: { x: 0, y: 0 }, data: { kind: 'start', label: 'Start' } }], edges: [] };
  if (req.body.description) data = await draftCanvas(req.ws.id, req.body.description);
  const id = uid('cnv_');
  run('INSERT INTO canvases (id, workspace_id, name, data, created_at, updated_at) VALUES (?,?,?,?,?,?)', id, req.ws.id, name, s(data), now(), now());
  res.json({ id });
}));
products.get('/canvases/:id', wrap((req, res) => {
  const c = get('SELECT * FROM canvases WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id);
  if (!c) throw Object.assign(new Error('Canvas not found'), { status: 404 });
  const data = j(c.data, { nodes: [], edges: [] });
  // live status for linked flows
  for (const n of data.nodes || []) if (n.data?.flowId) { const f = get('SELECT name, status FROM flows WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL', n.data.flowId, req.ws.id); n.data.flowStatus = f?.status || 'missing'; n.data.flowName = f?.name; }
  res.json({ ...c, data });
}));
products.put('/canvases/:id', wrap((req, res) => {
  const c = get('SELECT * FROM canvases WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id);
  if (!c) throw new Error('Canvas not found');
  run('UPDATE canvases SET name = COALESCE(?, name), data = COALESCE(?, data), updated_at = ? WHERE id = ?', req.body.name ?? null, req.body.data ? s(req.body.data) : null, now(), c.id);
  res.json({ ok: true });
}));
products.delete('/canvases/:id', wrap((req, res) => { run('DELETE FROM canvases WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id); res.json({ ok: true }); }));
products.post('/canvases/generate', wrap(async (req, res) => {
  if (!req.body.description) throw new Error('Describe the process to map.');
  res.json(await draftCanvas(req.ws.id, req.body.description));
}));

// ---------------------------------------------------------------- Copilot
products.post('/copilot/flow', wrap(async (req, res) => {
  const prompt = String(req.body.prompt || '').trim();
  if (prompt.length < 5) throw new Error('Describe the workflow you want in a sentence or two.');
  const draft = await draftFlow(req.ws.id, prompt);
  if (req.body.create) {
    const id = createFlow(req.ws, req.user, { name: draft.name, description: draft.description, definition: { trigger: draft.trigger, steps: draft.steps } });
    return res.json({ ...draft, id });
  }
  res.json(draft);
}));
products.post('/copilot/chat', wrap(async (req, res) => {
  const reply = await copilotChat(req.ws.id, req.body.messages || [], req.body.context || '');
  res.json({ reply, ai: aiConfigured(req.ws.id) });
}));
