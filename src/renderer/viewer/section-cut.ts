/**
 * The cut outline (2026-09-28, owner-requested: *"Also highlight and thicken the line of all
 * geometry that are cut in cut section."*): where the section plane meets each element's
 * triangles, as line segments in the scene frame. `section.ts` draws them; `viewer-core.ts`
 * decides when and for which elements.
 *
 * Pure arithmetic — no renderer, no DOM, and only a type import from `batches.ts` — so it is
 * unit-tested under Node. It reads the triangles the picker already walks (each slot's merged
 * `position` / `index` arrays and the part's `partRange`), so no second copy of the model is
 * kept. Positions are the slot's own: the scene frame, Float32, near the origin (the whole-metre
 * offset was taken off in Float64 upstream), and every product here is taken in Float64.
 *
 * **The rules at the plane.** A vertex within `ON_PLANE_EPS` of the plane is *on* it.
 * · A triangle with vertices on both sides gives one segment across it.
 * · A triangle with one vertex on the plane and the other two on opposite sides gives the
 *   segment from that vertex to the opposite edge.
 * · A triangle that only touches the plane at a vertex gives nothing.
 * · **A triangle lying in the plane gives nothing.** Where it bounds a solid, its outline comes
 *   from the neighbours that leave the plane (the next rule), so nothing is drawn twice.
 * · **An edge lying in the plane is drawn once, by the triangle whose third vertex is on the
 *   kept side.** A surface that crosses the plane exactly along a mesh edge has one triangle on
 *   each side, so it gives one segment; a solid resting on the plane from the kept side (a slab
 *   whose top is the cut) is outlined where it touches; one on the removed side is not.
 * · Every crossing on an edge is computed from the edge's lower-indexed vertex, so the two
 *   triangles that share the edge land on the bitwise-same point.
 *
 * **Collinear pieces are joined.** A flat face is two or more triangles, so a plane across it
 * gives one piece per triangle; pieces that meet at a shared vertex or edge crossing and run
 * straight on (a turn under `TURN_SIN`) are drawn as one segment. A box cut across is 4
 * segments, not 8.
 *
 * **Two planes (2026-10-01, owner-requested: the gridline cut and the level cut together).**
 * Each cutting plane is outlined on its own, by the rules above, and each joined segment is then
 * **trimmed to the kept side of the other cutting plane** — what the other plane removed is not
 * drawn, so it is not outlined. A segment that crosses the other plane is cut at the crossing;
 * one wholly on its removed side, or only touching it, is dropped; an end on the other plane is
 * kept. An element whose box does not reach the other plane's kept side is not walked at all.
 * The line where the two cut faces meet inside a solid is no surface triangle's, so it is not
 * drawn. With one plane nothing is trimmed and the result is the single-plane cut, float for
 * float.
 */
import type { BatchStore, ElementRecord } from './batches'

/** The section plane as the materials hold it: `dot(p, n) + c >= 0` is kept. */
export interface CutPlane {
  n: readonly [number, number, number]
  c: number
}

/**
 * A vertex this close to the plane, in metres, is on it: 0.1 mm, a few float32 steps at the
 * size of a building in the scene frame. A tolerance for representation, not a model size.
 */
export const ON_PLANE_EPS = 1e-4

/** Two pieces that meet are one line when the sine of the turn between them is below this. */
export const TURN_SIN = 1e-4

/** Shorter than this, in metres, a segment is nothing. */
const MIN_LENGTH = 1e-9

/** A growable list of segments, six floats each: ax, ay, az, bx, by, bz. */
export interface SegmentList {
  readonly count: number
  push(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void
  /** The segments, exactly `count * 6` floats long. */
  take(): Float32Array
}

export function segmentList(capacity = 1024): SegmentList {
  let data = new Float32Array(capacity * 6)
  let count = 0
  return {
    get count() {
      return count
    },
    push: (ax, ay, az, bx, by, bz) => {
      const dx = bx - ax
      const dy = by - ay
      const dz = bz - az
      if (dx * dx + dy * dy + dz * dz <= MIN_LENGTH * MIN_LENGTH) return
      if ((count + 1) * 6 > data.length) {
        const next = new Float32Array(data.length * 2)
        next.set(data)
        data = next
      }
      const at = count * 6
      data[at] = ax
      data[at + 1] = ay
      data[at + 2] = az
      data[at + 3] = bx
      data[at + 4] = by
      data[at + 5] = bz
      count++
    },
    take: () => data.slice(0, count * 6)
  }
}

/** Whether a box reaches the plane — its signed distances span zero, within the tolerance. */
export function boxStraddles(
  min: { x: number; y: number; z: number },
  max: { x: number; y: number; z: number },
  plane: CutPlane
): boolean {
  const [nx, ny, nz] = plane.n
  const lo = plane.c + nx * (nx > 0 ? min.x : max.x) + ny * (ny > 0 ? min.y : max.y) + nz * (nz > 0 ? min.z : max.z)
  const hi = plane.c + nx * (nx > 0 ? max.x : min.x) + ny * (ny > 0 ? max.y : min.y) + nz * (nz > 0 ? max.z : min.z)
  return lo <= ON_PLANE_EPS && hi >= -ON_PLANE_EPS
}

/** Whether any of a box is on the plane's kept side, beyond the tolerance — so some of it is drawn. */
export function boxReachesKept(
  min: { x: number; y: number; z: number },
  max: { x: number; y: number; z: number },
  plane: CutPlane
): boolean {
  const [nx, ny, nz] = plane.n
  const hi = plane.c + nx * (nx > 0 ? max.x : min.x) + ny * (ny > 0 ? max.y : min.y) + nz * (nz > 0 ? max.z : min.z)
  return hi > ON_PLANE_EPS
}

/* ── one part's pieces, before they are joined ────────────────────────────── */

/**
 * Endpoints, six floats per piece, and each endpoint's key as two integers: a vertex on the
 * plane is `(i, -1)`, a crossing on the edge between vertices `lo < hi` is `(lo, hi)`.
 */
let pieceAt = new Float64Array(6 * 64)
let pieceKey = new Int32Array(4 * 64)
/** Per endpoint, the other piece's endpoint it joins, or −1. */
let link = new Int32Array(2 * 64)
let seen = new Uint8Array(64)

function grow(pieces: number): void {
  if (pieces <= seen.length) return
  let size = seen.length
  while (size < pieces) size *= 2
  const at = new Float64Array(6 * size)
  at.set(pieceAt)
  pieceAt = at
  const key = new Int32Array(4 * size)
  key.set(pieceKey)
  pieceKey = key
  link = new Int32Array(2 * size)
  seen = new Uint8Array(size)
}

/**
 * An open-addressing table from endpoint key to the first endpoint that carried it, in typed
 * arrays reused from part to part (a generation stamp empties it) — a `Map` here allocated a
 * number per key and cost more than the whole triangle walk.
 */
let tableA = new Int32Array(256)
let tableB = new Int32Array(256)
let tableRef = new Int32Array(256)
let tableGen = new Uint32Array(256)
let generation = 0

/** Pieces recorded for the part being cut, and the last crossing `crossing` computed. */
let n = 0
let cx = 0
let cy = 0
let cz = 0
let lo = 0
let hi = 0

const NO_PLANES: readonly CutPlane[] = []
/** The planes the part's joined segments are trimmed by: the *other* cutting planes. */
let trim: readonly CutPlane[] = NO_PLANES

/**
 * Append one joined segment — the stretch of it on the kept side of every `trim` plane. An end
 * within the tolerance of a trim plane is on it and is kept; a segment that reaches no further
 * than the plane is dropped; one that crosses is cut at the crossing.
 */
function emit(
  out: SegmentList,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number
): void {
  for (let k = 0; k < trim.length; k++) {
    const p = trim[k]
    const da = ax * p.n[0] + ay * p.n[1] + az * p.n[2] + p.c
    const db = bx * p.n[0] + by * p.n[1] + bz * p.n[2] + p.c
    if (da >= -ON_PLANE_EPS && db >= -ON_PLANE_EPS) continue
    if (da <= ON_PLANE_EPS && db <= ON_PLANE_EPS) return
    // One end is kept and the other removed: move the removed end to the crossing.
    const t = da / (da - db)
    const x = ax + (bx - ax) * t
    const y = ay + (by - ay) * t
    const z = az + (bz - az) * t
    if (da < 0) {
      ax = x
      ay = y
      az = z
    } else {
      bx = x
      by = y
      bz = z
    }
  }
  out.push(ax, ay, az, bx, by, bz)
}

/** Record a piece from endpoint a (key `a0, a1`) to endpoint b (key `b0, b1`). */
function addPiece(
  ax: number, ay: number, az: number, a0: number, a1: number,
  bx: number, by: number, bz: number, b0: number, b1: number
): void {
  grow(n + 1)
  const p = n * 6
  pieceAt[p] = ax
  pieceAt[p + 1] = ay
  pieceAt[p + 2] = az
  pieceAt[p + 3] = bx
  pieceAt[p + 4] = by
  pieceAt[p + 5] = bz
  const k = n * 4
  pieceKey[k] = a0
  pieceKey[k + 1] = a1
  pieceKey[k + 2] = b0
  pieceKey[k + 3] = b1
  n++
}

/**
 * The crossing on edge (i, j), whose signed distances have opposite signs, into `cx, cy, cz`
 * — taken from the lower index, so the neighbour across the edge lands on the bitwise-same
 * point — and the edge's key into `lo, hi`.
 */
function crossing(position: ArrayLike<number>, i: number, di: number, j: number, dj: number): void {
  if (j < i) {
    const k = i
    i = j
    j = k
    const d = di
    di = dj
    dj = d
  }
  const t = di / (di - dj)
  const a = i * 3
  const b = j * 3
  cx = position[a] + (position[b] - position[a]) * t
  cy = position[a + 1] + (position[b + 1] - position[a + 1]) * t
  cz = position[a + 2] + (position[b + 2] - position[a + 2]) * t
  lo = i
  hi = j
}

/**
 * Append the cut of one part's triangles — `count` indices from `start` — to `out`, with
 * collinear pieces joined and each joined segment trimmed to the kept side of every `trimBy`
 * plane (none by default). Returns how many segments were appended.
 */
export function cutTriangles(
  position: ArrayLike<number>,
  index: ArrayLike<number>,
  start: number,
  count: number,
  plane: CutPlane,
  out: SegmentList,
  trimBy: readonly CutPlane[] = NO_PLANES
): number {
  const nx = plane.n[0]
  const ny = plane.n[1]
  const nz = plane.n[2]
  const c = plane.c
  const E = ON_PLANE_EPS
  trim = trimBy
  n = 0
  for (let k = start, end = start + count; k < end; k += 3) {
    const ia = index[k]
    const ib = index[k + 1]
    const ic = index[k + 2]
    const da = position[ia * 3] * nx + position[ia * 3 + 1] * ny + position[ia * 3 + 2] * nz + c
    const db = position[ib * 3] * nx + position[ib * 3 + 1] * ny + position[ib * 3 + 2] * nz + c
    const dc = position[ic * 3] * nx + position[ic * 3 + 1] * ny + position[ic * 3 + 2] * nz + c
    // Almost every triangle is wholly on one side.
    if ((da > E && db > E && dc > E) || (da < -E && db < -E && dc < -E)) continue
    const sa = da > E ? 1 : da < -E ? -1 : 0
    const sb = db > E ? 1 : db < -E ? -1 : 0
    const sc = dc > E ? 1 : dc < -E ? -1 : 0
    const zeros = (sa === 0 ? 1 : 0) + (sb === 0 ? 1 : 0) + (sc === 0 ? 1 : 0)
    // All three on the plane: the coplanar rule, nothing.
    if (zeros === 3) continue
    if (zeros === 2) {
      // An edge in the plane: drawn by the triangle whose third vertex is kept.
      if (sa + sb + sc < 0) continue
      let u = ia
      let v = ib
      if (sa !== 0) {
        u = ib
        v = ic
      } else if (sb !== 0) {
        u = ic
        v = ia
      }
      addPiece(
        position[u * 3], position[u * 3 + 1], position[u * 3 + 2], u, -1,
        position[v * 3], position[v * 3 + 1], position[v * 3 + 2], v, -1
      )
    } else if (zeros === 1) {
      // One vertex on the plane; a piece only if the other two are on opposite sides.
      let z = ic
      let p = ia
      let dp = da
      let q = ib
      let dq = db
      if (sa === 0) {
        if (sb === sc) continue
        z = ia
        p = ib
        dp = db
        q = ic
        dq = dc
      } else if (sb === 0) {
        if (sc === sa) continue
        z = ib
        p = ic
        dp = dc
        q = ia
        dq = da
      } else if (sa === sb) continue
      crossing(position, p, dp, q, dq)
      addPiece(position[z * 3], position[z * 3 + 1], position[z * 3 + 2], z, -1, cx, cy, cz, lo, hi)
    } else {
      // No vertex on the plane: the lone vertex on its side and the two edges leaving it.
      let l = ia
      let dl = da
      let p = ib
      let dp = db
      let q = ic
      let dq = dc
      if (sa === sb) {
        l = ic
        dl = dc
        p = ia
        dp = da
        q = ib
        dq = db
      } else if (sa === sc) {
        l = ib
        dl = db
        p = ic
        dp = dc
        q = ia
        dq = da
      }
      crossing(position, l, dl, p, dp)
      const x1 = cx
      const y1 = cy
      const z1 = cz
      const lo1 = lo
      const hi1 = hi
      crossing(position, l, dl, q, dq)
      addPiece(x1, y1, z1, lo1, hi1, cx, cy, cz, lo, hi)
    }
  }
  if (!n) return 0
  return join(n, out)
}

/**
 * Join pieces that meet end to end and run straight on, and append the result. An endpoint
 * key shared by exactly two pieces links them; a key shared by three or more (a non-manifold
 * vertex) links nothing.
 */
function join(n: number, out: SegmentList): number {
  const before = out.count
  if (n === 1) {
    emit(out, pieceAt[0], pieceAt[1], pieceAt[2], pieceAt[3], pieceAt[4], pieceAt[5])
    return out.count - before
  }
  let size = 16
  while (size < 4 * n) size *= 2
  if (size > tableA.length) {
    tableA = new Int32Array(size)
    tableB = new Int32Array(size)
    tableRef = new Int32Array(size)
    tableGen = new Uint32Array(size)
    generation = 0
  }
  if (generation === 0xffffffff) {
    tableGen.fill(0)
    generation = 0
  }
  const gen = ++generation
  const mask = size - 1
  link.fill(-1, 0, 2 * n)
  for (let r = 0; r < 2 * n; r++) {
    const a = pieceKey[r * 2]
    const b = pieceKey[r * 2 + 1]
    let h = (Math.imul(a, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca77)) & mask
    while (tableGen[h] === gen && (tableA[h] !== a || tableB[h] !== b)) h = (h + 1) & mask
    if (tableGen[h] !== gen) {
      tableGen[h] = gen
      tableA[h] = a
      tableB[h] = b
      tableRef[h] = r
      continue
    }
    const f = tableRef[h]
    if (f < 0) continue
    if (link[f] < 0) {
      link[f] = r
      link[r] = f
    } else {
      link[link[f]] = -1
      link[f] = -1
      tableRef[h] = -1
    }
  }
  // Keep a link only where the two pieces run straight on through the shared point.
  for (let r = 0; r < 2 * n; r++) {
    const s = link[r]
    if (s < r) continue
    const pr = (r >> 1) * 6 + (r & 1) * 3
    const ar = (r >> 1) * 6 + (1 - (r & 1)) * 3
    const bs = (s >> 1) * 6 + (1 - (s & 1)) * 3
    const ux = pieceAt[pr] - pieceAt[ar]
    const uy = pieceAt[pr + 1] - pieceAt[ar + 1]
    const uz = pieceAt[pr + 2] - pieceAt[ar + 2]
    const vx = pieceAt[bs] - pieceAt[pr]
    const vy = pieceAt[bs + 1] - pieceAt[pr + 1]
    const vz = pieceAt[bs + 2] - pieceAt[pr + 2]
    const wx = uy * vz - uz * vy
    const wy = uz * vx - ux * vz
    const wz = ux * vy - uy * vx
    const uu = ux * ux + uy * uy + uz * uz
    const vv = vx * vx + vy * vy + vz * vz
    const straight =
      ux * vx + uy * vy + uz * vz > 0 && wx * wx + wy * wy + wz * wz <= TURN_SIN * TURN_SIN * uu * vv
    if (!straight) {
      link[r] = -1
      link[s] = -1
    }
  }
  seen.fill(0, 0, n)
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue
    // Walk back to the chain's free end. Straight links cannot close a loop; the step cap is a
    // guard, and a chain that hit it simply starts at `s`.
    let piece = s
    let free = 0
    for (let steps = 0; steps <= n; steps++) {
      const l = link[piece * 2 + free]
      if (l < 0) break
      if (l >> 1 === s) {
        piece = s
        free = 0
        break
      }
      piece = l >> 1
      free = 1 - (l & 1)
    }
    const a = piece * 6 + free * 3
    const ax = pieceAt[a]
    const ay = pieceAt[a + 1]
    const az = pieceAt[a + 2]
    // Walk forward to the other free end.
    let end = 1 - free
    for (;;) {
      seen[piece] = 1
      const l = link[piece * 2 + end]
      if (l < 0 || seen[l >> 1]) break
      piece = l >> 1
      end = 1 - (l & 1)
    }
    const b = piece * 6 + end * 3
    emit(out, ax, ay, az, pieceAt[b], pieceAt[b + 1], pieceAt[b + 2])
  }
  return out.count - before
}

export interface CutResult {
  /** Six floats per segment, in the scene frame — every plane's, one list. */
  segments: Float32Array
  count: number
  /** Elements whose box reached a plane and that were walked, summed over the planes. */
  elements: number
  /** Triangles walked, summed over the planes. */
  triangles: number
}

/**
 * The whole cut, for every cutting plane in turn: every element whose box reaches that plane
 * (and some of the kept side of each other plane) and that `include` admits, part by part, its
 * segments trimmed by the other planes. `IfcSpace` is never cut — a room is not a solid, and
 * its outline is its walls'.
 */
export function sectionCut(
  store: Pick<BatchStore, 'elements' | 'slots'>,
  planes: readonly CutPlane[],
  include: (rec: ElementRecord) => boolean
): CutResult {
  const out = segmentList()
  let elements = 0
  let triangles = 0
  for (const plane of planes) {
    const others = planes.filter((p) => p !== plane)
    for (const rec of store.elements.values()) {
      const { min, max } = rec.bbox
      if (rec.space || !boxStraddles(min, max, plane)) continue
      if (!others.every((o) => boxReachesKept(min, max, o)) || !include(rec)) continue
      elements++
      for (let p = 0; p < rec.slotOf.length; p++) {
        const slot = store.slots[rec.slotOf[p]]
        if (slot.removed) continue
        const at = (rec.partOf[p] - slot.firstPart) * 2
        const count = slot.partRange[at + 1]
        if (!count) continue
        const position = slot.geometry.getAttribute('position').array as ArrayLike<number>
        const index = slot.geometry.getIndex()!.array as ArrayLike<number>
        triangles += count / 3
        cutTriangles(position, index, slot.partRange[at], count, plane, out, others)
      }
    }
  }
  return { segments: out.take(), count: out.count, elements, triangles }
}
