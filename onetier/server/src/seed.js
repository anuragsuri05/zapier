import crypto from 'node:crypto';
import { run, uid, now, s } from './db.js';
import { notify } from './services.js';

const slug = (n) => `${n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${crypto.randomBytes(3).toString('hex')}`;

/** Give a new workspace useful starter content so every product area has something in it. */
export function seedWorkspace(wsId, userId, { minimal = false } = {}) {
  const t = now();
  notify(wsId, { type: 'info', title: 'Welcome to OneTier 👋', body: 'Start with a template, describe a flow to Copilot, or build one from scratch.', link: '/templates' });
  if (minimal) return;

  // Table
  const tableId = uid('tbl_');
  const f = (name, type, extra = {}) => ({ id: uid('fld_'), name, type, ...extra });
  const fields = [f('Name', 'text'), f('Email', 'email'), f('Company', 'text'), f('Status', 'select', { options: ['New', 'Contacted', 'Qualified', 'Won', 'Lost'] }), f('Deal size', 'currency'), f('Notes', 'long_text')];
  run('INSERT INTO tables_ (id, workspace_id, name, description, fields, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', tableId, wsId, 'Leads', 'Inbound leads from forms, chatbots and webhooks', s(fields), t, t);
  const rows = [
    ['Ada Lovelace', 'ada@analytical.io', 'Analytical Engines', 'Qualified', 12000, 'Wants the Team plan for 12 seats.'],
    ['Grace Hopper', 'grace@cobol.dev', 'Compiler Co', 'Contacted', 4800, 'Asked about SSO.'],
    ['Alan Turing', 'alan@enigma.uk', 'Bletchley Labs', 'New', 0, ''],
    ['Katherine Johnson', 'kj@orbit.space', 'Orbit Analytics', 'Won', 22000, 'Signed annual contract.'],
  ];
  for (const r of rows) {
    const data = Object.fromEntries(fields.map((fl, i) => [fl.id, r[i]]));
    run('INSERT INTO table_records (id, table_id, data, created_at, updated_at) VALUES (?,?,?,?,?)', uid('rec_'), tableId, s(data), t, t);
  }

  // Interface with a form
  const ifaceId = uid('ifc_');
  const formBlock = uid('blk_');
  const config = {
    theme: { primary: '#5B3DF5', background: '#F7F6FF', font: 'Inter', layout: 'centered' },
    blocks: [
      { id: uid('blk_'), type: 'heading', text: 'Talk to our team', size: 'xl' },
      { id: uid('blk_'), type: 'text', text: 'Tell us a little about your project and we will get back to you within one business day.' },
      { id: formBlock, type: 'form', title: 'Contact us', submitText: 'Send message', successMessage: 'Thanks! We will be in touch shortly.', saveToTable: tableId,
        fields: [
          { id: uid('ff_'), label: 'Name', type: 'text', required: true, placeholder: 'Ada Lovelace' },
          { id: uid('ff_'), label: 'Email', type: 'email', required: true, placeholder: 'you@company.com' },
          { id: uid('ff_'), label: 'Company', type: 'text' },
          { id: uid('ff_'), label: 'Notes', type: 'textarea', placeholder: 'What would you like to automate?' },
        ] },
    ],
  };
  run('INSERT INTO interfaces (id, workspace_id, name, slug, config, published, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)', ifaceId, wsId, 'Contact form', slug('contact'), s(config), 1, t, t);

  // Chatbot
  run('INSERT INTO chatbots (id, workspace_id, name, slug, config, published, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)', uid('bot_'), wsId, 'Support assistant', slug('support'), s({
    greeting: 'Hi! 👋 I can answer questions about our product and plans. What can I help with?',
    instructions: 'You are a friendly, concise support assistant. Answer only from the knowledge provided. If you do not know, offer to connect the visitor with a human and ask for their email.',
    knowledge: 'OneTier connects your apps and automates work.\nPricing: OneTier is completely free — unlimited flows, tasks, apps, tables, interfaces, chatbots and teammates. There are no paid plans.\nSupport hours: Monday–Friday, 9am–6pm.',
    model: 'claude-haiku-5-5', leadCapture: true, leadTableId: tableId, suggested: ['How much does it cost?', 'Can I talk to a human?'],
    theme: { primary: '#5B3DF5', avatar: '🤖', position: 'right' },
  }), 1, t, t);

  // Draft flow wired to the seed form + table
  const def = {
    trigger: { app: 'interfaces', event: 'form_submitted', params: { interfaceId: ifaceId, blockId: formBlock }, sample: { Name: 'Ada Lovelace', Email: 'ada@analytical.io', Company: 'Analytical Engines', Notes: 'We want to automate onboarding.', submitted_at: t } },
    steps: [
      { id: 's1', app: 'formatter', action: 'text', params: { transform: 'titlecase', input: '{{trigger.Name}}' } },
      { id: 's2', app: 'email', action: 'send', params: { to: '{{trigger.Email}}', subject: 'Thanks for contacting us, {{s1.output}}!', body: 'Hi {{s1.output}},\n\nThanks for reaching out about {{trigger.Company}}. A specialist will reply within one business day.\n\n— The OneTier team', fromName: 'OneTier' } },
      { id: 's3', app: 'notify', action: 'send', params: { title: 'New contact: {{s1.output}}', body: '{{trigger.Email}} · {{trigger.Company}}', link: '/tables' } },
    ],
  };
  run('INSERT INTO flows (id, workspace_id, name, description, status, definition, hook_secret, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    uid('flw_'), wsId, 'Welcome new contacts', 'Reply to every contact-form submission and alert the team.', 'draft', s(def), crypto.randomBytes(12).toString('hex'), userId, t, t);

  // Canvas
  const n = (id, type, x, y, label, extra = {}) => ({ id, type: 'process', position: { x, y }, data: { kind: type, label, ...extra } });
  run('INSERT INTO canvases (id, workspace_id, name, data, created_at, updated_at) VALUES (?,?,?,?,?,?)', uid('cnv_'), wsId, 'Lead-to-customer process', s({
    nodes: [
      n('n1', 'start', 0, 0, 'Visitor submits contact form'), n('n2', 'flow', 0, 140, 'Auto-reply & notify', { status: 'automated' }),
      n('n3', 'decision', 0, 280, 'Qualified lead?'), n('n4', 'manual', -220, 420, 'Sales call'), n('n5', 'table', 220, 420, 'Add to nurture list'),
      n('n6', 'end', -220, 560, 'Customer won'),
    ],
    edges: [['n1', 'n2'], ['n2', 'n3'], ['n3', 'n4', 'Yes'], ['n3', 'n5', 'No'], ['n4', 'n6']].map(([a, b, label], i) => ({ id: `e${i}`, source: a, target: b, label })),
  }), t, t);
}
