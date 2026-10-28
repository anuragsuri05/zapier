import { spawn } from 'node:child_process';
import { XMLParser } from 'fast-xml-parser';
import { http, parseKeyValue, parseJSONish } from './http.js';
import { aiText, aiJSON, aiAgent, MODEL_FIELD } from '../ai.js';
import * as svc from '../services.js';
import { get, all, j } from '../db.js';

const tableField = { key: 'tableId', label: 'Table', type: 'select', dynamic: 'tables', required: true };
const conditionsField = { key: 'conditions', label: 'Only continue if…', type: 'conditions', required: true };

// ---------------------------------------------------------------- Webhooks
const webhook = {
  key: 'webhook', name: 'Webhooks by OneTier', category: 'Developer tools', color: '#E8590C', icon: 'webhook', builtin: true,
  description: 'Receive data from any app with a unique URL, or send HTTP requests to any API.',
  triggers: {
    catch_hook: {
      name: 'Catch Hook', type: 'instant', description: 'Wait for a new POST, PUT or GET to a OneTier URL.',
      fields: [{ key: 'pick', label: 'Pick off a child key (optional)', type: 'text', placeholder: 'e.g. data.order' }],
      sample: { body: { name: 'Ada Lovelace', email: 'ada@example.com', plan: 'pro', amount: 49 }, query: {}, method: 'POST' },
    },
    catch_raw: {
      name: 'Catch Raw Hook', type: 'instant', description: 'Receive the raw request body and headers.',
      fields: [], sample: { raw_body: '{"hello":"world"}', headers: { 'content-type': 'application/json' }, method: 'POST' },
    },
  },
  actions: {
    request: {
      name: 'Custom Request', kind: 'create', description: 'Send a fully customized HTTP request to any URL.',
      fields: [
        { key: 'method', label: 'Method', type: 'select', default: 'POST', options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((v) => ({ value: v, label: v })) },
        { key: 'url', label: 'URL', type: 'text', required: true, placeholder: 'https://api.example.com/items' },
        { key: 'payloadType', label: 'Payload type', type: 'select', default: 'json', options: [{ value: 'json', label: 'JSON' }, { value: 'form', label: 'Form' }, { value: 'raw', label: 'Raw' }] },
        { key: 'data', label: 'Data', type: 'keyvalue', help: 'Key/value pairs sent as the body (or query string for GET).' },
        { key: 'rawBody', label: 'Raw body', type: 'code', help: 'Used when payload type is Raw. Overrides Data.' },
        { key: 'headers', label: 'Headers', type: 'keyvalue' },
        { key: 'basicAuth', label: 'Basic auth (user|pass)', type: 'text' },
        { key: 'unflatten', label: 'Parse JSON values', type: 'boolean', default: true },
      ],
      sample: { status: 200, data: { id: 123, ok: true } },
      async run({ params }) {
        const method = (params.method || 'POST').toUpperCase();
        let url = params.url;
        if (!/^https?:\/\//.test(url || '')) throw new Error('A valid http(s) URL is required.');
        const data = parseKeyValue(params.data);
        if (params.unflatten !== false) for (const k of Object.keys(data)) data[k] = parseJSONish(data[k]);
        const headers = parseKeyValue(params.headers);
        const opts = { method, headers };
        if (params.basicAuth) opts.auth = { basic: params.basicAuth.replace('|', ':') };
        if (method === 'GET' || method === 'DELETE') {
          if (Object.keys(data).length) url += (url.includes('?') ? '&' : '?') + new URLSearchParams(data).toString();
        } else if (params.payloadType === 'raw' || params.rawBody) opts.body = typeof params.rawBody === 'string' ? params.rawBody : JSON.stringify(params.rawBody);
        else if (params.payloadType === 'form') opts.form = data;
        else opts.json = data;
        const r = await http(url, opts);
        return { status: r.status, data: r.data, headers: r.headers };
      },
    },
    get: {
      name: 'GET', kind: 'search', description: 'Fetch data from a URL.',
      fields: [{ key: 'url', label: 'URL', type: 'text', required: true }, { key: 'query', label: 'Query string', type: 'keyvalue' }, { key: 'headers', label: 'Headers', type: 'keyvalue' }],
      sample: { status: 200, data: {} },
      async run({ params }) {
        let url = params.url;
        const q = parseKeyValue(params.query);
        if (Object.keys(q).length) url += (url.includes('?') ? '&' : '?') + new URLSearchParams(q);
        const r = await http(url, { headers: parseKeyValue(params.headers) });
        return { status: r.status, data: r.data };
      },
    },
  },
};

// ---------------------------------------------------------------- Schedule & manual
const schedule = {
  key: 'schedule', name: 'Schedule by OneTier', category: 'Built-in tools', color: '#7048E8', icon: 'calendar-clock', builtin: true,
  description: 'Trigger flows every hour, day, week, month or custom interval.',
  triggers: {
    every: {
      name: 'Every Interval', type: 'schedule', description: 'Runs on a recurring schedule.',
      fields: [
        { key: 'frequency', label: 'Frequency', type: 'select', default: 'day', options: [
          { value: 'minutes', label: 'Every N minutes' }, { value: 'hour', label: 'Every hour' }, { value: 'day', label: 'Every day' },
          { value: 'week', label: 'Every week' }, { value: 'month', label: 'Every month' }] },
        { key: 'interval', label: 'Minutes between runs', type: 'number', default: 15, help: 'Only for "Every N minutes". Minimum is your plan polling interval.' },
        { key: 'time', label: 'Time of day (HH:MM, server local time)', type: 'text', default: '09:00' },
        { key: 'weekday', label: 'Day of week', type: 'select', default: '1', options: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => ({ value: String(i), label: d })) },
        { key: 'monthday', label: 'Day of month', type: 'number', default: 1 },
        { key: 'weekdaysOnly', label: 'Trigger on weekends?', type: 'boolean', default: true },
      ],
      sample: { pretty_time: 'Monday 09:00', iso: '2026-10-19T09:00:00.000Z', day_of_week: 'Monday', date: '2026-10-19' },
    },
  },
  actions: {},
};

const manual = {
  key: 'manual', name: 'Manual / Button', category: 'Built-in tools', color: '#495057', icon: 'mouse-pointer-click', builtin: true,
  description: 'Run a flow on demand from the app, an Interface button, or the API.',
  triggers: {
    run: {
      name: 'Run on demand', type: 'instant', description: 'Start this flow with a button, the API, or MCP.',
      fields: [{ key: 'inputs', label: 'Input fields', type: 'list', help: 'Names of inputs to ask for when run manually.' }],
      sample: { triggered_by: 'Ada Lovelace', inputs: {} },
    },
  },
  actions: {},
};

// ---------------------------------------------------------------- Control flow (engine-handled)
const filter = {
  key: 'filter', name: 'Filter by OneTier', category: 'Built-in tools', color: '#F76707', icon: 'filter', builtin: true, control: true,
  description: 'Only continue if conditions are met. Free — does not use tasks.',
  triggers: {},
  actions: { check: { name: 'Only continue if…', kind: 'control', billable: false, fields: [conditionsField], sample: { passed: true } } },
};
const paths = {
  key: 'paths', name: 'Paths by OneTier', category: 'Built-in tools', color: '#1971C2', icon: 'split', builtin: true, control: true, requiresPaths: true,
  description: 'Branch into different paths with their own rules and steps.',
  triggers: {},
  actions: { split: { name: 'Split into paths', kind: 'control', billable: false, fields: [], sample: { matched: ['Path A'] } } },
};
const looping = {
  key: 'looping', name: 'Looping by OneTier', category: 'Built-in tools', color: '#0C8599', icon: 'repeat', builtin: true, control: true,
  description: 'Run the nested steps once for each item in a list.',
  triggers: {},
  actions: {
    loop: {
      name: 'Loop over line items', kind: 'control', billable: false,
      fields: [
        { key: 'items', label: 'Values to loop', type: 'text', required: true, help: 'Map a list (array) or a comma-separated value.' },
        { key: 'maxIterations', label: 'Max iterations', type: 'number', default: 100 },
      ],
      sample: { iterations: 3, items: ['a', 'b', 'c'] },
    },
  },
};
const delay = {
  key: 'delay', name: 'Delay by OneTier', category: 'Built-in tools', color: '#5C940D', icon: 'timer', builtin: true, control: true,
  description: 'Pause a flow for an amount of time or until a specific date.',
  triggers: {},
  actions: {
    for: {
      name: 'Delay For', kind: 'control', billable: false,
      fields: [
        { key: 'amount', label: 'Time delayed for (value)', type: 'number', required: true, default: 5 },
        { key: 'unit', label: 'Unit', type: 'select', default: 'minutes', options: ['seconds', 'minutes', 'hours', 'days', 'weeks'].map((v) => ({ value: v, label: v })) },
      ],
      sample: { resumed_at: '2026-10-15T10:05:00.000Z' },
    },
    until: {
      name: 'Delay Until', kind: 'control', billable: false,
      fields: [{ key: 'until', label: 'Date/time to delay until', type: 'text', required: true, placeholder: '2026-12-01T09:00 or a mapped date' }],
      sample: { resumed_at: '2026-12-01T09:00:00.000Z' },
    },
  },
};
const approval = {
  key: 'approval', name: 'Human in the Loop', category: 'Built-in tools', color: '#C2255C', icon: 'user-check', builtin: true, control: true,
  description: 'Pause the flow until a teammate approves or rejects.',
  triggers: {},
  actions: {
    request: {
      name: 'Request Approval', kind: 'control', billable: false,
      fields: [
        { key: 'title', label: 'Request title', type: 'text', required: true, default: 'Please review' },
        { key: 'details', label: 'Details shown to the reviewer', type: 'textarea' },
        { key: 'timeoutHours', label: 'Auto-reject after (hours)', type: 'number', default: 72 },
      ],
      sample: { status: 'approved', decided_by: 'Ada Lovelace', comment: '' },
    },
  },
};
const digest = {
  key: 'digest', name: 'Digest by OneTier', category: 'Built-in tools', color: '#862E9C', icon: 'layers', builtin: true, control: true,
  description: 'Collect items and release them together as one summary.',
  triggers: {},
  actions: {
    append: {
      name: 'Append Entry and Schedule Digest', kind: 'control', billable: false,
      fields: [
        { key: 'entry', label: 'Entry', type: 'textarea', required: true },
        { key: 'releaseCount', label: 'Release when this many entries collected', type: 'number', default: 5 },
        { key: 'separator', label: 'Separator', type: 'text', default: '\\n' },
      ],
      sample: { released: true, count: 5, digest: 'entry 1\nentry 2', entries: [] },
    },
  },
};

// ---------------------------------------------------------------- Formatter
const caseTitle = (s) => s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
const TEXT_OPS = {
  uppercase: (v) => v.toUpperCase(), lowercase: (v) => v.toLowerCase(), titlecase: caseTitle,
  capitalize: (v) => v.charAt(0).toUpperCase() + v.slice(1), trim: (v) => v.trim(),
  length: (v) => v.length, word_count: (v) => (v.trim() ? v.trim().split(/\s+/).length : 0),
  slugify: (v) => v.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
  strip_html: (v) => v.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim(),
  url_encode: (v) => encodeURIComponent(v), url_decode: (v) => decodeURIComponent(v),
  extract_email: (v) => (v.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [''])[0],
  extract_url: (v) => (v.match(/https?:\/\/[^\s"'<>]+/) || [''])[0],
  extract_number: (v) => { const m = v.match(/-?\d+(?:[.,]\d+)?/); return m ? Number(m[0].replace(',', '.')) : null; },
  extract_phone: (v) => (v.match(/\+?\d[\d\s().-]{6,}\d/) || [''])[0],
  base64_encode: (v) => Buffer.from(v).toString('base64'), base64_decode: (v) => Buffer.from(v, 'base64').toString('utf8'),
  markdown_to_html: (v) => v.replace(/^### (.*)$/gm, '<h3>$1</h3>').replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/\n/g, '<br>'),
};
const formatter = {
  key: 'formatter', name: 'Formatter by OneTier', category: 'Built-in tools', color: '#2F9E44', icon: 'wand', builtin: true,
  description: 'Transform text, numbers, dates and lists. Free — does not use tasks.',
  triggers: {},
  actions: {
    text: {
      name: 'Text', kind: 'create', billable: false,
      fields: [
        { key: 'transform', label: 'Transform', type: 'select', required: true, default: 'titlecase', options: [
          ...Object.keys(TEXT_OPS).map((k) => ({ value: k, label: k.replace(/_/g, ' ') })),
          { value: 'replace', label: 'replace' }, { value: 'split', label: 'split' }, { value: 'truncate', label: 'truncate' },
          { value: 'default_value', label: 'default value' }, { value: 'find', label: 'find' }, { value: 'extract_pattern', label: 'extract pattern (regex)' }] },
        { key: 'input', label: 'Input', type: 'textarea', required: true },
        { key: 'find', label: 'Find / pattern / separator', type: 'text', help: 'For replace, find, split and regex.' },
        { key: 'replace', label: 'Replace with / default / segment', type: 'text', help: 'Replacement text, default value, or split segment (first, last, all, or index).' },
        { key: 'maxLength', label: 'Max length (truncate)', type: 'number', default: 100 },
      ],
      sample: { output: 'Ada Lovelace' },
      async run({ params }) {
        const v = params.input == null ? '' : typeof params.input === 'object' ? JSON.stringify(params.input) : String(params.input);
        const t = params.transform;
        if (TEXT_OPS[t]) return { output: TEXT_OPS[t](v) };
        if (t === 'replace') return { output: v.split(params.find ?? '').join(params.replace ?? '') };
        if (t === 'truncate') { const n = Number(params.maxLength) || 100; return { output: v.length > n ? v.slice(0, n) : v }; }
        if (t === 'default_value') return { output: v.trim() ? v : params.replace ?? '' };
        if (t === 'find') return { output: v.indexOf(params.find ?? ''), found: v.includes(params.find ?? '') };
        if (t === 'extract_pattern') {
          let re; try { re = new RegExp(params.find, 'i'); } catch { throw new Error('Invalid regular expression'); }
          const m = v.match(re);
          return { output: m ? m[0] : '', groups: m ? m.slice(1) : [], matched: Boolean(m) };
        }
        if (t === 'split') {
          const sep = (params.find ?? ',').replace(/\\n/g, '\n') || ',';
          const parts = v.split(sep).map((x) => x.trim());
          const seg = String(params.replace ?? 'all').toLowerCase();
          if (seg === 'first') return { output: parts[0] ?? '' };
          if (seg === 'last') return { output: parts[parts.length - 1] ?? '' };
          if (/^-?\d+$/.test(seg)) return { output: parts.at(Number(seg)) ?? '' };
          return { output: parts, count: parts.length };
        }
        throw new Error(`Unknown transform "${t}"`);
      },
    },
    number: {
      name: 'Numbers', kind: 'create', billable: false,
      fields: [
        { key: 'transform', label: 'Transform', type: 'select', required: true, default: 'format', options: ['format', 'currency', 'math', 'round', 'random', 'formula'].map((v) => ({ value: v, label: v })) },
        { key: 'input', label: 'Input', type: 'text' },
        { key: 'operation', label: 'Math operation', type: 'select', default: 'add', options: ['add', 'subtract', 'multiply', 'divide', 'min', 'max', 'average', 'sum'].map((v) => ({ value: v, label: v })) },
        { key: 'operand', label: 'Second value(s) (comma-separated)', type: 'text' },
        { key: 'decimals', label: 'Decimal places', type: 'number', default: 2 },
        { key: 'currency', label: 'Currency code', type: 'text', default: 'USD' },
        { key: 'formula', label: 'Formula (use x for input)', type: 'text', placeholder: 'x * 1.18 + 5' },
      ],
      sample: { output: 1234.57 },
      async run({ params }) {
        const x = Number(String(params.input ?? '').replace(/[^0-9.+-eE]/g, ''));
        const d = params.decimals === '' || params.decimals == null ? 2 : Number(params.decimals);
        const others = String(params.operand ?? '').split(',').map((v) => v.trim()).filter(Boolean).map(Number);
        switch (params.transform) {
          case 'format': return { output: x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) };
          case 'currency': return { output: x.toLocaleString('en-US', { style: 'currency', currency: params.currency || 'USD' }) };
          case 'round': return { output: Number(x.toFixed(d)) };
          case 'random': { const hi = others[0] ?? 100; return { output: Math.floor(Math.random() * (hi - (x || 0) + 1)) + (x || 0) }; }
          case 'formula': {
            if (!/^[\d\sx+\-*/().%^]*$/.test(params.formula || '')) throw new Error('Formula may only contain numbers, x and + - * / ( ) % ^');
            const out = Function('x', `return (${params.formula.replace(/\^/g, '**')})`)(x);
            return { output: Number.isFinite(out) ? Number(out.toFixed(10)) : null };
          }
          case 'math': default: {
            const all = [x, ...others];
            const ops = {
              add: () => all.reduce((a, b) => a + b, 0), sum: () => all.reduce((a, b) => a + b, 0),
              subtract: () => all.reduce((a, b) => a - b), multiply: () => all.reduce((a, b) => a * b, 1),
              divide: () => all.reduce((a, b) => { if (b === 0) throw new Error('Division by zero'); return a / b; }),
              min: () => Math.min(...all), max: () => Math.max(...all), average: () => all.reduce((a, b) => a + b, 0) / all.length,
            };
            return { output: Number((ops[params.operation] || ops.add)().toFixed(10)) };
          }
        }
      },
    },
    date: {
      name: 'Date / Time', kind: 'create', billable: false,
      fields: [
        { key: 'transform', label: 'Transform', type: 'select', required: true, default: 'format', options: ['format', 'add_subtract', 'compare', 'now'].map((v) => ({ value: v, label: v.replace('_', '/') })) },
        { key: 'input', label: 'Input date', type: 'text', placeholder: '2026-10-15 or mapped value' },
        { key: 'format', label: 'To format', type: 'select', default: 'YYYY-MM-DD', options: ['YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'MMMM D, YYYY', 'YYYY-MM-DD HH:mm', 'ISO', 'unix', 'relative'].map((v) => ({ value: v, label: v })) },
        { key: 'expression', label: 'Add/subtract expression', type: 'text', placeholder: '+1 day, -2 hours, +3 weeks' },
        { key: 'compareTo', label: 'Compare to date', type: 'text' },
        { key: 'timezone', label: 'Timezone', type: 'text', default: 'UTC' },
      ],
      sample: { output: '2026-10-15', iso: '2026-10-15T00:00:00.000Z' },
      async run({ params }) {
        const parse = (v) => { if (v == null || v === '') return new Date(); const n = Number(v); const d = Number.isFinite(n) && String(v).length >= 10 ? new Date(n < 1e12 ? n * 1000 : n) : new Date(v); if (isNaN(d)) throw new Error(`Could not parse date "${v}"`); return d; };
        let d = params.transform === 'now' ? new Date() : parse(params.input);
        if (params.transform === 'add_subtract' && params.expression) {
          for (const m of String(params.expression).matchAll(/([+-]?\s*\d+)\s*(second|minute|hour|day|week|month|year)s?/gi)) {
            const n = Number(m[1].replace(/\s/g, ''));
            const u = m[2].toLowerCase();
            if (u === 'month') d.setUTCMonth(d.getUTCMonth() + n);
            else if (u === 'year') d.setUTCFullYear(d.getUTCFullYear() + n);
            else d = new Date(d.getTime() + n * { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5 }[u]);
          }
        }
        if (params.transform === 'compare') {
          const other = parse(params.compareTo);
          const ms = other - d;
          return { difference_ms: ms, difference_minutes: Math.round(ms / 6e4), difference_hours: Math.round(ms / 36e5), difference_days: Math.round(ms / 864e5), is_before: d < other };
        }
        const tz = params.timezone || 'UTC';
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((p) => [p.type, p.value]));
        const monthName = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'long' }).format(d);
        const f = params.format || 'YYYY-MM-DD';
        let output;
        if (f === 'ISO') output = d.toISOString();
        else if (f === 'unix') output = Math.floor(d.getTime() / 1000);
        else if (f === 'relative') { const diff = Math.round((d - Date.now()) / 864e5); output = new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(diff, 'day'); }
        else output = f.replace('YYYY', parts.year).replace('MMMM', monthName).replace('MM', parts.month).replace('DD', parts.day).replace(/\bD\b/, String(Number(parts.day))).replace('HH', parts.hour).replace('mm', parts.minute);
        return { output, iso: d.toISOString(), unix: Math.floor(d.getTime() / 1000) };
      },
    },
    utilities: {
      name: 'Utilities', kind: 'create', billable: false,
      fields: [
        { key: 'transform', label: 'Transform', type: 'select', required: true, default: 'lookup', options: [
          { value: 'lookup', label: 'Lookup table' }, { value: 'pick', label: 'Pick from list' }, { value: 'line_to_text', label: 'Line-item to text' },
          { value: 'text_to_line', label: 'Text to line-item' }, { value: 'json_parse', label: 'Parse JSON' }, { value: 'json_stringify', label: 'Stringify JSON' },
          { value: 'uuid', label: 'Generate UUID' }, { value: 'count', label: 'Count items' }, { value: 'unique', label: 'Unique items' }, { value: 'sort', label: 'Sort items' }] },
        { key: 'input', label: 'Input', type: 'textarea' },
        { key: 'table', label: 'Lookup table', type: 'keyvalue' },
        { key: 'fallback', label: 'Fallback / index / separator', type: 'text' },
      ],
      sample: { output: 'value' },
      async run({ params }) {
        const toList = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : typeof v === 'string' ? v.split(params.fallback && params.transform === 'text_to_line' ? params.fallback : ',').map((x) => x.trim()) : [v]);
        switch (params.transform) {
          case 'lookup': { const tbl = parseKeyValue(params.table); const k = String(params.input ?? ''); return { output: tbl[k] ?? params.fallback ?? '', matched: k in tbl }; }
          case 'pick': { const list = toList(params.input); const i = params.fallback; return { output: i === 'random' ? list[Math.floor(Math.random() * list.length)] : i === 'last' ? list.at(-1) : list[Number(i) || 0] }; }
          case 'line_to_text': return { output: toList(params.input).join((params.fallback || ',').replace(/\\n/g, '\n')) };
          case 'text_to_line': return { output: toList(params.input) };
          case 'json_parse': { if (typeof params.input === 'object') return { output: params.input }; try { return { output: JSON.parse(params.input) }; } catch { throw new Error('Input is not valid JSON'); } }
          case 'json_stringify': return { output: JSON.stringify(params.input) };
          case 'uuid': return { output: crypto.randomUUID() };
          case 'count': return { output: toList(params.input).length };
          case 'unique': return { output: [...new Set(toList(params.input))] };
          case 'sort': return { output: [...toList(params.input)].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })) };
          default: throw new Error('Unknown utility');
        }
      },
    },
  },
};

// ---------------------------------------------------------------- Code
// User code runs in a separate Node process with the permission model on:
// no filesystem, no child processes, no workers — only network (fetch) is allowed.
const RUNNER = `
let src = '';
process.stdin.on('data', (c) => (src += c));
process.stdin.on('end', async () => {
  const { code, inputData } = JSON.parse(src);
  const logs = [];
  const log = (...a) => logs.push(a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' '));
  const out = (o) => process.stdout.write('\\n@@ONETIER@@' + JSON.stringify(o));
  try {
    const AsyncFunction = (async () => {}).constructor;
    const fn = new AsyncFunction('inputData', 'console', code);
    const result = await fn(inputData, { log, info: log, warn: log, error: log });
    out({ ok: true, result: result === undefined ? null : result, logs });
  } catch (e) { out({ ok: false, error: String(e && e.message || e), logs }); }
});`;

export function runSandboxedCode(code, inputData, seconds) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(process.execPath, ['--permission', '--allow-net', '--no-warnings', '--max-old-space-size=128', '-e', RUNNER], { stdio: ['pipe', 'pipe', 'pipe'], env: {} });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Code exceeded the ${seconds}s runtime limit for your plan`)); }, seconds * 1000);
    child.stdout.on('data', (d) => { stdout += d; if (stdout.length > 5e6) child.kill('SIGKILL'); });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', () => {
      clearTimeout(timer);
      const i = stdout.lastIndexOf('@@ONETIER@@');
      if (i < 0) return reject(new Error(stderr.trim().split('\n').pop() || 'Code step crashed'));
      const msg = JSON.parse(stdout.slice(i + 11));
      if (!msg.ok) return reject(Object.assign(new Error(`Your code threw an error: ${msg.error}`), { status: 400 }));
      const r = msg.result;
      const out = r !== null && typeof r === 'object' && !Array.isArray(r) ? r : { output: r };
      resolve({ ...out, _logs: msg.logs, _runtime_ms: Date.now() - started });
    });
    child.stdin.end(JSON.stringify({ code: String(code || ''), inputData }));
  });
}

const code = {
  key: 'code', name: 'Code by OneTier', category: 'Developer tools', color: '#343A40', icon: 'code', builtin: true,
  description: 'Run JavaScript in a sandbox to transform data or call APIs.',
  triggers: {},
  actions: {
    javascript: {
      name: 'Run JavaScript', kind: 'create',
      fields: [
        { key: 'inputData', label: 'Input data', type: 'keyvalue', help: 'Available in code as inputData.key' },
        { key: 'code', label: 'Code', type: 'code', required: true, default: "// inputData holds your mapped values.\n// Return an object — its keys become fields for later steps.\nconst name = inputData.name || 'world';\nreturn { greeting: `Hello, ${name}!`, length: name.length };" },
      ],
      sample: { greeting: 'Hello, world!', length: 5 },
      async run({ params, ctx }) {
        const inputData = parseKeyValue(params.inputData);
        const seconds = ctx.plan?.codeSeconds || 30;
        return runSandboxedCode(params.code, inputData, seconds);
      },
    },
  },
};

// ---------------------------------------------------------------- Sub-flows
const subflow = {
  key: 'subflow', name: 'Sub-Flow by OneTier', category: 'Built-in tools', color: '#364FC7', icon: 'git-fork', builtin: true,
  description: 'Build reusable flows and call them from other flows.',
  triggers: {
    start: { name: 'Start a Sub-Flow', type: 'instant', description: 'Runs when another flow calls this one.', fields: [{ key: 'inputs', label: 'Expected input fields', type: 'list' }], sample: { inputs: { example: 'value' } } },
  },
  actions: {
    call: {
      name: 'Call a Sub-Flow', kind: 'create',
      fields: [{ key: 'flowId', label: 'Sub-flow', type: 'select', dynamic: 'subflows', required: true }, { key: 'inputs', label: 'Inputs', type: 'keyvalue' }],
      sample: { result: {} },
      async run({ params, ctx }) {
        const res = await ctx.services.callFlow(params.flowId, { inputs: parseKeyValue(params.inputs) }, { source: 'subflow', depth: (ctx.depth || 0) + 1 });
        if (res.status === 'error') throw new Error(`Sub-flow failed: ${res.error}`);
        return { status: res.status, result: res.returnValue ?? null, run_id: res.runId };
      },
    },
    return: {
      name: 'Return from a Sub-Flow', kind: 'create', billable: false,
      fields: [{ key: 'values', label: 'Values to return', type: 'keyvalue' }],
      sample: { returned: true },
      async run({ params, ctx }) { ctx.setReturn(parseKeyValue(params.values)); return { returned: true, values: parseKeyValue(params.values) }; },
    },
  },
};

// ---------------------------------------------------------------- Storage
const storage = {
  key: 'storage', name: 'Storage by OneTier', category: 'Built-in tools', color: '#5F3DC4', icon: 'database', builtin: true,
  description: 'Save and retrieve small values between flow runs.',
  triggers: {},
  actions: {
    set: { name: 'Set Value', kind: 'create', billable: false, fields: [{ key: 'key', label: 'Key', type: 'text', required: true }, { key: 'value', label: 'Value', type: 'textarea' }], sample: { key: 'counter', value: '1' },
      async run({ params, ctx }) { svc.kv.set(ctx.wsId, params.key, params.value); return { key: params.key, value: params.value }; } },
    get: { name: 'Get Value', kind: 'search', billable: false, fields: [{ key: 'key', label: 'Key', type: 'text', required: true }, { key: 'default', label: 'Default if missing', type: 'text' }], sample: { key: 'counter', value: '1', found: true },
      async run({ params, ctx }) { const v = svc.kv.get(ctx.wsId, params.key); return { key: params.key, value: v ?? params.default ?? null, found: v != null }; } },
    increment: { name: 'Increment Value', kind: 'create', billable: false, fields: [{ key: 'key', label: 'Key', type: 'text', required: true }, { key: 'by', label: 'Increment by', type: 'number', default: 1 }], sample: { key: 'counter', value: 2 },
      async run({ params, ctx }) { const v = Number(svc.kv.get(ctx.wsId, params.key) || 0) + Number(params.by ?? 1); svc.kv.set(ctx.wsId, params.key, v); return { key: params.key, value: v }; } },
    push: { name: 'Push Value onto List', kind: 'create', billable: false, fields: [{ key: 'key', label: 'Key', type: 'text', required: true }, { key: 'value', label: 'Value', type: 'text' }, { key: 'max', label: 'Keep at most', type: 'number', default: 100 }], sample: { key: 'list', value: ['a'] },
      async run({ params, ctx }) { let l = svc.kv.get(ctx.wsId, params.key); if (!Array.isArray(l)) l = []; l.push(params.value); l = l.slice(-(Number(params.max) || 100)); svc.kv.set(ctx.wsId, params.key, l); return { key: params.key, value: l, count: l.length }; } },
    remove: { name: 'Remove Value', kind: 'create', billable: false, fields: [{ key: 'key', label: 'Key', type: 'text', required: true }], sample: { removed: true },
      async run({ params, ctx }) { svc.kv.remove(ctx.wsId, params.key); return { removed: true, key: params.key }; } },
  },
};

// ---------------------------------------------------------------- Email & notifications
const email = {
  key: 'email', name: 'Email by OneTier', category: 'Communication', color: '#1C7ED6', icon: 'mail', builtin: true,
  description: 'Send emails. Delivers to the OneTier Inbox, or through your own SMTP server if connected.',
  triggers: {},
  actions: {
    send: {
      name: 'Send Outbound Email', kind: 'create',
      fields: [
        { key: 'to', label: 'To', type: 'text', required: true }, { key: 'subject', label: 'Subject', type: 'text', required: true },
        { key: 'body', label: 'Body', type: 'textarea', required: true }, { key: 'fromName', label: 'From name', type: 'text', default: 'OneTier' },
        { key: 'html', label: 'Body is HTML', type: 'boolean', default: false },
      ],
      sample: { id: 'mail_123', to: 'ada@example.com', delivered_to: 'OneTier Inbox' },
      async run({ params, ctx }) {
        const smtp = get("SELECT credentials FROM connections WHERE workspace_id = ? AND app = 'smtp' ORDER BY created_at LIMIT 1", ctx.wsId);
        if (smtp) {
          const { sendSmtp } = await import('./external.js');
          const info = await sendSmtp(smtp.credentials, params);
          return { ...info, to: params.to, delivered_to: 'SMTP' };
        }
        return svc.deliverMail(ctx.wsId, { ...params, runId: ctx.runId });
      },
    },
  },
};
const notifications = {
  key: 'notify', name: 'Notifications by OneTier', category: 'Communication', color: '#F59F00', icon: 'bell', builtin: true,
  description: 'Send an in-app notification to your workspace.',
  triggers: {},
  actions: {
    send: { name: 'Send In-App Notification', kind: 'create', billable: false,
      fields: [{ key: 'title', label: 'Title', type: 'text', required: true }, { key: 'body', label: 'Message', type: 'textarea' }, { key: 'link', label: 'Link', type: 'text' }],
      sample: { id: 'ntf_1', title: 'Hello' },
      async run({ params, ctx }) { return svc.notify(ctx.wsId, { type: 'flow', title: params.title, body: params.body, link: params.link }); } },
  },
};

// ---------------------------------------------------------------- AI
const ai = {
  key: 'ai', name: 'AI by OneTier', category: 'AI', color: '#9C36B5', icon: 'sparkles', builtin: true,
  description: 'Use Claude to write, extract, classify, summarize — or act as an agent with tools.',
  triggers: {},
  actions: {
    generate: {
      name: 'Generate Text', kind: 'create',
      fields: [
        { key: 'instructions', label: 'Instructions', type: 'textarea', required: true, placeholder: 'Write a friendly welcome email for {{trigger.body.name}}…' },
        { key: 'system', label: 'Persona / system prompt', type: 'textarea' }, MODEL_FIELD,
        { key: 'effort', label: 'Effort', type: 'select', default: 'medium', options: ['low', 'medium', 'high'].map((v) => ({ value: v, label: v })) },
      ],
      sample: { output: 'Hi Ada, welcome aboard!' },
      async run({ params, ctx }) { const r = await aiText({ wsId: ctx.wsId, system: params.system || undefined, prompt: params.instructions, model: params.model, effort: params.effort }); return { output: r.text, usage: r.usage }; },
    },
    extract: {
      name: 'Extract Structured Data', kind: 'create',
      fields: [
        { key: 'input', label: 'Text to extract from', type: 'textarea', required: true },
        { key: 'fields', label: 'Fields to extract', type: 'keyvalue', required: true, help: 'Key = field name, value = description (e.g. "company": "the customer\'s company name").' },
        MODEL_FIELD,
      ],
      sample: { company: 'Analytical Engines Ltd', budget: '5000' },
      async run({ params, ctx }) {
        const f = parseKeyValue(params.fields);
        const keys = Object.keys(f);
        if (!keys.length) throw new Error('Add at least one field to extract.');
        const schema = { type: 'object', properties: Object.fromEntries(keys.map((k) => [k, { type: 'string', description: f[k] || k }])), required: keys, additionalProperties: false };
        const r = await aiJSON({ wsId: ctx.wsId, model: params.model, effort: 'low', schema,
          prompt: `Extract these fields from the text. Use an empty string when a value is not present.\n\nFields:\n${keys.map((k) => `- ${k}: ${f[k]}`).join('\n')}\n\nText:\n${typeof params.input === 'string' ? params.input : JSON.stringify(params.input)}` });
        return r.data;
      },
    },
    classify: {
      name: 'Classify Text', kind: 'create',
      fields: [
        { key: 'input', label: 'Text', type: 'textarea', required: true },
        { key: 'categories', label: 'Categories (comma-separated)', type: 'text', required: true, placeholder: 'Sales, Support, Billing, Spam' },
        MODEL_FIELD,
      ],
      sample: { category: 'Support', confidence: 'high', reason: 'Customer reports a bug.' },
      async run({ params, ctx }) {
        const cats = String(params.categories).split(',').map((c) => c.trim()).filter(Boolean);
        const r = await aiJSON({ wsId: ctx.wsId, model: params.model, effort: 'low',
          schema: { type: 'object', properties: { category: { type: 'string', enum: cats }, confidence: { type: 'string', enum: ['low', 'medium', 'high'] }, reason: { type: 'string' } }, required: ['category', 'confidence', 'reason'], additionalProperties: false },
          prompt: `Classify the text into exactly one category: ${cats.join(', ')}.\n\nText:\n${params.input}` });
        return r.data;
      },
    },
    summarize: {
      name: 'Summarize', kind: 'create',
      fields: [
        { key: 'input', label: 'Text', type: 'textarea', required: true },
        { key: 'style', label: 'Style', type: 'select', default: 'bullets', options: [{ value: 'bullets', label: '3–5 bullet points' }, { value: 'tldr', label: 'One-sentence TL;DR' }, { value: 'paragraph', label: 'Short paragraph' }] },
        MODEL_FIELD,
      ],
      sample: { summary: '- Point one\n- Point two' },
      async run({ params, ctx }) {
        const style = { bullets: 'as 3–5 concise bullet points', tldr: 'in one sentence', paragraph: 'in one short paragraph' }[params.style] || 'concisely';
        const r = await aiText({ wsId: ctx.wsId, model: params.model, effort: 'low', prompt: `Summarize the following ${style}. Output only the summary.\n\n${params.input}` });
        return { summary: r.text };
      },
    },
    agent: {
      name: 'AI Agent (with tools)', kind: 'create',
      description: 'Claude reasons step by step and calls the OneTier actions you allow.',
      fields: [
        { key: 'goal', label: 'Goal / instructions', type: 'textarea', required: true, placeholder: 'Look up the customer in the CRM table; if they are new, add them and draft a welcome email.' },
        { key: 'tools', label: 'Tools the agent may use', type: 'tools', help: 'The agent can only call the actions you list here.' },
        { key: 'context', label: 'Context data', type: 'textarea' }, MODEL_FIELD,
        { key: 'maxSteps', label: 'Max tool calls', type: 'number', default: 8 },
      ],
      sample: { output: 'Done. Added the customer and drafted an email.', tool_calls: [] },
      async run({ params, ctx }) {
        const tools = await ctx.services.buildAgentTools(params.tools || []);
        const r = await aiAgent({ wsId: ctx.wsId, model: params.model, effort: 'medium', maxIterations: Number(params.maxSteps) || 8, tools,
          system: 'You are an automation agent inside OneTier. Use the tools to accomplish the goal, then reply with a short summary of what you did.',
          prompt: `${params.goal}${params.context ? `\n\nContext:\n${typeof params.context === 'string' ? params.context : JSON.stringify(params.context)}` : ''}` });
        return { output: r.text, tool_calls: r.toolCalls, usage: r.usage };
      },
    },
  },
};

// ---------------------------------------------------------------- Tables
const tables = {
  key: 'tables', name: 'OneTier Tables', category: 'OneTier products', color: '#0CA678', icon: 'table', builtin: true,
  description: 'Store, update and look up structured data — no database required.',
  triggers: {
    new_record: { name: 'New Record', type: 'internal', fields: [tableField], sample: { id: 'rec_1', Name: 'Ada', Email: 'ada@example.com' } },
    updated_record: { name: 'Updated Record', type: 'internal', fields: [tableField], sample: { id: 'rec_1', Name: 'Ada', Status: 'Qualified' } },
  },
  actions: {
    create: { name: 'Create Record', kind: 'create', billable: false, fields: [tableField, { key: 'data', label: 'Field values', type: 'tablefields', required: true }],
      sample: { id: 'rec_1' }, async run({ params, ctx }) { return svc.createRecord(ctx.wsId, params.tableId, parseKeyValue(params.data), { source: `flow:${ctx.flowId}` }); } },
    update: { name: 'Update Record', kind: 'create', billable: false, fields: [tableField, { key: 'recordId', label: 'Record ID', type: 'text', required: true }, { key: 'data', label: 'Field values', type: 'tablefields' }],
      sample: { id: 'rec_1' }, async run({ params, ctx }) { return svc.updateRecord(ctx.wsId, params.tableId, params.recordId, parseKeyValue(params.data), { source: `flow:${ctx.flowId}` }); } },
    find: { name: 'Find Records', kind: 'search', billable: false,
      fields: [tableField, { key: 'field', label: 'Lookup field', type: 'text', required: true }, { key: 'value', label: 'Lookup value', type: 'text', required: true }, { key: 'op', label: 'Match', type: 'select', default: 'equals', options: [{ value: 'equals', label: 'Exact match' }, { value: 'contains', label: 'Contains' }] }],
      sample: { found: true, record: { id: 'rec_1' }, records: [], count: 1 },
      async run({ params, ctx }) { const recs = svc.findRecords(ctx.wsId, params.tableId, params); return { found: recs.length > 0, count: recs.length, record: recs[0] || null, records: recs }; } },
    find_or_create: { name: 'Find or Create Record', kind: 'search', billable: false,
      fields: [tableField, { key: 'field', label: 'Lookup field', type: 'text', required: true }, { key: 'value', label: 'Lookup value', type: 'text', required: true }, { key: 'data', label: 'Values if created', type: 'tablefields' }],
      sample: { created: false, record: { id: 'rec_1' } },
      async run({ params, ctx }) {
        const recs = svc.findRecords(ctx.wsId, params.tableId, params);
        if (recs.length) return { created: false, record: recs[0] };
        const data = { ...parseKeyValue(params.data), [params.field]: params.value };
        return { created: true, record: svc.createRecord(ctx.wsId, params.tableId, data, { source: `flow:${ctx.flowId}` }) };
      } },
    delete: { name: 'Delete Record', kind: 'create', billable: false, fields: [tableField, { key: 'recordId', label: 'Record ID', type: 'text', required: true }],
      sample: { deleted: true }, async run({ params, ctx }) { return svc.deleteRecord(ctx.wsId, params.tableId, params.recordId); } },
  },
};

// ---------------------------------------------------------------- Interfaces & Chatbots (triggers)
const interfaces = {
  key: 'interfaces', name: 'OneTier Interfaces', category: 'OneTier products', color: '#E64980', icon: 'layout', builtin: true,
  description: 'Forms, portals and pages that start your flows.',
  triggers: {
    form_submitted: { name: 'New Form Submission', type: 'internal', fields: [{ key: 'interfaceId', label: 'Interface', type: 'select', dynamic: 'interfaces', required: true }, { key: 'blockId', label: 'Form', type: 'select', dynamic: 'forms', required: false }], sample: { Name: 'Ada Lovelace', Email: 'ada@example.com', Message: 'Hi!', submitted_at: '2026-10-15T09:00:00Z' } },
    button_clicked: { name: 'Button Clicked', type: 'internal', fields: [{ key: 'interfaceId', label: 'Interface', type: 'select', dynamic: 'interfaces', required: true }], sample: { interface: 'Portal', button: 'Request access', clicked_at: '2026-10-15T09:00:00Z' } },
  },
  actions: {},
};
const chatbots = {
  key: 'chatbots', name: 'OneTier Chatbots', category: 'OneTier products', color: '#3B5BDB', icon: 'bot', builtin: true,
  description: 'Start flows from chatbot conversations and captured leads.',
  triggers: {
    new_lead: { name: 'New Lead Captured', type: 'internal', fields: [{ key: 'chatbotId', label: 'Chatbot', type: 'select', dynamic: 'chatbots', required: true }], sample: { name: 'Ada', email: 'ada@example.com', conversation_id: 'conv_1' } },
    conversation_ended: { name: 'New Conversation Message', type: 'internal', fields: [{ key: 'chatbotId', label: 'Chatbot', type: 'select', dynamic: 'chatbots', required: true }], sample: { message: 'Do you have a free plan?', reply: 'Yes!', conversation_id: 'conv_1' } },
  },
  actions: {},
};

// ---------------------------------------------------------------- RSS & HTTP polling
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
const rss = {
  key: 'rss', name: 'RSS by OneTier', category: 'Built-in tools', color: '#F08C00', icon: 'rss', builtin: true,
  description: 'Watch any RSS or Atom feed for new items.',
  triggers: {
    new_item: { name: 'New Item in Feed', type: 'polling', fields: [{ key: 'url', label: 'Feed URL', type: 'text', required: true, placeholder: 'https://hnrss.org/frontpage' }],
      sample: { id: 'guid-1', title: 'Hello world', link: 'https://example.com/post', summary: '…', published: '2026-10-15T09:00:00Z' },
      async poll({ params }) {
        const r = await http(params.url, { headers: { accept: 'application/rss+xml, application/atom+xml, text/xml, */*' } });
        const doc = xml.parse(typeof r.data === 'string' ? r.data : JSON.stringify(r.data));
        const items = doc?.rss?.channel?.item || doc?.feed?.entry || doc?.['rdf:RDF']?.item || [];
        return (Array.isArray(items) ? items : [items]).slice(0, 50).map((it) => {
          const link = typeof it.link === 'string' ? it.link : it.link?.href || (Array.isArray(it.link) ? it.link[0]?.href : '');
          const text = (v) => (typeof v === 'object' && v ? v['#text'] ?? '' : v ?? '');
          return { id: String(text(it.guid) || it.id || link || it.title), title: text(it.title), link, summary: String(text(it.description) || text(it.summary) || '').replace(/<[^>]*>/g, '').slice(0, 2000), published: it.pubDate || it.published || it.updated || '', author: text(it.author?.name ?? it.author ?? it['dc:creator']) };
        });
      } },
  },
  actions: {},
};
const poller = {
  key: 'http_poll', name: 'API Poller', category: 'Developer tools', color: '#495057', icon: 'radar', builtin: true,
  description: 'Poll any JSON endpoint and trigger on new items.',
  triggers: {
    new_items: { name: 'New Items in JSON List', type: 'polling',
      fields: [{ key: 'url', label: 'URL returning JSON', type: 'text', required: true }, { key: 'path', label: 'Path to the list (optional)', type: 'text', placeholder: 'data.items' }, { key: 'idField', label: 'Unique ID field', type: 'text', default: 'id' }, { key: 'headers', label: 'Headers', type: 'keyvalue' }],
      sample: { id: 1, title: 'Item' },
      async poll({ params }) {
        const r = await http(params.url, { headers: parseKeyValue(params.headers) });
        let list = r.data;
        if (params.path) for (const p of params.path.split('.')) list = list?.[p];
        if (!Array.isArray(list)) throw new Error('The response (at the given path) is not a list.');
        return list.slice(0, 100).map((x) => ({ ...x, id: String(x?.[params.idField || 'id'] ?? JSON.stringify(x)) }));
      } },
  },
  actions: {},
};

export const BUILTIN_APPS = [webhook, schedule, manual, filter, paths, formatter, delay, looping, code, ai, tables, interfaces, chatbots, email, notifications, storage, subflow, digest, approval, rss, poller];

// expose for engine control-step checks
export const CONTROL_APPS = new Set(['filter', 'paths', 'looping', 'delay', 'approval', 'digest']);
export { all, j };
