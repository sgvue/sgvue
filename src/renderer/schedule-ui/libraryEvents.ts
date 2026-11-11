// Event wiring for the Templates library and its ways in (the rail's entry, the header's two
// buttons, `T`) — the feature-area seam ifcTable split out of events.ts. Delegated from #app
// like everything in events.ts, and tests/unit/schedule/acts.test.ts reads the act names here
// the same way. What each gesture does lives in libraryActions.ts.
//
// Ported from ifcTable's `ui/libraryEvents.ts` (Yong Yen, 2026-11-07) for SGVue v1.5.0,
// phase 3. SGVue: no confirm sheet (this window's dialog asks instead, and owns the keyboard
// while it is up), so neither the sheet's buttons nor its Escape are here; Import is the
// header's and the library's `import-schedule`, wired in events.ts with the other file
// controls.

import { dialogOpen } from './dialog';
import { onClick, onInput } from './dom';
import * as lib from './libraryActions';
import { libraryKey, opensLibrary, PAGE, type LibAction } from './libraryKeys';
import { moveSel, type Tpl } from './libraryModel';
import { focusAfterPaint, scrollAfterPaint } from './libraryPaint';
import { menuOpen } from './menu';
import { state, update, type LibrarySortKey } from './state';

const isText = (el: Element | null) => /^(INPUT|SELECT|TEXTAREA)$/.test(el?.tagName ?? '');
const selected = (): Tpl | null => lib.view().sel;
/** The template a pane or row control is about: its row's key, else the selection. */
const about = (el: HTMLElement): Tpl | null => (el.dataset.id ? lib.tplOf(el.dataset.id) ?? null : selected());

export function wireLibrary(root: HTMLElement) {
  // ---- the ways in ----
  onClick(root, '[data-act="open-library"]', () => lib.openLibrary());
  onClick(root, '[data-act="save-schedule"]', () => lib.quickSave());

  // ---- the list ----
  onInput(root, '[data-act="library-search"]', (el) => {
    scrollAfterPaint();
    lib.libSet({ libraryQuery: (el as HTMLInputElement).value });
  });
  onClick(root, '[data-act="library-clear-search"]', () => {
    focusAfterPaint('[data-act="library-search"]');
    lib.libSet({ libraryQuery: '' });
  });
  onClick(root, '[data-act="library-sort"]', (el) => {
    const by = el.dataset.v as LibrarySortKey;
    const cur = state.librarySort;
    // Names and classes read A→Z first; numbers and dates most first.
    lib.libSet({ librarySort: cur.by === by ? { by, dir: cur.dir > 0 ? -1 : 1 } : { by, dir: by === 'name' || by === 'cls' ? 1 : -1 } });
  });
  const toggle = (token: string) => (state.libraryFolds.includes(token)
    ? state.libraryFolds.filter((f) => f !== token) : [...state.libraryFolds, token]);
  onClick(root, '[data-act="library-fold"]', (el) => lib.libSet({ libraryFolds: toggle(`sec:${el.dataset.section}`) }));
  onClick(root, '[data-act="library-absent"]', (el) => lib.libSet({ libraryFolds: toggle(`abs:${el.dataset.section}`) }));
  // A second click on the selected row uses it. `detail` counts the clicks, so this needs no
  // dblclick listener — and a row already selected repaints nothing, so the two clicks land on
  // the same node.
  onClick(root, '[data-act="library-row"]', (el, ev) => {
    const key = el.dataset.id ?? null;
    if (key !== lib.view().sel?.key) { lib.select(key); return; }
    if (ev.detail >= 2) lib.requestUse(lib.tplOf(key ?? undefined));
  });

  // ---- the inline name row ----
  onClick(root, '[data-act="library-save-new"], [data-act="library-save-empty"], [data-act="library-save-as"]',
    () => lib.openSaveRow());
  onClick(root, '[data-act="library-save-over"]', () => lib.quickSave());
  onInput(root, '[data-act="library-save-name"]', (el) => {
    if (state.libraryDraft?.kind !== 'save') return;
    // The note under it says what Enter would do, so it is redrawn with every keystroke.
    lib.libSet({ libraryDraft: { ...state.libraryDraft, text: (el as HTMLInputElement).value, error: '' } });
  });
  onInput(root, '[data-act="library-rename"]', (el) => {
    const d = state.libraryDraft;
    if (d?.kind !== 'rename') return;
    const text = (el as HTMLInputElement).value;
    // Only an error on screen needs a repaint to go away; otherwise the text just rides along.
    if (d.error) lib.libSet({ libraryDraft: { ...d, text, error: '' } });
    else state.libraryDraft = { ...d, text };
  });
  // Clicking away commits a rename, as in Finder. A task later, never mid-click: by then the
  // click (if any) has landed, and a repaint that replaced the input has already put focus back
  // into its successor — which is how a stale blur is told from a real one.
  root.addEventListener('focusout', (e) => {
    const el = e.target as HTMLInputElement | null;
    if (!el?.closest?.('[data-act="library-rename"]')) return;
    const key = el.dataset.id;
    setTimeout(() => {
      const d = state.libraryDraft;
      if (d?.kind !== 'rename' || d.target !== key || dialogOpen()) return;
      if (document.activeElement?.closest?.('[data-act="library-rename"]')) return;
      lib.commitRename(d.text);
    }, 0);
  });

  // ---- the pane ----
  onClick(root, '[data-act="library-use"]', () => lib.requestUse(selected()));
  onClick(root, '[data-act="library-duplicate"]', (el) => lib.duplicate(about(el)));
  onClick(root, '[data-act="library-rename-start"]', (el) => lib.startRename(about(el)));
  onClick(root, '[data-act="library-export"]', (el) => lib.exportTpl(about(el)));
  onClick(root, '[data-act="library-delete"]', (el) => lib.requestDelete(about(el)));

  // ---- the keyboard ----
  // Capture on window: this runs before every other keydown listener in the window, so while
  // the library is open it owns Esc (events.ts closes any overlay on Esc) and ⌘Z / ⌘Y
  // (wireHistory would undo the schedule behind it). What it handles goes no further. This
  // window's own dialog sits above the library and keeps every key while it is up.
  window.addEventListener('keydown', (e) => {
    if (dialogOpen()) return;
    const t = e.target as HTMLElement | null;
    const inText = isText(t);
    const mod = e.ctrlKey || e.metaKey;
    if (opensLibrary({ key: e.key, mod, alt: e.altKey, inText },
      { store: !!state.store?.entities.length, overlay: !!state.overlay, menu: menuOpen() })) {
      e.preventDefault();
      lib.openLibrary();
      return;
    }
    if (state.overlay !== 'library' || !state.store) return;
    const action = libraryKey({
      key: e.key, mod, alt: e.altKey, inText,
      inList: !!t?.closest?.('[data-act="library-list"]') && !inText,
      inSearch: !!t?.closest?.('[data-act="library-search"]'),
      inDraft: !!t?.closest?.('[data-act="library-rename"], [data-act="library-save-name"]'),
      onButton: t?.tagName === 'BUTTON',
    }, { draft: !!state.libraryDraft, query: state.libraryQuery });
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    run(action, (t as HTMLInputElement | null)?.value);
  }, true);
}

function run(action: LibAction, value?: string) {
  const v = lib.view();
  const step = (to: number | 'home' | 'end') => lib.select(moveSel(v.rows, v.sel?.key ?? null, to));
  switch (action) {
    case 'down': step(1); break;
    case 'up': step(-1); break;
    case 'pageDown': step(PAGE); break;
    case 'pageUp': step(-PAGE); break;
    case 'home': step('home'); break;
    case 'end': step('end'); break;
    case 'use': lib.requestUse(v.sel); break;
    case 'rename': lib.startRename(v.sel); break;
    case 'delete': lib.requestDelete(v.sel); break;
    case 'cancelDraft': lib.cancelDraft(); break;
    case 'commitDraft':
      if (state.libraryDraft?.kind === 'save') lib.commitSave();
      else lib.commitRename(value ?? state.libraryDraft?.text ?? '');
      break;
    case 'clearSearch':
      focusAfterPaint('[data-act="library-search"]');
      lib.libSet({ libraryQuery: '' });
      break;
    case 'close': update({ overlay: null, libraryDraft: null }, 'panes'); break;
    case 'swallow': break;
  }
}
