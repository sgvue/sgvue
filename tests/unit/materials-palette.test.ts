/**
 * The palette, against the design itself.
 *
 * `THEMES` in `src/renderer/viewer/materials.ts` is a copy of the literal in
 * `design-reference/design/viewer-core.js` L4–7, and `design-reference/` is the read-only
 * specification. A copy drifts, so this test parses the literal out of the reference at run
 * time and compares it key by key — any edit to either side fails here rather than showing up
 * as a slightly-off screenshot three phases later.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EDGE_ALPHA,
  FADE_IN_FROM,
  FADE_IN_TO,
  FADE_OUT_FROM,
  FADE_SECONDS,
  GHOST_ALPHA,
  GHOST_GREY,
  HIGHLIGHT_GLOW,
  INERT_ALPHA,
  SELECT_GLOW,
  THEMES,
  linearHex,
  linearRgba
} from '../../src/renderer/viewer/materials'

const REFERENCE = join(__dirname, '..', '..', 'design-reference', 'design', 'viewer-core.js')
const source = readFileSync(REFERENCE, 'utf8')

/** Pull `const <name> = <literal>;` out of the reference and evaluate the literal. */
function literal(name: string): unknown {
  const at = source.indexOf(`const ${name} = `)
  expect(at, `${name} not found in viewer-core.js`).toBeGreaterThan(-1)
  const from = source.indexOf('{', at)
  let depth = 0
  let to = from
  for (; to < source.length; to++) {
    if (source[to] === '{') depth++
    else if (source[to] === '}' && --depth === 0) break
  }
  const text = source.slice(from, to + 1)
  return new Function(`return (${text})`)()
}

describe('palette', () => {
  it('is the reference’s THEMES literal, key for key', () => {
    expect(literal('THEMES')).toEqual(THEMES)
  })

  it('has both themes with every key the reference defines', () => {
    const keys = [
      'bg', 'ground', 'grid1', 'grid2', 'edge', 'gridline', 'level', 'accent', 'cut',
      'card', 'cardHover', 'ink', 'muted', 'border', 'accentCss'
    ]
    expect(Object.keys(THEMES)).toEqual(['dark', 'light'])
    expect(Object.keys(THEMES.dark)).toEqual(keys)
    expect(Object.keys(THEMES.light)).toEqual(keys)
    // Spot-check the two the design is recognised by.
    expect(THEMES.dark.bg).toBe(0x0f1516)
    expect(THEMES.dark.accent).toBe(0x35c4b6)
    expect(THEMES.light.bg).toBe(0xf4f7f6)
    expect(THEMES.light.accent).toBe(0x0e8a80)
  })
})

describe('the numbers the design’s look is made of', () => {
  it('matches the reference’s materials (L98–107) and frame loop (L731)', () => {
    expect(GHOST_GREY).toBe(0x8a9492)
    expect(GHOST_ALPHA).toBe(0.1)
    expect(INERT_ALPHA).toBe(0.08)
    expect(FADE_OUT_FROM).toBe(0.3)
    expect(FADE_IN_FROM).toBe(0.02)
    expect(FADE_IN_TO).toBe(0.3)
    expect(FADE_SECONDS).toBe(0.22)
    expect(EDGE_ALPHA).toBe(0.45)
    expect(SELECT_GLOW).toBe(0.35)
    expect(HIGHLIGHT_GLOW).toBe(0.15)
  })

  it('reads the same values back out of the reference file', () => {
    expect(source).toContain('color: 0x8a9492, transparent: true, opacity: 0.1')
    expect(source).toContain('color: 0x8a9492, transparent: true, opacity: 0.08')
    expect(source).toContain('color: 0x8a9492, transparent: true, opacity: 0.3')
    expect(source).toContain('color: 0x8a9492, transparent: true, opacity: 0.02')
    expect(source).toContain('emissiveIntensity: 0.35') // selMat
    expect(source).toContain('emissiveIntensity: 0.15') // hlMat
    expect(source).toContain('fadeT += dt / 0.22')
    expect(source).toContain('fadeOutMat.opacity = 0.3 * (1 - fadeT)')
    expect(source).toContain('fadeInMat.opacity = 0.02 + 0.28 * fadeT')
    expect(source).toContain("new THREE.EdgesGeometry(geo, 20)")
    expect(source).toContain('roughness: 0.88')
  })
})

describe('colour conversion', () => {
  it('turns an sRGB part colour into the working space the batch texture stores', () => {
    // A mid grey is a long way from linear-mid: that is the conversion doing its job.
    const v = linearRgba(0.5, 0.5, 0.5, 1)
    expect(v.x).toBeCloseTo(0.21404, 4)
    expect(v.w).toBe(1)
    // Black and white are fixed points either way round.
    expect(linearRgba(0, 0, 0, 0.42).toArray()).toEqual([0, 0, 0, 0.42])
    expect(linearRgba(1, 1, 1, 1).toArray()).toEqual([1, 1, 1, 1])
  })

  it('gives a design hex the same value the reference’s materials get from it', () => {
    // `new THREE.MeshStandardNodeMaterial({ color: 0x35c4b6 })` converts from sRGB the same way.
    const byHex = linearHex(THEMES.dark.accent, 1)
    const byChannel = linearRgba(0x35 / 255, 0xc4 / 255, 0xb6 / 255, 1)
    expect(byHex.x).toBeCloseTo(byChannel.x, 6)
    expect(byHex.y).toBeCloseTo(byChannel.y, 6)
    expect(byHex.z).toBeCloseTo(byChannel.z, 6)
  })

  it('keeps alpha out of the conversion — it is opacity, not colour', () => {
    for (const a of [0, 0.08, 0.1, 0.42, 1, 1.35]) {
      expect(linearRgba(0.5, 0.5, 0.5, a).w).toBe(a)
    }
  })
})
