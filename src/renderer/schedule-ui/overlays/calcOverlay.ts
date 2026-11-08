// The calculated-value editor, as its own modal. It used to sit in a corner of the
// Add-fields modal; the field picker replaced that modal's browsing, and this is the part
// that stayed. Opened by the picker's "+ Calculated value", a calculated column's "Edit
// formula", and the view bar's "N formulas to fix" chip. A finished value is added as a
// column from the picker, where it is listed with the other fields.
//
// Ported from ifcTable's `ui/overlays/calcOverlay.ts` (Yong Yen, 2026-11-05) for SGVue v1.5.0,
// phase 2, in the window's own modal card (`overlay-card`, `hv-step-ink` close, `cross`).

import type { ModelStore } from '../../../schedule/ifc/store';
import type { AppState } from '../state';
import { cross } from '../icons';
import { calcEditor } from './calcEditor';

export function calcOverlay(state: AppState, store: ModelStore): string {
  return `<div class="overlay" data-act="overlay-backdrop">
    <div class="overlay-card calc-card" role="dialog" aria-modal="true" aria-label="Calculated values">
      <div class="overlay-head">
        <div class="row top head-row">
          <div class="grow-1">
            <h3>Calculated values</h3>
            <p>Worked out from this schedule's columns — add one as a column from the fields chip</p>
          </div>
          <button class="overlay-close hv-step-ink" data-act="close-overlay" aria-label="Close">${cross(14, 1.8)}</button>
        </div>
      </div>
      <div class="calc-scroll">${calcEditor(state, store)}</div>
      <div class="overlay-foot">
        <span class="spacer"></span>
        <button class="btn primary" data-act="close-overlay">Done</button>
      </div>
    </div>
  </div>`;
}
