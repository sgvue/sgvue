// Audit B9, review finding — reading a number out of text must stay linear in the text's
// length. Cell text is IFC property text of unbounded length; an ambiguous digit pattern
// (`\d+\.?\d*`) backtracked in O(N²) on a long digit run that is not a whole number.
import { describe, expect, it } from 'vitest';
import { numberOf } from '../../../src/schedule/schedule/compare';
import { storeNum } from '../../../src/schedule/schedule/format';

const LONG: [string, string][] = [
  ['100 000 digits + x', '1'.repeat(100_000) + 'x'],
  ['100 000 digits + " mm"', '1'.repeat(100_000) + ' mm'],
  ['50 000 digits e 50 000 digits + x', '1'.repeat(50_000) + 'e' + '1'.repeat(50_000) + 'x'],
];

/** Milliseconds one call takes. */
function timed(fn: () => unknown): number {
  const t = performance.now();
  fn();
  return performance.now() - t;
}

describe('numberOf is fast on long text', () => {
  it.each(LONG)('%s returns in under 100 ms', (_name, s) => {
    expect(timed(() => numberOf({ v: s }))).toBeLessThan(100);
  });
});

describe('numberOf never returns NaN or Infinity', () => {
  it('an exponent past a double is no number', () => {
    expect(numberOf({ v: '1e999' })).toBeNull();
    expect(numberOf({ v: '-1e999' })).toBeNull();
  });
  it('a 400-digit whole number is past a double, so no number', () => {
    expect(numberOf({ v: '1'.repeat(400) })).toBeNull();
  });
  it.each(LONG)('%s is null or finite', (_name, s) => {
    const n = numberOf({ v: s });
    expect(n === null || Number.isFinite(n)).toBe(true);
  });
});

describe('storeNum is fast on long text', () => {
  it.each(LONG)('%s returns in under 100 ms', (_name, s) => {
    expect(timed(() => storeNum(s, 'length', 'metric'))).toBeLessThan(100);
  });
});
