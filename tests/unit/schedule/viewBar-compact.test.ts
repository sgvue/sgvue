// The one-line view bar (2026-11-25, owner-approved from `prototype/schedule-bar/`): short
// chips, a kept count, an ALL / ANY pill, at most three filter chips with the rest folded into
// `+N`, sort chips with a direction and a group segment, and icon switches on the right.
//
// What this proves: the markup the bar draws for 0, 1, 3 and 5 filters; the short wording for
// every operator; the warning chip; the lit states; the fold-to-fit arithmetic as a pure
// function; that every one-click control runs its existing action and nothing else, through
// the REAL wiring on the fake DOM; and the `+N` popover. What it cannot prove is how the bar
// looks or where a tooltip lands — that needs a window.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as act from '../../../src/schedule/schedule/actions';
import { emptySchedule, MAX_FILTERS, MAX_SORT_LEVELS, type Column, type FilterRule, type ScheduleDef } from '../../../src/schedule/schedule/def';
import { state } from '../../../src/renderer/schedule-ui/state';
import { buildCoverage } from '../../../src/renderer/schedule-ui/coverage';
import { wireApp } from '../../../src/renderer/schedule-ui/events';
import { flushPending, wirePending } from '../../../src/renderer/schedule-ui/pending';
import { anchorPopover, closePopover, popoverId, wirePopover } from '../../../src/renderer/schedule-ui/popover';
import { fitBar, openChip, renderViewBar, shortWords, toggleChipMore } from '../../../src/renderer/schedule-ui/viewBar';
import { ICON } from '../../../src/renderer/schedule-ui/icons';
import { renderViewPopover } from '../../../src/renderer/schedule-ui/viewPopovers';
import { buildStore } from './support/fixture';
import { FakeEl, installFakeDom } from './support/fakeDom';

const { root, win, dispatch } = installFakeDom();
// popover.ts places the popover inside the window.
Object.assign(globalThis, { innerWidth: 1280, innerHeight: 800 });
const store = buildStore();
const W = { kind: 'prop', pset: 'Qto_DoorBaseQuantities', prop: 'Width' } as const;
const FR = { kind: 'prop', pset: 'Pset_DoorCommon', prop: 'FireRating' } as const;
const EXT = { kind: 'prop', pset: 'Pset_DoorCommon', prop: 'IsExternal' } as const;
const MARK = { kind: 'core', key: 'mark' } as const;
const base: ScheduleDef = {
  ...emptySchedule('Doors', ['IfcDoor']),
  columns: [{ field: MARK }, { field: W }, { field: FR }, { field: EXT }] as Column[],
  sort: [{ field: MARK, dir: 'asc' }, { field: W, dir: 'desc', header: true, footer: 'titleCountTotals' }],
};
const withFilters = (filters: FilterRule[], def = base): ScheduleDef => ({ ...structuredClone(def), filters });
/** Five rules, none of them removing every door. */
const FIVE: FilterRule[] = [
  { field: W, op: '>=', value: 0.5 },
  { field: FR, op: 'hasValue' },
  { field: MARK, op: 'contains', value: '1' },
  { field: W, op: '<=', value: 5 },
  { field: FR, op: '!=', value: 'none such' },
];

const popover = new FakeEl('div', {}, root);
popover.attrs.id = 'popover';
const head = new FakeEl('div', {}, root);
head.attrs.id = 'centre-head';

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
  // What one test put in the bar or the popover is not left for the next to find.
  head.children = [];
  popover.children = [];
});
afterEach(() => { flushPending(); vi.runOnlyPendingTimers(); vi.useRealTimers(); });

const click = (el: FakeEl) => { dispatch(el, 'pointerdown'); dispatch(el, 'pointerup'); dispatch(el, 'click'); };
const bar = (def: ScheduleDef) => { state.def = def; return renderViewBar(state, store).replace(/\s+/g, ' '); };
/** Every button the bar draws, as its opening tag. */
const buttons = (html: string) => [...html.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
const filterChips = (html: string) => buttons(html).filter((b) => /data-v="filter"/.test(b));
const say = (r: FilterRule) => shortWords(store, withFilters([r]), r);

describe('short wording for every operator (Done 1)', () => {
  it('numbers carry their unit; symbols for the comparisons', () => {
    expect(say({ field: W, op: '=', value: 0.9 })).toBe('Width = 900 mm');
    expect(say({ field: W, op: '!=', value: 0.9 })).toBe('Width ≠ 900 mm');
    expect(say({ field: W, op: '>', value: 0.9 })).toBe('Width > 900 mm');
    expect(say({ field: W, op: '>=', value: 0.9 })).toBe('Width ≥ 900 mm');
    expect(say({ field: W, op: '<', value: 0.9 })).toBe('Width < 900 mm');
    expect(say({ field: W, op: '<=', value: 0.9 })).toBe('Width ≤ 900 mm');
  });

  it('between: both ends, one open end (at most / at least), none', () => {
    expect(say({ field: W, op: 'between', values: [0.8, 1] })).toBe('Width between 800 – 1000 mm');
    expect(say({ field: W, op: 'between', values: ['', 1] })).toBe('Width at most 1000 mm');
    expect(say({ field: W, op: 'between', values: [0.8, ''] })).toBe('Width at least 800 mm');
    expect(say({ field: W, op: 'between', values: ['', ''] })).toBe('Width between any');
  });

  it('text: short words, the value quoted where it is a piece of the text', () => {
    expect(say({ field: MARK, op: '=', value: 'D-01' })).toMatch(/ = D-01$/);
    expect(say({ field: MARK, op: 'contains', value: 'D' })).toMatch(/ contains “D”$/);
    expect(say({ field: MARK, op: 'startsWith', value: 'D' })).toMatch(/ starts with “D”$/);
    expect(say({ field: MARK, op: 'endsWith', value: '1' })).toMatch(/ ends with “1”$/);
    expect(say({ field: MARK, op: 'contains', value: '' })).toMatch(/ contains …$/);
    expect(say({ field: FR, op: 'in', values: ['60 min', '90 min'] })).toMatch(/ any of 60 min, 90 min$/);
    expect(say({ field: FR, op: 'in', values: [] })).toMatch(/ any of …$/);
  });

  it('presence and yes / no', () => {
    expect(say({ field: FR, op: 'hasValue' })).toMatch(/ has value$/);
    expect(say({ field: FR, op: 'noValue' })).toMatch(/ no value$/);
    expect(say({ field: EXT, op: '=', value: 'true' })).toMatch(/ = Yes$/);
    expect(say({ field: EXT, op: '!=', value: 'false' })).toMatch(/ ≠ No$/);
  });
});

describe('the bar for 0, 1, 3 and 5 filters (Done 1)', () => {
  it('0 filters: funnel and count, no pill, no chip, a + to add', () => {
    const html = bar(withFilters([]));
    expect(html).toMatch(/<span class="vcount[^"]*"[^>]*>.*?<svg.*?<\/svg><span><b>9<\/b> of 9<\/span><\/span>/);
    expect(html).not.toMatch(/data-act="filter-logic"/);
    expect(filterChips(html)).toEqual([]);
    expect(html).not.toMatch(/class="vchip fold/);
    expect(html).toMatch(/<button class="vplus[^"]*" data-act="vb-open" data-v="add-filter"/);
  });

  it('1 filter: one short chip, still no pill', () => {
    const html = bar(withFilters([{ field: W, op: '>=', value: 0.9 }]));
    expect(html).not.toMatch(/data-act="filter-logic"/);
    expect(filterChips(html)).toHaveLength(1);
    expect(html).toMatch(/<span class="f">Width<\/span><span class="k">≥<\/span><span class="v">900 mm<\/span>/);
    // No sentence, no "−N removed", no × on the chip.
    expect(html).not.toMatch(/>Only where|removed<|data-act="filter-remove"/);
  });

  it('3 filters: three chips and the ALL / ANY pill', () => {
    const html = bar(withFilters(FIVE.slice(0, 3)));
    expect(filterChips(html)).toHaveLength(3);
    expect(html).not.toMatch(/class="vchip fold/);
    expect(html).toMatch(/<button class="logic[^"]*" data-act="filter-logic"[^>]*>All<\/button>/);
    expect(bar({ ...withFilters(FIVE.slice(0, 3)), filterLogic: 'or' })).toMatch(/data-act="filter-logic"[^>]*>Any<\/button>/);
  });

  it('5 filters: three chips and +2', () => {
    const html = bar(withFilters(FIVE));
    expect(filterChips(html).map((b) => attr(b, 'data-i'))).toEqual(['0', '1', '2']);
    expect(html).toMatch(/<span class="vchip fold"><button class="hv-step" data-act="vb-open" data-v="fold"[^>]*>\+2<\/button><\/span>/);
  });

  it('the +N tooltip lists the folded rules in short words', () => {
    const def = withFilters(FIVE);
    const b = buttons(bar(def)).find((x) => /data-v="fold"/.test(x))!;
    expect(attr(b, 'data-tip')).toBe([FIVE[3], FIVE[4]].map((r) => shortWords(store, def, r)).join(' · ').replace(/"/g, '&quot;'));
    expect(attr(b, 'aria-label')).toBe('2 more filters');
  });

  it('the kept count is the elements the filters keep, of the category', () => {
    // Width ≥ 2 m keeps no door: 0 of 9.
    expect(bar(withFilters([{ field: W, op: '>=', value: 2 }]))).toMatch(/<b>0<\/b> of 9/);
    expect(bar(withFilters([{ field: W, op: '>=', value: 2 }]))).toMatch(/class="vcount zero"/);
  });

  it('the two add buttons say what they add: "+ Filter" and "+ Sort / group"', () => {
    const plus = [...bar(withFilters([])).matchAll(/<button class="vplus[\s\S]*?<\/button>/g)].map((m) => m[0]);
    expect(plus).toHaveLength(2);
    // The words are the button's whole content: nothing else between its tag and </button>.
    expect(plus[0]).toMatch(/^<button [^>]*>\+ Filter<\/button>$/);
    expect(plus[1]).toMatch(/^<button [^>]*>\+ Sort \/ group<\/button>$/);
  });

  it('at the caps the + is disabled and says so', () => {
    let d = withFilters([]);
    while (d.filters.length < MAX_FILTERS) d = act.addFilterRule(d);
    while (d.sort.length < MAX_SORT_LEVELS) d = act.addSortLevel(d);
    const html = bar(d);
    const plus = buttons(html).filter((b) => /class="vplus/.test(b));
    expect(plus).toHaveLength(2);
    for (const b of plus) expect(b).toMatch(/\sdisabled/);
    expect(attr(plus[0], 'data-tip')).toBe(`${MAX_FILTERS} filters is the most a schedule holds`);
    expect(attr(plus[1], 'data-tip')).toBe(`${MAX_SORT_LEVELS} sort levels is the most a schedule holds`);
  });
});

describe('a rule that removes every row it decides is a warning (Done 1)', () => {
  const dead: FilterRule = { field: W, op: '>=', value: 2 };
  it('its own chip', () => {
    const html = bar(withFilters([dead, { field: FR, op: 'hasValue' }]));
    expect(html).toMatch(/<span class="vchip filter alert"><button[^>]*data-i="0"/);
    expect(html).toMatch(/<span class="vchip filter"><button[^>]*data-i="1"/);
  });
  it('the +N chip, when the rule is folded inside it', () => {
    const html = bar(withFilters([...FIVE.slice(0, 4), dead]));
    expect(html).toMatch(/<span class="vchip fold alert">/);
    expect(bar(withFilters(FIVE))).toMatch(/<span class="vchip fold">/);
  });
});

describe('sort chips and the switches (Done 1)', () => {
  it('a sort chip is its name, an arrow segment and a group segment; no level number', () => {
    const html = bar(withFilters([]));
    const sort = buttons(html).filter((b) => /data-act="(vb-open" data-v="sort|sort-dir|sort-group)"/.test(b));
    expect(sort.map((b) => attr(b, 'data-act'))).toEqual(['vb-open', 'sort-dir', 'sort-group', 'vb-open', 'sort-dir', 'sort-group']);
    expect(html).not.toMatch(/lvl-n/);
    expect(attr(sort[0], 'data-tip')).toMatch(/^Sorted first by Tag/);
    expect(attr(sort[3], 'data-tip')).toMatch(/^Then sorted by Width/);
    // Level 1 is not grouped; level 2 is (header + footer), and its group segment is lit.
    expect(sort[2]).not.toMatch(/class="[^"]*\bon\b/);
    expect(attr(sort[2], 'aria-pressed')).toBe('false');
    expect(sort[5]).toMatch(/class="[^"]*\bon\b/);
    expect(attr(sort[5], 'aria-pressed')).toBe('true');
    // The arrow says which way it sorts now.
    expect(attr(sort[1], 'aria-label')).toMatch(/A to Z/);
    expect(attr(sort[4], 'aria-label')).toMatch(/Z to A/);
  });

  it('Σ, grid lines and stripes are lit when on', () => {
    const lit = (def: ScheduleDef, a: string) => {
      const b = buttons(bar(def)).find((x) => attr(x, 'data-act') === a)!;
      return [/class="[^"]*\bon\b/.test(b), attr(b, 'aria-pressed')];
    };
    const off: ScheduleDef = { ...base, grandTotal: false, appearance: { gridLines: false, zebra: false } };
    const on: ScheduleDef = { ...base, grandTotal: true, appearance: { gridLines: true, zebra: true } };
    for (const a of ['grand-total', 'app-grid', 'app-zebra']) {
      expect(lit(off, a), a).toEqual([false, 'false']);
      expect(lit(on, a), a).toEqual([true, 'true']);
    }
  });

  it('the columns button counts shown columns and keeps the hidden / empty news in its tooltip', () => {
    const def: ScheduleDef = { ...base, columns: [...base.columns.slice(0, 3), { field: EXT, hidden: true }] };
    const b = buttons(bar(def)).find((x) => /data-v="picker"/.test(x))!;
    expect(attr(b, 'aria-label')).toBe('Columns, 3 shown');
    expect(attr(b, 'data-tip')).toMatch(/3 shown of \d+ fields · 1 hidden/);
  });
});

describe('every control on the bar has a fast tooltip and a name, never a title (Done 7)', () => {
  it('buttons and the kept count', () => {
    const def: ScheduleDef = { ...withFilters(FIVE), grandTotal: true };
    const html = bar(def);
    expect(html).not.toMatch(/\stitle=/);
    const controls = [...buttons(html), ...[...html.matchAll(/<span class="vcount[^>]*>/g)].map((m) => m[0])];
    expect(controls.length).toBeGreaterThan(15);
    for (const c of controls) {
      expect(attr(c, 'data-tip'), c).toMatch(/\S/);
      expect(attr(c, 'aria-label'), c).toMatch(/\S/);
    }
  });

  it('a filter chip’s tooltip is the full sentence and what it removes', () => {
    const html = bar(withFilters([{ field: W, op: '>=', value: 0.9 }, { field: W, op: '>=', value: 2 }]));
    const [a, b] = filterChips(html);
    expect(attr(a, 'data-tip')).toMatch(/^Only where Width is greater than or equal to 900 mm · removes \d+ elements?\. Click to change it$/);
    expect(attr(b, 'data-tip')).toMatch(/removes every element it decides \(\d+\)/);
  });
});

describe('the CSS keeps the bar on one line and its tooltips unclipped (Done 2, 7)', () => {
  const css = readFileSync(resolve(__dirname, '../../../src/renderer/schedule-ui/schedule.css'), 'utf8');
  const rule = (sel: string) => {
    const at = css.indexOf(`\n${sel} {`);
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
  };
  it('the bar never wraps and clips nothing', () => {
    expect(rule('.viewbar')).toMatch(/flex-wrap: nowrap/);
    expect(rule('.viewbar')).not.toMatch(/overflow/);
    expect(rule('.viewbar .vchip')).toMatch(/overflow: visible/);
  });
  it('an open control hides its tooltip; the flash stops under reduced motion', () => {
    expect(css).toMatch(/\.viewbar \[aria-expanded="true"\]\[data-tip\]::after \{ display: none; \}/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.vcount\.bump b \{ animation: none; \} \}/);
  });
});

describe('fold to fit, as a pure function (Done 2; fix round 1)', () => {
  // Each chip's width includes the gap after it; `rest` is everything else on the bar; a fold
  // cost is what that `+N` chip adds when it is shown (0 when it is already counted in `rest`).
  // Order: filters from the last down to 1, then sorts down to 1, then the last filter, then
  // the last sort.
  const w = { filters: [100, 100, 100], sorts: [120, 120], rest: 300, filterFold: 40, sortFold: 40 };
  const full = 300 + 300 + 240;
  it('everything fits', () => {
    expect(fitBar({ ...w, available: full })).toEqual({ filters: 3, sorts: 2 });
    expect(fitBar({ ...w, available: 5000 })).toEqual({ filters: 3, sorts: 2 });
  });
  it('only filters fold, paying for their +N', () => {
    expect(fitBar({ ...w, available: full - 1 })).toEqual({ filters: 2, sorts: 2 });
    expect(fitBar({ ...w, available: full - 60 })).toEqual({ filters: 2, sorts: 2 });
    expect(fitBar({ ...w, available: full - 61 })).toEqual({ filters: 1, sorts: 2 });
    // A +N already on the bar (more than three rules) costs nothing more.
    expect(fitBar({ ...w, filterFold: 0, available: full - 100 })).toEqual({ filters: 2, sorts: 2 });
  });
  it('filters stop at one, then sorts fold', () => {
    const oneFilter = 300 + 100 + 40 + 240;
    expect(fitBar({ ...w, available: oneFilter })).toEqual({ filters: 1, sorts: 2 });
    expect(fitBar({ ...w, available: oneFilter - 1 })).toEqual({ filters: 1, sorts: 1 });
    expect(fitBar({ ...w, available: 300 + 100 + 40 + 120 + 40 })).toEqual({ filters: 1, sorts: 1 });
  });
  it('then the last filter, then the last sort', () => {
    const oneEach = 300 + 100 + 40 + 120 + 40;
    expect(fitBar({ ...w, available: oneEach - 1 })).toEqual({ filters: 0, sorts: 1 });
    expect(fitBar({ ...w, available: 300 + 40 + 120 + 40 })).toEqual({ filters: 0, sorts: 1 });
    expect(fitBar({ ...w, available: 300 + 40 + 120 + 39 })).toEqual({ filters: 0, sorts: 0 });
  });
  it('all folded, even when that does not fit either', () => {
    expect(fitBar({ ...w, available: 100 })).toEqual({ filters: 0, sorts: 0 });
  });
  it('no filters or no sorts: the order skips them', () => {
    expect(fitBar({ ...w, filters: [], available: 300 + 120 + 40 })).toEqual({ filters: 0, sorts: 1 });
    expect(fitBar({ ...w, sorts: [], available: 300 + 40 })).toEqual({ filters: 0, sorts: 0 });
    expect(fitBar({ ...w, sorts: [], available: 300 + 100 + 40 })).toEqual({ filters: 1, sorts: 0 });
  });
  it('four long sort levels on a 500 px bar', () => {
    const long = { filters: [110, 95, 130], sorts: [160, 150, 170, 140], rest: 330, filterFold: 0, sortFold: 40, available: 500 };
    // 330 + 110 = 440 leaves 60: no sort chip and its +N (160 + 40) fit, so the filter goes too
    // and the first sort chip (330 + 160 + 40 = 530) still does not: everything folds.
    expect(fitBar(long)).toEqual({ filters: 0, sorts: 0 });
    expect(fitBar({ ...long, available: 530 })).toEqual({ filters: 0, sorts: 1 });
    expect(fitBar({ ...long, available: 640 })).toEqual({ filters: 1, sorts: 1 });
  });
});

describe('each one-click control runs its existing action and nothing else (Done 3)', () => {
  const fire = (data: Record<string, string>) => {
    const el = new FakeEl('button', data, head);
    click(el);
    head.children.splice(head.children.indexOf(el), 1);
    return state.def;
  };
  it('the sort arrow flips the direction (setSortDir)', () => {
    expect(fire({ act: 'sort-dir', i: '0' })).toEqual(act.setSortDir(base, 0, 'desc'));
    state.def = structuredClone(base);
    expect(fire({ act: 'sort-dir', i: '1' })).toEqual(act.setSortDir(base, 1, 'asc'));
  });
  it('the group segment does what the column menu’s Group by this does (setGroupOptions)', () => {
    expect(fire({ act: 'sort-group', i: '0' })).toEqual(act.setGroupOptions(base, 0, { header: true, footer: 'titleCountTotals' }));
    state.def = structuredClone(base);
    expect(fire({ act: 'sort-group', i: '1' })).toEqual(act.setGroupOptions(base, 1, { header: false, footer: 'none', blankLine: false }));
  });
  // A new schedule has its grand total on since 2026-11-25 (step 2), so the first click is off.
  it('Σ switches the grand total (setGrandTotal)', () => {
    expect(fire({ act: 'grand-total' })).toEqual(act.setGrandTotal(base, false));
    expect(fire({ act: 'grand-total' })).toEqual(base);
  });
  it('grid lines and stripes switch (setAppearance)', () => {
    expect(fire({ act: 'app-grid' })).toEqual(act.setAppearance(base, { gridLines: false }));
    state.def = structuredClone(base);
    expect(fire({ act: 'app-zebra' })).toEqual(act.setAppearance(base, { zebra: false }));
  });
  it('ALL / ANY switches the logic (setFilterMode)', () => {
    expect(fire({ act: 'filter-logic' })).toEqual(act.setFilterMode(base, 'or'));
    expect(fire({ act: 'filter-logic' })).toEqual(act.setFilterMode(act.setFilterMode(base, 'or'), 'and'));
  });
  it('none of them opens a popover', () => {
    for (const a of ['sort-dir', 'sort-group', 'grand-total', 'app-grid', 'app-zebra', 'filter-logic']) {
      fire({ act: a, i: '0' });
      expect(popoverId(), a).toBe(null);
    }
  });
});

describe('the +N popover (Done 4)', () => {
  const cov = () => buildCoverage(store, state.def.entity);
  it('lists the folded rules, short words and what each removes', () => {
    state.def = withFilters(FIVE);
    click(new FakeEl('button', { act: 'vb-open', v: 'fold' }, head));
    expect(openChip()).toEqual({ kind: 'fold' });
    const html = renderViewPopover(state, store, cov()).replace(/\s+/g, ' ');
    const rows = [...html.matchAll(/data-act="vb-open" data-v="filter" data-i="(\d+)"[^>]*>([^<]*)<span class="tail">−(\d+)<\/span>/g)];
    expect(rows.map((m) => m[1])).toEqual(['3', '4']);
    expect(rows[0][2]).toBe(shortWords(store, state.def, FIVE[3]));
    expect(html).toMatch(/data-act="filter-remove" data-i="3"/);
    expect(html).toMatch(/data-act="filter-remove" data-i="4"/);
  });

  it('a row opens that rule’s editor, anchored on the +N chip', () => {
    state.def = withFilters(FIVE);
    const fold = new FakeEl('button', { act: 'vb-open', v: 'fold' }, head);
    fold.attrs['aria-haspopup'] = 'dialog';
    click(fold);
    const row = new FakeEl('button', { act: 'vb-open', v: 'filter', i: '4' }, popover);
    click(row);
    popover.children.splice(popover.children.indexOf(row), 1);
    expect(openChip()).toEqual({ kind: 'filter', i: 4 });
    expect(renderViewPopover(state, store, cov())).toMatch(/data-act="filter-op" data-i="4"/);
    anchorPopover();
    expect(fold.attrs['aria-expanded']).toBe('true');
    head.children.splice(head.children.indexOf(fold), 1);
  });

  it('a row’s remove takes its rule away (removeFilterRule)', () => {
    state.def = withFilters(FIVE);
    click(new FakeEl('button', { act: 'vb-open', v: 'fold' }, head));
    click(new FakeEl('button', { act: 'filter-remove', i: '3' }, popover));
    expect(state.def).toEqual(act.removeFilterRule(withFilters(FIVE), 3));
  });

  it('the filter popover no longer carries the All rules / Any rule pair', () => {
    state.def = withFilters(FIVE);
    click(new FakeEl('button', { act: 'vb-open', v: 'filter', i: '0' }, head));
    expect(renderViewPopover(state, store, cov())).not.toMatch(/filter-logic|All rules|Any rule/);
  });
});

describe('the duplicates left the popovers (brief item 10)', () => {
  const cov = () => buildCoverage(store, state.def.entity);
  const body = (kind: string) => {
    click(new FakeEl('button', { act: 'vb-open', v: kind }, head));
    const html = renderViewPopover(state, store, cov());
    closePopover();
    return html;
  };
  it('Rows has no Grand total switch; its label box shows while the total is on (fix round 1)', () => {
    state.def = { ...base, grandTotal: true, grandTotalTitle: 'All doors' };
    const on = body('rows');
    expect(on).not.toMatch(/data-act="grand-total"/);
    expect(on).toMatch(/<input class="full block snug" type="text" data-act="grand-title"\s+value="All doors" placeholder="Grand total" aria-label="Grand total label" \/>/);
    state.def = { ...base, grandTotal: false, grandTotalTitle: 'All doors' };
    expect(body('rows')).not.toMatch(/grand-title|grand-total/);
  });
  // Step 2 (2026-11-25): Outline is under Style's More…, so the check opens it.
  it('Style has no Grid lines and no Stripe rows', () => {
    click(new FakeEl('button', { act: 'vb-open', v: 'style' }, head));
    toggleChipMore();
    const html = renderViewPopover(state, store, buildCoverage(store, state.def.entity));
    closePopover();
    expect(html).not.toMatch(/app-grid|app-zebra|Grid lines|Stripe rows/);
    expect(html).toMatch(/app-outline/);
  });
});

describe('the rows button shows the current mode (fix round 1)', () => {
  const rowsBtn = (def: ScheduleDef) => {
    const html = bar(def);
    const m = /<button class="([^"]*)" data-act="vb-open" data-v="rows"[^>]*>(<svg[\s\S]*?<\/svg>)<\/button>/.exec(html)!;
    const tag = buttons(html).find((x) => /data-v="rows"/.test(x))!;
    return { lit: /\bon\b/.test(m[1]), svg: m[2], tip: attr(tag, 'data-tip'), label: attr(tag, 'aria-label') };
  };
  it('every element', () => {
    const r = rowsBtn({ ...base, itemize: true });
    expect(r).toEqual({ lit: false, svg: ICON.rowsEvery, tip: 'Rows: every element. Click to change', label: 'Rows: every element' });
  });
  it('identical rows merged', () => {
    const r = rowsBtn({ ...base, itemize: false });
    expect(r).toEqual({ lit: true, svg: ICON.rowsMerge, tip: 'Rows: identical rows merged. Click to change', label: 'Rows: identical rows merged' });
  });
  it('one row per sort value', () => {
    const r = rowsBtn({ ...base, itemize: false, combine: 'sort' });
    expect(r).toEqual({ lit: true, svg: ICON.rowsGroup, tip: 'Rows: one row per Tag (Revit ID) + Width. Click to change', label: 'Rows: one row per Tag (Revit ID) + Width' });
    expect(rowsBtn({ ...base, sort: [], itemize: false, combine: 'sort' }).label).toBe('Rows: one row');
  });
  it('three different glyphs', () => {
    expect(new Set([ICON.rowsEvery, ICON.rowsMerge, ICON.rowsGroup]).size).toBe(3);
  });
});
