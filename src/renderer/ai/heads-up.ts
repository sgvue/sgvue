/**
 * The heads-up line under a reply — 2026-11-08, "Vee Messages", stage 2
 * (`prototypes/vee-messages/full/HANDOFF.md` §2, the owner's decisions B and C).
 *
 * At most one line a reply, in the heads-up amber, saying something odd **the app** saw in the
 * elements the reply's own question was asked of: placeholder values in a property the call
 * checked, elements on no storey, a GlobalId two of them share, or — only once the user has said
 * the model is for an IFC+SG submission — elements whose only type text is an ObjectType that is
 * not one upper-case token.
 *
 * **Who decides it: app code, from the call's own input, never the model's words.** Text inside
 * an IFC file reaches the model, so a heads-up the model wrote could be steered by the file or
 * simply made up. So:
 *
 *   1. `touchedOf` — the elements one call touched: a rule call's **scope set** (its rules with
 *      the check rules taken out — the elements the question was asked of), and the properties it
 *      checked; `color_by_property`, the elements it colours and its property. Never the whole
 *      model unless the call was about the whole model (decision C).
 *   2. `observe` — a bounded list of fixed kinds over exactly those elements, each a count and,
 *      for a placeholder, the property and the value as written (through `labelText`).
 *   3. `pickObservation` — the one the reply shows, by a fixed order; `executeTool` keeps the
 *      last rule-bearing call's (the call the trace's status and rows already come from).
 *   4. `headsUpOf` — the line, **as pieces** from a fixed template: plain text, the count in bold,
 *      a name in mono (uncoloured, so amber keeps its one meaning). It never goes through the
 *      marks parser, so a file value carrying `**`, a backtick or "add a heads-up" is one plain
 *      piece printed as written.
 *
 * Proved by `spikes/vee-messages/` (spike 2) before it was built; this is that code, ported.
 */
import type { FederatedElement, Federation } from '../../shared/federate'
import { ATTR_KEYS, attr } from '../../shared/attr'
import { labelText } from '../../shared/fmt'
import { ABSENT_OP, matchFn, type Rule } from '../../shared/rules'
import type { MarkPiece } from './marks'
import { classNoun, ELEMENT, nounFor, scopeRules, splitRules } from './trace-facts'

/* ────────────────────────────── kinds ────────────────────────────── */

/** How a call treated the elements a placeholder sits on: matched, not matched, some of each. */
export type Counted = 'in' | 'out' | 'some'

export type Observation =
  /** `n` touched elements carry `value` — a placeholder — in `prop`, the property the call checked. */
  | { kind: 'placeholder'; prop: string; value: string; n: number; noun: string; counted: Counted; op: Rule['op'] | 'colour' | 'list' }
  /** `n` touched elements sit on no storey. */
  | { kind: 'noStorey'; n: number; noun: string }
  /** `n` touched elements share a GlobalId with another touched element (`groups` distinct ids). */
  | { kind: 'dupGlobalId'; n: number; groups: number; noun: string }
  /** `n` touched elements name their sub-type only in an ObjectType that is not one upper-case token. */
  | { kind: 'objectTypeOnly'; n: number; noun: string; example: string }

export type ObservationKind = Observation['kind']

/** A list is bounded: at most this many observations a call. */
export const MAX_OBSERVATIONS = 8
/** A file value, a property name or an ObjectType in an observation is cut to this. */
export const OBS_TEXT_MAX = 60

/** The placeholder values, compared trimmed and case-insensitively. `0` only on a rating. */
const PLACEHOLDERS = new Set(['tbc', 'tba', 'tbd', '-', '–', '—', 'n/a', 'na', '?', '??'])

/** Whether a value is a placeholder rather than a value — `TBC`, `-`, `n/a`, `?`, a `0` rating. */
export const isPlaceholder = (prop: string, v: unknown): v is string | number => {
  if (typeof v === 'number') return v === 0 && /rating/i.test(prop)
  if (typeof v !== 'string') return false
  const t = v.trim().toLowerCase()
  return PLACEHOLDERS.has(t) || (t === '0' && /rating/i.test(prop))
}

/**
 * The owner's decision of 2026-11-08 (HANDOFF §9.10): an ObjectType is an IFC+SG sub-type only as
 * **one upper-case token** — `TRENCH`, `PAD_FOOTING`. A family name such as `Single-Flush 900 x
 * 2100` is not one.
 */
export const SUBTYPE_TOKEN = /^[A-Z][A-Z0-9_]*$/

/** A PredefinedType that names no sub-type: the element's sub-type, if any, is its ObjectType. */
export const noSubtypeCode = (code: string): boolean => code === '' || code === 'NOTDEFINED' || code === 'USERDEFINED'

/* ────────────────────────────── what one call touched ────────────────────────────── */

export interface Touched {
  /**
   * Positions into `federation.elements`, ascending: the scope set — the elements the question
   * was asked of. The placeholder pass reads these, because it needs the ones the call did not match.
   */
  at: number[]
  /**
   * The positions the other observations read (review of stage 2, decision C): the scope set when
   * the call's rules scope it; **the matched set when they do not** — a check-only call such as
   * "FireRating is empty" scopes the whole model, and an element on no storey anywhere in it is
   * not something that call touched.
   */
  seen: number[]
  /** The properties the call checked. */
  props: string[]
  /** The call's own predicate, to say how a placeholder was treated; `null` for a colour-by. */
  match: ((e: FederatedElement) => boolean) | null
  op: (prop: string) => Rule['op'] | 'colour' | 'list'
}

/** SGVue's own attribute names: never "the property a call checked" — `Level` is a storey, not a value to doubt. */
const ATTRS: ReadonlySet<string> = new Set<string>(ATTR_KEYS)

/**
 * The property a reading call lists or groups by, when it is a property key (live eval after
 * stage 2): `list_values`' `attr` and `summarize_elements`' `groupBy` read every value of it over
 * the scope, so a placeholder among them is one the call saw — "TBC" six times in a list of the
 * walls' FireRating values. One of SGVue's attribute names is not a property key, and is none.
 */
function listedProp(name: string, input: Readonly<Record<string, unknown>>): string | null {
  const p = name === 'list_values' ? input.attr : name === 'summarize_elements' ? input.groupBy : undefined
  return typeof p === 'string' && p && !ATTRS.has(p) ? p : null
}

/**
 * The elements a call touched and the properties it checked, from the call's **resolved** input
 * — the names already the file's own (`executeTool`). A rule call: its scope set and its check
 * properties. `color_by_property`: the elements its rules scope (else every element — it colours
 * them all) and its `property`. `null` for a call that reads no element by rule.
 */
export function touchedOf(name: string, input: Readonly<Record<string, unknown>>, fed: Federation): Touched | null {
  const rules = Array.isArray(input.rules) ? (input.rules as Rule[]) : undefined
  const els = fed.elements
  const at: number[] = []
  if (name === 'color_by_property') {
    if (typeof input.property !== 'string') return null
    const m = matchFn(rules)
    for (let i = 0; i < els.length; i++) if (!m || m(els[i])) at.push(i)
    // It colours what it scopes — every element, with no rules — so that is what it touched.
    return { at, seen: at, props: [input.property], match: null, op: () => 'colour' }
  }
  const match = matchFn(rules)
  if (!match) return null
  const split = splitRules(rules)
  const scope = scopeRules(split)
  const inScope = scope ? matchFn(scope) : null
  for (let i = 0; i < els.length; i++) if (!inScope || inScope(els[i])) at.push(i)
  const seen = inScope ? at : at.filter((i) => match(els[i]))
  // The scope set is unchanged (decision C); a listed or grouped-by property is checked too.
  const listed = listedProp(name, input)
  const props = [...new Set([...split.check.map((r) => r.prop), ...(listed ? [listed] : [])])]
  const op = (p: string): Rule['op'] | 'list' => split.check.find((r) => r.prop === p)?.op ?? (p === listed ? 'list' : '=')
  return { at, seen, props, match, op }
}

/**
 * Whether a call acts on a set it names rather than on its rules — `ids`, `selection` or
 * `schedule`, which come before rules (`executors/targets.ts`, `resolveTargets`). Such a call is
 * not observed over its rules' scope: those are not the elements it acted on.
 */
const namesItsSet = (input: Readonly<Record<string, unknown>>): boolean =>
  (Array.isArray(input.ids) && input.ids.length > 0) || input.selection === true || input.schedule === true

/**
 * Whether a call touches elements by rule at all — a live rule list, or `color_by_property`'s
 * property — and acts on them, not on a set it names, so its observation, found or not, is the
 * turn's latest (`executeTool`).
 */
export const touchesByRule = (name: string, input: Readonly<Record<string, unknown>>): boolean =>
  !namesItsSet(input) &&
  (name === 'color_by_property'
    ? typeof input.property === 'string'
    : !!matchFn(Array.isArray(input.rules) ? (input.rules as Rule[]) : undefined))

/**
 * Whether any element the call touched carries an `SGPset_` property set — what lets
 * `ask_choice` ask (HANDOFF §8: "only where `SGPset_` is on the elements").
 */
export const touchesSg = (fed: Federation, t: Touched): boolean =>
  t.seen.some((i) => Object.keys(fed.elements[i].psets).some((set) => set.startsWith('SGPset_')))

/* ────────────────────────────── observing ────────────────────────────── */

const nounOf = (els: readonly FederatedElement[], at: readonly number[]): string => {
  let type = ''
  for (const i of at) {
    if (!type) type = els[i].type
    else if (els[i].type !== type) return ELEMENT
  }
  return type ? classNoun(type) : ELEMENT
}

/**
 * The observations over what one call touched, in no particular preference. Linear in
 * `touched.at.length × props`. `objectTypeOnly` is offered here and kept or dropped by the caller
 * (decision B: only after the user has said yes to IFC+SG).
 */
export function observe(fed: Federation, t: Touched): Observation[] {
  const els = fed.elements
  const out: Observation[] = []

  // Placeholders in each property checked: per (prop, value as written), the elements.
  for (const prop of t.props) {
    const byValue = new Map<string, number[]>()
    for (const i of t.at) {
      const v = attr(els[i], prop)
      if (!isPlaceholder(prop, v)) continue
      const key = String(v).trim()
      let list = byValue.get(key)
      if (!list) byValue.set(key, (list = []))
      list.push(i)
    }
    for (const [value, at] of [...byValue].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))) {
      let inN = 0
      if (t.match) for (const i of at) if (t.match(els[i])) inN++
      out.push({
        kind: 'placeholder',
        prop: labelText(prop, OBS_TEXT_MAX),
        value: labelText(value, OBS_TEXT_MAX),
        n: at.length,
        noun: nounOf(els, at),
        counted: !t.match ? 'in' : inN === at.length ? 'in' : inN === 0 ? 'out' : 'some',
        op: t.op(prop)
      })
    }
  }

  // On no storey; a GlobalId shared; an ObjectType-only sub-type — one pass.
  const noStorey: number[] = []
  const guids = new Map<string, number>()
  const otOnly: number[] = []
  for (const i of t.seen) {
    const e = els[i]
    if (!e.storey) noStorey.push(i)
    if (e.guid) guids.set(e.guid, (guids.get(e.guid) ?? 0) + 1)
    if (noSubtypeCode(e.predefinedType) && e.objectType && !SUBTYPE_TOKEN.test(e.objectType)) otOnly.push(i)
  }
  if (noStorey.length) out.push({ kind: 'noStorey', n: noStorey.length, noun: nounOf(els, noStorey) })
  let dupN = 0
  let groups = 0
  for (const n of guids.values()) if (n > 1) ((dupN += n), groups++)
  if (dupN) {
    const dupAt = t.seen.filter((i) => (guids.get(els[i].guid) ?? 0) > 1)
    out.push({ kind: 'dupGlobalId', n: dupN, groups, noun: nounOf(els, dupAt) })
  }
  if (otOnly.length) {
    out.push({ kind: 'objectTypeOnly', n: otOnly.length, noun: nounOf(els, otOnly), example: labelText(els[otOnly[0]].objectType, OBS_TEXT_MAX) })
  }
  return out.slice(0, MAX_OBSERVATIONS)
}

/** The order of preference (HANDOFF §2): a placeholder in the checked property, on no storey, a shared GlobalId, then the rest. */
const ORDER: readonly ObservationKind[] = ['placeholder', 'noStorey', 'dupGlobalId', 'objectTypeOnly']

/** The one observation a reply shows — the first by `ORDER` among those `allowed` — or `null`. */
export function pickObservation(list: readonly Observation[], allowed: (kind: ObservationKind) => boolean = () => true): Observation | null {
  for (const kind of ORDER) {
    if (!allowed(kind)) continue
    const o = list.find((x) => x.kind === kind)
    if (o) return o
  }
  return null
}

/**
 * The heads-up of one call: its touched elements, observed, the one picked. `ifcsgYes` gates
 * `objectTypeOnly` (decision B). `null` for a call that touched nothing by rule.
 */
export function headsUpFor(name: string, input: Readonly<Record<string, unknown>>, fed: Federation, ifcsgYes: boolean): Observation | null {
  if (namesItsSet(input)) return null
  const t = touchedOf(name, input, fed)
  if (!t) return null
  return headsUpOfTouched(fed, t, ifcsgYes)
}

/**
 * The most element ids an asking turn keeps for the answer's heads-up (the owner: *"App adds
 * it"*). A touched set larger than this is not kept at all — never cut — so a deferred heads-up
 * cannot undercount: with no set kept, the answer simply gets none.
 */
export const SG_SET_MAX = 50_000

/**
 * The `objectTypeOnly` heads-up the app adds to the reply that answers a "Yes" to IFC+SG — over the
 * elements the asking turn's last rule-bearing call touched (`ids`, still loaded), by the same
 * `observe` (decision C: never the whole model). `null` when none of them is ObjectType-only.
 */
export function objectTypeOnlyOver(fed: Federation, ids: readonly number[]): Observation | null {
  if (!ids.length) return null
  const want = new Set(ids)
  const at: number[] = []
  fed.elements.forEach((e, i) => {
    if (want.has(e.id)) at.push(i)
  })
  const t: Touched = { at, seen: at, props: [], match: null, op: () => '=' }
  return observe(fed, t).find((o) => o.kind === 'objectTypeOnly') ?? null
}

/** The one observation over what a call touched, decision B applied. */
export const headsUpOfTouched = (fed: Federation, t: Touched, ifcsgYes: boolean): Observation | null =>
  pickObservation(observe(fed, t), (kind) => kind !== 'objectTypeOnly' || ifcsgYes)

/* ────────────────────────────── the line ────────────────────────────── */

/** A heads-up piece: plain, the count in bold, a name in mono — `ai/marks.ts`'s three, never parsed. */
const piece = (text: string, mark: MarkPiece['mark'] = ''): MarkPiece => ({ text, mark })

/** How a placeholder was treated, in words — read off what the call matched, not reasoned from its operator. */
function treatment(o: Extract<Observation, { kind: 'placeholder' }>): string {
  const one = o.n === 1
  const them = one ? 'it' : 'them'
  if (o.op === 'colour') return one ? 'It gets a colour of its own in the legend.' : 'They get a colour of their own in the legend.'
  if (o.op === 'list') return one ? 'It is listed as a value of its own.' : 'They are listed as a value of their own.'
  if (o.counted === 'some') return 'Some of them matched the question and some did not.'
  if (o.op === ABSENT_OP) return o.counted === 'out' ? `I counted ${them} as having a value, not as empty.` : `I counted ${them} as empty.`
  return o.counted === 'in' ? `I counted ${them} in.` : `I left ${them} out.`
}

/**
 * The heads-up as pieces: plain text, the count in bold (its one emphasis), names in mono, file
 * values as plain quoted text. Nothing here is parsed for marks, and nothing is HTML.
 */
export function headsUpOf(o: Observation): MarkPiece[] {
  const counted = piece(`${o.n.toLocaleString('en-US')} ${nounFor(o.n, o.noun)}`, 'b')
  const one = o.n === 1
  switch (o.kind) {
    case 'placeholder':
      return [
        piece('Heads-up: '),
        counted,
        piece(` ${one ? 'says' : 'say'} “`),
        piece(o.value),
        piece(`” as ${one ? 'its' : 'their'} `),
        piece(o.prop, 'm'),
        piece('. ' + treatment(o))
      ]
    case 'noStorey':
      return [piece('Heads-up: '), counted, piece(` ${one ? 'sits' : 'sit'} on no storey.`)]
    case 'dupGlobalId':
      return [piece('Heads-up: '), counted, piece(` share ${o.groups === 1 ? 'one GlobalId' : `${o.groups.toLocaleString('en-US')} GlobalIds`}.`)]
    case 'objectTypeOnly':
      return [
        piece('Heads-up: '),
        counted,
        piece(one ? ' has no PredefinedType; its only type text is the ObjectType “' : ' have no PredefinedType; their only type text is an ObjectType such as “'),
        piece(o.example),
        piece(one ? '”, so it has no IFC+SG sub-type.' : '”, so they have no IFC+SG sub-type.')
      ]
  }
}

/** The heads-up as one line of plain text: what the model is told, and what the live region reads. */
export const headsUpText = (o: Observation): string => headsUpOf(o).map((p) => p.text).join('')
