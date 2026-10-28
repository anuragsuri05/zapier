// {{stepId.path.to.value}} templating used for field mapping between steps.
const TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function getPath(obj, path) {
  if (obj == null || !path) return obj;
  const parts = String(path).replace(/\[(\w+)\]/g, '.$1').split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (Array.isArray(cur) && !/^\d+$/.test(p)) {
      // pluck across arrays: items.name -> [names]
      cur = cur.map((x) => (x == null ? undefined : x[p]));
      continue;
    }
    cur = cur[p];
  }
  return cur;
}

function toText(v) {
  if (v == null) return '';
  if (typeof v === 'object') return Array.isArray(v) && v.every((x) => typeof x !== 'object') ? v.join(',') : JSON.stringify(v);
  return String(v);
}

/** Resolve a single expression like "trigger.body.email" against the run context. */
export function resolveExpr(expr, ctx) {
  const [root, ...rest] = expr.split('.');
  const scope = ctx.steps?.[root] !== undefined ? ctx.steps[root] : ctx.vars?.[root];
  if (scope === undefined) {
    if (root === 'now') return new Date().toISOString();
    if (root === 'run') return getPath({ id: ctx.runId, flowId: ctx.flowId }, rest.join('.'));
    return undefined;
  }
  return getPath(scope, rest.join('.'));
}

/** Render any value: strings get token substitution; objects/arrays are walked. */
export function render(value, ctx) {
  if (typeof value === 'string') {
    const whole = value.match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
    if (whole) {
      const v = resolveExpr(whole[1], ctx);
      return v === undefined ? '' : v;
    }
    return value.replace(TOKEN, (_, expr) => toText(resolveExpr(expr, ctx)));
  }
  if (Array.isArray(value)) return value.map((v) => render(v, ctx));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = render(v, ctx);
    return out;
  }
  return value;
}

const num = (v) => (v === '' || v == null ? NaN : Number(v));

export const OPERATORS = {
  equals: (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase(),
  not_equals: (a, b) => !OPERATORS.equals(a, b),
  contains: (a, b) => toText(a).toLowerCase().includes(String(b ?? '').toLowerCase()),
  not_contains: (a, b) => !OPERATORS.contains(a, b),
  starts_with: (a, b) => toText(a).toLowerCase().startsWith(String(b ?? '').toLowerCase()),
  ends_with: (a, b) => toText(a).toLowerCase().endsWith(String(b ?? '').toLowerCase()),
  gt: (a, b) => num(a) > num(b),
  lt: (a, b) => num(a) < num(b),
  gte: (a, b) => num(a) >= num(b),
  lte: (a, b) => num(a) <= num(b),
  exists: (a) => a !== undefined && a !== null && a !== '',
  not_exists: (a) => !OPERATORS.exists(a),
  is_true: (a) => a === true || ['true', '1', 'yes'].includes(String(a).toLowerCase()),
  is_false: (a) => !OPERATORS.is_true(a),
  matches_regex: (a, b) => { try { return new RegExp(b, 'i').test(toText(a)); } catch { return false; } },
  date_after: (a, b) => new Date(a) > new Date(b),
  date_before: (a, b) => new Date(a) < new Date(b),
};

/** groups: [[{left, op, right}]] — OR across groups, AND within a group. */
export function evaluateConditions(groups, ctx) {
  if (!Array.isArray(groups) || !groups.length) return { passed: true, details: [] };
  const details = [];
  const passed = groups.some((group) =>
    (group || []).every((c) => {
      const left = render(c.left ?? '', ctx);
      const right = render(c.right ?? '', ctx);
      const fn = OPERATORS[c.op] || OPERATORS.equals;
      const ok = fn(left, right);
      details.push({ left, op: c.op, right, passed: ok });
      return ok;
    }),
  );
  return { passed, details };
}
