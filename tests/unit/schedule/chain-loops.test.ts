// Guard 4 of the chained formulas (2026-11-24): a loop is refused like a formula that does not
// parse. For random graphs with one or more loops — a value naming itself, two naming each
// other, longer rings — beside bystanders: every member and everything that depends on a loop is
// blank and carries a problem; a member's problem is the spec's own sentence naming its loop;
// every other value is exactly what it is with the loop members taken out. A 500-long chain and
// a 500-long ring finish quickly and never throw. Replay one graph with `CHAIN_SEED=<n>`.

import { describe, expect, it } from 'vitest';
import { calcProblems } from '../../../src/schedule/schedule/computed';
import type { Calculated } from '../../../src/schedule/schedule/def';
import {
  engineValues, genExpr, int, key, modelColumn, mulberry32, randomStore, ref, render, scheduleOf,
  showCalc, shuffle, spellName, storeOf, type Prop,
} from './support/chain';

const ONLY = process.env.CHAIN_SEED === undefined ? undefined : Number(process.env.CHAIN_SEED);
const SEEDS = 200;
const TAIL = ' — a formula cannot use its own result, directly or through another column.';
const props: Prop[] = [{ prop: 'P0', kind: 'area' }, { prop: 'P1', kind: 'length' }];
const heads = ['Area', 'Height'];
const cols = props.map((p, i) => modelColumn(p, heads[i]));

/** The spec's sentence for a loop of these names, in the schedule's own order. */
function loopText(names: string[]): string {
  if (names.length === 1) return `"${names[0]}" uses itself${TAIL}`;
  const q = names.map((n) => `"${n}"`);
  return `${q.slice(0, -1).join(', ')} and ${q[q.length - 1]} use each other in a loop${TAIL}`;
}

describe('a loop is refused, and nothing else changes', () => {
  it('members name their loop; members and what depends on them are blank with a problem; the rest is untouched', () => {
    let members = 0, downstream = 0, bystanders = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      if (ONLY !== undefined && seed !== ONLY) continue;
      const r = mulberry32(seed * 49979687);
      const store = storeOf(randomStore(r, props, 6, 0.1));
      const n = 3 + int(r, 8);
      const names = Array.from({ length: n }, (_, i) => `${['L', 'Ring ', 'x_'][i % 3]}${i}`);
      // Who names whom: a forward tree, plus a few loops planted on purpose.
      const uses: Set<number>[] = names.map((_n, i) => new Set(i && r() < 0.7 ? [int(r, i)] : []));
      const plant = 1 + int(r, 2);
      for (let k = 0; k < plant; k++) {
        const len = 1 + int(r, Math.min(5, n));
        const ring = shuffle(r, names.map((_n, i) => i)).slice(0, len);
        ring.forEach((a, i) => uses[a].add(ring[(i + 1) % ring.length]));
      }
      // Reach, by the definition: a value is in a loop when it reaches itself.
      const reach = uses.map((_s, i) => {
        const seen = new Set<number>(); const stack = [...uses[i]];
        while (stack.length) { const x = stack.pop()!; if (!seen.has(x)) { seen.add(x); stack.push(...uses[x]); } }
        return seen;
      });
      const inLoop = names.map((_n, i) => reach[i].has(i));
      const after = names.map((_n, i) => !inLoop[i] && [...reach[i]].some((x) => inLoop[x]));
      const calcs: Calculated[] = names.map((name, i) => {
        const leaves = [...heads.map((h) => ref(key(h))), ...[...uses[i]].map((u) => ref(key(names[u])))];
        let e = genExpr(r, leaves, 1 + int(r, 2));
        for (const u of uses[i]) if (!JSON.stringify(e).includes(`"${key(names[u])}"`)) e = { t: 'bin', op: '+', a: e, b: ref(key(names[u])) };
        const all = [...heads, ...names];
        return { id: `n${i}`, name, kind: 'formula', formula: render(e, (to) => spellName(r, all.find((x) => key(x) === to)!)) };
      });
      const listed = shuffle(r, calcs);
      const def = scheduleOf([...cols, ...listed.map((c) => showCalc(c.id))], listed);
      const problems = calcProblems(store, def);
      const got = engineValues(store, def);
      const where = `seed ${seed}: ${listed.map((c) => `${c.name} = ${c.formula}`).join(' ; ')}`;

      const without = scheduleOf(cols, listed.filter((c) => !inLoop[Number(c.id.slice(1))]));
      const base = engineValues(store, without);
      names.forEach((name, i) => {
        const id = `n${i}`;
        if (inLoop[i]) {
          const ring = listed.filter((c) => { const j = Number(c.id.slice(1)); return j === i || (reach[i].has(j) && reach[j].has(i)); });
          expect([name, problems.get(id)], where).toEqual([name, loopText(ring.map((c) => c.name))]);
          members++;
        }
        if (inLoop[i] || after[i]) {
          expect([name, got[id].every((v) => v === undefined)], where).toEqual([name, true]);
          if (after[i]) downstream++;
        } else {
          expect([name, got[id]], where).toEqual([name, base[id]]);
          bystanders++;
        }
      });
    }
    if (ONLY !== undefined) return;
    expect(members).toBeGreaterThan(300);
    expect(downstream).toBeGreaterThan(100);
    expect(bystanders).toBeGreaterThan(100);
  });

  // Done 4 asks that a value downstream of a loop carries a problem too. The spec names the
  // members' text only and is silent on what depends on them; this pins the Done line.
  it('a value that depends on a loop says why it is blank', () => {
    const store = storeOf({ props, rows: [[2, 3]], storeys: ['L1'] });
    const def = scheduleOf(cols, [
      { id: 'a', name: 'A', kind: 'formula', formula: 'B + 1' },
      { id: 'b', name: 'B', kind: 'formula', formula: 'A + 1' },
      { id: 'c', name: 'After', kind: 'formula', formula: 'A * Area' },
    ]);
    expect(engineValues(store, def).c).toEqual([undefined]);
    expect(calcProblems(store, def).get('c')).toBeTruthy();
  });

  it('a 500-long chain computes and a 500-long ring is refused, quickly and without throwing', () => {
    const store = storeOf({ props, rows: [[2, 3], [5, null]], storeys: ['L1', 'L2'] });
    const r = mulberry32(500);
    const chain: Calculated[] = Array.from({ length: 500 }, (_, i) => ({
      id: `k${i}`, name: `K ${i}`, kind: 'formula', formula: i ? `[K ${i - 1}] + Area` : 'Area',
    }));
    const t0 = performance.now();
    const listed = shuffle(r, chain);
    const v = engineValues(store, scheduleOf(cols, listed));
    expect(v.k499).toEqual([1000, 2500]);
    expect(calcProblems(store, scheduleOf(cols, listed)).size).toBe(0);
    const ring = shuffle(r, chain.map((c, i) => (i ? c : { ...c, formula: '[K 499] + Area' })));
    const def = scheduleOf(cols, ring);
    const p = calcProblems(store, def);
    expect(p.size).toBe(500);
    expect([...p.values()].every((m) => m.endsWith(` use each other in a loop${TAIL}`))).toBe(true);
    expect(Object.values(engineValues(store, def)).flat().every((x) => x === undefined)).toBe(true);
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});
