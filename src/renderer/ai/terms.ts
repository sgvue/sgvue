/**
 * IFC terms in Vee's text — 2026-11-08, "Vee Messages", stage 2 (`prototypes/vee-messages/full/
 * HANDOFF.md` §7; the owner: *"simplify it to the max"*).
 *
 * Vee writes an IFC term in its `` `code` `` mark (`ai/marks.ts`, the mono face), and **the app**
 * colours that span — one colour, `.ifc-term` — only when its text is, exactly and case for case,
 * a name the loaded models carry: an IFC class, a PredefinedType or ObjectType value, a
 * property-set or property name, or an `Entity.SUBTYPE` / `Entity.SUBTYPE*` identity label both of
 * whose halves are. Anything else stays plain mono. **The model never picks a colour**, and a
 * near miss — `Fire Rating` for `FireRating`, `ifcwall` — is not one.
 *
 * Decision D: the everyday names SGVue's own rule grammar uses for an element's attributes —
 * `Name`, `Level`, `Model`, `Material` and the rest of `ATTR_KEYS` — are never coloured, whatever a
 * file calls its properties. They are not names the file authored.
 *
 * The lookup runs in the main window, where the vocabulary is. **What crosses the port is the
 * ordinals of the coloured spans** — the k-th code span in the order the reply renders them — not
 * character offsets: both windows split the same text with the same parser (`ai/blocks.ts`, then
 * `splitMarks` per line, item or cell), so the k-th code span is the same span on both sides.
 *
 * Proved by `spikes/vee-messages/` (spike 3) before it was built; this is that code, ported.
 */
import type { Federation } from '../../shared/federate'
import { ATTR_KEYS } from '../../shared/attr'
import { parseBlocks, type Block } from './blocks'
import { splitMarks } from './marks'
import { noSubtypeCode, SUBTYPE_TOKEN } from './heads-up'

/** A value never coloured however a file spells it: a number, punctuation, one character. */
const NOT_A_TERM = /^[\d\s\W]*$|^.$/

/** Decision D: SGVue's own attribute names. */
const EVERYDAY: ReadonlySet<string> = new Set<string>(ATTR_KEYS)

export interface Vocabulary {
  terms: ReadonlySet<string>
  /** `Entity.SUBTYPE` halves: entity names, and sub-type values (PredefinedType codes, ObjectType tokens). */
  entities: ReadonlySet<string>
  subtypes: ReadonlySet<string>
}

/** The loaded models' own names. Built once per federation (`vocabularyFor`). */
export function vocabularyOf(fed: Pick<Federation, 'elements'>): Vocabulary {
  const terms = new Set<string>()
  const entities = new Set<string>()
  const subtypes = new Set<string>()
  const add = (s: string): void => {
    if (s && !NOT_A_TERM.test(s) && !EVERYDAY.has(s)) terms.add(s)
  }
  for (const e of fed.elements) {
    if (!entities.has(e.type)) {
      entities.add(e.type)
      add(e.type)
    }
    for (const v of [e.predefinedType, e.effectivePredefinedType]) {
      add(v)
      if (v && !noSubtypeCode(v)) subtypes.add(v)
    }
    add(e.objectType)
    if (SUBTYPE_TOKEN.test(e.objectType)) subtypes.add(e.objectType)
    for (const sets of [e.psets, e.qto]) {
      for (const [set, props] of Object.entries(sets)) {
        add(set)
        for (const k of Object.keys(props)) add(k)
      }
    }
  }
  return { terms, entities, subtypes }
}

const vocabularies = new WeakMap<object, Vocabulary>()
/** The vocabulary of this very federation object, built the first time it is asked for. */
export function vocabularyFor(fed: Pick<Federation, 'elements'>): Vocabulary {
  let v = vocabularies.get(fed)
  if (!v) vocabularies.set(fed, (v = vocabularyOf(fed)))
  return v
}

/** Whether a code span's text is a term: exact and case-sensitive, or an `Entity.SUBTYPE[*]` label. */
export function isTerm(v: Vocabulary, text: string): boolean {
  if (v.terms.has(text)) return true
  const m = /^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)(\*?)$/.exec(text)
  return !!m && v.entities.has(m[1]) && v.subtypes.has(m[2])
}

/** Every line of a block whose marks are drawn, in the order `BlockView` draws them. */
export function blockLines(b: Block): string[] {
  if (b.kind === 'p') return b.lines
  if (b.kind === 'table') return [...b.head, ...b.rows.flat()]
  return b.items.flat()
}

/** The code spans of one block, in render order. */
const blockSpans = (b: Block): string[] =>
  blockLines(b).flatMap((line) => splitMarks(line).filter((p) => p.mark === 'm').map((p) => p.text))

/** Every code span's text in a reply, in the order the reply renders them. */
export const codeSpans = (text: string): string[] => parseBlocks(text).flatMap(blockSpans)

/** How many code spans each block of a reply holds: where block `k`'s ordinals start. */
export function spanStarts(blocks: readonly Block[]): number[] {
  const starts: number[] = []
  let at = 0
  for (const b of blocks) {
    starts.push(at)
    at += blockSpans(b).length
  }
  return starts
}

/** The bound on what crosses: at most this many coloured spans a message. */
export const MAX_TERMS = 2000

/**
 * The ordinals of the code spans that are terms — what the snapshot carries as `terms`. Only
 * Vee's messages: a user's own words are never coloured.
 */
export function termsOf(v: Vocabulary, text: string, role: 'user' | 'assistant'): number[] {
  if (role !== 'assistant') return []
  const out: number[] = []
  codeSpans(text).forEach((s, k) => {
    if (out.length < MAX_TERMS && isTerm(v, s)) out.push(k)
  })
  return out
}
