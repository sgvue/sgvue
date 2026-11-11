// The Templates library's list: Finder's list view. One grid shared by the column header and
// every row, sections Mine · Built-in · IFC-SG, and each section's "Not in this model" fold.
// Built-in and saved rows are the same row.
//
// Ported from ifcTable's `ui/overlays/libraryList.ts` (Yong Yen, 2026-11-07) for SGVue v1.5.0,
// phase 3, in this window's tokens and hover classes. No row animations: the list is rebuilt by
// innerHTML on every keystroke and every move of the selection, so a flash or a slide here
// would replay on each one.

import type { ModelStore } from '../../../schedule/ifc/store';
import { ruleText } from '../../../schedule/schedule/compare';
import { coverBar } from '../coverage';
import { esc } from '../dom';
import { ICON } from '../icons';
import { fitOf, inModelOf, type LibraryView } from '../libraryCache';
import { currentKey, saveNote, shortDate, type Tpl } from '../libraryModel';
import type { AppState, LibrarySortKey } from '../state';

/** The row's DOM id, for the search box's aria-activedescendant. Any name is safe in it. */
export const rowId = (key: string) => `lib-r-${key.replace(/[^a-zA-Z0-9]/g, (c) => `_${c.charCodeAt(0).toString(16)}`)}`;

/** The search text marked where it matches, escaped either side. */
function marked(text: string, q: string): string {
  const at = q ? text.toLowerCase().indexOf(q) : -1;
  if (at < 0) return esc(text);
  return `${esc(text.slice(0, at))}<mark>${esc(text.slice(at, at + q.length))}</mark>${esc(text.slice(at + q.length))}`;
}

const SORT_LABELS: [LibrarySortKey, string, string][] = [
  ['name', 'Name', ''], ['cls', 'Class', 'c-cls'], ['count', 'In model', 'r'], ['fit', 'Columns', 'r'],
  ['dt', 'Saved', 'r c-dt'],
];

export function listHead(state: AppState): string {
  const { by, dir } = state.librarySort;
  return `<div class="lib-lhead" role="row">${SORT_LABELS.map(([id, label, cls]) => {
    const on = by === id;
    const up = dir > 0;
    const classes = [cls, on ? 'on' : ''].filter(Boolean).join(' ');
    return `<button${classes ? ` class="${classes}"` : ''} data-act="library-sort" data-v="${id}"
      aria-sort="${on ? (up ? 'ascending' : 'descending') : 'none'}">${label}${
  on ? (up ? ICON.up11 : ICON.down11) : ''}</button>`;
  }).join('')}</div>`;
}

function badgeOf(state: AppState, t: Tpl): string {
  if (currentKey(state) !== t.key) return '';
  return state.dirty ? '<span class="badge">EDITED</span>' : '<span class="badge accent">IN USE</span>';
}

function row(state: AppState, store: ModelStore, t: Tpl, absent: boolean, sel: boolean, q: string): string {
  const cls = `lib-row${sel ? ' sel' : ''}${absent ? ' absent' : ''}`;
  const head = `class="${cls}" id="${rowId(t.key)}" role="option" aria-selected="${sel}"`;
  const draft = state.libraryDraft;
  if (draft?.kind === 'rename' && draft.target === t.key) {
    return `<div ${head}>
      <span class="nm"><input type="text" class="lib-name-in" data-act="library-rename" data-id="${esc(t.key)}"
        value="${esc(draft.text)}" aria-label="New name for ${esc(t.name)}" spellcheck="false" /></span>
      ${draft.error ? `<span class="lib-err" role="alert">${esc(draft.error)}</span>`
    : '<span class="lib-note">Enter to rename · Esc to cancel</span>'}
    </div>`;
  }
  const rules = t.def.filters.map((f) => ruleText(f, t.def)).join(t.def.filterLogic === 'or' ? ' or ' : ' and ');
  const filt = rules ? `<span class="twin" title="Only where ${esc(rules)}">filtered</span>` : '';
  const klass = `<span class="cls" title="${esc(t.entities.join(' + '))}">${marked(t.entities[0] ?? '—', q)}${t.entities.length > 1 ? ' +' : ''}</span>`;
  const dt = `<span class="dt">${t.savedAt ? esc(shortDate(t.savedAt)) : '—'}</span>`;
  const n = inModelOf(store, t);
  const f = fitOf(store, t);
  // A placeholder until the count or the coverage arrives — never a number not measured.
  const fit = absent ? '<span>—</span>'
    : f ? `<span>${f.found}/${f.of}</span>${coverBar(f.of ? f.found / f.of : 0)}` : '<span class="wait">…</span>';
  const cells = `${klass}<span class="count">${n === undefined ? '…' : n.toLocaleString()}</span><span class="fit">${fit}</span>${dt}`;
  return `<div ${head} data-act="library-row" data-id="${esc(t.key)}">
    <span class="nm"><b>${marked(t.name, q)}</b>${filt}${badgeOf(state, t)}</span>${cells}</div>`;
}

function savingRow(state: AppState, view: LibraryView): string {
  const text = state.libraryDraft?.text ?? '';
  // Mine as this paint read it (`templates`), not a second read of storage.
  const { note, error } = saveNote(text, state.savedName, view.all.filter((t) => t.src === 'mine'));
  const shown = state.libraryDraft?.error || note;
  return `<div class="lib-row saving">
    <span class="nm">${ICON.save}<input type="text" class="lib-name-in" data-act="library-save-name"
      value="${esc(text)}" aria-label="Name for the saved template" spellcheck="false" /></span>
    <span class="${error || state.libraryDraft?.error ? 'lib-err' : 'lib-note'}">${esc(shown)}</span>
  </div>`;
}

export function listBody(state: AppState, store: ModelStore, view: LibraryView): string {
  const q = state.libraryQuery.trim().toLowerCase();
  if (!view.items.some((i) => i.type === 'row' || i.type === 'saving' || i.type === 'empty')) {
    return `<div class="lib-none">No template matches “${esc(state.libraryQuery.trim())}”.<br>
      <button class="link" data-act="library-clear-search">Clear search</button></div>`;
  }
  let html = '';
  let open = false;
  for (const it of view.items) {
    if (it.type === 'sec') {
      if (open) html += '</div>';
      html += `<button class="lib-sec${it.shut ? ' shut' : ''}" data-act="library-fold" data-section="${it.id}"
        aria-expanded="${!it.shut}"><span class="tw">${ICON.caretDown}</span>${it.label}<span class="n">${it.n}</span></button>
        <div class="lib-group" role="group" aria-label="${it.label}">`;
      open = true;
    } else if (it.type === 'empty') {
      html += '<div class="lib-empty">Nothing saved yet. <button class="link" data-act="library-save-empty">Save the schedule on screen</button></div>';
    } else if (it.type === 'saving') {
      html += savingRow(state, view);
    } else if (it.type === 'absent') {
      html += `<button class="lib-sub hv-step${it.open ? '' : ' shut'}" data-act="library-absent" data-section="${it.id}"
        aria-expanded="${it.open}"><span class="tw">${ICON.caretDown}</span>Not in this model<span class="n">${it.n}</span></button>`;
    } else {
      html += row(state, store, it.tpl, it.absent, it.tpl.key === view.sel?.key, q);
    }
  }
  return open ? `${html}</div>` : html;
}
