// Phase 3 of the Schedules window (2026-09-25), on the table's side: two-way selection, the
// row menu, "Colour 3D by this column" and the Model column. Everything here is a pure helper
// or a string renderer, so it runs without a DOM; the wiring is the e2e spec's.

import { describe, expect, it } from 'vitest';
import { StoreBuilder, type ModelStore } from '../../../src/schedule/ifc/store';
import type { Cell, ElemCore, ModelMeta } from '../../../src/schedule/ifc/types';
import { defaultColumnsFor, modelCount, withModelColumn } from '../../../src/schedule/schedule/columns';
import { emptySchedule, type Column, type ScheduleDef } from '../../../src/schedule/schedule/def';
import { runSchedule } from '../../../src/schedule/schedule/engine';
import { presetById, scheduleFromPreset } from '../../../src/schedule/schedule/presets';
import { buildCoverage } from '../../../src/renderer/schedule-ui/coverage';
import { renderStatus } from '../../../src/renderer/schedule-ui/header';
import { renderRail } from '../../../src/renderer/schedule-ui/rail';
import {
  markedRows, nextDataRow, rangeElements, rowMenu, rowOfElement,
} from '../../../src/renderer/schedule-ui/selection';
import { columnGroups, tooManyColours } from '../../../src/schedule/colour';
import { state as blankState, type AppState } from '../../../src/renderer/schedule-ui/state';
import { renderSchedule } from '../../../src/renderer/schedule-ui/tableView';

const meta: ModelMeta = {
  fileName: 'f.ifc', schema: 'IFC4', projectName: '', authoringTool: '',
  lengthUnit: 'mm', unitSystem: 'metric', elementCount: 0, parseMs: 0,
};

/** Six doors over two storeys from two models, and one wall. */
function build(models: string[] = ['ARC', 'STR']): ModelStore {
  const b = new StoreBuilder();
  const cores: ElemCore[] = [];
  const cells: Record<string, Cell>[] = [];
  const specs: [string, string, string][] = [
    ['IfcDoor', 'A', 'L1'], ['IfcDoor', 'A', 'L1'], ['IfcDoor', 'B', 'L1'],
    ['IfcDoor', 'A', 'L2'], ['IfcDoor', 'B', 'L2'], ['IfcDoor', 'B', 'L2'], ['IfcWall', 'W', 'L1'],
  ];
  specs.forEach(([entity, type, storey], i) => {
    cores.push({ entity, name: `E${i}`, description: '', mark: String(i),
      typeName: type, family: 'F', objectType: '', predefinedType: '',
      guid: `g${i}`, storey, storeyElevation: storey === 'L1' ? 0 : 3,
      building: '', site: '', space: '', material: '', discipline: 'ARC', model: models[i % models.length] });
    cells.push({});
  });
  b.add(cores, cells);
  return b.finish(meta);
}

const store = build();
/** Federation id of each store row: anything but the row number, so a mix-up shows. */
const rowIds = store.cores.map((_, r) => 1000 + r * 7);
const colType: Column = { field: { kind: 'core', key: 'typeName' } };
const colStorey: Column = { field: { kind: 'core', key: 'storey' } };
const doors: ScheduleDef = { ...emptySchedule('Doors', ['IfcDoor']), columns: [colType, colStorey] };
const collapsed: ScheduleDef = {
  ...doors, itemize: false,
  sort: [{ field: colStorey.field, dir: 'asc', header: true }],
};
const stateOf = (over: Partial<AppState>): AppState => ({ ...blankState, store, ...over } as AppState);

describe('the rows a selection marks', () => {
  it('itemised: one row per selected element; collapsed: the row that stands for it', () => {
    const res = runSchedule(store, doors);
    expect(markedRows(res, new Set([1, 4]))).toEqual([1, 4]);
    const grouped = runSchedule(store, collapsed);
    const on = markedRows(grouped, new Set([0]));
    expect(on).toHaveLength(1);
    const row = grouped.rows[on[0]];
    expect(row.kind === 'data' && row.rows).toEqual([0, 1]);
    // A selected element in another category marks nothing here.
    expect(markedRows(res, new Set([6]))).toEqual([]);
  });

  it('Shift ranges and the arrow keys walk data rows only, skipping group headers', () => {
    const grouped = runSchedule(store, collapsed);
    const data = grouped.rows.map((r, i) => (r.kind === 'data' ? i : -1)).filter((i) => i >= 0);
    expect(grouped.rows[0].kind).toBe('group');
    expect(nextDataRow(grouped, -1, 1)).toBe(data[0]);
    expect(nextDataRow(grouped, -1, -1)).toBe(data.at(-1));
    // From the last L1 row, down skips the L2 header.
    expect(nextDataRow(grouped, data[1], 1)).toBe(data[2]);
    expect(nextDataRow(grouped, data.at(-1)!, 1)).toBe(-1);
    expect([...rangeElements(grouped, data[2], data[0])].sort()).toEqual([0, 1, 2, 3]);
    expect(rowOfElement(grouped, 5)).toBe(data[3]);
    expect(rowOfElement(grouped, 6)).toBe(-1);
  });
});

describe('the row menu', () => {
  const vis = (hidden: number[], over: Partial<AppState['vis']> = {}): AppState['vis'] =>
    ({ hidden: new Set(hidden), total: 10, storeysClean: true, allShown: !hidden.length, ...over });
  const labels = (items: ReturnType<typeof rowMenu>) =>
    items.map((i) => `${i.label}${i.disabled ? ' ×' : ''}${i.sep ? ' —' : ''}`);

  it('names what it acts on, and disables what would do nothing', () => {
    expect(labels(rowMenu([1, 2], [], vis([])))).toEqual([
      'Select in 3D (2)', 'Zoom to', 'Isolate (2)', 'Hide (2)', 'Show ×', 'Show all ×', 'Copy GUIDs (2) —',
    ]);
    // Already selected, already isolated (the eight others hidden), already hidden.
    const others = [3, 4, 5, 6, 7, 8, 9, 10];
    expect(labels(rowMenu([1, 2], [2, 1], vis(others)))).toEqual([
      'Select in 3D (2) ×', 'Zoom to', 'Isolate (2) ×', 'Hide (2)', 'Show ×', 'Show all', 'Copy GUIDs (2) —',
    ]);
    const items = rowMenu([1, 2, 3], [], vis([2, 3]));
    expect(labels(items)).toEqual([
      'Select in 3D (3)', 'Zoom to', 'Isolate (3)', 'Hide (3)', 'Show (2)', 'Show all', 'Copy GUIDs (3) —',
    ]);
    // Show acts on the hidden ones only.
    expect(items.find((i) => i.kind === 'show')!.ids).toEqual([2, 3]);
    expect(labels(rowMenu([2], [], vis([2])))).toContain('Hide ×');
    expect(labels(rowMenu([2], [], vis([2]))).at(-1)).toBe('Copy GUID —');
  });

  it('Isolate is live again when a storey is off — it resets the storeys', () => {
    const others = [3, 4, 5, 6, 7, 8, 9, 10];
    expect(rowMenu([1, 2], [], vis(others, { storeysClean: false }))
      .find((i) => i.kind === 'isolate')!.disabled).toBe(false);
  });
});

describe('colour 3D by a column', () => {
  it('groups the DISPLAYED values, every element behind a collapsed row, no empty value', () => {
    const grouped = runSchedule(store, collapsed);
    expect(columnGroups(grouped, 0, rowIds)).toEqual([
      { value: 'A', ids: [1000, 1007, 1021] },
      { value: 'B', ids: [1014, 1028, 1035] },
    ]);
    const blank: ScheduleDef = { ...doors, columns: [{ field: { kind: 'core', key: 'description' } }] };
    expect(columnGroups(runSchedule(store, blank), 0, rowIds)).toEqual([]);
  });

  it('refuses a column of more than 100 distinct values, and says how many', () => {
    expect(tooManyColours(100)).toBeNull();
    expect(tooManyColours(4082)).toBe('4,082 distinct values — too many to colour by. Group or narrow the column first.');
  });

  it('every heading is focusable — the keyboard route to its menu', () => {
    const html = renderSchedule(stateOf({ def: doors }), runSchedule(store, doors), buildCoverage(store, ['IfcDoor']));
    const heads = [...html.matchAll(/<th[^>]*data-defcol="\d+"[^>]*>/g)].map((m) => m[0]);
    expect(heads).toHaveLength(2);
    for (const th of heads) expect(th).toContain('tabindex="0"');
  });

  it('draws the colour before each value of the source column, and marks its heading', () => {
    const colours = { live: true, key: 'core|storey', map: new Map([['L1', '#35C4B6'], ['L2', '#E8A33D']]) };
    const res = runSchedule(store, doors);
    const html = renderSchedule(stateOf({ def: doors, colours }), res, buildCoverage(store, ['IfcDoor']));
    expect(html.match(/<span class="sw" style="background:#35C4B6"><\/span>L1/g)).toHaveLength(3);
    expect(html.match(/<span class="sw" style="background:#E8A33D"><\/span>L2/g)).toHaveLength(3);
    // Only that column: the Type cells carry none.
    expect(html).not.toMatch(/<span class="sw"[^>]*><\/span>[AB]</);
    expect(html).toMatch(/<th class="colour-src"[^>]*><span class="hd-sw"/);
    // Another scheme is live, or none: no swatch anywhere.
    for (const other of [{ ...colours, key: null }, { live: false, key: null, map: new Map() }]) {
      const plain = renderSchedule(stateOf({ def: doors, colours: other }), res, buildCoverage(store, ['IfcDoor']));
      expect(plain).not.toContain('class="sw"');
      expect(plain).not.toContain('colour-src');
    }
  });
});

describe('a 3D selection this table does not show', () => {
  it('the status line says so, and the rail marks the category that holds it', () => {
    const res = runSchedule(store, doors);
    const away = stateOf({ def: doors, sel3d: 2, selAway: true, selEntities: ['IfcWall'] });
    const text = renderStatus(away, res, buildCoverage(store, ['IfcDoor']), 1).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('2 selected in 3D · not in this schedule');
    const rail = renderRail(away, store);
    expect(rail).toMatch(/class="rail-item hv-step sel-here" data-act="category" data-entity="IfcWall"/);
    expect(rail).not.toMatch(/sel-here" data-act="category" data-entity="IfcDoor"/);
    // In the table: no note, no mark.
    const here = stateOf({ def: doors, sel3d: 2, selAway: false, selEntities: [] });
    expect(renderStatus(here, res, buildCoverage(store, ['IfcDoor']), 1)).toContain('<span class="sel-note"></span>');
    expect(renderRail(here, store)).not.toContain('sel-here');
  });
});

describe('the Model column', () => {
  it('opens a schedule — the default and a template — on Model when two models are loaded', () => {
    expect(modelCount(store)).toBe(2);
    expect(defaultColumnsFor(store, ['IfcDoor'])[0].field).toEqual({ kind: 'core', key: 'model' });
    const tpl = scheduleFromPreset(presetById('door-schedule')!);
    const cols = withModelColumn(tpl.columns, store);
    expect(cols[0].field).toEqual({ kind: 'core', key: 'model' });
    expect(cols.slice(1)).toEqual(tpl.columns);
    // Never twice.
    expect(withModelColumn(cols, store)).toBe(cols);
  });

  it('adds nothing with one model', () => {
    const one = build(['ARC']);
    expect(modelCount(one)).toBe(1);
    expect(defaultColumnsFor(one, ['IfcDoor']).some((c) => c.field.kind === 'core' && c.field.key === 'model')).toBe(false);
  });

  it('filters like any field — Model = one file keeps that file’s rows', () => {
    const def: ScheduleDef = {
      ...doors, filters: [{ field: { kind: 'core', key: 'model' }, op: '=', value: 'STR' }],
    };
    const res = runSchedule(store, def);
    expect(res.matchedElements).toBe(3);
    expect(res.rows.every((r) => r.kind !== 'data' || r.rows.every((x) => store.cores[x].model === 'STR'))).toBe(true);
  });
});
