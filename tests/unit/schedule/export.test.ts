import { describe, expect, it } from 'vitest';
import { StoreBuilder, type ModelStore } from '../../../src/schedule/ifc/store';
import type { Cell, ElemCore, ModelMeta } from '../../../src/schedule/ifc/types';
import { emptySchedule, parseScheduleDef, ScheduleImportError, type Column, type ScheduleDef } from '../../../src/schedule/schedule/def';
import { runSchedule, type GrandRow } from '../../../src/schedule/schedule/engine';
import { csvCell, toCsv } from '../../../src/schedule/export/csv';
import { fullResult, toRows } from '../../../src/schedule/export/rows';
import { argbOf, sheetName, xlsxBlob } from '../../../src/schedule/export/xlsx';

const meta: ModelMeta = {
  fileName: 'f.ifc', schema: 'IFC4', projectName: '', authoringTool: '',
  lengthUnit: 'mm', unitSystem: 'metric', elementCount: 0, parseMs: 0,
};

function build(specs: { name?: string; storey?: string; w?: number; flag?: boolean }[]): ModelStore {
  const b = new StoreBuilder();
  const cores: ElemCore[] = [];
  const cells: Record<string, Cell>[] = [];
  specs.forEach((s, i) => {
    cores.push({ entity: 'IfcDoor', name: s.name ?? `D${i}`, description: '', mark: '',
      typeName: 'T', family: 'F', objectType: '', predefinedType: '', guid: `g${i}`,
      storey: s.storey ?? 'L1', storeyElevation: 0, building: '', site: '', space: '',
      material: '', discipline: 'ARC',
    });
    const cell: Record<string, Cell> = {};
    if (s.w !== undefined) cell['P.Width'] = { v: s.w, k: 'length' };
    if (s.flag !== undefined) cell['P.Flag'] = { v: s.flag };
    cells.push(cell);
  });
  b.add(cores, cells);
  return b.finish(meta);
}

const colName: Column = { field: { kind: 'core', key: 'name' }, heading: 'Name' };
const colWidth: Column = {
  field: { kind: 'prop', pset: 'P', prop: 'Width' },
  heading: 'Width', format: { display: 'mm', decimals: 0 }, total: 'sum',
};

describe('csvCell quoting', () => {
  it('quotes only when it must', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('has,comma')).toBe('"has,comma"');
    expect(csvCell('has"quote')).toBe('"has""quote"');
    expect(csvCell('has\nnewline')).toBe('"has\nnewline"');
    expect(csvCell('')).toBe('');
  });
});

describe('CSV export', () => {
  it('includes the header and every data row', () => {
    const store = build([{ name: 'A', w: 0.9 }, { name: 'B', w: 1.2 }]);
    const def: ScheduleDef = { ...emptySchedule('S', ['IfcDoor']), columns: [colName, colWidth] };
    const csv = toCsv(toRows(fullResult(store, def)));
    expect(csv.split('\r\n')).toEqual(['Name,Width', 'A,900', 'B,1200']);
  });

  it('escapes values that contain commas — real type names do', () => {
    const store = build([{ name: 'Door, double leaf' }]);
    const def: ScheduleDef = { ...emptySchedule('S', ['IfcDoor']), columns: [colName] };
    expect(toCsv(toRows(fullResult(store, def)))).toContain('"Door, double leaf"');
  });

  it('carries group headers, footers and the grand total', () => {
    const store = build([
      { name: 'A', storey: 'L1', w: 1 }, { name: 'B', storey: 'L2', w: 2 },
    ]);
    const def: ScheduleDef = {
      ...emptySchedule('S', ['IfcDoor']),
      columns: [colName, colWidth],
      sort: [{ field: { kind: 'core', key: 'storey' }, dir: 'asc', header: true, footer: 'totals' }],
      grandTotal: true,
    };
    const rows = toRows(fullResult(store, def));
    expect(rows.map((r) => r.kind)).toEqual([
      'header', 'group', 'data', 'footer', 'group', 'data', 'footer', 'grand',
    ]);
    // every exported row has the same width as the header
    const width = rows[0].cells.length;
    expect(rows.every((r) => r.cells.length === width)).toBe(true);
    expect(rows.at(-1)!.cells).toEqual(['Grand total', '3000']);
  });

  it('exports every row even when the render was capped', () => {
    const store = build(Array.from({ length: 5100 }, (_, i) => ({ name: `D${i}` })));
    const def: ScheduleDef = { ...emptySchedule('S', ['IfcDoor']), columns: [colName] };
    const res = fullResult(store, def);
    expect(runSchedule(store, def).truncated).toBe(true);
    // the render stops at 5,000; the export must not
    expect(toRows(res).filter((r) => r.kind === 'data').length).toBe(5100);
  });
});

describe('the Count column', () => {
  // A collapsed schedule hides how many elements each line stands for unless Count is
  // there — and an export that disagreed with the screen would be worse than useless.
  const collapsed = (): ScheduleDef => ({
    ...emptySchedule('S', ['IfcDoor']),
    columns: [colName],
    itemize: false,
    grandTotal: true,
  });

  it('appears only when rows were collapsed', () => {
    const store = build([{ name: 'A' }, { name: 'A' }, { name: 'B' }]);
    expect(runSchedule(store, collapsed()).countColumn).toBe(true);
    expect(runSchedule(store, { ...collapsed(), itemize: true }).countColumn).toBe(false);
  });

  it('carries the run length into the export, and every row stays the same width', () => {
    const store = build([{ name: 'A' }, { name: 'A' }, { name: 'A' }, { name: 'B' }]);
    const rows = toRows(fullResult(store, collapsed()));
    const widths = new Set(rows.map((r) => r.cells.length));
    expect(widths).toEqual(new Set([2]));
    expect(rows[0].cells).toEqual(['Name', 'Count']);
    expect(rows.filter((r) => r.kind === 'data').map((r) => r.cells)).toEqual([['A', '3'], ['B', '1']]);
    // The grand total counts elements, not collapsed lines.
    expect(rows.find((r) => r.kind === 'grand')?.cells[1]).toBe('4');
  });

  it('leaves an itemised export exactly as it was', () => {
    const store = build([{ name: 'A' }, { name: 'B' }]);
    const rows = toRows(fullResult(store, { ...collapsed(), itemize: true, grandTotal: false }));
    expect(rows.map((r) => r.cells)).toEqual([['Name'], ['A'], ['B']]);
  });
});

describe('schedule definition round-trip', () => {
  const def: ScheduleDef = {
    ...emptySchedule('Door Schedule', ['IfcDoor']),
    columns: [colName, colWidth],
    filters: [{ field: colWidth.field, op: '>=', value: 0.9 }],
    sort: [{ field: { kind: 'core', key: 'storey' }, dir: 'asc', header: true }],
    calculated: [{ id: 'c1', name: 'Double', kind: 'formula', formula: 'Width * 2' }],
    itemize: false,
    grandTotal: true,
  };

  it('survives JSON export and import unchanged', () => {
    const back = parseScheduleDef(JSON.parse(JSON.stringify(def)));
    expect(back.columns).toEqual(def.columns);
    expect(back.filters).toEqual(def.filters);
    expect(back.sort).toEqual(def.sort);
    expect(back.calculated).toEqual(def.calculated);
    expect(back.itemize).toBe(false);
    expect(back.grandTotal).toBe(true);
    expect(back.entity).toEqual(['IfcDoor']);
  });

  it('produces an identical table after a round-trip', () => {
    const store = build([{ name: 'A', w: 0.9 }, { name: 'B', w: 1.2 }]);
    const a = runSchedule(store, def);
    const b = runSchedule(store, parseScheduleDef(JSON.parse(JSON.stringify(def))));
    expect(JSON.stringify(b.rows)).toBe(JSON.stringify(a.rows));
    expect(b.headings).toEqual(a.headings);
  });

  it('rejects a newer version with a message naming the version', () => {
    expect(() => parseScheduleDef({ ...def, version: 99 })).toThrow(ScheduleImportError);
    expect(() => parseScheduleDef({ ...def, version: 99 })).toThrow(/v99/);
  });

  it('rejects files that are not schedules', () => {
    expect(() => parseScheduleDef({ hello: 'world' })).toThrow(ScheduleImportError);
    expect(() => parseScheduleDef(null)).toThrow(ScheduleImportError);
  });

  it('ignores unknown keys from a future build rather than failing', () => {
    const back = parseScheduleDef({ ...def, somethingNew: { a: 1 } });
    expect(back.name).toBe('Door Schedule');
  });
});

// ---------------------------------------------------------------- XLSX (phase 4)
// The 16 cases deferred since phase 1, restored with the exporter (2026-09-25).

describe('workbook sheet names', () => {
  // Excel silently refuses several characters, truncates past 31, and cannot hold two
  // sheets with the same name — so two saved schedules called "Doors" would lose one.
  it('strips the characters Excel rejects and truncates to 31', () => {
    const taken = new Set<string>();
    expect(sheetName('Doors: L1/L2 [rev?]', taken)).toBe('Doors L1L2 rev');
    expect(sheetName('x'.repeat(50), new Set())).toHaveLength(31);
  });

  it('de-duplicates rather than overwriting', () => {
    const taken = new Set<string>();
    expect(sheetName('Doors', taken)).toBe('Doors');
    expect(sheetName('Doors', taken)).toBe('Doors (2)');
    expect(sheetName('doors', taken)).toBe('doors (3)');
  });

  it('never returns an empty name', () => {
    expect(sheetName('///', new Set())).toBe('Schedule');
    expect(sheetName('   ', new Set())).toBe('Schedule');
  });

  it('keeps a de-duplicated name within the 31-character limit', () => {
    const taken = new Set<string>();
    const long = 'y'.repeat(31);
    sheetName(long, taken);
    expect(sheetName(long, taken).length).toBeLessThanOrEqual(31);
  });
});

describe('workbook round-trip', () => {
  // Read the workbook back with the same library that wrote it — a byte count proves
  // nothing about whether the sheets are right.
  it('writes one sheet per schedule, with the right names and rows', async () => {
    const store = build([{ name: 'A', w: 0.9 }, { name: 'B', w: 1.2 }]);
    const doors: ScheduleDef = { ...emptySchedule('Doors', ['IfcDoor']), columns: [colName, colWidth] };
    const blob = await xlsxBlob([
      { name: 'Doors', res: fullResult(store, doors) },
      { name: 'Doors', res: fullResult(store, doors) },       // same name on purpose
      { name: 'Missing', res: fullResult(store, { ...doors, entity: ['IfcWall'] }),
        note: 'This model has no IfcWall — nothing to schedule.' },
    ]);

    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());

    expect(wb.worksheets.map((w) => w.name)).toEqual(['Doors', 'Doors (2)', 'Missing']);

    const first = wb.getWorksheet('Doors')!;
    expect(first.getRow(1).values).toEqual([undefined, 'Name', 'Width']);
    // The widths arrive as numbers, not as the text of numbers — see the next describe.
    expect(first.getRow(2).values).toEqual([undefined, 'A', 900]);
    expect(first.getRow(3).values).toEqual([undefined, 'B', 1200]);

    // A schedule whose class this model lacks still gets a sheet that says so, rather
    // than being silently dropped from a workbook that then looks complete.
    const missing = wb.getWorksheet('Missing')!;
    expect(String(missing.getRow(2).getCell(1).value)).toContain('no IfcWall');
  }, 30_000);
});

describe('numbers are numbers in the workbook', () => {
  // Cells used to be written as text, so every SUM and pivot in Excel needed cleaning up
  // first. A numeric cell now holds the DISPLAY value — converted and rounded exactly as
  // the schedule shows it — under a number format that reproduces the look. What Excel
  // adds up is therefore what the reader reads, and a collapsed line, which stands for
  // several elements that all format alike, has one unambiguous number.
  const width = (heading: string, format: Column['format'], total?: Column['total']): Column => ({
    field: { kind: 'prop', pset: 'P', prop: 'Width' }, heading, format, total,
  });
  const schedule = (over: Partial<ScheduleDef>): ScheduleDef =>
    ({ ...emptySchedule('S', ['IfcDoor']), ...over });

  /** Write the schedule and read the sheet back, which is the only honest check. */
  const sheet = async (store: ModelStore, def: ScheduleDef) => {
    const blob = await xlsxBlob([{ name: 'S', res: fullResult(store, def) }]);
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    return wb.getWorksheet('S')!;
  };

  it('writes the display value, under a format that reproduces the column', async () => {
    // 0.9 m in the store: 900 to a millimetre column, 0.90 to a metre column.
    const ws = await sheet(build([{ name: 'A', w: 0.9 }]), schedule({
      columns: [colName, width('mm', { display: 'mm', decimals: 0 }),
        width('m', { display: 'm', decimals: 2 })],
    }));
    const mm = ws.getRow(2).getCell(2);
    expect(typeof mm.value).toBe('number');
    expect(mm.value).toBe(900);
    expect(mm.numFmt).toBe('#,##0');

    const m = ws.getRow(2).getCell(3);
    expect(m.value).toBe(0.9);
    expect(m.numFmt).toBe('#,##0.00');
  }, 30_000);

  it('carries the symbol, the prefix and the suffix as literal text', async () => {
    const ws = await sheet(build([{ w: 0.9 }]), schedule({
      columns: [width('Symbol', { display: 'mm', decimals: 0, showSymbol: true }),
        width('Affixed', { display: 'm', decimals: 2, prefix: '$', suffix: ' ea' })],
    }));
    expect(ws.getRow(2).getCell(1).value).toBe(900);
    expect(ws.getRow(2).getCell(1).numFmt).toBe('#,##0" mm"');
    expect(ws.getRow(2).getCell(2).value).toBe(0.9);
    expect(ws.getRow(2).getCell(2).numFmt).toBe('"$"#,##0.00" ea"');
  }, 30_000);

  it('groups only where the column groups', async () => {
    const ws = await sheet(build([{ w: 1.2 }]), schedule({
      columns: [width('Plain', { display: 'mm', decimals: 0, thousands: false })],
    }));
    expect(ws.getRow(2).getCell(1).value).toBe(1200);
    expect(ws.getRow(2).getCell(1).numFmt).toBe('0');
  }, 30_000);

  it('leaves a suppressed zero blank rather than writing a 0', async () => {
    const ws = await sheet(build([{ w: 0 }]), schedule({
      columns: [width('W', { display: 'mm', decimals: 0, suppressZero: true })],
    }));
    const cell = ws.getRow(2).getCell(1);
    expect(cell.value ?? '').toBe('');
    expect(typeof cell.value).not.toBe('number');
  }, 30_000);

  it('leaves text and yes/no as text', async () => {
    const ws = await sheet(build([{ name: 'A', flag: true }]), schedule({
      columns: [colName, { field: { kind: 'prop', pset: 'P', prop: 'Flag' }, heading: 'Flag' }],
    }));
    expect(ws.getRow(2).getCell(1).value).toBe('A');
    expect(ws.getRow(2).getCell(2).value).toBe('Yes');
  }, 30_000);

  it('writes the Count column as a number too', async () => {
    const ws = await sheet(build([{ name: 'A' }, { name: 'A' }, { name: 'B' }]),
      schedule({ columns: [colName], itemize: false }));
    expect(ws.getRow(2).getCell(1).value).toBe('A');
    expect(ws.getRow(2).getCell(2).value).toBe(2);
    expect(ws.getRow(2).getCell(2).numFmt).toBe('0');
  }, 30_000);

  it('totals a group and the whole schedule as the figures they read', async () => {
    const store = build([{ name: 'A', storey: 'L1', w: 0.9 }, { name: 'B', storey: 'L2', w: 1.2 }]);
    const def = schedule({
      columns: [colName, width('Width', { display: 'mm', decimals: 0 }, 'sum')],
      sort: [{ field: { kind: 'core', key: 'storey' }, dir: 'asc', header: true, footer: 'totals' }],
      grandTotal: true,
    });
    const ws = await sheet(store, def);
    // header · group · data · footer · group · data · footer · grand
    expect(ws.getRow(4).getCell(2).value).toBe(900);
    const grand = ws.getRow(8).getCell(2);
    expect(grand.value).toBe(2100);
    expect(grand.numFmt).toBe('#,##0');
    // and 2,100 is exactly what the schedule shows on screen
    const shown = runSchedule(store, def).rows.find((r) => r.kind === 'grand') as GrandRow;
    expect(shown.cells[1]).toBe('2,100');
  }, 30_000);

  it('writes a count total as the plain integer it is, not in the column unit', async () => {
    // "3 mm" would be nonsense: a count is not a measurement, whatever it sits under.
    const ws = await sheet(build([{ w: 0.9 }, { w: 1.2 }]), schedule({
      columns: [width('Width', { display: 'mm', decimals: 0, showSymbol: true }, 'count')],
      grandTotal: true,
    }));
    expect(ws.getRow(2).getCell(1).numFmt).toBe('#,##0" mm"');
    expect(ws.getRow(4).getCell(1).value).toBe(2);
    expect(ws.getRow(4).getCell(1).numFmt).toBe('0');
  }, 30_000);
});

describe('argbOf', () => {
  // Excel wants 'FF' + RRGGBB uppercase; the picker stores one of three CSS forms.
  it('expands every form the colour sanitiser accepts', () => {
    expect(argbOf('#abc')).toBe('FFAABBCC');
    expect(argbOf('#A1B2C3')).toBe('FFA1B2C3');
    expect(argbOf('#a1b2c3')).toBe('FFA1B2C3');
    expect(argbOf('rgb(255, 0, 10)')).toBe('FFFF000A');
    expect(argbOf('RGB(0,0,0)')).toBe('FF000000');
  });

  it('hands back undefined rather than guessing at anything else', () => {
    expect(argbOf('red')).toBeUndefined();
    expect(argbOf('#ab')).toBeUndefined();
    expect(argbOf('rgba(1, 2, 3, 0.5)')).toBeUndefined();
    expect(argbOf('')).toBeUndefined();
  });
});

describe('rule colours in the workbook', () => {
  // Print forces the fill onto paper; the workbook has to carry it too, decided by the same
  // firingRule the table paints with. An export that drops what the screen shows is a lie.
  it('paints the claimed cells only, in every colour form', async () => {
    const store = build([{ name: 'A', storey: 'L1', w: 0.9 }, { name: 'B', storey: 'L2', w: 1.2 }]);
    const def: ScheduleDef = {
      ...emptySchedule('Doors', ['IfcDoor']),
      columns: [
        { ...colName, conditional: [{ op: '=', value: 'B', bg: '#f8d7da', fg: '#58151c', bold: true }] },
        { field: { kind: 'core', key: 'storey' }, heading: 'Level',
          conditional: [{ op: '=', value: 'L2', bg: '#0f0' }] },
        { ...colWidth, conditional: [{ op: '=', value: '1200', bg: 'rgb(255, 0, 10)' }] },
      ],
    };
    const blob = await xlsxBlob([{ name: 'Doors', res: fullResult(store, def) }]);

    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    const ws = wb.getWorksheet('Doors')!;

    // Row 3 is "B · L2 · 1200" — one rule fires in each column.
    const claimed = ws.getRow(3).getCell(1);
    expect(claimed.value).toBe('B');
    expect(claimed.fill).toMatchObject({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D7DA' } });
    expect(claimed.font).toMatchObject({ color: { argb: 'FF58151C' }, bold: true });
    expect(ws.getRow(3).getCell(2).fill).toMatchObject({ fgColor: { argb: 'FF00FF00' } });
    expect(ws.getRow(3).getCell(3).fill).toMatchObject({ fgColor: { argb: 'FFFF000A' } });

    // Row 2 is "A · L1 · 900" — no rule claims it, so nothing is painted.
    const plain = ws.getRow(2).getCell(1);
    expect(plain.value).toBe('A');
    expect(plain.fill).toBeUndefined();
    expect(plain.font?.color).toBeUndefined();
    expect(plain.font?.bold).toBeFalsy();

    // The heading keeps the schedule's own style; a rule never reaches it. Excel spells a
    // styled-but-unfilled cell as the "none" pattern rather than leaving the fill out.
    const head = ws.getRow(1).getCell(1);
    expect(head.value).toBe('Name');
    expect(head.fill).toMatchObject({ pattern: 'none' });
    expect(head.font?.color).toBeUndefined();
  }, 30_000);
});
