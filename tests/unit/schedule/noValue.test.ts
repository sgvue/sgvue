// Placeholder text — '-', '—', '', whitespace, 'n/a', 'none' — is NO value wherever coverage
// is counted (owner decision, 2026-11-05), and only there: the engine still sees the text.
//
// Proven to fail: dropping the `isNoValue` skip from coverage.ts's sweep fails every test in
// "counts as no value"; the engine test is the guard that the rule never leaks further.
//
// Ported from ifcTable's `tests/noValue.test.ts` (Yong Yen, 2026-11-05) for SGVue v1.5.0, phase 2.

import { describe, expect, it } from 'vitest';
import { StoreBuilder, type ModelStore } from '../../../src/schedule/ifc/store';
import type { Cell, ElemCore, ModelMeta } from '../../../src/schedule/ifc/types';
import { emptySchedule, type ScheduleDef } from '../../../src/schedule/schedule/def';
import { runSchedule } from '../../../src/schedule/schedule/engine';
import { state } from '../../../src/renderer/schedule-ui/state';
import { buildCoverage, isNoValue, populated, valuesOf } from '../../../src/renderer/schedule-ui/coverage';
import { pickerModel } from '../../../src/renderer/schedule-ui/pickerModel';
import { remapCandidates } from '../../../src/renderer/schedule-ui/remap';
import { renderViewBar } from '../../../src/renderer/schedule-ui/viewBar';

const N = 12;
const JUNK = ['-', '—', '', '   ', 'n/a', 'N/A', 'None'];
function doors(): ModelStore {
  const b = new StoreBuilder();
  const cores: ElemCore[] = [];
  const cells: Record<string, Cell>[] = [];
  for (let i = 0; i < N; i++) {
    cores.push({
      entity: 'IfcDoor', name: `D${i}`, description: '-', mark: `M${i}`, typeName: 'Single', family: 'Door',
      objectType: '', predefinedType: '', guid: `g${i}`, storey: 'L1', storeyElevation: 0,
      building: '', site: '', space: '', material: '', discipline: 'ARC',
    });
    cells.push({
      'Pset_DoorCommon.Dash': { v: '-' },
      'Pset_DoorCommon.FireRatingX': { v: JUNK[i % JUNK.length] },
      // Half real, half placeholder.
      'Pset_DoorCommon.Comments': { v: i % 2 ? 'Check swing' : JUNK[i % JUNK.length] },
    });
  }
  b.add(cores, cells);
  const meta: ModelMeta = {
    fileName: 'd.ifc', schema: 'IFC4', projectName: '', authoringTool: '', lengthUnit: 'mm',
    unitSystem: 'metric', elementCount: N, parseMs: 0,
  };
  return b.finish(meta);
}

const store = doors();
const cov = buildCoverage(store, ['IfcDoor']);
const prop = (p: string) => ({ kind: 'prop' as const, pset: 'Pset_DoorCommon', prop: p });
const base: ScheduleDef = emptySchedule('Doors', ['IfcDoor']);

describe('placeholder values', () => {
  it('the one list: dash, em dash, blank, whitespace, n/a, none — any case', () => {
    for (const j of JUNK) expect(isNoValue(j), JSON.stringify(j)).toBe(true);
    for (const v of ['0', 'No', 'na', '–', 'FD30', 0, false]) expect(isNoValue(v), JSON.stringify(v)).toBe(false);
  });
});

describe('counts as no value', () => {
  it('a field holding only "-" is 0%, by exact key and by name across psets', () => {
    expect(populated(cov, prop('Dash'))).toBe(0);
    expect(populated(cov, { kind: 'prop', pset: '*', prop: 'dash' })).toBe(0);
    expect(populated(cov, prop('FireRatingX'))).toBe(0);
    expect(populated(cov, prop('Comments'))).toBe(N / 2);
    expect(populated(cov, { kind: 'core', key: 'description' })).toBe(0);
  });

  it('is hidden behind "Show N empty fields", and listed at 0% when shown', () => {
    const q = { query: '', single: false, view: 'list' as const, showEmpty: false, shut: new Set<string>() };
    const ids = (m: ReturnType<typeof pickerModel>) => m.pickable.map((r) => r.id);
    const m = pickerModel(base, store, cov, q);
    expect(ids(m)).not.toContain('prop|Pset_DoorCommon|Dash');
    expect(m.emptyHidden).toBeGreaterThanOrEqual(3);
    const shown = pickerModel(base, store, cov, { ...q, showEmpty: true }).pickable.find((r) => r.id === 'prop|Pset_DoorCommon|Dash');
    expect(shown?.pct).toBe(0);
    expect(pickerModel(base, store, cov, { ...q, query: 'dash' }).onlyEmpty).toBe(1);
  });

  it('a name across psets takes its values from a pset that has real ones', () => {
    const b = new StoreBuilder();
    const core: ElemCore = { entity: 'IfcDoor', name: '', description: '', mark: '', typeName: '', family: '', objectType: '', predefinedType: '',
      guid: 'g', storey: '', storeyElevation: 0, building: '', site: '', space: '', material: '', discipline: 'ARC' };
    // 'A_Pset' sorts and sweeps first and holds only a placeholder; 'B_Pset' has the value.
    b.add([core, { ...core, guid: 'h' }], [{ 'A_Pset.Rating': { v: 'n/a' } }, { 'B_Pset.Rating': { v: 'FD30' } }]);
    const s = b.finish(store.meta);
    const c = buildCoverage(s, ['IfcDoor']);
    expect(valuesOf(c, { kind: 'prop', pset: '*', prop: 'Rating' }, 'metric')?.top).toEqual(['FD30']);
    expect(populated(c, { kind: 'prop', pset: '*', prop: 'Rating' })).toBe(1);
  });

  it('samples drop placeholders', () => {
    expect(valuesOf(cov, prop('Dash'), 'metric')).toBe(null);
    expect(valuesOf(cov, prop('Comments'), 'metric')).toEqual({ top: ['Check swing'], more: 0, capped: false, range: '' });
  });

  it('the fields chip counts a placeholder-only column as empty', () => {
    state.store = store;
    state.def = { ...base, columns: [{ field: prop('Dash') }, { field: prop('Comments') }] };
    expect(renderViewBar(state, store)).toMatch(/<span class="warnc">1 empty<\/span>/);
  });

  it('the remap offer never points a column at a placeholder-only property', () => {
    const def = { ...base, columns: [{ field: prop('FireRating') }] };
    expect(remapCandidates(store, def, cov, 'FireRating').map((c) => c.stat.prop)).toEqual([]);
    expect(remapCandidates(store, def, cov, 'Comment').map((c) => [c.stat.prop, c.stat.count])).toEqual([['Comments', N / 2]]);
  });
});

describe('only coverage', () => {
  it('the engine still sees the text: "has a value" keeps a "-"', () => {
    const def: ScheduleDef = { ...base, itemize: true, columns: [{ field: prop('Dash') }], filters: [{ field: prop('Dash'), op: 'hasValue' }] };
    const res = runSchedule(store, def);
    expect(res.rows.filter((r) => r.kind === 'data')).toHaveLength(N);
  });
});
