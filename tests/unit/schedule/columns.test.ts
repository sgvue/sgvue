import { describe, expect, it } from 'vitest';
import { StoreBuilder, type ModelStore } from '../../../src/schedule/ifc/store';
import type { Cell, ElemCore, ModelMeta, PropStat } from '../../../src/schedule/ifc/types';
import { columnForCore, columnForProp, defaultColumnsFor, defaultEntity, openingSchedule } from '../../../src/schedule/schedule/columns';
import { emptySchedule, type ScheduleDef } from '../../../src/schedule/schedule/def';
// Phase 2 (2026-09-25): the UI helper these cases need is ported now.
import { kindOf, typeOf } from '../../../src/renderer/schedule-ui/panels/shared';

const meta: ModelMeta = {
  fileName: 'f.ifc', schema: 'IFC4', projectName: '', authoringTool: '',
  lengthUnit: 'mm', unitSystem: 'metric', elementCount: 0, parseMs: 0,
};

function build(
  rows: { entity: string; cells?: Record<string, Cell> }[],
  unitSystem: ModelMeta['unitSystem'] = 'metric',
): ModelStore {
  const b = new StoreBuilder();
  const cores: ElemCore[] = [];
  const cells: Record<string, Cell>[] = [];
  rows.forEach((r, i) => {
    cores.push({
      entity: r.entity, name: `E${i}`, description: '', mark: '', typeName: 'T', family: 'F',
      objectType: '', predefinedType: '', guid: `g${i}`, storey: 'L1', storeyElevation: 0,
      building: '', site: '', space: '', material: '', discipline: 'ARC',
    });
    cells.push(r.cells ?? {});
  });
  b.add(cores, cells);
  return b.finish({ ...meta, unitSystem });
}

describe('defaultEntity', () => {
  it('prefers a familiar category over the most populous one', () => {
    // 5 members vs 1 door — a member schedule with no Level is a poor first impression
    const store = build([
      ...Array.from({ length: 5 }, () => ({ entity: 'IfcMember' })),
      { entity: 'IfcDoor' },
    ]);
    expect(defaultEntity(store)).toBe('IfcDoor');
  });

  it('falls back to the most populous when nothing familiar exists', () => {
    const store = build([{ entity: 'IfcPlate' }, { entity: 'IfcPlate' }, { entity: 'IfcMember' }]);
    expect(defaultEntity(store)).toBe('IfcPlate');
  });
});

describe('defaultColumnsFor', () => {
  const door = (cells: Record<string, Cell>) => ({ entity: 'IfcDoor', cells });

  it('prefers dimensions over Yes/No flags', () => {
    const store = build([door({
      'P.Locked': { v: true },
      'P.Width': { v: 0.9, k: 'length' },
    })]);
    const cols = defaultColumnsFor(store, ['IfcDoor']);
    const props = cols.filter((c) => c.field.kind === 'prop').map((c) => (c.field as { prop: string }).prop);
    expect(props.indexOf('Width')).toBeLessThan(props.indexOf('Locked'));
  });

  it('excludes noise properties like Reference', () => {
    const store = build([door({ 'P.Reference': { v: 'X' }, 'P.Width': { v: 1, k: 'length' } })]);
    const props = defaultColumnsFor(store, ['IfcDoor'])
      .filter((c) => c.field.kind === 'prop').map((c) => (c.field as { prop: string }).prop);
    expect(props).not.toContain('Reference');
    expect(props).toContain('Width');
  });

  it('takes one column per property name across psets', () => {
    const store = build([door({
      'Pset_A.Width': { v: 1, k: 'length' },
      'Qto_B.Width': { v: 1, k: 'length' },
    })]);
    const props = defaultColumnsFor(store, ['IfcDoor'])
      .filter((c) => c.field.kind === 'prop').map((c) => (c.field as { prop: string }).prop);
    expect(props.filter((p) => p === 'Width')).toHaveLength(1);
  });

  it('starts with Level, Family, Type', () => {
    const store = build([door({})]);
    const cores = defaultColumnsFor(store, ['IfcDoor'])
      .filter((c) => c.field.kind === 'core').map((c) => (c.field as { key: string }).key);
    expect(cores).toEqual(['storey', 'family', 'typeName']);
  });
});

describe('column factories', () => {
  it('numeric properties right-align with unit formatting', () => {
    const col = columnForProp({
      key: 'P.Width', pset: 'P', prop: 'Width', count: 5, kind: 'length', type: 'number', distinct: [],
    });
    expect(col.align).toBe('right');
    expect(col.format?.display).toBe('mm');
  });

  it('storeyElevation is the numeric core column', () => {
    expect(columnForCore('storeyElevation').align).toBe('right');
    expect(columnForCore('storey').align).toBe('left');
  });

  it('takes its units from the model, defaulting to metric', () => {
    const stat: PropStat = {
      key: 'P.Width', pset: 'P', prop: 'Width', count: 5, kind: 'length', type: 'number', distinct: [],
    };
    expect(columnForProp(stat, 'imperial').format)
      .toEqual({ display: 'ft', decimals: 2, thousands: true });
    expect(columnForProp(stat, 'metric').format)
      .toEqual({ display: 'mm', decimals: 0, thousands: true });
    // Level elevations are the one core field with a unit, and they follow too.
    expect(columnForCore('storeyElevation', 'imperial').format)
      .toEqual({ display: 'ft', decimals: 2 });
    expect(columnForCore('storeyElevation').format).toEqual({ display: 'm', decimals: 3 });
  });
});

describe('a model drawn in feet opens in feet', () => {
  const cells = {
    'Qto.Width': { v: 0.9144, k: 'length' },
    'Qto.NetArea': { v: 2, k: 'area' },
    'Qto.NetVolume': { v: 0.5, k: 'volume' },
  } as Record<string, Cell>;

  /** Each property column's display unit, by property name. */
  const unitsOf = (store: ModelStore) => Object.fromEntries(
    defaultColumnsFor(store, ['IfcDoor'])
      .filter((c) => c.format)
      .map((c) => [(c.field as { prop: string }).prop, c.format!.display]),
  );

  it('defaults every generated column to the imperial units', () => {
    const store = build([{ entity: 'IfcDoor', cells }], 'imperial');
    expect(unitsOf(store)).toEqual({ Width: 'ft', NetArea: 'ft²', NetVolume: 'ft³' });
    const width = defaultColumnsFor(store, ['IfcDoor'])
      .find((c) => (c.field as { prop?: string }).prop === 'Width');
    expect(width!.format).toEqual({ display: 'ft', decimals: 2, thousands: true });
  });

  it('leaves a metric model exactly as it was', () => {
    expect(unitsOf(build([{ entity: 'IfcDoor', cells }])))
      .toEqual({ Width: 'mm', NetArea: 'm²', NetVolume: 'm³' });
  });
});

describe('the schedule a newly opened model shows', () => {
  const armed = (entity: string[]): ScheduleDef => ({
    ...emptySchedule('Wall Schedule', entity),
    columns: [columnForCore('storey')],
  });

  it('keeps the setup the user armed before choosing a file', () => {
    // The whole point: picking a setup on the start screen used to be silently discarded,
    // because opening a model always generated a default over the top of it.
    const store = build([{ entity: 'IfcWall' }, { entity: 'IfcDoor' }]);
    const { def, fits } = openingSchedule(store, armed(['IfcWall']));
    expect(fits).toBe(true);
    expect(def.name).toBe('Wall Schedule');
    expect(def.entity).toEqual(['IfcWall']);
  });

  it('prefers the armed setup even when the model would default elsewhere', () => {
    // IfcDoor outranks IfcWall in PREFERRED_FIRST, so this proves the armed setup wins
    // rather than merely agreeing with the default.
    const store = build([{ entity: 'IfcDoor' }, { entity: 'IfcWall' }]);
    expect(openingSchedule(store, armed(['IfcWall'])).def.entity).toEqual(['IfcWall']);
  });

  it('falls back, and says so, when the model has none of that category', () => {
    // Applying it anyway would open on a blank table with no explanation.
    const store = build([{ entity: 'IfcDoor' }]);
    const { def, fits } = openingSchedule(store, armed(['IfcWall']));
    expect(fits).toBe(false);
    expect(def.entity).toEqual(['IfcDoor']);
    expect(def.name).toBe('Door Schedule');
  });

  it('generates a default when nothing is armed', () => {
    const store = build([{ entity: 'IfcDoor' }]);
    const { def, fits } = openingSchedule(store, null);
    expect(fits).toBe(false);
    expect(def.name).toBe('Door Schedule');
    expect(def.columns.length).toBeGreaterThan(0);
  });

  it('copies the armed setup, so editing the schedule cannot rewrite what was saved', () => {
    const store = build([{ entity: 'IfcWall' }]);
    const source = armed(['IfcWall']);
    const { def } = openingSchedule(store, source);
    def.columns.push(columnForCore('family'));
    expect(source.columns).toHaveLength(1);
  });

  it('survives a model with no elements at all', () => {
    const { def, fits } = openingSchedule(build([]), null);
    expect(fits).toBe(false);
    expect(def.entity).toEqual([]);
    expect(def.columns).toEqual([]);
  });
});

describe('a corrupt saved setup cannot abort a load', () => {
  it('falls back instead of throwing when the stored entity is not an array', () => {
    // Browser storage survives across builds and can be hand-edited. Throwing here would
    // drop the user on the error screen holding a model that parsed perfectly well.
    const store = build([{ entity: 'IfcDoor' }]);
    const junk = { ...emptySchedule('Broken', []), entity: 'IfcWall' } as unknown as ScheduleDef;
    expect(() => openingSchedule(store, junk)).not.toThrow();
    expect(openingSchedule(store, junk).fits).toBe(false);
    expect(openingSchedule(store, junk).def.entity).toEqual(['IfcDoor']);
  });
});

// The "columns resize together only when they hold the same kind of value" suite was
// deleted on 2026-08-20 with widthGroup/widthGroupKey: a grip now drags its own column and
// carries others only when the user has marked them at their headings, so there is no
// derived grouping left to test. Which columns move together is answered by main.ts from
// state.selectedCols, and colResize.ts never learns why.

describe('a formula column knows what it measures', () => {
  // A formula reads the STORED value, which is SI. `Height * 2` on a 2,350 mm door is 4.70
  // — in metres. Before this, a formula field reported unit kind 'none', so the Format
  // panel offered it no unit at all and that 4.70 sat in the table beside a Height column
  // reading 2,350: internally consistent, and wrong by a factor of a thousand to every
  // human who looked at it.
  const store = build([{ entity: 'IfcDoor', cells: { 'P.Height': { v: 2.35, k: 'length' } } }]);
  const withCalc = (unitKind?: 'length' | 'area'): ScheduleDef => ({
    ...emptySchedule('S', ['IfcDoor']),
    calculated: [{ id: 'calc1', name: 'Twice', kind: 'formula', formula: 'Height * 2', unitKind }],
  });
  const field = { kind: 'formula', id: 'calc1' } as const;

  it('takes the unit kind the author declared', () => {
    expect(kindOf(store, withCalc('length'), field)).toBe('length');
    expect(kindOf(store, withCalc('area'), field)).toBe('area');
  });

  it('is a plain number when nothing was declared, never a guess', () => {
    // Guessing is worse than asking: `Width * 2` is a length, `Width * Height` is an area,
    // and the parser cannot tell those apart.
    expect(kindOf(store, withCalc(undefined), field)).toBe('none');
  });

  it('is always numeric, so the column is right-aligned and gets decimals', () => {
    expect(typeOf(store, withCalc('length'), field)).toBe('number');
    expect(typeOf(store, withCalc(undefined), field)).toBe('number');
  });

  it('does not confuse a formula id with a real property', () => {
    expect(kindOf(store, emptySchedule('S', ['IfcDoor']), field)).toBe('none');
  });
});

// The "columns resize together only when they hold the same kind of value" suite was
// deleted on 2026-08-20 with widthGroup/widthGroupKey: a grip now drags its own column and
// carries others only when the user has marked them at their headings, so there is no
// derived grouping left to test. Which columns move together is answered by main.ts from
// state.selectedCols, and colResize.ts never learns why.
