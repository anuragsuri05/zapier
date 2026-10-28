import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Link2 as LinkIcon, AlertTriangle } from 'lucide-react';
import api from '../../lib/api.js';
import { useAuth, useToast } from '../../lib/context.jsx';
import { Button, Loading, Avatar, Badge } from '../../components/ui.jsx';
import AuthShell from './AuthShell.jsx';

export default function Invite() {
  const { token } = useParams();
  const { me, loading: authLoading, logout } = useAuth();
  const toast = useToast();
  const [state, setState] = useState({ loading: true, invite: null, error: null });
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    api.get(`invites/${encodeURIComponent(token)}`)
      .then((invite) => setState({ loading: false, invite, error: null }))
      .catch((error) => setState({ loading: false, invite: null, error }));
  }, [token]);

  const join = async () => {
    setJoining(true);
    try {
      await api.post(`invites/${encodeURIComponent(token)}/accept`);
      window.location = '/';
    } catch (e) { toast.error(e.message); setJoining(false); }
  };

  const { invite, error } = state;
  let body;
  if (state.loading || authLoading) body = <Loading label="Checking your invite…" />;
  else if (error) {
    body = (
      <div className="invite-card">
        <div className="invite-ws" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}><AlertTriangle size={28} /></div>
        <h1>Invite not available</h1>
        <p className="auth-lede">{error.status === 404 ? error.message : `We couldn't load this invite: ${error.message}`} Ask a workspace admin to send a new link.</p>
        <Link className="btn btn-primary btn-lg btn-block" to={me ? '/' : '/login'}>{me ? 'Go to dashboard' : 'Sign in'}</Link>
        {!me && <p className="auth-foot">New here? <Link to="/signup">Create an account</Link></p>}
      </div>
    );
  } else {
    const signupHref = `/signup?${new URLSearchParams({ invite: token, email: invite.email })}`;
    const loginHref = `/login?${new URLSearchParams({ next: `/invite/${token}`, email: invite.email })}`;
    body = (
      <div className="invite-card">
        <div className="invite-ws">{(invite.workspace || '?')[0].toUpperCase()}</div>
        <p className="muted small" style={{ display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center' }}><LinkIcon size={14} />You've been invited to join</p>
        <h1 style={{ marginTop: 4 }}>{invite.workspace}</h1>
        <p className="auth-lede">as <Badge color="brand">{invite.role === 'admin' ? 'Admin' : 'Member'}</Badge> · invitation sent to <b>{invite.email}</b></p>
        {me ? (
          <>
            <div className="panel row" style={{ textAlign: 'left', marginBottom: 16 }}>
              <Avatar name={me.user.name} color={me.user.avatar_color} size={34} />
              <div className="grow"><div className="bold truncate">{me.user.name}</div><div className="small muted truncate">{me.user.email}</div></div>
            </div>
            {me.user.email !== invite.email && <p className="small muted mb-16">This invite was sent to {invite.email}, but you're signed in as {me.user.email}. You can still accept it with this account.</p>}
            <Button variant="primary" size="lg" block loading={joining} onClick={join}>Join {invite.workspace}</Button>
            <p className="auth-foot">Not you? <button type="button" className="btn btn-ghost btn-xs" onClick={logout}>Sign out</button></p>
          </>
        ) : (
          <div className="col" style={{ gap: 10 }}>
            <Link className="btn btn-primary btn-lg btn-block" to={signupHref}>Create an account</Link>
            <Link className="btn btn-secondary btn-lg btn-block" to={loginHref}>I already have an account</Link>
          </div>
        )}
      </div>
    );
  }
  return <AuthShell>{body}</AuthShell>;
}
