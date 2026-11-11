// Drawing the Templates library without re-running the schedule behind it.
//
// Ported from ifcTable's `ui/libraryPaint.ts` (Yong Yen, 2026-11-07) for SGVue v1.5.0, phase 3.
// Moving the selection, typing in the search box, sorting and folding change only what the
// library shows. A full paint re-runs the table too — ~0.4 s on SGVue's largest measured
// category — so holding ↓ would crawl. These moves write their AppState fields and then paint
// the library alone, through a painter main.ts registers; the same shape as the popover-only
// paint. The fields are ordinary AppState, so a full paint draws the same library. Anything
// that changes more than the library (Use, Save, Rename, Delete, Import) still goes through
// update().
//
// Focus and scrolling are asked for here and done after the paint, after restoreUi — the
// order ifcTable's LESSONS require (fill → restore → focus/measure).

let painter: () => void = () => {};
export const setLibraryPainter = (fn: () => void) => { painter = fn; };
export const paintLibrary = () => painter();

let focusSel: string | null = null;
let selectText = false;
let scrollToSel = false;
let paneTop = false;

/** After the next paint, focus this control (by selector), optionally selecting its text. */
export function focusAfterPaint(selector: string, select = false) {
  focusSel = selector;
  selectText = select;
}

/** After the next paint, bring the selected row into view — and, for a new selection,
 *  start its pane from the top rather than where the last one was scrolled to. */
export function scrollAfterPaint(newSelection = false) {
  scrollToSel = true;
  paneTop ||= newSelection;
}

export function afterPaintLibrary() {
  if (focusSel) {
    const el = document.querySelector<HTMLElement>(focusSel);
    const select = selectText;
    focusSel = null;
    selectText = false;
    el?.focus({ preventScroll: true });
    if (select && el instanceof HTMLInputElement) el.select();
  }
  if (scrollToSel) {
    scrollToSel = false;
    document.querySelector('.lib-row.sel')?.scrollIntoView({ block: 'nearest' });
  }
  if (paneTop) {
    paneTop = false;
    const pane = document.querySelector('.lib-pane .pane-scroll');
    if (pane) pane.scrollTop = 0;
  }
}
