// The right-hand inspector: five icon tabs over one panel, collapsible to an icon strip
// and resizable by its left edge (ui/resize.ts owns the drag; the width never enters state).
//
// Tabs replaced the accordion: every section is one click away at a constant position, and
// the count badges keep saying what each tab is doing while it is not the one showing.
// The old per-section summaries survive as tab tooltips.
//
// Ported from ifcTable's `ui/inspector.ts` (2026-09-25, phase 2). SGVue draws it: the glyphs
// are `icons.ts`'s stroke set, the head is the Preferences card's uppercase label over the
// sidebar's mono sub-line, and a tab is a toolbar button — `--sel-bg` / `--sel-ink` when on.

import type { ModelStore } from '../../schedule/ifc/store';
import type { ScheduleResult } from '../../schedule/schedule/engine';
import type { AppState, Section } from './state';
import type { Coverage } from './coverage';
import { esc } from './dom';
import { chevronLeft, chevronRight, TAB_ICONS as ICONS } from './icons';
import {
  appearanceBody, appearanceSummary,
  fieldsAlert, fieldsBody, fieldsSummary,
  filterBody, filterSummary,
  formatBody, formatSummary,
  sortBody, sortSummary,
} from './panels';


interface Def {
  id: Section;
  /** Short, because five of them share the strip. */
  label: string;
  /** PLAIN TEXT — it becomes the tab's title attribute. It carries property names out of
   *  the IFC file and values the user typed, neither of which is trusted. */
  summary: (s: AppState, store: ModelStore, cov: Coverage) => string;
  /** `res` is the schedule this paint is about to draw — main.ts runs it before the panes
   *  so a section can report what the definition it is editing actually did. */
  body: (s: AppState, store: ModelStore, cov: Coverage, res: ScheduleResult) => string;
  /** How many of the thing this tab manages exist — the badge. 0 hides it. */
  count?: (s: AppState) => number;
}

const TABS: Def[] = [
  { id: 'fields', label: 'Fields', summary: fieldsSummary, body: fieldsBody, count: (s) => s.def.columns.length },
  { id: 'filter', label: 'Filter', summary: filterSummary, body: filterBody, count: (s) => s.def.filters.length },
  { id: 'sort', label: 'Sort', summary: sortSummary, body: sortBody, count: (s) => s.def.sort.length },
  { id: 'format', label: 'Format', summary: formatSummary, body: formatBody },
  { id: 'appearance', label: 'Style', summary: appearanceSummary, body: appearanceBody },
];

/** "IfcDoor · 765 elements" — what the schedule is drawing from. The count is the coverage
 *  sweep's own total, which is that same category counted once per repaint. */
function subtitle(state: AppState, cov: Coverage): string {
  const n = cov.total;
  const what = state.def.entity.join(', ') || 'no category';
  return `${what} · ${n.toLocaleString()} element${n === 1 ? '' : 's'}`;
}

export function renderInspector(
  state: AppState, store: ModelStore, cov: Coverage, res: ScheduleResult,
): string {
  // Collapsed: an icon strip. Each icon both picks its tab and reopens the panel, so the
  // way back in is also a destination — one click, not two.
  if (!state.inspectorOpen) {
    const icons = TABS.map((t) => `<button class="icon-btn strip-tab${state.open === t.id ? ' on' : ' hv-step'}"
        data-act="section" data-section="${t.id}"
        title="${esc(t.label)} — ${esc(t.summary(state, store, cov))}" aria-label="${esc(t.label)}">
        ${ICONS[t.id]}
      </button>`).join('');
    return `<div class="inspector-icons">
        <button class="icon-btn hv-step-ink" data-act="panel-toggle" title="Show the setup panel"
          aria-expanded="false" aria-label="Show the setup panel">${chevronLeft()}</button>
        <div class="icons-rule"></div>
        ${icons}
      </div>`;
  }

  const tabs = TABS.map((t) => {
    const on = state.open === t.id;
    const n = t.count?.(state) ?? 0;
    const alert = t.id === 'fields' ? fieldsAlert(state, store, cov) : '';
    return `<button class="tab${on ? '' : ' hv-step'}${on ? ' on' : ''}" role="tab" data-act="section" data-section="${t.id}"
        aria-selected="${on}" title="${esc(t.summary(state, store, cov))}">
        ${ICONS[t.id]}
        <span class="t">${t.label}
          ${n ? `<span class="tab-badge">${n}</span>` : ''}
          ${alert ? `<span class="tab-alert" title="${esc(alert)}"></span>` : ''}
        </span>
      </button>`;
  }).join('');

  const active = TABS.find((t) => t.id === state.open) ?? TABS[0];

  return `<div class="panel-resize" data-act="panel-resize" title="Drag to resize"><i></i></div>
    <div class="inspector-head">
      <div class="grow-1">
        <div class="t">Schedule setup</div>
        <div class="s mono">${esc(subtitle(state, cov))}</div>
      </div>
      <button class="icon-btn small hv-step-ink" data-act="panel-toggle" title="Hide the setup panel"
        aria-expanded="true" aria-label="Hide the setup panel">${chevronRight()}</button>
    </div>
    <div class="inspector-tabs" role="tablist">${tabs}</div>
    <div class="inspector-body" role="tabpanel" aria-label="${esc(active.label)}">${active.body(state, store, cov, res)}</div>`;
}
