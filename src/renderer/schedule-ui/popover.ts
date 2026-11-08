// The one popover: a single node in schedule.html, outside every render scope, that hangs from
// whatever opened it — a column heading, a view-bar chip or the field picker.
//
// Ported from ifcTable's `ui/popover.ts` (Yong Yen, 2026-11-05) for SGVue v1.5.0, phase 2 of
// the table-first port. Drawn in the window's card look (schedule.css `.popover`: ContextMenu's
// `--card` box, `--border-strong` edge and `--shadow`). What SGVue adds: `wirePopover` takes
// a `blocked` test, so Escape goes to the window's own dialog or right-click menu first when
// one is on top; and every reach for the document is guarded, so the assistant's requests
// (manage.ts), which run headless in the unit tests, can close it safely.
//
// Which popover is open, and what it hangs from, is a module variable and never AppState:
// it is compared by id, never by element, because the element it hangs from is rebuilt by
// every repaint. Its position is motion state — moved in place after each paint and on
// scroll or resize, never repainted. Only its BODY is filled by render(); preserveUi treats it
// as a pane, so a box being typed in keeps focus and caret.
//
// Order inside paint(), proven by ifcTable's spike: fill → restoreUi → afterPaintPopover.
// Anchoring before restoreUi measures a table whose scroll position has not been put back yet,
// and focusing before it lets restoreUi hand focus straight back to whatever had it.

const hasDom = () => typeof document !== 'undefined';

let pop: HTMLElement | null = null;
/** Who is open, e.g. `col:3`. One at a time: opening another replaces it. */
let openId: string | null = null;
/** A selector for the CURRENT anchor element, looked up afresh after every paint. */
let anchorSel = '';
/** The scrollport that can carry the anchor out of sight, if any. */
let clipSel = '';
let focusPending = false;

const node = () => (pop ??= hasDom() ? document.getElementById('popover') : null);
const anchorEl = () => (anchorSel && hasDom() ? document.querySelector<HTMLElement>(anchorSel) : null);
/** What a screen reader hears as expanded, and where Escape returns focus: the anchor's own
 *  menu button when it holds one, else the anchor itself (SGVue: a heading cell is its own
 *  trigger — it carries the tabindex and `aria-haspopup`). */
const triggerOf = (a: HTMLElement | null) => a?.querySelector<HTMLElement>('[aria-haspopup]') ?? a;

export const popoverId = () => openId;

/** Marks set in place for an open popover (a chip's column) come off with it — no repaint. */
const closeHooks: (() => void)[] = [];
export const onPopoverClose = (fn: () => void) => { closeHooks.push(fn); };

/**
 * Draw the popover alone — its body, its anchor, its marks — and leave the table be. For
 * opening a popover, closing one, and moving inside one (a sub-view, More…): none of that
 * changes the schedule, and repainting a 3,200-row table to show a menu cost ~0.9 s in
 * ifcTable. Edits still go through update(), which repaints what they change, popover
 * included. main.ts owns the drawing (it holds the result the column menu reads), so it
 * registers it here.
 */
let painter: () => void = () => {};
export const setPopoverPainter = (fn: () => void) => { painter = fn; };
export const paintPopover = () => painter();

/** Open (or move) the popover. `focus` puts the caret in its first field after the paint. */
export function openPopover(id: string, anchor: string, clip = '', focus = true) {
  if (openId !== id) {
    triggerOf(anchorEl())?.removeAttribute('aria-expanded');
    for (const fn of closeHooks) fn();
  }
  openId = id;
  anchorSel = anchor;
  clipSel = clip;
  focusPending = focus;
}

/** Second press on the same anchor closes it, as a menu button does. */
export function togglePopover(id: string, anchor: string, clip = '') {
  if (openId === id) closePopover();
  else openPopover(id, anchor, clip);
}

/**
 * Hide it — no repaint needed, nothing it holds is drawn anywhere else. `returnFocus` is for
 * Escape: keyboard users land back on the heading they opened it from.
 */
export function closePopover(returnFocus = false) {
  const back = triggerOf(anchorEl());
  back?.removeAttribute('aria-expanded');
  openId = null;
  anchorSel = '';
  focusPending = false;
  const el = node();
  if (el) { el.hidden = true; el.innerHTML = ''; }
  for (const fn of closeHooks) fn();
  if (returnFocus) back?.focus({ preventScroll: true });
}

/** Called by paint() BEFORE restoreUi, so a focused box can be restored. */
export function fillPopover(html: string) {
  const el = node();
  if (!el) return;
  if (!openId) { el.hidden = true; el.innerHTML = ''; return; }
  // eslint-disable-next-line no-unsanitized/property -- renderColumnMenu / renderViewPopover: every file- or user-derived value in them goes through esc()
  el.innerHTML = html;
}

/** Called by paint() on every pass, AFTER restoreUi. */
export function afterPaintPopover() {
  if (!openId) return;
  anchorPopover();
  const el = node();
  if (!focusPending || !el || el.hidden) return;
  focusPending = false;
  const first = el.querySelector<HTMLElement>('.pop-focus')
    ?? el.querySelector<HTMLElement>('input, select, button');
  if (!first) return;
  first.focus({ preventScroll: true });
  if (first instanceof HTMLInputElement && first.type === 'text') {
    const n = first.value.length;
    first.setSelectionRange(n, n);
  }
}

/** Gap kept between the popover and the window edge, and between it and its anchor. */
const EDGE = 8;
const GAP = 4;

/** Sit under the anchor, inside the window; flip above when below is much tighter. */
export function anchorPopover() {
  const el = node();
  if (!el || !openId) return;
  const a = anchorEl();
  // The thing it hung from is gone (a hidden or removed column): nothing to point at.
  if (!a) { closePopover(); return; }
  triggerOf(a)?.setAttribute('aria-expanded', 'true');
  el.hidden = false;
  const r = a.getBoundingClientRect();
  const clip = clipSel ? a.closest(clipSel)?.getBoundingClientRect() : null;
  // Scrolled out of its scrollport: hide rather than float over nothing.
  el.style.visibility = clip && (r.right < clip.left || r.left > clip.right) ? 'hidden' : '';

  el.style.maxHeight = '';
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const below = innerHeight - r.bottom - GAP - EDGE;
  const above = r.top - GAP - EDGE;
  const up = h > below && above > below;
  const room = up ? above : below;
  el.style.maxHeight = `${Math.max(120, room)}px`;
  const left = Math.max(clip ? Math.max(EDGE, clip.left) : EDGE, r.left);
  el.style.left = `${Math.min(left, innerWidth - w - EDGE)}px`;
  el.style.top = up ? `${Math.max(EDGE, r.top - GAP - Math.min(h, room))}px` : `${r.bottom + GAP}px`;
}

/**
 * Outside click, Escape, scroll and resize. The outside test is decided at POINTERDOWN, from
 * what the press hit, before anything can repaint — the click that follows may land on an
 * ancestor of two targets, or on a node a repaint has replaced (ifcTable LESSONS). A press on
 * the anchor itself is not outside: the anchor's own click handler toggles.
 *
 * `blocked` (SGVue): something sits on top of the popover — the window's dialog or its
 * right-click menu — and owns Escape while it is there.
 */
export function wirePopover(scroller: HTMLElement, blocked: () => boolean = () => false) {
  let pressOutside = false;
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as Node;
    pressOutside = !!openId && !node()?.contains(t) && !anchorEl()?.contains(t);
  }, true);
  document.addEventListener('click', () => {
    if (openId && pressOutside) closePopover();
    pressOutside = false;
  }, true);
  // Capture, so it runs before — and stops — the other Escape handlers: one Escape closes
  // the thing on top, not the popover and a column selection together.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !openId || blocked()) return;
    e.preventDefault();
    e.stopPropagation();
    closePopover(true);
  }, true);
  // scroll does not bubble; capture catches the table-wrap's, whichever element it is now.
  scroller.addEventListener('scroll', anchorPopover, true);
  window.addEventListener('resize', anchorPopover);
}
