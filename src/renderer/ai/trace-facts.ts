/**
 * What one turn's tool calls contribute to the thinking trace — the facts (2026-10-01, the
 * owner's "Ask Vee" handoff, `design-reference/ask-vee/`). Pure: a tool's name, its **resolved**
 * input and the federation in; counts, words and element positions out. No DOM, no store, no
 * clock — `ai/trace.ts` turns these into a timeline and a frame, `app/Trace.tsx` draws it.
 *
 * The handoff runs a scripted scenario: read 412 elements, filter 86 walls, find 9 with no fire
 * rating. Here the same three steps come from what the assistant really did:
 *
 *   **Read**    the federation — its models and its element count.
 *   **Filter**  a tool call's *scope rules*: the rules on `Model`, `IfcEntity`, `PredefinedType`,
 *               `ObjectType` and `Level` — which elements the question is about.
 *   **Check**   its *check rules*: every other rule, a property — what is asked of them.
 *
 * A call with no rule says what it is doing in the busy row's own words (`TOOL_STAGE`), and the
 * matrix does not change. Since 2026-10-02 those words can depend on the call (`toolPhrase`):
 * clearing the selection and undoing are not what their tools' one phrase says.
 *
 * **Every number is real.** The scope set is the elements matching the rule list with the check
 * rules taken out; the matched set is `matchFn(rules)` over the whole federation — the predicate
 * the executor itself uses. Nothing is estimated, sampled or rounded.
 */
import { ruleGroups } from '../../shared/ai-schema'
import type { Federation } from '../../shared/federate'
import { DASH, group } from '../../shared/fmt'
import { ABSENT_OP, matchFn, type Rule } from '../../shared/rules'
import { prettyKey } from '../state/selectors/props'
import { toolPhrase } from './stages'

/* ────────────────────────────── scope and check ────────────────────────────── */

/**
 * The built-in properties that say *which* elements a question is about. A rule on one of these
 * is a scope rule; a rule on anything else — a property key, `Name`, `Material` — is a check.
 */
export const SCOPE_PROPS: readonly string[] = ['Model', 'IfcEntity', 'PredefinedType', 'ObjectType', 'Level']

export const isScopeRule = (r: Rule): boolean => SCOPE_PROPS.includes(r.prop)

/** A rule list split in two, OR group by OR group (`ruleGroups`: only live rules count). */
export interface RuleSplit {
  /** Each OR group's scope rules and check rules, in the order they were written. */
  groups: { scope: Rule[]; check: Rule[] }[]
  /** Every scope rule, and every check rule. */
  scope: Rule[]
  check: Rule[]
}

export function splitRules(rules: readonly Rule[] | undefined): RuleSplit {
  const groups = ruleGroups(rules).map((g) => ({
    scope: g.filter(isScopeRule),
    check: g.filter((r) => !isScopeRule(r))
  }))
  return {
    groups,
    scope: groups.flatMap((g) => g.scope),
    check: groups.flatMap((g) => g.check)
  }
}

/**
 * The rule list with its check rules removed, as a list `matchFn` reads the same way — or
 * `null` when it matches everything: an OR group left with no rule is satisfied by every
 * element, and OR binds looser than AND.
 */
export function scopeRules(split: RuleSplit): Rule[] | null {
  if (!split.groups.length || split.groups.some((g) => !g.scope.length)) return null
  return split.groups.flatMap((g, gi) =>
    g.scope.map((r, i): Rule => ({ ...r, join: i === 0 && gi > 0 ? 'or' : 'and' }))
  )
}

/* ────────────────────────────── words ────────────────────────────── */

/** `wall` → `walls`, `proxy` → `proxies`, `box` → `boxes`: the last word of a noun made plural. */
export function pluralOf(noun: string): string {
  if (/[^aeiou]y$/.test(noun)) return noun.slice(0, -1) + 'ies'
  if (/(s|x|z|ch|sh)$/.test(noun)) return noun + 'es'
  return noun + 's'
}

/** The noun for `n` of something: `1 wall`, `86 walls`, `0 walls`. */
export const nounFor = (n: number, noun: string): string => (n === 1 ? noun : pluralOf(noun))

/** What an unnamed class is counted in. */
export const ELEMENT = 'element'

/**
 * An IFC class as the noun it is counted in: `IfcWall` → `wall`,
 * `IfcBuildingElementProxy` → `building element proxy`. The `Ifc` prefix goes, camel case
 * becomes words, lower case throughout.
 */
export function classNoun(entity: string): string {
  const words = entity
    .replace(/^ifc/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase()
  return words || ELEMENT
}

/** A count as the panel prints one: grouped the way the boot audit groups its own (`1,234`). */
export const countText = group

/**
 * `totalling quantities` → `Totalling quantities`: a note step, in the busy row's own words.
 * `input` is the call's own (2026-10-02): two tools do things their one phrase would misstate —
 * `select_elements` clearing the selection, `apply_visibility` undoing — and `toolPhrase` reads
 * the input for those. Without one, it is the tool's phrase.
 */
export function noteFor(tool: string, input?: Readonly<Record<string, unknown>> | null): string {
  const phrase = toolPhrase(tool, input) ?? `running ${tool}`
  return phrase.charAt(0).toUpperCase() + phrase.slice(1)
}

/** At most two names in full; more than that is counted. */
const upToTwo = (names: readonly string[], counted: string): string =>
  names.length <= 2 ? names.join(', ') : `${names.length} ${counted}`

/** One scope rule's value as the ticker words it: the value, with its operator when not `=`. */
function scopeValue(r: Rule): string {
  if (r.op === ABSENT_OP) return `no ${prettyKey(r.prop)}`
  const v = String(r.val)
  return r.op === '=' ? v : r.op === '!=' ? `≠ ${v}` : `${r.op} ${v}`
}

/* ────────────────────────────── the facts ────────────────────────────── */

/** One row under an answer: a storey, how many matches it holds, and which. */
export interface TraceRowData {
  /** The storey's name, or the design's em dash for elements on none. */
  label: string
  n: number
  /** Federation ids, for a click on the row. */
  ids: number[]
  /** The same elements as positions in the read order, for the cells that fly into the row. */
  at: number[]
}

/** The federation as the trace reads it: element counts per model, in order, and their sum. */
export interface ReadFacts {
  /** One entry per loaded model that has elements, in the federation's own order. */
  models: number[]
  total: number
}

export interface RuleFacts extends ReadFacts {
  /** `Filtering {what}` and its count — `null` when the call has no scope rule. */
  filter: { what: string; count: number; noun: string } | null
  /** `Checking {props}` and its count — `null` when it has no check rule. */
  check: { props: string; count: number; unit: 'missing' | 'found' } | null
  /**
   * The scope set as ascending positions in the read order (an index into the federation's
   * element list), or `null` when there is no scope rule: everything.
   */
  scope: number[] | null
  /** The matched set, the same way. Always within the scope set. */
  matched: number[]
  /** How many elements the scope holds — the whole federation without a scope rule. */
  scopeCount: number
  /** What the scope is counted in: the Filter's noun, else `element`. Singular. */
  noun: string
  /** One row per storey holding a match, in the federation's storey order; unnamed last. */
  rows: TraceRowData[]
}

/** What one executed tool call shows. */
export interface ToolFacts {
  name: string
  /** A call without rules: its stage phrase, capitalised. */
  note: string
  /** A call whose input has a top-level `rules` array with a live rule; else `null`. */
  rules: RuleFacts | null
}

export function readFacts(federation: Federation): ReadFacts {
  const counts = new Map<string, number>()
  for (const e of federation.elements) counts.set(e.model, (counts.get(e.model) ?? 0) + 1)
  return {
    // A `Map` keeps first-insertion order, and the federation lists its elements model by model.
    models: [...counts.values()],
    total: federation.elements.length
  }
}

/** The federation's own spelling of a class the rule may have written in another case. */
function classSpelling(federation: Federation, value: string): string {
  const lower = value.toLowerCase()
  for (const type of Object.keys(federation.counts.byType)) if (type.toLowerCase() === lower) return type
  return value
}

/**
 * The facts of one executed tool call. `input` is the executor's own — after `resolveNames`, so
 * a property is spelled as the file spells it.
 */
export function toolFacts(
  name: string,
  input: Readonly<Record<string, unknown>>,
  federation: Federation
): ToolFacts {
  const note = noteFor(name, input)
  const rules = Array.isArray(input.rules) ? (input.rules as Rule[]) : undefined
  const match = matchFn(rules)
  if (!match) return { name, note, rules: null }

  const split = splitRules(rules)
  const scoped = scopeRules(split)
  const inScope = scoped ? matchFn(scoped) : null
  const elements = federation.elements

  const scope: number[] | null = inScope ? [] : null
  const matched: number[] = []
  for (let i = 0; i < elements.length; i++) {
    const e = elements[i]
    if (inScope?.(e)) scope!.push(i)
    if (match(e)) matched.push(i)
  }
  const scopeCount = scope ? scope.length : elements.length

  /* ── Filter ── */
  // Only when the scope really narrows: `IfcEntity = IfcWall OR FireRating is empty` has a
  // scope rule and a scope of everything, and "Filtering IfcWall · 412 elements" would be false.
  let filter: RuleFacts['filter'] = null
  let noun = ELEMENT
  if (scope) {
    const named = (r: Rule): boolean => r.prop === 'IfcEntity' && r.op === '='
    const classes = [
      ...new Set(split.scope.filter(named).map((r) => classSpelling(federation, String(r.val))))
    ]
    // The class is the noun only when every OR group names one outright, and all name the same.
    const outright =
      split.groups.every((g) => g.scope.some(named)) &&
      split.scope.every((r) => r.prop !== 'IfcEntity' || r.op === '=')
    if (classes.length === 1 && outright) noun = classNoun(classes[0])
    filter = {
      what: classes.length ? upToTwo(classes, 'classes') : scopeValue(split.scope[0]),
      count: scopeCount,
      noun
    }
  }

  /* ── Check ── */
  let check: RuleFacts['check'] = null
  if (split.check.length) {
    const props = [...new Set(split.check.map((r) => prettyKey(r.prop)))]
    check = {
      props: upToTwo(props, 'properties'),
      count: matched.length,
      unit: split.check.every((r) => r.op === ABSENT_OP) ? 'missing' : 'found'
    }
  }

  return {
    name,
    note,
    rules: {
      ...readFacts(federation),
      filter,
      check,
      scope,
      matched,
      scopeCount,
      noun,
      rows: storeyRows(federation, matched)
    }
  }
}

/**
 * The matched elements by storey: one row per storey that holds any, in `federation.storeys`
 * order; a storey name the federation's ladder does not carry follows in the order it is met,
 * and elements on no storey come last, under the design's em dash.
 */
export function storeyRows(federation: Federation, matched: readonly number[]): TraceRowData[] {
  const rank = new Map<string, number>()
  federation.storeys.forEach((s, i) => {
    if (s.name && !rank.has(s.name)) rank.set(s.name, i)
  })
  const rows = new Map<string, TraceRowData>()
  for (const at of matched) {
    const e = federation.elements[at]
    const key = e.storey || ''
    if (key && !rank.has(key)) rank.set(key, federation.storeys.length + rank.size)
    let row = rows.get(key)
    if (!row) rows.set(key, (row = { label: key || DASH, n: 0, ids: [], at: [] }))
    row.n++
    row.ids.push(e.id)
    row.at.push(at)
  }
  const order = (key: string): number => (key ? rank.get(key)! : Number.POSITIVE_INFINITY)
  return [...rows.entries()].sort((a, b) => order(a[0]) - order(b[0])).map(([, row]) => row)
}

/* ────────────────────────────── the rows under an answer ────────────────────────────── */

/** Rows under one answer, at most. */
export const ROW_CAP = 8

/**
 * At most eight rows: beyond that the eighth is `+{k} more levels`, with what they hold summed.
 */
export function capRows(rows: readonly TraceRowData[], cap = ROW_CAP): TraceRowData[] {
  if (rows.length <= cap) return [...rows]
  const rest = rows.slice(cap - 1)
  return [
    ...rows.slice(0, cap - 1),
    {
      label: `+${rest.length} more levels`,
      n: rest.reduce((sum, r) => sum + r.n, 0),
      ids: rest.flatMap((r) => r.ids),
      at: rest.flatMap((r) => r.at)
    }
  ]
}

/* ────────────────────────────── what a finished reply keeps ────────────────────────────── */

/** What the turn's trace leaves on its reply (`ChatMessage.trace`). */
export interface ChatTrace {
  /** `checked 86 walls · 7s`, `found 12 doors · 3s`, or `4s`. */
  status: string
  /** The turn opened the trace bubble, so the reply stays full width. */
  wide: boolean
  /** One row per storey that holds a match — at most eight — or none. */
  rows: { label: string; n: number; ids: number[] }[]
  /** What a row counts, singular: `wall`, `element`. */
  noun: string
}

/**
 * The status a finished turn rolls to, beside the name.
 *
 *   a Check step ran          `checked {scope count} {scope noun} · {s}s`
 *   only a Filter step ran    `found {count} {noun} · {s}s`
 *   neither                   `{s}s`
 *
 * `rules` is the turn's **last** rule-bearing call — the one its rows come from — and `seconds`
 * what passed between Send and the answer: whole seconds, to the nearest, at least 1.
 */
export function statusText(rules: RuleFacts | null, seconds: number): string {
  const s = `${Math.max(1, Math.round(seconds))}s`
  if (!rules) return s
  const scope = `${countText(rules.scopeCount)} ${nounFor(rules.scopeCount, rules.noun)}`
  if (rules.check) return `checked ${scope} · ${s}`
  if (rules.filter) return `found ${scope} · ${s}`
  return s
}
