// The Templates library's keyboard, as pure decisions — what a key means where focus is.
// libraryEvents.ts reads the event into a KeyInfo and acts on the answer; these rules are
// unit-tested without a DOM.
//
// Ported from ifcTable's `ui/libraryKeys.ts` (Yong Yen, 2026-11-07) for SGVue v1.5.0, phase 3.
// Its owner's decisions: no ⌘D / ⌘S. T opens the library; ↑↓ PgUp PgDn move; Home/End move
// only from the list (in the search box they move the caret); Enter uses; F2 renames; Delete
// asks to delete, and only from the list — never in a text field, where it deletes text. Esc
// closes the name row, then clears the search, then closes the library. ⌘Z / ⌘Y never reach the
// schedule behind an open library.
//
// SGVue: no confirm sheet in the library — this window asks with its own dialog (dialog.ts),
// which owns the keyboard while it is up, so the sheet's Escape has no counterpart here; and
// T also stands aside for that dialog and the right-click menu, as "/" does.

export interface KeyInfo {
  key: string;
  /** ⌘ or Ctrl. */
  mod: boolean;
  alt: boolean;
  /** Focus is in a text input, textarea or select. */
  inText: boolean;
  /** Focus is on the list itself. */
  inList: boolean;
  inSearch: boolean;
  /** Focus is in the inline name row (save or rename). */
  inDraft: boolean;
  onButton: boolean;
}

export interface LibCtx {
  draft: boolean;
  query: string;
}

export type LibAction =
  | 'up' | 'down' | 'pageUp' | 'pageDown' | 'home' | 'end'
  | 'use' | 'rename' | 'delete'
  | 'cancelDraft' | 'commitDraft' | 'clearSearch' | 'close'
  /** Taken from the page and dropped — a key that must not act on what is behind. */
  | 'swallow';

/** A page step: roughly the rows a short list shows. */
export const PAGE = 8;

export function libraryKey(k: KeyInfo, c: LibCtx): LibAction | null {
  // Undo belongs to the text box when typing; anywhere else it would undo the schedule
  // hidden behind the library, so it goes nowhere.
  if (k.mod && /^[zy]$/i.test(k.key)) return k.inText ? null : 'swallow';
  if (k.key === 'Escape') {
    if (c.draft) return 'cancelDraft';
    if (c.query) return 'clearSearch';
    return 'close';
  }
  if (k.inDraft) return k.key === 'Enter' ? 'commitDraft' : null;
  if (k.mod || k.alt) return k.key === 'Backspace' && k.mod && k.inList ? 'delete' : null;
  const nav = k.inList || k.inSearch;
  switch (k.key) {
    case 'ArrowDown': return nav ? 'down' : null;
    case 'ArrowUp': return nav ? 'up' : null;
    case 'PageDown': return nav ? 'pageDown' : null;
    case 'PageUp': return nav ? 'pageUp' : null;
    case 'Home': return k.inList ? 'home' : null;
    case 'End': return k.inList ? 'end' : null;
    // On a button Enter is that button's click, never Use.
    case 'Enter': return nav && !k.onButton ? 'use' : null;
    case 'F2': return 'rename';
    case 'Delete': return k.inList && !k.inText ? 'delete' : null;
    default: return null;
  }
}

/**
 * T opens the library — the same gate as "/" for the field picker: never while typing, only
 * with a model open, and never over a modal, this window's dialog or its right-click menu.
 * ⌘K and "/" stay the picker's.
 */
export function opensLibrary(
  k: { key: string; mod: boolean; alt: boolean; inText: boolean },
  c: { store: boolean; overlay: boolean; menu: boolean },
): boolean {
  return (k.key === 't' || k.key === 'T') && !k.mod && !k.alt && !k.inText
    && c.store && !c.overlay && !c.menu;
}
