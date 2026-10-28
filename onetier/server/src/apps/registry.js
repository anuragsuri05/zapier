import { BUILTIN_APPS } from './builtin.js';
import { EXTERNAL_APPS } from './external.js';
import { http, parseJSONish } from './http.js';
import { all, get, j } from '../db.js';

const STATIC = new Map([...BUILTIN_APPS, ...EXTERNAL_APPS].map((a) => [a.key, a]));

// ---- Custom apps built in the Developer Platform: declarative HTTP operations
function fill(tpl, vars) {
  if (typeof tpl !== 'string') return tpl;
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
    const v = k.split('.').reduce((o, p) => (o == null ? o : o[p]), vars);
    return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
}

function customRequest(app, op, params, creds) {
  const vars = { ...params, auth: creds };
  let url = fill(op.request?.url || '', vars);
  if (url && !/^https?:\/\//.test(url)) url = (app.base_url || '').replace(/\/$/, '') + '/' + url.replace(/^\//, '');
  const headers = Object.fromEntries(Object.entries(op.request?.headers || {}).map(([k, v]) => [k, fill(v, vars)]));
  const auth = app.auth || { type: 'none' };
  const opts = { method: (op.request?.method || 'GET').toUpperCase(), headers };
  if (auth.type === 'bearer') opts.auth = { bearer: creds.token };
  if (auth.type === 'basic') opts.auth = { basic: `${creds.username}:${creds.password}` };
  if (auth.type === 'api_key') {
    if (auth.placement === 'query') url += (url.includes('?') ? '&' : '?') + `${encodeURIComponent(auth.paramName || 'api_key')}=${encodeURIComponent(creds.api_key)}`;
    else headers[auth.paramName || 'X-API-Key'] = creds.api_key;
  }
  if (op.request?.body && !['GET', 'HEAD'].includes(opts.method)) {
    const body = fill(op.request.body, vars);
    const parsed = parseJSONish(body);
    if (typeof parsed === 'object') opts.json = parsed; else opts.body = body;
  }
  return http(url, opts);
}

function authFields(auth) {
  switch (auth?.type) {
    case 'api_key': return [{ key: 'api_key', label: 'API key', type: 'password', required: true }];
    case 'bearer': return [{ key: 'token', label: 'Access token', type: 'password', required: true }];
    case 'basic': return [{ key: 'username', label: 'Username', type: 'text', required: true }, { key: 'password', label: 'Password', type: 'password', required: true }];
    default: return (auth?.fields || []);
  }
}

export function customAppDef(row) {
  const ops = j(row.operations, []);
  const auth = j(row.auth, { type: 'none' });
  const app = { key: `custom_${row.key}`, name: row.name, description: row.description || 'Custom integration', category: 'Custom apps', color: row.color || '#5B3DF5', letter: row.name[0]?.toUpperCase(), custom: true, customId: row.id, version: row.version, base_url: row.base_url, auth: null, triggers: {}, actions: {} };
  if (auth.type && auth.type !== 'none') {
    app.auth = { fields: authFields(auth), async test(c) {
      if (auth.testUrl) await customRequest({ ...app, auth }, { request: { url: auth.testUrl, method: 'GET' } }, {}, c);
      return { label: row.name };
    } };
  }
  for (const op of ops) {
    const fields = (op.fields || []).map((f) => ({ key: f.key, label: f.label || f.key, type: f.type || 'text', required: Boolean(f.required), help: f.help }));
    if (op.type === 'trigger') {
      app.triggers[op.key] = { name: op.name, description: op.description, type: 'polling', fields, sample: parseJSONish(op.sample) || { id: '1' },
        async poll({ params, creds }) {
          const r = await customRequest({ ...app, auth }, op, params, creds);
          let list = r.data; if (op.listPath) for (const p of op.listPath.split('.')) list = list?.[p];
          if (!Array.isArray(list)) throw new Error('Trigger response is not a list (check the list path).');
          return list.map((x) => ({ ...x, id: String(x?.[op.idField || 'id'] ?? JSON.stringify(x)) }));
        } };
    } else {
      app.actions[op.key] = { name: op.name, description: op.description, kind: op.type === 'search' ? 'search' : 'create', fields, sample: parseJSONish(op.sample) || {},
        async run({ params, creds }) { const r = await customRequest({ ...app, auth }, op, params, creds); return typeof r.data === 'object' ? r.data : { response: r.data, status: r.status }; } };
    }
  }
  return app;
}

export function getApp(key, wsId) {
  if (STATIC.has(key)) return STATIC.get(key);
  if (key?.startsWith('custom_') && wsId) {
    const row = get('SELECT * FROM custom_apps WHERE workspace_id = ? AND key = ?', wsId, key.slice(7));
    if (row) return customAppDef(row);
  }
  return null;
}

export function listApps(wsId) {
  const custom = wsId ? all('SELECT * FROM custom_apps WHERE workspace_id = ?', wsId).map(customAppDef) : [];
  return [...STATIC.values(), ...custom];
}

/** Strip functions so app definitions can be sent to the browser. */
export function serializeApp(a) {
  const ser = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, {
    key: k, name: v.name, description: v.description || '', type: v.type, kind: v.kind, fields: v.fields || [], sample: v.sample || {},
    billable: v.billable !== false,
  }]));
  return {
    key: a.key, name: a.name, description: a.description, category: a.category, color: a.color, icon: a.icon, letter: a.letter || a.name[0],
    premium: false, builtin: Boolean(a.builtin), control: Boolean(a.control), custom: Boolean(a.custom), requiresPaths: Boolean(a.requiresPaths),
    auth: a.auth ? { fields: a.auth.fields } : null, triggers: ser(a.triggers), actions: ser(a.actions),
  };
}
