// Guard 3 of the chained formulas (2026-11-24): what the table does with a chained value — sum
// footers per group, the grand total, itemise on and off, sorting and filtering on it — follows
// the values the oracle (`support/chain.ts`) works out from the expression trees. The figure
// tolerance is the totals oracle's (`totals-oracle.test.ts`): half a unit of the last displayed
// decimal, plus 1e-9 relative. Replay one schedule with `CHAIN_SEED=<n>`.

import { describe, expect, it } from 'vitest';
import type { Calculated, Column, ScheduleDef } from '../../../src/schedule/schedule/def';
import { runSchedule, type DataRow, type FooterRow, type GrandRow, type RenderRow } from '../../../src/schedule/schedule/engine';
import {
  asVar, genExpr, int, key, modelColumn, mulberry32, oracle, pick, randomStore, ref, render,
  scheduleOf, spellName, storeOf, type Env, type Expr, type Prop, type Rng, type StoreSpec,
} from './support/chain';

const ONLY = process.env.CHAIN_SEED === undefined ? undefined : Number(process.env.CHAIN_SEED);
const SEEDS = 80;
const DECIMALS = 3;
const near = (a: number, b: number) => Math.abs(a - b) <= 0.5 * 10 ** -DECIMALS + 1e-9 * Math.max(Math.abs(a), Math.abs(b));

interface Gen { spec: StoreSpec; def: ScheduleDef; top: string; values: (number | undefined)[] }

/** Two or three values, each using the one before; the last is shown with a sum. */
function generate(r: Rng): Gen {
  const props: Prop[] = [{ prop: 'P0', kind: 'area' }, { prop: 'P1', kind: 'length' }];
  const heads = ['Area', 'Clear Height'];
  const spec = randomStore(r, props, 14, 0.15);
  const links: { id: string; name: string; expr: Expr }[] = [];
  const n = 2 + int(r, 2);
  for (let j = 0; j < n; j++) {
    const leaves = [...heads.map((h) => ref(key(h))), ...(j ? [ref(key(links[j - 1].name))] : [])];
    let expr = genExpr(r, leaves, int(r, 3));
    if (j && !JSON.stringify(expr).includes(`"${key(links[j - 1].name)}"`)) expr = { t: 'bin', op: '+', a: expr, b: leaves[leaves.length - 1] };
    links.push({ id: `t${j}`, name: pick(r, ['Base', 'Net Area', 'step_']) + j, expr });
  }
  const names = [...heads, ...links.map((l) => l.name)];
  const spell = (to: string) => spellName(r, names.find((x) => key(x) === to)!);
  const calculated: Calculated[] = links.map((l): Calculated => ({ id: l.id, name: l.name, kind: 'formula', formula: render(l.expr, spell) })).reverse();
  const top = links[n - 1].id;
  const columns: Column[] = [
    { field: { kind: 'core', key: 'storey' } },
    ...props.map((p, i) => modelColumn(p, heads[i])),
    ...links.slice(0, -1).map((l): Column => ({ field: { kind: 'formula', id: l.id }, hidden: r() < 0.5, format: { decimals: DECIMALS } })),
    { field: { kind: 'formula', id: top }, total: 'sum', format: { decimals: DECIMALS } },
  ];
  const values = spec.rows.map((row) => {
    const env: Env = new Map(heads.map((h, i) => [key(h), row[i] ?? undefined]));
    let v: number | undefined;
    for (const l of links) {
      v = oracle(l.expr, 'number', env) as number | undefined;
      env.set(key(l.name), asVar(v));
    }
    return v;
  });
  return { spec, def: scheduleOf(columns, calculated), top, values };
}

const isData = (x: RenderRow): x is DataRow => x.kind === 'data';
const colOf = (res: ReturnType<typeof runSchedule>, id: string) =>
  res.columns.findIndex((c) => c.field.kind === 'formula' && c.field.id === id);
const sum = (vs: (number | undefined)[]) => vs.reduce<number>((a, v) => a + (v ?? 0), 0);

describe('totals, groups, sorting and filtering on a chained value', () => {
  it('each footer and the grand total is the sum of the oracle’s values it covers, itemised or not', () => {
    let footers = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      if (ONLY !== undefined && seed !== ONLY) continue;
      const r = mulberry32(seed * 15485863);
      const g = generate(r);
      const store = storeOf(g.spec);
      for (const itemize of [true, false]) {
        const def: ScheduleDef = {
          ...g.def, itemize, grandTotal: true,
          sort: [{ field: { kind: 'core', key: 'storey' }, dir: 'asc', footer: pick(r, ['totals', 'titleCountTotals'] as const) }],
        };
        const res = runSchedule(store, def);
        const at = colOf(res, g.top);
        let covered: number[] = [];
        const where = `seed ${seed}, itemize ${itemize}: ${def.calculated!.map((c) => `${c.name} = ${c.formula}`).join(' ; ')}`;
        for (const row of res.rows) {
          if (isData(row)) {
            covered.push(...row.rows);
            // Every element of a line shares its cell.
            const vs = row.rows.map((e) => g.values[e]);
            expect(new Set(vs.map((v) => (v === undefined ? '' : v.toFixed(DECIMALS)))).size, where).toBe(1);
          } else if (row.kind === 'footer' || row.kind === 'grand') {
            const elems = row.kind === 'grand' ? g.spec.rows.map((_x, i) => i) : covered;
            const vs = elems.map((e) => g.values[e]);
            const got = (row as FooterRow | GrandRow).nums?.[at];
            // A sum over no value at all is left blank, as the totals oracle's is.
            if (vs.every((v) => v === undefined)) expect(got ?? null, `${where} — ${row.kind} ${row.label}`).toBeNull();
            else {
              expect(typeof got, `${where} — ${row.kind} ${row.label}`).toBe('number');
              expect(near(got!, sum(vs)), `${where} — ${row.kind} ${row.label}: ${got} vs ${sum(vs)}`).toBe(true);
            }
            if (row.kind === 'footer') { covered = []; footers++; }
          }
        }
      }
    }
    if (ONLY === undefined) expect(footers).toBeGreaterThan(300);
  });

  it('sorting by a chained value orders by its value; a filter on it keeps exactly the rows whose value passes', () => {
    let kept = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      if (ONLY !== undefined && seed !== ONLY) continue;
      const r = mulberry32(seed * 32452843);
      const g = generate(r);
      const store = storeOf(g.spec);
      const field = { kind: 'formula' as const, id: g.top };
      const where = `seed ${seed}: ${g.def.calculated!.map((c) => `${c.name} = ${c.formula}`).join(' ; ')}`;
      for (const dir of ['asc', 'desc'] as const) {
        const res = runSchedule(store, { ...g.def, sort: [{ field, dir }] });
        const seq = res.rows.filter(isData).map((d) => g.values[d.rows[0]]).filter((v): v is number => v !== undefined);
        const sorted = seq.slice().sort((a, b) => (dir === 'asc' ? a - b : b - a));
        expect(seq, `${where}, ${dir}`).toEqual(sorted);
      }
      const known = g.values.filter((v): v is number => v !== undefined).sort((a, b) => a - b);
      if (!known.length) continue;
      const t = known[Math.floor(known.length / 2)];
      for (const op of ['>', '<='] as const) {
        const res = runSchedule(store, { ...g.def, filters: [{ field, op, value: t }] });
        const got = res.rows.filter(isData).flatMap((d) => d.rows).sort((a, b) => a - b);
        const want = g.values.map((v, i) => [v, i] as const)
          .filter(([v]) => v !== undefined && (op === '>' ? v > t : v <= t)).map(([, i]) => i);
        expect(got, `${where}, ${op} ${t}`).toEqual(want);
        kept += got.length;
      }
    }
    if (ONLY === undefined) expect(kept).toBeGreaterThan(300);
  });
});
