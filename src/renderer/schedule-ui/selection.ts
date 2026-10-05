// The table's side of two-way selection and the row menu — 2026-09-25, phase 3 of the
// Schedules window. Pure functions over a `ScheduleResult`, so they run in the unit tests
// without a DOM; main.ts owns the port and the painting. "Colour 3D by this column"'s grouping
// moved to `schedule/colour.ts` on 2026-09-28, where the assistant's colour-by runs it too.
//
// A selection is a set of STORE rows (indexes into `store.cores`), never table rows: a data
// row is marked when it carries any selected element, so the marks follow the elements through
// every re-sort, regroup and collapse. With itemise off one data row stands for several
// elements, and acting on the row acts on all of them — the rule phase 1 set for a click.

import type { ActKind } from '../../schedule/messages';
import type { ScheduleResult } from '../../schedule/schedule/engine';
import type { AppState } from './state';

/** Every data row carrying a selected element, as indexes into `res.rows`, in table order. */
export function markedRows(res: ScheduleResult, selected: ReadonlySet<number>): number[] {
  const out: number[] = [];
  if (!selected.size) return out;
  res.rows.forEach((row, i) => {
    if (row.kind === 'data' && row.rows.some((r) => selected.has(r))) out.push(i);
  });
  return out;
}

/** The data row carrying store row `r`, or -1 when no row on screen carries it. */
export function rowOfElement(res: ScheduleResult, r: number): number {
  return res.rows.findIndex((row) => row.kind === 'data' && row.rows.includes(r));
}

/** Every element of the data rows from `a` to `b`, inclusive, in either order — Shift-click. */
export function rangeElements(res: ScheduleResult, a: number, b: number): Set<number> {
  const out = new Set<number>();
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
    const row = res.rows[i];
    if (row?.kind === 'data') for (const r of row.rows) out.add(r);
  }
  return out;
}

/**
 * The data row `step` away from `from` (±1), skipping group, footer and blank rows; -1 at
 * either end. With nothing to start from, down starts at the first data row and up at the last.
 */
export function nextDataRow(res: ScheduleResult, from: number, step: 1 | -1): number {
  let i = from < 0 ? (step > 0 ? -1 : res.rows.length) : from;
  for (i += step; i >= 0 && i < res.rows.length; i += step) {
    if (res.rows[i].kind === 'data') return i;
  }
  return -1;
}

export interface RowMenuItem {
  label: string;
  /** A main-window store action, or `copy` — the one item this window does itself. */
  kind: ActKind | 'copy';
  ids: number[];
  disabled: boolean;
  /** A separator above it: `app/ContextMenu.tsx`'s `border-top`. */
  sep: boolean;
}

/**
 * The row menu for `ids` (federation ids, table order). An item is disabled when it would do
 * nothing: Select when exactly these are selected already, Isolate when they are already the
 * only elements shown, Hide when every one is hidden, Show when none is, Show all when nothing
 * is off. `Show` acts on the hidden ones only. Counts follow `ctx.ts`'s `nSuffix`.
 */
export function rowMenu(
  ids: readonly number[], selIds: readonly number[], vis: AppState['vis'],
): RowMenuItem[] {
  const n = ids.length;
  const suffix = n > 1 ? ` (${n})` : '';
  const hidden = ids.filter((id) => vis.hidden.has(id));
  const mine = new Set(ids);
  const sameSelection = selIds.length === n && selIds.every((id) => mine.has(id));
  const isolated = vis.storeysClean && !hidden.length && vis.hidden.size === vis.total - n;
  const item = (label: string, kind: RowMenuItem['kind'], disabled: boolean, on = [...ids], sep = false) =>
    ({ label, kind, ids: on, disabled, sep });
  return [
    item(`Select in 3D${suffix}`, 'select', sameSelection),
    item('Zoom to', 'zoom', false),
    item(`Isolate${suffix}`, 'isolate', isolated),
    item(`Hide${suffix}`, 'hide', hidden.length === n),
    item(`Show${hidden.length > 1 ? ` (${hidden.length})` : ''}`, 'show', !hidden.length, hidden),
    item('Show all', 'showAll', vis.allShown, []),
    item(n > 1 ? `Copy GUIDs${suffix}` : 'Copy GUID', 'copy', false, [...ids], true),
  ];
}

/** The status line's note when a 3D selection is nowhere in the table, or ''. */
export function selectionNote(state: AppState, res: ScheduleResult): string {
  if (!state.selAway) return '';
  return `${state.sel3d.toLocaleString()} selected in 3D · not in ${res.truncated ? 'the rows shown' : 'this schedule'}`;
}

