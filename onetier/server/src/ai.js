// AI layer: one interface (aiText / aiJSON / aiAgent) over several providers.
//   anthropic  — Anthropic API key (workspace setting, Anthropic connection, or ANTHROPIC_API_KEY)
//   openai     — OpenAI API key
//   claude-cli — the Claude account signed in to Claude Code on this machine (no API key)
//   codex-cli  — the ChatGPT account signed in to Codex CLI on this machine (no API key)
import Anthropic from '@anthropic-ai/sdk';
import { get, j, decrypt } from './db.js';
import { cliReady, claudeCli, codexCli } from './ai/cli.js';
import { openaiText, openaiJSON, openaiAgent } from './ai/openai.js';

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const MODELS = [
  { value: 'claude-opus-5-5', label: 'Claude Opus 5.5 (most capable, default)' },
  { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (balanced)' },
  { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest)' },
];
export const PROVIDERS = {
  anthropic: 'Anthropic API key', openai: 'OpenAI API key', 'claude-cli': 'Claude account (Claude Code)', 'codex-cli': 'ChatGPT account (Codex CLI)',
};

// ---------------------------------------------------------------- provider resolution
function aiSettings(wsId) {
  const ws = wsId ? get('SELECT settings FROM workspaces WHERE id = ?', wsId) : null;
  return j(ws?.settings, {});
}
function anthropicKey(wsId, settings) {
  if (settings.anthropicKey) return decrypt(settings.anthropicKey).key;
  if (wsId) {
    const conn = get("SELECT credentials FROM connections WHERE workspace_id = ? AND app = 'anthropic' ORDER BY created_at LIMIT 1", wsId);
    if (conn) return decrypt(conn.credentials).api_key;
  }
  return process.env.ANTHROPIC_API_KEY || null;
}
function openaiKey(settings) {
  if (settings.openaiKey) return decrypt(settings.openaiKey).key;
  return process.env.OPENAI_API_KEY || null;
}

/** Which providers are usable right now for this workspace. */
export function availableProviders(wsId) {
  const st = aiSettings(wsId);
  return {
    anthropic: Boolean(anthropicKey(wsId, st)),
    openai: Boolean(openaiKey(st)),
    'claude-cli': Boolean(cliReady('claude')),
    'codex-cli': Boolean(cliReady('codex')),
  };
}

/**
 * Resolve the provider to use. purpose 'public' (anonymous website visitors, e.g. public chatbots) only uses
 * API-key providers — personal Claude/ChatGPT accounts are reserved for the workspace's own work.
 */
export function resolveProvider(wsId, { creds, purpose, force } = {}) {
  if (creds?.api_key) return { type: 'anthropic', key: creds.api_key };
  const st = aiSettings(wsId);
  const ai = st.ai || {};
  const avail = availableProviders(wsId);
  const allowed = (p) => avail[p] && !(purpose === 'public' && p.endsWith('-cli'));
  const pick = (p) => {
    if (p === 'anthropic') return { type: p, key: anthropicKey(wsId, st) };
    if (p === 'openai') return { type: p, key: openaiKey(st), model: ai.openaiModel || 'gpt-4o-mini' };
    if (p === 'claude-cli') return { type: p, model: ai.claudeModel || 'sonnet' };
    if (p === 'codex-cli') return { type: p, model: ai.codexModel || undefined };
    return null;
  };
  if (force) return allowed(force) ? pick(force) : null;
  const pref = ai.provider && ai.provider !== 'auto' ? ai.provider : null;
  if (pref && allowed(pref)) return pick(pref);
  for (const p of ['anthropic', 'openai', 'claude-cli', 'codex-cli']) if (allowed(p)) return pick(p);
  return null;
}

export function aiConfigured(wsId, opts) {
  return Boolean(resolveProvider(wsId, opts));
}

function need(wsId, opts) {
  const p = resolveProvider(wsId, opts);
  if (!p) {
    const e = new Error(opts?.purpose === 'public'
      ? 'Public AI features need an Anthropic or OpenAI API key (Settings → AI).'
      : 'AI is not set up. In Settings → AI, sign in with your Claude or ChatGPT account, or add an Anthropic / OpenAI API key.');
    e.code = 'AI_NOT_CONFIGURED';
    throw e;
  }
  return p;
}

// ---------------------------------------------------------------- Anthropic (API key)
function anthropicBase({ model, effort, maxTokens }) {
  return {
    model: model || DEFAULT_MODEL,
    max_tokens: maxTokens || 16000,
    output_config: { effort: effort || 'medium' },
    // Server-side refusal fallback: if a request is declined, the API reroutes it automatically.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  };
}
function textOf(response) {
  if (response.stop_reason === 'refusal') {
    const e = new Error(`The model declined this request${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : '.'}`);
    e.code = 'AI_REFUSAL';
    throw e;
  }
  return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}
const usageOf = (r) => ({ input_tokens: r.usage?.input_tokens, output_tokens: r.usage?.output_tokens, model: r.model });
const claudeModel = (m) => (m && /^claude-/.test(m) ? m : undefined);

// ---------------------------------------------------------------- helpers for text-only (CLI) providers
function transcript(messages) {
  if (messages.length === 1 && messages[0].role === 'user') return String(messages[0].content);
  const lines = messages.map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`);
  return `Conversation so far:\n\n${lines.join('\n\n')}\n\nWrite the assistant's next reply to the last user message. Reply with the message text only.`;
}
function parseJSONLoose(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('The model did not return JSON.');
  return JSON.parse(m[0]);
}
async function cliGenerate(p, { system, prompt, schema, model }) {
  if (p.type === 'claude-cli') return claudeCli({ system, prompt, schema, model: claudeModel(model) || p.model });
  const extra = schema ? `\n\nRespond with ONLY a JSON object (no prose, no code fences) matching this JSON Schema:\n${JSON.stringify(schema)}` : '';
  const r = await codexCli({ system, prompt: prompt + extra, model: p.model });
  return schema ? { ...r, data: parseJSONLoose(r.text) } : r;
}

// ---------------------------------------------------------------- public API
export async function aiText({ wsId, creds, purpose, force, system, prompt, messages, model, effort, maxTokens }) {
  const p = need(wsId, { creds, purpose, force });
  const msgs = messages || [{ role: 'user', content: prompt }];
  if (p.type === 'anthropic') {
    const r = await new Anthropic({ apiKey: p.key }).beta.messages.create({ ...anthropicBase({ model: claudeModel(model), effort, maxTokens }), ...(system ? { system } : {}), messages: msgs });
    return { text: textOf(r), usage: usageOf(r) };
  }
  if (p.type === 'openai') return openaiText({ key: p.key, model: p.model, system, messages: msgs });
  const r = await cliGenerate(p, { system, prompt: transcript(msgs), model });
  return { text: r.text, usage: r.usage };
}

/** Structured output constrained to a JSON schema. */
export async function aiJSON({ wsId, creds, purpose, force, system, prompt, schema, model, effort, maxTokens }) {
  const p = need(wsId, { creds, purpose, force });
  if (p.type === 'anthropic') {
    const r = await new Anthropic({ apiKey: p.key }).beta.messages.create({
      ...anthropicBase({ model: claudeModel(model), effort, maxTokens }), ...(system ? { system } : {}),
      messages: [{ role: 'user', content: prompt }],
      output_config: { effort: effort || 'medium', format: { type: 'json_schema', schema } },
    });
    return { data: parseJSONLoose(textOf(r)), usage: usageOf(r) };
  }
  if (p.type === 'openai') return openaiJSON({ key: p.key, model: p.model, system, prompt, schema });
  const r = await cliGenerate(p, { system, prompt, schema, model });
  return { data: r.data ?? parseJSONLoose(r.text), usage: r.usage };
}

/**
 * Agentic loop: the model calls tools until done. tools: [{name, description, input_schema, run(input)}].
 * Returns {text, toolCalls[], usage}.
 */
export async function aiAgent({ wsId, creds, purpose, force, system, prompt, messages: history, tools, model, effort, maxIterations = 8, onToolCall }) {
  const p = need(wsId, { creds, purpose, force });
  const messages = history ? [...history] : [{ role: 'user', content: prompt }];
  if (p.type === 'openai') return openaiAgent({ key: p.key, model: p.model, system, messages, tools, maxIterations, onToolCall });
  if (p.type !== 'anthropic') return cliAgent(p, { system, messages, tools, model, maxIterations, onToolCall });

  const client = new Anthropic({ apiKey: p.key });
  const base = anthropicBase({ model: claudeModel(model), effort });
  const toolDefs = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  if (!toolDefs.length) {
    const r = await client.beta.messages.create({ ...base, ...(system ? { system } : {}), messages });
    return { text: textOf(r), toolCalls: [], usage: usageOf(r) };
  }
  const toolCalls = [];
  let last;
  for (let i = 0; i < maxIterations; i++) {
    last = await client.beta.messages.create({ ...base, ...(system ? { system } : {}), tools: toolDefs, messages });
    if (last.stop_reason === 'refusal') textOf(last);
    if (last.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: last.content }); continue; }
    const uses = last.content.filter((b) => b.type === 'tool_use');
    if (last.stop_reason !== 'tool_use' || !uses.length) break;
    messages.push({ role: 'assistant', content: last.content });
    const results = await Promise.all(uses.map(async (u) => {
      const tool = tools.find((t) => t.name === u.name);
      let content, is_error = false;
      try {
        if (!tool) throw new Error(`Unknown tool ${u.name}`);
        const out = await tool.run(u.input || {});
        content = typeof out === 'string' ? out : JSON.stringify(out ?? null).slice(0, 20000);
      } catch (e) { content = `Error: ${e.message}`; is_error = true; }
      const call = { tool: u.name, input: u.input, output: content.slice(0, 4000), error: is_error };
      toolCalls.push(call);
      onToolCall?.(call);
      return { type: 'tool_result', tool_use_id: u.id, content, ...(is_error ? { is_error: true } : {}) };
    }));
    messages.push({ role: 'user', content: results });
  }
  return { text: textOf(last), toolCalls, usage: usageOf(last) };
}

/** Tool loop for text-only CLI providers: the model answers with a JSON "call a tool" or "final answer" each turn. */
async function cliAgent(p, { system, messages, tools, model, maxIterations, onToolCall }) {
  if (!tools.length) {
    const r = await cliGenerate(p, { system, prompt: transcript(messages), model });
    return { text: r.text, toolCalls: [], usage: r.usage };
  }
  const toolDoc = tools.map((t) => `- ${t.name}: ${t.description}\n  input JSON schema: ${JSON.stringify(t.input_schema)}`).join('\n');
  const sys = `${system || 'You are a helpful assistant.'}\n\nYou can use these tools:\n${toolDoc}\n\nEach turn, respond with ONLY a JSON object: either {"tool": "<tool name>", "input": {...}} to call one tool, or {"final": "<your answer to the user>"} when you are done. Never call a tool that is not listed.`;
  const schema = { type: 'object', properties: { tool: { type: 'string' }, input: { type: 'object' }, final: { type: 'string' } } };
  const log = [];
  const toolCalls = [];
  let usage;
  for (let i = 0; i < maxIterations; i++) {
    const prompt = `${transcript(messages)}${log.length ? `\n\nTool calls so far:\n${log.join('\n')}` : ''}\n\nWhat is your next step?`;
    const r = await cliGenerate(p, { system: sys, prompt, schema, model });
    usage = r.usage;
    const step = r.data ?? parseJSONLoose(r.text);
    if (!step.tool) return { text: String(step.final ?? r.text ?? '').trim(), toolCalls, usage };
    const tool = tools.find((t) => t.name === step.tool);
    let content; let error = false;
    try {
      if (!tool) throw new Error(`Unknown tool ${step.tool}`);
      const out = await tool.run(step.input || {});
      content = typeof out === 'string' ? out : JSON.stringify(out ?? null).slice(0, 8000);
    } catch (e) { content = `Error: ${e.message}`; error = true; }
    const call = { tool: step.tool, input: step.input, output: content.slice(0, 4000), error };
    toolCalls.push(call); onToolCall?.(call);
    log.push(`${i + 1}. ${step.tool}(${JSON.stringify(step.input || {})}) → ${content.slice(0, 3000)}`);
  }
  return { text: 'Stopped after reaching the maximum number of tool calls.', toolCalls, usage };
}

export const MODEL_FIELD = { key: 'model', label: 'Model', type: 'select', options: MODELS, default: DEFAULT_MODEL,
  help: 'Used with an Anthropic key or a Claude account. OpenAI keys and ChatGPT accounts use the model chosen in Settings → AI.' };
