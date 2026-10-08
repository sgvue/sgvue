/**
 * The worker → renderer geometry contract (plan §3.7 and SYSTEM_SPEC §7).
 *
 * `src/worker/geometry-streamer.ts` produces these and `src/renderer/viewer/batches.ts`
 * consumes them; the mock adapter emits the same shape, so the parity harness renders
 * through the real contract.
 *
 * **The frame is IFC Z-up, metres.** `+z` is up, storey elevations are `z`, and the design's
 * renderer, its mock federation and every reference annotation agree. web-ifc is the one
 * producer that does not — it emits Y-up — and `geometry-streamer.ts` converts once.
 *
 * One chunk is about a million vertices or five thousand parts. Buffers are transferred,
 * never copied, so every typed array here owns its own `ArrayBuffer`.
 */

/** A deduplicated mesh, referenced by many parts (a window repeated 200× is stored once). */
export interface GeometryRecord {
  /** web-ifc's `geometryExpressID`; the dedupe key within one model. */
  geometryExpressId: number
  /** Offset into the chunk's `positions` / `normals`, in vertices. */
  vertexOffset: number
  vertexCount: number
  /** Offset into the chunk's `indices`, in indices. */
  indexOffset: number
  indexCount: number
  /** Offset into the chunk's `edges`, in vertices (2 per segment). `-1` when none. */
  edgeOffset: number
  edgeCount: number
}

/** One placed instance of a geometry: this is what a pick resolves to. */
export interface PartRecord {
  /**
   * The element's **model-local** `expressId`, exactly as `ModelIndex` records it. The
   * federation id is `slot * 1_000_000 + elementId` (`shared/federate.ts`); a chunk knows
   * its model but not its slot, so the renderer adds the offset when it attaches a chunk.
   */
  elementId: number
  /** Index into the chunk's `geoms`. */
  geomIdx: number
  /**
   * Column-major 4×4 world placement in the contract's frame — **IFC Z-up metres** — composed
   * in Float64 with the federation offset already subtracted. `flatTransformation` already
   * applies the file's length unit (never scale again) and hands back **Y-up**; the streamer
   * composes the single inverse rotation `(x, y, z)_Yup → (x, −z, y)_Zup` on the left of
   * every placement, so nothing downstream rotates anything.
   */
  matrix16: readonly number[]
  /** The file's own colour, 0–1 per channel. Alpha < 1 puts the part in the glass batch. */
  rgba: readonly [number, number, number, number]
  /**
   * World AABB `[minX, minY, minZ, maxX, maxY, maxZ]`, metres, **Z-up** — so `z` is the
   * storey axis and the first picking filter. The AABB of the transformed local AABB, so a
   * rotated part's box is conservative.
   */
  bbox6: readonly [number, number, number, number, number, number]
  /** True for an `IfcSpace` part: drawn, picked and hidden separately from real elements. */
  isSpace?: boolean
}

/**
 * Progress that reflects real work, as `index` of `total` for this model — monotonic, and
 * never a bare percentage. The producer picks the unit and states it: the worker counts
 * meshes streamed against the product count read up front (web-ifc's own stream `index`/
 * `total` restart at every IFC type it walks, so they saw back to zero), and the mock
 * adapter, which has everything in hand, counts chunks.
 */
export interface GeometryChunkHeader {
  modelKey: string
  index: number
  total: number
}

export interface GeometryChunk {
  header: GeometryChunkHeader
  /** Interleaved xyz, metres, model-local — the part matrix places it and turns it Z-up. */
  positions: Float32Array
  /** Interleaved xyz unit normals. */
  normals: Float32Array
  indices: Uint32Array
  /**
   * Crease line segments at the reference's 20° threshold — the design's drawn-edge look.
   * Two vertices per segment, same space as `positions`.
   */
  edges: Float32Array
  geoms: readonly GeometryRecord[]
  parts: readonly PartRecord[]
}

/** The crease angle `EdgesGeometry(geo, 20)` uses in the reference renderer. */
export const EDGE_THRESHOLD_DEGREES = 20

/* ────────────────────────────── federation placement ────────────────────────────── */

/**
 * Whole metres subtracted from every placement so the scene sits near the origin, stated in
 * the contract's **Z-up** frame. Taken from the first streamed mesh of the first model
 * (after the Y-up → Z-up swap) and then fixed for the session: Revit shared coordinates
 * routinely place a model tens of kilometres out, where a float32 vertex resolves about
 * 4 mm. Storey elevations and grid coordinates read from the index are in the file's own
 * coordinates, so a consumer that draws them alongside geometry subtracts this first.
 */
export type FederationOffset = readonly [number, number, number]

/**
 * **The scene is the project frame, minus the offset.**
 *
 * A file's world coordinates need not be the frame the building was drawn in: the CORENET X
 * convention puts the position *and* the rotation to true north on the spatial-root
 * `IfcSite.ObjectPlacement`, so the reference model's world axes are map axes and its building
 * stands at 43° to them. Everything the app draws axis-aligned — level rings, grid-bubble
 * clipping, laser axes, dimension lines, the bounding box's Length and Width, the N/S/E/W
 * views — is then wrong by that angle.
 *
 * So `geometry-streamer.ts` composes the inverse of that placement on the left, once, next to
 * the Y-up → Z-up rotation it already composes: `frame⁻¹ × R × flatTransformation`, in Float64.
 * The federation's frame P is a **federation constant**, exactly like the offset — the boot
 * model's project frame in map coordinates, chosen once — and since 2026-10-08 each model is
 * streamed through its own frame against it, M_i⁻¹ ∘ P (`shared/georef.ts`'s `modelFrame`), so
 * models federate by their **map** coordinates: one placed by its site placement and one placed
 * by `IfcMapConversion` land together. `null` is the identity, which is every file that leaves
 * its site at the origin and states no map conversion, and the design's own mock federation.
 *
 * Shape and semantics live in `shared/georef.ts` (`ProjectFrame`, `projectFrame`, `toProject`,
 * `toWorld`, `frameKey`); this is the re-export the contract is stated in.
 */
export type { ProjectFrame } from './georef'

export interface GeometryWarning {
  /** `farPlacement`: bbox centre > 5 km from the offset. `precision`: local coordinates > 10 km from the file's own origin. */
  kind: 'farPlacement' | 'precision'
  /** A real number, not a percentage — the distance that triggered it. */
  detail: string
  /** That distance, in metres (2026-10-08: the Coordinate-system card's note reads it). */
  metres: number
}

/** What the worker reports once a model's geometry has finished streaming. */
export interface GeometrySummary {
  modelKey: string
  /** The offset in force. Echoed back so the renderer can store it as federation state. */
  offset: FederationOffset
  /** True when this model defined the offset (the request carried `null`). */
  offsetFromThisModel: boolean
  /** The frame this model was streamed in — its own, M_i⁻¹ ∘ P — echoed back with the offset. */
  frame: import('./georef').ProjectFrame | null
  warnings: readonly GeometryWarning[]
  /** `GetCoordinationMatrix`, for the record. Identity while `COORDINATE_TO_ORIGIN` is false. */
  coordinationMatrix: readonly number[]
  chunks: number
  /** Distinct `geometryExpressID`s in the model — parts ÷ geometries is the instancing win. */
  geometries: number
  parts: number
  /** Vertices, triangles and edge segments **stored** — deduplicated, not drawn per part. */
  vertices: number
  triangles: number
  edgeSegments: number
  /** World AABB (Z-up) of everything streamed, offset already subtracted. `null` when empty. */
  bbox6: readonly [number, number, number, number, number, number] | null
  ms: number
}
