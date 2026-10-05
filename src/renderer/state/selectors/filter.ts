/**
 * The Filter card's derived values — `SGVue.dc.html:1876–1897` and `:1997–2007`, plus
 * `applyColors` (`:1001`), as pure functions.
 *
 * Two rules the card makes visible, and both are the design's:
 *
 * · **Counts are federation-wide.** `renderVals` builds the stack rows, the value lists and
 *   `matchCount` from `els` — every element — not from `lels`, the activate-scoped list the
 *   sidebar uses (`:1783`, `:1786`). A filter written while one model is active still says how
 *   many elements it matches across the whole federation.
 * · **A later highlight step wins.** `applyColors` walks the stack in order and overwrites, so
 *   where two highlight steps overlap the element takes the *later* step's colour. Visibility
 *   is a conjunction and therefore order-independent; colour is not.
 */
import { attr, type AttrElement } from '../../../shared/attr'
import { FIXED_INK, HL, type ColorByState } from '../../../shared/colors'
import { stepLabel } from '../../../shared/filter-stack'
import { ABSENT_OP, matchFn, type FilterStep, type Predicate, type Rule, type VisElement } from '../../../shared/rules'
import { on, type OnOff } from './status'

/** How many distinct values the rule builder's datalist offers. `SGVue.dc.html:1879`. */
export const VALUE_LIST_CAP = 60

export interface StackRow {
  id: string
  n: string
  label: string
  count: string
  action: string
  on: boolean
  edge: string
  bg: string
  opacity: number
  aFg: string
  aBg: string
  eyeFg: string
}

/**
 * `SGVue.dc.html:1883–1897`. The badge's ink is a **fixed** `#0F1516` on a highlight step,
 * never `--ground`: `HL` is the same hex in both themes, so a theme token would go invisible
 * in one of them (BUILD_PLAN pitfall 7, and the design's own comment at `:1888`).
 */
export function stackRows(
  stack: readonly FilterStep[],
  elements: readonly VisElement[],
  selectedId: string | null
): StackRow[] {
  return stack.map((x, i) => {
    const m = matchFn(x.rules)
    const n2 = m ? elements.filter(m).length : 0
    const isSel = x.id === selectedId
    return {
      id: x.id,
      n: String(i + 1),
      label: stepLabel(x),
      count: String(n2),
      action: x.action,
      on: x.on,
      edge: isSel ? 'var(--accent)' : 'transparent',
      bg: isSel ? 'var(--sel-bg)' : 'transparent',
      opacity: x.on ? 1 : 0.45,
      aFg: x.on ? (x.action === 'highlight' ? FIXED_INK : 'var(--sel-ink)') : 'var(--faint)',
      aBg: x.on ? (x.action === 'highlight' ? (x.color ?? HL[0]) : 'var(--sel-bg)') : 'var(--step-bg)',
      eyeFg: x.on ? 'var(--accent-ink)' : 'var(--faint)'
    }
  })
}

/**
 * The distinct values of one property across the federation, sorted and capped.
 * `SGVue.dc.html:1879` — default (lexicographic) sort, `String()` of whatever `attr` answers,
 * `undefined` dropped, first 60 kept.
 */
export function valueOptions(elements: readonly AttrElement[], prop: string): string[] {
  const seen = new Set<string>()
  for (const e of elements) {
    const v = attr(e, prop)
    if (v !== undefined) seen.add(String(v))
  }
  return [...seen].sort().slice(0, VALUE_LIST_CAP)
}

/**
 * `valueOptions`, remembered per federation and property. The card re-derives its rule rows
 * on every keystroke in a value field; the lists only change when the federation does, and a
 * federation's element array is frozen and replaced, never edited, so it is the cache key.
 */
const valueCache = new WeakMap<readonly AttrElement[], Map<string, string[]>>()
function cachedValueOptions(elements: readonly AttrElement[], prop: string): string[] {
  let byProp = valueCache.get(elements)
  if (!byProp) valueCache.set(elements, (byProp = new Map()))
  let values = byProp.get(prop)
  if (!values) byProp.set(prop, (values = valueOptions(elements, prop)))
  return values
}

export interface RuleRow extends Rule {
  listId: string
  values: string[]
  first: boolean
  notFirst: boolean
  joinLabel: string
  /** The operator ignores `val`, so the card's value field is inert. 2026-09-20. */
  valueUnused: boolean
}

/** `SGVue.dc.html:1878–1882`, minus the handlers the component binds. */
export function ruleRows(
  rules: readonly Rule[],
  elements: readonly AttrElement[]
): RuleRow[] {
  return rules.map((r, i) => ({
    ...r,
    listId: 'fv' + i,
    values: cachedValueOptions(elements, r.prop),
    first: i === 0,
    notFirst: i > 0,
    joinLabel: r.join === 'or' ? 'OR' : 'AND',
    valueUnused: r.op === ABSENT_OP
  }))
}

/** `SGVue.dc.html:2001`. One-based, from the step's place in the stack. */
export const stepTitle = (stack: readonly FilterStep[], step: FilterStep | null): string =>
  step ? `Step ${stack.findIndex((x) => x.id === step.id) + 1} conditions` : ''

/** `SGVue.dc.html:2002`. The ring marks the step's own colour. */
export const hlColorChips = (
  step: FilterStep | null
): { c: string; ring: string }[] =>
  HL.map((c) => ({ c, ring: step && c === step.color ? 'var(--ink)' : 'transparent' }))

/** `SGVue.dc.html:2003` (`fm`). */
export const actionFlags = (step: FilterStep | null): Record<'isolate' | 'hide' | 'highlight', OnOff> => ({
  isolate: on(!!step && step.action === 'isolate'),
  hide: on(!!step && step.action === 'hide'),
  highlight: on(!!step && step.action === 'highlight')
})

/** `SGVue.dc.html:2006` (`ft`) — the step on/off pill. */
export function stepToggle(step: FilterStep | null): {
  label: string
  line: string
  bg: string
  fg: string
} {
  const live = !!step && step.on
  return {
    label: live ? 'step on' : 'step off',
    line: live ? 'var(--accent)' : 'var(--border)',
    bg: live ? 'var(--sel-bg)' : 'transparent',
    fg: live ? 'var(--sel-ink)' : 'var(--muted)'
  }
}

/** `SGVue.dc.html:2005`. How many elements the *selected* step's rules match. */
export function matchCount(step: FilterStep | null, elements: readonly VisElement[]): number {
  const m = step ? matchFn(step.rules) : null
  return m ? elements.filter(m).length : 0
}

/**
 * `applyColors` (`SGVue.dc.html:1001–1011`) — one `id → hex` map for the whole federation.
 *
 * The **colour-by-property scheme is the layer underneath**: every id it names takes its
 * group's colour, with no visibility filter (`:1004` has none). Each **enabled highlight** step
 * then writes its colour over every element it matches *and* that is visible, in stack order —
 * which is what makes a later step win. `setModelColors` and the native materials sit below
 * both, inside the renderer (`BUILD_PLAN.md` §1.4).
 */
export function elementColors(
  elements: readonly VisElement[],
  stack: readonly FilterStep[],
  vis: Predicate,
  scheme?: ColorByState | null
): Record<number, string> {
  const map: Record<number, string> = {}
  if (scheme) for (const g of scheme.groups) for (const id of g.ids) map[id] = g.color
  for (const step of stack) {
    if (!step.on || step.action !== 'highlight') continue
    const m = matchFn(step.rules)
    if (!m) continue
    for (const e of elements) if (m(e) && vis(e)) map[e.id] = step.color ?? HL[0]
  }
  return map
}

