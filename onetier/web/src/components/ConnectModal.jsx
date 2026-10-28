import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import api from '../lib/api.js';
import { useApps, useToast } from '../lib/context.jsx';
import { Modal, Button, Field, Input, AppIcon, Callout } from './ui.jsx';

/**
 * Connect a new account for an app (or reconnect an existing connection).
 * Props: appKey, connection? (existing, for reconnect), onClose(), onConnected(connection)
 */
export default function ConnectModal({ appKey, connection, onClose, onConnected }) {
  const { getApp } = useApps();
  const toast = useToast();
  const app = getApp(appKey);
  const [values, setValues] = useState({});
  const [name, setName] = useState(connection?.name || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!app?.auth) return null;

  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true); setError('');
    try {
      const conn = connection
        ? await api.patch(`connections/${connection.id}`, { name: name || undefined, credentials: values })
        : await api.post('connections', { app: appKey, name: name || undefined, credentials: values });
      toast.success(connection ? 'Connection updated' : `${app.name} connected`);
      onConnected?.(conn);
      onClose();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal title={<span className="row gap-12"><AppIcon app={app} size={30} />{connection ? `Reconnect ${app.name}` : `Connect ${app.name}`}</span>} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>{connection ? 'Save & test' : 'Connect & test'}</Button></>}>
      <form onSubmit={submit}>
        <p className="muted small mb-16">{app.description}</p>
        {app.auth.fields.map((f) => (
          <Field key={f.key} label={f.label} required={f.required && !connection} help={connection && f.type === 'password' ? 'Leave blank to keep the current value.' : f.help}>
            <Input type={f.type === 'password' ? 'password' : 'text'} autoComplete="off" value={values[f.key] ?? ''} placeholder={f.placeholder || (connection ? connection.fields?.[f.key] : '')}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
          </Field>
        ))}
        <Field label="Connection name" help="Optional — helps you tell accounts apart.">
          <Input value={name} placeholder={`${app.name} account`} onChange={(e) => setName(e.target.value)} />
        </Field>
        {error && <Callout type="danger">{error}</Callout>}
        <div className="row small muted mt-16"><ShieldCheck size={16} /> Credentials are encrypted at rest and never shown to AI models.</div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
