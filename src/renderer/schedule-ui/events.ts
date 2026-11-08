// All event wiring, delegated from one stable root (#app), so re-rendering any pane's
// innerHTML never orphans a listener. main.ts only boots, receives the snapshot and paints.
//
// Ported from ifcTable's `ui/events.ts` (2026-09-25, phase 2 of the Schedules window), handler
// for handler. What SGVue changes:
//   - no file open, start screen or theme toggle: the model and the theme come from the main
//     window;
//   - phase 4: the Export menu (Excel, CSV, every saved schedule, the schedule file) is a header
//     button opening the row menu's own `menu.ts`, and `.schedule.json` export / import go
//     through main's native Save / Open dialogs (`exporting.ts`) rather than a download;
//   - `confirm()` and `prompt()` become the window's own dialog (`dialog.ts`): Electron does
//     not implement `prompt()` at all, and a native box is not SGVue's look;
//   - a data row's click selects its elements in the main window (`Hooks.pickRow`);
//   - the header carries undo / redo / print buttons beside the keyboard shortcuts;
//   - phase 3: Ctrl/⌘-click toggles a row and Shift-click takes a range; the arrow keys move
//     the row selection and Enter frames it in 3D; right-click (or the ContextMenu key /
//     Shift+F10) opens the row menu, and right-click on a heading the colour-by menu;
//   - 2026-10-02 (the assistant's `manage_schedules`): the bodies of the undo / redo, template,
//     saved-setup and print handlers live in `actions.ts`, unchanged, so that a request over the
//     port runs the very function a click runs (`manage.ts`). What a click asks first — "Replace
//     the current schedule setup?", the rename prompt — is still asked here.
//
// v1.5.0, phase 2 — ifcTable's table-first redesign (2026-11-05): the inspector's five tabs are
// gone. Every handler builds the next definition with a pure action from
// `schedule/schedule/actions` (`act.*`) instead of editing it in place; the column menu
// (`columnMenu.ts`), the view bar's chips and popovers (`viewBar.ts`, `viewPopovers.ts`) and the
// field picker (`fieldPicker.ts`) are wired here, and a heading's plain click, Enter or Space
// opens its column menu (its right-click is still the colour-by menu). A typed edit still waits
// in pending.ts — the one pending edit, which lands before any other input, focus change, click
// or key — so ifcTable's `flushText()` calls have no counterpart here.

import type { UnitKind } from '../../schedule/ifc/types';
import * as act from '../../schedule/schedule/actions';
import { alignForCalc, columnForCore, columnForProp, defaultColumnsFor } from '../../schedule/schedule/columns';
import {
  emptySchedule, MAX_FILTERS, MAX_SORT_LEVELS,
  type Column, type CondRule, type FieldRef, type FilterRule, type ScheduleDef, type SortLevel, type TotalKind,
} from '../../schedule/schedule/def';
import { clampDecimals, defaultDecimals } from '../../schedule/schedule/format';
import { presetById } from '../../schedule/schedule/presets';
import { dimensionOf } from '../../schedule/schedule/formula';
import {
  applyTemplate, askDeleteSaved, duplicateSaved, loadSaved, printSchedule, renameSaved, saveCurrent,
  stepHistory,
} from './actions';
import { later } from './pending';
import { editDef, state, update, updateDef, type RenderScope } from './state';
import { clampWidth, fitAll, naturalWidths } from './colResize';
import { followColumn, menuColumn, openHiddenColumnMenu, setMenuView, toggleColumnMenu, toggleMore } from './columnMenu';
import { wireReorder } from './dnd';
import { confirmDialog, dialogOpen, promptDialog } from './dialog';
import { menuOpen, openMenu } from './menu';
import { EXPORT_ACTIONS, exportScheduleFile, openScheduleFile } from './exporting';
import { clamp, flash, onChange, onClick, onInput } from './dom';
import { fieldFromKey, kindOf, kindsByHeading, selectedIndex, statOf, storeNum, typeOf } from './panels/shared';
import { closePopover, paintPopover, popoverId } from './popover';
import {
  clearPicks, hoverPeek, peekKey, pickedIds, pickerKey, pickerMode, refreshPicker, resetPicker, setQuery, setView,
  toggleEmpty, toggleFold, toggleTick,
} from './fieldPicker';
import { openChip, openChipPopover, toggleChip } from './viewBar';
import { listSaved } from './schedules';

const num = (el: HTMLElement) => Number((el as HTMLInputElement).value);
const text = (el: HTMLElement) => (el as HTMLInputElement).value;
const checked = (el: HTMLElement) => (el as HTMLInputElement).checked;
/**
 * An element's position in the list it belongs to — a column, a filter rule, a sort level,
 * a colour rule. One name for all of them: nothing in this app carries two indexes at once,
 * and four names for the same idea is how the focus and reorder code came to disagree
 * about which element it was looking at.
 */
const idx = (el: HTMLElement) => Number(el.dataset.i ?? -1);
/**
 * Category, saved setup and template all replace the whole definition. If the user has
 * customized anything there is no way back, so ask first. One predicate and one string for
 * all three: written out twice, the template's copy could be — and was — the odd one out.
 */
//
// SGVue: the question is the window's own dialog, so the answer arrives later. With nothing
// to ask, `apply` still runs synchronously inside the click, exactly as ifcTable's did.
function ifReplaceOk(apply: () => void) {
  if (!state.dirty || !state.def.columns.length) { apply(); return; }
  void confirmDialog('Replace the current schedule setup?', 'Replace').then((ok) => { if (ok) apply(); });
}

/**
 * The column a field becomes when someone adds it by hand — from the field picker. One
 * function, so every way a column is added by hand gives it the same units and alignment. It
 * defaults the way one the app generated does: in the model's own system of units.
 */
function columnFor(def: ScheduleDef, f: FieldRef): Column {
  const system = state.store?.meta.unitSystem;
  if (f.kind === 'core') return columnForCore(f.key, system);
  if (f.kind === 'prop') {
    const stat = state.store && statOf(state.store, def, f);
    return stat ? columnForProp(stat, system) : { field: f };
  }
  // Aligned by what the calculated value says it holds. This used to be a flat 'right',
  // from when a formula could only ever be a number — which left a column of the word
  // "Small" hard against the right-hand rule.
  return { field: f, align: alignForCalc(def.calculated?.find((c) => c.id === f.id)) };
}

export interface Hooks {
  /** A data row was clicked: its index in the result on screen, and the modifiers held. */
  pickRow: (row: number, mods: { toggle: boolean; range: boolean }) => void;
  /** The row menu, for a right-clicked row — or `null`: the keyboard, for the marked rows. */
  rowMenu: (row: number | null, at?: { x: number; y: number }) => void;
  /** The colour-by menu for a right-clicked heading (its def.columns index). */
  headMenu: (defcol: number, at: { x: number; y: number }) => void;
  /** Arrow up / down: the row selection moves. */
  moveRow: (step: 1 | -1) => void;
  /** Enter: the selection is framed in 3D. */
  frameSelection: () => void;
}

/**
 * Text inputs repaint everything, because a panel's own text can depend on what was typed
 * (a rule's "removes 353", a formula's error). main.ts restores focus and caret around the
 * repaint, so it still behaves like an ordinary text box.
 *
 * SGVue (2026-09-25): the edit waits in pending.ts — the one pending edit, which lands before
 * any other box's input, when focus leaves this box, and before any click or key action.
 * ifcTable's per-selector timers lost or misplaced text three ways (pending.ts lists them).
 * v1.5.0: `apply` is a pure action; its target is named by the box itself (`data-i`,
 * `data-defcol`, `data-id`), and nothing can move a column or a rule before the edit lands.
 */
function liveText(
  root: HTMLElement, selector: string,
  apply: (def: ScheduleDef, value: string, el: HTMLElement) => ScheduleDef, scope: RenderScope = 'all',
) {
  onInput(root, selector, (el) => {
    const value = text(el);
    later(el, () => editDef((def) => apply(def, value, el)), scope, 200);
  });
}

/**
 * The same shape for a box that filters a list rather than editing the schedule: straight
 * into AppState, no undo entry, and 150ms because the only cost of a keystroke here is a
 * repaint — of the panes only, never the schedule, which a search cannot change.
 */
function liveState(
  root: HTMLElement, selector: string,
  key: 'railQuery' | 'templateQuery' | 'savedQuery',
) {
  onInput(root, selector, (el) => {
    const value = text(el);
    later(el, () => { state[key] = value; }, 'panes', 150);
  });
}

export function wireApp(root: HTMLElement, hooks: Hooks) {
  wireShell(root);
  // SGVue: a data row stands for one element, or, with itemise off, every element it
  // collapsed. Group, footer, blank and grand-total rows carry no data-row and select nothing.
  onClick(root, 'tr[data-row]', (el, ev) => hooks.pickRow(Number(el.dataset.row), {
    toggle: ev.ctrlKey || ev.metaKey, range: ev.shiftKey,
  }));
  wireRows(root, hooks);
  wireHistory(root);
  // The field picker's "In this table" rows are the one drag list left.
  wireReorder(root, (kind, from, to) => updateDef((def) => {
    if (kind !== 'col' || !act.canMove(def.columns.length, from, to)) return def;
    const next = act.moveColumn(def, from, to);
    // The last-clicked column follows the column the user just moved.
    if (state.selectedColumn === from) state.selectedColumn = to;
    // Every index between `from` and `to` shifted, so a header selection built on the old
    // positions would now mark — and resize — the wrong columns. The colour preview holds
    // a column index too, and would narrow the table by whatever slid into that slot.
    state.selectedCols = [];
    state.litBy = null;
    return next;
  }));
  wireOverlays(root);
  wireColumns(root);
  wireFilter(root);
  wireSort(root);
  wireFormat(root);
  wireAppearance(root);
  wireColumnMenu(root);
  wireViewBar(root);
  wireCalculated(root);
  onClick(root, '[data-act="print"]', () => printSchedule());
  wireExports(root);
}

// ---------------------------------------------------------------- export (phase 4)

function wireExports(root: HTMLElement) {
  // One control, several answers (ifcTable's reasoning): a menu under the header's Export
  // button, in the row menu's own markup and keyboard contract — Enter or Space on the button
  // opens it with the first item focused, the arrows move, Escape gives focus back.
  onClick(root, '[data-act="export-menu"]', (el) => {
    const box = el.getBoundingClientRect();
    const saved = listSaved().length;
    openMenu(box.left, box.bottom + 4, [
      // `EXPORT_ACTIONS` is also what Ask SGVue's `export_schedule` runs (2026-09-28).
      { label: 'Excel (.xlsx)', run: () => void EXPORT_ACTIONS.xlsx() },
      { label: 'CSV', run: () => void EXPORT_ACTIONS.csv() },
      { label: 'All saved schedules (.xlsx)', disabled: !saved, run: () => void EXPORT_ACTIONS.all_saved() },
      { label: 'Schedule file (.schedule.json)', sep: true, run: () => void EXPORT_ACTIONS.schedule_file() },
    ], 'Export');
  });
  onClick(root, '[data-act="export-saved"]', (el) => {
    const entry = listSaved().find((s) => s.name === el.dataset.name);
    if (entry) void exportScheduleFile(entry.def);
  });
  onClick(root, '[data-act="import-schedule"]', () => void openScheduleFile());
}

// ---------------------------------------------------------------- shell

function wireShell(root: HTMLElement) {
  onClick(root, '[data-act="rail-toggle"]', () => update({ railOpen: !state.railOpen }));

  // ---- rail ----
  liveState(root, '[data-act="rail-query"]', 'railQuery');
  onClick(root, '[data-act="rail-sort"]', () => update({ railSort: state.railSort === 'name' ? 'count' : 'name' }, 'panes'));

  onClick(root, '[data-act="category"]', (el) => {
    const entity = el.dataset.entity ?? '';
    const store = state.store;
    if (!store || state.def.entity.includes(entity)) return;
    ifReplaceOk(() => {
      // A menu or chip names a position in the schedule being replaced.
      if (popoverId()) closePopover();
      update({
        selectedColumn: null,
        selectedCols: [],
        dirty: false,
        removedBy: null,
        litBy: null,
        // A generated schedule came from neither a template nor a saved setup, and saying so
        // is what keeps both IN USE markers honest.
        templateId: null,
        savedName: null,
        def: {
          ...emptySchedule(`${entity.replace(/^Ifc/, '')} Schedule`, [entity]),
          columns: defaultColumnsFor(store, [entity]),
        },
      });
    });
  });

  liveText(root, '[data-act="name"]', (def, v) => act.setName(def, v), 'table');

  // ---- table ----
  // data-defcol, not data-i: a header carries where its column sits in def.columns, which
  // is not the same as its position among the visible headers once one is hidden.
  //
  // The two modifiers mean what they mean everywhere else: Ctrl (Cmd) adds or removes one
  // column, Shift takes the whole run from the anchor to here. Neither opens the column
  // menu — the point of the gesture is what happens next at the grip, where main.ts hands
  // the selection to the resizer as its group. A plain click clears the marks and opens (or
  // closes) that column's menu. A click that ends a grip drag never gets here: colResize
  // swallows it at window capture. selectedColumn follows: it anchors the next Shift+click
  // and is the width Equal width copies.
  //
  // Both marking branches repaint at 'all', not 'table': the header's Equal width button is
  // enabled by this selection, and a 'table' pass would leave it claiming whatever the
  // previous selection made true. preserveUi restores focus, caret and scroll around every
  // repaint.
  onClick(root, 'th[data-defcol]', (el, ev) => {
    const i = Number(el.dataset.defcol);
    if (ev.ctrlKey || ev.metaKey) {
      const picked = state.selectedCols.includes(i)
        ? state.selectedCols.filter((n) => n !== i)
        : [...state.selectedCols, i];
      update({ selectedCols: picked });
      return;
    }
    if (ev.shiftKey) {
      // A run is contiguous on screen, so it is built over the VISIBLE columns — a hidden
      // column between two marked ones is not something the user can see or size.
      const visible = state.def.columns.reduce<number[]>((out, c, n) => {
        if (!c.hidden) out.push(n);
        return out;
      }, []);
      // The last mark is the anchor; failing that, the column last clicked. An anchor that
      // is hidden or no longer there names no run, so the click stands alone.
      const anchor = state.selectedCols.at(-1) ?? state.selectedColumn ?? i;
      const from = visible.indexOf(anchor);
      const to = visible.indexOf(i);
      const picked = from < 0 || to < 0
        ? [i] : visible.slice(Math.min(from, to), Math.max(from, to) + 1);
      update({ selectedCols: picked });
      return;
    }
    toggleColumnMenu(i);
    // Marks to clear means a repaint (they are drawn on the headings and enable Equal width);
    // otherwise this is only a menu opening, and the table is left alone.
    if (state.selectedCols.length) { update({ selectedColumn: i, selectedCols: [] }); return; }
    // Not drawn anywhere — read at event time only (Shift+click anchor, Equal width source).
    state.selectedColumn = i;
    paintPopover();
  });
  onClick(root, '[data-act="clear-removed"]', () => update({ removedBy: null }));

  // Fit every column at once, then unify the ones that come out almost the same width.
  // It has to read the laid-out table: what a column WANTS to be is only knowable after a
  // layout, and the definition cannot answer it. Measure and commit deliberately share one
  // task — a measurement is only true of the table it was taken from, and any repaint in
  // between (a debounced edit, an undo) rebuilds that table. Safe because nothing else in
  // the dispatch needs the clicked button: it is the only handler for its act, and
  // ui/dom.ts deliberately never re-tests whether a target is still in the document.
  // One updateDef, so one undo step puts it all back.
  onClick(root, '[data-act="fit-all"]', () => {
    const table = root.querySelector<HTMLElement>('#output-pane table.schedule');
    if (!table) return;
    const widths = fitAll(table);
    if (!widths.length) return;
    updateDef((def) => act.setWidths(def, widths));
  });

  // "Make these look like that one." The marked columns take the width of the column whose
  // heading was last clicked — `selectedIndex`, column-0 fallback and all. Its own width is
  // read first and measured only if it has none; the source itself is never written,
  // whether or not it is marked. Clipping is not a risk: a column with a width wraps, by the
  // rule in tableView.
  //
  // The guards repeat what disables the button in header.ts, because a handler may not trust
  // its own markup — and the filter is the same one main.ts applies before handing a
  // selection to the resizer. One task and one updateDef, exactly as above.
  onClick(root, '[data-act="fit-equal"]', () => {
    const table = root.querySelector<HTMLElement>('#output-pane table.schedule');
    const picked = state.selectedCols.filter((n) => state.def.columns[n]);
    if (!table || picked.length < 2) return;
    const src = selectedIndex(state);
    // One measurement answers both questions below. A HIDDEN source renders no heading, so
    // it can be neither measured nor seen — and a width taken from a column the user cannot
    // look at is not "make these look like that one". That case falls back to the widest
    // marked column, which is what this button did before it took a source column.
    const measured = naturalWidths(table, [src, ...picked]);
    const source = state.def.columns[src]?.width
      ?? measured.find((c) => c.i === src)?.px
      ?? measured.filter((c) => picked.includes(c.i)).reduce((m, c) => Math.max(m, c.px), 0);
    if (!source) return;
    const w = clampWidth(Math.ceil(source));
    updateDef((def) => act.setWidths(def, picked.map((i) => [i, w])));
  });

  // ---- saved schedules ----
  // The bodies of these handlers are in actions.ts since 2026-10-02: a request from the
  // assistant (manage.ts) runs the same function a click does.
  onClick(root, '[data-act="save-schedule"]', () => { saveCurrent(); });
  onClick(root, '[data-act="load-saved"]', (el) => {
    const entry = listSaved().find((s) => s.name === el.dataset.name);
    if (!entry) return;
    // Clicking the one already loaded reloads it over your edits, a genuinely useful act.
    // ifcTable's start-screen branch, where the row arms a setup for the next model, has no
    // counterpart here: the model is always open.
    ifReplaceOk(() => { if (popoverId()) closePopover(); loadSaved(entry); });
  });
  onClick(root, '[data-act="delete-saved"]', (el) => askDeleteSaved(el.dataset.name ?? ''));

  // ---- my templates panel ----
  liveState(root, '[data-act="saved-search"]', 'savedQuery');

  onClick(root, '[data-act="rename-saved"]', (el) => {
    const name = el.dataset.name ?? '';
    void promptDialog('Rename this template', name, 'Rename').then((answer) => {
      const next = answer?.trim();
      if (!next || next === name) return;
      renameSaved(name, next);
    });
  });

  onClick(root, '[data-act="duplicate-saved"]', (el) => { duplicateSaved(el.dataset.name ?? ''); });
}

// ---------------------------------------------------------------- rows (phase 3)

/** A heading the keyboard can reach: a column's own cell, or the "+ Column" button. */
const HEAD_STOP = 'th[data-defcol], .th-add';

function wireRows(root: HTMLElement, hooks: Hooks) {
  // Shift-click takes a range of rows, not a run of text.
  root.addEventListener('mousedown', (ev) => {
    if (ev.shiftKey && (ev.target as HTMLElement).closest('tr[data-row]')) ev.preventDefault();
  });
  root.addEventListener('contextmenu', (ev) => {
    const t = ev.target as HTMLElement;
    const tr = t.closest<HTMLElement>('tr[data-row]');
    const th = tr ? null : t.closest<HTMLElement>('th[data-defcol]');
    if (!tr && !th) return;
    ev.preventDefault();
    const at = { x: ev.clientX, y: ev.clientY };
    if (tr) hooks.rowMenu(Number(tr.dataset.row), at);
    else hooks.headMenu(Number(th!.dataset.defcol), at);
  });
  root.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    // Left and Right move between the headings, as in a menu bar (ifcTable, 2026-11-05) —
    // a heading with no menu (Count) is skipped, so "+ Column" stays reachable. Nothing else
    // reads those keys on a heading: the grip is pointer-only.
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey && !e.ctrlKey && !e.metaKey) {
      let cell = t.closest?.(HEAD_STOP)?.closest<HTMLElement>('th');
      if (!cell) return;
      let to: HTMLElement | null = null;
      while (!to && cell) {
        cell = (e.key === 'ArrowRight' ? cell.nextElementSibling : cell.previousElementSibling) as HTMLElement | null;
        to = cell?.dataset.defcol !== undefined ? cell : cell?.querySelector<HTMLElement>('.th-add') ?? null;
      }
      if (!to) return;
      e.preventDefault();
      to.focus();
      return;
    }
    // A focused heading: the ContextMenu key or Shift+F10 opens its right-click menu, under
    // it — the keyboard's route to "Colour 3D by this column". Enter or Space is its click
    // (phase 4), with the click's own modifiers: Shift takes the run, Ctrl / ⌘ adds or removes
    // one, and a plain one opens the column menu (v1.5.0).
    const th = t.closest?.<HTMLElement>('th[data-defcol]');
    if (!th) return;
    if (e.key === 'Enter' || e.key === ' ') {
      if (e.altKey || e.repeat) return;
      e.preventDefault();
      th.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey,
      }));
      return;
    }
    if (!(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) return;
    e.preventDefault();
    const box = th.getBoundingClientRect();
    hooks.headMenu(Number(th.dataset.defcol), { x: box.left + 8, y: box.bottom });
  });
  // The table's keys work when nothing else holds the keyboard: a click on a row leaves the
  // focus on the body, since a row is not a control. Anything focusable keeps its own keys.
  window.addEventListener('keydown', (e) => {
    if (e.target !== document.body || state.overlay || dialogOpen() || menuOpen() || !state.store) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      hooks.moveRow(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      hooks.frameSelection();
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      hooks.rowMenu(null);
    }
  });
}

// ---------------------------------------------------------------- undo / redo

/** A box the caret can be in — its own Ctrl/⌘+Z undoes the typing. */
const editable = (t: EventTarget | null) => t instanceof HTMLElement
  && (t.isContentEditable || t.tagName === 'TEXTAREA'
    || (t instanceof HTMLInputElement && ['text', 'search', 'number'].includes(t.type)));

function wireHistory(root: HTMLElement) {
  // This window's own: the main window keeps its own undo, for visibility changes.
  window.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const key = e.key.toLowerCase();
    const wantRedo = key === 'y' || (key === 'z' && e.shiftKey);
    if (key !== 'z' && key !== 'y') return;
    // A dialog owns the keyboard while it is open; its text box keeps its own undo. So does
    // any text box of the window's: the caret in a box means "undo my typing", not the schedule.
    if (dialogOpen() || editable(e.target)) return;
    e.preventDefault();
    stepHistory(wantRedo);
  });
  // One step back or forward — the keys, these two buttons and a request from chat all
  // come to the same function (actions.ts).
  onClick(root, '[data-act="undo"]', () => { stepHistory(false); });
  onClick(root, '[data-act="redo"]', () => { stepHistory(true); });
}

// ---------------------------------------------------------------- overlays

function wireOverlays(root: HTMLElement) {
  // The calculated-value editor: from a calculated column's "Edit formula", the view bar's
  // "N formulas to fix" chip, the picker's "+ Calculated value" and the syntax guide's way
  // back. The modal replaces the popover.
  onClick(root, '[data-act="open-calc"]', () => { closePopover(); update({ overlay: 'calc' }); });
  onClick(root, '[data-act="open-templates"]', () => { closePopover(); update({ overlay: 'templates' }); });
  onClick(root, '[data-act="open-saved"]', () => { closePopover(); update({ overlay: 'saved' }); });
  // The formula syntax guide, which ifcTable served as a page of its own (`/formula.html`).
  onClick(root, '[data-act="open-formula"]', () => update({ overlay: 'formula' }));
  // Its section links scroll the guide; an in-page anchor would be a navigation.
  onClick(root, '[data-act="formula-jump"]', (el) =>
    root.querySelector(`#help-${CSS.escape(el.dataset.v ?? '')}`)?.scrollIntoView({ block: 'start' }));
  onClick(root, '[data-act="close-overlay"]', () => update({ overlay: null }));
  // Clicking the dimmed surround closes; clicking anywhere inside the card must not.
  // Both ends of the gesture have to land there, not just the release. When a press and a
  // release happen on different elements the browser fires `click` on their nearest common
  // ancestor — so dragging from the card's search box out onto the surround delivers a
  // click whose target IS the backdrop, identical to a real one. Selecting text by dragging
  // closed the panel. The press origin is the only thing that tells the two apart.
  let pressOnBackdrop = false;
  root.addEventListener('pointerdown', (ev) => {
    const t = ev.target as HTMLElement | null;
    pressOnBackdrop = t?.closest('[data-act="overlay-backdrop"]') === t;
  });
  onClick(root, '[data-act="overlay-backdrop"]', (el, ev) => {
    if (pressOnBackdrop && ev.target === el) update({ overlay: null });
  });
  // One Escape handler, in the order things sit on top of each other: an overlay first,
  // then a column selection — the other thing that outstays its welcome. The window's own
  // dialog (dialog.ts) owns Escape while it is open, and the popover takes its Escape at
  // window capture before this one sees it (popover.ts).
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || dialogOpen()) return;
    // The syntax guide is opened from the calculated-value editor, so Escape goes back there.
    if (state.overlay === 'formula') { update({ overlay: 'calc' }); return; }
    if (state.overlay) { update({ overlay: null }); return; }
    // 'all', for the same reason as the two selection branches in wireShell: clearing the
    // marks also disables the header's Equal width button.
    if (state.selectedCols.length) update({ selectedCols: [] });
  });

  // ---- template gallery ----
  liveState(root, '[data-act="template-search"]', 'templateQuery');
  onClick(root, '[data-act="apply-template"]', (el) => {
    const preset = presetById(el.dataset.id ?? '');
    if (!preset) return;
    ifReplaceOk(() => { if (popoverId()) closePopover(); applyTemplate(preset); });
  });
}

// ---------------------------------------------------------------- columns

// Removing a column (the column menu, the picker's "In this table" ×) and pointing an empty
// one at another field (the column menu's remap).
function wireColumns(root: HTMLElement) {
  onClick(root, '[data-act="col-remove"]', (el) => {
    const i = idx(el);
    // Asked BEFORE the shift below, never after: a column that merely slides down into slot
    // `i` would otherwise answer yes and be cleared in place of the one actually removed.
    const wasEditing = state.selectedColumn === i;
    // The menu names columns by position too: it closes rather than describe a neighbour.
    if (menuColumn() !== null) closePopover();
    // Every index after this one shifts down, so a header selection made against the old
    // positions is meaningless. Cleared before the repaint, not after, or one paint marks
    // the wrong headings.
    state.selectedCols = [];
    // Same currency, same deadline: a last-clicked column to the RIGHT of the removed one
    // names its neighbour once the list closes up.
    if (state.selectedColumn !== null && state.selectedColumn > i) state.selectedColumn -= 1;
    updateDef((def) => act.removeColumn(def, i));
    if (wasEditing) update({ selectedColumn: null });
  });

  onChange(root, '[data-act="remap"]', (el) => {
    const key = text(el);
    const i = idx(el);
    const dot = key.indexOf('.');
    if (!key || dot < 0) return;
    // Keeps the heading so the schedule still reads as the user labelled it.
    updateDef((def) => act.remapColumn(def, i, { kind: 'prop', pset: key.slice(0, dot), prop: key.slice(dot + 1) }));
  });
}

// ---------------------------------------------------------------- filter

function wireFilter(root: HTMLElement) {
  onClick(root, '[data-act="filter-remove"]', (el) => {
    const i = idx(el);
    // Positions shift down, so a rule's popover would now describe its neighbour.
    if (openChip()?.kind === 'filter') closePopover();
    updateDef((def) => act.removeFilterRule(def, i));
    if (state.removedBy !== null) update({ removedBy: null });
  });
  // A segmented pair, not a select — data-v carries which side was clicked. The view bar's
  // and / or join between two chips sends the other value through the same act.
  onClick(root, '[data-act="filter-logic"]', (el) =>
    updateDef((def) => act.setFilterMode(def, el.dataset.v === 'or' ? 'or' : 'and')));
  onChange(root, '[data-act="filter-field"]', (el) => updateDef((def) => {
    const f = fieldFromKey(text(el));
    // The old value may be meaningless against a different field, so the action clears it.
    return f ? act.setFilterField(def, idx(el), f) : def;
  }));
  onChange(root, '[data-act="filter-op"]', (el) =>
    updateDef((def) => act.setFilterOp(def, idx(el), text(el) as FilterRule['op'])));

  // The value a box stores. Numeric boxes hold display units; store SI so comparisons stay
  // honest. Decided by the FIELD, not the box: the boxes are text (inputmode=decimal) so a
  // repaint cannot eat what is typed, and every box must store the same thing. A number field
  // never stores text: what storeNum cannot read is '' — what the old number input handed
  // back for junk — not a string matchRule would then read as a display-unit number and
  // compare against SI (ifcTable, 2026-11-05).
  const setValue = (def: ScheduleDef, el: HTMLElement, raw: string): ScheduleDef => {
    const rule = def.filters[idx(el)];
    const store = state.store;
    if (!rule || !store) return def;
    if (typeOf(store, def, rule.field) !== 'number') return act.setFilterValue(def, idx(el), raw);
    const kind = kindOf(store, def, rule.field);
    return act.setFilterValue(def, idx(el), storeNum(raw, kind, store.meta.unitSystem) ?? '');
  };
  liveText(root, 'input[data-act="filter-value"]', (def, v, el) => setValue(def, el, v));
  onChange(root, 'select[data-act="filter-value"]', (el) => updateDef((def) => setValue(def, el, text(el))));

  // A cleared box is an open end, not 0 (Number('') is 0) — and so is one storeNum cannot
  // read, exactly as the old number input reported junk as empty (phase 1 made an empty end
  // open-ended in the engine; this is the box that writes it).
  const setRange = (slot: 0 | 1) => (def: ScheduleDef, raw: string, el: HTMLElement): ScheduleDef => {
    const rule = def.filters[idx(el)];
    const store = state.store;
    if (!rule || !store) return def;
    const kind = kindOf(store, def, rule.field);
    return act.setFilterRange(def, idx(el), slot, storeNum(raw, kind, store.meta.unitSystem));
  };
  liveText(root, '[data-act="filter-lo"]', setRange(0));
  liveText(root, '[data-act="filter-hi"]', setRange(1));

  liveText(root, '[data-act="filter-values"]', (def, v, el) =>
    act.setFilterValues(def, idx(el), v.split(',').map((s) => s.trim()).filter(Boolean)));

  onClick(root, '[data-act="show-removed"]', (el) => {
    const i = idx(el);
    // Two narrowings of the same table would each describe rows the other had already
    // taken away, so arming one disarms the other.
    update({ removedBy: state.removedBy === i ? null : i, litBy: null });
  });
}

// ---------------------------------------------------------------- sorting

function wireSort(root: HTMLElement) {
  onClick(root, '[data-act="sort-remove"]', (el) => {
    if (openChip()?.kind === 'sort') closePopover();
    updateDef((def) => act.removeSortLevel(def, idx(el)));
  });
  // The level popover's Earlier / Later, through moveSortLevel. The popover follows the
  // level it moved.
  onClick(root, '[data-act="sort-move"]', (el) => {
    const from = idx(el);
    const to = from + Number(el.dataset.v);
    if (!act.canMove(state.def.sort.length, from, to)) return;
    if (openChip()?.kind === 'sort') openChipPopover('sort', to, false);
    updateDef((def) => act.moveSortLevel(def, from, to));
  });
  onChange(root, '[data-act="sort-field"]', (el) => updateDef((def) => {
    const f = fieldFromKey(text(el));
    return f ? act.setSortField(def, idx(el), f) : def;
  }));
  onClick(root, '[data-act="sort-dir"]', (el) =>
    updateDef((def) => act.setSortDir(def, idx(el), el.dataset.v === 'desc' ? 'desc' : 'asc')));
  onChange(root, '[data-act="sort-header"]', (el) =>
    updateDef((def) => act.setGroupOptions(def, idx(el), { header: checked(el) })));
  onChange(root, '[data-act="sort-blank"]', (el) =>
    updateDef((def) => act.setGroupOptions(def, idx(el), { blankLine: checked(el) })));
  // The chip is on/off; the select underneath chooses what an enabled footer shows.
  onChange(root, '[data-act="sort-footer"]', (el) =>
    updateDef((def) => act.setGroupOptions(def, idx(el), { footer: checked(el) ? 'titleCountTotals' : 'none' })));
  onChange(root, '[data-act="sort-footer-style"]', (el) =>
    updateDef((def) => act.setGroupOptions(def, idx(el), { footer: text(el) as SortLevel['footer'] })));
  onChange(root, '[data-act="itemize"]', (el) =>
    updateDef((def) => act.setItemize(def, checked(el))));
  onChange(root, '[data-act="grand-total"]', (el) =>
    updateDef((def) => act.setGrandTotal(def, checked(el))));
  liveText(root, '[data-act="grand-title"]', (def, v) => act.setGrandTotalTitle(def, v));
}

// ---------------------------------------------------------------- formatting

function wireFormat(root: HTMLElement) {
  // The column a control edits: every column-menu control (and colour-rule card) names its
  // own in data-defcol, read off the element itself — never off where it sits, since a
  // repaint may already have detached it.
  const at = (el: HTMLElement) => Number(el.dataset.defcol);
  const setFmt = (el: HTMLElement, patch: Partial<NonNullable<ScheduleDef['columns'][number]['format']>>) =>
    updateDef((def) => act.setColumnFormat(def, at(el), patch));

  liveText(root, '[data-act="fmt-heading"]', (def, v, el) => act.setHeading(def, at(el), v));
  onClick(root, '[data-act="fmt-align"]', (el) => updateDef((def) =>
    act.setAlign(def, at(el), el.dataset.v as 'left' | 'center' | 'right')));
  // Same reasoning as the Width box below: `change` alone — Enter, or leaving the field — so
  // typing never reformats the table mid-number, since the box is re-rendered from what was
  // stored. An empty box means "no choice made": `undefined`, which both readers fall back
  // from with `?? defaultDecimals(kind)`. The old per-keystroke handler could not say that —
  // a number input hands back '' for an empty box AND for junk, `Number('')` is 0, so
  // clearing it silently pinned the column to 0 decimals with no way back to its default.
  onChange(root, '[data-act="fmt-decimals"]', (el) => {
    const n = num(el);
    setFmt(el, { decimals: text(el).trim() === '' || !Number.isFinite(n) ? undefined : clampDecimals(n) });
  });
  onChange(root, '[data-act="fmt-thousands"]', (el) => setFmt(el, { thousands: checked(el) }));
  onChange(root, '[data-act="fmt-symbol"]', (el) => setFmt(el, { showSymbol: checked(el) }));
  onChange(root, '[data-act="fmt-suppress"]', (el) => setFmt(el, { suppressZero: checked(el) }));
  onChange(root, '[data-act="fmt-bool"]', (el) => setFmt(el, { boolStyle: text(el) as never }));
  // The box commits on `change` alone — Enter, or leaving the field — so typing never
  // reformats the table mid-number: the box is re-rendered from the stored width, and
  // applying each keystroke rewrote "1" to "30" before the second digit arrived. Both clamps
  // land at that one commit. The range comes from colResize.ts, which owns it — the drag and
  // the box's own hint are the same numbers.
  onChange(root, '[data-act="fmt-width"]', (el) => updateDef((def) =>
    act.setWidths(def, [[at(el), num(el) > 0 ? clampWidth(num(el)) : undefined]])));

  // conditional colour rules
  // Seeded with BOTH colours, so a new rule visibly does something the moment its value
  // matches. With a fill and no text colour it inherited the cell's, which is the one
  // combination the presets exist to stop anyone choosing by accident.
  onClick(root, '[data-act="cond-add"]', (el) => updateDef((def) => act.addConditionalRule(def, at(el))));
  onClick(root, '[data-act="cond-remove"]', (el) => {
    updateDef((def) => act.removeConditionalRule(def, at(el), idx(el)));
    // Every rule after the removed one moved down a slot, so the preview would now be of a
    // different rule. Dropped wholesale, exactly as filter-remove drops removedBy.
    if (state.litBy !== null) update({ litBy: null });
  });
  const setRule = (def: ScheduleDef, el: HTMLElement, patch: Partial<CondRule>) =>
    act.updateConditionalRule(def, at(el), idx(el), patch);
  // Fill and text together in one updateDef, so a preset is one undo step and never lands
  // as a half-applied pair.
  onClick(root, '[data-act="cond-preset"]', (el) => updateDef((def) =>
    setRule(def, el, { bg: el.dataset.bg, fg: el.dataset.fg })));
  onChange(root, '[data-act="cond-op"]', (el) => updateDef((def) =>
    setRule(def, el, { op: text(el) as CondRule['op'] })));
  liveText(root, '[data-act="cond-value"]', (def, v, el) => setRule(def, el, { value: v }));
  onInput(root, '[data-act="cond-bg"]', (el) => updateDef((def) => setRule(def, el, { bg: text(el) }), 'table'));
  onInput(root, '[data-act="cond-fg"]', (el) => updateDef((def) => setRule(def, el, { fg: text(el) }), 'table'));
  onChange(root, '[data-act="cond-bold"]', (el) => updateDef((def) => setRule(def, el, { bold: checked(el) })));

  // Show the rows one colour rule claims, and the way back. The rule names its column on
  // itself, like every other control in the menu.
  onClick(root, '[data-act="cond-show"]', (el) => {
    const target = { col: at(el), rule: idx(el) };
    const same = state.litBy?.col === target.col && state.litBy.rule === target.rule;
    update({ litBy: same ? null : target, removedBy: null });
  });
  onClick(root, '[data-act="clear-lit"]', () => update({ litBy: null }));
}

// ---------------------------------------------------------------- appearance

function wireAppearance(root: HTMLElement) {
  liveText(root, '[data-act="app-title"]', (def, v) => act.setAppearance(def, { title: v }));
  const toggle = (name: string, key: 'showTitle' | 'gridLines' | 'outline' | 'blankRowBeforeData' | 'zebra' | 'headerBold') =>
    onChange(root, `[data-act="${name}"]`, (el) => updateDef((def) => act.setAppearance(def, { [key]: checked(el) })));
  toggle('app-showtitle', 'showTitle');
  toggle('app-grid', 'gridLines');
  toggle('app-outline', 'outline');
  toggle('app-blankfirst', 'blankRowBeforeData');
  toggle('app-zebra', 'zebra');
  toggle('app-headerbold', 'headerBold');
  // Full repaint, not 'table': the Style popover shows a note about the chosen face.
  onChange(root, '[data-act="app-font"]', (el) =>
    updateDef((def) => act.setAppearance(def, { bodyFont: text(el) })));
  onInput(root, '[data-act="app-fontsize"]', (el) =>
    updateDef((def) => act.setAppearance(def, { fontSize: clamp(num(el), 8, 24) })));
}

// ---------------------------------------------------------------- view bar

// The chips at the top of the centre column. Their controls' acts are wired by concern
// (filter, sorting, appearance); what is wired here is opening them and the two "+" field
// lists.
function wireViewBar(root: HTMLElement) {
  onClick(root, '[data-act="vb-open"]', (el) => {
    const kind = el.dataset.v ?? '';
    toggleChip(kind, el.dataset.i === undefined ? undefined : idx(el), el.dataset.id);
    // The picker opens fresh: nothing typed, nothing ticked.
    if ((kind === 'picker' || kind === 'add-filter' || kind === 'add-sort') && openChip()?.kind === kind) resetPicker(kind);
    paintPopover();
  });
  // "+ Filter" and "+ Sort / group" pick a field and land in that rule's or level's own
  // popover: addFilterRule + setFilterField, or addSortLevel + setSortField. Both adds are
  // no-ops at the cap.
  onClick(root, '[data-act="vb-add"]', (el) => addFrom(el.dataset.v ?? '', el.dataset.id ?? ''));
  wirePicker(root);
}

/** A single-pick picker row (or Enter on it): a new filter rule or sort level on that field. */
function addFrom(kind: string, id: string) {
  const f = fieldFromKey(id);
  if (!f) return;
  if (kind === 'filter') {
    if (state.def.filters.length >= MAX_FILTERS) return;
    openChipPopover('filter', state.def.filters.length);
    updateDef((def) => {
      const next = act.addFilterRule(def);
      return act.setFilterField(next, next.filters.length - 1, f);
    });
    return;
  }
  if (state.def.sort.length >= MAX_SORT_LEVELS) return;
  openChipPopover('sort', state.def.sort.length);
  updateDef((def) => {
    const next = act.addSortLevel(def);
    return act.setSortField(next, next.sort.length - 1, f);
  });
}

// ---------------------------------------------------------------- field picker

// The picker's own controls (fieldPicker.ts holds what is typed and ticked). Typing,
// ticking and moving the highlight redraw only its list, in place — the search box is never
// rebuilt by them. Adding the ticked fields is one addColumns, through the same columnFor as
// every other hand-added column.
function wirePicker(root: HTMLElement) {
  const search = () => root.querySelector<HTMLInputElement>('#popover [data-act="pick-search"]');
  const commit = () => {
    const fields = pickedIds().map(fieldFromKey).filter((f): f is FieldRef => !!f);
    if (!fields.length) return;
    clearPicks();
    closePopover();
    updateDef((def) => act.addColumns(def, fields.map((f) => columnFor(def, f))));
  };

  onInput(root, '[data-act="pick-search"]', (el) => { setQuery(text(el)); refreshPicker(); });
  root.addEventListener('keydown', (e) => {
    const box = e.target as HTMLInputElement;
    if (box.dataset?.act !== 'pick-search') return;
    const k = pickerKey(e.key, e.ctrlKey || e.metaKey, box);
    if (!k) return;
    e.preventDefault();
    if (k.kind === 'redraw') refreshPicker();
    else if (k.kind === 'commit') commit();
    else if (k.kind === 'moved') return;
    else addFrom(pickerMode() === 'add-filter' ? 'filter' : 'sort', k.id);
  });
  // Hovering a row previews it in the strip; leaving the list hands the strip back to the
  // keyboard highlight. Only the strip is rewritten — never the list, never the table.
  root.addEventListener('mouseover', (e) => {
    const t = e.target as HTMLElement;
    const row = t.closest?.<HTMLElement>('#popover .prow, #popover .crow');
    if (row) hoverPeek(peekKey(row));
    // A section heading, "N more" or the empty-fields link: no row to preview.
    else if (t.closest?.('#popover .pick-list')) hoverPeek(null);
  });
  root.addEventListener('mouseout', (e) => {
    const list = (e.target as HTMLElement).closest?.('#popover .pick-list');
    if (list && !list.contains(e.relatedTarget as Node | null)) hoverPeek(null);
  });
  // A tick keeps the keyboard in the search box, so the next name can be typed at once.
  onClick(root, '[data-act="pick-toggle"]', (el) => { toggleTick(el.dataset.id ?? ''); refreshPicker(); search()?.focus(); });
  onClick(root, '[data-act="pick-commit"]', commit);
  onClick(root, '[data-act="pick-view"]', (el) => { setView(el.dataset.v ?? ''); paintPopover(); search()?.focus(); });
  onClick(root, '[data-act="pick-fold"]', (el) => { toggleFold(el.dataset.pset ?? ''); refreshPicker(); });
  onClick(root, '[data-act="pick-empty"]', () => { toggleEmpty(); refreshPicker(); search()?.focus(); });
  // A row in "In this table": go to the column — or, for a hidden one, open its menu.
  onClick(root, '[data-act="pick-jump"]', (el) => {
    const i = idx(el);
    if (!state.def.columns[i]) return;
    if (state.def.columns[i].hidden) { openHiddenColumnMenu(i); paintPopover(); return; }
    closePopover();
    const th = root.querySelector<HTMLElement>(`#output-pane th[data-defcol="${i}"]`);
    th?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    th?.focus({ preventScroll: true });
  });
  // "+ Calculated value": a new formula, finished in the calculated-value editor's modal —
  // the same flow as that modal's own "Add formula".
  onClick(root, '[data-act="pick-calc"]', () => {
    closePopover();
    updateDef((def) => act.addCalculated(def, 'formula'));
    update({ overlay: 'calc' });
  });
  // "/" (when not typing) or Ctrl+K anywhere opens the picker at its chip.
  window.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement)?.tagName ?? '');
    const ctrlK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k';
    if (!ctrlK && !(e.key === '/' && !typing && !e.ctrlKey && !e.metaKey)) return;
    // Not over a modal, the window's dialog or its right-click menu — they are on top, and
    // own the keyboard.
    if (!state.store || state.overlay || dialogOpen() || menuOpen()) return;
    e.preventDefault();
    // Already open: go back to its search, keeping what is typed and ticked.
    if (openChip()?.kind === 'picker') { search()?.focus(); return; }
    openChipPopover('picker', undefined, true, 'chip');
    resetPicker('picker');
    paintPopover();
  });
}

// ---------------------------------------------------------------- column menu

// The menu's own buttons. The rest of its controls (heading, decimals box, align, width, the
// switches, the colour rules) are wired in wireFormat and reach the column through
// data-defcol. What is here composes existing actions — none of it is new schedule logic.
// Each repaints synchronously from its own handler, as every other control does; nothing
// re-tests its target, and the popover's outside-click is decided at pointerdown, so a
// repaint inside the dispatch closes nothing.
function wireColumnMenu(root: HTMLElement) {
  const col = (el: HTMLElement) => Number(el.dataset.defcol);
  const setFmt = (el: HTMLElement, patch: Partial<NonNullable<ScheduleDef['columns'][number]['format']>>) =>
    updateDef((def) => act.setColumnFormat(def, col(el), patch));

  onClick(root, '[data-act="cm-unit"]', (el) => setFmt(el, { display: el.dataset.v }));
  onClick(root, '[data-act="cm-total"]', (el) => updateDef((def) =>
    act.setTotal(def, col(el), (el.dataset.v || null) as TotalKind | null)));
  onClick(root, '[data-act="cm-orient"]', (el) => updateDef((def) =>
    act.setHeadingOrientation(def, col(el), el.dataset.v === 'vertical' ? 'vertical' : 'horizontal')));
  // One step from what the column shows now — its stored count, or the default it falls
  // back to, exactly as the decimals box beside it reads.
  onClick(root, '[data-act="cm-dec"]', (el) => updateDef((def) => {
    const c = def.columns[col(el)];
    if (!c || !state.store) return def;
    const now = c.format?.decimals ?? defaultDecimals(kindOf(state.store, def, c.field));
    return act.setColumnFormat(def, col(el), { decimals: clampDecimals(now + Number(el.dataset.v)) });
  }));

  // Sort or group by this column: the level that already sorts by its field, or a new one.
  // addSortLevel is a no-op at the cap, which is checked first so it can be said.
  const levelFor = (def: ScheduleDef, i: number): [ScheduleDef, number] => {
    const key = act.fieldKey(def.columns[i].field);
    const k = def.sort.findIndex((l) => act.fieldKey(l.field) === key);
    if (k >= 0) return [def, k];
    const added = act.addSortLevel(def);
    return [act.setSortField(added, added.sort.length - 1, def.columns[i].field), added.sort.length - 1];
  };
  const hasLevel = (i: number) => state.def.sort.some((l) => act.fieldKey(l.field) === act.fieldKey(state.def.columns[i].field));
  const atCap = (i: number) => {
    if (hasLevel(i) || state.def.sort.length < MAX_SORT_LEVELS) return false;
    flash(`${MAX_SORT_LEVELS} sort levels is the most a schedule holds — remove one first.`, true);
    return true;
  };
  onClick(root, '[data-act="cm-sort"]', (el) => {
    const i = col(el);
    if (!state.def.columns[i] || atCap(i)) return;
    updateDef((def) => {
      const [next, k] = levelFor(def, i);
      return act.setSortDir(next, k, el.dataset.v === 'desc' ? 'desc' : 'asc');
    });
  });
  // Grouped = a level with a header or a footer. Ungrouping keeps the sort.
  onClick(root, '[data-act="cm-group"]', (el) => {
    const i = col(el);
    if (!state.def.columns[i] || atCap(i)) return;
    updateDef((def) => {
      const [next, k] = levelFor(def, i);
      const l = next.sort[k];
      const grouped = !!l.header || (l.footer ?? 'none') !== 'none';
      return act.setGroupOptions(next, k, grouped
        ? { header: false, footer: 'none', blankLine: false }
        : { header: true, footer: 'titleCountTotals' });
    });
  });
  // A new rule on this field, finished in its own chip's popover.
  onClick(root, '[data-act="cm-filter"]', (el) => {
    const i = col(el);
    if (!state.def.columns[i]) return;
    if (state.def.filters.length >= MAX_FILTERS) {
      flash(`${MAX_FILTERS} filter rules is the most a schedule holds.`, true);
      return;
    }
    // The new rule's own chip popover replaces the menu, anchored at its chip.
    openChipPopover('filter', state.def.filters.length);
    updateDef((def) => {
      const next = act.addFilterRule(def);
      return act.setFilterField(next, next.filters.length - 1, def.columns[i].field);
    });
  });
  onClick(root, '[data-act="cm-show"]', (el) => updateDef((def) => act.setHidden(def, col(el), false)));
  // Also the Hide / Show on an "In this table" row in the field picker.
  onClick(root, '[data-act="cm-hide"]', (el) => updateDef((def) => act.setHidden(def, col(el), true)));
  // The menu follows the column it moved, and so does everything else that names a position.
  onClick(root, '[data-act="cm-move"]', (el) => {
    const from = col(el);
    const to = from + Number(el.dataset.v);
    if (!act.canMove(state.def.columns.length, from, to)) return;
    followColumn(to);
    state.selectedColumn = to;
    state.selectedCols = [];
    state.litBy = null;
    updateDef((def) => act.moveColumn(def, from, to));
  });
  onClick(root, '[data-act="cm-view"]', (el) => { setMenuView(el.dataset.v ?? ''); paintPopover(); });
  onClick(root, '[data-act="cm-more"]', () => { toggleMore(); paintPopover(); });
}

// ---------------------------------------------------------------- calculated values

function wireCalculated(root: HTMLElement) {
  const byId = (el: HTMLElement) => el.dataset.id ?? '';
  onClick(root, '[data-act="calc-add-formula"]', () => updateDef((def) => act.addCalculated(def, 'formula')));
  onClick(root, '[data-act="calc-add-percent"]', () => updateDef((def) => act.addCalculated(def, 'percentage')));

  // A column pointing at a deleted calculation would render blank forever, so it goes too.
  onClick(root, '[data-act="calc-remove"]', (el) => updateDef((def) => act.removeCalculated(def, byId(el))));
  liveText(root, '[data-act="calc-name"]', (def, v, el) => act.updateCalculated(def, byId(el), { name: v }));
  liveText(root, '[data-act="calc-formula"]', (def, v, el) => act.updateCalculated(def, byId(el), { formula: v }));
  onChange(root, '[data-act="calc-of"]', (el) => updateDef((def) => {
    const f = fieldFromKey(text(el));
    return f ? act.updateCalculated(def, byId(el), { ofField: f }) : def;
  }));
  // What the result measures. Not inferred: `Width * 2` is a length and `Width * Height` is
  // an area, and the parser cannot tell them apart — so the author says, and the column then
  // converts SI to whatever display unit is wanted, like every other numeric column.
  // One dropdown, one question: what IS this result? "yes or no" and "text" are answers to
  // that same question, so they live in the same control — and only one can be true.
  //
  // The only writer of the three fields that answer it. `yesNo` is cleared rather than
  // mirrored: keeping a second copy in step is a promise every future edit would have to
  // remember, and resultOf() already reads the old flag for schedules saved before this.
  // Saying what the result is re-decides how the column reads: words left, a yes/no
  // centred, a number right. It overrides an alignment picked by hand, and should — the
  // declaration is the stronger statement, and the column menu can still say otherwise.
  onChange(root, '[data-act="calc-kind"]', (el) =>
    updateDef((def) => act.setCalculatedResult(def, byId(el), text(el))));
  // One click to accept what the expression works out to, rather than making the author
  // find the same answer again in the dropdown next to it.
  onClick(root, '[data-act="calc-kind-accept"]', (el) => updateDef((def) => {
    const c = def.calculated?.find((x) => x.id === byId(el));
    const k = c?.formula && state.store ? dimensionOf(c.formula, kindsByHeading(state.store, def)).kind : null;
    return c && k ? act.setCalculatedUnitKind(def, c.id, k as UnitKind) : def;
  }));
}
