import { describe, expect, it } from 'vitest';
import { compile, FormulaError, referencedNames, type Vars } from '../../../src/schedule/schedule/formula';

const vars = (o: Record<string, number>): Vars =>
  new Map(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));

const run = (src: string, v: Record<string, number> = {}) => compile(src)(vars(v));

describe('arithmetic', () => {
  it('respects precedence and parentheses', () => {
    expect(run('2 + 3 * 4')).toBe(14);
    expect(run('(2 + 3) * 4')).toBe(20);
    expect(run('10 - 4 - 3')).toBe(3);  // left-associative
    expect(run('2 * 3 / 6')).toBe(1);
  });

  it('handles unary minus, which must bind tighter than any binary operator', () => {
    expect(run('-5')).toBe(-5);
    expect(run('-5 + 8')).toBe(3);
    expect(run('3 * -2')).toBe(-6);
    expect(run('-(2 + 3)')).toBe(-5);
    expect(run('10 / -2')).toBe(-5);
    expect(run('2 - -3')).toBe(5);
    expect(run('+7')).toBe(7);
    expect(run('Area * -1', { Area: 3 })).toBe(-3);
  });

  it('reads decimals and exponents', () => {
    expect(run('1.5 * 2')).toBe(3);
    expect(run('1e3')).toBe(1000);
  });
});

describe('variables', () => {
  it('substitutes column values, case-insensitively', () => {
    expect(run('Area * 1.15', { Area: 20 })).toBeCloseTo(23);
    expect(run('area * 2', { Area: 20 })).toBe(40);
  });

  it('reads bracketed names containing spaces', () => {
    expect(run('[Clear Width] / 1000', { 'Clear Width': 900 })).toBeCloseTo(0.9);
  });

  it('returns blank when an operand is missing', () => {
    expect(run('Area * 2', {})).toBeNull();
  });

  it('returns blank when an operand is not a number', () => {
    expect(compile('Area * 2')(vars({ Area: NaN }))).toBeNull();
  });
});

describe('functions', () => {
  it('rounds, floors, ceils and takes abs', () => {
    expect(run('round(2.567, 2)')).toBe(2.57);
    expect(run('round(2.5)')).toBe(3);
    expect(run('floor(2.9)')).toBe(2);
    expect(run('ceil(2.1)')).toBe(3);
    expect(run('abs(0 - 7)')).toBe(7);
    expect(run('sqrt(16)')).toBe(4);
  });

  it('picks min and max', () => {
    expect(run('min(3, 7)')).toBe(3);
    expect(run('max(3, 7, 11)')).toBe(11);
  });

  it('branches with if()', () => {
    expect(run('if(Width > 900, 1, 0)', { Width: 1200 })).toBe(1);
    expect(run('if(Width > 900, 1, 0)', { Width: 800 })).toBe(0);
  });

  it('rejects the wrong number of arguments at compile time', () => {
    expect(() => compile('if(1, 2)')).toThrow(FormulaError);
    expect(() => compile('round(1, 2, 3)')).toThrow(FormulaError);
  });
});

describe('comparisons and logic', () => {
  it('returns 1 or 0', () => {
    expect(run('5 > 3')).toBe(1);
    expect(run('5 < 3')).toBe(0);
    expect(run('2 = 2')).toBe(1);
    expect(run('2 != 2')).toBe(0);
    expect(run('(1 > 0) && (2 > 1)')).toBe(1);
    expect(run('(1 > 2) || (2 > 1)')).toBe(1);
  });
});

describe('failure modes never reach the page', () => {
  it('blanks division by zero instead of showing Infinity', () => {
    expect(run('1 / 0')).toBeNull();
    expect(run('Area / Count', { Area: 5, Count: 0 })).toBeNull();
  });

  it('blanks overflow', () => {
    expect(run('9e307 * 10')).toBeNull();
  });

  it('rejects unbalanced parentheses', () => {
    expect(() => compile('(1 + 2')).toThrow(FormulaError);
    expect(() => compile('1 + 2)')).toThrow(FormulaError);
  });

  it('rejects unknown characters and empty input', () => {
    expect(() => compile('1 $ 2')).toThrow(FormulaError);
    expect(() => compile('   ')).toThrow(FormulaError);
  });

  it('rejects incomplete expressions at compile time, not as a silent blank', () => {
    // These used to parse and then quietly render an empty column forever.
    expect(() => compile('1 +')).toThrow(FormulaError);
    expect(() => compile('* 2')).toThrow(FormulaError);
    expect(() => compile('1 2')).toThrow(FormulaError);
    expect(() => compile('Area *')).toThrow(FormulaError);
    expect(() => compile('min(1)')).toThrow(FormulaError);
  });

  it('never executes arbitrary code', () => {
    // these must be parse errors, not evaluation
    for (const evil of ['constructor', 'this.alert(1)', 'process.exit(1)']) {
      const out = (() => { try { return compile(evil)(vars({})); } catch { return 'threw'; } })();
      expect(out === null || out === 'threw').toBe(true);
    }
  });
});

describe('referencedNames', () => {
  it('lists the columns a formula depends on', () => {
    expect(referencedNames('Area * 1.15 + [Clear Width]')).toEqual(['Area', 'Clear Width']);
  });
  it('does not count function names as columns', () => {
    expect(referencedNames('round(Area, 2)')).toEqual(['Area']);
  });
  it('returns nothing for unparseable input rather than throwing', () => {
    expect(referencedNames('1 $ 2')).toEqual([]);
  });
});
