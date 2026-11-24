// Guard 5 of the chained formulas (2026-11-24): a rename keeps every formula meaning what it
// meant. Over random schedules whose headings and names are awkward on purpose — spaces, a digit
// first, unicode, mixed case, prefixes of each other, function names, names only brackets can
// hold — renaming a column some formula uses (a calculated value's name box, `updateCalculated`;
// a model column's heading box, `setHeading`, cleared back to its default included) leaves every
// value of every column as it was, every piece of quoted text byte for byte, Vee's mark and note
// on every formula; renaming back restores the same values. Typing a name one character at a time
// — each prefix its own call, as the boxes send them, through other columns' names on the way —
// ends with every formula still bound to the column it was. A name holding `]` cannot be written
// in brackets; whatever happens then is visible, never a silently different number.
// Replay one schedule with `CHAIN_SEED=<n>`.

import { describe, expect, it } from 'vitest';
import { setHeading, updateCalculated } from '../../../src/schedule/schedule/actions';
import { calcProblems } from '../../../src/schedule/schedule/computed';
import { headingOf, type Calculated, type Column, type ScheduleDef } from '../../../src/schedule/schedule/def';
import type { ModelStore } from '../../../src/schedule/ifc/store';
import {
  engineValues, genExpr, int, key, modelColumn, mulberry32, pick, randomStore, ref, render, scheduleOf,
  showCalc, shuffle, spellName, storeOf, type Expr, type Prop, type Rng,
} from './support/chain';

const ONLY = process.env.CHAIN_SEED === undefined ? undefined : Number(process.env.CHAIN_SEED);
const SEEDS = 200;
const POOL = [
  'Area', 'Area2', 'Area 2', 'Ar', 'if', 'contains', 'Round', 'MIN', 'len', '3D Area', '2nd',
  'Fläche', '面积', 'm²', "Door's", 'x[1', '_x', 'Net_Area', 'aReA x', 'Height', '  padded ', 'Wall Type',
];

/** Every piece of quoted text in a formula, in order — read past `[…]` as the formula language does. */
function literals(src: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '[') { const e = src.indexOf(']', i); if (e < 0) break; i = e; continue; }
    if (c === '"' || c === "'") { const e = src.indexOf(c, i + 1); if (e < 0) break; out.push(src.slice(i + 1, e)); i = e; }
  }
  return out;
}

interface Gen { store: ModelStore; def: ScheduleDef; nModel: number; used: Set<string> }

function generate(r: Rng): Gen {
  const nModel = 2 + int(r, 2);
  const nCalc = 2 + int(r, 4);
  const names = shuffle(r, POOL).slice(0, nModel + nCalc);
  const props: Prop[] = Array.from({ length: nModel }, (_, i) => ({ prop: `P${i}`, kind: pick(r, ['area', 'length', undefined] as const) }));
  const store = storeOf(randomStore(r, props, 6, 0.15));
  const columns: Column[] = props.map((p, i) => modelColumn(p, names[i]));
  const calcs: { id: string; name: string; expr: Expr }[] = [];
  for (let j = 0; j < nCalc; j++) {
    const leaves = [...names.slice(0, nModel), ...calcs.map((c) => c.name)].map((n) => ref(key(n)));
    let e = genExpr(r, leaves, 1 + int(r, 2));
    // Quoted text holding other columns' names, which a rename must not touch.
    if (r() < 0.7) e = { t: 'bin', op: '+', a: e, b: { t: 'bin', op: '*', a: { t: 'num', v: 0 }, b: { t: 'eq', a: { t: 'str', v: pick(r, names).trim() }, s: pick(r, names).trim() } } };
    calcs.push({ id: `c${j}`, name: names[nModel + j], expr: e });
  }
  const used = new Set<string>();
  const spell = (to: string) => { used.add(to); return spellName(r, names.find((n) => key(n) === to)!); };
  const calculated: Calculated[] = calcs.map((c, j) => ({
    id: c.id, name: c.name, kind: 'formula', formula: render(c.expr, spell), by: 'vee', note: `What value ${j} works out.`,
  }));
  return { store, def: scheduleOf([...columns, ...calculated.map((c) => showCalc(c.id))], shuffle(r, calculated)), nModel, used };
}

const namesOf = (d: ScheduleDef, nModel: number) =>
  [...d.columns.slice(0, nModel).map((c) => headingOf(c, d)), ...(d.calculated ?? []).map((c) => c.name)];

/** Rename target `t` (a model column index, or a calculated id) to `name`, as its box does. */
function rename(d: ScheduleDef, t: number | string, name: string): ScheduleDef {
  return typeof t === 'number' ? setHeading(d, t, name) : updateCalculated(d, t, { name });
}
const nameOfTarget = (d: ScheduleDef, t: number | string) =>
  (typeof t === 'number' ? headingOf(d.columns[t], d) : d.calculated!.find((c) => c.id === t)!.name);

function snapshot(g: Gen, d: ScheduleDef) {
  return {
    values: engineValues(g.store, d),
    problems: Object.fromEntries(calcProblems(g.store, d)),
    marks: Object.fromEntries(d.calculated!.map((c) => [c.id, [c.by, c.note, literals(c.formula ?? '')]])),
  };
}

/** A referenced column, and a name nothing else has. */
function choose(r: Rng, g: Gen) {
  const d = g.def;
  const targets: (number | string)[] = [
    ...d.columns.slice(0, g.nModel).map((_c, i) => i), ...d.calculated!.map((c) => c.id),
  ].filter((t) => g.used.has(key(nameOfTarget(d, t))));
  const t = pick(r, targets);
  const taken = new Set(namesOf(d, g.nModel).map(key));
  const free = POOL.filter((n) => !taken.has(key(n)));
  return { t, name: pick(r, typeof t === 'number' && r() < 0.15 ? [''] : free) };
}

describe('a rename keeps every formula meaning what it meant', () => {
  it('values, quoted text, marks and notes unchanged; renaming back restores the values', () => {
    let model = 0, calc = 0, rewrote = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      if (ONLY !== undefined && seed !== ONLY) continue;
      const r = mulberry32(seed * 86028121);
      const g = generate(r);
      const before = snapshot(g, g.def);
      const { t, name } = choose(r, g);
      const old = nameOfTarget(g.def, t);
      const next = rename(g.def, t, name);
      const where = `seed ${seed}: rename ${JSON.stringify(old)} → ${JSON.stringify(name)} in ${g.def.calculated!.map((c) => `${c.name} = ${c.formula}`).join(' ; ')}`;
      const want = typeof t === 'number' && !name.trim() ? `P${t}` : name.trim();
      expect(nameOfTarget(next, t).trim(), `${where}: the rename was refused`).toBe(want);
      expect(snapshot(g, next), `${where} → ${next.calculated!.map((c) => c.formula).join(' ; ')}`).toEqual(before);
      if (next.calculated!.some((c, i) => c.formula !== g.def.calculated![i].formula)) rewrote++;
      const back = rename(next, t, typeof t === 'number' && g.def.columns[t].heading === undefined ? '' : old);
      expect(engineValues(g.store, back), `${where}, and back`).toEqual(before.values);
      if (typeof t === 'number') model++; else calc++;
    }
    if (ONLY !== undefined) return;
    expect(model).toBeGreaterThan(50);
    expect(calc).toBeGreaterThan(50);
    expect(rewrote).toBeGreaterThan(150);
  });

  it('typing a new name one character at a time, through other columns’ names, binds nothing anew', () => {
    let through = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      if (ONLY !== undefined && seed !== ONLY) continue;
      const r = mulberry32(seed * 7368787);
      const g = generate(r);
      const before = engineValues(g.store, g.def);
      const { t } = choose(r, g);
      // Half the time the new name runs through another column's name on its way.
      const others = namesOf(g.def, g.nModel).filter((n) => key(n) !== key(nameOfTarget(g.def, t)) && n.trim());
      const taken = new Set(namesOf(g.def, g.nModel).map(key));
      let final = r() < 0.5 ? `${pick(r, others).trim()}${pick(r, ['Z', ' new', '9'])}` : pick(r, POOL.filter((n) => !taken.has(key(n)))).trim();
      if (taken.has(key(final))) final += 'Q';
      const old = nameOfTarget(g.def, t);
      let d = g.def;
      const keys: string[] = [];
      for (let k = old.length - 1; k >= 0; k--) keys.push(old.slice(0, k));
      for (let k = 1; k <= final.length; k++) keys.push(final.slice(0, k));
      for (const typed of keys) d = rename(d, t, typed);
      if (keys.some((k) => others.some((o) => key(o) === key(k)))) through++;
      const where = `seed ${seed}: typing ${JSON.stringify(old)} → ${JSON.stringify(final)} in ${g.def.calculated!.map((c) => `${c.name} = ${c.formula}`).join(' ; ')}`;
      expect(nameOfTarget(d, t), where).toBe(final);
      expect(engineValues(g.store, d), `${where} → ${d.calculated!.map((c) => `${c.name} = ${c.formula}`).join(' ; ')}`).toEqual(before);
    }
    if (ONLY === undefined) expect(through).toBeGreaterThan(60);
  });

  // The smallest case of the one above that the build's own notes call a known edge
  // (docs/DECISIONS.md 2026-11-24); the spec (docs/DEVIATIONS.md) states no such limit.
  it('typing a model heading through another model column’s heading', () => {
    const props: Prop[] = [{ prop: 'P0', kind: 'area' }, { prop: 'P1', kind: 'length' }];
    const store = storeOf({ props, rows: [[2, 3]], storeys: ['L1'] });
    const def = scheduleOf([modelColumn(props[0], 'Area'), modelColumn(props[1], 'Ar'), showCalc('a'), showCalc('b')], [
      { id: 'a', name: 'Twice', kind: 'formula', formula: 'Area * 2' },
      { id: 'b', name: 'Plus', kind: 'formula', formula: 'Ar + 1' },
    ]);
    let d = def;
    for (const typed of ['Are', 'Ar', 'A', '', 'A', 'Ar', 'Ar2']) d = setHeading(d, 0, typed);
    expect(headingOf(d.columns[0], d)).toBe('Ar2');
    expect(engineValues(store, d)).toEqual({ a: [4], b: [4] });
  });

  it('a name holding "]" gives a visible problem or keeps the value — never a different number', () => {
    let hit = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const r = mulberry32(seed * 3301);
      const g = generate(r);
      const before = engineValues(g.store, g.def);
      const { t } = choose(r, g);
      const d = rename(g.def, t, pick(r, ['a]b', 'W] x', '[x]']));
      const after = engineValues(g.store, d);
      const problems = calcProblems(g.store, d);
      for (const c of d.calculated!) {
        const same = JSON.stringify(after[c.id]) === JSON.stringify(before[c.id]);
        // Blank, not a number — and the schedule shows why: on this value, or on one it uses (a
        // value that uses a broken one is blank without a message of its own; see chain-loops).
        const visible = problems.size > 0 && after[c.id].every((v) => v === undefined);
        expect(same || visible, `seed ${seed}: ${c.name} = ${c.formula}: ${JSON.stringify(before[c.id])} → ${JSON.stringify(after[c.id])}`).toBe(true);
        if (!same) hit++;
      }
    }
    expect(hit).toBeGreaterThan(0);
  });
});
