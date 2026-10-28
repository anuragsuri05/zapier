import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Upload, MoreHorizontal, ExternalLink, Pencil, Copy, Download, Trash2, Table2, Rows3, Columns3, Clock } from 'lucide-react';
import api from '../../lib/api.js';
import { useFetch, useToast, useDialog } from '../../lib/context.jsx';
import { timeAgo, plural } from '../../lib/util.js';
import { Button, Field, Input, Textarea, Modal, Menu, EmptyState, Loading, ErrorState, PageHeader, SearchInput } from '../../components/ui.jsx';
import { TABLE_TEMPLATES, fieldTypeMeta, parseCSV, readFileText } from './fieldTypes.js';
import './tables.css';

function CreateTableModal({ onClose, onCreated }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tpl, setTpl] = useState('blank');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e?.preventDefault();
    if (!name.trim()) { setError('Give the table a name.'); return; }
    setBusy(true);
    try {
      const t = TABLE_TEMPLATES.find((x) => x.key === tpl);
      const { id } = await api.post('tables', { name: name.trim(), description: description.trim(), fields: t.fields });
      toast.success('Table created');
      onCreated(id);
    } catch (err) { toast.error(err.message); setBusy(false); }
  };
  return (
    <Modal title="Create a table" onClose={onClose} size="lg"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Create table</Button></>}>
      <form onSubmit={submit} className="col gap-16">
        <Field label="Name" required error={error}>
          <Input autoFocus value={name} invalid={Boolean(error)} placeholder="e.g. Customers" onChange={(e) => { setName(e.target.value); setError(''); }} />
        </Field>
        <Field label="Description">
          <Textarea rows={2} value={description} placeholder="What lives in this table?" onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Start from">
          <div className="grid-2" style={{ gap: 10 }}>
            {TABLE_TEMPLATES.map((t) => (
              <button type="button" key={t.key} className={`tl-template ${tpl === t.key ? 'on' : ''}`} onClick={() => setTpl(t.key)} aria-pressed={tpl === t.key}>
                <span className="bold">{t.name}</span>
                <span className="muted small">{t.description}</span>
                <span className="chips">{t.fields.map((f) => { const I = fieldTypeMeta(f.type).icon; return <span key={f.name} className="badge"><I />{f.name}</span>; })}</span>
              </button>
            ))}
          </div>
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export default function TablesList() {
  const nav = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const { data, error, loading, reload } = useFetch('tables');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [q, setQ] = useState('');
  const fileRef = useRef(null);

  const list = useMemo(() => (data || []).filter((t) => `${t.name} ${t.description}`.toLowerCase().includes(q.toLowerCase())), [data, q]);

  const importFile = async (file) => {
    if (!file) return;
    setImporting(true);
    try {
      const csv = await readFileText(file);
      const rows = parseCSV(csv);
      if (rows.length < 2) throw new Error('That CSV needs a header row and at least one data row.');
      const header = [...new Set(rows[0].map((h) => h.trim()).filter(Boolean))];
      const name = file.name.replace(/\.[^.]+$/, '') || 'Imported table';
      const { id } = await api.post('tables', { name, description: `Imported from ${file.name}`, fields: header.map((h) => ({ name: h, type: 'text' })) });
      try {
        const r = await api.post(`tables/${id}/import`, { csv });
        toast.success(`Imported ${plural(r.imported, 'record')}`);
      } catch (err) { toast.error(`Table created, but the import failed: ${err.message}`); }
      nav(`/tables/${id}`);
    } catch (err) { toast.error(err.message); }
    finally { setImporting(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const rename = async (t) => {
    const name = await dialog.prompt({ title: 'Rename table', label: 'Name', defaultValue: t.name, confirmText: 'Rename' });
    if (!name?.trim() || name.trim() === t.name) return;
    try { await api.patch(`tables/${t.id}`, { name: name.trim() }); toast.success('Table renamed'); reload(); } catch (e) { toast.error(e.message); }
  };
  const duplicate = async (t) => {
    try { await api.post(`tables/${t.id}/duplicate`, {}); toast.success(`Duplicated “${t.name}”`); reload(); } catch (e) { toast.error(e.message); }
  };
  const exportCsv = async (t) => {
    try { await api.download(`tables/${t.id}/export`, `${t.name.replace(/[^\w-]+/g, '_')}.csv`); } catch (e) { toast.error(e.message); }
  };
  const remove = async (t) => {
    const ok = await dialog.confirm({ title: `Delete “${t.name}”?`, message: `This permanently deletes the table and its ${plural(t.record_count, 'record')}. Flows that use it will stop working.`, danger: true, confirmText: 'Delete table' });
    if (!ok) return;
    try { await api.del(`tables/${t.id}`); toast.success('Table deleted'); reload(); } catch (e) { toast.error(e.message); }
  };

  return (
    <div className="page">
      <PageHeader title="Tables" description="Store and organise the data your flows, interfaces and chatbots work with."
        actions={<>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => importFile(e.target.files?.[0])} />
          <Button icon={Upload} loading={importing} onClick={() => fileRef.current?.click()}>Import CSV</Button>
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>New table</Button>
        </>} />

      {loading && !data ? <Loading /> : error ? <ErrorState error={error} onRetry={reload} /> : !data.length ? (
        <div className="card"><EmptyState icon={Table2} title="No tables yet" action={<div className="row"><Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Create a table</Button><Button icon={Upload} onClick={() => fileRef.current?.click()}>Import CSV</Button></div>}>
          Tables hold records like leads, tasks or inventory. Flows can add and update records automatically.
        </EmptyState></div>
      ) : (
        <>
          {data.length > 6 && <div className="toolbar"><SearchInput value={q} onChange={setQ} placeholder="Search tables…" style={{ width: 280, maxWidth: '100%' }} /></div>}
          {!list.length ? <div className="card"><EmptyState title="No matching tables">Try a different search.</EmptyState></div> : (
            <div className="grid-auto">
              {list.map((t) => (
                <div key={t.id} className="card card-hover tl-card" role="link" tabIndex={0} onClick={() => nav(`/tables/${t.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/tables/${t.id}`)}>
                  <div className="row" style={{ alignItems: 'flex-start' }}>
                    <span className="tl-card-icon"><Table2 /></span>
                    <div className="grow"><h3 className="truncate">{t.name}</h3></div>
                    <Menu trigger={<Button variant="ghost" size="sm" icon={MoreHorizontal} aria-label="Table actions" />} items={[
                      { label: 'Open', icon: ExternalLink, onClick: () => nav(`/tables/${t.id}`) },
                      { label: 'Rename', icon: Pencil, onClick: () => rename(t) },
                      { label: 'Duplicate', icon: Copy, onClick: () => duplicate(t) },
                      { label: 'Export CSV', icon: Download, onClick: () => exportCsv(t) },
                      { divider: true },
                      { label: 'Delete', icon: Trash2, danger: true, onClick: () => remove(t) },
                    ]} />
                  </div>
                  <p className="desc">{t.description || <span className="subtle">No description</span>}</p>
                  <div className="tl-meta">
                    <span><Rows3 />{plural(t.record_count, 'record')}</span>
                    <span><Columns3 />{plural(t.fields.length, 'field')}</span>
                    <span><Clock />Updated {timeAgo(t.updated_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {creating && <CreateTableModal onClose={() => setCreating(false)} onCreated={(id) => nav(`/tables/${id}`)} />}
    </div>
  );
}
