/**
 * `src/shared/upload.ts` — the validation copy, the stage scheduler and the labels.
 *
 * The copy strings are read out of `SGVue.dc.html` itself where the design states them, so a
 * reworded message fails here rather than in a screenshot.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  COUNT_WORDS,
  countWord,
  FIRST_TICK_MS,
  kbOf,
  MAX_FILE_BYTES,
  MIN_STAGE_MS,
  openAllLabel,
  READY_HOLD_MS,
  sizeLabel,
  STAGES,
  STAGGER_MS,
  stageStep,
  stageWait,
  validate
} from '../../src/shared/upload'

const DESIGN = readFileSync(
  join(__dirname, '../../design-reference/design/SGVue.dc.html'),
  'utf8'
)

describe('validate — the design’s own copy', () => {
  it('reproduces `SGVue.dc.html:1155` word for word', () => {
    // The line the three reasons come from, so a reworded design fails this test.
    expect(DESIGN).toContain("'not an IFC file'")
    expect(DESIGN).toContain("'file is empty'")
    expect(DESIGN).toContain("'larger than 600 MB'")
    expect(DESIGN).toContain('600 * 1024 * 1024')
  })

  it('accepts the three extensions the drop zone advertises', () => {
    expect(validate('a.ifc', 10)).toBeNull()
    expect(validate('A.IFC', 10)).toBeNull()
    expect(validate('a.ifczip', 10)).toBeNull()
  })

  it('rejects anything else as "not an IFC file"', () => {
    expect(validate('a.rvt', 10)).toBe('not an IFC file')
    expect(validate('a.ifc.txt', 10)).toBe('not an IFC file')
    expect(validate('ifc', 10)).toBe('not an IFC file')
  })

  it('rejects an empty file, and checks the extension first', () => {
    expect(validate('a.ifc', 0)).toBe('file is empty')
    expect(validate('a.rvt', 0)).toBe('not an IFC file')
  })

  it('rejects over 600 MB, and accepts exactly 600 MB', () => {
    expect(validate('a.ifc', MAX_FILE_BYTES)).toBeNull()
    // 2026-10-09 — the design's words, then the owner's advice to split the model.
    expect(validate('a.ifc', MAX_FILE_BYTES + 1)).toBe(
      'larger than 600 MB — consider splitting it into several models'
    )
    expect(validate('a.ifc', MAX_FILE_BYTES + 1)?.startsWith('larger than 600 MB')).toBe(true)
  })

  it('refuses ifcXML by name rather than as "not an IFC file"', () => {
    expect(validate('a.ifcxml', 10)).toBe('ifcXML is not supported')
    // Size still wins: the reason a person sees is the first one that applies.
    expect(validate('a.ifcxml', 0)).toBe('file is empty')
  })
})

describe('the designed numbers', () => {
  it('keeps the design’s five stages and their percentages', () => {
    expect(STAGES).toEqual([
      [16, 'reading file'],
      [38, 'parsing entities'],
      [64, 'building geometry'],
      [86, 'indexing properties'],
      [100, 'federating']
    ])
  })

  it('keeps the stagger, the first tick, the minimum and the ready hold', () => {
    expect(STAGGER_MS).toBe(500)
    expect(FIRST_TICK_MS).toBe(240)
    expect(MIN_STAGE_MS).toBe(420)
    expect(READY_HOLD_MS).toBe(1100)
  })

  it('reads those numbers back out of the design', () => {
    expect(DESIGN).toContain('n++ * 500')
    expect(DESIGN).toContain('420 + Math.random() * 360')
    expect(DESIGN).toContain('}, 1100)')
    expect(DESIGN).toContain("[[16, 'reading file'], [38, 'parsing entities'], [64, 'building geometry'], [86, 'indexing properties'], [100, 'federating']]")
  })
})

describe('stageStep', () => {
  it('never shows a stage ahead of real progress', () => {
    // A tiny file whose whole pipeline finished in 20 ms still walks the stages in order.
    expect(stageStep({ shown: 0, real: 0, elapsedMs: 10_000 })).toBe(0)
    expect(stageStep({ shown: 2, real: 2, elapsedMs: 10_000 })).toBe(2)
  })

  it('never advances faster than the design’s minimum', () => {
    expect(stageStep({ shown: 0, real: 4, elapsedMs: MIN_STAGE_MS - 1 })).toBe(0)
    expect(stageStep({ shown: 0, real: 4, elapsedMs: MIN_STAGE_MS })).toBe(1)
  })

  it('advances at most one stage at a time, however far ahead the real work is', () => {
    expect(stageStep({ shown: 0, real: 4, elapsedMs: 10_000 })).toBe(1)
    expect(stageStep({ shown: 1, real: 4, elapsedMs: 10_000 })).toBe(2)
  })

  it('stops at the last stage', () => {
    expect(stageStep({ shown: 4, real: 4, elapsedMs: 10_000 })).toBe(4)
  })

  it('walks 0 → 4 in exactly five stages of at least the minimum', () => {
    let shown = 0
    let t = 0
    const seen = [STAGES[0][1]]
    while (shown < STAGES.length - 1) {
      t += MIN_STAGE_MS
      const next = stageStep({ shown, real: 4, elapsedMs: MIN_STAGE_MS })
      expect(next).toBe(shown + 1)
      shown = next
      seen.push(STAGES[shown][1])
    }
    expect(seen).toEqual(STAGES.map((s) => s[1]))
    expect(t).toBe(4 * MIN_STAGE_MS)
  })

  it('stageWait is what is still owed', () => {
    expect(stageWait(0)).toBe(MIN_STAGE_MS)
    expect(stageWait(MIN_STAGE_MS)).toBe(0)
    expect(stageWait(MIN_STAGE_MS + 5_000)).toBe(0)
  })
})

describe('labels', () => {
  it('kbOf rounds up to at least 1 KB, and gives null for an empty file', () => {
    expect(kbOf(0)).toBeNull()
    expect(kbOf(1)).toBe(1)
    expect(kbOf(1024)).toBe(1)
    expect(kbOf(137.9 * 1048576)).toBe(141210)
  })

  it('sizeLabel switches to MB above 1024 KB, one decimal (`:1927`)', () => {
    expect(sizeLabel(null)).toBe('')
    expect(sizeLabel(0)).toBe('')
    expect(sizeLabel(512)).toBe('512 KB')
    expect(sizeLabel(1024)).toBe('1024 KB')
    expect(sizeLabel(1025)).toBe('1.0 MB')
    expect(sizeLabel(141210)).toBe('137.9 MB')
  })

  it('countWord is the design’s own list, and falls back to the number (`:1938`)', () => {
    expect([...COUNT_WORDS]).toEqual(['zero', 'one', 'two', 'three', 'four', 'five', 'six'])
    expect(countWord(0)).toBe('zero')
    expect(countWord(4)).toBe('four')
    expect(countWord(6)).toBe('six')
    expect(countWord(7)).toBe('7')
  })

  it('openAllLabel is verbatim, arrow included', () => {
    expect(openAllLabel(4)).toBe('open all four as a federation →')
    expect(openAllLabel(1)).toBe('open all one as a federation →')
    expect(DESIGN).toContain('open all ${[\'zero\', \'one\', \'two\', \'three\', \'four\', \'five\', \'six\'][files.length] || files.length} as a federation')
  })
})
