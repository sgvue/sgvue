// The view bar's chips and popovers, through the REAL wiring on the fake DOM (see
// tests/support/fakeDom.ts and tests/columnMenu.test.ts for what that does and does not
// prove). Every control a chip popover shows is fired from the popover and must write the
// definition its action writes. A second check proves nothing was lost with the inspector:
// every act its Filter, Sort and Style tabs emitted is drawn in a chip popover.
//
// Proven to fail: dropping `typeOf(...) === 'number'` from the filter-value handler (back to
// trusting `type === 'number'` on the box) fails "filter value"; deleting the sort-move
// handler fails "sort: move later".
//
// Ported from ifcTable's `tests/viewBar.test.ts` (Yong Yen, 2026-11-05) for SGVue v1.5.0,
// phase 2. SGVue's typed edits wait in pending.ts, wired here as in the window; its chips carry
// the window's hover classes, which the markup expectations name. The middle element of each
// case — what ifcTable's old inspector tab sent — is kept as ifcTable's record; SGVue's tabs
// sent the same acts.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as act from '../../../src/schedule/schedule/actions';
import { emptySchedule, type Column, type FilterRule, type ScheduleDef } from '../../../src/schedule/schedule/def';
import { BODY_FONTS } from '../../../src/schedule/schedule/fonts';
import { state } from '../../../src/renderer/schedule-ui/state';
import { buildCoverage } from '../../../src/renderer/schedule-ui/coverage';
import { wireApp } from '../../../src/renderer/schedule-ui/events';
import { flushPending, wirePending } from '../../../src/renderer/schedule-ui/pending';
import { closePopover, wirePopover } from '../../../src/renderer/schedule-ui/popover';
import { openChip, renderViewBar } from '../../../src/renderer/schedule-ui/viewBar';
import { renderViewPopover } from '../../../src/renderer/schedule-ui/viewPopovers';
import { buildStore } from './support/fixture';
import { FakeEl, installFakeDom } from './support/fakeDom';

const { root, win, dispatch } = installFakeDom();
const store = buildStore();
const W = { kind: 'prop', pset: 'Qto_DoorBaseQuantities', prop: 'Width' } as const;
const FR = { kind: 'prop', pset: 'Pset_DoorCommon', prop: 'FireRating' } as const;
const MARK = { kind: 'core', key: 'mark' } as const;
const base: ScheduleDef = {
  ...emptySchedule('Doors', ['IfcDoor']),
  columns: [{ field: MARK }, { field: W }, { field: FR }] as Column[],
  filters: [
    { field: W, op: '>', value: 0.5 },
    { field: FR, op: '=', value: '60 min' },
    { field: W, op: 'between', values: ['', ''] },
    { field: FR, op: 'in', values: [] },
  ] as FilterRule[],
  sort: [{ field: MARK, dir: 'asc' }, { field: W, dir: 'desc' }],
};

const popover = new FakeEl('div', {}, root);
popover.attrs.id = 'popover';

beforeAll(() => {
  wirePending(root as unknown as EventTarget, win as unknown as EventTarget);
  wirePopover(root as unknown as HTMLElement);
  wireApp(root as unknown as HTMLElement, {
    pickRow: () => {}, rowMenu: () => {}, headMenu: () => {}, moveRow: () => {}, frameSelection: () => {},
  });
});
beforeEach(() => {
  vi.useFakeTimers();
  flushPending();
  state.store = store;
  state.def = structuredClone(base);
  closePopover();
});
afterEach(() => { flushPending(); vi.runOnlyPendingTimers(); vi.useRealTimers(); });

type Fire = (el: FakeEl) => void;
const click: Fire = (el) => { dispatch(el, 'pointerdown'); dispatch(el, 'pointerup'); dispatch(el, 'click'); };
const change = (value: string, checked = false): Fire => (el) => { el.value = value; el.checked = checked; dispatch(el, 'change'); };
const typed = (value: string): Fire => (el) => { el.value = value; dispatch(el, 'input'); vi.advanceTimersByTime(250); };
const steps = (...fs: [Record<string, string>, Fire][]) => fs;

/** Fire a sequence of controls, all in one pane, on a fresh copy of the base definition. */
function run(pane: FakeEl, seq: [Record<string, string>, Fire][]): ScheduleDef {
  state.def = structuredClone(base);
  for (const [data, fire] of seq) fire(new FakeEl('input', data, pane));
  return state.def;
}

const fontKey = BODY_FONTS[1].key;
// [name, chip-popover steps, inspector-tab steps, the action's definition]
const CASES: [string, [Record<string, string>, Fire][], [Record<string, string>, Fire][], ScheduleDef][] = [
  ['filter: field', steps([{ act: 'filter-field', i: '0' }, change('core|storey')]), steps([{ act: 'filter-field', i: '0' }, change('core|storey')]),
    act.setFilterField(base, 0, { kind: 'core', key: 'storey' })],
  ['filter: condition', steps([{ act: 'filter-op', i: '0' }, change('<=')]), steps([{ act: 'filter-op', i: '0' }, change('<=')]),
    act.setFilterOp(base, 0, '<=')],
  ['filter: value (typed in mm, stored in m)', steps([{ act: 'filter-value', i: '0' }, typed('900')]), steps([{ act: 'filter-value', i: '0' }, typed('900')]),
    act.setFilterValue(base, 0, 0.9)],
  ['filter: text value', steps([{ act: 'filter-value', i: '1' }, typed('90 min')]), steps([{ act: 'filter-value', i: '1' }, typed('90 min')]),
    act.setFilterValue(base, 1, '90 min')],
  ['filter: between, only the upper end', steps([{ act: 'filter-hi', i: '2' }, typed('1000')]), steps([{ act: 'filter-hi', i: '2' }, typed('1000')]),
    act.setFilterRange(base, 2, 1, 1)],
  ['filter: between, lower end', steps([{ act: 'filter-lo', i: '2' }, typed('800')]), steps([{ act: 'filter-lo', i: '2' }, typed('800')]),
    act.setFilterRange(base, 2, 0, 0.8)],
  ['filter: any of', steps([{ act: 'filter-values', i: '3' }, typed('a, b')]), steps([{ act: 'filter-values', i: '3' }, typed('a, b')]),
    act.setFilterValues(base, 3, ['a', 'b'])],
  ['filter: all / any', steps([{ act: 'filter-logic', v: 'or' }, click]), steps([{ act: 'filter-logic', v: 'or' }, click]),
    act.setFilterMode(base, 'or')],
  ['filter: remove', steps([{ act: 'filter-remove', i: '1' }, click]), steps([{ act: 'filter-remove', i: '1' }, click]),
    act.removeFilterRule(base, 1)],
  ['filter: add on a field', steps([{ act: 'vb-add', v: 'filter', id: 'core|mark' }, click]),
    steps([{ act: 'filter-add' }, click], [{ act: 'filter-field', i: '4' }, change('core|mark')]),
    act.setFilterField(act.addFilterRule(base), 4, MARK)],
  ['sort: field', steps([{ act: 'sort-field', i: '0' }, change('core|storey')]), steps([{ act: 'sort-field', i: '0' }, change('core|storey')]),
    act.setSortField(base, 0, { kind: 'core', key: 'storey' })],
  ['sort: direction', steps([{ act: 'sort-dir', i: '0', v: 'desc' }, click]), steps([{ act: 'sort-dir', i: '0', v: 'desc' }, click]),
    act.setSortDir(base, 0, 'desc')],
  ['sort: header row', steps([{ act: 'sort-header', i: '0' }, change('', true)]), steps([{ act: 'sort-header', i: '0' }, change('', true)]),
    act.setGroupOptions(base, 0, { header: true })],
  ['sort: footer', steps([{ act: 'sort-footer', i: '0' }, change('', true)]), steps([{ act: 'sort-footer', i: '0' }, change('', true)]),
    act.setGroupOptions(base, 0, { footer: 'titleCountTotals' })],
  ['sort: footer style', steps([{ act: 'sort-footer-style', i: '0' }, change('count')]), steps([{ act: 'sort-footer-style', i: '0' }, change('count')]),
    act.setGroupOptions(base, 0, { footer: 'count' })],
  ['sort: blank line', steps([{ act: 'sort-blank', i: '1' }, change('', true)]), steps([{ act: 'sort-blank', i: '1' }, change('', true)]),
    act.setGroupOptions(base, 1, { blankLine: true })],
  ['sort: remove', steps([{ act: 'sort-remove', i: '0' }, click]), steps([{ act: 'sort-remove', i: '0' }, click]),
    act.removeSortLevel(base, 0)],
  ['sort: add on a field', steps([{ act: 'vb-add', v: 'sort', id: 'core|storey' }, click]),
    steps([{ act: 'sort-add' }, click], [{ act: 'sort-field', i: '2' }, change('core|storey')]),
    act.setSortField(act.addSortLevel(base), 2, { kind: 'core', key: 'storey' })],
  ['rows: itemise', steps([{ act: 'itemize' }, change('', false)]), steps([{ act: 'itemize' }, change('', false)]),
    act.setItemize(base, false)],
  ['rows: grand total', steps([{ act: 'grand-total' }, change('', true)]), steps([{ act: 'grand-total' }, change('', true)]),
    act.setGrandTotal(base, true)],
  ['rows: grand total title', steps([{ act: 'grand-title' }, typed('All doors')]), steps([{ act: 'grand-title' }, typed('All doors')]),
    act.setGrandTotalTitle(base, 'All doors')],
  ...(['grid:gridLines', 'outline:outline', 'zebra:zebra', 'blankfirst:blankRowBeforeData',
    'showtitle:showTitle', 'headerbold:headerBold'].map((pair) => {
    const [a, key] = pair.split(':');
    const on = key === 'blankRowBeforeData';
    return [`style: ${key}`, steps([{ act: `app-${a}` }, change('', on)]), steps([{ act: `app-${a}` }, change('', on)]),
      act.setAppearance(base, { [key]: on })] as (typeof CASES)[number];
  })),
  ['style: title', steps([{ act: 'app-title' }, typed('Doors L1')]), steps([{ act: 'app-title' }, typed('Doors L1')]),
    act.setAppearance(base, { title: 'Doors L1' })],
  ['style: text size', steps([{ act: 'app-fontsize' }, typed('15')]), steps([{ act: 'app-fontsize' }, typed('15')]),
    act.setAppearance(base, { fontSize: 15 })],
  ['style: font', steps([{ act: 'app-font' }, change(fontKey)]), steps([{ act: 'app-font' }, change(fontKey)]),
    act.setAppearance(base, { bodyFont: fontKey })],
];

describe('every chip-popover control writes what its action writes', () => {
  // The third element of each case is what the old inspector tab sent for the same choice,
  // kept as a record of the parity M2 was built and reviewed against.
  for (const [name, chip, , want] of CASES) {
    it(name, () => { expect(run(popover, chip)).toEqual(want); });
  }

  it('sort: move later lands in moveSortLevel (the Sort tab moves levels by drag)', () => {
    expect(run(popover, steps([{ act: 'sort-move', i: '0', v: '1' }, click]))).toEqual(act.moveSortLevel(base, 0, 1));
    // At the end: nothing to move into.
    expect(run(popover, steps([{ act: 'sort-move', i: '1', v: '1' }, click]))).toEqual(base);
  });
});

/** Every data-act in a chunk of markup. */
const actsIn = (html: string) => new Set([...html.matchAll(/data-act="([a-z][a-z0-9-]*)"/g)].map((m) => m[1]));

describe('the chip popovers carry every control the Filter, Sort and Style tabs had', () => {
  // The acts the inspector's three tabs emitted when it was removed (M4), bar its own "+ Add"
  // buttons and the level drag handle — each must still be drawn in a chip popover.
  const TAB_ACTS = {
    filter: ['filter-logic', 'filter-field', 'filter-op', 'filter-value', 'filter-lo', 'filter-hi', 'filter-values', 'filter-remove', 'show-removed'],
    sort: ['sort-field', 'sort-dir', 'sort-header', 'sort-footer', 'sort-footer-style', 'sort-blank', 'sort-remove', 'itemize', 'grand-total', 'grand-title'],
    style: ['app-grid', 'app-outline', 'app-zebra', 'app-blankfirst', 'app-showtitle', 'app-headerbold', 'app-title', 'app-fontsize', 'app-font'],
  };
  const cov = () => buildCoverage(store, state.def.entity);
  const chipActs = (kind: string, i?: number) => {
    const btn = new FakeEl('button', { act: 'vb-open', v: kind, ...(i === undefined ? {} : { i: String(i) }) }, root);
    click(btn);
    const html = renderViewPopover(state, store, cov());
    closePopover();
    return actsIn(html);
  };

  it('Filter', () => {
    // Rule 0 is a number (value box); 1 an enum (value select); 2 between; 3 "any of".
    const chip = new Set([0, 1, 2, 3].flatMap((i) => [...chipActs('filter', i)]));
    expect(TAB_ACTS.filter.filter((a) => !chip.has(a))).toEqual([]);
  });

  it('Sort, with the Rows chip', () => {
    state.def = act.setGrandTotal(act.setGroupOptions(state.def, 0, { footer: 'title' }), true);
    const chip = new Set([...chipActs('sort', 0), ...chipActs('rows')]);
    expect(TAB_ACTS.sort.filter((a) => !chip.has(a))).toEqual([]);
  });

  it('Style', () => {
    const chip = chipActs('style');
    expect(TAB_ACTS.style.filter((a) => !chip.has(a))).toEqual([]);
  });
});

describe('the view bar as drawn', () => {
  it('a filter chip reads as a sentence with what it removes; an open end says so', () => {
    state.def = act.setFilterRange(base, 2, 1, 1);
    const html = renderViewBar(state, store).replace(/\s+/g, ' ');
    expect(html).toMatch(/Only where<\/span><span class="v">Width<\/span><span class="k">is at most<\/span><span class="v">1000 mm<\/span><\/button>/);
    // What it removes is its own button in the chip, opening the same popover.
    expect(html).toMatch(/<button class="hv-step" data-act="vb-open" data-v="filter" data-i="2" data-id="removed"[^>]*><span class="removed">−\d+ removed<\/span><\/button>/);
    // The join between chips is the all/any switch, sending the other value.
    expect(html).toMatch(/class="logic hv-accent-sel" data-act="filter-logic" data-v="or"/);
  });

  it('at the caps the adds give way to a hint', () => {
    let d = structuredClone(base);
    while (d.filters.length < 8) d = act.addFilterRule(d);
    while (d.sort.length < 4) d = act.addSortLevel(d);
    state.def = d;
    const html = renderViewBar(state, store);
    expect(html).toMatch(/<span class="vhint">8 filters max<\/span>/);
    expect(html).toMatch(/<span class="vhint">4 levels max<\/span>/);
    expect(html).not.toMatch(/add-filter|add-sort/);
  });

  it('a grouped level reads as grouped, a sort level as sorted', () => {
    state.def = act.setGroupOptions(base, 1, { header: true });
    const html = renderViewBar(state, store);
    expect(html).toMatch(/Sorted by<\/span><span\s+class="v">Tag \(Revit ID\)/);
    expect(html).toMatch(/Grouped by<\/span><span\s+class="v">Width/);
  });

  it('the column menu’s Filter by this opens the new rule’s chip popover', () => {
    click(new FakeEl('button', { act: 'cm-filter', defcol: '2' }, popover));
    expect(state.def.filters.at(-1)).toEqual({ field: FR, op: 'hasValue' });
    expect(openChip()).toEqual({ kind: 'filter', i: 4 });
  });

  it('removing a rule closes its popover rather than show the next one', () => {
    click(new FakeEl('button', { act: 'vb-open', v: 'filter', i: '1' }, root));
    expect(openChip()).toEqual({ kind: 'filter', i: 1 });
    click(new FakeEl('button', { act: 'filter-remove', i: '1' }, popover));
    expect(openChip()).toBe(null);
  });
});

describe('a number filter stores a number, or nothing — never text', () => {
  // A text box gets what people type. "1,200" and "900 mm" used to be stored as strings,
  // which matchRule then read as 1200 and 900 — display units, compared against SI. Proven
  // to fail: the old handler stored "1,200" verbatim.
  const imperial = buildStore('imperial');
  const valueAfter = (raw: string, s = store) => {
    state.store = s;
    state.def = structuredClone(base);
    const box = new FakeEl('input', { act: 'filter-value', i: '0' }, popover);
    box.value = raw;
    dispatch(box, 'input');
    vi.advanceTimersByTime(250);
    return state.def.filters[0].value;
  };
  const rangeAfter = (raw: string, s = store) => {
    state.store = s;
    state.def = structuredClone(base);
    const box = new FakeEl('input', { act: 'filter-hi', i: '2' }, popover);
    box.value = raw;
    dispatch(box, 'input');
    vi.advanceTimersByTime(250);
    return state.def.filters[2].values?.[1];
  };

  it('mm: thousands separators and the unit are read; junk and empty store nothing', () => {
    expect(valueAfter('1,200')).toBeCloseTo(1.2);
    expect(valueAfter('900 mm')).toBeCloseTo(0.9);
    expect(valueAfter(' 900mm ')).toBeCloseTo(0.9);
    expect(valueAfter('abc')).toBe('');
    expect(valueAfter('')).toBe('');
    expect(valueAfter('12 cm')).toBe('');
  });

  it('ft (an imperial model): the same, in feet', () => {
    expect(valueAfter('3 ft', imperial)).toBeCloseTo(0.9144);
    expect(valueAfter('1,200', imperial)).toBeCloseTo(365.76);
    expect(valueAfter('abc', imperial)).toBe('');
    expect(valueAfter('', imperial)).toBe('');
  });

  it('the ends of a between: unreadable is an open end, like an empty one', () => {
    expect(rangeAfter('1,200')).toBeCloseTo(1.2);
    expect(rangeAfter('900 mm')).toBeCloseTo(0.9);
    expect(rangeAfter('abc')).toBe('');
    expect(rangeAfter('')).toBe('');
    expect(rangeAfter('4 ft', imperial)).toBeCloseTo(1.2192);
  });
});
