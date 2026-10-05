// Ask Vee's `manage_schedules`, in the Schedules window — 2026-10-02, phase 4 of the assistant's
// parity work (the owner: "assistant should possess everything user can do on the app").
//
// A `manage` message names one of this window's own actions and, at most, a saved setup or a
// template. What runs is the control's own handler (actions.ts, exporting.ts) — the same
// function a click runs, with the same toast, the same markers and the same undo entry — and
// the answer says what became of it. The answer is worked out here and posted by main.ts at
// once: nothing below ever waits on a dialog.
//
// Four of the things asked for are not done here at all — they are put in front of the user,
// in this window, and the user's own click is what does them (the consent gate of phase 3,
// `shared/tool-schemas.ts` `ToolGate`):
//
//   · `delete`    — My templates' own confirm dialog; its Delete button deletes
//   · `print`     — this window's own confirm first; its Print… button opens the native print
//                   dialog, whose own default button prints
//   · `open_file` — the native Open dialog; the file the user picks becomes the schedule
//   · a `save` or a `duplicate` that would take a saved setup away — a save over the copy the
//     schedule was loaded from, or one that pushes the oldest off the end of the list. The
//     user's own Save does both without a question, by ifcTable's rule; one asked for from chat
//     may not, so it raises a confirm of its own first. (Phase 3 found the same hole in saved
//     filter sets: a "save" was a way to forget.)
//
// Each of those answers `asked`, and its dialog is raised by `then` — after the answer has gone.
// A question raised here carries the assistant's name as its label, so that a dialog nobody in
// this window clicked for says who is asking — and it takes no default button (`FOR_ASSISTANT`):
// it appears while the user may be typing, and no key press already under way may answer it.
//
// The two lists are the only place a saved setup's name leaves this window, and only when asked
// for: a name that is too long, or holds a control or direction character, is counted and not
// sent (`SafeName`).

import { redoDepth, undoDepth } from '../../schedule/history';
import {
  isSafeName, MANAGE_CLASSES_MAX, MANAGE_SAVED_MAX, MANAGE_TEMPLATES_MAX, MAX_DEF_COLUMNS,
  type ManageAck, type ManageRequest,
} from '../../schedule/messages';
import { presetsFor } from '../../schedule/schedule/presets';
import {
  applyTemplate, askDeleteSaved, duplicateSaved, loadSaved, printSchedule, renameSaved, saveCurrent,
  stepHistory,
} from './actions';
import type { Coverage } from './coverage';
import { confirmDialog, dialogOpen, type ConfirmHow } from './dialog';
import { flash } from './dom';
import { fileDialogUp, openScheduleFile } from './exporting';
import { fit, inModel } from './overlays/templateGallery';
import { flushPending } from './pending';
import { CAP, forgottenByDuplicate, forgottenBySave, listSaved, type SavedEntry } from './schedules';
import { state } from './state';

/** The assistant, as the main window's panel names it — the label on a question raised for it. */
export const ASKER = 'Ask Vee';

/**
 * How every question raised for the assistant is asked (dialog.ts): under its name, and with no
 * default button — the focus goes to the dialog itself, so Enter and Space answer nothing and
 * only a click, or Tab to a button, does.
 */
export const FOR_ASSISTANT: ConfirmHow = { title: ASKER, forAssistant: true };

/** The answer's own fields: everything of a `manageAck` but its envelope. */
export type ManageAnswer = Omit<ManageAck, 'type' | 'n'>;

export interface Managed {
  ack: ManageAnswer;
  /** What to start once the answer has been sent: this window's own question, or a native dialog. */
  then?: () => void;
}

const only = (result: ManageAnswer['result'], more: Partial<ManageAnswer> = {}): Managed =>
  ({ ack: { result, ...more } });

/** A name as an answer may carry it, or nothing: one that cannot cross is simply not named. */
const named = (key: 'name' | 'gone', name: string | null | undefined): Partial<ManageAnswer> =>
  (isSafeName(name) ? { [key]: name } : {});

/** The saved setup a request names: exactly, then without regard to case — as it was typed. */
function findSaved(asked: string | undefined): SavedEntry | undefined {
  const want = (asked ?? '').trim();
  if (!want) return undefined;
  const all = listSaved();
  return all.find((s) => s.name === want)
    ?? all.find((s) => s.name.toLowerCase() === want.toLowerCase());
}

/** One of this window's dialogs is up — its own confirm or prompt, or a native Save or Open. */
const dialogUp = (): boolean => dialogOpen() || fileDialogUp();

/**
 * A saved setup's name as a question raised for the assistant quotes it: control characters
 * and Unicode's invisible direction and width marks taken out. A name is whatever was typed or
 * a file carried, and a line break or a right-to-left override inside one must not be able to
 * make the question read as something it is not (the main window's `labelText`, for the same
 * reason).
 */
const plain = (name: string): string => name.replace(/[\p{Cc}\u200B-\u200F\u202A-\u202E\u2066-\u2069]/gu, '');

/**
 * A save or a duplicate that would take a saved setup away: asked, held, or refused — never
 * done. `still` is asked again at the click: a question the user's own work has overtaken does
 * nothing and says so, as a stale request does in the main window.
 */
function askFirst(
  m: ManageRequest,
  forgets: 'replace' | 'evict',
  more: Partial<ManageAnswer>,
  question: string,
  confirm: string,
  still: () => boolean,
  act: () => void,
): Managed {
  const extra = { forgets, ...more };
  if (!m.ask) return only('held', extra);
  if (dialogUp()) return only('busy');
  return {
    ack: { result: 'asked', ...extra },
    then: () => void confirmDialog(question, confirm, false, FOR_ASSISTANT).then((ok) => {
      if (!ok) return;
      if (still()) act();
      else flash('The schedule or the saved templates changed since that was asked — nothing was saved.', true);
    }),
  };
}

/**
 * One request from the assistant's `manage_schedules`: run the control's own action, or say why
 * not. Pure of the port — main.ts posts `ack`, then runs `then`.
 */
export function manageFromChat(m: ManageRequest): Managed {
  // A half-typed edit belongs to the schedule on screen: land it before that is read, saved
  // or replaced — as a click anywhere in the window does (pending.ts).
  flushPending();
  const store = state.store;
  /** The window shows a schedule: a model, and a category in it. */
  const shows = !!store?.entities.length;

  if (m.op === 'saved_list') {
    const all = listSaved();
    const safe = all.filter((s) => isSafeName(s.name));
    return only('done', {
      saved: safe.slice(0, MANAGE_SAVED_MAX).map((s) => ({
        name: s.name,
        classes: s.def.entity.filter(isSafeName).slice(0, MANAGE_CLASSES_MAX),
        columns: Math.min(s.def.columns.length, MAX_DEF_COLUMNS),
        saved: /^\d{4}-\d{2}-\d{2}/.test(s.savedAt) ? s.savedAt.slice(0, 10) : '',
        inUse: state.savedName === s.name,
        // A setup saved against another model may name a class this one lacks.
        lacks: !!store && s.def.entity.some((e) => !store.byEntity.has(e)),
      })),
      unlisted: Math.min(all.length - safe.length, MANAGE_SAVED_MAX),
    });
  }

  if (m.op === 'templates') {
    if (!store || !shows) return only('no_schedule');
    // The gallery's own list, with each card's two figures.
    const cache = new Map<string, Coverage>();
    return only('done', {
      templates: presetsFor(store.byEntity).slice(0, MANAGE_TEMPLATES_MAX).map((p) => {
        const { found, of } = fit(store, p, cache);
        return {
          id: p.id,
          name: p.name,
          classes: p.entities.slice(0, MANAGE_CLASSES_MAX),
          columns: of,
          fit: found,
          elements: inModel(store, p),
          inUse: state.templateId === p.id,
        };
      }),
    });
  }

  // Everything below changes this window, or asks the user something in it. While one of its
  // own dialogs is up — its confirm or prompt, or a native Save or Open — the window is the
  // user's: nothing is changed under it.
  if (dialogUp()) return only('busy');

  switch (m.op) {
    case 'undo':
    case 'redo': {
      if (!shows) return only('no_schedule');
      const stepped = stepHistory(m.op === 'redo');
      return only(stepped ? 'done' : 'nothing', { undo: undoDepth(), redo: redoDepth() });
    }

    case 'apply_template': {
      if (!store || !shows) return only('no_schedule');
      const want = (m.name ?? '').trim().toLowerCase();
      // Only what the gallery offers for this model: by its id, or by the name on its card.
      const offered = presetsFor(store.byEntity);
      const preset = offered.find((p) => p.id === want) ?? offered.find((p) => p.name.toLowerCase() === want);
      if (!preset) return only('missing');
      applyTemplate(preset);
      return only('done', { name: preset.name });
    }

    case 'load': {
      if (!shows) return only('no_schedule');
      const entry = findSaved(m.name);
      if (!entry) return only('missing');
      const lacks = loadSaved(entry).length;
      return only('done', { ...named('name', entry.name), lacks: Math.min(lacks, MANAGE_CLASSES_MAX * 8) });
    }

    case 'save': {
      if (!shows) return only('no_schedule');
      // (No columns: `saveCurrent` says so in its own toast, and saves nothing.)
      const would = state.def.columns.length ? forgottenBySave(state.def, state.savedName) : null;
      const gone = would ? would.replaced ?? would.evicted[0] : undefined;
      if (!would || gone === undefined) {
        const out = saveCurrent();
        return only(out.result, out.result === 'done' ? named('name', out.name) : {});
      }
      const same = JSON.stringify(would);
      return askFirst(
        m,
        would.replaced ? 'replace' : 'evict',
        { ...named('name', would.name), ...named('gone', gone) },
        would.replaced
          ? `Save over the saved template “${plain(would.replaced)}”? What it holds now is replaced, and cannot be brought back.`
          : `Save “${plain(would.name)}” to My templates? Only ${CAP} are kept, so the oldest — “${plain(gone)}” — would be forgotten, and cannot be brought back.`,
        'Save',
        () => !!state.def.columns.length && JSON.stringify(forgottenBySave(state.def, state.savedName)) === same,
        () => { saveCurrent(); },
      );
    }

    case 'rename': {
      const entry = findSaved(m.name);
      if (!entry) return only('missing');
      const to = (m.to ?? '').trim();
      if (!to || to === entry.name) return only('nothing', named('name', entry.name));
      const result = renameSaved(entry.name, to);
      return result === 'ok' ? only('done', named('name', to)) : only(result);
    }

    case 'duplicate': {
      const entry = findSaved(m.name);
      if (!entry) return only('missing');
      const evicted = forgottenByDuplicate(entry.name);
      if (!evicted.length) {
        const copy = duplicateSaved(entry.name);
        return copy ? only('done', named('name', copy)) : only('failed');
      }
      const same = JSON.stringify(evicted);
      return askFirst(
        m,
        'evict',
        { ...named('name', entry.name), ...named('gone', evicted[0]) },
        `Duplicate the saved template “${plain(entry.name)}”? Only ${CAP} are kept, so the oldest — “${plain(evicted[0])}” — would be forgotten, and cannot be brought back.`,
        'Duplicate',
        () => JSON.stringify(forgottenByDuplicate(entry.name)) === same,
        () => { duplicateSaved(entry.name); },
      );
    }

    case 'delete': {
      const entry = findSaved(m.name);
      if (!entry) return only('missing');
      if (!m.ask) return only('held');
      if (dialogUp()) return only('busy');
      // My templates' own question; its Delete button is the user's.
      return { ack: { result: 'asked', ...named('name', entry.name) }, then: () => askDeleteSaved(entry.name, FOR_ASSISTANT) };
    }

    case 'print': {
      if (!shows) return only('no_schedule');
      if (!m.ask) return only('held');
      if (dialogUp()) return only('busy');
      // This window's own question first. The native print dialog's default button prints, so
      // raised straight from chat a stray Enter would send the schedule to the default — perhaps
      // shared — printer. Only the click on Print… opens it: the header's own Print.
      return {
        ack: { result: 'asked' },
        then: () => void confirmDialog('Open the print dialog for this schedule?', 'Print…', false, FOR_ASSISTANT)
          .then((ok) => { if (ok) printSchedule(); }),
      };
    }

    case 'open_file': {
      if (!shows) return only('no_schedule');
      if (!m.ask) return only('held');
      if (dialogUp()) return only('busy');
      return { ack: { result: 'asked' }, then: () => void openScheduleFile() };
    }
  }
}
