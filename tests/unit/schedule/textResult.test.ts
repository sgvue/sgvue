// "Result is a → text" on a calculated value: if(Area > 10, "Large", "Small") keeps the
// words, so a schedule can be grouped, filtered and counted by a label its author invented.
//
// The formula language used to discard any text result at the exit ("always gives a number
// OUT"). Three of that rule's four reasons — no unit, no total, no numeric alignment — were
// already answered the day yes/no arrived, and the fourth (joining text is a spreadsheet's
// job) is kept: `+` still refuses two strings. Text out is classification, not composition.

import { describe, expect, it } from 'vitest';
import { alignForCalc, columnForProp } from '../../../src/schedule/schedule/columns';
import { planComputed } from '../../../src/schedule/schedule/computed';
import { compile } from '../../../src/schedule/schedule/formula';
import {
  emptySchedule, parseScheduleDef, resultOf, type Calculated, type ScheduleDef,
} from '../../../src/schedule/schedule/def';
import { StoreBuilder, type ModelStore } from '../../../src/schedule/ifc/store';
import type { Cell, ElemCore, ModelMeta } from '../../../src/schedule/ifc/types';
// Phase 2 (2026-09-25): the UI helper these cases need is ported now.
import { kindOf, typeOf } from '../../../src/renderer/schedule-ui/panels/shared';

const meta: ModelMeta = {
  fileName: 'f.ifc', schema: 'IFC4', projectName: '', authoringTool: '',
  lengthUnit: 'mm', unitSystem: 'metric', elementCount: 0, parseMs: 0,
};

function store(cells: Record<string, Cell>[]): ModelStore {
  const b = new StoreBuilder();
  b.add(cells.map(() => ({
    entity: 'IfcSpace', name: 'S', description: '', mark: '', typeName: 'T', family: 'F',
    objectType: '', predefinedType: '', guid: 'g', storey: 'L1', storeyElevation: 0,
    building: '', site: '', space: '', material: '', discipline: 'ARC',
  } as ElemCore)), cells);
  return b.finish(meta);
}

const def = (formula: string, extra: Partial<Calculated> = {}): ScheduleDef => ({
  ...emptySchedule('S', ['IfcSpace']),
  columns: [{ field: { kind: 'prop', pset: 'P', prop: 'Area' } }],
  calculated: [{ id: 'c1', name: 'Size', kind: 'formula', formula, ...extra }],
});

/** The computed cell for one room of `area` m². */
const cellFor = (d: ScheduleDef, area: number) =>
  planComputed(d).compute(store([{ 'P.Area': { v: area, k: 'area' } }]), 0).get('formula:c1');

const SIZE = 'if(Area > 10, "Large", "Small")';

describe('a calculated value can answer with words', () => {
  it('keeps the label the formula picked', () => {
    const d = def(SIZE, { result: 'text' });
    expect(cellFor(d, 24)?.v).toBe('Large');
    expect(cellFor(d, 4)?.v).toBe('Small');
  });

  it('carries no unit — a word is not a measurement', () => {
    expect(cellFor(def(SIZE, { result: 'text' }), 24)?.k).toBeUndefined();
  });

  it('blanks the same formula when the column says it holds a number', () => {
    // The declared kind is a contract in both directions, and the default is unchanged:
    // every schedule written before this existed behaves exactly as it did.
    expect(cellFor(def(SIZE), 24)).toBeUndefined();
    expect(cellFor(def(SIZE, { result: 'number' }), 24)).toBeUndefined();
  });

  it('blanks a branch that is not text rather than printing a 0 among the words', () => {
    const d = def('if(Area > 10, "Large", 0)', { result: 'text' });
    expect(cellFor(d, 24)?.v).toBe('Large');
    expect(cellFor(d, 4)).toBeUndefined();
  });

  it('treats an empty branch as no value at all', () => {
    // Two kinds of blank would look identical and compare unequal, so identical-looking
    // rows would refuse to collapse into one. There is only one kind.
    const d = def('if(Area > 10, "Large", "")', { result: 'text' });
    expect(cellFor(d, 4)).toBeUndefined();
  });

  it('nests, which is how the guide says to make a third band', () => {
    // Both of these are printed as recipes in /formula.html, so they are tested here.
    const bands = compile('if(Area > 20, "Large", if(Area > 8, "Medium", "Small"))', 'text');
    const at = (area: number) => bands(new Map([['area', area]]));
    expect(at(24)).toBe('Large');
    expect(at(12)).toBe('Medium');
    expect(at(3)).toBe('Small');
  });

  it('names a match found in a piece of text', () => {
    const label = compile('if(contains(Type, "FD"), "Fire door", "Standard")', 'text');
    expect(label(new Map([['type', 'FD-60 Metal']]))).toBe('Fire door');
    expect(label(new Map([['type', 'Timber']]))).toBe('Standard');
  });

  it('still refuses to join two pieces of text', () => {
    // Composition stays out, with Combined Parameters. `Mark + 1` meaning "1011" in one
    // file and 102 in the next is the silent-wrongness this app exists to avoid.
    expect(compile('Name + "-x"', 'text')(new Map([['name', 'A']]))).toBe(null);
  });
});

describe('one field decides what a result is', () => {
  const calc = (o: Partial<Calculated>): Calculated =>
    ({ id: 'c1', name: 'n', kind: 'formula', ...o });

  it('takes result when it names a kind this build knows', () => {
    expect(resultOf(calc({ result: 'text' }))).toBe('text');
    expect(resultOf(calc({ result: 'yesNo' }))).toBe('yesNo');
    expect(resultOf(calc({ result: 'number' }))).toBe('number');
  });

  it('still reads the flag a schedule saved before result existed', () => {
    expect(resultOf(calc({ yesNo: true }))).toBe('yesNo');
    expect(resultOf(calc({}))).toBe('number');
  });

  it('lets result win over the old flag when a file carries both', () => {
    expect(resultOf(calc({ result: 'text', yesNo: true }))).toBe('text');
  });

  it('opens a kind from some later build as a plain number instead of refusing the file', () => {
    // Forward-leniency applied to a value rather than a key: the schedule still opens, and
    // the one column this build cannot render is blank rather than the whole file rejected.
    expect(resultOf(calc({ result: 'duration' as never }))).toBe('number');
  });
});

describe('the column lines up by what it holds', () => {
  const calc = (o: Partial<Calculated>): Calculated =>
    ({ id: 'c1', name: 'n', kind: 'formula', ...o });

  it('puts words left, a yes/no in the middle and numbers right', () => {
    // Every calculated column used to be right-aligned outright, from when a formula could
    // only be a number — so a column of the word "Small" sat hard against the right rule.
    expect(alignForCalc(calc({ result: 'text' }))).toBe('left');
    expect(alignForCalc(calc({ result: 'yesNo' }))).toBe('center');
    expect(alignForCalc(calc({ result: 'number' }))).toBe('right');
  });

  it('matches what a discovered property of the same type does', () => {
    // Two kinds of column that look like two different apps is the failure this prevents.
    const stat = (type: 'number' | 'bool' | 'text') =>
      ({ pset: 'P', prop: 'X', type, kind: 'none', count: 1, distinct: [] } as never);
    expect(columnForProp(stat('text')).align).toBe(alignForCalc(calc({ result: 'text' })));
    expect(columnForProp(stat('bool')).align).toBe(alignForCalc(calc({ result: 'yesNo' })));
    expect(columnForProp(stat('number')).align).toBe(alignForCalc(calc({ result: 'number' })));
  });

  it('right-aligns a percentage and anything it cannot find', () => {
    expect(alignForCalc(calc({ kind: 'percentage' }))).toBe('right');
    expect(alignForCalc(undefined)).toBe('right');
  });
});

describe('the choice survives a save and reload', () => {
  it('round-trips through the schedule file', () => {
    const round = parseScheduleDef(JSON.parse(JSON.stringify(def(SIZE, { result: 'text' }))));
    expect(round.calculated?.[0].result).toBe('text');
    expect(round.calculated?.[0].formula).toBe(SIZE);
  });
});

describe('if() answers the question people actually ask', () => {
  it('names the simple form instead of counting arguments at them', () => {
    // `if(Area > 10)` is what gets typed, because "if the area is over 10" is the whole
    // thought. "if() takes 3 arguments, got 1" is true and no help whatsoever.
    expect(() => compile('if(Area > 10)')).toThrow(/Result is a.*yes or no/s);
    expect(() => compile('if(Area > 10)')).toThrow(/Area > 10/);
  });

  it('still describes the three parts', () => {
    expect(() => compile('if(Area > 10, 1)')).toThrow(/when yes, when no/);
  });

  it('leaves every other function counting arguments plainly', () => {
    expect(() => compile('round(1, 2, 3)')).toThrow(/round\(\) takes 1 or 2 arguments, got 3/);
  });
});

describe('the column behaves like any other text column', () => {
  const s = store([{ 'P.Area': { v: 24, k: 'area' } }]);
  const field = { kind: 'formula', id: 'c1' } as const;

  it('reports itself as text, so no decimals, no unit and no Sum are offered', () => {
    const d = def(SIZE, { result: 'text' });
    expect(typeOf(s, d, field)).toBe('text');
    expect(kindOf(s, d, field)).toBe('none');
  });

  it('ignores a unit kind left behind by an earlier edit', () => {
    // The dropdown clears unitKind on the way through, but a hand-edited or older file
    // can carry both — and "(mm)" over a column of words is a lie about the data.
    expect(kindOf(s, def(SIZE, { result: 'text', unitKind: 'length' }), field)).toBe('none');
  });

  it('leaves a number column reporting a number', () => {
    expect(typeOf(s, def('Area * 2', { unitKind: 'area' }), field)).toBe('number');
    expect(kindOf(s, def('Area * 2', { unitKind: 'area' }), field)).toBe('area');
  });
});
