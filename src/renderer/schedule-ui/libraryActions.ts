// What the Templates library's controls DO — use, save, rename, duplicate, delete, export —
// each written once and reached from the pane, the keyboard and the rail alike.
// libraryEvents.ts only decides which of these a gesture means.
//
// Ported from ifcTable's `ui/libraryActions.ts` (Yong Yen, 2026-11-07) for SGVue v1.5.0,
// phase 3. What SGVue changes:
//   · whatever changes the schedule or the saved list goes through actions.ts — `applyTemplate`,
//     `loadSaved`, `saveCurrent`, `renameSaved`, `duplicateSaved`, `askDeleteSaved` — the very
//     functions the assistant's `manage_schedules` runs (manage.ts), so a click and a request
//     from chat have one behaviour, one toast and one undo step;
//   · ifcTable's confirm sheets are this window's own dialog (dialog.ts): replacing or reverting
//     an edited schedule asks there, and a deletion is `askDeleteSaved`'s question — the one the
//     read-only guard pins (`tests/readonly-guard.test.ts`). The sheet's third button, "Save,
//     then use", has no counterpart: the dialog has two;
//   · Import is `exporting.ts` `openScheduleFile` — main's native Open dialog — and adds the file
//     to Mine there; Export is `exportScheduleFile`, main's native Save dialog.
//
// Anything that changes more than the library goes through update(); moving around the library
// repaints the library alone (libraryPaint.ts).

import { confirmDialog } from './dialog';
import { flash } from './dom';
import { exportScheduleFile } from './exporting';
import {
  applyTemplate, askDeleteSaved, duplicateSaved, loadSaved, renameSaved, saveCurrent,
} from './actions';
import { libraryView } from './libraryCache';
import {
  classCount, currentKey, mineKey, mineName, READ_ONLY, renameError, revealFolds, type Tpl,
} from './libraryModel';
import { focusAfterPaint, paintLibrary, scrollAfterPaint } from './libraryPaint';
import { closePopover, popoverId } from './popover';
import { listSaved, refusal, saveSchedule } from './schedules';
import { state, update, type AppState } from './state';

const SEARCH = '[data-act="library-search"]';

/** A library-only change: write it, paint the library alone. */
export function libSet(patch: Partial<AppState>) {
  Object.assign(state, patch);
  paintLibrary();
}

/** The library as drawn. It exists only with a model open — every caller is a library, rail or
 *  header control, and none is drawn without one. */
export const view = () => libraryView(state, state.store!);
export const tplOf = (key: string | undefined) => view().all.find((t) => t.key === key);

/** Move the selection; the row comes into view and the pane starts from its top. */
export function select(key: string | null) {
  if (key === state.librarySel) return;
  scrollAfterPaint(true);
  libSet({ librarySel: key });
}

/** Folds that show `t`: its section open, and its "Not in this model" too when it is absent there. */
function shown(t: Tpl | undefined): string[] {
  if (!t) return state.libraryFolds;
  return revealFolds(state.libraryFolds, t, !!state.store && classCount(state.store, t) === 0);
}

/** Open the modal on what is in use (or `key`), with the Save row ready when asked. */
export function openLibrary(key: string | null = currentKey(state), save = false) {
  if (!state.store) return;
  if (popoverId()) closePopover();
  focusAfterPaint(save ? '[data-act="library-save-name"]' : SEARCH, save);
  scrollAfterPaint();
  update({
    overlay: 'library', libraryQuery: '', librarySel: key,
    libraryFolds: shown(key ? tplOf(key) : undefined),
    libraryDraft: save ? { kind: 'save', target: null, text: state.def.name, error: '' } : null,
  });
}

/** The inline Save row, at the top of Mine. */
export function openSaveRow() {
  focusAfterPaint('[data-act="library-save-name"]', true);
  libSet({
    libraryQuery: '',
    libraryFolds: state.libraryFolds.filter((f) => f !== 'sec:mine'),
    libraryDraft: { kind: 'save', target: null, text: state.def.name, error: '' },
  });
}

// ---------------------------------------------------------------- using one

/** Put the template on screen. Nothing asks here — requestUse already did. */
export function apply(t: Tpl) {
  if (t.src === 'mine') {
    const entry = listSaved().find((s) => s.name === t.name);
    if (entry) loadSaved(entry);
  } else if (t.preset) applyTemplate(t.preset);
}

/** Use, or ask first when it would replace an edited schedule; the one in use reverts. */
export function requestUse(t: Tpl | null | undefined) {
  if (!t || !state.store) return;
  const inUse = currentKey(state) === t.key;
  if (inUse && !state.dirty) return;
  if (!state.dirty || !state.def.columns.length) { apply(t); return; }
  const name = state.def.name;
  const ask = inUse
    ? confirmDialog(`Discard your changes to “${name}”? The schedule goes back to the saved version.`, 'Discard changes', true)
    : confirmDialog(`Replace the edited “${name}”? Changes not saved to it are lost.`, 'Replace');
  void ask.then((ok) => { if (ok) apply(t); });
}

// ---------------------------------------------------------------- saving

/** What the library shows after a save under `name`: Mine open on it, the name row closed. */
const savedPatch = (name: string): Partial<AppState> => ({
  libraryDraft: null, libraryQuery: '', librarySel: mineKey(name),
  libraryFolds: state.libraryFolds.filter((f) => f !== 'sec:mine'),
});

/** Save the schedule on screen under `typed`, the way Save always has (actions.ts). */
function saveAs(typed: string) {
  // The name it will be stored under is only known after the save; the library follows it.
  const out = saveCurrent(typed, { libraryDraft: null, libraryQuery: '' });
  if (out.result !== 'done') return; // refused: the toast said why, and the row stays as typed
  focusAfterPaint(SEARCH);
  scrollAfterPaint();
  libSet(savedPatch(out.name));
}

/**
 * Quick save (the header's Save, "Save changes"): silent over the loaded entry, else the Save
 * row — in the library, opening it when it is shut.
 */
export function quickSave() {
  if (!state.store) return;
  if (state.savedName && state.def.name.trim() === state.savedName) {
    const out = saveCurrent();
    if (out.result === 'done' && state.overlay === 'library') libSet(savedPatch(out.name));
    return;
  }
  if (state.overlay === 'library') openSaveRow();
  else openLibrary(currentKey(state), true);
}

export function commitSave() {
  const d = state.libraryDraft;
  if (d?.kind !== 'save' || !state.store) return;
  if (!d.text.trim()) { libSet({ libraryDraft: { ...d, error: 'A name is needed' } }); return; }
  saveAs(d.text);
}

// ---------------------------------------------------------------- renaming

export function startRename(t: Tpl | null | undefined) {
  if (!t) return;
  if (t.src !== 'mine') { flash(READ_ONLY); return; }
  focusAfterPaint('[data-act="library-rename"]', true);
  libSet({ librarySel: t.key, libraryDraft: { kind: 'rename', target: t.key, text: t.name, error: '' } });
}

export function cancelDraft() {
  focusAfterPaint(SEARCH);
  libSet({ libraryDraft: null });
}

export function commitRename(value: string) {
  const d = state.libraryDraft;
  const old = mineName(d?.kind === 'rename' ? d.target : null);
  if (!d || old === null) return;
  const name = value.trim();
  if (name === old) { cancelDraft(); return; }
  const error = renameError(value, old);
  if (error) {
    focusAfterPaint('[data-act="library-rename"]');
    libSet({ libraryDraft: { ...d, text: value, error } });
    return;
  }
  focusAfterPaint(SEARCH);
  const result = renameSaved(old, name, { libraryDraft: null, librarySel: mineKey(name) });
  // 'taken', 'missing' or 'failed' said their own toast (or the row is already gone).
  if (result !== 'ok') cancelDraft();
}

// ---------------------------------------------------------------- copies, files, deleting

/** A copy in Mine, selected with its name open. A built-in keeps its name, numbered if taken. */
export function duplicate(t: Tpl | null | undefined) {
  if (!t) return;
  const after = (name: string): Partial<AppState> => {
    const key = mineKey(name);
    return {
      libraryQuery: '', librarySel: key,
      libraryFolds: revealFolds(state.libraryFolds, { section: 'mine' }, !!state.store && classCount(state.store, t) === 0),
      libraryDraft: { kind: 'rename', target: key, text: name, error: '' },
    };
  };
  focusAfterPaint('[data-act="library-rename"]', true);
  scrollAfterPaint();
  if (t.src === 'mine') {
    // A refused copy said so in its own toast.
    const copy = duplicateSaved(t.name);
    if (copy && copy !== 'full') libSet(after(copy));
    return;
  }
  const name = saveSchedule(t.def, null);
  if (!name) { flash(refusal(), true); return; }
  update(after(name));
  flash(`Duplicated to Mine as “${name}”.`);
}

export function exportTpl(t: Tpl | null | undefined) {
  if (!t) return;
  void exportScheduleFile(t.def);
}

/** Delete asks first, in this window's own dialog — the same question the assistant's raises. */
export function requestDelete(t: Tpl | null | undefined) {
  if (!t) return;
  if (t.src !== 'mine') { flash(READ_ONLY); return; }
  askDeleteSaved(t.name);
}
