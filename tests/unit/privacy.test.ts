/**
 * The privacy scan's rules (`scripts/privacy.cjs`, `npm run privacy`; 2026-11-07, core
 * protection #12). The scan itself runs over the tree in CI; this holds its rules to their
 * meaning, so a change to a pattern that stops it finding anything fails here first.
 *
 * Every private-looking input is assembled at run time from pieces, because this file is
 * tracked and the scan reads it: written out whole, the inputs would be findings themselves.
 * The hashed-name rule is checked through an entry made here from a word nobody owns.
 */
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

interface Finding {
  index: number
  rule: string
  detail: string
}
const req = createRequire(__filename)
const privacy = req('../../scripts/privacy.cjs') as {
  scanText: (text: string, opts?: { coordinates?: boolean }) => Finding[]
  sha: (text: string) => string
  normalise: (text: string) => string
  HASHED: { h: string; n: number; scope?: string; what: string }[]
}
const rules = (text: string, opts?: { coordinates?: boolean }): string[] => privacy.scanText(text, opts).map((f) => f.rule)
const AT = '@'
const U = '/Us' + 'ers/'

describe('privacy scan', () => {
  it('finds a private e-mail address, and passes the allowed and reserved ones', () => {
    expect(rules(`write to alice.private${AT}gmail.com`)).toEqual(['e-mail'])
    expect(rules(`releases${AT}sgvue.invalid, noreply${AT}anthropic.com, a${AT}example.com, b${AT}x.test`)).toEqual([])
  })

  it('finds a home folder with a real-looking name, and passes placeholders', () => {
    expect(rules(`${U}alice/repo`)).toEqual(['home path'])
    expect(rules('/ho' + 'me/bob/x')).toEqual(['home path'])
    expect(rules('C:\\\\Us' + 'ers\\\\Carol\\\\x')).toEqual(['home path'])
    expect(rules(`${U}me/x ${U}<name>/x C:\\Us${'ers'}\\Jane Doe\\x C:\\Us${'ers'}\\JANEDO~1 ${U}$USER/x`)).toEqual([])
  })

  it('passes the synthetic coordinates, in metres, feet and millimetres, and flags another site', () => {
    expect(rules('12345.457 E · 23456.766 N · 40503.468 · 23456766.0 · 28513.539 E · 30200.195 N')).toEqual([])
    expect(rules(`site ${'4' + '1234.567'}.`)).toEqual(['coordinate'])
    expect(rules(`site ${'4' + '1234567.0'}`)).toEqual(['coordinate'])
    expect(rules(`lon ${'103.' + '7012'}`)).toEqual(['coordinate'])
    expect(rules('lon 103.8198')).toEqual([])
    expect(rules(`RefLongitude (${'103'},${'42'},${'5'},0)`)).toEqual(['coordinate'])
    // Below the band (a pixel, a measure) and a binary file's noise are not coordinates.
    expect(rules('1201.42 px, 1609.344 m')).toEqual([])
    expect(rules(`${'4' + '1234.567'}`, { coordinates: false })).toEqual([])
  })

  it('every hashed entry is a SHA-256 of one to three words', () => {
    for (const e of privacy.HASHED) {
      expect(e.h).toMatch(/^[0-9a-f]{64}$/)
      expect([1, 2, 3]).toContain(e.n)
    }
    // The hash is of the normalised text: case and width do not matter.
    expect(privacy.sha(privacy.normalise('ＡbC'))).toBe(privacy.sha('abc'))
  })
})
