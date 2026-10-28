import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, ChevronDown, Library, Wand2, Upload, Zap, Folder, FolderOpen, FolderPlus, FolderInput, Inbox, Trash2, MoreHorizontal, Pencil,
  Copy, Download, History, ExternalLink, RotateCcw, Power, PowerOff, X,
} from 'lucide-react';
import api from '../../lib/api.js';
import { useApps, useFetch, useToast, useDialog } from '../../lib/context.jsx';
import { timeAgo, fmtNum, plural } from '../../lib/util.js';
import {
  Button, Menu, Tabs, SearchInput, Checkbox, Toggle, Badge, AppIconStack, EmptyState, Loading, ErrorState, PageHeader, Modal, Select, Field, Input,
} from '../../components/ui.jsx';
import '../core.css';

export default function FlowsList() {
  const nav = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const { getApp } = useApps();
  const fileRef = useRef(null);

  const [folder, setFolder] = useState('all'); // 'all' | 'none' | 'trash' | folderId
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [moveIds, setMoveIds] = useState(null);

  const trash = folder === 'trash';
  const flows = useFetch('flows');
  const trashed = useFetch(trash ? 'flows?trash=1' : null);
  const folders = useFetch('folders');

  const reloadAll = () => { flows.reload(); folders.reload(); if (trash) trashed.reload(); setSelected(new Set()); };

  const source = trash ? trashed : flows;
  const inFolder = useMemo(() => {
    const rows = source.data || [];
    if (trash || folder === 'all') return rows;
    if (folder === 'none') return rows.filter((f) => !f.folder_id);
    return rows.filter((f) => f.folder_id === folder);
  }, [source.data, folder, trash]);
  const counts = useMemo(() => ({
    all: inFolder.length, on: inFolder.filter((f) => f.status === 'on').length,
    off: inFolder.filter((f) => f.status === 'off').length, draft: inFolder.filter((f) => f.status === 'draft').length,
  }), [inFolder]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return inFolder.filter((f) => (status === 'all' || f.status === status) && (!needle || `${f.name} ${f.description || ''}`.toLowerCase().includes(needle)));
  }, [inFolder, status, q]);

  const folderList = folders.data || [];
  const folderName = (id) => folderList.find((f) => f.id === id)?.name;
  const noFolderCount = (flows.data || []).filter((f) => !f.folder_id).length;

  // ------------------------------------------------ actions
  const run = async (fn, ok) => { try { await fn(); if (ok) toast.success(ok); reloadAll(); } catch (e) { toast.error(e.message); } };

  const createFlow = async () => {
    try {
      const body = { name: 'Untitled flow' };
      if (folder !== 'all' && folder !== 'none' && !trash) body.folderId = folder;
      const r = await api.post('flows', body); nav(`/flows/${r.id}`);
    } catch (e) { toast.error(e.message); }
  };
  const importJson = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const r = await api.post('flows/import', { json: text });
      toast.success('Flow imported. Reconnect any app accounts before publishing.');
      nav(`/flows/${r.id}`);
    } catch (e) { toast.error(e.message); } finally { if (fileRef.current) fileRef.current.value = ''; }
  };
  const setFlowStatus = (f, on) => run(() => api.post(`flows/${f.id}/status`, { status: on ? 'on' : 'off' }), `${f.name} turned ${on ? 'on' : 'off'}`);
  const rename = async (f) => {
    const name = await dialog.prompt({ title: 'Rename flow', label: 'Name', defaultValue: f.name, confirmText: 'Rename' });
    if (name && name.trim() !== f.name) run(() => api.put(`flows/${f.id}`, { name: name.trim() }), 'Flow renamed');
  };
  const duplicate = (f) => run(() => api.post(`flows/${f.id}/duplicate`), 'Flow duplicated');
  const exportJson = async (f) => {
    try { await api.download(`/api/flows/${f.id}/export`, `${f.name.replace(/[^\w-]+/g, '_')}.onetier.json`); } catch (e) { toast.error(e.message); }
  };
  const toTrash = async (f) => {
    if (!(await dialog.confirm({ title: 'Move to trash?', message: `“${f.name}” will be turned off and moved to the trash. You can restore it later.`, danger: true, confirmText: 'Move to trash' }))) return;
    run(() => api.del(`flows/${f.id}`), 'Moved to trash');
  };
  const restore = (f) => run(() => api.post(`flows/${f.id}/restore`), 'Flow restored');
  const destroy = async (f) => {
    if (!(await dialog.confirm({ title: 'Delete forever?', message: `“${f.name}” and its version history will be permanently deleted. This can't be undone.`, danger: true, confirmText: 'Delete forever' }))) return;
    run(() => api.del(`flows/${f.id}?permanent=true`), 'Flow deleted');
  };
  const bulk = async (action, extra = {}) => {
    const ids = [...selected];
    if (action === 'delete' && !(await dialog.confirm({ title: `Move ${plural(ids.length, 'flow')} to trash?`, message: 'They will be turned off. You can restore them from the trash.', danger: true, confirmText: 'Move to trash' }))) return;
    try {
      const r = await api.post('flows/bulk', { ids, action, ...extra });
      const skipped = ids.length - r.updated;
      toast.success(`${plural(r.updated, 'flow')} updated`);
      if (action === 'on' && skipped > 0) toast.info(`${plural(skipped, 'draft')} skipped — publish a flow before turning it on.`);
      reloadAll();
    } catch (e) { toast.error(e.message); }
  };
  const bulkTrashAction = async (kind) => {
    const ids = [...selected];
    if (kind === 'destroy' && !(await dialog.confirm({ title: `Delete ${plural(ids.length, 'flow')} forever?`, message: "This can't be undone.", danger: true, confirmText: 'Delete forever' }))) return;
    try {
      for (const id of ids) await (kind === 'destroy' ? api.del(`flows/${id}?permanent=true`) : api.post(`flows/${id}/restore`));
      toast.success(kind === 'destroy' ? `${plural(ids.length, 'flow')} deleted` : `${plural(ids.length, 'flow')} restored`);
    } catch (e) { toast.error(e.message); }
    reloadAll();
  };

  const newFolder = async () => {
    const name = await dialog.prompt({ title: 'New folder', label: 'Folder name', placeholder: 'Marketing', confirmText: 'Create' });
    if (!name?.trim()) return;
    try { const r = await api.post('folders', { name: name.trim() }); folders.reload(); setFolder(r.id); } catch (e) { toast.error(e.message); }
  };
  const renameFolder = async (f) => {
    const name = await dialog.prompt({ title: 'Rename folder', label: 'Folder name', defaultValue: f.name, confirmText: 'Rename' });
    if (!name?.trim()) return;
    try { await api.patch(`folders/${f.id}`, { name: name.trim() }); folders.reload(); } catch (e) { toast.error(e.message); }
  };
  const deleteFolder = async (f) => {
    if (!(await dialog.confirm({ title: `Delete “${f.name}”?`, message: `The folder is removed; its ${plural(f.count, 'flow')} move to “No folder”.`, danger: true, confirmText: 'Delete folder' }))) return;
    try { await api.del(`folders/${f.id}`); if (folder === f.id) setFolder('all'); reloadAll(); } catch (e) { toast.error(e.message); }
  };

  // ------------------------------------------------ selection
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = (v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set());
  const toggleOne = (id, v) => setSelected((s) => { const n = new Set(s); if (v) n.add(id); else n.delete(id); return n; });
  const pick = (f) => { setFolder(f); setSelected(new Set()); setStatus('all'); };

  const title = trash ? 'Trash' : folder === 'all' ? 'All flows' : folder === 'none' ? 'No folder' : folderName(folder) || 'Folder';

  return (
    <div className="page page-wide" style={{ maxWidth: 1400 }}>
      <PageHeader title="Flows" description="Automations that run when something happens in your apps."
        actions={<>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => importJson(e.target.files?.[0])} />
          <Menu width={210} trigger={<Button icon={ChevronDown}>More</Button>} items={[
            { label: 'From template', icon: Library, onClick: () => nav('/templates') },
            { label: 'With Copilot', icon: Wand2, onClick: () => window.dispatchEvent(new CustomEvent('onetier:copilot')) },
            { label: 'Import JSON', icon: Upload, onClick: () => fileRef.current?.click() },
          ]} />
          <Button variant="primary" icon={Plus} onClick={createFlow}>Create flow</Button>
        </>} />

      <div className="flows-layout">
        <nav className="folder-rail" aria-label="Folders">
          <button className={`folder-item ${folder === 'all' ? 'active' : ''}`} onClick={() => pick('all')}><Zap />All flows<span className="fcount">{flows.data?.length ?? ''}</span></button>
          <button className={`folder-item ${folder === 'none' ? 'active' : ''}`} onClick={() => pick('none')}><Inbox />No folder<span className="fcount">{flows.data ? noFolderCount : ''}</span></button>
          <div className="rail-label">Folders</div>
          {folderList.map((f) => (
            <div key={f.id} className={`folder-item ${folder === f.id ? 'active' : ''}`} role="button" tabIndex={0} onClick={() => pick(f.id)} onKeyDown={(e) => e.key === 'Enter' && pick(f.id)}>
              {folder === f.id ? <FolderOpen /> : <Folder />}<span className="truncate">{f.name}</span><span className="fcount">{f.count}</span>
              <span className="fmenu"><Menu width={160} trigger={<Button size="xs" variant="ghost" icon={MoreHorizontal} aria-label={`${f.name} folder options`} />} items={[
                { label: 'Rename', icon: Pencil, onClick: () => renameFolder(f) },
                { label: 'Delete folder', icon: Trash2, danger: true, onClick: () => deleteFolder(f) },
              ]} /></span>
            </div>
          ))}
          <button className="folder-item" onClick={newFolder}><FolderPlus />New folder</button>
          <div className="rail-label" />
          <button className={`folder-item ${trash ? 'active' : ''}`} onClick={() => pick('trash')}><Trash2 />Trash</button>
        </nav>

        <div style={{ minWidth: 0 }}>
          <div className="row between wrap" style={{ marginBottom: 4 }}>
            <h2>{title}</h2>
          </div>
          {!trash && (
            <Tabs value={status} onChange={(v) => { setStatus(v); setSelected(new Set()); }} tabs={[
              { value: 'all', label: 'All', count: counts.all }, { value: 'on', label: 'On', count: counts.on },
              { value: 'off', label: 'Off', count: counts.off }, { value: 'draft', label: 'Draft', count: counts.draft },
            ]} />
          )}
          <div className="toolbar">
            <SearchInput value={q} onChange={setQ} placeholder="Search flows…" style={{ flex: '1 1 240px', maxWidth: 360 }} />
          </div>

          {selected.size > 0 && (
            <div className="bulk-bar">
              <span className="bold small">{selected.size} selected</span>
              <div className="grow" />
              {trash ? <>
                <Button size="sm" icon={RotateCcw} onClick={() => bulkTrashAction('restore')}>Restore</Button>
                <Button size="sm" variant="danger" icon={Trash2} onClick={() => bulkTrashAction('destroy')}>Delete forever</Button>
              </> : <>
                <Button size="sm" icon={Power} onClick={() => bulk('on')}>Turn on</Button>
                <Button size="sm" icon={PowerOff} onClick={() => bulk('off')}>Turn off</Button>
                <Button size="sm" icon={FolderInput} onClick={() => setMoveIds([...selected])}>Move to folder</Button>
                <Button size="sm" variant="danger-ghost" icon={Trash2} onClick={() => bulk('delete')}>Move to trash</Button>
              </>}
              <Button size="sm" variant="ghost" icon={X} onClick={() => setSelected(new Set())} aria-label="Clear selection" />
            </div>
          )}

          {source.loading && !source.data ? <Loading /> : source.error && !source.data ? <ErrorState error={source.error} onRetry={source.reload} /> : !rows.length ? (
            <div className="card">
              {trash ? <EmptyState icon={Trash2} title="Trash is empty">Flows you move to the trash show up here so you can restore them.</EmptyState>
                : inFolder.length ? <EmptyState icon={Zap} title="No matching flows">Try a different search or status filter.</EmptyState>
                : <EmptyState icon={Zap} title={folder === 'all' ? 'No flows yet' : 'This folder is empty'}
                    action={<div className="row wrap" style={{ justifyContent: 'center' }}>
                      <Button variant="primary" icon={Plus} onClick={createFlow}>Create flow</Button>
                      <Button icon={Library} onClick={() => nav('/templates')}>Browse templates</Button>
                      <Button icon={Wand2} onClick={() => window.dispatchEvent(new CustomEvent('onetier:copilot'))}>Ask Copilot</Button>
                    </div>}>
                    A flow pairs a trigger with actions — for example, “when a form is submitted, add a row and send an email”.
                  </EmptyState>}
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}><Checkbox checked={allChecked} onChange={toggleAll} aria-label="Select all" /></th>
                    <th>Apps</th><th>Name</th><th>Status</th>
                    {trash ? <th>Deleted</th> : <><th>Last run</th><th className="right">Runs / errors (30d)</th><th className="right">Tasks</th><th>Owner</th><th>Updated</th></>}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((f) => (
                    <tr key={f.id} className={`${trash ? '' : 'clickable'} ${selected.has(f.id) ? 'selected' : ''}`} onClick={() => !trash && nav(`/flows/${f.id}`)}>
                      <td onClick={(e) => e.stopPropagation()}><Checkbox checked={selected.has(f.id)} onChange={(v) => toggleOne(f.id, v)} aria-label={`Select ${f.name}`} /></td>
                      <td>{f.apps.length ? <AppIconStack apps={f.apps.map(getApp)} size={24} max={4} /> : <span className="subtle tiny">No apps</span>}</td>
                      <td className="flow-name-cell">
                        <div className="fn truncate">{f.name}</div>
                        <div className="fd">{f.description || `${plural(f.steps, 'step')}${f.folder_id && folder === 'all' && folderName(f.folder_id) ? ` · ${folderName(f.folder_id)}` : ''}`}</div>
                      </td>
                      <td className="nowrap" onClick={(e) => e.stopPropagation()}>
                        {trash ? <Badge>{f.status}</Badge> : f.status === 'draft' ? (
                          <div className="row gap-4"><Badge color="yellow" dot>Draft</Badge><button className="btn btn-ghost btn-xs" onClick={() => nav(`/flows/${f.id}`)}>Open to publish</button></div>
                        ) : (
                          <div className="row"><Toggle checked={f.status === 'on'} onChange={(v) => setFlowStatus(f, v)} title={f.status === 'on' ? 'Turn off' : 'Turn on'} /><span className="small">{f.status === 'on' ? 'On' : 'Off'}</span>
                            {f.has_unpublished && <Badge className="tiny" title="Has unpublished changes">Edited</Badge>}</div>
                        )}
                      </td>
                      {trash ? <td className="nowrap small muted">{timeAgo(f.deleted_at)}</td> : <>
                        <td className="nowrap small muted">{f.last_run_at ? timeAgo(f.last_run_at) : 'Never'}</td>
                        <td className="right nowrap small">{fmtNum(f.stats.runs)} <span className="subtle">/</span> <span style={f.stats.errors ? { color: 'var(--danger)', fontWeight: 600 } : { color: 'var(--text-3)' }}>{fmtNum(f.stats.errors)}</span></td>
                        <td className="right small">{fmtNum(f.stats.tasks)}</td>
                        <td className="nowrap small muted">{f.owner || '—'}</td>
                        <td className="nowrap small muted">{timeAgo(f.updated_at)}</td>
                      </>}
                      <td className="td-actions" onClick={(e) => e.stopPropagation()}>
                        {trash ? (
                          <div className="row gap-4" style={{ justifyContent: 'flex-end' }}>
                            <Button size="xs" icon={RotateCcw} onClick={() => restore(f)}>Restore</Button>
                            <Button size="xs" variant="danger-ghost" icon={Trash2} onClick={() => destroy(f)}>Delete forever</Button>
                          </div>
                        ) : (
                          <Menu width={200} trigger={<Button size="sm" variant="ghost" icon={MoreHorizontal} aria-label={`Actions for ${f.name}`} />} items={[
                            { label: 'Open', icon: ExternalLink, onClick: () => nav(`/flows/${f.id}`) },
                            { label: 'Rename', icon: Pencil, onClick: () => rename(f) },
                            { label: 'Duplicate', icon: Copy, onClick: () => duplicate(f) },
                            { label: 'Move to folder', icon: FolderInput, onClick: () => setMoveIds([f.id]) },
                            { label: 'Export JSON', icon: Download, onClick: () => exportJson(f) },
                            { label: 'View history', icon: History, onClick: () => nav(`/history?flowId=${f.id}`) },
                            { divider: true },
                            { label: 'Move to trash', icon: Trash2, danger: true, onClick: () => toTrash(f) },
                          ]} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > 0 && <div className="tiny subtle mt-8">{plural(rows.length, 'flow')}</div>}
        </div>
      </div>

      {moveIds && <MoveModal ids={moveIds} folders={folderList} current={moveIds.length === 1 ? (flows.data || []).find((f) => f.id === moveIds[0])?.folder_id : undefined}
        onClose={() => setMoveIds(null)} onDone={() => { setMoveIds(null); reloadAll(); }} />}
    </div>
  );
}

function MoveModal({ ids, folders, current, onClose, onDone }) {
  const toast = useToast();
  const [target, setTarget] = useState(current || '');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      let folderId = target === '__new' ? null : target || null;
      if (target === '__new') {
        if (!newName.trim()) { toast.error('Enter a folder name'); setBusy(false); return; }
        folderId = (await api.post('folders', { name: newName.trim() })).id;
      }
      await api.post('flows/bulk', { ids, action: 'move', folderId });
      toast.success(`${plural(ids.length, 'flow')} moved`);
      onDone();
    } catch (e) { toast.error(e.message); setBusy(false); }
  };
  return (
    <Modal title={`Move ${plural(ids.length, 'flow')}`} size="sm" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Move</Button></>}>
      <Field label="Folder">
        <Select value={target} onChange={(e) => setTarget(e.target.value)}
          options={[{ value: '', label: 'No folder' }, ...folders.map((f) => ({ value: f.id, label: f.name })), { value: '__new', label: '+ New folder…' }]} />
      </Field>
      {target === '__new' && <Field label="New folder name" className="mt-16"><Input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Marketing" /></Field>}
    </Modal>
  );
}
