/**
 * The two inline marks a reply may carry — `src/renderer/ai/marks.ts`.
 *
 * `**bold**` and `` `code` `` become pieces a component renders as elements; nothing else is read
 * as markup, nothing is rendered as HTML, and a mark with no partner prints as it was written.
 *
 * It runs on the answer path — `done` counts the reply's words before the reply is committed —
 * so it also has to be linear in the reply's length, whatever the reply holds.
 */
import { describe, expect, it } from 'vitest'
import { markWords, splitMarks } from '../../src/renderer/ai/marks'
// 2026-10-08: the reveal's count moved to the blocks (`ai/blocks.ts`); for a reply of one line
// it is still that line's words, which is what these cases count.
import { wordCount } from '../../src/renderer/ai/blocks'

const flat = (text: string): string => splitMarks(text).map((p) => (p.mark ? `<${p.mark}:${p.text}>` : p.text)).join('')

describe('the inline marks', () => {
  it('reads the handoff’s own answer: bold, plain, mono', () => {
    expect(splitMarks('**9 of 86 walls** have no Fire Rating. All 9 are in `SB_ARC_R25`.')).toEqual([
      { text: '9 of 86 walls', mark: 'b' },
      { text: ' have no Fire Rating. All 9 are in ', mark: '' },
      { text: 'SB_ARC_R25', mark: 'm' },
      { text: '.', mark: '' }
    ])
  })

  it('leaves text with no marks as one plain piece, and an empty text as none', () => {
    expect(splitMarks('4 models, 412 elements, 6 storeys.')).toEqual([{ text: '4 models, 412 elements, 6 storeys.', mark: '' }])
    expect(splitMarks('')).toEqual([])
  })

  it('prints a mark with no partner as it was written', () => {
    expect(flat('a ** b')).toBe('a ** b')
    expect(flat('**unclosed')).toBe('**unclosed')
    expect(flat('one `tick only')).toBe('one `tick only')
    expect(flat('5 * 3 * 2')).toBe('5 * 3 * 2')
    // Arithmetic is not emphasis: bold cannot begin or end with a space.
    expect(flat('2 ** 3 ** 4')).toBe('2 ** 3 ** 4')
    expect(flat('**a **')).toBe('**a **')
    // Nothing between the marks is nothing marked.
    expect(flat('****')).toBe('****')
    expect(flat('``')).toBe('``')
    // A matched pair after an unmatched mark is still read.
    expect(flat('a ` b **c**')).toBe('a ` b <b:c>')
  })

  it('gives an opening one candidate for its partner: the next mark of its kind', () => {
    // The next `**` has white space before it, so it cannot close — and nothing later is tried.
    expect(flat('**a ** b**')).toBe('**a ** b**')
    expect(flat('**a **b**')).toBe('**a <b:b>')
    // Nothing stands between a backtick and the next: it opens nothing, and the next one may.
    expect(flat('``a`')).toBe('`<m:a>')
    expect(flat('```')).toBe('```')
    // A run of asterisks that opens nothing is literal, and what follows it is still read.
    expect(flat('*** **b**')).toBe('*** <b:b>')
    // Inside a run each pair is an opening of its own: the first has nothing before the next
    // pair, the second has `*a` before the closing one.
    expect(flat('****a**')).toBe('*<b:*a>')
  })

  it('reads several marks, side by side and one in the other', () => {
    expect(flat('**a** and **b**')).toBe('<b:a> and <b:b>')
    expect(flat('`IfcWall` then `IfcDoor`')).toBe('<m:IfcWall> then <m:IfcDoor>')
    // Code inside bold is mono; nothing nests inside code.
    expect(flat('**all `IfcWall` here**')).toBe('<b:all ><m:IfcWall><b: here>')
    expect(flat('`a **b** c`')).toBe('<m:a **b** c>')
    // A single asterisk and an underscore are not marks here.
    expect(flat('*emphasis* and _this_')).toBe('*emphasis* and _this_')
  })

  it('never produces markup: angle brackets and entities stay text', () => {
    const pieces = splitMarks('<img src=x onerror=alert(1)> **<b>bold</b>** &amp; `<script>`')
    expect(pieces).toEqual([
      { text: '<img src=x onerror=alert(1)> ', mark: '' },
      { text: '<b>bold</b>', mark: 'b' },
      { text: ' &amp; ', mark: '' },
      { text: '<script>', mark: 'm' }
    ])
    // The pieces put back together are the text less its marks — nothing added, nothing lost.
    expect(pieces.map((p) => p.text).join('')).toBe('<img src=x onerror=alert(1)> <b>bold</b> &amp; <script>')
  })
})

describe('the words of a reply', () => {
  it('splits at white space, keeping a word’s pieces together', () => {
    expect(markWords('**9 of 86 walls** have no Fire Rating. All 9 are in `SB_ARC_R25`.')).toEqual([
      [{ text: '9', mark: 'b' }],
      [{ text: 'of', mark: 'b' }],
      [{ text: '86', mark: 'b' }],
      [{ text: 'walls', mark: 'b' }],
      [{ text: 'have', mark: '' }],
      [{ text: 'no', mark: '' }],
      [{ text: 'Fire', mark: '' }],
      [{ text: 'Rating.', mark: '' }],
      [{ text: 'All', mark: '' }],
      [{ text: '9', mark: '' }],
      [{ text: 'are', mark: '' }],
      [{ text: 'in', mark: '' }],
      // The mono name and its full stop are one word: nothing may break between them.
      [{ text: 'SB_ARC_R25', mark: 'm' }, { text: '.', mark: '' }]
    ])
    // Thirteen words, as the handoff's `ANSWER` has.
    expect(wordCount('**9 of 86 walls** have no Fire Rating. All 9 are in `SB_ARC_R25`.')).toBe(13)
  })

  it('treats any run of white space as one gap, and none as no words', () => {
    expect(markWords('  two\n\nwords \t ').map((w) => w.map((p) => p.text).join(''))).toEqual(['two', 'words'])
    expect(markWords('')).toEqual([])
    expect(markWords('   ')).toEqual([])
    expect(wordCount('Done.')).toBe(1)
  })

  it('keeps a word that starts plain and ends bold as one word', () => {
    expect(markWords('(**12**) walls')).toEqual([
      [{ text: '(', mark: '' }, { text: '12', mark: 'b' }, { text: ')', mark: '' }],
      [{ text: 'walls', mark: '' }]
    ])
  })
})

describe('a long reply', () => {
  /*
   * Every wall-clock bound here is 1 000 ms, where the titles say what the work takes. What the
   * bounds guard is the quadratic walk `ai/marks.ts` once had — 200 kB of `**a ` took 44 s — so
   * the regression they catch is three orders of magnitude over; each of these takes about 4 ms.
   * At 100 ms a bound was near enough to a busy machine's noise to fail: one did, once, in a full
   * `npm test` run on 2026-10-02, and passed on every re-run. A bound is here to catch the
   * regression, not to time the machine.
   */

  /** Run `fn` once, and say how long it took in milliseconds. */
  const timed = <T,>(fn: () => T): [T, number] => {
    const t0 = performance.now()
    const out = fn()
    return [out, performance.now() - t0]
  }

  it('splits 200 kB of bold openings that never close in well under a second', () => {
    // `**a ` fifty thousand times: every opening's next `**` has white space before it. Looking
    // past a candidate that cannot close made this the square of its marks — seconds.
    const text = '**a '.repeat(50_000)
    expect(text).toHaveLength(200_000)
    const [pieces, ms] = timed(() => splitMarks(text))
    expect(pieces).toEqual([{ text, mark: '' }])
    expect(ms).toBeLessThan(1000)
    // What `done` runs before it commits the reply, and what the bubble runs to render it.
    const [count, countMs] = timed(() => wordCount(text))
    expect(count).toBe(50_000)
    expect(countMs).toBeLessThan(1000)
    // The other shape that walked every later mark: openings followed by white space.
    const spaced = '** '.repeat(66_667)
    const [bare, spacedMs] = timed(() => splitMarks(spaced))
    expect(bare).toEqual([{ text: spaced, mark: '' }])
    expect(spacedMs).toBeLessThan(1000)
  })

  it('splits 200 kB of backticks with no partner in well under a second', () => {
    // Nothing stands between any two of them, so none opens a span…
    const ticks = '`'.repeat(200_000)
    const [pieces, ms] = timed(() => splitMarks(ticks))
    expect(pieces).toEqual([{ text: ticks, mark: '' }])
    expect(ms).toBeLessThan(1000)
    // …and one that opens, with nothing after it to close it, searches the rest of the reply once.
    const open = '`' + 'word '.repeat(40_000)
    const [alone, aloneMs] = timed(() => splitMarks(open))
    expect(alone).toEqual([{ text: open, mark: '' }])
    expect(aloneMs).toBeLessThan(1000)
    expect(timed(() => wordCount(open))[1]).toBeLessThan(1000)
  })

  it('is as quick on a long reply that is marked properly', () => {
    // 20 000 bold phrases and 20 000 names in the mono face: 60 000 pieces, 60 000 words.
    const text = '**bold** then `code` '.repeat(20_000)
    const [pieces, ms] = timed(() => splitMarks(text))
    expect(pieces).toHaveLength(80_000)
    expect(pieces.slice(0, 4)).toEqual([
      { text: 'bold', mark: 'b' },
      { text: ' then ', mark: '' },
      { text: 'code', mark: 'm' },
      { text: ' ', mark: '' }
    ])
    expect(ms).toBeLessThan(1000)
    expect(wordCount(text)).toBe(60_000)
  })
})
