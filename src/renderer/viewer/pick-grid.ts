/**
 * A uniform grid over the pick candidates' world boxes, walked with a 3D DDA.
 *
 * `picking.ts` filters by every element's world bounding box before it walks a triangle
 * (`CLAUDE.md`, rendering traps: three's `Mesh.raycast` cost 222 ms a hover on a real model).
 * That filter is O(elements) per ray, which is fine at one ray a hover and ruinous at 78: the
 * label occlusion sweep (`overlay.ts`) fires one ray per grid bubble, and on the 137.9 MB
 * reference model — 26 539 candidates — that measured **1.1 ms a ray, 83.8 ms a sweep**.
 *
 * So the boxes go into a uniform grid and a ray visits only the cells it actually crosses.
 * The grid is **conservative**: a box is inserted into every cell it overlaps (expanded by a
 * hair, so a ray running exactly along a cell boundary cannot fall between two), which means
 * every element the flat scan would have tested and hit is still visited. The caller applies
 * the same exact `boxInterval` afterwards, so the candidate set — and therefore the answer —
 * is identical to the flat scan's, not an approximation of it.
 * `tests/unit/pick-grid.test.ts` asserts that against the flat scan on the design's own
 * federation over several thousand seeded random rays.
 *
 * Nothing here touches three's renderer or the DOM, so it is unit-testable under Node.
 */
import type { Box3, Ray } from 'three/webgpu'

/** Cells per axis, at most. 64³ cells is a 1 MB `Int32Array` at the very worst. */
export const MAX_PER_AXIS = 64

/**
 * A box covering more than this many cells is not inserted cell by cell — it is kept in
 * `oversize` and visited by every query instead. One site element around a whole model would
 * otherwise write itself into every cell in the grid; this bounds the build in one line, and
 * costs nothing in correctness because such an item is always visited.
 */
export const OVERSIZE_CELLS = 4096

export interface UniformGrid {
  readonly dims: readonly [number, number, number]
  readonly cells: number
  readonly items: number
  /** How many items were too large to bin (see `OVERSIZE_CELLS`). */
  readonly oversize: number
  /**
   * Visit every item whose cell the ray crosses within `[near, far]`, each at most once.
   * A superset of the items whose box the ray actually meets, never a subset.
   */
  query(ray: Ray, near: number, far: number, visit: (item: number) => void): void
}

const EMPTY: UniformGrid = {
  dims: [0, 0, 0],
  cells: 0,
  items: 0,
  oversize: 0,
  query: () => {}
}

/** The grid's own bounds, padded so a box exactly on the outer face still lands inside. */
export function buildPickGrid(boxes: readonly Box3[]): UniformGrid {
  const n = boxes.length
  if (!n) return EMPTY

  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (const b of boxes) {
    if (b.isEmpty()) continue
    if (b.min.x < minX) minX = b.min.x
    if (b.min.y < minY) minY = b.min.y
    if (b.min.z < minZ) minZ = b.min.z
    if (b.max.x > maxX) maxX = b.max.x
    if (b.max.y > maxY) maxY = b.max.y
    if (b.max.z > maxZ) maxZ = b.max.z
  }
  if (!(minX <= maxX && minY <= maxY && minZ <= maxZ)) return EMPTY

  // A degenerate axis (a single storey slab, a plane of glazing) still needs a positive span.
  const spanX = Math.max(maxX - minX, 1e-6)
  const spanY = Math.max(maxY - minY, 1e-6)
  const spanZ = Math.max(maxZ - minZ, 1e-6)

  // About one cell per item, with the cells cubic: the density that keeps both the walk and
  // the bucket short. Clamped per axis so a flat model cannot ask for a huge grid.
  const density = Math.cbrt(n / (spanX * spanY * spanZ))
  const nx = Math.min(MAX_PER_AXIS, Math.max(1, Math.ceil(spanX * density)))
  const ny = Math.min(MAX_PER_AXIS, Math.max(1, Math.ceil(spanY * density)))
  const nz = Math.min(MAX_PER_AXIS, Math.max(1, Math.ceil(spanZ * density)))
  const cells = nx * ny * nz

  const cellX = spanX / nx
  const cellY = spanY / ny
  const cellZ = spanZ / nz
  // A hair of slack, so a box that ends exactly on a cell boundary is in both neighbours and
  // a ray that runs along that boundary cannot miss it. Conservative is always safe here.
  const epsX = cellX * 1e-4
  const epsY = cellY * 1e-4
  const epsZ = cellZ * 1e-4

  const cellOf = (v: number, lo: number, cell: number, count: number): number => {
    const i = Math.floor((v - lo) / cell)
    return i < 0 ? 0 : i >= count ? count - 1 : i
  }

  /** Per item, the inclusive cell range it covers, or `-1` when it is oversize or empty. */
  const lo = new Int32Array(n * 3).fill(-1)
  const hi = new Int32Array(n * 3)
  const oversizeList: number[] = []
  const counts = new Int32Array(cells + 1)
  let total = 0

  for (let i = 0; i < n; i++) {
    const b = boxes[i]
    if (b.isEmpty()) continue
    const x0 = cellOf(b.min.x - epsX, minX, cellX, nx)
    const y0 = cellOf(b.min.y - epsY, minY, cellY, ny)
    const z0 = cellOf(b.min.z - epsZ, minZ, cellZ, nz)
    const x1 = cellOf(b.max.x + epsX, minX, cellX, nx)
    const y1 = cellOf(b.max.y + epsY, minY, cellY, ny)
    const z1 = cellOf(b.max.z + epsZ, minZ, cellZ, nz)
    const covered = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1)
    if (covered > OVERSIZE_CELLS) {
      oversizeList.push(i)
      continue
    }
    lo[i * 3] = x0
    lo[i * 3 + 1] = y0
    lo[i * 3 + 2] = z0
    hi[i * 3] = x1
    hi[i * 3 + 1] = y1
    hi[i * 3 + 2] = z1
    total += covered
    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) {
        const row = (z * ny + y) * nx
        for (let x = x0; x <= x1; x++) counts[row + x + 1]++
      }
    }
  }

  // Counting sort into one flat bucket array: no array of arrays, so no per-cell allocation.
  const start = counts
  for (let c = 0; c < cells; c++) start[c + 1] += start[c]
  const items = new Int32Array(total)
  const cursor = new Int32Array(cells)
  for (let i = 0; i < n; i++) {
    if (lo[i * 3] < 0) continue
    const x0 = lo[i * 3]
    const y0 = lo[i * 3 + 1]
    const z0 = lo[i * 3 + 2]
    const x1 = hi[i * 3]
    const y1 = hi[i * 3 + 1]
    const z1 = hi[i * 3 + 2]
    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) {
        const row = (z * ny + y) * nx
        for (let x = x0; x <= x1; x++) {
          const c = row + x
          items[start[c] + cursor[c]++] = i
        }
      }
    }
  }

  const oversize = Int32Array.from(oversizeList)
  /** One stamp per item, so an item in several cells along the ray is visited once. */
  const stamp = new Int32Array(n).fill(-1)
  let generation = 0
  const maxSteps = nx + ny + nz + 3

  return {
    dims: [nx, ny, nz],
    cells,
    items: n,
    oversize: oversize.length,

    query: (ray, near, far, visit) => {
      const gen = generation++
      const once = (i: number): void => {
        if (stamp[i] === gen) return
        stamp[i] = gen
        visit(i)
      }
      for (let k = 0; k < oversize.length; k++) once(oversize[k])

      const ox = ray.origin.x
      const oy = ray.origin.y
      const oz = ray.origin.z
      const dx = ray.direction.x
      const dy = ray.direction.y
      const dz = ray.direction.z

      // Clamp the ray to the grid's own box — the same slab test `picking.ts` uses.
      let t0 = near
      let t1 = far
      for (let axis = 0; axis < 3; axis++) {
        const o = axis === 0 ? ox : axis === 1 ? oy : oz
        const d = axis === 0 ? dx : axis === 1 ? dy : dz
        const l = axis === 0 ? minX : axis === 1 ? minY : minZ
        const h = axis === 0 ? maxX : axis === 1 ? maxY : maxZ
        if (Math.abs(d) < 1e-12) {
          if (o < l || o > h) return
          continue
        }
        const inv = 1 / d
        let a = (l - o) * inv
        let b = (h - o) * inv
        if (a > b) {
          const t = a
          a = b
          b = t
        }
        if (a > t0) t0 = a
        if (b < t1) t1 = b
        if (t0 > t1) return
      }
      if (!(t1 >= t0) || !Number.isFinite(t0)) return

      let ix = cellOf(ox + dx * t0, minX, cellX, nx)
      let iy = cellOf(oy + dy * t0, minY, cellY, ny)
      let iz = cellOf(oz + dz * t0, minZ, cellZ, nz)

      const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0
      const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0
      const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0
      // The parameter at which the next boundary on each axis is crossed, taken from the cell's
      // own plane rather than accumulated, so float drift cannot walk the wrong cell.
      const bound = (i: number, step: number, lo0: number, cell: number): number =>
        lo0 + (i + (step > 0 ? 1 : 0)) * cell
      let tMaxX = stepX === 0 ? Infinity : (bound(ix, stepX, minX, cellX) - ox) / dx
      let tMaxY = stepY === 0 ? Infinity : (bound(iy, stepY, minY, cellY) - oy) / dy
      let tMaxZ = stepZ === 0 ? Infinity : (bound(iz, stepZ, minZ, cellZ) - oz) / dz
      const tDeltaX = stepX === 0 ? Infinity : Math.abs(cellX / dx)
      const tDeltaY = stepY === 0 ? Infinity : Math.abs(cellY / dy)
      const tDeltaZ = stepZ === 0 ? Infinity : Math.abs(cellZ / dz)

      for (let step = 0; step <= maxSteps; step++) {
        const c = (iz * ny + iy) * nx + ix
        for (let k = start[c], end = start[c + 1]; k < end; k++) once(items[k])
        if (tMaxX < tMaxY) {
          if (tMaxX < tMaxZ) {
            if (tMaxX > t1) return
            ix += stepX
            if (ix < 0 || ix >= nx) return
            tMaxX += tDeltaX
          } else {
            if (tMaxZ > t1) return
            iz += stepZ
            if (iz < 0 || iz >= nz) return
            tMaxZ += tDeltaZ
          }
        } else if (tMaxY < tMaxZ) {
          if (tMaxY > t1) return
          iy += stepY
          if (iy < 0 || iy >= ny) return
          tMaxY += tDeltaY
        } else {
          if (tMaxZ > t1) return
          iz += stepZ
          if (iz < 0 || iz >= nz) return
          tMaxZ += tDeltaZ
        }
      }
    }
  }
}
