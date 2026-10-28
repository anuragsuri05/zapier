import { Router } from 'express';
import crypto from 'node:crypto';
import { get, all, run, uid, now, j, s, tx, encrypt } from '../db.js';
import { hashPassword, verifyPassword, createSession, setSessionCookie, authenticate, requireRole, mePayload, pickColor } from '../auth.js';
import { usageFor, period } from '../plans.js';
import { audit } from '../services.js';
import { seedWorkspace } from '../seed.js';

export const publicAuth = Router();
export const core = Router();

const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');

function createWorkspace(userId, name) {
  const id = uid('ws_');
  // Every workspace is on the free plan with everything unlocked.
  run('INSERT INTO workspaces (id, name, plan, task_tier, billing_cycle, owner_id, settings, created_at) VALUES (?,?,?,?,?,?,?,?)',
    id, name, 'free', 0, 'free', userId, s({ notifyOnError: true, timezone: 'UTC' }), now());
  run('INSERT INTO members (workspace_id, user_id, role, created_at) VALUES (?,?,?,?)', id, userId, 'owner', now());
  return id;
}

// ---------------------------------------------------------------- auth (public)
publicAuth.post('/auth/signup', (req, res) => {
  const { name, email, password, workspaceName, inviteToken } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!emailOk(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (get('SELECT id FROM users WHERE email = ?', email.toLowerCase())) return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' });
  const result = tx(() => {
    const userId = uid('usr_');
    run('INSERT INTO users (id, email, name, password_hash, avatar_color, created_at) VALUES (?,?,?,?,?,?)', userId, email.toLowerCase(), name.trim(), hashPassword(password), pickColor(), now());
    let wsId;
    const invite = inviteToken ? get('SELECT * FROM invites WHERE token = ?', inviteToken) : null;
    if (invite) {
      wsId = invite.workspace_id;
      run('INSERT INTO members (workspace_id, user_id, role, created_at) VALUES (?,?,?,?)', wsId, userId, invite.role, now());
      run('DELETE FROM invites WHERE id = ?', invite.id);
    } else {
      wsId = createWorkspace(userId, workspaceName?.trim() || `${name.trim().split(' ')[0]}'s workspace`);
    }
    return { userId, wsId, invited: Boolean(invite) };
  });
  if (!result.invited) seedWorkspace(result.wsId, result.userId);
  const token = createSession(result.userId, result.wsId);
  setSessionCookie(res, token);
  audit(result.wsId, { id: result.userId, name }, result.invited ? 'member.joined' : 'account.created', email);
  res.json({ ok: true, token });
});

publicAuth.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = get('SELECT * FROM users WHERE email = ?', String(email || '').toLowerCase());
  if (!u || !verifyPassword(password || '', u.password_hash)) return res.status(401).json({ error: 'Incorrect email or password' });
  const m = get('SELECT * FROM members WHERE user_id = ? ORDER BY created_at LIMIT 1', u.id);
  if (!m) return res.status(403).json({ error: 'This account has no workspace' });
  const token = createSession(u.id, m.workspace_id);
  setSessionCookie(res, token);
  audit(m.workspace_id, u, 'user.login', u.email);
  res.json({ ok: true, token });
});

publicAuth.get('/invites/:token', (req, res) => {
  const inv = get('SELECT i.*, w.name AS workspace_name FROM invites i JOIN workspaces w ON w.id = i.workspace_id WHERE i.token = ?', req.params.token);
  if (!inv) return res.status(404).json({ error: 'This invite link is invalid or was already used.' });
  res.json({ email: inv.email, role: inv.role, workspace: inv.workspace_name });
});

// ---------------------------------------------------------------- session-protected
core.use(authenticate);

core.post('/auth/logout', (req, res) => {
  run('DELETE FROM sessions WHERE token = ?', req.sessionToken);
  res.clearCookie('ot_session', { path: '/' });
  res.json({ ok: true });
});
core.get('/auth/me', (req, res) => res.json(mePayload(req)));
core.post('/auth/switch', (req, res) => {
  const m = get('SELECT * FROM members WHERE workspace_id = ? AND user_id = ?', req.body.workspaceId, req.user.id);
  if (!m) return res.status(403).json({ error: 'Not a member of that workspace' });
  run('UPDATE sessions SET workspace_id = ? WHERE token = ?', req.body.workspaceId, req.sessionToken);
  res.json({ ok: true });
});
core.patch('/auth/profile', (req, res) => {
  const { name, prefs, avatar_color } = req.body || {};
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'Name cannot be empty' });
  run('UPDATE users SET name = COALESCE(?, name), prefs = COALESCE(?, prefs), avatar_color = COALESCE(?, avatar_color) WHERE id = ?',
    name?.trim() ?? null, prefs ? s({ ...req.user.prefs, ...prefs }) : null, avatar_color ?? null, req.user.id);
  res.json({ ok: true });
});
core.post('/auth/password', (req, res) => {
  const u = get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!verifyPassword(req.body.current || '', u.password_hash)) return res.status(400).json({ error: 'Current password is incorrect' });
  if (!req.body.next || req.body.next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(req.body.next), u.id);
  run('DELETE FROM sessions WHERE user_id = ? AND token != ?', u.id, req.sessionToken);
  audit(req.ws.id, req.user, 'user.password_changed');
  res.json({ ok: true });
});
core.post('/auth/sessions/revoke-others', (req, res) => {
  const r = run('DELETE FROM sessions WHERE user_id = ? AND token != ?', req.user.id, req.sessionToken);
  res.json({ ok: true, revoked: r.changes });
});
core.post('/invites/:token/accept', (req, res) => {
  const inv = get('SELECT * FROM invites WHERE token = ?', req.params.token);
  if (!inv) return res.status(404).json({ error: 'Invite not found' });
  if (!get('SELECT 1 FROM members WHERE workspace_id = ? AND user_id = ?', inv.workspace_id, req.user.id))
    run('INSERT INTO members (workspace_id, user_id, role, created_at) VALUES (?,?,?,?)', inv.workspace_id, req.user.id, inv.role, now());
  run('DELETE FROM invites WHERE id = ?', inv.id);
  run('UPDATE sessions SET workspace_id = ? WHERE token = ?', inv.workspace_id, req.sessionToken);
  audit(inv.workspace_id, req.user, 'member.joined', req.user.email);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- workspace
core.post('/workspaces', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Workspace name is required' });
  const id = createWorkspace(req.user.id, name);
  seedWorkspace(id, req.user.id, { minimal: true });
  run('UPDATE sessions SET workspace_id = ? WHERE token = ?', id, req.sessionToken);
  res.json({ id });
});
core.patch('/workspace', requireRole('admin'), (req, res) => {
  const { name, settings = {} } = req.body || {};
  const cur = j(req.ws.settings, {});
  const next = { ...cur, ...settings };
  if (settings.anthropicKey !== undefined) {
    if (settings.anthropicKey) next.anthropicKey = encrypt({ key: settings.anthropicKey });
    else delete next.anthropicKey;
  }
  if (settings.openaiKey !== undefined) {
    if (settings.openaiKey) next.openaiKey = encrypt({ key: settings.openaiKey });
    else delete next.openaiKey;
  }
  delete next.aiConfigured;
  run('UPDATE workspaces SET name = COALESCE(?, name), settings = ? WHERE id = ?', name?.trim() || null, s(next), req.ws.id);
  audit(req.ws.id, req.user, 'workspace.updated', name || '', { keys: Object.keys(settings).map((k) => (/Key$/.test(k) ? `${k}(redacted)` : k)) });
  res.json({ ok: true });
});
core.delete('/workspace', requireRole('owner'), (req, res) => {
  if (req.body?.confirm !== req.ws.name) return res.status(400).json({ error: 'Type the workspace name to confirm deletion.' });
  const other = get('SELECT workspace_id FROM members WHERE user_id = ? AND workspace_id != ? LIMIT 1', req.user.id, req.ws.id);
  run('DELETE FROM workspaces WHERE id = ?', req.ws.id);
  for (const t of ['runs', 'audit_logs', 'notifications', 'mailbox', 'approvals', 'usage', 'invoices', 'kv']) run(`DELETE FROM ${t} WHERE workspace_id = ?`, req.ws.id);
  if (other) run('UPDATE sessions SET workspace_id = ? WHERE token = ?', other.workspace_id, req.sessionToken);
  else {
    const id = createWorkspace(req.user.id, `${req.user.name.split(' ')[0]}'s workspace`);
    run('UPDATE sessions SET workspace_id = ? WHERE token = ?', id, req.sessionToken);
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------- members
core.get('/workspace/members', (req, res) => {
  const members = all('SELECT u.id, u.name, u.email, u.avatar_color, m.role, m.created_at FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY m.created_at', req.ws.id);
  const invites = all('SELECT id, email, role, token, created_at FROM invites WHERE workspace_id = ? ORDER BY created_at DESC', req.ws.id);
  res.json({ members, invites, seats: null });
});
core.post('/workspace/invites', requireRole('admin'), (req, res) => {
  const { email, role = 'member' } = req.body || {};
  if (!emailOk(email)) return res.status(400).json({ error: 'Enter a valid email' });
  if (!['member', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const token = crypto.randomBytes(18).toString('base64url');
  run('INSERT INTO invites (id, workspace_id, email, role, token, invited_by, created_at) VALUES (?,?,?,?,?,?,?)', uid('inv_'), req.ws.id, email.toLowerCase(), role, token, req.user.id, now());
  audit(req.ws.id, req.user, 'member.invited', email, { role });
  res.json({ ok: true, token, url: `/invite/${token}` });
});
core.delete('/workspace/invites/:id', requireRole('admin'), (req, res) => {
  run('DELETE FROM invites WHERE id = ? AND workspace_id = ?', req.params.id, req.ws.id);
  res.json({ ok: true });
});
core.patch('/workspace/members/:userId', requireRole('admin'), (req, res) => {
  const { role } = req.body || {};
  if (!['member', 'admin', 'owner'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (role === 'owner' && req.role !== 'owner') return res.status(403).json({ error: 'Only the owner can transfer ownership' });
  const target = get('SELECT * FROM members WHERE workspace_id = ? AND user_id = ?', req.ws.id, req.params.userId);
  if (!target) return res.status(404).json({ error: 'Member not found' });
  if (target.role === 'owner' && role !== 'owner') {
    const owners = get("SELECT COUNT(*) c FROM members WHERE workspace_id = ? AND role = 'owner'", req.ws.id).c;
    if (owners <= 1) return res.status(400).json({ error: 'A workspace needs at least one owner' });
  }
  run('UPDATE members SET role = ? WHERE workspace_id = ? AND user_id = ?', role, req.ws.id, req.params.userId);
  audit(req.ws.id, req.user, 'member.role_changed', req.params.userId, { role });
  res.json({ ok: true });
});
core.delete('/workspace/members/:userId', (req, res) => {
  const self = req.params.userId === req.user.id;
  if (!self && !['admin', 'owner'].includes(req.role)) return res.status(403).json({ error: 'Only admins can remove members' });
  const target = get('SELECT * FROM members WHERE workspace_id = ? AND user_id = ?', req.ws.id, req.params.userId);
  if (!target) return res.status(404).json({ error: 'Member not found' });
  if (target.role === 'owner' && get("SELECT COUNT(*) c FROM members WHERE workspace_id = ? AND role = 'owner'", req.ws.id).c <= 1)
    return res.status(400).json({ error: 'Transfer ownership before removing the only owner' });
  run('DELETE FROM members WHERE workspace_id = ? AND user_id = ?', req.ws.id, req.params.userId);
  audit(req.ws.id, req.user, self ? 'member.left' : 'member.removed', req.params.userId);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- usage (activity stats — OneTier is free, nothing is billed)
core.get('/usage', (req, res) => {
  const p = period();
  const daily = all(`SELECT substr(started_at, 1, 10) AS day, SUM(tasks_used) AS tasks, COUNT(*) AS runs,
    SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors FROM runs WHERE workspace_id = ? AND substr(started_at, 1, 7) = ? GROUP BY day ORDER BY day`, req.ws.id, p);
  const byFlow = all(`SELECT flow_id, flow_name, SUM(tasks_used) AS tasks, COUNT(*) AS runs FROM runs WHERE workspace_id = ? AND substr(started_at, 1, 7) = ?
    GROUP BY COALESCE(flow_id, flow_name) ORDER BY tasks DESC LIMIT 15`, req.ws.id, p);
  const bySource = all(`SELECT source, SUM(tasks_used) AS tasks, COUNT(*) AS runs FROM runs WHERE workspace_id = ? AND substr(started_at, 1, 7) = ? GROUP BY source`, req.ws.id, p);
  const history = all('SELECT period, tasks FROM usage WHERE workspace_id = ? ORDER BY period DESC LIMIT 12', req.ws.id);
  res.json({ period: p, ...usageFor(req.ws.id), daily, byFlow, bySource, history });
});
