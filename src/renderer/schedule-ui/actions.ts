// The Schedules window's own actions, each as one function — 2026-10-02, phase 4 of the
// assistant's parity work (the owner: "assistant should possess everything user can do on the
// app").
//
// These are the bodies of the click handlers in events.ts — the header's undo, redo, Save and
// Print, the template gallery's cards, My templates' Load, Rename, Duplicate and Delete — moved
// here unchanged so that two callers run one behaviour, as `EXPORT_ACTIONS` (exporting.ts)
// already does for the Export menu:
//
//   · events.ts, for the user's own click — which still asks what it always asked first
//     ("Replace the current schedule setup?", the rename prompt);
//   · manage.ts, for a request of the assistant's `manage_schedules` that arrived over the port.
//
// Every toast, every marker (`savedName`, `templateId`, `dirty`) and every undo entry is
// therefore the same whoever asked. Nothing here knows about the port.

import { redo, redoDepth, undo, undoDepth } from '../../schedule/history';
import { withModelColumn } from '../../schedule/schedule/columns';
import { scheduleFromPreset, type Preset } from '../../schedule/schedule/presets';
import { confirmDialog, type ConfirmHow } from './dialog';
import { flash } from './dom';
import {
  deleteSchedule, duplicateSchedule, renameSchedule, saveSchedule, type SavedEntry,
} from './schedules';
import { render, state, update } from './state';

/** One step back or forward: the keys, the header's two buttons and a request from chat. */
export function stepHistory(wantRedo: boolean): boolean {
  if (!state.store) return false;
  const def = wantRedo ? redo() : undo();
  if (!def) { flash(wantRedo ? 'Nothing to redo.' : 'Nothing to undo.'); return false; }
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

/** A template from the gallery becomes the schedule on screen — one undo step. */
export function applyTemplate(preset: Preset): void {
  const def = scheduleFromPreset(preset, state.store?.meta.unitSystem);
  // SGVue: more than one model loaded, so the schedule says which file each row is from.
  if (state.store) def.columns = withModelColumn(def.columns, state.store);
  update({
    def,
    templateId: preset.id,
    savedName: null,
    selectedColumn: null,
    selectedCols: [],
    removedBy: null,
    litBy: null,
    overlay: null,
    open: 'fields',
    dirty: false,
  });
  flash(`Applied “${preset.name}”.`);
}

/**
 * A saved setup becomes the schedule on screen — one undo step. Returns the classes it names
 * that this model has none of (a setup saved against another model), which the toast says.
 */
export function loadSaved(entry: SavedEntry): string[] {
  // A setup saved against another model may name a class this one lacks.
  const missing = entry.def.entity.filter((e) => !state.store?.byEntity.has(e));
  update({
    def: structuredClone(entry.def), savedName: entry.name, templateId: null,
    selectedColumn: null, selectedCols: [], dirty: false, removedBy: null, litBy: null,
    // Picked from the My templates panel, this is the answer to why it was opened.
    overlay: null,
  });
  if (missing.length) flash(`Loaded, but this model has no ${missing.join(', ')}.`, true);
  else flash(`Loaded “${entry.name}”.`);
  return missing;
}

/** What a Save came to: nothing to save, storage refused it, or the name it was saved under. */
export type SaveOutcome = { result: 'nothing' } | { result: 'failed' } | { result: 'done'; name: string };

/** Save the schedule on screen into My templates — the header's and the panel's Save. */
export function saveCurrent(): SaveOutcome {
  // Nothing to save: a setup with no columns could never be loaded back (schedules.ts).
  if (!state.def.columns.length) {
    flash('Nothing to save — add a column first.', true);
    return { result: 'nothing' };
  }
  const asked = state.def.name.trim() || 'Untitled schedule';
  // The one entry this save may replace is the one it was loaded from. Anything else
  // with that name is left alone and this copy is numbered — see the save rule.
  const name = saveSchedule(state.def, state.savedName);
  if (!name) {
    flash('Could not save — storage is unavailable or full.', true);
    return { result: 'failed' };
  }
  // A save records what is already on screen, so it is not an edit: the name goes
  // straight onto the definition rather than through updateDef, which would push a
  // history entry for a change the user did not make.
  state.def.name = name;
  // You are now on that saved setup, unedited — so the rail should say so.
  update({ savedName: name, dirty: false });
  flash(name === asked
    ? `Saved “${name}”.`
    : `Saved as “${name}” — “${asked}” is a different template and was left alone.`);
  return { result: 'done', name };
}

/** Give a saved setup another name — what My templates' Rename does once it has the name. */
export function renameSaved(name: string, next: string): 'ok' | 'taken' | 'missing' | 'failed' {
  const result = renameSchedule(name, next);
  if (result === 'taken') { flash(`A template called “${next}” already exists.`, true); return result; }
  if (result === 'failed') {
    flash('Could not save — storage is unavailable or full.', true);
    return result;
  }
  // 'missing' says the row is already gone; the next repaint is the whole answer.
  if (result !== 'ok') return result;
  // The name is the identity, so the marker follows it. Direct assignment for the same
  // reason as a save: renaming what a setup is called in storage is not an edit to the
  // schedule on screen, and does not belong on the undo stack.
  if (state.savedName === name) {
    state.def.name = next;
    update({ savedName: next });
  } else render();
  return result;
}

/** Copy a saved setup under a free name — My templates' Duplicate. The copy's name, or null. */
export function duplicateSaved(name: string): string | null {
  const copy = duplicateSchedule(name);
  if (!copy) { flash('Could not duplicate — storage is unavailable or full.', true); return null; }
  flash(`Copied to “${copy}”.`);
  render();
  return copy;
}

/**
 * My templates' Delete: the window's own question, and the deletion on its Delete button.
 * `how` is for a question raised for the assistant (manage.ts): its name as the dialog's small
 * label, so that a dialog nobody in this window clicked for says who is asking — and no default
 * button, so that no key press already under way answers it (dialog.ts, `ConfirmHow`).
 */
export function askDeleteSaved(name: string, how?: ConfirmHow): void {
  // Everything else in this app can be undone; storage cannot, so this one asks first.
  void confirmDialog(`Delete the saved template “${name}”? This cannot be undone.`, 'Delete', true, how)
    .then((ok) => {
      if (!ok) return;
      deleteSchedule(name);
      // The setup it pointed at is gone; the marker must not outlive it.
      if (state.savedName === name) update({ savedName: null });
      else render();
    });
}

/** The header's Print: the native print dialog, over the whole schedule (main.ts, `beforeprint`). */
export function printSchedule(): void {
  window.print();
}
