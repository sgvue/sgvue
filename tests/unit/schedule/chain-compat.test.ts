// Guard 7 of the chained formulas (2026-11-24): schedules saved before calculate exactly as they
// did. `fixtures/chain-compat.json` is what the engine AS IT WAS (commit e67e76e, before chained
// formulas) worked out for 70 seeded schedules using only what it supported — formulas over model
// columns, yes / no and text results, percentages, hidden columns, and on purpose a calculated
// name equal to a model heading, two calculated values sharing a name, two model columns sharing
// a heading, an unknown name. Regenerate it from the old source only — `fixtures/chain-compat.gen.cjs`
// says how. The current engine must give every cell, value and problem the old one did, except
// in the two places the spec (docs/DEVIATIONS.md, 2026-11-24) changes, each asserted here:
//   · chain — a formula naming another formula calculated value no model column shadows was an
//     unknown field and is now worked out (`Base * 3` is three times Base, blank where Base is);
//   · percentage-message — a formula naming a percentage is blank as before, and now says
//     "A percentage cannot be used in a formula: Share" instead of "Unknown field: Share".

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { StoreBuilder } from '../../../src/schedule/ifc/store';
import type { Cell, ElemCore } from '../../../src/schedule/ifc/types';
import { calcProblems, planComputed, withPercentages } from '../../../src/schedule/schedule/computed';
import type { ScheduleDef } from '../../../src/schedule/schedule/def';
import { runSchedule, type DataRow } from '../../../src/schedule/schedule/engine';

interface Case {
  id: string; category: string; expect: 'same' | 'chain' | 'percentage-message'; refId?: string; targetId?: string;
  def: ScheduleDef; visible: (string | null)[]; cells: string[][]; problems: Record<string, string>;
  values: Record<string, (number | string | boolean | null)[]>;
}
const fx = JSON.parse(readFileSync(new URL('./fixtures/chain-compat.json', import.meta.url), 'utf8')) as {
  source: string; store: { cores: ElemCore[]; cells: Record<string, Cell>[] }; cases: Case[];
};
const b = new StoreBuilder();
b.add(fx.store.cores, fx.store.cells);
const store = b.finish({
  fileName: 'compat.ifc', schema: 'IFC4', projectName: '', authoringTool: '', lengthUnit: 'mm',
  unitSystem: 'metric', elementCount: fx.store.cores.length, parseMs: 0,
});
const rows = fx.store.cores.map((_c, i) => i);

function now(def: ScheduleDef) {
  const plan = withPercentages(planComputed(def), store, def, rows);
  const values = Object.fromEntries((def.calculated ?? []).map((x) =>
    [x.id, rows.map((row) => plan.compute(store, row).get(`formula:${x.id}`)?.v ?? null)]));
  const cells = runSchedule(store, def).rows.filter((x): x is DataRow => x.kind === 'data').map((x) => x.cells);
  return { values, cells, problems: Object.fromEntries(calcProblems(store, def)) };
}
const without = <T>(o: Record<string, T>, id?: string) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== id));

describe('schedules saved before calculate as they did', () => {
  it('the fixture is the old engine’s, and covers every case it should', () => {
    expect(fx.source).toBe('e67e76e');
    expect(fx.cases.length).toBeGreaterThanOrEqual(60);
    const by = (k: string) => fx.cases.filter((c) => c.category === k).length;
    for (const k of ['plain', 'model+calc', 'calc+calc', 'ambiguous', 'unknown', 'pct-ref', 'chain']) expect(by(k), k).toBeGreaterThanOrEqual(8);
    // What the old code did with the duplicates, as recorded: a calculated name a model heading
    // has is no problem (the model column wins); two calculated values sharing a name, and a
    // formula naming another calculated value, were unknown fields.
    const msgs = (k: string) => fx.cases.filter((c) => c.category === k).flatMap((c) => Object.values(c.problems));
    expect(msgs('model+calc').some((m) => m.startsWith('Unknown'))).toBe(false);
    expect(msgs('calc+calc')).toContain('Unknown field: Twin');
    for (const c of fx.cases.filter((x) => x.expect === 'chain')) expect(c.problems[c.refId!], c.id).toBe('Unknown field: Base');
    for (const c of fx.cases.filter((x) => x.expect === 'percentage-message')) expect(c.problems[c.refId!], c.id).toBe('Unknown field: Share');
  });

  for (const c of fx.cases.filter((x) => x.expect === 'same')) {
    it(`${c.id}: every cell, value and problem as before`, () => {
      expect(now(c.def)).toEqual({ values: c.values, cells: c.cells, problems: c.problems });
    });
  }

  for (const c of fx.cases.filter((x) => x.expect === 'percentage-message')) {
    it(`${c.id}: as before, but a percentage named in a formula says so`, () => {
      const n = now(c.def);
      expect({ values: n.values, cells: n.cells }).toEqual({ values: c.values, cells: c.cells });
      expect(without(n.problems, c.refId)).toEqual(without(c.problems, c.refId));
      expect(n.problems[c.refId!]).toBe('A percentage cannot be used in a formula: Share');
      expect(n.values[c.refId!].every((v) => v === null)).toBe(true);
    });
  }

  for (const c of fx.cases.filter((x) => x.expect === 'chain')) {
    it(`${c.id}: as before, except that Base * 3 now calculates`, () => {
      const n = now(c.def);
      const at = c.visible.indexOf(c.refId!);
      expect(at).toBeGreaterThan(0);
      expect(without(n.values, c.refId)).toEqual(without(c.values, c.refId));
      expect(without(n.problems, c.refId)).toEqual(without(c.problems, c.refId));
      expect(n.problems[c.refId!]).toBeUndefined();
      expect(n.values[c.refId!]).toEqual(c.values[c.targetId!].map((v) => (typeof v === 'number' ? v * 3 : null)));
      expect(n.values[c.refId!].some((v) => v !== null)).toBe(true);
      // Every other cell as before; the old column was blank throughout.
      const drop = (cells: string[][]) => cells.map((row) => row.filter((_x, i) => i !== at));
      expect(drop(n.cells)).toEqual(drop(c.cells));
      expect(c.cells.every((row) => row[at] === '')).toBe(true);
    });
  }
});
