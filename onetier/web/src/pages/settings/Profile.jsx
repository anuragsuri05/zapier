import { useEffect, useState } from 'react';
import { Check, Sun, Moon, Monitor, LogOut } from 'lucide-react';
import api from '../../lib/api.js';
import { useAuth, useToast, useDialog } from '../../lib/context.jsx';
import { getTheme, setTheme, fmtDay } from '../../lib/util.js';
import { Button, Field, Input, Avatar } from '../../components/ui.jsx';
import { SectionHead, SettingsRow } from './shared.jsx';
import { PasswordInput, StrengthMeter } from '../auth/AuthShell.jsx';

const COLORS = ['#5B3DF5', '#7048E8', '#1971C2', '#0C8599', '#0CA678', '#2F9E44', '#F08C00', '#E8590C', '#E03131', '#C2255C', '#495057'];
const THEMES = [{ value: 'light', label: 'Light', icon: Sun }, { value: 'dark', label: 'Dark', icon: Moon }, { value: 'system', label: 'System', icon: Monitor }];

export default function Profile() {
  const { me, refresh } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const [name, setName] = useState(me.user.name);
  const [color, setColor] = useState(me.user.avatar_color || COLORS[0]);
  const [theme, setThemeState] = useState(getTheme());
  const [saving, setSaving] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwErr, setPwErr] = useState({});
  const [pwBusy, setPwBusy] = useState(false);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => { setName(me.user.name); setColor(me.user.avatar_color || COLORS[0]); }, [me.user.name, me.user.avatar_color]);

  const dirty = name.trim() !== me.user.name || color !== me.user.avatar_color;
  const saveProfile = async (e) => {
    e.preventDefault();
    if (!name.trim()) return toast.error('Name cannot be empty');
    setSaving(true);
    try { await api.patch('auth/profile', { name: name.trim(), avatar_color: color }); await refresh(); toast.success('Profile saved'); }
    catch (err) { toast.error(err.message); } finally { setSaving(false); }
  };

  const chooseTheme = async (t) => {
    setThemeState(t);
    setTheme(t);
    try { await api.patch('auth/profile', { prefs: { theme: t } }); refresh(); } catch (err) { toast.error(err.message); }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!pw.current) errs.current = 'Enter your current password';
    if (pw.next.length < 8) errs.next = 'Use at least 8 characters';
    if (pw.next !== pw.confirm) errs.confirm = 'Passwords do not match';
    setPwErr(errs);
    if (Object.keys(errs).length) return;
    setPwBusy(true);
    try {
      await api.post('auth/password', { current: pw.current, next: pw.next });
      setPw({ current: '', next: '', confirm: '' });
      toast.success('Password updated. Other sessions were signed out.');
    } catch (err) {
      if (/current/i.test(err.message)) setPwErr({ current: err.message }); else toast.error(err.message);
    } finally { setPwBusy(false); }
  };

  const revokeOthers = async () => {
    if (!await dialog.confirm({ title: 'Sign out other sessions?', message: 'Every other browser and device signed in to your account will be signed out. This session stays signed in.', confirmText: 'Sign out others' })) return;
    setRevoking(true);
    try { const r = await api.post('auth/sessions/revoke-others'); toast.success(r.revoked ? `Signed out ${r.revoked} other session${r.revoked === 1 ? '' : 's'}` : 'No other active sessions'); }
    catch (err) { toast.error(err.message); } finally { setRevoking(false); }
  };

  return (
    <div className="settings-section">
      <SectionHead title="Profile" description={`Signed in as ${me.user.email} · member since ${fmtDay(me.user.created_at)}`} />

      <form className="card" onSubmit={saveProfile}>
        <div className="card-header"><h3>Personal details</h3></div>
        <SettingsRow label="Name" description="Shown to teammates, in run history and in the audit log.">
          <Field><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" /></Field>
        </SettingsRow>
        <SettingsRow label="Email" description="Your sign-in email can't be changed here.">
          <Input value={me.user.email} readOnly disabled />
        </SettingsRow>
        <SettingsRow label="Avatar colour">
          <div className="row" style={{ gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <Avatar name={name || me.user.name} color={color} size={44} />
            <div className="swatches" role="radiogroup" aria-label="Avatar colour">
              {COLORS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={c} className={`swatch ${c === color ? 'active' : ''}`} style={{ background: c }} onClick={() => setColor(c)}>
                  {c === color && <Check />}
                </button>
              ))}
            </div>
          </div>
        </SettingsRow>
        <div className="card-footer">
          <Button variant="ghost" disabled={!dirty || saving} onClick={() => { setName(me.user.name); setColor(me.user.avatar_color); }}>Reset</Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!dirty}>Save changes</Button>
        </div>
      </form>

      <div className="card">
        <div className="card-header"><h3>Appearance</h3></div>
        <SettingsRow label="Theme" description="System follows your device setting.">
          <div className="theme-choices" role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              <button key={t.value} type="button" role="radio" aria-checked={theme === t.value} className={`theme-choice ${theme === t.value ? 'active' : ''}`} onClick={() => chooseTheme(t.value)}>
                <t.icon />{t.label}
              </button>
            ))}
          </div>
        </SettingsRow>
      </div>

      <form className="card" onSubmit={changePassword} noValidate>
        <div className="card-header"><h3>Change password</h3></div>
        <SettingsRow label="Password" description="Changing your password signs out all other sessions.">
          <div style={{ maxWidth: 420 }}>
            <Field label="Current password" error={pwErr.current}>
              <PasswordInput value={pw.current} invalid={pwErr.current} onChange={(v) => setPw((p) => ({ ...p, current: v }))} />
            </Field>
            <Field label="New password" error={pwErr.next}>
              <PasswordInput value={pw.next} invalid={pwErr.next} autoComplete="new-password" onChange={(v) => setPw((p) => ({ ...p, next: v }))} />
              {!pwErr.next && <StrengthMeter password={pw.next} />}
            </Field>
            <Field label="Confirm new password" error={pwErr.confirm}>
              <PasswordInput value={pw.confirm} invalid={pwErr.confirm} autoComplete="new-password" onChange={(v) => setPw((p) => ({ ...p, confirm: v }))} />
            </Field>
          </div>
        </SettingsRow>
        <div className="card-footer"><Button type="submit" variant="primary" loading={pwBusy}>Update password</Button></div>
      </form>

      <div className="card">
        <div className="card-header"><h3>Sessions</h3></div>
        <SettingsRow label="Other sessions" description="Lost a device or used a shared computer? Sign out everywhere else.">
          <Button icon={LogOut} loading={revoking} onClick={revokeOthers}>Sign out other sessions</Button>
        </SettingsRow>
      </div>
    </div>
  );
}
