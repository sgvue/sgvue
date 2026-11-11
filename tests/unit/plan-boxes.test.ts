/**
 * The plan-frame box beside `IfcElement.bbox` — "option A", owner-approved 2026-11-11.
 *
 * Since 2026-11-07 every model is drawn at its file's own world coordinates and only the camera's
 * plan frame turns (ρ, `shared/plan-rotation.ts`). `IfcElement.bbox` stays the world-axis box; a
 * second box, square with the building, is added beside it for the assistant's box tools and the
 * SQL `plan_box` table. This file pins the module that makes it, `model/plan-boxes.ts`:
 *
 *   · **plan coordinates** `(u, v, z)` are a world point turned by −ρ about the world Z axis
 *     through the WORLD origin: `u = x·cos ρ + y·sin ρ`, `v = −x·sin ρ + y·cos ρ`, z unchanged —
 *     which is the viewer's plan box (the *scene* turned by −ρ about the scene origin) plus the
 *     federation offset turned the same way;
 *   · at ρ = 0 the frame is `'world'` and a box is the element's own `bbox` array, the very same
 *     reference, so nothing downstream can drift by a rounding;
 *   · an element the viewer has no plan box for (no viewer, `null`, or a box for another ρ)
 *     falls back to the plan-coordinate box of its world box's four footprint corners — larger
 *     than the element, never smaller, never `null`.
 *
 * Every expected number is worked out here from the formula above and the synthetic site's own
 * numbers (`synthetic-boxes.ts`) — never read back from the module under test.
 *
 * The whole module is `NOT YET IN src/`: this file fails at its import until it exists.
 */
import { Box3, Vector3 } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
// NOT YET IN src/: the module, and every name imported from it.
import { planBoxRows, planFrameOf, type Box6 } from '../../src/renderer/model/plan-boxes'
import { boxCorners, SITE_MM, SITE_TURN_DEG, type BoxSpec } from './synthetic-boxes'

type V3 = [number, number, number]

/** ρ in degrees and radians: the synthetic site's turn, −43.4103°. */
const RHO_DEG = SITE_TURN_DEG
const RHO = (RHO_DEG * Math.PI) / 180

/**
 * A federation offset tens of kilometres out, composed from the synthetic site's own numbers
 * (whole metres below it, as the streamer chooses one) — never a coordinate written by hand.
 */
const OFFSET: V3 = [Math.floor(SITE_MM[0] / 1000), Math.floor(SITE_MM[1] / 1000), Math.floor(SITE_MM[2] / 1000)]

/** A world point (m) in plan coordinates, by the contract's formula. */
const plan = (p: readonly number[], rho = RHO): V3 => [
  p[0] * Math.cos(rho) + p[1] * Math.sin(rho),
  -p[0] * Math.sin(rho) + p[1] * Math.cos(rho),
  p[2]
]
/** A scene point (world − offset) turned by −ρ about the scene origin, as the viewer's plan box is. */
const scenePlan = (p: readonly number[], rho = RHO): V3 => plan([p[0] - OFFSET[0], p[1] - OFFSET[1], p[2] - OFFSET[2]], rho)

const aabb = (pts: readonly V3[]): Box6 => [
  Math.min(...pts.map((p) => p[0])),
  Math.min(...pts.map((p) => p[1])),
  Math.min(...pts.map((p) => p[2])),
  Math.max(...pts.map((p) => p[0])),
  Math.max(...pts.map((p) => p[1])),
  Math.max(...pts.map((p) => p[2]))
]

/** A wall 6.000 × 0.100 × 3.000 m, square with the building — diagonal in world axes. */
const WALL: BoxSpec = { name: 'Wall', at: [1000, 2000, 0], size: [6000, 100, 3000] }
/** Its world-axis box (m), from the file's numbers: what `IfcElement.bbox` holds. */
const WALL_WORLD: Box6 = aabb(boxCorners(WALL))
/** Its true plan-coordinate box: every corner turned by −ρ about the world origin. */
const WALL_PLAN: Box6 = aabb(boxCorners(WALL).map((c) => plan(c)))
/** What the viewer hands back for it: the scene-plan box, `rho` in radians. */
const WALL_VIEWER_BOX = (): Box3 => new Box3().setFromPoints(boxCorners(WALL).map((c) => new Vector3(...scenePlan(c))))

/** A viewer that knows the wall (id 7) and nothing else. */
const viewerFor = (rho = RHO) => ({
  elementPlanBox: (id: number) => (id === 7 ? { box: WALL_VIEWER_BOX(), rho } : null)
})

const near = (got: readonly number[] | null, want: readonly number[], tol: number): string[] => {
  if (!got) return ['got null']
  return want.flatMap((w, i) => (Math.abs(got[i] - w) > tol ? [`[${i}] ${got[i]} ≠ ${w}`] : []))
}

describe('the fixture', () => {
  it('the wall’s world box is far from its plan box, and the offset is tens of kilometres out', () => {
    // 6.0 × 0.1 m square with the building reads ~4.4 × 4.2 m in world axes.
    expect(WALL_WORLD[3] - WALL_WORLD[0]).toBeGreaterThan(4)
    expect(WALL_WORLD[4] - WALL_WORLD[1]).toBeGreaterThan(4)
    expect(Math.abs(WALL_PLAN[3] - WALL_PLAN[0] - 6)).toBeLessThan(1e-9)
    expect(Math.abs(WALL_PLAN[4] - WALL_PLAN[1] - 0.1)).toBeLessThan(1e-9)
    expect(Math.hypot(OFFSET[0], OFFSET[1])).toBeGreaterThan(10_000)
  })
})

describe('planFrameOf at ρ = 0 (NOT YET IN src/)', () => {
  it('is the world frame, and a box is the element’s own bbox array — the same reference', () => {
    const frame = planFrameOf(0, OFFSET, viewerFor(0))
    expect(frame.frame).toBe('world')
    expect(frame.rotationDeg).toBe(0)
    const e = { id: 7, bbox: WALL_WORLD }
    expect(frame.box(e)).toBe(e.bbox)
  })

  it('never asks the viewer, even one that would answer wrong', () => {
    const lying = { elementPlanBox: () => ({ box: new Box3(new Vector3(0, 0, 0), new Vector3(1, 1, 1)), rho: 0 }) }
    const e = { id: 7, bbox: WALL_WORLD }
    expect(planFrameOf(0, OFFSET, lying).box(e)).toBe(e.bbox)
    expect(planFrameOf(0, OFFSET, null).box(e)).toBe(e.bbox)
  })

  it('an element with no bbox has no box', () => {
    expect(planFrameOf(0, OFFSET, viewerFor(0)).box({ id: 7 })).toBeNull()
  })

  it('planBoxRows is undefined for the world frame', () => {
    expect(planBoxRows(planFrameOf(0, OFFSET, null), [{ id: 7, bbox: WALL_WORLD }])).toBeUndefined()
  })
})

describe('planFrameOf at ρ = −43.4103° (NOT YET IN src/)', () => {
  it('is the plan frame, and says its rotation', () => {
    const frame = planFrameOf(RHO_DEG, OFFSET, viewerFor())
    expect(frame.frame).toBe('plan')
    expect(frame.rotationDeg).toBe(RHO_DEG)
  })

  it('a box is the viewer’s plan box in plan coordinates: the scene box plus the offset turned by −ρ', () => {
    const got = planFrameOf(RHO_DEG, OFFSET, viewerFor()).box({ id: 7, bbox: WALL_WORLD })
    // Against the file's own corners turned about the world origin…
    expect(near(got, WALL_PLAN, 1e-6)).toEqual([])
    // …and against the viewer's box moved by hand, which is the same thing said the other way.
    const t = plan(OFFSET)
    const vb = WALL_VIEWER_BOX()
    const moved = [vb.min.x + t[0], vb.min.y + t[1], vb.min.z + t[2], vb.max.x + t[0], vb.max.y + t[1], vb.max.z + t[2]]
    expect(near(got, moved, 1e-9)).toEqual([])
    // It is square with the building: 6.0 × 0.1 × 3.0 m.
    expect(Math.abs(got![3] - got![0] - 6)).toBeLessThan(1e-3)
    expect(Math.abs(got![4] - got![1] - 0.1)).toBeLessThan(1e-3)
    expect(Math.abs(got![5] - got![2] - 3)).toBeLessThan(1e-3)
  })

  it('an element with no bbox has no box, whatever the viewer says', () => {
    expect(planFrameOf(RHO_DEG, OFFSET, viewerFor()).box({ id: 7 })).toBeNull()
  })

  /** The fallback, by hand: the world box's four footprint corners in plan coordinates. */
  const fallback = (b: Box6): Box6 => {
    const foot: V3[] = [
      [b[0], b[1], b[2]],
      [b[3], b[1], b[2]],
      [b[0], b[4], b[2]],
      [b[3], b[4], b[2]]
    ].map((p) => plan(p))
    const f = aabb(foot)
    return [f[0], f[1], b[2], f[3], f[4], b[5]]
  }
  const contains = (outer: Box6, inner: Box6, tol = 1e-9): boolean =>
    [0, 1, 2].every((k) => outer[k] <= inner[k] + tol && outer[k + 3] >= inner[k + 3] - tol)

  for (const [label, viewer] of [
    ['no viewer', null],
    ['the viewer gives null', { elementPlanBox: () => null }],
    ['the viewer’s box is for another ρ', viewerFor(RHO + 0.1)],
    ['the viewer’s box is for ρ = 0', viewerFor(0)]
  ] as const) {
    it(`falls back, conservatively, when ${label}`, () => {
      const got = planFrameOf(RHO_DEG, OFFSET, viewer).box({ id: 7, bbox: WALL_WORLD })
      expect(got).not.toBeNull()
      expect(near(got, fallback(WALL_WORLD), 1e-6)).toEqual([])
      // Never smaller than the element itself.
      expect(contains(got!, WALL_PLAN)).toBe(true)
    })
  }

  it('planBoxRows: one id and six plan coordinates per element that has a box, in order', () => {
    const frame = planFrameOf(RHO_DEG, OFFSET, viewerFor())
    const other: Box6 = [OFFSET[0], OFFSET[1], OFFSET[2], OFFSET[0] + 1, OFFSET[1] + 2, OFFSET[2] + 3]
    const rows = planBoxRows(frame, [{ id: 9, bbox: other }, { id: 8 }, { id: 7, bbox: WALL_WORLD }])
    expect(rows).toBeDefined()
    expect(rows!.rotationDeg).toBe(RHO_DEG)
    expect(rows!.ids).toBeInstanceOf(Float64Array)
    expect(rows!.boxes).toBeInstanceOf(Float64Array)
    expect([...rows!.ids]).toEqual([9, 7])
    expect(rows!.boxes.length).toBe(12)
    // Element 9: no viewer box (the stub knows only 7), so its footprint fallback.
    expect(near([...rows!.boxes.slice(0, 6)], fallback(other), 1e-6)).toEqual([])
    expect(near([...rows!.boxes.slice(6, 12)], WALL_PLAN, 1e-6)).toEqual([])
  })
})
