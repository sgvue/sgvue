// How much of a category actually carries each field — the number behind every coverage
// bar, the "0 values" badge and the template fit score — and, in the SAME pass, what the
// commonest values of each field are, for the field picker's detail strip.
//
// Built in ONE pass over the scheduled category and cached per repaint. That matters: the
// old per-column `countPopulated` scan cost 41 ms for twenty wildcard columns on the
// reference model, and this replaces it with a single ~4 ms sweep that answers for every
// field at once.
//
// Ported from ifcTable's `ui/coverage.ts` — 2026-09-25, then its 2026-11-05 rewrite for SGVue
// v1.5.0 (phase 2): the value tallies the field picker's detail strip reads, the per-category
// cache, and placeholders ('-', '—', 'n/a', 'none', blank) counted as no value.

import type { ModelStore } from '../../schedule/ifc/store';
import type { Cell, UnitKind } from '../../schedule/ifc/types';
import type { UnitSystem } from '../../schedule/ifc/units';
import { CORE_KEYS, type CoreKey, type FieldRef } from '../../schedule/schedule/def';
import { defaultDecimals, defaultUnit, formatCell } from '../../schedule/schedule/format';
import { ANY_PSET } from '../../schedule/schedule/resolve';

/**
 * Distinct values tallied per field. Past the cap new values are not tracked (the ones
 * already tracked keep counting), so memory is bounded at fields × SAMPLE_CAP — and a field
 * that hit it is one with many different values, which is itself worth saying.
 */
export const SAMPLE_CAP = 50;

type Raw = string | number | boolean;
/** One field's values, raw — formatted only when the strip is drawn (`valuesOf`). */
export interface Tally {
  counts: Map<Raw, number>;
  /** The unit kind of the field's numbers, from its first cell. */
  k?: UnitKind;
  capped: boolean;
  /** Over EVERY numeric value, tracked or not — what a capped number field shows. */
  min: number;
  max: number;
}

export interface Coverage {
  /** Elements in the scheduled category. */
  total: number;
  /** Uppercased 'PSET.PROP' → how many elements carry it. */
  byKey: Map<string, number>;
  /** Uppercased property name, across every pset → how many elements carry it. */
  byProp: Map<string, number>;
  byCore: Map<CoreKey, number>;
  /** Exact 'Pset.Prop' key (as stored) → its values. */
  tallies: Map<string, Tally>;
  coreTallies: Map<CoreKey, Tally>;
}

/**
 * Placeholder text an author typed for "nothing" (owner decision, 2026-11-05). Wherever
 * coverage is counted it is NO value: the percentage, the empty-field rules, the samples.
 * Coverage only — the engine, filters and exports still see the text as written.
 */
const NO_VALUE = new Set(['', '-', '—', 'n/a', 'none']);
export const isNoValue = (v: unknown): boolean => typeof v === 'string' && NO_VALUE.has(v.trim().toLowerCase());

const newTally = (k?: UnitKind): Tally => ({ counts: new Map(), k, capped: false, min: Infinity, max: -Infinity });

function tally(t: Tally, v: Raw) {
  if (typeof v === 'number') { if (v < t.min) t.min = v; if (v > t.max) t.max = v; }
  const n = t.counts.get(v);
  if (n !== undefined) t.counts.set(v, n + 1);
  else if (t.counts.size < SAMPLE_CAP) t.counts.set(v, 1);
  else t.capped = true;
}

const bump = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);

/**
 * Coverage depends on the model and the category alone — never on the schedule — so it is
 * built once per category and reused by every repaint until either changes.
 */
let memo: { store: ModelStore; key: string; cov: Coverage } | null = null;

/** Let go of the closed model: the cache would otherwise keep it, and its tallies, alive. */
export function clearCoverageCache() { memo = null; }

export function buildCoverage(store: ModelStore, entities: string[]): Coverage {
  const key = entities.join('|');
  if (memo?.store === store && memo.key === key) return memo.cov;
  const cov = sweep(store, entities);
  memo = { store, key, cov };
  return cov;
}

function sweep(store: ModelStore, entities: string[]): Coverage {
  const tallies = new Map<string, Tally>();
  const coreTallies = new Map<CoreKey, Tally>();
  const byKey = new Map<string, number>();
  const byProp = new Map<string, number>();
  const byCore = new Map<CoreKey, number>();
  let total = 0;

  for (const entity of entities) {
    for (const r of store.byEntity.get(entity) ?? []) {
      total++;
      const cells = store.cells[r];
      // One element can carry the same property name in two psets; a wildcard column
      // resolves to exactly one of them, so it must count once.
      const seen = new Set<string>();
      for (const key in cells) {
        const cell = cells[key];
        // The field is still listed (its tally exists), but a placeholder is not a value.
        let t = tallies.get(key);
        if (!t) { t = newTally(cell.k); tallies.set(key, t); }
        if (isNoValue(cell.v)) continue;
        const dot = key.indexOf('.');
        bump(byKey, key.toUpperCase());
        const prop = (dot > 0 ? key.slice(dot + 1) : key).toUpperCase();
        if (!seen.has(prop)) { seen.add(prop); bump(byProp, prop); }
        tally(t, cell.v);
      }
      const core = store.cores[r];
      for (const k of CORE_KEYS) {
        const v = core[k];
        if (v === null || v === undefined || isNoValue(v)) continue;
        bump(byCore, k);
        let t = coreTallies.get(k);
        if (!t) { t = newTally(k === 'storeyElevation' ? 'length' : undefined); coreTallies.set(k, t); }
        tally(t, v as Raw);
      }
    }
  }
  return { total, byKey, byProp, byCore, tallies, coreTallies };
}

/** The tally behind a field: its exact key, or (for a wildcard) the first pset holding a real
 *  value for it — a pset that holds only placeholders must not hide one that has values. */
function tallyOf(cov: Coverage, field: FieldRef): Tally | undefined {
  if (field.kind === 'core') return cov.coreTallies.get(field.key);
  if (field.kind !== 'prop') return undefined;
  if (field.pset !== ANY_PSET) return cov.tallies.get(`${field.pset}.${field.prop}`);
  const want = field.prop.toUpperCase();
  let first: Tally | undefined;
  for (const [k, t] of cov.tallies) {
    if (k.slice(k.indexOf('.') + 1).toUpperCase() !== want) continue;
    if (t.counts.size) return t;
    first ??= t;
  }
  return first;
}

/** What a field holds, for the picker's detail strip — formatted as the table shows it. */
export interface Values {
  /** Its commonest values, at most three, in the model's default unit. */
  top: string[];
  /** Distinct values not in `top` — a floor when `capped`. */
  more: number;
  capped: boolean;
  /** "600 – 3,200 mm" for a number field with more than one value, else ''. */
  range: string;
}

/**
 * The commonest values, and for a NUMBER field its full range (over every value, tracked or
 * not). A number field that hit the cap gives no top three: three of fifty is no picture of
 * it, the range is. Null when the field holds nothing.
 */
export function valuesOf(cov: Coverage, field: FieldRef, system: UnitSystem): Values | null {
  const t = tallyOf(cov, field);
  if (!t || !t.counts.size) return null;
  const kind = t.k ?? 'none';
  const f = { display: defaultUnit(kind, system) || undefined, decimals: defaultDecimals(kind, system) };
  const show = (v: Raw) => formatCell({ v, k: t.k } as Cell, f);
  const unit = f.display ? ` ${f.display}` : '';
  const numeric = Number.isFinite(t.min);
  // Raw values that print the same (2.0001 and 2.0002 m at 2 dp) are one value to a reader.
  const merged = new Map<string, number>();
  for (const [v, n] of t.counts) {
    const s = show(v);
    if (s) merged.set(s, (merged.get(s) ?? 0) + n);
  }
  const range = numeric && t.min !== t.max ? `${show(t.min)} – ${show(t.max)}${unit}` : '';
  if (numeric && t.capped) return { top: [], more: 0, capped: true, range };
  const top = [...merged].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3)
    .map(([s]) => (numeric ? `${s}${unit}` : s));
  return { top, more: merged.size - top.length, capped: t.capped, range: merged.size > 3 ? range : '' };
}

/** How many elements this field resolves on. */
export function populated(cov: Coverage, field: FieldRef): number {
  switch (field.kind) {
    case 'core': return cov.byCore.get(field.key) ?? 0;
    case 'prop': return field.pset === ANY_PSET
      ? cov.byProp.get(field.prop.toUpperCase()) ?? 0
      : cov.byKey.get(`${field.pset}.${field.prop}`.toUpperCase()) ?? 0;
    // A formula computes for every row; whether it produces a value is the formula's business.
    case 'formula': return cov.total;
  }
}

/** 0…1. An empty category reads as 0 rather than dividing by zero. */
export function fraction(cov: Coverage, field: FieldRef): number {
  return cov.total ? populated(cov, field) / cov.total : 0;
}

/** ok above 90%, warn below, and a distinct state for "nothing at all". */
export function coverClass(f: number): string {
  return f === 0 ? 'none' : f > 0.9 ? '' : 'mid';
}

export function coverBar(f: number): string {
  const cls = coverClass(f);
  return `<span class="bar"><i${cls ? ` class="${cls}"` : ''} style="width:${Math.round(f * 100)}%"></i></span>`;
}
