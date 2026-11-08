// What a schedule definition PRODUCES, in a form that can be compared byte for byte:
// the engine result, the CSV text, and a digest of the workbook's content. The workbook is
// read back with exceljs and reduced to what a reader sees (values, number formats, fonts,
// fills, borders, column widths and alignment, page setup) — never the zip bytes, which carry a timestamp.
//
// Ported from ifcTable's `tests/support/outputs.ts` (Yong Yen) for SGVue v1.5.0, unchanged
// but for its paths.

import { toCsv } from '../../../../src/schedule/export/csv';
import { fullResult, toRows } from '../../../../src/schedule/export/rows';
import { oneSheet, xlsxBlob } from '../../../../src/schedule/export/xlsx';
import type { ModelStore } from '../../../../src/schedule/ifc/store';
import type { ScheduleDef } from '../../../../src/schedule/schedule/def';
import { runSchedule } from '../../../../src/schedule/schedule/engine';

const clean = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(typeof v === 'object' && v !== null && !Object.keys(v).length)));

export async function xlsxDigest(store: ModelStore, def: ScheduleDef): Promise<unknown> {
  const blob = await xlsxBlob(oneSheet(fullResult(store, def), def));
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await blob.arrayBuffer());
  return wb.worksheets.map((ws) => {
    const rows: unknown[] = [];
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      const cells: unknown[] = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        cells.push(clean({
          bd: cell.border as unknown, c, v: cell.value ?? undefined, f: cell.numFmt,
          font: cell.font ? clean(cell.font as Record<string, unknown>) : undefined,
          fill: cell.fill as unknown, al: cell.alignment as unknown,
        }));
      });
      rows.push({ r, cells });
    });
    const cols = (ws.columns ?? []).map((col, i) => clean({
      i, width: col.width, al: col.alignment as unknown,
    }));
    return { pageSetup: ws.pageSetup, name: ws.name, autoFilter: ws.autoFilter, views: ws.views, cols, rows };
  });
}

export function csvOf(store: ModelStore, def: ScheduleDef): string {
  return toCsv(toRows(fullResult(store, def)));
}

/** Engine output for the screen (default cap) — no exporter involved. */
export function resultOf(store: ModelStore, def: ScheduleDef) {
  return runSchedule(store, def);
}
