// The view bar: under the schedule's name, what the schedule is doing, on ONE line. Each chip
// opens its popover (popover.ts, bodies in viewPopovers.ts); the one-click switches (ALL / ANY,
// a sort level's direction and grouping, Σ, grid lines, stripes) run their existing acts.
//
// Which chip is open, and which column a filter or sort chip points at, is transient UI —
// read from the popover's id, never AppState. The column mark is a static class set in
// place after each paint (no animation: the heading is rebuilt by every render).
//
// Ported from ifcTable's `ui/viewBar.ts` (Yong Yen, 2026-11-05) for SGVue v1.5.0, phase 2, and
// made one line on 2026-11-25 (owner-approved from `prototype/schedule-bar/`): a funnel and the
// kept count, the ALL / ANY pill once there are two filters, at most three short filter chips
// (`Width ≥ 900 mm`) with the rest folded into `+N`, sort chips of name · direction · group,
// and icon switches on the right. The bar never wraps and never runs off: after each paint and
// on a resize `refoldViewBar` measures it and folds filter chips, then sort levels, into their
// `+N` chips until it fits (`fitBar`). Every control's words are its `data-tip` (the design's
// fast tooltip) and `aria-label`, never a `title`.

import type { ModelStore } from '../../schedule/ifc/store';
import { fieldKey } from '../../schedule/schedule/actions';
import { OP_LABELS } from '../../schedule/schedule/compare';
import {
  CORE_KEYS, defaultHeading, headingOf, MAX_FILTERS, MAX_SORT_LEVELS,
  type FieldRef, type FilterRule, type Op, type ScheduleDef, type SortLevel,
} from '../../schedule/schedule/def';
import { defaultUnit } from '../../schedule/schedule/format';
import type { AppState } from './state';
import { buildCoverage, populated } from './coverage';
import { esc } from './dom';
import { ICON } from './icons';
import { calcProblems } from './overlays/calcEditor';
import { keptCount, ruleEffects } from './panels/filterSection';
import { displayNum, kindOf, typeOf } from './panels/shared';
import { onPopoverClose, openPopover, popoverId, togglePopover } from './popover';

export type ChipKind = 'filter' | 'fold' | 'sort' | 'sfold' | 'add-filter' | 'add-sort' | 'rows' | 'style' | 'picker';

/** The popover id for a chip — `filter:2`, `rows`. */
export const chipId = (kind: string, i?: number) => (i === undefined ? kind : `${kind}:${i}`);
/** The `+N` chip a folded filter rule or sort level is in. */
const FOLD_OF: Record<string, string> = { filter: 'fold', sort: 'sfold' };
/**
 * What a chip's popover hangs from. A filter rule's or a sort level's is its own chip — or,
 * while it is folded, its `+N` chip: the selector list finds the chip first when it is drawn
 * (it comes before its `+N` in the bar), else the `+N`. Looked up afresh after every paint and
 * every refold.
 */
const anchorOf = (kind: string, i?: number, id?: string) => (FOLD_OF[kind]
  ? `#centre-head [data-act="vb-open"][data-v="${kind}"][data-i="${i}"], #centre-head [data-act="vb-open"][data-v="${FOLD_OF[kind]}"]`
  : `[data-act="vb-open"][data-v="${kind}"]${i === undefined ? '' : `[data-i="${i}"]`}${id ? `[data-id="${id}"]` : ''}`);

/** Which chip's popover is open, if one is: its kind and, for a rule or level, its index. */
export function openChip(): { kind: ChipKind; i?: number } | null {
  const id = popoverId();
  const m = id ? /^(filter|fold|sort|sfold|add-filter|add-sort|rows|style|picker)(?::(\d+))?$/.exec(id) : null;
  return m ? { kind: m[1] as ChipKind, i: m[2] === undefined ? undefined : Number(m[2]) } : null;
}

let scrollPending = false;
/** A chip popover's More… (a sort level's, Style's): open or shut, transient like the popover. */
let more = false;
export const chipMore = () => more;
export const toggleChipMore = () => { more = !more; };

onPopoverClose(() => {
  // Headless (the assistant's requests in the unit tests) there is no heading to unmark.
  if (typeof document === 'undefined') return;
  for (const th of document.querySelectorAll('th.chip-target')) th.classList.remove('chip-target');
});

/** A chip's click: open its popover, or close it if it is the one open. `id` picks one of
 *  two openers of the same popover (the field picker: its chip, or the "+ Column" heading). */
export function toggleChip(kind: string, i?: number, id?: string) {
  if (popoverId() !== chipId(kind, i)) more = false;
  togglePopover(chipId(kind, i), anchorOf(kind, i, id));
  scrollPending = true;
}

/** Open a chip's popover from elsewhere (the column menu's Filter by this, a new rule, a
 *  level that moved). `focus` false when it only follows something already being edited. */
export function openChipPopover(kind: string, i?: number, focus = true, id?: string) {
  // A fresh one opens shut; one that only follows a moved level keeps its More… as it was.
  if (focus) more = false;
  openPopover(chipId(kind, i), anchorOf(kind, i, id), '', focus);
  scrollPending = true;
}

/** A field as the schedule names it: the column's own heading when it is one, else its default. */
export function fieldLabel(def: ScheduleDef, field: FieldRef): string {
  const key = fieldKey(field);
  const col = def.columns.find((c) => fieldKey(c.field) === key);
  return col ? headingOf(col, def) : defaultHeading(field, def);
}

/** The sort levels as the schedule names them — what a row stands for when combined by sort. */
export const sortLabels = (def: ScheduleDef): string[] => def.sort.map((l) => fieldLabel(def, l.field));

/** How rows show, in plain words, and its glyph: every element, merged, or one per sort value. */
function rowsMode(def: ScheduleDef): [string, string] {
  if (def.itemize) return ['every element', ICON.rowsEvery];
  if (def.combine !== 'sort') return ['identical rows merged', ICON.rowsMerge];
  const labels = sortLabels(def);
  return [labels.length ? `one row per ${labels.join(' + ')}` : 'one row', ICON.rowsGroup];
}

/** A chip's condition: a symbol for a comparison, short words for the rest. */
const OP_SHORT: Record<Op, string> = {
  '=': '=', '!=': '≠', '>': '>', '>=': '≥', '<': '<', '<=': '≤',
  contains: 'contains', startsWith: 'starts with', endsWith: 'ends with',
  hasValue: 'has value', noValue: 'no value', in: 'any of', between: 'between',
};
/** The conditions whose value is a piece of the text, so it is quoted. */
const PIECE: Op[] = ['contains', 'startsWith', 'endsWith'];

/**
 * The condition and value of a rule, in the chip's short words (`≥` · `900 mm`) or in the
 * full sentence (`is greater than or equal to` · `900 mm`) its tooltip reads.
 */
function ruleWords(store: ModelStore, def: ScheduleDef, r: FilterRule, short: boolean): [string, string] {
  const kind = kindOf(store, def, r.field);
  const unit = kind !== 'none' && kind !== 'count' ? ` ${defaultUnit(kind, store.meta.unitSystem)}` : '';
  const num = (v: unknown) => displayNum(v, kind, store.meta.unitSystem);
  const op = (short ? OP_SHORT : OP_LABELS)[r.op];
  if (r.op === 'hasValue' || r.op === 'noValue') return [op, ''];
  if (r.op === 'between') {
    const lo = num(r.values?.[0]);
    const hi = num(r.values?.[1]);
    const is = short ? '' : 'is ';
    if (lo && hi) return [`${is}between`, `${lo} – ${hi}${unit}`];
    if (hi) return [`${is}at most`, `${hi}${unit}`];
    if (lo) return [`${is}at least`, `${lo}${unit}`];
    return [`${is}between`, 'any'];
  }
  if (r.op === 'in') {
    const list = (r.values ?? []).join(', ');
    return [op, short && !list ? '…' : list];
  }
  if (typeOf(store, def, r.field) === 'bool') return [op, String(r.value) === 'true' ? 'Yes' : 'No'];
  if (typeof r.value === 'number') return [op, `${num(r.value)}${unit}`];
  if (r.value === undefined || r.value === '') return [op, '…'];
  return [op, !short || PIECE.includes(r.op) ? `“${r.value}”` : String(r.value)];
}

/** A rule in the chip's short words: `Width ≥ 900 mm`, `Fire rating has value`. */
export function shortWords(store: ModelStore, def: ScheduleDef, r: FilterRule): string {
  return [fieldLabel(def, r.field), ...ruleWords(store, def, r, true)].filter(Boolean).join(' ');
}

const isGroup = (l: SortLevel) => !!l.header || (l.footer ?? 'none') !== 'none';
/** Keeps nothing and removes something: every row this rule decides, it takes away. */
const removesAll = (e: { keeps: number; removes: number } | undefined) => !!e && e.keeps === 0 && e.removes > 0;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
/** The design's fast tooltip and the name a screen reader reads, on one control. */
const words = (tip: string, label = tip) => `data-tip="${esc(tip)}" aria-label="${esc(label)}"`;
const on = (lit: boolean) => (lit ? ' on' : '');

/** The most filter chips the bar shows; the rest are in `+N`. */
export const MAX_BAR_CHIPS = 3;
/** How many filter chips and sort chips fit, as the last refold found. */
let fit = { filters: MAX_BAR_CHIPS, sorts: Infinity };
/** How many of `n` rules have a chip of their own; rules from this index on are in `+N`. */
export const shownChips = (n: number) => Math.min(n, fit.filters, MAX_BAR_CHIPS);
/** How many of `n` sort levels have a chip of their own; the rest are in the sort `+N`. */
export const shownSorts = (n: number) => Math.min(n, fit.sorts);
/** A sort level in words: what its chip's tooltip and the sort `+N`'s say. */
const levelWords = (def: ScheduleDef, i: number) =>
  `${i === 0 ? 'Sorted first by' : 'Then sorted by'} ${fieldLabel(def, def.sort[i].field)}`;

function filterChip(store: ModelStore, def: ScheduleDef, r: FilterRule, i: number, e: { keeps: number; removes: number }): string {
  const [op, value] = ruleWords(store, def, r, true);
  const [longOp, longValue] = ruleWords(store, def, r, false);
  const field = fieldLabel(def, r.field);
  const dead = removesAll(e);
  const removes = dead ? `removes every element it decides (${e.removes.toLocaleString()})` : `removes ${plural(e.removes, 'element')}`;
  const tip = `Only where ${field} ${longOp}${longValue ? ` ${longValue}` : ''} · ${removes}. Click to change it`;
  return `<span class="vchip filter${dead ? ' alert' : ''}"><button class="hv-step" data-act="vb-open" data-v="filter" data-i="${i}"
    aria-haspopup="dialog" ${words(tip, `Filter: ${shortWords(store, def, r)}, ${removes}`)}><span class="f">${esc(field)}</span><span
    class="k">${esc(op)}</span>${value ? `<span class="v">${esc(value)}</span>` : ''}</button></span>`;
}

function sortChip(def: ScheduleDef, l: SortLevel, i: number): string {
  const name = fieldLabel(def, l.field);
  const grouped = isGroup(l);
  const asc = l.dir !== 'desc';
  return `<span class="vchip sort"><button class="nm hv-step" data-act="vb-open" data-v="sort" data-i="${i}" aria-haspopup="dialog"
    ${words(`${levelWords(def, i)}. Click to change it`, `Sort level: ${name}`)}>${esc(name)}</button><button
    class="ic hv-step" data-act="sort-dir" data-i="${i}" ${words(asc ? 'A to Z, small to big. Click for Z to A' : 'Z to A, big to small. Click for A to Z',
    `${name}: ${asc ? 'A to Z' : 'Z to A'}. Click to reverse`)}>${asc ? ICON.sortAsc : ICON.sortDesc}</button><button
    class="ic hv-step${on(grouped)}" data-act="sort-group" data-i="${i}" aria-pressed="${grouped}" ${words(grouped
    ? `Grouped: a heading and a footer for each ${name}. Click to stop grouping`
    : `Group by ${name}: a heading and a footer for each one`, `Group by ${name}`)}>${ICON.group}</button></span>`;
}

/** "+ Filter" / "+ Sort / group", which add a filter or a sort level; at the cap it is disabled and says so. */
function plus(kind: 'add-filter' | 'add-sort', full: boolean, tip: string, cap: string): string {
  return `<button class="vplus hv-accent-step" data-act="vb-open" data-v="${kind}" aria-haspopup="dialog"${full ? ' disabled' : ''}
    ${words(full ? cap : tip)}>${kind === 'add-filter' ? '+ Filter' : '+ Sort / group'}</button>`;
}

export function renderViewBar(state: AppState, store: ModelStore): string {
  const def = state.def;
  const effects = ruleEffects(store, def);
  const { kept, total } = keptCount(store, def);
  const n = def.filters.length;
  const parts: string[] = [];

  const count = `${kept.toLocaleString()} of ${total.toLocaleString()} elements pass the filters`;
  parts.push(`<span class="vcount${kept === 0 ? ' zero' : ''}" role="img" ${words(count)}>${ICON.funnel}<span><b>${
    kept.toLocaleString()}</b> of ${total.toLocaleString()}</span></span>`);
  // The one all / any switch, through the act the popover's pair used to send.
  if (n >= 2) {
    const all = (def.filterLogic ?? 'and') === 'and';
    parts.push(`<button class="logic hv-accent-sel" data-act="filter-logic" ${words(all
      ? 'ALL: an element must pass every filter. Click for ANY'
      : 'ANY: an element passing one filter is enough. Click for ALL', all
      ? 'Match all filters. Click to match any filter' : 'Match any filter. Click to match all filters')}>${all ? 'All' : 'Any'}</button>`);
  }
  const shown = shownChips(n);
  for (let i = 0; i < shown; i++) parts.push(filterChip(store, def, def.filters[i], i, effects[i]));
  if (n > shown) {
    // Its tooltip lists what is inside, in the chips' own short words.
    const more = n - shown;
    const dead = effects.slice(shown).some(removesAll);
    const inside = def.filters.slice(shown).map((r) => shortWords(store, def, r)).join(' · ');
    parts.push(`<span class="vchip fold${dead ? ' alert' : ''}"><button class="hv-step" data-act="vb-open" data-v="fold" aria-haspopup="dialog"
      ${words(inside, plural(more, 'more filter'))}>+${more}</button></span>`);
  }
  parts.push(plus('add-filter', n >= MAX_FILTERS, 'Add a filter', `${MAX_FILTERS} filters is the most a schedule holds`));
  parts.push('<span class="vsep" aria-hidden="true"></span>');

  const sorts = shownSorts(def.sort.length);
  def.sort.slice(0, sorts).forEach((l, i) => parts.push(sortChip(def, l, i)));
  if (def.sort.length > sorts) {
    const more = def.sort.length - sorts;
    const inside = def.sort.slice(sorts).map((_, k) => levelWords(def, sorts + k)).join(' · ');
    parts.push(`<span class="vchip sfold"><button class="hv-step" data-act="vb-open" data-v="sfold" aria-haspopup="dialog"
      ${words(inside, plural(more, 'more sort level'))}>+${more}</button></span>`);
  }
  parts.push(plus('add-sort', def.sort.length >= MAX_SORT_LEVELS, 'Add a sort level', `${MAX_SORT_LEVELS} sort levels is the most a schedule holds`));

  // A calculated column that cannot compute says so here, whatever panel is open.
  const broken = calcProblems(state, store).size;
  if (broken) {
    const fix = `${broken} formula${broken === 1 ? '' : 's'} to fix`;
    parts.push(`<span class="vchip alert"><button class="hv-warn" data-act="open-calc" ${words(`${fix}. Click to open the calculated values`, fix)}>${fix}</button></span>`);
  }
  parts.push('<span class="spacer"></span>');

  // Columns: how many are shown; the tooltip says how many fields the category has, how many
  // columns are hidden and how many shown ones are empty.
  const cov = buildCoverage(store, def.entity);
  const fields = CORE_KEYS.length + cov.tallies.size + (def.calculated?.length ?? 0);
  const cols = def.columns.filter((c) => !c.hidden);
  const hidden = def.columns.length - cols.length;
  const empty = cols.filter((c) => c.field.kind !== 'formula' && populated(cov, c.field) === 0).length;
  const colTip = `Columns: ${cols.length} shown of ${fields} fields${hidden ? ` · ${hidden} hidden` : ''}${
    empty ? ` · ${empty} empty` : ''}. Click to add, remove or reorder them — or press /`;
  const [rows, rowsIcon] = rowsMode(def);
  const a = def.appearance ?? {};
  const grid = a.gridLines !== false;
  const zebra = a.zebra !== false;
  const grand = !!def.grandTotal;
  parts.push(`<span class="vright">
    <button class="icon-btn num hv-step${empty ? ' warn' : ''}" data-act="vb-open" data-v="picker" data-id="chip" aria-haspopup="dialog"
      ${words(colTip, `Columns, ${cols.length} shown`)}>${ICON.columns}<span>${cols.length}</span></button>
    <button class="icon-btn hv-step${on(!def.itemize)}" data-act="vb-open" data-v="rows" aria-haspopup="dialog"
      ${words(`Rows: ${rows}. Click to change`, `Rows: ${rows}`)}>${rowsIcon}</button>
    <button class="icon-btn hv-step${on(grand)}" data-act="grand-total" aria-pressed="${grand}"
      ${words(grand ? 'Grand total row is on. Click to hide it' : 'Add a grand total row at the bottom', 'Grand total')}>${ICON.sigma}</button>
    <span class="vsep" aria-hidden="true"></span>
    <button class="icon-btn hv-step${on(grid)}" data-act="app-grid" aria-pressed="${grid}"
      ${words(grid ? 'Grid lines on. Click to hide them' : 'Show grid lines between cells', 'Grid lines')}>${ICON.gridLines}</button>
    <button class="icon-btn hv-step${on(zebra)}" data-act="app-zebra" aria-pressed="${zebra}"
      ${words(zebra ? 'Striped rows on. Click to turn them off' : 'Shade every other row', 'Stripe rows')}>${ICON.stripes}</button>
    <button class="icon-btn hv-step" data-act="vb-open" data-v="style" aria-haspopup="dialog"
      ${words('Style: title, text size, font and more')}>${ICON.brush}</button>
  </span>`);

  return `<div class="viewbar" role="toolbar" aria-label="What this schedule shows">${parts.join('')}</div>`;
}

/** What the bar is made of, in px: each filter chip and each sort chip with the gap after it,
 *  everything else, what each `+N` adds when it is shown (0 when already counted in `rest`),
 *  and the width there is. */
export interface BarWidths {
  filters: number[]; sorts: number[]; rest: number; filterFold: number; sortFold: number; available: number;
}

/**
 * The order things fold in, one step at a time, from everything shown: filter chips from the
 * last down to one, then sort chips down to one, then the last filter chip, then the last sort
 * chip. Each step is [filter chips, sort chips].
 */
function foldSteps(f: number, s: number): [number, number][] {
  const steps: [number, number][] = [[f, s]];
  while (f > 1) steps.push([--f, s]);
  while (s > 1) steps.push([f, --s]);
  if (f > 0) steps.push([f = 0, s]);
  if (s > 0) steps.push([f, s = 0]);
  return steps;
}

/**
 * How many filter chips and sort chips the bar shows so it fits — pure. The first step of
 * `foldSteps` whose width fits; everything folded when none does (the bar then runs past its
 * box rather than wrap).
 */
export function fitBar(w: BarWidths): { filters: number; sorts: number } {
  const sum = (a: number[], n: number) => a.slice(0, n).reduce((t, x) => t + x, 0);
  const width = (f: number, s: number) => w.rest + sum(w.filters, f) + sum(w.sorts, s)
    + (f < w.filters.length ? w.filterFold : 0) + (s < w.sorts.length ? w.sortFold : 0);
  const steps = foldSteps(w.filters.length, w.sorts.length);
  const [filters, sorts] = steps.find(([f, s]) => width(f, s) <= w.available) ?? steps[steps.length - 1];
  return { filters, sorts };
}

/** What a `+N` costs before it is drawn: "+5" in the mono face, its padding and a gap. */
const FOLD_GUESS = 40;

/** The bar as laid out: its chips' widths with their gaps, everything else, and how far it runs over. */
function measure(bar: HTMLElement) {
  const kids = Array.from(bar.children) as HTMLElement[];
  const rect = (e: Element) => e.getBoundingClientRect();
  const spacer = bar.querySelector('.spacer');
  // The items' own extent, not scrollWidth: a tooltip's box overflows too.
  const extent = kids.length ? rect(kids[kids.length - 1]).right - rect(kids[0]).left - (spacer ? rect(spacer).width : 0) : 0;
  const widths = (cls: string) => kids.filter((e) => e.classList.contains('vchip') && e.classList.contains(cls)).map((e) => {
    const r = rect(e);
    const next = e.nextElementSibling;
    return r.width + (next ? rect(next).left - r.right : 0);
  });
  const filters = widths('filter');
  const sorts = widths('sort');
  const sum = (a: number[]) => a.reduce((t, x) => t + x, 0);
  return {
    filters, sorts, rest: extent - sum(filters) - sum(sorts), available: rect(bar).width,
    over: extent - rect(bar).width, fold: kids.some((e) => e.classList.contains('fold')),
  };
}

/**
 * After a paint that drew the bar, and on a resize: fold filter chips and sort levels into their
 * `+N` chips until the bar fits on its line, or show them again when there is room. `paintBar`
 * redraws the bar alone (main.ts: keeping focus, the open popover and its anchor). One redraw
 * with every chip to measure, one with the fit, and one more step at a time if a `+N` turned out
 * wider than guessed.
 */
export function refoldViewBar(state: AppState, paintBar: () => void) {
  if (typeof document === 'undefined') return;
  const find = () => document.querySelector<HTMLElement>('#centre-head .viewbar');
  if (!find()) return;
  fold(state, paintBar, find);
  placeTips(find());
}

/**
 * Hang each control's tooltip toward the side of the window with more room (`.tip-end`: from
 * its right edge), so a tooltip anywhere on the bar — a `+N` listing six rules in the middle of
 * it — stays inside the window.
 */
function placeTips(bar: HTMLElement | null) {
  if (!bar) return;
  for (const el of Array.from(bar.querySelectorAll<HTMLElement>('[data-tip]'))) {
    const r = el.getBoundingClientRect();
    el.classList.toggle('tip-end', r.right > innerWidth - r.left);
  }
}

function fold(state: AppState, paintBar: () => void, find: () => HTMLElement | null) {
  const n = state.def.filters.length;
  const levels = state.def.sort.length;
  const before = [shownChips(n), shownSorts(levels)];
  fit = { filters: MAX_BAR_CHIPS, sorts: Infinity };
  const all = [shownChips(n), shownSorts(levels)];
  if (before[0] !== all[0] || before[1] !== all[1]) paintBar();
  let bar = find();
  if (!bar) return;
  const m = measure(bar);
  if (m.over <= 0) return;
  fit = fitBar({ ...m, filterFold: m.fold ? 0 : FOLD_GUESS, sortFold: FOLD_GUESS });
  paintBar();
  const steps = foldSteps(all[0], all[1]);
  let k = steps.findIndex(([f, s]) => f === fit.filters && s === fit.sorts);
  while (k >= 0 && k < steps.length - 1 && (bar = find()) && measure(bar).over > 0) {
    const [filters, sorts] = steps[++k];
    fit = { filters, sorts };
    paintBar();
  }
}

/** The kept count the last paint drew, so a change can flash. */
let lastKept: number | null = null;

/**
 * After each paint: flash the kept count when it changed; mark the column an open filter or
 * sort chip is about, and — on the paint that opened it — scroll that column into view. A field
 * that is not a column marks nothing.
 */
export function afterPaintViewBar(state: AppState, store: ModelStore) {
  const { kept } = keptCount(store, state.def);
  if (lastKept !== null && kept !== lastKept) document.querySelector('#centre-head .vcount')?.classList.toggle('bump', true);
  lastKept = kept;

  const chip = openChip();
  const scroll = scrollPending;
  scrollPending = false;
  if (!chip || chip.i === undefined || (chip.kind !== 'filter' && chip.kind !== 'sort')) return;
  const def = state.def;
  const field = chip.kind === 'filter' ? def.filters[chip.i]?.field : def.sort[chip.i]?.field;
  if (!field) return;
  const key = fieldKey(field);
  const c = def.columns.findIndex((col) => !col.hidden && fieldKey(col.field) === key);
  const th = c < 0 ? null : document.querySelector<HTMLElement>(`#output-pane th[data-defcol="${c}"]`);
  if (!th) return;
  th.classList.add('chip-target');
  if (scroll) th.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
