/**
 * Filter rules — `matchFn`, `visFn` and `hlFn`, ported line for line from
 * `design-reference/design/SGVue.dc.html:938–1001`.
 *
 * Three behaviours here are easy to "improve" by accident and must not be:
 *   · A rule whose attribute is **missing** matches only `!=`. Everything else is false.
 *   · Numeric comparison applies only when both sides parse as numbers **and** the rule's
 *     own value is a bare number (`/^-?[\d.]+$/`). `"300mm"` compares as text.
 *   · **OR binds looser than AND.** Rules split into groups at each `or` join; an element
 *     matches when any one group is fully satisfied.
 *
 * One operator is **not** the design's: `absent` (2026-09-20, user-approved). The design's five
 * operators cannot say "this property has no value" — a missing attribute matches only `!=`,
 * which also matches every element carrying a *different* value, so "walls with no fire rating"
 * (2 767 of 3 314 on the reference model) was unsayable. `absent` is true when the attribute is
 * missing, null, or a string that is empty or only whitespace, and it **ignores `val`**, which
 * is why `isLiveRule` below exists: every other place in the app decides a rule is live by
 * asking whether it carries a value.
 *
 * `visFn` is a conjunction of independent predicates, so isolate/hide steps give the same
 * visibility in any order. Highlight is where order matters: `applyColors` (Phase 7) walks
 * the stack in order and lets a later step overwrite an earlier one's colour.
 */
import { attr, type AttrElement } from './attr'
import type { PropValue } from './model-index.types'

export type RuleOp = '=' | '!=' | '~' | '>' | '<' | 'absent'
export type RuleJoin = 'and' | 'or'
export type StepAction = 'isolate' | 'hide' | 'highlight'

/** The operator that ignores `val`. Named so nothing has to spell the string twice. */
export const ABSENT_OP = 'absent' as const

/**
 * How the operator reads to a person, in two lengths (2026-09-20).
 *
 * The Filter card's operator `<select>` is **64 px wide** — the design's own grid column — and
 * a two-word label is clipped there, which on the one entry the design does not have reads as
 * a defect rather than as the same clipping `contains` already takes. So the control shows
 * `empty`, and the phrase is kept everywhere there is room for it: the step row's summary and
 * badge (`ruleText`), the OR-group labels the assistant reads back, and the control's own
 * tooltip.
 */
export const ABSENT_LABEL_SHORT = 'empty'
export const ABSENT_LABEL = 'is empty'

/** No value at all: missing, null, or a string that is empty or only whitespace. */
export const isAbsentValue = (v: PropValue | undefined | null): boolean =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

/**
 * Whether a rule counts at all — the one test that used to be written out three times as
 * `r.val !== '' && r.val != null` (`matchFn`, `ruleGroups`, `liveRules`).
 *
 * `absent` carries no value by design, so it is live regardless; every other operator needs
 * one, exactly as the design has it (`SGVue.dc.html:937`).
 */
export const isLiveRule = (r: Rule): boolean =>
  r.op === ABSENT_OP || (r.val !== '' && r.val != null)

/** How a rule reads in a step label or an OR-group label: `absent` never prints a value. */
export const ruleText = (r: Rule): string =>
  r.op === ABSENT_OP ? `${r.prop} ${ABSENT_LABEL}` : `${r.prop} ${r.op} ${r.val}`

export interface Rule {
  prop: string
  op: RuleOp
  val: string | number | null
  join?: RuleJoin
}

export interface FilterStep {
  id: string
  on: boolean
  action: StepAction
  color?: string
  rules: readonly Rule[]
}

/** The element fields visibility reads, beyond what `attr` needs. */
export interface VisElement extends AttrElement {
  id: number
}

/** The slice of view state visibility is derived from (the design's `VIS_KEYS`). */
export interface VisState {
  hidden: Record<number | string, boolean>
  modelVis: Record<string, boolean>
  storeyVis: Record<string, boolean>
  stack?: readonly FilterStep[]
}

export type Predicate = (el: VisElement) => boolean

/**
 * A predicate for one rule set, or `null` when no rule carries a value.
 * `SGVue.dc.html:938`.
 */
export function matchFn(rules: readonly Rule[] | undefined): Predicate | null {
  const rs = (rules ?? []).filter(isLiveRule)
  if (!rs.length) return null

  const test = (el: VisElement, r: Rule): boolean => {
    const a = attr(el, r.prop)
    // Before the `undefined` branch, because "has no value" is exactly what it asks about —
    // and an authored empty string is as absent as a missing key to the person reading it.
    if (r.op === ABSENT_OP) return isAbsentValue(a)
    if (a === undefined) return r.op === '!='
    const as = String(a).toLowerCase()
    const bs = String(r.val).toLowerCase()
    const an = parseFloat(String(a))
    const bn = parseFloat(String(r.val))
    const num = !isNaN(an) && !isNaN(bn) && /^-?[\d.]+$/.test(String(r.val).trim())
    switch (r.op) {
      case '=':
        return num ? an === bn : as === bs
      case '!=':
        return num ? an !== bn : as !== bs
      case '~':
        return as.includes(bs)
      case '>':
        return num && an > bn
      case '<':
        return num && an < bn
    }
    return false
  }

  // OR binds looser than AND: rules split into groups at each 'or' join; a match is any
  // group fully satisfied.
  const groups: Rule[][] = []
  rs.forEach((r, i) => {
    if (i === 0 || r.join === 'or') groups.push([r])
    else groups[groups.length - 1].push(r)
  })
  return (el) => groups.some((g) => g.every((r) => test(el, r)))
}

/**
 * The one visibility predicate. An element is visible when it is not hidden by hand, its
 * model is on, its storey is on, and every enabled isolate/hide step accepts it.
 * `SGVue.dc.html:975`.
 */
export function visFn(s: VisState): Predicate {
  const steps = (s.stack ?? [])
    .filter((x) => x.on && x.action !== 'highlight')
    .map((x) => ({ a: x.action, m: matchFn(x.rules) }))
    .filter((x): x is { a: StepAction; m: Predicate } => !!x.m)
  return (el) => {
    if (s.hidden[el.id] || s.modelVis[el.model] === false || s.storeyVis[el.storey] === false)
      return false
    for (const st of steps) {
      if (st.a === 'isolate' && !st.m(el)) return false
      if (st.a === 'hide' && st.m(el)) return false
    }
    return true
  }
}

/** Matched-by-any-highlight-step, or `null` when no highlight step is active. `:987`. */
export function hlFn(s: VisState): Predicate | null {
  const ms = (s.stack ?? [])
    .filter((x) => x.on && x.action === 'highlight')
    .map((x) => matchFn(x.rules))
    .filter((m): m is Predicate => !!m)
  return ms.length ? (el) => ms.some((m) => m(el)) : null
}
