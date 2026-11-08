// Seeded simulation (model-based random testing) over schedule/actions.ts. For each seed:
// start from a random known definition (every preset in both unit systems, the hand-built
// defs, the legacy fixture) and apply 40 random actions the UI could send, checking every
// invariant after EVERY step. Deterministic — the run is a function of the seed — so a
// failure prints the seed and the exact action list. 500 seeds, dealt over this file and
// simulation-2/3/4 so they run on separate workers. Runner: tests/support/simRun.ts.
//
//   SIM_SEED=123 npx vitest run tests/unit/schedule/simulation      — replay one seed
//   SIM_SEEDS=5000 npx vitest run tests/unit/schedule/simulation    — a longer soak
//
// Ported from ifcTable's `tests/simulation.test.ts` (Yong Yen) for SGVue v1.5.0, phase 1. The
// starting definitions include SGVue's own federation cases (the mock federation through the
// adapter, with its Model column).
//
// Invariants, after every step:
//  1. The action is pure: its input is unchanged, its output a new object, version and
//     entity untouched; the engine does not mutate the definition either.
//  2. Filter rules and sort levels never exceed MAX_FILTERS / MAX_SORT_LEVELS (an add at the
//     cap is a no-op; every 10th seed starts at both caps). Nothing disappears unless the action was its removal: column, filter, sort level,
//     conditional rule and calculated-value counts change only as that action says; a move
//     is a permutation; hiding a column leaves every other key of it identical.
//  3. Removing a column or a calculated value never cascades into
//     filters or sort levels that name it — they stay byte-identical (current behaviour: a
//     rule resolves its FieldRef straight from the model; a rule on a deleted calculated
//     value then resolves blank).
//  4. Save/load via .schedule.json: parse is idempotent after one normalization, and the
//     reloaded definition shows exactly what the live one does (rows, headings, totals,
//     counts, number formats, rule hits). A definition with NO columns is rejected by
//     parseScheduleDef ("Schedule has no usable columns.") — pinned as current behaviour.
//     localStorage (structuredClone of the JSON) is byte-identical.
//  5. Undo after each change returns exactly the previous definition; redo exactly this one.
//  6. The engine keeps exactly the elements the filter keeps (re-derived independently from
//     matchRule/resolveField), and every kept element appears in exactly one data line.
//  7. CSV export runs and yields one line per row; the XLSX export runs at the end of each seed.

import { describe, expect, it } from 'vitest';
import * as act from '../../../src/schedule/schedule/actions';
import { CASES, CTX, run, runSeed, seedsFor, seen, STEPS, viaFile } from './support/simRun';
import { GENS, HELPERS } from './support/sim';

describe('seeded simulation over schedule actions', () => {
  it('has a generator for every action the barrel exports', () => {
    const exported = Object.keys(act).filter((k) => !HELPERS.includes(k)).sort();
    expect(Object.keys(GENS).sort()).toEqual(exported);
  });

  const seeds = seedsFor(1, 4);
  it(`shard 1/4: ${seeds.length} seed(s) × ${STEPS} steps hold every invariant`, async () => {
    for (const seed of seeds) await runSeed(seed);
  }, 600_000);
});

// Bugs the simulation found, kept as regressions.
describe('simulation finds (fixed)', () => {
  // Found by SIM_SEED=143. Filling only the upper box of a `between` filter used to store
  // values = [<hole>, hi]: live the rule matched NOTHING, through JSON (save, export, undo/
  // redo) the hole became null → 0 and the rule matched 0…hi. Now an empty end is stored as
  // '' and read as open-ended, so live and reloaded agree.
  it('a between rule with only its upper bound reloads as the same filter', () => {
    const { store } = CTX.metric;
    let d = structuredClone(CASES.find((c) => c.id === 'preset-door-schedule')!.def);
    d = act.addFilterRule(d);
    d = act.setFilterField(d, 0, { kind: 'prop', pset: '*', prop: 'Width' });
    d = act.setFilterOp(d, 0, 'between');
    d = act.setFilterRange(d, 0, 1, 1.2);
    expect(seen(run(store, viaFile(d)))).toEqual(seen(run(store, d)));
  });
});
