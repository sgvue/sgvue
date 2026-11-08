// No repaint while a button is held down.
//
// Ported from ifcTable's `ui/pressGate.ts` (Yong Yen, 2026-11-05) for SGVue v1.5.0, phase 2.
// SGVue already defers its OWN late paints past a press (`state.ts` `renderSoon`, fed by
// pending.ts); this gate covers every other paint — an `update()` or `updateDef()` that a
// press itself caused. With SGVue's three render scopes, two different owed scopes add up to
// 'all'.
//
// A press can itself cause a definition change before its click arrives: pressing a popover
// button moves focus off the box being typed in, and that box's pending edit lands — at
// POINTERDOWN. A repaint then rebuilds the button under the pointer, the release lands on its
// replacement, and the browser fires no click at all (the press and release targets share no
// ancestor in the live tree). Measured in ifcTable with a trusted click: type a decimal count,
// click Sum, and Sum did nothing.
//
// So a repaint asked for while a press is in progress is owed, not done, and paid on the next
// task after the release — after the click, which is dispatched in the same task as the
// pointerup. The definition change itself is never delayed, only the drawing of it. The
// release listener is capture-phase on window, so anything that commits from its own pointerup
// (the column resizer) sees the gate already open and paints at once.

import type { RenderScope } from './state';

const merge = (a: RenderScope | null, b: RenderScope): RenderScope =>
  (a === null || a === b ? b : 'all');

export function deferWhilePressed(paint: (scope: RenderScope) => void): (scope: RenderScope) => void {
  let pressed = false;
  let owed: RenderScope | null = null;

  document.addEventListener('pointerdown', (e) => { if (e.button === 0) pressed = true; }, true);
  const release = () => {
    if (!pressed) return;
    pressed = false;
    if (!owed) return;
    const scope = owed;
    owed = null;
    setTimeout(() => paint(scope), 0);
  };
  // Every way a press can end: released, cancelled (a native drag starts), or lost to another
  // window. A gate left shut would stop the window repainting at all.
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', release, true);
  // Some presses never send a pointerup here — a native scrollbar's, for one. The mouse's own
  // mouseup still arrives, and the next move with no button down says the same thing (the
  // colResize rule): either one opens the gate.
  window.addEventListener('mouseup', release, true);
  window.addEventListener('pointermove', (e) => { if (pressed && e.buttons === 0) release(); }, true);
  window.addEventListener('blur', release);
  document.addEventListener('dragstart', release, true);

  return (scope) => {
    if (!pressed) { paint(scope); return; }
    owed = merge(owed, scope);
  };
}
