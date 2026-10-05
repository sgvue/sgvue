// The window's header bar and the centre's status line — 2026-09-25, phase 2.
//
// The header takes the place of two ifcTable surfaces. Its app bar (the brand, the model chip,
// feedback, the theme toggle) is not ported: the window belongs to SGVue and the theme follows
// the main window — but its Export menu is, since phase 4, as one more header button whose menu
// is the row menu's own (`menu.ts`). Its centre head (the schedule's name, the template it came
// from, Auto-fit and Equal width) is, whole. To those the header adds what a desktop window
// reaches for without a rail: the category being scheduled, the template gallery, My
// templates, Save, Export, Print, and undo / redo beside their shortcuts.
//
// Drawn in SGVue's toolbar idiom: 30 px icon buttons at 6 px radius with `hv-step` and a
// `data-tip`, the category as the sidebar's accent pill, the status line in the status bar's
// 11 px mono with `--border-strong` dots.

import { redoDepth, undoDepth } from '../../schedule/history';
import type { ScheduleResult } from '../../schedule/schedule/engine';
import type { Coverage } from './coverage';
import { esc } from './dom';
import * as icon from './icons';
import { selectionNote } from './selection';
import type { AppState } from './state';

/** ⌘ on a Mac, Ctrl elsewhere — only for what the tooltips say. */
const MOD = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+';

const tool = (act: string, tip: string, glyph: string, disabled = false, extra = '') =>
  `<button class="icon-btn hv-step" data-act="${act}" data-tip="${esc(tip)}" aria-label="${esc(tip)}"${
    disabled ? ' disabled' : ''}${extra}>${glyph}</button>`;

export function renderHeader(state: AppState): string {
  const def = state.def;

  // A schedule made from a template keeps its provenance in meta.notes, so the chip survives
  // saving and reloading.
  const notes = def.meta?.notes;
  const template = notes
    ? `<span class="tpl-chip" title="Started from this template">${esc(notes)}</span>` : '';
  const categories = def.entity
    .map((e) => `<span class="cat-chip" title="The category this schedule lists">${esc(e)}</span>`).join('');

  // Equal width acts on the marked headings, so it can only be offered once two of them are
  // marked — filtered the way main.ts filters them for the resizer. Disabled rather than
  // hidden: its title says what to do to earn it.
  const picked = state.selectedCols.filter((n) => def.columns[n]);
  const equal = picked.length >= 2;

  return `<input class="schedule-name" type="text" data-act="name" value="${esc(def.name)}"
      aria-label="Schedule name" title="Rename this schedule" spellcheck="false" />
    ${categories}${template}
    <span class="spacer"></span>
    <button class="btn" data-act="fit-all"
      title="Fit every column to its contents, and give columns of nearly equal width one shared width">Auto-fit columns</button>
    <button class="btn" data-act="fit-equal"${equal ? '' : ' disabled'}
      title="${equal
        ? 'Give the selected columns the width of the column being edited in Format'
        : 'Shift+click two or more column headings first'}">Equal width</button>
    <span class="hdr-group" role="group" aria-label="Schedule actions">
      ${tool('open-templates', 'Start from a template', icon.templates)}
      ${tool('open-saved', 'My templates', icon.saved)}
      ${tool('save-schedule', 'Save this setup', icon.save)}
    </span>
    <span class="hdr-group" role="group" aria-label="Export, print and history">
      ${tool('export-menu', 'Export — Excel, CSV or a schedule file', icon.exportFile, false, ' aria-haspopup="menu"')}
      ${tool('print', `Print the whole schedule (${MOD}P)`, icon.print)}
      ${tool('undo', `Undo (${MOD}Z)`, icon.undo, !undoDepth())}
      ${tool('redo', `Redo (${MOD === '⌘' ? '⇧⌘Z' : 'Ctrl+Y'})`, icon.redo, !redoDepth())}
    </span>`;
}

/**
 * Phase 3: the note that a 3D selection is nowhere in this table — inside `.sel-note`, which
 * main.ts rewrites in place when the selection changes, so a click in 3D never repaints the
 * table. First on the line, since the line clips at its right end in a narrow window. Empty
 * (and hidden by CSS) otherwise.
 */
export function selNoteHtml(state: AppState, res: ScheduleResult): string {
  const note = selectionNote(state, res);
  return note ? `<span>${esc(note)}</span><span class="dot">·</span>` : '';
}

/** ifcTable's `renderStatus`, word for word, in the status bar's mono line — after the note. */
export function renderStatus(state: AppState, res: ScheduleResult, cov: Coverage, ms: number): string {
  const rows = res.totalDataRows;
  const matched = res.matchedElements;
  // Elements in the scheduled category — counted once, by the coverage sweep, which is
  // built from exactly this entity list.
  const total = cov.total;

  const collapse = state.def.itemize
    ? 'Every instance itemised'
    : `Collapsed from ${matched.toLocaleString()} instance${matched === 1 ? '' : 's'} by ${res.columns.length} column${res.columns.length === 1 ? '' : 's'}`;

  return `<span class="sel-note">${selNoteHtml(state, res)}</span>
    <span>${rows.toLocaleString()} row${rows === 1 ? '' : 's'}</span>
    <span class="dot">·</span>
    <span>${matched.toLocaleString()} of ${total.toLocaleString()} elements matched</span>
    <span class="dot">·</span>
    <span>${esc(collapse)}</span>
    <span class="spacer"></span>
    <span>Rendered in ${ms.toFixed(0)} ms</span>`;
}
