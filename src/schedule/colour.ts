/**
 * "Colour 3D by this column" — the grouping, in one place (2026-09-28).
 *
 * Phase 3 (2026-09-25) built it in the Schedules window (`schedule-ui/selection.ts` and
 * `main.ts`); the assistant's `color_by_schedule_column` must produce exactly what the heading
 * menu produces, so the grouping moved here and both call `colourColumn`: the menu over the
 * window's own store, the executor over `schedule-link.ts`'s `scheduleStore()` — the same
 * snapshot, indexed by the same `StoreBuilder`. What either sends on is applied in the main
 * window by one function too (`schedule-link.ts` `colourByColumn`: `admitGroups`, then the
 * legend's own `setColorByGroups`, whose `colorByGroups` gives the colours).
 *
 * Pure, like the rest of `src/schedule/`: no DOM, no port.
 */
import { MAX_COLOUR_GROUPS, MAX_COLOUR_VALUE, type ColourGroup } from './messages';
import type { ModelStore } from './ifc/store';
import { fieldKey, type ScheduleDef } from './schedule/def';
import { runSchedule, type ScheduleResult } from './schedule/engine';

/** A displayed value, as long as the port carries it. */
export const colourKey = (text: string): string => text.slice(0, MAX_COLOUR_VALUE);

/**
 * Each displayed value of visible column `vi` and the federation ids behind it, in first-seen
 * order. The DISPLAYED text is the value — so a calculated column works, and a number groups
 * the way the column rounds it. An empty cell is no group (`colorBy` skips an element that
 * carries no value). The caller runs the schedule uncapped, so no element is left out because
 * the screen draws only the first 5 000 rows.
 */
export function columnGroups(
  res: ScheduleResult, vi: number, rowIds: readonly number[],
): ColourGroup[] {
  const groups = new Map<string, number[]>();
  for (const row of res.rows) {
    if (row.kind !== 'data') continue;
    const text = row.cells[vi];
    if (!text) continue;
    const key = colourKey(text);
    const ids = groups.get(key) ?? [];
    if (!ids.length) groups.set(key, ids);
    for (const r of row.rows) ids.push(rowIds[r]);
  }
  return [...groups].map(([value, ids]) => ({ value, ids }));
}

/** Why a column cannot be coloured by — too many distinct values — or null when it can. */
export function tooManyColours(groups: number): string | null {
  return groups > MAX_COLOUR_GROUPS
    ? `${groups.toLocaleString()} distinct values — too many to colour by. Group or narrow the column first.`
    : null;
}

/** What a colour-by from a column carries: the `colourBy` message's own three fields. */
export interface ColumnColours {
  /** The column's heading as the table shows it: the legend's title. */
  label: string;
  /** Which column (`fieldKey`), so the table can draw its swatches. */
  key: string;
  groups: ColourGroup[];
}

/**
 * "Colour 3D by this column" for `def.columns[defcol]`: the schedule run uncapped, the
 * column's displayed values grouped, refused past `MAX_COLOUR_GROUPS` or when it has no value
 * at all — `{ error }`, in the words the window's toast shows. `null` for a column that is not
 * there or not shown, which has nothing to colour.
 */
export function colourColumn(
  store: ModelStore, def: ScheduleDef, defcol: number, rowIds: readonly number[],
): ColumnColours | { error: string } | null {
  const col = def.columns[defcol];
  if (!col || col.hidden) return null;
  // Uncapped: the screen draws 5 000 rows, and the 3D view must not stop there.
  const full = runSchedule(store, def, { cap: Infinity });
  const vi = def.columns.filter((c) => !c.hidden).indexOf(col);
  const groups = columnGroups(full, vi, rowIds);
  if (!groups.length) return { error: 'Nothing to colour — this column has no values.' };
  const refusal = tooManyColours(groups.length);
  if (refusal) return { error: refusal };
  return { label: (full.headings[vi] || 'Column').slice(0, 200), key: fieldKey(col.field), groups };
}
