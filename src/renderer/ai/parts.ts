/**
 * One message, drawn as several bubbles and cards — 2026-11-08, "Vee Messages".
 *
 * The owner: *"I need the conversation window like texting in messaging"*. A reply of Vee's is
 * drawn as one bubble per block of its text (`ai/blocks.ts`: a paragraph, a list, a table), then
 * its cards: the chips, the rows under the answer (the storey-rows card), the result table and
 * the request that waits for the user's OK (the consent card). A user's message is one bubble.
 *
 * **Nothing here is stored.** Both windows hold the same message — the main window its
 * `ChatMessage`, the Ask Vee window the `VeeMessage` it was sent — and compute the same list
 * from the same fields, so a part is named by its place alone: `(message, part)`. A reply made
 * on one bubble names that part; **the quote is worked out in the main window, from its own
 * message** (`quoteOfPart`), never from text the Vee window sends.
 *
 * Proved by `spikes/vee-messages/` (spike 1) before it was built.
 */
import { parseBlocks, plainBlock } from './blocks'
import { countText, nounFor } from './trace-facts'

/** What both message shapes have in common for the split. */
export interface Splittable {
  role: 'user' | 'assistant'
  text: string
  chips?: readonly unknown[] | null
  table?: { rows: readonly { k: string; n: number }[] } | null
  trace?: { noun: string; rows: readonly { label: string; n: number }[] } | null
  pending?: object | null
  /** What became of the request (2026-11-08): its card stays, stamped. */
  settled?: object | null
}

export type Part =
  | { kind: 'text'; block: number; lead: boolean }
  | { kind: 'chips' }
  | { kind: 'rows' }
  | { kind: 'table' }
  | { kind: 'consent' }

/**
 * The parts of a message, in drawing order: one bubble per block of the text (the first is the
 * lead, which carries the time), the chips, the storey-rows card, the table card, the consent
 * card. A user's message is one part.
 */
export function partsOf(m: Splittable): Part[] {
  if (m.role === 'user') return [{ kind: 'text', block: 0, lead: true }]
  const parts: Part[] = parseBlocks(m.text).map((_, i) => ({ kind: 'text' as const, block: i, lead: i === 0 }))
  if (m.chips?.length) parts.push({ kind: 'chips' })
  if (m.trace?.rows.length) parts.push({ kind: 'rows' })
  if (m.table) parts.push({ kind: 'table' })
  if (m.pending || m.settled) parts.push({ kind: 'consent' })
  return parts
}

/** How long a quote may be: the design's 220 characters and an ellipsis (`SGVue.dc.html:1597`). */
export const QUOTE_MAX = 220

/**
 * What a reply on part `k` of a message quotes, as one line of plain text — or `null` for a part
 * that cannot be quoted.
 *
 *   text    that one bubble's text, flattened as a whole reply's always was (`plainBlock`)
 *   rows    the storey rows as text: `L1 4 walls; L2 5 walls; L3 3 walls`
 *   table   the result table's rows as text: `L1 9; L2 8`
 *   chips, consent   nothing: a chip is a button, and a request is the user's to answer, not
 *           to quote
 *
 * Cut to `QUOTE_MAX` as the whole-reply quote was. Out of range is `null`.
 */
export function quoteOfPart(m: Splittable, k: number): string | null {
  const part = partsOf(m)[k]
  if (!part) return null
  let said: string
  if (part.kind === 'text') said = m.role === 'user' ? m.text : plainBlock(parseBlocks(m.text)[part.block])
  else if (part.kind === 'rows' && m.trace) {
    const noun = m.trace.noun
    said = m.trace.rows.map((r) => `${r.label} ${countText(r.n)} ${nounFor(r.n, noun)}`).join('; ')
  } else if (part.kind === 'table' && m.table) said = m.table.rows.map((r) => `${r.k} ${countText(r.n)}`).join('; ')
  else return null
  return said.length > QUOTE_MAX ? said.slice(0, QUOTE_MAX) + '…' : said
}
