// Itemise off, combine by sort value: one row per distinct value of the sort levels, as Revit
// does with "Itemize every instance" unticked (owner-approved 2026-11-24; checks written before
// the build). The approved visual target is the throwaway prototype `prototype/revit-rows/`;
// its 16 made-up doors are rebuilt here.
//
// The agreed shape:
//   · `ScheduleDef.combine?: 'sort'` — absent is today's merge of identical rows; read only with
//     `itemize: false`; `parseScheduleDef` keeps 'sort' and drops anything else;
//   · per visible column of a combined row (the rule as amended on 2026-11-24): a column with a
//     total whose field is not a sort level shows that total over the row's members; else a
//     column whose members' displayed cells are identical shows that text; else `<varies>`
//     (`VARIES`), `mixed[i]` true and `nums[i]` null;
//   · `setCombine(def, 'identical' | 'sort')`, the Rows chip's Combine control and hint, the
//     view bar's Rows chip text, the table's `td.varies`, and every route a definition travels.
//
// Expected texts are not the prototype's formatting: each is read off what the engine shows
// today for the same door with `itemize: true`, and each total off an itemised run's grand
// total over a store holding only that row's doors.
//
// The engine-wide guarantees (every element once, totals for every kind, the seeded oracle,
// colour rules, filters, selection) are in `combine-oracle.test.ts`; Vee's side is in
// `assistant-combine.test.ts`.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { record, redo, resetHistory, setClock, undo } from '../../../src/schedule/history';
import { StoreBuilder, type ModelStore } from '../../../src/schedule/ifc/store';
import type { Cell, ElemCore, ModelMeta } from '../../../src/schedule/ifc/types';
import {
  CurrentMessage, ProjectSchedulesMessage, readSavedList, ToSchedules,
} from '../../../src/schedule/messages';
import * as act from '../../../src/schedule/schedule/actions';
import {
  emptySchedule, parseScheduleDef, type Column, type ScheduleDef, type SortLevel,
} from '../../../src/schedule/schedule/def';
import * as engine from '../../../src/schedule/schedule/engine';
import { runSchedule, type DataRow, type ScheduleResult } from '../../../src/schedule/schedule/engine';
import { toCsv } from '../../../src/schedule/export/csv';
import { fullResult, toRows } from '../../../src/schedule/export/rows';
import { xlsxBlob } from '../../../src/schedule/export/xlsx';
import { esc } from '../../../src/shared/html';
import { projectText, readProject } from '../../../src/shared/project-file';
import { buildCoverage } from '../../../src/renderer/schedule-ui/coverage';
import { wireApp } from '../../../src/renderer/schedule-ui/events';
import { parseScheduleText } from '../../../src/renderer/schedule-ui/exporting';
import { rowsBody } from '../../../src/renderer/schedule-ui/panels/sortSection';
import { flushPending, wirePending } from '../../../src/renderer/schedule-ui/pending';
import { closePopover, wirePopover } from '../../../src/renderer/schedule-ui/popover';
import { listSaved, saveSchedule, setProjectList } from '../../../src/renderer/schedule-ui/schedules';
import { state, state as blankState, type AppState } from '../../../src/renderer/schedule-ui/state';
import { renderSchedule } from '../../../src/renderer/schedule-ui/tableView';
import { fieldLabel, renderViewBar } from '../../../src/renderer/schedule-ui/viewBar';
import { memoryStorage } from '../stub-viewer';
import { FakeEl, installFakeDom } from './support/fakeDom';

const { root, win, dispatch } = installFakeDom();

/* ────────────────────────────── the prototype's 16 made-up doors ────────────────────────────── */

// [type, level, width mm, height mm, fire rating] — the prototype's `DOORS`, in its order.
type Door = [string, string, number, number, string];
const DOORS: Door[] = [
  ['D01 Timber single', 'Level 1', 900, 2100, 'None'], ['D01 Timber single', 'Level 1', 900, 2100, 'None'],
  ['D01 Timber single', 'Level 1', 1000, 2100, 'None'], ['D01 Timber single', 'Level 2', 900, 2100, 'None'],
  ['D01 Timber single', 'Level 2', 900, 2100, '½ hr'], ['D01 Timber single', 'Level 2', 1000, 2100, 'None'],
  ['D02 Timber double', 'Level 1', 1800, 2100, '1 hr'], ['D02 Timber double', 'Level 1', 1800, 2100, '1 hr'],
  ['D02 Timber double', 'Level 2', 1800, 2400, '1 hr'], ['D02 Timber double', 'Level 2', 1800, 2400, '1 hr'],
  ['D03 Glass sliding', 'Level 1', 2400, 2100, 'None'], ['D03 Glass sliding', 'Level 1', 2400, 2100, 'None'],
  ['D03 Glass sliding', 'Level 2', 2400, 2100, 'None'],
  ['D04 Steel fire door', 'Level 1', 1000, 2100, '2 hr'], ['D04 Steel fire door', 'Level 1', 1000, 2100, '2 hr'],
  ['D04 Steel fire door', 'Level 1', 1000, 2100, '2 hr'],
];
const ELEV: Record<string, number> = { 'Level 1': 0, 'Level 2': 3.5 };

const meta: ModelMeta = {
  fileName: 'f.ifc', schema: 'IFC4', projectName: '', authoringTool: '',
  lengthUnit: 'mm', unitSystem: 'metric', elementCount: 0, parseMs: 0,
};

/** The doors as a store: widths and heights in metres, the area in m², as the parser stores them. */
function doorStore(doors: Door[] = DOORS): ModelStore {
  const b = new StoreBuilder();
  const cores: ElemCore[] = [];
  const cells: Record<string, Cell>[] = [];
  doors.forEach(([type, level, w, h, fire], i) => {
    cores.push({ entity: 'IfcDoor', name: `Door ${i}`, description: '', mark: String(i),
      typeName: type, family: 'F', objectType: '', predefinedType: 'DOOR',
      guid: `g${i}`, storey: level, storeyElevation: ELEV[level], building: '', site: '', space: '',
      material: '', discipline: 'ARC',
    });
    cells.push({
      'Pset_DoorCommon.Width': { v: w / 1000, k: 'length' },
      'Pset_DoorCommon.Height': { v: h / 1000, k: 'length' },
      'Pset_DoorCommon.FireRating': { v: fire },
      'Qto_DoorBaseQuantities.Area': { v: (w * h) / 1e6, k: 'area' },
    });
  });
  b.add(cores, cells);
  return b.finish(meta);
}

const colType: Column = { field: { kind: 'core', key: 'typeName' } };
const colLevel: Column = { field: { kind: 'core', key: 'storey' } };
const colW: Column = { field: { kind: 'prop', pset: 'Pset_DoorCommon', prop: 'Width' }, format: { display: 'mm', decimals: 0 } };
const colH: Column = { field: { kind: 'prop', pset: 'Pset_DoorCommon', prop: 'Height' }, format: { display: 'mm', decimals: 0 } };
const colFire: Column = { field: { kind: 'prop', pset: 'Pset_DoorCommon', prop: 'FireRating' }, heading: 'Fire rating' };
const colArea: Column = { field: { kind: 'prop', pset: 'Qto_DoorBaseQuantities', prop: 'Area' }, heading: 'Area', total: 'sum' };
const COLS = [colType, colLevel, colW, colH, colFire, colArea];
const AREA = 5;

const BY_TYPE: SortLevel[] = [{ field: colType.field, dir: 'asc' }];
const BY_LEVEL_TYPE: SortLevel[] = [{ field: colLevel.field, dir: 'asc' }, { field: colType.field, dir: 'asc' }];

/** `combine` is what the build adds to `ScheduleDef`; cast so the checks compile before it. */
type Combine = 'sort' | null;
const doors = (sort: SortLevel[], combine: Combine = 'sort', over: Partial<ScheduleDef> = {}): ScheduleDef =>
  // grandTotal false: this file pins the rows and exports of a schedule without one (a new
  // schedule has a grand total since 2026-11-25).
  ({ ...emptySchedule('Door schedule', ['IfcDoor']), grandTotal: false, columns: COLS, sort, itemize: false, ...(combine ? { combine } : {}), ...over }) as ScheduleDef;
const combineOf = (d: unknown): unknown => (d as { combine?: unknown } | null | undefined)?.combine;

type Combined = DataRow & { mixed?: boolean[]; filled?: number[] };
const data = (res: ScheduleResult) => res.rows.filter((r) => r.kind === 'data') as Combined[];
const V = '<varies>';

const store = doorStore();

/** What each door shows today, itemised, in store order: the source of every expected text. */
const itemised = data(runSchedule(store, { ...doors([], null), itemize: true }, { cap: Infinity }));
const cell = (door: number, col: number) => itemised[door].cells[col];
const num = (door: number, col: number) => itemised[door].nums![col];

/** The trusted total: an itemised run's grand total over a store of only these doors. */
const totalOver = (members: number[], col = AREA) => {
  const sub = doorStore(members.map((i) => DOORS[i]));
  const res = runSchedule(sub, { ...doors([], null), itemize: true, grandTotal: true }, { cap: Infinity });
  const grand = res.rows.find((r) => r.kind === 'grand')!;
  if (grand.kind !== 'grand') throw new Error('no grand row');
  return { text: grand.cells[col] ?? '', num: grand.nums![col] };
};

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);

/**
 * One expected combined row: its members and its cells, `V` where the members differ. The
 * Area column is the total; every other agreed cell's number is its first member's.
 */
function expectRow(line: Combined | undefined, members: number[], cells: (string | typeof V)[], at: string) {
  expect(line, `${at}: no such row`).toBeDefined();
  const l = line!;
  const total = totalOver(members);
  const want = cells.map((c, i) => (i === AREA ? total.text : c));
  expect([at, l.cells]).toEqual([at, want]);
  expect([at, [...l.rows].sort((a, b) => a - b)]).toEqual([at, members]);
  expect([at, l.count]).toEqual([at, members.length]);
  expect([at, (l.mixed ?? want.map(() => false))]).toEqual([at, want.map((c) => c === V)]);
  expect([at, l.nums]).toEqual([at, want.map((c, i) => (c === V ? null : i === AREA ? total.num : num(members[0], i)))]);
}

/* ────────────────────────────── Done 1: the prototype's rows ────────────────────────────── */

describe('the prototype’s 16 doors, itemise off, combine by sort value (Done 1)', () => {
  it('the engine exports the marker text once: VARIES is "<varies>"', () => {
    expect((engine as Record<string, unknown>).VARIES).toBe('<varies>');
  });

  it('sorted by Type: 4 rows — <varies> where the doors differ, Area totalled, a Count', () => {
    const res = runSchedule(store, doors(BY_TYPE));
    const lines = data(res);
    expect(lines).toHaveLength(4);
    expect(res.countColumn).toBe(true);
    expect(res.matchedElements).toBe(16);
    expectRow(lines[0], range(0, 5), [cell(0, 0), V, V, cell(0, 3), V, ''], 'D01');
    expectRow(lines[1], range(6, 9), [cell(6, 0), V, cell(6, 2), V, cell(6, 4), ''], 'D02');
    expectRow(lines[2], range(10, 12), [cell(10, 0), V, cell(10, 2), cell(10, 3), cell(10, 4), ''], 'D03');
    expectRow(lines[3], range(13, 15), [cell(13, 0), cell(13, 1), cell(13, 2), cell(13, 3), cell(13, 4), ''], 'D04');
  });

  it('sorted by Level, then Type: 7 rows', () => {
    const lines = data(runSchedule(store, doors(BY_LEVEL_TYPE)));
    expect(lines).toHaveLength(7);
    const agree = (m: number[]) => [0, 1, 2, 3, 4, 5].map((c) => cell(m[0], c));
    expectRow(lines[0], [0, 1, 2], [cell(0, 0), cell(0, 1), V, cell(0, 3), cell(0, 4), ''], 'L1 D01');
    expectRow(lines[1], [6, 7], agree([6, 7]), 'L1 D02');
    expectRow(lines[2], [10, 11], agree([10, 11]), 'L1 D03');
    expectRow(lines[3], [13, 14, 15], agree([13, 14, 15]), 'L1 D04');
    expectRow(lines[4], [3, 4, 5], [cell(3, 0), cell(3, 1), V, cell(3, 3), V, ''], 'L2 D01');
    expectRow(lines[5], [8, 9], agree([8, 9]), 'L2 D02');
    expectRow(lines[6], [12], agree([12]), 'L2 D03');
  });

  it('no sort level: everything is one row', () => {
    const lines = data(runSchedule(store, doors([])));
    expect(lines).toHaveLength(1);
    expectRow(lines[0], range(0, 15), [V, V, V, V, V, ''], 'all');
  });

  it('a combined row’s rows are all its elements, each once across the table (Done 4)', () => {
    const lines = data(runSchedule(store, doors(BY_TYPE)));
    expect(lines.flatMap((l) => l.rows).sort((a, b) => a - b)).toEqual(range(0, 15));
    for (const l of lines) expect(l.rows).toHaveLength(l.count);
  });

  it('a sort column whose own format shows more than its sort label reads <varies>', () => {
    // 900.1 mm and 900.4 mm both sort under the label "900" (the default 0-decimal mm), so they
    // are one row; the Width column itself shows one decimal, so its cell is not one value.
    const near: Door[] = [['D01 Timber single', 'Level 1', 900.1, 2100, 'None'], ['D01 Timber single', 'Level 1', 900.4, 2100, 'None']];
    const s = doorStore(near);
    const wide: Column = { ...colW, format: { display: 'mm', decimals: 1 } };
    const def = doors([{ field: colW.field, dir: 'asc' }], 'sort', { columns: [colType, wide] });
    const shown = data(runSchedule(s, { ...def, itemize: true }));
    expect(shown.map((l) => l.cells[1])).toHaveLength(2);
    expect(shown[0].cells[1]).not.toBe(shown[1].cells[1]);
    const lines = data(runSchedule(s, def));
    expect(lines).toHaveLength(1);
    expect(lines[0].cells).toEqual([shown[0].cells[0], V]);
    expect(lines[0].mixed).toEqual([false, true]);
    expect(lines[0].nums![1]).toBeNull();
  });

  it('a combined row counts, per visible column, its members whose cell is not blank (filled)', () => {
    const lines = data(runSchedule(store, doors(BY_TYPE)));
    expect(lines.map((l) => l.filled)).toEqual(lines.map((l) => COLS.map(() => l.count)));
  });
});

/* ────────────────────────────── Done 2: without the key, today ────────────────────────────── */

describe('unchanged today — these pass before the build and must keep passing (Done 2)', () => {
  it('itemise off with no combine: today’s 10 lines, rows identical in every visible column', () => {
    const lines = data(runSchedule(store, doors(BY_TYPE, null)));
    expect(lines).toHaveLength(10);
    expect(lines.map((l) => l.count).sort((a, b) => a - b)).toEqual([1, 1, 1, 1, 1, 2, 2, 2, 2, 3]);
    expect(lines.reduce((n, l) => n + l.count, 0)).toBe(16);
    expect(lines.some((l) => l.cells.includes(V))).toBe(false);
  });

  it('itemise on: 16 rows, and combine is ignored', () => {
    const on = runSchedule(store, { ...doors(BY_TYPE, null), itemize: true });
    expect(data(on)).toHaveLength(16);
    expect(runSchedule(store, { ...doors(BY_TYPE), itemize: true })).toEqual(on);
  });

  // Scope corrected by the main agent on 2026-11-24, before the corpus file existed: the first
  // version expected NO file to carry the key, which contradicted the build's own duty to add
  // one that does. Exactly one file may, by name, and it must; every other file must not.
  it('every .schedule.json in the compatibility corpus parses with no combine, except the one written to carry it', () => {
    const root = join(__dirname, '../../fixtures/compat');
    const files = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())
      .flatMap((d) => readdirSync(join(root, d.name)).filter((f) => f.endsWith('.schedule.json')).map((f) => join(d.name, f)));
    const carrier = join('current', 'combined.schedule.json');
    expect(files).toContain(join('current', 'doors.schedule.json'));
    expect(files).toContain(carrier);
    for (const f of files) {
      const def = parseScheduleDef(JSON.parse(readFileSync(join(root, f), 'utf8')));
      expect([f, combineOf(def)]).toEqual([f, f === carrier ? 'sort' : undefined]);
    }
  });
});

/* ────────────────────────────── the save format and the action ────────────────────────────── */

describe('ScheduleDef.combine: kept when "sort", dropped otherwise', () => {
  it('parseScheduleDef keeps combine: "sort", and itemize false beside it', () => {
    const def = parseScheduleDef(JSON.parse(JSON.stringify(doors(BY_TYPE))));
    expect(combineOf(def)).toBe('sort');
    expect(def.itemize).toBe(false);
    expect(def.version).toBe(1);
  });

  it('any other value is dropped (guard: passes today too)', () => {
    for (const v of ['identical', 'Sort', 'type', true, 1, null, {}, ['sort']]) {
      const def = parseScheduleDef({ ...doors(BY_TYPE, null), combine: v });
      expect([v, combineOf(def)]).toEqual([v, undefined]);
    }
  });

  const setCombine = (act as unknown as Record<string, unknown>).setCombine as
    ((def: ScheduleDef, c: 'identical' | 'sort') => ScheduleDef) | undefined;

  it('setCombine(def, "sort") sets the key and changes nothing else; the input is untouched', () => {
    expect(typeof setCombine).toBe('function');
    const before = doors(BY_TYPE, null);
    const copy = structuredClone(before);
    const next = setCombine!(before, 'sort');
    expect(next).toEqual({ ...before, combine: 'sort' });
    expect(before).toEqual(copy);
  });

  it('setCombine(def, "identical") deletes the key', () => {
    expect(typeof setCombine).toBe('function');
    const next = setCombine!(doors(BY_TYPE), 'identical');
    expect(Object.hasOwn(next, 'combine')).toBe(false);
    expect(next).toEqual(doors(BY_TYPE, null));
  });
});

/* ────────────────────────────── Done 3: the Rows chip ────────────────────────────── */

const appState = (def: ScheduleDef): AppState => ({ ...blankState, store, def }) as AppState;
// 2026-11-25 (step 2 of the one-line bar): the Rows popover is ONE choice of three — Every
// element | Merge identical | One row per sort value — where it was the Itemise switch and a
// Combine pair under it. Re-pointed: what each mode draws and says, same meaning.
const modeButtons = (html: string) => [...html.matchAll(/<button\b([^>]*data-act="rows-mode"[^>]*)>([\s\S]*?)<\/button>/g)]
  .map(([, attrs, label]) => ({
    v: attrs.match(/data-v="([^"]*)"/)?.[1],
    on: /class="[^"]*\bseg-btn\b[^"]*\bon\b[^"]*"/.test(attrs),
    pressed: attrs.match(/aria-pressed="([^"]*)"/)?.[1],
    label: label.trim(),
  }));
const hintOf = (html: string) => html.match(/<p class="hint rows-hint">([\s\S]*?)<\/p>/)?.[1];
const chosen = (html: string) => modeButtons(html).filter((b) => b.on).map((b) => b.v);

describe('the Rows chip’s body: one choice of three (Done 3; step 2 of the bar)', () => {
  it('the three choices, in order, as a .seg', () => {
    const html = rowsBody(appState(doors(BY_TYPE, null)));
    expect(html).toMatch(/class="seg"/);
    expect(modeButtons(html).map((b) => [b.v, b.label])).toEqual([
      ['every', 'Every element'], ['merge', 'Merge identical'], ['sort', 'One row per sort value'],
    ]);
  });

  it('itemise on: Every element chosen, and its line', () => {
    const html = rowsBody(appState({ ...doors(BY_TYPE), itemize: true }));
    expect(chosen(html)).toEqual(['every']);
    expect(hintOf(html)).toBe(esc('Every matching element gets its own row.'));
  });

  it('itemise off, identical rows: Merge identical chosen, and its line', () => {
    const html = rowsBody(appState(doors(BY_TYPE, null)));
    expect(chosen(html)).toEqual(['merge']);
    expect(hintOf(html)).toBe(esc('Rows identical in every shown column become one; a Count column says how many.'));
  });

  it('combine by sort: One row per sort value chosen, and the line names the sort fields', () => {
    const html = rowsBody(appState(doors(BY_LEVEL_TYPE)));
    expect(modeButtons(html).map((b) => [b.v, b.on, b.pressed])).toEqual([['every', false, 'false'], ['merge', false, 'false'], ['sort', true, 'true']]);
    expect(hintOf(html)).toBe(esc('One row per Level + Type. A cell that differs reads <varies>; a column with a total shows it. A Count column says how many.'));
    expect(hintOf(rowsBody(appState(doors(BY_TYPE))))).toBe(esc('One row per Type. A cell that differs reads <varies>; a column with a total shows it. A Count column says how many.'));
    expect(html).not.toContain('reads <varies>');
  });

  it('combine by sort with no sort level: everything is one row, and how to split it', () => {
    expect(hintOf(rowsBody(appState(doors([]))))).toBe(esc('No sort level, so everything is one row. Add a sort level to split it.'));
  });
});

describe('the view bar’s Rows chip names the sort fields (Done 3)', () => {
  const chip = (def: ScheduleDef) => {
    state.store = store;
    state.def = def;
    // 2026-11-25, the one-line bar: the Rows chip is an icon button whose name says the mode.
    const m = renderViewBar(state, store).match(/<button class="icon-btn[^"]*" data-act="vb-open" data-v="rows"[^>]*aria-label="Rows: ([^"]*)"/);
    if (!m) throw new Error('no Rows chip');
    return m[1];
  };

  it('the labels it uses are fieldLabel’s own: Type and Level', () => {
    expect(fieldLabel(doors(BY_TYPE), colType.field)).toBe('Type');
    expect(fieldLabel(doors(BY_TYPE), colLevel.field)).toBe('Level');
  });

  it('itemise on and identical rows read as today (guard)', () => {
    expect(chip({ ...doors(BY_TYPE), itemize: true })).toBe('every element');
    expect(chip(doors(BY_TYPE, null))).toBe('identical rows merged');
  });

  it('combine by sort: One row per Type · One row per Level + Type · One row', () => {
    expect(chip(doors(BY_TYPE))).toBe('one row per Type');
    expect(chip(doors(BY_LEVEL_TYPE))).toBe('one row per Level + Type');
    expect(chip(doors([]))).toBe('one row');
  });
});

describe('the Rows choice writes the definition, through the window’s own wiring (Done 3; re-pointed 2026-11-25)', () => {
  const popover = new FakeEl('div', {}, root);
  popover.attrs.id = 'popover';
  beforeAll(() => {
    wirePending(root as unknown as EventTarget, win as unknown as EventTarget);
    wirePopover(root as unknown as HTMLElement);
    wireApp(root as unknown as HTMLElement, {
      pickRow: () => {}, rowMenu: () => {}, headMenu: () => {}, moveRow: () => {}, frameSelection: () => {},
    });
  });
  beforeEach(() => { vi.useFakeTimers(); flushPending(); state.store = store; closePopover(); });
  afterEach(() => { flushPending(); vi.runOnlyPendingTimers(); vi.useRealTimers(); });
  const click = (el: FakeEl) => { dispatch(el, 'pointerdown'); dispatch(el, 'pointerup'); dispatch(el, 'click'); };

  it('One row per sort value sets combine: "sort"', () => {
    state.def = doors(BY_TYPE, null);
    click(new FakeEl('button', { act: 'rows-mode', v: 'sort' }, popover));
    expect(state.def).toEqual(doors(BY_TYPE));
  });

  it('Merge identical takes the key away', () => {
    state.def = doors(BY_TYPE);
    click(new FakeEl('button', { act: 'rows-mode', v: 'merge' }, popover));
    expect(Object.hasOwn(state.def, 'combine')).toBe(false);
    expect(state.def).toEqual(doors(BY_TYPE, null));
  });
});

/* ────────────────────────────── Done 4: the table and every export ────────────────────────────── */

const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
/** Each data row the table drew: its `data-row` and, per cell, its class tokens and its text. */
const drawn = (html: string) => [...html.matchAll(/<tr class="data[^"]*" data-row="(\d+)">([\s\S]*?)<\/tr>/g)].map(([, i, body]) => ({
  index: Number(i),
  tds: [...body.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map(([, attrs, inner]) => ({
    cls: (attrs.match(/class="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean),
    raw: inner,
    text: unescape(inner.replace(/<span class="sw"[^>]*><\/span>/, '')),
  })),
}));
const tableOf = (def: ScheduleDef, res = runSchedule(store, def)) =>
  renderSchedule(appState(def), res, buildCoverage(store, ['IfcDoor']));

describe('the table marks a <varies> cell and escapes it (Done 4)', () => {
  it('td.varies beside num where the column aligns right; the text is &lt;varies&gt;', () => {
    const def = doors(BY_TYPE);
    const rows = drawn(tableOf(def));
    expect(rows).toHaveLength(4);
    const d01 = rows[0].tds;
    // Level (text, left): varies alone. Width (a length with decimals, right): num and varies.
    expect(d01[1].cls).toEqual(['varies']);
    expect(d01[2].cls.sort()).toEqual(['num', 'varies']);
    expect(d01[4].cls).toEqual(['varies']);
    for (const i of [1, 2, 4]) expect(d01[i].raw).toBe('&lt;varies&gt;');
    // An agreed cell and a total carry no varies class.
    expect(d01[3].cls).not.toContain('varies');
    expect(d01[5].cls).not.toContain('varies');
    expect(rows[3].tds.some((td) => td.cls.includes('varies'))).toBe(false);
  });

  it('the screen and every export carry the same cells, <varies> as text', async () => {
    const def = doors(BY_TYPE);
    const screen = data(runSchedule(store, def));
    const shown = drawn(tableOf(def));
    // The table draws exactly the engine's cells, then the count.
    shown.forEach((r, k) => expect(r.tds.map((t) => t.text)).toEqual([...screen[k].cells, String(screen[k].count)]));

    // Exports drop the thousands separator, and nothing else.
    const plain = screen.map((l) => [...l.cells.map((c) => c.replace(/,/g, '')), String(l.count)]);
    const exported = toRows(fullResult(store, def)).filter((r) => r.kind === 'data');
    expect(exported.map((r) => r.cells)).toEqual(plain);
    exported.forEach((r, k) => r.cells.forEach((c, i) => {
      if (c === V) expect([k, i, r.nums![i]]).toEqual([k, i, null]);
    }));

    const csv = toCsv(toRows(fullResult(store, def))).split('\r\n');
    expect(csv.slice(1)).toEqual(plain.map((cells) => cells.join(',')));
    expect(csv[1].split(',').filter((c) => c === V)).toHaveLength(3);

    const blob = await xlsxBlob([{ name: 'Doors', res: fullResult(store, def) }]);
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    const ws = wb.getWorksheet('Doors')!;
    plain.forEach((cells, k) => cells.forEach((c, i) => {
      const value = ws.getRow(k + 2).getCell(i + 1).value;
      if (c === V) expect([k, i, value]).toEqual([k, i, V]);
      else if (typeof value === 'number') expect([k, i, value]).toEqual([k, i, exported[k].nums![i]]);
      else expect([k, i, String(value ?? '')]).toEqual([k, i, c]);
    }));
    // The total is a number in the sheet, the count too.
    expect(typeof ws.getRow(2).getCell(AREA + 1).value).toBe('number');
    expect(ws.getRow(2).getCell(7).value).toBe(6);
  }, 30_000);
});

/* ────────────────────────────── every route a definition travels ────────────────────────────── */

describe('combine: "sort" survives every route', () => {
  const def = doors(BY_TYPE);
  const kept = (d: unknown) => expect([combineOf(d), (d as ScheduleDef).itemize]).toEqual(['sort', false]);

  it('the .schedule.json export text, opened again', () => {
    // The text `exportScheduleFile` writes.
    kept(parseScheduleText(JSON.stringify(def, null, 2)));
  });

  it('the cross-window define message, then the window’s own reader', () => {
    const msg = ToSchedules.safeParse({ type: 'define', kind: 'made', def });
    expect(msg.success).toBe(true);
    if (!msg.success) return;
    kept(parseScheduleDef((msg.data as unknown as { def: unknown }).def));
  });

  it('the window’s current-schedule message, read by the main window', () => {
    const msg = CurrentMessage.safeParse({ type: 'current', def, rowCount: 4 });
    expect(msg.success).toBe(true);
    if (!msg.success) return;
    kept(parseScheduleDef(msg.data.def));
  });

  it('a project’s saved list and open schedule, across the port', () => {
    const entry = { name: 'Door schedule', def, savedAt: '2026-11-24T00:00:00Z' };
    const msg = ProjectSchedulesMessage.safeParse({ type: 'projectSchedules', saved: [entry], open: def });
    expect(msg.success).toBe(true);
    if (!msg.success) return;
    kept(readSavedList(msg.data.saved!)[0].def);
    kept(parseScheduleDef(msg.data.open));
  });

  describe('the Templates library (saved setups)', () => {
    beforeEach(() => { vi.stubGlobal('localStorage', memoryStorage()); });
    afterEach(() => { setProjectList(null); vi.unstubAllGlobals(); });

    it('saved and listed again', () => {
      expect(saveSchedule(def, null)).toBe('Door schedule');
      kept(listSaved()[0].def);
    });
  });

  it('a .sgvue project, its open schedule and a saved setup, saved again', () => {
    const text = readFileSync(join(__dirname, '../../fixtures/project/v1-synthetic.sgvue'), 'utf8');
    const raw = JSON.parse(text) as { schedules: { saved: { def: unknown }[]; open: unknown } };
    raw.schedules.open = def;
    raw.schedules.saved[0].def = { ...def, name: 'Door Schedule 2' };
    const read = readProject(JSON.stringify(raw));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    kept(read.project.schedules.open);
    kept(read.project.schedules.saved[0].def);
    const again = readProject(projectText(read.project));
    expect(again.ok).toBe(true);
    if (again.ok) kept(again.project.schedules.open);
  });
});

/* ────────────────────────────── undo and redo ────────────────────────────── */

describe('undo treats a change of combine as a change', () => {
  let clock = 0;
  beforeEach(() => { clock = 0; setClock(() => clock); });

  it('a change of combine is an undo step, and redo puts it back (guard: passes today)', () => {
    const before = doors(BY_TYPE, null);
    resetHistory(before);
    clock = 5000;
    record(doors(BY_TYPE));
    expect(combineOf(undo())).toBeUndefined();
    expect(combineOf(redo())).toBe('sort');
  });

  it('it is never folded into the typing just before it', () => {
    const before = doors(BY_TYPE, null);
    resetHistory(before);
    const typed = { ...before, columns: [{ ...colType, heading: 'Kind' }, ...COLS.slice(1)] };
    clock = 10;
    record(typed);
    clock = 100;
    record({ ...typed, combine: 'sort' } as ScheduleDef);
    // One undo takes back only the combine: the heading typed before it stays.
    expect(undo()).toEqual(typed);
    expect(undo()).toEqual(before);
  });
});
