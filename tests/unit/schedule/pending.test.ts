// The one pending typed edit (schedule-ui/pending.ts) — 2026-09-25, phase 2 review.
//
// ifcTable's per-selector debounce lost or misplaced typing three ways; each is a case here,
// driven through the real `later` / `wirePending` / `renderSoon`, with plain EventTargets for
// the window and the box (the suite has no DOM) and fake timers for the delay.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptySchedule, type ScheduleDef } from '../../../src/schedule/schedule/def';
import { resetHistory } from '../../../src/schedule/history';
import { selectedIndex } from '../../../src/renderer/schedule-ui/panels/shared';
import { flushPending, later, wirePending } from '../../../src/renderer/schedule-ui/pending';
import { saveSchedule } from '../../../src/renderer/schedule-ui/schedules';
import { editDef, setPointerDown, setRenderer, state, update, type RenderScope } from '../../../src/renderer/schedule-ui/state';

const def = (): ScheduleDef => ({
  ...emptySchedule('Door Schedule', ['IfcDoor']),
  columns: [{ field: { kind: 'core', key: 'name' } }, { field: { kind: 'core', key: 'storey' } }],
  filters: [
    { field: { kind: 'core', key: 'name' }, op: 'contains', value: '' },
    { field: { kind: 'core', key: 'storey' }, op: 'contains', value: '' },
  ],
});

/** A fresh "window" and "#app" per test; a box is any other EventTarget. */
let win: EventTarget;
let root: EventTarget;
let paints: RenderScope[];
const ev = (type: string, extra: Record<string, unknown> = {}) => Object.assign(new Event(type), extra);

beforeEach(() => {
  vi.useFakeTimers();
  // The pointer is module state: one test's press must not leak into the next.
  setPointerDown(false);
  flushPending();
  win = new EventTarget();
  root = new EventTarget();
  wirePending(root, win);
  paints = [];
  setRenderer((scope) => { paints.push(scope); });
  const d = def();
  resetHistory(d);
  Object.assign(state, { def: d, selectedColumn: 0, dirty: false, fieldSearch: '' });
  const cell = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => cell.get(k) ?? null,
      setItem: (k: string, v: string) => { cell.set(k, String(v)); },
      removeItem: (k: string) => { cell.delete(k); },
    },
  });
});

afterEach(() => {
  flushPending();
  vi.runAllTimers();
  vi.useRealTimers();
});

/** What liveText does: bind the target now, land the text later. */
function typeInto(box: EventTarget, bind: () => (v: string) => void, value: string, scope: RenderScope = 'all') {
  const write = bind();
  later(box, () => editDef(() => write(value)), scope, 200);
}

describe('loss path 1 — typing in one box, then another, inside the delay', () => {
  it('lands the first box\'s text the moment the second box is typed in', () => {
    const rule1 = new EventTarget();
    const rule2 = new EventTarget();
    typeInto(rule1, () => { const r = state.def.filters[0]; return (v) => { r.value = v; }; }, 'D-1');
    typeInto(rule2, () => { const r = state.def.filters[1]; return (v) => { r.value = v; }; }, 'L2');
    expect(state.def.filters[0].value).toBe('D-1');
    vi.advanceTimersByTime(250);
    expect(state.def.filters[1].value).toBe('L2');
  });
});

describe('loss path 2 — typing a heading, then clicking another column inside the delay', () => {
  it('renames the column that was being formatted when the key was pressed', () => {
    const heading = new EventTarget();
    // fmt-heading's binder: "the column being formatted", resolved at input time.
    typeInto(heading, () => { const c = state.def.columns[selectedIndex(state)]; return (v) => { c.heading = v; }; }, 'Mark');
    // The click on column 2's heading: the window's capture phase runs before its handler.
    win.dispatchEvent(ev('click'));
    update({ selectedColumn: 1 });
    vi.advanceTimersByTime(250);
    expect(state.def.columns[0].heading).toBe('Mark');
    expect(state.def.columns[1].heading).toBeUndefined();
  });

  it('a conditional rule\'s value lands on the rule it was typed into, not the next column\'s', () => {
    state.def.columns[0].conditional = [{ op: '=', value: '' }];
    state.def.columns[1].conditional = [{ op: '=', value: '' }];
    const box = new EventTarget();
    typeInto(box, () => { const r = state.def.columns[selectedIndex(state)].conditional![0]; return (v) => { r.value = v; }; }, 'FD30');
    win.dispatchEvent(ev('keydown', { key: 'Tab' }));
    update({ selectedColumn: 1 });
    expect(state.def.columns[0].conditional![0].value).toBe('FD30');
    expect(state.def.columns[1].conditional![0].value).toBe('');
  });
});

describe('loss path 3 — typing the name, then Save inside the delay', () => {
  it('saves the name that was typed', () => {
    const name = new EventTarget();
    typeInto(name, () => { const d = state.def; return (v) => { d.name = v; }; }, 'Fire doors', 'table');
    // The Save button's click: capture phase first, then the handler reads state.def.
    win.dispatchEvent(ev('click'));
    expect(saveSchedule(state.def, null)).toBe('Fire doors');
  });
});

describe('when a pending edit lands, and what repaints', () => {
  it('lands when focus leaves its box, and not before', () => {
    typeInto(root, () => { const d = state.def; return (v) => { d.name = v; }; }, 'X');
    expect(state.def.name).toBe('Door Schedule');
    root.dispatchEvent(ev('focusout'));
    expect(state.def.name).toBe('X');
  });

  it('typing in the same box does not land it early; Enter or a shortcut does', () => {
    typeInto(win, () => { const d = state.def; return (v) => { d.name = v; }; }, 'Y');
    win.dispatchEvent(ev('keydown', { key: 'a' }));
    expect(state.def.name).toBe('Door Schedule');
    win.dispatchEvent(ev('keydown', { key: 'z', ctrlKey: true }));
    expect(state.def.name).toBe('Y');
  });

  it('never repaints while a pointer is down — only after the release, on a later task', () => {
    win.dispatchEvent(ev('pointerdown'));
    typeInto(root, () => { const d = state.def; return (v) => { d.name = v; }; }, 'Z');
    root.dispatchEvent(ev('focusout'));
    vi.advanceTimersByTime(1000);
    expect(state.def.name).toBe('Z');
    expect(paints).toEqual([]);
    win.dispatchEvent(ev('pointerup'));
    expect(paints).toEqual([]);
    vi.advanceTimersByTime(0);
    expect(paints).toEqual(['all']);
  });

  describe('a release no pointerup reported still lets the paint go', () => {
    // Round 3 of the review: released outside the window, at the end of a scrollbar drag, or
    // across an alt-tab, the page never hears the pointerup — and "down" stuck, so every later
    // edit landed and never painted.
    const stuck = () => {
      win.dispatchEvent(ev('pointerdown'));
      typeInto(root, () => { const d = state.def; return (v) => { d.name = v; }; }, 'S');
      root.dispatchEvent(ev('focusout'));
      vi.advanceTimersByTime(1000);
      expect(state.def.name).toBe('S');
      expect(paints).toEqual([]);
    };

    it('a move with no button held', () => {
      stuck();
      win.dispatchEvent(ev('pointermove', { buttons: 1 }));
      vi.advanceTimersByTime(10);
      expect(paints).toEqual([]);
      win.dispatchEvent(ev('pointermove', { buttons: 0 }));
      vi.advanceTimersByTime(0);
      expect(paints).toEqual(['all']);
    });

    it('any key', () => {
      stuck();
      win.dispatchEvent(ev('keydown', { key: 'a' }));
      vi.advanceTimersByTime(0);
      expect(paints).toEqual(['all']);
    });

    it('the window losing focus', () => {
      stuck();
      win.dispatchEvent(ev('blur'));
      vi.advanceTimersByTime(0);
      expect(paints).toEqual(['all']);
    });
  });

  it('a paint that lands a pending edit itself (main.ts) draws it once — no loop, no second paint', () => {
    // main.ts's paint() calls flushPending() first; the flush asks for a paint, and the paint
    // under way answers it.
    setRenderer((scope) => { flushPending(); paints.push(scope); });
    typeInto(root, () => { const d = state.def; return (v) => { d.name = v; }; }, 'Q');
    update({ selectedColumn: 1 });
    expect(state.def.name).toBe('Q');
    vi.advanceTimersByTime(1000);
    expect(paints).toEqual(['all']);
  });

  it('a panes-only paint that lands a schedule edit still owes the table its paint', () => {
    setRenderer((scope) => { flushPending(); paints.push(scope); });
    typeInto(root, () => { const d = state.def; return (v) => { d.name = v; }; }, 'R');
    update({ fieldSearch: 'x' }, 'panes');
    vi.advanceTimersByTime(0);
    expect(paints).toEqual(['panes', 'table']);
  });

  it('a repaint that happens anyway crosses the deferred one off — no second paint', () => {
    typeInto(root, () => { const d = state.def; return (v) => { d.name = v; }; }, 'W');
    flushPending();
    update({ selectedColumn: 1 });
    vi.advanceTimersByTime(0);
    expect(paints).toEqual(['all']);
  });

  it('a search lands as a panes-only repaint', () => {
    const box = new EventTarget();
    later(box, () => { state.fieldSearch = 'fire'; }, 'panes', 150);
    vi.advanceTimersByTime(200);
    expect(state.fieldSearch).toBe('fire');
    expect(paints).toEqual(['panes']);
  });
});
