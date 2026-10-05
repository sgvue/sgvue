/**
 * `src/shared/annotate.ts` — the annotation arithmetic, on numbers.
 *
 * Every case that reproduces the design's own axis-aligned branch is asserted **against the
 * design's literal result**, because that is what the parity captures are measured against;
 * the rotated cases then say what the generalisation does at 43°, which is the angle the
 * 137.9 MB reference model's grid actually runs at.
 */
import { describe, expect, it } from 'vitest'
import {
  BOX_PLACES,
  BUBBLE_GAP,
  DIM_K_STEPS,
  DIM_RUN_DIRS,
  DIM_T_CANDIDATES,
  ELEVATION_PHI_BAND,
  GRID_PAD_MIN,
  LABEL_HALF_H,
  LABEL_HALF_W,
  LASER_AXES,
  LEVEL_TAG_DX,
  STEM_DROP,
  blockedBy,
  boxPlace,
  canonicalDir,
  clipLineToRect,
  dimLabelRect,
  dimOffset,
  gridFamilies,
  gridPad,
  isElevation,
  keepFamily,
  laserDirections,
  laserLabelOffset,
  declutterBubbles,
  levelTagAnchor,
  levelTagHtml,
  type BubbleItem,
  nearEndSign,
  planNormal,
  planeFromLevel,
  planeFromSegment,
  placeDimLabel,
  SPOT_LEVEL_MARK,
  spotGridHtml,
  spotLevelHtml,
  type DimRect,
  type XY
} from '../../src/shared/annotate'
import { DASH, f3 } from '../../src/shared/fmt'

/** The design's own mock federation box, which every parity capture is taken over. */
const MOCK = { minX: -8, minY: -8, maxX: 32, maxY: 26 }
const deg = (d: number): number => (d * Math.PI) / 180
const near = (a: ArrayLike<number>, b: readonly number[], eps = 1e-9): void => {
  expect(a.length).toBe(b.length)
  Array.from(a).forEach((v, i) => expect(v).toBeCloseTo(b[i], Math.round(-Math.log10(eps))))
}

describe('gridPad', () => {
  it('is 2.5 m on the design’s own federation, which is what every capture uses', () => {
    // 40 × 34 m: 6 % of 40 is 2.4, so the floor wins — and the prototype's pad is 2.5.
    expect(gridPad(40, 34)).toBe(2.5)
    expect(GRID_PAD_MIN).toBe(2.5)
  })

  it('is 6 % of the larger footprint side once that beats the floor', () => {
    expect(gridPad(425, 412)).toBeCloseTo(25.5, 6)
    expect(gridPad(100, 20)).toBeCloseTo(6, 6)
  })

  it('never shrinks below the 2.5 m clearance, however small the model', () => {
    expect(gridPad(3, 2)).toBe(2.5)
    expect(gridPad(0, 0)).toBe(2.5)
  })
})

describe('canonicalDir', () => {
  it('is a unit vector in the positive half-plane, whichever way the segment was written', () => {
    near(canonicalDir([0, 0], [0, 10]), [0, 1])
    near(canonicalDir([0, 10], [0, 0]), [0, 1])
    near(canonicalDir([10, 0], [0, 0]), [1, 0])
    near(canonicalDir([0, 0], [-3, -4]), [0.6, 0.8])
  })

  it('reports a degenerate segment as no direction at all', () => {
    expect(canonicalDir([5, 5], [5, 5])).toEqual([0, 0])
  })
})

describe('planNormal', () => {
  it('reproduces the design’s two axis branches exactly', () => {
    // `axis: 'x'` — the line runs along y and +offset moves the plane along +x (L240).
    near(planNormal([0, 1]), [1, 0])
    // `axis: 'y'` — the line runs along x and +offset moves the plane along +y (L241).
    near(planNormal([1, 0]), [0, 1])
  })

  it('points into the positive half-plane at any angle', () => {
    const n = planNormal(canonicalDir([0, 0], [Math.cos(deg(43)), Math.sin(deg(43))]))
    expect(n[0]).toBeGreaterThan(0)
    near([n[0] * Math.cos(deg(43)) + n[1] * Math.sin(deg(43))], [0])
  })
})

describe('clipLineToRect', () => {
  it('gives the design’s literal endpoints for an axis-aligned grid', () => {
    // `viewer-core.js` L179 for `axis: 'x'`, grid C at x = 12 on the mock: the line runs from
    // (12, minY - pad) to (12, maxY + pad).
    const pad = gridPad(40, 34)
    const rect = {
      minX: MOCK.minX - pad,
      minY: MOCK.minY - pad,
      maxX: MOCK.maxX + pad,
      maxY: MOCK.maxY + pad
    }
    const x = clipLineToRect([12, 0], [0, 1], rect)!
    near(x[0], [12, -10.5])
    near(x[1], [12, 28.5])
    // …and for `axis: 'y'`, grid 2 at y = 6.
    const y = clipLineToRect([0, 6], [1, 0], rect)!
    near(y[0], [-10.5, 6])
    near(y[1], [34.5, 6])
  })

  it('crosses the rectangle at 43° and stays inside it', () => {
    const d = canonicalDir([0, 0], [Math.cos(deg(43)), Math.sin(deg(43))])
    const [a, b] = clipLineToRect([0, 0], d, MOCK)!
    for (const p of [a, b]) {
      expect(p[0]).toBeGreaterThanOrEqual(MOCK.minX - 1e-9)
      expect(p[0]).toBeLessThanOrEqual(MOCK.maxX + 1e-9)
      expect(p[1]).toBeGreaterThanOrEqual(MOCK.minY - 1e-9)
      expect(p[1]).toBeLessThanOrEqual(MOCK.maxY + 1e-9)
    }
    // Both ends are on the same line, in increasing t.
    expect((b[0] - a[0]) * d[0] + (b[1] - a[1]) * d[1]).toBeGreaterThan(0)
  })

  it('returns null for a line that misses the rectangle, and for no direction', () => {
    expect(clipLineToRect([1000, 0], [0, 1], MOCK)).toBeNull()
    expect(clipLineToRect([0, 0], [0, 0], MOCK)).toBeNull()
  })
})

describe('gridFamilies', () => {
  it('splits the design’s own nine axes into its two families', () => {
    // A…E are `axis: 'x'` (lines along y) and 1…4 are `axis: 'y'` (lines along x).
    const dirs: XY[] = [
      [0, 1],
      [0, 1],
      [0, 1],
      [0, 1],
      [0, 1],
      [1, 0],
      [1, 0],
      [1, 0],
      [1, 0]
    ]
    const { family, dirs: fam } = gridFamilies(dirs)
    expect(fam).toHaveLength(2)
    expect(family).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1])
  })

  it('groups within 10° and splits beyond it', () => {
    const at = (d: number): XY => canonicalDir([0, 0], [Math.cos(deg(d)), Math.sin(deg(d))])
    expect(gridFamilies([at(43), at(50)]).dirs).toHaveLength(1)
    expect(gridFamilies([at(43), at(54)]).dirs).toHaveLength(2)
  })

  it('treats opposite directions as the same family', () => {
    expect(gridFamilies([[1, 0], canonicalDir([1, 0], [0, 0])]).dirs).toHaveLength(1)
  })
})

describe('the elevation-view rule', () => {
  it('counts a camera within 0.25 rad of the horizon as an elevation', () => {
    expect(isElevation(Math.PI / 2)).toBe(true)
    expect(isElevation(Math.PI / 2 - ELEVATION_PHI_BAND + 1e-6)).toBe(true)
    expect(isElevation(Math.PI / 2 - ELEVATION_PHI_BAND)).toBe(false)
    // iso (1.05) and plan (~0) are not elevations, so both families stay drawn.
    expect(isElevation(1.05)).toBe(false)
    expect(isElevation(0.0001)).toBe(false)
  })

  it('keeps the family whose lines run along the view direction — the design’s keepAxis', () => {
    const alongY: XY = [0, 1] // `axis: 'x'`: A…E
    const alongX: XY = [1, 0] // `axis: 'y'`: 1…4
    const fam = [alongY, alongX]
    // East (theta 0): the design's `alongX` is true and it keeps `axis: 'y'` — index 1 here.
    expect(keepFamily(fam, [Math.cos(0), Math.sin(0)])).toBe(1)
    // North (theta π/2): `alongX` is false and it keeps `axis: 'x'` — index 0.
    expect(keepFamily(fam, [Math.cos(Math.PI / 2), Math.sin(Math.PI / 2)])).toBe(0)
  })

  it('picks the most nearly parallel family for a rotated grid', () => {
    const a = canonicalDir([0, 0], [Math.cos(deg(43)), Math.sin(deg(43))])
    const b = canonicalDir([0, 0], [Math.cos(deg(133)), Math.sin(deg(133))])
    expect(keepFamily([a, b], [Math.cos(deg(45)), Math.sin(deg(45))])).toBe(0)
    expect(keepFamily([a, b], [Math.cos(deg(135)), Math.sin(deg(135))])).toBe(1)
  })

  it('reports no family when there are none', () => {
    expect(keepFamily([], [1, 0])).toBe(-1)
  })
})

describe('nearEndSign', () => {
  it('reproduces the design’s nearSign for an axis-aligned grid', () => {
    // `axis: 'y'`, the line written low-x to high-x. Camera east (cos θ = 1) → the +1 end.
    expect(nearEndSign([-10.5, 6], [34.5, 6], [1, 0])).toBe(1)
    expect(nearEndSign([-10.5, 6], [34.5, 6], [-1, 0])).toBe(-1)
  })

  it('picks the end nearer the camera at 43°', () => {
    const u: XY = [Math.cos(deg(43)), Math.sin(deg(43))]
    expect(nearEndSign([0, 0], [10, 9.3], u)).toBe(1)
    expect(nearEndSign([10, 9.3], [0, 0], u)).toBe(-1)
  })
})

describe('planeFromSegment', () => {
  const centre: XY = [12, 9]

  it('is the design’s own plane for grid C, axis x at v = 12', () => {
    // L239–242: toward = centre.x >= v ? 1 : -1 → centre.x is 12, v is 12 → +1.
    const p = planeFromSegment([12, -10.5], [12, 28.5], 0, false, centre)!
    near(p.n, [1, 0, 0])
    expect(p.c).toBeCloseTo(-12, 9)
  })

  it('keeps the side that holds the model, and flip reverses it', () => {
    // Grid A at x = 0: the model's centre is at +x, so the kept normal points +x.
    const a = planeFromSegment([0, -10.5], [0, 28.5], 0, false, centre)!
    near(a.n, [1, 0, 0])
    expect(a.c).toBeCloseTo(0, 9)
    const flipped = planeFromSegment([0, -10.5], [0, 28.5], 0, true, centre)!
    near(flipped.n, [-1, 0, 0])
    expect(flipped.c).toBeCloseTo(0, 9)
    // Grid E at x = 24 is past the centre, so the kept normal points the other way.
    const e = planeFromSegment([24, -10.5], [24, 28.5], 0, false, centre)!
    near(e.n, [-1, 0, 0])
    expect(e.c).toBeCloseTo(24, 9)
  })

  it('moves the plane along the plan normal by the offset, in the design’s direction', () => {
    // `axis: 'x'` — +1500 mm moves the plane to x = 13.5, which is the design's
    // `g.v + offset`. The model's centre (x = 12) is now on the *other* side, so `toward`
    // flips with it, exactly as L239 computes it against the offset value.
    const p = planeFromSegment([12, -10.5], [12, 28.5], 1.5, false, centre)!
    expect(p.at).toBeCloseTo(13.5, 9)
    near(p.n, [-1, 0, 0])
    expect(p.c).toBeCloseTo(13.5, 9)
    // `axis: 'y'`, grid 2 at y = 6 — +1500 mm moves it to y = 7.5.
    const q = planeFromSegment([-10.5, 6], [34.5, 6], 1.5, false, centre)!
    near(q.nrm, [0, 1])
    expect(q.at).toBeCloseTo(7.5, 9)
    near(q.n, [0, 1, 0])
    expect(q.c).toBeCloseTo(-7.5, 9)
  })

  it('cuts along a 43° grid, keeping the side the model is on', () => {
    const d = canonicalDir([0, 0], [Math.cos(deg(43)), Math.sin(deg(43))])
    const p = planeFromSegment([0, 0], [d[0] * 10, d[1] * 10], 0, false, centre)!
    // The plane contains the segment: both endpoints satisfy dot(p, n) + c = 0.
    for (const q of [
      [0, 0],
      [d[0] * 10, d[1] * 10]
    ]) {
      expect(q[0] * p.n[0] + q[1] * p.n[1] + p.c).toBeCloseTo(0, 9)
    }
    // The centre is kept.
    expect(centre[0] * p.n[0] + centre[1] * p.n[1] + p.c).toBeGreaterThanOrEqual(0)
  })

  it('has no plane for a degenerate segment', () => {
    expect(planeFromSegment([1, 1], [1, 1], 0, false, centre)).toBeNull()
  })
})

describe('planeFromLevel', () => {
  it('keeps what is below the level, and flip keeps what is above (L246)', () => {
    expect(planeFromLevel(4, false)).toEqual({ n: [0, 0, -1], c: 4 })
    expect(planeFromLevel(4, true)).toEqual({ n: [0, 0, 1], c: -4 })
  })
})

describe('level tags', () => {
  it('prints the storey’s AUTHORED elevation, never the scene height', () => {
    // The reference model's lowest storey: `Elevation` 0, drawn at scene z = 1 because the
    // federation offset is −1 m. The tag sits beside the sidebar ladder's own `+0`, so it has
    // to read `+0` — it read `+1 000` until 2026-09-20.
    expect(levelTagHtml('Level 1 Drop-off', 0)).toContain('+0')
    expect(levelTagHtml('Level 1 Drop-off', 0)).not.toContain('1 000')
    // The whole ladder, against the sidebar's own formatting of the same numbers.
    expect(levelTagHtml('Level 1', 1.3)).toContain('+1\u2009300')
    expect(levelTagHtml('Upper Roof', 53.81)).toContain('+53\u2009810')
    // Below datum takes the design's U+2212, not a hyphen.
    expect(levelTagHtml('Basement 1', -4.9)).toContain('\u22124\u2009900')
    // The name is the design's own `<b>` (L219), and it is not the number.
    expect(levelTagHtml('Plant Roof', 46.975)).toBe(
      '<b style="font-weight:500;color:var(--ink)">Plant Roof</b>&nbsp; +46\u2009975'
    )
  })

  it('anchor at the padded rectangle’s (min x, max y) corner, nudged 30 px left (L219)', () => {
    expect(levelTagAnchor({ minX: -10.5, minY: -10.5, maxX: 34.5, maxY: 28.5 })).toEqual([
      -10.5, 28.5
    ])
    expect(LEVEL_TAG_DX).toBe(-30)
  })
})

describe('spot tags (2026-09-28)', () => {
  /**
   * `annotations.ts`'s `spotHtml` as it stood at f71c5c5, copied verbatim: the design's L411
   * with the em dash for a missing base point. The expanded tag must be exactly this.
   */
  const before = (
    f: { x: number; y: number; z: number },
    m: { E: number; N: number; Z: number } | null
  ): string => {
    const v = (n: number | null | undefined): string => (n == null ? DASH : f3(n))
    const rule = 'border-top:1px solid var(--border);padding-top:3px;margin-top:1px'
    return (
      '<div style="display:grid;grid-template-columns:auto auto;gap:2px 10px;text-align:right">' +
      `<span style="color:var(--faint)">E</span><span style="color:var(--ink)">${v(m?.E)}</span>` +
      `<span style="color:var(--faint)">N</span><span style="color:var(--ink)">${v(m?.N)}</span>` +
      `<span style="color:var(--faint)">Z</span><span style="color:var(--ink)">${v(m?.Z)}</span>` +
      `<span style="color:var(--faint);${rule}">xyz</span>` +
      `<span style="${rule}">${Math.round(f.x * 1000)}, ${Math.round(f.y * 1000)}, ` +
      `${Math.round(f.z * 1000)}</span></div>`
    )
  }

  it('the expanded grid is byte for byte what the tag always showed', () => {
    const f = { x: 13.8, y: 0.1, z: 7.5 }
    const m = { E: 28513.451, N: 30203.084, Z: 110 }
    expect(spotGridHtml(f, m)).toBe(before(f, m))
    expect(spotGridHtml(f, null)).toBe(before(f, null))
    expect(spotGridHtml({ x: -3.2105, y: 1e-4, z: -0.3 }, null)).toBe(
      before({ x: -3.2105, y: 1e-4, z: -0.3 }, null)
    )
    // The phase-6 readback's own numbers.
    expect(spotGridHtml(f, m)).toContain('>28\u2009513.451<')
  })

  it('the collapsed tag is one line: the mark, then the signed level', () => {
    expect(spotLevelHtml(10.5)).toBe(
      `${SPOT_LEVEL_MARK} <span style="color:var(--ink)">+10.500</span>`
    )
    expect(spotLevelHtml(-1.2)).toContain('>\u22121.200<')
    // The mark is drawn, not a character the mono font lacks, and it takes the labels' colour.
    expect(SPOT_LEVEL_MARK.startsWith('<svg')).toBe(true)
    expect(SPOT_LEVEL_MARK).toContain('color:var(--faint)')
    expect(SPOT_LEVEL_MARK).not.toMatch(/[\u25b2-\u25bd]/)
  })
})

describe('laserDirections', () => {
  it('fires all six with no surface normal', () => {
    expect(laserDirections(null)).toHaveLength(6)
    expect(laserDirections(null).map((d) => d.axis)).toEqual(['X', 'X', 'Y', 'Y', 'Z', 'Z'])
  })

  it('does not fire into the surface it sits on (L376)', () => {
    // A floor: the normal is +Z, so the −Z ray would go into the slab.
    const up = laserDirections([0, 0, 1])
    expect(up).toHaveLength(5)
    expect(up.some((d) => d.axis === 'Z' && d.sign === -1)).toBe(false)
    // A wall facing +X.
    const wall = laserDirections([1, 0, 0])
    expect(wall.some((d) => d.axis === 'X' && d.sign === -1)).toBe(false)
    expect(wall).toHaveLength(5)
  })

  it('uses the design’s −0.5 threshold, which is 60° from the axis', () => {
    // A face tilted 30° off vertical: its X component is exactly 0.5, so the −X ray is on the
    // boundary and the design keeps it (`< -0.5`, not `<=`); only −Z is dropped.
    expect(laserDirections([0.5, 0, Math.sqrt(0.75)])).toHaveLength(5)
    // Past that, both back-rays go into the surface and both are dropped.
    expect(laserDirections([0.6, 0, 0.8])).toHaveLength(4)
    expect(laserDirections([Math.SQRT1_2, 0, Math.SQRT1_2])).toHaveLength(4)
  })

  it('offsets a Z label to the side and the others above (L403)', () => {
    expect(laserLabelOffset('Z')).toEqual({ dx: 46, dy: 0 })
    expect(laserLabelOffset('X')).toEqual({ dx: 0, dy: -16 })
    expect(laserLabelOffset('Y')).toEqual({ dx: 0, dy: -16 })
    expect(LASER_AXES).toEqual(['X', 'Y', 'Z'])
  })
})

/**
 * 2026-10-02 — where the assistant's `manage_markups` takes a point on an element: the middle
 * of its box's top face, of the box, or of its underside, with the normal of the face the point
 * sits on — which is what a click hands the laser.
 */
describe('boxPlace', () => {
  const BOX = [2, 10, -0.3, 6, 18, 0] as const

  it('names three places, in the order the tool offers them', () => {
    expect([...BOX_PLACES]).toEqual(['top', 'centre', 'base'])
  })

  it('is the middle of the top face, of the box, or of the underside — Z up', () => {
    expect(boxPlace(BOX, 'top')).toEqual({ p: [4, 14, 0], normal: [0, 0, 1] })
    expect(boxPlace(BOX, 'base')).toEqual({ p: [4, 14, -0.3], normal: [0, 0, -1] })
    expect(boxPlace(BOX, 'centre')).toEqual({ p: [4, 14, -0.15], normal: null })
  })

  it('hands the laser a normal that keeps it out of the element it stands on', () => {
    // On the top face nothing is fired down into the element; on the underside, nothing up.
    const up = laserDirections(boxPlace(BOX, 'top').normal)
    expect(up).toHaveLength(5)
    expect(up.some((d) => d.axis === 'Z' && d.sign === -1)).toBe(false)
    const down = laserDirections(boxPlace(BOX, 'base').normal)
    expect(down).toHaveLength(5)
    expect(down.some((d) => d.axis === 'Z' && d.sign === 1)).toBe(false)
    // The middle of the box is on no face: all six.
    expect(laserDirections(boxPlace(BOX, 'centre').normal)).toHaveLength(6)
  })

  it('is exact on a box far from the origin — Float64, as the project frame is kept', () => {
    // The repository's synthetic shifted coordinates: tens of kilometres out, millimetres kept.
    const far = [12345.457, 23456.766, 5.05, 12349.457, 23460.766, 8.3] as const
    const { p } = boxPlace(far, 'top')
    expect(p[0]).toBeCloseTo(12347.457, 9)
    expect(p[1]).toBeCloseTo(23458.766, 9)
    expect(p[2]).toBe(8.3)
  })

  it('a box with no height puts all three at the one level', () => {
    const flat = [0, 0, 3, 4, 4, 3] as const
    expect(BOX_PLACES.map((at) => boxPlace(flat, at).p[2])).toEqual([3, 3, 3])
  })
})

describe('dimension stand-off', () => {
  it('is 7 % of the longest side, with a 120 mm floor (L448)', () => {
    expect(dimOffset(5.6, 0.2, 3.3)).toBeCloseTo(0.392, 9)
    expect(dimOffset(1, 0.2, 0.5)).toBeCloseTo(0.12, 9)
  })
})

describe('placeDimLabel', () => {
  /** Project a candidate straight through: `t` is x, and the push is added. */
  const at =
    (x0: number, y0: number) =>
    (c: { t: number; dx: number; dy: number }): { x: number; y: number } => ({
      x: x0 + c.t * 200 + c.dx,
      y: y0 + c.dy
    })

  it('takes the first candidate when nothing is in the way (L461)', () => {
    const c = placeDimLabel(DIM_RUN_DIRS.x, at(100, 400), [])
    expect(c).toEqual({ t: DIM_T_CANDIDATES[0], dx: 0, dy: 15 })
  })

  it('slides along the run and pushes the other way before giving up', () => {
    // A rectangle over the middle of the run at the first push direction.
    const blocker: DimRect = { x: 100, y: 380, w: 200, h: 60 }
    const c = placeDimLabel(DIM_RUN_DIRS.x, at(100, 400), [blocker])
    const q = at(100, 400)(c)
    expect(blockedBy(q, [blocker])).toBeUndefined()
  })

  it('escapes vertically in whole label heights when every direction is blocked', () => {
    const wall: DimRect = { x: 0, y: 300, w: 1000, h: 140 }
    const c = placeDimLabel(DIM_RUN_DIRS.y, at(100, 400), [wall])
    expect(blockedBy(at(100, 400)(c), [wall])).toBeUndefined()
    // The escape is a multiple of 2 · LABEL_HALF_H on top of one of the run's own pushes.
    const base = DIM_RUN_DIRS.y.map((d) => d[1])
    const k = (c.dy - base.find((b) => (c.dy - b) % (2 * LABEL_HALF_H) === 0)!) / (2 * LABEL_HALF_H)
    expect(DIM_K_STEPS).toContain(k)
  })

  it('falls back to the first candidate when nothing clears (the design’s last resort)', () => {
    const everywhere: DimRect = { x: -10_000, y: -10_000, w: 20_000, h: 20_000 }
    const c = placeDimLabel(DIM_RUN_DIRS.z, at(100, 400), [everywhere])
    expect(c).toEqual({ t: DIM_T_CANDIDATES[0], dx: DIM_RUN_DIRS.z[0][0], dy: DIM_RUN_DIRS.z[0][1] })
  })

  it('treats a label already placed as an obstacle for the next run (L479, pitfall 11)', () => {
    const taken: DimRect[] = []
    const first = placeDimLabel(DIM_RUN_DIRS.x, at(100, 400), taken)
    taken.push(dimLabelRect(at(100, 400)(first)))
    // A second run over the same screen span must not land on the first label.
    const second = placeDimLabel(DIM_RUN_DIRS.x, at(100, 400), taken)
    expect(blockedBy(at(100, 400)(second), taken)).toBeUndefined()
    expect(second).not.toEqual(first)
  })
})

describe('blockedBy', () => {
  it('uses the label’s half-box, so a near miss is a hit (L458)', () => {
    const r: DimRect = { x: 500, y: 500, w: 10, h: 10 }
    expect(blockedBy({ x: 500 - LABEL_HALF_W + 1, y: 505 }, [r])).toBe(r)
    expect(blockedBy({ x: 500 - LABEL_HALF_W - 1, y: 505 }, [r])).toBeUndefined()
    expect(blockedBy({ x: 505, y: 500 - LABEL_HALF_H - 1 }, [r])).toBeUndefined()
  })
})

describe('the scene-scale annotation constants', () => {
  it('are the reference’s own values', () => {
    expect(BUBBLE_GAP).toBe(1.1)
    expect(STEM_DROP).toBe(0.7)
    expect(LABEL_HALF_W).toBe(44)
    expect(LABEL_HALF_H).toBe(13)
    expect(DIM_T_CANDIDATES).toEqual([0.5, 0.72, 0.28, 0.9, 0.1])
    expect(DIM_K_STEPS).toEqual([0, 1, -1, 2, -2, 3, -3])
  })
})

describe('grid bubble declutter', () => {
  /** A 26 px bubble centred on `x` at `y`, in row `row`, at axis order `order`. */
  const bubble = (order: number, x: number, y = 100, row = 'u:1'): BubbleItem => ({
    key: `${row}#${order}`,
    row,
    order,
    rect: { left: x - 13, top: y - 13, right: x + 13, bottom: y + 13 }
  })
  const keys = (items: BubbleItem[]): number[] => {
    const shown = declutterBubbles(items)
    return items.filter((b) => shown.has(b.key)).map((b) => b.order)
  }

  it('keeps every other one at a 20 px pitch — 26 px boxes, 2 px gap', () => {
    // The reference model's numbered family in plan: 24 axes across about 480 px.
    const row = Array.from({ length: 24 }, (_, i) => bubble(i, i * 20))
    expect(keys(row)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22])
  })

  it('keeps all of them at a 30 px pitch — zoom in and they come back', () => {
    const row = Array.from({ length: 24 }, (_, i) => bubble(i, i * 30))
    expect(keys(row)).toHaveLength(24)
    // Exactly at the threshold: a 26 px box plus the 2 px gap is a 28 px pitch.
    expect(keys([bubble(0, 0), bubble(1, 28)])).toEqual([0, 1])
    expect(keys([bubble(0, 0), bubble(1, 27)])).toEqual([0])
  })

  it('reserves nothing for a bubble that is not there', () => {
    // An occluded or off-screen bubble is simply not passed in. Dropping the middle one of
    // three at a 20 px pitch must let the third through, not leave a hole where it was.
    expect(keys([bubble(0, 0), bubble(1, 20), bubble(2, 40)])).toEqual([0, 2])
    expect(keys([bubble(0, 0), bubble(2, 40)])).toEqual([0, 2])
    expect(keys([bubble(1, 20), bubble(2, 40)])).toEqual([1])
  })

  it('decides each row on its own — the two ends of a grid, and the two families', () => {
    const near = Array.from({ length: 4 }, (_, i) => bubble(i, i * 20, 100, 'u:1'))
    // The far end of the same family, well spaced, and a different family on top of it.
    const far = Array.from({ length: 4 }, (_, i) => bubble(i, i * 40, 100, 'u:-1'))
    const other = Array.from({ length: 4 }, (_, i) => bubble(i, i * 40, 100, 'v:1'))
    const shown = declutterBubbles([...near, ...far, ...other])
    expect([...near, ...far, ...other].filter((b) => shown.has(b.key))).toHaveLength(2 + 4 + 4)
  })

  it('is stable: the same input gives the same answer, whatever order it arrives in', () => {
    const row = Array.from({ length: 12 }, (_, i) => bubble(i, i * 20))
    const forwards = declutterBubbles(row)
    const backwards = declutterBubbles([...row].reverse())
    expect([...backwards].sort()).toEqual([...forwards].sort())
    // Greedy runs in AXIS order, not in the order the caller happened to collect them.
    expect(forwards.has('u:1#0')).toBe(true)
    expect(forwards.has('u:1#1')).toBe(false)
  })

  it('separates rows vertically too, not only along the row', () => {
    // Two bubbles at the same x, 40 px apart in y, in one row: both fit.
    expect(keys([bubble(0, 0, 100), bubble(1, 0, 140)])).toEqual([0, 1])
    expect(keys([bubble(0, 0, 100), bubble(1, 0, 120)])).toEqual([0])
  })

  it('is empty for no bubbles at all', () => {
    expect(declutterBubbles([]).size).toBe(0)
  })
})
