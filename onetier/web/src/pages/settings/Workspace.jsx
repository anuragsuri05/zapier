import { useEffect, useState } from 'react';
import { AlertTriangle, LogOut, Trash2 } from 'lucide-react';
import api from '../../lib/api.js';
import { useAuth, useToast, useDialog } from '../../lib/context.jsx';
import { fmtDay } from '../../lib/util.js';
import { Button, Field, Input, Select, Toggle, Modal, Callout, Badge } from '../../components/ui.jsx';
import { SectionHead, SettingsRow, ReadOnlyNote, TIMEZONES } from './shared.jsx';

export default function Workspace() {
  const { me, refresh, isAdmin } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const ws = me.workspace;
  const initial = { name: ws.name, timezone: ws.settings?.timezone || 'UTC', notifyOnError: ws.settings?.notifyOnError !== false };
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isOwner = me.role === 'owner';

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setForm(initial), [ws.id, ws.name, ws.settings?.timezone, ws.settings?.notifyOnError]);

  const zones = TIMEZONES.includes(form.timezone) ? TIMEZONES : [form.timezone, ...TIMEZONES];
  const dirty = form.name.trim() !== initial.name || form.timezone !== initial.timezone || form.notifyOnError !== initial.notifyOnError;

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Workspace name is required');
    setSaving(true);
    try {
      await api.patch('workspace', { name: form.name.trim(), settings: { timezone: form.timezone, notifyOnError: form.notifyOnError } });
      await refresh();
      toast.success('Workspace settings saved');
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  };

  const leave = async () => {
    const ok = await dialog.confirm({ title: `Leave ${ws.name}?`, message: 'You will lose access to its flows, tables and connections. An admin can invite you back later.', danger: true, confirmText: 'Leave workspace' });
    if (!ok) return;
    try { await api.del(`workspace/members/${me.user.id}`); toast.success(`You left ${ws.name}`); window.location = '/'; }
    catch (err) { toast.error(err.message); }
  };

  return (
    <div className="settings-section">
      <SectionHead title="Workspace" description={`Created ${fmtDay(ws.created_at)} · your role: ${me.role}`} />
      <form className="card" onSubmit={save}>
        <div className="card-header"><h3>General</h3>{!isAdmin && <Badge>Read-only</Badge>}</div>
        <SettingsRow label="Workspace name" description="Visible to everyone in this workspace.">
          <Field><Input value={form.name} disabled={!isAdmin} maxLength={80} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
        </SettingsRow>
        <SettingsRow label="Time zone" description="Used by schedules, digests and date formatting in flows.">
          <Field><Select value={form.timezone} disabled={!isAdmin} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))} options={zones.map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))} /></Field>
        </SettingsRow>
        <SettingsRow label="Error notifications" description="Default for new flows. Each flow can override it.">
          <Toggle checked={form.notifyOnError} disabled={!isAdmin} onChange={(v) => setForm((f) => ({ ...f, notifyOnError: v }))} label="Email me when a flow errors" />
        </SettingsRow>
        <div className="card-footer">
          {isAdmin ? (
            <>
              <Button variant="ghost" disabled={!dirty || saving} onClick={() => setForm(initial)}>Reset</Button>
              <Button type="submit" variant="primary" loading={saving} disabled={!dirty}>Save changes</Button>
            </>
          ) : <ReadOnlyNote />}
        </div>
      </form>

      <div className="card danger-zone">
        <div className="card-header"><h3>Danger zone</h3></div>
        <SettingsRow label="Leave workspace" description={isOwner ? 'Owners must transfer ownership to another member before leaving.' : 'Remove yourself from this workspace.'}>
          <Button variant="danger-ghost" icon={LogOut} onClick={leave}>Leave workspace</Button>
        </SettingsRow>
        {isOwner && (
          <SettingsRow label="Delete workspace" description="Permanently delete this workspace with all flows, tables, interfaces, chatbots, connections and history.">
            <Button variant="danger" icon={Trash2} onClick={() => setDeleting(true)}>Delete workspace</Button>
          </SettingsRow>
        )}
      </div>
      {deleting && <DeleteWorkspaceModal ws={ws} onClose={() => setDeleting(false)} />}
    </div>
  );
}

function DeleteWorkspaceModal({ ws, onClose }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const match = confirm === ws.name;
  const submit = async (e) => {
    e?.preventDefault();
    if (!match) return;
    setBusy(true);
    try { await api.del('workspace', { confirm }); toast.success('Workspace deleted'); window.location = '/'; }
    catch (err) { toast.error(err.message); setBusy(false); }
  };
  return (
    <Modal title="Delete workspace" size="sm" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" disabled={!match} loading={busy} onClick={submit}>Delete forever</Button></>}>
      <Callout type="danger" icon={AlertTriangle}>This permanently deletes <b>{ws.name}</b> and everything in it. This can't be undone.</Callout>
      <form onSubmit={submit} className="mt-16">
        <Field label={<>Type <b>{ws.name}</b> to confirm</>}>
          <Input autoFocus value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={ws.name} />
        </Field>
      </form>
    </Modal>
  );
}
