// Filters and totals against an independent oracle — v1.5.0, check 2 of the Schedules safety
// net. A seeded simulation beside `simulation*.test.ts`: from a golden case, random edits the
// UI could make — weighted to filters, totals, grouping and formats, through the real pure
// actions and the simulation's own argument generators (`support/sim.ts`), plus filter values
// drawn from what the model really holds so rules bite — and after EVERY step the engine's
// output is recomputed from the raw store by `support/oracleEngine.ts`, which imports nothing
// from the engine:
//
//  · the filtered set: exactly the elements the oracle's predicate keeps (every operator,
//    `between` with either end open, `noValue`, and/or), each in exactly one data line, and
//    `matchedElements` its size; every element of a collapsed line shares that line's labels;
//  · per group footer, in the engine's own row order: its elements are a run of consecutive
//    lines with one label per sort level (the oracle's labels), its count, its label text, and
//    each totalled column's figure; the grand total over every kept element;
//  · each figure: count and count-distinct exactly; sum, average, minimum and maximum within
//    half a unit of the column's last displayed decimal (+1e-9 relative), and the TEXT exactly
//    as the oracle formats it — unit, decimals, thousands, symbol, affixes, a suppressed zero —
//    or, at a rounding boundary, as either neighbour formats.
//
// Definitions with calculated values are left out (the oracle has no formula evaluator), and so
// is any step that would add one. Replay a seed with `SIM_SEED=<n>`; `TOTALS_SEEDS` and
// `TOTALS_STEPS` make it longer.

import { describe, expect, it } from 'vitest';
import type { ModelStore } from '../../../src/schedule/ifc/store';
import * as act from '../../../src/schedule/schedule/actions';
import type { Column, FieldRef, ScheduleDef, SortLevel } from '../../../src/schedule/schedule/def';
import { runSchedule, visibleColumns, type DataRow, type FooterRow, type GrandRow } from '../../../src/schedule/schedule/engine';
import { allCases, buildStores } from './support/fixture';
import { kept, sameTotal, text, total, value } from './support/oracleEngine';
import { GENS, mulberry32, type ActionName, type Ctx, type Rng } from './support/sim';

const SEEDS = Number(process.env.TOTALS_SEEDS ?? 300);
const STEPS = Number(process.env.TOTALS_STEPS ?? 30);
const ONLY = process.env.SIM_SEED === undefined ? undefined : Number(process.env.SIM_SEED);

const stores = buildStores();
const CTX: Record<string, Ctx> = {
  metric: { store: stores.metric, system: 'metric' },
  imperial: { store: stores.imperial, system: 'imperial' },
  federation: { store: stores.federation, system: 'metric' },
};
const START = allCases().filter((c) => !(c.def.calculated ?? []).length
  && !c.def.columns.some((col) => col.field.kind === 'formula'));

/** The actions this simulation draws from, each with a weight: filters and totals first. */
const MOVES: [ActionName, number][] = [
  ['addFilterRule', 6], ['removeFilterRule', 3], ['setFilterMode', 3], ['setFilterField', 6],
  ['setFilterOp', 6], ['setFilterValue', 4], ['setFilterRange', 5], ['setFilterValues', 3],
  ['setTotal', 8], ['setColumnFormat', 5], ['addSortLevel', 4], ['removeSortLevel', 2],
  ['setSortField', 4], ['setSortDir', 2], ['setGroupOptions', 5], ['setItemize', 3], ['setGrandTotal', 3],
  ['addColumns', 3], ['removeColumn', 1], ['setHidden', 2], ['remapColumn', 2], ['moveColumn', 1],
];

/** A filter value from what the model really holds for that field, so the rule bites. */
function realValue(d: ScheduleDef, r: Rng, store: ModelStore): [number, string | number] | null {
  if (!d.filters.length) return null;
  const k = Math.floor(r() * d.filters.length);
  const rows = store.cores.map((_c, i) => i).filter((i) => d.entity.includes(store.cores[i].entity));
  if (!rows.length) return null;
  const c = value(store, rows[Math.floor(r() * rows.length)], d.filters[k].field);
  if (!c) return null;
  return [k, typeof c.v === 'boolean' ? String(c.v) : c.v];
}

/** Every element of a line, by the oracle: the label of each sort level. */
const labels = (store: ModelStore, r: number, levels: SortLevel[]) =>
  levels.map((l) => text(value(store, r, l.field)) || '(none)');

/** What the run exercised — asserted at the end, so the check cannot go quietly vacuous. */
const seenOps = new Set<string>();
const seenTotals = new Set<string>();
let footersSeen = 0;

function checkStep(store: ModelStore, def: ScheduleDef): number {
  for (const f of def.filters) {
    if (f.op !== 'between') { seenOps.add(f.op); continue; }
    const open = (x: unknown) => x === undefined || x === null || String(x).trim() === '';
    const [lo, hi] = [f.values?.[0], f.values?.[1]];
    seenOps.add(open(lo) && open(hi) ? 'between()' : open(lo) ? 'between(..hi)' : open(hi) ? 'between(lo..)' : 'between(lo..hi)');
  }
  const res = runSchedule(store, def, { cap: Infinity });
  const cols = visibleColumns(def);
  const lines = res.rows.filter((x): x is DataRow => x.kind === 'data');

  // ---- the filtered set ----
  const want = kept(store, def);
  const got = lines.flatMap((l) => l.rows);
  expect([...got].sort((a, b) => a - b), 'the filter kept other elements than the oracle').toEqual(want);
  expect(res.matchedElements).toBe(want.length);
  expect(lines.reduce((n, l) => n + l.count, 0)).toBe(want.length);

  // ---- runs of lines with one label per level ----
  const levels = def.sort;
  const keyOf = lines.map((l) => {
    const k = labels(store, l.rows[0], levels);
    for (const r of l.rows) expect(labels(store, r, levels), 'a collapsed line mixes groups').toEqual(k);
    return k;
  });
  let figures = 0;
  levels.forEach((lv, i) => {
    const style = lv.footer ?? 'none';
    const footers = res.rows.filter((x): x is FooterRow => x.kind === 'footer' && x.level === i);
    if (style === 'none') { expect(footers, `level ${i} has no footer`).toEqual([]); return; }
    // Runs at level i: consecutive lines whose labels agree on levels 0..i.
    const runs: number[][] = [];
    keyOf.forEach((k, li) => {
      const prev = li > 0 ? keyOf[li - 1] : null;
      if (prev && k.slice(0, i + 1).every((x, j) => x === prev[j])) runs[runs.length - 1].push(li);
      else runs.push([li]);
    });
    expect(footers.length, `level ${i}: one footer per run`).toBe(runs.length);
    runs.forEach((run, n) => {
      const rows = run.flatMap((li) => lines[li].rows);
      const f = footers[n];
      footersSeen++;
      expect(f.count, `level ${i} footer ${n}: count`).toBe(rows.length);
      const title = style === 'title' || style === 'titleCountTotals' ? keyOf[run[0]][i] : '';
      const count = style === 'count' || style === 'titleCountTotals' ? String(rows.length) : '';
      expect(f.label, `level ${i} footer ${n}: label`).toBe([title, count].filter(Boolean).join(': ') || 'Total');
      const totals = style === 'totals' || style === 'titleCountTotals';
      figures += compareTotals(store, f, rows, cols, totals, `level ${i} footer ${n}`);
    });
  });

  // ---- the grand total ----
  const grand = res.rows.filter((x): x is GrandRow => x.kind === 'grand');
  if (!def.grandTotal) expect(grand).toEqual([]);
  else {
    expect(grand.length).toBe(1);
    expect(grand[0].count).toBe(want.length);
    expect(grand[0].label).toBe(def.grandTotalTitle?.trim() || 'Grand total');
    figures += compareTotals(store, grand[0], got, cols, true, 'grand total');
  }
  return figures;
}

function compareTotals(
  store: ModelStore, row: FooterRow | GrandRow, rows: number[], cols: Column[], on: boolean, where: string,
): number {
  let n = 0;
  cols.forEach((c, ci) => {
    const want = on && c.total ? total(store, rows, c, c.total) : null;
    if (want) seenTotals.add(c.total!);
    const problem = sameTotal({ text: row.cells[ci], num: row.nums?.[ci] ?? null }, want, c);
    expect(problem, `${where}, column ${ci} (${c.total ?? 'no total'}): ${problem}`).toBeNull();
    if (want) n++;
  });
  return n;
}

const pickMove = (r: Rng): ActionName => {
  const sum = MOVES.reduce((s, [, w]) => s + w, 0);
  let x = r() * sum;
  for (const [name, w] of MOVES) { x -= w; if (x < 0) return name; }
  return MOVES[0][0];
};

const hasFormula = (d: ScheduleDef) => (d.calculated ?? []).length > 0
  || d.columns.some((c) => c.field.kind === 'formula')
  || [...d.filters, ...d.sort].some((x) => (x.field as FieldRef).kind === 'formula');

export function runSeed(seed: number) {
  const r = mulberry32(seed * 104729 + 7);
  const start = START[Math.floor(r() * START.length)];
  const ctx = CTX[start.store];
  let def = structuredClone(start.def);
  const log: { name: string; args: unknown }[] = [];
  let figures = 0;
  try {
    figures += checkStep(ctx.store, def);
    for (let s = 0; s < STEPS; s++) {
      let next: ScheduleDef | null = null;
      for (let tries = 0; tries < 20 && !next; tries++) {
        const between = def.filters.map((f, k) => (f.op === 'between' ? k : -1)).filter((k) => k >= 0);
        if (between.length && r() < 0.1) {
          // The user clears one box of a range: that end is open (the filter box's own write).
          const k = between[Math.floor(r() * between.length)];
          const slot = r() < 0.5 ? 0 : 1;
          log.push({ name: 'setFilterRange(clear)', args: [k, slot] });
          next = act.setFilterRange(def, k, slot, undefined);
          break;
        }
        if (r() < 0.15) {
          const v = realValue(def, r, ctx.store);
          if (!v) continue;
          log.push({ name: 'setFilterValue(real)', args: v });
          next = act.setFilterValue(def, v[0], v[1]);
          break;
        }
        const name = pickMove(r);
        const args = GENS[name](def, r, ctx);
        if (args === null) continue;
        const cand = (act[name] as (d: ScheduleDef, ...a: unknown[]) => ScheduleDef)(def, ...args);
        if (hasFormula(cand)) continue;
        log.push({ name, args });
        next = cand;
      }
      if (next) def = next;
      figures += checkStep(ctx.store, def);
    }
  } catch (e) {
    throw new Error(`SIM_SEED=${seed} (start: ${start.id}) failed after ${log.length} actions: `
      + `${e instanceof Error ? e.message : String(e)}\nactions: ${JSON.stringify(log)}`);
  }
  return figures;
}

describe('filters and totals against the independent oracle', () => {
  it('starts from every golden case without a calculated value', () => {
    expect(START.length).toBeGreaterThan(30);
  });

  const seeds = ONLY !== undefined ? [ONLY] : Array.from({ length: SEEDS }, (_, i) => i + 1);
  it(`${seeds.length} seed(s) × ${STEPS} steps: kept set, group runs and every total agree`, () => {
    let figures = 0;
    for (const seed of seeds) figures += runSeed(seed);
    process.stderr.write(`[totals oracle] ${seeds.length} seeds × ${STEPS} steps, ${footersSeen} footers, `
      + `${figures} totals compared; operators: ${[...seenOps].sort().join(' ')}\n`);
    expect(figures).toBeGreaterThan(0);
    if (ONLY === undefined) {
      expect([...seenOps].sort()).toEqual(['!=', '<', '<=', '=', '>', '>=', 'between()', 'between(..hi)',
        'between(lo..)', 'between(lo..hi)', 'contains', 'endsWith', 'hasValue', 'in', 'noValue', 'startsWith'].sort());
      expect([...seenTotals].sort()).toEqual(['avg', 'count', 'countDistinct', 'max', 'min', 'sum']);
    }
  }, 300_000);
});
