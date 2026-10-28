import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import api from '../../lib/api.js';
import { useAuth } from '../../lib/context.jsx';
import { Button, Field, Input, Callout } from '../../components/ui.jsx';
import AuthShell, { PasswordInput, safeNext } from './AuthShell.jsx';

export default function Login() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [email, setEmail] = useState(params.get('email') || '');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const next = safeNext(params.get('next'));

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errs.email = 'Enter a valid email address';
    if (!password) errs.password = 'Enter your password';
    setErrors(errs);
    setFormError('');
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await api.post('auth/login', { email: email.trim(), password });
      await refresh();
      navigate(next, { replace: true });
    } catch (err) {
      setFormError(err.message || 'Could not sign in');
      setBusy(false);
    }
  };

  const signupHref = `/signup${params.toString() ? `?${params.toString()}` : ''}`;

  return (
    <AuthShell>
      <h1>Welcome back</h1>
      <p className="auth-lede">Sign in to your OneTier workspace.</p>
      {formError && <div className="auth-error"><Callout type="danger" icon={AlertCircle}>{formError}</Callout></div>}
      <form onSubmit={submit} noValidate>
        <Field label="Email" error={errors.email}>
          <Input type="email" autoComplete="email" autoFocus={!email} value={email} invalid={errors.email}
            onChange={(e) => { setEmail(e.target.value); setErrors((x) => ({ ...x, email: undefined })); }} placeholder="you@company.com" />
        </Field>
        <Field label="Password" error={errors.password}>
          <PasswordInput value={password} invalid={errors.password} placeholder="Your password"
            onChange={(v) => { setPassword(v); setErrors((x) => ({ ...x, password: undefined })); }} />
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={busy}>Sign in</Button>
      </form>
      <p className="auth-foot">New to OneTier? <Link to={signupHref}>Create an account</Link></p>
    </AuthShell>
  );
}
