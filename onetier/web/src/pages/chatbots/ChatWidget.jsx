// Reusable chat UI used by the public chatbot page, the embed, interface chatbot blocks and the builder preview.
import { useEffect, useRef, useState } from 'react';
import { Send, RotateCcw, UserCheck, Zap, AlertCircle } from 'lucide-react';
import './chatbots.css';

const readStore = (key) => { if (!key) return null; try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
const writeStore = (key, v) => { if (!key) return; try { if (v == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ } };

/** Readable text colour (black/white) for a hex background. */
export function contrastText(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? '#16151f' : '#fff';
}

export function ActionMarkers({ actions }) {
  if (!actions?.length) return null;
  return (
    <div className="cw-actions">
      {actions.map((a, i) => (a.type === 'lead'
        ? <span key={i} className="cw-action lead"><UserCheck />Lead captured{a.email ? `: ${a.email}` : ''}</span>
        : <span key={i} className={`cw-action flow ${a.status === 'success' ? '' : 'bad'}`}><Zap />Ran “{a.name || 'flow'}”{a.status ? ` · ${a.status}` : ''}</span>))}
    </div>
  );
}

export function Avatar({ theme, size = 30 }) {
  const primary = theme?.primary || '#5B3DF5';
  return <span className="cw-avatar" style={{ width: size, height: size, fontSize: size * 0.52, background: `${primary}22` }} aria-hidden="true">{theme?.avatar || '💬'}</span>;
}

export default function ChatWidget({
  name = 'Assistant', greeting, suggested = [], theme = {}, send, storageKey, compact = false, header = true, subtitle, headerExtra, onReset, placeholder = 'Type a message…', disabledNote,
}) {
  const initial = () => (greeting ? [{ role: 'assistant', content: greeting }] : []);
  const stored = readStore(storageKey);
  const [messages, setMessages] = useState(() => (stored?.messages?.length ? stored.messages : initial()));
  const [conversationId, setConversationId] = useState(() => stored?.conversationId || null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const primary = theme.primary || '#5B3DF5';
  const onPrimary = contrastText(primary);

  // refresh the greeting if it changes before the conversation starts (builder preview)
  useEffect(() => { setMessages((m) => (m.every((x) => x.role === 'assistant') && m.length <= 1 ? initial() : m)); }, [greeting]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (conversationId || messages.some((m) => m.role === 'user')) writeStore(storageKey, { conversationId, messages: messages.slice(-60) }); }, [messages, conversationId, storageKey]);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages, busy]);

  const submit = async (msg) => {
    const m = String(msg ?? text).trim();
    if (!m || busy || disabledNote) return;
    setText('');
    setMessages((xs) => [...xs, { role: 'user', content: m }]);
    setBusy(true);
    try {
      const r = await send(m, conversationId);
      if (r.conversationId) setConversationId(r.conversationId);
      setMessages((xs) => [...xs, { role: 'assistant', content: r.reply, actions: r.actions?.length ? r.actions : undefined }]);
    } catch (e) {
      setMessages((xs) => [...xs, { role: 'error', content: e.message || 'Something went wrong. Please try again.' }]);
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };
  const reset = () => {
    writeStore(storageKey, null);
    setConversationId(null);
    setMessages(initial());
    setText('');
    onReset?.();
  };
  const started = messages.some((m) => m.role === 'user');

  return (
    <div className={`cw ${compact ? 'cw-compact' : ''}`} style={{ '--cw-primary': primary, '--cw-on-primary': onPrimary }}>
      {header && (
        <div className="cw-header">
          <Avatar theme={theme} size={compact ? 30 : 36} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="cw-title truncate">{name}</div>
            <div className="cw-sub truncate">{subtitle || (busy ? 'Typing…' : 'Online · usually replies instantly')}</div>
          </div>
          {headerExtra}
          {started && <button type="button" className="cw-icon-btn" onClick={reset} title="Start a new conversation" aria-label="Start a new conversation"><RotateCcw /></button>}
        </div>
      )}
      <div className="cw-messages" ref={listRef} aria-live="polite">
        {messages.map((m, i) => (
          m.role === 'error' ? (
            <div key={i} className="cw-error"><AlertCircle />{m.content}</div>
          ) : (
            <div key={i} className={`cw-row ${m.role === 'user' ? 'me' : ''}`}>
              {m.role !== 'user' && <Avatar theme={theme} size={26} />}
              <div className="cw-bubble-wrap">
                <div className="cw-bubble">{m.content}</div>
                <ActionMarkers actions={m.actions} />
              </div>
            </div>
          )
        ))}
        {busy && <div className="cw-row"><Avatar theme={theme} size={26} /><div className="cw-bubble cw-typing" aria-label="Typing"><span /><span /><span /></div></div>}
        {!started && suggested.filter(Boolean).length > 0 && (
          <div className="cw-suggested">
            {suggested.filter(Boolean).map((s) => <button key={s} type="button" onClick={() => submit(s)} disabled={busy || Boolean(disabledNote)}>{s}</button>)}
          </div>
        )}
      </div>
      {disabledNote && <div className="cw-note">{disabledNote}</div>}
      <form className="cw-input" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <textarea ref={inputRef} rows={1} value={text} placeholder={placeholder} aria-label="Message" maxLength={4000} disabled={Boolean(disabledNote)}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
        <button type="submit" className="cw-send" disabled={!text.trim() || busy || Boolean(disabledNote)} aria-label="Send"><Send /></button>
      </form>
    </div>
  );
}
