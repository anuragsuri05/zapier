// Small fetch wrapper used by every app that talks to an external API.
export class HttpError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

export async function http(url, { method = 'GET', headers = {}, body, json, form, timeout = 30000, auth } = {}) {
  const h = { 'user-agent': 'OneTier/1.0', ...headers };
  let payload = body;
  if (json !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(json); }
  if (form !== undefined) { h['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString(); }
  if (auth?.bearer) h.authorization = `Bearer ${auth.bearer}`;
  if (auth?.basic) h.authorization = `Basic ${Buffer.from(auth.basic).toString('base64')}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(url, { method, headers: h, body: ['GET', 'HEAD'].includes(method) ? undefined : payload, signal: ctrl.signal });
  } catch (e) {
    throw new HttpError(e.name === 'AbortError' ? `Request timed out after ${timeout / 1000}s` : `Network error: ${e.message}`, 0);
  } finally { clearTimeout(t); }
  const text = await res.text();
  let data = text;
  if ((res.headers.get('content-type') || '').includes('json') || /^[\[{]/.test(text.trim())) {
    try { data = JSON.parse(text); } catch { /* keep text */ }
  }
  if (!res.ok) {
    const msg = typeof data === 'object' ? (data.message || data.error?.message || data.error || data.description || JSON.stringify(data)) : text;
    throw new HttpError(`HTTP ${res.status}: ${String(msg).slice(0, 300)}`, res.status, data);
  }
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), data };
}

export function parseKeyValue(list) {
  // accepts [{key,value}] or object or "a=b\nc=d"
  if (!list) return {};
  if (Array.isArray(list)) return Object.fromEntries(list.filter((x) => x && x.key).map((x) => [x.key, x.value ?? '']));
  if (typeof list === 'string') {
    return Object.fromEntries(list.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const i = l.search(/[=:]/);
      return i < 0 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }));
  }
  return typeof list === 'object' ? list : {};
}

export function parseJSONish(v) {
  if (v == null || v === '') return undefined;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return v; }
}
