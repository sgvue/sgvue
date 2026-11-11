// Audit B8 — the Schedules window repaints only what a change can alter.
//
//   P. A narrower repaint leaves every pane exactly as a full repaint would draw it.
//   Q. An action that cannot change a table row writes no table and runs no engine.
//   R. An action that changed the definition once paints once: one table write, one engine run,
//      and the undo history moves by what it moved before.
//   S. A keystroke in the Templates library's save row reads the saved list from storage once.
//   T. A 'panes' paint (a rail-search keystroke) runs no engine, even while a preview is on; a
//      real definition change still posts `current` as before.
//
// Run on the window's real composition root through `support/windowHarness.ts`, as
// `window-model.test.ts` does. The engine is the real one, wrapped to count its runs.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { snapshotOf } from '../../../src/schedule/adapter';
import { undoDepth } from '../../../src/schedule/history';
import * as act from '../../../src/schedule/schedule/actions';
import { federate } from '../../../src/shared/federate';
import { mockModelIndex } from '../../../src/renderer/dev/mock-adapter';
import { FakeEl } from './support/fakeDom';
import { dialogModule, fakePort, installWindow, type DialogMock, type FakePort, type Window } from './support/windowHarness';

const dialog = vi.hoisted(() => ({ open: false, asked: [], answer: () => undefined }) as unknown as DialogMock);
vi.mock('../../../src/renderer/schedule-ui/dialog', () => dialogModule(dialog));

/** Every `runSchedule` call the window makes, through the real engine. */
const runs = vi.hoisted(() => ({ n: 0 }));
vi.mock('../../../src/schedule/schedule/engine', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../src/schedule/schedule/engine')>();
  return {
    ...real,
    runSchedule: (...a: Parameters<typeof real.runSchedule>) => { runs.n++; return real.runSchedule(...a); },
  };
});

type Mods = {
  state: typeof import('../../../src/renderer/schedule-ui/state');
  actions: typeof import('../../../src/renderer/schedule-ui/actions');
  lib: typeof import('../../../src/renderer/schedule-ui/libraryActions');
  schedules: typeof import('../../../src/renderer/schedule-ui/schedules');
};
let W: Window;
let M: Mods;
let port: FakePort;
const posted: { type: string; def?: unknown; rowCount?: number }[] = [];

const SNAP = snapshotOf(federate(['ARC', 'STR'].map((k) => mockModelIndex(k))));
const deliver = (data: unknown) => port.onmessage!({ data: structuredClone(data) });

const PANES = ['header', 'rail-pane', 'output-pane', 'status-bar', 'centre-head', 'overlay-root', 'popover'];
const out = () => W.pane('output-pane');

/** A control carrying these data-* attributes, fired and taken away again. */
function fire(type: string, data: Record<string, string>, init: Record<string, unknown> = {}, tag = 'button') {
  const pane = out();
  const el = new FakeEl(tag, data, pane);
  W.dispatch(el, type, init);
  const at = pane.children.indexOf(el);
  if (at >= 0) pane.children.splice(at, 1);
  return el;
}
const click = (data: Record<string, string>) => fire('click', data);
/** A key pressed with the focus on the page, not in a box. */
const press = (key: string) => fire('keydown', {}, { key }, 'div');

/** Every pane as drawn — markup, and the rail's open / closed class. */
function snapshot(): Record<string, string> {
  const s: Record<string, string> = {};
  for (const id of PANES) s[id] = W.pane(id).innerHTML;
  s.railClosed = String(W.pane('rail-pane').classList.contains('closed'));
  return s;
}

/** What one action cost: table writes, engine runs, undo steps gained. */
function cost(fn: () => void): { writes: number; runs: number; steps: number } {
  const w0 = out().writes;
  const r0 = runs.n;
  const d0 = undoDepth();
  fn();
  return { writes: out().writes - w0, runs: runs.n - r0, steps: undoDepth() - d0 };
}

/** P: nothing a full paint would draw differently was left out. */
function fullPaintAgrees() {
  // The library's list is drawn before its pane, and the pane builds the selected template's
  // coverage, so a row's fit reads "…" on the first paint after the library opens and its
  // figure on the next — whatever the scope (a full paint draws the same "…" first). One more
  // 'panes' paint settles that, and leaves the table and the status line exactly as the action
  // left them: only they are what a full paint could find stale.
  M.state.render('panes');
  const narrow = snapshot();
  M.state.render('all');
  expect(snapshot()).toEqual(narrow);
}

/** The window back to a plain schedule: no overlay, no preview, no marks, nothing pending. */
function reset() {
  vi.advanceTimersByTime(1000);
  M.state.update({
    overlay: null, libraryDraft: null, libraryQuery: '', removedBy: null, litBy: null,
    selectedColumn: null, selectedCols: [], railOpen: true, railQuery: '',
  });
  vi.advanceTimersByTime(1000);
}

beforeAll(async () => {
  vi.useFakeTimers();
  W = installWindow();
  await import('../../../src/renderer/schedule-ui/main');
  M = {
    state: await import('../../../src/renderer/schedule-ui/state'),
    actions: await import('../../../src/renderer/schedule-ui/actions'),
    lib: await import('../../../src/renderer/schedule-ui/libraryActions'),
    schedules: await import('../../../src/renderer/schedule-ui/schedules'),
  };
  port = fakePort((d) => posted.push(d as { type: string }));
  W.connect(port);
  deliver({ type: 'store', snapshot: SNAP });
  vi.advanceTimersByTime(1000);
  expect(M.state.state.def.columns.length).toBeGreaterThan(2);
});
afterAll(() => {
  vi.useRealTimers();
});

/** Q's and P's verdict on one action: no table, no engine, and nothing missed. */
function narrow(name: string, setup: () => void, action: () => void) {
  it(name, () => {
    reset();
    setup();
    const c = cost(action);
    expect({ writes: c.writes, runs: c.runs }, 'a table repaint for a change no row can show').toEqual({ writes: 0, runs: 0 });
    fullPaintAgrees();
  });
}

describe('P + Q. a change no table row can show repaints no table', () => {
  narrow('the rail opens and closes', () => undefined, () => click({ act: 'rail-toggle' }));
  narrow('the rail, closed, opens again', () => click({ act: 'rail-toggle' }), () => click({ act: 'rail-toggle' }));
  narrow('the calculated-value editor opens', () => undefined, () => click({ act: 'open-calc' }));
  narrow('the formula guide opens', () => M.state.update({ overlay: 'calc' }), () => click({ act: 'open-formula' }));
  narrow('close-overlay closes a modal', () => M.state.update({ overlay: 'calc' }), () => click({ act: 'close-overlay' }));
  narrow('a click on the backdrop closes a modal', () => M.state.update({ overlay: 'calc' }), () => {
    const pane = out();
    const el = new FakeEl('div', { act: 'overlay-backdrop' }, pane);
    W.dispatch(el, 'pointerdown', { button: 0, buttons: 1 });
    W.dispatch(el, 'pointerup', { button: 0 });
    W.dispatch(el, 'click', {});
    pane.children.splice(pane.children.indexOf(el), 1);
  });
  narrow('Escape in the formula guide goes back to the editor', () => M.state.update({ overlay: 'formula' }), () => press('Escape'));
  narrow('Escape closes the editor', () => M.state.update({ overlay: 'calc' }), () => press('Escape'));
  narrow('the Templates library opens', () => undefined, () => click({ act: 'open-library' }));
  narrow('Escape closes the Templates library', () => M.lib.openLibrary(), () => press('Escape'));
  narrow('close-overlay closes the Templates library', () => M.lib.openLibrary(), () => click({ act: 'close-overlay' }));

  narrow('a saved setup not on screen is renamed, from the library', () => {
    M.schedules.saveSchedule({ ...M.state.state.def, name: 'Off screen A' }, null);
    M.lib.openLibrary();
  }, () => {
    M.actions.renameSaved('Off screen A', 'Off screen B', { libraryDraft: null, librarySel: 'm:Off screen B' });
  });
  narrow('a saved setup not on screen is renamed, from chat', () => {
    M.schedules.saveSchedule({ ...M.state.state.def, name: 'Off screen C' }, null);
  }, () => { M.actions.renameSaved('Off screen C', 'Off screen D'); });
  narrow('a built-in template is duplicated to Mine', () => M.lib.openLibrary(), () => {
    M.lib.duplicate(M.lib.view().all.find((t) => t.src === 'builtin'));
  });
  narrow('a saved setup is duplicated, from the library (one paint, not two)', () => {
    M.schedules.saveSchedule({ ...M.state.state.def, name: 'To copy' }, null);
    M.lib.openLibrary();
  }, () => { M.lib.duplicate(M.lib.view().all.find((t) => t.key === 'm:To copy')); });
  narrow('a saved setup is duplicated, from chat', () => {
    M.schedules.saveSchedule({ ...M.state.state.def, name: 'To copy 2' }, null);
  }, () => { M.actions.duplicateSaved('To copy 2'); });

  for (const withSel of [false, true]) {
    it(`a saved setup not on screen is deleted${withSel ? ', with the library on it' : ''}`, async () => {
      reset();
      const name = M.schedules.saveSchedule({ ...M.state.state.def, name: `Gone ${withSel}` }, null)!;
      if (withSel) M.lib.openLibrary(`m:${name}`);
      expect(M.state.state.savedName).not.toBe(name);
      M.actions.askDeleteSaved(name);
      const w0 = out().writes;
      const r0 = runs.n;
      dialog.answer(true);
      await Promise.resolve();
      await Promise.resolve();
      expect(M.schedules.listSaved().some((e) => e.name === name)).toBe(false);
      expect({ writes: out().writes - w0, runs: runs.n - r0 }).toEqual({ writes: 0, runs: 0 });
      fullPaintAgrees();
    });
  }

  it('a project\'s saved list arriving with no schedule to open', () => {
    reset();
    let back = { writes: -1, runs: -1, steps: 0 };
    try {
      const c = cost(() => deliver({ type: 'projectSchedules', saved: [], open: null }));
      expect({ writes: c.writes, runs: c.runs }).toEqual({ writes: 0, runs: 0 });
      fullPaintAgrees();
    } finally {
      // The window's own list again, whatever happened above: the tests after this one save to it.
      back = cost(() => deliver({ type: 'projectSchedules', saved: null }));
    }
    expect(M.schedules.projectListOn()).toBe(false);
    expect({ writes: back.writes, runs: back.runs }).toEqual({ writes: 0, runs: 0 });
    fullPaintAgrees();
  });
});

describe('R. one change to the definition is one paint', () => {
  it('removing the column whose menu was last opened', () => {
    reset();
    M.state.state.selectedColumn = 0;
    const n = M.state.state.def.columns.length;
    const c = cost(() => click({ act: 'col-remove', i: '0' }));
    expect(M.state.state.def.columns).toHaveLength(n - 1);
    expect(M.state.state.selectedColumn).toBeNull();
    expect(c).toEqual({ writes: 1, runs: 1, steps: 1 });
    fullPaintAgrees();
  });

  it('removing a filter rule while its removals are previewed', () => {
    reset();
    M.state.updateDef((d) => act.addFilterRule(d));
    M.state.update({ removedBy: 0 });
    vi.advanceTimersByTime(1000);
    const c = cost(() => click({ act: 'filter-remove', i: '0' }));
    expect(M.state.state.def.filters).toHaveLength(0);
    expect(M.state.state.removedBy).toBeNull();
    expect(c).toEqual({ writes: 1, runs: 1, steps: 1 });
    fullPaintAgrees();
  });

  it('removing a colour rule while its rows are previewed', () => {
    reset();
    M.state.updateDef((d) => act.addConditionalRule(d, 0));
    M.state.update({ litBy: { col: 0, rule: 0 } });
    vi.advanceTimersByTime(1000);
    expect(M.state.state.def.columns[0].conditional).toHaveLength(1);
    const c = cost(() => click({ act: 'cond-remove', defcol: '0', i: '0' }));
    expect(M.state.state.def.columns[0].conditional ?? []).toHaveLength(0);
    expect(M.state.state.litBy).toBeNull();
    expect(c).toEqual({ writes: 1, runs: 1, steps: 1 });
    fullPaintAgrees();
  });

  it('"+ Calculated value" adds a formula and opens the editor', () => {
    reset();
    const n = M.state.state.def.calculated?.length ?? 0;
    const c = cost(() => click({ act: 'pick-calc' }));
    expect(M.state.state.def.calculated?.length ?? 0).toBe(n + 1);
    expect(M.state.state.overlay).toBe('calc');
    expect(c).toEqual({ writes: 1, runs: 1, steps: 1 });
    fullPaintAgrees();
  });
});

describe('S. the save row reads the saved list once a keystroke', () => {
  it('one storage read for one character typed', () => {
    reset();
    M.schedules.saveSchedule({ ...M.state.state.def, name: 'Already there' }, null);
    M.lib.openLibrary(null, true);
    expect(M.state.state.libraryDraft?.kind).toBe('save');
    const ls = (globalThis as unknown as { localStorage: { getItem: (k: string) => string | null } }).localStorage;
    const getItem = ls.getItem;
    let reads = 0;
    ls.getItem = (k: string) => { if (k === M.schedules.SAVED_KEY) reads++; return getItem(k); };
    try {
      const pane = out();
      const el = new FakeEl('input', { act: 'library-save-name' }, pane);
      el.value = 'Already there';
      W.dispatch(el, 'input', {});
      pane.children.splice(pane.children.indexOf(el), 1);
    } finally {
      ls.getItem = getItem;
    }
    expect(M.state.state.libraryDraft?.text).toBe('Already there');
    expect(W.pane('overlay-root').innerHTML).toContain('Name taken');
    expect(reads, 'storage reads for one keystroke').toBe(1);
  });
});

describe('T. a panes paint runs no engine, and a real change still posts', () => {
  it('a rail-search keystroke during a preview runs the engine zero times', () => {
    reset();
    M.state.updateDef((d) => act.addFilterRule(d));
    M.state.update({ removedBy: 0 });
    vi.advanceTimersByTime(1000);
    const r0 = runs.n;
    const w0 = out().writes;
    const pane = out();
    const el = new FakeEl('input', { act: 'rail-query' }, pane);
    el.value = 'Wall';
    W.dispatch(el, 'input', {});
    pane.children.splice(pane.children.indexOf(el), 1);
    vi.advanceTimersByTime(1000);
    expect(M.state.state.railQuery).toBe('Wall');
    expect({ writes: out().writes - w0, runs: runs.n - r0 }).toEqual({ writes: 0, runs: 0 });
  });

  it('a definition change still posts `current` once, with the new schedule', () => {
    reset();
    posted.length = 0;
    M.state.updateDef((d) => act.setName(d, 'Posted name'));
    vi.advanceTimersByTime(300);
    const current = posted.filter((p) => p.type === 'current');
    expect(current).toHaveLength(1);
    expect((current[0].def as { name: string }).name).toBe('Posted name');
  });
});
