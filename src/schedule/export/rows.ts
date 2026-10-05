// Flattens a ScheduleResult into plain rows for export.
//
// Exports always cover the FULL computed schedule, never the capped render — the cap
// is a display concession, and silently exporting 5,000 of 12,000 rows would be a lie.

import type { ScheduleDef } from '../schedule/def';
import { runSchedule, type CellNumbers, type ScheduleResult } from '../schedule/engine';
import type { ModelStore } from '../ifc/store';

type ExportKind = 'header' | 'data' | 'group' | 'footer' | 'grand' | 'blank';

export interface ExportRow {
  kind: ExportKind;
  cells: string[];
  /**
   * The displayed value of each cell as a number, aligned with `cells` — null where the
   * cell is not one. Absent on header, group and blank rows, which hold no figures. A
   * format that carries only text (CSV) ignores it.
   */
  nums?: CellNumbers;
  /** Indent depth for group headers and footers. */
  level: number;
}

/**
 * The result an export should use: every row, and numbers without thousands separators
 * so a spreadsheet treats them as numbers rather than text.
 */
export function fullResult(store: ModelStore, def: ScheduleDef): ScheduleResult {
  return runSchedule(store, def, { cap: Infinity, plainNumbers: true });
}

export function toRows(res: ScheduleResult, includeHeader = true): ExportRow[] {
  // A collapsed schedule grows one trailing Count column, exactly as it does on screen.
  const count = res.countColumn;
  const width = res.columns.length + (count ? 1 : 0);
  const out: ExportRow[] = [];
  const pad = (cells: string[]) => (cells.length < width ? [...cells, ''] : cells);
  const padNums = (nums: CellNumbers) => (nums.length < width ? [...nums, null] : nums);
  /** A row's numbers as its own array, all null when the engine produced none. */
  const numsOf = (r: { cells: unknown[]; nums?: CellNumbers }): CellNumbers =>
    (r.nums ? r.nums.slice() : r.cells.map(() => null));
  if (includeHeader) out.push({ kind: 'header', cells: pad([...res.headings, ...(count ? ['Count'] : [])]), level: 0 });

  for (const r of res.rows) {
    switch (r.kind) {
      case 'data':
        out.push({
          kind: 'data',
          cells: pad([...r.cells, ...(count ? [String(r.count)] : [])]),
          // The Count column is a number too — it is what an itemised export would sum.
          nums: padNums([...numsOf(r), ...(count ? [r.count] : [])]),
          level: 0,
        });
        break;
      case 'group': {
        const cells = new Array(width).fill('');
        cells[0] = `${r.label} (${r.count})`;
        out.push({ kind: 'group', cells, level: r.level });
        break;
      }
      case 'footer':
      case 'grand': {
        const cells = r.cells.map((c) => c ?? '');
        const nums = numsOf(r);
        // The label only borrows the first cell when that column totalled nothing, so the
        // number it would have carried is gone with it.
        if (!cells[0]) { cells[0] = r.label; nums[0] = null; }
        out.push({
          kind: r.kind,
          cells: pad([...cells, ...(count ? [String(r.count)] : [])]),
          nums: padNums([...nums, ...(count ? [r.count] : [])]),
          level: r.kind === 'grand' ? 0 : r.level,
        });
        break;
      }
      case 'blank':
        out.push({ kind: 'blank', cells: new Array(width).fill(''), level: r.level });
        break;
    }
  }
  return out;
}
