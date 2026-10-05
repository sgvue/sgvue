import { describe, expect, it } from 'vitest';
import { StoreBuilder, type ModelStore } from '../../../src/schedule/ifc/store';
import type { Cell, ElemCore, ModelMeta } from '../../../src/schedule/ifc/types';
import { emptySchedule, type Column, type ScheduleDef } from '../../../src/schedule/schedule/def';
import { runSchedule, type DataRow, type FooterRow, type GrandRow, type GroupRow } from '../../../src/schedule/schedule/engine';
// Phase 2 (2026-09-25): the inspector's rule counter is ported now.
import { ruleEffects } from '../../../src/renderer/schedule-ui/panels/filterSection';

const meta: ModelMeta = {
  fileName: 'f.ifc', schema: 'IFC4', projectName: '', authoringTool: '',
  lengthUnit: 'mm', unitSystem: 'metric', elementCount: 0, parseMs: 0,
};

interface Spec { entity?: string; storey?: string; elev?: number; type?: string; width?: number }

function build(specs: Spec[]): ModelStore {
  const b = new StoreBuilder();
  const cores: ElemCore[] = [];
  const cells: Record<string, Cell>[] = [];
  specs.forEach((s, i) => {
    cores.push({ entity: s.entity ?? 'IfcDoor', name: `E${i}`, description: '', mark: String(i),
      typeName: s.type ?? 'T1', family: 'F', objectType: '', predefinedType: 'DOOR',
      guid: `g${i}`, storey: s.storey ?? 'Level 1', storeyElevation: s.elev ?? 0,
      building: '', site: '', space: '', material: '', discipline: 'ARC',
    });
    cells.push(s.width === undefined ? {} : { 'Pset_DoorCommon.Width': { v: s.width, k: 'length' } });
  });
  b.add(cores, cells);
  return b.finish(meta);
}

const colType: Column = { field: { kind: 'core', key: 'typeName' } };
const colStorey: Column = { field: { kind: 'core', key: 'storey' } };
const colWidth: Column = {
  field: { kind: 'prop', pset: 'Pset_DoorCommon', prop: 'Width' },
  format: { display: 'mm', decimals: 0 },
};

function def(over: Partial<ScheduleDef> = {}): ScheduleDef {
  return { ...emptySchedule('S', ['IfcDoor']), columns: [colType, colWidth], ...over };
}

const data = (r: { kind: string }[]) => r.filter((x) => x.kind === 'data') as DataRow[];
const groups = (r: { kind: string }[]) => r.filter((x) => x.kind === 'group') as GroupRow[];
const footers = (r: { kind: string }[]) => r.filter((x) => x.kind === 'footer') as FooterRow[];

describe('showing what one filter rule removes', () => {
  // The inspector states "removes N" and clicking shows those rows. If invertRule and the
  // counter disagreed, the number and the table would contradict each other.
  const store = build([
    { type: 'A', width: 0.8 }, { type: 'A', width: 1.2 },
    { type: 'B', width: 0.8 }, { type: 'B', width: 1.2 },
  ]);
  const wide = { field: colWidth.field, op: '>=' as const, value: 1.0 };
  const isA = { field: colType.field, op: '=' as const, value: 'A' };

  it('returns the rows this rule drops that the others would have kept (AND)', () => {
    const d = def({ filters: [isA, wide], filterLogic: 'and' });
    // Normally: A and wide -> one row.
    expect(runSchedule(store, d).matchedElements).toBe(1);
    // What rule 2 costs: the A that is not wide. The B rows are already out on rule 1.
    const res = runSchedule(store, d, { invertRule: 1 });
    expect(res.matchedElements).toBe(1);
    expect(data(res.rows)[0].cells[0]).toBe('A');
  });

  it('under OR, a rule only answers for rows the others reject', () => {
    const d = def({ filters: [isA, wide], filterLogic: 'or' });
    expect(runSchedule(store, d).matchedElements).toBe(3);
    // Rows the OTHER rule (isA) rejects and this one also rejects: B at 0.8.
    const res = runSchedule(store, d, { invertRule: 1 });
    expect(res.matchedElements).toBe(1);
    expect(data(res.rows)[0].cells[0]).toBe('B');
  });

  it('with a single rule, shows everything that rule excludes', () => {
    const res = runSchedule(store, def({ filters: [wide] }), { invertRule: 0 });
    expect(res.matchedElements).toBe(2);
  });

  it('the inspector counter agrees with the engine on a formula column', () => {
    // ruleEffects resolved fields WITHOUT the computed values, so a rule on a calculated
    // column saw every row as blank: the panel said "keeps 0" while the table showed the
    // real rows. The two must be driven by the same computed plan.
    const d: ScheduleDef = {
      ...def(),
      calculated: [{ id: 'c1', name: 'Double', kind: 'formula', formula: 'Width * 2' }],
      columns: [colType, colWidth, { field: { kind: 'formula', id: 'c1' } }],
      filters: [{ field: { kind: 'formula', id: 'c1' }, op: '>=', value: 2 }],
    };
    const kept = runSchedule(store, d).matchedElements;
    const dropped = runSchedule(store, d, { invertRule: 0 }).matchedElements;
    const effect = ruleEffects(store, d)[0];

    expect(kept).toBeGreaterThan(0);          // the rule really does match something
    expect(effect.keeps).toBe(kept);
    expect(effect.removes).toBe(dropped);
  });

  it('ignores an index that names no rule', () => {
    const d = def({ filters: [isA] });
    expect(runSchedule(store, d, { invertRule: 7 }).matchedElements)
      .toBe(runSchedule(store, d).matchedElements);
  });
});

describe('filtering', () => {
  const store = build([{ width: 0.9 }, { width: 1.2 }, { width: 2.4 }, {}]);

  it('AND-s rules by default', () => {
    const res = runSchedule(store, def({
      filters: [
        { field: colWidth.field, op: '>=', value: 0.9 },
        { field: colWidth.field, op: '<', value: 2.4 },
      ],
    }));
    expect(res.matchedElements).toBe(2);
  });

  it('OR-s when asked', () => {
    const res = runSchedule(store, def({
      filterLogic: 'or',
      filters: [
        { field: colWidth.field, op: '<', value: 1 },
        { field: colWidth.field, op: '>', value: 2 },
      ],
    }));
    expect(res.matchedElements).toBe(2);
  });

  it('separates "has no value" from zero', () => {
    const res = runSchedule(store, def({ filters: [{ field: colWidth.field, op: 'noValue' }] }));
    expect(res.matchedElements).toBe(1);
  });
});

describe('sorting', () => {
  it('orders levels by elevation, so Level 2 precedes Level 10', () => {
    const store = build([
      { storey: 'Level 10', elev: 30 },
      { storey: 'Level 2', elev: 6 },
      { storey: 'Level 1', elev: 0 },
    ]);
    const res = runSchedule(store, def({
      columns: [colStorey],
      sort: [{ field: { kind: 'core', key: 'storeyElevation' }, dir: 'asc' }],
    }));
    expect(data(res.rows).map((d) => d.cells[0])).toEqual(['Level 1', 'Level 2', 'Level 10']);
  });

  it('grouping by Level shows the name but orders by elevation', () => {
    // Names alone would give "Level 1, Level 10, Level 2"; elevations put them right.
    // Names deliberately do NOT sort to the same order as elevations here.
    const store = build([
      { storey: 'Roof', elev: 30 },
      { storey: 'Basement', elev: -3 },
      { storey: 'Ground', elev: 0 },
    ]);
    const res = runSchedule(store, def({
      columns: [colStorey],
      sort: [{ field: { kind: 'core', key: 'storey' }, dir: 'asc', header: true }],
    }));
    expect(groups(res.rows).map((g) => g.label)).toEqual(['Basement', 'Ground', 'Roof']);
    expect(data(res.rows).map((d) => d.cells[0])).toEqual(['Basement', 'Ground', 'Roof']);
  });

  it('sorts text naturally too', () => {
    const store = build([{ storey: 'Level 10' }, { storey: 'Level 2' }, { storey: 'Level 1' }]);
    const res = runSchedule(store, def({
      columns: [colStorey],
      sort: [{ field: { kind: 'core', key: 'storey' }, dir: 'asc' }],
    }));
    expect(data(res.rows).map((d) => d.cells[0])).toEqual(['Level 1', 'Level 2', 'Level 10']);
  });

  it('respects descending', () => {
    const store = build([{ width: 0.9 }, { width: 2.4 }, { width: 1.2 }]);
    const res = runSchedule(store, def({ sort: [{ field: colWidth.field, dir: 'desc' }] }));
    expect(data(res.rows).map((d) => d.cells[1])).toEqual(['2,400', '1,200', '900']);
  });
});

describe('the number beside each cell', () => {
  // What an export writes into a spreadsheet cell. A collapsed line stands for several
  // elements that all format alike, so it has ONE number — the one its text shows.
  it('is the displayed figure, and null where the cell is not a number', () => {
    const store = build([{ type: 'A', width: 0.9 }, { type: 'A', width: 0.9 }]);
    const line = data(runSchedule(store, def({ itemize: false })).rows)[0];
    expect(line.count).toBe(2);
    expect(line.cells).toEqual(['A', '900']);
    expect(line.nums).toEqual([null, 900]);
  });

  it('says how each numeric column displays, for whoever has to reproduce it', () => {
    const res = runSchedule(build([{ width: 0.9 }]), def({
      columns: [colType, { ...colWidth, format: { display: 'm', decimals: 2, showSymbol: true } }],
    }));
    // Nothing for the text column; the measured one carries what formatNumber used.
    expect(res.numeric).toEqual({ 1: { decimals: 2, unit: 'm' } });
  });

  it('cannot disagree with a footer, because one aggregate makes both', () => {
    const res = runSchedule(build([{ width: 0.9 }, { width: 1.2 }]), def({
      columns: [colType, { ...colWidth, total: 'sum' }], grandTotal: true,
    }));
    const grand = res.rows.find((r) => r.kind === 'grand') as GrandRow;
    expect(grand.cells[1]).toBe('2,100');
    expect(grand.nums).toEqual([null, 2100]);
  });
});

describe('collapse (itemize off)', () => {
  it('merges identical rows and counts them', () => {
    const store = build([
      { type: 'A', width: 0.9 }, { type: 'A', width: 0.9 },
      { type: 'A', width: 0.9 }, { type: 'B', width: 1.2 },
    ]);
    const res = runSchedule(store, def({ itemize: false }));
    const d = data(res.rows);
    expect(d.length).toBe(2);
    expect(d.find((x) => x.cells[0] === 'A')!.count).toBe(3);
    expect(d.find((x) => x.cells[0] === 'B')!.count).toBe(1);
    expect(res.matchedElements).toBe(4);
  });

  it('merges values that format identically', () => {
    // 24.999 and 25.001 both render as "25" at 0 decimals — documented deviation from Revit
    const store = build([{ type: 'A', width: 24.999 }, { type: 'A', width: 25.001 }]);
    const res = runSchedule(store, def({
      itemize: false,
      columns: [colType, { ...colWidth, format: { display: 'm', decimals: 0 } }],
    }));
    expect(data(res.rows).length).toBe(1);
    expect(data(res.rows)[0].count).toBe(2);
  });

  it('keeps identical rows apart when a sort level distinguishes them', () => {
    // same door type on two levels, with Level grouped but NOT a visible column
    const store = build([
      { type: 'A', width: 0.9, storey: 'L1', elev: 0 },
      { type: 'A', width: 0.9, storey: 'L2', elev: 3 },
    ]);
    const res = runSchedule(store, def({
      itemize: false,
      sort: [{ field: { kind: 'core', key: 'storey' }, dir: 'asc', header: true }],
    }));
    expect(data(res.rows).length).toBe(2);
    expect(groups(res.rows).map((g) => g.label)).toEqual(['L1', 'L2']);
  });
});

describe('grouping, footers and totals', () => {
  const store = build([
    { storey: 'L1', elev: 0, type: 'A', width: 1 },
    { storey: 'L1', elev: 0, type: 'B', width: 2 },
    { storey: 'L2', elev: 3, type: 'A', width: 4 },
  ]);
  const sumWidth: Column = { ...colWidth, total: 'sum' };

  it('emits a header per group with its member count', () => {
    const res = runSchedule(store, def({
      columns: [colType, sumWidth],
      sort: [{ field: { kind: 'core', key: 'storey' }, dir: 'asc', header: true }],
    }));
    expect(groups(res.rows).map((g) => [g.label, g.count])).toEqual([['L1', 2], ['L2', 1]]);
  });

  it('totals each group and the grand total, in display units', () => {
    const res = runSchedule(store, def({
      columns: [colType, sumWidth],
      sort: [{ field: { kind: 'core', key: 'storey' }, dir: 'asc', header: true, footer: 'totals' }],
      grandTotal: true,
    }));
    // widths are metres in the store, millimetres on screen
    expect(footers(res.rows).map((f) => f.cells[1])).toEqual(['3,000', '4,000']);
    const grand = res.rows.find((r) => r.kind === 'grand') as GrandRow;
    expect(grand.cells[1]).toBe('7,000');
    expect(grand.count).toBe(3);
  });

  it('supports count, min, max, avg and countDistinct', () => {
    const mk = (total: Column['total']) => runSchedule(store, def({
      columns: [colType, { ...colWidth, total }],
      grandTotal: true,
    })).rows.find((r) => r.kind === 'grand') as GrandRow;

    expect(mk('count').cells[1]).toBe('3');
    expect(mk('min').cells[1]).toBe('1,000');
    expect(mk('max').cells[1]).toBe('4,000');
    expect(mk('avg').cells[1]).toBe('2,333');
    expect((runSchedule(store, def({
      columns: [{ ...colType, total: 'countDistinct' }], grandTotal: true,
    })).rows.find((r) => r.kind === 'grand') as GrandRow).cells[0]).toBe('2');
  });

  it('emits blank lines between groups when asked', () => {
    const res = runSchedule(store, def({
      sort: [{ field: { kind: 'core', key: 'storey' }, dir: 'asc', header: true, blankLine: true }],
    }));
    expect(res.rows.filter((r) => r.kind === 'blank').length).toBe(2);
  });

  it('nests two levels, closing the deeper group first', () => {
    const res = runSchedule(store, def({
      columns: [colType, sumWidth],
      sort: [
        { field: { kind: 'core', key: 'storey' }, dir: 'asc', header: true, footer: 'totals' },
        { field: { kind: 'core', key: 'typeName' }, dir: 'asc', header: true, footer: 'count' },
      ],
    }));
    const order = res.rows.map((r) => r.kind);
    expect(order[0]).toBe('group');
    expect(order[1]).toBe('group');
    // the type footer must close before the storey footer
    const firstFooter = res.rows.findIndex((r) => r.kind === 'footer') as number;
    expect((res.rows[firstFooter] as FooterRow).level).toBe(1);
  });

  it('leaves non-total columns blank in footers', () => {
    const res = runSchedule(store, def({
      columns: [colType, sumWidth],
      sort: [{ field: { kind: 'core', key: 'storey' }, dir: 'asc', footer: 'totals' }],
    }));
    expect(footers(res.rows)[0].cells[0]).toBeNull();
  });
});

describe('render cap', () => {
  it('caps rendered rows but still reports the true total', () => {
    const store = build(Array.from({ length: 5200 }, (_, i) => ({ type: `T${i}` })));
    const res = runSchedule(store, def());
    expect(data(res.rows).length).toBe(5000);
    expect(res.totalDataRows).toBe(5200);
    expect(res.truncated).toBe(true);
  });

  it('does not flag truncation under the cap', () => {
    const res = runSchedule(build([{}, {}]), def());
    expect(res.truncated).toBe(false);
  });
});

describe('columns', () => {
  it('hides hidden columns but still filters and sorts on them', () => {
    const store = build([{ type: 'B', width: 2 }, { type: 'A', width: 1 }]);
    const res = runSchedule(store, def({
      columns: [colType, { ...colWidth, hidden: true }],
      sort: [{ field: colWidth.field, dir: 'asc' }],
    }));
    expect(res.headings).toEqual(['Type']);
    expect(data(res.rows).map((d) => d.cells)).toEqual([['A'], ['B']]);
  });

  it('uses the heading override', () => {
    const res = runSchedule(build([{}]), def({ columns: [{ ...colType, heading: 'Door Type' }] }));
    expect(res.headings).toEqual(['Door Type']);
  });

  it('unions multiple categories', () => {
    const store = build([{ entity: 'IfcDoor' }, { entity: 'IfcWindow' }, { entity: 'IfcWall' }]);
    const res = runSchedule(store, def({ entity: ['IfcDoor', 'IfcWindow'] }));
    expect(res.matchedElements).toBe(2);
  });
});

describe('what each colour rule claims, and showing just those rows', () => {
  // The rules panel states "Colours 2 of 3 rows" and clicking shows those rows. Both the
  // count and the narrowing go through firingRule, which is also what paints the table —
  // so a number here that the table contradicted would be a bug in one shared function
  // rather than a disagreement between three.
  const specs = [{ type: 'AX' }, { type: 'AY' }, { type: 'B' }];
  const store = build(specs);
  /** Two rules that overlap on AX: the first claims it, so the second never sees it. */
  const conditional: Column['conditional'] = [
    { op: 'contains', value: 'A', bg: '#fff3cd' },
    { op: '=', value: 'AX', bg: '#d1e7dd' },
  ];
  const litCol: Column = { ...colType, conditional };
  const byStorey = { field: { kind: 'core' as const, key: 'storey' as const }, dir: 'asc' as const, footer: 'count' as const };
  const d = def({ columns: [litCol], sort: [byStorey] });

  it('attributes each line to the FIRST rule that claims it', () => {
    // AX matches both; it belongs to rule 0, so rule 1 is honestly reported as claiming none.
    expect(runSchedule(store, d).conditionalHits).toEqual({ 0: { hits: [2, 0], of: 3 } });
  });

  it('counts data lines, not elements, so `of` is the collapsed total', () => {
    const dupes = build([{ type: 'AX' }, { type: 'AX' }, { type: 'B' }]);
    const res = runSchedule(dupes, def({ columns: [litCol], itemize: false }));
    expect(data(res.rows).length).toBe(2);
    expect(res.conditionalHits).toEqual({ 0: { hits: [1, 0], of: 2 } });
  });

  it('says nothing about a hidden column — it has no cells here to have coloured', () => {
    const res = runSchedule(store, def({
      columns: [{ ...colType, conditional, hidden: true }, { ...colType, conditional }],
    }));
    expect(Object.keys(res.conditionalHits ?? {})).toEqual(['1']);
  });

  it('has no entry at all for a column carrying no rules', () => {
    expect(runSchedule(store, def()).conditionalHits).toBeUndefined();
  });

  it('narrows the table to exactly the rows one rule claims', () => {
    const res = runSchedule(store, d, { litBy: { col: 0, rule: 0 } });
    expect(data(res.rows).map((r) => r.cells[0])).toEqual(['AX', 'AY']);
    expect(res.totalDataRows).toBe(2);
    // The rule that claims nothing narrows to nothing — which is the honest answer.
    expect(runSchedule(store, d, { litBy: { col: 0, rule: 1 } }).totalDataRows).toBe(0);
  });

  it('recomputes the footer over the narrowed set', () => {
    expect(footers(runSchedule(store, d).rows)[0].count).toBe(3);
    expect(footers(runSchedule(store, d, { litBy: { col: 0, rule: 0 } }).rows)[0].count).toBe(2);
  });

  it('still reports the counts against the whole schedule while narrowed', () => {
    // Otherwise "Colours 2 of 2 rows" the moment you look at them, and no way back to 3.
    expect(runSchedule(store, d, { litBy: { col: 0, rule: 0 } }).conditionalHits)
      .toEqual({ 0: { hits: [2, 0], of: 3 } });
  });

  it('ignores a target that names no live rule', () => {
    const plain = runSchedule(store, d);
    for (const bad of [{ col: 7, rule: 0 }, { col: 0, rule: 9 }, { col: -1, rule: 0 }]) {
      expect(runSchedule(store, d, { litBy: bad }), JSON.stringify(bad)).toEqual(plain);
    }
  });
});
