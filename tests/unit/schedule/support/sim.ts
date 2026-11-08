// Seeded, model-based random testing for schedule/actions.ts: a tiny PRNG (mulberry32 — no
// dependency) and one generator per action that returns arguments the CURRENT UI could
// actually send for this definition, or null when the action is not on offer (no column to
// remove, a range box on a rule that is not `between`, …).
//
// Ported from ifcTable's `tests/support/sim.ts` (Yong Yen) for SGVue v1.5.0, phase 1.
// SGVue keeps `kindOf` / `typeOf` in the engine (`schedule/columns.ts`), not the UI.

import type { ModelStore } from '../../../../src/schedule/ifc/store';
import * as act from '../../../../src/schedule/schedule/actions';
import { alignForCalc, columnForCore, columnForProp, kindOf, typeOf } from '../../../../src/schedule/schedule/columns';
import { opsForType } from '../../../../src/schedule/schedule/compare';
import {
  BOOL_STYLES, CORE_KEYS, headingOf, type FieldRef, type ScheduleDef,
} from '../../../../src/schedule/schedule/def';
import { BODY_FONTS } from '../../../../src/schedule/schedule/fonts';
import { unitOptions } from '../../../../src/schedule/schedule/format';
import { keysForEntity } from '../../../../src/schedule/ifc/store';


export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (r: Rng, n: number) => Math.floor(r() * n);
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[int(r, xs.length)];
const bool = (r: Rng) => r() < 0.5;

/** Helpers the barrel exports that are not user intents. */
export const HELPERS = ['canMove', 'fieldKey', 'moveItem', 'newId'];
export type ActionName = Exclude<keyof typeof act, 'canMove' | 'fieldKey' | 'moveItem' | 'newId'>;

export interface Ctx { store: ModelStore; system: 'metric' | 'imperial' }
type Gen = (d: ScheduleDef, r: Rng, c: Ctx) => unknown[] | null;

const TEXTS = ['', 'Renamed', 'W', 'Height', 'Door, "double"', 'Ünïcode m²', '=SUM(A1)'];
const COLOURS = ['#fff3cd', '#664d03', '#d1e7dd', '#0f5132', '#000000', '#ffffff'];
const TOTALS = [null, 'sum', 'count', 'countDistinct', 'min', 'max', 'avg'] as const;
const FOOTERS = ['none', 'titleCountTotals', 'title', 'count', 'totals'] as const;
const CALC_KINDS = ['none', 'yesno', 'text', 'length', 'area', 'volume', 'mass', 'angle'];

/** Every field the UI could offer: the columns, every core key, the model's properties. */
function fieldPool(d: ScheduleDef, c: Ctx): FieldRef[] {
  const props = keysForEntity(c.store, d.entity).map((s): FieldRef => ({ kind: 'prop', pset: s.pset, prop: s.prop }));
  return [...d.columns.map((x) => x.field), ...CORE_KEYS.map((key): FieldRef => ({ kind: 'core', key })), ...props];
}

function newColumn(d: ScheduleDef, r: Rng, c: Ctx) {
  const stats = keysForEntity(c.store, d.entity);
  const roll = r();
  if (roll < 0.4 || !stats.length) return columnForCore(pick(r, CORE_KEYS), c.system);
  if (roll < 0.85 || !d.calculated?.length) return columnForProp(pick(r, stats), c.system);
  const calc = pick(r, d.calculated);
  return { field: { kind: 'formula' as const, id: calc.id }, align: alignForCalc(calc) };
}

const col = (d: ScheduleDef, r: Rng) => (d.columns.length ? int(r, d.columns.length) : null);
const two = (r: Rng, n: number) => { const a = int(r, n); let b = int(r, n - 1); if (b >= a) b++; return [a, b]; };
const withRules = (d: ScheduleDef) => d.columns.map((x, i) => [i, x.conditional?.length ?? 0]).filter(([, n]) => n > 0);
const formulas = (d: ScheduleDef) => (d.calculated ?? []).filter((x) => x.kind === 'formula');

function formulaText(d: ScheduleDef, r: Rng): string {
  const names = d.columns.filter((x) => x.field.kind !== 'formula').map((x) => headingOf(x, d));
  const h = names.length ? pick(r, names) : 'Width';
  return pick(r, [`${h} * 2`, `${h} / 1000`, `if(${h} > 1, "Big", "Small")`, `${h} > 0.9`, '1 +', '', `${h} * ${h}`]);
}

export const GENS: Record<ActionName, Gen> = {
  addColumns: (d, r, c) => [Array.from({ length: 1 + int(r, 2) }, () => newColumn(d, r, c))],
  removeColumn: (d, r) => (d.columns.length ? [col(d, r)] : null),
  moveColumn: (d, r) => (d.columns.length > 1 ? two(r, d.columns.length) : null),
  remapColumn: (d, r, c) => {
    const props = keysForEntity(c.store, d.entity);
    if (!d.columns.length || !props.length) return null;
    const s = pick(r, props);
    return [col(d, r), { kind: 'prop', pset: s.pset, prop: s.prop }];
  },
  setHeading: (d, r) => (d.columns.length ? [col(d, r), pick(r, TEXTS)] : null),
  setHeadingOrientation: (d, r) => (d.columns.length ? [col(d, r), pick(r, ['horizontal', 'vertical'])] : null),
  setAlign: (d, r) => (d.columns.length ? [col(d, r), pick(r, ['left', 'center', 'right'])] : null),
  setColumnFormat: (d, r, c) => {
    const i = col(d, r);
    if (i === null) return null;
    const kind = kindOf(c.store, d, d.columns[i].field);
    const patch = pick(r, [
      () => ({ display: pick(r, ['', ...unitOptions(kind)]) }),
      () => ({ decimals: r() < 0.2 ? undefined : int(r, 7) }),
      () => ({ thousands: bool(r) }), () => ({ showSymbol: bool(r) }),
      () => ({ suppressZero: bool(r) }), () => ({ boolStyle: pick(r, BOOL_STYLES) }),
    ])();
    return [i, patch];
  },
  setTotal: (d, r) => (d.columns.length ? [col(d, r), pick(r, TOTALS)] : null),
  setHidden: (d, r) => (d.columns.length ? [col(d, r), bool(r)] : null),
  setWidths: (d, r) => {
    if (!d.columns.length) return null;
    const n = 1 + int(r, Math.min(3, d.columns.length));
    return [Array.from({ length: n }, () => [col(d, r), r() < 0.15 ? undefined : 30 + int(r, 571)])];
  },
  addConditionalRule: (d, r) => (d.columns.length ? [col(d, r)] : null),
  removeConditionalRule: (d, r) => {
    const w = withRules(d);
    if (!w.length) return null;
    const [i, n] = pick(r, w);
    return [i, int(r, n)];
  },
  updateConditionalRule: (d, r, c) => {
    const w = withRules(d);
    if (!w.length) return null;
    const [i, n] = pick(r, w);
    const ops = opsForType(typeOf(c.store, d, d.columns[i].field)).filter((o) => o !== 'in' && o !== 'between');
    const patch = pick(r, [
      () => ({ op: pick(r, ops) }), () => ({ value: pick(r, ['', '90', 'Yes', '60 min', '1200']) }),
      () => ({ bg: pick(r, COLOURS) }), () => ({ fg: pick(r, COLOURS) }), () => ({ bold: bool(r) }),
      () => ({ bg: pick(r, [...COLOURS, undefined]), fg: pick(r, [...COLOURS, undefined]) }),
    ])();
    return [i, int(r, n), patch];
  },
  // Offered even at the cap: the action itself must refuse an over-cap add.
  addFilterRule: () => [],
  removeFilterRule: (d, r) => (d.filters.length ? [int(r, d.filters.length)] : null),
  setFilterMode: (_d, r) => [pick(r, ['and', 'or'])],
  setFilterField: (d, r, c) => (d.filters.length ? [int(r, d.filters.length), pick(r, fieldPool(d, c))] : null),
  setFilterOp: (d, r, c) => {
    if (!d.filters.length) return null;
    const k = int(r, d.filters.length);
    return [k, pick(r, opsForType(typeOf(c.store, d, d.filters[k].field)))];
  },
  setFilterValue: (d, r, c) => {
    if (!d.filters.length) return null;
    const k = int(r, d.filters.length);
    const numeric = typeOf(c.store, d, d.filters[k].field) === 'number';
    return [k, numeric && r() < 0.8 ? Math.round(r() * 3000) / 1000 : pick(r, ['', 'Level 1', '60 min', 'Generic 200mm', 'true'])];
  },
  setFilterRange: (d, r) => {
    const ks = d.filters.map((f, k) => [k, f.op] as const).filter(([, op]) => op === 'between');
    if (!ks.length) return null;
    const k = pick(r, ks)[0];
    // Either box first, and sometimes a cleared box (an open end).
    return [k, int(r, 2), r() < 0.15 ? undefined : Math.round(r() * 12000) / 1000];
  },
  setFilterValues: (d, r) => {
    const ks = d.filters.map((f, k) => [k, f.op] as const).filter(([, op]) => op === 'in');
    return ks.length ? [pick(r, ks)[0], ['Level 1', 'Level 10', 'Roof', '60 min'].filter(() => bool(r))] : null;
  },
  addSortLevel: () => [],
  removeSortLevel: (d, r) => (d.sort.length ? [int(r, d.sort.length)] : null),
  moveSortLevel: (d, r) => (d.sort.length > 1 ? two(r, d.sort.length) : null),
  setSortField: (d, r, c) => (d.sort.length ? [int(r, d.sort.length), pick(r, fieldPool(d, c))] : null),
  setSortDir: (d, r) => (d.sort.length ? [int(r, d.sort.length), pick(r, ['asc', 'desc'])] : null),
  setGroupOptions: (d, r) => (d.sort.length
    ? [int(r, d.sort.length), pick(r, [() => ({ header: bool(r) }), () => ({ blankLine: bool(r) }),
      () => ({ footer: pick(r, FOOTERS) })])()]
    : null),
  setItemize: (_d, r) => [bool(r)],
  setGrandTotal: (_d, r) => [bool(r)],
  setGrandTotalTitle: (_d, r) => [pick(r, TEXTS)],
  setAppearance: (_d, r) => [pick(r, [
    () => ({ title: pick(r, TEXTS) }), () => ({ showTitle: bool(r) }), () => ({ gridLines: bool(r) }),
    () => ({ outline: bool(r) }), () => ({ blankRowBeforeData: bool(r) }), () => ({ zebra: bool(r) }),
    () => ({ headerBold: bool(r) }), () => ({ bodyFont: pick(r, BODY_FONTS).key }),
    () => ({ fontSize: 8 + int(r, 17) }),
  ])()],
  setName: (_d, r) => [pick(r, TEXTS)],
  addCalculated: (_d, r) => [pick(r, ['formula', 'percentage'])],
  removeCalculated: (d, r) => (d.calculated?.length ? [pick(r, d.calculated).id] : null),
  updateCalculated: (d, r, c) => {
    if (!d.calculated?.length) return null;
    const x = pick(r, d.calculated);
    if (r() < 0.3) return [x.id, { name: pick(r, ['Calc', 'Area x2', '', 'Band']) }];
    return x.kind === 'formula' ? [x.id, { formula: formulaText(d, r) }] : [x.id, { ofField: pick(r, fieldPool(d, c)) }];
  },
  setCalculatedResult: (d, r) => (formulas(d).length ? [pick(r, formulas(d)).id, pick(r, CALC_KINDS)] : null),
  setCalculatedUnitKind: (d, r) => (formulas(d).some((x) => x.formula)
    ? [pick(r, formulas(d).filter((x) => x.formula)).id, pick(r, ['length', 'area', 'volume', 'none'])]
    : null),
};
