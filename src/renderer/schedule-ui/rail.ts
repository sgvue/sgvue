// The left rail: every IFC class in the federation with its element count, then the setups
// saved in this window. Picking a category is the first move in building a schedule, so it
// is a permanent list rather than a dropdown you have to open.
//
// Ported from ifcTable's `ui/rail.ts` — phase 1 (2026-09-25) took the category list, its
// filter box and its A→Z order; phase 2 the collapse strip. v1.5.0, phase 3 (ifcTable
// 2026-11-07): under the list, one way into the Templates library (`T`) and the schedule in
// use, where the saved rows were. What stays out: Save, Export and Import, which this window's
// header and the library carry; and the "Open model…" foot — models are opened in the main
// window.
//
// Drawn in SGVue's sidebar idiom: the uppercase 11 px section label with its mono count, the
// 13 px row with a 2 px accent edge when on, `hv-step` under the pointer.

import { disciplineForEntity } from '../../schedule/ifc/entities';
import type { ModelStore } from '../../schedule/ifc/store';
import { esc } from './dom';
import { ICON } from './icons';
import type { AppState } from './state';

export function renderRail(state: AppState, store: ModelStore): string {
  // Collapsed: a strip that is nothing but the way back. The control that hides this pane
  // sits inside it, and this is where its way back lives — the pane never fully disappears.
  if (!state.railOpen) {
    return `<button class="strip-open hv-step-ink" data-act="rail-toggle" aria-expanded="false"
      title="Show the categories panel" aria-label="Show the categories panel">${ICON.chevronRight}</button>`;
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

  // v1.5.0, phase 3 (ifcTable 2026-11-07): the saved rows give way to one way into the
  // Templates library and the schedule in use — its name, and whether it is saved.
  const from = state.savedName ?? (state.templateId ? 'template' : null);
  const status = !from ? '<span class="state edited">not saved</span>'
    : state.dirty ? '<span class="state edited">edited</span>' : '<span class="state">in use</span>';
  const current = state.def.entity.length ? `<div class="rail-item cur-row on" title="${esc(state.def.name)}">
      <span class="grow">${esc(state.def.name)}</span>${status}
    </div>` : '';

  return `<div class="rail-search">
      <input type="search" data-act="rail-query" class="field"
        placeholder="filter categories…" aria-label="Filter categories"
        value="${esc(state.railQuery)}" />
      <button class="icon-btn hv-step${az ? ' on' : ''}" data-act="rail-sort" aria-pressed="${az}"
        data-tip="${az ? 'sort by count' : 'sort A to Z'}"
        aria-label="${az ? 'Sort categories by count' : 'Sort categories A to Z'}">${ICON.sortAsc}</button>
      <button class="icon-btn hv-step-ink" data-act="rail-toggle" aria-controls="rail-pane"
        aria-expanded="true" data-tip="hide categories" aria-label="Hide the categories panel">${ICON.panel}</button>
    </div>
    <div class="rail-label">
      <span>Categories</span>
      <span class="n">${matching.length}</span>
    </div>
    <div class="rail-body">${categories}</div>
    <div class="rail-sched">
      <div class="rail-label"><span>Templates</span></div>
      <button class="rail-lib hv-step" data-act="open-library" title="Browse, use and manage templates (T)"
        >${ICON.templates}<span class="grow">Templates library</span><kbd>T</kbd></button>
      ${current}
    </div>`;
}
