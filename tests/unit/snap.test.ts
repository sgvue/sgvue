/**
 * Snapping — `design-reference/design/viewer-core.js` L337–359.
 *
 * The rule is a precedence with three screen-space radii in it, and every one of those
 * numbers is part of the fidelity contract (`CLAUDE.md`: "16/11 px snap radii"). `snapPoint`
 * is pure and takes its projection as a function, so the whole rule can be checked on
 * numbers with a projection that is just "drop z" — no camera, no canvas, no renderer.
 *
 * 2026-09-28 adds the surface rule (`SnapDepth`): a candidate hidden behind the hit face or
 * cut away by the section is never taken, one on the hit face's plane beats one off it, and an
 * edge whose foot is hidden gives its nearest-to-camera visible point. Those cases use real
 * three.js cameras and `overlay.ts`'s own `toPixels`, in perspective and orthographic both.
 *
 * 2026-10-01: `SnapDepth.clips` is a list, because two section planes can cut at once — a
 * candidate cut away by **either** is never taken, and a hidden-foot edge is narrowed by both.
 */
import {
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Vector2,
  Vector3
} from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { toPixels, type ViewerCamera } from '../../src/renderer/viewer/overlay'
import type { ProjectPoint, SnapCache, SnapDepth } from '../../src/renderer/viewer/snap'
import {
  SNAP_AXIS_PX,
  SNAP_CORNER_PX,
  SNAP_EDGE_PX,
  SNAP_PLANE_TOL,
  markerStyle,
  snapPoint
} from '../../src/renderer/viewer/snap'

/** World x/y are screen px, world z is depth: one world unit is one pixel, so radii read directly. */
const project: ProjectPoint = (p: Vector3, out: Vector2) => out.set(p.x, p.y)

const v = (x: number, y: number, z = 0): Vector3 => new Vector3(x, y, z)

/** A square with corners at (0,0), (100,0), (100,100), (0,100) — segments along its sides. */
function square(): SnapCache {
  const c = [v(0, 0), v(100, 0), v(100, 100), v(0, 100)]
  return {
    verts: c,
    segs: [
      [c[0], c[1]],
      [c[1], c[2]],
      [c[2], c[3]],
      [c[3], c[0]]
    ]
  }
}

describe('snapPoint — the radii', () => {
  it('catches a corner inside 16 px and lets it go outside', () => {
    // 15 px away: caught.
    expect(snapPoint(square(), v(15, 0), null, 15, 0, null, true, project).type).toBe('corner')
    // 17 px away is outside 16, and 17 px along the bottom edge is inside 11 of it, so the
    // reference falls through to the edge — which is the precedence, tested below.
    const far = snapPoint(square(), v(17, 40, 0), null, 17, 40, null, true, project)
    expect(far.type).toBe('face')
    expect(SNAP_CORNER_PX).toBe(16)
  })

  it('catches an edge inside 11 px and lets it go outside', () => {
    // 10 px above the middle of the bottom edge, far from either corner.
    const near = snapPoint(square(), v(50, 30), null, 50, 10, null, true, project)
    expect(near.type).toBe('edge')
    // The snapped point is the foot on the segment, not the hit point.
    expect(near.p.x).toBeCloseTo(50)
    expect(near.p.y).toBeCloseTo(0)

    const far = snapPoint(square(), v(50, 30), null, 50, 12, null, true, project)
    expect(far.type).toBe('face')
    expect(SNAP_EDGE_PX).toBe(11)
  })

  it('falls back to the hit point itself, untouched', () => {
    const out = snapPoint(square(), v(50, 50, 7), null, 50, 50, null, true, project)
    expect(out.type).toBe('face')
    expect(out.p.toArray()).toEqual([50, 50, 7])
  })

  it('returns `face` at the hit point with snapping off, however close a corner is', () => {
    const out = snapPoint(square(), v(1, 1, 3), null, 1, 1, null, false, project)
    expect(out.type).toBe('face')
    expect(out.p.toArray()).toEqual([1, 1, 3])
  })
})

describe('snapPoint — the precedence', () => {
  it('a corner beats an edge that is nearer in pixels', () => {
    // 2 px above the bottom edge (distance 2) and 12 px from the corner at (0,0).
    const out = snapPoint(square(), v(12, 40), null, 12, 2, null, true, project)
    expect(out.type).toBe('corner')
    expect(out.p.toArray()).toEqual([0, 0, 0])
  })

  it('an edge beats the face', () => {
    const out = snapPoint(square(), v(50, 40), null, 50, 5, null, true, project)
    expect(out.type).toBe('edge')
  })

  it('an axis lock overrides an edge but never a corner', () => {
    const from = v(50, 0)
    // The cursor sits on the bottom edge 30 px along from `from`, so the dominant delta is x
    // and the axis-locked point is the edge point itself — within 10 px of the cursor.
    const onEdge = snapPoint(square(), v(80, 3), null, 80, 3, from, true, project)
    expect(onEdge.type).toBe('axis X')

    // Same geometry, but the cursor is now 4 px from the corner at (100,0): corner wins.
    const onCorner = snapPoint(square(), v(96, 2), null, 96, 2, from, true, project)
    expect(onCorner.type).toBe('corner')
  })

  it('locks to the dominant axis of the delta', () => {
    const cache: SnapCache = { verts: [], segs: [] }
    const from = v(0, 0)
    // Delta (3, 40): y dominates, so the locked point is (0, 40) — 3 px from the cursor.
    const out = snapPoint(cache, v(3, 40), null, 3, 40, from, true, project)
    expect(out.type).toBe('axis Y')
    expect(out.p.toArray()).toEqual([0, 40, 0])
    expect(SNAP_AXIS_PX).toBe(10)
  })

  /**
   * The perpendicular is only reachable when the run's dominant axis is *not* the hit face's
   * normal: both candidates are the delta with one component removed, so if those are the
   * same component the axis lock — which is tested first — always wins. Here the run is
   * (12, 3, 20) from `from` to the hit, so the dominant axis is z while the face normal is x.
   */
  const HIT = v(60, 40, 0)
  const FROM = v(48, 37, -20)

  it('finds the perpendicular foot onto the hit face when nothing else catches', () => {
    const cache: SnapCache = { verts: [], segs: [] }
    // The axis-locked point lands at (48, 37) on screen, 12.4 px from the cursor — outside
    // the 10 px radius. The foot of the perpendicular lands at (60, 37), 3 px away.
    const out = snapPoint(cache, HIT, v(1, 0, 0), 60, 40, FROM, true, project)
    expect(out.type).toBe('perpendicular')
    expect(out.p.x).toBeCloseTo(60)
    expect(out.p.y).toBeCloseTo(37)
    // The foot lies in the hit face's plane (x = 60), which is what makes it a right angle.
    expect(out.p.z).toBeCloseTo(-20)
  })

  it('does not look for a perpendicular without a face normal', () => {
    const cache: SnapCache = { verts: [], segs: [] }
    const out = snapPoint(cache, HIT, null, 60, 40, FROM, true, project)
    expect(out.type).toBe('face')
  })
})

describe('markerStyle', () => {
  it('is the reference glyph for each kind (L611–612)', () => {
    expect(markerStyle('corner')).toEqual({
      borderRadius: '2px',
      size: '11px',
      borderWidth: '2.5px'
    })
    expect(markerStyle('edge')).toEqual({
      borderRadius: '50%',
      size: '11px',
      borderWidth: '2.5px'
    })
    expect(markerStyle('face')).toEqual({
      borderRadius: '50%',
      size: '7px',
      borderWidth: '2px'
    })
    // An axis lock and a perpendicular draw the 11 px circle, as everything but a face does.
    expect(markerStyle('axis Z').size).toBe('11px')
    expect(markerStyle('perpendicular').borderRadius).toBe('50%')
  })
})

/* ────────────────────────── 2026-09-28: the surface being looked at ────────────────────────── */

const W = 1000
const H = 800
type Clip = { n: Vector3; c: number }
/** No section plane is cutting. `SnapDepth.clips` holds the ones that are: none, one or two. */
const NO_CLIP: Clip[] = []
const UP = new Vector3(0, 0, 1)

/** A camera at `eye` looking at `at`, matrices current, as the viewer's are after a frame. */
function cam(kind: 'persp' | 'ortho', eye: Vector3, at: Vector3, up = UP): ViewerCamera {
  const c: ViewerCamera =
    kind === 'persp'
      ? new PerspectiveCamera(45, W / H, 0.1, 1000)
      : new OrthographicCamera((-6 * W) / H, (6 * W) / H, 6, -6, 0.1, 1000)
  c.up.copy(up)
  c.position.copy(eye)
  c.lookAt(at)
  c.updateMatrixWorld(true)
  c.updateProjectionMatrix()
  return c
}

/** What `createSnapper` hands `snapPoint` for this camera. */
function viewOf(c: ViewerCamera, clips = NO_CLIP): { project: ProjectPoint; depth: SnapDepth } {
  return {
    project: (p, out) => toPixels(p, c, W, H, out),
    depth: {
      eye: (c as PerspectiveCamera).isPerspectiveCamera ? c.position.clone() : null,
      forward: c.getWorldDirection(new Vector3()),
      tol: SNAP_PLANE_TOL,
      clips
    }
  }
}

const px = (c: ViewerCamera, p: Vector3): Vector2 => toPixels(p, c, W, H, new Vector2())

/** Where the ray under pixel (x, y) meets a plane — the pick on a flat face. */
function hitAt(c: ViewerCamera, x: number, y: number, plane: Plane): Vector3 {
  const r = new Raycaster()
  r.setFromCamera(new Vector2((x / W) * 2 - 1, -((y / H) * 2 - 1)), c)
  return r.ray.intersectPlane(plane, new Vector3())!
}
const level = (z: number): Plane => new Plane(new Vector3(0, 0, 1), -z)

/** An axis-aligned box's eight corners (the four at `min.z` first) and twelve edges. */
function box(min: Vector3, max: Vector3): SnapCache {
  const c = (i: number): Vector3 =>
    new Vector3(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z)
  const verts = [0, 1, 2, 3, 4, 5, 6, 7].map(c)
  const E = [0, 1, 1, 3, 3, 2, 2, 0, 4, 5, 5, 7, 7, 6, 6, 4, 0, 4, 1, 5, 3, 7, 2, 6]
  const segs: [Vector3, Vector3][] = []
  for (let i = 0; i < E.length; i += 2) segs.push([verts[E[i]], verts[E[i + 1]]])
  return { verts, segs }
}

describe('snapPoint — the surface being looked at (2026-09-28)', () => {
  /**
   * A 300 mm slab, x 0–4, y 0–3, top at z = 0, seen in plan from straight above its corner at
   * the origin, so the top corner and the soffit corner under it land on the same pixel. The
   * soffit corners come first in the cache, so the design's "nearest, first on a tie" takes
   * the soffit — which is the defect: the spot reads the underside.
   */
  const slab = box(new Vector3(0, 0, -0.3), new Vector3(4, 3, 0))

  for (const kind of ['ortho', 'persp'] as const) {
    it(`in plan (${kind}), the top corner wins over the soffit corner on the same pixel`, () => {
      const c = cam(kind, new Vector3(0, 0, 10), new Vector3(0, 0, 0), new Vector3(0, 1, 0))
      const top = px(c, new Vector3(0, 0, 0))
      const soffit = px(c, new Vector3(0, 0, -0.3))
      expect(top.distanceTo(soffit)).toBeLessThan(1e-6)
      // Five pixels into the top face from the corner.
      const x = top.x + 5
      const y = top.y - 5
      const hit = hitAt(c, x, y, level(0))
      const { project, depth } = viewOf(c)

      const design = snapPoint(slab, hit, UP, x, y, null, true, project)
      expect(design.type).toBe('corner')
      expect(design.p.z).toBeCloseTo(-0.3)

      const now = snapPoint(slab, hit, UP, x, y, null, true, project, depth)
      expect(now.type).toBe('corner')
      expect(now.p.toArray()).toEqual([0, 0, 0])
      // Same pixel, same distance: only which corner was taken changed.
      expect(now.d).toBeCloseTo(design.d, 9)
    })
  }

  it('in perspective, a soffit corner nearer in pixels than the top corner is still refused', () => {
    // Looking straight down at the slab's middle: the soffit corner, deeper, lands nearer the
    // middle of the picture than the top corner above it.
    const c = cam('persp', new Vector3(2, 1.5, 10), new Vector3(2, 1.5, 0), new Vector3(0, 1, 0))
    const top = px(c, new Vector3(0, 0, 0))
    const soffit = px(c, new Vector3(0, 0, -0.3))
    expect(top.distanceTo(soffit)).toBeGreaterThan(4)
    // Into the face along the diagonal, a little past the soffit corner's pixel.
    const x = top.x + (soffit.x - top.x) * 1.3
    const y = top.y + (soffit.y - top.y) * 1.3
    const hit = hitAt(c, x, y, level(0))
    const { project, depth } = viewOf(c)
    expect(snapPoint(slab, hit, UP, x, y, null, true, project).p.z).toBeCloseTo(-0.3)
    const now = snapPoint(slab, hit, UP, x, y, null, true, project, depth)
    expect(now.type).toBe('corner')
    expect(now.p.toArray()).toEqual([0, 0, 0])
  })

  /**
   * A 400 × 400 × 3 000 mm column seen from above in perspective: its vertical edge at the
   * origin projects to a stroke of about a hundred pixels that runs *under* the column's own
   * top face, and the design's edge rule takes the foot on that stroke — a point somewhere down
   * the column.
   */
  const column = box(new Vector3(0, 0, 0), new Vector3(0.4, 0.4, 3))
  const above = (): ViewerCamera =>
    cam('persp', new Vector3(1, 1, 8), new Vector3(1, 1, 0), new Vector3(0, 1, 0))

  it('a vertical edge seen from above never gives a point down its length', () => {
    const c = above()
    const top = px(c, new Vector3(0, 0, 3))
    const foot = px(c, new Vector3(0, 0, 0))
    expect(top.distanceTo(foot)).toBeGreaterThan(60)
    // 40 px down the stroke from the top corner: on the top face, clear of every corner.
    const u = foot.clone().sub(top).normalize()
    const x = top.x + u.x * 40
    const y = top.y + u.y * 40
    const hit = hitAt(c, x, y, level(3))
    const { project, depth } = viewOf(c)

    const design = snapPoint(column, hit, UP, x, y, null, true, project)
    expect(design.type).toBe('edge')
    expect(design.p.z).toBeGreaterThan(0.5)
    expect(design.p.z).toBeLessThan(2.5)

    // Everything down the edge is behind the top face, so the top face itself is the answer.
    const now = snapPoint(column, hit, UP, x, y, null, true, project, depth)
    expect(now.p.z).toBeCloseTo(3, 9)
  })

  it('an edge whose foot is hidden gives its nearest visible point: a vertical edge, its top', () => {
    const c = above()
    const a = new Vector3(0, 0, 3)
    const b = new Vector3(0, 0, 0)
    const top = px(c, a)
    const u = px(c, b).sub(top).normalize()
    // 6 px down the stroke: the design's foot is well down the column, behind the top face.
    const x = top.x + u.x * 6
    const y = top.y + u.y * 6
    const hit = hitAt(c, x, y, level(3))
    const { project, depth } = viewOf(c)
    const edgeOnly: SnapCache = { verts: [], segs: [[a, b]] }
    const design = snapPoint(edgeOnly, hit, UP, x, y, null, true, project)
    expect(design.type).toBe('edge')
    expect(design.p.z).toBeLessThan(2.9)
    const now = snapPoint(edgeOnly, hit, UP, x, y, null, true, project, depth)
    expect(now.type).toBe('edge')
    expect(now.p.toArray()).toEqual([0, 0, 3])
    expect(now.d).toBeCloseTo(6, 6)
    // With the whole column in the cache, the top corner catches it first — the same point.
    const full = snapPoint(column, hit, UP, x, y, null, true, project, depth)
    expect(full.type).toBe('corner')
    expect(full.p.toArray()).toEqual([0, 0, 3])
  })

  it('a corner behind the face under the cursor is refused', () => {
    // A 200 mm wall seen from the front and a little off-axis: its back top corner lands a few
    // pixels from its front top corner, and the cursor is nearer the back one.
    const wall = box(new Vector3(0, 0, 0), new Vector3(4, 0.2, 3))
    const c = cam('persp', new Vector3(3, -8, 2), new Vector3(2, 0, 1.5))
    const front = px(c, new Vector3(0, 0, 3))
    const back = px(c, new Vector3(0, 0.2, 3))
    expect(front.distanceTo(back)).toBeGreaterThan(2)
    // 5 px below the back corner's pixel, on the front face, and inside 16 px of both.
    const x = back.x
    const y = back.y + 5
    expect(Math.hypot(x - front.x, y - front.y)).toBeLessThan(SNAP_CORNER_PX)
    const hit = hitAt(c, x, y, new Plane(new Vector3(0, 1, 0), 0))
    expect(hit.x).toBeGreaterThan(0)
    expect(hit.z).toBeLessThan(3)
    const n = new Vector3(0, -1, 0)
    const { project, depth } = viewOf(c)
    expect(snapPoint(wall, hit, n, x, y, null, true, project).p.y).toBeCloseTo(0.2)
    const now = snapPoint(wall, hit, n, x, y, null, true, project, depth)
    expect(now.type).toBe('corner')
    expect(now.p.toArray()).toEqual([0, 0, 3])
  })

  /** Plan, orthographic, looking down at z = 0; `k` is pixels per metre. */
  const plan = (): { c: ViewerCamera; k: number; at: Vector2 } => {
    const c = cam('ortho', new Vector3(0, 0, 10), new Vector3(0, 0, 0), new Vector3(0, 1, 0))
    const at = px(c, new Vector3(0, 0, 0))
    return { c, k: px(c, new Vector3(1, 0, 0)).x - at.x, at }
  }

  it('a corner on the hit face beats a nearer visible corner off it', () => {
    const { c, k, at } = plan()
    // A step up: the raised corner, 500 mm towards the camera, is 4 px from the cursor; the
    // corner on the face under the cursor is 10 px away.
    const onFace = new Vector3(10 / k, 0, 0)
    const raised = new Vector3(-4 / k, 0, 0.5)
    const cache: SnapCache = { verts: [raised, onFace], segs: [] }
    const hit = hitAt(c, at.x, at.y, level(0))
    const { project, depth } = viewOf(c)
    expect(snapPoint(cache, hit, UP, at.x, at.y, null, true, project).p).toEqual(raised)
    const now = snapPoint(cache, hit, UP, at.x, at.y, null, true, project, depth)
    expect(now.p.toArray()).toEqual(onFace.toArray())
    expect(now.d).toBeCloseTo(10, 6)
    // With nothing on the face inside the radius, the visible one off it is still taken.
    const alone: SnapCache = { verts: [raised], segs: [] }
    const off = snapPoint(alone, hit, UP, at.x, at.y, null, true, project, depth)
    expect(off.type).toBe('corner')
    expect(off.p).toEqual(raised)
  })

  it('an edge on the hit face beats a nearer corner off it; the design takes the corner', () => {
    const { c, k, at } = plan()
    const raised = new Vector3(-4 / k, 0, 0.5)
    const cache: SnapCache = {
      verts: [raised],
      segs: [[new Vector3(-1, 6 / k, 0), new Vector3(1, 6 / k, 0)]]
    }
    const hit = hitAt(c, at.x, at.y, level(0))
    const { project, depth } = viewOf(c)
    expect(snapPoint(cache, hit, UP, at.x, at.y, null, true, project).type).toBe('corner')
    const now = snapPoint(cache, hit, UP, at.x, at.y, null, true, project, depth)
    expect(now.type).toBe('edge')
    expect(now.p.x).toBeCloseTo(0, 9)
    expect(now.p.y).toBeCloseTo(6 / k, 9)
  })

  it('a candidate on the cut-away side of the section is never taken', () => {
    const { c, k, at } = plan()
    // The section keeps x <= 0: `n·p + c >= 0` with n = (−1, 0, 0), c = 0.
    const clip = { n: new Vector3(-1, 0, 0), c: 0 }
    const cut = new Vector3(4 / k, 0, 0)
    const kept = new Vector3(-10 / k, 0, 0)
    const cache: SnapCache = { verts: [cut, kept], segs: [] }
    const hit = hitAt(c, at.x, at.y, level(0))
    const { project, depth } = viewOf(c, [clip])
    expect(snapPoint(cache, hit, UP, at.x, at.y, null, true, project).p).toEqual(cut)
    expect(snapPoint(cache, hit, UP, at.x, at.y, null, true, project, depth).p).toEqual(kept)

    // An edge whose foot is on the cut-away side gives its kept point nearest the foot — the
    // edge lies square to the view, so nearest the camera is a tie.
    const edge: SnapCache = {
      verts: [],
      segs: [[new Vector3(-1, 5 / k, 0), new Vector3(1, 5 / k, 0)]]
    }
    const x = at.x + 3
    const out = snapPoint(edge, hitAt(c, x, at.y, level(0)), UP, x, at.y, null, true, project, depth)
    expect(out.type).toBe('edge')
    expect(out.p.x).toBeCloseTo(0, 9)
    expect(out.d).toBeCloseTo(Math.hypot(3, 5), 6)
  })

  it('with two planes cutting, a candidate cut away by either one is never taken (2026-10-01)', () => {
    const { c, k, at } = plan()
    // The gridline cut keeps x <= 0; a second plane keeps y >= 0. Three corners inside 16 px of
    // the cursor, nearest first: one each plane cuts away, and one both keep.
    const keepLeft: Clip = { n: new Vector3(-1, 0, 0), c: 0 }
    const keepUp: Clip = { n: new Vector3(0, 1, 0), c: 0 }
    const byLeft = new Vector3(4 / k, 5 / k, 0)
    const byUp = new Vector3(-5 / k, -6 / k, 0)
    const kept = new Vector3(-9 / k, 9 / k, 0)
    const cache: SnapCache = { verts: [byLeft, byUp, kept], segs: [] }
    const hit = hitAt(c, at.x, at.y, level(0))
    const taken = (clips: Clip[]): Vector3 => {
      const { project, depth } = viewOf(c, clips)
      return snapPoint(cache, hit, UP, at.x, at.y, null, true, project, depth).p
    }
    // No plane: the nearest. One plane: the nearest it keeps. Both, in either order: the one
    // corner neither cut away, though it is the farthest of the three.
    expect(taken([])).toEqual(byLeft)
    expect(taken([keepLeft])).toEqual(byUp)
    expect(taken([keepUp])).toEqual(byLeft)
    expect(taken([keepLeft, keepUp])).toEqual(kept)
    expect(taken([keepUp, keepLeft])).toEqual(kept)
    // With nothing left that both keep, it is the face point — never a cut-away corner.
    const none: SnapCache = { verts: [byLeft, byUp], segs: [] }
    const { project, depth } = viewOf(c, [keepLeft, keepUp])
    expect(snapPoint(none, hit, UP, at.x, at.y, null, true, project, depth).type).toBe('face')

    // An edge whose foot the first plane cut away gives its nearest point that **both** keep:
    // each plane narrows the stretch on its own. The second plane here is on the skew —
    // x + y <= 3 px — which on this edge (y = 5 px) is x <= −2 px.
    const edge: SnapCache = {
      verts: [],
      segs: [[new Vector3(-1, 5 / k, 0), new Vector3(1, 5 / k, 0)]]
    }
    const skew = (limit: number): Clip => ({
      n: new Vector3(-1, -1, 0).normalize(),
      c: limit / k / Math.SQRT2
    })
    const x = at.x + 3
    const snapEdge = (clips: Clip[]) => {
      const v = viewOf(c, clips)
      return snapPoint(edge, hitAt(c, x, at.y, level(0)), UP, x, at.y, null, true, v.project, v.depth)
    }
    const one = snapEdge([keepLeft])
    expect(one.type).toBe('edge')
    expect(one.p.x).toBeCloseTo(0, 9)
    const two = snapEdge([keepLeft, skew(3)])
    expect(two.type).toBe('edge')
    expect(two.p.x * k).toBeCloseTo(-2, 6)
    expect(two.d).toBeCloseTo(Math.hypot(5, 5), 6)
    // The second plane leaves nothing of the edge inside the radius: the edge is not taken.
    expect(snapEdge([keepLeft, skew(-3)]).type).toBe('face')
  })

  it("where nothing is hidden or off the face, the design's numbers hold with the rule on", () => {
    // Every case of the two blocks at the top, rerun under a depth rule whose camera looks
    // along +z at the square — the "drop z" projection is an orthographic view — and compared
    // result for result.
    const depth: SnapDepth = {
      eye: null,
      forward: new Vector3(0, 0, 1),
      tol: SNAP_PLANE_TOL,
      clips: NO_CLIP
    }
    const none: SnapCache = { verts: [], segs: [] }
    const cases: [SnapCache, Vector3, Vector3 | null, number, number, Vector3 | null][] = [
      [square(), v(15, 0), null, 15, 0, null],
      [square(), v(17, 40, 0), null, 17, 40, null],
      [square(), v(50, 30), null, 50, 10, null],
      [square(), v(50, 30), null, 50, 12, null],
      [square(), v(50, 50, 7), null, 50, 50, null],
      [square(), v(12, 40), null, 12, 2, null],
      [square(), v(50, 40), null, 50, 5, null],
      [square(), v(80, 3), null, 80, 3, v(50, 0)],
      [square(), v(96, 2), null, 96, 2, v(50, 0)],
      [none, v(3, 40), null, 3, 40, v(0, 0)],
      [none, v(60, 40, 0), v(1, 0, 0), 60, 40, v(48, 37, -20)],
      [none, v(60, 40, 0), null, 60, 40, v(48, 37, -20)]
    ]
    for (const [cache, hit, n, x, y, from] of cases) {
      const design = snapPoint(cache, hit, n, x, y, from, true, project)
      expect(snapPoint(cache, hit, n, x, y, from, true, project, depth)).toEqual(design)
    }
  })
})
