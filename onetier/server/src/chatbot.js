import { get, run, uid, now, j, s } from './db.js';
import { aiAgent, aiConfigured } from './ai.js';
import { bus, createRecord } from './services.js';
import { callFlow } from './engine/index.js';

/** Keyword retrieval fallback so chatbots still answer without an API key. */
function keywordAnswer(knowledge, question) {
  const STOP = new Set(['the', 'and', 'you', 'your', 'are', 'what', 'have', 'has', 'can', 'for', 'with', 'how', 'does', 'this', 'that', 'there', 'about', 'from', 'any', 'our', 'tell', 'please', 'want', 'need', 'would', 'like', 'get']);
  const stem = (w) => w.replace(/(ing|es|s)$/, '');
  const words = (question.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((w) => !STOP.has(w)).map(stem);
  const lines = String(knowledge || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
  let best = null; let score = 0;
  for (const l of lines) {
    const lineWords = new Set((l.toLowerCase().match(/[a-z0-9]{3,}/g) || []).map(stem));
    const sc = words.reduce((n, w) => n + (lineWords.has(w) ? 1 : 0), 0);
    if (sc > score) { best = l; score = sc; }
  }
  return best ? best : "I'm not sure about that one. Leave your email and a teammate will follow up!";
}

export async function chatbotReply(bot, { conversationId, message, visitor = 'Visitor', preview = false }) {
  const config = j(bot.config, {});
  let conv = conversationId ? get('SELECT * FROM conversations WHERE id = ? AND chatbot_id = ?', conversationId, bot.id) : null;
  if (!conv) {
    const id = uid('conv_');
    const msgs = config.greeting ? [{ role: 'assistant', content: config.greeting, at: now() }] : [];
    run('INSERT INTO conversations (id, chatbot_id, visitor, messages, created_at, updated_at) VALUES (?,?,?,?,?,?)', id, bot.id, preview ? 'Preview' : visitor, s(msgs), now(), now());
    conv = get('SELECT * FROM conversations WHERE id = ?', id);
  }
  const msgs = j(conv.messages, []);
  msgs.push({ role: 'user', content: String(message).slice(0, 4000), at: now() });
  let reply; const actions = [];

  const purpose = preview ? undefined : 'public';
  if (aiConfigured(bot.workspace_id, { purpose })) {
    const tools = [];
    if (config.leadCapture) tools.push({
      name: 'capture_lead', description: 'Save the visitor as a lead once they share their email (and name if known).',
      input_schema: { type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' }, notes: { type: 'string' } }, required: ['email'] },
      run: async (input) => {
        const lead = { ...input, conversation_id: conv.id, chatbot: bot.name, captured_at: now() };
        if (config.leadTableId) { try { createRecord(bot.workspace_id, config.leadTableId, { Name: input.name, Email: input.email, Notes: input.notes, Status: 'New' }, { source: 'chatbot' }); } catch (e) { /* table may be gone */ } }
        bus.emit('chatbot.lead', { wsId: bot.workspace_id, chatbotId: bot.id, data: lead });
        actions.push({ type: 'lead', ...input });
        return 'Lead saved.';
      },
    });
    for (const fa of config.flowActions || []) {
      if (!fa.flowId) continue;
      tools.push({
        name: `run_${String(fa.name || fa.flowId).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}`,
        description: fa.description || `Run the "${fa.name}" automation.`,
        input_schema: { type: 'object', properties: { details: { type: 'string', description: 'Relevant details from the conversation' } } },
        run: async (input) => {
          const r = await callFlow(bot.workspace_id, fa.flowId, { ...input, conversation_id: conv.id }, { source: 'chatbot' });
          actions.push({ type: 'flow', name: fa.name, status: r.status });
          return r.status === 'success' ? `Done. ${JSON.stringify(r.returnValue ?? {})}` : `Failed: ${r.error}`;
        },
      });
    }
    const system = `${config.instructions || 'You are a helpful assistant.'}\n\n# Knowledge\n${config.knowledge || '(none)'}\n\nKeep replies short and conversational.${config.leadCapture ? ' If the visitor wants a follow-up or a human, ask for their email and call capture_lead.' : ''}`;
    try {
      const r = await aiAgent({ wsId: bot.workspace_id, purpose, model: config.model || 'claude-haiku-5-5', effort: 'low', system, tools, maxIterations: 4,
        messages: msgs.slice(-20).map((m) => ({ role: m.role, content: m.content })) });
      reply = r.text || '…';
    } catch (e) { reply = `Sorry — I couldn't respond right now (${e.message}).`; }
  } else {
    reply = keywordAnswer(config.knowledge, message);
    const email = String(message).match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0];
    if (config.leadCapture && email) {
      const lead = { email, name: visitor, conversation_id: conv.id, chatbot: bot.name, captured_at: now() };
      if (config.leadTableId) { try { createRecord(bot.workspace_id, config.leadTableId, { Email: email, Status: 'New', Notes: 'Captured by chatbot' }, { source: 'chatbot' }); } catch { /* ignore */ } }
      bus.emit('chatbot.lead', { wsId: bot.workspace_id, chatbotId: bot.id, data: lead });
      actions.push({ type: 'lead', email });
      reply = `Thanks! I've passed ${email} to the team — someone will be in touch soon.`;
    }
  }
  msgs.push({ role: 'assistant', content: reply, at: now(), actions: actions.length ? actions : undefined });
  run('UPDATE conversations SET messages = ?, updated_at = ? WHERE id = ?', s(msgs), now(), conv.id);
  if (!preview) bus.emit('chatbot.message', { wsId: bot.workspace_id, chatbotId: bot.id, data: { message, reply, conversation_id: conv.id, visitor } });
  return { conversationId: conv.id, reply, actions };
}
