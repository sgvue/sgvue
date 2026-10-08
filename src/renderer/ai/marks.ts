/**
 * The two inline marks a reply may carry — `**bold**` and `` `code` `` — split into pieces a
 * component renders as elements (2026-10-01). Pure, and deliberately small: **nothing else is
 * read as markup and nothing is ever rendered as HTML**. A mark with no partner prints as it was
 * written.
 *
 * **Linear in the text's length.** This runs on the answer path — once when `done` arrives, to
 * count the words, and once to render them — so an opening mark looks at exactly one candidate
 * for its partner, the next mark of its kind: one search an opening, whatever the reply holds.
 *
 *   `**9 of 86 walls** have no Fire Rating.`   → bold `9 of 86 walls`, then plain text
 *   `` All 9 are in `SB_ARC_R25`. ``            → plain, mono `SB_ARC_R25`, plain `.`
 *
 * `markWords` is the same text as the words the reveal fades in one by one: a word is what stands
 * between two runs of white space, and may be made of pieces (a bold word and its full stop).
 *
 * 2026-10-08: the marks are read inside each line of a block — a paragraph's, a list item's, a
 * table's cell (`ai/blocks.ts`) — and the reveal's count of pieces moved there with the blocks
 * (`wordCount`).
 */

/** How a piece is set: plain, bold (weight 600) or the mono face. */
export type Mark = '' | 'b' | 'm'

export interface MarkPiece {
  text: string
  mark: Mark
}

const BOLD = '**'
const CODE = '`'

const SPACE = /\s/

/**
 * The closing mark for an opening one at `from`, or −1: the opening is then literal.
 *
 * An opening has **one** candidate for its partner — the next mark of its kind. Bold's content
 * must be something and must not begin or end with white space (`2 ** 3 ** 4` is arithmetic,
 * not emphasis); code's content must be something. If the next mark cannot close it, nothing
 * later is tried.
 *
 * That is what keeps the split linear. Looking past a candidate that cannot close — as this did
 * at first — makes `**a **a **a …` cost the square of its marks: every opening walks every later
 * mark and fails each for the same reason, and a long reply of that shape would hold the
 * renderer for seconds before its answer showed.
 */
function closeOf(text: string, mark: string, from: number): number {
  const start = from + mark.length
  // Decided before any search: bold that would begin with white space is not bold.
  if (mark === BOLD && SPACE.test(text.charAt(start))) return -1
  const at = text.indexOf(mark, start)
  if (at <= start) return -1
  if (mark === BOLD && SPACE.test(text.charAt(at - 1))) return -1
  return at
}

/**
 * `text` as plain, bold and mono pieces, in order. Code inside bold is mono; nothing nests
 * inside code.
 */
export function splitMarks(text: string, inside: Mark = ''): MarkPiece[] {
  const out: MarkPiece[] = []
  let plain = ''
  const flush = (): void => {
    if (plain) out.push({ text: plain, mark: inside })
    plain = ''
  }
  for (let i = 0; i < text.length; ) {
    const mark = inside === '' && text.startsWith(BOLD, i) ? BOLD : text[i] === CODE ? CODE : ''
    const close = mark ? closeOf(text, mark, i) : -1
    if (close < 0) {
      plain += text[i++]
      continue
    }
    flush()
    const content = text.slice(i + mark.length, close)
    if (mark === BOLD) out.push(...splitMarks(content, 'b'))
    else out.push({ text: content, mark: 'm' })
    i = close + mark.length
  }
  flush()
  return out
}

/** The text as words, each a list of pieces; white space separates them and is not kept. */
export function markWords(text: string): MarkPiece[][] {
  const words: MarkPiece[][] = []
  let open: MarkPiece[] | null = null
  for (const piece of splitMarks(text)) {
    piece.text.split(/(\s+)/).forEach((part, i) => {
      // Odd parts are the white space between words.
      if (i % 2) {
        open = null
        return
      }
      if (!part) return
      if (!open) words.push((open = []))
      open.push({ text: part, mark: piece.mark })
    })
  }
  return words
}
