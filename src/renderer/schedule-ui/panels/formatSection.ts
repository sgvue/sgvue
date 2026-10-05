// Column formatting: everything about how one column looks, with a live preview of a real
// value from the model so unit, decimals and separators can be judged rather than guessed.

import type { ModelStore } from '../../../schedule/ifc/store';
import { BOOL_STYLES, headingOf, type Column } from '../../../schedule/schedule/def';
import { planComputed } from '../../../schedule/schedule/computed';
import { candidateRows, type ScheduleResult } from '../../../schedule/schedule/engine';
import {
  DECIMALS_MAX, DECIMALS_MIN, defaultDecimals, formatCell, unitOptions,
} from '../../../schedule/schedule/format';
import { resolveField } from '../../../schedule/schedule/resolve';
import type { AppState } from '../state';
import { COL_WIDTH_MAX, COL_WIDTH_MIN } from '../colResize';
import { esc, option } from '../dom';
// The one implementation of "what do the colour rules do to this cell", shared with the
// table so the Preview box cannot disagree with what it is previewing. One-way: tableView
// takes selectedIndex from shared.ts, not from here, so nothing points back.
import { alignOf, cellStyle } from '../tableView';
import { align as alignIcon } from '../icons';
import { conditionalRules } from './conditionalRules';
import { kindOf, selectedIndex, toggle, typeOf } from './shared';

/** Rows the preview will look through for an example value before giving up. */
const PREVIEW_SCAN = 200;

const TOTALS: [string, string][] = [
  ['', 'No total'],
  ['sum', 'Sum'],
  ['count', 'Count'],
  ['countDistinct', 'Count distinct'],
  ['min', 'Minimum'],
  ['max', 'Maximum'],
  ['avg', 'Average'],
];

export function formatSummary(state: AppState): string {
  const i = selectedIndex(state);
  if (i < 0) return 'no columns';
  const col = state.def.columns[i];
  const unit = col.format?.display;
  return `${headingOf(col, state.def)}${unit ? ` · ${unit}` : ''}`;
}

/**
 * A real value from this category, formatted exactly as the table would show it, or `null`
 * when the scan found none.
 *
 * Null rather than the dash itself, because the caller paints the conditional colours onto
 * whatever comes back and a dash is the panel talking, not a cell — colouring it would claim
 * a rule had matched a value that does not exist.
 *
 * WHICH value, when the column has colour rules: the first one a rule FIRES on. Authoring a
 * rule and watching the preview stay uncoloured says nothing about whether the rule works —
 * the first row in the model is rarely the interesting one. The first real value is kept as
 * a fallback and returned when nothing in the scan matches, which is the honest answer: the
 * rule may match no row at all, and the preview must not pretend otherwise. With no rules
 * the first real value is returned immediately, as it always was.
 *
 * A calculated column has no stored value to find — it has to be worked out per row, the
 * same way the table works it out, or every formula ever written previews as a dash. A
 * percentage still does: its denominator is a total over the whole result, and a preview
 * box has no business computing that on every keystroke.
 */
function preview(store: ModelStore, state: AppState, col: Column): string | null {
  const plan = col.field.kind === 'formula' ? planComputed(state.def) : null;
  const lookForLit = !!col.conditional?.length;
  let fallback: string | null | undefined;
  // Capped, because a formula that is blank on every row would otherwise evaluate the whole
  // category looking for one — and this panel repaints on every keystroke while that formula
  // is being typed, which is exactly when a half-written one is blank everywhere. Hunting for
  // a matching value spends no more rows than that: the same cap, one pass.
  for (const r of candidateRows(store, state.def).slice(0, PREVIEW_SCAN)) {
    const cell = resolveField(store, r, col.field, plan?.compute(store, r));
    if (cell === undefined) continue;
    const text = formatCell(cell, col.format) || null;
    if (!lookForLit) return text;
    fallback ??= text;
    if (text && cellStyle(col, text)) return text;
  }
  return fallback ?? null;
}

/**
 * `_cov` is the inspector's coverage, which this tab does not use — it is here because the
 * tab signature is one shape for all five bodies, and `res` after it is not: the colour
 * rules report how many rows each one claims, and only the schedule result knows.
 */
export function formatBody(
  state: AppState, store: ModelStore, _cov: unknown, res: ScheduleResult,
): string {
  const def = state.def;
  const i = selectedIndex(state);
  if (i < 0) return '<div class="sub">No columns yet — add some in Fields.</div>';

  const col = def.columns[i];
  const kind = kindOf(store, def, col.field);
  const f = col.format ?? {};
  const units = unitOptions(kind);
  const type = typeOf(store, def, col.field);
  const numeric = type === 'number' || kind !== 'none';
  /**
   * Sum, min, max and average need numbers. `aggregate()` returns null when a column has
   * none, so offering them on a text column put a choice in front of the user that could
   * only ever produce a blank footer cell — the same complaint as the Yes/No selector.
   * A yes/no column DOES keep them: a boolean counts as 1, so summing it counts the yeses.
   */
  const canTotal = numeric || type === 'bool';
  // Wearing the colour rules, so this one box answers both "what does the value look like"
  // and "does my rule fire on it" — the per-rule swatch chip that used to answer the second
  // was the same question asked twice, in a smaller place. The fill goes on the BOX, not the
  // value: a rule paints a whole table cell, and a swatch the width of one word is a
  // different thing to look at.
  const shown = preview(store, state, col);
  const lit = shown === null ? '' : cellStyle(col, shown);

  // Left / centre / right as the alignment itself, not the word for it.
  const ALIGNS: ['left' | 'center' | 'right', string, string][] = [
    ['left', 'Left', alignIcon(['M3 5h18', 'M3 12h10', 'M3 19h15'])],
    ['center', 'Centre', alignIcon(['M3 5h18', 'M7 12h10', 'M4.5 19h15'])],
    ['right', 'Right', alignIcon(['M3 5h18', 'M11 12h10', 'M6 19h15'])],
  ];
  // What the TABLE does, not just what the column stores: a column with a total and no
  // explicit align is right-aligned on screen, and the control said Left.
  const align = alignOf(col);

  return `<div class="eyebrow block-label">Editing column</div>
    <select class="full picker" data-act="fmt-col" aria-label="Column to format">
      ${def.columns.map((c, n) => option(String(n), `${n + 1} of ${def.columns.length} — ${headingOf(c, def)}`, n === i)).join('')}
    </select>
    <div class="sub hint-under">Or click any column header in the table.</div>

    <div class="block">
      <label class="lbl" for="fmt-heading">Heading shown in the table</label>
      <input id="fmt-heading" class="full" type="text" data-act="fmt-heading"
        value="${esc(col.heading ?? '')}" placeholder="${esc(headingOf(col, def))}" />
    </div>

    <div class="row wide bottom block snug">
      <div class="grow-1">
        <label class="lbl">Heading direction</label>
        <select class="full" data-act="fmt-orient" aria-label="Heading direction">
          ${option('horizontal', 'Horizontal', col.headingOrientation !== 'vertical')}
          ${option('vertical', 'Vertical', col.headingOrientation === 'vertical')}
        </select>
      </div>
      <div class="slot-md">
        <label class="lbl">Width (px)</label>
        <input class="full" type="number" min="${COL_WIDTH_MIN}" max="${COL_WIDTH_MAX}" data-act="fmt-width" aria-label="Column width"
          value="${esc(col.width ?? '')}" placeholder="auto" />
      </div>
    </div>

    ${units.length || numeric ? `<div class="row wide bottom block tight">
      ${units.length ? `<div class="grow-1">
        <label class="lbl">Unit</label>
        <select class="full" data-act="fmt-unit" aria-label="Unit">
          ${units.map((u) => option(u, u, (f.display ?? '') === u)).join('')}
        </select>
      </div>` : ''}
      ${numeric ? `<div class="slot-sm">
        <label class="lbl">Decimals</label>
        <input class="full" type="number" min="${DECIMALS_MIN}" max="${DECIMALS_MAX}" data-act="fmt-decimals" aria-label="Decimals"
          value="${esc(f.decimals ?? defaultDecimals(kind))}" />
      </div>` : ''}
    </div>` : ''}

    <div class="block tight">
      <label class="lbl">Align</label>
      <div class="seg" role="group" aria-label="Alignment">
        ${ALIGNS.map(([v, label, icon]) => `<button class="seg-btn${align === v ? ' on' : ''}"
          data-act="fmt-align" data-v="${v}" title="${label}" aria-label="Align ${label.toLowerCase()}"
          aria-pressed="${align === v}">${icon}</button>`).join('')}
      </div>
    </div>

    <div class="preview-box block tight${lit ? ' lit' : ''}"${lit}>
      <span class="sub">Preview</span>
      <span class="mono value">${esc(shown ?? '—')}</span>
      <span class="tail">live value from the model</span>
    </div>

    <div class="block">
      ${numeric ? toggle('fmt-thousands', 'Thousands separator', f.thousands !== false, '', 'lead')
    + toggle('fmt-symbol', 'Show unit symbol', !!f.showSymbol, '', 'lead') : ''}
      ${toggle('fmt-hidden', 'Hidden column', !!col.hidden, '', 'lead')}
    </div>

    <div class="block">
      <label class="lbl">Total at footers</label>
      <select class="full" data-act="fmt-total" aria-label="Total at footers">
        ${TOTALS.filter(([v]) => canTotal || v === '' || v === 'count' || v === 'countDistinct')
    .map(([v, l]) => option(v, l, (col.total ?? '') === v)).join('')}
      </select>
    </div>

    ${type === 'bool' ? `<div class="block">
      <label class="lbl">Yes / No style</label>
      <select class="full" data-act="fmt-bool" aria-label="Yes or No style">
        ${BOOL_STYLES.map((s) => option(s, s, (f.boolStyle ?? 'Yes/No') === s)).join('')}
      </select>
    </div>` : ''}
    ${numeric ? `<div class="chips block">${toggle('fmt-suppress', 'Blank instead of zero', !!f.suppressZero)}</div>` : ''}
    <div class="eyebrow cond-head">Conditional filter</div>
    ${conditionalRules(state, type, col, i, res)}`;
}
