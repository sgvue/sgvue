// Deep review, round 1 (2026-11-25): wrong data a combined-by-sort schedule could show, and
// the decisions taken on them. The reviewer's demonstrations, kept as written, then the checks
// the coordinator added. Written before the fix; 14 of the 20 failed for the reason each states,
// and 6 are guards that passed before it too (the sum / min / max / avg formats, "groups are
// today's", and "an agreed cell keeps its swatch").
//
//   B1. Excel formats a total on a combined row as a footer's total (`totalled`).
//   B2. "Colour 3D by this column" goes by each element's own value on a combined schedule, and
//       a <varies> or total cell carries no swatch.
//   S1. make_schedule's combine: 'sort' switches itemise off; with itemize: true it is refused.
//   Also: a total on a field past the sort-level cap is totalled (the capped levels decide).

import { describe, expect, it } from 'vitest';
import { StoreBuilder, type ModelStore } from '../../../src/schedule/ifc/store';
import type { Cell, ElemCore, ModelMeta } from '../../../src/schedule/ifc/types';
import { emptySchedule, fieldKey, MAX_SORT_LEVELS, type Column, type FieldRef, type ScheduleDef, type SortLevel, type TotalKind } from '../../../src/schedule/schedule/def';
import { runSchedule, type DataRow, type ScheduleResult } from '../../../src/schedule/schedule/engine';
import { fullResult } from '../../../src/schedule/export/rows';
import { xlsxBlob } from '../../../src/schedule/export/xlsx';
import { colourColumn, colourKey } from '../../../src/schedule/colour';
import type { ColourGroup } from '../../../src/schedule/messages';
import { buildCoverage } from '../../../src/renderer/schedule-ui/coverage';
import { state as blankState, type AppState } from '../../../src/renderer/schedule-ui/state';
import { renderSchedule } from '../../../src/renderer/schedule-ui/tableView';
import { federate } from '../../../src/shared/federate';
import { mockModelIndex } from '../../../src/renderer/dev/mock-adapter';
import { snapshotOf } from '../../../src/schedule/adapter';
import { buildSchedule, simplify, type AskSchedule, type FieldWorld } from '../../../src/schedule/assistant';
import { toolByName } from '../../../src/shared/tool-schemas';

const meta: ModelMeta = { fileName: 'f.ifc', schema: 'IFC4', projectName: '', authoringTool: '', lengthUnit: 'mm', unitSystem: 'metric', elementCount: 0, parseMs: 0 };
function storeOf(specs: { type: string; cells: Record<string, Cell> }[]): ModelStore {
  const b = new StoreBuilder();
  const cores: ElemCore[] = specs.map((s, i) => ({
    entity: 'IfcDoor', name: `E${i}`, description: '', mark: '', typeName: s.type, family: 'F',
    objectType: '', predefinedType: 'DOOR', guid: `g${i}`, storey: 'L1', storeyElevation: 0,
    building: '', site: '', space: '', material: '', discipline: 'ARC',
  }));
  b.add(cores, specs.map((s) => s.cells));
  return b.finish(meta);
}
const TYPE: FieldRef = { kind: 'core', key: 'typeName' };
const P = (prop: string): FieldRef => ({ kind: 'prop', pset: 'P', prop });
const BY_TYPE: SortLevel[] = [{ field: TYPE, dir: 'asc' }];
const combined = (columns: Column[], over: Partial<ScheduleDef> = {}): ScheduleDef =>
  ({ ...emptySchedule('S', ['IfcDoor']), columns, sort: BY_TYPE, itemize: false, combine: 'sort', ...over }) as ScheduleDef;
const data = (def: ScheduleDef, s: ModelStore) => runSchedule(s, def).rows.filter((r) => r.kind === 'data') as DataRow[];

describe('B1. Excel: a total on a combined row is formatted as a footer total', () => {
  it('the workbook shows a count as the screen does — a plain integer, never "2 mm" or "2.00 m²"', async () => {
    const s = storeOf([
      { type: 'A', cells: { 'P.W': { v: 0.9, k: 'length' }, 'P.A': { v: 1.5, k: 'area' } } },
      { type: 'A', cells: { 'P.W': { v: 1.0, k: 'length' }, 'P.A': { v: 2.5, k: 'area' } } },
      { type: 'B', cells: { 'P.W': { v: 1.0, k: 'length' }, 'P.A': { v: 2.5, k: 'area' } } },
    ]);
    const def = combined([
      { field: TYPE },
      { field: P('W'), format: { display: 'mm', decimals: 0, showSymbol: true }, total: 'count' },
      { field: P('A'), format: { showSymbol: true }, total: 'countDistinct' },
      { field: { kind: 'core', key: 'name' }, total: 'count' },
    ]);
    // The screen: row A reads "2" and "2" — two doors, two distinct areas.
    expect(data(def, s)[0].cells).toEqual(['A', '2', '2', '2']);

    const blob = await xlsxBlob([{ name: 'S', res: fullResult(s, def) }]);
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    const row = wb.getWorksheet('S')!.getRow(2);
    expect([row.getCell(2).value, row.getCell(3).value]).toEqual([2, 2]);
    // A text column (Name) with a Count total: today '#,##0.00' — Excel draws "2.00".
    expect([row.getCell(4).value, row.getCell(4).numFmt]).toEqual([2, '0']);
    // Today: '#,##0" mm"' and '#,##0.00" m²"' — Excel draws "2 mm" and "2.00 m²".
    expect(row.getCell(2).numFmt).not.toContain('mm');
    expect(row.getCell(3).numFmt).not.toContain('m²');
    expect(row.getCell(3).numFmt).not.toContain('.00');
  }, 30_000);
});

describe('B2. "Colour 3D by this column" on a combined schedule', () => {
  const s = storeOf([
    { type: 'A', cells: { 'P.F': { v: 'None' }, 'P.A': { v: 1.5, k: 'area' } } },
    { type: 'A', cells: { 'P.F': { v: '1 hr' }, 'P.A': { v: 2.5, k: 'area' } } },
    { type: 'B', cells: { 'P.F': { v: 'None' }, 'P.A': { v: 4, k: 'area' } } },
    { type: 'C', cells: { 'P.F': { v: '2 hr' }, 'P.A': { v: 4, k: 'area' } } },
  ]);
  const ids = [100, 101, 102, 103];
  const def = combined([{ field: TYPE }, { field: P('F') }, { field: P('A'), total: 'sum' }]);
  const groupsOf = (d: ScheduleDef, col: number) => {
    const c = colourColumn(s, d, col, ids);
    if (!c || 'error' in c) throw new Error('no colours');
    return c.groups;
  };

  it('<varies> is not a value: no legend entry is called <varies>', () => {
    // Today: [{ value: '<varies>', ids: [100, 101] }, { value: 'None', ids: [102] }, { value: '2 hr', ids: [103] }]
    // — door 100 (None) is not coloured with door 102 (None), and the legend lists "<varies>".
    expect(groupsOf(def, 1).map((g) => g.value)).not.toContain('<varies>');
  });

  it('a totalled column colours each element by a value it carries, not by its row’s total', () => {
    // Today: [{ value: '4.00', ids: [100, 101, 102, 103] }] — the legend, titled "A", says 4.00
    // for doors 100 and 101, whose areas are 1.50 and 2.50 (their row's SUM is 4.00).
    const own = new Map(groupsOf({ ...def, itemize: true }, 2).flatMap((g) => g.ids.map((id) => [id, g.value] as const)));
    for (const g of groupsOf(def, 2)) for (const id of g.ids) expect([id, g.value]).toEqual([id, own.get(id)]);
  });

  it('a swatch from a live colour-by is not drawn beside a row total that only happens to read alike', () => {
    // A colour-by taken while itemised: 1.50, 2.50 and 4.00 each have a colour. Now By sort value:
    // row A's Area cell is the SUM 4.00 of a 1.50 door and a 2.50 door.
    const state = {
      ...blankState, store: s, def,
      colours: { live: true, key: fieldKey(P('A')), map: new Map([['1.50', '#111111'], ['2.50', '#222222'], ['4.00', '#444444']]) },
    } as AppState;
    const html = renderSchedule(state, runSchedule(s, def), buildCoverage(s, ['IfcDoor']));
    const rowA = html.match(/<tr class="data[^"]*" data-row="0">([\s\S]*?)<\/tr>/)![1];
    // Today row A's total carries the #444444 square — the colour of doors 102 and 103, not of its own doors.
    expect(rowA).not.toContain('background:#444444');
  });
});

/* ────────────────────────────── B1, every total kind ────────────────────────────── */

describe('B1. every total kind on a length column with a symbol: the combined row’s cell is the footer’s', () => {
  const s = storeOf([
    { type: 'A', cells: { 'P.W': { v: 0.9, k: 'length' } } },
    { type: 'A', cells: { 'P.W': { v: 1.25, k: 'length' } } },
    { type: 'B', cells: { 'P.W': { v: 1.0, k: 'length' } } },
  ]);
  const KINDS: TotalKind[] = ['sum', 'count', 'countDistinct', 'min', 'max', 'avg'];
  const sheet = async (d: ScheduleDef) => {
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await (await xlsxBlob([{ name: 'S', res: fullResult(s, d) }])).arrayBuffer());
    return wb.getWorksheet('S')!;
  };

  for (const kind of KINDS) {
    it(`${kind}: value and number format equal the footer cell of a group holding the same doors`, async () => {
      const cols: Column[] = [{ field: TYPE }, { field: P('W'), format: { display: 'm', decimals: 2, showSymbol: true }, total: kind }];
      const comb = await sheet(combined(cols));
      // The same doors itemised under a Type footer: rows 2–3 are A's doors, row 4 its footer.
      const foot = await sheet({ ...combined(cols), itemize: true, sort: [{ field: TYPE, dir: 'asc', footer: 'totals' }] } as ScheduleDef);
      expect(String(foot.getRow(2).getCell(1).value)).toBe('A');
      const want = foot.getRow(4).getCell(2);
      const got = comb.getRow(2).getCell(2);
      expect([kind, got.value, got.numFmt]).toEqual([kind, want.value, want.numFmt]);
    }, 30_000);
  }

  it('the engine marks exactly the totalled cells; a line not combined by sort carries no mark', () => {
    const cols: Column[] = [{ field: TYPE }, { field: P('W'), total: 'sum' }];
    const lines = data(combined(cols), s) as (DataRow & { totalled?: boolean[] })[];
    expect(lines.map((l) => l.totalled)).toEqual([[false, true], [false, true]]);
    for (const d of [{ ...combined(cols), itemize: true }, { ...combined(cols), combine: undefined }] as ScheduleDef[]) {
      for (const l of data(d, s) as (DataRow & { totalled?: boolean[] })[]) expect(l.totalled).toBeUndefined();
    }
  });
});

/* ────────────────────────────── B2, the grouping and the swatch ────────────────────────────── */

describe('B2. colourColumn: combined goes by each element, every other definition as before', () => {
  const s = storeOf([
    { type: 'A', cells: { 'P.F': { v: 'None' }, 'P.A': { v: 1.5, k: 'area' } } },
    { type: 'A', cells: { 'P.F': { v: '1 hr' }, 'P.A': { v: 2.5, k: 'area' } } },
    { type: 'B', cells: { 'P.F': { v: 'None' }, 'P.A': { v: 4, k: 'area' } } },
    { type: 'C', cells: { 'P.F': { v: '2 hr' }, 'P.A': { v: 4, k: 'area' } } },
    { type: 'C', cells: { 'P.F': { v: '2 hr' }, 'P.A': { v: 4, k: 'area' } } },
  ]);
  const ids = [100, 101, 102, 103, 104];
  const cols: Column[] = [{ field: TYPE }, { field: P('F') }, { field: P('A'), total: 'sum' }];
  const def = combined(cols);
  const groupsOf = (d: ScheduleDef, col: number) => {
    const c = colourColumn(s, d, col, ids);
    if (!c || 'error' in c) throw new Error('no colours');
    return c.groups;
  };
  /** Today's grouping, written out: each drawn data row's cell, in first-seen order. */
  const direct = (res: ScheduleResult, vi: number): ColourGroup[] => {
    const m = new Map<string, number[]>();
    for (const r of res.rows) {
      if (r.kind !== 'data' || !r.cells[vi]) continue;
      const k = colourKey(r.cells[vi]);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(...r.rows.map((x) => ids[x]));
    }
    return [...m].map(([value, i]) => ({ value, ids: i }));
  };

  it('a combined definition gives exactly the itemised definition’s groups', () => {
    for (const col of [0, 1, 2]) expect([col, groupsOf(def, col)]).toEqual([col, groupsOf({ ...def, itemize: true }, col)]);
  });

  it('without combine — itemise on, and itemise off — the groups are today’s', () => {
    const plain = { ...def } as ScheduleDef;
    delete plain.combine;
    for (const d of [{ ...plain, itemize: true }, plain]) {
      for (const col of [0, 1, 2]) {
        expect([d.itemize, col, groupsOf(d, col)]).toEqual([d.itemize, col, direct(runSchedule(s, d, { cap: Infinity }), col)]);
      }
    }
  });

  it('an agreed cell keeps its swatch; a <varies> cell has none', () => {
    const state = {
      ...blankState, store: s, def,
      colours: { live: true, key: fieldKey(P('F')), map: new Map([['None', '#111111'], ['1 hr', '#222222'], ['2 hr', '#333333']]) },
    } as AppState;
    const html = renderSchedule(state, runSchedule(s, def), buildCoverage(s, ['IfcDoor']));
    const row = (i: number) => html.match(new RegExp(`<tr class="data[^"]*" data-row="${i}">([\\s\\S]*?)</tr>`))![1];
    // A: None and 1 hr — <varies>, no swatch. C: both 2 hr — agreed, its swatch.
    expect(row(0)).not.toContain('class="sw"');
    expect(row(2)).toContain('background:#333333');
  });
});

/* ────────────────────────────── S1, make_schedule ────────────────────────────── */

describe('S1. make_schedule: combine "sort" switches itemise off', () => {
  const fed = federate(['ARC'].map((k) => mockModelIndex(k)));
  const snap = snapshotOf(fed);
  const sb = new StoreBuilder();
  sb.add(snap.cores, snap.cells);
  const world: FieldWorld = { store: sb.finish(snap.meta), propKeys: fed.propKeys };
  const ask = (a: Record<string, unknown>) => a as unknown as AskSchedule;
  const DOORS = { category: ['IfcDoor'], columns: [{ field: 'Type' }, { field: 'Level' }], sortBy: [{ field: 'Type' }] };

  it('combine "sort" with no itemize gives itemize false', () => {
    const r = buildSchedule(ask({ ...DOORS, combine: 'sort' }), world, null);
    if ('error' in r) throw new Error(r.error);
    expect([r.def.itemize, r.def.combine]).toEqual([false, 'sort']);
  });

  it('on an itemised open schedule too', () => {
    const open = buildSchedule(ask({ ...DOORS, itemize: true }), world, null);
    if ('error' in open) throw new Error(open.error);
    const r = buildSchedule(ask({ base: 'open', combine: 'sort' }), world, open.def);
    if ('error' in r) throw new Error(r.error);
    expect([r.def.itemize, r.def.combine]).toEqual([false, 'sort']);
  });

  it('combine "sort" beside itemize true is refused, naming make_schedule: combine and that it needs itemise off', () => {
    const r = buildSchedule(ask({ ...DOORS, itemize: true, combine: 'sort' }), world, null);
    expect('error' in r).toBe(true);
    if (!('error' in r)) return;
    expect(r.error).toMatch(/make_schedule: combine/);
    expect(r.error).toMatch(/itemize false/);
  });

  it('the read-back reports combine only with itemise off', () => {
    const on = { ...emptySchedule('S', ['IfcDoor']), itemize: true, combine: 'sort' } as ScheduleDef;
    expect('combine' in simplify(on)).toBe(false);
    expect(simplify({ ...on, itemize: false })).toMatchObject({ itemize: false, combine: 'sort' });
  });

  it('the combine property’s own description says it switches itemize off', () => {
    const p = (toolByName('make_schedule')!.input_schema.properties as Record<string, { description?: string }>).combine;
    expect(p.description).toMatch(/switches itemize off/);
  });
});

/* ────────────────────────────── the capped sort levels ────────────────────────────── */

describe('a field past the sort-level cap is not a sort level', () => {
  it('its column’s total is totalled on a combined row', () => {
    const s = storeOf([
      { type: 'A', cells: { 'P.A': { v: 1.5, k: 'area' } } },
      { type: 'A', cells: { 'P.A': { v: 2.5, k: 'area' } } },
    ]);
    const pad: SortLevel[] = Array.from({ length: MAX_SORT_LEVELS }, () => ({ field: TYPE, dir: 'asc' }));
    const d = combined([{ field: TYPE }, { field: P('A'), total: 'sum' }], { sort: [...pad, { field: P('A'), dir: 'asc' }] });
    const want = data(combined([{ field: TYPE }, { field: P('A'), total: 'sum' }]), s)[0].cells[1];
    expect(data(d, s).map((l) => l.cells[1])).toEqual([want]);
  });
});
