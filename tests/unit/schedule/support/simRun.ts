// The simulation runner, shared by the shard files so 500 seeds run on several workers.
// See simulation.test.ts for what it checks and how to replay a seed.
//
// Ported from ifcTable's `tests/support/simRun.ts` (Yong Yen) for SGVue v1.5.0, phase 1.
// SGVue starts from its own cases too — the federation store with its Model column.
import { expect } from 'vitest';
import { toCsv } from '../../../../src/schedule/export/csv';
import { fullResult, toRows } from '../../../../src/schedule/export/rows';
import { oneSheet, xlsxBlob } from '../../../../src/schedule/export/xlsx';
import { record, redo, resetHistory, setClock, undo } from '../../../../src/schedule/history';
import * as act from '../../../../src/schedule/schedule/actions';
import { matchRule } from '../../../../src/schedule/schedule/compare';
import { planComputed } from '../../../../src/schedule/schedule/computed';
import {
  MAX_FILTERS, MAX_SORT_LEVELS, parseScheduleDef, ScheduleImportError, type ScheduleDef,
} from '../../../../src/schedule/schedule/def';
import { candidateRows, runSchedule, type DataRow, type ScheduleResult } from '../../../../src/schedule/schedule/engine';
import { resolveField } from '../../../../src/schedule/schedule/resolve';
import { allCases, buildStores, type StoreName } from './fixture';
import { GENS, mulberry32, type ActionName, type Ctx } from './sim';

const SEEDS = Number(process.env.SIM_SEEDS ?? 500);
const STEPS = Number(process.env.SIM_STEPS ?? 40);
export const ONLY = process.env.SIM_SEED === undefined ? undefined : Number(process.env.SIM_SEED);

export const CASES = allCases();
const STORES = buildStores();
export const CTX: Record<StoreName, Ctx> = {
  metric: { store: STORES.metric, system: 'metric' },
  imperial: { store: STORES.imperial, system: 'imperial' },
  federation: { store: STORES.federation, system: 'metric' },
};
const NAMES = Object.keys(GENS) as ActionName[];
const j = (x: unknown) => JSON.stringify(x);
export const viaFile = (d: ScheduleDef) => parseScheduleDef(JSON.parse(JSON.stringify(d, null, 2)));

/** What a user sees of a result — everything except the echo of the def's own columns. */
export const seen = (res: ScheduleResult) => {
  const { columns: _c, ...rest } = res;
  return rest;
};
export const run = (store: Ctx['store'], d: ScheduleDef) => runSchedule(store, d, { cap: Infinity });

/** The filter, re-derived from its primitives: which candidate elements should be kept. */
function oracleKeeps(store: Ctx['store'], d: ScheduleDef): number[] {
  const plan = planComputed(d);
  return candidateRows(store, d).filter((r) => {
    if (!d.filters.length) return true;
    const comp = plan.compute(store, r);
    const hits = d.filters.map((f) => matchRule(resolveField(store, r, f.field, comp), f));
    return d.filterLogic === 'or' ? hits.some(Boolean) : hits.every(Boolean);
  });
}

const condCount = (d: ScheduleDef) => d.columns.reduce((n, c) => n + (c.conditional?.length ?? 0), 0);
const counts = (d: ScheduleDef) => ({
  columns: d.columns.length, filters: d.filters.length, sort: d.sort.length,
  cond: condCount(d), calculated: d.calculated?.length ?? 0,
});

/** The counts an action is allowed to change, and by how much. Everything else must hold. */
function expectedCounts(name: ActionName, args: unknown[], d: ScheduleDef) {
  const e = counts(d);
  const colsOn = (keep: (c: ScheduleDef['columns'][number]) => boolean) => {
    const gone = d.columns.filter((c) => !keep(c));
    e.columns -= gone.length;
    e.cond -= gone.reduce((n, c) => n + (c.conditional?.length ?? 0), 0);
  };
  switch (name) {
    case 'addColumns': e.columns += (args[0] as unknown[]).length;
      e.cond += (args[0] as ScheduleDef['columns']).reduce((n, c) => n + (c.conditional?.length ?? 0), 0); break;
    case 'removeColumn': colsOn((c) => c !== d.columns[args[0] as number]); break;
    case 'removeCalculated':
      e.calculated -= (d.calculated ?? []).filter((c) => c.id === args[0]).length;
      colsOn((c) => !(c.field.kind === 'formula' && c.field.id === args[0])); break;
    case 'addFilterRule': e.filters = Math.min(e.filters + 1, MAX_FILTERS); break;
    case 'removeFilterRule': e.filters -= 1; break;
    case 'addSortLevel': e.sort = Math.min(e.sort + 1, MAX_SORT_LEVELS); break;
    case 'removeSortLevel': e.sort -= 1; break;
    case 'addConditionalRule': e.cond += 1; break;
    case 'removeConditionalRule': e.cond -= 1; break;
    case 'addCalculated': e.calculated += 1; break;
    // Every other action changes no count. Named one by one (SGVue's lint: a switch over a
    // union names every member), so a new action has to be placed here by hand.
    case 'moveColumn': case 'moveSortLevel': case 'remapColumn': case 'setAlign':
    case 'setAppearance': case 'setCalculatedResult': case 'setCalculatedUnitKind':
    case 'setColumnFormat': case 'setFilterField': case 'setFilterMode': case 'setFilterOp':
    case 'setFilterRange': case 'setFilterValue': case 'setFilterValues': case 'setGrandTotal':
    case 'setGrandTotalTitle': case 'setGroupOptions': case 'setHeading':
    case 'setHeadingOrientation': case 'setHidden': case 'setItemize': case 'setName':
    case 'setSortDir': case 'setSortField': case 'setTotal': case 'setWidths':
    case 'updateCalculated': case 'updateConditionalRule':
      break;
  }
  return e;
}

function checkStep(ctx: Ctx, name: ActionName, args: unknown[], d: ScheduleDef, next: ScheduleDef, before: string) {
  // Pure: the input is untouched and the output is a different object.
  expect(j(d), 'action mutated its input').toBe(before);
  expect(next).not.toBe(d);
  expect(next.version).toBe(1);
  expect(next.entity).toEqual(d.entity);
  const after = j(next);

  // Nothing disappears unless the action was its removal.
  expect(counts(next), 'a column/filter/sort level/rule/calculation changed count').toEqual(expectedCounts(name, args, d));
  // Never past the caps parse truncates to — that would drop rules on reload.
  expect(next.filters.length, 'filter rules over the cap').toBeLessThanOrEqual(MAX_FILTERS);
  expect(next.sort.length, 'sort levels over the cap').toBeLessThanOrEqual(MAX_SORT_LEVELS);
  if (name === 'moveColumn') expect([...next.columns].map(j).sort()).toEqual([...d.columns].map(j).sort());
  if (name === 'removeColumn' || name === 'removeCalculated') {
    // Removing a field never cascades into the rules that name it (see header).
    expect(j(next.filters)).toBe(j(d.filters));
    expect(j(next.sort)).toBe(j(d.sort));
  }
  if (name === 'setHidden') {
    const i = args[0] as number;
    const { hidden: _a, ...was } = d.columns[i];
    const { hidden: _b, ...now } = next.columns[i];
    expect(j(now), 'hiding a column changed its formatting').toBe(j(was));
  }

  // Engine: runs (and leaves the definition alone).
  const res = run(ctx.store, next);
  expect(j(next), 'the engine mutated the definition').toBe(after);

  // Save/load: through .schedule.json it is a fixed point after one normalization, and the
  // normalized definition shows exactly what the live one does.
  if (!next.columns.length) {
    expect(() => viaFile(next)).toThrow(ScheduleImportError);
  } else {
    const once = viaFile(next);
    expect(j(viaFile(once)), 'parse is not idempotent').toBe(j(once));
    expect(j(seen(run(ctx.store, once))), 'a saved-and-reloaded schedule shows something different').toBe(j(seen(res)));
  }
  // localStorage stores the def itself and loads structuredClone(entry.def).
  expect(j(structuredClone(JSON.parse(after)))).toBe(after);

  // The engine keeps exactly the elements the filter keeps, each once.
  const keeps = oracleKeeps(ctx.store, next);
  expect(res.matchedElements).toBe(keeps.length);
  const covered = res.rows.filter((x): x is DataRow => x.kind === 'data').flatMap((x) => x.rows).sort((a, b) => a - b);
  expect(covered).toEqual([...keeps].sort((a, b) => a - b));

  // CSV export runs and has one line per rendered row plus the header.
  const csvRows = toRows(fullResult(ctx.store, next));
  expect(toCsv(csvRows).split('\r\n').length).toBe(csvRows.length);
}

export async function runSeed(seed: number) {
  const r = mulberry32(seed);
  const start = CASES[Math.floor(r() * CASES.length)];
  const ctx = CTX[start.store];
  const log: { name: ActionName; args: unknown[] }[] = [];
  let def = structuredClone(start.def);
  // Every 10th seed starts at both caps, so the random adds that follow are over-cap ones.
  if (seed % 10 === 0) {
    while (def.filters.length < MAX_FILTERS) def = act.addFilterRule(def);
    while (def.sort.length < MAX_SORT_LEVELS) def = act.addSortLevel(def);
  }
  let clock = 0;
  setClock(() => clock);
  resetHistory(def);
  try {
    for (let s = 0; s < STEPS; s++) {
      const offered = NAMES.map((n) => [n, GENS[n](def, r, ctx)] as const).filter(([, a]) => a !== null);
      const [name, args] = offered[Math.floor(r() * offered.length)] as [ActionName, unknown[]];
      log.push({ name, args });
      const before = j(def);
      const next = (act[name] as (d: ScheduleDef, ...a: unknown[]) => ScheduleDef)(def, ...structuredClone(args));
      checkStep(ctx, name, args, def, next, before);
      // History, as updateDef drives it: record each change; undo gives back exactly the
      // previous def, redo exactly this one. 1 s apart, so no two steps coalesce.
      clock += 1000;
      record(next);
      if (j(next) !== before) {
        expect(j(undo()), 'undo did not restore the previous definition').toBe(before);
        expect(j(redo()), 'redo did not restore the definition').toBe(j(next));
      }
      def = next;
    }
    // Workbook export once per run — exceljs is the slow part.
    await xlsxBlob(oneSheet(fullResult(ctx.store, def), def));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`SIM_SEED=${seed} (start: ${start.id}) failed at step ${log.length}: ${msg}\n`
      + `actions: ${JSON.stringify(log)}`);
  }
}

/** The seeds shard `k` of `n` runs: 1..SIM_SEEDS dealt round-robin, or just SIM_SEED. */
export function seedsFor(k: number, n: number): number[] {
  if (ONLY !== undefined) return k === 1 ? [ONLY] : [];
  return Array.from({ length: SEEDS }, (_, i) => i + 1).filter((s) => s % n === k % n);
}
export { STEPS };
