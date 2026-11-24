// Better defaults for NEW schedules and NEW columns (2026-11-25, step 2 of the one-line bar):
// a new schedule has a grand total, and a new column that holds a quantity — an area, a volume,
// a mass or a count — starts with Total = Sum. One function decides it (`withDefaultTotal`,
// `schedule/columns.ts`), used by every route that makes a column: the field picker and
// "+ Column" (`columnForProp`), a category's default columns, a template, and Vee's
// make_schedule when the ask states no total. Loaded files are never touched: `parseScheduleDef`
// still reads `grandTotal` as written, so a file without it stays off.

import { describe, expect, it } from 'vitest';
import type { PropStat, UnitKind } from '../../../src/schedule/ifc/types';
import { buildSchedule, type Built, type FieldWorld } from '../../../src/schedule/assistant';
import { columnForProp, defaultColumnsFor, openingSchedule, withDefaultTotal } from '../../../src/schedule/schedule/columns';
import { emptySchedule, parseScheduleDef, type Column } from '../../../src/schedule/schedule/def';
import { presetById, scheduleFromPreset } from '../../../src/schedule/schedule/presets';
import { buildStore } from './support/fixture';

const store = buildStore();
const stat = (kind: UnitKind, type: PropStat['type'] = 'number'): PropStat =>
  ({ key: `P.${kind}`, pset: 'P', prop: kind, count: 1, kind, type, distinct: [] });
const totalOf = (cols: Column[], prop: string) =>
  cols.find((c) => c.field.kind === 'prop' && c.field.prop === prop)?.total;

describe('a new schedule has a grand total', () => {
  it('blank', () => { expect(emptySchedule().grandTotal).toBe(true); });
  it('the opening schedule and a category default', () => {
    expect(openingSchedule(store, null).def.grandTotal).toBe(true);
  });
  it('a template, metric and imperial', () => {
    expect(scheduleFromPreset(presetById('floor-schedule')!).grandTotal).toBe(true);
    expect(scheduleFromPreset(presetById('floor-schedule')!, 'imperial').grandTotal).toBe(true);
  });
  it('a loaded file says for itself: absent or false stays off', () => {
    const file = { version: 1, name: 'Old', entity: ['IfcDoor'], columns: [{ field: { kind: 'core', key: 'mark' } }] };
    expect(parseScheduleDef(file).grandTotal).toBe(false);
    expect(parseScheduleDef({ ...file, grandTotal: false }).grandTotal).toBe(false);
    expect(parseScheduleDef({ ...file, grandTotal: true }).grandTotal).toBe(true);
  });
});

describe('a new quantity column starts with Sum', () => {
  it('the one rule: area, volume, mass and count; not length, angle or none', () => {
    const col: Column = { field: { kind: 'prop', pset: 'P', prop: 'x' } };
    const got = (['area', 'volume', 'mass', 'count', 'length', 'angle', 'none'] as UnitKind[])
      .map((k) => withDefaultTotal(col, k).total);
    expect(got).toEqual(['sum', 'sum', 'sum', 'sum', undefined, undefined, undefined]);
  });
  it('a total already stated wins, and the column is not changed in place', () => {
    const col: Column = { field: { kind: 'prop', pset: 'P', prop: 'x' }, total: 'max' };
    expect(withDefaultTotal(col, 'area').total).toBe('max');
    const bare: Column = { field: { kind: 'prop', pset: 'P', prop: 'x' } };
    withDefaultTotal(bare, 'area');
    expect(bare.total).toBeUndefined();
  });
  it('the field picker and + Column (columnForProp)', () => {
    expect(columnForProp(stat('area')).total).toBe('sum');
    expect(columnForProp(stat('volume')).total).toBe('sum');
    expect(columnForProp(stat('mass')).total).toBe('sum');
    expect(columnForProp(stat('count')).total).toBe('sum');
    expect(columnForProp(stat('length')).total).toBeUndefined();
    expect(columnForProp(stat('none', 'text')).total).toBeUndefined();
  });
  it('a category’s default columns', () => {
    const cols = defaultColumnsFor(store, ['IfcSlab']);
    expect(totalOf(cols, 'NetArea')).toBe('sum');
    expect(totalOf(cols, 'NetVolume')).toBe('sum');
    expect(totalOf(cols, 'Width')).toBeUndefined();
    expect(totalOf(cols, 'Perimeter')).toBeUndefined();
  });
  it('a template, by the unit it shows: m² and m³ (ft² and ft³) sum; mm and m do not', () => {
    for (const system of ['metric', 'imperial'] as const) {
      const cols = scheduleFromPreset(presetById('floor-schedule')!, system).columns;
      expect(totalOf(cols, 'NetArea'), system).toBe('sum');
      expect(totalOf(cols, 'NetVolume'), system).toBe('sum');
      expect(totalOf(cols, 'Width'), system).toBeUndefined();
      expect(totalOf(cols, 'Perimeter'), system).toBeUndefined();
    }
    // The constant itself is never written to.
    expect(presetById('floor-schedule')!.columns.every((c) => c.total === undefined)).toBe(true);
  });
});

describe('Vee’s make_schedule', () => {
  const world: FieldWorld = { store, propKeys: [...new Set([...store.propCatalog.values()].map((s) => s.prop))] };
  const make = (ask: Parameters<typeof buildSchedule>[0]): Built => {
    const r = buildSchedule(ask, world, null);
    if ('error' in r) throw new Error(r.error);
    return r;
  };
  it('a new schedule, no totals stated: a grand total, and Sum on the area and volume only', () => {
    const { def } = make({ category: ['IfcSlab'], columns: [{ field: 'Name' }, { field: 'NetArea' }, { field: 'NetVolume' }, { field: 'Perimeter' }] });
    expect(def.grandTotal).toBe(true);
    expect(totalOf(def.columns, 'NetArea')).toBe('sum');
    expect(totalOf(def.columns, 'NetVolume')).toBe('sum');
    expect(totalOf(def.columns, 'Perimeter')).toBeUndefined();
    expect(def.columns[0].total).toBeUndefined();
  });
  it('what the ask states wins: grandTotals false, a total of none or max', () => {
    const { def } = make({
      category: ['IfcSlab'], grandTotals: false,
      columns: [{ field: 'NetArea', total: 'none' }, { field: 'NetVolume', total: 'max' }],
    });
    expect(def.grandTotal).toBe(false);
    expect(totalOf(def.columns, 'NetArea')).toBeUndefined();
    expect(totalOf(def.columns, 'NetVolume')).toBe('max');
  });
});
