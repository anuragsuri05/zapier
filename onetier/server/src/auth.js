import crypto from 'node:crypto';
import { get, all, run, uid, now, j } from './db.js';
import { usageFor, planOf } from './plans.js';
import { aiConfigured } from './ai.js';

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

export function createSession(userId, workspaceId) {
  const token = crypto.randomBytes(32).toString('base64url');
  run('INSERT INTO sessions (token, user_id, workspace_id, created_at) VALUES (?,?,?,?)', token, userId, workspaceId, now());
  return token;
}

export function setSessionCookie(res, token) {
  res.cookie('ot_session', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 864e5, path: '/' });
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((c) => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

const ROLE_RANK = { member: 1, admin: 2, owner: 3 };

/** Loads req.user / req.ws / req.role from the session cookie or Bearer session token. */
export function authenticate(req, res, next) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const token = parseCookies(req.headers.cookie).ot_session || (bearer && !bearer.startsWith('ot_') ? bearer : null);
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  const sess = get('SELECT * FROM sessions WHERE token = ?', token);
  if (!sess) return res.status(401).json({ error: 'Session expired' });
  const user = get('SELECT id, email, name, avatar_color, prefs, created_at FROM users WHERE id = ?', sess.user_id);
  let m = get('SELECT * FROM members WHERE workspace_id = ? AND user_id = ?', sess.workspace_id, sess.user_id);
  if (!m) {
    m = get('SELECT * FROM members WHERE user_id = ? ORDER BY created_at LIMIT 1', sess.user_id);
    if (!m) return res.status(403).json({ error: 'You no longer belong to any workspace' });
    run('UPDATE sessions SET workspace_id = ? WHERE token = ?', m.workspace_id, token);
  }
  req.user = { ...user, prefs: j(user.prefs, {}) };
  req.ws = get('SELECT * FROM workspaces WHERE id = ?', m.workspace_id);
  req.role = m.role;
  req.sessionToken = token;
  next();
}

export const requireRole = (role) => (req, res, next) =>
  ROLE_RANK[req.role] >= ROLE_RANK[role] ? next() : res.status(403).json({ error: `Only workspace ${role}s can do this.` });

/** API-key auth for the public REST API. */
export function apiKeyAuth(req, res, next) {
  const key = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.headers['x-api-key'];
  if (!key || !String(key).startsWith('ot_')) return res.status(401).json({ error: 'Missing API key. Send "Authorization: Bearer ot_…".' });
  const row = get('SELECT * FROM api_keys WHERE key_hash = ?', sha256(key));
  if (!row) return res.status(401).json({ error: 'Invalid API key' });
  run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', now(), row.id);
  req.ws = get('SELECT * FROM workspaces WHERE id = ?', row.workspace_id);
  req.user = { id: row.created_by, name: `API key: ${row.name}` };
  req.role = 'admin';
  next();
}

export function mePayload(req) {
  const workspaces = all('SELECT w.id, w.name, w.plan, m.role FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? ORDER BY w.created_at', req.user.id);
  const ws = req.ws;
  const settings = j(ws.settings, {});
  return {
    user: req.user,
    role: req.role,
    workspace: { id: ws.id, name: ws.name, plan: 'free', settings: { ...(['admin', 'owner'].includes(req.role) ? settings : { timezone: settings.timezone, notifyOnError: settings.notifyOnError, sso: settings.sso ? { enforced: settings.sso.enforced } : undefined }), anthropicKey: undefined, openaiKey: undefined, aiConfigured: aiConfigured(ws.id) }, created_at: ws.created_at },
    plan: planOf(ws),
    usage: usageFor(ws.id),
    workspaces,
  };
}

export const COLORS = ['#5B3DF5', '#E8590C', '#0CA678', '#1971C2', '#C2255C', '#7048E8', '#2F9E44', '#F08C00'];
export const pickColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];
export const newId = uid;
