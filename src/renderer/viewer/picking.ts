/**
 * Hit testing — `design-reference/design/viewer-core.js` L133 (`rebuildPick`) and L335–336
 * (`kept`, `pick`), at a size that survives a real model.
 *
 * The reference raycasts a list of per-element `THREE.Mesh`es with three's own
 * `Raycaster.intersectObjects`. Two things stop that working here.
 *
 * **three's `Mesh.raycast` is brute force over every triangle.** One hover on Marumi's
 * reference model cost **222 ms** (`CLAUDE.md`, rendering traps). The fix that survived there
 * is the one used here: filter by each element's world bounding box first, sort the survivors
 * by entry distance, and only then walk triangles — stopping as soon as a confirmed hit is
 * nearer than the next box could be.
 *
 * **There are no per-element meshes.** Parts are merged into a few dozen slot geometries
 * (`batches.ts`), each part holding a contiguous range of that slot's index buffer. So the
 * precise phase is a direct world-space triangle walk over the ranges of the few parts that
 * survive the box filter — no instance matrix, no inverse, no scale conversion, because the
 * vertices are already in federation space.
 *
 * **A uniform grid over the boxes, since 2026-09-19.** The box filter itself is O(elements)
 * per ray, which is nothing at one ray a hover and ruinous at 78: the label occlusion sweep
 * fires one ray per grid bubble and measured 83.8 ms on the reference model. `pick-grid.ts`
 * bins the same boxes into a uniform grid walked with a 3D DDA, so a ray sees only the
 * candidates along it. It is a *filter*, not an answer: every candidate it yields still goes
 * through the same `boxInterval`, the same sort and the same triangle walk, and the grid is
 * conservative, so the surviving candidate set — and therefore every hit — is identical to the
 * flat scan's. `bruteForce: true` keeps the flat scan as the reference the test compares
 * against.
 *
 * **No bounds trees.** They were needed while every part was a `BatchedMesh` instance, whose
 * geometry had to be tested in instance space. Now the box filter leaves a handful of parts
 * and each is a short contiguous run of triangles; a `MeshBVH` over a merged slot cannot be
 * restricted to one part's range at query time, so it would have to test every triangle of
 * every part in the slot and reject by lookup — more work, a several-hundred-millisecond
 * build per slot on the main thread, and a dependency in the hot path. The measured hover
 * cost is in `tests/parity/phase2b/README.md`.
 *
 * **The section cut is applied inside the walk**, by clamping the ray to the kept side of the
 * plane before anything is tested. The reference reaches the same answer from the other end:
 * `pick()` (L335) walks *every* intersection and takes the first whose point satisfies `kept`,
 * so a clipped-away roof is stepped over rather than returned. What must never be done is
 * Marumi's version — take the nearest hit and *then* test it — which lets that roof block
 * everything under it (`CLAUDE.md`, rendering traps). Clamping is the reference's semantics
 * plus one thing its version cannot do: the box filter prunes with the plane too.
 *
 * **Two planes since 2026-10-01** (owner-requested: the gridline cut and the level cut can be
 * on together). `clip()` hands over the planes that are cutting — none, one or two — and the ray
 * is kept where **every** one keeps it: the intersection of their `clipInterval`s (`clipSpan`).
 * `pick` and `ray` share it, and so does the brute-force reference, which is this same file.
 * `anyHit` stays unclipped, as the reference has it.
 */
import type { Box3, Vector2 } from 'three/webgpu'
import { Ray, Raycaster, Triangle, Vector3 } from 'three/webgpu'
import type { BatchStore, ElementRecord } from './batches'
import type { ViewerCamera } from './overlay'
import type { UniformGrid } from './pick-grid'
import { buildPickGrid } from './pick-grid'

/** What `pick` returns; the reference's `hit`, with the element already resolved. */
export interface PickHit {
  /** Federation id. */
  id: number
  /** World space. */
  point: Vector3
  /** World-space geometric face normal, as the reference's `hit.face.normal` is. */
  normal: Vector3
  /** World distance from the ray origin. */
  distance: number
}

/** A section plane as the materials hold it: `dot(p, n) + c >= 0` is kept. */
export interface ClipPlane {
  n: Vector3
  c: number
}

export interface PickerOptions {
  store: BatchStore
  /** The section planes that are cutting right now: none, one or two (`viewer-core.ts`). */
  clip: () => readonly ClipPlane[]
  /** `viewer-core.js` L133: visible **and** not filtered out by `setPickable`. */
  hittable: (rec: ElementRecord) => boolean
  /**
   * Of the hittable elements, which may hide an annotation label in `anyHit` (2026-09-24):
   * the building, not the site — a tree or a landscape space must not hide a grid bubble.
   * Omitted, every hittable element occludes. `pick` and `ray` are unaffected.
   */
  occludes?: (rec: ElementRecord) => boolean
  /**
   * Test-only. Skip `pick-grid.ts` and box-test every candidate, which is what this file did
   * before the grid existed — the reference `tests/unit/pick-grid.test.ts` compares against.
   */
  bruteForce?: boolean
}

export interface Picker {
  /** `viewer-core.js` L133. Rebuild the candidate list after any visibility change. */
  rebuild(): void
  pick(ndc: Vector2, camera: ViewerCamera): PickHit | null
  /**
   * The nearest hit along a world-space ray, section-clipped like `pick`. The laser meter
   * (`viewer-core.js` L377–379) fires six of these per hover.
   *
   * `near` is the reference's own `x.distance > 0.01` filter, hoisted into the walk: the
   * design drops near hits *after* intersecting, which is the same answer for a lower bound.
   */
  ray(origin: Vector3, dir: Vector3, far: number, near?: number): PickHit | null
  /** `updateOcclusion`, L720–721: is anything that `occludes` in the way along this ray? */
  anyHit(origin: Vector3, dir: Vector3, far: number): boolean
  /** Candidates currently in the hit set — the reference's `pickList.length`, per element. */
  readonly size: number
  dispose(): void
}

const _ray = new Ray()
const _a = new Vector3()
const _b = new Vector3()
const _c = new Vector3()
const _tri = new Vector3()

/**
 * The slab test, as an interval rather than three's `Ray.intersectBox` — which returns only
 * the entry point and `null` when the origin is already inside looking out. Both matter: the
 * camera is routinely inside an element's box, and the interval is what lets a confirmed hit
 * cut the rest of the sorted list short.
 */
export function boxInterval(ray: Ray, box: Box3): { near: number; far: number } | null {
  let tmin = -Infinity
  let tmax = Infinity
  const o = ray.origin
  const d = ray.direction
  for (const axis of ['x', 'y', 'z'] as const) {
    const oi = o[axis]
    const di = d[axis]
    const lo = box.min[axis]
    const hi = box.max[axis]
    if (Math.abs(di) < 1e-12) {
      if (oi < lo || oi > hi) return null
      continue
    }
    const inv = 1 / di
    let t0 = (lo - oi) * inv
    let t1 = (hi - oi) * inv
    if (t0 > t1) {
      const t = t0
      t0 = t1
      t1 = t
    }
    if (t0 > tmin) tmin = t0
    if (t1 < tmax) tmax = t1
    if (tmin > tmax) return null
  }
  return { near: tmin, far: tmax }
}

/**
 * The stretch of the ray on the kept side of the section plane, or `null` if none of it is.
 * `dot(p, n) + c >= 0` is kept, so along the ray that is a half line: `f(t) = f(0) + t·(d·n)`.
 */
export function clipInterval(ray: Ray, plane: ClipPlane): { near: number; far: number } | null {
  const f0 = ray.origin.dot(plane.n) + plane.c
  const slope = ray.direction.dot(plane.n)
  if (Math.abs(slope) < 1e-12) return f0 >= 0 ? { near: -Infinity, far: Infinity } : null
  const t = -f0 / slope
  return slope > 0 ? { near: t, far: Infinity } : { near: -Infinity, far: t }
}

/**
 * The stretch of the ray on the kept side of **every** plane — the intersection of their
 * `clipInterval`s — or `null` if no part of it is. No planes keep the whole line.
 */
export function clipSpan(
  ray: Ray,
  planes: readonly ClipPlane[]
): { near: number; far: number } | null {
  let near = -Infinity
  let far = Infinity
  for (const plane of planes) {
    const span = clipInterval(ray, plane)
    if (!span) return null
    if (span.near > near) near = span.near
    if (span.far < far) far = span.far
  }
  return near <= far ? { near, far } : null
}

/** One triangle hit, in the space the ray was given in. */
export interface LocalHit {
  distance: number
  point: Vector3
  normal: Vector3
}

/**
 * Walk one part's index range. `DoubleSide`, as every family material is, so a back face hits.
 * Exported for `tests/unit/picking.test.ts`.
 */
export function walkTriangles(
  position: ArrayLike<number>,
  index: ArrayLike<number>,
  start: number,
  count: number,
  ray: Ray,
  near: number,
  far: number,
  out: LocalHit
): boolean {
  let found = false
  for (let i = start; i < start + count; i += 3) {
    const ia = index[i] * 3
    const ib = index[i + 1] * 3
    const ic = index[i + 2] * 3
    _a.set(position[ia], position[ia + 1], position[ia + 2])
    _b.set(position[ib], position[ib + 1], position[ib + 2])
    _c.set(position[ic], position[ic + 1], position[ic + 2])
    if (!ray.intersectTriangle(_a, _b, _c, false, _tri)) continue
    const d = ray.origin.distanceTo(_tri)
    if (d < near || d > far || d >= out.distance) continue
    out.distance = d
    out.point.copy(_tri)
    Triangle.getNormal(_a, _b, _c, out.normal)
    found = true
  }
  return found
}

export function createPicker(options: PickerOptions): Picker {
  const { store, clip, hittable, occludes, bruteForce = false } = options

  /**
   * Every element in the federation, in creation order — the order the reference's `pickList`
   * had — with `live` marking the ones that are hittable right now. Keeping the whole set (and
   * the grid over it) means a visibility change costs one pass over `live` rather than a grid
   * rebuild; the grid itself is rebuilt only when the element set itself changes.
   */
  let all: ElementRecord[] = []
  let live = new Uint8Array(0)
  /** `live` and `occludes`: the set `anyHit` walks. */
  let occ = new Uint8Array(0)
  /**
   * `live` minus every `IfcSpace` (2026-09-24). `pick` and `ray` try this set first and fall
   * back to `live` only when it hits nothing, so a room is picked only when it is the one thing
   * on the ray — a space wraps everything that stands in it, and would otherwise win every
   * click inside a building.
   */
  let solid = new Uint8Array(0)
  /** `live` and nothing but spaces: the fallback walk, with no solid left in it to re-test. */
  let spaces = new Uint8Array(0)
  let spaceCount = 0
  let liveCount = 0
  let grid: UniformGrid | null = null

  /** The current best, reused between casts: a hover runs this at frame rate. */
  const local: LocalHit = { distance: Infinity, point: new Vector3(), normal: new Vector3() }

  const hitPart = (rec: ElementRecord, part: number, near: number, far: number, best: PickHit): boolean => {
    const slot = store.slots[rec.slotOf[part]]
    if (slot.removed) return false
    const at = (rec.partOf[part] - slot.firstPart) * 2
    const count = slot.partRange[at + 1]
    if (!count) return false
    const position = slot.geometry.getAttribute('position').array as ArrayLike<number>
    const index = slot.geometry.getIndex()!.array as ArrayLike<number>
    // `local.point` / `local.normal` are only written when a nearer triangle is found, so
    // seeding the distance is enough to make this "beat the best so far or nothing".
    local.distance = best.distance
    if (!walkTriangles(position, index, slot.partRange[at], count, _ray, near, far, local)) return false
    best.distance = local.distance
    best.point.copy(local.point)
    best.normal.copy(local.normal).normalize()
    best.id = rec.id
    return true
  }

  /**
   * The two-phase walk: boxes, sorted by entry distance, then triangles until nothing nearer
   * is possible. The three arrays are reused between casts — a hover runs this at frame rate
   * over every element in the federation.
   */
  const candRec: ElementRecord[] = []
  const candNear: number[] = []
  /** Each candidate's place in `all`, so equal entry distances keep creation order. */
  const candAt: number[] = []
  const order: number[] = []
  const best: PickHit = { id: -1, point: new Vector3(), normal: new Vector3(), distance: Infinity }

  const cast = (near: number, far: number, firstOnly: boolean, mask = live): PickHit | null => {
    candRec.length = 0
    candNear.length = 0
    candAt.length = 0
    order.length = 0
    const consider = (i: number): void => {
      if (!mask[i]) return
      const rec = all[i]
      const span = boxInterval(_ray, rec.bbox)
      if (!span || span.far < near || span.near > far) return
      order.push(candRec.length)
      candRec.push(rec)
      candNear.push(Math.max(span.near, near))
      candAt.push(i)
    }
    if (grid) grid.query(_ray, near, far, consider)
    else for (let i = 0; i < all.length; i++) consider(i)
    if (!candRec.length) return null
    // The grid yields candidates in cell order, the flat scan in creation order; the second key
    // is what makes the two sorts — and so the two answers — identical when entry distances tie.
    order.sort((a, b) => candNear[a] - candNear[b] || candAt[a] - candAt[b])

    best.id = -1
    best.distance = Infinity
    for (const i of order) {
      if (candNear[i] >= best.distance) break
      let hit = false
      const rec = candRec[i]
      for (let part = 0; part < rec.slotOf.length; part++) {
        if (hitPart(rec, part, near, Math.min(far, best.distance), best)) hit = true
      }
      if (hit && firstOnly) break
    }
    return best.id === -1 ? null : best
  }

  /**
   * The nearest hit that is not a space, else the nearest space: `cast` over `solid`, then —
   * only if that missed and a space is hittable at all — over `spaces`.
   *
   * Refactor pass 2: the fallback used to walk `live`, which put every solid the first walk had
   * just missed through the box phase and the triangle walk a second time — on every hover over
   * a building's rooms or over empty ground. Those solids cannot hit (they missed the whole
   * interval once), so walking the spaces alone gives the same answer. One walk over `live`
   * that kept a nearest solid and a nearest space was measured too, and was slower: it tests
   * every space's box, and sorts it, on the rays that hit a solid, which are most of them.
   */
  const castPreferSolid = (near: number, far: number): PickHit | null =>
    cast(near, far, false, solid) ?? (spaceCount ? cast(near, far, false, spaces) : null)

  const raycaster = new Raycaster()

  /**
   * The reference returns a fresh three intersection from every `pick()`. `best` is reused
   * between casts and `anyHit` overwrites it on one frame in four, so a caller that held on to
   * a hit would find it rewritten under them. Copying on the way out costs one object per
   * hover — at most one a frame — and removes the hazard entirely.
   */
  const copyOf = (hit: PickHit): PickHit => ({
    id: hit.id,
    point: hit.point.clone(),
    normal: hit.normal.clone(),
    distance: hit.distance
  })

  return {
    get size() {
      return liveCount
    },

    rebuild: () => {
      const next = [...store.elements.values()]
      // Element records are stable objects, so identity settles whether the *set* changed —
      // a hide or an activate leaves it alone and only `live` moves.
      let same = next.length === all.length
      if (same) {
        for (let i = 0; i < next.length; i++) {
          if (next[i] !== all[i]) {
            same = false
            break
          }
        }
      }
      all = next
      if (live.length !== all.length) {
        live = new Uint8Array(all.length)
        occ = new Uint8Array(all.length)
        solid = new Uint8Array(all.length)
        spaces = new Uint8Array(all.length)
      }
      liveCount = 0
      spaceCount = 0
      for (let i = 0; i < all.length; i++) {
        const ok = hittable(all[i])
        live[i] = ok ? 1 : 0
        occ[i] = ok && (!occludes || occludes(all[i])) ? 1 : 0
        solid[i] = ok && !all[i].space ? 1 : 0
        spaces[i] = ok && all[i].space ? 1 : 0
        if (ok) liveCount++
        if (ok && all[i].space) spaceCount++
      }
      if (!same) grid = bruteForce ? null : buildPickGrid(all.map((rec) => rec.bbox))
    },

    pick: (ndc, camera) => {
      raycaster.setFromCamera(ndc, camera)
      _ray.copy(raycaster.ray)
      const span = clipSpan(_ray, clip())
      if (!span) return null
      const hit = castPreferSolid(Math.max(0, span.near), span.far)
      return hit && copyOf(hit)
    },

    ray: (origin, dir, far, near = 0) => {
      _ray.origin.copy(origin)
      _ray.direction.copy(dir).normalize()
      const span = clipSpan(_ray, clip())
      if (!span) return null
      const from = Math.max(near, span.near)
      const to = Math.min(far, span.far)
      if (!(to > from)) return null
      const hit = castPreferSolid(from, to)
      return hit && copyOf(hit)
    },

    // `viewer-core.js` L720–721 tests occlusion against the raw pick list, with no `kept`
    // filter — a label hidden by a roof stays hidden even when the roof is cut away. Kept as
    // the reference has it.
    anyHit: (origin, dir, far) => {
      _ray.origin.copy(origin)
      _ray.direction.copy(dir).normalize()
      return cast(0, far, true, occ) !== null
    },

    dispose: () => {
      all = []
      live = new Uint8Array(0)
      occ = new Uint8Array(0)
      solid = new Uint8Array(0)
      spaces = new Uint8Array(0)
      spaceCount = 0
      liveCount = 0
      grid = null
    }
  }
}
