// Pure helpers for working with a flow definition tree.
// Definition: { trigger: {...}, steps: [step] } where a step may contain nested
// chains: looping → step.steps, paths → step.paths[].steps.

export const CONTROL_APPS = ['filter', 'paths', 'looping', 'delay', 'approval', 'digest'];

const rand = () => Math.random().toString(36).slice(2, 8);
export const newStepId = () => `s_${rand()}${rand().slice(0, 2)}`;
export const newPathId = () => `p_${rand()}`;

export const cloneDef = (d) => JSON.parse(JSON.stringify(d || { trigger: { app: null, event: null, params: {} }, steps: [] }));

export function normalizeDef(def) {
  const d = cloneDef(def);
  if (!d.trigger || typeof d.trigger !== 'object') d.trigger = { app: null, event: null, params: {} };
  if (!d.trigger.params) d.trigger.params = {};
  if (!Array.isArray(d.steps)) d.steps = [];
  return d;
}

/** Visit every step depth-first (in execution order). fn(step, chain, index, parents) */
export function walkSteps(steps, fn, parents = []) {
  (steps || []).forEach((st, i) => {
    fn(st, steps, i, parents);
    if (st.app === 'paths') for (const p of st.paths || []) walkSteps(p.steps || [], fn, [...parents, { step: st, path: p }]);
    if (st.app === 'looping') walkSteps(st.steps || [], fn, [...parents, { step: st }]);
  });
}

export function countSteps(steps) { let n = 0; walkSteps(steps, () => { n += 1; }); return n; }

/** Numbering map: trigger = 1, then DFS order. */
export function numberSteps(def) {
  const map = { trigger: 1 };
  let n = 1;
  walkSteps(def.steps, (st) => { n += 1; map[st.id] = n; });
  return map;
}

export function findStep(def, id) {
  let found = null;
  walkSteps(def.steps, (st, chain, index, parents) => { if (!found && st.id === id) found = { step: st, chain, index, parents }; });
  return found;
}

/**
 * Locations identify a chain: {parentId: null} = top level, {parentId: loopId} = loop body,
 * {parentId: pathsId, pathId} = a branch.
 */
export function getChain(def, loc) {
  if (!loc?.parentId) return def.steps;
  const f = findStep(def, loc.parentId);
  if (!f) return null;
  if (f.step.app === 'looping') { f.step.steps = f.step.steps || []; return f.step.steps; }
  if (f.step.app === 'paths') {
    const p = (f.step.paths || []).find((x) => x.id === loc.pathId);
    if (!p) return null;
    p.steps = p.steps || [];
    return p.steps;
  }
  return null;
}

/** Produce a new definition by mutating a deep clone. */
export function produce(def, fn) {
  const d = cloneDef(def);
  fn(d);
  return d;
}

export function insertStep(def, loc, index, step) {
  return produce(def, (d) => { const chain = getChain(d, loc); if (chain) chain.splice(index, 0, step); });
}

export function updateStep(def, id, patch) {
  return produce(def, (d) => {
    const f = findStep(d, id);
    if (!f) return;
    const next = typeof patch === 'function' ? patch(f.step) : { ...f.step, ...patch };
    f.chain[f.index] = next;
  });
}

export function removeStep(def, id) {
  return produce(def, (d) => { const f = findStep(d, id); if (f) f.chain.splice(f.index, 1); });
}

export function moveStep(def, id, dir) {
  return produce(def, (d) => {
    const f = findStep(d, id);
    if (!f) return;
    const j = f.index + dir;
    if (j < 0 || j >= f.chain.length) return;
    [f.chain[f.index], f.chain[j]] = [f.chain[j], f.chain[f.index]];
  });
}

/** Deep-copy a step giving it (and everything nested) fresh ids. */
export function reId(step) {
  const s = JSON.parse(JSON.stringify(step));
  const fix = (st) => {
    st.id = newStepId();
    if (st.app === 'paths') for (const p of st.paths || []) { p.id = newPathId(); (p.steps || []).forEach(fix); }
    if (st.app === 'looping') (st.steps || []).forEach(fix);
  };
  fix(s);
  return s;
}

export function duplicateStep(def, id) {
  let newId = null;
  const d = produce(def, (x) => {
    const f = findStep(x, id);
    if (!f) return;
    const copy = reId(f.step);
    if (copy.title) copy.title = `${copy.title} (copy)`;
    newId = copy.id;
    f.chain.splice(f.index + 1, 0, copy);
  });
  return { def: d, newId };
}

export function updatePath(def, stepId, pathId, patch) {
  return produce(def, (d) => {
    const f = findStep(d, stepId);
    if (!f) return;
    f.step.paths = (f.step.paths || []).map((p) => {
      if (p.id === pathId) return typeof patch === 'function' ? patch(p) : { ...p, ...patch };
      // only one fallback path at a time
      if (patch && patch.fallback === true) return { ...p, fallback: false };
      return p;
    });
  });
}

export function findPath(def, stepId, pathId) {
  const f = findStep(def, stepId);
  return f ? (f.step.paths || []).find((p) => p.id === pathId) || null : null;
}

/**
 * Steps whose output is available to `stepId`: preceding siblings at each level
 * of its ancestry plus the ancestors themselves. Returns {steps, inLoop}.
 */
export function priorSteps(def, stepId, { includeSelf = false } = {}) {
  const out = [];
  let inLoop = false;
  const visit = (chain) => {
    for (const st of chain || []) {
      if (st.id === stepId) { if (includeSelf) out.push(st); return true; }
      const kids = st.app === 'looping' ? [st.steps] : st.app === 'paths' ? (st.paths || []).map((p) => p.steps) : [];
      for (const k of kids) {
        const mark = out.length;
        out.push(st);
        if (visit(k)) { if (st.app === 'looping') inLoop = true; return true; }
        out.length = mark;
      }
      out.push(st);
    }
    return false;
  };
  const found = visit(def.steps);
  return { steps: found ? out.filter((s, i, a) => a.indexOf(s) === i) : [], inLoop, found };
}

export function isEmptyValue(v) {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
}

/** Client-side mirror of the server's publish validation. Returns {byStep: {id: [msg]}, general: [msg]} */
export function computeIssues(def, getApp, plan) {
  const byStep = {};
  const general = [];
  const add = (id, msg) => { if (id) (byStep[id] = byStep[id] || []).push(msg); else general.push(msg); };
  const t = def.trigger || {};
  const tApp = t.app ? getApp(t.app) : null;
  if (!tApp) add('trigger', 'Choose a trigger app.');
  else if (!tApp.triggers?.[t.event]) add('trigger', 'Choose a trigger event.');
  else {
    if (tApp.auth && !t.connectionId) add('trigger', `Connect a ${tApp.name} account.`);
    for (const f of tApp.triggers[t.event].fields || []) if (f.required && isEmptyValue(t.params?.[f.key])) add('trigger', `"${f.label}" is required.`);
  }
  if (!def.steps?.length) general.push('Add at least one action.');
  const total = countSteps(def.steps) + 1;
  walkSteps(def.steps, (st) => {
    const app = st.app ? getApp(st.app) : null;
    if (!app) return add(st.id, 'Choose an app for this step.');
    const act = app.actions?.[st.action];
    if (!act) return add(st.id, `Choose an action for ${app.name}.`);
    if (app.auth && !st.connectionId) add(st.id, `Connect a ${app.name} account.`);
    if (st.app === 'filter' && !(st.params?.conditions || []).flat().length) add(st.id, 'Add at least one filter condition.');
    if (st.app === 'paths' && !(st.paths || []).length) add(st.id, 'Add at least one path.');
    for (const f of act.fields || []) {
      if (!f.required || f.type === 'conditions') continue;
      if (isEmptyValue(st.params?.[f.key])) add(st.id, `"${f.label}" is required.`);
    }
  });
  return { byStep, general };
}

/** Default params for a trigger/action's fields. */
export function defaultParams(fields = []) {
  const p = {};
  for (const f of fields) if (f.default !== undefined) p[f.key] = f.default;
  return p;
}

export const OPERATORS = [
  { value: 'equals', label: 'equals', unary: false },
  { value: 'not_equals', label: 'does not equal' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
  { value: 'gt', label: 'is greater than' },
  { value: 'lt', label: 'is less than' },
  { value: 'gte', label: 'is greater than or equal to' },
  { value: 'lte', label: 'is less than or equal to' },
  { value: 'exists', label: 'exists', unary: true },
  { value: 'not_exists', label: 'does not exist', unary: true },
  { value: 'is_true', label: 'is true', unary: true },
  { value: 'is_false', label: 'is false', unary: true },
  { value: 'matches_regex', label: 'matches pattern (regex)' },
  { value: 'date_after', label: 'date is after' },
  { value: 'date_before', label: 'date is before' },
];
export const opLabel = (op) => OPERATORS.find((o) => o.value === op)?.label || op || 'equals';
export const isUnary = (op) => Boolean(OPERATORS.find((o) => o.value === op)?.unary);

const shortTok = (s) => String(s ?? '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, e) => e.split('.').slice(-1)[0]);
/** One-line human summary of OR-of-AND condition groups. */
export function conditionSummary(groups) {
  const gs = (groups || []).filter((g) => g?.length);
  if (!gs.length) return 'No conditions yet';
  const one = (c) => `${shortTok(c.left) || '…'} ${opLabel(c.op)}${isUnary(c.op) ? '' : ` ${shortTok(c.right) || '…'}`}`;
  return gs.map((g) => g.map(one).join(' and ')).join(' — or — ');
}

// ---- template preview: resolve {{a.b}} against sample scopes for display.
export function getPath(obj, path) {
  if (obj == null || !path) return obj;
  let cur = obj;
  for (const p of String(path).replace(/\[(\w+)\]/g, '.$1').split('.').filter(Boolean)) {
    if (cur == null) return undefined;
    if (Array.isArray(cur) && !/^\d+$/.test(p)) { cur = cur.map((x) => x?.[p]); continue; }
    cur = cur[p];
  }
  return cur;
}
export function previewTemplate(str, scopes) {
  if (typeof str !== 'string' || !str.includes('{{')) return null;
  return str.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, expr) => {
    const [root, ...rest] = expr.split('.');
    if (!(root in scopes)) return `{{${expr}}}`;
    const v = getPath(scopes[root], rest.join('.'));
    if (v === undefined || v === null) return '';
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
}
