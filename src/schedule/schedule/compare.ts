// Filtering and ordering primitives. Pure, no DOM, no store knowledge beyond a Cell.

import type { Cell } from '../ifc/types';
import { defaultHeading, type FilterRule, type Op, type ScheduleDef } from './def';

/** Pull a number out of a cell, tolerating "1,200 mm" style text. */
export function numberOf(cell: Cell | undefined): number | null {
  if (cell === undefined) return null;
  const v = cell.v;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const m = String(v).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
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

/** How a rule reads wherever the app says one — the Filter tab's summary, a template card. */
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
  if (cell === undefined) return false;

  if (op === 'between') {
    const n = numberOf(cell);
    const [lo, hi] = (rule.values ?? []).map(Number);
    if (n === null || !Number.isFinite(lo) || !Number.isFinite(hi)) return false;
    return n >= Math.min(lo, hi) && n <= Math.max(lo, hi);
  }

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

function equalValues(cell: Cell, want: FilterRule['value']): boolean {
  if (typeof cell.v === 'boolean') {
    const s = String(want).trim().toLowerCase();
    const b = s === 'true' || s === 'yes' || s === 'y' || s === '1';
    return cell.v === b;
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
