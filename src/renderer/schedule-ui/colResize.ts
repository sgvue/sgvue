// Column widths, dragged by the right edge of a heading.
//
// The gesture is motion state, the same rule as resize.ts and dnd.ts: every move writes the
// inline --colw-<n> custom properties on the <table> and nothing else. tableView emits one
// CSS rule per column pointing at those variables, so the whole table re-lays-out from a
// variable write — no update(), no render(). A repaint mid-drag would rebuild the <th> under
// the pointer and kill the gesture. Only the release reaches the definition, and it goes out
// through the caller so this module never touches app state.

import { clamp } from './dom';

/** Hot zone at the right edge of a heading. Narrow: the rest of the th still opens Format. */
const EDGE = 6;
/**
 * The one range a column width may be set to. This module owns it because the drag is the
 * gesture that produces widths; the Format tab's Width box (its min/max attributes, and the
 * one commit in events.ts, which clamps through `clampWidth` below) imports from here so it
 * cannot disagree.
 */
export const COL_WIDTH_MIN = 30;
export const COL_WIDTH_MAX = 600;

/**
 * A number turned into a width this app will accept. The rounding is half of it: a width
 * only ever came from a drag before, which measures whole pixels, so the Width box could
 * store a fraction no gesture could reproduce.
 */
export const clampWidth = (w: number) => clamp(Math.round(w), COL_WIDTH_MIN, COL_WIDTH_MAX);

export interface ColResizeHooks {
  /**
   * Every column index that resizes with this one. A grip is solo unless the column is in a
   * header selection, so the usual answer is `[defIndex]` — the caller decides, and this
   * module never learns why several columns move together.
   */
  groupOf: (defIndex: number) => number[];
  /**
   * The release, or a double-click's fit. Always a measured number — no gesture here commits
   * "auto" any more, because under a table that stretches to its pane "auto" is not a fit.
   * Clearing a width is the Format tab's Width box, emptied.
   */
  commit: (widths: [number, number][]) => void;
}

/** The heading whose right edge the pointer is on, or null. */
function edgeHeading(e: MouseEvent): HTMLElement | null {
  const th = (e.target as HTMLElement | null)?.closest<HTMLElement>('th[data-defcol]');
  if (!th) return null;
  // The bounding rect is in screen coordinates, so this is the VISIBLE right edge — which
  // is what a rotated (vertical) heading needs, since its box is transformed.
  const r = th.getBoundingClientRect();
  return e.clientX >= r.right - EDGE ? th : null;
}

const defIndexOf = (th: HTMLElement) => Number(th.dataset.defcol);

/**
 * The click that follows this gesture belongs to the resizer. Without this the header's own
 * click handler opens Column formatting — which repaints, tearing out the very heading a
 * double-click is about to measure. Capture on window, so it lands before the delegated
 * handler on #app; removed on the next task, because a click is dispatched in the same turn
 * as the pointerup that precedes it and a timer always lands after that.
 */
function swallowNextClick() {
  const swallow = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
  window.addEventListener('click', swallow, true);
  setTimeout(() => window.removeEventListener('click', swallow, true), 0);
}

const setWidth = (table: HTMLElement, group: number[], px: number) => {
  for (const i of group) table.style.setProperty(`--colw-${i}`, `${px}px`);
};

/**
 * What each named column WANTS to be, in px. The one measurement in this app: the Auto-fit
 * button, the grip's double-click and Equal width all come through here.
 *
 * Shrink-wrapping the table is the whole point. A measurement taken while the table is
 * stretched reads the STRETCHED width and commits the pane's spare space as though it were
 * content: under the old `width: 100%` resting layout, a fit in a 1574px pane read LEVEL at
 * 217.1 against a natural 153.9. `table.schedule` now rests at `max-content` (table.css), so
 * the inline write below is belt and braces — kept deliberately, because the promise here is
 * "measured at content width", and that must not depend on the resting layout staying what it
 * is, nor on an inline width a drag has pinned. The style attribute then goes back exactly as
 * it was, absent properties back to absent: a caller that bails would otherwise leave the
 * table pinned with its widths cleared, which is a table the definition does not hold and
 * nothing repaints to put right.
 *
 * `only` narrows it to those def-column indices, and the columns outside keep their committed
 * widths: a group is measured against the real table, not a stripped one. A hidden column
 * renders no heading, so it is never measured and never in the result — and
 * `content-visibility: auto` skips off-screen rows, so this fits the rows on screen.
 */
export function naturalWidths(table: HTMLElement, only?: number[]): { i: number; px: number }[] {
  const heads = [...table.querySelectorAll<HTMLElement>('th[data-defcol]')]
    .filter((th) => !only || only.includes(defIndexOf(th)));
  if (!heads.length) return [];

  const priorVars = heads.map((th) => {
    const i = defIndexOf(th);
    return [i, table.style.getPropertyValue(`--colw-${i}`)] as const;
  });
  const priorWidth = table.style.width;
  for (const [i] of priorVars) table.style.removeProperty(`--colw-${i}`);
  table.style.width = 'max-content';
  void table.offsetWidth; // one forced reflow, so the reads below see natural widths
  // Every READ before any WRITE, as in the drag: interleaving them forces a layout per column.
  const out = heads.map((th) => ({ i: defIndexOf(th), px: th.getBoundingClientRect().width }));

  for (const [i, v] of priorVars) {
    if (v) table.style.setProperty(`--colw-${i}`, v);
    else table.style.removeProperty(`--colw-${i}`);
  }
  if (priorWidth) table.style.width = priorWidth;
  else table.style.removeProperty('width');
  return out;
}

export function wireColumnResize(root: HTMLElement, hooks: ColResizeHooks) {
  // Delegated, because the table is rebuilt by innerHTML on every repaint — a listener on
  // the heading itself would be orphaned by the next paint.
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const th = edgeHeading(e);
    const table = th?.closest<HTMLElement>('table');
    if (!th || !table) return;
    e.preventDefault();

    const group = hooks.groupOf(defIndexOf(th));
    const startX = e.clientX;
    const startW = th.getBoundingClientRect().width;
    let width = startW;
    let moved = false;

    // Only the dragged group carries an explicit width — every other column is auto, and
    // the browser re-divides whatever room the table has on every move.
    // The columns LEFT of the grip wobble, which is not something a resize may do. Pinning
    // the whole layout for the gesture leaves no slack to re-divide. Every READ happens
    // before any WRITE: interleaving them forces one layout per column.
    const measured = [...table.querySelectorAll<HTMLElement>('th[data-defcol]')]
      .map((h) => ({ i: defIndexOf(h), px: h.getBoundingClientRect().width }));
    const startTableW = table.getBoundingClientRect().width;
    // What the style attribute already held, so a press that turns out to be a click can be
    // put back exactly — an absent property must go back to absent, not to a pinned value.
    const priorVars = measured.map(({ i }) => [i, table.style.getPropertyValue(`--colw-${i}`)] as const);
    const priorWidth = table.style.width;
    for (const m of measured) table.style.setProperty(`--colw-${m.i}`, `${m.px}px`);
    table.style.width = `${startTableW}px`;

    // A group may name hidden columns: they render no <th>, were never measured, and add
    // nothing to how much the table has to grow. The visible members can each START at a
    // different width while the drag gives them all one, so the growth is summed per member
    // rather than taken from the grabbed column alone.
    const startPx = new Map(measured.map((m) => [m.i, m.px]));
    const members = group.filter((i) => startPx.has(i));
    const memberStart = members.reduce((sum, i) => sum + startPx.get(i)!, 0);

    // Capture keeps the stream coming when the pointer leaves the window mid-drag — the
    // usual way a resize listener gets stranded and the column follows the mouse forever.
    try { th.setPointerCapture(e.pointerId); } catch { /* fine — the guards below cover it */ }

    // A repaint from elsewhere — a debounced updateDef, an undo — rebuilds the output pane
    // and detaches the table this gesture captured: writes land on a dead node and the
    // column indices may no longer mean what they did. Abandon; never commit stale indices.
    const orphaned = () => !table.isConnected;

    const move = (ev: PointerEvent) => {
      if (orphaned()) { up(); return; }
      // The button came up somewhere no pointerup could reach us (alt-tab, a system
      // gesture) — treat the next movement as the release rather than dragging a column
      // no one is holding.
      if (ev.buttons === 0) { up(); return; }
      width = clampWidth(startW + ev.clientX - startX);
      moved = true;
      setWidth(table, group, width);
      // The table grows by exactly what the group grew, so the pinned columns outside it —
      // and the unpinned Count column — keep the widths they were measured at.
      table.style.width = `${startTableW + members.length * width - memberStart}px`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (orphaned()) return;
      swallowNextClick();
      // The commit repaints synchronously and the table node is rebuilt from the definition,
      // so there is nothing left to restore.
      if (moved) { hooks.commit(group.map((i) => [i, width])); return; }
      // Nothing moved — an edge click, or a press thought better of. Nothing repaints
      // either, so the pinned layout would stay on a table whose definition does not hold
      // those widths. Undo the pin, property by property.
      for (const [i, v] of priorVars) {
        if (v) table.style.setProperty(`--colw-${i}`, v);
        else table.style.removeProperty(`--colw-${i}`);
      }
      if (priorWidth) table.style.width = priorWidth;
      else table.style.removeProperty('width');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });

  // Auto-fit, on a double-click at the grip. Measured, never guessed — and solo and group
  // now commit the same kind of thing, a number. Solo used to commit `undefined`, and under
  // a table that is `width: 100%` clearing a width does not fit the column, it re-stretches
  // it into whatever slack the pane has. A double-click means "this wide", as it does in
  // Excel; "auto" is still one empty Width box away. A group takes its widest member, which
  // is the only width that still fits every one of them.
  root.addEventListener('dblclick', (e) => {
    const th = edgeHeading(e);
    const table = th?.closest<HTMLElement>('table');
    // Same constraint as the drag: a repaint between the clicks leaves a detached heading,
    // and every measurement below would read zero. Bail rather than commit a nonsense width.
    if (!th || !table || !th.isConnected) return;
    const group = hooks.groupOf(defIndexOf(th));
    // A hidden column measures nothing; it still takes the width the visible ones agree on.
    const widest = naturalWidths(table, group).reduce((w, c) => Math.max(w, c.px), 0);
    if (!widest) return;
    const w = clampWidth(Math.ceil(widest));
    // Written straight away so nothing flashes at the old width while the commit waits.
    setWidth(table, group, w);
    soon(() => hooks.commit(group.map((i) => [i, w])));
  });
}

/**
 * "Almost the same width", in px: two columns whose natural widths differ by less than this
 * read as a ragged edge rather than a real difference, so fitAll gives them one width.
 */
const SIMILAR = 12;

/**
 * Auto-fit every column, then unify the ones that come out almost the same width.
 *
 * Measured by `naturalWidths` above, so what is fitted is the content and not the slack the
 * pane happened to have. The measurements are then sorted and walked into clusters, each
 * anchored on its own SMALLEST member — anchoring on the previous column instead would chain
 * 60, 70 and 80 into one cluster and stretch the 60 by a third. Every member takes its
 * cluster's LARGEST width, the only one that still fits every member's content.
 *
 * Returns what to commit; the caller commits, so this module still never touches app state.
 */
export function fitAll(table: HTMLElement): [number, number][] {
  const measured = naturalWidths(table).sort((a, b) => a.px - b.px);
  if (!measured.length) return [];

  const out: [number, number][] = [];
  let cluster: typeof measured = [];
  const close = () => {
    const w = clampWidth(Math.ceil(cluster[cluster.length - 1].px));
    for (const c of cluster) out.push([c.i, w]);
    cluster = [];
  };
  for (const col of measured) {
    if (cluster.length && col.px - cluster[0].px > SIMILAR) close();
    cluster.push(col);
  }
  if (cluster.length) close();
  return out;
}

/**
 * A repaint never happens mid-click: microtasks flush BETWEEN listener callbacks, so a
 * definition change made from inside the dispatch can detach elements other handlers are
 * still owed. A task lands after the whole event.
 */
function soon(fn: () => void) { setTimeout(fn, 0); }
