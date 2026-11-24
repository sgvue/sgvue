// Keyboard focus through a More… (step 2 of the one-line bar, fix round 1; Done 2): on the
// window's real composition root (`support/windowHarness.ts`, as `audit-b8-repaint.test.ts`
// and `viewBar-refold.test.ts` run it), with `#popover` a pane that READS its markup when it is
// written, so preserve.ts can find the same control again in the rebuilt body.
//
//   · Enter on a sort level's More… or on Style's opens it, and the focus is on More… again
//     after the repaint, now open;
//   · a control inside the open fold keeps the focus through the repaint its own edit causes.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { snapshotOf } from '../../../src/schedule/adapter';
import { federate } from '../../../src/shared/federate';
import { mockModelIndex } from '../../../src/renderer/dev/mock-adapter';
import { FakeEl, type FakeTarget } from './support/fakeDom';
import { dialogModule, fakePort, installWindow, type DialogMock, type Window } from './support/windowHarness';

const dialog = vi.hoisted(() => ({ open: false, asked: [], answer: () => undefined }) as unknown as DialogMock);
vi.mock('../../../src/renderer/schedule-ui/dialog', () => dialogModule(dialog));

function element(tag: string, attrs: string, parent: FakeTarget): FakeEl {
  const el = new FakeEl(tag, {}, parent);
  for (const m of attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
    const [, name, value = ''] = m;
    if (name.startsWith('data-')) el.dataset[name.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
    else if (name === 'class') el.classes = value.split(/\s+/).filter(Boolean);
    else el.attrs[name] = value;
  }
  if (tag === 'input' && el.attrs.type) el.type = el.attrs.type;
  return el;
}

/** A pane whose markup becomes elements: buttons, inputs and selects, nested as written. */
class ParsedPane extends FakeEl {
  private markup = '';
  hidden = false;
  override get innerHTML() { return this.markup; }
  override set innerHTML(v: string) {
    this.markup = v;
    this.writes++;
    this.children = [];
    const stack: FakeEl[] = [this];
    for (const m of v.matchAll(/<(\/?)(span|button|div|label|select|input)\b([^>]*?)(\/?)>/g)) {
      if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
      const el = element(m[2], m[3], stack[stack.length - 1]);
      if (m[2] !== 'input' && !m[4]) stack.push(el);
    }
  }
}

let W: Window;
let S: typeof import('../../../src/renderer/schedule-ui/state');
const SNAP = snapshotOf(federate(['ARC', 'STR'].map((k) => mockModelIndex(k))));
const settle = () => vi.advanceTimersByTime(1000);
const active = () => (globalThis as unknown as { document: { activeElement: FakeEl | null } }).document.activeElement!;
const pop = () => W.pane('popover');
const inPop = (sel: string) => pop().querySelector(sel)!;
/** Enter on a focused button: the browser's own activation, a click on the focused element. */
const enter = (el: FakeEl) => {
  el.focus();
  W.dispatch(el, 'keydown', { key: 'Enter' });
  W.dispatch(el, 'click');
  settle();
};

beforeAll(async () => {
  vi.useFakeTimers();
  W = installWindow();
  const at = W.app.children.findIndex((c) => c.attrs.id === 'popover');
  const pane = new ParsedPane('div', {}, null);
  pane.parent = W.app;
  pane.attrs.id = 'popover';
  W.app.children[at] = pane;
  (globalThis as Record<string, unknown>).HTMLElement = FakeEl;
  (globalThis as Record<string, unknown>).HTMLInputElement = class {};
  await import('../../../src/renderer/schedule-ui/main');
  S = await import('../../../src/renderer/schedule-ui/state');
  const port = fakePort(() => undefined);
  W.connect(port);
  port.onmessage!({ data: structuredClone({ type: 'store', snapshot: SNAP }) });
  settle();
  S.updateDef((d) => ({
    ...d, // A field that is not a column: the harness's headings cannot take the chip's column mark.
    sort: [{ field: { kind: 'core', key: 'guid' }, dir: 'asc', footer: 'title' }],
  }));
  settle();
});
afterAll(() => { vi.useRealTimers(); });

/** Open a chip's popover the way its chip's click does. */
function openChip(v: string, i?: string) {
  const chip = new FakeEl('button', { act: 'vb-open', v, ...(i === undefined ? {} : { i }) }, W.pane('centre-head'));
  W.dispatch(chip, 'click');
  settle();
}

describe('More… by keyboard keeps the focus', () => {
  it('a sort level: Enter opens More…, the focus is on More… again, and a switch inside keeps it through its edit', () => {
    openChip('sort', '0');
    const more = inPop('[data-act="vb-more"]');
    expect(more.attrs['aria-expanded']).toBe('false');
    enter(more);
    const again = active();
    expect(again === more, 'the popover body was rebuilt').toBe(false);
    expect(again.dataset.act).toBe('vb-more');
    expect(again.attrs['aria-expanded']).toBe('true');
    expect(pop().contains(again)).toBe(true);

    // A switch inside the fold: its edit repaints everything; the focus stays on it.
    const header = inPop('[data-act="sort-header"]');
    header.focus();
    header.checked = true;
    W.dispatch(header, 'change');
    settle();
    expect(S.state.def.sort[0].header).toBe(true);
    const now = active();
    expect(now === header, 'the popover body was rebuilt').toBe(false);
    expect(now.dataset.act).toBe('sort-header');
    expect(pop().contains(now)).toBe(true);
    expect(inPop('[data-act="vb-more"]').attrs['aria-expanded'], 'the fold is still open').toBe('true');
  });

  it('Style: Enter opens More…, the focus stays on it, and the body font keeps it through its edit', () => {
    openChip('style');
    enter(inPop('[data-act="vb-more"]'));
    expect(active().dataset.act).toBe('vb-more');
    expect(active().attrs['aria-expanded']).toBe('true');
    const font = inPop('[data-act="app-outline"]');
    font.focus();
    font.checked = false;
    W.dispatch(font, 'change');
    settle();
    expect(S.state.def.appearance?.outline).toBe(false);
    expect(active().dataset.act).toBe('app-outline');
    expect(active() === font).toBe(false);
    expect(pop().contains(active())).toBe(true);
  });
});
