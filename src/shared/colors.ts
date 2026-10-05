/**
 * The three fixed palettes — `design-reference/BUILD_PLAN.md` §5 "Fixed palettes
 * (theme-independent — do NOT tokenise)", and `SGVue.dc.html:844–845` and `:1338`.
 *
 * They are **not** theme tokens: the same hex in both themes, which is why anything drawn on
 * top of one must be a fixed dark (`#0F1516`), never `--ground` or `--ink` (pitfall 7).
 *
 * `colorBy` lives here too, because the scheme and its palette are one thing: the colour a
 * group gets *is* `SCHEME[i % 11]`, and splitting them would let one change without the other.
 */
import { attr } from './attr'
import { matchFn, type Rule, type VisElement } from './rules'

/** Highlight / filter-step colours. `SGVue.dc.html:844` (`HL`). */
export const HL = ['#35C4B6', '#E8A33D', '#E05A6B', '#7B8CF0', '#6BC96B', '#D96BD0'] as const

/** Model-override palette: `HL` with a neutral grey in front. `SGVue.dc.html:845` (`MC`). */
export const MC = [
  '#8A9492',
  '#35C4B6',
  '#E8A33D',
  '#E05A6B',
  '#7B8CF0',
  '#6BC96B',
  '#D96BD0'
] as const

/** Ink that must stay legible on any of the fixed palette colours (pitfall 7). */
export const FIXED_INK = '#0F1516'

/**
 * Colour-by-property scheme: the six `HL` colours, then five more so eleven distinct values
 * are told apart before the modulo repeats. `SGVue.dc.html:1338` (`SCHEME`), verbatim.
 */
export const SCHEME = [
  '#35C4B6',
  '#E8A33D',
  '#E05A6B',
  '#7B8CF0',
  '#6BC96B',
  '#D96BD0',
  '#8FA3B5',
  '#C9A26B',
  '#6BBFC9',
  '#B58FD9',
  '#8A9492'
] as const

/** One legend row: the value, how many elements carry it, its colour, and which ids. */
export interface ColorGroup {
  v: string
  n: number
  color: string
  ids: number[]
}

/** The design's `state.colorBy` (`SGVue.dc.html:852`, written at `:1355`). */
export interface ColorByState {
  prop: string
  groups: ColorGroup[]
}

/**
 * `colorBy(prop, rules)` — `SGVue.dc.html:1339–1356`, as a pure function.
 *
 * The pool is the rule-matched set when rules are given and the whole federation otherwise;
 * every element's value for `prop` comes from the **shared `attr`** resolver, which is the
 * whole point of pitfall 17 (a `groupBy` locked to five attributes made `SpeciesCommonName`
 * ungroupable). `undefined` and `''` are skipped — an element that does not carry the property
 * is not a group of its own — the value is keyed by `String(v)`, buckets are sorted by size
 * **descending**, and group *i* takes `SCHEME[i % 11]`.
 *
 * `null` means "nothing to colour": no property, or nothing in the pool carries it. The design
 * returns `null` and leaves the previous scheme alone in that case — only `colorBy(null)`,
 * the legend's × and a federation change clear it.
 *
 * Two edges are the design's and are easy to "fix" by accident:
 * · **rules that carry no value match nothing.** `chatMatch` (`:1269`) returns `[]` when
 *   `matchFn` is null, so a non-empty rule list with every `val` blank gives an empty pool and
 *   therefore `null` — not the whole federation.
 * · **visibility is not consulted.** `applyColors` (`:1004`) writes the colour-by layer for
 *   every id in the scheme; only the highlight layer above it filters by `vis`.
 */
export function colorBy(
  elements: readonly VisElement[],
  prop: string | null | undefined,
  rules?: readonly Rule[]
): ColorByState | null {
  if (!prop) return null
  const m = rules && rules.length ? matchFn(rules) : null
  const pool = rules && rules.length ? (m ? elements.filter(m) : []) : elements
  return schemeOver(pool, prop)
}

/**
 * The same scheme over an explicit set of elements — 2026-09-20, `color_by_property`'s `ids`
 * target. Everything below the pool is unchanged, which is the point: a colouring scoped to a
 * found set and one scoped to a rule list differ only in how the pool was named.
 */
export function colorByIds(
  elements: readonly VisElement[],
  prop: string | null | undefined,
  ids: readonly number[]
): ColorByState | null {
  if (!prop) return null
  const keep = new Set(ids)
  return schemeOver(
    elements.filter((e) => keep.has(e.id)),
    prop
  )
}

function schemeOver(pool: readonly VisElement[], prop: string): ColorByState | null {
  const buckets = new Map<string, number[]>()
  for (const e of pool) {
    const v = attr(e, prop)
    if (v === undefined || v === '') continue
    const k = String(v)
    const bucket = buckets.get(k)
    if (bucket) bucket.push(e.id)
    else buckets.set(k, [e.id])
  }
  return schemeOf(prop, buckets)
}

/** The one rule every scheme is coloured by: biggest bucket first, group *i* takes `SCHEME[i % 11]`. */
function schemeOf(prop: string, buckets: Map<string, number[]>): ColorByState | null {
  if (!buckets.size) return null
  const groups = [...buckets.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([v, ids], i) => ({ v, n: ids.length, color: SCHEME[i % SCHEME.length], ids }))
  return { prop, groups }
}

/**
 * The same scheme over values someone else has already read — 2026-09-25, the Schedules
 * window's "Colour 3D by this column", whose values are a schedule column's DISPLAYED text
 * (a calculated column, a rounded number) that no `attr` lookup could reproduce. Everything
 * after the read is `schemeOver`'s: an empty value is not a group, one value is one group
 * however many times it is named, and the biggest group takes the first colour. There is no
 * binning, no cap and no "other" group, because `colorBy` has none.
 */
export function colorByGroups(
  prop: string,
  groups: readonly { value: string; ids: readonly number[] }[]
): ColorByState | null {
  const buckets = new Map<string, number[]>()
  for (const g of groups) {
    if (g.value === '' || !g.ids.length) continue
    const bucket = buckets.get(g.value)
    if (bucket) bucket.push(...g.ids)
    else buckets.set(g.value, [...g.ids])
  }
  return prop ? schemeOf(prop, buckets) : null
}

/**
 * Each element's **IFC class** colour, as `id → hex` — 2026-09-24, what "Original materials"
 * off shows (owner: *"The toggle off are suppose to be coloured in different ifcentity."*).
 *
 * It is `colorBy(elements, 'IfcEntity')` over the whole federation and nothing else, so an
 * element gets exactly the colour the assistant's colour-by-entity would give it: the toggle
 * and the tool can never disagree about what a wall looks like.
 */
export function classColors(elements: readonly VisElement[]): Record<number, string> {
  const out: Record<number, string> = {}
  for (const g of colorBy(elements, 'IfcEntity')?.groups ?? []) for (const id of g.ids) out[id] = g.color
  return out
}
