// A repaint asked for while a button is held waits for the release, then lands after the
// click. Measured in the real app before the gate existed: type in the column menu's
// decimals box, click Sum — the box's blur `change` repainted the popover at pointerdown and
// Sum's click never fired. Proven to fail: make the returned function always paint at once
// and "a press defers…" fails.
//
// Ported from ifcTable's `tests/pressGate.test.ts` (Yong Yen, 2026-11-05) for SGVue v1.5.0,
// phase 2, with one case for SGVue's third render scope: a 'table' and a 'panes' owed add up
// to one 'all'.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderScope } from '../../../src/renderer/schedule-ui/state';
import { deferWhilePressed } from '../../../src/renderer/schedule-ui/pressGate';
import { FakeEl, installFakeDom } from './support/fakeDom';

const { root, dispatch } = installFakeDom();
const painted: RenderScope[] = [];
const gated = deferWhilePressed((s) => { painted.push(s); });
const button = new FakeEl('button', {}, root);

beforeEach(() => { vi.useFakeTimers(); painted.length = 0; });
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

describe('no repaint while a button is held', () => {
  it('paints at once when nothing is pressed', () => {
    gated('table');
    expect(painted).toEqual(['table']);
  });

  it('a press defers the paint past the release and the click, then pays it once', () => {
    dispatch(button, 'pointerdown');
    gated('table');
    gated('all');
    gated('table');
    expect(painted).toEqual([]);
    dispatch(button, 'pointerup');
    // The click is dispatched in the same task as the pointerup — still nothing drawn.
    dispatch(button, 'click');
    expect(painted).toEqual([]);
    vi.runOnlyPendingTimers();
    expect(painted).toEqual(['all']);
  });

  it('a cancelled press (a native drag starting) also opens the gate', () => {
    dispatch(button, 'pointerdown');
    gated('table');
    dispatch(button, 'pointercancel');
    vi.runOnlyPendingTimers();
    expect(painted).toEqual(['table']);
    gated('table');
    expect(painted).toEqual(['table', 'table']);
  });

  it('SGVue: a table paint and a panes paint owed together are one full paint', () => {
    dispatch(button, 'pointerdown');
    gated('table');
    gated('panes');
    dispatch(button, 'pointerup');
    vi.runOnlyPendingTimers();
    expect(painted).toEqual(['all']);
    dispatch(button, 'pointerdown');
    gated('panes');
    gated('panes');
    dispatch(button, 'pointerup');
    vi.runOnlyPendingTimers();
    expect(painted).toEqual(['all', 'panes']);
  });

  it('a secondary button press does not shut it', () => {
    dispatch(button, 'pointerdown', { button: 2 });
    gated('all');
    expect(painted).toEqual(['all']);
  });
});

describe('a press that never sends pointerup cannot leave the gate shut', () => {
  // A native scrollbar's press is the known case. Proven to fail: without the two
  // listeners below in pressGate.ts, the owed paint is never made.
  it('a move with no button down opens it', () => {
    dispatch(button, 'pointerdown');
    gated('all');
    dispatch(button, 'pointermove', { buttons: 1 });
    vi.runOnlyPendingTimers();
    expect(painted).toEqual([]);
    dispatch(button, 'pointermove', { buttons: 0 });
    vi.runOnlyPendingTimers();
    expect(painted).toEqual(['all']);
  });

  it('a mouseup opens it', () => {
    dispatch(button, 'pointerdown');
    gated('table');
    dispatch(button, 'mouseup');
    vi.runOnlyPendingTimers();
    expect(painted).toEqual(['table']);
  });
});
