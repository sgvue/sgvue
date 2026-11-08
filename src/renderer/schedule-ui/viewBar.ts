// The view bar: under the schedule's name, what the schedule is doing, as chips. Filters
// read as sentences with what each removes; sort and group levels follow; on the right,
// how rows are shown and the table's style. Each chip opens its popover (ui/popover.ts,
// bodies in ui/viewPopovers.ts); nothing here edits anything itself.
//
// Which chip is open, and which column a filter or sort chip points at, is transient UI —
// read from the popover's id, never AppState. The column mark is a static class set in
// place after each paint (no animation: the heading is rebuilt by every render).
//
// Ported from ifcTable's `ui/viewBar.ts` (Yong Yen, 2026-11-05) for SGVue v1.5.0, phase 2:
// chips, sentences, "−N removed" and caps as written there, drawn as the main window's pills
// (`--sel-bg` filter chips with an accent edge, the Filter card's dashed AND / OR join with its
// `hv-accent-sel`, `hv-step` under the pointer, the × `hv-warn-both`). In SGVue the bar sits
// at the top of the centre column (`#centre-head`), under the header.

import type { ModelStore } from '../../schedule/ifc/store';
import { fieldKey } from '../../schedule/schedule/actions';
import { OP_LABELS } from '../../schedule/schedule/compare';
import {
  CORE_KEYS, defaultHeading, headingOf, MAX_FILTERS, MAX_SORT_LEVELS, type FieldRef, type FilterRule, type ScheduleDef,
} from '../../schedule/schedule/def';
import { defaultUnit } from '../../schedule/schedule/format';
import type { AppState } from './state';
import { buildCoverage, populated } from './coverage';
import { esc } from './dom';
import { ICON } from './icons';
import { calcProblems } from './overlays/calcEditor';
import { ruleEffects } from './panels/filterSection';
import { displayNum, kindOf, typeOf } from './panels/shared';
import { onPopoverClose, openPopover, popoverId, togglePopover } from './popover';

export type ChipKind = 'filter' | 'sort' | 'add-filter' | 'add-sort' | 'rows' | 'style' | 'picker';

/** The popover id for a chip — `filter:2`, `rows`. */
export const chipId = (kind: string, i?: number) => (i === undefined ? kind : `${kind}:${i}`);
const anchorOf = (kind: string, i?: number, id?: string) =>
  `[data-act="vb-open"][data-v="${kind}"]${i === undefined ? '' : `[data-i="${i}"]`}${id ? `[data-id="${id}"]` : ''}`;

/** Which chip's popover is open, if one is: its kind and, for a rule or level, its index. */
export function openChip(): { kind: ChipKind; i?: number } | null {
  const id = popoverId();
  const m = id ? /^(filter|sort|add-filter|add-sort|rows|style|picker)(?::(\d+))?$/.exec(id) : null;
  return m ? { kind: m[1] as ChipKind, i: m[2] === undefined ? undefined : Number(m[2]) } : null;
}

let scrollPending = false;

onPopoverClose(() => {
  // Headless (the assistant's requests in the unit tests) there is no heading to unmark.
  if (typeof document === 'undefined') return;
  for (const th of document.querySelectorAll('th.chip-target')) th.classList.remove('chip-target');
});

/** A chip's click: open its popover, or close it if it is the one open. `id` picks one of
 *  two openers of the same popover (the field picker: its chip, or the "+ Column" heading). */
export function toggleChip(kind: string, i?: number, id?: string) {
  togglePopover(chipId(kind, i), anchorOf(kind, i, id));
  scrollPending = true;
}

/** Open a chip's popover from elsewhere (the column menu's Filter by this, a new rule, a
 *  level that moved). `focus` false when it only follows something already being edited. */
export function openChipPopover(kind: string, i?: number, focus = true, id?: string) {
  openPopover(chipId(kind, i), anchorOf(kind, i, id), '', focus);
  scrollPending = true;
}

/** A field as the schedule names it: the column's own heading when it is one, else its default. */
export function fieldLabel(def: ScheduleDef, field: FieldRef): string {
  const key = fieldKey(field);
  const col = def.columns.find((c) => fieldKey(c.field) === key);
  return col ? headingOf(col, def) : defaultHeading(field, def);
}

/** The condition and value of a rule, worded for a chip: `is at most · 1,200 mm`. */
function ruleWords(store: ModelStore, def: ScheduleDef, r: FilterRule): [string, string] {
  const kind = kindOf(store, def, r.field);
  const unit = kind !== 'none' && kind !== 'count' ? ` ${defaultUnit(kind, store.meta.unitSystem)}` : '';
  const num = (v: unknown) => displayNum(v, kind, store.meta.unitSystem);
  if (r.op === 'hasValue' || r.op === 'noValue') return [OP_LABELS[r.op], ''];
  if (r.op === 'between') {
    const lo = num(r.values?.[0]);
    const hi = num(r.values?.[1]);
    if (lo && hi) return ['is between', `${lo} – ${hi}${unit}`];
    if (hi) return ['is at most', `${hi}${unit}`];
    if (lo) return ['is at least', `${lo}${unit}`];
    return ['is between', 'any'];
  }
  if (r.op === 'in') return [OP_LABELS.in, (r.values ?? []).join(', ')];
  const type = typeOf(store, def, r.field);
  if (type === 'bool') return [OP_LABELS[r.op], String(r.value) === 'true' ? 'Yes' : 'No'];
  if (typeof r.value === 'number') return [OP_LABELS[r.op], `${num(r.value)}${unit}`];
  return [OP_LABELS[r.op], r.value === undefined || r.value === '' ? '…' : `“${r.value}”`];
}

const isGroup = (l: ScheduleDef['sort'][number]) => !!l.header || (l.footer ?? 'none') !== 'none';

export function renderViewBar(state: AppState, store: ModelStore): string {
  const def = state.def;
  const effects = ruleEffects(store, def);
  const logic = def.filterLogic ?? 'and';
  const parts: string[] = [];

  def.filters.forEach((r, i) => {
    // The join between two chips IS the all/any switch: the same act and handler as the
    // popover's All / Any pair, sending the other value.
    if (i > 0) {
      parts.push(`<button class="logic hv-accent-sel" data-act="filter-logic" data-v="${logic === 'and' ? 'or' : 'and'}"
        title="Rows must match ${logic === 'and' ? 'every' : 'any'} rule — click to switch">${logic === 'and' ? 'and' : 'or'}</button>`);
    }
    const [op, value] = ruleWords(store, def, r);
    const removes = effects[i]?.removes ?? 0;
    // Three buttons, as in the prototype: the sentence, what it removes (its own target,
    // opening the same popover — where "show them" is), and remove. data-id tells the
    // second from the first for preserveUi; the popover anchors on the first.
    parts.push(`<span class="vchip filter"><button class="hv-step" data-act="vb-open" data-v="filter" data-i="${i}" aria-haspopup="dialog">
        <span class="k">Only where</span><span class="v">${esc(fieldLabel(def, r.field))}</span><span class="k">${esc(op)}</span>${
  value ? `<span class="v">${esc(value)}</span>` : ''}</button><button class="hv-step" data-act="vb-open" data-v="filter" data-i="${i}" data-id="removed"
        title="Elements this rule removes"><span class="removed">−${removes.toLocaleString()} removed</span></button><button
        class="x icon-btn hv-warn-both" data-act="filter-remove" data-i="${i}" title="Remove this filter" aria-label="Remove this filter">${ICON.remove}</button></span>`);
  });
  const filtersFull = def.filters.length >= MAX_FILTERS;
  // At the cap the add gives way to a plain hint, as in the prototype.
  parts.push(filtersFull ? `<span class="vhint">${MAX_FILTERS} filters max</span>`
    : '<button class="vadd hv-accent-step" data-act="vb-open" data-v="add-filter" aria-haspopup="dialog">+ Filter</button>');
  parts.push('<span class="vsep"></span>');

  def.sort.forEach((l, i) => {
    parts.push(`<span class="vchip"><button class="hv-step" data-act="vb-open" data-v="sort" data-i="${i}" aria-haspopup="dialog">${
      def.sort.length > 1 ? `<span class="lvl-n">${i + 1}</span>` : ''}<span class="k">${isGroup(l) ? 'Grouped by' : 'Sorted by'}</span><span
        class="v">${esc(fieldLabel(def, l.field))}</span><span class="k">${l.dir === 'desc' ? 'Z→A' : 'A→Z'}</span></button><button
        class="x icon-btn hv-warn-both" data-act="sort-remove" data-i="${i}" title="Remove this level" aria-label="Remove this level">${ICON.remove}</button></span>`);
  });
  const sortFull = def.sort.length >= MAX_SORT_LEVELS;
  parts.push(sortFull ? `<span class="vhint">${MAX_SORT_LEVELS} levels max</span>`
    : '<button class="vadd hv-accent-step" data-act="vb-open" data-v="add-sort" aria-haspopup="dialog">+ Sort / group</button>');

  // A calculated column that cannot compute says so here, whatever panel is open.
  const broken = calcProblems(state, store).size;
  if (broken) {
    parts.push(`<span class="vchip alert"><button class="hv-warn" data-act="open-calc">${broken} formula${broken === 1 ? '' : 's'} to fix</button></span>`);
  }
  parts.push('<span class="spacer"></span>');
  // The field picker's chip: how many fields are columns, out of how many the category has.
  const cov = buildCoverage(store, def.entity);
  const fields = CORE_KEYS.length + cov.tallies.size + (def.calculated?.length ?? 0);
  const shown = def.columns.filter((c) => !c.hidden);
  const hidden = def.columns.length - shown.length;
  const empty = shown.filter((c) => c.field.kind !== 'formula' && populated(cov, c.field) === 0).length;
  parts.push(`<button class="vset hv-step" data-act="vb-open" data-v="picker" data-id="chip" aria-haspopup="dialog" title="Add, remove or reorder columns — or press /"><b>${
    shown.length}</b> of ${fields} fields${hidden ? ` · ${hidden} hidden` : ''}${empty ? ` · <span class="warnc">${empty} empty</span>` : ''}</button>`);
  parts.push(`<button class="vset hv-step" data-act="vb-open" data-v="rows" aria-haspopup="dialog">${
    def.itemize ? 'Every instance' : '<b>Combined rows</b>'}${def.grandTotal ? ' · grand total' : ''}</button>`);
  parts.push(`<button class="vset hv-step" data-act="vb-open" data-v="style" aria-haspopup="dialog">Style</button>`);

  return `<div class="viewbar" role="toolbar" aria-label="What this schedule shows">${parts.join('')}</div>`;
}

/**
 * After each paint: mark the column an open filter or sort chip is about, and — on the paint
 * that opened it — scroll that column into view. A field that is not a column marks nothing.
 */
export function afterPaintViewBar(state: AppState) {
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
