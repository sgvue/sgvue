// Audit B7 — Schedules window items.
//
//   3. A filter or a sort level added from the field picker at the cap says why nothing happened.
//   4. A delete the saved list refused does not say "Deleted", and changes nothing.
//   5. The formula guide names the column's menu, not the retired "Column formatting" panel.
//
// Run on the window's real composition root through `support/windowHarness.ts`, as
// `window-model.test.ts` does; the window's confirm dialog is the one thing replaced.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { snapshotOf } from '../../../src/schedule/adapter';
import * as act from '../../../src/schedule/schedule/actions';
import { MAX_FILTERS, MAX_SORT_LEVELS } from '../../../src/schedule/schedule/def';
import { federate } from '../../../src/shared/federate';
import { mockModelIndex } from '../../../src/renderer/dev/mock-adapter';
import { formulaHelp } from '../../../src/renderer/schedule-ui/overlays/formulaHelp';
import { FakeEl } from './support/fakeDom';
import { dialogModule, fakePort, installWindow, type DialogMock, type FakePort, type Window } from './support/windowHarness';

const dialog = vi.hoisted(() => ({ open: false, asked: [], answer: () => undefined }) as unknown as DialogMock);
vi.mock('../../../src/renderer/schedule-ui/dialog', () => dialogModule(dialog));

type Mods = {
  state: typeof import('../../../src/renderer/schedule-ui/state');
  actions: typeof import('../../../src/renderer/schedule-ui/actions');
  schedules: typeof import('../../../src/renderer/schedule-ui/schedules');
};
let W: Window;
let M: Mods;
let port: FakePort;
/** Every toast the window raised, in order (`dom.ts` `flash` makes one with `createElement`). */
const toasts: { className: string; textContent: string }[] = [];
const lastToast = () => toasts.at(-1) ?? null;

const SNAP = snapshotOf(federate(['ARC', 'STR'].map((k) => mockModelIndex(k))));
const deliver = (data: unknown) => port.onmessage!({ data: structuredClone(data) });

function click(data: Record<string, string>) {
  const pane = W.pane('output-pane');
  const el = new FakeEl('button', data, pane);
  W.dispatch(el, 'click', {});
  const at = pane.children.indexOf(el);
  if (at >= 0) pane.children.splice(at, 1);
}

beforeAll(async () => {
  vi.useFakeTimers();
  W = installWindow();
  const doc = (globalThis as unknown as { document: { createElement: (...a: unknown[]) => { className: string; textContent: string } } }).document;
  const make = doc.createElement;
  doc.createElement = (...a: unknown[]) => {
    const t = make(...a);
    toasts.push(t);
    return t;
  };
  await import('../../../src/renderer/schedule-ui/main');
  M = {
    state: await import('../../../src/renderer/schedule-ui/state'),
    actions: await import('../../../src/renderer/schedule-ui/actions'),
    schedules: await import('../../../src/renderer/schedule-ui/schedules'),
  };
  port = fakePort(() => undefined);
  W.connect(port);
  deliver({ type: 'store', snapshot: SNAP });
});
afterAll(() => {
  vi.useRealTimers();
});

describe('3. the field picker at the cap says why nothing was added', () => {
  it(`at ${MAX_FILTERS} filters a filter pick leaves ${MAX_FILTERS} and says so`, () => {
    const field = M.state.state.def.columns[0].field;
    M.state.updateDef((d) => {
      let next = d;
      for (let i = next.filters.length; i < MAX_FILTERS; i++) next = act.addFilterRule(next);
      return next;
    });
    expect(M.state.state.def.filters).toHaveLength(MAX_FILTERS);
    toasts.length = 0;
    click({ act: 'vb-add', v: 'filter', id: act.fieldKey(field) });
    expect(M.state.state.def.filters).toHaveLength(MAX_FILTERS);
    expect(lastToast()?.textContent).toBe(`${MAX_FILTERS} filter rules is the most a schedule holds.`);
  });

  it(`at ${MAX_SORT_LEVELS} sort levels a sort pick leaves ${MAX_SORT_LEVELS} and says so`, () => {
    const field = M.state.state.def.columns[0].field;
    M.state.updateDef((d) => {
      let next = d;
      for (let i = next.sort.length; i < MAX_SORT_LEVELS; i++) next = act.addSortLevel(next);
      return next;
    });
    expect(M.state.state.def.sort).toHaveLength(MAX_SORT_LEVELS);
    toasts.length = 0;
    click({ act: 'vb-add', v: 'sort', id: act.fieldKey(field) });
    expect(M.state.state.def.sort).toHaveLength(MAX_SORT_LEVELS);
    expect(lastToast()?.textContent).toBe(`${MAX_SORT_LEVELS} sort levels is the most a schedule holds — remove one first.`);
  });
});

describe('4. a refused delete does not say "Deleted"', () => {
  it('leaves the entry listed, keeps savedName and flashes the failure', async () => {
    const name = M.schedules.saveSchedule(M.state.state.def, null);
    expect(name).not.toBeNull();
    M.state.update({ savedName: name });
    const ls = (globalThis as unknown as { localStorage: { setItem: (k: string, v: string) => void } }).localStorage;
    const setItem = ls.setItem;
    ls.setItem = () => { throw new Error('QuotaExceededError'); };
    try {
      toasts.length = 0;
      M.actions.askDeleteSaved(name!);
      dialog.answer(true);
      await vi.advanceTimersByTimeAsync(50);
    } finally {
      ls.setItem = setItem;
    }
    expect(M.schedules.listSaved().map((e) => e.name)).toContain(name);
    expect(M.state.state.savedName).toBe(name);
    expect(lastToast()?.textContent).toBe('Could not delete — storage is unavailable or full.');
    expect(lastToast()?.className).toContain('bad');
  });
});

describe('5. the formula guide', () => {
  it('names the column’s menu, not "Column formatting"', () => {
    const html = formulaHelp();
    expect(html).not.toContain('Column formatting');
    expect(html).toContain('the column’s menu can');
  });
});
