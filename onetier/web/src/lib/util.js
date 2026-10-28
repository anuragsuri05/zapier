export function timeAgo(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 0) {
    const f = -s;
    if (f < 60) return 'in a few seconds';
    if (f < 3600) return `in ${Math.round(f / 60)}m`;
    if (f < 86400) return `in ${Math.round(f / 3600)}h`;
    return `in ${Math.round(f / 86400)}d`;
  }
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
export const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
export const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString());
export const fmtMoney = (n) => (n == null ? 'Custom' : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`);
export const duration = (a, b) => {
  if (!a || !b) return '—';
  const ms = new Date(b) - new Date(a);
  return ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 60000)}m`;
};
export const uid = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 10)}`;
export const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
export const plural = (n, word) => `${fmtNum(n)} ${word}${n === 1 ? '' : 's'}`;

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); return true; } finally { t.remove(); }
  }
}

/** Flatten an object into [{path, value}] for the variable picker. */
export function flattenPaths(obj, prefix = '', out = [], depth = 0) {
  if (obj === null || obj === undefined || depth > 5) return out;
  if (typeof obj !== 'object') { out.push({ path: prefix, value: obj }); return out; }
  if (Array.isArray(obj)) {
    if (prefix) out.push({ path: prefix, value: obj, isArray: true });
    obj.slice(0, 3).forEach((v, i) => flattenPaths(v, prefix ? `${prefix}.${i}` : String(i), out, depth + 1));
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('_')) continue;
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') { if (!Array.isArray(v)) out.push({ path: p, value: v, isObject: true }); flattenPaths(v, p, out, depth + 1); }
    else out.push({ path: p, value: v });
  }
  return out;
}

export const RUN_STATUS = {
  success: { label: 'Success', cls: 'badge-green' },
  error: { label: 'Error', cls: 'badge-red' },
  filtered: { label: 'Stopped', cls: 'badge-yellow' },
  halted: { label: 'Halted', cls: 'badge-red' },
  waiting: { label: 'Waiting', cls: 'badge-blue' },
  running: { label: 'Running', cls: 'badge-brand' },
};
export const FLOW_STATUS = {
  on: { label: 'On', cls: 'badge-green' },
  off: { label: 'Off', cls: '' },
  draft: { label: 'Draft', cls: 'badge-yellow' },
};

export function getTheme() {
  try { return localStorage.getItem('onetier-theme') || 'light'; } catch { return 'light'; }
}
export function setTheme(t) {
  const resolved = t === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
  document.documentElement.dataset.theme = resolved;
  try { localStorage.setItem('onetier-theme', t); } catch { /* storage unavailable */ }
}
