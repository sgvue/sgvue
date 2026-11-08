// The filter-rule and sort-level caps live in the actions, not only in a disabled button:
// parseScheduleDef keeps at most MAX_FILTERS / MAX_SORT_LEVELS, so an over-cap add would be
// data silently dropped on the next reload.
// Ported from ifcTable's `tests/caps.test.ts` (Yong Yen) for SGVue v1.5.0, phase 1.
import { describe, expect, it } from 'vitest';
import * as act from '../../../src/schedule/schedule/actions';
import { MAX_FILTERS, MAX_SORT_LEVELS, parseScheduleDef } from '../../../src/schedule/schedule/def';

const base = () => parseScheduleDef({ version: 1, columns: [{ field: { kind: 'core', key: 'name' } }] });

describe('caps', () => {
  it(`addFilterRule stops at ${MAX_FILTERS}`, () => {
    let d = base();
    for (let n = 0; n < MAX_FILTERS + 3; n++) d = act.addFilterRule(d);
    expect(d.filters.length).toBe(MAX_FILTERS);
    expect(parseScheduleDef(JSON.parse(JSON.stringify(d))).filters.length).toBe(MAX_FILTERS);
  });
  it(`addSortLevel stops at ${MAX_SORT_LEVELS}`, () => {
    let d = base();
    for (let n = 0; n < MAX_SORT_LEVELS + 3; n++) d = act.addSortLevel(d);
    expect(d.sort.length).toBe(MAX_SORT_LEVELS);
  });
  it('an add at the cap returns a new, equal definition (still pure)', () => {
    let d = base();
    for (let n = 0; n < MAX_FILTERS; n++) d = act.addFilterRule(d);
    const next = act.addFilterRule(d);
    expect(next).not.toBe(d);
    expect(next).toEqual(d);
  });
});
