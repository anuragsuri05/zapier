import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Lock, EyeOff, AlertCircle } from 'lucide-react';
import { Loading, Button, Input, Logo } from '../../components/ui.jsx';
import { Block, InterfacePage, publicClient } from './BlockRenderer.jsx';
import './interfaces.css';

const pwKey = (slug) => `onetier-iface-pw:${slug}`;
const readPw = (slug) => { try { return sessionStorage.getItem(pwKey(slug)) || ''; } catch { return ''; } };
const writePw = (slug, v) => { try { if (v) sessionStorage.setItem(pwKey(slug), v); else sessionStorage.removeItem(pwKey(slug)); } catch { /* storage unavailable */ } };

function StateCard({ icon: Icon, title, children }) {
  return (
    <div className="pi-state">
      <div className="pi-state-card">
        <span className="icon"><Icon /></span>
        <h2>{title}</h2>
        {children}
        <div className="pi-footer" style={{ marginTop: 24 }}><a href="/" target="_blank" rel="noreferrer"><Logo size={16} withText={false} />Made with OneTier</a></div>
      </div>
    </div>
  );
}

export default function PublicInterface() {
  const { slug } = useParams();
  const [password, setPassword] = useState(() => readPw(slug));
  const [page, setPage] = useState(null);
  const [error, setError] = useState(null);
  const [needsPw, setNeedsPw] = useState(false);
  const [pwInput, setPwInput] = useState('');
  const [pwError, setPwError] = useState('');
  const [checking, setChecking] = useState(false);
  const client = useMemo(() => publicClient(slug, password), [slug, password]);

  const load = useCallback(async (pw = password) => {
    setError(null);
    try {
      const p = await publicClient(slug, pw).get();
      setPage(p); setNeedsPw(false); document.title = p.name;
      return true;
    } catch (e) {
      if (e.status === 401 && e.data?.passwordRequired) { setNeedsPw(true); return false; }
      setError(e);
      return false;
    }
  }, [slug, password]);
  useEffect(() => { load(); }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const unlock = async (e) => {
    e.preventDefault();
    if (!pwInput) { setPwError('Enter the password.'); return; }
    setChecking(true); setPwError('');
    const ok = await load(pwInput);
    setChecking(false);
    if (ok) { setPassword(pwInput); writePw(slug, pwInput); }
    else { setPwError('That password is incorrect.'); writePw(slug, ''); }
  };

  if (needsPw) {
    return (
      <StateCard icon={Lock} title="This page is password protected">
        <p className="muted mt-8">Enter the password you were given to continue.</p>
        <form onSubmit={unlock} className="col mt-16" style={{ textAlign: 'left' }}>
          <Input type="password" autoFocus value={pwInput} invalid={Boolean(pwError)} placeholder="Password" aria-label="Password" onChange={(e) => { setPwInput(e.target.value); setPwError(''); }} />
          {pwError && <div className="error-text">{pwError}</div>}
          <Button type="submit" variant="primary" block loading={checking}>Unlock</Button>
        </form>
      </StateCard>
    );
  }
  if (error) {
    return error.status === 404 ? (
      <StateCard icon={EyeOff} title="This page isn't available">
        <p className="muted mt-8">It may not be published yet, or the link may be wrong. If you own this page, publish it from the Interfaces builder.</p>
      </StateCard>
    ) : (
      <StateCard icon={AlertCircle} title="Something went wrong">
        <p className="muted mt-8">{error.message}</p>
        <div className="mt-16"><Button onClick={() => load()}>Try again</Button></div>
      </StateCard>
    );
  }
  if (!page) return <div className="pi-state"><Loading /></div>;

  return (
    <InterfacePage theme={page.theme}
      footer={<div className="pi-footer"><a href="/" target="_blank" rel="noreferrer"><Logo size={16} withText={false} />Made with OneTier</a></div>}>
      {!page.blocks.length && <p className="muted center">This page has no content yet.</p>}
      {page.blocks.map((b) => <Block key={b.id} block={b} mode="public" client={client} />)}
    </InterfacePage>
  );
}
