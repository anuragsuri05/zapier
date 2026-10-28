// Copilot: natural language → flow drafts, canvases, and help answers.
import { aiJSON, aiText, aiConfigured } from './ai.js';
import { listApps } from './apps/registry.js';

const kvArr = { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key', 'value'], additionalProperties: false } };
const FLOW_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' }, description: { type: 'string' }, explanation: { type: 'string' },
    trigger: { type: 'object', properties: { app: { type: 'string' }, event: { type: 'string' }, params: kvArr }, required: ['app', 'event', 'params'], additionalProperties: false },
    steps: { type: 'array', items: { type: 'object', properties: { app: { type: 'string' }, action: { type: 'string' }, title: { type: 'string' }, params: kvArr }, required: ['app', 'action', 'title', 'params'], additionalProperties: false } },
  },
  required: ['name', 'description', 'explanation', 'trigger', 'steps'],
  additionalProperties: false,
};

function catalog(wsId) {
  return listApps(wsId).filter((a) => !['paths', 'looping'].includes(a.key)).map((a) => {
    const t = Object.entries(a.triggers || {}).map(([k, v]) => `    trigger ${k}: ${v.name} — fields: ${(v.fields || []).map((f) => f.key).join(', ') || 'none'} — output looks like: ${JSON.stringify(v.sample || {}).slice(0, 200)}`);
    const ac = Object.entries(a.actions || {}).map(([k, v]) => `    action ${k}: ${v.name} — fields: ${(v.fields || []).map((f) => `${f.key}${f.required ? '*' : ''}`).join(', ') || 'none'}`);
    return `- ${a.key} (${a.name})\n${[...t, ...ac].join('\n')}`;
  }).join('\n');
}

const fromKv = (arr) => Object.fromEntries((arr || []).map(({ key, value }) => [key, value]));

function sanitize(def, wsId) {
  const apps = new Map(listApps(wsId).map((a) => [a.key, a]));
  const t = def.trigger || {};
  const tApp = apps.get(t.app);
  const trigger = tApp?.triggers?.[t.event] ? { app: t.app, event: t.event, params: fromKv(t.params) } : { app: 'manual', event: 'run', params: {} };
  const steps = [];
  let i = 1;
  for (const st of def.steps || []) {
    const app = apps.get(st.app);
    if (!app?.actions?.[st.action]) continue;
    const params = fromKv(st.params);
    if (st.app === 'filter') {
      const c = params.conditions || '';
      const m = String(c).match(/(\{\{[^}]+\}\})\s*(equals|contains|gt|lt|exists|not_equals)?\s*(.*)/);
      steps.push({ id: `s${i++}`, app: 'filter', action: 'check', title: st.title, params: { conditions: [[{ left: m?.[1] || params.left || '', op: m?.[2] || params.op || 'exists', right: m?.[3] || params.right || '' }]] } });
      continue;
    }
    for (const f of app.actions[st.action].fields || []) {
      if (['keyvalue', 'tablefields'].includes(f.type) && typeof params[f.key] === 'string') {
        params[f.key] = params[f.key].split(/[\n;]/).map((l) => l.split(/[=:]/)).filter((x) => x[0]?.trim()).map(([k, ...v]) => ({ key: k.trim(), value: v.join(':').trim() }));
      }
    }
    steps.push({ id: `s${i++}`, app: st.app, action: st.action, title: st.title, params });
  }
  return { trigger, steps };
}

// ---------------------------------------------------------------- heuristic fallback (works without an API key)
const RULES_TRIGGERS = [
  [/stripe|payment|charge/i, { app: 'stripe', event: 'new_charge', params: {} }],
  [/github.*(issue)|new issue/i, { app: 'github', event: 'new_issue', params: { repo: '' } }],
  [/\brss\b|feed|blog post/i, { app: 'rss', event: 'new_item', params: { url: '' } }],
  [/telegram/i, { app: 'telegram', event: 'new_message', params: {} }],
  [/hubspot.*(contact)/i, { app: 'hubspot', event: 'new_contact', params: {} }],
  [/chatbot|chat bot/i, { app: 'chatbots', event: 'new_lead', params: {} }],
  [/form|submission|submits/i, { app: 'interfaces', event: 'form_submitted', params: {} }],
  [/(new|added).*(row|record)|table/i, { app: 'tables', event: 'new_record', params: {} }],
  [/every (day|morning|week|monday|hour)|daily|weekly|hourly|schedule/i, { app: 'schedule', event: 'every', params: { frequency: 'day', time: '09:00' } }],
  [/webhook|api call|http request comes|receive/i, { app: 'webhook', event: 'catch_hook', params: {} }],
];
const RULES_ACTIONS = [
  [/summari[sz]e/i, () => ({ app: 'ai', action: 'summarize', params: { input: '{{trigger}}', style: 'bullets' }, title: 'Summarize with AI' })],
  [/classif|categori[sz]e|sentiment|triage/i, () => ({ app: 'ai', action: 'classify', params: { input: '{{trigger}}', categories: 'Sales, Support, Billing, Other' }, title: 'Classify with AI' })],
  [/extract/i, () => ({ app: 'ai', action: 'extract', params: { input: '{{trigger}}', fields: [{ key: 'name', value: 'person name' }, { key: 'email', value: 'email address' }] }, title: 'Extract details with AI' })],
  [/(write|draft|generate|reply).*(ai|claude)?/i, () => ({ app: 'ai', action: 'generate', params: { instructions: 'Write a short, friendly reply to: {{trigger}}' }, title: 'Draft with AI' })],
  [/slack/i, () => ({ app: 'slack', action: 'send_channel_message', params: { text: 'New event: {{trigger}}' }, title: 'Post to Slack' })],
  [/discord/i, () => ({ app: 'discord', action: 'send_message', params: { content: 'New event: {{trigger}}' }, title: 'Post to Discord' })],
  [/telegram/i, () => ({ app: 'telegram', action: 'send_message', params: { chat_id: '', text: '{{trigger}}' }, title: 'Send Telegram message' })],
  [/sms|text message|twilio/i, () => ({ app: 'twilio', action: 'send_sms', params: { to: '', body: '{{trigger}}' }, title: 'Send SMS' })],
  [/notion/i, () => ({ app: 'notion', action: 'create_item', params: { database_id: '', title: 'New item' }, title: 'Create Notion item' })],
  [/airtable/i, () => ({ app: 'airtable', action: 'create_record', params: { base: '', table: '', fields: [] }, title: 'Create Airtable record' })],
  [/hubspot|crm/i, () => ({ app: 'hubspot', action: 'create_contact', params: { email: '{{trigger.email}}' }, title: 'Add HubSpot contact' })],
  [/trello|card/i, () => ({ app: 'trello', action: 'create_card', params: { list_id: '', name: 'New card' }, title: 'Create Trello card' })],
  [/github issue|create (an )?issue/i, () => ({ app: 'github', action: 'create_issue', params: { repo: '', title: 'New issue' }, title: 'Create GitHub issue' })],
  [/(save|add|store|log).*(table|sheet|spreadsheet|database)/i, () => ({ app: 'tables', action: 'create', params: { tableId: '', data: [] }, title: 'Save to Table' })],
  [/e-?mail/i, () => ({ app: 'email', action: 'send', params: { to: '', subject: 'Notification', body: '{{trigger}}' }, title: 'Send email' })],
  [/notif|alert/i, () => ({ app: 'notify', action: 'send', params: { title: 'New event', body: '{{trigger}}' }, title: 'Send notification' })],
  [/post to|send to|call (an )?api|http/i, () => ({ app: 'webhook', action: 'request', params: { method: 'POST', url: '' }, title: 'Send HTTP request' })],
];

function heuristicFlow(prompt) {
  const trigger = (RULES_TRIGGERS.find(([re]) => re.test(prompt)) || [null, { app: 'manual', event: 'run', params: {} }])[1];
  const steps = [];
  const onlyIf = prompt.match(/only (if|when) ([^,.]+)/i);
  if (onlyIf) steps.push({ app: 'filter', action: 'check', title: `Only continue if ${onlyIf[2]}`, params: { conditions: [[{ left: '', op: 'contains', right: onlyIf[2].split(' ').pop() }]] } });
  const parts = prompt.split(/\bthen\b|,|\band\b/i);
  for (const p of parts) for (const [re, mk] of RULES_ACTIONS) if (re.test(p) && !steps.some((x) => x.app === mk().app && x.action === mk().action)) { steps.push(mk()); break; }
  if (!steps.length) steps.push({ app: 'notify', action: 'send', title: 'Send notification', params: { title: 'Flow ran', body: '{{trigger}}' } });
  return {
    name: prompt.length > 60 ? `${prompt.slice(0, 57)}…` : prompt, description: prompt,
    explanation: 'Drafted with keyword matching (add an Anthropic API key in Settings → AI for full AI drafting). Review each step and fill in the highlighted fields.',
    trigger, steps: steps.map((s, i) => ({ id: `s${i + 1}`, ...s })),
  };
}

export async function draftFlow(wsId, prompt) {
  if (!aiConfigured(wsId)) return heuristicFlow(prompt);
  const { data } = await aiJSON({ wsId, effort: 'medium', schema: FLOW_SCHEMA,
    system: 'You design automations for OneTier, a Zapier-style workflow platform. Use only apps, triggers, actions and field keys from the catalog. Map data from earlier steps with {{trigger.field}} or {{s1.field}} (steps are numbered s1, s2, … in order). For a filter step use app "filter", action "check" and one param "conditions" written like "{{trigger.amount}} gt 100" (ops: equals, contains, gt, lt, exists, not_equals). Leave values you cannot know (IDs, channel names, emails) as empty strings.',
    prompt: `Catalog:\n${catalog(wsId)}\n\nBuild a flow for this request:\n"${prompt}"` });
  const def = sanitize(data, wsId);
  return { name: data.name, description: data.description, explanation: data.explanation, ...def };
}

export async function draftCanvas(wsId, description) {
  const heuristic = () => {
    const parts = description.split(/\bthen\b|\.|\n|->|→/i).map((s) => s.trim()).filter(Boolean).slice(0, 12);
    const nodes = parts.map((p, i) => ({ id: `n${i + 1}`, type: 'process', position: { x: 0, y: i * 130 },
      data: { kind: i === 0 ? 'start' : i === parts.length - 1 ? 'end' : /\?|if |whether/i.test(p) ? 'decision' : /email|notify|send|save|create|update|post/i.test(p) ? 'flow' : 'manual', label: p } }));
    return { nodes, edges: nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: nodes[i].id, target: n.id })) };
  };
  if (!aiConfigured(wsId)) return heuristic();
  const { data } = await aiJSON({ wsId, effort: 'low',
    schema: { type: 'object', properties: {
      nodes: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, kind: { type: 'string', enum: ['start', 'end', 'manual', 'flow', 'decision', 'table', 'interface', 'chatbot', 'note'] }, label: { type: 'string' }, lane: { type: 'integer' }, row: { type: 'integer' } }, required: ['id', 'kind', 'label', 'lane', 'row'], additionalProperties: false } },
      edges: { type: 'array', items: { type: 'object', properties: { source: { type: 'string' }, target: { type: 'string' }, label: { type: 'string' } }, required: ['source', 'target', 'label'], additionalProperties: false } },
    }, required: ['nodes', 'edges'], additionalProperties: false },
    prompt: `Map this business process as a flowchart. Use "flow" for steps that should be automated, "manual" for human steps, "decision" for branches, and lane/row for a grid layout (lane = column, row = order).\n\nProcess: ${description}` });
  return {
    nodes: data.nodes.map((n) => ({ id: n.id, type: 'process', position: { x: n.lane * 260, y: n.row * 130 }, data: { kind: n.kind, label: n.label } })),
    edges: data.edges.map((e, i) => ({ id: `e${i}`, source: e.source, target: e.target, label: e.label || undefined })),
  };
}

const HELP = [
  [/webhook/i, 'Use "Webhooks by OneTier → Catch Hook" as the trigger. Publish the flow, then send a POST to the URL shown in the trigger panel. Add ?wait=true to get the run result back synchronously.'],
  [/task|limit|billing|plan/i, 'Each successful action step uses 1 task (AI steps use 2, MCP tool calls use 2). Triggers, Filters, Paths, Formatter, Delay, Storage and Tables are free. See Settings → Billing & usage.'],
  [/path|branch/i, 'Add a "Paths by OneTier" step. Each path has its own conditions and steps; all matching paths run, and the fallback path runs when none match.'],
  [/loop/i, 'Add "Looping by OneTier" and map a list. Steps nested inside run once per item; use {{loop.item}} in their fields.'],
  [/mcp|claude|chatgpt|cursor/i, 'Go to MCP in the sidebar, create a server, choose which actions to expose and paste the server URL into your AI client.'],
  [/error|fail|replay/i, 'Open History, choose the failed run to see each step’s input and output, fix the step, then click Replay.'],
];
export async function copilotChat(wsId, messages, context = '') {
  const last = messages[messages.length - 1]?.content || '';
  if (!aiConfigured(wsId)) {
    const hit = HELP.find(([re]) => re.test(last));
    return hit ? hit[1] : 'I can help you build flows, explain features and debug runs. Describe what you want to automate (e.g. "When a form is submitted, save it to a table and email me") and click "Draft flow". For full conversational answers, add an Anthropic API key in Settings → AI.';
  }
  const r = await aiText({ wsId, effort: 'low',
    system: `You are OneTier Copilot, an assistant inside a Zapier-style automation platform. Be concise and practical. Products: Flows (trigger + actions, Filters, Paths, Looping, Delay, Sub-flows, Digest, Storage, Code, Webhooks, AI steps with tools, Human approvals), Tables, Interfaces, Chatbots, Canvas, MCP, Developer platform. Pricing: tasks = successful actions; built-in tools are free.${context ? `\n\nCurrent context:\n${context}` : ''}`,
    messages: messages.slice(-12).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) })) });
  return r.text;
}
