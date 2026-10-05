// Keeping the UI still across repaints.
//
// Every pane is rebuilt with innerHTML, which would otherwise throw away the caret, the
// focus ring and every scroll position on each keystroke. One snapshot before the writes
// and one restore after solves all three for every control at once — which is why the app
// needs only two render scopes instead of one per pane.

/** Panes that scroll independently and must not jump. */
const SCROLLERS = [
  // The rail has two: the categories list, and the capped saved-schedules list pinned
  // below it. Both are rebuilt by the same innerHTML write, so both have to be listed.
  '.rail-body', '.rail-sched .rail-group', '.inspector-body', '.table-wrap',
  '.browse-list', '.browse-groups', '.tpl-grid-wrap', '.saved-list',
];

/** Input types that support a text selection; the rest throw on setSelectionRange. */
const CARET_TYPES = new Set(['text', 'search', 'url', 'tel', 'password']);

/**
 * Identity attributes a control may carry. Together with data-act they name it uniquely
 * enough to find the SAME control again after the element itself has been recreated.
 */
const KEYS = [
  'i', 'id', 'pset', 'v',
  'section', 'entity', 'name', 'type',
] as const;

/**
 * The panes a control can live in. The field browser deliberately mirrors the column list
 * that is also in the inspector, with the same data-act and data-i, so a document-wide
 * lookup would find the inspector's hidden copy behind the modal and put focus there.
 * Restoring inside the ORIGINATING pane keeps the two apart.
 */
const PANES = ['#overlay-root', '#inspector-pane', '#rail-pane', '#header', '#output-pane'];

export interface Ui {
  pane: string | null;
  path: string | null;
  start: number | null;
  end: number | null;
  scrolls: [string, number, number][];
}

function paneOf(el: Element): string | null {
  return PANES.find((p) => el.closest(p)) ?? null;
}

function pathOf(el: Element | null): string | null {
  if (!(el instanceof HTMLElement)) return null;
  // SGVue (phase 3): a column heading is focusable — the keyboard's route to its menu — and
  // carries no data-act; its def.columns index names it.
  if (!el.dataset.act) {
    return el.dataset.defcol === undefined ? null : `th[data-defcol="${CSS.escape(el.dataset.defcol)}"]`;
  }
  const bits = [`[data-act="${CSS.escape(el.dataset.act)}"]`];
  for (const k of KEYS) {
    const v = el.dataset[k];
    if (v !== undefined) bits.push(`[data-${k}="${CSS.escape(v)}"]`);
  }
  return bits.join('');
}

export function snapshotUi(): Ui {
  const active = document.activeElement;
  const input = active instanceof HTMLInputElement && CARET_TYPES.has(active.type) ? active : null;
  const scrolls: [string, number, number][] = [];
  for (const sel of SCROLLERS) {
    const el = document.querySelector(sel);
    if (el && (el.scrollTop || el.scrollLeft)) scrolls.push([sel, el.scrollTop, el.scrollLeft]);
  }
  return {
    pane: active ? paneOf(active) : null,
    path: pathOf(active),
    start: input?.selectionStart ?? null,
    end: input?.selectionEnd ?? null,
    scrolls,
  };
}

export function restoreUi(ui: Ui) {
  for (const [sel, top, left] of ui.scrolls) {
    const el = document.querySelector(sel);
    if (el) { el.scrollTop = top; el.scrollLeft = left; }
  }
  if (!ui.path) return;
  // Same pane it came from. If that pane is gone (the overlay just closed), so is the
  // control — leave focus where the browser put it rather than guessing at a lookalike.
  const scope = ui.pane ? document.querySelector(ui.pane) : document;
  if (!scope) return;
  const next = scope.querySelector<HTMLElement>(ui.path);
  // Focus is only ever returned to the control that already had it, never taken.
  if (!next || next === document.activeElement) return;
  next.focus({ preventScroll: true });
  if (ui.start !== null && next instanceof HTMLInputElement && CARET_TYPES.has(next.type)) {
    next.setSelectionRange(ui.start, ui.end ?? ui.start);
  }
}
