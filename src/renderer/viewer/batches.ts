/**
 * Merged geometry slots — the reference's per-element `THREE.Mesh` at a size that survives a
 * real model.
 *
 * ## Why this is not `BatchedMesh`
 *
 * One mesh per product does not survive: ~26 500 draw calls sat at about 12 fps on a 144 MB
 * file (`CLAUDE.md`, rendering traps). The first answer here was `BatchedMesh` — one
 * `addGeometry` per deduplicated shape, one `addInstance` per placement. It is wrong at this
 * size for a reason that is not visible in `renderer.info`: **a `BatchedMesh` costs one
 * driver-level draw per visible instance.** WebGPU has no multi-draw at all in three 0.186,
 * and on macOS ANGLE/Metal emulates `WEBGL_multi_draw` by replaying the command list per draw
 * with its own state. At 67 364 instances — doubled by the shadow pass — that floods the
 * Electron GPU helper process by gigabytes per second.
 *
 * It kernel-panicked this Mac three times on 2026-09-17, every panic report naming the GPU
 * helper at ~168–170 GB. Measured under a bounded external guard: the GPU process sat flat at
 * 634 MB through parse and geometry streaming, then went **634 MB → 5 461 MB inside one 0.5 s
 * poll**, in the instant after the batches were uploaded and the first frame was drawn. At the
 * same moment `app.getAppMetrics().memory.workingSetSize` still read 106 MB — see
 * `src/main/gpu-guard.ts` for why `phys_footprint` is the only number that sees this.
 *
 * ## What replaces it
 *
 * Plan §3.7's other option: **one merged mesh per slot and family**, a few dozen draws a
 * frame, which is what Marumi's `src/viewer/batch.ts` (the author's earlier viewer) did on this same
 * model. Each part's vertices are baked into federation space with its own `matrix16` (the
 * placement is composed upstream in Float64) and concatenated; every vertex carries its
 * part's index in a `partIndex` attribute, and the per-part colour and state live in one
 * small texture (`part-state.ts`) the materials read. Deduplication is lost — a geometry used
 * by two parts is written twice, about 1.9× the vertices — and that is the price of the fix.
 *
 * **Two families, the reference's own rule** (`viewer-core.js` L73, L120): `solid` for parts
 * the file draws opaque, which cast shadows, and `glass` for anything with alpha < 1, which
 * never casts and never writes depth. A part's family is fixed by its file colour when it is
 * loaded and never changes, because a part cannot move between merged buffers. Since
 * 2026-09-24 a third, `space`, takes every `IfcSpace` part whatever its colour: glass's rules
 * at a fixed faint opacity (`materials.ts`, `SPACE_ALPHA`).
 *
 * **The see-through mesh.** `depthWrite` belongs to a material and a merged mesh has one
 * material for thousands of parts, so a ghosted part inside an opaque mesh either hides what
 * is behind it or stops the opaque ones occluding. A second `Mesh` over the *same*
 * `BufferGeometry` with the see-through material resolves it exactly: `maskNode` makes each
 * material discard what the other draws, so a part is rasterised by precisely one of them,
 * the solid mesh stays opaque and writes depth, and the see-through one blends over it
 * afterwards writing none. Nothing is duplicated but the `Mesh` object — and unlike the
 * `BatchedMesh` twin it replaces, it touches no private field of three's.
 *
 * **Slots are sized by their contents.** The caps below only decide where an oversized chunk
 * splits.
 */
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  Material,
  Matrix3,
  Matrix4,
  Mesh,
  Vector3,
  Vector4
} from 'three/webgpu'
import type { GeometryChunk, PartRecord } from '../../shared/geometry-contract.types'
import { fedId, localIdRefusal } from '../../shared/federate'
import { linearRgba } from './materials'
import type { PartState } from './part-state'

/** Upper bounds for one slot (plan §3.7). A chunk is already capped below these. */
export const SLOT_MAX_PARTS = 65_536
export const SLOT_MAX_VERTICES = 1_000_000
export const SLOT_MAX_INDICES = 3_000_000

/**
 * Draw order. The solid family is opaque and so is drawn first by the renderer whatever its
 * `renderOrder`; the rest is the transparent pass, in the reference's own order — edges over
 * the solids they trace, then the see-through meshes, then glass.
 */
export const RENDER_ORDER_SOLID = 0
export const RENDER_ORDER_EDGE = 1
export const RENDER_ORDER_GHOST = 2
export const RENDER_ORDER_GLASS = 3
/**
 * `IfcSpace` (2026-09-24): after the see-through meshes and **before** glass — a room is
 * inside the envelope, so from outside the glazing is the nearer surface and blends last.
 */
export const RENDER_ORDER_SPACE = 2.5

/**
 * `space` is the 2026-09-24 third family: every `IfcSpace` part, whatever its file alpha,
 * drawn as a faint tint that never casts and never writes depth (`materials.ts`).
 */
export type Family = 'solid' | 'glass' | 'space'

export interface Slot {
  mesh: Mesh
  /** The see-through half of a solid slot; `null` for glass, which never writes depth. */
  ghost: Mesh | null
  geometry: BufferGeometry
  family: Family
  modelKey: string
  /** Parts merged into this slot. */
  count: number
  /** Expanded vertices in this slot's merged buffers. */
  vertexCount: number
  /** Global part index of this slot's first part; its parts run on from there. */
  firstPart: number
  /** Per part, `[indexStart, indexCount]` into this slot's index buffer — `picking.ts` walks it. */
  partRange: Uint32Array
  removed: boolean
}

/**
 * One element, as the renderer needs it. The reference's `recs` map, minus the per-element
 * meshes and edge lines it no longer owns.
 */
export interface ElementRecord {
  /** Federation id: `fedId(slot, expressId)` — `slot * ID_STRIDE + expressId`. */
  id: number
  modelKey: string
  /** Index into `BatchStore.slots`, one per part. */
  slotOf: number[]
  /** Global part index — the row of `part-state.ts` this part reads, one per part. */
  partOf: number[]
  /**
   * The file's own colour per part, sRGB 0–1, four per part — the base every override starts
   * from. A space part's alpha is stored as 1: the space material supplies its opacity.
   */
  rgba: number[]
  bbox: Box3
  /** Parts, i.e. the reference's solid count for the Geometry rows of the property card. */
  solidCount: number
  /**
   * An `IfcSpace` (2026-09-24): drawn by the space family, and picked only when nothing else
   * is on the ray (`picking.ts`).
   */
  space: boolean
  visible: boolean
  /** Drawn by the slot's see-through mesh rather than its opaque one. */
  seeThrough: boolean
  fading: boolean
  /** True when this element matches the current highlight set. */
  hl: boolean
}

export interface BatchStore {
  group: Group
  slots: Slot[]
  elements: Map<number, ElementRecord>
  /**
   * Union of every element box — what the scene is scaled from and what must stay covered
   * (clip planes, shadow frustum, ground). The camera frames the viewer's building box.
   */
  bbox: Box3
  /** Expanded vertices actually uploaded, across every live slot. */
  readonly vertices: number
  addChunk(
    chunk: GeometryChunk,
    federationSlot: number,
    materials: {
      parts: PartState
      solid: Material
      ghost: Material
      glass: Material
      /** The `IfcSpace` family's material; glass's when absent (the unit tests' stubs). */
      space?: Material
    },
    /**
     * Whose parts these are: the chunk's own model key unless given. `viewer-core.ts` streams
     * a replacement in under a label of its own and `relabel`s it once the old model is gone.
     */
    modelKey?: string
  ): void
  /** After a chunk lands: refresh the bounds the frustum test reads. */
  finishModel(modelKey: string): void
  /** Write one part's colour and state. sRGB in, working space out. */
  setPartState(rec: ElementRecord, part: number, r: number, g: number, b: number, a: number): void
  /**
   * Show or hide every see-through mesh at the object level. Nothing is see-through most of
   * the time, and an invisible mesh costs neither a draw nor a shader invocation.
   */
  setGhostActive(on: boolean): void
  /** Objects this store will submit — the honest draw count when the renderer reports none. */
  drawObjects(): number
  removeModel(modelKey: string): number[]
  /** Hand every slot and element labelled `from` to `to`. */
  relabel(from: string, to: string): void
  castShadows(on: boolean): void
  dispose(): void
}

const _m4 = new Matrix4()
const _n3 = new Matrix3()
const _v3 = new Vector3()
const _v4 = new Vector4()

/** A slot-sized partition of one family's parts within one chunk. */
interface Partition {
  parts: PartRecord[]
  vertices: number
  indices: number
}

/**
 * Split a family's parts so no slot exceeds the caps. Every part contributes its geometry's
 * vertices — there is no deduplication once the placement is baked in, which is why a chunk
 * that fitted one `BatchedMesh` may now become two merged slots.
 */
export function partitionParts(chunk: GeometryChunk, parts: readonly PartRecord[]): Partition[] {
  const out: Partition[] = []
  let cur: Partition = { parts: [], vertices: 0, indices: 0 }
  for (const part of parts) {
    const geom = chunk.geoms[part.geomIdx]
    if (
      cur.parts.length > 0 &&
      (cur.parts.length + 1 > SLOT_MAX_PARTS ||
        cur.vertices + geom.vertexCount > SLOT_MAX_VERTICES ||
        cur.indices + geom.indexCount > SLOT_MAX_INDICES)
    ) {
      out.push(cur)
      cur = { parts: [], vertices: 0, indices: 0 }
    }
    cur.vertices += geom.vertexCount
    cur.indices += geom.indexCount
    cur.parts.push(part)
  }
  if (cur.parts.length) out.push(cur)
  return out
}

export function createBatchStore(): BatchStore {
  const group = new Group()
  const slots: Slot[] = []
  const elements = new Map<number, ElementRecord>()
  const bbox = new Box3()
  let shadowsOn = true
  let vertices = 0
  let ghostsOn = false
  /** The one part-state texture every slot writes into; handed over by the first chunk. */
  let state: PartState | null = null

  const addPartition = (
    chunk: GeometryChunk,
    federationSlot: number,
    family: Family,
    parts: PartState,
    material: Material,
    ghostMaterial: Material | null,
    p: Partition,
    modelKey: string
  ): void => {
    const positions = new Float32Array(p.vertices * 3)
    const normals = new Float32Array(p.vertices * 3)
    // One float per vertex rather than an integer attribute: the same value at all three
    // vertices of a triangle interpolates to itself, and the material rounds rather than
    // truncates, so no `flat` qualifier is needed on either backend.
    const partIndex = new Float32Array(p.vertices)
    const index = new Uint32Array(p.indices)
    const partRange = new Uint32Array(p.parts.length * 2)

    const slotIndex = slots.length
    const firstPart = parts.allocate(p.parts.length)

    let vAt = 0
    let iAt = 0
    for (let local = 0; local < p.parts.length; local++) {
      const part = p.parts[local]
      const g = chunk.geoms[part.geomIdx]
      const globalPart = firstPart + local
      _m4.fromArray(part.matrix16 as number[])
      // A placement may be mirrored or non-uniformly scaled, so the normal goes through the
      // inverse transpose. Winding is left alone: every family material is `DoubleSide`
      // (`viewer-core.js` L73), which is why mirrored parts need no index reversal.
      _n3.getNormalMatrix(_m4)

      const src = g.vertexOffset * 3
      for (let i = 0; i < g.vertexCount; i++) {
        _v3.set(chunk.positions[src + i * 3], chunk.positions[src + i * 3 + 1], chunk.positions[src + i * 3 + 2])
        _v3.applyMatrix4(_m4)
        positions[(vAt + i) * 3] = _v3.x
        positions[(vAt + i) * 3 + 1] = _v3.y
        positions[(vAt + i) * 3 + 2] = _v3.z
        _v3.set(chunk.normals[src + i * 3], chunk.normals[src + i * 3 + 1], chunk.normals[src + i * 3 + 2])
        _v3.applyMatrix3(_n3).normalize()
        normals[(vAt + i) * 3] = _v3.x
        normals[(vAt + i) * 3 + 1] = _v3.y
        normals[(vAt + i) * 3 + 2] = _v3.z
        partIndex[vAt + i] = globalPart
      }
      // Chunk indices are chunk-relative; rebase them onto this slot's own vertices.
      const shift = vAt - g.vertexOffset
      for (let i = 0; i < g.indexCount; i++) index[iAt + i] = chunk.indices[g.indexOffset + i] + shift
      partRange[local * 2] = iAt
      partRange[local * 2 + 1] = g.indexCount
      vAt += g.vertexCount
      iAt += g.indexCount

      const id = fedId(federationSlot, part.elementId)
      let rec = elements.get(id)
      if (!rec) {
        rec = {
          id,
          modelKey,
          slotOf: [],
          partOf: [],
          rgba: [],
          bbox: new Box3(),
          solidCount: 0,
          space: family === 'space',
          visible: true,
          seeThrough: false,
          fading: false,
          hl: false
        }
        elements.set(id, rec)
      }
      // A space's opacity is the space material's, not the file's (`SPACE_ALPHA`).
      const alpha = family === 'space' ? 1 : part.rgba[3]
      rec.slotOf.push(slotIndex)
      rec.partOf.push(globalPart)
      rec.rgba.push(part.rgba[0], part.rgba[1], part.rgba[2], alpha)
      rec.solidCount++
      rec.bbox.min.set(
        Math.min(rec.bbox.min.x, part.bbox6[0]),
        Math.min(rec.bbox.min.y, part.bbox6[1]),
        Math.min(rec.bbox.min.z, part.bbox6[2])
      )
      rec.bbox.max.set(
        Math.max(rec.bbox.max.x, part.bbox6[3]),
        Math.max(rec.bbox.max.y, part.bbox6[4]),
        Math.max(rec.bbox.max.z, part.bbox6[5])
      )
      bbox.union(rec.bbox)
      // The file's own colour is the starting state; `viewer-core.ts` overwrites it the
      // moment the element is composed (`applyAll`).
      linearRgba(part.rgba[0], part.rgba[1], part.rgba[2], alpha, _v4)
      parts.set(globalPart, _v4.x, _v4.y, _v4.z, _v4.w)
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new BufferAttribute(normals, 3))
    geometry.setAttribute('partIndex', new BufferAttribute(partIndex, 1))
    geometry.setIndex(new BufferAttribute(index, 1))
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    vertices += p.vertices

    const mesh = new Mesh(geometry, material)
    mesh.name = `${modelKey}:${family}:${slotIndex}`
    mesh.castShadow = family === 'solid' && shadowsOn
    // A space is a faint tint; a shadow falling on it would only darken what is behind it.
    mesh.receiveShadow = family !== 'space'
    mesh.renderOrder =
      family === 'solid'
        ? RENDER_ORDER_SOLID
        : family === 'space'
          ? RENDER_ORDER_SPACE
          : RENDER_ORDER_GLASS
    group.add(mesh)

    let ghost: Mesh | null = null
    if (family === 'solid' && ghostMaterial) {
      ghost = new Mesh(geometry, ghostMaterial)
      ghost.name = `${mesh.name}:ghost`
      ghost.castShadow = false
      ghost.receiveShadow = true
      ghost.renderOrder = RENDER_ORDER_GHOST
      // Nothing is see-through until something is ghosted, inert or fading.
      ghost.visible = ghostsOn
      group.add(ghost)
    }

    slots.push({
      mesh,
      ghost,
      geometry,
      family,
      modelKey,
      count: p.parts.length,
      vertexCount: p.vertices,
      firstPart,
      partRange,
      removed: false
    })
  }

  const disposeSlot = (s: Slot): void => {
    if (s.ghost) {
      group.remove(s.ghost)
      s.ghost.dispose()
      s.ghost = null
    }
    group.remove(s.mesh)
    // The objects first: the renderer's per-object state keeps the vertex buffers it drew with
    // for as long as the object lives, and `slots` keeps this one.
    s.mesh.dispose()
    // One geometry, shared by the solid mesh and its see-through twin: disposed once.
    s.geometry.dispose()
    // The slot stays in `slots` (element records index it by position), so its CPU arrays are
    // let go here; otherwise an unloaded model's positions, normals and indices live on.
    for (const name of Object.keys(s.geometry.attributes)) s.geometry.deleteAttribute(name)
    s.geometry.setIndex(null)
    s.partRange = new Uint32Array(0)
    vertices -= s.vertexCount
    s.removed = true
    s.count = 0
  }

  return {
    group,
    slots,
    elements,
    bbox,
    get vertices() {
      return vertices
    },

    addChunk: (chunk, federationSlot, materials, modelKey = chunk.header.modelKey) => {
      // 2026-10-09 — a part whose id would number into another model's block is refused before
      // anything of its chunk is added, by the rule `model/federation-store.ts` refuses such a
      // model with at load; this is the backstop, and the stream's failure path takes the model
      // out again.
      const refusal = localIdRefusal(chunk.parts.map((part) => part.elementId))
      if (refusal) throw new RangeError(refusal)
      state = materials.parts
      const solid: PartRecord[] = []
      const glass: PartRecord[] = []
      const space: PartRecord[] = []
      for (const part of chunk.parts) {
        ;(part.isSpace ? space : part.rgba[3] < 1 ? glass : solid).push(part)
      }
      for (const p of partitionParts(chunk, solid)) {
        addPartition(chunk, federationSlot, 'solid', materials.parts, materials.solid, materials.ghost, p, modelKey)
      }
      for (const p of partitionParts(chunk, glass)) {
        addPartition(chunk, federationSlot, 'glass', materials.parts, materials.glass, null, p, modelKey)
      }
      for (const p of partitionParts(chunk, space)) {
        const m = materials.space ?? materials.glass
        addPartition(chunk, federationSlot, 'space', materials.parts, m, null, p, modelKey)
      }
    },

    // Bounds are computed per slot as it is built; nothing to refresh once a model lands.
    finishModel: () => {},

    // The state texture is global, so a write is one row whichever slot the part landed in.
    setPartState: (rec, part, r, g, b, a) => {
      if (!state) return
      linearRgba(r, g, b, a, _v4)
      state.set(rec.partOf[part], _v4.x, _v4.y, _v4.z, _v4.w)
    },

    setGhostActive: (on) => {
      ghostsOn = on
      for (const s of slots) if (!s.removed && s.ghost) s.ghost.visible = on
    },

    drawObjects: () => {
      let n = 0
      for (const s of slots) {
        if (s.removed) continue
        n++
        if (s.ghost && s.ghost.visible) n++
      }
      return n
    },

    castShadows: (on) => {
      shadowsOn = on
      for (const s of slots) if (!s.removed && s.family === 'solid') s.mesh.castShadow = on
    },

    removeModel: (modelKey) => {
      for (const s of slots) {
        if (s.removed || s.modelKey !== modelKey) continue
        disposeSlot(s)
      }
      const dropped: number[] = []
      for (const [id, rec] of elements) {
        if (rec.modelKey === modelKey) {
          dropped.push(id)
          elements.delete(id)
        }
      }
      bbox.makeEmpty()
      for (const rec of elements.values()) bbox.union(rec.bbox)
      return dropped
    },

    relabel: (from, to) => {
      for (const s of slots) if (s.modelKey === from) s.modelKey = to
      for (const rec of elements.values()) if (rec.modelKey === from) rec.modelKey = to
    },

    dispose: () => {
      for (const s of slots) {
        if (s.removed) continue
        disposeSlot(s)
      }
      slots.length = 0
      elements.clear()
      bbox.makeEmpty()
      vertices = 0
    }
  }
}
