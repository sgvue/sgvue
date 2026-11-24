// Guard 2 of the chained formulas (2026-11-24): naming a calculated value is the same as writing
// its formula in place. For random chains of two to four values — numbers, yes / no and text
// results, each using the one before — the last value's cells equal those of the same formula
// with every chained name replaced by `(that value's own formula)`, recursively; and the unit
// `dimensionOf` works out is the same both ways. A yes reads as 1 through the chain (the spec:
// "a text or yes / no result reads as a model text or boolean column does"), so a yes / no link
// is always a comparison, which is 1 or 0 written in place too; a text link is used through
// `= "…"`. Replay one chain with `CHAIN_SEED=<n>`.

import { describe, expect, it } from 'vitest';
import { kindsByHeading } from '../../../src/schedule/schedule/columns';
import type { Calculated, CalcResult } from '../../../src/schedule/schedule/def';
import { dimensionOf } from '../../../src/schedule/schedule/formula';
import {
  cmp, engineValues, genExpr, int, key, modelColumn, mulberry32, pick, randomStore, ref, render,
  scheduleOf, showCalc, shuffle, spellName, storeOf, type Expr, type Prop, type Rng,
} from './support/chain';

const ONLY = process.env.CHAIN_SEED === undefined ? undefined : Number(process.env.CHAIN_SEED);
const SEEDS = 200;
const WORDS = ['Yes', 'No', 'Big', 'small', 'FD60'];

interface Link { id: string; name: string; expr: Expr; result: CalcResult }

function chain(r: Rng) {
  const props: Prop[] = [{ prop: 'P0', kind: 'area' }, { prop: 'P1', kind: 'length' }, { prop: 'P2', kind: pick(r, ['length', 'none'] as const) }];
  const heads = ['Area', 'Height', 'Run'];
  const spec = randomStore(r, props, 8, 0.15);
  const links: Link[] = [];
  const n = 2 + int(r, 3);
  for (let j = 0; j < n; j++) {
    const prev = links[j - 1];
    // How this value uses the one before it, as a numeric leaf.
    const via: Expr[] = !prev ? [] : prev.result === 'text'
      ? [{ t: 'eq', a: ref(key(prev.name)), s: pick(r, WORDS).toLowerCase() }]
      : [ref(key(prev.name))];
    const leaves = [...heads.map((h) => ref(key(h))), ...via, ...via, ...via];
    let expr = genExpr(r, leaves, 1 + int(r, 3));
    if (prev && !JSON.stringify(expr).includes(`"${key(prev.name)}"`)) expr = { t: 'bin', op: '*', a: expr, b: via[0] };
    const result: CalcResult = j === 0 || r() < 0.5 ? pick(r, ['number', 'yesNo', 'text'] as const) : 'number';
    if (result === 'yesNo') expr = cmp(r, expr, { t: 'num', v: pick(r, [0, 2, 10]) });
    if (result === 'text') {
      const [a, b] = shuffle(r, WORDS);
      expr = { t: 'if', c: cmp(r, expr, { t: 'num', v: pick(r, [0, 2, 10]) }), a: { t: 'str', v: a }, b: { t: 'str', v: b } };
    }
    links.push({ id: `k${j}`, name: pick(r, ['Step', 'Net Vol', 'x_', 'Höhe', '2nd']) + j, expr, result });
  }
  return { spec, props, heads, links };
}

describe('a chained name means the same as its formula written in place', () => {
  it('cells and the inferred unit agree, for numbers, yes / no and text links', () => {
    const kinds = new Set<string>();
    let rows = 0, filled = 0, unitsCompared = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      if (ONLY !== undefined && seed !== ONLY) continue;
      const r = mulberry32(seed * 104729);
      const { spec, props, heads, links } = chain(r);
      const store = storeOf(spec);
      const byKey = new Map(links.map((l) => [key(l.name), l]));
      const named = (e: Expr) => render(e, (to) => spellName(r, byKey.get(to)?.name ?? heads.find((h) => key(h) === to)!));
      const inlined = (e: Expr): string => render(e, (to) => {
        const l = byKey.get(to);
        return l ? `(${inlined(l.expr)})` : spellName(r, heads.find((h) => key(h) === to)!);
      });
      const cols = props.map((p, i) => modelColumn(p, heads[i]));
      const calc = (l: Link, formula: string): Calculated =>
        ({ id: l.id, name: l.name, kind: 'formula', formula, ...(l.result === 'number' ? {} : { result: l.result }) });
      const chained = scheduleOf([...cols, ...links.map((l) => showCalc(l.id))], shuffle(r, links.map((l) => calc(l, named(l.expr)))));
      const last = links[links.length - 1];
      const alone = scheduleOf([...cols, showCalc(last.id)], [calc(last, inlined(last.expr))]);

      const a = engineValues(store, chained)[last.id];
      const b = engineValues(store, alone)[last.id];
      const where = `seed ${seed}: ${chained.calculated!.map((c) => `${c.name} = ${c.formula}`).join(' ; ')} || inlined ${alone.calculated![0].formula}`;
      expect(a, where).toEqual(b);
      // The unit is compared where every link's own formula is sound: a link that adds a length
      // to a plain number is reported on that link, and written in place it poisons the whole.
      const sound = !chained.calculated!.some((c) => dimensionOf(c.formula!, kindsByHeading(store, chained)).problem);
      if (last.result === 'number' && sound) {
        unitsCompared++;
        const k1 = dimensionOf(chained.calculated!.find((c) => c.id === last.id)!.formula!, kindsByHeading(store, chained)).kind;
        const k2 = dimensionOf(alone.calculated![0].formula!, kindsByHeading(store, alone)).kind;
        expect(k1, `unit, ${where}`).toBe(k2);
        if (k2) kinds.add(k2);
      }
      for (const l of links.slice(0, -1)) kinds.add(`link:${l.result}`);
      rows += a.length;
      filled += a.filter((v) => v !== undefined).length;
    }
    if (ONLY !== undefined) return;
    for (const k of ['area', 'length', 'none']) expect(kinds).toContain(k);
    for (const k of ['link:number', 'link:yesNo', 'link:text']) expect(kinds).toContain(k);
    expect(filled / rows).toBeGreaterThan(0.3);
    expect(unitsCompared).toBeGreaterThan(40);
  });
});

describe('a link whose own unit has no name', () => {
  // `Area * Area` measures length⁴, which no unit kind names; `that / Area` is an area again.
  // Written in place the unit is found; through the chain it must be found too.
  it('still carries its dimension to the value that uses it', () => {
    const store = storeOf({ props: [{ prop: 'P0', kind: 'area' }], rows: [[2], [3]], storeys: ['L1', 'L1'] });
    const cols = [modelColumn({ prop: 'P0', kind: 'area' }, 'Area')];
    const chained = scheduleOf([...cols, showCalc('b'), showCalc('a')], [
      { id: 'b', name: 'Quad', kind: 'formula', formula: 'Area * Area' },
      { id: 'a', name: 'Back', kind: 'formula', formula: 'Quad / Area' },
    ]);
    const alone = scheduleOf([...cols, showCalc('a')], [{ id: 'a', name: 'Back', kind: 'formula', formula: '(Area * Area) / Area' }]);
    expect(engineValues(store, chained).a).toEqual(engineValues(store, alone).a);
    expect(dimensionOf('(Area * Area) / Area', kindsByHeading(store, alone)).kind).toBe('area');
    expect(dimensionOf('Quad / Area', kindsByHeading(store, chained)).kind).toBe('area');
  });
});
