// The bodies of the view bar's popovers: a filter rule, the `+N` list of folded rules, a sort
// level, the sort `+N` list of folded levels, the two `+` field lists, Rows and Style.
//
// The controls come from the pieces in panels/ (ruleBody, rowsBody, appearanceBody,
// fieldSelect …) and carry the acts events.ts wires by concern, so each choice has one
// handler and one action behind it.
//
// Ported from ifcTable's `ui/viewPopovers.ts` (Yong Yen, 2026-11-05) for SGVue v1.5.0, phase 2,
// with this window's hover classes on its buttons. Since 2026-11-25 (the one-line bar) the
// all / any pair, the grand total and the grid-lines and stripes switches are on the bar
// itself, so their popover copies are gone.

import type { ModelStore } from '../../schedule/ifc/store';
import type { AppState } from './state';
import type { Coverage } from './coverage';
import { esc, option } from './dom';
import { renderPicker } from './fieldPicker';
import { ICON } from './icons';
import { appearanceBody } from './panels/appearanceSection';
import { ruleBody, ruleEffects } from './panels/filterSection';
import { fieldSelect, toggle } from './panels/shared';
import { FOOTER_STYLES, rowsBody } from './panels/sortSection';
import { fieldLabel, openChip, shortWords, shownChips, shownSorts } from './viewBar';

function filterPop(state: AppState, store: ModelStore, i: number): string {
  const def = state.def;
  if (!def.filters[i]) return '';
  const e = ruleEffects(store, def)[i];
  return `<div class="pop-row"><span class="pop-lbl">Field</span><div class="grow-1">${fieldSelect(state, def.filters[i].field, 'filter-field', i)}</div></div>
    ${ruleBody(state, store, i, e)}
    <hr class="pop-rule" />
    <div class="icon-row end"><button class="icon-btn sm hv-warn-both" data-act="filter-remove" data-i="${i}"
      title="Remove filter" aria-label="Remove filter">${ICON.remove}</button></div>`;
}

/** The rules folded into `+N`: each opens its own editor (anchored on `+N`) or is removed. */
function foldPop(state: AppState, store: ModelStore): string {
  const def = state.def;
  const effects = ruleEffects(store, def);
  const from = shownChips(def.filters.length);
  const rows = def.filters.slice(from).map((r, k) => {
    const i = from + k;
    const e = effects[i];
    const text = shortWords(store, def, r);
    return `<div class="rl"><button class="mi hv-step${e && e.keeps === 0 && e.removes > 0 ? ' alert' : ''}" data-act="vb-open"
      data-v="filter" data-i="${i}" title="Change this filter">${esc(text)}<span class="tail">−${(e?.removes ?? 0).toLocaleString()}</span></button><button
      class="icon-btn sm hv-warn-both" data-act="filter-remove" data-i="${i}" title="Remove this filter"
      aria-label="Remove filter ${esc(text)}">${ICON.remove}</button></div>`;
  });
  return `<div class="eyebrow block-label">More filters</div><div class="rule-list">${rows.join('')}</div>`;
}

/** The sort levels folded into the sort `+N`: each name opens its own popover (anchored on the
 *  `+N`); its direction and group buttons work in one click, as the chip's segments do. */
function sfoldPop(state: AppState): string {
  const def = state.def;
  const from = shownSorts(def.sort.length);
  const rows = def.sort.slice(from).map((l, k) => {
    const i = from + k;
    const name = esc(fieldLabel(def, l.field));
    const asc = l.dir !== 'desc';
    const grouped = !!l.header || (l.footer ?? 'none') !== 'none';
    return `<div class="rl"><button class="mi hv-step" data-act="vb-open" data-v="sort" data-i="${i}"
      title="Change this sort level">${name}</button><button class="icon-btn sm hv-step" data-act="sort-dir" data-i="${i}"
      title="${asc ? 'A to Z. Click for Z to A' : 'Z to A. Click for A to Z'}" aria-label="${name}: ${asc ? 'A to Z' : 'Z to A'}. Click to reverse">${
  asc ? ICON.sortAsc : ICON.sortDesc}</button><button class="icon-btn sm hv-step${grouped ? ' on' : ''}" data-act="sort-group" data-i="${i}"
      aria-pressed="${grouped}" title="${grouped ? 'Grouped. Click to stop grouping' : 'Group by this'}" aria-label="Group by ${name}">${ICON.group}</button></div>`;
  });
  return `<div class="eyebrow block-label">More sort levels</div><div class="rule-list">${rows.join('')}</div>`;
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
    case 'fold': return foldPop(state, store);
    case 'sfold': return sfoldPop(state);
    case 'sort': return sortPop(state, chip.i ?? -1);
    // The field picker, multi-pick for columns and single-pick for a new rule or level.
    case 'picker':
    case 'add-filter':
    case 'add-sort': return renderPicker(store, cov);
    case 'rows': return rowsBody(state);
    case 'style': return appearanceBody(state, 'pop-');
  }
}
