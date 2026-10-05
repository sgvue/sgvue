/**
 * `fmt` must reproduce the design's five inlined formatters byte for byte — including which
 * space character precedes `mm`, which differs between call sites and is visible on screen.
 */
import { describe, expect, it } from 'vitest'
import {
  MINUS,
  THIN_SPACE,
  f3,
  fixed2,
  fixed3,
  fmtMM,
  fmtV,
  mmPlain,
  mmTxt,
  mmv,
  signedF3,
  signedMm,
  thin
} from '../../src/shared/fmt'

describe('fmt', () => {
  it('groups thousands with a thin space, not a comma', () => {
    expect(thin(1234567)).toBe(`1${THIN_SPACE}234${THIN_SPACE}567`)
    expect(thin(999)).toBe('999')
    expect(thin(-12345)).toBe(`-12${THIN_SPACE}345`)
    expect(thin(1234567)).not.toContain(',')
  })

  it('formats property values the way the property card does', () => {
    // SGVue.dc.html:1835
    expect(fmtV(true)).toBe('True')
    expect(fmtV(false)).toBe('False')
    expect(fmtV(2400)).toBe(`2${THIN_SPACE}400`)
    expect(fmtV('2 HR')).toBe('2 HR')
    expect(fmtV(0.82)).toBe('0.82')
  })

  it('formats millimetres with the right space before the unit', () => {
    // SGVue.dc.html:1838 and viewer-core.js:9 use a plain space …
    expect(mmv(2.4)).toBe(`2${THIN_SPACE}400 mm`)
    expect(fmtMM(2.4)).toBe(`2${THIN_SPACE}400 mm`)
    // … viewer-core.js:435 (dimension labels) uses a thin space.
    expect(mmTxt(2.4)).toBe(`2${THIN_SPACE}400${THIN_SPACE}mm`)
    expect(mmTxt(2.4)).not.toBe(mmv(2.4))
    // viewer-core.js:617 prints the number and the unit separately.
    expect(mmPlain(2.4)).toBe(`2${THIN_SPACE}400`)
  })

  it('signs elevations with U+2212, not a hyphen', () => {
    // SGVue.dc.html:1790 and viewer-core.js:219
    expect(signedMm(4)).toBe(`+4${THIN_SPACE}000`)
    expect(signedMm(0)).toBe('+0')
    expect(signedMm(-1)).toBe(`${MINUS}1${THIN_SPACE}000`)
    expect(signedMm(-1).startsWith('-')).toBe(false)
  })

  it('signs a spot level with + or U+2212 and f3 digits (2026-09-28)', () => {
    expect(signedF3(10.5)).toBe('+10.500')
    expect(signedF3(-1.2)).toBe(`${MINUS}1.200`)
    expect(signedF3(0)).toBe('+0.000')
    // Rounds to zero: no minus on a zero.
    expect(signedF3(-0.0004)).toBe('+0.000')
    expect(signedF3(-0.0006)).toBe(`${MINUS}0.001`)
    // Same digits as the grid's own `f3`, thin-space grouping included.
    expect(signedF3(1234.5678)).toBe(`+${f3(1234.5678)}`)
    expect(signedF3(-1234.5678)).toBe(`${MINUS}${f3(1234.5678)}`)
  })

  it('prints coordinates with three decimals and grouped thousands', () => {
    // viewer-core.js:410 — the spot readout.
    expect(f3(28500)).toBe(`28${THIN_SPACE}500.000`)
    expect(f3(102.5)).toBe('102.500')
  })

  it('prints measure rows without grouping', () => {
    // SGVue.dc.html:2063 — metres in measure rows are plain toFixed.
    expect(fixed3(1234.5)).toBe('1234.500')
    expect(fixed3(1234.5)).not.toContain(THIN_SPACE)
    expect(fixed2(5.7649)).toBe('5.76')
  })
})
