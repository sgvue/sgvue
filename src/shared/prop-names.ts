/**
 * Property names as the user says them, against property names as the file spells them —
 * 2026-09-28. The owner's words: *"Sometimes when i ask it check area with includesGFA, it
 * never check the shared parameters Includes As GFA."*
 *
 * A Revit shared parameter is authored by a person (`Includes As GFA`), and the assistant
 * guesses a programmer's spelling (`includesGFA`). `attr()` is an exact, case-sensitive key
 * lookup and stays one — it is the design's resolver and the Filter card depends on it — so
 * the guess is corrected **before** a rule reaches it, and only when the correction is certain:
 *
 *   · `resolveKey` rewrites a name only when it is the file's key exactly, or when exactly one
 *     key differs from it by case, spaces, underscores or punctuation alone. Two keys that
 *     normalise alike are never chosen between; a merely *similar* key is never chosen at all.
 *   · `rankKeys` / `nearestKeys` is what a miss answers with instead: the keys most like the
 *     name asked, ranked deterministically, so "includesGFA" puts "Includes As GFA" first.
 *   · `booleanSpelling` maps a yes/no the model typed to the spelling the file stores.
 *
 * Pure: no store, no DOM. `renderer/ai/executors/names.ts` applies it to every tool input.
 */

/** Lower case, letters and digits only: `"Includes As GFA"` → `"includesasgfa"`. */
export const normKey = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/**
 * The words of a name: camelCase, acronyms, digits, spaces, underscores and punctuation all
 * split, lower-cased. `"includesGFA"` → `includes, gfa`; `"GFAArea2"` → `gfa, area, 2`.
 */
export function keyTokens(s: string): string[] {
  const words = s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/(\p{L})(\p{N})/gu, '$1 $2')
    .replace(/(\p{N})(\p{L})/gu, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  return [...new Set(words)]
}

/**
 * What `resolveKey` decided. `key` is the file's own key, or `null`; `candidates` lists the
 * keys that normalise alike when there is more than one of them, and is otherwise empty.
 */
export interface KeyResolution {
  key: string | null
  candidates: string[]
}

function resolveWhole(asked: string, keys: readonly string[]): KeyResolution {
  if (keys.includes(asked)) return { key: asked, candidates: [] }
  const n = normKey(asked)
  if (!n) return { key: null, candidates: [] }
  const same = keys.filter((k) => normKey(k) === n)
  if (same.length === 1) return { key: same[0], candidates: [] }
  return { key: null, candidates: same }
}

/**
 * The file's key for a name, or none.
 *
 * Exact first; then a **unique** key that differs only by case, spaces, underscores or
 * punctuation. A `Pset.Key` / `Pset:Key` form that does not resolve as a whole is tried again
 * on what follows each separator, longest first — so `Pset_WallCommon.FireRating` finds
 * `FireRating`, and a key that itself contains a dot (`Thickness.LowerBound`) is still found
 * whole before anything is cut off it.
 */
export function resolveKey(asked: string, keys: readonly string[]): KeyResolution {
  const whole = resolveWhole(asked, keys)
  if (whole.key !== null || whole.candidates.length) return whole
  for (let i = 0; i < asked.length; i++) {
    if (asked[i] !== '.' && asked[i] !== ':') continue
    const tail = asked.slice(i + 1).trim()
    if (!tail) continue
    const r = resolveWhole(tail, keys)
    if (r.key !== null || r.candidates.length) return r
  }
  return whole
}

/* ────────────────────────────── ranking ────────────────────────────── */

/**
 * How a ranked key relates to the name asked, strongest first:
 *   · `exact`      — the same string.
 *   · `normalised` — the same letters and digits (case, spacing and punctuation aside).
 *   · `contains`   — the key holds everything asked: its normalised form contains the asked
 *                    one, or every asked word is one of its words ("includesGFA" in
 *                    "Includes As GFA").
 *   · `partial`    — some of it: a shared word, or the key is inside the asked name.
 *   · `spelling`   — nothing in common but letters; ranked by edit distance alone.
 */
export type KeyMatch = 'exact' | 'normalised' | 'contains' | 'partial' | 'spelling'

export interface RankedKey {
  key: string
  match: KeyMatch
}

const MATCH_ORDER: Record<KeyMatch, number> = {
  exact: 0,
  normalised: 1,
  contains: 2,
  partial: 3,
  spelling: 4
}

/** Two words are the same word, or one begins the other and the shorter has three letters. */
const sameWord = (a: string, b: string): boolean =>
  a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)))

/** Levenshtein distance, two rows. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

/**
 * Every key, ranked against the name asked. Deterministic: by `match`, then by how many of the
 * asked words the key shares (more first), then edit distance between the normalised forms,
 * then the shorter key, then plain string order.
 */
export function rankKeys(asked: string, keys: readonly string[]): RankedKey[] {
  const na = normKey(asked)
  const askedWords = keyTokens(asked)
  const rows = [...new Set(keys)].map((key) => {
    const nk = normKey(key)
    const words = keyTokens(key)
    const shared = askedWords.filter((w) => words.some((u) => sameWord(w, u))).length
    let match: KeyMatch
    if (key === asked) match = 'exact'
    else if (na && nk === na) match = 'normalised'
    else if (na && (nk.includes(na) || (askedWords.length > 0 && shared === askedWords.length)))
      match = 'contains'
    else if (shared > 0 || (nk.length >= 3 && na.includes(nk))) match = 'partial'
    else match = 'spelling'
    return { key, match, shared, dist: editDistance(na, nk) }
  })
  rows.sort(
    (a, b) =>
      MATCH_ORDER[a.match] - MATCH_ORDER[b.match] ||
      b.shared - a.shared ||
      a.dist - b.dist ||
      a.key.length - b.key.length ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  )
  return rows.map(({ key, match }) => ({ key, match }))
}

/** The `n` keys most like the name asked, in `rankKeys` order. */
export const nearestKeys = (asked: string, keys: readonly string[], n: number): string[] =>
  rankKeys(asked, keys)
    .slice(0, n)
    .map((r) => r.key)

/** Keys named in one ambiguity sentence. */
const AMBIGUOUS_CAP = 8

/**
 * The sentence for a name that normalises to more than one key (2026-09-28 review follow-up):
 * `"fire rating" matches two names, FireRating and Fire_Rating — say which.` A name that is
 * two keys at once is not "not a property name", and saying so sent the model looking for a
 * third spelling.
 */
export function ambiguousText(asked: string, candidates: readonly string[]): string {
  const named = candidates.slice(0, AMBIGUOUS_CAP)
  const n = candidates.length
  const count = n === 2 ? 'two' : n === 3 ? 'three' : String(n)
  const list =
    named.length <= 2
      ? named.join(' and ')
      : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`
  return `"${asked}" matches ${count} names, ${list}${n > named.length ? ', …' : ''} — say which.`
}

/* ────────────────────────────── yes / no ────────────────────────────── */

const TRUE_WORDS = new Set(['yes', 'true', 'y', '1', 't', '.t.', '✓'])
const FALSE_WORDS = new Set(['no', 'false', 'n', '0', 'f', '.f.', '✗'])

/** `true` / `false` for a yes/no spelling (any case), `null` for anything else. */
export function booleanWord(v: unknown): boolean | null {
  const s = String(v).trim().toLowerCase()
  if (TRUE_WORDS.has(s)) return true
  if (FALSE_WORDS.has(s)) return false
  return null
}

/**
 * The spelling the file stores for the yes/no value asked, or `null` to leave the value alone.
 *
 * `stored` is every distinct spelling the key carries (`String()` of the value, which is what
 * `matchFn` compares and what the Filter card offers — an `IfcBoolean` is `true` / `false`).
 * The value is mapped only when all four hold: it is a yes/no word; it matches no stored
 * spelling as it is (the comparison is case-insensitive, as `matchFn`'s is); **every** stored
 * spelling is a yes/no word, so the key really is a yes/no; and exactly one stored spelling
 * means the same thing — counted **case-insensitively** (2026-09-28 review follow-up), because
 * `matchFn` compares that way: `true` from one model and `True` from another are one spelling,
 * and the first one met is returned.
 */
export function booleanSpelling(asked: unknown, stored: readonly string[]): string | null {
  const want = booleanWord(asked)
  if (want === null || !stored.length) return null
  const a = String(asked).trim().toLowerCase()
  if (stored.some((s) => s.toLowerCase() === a)) return null
  if (!stored.every((s) => booleanWord(s) !== null)) return null
  const seen = new Set<string>()
  const same = stored.filter((s) => {
    const k = s.toLowerCase()
    if (booleanWord(s) !== want || seen.has(k)) return false
    seen.add(k)
    return true
  })
  return same.length === 1 ? same[0] : null
}
