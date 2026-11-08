// The bodies of the view bar's popovers: a filter rule, a sort level, the "+ Filter" and
// "+ Sort" field lists, Rows and Style.
//
// The controls come from the pieces in panels/ (ruleBody, rowsBody, appearanceBody,
// fieldSelect …) and carry the acts events.ts wires by concern, so each choice has one
// handler and one action behind it.
//
// Ported from ifcTable's `ui/viewPopovers.ts` (Yong Yen, 2026-11-05) for SGVue v1.5.0, phase 2,
// with this window's hover classes on its buttons.

import type { ModelStore } from '../../schedule/ifc/store';
import type { AppState } from './state';
import type { Coverage } from './coverage';
import { option } from './dom';
import { renderPicker } from './fieldPicker';
import { ICON } from './icons';
import { appearanceBody } from './panels/appearanceSection';
import { matchToggle, ruleBody, ruleEffects } from './panels/filterSection';
import { fieldSelect, toggle } from './panels/shared';
import { FOOTER_STYLES, rowsBody } from './panels/sortSection';
import { openChip } from './viewBar';

function filterPop(state: AppState, store: ModelStore, i: number): string {
  const def = state.def;
  if (!def.filters[i]) return '';
  const e = ruleEffects(store, def)[i];
  return `${def.filters.length > 1 ? `${matchToggle(state)}<hr class="pop-rule" />` : ''}
    <div class="pop-row"><span class="pop-lbl">Field</span><div class="grow-1">${fieldSelect(state, def.filters[i].field, 'filter-field', i)}</div></div>
    ${ruleBody(state, store, i, e)}
    <hr class="pop-rule" />
    <div class="icon-row end"><button class="icon-btn sm hv-warn-both" data-act="filter-remove" data-i="${i}"
      title="Remove filter" aria-label="Remove filter">${ICON.remove}</button></div>`;
}

function sortPop(state: AppState, i: number): string {
  const def = state.def;
  const l = def.sort[i];
  if (!l) return '';
  const at = ` data-i="${i}"`;
  const footerOn = !!l.footer && l.footer !== 'none';
  const dir = (v: 'asc' | 'desc', label: string) => `<button class="seg-btn${l.dir === v ? ' on' : ''}"
    data-act="sort-dir" data-v="${v}"${at} aria-pressed="${l.dir === v}">${label}</button>`;
  return `<div class="pop-row"><span class="lvl-n">${i + 1}</span><div class="grow-1">${fieldSelect(state, l.field, 'sort-field', i)}</div></div>
    <div class="pop-row"><span class="pop-lbl">Order</span><div class="seg grow-1" role="group" aria-label="Direction">
      ${dir('asc', 'A→Z · 1→9')}${dir('desc', 'Z→A · 9→1')}</div></div>
    <div class="switch-list">
      ${toggle('sort-header', 'Header row', !!l.header, at, 'row')}
      ${toggle('sort-footer', 'Footer', footerOn, at, 'row')}
      ${footerOn ? `<select class="full pop-sub" data-act="sort-footer-style"${at} aria-label="What the footer shows">
        ${FOOTER_STYLES.map(([v, t]) => option(String(v), t, (l.footer ?? 'none') === v)).join('')}</select>` : ''}
      ${toggle('sort-blank', 'Blank line after each group', !!l.blankLine, at, 'row')}
    </div>
    <hr class="pop-rule" />
    <div class="icon-row">
      <button class="icon-btn sm hv-step" data-act="sort-move" data-v="-1"${at}${i === 0 ? ' disabled' : ''}
        title="Move earlier" aria-label="Move level earlier">${ICON.arrowUp}</button>
      <button class="icon-btn sm hv-step" data-act="sort-move" data-v="1"${at}${i === def.sort.length - 1 ? ' disabled' : ''}
        title="Move later" aria-label="Move level later">${ICON.arrowDown}</button>
      <span class="spacer"></span>
      <button class="icon-btn sm hv-warn-both" data-act="sort-remove"${at}
        title="Remove level" aria-label="Remove level">${ICON.remove}</button>
    </div>`;
}

export function renderViewPopover(state: AppState, store: ModelStore, cov: Coverage): string {
  const chip = openChip();
  if (!chip) return '';
  switch (chip.kind) {
    case 'filter': return filterPop(state, store, chip.i ?? -1);
    case 'sort': return sortPop(state, chip.i ?? -1);
    // The field picker, multi-pick for columns and single-pick for a new rule or level.
    case 'picker':
    case 'add-filter':
    case 'add-sort': return renderPicker(store, cov);
    case 'rows': return rowsBody(state);
    case 'style': return appearanceBody(state, 'pop-');
  }
}
