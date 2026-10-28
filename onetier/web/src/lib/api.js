// Thin JSON client for the OneTier API. Throws Error(message) with .status / .data on failure.
async function request(method, url, body, { raw = false, headers = {} } = {}) {
  const opts = { method, headers: { ...headers }, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url.startsWith('/') ? url : `/api/${url}`, opts);
  if (raw) return res;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    if (res.status === 401 && !url.includes('auth/') && !url.startsWith('/api/public')) {
      window.dispatchEvent(new CustomEvent('onetier:unauthorized'));
    }
    throw err;
  }
  return data;
}

const api = {
  get: (url, opts) => request('GET', url, undefined, opts),
  post: (url, body = {}, opts) => request('POST', url, body, opts),
  put: (url, body = {}, opts) => request('PUT', url, body, opts),
  patch: (url, body = {}, opts) => request('PATCH', url, body, opts),
  del: (url, body, opts) => request('DELETE', url, body, opts),
  /** Trigger a browser download from an API endpoint. */
  async download(url, filename) {
    const res = await request('GET', url, undefined, { raw: true });
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  },
};

export default api;
