// The review's fixes to the chained formulas (2026-11-25), each the smallest input that showed a
// defect: a model column taking a calculated value's name (F1), a heading typed in steps re-pointing
// a formula (F2), a value blank behind a broken one saying nothing (F3), a unit lost through a link
// with no named unit (F4), a name a formula uses holding a bracket (F5), and an old file's shadowed
// calculated value redefined under its own name (F6).

import { describe, expect, it } from 'vitest';
import * as act from '../../../src/schedule/schedule/actions';
import { buildSchedule, type AskSchedule, type FieldWorld } from '../../../src/schedule/assistant';
import { StoreBuilder } from '../../../src/schedule/ifc/store';
import { snapshotOf } from '../../../src/schedule/adapter';
import { federate } from '../../../src/shared/federate';
import { mockModelIndex } from '../../../src/renderer/dev/mock-adapter';
import { calcNameProblem, headingBoxProblem, headingProblem, nameBoxProblem } from '../../../src/schedule/schedule/calcNames';
import { kindsByHeading } from '../../../src/schedule/schedule/columns';
import { calcProblems, planComputed } from '../../../src/schedule/schedule/computed';
import { headingOf, type Calculated, type ScheduleDef } from '../../../src/schedule/schedule/def';
import { dimensionOf } from '../../../src/schedule/schedule/formula';
import { engineValues, modelColumn, scheduleOf, showCalc, storeOf, type Prop } from './support/chain';

const fed = federate(['ARC', 'STR', 'SIT', 'MEP'].map((k) => mockModelIndex(k)));
const snap = snapshotOf(fed);
const sb = new StoreBuilder();
sb.add(snap.cores, snap.cells);
const world: FieldWorld = { store: sb.finish(snap.meta), propKeys: fed.propKeys };

const f = (id: string, name: string, formula: string, more: Partial<Calculated> = {}): Calculated =>
  ({ id, name, kind: 'formula', formula, ...more });
const built = (ask: AskSchedule, base: ScheduleDef | null): ScheduleDef => {
  const out = buildSchedule(ask, world, base);
  if ('error' in out) throw new Error(out.error);
  return out.def;
};
const refusal = (ask: AskSchedule, base: ScheduleDef | null): string => {
  const out = buildSchedule(ask, world, base);
  if (!('error' in out)) throw new Error('accepted');
  return out.error;
};
const round = (vs: Record<string, unknown[]>) =>
  JSON.stringify(vs, (_k, v: unknown) => (typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v));

const TAKEN_HEADING = (x: string) => `A calculated column is already called "${x}" — give this column another heading.`;
const SHARED = (x: string) => `Another column is already called "${x}", and a formula uses one of the two — give this column another heading.`;
const BRACKET = 'A name a formula uses cannot contain [ or ].';

describe('F1 — a model column never takes a calculated value’s name', () => {
  it('the field picker gives the new column the table’s twin label, and the formula keeps reading the value', () => {
    const props: Prop[] = [{ prop: 'Area', kind: 'area' }, { prop: 'Height', kind: 'length' }, { prop: 'Volume', kind: 'volume' }];
    const store = storeOf({ props, rows: [[2, 10, 5]], storeys: ['L1'] });
    const def = scheduleOf([modelColumn(props[0]), modelColumn(props[1]), showCalc('v'), showCalc('w')], [
      f('v', 'Volume', 'Area * Height'), f('w', 'Waste', 'Volume * 1.1'),
    ]);
    expect(engineValues(store, def).w[0]).toBeCloseTo(22);
    const next = act.addColumns(def, [modelColumn(props[2])]);
    expect(headingOf(next.columns[4], next)).toBe('Volume (Q)');
    expect(engineValues(store, next).w[0]).toBeCloseTo(22);
    // And again: the twin label is taken too, so it is extended until it is unique.
    const again = act.addColumns({ ...next, calculated: [...next.calculated!, f('x', 'Volume (Q)', '1')] }, [modelColumn(props[2])]);
    expect(headingOf(again.columns[5], again)).toBe('Volume (Q) 2');
  });

  it('make_schedule gives a new column whose default heading clashes the same non-clashing heading', () => {
    const one = built({ category: ['IfcDoor'], columns: [{ field: 'Name' }, { field: 'Area' }],
      calculated: [{ name: 'Height', formula: 'Area * 2' }, { name: 'Twice', formula: 'Height * 2' }] } as AskSchedule, null);
    const before = round(engineValues(world.store, one));
    const two = built({ base: 'open', columns: [{ field: 'Qto_DoorBaseQuantities.Height' }] } as AskSchedule, one);
    const added = two.columns.find((c) => c.field.kind === 'prop' && c.field.prop === 'Height')!;
    expect(headingOf(added, two)).toBe('Height (Qto)');
    expect(round(engineValues(world.store, two))).toBe(before);
  });

  it('make_schedule refuses an explicit heading a calculated value has, with the heading box’s sentence', () => {
    const one = built({ category: ['IfcDoor'], columns: [{ field: 'Name' }, { field: 'Area' }, { field: 'Height' }],
      calculated: [{ name: 'Volume', formula: 'Area * Height' }] } as AskSchedule, null);
    expect(refusal({ base: 'open', columns: [{ field: 'Height', heading: 'Volume' }] } as AskSchedule, one)).toContain(TAKEN_HEADING('Volume'));
    expect(refusal({ base: 'open', columns: [{ field: 'Name', heading: ' volume ' }] } as AskSchedule, one)).toContain(TAKEN_HEADING('Volume'));
  });

  it('the heading box of a calculated column refuses another column’s heading or another value’s name', () => {
    const props: Prop[] = [{ prop: 'Area', kind: 'area' }];
    const def = scheduleOf([modelColumn(props[0]), showCalc('a'), showCalc('b')], [f('a', 'Double', 'Area * 2'), f('b', 'Triple', 'Area * 3')]);
    expect(headingProblem(def, 1, 'area')).toBe('Another column is already called "Area" — give this column another heading.');
    expect(headingProblem(def, 1, 'TRIPLE')).toBe(TAKEN_HEADING('Triple'));
    expect(headingProblem(def, 1, 'Double')).toBeNull();
    expect(headingProblem(def, 1, 'Twice')).toBeNull();
    expect(act.setHeading(def, 1, 'Area')).toEqual(def);
  });
});

describe('F2 — a heading typed in steps never re-points a formula', () => {
  const props: Prop[] = [{ prop: 'P0', kind: 'area' }, { prop: 'P1', kind: 'area' }];
  const store = storeOf({ props, rows: [[2, 7]], storeys: ['L1'] });

  it('"Net" to "Area" (another column’s heading) is refused; "Area (net)" then lands from "Net"', () => {
    const def = scheduleOf([modelColumn(props[0], 'Net'), modelColumn(props[1], 'Area'), showCalc('a')], [f('a', 'Twice', 'Net * 2')]);
    expect(headingProblem(def, 0, 'Area')).toBe(SHARED('Area'));
    const one = act.setHeading(def, 0, 'Area');
    expect(one).toEqual(def);
    const two = act.setHeading(one, 0, 'Area (net)');
    expect(headingOf(two.columns[0], two)).toBe('Area (net)');
    expect(two.calculated![0].formula).toBe('[Area (net)] * 2');
    expect(engineValues(store, two).a).toEqual([4]);
  });

  it('clearing the box beside a column already headed with the default is refused; retyping continues from the kept name', () => {
    const p: Prop[] = [{ prop: 'Area', kind: 'area' }, { prop: 'P1', kind: 'area' }];
    const s = storeOf({ props: p, rows: [[2, 7]], storeys: ['L1'] });
    const def = scheduleOf([modelColumn(p[0], 'Gross'), modelColumn(p[1], 'Area'), showCalc('a')], [f('a', 'Twice', 'Gross * 2')]);
    expect(headingProblem(def, 0, '')).toBe(SHARED('Area'));
    let d = act.setHeading(def, 0, '');
    expect(d).toEqual(def);
    for (const typed of ['G', 'Gr', 'Gro2']) d = act.setHeading(d, 0, typed);
    expect(headingOf(d.columns[0], d)).toBe('Gro2');
    expect(d.calculated![0].formula).toBe('Gro2 * 2');
    expect(engineValues(s, d).a).toEqual([4]);
  });

  it('a trailing space or a case change of its own heading clashes with nothing and keeps the formula', () => {
    const def = scheduleOf([modelColumn(props[0], 'Net'), modelColumn(props[1], 'Area'), showCalc('a')], [f('a', 'Twice', 'Net * 2')]);
    expect(headingProblem(def, 0, 'NET ')).toBeNull();
    const d = act.setHeading(def, 0, 'NET ');
    expect(d.columns[0].heading).toBe('NET ');
    expect(engineValues(store, d).a).toEqual([4]);
  });

  it('two model columns may still share a heading when no formula names either', () => {
    const def = scheduleOf([modelColumn(props[0], 'Net'), modelColumn(props[1], 'Area'), showCalc('a')], [f('a', 'Twice', '2')]);
    expect(headingProblem(def, 0, 'Area')).toBeNull();
    expect(headingOf(act.setHeading(def, 0, 'Area').columns[0])).toBe('Area');
  });
});

describe('F3 — a value blank because a value it uses is broken says so', () => {
  const props: Prop[] = [{ prop: 'P0', kind: 'area' }];
  const store = storeOf({ props, rows: [[2]], storeys: ['L1'] });
  const cols = [modelColumn(props[0], 'Area')];
  const problems = (calcs: Calculated[]) => calcProblems(store, scheduleOf(cols, calcs));

  it('downstream of a loop, of a value using itself, of a formula that does not parse — and through a chain', () => {
    const p = problems([
      f('a', 'A', 'B + 1'), f('b', 'B', 'A + 1'), f('c', 'After', 'A * Area'),
      f('s', 'S', 'S + 1'), f('d', 'D', 'S * 2'),
      f('p', 'P', 'Area +'), f('q', 'Q', 'P * 2'), f('r', 'R', 'Q + 1'),
      f('x', 'X', 'A + P'),
    ]);
    expect(p.get('a')).toBe('"A" and "B" use each other in a loop — a formula cannot use its own result, directly or through another column.');
    expect(p.get('s')).toBe('"S" uses itself — a formula cannot use its own result, directly or through another column.');
    expect(p.get('c')).toBe('Cannot be worked out: "A" has a problem.');
    expect(p.get('d')).toBe('Cannot be worked out: "S" has a problem.');
    expect(p.get('q')).toBe('Cannot be worked out: "P" has a problem.');
    expect(p.get('r')).toBe('Cannot be worked out: "Q" has a problem.');
    expect(p.get('x')).toBe('Cannot be worked out: "A" and "P" have a problem.');
    // The view bar counts calcProblems: every one of the nine.
    expect(p.size).toBe(9);
  });

  it('downstream of a value that names an unknown field or a percentage, which is blank on every row too', () => {
    const p = problems([
      f('u', 'U', 'Nope * 2'), f('v', 'V', 'U + 1'), f('w', 'W', 'V + Area'),
      { id: 'sh', name: 'Share', kind: 'percentage', ofField: cols[0].field },
      f('t', 'T', 'Share * 2'), f('z', 'Z', 'T + 1'),
    ]);
    expect(p.get('u')).toBe('Unknown field: Nope');
    expect(p.get('v')).toBe('Cannot be worked out: "U" has a problem.');
    expect(p.get('w')).toBe('Cannot be worked out: "V" has a problem.');
    expect(p.get('t')).toBe('A percentage cannot be used in a formula: Share');
    expect(p.get('z')).toBe('Cannot be worked out: "T" has a problem.');
  });

  it('a unit warning upstream blocks nothing: the value is still worked out, so what uses it is too', () => {
    const def = scheduleOf(cols, [f('q', 'Quad', 'Area * Area'), f('m', 'Mix', 'Quad + Area'), f('n', 'N', 'Mix * 2')]);
    const p = calcProblems(store, def);
    expect(p.get('m')).toBe('This adds a mixed unit to a area, which cannot be right.');
    expect(p.get('n') ?? '').not.toContain('Cannot be worked out');
    expect(engineValues(store, def).n[0]).toBeCloseTo(12);
  });

  it('planComputed carries the same sentence', () => {
    const def = scheduleOf(cols, [f('p', 'P', 'Area +'), f('q', 'Q', 'P * 2')]);
    expect(planComputed(def).errors.get('q')).toBe('Cannot be worked out: "P" has a problem.');
  });
});

describe('F4 — a unit is carried through a link whose own unit has no name', () => {
  const props: Prop[] = [{ prop: 'P0', kind: 'area' }];
  const store = storeOf({ props, rows: [[2]], storeys: ['L1'] });
  const cols = [modelColumn(props[0], 'Area')];

  it('the unit, and the unit mistake, are the same chained as written in place', () => {
    const chained = scheduleOf(cols, [f('q', 'Quad', 'Area * Area'), f('b', 'Back', 'Quad / Area'), f('m', 'Mix', 'Quad + Area')]);
    const alone = scheduleOf(cols, [f('m', 'Mix', '(Area * Area) + Area')]);
    expect(dimensionOf('Quad / Area', kindsByHeading(store, chained)).kind).toBe('area');
    const mistake = calcProblems(store, alone).get('m');
    expect(mistake).toBe('This adds a mixed unit to a area, which cannot be right.');
    expect(calcProblems(store, chained).get('m')).toBe(mistake);
  });

  it('a unit kind the upstream value declares still wins', () => {
    const def = scheduleOf(cols, [f('q', 'Quad', 'Area * Area', { unitKind: 'volume' }), f('b', 'Back', 'Quad / Area')]);
    expect(dimensionOf('Quad / Area', kindsByHeading(store, def)).kind).toBe('length');
  });
});

describe('F5 — a name a formula uses cannot hold a bracket', () => {
  const props: Prop[] = [{ prop: 'P0', kind: 'area' }];
  const def = scheduleOf([modelColumn(props[0], 'Area'), showCalc('v'), showCalc('w')], [f('v', 'Volume', 'Area * 2'), f('w', 'Waste', 'Volume * 1.1')]);

  it('the name box refuses it while a formula uses the value; the action alone does not judge it', () => {
    expect(nameBoxProblem(def, 'v', 'x] + [y')).toBe(BRACKET);
    expect(nameBoxProblem(def, 'v', 'V[1')).toBe(BRACKET);
    expect(nameBoxProblem(def, 'w', 'W[1]')).toBeNull();
    expect(nameBoxProblem(def, 'v', 'Area')).toBe(calcNameProblem(def, 'v', 'Area'));
  });

  it('the heading box refuses it while a formula uses the column', () => {
    expect(headingBoxProblem(def, 0, 'Area [m2]')).toBe(BRACKET);
    const unused = scheduleOf([modelColumn(props[0], 'Area'), showCalc('v')], [f('v', 'Volume', '2')]);
    expect(headingBoxProblem(unused, 0, 'Area [m2]')).toBeNull();
  });

  it('make_schedule refuses a heading holding a bracket on a column a formula uses', () => {
    const one = built({ category: ['IfcDoor'], columns: [{ field: 'Name' }, { field: 'Area' }],
      calculated: [{ name: 'Twice', formula: 'Area * 2' }] } as AskSchedule, null);
    expect(refusal({ base: 'open', columns: [{ field: 'Area', heading: 'Area [m2]' }] } as AskSchedule, one)).toContain(BRACKET);
  });
});

describe('F6 — an old file’s shadowed calculated value is redefined under its own name', () => {
  it('a calculated "Area" beside a model "Area" takes a new formula', () => {
    const one = built({ category: ['IfcDoor'], columns: [{ field: 'Name' }, { field: 'Area' }, { field: 'Height' }] } as AskSchedule, null);
    const old: ScheduleDef = { ...one, calculated: [f('calc1', 'Area', 'Height * 2')], columns: [...one.columns, showCalc('calc1')] };
    const two = built({ base: 'open', calculated: [{ name: 'Area', formula: 'Height * 4' }] } as AskSchedule, old);
    expect(two.calculated).toHaveLength(1);
    expect(two.calculated![0]).toMatchObject({ id: 'calc1', name: 'Area', formula: 'Height * 4' });
  });
});

// Review round 2: "Point this column at…" kept a heading that had been typed and then cleared
// (stored as ''), so the column took the new property's name — a calculated value's — and the
// formula naming that value silently read the model column instead.
describe('round 2 — a remap never hands a model column a calculated value’s name', () => {
  const props: Prop[] = [{ prop: 'Area', kind: 'area' }, { prop: 'ClearHeight', kind: 'length' }, { prop: 'Height', kind: 'length' }];
  const store = storeOf({ props, rows: [[2, 10, 5]], storeys: ['L1'] });
  const start = scheduleOf([modelColumn(props[0]), modelColumn(props[1]), showCalc('h'), showCalc('t')], [
    f('h', 'Height', 'Area * 100'), f('t', 'Twice', 'Height * 2'),
  ]);

  it.each([[''], [' ']])('a heading typed and then cleared to %j is pinned like one never touched', (cleared) => {
    expect(engineValues(store, start).t[0]).toBeCloseTo(400);
    const emptied = act.setHeading(act.setHeading(start, 1, 'Clear'), 1, cleared);
    expect(headingOf(emptied.columns[1], emptied)).toBe('ClearHeight');
    const next = act.remapColumn(emptied, 1, modelColumn(props[2]).field);
    expect(next.columns[1].field).toEqual(modelColumn(props[2]).field);
    expect(headingOf(next.columns[1], next)).toBe('ClearHeight');
    expect(engineValues(store, next).t[0]).toBeCloseTo(400);
    expect(calcProblems(store, next).size).toBe(0);
  });

  it('a heading never touched is pinned, as before', () => {
    const next = act.remapColumn(start, 1, modelColumn(props[2]).field);
    expect(headingOf(next.columns[1], next)).toBe('ClearHeight');
    expect(engineValues(store, next).t[0]).toBeCloseTo(400);
  });
});
