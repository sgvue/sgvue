/**
 * The blocks a reply is laid out in — paragraphs, bulleted and numbered lists, and tables — read
 * from the Markdown the assistant writes (2026-10-08). Pure, and as small as the two inline marks
 * beside it (`ai/marks.ts`), which every block carries inside it.
 *
 * The owner: *"the Ask VEE ai assistant answer are in one sentence, which is extremely difficult
 * to read … Present answer in simple table or list if applicable."* The prompt now asks for a
 * short opening sentence, then a list, a table or short paragraphs (`main/ai/prompt.ts`); this is
 * what the panel makes of them. **What is read, and nothing else:**
 *
 *   · a **paragraph** — lines with no blank line between them; each line break inside one is kept
 *   · a **bulleted list** — lines opening `- ` or `* `; a **numbered** one — `1. `, `2. `, … — that
 *     counts up from the number it opens with, and breaks into a paragraph only at `1.`, as in
 *     CommonMark (so "built in\n2024. It was" is one paragraph); an indented line under an item
 *     continues it
 *   · a **table** — a row with a pipe in it, then a separator row (`|---|---:|`) with as many
 *     cells; then every following line with a pipe in it is a row
 *
 * A blank line ends any block. Everything else — a heading's `#`, a code fence, a marker with no
 * space after it, a header row with no separator under it, a lone pipe — **prints as written**,
 * and nothing is ever HTML.
 *
 * **Linear in the reply's length**, like the marks: it runs on the answer path (`done` counts the
 * reply's pieces before the reply is committed, `wordCount` below), and the quote's flattening
 * (`plainText`) runs where a reply is quoted. One pass over the lines; a line is looked at a fixed
 * number of times — as a paragraph, an item, a table's header or its separator — and every test
 * of it is a scan of that line, never a pattern that can backtrack over it; and nothing done for
 * one block reads the blocks before it, so tens of thousands of blocks cost what one long one
 * does.
 */
import { markWords, splitMarks } from './marks'

/** How a table's column is aligned: by its separator's colons, else right for numbers. */
export type Align = 'left' | 'center' | 'right'

export interface TableColumn {
  align: Align
  /** Every value in the column is a number (an amount, a count, a measure): set in the mono face. */
  num: boolean
}

export type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'ul'; items: string[][] }
  | { kind: 'ol'; start: number; items: string[][] }
  | { kind: 'table'; head: string[]; cols: TableColumn[]; rows: string[][] }

/**
 * A list item's marker and its text: `- walls`, `* walls`, `12. walls`. The marker needs its
 * space. `s`, so that `.` takes every character to the line's end and nothing is ever given back.
 */
const ITEM = /^([-*]|\d{1,9}\.)[ \t]+(.*)$/s

/** One cell of a separator row, trimmed: dashes, with a colon at either end or both. */
const RULE_CELL = /^:?-+:?$/

/**
 * A value the table sets in the mono face: a number — a sign or a tilde before it, its digits in
 * groups apart by a comma, a stop, a space or a (narrow) no-break space — and a unit or a
 * percentage after it.
 */
const NUMBER = /^[+\-\u2212~\u2248]?\d[\d.,\u00a0\u202f ]*(?:\s?[%a-zA-Z\u00b5\u00b0\u00b2\u00b3/\u00b7]{1,12})?$/

/** What a cell holds when it holds nothing: blank, or a dash standing for "none". */
const NOTHING = /^(?:|[-–—])$/

/**
 * A table row's cells: one leading and one trailing pipe are dropped, it is split at every pipe
 * that is not escaped (`\|` is a pipe inside a cell), and each cell is trimmed.
 */
export function cellsOf(row: string): string[] {
  let line = row.trim()
  if (line.startsWith('|')) line = line.slice(1)
  if (line.endsWith('|') && !line.endsWith('\\|')) line = line.slice(0, -1)
  const cells: string[] = []
  let cell = ''
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '\\' && line[i + 1] === '|') {
      cell += '|'
      i++
    } else if (c === '|') {
      cells.push(cell.trim())
      cell = ''
    } else cell += c
  }
  cells.push(cell.trim())
  return cells
}

/** The separator under a header of `count` cells: each cell's alignment, or `null` when it is not one. */
function separatorOf(line: string | undefined, count: number): (Align | null)[] | null {
  if (line === undefined || !line.includes('|') || !line.includes('-')) return null
  const cells = cellsOf(line)
  if (cells.length !== count || !cells.every((c) => RULE_CELL.test(c))) return null
  return cells.map((c) => {
    const left = c.startsWith(':')
    const right = c.endsWith(':')
    return left && right ? 'center' : right ? 'right' : left ? 'left' : null
  })
}

/** A cell's text as the panel shows it: its marks taken out. */
const shown = (cell: string): string =>
  splitMarks(cell)
    .map((p) => p.text)
    .join('')
    .trim()

/** The reply as blocks. */
export function parseBlocks(text: string): Block[] {
  const lines = text.split(/\r\n?|\n/)
  const out: Block[] = []
  /** The paragraph or list the next line may join, if any. */
  let para: { kind: 'p'; lines: string[] } | null = null
  let list: { kind: 'ul'; items: string[][] } | { kind: 'ol'; start: number; items: string[][] } | null = null

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    if (!line) {
      para = list = null
      continue
    }

    // A table: this row, and a separator row under it with as many cells.
    if (line.includes('|')) {
      const head = cellsOf(line)
      const aligns = head.some((c) => c) ? separatorOf(lines[i + 1], head.length) : null
      if (aligns) {
        const rows: string[][] = []
        let j = i + 2
        for (; j < lines.length && lines[j].includes('|') && lines[j].trim(); j++) {
          // A row of another length is fitted to the header, as GFM does: padded, or cut.
          const cells = cellsOf(lines[j]).slice(0, head.length)
          while (cells.length < head.length) cells.push('')
          rows.push(cells)
        }
        const cols = head.map((_, c): TableColumn => {
          const values = rows.map((r) => shown(r[c])).filter((v) => !NOTHING.test(v))
          const num = values.length > 0 && values.every((v) => NUMBER.test(v))
          return { align: aligns[c] ?? (num ? 'right' : 'left'), num }
        })
        out.push({ kind: 'table', head, cols, rows })
        para = list = null
        i = j - 1
        continue
      }
    }

    // A list item: it joins the list above it when that is a list of its kind. A numbered one
    // breaks into a paragraph only when it is `1.`, as in CommonMark — so "built in\n2024. It
    // was" stays one paragraph — and is any number after a blank line or inside an open list.
    const item = ITEM.exec(raw.trimStart())
    const ordered = !!item && item[1] !== '-' && item[1] !== '*'
    const start = item && ordered ? Number(item[1].slice(0, -1)) : 1
    if (item && !(ordered && para && start !== 1)) {
      if (!list || (list.kind === 'ol') !== ordered) {
        list = ordered ? { kind: 'ol', start, items: [] } : { kind: 'ul', items: [] }
        out.push(list)
      }
      list.items.push(item[2].trim() ? [item[2].trim()] : [])
      para = null
      continue
    }

    // An indented line under an item goes on that item, on a line of its own.
    if (list && raw !== raw.trimStart()) {
      list.items[list.items.length - 1].push(line)
      continue
    }

    if (!para) {
      para = { kind: 'p', lines: [] }
      out.push(para)
    }
    para.lines.push(line)
    list = null
  }
  return out
}

/** Whether the reply holds a table — the one block that sets its bubble's width. */
export const hasTable = (text: string): boolean => parseBlocks(text).some((b) => b.kind === 'table')

/**
 * How many pieces the reveal brings in, one after another (`ai/trace.ts`, `wordStagger`): each
 * word of a paragraph or of a list item (`markWords`), each list marker, and each table — whole.
 * It is what `app/Trace.tsx` renders as `[data-part="word"]`, in the same order.
 */
export function wordCount(text: string): number {
  let n = 0
  for (const block of parseBlocks(text)) {
    if (block.kind === 'table') n += 1
    else if (block.kind === 'p') for (const line of block.lines) n += markWords(line).length
    else for (const item of block.items) n += 1 + item.reduce((k, line) => k + markWords(line).length, 0)
  }
  return n
}

/** A list item's or a cell's text with a full stop or semicolon at its end taken off, for joining. */
const clause = (s: string): string => s.replace(/[.;]$/, '')

/**
 * The reply as plain text, for a quote — the line a reply carries back to the model
 * (`[replying to Vee: "…"]`), the quote above the user's question and the reply strip. The marks
 * are taken out; a paragraph's lines are joined with spaces, a list's items with semicolons, a
 * table's cells with commas and its rows — the header first — with semicolons; and two blocks
 * with a full stop where the first does not end in one. A reply of one plain sentence is itself.
 *
 * Linear in the number of blocks as well as in their length: the pieces are collected and joined
 * once, and whether two blocks need a full stop is read off the last character of the first —
 * never off everything flattened so far, which made 66 666 one-word paragraphs take seconds.
 */
export function plainText(text: string): string {
  const parts: string[] = []
  /** The last character of the block before, which decides what joins the next one to it. */
  let end = ''
  for (const block of parseBlocks(text)) {
    const flat =
      block.kind === 'p'
        ? block.lines.map(shown).join(' ')
        : block.kind === 'table'
          ? [block.head, ...block.rows]
              .map((row) => row.map(shown).filter(Boolean).map(clause).join(', '))
              .filter(Boolean)
              .join('; ')
          : block.items
              .map((item) => clause(item.map(shown).join(' ')))
              .filter(Boolean)
              .join('; ')
    if (!flat) continue
    if (parts.length) parts.push(/[.!?:;…]/.test(end) ? ' ' : '. ')
    parts.push(flat)
    end = flat.slice(-1)
  }
  return parts.join('')
}
