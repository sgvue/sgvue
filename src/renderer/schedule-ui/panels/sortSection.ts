// What a sort level's footer can show, and the Rows chip's body: how rows show (one choice of
// three since 2026-11-25) and the grand total's label (the grand total itself is the view bar's
// Σ).
// (ifcTable's 2026-11-05 version, SGVue v1.5.0 phase 2: the levels themselves are the view
// bar's sort chips, each with its own popover — `viewPopovers.ts`.)

import type { SortLevel } from '../../../schedule/schedule/def';
import type { AppState } from '../state';
import { esc } from '../dom';
import { sortLabels } from '../viewBar';
import { seg } from './shared';

export const FOOTER_STYLES: [SortLevel['footer'], string][] = [
  ['titleCountTotals', 'Title, count and totals'],
  ['title', 'Title only'],
  ['count', 'Count only'],
  ['totals', 'Totals only'],
];

/** How rows show — one choice of three (2026-11-25): every element, rows identical in every
 *  shown column merged, or one row per value of the sort levels (all of them, the engine's
 *  combine-by-sort). */
export type RowsMode = 'every' | 'merge' | 'sort';
export const rowsModeOf = (def: AppState['def']): RowsMode =>
  (def.itemize ? 'every' : def.combine === 'sort' ? 'sort' : 'merge');

/** One line for the mode chosen. */
function rowsHint(def: AppState['def'], mode: RowsMode): string {
  if (mode === 'every') return 'Every matching element gets its own row.';
  if (mode === 'merge') return 'Rows identical in every shown column become one; a Count column says how many.';
  const labels = sortLabels(def);
  return labels.length
    ? `One row per ${labels.join(' + ')}. A cell that differs reads <varies>; a column with a total shows it. A Count column says how many.`
    : 'No sort level, so everything is one row. Add a sort level to split it.';
}

/** The Rows chip's body: how rows show, and the grand total's label while it is on. */
export function rowsBody(state: AppState): string {
  const def = state.def;
  const mode = rowsModeOf(def);
  return `${seg('rows-mode', [['every', 'Every element'], ['merge', 'Merge identical'], ['sort', 'One row per sort value']],
    mode, '', 'How rows show')}
    <p class="hint rows-hint">${esc(rowsHint(def, mode))}</p>
    ${def.grandTotal ? `<input class="full block snug" type="text" data-act="grand-title"
      value="${esc(def.grandTotalTitle ?? '')}" placeholder="Grand total" aria-label="Grand total label" />` : ''}`;
}
