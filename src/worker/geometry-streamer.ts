/**
 * Geometry streaming: an open web-ifc model → `GeometryChunk`s on the contract
 * (`src/shared/geometry-contract.types.ts`, plan §3.7).
 *
 * Five things this file exists to get right, each of them a recorded defect:
 *
 *  · **The length unit is applied exactly once, and the axis swap exactly once.**
 *    `flatTransformation` already applies the file's length unit — never scale again. It
 *    also rotates the model into **Y-up**, which is three.js's default but not IFC's and not
 *    this app's: the contract is IFC **Z-up** metres (see `Z_UP_FROM_Y_UP`), so the single
 *    constant rotation below is composed on the left of every placement and nothing else is
 *    rotated. Vertices are written in the geometry's own local space and the matrix carries
 *    the placement.
 *  · **The scene is the project frame.** A shared-coordinates export states its position and
 *    its rotation to true north on the spatial-root `IfcSite.ObjectPlacement`, so its world
 *    axes are map axes and the building stands at an angle to them. The inverse of that
 *    placement — the federation's `ProjectFrame`, chosen by the boot model and then fixed — is
 *    composed on the left beside the axis swap, so everything downstream is square with the
 *    building. This is still the only place the frames meet.
 *  · **Nothing stays on the wasm heap.** Every vertex and index array is `.slice()`d and
 *    every placement vector freed inside `ifc-source.ts` before this file sees it.
 *  · **Placements are composed in Float64.** Revit shared coordinates routinely put a model
 *    tens of kilometres out, where a float32 coordinate resolves about 4 mm — enough to
 *    crack thin geometry and z-fight 6 mm glass. A whole-metre federation offset is
 *    subtracted from the translation in 64-bit before `matrix16` is written.
 *  · **Repeats are instanced.** A window that appears 200 times is one geometry and 200
 *    parts, deduplicated by `geometryExpressID`.
 *
 * Runs unchanged in the worker and under Node (`tests/unit/geometry-streamer.fixture.test.ts`),
 * because it only needs an open `ReadOnlyIfcSource`.
 *
 * Not handled on purpose: a mirrored placement (negative determinant) leaves its triangles
 * wound the other way. The reference renderer draws every element `side: DoubleSide`
 * (`design-reference/design/viewer-core.js:73`), so the face is still shaded correctly, and
 * reversing the winding would mean a second copy of a shared, instanced index buffer.
 */
import { worldToProjectMatrix, type ProjectFrame } from '../shared/georef'
import {
  EDGE_THRESHOLD_DEGREES,
  type FederationOffset,
  type GeometryChunk,
  type GeometryRecord,
  type GeometrySummary,
  type GeometryWarning,
  type PartRecord
} from '../shared/geometry-contract.types'
import type { MeshRecord, ReadOnlyIfcSource } from './ifc-source'

/** Parts per chunk (plan §3.7). */
export const PARTS_PER_CHUNK = 5000
/** Vertices per chunk. */
export const VERTICES_PER_CHUNK = 1_000_000

/** A model's bbox centre further than this from the offset raises `farPlacement`. */
export const FAR_PLACEMENT_METRES = 5_000
/** Coordinates further than this from the project frame's origin raise `precision`. */
export const PRECISION_METRES = 10_000

type Box6 = [number, number, number, number, number, number]

/* ────────────────────────────── Y-up → Z-up ────────────────────────────── */

/**
 * web-ifc's `flatTransformation` hands back **Y-up** world geometry: its own placement code
 * folds a Z-up → Y-up swap into the matrix. IFC is Z-up, the design's renderer is Z-up
 * (`viewer-core.js` sets `camera.up = (0,0,1)` and reads storey elevations off `z`), the mock
 * federation is Z-up, and every annotation in this repository quotes Z-up numbers. So the
 * contract is **IFC Z-up metres** and this is the one place the frames meet.
 *
 * web-ifc maps `(X, Y, Z)_ifc → (X, Z, −Y)_yup`. The inverse is
 * `(x, y, z)_yup → (x, −z, y)_zup`, i.e. the rotation
 *
 *     ⎡ 1  0  0 ⎤
 *     ⎢ 0  0 −1 ⎥   (a +90° turn about +X)
 *     ⎣ 0  1  0 ⎦
 *
 * composed on the **left** of the placement, so it moves the whole world rather than each
 * geometry: `R × T(−offset) × flatTransformation`. The federation offset is chosen and
 * rounded in the Z-up frame — it is the number the user, the grids and the storey elevations
 * see — so in code the rotation is applied first and the offset subtracted from the rotated
 * translation, which is the same matrix.
 */
export const Z_UP_FROM_Y_UP = Object.freeze([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1])

/**
 * `R × m`, both column-major 4×4. Exported for the unit test, which checks a known Y-up
 * placement against the Z-up coordinates it must produce.
 */
export function toZUp(m: ArrayLike<number>, out: Float64Array): Float64Array {
  // R turns a column (x, y, z) into (x, −z, y), so each of the four columns is permuted.
  for (let c = 0; c < 4; c++) {
    const x = m[c * 4]
    const y = m[c * 4 + 1]
    const z = m[c * 4 + 2]
    out[c * 4] = x
    out[c * 4 + 1] = -z
    out[c * 4 + 2] = y
    out[c * 4 + 3] = m[c * 4 + 3]
  }
  return out
}

/** `a × b`, both column-major 4×4, into `out`. `out` may not alias either input. */
function multiply4(a: ArrayLike<number>, b: ArrayLike<number>, out: Float64Array): Float64Array {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4]
    const b1 = b[c * 4 + 1]
    const b2 = b[c * 4 + 2]
    const b3 = b[c * 4 + 3]
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b0 + a[4 + r] * b1 + a[8 + r] * b2 + a[12 + r] * b3
    }
  }
  return out
}

/* ────────────────────────────── crease edges ────────────────────────────── */

/**
 * The design's drawn-edge look is `new THREE.EdgesGeometry(geo, 20)`
 * (`design-reference/design/viewer-core.js:123`). This is that algorithm, replicated so it
 * can run in the worker without three.js: vertices are deduplicated to four decimal places,
 * an edge shared by two triangles is kept when their normals differ by at least the
 * threshold, and an edge used by only one triangle is always kept.
 *
 * `indices` are the geometry's own, 0-based into `positions`. Output is line segments, two
 * vertices (six floats) per segment, in the same local space as `positions`.
 */
export function creaseEdges(
  positions: Float32Array,
  indices: Uint32Array,
  thresholdDegrees: number = EDGE_THRESHOLD_DEGREES
): Float32Array {
  // three.js uses `precisionPoints = 4`; the same rounding, so the same welds.
  const precision = 1e4
  const thresholdDot = Math.cos((Math.PI / 180) * thresholdDegrees)

  interface Pending {
    a: number
    b: number
    nx: number
    ny: number
    nz: number
  }
  /** `null` marks an edge already matched and emitted (or rejected) — three's own trick. */
  const edges = new Map<string, Pending | null>()
  const out: number[] = []

  const hash = (v: number): string => {
    const i = v * 3
    return `${Math.round(positions[i] * precision)},${Math.round(positions[i + 1] * precision)},${Math.round(positions[i + 2] * precision)}`
  }
  const push = (a: number, b: number): void => {
    out.push(positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2])
    out.push(positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2])
  }

  const tri = [0, 0, 0]
  const hashes = ['', '', '']
  for (let i = 0; i + 2 < indices.length; i += 3) {
    tri[0] = indices[i]
    tri[1] = indices[i + 1]
    tri[2] = indices[i + 2]
    hashes[0] = hash(tri[0])
    hashes[1] = hash(tri[1])
    hashes[2] = hash(tri[2])
    // Degenerate triangles have no normal; three skips them and so do we.
    if (hashes[0] === hashes[1] || hashes[1] === hashes[2] || hashes[2] === hashes[0]) continue

    // three's Triangle.getNormal: normalize( (c − b) × (a − b) ).
    const ax = positions[tri[0] * 3],
      ay = positions[tri[0] * 3 + 1],
      az = positions[tri[0] * 3 + 2]
    const bx = positions[tri[1] * 3],
      by = positions[tri[1] * 3 + 1],
      bz = positions[tri[1] * 3 + 2]
    const cx = positions[tri[2] * 3],
      cy = positions[tri[2] * 3 + 1],
      cz = positions[tri[2] * 3 + 2]
    const ux = cx - bx,
      uy = cy - by,
      uz = cz - bz
    const vx = ax - bx,
      vy = ay - by,
      vz = az - bz
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (len > 0) {
      nx /= len
      ny /= len
      nz /= len
    } else {
      nx = ny = nz = 0
    }

    for (let j = 0; j < 3; j++) {
      const jNext = (j + 1) % 3
      const key = `${hashes[j]}_${hashes[jNext]}`
      const reverse = `${hashes[jNext]}_${hashes[j]}`
      const sibling = edges.get(reverse)
      if (sibling !== undefined) {
        if (sibling !== null) {
          if (nx * sibling.nx + ny * sibling.ny + nz * sibling.nz <= thresholdDot) {
            push(tri[j], tri[jNext])
          }
          edges.set(reverse, null)
        }
      } else if (!edges.has(key)) {
        edges.set(key, { a: tri[j], b: tri[jNext], nx, ny, nz })
      }
    }
  }

  // Every edge with no sibling is a boundary and is always drawn.
  for (const pending of edges.values()) if (pending) push(pending.a, pending.b)

  return new Float32Array(out)
}

/* ────────────────────────────── surface-style transparency ────────────────────────────── */

/**
 * web-ifc does not fold `IfcSurfaceStyleShading/Rendering.Transparency` into the placed
 * colour's alpha, so every window comes back opaque unless we resolve it ourselves
 * (Aquila's `src/ifc-loader.js`, the author's earlier viewer). This walks `IfcStyledItem`
 * once per model and returns the alpha (`1 − Transparency`) for each styled representation
 * item; those ids are the `geometryExpressID`s the stream reports.
 *
 * Entities are identified by type code, never by `constructor.name`: a minified build
 * mangles class names, which is Aquila's own note two functions further down.
 */
export function collectSurfaceStyleAlpha(
  src: ReadOnlyIfcSource,
  modelID: number
): Map<number, number> {
  const alphaByItem = new Map<number, number>()
  const styledItem = src.typeCode('IFCSTYLEDITEM')
  if (!styledItem) return alphaByItem

  const nested = new Set(
    [src.typeCode('IFCSURFACESTYLE'), src.typeCode('IFCPRESENTATIONSTYLEASSIGNMENT')].filter(
      (code) => code > 0
    )
  )
  const shading = new Set(
    [src.typeCode('IFCSURFACESTYLESHADING'), src.typeCode('IFCSURFACESTYLERENDERING')].filter(
      (code) => code > 0
    )
  )

  /** The strongest transparency reachable from these style refs, as an alpha. */
  const walk = (refs: unknown, depth: number): number => {
    if (!Array.isArray(refs) || depth > 8) return 1
    let alpha = 1
    for (const ref of refs) {
      const id = (ref as { value?: unknown } | null)?.value
      if (typeof id !== 'number' || !id) continue
      const code = src.lineType(modelID, id)
      if (nested.has(code)) {
        const line = src.line(modelID, id)
        if (line) alpha = Math.min(alpha, walk(line.Styles, depth + 1))
      } else if (shading.has(code)) {
        const line = src.line(modelID, id)
        const raw = line?.Transparency as { value?: unknown } | number | null | undefined
        const value = typeof raw === 'object' && raw !== null ? raw.value : raw
        const transparency = Number(value)
        if (Number.isFinite(transparency) && transparency > 0.01) {
          alpha = Math.min(alpha, 1 - Math.min(1, transparency))
        }
      }
    }
    return alpha
  }

  for (const id of src.idsWithType(modelID, styledItem)) {
    const line = src.line(modelID, id)
    const item = (line?.Item as { value?: unknown } | null)?.value
    if (typeof item !== 'number' || !item) continue
    const alpha = walk(line?.Styles, 0)
    if (alpha < 1) alphaByItem.set(item, Math.min(alpha, alphaByItem.get(item) ?? 1))
  }
  return alphaByItem
}

/* ────────────────────────────── the streamer ────────────────────────────── */

export interface GeometryStreamOptions {
  modelKey: string
  /**
   * The federation offset, or `null` for the first model: then the first streamed mesh's
   * translation rounded to whole metres becomes the offset, and the summary reports it so
   * the renderer can hand it to every later model.
   *
   * It is chosen **after** the project frame is applied, so it is stated in the frame the
   * scene, the grids, the storey ladder and every readout use.
   */
  offset: FederationOffset | null
  /**
   * The federation's project frame — the boot model's spatial-root `IfcSite.ObjectPlacement`,
   * read as project → world. Its inverse is composed on the left of every placement, so the
   * scene comes out in the frame the building was drawn in rather than in the map-aligned
   * world coordinates a shared-coordinates export writes. `null` is the identity.
   *
   * The caller owns it (`renderer/model/federation-store.ts`), exactly as it owns the offset:
   * the first model of the boot batch chooses it and every later model is placed against the
   * same one, which is what keeps a second discipline federated by world coordinates.
   */
  frame: ProjectFrame | null
  /** Called once per chunk with the buffers that may be transferred rather than copied. */
  onChunk: (chunk: GeometryChunk, transfer: ArrayBuffer[]) => void
}

/** One chunk under construction. Pieces are concatenated once, at flush. */
interface Pending {
  positions: Float32Array[]
  normals: Float32Array[]
  indices: Uint32Array[]
  edges: Float32Array[]
  vertexCount: number
  indexCount: number
  edgeVertexCount: number
  geoms: GeometryRecord[]
  parts: PartRecord[]
  /** `geometryExpressID` → index into `geoms` + the geometry's local AABB. */
  byGeometry: Map<number, { geomIdx: number; box: Box6 }>
}

const fresh = (): Pending => ({
  positions: [],
  normals: [],
  indices: [],
  edges: [],
  vertexCount: 0,
  indexCount: 0,
  edgeVertexCount: 0,
  geoms: [],
  parts: [],
  byGeometry: new Map()
})

function concatF32(pieces: readonly Float32Array[], floats: number): Float32Array {
  const out = new Float32Array(floats)
  let at = 0
  for (const piece of pieces) {
    out.set(piece, at)
    at += piece.length
  }
  return out
}

function concatU32(pieces: readonly Uint32Array[], length: number): Uint32Array {
  const out = new Uint32Array(length)
  let at = 0
  for (const piece of pieces) {
    out.set(piece, at)
    at += piece.length
  }
  return out
}

/**
 * Stream one open model's geometry as chunks.
 *
 * Synchronous on purpose: it runs in the parse worker, where a four-second stall costs
 * nothing, and web-ifc's own stream API is synchronous anyway.
 */
export function streamGeometry(
  src: ReadOnlyIfcSource,
  modelID: number,
  options: GeometryStreamOptions
): GeometrySummary {
  const started = Date.now()
  const { modelKey } = options
  const alphaByItem = collectSurfaceStyleAlpha(src, modelID)

  /*
   * The stream callback's own index/total restart at every IFC type web-ifc walks, so a bar
   * driven from them saws back to zero a dozen times. Count products up front instead:
   * every IfcElement except the openings web-ifc skips, plus the spaces we stream after.
   * Reads in about 0 ms and is accurate within 1 %.
   */
  const countOf = (name: string): number => {
    const code = src.typeCode(name)
    return code ? src.idsWithType(modelID, code, true).length : 0
  }
  const expected = Math.max(
    1,
    countOf('IFCELEMENT') - countOf('IFCOPENINGELEMENT') + countOf('IFCSPACE')
  )

  let offset: FederationOffset | null = options.offset
    ? [options.offset[0], options.offset[1], options.offset[2]]
    : null
  const offsetFromThisModel = options.offset === null

  let pending = fresh()
  let chunks = 0
  let parts = 0
  let vertices = 0
  let triangles = 0
  let edgeSegments = 0
  let meshes = 0
  const uniqueGeometries = new Set<number>()

  // World bounds (offset already subtracted). Kept in Float64 for the two warnings.
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity

  const flush = (): void => {
    if (!pending.parts.length) return
    const positions = concatF32(pending.positions, pending.vertexCount * 3)
    const normals = concatF32(pending.normals, pending.vertexCount * 3)
    const indices = concatU32(pending.indices, pending.indexCount)
    const edges = concatF32(pending.edges, pending.edgeVertexCount * 3)
    const chunk: GeometryChunk = {
      header: { modelKey, index: Math.min(meshes, expected), total: expected },
      positions,
      normals,
      indices,
      edges,
      geoms: pending.geoms,
      parts: pending.parts
    }
    chunks++
    options.onChunk(chunk, [
      positions.buffer as ArrayBuffer,
      normals.buffer as ArrayBuffer,
      indices.buffer as ArrayBuffer,
      edges.buffer as ArrayBuffer
    ])
    pending = fresh()
  }

  /** Add a geometry to the current chunk if it is not already in it. */
  const geometryIn = (geometryExpressId: number): { geomIdx: number; box: Box6 } | null => {
    const known = pending.byGeometry.get(geometryExpressId)
    if (known) return known

    const data = src.readGeometry(modelID, geometryExpressId)
    if (!data) return null
    const { vertexData, indexData } = data
    const count = (vertexData.length / 6) | 0
    if (!count || !indexData.length) return null

    // web-ifc interleaves position and normal: px py pz nx ny nz.
    const positions = new Float32Array(count * 3)
    const normals = new Float32Array(count * 3)
    let bx0 = Infinity,
      by0 = Infinity,
      bz0 = Infinity,
      bx1 = -Infinity,
      by1 = -Infinity,
      bz1 = -Infinity
    for (let i = 0; i < count; i++) {
      const s = i * 6
      const d = i * 3
      const x = vertexData[s]
      const y = vertexData[s + 1]
      const z = vertexData[s + 2]
      positions[d] = x
      positions[d + 1] = y
      positions[d + 2] = z
      normals[d] = vertexData[s + 3]
      normals[d + 1] = vertexData[s + 4]
      normals[d + 2] = vertexData[s + 5]
      if (x < bx0) bx0 = x
      if (y < by0) by0 = y
      if (z < bz0) bz0 = z
      if (x > bx1) bx1 = x
      if (y > by1) by1 = y
      if (z > bz1) bz1 = z
    }

    // Crease edges are computed once per unique geometry, in its own local space.
    const edges = creaseEdges(positions, indexData)

    const vertexOffset = pending.vertexCount
    const indices = new Uint32Array(indexData.length)
    for (let i = 0; i < indexData.length; i++) indices[i] = indexData[i] + vertexOffset

    const geomIdx = pending.geoms.length
    pending.geoms.push({
      geometryExpressId,
      vertexOffset,
      vertexCount: count,
      indexOffset: pending.indexCount,
      indexCount: indices.length,
      edgeOffset: edges.length ? pending.edgeVertexCount : -1,
      edgeCount: edges.length / 3
    })
    pending.positions.push(positions)
    pending.normals.push(normals)
    pending.indices.push(indices)
    pending.edges.push(edges)
    pending.vertexCount += count
    pending.indexCount += indices.length
    pending.edgeVertexCount += edges.length / 3

    uniqueGeometries.add(geometryExpressId)
    vertices += count
    triangles += indices.length / 3
    edgeSegments += edges.length / 6

    const entry = { geomIdx, box: [bx0, by0, bz0, bx1, by1, bz1] as Box6 }
    pending.byGeometry.set(geometryExpressId, entry)
    return entry
  }

  // Reused across every placement; `take` is synchronous and never re-enters.
  const composed = new Float64Array(16)
  const zUp = new Float64Array(16)
  /** World → project, or `null` when the two frames coincide and nothing is composed. */
  const toProjectM = worldToProjectMatrix(options.frame)

  const take = (mesh: MeshRecord, isSpace: boolean): void => {
    meshes++
    for (const placed of mesh.placements) {
      const m = placed.flatTransformation
      if (m.length < 16) continue

      /*
       * frame⁻¹ × R × flatTransformation, in Float64: out of web-ifc's Y-up frame into IFC
       * Z-up, and out of the file's world coordinates into the frame the building was drawn
       * in. Then T(−offset), which for a column-major matrix is just the offset taken off the
       * translation column — the rotation and scale stay untouched and only the large numbers
       * shrink. Written out through a Float32Array so `matrix16` holds what the GPU will see.
       */
      if (toProjectM) multiply4(toProjectM, toZUp(m, zUp), composed)
      else toZUp(m, composed)

      // The first placement of the first model fixes the offset, rounded to whole metres so
      // it is exact and reproducible run to run. Chosen **after** the swap and the frame, so
      // it is stated in the project frame the grids, storeys and every readout use.
      offset ??= [
        Math.round(composed[12]),
        Math.round(composed[13]),
        Math.round(composed[14])
      ] as FederationOffset

      if (
        pending.parts.length >= PARTS_PER_CHUNK ||
        pending.vertexCount >= VERTICES_PER_CHUNK
      ) {
        flush()
      }

      const entry = geometryIn(placed.geometryExpressId)
      if (!entry) continue

      composed[12] -= offset[0]
      composed[13] -= offset[1]
      composed[14] -= offset[2]

      // World AABB of the transformed local AABB: eight corners, not every vertex, because
      // a geometry is shared by every part that instances it.
      const [x0, y0, z0, x1, y1, z1] = entry.box
      let px0 = Infinity,
        py0 = Infinity,
        pz0 = Infinity,
        px1 = -Infinity,
        py1 = -Infinity,
        pz1 = -Infinity
      for (let c = 0; c < 8; c++) {
        const x = c & 1 ? x1 : x0
        const y = c & 2 ? y1 : y0
        const z = c & 4 ? z1 : z0
        const wx = composed[0] * x + composed[4] * y + composed[8] * z + composed[12]
        const wy = composed[1] * x + composed[5] * y + composed[9] * z + composed[13]
        const wz = composed[2] * x + composed[6] * y + composed[10] * z + composed[14]
        if (wx < px0) px0 = wx
        if (wy < py0) py0 = wy
        if (wz < pz0) pz0 = wz
        if (wx > px1) px1 = wx
        if (wy > py1) py1 = wy
        if (wz > pz1) pz1 = wz
      }
      if (px0 < minX) minX = px0
      if (py0 < minY) minY = py0
      if (pz0 < minZ) minZ = pz0
      if (px1 > maxX) maxX = px1
      if (py1 > maxY) maxY = py1
      if (pz1 > maxZ) maxZ = pz1

      const styleAlpha = alphaByItem.get(placed.geometryExpressId)
      const part: PartRecord = {
        elementId: mesh.expressId,
        geomIdx: entry.geomIdx,
        matrix16: [...new Float32Array(composed)],
        rgba: [
          placed.color[0],
          placed.color[1],
          placed.color[2],
          styleAlpha === undefined ? placed.color[3] : Math.min(placed.color[3], styleAlpha)
        ],
        bbox6: [px0, py0, pz0, px1, py1, pz1]
      }
      if (isSpace) part.isSpace = true
      pending.parts.push(part)
      parts++
    }
  }

  src.streamAllMeshes(modelID, (mesh) => take(mesh, false))
  // IfcSpace is excluded from StreamAllMeshes; the storey panel and room tags need it.
  const spaceCode = src.typeCode('IFCSPACE')
  if (spaceCode) src.streamMeshesWithTypes(modelID, [spaceCode], (mesh) => take(mesh, true))
  flush()

  const empty = minX === Infinity
  const bbox6: Box6 | null = empty ? null : [minX, minY, minZ, maxX, maxY, maxZ]
  const warnings: GeometryWarning[] = []
  if (bbox6) {
    // Recentred coordinates, so the distance from the offset is the distance from zero.
    const cx = (bbox6[0] + bbox6[3]) / 2
    const cy = (bbox6[1] + bbox6[4]) / 2
    const cz = (bbox6[2] + bbox6[5]) / 2
    const away = Math.hypot(cx, cy, cz)
    if (away > FAR_PLACEMENT_METRES) {
      warnings.push({
        kind: 'farPlacement',
        detail: `${(away / 1000).toFixed(2)} km from the federation offset`
      })
    }
    // Back in the project frame's own coordinates: how far the vertices sit from its origin.
    const [ox, oy, oz] = offset ?? [0, 0, 0]
    const local = Math.max(
      Math.abs(bbox6[0] + ox),
      Math.abs(bbox6[1] + oy),
      Math.abs(bbox6[2] + oz),
      Math.abs(bbox6[3] + ox),
      Math.abs(bbox6[4] + oy),
      Math.abs(bbox6[5] + oz)
    )
    if (local > PRECISION_METRES) {
      warnings.push({
        kind: 'precision',
        detail: `${(local / 1000).toFixed(2)} km from the project origin — float32 resolves about ${((local * 1.2e-7 * 1000) | 0) + 1} mm there`
      })
    }
  }

  return {
    modelKey,
    offset: offset ?? [0, 0, 0],
    offsetFromThisModel,
    frame: options.frame,
    warnings,
    coordinationMatrix: src.coordinationMatrix(modelID),
    chunks,
    geometries: uniqueGeometries.size,
    parts,
    vertices,
    triangles,
    edgeSegments,
    bbox6,
    ms: Date.now() - started
  }
}
