// "Result is a → yes or no" on a calculated value.
//
// This started life as a `yesno()` function in the formula language, invented to avoid
// adding a field to a schema the owner had frozen. That was the wrong trade: the owner owns
// the freeze and should have been asked, and a dropdown entry is discoverable where a
// function has to be known about first. The flag is a property of the calculated value now.

import { describe, expect, it } from 'vitest';
import { numberOf } from '../../../src/schedule/schedule/compare';
import { planComputed } from '../../../src/schedule/schedule/computed';
import { emptySchedule, parseScheduleDef, type ScheduleDef } from '../../../src/schedule/schedule/def';
import { StoreBuilder, type ModelStore } from '../../../src/schedule/ifc/store';
import type { Cell, ElemCore, ModelMeta } from '../../../src/schedule/ifc/types';

const meta: ModelMeta = {
  fileName: 'f.ifc', schema: 'IFC4', projectName: '', authoringTool: '',
  lengthUnit: 'mm', unitSystem: 'metric', elementCount: 0, parseMs: 0,
};

function store(cells: Record<string, Cell>[]): ModelStore {
  const b = new StoreBuilder();
  b.add(cells.map(() => ({
    entity: 'IfcDoor', name: 'D', description: '', mark: '', typeName: 'T', family: 'F',
    objectType: '', predefinedType: '', guid: 'g', storey: 'L1', storeyElevation: 0,
    building: '', site: '', space: '', material: '', discipline: 'ARC',
  } as ElemCore)), cells);
  return b.finish(meta);
}

const def = (yesNo: boolean): ScheduleDef => ({
  ...emptySchedule('S', ['IfcDoor']),
  columns: [{ field: { kind: 'prop', pset: 'P', prop: 'Width' } }],
  calculated: [{ id: 'c1', name: 'Wide', kind: 'formula', formula: 'Width > 0.9', yesNo }],
});

const valueOf = (yesNo: boolean, width: number) => {
  const s = store([{ 'P.Width': { v: width, k: 'length' } }]);
  return planComputed(def(yesNo)).compute(s, 0).get('formula:c1');
};

describe('a calculated value can answer yes or no', () => {
  it('stores a real yes or no, not 1 and 0', () => {
    expect(valueOf(true, 1.2)?.v).toBe(true);
    expect(valueOf(true, 0.4)?.v).toBe(false);
  });

  it('leaves the same formula as a number when the flag is off', () => {
    expect(valueOf(false, 1.2)?.v).toBe(1);
    expect(valueOf(false, 0.4)?.v).toBe(0);
  });

  it('still counts, so a Sum total is unaffected by the choice', () => {
    // This is what makes the flag free: numberOf reads a boolean back as 1/0.
    expect(numberOf(valueOf(true, 1.2))).toBe(1);
    expect(numberOf(valueOf(true, 0.4))).toBe(0);
  });

  it('carries no unit — a yes is not a measurement', () => {
    expect(valueOf(true, 1.2)?.k).toBeUndefined();
  });

  it('leaves a blank blank rather than calling it "No"', () => {
    // A missing operand must not read as a confident negative.
    const s = store([{}]);
    expect(planComputed(def(true)).compute(s, 0).get('formula:c1')).toBeUndefined();
  });
});

describe('the flag survives a save and reload', () => {
  it('round-trips through the schedule file', () => {
    const round = parseScheduleDef(JSON.parse(JSON.stringify(def(true))));
    expect(round.calculated?.[0].yesNo).toBe(true);
  });

  it('a schedule saved before the flag existed still loads', () => {
    const old = JSON.parse(JSON.stringify(def(true)));
    delete old.calculated[0].yesNo;
    const round = parseScheduleDef(old);
    expect(round.calculated?.[0].yesNo).toBeUndefined();
    expect(round.calculated?.[0].formula).toBe('Width > 0.9');
  });
});
