import { useState } from 'react';
import { Workflow, Sparkles, Table2, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { Logo, Avatar } from '../../components/ui.jsx';
import './auth.css';

const BULLETS = [
  { icon: Workflow, title: 'Multi-step flows', body: 'Connect thousands of actions with paths, filters, loops and webhooks.' },
  { icon: Sparkles, title: 'AI built in', body: 'Copilot drafts flows for you, and AI steps summarise, classify and reply.' },
  { icon: Table2, title: 'Tables, Interfaces & Chatbots', body: 'Store data, collect it with forms and answer customers 24/7.' },
  { icon: ShieldCheck, title: 'Secure by default', body: 'Encrypted credentials, SSO and a full audit log for your team.' },
];

/** Split layout used by Login, Signup and Invite. */
export default function AuthShell({ children }) {
  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <Logo size={32} />
        <div>
          <h2 className="auth-headline">Automate everything. One tier at a time.</h2>
          <p className="auth-sub">OneTier connects your apps and runs the busywork in the background, so your team can focus on the work that matters.</p>
          <ul className="auth-bullets">
            {BULLETS.map((b) => (
              <li key={b.title}><span className="auth-bullet-icon"><b.icon /></span><span><b>{b.title}</b>{b.body}</span></li>
            ))}
          </ul>
        </div>
        <figure className="auth-quote" style={{ margin: 0 }}>
          <p>“We replaced a dozen brittle scripts with OneTier flows in a weekend. Our ops team now saves about 20 hours every week.”</p>
          <figcaption className="auth-quote-by">
            <Avatar name="Priya Raman" color="#FF8A3D" size={32} />
            <span><b>Priya Raman</b>Head of Operations, Northwind</span>
          </figcaption>
        </figure>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-mobile-logo"><Logo /></div>
          {children}
        </div>
      </main>
    </div>
  );
}

export function PasswordInput({ value, onChange, autoComplete = 'current-password', invalid, id, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-wrap">
      <input id={id} className={`input ${invalid ? 'invalid' : ''}`} type={show ? 'text' : 'password'} value={value} placeholder={placeholder}
        autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="pw-toggle" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide password' : 'Show password'}>
        {show ? <EyeOff /> : <Eye />}
      </button>
    </div>
  );
}

/** Returns {score 0-4, label, color}. */
export function passwordStrength(pw = '') {
  if (!pw) return { score: 0, label: 'Use at least 8 characters', color: 'var(--text-3)' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  else if (/\d|[^A-Za-z0-9]/.test(pw)) score += 0.5;
  score = Math.min(4, Math.floor(score));
  if (pw.length < 8) return { score: Math.min(score, 1), label: `Too short — ${8 - pw.length} more character${8 - pw.length === 1 ? '' : 's'}`, color: 'var(--danger)' };
  return [
    { label: 'Weak', color: 'var(--danger)' }, { label: 'Weak', color: 'var(--danger)' }, { label: 'Fair', color: 'var(--warning)' },
    { label: 'Good', color: 'var(--info)' }, { label: 'Strong', color: 'var(--success)' },
  ].map((x, i) => ({ ...x, score: Math.max(1, i) }))[score];
}

export function StrengthMeter({ password }) {
  const s = passwordStrength(password);
  return (
    <div>
      <div className="pw-meter" aria-hidden="true">{[1, 2, 3, 4].map((i) => <span key={i} style={{ background: password && s.score >= i ? s.color : undefined }} />)}</div>
      <div className="help" style={{ color: password ? s.color : undefined, marginTop: 4 }}>{password ? `Password strength: ${s.label}` : s.label}</div>
    </div>
  );
}

/** Only allow same-origin relative redirects. */
export const safeNext = (n) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/');
