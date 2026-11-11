// The Schedules window's own actions, each as one function — 2026-10-02, phase 4 of the
// assistant's parity work (the owner: "assistant should possess everything user can do on the
// app").
//
// These are the bodies of the click handlers — the header's undo, redo, Save and Print, and,
// since v1.5.0 phase 3, the Templates library's Use, Save, Rename, Duplicate and Delete (they
// were the template gallery's cards and My templates' buttons) — moved here so that two callers
// run one behaviour, as `EXPORT_ACTIONS` (exporting.ts) already does for the Export menu:
//
//   · events.ts and libraryActions.ts, for the user's own click — which still asks what it
//     always asked first (replacing an edited schedule; the library's inline name row);
//   · manage.ts, for a request of the assistant's `manage_schedules` that arrived over the port.
//
// Every toast, every marker (`savedName`, `templateId`, `dirty`) and every undo entry is
// therefore the same whoever asked. Nothing here knows about the port.

import { redo, redoDepth, restate, undo, undoDepth } from '../../schedule/history';
import { withModelColumn } from '../../schedule/schedule/columns';
import { scheduleFromPreset, type Preset } from '../../schedule/schedule/presets';
import { confirmDialog, type ConfirmHow } from './dialog';
import { flash } from './dom';
import { libraryView } from './libraryCache';
import { classCount, mineKey } from './libraryModel';
import { closePopover, popoverId } from './popover';
import {
  DELETE_STORAGE_MESSAGE, deleteSchedule, duplicateSchedule, isFull, refusal, renameSchedule, saveSchedule, STORAGE_MESSAGE,
  type SavedEntry,
} from './schedules';
import { render, state, update, type AppState } from './state';

/** One step back or forward: the keys, the header's two buttons and a request from chat. */
export function stepHistory(wantRedo: boolean): boolean {
  if (!state.store) return false;
  const def = wantRedo ? redo() : undo();
  if (!def) { flash(wantRedo ? 'Nothing to redo.' : 'Nothing to undo.'); return false; }
  // The column menu names a position in a definition that has just been replaced (v1.5.0).
  if (popoverId()) closePopover();
  // The history stack holds definitions, not where they came from, so stepping through it
  // can land anywhere. Dropping both markers under-claims (you can undo back to exactly
  // the saved setup and it no longer says so) — which beats claiming a setup you left.
  update({
    def, selectedColumn: null, selectedCols: [],
    removedBy: null, litBy: null, templateId: null, savedName: null,
  });
  flash(wantRedo
    ? `Redo — ${redoDepth()} step${redoDepth() === 1 ? '' : 's'} left.`
    : `Undo — ${undoDepth()} step${undoDepth() === 1 ? '' : 's'} left.`);
  return true;
}

/** A built-in template becomes the schedule on screen — one undo step. */
export function applyTemplate(preset: Preset): void {
  const def = scheduleFromPreset(preset, state.store?.meta.unitSystem);
  // SGVue: more than one model loaded, so the schedule says which file each row is from.
  if (state.store) def.columns = withModelColumn(def.columns, state.store);
  // A column menu or a chip names a position in the schedule being replaced (v1.5.0).
  if (popoverId()) closePopover();
  update({
    def,
    templateId: preset.id,
    savedName: null,
    selectedColumn: null,
    selectedCols: [],
    removedBy: null,
    litBy: null,
    overlay: null,
    libraryDraft: null,
    dirty: false,
  });
  // A template can be used on a model without its class: the library says so first, and the
  // table says it again (ifcTable, 2026-11-07).
  if (state.store && !classCount(state.store, preset)) {
    flash(`Applied “${preset.name}” — this model has no ${preset.entities.join(' or ')}, so the table is empty.`);
  } else flash(`Applied “${preset.name}”.`);
}

/**
 * A saved setup becomes the schedule on screen — one undo step. Returns the classes it names
 * that this model has none of (a setup saved against another model), which the toast says.
 */
export function loadSaved(entry: SavedEntry): string[] {
  // A setup saved against another model may name a class this one lacks.
  const missing = entry.def.entity.filter((e) => !state.store?.byEntity.has(e));
  if (popoverId()) closePopover();
  update({
    def: structuredClone(entry.def), savedName: entry.name, templateId: null,
    selectedColumn: null, selectedCols: [], dirty: false, removedBy: null, litBy: null,
    // Picked from the Templates library, this is the answer to why it was opened.
    overlay: null, libraryDraft: null,
  });
  if (missing.length) flash(`Loaded, but this model has no ${missing.join(', ')}.`, true);
  else flash(`Loaded “${entry.name}”.`);
  return missing;
}

/**
 * What a Save came to: nothing to save, the list is full (v1.5.0, phase 3 — at a hundred a save
 * that would add one is refused), storage refused it, or the name it was saved under.
 */
export type SaveOutcome =
  | { result: 'nothing' } | { result: 'full' } | { result: 'failed' } | { result: 'done'; name: string };

/**
 * Save the schedule on screen into the Templates library's Mine — the header's Save, the
 * library's "Save current" row (under the name typed there, `typed`), and a request from chat.
 * `also` is what the library changes about itself in the same paint.
 */
export function saveCurrent(typed: string = state.def.name, also: Partial<AppState> = {}): SaveOutcome {
  // Nothing to save: a setup with no columns could never be loaded back (schedules.ts).
  if (!state.def.columns.length) {
    flash('Nothing to save — add a column first.', true);
    return { result: 'nothing' };
  }
  const asked = typed.trim() || 'Untitled schedule';
  // The one entry this save may replace is the one it was loaded from. Anything else
  // with that name is left alone and this copy is numbered — see the save rule.
  const name = saveSchedule({ ...state.def, name: asked }, state.savedName);
  if (!name) {
    const full = isFull(asked === state.savedName ? asked : null);
    flash(refusal(asked === state.savedName ? asked : null), true);
    return { result: full ? 'full' : 'failed' };
  }
  // A save records what is already on screen, so it is not an edit: the name goes onto the
  // definition without an undo step (`restate`) rather than through updateDef, which would push
  // one for a change the user did not make — and the history holds it from here on.
  state.def.name = name;
  restate(state.def);
  // You are now on that saved setup, unedited — so the rail and the library say so.
  update({ savedName: name, templateId: null, dirty: false, ...also });
  flash(name === asked
    ? `Saved “${name}”.`
    : `Saved as “${name}” — “${asked}” is a different template and was left alone.`);
  return { result: 'done', name };
}

/** Give a saved setup another name — what the library's Rename does once it has the name. */
export function renameSaved(
  name: string, next: string, also: Partial<AppState> = {},
): 'ok' | 'taken' | 'missing' | 'failed' {
  const result = renameSchedule(name, next);
  if (result === 'taken') { flash(`A template called “${next}” already exists.`, true); return result; }
  if (result === 'failed') {
    flash(STORAGE_MESSAGE, true);
    return result;
  }
  // 'missing' says the row is already gone; the next repaint is the whole answer.
  if (result !== 'ok') return result;
  // The name is the identity, so the marker follows it. No undo step, for the same reason as
  // a save: renaming what a setup is called in storage is not an edit to the schedule on
  // screen — but the history holds the new name from here on (`restate`).
  if (state.savedName === name) {
    state.def.name = next;
    restate(state.def);
    update({ savedName: next, ...also });
  } else if (Object.keys(also).length) update(also);
  else render();
  flash(`Renamed to “${next}”.`);
  return result;
}

/**
 * Copy a saved setup under a free name — the library's Duplicate. The copy's name, `'full'` at
 * the cap (v1.5.0, phase 3: refused, nothing is dropped to make room), or null when storage
 * refused the write.
 */
export function duplicateSaved(name: string, also: Partial<AppState> = {}): string | 'full' | null {
  const full = isFull();
  const copy = full ? null : duplicateSchedule(name);
  if (!copy) { flash(refusal(), true); return full ? 'full' : null; }
  flash(`Duplicated to Mine as “${copy}”.`);
  if (Object.keys(also).length) update(also); else render();
  return copy;
}

/**
 * The library's Delete: the window's own question, and the deletion on its Delete button.
 * `how` is for a question raised for the assistant (manage.ts): its name as the dialog's small
 * label, so that a dialog nobody in this window clicked for says who is asking — and no default
 * button, so that no key press already under way answers it (dialog.ts, `ConfirmHow`).
 */
export function askDeleteSaved(name: string, how?: ConfirmHow): void {
  // Where the library's selection goes once this row is gone — worked out now, while the row
  // is still in the list (ifcTable's `doDelete`).
  const sel = selectionAfterDelete(name);
  const deleted = () => {
    flash(`Deleted “${name}”.`);
    // The setup it pointed at is gone; the marker must not outlive it.
    if (state.savedName === name) update({ savedName: null, ...sel });
    else if (sel) update(sel);
    else render();
  };
  // Everything else in this app can be undone; storage cannot, so this one asks first.
  void confirmDialog(`Delete the saved template “${name}”? This cannot be undone.`, 'Delete', true, how)
    .then((ok) => {
      if (!ok) return;
      // A refused write deleted nothing: say so, and change nothing.
      deleteSchedule(name) ? deleted() : flash(DELETE_STORAGE_MESSAGE, true);
    });
}

/**
 * The Templates library's selection after `name` is deleted, when that row is the one selected:
 * the row after it as drawn, else the one before, else none (v1.5.0, phase 3 — ifcTable's
 * `doDelete`; without it the selection fell back to the list's first row). Undefined — leave
 * the selection alone — when the library is shut or another row is selected.
 */
function selectionAfterDelete(name: string): Pick<AppState, 'librarySel'> | undefined {
  if (state.overlay !== 'library' || !state.store) return undefined;
  const { rows, sel } = libraryView(state, state.store);
  const key = mineKey(name);
  if (sel?.key !== key) return undefined;
  const at = rows.findIndex((t) => t.key === key);
  return { librarySel: (rows[at + 1] ?? rows[at - 1])?.key ?? null };
}

/** The header's Print: the native print dialog, over the whole schedule (main.ts, `beforeprint`). */
export function printSchedule(): void {
  window.print();
}
