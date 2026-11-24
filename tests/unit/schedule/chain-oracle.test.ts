// Guard 1 of the chained formulas (2026-11-24, docs/DEVIATIONS.md "a formula may use another
// calculated column by its name"): over seeded random schedules — 2–5 numeric model columns,
// 1–8 formula calculated values forming a random dependency tree up to six deep, listed in a
// random order, some shown, some hidden, some not shown at all, blanks in the model — every
// value the engine works out equals the plain-JS oracle's (`support/chain.ts`), which evaluates
// the expression tree the formula text was rendered from. And the order of `calculated` never
// changes a value. Replay one schedule with `CHAIN_SEED=<n>`.

import { describe, expect, it } from 'vitest';
import { calcProblems } from '../../../src/schedule/schedule/computed';
import type { Calculated, Column, ScheduleDef } from '../../../src/schedule/schedule/def';
import type { ModelStore } from '../../../src/schedule/ifc/store';
import {
  asVar, cmp, engineValues, genExpr, int, key, modelColumn, mulberry32, oracle, pick, randomStore, ref, refsOf, render,
  scheduleOf, showCalc, shuffle, spellName, storeOf, type Env, type Expr, type Prop, type Rng, type StoreSpec,
} from './support/chain';

const ONLY = process.env.CHAIN_SEED === undefined ? undefined : Number(process.env.CHAIN_SEED);
const SEEDS = 220;
const KINDS = ['length', 'area', 'none', undefined] as const;
const MODEL_NAMES = ['Width', 'Clear Height', 'len_2', 'Fläche', '3D Area', 'area2', 'Depth'];
const CALC_NAMES = ['Total', 'Net Area', 'vol_1', 'Ratio', 'x', 'Höhe 2', '2nd pass', 'Bay', 'Sum B', 'q'];

interface Gen {
  spec: StoreSpec;
  store: ModelStore;
  def: ScheduleDef;
  /** In dependency order: each after everything it uses. */
  calcs: { id: string; name: string; expr: Expr; result: 'number' | 'yesNo'; depth: number }[];
  model: { name: string; col: number }[];
}

function generate(r: Rng): Gen {
  const nModel = 2 + int(r, 4);
  const props: Prop[] = Array.from({ length: nModel }, (_, i) => ({ prop: `P${i}`, kind: pick(r, KINDS) }));
  const spec = randomStore(r, props, 10);
  const names = shuffle(r, MODEL_NAMES).slice(0, nModel);
  const model = names.map((name, col) => ({ name, col }));
  const columns: Column[] = props.map((p, i) => modelColumn(p, names[i]));
  const calcs: Gen['calcs'] = [];
  const cnames = shuffle(r, CALC_NAMES);
  const nCalc = 1 + int(r, 8);
  for (let j = 0; j < nCalc; j++) {
    const usable = calcs.filter((c) => c.depth < 6);
    // Lean on the latest values, so chains get deep.
    const leaves: Expr[] = [...model.map((m) => ref(key(m.name))), ...usable.flatMap((c, i) => Array(1 + i).fill(ref(key(c.name))) as Expr[])];
    let expr = genExpr(r, leaves, 1 + int(r, 3));
    const result = r() < 0.2 ? 'yesNo' : 'number';
    if (result === 'yesNo') expr = cmp(r, expr, { t: 'num', v: pick(r, [0, 1, 5, 20]) });
    const used = calcs.filter((c) => [...refsOf(expr)].includes(key(c.name)));
    const depth = 1 + Math.max(0, ...used.map((c) => c.depth));
    calcs.push({ id: `c${j}`, name: cnames[j], expr, result, depth });
  }
  const spell = (to: string) => spellName(r, [...model.map((m) => m.name), ...calcs.map((c) => c.name)].find((n) => key(n) === to)!);
  const calculated: Calculated[] = shuffle(r, calcs).map((c) => ({
    id: c.id, name: c.name, kind: 'formula', formula: render(c.expr, spell), ...(c.result === 'yesNo' ? { result: 'yesNo' as const } : {}),
  }));
  for (const c of calculated) {
    const roll = r();
    if (roll < 0.7) columns.push(showCalc(c.id, roll < 0.25));
  }
  return { spec, store: storeOf(spec), def: scheduleOf(columns, calculated), calcs, model };
}

/** The oracle's values, row by row, by calculated id. */
function expected(g: Gen): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = Object.fromEntries(g.calcs.map((c) => [c.id, []]));
  for (let row = 0; row < g.spec.rows.length; row++) {
    const env: Env = new Map();
    for (const m of g.model) env.set(key(m.name), g.spec.rows[row][m.col] ?? undefined);
    for (const c of g.calcs) {
      const v = oracle(c.expr, c.result, env);
      env.set(key(c.name), asVar(v));
      out[c.id].push(v);
    }
  }
  return out;
}


describe('chained formulas against an independent oracle', () => {
  it('every value equals the oracle’s, whatever the order of `calculated`', () => {
    let maxDepth = 0, forward = 0, checked = 0, blanks = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      if (ONLY !== undefined && seed !== ONLY) continue;
      const r = mulberry32(seed * 7919);
      const g = generate(r);
      const want = expected(g);
      const got = engineValues(g.store, g.def);
      expect(got, `seed ${seed}: ${JSON.stringify(g.def.calculated)}`).toEqual(want);
      // No calculated value here is refused: names, loops and percentages are not in play.
      const problems = [...calcProblems(g.store, g.def).values()].filter((p) => /Unknown|loop|percentage/.test(p));
      expect(problems, `seed ${seed}`).toEqual([]);
      for (let k = 0; k < 3; k++) {
        const shuffled = { ...g.def, calculated: shuffle(r, g.def.calculated!) };
        expect(engineValues(g.store, shuffled), `seed ${seed}, shuffle ${k}`).toEqual(want);
      }
      maxDepth = Math.max(maxDepth, ...g.calcs.map((c) => c.depth));
      const at = new Map(g.def.calculated!.map((c, i) => [key(c.name), i]));
      forward += g.calcs.filter((c) => [...refsOf(c.expr)].some((n) => (at.get(n) ?? -1) > at.get(key(c.name))!)).length;
      for (const vs of Object.values(want)) { checked += vs.length; blanks += vs.filter((v) => v === undefined).length; }
    }
    if (ONLY !== undefined) return;
    // What the run exercised, so the check cannot go quietly vacuous.
    expect(maxDepth).toBe(6);
    expect(forward).toBeGreaterThan(100);
    expect(checked).toBeGreaterThan(5000);
    expect(blanks / checked).toBeGreaterThan(0.1);
    expect(blanks / checked).toBeLessThan(0.9);
  });
});
