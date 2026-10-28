import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, LogOut, Lock, Info, AlertTriangle } from 'lucide-react';
import api from '../../lib/api.js';
import { useAuth, useToast, useDialog } from '../../lib/context.jsx';
import { Button, Field, Input, Textarea, Toggle, Badge, Callout, CopyField } from '../../components/ui.jsx';
import { SectionHead, SettingsRow } from './shared.jsx';

export default function Security() {
  const { me, isAdmin, refresh } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const saved = me.workspace.settings?.sso || {};
  const [sso, setSso] = useState({ entityId: saved.entityId || '', ssoUrl: saved.ssoUrl || '', certificate: saved.certificate || '', required: Boolean(saved.required), enabled: saved.enabled !== false && Boolean(saved.ssoUrl) });
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState('');
  const origin = window.location.origin;
  const acsUrl = `${origin}/api/sso/${me.workspace.id}/acs`;
  const spEntity = `${origin}/sso/${me.workspace.id}`;
  const configured = Boolean(saved.ssoUrl);

  const set = (k) => (v) => { setSso((s) => ({ ...s, [k]: v })); setErrs((e) => ({ ...e, [k]: undefined })); };

  const save = async (e) => {
    e.preventDefault();
    const x = {};
    if (!sso.entityId.trim()) x.entityId = 'Enter the IdP entity ID';
    if (!/^https:\/\/\S+$/.test(sso.ssoUrl.trim())) x.ssoUrl = 'Enter the https:// SSO URL from your identity provider';
    const cert = sso.certificate.trim();
    if (!cert) x.certificate = 'Paste the X.509 signing certificate';
    else if (!/BEGIN CERTIFICATE/.test(cert) && !/^[A-Za-z0-9+/=\s]{100,}$/.test(cert)) x.certificate = 'This does not look like a PEM or base64 certificate';
    setErrs(x);
    if (Object.keys(x).length) return;
    if (sso.required && !saved.required && !await dialog.confirm({
      title: 'Require SSO for everyone?', confirmText: 'Require SSO',
      message: 'Members will have to sign in through your identity provider. Make sure SSO works for you before enforcing it.',
    })) return;
    setBusy('save');
    try {
      await api.patch('workspace', { settings: { sso: { entityId: sso.entityId.trim(), ssoUrl: sso.ssoUrl.trim(), certificate: cert, required: sso.required, enabled: true, updatedAt: new Date().toISOString() } } });
      await refresh();
      toast.success('SSO configuration saved');
    } catch (err) { toast.error(err.message); } finally { setBusy(''); }
  };
  const disable = async () => {
    if (!await dialog.confirm({ title: 'Remove SSO configuration?', message: 'Members will sign in with email and password again.', danger: true, confirmText: 'Remove' })) return;
    setBusy('disable');
    try {
      await api.patch('workspace', { settings: { sso: {} } });
      await refresh();
      setSso({ entityId: '', ssoUrl: '', certificate: '', required: false, enabled: false });
      toast.success('SSO configuration removed');
    } catch (err) { toast.error(err.message); } finally { setBusy(''); }
  };
  const revokeOthers = async () => {
    if (!await dialog.confirm({ title: 'Sign out other sessions?', message: 'All of your other browsers and devices will be signed out.', confirmText: 'Sign out others' })) return;
    setBusy('sessions');
    try { const r = await api.post('auth/sessions/revoke-others'); toast.success(r.revoked ? `Signed out ${r.revoked} other session${r.revoked === 1 ? '' : 's'}` : 'No other active sessions'); }
    catch (err) { toast.error(err.message); } finally { setBusy(''); }
  };

  return (
    <div className="settings-section">
      <SectionHead title="Security" description="Single sign-on, sessions and how OneTier protects your credentials." />

      {(
        <form className="card" onSubmit={save} noValidate>
          <div className="card-header">
            <h3>SAML single sign-on</h3>
            {configured ? <Badge color="green" dot>{saved.required ? 'Configured · required' : 'Configured'}</Badge> : <Badge>Not configured</Badge>}
          </div>
          {!isAdmin && <div className="card-body" style={{ paddingBottom: 0 }}><Callout type="info" icon={Info}>Only workspace admins can change SSO settings.</Callout></div>}
          <SettingsRow label="Service provider details" description="Enter these in your identity provider when creating the SAML app.">
            <Field label="ACS (reply) URL"><CopyField value={acsUrl} /></Field>
            <Field label="SP entity ID / audience"><CopyField value={spEntity} /></Field>
          </SettingsRow>
          <SettingsRow label="Identity provider" description="Copy these from your IdP's SAML metadata.">
            <Field label="IdP entity ID" required error={errs.entityId}>
              <Input value={sso.entityId} disabled={!isAdmin} invalid={errs.entityId} placeholder="http://www.okta.com/exk123abc" onChange={(e) => set('entityId')(e.target.value)} />
            </Field>
            <Field label="SSO URL" required error={errs.ssoUrl}>
              <Input value={sso.ssoUrl} disabled={!isAdmin} invalid={errs.ssoUrl} placeholder="https://acme.okta.com/app/acme_onetier/exk123abc/sso/saml" onChange={(e) => set('ssoUrl')(e.target.value)} />
            </Field>
            <Field label="X.509 signing certificate" required error={errs.certificate}>
              <Textarea className="code-input" style={{ minHeight: 140, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }} value={sso.certificate} disabled={!isAdmin} invalid={errs.certificate}
                placeholder={'-----BEGIN CERTIFICATE-----\nMIIDpDCCAoygAwIBAgIGAY…\n-----END CERTIFICATE-----'} onChange={(e) => set('certificate')(e.target.value)} />
            </Field>
          </SettingsRow>
          <SettingsRow label="Enforcement" description="When required, password sign-in is disabled for members of this workspace.">
            <Toggle checked={sso.required} disabled={!isAdmin} onChange={set('required')} label="Require SSO for all members" />
            {sso.required && <div className="mt-8"><Callout type="warning" icon={AlertTriangle}>Test SSO with your own account before enforcing it. Keep at least one owner able to reach your identity provider.</Callout></div>}
          </SettingsRow>
          {isAdmin && (
            <div className="card-footer">
              {configured && <Button variant="danger-ghost" loading={busy === 'disable'} onClick={disable}>Remove SSO</Button>}
              <Button type="submit" variant="primary" icon={ShieldCheck} loading={busy === 'save'}>Save SSO settings</Button>
            </div>
          )}
        </form>
      )}

      <div className="card">
        <div className="card-header"><h3>Sessions</h3></div>
        <SettingsRow label="Your sessions" description="Sessions last 30 days. Changing your password also signs out other sessions.">
          <Button icon={LogOut} loading={busy === 'sessions'} onClick={revokeOthers}>Sign out other sessions</Button>
        </SettingsRow>
      </div>

      <div className="card">
        <div className="card-header"><h3>Credential encryption</h3><Lock size={16} className="muted" /></div>
        <div className="card-body">
          <p className="muted">App connection credentials (OAuth tokens, API keys, passwords), your AI API keys and other secrets are encrypted at rest with AES-256-GCM before they're written to the database. They're decrypted only in memory while a step runs and are never returned to the browser.</p>
          <ul className="small muted" style={{ margin: '12px 0 0', paddingLeft: 18, lineHeight: 1.8 }}>
            <li>Passwords are hashed with scrypt and a per-user salt.</li>
            <li>API keys are stored as SHA-256 hashes — only the prefix is shown after creation.</li>
            <li>Every sensitive change is written to the <Link to="/settings/audit">audit log</Link>.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
