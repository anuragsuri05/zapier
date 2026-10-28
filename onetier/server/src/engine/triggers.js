import { get, all, run, now, j, s, decrypt } from '../db.js';
import { getApp } from '../apps/registry.js';
import { planOf } from '../plans.js';
import { bus, notify } from '../services.js';
import { executeFlow, resumeRun, decideApproval } from './index.js';

const liveFlows = () => all("SELECT * FROM flows WHERE status = 'on' AND deleted_at IS NULL");
const triggerOf = (flow) => j(flow.published, {})?.trigger || {};

// ---------------------------------------------------------------- Webhooks
export async function handleWebhook(flowId, secret, req) {
  const flow = get('SELECT * FROM flows WHERE id = ? AND deleted_at IS NULL', flowId);
  if (!flow || flow.hook_secret !== secret) return { status: 404, body: { status: 'error', message: 'Unknown webhook URL' } };
  const def = flow.status === 'on' ? j(flow.published) : j(flow.definition);
  const trig = def?.trigger || {};
  if (trig.app !== 'webhook') return { status: 409, body: { status: 'error', message: 'This flow does not start with a webhook trigger.' } };
  let data;
  if (trig.event === 'catch_raw') data = { raw_body: req.rawBody || '', headers: req.headers, method: req.method, query: req.query };
  else {
    let body = req.body;
    if (trig.params?.pick) for (const p of trig.params.pick.split('.')) body = body?.[p];
    data = { body: body ?? {}, query: req.query, method: req.method, headers: { 'content-type': req.headers['content-type'], 'user-agent': req.headers['user-agent'] } };
  }
  // Always keep the latest request as sample data for the editor.
  const st = j(flow.trigger_state, {});
  st.lastSample = data; st.lastSampleAt = now();
  st.samples = [data, ...(st.samples || [])].slice(0, 5);
  run('UPDATE flows SET trigger_state = ? WHERE id = ?', s(st), flow.id);
  if (flow.status !== 'on') return { status: 200, body: { status: 'success', message: 'Sample received. Turn the flow on to process requests.', attempt: null } };
  const result = executeFlow(flow, data, { source: 'webhook' });
  const sync = req.query?.wait === 'true';
  if (sync) { const r = await result; return { status: 200, body: { status: r.status, run_id: r.runId, return: r.returnValue ?? null, error: r.error } }; }
  return { status: 200, body: { status: 'success', message: 'Accepted', attempt: flow.id } };
}

// ---------------------------------------------------------------- Internal events (Tables, Interfaces, Chatbots, Manual)
function fireInternal(match, data, wsId, excludeFlowId = null) {
  for (const flow of liveFlows()) {
    if (flow.workspace_id !== wsId || flow.id === excludeFlowId) continue;
    const t = triggerOf(flow);
    if (match(t)) executeFlow(flow, data, { source: 'event' }).catch((e) => console.error('[trigger]', e));
  }
}

// A record written by a flow never re-triggers that same flow (prevents infinite loops).
const originFlow = (source) => (String(source || '').startsWith('flow:') ? String(source).slice(5) : null);
bus.on('table.record.created', ({ wsId, tableId, record, source }) =>
  fireInternal((t) => t.app === 'tables' && t.event === 'new_record' && t.params?.tableId === tableId, record, wsId, originFlow(source)));
bus.on('table.record.updated', ({ wsId, tableId, record, source }) =>
  fireInternal((t) => t.app === 'tables' && t.event === 'updated_record' && t.params?.tableId === tableId, record, wsId, originFlow(source)));
bus.on('interface.submitted', ({ wsId, interfaceId, blockId, data }) =>
  fireInternal((t) => t.app === 'interfaces' && t.event === 'form_submitted' && t.params?.interfaceId === interfaceId && (!t.params?.blockId || t.params.blockId === blockId), data, wsId));
bus.on('interface.button', ({ wsId, interfaceId, data, flowId }) => {
  for (const flow of liveFlows()) {
    if (flow.workspace_id !== wsId) continue;
    const t = triggerOf(flow);
    const direct = flowId && flow.id === flowId && ['manual', 'interfaces'].includes(t.app);
    const listening = t.app === 'interfaces' && t.event === 'button_clicked' && t.params?.interfaceId === interfaceId;
    if (direct || listening) executeFlow(flow, data, { source: 'interface' }).catch((e) => console.error(e));
  }
});
bus.on('chatbot.lead', ({ wsId, chatbotId, data }) =>
  fireInternal((t) => t.app === 'chatbots' && t.event === 'new_lead' && t.params?.chatbotId === chatbotId, data, wsId));
bus.on('chatbot.message', ({ wsId, chatbotId, data }) =>
  fireInternal((t) => t.app === 'chatbots' && t.event === 'conversation_ended' && t.params?.chatbotId === chatbotId, data, wsId));

// ---------------------------------------------------------------- Schedule
export function nextScheduleTime(params = {}, from = new Date()) {
  const f = params.frequency || 'day';
  if (f === 'minutes') return new Date(from.getTime() + Math.max(1, Number(params.interval) || 15) * 6e4);
  if (f === 'hour') { const d = new Date(from); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return d; }
  const [hh, mm] = String(params.time || '09:00').split(':').map(Number);
  const d = new Date(from); d.setHours(hh || 0, mm || 0, 0, 0);
  const okDay = (x) => params.weekdaysOnly !== false || ![0, 6].includes(x.getDay());
  if (f === 'day') { while (d <= from || !okDay(d)) d.setDate(d.getDate() + 1); return d; }
  if (f === 'week') { const wd = Number(params.weekday ?? 1); while (d <= from || d.getDay() !== wd) d.setDate(d.getDate() + 1); return d; }
  if (f === 'month') { const md = Math.min(28, Math.max(1, Number(params.monthday) || 1)); d.setDate(md); while (d <= from) { d.setMonth(d.getMonth() + 1); d.setDate(md); } return d; }
  return new Date(from.getTime() + 864e5);
}

function scheduleData(at) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return { iso: at.toISOString(), date: at.toISOString().slice(0, 10), time: at.toTimeString().slice(0, 5), day_of_week: days[at.getDay()], pretty_time: `${days[at.getDay()]} ${at.toTimeString().slice(0, 5)}`, timestamp: Math.floor(at.getTime() / 1000) };
}

// ---------------------------------------------------------------- Polling
export async function pollFlow(flow, { force = false, seedOnly = false } = {}) {
  const def = j(flow.published) || j(flow.definition);
  const trig = def.trigger || {};
  const app = getApp(trig.app, flow.workspace_id);
  const t = app?.triggers?.[trig.event];
  if (!t?.poll) throw new Error('This trigger does not poll.');
  let creds = {};
  if (app.auth) {
    const c = get('SELECT credentials FROM connections WHERE id = ? AND workspace_id = ?', trig.connectionId, flow.workspace_id);
    if (!c) throw new Error(`Connect a ${app.name} account for the trigger.`);
    creds = decrypt(c.credentials);
  }
  const st = j(flow.trigger_state, {});
  const items = await t.poll({ params: trig.params || {}, creds, state: st });
  const seen = new Set(st.seen || []);
  const fresh = items.filter((x) => !seen.has(String(x.id)));
  const firstPoll = !st.seeded;
  st.seen = [...items.map((x) => String(x.id)), ...(st.seen || [])].filter((v, i, a) => a.indexOf(v) === i).slice(0, 1000);
  st.seeded = true;
  st.lastPollAt = now();
  st.lastPollError = null;
  if (items[0]) { st.lastSample = items[0]; st.samples = items.slice(0, 5); }
  run('UPDATE flows SET trigger_state = ? WHERE id = ?', s(st), flow.id);
  if (seedOnly || (firstPoll && !force)) return { found: items.length, triggered: 0, samples: items.slice(0, 5) };
  const batch = fresh.slice(0, 20).reverse();
  for (const item of batch) await executeFlow(flow, item, { source: 'poll' });
  return { found: items.length, triggered: batch.length, samples: items.slice(0, 5) };
}

// ---------------------------------------------------------------- Scheduler loop
let ticking = false;
export async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const nowD = new Date();
    for (const flow of liveFlows()) {
      const trig = triggerOf(flow);
      const app = getApp(trig.app, flow.workspace_id);
      const tdef = app?.triggers?.[trig.event];
      if (!tdef || !['schedule', 'polling'].includes(tdef.type)) continue;
      const st = j(flow.trigger_state, {});
      if (!st.nextAt) {
        const ws = get('SELECT * FROM workspaces WHERE id = ?', flow.workspace_id);
        st.nextAt = tdef.type === 'schedule' ? nextScheduleTime(trig.params, nowD).toISOString() : nowD.toISOString();
        run('UPDATE flows SET trigger_state = ? WHERE id = ?', s(st), flow.id);
        if (tdef.type === 'schedule') continue;
        void ws;
      }
      if (new Date(st.nextAt) > nowD) continue;
      const ws = get('SELECT * FROM workspaces WHERE id = ?', flow.workspace_id);
      if (tdef.type === 'schedule') {
        let next = nextScheduleTime(trig.params, nowD);
        const minGap = planOf(ws).pollMinutes * 6e4;
        if (trig.params?.frequency === 'minutes' && next - nowD < minGap) next = new Date(nowD.getTime() + minGap);
        st.nextAt = next.toISOString();
        run('UPDATE flows SET trigger_state = ? WHERE id = ?', s(st), flow.id);
        executeFlow(flow, scheduleData(nowD), { source: 'schedule' }).catch((e) => console.error(e));
      } else {
        const fresh = get('SELECT * FROM flows WHERE id = ?', flow.id);
        const st2 = j(fresh.trigger_state, {});
        st2.nextAt = new Date(nowD.getTime() + planOf(ws).pollMinutes * 6e4).toISOString();
        run('UPDATE flows SET trigger_state = ? WHERE id = ?', s(st2), flow.id);
        try { await pollFlow({ ...fresh, trigger_state: s(st2) }); } catch (e) {
          const st3 = j(get('SELECT trigger_state FROM flows WHERE id = ?', flow.id).trigger_state, {});
          if (st3.lastPollError !== e.message) notify(flow.workspace_id, { type: 'error', title: `Trigger error: ${flow.name}`, body: e.message, link: `/flows/${flow.id}` });
          st3.lastPollError = e.message; st3.lastPollAt = now();
          run('UPDATE flows SET trigger_state = ? WHERE id = ?', s(st3), flow.id);
        }
      }
    }
    // Due jobs: delayed runs and approval timeouts
    for (const job of all('SELECT * FROM jobs WHERE resume_at <= ? ORDER BY resume_at LIMIT 50', nowD.toISOString())) {
      run('DELETE FROM jobs WHERE id = ?', job.id);
      const p = j(job.payload, {});
      try {
        if (job.kind === 'resume') {
          if (p.stepRowId) run("UPDATE run_steps SET status = 'success', finished_at = ? WHERE id = ? AND status = 'waiting'", now(), p.stepRowId);
          await resumeRun(job.run_id, { index: p.index });
        } else if (job.kind === 'approval_timeout') {
          await decideApproval(p.approvalId, { name: 'Timeout' }, 'reject', 'No decision before the timeout.');
        }
      } catch (e) { console.error('[job]', e.message); }
    }
  } finally { ticking = false; }
}

export function startScheduler() {
  setInterval(() => tick().catch((e) => console.error('[tick]', e)), 10_000);
  setTimeout(() => tick().catch(() => {}), 1500);
}
