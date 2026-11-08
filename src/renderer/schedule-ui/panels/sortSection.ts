// What a sort level's footer can show, and the Rows chip's body: itemise and the grand total.
// (ifcTable's 2026-11-05 version, SGVue v1.5.0 phase 2: the levels themselves are the view
// bar's sort chips, each with its own popover — `viewPopovers.ts`.)

import type { SortLevel } from '../../../schedule/schedule/def';
import type { AppState } from '../state';
import { esc } from '../dom';
import { toggle } from './shared';

export const FOOTER_STYLES: [SortLevel['footer'], string][] = [
  ['titleCountTotals', 'Title, count and totals'],
  ['title', 'Title only'],
  ['count', 'Count only'],
  ['totals', 'Totals only'],
];

/** Itemise and the grand total — the view bar's Rows chip. */
export function rowsBody(state: AppState): string {
  const def = state.def;
  return `${toggle('itemize', 'Itemise every instance', def.itemize, '', 'lead', def.itemize
    ? 'On — every matching element gets its own row.'
    : 'Off — rows identical in every visible column are combined, and a Count column says how many.')}
    ${toggle('grand-total', 'Grand total', !!def.grandTotal, '', 'lead')}
    ${def.grandTotal ? `<input class="full block snug" type="text" data-act="grand-title"
      value="${esc(def.grandTotalTitle ?? '')}" placeholder="Grand total" aria-label="Grand total label" />` : ''}`;
}
