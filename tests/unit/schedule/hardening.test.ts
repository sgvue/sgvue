// Regression tests for the findings from the code review. Each of these was a real
// defect, so each gets a test that fails if it comes back.

import { describe, expect, it } from 'vitest';
import { StoreBuilder, type ModelStore } from '../../../src/schedule/ifc/store';
import type { Cell, ElemCore, ModelMeta } from '../../../src/schedule/ifc/types';
import { emptySchedule, parseScheduleDef, ScheduleImportError, type Column, type ScheduleDef } from '../../../src/schedule/schedule/def';
import { candidateRows, runSchedule, type GrandRow } from '../../../src/schedule/schedule/engine';
import { planComputed } from '../../../src/schedule/schedule/computed';
import { formatCell, formatNumber } from '../../../src/schedule/schedule/format';
import { csvCell } from '../../../src/schedule/export/csv';
// Phase 2 (2026-09-25): the inspector, the coverage sweep and the window's state are ported now.
import { renderInspector } from '../../../src/renderer/schedule-ui/inspector';
import { buildCoverage } from '../../../src/renderer/schedule-ui/coverage';
import { state as blankState, type AppState } from '../../../src/renderer/schedule-ui/state';

const meta: ModelMeta = {
  fileName: 'f.ifc', schema: 'IFC4', projectName: '', authoringTool: '',
  lengthUnit: 'mm', unitSystem: 'metric', elementCount: 0, parseMs: 0,
};

function build(n: number, value: (i: number) => number | undefined, name = (i: number) => `E${i}`): ModelStore {
  const b = new StoreBuilder();
  const cores: ElemCore[] = [];
  const cells: Record<string, Cell>[] = [];
  for (let i = 0; i < n; i++) {
    cores.push({ entity: 'IfcWall', name: name(i), description: '', mark: '',
      typeName: 'T', family: 'F', objectType: '', predefinedType: '',
      guid: `g${i}`, storey: 'L1', storeyElevation: 0, building: '', site: '', space: '',
      material: '', discipline: 'ARC',
    });
    const v = value(i);
    cells.push(v === undefined ? {} : { 'P.W': { v, k: 'length' } });
  }
  b.add(cores, cells);
  return b.finish(meta);
}

const colName: Column = { field: { kind: 'core', key: 'name' }, heading: 'Name' };
const colW: Column = { field: { kind: 'prop', pset: 'P', prop: 'W' }, heading: 'W', format: { decimals: 0 } };

describe('the store index is never mutated by running a schedule', () => {
  it('leaves byEntity in model order after a sorted schedule', () => {
    const store = build(5, (i) => 5 - i);
    const before = [...store.byEntity.get('IfcWall')!];

    runSchedule(store, {
      ...emptySchedule('S', ['IfcWall']),
      columns: [colW],
      sort: [{ field: colW.field, dir: 'asc' }],
    });

    expect(store.byEntity.get('IfcWall')).toEqual(before);
  });

  it('gives each run a fresh array', () => {
    const store = build(3, () => 1);
    const a = candidateRows(store, { ...emptySchedule('S', ['IfcWall']), columns: [] });
    expect(a).not.toBe(store.byEntity.get('IfcWall'));
    a.reverse();
    expect(store.byEntity.get('IfcWall')).toEqual([0, 1, 2]);
  });

  it('an unsorted schedule still reads in model order after a sorted one ran', () => {
    const store = build(4, (i) => 4 - i);
    const def: ScheduleDef = { ...emptySchedule('S', ['IfcWall']), columns: [colName] };
    const first = runSchedule(store, def).rows
      .filter((r) => r.kind === 'data').map((r) => (r as { cells: string[] }).cells[0]);

    runSchedule(store, { ...def, columns: [colName, colW], sort: [{ field: colW.field, dir: 'asc' }] });

    const again = runSchedule(store, def).rows
      .filter((r) => r.kind === 'data').map((r) => (r as { cells: string[] }).cells[0]);
    expect(again).toEqual(first);
  });
});

describe('aggregates survive large row counts', () => {
  it('computes min and max over 200k rows without a stack overflow', () => {
    const store = build(200_000, (i) => i + 1);
    const base: ScheduleDef = { ...emptySchedule('S', ['IfcWall']), columns: [], grandTotal: true };
    // values are metres in the store; display in metres so the assertion reads plainly
    const grand = (total: Column['total']) => (runSchedule(store, {
      ...base, columns: [{ ...colW, total, format: { display: 'm', decimals: 0, thousands: false } }],
    }).rows.find((r) => r.kind === 'grand') as GrandRow).cells[0];

    expect(grand('min')).toBe('1');
    expect(grand('max')).toBe('200000');
  }, 60_000);
});

describe('non-finite values never reach the page', () => {
  it('renders Infinity and NaN as blank', () => {
    expect(formatNumber(Infinity, 'length')).toBe('');
    expect(formatNumber(-Infinity, 'length')).toBe('');
    expect(formatNumber(NaN, 'length')).toBe('');
    expect(formatCell({ v: Infinity, k: 'length' })).toBe('');
  });

  it('still renders ordinary numbers', () => {
    expect(formatNumber(0.9, 'length')).toBe('900');
  });
});

describe('CSV never hands a spreadsheet a formula', () => {
  it('defuses cells that start with a formula trigger', () => {
    // an element could genuinely be named this in Revit
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('+cmd|calc')).toBe("'+cmd|calc");
    expect(csvCell('-cmd|calc')).toBe("'-cmd|calc");
  });

  it('leaves ordinary text and negative numbers alone', () => {
    expect(csvCell('Door 1200x2400')).toBe('Door 1200x2400');
    expect(csvCell('-5')).toBe('-5');
    expect(csvCell('-1234.56')).toBe('-1234.56');
  });
});

describe('imported schedules are sanitised', () => {
  const base = {
    version: 1,
    name: 'Imported',
    entity: ['IfcWall'],
    columns: [{ field: { kind: 'core', key: 'name' } }],
    filters: [],
    sort: [],
    itemize: true,
    grandTotal: false,
  };

  it('rejects a string where a number belongs, instead of writing it into an attribute', () => {
    const evil = { ...base, columns: [{ field: { kind: 'core', key: 'name' }, width: '1" onmouseover="alert(1)' }] };
    expect(parseScheduleDef(evil).columns[0].width).toBeUndefined();
  });

  it('clamps out-of-range numbers', () => {
    const d = parseScheduleDef({ ...base, appearance: { fontSize: 100000 } });
    expect(d.appearance!.fontSize).toBeLessThanOrEqual(48);
  });

  it('drops a conditional colour that is not a literal colour', () => {
    const evil = {
      ...base,
      columns: [{
        field: { kind: 'core', key: 'name' },
        conditional: [{ op: '=', value: 'x', bg: 'url(https://evil.example/x)' }],
      }],
    };
    // a url() would make the page fetch something just by rendering
    expect(parseScheduleDef(evil).columns[0].conditional![0].bg).toBeUndefined();
    const ok = parseScheduleDef({
      ...base,
      columns: [{ field: { kind: 'core', key: 'name' }, conditional: [{ op: '=', bg: '#ff0000' }] }],
    });
    expect(ok.columns[0].conditional![0].bg).toBe('#ff0000');
  });

  it('caps filter and sort counts at the documented limits', () => {
    const many = Array.from({ length: 30 }, () => ({ field: { kind: 'core', key: 'name' }, op: 'hasValue' }));
    const d = parseScheduleDef({ ...base, filters: many, sort: many.map((f) => ({ ...f, dir: 'asc' })) });
    expect(d.filters.length).toBe(8);
    expect(d.sort.length).toBe(4);
  });

  it('rejects a file whose columns are all unusable', () => {
    expect(() => parseScheduleDef({ ...base, columns: [{ nope: 1 }, 'x', null] }))
      .toThrow(ScheduleImportError);
  });
});

describe('formula variables are never bound ambiguously', () => {
  it('refuses to guess when two columns share a heading', () => {
    const def: ScheduleDef = {
      ...emptySchedule('S', ['IfcWall']),
      columns: [
        { field: { kind: 'prop', pset: 'A', prop: 'Ref' } },
        { field: { kind: 'prop', pset: 'B', prop: 'Ref' } },
      ],
      calculated: [{ id: 'c1', name: 'X', kind: 'formula', formula: 'Ref * 2' }],
    };
    const plan = planComputed(def);
    expect([...plan.errors.keys()].some((k) => k.startsWith('ambiguous:'))).toBe(true);

    // and the value is blank rather than silently taken from one of them
    const store = build(1, () => 1);
    const res = runSchedule(store, { ...def, columns: [...def.columns, { field: { kind: 'formula', id: 'c1' } }] });
    const row = res.rows.find((r) => r.kind === 'data') as { cells: string[] };
    expect(row.cells[2]).toBe('');
  });
});

describe('the Align control says what the table does', () => {
  // `alignOf` gives a column with a total — or a decimal count — the Revit default of right
  // when its author picked nothing. The panel read `col.align ?? 'left'` instead, so the
  // table right-aligned the column while the control showed Left pressed.
  const pressed = (html: string, v: 'left' | 'center' | 'right') =>
    new RegExp(`data-v="${v}"[^>]*aria-pressed="true"`).test(html);

  const inspect = (col: Column) => {
    const store = build(1, () => 1);
    const def: ScheduleDef = { ...emptySchedule('S', ['IfcWall']), columns: [col] };
    const state = { ...blankState, store, def, open: 'format' } as unknown as AppState;
    return renderInspector(state, store, buildCoverage(store, ['IfcWall']), runSchedule(store, def));
  };

  it('presses Right for a column with a total and no explicit align', () => {
    const html = inspect({ field: { kind: 'core', key: 'name' }, total: 'count' });
    expect(pressed(html, 'right')).toBe(true);
    expect(pressed(html, 'left')).toBe(false);
  });

  it('presses Left once the author says left', () => {
    const html = inspect({ field: { kind: 'core', key: 'name' }, total: 'count', align: 'left' });
    expect(pressed(html, 'left')).toBe(true);
    expect(pressed(html, 'right')).toBe(false);
  });
});

describe('the inspector escapes what it summarises', () => {
  // The five collapsed section headers show a live summary built from property names out
  // of the IFC file and values the user typed — neither is trusted. They were interpolated
  // raw, so a filter value of `<img onerror=…>` reached the DOM as markup.
  it('escapes filter values, field headings and level names in section summaries', () => {
    const store = build(1, () => 1, () => 'E0');
    const hostile = '"><img src=x onerror=alert(1)>';
    const def: ScheduleDef = {
      ...emptySchedule('S', ['IfcWall']),
      columns: [{ field: { kind: 'core', key: 'name' }, heading: hostile }],
      filters: [{ field: { kind: 'core', key: 'name' }, op: 'contains', value: hostile }],
      sort: [{ field: { kind: 'core', key: 'name' }, dir: 'asc' }],
    };
    const state = { ...blankState, store, def, open: null } as unknown as AppState;
    const html = renderInspector(state, store, buildCoverage(store, ['IfcWall']), runSchedule(store, def));

    // No tag is ever formed, and the quote that would break out of an attribute is escaped.
    expect(html).not.toContain('<img');
    expect(html).not.toContain('"><img');
    // The text is still shown to the user — escaped, not dropped.
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&quot;&gt;&lt;img');
  });
});
