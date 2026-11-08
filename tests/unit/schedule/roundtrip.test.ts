// Save/load round-trips. Every save path must give back what went in:
//   .schedule.json — the Export menu writes JSON.stringify(def, null, 2), Open schedule file…
//                    reads it through parseScheduleDef (so do a project file, the assistant's
//                    `make_schedule` and the Schedules port);
//   localStorage   — saveSchedule stores the def itself; SGVue's listSaved reads every entry
//                    back through parseScheduleDef (ifcTable's handed structuredClone back
//                    unparsed), and loading a saved setup structuredClones that;
//   a project's list — while a project is open the same functions act on the project's list
//                    (2026-11-07), which is held as written.
// After the parser's first normalization a definition is a fixed point: parsing it again
// must change nothing, byte for byte.
//
// Ported from ifcTable's `tests/roundtrip.test.ts` (Yong Yen) for SGVue v1.5.0, phase 1.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseScheduleDef } from '../../../src/schedule/schedule/def';
import { listSaved, saveSchedule, setProjectList } from '../../../src/renderer/schedule-ui/schedules';
import { allCases, buildStores, legacyFixture } from './support/fixture';
import { csvOf, resultOf } from './support/outputs';

const viaFile = (def: unknown) => parseScheduleDef(JSON.parse(JSON.stringify(def, null, 2)));
const cases = allCases();
const stores = buildStores();

describe('.schedule.json round-trip', () => {
  for (const c of cases) {
    it(`${c.id}: serialize → parse → serialize is stable after the first normalization`, () => {
      const once = JSON.stringify(viaFile(c.def));
      const twice = JSON.stringify(viaFile(JSON.parse(once)));
      expect(twice).toBe(once);
    });
    it(`${c.id}: the normalized definition produces the same output`, () => {
      const store = stores[c.store];
      const parsed = viaFile(c.def);
      expect(resultOf(store, parsed).rows).toEqual(resultOf(store, c.def).rows);
      expect(csvOf(store, parsed)).toBe(csvOf(store, c.def));
    });
  }

  it('legacy-v1 fixture: raw file → parse → serialize → parse is stable', () => {
    const once = JSON.stringify(viaFile(legacyFixture()));
    expect(JSON.stringify(viaFile(JSON.parse(once)))).toBe(once);
  });
});

describe('localStorage saved-schedule round-trip', () => {
  const cell = new Map<string, string>();
  beforeEach(() => {
    cell.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => (cell.has(k) ? cell.get(k)! : null),
        setItem: (k: string, v: string) => { cell.set(k, String(v)); },
        removeItem: (k: string) => { cell.delete(k); },
      },
    });
  });

  for (const c of cases) {
    it(`${c.id}: save → list → load gives back the same definition`, () => {
      const name = saveSchedule(c.def, null);
      expect(name).toBe(c.def.name.trim() || 'Untitled schedule');
      const entry = listSaved().find((e) => e.name === name)!;
      // Using a saved setup hands the window structuredClone(entry.def), exactly this — which
      // SGVue's listSaved has read through parseScheduleDef.
      const loaded = structuredClone(entry.def);
      expect(JSON.stringify(loaded)).toBe(JSON.stringify(viaFile({ ...c.def, name })));
      // And it shows what the definition that was saved shows.
      const store = stores[c.store];
      expect(resultOf(store, loaded).rows).toEqual(resultOf(store, c.def).rows);
      // Saving what was loaded, over itself, is a no-op on the stored bytes' def.
      saveSchedule(loaded, name);
      expect(JSON.stringify(listSaved()[0].def)).toBe(JSON.stringify(loaded));
      expect(listSaved()).toHaveLength(1);
    });
  }
});

describe("an open project's saved-schedule round-trip", () => {
  afterEach(() => setProjectList(null));

  for (const c of cases) {
    it(`${c.id}: save → list → load gives back what was saved, and saving it again changes nothing`, () => {
      setProjectList([], () => undefined);
      const name = saveSchedule(c.def, null)!;
      expect(name).toBe(c.def.name.trim() || 'Untitled schedule');
      const loaded = structuredClone(listSaved().find((e) => e.name === name)!.def);
      expect(JSON.stringify(loaded)).toBe(JSON.stringify({ ...c.def, name }));
      saveSchedule(loaded, name);
      expect(JSON.stringify(listSaved()[0].def)).toBe(JSON.stringify(loaded));
      expect(listSaved()).toHaveLength(1);
    });
  }
});
