// Excel export. exceljs is ~280 KB gzipped, so it is imported only when the user actually
// asks for a workbook — it never lands in the initial bundle.
//
// Ported from ifcTable's `export/xlsx.ts` for the Schedules window (2026-09-25, phase 4), with
// one change: the workbook's `creator` names SGVue. The Blob it hands back is turned into bytes
// by the page and written by main, behind the native Save dialog (`src/main/exports.ts`).

import { firingRule } from '../schedule/conditional';
import type { Column, ScheduleDef } from '../schedule/def';
import type { ScheduleResult } from '../schedule/engine';
import { displayFormat } from '../schedule/format';
import { toRows } from './rows';

export interface Sheet {
  /** Wanted name; sanitised and de-duplicated before it reaches Excel. */
  name: string;
  res: ScheduleResult;
  /** Shown instead of a table when the schedule's IFC class is absent from this model. */
  note?: string;
}

/**
 * Excel rejects several characters outright, truncates past 31, and cannot hold two sheets
 * with the same name — so two saved schedules called "Doors" would silently lose one.
 * `taken` carries the names already used so the second becomes "Doors (2)".
 */
export function sheetName(wanted: string, taken: Set<string>): string {
  const base = (wanted.trim() || 'Schedule').replace(/[\\/*?:[\]]/g, '').slice(0, 31).trim() || 'Schedule';
  if (!taken.has(base.toLowerCase())) { taken.add(base.toLowerCase()); return base; }
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate = base.slice(0, 31 - suffix.length) + suffix;
    if (!taken.has(candidate.toLowerCase())) { taken.add(candidate.toLowerCase()); return candidate; }
  }
}

/**
 * One workbook, one sheet per schedule. Hands back a Blob exactly as csvBlob does — saving
 * it is the caller's job, because an exporter that reached into ui/ for a download helper
 * would make the export layer depend on the DOM layer it must know nothing about.
 *
 * A numeric cell is written as a NUMBER holding the value the schedule displays, under a
 * number format that reproduces how the schedule displays it — so a SUM in Excel adds up
 * the figures the reader can see.
 */
export async function xlsxBlob(sheets: Sheet[]): Promise<Blob> {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SGVue';
  wb.created = new Date();

  const taken = new Set<string>();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheetName(sheet.name, taken), {
      views: [{ state: 'frozen', ySplit: 1 }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    writeSheet(ws, sheet);
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** Convenience for the single-schedule export. */
export function oneSheet(res: ScheduleResult, def: ScheduleDef): Sheet[] {
  return [{ name: def.name, res }];
}

/**
 * A rule colour as Excel's ARGB — `'FF' + RRGGBB`, uppercase — or undefined.
 *
 * The three forms def.ts's `colour()` sanitiser accepts are the only ones that can be
 * stored, so they are the only ones translated: `#abc` → `FFAABBCC`, `#a1b2c3` →
 * `FFA1B2C3`, `rgb(255, 0, 10)` → `FFFF000A`. Anything else hands back undefined and the
 * caller writes no colour at all — a guessed colour would be worse than none.
 *
 * A channel over 255 is clamped rather than rejected: the sanitiser's `\d{1,3}` lets
 * `rgb(999, 0, 0)` through and CSS clamps it on screen, so clamping is what keeps the
 * workbook showing what the table shows.
 */
export function argbOf(colour: string): string | undefined {
  const s = colour.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const h = hex[1];
    return `FF${(h.length === 3 ? [...h].map((c) => c + c).join('') : h).toUpperCase()}`;
  }
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(s);
  if (!rgb) return undefined;
  return `FF${rgb.slice(1, 4)
    .map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

/** A plain integer, for the trailing Count column and for any count total. */
const INTEGER = '0';

/**
 * The Excel number format that makes a written number LOOK like the schedule's text: the
 * column's decimals, its thousands separator, and its unit symbol, prefix and suffix as
 * literal text.
 *
 * Grouping follows the COLUMN, not the export. `plainNumbers` strips the separators out of
 * the exported TEXT so nothing reads a number as a label; Excel then puts the user's own
 * grouping back on display, which is what the schedule shows. A literal holding a double
 * quote cannot be written into a format code, so it is dropped rather than corrupting the
 * whole format.
 */
function numFmt(col: Column, shown?: { decimals: number; unit: string }): string {
  const f = col.format ?? {};
  // A column with no numeric cell can still carry a numeric total — a sum over text that
  // holds digits — so ask the formatter what a number with no dimension would look like.
  const { decimals, unit } = shown ?? displayFormat(undefined, f);
  const lit = (s: string) => (s && !s.includes('"') ? `"${s}"` : '');
  return lit(f.prefix ?? '')
    + (f.thousands !== false ? '#,##0' : INTEGER)
    + (decimals ? `.${'0'.repeat(decimals)}` : '')
    + (unit ? lit(` ${unit}`) : '')
    + lit(f.suffix ?? '');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- exceljs Worksheet
function writeSheet(ws: any, sheet: Sheet): void {
  const { res, note } = sheet;
  const rows = toRows(res, true);
  const width = res.columns.length + (res.countColumn ? 1 : 0);

  // One number format per column — and a second list for footers, because a count total is
  // a plain integer whatever the column beneath it displays, and "3 mm" would be nonsense.
  // The trailing Count column has no def column behind it at all.
  const cellFmt = Array.from({ length: width }, (_, i) => {
    const col = res.columns[i];
    return col ? numFmt(col, res.numeric?.[i]) : INTEGER;
  });
  const totalFmt = cellFmt.map((fmt, i) => {
    const total = res.columns[i]?.total;
    return total === 'count' || total === 'countDistinct' ? INTEGER : fmt;
  });

  for (const r of rows) {
    const row = ws.addRow(r.cells);
    // Numeric cells hold NUMBERS: the value the schedule displays, so a SUM over the column
    // adds the figures the reader sees. Text, yes/no and blank cells stay as they were.
    r.nums?.forEach((n, i) => {
      if (n === null) return;
      const cell = row.getCell(i + 1);
      cell.value = n;
      cell.numFmt = r.kind === 'data' ? cellFmt[i] : totalFmt[i];
    });
    if (r.kind === 'header') {
      row.font = { bold: true };
      row.border = { bottom: { style: 'medium' } };
    } else if (r.kind === 'group') {
      row.font = { bold: true };
      row.getCell(1).alignment = { indent: r.level * 2 };
      row.eachCell((c: { fill: unknown }) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F3F7' } };
      });
    } else if (r.kind === 'footer') {
      row.font = { italic: true };
      row.border = { top: { style: 'thin' } };
    } else if (r.kind === 'grand') {
      row.font = { bold: true };
      row.border = { top: { style: 'double' } };
    } else if (r.kind === 'data') {
      // The conditional colours, from the SAME evaluator the table paints with — an export
      // that dropped what the screen shows would be a lie. Exports run with `plainNumbers`,
      // so the rule is asked about the exported text: identical to the screen except for
      // thousands separators. The trailing Count column has no def column and is never
      // styled, which is what bounds the loop at res.columns.length.
      for (let i = 0; i < res.columns.length; i++) {
        const k = firingRule(res.columns[i], r.cells[i]);
        if (k < 0) continue;
        const rule = res.columns[i].conditional![k];
        const bg = rule.bg ? argbOf(rule.bg) : undefined;
        const fg = rule.fg ? argbOf(rule.fg) : undefined;
        const cell = row.getCell(i + 1);
        if (bg) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        if (fg || rule.bold) {
          cell.font = { ...(fg ? { color: { argb: fg } } : {}), ...(rule.bold ? { bold: true } : {}) };
        }
      }
    }
  }

  // A schedule whose class this model lacks still gets a sheet, saying so. Silently
  // dropping it would leave a workbook that looks complete and is not.
  if (note) {
    const row = ws.addRow([note]);
    row.font = { italic: true, color: { argb: 'FF8A5300' } };
  }

  // Right-align the columns the schedule right-aligns, and size to content. A collapsed
  // schedule carries a trailing Count that is not in res.columns — it must still be sized,
  // aligned and covered by the filter, or the sheet stops matching the screen. Width is
  // measured on the TEXT: it is the same digits, and a number has no length to measure.
  for (let i = 0; i < width; i++) {
    const col = res.columns[i];
    const sheetCol = ws.getColumn(i + 1);
    const widest = rows.reduce((w, r) => Math.max(w, (r.cells[i] ?? '').length), 8);
    sheetCol.width = Math.min(46, widest + 2);
    if (!col || col.align === 'right' || col.total) sheetCol.alignment = { horizontal: 'right' };
    else if (col.align === 'center') sheetCol.alignment = { horizontal: 'center' };
  }

  if (width) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: width } };
}
