// Real third-party integrations that authenticate with API keys, tokens or webhook URLs.
import nodemailer from 'nodemailer';
import { http, parseKeyValue, parseJSONish } from './http.js';
import { decrypt } from '../db.js';

const secret = (key, label, help) => ({ key, label, type: 'password', required: true, help });
const text = (key, label, extra = {}) => ({ key, label, type: 'text', ...extra });

// ---------------------------------------------------------------- Slack
const slack = {
  key: 'slack', name: 'Slack', category: 'Communication', color: '#4A154B', icon: 'slack', letter: 'S',
  description: 'Send messages to channels and people in Slack.',
  auth: {
    fields: [
      { key: 'webhook_url', label: 'Incoming Webhook URL (optional)', type: 'password', help: 'From api.slack.com/apps → Incoming Webhooks. Used when no bot token is set.' },
      { key: 'bot_token', label: 'Bot User OAuth Token (xoxb-…)', type: 'password', help: 'Needs chat:write (and channels:history for triggers).' },
    ],
    async test(c) {
      if (c.bot_token) { const r = await http('https://slack.com/api/auth.test', { method: 'POST', auth: { bearer: c.bot_token } }); if (!r.data.ok) throw new Error(r.data.error); return { label: `${r.data.team} (${r.data.user})` }; }
      if (c.webhook_url?.startsWith('https://hooks.slack.com/')) return { label: 'Incoming webhook' };
      throw new Error('Provide a bot token or a hooks.slack.com webhook URL.');
    },
  },
  triggers: {
    new_message: { name: 'New Message in Channel', type: 'polling', fields: [text('channel', 'Channel ID', { required: true, placeholder: 'C0123456789' })],
      sample: { id: '1700000000.000100', text: 'Hello team', user: 'U123', channel: 'C123' },
      async poll({ params, creds }) {
        if (!creds.bot_token) throw new Error('This trigger requires a bot token.');
        const r = await http(`https://slack.com/api/conversations.history?channel=${encodeURIComponent(params.channel)}&limit=20`, { auth: { bearer: creds.bot_token } });
        if (!r.data.ok) throw new Error(r.data.error);
        return r.data.messages.map((m) => ({ id: m.ts, ts: m.ts, text: m.text, user: m.user, channel: params.channel }));
      } },
  },
  actions: {
    send_channel_message: { name: 'Send Channel Message', kind: 'create',
      fields: [text('channel', 'Channel (ID or #name, bot token only)'), { key: 'text', label: 'Message text', type: 'textarea', required: true }, text('username', 'Bot name'), text('icon_emoji', 'Bot icon emoji', { placeholder: ':robot_face:' })],
      sample: { ok: true, ts: '1700000000.000100', channel: 'C123' },
      async run({ params, creds }) {
        if (creds.bot_token && params.channel) {
          const r = await http('https://slack.com/api/chat.postMessage', { method: 'POST', auth: { bearer: creds.bot_token }, json: { channel: params.channel, text: params.text, username: params.username || undefined, icon_emoji: params.icon_emoji || undefined } });
          if (!r.data.ok) throw new Error(`Slack error: ${r.data.error}`);
          return { ok: true, ts: r.data.ts, channel: r.data.channel };
        }
        if (!creds.webhook_url) throw new Error('Connect Slack with a webhook URL or bot token.');
        await http(creds.webhook_url, { method: 'POST', json: { text: params.text, username: params.username || undefined, icon_emoji: params.icon_emoji || undefined } });
        return { ok: true, via: 'webhook' };
      } },
  },
};

// ---------------------------------------------------------------- Discord
const discord = {
  key: 'discord', name: 'Discord', category: 'Communication', color: '#5865F2', icon: 'discord', letter: 'D',
  description: 'Post messages to Discord channels via webhooks.',
  auth: { fields: [secret('webhook_url', 'Channel Webhook URL', 'Channel settings → Integrations → Webhooks.')],
    async test(c) { const r = await http(c.webhook_url); return { label: `#${r.data.channel_id || 'channel'} · ${r.data.name}` }; } },
  triggers: {},
  actions: {
    send_message: { name: 'Send Channel Message', kind: 'create',
      fields: [{ key: 'content', label: 'Message', type: 'textarea', required: true }, text('username', 'Bot username'), text('avatar_url', 'Avatar URL'), text('embed_title', 'Embed title (optional)'), { key: 'embed_description', label: 'Embed description', type: 'textarea' }],
      sample: { id: '1234567890', channel_id: '987' },
      async run({ params, creds }) {
        const body = { content: params.content, username: params.username || undefined, avatar_url: params.avatar_url || undefined };
        if (params.embed_title || params.embed_description) body.embeds = [{ title: params.embed_title, description: params.embed_description, color: 0x5b3df5 }];
        const r = await http(`${creds.webhook_url}?wait=true`, { method: 'POST', json: body });
        return { id: r.data.id, channel_id: r.data.channel_id, content: r.data.content };
      } },
  },
};

// ---------------------------------------------------------------- Telegram
const telegram = {
  key: 'telegram', name: 'Telegram', category: 'Communication', color: '#229ED9', icon: 'send', letter: 'T',
  description: 'Send messages with your Telegram bot and react to incoming ones.',
  auth: { fields: [secret('bot_token', 'Bot token', 'Create a bot with @BotFather.')],
    async test(c) { const r = await http(`https://api.telegram.org/bot${c.bot_token}/getMe`); return { label: `@${r.data.result.username}` }; } },
  triggers: {
    new_message: { name: 'New Message to Bot', type: 'polling', fields: [], sample: { id: '1', text: '/start', chat_id: 123, from: 'ada' },
      async poll({ creds }) {
        const r = await http(`https://api.telegram.org/bot${creds.bot_token}/getUpdates?limit=50`);
        return r.data.result.filter((u) => u.message).map((u) => ({ id: String(u.update_id), text: u.message.text, chat_id: u.message.chat.id, from: u.message.from?.username || u.message.from?.first_name, date: new Date(u.message.date * 1000).toISOString() }));
      } },
  },
  actions: {
    send_message: { name: 'Send Message', kind: 'create',
      fields: [text('chat_id', 'Chat ID', { required: true }), { key: 'text', label: 'Text', type: 'textarea', required: true }, { key: 'parse_mode', label: 'Formatting', type: 'select', default: '', options: [{ value: '', label: 'Plain' }, { value: 'MarkdownV2', label: 'Markdown' }, { value: 'HTML', label: 'HTML' }] }],
      sample: { message_id: 42, chat_id: 123 },
      async run({ params, creds }) {
        const r = await http(`https://api.telegram.org/bot${creds.bot_token}/sendMessage`, { method: 'POST', json: { chat_id: params.chat_id, text: params.text, parse_mode: params.parse_mode || undefined } });
        return { message_id: r.data.result.message_id, chat_id: r.data.result.chat.id };
      } },
  },
};

// ---------------------------------------------------------------- GitHub
const gh = (creds) => ({ auth: { bearer: creds.token }, headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } });
const github = {
  key: 'github', name: 'GitHub', category: 'Developer tools', color: '#24292F', icon: 'github', letter: 'G',
  description: 'Create issues and comments, and react to new issues and stars.',
  auth: { fields: [secret('token', 'Personal access token', 'Fine-grained token with Issues read/write.')],
    async test(c) { const r = await http('https://api.github.com/user', gh(c)); return { label: r.data.login }; } },
  triggers: {
    new_issue: { name: 'New Issue', type: 'polling', fields: [text('repo', 'Repository (owner/name)', { required: true })],
      sample: { id: '1', number: 1, title: 'Bug report', body: '…', html_url: 'https://github.com/o/r/issues/1', user: 'octocat' },
      async poll({ params, creds }) {
        const r = await http(`https://api.github.com/repos/${params.repo}/issues?state=all&sort=created&direction=desc&per_page=30`, gh(creds));
        return r.data.filter((i) => !i.pull_request).map((i) => ({ id: String(i.id), number: i.number, title: i.title, body: i.body, state: i.state, html_url: i.html_url, user: i.user?.login, labels: i.labels.map((l) => l.name), created_at: i.created_at }));
      } },
    new_star: { name: 'New Stargazer', type: 'polling', fields: [text('repo', 'Repository (owner/name)', { required: true })],
      sample: { id: 'octocat', login: 'octocat', html_url: 'https://github.com/octocat' },
      async poll({ params, creds }) {
        const r = await http(`https://api.github.com/repos/${params.repo}/stargazers?per_page=50`, gh(creds));
        return r.data.map((u) => ({ id: u.login, login: u.login, html_url: u.html_url }));
      } },
  },
  actions: {
    create_issue: { name: 'Create Issue', kind: 'create',
      fields: [text('repo', 'Repository (owner/name)', { required: true }), text('title', 'Title', { required: true }), { key: 'body', label: 'Body', type: 'textarea' }, text('labels', 'Labels (comma-separated)'), text('assignees', 'Assignees (comma-separated)')],
      sample: { number: 12, html_url: 'https://github.com/o/r/issues/12' },
      async run({ params, creds }) {
        const list = (v) => (v ? String(v).split(',').map((x) => x.trim()).filter(Boolean) : undefined);
        const r = await http(`https://api.github.com/repos/${params.repo}/issues`, { ...gh(creds), method: 'POST', json: { title: params.title, body: params.body, labels: list(params.labels), assignees: list(params.assignees) } });
        return { id: r.data.id, number: r.data.number, html_url: r.data.html_url, state: r.data.state };
      } },
    create_comment: { name: 'Create Issue Comment', kind: 'create',
      fields: [text('repo', 'Repository (owner/name)', { required: true }), text('number', 'Issue number', { required: true }), { key: 'body', label: 'Comment', type: 'textarea', required: true }],
      sample: { id: 1, html_url: '' },
      async run({ params, creds }) {
        const r = await http(`https://api.github.com/repos/${params.repo}/issues/${params.number}/comments`, { ...gh(creds), method: 'POST', json: { body: params.body } });
        return { id: r.data.id, html_url: r.data.html_url };
      } },
    find_issue: { name: 'Find Issue', kind: 'search', fields: [text('repo', 'Repository (owner/name)', { required: true }), text('query', 'Search text', { required: true })],
      sample: { found: true, issue: {} },
      async run({ params, creds }) {
        const r = await http(`https://api.github.com/search/issues?q=${encodeURIComponent(`${params.query} repo:${params.repo} is:issue`)}&per_page=5`, gh(creds));
        const i = r.data.items[0];
        return { found: Boolean(i), issue: i ? { number: i.number, title: i.title, html_url: i.html_url, state: i.state } : null, total: r.data.total_count };
      } },
  },
};

// ---------------------------------------------------------------- Notion
const nh = (c) => ({ auth: { bearer: c.token }, headers: { 'notion-version': '2022-06-28' } });
const notion = {
  key: 'notion', name: 'Notion', category: 'Productivity', color: '#000000', icon: 'notion', letter: 'N',
  description: 'Create pages and database items in Notion.',
  auth: { fields: [secret('token', 'Internal integration secret', 'notion.so/my-integrations → share your database with the integration.')],
    async test(c) { const r = await http('https://api.notion.com/v1/users/me', nh(c)); return { label: r.data.name || r.data.bot?.workspace_name || 'Notion' }; } },
  triggers: {
    new_item: { name: 'New Database Item', type: 'polling', fields: [text('database_id', 'Database ID', { required: true })], sample: { id: 'page-id', url: 'https://notion.so/…', properties: {} },
      async poll({ params, creds }) {
        const r = await http(`https://api.notion.com/v1/databases/${params.database_id}/query`, { ...nh(creds), method: 'POST', json: { page_size: 25, sorts: [{ timestamp: 'created_time', direction: 'descending' }] } });
        return r.data.results.map((p) => ({ id: p.id, url: p.url, created_time: p.created_time, properties: Object.fromEntries(Object.entries(p.properties).map(([k, v]) => [k, v.title?.[0]?.plain_text ?? v.rich_text?.[0]?.plain_text ?? v.select?.name ?? v.number ?? v.email ?? v.url ?? v.checkbox ?? v.date?.start ?? null])) }));
      } },
  },
  actions: {
    create_item: { name: 'Create Database Item', kind: 'create',
      fields: [text('database_id', 'Database ID', { required: true }), text('title_property', 'Title property name', { default: 'Name' }), text('title', 'Title', { required: true }), { key: 'properties', label: 'Other text properties', type: 'keyvalue' }, { key: 'content', label: 'Page content', type: 'textarea' }],
      sample: { id: 'page-id', url: 'https://notion.so/…' },
      async run({ params, creds }) {
        const props = { [params.title_property || 'Name']: { title: [{ text: { content: String(params.title) } }] } };
        for (const [k, v] of Object.entries(parseKeyValue(params.properties))) props[k] = { rich_text: [{ text: { content: String(v) } }] };
        const children = params.content ? String(params.content).split('\n\n').slice(0, 50).map((p) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: p.slice(0, 1900) } }] } })) : undefined;
        const r = await http('https://api.notion.com/v1/pages', { ...nh(creds), method: 'POST', json: { parent: { database_id: params.database_id }, properties: props, children } });
        return { id: r.data.id, url: r.data.url };
      } },
  },
};

// ---------------------------------------------------------------- Airtable
const airtable = {
  key: 'airtable', name: 'Airtable', category: 'Productivity', color: '#FCB400', icon: 'airtable', letter: 'A',
  description: 'Create, find and update Airtable records.',
  auth: { fields: [secret('token', 'Personal access token', 'airtable.com/create/tokens — scopes data.records:read/write.')],
    async test(c) { const r = await http('https://api.airtable.com/v0/meta/whoami', { auth: { bearer: c.token } }); return { label: r.data.email || r.data.id }; } },
  triggers: {
    new_record: { name: 'New Record', type: 'polling', fields: [text('base', 'Base ID', { required: true }), text('table', 'Table name or ID', { required: true })], sample: { id: 'rec123', fields: {} },
      async poll({ params, creds }) {
        const r = await http(`https://api.airtable.com/v0/${params.base}/${encodeURIComponent(params.table)}?pageSize=50`, { auth: { bearer: creds.token } });
        return r.data.records.map((x) => ({ id: x.id, created_time: x.createdTime, ...x.fields }));
      } },
  },
  actions: {
    create_record: { name: 'Create Record', kind: 'create', fields: [text('base', 'Base ID', { required: true }), text('table', 'Table name or ID', { required: true }), { key: 'fields', label: 'Fields', type: 'keyvalue', required: true }],
      sample: { id: 'rec123' },
      async run({ params, creds }) {
        const fields = parseKeyValue(params.fields); for (const k of Object.keys(fields)) fields[k] = parseJSONish(fields[k]);
        const r = await http(`https://api.airtable.com/v0/${params.base}/${encodeURIComponent(params.table)}`, { method: 'POST', auth: { bearer: creds.token }, json: { fields, typecast: true } });
        return { id: r.data.id, ...r.data.fields };
      } },
    find_record: { name: 'Find Record', kind: 'search', fields: [text('base', 'Base ID', { required: true }), text('table', 'Table', { required: true }), text('field', 'Field', { required: true }), text('value', 'Value', { required: true })],
      sample: { found: true, record: {} },
      async run({ params, creds }) {
        const formula = `{${params.field}} = '${String(params.value).replace(/'/g, "\\'")}'`;
        const r = await http(`https://api.airtable.com/v0/${params.base}/${encodeURIComponent(params.table)}?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`, { auth: { bearer: creds.token } });
        const rec = r.data.records[0];
        return { found: Boolean(rec), record: rec ? { id: rec.id, ...rec.fields } : null };
      } },
  },
};

// ---------------------------------------------------------------- HubSpot
const hubspot = {
  key: 'hubspot', name: 'HubSpot', category: 'CRM', color: '#FF7A59', icon: 'hubspot', letter: 'H',
  description: 'Create and update contacts and deals in HubSpot CRM.',
  auth: { fields: [secret('token', 'Private app access token', 'Settings → Integrations → Private apps (crm.objects.contacts scopes).')],
    async test(c) { const r = await http('https://api.hubapi.com/crm/v3/objects/contacts?limit=1', { auth: { bearer: c.token } }); return { label: `HubSpot (${r.data.total ?? 'connected'})` }; } },
  triggers: {
    new_contact: { name: 'New Contact', type: 'polling', fields: [], sample: { id: '101', email: 'ada@example.com', firstname: 'Ada' },
      async poll({ creds }) {
        const r = await http('https://api.hubapi.com/crm/v3/objects/contacts/search', { method: 'POST', auth: { bearer: creds.token }, json: { sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }], limit: 30, properties: ['email', 'firstname', 'lastname', 'company'] } });
        return r.data.results.map((x) => ({ id: x.id, ...x.properties }));
      } },
  },
  actions: {
    create_contact: { name: 'Create or Update Contact', kind: 'create',
      fields: [text('email', 'Email', { required: true }), text('firstname', 'First name'), text('lastname', 'Last name'), text('company', 'Company'), text('phone', 'Phone'), { key: 'extra', label: 'Other properties', type: 'keyvalue' }],
      sample: { id: '101', email: 'ada@example.com' },
      async run({ params, creds }) {
        const properties = { email: params.email, firstname: params.firstname, lastname: params.lastname, company: params.company, phone: params.phone, ...parseKeyValue(params.extra) };
        for (const k of Object.keys(properties)) if (properties[k] === '' || properties[k] == null) delete properties[k];
        const r = await http('https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert', { method: 'POST', auth: { bearer: creds.token }, json: { inputs: [{ idProperty: 'email', id: params.email, properties }] } });
        const c = r.data.results?.[0];
        return { id: c?.id, ...c?.properties };
      } },
    create_deal: { name: 'Create Deal', kind: 'create', fields: [text('dealname', 'Deal name', { required: true }), text('amount', 'Amount'), text('dealstage', 'Stage', { default: 'appointmentscheduled' }), text('pipeline', 'Pipeline', { default: 'default' })],
      sample: { id: '501' },
      async run({ params, creds }) {
        const r = await http('https://api.hubapi.com/crm/v3/objects/deals', { method: 'POST', auth: { bearer: creds.token }, json: { properties: { dealname: params.dealname, amount: params.amount, dealstage: params.dealstage, pipeline: params.pipeline } } });
        return { id: r.data.id, ...r.data.properties };
      } },
  },
};

// ---------------------------------------------------------------- Trello
const trelloQ = (c) => `key=${encodeURIComponent(c.api_key)}&token=${encodeURIComponent(c.token)}`;
const trello = {
  key: 'trello', name: 'Trello', category: 'Project management', color: '#0079BF', icon: 'trello', letter: 'T',
  description: 'Create cards and react to new cards on Trello boards.',
  auth: { fields: [secret('api_key', 'API key', 'trello.com/power-ups/admin'), secret('token', 'Token')],
    async test(c) { const r = await http(`https://api.trello.com/1/members/me?${trelloQ(c)}`); return { label: r.data.username }; } },
  triggers: {
    new_card: { name: 'New Card', type: 'polling', fields: [text('board_id', 'Board ID', { required: true })], sample: { id: 'card1', name: 'Task', url: '' },
      async poll({ params, creds }) {
        const r = await http(`https://api.trello.com/1/boards/${params.board_id}/cards?${trelloQ(creds)}`);
        return r.data.map((c) => ({ id: c.id, name: c.name, desc: c.desc, url: c.url, list_id: c.idList, due: c.due }));
      } },
  },
  actions: {
    create_card: { name: 'Create Card', kind: 'create', fields: [text('list_id', 'List ID', { required: true }), text('name', 'Card name', { required: true }), { key: 'desc', label: 'Description', type: 'textarea' }, text('due', 'Due date')],
      sample: { id: 'card1', url: 'https://trello.com/c/…' },
      async run({ params, creds }) {
        const r = await http(`https://api.trello.com/1/cards?${trelloQ(creds)}`, { method: 'POST', json: { idList: params.list_id, name: params.name, desc: params.desc, due: params.due || undefined } });
        return { id: r.data.id, url: r.data.url, name: r.data.name };
      } },
  },
};

// ---------------------------------------------------------------- Stripe
const stripe = {
  key: 'stripe', name: 'Stripe', category: 'Payments', color: '#635BFF', icon: 'stripe', letter: 'S',
  description: 'React to new payments and customers; create customers and invoices.',
  auth: { fields: [secret('secret_key', 'Secret or restricted key', 'Use a test-mode key (sk_test_…) while building.')],
    async test(c) { const r = await http('https://api.stripe.com/v1/balance', { auth: { bearer: c.secret_key } }); return { label: `Stripe (${r.data.livemode ? 'live' : 'test'} mode)` }; } },
  triggers: {
    new_charge: { name: 'New Successful Charge', type: 'polling', fields: [], sample: { id: 'ch_1', amount: 4900, currency: 'usd', email: 'ada@example.com' },
      async poll({ creds }) {
        const r = await http('https://api.stripe.com/v1/charges?limit=25', { auth: { bearer: creds.secret_key } });
        return r.data.data.filter((c) => c.paid).map((c) => ({ id: c.id, amount: c.amount, amount_decimal: c.amount / 100, currency: c.currency, email: c.billing_details?.email || c.receipt_email, description: c.description, created: new Date(c.created * 1000).toISOString() }));
      } },
    new_customer: { name: 'New Customer', type: 'polling', fields: [], sample: { id: 'cus_1', email: 'ada@example.com', name: 'Ada' },
      async poll({ creds }) {
        const r = await http('https://api.stripe.com/v1/customers?limit=25', { auth: { bearer: creds.secret_key } });
        return r.data.data.map((c) => ({ id: c.id, email: c.email, name: c.name, created: new Date(c.created * 1000).toISOString() }));
      } },
  },
  actions: {
    create_customer: { name: 'Create Customer', kind: 'create', fields: [text('email', 'Email', { required: true }), text('name', 'Name'), text('description', 'Description')],
      sample: { id: 'cus_1' },
      async run({ params, creds }) {
        const r = await http('https://api.stripe.com/v1/customers', { method: 'POST', auth: { bearer: creds.secret_key }, form: Object.fromEntries(Object.entries({ email: params.email, name: params.name, description: params.description }).filter(([, v]) => v)) });
        return { id: r.data.id, email: r.data.email, name: r.data.name };
      } },
    find_customer: { name: 'Find Customer', kind: 'search', fields: [text('email', 'Email', { required: true })], sample: { found: true, customer: {} },
      async run({ params, creds }) {
        const r = await http(`https://api.stripe.com/v1/customers?email=${encodeURIComponent(params.email)}&limit=1`, { auth: { bearer: creds.secret_key } });
        const c = r.data.data[0];
        return { found: Boolean(c), customer: c ? { id: c.id, email: c.email, name: c.name } : null };
      } },
  },
};

// ---------------------------------------------------------------- Twilio
const twilio = {
  key: 'twilio', name: 'Twilio', category: 'Communication', color: '#F22F46', icon: 'phone', letter: 'T',
  description: 'Send SMS messages with Twilio.',
  auth: { fields: [text('account_sid', 'Account SID', { required: true }), secret('auth_token', 'Auth token'), text('from', 'From number', { required: true, placeholder: '+15551234567' })],
    async test(c) { const r = await http(`https://api.twilio.com/2010-04-01/Accounts/${c.account_sid}.json`, { auth: { basic: `${c.account_sid}:${c.auth_token}` } }); return { label: r.data.friendly_name }; } },
  triggers: {},
  actions: {
    send_sms: { name: 'Send SMS', kind: 'create', fields: [text('to', 'To number', { required: true }), { key: 'body', label: 'Message', type: 'textarea', required: true }],
      sample: { sid: 'SM123', status: 'queued' },
      async run({ params, creds }) {
        const r = await http(`https://api.twilio.com/2010-04-01/Accounts/${creds.account_sid}/Messages.json`, { method: 'POST', auth: { basic: `${creds.account_sid}:${creds.auth_token}` }, form: { To: params.to, From: creds.from, Body: params.body } });
        return { sid: r.data.sid, status: r.data.status, to: r.data.to };
      } },
  },
};

// ---------------------------------------------------------------- SendGrid
const sendgrid = {
  key: 'sendgrid', name: 'SendGrid', category: 'Email', color: '#1A82E2', icon: 'mail', letter: 'S',
  description: 'Send transactional email through SendGrid.',
  auth: { fields: [secret('api_key', 'API key'), text('from', 'Verified sender email', { required: true })],
    async test(c) { await http('https://api.sendgrid.com/v3/scopes', { auth: { bearer: c.api_key } }); return { label: c.from }; } },
  triggers: {},
  actions: {
    send_email: { name: 'Send Email', kind: 'create', fields: [text('to', 'To', { required: true }), text('subject', 'Subject', { required: true }), { key: 'body', label: 'Body (HTML allowed)', type: 'textarea', required: true }],
      sample: { accepted: true },
      async run({ params, creds }) {
        await http('https://api.sendgrid.com/v3/mail/send', { method: 'POST', auth: { bearer: creds.api_key }, json: { personalizations: [{ to: [{ email: params.to }] }], from: { email: creds.from }, subject: params.subject, content: [{ type: 'text/html', value: params.body }] } });
        return { accepted: true, to: params.to };
      } },
  },
};

// ---------------------------------------------------------------- SMTP (used by Email by OneTier when connected)
export async function sendSmtp(encrypted, params) {
  const c = decrypt(encrypted);
  const t = nodemailer.createTransport({ host: c.host, port: Number(c.port) || 587, secure: Number(c.port) === 465, auth: { user: c.username, pass: c.password } });
  const info = await t.sendMail({ from: `"${params.fromName || 'OneTier'}" <${c.from || c.username}>`, to: params.to, subject: params.subject, [params.html ? 'html' : 'text']: params.body });
  return { id: info.messageId, accepted: info.accepted };
}
const smtp = {
  key: 'smtp', name: 'SMTP', category: 'Email', color: '#495057', icon: 'server', letter: 'M',
  description: 'Send email from your own mail server. When connected, Email by OneTier delivers through it.',
  auth: { fields: [text('host', 'SMTP host', { required: true }), text('port', 'Port', { default: '587' }), text('username', 'Username', { required: true }), secret('password', 'Password'), text('from', 'From address')],
    async test(c) { const t = nodemailer.createTransport({ host: c.host, port: Number(c.port) || 587, secure: Number(c.port) === 465, auth: { user: c.username, pass: c.password } }); await t.verify(); return { label: `${c.username}@${c.host}` }; } },
  triggers: {},
  actions: {
    send: { name: 'Send Email via SMTP', kind: 'create', fields: [text('to', 'To', { required: true }), text('subject', 'Subject', { required: true }), { key: 'body', label: 'Body', type: 'textarea', required: true }, { key: 'html', label: 'HTML', type: 'boolean' }],
      sample: { id: '<msg@host>' },
      async run({ params, ctx }) { return sendSmtp(ctx.rawCreds, params); } },
  },
};

// ---------------------------------------------------------------- Anthropic (connection for AI by OneTier)
const anthropic = {
  key: 'anthropic', name: 'Anthropic (Claude)', category: 'AI', color: '#D97757', icon: 'sparkles', letter: 'A',
  description: 'Connect your Anthropic API key to power AI steps, Copilot and Chatbots.',
  auth: { fields: [secret('api_key', 'API key', 'console.anthropic.com → API keys')],
    async test(c) { await http('https://api.anthropic.com/v1/models?limit=1', { headers: { 'x-api-key': c.api_key, 'anthropic-version': '2023-06-01' } }); return { label: 'Claude API' }; } },
  triggers: {}, actions: {},
};

export const EXTERNAL_APPS = [slack, discord, telegram, github, notion, airtable, hubspot, trello, stripe, twilio, sendgrid, smtp, anthropic];
