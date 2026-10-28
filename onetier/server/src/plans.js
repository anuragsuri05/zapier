import { get, run, j } from './db.js';

// OneTier is completely free: a single plan with every feature unlocked and no usage limits.
// Tasks (successful actions) are still counted, purely as an activity statistic — nothing is ever charged or blocked.
const UNLIMITED = Number.MAX_SAFE_INTEGER;

export const FREE_PLAN = {
  key: 'free', name: 'Free', tagline: 'Everything included — free forever', unlimited: true,
  users: UNLIMITED, pollMinutes: 1, maxSteps: UNLIMITED, premiumApps: true, paths: true,
  tableRecords: UNLIMITED, interfacePages: UNLIMITED, chatbots: UNLIMITED,
  codeSeconds: 120, sso: true, auditDays: 3650, folders: true, sharedWorkspace: true, autoreplay: true, versionDays: 3650,
  features: ['Unlimited flows, steps and tasks', 'Every app and built-in tool', 'Paths, loops, delays, approvals and AI steps',
    'Unlimited Tables, Interfaces and Chatbots', 'Unlimited teammates', 'MCP server, REST API and Developer platform', 'Audit log and SSO settings'],
};
export const PLANS = { free: FREE_PLAN };

export function planOf() {
  return FREE_PLAN;
}

export const period = (d = new Date()) => d.toISOString().slice(0, 7);

export function usageFor(wsId) {
  const row = get('SELECT tasks FROM usage WHERE workspace_id = ? AND period = ?', wsId, period());
  return { tasks: row?.tasks || 0 };
}

/** Records activity for statistics. Never blocks and never charges. */
export function consumeTasks(wsId, n = 1) {
  if (n > 0) {
    run(`INSERT INTO usage (workspace_id, period, tasks, overage) VALUES (?, ?, ?, 0)
         ON CONFLICT(workspace_id, period) DO UPDATE SET tasks = tasks + excluded.tasks`, wsId, period(), n);
  }
  return { ok: true };
}

export function wsSettings(ws) {
  return j(ws.settings, {});
}

/** Move any workspace created under the old paid plans onto the free plan. */
export function migrateToFree() {
  run("UPDATE workspaces SET plan = 'free', task_tier = 0, billing_cycle = 'free', pay_per_task = 0, trial_ends_at = NULL WHERE plan != 'free' OR trial_ends_at IS NOT NULL OR pay_per_task != 0");
}
