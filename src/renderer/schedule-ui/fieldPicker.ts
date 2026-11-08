// The field picker, drawn into the one popover: search first, then the fields as one-line
// rows — a tick, the name, a source tag only when two fields share a name, coverage only when
// it is short of 100% — and under them the detail strip (pickerStrip.ts) for one field.
//
// Two modes over one component. MULTI ("picker"): tick several, they collect in a basket,
// "Add N columns" (or Ctrl+Enter) adds them in one step. SINGLE ("add-filter" / "add-sort"):
// a row click starts a filter rule or sort level on that field.
//
// What is typed, what is ticked and which row is highlighted are transient UI, kept here and
// never in AppState. Typing and ticking redraw ONLY the list, the strip and the footer, in
// place — the search box is never rebuilt by them, so it keeps focus and caret by
// construction. A full render (an edit to the schedule) rebuilds the whole body, and
// preserveUi puts the caret back as it does for every box in the popover. Moving the
// highlight (↑↓) and hovering a row repaint nothing: they move a class and rewrite the strip.
//
// Ported from ifcTable's `ui/fieldPicker.ts` (Yong Yen, 2026-11-05) for SGVue v1.5.0, phase 2.
// SGVue draws the drag handle and the × with this window's own glyphs (`icons.ts`: `grip`,
// `ICON.remove` — phase 3, ifcTable's icon buttons) and its hover classes; every row and
// button keeps ifcTable's markup and acts.

import type { ModelStore } from '../../schedule/ifc/store';
import { fieldKey } from '../../schedule/schedule/actions';
import { headingOf } from '../../schedule/schedule/def';
import { ANY_PSET } from '../../schedule/schedule/resolve';
import { state } from './state';
import { buildCoverage, type Coverage } from './coverage';
import { esc } from './dom';
import { allRows, CALC_GROUP, CORE_GROUP, pctOf, pickerModel, type PickRow, type PickerModel } from './pickerModel';
import { grip, ICON } from './icons';
import { mark, stripHtml, type Peek } from './pickerStrip';

export type PickMode = 'picker' | 'add-filter' | 'add-sort';

let mode: PickMode = 'picker';
let query = '';
let picks: string[] = [];
let sel = 0;
let view: 'list' | 'pset' = 'list';
let showEmpty = false;
const shut = new Set<string>();
/** What each drawn row shows in the strip — by field id, or `col:<i>` for an "In this table"
 *  row — and the pickable ids in order (`sel` indexes it). Both rebuilt with the list. */
let peeks = new Map<string, Peek>();
let order: string[] = [];
/** The peek key of the row under the pointer, or null: the strip then follows `sel`. */
let hover: string | null = null;

/** A fresh picker each time it opens. */
export function resetPicker(m: PickMode) {
  mode = m; query = ''; picks = []; sel = 0; showEmpty = false; hover = null;
}
export const pickedIds = () => [...picks];
export const pickerMode = () => mode;
export function clearPicks() { picks = []; query = ''; sel = 0; }
export function setQuery(q: string) { query = q; sel = 0; hover = null; }
export function setView(v: string) { view = v === 'pset' ? 'pset' : 'list'; sel = 0; }
export function toggleFold(group: string) { if (!shut.delete(group)) shut.add(group); }
export function toggleEmpty() { showEmpty = !showEmpty; }
export function toggleTick(id: string) {
  picks = picks.includes(id) ? picks.filter((p) => p !== id) : [...picks, id];
}

function model(store: ModelStore, cov: Coverage): PickerModel {
  return pickerModel(state.def, store, cov, { query, single: mode !== 'picker', view, showEmpty, shut });
}

/** Coverage, only when short of 100%: a number and a colour, never the colour alone. */
const covBadge = (pct: number | null) =>
  pct === null || pct >= 100 ? '' : `<span class="cov${pct ? '' : ' zero'}">${pct}%</span>`;
/** The source tag, only on a name another field shares; the full pset rides in its title. */
const twinTag = (twin: string, source: string) =>
  twin ? `<span class="twin" title="${esc(source)}">${esc(twin)}</span>` : '';

function pickRow(r: PickRow, selected: boolean): string {
  const single = mode !== 'picker';
  const on = picks.includes(r.id);
  peeks.set(r.id, { name: r.name, source: r.group, field: r.field, hit: r.hit });
  // A single-pick row IS the "+ Filter" / "+ Sort" action; a multi-pick row ticks.
  const act = single ? `data-act="vb-add" data-v="${mode === 'add-filter' ? 'filter' : 'sort'}"` : 'data-act="pick-toggle"';
  // A value-search row says which value put it here; the strip says the rest.
  const hit = r.hit ? `<span class="hit">${mark(r.hit.example, query.trim())}</span>` : '';
  return `<div class="prow hv-step${selected ? ' sel' : ''}${on ? ' on' : ''}" ${act} data-id="${esc(r.id)}" role="option" aria-selected="${single ? selected : on}">${
    single ? '' : `<span class="ck" aria-hidden="true">${on ? '✓' : ''}</span>`}<span class="pname">${
    mark(r.name, r.hit ? '' : query.trim().split(/\s+/)[0] ?? '')}</span>${twinTag(r.twin, r.group)}${hit}${covBadge(r.pct)}</div>`;
}

/** "In this table": order by drag, remove, click to go to the column — or, for a hidden
 *  one, to its column menu, the only way to format a column with no heading to click. */
function tableRows(cov: Coverage, rows: PickRow[]): string {
  const def = state.def;
  if (!def.columns.length) return '<div class="sub pempty">Nothing yet.</div>';
  const byId = new Map(rows.map((r) => [r.id, r]));
  return def.columns.map((c, i) => {
    const name = headingOf(c, def);
    const pct = c.field.kind === 'formula' || !cov.total ? null : pctOf(cov, c.field);
    const source = c.field.kind === 'prop' ? (c.field.pset === ANY_PSET ? 'any pset' : c.field.pset)
      : c.field.kind === 'core' ? CORE_GROUP : CALC_GROUP;
    peeks.set(`col:${i}`, { name, source, field: c.field });
    return `<div class="crow hv-step${c.hidden ? ' hid' : ''}" draggable="true" data-drag="col" data-i="${i}">
      <span class="handle" tabindex="0" data-act="col-handle" data-i="${i}" title="Drag to reorder, or focus and use the arrow keys" aria-label="Reorder ${esc(name)}">${grip}</span>
      <button class="nm" data-act="pick-jump" data-i="${i}" title="${c.hidden ? 'Hidden — open its settings' : 'Go to this column'}">${esc(name)}${c.hidden ? ' <span class="sub">hidden</span>' : ''}</button>
      ${twinTag(byId.get(fieldKey(c.field))?.twin ?? '', source)}${covBadge(pct)}
      <button class="eye btn" data-act="${c.hidden ? 'cm-show' : 'cm-hide'}" data-defcol="${i}"${c.hidden ? '' : ' title="Keeps it for sorting, grouping and filtering"'}>${c.hidden ? 'Show' : 'Hide'}</button>
      <button class="icon-btn sm hv-warn-both" data-act="col-remove" data-i="${i}" title="Remove column"
        aria-label="Remove ${esc(name)}">${ICON.remove}</button>
    </div>`;
  }).join('');
}

function listHtml(store: ModelStore, cov: Coverage): string {
  const m = model(store, cov);
  sel = Math.max(0, Math.min(sel, m.pickable.length - 1));
  const selId = m.pickable[sel]?.id;
  const cat = state.def.entity.map((e) => e.replace(/^Ifc/, '')).join(', ');
  peeks = new Map();
  order = m.pickable.map((r) => r.id);
  let h = m.sections.map((s) => {
    if (s.table) return `<div class="psec">${esc(s.title)} · ${state.def.columns.length}</div>${tableRows(cov, allRows(state.def, store, cov))}`;
    const closed = s.fold && shut.has(s.title);
    const head = s.fold
      ? `<button class="pgroup${closed ? ' shut' : ''}" data-act="pick-fold" data-pset="${esc(s.title)}" aria-expanded="${!closed}"><span class="tw">▾</span>${esc(s.title)}<span class="n">${s.rows.length}</span></button>`
      : `<div class="psec">${esc(s.title)}</div>`;
    return closed ? head : head + s.rows.map((r) => pickRow(r, r.id === selId)).join('');
  }).join('');
  if (m.more) h += `<div class="pmore sub">${m.more.toLocaleString()} more — keep typing to narrow the list</div>`;
  if (m.onlyEmpty) h += `<div class="pempty">Only empty fields match “${esc(query.trim())}” — no ${esc(cat)} in this model has a value for them.</div>`;
  else if (query.trim() && !m.pickable.length) h += `<div class="pempty">No field is called or contains “${esc(query.trim())}”.</div>`;
  if (m.emptyHidden) h += `<button class="showempty" data-act="pick-empty">Show ${m.emptyHidden} empty field${m.emptyHidden === 1 ? '' : 's'} (0% of ${esc(cat)})</button>`;
  else if (showEmpty) h += '<button class="showempty" data-act="pick-empty">Hide empty fields</button>';
  return h;
}

function footHtml(): string {
  if (mode !== 'picker') return '';
  if (!picks.length) {
    return `<span class="sub"><kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>Enter</kbd> tick</span>
      <button class="quiet hv-step-ink" data-act="pick-calc">+ Calculated value</button>`;
  }
  const rows = new Map(allTicked());
  return `<span class="basket">${picks.map((id) => `<span class="bchip">${esc(rows.get(id) ?? id)}<button class="icon-btn sm hv-warn-both" data-act="pick-toggle" data-id="${esc(id)}" title="Untick"
    aria-label="Untick ${esc(rows.get(id) ?? id)}">${ICON.remove}</button></span>`).join('')}</span>
    <button class="btn primary" data-act="pick-commit">Add ${picks.length} column${picks.length === 1 ? '' : 's'} <kbd>Ctrl</kbd><kbd>Enter</kbd></button>`;
}

/** Ticked ids → their labels, for the basket. The plain field list — no search, no sections. */
function allTicked(): [string, string][] {
  const store = state.store;
  if (!store) return [];
  const all = allRows(state.def, store, buildCoverage(store, state.def.entity));
  return picks.map((id) => [id, all.find((r) => r.id === id)?.label ?? id]);
}

export function renderPicker(store: ModelStore, cov: Coverage): string {
  const single = mode !== 'picker';
  const list = listHtml(store, cov);
  return `<input class="pick-search pop-focus" type="search" data-act="pick-search" value="${esc(query)}" autocomplete="off"
      placeholder="Field name, or a value you know — fire, 120, qto area" aria-label="Find a field by name or by value" />
    <div class="pviews"><div class="seg" role="group" aria-label="List view">
      <button class="seg-btn${view === 'list' ? ' on' : ''}" data-act="pick-view" data-v="list" aria-pressed="${view === 'list'}">${single ? 'All fields' : 'Suggested + all'}</button>
      <button class="seg-btn${view === 'pset' ? ' on' : ''}" data-act="pick-view" data-v="pset" aria-pressed="${view === 'pset'}">By property set</button>
    </div></div>
    <div class="pick-list" role="listbox" aria-multiselectable="${!single}">${list}</div>
    <div class="pstrip" aria-live="off">${stripHtml(current(), cov, query)}</div>
    ${single ? '' : `<div class="pfoot">${footHtml()}</div>`}`;
}

/** The strip's field: the hovered row's, else the highlighted one's. */
const current = () => peeks.get(hover ?? '') ?? peeks.get(order[sel] ?? '');

/** The strip's key for a row element: its field id, or `col:<i>` for an "In this table" row. */
export const peekKey = (row: HTMLElement) => (row.classList.contains('crow') ? `col:${row.dataset.i}` : row.dataset.id ?? '');

/** Rewrite the strip alone. Only a keyboard move is announced: the search box keeps focus, so
 *  the strip is how a screen reader hears where ↑↓ landed; a hover would just be chatter. */
function drawStrip(announce = false) {
  const store = state.store;
  const strip = document.querySelector<HTMLElement>('#popover .pstrip');
  if (!store || !strip) return;
  strip.setAttribute('aria-live', announce ? 'polite' : 'off');
  // eslint-disable-next-line no-unsanitized/property -- stripHtml: every file- or user-derived value in it goes through esc() / mark()
  strip.innerHTML = stripHtml(current(), buildCoverage(store, state.def.entity), query);
}

/** The pointer moved onto a row (its `peekKey`), or onto anything else in the list or off it
 *  (null): preview the row, else hand the strip back to the highlighted one. */
export function hoverPeek(key: string | null) {
  if (key === hover || (key !== null && !peeks.has(key))) return;
  hover = key;
  drawStrip();
}

/** ↑↓ moved `sel`: move the highlight class in place and follow it in the strip. */
function showHighlight() {
  const list = document.querySelector<HTMLElement>('#popover .pick-list');
  if (!list) return;
  const single = mode !== 'picker';
  for (const row of list.querySelectorAll<HTMLElement>('.prow')) {
    const on = row.dataset.id === order[sel];
    row.classList.toggle('sel', on);
    if (single) row.setAttribute('aria-selected', String(on));
    if (on) row.scrollIntoView({ block: 'nearest' });
  }
  drawStrip(true);
}

/** Redraw the list, strip and footer in place — never the search box. */
export function refreshPicker() {
  const store = state.store;
  const list = document.querySelector<HTMLElement>('#popover .pick-list');
  if (!store || !list) return;
  // eslint-disable-next-line no-unsanitized/property -- listHtml: every file- or user-derived value in it goes through esc() / mark()
  list.innerHTML = listHtml(store, buildCoverage(store, state.def.entity));
  const foot = document.querySelector<HTMLElement>('#popover .pfoot');
  // eslint-disable-next-line no-unsanitized/property -- footHtml: the ticked fields' labels go through esc()
  if (foot) foot.innerHTML = footHtml();
  list.querySelector('.prow.sel')?.scrollIntoView({ block: 'nearest' });
  drawStrip();
}

/** What a key in the search box asks for; the caller does it. `moved` is already done. */
export type PickKey =
  | { kind: 'redraw' } | { kind: 'moved' } | { kind: 'commit' } | { kind: 'one'; id: string } | null;

export function pickerKey(key: string, ctrl: boolean, box: HTMLInputElement): PickKey {
  const store = state.store;
  if (!store) return null;
  // Only these keys need the list; every other keystroke is just typing.
  if (key === 'Backspace') {
    if (box.value || !picks.length) return null;
    picks = picks.slice(0, -1);
    return { kind: 'redraw' };
  }
  if (key !== 'Enter' && key !== 'ArrowDown' && key !== 'ArrowUp') return null;
  const m = model(store, buildCoverage(store, state.def.entity));
  const top = m.pickable[Math.min(sel, m.pickable.length - 1)];
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    sel = Math.max(0, Math.min(m.pickable.length - 1, sel + (key === 'ArrowDown' ? 1 : -1)));
    hover = null;
    showHighlight();
    return { kind: 'moved' };
  }
  if (mode !== 'picker') return top ? { kind: 'one', id: top.id } : null;
  // Ctrl+Enter adds what is ticked. A bare Enter always ticks (or unticks) the highlighted
  // match — and, if a name was typed, clears the box for the next one.
  if (ctrl) return picks.length ? { kind: 'commit' } : null;
  if (!top) return null;
  toggleTick(top.id);
  // The strip shows the row just ticked, not one the pointer happens to rest on.
  hover = null;
  if (query.trim()) { query = ''; sel = 0; box.value = ''; }
  return { kind: 'redraw' };
}
