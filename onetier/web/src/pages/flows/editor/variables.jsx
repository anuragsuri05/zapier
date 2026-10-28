// Variable picker popover and the mappable text input that uses it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Braces, ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import { AppIcon } from '../../../components/ui.jsx';
import { flattenPaths } from '../../../lib/util.js';
import { useVars } from './context.js';
import { previewTemplate } from './defUtils.js';

const preview = (v) => {
  if (v === null) return 'null';
  if (v === undefined) return '';
  if (Array.isArray(v)) return `[${v.length} item${v.length === 1 ? '' : 's'}]`;
  if (typeof v === 'object') return '{…}';
  const s = String(v);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
};

export function VariablePicker({ onPick, onClose }) {
  const { groups } = useVars();
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState({});
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && (e.stopPropagation(), onClose());
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onClose]);

  const lists = useMemo(() => groups.map((g) => {
    const rows = flattenPaths(g.data || {});
    const ql = q.trim().toLowerCase();
    const filtered = ql ? rows.filter((r) => r.path.toLowerCase().includes(ql) || String(preview(r.value)).toLowerCase().includes(ql) || g.label.toLowerCase().includes(ql)) : rows;
    return { ...g, rows: filtered, total: rows.length };
  }), [groups, q]);

  const any = lists.some((l) => l.rows.length);
  return (
    <div className="fe-varpicker" onMouseDown={(e) => e.stopPropagation()}>
      <div className="fe-varpicker-head">
        <Search size={15} className="subtle" />
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search data from previous steps…" />
        <button type="button" className="btn btn-ghost btn-xs btn-icon" onClick={onClose} aria-label="Close"><X /></button>
      </div>
      <div className="fe-varpicker-body">
        {!groups.length && <div className="fe-varpicker-empty">No data yet. Test the trigger (and earlier steps) to map their fields here.</div>}
        {groups.length > 0 && !any && <div className="fe-varpicker-empty">No fields match “{q}”.</div>}
        {lists.map((g) => (g.rows.length || (!q && !g.total)) ? (
          <div key={g.key} className="fe-vargroup">
            <button type="button" className="fe-vargroup-head" onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}>
              {collapsed[g.key] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              {g.app !== undefined && <AppIcon app={g.app} size={18} />}
              <span className="grow truncate">{g.label}</span>
              {g.hint && <span className="tiny subtle">{g.hint}</span>}
            </button>
            {!collapsed[g.key] && (
              <div>
                {!g.rows.length && <div className="fe-varpicker-empty small">No sample data — test this step first.</div>}
                {g.rows.slice(0, 200).map((r) => (
                  <button key={r.path} type="button" className="fe-varrow" onClick={() => onPick(`{{${g.key}${r.path ? `.${r.path}` : ''}}}`)}>
                    <span className="fe-varrow-path mono">{r.path || '(whole value)'}</span>
                    <span className="fe-varrow-val">{preview(r.value)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null)}
      </div>
    </div>
  );
}

/**
 * Text input / textarea with a "{ }" button that inserts {{step.path}} tokens at the cursor.
 */
export function MappableInput({ value, onChange, multiline, rows = 3, placeholder, mono, invalid, type = 'text', noPicker, inputMode }) {
  const { scopes } = useVars();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const wrap = useRef(null);
  const sel = useRef(null);
  const str = value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const remember = (e) => { sel.current = [e.target.selectionStart, e.target.selectionEnd]; };
  const insert = (tok) => {
    const [a, b] = sel.current || [str.length, str.length];
    const next = str.slice(0, a) + tok + str.slice(b);
    onChange(next);
    setOpen(false);
    const pos = a + tok.length;
    sel.current = [pos, pos];
    requestAnimationFrame(() => { const el = ref.current; if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { /* number inputs */ } } });
  };
  const pv = useMemo(() => previewTemplate(str, scopes), [str, scopes]);

  const common = {
    ref, value: str, placeholder, onChange: (e) => onChange(e.target.value), onSelect: remember, onKeyUp: remember, onClick: remember, onBlur: remember,
    className: `${multiline ? 'textarea' : 'input'} ${mono ? 'mono' : ''} ${invalid ? 'invalid' : ''} fe-mappable-input`,
  };
  return (
    <div className="fe-mappable" ref={wrap}>
      <div className="fe-mappable-box">
        {multiline ? <textarea rows={rows} {...common} /> : <input type={type} inputMode={inputMode} {...common} />}
        {!noPicker && (
          <button type="button" className={`fe-map-btn ${open ? 'active' : ''}`} title="Insert data from previous steps" aria-label="Insert data"
            onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((o) => !o)}>
            <Braces />
          </button>
        )}
      </div>
      {pv !== null && pv !== str && <div className="fe-preview tiny" title={pv}><span className="subtle">Preview:</span> {pv || <em className="subtle">(empty)</em>}</div>}
      {open && <VariablePicker onPick={insert} onClose={() => setOpen(false)} />}
    </div>
  );
}
