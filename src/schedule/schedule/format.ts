// Display side of units: SI base -> whatever unit the column asks for, then number formatting.
//
// The parse side (src/ifc/units.ts) already normalised everything to m, m², m³, rad, kg.
// This is the only place that converts back out, so a project authored in metres can still
// schedule door widths in millimetres.

import type { Cell, UnitKind } from '../ifc/types';
import type { UnitSystem } from '../ifc/units';
import type { UnitFormat } from './def';

/** Display unit -> how many SI base units it represents. */
const UNITS: Record<UnitKind, Record<string, number>> = {
  length: { mm: 1e-3, cm: 1e-2, m: 1, km: 1e3, in: 0.0254, ft: 0.3048 },
  area: { 'mm²': 1e-6, 'cm²': 1e-4, 'm²': 1, 'ft²': 0.09290304, ha: 1e4 },
  volume: { 'mm³': 1e-9, 'cm³': 1e-6, L: 1e-3, 'm³': 1, 'ft³': 0.028316846592 },
  angle: { rad: 1, '°': Math.PI / 180 },
  mass: { g: 1e-3, kg: 1, t: 1e3, lb: 0.45359237 },
  count: {},
  none: {},
};

/** Sensible default display unit per dimension — what a Revit user expects to see. */
const DEFAULT_UNIT: Record<UnitKind, string> = {
  length: 'mm', area: 'm²', volume: 'm³', angle: '°', mass: 'kg', count: '', none: '',
};

/** Default decimal places per dimension, matched to the default unit. */
const DEFAULT_DECIMALS: Record<UnitKind, number> = {
  length: 0, area: 2, volume: 2, angle: 1, mass: 2, count: 0, none: 2,
};

/**
 * The same two tables for a model authored in feet and inches. A foot is coarse where a
 * millimetre is fine, so length gains the two decimals it needs to stay a real dimension.
 * Angles are degrees in both systems.
 */
const IMPERIAL_UNIT: Record<UnitKind, string> = {
  length: 'ft', area: 'ft²', volume: 'ft³', angle: '°', mass: 'lb', count: '', none: '',
};

const IMPERIAL_DECIMALS: Record<UnitKind, number> = {
  length: 2, area: 2, volume: 2, angle: 1, mass: 2, count: 0, none: 2,
};

export function unitOptions(kind: UnitKind): string[] {
  return Object.keys(UNITS[kind] ?? {});
}

export function defaultUnit(kind: UnitKind, system: UnitSystem = 'metric'): string {
  return (system === 'imperial' ? IMPERIAL_UNIT[kind] : DEFAULT_UNIT[kind]) ?? '';
}

export function defaultDecimals(kind: UnitKind, system: UnitSystem = 'metric'): number {
  return (system === 'imperial' ? IMPERIAL_DECIMALS[kind] : DEFAULT_DECIMALS[kind]) ?? 2;
}

/**
 * The range a decimal count may hold, in the file that owns decimals. The Format tab's box
 * carries these as its min/max, the import parser clamps to them, and this module clamps on
 * the way out; when they were separate literals a widened range in one of them would have
 * been a `toFixed` RangeError in the other.
 */
export const DECIMALS_MIN = 0;
export const DECIMALS_MAX = 6;

export function clampDecimals(n: number): number {
  return Math.max(DECIMALS_MIN, Math.min(DECIMALS_MAX, n));
}

/**
 * The fallback below — and `displayFormat`'s — stays METRIC whatever model is open: a column
 * with no `display` of its own is a saved or hand-written schedule, and a saved schedule that
 * silently changed units with the model it is run against would be a different schedule.
 * Every column the app generates carries an explicit unit, imperial ones included.
 */

/** Convert an SI value into the column's display unit. Unknown units pass through. */
export function toDisplay(value: number, kind: UnitKind | undefined, display?: string): number {
  if (!kind || kind === 'none' || kind === 'count') return value;
  const table = UNITS[kind];
  const unit = display || DEFAULT_UNIT[kind];
  const factor = table?.[unit];
  return factor ? value / factor : value;
}

/** Convert a user-entered display value back to SI, so filters compare like with like. */
export function fromDisplay(value: number, kind: UnitKind | undefined, display?: string): number {
  if (!kind || kind === 'none' || kind === 'count') return value;
  const table = UNITS[kind];
  const unit = display || DEFAULT_UNIT[kind];
  const factor = table?.[unit];
  return factor ? value * factor : value;
}

const BOOL_TEXT: Record<NonNullable<UnitFormat['boolStyle']>, [string, string]> = {
  'TRUE/FALSE': ['TRUE', 'FALSE'],
  'Yes/No': ['Yes', 'No'],
  'Y/N': ['Y', 'N'],
  '✓/✗': ['✓', '✗'],
};

/**
 * Which boolean a piece of DISPLAYED text stands for, or null when it stands for neither.
 *
 * Derived from BOOL_TEXT rather than a list of its own, so a fifth style is understood the
 * moment it is added. The plain 'true'/'false' spellings come free from the TRUE/FALSE
 * style under the case-insensitive compare — locked in by a test, since they must keep
 * resolving whatever happens to that style's tokens.
 */
export function boolOfText(s: string): boolean | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  for (const [yes, no] of Object.values(BOOL_TEXT)) {
    if (t === yes.toLowerCase()) return true;
    if (t === no.toLowerCase()) return false;
  }
  return null;
}

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * How many decimals a value is rounded to, and the unit symbol appended after it — empty
 * when the column shows none. One place, so a renderer that reproduces the look elsewhere
 * (the workbook's number format) cannot disagree with the text about either.
 */
export function displayFormat(
  kind: UnitKind | undefined, f: UnitFormat = {},
): { decimals: number; unit: string } {
  const k = kind ?? 'none';
  return {
    decimals: clampDecimals(f.decimals ?? defaultDecimals(k)),
    unit: f.showSymbol ? (f.display || DEFAULT_UNIT[k]) : '',
  };
}

/**
 * The displayed value as a plain fixed string — converted, rounded, negative zero stripped
 * — or null when the cell renders blank. Everything decorative is built on top of this and
 * `displayNumber` is `Number()` of the very same string, so the text and the number are one
 * figure by construction.
 */
function fixedDisplay(value: number, kind: UnitKind | undefined, f: UnitFormat): string | null {
  // An extreme measure in the IFC file can parse to Infinity, and .toFixed() would then
  // print the literal "Infinity" into a schedule. Blank is the honest rendering, and it
  // matches what formula columns already do.
  if (!Number.isFinite(value)) return null;
  const k = kind ?? 'none';
  const converted = toDisplay(value, k, f.display);
  if (!Number.isFinite(converted)) return null;
  if (f.suppressZero && converted === 0) return null;

  const s = converted.toFixed(displayFormat(k, f).decimals);
  // -0.00 reads as a data error; it isn't one.
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

/** Format one number for display: convert, round, group, add symbol and affixes. */
export function formatNumber(value: number, kind: UnitKind | undefined, f: UnitFormat = {}): string {
  const plain = fixedDisplay(value, kind, f);
  if (plain === null) return '';
  let s = plain;

  if (f.thousands !== false) {
    const [i, d] = s.split('.');
    s = d ? `${group(i)}.${d}` : group(i);
  }
  const { unit } = displayFormat(kind, f);
  if (unit) s += ` ${unit}`;
  return (f.prefix ?? '') + s + (f.suffix ?? '');
}

/**
 * The same figure as a NUMBER — what a spreadsheet cell holds so a SUM adds up the figures
 * the reader sees. null wherever `formatNumber` renders blank.
 */
export function displayNumber(
  value: number, kind: UnitKind | undefined, f: UnitFormat = {},
): number | null {
  const plain = fixedDisplay(value, kind, f);
  return plain === null ? null : Number(plain);
}

/** Format any cell for display. This is what collapse-comparison and export both use. */
export function formatCell(cell: Cell | undefined, f: UnitFormat = {}): string {
  if (cell === undefined || cell.v === '' || cell.v === null) return '';
  const v = cell.v;
  if (typeof v === 'boolean') {
    const [t, no] = BOOL_TEXT[f.boolStyle ?? 'Yes/No'];
    return v ? t : no;
  }
  if (typeof v === 'number') return formatNumber(v, cell.k, f);
  const s = String(v);
  return s ? (f.prefix ?? '') + s + (f.suffix ?? '') : '';
}
