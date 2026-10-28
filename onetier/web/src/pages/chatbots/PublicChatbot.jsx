import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../lib/api.js';
import { Loading, Button } from '../../components/ui.jsx';
import ChatWidget from './ChatWidget.jsx';
import './chatbots.css';

export const publicChatSender = (slug) => (message, conversationId) =>
  api.post(`/api/public/chatbots/${encodeURIComponent(slug)}/message`, { conversationId: conversationId || undefined, message });

export default function PublicChatbot({ embed = false }) {
  const { slug } = useParams();
  const [bot, setBot] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(null);
    api.get(`/api/public/chatbots/${encodeURIComponent(slug)}`)
      .then((b) => { if (alive) { setBot(b); document.title = b.name; } })
      .catch((e) => { if (alive) setError(e); });
    return () => { alive = false; };
  }, [slug, attempt]);

  useEffect(() => {
    if (!embed) return undefined;
    const prev = document.body.style.background;
    document.body.style.background = 'transparent';
    return () => { document.body.style.background = prev; };
  }, [embed]);

  const wrap = (children) => (embed ? <div className="pc-embed" style={{ alignItems: 'center', justifyContent: 'center' }}>{children}</div> : <div className="pc-page"><div className="pc-card" style={{ alignItems: 'center', justifyContent: 'center' }}>{children}</div></div>);

  if (error) {
    const missing = error.status === 404;
    return wrap(
      <div className="pc-state">
        <div className="emoji">{missing ? '💤' : '⚠️'}</div>
        <h2>{missing ? 'This chatbot is unavailable' : 'Something went wrong'}</h2>
        <p className="muted mt-8">{missing ? 'It may have been unpublished or the link is incorrect.' : error.message}</p>
        {!missing && <div className="mt-16"><Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button></div>}
      </div>,
    );
  }
  if (!bot) return wrap(<Loading label="Loading chat…" />);

  const widget = (
    <ChatWidget name={bot.name} greeting={bot.greeting} suggested={bot.suggested} theme={bot.theme} compact={embed}
      send={publicChatSender(slug)} storageKey={`onetier-chat:${slug}`} />
  );
  if (embed) return <div className="pc-embed">{widget}</div>;
  return (
    <div className="pc-page" style={{ '--pc-tint': `${bot.theme?.primary || '#5B3DF5'}33` }}>
      <div className="pc-card">
        {widget}
        <div className="pc-foot">Powered by <a href="/" target="_blank" rel="noreferrer">OneTier</a></div>
      </div>
    </div>
  );
}
