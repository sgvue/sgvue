// Two more plain-object lookups keyed by text a schedule definition carries — the class audit
// A2 closed in def.ts and fonts.ts (`audit-a2-own-keys.test.ts`).
//
// 1. `formula.ts` looks a function name up as `FNS[word.toLowerCase()]`, so `constructor(1)`,
//    `__proto__(1)`, `toString(1)` … read as known functions and `compile` throws a TypeError
//    where an unknown name such as `nosuchfn(1)` gets the engine's own FormulaError.
// 2. `format.ts` looks a display unit up as `table?.[unit]`, so `display: "toString"` makes the
//    factor a function, the number NaN and the cell blank, where an unknown unit such as "zz"
//    passes the value through unconverted.
//
// Every expectation is the unknown-name case computed here, so the test pins "the same as an
// unknown name", not a message the fix may keep or change.

import { describe, expect, it } from 'vitest';
import { StoreBuilder, type ModelStore } from '../../../src/schedule/ifc/store';
import type { Cell, ElemCore, ModelMeta, UnitKind } from '../../../src/schedule/ifc/types';
import { emptySchedule, type Column, type ScheduleDef } from '../../../src/schedule/schedule/def';
import { calcProblems, planComputed } from '../../../src/schedule/schedule/computed';
import { compile, dimensionOf, FormulaError, referencedNames } from '../../../src/schedule/schedule/formula';
import {
  displayNumber, formatCell, formatNumber, fromDisplay, toDisplay,
} from '../../../src/schedule/schedule/format';
import { runSchedule, type DataRow } from '../../../src/schedule/schedule/engine';

const INHERITED = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf'] as const;
const UNKNOWN_FN = 'nosuchfn';
const UNKNOWN_UNIT = 'zz';

type Outcome = { ok: true } | { ok: false; cls: unknown; message: string };

/** What `compile` does with a formula: compiles, or throws — the error's class and message. */
function compiled(src: string): Outcome {
  try {
    compile(src);
    return { ok: true };
  } catch (error) {
    return { ok: false, cls: (error as object).constructor, message: (error as Error).message };
  }
}

/** The same outcome with a name taken out of its message, so two names compare as one shape. */
function shapeOf(src: string, name: string): Outcome {
  const r = compiled(src);
  return r.ok ? r : { ...r, message: r.message.split(name).join('<name>') };
}

const unnamed = (text: string | undefined, name: string): string | undefined =>
  text?.split(name).join('<name>');

const meta: ModelMeta = {
  fileName: 'f.ifc', schema: 'IFC4', projectName: '', authoringTool: '',
  lengthUnit: 'mm', unitSystem: 'metric', elementCount: 0, parseMs: 0,
};

function build(areas: number[]): ModelStore {
  const b = new StoreBuilder();
  const cores: ElemCore[] = [];
  const cells: Record<string, Cell>[] = [];
  areas.forEach((area, i) => {
    cores.push({ entity: 'IfcSpace', name: `S${i}`, description: '', mark: `M${i}`,
      typeName: 'T1', family: 'Fam', objectType: '', predefinedType: '',
      guid: `g${i}`, storey: 'L1', storeyElevation: 0, building: '', site: '', space: '',
      material: '', discipline: 'ARC',
    });
    cells.push({ 'Qto_SpaceBaseQuantities.NetFloorArea': { v: area, k: 'area' } });
  });
  b.add(cores, cells);
  return b.finish(meta);
}

const colArea = (display: string): Column => ({
  field: { kind: 'prop', pset: 'Qto_SpaceBaseQuantities', prop: 'NetFloorArea' },
  heading: 'Area',
  format: { display, decimals: 2 },
});

const withFormula = (formula: string): ScheduleDef => ({
  ...emptySchedule('S', ['IfcSpace']),
  columns: [colArea('m²'), { field: { kind: 'formula', id: 'c1' } }],
  calculated: [{ id: 'c1', name: 'F', kind: 'formula', unitKind: 'none', formula }],
});

describe('a formula naming a member every object inherits is an unknown function', () => {
  const baseline = shapeOf(`${UNKNOWN_FN}(1)`, UNKNOWN_FN);

  it(`baseline: ${UNKNOWN_FN}(1) is refused with a FormulaError`, () => {
    expect(baseline.ok).toBe(false);
    if (!baseline.ok) expect(baseline.cls).toBe(FormulaError);
  });

  for (const name of INHERITED) {
    for (const spelt of [name, name.toUpperCase()]) {
      it(`compile("${spelt}(1)") is refused as ${UNKNOWN_FN}(1) is, never with a TypeError`, () => {
        const r = shapeOf(`${spelt}(1)`, spelt);
        if (!r.ok) expect(r.cls).not.toBe(TypeError);
        expect(r).toEqual(baseline);
      });
    }

    it(`planComputed reports ${name}(1) as it reports ${UNKNOWN_FN}(1)`, () => {
      const want = planComputed(withFormula(`${UNKNOWN_FN}(1)`)).errors.get('c1');
      const got = planComputed(withFormula(`${name}(1)`)).errors.get('c1');
      expect(want).toBeTruthy();
      expect(unnamed(got, name)).toBe(unnamed(want, UNKNOWN_FN));
    });

    it(`the editor's dimension and name checks treat ${name} as they treat ${UNKNOWN_FN}`, () => {
      const kinds = new Map([['area', 'area']]);
      expect(dimensionOf(`${name}(1)`, kinds)).toEqual(dimensionOf(`${UNKNOWN_FN}(1)`, kinds));
      expect(referencedNames(`${name}(1)`)).toEqual(
        referencedNames(`${UNKNOWN_FN}(1)`).map((n) => (n === UNKNOWN_FN ? name : n)));
    });
  }

  it(`calcProblems (the calculated-value editor's path) reports constructor(1) as ${UNKNOWN_FN}(1)`, () => {
    const store = build([10]);
    const want = calcProblems(store, withFormula(`${UNKNOWN_FN}(1)`)).get('c1');
    const got = calcProblems(store, withFormula('constructor(1)')).get('c1');
    expect(want).toBeTruthy();
    expect(unnamed(got, 'constructor')).toBe(unnamed(want, UNKNOWN_FN));
  });

  it('real functions still compile and run, in any case', () => {
    const vars = new Map<string, number>();
    expect(compile('round(2.345, 2)')(vars)).toBe(2.35);
    expect(compile('ROUND(2.345, 2)')(vars)).toBe(2.35);
    expect(compile('max(1, 7, 3)')(vars)).toBe(7);
    expect(compile('Abs(-4)')(vars)).toBe(4);
    expect(compile('if(1 > 0, 5, 6)')(vars)).toBe(5);
  });
});

describe('a display unit naming a member every object inherits is an unknown unit', () => {
  const cases: [number, UnitKind][] = [[0.9, 'length'], [2.5, 'area'], [1, 'volume'], [Math.PI, 'angle'], [3, 'mass']];

  it(`baseline: the unknown unit "${UNKNOWN_UNIT}" passes the value through`, () => {
    expect(toDisplay(0.9, 'length', UNKNOWN_UNIT)).toBe(0.9);
    expect(fromDisplay(0.9, 'length', UNKNOWN_UNIT)).toBe(0.9);
    expect(formatCell({ v: 0.9, k: 'length' }, { display: UNKNOWN_UNIT, decimals: 2 })).toBe('0.90');
  });

  for (const name of INHERITED) {
    for (const [v, kind] of cases) {
      it(`${kind} with display "${name}" reads as display "${UNKNOWN_UNIT}"`, () => {
        const f = { display: name, decimals: 2 };
        const z = { display: UNKNOWN_UNIT, decimals: 2 };
        const shown = toDisplay(v, kind, name);
        expect(Number.isNaN(shown)).toBe(false);
        expect(shown).toBe(toDisplay(v, kind, UNKNOWN_UNIT));
        expect(fromDisplay(v, kind, name)).toBe(fromDisplay(v, kind, UNKNOWN_UNIT));
        expect(formatNumber(v, kind, f)).not.toBe('');
        expect(formatNumber(v, kind, f)).toBe(formatNumber(v, kind, z));
        expect(displayNumber(v, kind, f)).toBe(displayNumber(v, kind, z));
        expect(formatCell({ v, k: kind }, f)).toBe(formatCell({ v, k: kind }, z));
      });
    }

    it(`a schedule column with display "${name}" prints what "${UNKNOWN_UNIT}" prints`, () => {
      const store = build([10, 2.5]);
      const cells = (display: string): string[] => (runSchedule(store, {
        ...emptySchedule('S', ['IfcSpace']), columns: [colArea(display)],
      }).rows.filter((r) => r.kind === 'data') as DataRow[]).map((d) => d.cells[0]);
      expect(cells(name)).toEqual(cells(UNKNOWN_UNIT));
      expect(cells(name).every((c) => c !== '')).toBe(true);
    });
  }

  it('real display units still convert', () => {
    expect(toDisplay(0.9, 'length', 'mm')).toBeCloseTo(900);
    expect(fromDisplay(900, 'length', 'mm')).toBeCloseTo(0.9);
    expect(toDisplay(1, 'length', 'ft')).toBeCloseTo(3.28084, 4);
    expect(toDisplay(2.5, 'area', 'm²')).toBeCloseTo(2.5);
    expect(formatCell({ v: 1.1, k: 'length' }, { display: 'mm', decimals: 0 })).toBe('1,100');
  });
});
