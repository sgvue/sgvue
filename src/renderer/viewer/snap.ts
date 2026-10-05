/**
 * Snapping and the snap marker — `design-reference/design/viewer-core.js` L337–359 (`snap`),
 * L388–390 (the marker element) and L606–614 (how `doHover` drives it).
 *
 * The rule is the reference's, unchanged and in its order: a corner within **16 px** of the
 * cursor beats an edge within **11 px**, which beats the face point itself; and when a
 * measurement is already running from a previous point, an **axis lock** or a
 * **perpendicular** foot within **10 px** overrides anything but a corner. Distances are
 * screen distances, so the catch radius is the same however far away the wall is — which is
 * the whole point of measuring this way.
 *
 * **Where the corners and edges come from.** The reference snaps to the vertices and segments
 * of `EdgesGeometry(geo, 20)` — the very same crease edges it draws. Those already exist
 * here, in world space, in `edges.ts`, because the worker computes them once per deduplicated
 * geometry and the edge store places them per part. So a snap cache is built from the edge
 * store rather than from the batch's vertex buffer: it is the same data the reference uses,
 * it needs no instance matrix, and it cannot drift from what is drawn.
 *
 * The caches are built on demand and kept for the last 64 elements hovered (an element is
 * typically a few hundred segments; a model is millions).
 *
 * **What is not the design's (2026-09-28, owner-requested): the surface being looked at comes
 * first.** The design takes any corner or edge of the hit element inside the radius with no
 * depth test, so in plan a slab's soffit corner, which lands on the same pixel as its top
 * corner, can win and a spot reads the underside. Now (`SnapDepth`): a candidate on the far
 * side of the hit face — or on the cut-away side of the section — is never taken; a candidate
 * on the hit face's plane beats one off it; and an edge whose own foot is hidden gives its
 * nearest-to-camera visible point inside the radius. Radii, the axis and perpendicular locks,
 * the `S` toggle and the marker are the design's.
 *
 * 2026-10-01 (two section planes): "the cut-away side of the section" is the cut-away side of
 * **any** plane that is cutting — `SnapDepth.clips` holds none, one or two. The rest of the
 * depth rule is unchanged.
 */
import type { PerspectiveCamera } from 'three/webgpu'
import { Vector2, Vector3 } from 'three/webgpu'
import type { EdgeStore } from './edges'
import type { LabelOverlay, ViewerCamera } from './overlay'
import { toPixels } from './overlay'

/** `viewer-core.js` L342, L347, L352, L355. Screen-space catch radii, in CSS pixels. */
export const SNAP_CORNER_PX = 16
export const SNAP_EDGE_PX = 11
export const SNAP_AXIS_PX = 10

/** How many elements' caches are kept. */
export const SNAP_CACHE_SIZE = 64

/**
 * 2026-09-28. How far from the hit face's plane a candidate may lie and still be *on* it, before
 * the scene-scale factor — 1 mm on the design's 27.5 m mock, `× radius / 27.5` elsewhere, as
 * every scene constant is (about 11 mm on the 137.9 MB reference model). It only has to absorb
 * float32 placement noise, which is ~1e-7 of the model's extent, and stay under the thickness
 * of the thinnest element whose two faces read different levels.
 */
export const SNAP_PLANE_TOL = 0.001

/** What the depth rule needs to know about the view (2026-09-28). */
export interface SnapDepth {
  /** A perspective camera's eye; `null` for an orthographic one, whose rays all run `forward`. */
  eye: Vector3 | null
  /** The camera's unit view direction. */
  forward: Vector3
  /** `SNAP_PLANE_TOL × scale`, in metres. */
  tol: number
  /**
   * The section planes that are cutting, as the materials hold them: `n·p + c >= 0` is kept
   * (the design's `kept`, L334). None, one or two; a candidate must be kept by every one.
   */
  clips: readonly { n: Vector3; c: number }[]
}

export type SnapKind =
  | 'corner'
  | 'edge'
  | 'face'
  | 'axis X'
  | 'axis Y'
  | 'axis Z'
  | 'perpendicular'

/** The reference's `best` (L338). `d` is the screen distance that won it. */
export interface SnapResult {
  type: SnapKind
  p: Vector3
  d: number
}

/** One element's crease vertices and segments, in world space. */
export interface SnapCache {
  verts: Vector3[]
  segs: [Vector3, Vector3][]
}

/** What the caller must hand `snapPoint`: where a world point lands in viewport pixels. */
export type ProjectPoint = (p: Vector3, out: Vector2) => Vector2

const _s2a = new Vector2()
const _s2b = new Vector2()
const _delta = new Vector3()
const _q = new Vector3()
const _proj = new Vector3()
const _foot = new Vector3()
const _n = new Vector3()
const _e = new Vector3()
const AXES = ['x', 'y', 'z'] as const

/** Where a candidate stands against the hit face: `-1` never taken, `0` on its plane, `1` in front. */
type Place = (p: Vector3) => -1 | 0 | 1

/**
 * The hit face as the depth rule reads it: its plane (the hit normal through the hit point, or
 * with no normal the plane square to the ray there), which side of it the camera is on, and the
 * section cut. A candidate is **hidden** when it lies more than `tol` beyond that plane from the
 * camera — which along its own view ray is its depth against the surface's depth there, so it
 * holds in perspective and orthographic alike and is the hit point's own depth for a face
 * square to the view.
 */
function faceOf(depth: SnapDepth, hit: Vector3, normal: Vector3 | null) {
  const n = new Vector3()
  if (normal && normal.lengthSq() > 0) n.copy(normal).normalize()
  else if (depth.eye) n.subVectors(hit, depth.eye).normalize()
  else n.copy(depth.forward)
  // The camera's side: where the eye is, or for an orthographic camera where its rays come from.
  const side = depth.eye ? n.dot(_e.subVectors(depth.eye, hit)) : -n.dot(depth.forward)
  const sigma = Math.abs(side) <= (depth.eye ? depth.tol : 1e-9) ? 0 : Math.sign(side)
  const h = n.dot(hit)
  const { tol, clips } = depth
  /** Signed distance above the plane, towards the camera (with `sigma` 0, never below). */
  const up = (p: Vector3): number => sigma * (n.dot(p) - h)
  /** On the cut-away side of any cutting plane. */
  const cutAway = (p: Vector3): boolean => clips.some((c) => p.dot(c.n) + c.c < 0)
  const place: Place = (p) =>
    cutAway(p) || up(p) < -tol ? -1 : Math.abs(n.dot(p) - h) <= tol ? 0 : 1
  return { tol, up, clips, place, forward: depth.forward }
}

/** Narrow `[lo, hi]` to where `f0 + t·(f1 − f0) >= 0`. */
function keepWhere(f0: number, f1: number, lo: number, hi: number): [number, number] {
  const df = f1 - f0
  if (df === 0) return f0 >= 0 ? [lo, hi] : [1, 0]
  const t = -f0 / df
  return df > 0 ? [Math.max(lo, t), hi] : [lo, Math.min(hi, t)]
}

/**
 * `viewer-core.js` L337–359, in its order and its numbers. `hitPoint` is where the ray met the
 * surface, `hitNormal` that surface's normal (the reference's `hit.face.normal`), `from` the
 * point a measurement is running from, and `snapOn` the `S` toggle — off, the reference returns
 * the face point untouched and labels it `free`.
 *
 * `depth` (2026-09-28) adds the surface rule, in this order: a corner or edge point on the
 * cut-away side or hidden behind the hit face is never taken; the design's rule — a corner
 * inside 16 px beats an edge inside 11 px, nearest in pixels — is run first over the candidates
 * on the hit face's plane and only then over the visible ones off it; and an edge whose foot
 * (the design's point) is hidden gives instead its nearest-to-camera visible point inside the
 * radius, so a vertical edge seen from above gives its top end. Without `depth` this is the
 * design's rule exactly.
 *
 * Pure: it touches no DOM and no renderer, which is what lets `tests/unit/snap.test.ts` check
 * the radii and the precedence on numbers.
 */
export function snapPoint(
  cache: SnapCache,
  hitPoint: Vector3,
  hitNormal: Vector3 | null,
  px: number,
  py: number,
  from: Vector3 | null,
  snapOn: boolean,
  project: ProjectPoint,
  depth: SnapDepth | null = null
): SnapResult {
  const best: SnapResult = { type: 'face', p: hitPoint.clone(), d: 1e9 }
  if (!snapOn) return best
  const face = depth ? faceOf(depth, hitPoint, hitNormal) : null

  // The best corner and edge point on the hit face's plane [0] and off it [1]. Without `depth`
  // everything is [0], which is the design's rule.
  const corner: (SnapResult | null)[] = [null, null]
  const edge: (SnapResult | null)[] = [null, null]
  for (const v of cache.verts) {
    const k = face ? face.place(v) : 0
    if (k < 0) continue
    project(v, _s2a)
    const d = Math.hypot(_s2a.x - px, _s2a.y - py)
    if (d < SNAP_CORNER_PX && d < (corner[k]?.d ?? 1e9)) {
      corner[k] = { type: 'corner', p: v, d }
    }
  }
  if (!corner[0]) {
    for (const [a, b] of cache.segs) {
      project(a, _s2a)
      project(b, _s2b)
      const ex = _s2b.x - _s2a.x
      const ey = _s2b.y - _s2a.y
      const l2 = ex * ex + ey * ey
      if (l2 < 1) continue
      const tu = ((px - _s2a.x) * ex + (py - _s2a.y) * ey) / l2
      let t = Math.max(0, Math.min(1, tu))
      let d = Math.hypot(_s2a.x + ex * t - px, _s2a.y + ey * t - py)
      if (d >= SNAP_EDGE_PX) continue
      let k: -1 | 0 | 1 = face ? face.place(_q.copy(a).lerp(b, t)) : 0
      if (face && k < 0) {
        // The foot is hidden or cut away. Of the stretch inside the radius, keep what is on the
        // kept side and not behind the face (both linear along the edge), and take its end
        // nearest the camera — or, where the edge is square to the view, the foot's side.
        // `d` is measured at the clamped foot; the line itself passes √(d² − (t − tu)²·l2) away.
        const half = Math.sqrt(Math.max(0, SNAP_EDGE_PX ** 2 - d * d + (t - tu) ** 2 * l2) / l2)
        let [lo, hi] = [Math.max(0, tu - half), Math.min(1, tu + half)]
        // One plane at a time: each plane's kept side is linear along the edge, their minimum is not.
        for (const c of face.clips) {
          ;[lo, hi] = keepWhere(a.dot(c.n) + c.c, b.dot(c.n) + c.c, lo, hi)
        }
        ;[lo, hi] = keepWhere(face.up(a) + face.tol, face.up(b) + face.tol, lo, hi)
        if (lo > hi) continue
        const slope = _e.subVectors(b, a).dot(face.forward)
        if (Math.abs(slope * (hi - lo)) < 1e-9) t = Math.max(lo, Math.min(hi, tu))
        else t = slope > 0 ? lo : hi
        d = Math.hypot(_s2a.x + ex * t - px, _s2a.y + ey * t - py)
        k = face.place(_q.copy(a).lerp(b, t)) === 0 ? 0 : 1
      }
      if (d < (edge[k]?.d ?? 1e9)) edge[k] = { type: 'edge', p: a.clone().lerp(b, t), d }
    }
  }
  const won = corner[0] ?? edge[0] ?? corner[1] ?? edge[1]
  if (won) {
    best.type = won.type
    best.p.copy(won.p)
    best.d = won.d
  }

  if (from) {
    _delta.subVectors(best.p, from)
    // The dominant component wins the axis lock: the reference's `reduce` over x, y, z.
    let axis: (typeof AXES)[number] = 'x'
    for (const k of AXES) if (Math.abs(_delta[k]) > Math.abs(_delta[axis])) axis = k
    _q.copy(from)
    _q[axis] += _delta[axis]
    project(_q, _s2a)
    if (Math.hypot(_s2a.x - px, _s2a.y - py) < SNAP_AXIS_PX && best.type !== 'corner') {
      best.type = `axis ${axis.toUpperCase()}` as SnapKind
      best.p.copy(_q)
      best.d = 0
    } else if (best.type === 'face' && hitNormal) {
      _n.copy(hitNormal)
      // The foot of the perpendicular from `from` onto the plane of the hit face (L356).
      const away = _foot.subVectors(from, hitPoint).dot(_n)
      _proj.copy(from).addScaledVector(_n, -away)
      project(_proj, _s2a)
      if (Math.hypot(_s2a.x - px, _s2a.y - py) < SNAP_AXIS_PX) {
        best.type = 'perpendicular'
        best.p.copy(_proj)
        best.d = 0
      }
    }
  }
  return best
}

/** `viewer-core.js` L611–612. The marker's glyph, by what was caught. */
export function markerStyle(type: SnapKind): {
  borderRadius: string
  size: string
  borderWidth: string
} {
  return {
    borderRadius: type === 'corner' ? '2px' : '50%',
    size: type === 'face' ? '7px' : '11px',
    borderWidth: type === 'face' ? '2px' : '2.5px'
  }
}

export interface Snapper {
  /** The `S` toggle; `setSnap` in the API. */
  readonly on: boolean
  setOn(b: boolean): void
  /** Snap a hit, building or reusing that element's cache. */
  snap(
    id: number,
    hitPoint: Vector3,
    hitNormal: Vector3 | null,
    px: number,
    py: number,
    from: Vector3 | null,
    camera: ViewerCamera,
    w: number,
    h: number
  ): SnapResult
  /** Place and show the marker at a snapped point (`doHover`, L608–613). */
  show(result: SnapResult, camera: ViewerCamera, w: number, h: number): void
  hide(): void
  /** Forget an element's cache — the geometry behind it is gone. */
  invalidate(ids: Iterable<number>): void
  dispose(): void
}

/** `viewer-core.js` L389, copied as written. */
const MARKER_HTML =
  '<div data-m style="width:10px;height:10px;border:2px solid var(--accent);border-radius:2px;' +
  'transform:translate(-50%,-50%);box-shadow:0 0 0 2px var(--card)"></div>' +
  '<div data-t style="position:absolute;left:12px;top:8px;font:400 11px/1 \'IBM Plex Mono\',monospace;' +
  'color:var(--accent-ink);background:var(--card);border:1px solid var(--border);border-radius:5px;' +
  'padding:4px 6px;white-space:nowrap"></div>'

const _px = new Vector2()

const _eye = new Vector3()
const _fwd = new Vector3()

/** What the snapper reads from the viewer for the depth rule (2026-09-28). */
export interface SnapContext {
  /** `radius / 27.5`. */
  scale(): number
  /** The section planes that are cutting right now — the picker's own list. */
  clips(): readonly { n: Vector3; c: number }[]
}

export function createSnapper(edges: EdgeStore, overlay: LabelOverlay, ctx: SnapContext): Snapper {
  let snapOn = true
  const caches = new Map<number, SnapCache>()
  const element = overlay.mkElement(MARKER_HTML)
  const glyph = element.firstElementChild as HTMLElement | null
  const text = element.lastElementChild as HTMLElement | null

  const cacheFor = (id: number): SnapCache => {
    const hit = caches.get(id)
    if (hit) {
      // Touch: a Map iterates in insertion order, so re-inserting is the whole LRU.
      caches.delete(id)
      caches.set(id, hit)
      return hit
    }
    const verts: Vector3[] = []
    const segs: [Vector3, Vector3][] = []
    // The reference dedupes an element's corners across all of its parts at four decimals
    // (L126), so a box's eight corners stay eight however many segments meet there.
    const seen = new Set<string>()
    edges.forEachSegment(id, (ax, ay, az, bx, by, bz) => {
      segs.push([new Vector3(ax, ay, az), new Vector3(bx, by, bz)])
      for (const [x, y, z] of [
        [ax, ay, az],
        [bx, by, bz]
      ]) {
        const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`
        if (seen.has(key)) continue
        seen.add(key)
        verts.push(new Vector3(x, y, z))
      }
    })
    const built: SnapCache = { verts, segs }
    caches.set(id, built)
    if (caches.size > SNAP_CACHE_SIZE) {
      const oldest = caches.keys().next()
      if (!oldest.done) caches.delete(oldest.value)
    }
    return built
  }

  return {
    get on() {
      return snapOn
    },
    setOn: (b) => {
      snapOn = !!b
    },

    snap: (id, hitPoint, hitNormal, px, py, from, camera, w, h) => {
      // From the same `matrixWorld` the pick ray and `toPixels` read, so all three agree.
      const depth: SnapDepth = {
        eye: (camera as PerspectiveCamera).isPerspectiveCamera
          ? _eye.setFromMatrixPosition(camera.matrixWorld)
          : null,
        forward: _fwd.setFromMatrixColumn(camera.matrixWorld, 2).negate().normalize(),
        tol: SNAP_PLANE_TOL * ctx.scale(),
        clips: ctx.clips()
      }
      return snapPoint(
        cacheFor(id),
        hitPoint,
        hitNormal,
        px,
        py,
        from,
        snapOn,
        (p, out) => toPixels(p, camera, w, h, out),
        depth
      )
    },

    show: (result, camera, w, h) => {
      element.style.display = ''
      // The marker sits on the snapped point, not the cursor, so a corner or edge catch is
      // visible (L609–610).
      toPixels(result.p, camera, w, h, _px)
      element.style.transform = `translate(${_px.x.toFixed(1)}px,${_px.y.toFixed(1)}px)`
      if (glyph) {
        const s = markerStyle(result.type)
        glyph.style.borderRadius = s.borderRadius
        glyph.style.width = s.size
        glyph.style.height = s.size
        glyph.style.borderWidth = s.borderWidth
      }
      if (text) text.textContent = snapOn ? result.type : 'free'
    },

    hide: () => {
      element.style.display = 'none'
    },

    invalidate: (ids) => {
      for (const id of ids) caches.delete(id)
    },

    dispose: () => {
      caches.clear()
      element.remove()
    }
  }
}
