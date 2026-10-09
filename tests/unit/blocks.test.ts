/**
 * The blocks a reply of Vee's is laid out in — `src/renderer/ai/blocks.ts`, and their markup,
 * `ReplyText` in `src/renderer/app/Trace.tsx` (2026-10-08).
 *
 * The owner: "the Ask VEE ai assistant answer are in one sentence, which is extremely difficult to
 * read". The prompt asks for a sentence, then a list, a table or short paragraphs; the panel reads
 * exactly those — paragraphs and their line breaks, `- ` / `* ` and `1. ` lists, pipe tables with
 * a separator row — with the two inline marks inside each, and prints everything else as it was
 * written. Nothing is ever HTML. It runs on the answer path, so it is linear in the reply's length
 * whatever the reply holds; and the markup has exactly as many pieces for the reveal as
 * `wordCount` counts, in the same order.
 */
import { createElement, isValidElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { cellsOf, hasTable, parseBlocks, plainText, wordCount, type Block } from '../../src/renderer/ai/blocks'
import { markWords } from '../../src/renderer/ai/marks'
import { ReplyText } from '../../src/renderer/app/Trace'
import { plainOf, replyStrip } from '../../src/renderer/state/selectors/chat'

const p = (...lines: string[]): Block => ({ kind: 'p', lines })

/** What the 2026-10-08 captures show: a sentence, a bulleted list and a table. */
const WALLS = [
  '**24 of 80 walls** have no Thermal Transmittance, and every level has some.',
  '',
  '- 12 are in `SB_ARC_R25` and 12 in `SB_STR_R25`.',
  '- All 4 walls on the roof are missing it.',
  '- Every `EW 200 Brick` wall carries one.',
  '',
  '| Level | Walls | Missing |',
  '|---|---:|---:|',
  '| L1 | 19 | 5 |',
  '| L2 | 19 | 5 |',
  '| Roof | 4 | 4 |'
].join('\n')

describe('the blocks of a reply', () => {
  it('reads one plain sentence as one paragraph of one line — the reply it always was', () => {
    expect(parseBlocks('**24 of 80 walls** have no Thermal Transmittance.')).toEqual([
      p('**24 of 80 walls** have no Thermal Transmittance.')
    ])
    expect(parseBlocks('')).toEqual([])
    expect(parseBlocks(' \n \t\n')).toEqual([])
  })

  it('keeps a line break inside a paragraph, and starts a new paragraph at a blank line', () => {
    expect(parseBlocks('First line.\nSecond line.\n\n  Next paragraph.  ')).toEqual([
      p('First line.', 'Second line.'),
      p('Next paragraph.')
    ])
    // Any number of blank lines is one break.
    expect(parseBlocks('a\n\n\n\nb')).toEqual([p('a'), p('b')])
  })

  it('reads a bulleted list from "- " and "* " items, one item a line', () => {
    expect(parseBlocks('- L1: 19 walls\n- L2: 19 walls\n* Roof: 4 walls')).toEqual([
      { kind: 'ul', items: [['L1: 19 walls'], ['L2: 19 walls'], ['Roof: 4 walls']] }
    ])
    // The inline marks stay in the item, to be read there; an empty item is a marker alone.
    expect(parseBlocks('- **12** in `SB_ARC_R25`\n- ')).toEqual([{ kind: 'ul', items: [['**12** in `SB_ARC_R25`'], []] }])
  })

  it('reads a numbered list, counting up from the number it opens with', () => {
    expect(parseBlocks('1. Isolate L2\n2. Hide the windows\n3. Section at grid C')).toEqual([
      { kind: 'ol', start: 1, items: [['Isolate L2'], ['Hide the windows'], ['Section at grid C']] }
    ])
    expect(parseBlocks('4. four\n4. five')).toEqual([{ kind: 'ol', start: 4, items: [['four'], ['five']] }])
    // A list of the other kind starts a list of its own.
    expect(parseBlocks('1. one\n- dash')).toEqual([
      { kind: 'ol', start: 1, items: [['one']] },
      { kind: 'ul', items: [['dash']] }
    ])
  })

  it('breaks a paragraph with a numbered item only at 1., as CommonMark does', () => {
    // A year at the start of a wrapped line is not a list.
    expect(parseBlocks('built in\n2024. It was')).toEqual([p('built in', '2024. It was')])
    expect(parseBlocks('Steps:\n3. third')).toEqual([p('Steps:', '3. third')])
    // `1.` may break into one, and so may `01.`; a bullet always may.
    expect(parseBlocks('Steps:\n1. first\n2. second')).toEqual([p('Steps:'), { kind: 'ol', start: 1, items: [['first'], ['second']] }])
    expect(parseBlocks('Steps:\n01. first')).toEqual([p('Steps:'), { kind: 'ol', start: 1, items: [['first']] }])
    expect(parseBlocks('Walls:\n- L1')).toEqual([p('Walls:'), { kind: 'ul', items: [['L1']] }])
    // Any number after a blank line, after a table, or inside an open list.
    expect(parseBlocks('built in\n\n2024. It was')).toEqual([p('built in'), { kind: 'ol', start: 2024, items: [['It was']] }])
    expect(parseBlocks('| a |\n|---|\n| 1 |\n7. seven').map((b) => b.kind)).toEqual(['table', 'ol'])
    expect(parseBlocks('- a\n2. b\n9. c')).toEqual([
      { kind: 'ul', items: [['a']] },
      { kind: 'ol', start: 2, items: [['b'], ['c']] }
    ])
  })

  it('puts an indented line under an item on that item, and an unindented one after the list', () => {
    expect(parseBlocks('- L1\n  19 walls\n- L2\nTotal: 38 walls.')).toEqual([
      { kind: 'ul', items: [['L1', '19 walls'], ['L2']] },
      p('Total: 38 walls.')
    ])
    // A list may follow a sentence with no blank line between them, and a nested item is
    // flattened into the list — the prompt asks for none.
    expect(parseBlocks('Walls by level:\n- L1\n  - L1a\n- L2')).toEqual([
      p('Walls by level:'),
      { kind: 'ul', items: [['L1'], ['L1a'], ['L2']] }
    ])
  })

  it('reads a table from a header row and a separator row, and every row with a pipe after them', () => {
    expect(parseBlocks('| Level | Walls |\n|---|---|\n| L1 | 19 |\n| L2 | 19 |')).toEqual([
      {
        kind: 'table',
        head: ['Level', 'Walls'],
        cols: [
          { align: 'left', num: false },
          // Every value a number: right-aligned, in the mono face.
          { align: 'right', num: true }
        ],
        rows: [
          ['L1', '19'],
          ['L2', '19']
        ]
      }
    ])
    // Outer pipes are optional, as in GFM.
    expect(parseBlocks('Level | Walls\n--- | ---\nL1 | 19')[0]).toMatchObject({ kind: 'table', head: ['Level', 'Walls'], rows: [['L1', '19']] })
  })

  it('aligns a column by its separator’s colons, and a column of numbers to the right', () => {
    const [table] = parseBlocks(
      '| Name | Area | Rating | Count |\n|:--|:-:|--:|---|\n| Lobby | 12.5 m² | **2 HR** | 1,234 |\n| Core | — | 1 HR | 7 |'
    )
    expect(table).toMatchObject({
      kind: 'table',
      cols: [
        { align: 'left', num: false },
        // A colon at both ends centres; a dash for "none" does not stop a column being numbers.
        { align: 'center', num: true },
        // An explicit right; bold is taken off before a value is read.
        { align: 'right', num: true },
        { align: 'right', num: true }
      ]
    })
    // A column of names stays on the left, and one that only starts with a digit is not a number.
    const [names] = parseBlocks('| Level | Date |\n|---|---|\n| 2nd floor | 2026-10-08 |')
    expect(names).toMatchObject({ cols: [{ align: 'left', num: false }, { align: 'left', num: false }] })
  })

  it('fits a row of another length to the header, as GFM does, and reads an escaped pipe as a pipe', () => {
    const [table] = parseBlocks('| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |\n| x \\| y | z | w |')
    expect(table).toMatchObject({ rows: [['1', '', ''], ['1', '2', '3'], ['x | y', 'z', 'w']] })
    expect(cellsOf('| a \\| b | c |')).toEqual(['a | b', 'c'])
    expect(cellsOf('|')).toEqual([''])
  })

  it('ends a table at a blank line or at a line with no pipe in it', () => {
    expect(parseBlocks('| a |\n|---|\n| 1 |\nTotal: 1.\n| 2 |').map((b) => b.kind)).toEqual(['table', 'p'])
    expect(parseBlocks('| a |\n|---|\n| 1 |\n\n| 2 |').map((b) => b.kind)).toEqual(['table', 'p'])
    // A table may follow a sentence directly, and a paragraph may follow it after a blank line.
    expect(parseBlocks('Walls by level:\n| L | n |\n|---|---|\n| L1 | 19 |\n\nThat is all.').map((b) => b.kind)).toEqual([
      'p',
      'table',
      'p'
    ])
  })

  it('reads a mixed reply — a sentence, a list and a table — as three blocks', () => {
    expect(parseBlocks(WALLS).map((b) => b.kind)).toEqual(['p', 'ul', 'table'])
    expect(hasTable(WALLS)).toBe(true)
    expect(hasTable('Just a sentence with a | pipe.')).toBe(false)
  })

  it('takes Windows and old Mac line endings as line breaks', () => {
    const lf = parseBlocks(WALLS)
    expect(parseBlocks(WALLS.replace(/\n/g, '\r\n'))).toEqual(lf)
    expect(parseBlocks(WALLS.replace(/\n/g, '\r'))).toEqual(lf)
    expect(parseBlocks('a\r\nb\r\n\r\n- c')).toEqual([p('a', 'b'), { kind: 'ul', items: [['c']] }])
  })

  it('prints everything else as it was written', () => {
    // A marker with no space after it is not one: a negative number, emphasis, a decimal.
    expect(parseBlocks('-5 walls\n*emphasis*\n1.5 m high\n**bold** start')).toEqual([
      p('-5 walls', '*emphasis*', '1.5 m high', '**bold** start')
    ])
    // A header row with no separator under it — a table left unclosed — is its lines as written.
    expect(parseBlocks('| Level | Walls |\n| L1 | 19 |')).toEqual([p('| Level | Walls |', '| L1 | 19 |')])
    // …and so is one whose separator has another number of cells, or is no separator at all.
    expect(parseBlocks('| a | b |\n|---|\n| 1 | 2 |')).toEqual([p('| a | b |', '|---|', '| 1 | 2 |')])
    expect(parseBlocks('| a | b |\n| -x- | --- |').map((b) => b.kind)).toEqual(['p'])
    // A lone pipe, a separator on its own, and a header of nothing.
    expect(parseBlocks('|')).toEqual([p('|')])
    expect(parseBlocks('|---|---|')).toEqual([p('|---|---|')])
    expect(parseBlocks('| |\n|---|')).toEqual([p('| |', '|---|')])
    // Headings, rules, fences and quotes are not read: the prompt asks for none of them.
    expect(parseBlocks('# Walls\n---\n```\ncode\n```\n> quoted')).toEqual([
      p('# Walls', '---', '```', 'code', '```', '> quoted')
    ])
  })

  it('never produces markup: angle brackets and entities are text in every block', () => {
    const blocks = parseBlocks('<b>x</b>\n- <img src=x onerror=alert(1)>\n\n| <i>a</i> |\n|---|\n| &amp; |')
    expect(blocks).toEqual([
      p('<b>x</b>'),
      { kind: 'ul', items: [['<img src=x onerror=alert(1)>']] },
      { kind: 'table', head: ['<i>a</i>'], cols: [{ align: 'left', num: false }], rows: [['&amp;']] }
    ])
  })
})

describe('how many pieces the reveal brings in', () => {
  it('counts a paragraph’s words, as it always did', () => {
    // Thirteen words, as the handoff's `ANSWER` has.
    expect(wordCount('**9 of 86 walls** have no Fire Rating. All 9 are in `SB_ARC_R25`.')).toBe(13)
    expect(wordCount('One.\nTwo words.')).toBe(3)
    expect(wordCount('')).toBe(0)
  })

  it('counts each list marker and each word of each item, and a table as one', () => {
    // The sentence's 13 words; 3 markers and 8 + 9 + 7 words (a name in the mono face is as many
    // words as it has, `EW 200 Brick` three); the table whole.
    expect(wordCount(WALLS)).toBe(13 + 3 + 8 + 9 + 7 + 1)
    expect(wordCount('1. a b\n2.  ')).toBe(1 + 2 + 1)
  })
})

describe('a reply as plain text, for its quote', () => {
  it('is a plain sentence itself, and a marked one without its marks', () => {
    expect(plainText('Isolated 18 walls on L2.')).toBe('Isolated 18 walls on L2.')
    expect(plainText('**24 of 80 walls** have no `ThermalTransmittance`')).toBe('24 of 80 walls have no ThermalTransmittance')
  })

  it('flattens lines, items, rows and blocks into one line', () => {
    expect(plainText('Walls by level:\n- L1: 19\n- L2: 19.')).toBe('Walls by level: L1: 19; L2: 19')
    expect(plainText('Two lines\nof one paragraph')).toBe('Two lines of one paragraph')
    expect(plainText(WALLS)).toBe(
      '24 of 80 walls have no Thermal Transmittance, and every level has some. 12 are in SB_ARC_R25 and 12 in SB_STR_R25; ' +
        'All 4 walls on the roof are missing it; Every EW 200 Brick wall carries one. ' +
        'Level, Walls, Missing; L1, 19, 5; L2, 19, 5; Roof, 4, 4'
    )
  })

  it('is what a reply of Vee’s is quoted as — and a user’s message is quoted as typed', () => {
    expect(plainOf({ role: 'assistant', text: WALLS })).toBe(plainText(WALLS))
    expect(plainOf({ role: 'user', text: '**not** a mark - here' })).toBe('**not** a mark - here')
    const strip = replyStrip([{ role: 'assistant', text: '- a\n- b' }], 0)
    expect(strip).toEqual({ replying: true, who: 'Vee', text: 'a; b' })
  })
})

describe('a long reply', () => {
  /*
   * As for the marks (`marks.test.ts`): every bound is 1 000 ms, three orders of magnitude over
   * what each takes, so that what it catches is a walk that has become quadratic — 200 kB of a
   * shape that makes one take seconds — and not a busy machine.
   */
  const timed = <T,>(fn: () => T): [T, number] => {
    const t0 = performance.now()
    const out = fn()
    return [out, performance.now() - t0]
  }
  const linear = (text: string): void => {
    for (const fn of [parseBlocks, wordCount, plainText, hasTable] as ((t: string) => unknown)[]) {
      const [, ms] = timed(() => fn(text))
      expect([fn.name, text.length >= 200_000, ms < 1000]).toEqual([fn.name, true, true])
    }
  }

  it('reads 200 kB of header rows whose separators never come in well under a second', () => {
    linear('| a | b |\n'.repeat(20_000))
    linear('|'.repeat(200_000))
    linear('|-|\n'.repeat(50_000))
    expect(parseBlocks('| a |\n'.repeat(3)).map((b) => b.kind)).toEqual(['p'])
  })

  it('reads 200 kB of one table, of list items and of blank lines in well under a second', () => {
    const table = '| L | n |\n|---|--:|\n' + '| L1 | 19 |\n'.repeat(20_000)
    linear(table)
    expect((parseBlocks(table)[0] as { rows: unknown[] }).rows).toHaveLength(20_000)
    linear('- a\n'.repeat(50_000))
    linear('1. a\n'.repeat(40_000))
    linear('\n'.repeat(200_000))
    linear('\r\n'.repeat(100_000))
  })

  it('reads 200 kB of tens of thousands of blocks in well under a second', () => {
    // Nothing done for one block may read the blocks before it: the quote's flattening once
    // re-tested everything joined so far at every block, and these took seconds.
    const paragraphs = 'a\n\n'.repeat(66_667)
    linear(paragraphs)
    expect(parseBlocks(paragraphs)).toHaveLength(66_667)
    expect(plainText(paragraphs)).toBe(Array(66_667).fill('a').join('. '))
    // A bulleted list and a numbered one, one item each, by turns.
    const lists = '- a\n1. b\n'.repeat(25_000)
    linear(lists)
    expect(parseBlocks(lists)).toHaveLength(50_000)
    // A one-column table with no rows, and a blank line, over and over.
    const tables = '| a |\n|-|\n\n'.repeat(18_200)
    linear(tables)
    expect(parseBlocks(tables).every((b) => b.kind === 'table')).toBe(true)
  })

  it('reads a 200 kB line of white space — in an item, a cell or a paragraph — in well under a second', () => {
    // A marker, then white space to the end: the item's pattern never gives any of it back,
    // whatever follows — a line separator included.
    linear('- ' + ' '.repeat(200_000) + '\u2028x')
    linear(' '.repeat(200_000) + 'x')
    // A cell that starts like a number and runs on: the number's pattern is bounded too.
    linear('| n |\n|---|\n| 1' + ' '.repeat(200_000) + 'x |')
    linear('| n |\n|---|\n| 1' + ',5'.repeat(100_000) + ' metres-and-more |')
  })
})

describe('the markup of a reply', () => {
  const html = (text: string, reveal = true): string => renderToStaticMarkup(createElement(ReplyText, { text, reveal }))
  const parts = (markup: string): number => markup.split('data-part="word"').length - 1
  /**
   * The text of each reveal piece, `[data-part="word"]`, in document order — read off the elements
   * a reply renders, not out of its markup. No component a reply is drawn with uses a hook, so each
   * is called here as React calls it; a `memo`'s own function is its `type`.
   */
  const pieceTexts = (text: string): string[] => {
    const out: string[] = []
    const walk = (node: unknown, into: string[] | null): void => {
      if (typeof node === 'string' || typeof node === 'number') into?.push(String(node))
      else if (Array.isArray(node)) for (const child of node) walk(child, into)
      else if (isValidElement<{ children?: unknown; 'data-part'?: string }>(node)) {
        const type: unknown = node.type
        const { props } = node
        if (typeof type === 'function') walk(type(props), into)
        else if (typeof type === 'object') walk((type as { type: (p: object) => unknown }).type(props), into)
        // A tag or a fragment: its children, gathered into a piece of their own if it is one.
        else if (props['data-part'] !== 'word') walk(props.children, into)
        else {
          const piece: string[] = []
          walk(props.children, piece)
          out.push(piece.join(''))
        }
      }
    }
    walk(createElement(ReplyText, { text }), null)
    return out
  }

  it('draws one paragraph as a reply always was: its words straight in, nothing around them', () => {
    expect(html('**24 of 80** walls.')).toBe(
      '<span data-part="word" style="position:relative"><span style="font-weight:600">24</span></span> ' +
        '<span data-part="word" style="position:relative"><span style="font-weight:600">of</span></span> ' +
        '<span data-part="word" style="position:relative"><span style="font-weight:600">80</span></span> ' +
        '<span data-part="word" style="position:relative">walls.</span>'
    )
    // A line break inside it is a `<br>`, and nothing else is added.
    expect(html('One.\nTwo.')).toBe(
      '<span data-part="word" style="position:relative">One.</span><br/><span data-part="word" style="position:relative">Two.</span>'
    )
    // Not revealed — a message no turn produced — a plain sentence is its text and nothing more.
    expect(html('4 models, 412 elements, 6 storeys.', false)).toBe('4 models, 412 elements, 6 storeys.')
  })

  it('draws a paragraph, a list and a table as elements, 6 px apart', () => {
    const out = html(WALLS)
    expect(out).toMatch(/^<p style="margin:0px 0 0">/)
    expect(out).toContain('<ul style="margin:6px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:3px">')
    expect(out.match(/<li style="display:flex;align-items:baseline;gap:6px">/g)).toHaveLength(3)
    // The bullet is decoration; the table is a real one, its header cells column headers.
    expect(out).toContain('aria-hidden="true"')
    expect(out).toContain('<table style="border-collapse:collapse;width:100%"><thead><tr><th scope="col"')
    expect(out.match(/<th /g)).toHaveLength(3)
    expect(out.match(/<td /g)).toHaveLength(9)
    // The result table's own strings: its box, its header, its rows.
    expect(out).toContain('border:1px solid var(--border);border-radius:8px;background:var(--card);margin-top:6px')
    expect(out).toContain('font:500 10px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)')
    expect(out).toContain('font:400 11.5px/1.4 var(--sans);color:var(--ink);text-align:left')
    expect(out).toContain('font:400 11px/1.4 var(--mono);font-variant-numeric:tabular-nums;color:var(--ink);white-space:nowrap;text-align:right')
    // The two marks are elements in every block, never their characters.
    expect(out).not.toMatch(/\*\*|`/)
    expect(out).toContain('<span style="font:400 11px/1 var(--mono)">SB_ARC_R25</span>')
  })

  it('numbers an ordered list from its first number, its numbers as wide as the widest', () => {
    const out = html('9. nine\n10. ten')
    expect(out).toMatch(/^<ol style=/)
    expect(out).toContain('min-width:3ch">9.</span>')
    expect(out).toContain('min-width:3ch">10.</span>')
  })

  it('has exactly as many pieces for the reveal as wordCount counts — and none when not revealed', () => {
    for (const text of [
      WALLS,
      'One sentence.',
      '1. a b\n2. c\n\n| x |\n|---|\n| 1 |\n\nDone.',
      'Walls:\n- L1\n  19 walls\n- ',
      '- \n- '
    ]) {
      expect([text.slice(0, 12), parts(html(text))]).toEqual([text.slice(0, 12), wordCount(text)])
      expect(parts(html(text, false))).toBe(0)
    }
    // …in reading order: the sentence's words, then each marker before its item's words.
    const order = pieceTexts(WALLS)
    expect(markWords('**24 of 80 walls** have no Thermal Transmittance, and every level has some.')).toHaveLength(13)
    expect(order.slice(0, 3)).toEqual(['24', 'of', '80'])
    expect(order.slice(13, 16)).toEqual(['•', '12', 'are'])
  })

  it('never renders a reply’s text as HTML, in any block', () => {
    const out = html(
      '<img src=x onerror=alert(1)>\n<IMG SRC=x ONERROR=alert(1)>\n- <script>x</script>\n- <SCRIPT>x</SCRIPT>\n\n' +
        '| <b>a</b> |\n|---|\n| &amp; |\n| <B>b</B> |'
    )
    expect(out).not.toMatch(/<\s*(img|script|b)\b/i)
    expect(out).toContain('&lt;img')
    expect(out).toContain('&lt;script&gt;')
    expect(out).toContain('&lt;b&gt;a&lt;/b&gt;')
    expect(out).toContain('&amp;amp;')
    // …and in upper case, which a browser reads as the same tags.
    expect(out).toContain('&lt;IMG')
    expect(out).toContain('&lt;SCRIPT&gt;')
    expect(out).toContain('&lt;B&gt;b&lt;/B&gt;')
  })
})
