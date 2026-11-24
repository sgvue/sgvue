// The two 2026-11-24 Schedules builds together: a chained calculated value (a formula naming
// another calculated value) in a table whose itemise-off rows combine by sort value. A chained
// value must read, combined, exactly as the same formula written in place does — row for row,
// `<varies>` and totals included — in both combine modes. Replay one with `CHAIN_SEED=<n>`.

import { describe, expect, it } from 'vitest';
import type { Calculated, Column, ScheduleDef } from '../../../src/schedule/schedule/def';
import { runSchedule } from '../../../src/schedule/schedule/engine';
import { int, modelColumn, mulberry32, pick, randomStore, scheduleOf, storeOf, type Prop } from './support/chain';

const ONLY = process.env.CHAIN_SEED === undefined ? undefined : Number(process.env.CHAIN_SEED);
const BASES = ['Area * Height', 'Area + 1', 'round(Area, 0)', 'if(Height > 2, Area, 0)', 'round(Height, 0) * 2'];
const TOPS: { formula: string; result?: 'text' }[] = [
  { formula: 'Base * 1.1' }, { formula: 'Base + Area' }, { formula: 'round(Base, 0)' },
  { formula: 'if(Base > 3, "Yes", "No")', result: 'text' },
];

describe('a chained value in rows combined by sort value', () => {
  it('reads as the formula written in place does, in every row, footer and total', () => {
    let combined = 0;
    let filled = 0;
    let varies = 0;
    let totalled = 0;
    for (let seed = 1; seed <= 120; seed++) {
      if (ONLY !== undefined && seed !== ONLY) continue;
      const r = mulberry32(seed * 32452843);
      const props: Prop[] = [{ prop: 'P0', kind: 'area' }, { prop: 'P1', kind: 'length' }];
      const store = storeOf(randomStore(r, props, 16, 0.15));
      const base = pick(r, BASES);
      const top = pick(r, TOPS);
      const columns: Column[] = [
        { field: { kind: 'core', key: 'storey' } },
        { ...modelColumn(props[0], 'Area'), ...(int(r, 2) ? { total: 'sum' as const } : {}) },
        { ...modelColumn(props[1], 'Height'), hidden: int(r, 2) === 1 },
        { field: { kind: 'formula', id: 't' }, format: { decimals: 3 }, ...(!top.result && int(r, 2) ? { total: 'sum' as const } : {}) },
      ];
      const topCalc = (formula: string): Calculated =>
        ({ id: 't', name: 'Top', kind: 'formula', formula, ...(top.result ? { result: top.result } : {}) });
      const shape = (calculated: Calculated[], combine: boolean): ScheduleDef => ({
        ...scheduleOf(columns, calculated), itemize: false, grandTotal: true,
        ...(combine ? { combine: 'sort' as const } : {}),
        sort: [{ field: { kind: 'core', key: 'storey' }, dir: 'asc', footer: 'totals' }],
      });
      for (const combine of [true, false]) {
        // The value it uses is listed after it, and shown in no column.
        const chained = runSchedule(store, shape([topCalc(top.formula), { id: 'b', name: 'Base', kind: 'formula', formula: base }], combine));
        const inPlace = runSchedule(store, shape([topCalc(top.formula.replaceAll('Base', `(${base})`))], combine));
        expect(JSON.stringify(chained.rows), `seed ${seed}, combine ${combine}: Base = ${base} ; Top = ${top.formula}`)
          .toBe(JSON.stringify(inPlace.rows));
        if (!combine) continue;
        for (const x of chained.rows) {
          if (x.kind !== 'data' || x.rows.length < 2) continue;
          combined++;
          // The chained value's own cell: the last visible column.
          const at = x.cells.length - 1;
          if (x.cells[at] !== '') filled++;
          if (x.mixed?.[at]) varies++;
          if (x.totalled?.[at]) totalled++;
        }
      }
    }
    // The mode was really exercised: rows that stand for several elements.
    // and the chained cell was a value, a `<varies>` and a total, not a column of blanks.
    if (ONLY === undefined) {
      expect(combined).toBeGreaterThan(100);
      expect(filled).toBeGreaterThan(100);
      expect(varies).toBeGreaterThan(20);
      expect(totalled).toBeGreaterThan(20);
    }
  });
});
