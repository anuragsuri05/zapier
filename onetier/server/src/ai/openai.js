// OpenAI API (for users who bring an OpenAI API key). Uses the Chat Completions endpoint.
import { http } from '../apps/http.js';

const BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

export async function listOpenAIModels(key) {
  const r = await http(`${BASE}/models`, { auth: { bearer: key }, timeout: 20000 });
  const ids = (r.data?.data || []).map((m) => m.id).filter((id) => /^(gpt|o\d|chatgpt)/i.test(id) && !/audio|realtime|tts|transcribe|image|search|embedding|instruct/i.test(id));
  return ids.sort().reverse();
}

/** Pick a sensible default chat model from what the key can access. */
export function preferredModel(ids) {
  const order = [/^gpt-5(\.\d+)?$/, /^gpt-5(\.\d+)?-mini$/, /^gpt-4\.1$/, /^gpt-4o$/, /^gpt-4o-mini$/];
  for (const re of order) { const hit = ids.find((id) => re.test(id)); if (hit) return hit; }
  return ids[0] || 'gpt-4o-mini';
}

async function chat(key, body) {
  const r = await http(`${BASE}/chat/completions`, { method: 'POST', auth: { bearer: key }, json: body, timeout: 180000 });
  const choice = r.data?.choices?.[0];
  if (!choice) throw new Error('OpenAI returned no response.');
  if (choice.message?.refusal) throw new Error(`The model declined this request: ${choice.message.refusal}`);
  return { message: choice.message, usage: { input_tokens: r.data.usage?.prompt_tokens, output_tokens: r.data.usage?.completion_tokens, model: r.data.model } };
}

const withSystem = (system, messages) => (system ? [{ role: 'system', content: system }, ...messages] : messages);

export async function openaiText({ key, model, system, messages }) {
  const { message, usage } = await chat(key, { model, messages: withSystem(system, messages) });
  return { text: String(message.content || '').trim(), usage };
}

export async function openaiJSON({ key, model, system, prompt, schema }) {
  const { message, usage } = await chat(key, {
    model, messages: withSystem(system, [{ role: 'user', content: prompt }]),
    response_format: { type: 'json_schema', json_schema: { name: 'result', schema, strict: true } },
  });
  return { data: JSON.parse(message.content || '{}'), usage };
}

/** Function-calling loop. tools: [{name, description, input_schema, run}] */
export async function openaiAgent({ key, model, system, messages: history, tools, maxIterations = 8, onToolCall }) {
  const messages = withSystem(system, history);
  const defs = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  const toolCalls = [];
  let last;
  for (let i = 0; i < maxIterations; i++) {
    last = await chat(key, { model, messages, ...(defs.length ? { tools: defs } : {}) });
    const calls = last.message.tool_calls || [];
    if (!calls.length) break;
    messages.push(last.message);
    for (const c of calls) {
      const tool = tools.find((t) => t.name === c.function?.name);
      let content; let error = false;
      try {
        if (!tool) throw new Error(`Unknown tool ${c.function?.name}`);
        const out = await tool.run(JSON.parse(c.function.arguments || '{}'));
        content = typeof out === 'string' ? out : JSON.stringify(out ?? null).slice(0, 20000);
      } catch (e) { content = `Error: ${e.message}`; error = true; }
      const call = { tool: c.function?.name, input: (() => { try { return JSON.parse(c.function.arguments); } catch { return c.function?.arguments; } })(), output: content.slice(0, 4000), error };
      toolCalls.push(call); onToolCall?.(call);
      messages.push({ role: 'tool', tool_call_id: c.id, content });
    }
  }
  return { text: String(last?.message?.content || '').trim(), toolCalls, usage: last?.usage };
}
