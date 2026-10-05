// A ScheduleDef IS the save format. Everything the five Revit tabs configure lives here.
// Keep it JSON-serialisable, human-editable, and forward-lenient on import.

import type { UnitKind } from '../ifc/types';
import { isBodyFont } from './fonts';
// The decimal range lives in the file that owns decimals; this parser clamps to the same
// numbers the Format tab's box does, for the reason spelled out at clampDecimals.
import { DECIMALS_MAX, DECIMALS_MIN } from './format';

/** Core (non-property) fields. Mirrors ElemCore. */
export type CoreKey =
  | 'entity' | 'name' | 'description' | 'mark' | 'typeName' | 'family'
  | 'objectType' | 'predefinedType' | 'guid'
  | 'storey' | 'storeyElevation' | 'building' | 'site' | 'space'
  | 'material' | 'discipline'
  /** SGVue: the federation's source-file key, so a multi-model schedule can say which file. */
  | 'model';

/** Labels shown in the field picker. `mark` is Revit's ElementId in IFC exports, not Mark. */
export const CORE_LABELS: Record<CoreKey, string> = {
  entity: 'IFC Class',
  name: 'Name',
  description: 'Description',
  mark: 'Tag (Revit ID)',
  typeName: 'Type',
  family: 'Family',
  objectType: 'Object Type',
  predefinedType: 'Predefined Type',
  guid: 'GUID',
  storey: 'Level',
  storeyElevation: 'Level Elevation',
  building: 'Building',
  site: 'Site',
  space: 'Room / Space',
  material: 'Material',
  discipline: 'Discipline',
  model: 'Model',
};

export const CORE_KEYS = Object.keys(CORE_LABELS) as CoreKey[];

export type FieldRef =
  | { kind: 'core'; key: CoreKey }
  /** `pset: '*'` resolves per element: SGPset* > Pset_* > alphabetically first. */
  | { kind: 'prop'; pset: string; prop: string }
  | { kind: 'formula'; id: string };

export type Op =
  | '=' | '!=' | '>' | '>=' | '<' | '<='
  | 'contains' | 'startsWith' | 'endsWith'
  | 'hasValue' | 'noValue' | 'in' | 'between';

/**
 * How a boolean may be spelled. ONE list: the type below, the import sanitiser and the
 * Format tab's dropdown all read it, and `format.ts`'s BOOL_TEXT is keyed over the union it
 * produces — so a fifth spelling is a single edit that the compiler then chases.
 * Yes/No first, because that is the default and the order the dropdown offers.
 */
export const BOOL_STYLES = ['Yes/No', 'TRUE/FALSE', 'Y/N', '✓/✗'] as const;

export interface UnitFormat {
  /** Display unit symbol, e.g. 'mm', 'm²', 'ft'. Omitted = SI base. */
  display?: string;
  decimals?: number;
  thousands?: boolean;
  showSymbol?: boolean;
  suppressZero?: boolean;
  prefix?: string;
  suffix?: string;
  /** How TRUE/FALSE renders. */
  boolStyle?: typeof BOOL_STYLES[number];
}

export type TotalKind = 'sum' | 'count' | 'countDistinct' | 'min' | 'max' | 'avg';

export interface CondRule {
  op: Op;
  value?: string | number;
  bg?: string;
  fg?: string;
  bold?: boolean;
}

export interface Column {
  field: FieldRef;
  heading?: string;
  headingOrientation?: 'horizontal' | 'vertical';
  width?: number;
  align?: 'left' | 'center' | 'right';
  format?: UnitFormat;
  total?: TotalKind | null;
  hidden?: boolean;
  conditional?: CondRule[];
}

/**
 * What a calculated value hands back. Not a hint — a contract: a formula that ends up
 * holding some other kind of value renders blank, rather than being coerced into something
 * that reads plausibly and is wrong.
 */
export type CalcResult = 'number' | 'yesNo' | 'text';

export interface Calculated {
  id: string;
  name: string;
  kind: 'formula' | 'percentage';
  unitKind?: UnitKind;
  /**
   * The author's answer to one question — what IS this result? A measurement (with
   * unitKind saying which), a yes or a no, or a text label chosen by if(). Optional and
   * additive: absent means a plain number, so every schedule saved before it existed opens
   * unchanged, and a build that ignores unknown keys still reads a file carrying it.
   */
  result?: CalcResult;
  /**
   * Superseded by `result`. Read, never written: schedules saved in the days when yes/no
   * was its own flag carry it, and resultOf() is the only thing that still looks.
   */
  yesNo?: boolean;
  /** Formula referencing other column headings, e.g. 'Area * 1.15'. Parsed, never eval'd. */
  formula?: string;
  /** Percentage: each row's share of this field's total over the matching rows. */
  ofField?: FieldRef;
}

/**
 * The single place that decides what a calculated value returns — the evaluator, the
 * column type, the unit control and the editor all ask here rather than reading the fields
 * themselves, which is what keeps them from disagreeing.
 *
 * `result` wins when it names a kind this build knows; failing that the legacy flag;
 * failing that a number. That last step is forward-leniency applied to a VALUE rather than
 * a key: a file written by some later build that adds a fourth kind opens here as a plain
 * number instead of being rejected.
 */
export function resultOf(c: Calculated): CalcResult {
  if (c.result === 'number' || c.result === 'yesNo' || c.result === 'text') return c.result;
  return c.yesNo ? 'yesNo' : 'number';
}

export interface FilterRule {
  field: FieldRef;
  op: Op;
  value?: string | number | boolean;
  /** For 'in' and 'between'. */
  values?: (string | number)[];
}

export interface SortLevel {
  field: FieldRef;
  dir: 'asc' | 'desc';
  header?: boolean;
  footer?: 'none' | 'title' | 'count' | 'totals' | 'titleCountTotals';
  blankLine?: boolean;
}

export interface Appearance {
  title?: string;
  showTitle?: boolean;
  gridLines?: boolean;
  outline?: boolean;
  blankRowBeforeData?: boolean;
  zebra?: boolean;
  fontSize?: number;
  headerBold?: boolean;
  /**
   * A key from schedule/fonts.ts. Widened from 'sans' | 'serif' | 'mono' when the picker
   * grew; those three still load and map onto their nearest equivalent, so the save format
   * stays backward-compatible.
   */
  bodyFont?: string;
}

export interface ScheduleDef {
  version: 1;
  name: string;
  /** One or more IFC classes. An array unions them via byEntity. */
  entity: string[];
  columns: Column[];
  calculated?: Calculated[];
  filters: FilterRule[];
  filterLogic?: 'and' | 'or';
  sort: SortLevel[];
  /** false collapses rows identical in every visible column, exposing a Count. */
  itemize: boolean;
  grandTotal: boolean;
  grandTotalTitle?: string;
  appearance?: Appearance;
  meta?: { corpusVersion?: string; notes?: string };
}

export const SCHEDULE_VERSION = 1;
export const MAX_FILTERS = 8;
export const MAX_SORT_LEVELS = 4;

export function emptySchedule(name = 'New Schedule', entity: string[] = []): ScheduleDef {
  return {
    version: SCHEDULE_VERSION,
    name,
    entity,
    columns: [],
    filters: [],
    filterLogic: 'and',
    sort: [],
    itemize: true,
    grandTotal: false,
    appearance: { showTitle: true, gridLines: true, zebra: true, fontSize: 13, headerBold: true },
  };
}

/** Default column heading when the user hasn't overridden it. */
export function defaultHeading(f: FieldRef, def?: ScheduleDef): string {
  switch (f.kind) {
    case 'core': return CORE_LABELS[f.key];
    case 'prop': return f.prop;
    case 'formula': return def?.calculated?.find((c) => c.id === f.id)?.name ?? 'Calculated';
  }
}

export function headingOf(col: Column, def?: ScheduleDef): string {
  return col.heading?.trim() || defaultHeading(col.field, def);
}

/**
 * A field as one string — the Schedules window's control ids, and the column key a colour-by
 * carries over the port. SGVue (2026-09-28): moved here from `schedule-ui/panels/shared.ts`,
 * which re-exports it, so `schedule/colour.ts` can name a column in the main window too.
 */
export function fieldKey(f: FieldRef): string {
  switch (f.kind) {
    case 'core': return `core|${f.key}`;
    case 'prop': return `prop|${f.pset}|${f.prop}`;
    case 'formula': return `formula|${f.id}`;
  }
}

/**
 * Ids only need to be unique inside one schedule. SGVue (2026-10-02): moved here from
 * `schedule-ui/panels/fieldsSection.ts`, which re-exports it — the editor's Add buttons and the
 * assistant's `make_schedule` both name a new calculated value with it.
 */
export function newId(prefix: string, existing: { id: string }[]): string {
  let n = existing.length + 1;
  const taken = new Set(existing.map((e) => e.id));
  while (taken.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

// ---------- import validation ----------

export class ScheduleImportError extends Error {}

// ---- import sanitising ----
// A .schedule.json is a file someone else can send you, so nothing in it is trusted.
// Fields typed `number` here are interpolated into style= and value= attributes, and a
// string in their place would escape the attribute. Colours reach a CSS declaration, where
// HTML-escaping alone would still allow url(...) — which would make the page fetch something.

/** Drop keys whose value is undefined, so import(export(def)) is identical to def. */
function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

function num(v: unknown, min: number, max: number): number | undefined {
  // null is absent, not zero — `Number(null)` is 0, so without this a null decimals came back
  // pinned to 0 and a null width to the minimum, instead of falling back to the default.
  // It is how a non-finite number arrives in a file at all: JSON cannot carry NaN, and
  // `JSON.stringify` writes it as null. Everywhere else in the app `??` already reads null
  // as absent; this is the one reader that did not.
  if (v === null) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, n));
}

/** Only literal colours the colour picker itself can produce. */
function colour(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^#[0-9a-f]{3}$|^#[0-9a-f]{6}$|^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i.test(s)
    ? s : undefined;
}

function text(v: unknown, max = 200): string | undefined {
  return typeof v === 'string' ? v.slice(0, max) : undefined;
}

function cleanFormat(v: unknown): UnitFormat | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const f = v as Record<string, unknown>;
  return compact({
    display: text(f.display, 8),
    decimals: num(f.decimals, DECIMALS_MIN, DECIMALS_MAX),
    thousands: f.thousands === undefined ? undefined : f.thousands !== false,
    showSymbol: f.showSymbol === true ? true : undefined,
    suppressZero: f.suppressZero === true ? true : undefined,
    prefix: text(f.prefix, 16),
    suffix: text(f.suffix, 16),
    boolStyle: BOOL_STYLES.find((s) => s === (f.boolStyle as string)),
  });
}

function cleanColumn(v: unknown): Column | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Record<string, unknown>;
  if (!c.field || typeof c.field !== 'object') return null;
  // Columns referencing removed field kinds (the old 'combined') or removed core keys
  // (typeMark, expressId) drop quietly, so a v1 file from an earlier build still loads
  // what it can.
  const kind = (c.field as { kind?: unknown }).kind;
  if (kind !== 'core' && kind !== 'prop' && kind !== 'formula') return null;
  if (kind === 'core' && !(((c.field as { key?: string }).key ?? '') in CORE_LABELS)) return null;
  const aligns = ['left', 'center', 'right'];
  const totals = ['sum', 'count', 'countDistinct', 'min', 'max', 'avg'];
  const col: Column = compact({
    field: c.field as FieldRef,
    heading: text(c.heading, 120),
    headingOrientation: c.headingOrientation === 'vertical' ? ('vertical' as const) : undefined,
    // Deliberately wider than today's UI range (COL_WIDTH_MIN/MAX in ui/colResize.ts): the
    // loader is lenient, so a save made outside it keeps loading with its width unchanged.
    width: num(c.width, 20, 2000),
    align: aligns.includes(c.align as string) ? (c.align as Column['align']) : undefined,
    format: cleanFormat(c.format),
    total: totals.includes(c.total as string) ? (c.total as TotalKind) : undefined,
    hidden: c.hidden === true ? true : undefined,
    conditional: Array.isArray(c.conditional)
      ? (c.conditional as Record<string, unknown>[])
        .filter((r) => r && typeof r === 'object' && typeof r.op === 'string')
        .map((r) => ({
          op: r.op as Op,
          value: typeof r.value === 'number' ? r.value : text(r.value, 120),
          bg: colour(r.bg),
          fg: colour(r.fg),
          bold: r.bold === true,
        }))
      : undefined,
  });
  return col;
}

function cleanAppearance(v: unknown): Appearance {
  const a = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return {
    title: text(a.title, 200),
    showTitle: a.showTitle !== false,
    gridLines: a.gridLines !== false,
    outline: a.outline !== false,
    blankRowBeforeData: a.blankRowBeforeData === true,
    zebra: a.zebra !== false,
    fontSize: num(a.fontSize, 6, 48) ?? 13,
    headerBold: a.headerBold !== false,
    // An unknown font name (a newer build's, or nonsense in a hand-edited file) falls back
    // rather than throwing — the same forward-lenient rule the rest of this parser follows.
    bodyFont: isBodyFont(a.bodyFont) ? a.bodyFont : 'plex',
  };
}

/**
 * Validates a parsed .schedule.json. Rejects newer versions loudly; ignores unknown
 * keys so a file written by a later build still loads what it can.
 */
export function parseScheduleDef(input: unknown): ScheduleDef {
  if (!input || typeof input !== 'object') throw new ScheduleImportError('Not a schedule file.');
  const o = input as Record<string, unknown>;

  const version = o.version;
  if (typeof version !== 'number') throw new ScheduleImportError('Missing "version" — is this a schedule file?');
  if (version > SCHEDULE_VERSION) {
    throw new ScheduleImportError(
      `This schedule was saved by a newer version of SGVue (v${version}). Update the app to open it.`,
    );
  }
  if (!Array.isArray(o.columns)) throw new ScheduleImportError('Schedule has no columns.');

  const base = emptySchedule(typeof o.name === 'string' ? o.name : 'Imported Schedule');
  const entity = Array.isArray(o.entity)
    ? o.entity.filter((e): e is string => typeof e === 'string')
    : typeof o.entity === 'string' ? [o.entity] : [];

  const columns = (o.columns as unknown[])
    .map(cleanColumn)
    .filter((c): c is Column => c !== null);
  if (!columns.length) throw new ScheduleImportError('Schedule has no usable columns.');

  return {
    ...base,
    version: SCHEDULE_VERSION,
    entity,
    columns,
    calculated: Array.isArray(o.calculated)
      ? (o.calculated as Calculated[]).filter((c) => c?.id && c.kind) : undefined,
    filters: Array.isArray(o.filters)
      ? (o.filters as FilterRule[]).filter((f) => f?.field && f.op).slice(0, MAX_FILTERS) : [],
    filterLogic: o.filterLogic === 'or' ? 'or' : 'and',
    sort: Array.isArray(o.sort)
      ? (o.sort as SortLevel[]).filter((s) => s?.field).slice(0, MAX_SORT_LEVELS) : [],
    itemize: o.itemize !== false,
    grandTotal: o.grandTotal === true,
    grandTotalTitle: text(o.grandTotalTitle, 200),
    appearance: cleanAppearance(o.appearance),
    meta: typeof o.meta === 'object' && o.meta
      ? {
        corpusVersion: text((o.meta as Record<string, unknown>).corpusVersion, 32),
        notes: text((o.meta as Record<string, unknown>).notes, 500),
      }
      : undefined,
  };
}
