// Filtering and ordering primitives. Pure, no DOM, no store knowledge beyond a Cell.

import type { Cell } from '../ifc/types';
import { defaultHeading, type FilterRule, type Op, type ScheduleDef } from './def';
import { boolOfText } from './format';

/** The whole text is one decimal number: a sign, a leading-dot form and an exponent allowed. */
const WHOLE_NUMBER = /^[-+]?(\d+(\.\d*)?|\.\d+)(e[-+]?\d+)?$/i;
/**
 * The first number in other text. A decimal may start with its dot only at the start of the
 * text or after whitespace or a sign (" .75 m"), never after a letter or a digit ("A.5" is 5).
 */
const FIRST_NUMBER = /-\.\d+|(?<![^\s+-])\.\d+|-?\d+(?:\.\d+)?/;

/** Pull a number out of a cell, tolerating "1,200 mm" style text. Never NaN or Infinity. */
export function numberOf(cell: Cell | undefined): number | null {
  if (cell === undefined) return null;
  const v = cell.v;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const s = String(v).replace(/,/g, '');
  const whole = s.trim();
  const m = WHOLE_NUMBER.test(whole) ? whole : s.match(FIRST_NUMBER)?.[0];
  if (m === undefined) return null;
  const n = Number(m);
  return Number.isFinite(n) ? n : null;
}

function textOf(cell: Cell | undefined): string {
  if (cell === undefined) return '';
  const v = cell.v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

/** Operators offered for each inferred column type. */
export function opsForType(type: 'text' | 'number' | 'bool' | 'enum'): Op[] {
  const presence: Op[] = ['hasValue', 'noValue'];
  if (type === 'bool') return ['=', '!=', ...presence];
  if (type === 'number') return ['=', '!=', '>', '>=', '<', '<=', 'between', ...presence];
  if (type === 'enum') return ['=', '!=', 'in', ...presence];
  return ['=', '!=', 'contains', 'startsWith', 'endsWith', 'in', ...presence];
}

export const OP_LABELS: Record<Op, string> = {
  '=': 'equals',
  '!=': 'does not equal',
  '>': 'is greater than',
  '>=': 'is greater than or equal to',
  '<': 'is less than',
  '<=': 'is less than or equal to',
  contains: 'contains',
  startsWith: 'begins with',
  endsWith: 'ends with',
  hasValue: 'has a value',
  noValue: 'has no value',
  in: 'is any of',
  between: 'is between',
};

/** How a rule reads wherever the app says one — a filter chip, a template in the Templates library. */
export function ruleText(f: FilterRule, def?: ScheduleDef): string {
  const value = f.value === undefined || f.value === '' ? '' : ` ${f.value}`;
  return `${defaultHeading(f.field, def)} ${OP_LABELS[f.op] ?? f.op}${value}`;
}

/**
 * Test one cell against one rule.
 * Comparison values are given in SI (the filter panel converts on entry), so a
 * "> 900 mm" rule compares against 0.9 without any unit guesswork here.
 */
export function matchRule(cell: Cell | undefined, rule: FilterRule): boolean {
  const { op } = rule;
  if (op === 'hasValue') return cell !== undefined && cell.v !== '';
  if (op === 'noValue') return cell === undefined || cell.v === '';

  // An empty bound is open-ended: only "to" filled is <= hi, only "from" is >= lo, and
  // neither filled leaves the rule switched off (it keeps everything, values or not).
  // (ifcTable, 2026-11-05 — ported for SGVue v1.5.0.)
  if (op === 'between') {
    const lo = boundOf(rule.values?.[0]);
    const hi = boundOf(rule.values?.[1]);
    if (lo === null && hi === null) return true;
    const n = numberOf(cell);
    if (n === null) return false;
    if (lo === null) return n <= hi!;
    if (hi === null) return n >= lo;
    return n >= Math.min(lo, hi) && n <= Math.max(lo, hi);
  }

  if (cell === undefined) return false;

  if (op === 'in') {
    const t = textOf(cell).trim().toLowerCase();
    return (rule.values ?? []).some((v) => String(v).trim().toLowerCase() === t);
  }

  if (op === '>' || op === '>=' || op === '<' || op === '<=') {
    const a = numberOf(cell);
    const b = typeof rule.value === 'number' ? rule.value : numberOf({ v: String(rule.value ?? '') });
    if (a === null || b === null) return false;
    return op === '>' ? a > b : op === '>=' ? a >= b : op === '<' ? a < b : a <= b;
  }

  // Equality on numbers stays numeric so "2" matches 2.
  if (op === '=' || op === '!=') {
    const eq = equalValues(cell, rule.value);
    return op === '=' ? eq : !eq;
  }

  const t = textOf(cell).toLowerCase();
  const q = String(rule.value ?? '').toLowerCase();
  if (op === 'contains') return t.includes(q);
  if (op === 'startsWith') return t.startsWith(q);
  if (op === 'endsWith') return t.endsWith(q);
  return true;
}

/** One end of a `between` range, or null when that box is empty (blank, null, a hole). */
function boundOf(v: string | number | null | undefined): number | null {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function equalValues(cell: Cell, want: FilterRule['value']): boolean {
  if (typeof cell.v === 'boolean') {
    // Every display style the schedule offers (Yes/No, TRUE/FALSE, Y/N, ✓/✗), 1 and 0, or a
    // real boolean. A filled value that names neither equals no boolean cell.
    if (typeof want === 'boolean') return cell.v === want;
    const s = String(want ?? '').trim();
    // Unfilled reads as "false", as before: the yes/no dropdown stores nothing until the user
    // picks, and the totals oracle (tests/unit/schedule/support/oracleEngine.ts) pins that.
    if (s === '') return cell.v === false;
    const b = s === '1' ? true : s === '0' ? false : boolOfText(s);
    return b !== null && cell.v === b;
  }
  if (typeof cell.v === 'number') {
    const n = typeof want === 'number' ? want : numberOf({ v: String(want ?? '') });
    return n !== null && Math.abs(cell.v - n) < 1e-9;
  }
  return String(cell.v).trim().toLowerCase() === String(want ?? '').trim().toLowerCase();
}

/**
 * Order two cells. Numbers compare numerically, text naturally (so "Level 2" precedes
 * "Level 10"), and empty always sorts last regardless of direction.
 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function compareCells(a: Cell | undefined, b: Cell | undefined): number {
  const aEmpty = a === undefined || a.v === '';
  const bEmpty = b === undefined || b.v === '';
  if (aEmpty || bEmpty) return aEmpty && bEmpty ? 0 : aEmpty ? 1 : -1;

  if (typeof a!.v === 'number' && typeof b!.v === 'number') return a!.v - b!.v;
  if (typeof a!.v === 'boolean' && typeof b!.v === 'boolean') return Number(a!.v) - Number(b!.v);
  return collator.compare(textOf(a), textOf(b));
}
