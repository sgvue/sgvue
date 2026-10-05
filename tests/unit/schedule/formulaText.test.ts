// Text in, number out — and the dimension check that catches a formula whose result cannot
// mean what it says.

import { describe, expect, it } from 'vitest';
import { compile, dimensionOf, type Vars } from '../../../src/schedule/schedule/formula';

const vars = (o: Record<string, number | string>): Vars =>
  new Map(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));

const run = (src: string, v: Record<string, number | string>) => compile(src)(vars(v));

describe('a formula can ask about text', () => {
  it('matches a substring, case-insensitively', () => {
    // The case that could not be expressed at all before: flag the fire doors.
    expect(run('contains(Type, "FD")', { Type: 'FD-60 Metal Door' })).toBe(1);
    expect(run('contains(Type, "fd")', { Type: 'FD-60 Metal Door' })).toBe(1);
    expect(run('contains(Type, "FD")', { Type: 'Timber Door' })).toBe(0);
  });

  it('matches the start and the end', () => {
    expect(run('starts(Mark, "D")', { Mark: 'D-101' })).toBe(1);
    expect(run('starts(Mark, "W")', { Mark: 'D-101' })).toBe(1 - 1);
    expect(run('ends(Mark, "101")', { Mark: 'D-101' })).toBe(1);
  });

  it('compares text for equality with = and !=', () => {
    expect(run('Family = "Basic Wall"', { Family: 'basic wall' })).toBe(1);
    expect(run('Family != "Basic Wall"', { Family: 'Curtain Wall' })).toBe(1);
  });

  it('drops straight into if() and into arithmetic', () => {
    expect(run('if(contains(Type, "FD"), Width, 0)', { Type: 'FD-60', Width: 0.9 })).toBe(0.9);
    expect(run('if(contains(Type, "FD"), Width, 0)', { Type: 'Timber', Width: 0.9 })).toBe(0);
  });

  it('reads a number out of a text field only when asked', () => {
    // Never implicitly: `Mark + 1` must not mean different things in different files.
    expect(run('number(Mark) + 1', { Mark: '2400' })).toBe(2401);
    expect(run('number(Mark)', { Mark: '1,250' })).toBe(1250);
    expect(run('Mark + 1', { Mark: '2400' })).toBe(null);
  });

  it('blanks the cell for arithmetic on text rather than inventing a number', () => {
    expect(run('Type * 2', { Type: 'Timber' })).toBe(null);
    expect(run('Type - Width', { Type: 'Timber', Width: 0.9 })).toBe(null);
  });

  it('still refuses to return text', () => {
    // if() can select a text branch; the column is numeric, so that is a blank, not "abc".
    expect(run('if(1, Type, 0)', { Type: 'Timber' })).toBe(null);
  });

  it('rejects an unclosed quote at compile time', () => {
    expect(() => compile('contains(Type, "FD')).toThrow(/Unclosed/);
  });
});

describe('a formula knows what its result measures', () => {
  const kinds = new Map([['width', 'length'], ['height', 'length'], ['area', 'area'],
    ['volume', 'volume'], ['count', 'none'], ['type', 'none']]);

  it('a length times a plain number is still a length', () => {
    expect(dimensionOf('Height * 2', kinds).kind).toBe('length');
  });

  it('a length times a length is an area, and times another is a volume', () => {
    expect(dimensionOf('Width * Height', kinds).kind).toBe('area');
    expect(dimensionOf('Width * Height * Width', kinds).kind).toBe('volume');
  });

  it('dividing cancels back down again', () => {
    expect(dimensionOf('Area / Width', kinds).kind).toBe('length');
    expect(dimensionOf('Volume / Area', kinds).kind).toBe('length');
    expect(dimensionOf('Area / Area', kinds).kind).toBe('none');
  });

  it('catches adding a length to an area', () => {
    // Arithmetically fine, physically meaningless, and it used to produce a silent number.
    const r = dimensionOf('Width + Area', kinds);
    expect(r.problem).toMatch(/length.*area|area.*length/);
    expect(r.kind).toBe(null);
  });

  it('a comparison or a text test is a plain number whatever went in', () => {
    expect(dimensionOf('Width > 0.9', kinds).kind).toBe('none');
    expect(dimensionOf('contains(Type, "FD")', kinds).kind).toBe('none');
  });

  it('sqrt of an area is a length', () => {
    expect(dimensionOf('sqrt(Area)', kinds).kind).toBe('length');
  });

  it('has no opinion it cannot justify', () => {
    // An unknown column name, or a shape with no name (1/length), must not be guessed at.
    expect(dimensionOf('Mystery * 2', kinds).kind).toBe(null);
    expect(dimensionOf('1 / Width', kinds).kind).toBe(null);
  });

  it('never throws on a formula that does not even parse', () => {
    expect(() => dimensionOf('1 +', kinds)).not.toThrow();
    expect(dimensionOf('((((', kinds).kind).toBe(null);
  });
});

describe('a type name that starts with digits is still text', () => {
  // The bug this caught on a real model: numberOf() digs the first number out of any string
  // so a filter can compare "900 mm" against 900. Feeding formula variables through it
  // turned the door type "1100x2400 (2HR) Metal" into the number 1100, and
  // contains(Type, "Metal") could never match anything. The cell's own type decides.
  it('matches on a type name beginning with a dimension', () => {
    expect(run('contains(Type, "Metal")', { Type: '1100x2400 (2HR) Metal' })).toBe(1);
    expect(run('contains(Type, "Timber")', { Type: '1100x2400 (2HR) Metal' })).toBe(0);
  });

  it('still lets you pull the number out on purpose', () => {
    expect(run('number(Type)', { Type: '1100x2400 Metal' })).toBe(1100);
  });
});

describe('^ and % are gone, and say why', () => {
  // % because it reads as "percent" to nearly everyone who would type it in a schedule:
  // `Area % 10` looks like a tenth of the area and is a remainder. ^ because
  // `Width * Width` says the same thing and lets the unit be worked out.
  it('turns % away with advice, not "unexpected character"', () => {
    expect(() => compile('Area % 10')).toThrow(/percentage calculated value/);
  });

  it('turns ^ away and names the replacement', () => {
    expect(() => compile('Width ^ 2')).toThrow(/Width \* Width/);
  });

  it('still rejects genuinely unknown characters plainly', () => {
    expect(() => compile('Area $ 2')).toThrow(/Unexpected character/);
  });

  it('the replacement carries a unit the old form could not', () => {
    const kinds = new Map([['width', 'length']]);
    expect(dimensionOf('Width * Width', kinds).kind).toBe('area');
  });
});
