// The inspector's width, dragged by its left edge. Motion state, same rule as dnd.ts and
// loadingProgress.ts: it changes on every pointer move and nothing reads it back — the
// width lives on the pane element as an inline --inspector-w, which innerHTML repaints
// never touch — so it MUST NOT import state or trigger a render. A repaint mid-drag would
// rebuild the handle under the pointer and kill the gesture.

import { clamp } from './dom';

// SGVue: this window's own key, under the `sgvue.schedules.` prefix (2026-09-25).
export const WIDTH_KEY = 'sgvue.schedules.inspectorW';
const MIN = 340;
const MAX = 560;

const clampWidth = (w: number) => clamp(Math.round(w), MIN, MAX);

/** Re-apply the saved width at boot. Absent or garbage means the stylesheet default. */
export function initInspectorWidth(pane: HTMLElement) {
  const stored = (() => {
    try { return Number(localStorage.getItem(WIDTH_KEY)); } catch { return NaN; }
  })();
  if (Number.isFinite(stored) && stored >= MIN) {
    pane.style.setProperty('--inspector-w', `${clampWidth(stored)}px`);
  }
}

/**
 * Delegated from the stable root, because the handle itself is torn down and redrawn by
 * every inspector repaint — a listener on the element would be orphaned by the next paint.
 */
export function wireInspectorResize(root: HTMLElement, pane: HTMLElement) {
  root.addEventListener('pointerdown', (e) => {
    const handle = (e.target as HTMLElement)?.closest<HTMLElement>('[data-act="panel-resize"]');
    if (!handle) return;
    e.preventDefault();

    // Capture keeps the stream coming when the pointer leaves the window mid-drag — the
    // usual way a resize listener gets stranded and the pane follows the mouse forever.
    try { handle.setPointerCapture(e.pointerId); } catch { /* fine — the guards below cover it */ }

    const startX = e.clientX;
    const startW = pane.getBoundingClientRect().width;
    handle.classList.add('active');
    let width = startW;

    const move = (ev: PointerEvent) => {
      // The button came up somewhere no pointerup could reach us (alt-tab, a system
      // gesture) — treat the next movement as the release rather than dragging a pane
      // no one is holding.
      if (ev.buttons === 0) { up(); return; }
      width = clampWidth(startX - ev.clientX + startW);
      pane.style.setProperty('--inspector-w', `${width}px`);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      // The handle may already be a new element by now; the class dies with the old one.
      handle.classList.remove('active');
      try { localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* private mode */ }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}
