// Sorting & grouping: up to 4 nested levels, each optionally opening a band with a header
// row and closing it with a footer, plus itemise and the grand total.

import { defaultHeading, MAX_SORT_LEVELS, type SortLevel } from '../../../schedule/schedule/def';
import type { AppState } from '../state';
import { esc, option } from '../dom';
import { fieldSelect, toggle } from './shared';
import { cross, grip } from '../icons';

const FOOTER_STYLES: [SortLevel['footer'], string][] = [
  ['titleCountTotals', 'Title, count and totals'],
  ['title', 'Title only'],
  ['count', 'Count only'],
  ['totals', 'Totals only'],
];

export function sortSummary(state: AppState): string {
  const def = state.def;
  const levels = def.sort.length
    ? def.sort.map((l) => defaultHeading(l.field, def)).join(' › ')
    : 'model order';
  return `${levels}${def.itemize ? '' : ' · not itemised'}`;
}

export function sortBody(state: AppState): string {
  const def = state.def;

  const levels = def.sort.map((lvl, i) => {
    const footerOn = !!lvl.footer && lvl.footer !== 'none';
    const at = ` data-i="${i}"`;
    return `<div class="subcard" draggable="true" data-drag="lvl" data-i="${i}">
      <div class="row">
        <span class="handle" tabindex="0" data-act="lvl-handle" data-i="${i}"
          title="Drag to reorder levels, or focus and use the arrow keys"
          aria-label="Reorder sort level ${i + 1}">${grip}</span>
        <span class="lvl-n">${i + 1}</span>
        ${fieldSelect(state, lvl.field, 'sort-field', i)}
        <div class="seg mini" role="group" aria-label="Direction">
          <button class="seg-btn${lvl.dir === 'asc' ? ' on' : ''}" data-act="sort-dir" data-v="asc" data-i="${i}"
            aria-pressed="${lvl.dir === 'asc'}">A→Z</button>
          <button class="seg-btn${lvl.dir === 'desc' ? ' on' : ''}" data-act="sort-dir" data-v="desc" data-i="${i}"
            aria-pressed="${lvl.dir === 'desc'}">Z→A</button>
        </div>
        <button class="x-btn flush hv-warn-both" data-act="sort-remove" data-i="${i}" title="Remove this level">${cross()}</button>
      </div>
      <div class="chips block tight">
        ${toggle('sort-header', 'Header row', !!lvl.header, at)}
        ${toggle('sort-footer', 'Footer', footerOn, at)}
        ${toggle('sort-blank', 'Blank line', !!lvl.blankLine, at)}
      </div>
      ${footerOn ? `<select class="full block snug" data-act="sort-footer-style" data-i="${i}"
        aria-label="What the footer shows">
        ${FOOTER_STYLES.map(([v, l]) => option(String(v), l, (lvl.footer ?? 'none') === v)).join('')}
      </select>` : ''}
    </div>`;
  }).join('');

  const canAdd = def.sort.length < MAX_SORT_LEVELS;
  return `<div class="eyebrow block-label">Sort &amp; group levels</div>
    <div class="stack">${levels || '<div class="sub">No levels — elements appear in model order.</div>'}</div>
    <button class="dashed block snug" data-act="sort-add" ${canAdd ? '' : 'disabled'}>
      ${canAdd ? `+ Add level <span class="dim">(${def.sort.length} of ${MAX_SORT_LEVELS})</span>` : `Maximum ${MAX_SORT_LEVELS} levels`}
    </button>

    <div class="rule-sep"></div>

    ${toggle('itemize', 'Itemise every instance', def.itemize, '', 'lead', def.itemize
    ? 'On — every matching element gets its own row.'
    : 'Off — rows identical in every visible column are combined, and a Count column says how many.')}
    ${toggle('grand-total', 'Grand total', !!def.grandTotal, '', 'lead')}
    ${def.grandTotal ? `<input class="full block snug" type="text" data-act="grand-title"
      value="${esc(def.grandTotalTitle ?? '')}" placeholder="Grand total" aria-label="Grand total label" />` : ''}`;
}
