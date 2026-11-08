// The column menu, driven through the REAL wiring (schedule-ui/events.ts, colResize.ts,
// popover.ts, pending.ts) on a minimal fake DOM — the suite has no DOM library, so
// support/fakeDom.ts dispatches events in the browser's order and nothing more.
//
// Ported from ifcTable's `tests/columnMenu.test.ts` (Yong Yen, 2026-11-05) for SGVue v1.5.0,
// phase 2. What differs is SGVue's, and each is a case here:
//   · a heading is its own trigger — the <th> carries the tabindex and `aria-haspopup`, where
//     ifcTable puts a <button> inside it — so Escape hands focus back to the cell, and Left /
//     Right move between cells;
//   · a typed edit waits in pending.ts and lands before any click (window capture) or when
//     focus leaves its box, so "leaving the box commits" is a `focusout` here, not a `change`.
//
// What this proves: which handler runs for which gesture, and what it writes to the
// definition. What it cannot prove is hit-testing; that is the e2e's, in a real window.
//
// Proven to fail: (1) dropping `swallowNextClick()` from colResize's `up` makes "a click that
// ends a grip drag does not open the menu" fail; (2) making wireFormat's `at()` ignore
// data-defcol fails the cases wired in wireFormat; (3) removing '#popover' from preserve.ts's
// PANES fails the colour-rule caret test.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as act from '../../../src/schedule/schedule/actions';
import { emptySchedule, type Column, type ScheduleDef } from '../../../src/schedule/schedule/def';
import { runSchedule } from '../../../src/schedule/schedule/engine';
import { setRenderer, state, type RenderScope } from '../../../src/renderer/schedule-ui/state';
import { wireColumnResize } from '../../../src/renderer/schedule-ui/colResize';
import { menuColumn, renderColumnMenu } from '../../../src/renderer/schedule-ui/columnMenu';
import { buildCoverage } from '../../../src/renderer/schedule-ui/coverage';
import { wireApp } from '../../../src/renderer/schedule-ui/events';
import { flushPending, wirePending } from '../../../src/renderer/schedule-ui/pending';
import { renderSchedule } from '../../../src/renderer/schedule-ui/tableView';
import { closePopover, wirePopover } from '../../../src/renderer/schedule-ui/popover';
import { restoreUi, snapshotUi } from '../../../src/renderer/schedule-ui/preserve';
import { buildStore } from './support/fixture';
import { FakeEl, installFakeDom } from './support/fakeDom';

const dom = installFakeDom();
const { root, win, dispatch } = dom;
const store = buildStore();
const W = { kind: 'prop', pset: 'Qto_DoorBaseQuantities', prop: 'Width' } as const;
const base: ScheduleDef = {
  ...emptySchedule('Doors', ['IfcDoor']),
  columns: [
    { field: { kind: 'core', key: 'mark' } },
    { field: W },
    { field: { kind: 'prop', pset: 'Pset_DoorCommon', prop: 'FireRating' } },
    { field: { kind: 'prop', pset: 'Pset_DoorCommon', prop: 'IsExternal' } },
  ] as Column[],
};

// The table: root > table > th × 4, each 100px wide — SGVue's heading is the trigger itself.
const table = new FakeEl('table', {}, root);
const heads = base.columns.map((_, i) => {
  const th = new FakeEl('th', { defcol: String(i) }, table);
  th.attrs.tabindex = '0';
  th.attrs['aria-haspopup'] = 'dialog';
  th.rect = { left: i * 100, right: i * 100 + 100, top: 0, bottom: 30, width: 100, height: 30 };
  return th;
});
table.rect = { left: 0, right: 400, top: 0, bottom: 300, width: 400, height: 300 };
// A second pane the same controls could be drawn in — the caret tests below need two.
const popover = new FakeEl('div', {}, root);
popover.attrs.id = 'popover';
const elsewherePane = new FakeEl('div', {}, root);
elsewherePane.attrs.id = 'elsewhere-pane';
const elsewhere = new FakeEl('div', {}, root);

const commits: [number, number | undefined][][] = [];
const doc = () => (globalThis as unknown as { document: { activeElement: unknown } }).document;

beforeAll(() => {
  wirePending(root as unknown as EventTarget, win as unknown as EventTarget);
  wirePopover(root as unknown as HTMLElement);
  wireColumnResize(root as unknown as HTMLElement, {
    groupOf: (i) => [i],
    commit: (w) => { commits.push(w); },
  });
  wireApp(root as unknown as HTMLElement, {
    pickRow: () => {}, rowMenu: () => {}, headMenu: () => {}, moveRow: () => {}, frameSelection: () => {},
  });
});

beforeEach(() => {
  vi.useFakeTimers();
  flushPending();
  state.store = store;
  state.def = structuredClone(base);
  state.selectedColumn = null;
  state.selectedCols = [];
  commits.length = 0;
  closePopover();
});
afterEach(() => { flushPending(); vi.runOnlyPendingTimers(); vi.useRealTimers(); });

const click = (el: FakeEl, init = {}) => {
  dispatch(el, 'pointerdown', init);
  dispatch(el, 'pointerup', init);
  dispatch(el, 'click', init);
};

describe('heading gestures', () => {
  it('a plain click opens that column’s menu, and a second click closes it', () => {
    click(heads[2], { clientX: 250 });
    expect(menuColumn()).toBe(2);
    expect(state.selectedColumn).toBe(2);
    click(heads[2], { clientX: 250 });
    expect(menuColumn()).toBe(null);
  });

  it('opening it, moving inside it and closing it never repaint the table (popover-only paint)', () => {
    const paints: RenderScope[] = [];
    setRenderer((scope) => { paints.push(scope); });
    click(heads[2], { clientX: 250 });
    click(new FakeEl('button', { act: 'cm-more', defcol: '2' }, popover));
    click(new FakeEl('button', { act: 'cm-view', v: 'colour', defcol: '2' }, popover));
    click(heads[2], { clientX: 250 });
    expect(menuColumn()).toBe(null);
    expect(paints).toEqual([]);
    setRenderer(() => {});
    popover.children.length = 0;
  });

  it('a click on another heading moves the menu there', () => {
    click(heads[1], { clientX: 150 });
    click(heads[3], { clientX: 350 });
    expect(menuColumn()).toBe(3);
  });

  it('Shift and Ctrl clicks mark columns and open nothing', () => {
    click(heads[1], { clientX: 150, shiftKey: true });
    click(heads[3], { clientX: 350, ctrlKey: true });
    expect(menuColumn()).toBe(null);
    expect(state.selectedCols).toEqual([1, 3]);
  });

  it('the heading is drawn as its own trigger: one tab stop, saying it opens a menu', () => {
    const res = runSchedule(store, base);
    const html = renderSchedule({ ...state, def: base }, res, buildCoverage(store, base.entity));
    const ths = [...html.matchAll(/<th[^>]*data-defcol="(\d)"([^>]*)>/gs)];
    expect(ths.length).toBe(4);
    for (const [, , rest] of ths) {
      expect(rest).toMatch(/tabindex="0" aria-haspopup="dialog"/);
    }
    // No second focus stop inside a heading, and "+ Column" closes the row.
    expect(html).not.toMatch(/class="th-btn"/);
    expect(html).toMatch(/<th class="add-col"><button class="th-add" type="button" data-act="vb-open" data-v="picker" data-id="th" aria-haspopup="dialog">\+ Column<\/button><\/th>/);
  });

  it('a click that ends a grip drag does not open the menu — and the drag commits', () => {
    // Press 3px inside column 1's right edge, drag 40px right, release.
    dispatch(heads[1], 'pointerdown', { clientX: 197 });
    dispatch(heads[1], 'pointermove', { clientX: 237, buttons: 1 });
    dispatch(heads[1], 'pointerup', { clientX: 237 });
    dispatch(heads[1], 'click', { clientX: 237 });
    expect(menuColumn()).toBe(null);
    expect(commits).toEqual([[[1, 140]]]);
    // The swallow lasts one task; the next ordinary click is a click again.
    vi.runOnlyPendingTimers();
    click(heads[1], { clientX: 150 });
    expect(menuColumn()).toBe(1);
  });

  it('a press on the grip that does not move opens nothing either', () => {
    dispatch(heads[2], 'pointerdown', { clientX: 298 });
    dispatch(heads[2], 'pointerup', { clientX: 298 });
    dispatch(heads[2], 'click', { clientX: 298 });
    expect(menuColumn()).toBe(null);
    expect(commits).toEqual([]);
  });

  it('a click that began outside closes it; one inside the menu does not', () => {
    click(heads[1], { clientX: 150 });
    const inside = new FakeEl('button', { act: 'nothing' }, popover);
    click(inside);
    expect(menuColumn()).toBe(1);
    click(elsewhere);
    expect(menuColumn()).toBe(null);
    popover.children.length = 0;
  });

  it('Escape closes it and puts focus back on the heading', () => {
    click(heads[2], { clientX: 250 });
    dispatch(elsewhere, 'keydown', { key: 'Escape' });
    expect(menuColumn()).toBe(null);
    expect(doc().activeElement).toBe(heads[2]);
  });

  it('Left and Right skip a heading with no menu and reach "+ Column"', () => {
    // A Count heading (no data-defcol) and the "+ Column" heading after the last column.
    const count = new FakeEl('th', {}, table);
    const addTh = new FakeEl('th', {}, table);
    const add = new FakeEl('button', { act: 'vb-open', v: 'picker', id: 'th' }, addTh);
    add.classes.push('th-add');
    dispatch(heads[3], 'keydown', { key: 'ArrowRight' });
    expect(doc().activeElement).toBe(add);
    dispatch(add, 'keydown', { key: 'ArrowLeft' });
    expect(doc().activeElement).toBe(heads[3]);
    table.children.splice(table.children.indexOf(count), 2);
  });

  it('Left and Right move focus between the headings', () => {
    dispatch(heads[1], 'keydown', { key: 'ArrowRight' });
    expect(doc().activeElement).toBe(heads[2]);
    dispatch(heads[1], 'keydown', { key: 'ArrowLeft' });
    expect(doc().activeElement).toBe(heads[0]);
  });

  it('the ContextMenu key on a heading opens the right-click menu, not the column menu', () => {
    const asked: number[] = [];
    // The hooks are fixed at wiring; a second root with its own wiring stands in for one.
    const r2 = new FakeEl('div', {}, dom.doc);
    const th = new FakeEl('th', { defcol: '2' }, r2);
    wireApp(r2 as unknown as HTMLElement, {
      pickRow: () => {}, rowMenu: () => {}, headMenu: (i) => { asked.push(i); }, moveRow: () => {}, frameSelection: () => {},
    });
    dispatch(th, 'keydown', { key: 'F10', shiftKey: true });
    expect(asked).toEqual([2]);
    expect(menuColumn()).toBe(null);
  });
});

// One control in the menu, fired through the real handlers, must write what its action writes.
type Fire = (el: FakeEl) => void;
const change = (value: string, checked = false): Fire => (el) => {
  el.value = value; el.checked = checked; dispatch(el, 'change');
};
const press: Fire = (el) => click(el);
const typed = (value: string): Fire => (el) => { el.value = value; dispatch(el, 'input'); vi.advanceTimersByTime(250); };

function viaMenu(i: number, data: Record<string, string>, fire: Fire): ScheduleDef {
  state.def = structuredClone(base);
  state.selectedColumn = 0;
  fire(new FakeEl('input', { ...data, defcol: String(i) }, popover));
  return state.def;
}
describe('every setting in the column menu writes what its action writes', () => {
  const i = 1; // Width, a length: default 0 decimals, unit mm
  const cases: [string, Record<string, string>, Fire, ScheduleDef][] = [
    ['decimals box', { act: 'fmt-decimals' }, change('3'), act.setColumnFormat(base, i, { decimals: 3 })],
    ['decimals stepper', { act: 'cm-dec', v: '1' }, press, act.setColumnFormat(base, i, { decimals: 1 })],
    ['unit', { act: 'cm-unit', v: 'm' }, press, act.setColumnFormat(base, i, { display: 'm' })],
    ['total', { act: 'cm-total', v: 'sum' }, press, act.setTotal(base, i, 'sum')],
    ['align', { act: 'fmt-align', v: 'center' }, press, act.setAlign(base, i, 'center')],
    ['heading direction', { act: 'cm-orient', v: 'vertical' }, press, act.setHeadingOrientation(base, i, 'vertical')],
    ['width', { act: 'fmt-width' }, change('140'), act.setWidths(base, [[i, 140]])],
    ['width cleared is "auto"', { act: 'fmt-width' }, change(''), act.setWidths(base, [[i, undefined]])],
    ['thousands', { act: 'fmt-thousands' }, change('', false), act.setColumnFormat(base, i, { thousands: false })],
    ['unit symbol', { act: 'fmt-symbol' }, change('', true), act.setColumnFormat(base, i, { showSymbol: true })],
    ['blank instead of zero', { act: 'fmt-suppress' }, change('', true), act.setColumnFormat(base, i, { suppressZero: true })],
    ['yes / no style', { act: 'fmt-bool' }, change('Y/N'), act.setColumnFormat(base, i, { boolStyle: 'Y/N' })],
    ['heading text', { act: 'fmt-heading' }, typed('Door width'), act.setHeading(base, i, 'Door width')],
    ['add colour rule', { act: 'cond-add' }, press, act.addConditionalRule(base, i)],
  ];
  for (const [name, data, how, want] of cases) {
    it(name, () => { expect(viaMenu(i, data, how)).toEqual(want); });
  }

  it('a colour rule’s op, value, colours and bold land in updateConditionalRule', () => {
    const withRule = act.addConditionalRule(base, i);
    const on = (data: Record<string, string>, how: Fire) => {
      state.def = structuredClone(withRule);
      how(new FakeEl('input', { ...data, i: '0', defcol: String(i) }, popover));
      return state.def;
    };
    expect(on({ act: 'cond-op' }, change('!='))).toEqual(act.updateConditionalRule(withRule, i, 0, { op: '!=' }));
    expect(on({ act: 'cond-value' }, typed('1,000'))).toEqual(act.updateConditionalRule(withRule, i, 0, { value: '1,000' }));
    expect(on({ act: 'cond-preset', bg: '#d1e7dd', fg: '#0a3622' }, press))
      .toEqual(act.updateConditionalRule(withRule, i, 0, { bg: '#d1e7dd', fg: '#0a3622' }));
    expect(on({ act: 'cond-bold' }, change('', true))).toEqual(act.updateConditionalRule(withRule, i, 0, { bold: true }));
    expect(on({ act: 'cond-remove' }, press)).toEqual(act.removeConditionalRule(withRule, i, 0));
  });

  it('Hide and Move go through setHidden and moveColumn', () => {
    expect(viaMenu(2, { act: 'cm-hide' }, press)).toEqual(act.setHidden(base, 2, true));
    expect(viaMenu(2, { act: 'cm-move', v: '-1' }, press)).toEqual(act.moveColumn(base, 2, 1));
  });

  it('Sort and Group by this add one level for the field, and reuse it after', () => {
    const sorted = viaMenu(1, { act: 'cm-sort', v: 'desc' }, press);
    expect(sorted.sort).toEqual([{ field: W, dir: 'desc' }]);
    state.def = sorted;
    press(new FakeEl('button', { act: 'cm-group', defcol: '1' }, popover));
    expect(state.def.sort).toEqual([{ field: W, dir: 'desc', header: true, footer: 'titleCountTotals' }]);
    press(new FakeEl('button', { act: 'cm-group', defcol: '1' }, popover));
    expect(state.def.sort).toEqual([{ field: W, dir: 'desc', header: false, footer: 'none', blankLine: false }]);
  });
});

describe('a heading being typed never lands on another column', () => {
  // Typing a heading and pressing Move / Hide / Remove inside the 200ms delay used to write
  // the text, late, onto whatever column then sat at the old index (ifcTable). In SGVue the
  // pending edit lands at the click's window capture, before the click's own handler.
  const typeHeading = (i: number, text: string) => {
    const box = new FakeEl('input', { act: 'fmt-heading', defcol: String(i) }, popover);
    box.value = text;
    dispatch(box, 'input');
    return box;
  };

  it('Move right straight after typing: the heading travels with its column', () => {
    typeHeading(2, 'Rating');
    press(new FakeEl('button', { act: 'cm-move', v: '1', defcol: '2' }, popover));
    vi.advanceTimersByTime(500);
    expect(state.def.columns.map((c) => c.heading)).toEqual([undefined, undefined, undefined, 'Rating']);
  });

  it('Hide straight after typing: the hidden column is the one renamed', () => {
    typeHeading(1, 'W');
    press(new FakeEl('button', { act: 'cm-hide', defcol: '1' }, popover));
    vi.advanceTimersByTime(500);
    expect(state.def.columns[1]).toMatchObject({ heading: 'W', hidden: true });
  });

  it('Remove straight after typing: nothing else picks up the text', () => {
    typeHeading(1, 'Gone');
    press(new FakeEl('button', { act: 'col-remove', i: '1' }, popover));
    vi.advanceTimersByTime(500);
    expect(state.def.columns.map((c) => c.heading)).toEqual([undefined, undefined, undefined]);
  });

  it('leaving the box commits at once — before the next control’s click', () => {
    const box = typeHeading(2, 'Now');
    dispatch(box, 'focusout');
    expect(state.def.columns[2].heading).toBe('Now');
  });
});

describe('the menu as drawn', () => {
  const draw = (i: number) => {
    state.def = structuredClone(base);
    click(heads[i], { clientX: i * 100 + 50 });
    const res = runSchedule(store, state.def);
    return renderColumnMenu(state, store, buildCoverage(store, state.def.entity), res);
  };

  it('names its column on every control, and holds no number input a repaint could eat', () => {
    const html = draw(1);
    const acts = [...html.matchAll(/data-act="([^"]+)"([^>]*)/g)];
    expect(acts.length).toBeGreaterThan(15);
    for (const [, a, rest] of acts) {
      if (a === 'col-remove' || a === 'remap') expect(rest).toMatch(/data-i="1"/);
      else expect(rest, a).toMatch(/data-defcol="1"/);
    }
    // Spike rule: no type=number inside anything rebuilt — it drops caret and junk alike.
    expect(html).not.toMatch(/type="number"/);
    expect(html).toMatch(/class="heading-in pop-focus" type="text" data-act="fmt-heading" data-defcol="1"/);
  });

  it('offers totals by what the column holds', () => {
    expect(draw(1)).toMatch(/data-v="avg"/);
    const text = draw(2);
    expect(text).not.toMatch(/data-v="avg"/);
    expect(text).toMatch(/data-v="countDistinct"/);
  });

  it('a column nothing carries offers the remap, under the existing act', () => {
    state.def = { ...structuredClone(base), columns: [...base.columns, { field: { kind: 'prop', pset: 'X', prop: 'FireRatingX' } }] };
    const extra = new FakeEl('th', { defcol: '4' }, table);
    extra.rect = { left: 400, right: 500, top: 0, bottom: 30, width: 100, height: 30 };
    click(extra, { clientX: 450 });
    const html = renderColumnMenu(state, store, buildCoverage(store, state.def.entity), runSchedule(store, state.def));
    expect(html).toMatch(/<b>0 of 9<\/b>/);
    expect(html).toMatch(/data-act="remap" data-i="4"/);
    table.children.pop();
  });
});

describe('typing in the menu survives the repaint it causes', () => {
  // A text input whose caret preserve.ts can read and set.
  class FakeInput extends FakeEl {
    selectionStart = 0;
    selectionEnd = 0;
    setSelectionRange(a: number, b: number) { this.selectionStart = a; this.selectionEnd = b; }
  }
  const g = globalThis as Record<string, unknown>;

  const caretSurvives = (data: Record<string, string>, twin: Record<string, string>) => {
    // Put another pane holding a twin of the control BEFORE the popover in document order, so
    // a document-wide lookup would find the twin first — the trap preserve.ts's PANES exists for.
    root.children.splice(root.children.indexOf(elsewherePane), 1);
    root.children.unshift(elsewherePane);
    g.HTMLElement = FakeEl;
    g.HTMLInputElement = FakeInput;
    g.CSS = { escape: (s: string) => s };
    const d = g.document as { activeElement: unknown };
    elsewherePane.children.length = 0;
    popover.children.length = 0;
    new FakeInput('input', twin, elsewherePane).type = 'text';
    const before = new FakeInput('input', data, popover);
    before.type = 'text';
    before.focus();
    before.selectionStart = before.selectionEnd = 5;
    const ui = snapshotUi();
    // The repaint: the popover's body is rebuilt — a new element with the same identity.
    popover.children.length = 0;
    const after = new FakeInput('input', data, popover);
    after.type = 'text';
    d.activeElement = null;
    restoreUi(ui);
    expect(d.activeElement).toBe(after);
    expect([after.selectionStart, after.selectionEnd]).toEqual([5, 5]);
  };

  it('the heading box keeps focus and caret — not handed to a twin elsewhere', () => {
    caretSurvives({ act: 'fmt-heading', defcol: '3' }, { act: 'fmt-heading' });
  });

  it('a colour-rule value keeps them too, though the twin elsewhere is identical', () => {
    // Both carry act, rule index AND column: only the pane tells them apart.
    caretSurvives({ act: 'cond-value', i: '0', defcol: '3' }, { act: 'cond-value', i: '0', defcol: '3' });
  });
});
