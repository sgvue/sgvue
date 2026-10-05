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

import {
  alignForCalc, columnForCore, columnForProp, defaultColumnsFor,
} from '../../schedule/schedule/columns';
import {
  emptySchedule, headingOf,
  type CondRule, type FilterRule, type SortLevel, type TotalKind,
} from '../../schedule/schedule/def';
import { clampDecimals } from '../../schedule/schedule/format';
import { presetById } from '../../schedule/schedule/presets';
import { dimensionOf } from '../../schedule/schedule/formula';
import {
  applyTemplate, askDeleteSaved, duplicateSaved, loadSaved, printSchedule, renameSaved, saveCurrent,
  stepHistory,
} from './actions';
import { later } from './pending';
import { editDef, state, update, updateDef, type AppState, type Section } from './state';
import { clampWidth, fitAll, naturalWidths } from './colResize';
import { moveItem, wireReorder } from './dnd';
import { confirmDialog, dialogOpen, promptDialog } from './dialog';
import { menuOpen, openMenu } from './menu';
import { EXPORT_ACTIONS, exportScheduleFile, openScheduleFile } from './exporting';
import { clamp, onChange, onClick, onInput } from './dom';
import { fieldFromKey, fieldKey, kindOf, kindsByHeading, newId, selectedIndex, statOf, storeNum } from './panels';
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

/** What a typed box writes to, resolved when the key is pressed: the rule, the column, the def. */
type Bind = (el: HTMLElement) => ((value: string) => void) | null | undefined;

/**
 * Text inputs repaint everything, because a panel's own text can depend on what was typed
 * (a rule's "removes 353", a formula's error). main.ts restores focus and caret around the
 * repaint, so it still behaves like an ordinary text box.
 *
 * SGVue (2026-09-25): `bind` resolves the edit's TARGET at input time, and the edit waits in
 * pending.ts — the one pending edit, which lands before any other box's input, when focus
 * leaves this box, and before any click or key action. ifcTable's per-selector timers lost
 * or misplaced text three ways (pending.ts lists them).
 */
function liveText(root: HTMLElement, selector: string, bind: Bind, scope: 'all' | 'table' = 'all') {
  onInput(root, selector, (el) => {
    const write = bind(el);
    if (!write) return;
    const value = text(el);
    later(el, () => editDef(() => write(value)), scope, 200);
  });
}

/**
 * The same shape for a box that filters a list rather than editing the schedule: straight
 * into AppState, no undo entry, and 150ms because the only cost of a keystroke here is a
 * repaint — of the panes only, never the schedule, which a search cannot change.
 */
function liveState(
  root: HTMLElement, selector: string,
  key: 'railQuery' | 'fieldSearch' | 'templateQuery' | 'savedQuery',
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
  wireReorder(root, (kind, from, to) => updateDef((def) => {
    const list = kind === 'lvl' ? def.sort : def.columns;
    if (!moveItem(list, from, to)) return;
    if (kind !== 'col') return;
    // The formatting section follows the column the user just moved.
    if (state.selectedColumn === from) state.selectedColumn = to;
    // Every index between `from` and `to` shifted, so a header selection built on the old
    // positions would now mark — and resize — the wrong columns. The colour preview holds
    // a column index too, and would narrow the table by whatever slid into that slot.
    state.selectedCols = [];
    state.litBy = null;
  }));
  wireOverlays(root);
  wireFields(root);
  wireFilter(root);
  wireSort(root);
  wireFormat(root);
  wireAppearance(root);
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

  // ---- inspector tabs ----
  // A tab click also reopens a collapsed panel — the icon strip's icons are these same
  // controls, so the way back in is one click, not an open followed by a pick.
  onClick(root, '[data-act="section"]', (el) => {
    const section = el.dataset.section as Section;
    // Column formatting always works on a concrete column, so opening it selects one.
    const selectedColumn = section === 'format' && state.selectedColumn === null && state.def.columns.length
      ? 0 : state.selectedColumn;
    update({ open: section, inspectorOpen: true, selectedColumn });
  });
  onClick(root, '[data-act="panel-toggle"]', () => update({ inspectorOpen: !state.inspectorOpen }));

  // ---- rail ----
  liveState(root, '[data-act="rail-query"]', 'railQuery');
  onClick(root, '[data-act="rail-sort"]', () => update({ railSort: state.railSort === 'name' ? 'count' : 'name' }, 'panes'));

  onClick(root, '[data-act="category"]', (el) => {
    const entity = el.dataset.entity ?? '';
    const store = state.store;
    if (!store || state.def.entity.includes(entity)) return;
    ifReplaceOk(() => update({
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
    }));
  });

  liveText(root, '[data-act="name"]', () => {
    const def = state.def;
    return (v) => { def.name = v; };
  }, 'table');

  // ---- table ----
  // data-defcol, not data-i: a header carries where its column sits in def.columns, which
  // is not the same as its position among the visible headers once one is hidden.
  //
  // The two modifiers mean what they mean everywhere else: Ctrl (Cmd) adds or removes one
  // column, Shift takes the whole run from the anchor to here. Neither opens Format — the
  // point of the gesture is what happens next at the grip, where main.ts hands the
  // selection to the resizer as its group. A plain click clears the marks and formats.
  //
  // Both branches repaint at 'all', not 'table': the centre head's Equal width button is
  // enabled by this selection, and the centre head only renders on an 'all' pass — at
  // 'table' the button would keep claiming whatever the previous selection made true. The
  // cost is nothing: a full rebuild measures ~0.03ms (LESSONS.md), and preserveUi restores
  // focus, caret and scroll around every repaint.
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
      // The last mark is the anchor; failing that, the column Format is on. An anchor that
      // is hidden or no longer there names no run, so the click stands alone.
      const anchor = state.selectedCols.at(-1) ?? state.selectedColumn ?? i;
      const from = visible.indexOf(anchor);
      const to = visible.indexOf(i);
      const picked = from < 0 || to < 0
        ? [i] : visible.slice(Math.min(from, to), Math.max(from, to) + 1);
      update({ selectedCols: picked });
      return;
    }
    update({ selectedColumn: i, selectedCols: [], open: 'format', inspectorOpen: true });
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
    updateDef((def) => {
      for (const [i, w] of widths) if (def.columns[i]) def.columns[i].width = w;
    });
  });

  // "Make these look like that one." The marked columns take the width of the column the
  // Format tab is editing — `selectedIndex`, column-0 fallback and all, which is the same
  // answer the panel's header and the table's editing mark already give, so the source is a
  // column the user can see named in two places. Its own width is read first and measured
  // only if it has none; the source itself is never written, whether or not it is marked.
  // Clipping is not a risk: a column with a width wraps, by the rule in tableView.
  //
  // The guards repeat what disables the button in centre.ts, because a handler may not trust
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
    // marked column, which is what this button did before it took its width from Format.
    const measured = naturalWidths(table, [src, ...picked]);
    const source = state.def.columns[src]?.width
      ?? measured.find((c) => c.i === src)?.px
      ?? measured.filter((c) => picked.includes(c.i)).reduce((m, c) => Math.max(m, c.px), 0);
    if (!source) return;
    const w = clampWidth(Math.ceil(source));
    updateDef((def) => {
      for (const i of picked) if (def.columns[i]) def.columns[i].width = w;
    });
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
    ifReplaceOk(() => { loadSaved(entry); });
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
  // A focused heading: the ContextMenu key or Shift+F10 opens its menu, under it — the
  // keyboard's route to "Colour 3D by this column". Enter or Space is its click (phase 4),
  // with the click's own modifiers: Shift takes the run, Ctrl / ⌘ adds or removes one.
  root.addEventListener('keydown', (e) => {
    const th = (e.target as HTMLElement).closest?.<HTMLElement>('th[data-defcol]');
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
  onClick(root, '[data-act="open-fields"]', () => update({ overlay: 'fields' }));
  onClick(root, '[data-act="open-templates"]', () => update({ overlay: 'templates' }));
  onClick(root, '[data-act="open-saved"]', () => update({ overlay: 'saved' }));
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
  // dialog (dialog.ts) owns Escape while it is open.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || dialogOpen()) return;
    // The syntax guide is opened from the field browser, so Escape goes back there.
    if (state.overlay === 'formula') { update({ overlay: 'fields' }); return; }
    if (state.overlay) { update({ overlay: null }); return; }
    // 'all', for the same reason as the two selection branches in wireShell: clearing the
    // marks also disables the centre head's Equal width button, and the centre head is only
    // drawn on a full pass. A rebuild is ~0.03ms and preserveUi keeps focus and caret.
    if (state.selectedCols.length) update({ selectedCols: [] });
  });

  // ---- field browser ----
  liveState(root, '[data-act="field-search"]', 'fieldSearch');
  // A list filter cannot change the schedule, so only the panes repaint ('panes', state.ts).
  onClick(root, '[data-act="field-type"]', (el) =>
    update({ fieldType: el.dataset.type as AppState['fieldType'] }, 'panes'));
  onClick(root, '[data-act="field-pset"]', (el) => update({ fieldPset: el.dataset.pset ?? 'all' }, 'panes'));
  onChange(root, '[data-act="hide-empty"]', (el) => update({ hideEmpty: checked(el) }, 'panes'));

  onClick(root, '[data-act="browse-add"]', (el) => {
    const f = fieldFromKey(el.dataset.id ?? '');
    if (!f) return;
    // A column added by hand defaults the same way one the app generated does: in the
    // model's own system of units.
    const system = state.store?.meta.unitSystem;
    updateDef((def) => {
      if (f.kind === 'core') def.columns.push(columnForCore(f.key, system));
      else if (f.kind === 'prop') {
        const stat = state.store && statOf(state.store, def, f);
        def.columns.push(stat ? columnForProp(stat, system) : { field: f });
      } else {
        // Aligned by what the calculated value says it holds. This used to be a flat
        // 'right', from when a formula could only ever be a number — which left a column
        // of the word "Small" hard against the right-hand rule.
        def.columns.push({ field: f, align: alignForCalc(def.calculated?.find((c) => c.id === f.id)) });
      }
    });
  });
  onClick(root, '[data-act="browse-remove"]', (el) => {
    const id = el.dataset.id ?? '';
    updateDef((def) => { def.columns = def.columns.filter((c) => fieldKey(c.field) !== id); });
    update({ selectedColumn: null, selectedCols: [] });
  });

  // ---- template gallery ----
  liveState(root, '[data-act="template-search"]', 'templateQuery');
  onClick(root, '[data-act="apply-template"]', (el) => {
    const preset = presetById(el.dataset.id ?? '');
    if (!preset) return;
    ifReplaceOk(() => applyTemplate(preset));
  });
}

// ---------------------------------------------------------------- fields

function wireFields(root: HTMLElement) {
  onClick(root, '[data-act="select-col"]', (el) =>
    update({ selectedColumn: idx(el), open: 'format' }));

  onClick(root, '[data-act="col-remove"]', (el) => {
    const i = idx(el);
    // Asked BEFORE the shift below, never after: a column that merely slides down into slot
    // `i` would otherwise answer yes and be cleared in place of the one actually removed.
    const wasEditing = state.selectedColumn === i;
    // Every index after this one shifts down, so a header selection made against the old
    // positions is meaningless. Cleared before the repaint, not after, or one paint marks
    // the wrong headings.
    state.selectedCols = [];
    // Same currency, same deadline. A Format selection sitting to the RIGHT of the removed
    // column named its neighbour once the list closed up, and the table now marks the column
    // Format is editing — so a shift left until after the repaint highlights the wrong one.
    if (state.selectedColumn !== null && state.selectedColumn > i) state.selectedColumn -= 1;
    updateDef((def) => { def.columns.splice(i, 1); });
    if (wasEditing) update({ selectedColumn: null });
  });

  onChange(root, '[data-act="remap"]', (el) => {
    const key = text(el);
    const i = idx(el);
    const dot = key.indexOf('.');
    if (!key || dot < 0) return;
    updateDef((def) => {
      const col = def.columns[i];
      if (!col) return;
      // Keep the heading so the schedule still reads as the user labelled it.
      col.heading = col.heading ?? headingOf(col, def);
      col.field = { kind: 'prop', pset: key.slice(0, dot), prop: key.slice(dot + 1) };
    });
  });
}

// ---------------------------------------------------------------- filter

function wireFilter(root: HTMLElement) {
  onClick(root, '[data-act="filter-add"]', () => updateDef((def) => {
    const first = def.columns[0]?.field ?? { kind: 'core', key: 'name' } as const;
    def.filters.push({ field: first, op: 'hasValue' } as FilterRule);
  }));
  onClick(root, '[data-act="filter-remove"]', (el) => {
    const i = idx(el);
    updateDef((def) => { def.filters.splice(i, 1); });
    if (state.removedBy !== null) update({ removedBy: null });
  });
  // A segmented pair, not a select — data-v carries which side was clicked.
  onClick(root, '[data-act="filter-logic"]', (el) =>
    updateDef((def) => { def.filterLogic = el.dataset.v === 'or' ? 'or' : 'and'; }));
  onChange(root, '[data-act="filter-field"]', (el) => updateDef((def) => {
    const f = fieldFromKey(text(el));
    if (!f) return;
    // The old value may be meaningless against a different field, so clear it.
    def.filters[idx(el)] = { field: f, op: 'hasValue' };
  }));
  onChange(root, '[data-act="filter-op"]', (el) => updateDef((def) => {
    const rule = def.filters[idx(el)];
    rule.op = text(el) as FilterRule['op'];
    if (rule.op !== 'in' && rule.op !== 'between') rule.values = undefined;
  }));

  // The rule a value box writes to, and how, resolved when the key is pressed.
  const valueTo: Bind = (el) => {
    const rule = state.def.filters[idx(el)];
    const store = state.store;
    if (!rule || !store) return null;
    const kind = kindOf(store, state.def, rule.field);
    const numeric = (el as HTMLInputElement).type === 'number';
    return (raw) => {
      const n = storeNum(raw, kind, store.meta.unitSystem);
      // Numeric boxes hold display units; store SI so comparisons stay honest.
      rule.value = raw !== '' && n !== undefined && numeric ? n : raw;
    };
  };
  liveText(root, 'input[data-act="filter-value"]', valueTo);
  onChange(root, 'select[data-act="filter-value"]', (el) => {
    const write = valueTo(el);
    if (write) updateDef(() => write(text(el)));
  });

  const rangeTo = (slot: 0 | 1): Bind => (el) => {
    const rule = state.def.filters[idx(el)];
    const store = state.store;
    if (!rule || !store) return null;
    const kind = kindOf(store, state.def, rule.field);
    return (raw) => {
      const vals = [...(rule.values ?? [])] as (string | number)[];
      vals[slot] = storeNum(raw, kind, store.meta.unitSystem) ?? 0;
      rule.values = vals;
    };
  };
  liveText(root, '[data-act="filter-lo"]', rangeTo(0));
  liveText(root, '[data-act="filter-hi"]', rangeTo(1));

  liveText(root, '[data-act="filter-values"]', (el) => {
    const rule = state.def.filters[idx(el)];
    return rule && ((v) => { rule.values = v.split(',').map((s) => s.trim()).filter(Boolean); });
  });

  onClick(root, '[data-act="show-removed"]', (el) => {
    const i = idx(el);
    // Two narrowings of the same table would each describe rows the other had already
    // taken away, so arming one disarms the other.
    update({ removedBy: state.removedBy === i ? null : i, litBy: null });
  });
}

// ---------------------------------------------------------------- sorting

function wireSort(root: HTMLElement) {
  // A new level sorts and nothing else: Header row, Footer and Blank line all start off.
  // Seeding `header: true` decided for the user, and the group heading it inserted read as
  // something the app had done to their schedule rather than something they asked for. The
  // hand-authored templates in schedule/presets.ts still set their own headers.
  onClick(root, '[data-act="sort-add"]', () => updateDef((def) => {
    const first = def.columns[0]?.field ?? { kind: 'core', key: 'name' } as const;
    def.sort.push({ field: first, dir: 'asc' } as SortLevel);
  }));
  onClick(root, '[data-act="sort-remove"]', (el) =>
    updateDef((def) => { def.sort.splice(idx(el), 1); }));
  onChange(root, '[data-act="sort-field"]', (el) => updateDef((def) => {
    const f = fieldFromKey(text(el));
    if (f) def.sort[idx(el)].field = f;
  }));
  onClick(root, '[data-act="sort-dir"]', (el) =>
    updateDef((def) => { def.sort[idx(el)].dir = el.dataset.v === 'desc' ? 'desc' : 'asc'; }));
  onChange(root, '[data-act="sort-header"]', (el) =>
    updateDef((def) => { def.sort[idx(el)].header = checked(el); }));
  onChange(root, '[data-act="sort-blank"]', (el) =>
    updateDef((def) => { def.sort[idx(el)].blankLine = checked(el); }));
  // The chip is on/off; the select underneath chooses what an enabled footer shows.
  onChange(root, '[data-act="sort-footer"]', (el) =>
    updateDef((def) => { def.sort[idx(el)].footer = checked(el) ? 'titleCountTotals' : 'none'; }));
  onChange(root, '[data-act="sort-footer-style"]', (el) =>
    updateDef((def) => { def.sort[idx(el)].footer = text(el) as SortLevel['footer']; }));
  onChange(root, '[data-act="itemize"]', (el) =>
    updateDef((def) => { def.itemize = checked(el); }));
  onChange(root, '[data-act="grand-total"]', (el) =>
    updateDef((def) => { def.grandTotal = checked(el); }));
  liveText(root, '[data-act="grand-title"]', () => {
    const def = state.def;
    return (v) => { def.grandTotalTitle = v; };
  });
}

// ---------------------------------------------------------------- formatting

function wireFormat(root: HTMLElement) {
  const col = () => state.def.columns[selectedIndex(state)] ?? null;
  const fmt = () => {
    const c = col();
    if (!c) return null;
    c.format = c.format ?? {};
    return c.format;
  };

  onChange(root, '[data-act="fmt-col"]', (el) => update({ selectedColumn: Number(text(el)) }));

  // The column being formatted NOW, not whichever one is when the edit lands.
  liveText(root, '[data-act="fmt-heading"]', () => {
    const c = col();
    return c && ((v) => { c.heading = v; });
  });
  onChange(root, '[data-act="fmt-orient"]', (el) => updateDef(() => {
    const c = col(); if (c) c.headingOrientation = text(el) === 'vertical' ? 'vertical' : 'horizontal';
  }));
  onClick(root, '[data-act="fmt-align"]', (el) => updateDef(() => {
    const c = col(); if (c) c.align = el.dataset.v as 'left' | 'center' | 'right';
  }));
  onChange(root, '[data-act="fmt-unit"]', (el) => updateDef(() => {
    const f = fmt(); if (f) f.display = text(el);
  }));
  // Same reasoning as the Width box below: `change` alone — Enter, or leaving the field — so
  // typing never reformats the table mid-number, since the box is re-rendered from what was
  // stored. An empty box means "no choice made": `undefined`, which both readers fall back
  // from with `?? defaultDecimals(kind)`. The old per-keystroke handler could not say that —
  // a number input hands back '' for an empty box AND for junk, `Number('')` is 0, so
  // clearing it silently pinned the column to 0 decimals with no way back to its default.
  onChange(root, '[data-act="fmt-decimals"]', (el) => updateDef(() => {
    const f = fmt();
    if (!f) return;
    const n = num(el);
    f.decimals = text(el).trim() === '' || !Number.isFinite(n) ? undefined : clampDecimals(n);
  }));
  onChange(root, '[data-act="fmt-thousands"]', (el) => updateDef(() => {
    const f = fmt(); if (f) f.thousands = checked(el);
  }));
  onChange(root, '[data-act="fmt-symbol"]', (el) => updateDef(() => {
    const f = fmt(); if (f) f.showSymbol = checked(el);
  }));
  onChange(root, '[data-act="fmt-suppress"]', (el) => updateDef(() => {
    const f = fmt(); if (f) f.suppressZero = checked(el);
  }));
  onChange(root, '[data-act="fmt-bool"]', (el) => updateDef(() => {
    const f = fmt(); if (f) f.boolStyle = text(el) as never;
  }));
  onChange(root, '[data-act="fmt-total"]', (el) => updateDef(() => {
    const c = col(); if (c) c.total = (text(el) || null) as TotalKind | null;
  }));
  // The box commits on `change` alone — Enter, or leaving the field — so typing never
  // reformats the table mid-number: the box is re-rendered from the stored width, and
  // applying each keystroke rewrote "1" to "30" before the second digit arrived. Both clamps
  // land at that one commit. The range comes from colResize.ts, which owns it — the drag and
  // the input's own min/max are the same numbers.
  onChange(root, '[data-act="fmt-width"]', (el) => updateDef(() => {
    const c = col();
    if (c) c.width = num(el) > 0 ? clampWidth(num(el)) : undefined;
  }));
  onChange(root, '[data-act="fmt-hidden"]', (el) => updateDef(() => {
    const c = col(); if (c) c.hidden = checked(el);
  }));

  // conditional colour rules
  // Seeded with BOTH colours, so a new rule visibly does something the moment its value
  // matches. With a fill and no text colour it inherited the cell's, which is the one
  // combination the presets exist to stop anyone choosing by accident.
  onClick(root, '[data-act="cond-add"]', () => updateDef(() => {
    const c = col(); if (!c) return;
    c.conditional = [...(c.conditional ?? []), { op: '=', value: '', bg: '#fff3cd', fg: '#664d03' } as CondRule];
  }));
  onClick(root, '[data-act="cond-remove"]', (el) => {
    updateDef(() => {
      const c = col(); if (c?.conditional) c.conditional.splice(idx(el), 1);
    });
    // Every rule after the removed one moved down a slot, so the preview would now be of a
    // different rule. Dropped wholesale, exactly as filter-remove drops removedBy.
    if (state.litBy !== null) update({ litBy: null });
  });
  const cond = (el: HTMLElement) => col()?.conditional?.[idx(el)];
  // Fill and text together in one updateDef, so a preset is one undo step and never lands
  // as a half-applied pair.
  onClick(root, '[data-act="cond-preset"]', (el) => updateDef(() => {
    const r = cond(el);
    if (!r) return;
    r.bg = el.dataset.bg;
    r.fg = el.dataset.fg;
  }));
  onChange(root, '[data-act="cond-op"]', (el) => updateDef(() => {
    const r = cond(el); if (r) r.op = text(el) as CondRule['op'];
  }));
  liveText(root, '[data-act="cond-value"]', (el) => {
    const r = cond(el);
    return r && ((v) => { r.value = v; });
  });
  onInput(root, '[data-act="cond-bg"]', (el) => updateDef(() => {
    const r = cond(el); if (r) r.bg = text(el);
  }, 'table'));
  onInput(root, '[data-act="cond-fg"]', (el) => updateDef(() => {
    const r = cond(el); if (r) r.fg = text(el);
  }, 'table'));
  onChange(root, '[data-act="cond-bold"]', (el) => updateDef(() => {
    const r = cond(el); if (r) r.bold = checked(el);
  }));

  // Show the rows one colour rule claims, and the way back. The target is the column the
  // panel is editing — the same fallback the whole tab runs on — so nothing new has to be
  // carried on the button beyond its position in the list.
  onClick(root, '[data-act="cond-show"]', (el) => {
    const target = { col: selectedIndex(state), rule: idx(el) };
    const same = state.litBy?.col === target.col && state.litBy.rule === target.rule;
    update({ litBy: same ? null : target, removedBy: null });
  });
  onClick(root, '[data-act="clear-lit"]', () => update({ litBy: null }));
}

// ---------------------------------------------------------------- appearance

function wireAppearance(root: HTMLElement) {
  const app = () => {
    state.def.appearance = state.def.appearance ?? {};
    return state.def.appearance;
  };
  liveText(root, '[data-act="app-title"]', () => {
    const a = app();
    return (v) => { a.title = v; };
  });
  const toggle = (act: string, key: 'showTitle' | 'gridLines' | 'outline' | 'blankRowBeforeData' | 'zebra' | 'headerBold') =>
    onChange(root, `[data-act="${act}"]`, (el) => updateDef(() => { app()[key] = checked(el); }));
  toggle('app-showtitle', 'showTitle');
  toggle('app-grid', 'gridLines');
  toggle('app-outline', 'outline');
  toggle('app-blankfirst', 'blankRowBeforeData');
  toggle('app-zebra', 'zebra');
  toggle('app-headerbold', 'headerBold');
  // Full repaint, not 'table': the picker shows a note about the chosen face, and that
  // note lives in the inspector.
  onChange(root, '[data-act="app-font"]', (el) =>
    updateDef(() => { app().bodyFont = text(el); }));
  onInput(root, '[data-act="app-fontsize"]', (el) =>
    updateDef(() => { app().fontSize = clamp(num(el), 8, 24); }));
}

// ---------------------------------------------------------------- calculated values

function wireCalculated(root: HTMLElement) {
  const byId = (el: HTMLElement) => el.dataset.id ?? '';
  const calcOf = (el: HTMLElement) => state.def.calculated?.find((c) => c.id === byId(el));

  const addCalc = (kind: 'formula' | 'percentage') => updateDef((def) => {
    def.calculated = def.calculated ?? [];
    const id = newId('calc', def.calculated);
    def.calculated.push(kind === 'formula'
      ? { id, name: `Calculated ${def.calculated.length + 1}`, kind, formula: '' }
      : { id, name: `Percentage ${def.calculated.length + 1}`, kind, ofField: def.columns[0]?.field });
  });
  onClick(root, '[data-act="calc-add-formula"]', () => addCalc('formula'));
  onClick(root, '[data-act="calc-add-percent"]', () => addCalc('percentage'));

  onClick(root, '[data-act="calc-remove"]', (el) => updateDef((def) => {
    const id = byId(el);
    def.calculated = (def.calculated ?? []).filter((c) => c.id !== id);
    // A column pointing at a deleted calculation would render blank forever.
    def.columns = def.columns.filter((c) => !(c.field.kind === 'formula' && c.field.id === id));
  }));
  liveText(root, '[data-act="calc-name"]', (el) => {
    const c = calcOf(el);
    return c && ((v) => { c.name = v; });
  });
  liveText(root, '[data-act="calc-formula"]', (el) => {
    const c = calcOf(el);
    return c && ((v) => { c.formula = v; });
  });
  onChange(root, '[data-act="calc-of"]', (el) => updateDef(() => {
    const c = calcOf(el);
    const f = fieldFromKey(text(el));
    if (c && f) c.ofField = f;
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
  onChange(root, '[data-act="calc-kind"]', (el) => updateDef((def) => {
    const c = def.calculated?.find((x) => x.id === byId(el));
    if (!c) return;
    const v = text(el);
    c.result = v === 'yesno' ? 'yesNo' : v === 'text' ? 'text' : 'number';
    c.unitKind = c.result === 'number' ? (v as NonNullable<typeof c.unitKind>) : undefined;
    c.yesNo = undefined;
    // Saying what the result is re-decides how the column reads: words left, a yes/no
    // centred, a number right. It overrides an alignment picked by hand, and should — the
    // declaration is the stronger statement, and Column formatting can still say otherwise.
    for (const col of def.columns) {
      if (col.field.kind === 'formula' && col.field.id === c.id) col.align = alignForCalc(c);
    }
  }));
  // One click to accept what the expression works out to, rather than making the author
  // find the same answer again in the dropdown next to it.
  onClick(root, '[data-act="calc-kind-accept"]', (el) => updateDef((def) => {
    const c = def.calculated?.find((x) => x.id === byId(el));
    const k = c?.formula ? dimensionOf(c.formula, kindsByHeading(state.store!, def)).kind : null;
    if (c && k) c.unitKind = k as NonNullable<typeof c.unitKind>;
  }));
}
