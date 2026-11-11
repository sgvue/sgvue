// Audit B9 — how the Schedules engine reads its inputs: a number out of text, a yes/no
// filter value, a definition from outside (`parseScheduleDef`), and a repeated class.
// Written from the brief alone, before the fix. Each test is marked:
//   PIN    — a regression pin: passes today and must pass after the fix.
//   DEFECT — fails today; passes once the fix is in.
import { describe, expect, it } from 'vitest';
import { matchRule, numberOf } from '../../../src/schedule/schedule/compare';
import { emptySchedule, parseScheduleDef, type FilterRule, type Op, type ScheduleDef } from '../../../src/schedule/schedule/def';
import { candidateRows, runSchedule } from '../../../src/schedule/schedule/engine';
import type { Cell } from '../../../src/schedule/ifc/types';
import { buildStore } from './support/fixture';

const text = (v: string): Cell => ({ v });

// ---------------------------------------------------------------------------------------
describe('numberOf reads a number out of text', () => {
  // DEFECT — a leading-dot decimal and an exponent, as the whole text.
  it.each<[string, number]>([
    ['.5', 0.5],
    ['-.5', -0.5],
    [' .75 m', 0.75],
    ['1e3', 1000],
    ['2.5E-3', 0.0025],
    ['-1e2', -100],
  ])('DEFECT: %j → %d', (s, n) => {
    expect(numberOf(text(s))).toBe(n);
  });

  // PIN — the first number in ordinary text, as today.
  it.each<[string, number | null]>([
    ['12.5 m', 12.5],
    ['1,200', 1200],
    ['1,200.5 mm', 1200.5],
    ['-3', -3],
    ['W12', 12],
    ['A.5', 5], // a dot after a letter is not a decimal point
    ['12e', 12],
    ['1e3rd', 1], // not numeric as a whole, so the first number
    ['v1.2.3', 1.2],
    ['abc', null],
    ['', null],
    ['-', null],
  ])('PIN: %j → %s', (s, n) => {
    expect(numberOf(text(s))).toBe(n);
  });

  // PIN — cells that are not text.
  it('PIN: a number cell, boolean cells and no cell', () => {
    expect(numberOf({ v: 7 })).toBe(7);
    expect(numberOf({ v: true })).toBe(1);
    expect(numberOf({ v: false })).toBe(0);
    expect(numberOf(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------
describe('= and != on a boolean cell', () => {
  const field = { kind: 'prop', pset: '*', prop: 'IsExternal' } as const;
  const rule = (op: '=' | '!=', value: FilterRule['value']): FilterRule => ({ field, op, value });
  const T: Cell = { v: true };
  const F: Cell = { v: false };

  // DEFECT — the ✓/✗ style is read as the yes/no it displays.
  it('DEFECT: = ✓ matches a TRUE cell and not a FALSE one', () => {
    expect(matchRule(F, rule('=', '✓'))).toBe(false);
    expect(matchRule(T, rule('=', '✓'))).toBe(true);
  });
  // PIN — passes today (any text that is not a yes-spelling is read as "false", so ✗
  // already lands on the FALSE cells) and must keep passing once ✗ is read as "no".
  it('PIN: = ✗ matches a FALSE cell and not a TRUE one', () => {
    expect(matchRule(T, rule('=', '✗'))).toBe(false);
    expect(matchRule(F, rule('=', '✗'))).toBe(true);
  });

  // DEFECT — a value that names neither yes nor no matches no boolean cell with `=`,
  // and every boolean cell with `!=`.
  it.each(['banana', 'maybe', '2', 'oui'])('DEFECT: = %j matches no boolean cell; != matches both', (s) => {
    expect(matchRule(T, rule('=', s))).toBe(false);
    expect(matchRule(F, rule('=', s))).toBe(false);
    expect(matchRule(T, rule('!=', s))).toBe(true);
    expect(matchRule(F, rule('!=', s))).toBe(true);
  });

  // PIN — the unfilled state of the window's yes/no dropdown reads as it always has (the
  // oracle pins it); only a real value that names neither matches nothing.
  it.each<FilterRule['value']>(['', '   ', undefined])(
    'PIN: an unfilled value %j with = matches FALSE only, != is its negation',
    (v) => {
      expect(matchRule(F, rule('=', v))).toBe(true);
      expect(matchRule(T, rule('=', v))).toBe(false);
      expect(matchRule(F, rule('!=', v))).toBe(false);
      expect(matchRule(T, rule('!=', v))).toBe(true);
    },
  );

  // PIN — the spellings read today.
  it.each<FilterRule['value']>(['Yes', 'yes', 'Y', 'TRUE', 'true', '1', true as unknown as string])(
    'PIN: = %j matches TRUE only, != is its negation',
    (v) => {
      expect(matchRule(T, rule('=', v))).toBe(true);
      expect(matchRule(F, rule('=', v))).toBe(false);
      expect(matchRule(T, rule('!=', v))).toBe(false);
      expect(matchRule(F, rule('!=', v))).toBe(true);
    },
  );
  it.each<FilterRule['value']>(['No', 'no', 'N', 'FALSE', 'false', '0', false as unknown as string])(
    'PIN: = %j matches FALSE only, != is its negation',
    (v) => {
      expect(matchRule(F, rule('=', v))).toBe(true);
      expect(matchRule(T, rule('=', v))).toBe(false);
      expect(matchRule(F, rule('!=', v))).toBe(false);
      expect(matchRule(T, rule('!=', v))).toBe(true);
    },
  );

  // PIN — text and number cells are untouched. Today text equality is trimmed and
  // case-insensitive, so `= abc` matches `ABC` (read off `equalValues`).
  it('PIN: number and text cells compare as today', () => {
    expect(matchRule({ v: 2 }, rule('=', '2'))).toBe(true);
    expect(matchRule({ v: 2 }, rule('=', 2))).toBe(true);
    expect(matchRule({ v: 2 }, rule('!=', '2'))).toBe(false);
    expect(matchRule({ v: 'ABC' }, rule('=', 'abc'))).toBe(true);
    expect(matchRule({ v: 'ABC' }, rule('!=', 'abc'))).toBe(false);
    expect(matchRule({ v: 'ABC' }, rule('=', 'abd'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------
describe('parseScheduleDef cleans what it is given', () => {
  const field = { kind: 'prop', pset: '*', prop: 'Width' };
  const columns = [{ field }];
  const ALL_OPS: Op[] = [
    '=', '!=', '>', '>=', '<', '<=', 'contains', 'startsWith', 'endsWith',
    'hasValue', 'noValue', 'in', 'between',
  ];
  const filter = (op: string, i = 0) =>
    op === 'between' ? { field, op, values: [i, i + 10] }
      : op === 'in' ? { field, op, values: ['a', 'b'] }
        : { field, op, value: String(i) };

  // DEFECT (a)
  it('DEFECT: a class named twice is listed once, first occurrence, order kept', () => {
    const d = parseScheduleDef({ version: 1, entity: ['IfcWall', 'IfcDoor', 'IfcWall'], columns });
    expect(d.entity).toEqual(['IfcWall', 'IfcDoor']);
  });

  // DEFECT (b)
  it('DEFECT: a filter with an unknown operator is dropped, the rest kept in order', () => {
    const d = parseScheduleDef({
      version: 1, columns,
      filters: [filter('=', 1), filter('like', 2), filter('>', 3), filter('DROP TABLE', 4), filter('<', 5)],
    });
    expect(d.filters.map((f) => f.op)).toEqual(['=', '>', '<']);
    expect(d.filters.map((f) => f.value)).toEqual(['1', '3', '5']);
  });
  it('DEFECT: the cap of 8 filters applies after the unknown ones are dropped', () => {
    const known = ALL_OPS.slice(0, 8).map((op, i) => filter(op, i));
    const d = parseScheduleDef({ version: 1, columns, filters: [filter('~', 99), ...known] });
    expect(d.filters.map((f) => f.op)).toEqual(ALL_OPS.slice(0, 8));
  });

  // DEFECT (c)
  it('DEFECT: a colour rule with an unknown operator is dropped, the rest kept in order', () => {
    const d = parseScheduleDef({
      version: 1,
      columns: [{
        field,
        conditional: [
          { op: '>', value: 1, bg: '#ff0000' },
          { op: 'regex', value: '.*', bg: '#00ff00' },
          { op: 'contains', value: 'x', bg: '#0000ff' },
        ],
      }],
    });
    expect(d.columns[0].conditional?.map((r) => r.op)).toEqual(['>', 'contains']);
  });

  // PIN — every known operator is kept (8 + 5, in two definitions).
  it('PIN: every known operator in a filter is kept', () => {
    for (const ops of [ALL_OPS.slice(0, 8), ALL_OPS.slice(8)]) {
      const d = parseScheduleDef({ version: 1, columns, filters: ops.map((op, i) => filter(op, i)) });
      expect(d.filters.map((f) => f.op)).toEqual(ops);
    }
  });
  it('PIN: every known operator in a colour rule is kept', () => {
    const d = parseScheduleDef({
      version: 1, columns: [{ field, conditional: ALL_OPS.map((op) => ({ op, value: 1 })) }],
    });
    expect(d.columns[0].conditional?.map((r) => r.op)).toEqual(ALL_OPS);
  });
  it('PIN: a between filter keeps its values', () => {
    const d = parseScheduleDef({ version: 1, columns, filters: [{ field, op: 'between', values: [0.5, 1.2] }] });
    expect(d.filters[0].values).toEqual([0.5, 1.2]);
  });
  it('PIN: a filter with no field or no op is dropped', () => {
    const d = parseScheduleDef({
      version: 1, columns,
      filters: [{ op: '=', value: '1' }, { field, value: '2' }, { field, op: '=', value: '3' }],
    });
    expect(d.filters).toHaveLength(1);
    expect(d.filters[0].value).toBe('3');
  });
  it('PIN: a single entity string becomes a one-class list', () => {
    expect(parseScheduleDef({ version: 1, entity: 'IfcWall', columns }).entity).toEqual(['IfcWall']);
  });
  it('PIN: version, columns and name behave as today', () => {
    const d = parseScheduleDef({
      version: 1, name: 'Walls', entity: ['IfcWall'],
      columns: [{ field }, { nofield: true }, { field: { kind: 'core', key: 'name' }, heading: 'N' }],
    });
    expect(d.version).toBe(1);
    expect(d.name).toBe('Walls');
    expect(d.columns).toHaveLength(2);
    expect(d.columns[1].heading).toBe('N');
    expect(parseScheduleDef({ version: 1, columns }).name).toBe('Imported Schedule');
    expect(() => parseScheduleDef({ version: 999, columns })).toThrow();
    expect(() => parseScheduleDef({ version: 1, columns: [] })).toThrow();
    expect(() => parseScheduleDef({ columns })).toThrow();
  });
});

// ---------------------------------------------------------------------------------------
describe('the engine never lists an element twice', () => {
  const store = buildStore();
  const def = (entity: string[]): ScheduleDef => ({
    ...emptySchedule('Audit', entity),
    columns: [{ field: { kind: 'core', key: 'name' } }],
  });
  const dataRows = (d: ScheduleDef) =>
    runSchedule(store, d).rows.flatMap((r) => (r.kind === 'data' ? r.rows : []));

  // DEFECT — built directly, not through parseScheduleDef.
  it('DEFECT: a class repeated in entity lists each of its elements once', () => {
    const walls = store.byEntity.get('IfcWall') ?? [];
    expect(walls.length).toBeGreaterThan(0);
    const d = def(['IfcWall', 'IfcWall']);
    expect(candidateRows(store, d)).toEqual(walls);
    expect(runSchedule(store, d).matchedElements).toBe(walls.length);
    expect(dataRows(d).slice().sort((a, b) => a - b)).toEqual(walls);
  });

  // PIN
  it('PIN: two different classes list both, each element once, in store-row order', () => {
    const want = [...(store.byEntity.get('IfcWall') ?? []), ...(store.byEntity.get('IfcDoor') ?? [])]
      .sort((a, b) => a - b);
    const d = def(['IfcDoor', 'IfcWall']);
    expect(candidateRows(store, d)).toEqual(want);
    expect(runSchedule(store, d).matchedElements).toBe(want.length);
    expect(new Set(dataRows(d)).size).toBe(want.length);
  });
});
