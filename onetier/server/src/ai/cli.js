// Use the Claude Code CLI (Claude account) or the Codex CLI (ChatGPT account) that is signed in on
// this machine as an AI backend. No API key needed — requests run on the account the CLI is signed into.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const CLI_ENABLED = process.env.ONETIER_LOCAL_AI_ACCOUNTS !== 'off';

const CLIS = {
  claude: { bin: process.env.CLAUDE_CLI_PATH || 'claude', label: 'Claude', product: 'Claude Code', install: 'npm install -g @anthropic-ai/claude-code' },
  codex: { bin: process.env.CODEX_CLI_PATH || 'codex', label: 'ChatGPT', product: 'Codex CLI', install: 'npm install -g @openai/codex' },
};

// Every CLI call runs in an empty scratch directory so no project files or settings are picked up.
const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'onetier-ai-'));

function run(bin, args, { input, timeout = 180000, env } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { cwd: WORK_DIR, env: env || process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { return resolve({ code: -1, stdout: '', stderr: e.message, missing: true }); }
    let stdout = ''; let stderr = '';
    const t = setTimeout(() => { child.kill('SIGKILL'); stderr += `\nTimed out after ${timeout / 1000}s`; }, timeout);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, stdout, stderr: e.message, missing: e.code === 'ENOENT' }); });
    child.on('close', (code) => { clearTimeout(t); resolve({ code, stdout, stderr }); });
    if (input !== undefined) child.stdin.end(input); else child.stdin.end();
  });
}

// Run at most two CLI generations at once so a burst of flow runs doesn't flood the account.
let active = 0; const queue = [];
async function limited(fn) {
  if (active >= 2) await new Promise((r) => queue.push(r));
  active++;
  try { return await fn(); } finally { active--; queue.shift()?.(); }
}

// ---------------------------------------------------------------- status (cached)
const status = { claude: { installed: false, loggedIn: false, checkedAt: null }, codex: { installed: false, loggedIn: false, checkedAt: null } };

export async function refreshStatus(which = ['claude', 'codex']) {
  if (!CLI_ENABLED) return status;
  for (const k of [].concat(which)) {
    if (k === 'claude') {
      const r = await run(CLIS.claude.bin, ['auth', 'status', '--json'], { timeout: 15000 });
      if (r.missing) { status.claude = { installed: false, loggedIn: false, checkedAt: new Date().toISOString() }; continue; }
      let info = {};
      try { info = JSON.parse(r.stdout); } catch { /* not json */ }
      status.claude = { installed: true, loggedIn: Boolean(info.loggedIn), method: info.authMethod || null, email: info.email || info.account?.email || null, checkedAt: new Date().toISOString() };
    } else {
      const r = await run(CLIS.codex.bin, ['login', 'status'], { timeout: 15000 });
      if (r.missing) { status.codex = { installed: false, loggedIn: false, checkedAt: new Date().toISOString() }; continue; }
      const out = `${r.stdout}\n${r.stderr}`;
      status.codex = { installed: true, loggedIn: r.code === 0 && /logged in/i.test(out) && !/not logged in/i.test(out), method: /chatgpt/i.test(out) ? 'chatgpt' : /api key/i.test(out) ? 'api_key' : null, checkedAt: new Date().toISOString() };
    }
  }
  return status;
}
export const cliStatus = () => ({ enabled: CLI_ENABLED, ...status, install: { claude: CLIS.claude.install, codex: CLIS.codex.install } });
export const cliReady = (k) => CLI_ENABLED && status[k]?.installed && status[k]?.loggedIn;

if (CLI_ENABLED) {
  refreshStatus().catch(() => {});
  setInterval(() => refreshStatus().catch(() => {}), 5 * 60 * 1000).unref();
}

// ---------------------------------------------------------------- generation
function cliError(k, r) {
  const msg = (r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' ').slice(0, 400);
  if (r.missing) return new Error(`${CLIS[k].product} is not installed on this machine. Install it with: ${CLIS[k].install}`);
  if (/log ?in|auth|unauthori[sz]ed|credential/i.test(msg)) return new Error(`${CLIS[k].product} is not signed in. Sign in with your ${CLIS[k].label} account in Settings → AI.`);
  return new Error(`${CLIS[k].product} failed: ${msg || `exit code ${r.code}`}`);
}

/** Claude Code headless call. Returns {text, data?}. */
export async function claudeCli({ system, prompt, schema, model }) {
  const args = ['-p', '--output-format', 'json', '--tools', '', '--no-session-persistence', '--setting-sources', '', '--strict-mcp-config'];
  if (system) args.push('--system-prompt', system);
  if (model) args.push('--model', model);
  if (schema) args.push('--json-schema', JSON.stringify(schema));
  // Make sure the CLI uses its own sign-in, not an API key from OneTier's environment.
  const env = { ...process.env }; delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN;
  const r = await limited(() => run(CLIS.claude.bin, args, { input: prompt, env }));
  let out;
  try { out = JSON.parse(r.stdout); } catch { throw cliError('claude', r); }
  if (out.is_error || out.subtype !== 'success') {
    const e = cliError('claude', { ...r, stderr: `${out.result || out.subtype || ''} ${r.stderr}` });
    if (/not signed in/.test(e.message)) status.claude.loggedIn = false;
    throw e;
  }
  return { text: String(out.result ?? '').trim(), data: out.structured_output, usage: { model: Object.keys(out.modelUsage || {}).pop() || model || 'claude', via: 'Claude account' } };
}

/** Codex CLI (`codex exec`) call. Returns {text}. */
export async function codexCli({ system, prompt, model }) {
  const outFile = path.join(WORK_DIR, `codex-${crypto.randomBytes(6).toString('hex')}.txt`);
  const full = `${system ? `${system}\n\n` : ''}${prompt}`;
  const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never', '--output-last-message', outFile];
  if (model) args.push('--model', model);
  args.push(full);
  const env = { ...process.env }; delete env.OPENAI_API_KEY;
  const r = await limited(() => run(CLIS.codex.bin, args, { env }));
  let text = '';
  try { text = fs.readFileSync(outFile, 'utf8').trim(); fs.rmSync(outFile, { force: true }); } catch { /* no file */ }
  if (!text) {
    const e = cliError('codex', r);
    if (/not signed in/.test(e.message)) status.codex.loggedIn = false;
    throw e;
  }
  return { text, usage: { model: model || 'codex default', via: 'ChatGPT account' } };
}

// ---------------------------------------------------------------- interactive sign-in (runs the official CLI login)
const logins = {};

export function startLogin(k) {
  if (!CLI_ENABLED) throw new Error('Local account sign-in is disabled on this server (ONETIER_LOCAL_AI_ACCOUNTS=off).');
  if (!CLIS[k]) throw new Error('Unknown account type');
  if (logins[k]?.state === 'running') return loginState(k);
  const args = k === 'claude' ? ['auth', 'login', '--claudeai'] : ['login'];
  const s = { state: 'running', output: '', url: null, startedAt: Date.now() };
  logins[k] = s;
  let child;
  try { child = spawn(CLIS[k].bin, args, { cwd: WORK_DIR, env: { ...process.env, BROWSER: process.env.BROWSER || '' }, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { Object.assign(s, { state: 'failed', error: e.message }); return loginState(k); }
  s.child = child;
  const onData = (d) => {
    s.output = (s.output + d.toString()).slice(-6000);
    const m = s.output.match(/https:\/\/[^\s"'<>)]+/g);
    if (m) s.url = m.find((u) => /oauth|authorize|login|auth\./i.test(u)) || m[0];
  };
  child.stdout.on('data', onData); child.stderr.on('data', onData);
  child.on('error', (e) => Object.assign(s, { state: 'failed', error: e.code === 'ENOENT' ? `${CLIS[k].product} is not installed. Install it with: ${CLIS[k].install}` : e.message }));
  child.on('close', async (code) => {
    if (s.state === 'cancelled') return;
    await refreshStatus(k);
    s.state = status[k].loggedIn ? 'done' : 'failed';
    if (s.state === 'failed' && !s.error) s.error = `Sign-in did not complete (exit code ${code}).`;
  });
  setTimeout(() => { if (s.state === 'running') { child.kill(); s.state = 'failed'; s.error = 'Sign-in timed out after 10 minutes.'; } }, 10 * 60 * 1000).unref();
  return loginState(k);
}
export function submitLoginCode(k, code) {
  const s = logins[k];
  if (!s || s.state !== 'running') throw new Error('No sign-in in progress.');
  s.child.stdin.write(`${String(code).trim()}\n`);
  return loginState(k);
}
export function cancelLogin(k) {
  const s = logins[k];
  if (s?.state === 'running') { s.state = 'cancelled'; s.child.kill(); }
  return loginState(k);
}
export function loginState(k) {
  const s = logins[k];
  if (!s) return { state: 'idle' };
  return { state: s.state, url: s.url, error: s.error || null, output: s.output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').slice(-1500), loggedIn: status[k]?.loggedIn };
}
export async function logout(k) {
  const args = k === 'claude' ? ['auth', 'logout'] : ['logout'];
  await run(CLIS[k].bin, args, { timeout: 20000 });
  await refreshStatus(k);
  return status[k];
}
