// A colour rule on a Yes/No column died the moment the column was switched to ✓/✗.
//
// Reported, and correct: same value, different formatting. Conditional rules are evaluated
// on the DISPLAYED text — that is what makes "contains 2400" work on a formatted number —
// so a rule authored as "= Yes" was comparing "Yes" against the string "✓" and never fired
// again. Equality on a boolean now compares MEANING; every other operator still reads the
// text, and matchRule is untouched because the filter engine shares it.

import { describe, expect, it } from 'vitest';
import type { Column, CondRule } from '../../../src/schedule/schedule/def';
import { boolOfText } from '../../../src/schedule/schedule/format';
import { cellStyle } from '../../../src/renderer/schedule-ui/tableView';

const col = (op: CondRule['op'], value: string): Column =>
  ({ field: { kind: 'core', key: 'name' }, conditional: [{ op, value, bg: '#fff3cd' }] }) as Column;

/** Did the rule colour the cell? */
const fires = (op: CondRule['op'], value: string, text: string) => cellStyle(col(op, value), text) !== '';

describe('boolOfText reads a displayed boolean back', () => {
  it('understands every style the app can draw', () => {
    for (const yes of ['Yes', 'TRUE', 'Y', '✓']) expect(boolOfText(yes), yes).toBe(true);
    for (const no of ['No', 'FALSE', 'N', '✗']) expect(boolOfText(no), no).toBe(false);
  });

  it('ignores case and surrounding space', () => {
    expect(boolOfText('  yEs ')).toBe(true);
    expect(boolOfText(' n')).toBe(false);
  });

  it('resolves the plain spellings, whatever the TRUE/FALSE style is called', () => {
    expect(boolOfText('true')).toBe(true);
    expect(boolOfText('false')).toBe(false);
  });

  it('says null for anything that is not one of the tokens', () => {
    for (const s of ['', '   ', 'Yesish', '1', '0', 'Door', 'YN']) expect(boolOfText(s), s).toBe(null);
  });
});

describe('a colour rule survives a change of Yes/No style', () => {
  it('matches by meaning, whichever style each side is written in', () => {
    expect(fires('=', 'Yes', '✓')).toBe(true);
    expect(fires('=', 'Y', 'TRUE')).toBe(true);
    expect(fires('=', '✗', 'No')).toBe(true);
    expect(fires('=', 'Yes', '✗')).toBe(false);
  });

  it('still matches the plain case it always did', () => {
    expect(fires('=', 'Yes', 'Yes')).toBe(true);
    expect(fires('=', 'No', 'Yes')).toBe(false);
  });

  it('mirrors for does-not-equal', () => {
    expect(fires('!=', 'Yes', '✗')).toBe(true);
    expect(fires('!=', 'Yes', '✓')).toBe(false);
  });
});

describe('nothing else changes', () => {
  it('leaves every other operator on the displayed text', () => {
    // `contains` is a question about the characters on screen, so "Yes" does not find "✓".
    expect(fires('contains', 'Yes', '✓')).toBe(false);
    expect(fires('contains', 'Ye', 'Yes')).toBe(true);
  });

  it('falls through to the text compare when either side is not a boolean', () => {
    expect(fires('=', 'Yes', 'Door')).toBe(false);
    expect(fires('=', 'Door', 'Door')).toBe(true);
  });

  it('never colours an empty cell, which is not a No', () => {
    expect(cellStyle(col('=', 'No'), '')).toBe('');
    expect(cellStyle(col('!=', 'Yes'), '')).toBe('');
  });
});
