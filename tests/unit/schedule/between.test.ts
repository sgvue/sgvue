// A `between` filter with an empty end is open-ended — the same live, after a save, and
// for a save written before the fix (where the empty end is null).
// Ported from ifcTable's `tests/between.test.ts` (Yong Yen) for SGVue v1.5.0, phase 1.
import { describe, expect, it } from 'vitest';
import * as act from '../../../src/schedule/schedule/actions';
import { matchRule } from '../../../src/schedule/schedule/compare';
import { parseScheduleDef, type FilterRule } from '../../../src/schedule/schedule/def';

const field = { kind: 'prop', pset: '*', prop: 'Width' } as const;
const rule = (values: unknown[]) => ({ field, op: 'between', values }) as FilterRule;
const keeps = (r: FilterRule) => [undefined, -1, 0, 0.5, 1, 2, 'n/a'].map((v) => matchRule(v === undefined ? undefined : { v }, r));

describe('between with an empty end', () => {
  it('only the upper end filled is "<= hi"', () => {
    expect(keeps(rule(['', 1]))).toEqual([false, true, true, true, true, false, false]);
  });
  it('only the lower end filled is ">= lo"', () => {
    expect(keeps(rule([1, '']))).toEqual([false, false, false, false, true, true, false]);
    expect(keeps(rule([1]))).toEqual([false, false, false, false, true, true, false]);
  });
  it('both ends empty keeps everything', () => {
    for (const v of [[], ['', ''], [null, null]]) expect(keeps(rule(v)).every(Boolean)).toBe(true);
    expect(matchRule({ v: 1 }, { field, op: 'between' })).toBe(true);
  });
  it('both ends filled is unchanged (either order)', () => {
    expect(keeps(rule([0.5, 1]))).toEqual([false, false, false, true, true, false, false]);
    expect(keeps(rule([1, 0.5]))).toEqual([false, false, false, true, true, false, false]);
  });

  it('setFilterRange never stores an array hole; undefined empties a box', () => {
    let d = parseScheduleDef({ version: 1, columns: [{ field }], filters: [{ field, op: 'between' }] });
    d = act.setFilterRange(d, 0, 1, 1.2);
    expect(d.filters[0].values).toEqual(['', 1.2]);
    expect(0 in d.filters[0].values!).toBe(true);
    d = act.setFilterRange(d, 0, 1, undefined);
    expect(d.filters[0].values).toEqual(['', '']);
  });

  it('an old save with a null end loads as the empty box and filters the same', () => {
    const d = parseScheduleDef({ version: 1, columns: [{ field }], filters: [{ field, op: 'between', values: [null, 1] }] });
    expect(d.filters[0].values).toEqual(['', 1]);
    expect(keeps(d.filters[0])).toEqual(keeps(rule(['', 1])));
  });
});
