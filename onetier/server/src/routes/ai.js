import { Router } from 'express';
import { get, run, j, s, encrypt } from '../db.js';
import { authenticate, requireRole } from '../auth.js';
import { audit } from '../services.js';
import { availableProviders, resolveProvider, aiText, PROVIDERS, MODELS } from '../ai.js';
import { cliStatus, refreshStatus, startLogin, submitLoginCode, cancelLogin, loginState, logout } from '../ai/cli.js';
import { listOpenAIModels, preferredModel } from '../ai/openai.js';
import { http } from '../apps/http.js';

export const ai = Router();
ai.use(authenticate);
const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 400).json({ error: e.message }); } };
const settingsOf = (req) => j(get('SELECT settings FROM workspaces WHERE id = ?', req.ws.id).settings, {});
const saveSettings = (req, st) => run('UPDATE workspaces SET settings = ? WHERE id = ?', s(st), req.ws.id);

function payload(req) {
  const st = settingsOf(req);
  const active = resolveProvider(req.ws.id);
  return {
    settings: { provider: 'auto', claudeModel: 'sonnet', ...(st.ai || {}) },
    active: active ? { type: active.type, label: PROVIDERS[active.type], model: active.model || null } : null,
    publicProvider: (() => { const p = resolveProvider(req.ws.id, { purpose: 'public' }); return p ? p.type : null; })(),
    available: availableProviders(req.ws.id),
    keys: {
      anthropic: Boolean(st.anthropicKey), anthropicEnv: Boolean(process.env.ANTHROPIC_API_KEY),
      anthropicConnection: Boolean(get("SELECT 1 FROM connections WHERE workspace_id = ? AND app = 'anthropic'", req.ws.id)),
      openai: Boolean(st.openaiKey), openaiEnv: Boolean(process.env.OPENAI_API_KEY), openaiModels: st.ai?.openaiModels || [],
    },
    cli: cliStatus(),
    login: { claude: loginState('claude'), codex: loginState('codex') },
    claudeModels: MODELS, providers: PROVIDERS,
  };
}

ai.get('/ai/status', (req, res) => res.json(payload(req)));
ai.post('/ai/refresh', wrap(async (req, res) => { await refreshStatus(); res.json(payload(req)); }));

ai.put('/ai/settings', requireRole('admin'), wrap((req, res) => {
  const st = settingsOf(req);
  const { provider, openaiModel, claudeModel, codexModel } = req.body || {};
  if (provider && !['auto', ...Object.keys(PROVIDERS)].includes(provider)) throw new Error('Unknown AI provider');
  st.ai = { ...(st.ai || {}), ...(provider ? { provider } : {}), ...(openaiModel !== undefined ? { openaiModel } : {}), ...(claudeModel !== undefined ? { claudeModel } : {}), ...(codexModel !== undefined ? { codexModel } : {}) };
  saveSettings(req, st);
  audit(req.ws.id, req.user, 'ai.settings_updated', provider || '');
  res.json(payload(req));
}));

// ---- API keys (validated before saving, stored encrypted)
ai.post('/ai/keys/anthropic', requireRole('admin'), wrap(async (req, res) => {
  const key = String(req.body.key || '').trim();
  if (!key) throw new Error('Paste your Anthropic API key.');
  await http('https://api.anthropic.com/v1/models?limit=1', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, timeout: 20000 })
    .catch((e) => { throw new Error(`Anthropic rejected that key: ${e.message}`); });
  const st = settingsOf(req); st.anthropicKey = encrypt({ key }); saveSettings(req, st);
  audit(req.ws.id, req.user, 'ai.key_added', 'anthropic');
  res.json(payload(req));
}));
ai.post('/ai/keys/openai', requireRole('admin'), wrap(async (req, res) => {
  const key = String(req.body.key || '').trim();
  if (!key) throw new Error('Paste your OpenAI API key.');
  let models;
  try { models = await listOpenAIModels(key); } catch (e) { throw new Error(`OpenAI rejected that key: ${e.message}`); }
  const st = settingsOf(req);
  st.openaiKey = encrypt({ key });
  st.ai = { ...(st.ai || {}), openaiModels: models.slice(0, 60), openaiModel: st.ai?.openaiModel && models.includes(st.ai.openaiModel) ? st.ai.openaiModel : preferredModel(models) };
  saveSettings(req, st);
  audit(req.ws.id, req.user, 'ai.key_added', 'openai');
  res.json(payload(req));
}));
ai.delete('/ai/keys/:provider', requireRole('admin'), wrap((req, res) => {
  const st = settingsOf(req);
  if (req.params.provider === 'anthropic') delete st.anthropicKey;
  else if (req.params.provider === 'openai') { delete st.openaiKey; if (st.ai) delete st.ai.openaiModels; }
  else throw new Error('Unknown provider');
  saveSettings(req, st);
  audit(req.ws.id, req.user, 'ai.key_removed', req.params.provider);
  res.json(payload(req));
}));

// ---- Sign in with a Claude / ChatGPT account (runs the official CLI sign-in on this machine)
const cliKey = (p) => { if (!['claude', 'codex'].includes(p)) throw new Error('Unknown account type'); return p; };
ai.post('/ai/login/:cli', requireRole('admin'), wrap((req, res) => { const st = startLogin(cliKey(req.params.cli)); audit(req.ws.id, req.user, 'ai.account_login_started', req.params.cli); res.json(st); }));
ai.get('/ai/login/:cli', wrap((req, res) => res.json(loginState(cliKey(req.params.cli)))));
ai.post('/ai/login/:cli/code', requireRole('admin'), wrap((req, res) => res.json(submitLoginCode(cliKey(req.params.cli), req.body.code || ''))));
ai.delete('/ai/login/:cli', requireRole('admin'), wrap((req, res) => res.json(cancelLogin(cliKey(req.params.cli)))));
ai.post('/ai/logout/:cli', requireRole('owner'), wrap(async (req, res) => {
  await logout(cliKey(req.params.cli));
  audit(req.ws.id, req.user, 'ai.account_logout', req.params.cli);
  res.json(payload(req));
}));

// ---- Try a provider with a tiny prompt
ai.post('/ai/test', wrap(async (req, res) => {
  const force = req.body.provider || undefined;
  if (force && !resolveProvider(req.ws.id, { force })) throw new Error(`${PROVIDERS[force] || force} is not connected yet.`);
  const started = Date.now();
  const r = await aiText({ wsId: req.ws.id, force, effort: 'low', prompt: 'Reply with exactly: OneTier AI is connected.' });
  res.json({ ok: true, reply: r.text, model: r.usage?.model || null, via: r.usage?.via || null, ms: Date.now() - started });
}));

