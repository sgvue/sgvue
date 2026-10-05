/**
 * Property names and yes/no values in a tool's input, matched to the file's own — 2026-09-28.
 *
 * The owner's words: *"Sometimes when i ask it check area with includesGFA, it never check the
 * shared parameters Includes As GFA."* The file authors `Includes As GFA`; the assistant guessed
 * `includesGFA`; `attr()` is an exact lookup (the design's, and the Filter card's), so the rule
 * matched nothing — or, with `!=` or `absent`, matched **everything**, which is worse.
 *
 * `executeTool` runs every input through `resolveNames` before any executor sees it, so there
 * is one place this happens and no tool can forget it:
 *
 *   · a rule's `prop` (in `rules` and in `steps[].rules`), `groupBy`, `property` and `attr` are
 *     rewritten to the file's key when `resolveKey` is certain — so the Filter card, a saved
 *     filter set and a share link carry the file's own spelling;
 *   · a yes/no `val` on `=` / `!=` is rewritten to the spelling the key stores;
 *   · a name that is still not a key is collected, and `reportNames` hands the model the keys
 *     nearest to it instead of the first forty in file order.
 *
 * Nothing here touches the store.
 */
import { attr } from '../../../shared/attr'
import {
  ambiguousText,
  booleanSpelling,
  booleanWord,
  nearestKeys,
  resolveKey
} from '../../../shared/prop-names'
import { ABSENT_OP, isLiveRule, ruleText, type Rule } from '../../../shared/rules'
import type { FederatedElement } from '../../../shared/federate'
import type { ShellState } from '../../state/shell'
import { chatMatch } from './context'

/** Keys offered for one name that is not a key. */
export const NEAREST_CAP = 8
/** Values listed for a key whose rule matched nothing. */
export const TOP_VALUES_CAP = 15

/** The input fields that name one property. Every other field is left exactly as it came. */
const KEY_FIELDS = ['groupBy', 'property', 'attr'] as const

export interface NameReport {
  input: Record<string, unknown>
  /** Asked name → the file's key, for every name that was rewritten. */
  resolvedKeys: Record<string, string>
  /** The file's key → asked value → the stored spelling, for every value that was rewritten. */
  resolvedValues: Record<string, Record<string, string>>
  /** Names that are still not a key, in the order they were met. */
  unknown: string[]
  /** Of those, each name that normalises to two or more keys → those keys (2026-09-28). */
  ambiguous: Record<string, string[]>
}

/** Distinct stored spellings of one key over the federation, with how many carry each. */
export function valueCounts(
  elements: readonly FederatedElement[],
  key: string
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const e of elements) {
    const v = attr(e, key)
    if (v === undefined || v === '') continue
    const text = String(v)
    counts.set(text, (counts.get(text) ?? 0) + 1)
  }
  return counts
}

/** The commonest entries of a count map, largest first, then in string order — and the cut. */
export function topOf(
  counts: ReadonlyMap<string, number>,
  cap: number
): { values: { value: string; count: number }[]; distinct: number; truncated: boolean } {
  const all = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return {
    values: all.slice(0, cap).map(([value, count]) => ({ value, count })),
    distinct: all.length,
    truncated: all.length > cap
  }
}

/**
 * Rewrite every property name — and every yes/no value on `=` / `!=` — in one tool's input to
 * the file's own. Returns a new input; the one passed in is not changed.
 */
export function resolveNames(input: Record<string, unknown>, s: ShellState): NameReport {
  const keys = s.propKeys
  const report: NameReport = {
    input: { ...input },
    resolvedKeys: {},
    resolvedValues: {},
    unknown: [],
    ambiguous: {}
  }
  const spellings = new Map<string, string[]>()
  const storedOf = (key: string): string[] => {
    let list = spellings.get(key)
    if (!list) spellings.set(key, (list = [...valueCounts(s.federation.elements, key).keys()]))
    return list
  }

  const name = (asked: string): string => {
    const r = resolveKey(asked, keys)
    if (r.key === null) {
      if (asked && !report.unknown.includes(asked)) report.unknown.push(asked)
      if (asked && r.candidates.length > 1) report.ambiguous[asked] = r.candidates
      return asked
    }
    if (r.key !== asked) report.resolvedKeys[asked] = r.key
    return r.key
  }

  const rule = (r: Rule): Rule => {
    const prop = name(String(r.prop ?? ''))
    let val = r.val
    // Only a yes/no word is ever mapped, so only then is the key's value list worth reading.
    if ((r.op === '=' || r.op === '!=') && keys.includes(prop) && booleanWord(val) !== null) {
      const stored = booleanSpelling(val, storedOf(prop))
      if (stored !== null) {
        ;(report.resolvedValues[prop] ??= {})[String(val)] = stored
        val = stored
      }
    }
    return { ...r, prop, val }
  }
  const rules = (v: unknown): unknown => (Array.isArray(v) ? (v as Rule[]).map(rule) : v)

  const out = report.input
  if ('rules' in out) out.rules = rules(out.rules)
  if (Array.isArray(out.steps)) {
    out.steps = (out.steps as Record<string, unknown>[]).map((st) =>
      st && typeof st === 'object' && 'rules' in st ? { ...st, rules: rules(st.rules) } : st
    )
  }
  for (const f of KEY_FIELDS) if (typeof out[f] === 'string') out[f] = name(out[f] as string)
  return report
}

/* ────────────────────────────── what a miss says ────────────────────────────── */

export interface KeyHint {
  /** Each name that is not a key → the keys most like it, best first. */
  nearest: Record<string, string[]>
  /** Each name that is two keys at once → those keys; the sentence says "say which". */
  ambiguous?: Record<string, string[]>
  /** How many property names the federation has in all. */
  total: number
  /** Always true when `total` is more than was listed for a name. */
  truncated: boolean
}

export function keyHint(
  unknown: readonly string[],
  keys: readonly string[],
  ambiguous: Readonly<Record<string, string[]>> = {}
): KeyHint {
  const nearest: Record<string, string[]> = {}
  for (const asked of unknown) nearest[asked] = nearestKeys(asked, keys, NEAREST_CAP)
  const two = Object.keys(ambiguous).length ? { ambiguous: { ...ambiguous } } : {}
  return {
    nearest,
    ...two,
    total: keys.length,
    truncated: Object.values(nearest).some((n) => n.length < keys.length)
  }
}

/**
 * One sentence per name. A name that is two keys at once says so and asks which (2026-09-28
 * review follow-up) — it is a property name, just not one name.
 */
export const keyHintText = (h: KeyHint): string =>
  Object.entries(h.nearest)
    .map(([asked, near]) =>
      h.ambiguous?.[asked]
        ? ambiguousText(asked, h.ambiguous[asked])
        : `"${asked}" is not a property name in this federation — nearest: ${near.join(', ')}.`
    )
    .join(' ') + ` ${h.total} names in all; find_properties searches them.`

/** A key whose rule matched nothing on its own, and what that key does carry. */
export interface ValueHint {
  prop: string
  rule: string
  values: { value: string; count: number }[]
  distinct: number
  truncated: boolean
}

/**
 * For a rule list that matched nothing: every rule whose key **is** a key but which matched
 * nothing on its own, with that key's commonest values — `Includes As GFA: true (812), …` — so
 * a wrong value costs one round, not a guess. A name that is not a key is `reportNames`' job.
 */
export function valueHints(
  rules: readonly Rule[] | undefined,
  s: ShellState
): { topValues?: ValueHint[]; text: string } {
  const els = s.federation.elements
  const hints: ValueHint[] = []
  for (const r of rules ?? []) {
    if (!isLiveRule(r) || r.op === ABSENT_OP) continue
    if (!s.propKeys.includes(r.prop) || hints.some((h) => h.prop === r.prop)) continue
    if (chatMatch(els, [{ ...r, join: undefined }]).length) continue
    hints.push({ prop: r.prop, rule: ruleText(r), ...topOf(valueCounts(els, r.prop), TOP_VALUES_CAP) })
  }
  if (!hints.length) return { text: '' }
  const text = hints
    .map(
      (h) =>
        `Nothing has ${h.rule}; ${h.prop} carries ${h.values.map((v) => `${v.value} (${v.count})`).join(', ')}` +
        (h.truncated ? `, … ${h.distinct - h.values.length} more values` : '') +
        '.'
    )
    .join(' ')
  return { topValues: hints, text }
}

/** How many elements in the whole federation carry a key — for "none of *these* carry it". */
export const carriedInFederation = (s: ShellState, key: string): number => {
  let n = 0
  for (const e of s.federation.elements) {
    const v = attr(e, key)
    if (v !== undefined && v !== '') n++
  }
  return n
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Fold what `resolveNames` did into the result the model reads: `resolvedKeys`,
 * `resolvedValues`, and — for a name that is still not a key, on **any** tool, because a
 * `!=` or `absent` rule over a missing key matches everything rather than nothing — the
 * nearest keys under `valid_values.propKeys`, with a sentence on the end of `message`.
 */
export function reportNames(forModel: unknown, names: NameReport, s: ShellState): unknown {
  const hasKeys = Object.keys(names.resolvedKeys).length > 0
  const hasValues = Object.keys(names.resolvedValues).length > 0
  if (!isRecord(forModel) || (!hasKeys && !hasValues && !names.unknown.length)) return forModel
  const out: Record<string, unknown> = { ...forModel }
  const notes: string[] = []
  if (hasKeys) {
    out.resolvedKeys = names.resolvedKeys
    notes.push(
      'Property names were read as the file spells them: ' +
        Object.entries(names.resolvedKeys)
          .map(([a, k]) => `${a} → ${k}`)
          .join(', ') +
        '.'
    )
  }
  if (hasValues) {
    out.resolvedValues = names.resolvedValues
    notes.push(
      'Values were read as the file stores them: ' +
        Object.entries(names.resolvedValues)
          .flatMap(([k, m]) => Object.entries(m).map(([a, v]) => `${k} ${a} → ${v}`))
          .join(', ') +
        '.'
    )
  }
  if (names.unknown.length && (out.valid_values === undefined || isRecord(out.valid_values))) {
    const hint = keyHint(names.unknown, s.propKeys, names.ambiguous)
    out.valid_values = { ...((out.valid_values as Record<string, unknown>) ?? {}), propKeys: hint }
    notes.push(keyHintText(hint))
  }
  if (typeof out.message === 'string') out.message = `${out.message} ${notes.join(' ')}`
  return out
}
