import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import api from './api.js';
import { setTheme } from './util.js';
import { Modal, Button, Input } from '../components/ui.jsx';

// ---------------------------------------------------------------- Auth
const AuthCtx = createContext(null);
export function AuthProvider({ children }) {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const m = await api.get('auth/me');
      // Apply the theme saved on the account so it follows the user across devices.
      if (m?.user?.prefs?.theme) setTheme(m.user.prefs.theme);
      setMe(m);
    } catch { setMe(null); } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const h = () => setMe(null);
    window.addEventListener('onetier:unauthorized', h);
    return () => window.removeEventListener('onetier:unauthorized', h);
  }, []);
  const logout = useCallback(async () => { try { await api.post('auth/logout'); } finally { setMe(null); window.location.href = '/login'; } }, []);
  const switchWorkspace = useCallback(async (workspaceId) => { await api.post('auth/switch', { workspaceId }); window.location.href = '/'; }, []);
  const value = useMemo(() => ({ me, loading, refresh, logout, switchWorkspace, isAdmin: ['admin', 'owner'].includes(me?.role) }), [me, loading, refresh, logout, switchWorkspace]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);

// ---------------------------------------------------------------- App catalog
const AppsCtx = createContext(null);
export function AppsProvider({ children }) {
  const [apps, setApps] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => { try { setApps(await api.get('apps')); } finally { setLoaded(true); } }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const byKey = useMemo(() => Object.fromEntries(apps.map((a) => [a.key, a])), [apps]);
  const value = useMemo(() => ({ apps, loaded, refresh, getApp: (k) => byKey[k] || null }), [apps, loaded, refresh, byKey]);
  return <AppsCtx.Provider value={value}>{children}</AppsCtx.Provider>;
}
export const useApps = () => useContext(AppsCtx);

// ---------------------------------------------------------------- Toasts
const ToastCtx = createContext(null);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, type = 'success') => {
    const id = Math.random();
    setItems((x) => [...x, { id, message: typeof message === 'string' ? message : message?.message || String(message), type }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), type === 'error' ? 6000 : 3500);
  }, []);
  const toast = useMemo(() => Object.assign((m, t) => push(m, t), { success: (m) => push(m, 'success'), error: (m) => push(m, 'error'), info: (m) => push(m, 'info') }), [push]);
  const Icon = { success: CheckCircle2, error: AlertCircle, info: Info };
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => { const I = Icon[t.type] || Info; return (
          <div key={t.id} className={`toast ${t.type}`}><I /><div className="grow">{t.message}</div>
            <button className="btn btn-ghost btn-icon btn-xs" style={{ color: 'inherit' }} aria-label="Dismiss" onClick={() => setItems((x) => x.filter((y) => y.id !== t.id))}><X /></button>
          </div>); })}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------------------------------------------------------- Confirm / prompt dialogs
const DialogCtx = createContext(null);
export function DialogProvider({ children }) {
  const [dlg, setDlg] = useState(null);
  const [value, setValue] = useState('');
  const resolver = useRef(null);
  const open = useCallback((opts) => new Promise((resolve) => { resolver.current = resolve; setValue(opts.defaultValue || ''); setDlg(opts); }), []);
  const close = (result) => { resolver.current?.(result); setDlg(null); };
  const api_ = useMemo(() => ({
    confirm: (opts) => open({ kind: 'confirm', ...opts }),
    prompt: (opts) => open({ kind: 'prompt', ...opts }),
  }), [open]);
  return (
    <DialogCtx.Provider value={api_}>
      {children}
      {dlg && (
        <Modal title={dlg.title} size="sm" onClose={() => close(dlg.kind === 'prompt' ? null : false)}
          footer={<>
            <Button variant="secondary" onClick={() => close(dlg.kind === 'prompt' ? null : false)}>{dlg.cancelText || 'Cancel'}</Button>
            <Button variant={dlg.danger ? 'danger' : 'primary'} disabled={dlg.kind === 'prompt' && dlg.required !== false && !value.trim()}
              onClick={() => close(dlg.kind === 'prompt' ? value : true)}>{dlg.confirmText || (dlg.kind === 'prompt' ? 'Save' : 'Confirm')}</Button>
          </>}>
          {dlg.message && <p className="muted" style={{ marginBottom: dlg.kind === 'prompt' ? 12 : 0 }}>{dlg.message}</p>}
          {dlg.kind === 'prompt' && (
            <form onSubmit={(e) => { e.preventDefault(); if (value.trim() || dlg.required === false) close(value); }}>
              {dlg.label && <label className="label" style={{ marginBottom: 6 }}>{dlg.label}</label>}
              <Input autoFocus value={value} placeholder={dlg.placeholder} onChange={(e) => setValue(e.target.value)} />
            </form>
          )}
        </Modal>
      )}
    </DialogCtx.Provider>
  );
}
export const useDialog = () => useContext(DialogCtx);

// ---------------------------------------------------------------- data hook
/** useFetch('flows') → {data, error, loading, reload, setData}. Pass null to skip. */
export function useFetch(url, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(url) });
  const reload = useCallback(async () => {
    if (!url) return;
    setState((s) => ({ ...s, loading: true }));
    try { const data = await api.get(url); setState({ data, error: null, loading: false }); return data; }
    catch (error) { setState((s) => ({ ...s, error, loading: false })); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);
  useEffect(() => { reload(); }, [reload]);
  const setData = useCallback((fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })), []);
  return { ...state, reload, setData };
}
