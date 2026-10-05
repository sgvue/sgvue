// Renders a ScheduleResult as one HTML string, written to the DOM in a single innerHTML.
// Rows carry `content-visibility: auto` (schedule.css), as in ifcTable — but measured on
// 2026-09-25 it does not window a table: a row is an internal table box, which ignores the
// containment it needs, so all drawn rows (up to RENDER_CAP) are laid out on every paint.
//
// Ported from ifcTable's `ui/tableView.ts` (phase 1 took the rows; phase 2, 2026-09-25, the
// rest: the Format tab's editing mark, the column-selection mark, the "0 values" badge and the
// preview notices). What SGVue adds: every data row carries `data-row` — its index in
// `ScheduleResult.rows` — so a click can name the elements behind it; the row holding the
// element last clicked is marked `on` (it follows the element, not the position, through every
// re-sort and regroup); and the SGVue hover class `hv-step`. Group, footer, blank and grand
// rows carry no `data-row`: they select nothing.
//
// Phase 3 (2026-09-25): every data row carrying a SELECTED element is marked `on` — the
// selection is the main window's too, both ways — and while the 3D view is coloured by one of
// this table's columns, each of that column's cells starts with its colour's swatch and the
// heading says it is the source.

import { headingOf, type Column } from '../../schedule/schedule/def';
import { firingRule, litTarget } from '../../schedule/schedule/conditional';
import { fontStack } from '../../schedule/schedule/fonts';
import type { RenderRow, ScheduleResult } from '../../schedule/schedule/engine';
import { RENDER_CAP } from '../../schedule/schedule/engine';
import type { AppState } from './state';
import { populated, type Coverage } from './coverage';
import { esc } from './dom';
// Straight from the leaf, not through ./panels: the barrel re-exports formatSection, which
// imports cellStyle from here, and that round trip would be a cycle.
import { fieldKey, selectedIndex } from './panels/shared';
import { colourKey } from '../../schedule/colour';

/**
 * Where a column's contents sit — the author's choice when they made one, and only then the
 * Revit-style default of right for anything numeric.
 *
 * The order matters and used to be wrong. `left` fell through the two early returns into the
 * default, so choosing it did nothing at all on any column carrying a total or a decimal
 * count: the panel said left and the table stayed right, with no way to tell why.
 */
export function alignOf(col: Column): 'left' | 'center' | 'right' {
  if (col.align) return col.align;
  return col.total || col.format?.decimals !== undefined ? 'right' : 'left';
}

/** One place that turns an alignment into a class, so headers and cells cannot disagree. */
const ALIGN_CLASS: Record<'left' | 'center' | 'right', string> = { left: '', center: 'ctr', right: 'num' };

function alignClass(col: Column): string {
  const cls = ALIGN_CLASS[alignOf(col)];
  return cls ? ` class="${cls}"` : '';
}

/**
 * What the rule that claims this cell paints on it — the style attribute, or ''.
 *
 * WHICH rule claims it is `firingRule`'s decision, not this one's: the engine counts and
 * narrows by the same call, so a cell the panel says is coloured is the cell the table
 * colours. A claiming rule with every colour cleared paints nothing and still claims — it
 * is the first match that wins, not the first match that happens to be visible.
 */
export function cellStyle(col: Column, text: string): string {
  const k = firingRule(col, text);
  if (k < 0) return '';
  const r = col.conditional![k];
  const bits = [
    r.bg ? `background:${esc(r.bg)}` : '',
    r.fg ? `color:${esc(r.fg)}` : '',
    r.bold ? 'font-weight:700' : '',
  ].filter(Boolean);
  return bits.length ? ` style="${bits.join(';')}"` : '';
}

/** The colour-by source on screen: its visible column, and each value's colour. */
interface Swatches { col: number; map: ReadonlyMap<string, string> }

/** The legend's own square, at the row's scale. The colour is a validated `SCHEME` hex. */
const swatch = (color: string | undefined) =>
  color ? `<span class="sw" style="background:${esc(color)}"></span>` : '';

function renderRow(
  row: RenderRow, index: number, cols: Column[], count: boolean,
  selected: ReadonlySet<number>, sw: Swatches | null,
): string {
  const span = cols.length + (count ? 1 : 0);
  const tail = (n: number) => (count ? `<td class="num">${n.toLocaleString()}</td>` : '');
  switch (row.kind) {
    case 'group':
      return `<tr class="group level-${row.level}"><td colspan="${span}">${esc(row.label)}`
        + ` <span class="count">· ${row.count.toLocaleString()}</span></td></tr>`;
    case 'blank':
      return `<tr class="blank"><td colspan="${span}"></td></tr>`;
    case 'footer':
    case 'grand': {
      const cls = row.kind === 'grand' ? 'grand' : `footer level-${row.level}`;
      const cells = cols.map((c, i) => {
        const v = row.cells[i];
        // The label sits in the first column that has no total of its own.
        if (i === 0 && v === null) return `<td>${esc(row.label)}</td>`;
        return `<td${alignClass(c)}>${esc(v ?? '')}</td>`;
      });
      return `<tr class="${cls}">${cells.join('')}${tail(row.count)}</tr>`;
    }
    case 'data': {
      const cells = cols.map((c, i) => {
        const text = row.cells[i];
        const mark = sw && sw.col === i && text ? swatch(sw.map.get(colourKey(text))) : '';
        return `<td${alignClass(c)}${cellStyle(c, text)}>${mark}${esc(text)}</td>`;
      });
      const on = selected.size > 0 && row.rows.some((r) => selected.has(r));
      return `<tr class="data hv-step${on ? ' on' : ''}" data-row="${index}">`
        + `${cells.join('')}${tail(row.count)}</tr>`;
    }
  }
}

/**
 * Column widths, in both directions.
 *
 * A `width` on the `<th>` alone was only ever a REQUEST, and under `table-layout: auto` it
 * lost both ways. Narrower did nothing, because every td still contributes its full nowrap
 * text width; wider did nothing either once the table had no slack left, because a
 * preferred width is only granted out of free space. All three declarations are needed, and
 * on the cells rather than just the heading: `max-width` clamps the contribution, `min-width`
 * raises it, and together they make the number exact in both directions. Growing past the
 * pane is what `.table-wrap`'s scrollport is for.
 *
 * One rule per rendered column, pointing at a custom property named for where the column
 * sits in def.columns — so a resize is one variable written on the table element, with no
 * repaint and no rule to keep in step. Positions are rendered ones; the Count column has no
 * def slot and sits after these, so it needs no offset and stays auto.
 *
 * `:not([colspan])` keeps the group and blank rows out of it: their single spanning td is
 * nth-child(1), and it would otherwise be squeezed to the first column's width.
 *
 * Wrapping rides on the same rules, and only on the columns that have a width. Giving a
 * column a width is a decision to make it narrower than its content might be, and this app
 * never silently cuts a value — so those columns wrap. A column with no width sits at its
 * natural width, where there is nothing to wrap, and keeps the one-line ellipsis a dense
 * Revit schedule is made of. `overflow-wrap: anywhere` is half the rule, not a flourish:
 * `white-space: normal` alone only breaks at a space, so a 44-character asset tag in a
 * 120px column would still be clipped by the `overflow: hidden` the cells carry.
 */
function widthRules(defIndex: number[], columns: Column[]): string {
  return defIndex.map((d, i) =>
    `table.schedule th:nth-child(${i + 1}),table.schedule td:not([colspan]):nth-child(${i + 1})`
    + `{width:var(--colw-${d},auto);min-width:var(--colw-${d},auto);max-width:var(--colw-${d},none)`
    + `${columns[d]?.width ? ';white-space:normal;overflow-wrap:anywhere' : ''}}`).join('');
}

/**
 * Which column the Format tab is editing, marked in the table while that tab is showing.
 *
 * "Editing column" names a column the eye then has to find, and it names one even when
 * nothing was picked — the panel falls back to column 0, so the table has to say so too or
 * the first edit lands somewhere the user was not looking. `selectedIndex` is that same
 * fallback, asked once here rather than re-derived.
 *
 * The heading gets exactly what a Shift-selected one gets: "this column is being acted on"
 * must not read as two different things. The cells get a tint painted as an inset shadow
 * rather than a background, because zebra and row-hover both set a background and both
 * out-specify a positional rule — a shadow paints over whatever the background turns out
 * to be. `:not([colspan])` keeps the group and blank rows out, exactly as widthRules does.
 *
 * `@media screen` because this is UI chrome, not content: the width rules are unscoped on
 * purpose (a printout keeps the widths it was given), but nothing should print because a
 * panel happened to be open.
 */
function editingRule(state: AppState, defIndex: number[]): string {
  if (state.open !== 'format' || !state.inspectorOpen) return '';
  const n = defIndex.indexOf(selectedIndex(state)) + 1;
  // 0 covers both "no columns" and "the edited column is hidden" — nothing to mark.
  if (!n) return '';
  return `@media screen{table.schedule thead th:nth-child(${n})`
    + '{background:var(--sel-bg);color:var(--sel-ink);box-shadow:inset 0 -3px 0 var(--accent)}'
    + `table.schedule td:not([colspan]):nth-child(${n})`
    + '{box-shadow:inset 0 0 0 9999px var(--col-tint)}}';
}

export function renderSchedule(state: AppState, res: ScheduleResult, cov: Coverage): string {
  const def = state.def;
  const a = def.appearance ?? {};

  // Telling someone to pick from a list that is empty is a dead end, and that is exactly
  // what a file with nothing schedulable in it used to do.
  if (!def.entity.length) {
    return state.store && !state.store.entities.length
      ? `<div class="empty-note">The open models hold nothing this window can tabulate —
         no walls, doors, spaces or other building elements.</div>`
      : '<div class="empty-note">Pick a category in the left rail to start a schedule.</div>';
  }
  if (!res.columns.length) return '<div class="empty-note">No fields yet. Add some from the inspector.</div>';

  // Map visible column index back to its index in def.columns, so a header click opens
  // the right column in Column formatting and the badge lands on the right heading.
  const defIndex: number[] = [];
  def.columns.forEach((c, i) => { if (!c.hidden) defIndex.push(i); });

  // The column the 3D view is coloured by, when this window asked for it and it is on screen.
  const { key, map } = state.colours;
  const colourCol = key ? res.columns.findIndex((c) => fieldKey(c.field) === key) : -1;
  const sw: Swatches | null = colourCol >= 0 ? { col: colourCol, map } : null;
  const firstColours = [...new Set(map.values())].slice(0, 3);
  const sourceMark = firstColours.length
    ? `<span class="hd-sw" title="The 3D view is coloured by this column. Right-click the heading to clear it."`
      + ` style="background:linear-gradient(90deg,${firstColours.map((c, i) =>
        `${esc(c)} ${(i * 100 / firstColours.length).toFixed(1)}% ${((i + 1) * 100 / firstColours.length).toFixed(1)}%`).join(',')})"></span>`
    : '';

  const head = res.columns.map((c, i) => {
    const vertical = c.headingOrientation === 'vertical' ? 'vertical' : '';
    const badge = populated(cov, c.field) === 0
      ? ` <span class="badge" title="No element in this category carries this property. Fields &rsaquo; the column offers a remap.">0 values</span>`
      : '';
    // The heading follows its column. It used to honour `center` only, so a right-aligned
    // column of numbers sat under a left-aligned heading.
    // `sel` marks a selected column. A grip is otherwise solo, so this is the ONLY thing
    // that makes a drag or a double-click move more than the column it grabbed.
    const cls = [vertical, ALIGN_CLASS[alignOf(c)],
      state.selectedCols.includes(defIndex[i]) ? 'sel' : '',
      i === colourCol ? 'colour-src' : ''].filter(Boolean).join(' ');
    // NOT data-i. A header's position in its own list is its VISIBLE index; what the
    // formatting panel needs is where that column sits in def.columns, which differs as
    // soon as any column is hidden. Different question, different name.
    // tabindex: a heading is the keyboard's way to its menu (ContextMenu key / Shift+F10), and
    // since phase 4 Enter / Space is its click (events.ts) — both named in the title.
    return `<th${cls ? ` class="${cls}"` : ''} data-defcol="${defIndex[i]}" tabindex="0"
      title="Click to format this column, or drag its right edge to resize. Shift+click to select the columns in between, Ctrl+click to add or remove one, then drag or double-click a grip to size them together. Right-click to colour the 3D view by it. Keys: Enter or Space for a click (with Shift or Ctrl as above); Shift+F10 or the menu key for the right-click menu.">${i === colourCol ? sourceMark : ''}${esc(res.headings[i])}${badge}</th>`;
  }).join('')
    + (res.countColumn ? '<th class="num" title="How many elements this row stands for">Count</th>' : '');

  const body = res.rows.map((r, i) =>
    renderRow(r, i, res.columns, res.countColumn, state.selected, sw)).join('');

  const classes = ['schedule',
    a.gridLines !== false ? 'grid' : '',
    a.zebra !== false ? 'zebra' : '',
    a.headerBold === false ? 'nobold' : ''].filter(Boolean).join(' ');
  const style = [
    a.fontSize ? `font-size:${esc(a.fontSize)}px` : '',
    a.bodyFont ? `font-family:${fontStack(a.bodyFont)}` : '',
    // The committed widths, as the variables widthRules() reads. Inline because they are
    // computed, and on the table because that is the one element a drag can write to
    // without a repaint.
    ...def.columns.map((c, i) => (c.width ? `--colw-${i}:${esc(c.width)}px` : '')),
  ].filter(Boolean).join(';');

  const title = a.showTitle === false ? ''
    : `<h2 class="schedule-title">${esc(a.title?.trim() || def.name)}</h2>`;

  const blankFirst = a.blankRowBeforeData
    ? `<tr class="blank"><td colspan="${res.columns.length + (res.countColumn ? 1 : 0)}"></td></tr>` : '';

  return `${title}${notices(state, res)}
    <style>${widthRules(defIndex, def.columns)}${editingRule(state, defIndex)}</style>
    <div class="table-wrap${a.outline === false ? ' no-outline' : ''}">
      <table class="${classes}"${style ? ` style="${style}"` : ''}>
        <thead><tr>${head}</tr></thead>
        <tbody>${blankFirst}${body}</tbody>
      </table>
    </div>`;
}

/** The two things that make the table lie if left unsaid: a preview, and a truncated list. */
function notices(state: AppState, res: ScheduleResult): string {
  const out: string[] = [];

  if (state.removedBy !== null && state.def.filters[state.removedBy]) {
    out.push(`<div class="notice">
      <span class="grow">Showing the ${res.matchedElements.toLocaleString()} element${res.matchedElements === 1 ? '' : 's'} that filter rule ${state.removedBy + 1} removes. Every other rule still applies.</span>
      <button class="btn" data-act="clear-removed">Back to schedule</button>
    </div>`);
  }

  // The colour preview, said the same way. litTarget is the same validator the engine used
  // to decide whether to narrow at all, so the notice cannot appear over an un-narrowed
  // table or stay silent over a narrowed one.
  const lit = litTarget(state.def, state.litBy);
  if (lit) {
    out.push(`<div class="notice">
      <span class="grow">Showing the ${res.totalDataRows.toLocaleString()} row${res.totalDataRows === 1 ? '' : 's'} that rule ${state.litBy!.rule + 1} of ‘${esc(headingOf(lit.col, state.def))}’ colours. Every filter still applies.</span>
      <button class="btn" data-act="clear-lit">Back to schedule</button>
    </div>`);
  }

  if (res.truncated) {
    out.push(`<div class="notice"><span class="grow">Showing the first ${Math.min(res.totalDataRows, RENDER_CAP).toLocaleString()}
      of ${res.totalDataRows.toLocaleString()} rows. Narrow the filters to see the rest — a printout always contains every row.</span></div>`);
  }
  return out.join('');
}
