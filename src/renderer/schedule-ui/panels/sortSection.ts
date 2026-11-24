// What a sort level's footer can show, and the Rows chip's body: itemise, how rows combine and
// the grand total's label (the grand total itself is the view bar's Σ since 2026-11-25).
// (ifcTable's 2026-11-05 version, SGVue v1.5.0 phase 2: the levels themselves are the view
// bar's sort chips, each with its own popover — `viewPopovers.ts`.)

import type { SortLevel } from '../../../schedule/schedule/def';
import type { AppState } from '../state';
import { esc } from '../dom';
import { sortLabels } from '../viewBar';
import { rowx, seg, toggle } from './shared';

export const FOOTER_STYLES: [SortLevel['footer'], string][] = [
  ['titleCountTotals', 'Title, count and totals'],
  ['title', 'Title only'],
  ['count', 'Count only'],
  ['totals', 'Totals only'],
];

/** Itemise off, combined by sort value: what one row stands for (2026-11-24). */
function bySortHint(labels: string[]): string {
  return labels.length
    ? `Off — one row per ${labels.join(' + ')}. A column whose values differ reads <varies>; a column with a total shows the total. A Count column says how many.`
    : 'Off — no sort level, so everything is one row. Add a sort level to split it.';
}

/** Itemise, how itemise off combines, and the grand total's label while it is on — the view
 *  bar's Rows chip. */
export function rowsBody(state: AppState): string {
  const def = state.def;
  const bySort = def.combine === 'sort';
  const hint = def.itemize ? 'On — every matching element gets its own row.'
    : bySort ? bySortHint(sortLabels(def))
      : 'Off — rows identical in every visible column are combined, and a Count column says how many.';
  return `${toggle('itemize', 'Itemise every instance', def.itemize, '', 'lead', hint)}
    ${def.itemize ? '' : rowx('Combine', seg('combine', [['identical', 'Identical rows'], ['sort', 'By sort value']],
    bySort ? 'sort' : 'identical', '', 'How rows combine'))}
    ${def.grandTotal ? `<input class="full block snug" type="text" data-act="grand-title"
      value="${esc(def.grandTotalTitle ?? '')}" placeholder="Grand total" aria-label="Grand total label" />` : ''}`;
}
