// Which column a name in a formula means, and in what order calculated values are worked out —
// 2026-11-24 (the owner: a formula may use another calculated column, and calculated names are
// unique). Pure, no model: computed.ts, columns.ts, the actions and the assistant all ask here,
// so the editor, the table and `make_schedule` cannot disagree about what a name binds to.
//
// The rules, in order:
//   · a model column's heading wins — as it did before — even when two model columns share it
//     (then the name is ambiguous and binds to nothing, as before);
//   · otherwise a formula calculated value's name, when exactly one calculated value has it;
//     two calculated values sharing a name (a file saved before names were unique) bind to
//     nothing, and nothing is renamed on load;
//   · a percentage is never a variable: it is worked out in a second pass over every row.

import { headingOf, type Calculated, type Column, type ScheduleDef } from './def';
import { referencedNames } from './formula';
import { ANY_PSET } from './resolve';

/** How names are compared: ignoring case and surrounding spaces. Not text (a hostile file) is no name. */
export const nameKey = (s: unknown): string => (typeof s === 'string' ? s.trim().toLowerCase() : '');

export type Binding =
  | { kind: 'model'; column: number }
  | { kind: 'calc'; id: string };

export interface CalcNames {
  /** Name key → the column it means. A name that means two things is absent. */
  bindings: Map<string, Binding>;
  /** Name keys of percentage values that nothing else claims — for a clearer message. */
  percentages: Set<string>;
  /** Formula ids in an order where each comes after every calculated value it uses. Loop members and what depends on them are left out. */
  order: string[];
  /** Formula id → the message naming the loop it is in. */
  loops: Map<string, string>;
  /** Formula id → the ids of the calculated values its formula names. */
  deps: Map<string, string[]>;
}

const quoted = (names: string[]): string => {
  const q = names.map((n) => `"${n}"`);
  return q.length < 2 ? q.join('') : `${q.slice(0, -1).join(', ')} and ${q[q.length - 1]}`;
};

/** 2026-11-25 (F3): a value blank because one it uses cannot be worked out — naming those it uses directly. */
export const BLOCKED = (names: string[]) => `Cannot be worked out: ${quoted(names)} ${names.length > 1 ? 'have' : 'has'} a problem.`;

const LOOP_TAIL = ' — a formula cannot use its own result, directly or through another column.';

export function calcNames(def: ScheduleDef): CalcNames {
  const bindings = new Map<string, Binding>();
  const modelCount = new Map<string, number>();
  def.columns.forEach((c, i) => {
    if (c.field.kind !== 'core' && c.field.kind !== 'prop') return;
    const k = nameKey(headingOf(c, def));
    modelCount.set(k, (modelCount.get(k) ?? 0) + 1);
    bindings.set(k, { kind: 'model', column: i });
  });
  for (const [k, n] of modelCount) if (n > 1) bindings.delete(k);

  const calcs = def.calculated ?? [];
  const calcCount = new Map<string, number>();
  for (const c of calcs) {
    const k = nameKey(c.name);
    if (k) calcCount.set(k, (calcCount.get(k) ?? 0) + 1);
  }
  const percentages = new Set<string>();
  for (const c of calcs) {
    const k = nameKey(c.name);
    if (!k || modelCount.has(k) || calcCount.get(k) !== 1) continue;
    if (c.kind === 'formula') bindings.set(k, { kind: 'calc', id: c.id });
    else percentages.add(k);
  }

  const formulas = calcs.filter((c) => c.kind === 'formula');
  const deps = new Map<string, string[]>();
  for (const c of formulas) {
    const ids = new Set<string>();
    for (const n of referencedNames(c.formula ?? '')) {
      const b = bindings.get(nameKey(n));
      if (b?.kind === 'calc') ids.add(b.id);
    }
    deps.set(c.id, [...ids]);
  }

  // What each value reaches through its formula, walked with a stack — never recursion, so a
  // long chain cannot overflow it. A value that reaches itself is in a loop.
  const reach = new Map<string, Set<string>>();
  for (const c of formulas) {
    const seen = new Set<string>();
    const stack = [...deps.get(c.id)!];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(deps.get(id) ?? []));
    }
    reach.set(c.id, seen);
  }
  const loops = new Map<string, string>();
  for (const c of formulas) {
    if (!reach.get(c.id)!.has(c.id)) continue;
    // Its loop: every value it reaches that reaches it back, in the schedule's own order.
    const members = formulas.filter((o) => o.id === c.id || (reach.get(c.id)!.has(o.id) && reach.get(o.id)!.has(c.id)));
    const names = members.map((m) => String(m.name).trim());
    loops.set(c.id, members.length === 1 ? `${quoted(names)} uses itself${LOOP_TAIL}` : `${quoted(names)} use each other in a loop${LOOP_TAIL}`);
  }

  // Kahn's order over what is left: a value comes once everything it uses has.
  const order: string[] = [];
  const done = new Set<string>();
  let pending = formulas.filter((c) => !loops.has(c.id));
  for (let moved = true; moved && pending.length;) {
    moved = false;
    const next: Calculated[] = [];
    for (const c of pending) {
      if (deps.get(c.id)!.every((d) => done.has(d))) {
        order.push(c.id);
        done.add(c.id);
        moved = true;
      } else next.push(c);
    }
    pending = next;
  }
  return { bindings, percentages, order, loops, deps };
}

const TAKEN = (name: string) => `Another column is already called "${name}" — each calculated column needs a name of its own.`;

/**
 * Why a calculated value cannot be called `name`, or null: another column's heading or another
 * calculated value's name already has it. A column showing this value does not count.
 */
export function calcNameClash(def: ScheduleDef, id: string, name: string): string | null {
  const k = nameKey(name);
  if (!k) return null;
  const heading = def.columns.some((c) =>
    !(c.field.kind === 'formula' && c.field.id === id) && nameKey(headingOf(c, def)) === k);
  const calc = (def.calculated ?? []).some((c) => c.id !== id && nameKey(c.name) === k);
  return heading || calc ? TAKEN(name.trim()) : null;
}

/** Whether another formula names this calculated value. */
function isUsed(def: ScheduleDef, id: string): boolean {
  const names = calcNames(def);
  return [...names.deps].some(([other, ds]) => other !== id && ds.includes(id));
}

/**
 * The editor's name box: why `name` is refused for calculated value `id`, or null. Its own
 * name again (in any case) is fine; so is a name nothing else has. An empty name is refused
 * only while another formula uses this value — the rename could not be carried into it.
 */
export function calcNameProblem(def: ScheduleDef, id: string, name: string): string | null {
  const c = def.calculated?.find((x) => x.id === id);
  if (!c || nameKey(name) === nameKey(c.name)) return null;
  if (!nameKey(name)) return isUsed(def, id) ? 'Another formula uses this column, so it needs a name.' : null;
  return calcNameClash(def, id, name);
}

/** Name keys of every name some formula uses (2026-11-25). */
export function formulaNames(def: ScheduleDef): Set<string> {
  const out = new Set<string>();
  for (const c of def.calculated ?? []) {
    if (c.kind === 'formula') for (const n of referencedNames(c.formula ?? '')) out.add(nameKey(n));
  }
  return out;
}

/** The calculated value called `name`, other than value `id`, or undefined. */
export const calcCalled = (def: ScheduleDef, name: string, id: string | null = null): Calculated | undefined =>
  nameKey(name) ? (def.calculated ?? []).find((c) => c.id !== id && nameKey(c.name) === nameKey(name)) : undefined;

/** Why a column cannot be headed with a calculated value's name — the heading box's and `make_schedule`'s words. */
export const HEADING_TAKEN = (name: string) => `A calculated column is already called "${name}" — give this column another heading.`;

/** 2026-11-25 (F5): a name in brackets ends at the first `]`, so a name a formula uses cannot hold one. */
export const BRACKET = 'A name a formula uses cannot contain [ or ].';

/**
 * The column menu's heading box, and `setHeading`: why column `i` cannot be headed `heading`, or
 * null. An empty box means the default heading, which is checked instead; a change of case or of
 * surrounding spaces is the column's own heading again. Refused:
 *   · another calculated value's name, on any column;
 *   · on a calculated value's column, another column's heading (2026-11-25, F1);
 *   · on a model column, another column's heading while a formula names this column or that
 *     heading (2026-11-25, F2) — two model columns no formula names may still share one.
 */
export function headingProblem(def: ScheduleDef, i: number, heading: string): string | null {
  const col = def.columns[i];
  if (!col) return null;
  const before = headingOf(col, def);
  const next = headingOf({ ...col, heading }, def);
  const k = nameKey(next);
  if (k === nameKey(before)) return null;
  const own = col.field.kind === 'formula' ? col.field.id : null;
  const hit = calcCalled(def, next, own);
  if (hit) return HEADING_TAKEN(hit.name.trim());
  const other = def.columns.find((c, j) => j !== i
    && !(own !== null && c.field.kind === 'formula' && c.field.id === own) && nameKey(headingOf(c, def)) === k);
  if (!other) return null;
  const name = headingOf(other, def);
  if (own !== null) return `Another column is already called "${name}" — give this column another heading.`;
  const used = formulaNames(def);
  return used.has(nameKey(before)) || used.has(k)
    ? `Another column is already called "${name}", and a formula uses one of the two — give this column another heading.`
    : null;
}

/** Why `current` may not become `next` for its brackets, or null: only a name a formula uses is held to it. */
export function bracketProblem(def: ScheduleDef, current: string, next: string): string | null {
  return /[[\]]/.test(next) && nameKey(next) !== nameKey(current) && formulaNames(def).has(nameKey(current)) ? BRACKET : null;
}

/**
 * What the two boxes refuse: their actions' rules (`headingProblem`, `calcNameProblem`) and, in
 * the box only, a bracket in a name a formula uses (F5). Not in the actions: what lands through
 * them otherwise is visible (a formula that no longer parses), never a different number.
 */
export function headingBoxProblem(def: ScheduleDef, i: number, heading: string): string | null {
  const col = def.columns[i];
  if (!col) return null;
  return headingProblem(def, i, heading)
    ?? (col.field.kind === 'formula' ? null : bracketProblem(def, headingOf(col, def), headingOf({ ...col, heading }, def)));
}
export function nameBoxProblem(def: ScheduleDef, id: string, name: string): string | null {
  const c = def.calculated?.find((x) => x.id === id);
  return c ? calcNameProblem(def, id, name) ?? bracketProblem(def, c.name, name) : null;
}

/** "Qto" for a quantity set, the set's own name otherwise — the field picker's tag for two same-named fields. */
export const psetTag = (pset: string) => (/^qto_/i.test(pset) ? 'Qto' : pset.replace(/^pset_/i, ''));

/**
 * 2026-11-25 (F1): a heading for model column `col` (already in `def.columns`) that no calculated
 * value has, or undefined when its own heading clashes with none. The field picker's label — the
 * heading and its pset's tag, "Volume (Qto)" — then a number until nothing has it.
 */
export function clearOfCalcNames(def: ScheduleDef, col: Column): string | undefined {
  const base = headingOf(col, def);
  if (!calcCalled(def, base)) return undefined;
  const taken = (h: string) => !!calcCalled(def, h)
    || def.columns.some((c) => c !== col && nameKey(headingOf(c, def)) === nameKey(h));
  const tag = col.field.kind === 'prop' && col.field.pset !== ANY_PSET ? psetTag(col.field.pset) : '';
  const first = tag ? `${base} (${tag})` : base;
  let h = tag ? first : `${first} 2`;
  for (let n = 2; taken(h); n++) h = `${first} ${tag ? n : n + 1}`;
  return h;
}
