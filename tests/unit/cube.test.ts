/**
 * The view cube's hit lattice — `design-reference/design/viewer-core.js` L628–635 and L652.
 *
 * 26 zones: the 3 × 3 × 3 lattice minus its centre. A zone's *size* on each axis is the edge
 * width `EW` where that axis has a sign and the face width `FW` where it does not, so a face
 * zone is one 0.6 square and a corner zone a 0.2 cube — which is what makes the six face
 * labels sit exactly on their zones and the seams fall where the design draws them.
 */
import { describe, expect, it } from 'vitest'
import {
  CUBE_DIST,
  CUBE_PX,
  EW,
  FACE_DEFS,
  FW,
  cubeZones
} from '../../src/renderer/viewer/cube'

describe('the zone lattice', () => {
  const zones = cubeZones()

  it('is 26 zones — 6 faces, 12 edges, 8 corners', () => {
    expect(zones).toHaveLength(26)
    const bySigns = (n: number): number =>
      zones.filter((z) => z.sign.filter((s) => s !== 0).length === n).length
    expect(bySigns(1)).toBe(6)
    expect(bySigns(2)).toBe(12)
    expect(bySigns(3)).toBe(8)
  })

  it('never contains the centre, and never repeats a direction', () => {
    expect(zones.some((z) => z.sign.every((s) => s === 0))).toBe(false)
    expect(new Set(zones.map((z) => z.sign.join(','))).size).toBe(26)
  })

  it('sizes each axis EW where it has a sign and FW where it does not', () => {
    expect(EW).toBe(0.2)
    expect(FW).toBeCloseTo(0.6, 12)
    for (const z of zones) {
      for (let i = 0; i < 3; i++) expect(z.size[i]).toBeCloseTo(z.sign[i] ? EW : FW, 12)
    }
  })

  it('offsets each zone by (1 − EW) / 2 along every signed axis', () => {
    const off = (1 - EW) / 2
    expect(off).toBeCloseTo(0.4, 12)
    for (const z of zones) {
      for (let i = 0; i < 3; i++) expect(z.position[i]).toBeCloseTo(z.sign[i] * off, 12)
    }
  })

  it('tiles the 1 × 1 × 1 cube: every zone stays inside it and none overlap', () => {
    for (const z of zones) {
      for (let i = 0; i < 3; i++) {
        expect(z.position[i] - z.size[i] / 2).toBeGreaterThanOrEqual(-0.5 - 1e-12)
        expect(z.position[i] + z.size[i] / 2).toBeLessThanOrEqual(0.5 + 1e-12)
      }
    }
    // Two zones differ on at least one axis by a whole zone width, so their spans only touch.
    for (let a = 0; a < zones.length; a++) {
      for (let b = a + 1; b < zones.length; b++) {
        const apart = [0, 1, 2].some((i) => {
          const gap = Math.abs(zones[a].position[i] - zones[b].position[i])
          return gap >= (zones[a].size[i] + zones[b].size[i]) / 2 - 1e-12
        })
        expect(apart).toBe(true)
      }
    }
  })
})

describe('the labelled faces', () => {
  it('names the six axis directions the design labels (L652)', () => {
    expect(FACE_DEFS.map(([t]) => t)).toEqual(['E', 'W', 'N', 'S', 'TOP', 'BOTTOM'])
  })

  it('points each label along its own axis, in the Z-up frame', () => {
    expect(Object.fromEntries(FACE_DEFS)).toEqual({
      E: [1, 0, 0],
      W: [-1, 0, 0],
      // Z-up: +y is north and +z is up, which is why TOP is [0, 0, 1] and not [0, 1, 0].
      N: [0, 1, 0],
      S: [0, -1, 0],
      TOP: [0, 0, 1],
      BOTTOM: [0, 0, -1]
    })
  })

  it('has a zone of its own for every face label', () => {
    const zones = cubeZones()
    for (const [, n] of FACE_DEFS) {
      const zone = zones.find((z) => z.sign.join(',') === n.join(','))
      expect(zone).toBeDefined()
      // A face zone is the 0.6 square on the two axes it does not point along.
      expect(zone!.size.filter((s) => Math.abs(s - FW) < 1e-12)).toHaveLength(2)
    }
  })
})

describe('the cube constants', () => {
  it('are the design\'s (L623, L684)', () => {
    expect(CUBE_PX).toBe(148)
    expect(CUBE_DIST).toBe(4.7)
  })
})
