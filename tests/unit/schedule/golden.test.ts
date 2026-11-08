// Golden master (characterization) tests. They do not say what the output SHOULD be —
// they pin what it IS today, so a rewrite of the editing UI can prove it changed nothing a
// user keeps: the parsed definition, the rows the engine produces, the CSV text and the
// workbook's content. One file per case under golden/; a diff there is a behaviour
// change, and must never be accepted with `-u` without saying why.
//
// Ported from ifcTable's `tests/golden.test.ts` (Yong Yen) for SGVue v1.5.0. The synthetic
// cases are ifcTable's; their files differ from ifcTable's own only where SGVue does (a
// template's `meta.notes` reads "SGVue template — …"). The `federation-*` cases are SGVue's:
// the mock federation through the adapter, with its `Model` column.

import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allCases, buildStores } from './support/fixture';
import { csvOf, resultOf, xlsxDigest } from './support/outputs';

const stores = buildStores();

describe('golden master', () => {
  for (const c of allCases()) {
    it(c.id, async () => {
      const store = stores[c.store];
      const snap = {
        def: c.def,
        result: resultOf(store, c.def),
        csv: csvOf(store, c.def).split('\r\n'),
        xlsx: await xlsxDigest(store, c.def),
      };
      // A missing file would otherwise be written and pass, so a renamed or deleted case
      // would slip through. Adding a case: create the file empty first, then run `-u`.
      const file = new URL(`./golden/${c.id}.json`, import.meta.url);
      expect(existsSync(file), `golden file missing for ${c.id}`).toBe(true);
      await expect(JSON.stringify(snap, null, 1) + '\n').toMatchFileSnapshot(`./golden/${c.id}.json`);
    }, 30_000);
  }
});
