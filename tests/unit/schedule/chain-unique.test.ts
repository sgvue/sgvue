// Guard 6 of the chained formulas (2026-11-24): a calculated value's name is unique. From valid
// schedules (no name shared), random sequences of edits — every exported action through the
// simulation's own generators (`support/sim.ts`), the name routes drawn from a small pool so that
// clashes are frequent, and `make_schedule` (`buildSchedule`) defining calculated values and
// heading columns — and after EVERY step: no calculated name equals another calculated name or
// any other column's heading, ignoring case and surrounding spaces; and a step that did not land
// the name or heading it asked for changed no name at all.
//
// Tripwire, in the style of `reachability.test.ts`: every exported action is classified here as
// one that can set or change a name / heading or one that cannot, so a new action that nobody
// classified fails by name. Replay one sequence with `CHAIN_SEED=<n>`.

import { describe, expect, it } from 'vitest';
import * as act from '../../../src/schedule/schedule/actions';
import { buildSchedule, type AskSchedule, type FieldWorld } from '../../../src/schedule/assistant';
import { StoreBuilder } from '../../../src/schedule/ifc/store';
import { headingOf, type ScheduleDef } from '../../../src/schedule/schedule/def';
import { snapshotOf } from '../../../src/schedule/adapter';
import { federate } from '../../../src/shared/federate';
import { mockModelIndex } from '../../../src/renderer/dev/mock-adapter';
import { int, key, pick, type Rng } from './support/chain';
import { GENS, HELPERS, mulberry32, type ActionName, type Ctx } from './support/sim';

const ONLY = process.env.CHAIN_SEED === undefined ? undefined : Number(process.env.CHAIN_SEED);
const SEQS = 300;
const STEPS = 30;

/** Routes that can set, change or remove a calculated name or a column heading. */
const NAMING: ActionName[] = [
  'addCalculated', 'updateCalculated', 'removeCalculated', 'setHeading', 'addColumns', 'remapColumn', 'removeColumn',
];
/** Routes that cannot — each says nothing about a name or a heading. */
const NOT_NAMING: ActionName[] = [
  'moveColumn', 'setHeadingOrientation', 'setAlign', 'setColumnFormat', 'setTotal', 'setHidden', 'setWidths',
  'addConditionalRule', 'removeConditionalRule', 'updateConditionalRule', 'addFilterRule', 'removeFilterRule',
  'setFilterMode', 'setFilterField', 'setFilterOp', 'setFilterValue', 'setFilterRange', 'setFilterValues',
  'addSortLevel', 'removeSortLevel', 'moveSortLevel', 'setSortField', 'setSortDir', 'setGroupOptions',
  'setItemize', 'setGrandTotal', 'setGrandTotalTitle', 'setAppearance', 'setName', 'setCalculatedResult',
  'setCalculatedUnitKind',
];
const ACTIONS = Object.keys(act).filter((k) => !HELPERS.includes(k)) as ActionName[];

/** Names that collide: the federation's default headings, the default calculated names, case and space variants. */
const POOL = ['Area', ' area', 'Height', 'HEIGHT ', 'Name', 'Mark', 'Level', 'Vol', 'vol', ' VOL ', 'Calculated 1',
  'calculated 2', 'Percentage 1', 'Twice', 'Width', ''];
const FORMULAS = ['Area * 2', 'Height + 1', 'Vol * 1.1', 'Twice + Area', '[Calculated 1] * 2', 'Area > 1'];

const fed = federate(['ARC', 'STR', 'SIT', 'MEP'].map((k) => mockModelIndex(k)));
const snap = snapshotOf(fed);
const sb = new StoreBuilder();
sb.add(snap.cores, snap.cells);
const world: FieldWorld = { store: sb.finish(snap.meta), propKeys: fed.propKeys };
const ctx: Ctx = { store: world.store, system: 'metric' };

/** Every way two names clash in this definition, as readable lines; empty when none does. */
function clashes(d: ScheduleDef): string[] {
  const out: string[] = [];
  const calcs = (d.calculated ?? []).filter((c) => key(c.name));
  calcs.forEach((c, i) => {
    for (const o of calcs.slice(i + 1)) if (key(o.name) === key(c.name)) out.push(`calculated "${c.name}" and "${o.name}"`);
    d.columns.forEach((col, j) => {
      if (col.field.kind === 'formula' && col.field.id === c.id) return;
      if (key(headingOf(col, d)) === key(c.name)) out.push(`calculated "${c.name}" and column ${j} "${headingOf(col, d)}"`);
    });
  });
  return out;
}
const names = (d: ScheduleDef) =>
  JSON.stringify([(d.calculated ?? []).map((c) => [c.id, c.name]), d.columns.map((c) => headingOf(c, d))]);

function start(r: Rng): ScheduleDef {
  const base = buildSchedule({
    category: ['IfcDoor'], columns: [{ field: 'Name' }, { field: 'Area' }, { field: 'Height' }],
    calculated: r() < 0.5 ? [{ name: 'Twice', formula: 'Area * 2' }] : [],
  } as AskSchedule, world, null);
  if ('error' in base) throw new Error(base.error);
  return base.def;
}

/** One step: what was asked, the definition after it, and whether the asked name landed (null: no name asked). */
function step(d: ScheduleDef, r: Rng): { what: string; next: ScheduleDef; landed: boolean | null } {
  const roll = r();
  if (roll < 0.15 && d.calculated?.length) {
    const c = pick(r, d.calculated);
    const name = pick(r, POOL);
    const next = act.updateCalculated(d, c.id, { name });
    return { what: `updateCalculated(${c.name} → "${name}")`, next, landed: next.calculated!.find((x) => x.id === c.id)!.name === name };
  }
  if (roll < 0.3 && d.columns.length) {
    const i = int(r, d.columns.length);
    const h = pick(r, POOL);
    const next = act.setHeading(d, i, h);
    return { what: `setHeading(${i} "${headingOf(d.columns[i], d)}" → "${h}")`, next, landed: next.columns[i]?.heading === h };
  }
  if (roll < 0.42) {
    const ask: AskSchedule = { base: 'open' };
    if (r() < 0.7) ask.calculated = [{ name: pick(r, POOL.filter(Boolean)), formula: pick(r, FORMULAS) }];
    if (r() < 0.5) ask.columns = [{ field: pick(r, ['Area', 'Height', 'Mark', 'Name']), heading: pick(r, POOL.filter(Boolean)) }];
    if (!ask.calculated && !ask.columns) ask.itemize = true;
    const out = buildSchedule(ask, world, d);
    return { what: `make_schedule ${JSON.stringify(ask)}`, next: 'error' in out ? d : out.def, landed: 'error' in out ? false : null };
  }
  const name = r() < 0.5 ? pick(r, NAMING) : pick(r, ACTIONS);
  const args = GENS[name](d, r, ctx);
  // The column menu offers "Point this column at…" on a property column only (`remap.ts`).
  if (name === 'remapColumn' && args && d.columns[args[0] as number]?.field.kind !== 'prop') return { what: `${name} (not on offer)`, next: d, landed: null };
  if (!args) return { what: `${name} (not on offer)`, next: d, landed: null };
  const next = (act[name] as unknown as (d: ScheduleDef, ...a: unknown[]) => ScheduleDef)(d, ...args);
  return { what: `${name}(${JSON.stringify(args)})`, next, landed: null };
}

describe('a calculated value’s name is unique, whatever the route', () => {
  it('every exported action is classified as naming or not', () => {
    const unclassified = ACTIONS.filter((a) => !NAMING.includes(a) && !NOT_NAMING.includes(a));
    expect(unclassified, 'actions nobody classified here').toEqual([]);
    expect([...NAMING, ...NOT_NAMING].filter((a) => !ACTIONS.includes(a)), 'classified, but no longer exported').toEqual([]);
  });

  it('after every step of random sequences, no calculated name is shared; a refused name changes nothing', () => {
    let refused = 0, landed = 0;
    for (let seq = 1; seq <= SEQS; seq++) {
      if (ONLY !== undefined && seq !== ONLY) continue;
      const r = mulberry32(seq * 2654435761);
      let d = start(r);
      expect(clashes(d), `sequence ${seq}, start`).toEqual([]);
      const log: string[] = [];
      for (let s = 0; s < STEPS; s++) {
        const { what, next, landed: ok } = step(d, r);
        log.push(what);
        expect(clashes(next), `sequence ${seq}, step ${s}: ${log.slice(-6).join(' › ')}`).toEqual([]);
        if (ok === false) { refused++; expect(names(next), `sequence ${seq}, step ${s}: ${what}`).toBe(names(d)); }
        if (ok === true) landed++;
        d = next;
      }
    }
    if (ONLY !== undefined) return;
    expect(refused).toBeGreaterThan(500);
    expect(landed).toBeGreaterThan(500);
  });

  // The two smallest inputs the walk above finds, one per route.
  it('make_schedule refuses a column heading a calculated value already has', () => {
    const one = buildSchedule({ category: ['IfcDoor'], columns: [{ field: 'Name' }, { field: 'Height' }], calculated: [{ name: 'Vol', formula: 'Height * 2' }] } as AskSchedule, world, null);
    if ('error' in one) throw new Error(one.error);
    const two = buildSchedule({ base: 'open', columns: [{ field: 'Height', heading: 'vol' }] } as AskSchedule, world, one.def);
    expect(clashes('error' in two ? one.def : two.def)).toEqual([]);
  });

  it('adding a model column whose heading a calculated value already has leaves no shared name', () => {
    const one = buildSchedule({ category: ['IfcDoor'], columns: [{ field: 'Name' }, { field: 'Area' }], calculated: [{ name: 'Height', formula: 'Area * 2' }] } as AskSchedule, world, null);
    if ('error' in one) throw new Error(one.error);
    const height = { kind: 'prop' as const, pset: 'Qto_DoorBaseQuantities', prop: 'Height' };
    expect(clashes(act.addColumns(one.def, [{ field: height }]))).toEqual([]);
  });
});
