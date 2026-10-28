import { useEffect, useState } from 'react';
import { Plus, Server, RotateCw, Trash2, Wrench, Workflow, Pencil, Save, Cpu, Info, Undo2, MoreHorizontal, Sparkles } from 'lucide-react';
import api from '../lib/api.js';
import { useApps, useDialog, useFetch, useToast } from '../lib/context.jsx';
import { Button, PageHeader, EmptyState, Loading, ErrorState, Modal, Field, Input, CopyField, CopyButton, Tabs, Badge, AppIcon, Menu, Callout } from '../components/ui.jsx';
import { timeAgo, plural } from '../lib/util.js';
import { ActionToolModal, FlowToolModal, toolName } from './mcp/ToolModals.jsx';
import TestConsole from './mcp/TestConsole.jsx';
import './mcp/mcp.css';

export default function Mcp() {
  const toast = useToast();
  const { data, error, loading, reload, setData } = useFetch('mcp-servers');
  const [selected, setSelected] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (data?.length && !data.some((s) => s.id === selected)) setSelected(data[0].id);
    if (data && !data.length) setSelected(null);
  }, [data, selected]);

  const server = data?.find((s) => s.id === selected);
  const replace = (srv) => setData((d) => d.map((x) => (x.id === srv.id ? srv : x)));

  return (
    <div className="page">
      <PageHeader title="MCP" description="Give AI assistants real abilities through your OneTier apps and flows."
        actions={<Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>New MCP server</Button>} />
      <div className="card mb-16" style={{ overflow: 'hidden' }}>
        <div className="mcp-hero">
          <div className="empty-icon" style={{ margin: 0 }}><Cpu /></div>
          <div className="grow" style={{ minWidth: 260 }}>
            <h3>Let Claude, ChatGPT, Cursor and other AI clients take real actions through OneTier</h3>
            <p className="small muted mt-8">An MCP server exposes the actions and flows you choose as tools over the Model Context Protocol. Paste its URL into any MCP client —
              the AI can then send Slack messages, create GitHub issues, add table records and more, using your connected accounts. <b>Free and unlimited.</b></p>
          </div>
          <div className="mcp-clients">{['Claude', 'ChatGPT', 'Cursor', 'Claude Code'].map((c) => <Badge key={c} className="badge-outline">{c}</Badge>)}</div>
        </div>
      </div>

      {loading && !data ? <Loading /> : error ? <ErrorState error={error} onRetry={reload} /> : !data.length ? (
        <div className="card"><EmptyState icon={Server} title="No MCP servers yet" action={<Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>Create your first server</Button>}>
          Create a server, pick the tools it exposes, then connect your AI client with the server URL.
        </EmptyState></div>
      ) : (
        <div className="mcp-layout">
          <div className="card" style={{ overflow: 'hidden' }}>
            {data.map((s) => (
              <button key={s.id} type="button" className={`mcp-srv ${s.id === selected ? 'active' : ''}`} onClick={() => setSelected(s.id)}>
                <Server size={18} className="subtle" />
                <div className="grow"><div className="bold truncate">{s.name}</div><div className="tiny subtle">{plural(s.tools.length, 'tool')} · {s.last_used_at ? `used ${timeAgo(s.last_used_at)}` : 'never used'}</div></div>
              </button>
            ))}
          </div>
          {server && <ServerDetail key={server.id} server={server} onChange={replace} onDeleted={() => { setData((d) => d.filter((x) => x.id !== server.id)); toast.success('Server deleted'); }} />}
        </div>
      )}
      {createOpen && <CreateModal onClose={() => setCreateOpen(false)} onCreated={(s) => { setData((d) => [s, ...(d || [])]); setSelected(s.id); setCreateOpen(false); }} />}
    </div>
  );
}

function CreateModal({ onClose, onCreated }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e?.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try { const s = await api.post('mcp-servers', { name: name.trim() }); toast.success('MCP server created'); onCreated(s); }
    catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="New MCP server" size="sm" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={submit}>Create server</Button></>}>
      <form onSubmit={submit}>
        <Field label="Name" required help="E.g. the client or person who will use it."><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Claude Desktop – Sales" /></Field>
      </form>
    </Modal>
  );
}

function ServerDetail({ server, onChange, onDeleted }) {
  const toast = useToast();
  const dialog = useDialog();
  const { getApp } = useApps();
  const conns = useFetch('connections');
  const flows = useFetch('dynamic/flows');
  const [tools, setTools] = useState(server.tools);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState(null); // {kind:'action'|'flow', index?}
  const dirty = JSON.stringify(tools) !== JSON.stringify(server.tools);

  const save = async () => {
    setSaving(true);
    try { const s = await api.put(`mcp-servers/${server.id}`, { tools }); onChange(s); setTools(s.tools); toast.success('Tools saved'); }
    catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  const rename = async () => {
    const name = await dialog.prompt({ title: 'Rename server', label: 'Name', defaultValue: server.name });
    if (!name?.trim()) return;
    try { const s = await api.put(`mcp-servers/${server.id}`, { name: name.trim() }); onChange({ ...s, tools: server.tools }); toast.success('Server renamed'); } catch (e) { toast.error(e.message); }
  };
  const rotate = async () => {
    if (!(await dialog.confirm({ title: 'Rotate server URL?', message: 'The current URL stops working immediately. Every AI client using it must be updated with the new URL.', danger: true, confirmText: 'Rotate URL' }))) return;
    try { const s = await api.post(`mcp-servers/${server.id}/rotate`); onChange({ ...s, tools: server.tools }); toast.success('URL rotated — update your AI clients'); } catch (e) { toast.error(e.message); }
  };
  const remove = async () => {
    if (!(await dialog.confirm({ title: 'Delete MCP server?', message: `“${server.name}” and its URL will stop working for every connected AI client.`, danger: true, confirmText: 'Delete server' }))) return;
    try { await api.del(`mcp-servers/${server.id}`); onDeleted(); } catch (e) { toast.error(e.message); }
  };
  const upsert = (t) => {
    setTools((cur) => (modal?.index != null ? cur.map((x, i) => (i === modal.index ? t : x)) : [...cur, t]));
    setModal(null);
  };

  const connName = (id) => conns.data?.find((c) => c.id === id)?.name;
  const flowName = (id) => flows.data?.find((f) => f.value === id)?.label;

  return (
    <div className="col" style={{ gap: 16, minWidth: 0 }}>
      <div className="card">
        <div className="card-header">
          <div className="grow" style={{ minWidth: 0 }}><h2 className="truncate">{server.name}</h2><div className="tiny subtle">Created {timeAgo(server.created_at)} · {server.last_used_at ? `last used ${timeAgo(server.last_used_at)}` : 'not used yet'}</div></div>
          <Menu trigger={<Button size="sm" variant="ghost" icon={MoreHorizontal} aria-label="Server actions" />} items={[
            { label: 'Rename', icon: Pencil, onClick: rename },
            { label: 'Rotate URL', icon: RotateCw, onClick: rotate },
            { divider: true },
            { label: 'Delete server', icon: Trash2, danger: true, onClick: remove },
          ]} />
        </div>
        <div className="card-body">
          <Field label="Server URL" help="Treat this URL like a password — anyone with it can run these tools.">
            <CopyField value={server.url} secret />
          </Field>
          <div className="row wrap"><Button size="sm" icon={RotateCw} onClick={rotate}>Rotate URL</Button><Button size="sm" variant="danger-ghost" icon={Trash2} onClick={remove}>Delete</Button></div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div><h3>Tools</h3><div className="tiny subtle">What AI clients can do through this server</div></div>
          <div className="row wrap">
            {!tools.some((t) => t.type === 'builder') && <Button size="sm" icon={Sparkles} onClick={() => setTools((cur) => [{ type: 'builder' }, ...cur])}>Add agent builder</Button>}
            <Button size="sm" icon={Wrench} onClick={() => setModal({ kind: 'action' })}>Add action tool</Button>
            <Button size="sm" icon={Workflow} onClick={() => setModal({ kind: 'flow' })}>Add flow tool</Button>
          </div>
        </div>
        {!tools.length ? (
          <EmptyState icon={Wrench} title="No tools yet">Add app actions (like “Send Slack message”) or whole flows. AI clients only see the tools you add here.</EmptyState>
        ) : tools.map((t, i) => {
          if (t.type === 'builder') {
            return (
              <div key={i} className="mcp-tool">
                <span className="empty-icon" style={{ width: 32, height: 32, margin: 0, borderRadius: 8 }}><Sparkles size={16} /></span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="bold truncate">Agent builder — let the AI build flows for you</div>
                  <div className="tiny subtle">18 tools (<code>onetier_create_flow</code>, <code>onetier_publish_flow</code>, <code>onetier_run_flow</code>, tables…). Your ChatGPT or Claude account does the thinking; OneTier runs the flows.</div>
                </div>
                <Badge color="green">Builder</Badge>
                <Menu trigger={<Button size="sm" variant="ghost" icon={MoreHorizontal} aria-label="Tool actions" />} items={[
                  { label: 'Remove', icon: Trash2, danger: true, onClick: () => setTools((cur) => cur.filter((_, k) => k !== i)) },
                ]} />
              </div>
            );
          }
          const app = t.type === 'flow' ? null : getApp(t.app);
          const act = app?.actions?.[t.action];
          const fixed = Object.keys(t.params || {}).length;
          return (
            <div key={i} className="mcp-tool">
              {t.type === 'flow' ? <span className="empty-icon" style={{ width: 32, height: 32, margin: 0, borderRadius: 8 }}><Workflow size={16} /></span> : <AppIcon app={app} size={32} />}
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="bold truncate">{t.type === 'flow' ? `Run flow: ${flowName(t.flowId) || 'Unknown flow'}` : `${app?.name || t.app}: ${act?.name || t.action}`}</div>
                <div className="tiny subtle row wrap gap-4">
                  <code>{t.type === 'flow' ? 'run_flow_…' : toolName(t)}</code>
                  {t.type !== 'flow' && app?.auth && <span>· {connName(t.connectionId) || <span style={{ color: 'var(--danger)' }}>no connection</span>}</span>}
                  {fixed > 0 && <span>· {fixed} fixed param{fixed === 1 ? '' : 's'}</span>}
                  {t.description && <span className="truncate">· {t.description}</span>}
                </div>
              </div>
              {t.type === 'flow' ? <Badge>Flow</Badge> : <Badge color="brand">Action</Badge>}
              <Menu trigger={<Button size="sm" variant="ghost" icon={MoreHorizontal} aria-label="Tool actions" />} items={[
                t.type !== 'flow' && { label: 'Edit', icon: Pencil, onClick: () => setModal({ kind: 'action', index: i }) },
                { label: 'Remove', icon: Trash2, danger: true, onClick: () => setTools((cur) => cur.filter((_, k) => k !== i)) },
              ]} />
            </div>
          );
        })}
        <div className="card-footer" style={{ justifyContent: 'space-between' }}>
          <span className="small" style={{ color: dirty ? 'var(--warning)' : 'var(--text-3)' }}>{dirty ? 'Unsaved changes' : `${plural(tools.length, 'tool')} saved`}</span>
          <div className="row">
            {dirty && <Button size="sm" variant="ghost" icon={Undo2} onClick={() => setTools(server.tools)}>Discard</Button>}
            <Button size="sm" variant="primary" icon={Save} loading={saving} disabled={!dirty} onClick={save}>Save tools</Button>
          </div>
        </div>
      </div>

      <SetupInstructions url={server.url} />
      <TestConsole server={server} dirty={dirty} />

      {modal?.kind === 'action' && <ActionToolModal initial={modal.index != null ? tools[modal.index] : null} onClose={() => setModal(null)} onSave={upsert} />}
      {modal?.kind === 'flow' && <FlowToolModal existing={tools.filter((t) => t.type === 'flow').map((t) => t.flowId)} onClose={() => setModal(null)} onSave={(t) => { upsert(t); flows.reload(); }} />}
    </div>
  );
}

function Code({ text }) {
  return <div className="mcp-codewrap"><pre className="code-block" style={{ paddingRight: 90 }}>{text}</pre><CopyButton text={text} size="xs" /></div>;
}

function SetupInstructions({ url }) {
  const [tab, setTab] = useState('claude-code');
  const cursor = JSON.stringify({ mcpServers: { onetier: { url } } }, null, 2);
  return (
    <div className="card">
      <div className="card-header"><div><h3>Connect an AI client</h3><div className="tiny subtle">Use this server's URL with any client that supports remote MCP servers (streamable HTTP).</div></div></div>
      <div className="card-body" style={{ paddingTop: 4 }}>
        <Tabs value={tab} onChange={setTab} tabs={[
          { value: 'claude-code', label: 'Claude Code' },
          { value: 'claude', label: 'Claude Desktop / claude.ai' },
          { value: 'cursor', label: 'Cursor' },
          { value: 'chatgpt', label: 'ChatGPT' },
        ]} />
        {tab === 'claude-code' && (
          <div className="col gap-12">
            <p className="small muted">Run this in your terminal, then start <code>claude</code> and ask it to use OneTier tools:</p>
            <Code text={`claude mcp add --transport http onetier ${url}`} />
          </div>
        )}
        {tab === 'claude' && (
          <div className="col gap-12">
            <ol className="mcp-steps">
              <li>Open <b>Settings → Connectors</b> in Claude Desktop or claude.ai.</li>
              <li>Choose <b>Add custom connector</b> and name it “OneTier”.</li>
              <li>Paste the server URL below and click <b>Add</b>. Enable the connector in a chat from the tools menu.</li>
            </ol>
            <Code text={url} />
          </div>
        )}
        {tab === 'cursor' && (
          <div className="col gap-12">
            <p className="small muted">Add this to <code>.cursor/mcp.json</code> in your project (or <code>~/.cursor/mcp.json</code> for all projects), then enable it under Settings → MCP:</p>
            <Code text={cursor} />
          </div>
        )}
        {tab === 'chatgpt' && (
          <div className="col gap-12">
            <ol className="mcp-steps">
              <li>In ChatGPT, open <b>Settings → Apps &amp; Connectors → Advanced</b> and turn on <b>Developer mode</b>.</li>
              <li>Click <b>Create</b> connector, name it “OneTier” and paste the URL below as the MCP server URL (no authentication).</li>
              <li>In a new chat, choose <b>Developer mode</b> from the tools menu and enable OneTier.</li>
            </ol>
            <Code text={url} />
          </div>
        )}
        <div className="mt-16"><Callout type="info" icon={Info}>The URL must be reachable from the AI client. If OneTier runs on <code>localhost</code>, only local clients (Claude Code, Cursor, Claude Desktop) can reach it.</Callout></div>
      </div>
    </div>
  );
}
