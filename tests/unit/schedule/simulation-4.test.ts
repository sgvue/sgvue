// Shard 4 of the seeded simulation — see simulation.test.ts. (Ported from ifcTable, Yong Yen.)
import { describe, it } from 'vitest';
import { runSeed, seedsFor, STEPS } from './support/simRun';

describe('seeded simulation, shard 4/4', () => {
  const seeds = seedsFor(4, 4);
  it(`${seeds.length} seed(s) × ${STEPS} steps hold every invariant`, async () => {
    for (const seed of seeds) await runSeed(seed);
  }, 600_000);
});
