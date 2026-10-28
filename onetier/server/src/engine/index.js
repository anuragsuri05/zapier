import { get, all, run, uid, now, j, s, decrypt } from '../db.js';
import { getApp } from '../apps/registry.js';
import { render, evaluateConditions } from './template.js';
import { planOf, consumeTasks } from '../plans.js';
import * as svc from '../services.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const INLINE_DELAY_MS = 5000;
const MAX_DEPTH = 5;

class Stop extends Error { constructor(status, message) { super(message); this.stopStatus = status; } }

export function countSteps(steps = []) {
  let n = 0;
  for (const st of steps) {
    n += 1;
    if (st.app === 'paths') for (const p of st.paths || []) n += countSteps(p.steps);
    if (st.app === 'looping') n += countSteps(st.steps);
  }
  return n;
}

function loadCreds(wsId, connectionId) {
  if (!connectionId) return { creds: {}, raw: null };
  const c = get('SELECT * FROM connections WHERE id = ? AND workspace_id = ?', connectionId, wsId);
  if (!c) throw new Error('The connected account for this step was removed. Reconnect it in the editor.');
  return { creds: decrypt(c.credentials), raw: c.credentials };
}

function stepTitle(step, app, act) {
  return step.title || `${app?.name || step.app} · ${act?.name || step.action}`;
}

function insertStep(runId, seq, step, title, input) {
  const id = uid('rs_');
  run('INSERT INTO run_steps (id, run_id, step_id, seq, app, action, title, status, input, started_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    id, runId, step.id, seq, step.app, step.action, title, 'running', s(input), now());
  return id;
}
function finishStep(id, status, { output, error, attempts = 1, billable = 0 } = {}) {
  run('UPDATE run_steps SET status = ?, output = ?, error = ?, attempts = ?, billable = ?, finished_at = ? WHERE id = ?',
    status, output === undefined ? null : s(output), error || null, attempts, billable, now(), id);
}

/** Execute one action of an app (no control-flow), with retries and task billing. */
async function executeAction({ ws, step, app, act, params, ctx, retry }) {
  const { creds, raw } = app.auth ? loadCreds(ws.id, step.connectionId) : { creds: {}, raw: null };
  if (app.auth && !step.connectionId) throw new Error(`Connect a ${app.name} account for this step.`);
  for (const f of act.fields || []) {
    const v = params[f.key];
    if (f.required && (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length))) throw new Error(`Required field "${f.label}" is empty.`);
  }
  // Tasks are counted for activity stats only — OneTier is free and never limits or charges.
  const counted = !ctx.testMode && act.billable !== false;
  const attemptsMax = retry ? 3 : 1;
  let lastErr;
  for (let attempt = 1; attempt <= attemptsMax; attempt++) {
    try {
      const output = await act.run({ params, creds, ctx: { ...ctx.public, rawCreds: raw, stepId: step.id } });
      if (counted) consumeTasks(ws.id, 1);
      return { output: output ?? {}, attempts: attempt, charged: counted ? 1 : 0 };
    } catch (e) {
      if (e instanceof Stop) throw e;
      lastErr = e;
      const retryable = !e.status || e.status >= 500 || e.status === 429 || e.status === 0;
      if (attempt < attemptsMax && retryable) await sleep(attempt * 1000);
      else break;
    }
  }
  lastErr.attempts = attemptsMax;
  throw lastErr;
}

function toList(v) {
  if (Array.isArray(v)) return v;
  if (v == null || v === '') return [];
  if (typeof v === 'string') { try { const p = JSON.parse(v); if (Array.isArray(p)) return p; } catch { /* not json */ } return v.split(',').map((x) => x.trim()).filter(Boolean); }
  if (typeof v === 'object') return Object.entries(v).map(([key, value]) => ({ key, value }));
  return [v];
}

/** Walk a list of steps. Returns normally, or throws Stop / pauses via ctx.pause. */
async function runSteps(steps, ctx, { topLevel = false, startIndex = 0 } = {}) {
  const { ws } = ctx;
  for (let i = startIndex; i < steps.length; i++) {
    const step = steps[i];
    if (step.disabled) continue;
    const app = getApp(step.app, ws.id);
    if (!app) throw new Stop('error', `Unknown app "${step.app}" in step ${i + 1}.`);
    const act = app.actions?.[step.action];
    if (!act) throw new Stop('error', `Unknown action "${step.action}" for ${app.name}.`);
    const title = stepTitle(step, app, act) + (ctx.vars.loop ? ` (item ${ctx.vars.loop.iteration})` : '');
    const params = render(step.params || {}, ctx);
    const seq = ++ctx.seq;
    const rsId = insertStep(ctx.runId, seq, step, title, params);

    try {
      switch (step.app) {
        case 'filter': {
          const r = evaluateConditions(step.params?.conditions, ctx);
          ctx.steps[step.id] = { passed: r.passed };
          finishStep(rsId, r.passed ? 'success' : 'filtered', { output: r });
          if (!r.passed) throw new Stop('filtered', `Stopped by filter in step ${seq}: conditions not met.`);
          break;
        }
        case 'paths': {
          const matched = [];
          const branches = step.paths || [];
          const regular = branches.filter((p) => !p.fallback);
          for (const p of regular) if (evaluateConditions(p.conditions, ctx).passed) matched.push(p);
          if (!matched.length) matched.push(...branches.filter((p) => p.fallback));
          ctx.steps[step.id] = { matched: matched.map((p) => p.name) };
          finishStep(rsId, 'success', { output: { matched: matched.map((p) => p.name), evaluated: regular.length } });
          for (const p of matched) {
            try { await runSteps(p.steps || [], ctx); } catch (e) { if (e instanceof Stop && e.stopStatus === 'filtered') continue; throw e; }
          }
          break;
        }
        case 'looping': {
          const items = toList(params.items).slice(0, Math.max(1, Number(params.maxIterations) || 100));
          const prevLoop = ctx.vars.loop;
          finishStep(rsId, 'success', { output: { iterations: items.length, items } });
          for (let k = 0; k < items.length; k++) {
            ctx.vars.loop = { item: items[k], index: k, iteration: k + 1, total: items.length, is_last: k === items.length - 1 };
            try { await runSteps(step.steps || [], ctx); } catch (e) { if (e instanceof Stop && e.stopStatus === 'filtered') continue; throw e; }
          }
          ctx.vars.loop = prevLoop;
          ctx.steps[step.id] = { iterations: items.length, items };
          break;
        }
        case 'delay': {
          let ms;
          if (step.action === 'until') { const t = new Date(params.until).getTime(); if (isNaN(t)) throw new Error(`Invalid date "${params.until}"`); ms = t - Date.now(); }
          else ms = Number(params.amount || 0) * ({ seconds: 1e3, minutes: 6e4, hours: 36e5, days: 864e5, weeks: 6048e5 }[params.unit] || 6e4);
          ms = Math.max(0, ms);
          const resumeAt = new Date(Date.now() + ms).toISOString();
          if (ctx.testMode) { ctx.steps[step.id] = { resumed_at: resumeAt, skipped_in_test: true }; finishStep(rsId, 'success', { output: ctx.steps[step.id] }); break; }
          if (ms <= INLINE_DELAY_MS) { await sleep(ms); ctx.steps[step.id] = { resumed_at: now() }; finishStep(rsId, 'success', { output: ctx.steps[step.id] }); break; }
          if (!topLevel) throw new Error('Delays longer than 5 seconds must be top-level steps (not inside Paths or Loops).');
          ctx.steps[step.id] = { resumed_at: resumeAt };
          finishStep(rsId, 'waiting', { output: { resume_at: resumeAt } });
          run('INSERT INTO jobs (id, kind, run_id, resume_at, payload, created_at) VALUES (?,?,?,?,?,?)', uid('job_'), 'resume', ctx.runId, resumeAt, s({ index: i + 1, stepRowId: rsId }), now());
          ctx.pause = { index: i + 1, reason: `Delayed until ${resumeAt}` };
          return;
        }
        case 'approval': {
          if (ctx.testMode) { ctx.steps[step.id] = { status: 'approved', decided_by: 'Test', comment: 'Auto-approved in test' }; finishStep(rsId, 'success', { output: ctx.steps[step.id] }); break; }
          if (!topLevel) throw new Error('Approval steps must be top-level steps.');
          const apId = uid('apr_');
          run('INSERT INTO approvals (id, workspace_id, run_id, flow_id, step_id, title, details, created_at) VALUES (?,?,?,?,?,?,?,?)',
            apId, ws.id, ctx.runId, ctx.flowId, step.id, params.title || 'Approval requested', typeof params.details === 'string' ? params.details : JSON.stringify(params.details ?? ''), now());
          const hours = Number(params.timeoutHours) || 72;
          run('INSERT INTO jobs (id, kind, run_id, resume_at, payload, created_at) VALUES (?,?,?,?,?,?)', uid('job_'), 'approval_timeout', ctx.runId, new Date(Date.now() + hours * 36e5).toISOString(), s({ approvalId: apId }), now());
          finishStep(rsId, 'waiting', { output: { approval_id: apId, status: 'pending' } });
          svc.notify(ws.id, { type: 'approval', title: `Approval needed: ${params.title || 'Review request'}`, body: `Flow "${ctx.flowName}" is waiting for your decision.`, link: '/approvals' });
          ctx.pause = { index: i + 1, reason: 'Waiting for approval', approvalId: apId, stepRowId: rsId };
          return;
        }
        case 'digest': {
          const flowKey = ctx.flowId || 'adhoc';
          const row = get('SELECT items FROM digests WHERE flow_id = ? AND step_id = ?', flowKey, step.id);
          const items = [...j(row?.items, []), params.entry];
          const n = Math.max(1, Number(params.releaseCount) || 5);
          if (ctx.testMode || items.length >= n) {
            run('INSERT INTO digests (flow_id, step_id, items, updated_at) VALUES (?,?,?,?) ON CONFLICT(flow_id, step_id) DO UPDATE SET items = excluded.items, updated_at = excluded.updated_at', flowKey, step.id, '[]', now());
            const sep = String(params.separator ?? '\\n').replace(/\\n/g, '\n');
            ctx.steps[step.id] = { released: true, count: items.length, entries: items, digest: items.join(sep) };
            finishStep(rsId, 'success', { output: ctx.steps[step.id] });
          } else {
            run('INSERT INTO digests (flow_id, step_id, items, updated_at) VALUES (?,?,?,?) ON CONFLICT(flow_id, step_id) DO UPDATE SET items = excluded.items, updated_at = excluded.updated_at', flowKey, step.id, s(items), now());
            finishStep(rsId, 'filtered', { output: { released: false, count: items.length, release_at: n } });
            throw new Stop('filtered', `Digest collected ${items.length}/${n} entries — not released yet.`);
          }
          break;
        }
        default: {
          const retry = ctx.flowSettings.autoreplay ?? planOf(ws).autoreplay;
          try {
            const r = await executeAction({ ws, step, app, act, params, ctx, retry });
            ctx.steps[step.id] = r.output;
            ctx.tasks += r.charged;
            finishStep(rsId, 'success', { output: r.output, attempts: r.attempts, billable: r.charged });
          } catch (e) {
            if (e instanceof Stop) throw e;
            if (step.onError === 'continue') {
              ctx.steps[step.id] = { error: e.message };
              finishStep(rsId, 'error', { error: e.message, attempts: e.attempts || 1, output: { error: e.message, continued: true } });
              ctx.softErrors.push(`Step ${seq}: ${e.message}`);
              break;
            }
            throw e;
          }
        }
      }
    } catch (e) {
      // Nested steps (inside Paths/Loops) record themselves; only close this step's row if still open.
      const cur = get('SELECT status FROM run_steps WHERE id = ?', rsId);
      if (cur?.status === 'running') {
        const st = e instanceof Stop ? (e.stopStatus === 'filtered' ? 'filtered' : e.stopStatus === 'halted' ? 'halted' : 'error') : 'error';
        finishStep(rsId, st, { error: e.message, attempts: e.attempts || 1 });
      }
      throw e;
    }
  }
}

function finalizeRun(ctx, status, error = null) {
  run('UPDATE runs SET status = ?, error = ?, tasks_used = tasks_used + ?, state = ?, finished_at = ? WHERE id = ?',
    status, error, ctx.tasks, s({ steps: ctx.steps, vars: ctx.vars, seq: ctx.seq, returnValue: ctx.returnValue }), status === 'waiting' ? null : now(), ctx.runId);
  ctx.tasks = 0;
  if (!ctx.flowId || ctx.testMode) return;
  const flow = get('SELECT * FROM flows WHERE id = ?', ctx.flowId);
  if (!flow) return;
  const st = j(flow.trigger_state, {});
  if (status === 'error') {
    st.consecutiveErrors = (st.consecutiveErrors || 0) + 1;
    const settings = j(flow.settings, {});
    if (settings.notifyOnError !== false) svc.notify(ctx.ws.id, { type: 'error', title: `Flow error: ${flow.name}`, body: error || 'A step failed.', link: `/history/${ctx.runId}` });
    if (st.consecutiveErrors >= (settings.autoOffAfter || 10) && flow.status === 'on') {
      run("UPDATE flows SET status = 'off' WHERE id = ?", flow.id);
      svc.notify(ctx.ws.id, { type: 'error', title: `Flow turned off: ${flow.name}`, body: `It failed ${st.consecutiveErrors} times in a row. Fix the error and turn it back on.`, link: `/flows/${flow.id}` });
    }
  } else if (status === 'success') st.consecutiveErrors = 0;
  run('UPDATE flows SET trigger_state = ?, last_run_at = ? WHERE id = ?', s(st), now(), flow.id);
}

function buildCtx({ ws, flow, runId, triggerData, testMode, depth, state, source }) {
  const ctx = {
    ws, runId, flowId: flow?.id || null, flowName: flow?.name || 'Ad-hoc', testMode: Boolean(testMode), depth: depth || 0, source,
    flowSettings: j(flow?.settings, {}), steps: state?.steps || { trigger: triggerData }, vars: state?.vars || {}, seq: state?.seq || 0,
    tasks: 0, softErrors: [], returnValue: state?.returnValue ?? null, pause: null,
  };
  ctx.public = {
    wsId: ws.id, flowId: ctx.flowId, runId, depth: ctx.depth, plan: planOf(ws),
    setReturn: (v) => { ctx.returnValue = v; },
    services: {
      callFlow: (flowId, data, opts) => callFlow(ws.id, flowId, data, { ...opts, testMode: ctx.testMode }),
      buildAgentTools: (tools) => buildAgentTools(ws, tools, ctx),
    },
  };
  return ctx;
}

async function drive(ctx, steps, startIndex) {
  try {
    await runSteps(steps, ctx, { topLevel: true, startIndex });
    if (ctx.pause) { finalizeRun(ctx, 'waiting', ctx.pause.reason); return { runId: ctx.runId, status: 'waiting', message: ctx.pause.reason }; }
    const status = 'success';
    finalizeRun(ctx, status, ctx.softErrors.length ? ctx.softErrors.join('; ') : null);
    return { runId: ctx.runId, status, returnValue: ctx.returnValue, steps: ctx.steps };
  } catch (e) {
    const status = e instanceof Stop ? e.stopStatus : 'error';
    finalizeRun(ctx, status, e.message);
    return { runId: ctx.runId, status, error: e.message, steps: ctx.steps };
  }
}

/**
 * Start a run of a flow.
 * opts: { definition, source, testMode, replayOf, depth, untilStepId }
 */
export async function executeFlow(flow, triggerData, opts = {}) {
  const ws = get('SELECT * FROM workspaces WHERE id = ?', flow.workspace_id);
  const def = opts.definition || j(flow.published) || j(flow.definition);
  const runId = uid('run_');
  run('INSERT INTO runs (id, workspace_id, flow_id, flow_name, source, status, trigger_data, version, replay_of, started_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    runId, ws.id, flow.id, flow.name, opts.testMode ? 'test' : opts.source || 'trigger', 'running', s(triggerData), flow.version, opts.replayOf || null, now());
  const ctx = buildCtx({ ws, flow, runId, triggerData, testMode: opts.testMode, depth: opts.depth, source: opts.source });
  // trigger pseudo-step for history
  const trig = def.trigger || {};
  const tApp = getApp(trig.app, ws.id);
  const tid = insertStep(runId, ++ctx.seq, { id: 'trigger', app: trig.app, action: trig.event }, `${tApp?.name || trig.app} · ${tApp?.triggers?.[trig.event]?.name || trig.event || 'Trigger'}`, {});
  finishStep(tid, 'success', { output: triggerData });
  return drive(ctx, def.steps || [], 0);
}

/** Resume a paused (delayed / approved) run. */
export async function resumeRun(runId, { index, patch } = {}) {
  const r = get('SELECT * FROM runs WHERE id = ?', runId);
  if (!r || r.status !== 'waiting') return null;
  const flow = r.flow_id ? get('SELECT * FROM flows WHERE id = ?', r.flow_id) : null;
  if (!flow) { run("UPDATE runs SET status = 'error', error = 'Flow was deleted', finished_at = ? WHERE id = ?", now(), runId); return null; }
  const ws = get('SELECT * FROM workspaces WHERE id = ?', r.workspace_id);
  const state = j(r.state, {});
  if (patch) Object.assign(state.steps, patch);
  run("UPDATE runs SET status = 'running' WHERE id = ?", runId);
  const versionRow = get('SELECT definition FROM flow_versions WHERE flow_id = ? AND version = ?', flow.id, r.version);
  const def = j(versionRow?.definition) || j(flow.published) || j(flow.definition);
  const ctx = buildCtx({ ws, flow, runId, triggerData: state.steps?.trigger, state, source: r.source });
  return drive(ctx, def.steps || [], index);
}

/** Replay a finished run with its original trigger data (optionally the latest version). */
export async function replayRun(runId, { latest = true } = {}) {
  const r = get('SELECT * FROM runs WHERE id = ?', runId);
  if (!r?.flow_id) throw new Error('Only flow runs can be replayed.');
  const flow = get('SELECT * FROM flows WHERE id = ?', r.flow_id);
  if (!flow) throw new Error('Flow no longer exists.');
  let definition;
  if (!latest) definition = j(get('SELECT definition FROM flow_versions WHERE flow_id = ? AND version = ?', flow.id, r.version)?.definition);
  return executeFlow(flow, j(r.trigger_data, {}), { source: 'replay', replayOf: runId, definition });
}

export async function decideApproval(approvalId, user, decision, comment = '') {
  const ap = get('SELECT * FROM approvals WHERE id = ?', approvalId);
  if (!ap || ap.status !== 'pending') throw Object.assign(new Error('This approval was already decided.'), { status: 409 });
  const status = decision === 'approve' ? 'approved' : 'rejected';
  run('UPDATE approvals SET status = ?, decided_by = ?, comment = ?, decided_at = ? WHERE id = ?', status, user?.name || 'System', comment, now(), approvalId);
  run("DELETE FROM jobs WHERE kind = 'approval_timeout' AND run_id = ?", ap.run_id);
  const out = { status, decided_by: user?.name || 'System', comment };
  const stepRow = get("SELECT id FROM run_steps WHERE run_id = ? AND step_id = ? AND status = 'waiting'", ap.run_id, ap.step_id);
  if (stepRow) finishStep(stepRow.id, status === 'approved' ? 'success' : 'filtered', { output: out });
  const r = get('SELECT * FROM runs WHERE id = ?', ap.run_id);
  if (status === 'rejected') {
    run("UPDATE runs SET status = 'filtered', error = ?, finished_at = ? WHERE id = ?", `Rejected by ${out.decided_by}${comment ? `: ${comment}` : ''}`, now(), ap.run_id);
    return { approval: { ...ap, ...out }, run: { status: 'filtered' } };
  }
  const flow = get('SELECT * FROM flows WHERE id = ?', r.flow_id);
  const def = j(get('SELECT definition FROM flow_versions WHERE flow_id = ? AND version = ?', r.flow_id, r.version)?.definition) || j(flow?.published) || j(flow?.definition);
  const idx = (def?.steps || []).findIndex((x) => x.id === ap.step_id);
  const res = await resumeRun(ap.run_id, { index: idx + 1, patch: { [ap.step_id]: out } });
  return { approval: { ...ap, ...out }, run: res };
}

/** Call another flow synchronously (Sub-Flows, Interface buttons, API, MCP). */
export async function callFlow(wsId, flowId, data, { source = 'api', depth = 0, testMode = false } = {}) {
  if (depth > MAX_DEPTH) throw new Error('Sub-flow nesting is too deep (max 5).');
  const flow = get('SELECT * FROM flows WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL', flowId, wsId);
  if (!flow) throw Object.assign(new Error('Flow not found'), { status: 404 });
  if (flow.status !== 'on' && !testMode) throw Object.assign(new Error(`Flow "${flow.name}" is off. Publish and turn it on first.`), { status: 409 });
  return executeFlow(flow, data, { source, depth, testMode, definition: testMode ? j(flow.definition) : undefined });
}

/** Run one action outside a flow (MCP, AI agent tools, "test step"). */
export async function runSingleAction({ wsId, app: appKey, action, params = {}, connectionId, source = 'mcp', testMode = false, runLabel }) {
  const ws = get('SELECT * FROM workspaces WHERE id = ?', wsId);
  const app = getApp(appKey, wsId);
  if (!app) throw new Error(`Unknown app ${appKey}`);
  const act = app.actions?.[action];
  if (!act?.run) throw new Error(`Unknown or non-runnable action ${appKey}.${action}`);
  const runId = uid('run_');
  run('INSERT INTO runs (id, workspace_id, flow_id, flow_name, source, status, trigger_data, started_at) VALUES (?,?,?,?,?,?,?,?)',
    runId, wsId, null, runLabel || `${app.name} · ${act.name}`, testMode ? 'test' : source, 'running', s(params), now());
  const ctx = buildCtx({ ws, flow: null, runId, triggerData: params, testMode, source });
  const step = { id: 'action', app: appKey, action, connectionId };
  const rsId = insertStep(runId, 1, step, `${app.name} · ${act.name}`, params);
  try {
    const r = await executeAction({ ws, step, app, act, params, ctx, retry: false });
    finishStep(rsId, 'success', { output: r.output, billable: r.charged });
    ctx.tasks = r.charged;
    finalizeRun(ctx, 'success');
    return { runId, status: 'success', output: r.output, tasks: r.charged };
  } catch (e) {
    finishStep(rsId, e instanceof Stop ? 'halted' : 'error', { error: e.message });
    finalizeRun(ctx, e instanceof Stop ? e.stopStatus : 'error', e.message);
    return { runId, status: 'error', error: e.message };
  }
}

/** Turn the AI agent's allowed tools into Claude tool definitions. */
async function buildAgentTools(ws, tools, parentCtx) {
  return (tools || []).filter((t) => t && t.app && t.action).map((t, i) => {
    const app = getApp(t.app, ws.id);
    const act = app?.actions?.[t.action];
    if (!app || !act) return null;
    const name = `${t.app}_${t.action}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) + (i ? `_${i}` : '');
    const props = {};
    const required = [];
    const fixed = t.params || {};
    for (const f of act.fields || []) {
      if (fixed[f.key] !== undefined && fixed[f.key] !== '') continue;
      props[f.key] = { type: 'string', description: `${f.label}${f.help ? ` — ${f.help}` : ''}${f.options ? ` (one of: ${f.options.map((o) => o.value).join(', ')})` : ''}` };
      if (f.required) required.push(f.key);
    }
    return {
      name, description: `${app.name}: ${act.name}. ${t.description || act.description || ''}`.trim(),
      input_schema: { type: 'object', properties: props, required },
      run: async (input) => {
        const params = { ...fixed, ...input };
        if (parentCtx.testMode) return { note: 'Test mode: tool not executed', would_call: `${app.name}.${act.name}`, params };
        const r = await runSingleAction({ wsId: ws.id, app: t.app, action: t.action, params, connectionId: t.connectionId, source: 'agent', runLabel: `Agent tool · ${app.name} · ${act.name}` });
        if (r.status !== 'success') throw new Error(r.error);
        return r.output;
      },
    };
  }).filter(Boolean);
}

/** Test a single step inside the editor, with the flow's current sample data. */
export async function testStep(flow, stepId, sampleSteps = {}) {
  const def = j(flow.definition);
  const find = (steps) => { for (const st of steps || []) { if (st.id === stepId) return st; const inner = st.app === 'paths' ? (st.paths || []).flatMap((p) => p.steps || []) : st.steps; const f = find(inner); if (f) return f; } return null; };
  const step = find(def.steps);
  if (!step) throw new Error('Step not found');
  const ws = get('SELECT * FROM workspaces WHERE id = ?', flow.workspace_id);
  const app = getApp(step.app, ws.id);
  const act = app?.actions?.[step.action];
  if (!act) throw new Error('Choose an app and action first.');
  const ctx = buildCtx({ ws, flow, runId: `test_${stepId}`, triggerData: sampleSteps.trigger || def.trigger?.sample || {}, testMode: true });
  Object.assign(ctx.steps, sampleSteps);
  ctx.vars.loop = { item: 'sample item', index: 0, iteration: 1, total: 1 };
  const params = render(step.params || {}, ctx);
  if (step.app === 'filter') return { output: evaluateConditions(step.params?.conditions, ctx), params };
  if (!act.run) return { output: act.sample || {}, params, note: 'Control step — sample output shown.' };
  const r = await executeAction({ ws, step, app, act, params, ctx, retry: false });
  return { output: r.output, params };
}
