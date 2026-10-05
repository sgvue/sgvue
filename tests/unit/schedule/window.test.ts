// What the Schedules window adds to ifcTable's renderers — 2026-09-25, phase 2. All string
// renderers, so they run here without a DOM.
//
//   · a data row carries its index in the result (`data-row`), and only a data row does, on
//     every render path — itemised, collapsed, grouped with header / footer / blank rows and a
//     grand total — so a click can name the elements behind it and nothing else selects;
//   · the element last clicked marks the one data row that carries it, through any regroup;
//   · the header escapes what it prints and enables undo / redo / Equal width only when they
//     can act;
//   · the rail's saved group marks the setup in use and escapes names;
//   · the formula guide is text only — no link, so nothing in it can navigate the window.

import { beforeEach, describe, expect, it } from 'vitest';
import { StoreBuilder, type ModelStore } from '../../../src/schedule/ifc/store';
import type { Cell, ElemCore, ModelMeta } from '../../../src/schedule/ifc/types';
import { emptySchedule, type Column, type ScheduleDef } from '../../../src/schedule/schedule/def';
import { runSchedule, type DataRow } from '../../../src/schedule/schedule/engine';
import { record, resetHistory } from '../../../src/schedule/history';
import { buildCoverage } from '../../../src/renderer/schedule-ui/coverage';
import { renderHeader, renderStatus } from '../../../src/renderer/schedule-ui/header';
import { formulaHelp } from '../../../src/renderer/schedule-ui/overlays/formulaHelp';
import { renderRail } from '../../../src/renderer/schedule-ui/rail';
import { saveSchedule } from '../../../src/renderer/schedule-ui/schedules';
import { state as blankState, type AppState } from '../../../src/renderer/schedule-ui/state';
import { renderSchedule } from '../../../src/renderer/schedule-ui/tableView';

const meta: ModelMeta = {
  fileName: 'f.ifc', schema: 'IFC4', projectName: '', authoringTool: '',
  lengthUnit: 'mm', unitSystem: 'metric', elementCount: 0, parseMs: 0,
};

/** Six doors: two types over two storeys, so both grouping and collapsing have work to do. */
function build(): ModelStore {
  const b = new StoreBuilder();
  const cores: ElemCore[] = [];
  const cells: Record<string, Cell>[] = [];
  const specs = [['A', 'L1'], ['A', 'L1'], ['B', 'L1'], ['A', 'L2'], ['B', 'L2'], ['B', 'L2']];
  specs.forEach(([type, storey], i) => {
    cores.push({ entity: 'IfcDoor', name: `D${i}`, description: '', mark: String(i),
      typeName: type, family: 'F', objectType: '', predefinedType: 'DOOR',
      guid: `g${i}`, storey, storeyElevation: 0,
      building: '', site: '', space: '', material: '', discipline: 'ARC' });
    cells.push({});
  });
  b.add(cores, cells);
  return b.finish(meta);
}

const store = build();
const colType: Column = { field: { kind: 'core', key: 'typeName' } };
const colStorey: Column = { field: { kind: 'core', key: 'storey' } };

const itemised: ScheduleDef = { ...emptySchedule('Doors', ['IfcDoor']), columns: [colType, colStorey] };
const grouped: ScheduleDef = {
  ...itemised,
  itemize: false,
  grandTotal: true,
  appearance: { blankRowBeforeData: true },
  sort: [{ field: colStorey.field, dir: 'asc', header: true, footer: 'titleCountTotals', blankLine: true }],
};

const stateOf = (over: Partial<AppState>): AppState => ({ ...blankState, store, ...over } as AppState);

function render(def: ScheduleDef, selected: number[] = [], over: Partial<AppState> = {}) {
  const res = runSchedule(store, def);
  const html = renderSchedule(stateOf({ def, selected: new Set(selected), ...over }), res, buildCoverage(store, def.entity));
  return { res, html };
}

/** Every `<tr>` the table drew, with its class and its data-row (or null). */
const rowsOf = (html: string) => [...html.matchAll(/<tr class="([^"]*)"(?: data-row="(\d+)")?>/g)]
  .map((m) => ({ cls: m[1], row: m[2] === undefined ? null : Number(m[2]) }));

describe('a data row names the elements behind it, on every render path', () => {
  it('itemised: every data row carries its own index in the result', () => {
    const { res, html } = render(itemised);
    const drawn = rowsOf(html).filter((r) => r.cls.startsWith('data'));
    expect(drawn).toHaveLength(6);
    for (const r of drawn) expect(res.rows[r.row!].kind).toBe('data');
  });

  it('grouped and collapsed: data rows carry an index, and nothing else does', () => {
    const { res, html } = render(grouped);
    const drawn = rowsOf(html);
    // Header, footer, blank and grand rows are all there — and none carries a data-row.
    for (const kind of ['group', 'footer', 'blank', 'grand']) {
      const these = drawn.filter((r) => r.cls.split(' ')[0] === kind);
      expect(these.length, kind).toBeGreaterThan(0);
      for (const r of these) expect(r.row, kind).toBeNull();
    }
    const data = drawn.filter((r) => r.cls.startsWith('data'));
    // A+L1 (2), B+L1, A+L2, B+L2 (2): four collapsed rows standing for six doors.
    expect(data).toHaveLength(4);
    const counts = data.map((r) => (res.rows[r.row!] as DataRow).rows.length);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(6);
    expect(Math.max(...counts)).toBe(2);
  });
});

describe('the selected elements stay marked through a regroup', () => {
  it('marks exactly the one data row that carries it, itemised or collapsed', () => {
    // Store row 1 is the second A on L1.
    for (const def of [itemised, grouped]) {
      const { res, html } = render(def, [1]);
      const on = rowsOf(html).filter((r) => /\bon\b/.test(r.cls));
      expect(on).toHaveLength(1);
      expect((res.rows[on[0].row!] as DataRow).rows).toContain(1);
    }
  });

  it('marks nothing when nothing was clicked', () => {
    expect(rowsOf(render(grouped).html).some((r) => /\bon\b/.test(r.cls))).toBe(false);
  });
});

describe('the header', () => {
  beforeEach(() => resetHistory(itemised));

  it('escapes the schedule name and the category', () => {
    const hostile = '"><img src=x onerror=alert(1)>';
    const html = renderHeader(stateOf({ def: { ...itemised, name: hostile, entity: [hostile] } }));
    expect(html).not.toContain('<img');
    expect(html).toContain('&quot;&gt;&lt;img');
  });

  it('offers undo only once there is a step to undo', () => {
    const undoOf = (html: string) => html.match(/<button[^>]*data-act="undo"[^>]*>/)![0];
    expect(undoOf(renderHeader(stateOf({ def: itemised })))).toContain('disabled');
    record({ ...itemised, columns: [colType] });
    expect(undoOf(renderHeader(stateOf({ def: itemised })))).not.toContain('disabled');
  });

  it('offers Equal width only once two headings are marked', () => {
    const eq = (cols: number[]) => renderHeader(stateOf({ def: itemised, selectedCols: cols }))
      .match(/<button[^>]*data-act="fit-equal"[^>]*>/)![0];
    expect(eq([0])).toContain('disabled');
    expect(eq([0, 1])).not.toContain('disabled');
    // A mark left behind by a removed column does not count.
    expect(eq([0, 7])).toContain('disabled');
  });

  it('the status line says what the table amounts to', () => {
    const { res } = render(grouped);
    const text = renderStatus(stateOf({ def: grouped }), res, buildCoverage(store, ['IfcDoor']), 3)
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('4 rows');
    expect(text).toContain('6 of 6 elements matched');
    expect(text).toContain('Collapsed from 6 instances by 2 columns');
  });
});

describe('the rail keeps the saved setups under the categories', () => {
  const cell = new Map<string, string>();
  beforeEach(() => {
    cell.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => (cell.has(k) ? cell.get(k)! : null),
        setItem: (k: string, v: string) => { cell.set(k, String(v)); },
        removeItem: (k: string) => { cell.delete(k); },
      },
    });
  });

  it('says so when nothing is saved', () => {
    expect(renderRail(stateOf({ def: itemised }), store)).toContain('Nothing saved yet.');
  });

  it('marks the setup in use, says when it has been edited, and escapes names', () => {
    saveSchedule({ ...itemised, name: 'Doors <b>' }, null);
    const on = renderRail(stateOf({ def: itemised, savedName: 'Doors <b>' }), store);
    expect(on).toContain('rail-saved hv-step on');
    expect(on).toContain('>in use<');
    expect(on).toContain('Doors &lt;b&gt;');
    expect(on).not.toContain('Doors <b>');
    expect(renderRail(stateOf({ def: itemised, savedName: 'Doors <b>', dirty: true }), store)).toContain('>edited<');
  });

  it('a collapsed rail is nothing but the way back', () => {
    const html = renderRail(stateOf({ def: itemised, railOpen: false }), store);
    expect(html).toContain('data-act="rail-toggle"');
    expect(html).not.toContain('data-act="category"');
  });
});

describe('the formula guide', () => {
  it('holds no link, so nothing in it can navigate the window', () => {
    const html = formulaHelp();
    expect(html).toContain('Formula syntax');
    expect(html).not.toMatch(/\bhref=/);
    expect(html).not.toMatch(/ifctable/i);
  });
});
