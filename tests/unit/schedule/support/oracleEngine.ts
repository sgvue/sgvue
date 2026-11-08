// An independent oracle for the schedule engine's filters and totals — v1.5.0, check 2 of the
// Schedules safety net. Nothing here is imported from `src/schedule/schedule/`: every rule is
// written out again, from what the engine's own headers DOCUMENT, against the raw store
// (`ModelStore.cores` and `.cells`), so a defect in `resolve.ts`, `compare.ts`, `format.ts`
// or the engine's aggregation cannot hide by being asked about itself.
//
// What it covers: core and property fields (exact pset, case-insensitive fallback, and `*` —
// SGPset* before Pset_* before others before Qto_*, ties alphabetically); every filter
// operator, `between` with open ends and `noValue` (the schedule's "has no value", what the
// main window's rule grammar calls `absent`); the six totals; and display text — unit
// conversion, decimals, `-0` cleared, thousands, symbol, affixes, `suppressZero`, yes/no
// styles. Calculated (formula) fields are not modelled: a definition carrying one is not given
// to this oracle.

import type { ModelStore } from '../../../../src/schedule/ifc/store';
import type { Cell, UnitKind } from '../../../../src/schedule/ifc/types';
import type { Column, FieldRef, FilterRule, ScheduleDef, TotalKind, UnitFormat } from '../../../../src/schedule/schedule/def';

/* ───────────────────────────── reading a field ───────────────────────────── */

const pRank = (pset: string): number => {
  const u = pset.toUpperCase();
  return u.startsWith('SGPSET') ? 0 : u.startsWith('PSET_') ? 1 : u.startsWith('QTO_') ? 3 : 2;
};

/** The raw value of `field` on store row `r`, or undefined when it has none. */
export function value(store: ModelStore, r: number, field: FieldRef): Cell | undefined {
  if (field.kind === 'formula') throw new Error('the oracle does not evaluate formulas');
  if (field.kind === 'core') {
    const v = (store.cores[r] as unknown as Record<string, unknown>)[field.key];
    if (v === undefined || v === null || v === '') return undefined;
    return field.key === 'storeyElevation' ? { v: v as number, k: 'length' } : { v: String(v) };
  }
  const cells = store.cells[r];
  const keys = Object.keys(cells);
  const prop = field.prop.toUpperCase();
  if (field.pset === '*') {
    const hits = keys.filter((k) => k.includes('.') && k.slice(k.indexOf('.') + 1).toUpperCase() === prop)
      .sort((a, b) => pRank(a.slice(0, a.indexOf('.'))) - pRank(b.slice(0, b.indexOf('.'))) || (a < b ? -1 : a > b ? 1 : 0));
    return hits.length ? cells[hits[0]] : undefined;
  }
  if (cells[`${field.pset}.${field.prop}`] !== undefined) return cells[`${field.pset}.${field.prop}`];
  const pset = field.pset.toUpperCase();
  const k = keys.find((x) => x.includes('.') && x.slice(0, x.indexOf('.')).toUpperCase() === pset
    && x.slice(x.indexOf('.') + 1).toUpperCase() === prop);
  return k === undefined ? undefined : cells[k];
}

/** A cell as a number: a number, a yes/no as 1/0, or the first number written in its text. */
export function num(c: Cell | undefined): number | null {
  if (!c) return null;
  if (typeof c.v === 'number') return c.v;
  if (typeof c.v === 'boolean') return c.v ? 1 : 0;
  const m = /-?\d+(?:\.\d+)?/.exec(c.v.split(',').join(''));
  return m ? Number(m[0]) : null;
}

const asText = (c: Cell): string => String(c.v);
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

/* ───────────────────────────── the filter ───────────────────────────── */

/** An end of a `between` range: blank, null or not a number is an open end. */
const bound = (x: unknown): number | null => {
  if (x === undefined || x === null || String(x).trim() === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

export function keeps(c: Cell | undefined, f: FilterRule): boolean {
  const present = c !== undefined && c.v !== '';
  if (f.op === 'hasValue') return present;
  if (f.op === 'noValue') return !present;
  if (f.op === 'between') {
    const lo = bound(f.values?.[0]);
    const hi = bound(f.values?.[1]);
    if (lo === null && hi === null) return true;
    const n = num(c);
    if (n === null) return false;
    if (lo === null) return n <= hi!;
    if (hi === null) return n >= lo;
    return lo <= hi ? n >= lo && n <= hi : n >= hi && n <= lo;
  }
  if (c === undefined) return false;
  switch (f.op) {
    case 'in': return (f.values ?? []).some((x) => norm(x) === norm(asText(c)));
    case '>': case '>=': case '<': case '<=': {
      const a = num(c);
      const b = typeof f.value === 'number' ? f.value : num({ v: String(f.value ?? '') });
      if (a === null || b === null) return false;
      return f.op === '>' ? a > b : f.op === '>=' ? a >= b : f.op === '<' ? a < b : a <= b;
    }
    case '=': case '!=': {
      let same: boolean;
      if (typeof c.v === 'boolean') same = c.v === ['true', 'yes', 'y', '1'].includes(norm(f.value));
      else if (typeof c.v === 'number') {
        const b = typeof f.value === 'number' ? f.value : num({ v: String(f.value ?? '') });
        same = b !== null && Math.abs(c.v - b) < 1e-9;
      } else same = norm(c.v) === norm(f.value);
      return f.op === '=' ? same : !same;
    }
    case 'contains': return asText(c).toLowerCase().includes(String(f.value ?? '').toLowerCase());
    case 'startsWith': return asText(c).toLowerCase().startsWith(String(f.value ?? '').toLowerCase());
    case 'endsWith': return asText(c).toLowerCase().endsWith(String(f.value ?? '').toLowerCase());
  }
  throw new Error(`unknown operator ${String(f.op)}`);
}

/** The store rows a definition keeps, in store order — from `cores[r].entity`, not `byEntity`. */
export function kept(store: ModelStore, def: ScheduleDef): number[] {
  const out: number[] = [];
  store.cores.forEach((core, r) => {
    if (!def.entity.includes(core.entity)) return;
    if (!def.filters.length) { out.push(r); return; }
    const hits = def.filters.map((f) => keeps(value(store, r, f.field), f));
    if ((def.filterLogic ?? 'and') === 'or' ? hits.includes(true) : !hits.includes(false)) out.push(r);
  });
  return out;
}

/* ───────────────────────────── display text ───────────────────────────── */

/** How many SI units one display unit is — written out here, not read from format.ts. */
const SI: Record<string, Record<string, number>> = {
  length: { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048 },
  area: { 'mm²': 1e-6, 'cm²': 1e-4, 'm²': 1, 'ft²': 0.3048 * 0.3048, ha: 10000 },
  volume: { 'mm³': 1e-9, 'cm³': 1e-6, L: 0.001, 'm³': 1, 'ft³': 0.3048 ** 3 },
  angle: { rad: 1, '°': Math.PI / 180 },
  mass: { g: 0.001, kg: 1, t: 1000, lb: 0.45359237 },
};
/** A column with no unit of its own shows the metric default — whatever the model's system. */
const UNIT: Record<UnitKind, string> = { length: 'mm', area: 'm²', volume: 'm³', angle: '°', mass: 'kg', count: '', none: '' };
const DECIMALS: Record<UnitKind, number> = { length: 0, area: 2, volume: 2, angle: 1, mass: 2, count: 0, none: 2 };
const YESNO: Record<string, [string, string]> = {
  'Yes/No': ['Yes', 'No'], 'TRUE/FALSE': ['TRUE', 'FALSE'], 'Y/N': ['Y', 'N'], '✓/✗': ['✓', '✗'],
};

export const decimalsOf = (kind: UnitKind | undefined, f: UnitFormat = {}) =>
  Math.min(6, Math.max(0, f.decimals ?? DECIMALS[kind ?? 'none']));

/** The number a column shows for an SI value, unrounded — null when it shows nothing. */
export function shown(v: number, kind: UnitKind | undefined, f: UnitFormat = {}): number | null {
  if (!Number.isFinite(v)) return null;
  const k = kind ?? 'none';
  const per = k === 'none' || k === 'count' ? undefined : SI[k]?.[f.display || UNIT[k]];
  const x = per ? v / per : v;
  if (!Number.isFinite(x)) return null;
  if (f.suppressZero && x === 0) return null;
  return x;
}

export function numberText(v: number, kind: UnitKind | undefined, f: UnitFormat = {}): string {
  const x = shown(v, kind, f);
  return x === null ? '' : shownText(x, kind, f);
}

/** The text for a figure already in the column's display unit: rounded, grouped, decorated. */
function shownText(x: number, kind: UnitKind | undefined, f: UnitFormat): string {
  let s = x.toFixed(decimalsOf(kind, f));
  if (/^-0(\.0+)?$/.test(s)) s = s.slice(1);
  if (f.thousands !== false) {
    const [i, d] = s.split('.');
    const neg = i.startsWith('-');
    const digits = neg ? i.slice(1) : i;
    let g = '';
    for (let n = 0; n < digits.length; n++) {
      if (n > 0 && (digits.length - n) % 3 === 0) g += ',';
      g += digits[n];
    }
    s = (neg ? '-' : '') + g + (d === undefined ? '' : `.${d}`);
  }
  const unit = f.showSymbol ? (f.display || UNIT[kind ?? 'none']) : '';
  if (unit) s += ` ${unit}`;
  return (f.prefix ?? '') + s + (f.suffix ?? '');
}

export function text(c: Cell | undefined, f: UnitFormat = {}): string {
  if (c === undefined || c.v === '' || c.v === null) return '';
  if (typeof c.v === 'boolean') return YESNO[f.boolStyle ?? 'Yes/No'][c.v ? 0 : 1];
  if (typeof c.v === 'number') return numberText(c.v, c.k, f);
  return (f.prefix ?? '') + c.v + (f.suffix ?? '');
}

/* ───────────────────────────── totals ───────────────────────────── */

export interface Total {
  /** The figure before rounding, in the column's display unit (or the count). */
  exact: number;
  kind: UnitKind | undefined;
  /** What the cell should read. */
  text: string;
  /** For the tolerance: a count is exact, everything else is rounded to the column's decimals. */
  counted: boolean;
}

/** One column's total over `rows` (in the order given), or null when it has no figure. */
export function total(store: ModelStore, rows: number[], col: Column, how: TotalKind): Total | null {
  const f = col.format ?? {};
  if (how === 'count') return { exact: rows.length, kind: undefined, text: String(rows.length), counted: true };
  const cells = rows.map((r) => value(store, r, col.field));
  if (how === 'countDistinct') {
    const n = new Set(cells.map((c) => text(c, f))).size;
    return { exact: n, kind: undefined, text: String(n), counted: true };
  }
  const nums = cells.map(num).filter((x): x is number => x !== null);
  if (!nums.length) return null;
  const kind = cells.find((c) => c?.k)?.k;
  let v: number;
  if (how === 'sum') v = nums.reduce((a, b) => a + b, 0);
  else if (how === 'avg') v = nums.reduce((a, b) => a + b, 0) / nums.length;
  else if (how === 'min') v = nums.reduce((a, b) => Math.min(a, b));
  else v = nums.reduce((a, b) => Math.max(a, b));
  const x = shown(v, kind, f);
  return { exact: x ?? NaN, kind, text: numberText(v, kind, f), counted: false };
}

/**
 * Whether `got` (the engine's text and displayed number) is `want`: the number within half a
 * unit of the column's last decimal (plus 1e-9 relative, for summation order), and the text
 * exactly — or, when the exact figure sits within that same 1e-9 of a rounding boundary, the
 * text either neighbour rounds to.
 */
export function sameTotal(
  got: { text: string | null; num: number | null }, want: Total | null, col: Column,
): string | null {
  if (want === null) return got.text === null ? null : `expected no total, got "${got.text}"`;
  if (got.text === null) return `expected "${want.text}", got no total`;
  if (want.counted) return got.text === want.text && got.num === want.exact ? null : `expected ${want.text}, got ${got.text}`;
  const f = col.format ?? {};
  if (Number.isNaN(want.exact)) return got.text === '' ? null : `expected blank, got "${got.text}"`;
  const tol = 0.5 * 10 ** -decimalsOf(want.kind, f) + 1e-9 * Math.max(1, Math.abs(want.exact));
  if (got.num === null || Math.abs(got.num - want.exact) > tol) return `number ${got.num} is not ${want.exact} ± ${tol}`;
  if (got.text === want.text) return null;
  // At a rounding boundary either side is right: the figure nudged by that same 1e-9.
  const eps = 1e-9 * Math.max(1, Math.abs(want.exact));
  for (const d of [-eps, eps]) if (got.text === shownText(want.exact + d, want.kind, f)) return null;
  return `text "${got.text}" is not "${want.text}"`;
}
