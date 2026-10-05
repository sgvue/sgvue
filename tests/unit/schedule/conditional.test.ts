// One evaluator decides which colour rule claims a cell. The table paints by it, the rules
// panel counts by it and the engine narrows by it, so anything that is true here is true in
// all three — and anything wrong here is wrong in all three at once.

import { describe, expect, it } from 'vitest';
import { firingRule, litTarget } from '../../../src/schedule/schedule/conditional';
import { emptySchedule, type Column, type CondRule, type ScheduleDef } from '../../../src/schedule/schedule/def';

const col = (...rules: CondRule[]): Column =>
  ({ field: { kind: 'core', key: 'name' }, conditional: rules }) as Column;

const rule = (op: CondRule['op'], value = ''): CondRule => ({ op, value, bg: '#fff3cd' });

describe('a blank cell is claimed only by "has no value"', () => {
  it('is claimed by noValue', () => {
    expect(firingRule(col(rule('noValue')), '')).toBe(0);
  });

  it('is claimed by nothing else, however emptily the rule was written', () => {
    // Both of these are TRUE of the empty string under matchRule — `'' = ''` and
    // `''.includes('')` — so a rule whose value box was left blank would otherwise paint
    // every empty cell in the column the moment it was added.
    expect(firingRule(col(rule('=', '')), '')).toBe(-1);
    expect(firingRule(col(rule('contains', '')), '')).toBe(-1);
    expect(firingRule(col(rule('hasValue')), '')).toBe(-1);
    expect(firingRule(col(rule('!=', 'Door')), '')).toBe(-1);
  });

  it('lets noValue claim it from behind a rule that skipped it', () => {
    expect(firingRule(col(rule('contains', ''), rule('noValue')), '')).toBe(1);
  });
});

describe('presence on a cell that has one', () => {
  it('hasValue claims any non-blank text', () => {
    expect(firingRule(col(rule('hasValue')), 'Door')).toBe(0);
    expect(firingRule(col(rule('hasValue')), '0')).toBe(0);
  });

  it('noValue claims nothing that has one', () => {
    expect(firingRule(col(rule('noValue')), 'Door')).toBe(-1);
  });
});

describe('the first match wins', () => {
  const two = col(rule('contains', 'oo'), rule('=', 'Door'));

  it('returns the earlier rule when both would fire', () => {
    expect(firingRule(two, 'Door')).toBe(0);
  });

  it('falls through to the later one when the first does not fire', () => {
    expect(firingRule(col(rule('contains', 'zz'), rule('=', 'Door')), 'Door')).toBe(1);
  });

  it('claims the cell even for a rule carrying no colour at all', () => {
    // The paint, the count and the narrowing agree only because claiming is decided here
    // and painting later: a colourless rule still shadows the ones below it.
    const c = col({ op: 'contains', value: 'oo' }, rule('=', 'Door'));
    expect(firingRule(c, 'Door')).toBe(0);
  });

  it('returns -1 for a column with no rules', () => {
    expect(firingRule({ field: { kind: 'core', key: 'name' } } as Column, 'Door')).toBe(-1);
  });
});

describe('a boolean still matches by meaning through it', () => {
  // The 2026-08-18 amendment, unchanged: a Yes/No column redrawn as ✓/✗ holds the same
  // value, so "= Yes" has to keep claiming it.
  it('reads = and != as the boolean, whichever style each side is written in', () => {
    expect(firingRule(col(rule('=', 'Yes')), '✓')).toBe(0);
    expect(firingRule(col(rule('=', 'Yes')), '✗')).toBe(-1);
    expect(firingRule(col(rule('!=', 'Yes')), '✗')).toBe(0);
  });

  it('leaves every other operator on the displayed text', () => {
    expect(firingRule(col(rule('contains', 'Yes')), '✓')).toBe(-1);
  });
});

describe('litTarget refuses a preview that points at nothing', () => {
  const def = (cols: Column[]): ScheduleDef => ({ ...emptySchedule('S', ['IfcDoor']), columns: cols });
  const lit = col(rule('=', 'A'));

  it('resolves a live target', () => {
    const d = def([lit]);
    expect(litTarget(d, { col: 0, rule: 0 })).toEqual({ col: lit, rule: lit.conditional![0] });
  });

  it('says null for a column that is not there', () => {
    expect(litTarget(def([lit]), { col: 3, rule: 0 })).toBe(null);
  });

  it('says null for a hidden column — it has no cells to have coloured', () => {
    const hidden = { ...lit, hidden: true };
    expect(litTarget(def([hidden]), { col: 0, rule: 0 })).toBe(null);
  });

  it('says null for a rule index past the end', () => {
    expect(litTarget(def([lit]), { col: 0, rule: 1 })).toBe(null);
  });

  it('says null for no preview at all', () => {
    expect(litTarget(def([lit]), null)).toBe(null);
    expect(litTarget(def([lit]), undefined)).toBe(null);
  });
});
