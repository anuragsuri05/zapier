// Ready-made flow templates shown in the Templates gallery.
const conds = (left, op, right) => [[{ left, op, right }]];

export const TEMPLATES = [
  {
    id: 'tpl_lead_router', name: 'Route inbound leads with AI', category: 'Sales', popular: true,
    description: 'Catch leads from any form via webhook, let AI classify intent, then route hot leads to Slack and log everyone in a Table.',
    definition: {
      trigger: { app: 'webhook', event: 'catch_hook', params: {} },
      steps: [
        { id: 's1', app: 'ai', action: 'classify', params: { input: '{{trigger.body.message}}', categories: 'Hot lead, Nurture, Support, Spam' } },
        { id: 's2', app: 'paths', action: 'split', params: {}, paths: [
          { id: 'p1', name: 'Hot lead', conditions: conds('{{s1.category}}', 'equals', 'Hot lead'), steps: [
            { id: 's3', app: 'slack', action: 'send_channel_message', params: { text: '🔥 Hot lead: {{trigger.body.name}} ({{trigger.body.email}}) — {{s1.reason}}' } }] },
          { id: 'p2', name: 'Everyone else', fallback: true, conditions: [], steps: [
            { id: 's4', app: 'email', action: 'send', params: { to: '{{trigger.body.email}}', subject: 'Thanks for reaching out', body: 'Hi {{trigger.body.name}},\n\nThanks — we will be in touch soon.' } }] },
        ] },
      ],
    },
  },
  {
    id: 'tpl_form_to_table', name: 'Save form submissions to a Table and email the team', category: 'Operations', popular: true,
    description: 'Every time someone submits your Interface form, store it in a Table and send a notification email.',
    definition: {
      trigger: { app: 'interfaces', event: 'form_submitted', params: {} },
      steps: [
        { id: 's1', app: 'tables', action: 'create', params: { tableId: '', data: [{ key: 'Name', value: '{{trigger.Name}}' }, { key: 'Email', value: '{{trigger.Email}}' }] } },
        { id: 's2', app: 'email', action: 'send', params: { to: 'team@example.com', subject: 'New submission from {{trigger.Name}}', body: '{{trigger}}' } },
      ],
    },
  },
  {
    id: 'tpl_rss_digest', name: 'Daily digest of new blog posts', category: 'Marketing',
    description: 'Collect new RSS items and email them as one digest once five have arrived.',
    definition: {
      trigger: { app: 'rss', event: 'new_item', params: { url: 'https://hnrss.org/frontpage' } },
      steps: [
        { id: 's1', app: 'digest', action: 'append', params: { entry: '• {{trigger.title}} — {{trigger.link}}', releaseCount: 5, separator: '\\n' } },
        { id: 's2', app: 'email', action: 'send', params: { to: 'me@example.com', subject: 'Your reading digest', body: '{{s1.digest}}' } },
      ],
    },
  },
  {
    id: 'tpl_stripe_slack', name: 'Celebrate new Stripe payments in Slack', category: 'Finance', popular: true,
    description: 'Post a message to Slack whenever a Stripe charge succeeds.',
    definition: {
      trigger: { app: 'stripe', event: 'new_charge', params: {} },
      steps: [
        { id: 's1', app: 'formatter', action: 'number', params: { transform: 'currency', input: '{{trigger.amount_decimal}}', currency: 'USD' } },
        { id: 's2', app: 'slack', action: 'send_channel_message', params: { text: '💸 New payment of {{s1.output}} from {{trigger.email}}' } },
      ],
    },
  },
  {
    id: 'tpl_github_discord', name: 'Summarize new GitHub issues into Discord', category: 'Engineering',
    description: 'When an issue is opened, AI writes a two-line summary and posts it to your Discord channel.',
    definition: {
      trigger: { app: 'github', event: 'new_issue', params: { repo: '' } },
      steps: [
        { id: 's1', app: 'ai', action: 'summarize', params: { input: '{{trigger.title}}\n\n{{trigger.body}}', style: 'tldr' } },
        { id: 's2', app: 'discord', action: 'send_message', params: { content: '🐛 **#{{trigger.number}} {{trigger.title}}**\n{{s1.summary}}\n{{trigger.html_url}}' } },
      ],
    },
  },
  {
    id: 'tpl_lead_hubspot', name: 'Extract lead details with AI and add to HubSpot', category: 'Sales',
    description: 'Turn messy inbound emails or messages into clean CRM contacts.',
    definition: {
      trigger: { app: 'webhook', event: 'catch_hook', params: {} },
      steps: [
        { id: 's1', app: 'ai', action: 'extract', params: { input: '{{trigger.body.text}}', fields: [{ key: 'email', value: 'email address' }, { key: 'first_name', value: 'first name' }, { key: 'company', value: 'company name' }] } },
        { id: 's2', app: 'hubspot', action: 'create_contact', params: { email: '{{s1.email}}', firstname: '{{s1.first_name}}', company: '{{s1.company}}' } },
      ],
    },
  },
  {
    id: 'tpl_weekly_report', name: 'Weekly metrics email', category: 'Operations',
    description: 'Every Monday at 9am, count the week number and email a status report.',
    definition: {
      trigger: { app: 'schedule', event: 'every', params: { frequency: 'week', weekday: '1', time: '09:00' } },
      steps: [
        { id: 's1', app: 'storage', action: 'increment', params: { key: 'weekly_report_count', by: 1 } },
        { id: 's2', app: 'email', action: 'send', params: { to: 'team@example.com', subject: 'Weekly report #{{s1.value}}', body: 'Good morning! This is weekly report #{{s1.value}}, generated {{trigger.pretty_time}}.' } },
      ],
    },
  },
  {
    id: 'tpl_approval', name: 'Require approval before sending refunds', category: 'Finance',
    description: 'New refund requests in a Table pause for a manager’s approval, then the customer is emailed.',
    definition: {
      trigger: { app: 'tables', event: 'new_record', params: { tableId: '' } },
      steps: [
        { id: 's1', app: 'approval', action: 'request', params: { title: 'Refund for {{trigger.Email}}', details: 'Amount: {{trigger.Amount}}\nReason: {{trigger.Reason}}', timeoutHours: 48 } },
        { id: 's2', app: 'email', action: 'send', params: { to: '{{trigger.Email}}', subject: 'Your refund was approved', body: 'Good news — your refund was approved by {{s1.decided_by}}.' } },
      ],
    },
  },
  {
    id: 'tpl_telegram_ai', name: 'AI auto-reply for Telegram', category: 'Support',
    description: 'Answer messages sent to your Telegram bot with Claude.',
    definition: {
      trigger: { app: 'telegram', event: 'new_message', params: {} },
      steps: [
        { id: 's1', app: 'ai', action: 'generate', params: { system: 'You are a friendly support assistant. Keep answers under 80 words.', instructions: '{{trigger.text}}' } },
        { id: 's2', app: 'telegram', action: 'send_message', params: { chat_id: '{{trigger.chat_id}}', text: '{{s1.output}}' } },
      ],
    },
  },
  {
    id: 'tpl_chatbot_leads', name: 'Send chatbot leads to a Table and Slack', category: 'Sales',
    description: 'When your chatbot captures a lead, store it and alert the team.',
    definition: {
      trigger: { app: 'chatbots', event: 'new_lead', params: {} },
      steps: [
        { id: 's1', app: 'tables', action: 'create', params: { tableId: '', data: [{ key: 'Name', value: '{{trigger.name}}' }, { key: 'Email', value: '{{trigger.email}}' }] } },
        { id: 's2', app: 'notify', action: 'send', params: { title: 'New chatbot lead: {{trigger.name}}', body: '{{trigger.email}}' } },
      ],
    },
  },
  {
    id: 'tpl_loop', name: 'Process a list of items one by one', category: 'Productivity',
    description: 'Run on demand with a comma-separated list; loop through each item, clean it up and store it.',
    definition: {
      trigger: { app: 'manual', event: 'run', params: { inputs: ['items'] } },
      steps: [
        { id: 's1', app: 'looping', action: 'loop', params: { items: '{{trigger.inputs.items}}', maxIterations: 50 }, steps: [
          { id: 's2', app: 'formatter', action: 'text', params: { transform: 'titlecase', input: '{{loop.item}}' } },
          { id: 's3', app: 'storage', action: 'push', params: { key: 'processed_items', value: '{{s2.output}}' } },
        ] },
      ],
    },
  },
  {
    id: 'tpl_code_webhook', name: 'Transform webhook data with code and forward it', category: 'Developer',
    description: 'Reshape incoming JSON with JavaScript, then POST it to another API.',
    definition: {
      trigger: { app: 'webhook', event: 'catch_hook', params: {} },
      steps: [
        { id: 's1', app: 'code', action: 'javascript', params: { inputData: [{ key: 'name', value: '{{trigger.body.name}}' }, { key: 'amount', value: '{{trigger.body.amount}}' }], code: "return { customer: inputData.name.toUpperCase(), cents: Math.round(Number(inputData.amount) * 100) };" } },
        { id: 's2', app: 'webhook', action: 'request', params: { method: 'POST', url: 'https://httpbin.org/post', payloadType: 'json', data: [{ key: 'customer', value: '{{s1.customer}}' }, { key: 'cents', value: '{{s1.cents}}' }] } },
      ],
    },
  },
  {
    id: 'tpl_agent', name: 'AI agent that triages requests', category: 'AI', popular: true,
    description: 'An AI step with tools: it looks up the requester in your CRM Table, adds them if new, and notifies the team.',
    definition: {
      trigger: { app: 'webhook', event: 'catch_hook', params: {} },
      steps: [
        { id: 's1', app: 'ai', action: 'agent', params: {
          goal: 'A new request arrived from {{trigger.body.email}}: "{{trigger.body.message}}". Look them up in the CRM table; if missing, create them. Then send an in-app notification summarizing the request and its urgency.',
          tools: [{ app: 'tables', action: 'find', params: {} }, { app: 'tables', action: 'create', params: {} }, { app: 'notify', action: 'send', params: {} }], maxSteps: 6 } },
      ],
    },
  },
];
