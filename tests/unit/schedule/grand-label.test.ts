// The grand-total row says how many elements it totals (2026-11-25, after the window test of
// the default-on grand total): "Grand total: 40", or "Doors in total: 40" with a label of the
// user's own — Revit's form, and the form a group footer already takes ("L1: 3"). A default-on
// row with no total in any column read "Grand total" and nothing else. One place builds it: the
// engine's grand row; the table, the print, the CSV, the workbook and the assistant read it.

import { describe, expect, it } from 'vitest';
import { emptySchedule, type Column, type ScheduleDef } from '../../../src/schedule/schedule/def';
import { runSchedule, type GrandRow } from '../../../src/schedule/schedule/engine';
import { toCsv } from '../../../src/schedule/export/csv';
import { fullResult, toRows } from '../../../src/schedule/export/rows';
import { xlsxBlob } from '../../../src/schedule/export/xlsx';
import { readSchedule } from '../../../src/schedule/assistant';
import { state as blank, type AppState } from '../../../src/renderer/schedule-ui/state';
import { buildCoverage } from '../../../src/renderer/schedule-ui/coverage';
import { renderSchedule } from '../../../src/renderer/schedule-ui/tableView';
import { buildStore } from './support/fixture';
import { readTable } from './support/htmlTable';

const store = buildStore();
const W = { kind: 'prop', pset: 'Qto_DoorBaseQuantities', prop: 'Width' } as const;
const MARK = { kind: 'core', key: 'mark' } as const;
const TYPE = { kind: 'core', key: 'typeName' } as const;
/** Nine doors; no column totals anything. */
const doors = (over: Partial<ScheduleDef> = {}): ScheduleDef => ({
  ...emptySchedule('Doors', ['IfcDoor']),
  grandTotal: true,
  columns: [{ field: MARK }, { field: TYPE }, { field: W }] as Column[],
  ...over,
});
const grand = (def: ScheduleDef) => runSchedule(store, def).rows.find((r) => r.kind === 'grand') as GrandRow | undefined;

describe('the engine: the label carries the count', () => {
  it('the default title', () => {
    expect(grand(doors())).toMatchObject({ label: 'Grand total: 9', count: 9 });
  });
  it('a title of the user’s own, trimmed', () => {
    expect(grand(doors({ grandTotalTitle: 'Doors in total' }))?.label).toBe('Doors in total: 9');
    expect(grand(doors({ grandTotalTitle: '  Doors in total  ' }))?.label).toBe('Doors in total: 9');
    expect(grand(doors({ grandTotalTitle: '   ' }))?.label).toBe('Grand total: 9');
  });
  it('nothing kept: the row is still there, as before, and says 0', () => {
    const def = doors({ filters: [{ field: W, op: '>=', value: 50 }] });
    expect(runSchedule(store, def).matchedElements).toBe(0);
    expect(grand(def)).toMatchObject({ label: 'Grand total: 0', count: 0 });
  });
  it('filtered: the count is the elements kept', () => {
    const def = doors({ filters: [{ field: W, op: '>=', value: 1 }] });
    const kept = runSchedule(store, def).matchedElements;
    expect(kept).toBeGreaterThan(0);
    expect(grand(def)?.label).toBe(`Grand total: ${kept}`);
  });
  it('merged rows and rows per sort value count elements, not lines — as a footer does', () => {
    const merged = doors({ itemize: false, columns: [{ field: TYPE }] as Column[] });
    const res = runSchedule(store, merged);
    expect(res.totalDataRows).toBeLessThan(9);
    expect(grand(merged)).toMatchObject({ label: 'Grand total: 9', count: 9 });
    const bySort = doors({ itemize: false, combine: 'sort', sort: [{ field: TYPE, dir: 'asc' }] });
    expect(grand(bySort)).toMatchObject({ label: 'Grand total: 9', count: 9 });
  });
  it('no grand total asked for: no row', () => {
    expect(grand(doors({ grandTotal: false }))).toBeUndefined();
  });
});

describe('every reader shows the engine’s label, once', () => {
  const def = doors({ grandTotalTitle: 'Doors in total' });
  it('the table', () => {
    const appState = { ...blank, store, def } as AppState;
    const html = renderSchedule(appState, runSchedule(store, def), buildCoverage(store, def.entity));
    const t = readTable(html);
    const row = t.body.find((r) => r.cls === 'grand')!;
    expect(row.cells[0].text).toBe('Doors in total: 9');
    expect(html).not.toMatch(/Doors in total: 9[^<]*9/);
  });
  it('the CSV', () => {
    const csv = toCsv(toRows(fullResult(store, def))).split('\r\n');
    expect(csv.at(-1)).toBe('Doors in total: 9,,');
  });
  it('the workbook', async () => {
    const blob = await xlsxBlob([{ name: 'Doors', res: fullResult(store, def) }]);
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    const ws = wb.getWorksheet('Doors')!;
    expect(ws.getRow(ws.rowCount).getCell(1).value).toBe('Doors in total: 9');
  });
  it('merged: the label carries the count and the Count cell keeps it', () => {
    const merged = doors({ itemize: false, columns: [{ field: TYPE }] as Column[] });
    const csv = toCsv(toRows(fullResult(store, merged))).split('\r\n');
    expect(csv.at(-1)).toBe('Grand total: 9,9');
  });
  it('the assistant’s read-back: the label as the engine wrote it, the count beside it, never twice in the label', () => {
    const out = readSchedule(store, def, store.cores.map((_, i) => i)).forModel as { grandTotal: { label: string; count: number } };
    expect(out.grandTotal).toMatchObject({ label: 'Doors in total: 9', count: 9 });
  });
});
