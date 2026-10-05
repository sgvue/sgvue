// One pending typed edit, and the rule for when it lands — 2026-09-25, phase 2 review.
//
// ifcTable debounced each text box with its own timer per selector, and nothing ever flushed
// one. Three ways that lost or misplaced what was typed:
//   · typing in filter rule 1, then rule 2, inside the delay — the second keystroke reset the
//     shared timer and rule 1's text was never applied;
//   · typing a column heading, then clicking another column inside the delay — the edit
//     looked up "the column being formatted" when the timer fired, and renamed the new one;
//   · typing the schedule's name, then Save inside the delay — the save read the old name.
//
// So there is one pending edit for the whole window, bound when it is typed: `later()` takes
// the box it came from and an `apply` that already holds its target (the rule, the column,
// the definition), resolved at input time. It lands
//   · when its delay runs out, as before;
//   · synchronously, the moment input arrives from any OTHER box;
//   · synchronously, when focus leaves its box (`focusout`, delegated on the root);
//   · synchronously, before any click or keyboard action anywhere in the window runs
//     (capture-phase listeners on the window), so every handler reads what was typed.
// Landing only changes state; the repaint goes through `renderSoon`, which never rebuilds the
// window while a pointer is down (state.ts says why). "Down" must never stick: a release can
// happen where no pointerup reaches the page (outside the window, at the end of a scrollbar
// drag, across an alt-tab), so a move with no button held, the window losing focus, and any
// key press all count as the release too — otherwise every later edit would land unpainted.

import { renderSoon, setPointerDown, type RenderScope } from './state';

interface Pending {
  el: EventTarget;
  apply: () => void;
  scope: RenderScope;
  timer: ReturnType<typeof setTimeout>;
}

let pending: Pending | null = null;

/** Hold a typed edit from `el`; it lands after `ms`, or sooner (see above). */
export function later(el: EventTarget, apply: () => void, scope: RenderScope, ms: number) {
  if (pending && pending.el !== el) flushPending();
  if (pending) clearTimeout(pending.timer);
  pending = { el, apply, scope, timer: setTimeout(flushPending, ms) };
}

/** Land the pending edit now, if there is one. */
export function flushPending() {
  const p = pending;
  if (!p) return;
  pending = null;
  clearTimeout(p.timer);
  p.apply();
  renderSoon(p.scope);
}

/** Keys that stay inside the box being typed in; anything else is an action, and flushes. */
const typing = (e: KeyboardEvent) => !(e.ctrlKey || e.metaKey || e.altKey)
  && e.key !== 'Enter' && e.key !== 'Escape' && e.key !== 'Tab';

/**
 * `root` is `#app`; `win` is the window, whose capture phase runs before every handler in the
 * page — the app's delegated ones and the dialog's own.
 */
export function wirePending(root: EventTarget, win: EventTarget) {
  root.addEventListener('focusout', (e) => { if (pending && e.target === pending.el) flushPending(); });
  win.addEventListener('pointerdown', () => setPointerDown(true), true);
  win.addEventListener('pointerup', () => setPointerDown(false), true);
  win.addEventListener('pointercancel', () => setPointerDown(false), true);
  // The same guard colResize.ts uses for a drag no one is holding any more.
  win.addEventListener('pointermove', (e) => {
    if ((e as PointerEvent).buttons === 0) setPointerDown(false);
  }, true);
  win.addEventListener('blur', () => setPointerDown(false));
  win.addEventListener('click', (e) => { if (pending && e.target !== pending.el) flushPending(); }, true);
  win.addEventListener('keydown', (e) => {
    setPointerDown(false);
    if (pending && (e.target !== pending.el || !typing(e as KeyboardEvent))) flushPending();
  }, true);
}
