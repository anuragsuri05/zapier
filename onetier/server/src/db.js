import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.ONETIER_DATA_DIR || path.join(here, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(process.env.ONETIER_DB || path.join(DATA_DIR, 'onetier.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, avatar_color TEXT, prefs TEXT DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'free',
  task_tier INTEGER NOT NULL DEFAULT 100, billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  pay_per_task INTEGER NOT NULL DEFAULT 0, settings TEXT DEFAULT '{}',
  trial_ends_at TEXT, owner_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member', created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL, role TEXT NOT NULL, token TEXT UNIQUE NOT NULL, invited_by TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS flows (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  folder_id TEXT, name TEXT NOT NULL, description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft', definition TEXT NOT NULL, published TEXT,
  version INTEGER NOT NULL DEFAULT 0, settings TEXT DEFAULT '{}', trigger_state TEXT DEFAULT '{}',
  hook_secret TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  last_run_at TEXT, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS flow_versions (
  id TEXT PRIMARY KEY, flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  version INTEGER NOT NULL, definition TEXT NOT NULL, note TEXT, created_by TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, flow_id TEXT, flow_name TEXT,
  source TEXT NOT NULL DEFAULT 'trigger', status TEXT NOT NULL, trigger_data TEXT,
  state TEXT, tasks_used INTEGER NOT NULL DEFAULT 0, error TEXT, version INTEGER,
  replay_of TEXT, started_at TEXT NOT NULL, finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_ws ON runs(workspace_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_flow ON runs(flow_id, started_at DESC);
CREATE TABLE IF NOT EXISTS run_steps (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL, seq INTEGER NOT NULL, app TEXT, action TEXT, title TEXT,
  status TEXT NOT NULL, input TEXT, output TEXT, error TEXT, attempts INTEGER DEFAULT 1,
  billable INTEGER DEFAULT 0, started_at TEXT NOT NULL, finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_run_steps ON run_steps(run_id, seq);
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  app TEXT NOT NULL, name TEXT NOT NULL, credentials TEXT NOT NULL, status TEXT DEFAULT 'ok',
  shared INTEGER DEFAULT 1, created_by TEXT, created_at TEXT NOT NULL, last_tested_at TEXT
);
CREATE TABLE IF NOT EXISTS tables_ (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description TEXT DEFAULT '', fields TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS table_records (
  id TEXT PRIMARY KEY, table_id TEXT NOT NULL REFERENCES tables_(id) ON DELETE CASCADE,
  data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_records ON table_records(table_id, created_at);
CREATE TABLE IF NOT EXISTS interfaces (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, config TEXT NOT NULL, published INTEGER DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY, interface_id TEXT NOT NULL REFERENCES interfaces(id) ON DELETE CASCADE,
  block_id TEXT, data TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chatbots (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, config TEXT NOT NULL, published INTEGER DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, chatbot_id TEXT NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
  visitor TEXT, messages TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS canvases (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
  workspace_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, key)
);
CREATE TABLE IF NOT EXISTS digests (
  flow_id TEXT NOT NULL, step_id TEXT NOT NULL, items TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL,
  PRIMARY KEY (flow_id, step_id)
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, run_id TEXT, resume_at TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, run_id TEXT NOT NULL, flow_id TEXT, step_id TEXT NOT NULL,
  title TEXT, details TEXT, status TEXT NOT NULL DEFAULT 'pending', decided_by TEXT, comment TEXT,
  created_at TEXT NOT NULL, decided_at TEXT
);
CREATE TABLE IF NOT EXISTS usage (
  workspace_id TEXT NOT NULL, period TEXT NOT NULL, tasks INTEGER NOT NULL DEFAULT 0, overage INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, period)
);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, amount REAL NOT NULL, description TEXT, status TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, user_id TEXT, user_name TEXT, action TEXT NOT NULL,
  target TEXT, meta TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit ON audit_logs(workspace_id, created_at DESC);
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL, prefix TEXT NOT NULL, key_hash TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL, last_used_at TEXT
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, user_id TEXT, type TEXT, title TEXT NOT NULL,
  body TEXT, link TEXT, read INTEGER DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mailbox (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, to_addr TEXT, from_name TEXT, subject TEXT, body TEXT,
  html INTEGER DEFAULT 0, run_id TEXT, read INTEGER DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS custom_apps (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key TEXT NOT NULL, name TEXT NOT NULL, description TEXT, color TEXT, base_url TEXT,
  auth TEXT NOT NULL, operations TEXT NOT NULL, version TEXT DEFAULT '1.0.0', status TEXT DEFAULT 'private',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (workspace_id, key)
);
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL, token TEXT UNIQUE NOT NULL, tools TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, last_used_at TEXT
);
`);

export const now = () => new Date().toISOString();
export const uid = (prefix = '') => prefix + crypto.randomBytes(9).toString('base64url');
export const j = (v, fallback = null) => {
  if (v == null) return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
};
export const s = (v) => JSON.stringify(v ?? null);

export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// --- secrets: credentials are encrypted at rest with a per-install key ---
const keyFile = path.join(DATA_DIR, '.secret');
if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = Buffer.from(process.env.ONETIER_SECRET || fs.readFileSync(keyFile, 'utf8').trim(), 'hex');
export const SERVER_SECRET = SECRET;

export function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', SECRET, iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}
export function decrypt(str) {
  try {
    const [iv, tag, data] = str.split('.').map((b) => Buffer.from(b, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', SECRET, iv);
    d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString('utf8'));
  } catch { return {}; }
}
