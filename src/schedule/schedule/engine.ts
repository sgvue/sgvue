// The schedule pipeline. Pure functions — no DOM, no globals.
//
//   rows (byEntity) -> filter -> sort -> collapse -> control-break walk -> RenderRow[]
//
// Collapse compares FORMATTED values, so 24.999 and 25.001 merge at 0 decimals.
// That is a deliberate deviation from Revit, chosen for determinism and readability.

import type { ModelStore } from '../ifc/store';
import type { Cell } from '../ifc/types';
import { compareCells, matchRule, numberOf } from './compare';
import { firingRule, litTarget } from './conditional';
import type { Column, ScheduleDef, SortLevel, TotalKind } from './def';
import { headingOf, MAX_SORT_LEVELS } from './def';
import { displayFormat, displayNumber, formatCell, formatNumber } from './format';
import { ANY_PSET, resolveField, type Computed } from './resolve';
import { planComputed, withPercentages, type ComputedPlan } from './computed';

export const RENDER_CAP = 5000;

/**
 * The displayed value of each cell as a number, parallel to `cells` — null where the cell
 * is not a number (text, yes/no, blank, a suppressed zero). Additive: `cells` is still the
 * schedule, and every renderer that does not need numbers ignores this.
 */
export type CellNumbers = (number | null)[];

export interface DataRow {
  kind: 'data';
  /** Source rows this line covers — more than one when itemize is off. */
  rows: number[];
  cells: string[];
  nums?: CellNumbers;
  count: number;
}
export interface GroupRow { kind: 'group'; level: number; label: string; count: number }
export interface FooterRow {
  kind: 'footer'; level: number; label: string; cells: (string | null)[];
  nums?: CellNumbers; count: number;
}
export interface GrandRow {
  kind: 'grand'; label: string; cells: (string | null)[]; nums?: CellNumbers; count: number;
}
interface BlankRow { kind: 'blank'; level: number }

export type RenderRow = DataRow | GroupRow | FooterRow | GrandRow | BlankRow;

export interface ScheduleResult {
  columns: Column[];
  headings: string[];
  rows: RenderRow[];
  /** Data lines produced before the render cap was applied. */
  totalDataRows: number;
  /** Elements matching the filters, before collapsing. */
  matchedElements: number;
  truncated: boolean;
  /**
   * True when rows were collapsed, so every renderer appends the same trailing Count
   * column. Without it a collapsed schedule hides how many elements each line stands for.
   */
  countColumn: boolean;
  /**
   * What each colour rule claims, keyed by def.columns index — present only for VISIBLE
   * columns that carry rules, because a hidden column has no cells here to have coloured.
   * `hits[k]` counts the data lines rule k is the FIRST to claim (firingRule decides, so
   * the number and the paint cannot disagree); `of` is how many data lines there were,
   * before any litBy narrowing. Optional: exports and prints never ask, and nothing
   * outside the rules panel reads it.
   */
  conditionalHits?: Record<number, { hits: number[]; of: number }>;
  /**
   * What a numeric column DISPLAYS, keyed by VISIBLE column index: the decimals it was
   * rounded to and the unit symbol appended after it (empty when the column shows none),
   * both taken from the first numeric cell in that column. A column no numeric cell ever
   * reached has no entry. This is what an exporter needs to make a spreadsheet render the
   * numbers the way the schedule does — the format code itself is the exporter's business,
   * because nothing in here knows what Excel is.
   */
  numeric?: Record<number, { decimals: number; unit: string }>;
}

// NUL never appears in formatted output, so collapse keys cannot collide.
const SEP = '\u0000';

export function visibleColumns(def: ScheduleDef): Column[] {
  return def.columns.filter((c) => !c.hidden);
}

/**
 * Some fields must order by something other than what they display.
 * Sorting levels by name gives L1, L10, L11, L2 — Revit orders them by elevation,
 * so grouping by "Level" shows the level NAME but sorts on its height.
 */
function sortKeys(
  store: ModelStore, row: number, level: SortLevel, computed: Computed | undefined,
): (Cell | undefined)[] {
  const f = level.field;
  if (f.kind === 'core' && f.key === 'storey') {
    return [
      resolveField(store, row, { kind: 'core', key: 'storeyElevation' }, computed),
      resolveField(store, row, f, computed),
    ];
  }
  return [resolveField(store, row, f, computed)];
}

/**
 * Two psets can carry the same property name (Pset_MemberCommon.Reference and
 * Pset_EnvironmentalImpactIndicators.Reference both read "Reference"), which makes a
 * schedule unreadable. Qualify only the headings that actually clash.
 */
export function disambiguate(cols: Column[], headings: string[]): string[] {
  const seen = new Map<string, number>();
  for (const h of headings) seen.set(h, (seen.get(h) ?? 0) + 1);
  return headings.map((h, i) => {
    if ((seen.get(h) ?? 0) < 2) return h;
    const f = cols[i].field;
    // An explicit heading override is the user's business — leave it alone.
    if (cols[i].heading?.trim()) return h;
    return f.kind === 'prop' && f.pset !== ANY_PSET ? `${h} (${f.pset})` : h;
  });
}

/**
 * Every element of the scheduled categories, in store order.
 * Always a COPY: the caller sorts this array in place, and `byEntity` holds the store's
 * only index — sorting it would permanently reorder the model for every later schedule.
 */
export function candidateRows(store: ModelStore, def: ScheduleDef): number[] {
  if (!def.entity.length) return [];
  if (def.entity.length === 1) return (store.byEntity.get(def.entity[0]) ?? []).slice();
  const out: number[] = [];
  for (const e of def.entity) {
    const rows = store.byEntity.get(e);
    if (rows) out.push(...rows);
  }
  return out.sort((a, b) => a - b);
}

/**
 * One footer figure: the text the schedule shows and the same figure as a number. Both come
 * out of one computation, so the workbook's total and the printed total cannot drift apart.
 */
interface Agg { text: string; num: number | null }

function aggregate(
  store: ModelStore, rows: number[], col: Column, kind: TotalKind,
  computedOf: (r: number) => Computed | undefined, format = col.format,
): Agg | null {
  if (kind === 'count') return { text: String(rows.length), num: rows.length };

  const cells = rows.map((r) => resolveField(store, r, col.field, computedOf(r)));
  if (kind === 'countDistinct') {
    const n = new Set(cells.map((c) => formatCell(c, format))).size;
    return { text: String(n), num: n };
  }

  const nums = cells.map(numberOf).filter((n): n is number => n !== null);
  if (!nums.length) return null;
  const unit = cells.find((c) => c?.k)?.k;
  // reduce, not Math.min(...nums) — spreading tens of thousands of arguments throws
  // RangeError, and totals run over the full row set, not the capped render.
  const value = kind === 'sum' ? nums.reduce((a, b) => a + b, 0)
    : kind === 'min' ? nums.reduce((a, b) => (b < a ? b : a))
      : kind === 'max' ? nums.reduce((a, b) => (b > a ? b : a))
        : nums.reduce((a, b) => a + b, 0) / nums.length;
  return { text: formatNumber(value, unit, format), num: displayNumber(value, unit, format) };
}

export interface RunOptions {
  plan?: ComputedPlan;
  /** Max data lines to emit. Exports pass Infinity — the cap is a display concession only. */
  cap?: number;
  /**
   * Drop thousands separators. A spreadsheet reads "1,200" as text, so an exported
   * schedule would not be summable; Excel applies its own grouping on display anyway.
   */
  plainNumbers?: boolean;
  /**
   * Show what ONE rule removes: the index of a filter rule to invert. Rows are returned
   * that this rule rejects and every other rule would have admitted — which is exactly
   * the set the user loses by having written it.
   */
  invertRule?: number;
  /**
   * The same idea for a colour rule: show what ONE rule COLOURS. Names a column by its
   * def.columns index and a rule by its index in that column, and keeps only the data
   * lines that rule claims — so the groups, footers, totals and cap below all describe
   * the narrowed set. A target that names no live rule is ignored.
   */
  litBy?: { col: number; rule: number };
}

/** Run a schedule definition against a model. */
export function runSchedule(
  store: ModelStore,
  def: ScheduleDef,
  opts: RunOptions = {},
): ScheduleResult {
  const { plan, cap = RENDER_CAP, plainNumbers = false, invertRule, litBy } = opts;
  const cols = visibleColumns(def);
  const headings = disambiguate(cols, cols.map((c) => headingOf(c, def)));
  // One format per visible column, built once: under plainNumbers the thousands separators
  // go, because a spreadsheet reads "1,200" as text.
  const fmts = cols.map((c) => (plainNumbers ? { ...c.format, thousands: false } : c.format));

  // Formula values depend on other columns, so compute them once per row.
  let calc: ComputedPlan = plan ?? planComputed(def);
  let cache = new Map<number, Computed>();
  const computedOf = (r: number): Computed | undefined => {
    let hit = cache.get(r);
    if (!hit) { hit = calc.compute(store, r); cache.set(r, hit); }
    return hit;
  };

  // ---- filter ----
  const logic = def.filterLogic ?? 'and';
  const decide = (hits: boolean[]) => (logic === 'or' ? hits.some(Boolean) : hits.every(Boolean));
  const inv = invertRule !== undefined && invertRule >= 0 && invertRule < def.filters.length
    ? invertRule : undefined;

  let rows = candidateRows(store, def);
  if (def.filters.length) {
    rows = rows.filter((r) => {
      const hits = def.filters.map((f) => matchRule(resolveField(store, r, f.field, computedOf(r)), f));
      if (inv === undefined) return decide(hits);
      // Under AND the others must all admit the row for this rule to be what loses it;
      // under OR they must all reject it, or the row is in regardless.
      const others = hits.filter((_, i) => i !== inv);
      const mine = logic === 'or' ? !others.some(Boolean) : others.every(Boolean);
      return mine && !hits[inv];
    });
  }
  const matchedElements = rows.length;

  // Percentages divide by a total over the matching rows, so they can only be known now.
  // A filter therefore cannot test a percentage column — the same limitation Revit has.
  const withPct = withPercentages(calc, store, def, rows);
  if (withPct !== calc) { calc = withPct; cache = new Map(); }

  // ---- sort ----
  const levels = def.sort.slice(0, MAX_SORT_LEVELS);
  if (levels.length) {
    const keys = new Map<number, (Cell | undefined)[][]>();
    for (const r of rows) keys.set(r, levels.map((l) => sortKeys(store, r, l, computedOf(r))));
    rows.sort((a, b) => {
      const ka = keys.get(a)!, kb = keys.get(b)!;
      for (let i = 0; i < levels.length; i++) {
        for (let j = 0; j < ka[i].length; j++) {
          const c = compareCells(ka[i][j], kb[i][j]);
          if (c !== 0) return levels[i].dir === 'desc' ? -c : c;
        }
      }
      return a - b;
    });
  }

  // ---- format every visible cell once; collapse works on these strings ----
  // The number beside each string is the SAME figure, rounded and converted exactly as the
  // text was, so an exporter can hand a spreadsheet a number without it disagreeing with
  // what the schedule reads. `numeric` remembers how the column displays them.
  const formatted = new Map<number, string[]>();
  const numbers = new Map<number, CellNumbers>();
  const numeric: NonNullable<ScheduleResult['numeric']> = {};
  for (const r of rows) {
    const resolved = cols.map((c) => resolveField(store, r, c.field, computedOf(r)));
    formatted.set(r, resolved.map((cell, i) => formatCell(cell, fmts[i])));
    numbers.set(r, resolved.map((cell, i) => {
      if (typeof cell?.v !== 'number') return null;
      if (!(i in numeric)) numeric[i] = displayFormat(cell.k, fmts[i]);
      return displayNumber(cell.v, cell.k, fmts[i]);
    }));
  }

  // ---- collapse ----
  // Key includes the sort-level values as well as the visible cells, so grouping by Level
  // keeps otherwise-identical doors on different levels apart.
  let lines: DataRow[];
  if (def.itemize) {
    lines = rows.map((r) => ({
      kind: 'data', rows: [r], cells: formatted.get(r)!, nums: numbers.get(r)!, count: 1,
    }));
  } else {
    const groups = new Map<string, DataRow>();
    for (const r of rows) {
      const cells = formatted.get(r)!;
      const sortPart = levels
        .map((l) => formatCell(resolveField(store, r, l.field, computedOf(r))))
        .join(SEP);
      const key = cells.join(SEP) + SEP + SEP + sortPart;
      const hit = groups.get(key);
      if (hit) { hit.rows.push(r); hit.count++; }
      // The members' cells are identical — that is what merged them — so the first
      // member's numbers are the line's numbers.
      else groups.set(key, { kind: 'data', rows: [r], cells, nums: numbers.get(r)!, count: 1 });
    }
    lines = [...groups.values()];
  }

  // ---- what each colour rule claims, then the one-rule preview ----
  // Counted over the UN-narrowed lines, so "Colours 12 of 400" keeps saying 400 while the
  // 12 are being looked at. One pass per column that has rules, not one per rule: each
  // line is attributed to the first rule that claims it, which is the same first-match
  // rule the table paints by.
  let conditionalHits: ScheduleResult['conditionalHits'];
  def.columns.forEach((c, di) => {
    const n = c.conditional?.length ?? 0;
    const vi = cols.indexOf(c);
    if (!n || vi < 0) return;
    const hits = new Array<number>(n).fill(0);
    for (const line of lines) {
      const k = firingRule(c, line.cells[vi]);
      if (k >= 0) hits[k]++;
    }
    (conditionalHits ??= {})[di] = { hits, of: lines.length };
  });

  const lit = litTarget(def, litBy);
  if (lit) {
    const vi = cols.indexOf(lit.col);
    lines = lines.filter((l) => firingRule(lit.col, l.cells[vi]) === litBy!.rule);
  }

  // ---- control-break walk ----
  const out: RenderRow[] = [];
  const active = levels.filter((l) => l.header || (l.footer && l.footer !== 'none') || l.blankLine);
  let truncated = false;
  let emittedData = 0;

  const labelAt = (line: DataRow, level: SortLevel) =>
    formatCell(resolveField(store, line.rows[0], level.field, computedOf(line.rows[0]))) || '(none)';

  const keyAt = (line: DataRow, i: number) => labelAt(line, levels[i]);

  const footerFor = (level: SortLevel, i: number, members: DataRow[]) => {
    const style = level.footer ?? 'none';
    if (style === 'none') return;
    const rowsIn = members.flatMap((m) => m.rows);
    const wantTotals = style === 'totals' || style === 'titleCountTotals';
    const wantTitle = style === 'title' || style === 'titleCountTotals';
    const wantCount = style === 'count' || style === 'titleCountTotals';
    const label = [wantTitle ? `${keyAt(members[0], i)}` : '', wantCount ? `${rowsIn.length}` : '']
      .filter(Boolean).join(': ');
    const totals = cols.map((c, ci) => (wantTotals && c.total
      ? aggregate(store, rowsIn, c, c.total, computedOf, fmts[ci]) : null));
    out.push({
      kind: 'footer',
      level: i,
      label: label || 'Total',
      count: rowsIn.length,
      cells: totals.map((t) => t?.text ?? null),
      nums: totals.map((t) => t?.num ?? null),
    });
  };

  // Track where each level's current group started so footers can aggregate its members.
  const groupStart: number[] = levels.map(() => 0);

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const prev = idx > 0 ? lines[idx - 1] : null;

    let changedFrom = prev === null ? 0 : levels.length;
    if (prev) {
      for (let i = 0; i < levels.length; i++) {
        if (keyAt(line, i) !== keyAt(prev, i)) { changedFrom = i; break; }
      }
    }

    if (changedFrom < levels.length) {
      // close deepest first
      if (prev) {
        for (let i = levels.length - 1; i >= changedFrom; i--) {
          const lv = levels[i];
          if (!active.includes(lv)) continue;
          footerFor(lv, i, lines.slice(groupStart[i], idx));
          if (lv.blankLine) out.push({ kind: 'blank', level: i });
        }
      }
      for (let i = changedFrom; i < levels.length; i++) {
        groupStart[i] = idx;
        const lv = levels[i];
        if (lv.header) {
          const members = memberCount(lines, idx, levels, i, keyAt);
          out.push({ kind: 'group', level: i, label: keyAt(line, i), count: members });
        }
      }
    }

    if (emittedData < cap) { out.push(line); emittedData++; }
    else truncated = true;
  }

  if (lines.length) {
    for (let i = levels.length - 1; i >= 0; i--) {
      const lv = levels[i];
      if (!active.includes(lv)) continue;
      footerFor(lv, i, lines.slice(groupStart[i]));
      if (lv.blankLine) out.push({ kind: 'blank', level: i });
    }
  }

  if (def.grandTotal) {
    const all = lines.flatMap((l) => l.rows);
    const totals = cols.map((c, ci) => (c.total
      ? aggregate(store, all, c, c.total, computedOf, fmts[ci]) : null));
    out.push({
      kind: 'grand',
      label: def.grandTotalTitle?.trim() || 'Grand total',
      count: all.length,
      cells: totals.map((t) => t?.text ?? null),
      nums: totals.map((t) => t?.num ?? null),
    });
  }

  return {
    columns: cols, headings, rows: out,
    totalDataRows: lines.length, matchedElements, truncated,
    countColumn: !def.itemize && cols.length > 0,
    conditionalHits,
    numeric: Object.keys(numeric).length ? numeric : undefined,
  };
}

/** How many data lines share this line's key at `level` — shown in group headers. */
function memberCount(
  lines: DataRow[], from: number, levels: SortLevel[], level: number,
  keyAt: (l: DataRow, i: number) => string,
): number {
  let n = 0;
  const want = levels.slice(0, level + 1).map((_, i) => keyAt(lines[from], i));
  for (let i = from; i < lines.length; i++) {
    if (want.some((w, j) => keyAt(lines[i], j) !== w)) break;
    n += lines[i].count;
  }
  return n;
}
