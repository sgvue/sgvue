// The column menu: everything about one column, opened from its heading, drawn into the one
// popover (ui/popover.ts). Every control carries `data-defcol`, and the handlers in events.ts
// read the column off the control, never off which column the menu happens to be showing.
//
// The menu's own view (main or colour rules, More… open) is transient UI like the popover
// itself: module variables, never AppState.
//
// Ported from ifcTable's `ui/columnMenu.ts` (Yong Yen, 2026-11-05) for SGVue v1.5.0, phase 2 —
// structure, acts and copy as written there, drawn in this window's tokens: menu items take
// ContextMenu's item look with `hv-step`, a destructive one `hv-warn-both`, a plain button the
// window's `.btn`. SGVue's heading is its own trigger (it carries the tabindex), so the anchor
// is the `<th>` itself.

import type { ModelStore } from '../../schedule/ifc/store';
import { planComputed } from '../../schedule/schedule/computed';
import { candidateRows } from '../../schedule/schedule/engine';
import { formatCell } from '../../schedule/schedule/format';
import { resolveField } from '../../schedule/schedule/resolve';
import { fieldKey } from '../../schedule/schedule/actions';
import { BOOL_STYLES, headingOf, type Column } from '../../schedule/schedule/def';
import { ANY_PSET } from '../../schedule/schedule/resolve';
import type { ScheduleResult } from '../../schedule/schedule/engine';
import { DECIMALS_MAX, DECIMALS_MIN, defaultDecimals, defaultUnit, unitOptions } from '../../schedule/schedule/format';
import type { AppState } from './state';
import { COL_WIDTH_MAX, COL_WIDTH_MIN } from './colResize';
import { coverBar, fraction, populated, type Coverage } from './coverage';
import { esc, option } from './dom';
import { calcProblems } from './overlays/calcEditor';
import { conditionalRules } from './panels/conditionalRules';
import { remapBlock } from './remap';
import { kindOf, toggle, typeOf } from './panels/shared';
import { openPopover, popoverId, togglePopover } from './popover';
import { alignOf, cellStyle } from './tableView';

const PREFIX = 'col:';
let view: 'main' | 'colour' = 'main';
let more = false;

/** The def.columns index the open menu is about, or null when no column menu is open. */
export function menuColumn(): number | null {
  const id = popoverId();
  return id?.startsWith(PREFIX) ? Number(id.slice(PREFIX.length)) : null;
}

const anchorOf = (i: number) => `#output-pane th[data-defcol="${i}"]`;

/** A heading's click or Enter: open its menu, or close it if it is the one open. */
export function toggleColumnMenu(i: number) {
  if (menuColumn() !== i) { view = 'main'; more = false; }
  togglePopover(PREFIX + i, anchorOf(i), '.table-wrap');
}

/** A hidden column has no heading: its menu opens from the picker's chip, where its row is. */
export function openHiddenColumnMenu(i: number) {
  view = 'main'; more = false;
  openPopover(PREFIX + i, '[data-act="vb-open"][data-v="picker"][data-id="chip"]');
}

/** The column moved (More… → Move left/right): the menu follows it, focus stays put. */
export function followColumn(i: number) {
  openPopover(PREFIX + i, anchorOf(i), '.table-wrap', false);
}

export function setMenuView(v: string) { view = v === 'colour' ? 'colour' : 'main'; }
export function toggleMore() { more = !more; }

/** Rows the preview will look through for an example value before giving up. */
const PREVIEW_SCAN = 200;

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

/** Totals offered by what the column holds — a sum of words is a blank footer cell. */
function totalsFor(type: string, numeric: boolean): [string, string][] {
  if (numeric) return [['', 'None'], ['sum', 'Sum'], ['avg', 'Avg'], ['min', 'Min'], ['max', 'Max'], ['count', 'Count']];
  if (type === 'bool') return [['', 'None'], ['sum', 'Yeses'], ['count', 'Count']];
  return [['', 'None'], ['count', 'Count'], ['countDistinct', 'Distinct']];
}

/** A row of segmented buttons; `at` names the column. */
function seg(act: string, opts: [string, string][], on: string, at: string, label: string): string {
  return `<div class="seg" role="group" aria-label="${esc(label)}">${opts.map(([v, l]) => `<button class="seg-btn${
    v === on ? ' on' : ''}" data-act="${act}" data-v="${esc(v)}"${at} aria-pressed="${v === on}">${esc(l)}</button>`).join('')}</div>`;
}

const rowx = (label: string, body: string) =>
  `<div class="pop-row"><span class="pop-lbl">${esc(label)}</span><div class="grow-1">${body}</div></div>`;

export function renderColumnMenu(
  state: AppState, store: ModelStore, cov: Coverage, res: ScheduleResult,
): string {
  const i = menuColumn();
  const def = state.def;
  const col = i === null ? undefined : def.columns[i];
  if (i === null || !col) return '';
  const at = ` data-defcol="${i}"`;
  const name = headingOf(col, def);
  const type = typeOf(store, def, col.field);

  if (view === 'colour') {
    return `<button class="pop-back hv-step" data-act="cm-view" data-v="main"${at}>← ${esc(name)}</button>
      <div class="eyebrow pop-eyebrow">Colour rules</div>
      ${conditionalRules(state, type, col, i, res)}`;
  }

  const kind = kindOf(store, def, col.field);
  const f = col.format ?? {};
  const units = unitOptions(kind);
  const numeric = type === 'number' || kind !== 'none';
  const dec = f.decimals ?? defaultDecimals(kind);
  const shown = preview(store, state, col);
  const lit = shown === null ? '' : cellStyle(col, shown);
  const key = fieldKey(col.field);
  const lvl = def.sort.findIndex((l) => fieldKey(l.field) === key);
  const level = lvl < 0 ? undefined : def.sort[lvl];
  const grouped = !!level && (!!level.header || (level.footer ?? 'none') !== 'none');
  const unit = f.display || defaultUnit(kind);
  const sample = shown ?? '—';

  // Who carries it, and what to do when nobody does.
  const n = populated(cov, col.field);
  const psetOf = col.field.kind === 'prop' ? (col.field.pset === ANY_PSET ? 'any pset' : col.field.pset) : 'core';
  const problem = col.field.kind === 'formula' ? calcProblems(state, store).get(col.field.id) : undefined;
  const cover = col.field.kind === 'formula'
    ? `<div class="pop-note${problem ? ' bad' : ''}"><span class="grow-1">${problem ? esc(problem) : 'Calculated column'}</span>
        <button class="btn" data-act="open-calc">Edit formula</button></div>`
    : `<div class="pop-cover${n === 0 ? ' none' : n < cov.total ? ' mid' : ''}">${coverBar(fraction(cov, col.field))}
        <b>${n.toLocaleString()} of ${cov.total.toLocaleString()}</b> carry it<span class="pset">${esc(psetOf)}</span></div>
      ${n === 0 ? remapBlock(store, def, cov, i) : ''}`;

  const moreBody = more ? `<div class="pop-more">
      ${rowx('Heading', seg('cm-orient', [['horizontal', 'Horizontal'], ['vertical', 'Vertical']],
    col.headingOrientation === 'vertical' ? 'vertical' : 'horizontal', at, 'Heading direction'))}
      ${rowx('Width', `<span class="row"><input class="pop-num" type="text" inputmode="numeric" data-act="fmt-width"${at}
        value="${esc(col.width ?? '')}" placeholder="auto" aria-label="Column width in pixels" />
        <span class="sub">px · ${COL_WIDTH_MIN}–${COL_WIDTH_MAX}</span></span>`)}
      ${numeric ? toggle('fmt-thousands', 'Thousands separator', f.thousands !== false, at, 'row')
    + toggle('fmt-symbol', 'Unit symbol in each cell', !!f.showSymbol, at, 'row')
    + toggle('fmt-suppress', 'Blank instead of zero', !!f.suppressZero, at, 'row') : ''}
      ${type === 'bool' ? rowx('Yes / No', `<select class="full" data-act="fmt-bool"${at} aria-label="Yes or No style">
        ${BOOL_STYLES.map((s) => option(s, s, (f.boolStyle ?? 'Yes/No') === s)).join('')}</select>`) : ''}
      <div class="mrow"><button class="mi hv-step" data-act="cm-move" data-v="-1"${at}${i === 0 ? ' disabled' : ''}>← Move left</button>
        <button class="mi hv-step" data-act="cm-move" data-v="1"${at}${i === def.columns.length - 1 ? ' disabled' : ''}>Move right →</button></div>
    </div>` : '';

  const hiddenNote = col.hidden
    ? `<div class="pop-note"><span class="grow-1">Hidden — still sorts, groups and filters.</span><button class="btn" data-act="cm-show"${at}>Show</button></div>` : '';
  return `${hiddenNote}<input class="heading-in pop-focus" type="text" data-act="fmt-heading"${at}
      value="${esc(col.heading ?? '')}" placeholder="${esc(name)}" aria-label="Heading shown in the table" />
    ${cover}
    ${units.length > 1 ? rowx('Unit', seg('cm-unit', units.map((u) => [u, u]), unit, at, 'Unit')) : ''}
    ${numeric ? rowx('Decimals', `<span class="row"><span class="stepper">
        <button data-act="cm-dec" data-v="-1"${at} aria-label="Fewer decimals"${dec <= DECIMALS_MIN ? ' disabled' : ''}>−</button>
        <input class="pop-num" type="text" inputmode="numeric" data-act="fmt-decimals"${at} value="${dec}"
          aria-label="Decimals, ${DECIMALS_MIN} to ${DECIMALS_MAX}" />
        <button data-act="cm-dec" data-v="1"${at} aria-label="More decimals"${dec >= DECIMALS_MAX ? ' disabled' : ''}>+</button>
      </span><span class="preview-box pop-preview grow-1${lit ? ' lit' : ''}"${lit}><span class="mono value">${esc(sample)}</span>${
  unit && !f.showSymbol && shown !== null ? `<span class="sub">${esc(unit)}</span>` : ''}</span></span>`) : ''}
    ${rowx('Total', seg('cm-total', totalsFor(type, numeric), col.total ?? '', at, 'Total at footers'))}
    ${rowx('Align', seg('fmt-align', [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']], alignOf(col), at, 'Alignment'))}
    <hr class="pop-rule" />
    <div class="mrow">
      <button class="mi hv-step${level?.dir === 'asc' ? ' on' : ''}" data-act="cm-sort" data-v="asc"${at}>Sort A→Z</button>
      <button class="mi hv-step${level?.dir === 'desc' ? ' on' : ''}" data-act="cm-sort" data-v="desc"${at}>Sort Z→A</button>
    </div>
    <button class="mi hv-step${grouped ? ' on' : ''}" data-act="cm-group"${at}>${grouped ? 'Grouped by this — ungroup' : 'Group by this'}</button>
    <button class="mi hv-step" data-act="cm-filter"${at}>Filter by this…</button>
    <button class="mi hv-step" data-act="cm-view" data-v="colour"${at}>Colour rules<span class="tail">${col.conditional?.length || ''}</span></button>
    <button class="fold hv-step${more ? '' : ' shut'}" data-act="cm-more"${at} aria-expanded="${more}"><span class="tw">▾</span>More…</button>
    ${moreBody}
    <hr class="pop-rule" />
    <div class="mrow">
      ${col.hidden ? `<button class="mi hv-step" data-act="cm-show"${at}>Show column</button>`
    : `<button class="mi hv-step" data-act="cm-hide"${at} title="Keeps it for sorting, grouping and filtering">Hide column</button>`}
      <button class="mi danger hv-warn-both" data-act="col-remove" data-i="${i}">Remove column</button>
    </div>`;
}
