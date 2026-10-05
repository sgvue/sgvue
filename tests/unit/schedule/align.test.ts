// Where a column's contents sit.
//
// Reported: "the column format alignment does not work for some". It did not, and the shape
// of the bug was that `left` was unreachable — alignClass() returned early for 'center' and
// 'right', so an explicit 'left' fell through into the numeric default and any column with a
// total or a decimal count stayed right-aligned. The panel said left; the table said right.

import { describe, expect, it } from 'vitest';
import type { Column } from '../../../src/schedule/schedule/def';
import { alignOf } from '../../../src/renderer/schedule-ui/tableView';

const col = (over: Partial<Column> = {}): Column =>
  ({ field: { kind: 'core', key: 'name' }, ...over }) as Column;

describe('an explicit alignment is always honoured', () => {
  it('takes the author’s choice over any default', () => {
    expect(alignOf(col({ align: 'left' }))).toBe('left');
    expect(alignOf(col({ align: 'center' }))).toBe('center');
    expect(alignOf(col({ align: 'right' }))).toBe('right');
  });

  it('honours left even on the columns that used to swallow it', () => {
    // Both of these made alignClass fall through to its right-aligning default.
    expect(alignOf(col({ align: 'left', total: 'sum' }))).toBe('left');
    expect(alignOf(col({ align: 'left', format: { decimals: 2 } }))).toBe('left');
  });

  it('centres a yes/no column when asked, total or not', () => {
    expect(alignOf(col({ align: 'center', total: 'sum' }))).toBe('center');
  });
});

describe('the default only applies when nothing was chosen', () => {
  it('right-aligns anything numeric, as Revit does', () => {
    expect(alignOf(col({ total: 'sum' }))).toBe('right');
    expect(alignOf(col({ format: { decimals: 0 } }))).toBe('right');
  });

  it('leaves everything else alone', () => {
    expect(alignOf(col())).toBe('left');
    expect(alignOf(col({ format: { thousands: true } }))).toBe('left');
  });
});
