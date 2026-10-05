import { describe, expect, it } from 'vitest';
import { StoreBuilder, type ModelStore } from '../../../src/schedule/ifc/store';
import type { Cell, ElemCore, ModelMeta } from '../../../src/schedule/ifc/types';
import { emptySchedule, type Column, type ScheduleDef } from '../../../src/schedule/schedule/def';
import { runSchedule, type DataRow, type GrandRow } from '../../../src/schedule/schedule/engine';
import { planComputed } from '../../../src/schedule/schedule/computed';

const meta: ModelMeta = {
  fileName: 'f.ifc', schema: 'IFC4', projectName: '', authoringTool: '',
  lengthUnit: 'mm', unitSystem: 'metric', elementCount: 0, parseMs: 0,
};

function build(specs: { area?: number; type?: string; mark?: string }[]): ModelStore {
  const b = new StoreBuilder();
  const cores: ElemCore[] = [];
  const cells: Record<string, Cell>[] = [];
  specs.forEach((s, i) => {
    cores.push({ entity: 'IfcSpace', name: `S${i}`, description: '', mark: s.mark ?? `M${i}`,
      typeName: s.type ?? 'T1', family: 'Fam', objectType: '', predefinedType: '',
      guid: `g${i}`, storey: 'L1', storeyElevation: 0, building: '', site: '', space: '',
      material: '', discipline: 'ARC',
    });
    cells.push(s.area === undefined ? {} : { 'Qto_SpaceBaseQuantities.NetFloorArea': { v: s.area, k: 'area' } });
  });
  b.add(cores, cells);
  return b.finish(meta);
}

const colArea: Column = {
  field: { kind: 'prop', pset: 'Qto_SpaceBaseQuantities', prop: 'NetFloorArea' },
  heading: 'Area',
  format: { display: 'm²', decimals: 2 },
};

function def(over: Partial<ScheduleDef> = {}): ScheduleDef {
  return { ...emptySchedule('S', ['IfcSpace']), columns: [colArea], ...over };
}

const data = (r: { kind: string }[]) => r.filter((x) => x.kind === 'data') as DataRow[];

describe('formula columns', () => {
  it('computes from another column, by its heading', () => {
    const store = build([{ area: 10 }, { area: 20 }]);
    const res = runSchedule(store, def({
      calculated: [{ id: 'c1', name: 'Area +15%', kind: 'formula', unitKind: 'area', formula: 'Area * 1.15' }],
      columns: [colArea, { field: { kind: 'formula', id: 'c1' }, format: { display: 'm²', decimals: 2 } }],
    }));
    expect(data(res.rows).map((d) => d.cells)).toEqual([['10.00', '11.50'], ['20.00', '23.00']]);
  });

  it('renders blank where an operand is missing, not NaN', () => {
    const store = build([{ area: 10 }, {}]);
    const res = runSchedule(store, def({
      calculated: [{ id: 'c1', name: 'Double', kind: 'formula', unitKind: 'area', formula: 'Area * 2' }],
      columns: [colArea, { field: { kind: 'formula', id: 'c1' }, format: { display: 'm²', decimals: 2 } }],
    }));
    expect(data(res.rows).map((d) => d.cells[1])).toEqual(['20.00', '']);
  });

  it('reports a parse error instead of throwing', () => {
    const d = def({ calculated: [{ id: 'c1', name: 'Bad', kind: 'formula', formula: '1 +' }] });
    expect(planComputed(d).errors.get('c1')).toBeTruthy();
    // and the schedule still renders
    expect(() => runSchedule(build([{ area: 1 }]), d)).not.toThrow();
  });

  it('can be totalled, and may reference a hidden column', () => {
    const store = build([{ area: 10 }, { area: 20 }]);
    const res = runSchedule(store, def({
      calculated: [{ id: 'c1', name: 'Half', kind: 'formula', unitKind: 'area', formula: 'Area / 2' }],
      columns: [
        { ...colArea, hidden: true },
        { field: { kind: 'formula', id: 'c1' }, format: { display: 'm²', decimals: 2 }, total: 'sum' },
      ],
      grandTotal: true,
    }));
    expect(res.headings).toEqual(['Half']);
    expect((res.rows.find((r) => r.kind === 'grand') as GrandRow).cells[0]).toBe('15.00');
  });
});

describe('percentage columns', () => {
  it('expresses each row as a share of the total, summing to 100', () => {
    const store = build([{ area: 25 }, { area: 25 }, { area: 50 }]);
    const res = runSchedule(store, def({
      calculated: [{ id: 'p1', name: '% of area', kind: 'percentage', ofField: colArea.field }],
      columns: [colArea, { field: { kind: 'formula', id: 'p1' }, format: { decimals: 1, suffix: '%' } }],
    }));
    expect(data(res.rows).map((d) => d.cells[1])).toEqual(['25.0%', '25.0%', '50.0%']);
  });

  it('is computed over the FILTERED rows, not the whole model', () => {
    const store = build([{ area: 25 }, { area: 25 }, { area: 50 }]);
    const res = runSchedule(store, def({
      filters: [{ field: colArea.field, op: '<', value: 30 }],
      calculated: [{ id: 'p1', name: '%', kind: 'percentage', ofField: colArea.field }],
      columns: [colArea, { field: { kind: 'formula', id: 'p1' }, format: { decimals: 0, suffix: '%' } }],
    }));
    expect(data(res.rows).map((d) => d.cells[1])).toEqual(['50%', '50%']);
  });

  it('blanks rather than dividing by zero when the total is zero', () => {
    const store = build([{ area: 0 }, { area: 0 }]);
    const res = runSchedule(store, def({
      calculated: [{ id: 'p1', name: '%', kind: 'percentage', ofField: colArea.field }],
      columns: [{ field: { kind: 'formula', id: 'p1' }, format: { decimals: 0 } }],
    }));
    expect(data(res.rows).map((d) => d.cells[0])).toEqual(['', '']);
  });
});
