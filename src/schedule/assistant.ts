/**
 * The assistant's side of the Schedules window — 2026-09-28. The owner: *"wire the schedules
 * with the AI"*, first two abilities: build a schedule from chat, and see the one that is open.
 *
 * Pure, like the rest of `src/schedule/`: no DOM, no port, no store. The main window's
 * `executors/schedule.ts` hands it the store `schedule-link.ts` builds from the federation (the
 * adapter's own snapshot, indexed by ifcTable's own `StoreBuilder`) and the def the Schedules
 * window last reported, and this file does the three things the tools need:
 *
 *   · `buildSchedule` turns `make_schedule`'s simplified input — a category, columns by field
 *     name, filters, sort, group, totals — into a `ScheduleDef`, new or on top of the open one.
 *     Field names are the Schedules window's own fields (by label, key, or SGVue's attribute
 *     name) and the file's property names, through the **same** resolver the rule grammar uses
 *     (`shared/prop-names.ts`): exact, or the one key equal but for case and punctuation; two
 *     alike are never chosen between; anything else refuses the whole call with the nearest
 *     names. The result goes through `parseScheduleDef` before anyone sends it.
 *   · `readSchedule` runs the ported engine over a def and reports it as the table shows it:
 *     headings, a page of rows as displayed text, every group's subtotals, the grand totals,
 *     and the counts that answer "why is this empty?" — bounded, and `truncated` when cut.
 *   · `scheduleBrief` is the one-line summary the view state carries every turn — pure over the
 *     def and the row count the Schedules window reported, so a chat turn never builds a store or
 *     runs the engine.
 *
 * 2026-10-02 — parity with the user, phase 4 (the owner: *"assistant should possess everything
 * user can do on the app"*). `buildSchedule` also takes what the window's filter, sort and column
 * controls (the Filter, Sorting and Format tabs until v1.5.0; its view-bar chips and column menus
 * since) and its calculated-value editor set — filter logic, itemise, a column's hidden,
 * decimals, unit, alignment and place, and calculated columns — each by the control's own rule
 * (`kindOf`, `typeOf`, `unitOptions`, `calcProblems`: the engine's, which the controls call too), and
 * `simplify` reads every one of them back. And `scheduleElementIds` is the schedule's rows as a
 * set of elements, for the view tools' `schedule:true` target.
 *
 * 2026-11-25 — five more things the window sets: the Style popover (`style`), a sort or group
 * level's heading row, footer and blank line (`groupFormat`), the grand-total row's label, a
 * column's colour rules, and its width, heading direction, number format, yes / no spelling and
 * distinct count. Each within the window control's own range or list, else the call is refused.
 */
import type { ScheduleBrief } from '../shared/ai-schema'
import { ATTR_KEYS } from '../shared/attr'
import {
  CALC_NOTE_CHARS,
  NOT_A_COLOUR,
  SCHEDULE_AFFIX_CHARS,
  SCHEDULE_COLOUR_RULES_MAX,
  SCHEDULE_COLOUR_VALUE_CHARS,
  SCHEDULE_FOOTER_ENUM,
  SCHEDULE_FORMULA_CHARS,
  SCHEDULE_GRAND_TOTAL_TITLE_CHARS,
  SCHEDULE_HEX_COLOUR
} from '../shared/tool-schemas'
import { ambiguousText, nearestKeys, normKey, resolveKey } from '../shared/prop-names'
import { keysForEntity, type ModelStore } from './ifc/store'
import type { PropStat, UnitKind } from './ifc/types'
import { alignForCalc, columnForCore, columnForProp, kindOf, kindsByHeading, typeOf } from './schedule/columns'
import { matchRule, OP_LABELS, opsForType, ruleText } from './schedule/compare'
import { bracketProblem, calcCalled, calcNameClash, clearOfCalcNames, HEADING_TAKEN } from './schedule/calcNames'
import { calcProblems, planComputed } from './schedule/computed'
import {
  BOOL_STYLES,
  CORE_KEYS,
  CORE_LABELS,
  MAX_SORT_LEVELS,
  emptySchedule,
  fieldKey,
  headingOf,
  newId,
  parseScheduleDef,
  resultOf,
  type Appearance,
  type Calculated,
  type Column,
  type CondRule,
  type CoreKey,
  type FieldRef,
  type FilterRule,
  type Op,
  type ScheduleDef,
  type SortLevel
} from './schedule/def'
import { candidateRows, disambiguate, runSchedule, visibleColumns } from './schedule/engine'
import { BODY_FONTS, normaliseFont } from './schedule/fonts'
import { defaultUnit, unitOptions } from './schedule/format'
import { dimensionOf } from './schedule/formula'
import { ANY_PSET, resolveField } from './schedule/resolve'
import { COL_WIDTH_MAX, COL_WIDTH_MIN, TEXT_SIZE_SLIDER_MAX, TEXT_SIZE_SLIDER_MIN } from './schedule/limits'
import { MAX_DEF_CALCULATED, MAX_DEF_COLUMNS } from './messages'

/* ────────────────────────────── bounds ────────────────────────────── */

/** Columns one `make_schedule` call may name. */
export const SCHEDULE_COLUMN_CAP = 40
/** IFC classes one schedule may union. */
export const SCHEDULE_CATEGORY_CAP = 12
/** Values an `in` / `between` filter may list. */
export const SCHEDULE_VALUES_CAP = 50
/** Rows `get_schedule` returns when not asked for a number, and the most it ever returns. */
export const SCHEDULE_ROWS_DEFAULT = 20
export const SCHEDULE_ROWS_CAP = 50
/** Group subtotals one result lists. */
export const SCHEDULE_GROUPS_CAP = 50
/** Characters of one cell or heading as the model reads it. */
export const CELL_CHARS = 120
/**
 * Characters the rows and the groups of one result may take together. A page is at most 50
 * rows, but a user's schedule may carry up to `MAX_DEF_COLUMNS` columns: this keeps any result
 * well inside `AI_JSON_MAX_CHARS` (1 000 000), and `truncated` says so when it bites.
 */
export const READ_BUDGET = 300_000
/** Names offered for a field that is not one. */
export const FIELD_NEAREST_CAP = 8

/** The totals `make_schedule` offers; `none` takes a total away, `count_distinct` is `countDistinct`. */
export const SCHEDULE_TOTALS = ['sum', 'count', 'count_distinct', 'min', 'max', 'avg', 'none'] as const
/** The engine's own thirteen operators. */
export const SCHEDULE_OPS = Object.keys(OP_LABELS) as Op[]

/*
 * 2026-10-02 — parity with the user, phase 4: what the Schedules window's filter, sort and
 * column-format controls (since v1.5.0 its view-bar chips and column menus) and the
 * calculated-value editor set, and `make_schedule` could only keep.
 */

/** A column menu's three alignments. */
export const SCHEDULE_ALIGNS = ['left', 'center', 'right'] as const
/**
 * What a calculated value's result is — the editor's own "Result is a" list: a plain number, a
 * yes or a no, a text label, or a measure, which the column then converts and unit-labels like
 * any other. The catalogue spells the same list (`shared/tool-schemas.ts`); a test holds them equal.
 */
export const SCHEDULE_RESULTS = ['number', 'yes_no', 'text', 'length', 'area', 'volume', 'mass', 'angle'] as const
export type ScheduleResultKind = (typeof SCHEDULE_RESULTS)[number]
/** Calculated values one call may define — and the most `get_schedule` lists. */
export const SCHEDULE_CALC_CAP = 20
/** A formula as one call may send it. The port takes 4 000 (`messages.ts`, `DefShape`). Since
 *  v1.5.0 the tool's own description states it, so it lives beside that description. */
export { SCHEDULE_FORMULA_CHARS } from '../shared/tool-schemas'

/* ────────────────────────────── the input ────────────────────────────── */

export interface AskColumn {
  field: string
  heading?: string
  total?: (typeof SCHEDULE_TOTALS)[number]
  /** A column menu's "Hide column". Omitted, a column that is asked for is shown. */
  hidden?: boolean
  /** Decimal places, 0–6: a numeric column only. */
  decimals?: number
  /** The display unit — one of the units the column's own measure has. */
  unit?: string
  align?: (typeof SCHEDULE_ALIGNS)[number]
  /** The heading or field of the column this one goes directly after; `""` puts it first. */
  after?: string
  /** 2026-11-25 — the column menu's More fold: px, `COL_WIDTH_MIN`–`COL_WIDTH_MAX`. */
  width?: number
  verticalHeading?: boolean
  /** A numeric column's switches: `thousands`, `hideZero` (suppressZero), `showUnit` (showSymbol). */
  thousands?: boolean
  hideZero?: boolean
  showUnit?: boolean
  /** Text either side of each value, at most `SCHEDULE_AFFIX_CHARS`; `""` clears. */
  prefix?: string
  suffix?: string
  /** A yes / no column's spelling. */
  yesNoStyle?: (typeof BOOL_STYLES)[number]
  /** Given replaces the column's colour rules, `[]` clears them, absent keeps them. */
  colourRules?: AskColourRule[]
}
/** One colour rule, as `make_schedule` names it: `background` is `bg`, `text` is `fg`. */
export interface AskColourRule {
  op: Op
  value?: string | number
  background?: string
  text?: string
  bold?: boolean
}
export type ScheduleFooterName = (typeof SCHEDULE_FOOTER_ENUM)[number]
/** One sort or group level's heading row, footer and blank line, by its field. */
export interface AskGroupFormat {
  field: string
  header?: boolean
  footer?: ScheduleFooterName
  blankLine?: boolean
}
/** The Style popover, under the names `make_schedule` takes. Only the keys given change. */
export interface AskStyle {
  showTitle?: boolean
  gridLines?: boolean
  stripes?: boolean
  textSize?: number
  font?: string
  outline?: boolean
  boldHeader?: boolean
  blankRowBeforeData?: boolean
}
/** One calculated value: a formula over the other columns' headings, or a share of a total. */
export interface AskCalculated {
  name: string
  formula?: string
  percentageOf?: string
  result?: ScheduleResultKind
  /** For the user: one plain sentence saying what the column works out (2026-11-24). */
  note?: string
}
export interface AskFilter {
  field: string
  op: Op
  value?: string | number | boolean
  values?: (string | number)[]
}
export interface AskSort {
  field: string
  descending?: boolean
}
export interface AskSchedule {
  base?: 'new' | 'open'
  title?: string
  category?: string[]
  columns?: AskColumn[]
  removeColumns?: string[]
  /** Columns worked out per row. Each is defined — or, by name, redefined — and shown. */
  calculated?: AskCalculated[]
  filters?: AskFilter[]
  /** The filter popover's "All rules" / "Any rule". */
  filterLogic?: 'and' | 'or'
  sortBy?: AskSort[]
  groupBy?: string[]
  /** The Rows popover's "Itemise every instance"; off, identical rows collapse into one with a count. */
  itemize?: boolean
  /** How itemise off combines: 'sort' is one row per sort value (Revit's way); 'identical' the default. */
  combine?: 'identical' | 'sort'
  grandTotals?: boolean
  /** The grand-total row's label; `""` clears it. */
  grandTotalTitle?: string
  /** Applied after `sortBy` / `groupBy`, to the level with that field. */
  groupFormat?: AskGroupFormat[]
  style?: AskStyle
}

/** What the field names are resolved against. */
export interface FieldWorld {
  store: ModelStore
  /** The federation's property names (`ShellState.propKeys`). */
  propKeys: readonly string[]
}

/* ────────────────────────────── field names ────────────────────────────── */

/**
 * SGVue's own attribute names where they differ from a core field's label — the names the
 * assistant already uses in every rule — and two plain words.
 */
const CORE_ALIASES: Readonly<Record<string, CoreKey>> = {
  IfcEntity: 'entity',
  Tag: 'mark',
  GlobalId: 'guid'
}

/**
 * Every spelling of a core field, normalised: its label (`Level`, `Object Type`, `IFC Class`),
 * its key (`storey`, `typeName`), and the aliases. The key `mark` is left out on purpose — it
 * is Revit's ElementId in an IFC export, and a user saying "Mark" means Revit's Mark parameter.
 */
const CORE_BY_NORM: ReadonlyMap<string, CoreKey> = (() => {
  const m = new Map<string, CoreKey>()
  for (const k of CORE_KEYS) {
    if (k !== 'mark') m.set(normKey(k), k)
    m.set(normKey(CORE_LABELS[k]), k)
  }
  for (const [a, k] of Object.entries(CORE_ALIASES)) m.set(normKey(a), k)
  return m
})()

const CORE_NAMES: readonly string[] = [...CORE_KEYS.map((k) => CORE_LABELS[k]), 'IfcEntity']
const ATTRS: ReadonlySet<string> = new Set(ATTR_KEYS)

type Resolved =
  | { ok: true; field: FieldRef; rewritten?: string }
  | { ok: false; error: string; nearest: string[] }

/**
 * One field name → the engine's `FieldRef`. In order: a calculated column of the schedule
 * being changed, by its name; a core field; a property named with its set, as the file has
 * it (`Pset_DoorCommon.FireRating`); any property name, through `resolveKey`. A property is
 * asked for with `pset: '*'` — the engine's own rule for a template column: by name, across
 * every set, case-insensitive — so two keys that differ only by case are the same column, and
 * only keys that differ by more than that are ambiguous.
 */
export function resolveScheduleField(
  asked: string,
  w: FieldWorld,
  base: ScheduleDef | null = null
): Resolved {
  const name = asked.trim()
  const lower = name.toLowerCase()
  const calc = base?.calculated?.find((c) => c.name.trim().toLowerCase() === lower)
  if (calc) return { ok: true, field: { kind: 'formula', id: calc.id } }
  const core = CORE_BY_NORM.get(normKey(name))
  if (core) return { ok: true, field: { kind: 'core', key: core } }
  if (name.includes('.')) {
    const want = name.toUpperCase()
    for (const stat of w.store.propCatalog.values()) {
      if (stat.key.toUpperCase() === want) {
        return { ok: true, field: { kind: 'prop', pset: stat.pset, prop: stat.prop } }
      }
    }
  }
  const keys = w.propKeys.filter((k) => !ATTRS.has(k))
  const r = resolveKey(name, keys)
  const oneKey = r.candidates.length > 1 && new Set(r.candidates.map((c) => c.toUpperCase())).size === 1
  const key = r.key ?? (oneKey ? r.candidates[0] : null)
  if (key !== null) {
    return { ok: true, field: { kind: 'prop', pset: ANY_PSET, prop: key }, ...(key !== name ? { rewritten: key } : {}) }
  }
  if (r.candidates.length > 1) {
    return { ok: false, error: ambiguousText(name, r.candidates), nearest: r.candidates.slice(0, FIELD_NEAREST_CAP) }
  }
  const pool = [...CORE_NAMES, ...keys, ...(base?.calculated ?? []).map((c) => c.name)]
  const nearest = nearestKeys(name, pool, FIELD_NEAREST_CAP)
  return {
    ok: false,
    error: `"${name}" is not a Schedules field or a property name in this federation — nearest: ${nearest.join(', ')}.`,
    nearest
  }
}

/** A field as the simplified shape names it — what `resolveScheduleField` reads back. */
export function fieldName(f: FieldRef, def?: ScheduleDef | null): string {
  switch (f.kind) {
    case 'core':
      return CORE_LABELS[f.key]
    case 'prop':
      return f.pset === ANY_PSET ? f.prop : `${f.pset}.${f.prop}`
    case 'formula':
      return def?.calculated?.find((c) => c.id === f.id)?.name ?? 'Calculated'
  }
}

/** Two references to the same column: a named set and `*` agree when the property does. */
function sameField(a: FieldRef, b: FieldRef): boolean {
  if (a.kind === 'core' && b.kind === 'core') return a.key === b.key
  if (a.kind === 'formula' && b.kind === 'formula') return a.id === b.id
  if (a.kind !== 'prop' || b.kind !== 'prop') return false
  if (a.prop.toUpperCase() !== b.prop.toUpperCase()) return false
  return a.pset === ANY_PSET || b.pset === ANY_PSET || a.pset.toUpperCase() === b.pset.toUpperCase()
}

/**
 * The columns of `def` — or of `among`, a subset of them — that `asked` names: by heading as
 * the column shows it (case aside), else by field, resolved as any other field name is.
 * `removeColumns` takes columns away by it, and `color_by_schedule_column` picks its column
 * with it (2026-09-28).
 */
export function columnsNamed(
  asked: string,
  def: ScheduleDef,
  w: FieldWorld,
  among: readonly Column[] = def.columns
): Column[] {
  const want = asked.trim().toLowerCase()
  const byHeading = among.filter((c) => headingOf(c, def).trim().toLowerCase() === want)
  if (byHeading.length) return byHeading
  const r = resolveScheduleField(asked, w, def)
  return r.ok ? among.filter((c) => sameField(c.field, r.field)) : []
}

const clip = (s: string, n = CELL_CHARS): string => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/** What the table's heading shows as its title. */
const titleOf = (def: ScheduleDef): string => def.appearance?.title?.trim() || def.name

/** A group level: it draws a heading row or a footer. Everything else only orders. */
const isGroup = (l: SortLevel): boolean => !!l.header || (!!l.footer && l.footer !== 'none')

/* ────────────────────────────── building ────────────────────────────── */

export interface Built {
  def: ScheduleDef
  /** Asked name → the file's property name, for every name that was read another way. */
  resolvedKeys: Record<string, string>
  /**
   * 2026-11-08 (the live baseline's F2) — each class of the category's union that no loaded
   * model carries, left out of it, with the nearest classes; absent when none was. A union is
   * refused only when no class of it is left.
   */
  dropped?: Record<string, string[]>
}

export interface Refused {
  error: string
  /** Each name that is not a field → the nearest names; each unknown category → the nearest classes. */
  valid_values?: { fields?: Record<string, string[]>; categories?: Record<string, string[]>; columns?: string[] }
}

/** The editor's own words for each result kind — what a refusal says a column is. */
const RESULT_OF_KIND: Partial<Record<UnitKind, ScheduleResultKind>> = {
  length: 'length',
  area: 'area',
  volume: 'volume',
  mass: 'mass',
  angle: 'angle'
}

/** A calculated value's declared result, as the simplified shape names it (`SCHEDULE_RESULTS`). */
export function resultName(c: Calculated): ScheduleResultKind {
  const r = resultOf(c)
  if (r === 'yesNo') return 'yes_no'
  if (r === 'text') return 'text'
  return (c.unitKind && RESULT_OF_KIND[c.unitKind]) || 'number'
}

/** `result` written onto a calculated value — the editor's "Result is a" select, field for field. */
function declare(c: Calculated, result: ScheduleResultKind): void {
  c.result = result === 'yes_no' ? 'yesNo' : result === 'text' ? 'text' : 'number'
  if (result === 'number' || result === 'yes_no' || result === 'text') delete c.unitKind
  else c.unitKind = result
  delete c.yesNo
}

/** A unit as it may be typed without the superscript: `m2` is `m²`, `deg` is `°`. */
const unitAsked = (unit: string): string =>
  unit.trim().replace(/2$/, '²').replace(/3$/, '³').replace(/^deg(?:rees?)?$/i, '°')

/**
 * `make_schedule`'s input → a checked `ScheduleDef`. With `base` null it is a new schedule
 * and needs a category and a column; with `base` the open def, the input is a list of changes
 * to it — columns added (or, when the schedule already shows that field, re-headed and
 * re-totalled), columns removed by heading or field, and filters, sort and grouping replaced
 * when given — and everything the simplified shape cannot say (colour rules, widths,
 * appearance) is kept as it was. Any name that does not resolve refuses the whole call: nothing
 * half-built is ever sent.
 *
 * 2026-10-02 — parity with the user, phase 4. What the window's controls set and this could only
 * keep, it can now set, by the controls' own rules:
 *
 *   · `filterLogic` and `itemize` — the filter popover's All rules / Any rule, the Rows
 *     popover's "Itemise every instance";
 *   · per column `hidden`, `decimals`, `unit` and `align` — the column menu: decimals only where
 *     it offers them (a numeric column), a unit only from the list it offers for what the
 *     column measures (`unitOptions`), anything else refused with the reason;
 *   · per column `after` — its place: directly behind the named column, `""` for first. A
 *     column already shown is moved, a new one is put there instead of at the right;
 *   · `calculated` — the calculated-value editor: a formula in the engine's own grammar
 *     (`schedule/formula.ts`) or a share of a field's total. Each is defined, or redefined by
 *     name, and shown as a column. A formula the editor would mark bad (`calcProblems`: it does
 *     not parse, it names a heading no column has, its units cannot be added) refuses the call
 *     with that reason. With no `result`, a formula is what its units work out to
 *     (`dimensionOf`), which is the editor's own "use that" suggestion.
 */
export function buildSchedule(ask: AskSchedule, w: FieldWorld, base: ScheduleDef | null): Built | Refused {
  const store = w.store
  const errors: string[] = []
  const fields: Record<string, string[]> = {}
  const resolvedKeys: Record<string, string> = {}

  // ── the category ──
  let entities: string[] | null = null
  let dropped: Record<string, string[]> | undefined
  if (ask.category !== undefined) {
    const known = store.entities.map((e) => e.entity)
    const cats: Record<string, string[]> = {}
    entities = []
    for (const asked of ask.category) {
      const hit = known.find((e) => e.toLowerCase() === asked.trim().toLowerCase())
      if (hit) {
        if (!entities.includes(hit)) entities.push(hit)
      } else cats[asked] = nearestKeys(asked, known, FIELD_NEAREST_CAP)
    }
    // A class no loaded model carries is left out of a union — `["IfcWall","IfcWallStandardCase"]`
    // on an IFC4 model is the walls — and the call is refused only when nothing is left.
    if (Object.keys(cats).length && entities.length) dropped = cats
    else if (Object.keys(cats).length) {
      return {
        error:
          Object.entries(cats)
            .map(([a, near]) => `No element is of class "${a}" — nearest: ${near.join(', ')}.`)
            .join(' ') + ' A category is an IFC class the federation carries.',
        valid_values: { categories: cats }
      }
    }
  }
  if (!base && !entities?.length) {
    return { error: 'A new schedule needs a category: one or more IFC classes, such as ["IfcDoor"].' }
  }
  if (!base && !ask.columns?.length) {
    return { error: 'A new schedule needs at least one column.' }
  }

  const def: ScheduleDef = base
    ? structuredClone(base)
    : emptySchedule(`${entities![0].replace(/^Ifc/, '')} Schedule`, entities!)
  if (entities) def.entity = entities

  const resolve = (asked: string): FieldRef | null => {
    const r = resolveScheduleField(asked, w, def)
    if (r.ok) {
      if (r.rewritten) resolvedKeys[asked] = r.rewritten
      return r.field
    }
    if (!fields[asked]) {
      fields[asked] = r.nearest
      errors.push(r.error)
    }
    return null
  }

  // ── calculated values: defined first, so that a column, a filter or a sort can name one ──
  /** The values this call defined or redefined, and what each was asked to be. */
  const calcs: { calc: Calculated; spec: AskCalculated; of: FieldRef | null; kept: boolean }[] = []
  if (ask.calculated?.length) {
    const said = new Set<string>()
    for (const spec of ask.calculated) {
      const name = spec.name.trim().slice(0, 120)
      const formula = spec.formula?.trim()
      if (!name) return { error: 'A calculated column needs a name.' }
      if (said.has(name.toLowerCase())) {
        return { error: `Two calculated columns in one call are both called "${name}" — give each its own name.` }
      }
      said.add(name.toLowerCase())
      if ((formula === undefined) === (spec.percentageOf === undefined)) {
        return {
          error: `Calculated column "${name}" needs a formula over the other columns' headings, or percentageOf — one of the two.`
        }
      }
      // A percentage of a field of the file or of the schedule: resolved before the value it
      // defines exists, so it cannot name itself.
      const of = spec.percentageOf === undefined ? null : resolve(spec.percentageOf)
      def.calculated ??= []
      const had = def.calculated.find((c) => c.name.trim().toLowerCase() === name.toLowerCase())
      const calc: Calculated = had ?? { id: newId('calc', def.calculated), name, kind: 'formula' }
      if (!had) def.calculated.push(calc)
      // 2026-11-24 — what this call makes, or whose formula or percentage it changes, is Vee's,
      // with the note it sends (or none). The same formula sent again changes nothing.
      const same =
        had !== undefined &&
        (formula !== undefined
          ? had.kind === 'formula' && had.formula?.trim() === formula
          : had.kind === 'percentage' && !!had.ofField && !!of && fieldKey(had.ofField) === fieldKey(of))
      if (!same) {
        calc.by = 'vee'
        const note = typeof spec.note === 'string' ? spec.note.trim().slice(0, CALC_NOTE_CHARS) : ''
        if (note) calc.note = note
        else delete calc.note
      }
      if (formula !== undefined) {
        calc.kind = 'formula'
        calc.formula = formula
        delete calc.ofField
      } else {
        calc.kind = 'percentage'
        delete calc.formula
        // A share of a total is a plain number, whatever the value was before.
        delete calc.result
        delete calc.unitKind
        delete calc.yesNo
      }
      calcs.push({ calc, spec, of, kept: had !== undefined })
    }
    if (def.calculated!.length > MAX_DEF_CALCULATED) {
      return { error: `A schedule may carry at most ${MAX_DEF_CALCULATED} calculated columns.` }
    }
  }

  // The category's own property statistics, once: they give a new column its unit and format.
  let stats: PropStat[] | null = null
  const statOf = (f: Extract<FieldRef, { kind: 'prop' }>): PropStat | undefined => {
    const fits = (s: PropStat): boolean =>
      s.prop.toUpperCase() === f.prop.toUpperCase() &&
      (f.pset === ANY_PSET || s.pset.toUpperCase() === f.pset.toUpperCase())
    stats ??= keysForEntity(store, def.entity)
    return stats.find(fits) ?? [...store.propCatalog.values()].find(fits)
  }
  const newColumn = (field: FieldRef): Column => {
    const system = store.meta.unitSystem
    if (field.kind === 'core') return columnForCore(field.key, system)
    if (field.kind === 'formula') {
      return { field, align: alignForCalc(def.calculated?.find((c) => c.id === field.id)) }
    }
    const stat = statOf(field)
    return stat ? { ...columnForProp(stat, system), field } : { field }
  }
  const dress = (col: Column, spec: AskColumn): void => {
    // Asked for, so shown: "add Width to this" on a hidden Width column brings it back —
    // unless the call itself says hidden, which is the column menu's own switch.
    if (spec.hidden) col.hidden = true
    else delete col.hidden
    if (spec.heading !== undefined) {
      const h = spec.heading.trim().slice(0, 120)
      if (h) col.heading = h
      else delete col.heading
    }
    if (spec.total === 'none') delete col.total
    else if (spec.total === 'count_distinct') col.total = 'countDistinct'
    else if (spec.total !== undefined) col.total = spec.total
    if (spec.align !== undefined) col.align = spec.align
  }

  // ── columns: removed first, then added or re-dressed ──
  const columnSpecs = (ask.columns ?? []).map((spec) => ({ spec, field: resolve(spec.field) }))
  const removals = (ask.removeColumns ?? []).map((asked) => ({ asked, cols: columnsNamed(asked, def, w) }))
  const missing = removals.filter((r) => !r.cols.length).map((r) => r.asked)
  if (missing.length) {
    const shown = def.columns.map((c) => headingOf(c, def))
    return {
      error: `No column of this schedule is ${missing.map((m) => `"${m}"`).join(' or ')} — its columns are ${shown.join(', ')}.`,
      valid_values: { columns: shown }
    }
  }

  // ── filters, sorting, grouping ──
  const filterSpecs = (ask.filters ?? []).map((spec) => ({ spec, field: resolve(spec.field) }))
  const sortSpecs = (ask.sortBy ?? []).map((spec) => ({ spec, field: resolve(spec.field) }))
  const groupFields = (ask.groupBy ?? []).map((asked) => resolve(asked))
  const formatSpecs = (ask.groupFormat ?? []).map((spec) => ({ spec, field: resolve(spec.field) }))

  if (errors.length) return { error: errors.join(' '), valid_values: { fields } }
  for (const { calc, of } of calcs) if (of) calc.ofField = of

  const gone = new Set(removals.flatMap((r) => r.cols))
  def.columns = def.columns.filter((c) => !gone.has(c))
  /** Each asked-for column where it stands in the schedule, for the format and the place below. */
  const placed: { spec: AskColumn; col: Column }[] = []
  for (const { spec, field } of columnSpecs) {
    const shown = def.columns.find((c) => sameField(c.field, field!))
    const col = shown ?? newColumn(field!)
    // 2026-11-25 (F1, F5) — a heading asked for is refused for what the heading box refuses it
    // for: a calculated value's name, or a bracket in a name a formula uses.
    const asked = spec.heading?.trim().slice(0, 120)
    if (asked) {
      const hit = calcCalled(def, asked, col.field.kind === 'formula' ? col.field.id : null)
      const why = hit ? HEADING_TAKEN(hit.name.trim()) : bracketProblem(def, headingOf(col, def), asked)
      if (why) return { error: `Column "${headingOf(col, def)}": ${why}` }
    }
    dress(col, spec)
    if (!shown) def.columns.push(col)
    // A model column newly shown, or put back to its default heading, that a calculated value's
    // name already has is headed apart, as the field picker does (`clearOfCalcNames`).
    if (col.field.kind !== 'formula' && (!shown || spec.heading !== undefined)) {
      const apart = clearOfCalcNames(def, col)
      if (apart) col.heading = apart
    }
    placed.push({ spec, col })
  }
  // A calculated value this call defined is shown, unless it was asked for among the columns
  // (and so placed there) or taken away in the same call.
  for (const { calc } of calcs) {
    const field: FieldRef = { kind: 'formula', id: calc.id }
    if (!def.columns.some((c) => sameField(c.field, field)) && ![...gone].some((c) => sameField(c.field, field))) {
      def.columns.push(newColumn(field))
    }
  }
  if (!def.columns.length) return { error: 'A schedule needs at least one column; that would leave none.' }
  if (def.columns.length > MAX_DEF_COLUMNS) {
    return { error: `A schedule may carry at most ${MAX_DEF_COLUMNS} columns.` }
  }

  // ── a column's place: directly after a named one, or first ──
  for (const { spec, col } of placed) {
    if (spec.after === undefined) continue
    const after = spec.after.trim()
    // `""` is first; anything else names a column, by heading or by field.
    const named = after ? columnsNamed(after, def, w) : null
    if (named && !named.length) {
      const shown = def.columns.map((c) => headingOf(c, def))
      return {
        error: `No column of this schedule is "${after}" to put ${headingOf(col, def)} after — its columns are ${shown.join(', ')}.`,
        valid_values: { columns: shown }
      }
    }
    const target = named ? named[0] : null
    if (target === col) continue
    def.columns.splice(def.columns.indexOf(col), 1)
    def.columns.splice(target ? def.columns.indexOf(target) + 1 : 0, 0, col)
  }

  // ── calculated values, against the columns the schedule now has ──
  if (calcs.length) {
    // 2026-11-24 — a calculated name is unique: another column's heading, or another calculated
    // value's name, refuses the call with the reason, as a formula that does not parse does.
    // A value keeping the name it already has is never a new clash (2026-11-25, F6): an older
    // file can hold one beside a model column of that heading, and Vee may still redefine it.
    const clashes = calcs
      .filter(({ kept }) => !kept)
      .map(({ calc }) => ({ calc, clash: calcNameClash(def, calc.id, calc.name) }))
      .filter((x) => x.clash)
    if (clashes.length) {
      const mine = new Set(calcs.map(({ calc }) => calc.id))
      const headings = def.columns
        .filter((c) => !(c.field.kind === 'formula' && mine.has(c.field.id)))
        .map((c) => headingOf(c, def))
      return {
        error:
          clashes.map(({ calc, clash }) => `Calculated column "${calc.name}": ${clash}`).join(' ') +
          ` This schedule’s columns are ${headings.join(', ')}.`,
        valid_values: { columns: headings }
      }
    }
    for (const { calc, spec } of calcs) {
      if (calc.kind !== 'formula') continue
      if (spec.result !== undefined) declare(calc, spec.result)
      else {
        // What the expression itself measures — `Width * Height` is an area — which is the
        // editor's own suggestion, taken. Text and yes / no are the author's to say. Asked again
        // for each, so a formula naming one declared just before it sees what that one is.
        const kind = dimensionOf(calc.formula ?? '', kindsByHeading(store, def)).kind as UnitKind | null
        declare(calc, (kind && RESULT_OF_KIND[kind]) || 'number')
      }
      // Saying what the result is re-decides how the column reads, as the editor's select does.
      for (const col of def.columns) {
        if (col.field.kind === 'formula' && col.field.id === calc.id) col.align = alignForCalc(calc)
      }
    }
    // An explicit `align` on such a column is the stronger word, and was asked for in this call.
    for (const { spec, col } of placed) if (spec.align !== undefined) col.align = spec.align
    const problems = calcProblems(store, def)
    const bad = calcs.filter(({ calc }) => problems.has(calc.id))
    if (bad.length) {
      const headings = def.columns
        .filter((c) => c.field.kind !== 'formula')
        .map((c) => headingOf(c, def))
      return {
        error:
          bad
            .map(({ calc }) => `Calculated column "${calc.name}": ${(problems.get(calc.id) ?? '').replace(/[.\s]*$/, '')}.`)
            .join(' ') +
          ` A formula names other columns by their headings — [Clear Width] for one with a space — and this schedule's are ${headings.join(', ')}.`,
        valid_values: { columns: headings }
      }
    }
  }

  // ── a column's format: the column menu's unit and decimals, where it offers them ──
  for (const { spec, col } of placed) {
    if (spec.unit === undefined && spec.decimals === undefined) continue
    const heading = headingOf(col, def)
    const kind = kindOf(store, def, col.field)
    if (spec.unit !== undefined) {
      const units = unitOptions(kind)
      const unit = unitAsked(spec.unit)
      if (!units.length) {
        // 2026-11-08 (F2): a number the file gives no measure type is a plain number to the
        // engine — and "Length is not a length" read as a bug when the column was called Length.
        errors.push(
          typeOf(store, def, col.field) === 'number'
            ? `${heading} has no unit in the file — its numbers carry no measure type, so the engine cannot tell a length from an area or a count — and so no unit can be set on it; leave unit out and its cells show the file’s own numbers.`
            : `${heading} is not a length, an area, a volume, an angle or a mass, so it has no unit to set.`
        )
      } else if (!units.includes(unit)) {
        errors.push(`${heading} is ${kind === 'area' || kind === 'angle' ? 'an' : 'a'} ${kind}: its unit is one of ${units.join(', ')} — not "${spec.unit}".`)
      } else col.format = { ...col.format, display: unit }
    }
    if (spec.decimals !== undefined) {
      if (typeOf(store, def, col.field) !== 'number' && kind === 'none') {
        errors.push(`${heading} is not a number, so decimals do not apply to it.`)
      } else col.format = { ...col.format, decimals: spec.decimals }
    }
  }
  for (const { spec, col } of placed) dressExtras(store, def, col, spec, errors)
  if (errors.length) return { error: errors.join(' ') }

  if (ask.filters !== undefined) {
    const rules: FilterRule[] = []
    for (const { spec, field } of filterSpecs) {
      const rule = toRule(spec, field!, def)
      if (typeof rule === 'string') errors.push(rule)
      else rules.push(rule)
    }
    if (errors.length) return { error: errors.join(' ') }
    def.filters = rules
  }
  if (ask.filterLogic !== undefined) def.filterLogic = ask.filterLogic

  if (ask.sortBy !== undefined || ask.groupBy !== undefined) {
    const totals = def.columns.some((c) => c.total)
    const groups: SortLevel[] =
      ask.groupBy !== undefined
        ? groupFields.map((field) => ({
            field: field!,
            dir: 'asc',
            header: true,
            footer: totals ? 'titleCountTotals' : 'count'
          }))
        : def.sort.filter(isGroup)
    const plain: SortLevel[] =
      ask.sortBy !== undefined
        ? sortSpecs.map(({ spec, field }) => ({ field: field!, dir: spec.descending ? 'desc' : 'asc' }))
        : def.sort.filter((l) => !isGroup(l))
    if (groups.length + plain.length > MAX_SORT_LEVELS) {
      return {
        error: `A schedule sorts and groups by at most ${MAX_SORT_LEVELS} fields together; that asks for ${groups.length + plain.length}.`
      }
    }
    def.sort = [...groups, ...plain]
  }

  // ── a level's heading row, footer and blank line, on the levels this call leaves ──
  for (const { spec, field } of formatSpecs) {
    const level = def.sort.find((l) => sameField(l.field, field!))
    if (!level) {
      const levels = def.sort.map((l) => fieldName(l.field, def))
      errors.push(
        `groupFormat: this schedule has no sort or group level for ${spec.field} — ` +
          (levels.length ? `its levels are ${levels.join(', ')}` : 'it has none') +
          '; sort or group by it first (sortBy or groupBy).'
      )
      continue
    }
    if (spec.header !== undefined) level.header = spec.header
    if (spec.footer !== undefined) level.footer = spec.footer === 'title_count_totals' ? 'titleCountTotals' : spec.footer
    if (spec.blankLine !== undefined) level.blankLine = spec.blankLine
  }
  if (ask.style) applyStyle(def, ask.style, errors)
  if (errors.length) return { error: errors.join(' ') }
  if (ask.grandTotalTitle !== undefined) {
    const label = ask.grandTotalTitle.trim()
    if (label.length > SCHEDULE_GRAND_TOTAL_TITLE_CHARS) {
      return { error: `grandTotalTitle is at most ${SCHEDULE_GRAND_TOTAL_TITLE_CHARS} characters; that one has ${label.length}.` }
    }
    if (label) def.grandTotalTitle = label
    else delete def.grandTotalTitle
  }

  if (ask.combine === 'sort' && ask.itemize === true) {
    return { error: 'make_schedule: combine "sort" needs itemize false — leave itemize out (combine switches it off) or send itemize: false.' }
  }
  if (ask.itemize !== undefined) def.itemize = ask.itemize
  // Combining by sort value is a way of itemise off, so asking for it switches itemise off.
  if (ask.combine === 'sort') { def.combine = 'sort'; def.itemize = false }
  else if (ask.combine === 'identical') delete def.combine
  if (ask.grandTotals !== undefined) def.grandTotal = ask.grandTotals
  const title = ask.title?.trim().slice(0, 200)
  if (title) {
    def.name = title
    if (def.appearance?.title?.trim()) def.appearance.title = title
  }

  let checked: ScheduleDef
  try {
    checked = parseScheduleDef(JSON.parse(JSON.stringify(def)))
  } catch (error) {
    return { error: `That schedule could not be built: ${error instanceof Error ? error.message : String(error)}` }
  }
  return { def: checked, resolvedKeys, ...(dropped ? { dropped } : {}) }
}

/** What a refusal quotes back of a value the model sent: bounded, one line. */
const quoted = (v: unknown): string => (typeof v === 'number' ? String(v) : JSON.stringify(clip(String(v), 40)))
const FONT_KEYS: readonly string[] = BODY_FONTS.map((f) => f.key)

/**
 * The Style popover's controls, by `make_schedule`'s names (2026-11-25): only the keys given
 * change. Text size is the popover slider's own range (`TEXT_SIZE_SLIDER_MIN`–`_MAX`), a font one
 * of its list.
 */
function applyStyle(def: ScheduleDef, style: AskStyle, errors: string[]): void {
  const a: Appearance = (def.appearance ??= {})
  if (style.textSize !== undefined) {
    const n = style.textSize
    if (!Number.isFinite(n) || n < TEXT_SIZE_SLIDER_MIN || n > TEXT_SIZE_SLIDER_MAX) {
      errors.push(`Text size ${quoted(n)} is outside ${TEXT_SIZE_SLIDER_MIN}–${TEXT_SIZE_SLIDER_MAX} px, the Style slider’s range.`)
    } else a.fontSize = Math.round(n)
  }
  if (style.font !== undefined) {
    if (!FONT_KEYS.includes(style.font)) {
      errors.push(`Font ${quoted(style.font)} is not one the Style popover offers — the fonts are ${FONT_KEYS.join(', ')}.`)
    } else a.bodyFont = style.font
  }
  if (style.showTitle !== undefined) a.showTitle = style.showTitle
  if (style.gridLines !== undefined) a.gridLines = style.gridLines
  if (style.stripes !== undefined) a.zebra = style.stripes
  if (style.outline !== undefined) a.outline = style.outline
  if (style.boldHeader !== undefined) a.headerBold = style.boldHeader
  if (style.blankRowBeforeData !== undefined) a.blankRowBeforeData = style.blankRowBeforeData
}

/**
 * A column's More fold and colour rules (2026-11-25), each by the column menu's own rule: a
 * width in its Width box's range; thousands, blank-for-zero and the unit symbol where it offers
 * them (a numeric column); a yes / no spelling on a yes / no column; colour rules with the
 * operators its rule row offers for what the column holds (`opsForType` less the two list
 * operators, plus one a rule of this column already uses, which the row keeps), colours
 * `#rrggbb` only, at most `SCHEDULE_COLOUR_RULES_MAX`.
 */
function dressExtras(store: ModelStore, def: ScheduleDef, col: Column, spec: AskColumn, errors: string[]): void {
  const heading = headingOf(col, def)
  const type = typeOf(store, def, col.field)
  const numeric = type === 'number' || kindOf(store, def, col.field) !== 'none'
  if (spec.width !== undefined) {
    const w = spec.width
    if (!Number.isFinite(w) || w < COL_WIDTH_MIN || w > COL_WIDTH_MAX) {
      errors.push(`${heading}: width ${quoted(w)} is outside ${COL_WIDTH_MIN}–${COL_WIDTH_MAX} px, the column menu’s range.`)
    } else col.width = Math.round(w)
  }
  if (spec.verticalHeading === true) col.headingOrientation = 'vertical'
  else if (spec.verticalHeading === false) delete col.headingOrientation
  const switches: [keyof AskColumn, boolean | undefined][] = [
    ['thousands', spec.thousands],
    ['hideZero', spec.hideZero],
    ['showUnit', spec.showUnit]
  ]
  const on = switches.filter(([, v]) => v === true).map(([k]) => k)
  if (on.length && !numeric) {
    errors.push(`${heading} is not a number, so ${on.join(', ')} do${on.length === 1 ? 'es' : ''} not apply to it.`)
  } else {
    if (spec.thousands !== undefined) col.format = { ...col.format, thousands: spec.thousands }
    if (spec.hideZero !== undefined) {
      col.format = { ...col.format, suppressZero: true }
      if (!spec.hideZero) delete col.format.suppressZero
    }
    if (spec.showUnit !== undefined) {
      col.format = { ...col.format, showSymbol: true }
      if (!spec.showUnit) delete col.format.showSymbol
    }
  }
  for (const key of ['prefix', 'suffix'] as const) {
    const text = spec[key]
    if (text === undefined) continue
    if (text.length > SCHEDULE_AFFIX_CHARS) {
      errors.push(`${heading}: a ${key} is at most ${SCHEDULE_AFFIX_CHARS} characters.`)
    } else {
      col.format = { ...col.format, [key]: text }
      if (!text) delete col.format[key]
    }
  }
  if (spec.yesNoStyle !== undefined) {
    const style = BOOL_STYLES.find((b) => b === spec.yesNoStyle)
    if (!style) {
      errors.push(`${heading}: yesNoStyle ${quoted(spec.yesNoStyle)} is not one of the window’s yes / no styles — ${BOOL_STYLES.join(', ')}.`)
    } else if (type !== 'bool') {
      errors.push(`${heading} is not a yes / no column, so yesNoStyle does not apply to it.`)
    } else col.format = { ...col.format, boolStyle: style }
  }
  if (spec.colourRules !== undefined) {
    const asked = spec.colourRules
    if (asked.length > SCHEDULE_COLOUR_RULES_MAX) {
      errors.push(`${heading}: at most ${SCHEDULE_COLOUR_RULES_MAX} colour rules on one column; that asks for ${asked.length}.`)
      return
    }
    const ops = new Set<Op>([
      ...opsForType(type).filter((o) => o !== 'in' && o !== 'between'),
      ...(col.conditional ?? []).map((r) => r.op)
    ])
    const rules: CondRule[] = []
    asked.forEach((r, i) => {
      const which = `${heading}: colour rule ${i + 1}`
      const bad: string[] = []
      if (!ops.has(r.op)) bad.push(`${which}'s op ${quoted(r.op)} is not offered for this column — its ops are ${[...ops].join(', ')}.`)
      for (const [key, v] of [['background', r.background], ['text', r.text]] as const) {
        if (v !== undefined && !SCHEDULE_HEX_COLOUR.test(v)) bad.push(`${which}'s ${key} colour ${quoted(v)} ${NOT_A_COLOUR}`)
      }
      if (typeof r.value === 'string' && r.value.length > SCHEDULE_COLOUR_VALUE_CHARS) {
        bad.push(`${which}'s value is at most ${SCHEDULE_COLOUR_VALUE_CHARS} characters.`)
      }
      if (bad.length) {
        errors.push(...bad)
        return
      }
      const presence = r.op === 'hasValue' || r.op === 'noValue'
      rules.push({
        op: r.op,
        ...(!presence && r.value !== undefined ? { value: r.value } : {}),
        ...(r.background !== undefined ? { bg: r.background } : {}),
        ...(r.text !== undefined ? { fg: r.text } : {}),
        bold: r.bold === true
      })
    })
    if (rules.length) col.conditional = rules
    else delete col.conditional
  }
}

/** A colour the file holds, as `#rrggbb` — the reader also keeps `#rgb` and `rgb(…)` — so get_schedule's read sends back as-is. */
function hexOf(c: string | undefined): string | undefined {
  if (!c) return undefined
  const s = c.trim()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(s)
  if (rgb) return '#' + rgb.slice(1, 4).map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')
  return s
}

const NUMERIC_OPS: ReadonlySet<Op> = new Set<Op>(['>', '>=', '<', '<='])

/** One simplified filter → the engine's rule, or the sentence that says what is missing. */
function toRule(spec: AskFilter, field: FieldRef, def: ScheduleDef): FilterRule | string {
  const { op } = spec
  // The engine works a percentage out over the rows the filters leave (`engine.ts`), so a
  // filter on one can never match: said, rather than built into a table that is silently empty.
  if (field.kind === 'formula' && def.calculated?.find((c) => c.id === field.id)?.kind === 'percentage') {
    return `A filter cannot test ${spec.field}: a percentage is worked out over the rows the filters leave.`
  }
  if (op === 'hasValue' || op === 'noValue') return { field, op }
  if (op === 'between') {
    const nums = (spec.values ?? []).map(Number)
    if (nums.length !== 2 || nums.some((n) => !Number.isFinite(n))) {
      return `A "between" filter on ${spec.field} needs values with exactly two numbers.`
    }
    return { field, op, values: nums }
  }
  if (op === 'in') {
    const values = (spec.values ?? []).map((v) => (typeof v === 'number' ? v : String(v).slice(0, 500)))
    if (!values.length) return `An "in" filter on ${spec.field} needs values — the list to match any of.`
    return { field, op, values }
  }
  if (spec.value === undefined || spec.value === '') return `A "${op}" filter on ${spec.field} needs a value.`
  if (NUMERIC_OPS.has(op)) {
    const n = Number(spec.value)
    if (!Number.isFinite(n)) return `A "${op}" filter compares numbers, and "${spec.value}" is not one.`
    return { field, op, value: n }
  }
  return { field, op, value: typeof spec.value === 'boolean' ? String(spec.value) : spec.value }
}

/* ────────────────────────────── reading ────────────────────────────── */

/**
 * A definition in `make_schedule`'s own shape, so the model reasons about what it can send.
 *
 * Phase 4 (2026-10-02): everything that tool can now set is read back under the name it is set
 * by — a column's `decimals` where it has them (its `unit` is added by `readSchedule`, which
 * knows what the column measures), its `align` where that is not what the table does anyway
 * (`alignOf`: right for a column with decimals or a total, left otherwise — so an ordinary text
 * or number column says nothing), `filterLogic` and `itemize` as before, and what each
 * calculated value's `result` is. A column's place is its place in the list.
 *
 * 2026-11-25: and `style`, `groupFormat`, `grandTotalTitle` and each column's width, heading
 * direction, number format, yes / no style, colour rules and distinct count, the same way — each
 * only where it is not what a schedule does anyway, so an ordinary schedule reads as before:
 * a style key that is not the window's default; a level's heading row and footer where they are
 * not what groupBy gives (a heading row, and a count — with totals when a column has one), its
 * blank line when on; a column's thousands separator when off, or with the rest of a number
 * format that is set (a prefix, a suffix, blank for zero, the unit symbol).
 */
export function simplify(def: ScheduleDef): Record<string, unknown> {
  const calculated = def.calculated ?? []
  const footerByDefault = def.columns.some((c) => c.total) ? 'titleCountTotals' : 'count'
  const levels = def.sort
    .map((l) => {
      const group = isGroup(l)
      return {
        field: fieldName(l.field, def),
        ...(group && l.header !== true ? { header: !!l.header } : {}),
        ...(group && l.footer !== undefined && l.footer !== footerByDefault ? { footer: footerName(l.footer) } : {}),
        ...(l.blankLine ? { blankLine: true } : {})
      }
    })
    .filter((l) => Object.keys(l).length > 1)
  const style = styleOf(def.appearance ?? {})
  return {
    title: clip(titleOf(def), 200),
    category: def.entity,
    columns: def.columns.map((c) => ({
      field: fieldName(c.field, def),
      heading: clip(headingOf(c, def)),
      ...(c.total ? { total: c.total === 'countDistinct' ? 'count_distinct' : c.total } : {}),
      ...(c.hidden ? { hidden: true } : {}),
      ...(c.format?.decimals !== undefined ? { decimals: c.format.decimals } : {}),
      ...(c.align && c.align !== (c.total || c.format?.decimals !== undefined ? 'right' : 'left')
        ? { align: c.align }
        : {}),
      ...(c.field.kind === 'formula' ? { calculated: true } : {}),
      ...(c.width !== undefined ? { width: c.width } : {}),
      ...(c.headingOrientation === 'vertical' ? { verticalHeading: true } : {}),
      ...(c.format?.thousands === false ||
      (c.format?.thousands !== undefined && (c.format.prefix || c.format.suffix || c.format.suppressZero || c.format.showSymbol))
        ? { thousands: c.format.thousands }
        : {}),
      ...(c.format?.prefix ? { prefix: c.format.prefix } : {}),
      ...(c.format?.suffix ? { suffix: c.format.suffix } : {}),
      ...(c.format?.suppressZero ? { hideZero: true } : {}),
      ...(c.format?.showSymbol ? { showUnit: true } : {}),
      ...(c.format?.boolStyle ? { yesNoStyle: c.format.boolStyle } : {}),
      ...(c.conditional?.length
        ? {
            colourRules: c.conditional.map((r) => ({
              op: r.op,
              ...(r.value !== undefined ? { value: typeof r.value === 'number' ? r.value : clip(r.value) } : {}),
              ...(r.bg ? { background: hexOf(r.bg) } : {}),
              ...(r.fg ? { text: hexOf(r.fg) } : {}),
              ...(r.bold ? { bold: true } : {})
            }))
          }
        : {})
    })),
    filters: def.filters.map((f) => ({
      field: fieldName(f.field, def),
      op: f.op,
      ...(f.value !== undefined ? { value: f.value } : {}),
      ...(f.values ? { values: f.values } : {})
    })),
    ...(def.filterLogic === 'or' ? { filterLogic: 'or' } : {}),
    sortBy: def.sort
      .filter((l) => !isGroup(l))
      .map((l) => ({ field: fieldName(l.field, def), ...(l.dir === 'desc' ? { descending: true } : {}) })),
    groupBy: def.sort.filter(isGroup).map((l) => fieldName(l.field, def)),
    ...(levels.length ? { groupFormat: levels } : {}),
    grandTotals: def.grandTotal,
    ...(def.grandTotalTitle ? { grandTotalTitle: clip(def.grandTotalTitle, 200) } : {}),
    ...(Object.keys(style).length ? { style } : {}),
    ...(def.itemize ? {} : { itemize: false }),
    ...(!def.itemize && def.combine === 'sort' ? { combine: 'sort' } : {}),
    ...(calculated.length
      ? {
          calculated: calculated.slice(0, SCHEDULE_CALC_CAP).map((c) => ({
            name: clip(c.name),
            ...(c.kind === 'formula'
              ? { formula: clip(c.formula ?? '', SCHEDULE_FORMULA_CHARS), result: resultName(c) }
              : {}),
            ...(c.kind === 'percentage' && c.ofField ? { percentageOf: fieldName(c.ofField, def) } : {}),
            ...(c.note ? { note: c.note } : {})
          }))
        }
      : {})
  }
}

/** The Style popover's keys that are not its defaults (`parseScheduleDef`'s), under `make_schedule`'s names. */
function styleOf(a: Appearance): AskStyle {
  const font = normaliseFont(a.bodyFont)
  const size = a.fontSize ?? 13
  return {
    ...(a.showTitle === false ? { showTitle: false } : {}),
    ...(a.gridLines === false ? { gridLines: false } : {}),
    ...(a.zebra === false ? { stripes: false } : {}),
    ...(size !== 13 ? { textSize: size } : {}),
    ...(font !== 'plex' ? { font } : {}),
    ...(a.outline === false ? { outline: false } : {}),
    ...(a.headerBold === false ? { boldHeader: false } : {}),
    ...(a.blankRowBeforeData ? { blankRowBeforeData: true } : {})
  }
}

/** A level's footer as `make_schedule` names it. */
function footerName(f: NonNullable<SortLevel['footer']>): ScheduleFooterName {
  switch (f) {
    case 'titleCountTotals':
      return 'title_count_totals'
    case 'none':
    case 'title':
    case 'count':
    case 'totals':
      return f
  }
}

/** The SI unit the engine stores a measure in — what a filter number is compared in. */
const SI_UNIT: Partial<Record<UnitKind, string>> = {
  length: 'm',
  area: 'm²',
  volume: 'm³',
  angle: 'rad',
  mass: 'kg'
}

/** Elements of the category looked at for a column's unit. */
const UNIT_SAMPLE = 1000

/**
 * Each column's display unit, by `def.columns` index — the unit its cells and totals are
 * written in — and the SI unit a filter on it compares in; `null` for a column that is not a
 * measure (text, yes/no, a count, a number the file gave no unit), whose filter compares the
 * number as shown. The kind is read off the first of the category's elements that carries a
 * number in that column, exactly as the engine reads it (`Cell.k`); a calculated column's is
 * its author's `unitKind`.
 */
function unitsOf(
  store: ModelStore,
  def: ScheduleDef,
  candidates: readonly number[]
): ({ unit: string; filterUnit: string } | null)[] {
  const sample = candidates.slice(0, UNIT_SAMPLE)
  return def.columns.map((col) => {
    let kind: UnitKind | undefined
    const f = col.field
    if (f.kind === 'formula') {
      const calc = def.calculated?.find((c) => c.id === f.id)
      kind = calc && resultOf(calc) === 'number' ? calc.unitKind : undefined
    } else {
      for (const r of sample) {
        const cell = resolveField(store, r, f)
        if (typeof cell?.v === 'number') {
          kind = cell.k
          break
        }
      }
    }
    const si = kind ? SI_UNIT[kind] : undefined
    return kind && si ? { unit: col.format?.display || defaultUnit(kind), filterUnit: si } : null
  })
}

/** Integer in range, else the default. */
function intIn(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : dflt
  return Math.min(hi, Math.max(lo, n))
}

/** Headings as object keys, a repeat numbered, so two columns called "Width" both show. */
function keyed(headings: readonly string[]): string[] {
  const seen = new Map<string, number>()
  return headings.map((h) => {
    const n = (seen.get(h) ?? 0) + 1
    seen.set(h, n)
    return n > 1 ? `${h} (${n})` : h
  })
}

export interface ScheduleRead {
  forModel: Record<string, unknown>
  /** Federation ids of every element the schedule lists, in table order. */
  ids: number[]
  /** Each top-level group's label and elements, for the chips under a reply. */
  groups: { label: string; ids: number[] }[]
}

/** What a row combined by sort value stands for, said in `readSchedule`'s message. */
function combinedNote(def: ScheduleDef): string {
  // Bounded like every text this result takes from the file: a field name can be any length.
  const labels = def.sort.slice(0, MAX_SORT_LEVELS).map((l) => clip(fieldName(l.field, def), 60))
  return (
    (labels.length
      ? ` Each row stands for the elements sharing one ${labels.join(' + ')} value, Count saying how many;`
      : ' With no sort level every element is one row, Count saying how many;') +
    ' a column with a total shows it over those elements, and <varies> means they differ in that column.'
  )
}

/**
 * Run `def` over `store` and report it as the Schedules window shows it. The engine runs
 * uncapped (the screen stops drawing at 5 000 rows; totals never did), and the page of rows,
 * the group list and every cell are what is bounded here.
 */
export function readSchedule(
  store: ModelStore,
  def: ScheduleDef,
  rowIds: readonly number[],
  opts: { limit?: unknown; offset?: unknown } = {}
): ScheduleRead {
  const limit = intIn(opts.limit, 1, SCHEDULE_ROWS_CAP, SCHEDULE_ROWS_DEFAULT)
  const offset = intIn(opts.offset, 0, Number.MAX_SAFE_INTEGER, 0)
  const res = runSchedule(store, def, { cap: Infinity })
  const headings = [...res.headings, ...(res.countColumn ? ['Count'] : [])].map((h) => clip(h))
  const keys = keyed(headings)
  const totalsOf = (cells: readonly (string | null)[]): Record<string, string> => {
    const out: Record<string, string> = {}
    cells.forEach((c, i) => {
      if (c !== null && c !== '') out[keys[i]] = clip(c)
    })
    return out
  }

  let budget = READ_BUDGET
  let cut = false
  const spend = (v: unknown): boolean => {
    const n = JSON.stringify(v).length
    if (n > budget) cut = true
    else budget -= n
    return !cut
  }

  const rows: string[][] = []
  const groups: { group: string; level: number; count: number; totals?: Record<string, string> }[] = []
  let groupCount = 0
  let grand: { label: string; count: number; totals: Record<string, string> } | null = null
  const filled = new Array<number>(headings.length).fill(0)
  const path: string[] = []
  const ids: number[] = []
  const top: { label: string; ids: number[] }[] = []
  let dataIndex = 0

  for (const r of res.rows) {
    if (r.kind === 'group') {
      path.length = r.level
      path[r.level] = r.label
      if (r.level === 0) top.push({ label: r.label, ids: [] })
      continue
    }
    if (r.kind === 'data') {
      for (const x of r.rows) {
        const id = rowIds[x]
        ids.push(id)
        if (top.length) top[top.length - 1].ids.push(id)
      }
      // A row combined by sort value counts its own members (`filled`): a <varies> or a
      // total cell is not blank, yet some of the elements behind it may be.
      r.cells.forEach((c, i) => {
        if (r.filled) filled[i] += r.filled[i]
        else if (c !== '') filled[i] += r.count
      })
      if (res.countColumn) filled[headings.length - 1] += r.count
      if (dataIndex >= offset && rows.length < limit && !cut) {
        const cells = [...r.cells.map((c) => clip(c)), ...(res.countColumn ? [String(r.count)] : [])]
        if (spend(cells)) rows.push(cells)
      }
      dataIndex++
      continue
    }
    if (r.kind === 'footer') {
      groupCount++
      if (groups.length >= SCHEDULE_GROUPS_CAP || cut) continue
      const label = path[r.level] !== undefined ? path.slice(0, r.level + 1).join(' › ') : r.label
      const totals = totalsOf(r.cells)
      const entry = {
        group: clip(label, 200),
        level: r.level,
        count: r.count,
        ...(Object.keys(totals).length ? { totals } : {})
      }
      if (spend(entry)) groups.push(entry)
      continue
    }
    if (r.kind === 'grand') grand = { label: clip(r.label), count: r.count, totals: totalsOf(r.cells) }
  }

  const candidates = candidateRows(store, def)
  const filterKeeps = def.filters.length ? keepsOf(store, def, candidates) : undefined
  // The definition in the input's shape, each measured column carrying its display unit and
  // the SI unit its filters compare in — the one thing the table's text leaves unsaid.
  const schedule = simplify(def) as { columns: Record<string, unknown>[] }
  const units = unitsOf(store, def, candidates)
  units.forEach((u, i) => {
    if (u) Object.assign(schedule.columns[i], u)
  })
  const truncated = offset + rows.length < res.totalDataRows || groups.length < groupCount
  const title = clip(titleOf(def), 200)
  const bySort = !def.itemize && def.combine === 'sort'
  const shownRows = rows.length ? `rows ${offset + 1}–${offset + rows.length} are listed as the table shows them` : 'no rows are listed'
  const message =
    `${title}: ${res.totalDataRows} row${res.totalDataRows === 1 ? '' : 's'} listing ${res.matchedElements} of the ` +
    `${candidates.length} ${def.entity.join(' / ') || 'uncategorised'} elements; ${shownRows}` +
    (truncated ? ' — more are left out, page with offset.' : '.') +
    (grand ? ' The grand totals are in grandTotal.' : '') +
    (bySort ? combinedNote(def) : '') +
    (units.some(Boolean)
      ? ' Cells and totals read in each column’s unit; a filter number is in its filterUnit (SI), so 900 mm is 0.9.'
      : '')

  return {
    forModel: {
      message,
      schedule,
      headings,
      rows,
      offset,
      limit,
      rowCount: res.totalDataRows,
      elementCount: res.matchedElements,
      categoryElements: candidates.length,
      filled: Object.fromEntries(keys.map((k, i) => [k, filled[i]])),
      ...(filterKeeps ? { filterKeeps } : {}),
      groups,
      groupCount,
      grandTotal: grand,
      truncated
    },
    ids,
    groups: top
  }
}

/**
 * The federation ids of every element `def` lists, in table order, each once — what the view
 * tools act on for `schedule:true` (2026-10-02). The engine run uncapped, as `readSchedule`'s
 * is: the screen stops drawing at 5 000 rows, and "what this schedule lists" does not. With
 * itemise off a row stands for several elements, and all of them are in it.
 */
export function scheduleElementIds(store: ModelStore, def: ScheduleDef, rowIds: readonly number[]): number[] {
  const seen = new Set<number>()
  for (const row of runSchedule(store, def, { cap: Infinity }).rows) {
    if (row.kind !== 'data') continue
    for (const r of row.rows) seen.add(rowIds[r])
  }
  return [...seen]
}

/** How many of the category's elements each filter keeps on its own — "why is this empty?". */
function keepsOf(
  store: ModelStore,
  def: ScheduleDef,
  candidates: readonly number[]
): { filter: string; keeps: number }[] {
  const plan = planComputed(def)
  return def.filters.map((f) => {
    let n = 0
    for (const r of candidates) {
      const computed = f.field.kind === 'formula' ? plan.compute(store, r) : undefined
      if (matchRule(resolveField(store, r, f.field, computed), f)) n++
    }
    return { filter: clip(ruleText(f, def), 200), keeps: n }
  })
}

/**
 * The view state's line about the open schedule. Small: it is sent on every turn. Pure over the
 * def and the row count the Schedules window reported with it (`current`) — the headings are
 * the engine's own, visible columns with clashing names qualified, without running it.
 */
export function scheduleBrief(def: ScheduleDef, rowCount: number): ScheduleBrief {
  const cols = visibleColumns(def)
  const headings = disambiguate(cols, cols.map((c) => headingOf(c, def)))
  const logic = def.filterLogic === 'or' ? ' or ' : ' and '
  return {
    title: clip(titleOf(def)),
    category: def.entity.slice(0, SCHEDULE_CATEGORY_CAP),
    columns: headings.slice(0, SCHEDULE_COLUMN_CAP).map((h) => clip(h, 60)),
    filters: clip(def.filters.map((f) => ruleText(f, def)).join(logic), 300),
    rowCount
  }
}
