// The left rail: every IFC class in the federation with its element count, then the setups
// saved in this window. Picking a category is the first move in building a schedule, so it
// is a permanent list rather than a dropdown you have to open.
//
// Ported from ifcTable's `ui/rail.ts` — phase 1 (2026-09-25) took the category list, its
// filter box and its A→Z order; phase 2 the collapse strip and the saved setups under the
// list, each row loading or deleting its setup and the loaded one marked. What stays out:
// "Browse templates…", "My templates…" and Save, which the header carries for this window;
// Export… and Import…, which return with phase 4; and the "Open model…" foot — models are
// opened in the main window.
//
// Drawn in SGVue's sidebar idiom: the uppercase 11 px section label with its mono count, the
// 13 px row with a 2 px accent edge when on, `hv-step` under the pointer.

import { disciplineForEntity } from '../../schedule/ifc/entities';
import type { ModelStore } from '../../schedule/ifc/store';
import { esc } from './dom';
import { AZ, chevronRight, cross, panel } from './icons';
import { listSaved } from './schedules';
import type { AppState } from './state';

export function renderRail(state: AppState, store: ModelStore): string {
  // Collapsed: a strip that is nothing but the way back. The control that hides this pane
  // sits inside it, and this is where its way back lives — the pane never fully disappears.
  if (!state.railOpen) {
    return `<button class="strip-open hv-step-ink" data-act="rail-toggle" aria-expanded="false"
      title="Show the categories panel" aria-label="Show the categories panel">${chevronRight(12)}</button>`;
  }
  const q = state.railQuery.trim().toLowerCase();
  const az = state.railSort === 'name';
  // A→Z sorts a COPY: `store.entities` is the store's own array, in count order.
  const listed = az ? [...store.entities].sort((a, b) => a.entity.localeCompare(b.entity))
    : store.entities;
  const matching = listed.filter((e) => !q || e.entity.toLowerCase().includes(q));

  const categories = matching.map((e) => {
    const on = state.def.entity.includes(e.entity);
    // Phase 3: the category holding a 3D selection this table does not show (main.ts keeps
    // the class in step in place; this is the same mark on a repaint).
    const here = state.selEntities.includes(e.entity);
    return `<button class="rail-item hv-step${on ? ' on' : ''}${here ? ' sel-here' : ''}" data-act="category" data-entity="${esc(e.entity)}"
      aria-pressed="${on}" title="Schedule the ${e.count.toLocaleString()} ${esc(e.entity)} elements"
      aria-label="${esc(e.entity)}, ${e.count.toLocaleString()} elements">
      <span class="dot ${disciplineForEntity(e.entity).toLowerCase()}"></span>
      <span class="grow">${esc(e.entity)}</span>
      <span class="n">${e.count.toLocaleString()}</span>
    </button>`;
  }).join('') || `<div class="rail-empty">Nothing matches “${esc(state.railQuery)}”.</div>`;

  const saved = listSaved();
  // Two sibling buttons rather than a clickable span, so both are focusable and neither is
  // nested inside the other. `aria-current`, not `aria-pressed`: the mark says which setup
  // you are on, and the button is not a toggle.
  const savedRows = saved.map((s) => {
    const on = s.name === state.savedName;
    return `<div class="rail-saved hv-step${on ? ' on' : ''}">
      <button class="grow" data-act="load-saved" data-name="${esc(s.name)}"${on ? ' aria-current="true"' : ''}
        title="Saved ${esc(s.savedAt.slice(0, 10))} · ${esc(s.def.entity.join(', ') || 'no category')}">${esc(s.name)}</button>
      ${on ? `<span class="n">${state.dirty ? 'edited' : 'in use'}</span>` : ''}
      <button class="x hv-warn-both" data-act="delete-saved" data-name="${esc(s.name)}"
        title="Delete this saved schedule" aria-label="Delete ${esc(s.name)}">${cross(10)}</button>
    </div>`;
  }).join('') || '<div class="rail-empty">Nothing saved yet.</div>';

  return `<div class="rail-search">
      <input type="search" data-act="rail-query" class="field"
        placeholder="filter categories…" aria-label="Filter categories"
        value="${esc(state.railQuery)}" />
      <button class="icon-btn hv-step${az ? ' on' : ''}" data-act="rail-sort" aria-pressed="${az}"
        data-tip="${az ? 'sort by count' : 'sort A to Z'}"
        aria-label="${az ? 'Sort categories by count' : 'Sort categories A to Z'}">${AZ}</button>
      <button class="icon-btn hv-step-ink" data-act="rail-toggle" aria-controls="rail-pane"
        aria-expanded="true" data-tip="hide categories" aria-label="Hide the categories panel">${panel}</button>
    </div>
    <div class="rail-label">
      <span>Categories</span>
      <span class="n">${matching.length}</span>
    </div>
    <div class="rail-body">${categories}</div>
    <div class="rail-sched">
      <div class="rail-label">
        <span>Saved</span>
        <span class="n">${saved.length}</span>
      </div>
      <div class="rail-group">${savedRows}</div>
    </div>`;
}
