// Shared UI primitives. Import from here instead of re-implementing.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Search, Copy, Check, ChevronLeft, ChevronRight, Webhook, CalendarClock, MousePointerClick, Filter, Split, WandSparkles, Timer, Repeat,
  Code2, Sparkles, Table2, LayoutTemplate, Bot, Mail, Bell, Database, GitFork, Layers, UserCheck, Rss, Radar, Send, Phone, Server, Zap, Plug,
} from 'lucide-react';
import { RUN_STATUS, FLOW_STATUS, copyText } from '../lib/util.js';

export function Spinner({ size }) { return <span className="spinner" style={size ? { width: size, height: size } : undefined} />; }

export function Button({ variant = 'secondary', size, icon: Icon, loading, children, className = '', block, ...rest }) {
  const cls = ['btn', `btn-${variant}`, size && `btn-${size}`, !children && Icon && 'btn-icon', block && 'btn-block', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} disabled={loading || rest.disabled} {...rest}>
      {loading ? <Spinner /> : Icon ? <Icon /> : null}
      {children}
    </button>
  );
}

export function Field({ label, required, help, error, children, className = '', right }) {
  return (
    <div className={`field ${className}`}>
      {label && <label><span>{label}{required && <span className="req"> *</span>}</span>{right && <span style={{ marginLeft: 'auto' }}>{right}</span>}</label>}
      {children}
      {error ? <div className="error-text">{error}</div> : help ? <div className="help">{help}</div> : null}
    </div>
  );
}
export const Input = ({ className = '', invalid, ...p }) => <input className={`input ${invalid ? 'invalid' : ''} ${className}`} {...p} />;
export const Textarea = ({ className = '', invalid, ...p }) => <textarea className={`textarea ${invalid ? 'invalid' : ''} ${className}`} {...p} />;
export function Select({ options = [], placeholder, className = '', ...p }) {
  return (
    <select className={`select ${className}`} {...p}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>))}
    </select>
  );
}
export function Toggle({ checked, onChange, disabled, label, title }) {
  const el = (
    <label className="toggle" title={title}>
      <input type="checkbox" checked={Boolean(checked)} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} />
      <span />
    </label>
  );
  return label ? <label className="row" style={{ cursor: 'pointer' }}>{el}<span>{label}</span></label> : el;
}
export function Checkbox({ checked, onChange, label, ...p }) {
  return <label className="checkbox"><input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange?.(e.target.checked)} {...p} />{label}</label>;
}
export function SearchInput({ value, onChange, placeholder = 'Search…', style }) {
  return (
    <div style={{ position: 'relative', ...style }}>
      <Search style={{ position: 'absolute', left: 10, top: 10, width: 16, height: 16, color: 'var(--text-3)' }} />
      <input className="input" style={{ paddingLeft: 34 }} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function Modal({ title, subtitle, children, footer, onClose, size, closeOnOverlay = true }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return createPortal(
    <div className="overlay" onMouseDown={(e) => closeOnOverlay && e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${size ? `modal-${size}` : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        {title && (
          <div className="modal-header">
            <div><h2>{title}</h2>{subtitle && <p className="muted small" style={{ marginTop: 4 }}>{subtitle}</p>}</div>
            {onClose && <Button variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Close" />}
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ title, children, footer, onClose, size, headerRight }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return createPortal(
    <div className="overlay drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`drawer ${size ? `drawer-${size}` : ''}`} role="dialog" aria-modal="true">
        <div className="drawer-header"><h2 className="grow truncate">{title}</h2>{headerRight}<Button variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Close" /></div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Dropdown menu. items: [{label, icon, onClick, danger, href, divider, section, disabled}] */
export function Menu({ trigger, items, align = 'right', width }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="menu-anchor" ref={ref} onClick={(e) => e.stopPropagation()}>
      <span onClick={() => setOpen((o) => !o)} style={{ display: 'inline-flex' }}>{trigger}</span>
      {open && (
        <div className="menu" style={{ top: 'calc(100% + 4px)', [align]: 0, minWidth: width }}>
          {items.filter(Boolean).map((it, i) => {
            if (it.divider) return <div key={i} className="menu-sep" />;
            if (it.section) return <div key={i} className="menu-label">{it.section}</div>;
            const I = it.icon;
            return (
              <button key={i} type="button" className={`menu-item ${it.danger ? 'danger' : ''}`} disabled={it.disabled}
                onClick={() => { setOpen(false); it.onClick?.(); }}>
                {I && <I />}<span className="grow">{it.label}</span>{it.hint && <span className="subtle tiny">{it.hint}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} className={`tab ${value === t.value ? 'active' : ''}`} onClick={() => onChange(t.value)}>
          {t.icon && <t.icon size={15} />}{t.label}{t.count != null && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
export function Segmented({ options, value, onChange }) {
  return <div className="seg">{options.map((o) => <button key={o.value} type="button" className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>{o.label}</button>)}</div>;
}

export const Badge = ({ children, color, dot, className = '', ...p }) => <span className={`badge ${color ? `badge-${color}` : ''} ${dot ? 'badge-dot' : ''} ${className}`} {...p}>{children}</span>;
export const RunStatus = ({ status }) => { const s = RUN_STATUS[status] || { label: status, cls: '' }; return <span className={`badge badge-dot ${s.cls}`}>{s.label}</span>; };
export const FlowStatus = ({ status }) => { const s = FLOW_STATUS[status] || { label: status, cls: '' }; return <span className={`badge badge-dot ${s.cls}`}>{s.label}</span>; };

export function EmptyState({ icon: Icon = Zap, title, children, action }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon /></div>
      <h3>{title}</h3>
      {children && <p style={{ maxWidth: 420 }}>{children}</p>}
      {action && <div className="mt-8">{action}</div>}
    </div>
  );
}
export function Loading({ label = 'Loading…' }) { return <div className="center" style={{ padding: 60, gap: 10, color: 'var(--text-2)' }}><Spinner />{label}</div>; }
export function ErrorState({ error, onRetry }) {
  return <div className="callout callout-danger" style={{ margin: 20 }}><span className="grow">{error?.message || String(error)}</span>{onRetry && <Button size="sm" onClick={onRetry}>Retry</Button>}</div>;
}
export function Callout({ type = 'info', icon: Icon, children }) {
  return <div className={`callout callout-${type}`}>{Icon && <Icon />}<div className="grow">{children}</div></div>;
}
export function PageHeader({ title, description, actions, children }) {
  return (
    <div className="page-header">
      <div style={{ minWidth: 0 }}><h1>{title}</h1>{description && <p>{description}</p>}{children}</div>
      {actions && <div className="row wrap">{actions}</div>}
    </div>
  );
}
export function Avatar({ name = '?', color = '#5B3DF5', size = 28 }) {
  const initials = name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  return <span className="avatar" style={{ width: size, height: size, background: color, fontSize: size * 0.4 }} title={name}>{initials}</span>;
}

export function CopyButton({ text, label = 'Copy', size = 'sm', variant = 'secondary' }) {
  const [done, setDone] = useState(false);
  return <Button size={size} variant={variant} icon={done ? Check : Copy} onClick={async () => { await copyText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}>{label}</Button>;
}
export function CopyField({ value, secret }) {
  const [show, setShow] = useState(!secret);
  return (
    <div className="input-group">
      <input className="input mono" readOnly value={show ? value : '•'.repeat(Math.min(40, value.length))} onFocus={(e) => e.target.select()} />
      {secret && <button className="btn btn-secondary" style={{ borderRadius: 0, borderLeft: 0 }} onClick={() => setShow((s) => !s)}>{show ? 'Hide' : 'Show'}</button>}
      <CopyBtnInline text={value} />
    </div>
  );
}
function CopyBtnInline({ text }) {
  const [done, setDone] = useState(false);
  return <button className="btn btn-secondary" style={{ borderLeft: 0 }} onClick={async () => { await copyText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}>{done ? <Check /> : <Copy />}{done ? 'Copied' : 'Copy'}</button>;
}

export function JsonView({ data, maxHeight }) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return <pre className="json" style={maxHeight ? { maxHeight } : undefined}>{text ?? 'null'}</pre>;
}

export function Pagination({ total, limit, offset, onChange }) {
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);
  return (
    <div className="row between mt-16">
      <span className="muted small">Showing {offset + 1}–{Math.min(total, offset + limit)} of {total.toLocaleString()}</span>
      <div className="row">
        <Button size="sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => onChange(offset - limit)} aria-label="Previous page" />
        <span className="small">Page {page} of {pages}</span>
        <Button size="sm" icon={ChevronRight} disabled={page >= pages} onClick={() => onChange(offset + limit)} aria-label="Next page" />
      </div>
    </div>
  );
}

/** Key/value list editor. value: [{key, value}] */
export function KeyValueEditor({ value, onChange, keyPlaceholder = 'Key', valuePlaceholder = 'Value', renderValue }) {
  const rows = Array.isArray(value) && value.length ? value : [{ key: '', value: '' }];
  const set = (i, patch) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <div className="col" style={{ gap: 6 }}>
      {rows.map((r, i) => (
        <div key={i} className="row" style={{ alignItems: 'flex-start' }}>
          <Input value={r.key ?? ''} placeholder={keyPlaceholder} onChange={(e) => set(i, { key: e.target.value })} style={{ flex: '0 0 38%' }} />
          <div className="grow">{renderValue ? renderValue(r.value ?? '', (v) => set(i, { value: v }), i) : <Input value={r.value ?? ''} placeholder={valuePlaceholder} onChange={(e) => set(i, { value: e.target.value })} />}</div>
          <Button variant="ghost" size="sm" icon={X} aria-label="Remove row" onClick={() => onChange(rows.filter((_, k) => k !== i))} />
        </div>
      ))}
      <div><Button size="xs" variant="ghost" onClick={() => onChange([...rows, { key: '', value: '' }])}>+ Add row</Button></div>
    </div>
  );
}

// ---------------------------------------------------------------- App icons
const ICONS = {
  webhook: Webhook, 'calendar-clock': CalendarClock, 'mouse-pointer-click': MousePointerClick, filter: Filter, split: Split, wand: WandSparkles,
  timer: Timer, repeat: Repeat, code: Code2, sparkles: Sparkles, table: Table2, layout: LayoutTemplate, bot: Bot, mail: Mail, bell: Bell,
  database: Database, 'git-fork': GitFork, layers: Layers, 'user-check': UserCheck, rss: Rss, radar: Radar, send: Send, phone: Phone, server: Server,
};
/** Square colored app icon. Pass an app object from useApps().getApp(key). */
export function AppIcon({ app, size = 32, radius }) {
  if (!app) return <span className="app-icon" style={{ width: size, height: size, background: 'var(--surface-3)', color: 'var(--text-3)', borderRadius: radius ?? size * 0.25 }}><Plug /></span>;
  const I = ICONS[app.icon];
  return (
    <span className="app-icon" title={app.name} style={{ width: size, height: size, background: app.color || '#5B3DF5', borderRadius: radius ?? size * 0.25, fontSize: size * 0.45 }}>
      {I ? <I /> : (app.letter || app.name?.[0] || '?')}
    </span>
  );
}
export function AppIconStack({ apps, size = 26, max = 5 }) {
  const shown = apps.slice(0, max);
  return (
    <span className="row" style={{ gap: 0 }}>
      {shown.map((a, i) => <span key={(a?.key || 'x') + i} style={{ marginLeft: i ? -6 : 0, borderRadius: 8, boxShadow: '0 0 0 2px var(--surface)', display: 'inline-flex' }}><AppIcon app={a} size={size} /></span>)}
      {apps.length > max && <span className="badge" style={{ marginLeft: 4 }}>+{apps.length - max}</span>}
    </span>
  );
}

export function Logo({ size = 28, withText = true }) {
  return (
    <span className="logo">
      <svg className="logo-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#5B3DF5" />
        <rect x="8" y="8" width="16" height="5" rx="2.5" fill="#fff" />
        <rect x="8" y="15.5" width="11" height="5" rx="2.5" fill="#fff" opacity=".85" />
        <rect x="8" y="23" width="6" height="3.5" rx="1.75" fill="#FF8A3D" />
      </svg>
      {withText && <span>OneTier</span>}
    </span>
  );
}

/** Simple SVG bar chart: data [{label, value, value2?}] */
export function BarChart({ data, height = 160, color = 'var(--brand)', color2 = 'var(--danger)', valueLabel = 'tasks' }) {
  const max = Math.max(1, ...data.map((d) => (d.value || 0)));
  const w = 100 / Math.max(1, data.length);
  return (
    <div>
      <svg width="100%" height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" role="img" aria-label="Chart">
        {data.map((d, i) => {
          const h = ((d.value || 0) / max) * (height - 4);
          const h2 = ((d.value2 || 0) / max) * (height - 4);
          return (
            <g key={i}>
              <rect x={i * w + w * 0.15} y={height - h} width={w * 0.7} height={h} rx="0.8" fill={color} opacity="0.85"><title>{`${d.label}: ${d.value || 0} ${valueLabel}`}</title></rect>
              {h2 > 0 && <rect x={i * w + w * 0.15} y={height - h2} width={w * 0.7} height={h2} rx="0.8" fill={color2}><title>{`${d.label}: ${d.value2} errors`}</title></rect>}
            </g>
          );
        })}
      </svg>
      <div className="row between tiny subtle" style={{ marginTop: 6 }}>
        <span>{data[0]?.label}</span><span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  );
}
