import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, UserPlus } from 'lucide-react';
import api from '../../lib/api.js';
import { useAuth } from '../../lib/context.jsx';
import { Button, Field, Input, Callout } from '../../components/ui.jsx';
import AuthShell, { PasswordInput, StrengthMeter } from './AuthShell.jsx';

export default function Signup() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const inviteToken = params.get('invite') || '';
  const [invite, setInvite] = useState(null);
  const [inviteFailed, setInviteFailed] = useState(false);
  const [form, setForm] = useState({ name: '', email: params.get('email') || '', password: '', workspaceName: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!inviteToken) return;
    api.get(`invites/${encodeURIComponent(inviteToken)}`)
      .then((inv) => { setInvite(inv); setForm((f) => ({ ...f, email: f.email || inv.email })); })
      .catch((e) => { setInviteFailed(true); setFormError(`${e.message} You can still create your own workspace.`); });
  }, [inviteToken]);

  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); setErrors((x) => ({ ...x, [k]: undefined })); };

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.name.trim()) errs.name = 'Enter your name';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errs.email = 'Enter a valid email address';
    if (form.password.length < 8) errs.password = 'Password must be at least 8 characters';
    setErrors(errs);
    setFormError('');
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await api.post('auth/signup', {
        name: form.name.trim(), email: form.email.trim(), password: form.password,
        ...(inviteToken && invite ? { inviteToken } : { workspaceName: form.workspaceName.trim() || undefined }),
      });
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setFormError(err.message || 'Could not create the account');
      setBusy(false);
    }
  };

  const joining = Boolean(inviteToken && invite);
  const loginHref = `/login?${new URLSearchParams({ ...(form.email ? { email: form.email } : {}), ...(inviteToken ? { next: `/invite/${inviteToken}` } : {}) })}`;

  return (
    <AuthShell>
      <h1>{joining ? `Join ${invite.workspace}` : 'Create your account'}</h1>
      <p className="auth-lede">{joining ? `You've been invited as ${invite.role === 'admin' ? 'an admin' : 'a member'}. Create an account to accept.` : 'OneTier is free forever — unlimited flows, tasks, apps and teammates. No credit card, no plans.'}</p>
      {joining && <div className="auth-error"><Callout type="info" icon={UserPlus}>Invitation for <b>{invite.email}</b></Callout></div>}
      {formError && <div className="auth-error"><Callout type="danger" icon={AlertCircle}>{formError}</Callout></div>}
      <form onSubmit={submit} noValidate>
        <Field label="Full name" error={errors.name}>
          <Input autoComplete="name" autoFocus value={form.name} invalid={errors.name} placeholder="Alex Morgan" onChange={(e) => set('name')(e.target.value)} />
        </Field>
        <Field label="Work email" error={errors.email}>
          <Input type="email" autoComplete="email" value={form.email} invalid={errors.email} placeholder="you@company.com" onChange={(e) => set('email')(e.target.value)} />
        </Field>
        <Field label="Password" error={errors.password}>
          <PasswordInput value={form.password} invalid={errors.password} autoComplete="new-password" placeholder="At least 8 characters" onChange={set('password')} />
          {!errors.password && <StrengthMeter password={form.password} />}
        </Field>
        {(!inviteToken || inviteFailed) && (
          <Field label="Workspace name" help="Optional — you can rename it later.">
            <Input value={form.workspaceName} placeholder={form.name.trim() ? `${form.name.trim().split(' ')[0]}'s workspace` : 'Acme Inc.'} onChange={(e) => set('workspaceName')(e.target.value)} />
          </Field>
        )}
        <Button type="submit" variant="primary" size="lg" block loading={busy}>{joining ? 'Create account & join' : 'Create account'}</Button>
        <p className="tiny subtle mt-8" style={{ textAlign: 'center' }}>By signing up you agree to the OneTier Terms and Privacy Policy.</p>
      </form>
      <p className="auth-foot">Already have an account? <Link to={loginHref}>Sign in</Link></p>
    </AuthShell>
  );
}
