import { useMemo, useState } from 'react';
import { Crown, Lock } from 'lucide-react';
import { useApps } from '../../../lib/context.jsx';
import { AppIcon, SearchInput, EmptyState } from '../../../components/ui.jsx';
import { useEditor } from './context.js';

const CATEGORY_ORDER = ['Built-in tools', 'OneTier products', 'AI', 'Communication', 'Developer tools'];

/** Searchable app picker grouped by category. mode: 'trigger' | 'action' */
export default function AppPicker({ mode, onPick, current }) {
  const { apps } = useApps();
  const { plan } = useEditor();
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const list = apps.filter((a) => Object.keys((mode === 'trigger' ? a.triggers : a.actions) || {}).length)
      .filter((a) => !ql || `${a.name} ${a.description} ${a.category}`.toLowerCase().includes(ql)
        || Object.values((mode === 'trigger' ? a.triggers : a.actions) || {}).some((x) => x.name.toLowerCase().includes(ql)));
    const by = {};
    for (const a of list) (by[a.category || 'Other'] = by[a.category || 'Other'] || []).push(a);
    return Object.entries(by)
      .sort(([a], [b]) => {
        const ia = CATEGORY_ORDER.indexOf(a); const ib = CATEGORY_ORDER.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
      })
      .map(([cat, items]) => [cat, items.sort((x, y) => Number(Boolean(y.builtin)) - Number(Boolean(x.builtin)) || x.name.localeCompare(y.name))]);
  }, [apps, mode, q]);

  return (
    <div className="fe-apppicker">
      <SearchInput value={q} onChange={setQ} placeholder={mode === 'trigger' ? 'Search apps and triggers…' : 'Search apps and actions…'} />
      <div className="fe-apppicker-list">
        {!groups.length && <EmptyState title="No apps found">Try a different search term.</EmptyState>}
        {groups.map(([cat, items]) => (
          <div key={cat}>
            <div className="fe-apppicker-cat">{cat}</div>
            <div className="fe-apppicker-grid">
              {items.map((a) => {
                const count = Object.keys((mode === 'trigger' ? a.triggers : a.actions) || {}).length;
                return (
                  <button key={a.key} type="button" className={`fe-appitem ${current === a.key ? 'selected' : ''}`} onClick={() => onPick(a)}>
                    <AppIcon app={a} size={30} />
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="fe-appitem-name truncate">{a.name}</span>
                      <span className="fe-appitem-sub truncate">{count} {mode === 'trigger' ? 'trigger' : 'action'}{count === 1 ? '' : 's'}{a.description ? ` · ${a.description}` : ''}</span>
                    </span>
                    {a.builtin ? <span className="badge">Built-in</span>
                      : a.custom ? <span className="badge badge-blue">Custom</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
