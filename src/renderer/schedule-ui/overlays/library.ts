// The Templates library: ONE list + ONE preview pane for built-in and saved templates, in place
// of the template gallery and My templates — ported from ifcTable's `ui/overlays/library.ts`
// (Yong Yen, 2026-11-07, after d3c4989: a modal, with a model open only) for SGVue v1.5.0,
// phase 3. Drawn in this window's own modal card (`overlay-card`) and tokens.
//
// ifcTable's confirm sheet is not here: this window asks with its own dialog (dialog.ts),
// which sits above the card — see libraryActions.ts.

import type { ModelStore } from '../../../schedule/ifc/store';
import { esc } from '../dom';
import { ICON } from '../icons';
import { libraryView } from '../libraryCache';
import type { AppState } from '../state';
import { listBody, listHead, rowId } from './libraryList';
import { libraryPane } from './libraryPane';

function libraryBody(state: AppState, store: ModelStore): string {
  const view = libraryView(state, store);
  const sel = view.sel;
  return `<div class="lib-head">
      <h3>Templates</h3>
      <label class="lib-search">${ICON.search}
        <input type="search" class="lib-q" data-act="library-search" placeholder="Search templates"
          aria-label="Search templates" role="combobox" aria-expanded="true" aria-controls="lib-rows"
          ${sel ? `aria-activedescendant="${rowId(sel.key)}"` : ''} autocomplete="off" spellcheck="false"
          value="${esc(state.libraryQuery)}" />
      </label>
      <span class="spacer"></span>
      <button class="icon-btn hv-step" data-act="import-schedule" title="Import a .schedule.json file into Mine"
        aria-label="Import a .schedule.json file">${ICON.importFile}</button>
      <button class="btn lib-save-btn" data-act="library-save-new" title="Save the schedule on screen as a template"
        aria-label="Save current schedule">${ICON.save}<span class="lbl">Save current</span></button>
      <button class="icon-btn hv-step-ink" data-act="close-overlay" title="Close (Esc)" aria-label="Close">${ICON.close}</button>
    </div>
    <div class="lib">
      <div class="lib-list">
        ${listHead(state)}
        <div class="lib-rows" id="lib-rows" role="listbox" tabindex="0" aria-label="Templates" data-act="library-list">
          ${listBody(state, store, view)}
        </div>
      </div>
      <div class="lib-pane">${libraryPane(state, store, sel)}</div>
    </div>`;
}

export function renderLibrary(state: AppState, store: ModelStore): string {
  return `<div class="overlay" data-act="overlay-backdrop">
    <div class="overlay-card lib-card" role="dialog" aria-modal="true" aria-label="Templates">
      ${libraryBody(state, store)}
    </div>
  </div>`;
}
