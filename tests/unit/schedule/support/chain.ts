// Shared by the chained-formula guards (`chain-*.test.ts`, 2026-11-24): a seeded synthetic store,
// an expression tree rendered to formula text, and a plain-JS evaluator of that tree — the
// oracle. Nothing here parses or evaluates a formula with the app's code: the oracle works from
// the tree the text was rendered from.

import { StoreBuilder, type ModelStore } from '../../../../src/schedule/ifc/store';
import type { Cell, ElemCore, ModelMeta, UnitKind } from '../../../../src/schedule/ifc/types';
import { emptySchedule, type Calculated, type CalcResult, type Column, type ScheduleDef } from '../../../../src/schedule/schedule/def';
import { planComputed } from '../../../../src/schedule/schedule/computed';
import type { Rng } from './sim';

export { mulberry32, type Rng } from './sim';

export const int = (r: Rng, n: number) => Math.floor(r() * n);
export const pick = <T>(r: Rng, xs: readonly T[]): T => xs[int(r, xs.length)];
export function shuffle<T>(r: Rng, xs: readonly T[]): T[] {
  const out = xs.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = int(r, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** How the app compares names — restated here, not imported: trimmed, case ignored. */
export const key = (s: string) => s.trim().toLowerCase();

// ---------------------------------------------------------------- the store

export interface Prop { prop: string; kind?: UnitKind }
export interface StoreSpec { props: Prop[]; rows: (number | null)[][]; storeys: string[] }
export const PSET = 'Q';

export function randomStore(r: Rng, props: Prop[], n = 10, blank = 0.2): StoreSpec {
  const rows = Array.from({ length: n }, () => props.map(() => (r() < blank ? null : Math.round((r() * 40 - 8) * 100) / 100)));
  const storeys = Array.from({ length: n }, () => pick(r, ['L1', 'L2', 'L3']));
  return { props, rows, storeys };
}

export function storeOf(s: StoreSpec): ModelStore {
  const b = new StoreBuilder();
  const cores: ElemCore[] = [];
  const cells: Record<string, Cell>[] = [];
  s.rows.forEach((row, i) => {
    cores.push({
      entity: 'IfcSpace', name: `S${i}`, description: '', mark: `M${i}`, typeName: 'T', family: 'F',
      objectType: '', predefinedType: '', guid: `g${i}`, storey: s.storeys[i], storeyElevation: 0,
      building: '', site: '', space: '', material: '', discipline: 'ARC',
    });
    const c: Record<string, Cell> = {};
    row.forEach((v, j) => {
      if (v === null) return;
      const k = s.props[j].kind;
      c[`${PSET}.${s.props[j].prop}`] = k ? { v, k } : { v };
    });
    cells.push(c);
  });
  b.add(cores, cells);
  const meta: ModelMeta = {
    fileName: 'chain.ifc', schema: 'IFC4', projectName: '', authoringTool: '',
    lengthUnit: 'mm', unitSystem: 'metric', elementCount: cores.length, parseMs: 0,
  };
  return b.finish(meta);
}

export const modelColumn = (p: Prop, heading?: string): Column =>
  ({ field: { kind: 'prop', pset: PSET, prop: p.prop }, ...(heading === undefined ? {} : { heading }) });
export const showCalc = (id: string, hidden = false): Column =>
  ({ field: { kind: 'formula', id }, format: { decimals: 3 }, ...(hidden ? { hidden: true } : {}) });

export function scheduleOf(columns: Column[], calculated: Calculated[]): ScheduleDef {
  return { ...emptySchedule('Chain', ['IfcSpace']), columns, calculated };
}

// ---------------------------------------------------------------- expressions

type CmpOp = '>' | '<' | '>=' | '<=';
export type Expr =
  | { t: 'num'; v: number }
  | { t: 'ref'; to: string }
  | { t: 'bin'; op: '+' | '-' | '*'; a: Expr; b: Expr }
  | { t: 'div'; a: Expr; k: number }
  | { t: 'neg'; a: Expr }
  | { t: 'fn'; f: 'min' | 'max'; a: Expr; b: Expr }
  | { t: 'abs'; a: Expr }
  | { t: 'round'; a: Expr }
  | { t: 'if'; c: Expr; a: Expr; b: Expr }
  | { t: 'cmp'; op: CmpOp; a: Expr; b: Expr }
  | { t: 'str'; v: string }
  | { t: 'eq'; a: Expr; s: string };

export const ref = (to: string): Expr => ({ t: 'ref', to });

/** Every name the expression refers to. */
export function refsOf(e: Expr, out = new Set<string>()): Set<string> {
  switch (e.t) {
    case 'num': case 'str': return out;
    case 'ref': out.add(e.to); return out;
    case 'div': case 'neg': case 'abs': case 'round': case 'eq': return refsOf(e.a, out);
    case 'if': refsOf(e.c, out); refsOf(e.a, out); return refsOf(e.b, out);
    case 'bin': case 'fn': case 'cmp': refsOf(e.a, out); return refsOf(e.b, out);
  }
}

/**
 * A random numeric expression of about `size` operators over `leaves` (each used as given), with
 * at least one leaf in it. Constants are positive; division is by a non-zero constant only, so
 * the oracle needs no rule of its own for a division by zero.
 */
export function genExpr(r: Rng, leaves: Expr[], size: number): Expr {
  const leaf = (): Expr => (r() < 0.8 || !size ? pick(r, leaves) : { t: 'num', v: pick(r, [0.5, 1, 1.5, 2, 3, 10, 0.25]) });
  const go = (n: number): Expr => {
    if (n <= 0) return leaf();
    const a = () => go(n - 1 - int(r, 2));
    switch (int(r, 9)) {
      case 0: case 1: case 2: return { t: 'bin', op: pick(r, ['+', '-', '*'] as const), a: a(), b: a() };
      case 3: return { t: 'div', a: a(), k: pick(r, [2, 4, 1000, 0.5]) };
      case 4: return { t: 'neg', a: a() };
      case 5: return { t: 'fn', f: pick(r, ['min', 'max'] as const), a: a(), b: a() };
      case 6: return r() < 0.5 ? { t: 'abs', a: a() } : { t: 'round', a: a() };
      default: return { t: 'if', c: cmp(r, a(), a()), a: a(), b: a() };
    }
  };
  let e = go(size);
  if (!refsOf(e).size && !leaves.every((l) => l.t === 'num')) e = { t: 'bin', op: '+', a: e, b: pick(r, leaves) };
  return e;
}
export const cmp = (r: Rng, a: Expr, b: Expr): Expr => ({ t: 'cmp', op: pick(r, ['>', '<', '>=', '<='] as const), a, b });

/** How a name is written: bare when it can be (in any case), else `[bracketed]`, sometimes padded. */
export function spellName(r: Rng, name: string): string {
  const n = name.trim();
  const ascii = /^[\x20-\x7e]*$/.test(n);
  const cased = ascii ? pick(r, [n, n.toLowerCase(), n.toUpperCase()]) : n;
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) && r() < 0.6) return cased;
  return r() < 0.3 ? `[ ${cased} ]` : `[${cased}]`;
}

/** Formula text for the tree; every operator parenthesised, so precedence is never in question. */
export function render(e: Expr, spell: (to: string) => string): string {
  const go = (x: Expr): string => {
    switch (x.t) {
      case 'num': return String(x.v);
      case 'str': return `"${x.v}"`;
      case 'ref': return spell(x.to);
      case 'bin': return `(${go(x.a)} ${x.op} ${go(x.b)})`;
      case 'div': return `(${go(x.a)} / ${x.k})`;
      case 'neg': return `(-${go(x.a)})`;
      case 'fn': return `${x.f}(${go(x.a)}, ${go(x.b)})`;
      case 'abs': return `abs(${go(x.a)})`;
      case 'round': return `round(${go(x.a)}, 2)`;
      case 'if': return `if(${go(x.c)}, ${go(x.a)}, ${go(x.b)})`;
      case 'cmp': return `(${go(x.a)} ${x.op} ${go(x.b)})`;
      case 'eq': return `(${go(x.a)} = "${x.s}")`;
    }
  };
  return go(e);
}

// ---------------------------------------------------------------- the oracle

export type Val = number | string;
export type Env = Map<string, Val | undefined>;

/** The tree's value with every name present; `num` the formula language's reading of a value. */
function evaluate(e: Expr, env: Env): Val {
  const num = (x: Expr) => { const v = evaluate(x, env); return typeof v === 'number' ? v : NaN; };
  const C = (b: boolean) => (b ? 1 : 0);
  switch (e.t) {
    case 'num': case 'str': return e.v;
    case 'ref': return env.get(e.to)!;
    case 'bin': { const a = num(e.a), b = num(e.b); return e.op === '+' ? a + b : e.op === '-' ? a - b : a * b; }
    case 'div': return num(e.a) / e.k;
    case 'neg': return -num(e.a);
    case 'fn': return e.f === 'min' ? Math.min(num(e.a), num(e.b)) : Math.max(num(e.a), num(e.b));
    case 'abs': return Math.abs(num(e.a));
    case 'round': return Math.round(num(e.a) * 100) / 100;
    case 'if': return num(e.c) !== 0 ? evaluate(e.a, env) : evaluate(e.b, env);
    case 'cmp': {
      const a = num(e.a), b = num(e.b);
      return C(e.op === '>' ? a > b : e.op === '<' ? a < b : e.op === '>=' ? a >= b : a <= b);
    }
    case 'eq': return C(String(evaluate(e.a, env)).toLowerCase() === e.s.toLowerCase());
  }
}

/**
 * One calculated value on one row, by the rules the help text states: a name with no value on
 * the row blanks the cell; a result that is not finite, or not the declared kind, is blank. A
 * yes / no is stored as a boolean; text is trimmed.
 */
export function oracle(e: Expr, result: CalcResult, env: Env): number | string | boolean | undefined {
  for (const n of refsOf(e)) if (env.get(n) === undefined) return undefined;
  const v = evaluate(e, env);
  if (result === 'text') return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return result === 'yesNo' ? v !== 0 : v;
}

/** What a later formula sees of a value: a yes as 1, a no as 0. */
export const asVar = (v: number | string | boolean | undefined): Val | undefined =>
  (typeof v === 'boolean' ? (v ? 1 : 0) : v);

/** The engine's value of every calculated value, row by row, by id — through `planComputed`. */
export function engineValues(store: ModelStore, def: ScheduleDef): Record<string, unknown[]> {
  const plan = planComputed(def);
  const out: Record<string, unknown[]> = Object.fromEntries((def.calculated ?? []).map((c) => [c.id, []]));
  for (let row = 0; row < store.cores.length; row++) {
    const vals = plan.compute(store, row);
    for (const c of def.calculated ?? []) out[c.id].push(vals.get(`formula:${c.id}`)?.v);
  }
  return out;
}
