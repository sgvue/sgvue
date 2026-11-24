// The view bar re-folds after every paint and on a window resize, and keeps the keyboard
// focus and the open popover while it does (2026-11-25, the one-line bar; Done 2).
//
// Run on the window's real composition root through `support/windowHarness.ts`, as
// `audit-b8-repaint.test.ts` does. The harness lays nothing out, so `#centre-head` here is a
// pane that READS its markup when it is written: every span, button and div becomes an element
// with its data-* attributes and classes, and the bar's top-level items are placed left to
// right with fixed widths (a filter chip 100 px, a sort chip 120 px, either +N chip 36 px,
// anything else 30 px, a 3 px gap, the spacer taking what is left) inside a bar whose width the test sets. That is enough
// for the window's own measuring code to decide how many chips fit, and for preserve.ts to find
// the same control again in the rebuilt bar. How the bar really looks needs a window.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { snapshotOf } from '../../../src/schedule/adapter';
import * as act from '../../../src/schedule/schedule/actions';
import type { FilterRule } from '../../../src/schedule/schedule/def';
import { federate } from '../../../src/shared/federate';
import { mockModelIndex } from '../../../src/renderer/dev/mock-adapter';
import { FakeEl, type FakeTarget } from './support/fakeDom';
import { dialogModule, fakePort, installWindow, type DialogMock, type FakePort, type Window } from './support/windowHarness';

const dialog = vi.hoisted(() => ({ open: false, asked: [], answer: () => undefined }) as unknown as DialogMock);
vi.mock('../../../src/renderer/schedule-ui/dialog', () => dialogModule(dialog));

const GAP = 3;
let barWidth = 2000;

/** One tag's attributes onto an element: data-* to its dataset, class to its classes. */
function element(tag: string, attrs: string, parent: FakeTarget): FakeEl {
  const el = new FakeEl(tag, {}, parent);
  for (const m of attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
    const [, name, value = ''] = m;
    if (name.startsWith('data-')) el.dataset[name.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
    else if (name === 'class') el.classes = value.split(/\s+/).filter(Boolean);
    else el.attrs[name] = value;
  }
  return el;
}

/** `#centre-head`: its markup becomes elements, and the bar's items are laid out in a row. */
class HeadPane extends FakeEl {
  private markup = '';
  override get innerHTML() { return this.markup; }
  override set innerHTML(v: string) {
    this.markup = v;
    this.writes++;
    this.children = [];
    const stack: FakeEl[] = [this];
    for (const m of v.matchAll(/<(\/?)(span|button|div)\b([^>]*)>/g)) {
      if (m[1]) { stack.pop(); continue; }
      stack.push(element(m[2], m[3], stack[stack.length - 1]));
    }
    this.layout();
  }
  /** Place the bar's items at the current `barWidth` — after a write, and on a resize. */
  layout() {
    const bar = this.querySelector('.viewbar');
    if (!bar) return;
    bar.rect = { left: 0, right: barWidth, top: 0, bottom: 28, width: barWidth, height: 28 };
    const widthOf = (el: FakeEl) => (el.classList.contains('spacer') ? 0
      : el.classList.contains('fold') || el.classList.contains('sfold') ? 36
        : el.classList.contains('filter') ? 100 : el.classList.contains('sort') ? 120 : 30);
    const fixed = bar.children.reduce((s, c) => s + widthOf(c), 0) + GAP * (bar.children.length - 1);
    let x = 0;
    for (const c of bar.children) {
      const w = c.classList.contains('spacer') ? Math.max(0, barWidth - fixed) : widthOf(c);
      c.rect = { left: x, right: x + w, top: 0, bottom: 28, width: w, height: 28 };
      // The right-hand group's buttons share its 30 px, so each has a place of its own.
      c.children.forEach((b, k) => {
        const bw = w / c.children.length;
        b.rect = { left: x + k * bw, right: x + (k + 1) * bw, top: 0, bottom: 28, width: bw, height: 28 };
      });
      x += w + GAP;
    }
  }
}

let W: Window;
let port: FakePort;
let S: typeof import('../../../src/renderer/schedule-ui/state');
let P: typeof import('../../../src/renderer/schedule-ui/popover');
const SNAP = snapshotOf(federate(['ARC', 'STR'].map((k) => mockModelIndex(k))));
const NAME = { kind: 'core', key: 'name' } as const;
const FIVE: FilterRule[] = [
  { field: NAME, op: 'hasValue' }, { field: NAME, op: 'contains', value: '' }, { field: NAME, op: 'startsWith', value: '' },
  { field: NAME, op: 'endsWith', value: '' }, { field: NAME, op: 'in', values: [] },
];

const head = () => W.pane('centre-head');
const chips = () => head().querySelectorAll('.vchip').filter((c) => c.classList.contains('filter')).length;
const fold = () => head().querySelector('[data-v="fold"]');
const sorts = () => head().querySelectorAll('.vchip').filter((c) => c.classList.contains('sort')).length;
const sfold = () => head().querySelector('[data-v="sfold"]');
/** Everything on the bar but the filter and sort chips, as laid out with all of them shown. */
function rest(): number {
  const kids = head().querySelector('.viewbar')!.children;
  const spacer = kids.find((c) => c.classList.contains('spacer'))!;
  return kids[kids.length - 1].rect.right - kids[0].rect.left - spacer.rect.width - chips() * (100 + GAP) - sorts() * (120 + GAP);
}
const resize = (w: number) => { barWidth = w; (head() as HeadPane).layout(); W.dispatch(W.root, 'resize'); };
const settle = () => vi.advanceTimersByTime(1000);
const click = (el: FakeEl) => { W.dispatch(el, 'pointerdown'); W.dispatch(el, 'pointerup'); W.dispatch(el, 'click'); settle(); };

beforeAll(async () => {
  vi.useFakeTimers();
  W = installWindow();
  // Before main.ts looks its panes up by id.
  const at = W.app.children.findIndex((c) => c.attrs.id === 'centre-head');
  const pane = new HeadPane('div', {}, null);
  pane.parent = W.app;
  pane.attrs.id = 'centre-head';
  W.app.children[at] = pane;
  // preserve.ts names only an HTMLElement; here every element is a FakeEl.
  (globalThis as Record<string, unknown>).HTMLElement = FakeEl;
  await import('../../../src/renderer/schedule-ui/main');
  S = await import('../../../src/renderer/schedule-ui/state');
  P = await import('../../../src/renderer/schedule-ui/popover');
  port = fakePort(() => undefined);
  W.connect(port);
  port.onmessage!({ data: structuredClone({ type: 'store', snapshot: SNAP }) });
  settle();
  S.updateDef((d) => ({
    ...d, filters: structuredClone(FIVE),
    sort: [{ field: { kind: 'core', key: 'storey' }, dir: 'asc' }, { field: { kind: 'core', key: 'typeName' }, dir: 'asc' },
      { field: { kind: 'core', key: 'mark' }, dir: 'asc' }],
  }));
  settle();
});
afterAll(() => { vi.useRealTimers(); });

describe('the bar folds to fit, after a paint and on resize', () => {
  it('wide: three chips and +2', () => {
    resize(2000);
    expect(chips()).toBe(3);
    expect(fold()?.attrs['aria-label']).toBe('2 more filters');
  });

  it('narrower and narrower: filters to one, sorts to one, the last filter, the last sort; wide again: all', () => {
    resize(2000);
    expect([chips(), sorts()]).toEqual([3, 3]);
    expect(sfold()).toBe(null);
    const R = rest();
    const F = 100 + GAP;
    const So = 120 + GAP;
    const fold = 36 + GAP;
    // 2 px of slack each: the window guesses +N at 40 px until it is drawn.
    const steps: [number, [number, number]][] = [
      [R + F + 3 * So + 2, [1, 3]],
      [R + F + 2 * So + fold + 2, [1, 2]],
      [R + F + So + fold + 2, [1, 1]],
      [R + So + fold + 2, [0, 1]],
      [R + fold + 2, [0, 0]],
      // Nothing is left to fold: the bar runs past its box rather than wrap.
      [R + fold - 40, [0, 0]],
    ];
    for (const [width, want] of steps) {
      resize(width);
      expect([chips(), sorts()], `at ${width} px`).toEqual(want);
    }
    expect(sfold()?.attrs['aria-label']).toBe('3 more sort levels');
    resize(R + F + So + fold + 2);
    expect([chips(), sorts()]).toEqual([1, 1]);
    expect(sfold()?.attrs['aria-label']).toBe('2 more sort levels');
    expect(sfold()?.dataset.tip).toMatch(/^Then sorted by [^·]+ · Then sorted by [^·]+$/);
    resize(2000);
    expect([chips(), sorts()]).toEqual([3, 3]);
    expect(sfold()).toBe(null);
  });

  it('a paint that adds a rule re-folds too', () => {
    resize(2000);
    S.updateDef((d) => act.addFilterRule(d));
    settle();
    expect(chips()).toBe(3);
    expect(fold()?.attrs['aria-label']).toBe('3 more filters');
    S.updateDef((d) => act.removeFilterRule(d, 5));
    settle();
  });
});

describe('focus and the open popover survive the refold', () => {
  it('the focused Σ is focused again in the rebuilt bar', () => {
    resize(2000);
    const sigma = head().querySelector('[data-act="grand-total"]')!;
    sigma.focus();
    resize(300);
    const now = (globalThis as unknown as { document: { activeElement: FakeEl } }).document.activeElement;
    expect(now === sigma, 'the bar was rebuilt').toBe(false);
    expect(now.dataset.act).toBe('grand-total');
    expect(head().contains(now)).toBe(true);
  });

  it('the +N list stays open, lists what is folded now, and stays anchored on +N', () => {
    resize(2000);
    click(fold()!);
    expect(P.popoverId()).toBe('fold');
    expect(W.pane('popover').innerHTML).not.toMatch(/data-act="vb-open"\s+data-v="filter" data-i="2"/);
    resize(300);
    expect(P.popoverId()).toBe('fold');
    expect(W.pane('popover').innerHTML).toMatch(/data-act="vb-open"\s+data-v="filter" data-i="0"/);
    expect(fold()!.attrs['aria-expanded']).toBe('true');
    P.closePopover();
  });

  it('a folded rule’s editor stays open on +N through a resize', () => {
    resize(2000);
    click(fold()!);
    const row = new FakeEl('button', { act: 'vb-open', v: 'filter', i: '4' }, W.pane('popover'));
    click(row);
    W.pane('popover').children = [];
    expect(P.popoverId()).toBe('filter:4');
    resize(900);
    expect(P.popoverId()).toBe('filter:4');
    expect(fold()!.attrs['aria-expanded']).toBe('true');
    P.closePopover();
  });
});

describe('folded sort levels (fix round 1)', () => {
  const narrow = () => { resize(2000); const R = rest(); resize(R + 100 + GAP + 120 + GAP + 36 + GAP + 2); };

  it('the sort +N lists the folded levels, each with a direction and a group button that work in one click', () => {
    narrow();
    expect(sorts()).toBe(1);
    click(sfold()!);
    expect(P.popoverId()).toBe('sfold');
    const html = W.pane('popover').innerHTML;
    for (const i of ['1', '2']) {
      expect(html).toMatch(new RegExp(`data-act="vb-open"\\s+data-v="sort" data-i="${i}"`));
      expect(html).toMatch(new RegExp(`data-act="sort-dir" data-i="${i}"`));
      expect(html).toMatch(new RegExp(`data-act="sort-group" data-i="${i}"`));
    }
    expect(html).not.toMatch(/data-i="0"/);
    const before = S.state.def;
    const dir = new FakeEl('button', { act: 'sort-dir', i: '2' }, W.pane('popover'));
    click(dir);
    expect(S.state.def.sort[2].dir).toBe(before.sort[2].dir === 'desc' ? 'asc' : 'desc');
    const group = new FakeEl('button', { act: 'sort-group', i: '1' }, W.pane('popover'));
    click(group);
    expect(S.state.def.sort[1]).toMatchObject({ header: true, footer: 'titleCountTotals' });
    W.pane('popover').children = [];
    // One click, and the list is still open.
    expect(P.popoverId()).toBe('sfold');
    P.closePopover();
  });

  it('a row’s name opens that level’s popover on the sort +N, and on its own chip once there is room', () => {
    narrow();
    click(sfold()!);
    const row = new FakeEl('button', { act: 'vb-open', v: 'sort', i: '2' }, W.pane('popover'));
    click(row);
    W.pane('popover').children = [];
    expect(P.popoverId()).toBe('sort:2');
    expect(W.pane('popover').innerHTML).toMatch(/data-act="sort-field" data-i="2"/);
    expect(sfold()!.attrs['aria-expanded']).toBe('true');
    resize(2000);
    expect(P.popoverId()).toBe('sort:2');
    expect(sfold()).toBe(null);
    expect(head().querySelector('[data-act="vb-open"][data-v="sort"][data-i="2"]')!.attrs['aria-expanded']).toBe('true');
    P.closePopover();
  });
});

describe('a tooltip hangs toward the side with more room (fix round 1)', () => {
  it('the brush at the right edge hangs left; the count at the left edge hangs right', () => {
    resize(2000);
    const tipEnd = (sel: string) => head().querySelector(sel)!.classList.contains('tip-end');
    expect(tipEnd('[data-v="style"]')).toBe(true);
    expect(tipEnd('.vcount')).toBe(false);
    // innerWidth is 1280: the first sort chip starts near 480 px and hangs right; the sort +
    // ends near 880 px, with more room to its left, and hangs left.
    resize(1200);
    expect(tipEnd('[data-v="sort"][data-i="0"]')).toBe(false);
    expect(tipEnd('[data-v="add-sort"]')).toBe(true);
  });
});

describe('the kept count flashes when it changes, and only then', () => {
  it('a rule that changes the count flashes; a style switch does not', () => {
    resize(2000);
    S.updateDef((d) => act.addFilterRule({ ...d, filters: d.filters.slice(0, 1) }));
    settle();
    S.updateDef((d) => act.setFilterOp(d, 1, 'noValue'));
    settle();
    expect(head().querySelector('.vcount')!.classList.contains('bump')).toBe(true);
    click(head().querySelector('[data-act="app-grid"]')!);
    expect(head().querySelector('.vcount')!.classList.contains('bump')).toBe(false);
  });
});
