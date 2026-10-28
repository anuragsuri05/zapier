import { useState } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus, Trash2, Link2, Mail } from 'lucide-react';
import api from '../../lib/api.js';
import { useAuth, useToast, useDialog, useFetch } from '../../lib/context.jsx';
import { fmtDay, timeAgo, copyText } from '../../lib/util.js';
import { Button, Field, Input, Select, Modal, Avatar, Badge, Loading, ErrorState, Callout, EmptyState } from '../../components/ui.jsx';
import { SectionHead } from './shared.jsx';

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', member: 'Member' };

export default function Members() {
  const { me, isAdmin, refresh } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const { data, error, loading, reload } = useFetch('workspace/members');
  const [inviting, setInviting] = useState(false);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const { members, invites } = data;

  const changeRole = async (m, role) => {
    if (role === 'owner' && !await dialog.confirm({ title: `Make ${m.name} an owner?`, message: 'Owners can delete the workspace and transfer ownership. You can have more than one owner.', confirmText: 'Make owner' })) return;
    try { await api.patch(`workspace/members/${m.id}`, { role }); toast.success(`${m.name} is now ${ROLE_LABEL[role].toLowerCase()}`); reload(); if (m.id === me.user.id) refresh(); }
    catch (err) { toast.error(err.message); }
  };
  const remove = async (m) => {
    if (!await dialog.confirm({ title: `Remove ${m.name}?`, message: `${m.name} (${m.email}) will immediately lose access to ${me.workspace.name}. Flows they built stay in the workspace.`, danger: true, confirmText: 'Remove member' })) return;
    try { await api.del(`workspace/members/${m.id}`); toast.success(`${m.name} was removed`); reload(); }
    catch (err) { toast.error(err.message); }
  };
  const revoke = async (inv) => {
    if (!await dialog.confirm({ title: 'Revoke invite?', message: `The invite link sent to ${inv.email} will stop working.`, danger: true, confirmText: 'Revoke' })) return;
    try { await api.del(`workspace/invites/${inv.id}`); toast.success('Invite revoked'); reload(); }
    catch (err) { toast.error(err.message); }
  };
  const copyLink = async (inv) => { await copyText(`${window.location.origin}/invite/${inv.token}`); toast.success('Invite link copied'); };

  const roleOptions = (m) => [
    { value: 'member', label: 'Member' }, { value: 'admin', label: 'Admin' },
    { value: 'owner', label: 'Owner', disabled: me.role !== 'owner' && m.role !== 'owner' },
  ];

  return (
    <div className="settings-section">
      <SectionHead title="Members" description="Invite teammates and manage what they can do."
        actions={isAdmin && <Button variant="primary" icon={UserPlus} onClick={() => setInviting(true)}>Invite member</Button>} />

      <div className="card card-pad">
        <div className="bold">{members.length} member{members.length === 1 ? '' : 's'}{invites.length ? ` · ${invites.length} pending invite${invites.length === 1 ? '' : 's'}` : ''}</div>
        <div className="small muted">Unlimited teammates — inviting people is always free.</div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Member</th><th>Role</th><th>Joined</th>{isAdmin && <th aria-label="Actions" />}</tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>
                  <div className="row" style={{ minWidth: 200 }}>
                    <Avatar name={m.name} color={m.avatar_color} size={32} />
                    <div style={{ minWidth: 0 }}>
                      <div className="bold truncate">{m.name}{m.id === me.user.id && <span className="subtle small" style={{ fontWeight: 400 }}> (you)</span>}</div>
                      <div className="small muted truncate">{m.email}</div>
                    </div>
                  </div>
                </td>
                <td>
                  {isAdmin && m.id !== me.user.id ? (
                    <Select className="input-sm" style={{ width: 120 }} value={m.role} onChange={(e) => changeRole(m, e.target.value)} options={roleOptions(m)} aria-label={`Role for ${m.name}`} />
                  ) : <Badge color={m.role === 'owner' ? 'brand' : m.role === 'admin' ? 'blue' : undefined}>{ROLE_LABEL[m.role]}</Badge>}
                </td>
                <td className="nowrap muted">{fmtDay(m.created_at)}</td>
                {isAdmin && (
                  <td className="right">
                    {m.id !== me.user.id && <Button size="sm" variant="danger-ghost" icon={Trash2} onClick={() => remove(m)} aria-label={`Remove ${m.name}`} title="Remove member" />}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-header"><h3>Pending invites</h3><Badge>{invites.length}</Badge></div>
        {invites.length === 0 ? (
          <EmptyState icon={Mail} title="No pending invites">{isAdmin ? 'Invite a teammate and share the link with them.' : 'Admins can invite new teammates.'}</EmptyState>
        ) : invites.map((inv) => (
          <div key={inv.id} className="list-item wrap">
            <Avatar name={inv.email} color="var(--text-3)" size={32} />
            <div className="grow" style={{ minWidth: 160 }}>
              <div className="bold truncate">{inv.email}</div>
              <div className="small muted">{ROLE_LABEL[inv.role]} · invited {timeAgo(inv.created_at)}</div>
            </div>
            {isAdmin && (
              <div className="row">
                <Button size="sm" icon={Link2} onClick={() => copyLink(inv)}>Copy link</Button>
                <Button size="sm" variant="danger-ghost" onClick={() => revoke(inv)}>Revoke</Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {inviting && <InviteModal onClose={() => setInviting(false)} onInvited={reload} />}
    </div>
  );
}

function InviteModal({ onClose, onInvited }) {
  const { me } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [link, setLink] = useState('');

  const submit = async (e) => {
    e?.preventDefault();
    setErr('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setErr('Enter a valid email address');
    setBusy(true);
    try {
      const r = await api.post('workspace/invites', { email: email.trim(), role });
      setLink(`${window.location.origin}${r.url}`);
      onInvited();
      toast.success(`Invite created for ${email.trim()}`);
    } catch (error) {
      setErr(error.message);
    } finally { setBusy(false); }
  };

  if (link) {
    return (
      <Modal title="Invite created" size="sm" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
        <p className="muted mb-16">Share this link with <b>{email}</b>. It works once and joins them to {me.workspace.name} as {role === 'admin' ? 'an admin' : 'a member'}.</p>
        <div className="input-group">
          <input className="input mono" readOnly value={link} onFocus={(e) => e.target.select()} />
          <Button onClick={async () => { await copyText(link); toast.success('Link copied'); }}>Copy</Button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title="Invite a teammate" size="sm" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Send invite</Button></>}>
      <form onSubmit={submit} noValidate>
        <Field label="Email" required error={err}>
          <Input type="email" autoFocus value={email} invalid={err} placeholder="teammate@company.com" onChange={(e) => { setEmail(e.target.value); setErr(''); }} />
        </Field>
        <Field label="Role" help={role === 'admin' ? 'Admins can manage members, API keys and workspace settings.' : 'Members can build and run flows, tables, interfaces and chatbots.'}>
          <Select value={role} onChange={(e) => setRole(e.target.value)} options={[{ value: 'member', label: 'Member' }, { value: 'admin', label: 'Admin' }]} />
        </Field>
      </form>
    </Modal>
  );
}
