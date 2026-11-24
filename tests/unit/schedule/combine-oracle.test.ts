// Combine by sort value shows the data correctly, always (owner requirement 2026-11-24, "make
// sure the data always shown correctly"; checks written before the build).
//
// The rule for a combined row's cell, as amended on 2026-11-24 — no cell shows one member's
// value on trust:
//   a. the column has a total AND its field is not a sort level → that total over the members;
//   b. else every member's cell AS DISPLAYED in the column's format is identical → that text;
//   c. else `<varies>`, `mixed[i]` true, `nums[i]` null. Blank beside a value disagrees; all
//      blank stays blank.
// One row per distinct tuple of sort labels, placed where the tuple first appears in sorted
// order; `filled[i]` counts the members whose displayed cell is not blank.
//
//   A. every element exactly once;
//   B. totals for every kind, the grand total and the footers;
//   C. an independent oracle over seeded random schedules — it reads only the itemised run and
//      each element's sort labels, never a `combine` run and never the engine's collapse code;
//   D. selection, filters, colour rules, order and exports act on what is seen;
//   F. with the mode off nothing moves.
// E (Vee reads it truthfully) is in `assistant-combine.test.ts`.

import { describe, expect, it } from 'vitest';
import { StoreBuilder, type ModelStore } from '../../../src/schedule/ifc/store';
import type { Cell, ElemCore, ModelMeta } from '../../../src/schedule/ifc/types';
import {
  emptySchedule, fieldKey, type Calculated, type Column, type FieldRef, type ScheduleDef, type SortLevel, type TotalKind,
} from '../../../src/schedule/schedule/def';
import { runSchedule, type DataRow, type FooterRow, type GrandRow, type ScheduleResult } from '../../../src/schedule/schedule/engine';
import { formatCell } from '../../../src/schedule/schedule/format';
import { resolveField } from '../../../src/schedule/schedule/resolve';
import { fullResult, toRows } from '../../../src/schedule/export/rows';
import { xlsxBlob } from '../../../src/schedule/export/xlsx';
import { buildCoverage } from '../../../src/renderer/schedule-ui/coverage';
import { markedRows, rangeElements, rowOfElement } from '../../../src/renderer/schedule-ui/selection';
import { state as blankState, type AppState } from '../../../src/renderer/schedule-ui/state';
import { renderSchedule } from '../../../src/renderer/schedule-ui/tableView';

const V = '<varies>';
const meta: ModelMeta = {
  fileName: 'f.ifc', schema: 'IFC4', projectName: '', authoringTool: '',
  lengthUnit: 'mm', unitSystem: 'metric', elementCount: 0, parseMs: 0,
};

/* ────────────────────────────── stores ────────────────────────────── */

interface Spec { type: string; storey: string; elev: number; mark: string; cells: Record<string, Cell> }

function storeOf(specs: Spec[]): ModelStore {
  const b = new StoreBuilder();
  const cores: ElemCore[] = specs.map((s, i) => ({
    entity: 'IfcDoor', name: `E${i}`, description: '', mark: s.mark, typeName: s.type, family: 'F',
    objectType: '', predefinedType: 'DOOR', guid: `g${i}`, storey: s.storey, storeyElevation: s.elev,
    building: '', site: '', space: '', material: '', discipline: 'ARC',
  }));
  b.add(cores, specs.map((s) => s.cells));
  return b.finish(meta);
}

// The prototype's 16 made-up doors: [type, level, width mm, height mm, fire rating].
const DOOR_ROWS: [string, string, number, number, string][] = [
  ['D01 Timber single', 'Level 1', 900, 2100, 'None'], ['D01 Timber single', 'Level 1', 900, 2100, 'None'],
  ['D01 Timber single', 'Level 1', 1000, 2100, 'None'], ['D01 Timber single', 'Level 2', 900, 2100, 'None'],
  ['D01 Timber single', 'Level 2', 900, 2100, '½ hr'], ['D01 Timber single', 'Level 2', 1000, 2100, 'None'],
  ['D02 Timber double', 'Level 1', 1800, 2100, '1 hr'], ['D02 Timber double', 'Level 1', 1800, 2100, '1 hr'],
  ['D02 Timber double', 'Level 2', 1800, 2400, '1 hr'], ['D02 Timber double', 'Level 2', 1800, 2400, '1 hr'],
  ['D03 Glass sliding', 'Level 1', 2400, 2100, 'None'], ['D03 Glass sliding', 'Level 1', 2400, 2100, 'None'],
  ['D03 Glass sliding', 'Level 2', 2400, 2100, 'None'],
  ['D04 Steel fire door', 'Level 1', 1000, 2100, '2 hr'], ['D04 Steel fire door', 'Level 1', 1000, 2100, '2 hr'],
  ['D04 Steel fire door', 'Level 1', 1000, 2100, '2 hr'],
];
const DOOR_SPECS: Spec[] = DOOR_ROWS.map(([type, storey, w, h, fire], i) => ({
  type, storey, elev: storey === 'Level 1' ? 0 : 3.5, mark: String(i),
  cells: {
    'Pset_DoorCommon.Width': { v: w / 1000, k: 'length' },
    'Pset_DoorCommon.Height': { v: h / 1000, k: 'length' },
    'Pset_DoorCommon.FireRating': { v: fire },
    'Qto_DoorBaseQuantities.Area': { v: (w * h) / 1e6, k: 'area' },
  },
}));
const doorStore = storeOf(DOOR_SPECS);

const TYPE: FieldRef = { kind: 'core', key: 'typeName' };
const LEVEL: FieldRef = { kind: 'core', key: 'storey' };
const WIDTH: FieldRef = { kind: 'prop', pset: 'Pset_DoorCommon', prop: 'Width' };
const HEIGHT: FieldRef = { kind: 'prop', pset: 'Pset_DoorCommon', prop: 'Height' };
const FIRE: FieldRef = { kind: 'prop', pset: 'Pset_DoorCommon', prop: 'FireRating' };
const AREA: FieldRef = { kind: 'prop', pset: 'Qto_DoorBaseQuantities', prop: 'Area' };
const mm = { display: 'mm', decimals: 0 };
const doorCols = (over: Partial<Record<'area' | 'width' | 'type', Partial<Column>>> = {}): Column[] => [
  { field: TYPE, ...over.type }, { field: LEVEL }, { field: WIDTH, format: mm, ...over.width },
  { field: HEIGHT, format: mm }, { field: FIRE, heading: 'Fire rating' }, { field: AREA, heading: 'Area', total: 'sum', ...over.area },
];
const BY_TYPE: SortLevel[] = [{ field: TYPE, dir: 'asc' }];
const BY_LEVEL_TYPE: SortLevel[] = [{ field: LEVEL, dir: 'asc' }, { field: TYPE, dir: 'asc' }];

/** `combine` is what the build adds to `ScheduleDef`; cast so the checks compile before it. */
const combined = (def: ScheduleDef): ScheduleDef => ({ ...def, itemize: false, combine: 'sort' }) as ScheduleDef;
const doorDef = (sort: SortLevel[], over: Partial<ScheduleDef> = {}): ScheduleDef =>
  combined({ ...emptySchedule('Door schedule', ['IfcDoor']), columns: doorCols(), sort, ...over });

type Combined = DataRow & { mixed?: boolean[]; filled?: number[] };
const dataOf = (res: ScheduleResult) => res.rows.filter((r) => r.kind === 'data') as Combined[];
const footersOf = (res: ScheduleResult) => res.rows.filter((r) => r.kind === 'footer') as FooterRow[];
const grandOf = (res: ScheduleResult) => res.rows.find((r) => r.kind === 'grand') as GrandRow | undefined;
const all = { cap: Infinity };
const sorted = (xs: readonly number[]) => [...xs].sort((a, b) => a - b);

/* ────────────────────────────── the oracle ────────────────────────────── */

interface Want { members: number[]; cells: string[]; mixed: boolean[]; nums: (number | null)[]; filled: number[] }

/**
 * The expected combined table, from the itemised run alone (same definition, `itemize: true`)
 * and each element's sort labels. Totals come from a trusted path: the grand-total row of an
 * itemised run over a store of only that row's elements. (No percentage-of-total calculated
 * column is generated: its value depends on the whole set, so that path could not judge it.)
 */
function oracle(specs: Spec[], store: ModelStore, def: ScheduleDef): Want[] {
  const plain: ScheduleDef = { ...def, itemize: true };
  delete (plain as { combine?: unknown }).combine;
  const item = runSchedule(store, plain, all);
  const lines = dataOf(item);
  const sortKeys = new Set(def.sort.map((l) => fieldKey(l.field)));
  const groups = new Map<string, Combined[]>();
  for (const line of lines) {
    const r = line.rows[0];
    const labels = JSON.stringify(def.sort.map((l) => formatCell(resolveField(store, r, l.field))));
    const g = groups.get(labels);
    if (g) g.push(line); else groups.set(labels, [line]);
  }
  return [...groups.values()].map((ms) => {
    const members = ms.map((m) => m.rows[0]);
    let grand: GrandRow | undefined;
    const totalOf = () => {
      if (!grand) {
        const sub = storeOf(members.map((r) => specs[r]));
        grand = grandOf(runSchedule(sub, { ...plain, filters: [], grandTotal: true }, all))!;
      }
      return grand;
    };
    const cells: string[] = [];
    const nums: (number | null)[] = [];
    const mixed: boolean[] = [];
    const filled: number[] = [];
    item.columns.forEach((col, i) => {
      filled.push(ms.filter((m) => m.cells[i] !== '').length);
      if (col.total && !sortKeys.has(fieldKey(col.field))) {
        const g = totalOf();
        cells.push(g.cells[i] ?? ''); nums.push(g.nums?.[i] ?? null); mixed.push(false);
        return;
      }
      const first = ms[0].cells[i];
      if (ms.every((m) => m.cells[i] === first)) {
        cells.push(first); nums.push(ms[0].nums?.[i] ?? null); mixed.push(false);
      } else {
        cells.push(V); nums.push(null); mixed.push(true);
      }
    });
    return { members: sorted(members), cells, mixed, nums, filled };
  });
}

/** What the engine made of the same definition, in the oracle's shape. */
const actualOf = (res: ScheduleResult): Want[] => dataOf(res).map((l) => ({
  members: sorted(l.rows), cells: l.cells, mixed: l.mixed ?? l.cells.map(() => false),
  nums: l.nums ?? l.cells.map(() => null), filled: l.filled ?? [],
}));

/** Whether every prefix of sort labels sits in one contiguous run of the itemised table. */
function contiguous(store: ModelStore, def: ScheduleDef): boolean {
  const item = dataOf(runSchedule(store, { ...def, itemize: true }, all));
  for (let j = 1; j <= def.sort.length; j++) {
    const seen = new Set<string>();
    let prev: string | null = null;
    for (const line of item) {
      const key = JSON.stringify(def.sort.slice(0, j).map((l) => formatCell(resolveField(store, line.rows[0], l.field))));
      if (key !== prev) {
        if (seen.has(key)) return false;
        seen.add(key);
        prev = key;
      }
    }
  }
  return true;
}

/* ────────────────────────────── seeded randomness ────────────────────────────── */

/** Deterministic, so a failure is reproducible and a green run means something. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Gen {
  constructor(readonly rnd: () => number) {}
  int(lo: number, hi: number): number { return lo + Math.floor(this.rnd() * (hi - lo + 1)); }
  bool(p = 0.5): boolean { return this.rnd() < p; }
  pick<T>(xs: readonly T[]): T { return xs[this.int(0, xs.length - 1)]; }
  maybe<T>(p: number, f: () => T): T | undefined { return this.bool(p) ? f() : undefined; }
  shuffle<T>(xs: readonly T[]): T[] {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) { const j = this.int(0, i); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  }
}

const P = (prop: string): FieldRef => ({ kind: 'prop', pset: 'P', prop });
const F = {
  type: TYPE, storey: LEVEL, mark: { kind: 'core', key: 'mark' } as FieldRef,
  len: P('Len'), area: P('Area'), num: P('Num'), txt: P('Txt'), flag: P('Flag'),
  twice: { kind: 'formula', id: 'c1' } as FieldRef, plus: { kind: 'formula', id: 'c2' } as FieldRef,
};
type Key = keyof typeof F;
const NUMERIC: Key[] = ['len', 'area', 'num', 'twice', 'plus'];
const STOREYS: [string, number][] = [['L1', 0], ['L2', 3], ['L3', 6]];
// A user's calculated column and one Vee made (`by: 'vee'`, the 2026-11-24 mark).
const CALCULATED = [
  { id: 'c1', name: 'Twice', kind: 'formula', formula: 'Len * 2' },
  { id: 'c2', name: 'Plus', kind: 'formula', formula: 'Num + 1', by: 'vee', note: 'One more than Num.' },
] as unknown as Calculated[];

function genSpecs(g: Gen): Spec[] {
  return Array.from({ length: g.int(0, 24) }, () => {
    const [storey, elev] = g.pick(STOREYS);
    const cells: Record<string, Cell> = {};
    const put = (k: string, c: Cell | undefined) => { if (c) cells[k] = c; };
    put('P.Len', g.maybe(0.8, () => ({ v: g.pick([0.9, 0.9004, 1.2, 1.25, 2.4]), k: 'length' as const })));
    put('P.Area', g.maybe(0.8, () => ({ v: g.pick([1.5, 2.25, 2.254, 0.004, 10]), k: 'area' as const })));
    put('P.Num', g.maybe(0.8, () => ({ v: g.pick([1, 2, 2.5, -1, 0, 1234.5]) })));
    put('P.Txt', g.maybe(0.7, () => ({ v: g.pick(['x', 'y', 'z']) })));
    put('P.Flag', g.maybe(0.5, () => ({ v: g.bool() })));
    return { type: g.pick(['A', 'B', 'C']), storey, elev, mark: g.pick(['', 'M1', 'M2']), cells };
  });
}

const TOTALS: (TotalKind | undefined)[] = [undefined, 'sum', 'count', 'countDistinct', 'min', 'max', 'avg'];

function genDef(g: Gen): ScheduleDef {
  const keys = g.shuffle(['type', 'storey', 'mark', 'len', 'area', 'num', 'txt', 'flag'] as Key[]).slice(0, g.int(1, 6));
  if (g.bool(0.4)) { if (!keys.includes('len')) keys.push('len'); keys.push('twice'); }
  if (g.bool(0.4)) { if (!keys.includes('num')) keys.push('num'); keys.push('plus'); }
  const columns: Column[] = g.shuffle(keys).map((k) => {
    const numeric = NUMERIC.includes(k);
    const col: Column = { field: F[k] };
    if (numeric && g.bool(0.7)) {
      col.format = {
        decimals: g.maybe(0.7, () => g.int(0, 3)),
        display: k === 'len' ? g.pick(['mm', 'm', undefined]) : undefined,
        thousands: g.maybe(0.5, () => g.bool()),
        showSymbol: g.maybe(0.3, () => true),
        suppressZero: g.maybe(0.2, () => true),
      };
    }
    const total = numeric ? g.pick(TOTALS) : g.pick([undefined, undefined, 'count', 'countDistinct'] as const);
    if (total) col.total = total;
    return col;
  });
  const sortable = g.shuffle(['type', 'storey', 'mark', 'len', 'txt', 'area', 'num'] as Key[]).slice(0, g.int(0, 3));
  const sort: SortLevel[] = sortable.map((k) => ({
    field: F[k], dir: g.pick(['asc', 'desc'] as const),
    ...(g.bool(0.3) ? { header: true } : {}),
    ...(g.bool(0.4) ? { footer: g.pick(['totals', 'titleCountTotals', 'count', 'title'] as const) } : {}),
  }));
  return combined({
    ...emptySchedule('Random', ['IfcDoor']), columns, sort, grandTotal: g.bool(0.4),
    ...(keys.includes('twice') || keys.includes('plus') ? { calculated: CALCULATED } : {}),
  });
}

const SEEDS = 300;
const each = (n: number, f: (seed: number, specs: Spec[], store: ModelStore, def: ScheduleDef) => void) => {
  for (let seed = 1; seed <= n; seed++) {
    const g = new Gen(mulberry32(seed));
    const specs = genSpecs(g);
    f(seed, specs, storeOf(specs), genDef(g));
  }
};

/* ────────────────────────────── A. every element exactly once ────────────────────────────── */

describe('A. every element exactly once', () => {
  it(`over ${SEEDS} seeded schedules: counts sum to the matched elements; rows are the itemised rows, none lost, none twice`, () => {
    each(SEEDS, (seed, _specs, store, def) => {
      const res = runSchedule(store, def, all);
      const item = runSchedule(store, { ...def, itemize: true }, all);
      const lines = dataOf(res);
      expect(lines.reduce((n, l) => n + l.count, 0), `seed ${seed}`).toBe(res.matchedElements);
      expect(sorted(lines.flatMap((l) => l.rows)), `seed ${seed}`).toEqual(sorted(dataOf(item).flatMap((l) => l.rows)));
      for (const l of lines) expect(l.count, `seed ${seed}`).toBe(l.rows.length);
      // And it is the sort labels that decide the lines — the property that fails today.
      const tuples = new Set(dataOf(item).map((l) => JSON.stringify(def.sort.map((s) => formatCell(resolveField(store, l.rows[0], s.field))))));
      expect(lines.length, `seed ${seed}`).toBe(tuples.size);
    });
  });
});

/* ────────────────────────────── B. totals ────────────────────────────── */

describe('B. totals', () => {
  /** The trusted figure: an itemised grand total over a store of only these doors. */
  const totalOver = (members: number[], def: ScheduleDef, col: number) => {
    const sub = storeOf(members.map((r) => DOOR_SPECS[r]));
    const g = grandOf(runSchedule(sub, { ...def, itemize: true, grandTotal: true }, all))!;
    return { text: g.cells[col] ?? '', num: g.nums?.[col] ?? null };
  };

  for (const kind of ['sum', 'count', 'countDistinct', 'min', 'max', 'avg'] as TotalKind[]) {
    it(`a ${kind} total on a combined row is that total over its members, with the footer’s unit and rounding`, () => {
      const def = doorDef(BY_TYPE, {
        columns: doorCols({ area: { total: kind, format: { decimals: 3, showSymbol: true } }, width: { total: kind } }),
      });
      const lines = dataOf(runSchedule(doorStore, def));
      expect(lines).toHaveLength(4);
      for (const l of lines) {
        for (const col of [2, 5]) {
          const want = totalOver(sorted(l.rows), def, col);
          expect([kind, col, l.cells[col], l.nums?.[col]]).toEqual([kind, col, want.text, want.num]);
          expect([kind, col, l.mixed?.[col]]).toEqual([kind, col, false]);
        }
      }
    });
  }

  it('a total on a sort-level column is not totalled: the column shows its (agreed) value', () => {
    const def = doorDef(BY_LEVEL_TYPE, { columns: doorCols({ type: { total: 'count' } }) });
    const lines = dataOf(runSchedule(doorStore, def));
    expect(lines).toHaveLength(7);
    expect(lines.map((l) => l.cells[0])).toEqual(
      ['D01 Timber single', 'D02 Timber double', 'D03 Glass sliding', 'D04 Steel fire door', 'D01 Timber single', 'D02 Timber double', 'D03 Glass sliding']);
  });

  it('the grand total and a sort level’s footers are the itemised run’s, exactly', () => {
    const def = doorDef(BY_LEVEL_TYPE.map((l) => ({ ...l, header: true, footer: 'titleCountTotals' as const })), { grandTotal: true });
    const res = runSchedule(doorStore, def);
    const item = runSchedule(doorStore, { ...def, itemize: true });
    expect(dataOf(res)).toHaveLength(7);
    expect(grandOf(res)).toEqual(grandOf(item));
    expect(footersOf(res)).toEqual(footersOf(item));
  });

  it(`over ${SEEDS} seeded schedules: the grand total always, and the footers wherever same-label rows are contiguous`, () => {
    let footerSeeds = 0;
    each(SEEDS, (seed, _specs, store, def) => {
      const res = runSchedule(store, def, all);
      const item = runSchedule(store, { ...def, itemize: true }, all);
      expect(dataOf(res).length, `seed ${seed}`).toBe(oracle(_specs, store, def).length);
      expect(grandOf(res), `seed ${seed}`).toEqual(grandOf(item));
      if (contiguous(store, def)) {
        if (footersOf(item).length) footerSeeds++;
        expect(footersOf(res), `seed ${seed}`).toEqual(footersOf(item));
      }
    });
    // The generator must actually reach footers, or this half proves nothing.
    expect(footerSeeds).toBeGreaterThan(20);
  });
});

/* ────────────────────────────── C. the independent oracle ────────────────────────────── */

describe('C. an independent oracle over seeded random schedules', () => {
  it(`${SEEDS} seeds: cells, mixed flags, numbers, counts, member sets, filled, and order`, () => {
    let varied = 0;
    each(SEEDS, (seed, specs, store, def) => {
      const want = oracle(specs, store, def);
      const got = actualOf(runSchedule(store, def, all));
      if (want.some((w) => w.mixed.some(Boolean))) varied++;
      expect(got, `seed ${seed}`).toEqual(want);
    });
    expect(varied).toBeGreaterThan(SEEDS / 4);
  });

  it('the oracle agrees with today’s identical-rows merge where the two rules must coincide (guard: passes today)', () => {
    // Visible columns that are exactly the sort fields, in the sort label's own format and with
    // no total: "identical in every visible column" and "same sort labels" are the same test.
    let checked = 0;
    each(SEEDS, (seed, specs, store, random) => {
      if (!random.sort.length) return;
      const def: ScheduleDef = { ...random, columns: random.sort.map((l) => ({ field: l.field })), grandTotal: false };
      const today: ScheduleDef = { ...def };
      delete (today as { combine?: unknown }).combine;
      const got = dataOf(runSchedule(store, today, all)).map((l) => ({ members: sorted(l.rows), cells: l.cells, nums: l.nums }));
      const want = oracle(specs, store, def).map((w) => ({ members: w.members, cells: w.cells, nums: w.nums }));
      expect(got, `seed ${seed}`).toEqual(want);
      expect(oracle(specs, store, def).every((w) => w.mixed.every((m) => !m)), `seed ${seed}`).toBe(true);
      checked++;
    });
    expect(checked).toBeGreaterThan(SEEDS / 2);
  });

  it('the oracle itself agrees with the prototype on its doors (it is not wrong in the engine’s way)', () => {
    const want = oracle(DOOR_SPECS, doorStore, doorDef(BY_TYPE));
    expect(want.map((w) => w.members.length)).toEqual([6, 4, 3, 3]);
    expect(want.map((w) => w.mixed)).toEqual([
      [false, true, true, false, true, false],
      [false, true, false, true, false, false],
      [false, true, false, false, false, false],
      [false, false, false, false, false, false],
    ]);
    expect(oracle(DOOR_SPECS, doorStore, doorDef(BY_LEVEL_TYPE))).toHaveLength(7);
    expect(oracle(DOOR_SPECS, doorStore, doorDef([]))).toHaveLength(1);
  });
});

/* ────────────────────────────── D. acting on what is seen ────────────────────────────── */

const appState = (store: ModelStore, def: ScheduleDef): AppState => ({ ...blankState, store, def }) as AppState;
const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const drawn = (html: string) => [...html.matchAll(/<tr class="data[^"]*" data-row="(\d+)">([\s\S]*?)<\/tr>/g)].map(([, i, body]) => ({
  index: Number(i),
  tds: [...body.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map(([, attrs, inner]) => ({
    style: attrs.match(/style="([^"]*)"/)?.[1] ?? null,
    text: unescape(inner.replace(/<span class="sw"[^>]*><\/span>/, '')),
  })),
}));

describe('D. selection: a click on a combined row names exactly its members', () => {
  // The seam the window uses: a drawn row's `data-row` is its index in the result, and the
  // click (`main.ts`'s `pickRow`, not reachable headlessly) selects `res.rows[i].rows`; Shift
  // uses `rangeElements`, the marking `markedRows` / `rowOfElement`.
  it('every drawn combined row points at a data row whose rows are the oracle’s member set', () => {
    const def = doorDef(BY_TYPE);
    const res = runSchedule(doorStore, def);
    const html = renderSchedule(appState(doorStore, def), res, buildCoverage(doorStore, ['IfcDoor']));
    const want = oracle(DOOR_SPECS, doorStore, def);
    const rows = drawn(html);
    expect(rows).toHaveLength(want.length);
    rows.forEach((r, k) => {
      const row = res.rows[r.index] as DataRow;
      expect(row.kind).toBe('data');
      expect(sorted(row.rows)).toEqual(want[k].members);
      expect(sorted([...rangeElements(res, r.index, r.index)])).toEqual(want[k].members);
      for (const m of want[k].members) {
        expect(rowOfElement(res, m)).toBe(r.index);
        expect(markedRows(res, new Set([m]))).toEqual([r.index]);
      }
    });
  });
});

describe('D. filters test each element before rows combine', () => {
  it('Width = 0.9 and combine by Type: the Width cell reads the 900 mm text, counts cover only those doors', () => {
    const def = doorDef(BY_TYPE, { filters: [{ field: WIDTH, op: '=', value: 0.9 }] });
    const res = runSchedule(doorStore, def);
    const item = dataOf(runSchedule(doorStore, { ...def, itemize: true }));
    expect(item.map((l) => l.rows[0])).toEqual([0, 1, 3, 4]);
    const lines = dataOf(res);
    expect(lines).toHaveLength(1);
    expect(lines[0].cells[2]).toBe(item[0].cells[2]);
    expect(lines[0].cells[2]).not.toBe(V);
    expect([lines[0].count, sorted(lines[0].rows), res.matchedElements]).toEqual([4, [0, 1, 3, 4], 4]);
    // The doors that passed still differ in level and fire rating.
    expect([lines[0].cells[1], lines[0].cells[4]]).toEqual([V, V]);
  });
});

describe('D. colour rules: a <varies> cell is claimed by no rule', () => {
  // `!= "zzz"` claims every non-blank text — today it would claim "<varies>" too.
  const paint = { op: '!=' as const, value: 'zzz', bg: '#ff0000' };
  const def = doorDef(BY_TYPE, {
    columns: doorCols().map((c, i) => (i === 1 || i === 4 || i === 5 ? { ...c, conditional: [paint] } : c)),
  });
  const res = runSchedule(doorStore, def);

  it('the table paints the agreed and total cells and leaves every <varies> cell unstyled', () => {
    const rows = drawn(renderSchedule(appState(doorStore, def), res, buildCoverage(doorStore, ['IfcDoor'])));
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      for (const i of [1, 4, 5]) {
        const td = r.tds[i];
        if (td.text === V) expect([r.index, i, td.style]).toEqual([r.index, i, null]);
        else expect([r.index, i, td.style]).toEqual([r.index, i, 'background:#ff0000']);
      }
    }
    // D01's Level and Fire rating vary; its Area total is painted, on its displayed text.
    expect(rows[0].tds.map((t) => t.text === V)).toEqual([false, true, true, false, true, false, false]);
  });

  it('conditionalHits counts no <varies> cell', () => {
    // Level varies on D01, D02, D03; Fire rating on D01 only; Area is a total on every row.
    expect(res.conditionalHits).toEqual({ 1: { hits: [1], of: 4 }, 4: { hits: [3], of: 4 }, 5: { hits: [4], of: 4 } });
  });

  it('the litBy preview leaves the <varies> rows out', () => {
    const lit = runSchedule(doorStore, def, { litBy: { col: 4, rule: 0 } });
    expect(dataOf(lit).map((l) => l.cells[0])).toEqual(['D02 Timber double', 'D03 Glass sliding', 'D04 Steel fire door']);
    expect(dataOf(runSchedule(doorStore, def, { litBy: { col: 1, rule: 0 } })).map((l) => l.cells[0])).toEqual(['D04 Steel fire door']);
  });

  it('the Excel export paints what the table paints, and no <varies> cell', async () => {
    const blob = await xlsxBlob([{ name: 'Doors', res: fullResult(doorStore, def) }]);
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    const ws = wb.getWorksheet('Doors')!;
    const lines = dataOf(res);
    lines.forEach((l, k) => {
      for (const i of [1, 4, 5]) {
        const c = ws.getRow(k + 2).getCell(i + 1);
        const argb = (c.fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb;
        expect([k, i, c.value === V ? 'varies' : 'value', argb]).toEqual(
          [k, i, l.cells[i] === V ? 'varies' : 'value', l.cells[i] === V ? undefined : 'FFFF0000']);
      }
    });
    expect(ws.getRow(2).getCell(2).value).toBe(V);
  }, 30_000);
});

describe('D. order and determinism', () => {
  it('combined rows come in the order their groups first appear in the itemised table; two runs are deep-equal', () => {
    const def = doorDef(BY_LEVEL_TYPE.map((l) => ({ ...l, dir: 'desc' as const })));
    const a = runSchedule(doorStore, def);
    expect(runSchedule(doorStore, def)).toEqual(a);
    expect(actualOf(a).map((w) => w.members)).toEqual(oracle(DOOR_SPECS, doorStore, def).map((w) => w.members));
    expect(dataOf(a).map((l) => `${l.cells[1]} ${l.cells[0].slice(0, 3)}`)).toEqual(
      ['Level 2 D03', 'Level 2 D02', 'Level 2 D01', 'Level 1 D04', 'Level 1 D03', 'Level 1 D02', 'Level 1 D01']);
  });
});

describe('D. exports write the cells the table shows', () => {
  it('100 seeds: the export rows are the drawn table’s cells (thousands separators aside), <varies> as text', () => {
    let varied = 0;
    each(100, (seed, _specs, store, def) => {
      const shown = drawn(renderSchedule(appState(store, def), runSchedule(store, def), buildCoverage(store, ['IfcDoor'])));
      const exported = toRows(fullResult(store, def)).filter((r) => r.kind === 'data');
      expect(exported.map((r) => r.cells), `seed ${seed}`).toEqual(shown.map((r) => r.tds.map((t) => t.text.replace(/,/g, ''))));
      exported.forEach((r) => r.cells.forEach((c, i) => {
        if (c === V) { varied++; expect([seed, i, r.nums?.[i]]).toEqual([seed, i, null]); }
      }));
    });
    expect(varied).toBeGreaterThan(0);
  });
});

/* ────────────────────────────── F. mode off is untouched ────────────────────────────── */

describe('F. with the mode off nothing moves (guards: these pass today)', () => {
  it(`${SEEDS} seeds: combine undefined equals combine absent; itemize true with combine "sort" equals plain itemize true`, () => {
    each(SEEDS, (seed, _specs, store, def) => {
      const absent: ScheduleDef = { ...def };
      delete (absent as { combine?: unknown }).combine;
      const undef = { ...absent, combine: undefined } as ScheduleDef;
      expect(runSchedule(store, undef, all), `seed ${seed}`).toEqual(runSchedule(store, absent, all));
      expect(runSchedule(store, { ...def, itemize: true }, all), `seed ${seed}`)
        .toEqual(runSchedule(store, { ...absent, itemize: true }, all));
    });
  });
});
