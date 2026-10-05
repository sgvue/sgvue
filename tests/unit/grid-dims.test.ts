/**
 * `src/shared/annotate.ts` — the dimensions between gridlines (2026-09-24): which pairs are
 * dimensioned, their spacing, where the run sits, and how their labels share the bubbles'
 * declutter sweep. The rotated case uses the synthetic −43.4103° set, never a real model's.
 */
import { describe, expect, it } from 'vitest'
import {
  BUBBLE_RADIUS_PX,
  GRID_DIM_CLEAR_PX,
  canonicalDir,
  clipLineToRect,
  declutterBubbles,
  gridDimOffset,
  gridDimRuns,
  gridDimStandoffPx,
  gridFamilies,
  type BubbleItem,
  type GridDimLine,
  type Rect,
  type XY
} from '../../src/shared/annotate'

/** Draw a set of grid segments exactly as `annotations.ts` does: canonical, clipped, grouped. */
function drawn(segments: readonly [XY, XY][], rect: Rect): GridDimLine[] {
  const dirs = segments.map(([a, b]) => canonicalDir(a, b))
  const fam = gridFamilies(dirs).family
  const out: GridDimLine[] = []
  segments.forEach(([a], i) => {
    const span = clipLineToRect(a, dirs[i], rect)
    if (span) out.push({ p0: span[0], p1: span[1], family: fam[i] })
  })
  return out
}

const RECT: Rect = { minX: -10, minY: -10, maxX: 60, maxY: 40 }
const GAP = 1.1

describe('gridDimRuns', () => {
  it('dimensions each adjacent pair of a parallel family, in mm-exact Float64', () => {
    // Four north–south grids at x = 0, 8.4, 16.8, 24 — unequal spacing on purpose.
    const xs = [0, 8.4, 16.8, 24]
    const lines = drawn(
      xs.map((x) => [[x, 0], [x, 30]] as [XY, XY]),
      RECT
    )
    const runs = gridDimRuns(lines, GAP)
    expect(runs.map((r) => Math.round(r.spacing * 1000))).toEqual([8400, 8400, 7200])
    for (const r of runs) {
      // The span is perpendicular to the grids and exactly the spacing long.
      expect(Math.abs(r.span[0] * r.dir[0] + r.span[1] * r.dir[1])).toBeLessThan(1e-12)
      expect(Math.hypot(r.span[0], r.span[1])).toBeCloseTo(r.spacing, 12)
      // At the start end: on the bubble row, one gap beyond the padded footprint.
      expect(r.at[1]).toBeCloseTo(RECT.minY - GAP, 12)
      // And the dimension starts on line i.
      expect(r.at[0]).toBeCloseTo(lines[r.i].p0[0], 12)
    }
  })

  it('orders pairs across the family whatever order the grids arrive in', () => {
    const xs = [16.8, 0, 24, 8.4]
    const lines = drawn(
      xs.map((x) => [[x, 30], [x, 0]] as [XY, XY]),
      RECT
    )
    const runs = gridDimRuns(lines, GAP)
    expect(runs.map((r) => Math.round(r.spacing * 1000))).toEqual([8400, 8400, 7200])
    expect(runs.map((r) => [lines[r.i].p0[0], lines[r.j].p0[0]])).toEqual([
      [0, 8.4],
      [8.4, 16.8],
      [16.8, 24]
    ])
  })

  it('keeps two families apart', () => {
    const lines = drawn(
      [
        [[0, 0], [0, 30]],
        [[6, 0], [6, 30]],
        [[0, 0], [50, 0]],
        [[0, 7.5], [50, 7.5]],
        [[0, 15], [50, 15]]
      ],
      RECT
    )
    const runs = gridDimRuns(lines, GAP)
    expect(runs.map((r) => [r.family, Math.round(r.spacing * 1000)])).toEqual([
      [0, 6000],
      [1, 7500],
      [1, 7500]
    ])
  })

  it('skips a pair that is not parallel within 0.5°, such as a radial grid', () => {
    // Three lines through the origin, 5° apart: one family (10° tolerance), no spacing.
    const ray = (deg: number): [XY, XY] => [
      [0, 0],
      [Math.cos((deg * Math.PI) / 180) * 30, Math.sin((deg * Math.PI) / 180) * 30]
    ]
    const lines = drawn([ray(80), ray(85), ray(90)], RECT)
    expect(new Set(lines.map((l) => l.family)).size).toBe(1)
    expect(gridDimRuns(lines, GAP)).toEqual([])
    // 0.4° apart is still a dimension; 0.6° is not.
    const pair = (deg: number): GridDimLine[] =>
      drawn(
        [
          [[0, 0], [0, 30]],
          [
            [8, 0],
            [8 + Math.sin((deg * Math.PI) / 180) * 30, Math.cos((deg * Math.PI) / 180) * 30]
          ]
        ],
        RECT
      )
    expect(gridDimRuns(pair(0.4), GAP)).toHaveLength(1)
    expect(gridDimRuns(pair(0.6), GAP)).toHaveLength(0)
  })

  it('orders a family across by midpoint, so a tilted member between two lines is not skipped', () => {
    // B leans 8° and sits between A and C at mid-height, but its start end is left of A's.
    const t = Math.tan((8 * Math.PI) / 180)
    const lines = drawn(
      [
        [[0, 0], [0, 30]],
        [[3, 15], [3 + t * 10, 25]],
        [[6, 0], [6, 30]]
      ],
      RECT
    )
    expect(new Set(lines.map((l) => l.family)).size).toBe(1)
    expect(lines[1].p0[0]).toBeLessThan(lines[0].p0[0])
    // By start ends the order would be B, A, C and A–C would get a 6 000 mm dimension across B.
    // By midpoints it is A, B, C: both pairs are 8° apart, so there is no dimension at all.
    expect(gridDimRuns(lines, GAP)).toEqual([])
  })

  it('skips a coincident duplicate without breaking the chain', () => {
    const lines = drawn(
      [
        [[0, 0], [0, 30]],
        [[0, 5], [0, 25]],
        [[9, 0], [9, 30]]
      ],
      RECT
    )
    expect(gridDimRuns(lines, GAP).map((r) => Math.round(r.spacing * 1000))).toEqual([9000])
  })

  it('handles two parallel lines recorded in opposite canonical senses (near 90°)', () => {
    const d = (deg: number): XY => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)]
    const a = d(89.9)
    const b = d(90.1)
    const lines = drawn(
      [
        [[0, 0], [a[0] * 30, a[1] * 30]],
        [[5, 0], [5 + b[0] * 30, b[1] * 30]]
      ],
      RECT
    )
    // canonicalDir flips one of them, so their p0 ends are at opposite sides of the rect.
    expect(Math.sign(lines[0].p1[1] - lines[0].p0[1])).not.toBe(Math.sign(lines[1].p1[1] - lines[1].p0[1]))
    const [run] = gridDimRuns(lines, GAP)
    // 0.2° apart they converge a little along 50 m; measured at the start end it is ~5 m.
    expect(run.spacing).toBeCloseTo(5, 0)
    // The run is at line i's start end, not stretched along the grid to the other side.
    expect(run.at[1]).toBeLessThan(RECT.minY)
  })

  it('a rotated grid at −43.4103° keeps its spacing and steps with the bubbles', () => {
    const th = (-43.4103 * Math.PI) / 180
    const u: XY = [Math.cos(th), Math.sin(th)]
    const n: XY = [-u[1], u[0]]
    // Five grids 7.2 m apart along the normal, as a real rotated grid comes across.
    const spacing = [7.2, 7.2, 8.1, 6.3]
    let off = 0
    const segs: [XY, XY][] = [0, ...spacing].map((s) => {
      off += s
      const o: XY = [12 + n[0] * off, 9 + n[1] * off]
      return [o, [o[0] + u[0] * 10, o[1] + u[1] * 10]]
    })
    const rect: Rect = { minX: -40, minY: -40, maxX: 80, maxY: 80 }
    const lines = drawn(segs, rect)
    const runs = gridDimRuns(lines, GAP)
    expect(runs.map((r) => +r.spacing.toFixed(9))).toEqual(spacing)
    for (const r of runs) {
      // Perpendicular to the grid, and inside both start bubbles: the run's own position along
      // the grid is at or beyond (inward of) each line's bubble.
      expect(Math.abs(r.span[0] * r.dir[0] + r.span[1] * r.dir[1])).toBeLessThan(1e-9)
      const along = (p: XY): number => p[0] * r.dir[0] + p[1] * r.dir[1]
      const runAt = along(r.at)
      expect(runAt).toBeGreaterThanOrEqual(along(lines[r.i].p0) - GAP - 1e-9)
      expect(runAt).toBeGreaterThanOrEqual(along(lines[r.j].p0) - GAP - 1e-9)
      expect(Math.max(along(lines[r.i].p0), along(lines[r.j].p0)) - GAP).toBeCloseTo(runAt, 9)
    }
  })
})

describe('gridDimOffset and gridDimStandoffPx', () => {
  it('is a fixed screen distance, capped', () => {
    expect(gridDimOffset(10, 100, 34)).toBeCloseTo(3.4, 12)
    expect(gridDimOffset(100, 100, 34)).toBeCloseTo(0.34, 12)
    // End-on, or a degenerate projection: the cap.
    expect(gridDimOffset(0.01, 5, 34)).toBe(5)
    expect(gridDimOffset(0, 5, 34)).toBe(5)
    expect(gridDimOffset(Number.NaN, 5, 34)).toBe(5)
  })

  it('clears the bubble by the label’s own half-extent along the grid', () => {
    // A grid running up the screen: the label's half-height is what stands between.
    expect(gridDimStandoffPx(0, 1, 32.5, 10.5)).toBe(BUBBLE_RADIUS_PX + GRID_DIM_CLEAR_PX + 10.5)
    // Running across the screen: its half-width.
    expect(gridDimStandoffPx(-1, 0, 32.5, 10.5)).toBe(BUBBLE_RADIUS_PX + GRID_DIM_CLEAR_PX + 32.5)
    // At 45° the box's support along the direction.
    const r = Math.SQRT1_2
    expect(gridDimStandoffPx(r, -r, 32.5, 10.5)).toBeCloseTo(21 + r * 43, 12)
  })
})

describe('declutter with grid-dimension labels', () => {
  const box = (x: number, w = 26, y = 0): BubbleItem['rect'] => ({
    left: x - w / 2,
    top: y - 13,
    right: x + w / 2,
    bottom: y + 13
  })

  it('never hides a bubble, and leaves the bubbles’ answer exactly as without them', () => {
    const bubbles: BubbleItem[] = [0, 20, 40, 60].map((x, i) => ({
      key: `0:-1#${i}`,
      row: '0:-1',
      order: i,
      rect: box(x)
    }))
    const dims: BubbleItem[] = [10, 30, 50].map((x, i) => ({
      key: `dim:0#${i}`,
      row: 'dim:0',
      order: i,
      rect: box(x, 50),
      after: true
    }))
    const alone = declutterBubbles(bubbles)
    const withDims = declutterBubbles([...dims, ...bubbles])
    expect([...withDims].filter((k) => !k.startsWith('dim')).sort()).toEqual([...alone].sort())
    // Every one of these dimension labels sits on a kept bubble, so none is drawn.
    expect([...withDims].some((k) => k.startsWith('dim'))).toBe(false)
  })

  it('hides a dimension label that would hit a bubble of any row, or an earlier label', () => {
    const items: BubbleItem[] = [
      { key: '1:-1#0', row: '1:-1', order: 0, rect: box(0) },
      // Clear of everything.
      { key: 'dim:0#0', row: 'dim:0', order: 0, rect: box(200, 50), after: true },
      // Overlaps the kept label before it.
      { key: 'dim:0#1', row: 'dim:0', order: 1, rect: box(230, 50), after: true },
      // Overlaps a bubble of another family's row.
      { key: 'dim:0#2', row: 'dim:0', order: 2, rect: box(20, 50), after: true },
      // Clear again: comes back.
      { key: 'dim:0#3', row: 'dim:0', order: 3, rect: box(400, 50), after: true }
    ]
    const shown = declutterBubbles(items)
    expect([...shown].sort()).toEqual(['1:-1#0', 'dim:0#0', 'dim:0#3'])
  })
})
