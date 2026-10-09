/**
 * The drawn edges — `design-reference/design/viewer-core.js` L121–122 and L497.
 *
 * The reference gives every part its own `LineSegments` over `EdgesGeometry(geo, 20)` and
 * hides them one object at a time. The crease segments themselves are already computed for
 * us, once per deduplicated geometry, by `geometry-streamer.ts` at the same 20° threshold;
 * what is left is to place them and to make hiding cheap.
 *
 * Each chunk becomes one **world-space** position buffer plus one index buffer. Visibility is
 * an index rewrite and a draw range — the plan's rule, and Marumi's and Aquila's shared
 * lesson that hiding must never re-merge a mesh. A selection gets a second, small index over
 * the *same* positions, drawn after the first in the accent colour; because three's depth
 * test is `LessEqual`, the accent line lands exactly on the grey one it replaces, and a
 * selection change costs a few hundred indices instead of a four-million-entry rewrite.
 *
 * Edges cannot be instanced the way meshes are: a `LineSegments` has one transform, so a
 * geometry used by two parts contributes its segments twice. That is the whole cost of this
 * file — about 50 MB of positions on a 144 MB model — and it is why the buffers are built
 * per chunk and never concatenated.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LineSegments,
  Material,
  Matrix4,
  Vector3
} from 'three/webgpu'
import type { GeometryChunk } from '../../shared/geometry-contract.types'
import { fedId } from '../../shared/federate'
import { RENDER_ORDER_EDGE } from './batches'

interface Piece {
  modelKey: string
  positions: Float32Array
  index: Uint32Array
  indexAttr: BufferAttribute
  geom: BufferGeometry
  selGeom: BufferGeometry
  /** Grown on demand; a selection is a handful of elements, not a model. */
  selIndex: Uint32Array
  selAttr: BufferAttribute
  line: LineSegments
  selLine: LineSegments
  vertexCount: number
  removed: boolean
}

export interface EdgeStore {
  group: Group
  /** Per element: triples of (piece, first vertex, vertex count). */
  ranges: Map<number, number[]>
  /** `modelKey` labels the piece; the chunk's own key unless given (`batches.ts`, `addChunk`). */
  addChunk(
    chunk: GeometryChunk,
    federationSlot: number,
    materials: { edge: Material; selEdge: Material },
    modelKey?: string
  ): void
  /** Rewrite every index buffer. `draw(id)` says whether an element's edges are drawn. */
  rebuild(draw: (id: number) => boolean): void
  /** Rewrite only the accent overlay: the drawn edges of `ids`. */
  setSelection(ids: Iterable<number>, draw: (id: number) => boolean): void
  /**
   * Visit one element's crease segments, in world space. These are the same segments the
   * reference snaps to — its `rec.segs` come from the very same `EdgesGeometry(geo, 20)` —
   * so `snap.ts` reads them from here instead of rebuilding them from the batch.
   */
  forEachSegment(
    id: number,
    visit: (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => void
  ): void
  /** Line objects this store will submit — for the draw count. */
  drawObjects(): number
  removeModel(modelKey: string): void
  /** Hand every piece labelled `from` to `to`. */
  relabel(from: string, to: string): void
  dispose(): void
}

const _m4 = new Matrix4()
const _v3 = new Vector3()

export function createEdgeStore(): EdgeStore {
  const group = new Group()
  const pieces: Piece[] = []
  const ranges = new Map<number, number[]>()

  return {
    group,
    ranges,
    addChunk: (chunk, federationSlot, materials, modelKey = chunk.header.modelKey) => {
      let vertexCount = 0
      for (const part of chunk.parts) vertexCount += chunk.geoms[part.geomIdx].edgeCount
      if (!vertexCount) return

      const positions = new Float32Array(vertexCount * 3)
      const index = new Uint32Array(vertexCount)
      const pieceIndex = pieces.length
      let at = 0
      for (const part of chunk.parts) {
        const g = chunk.geoms[part.geomIdx]
        if (!g.edgeCount) continue
        _m4.fromArray(part.matrix16 as number[])
        const src = g.edgeOffset * 3
        for (let i = 0; i < g.edgeCount; i++) {
          _v3.set(chunk.edges[src + i * 3], chunk.edges[src + i * 3 + 1], chunk.edges[src + i * 3 + 2])
          _v3.applyMatrix4(_m4)
          positions[(at + i) * 3] = _v3.x
          positions[(at + i) * 3 + 1] = _v3.y
          positions[(at + i) * 3 + 2] = _v3.z
        }
        const id = fedId(federationSlot, part.elementId)
        let list = ranges.get(id)
        if (!list) ranges.set(id, (list = []))
        // The streamer and the mock both emit a product's parts back to back, so the common
        // case is one range per element per chunk.
        const n = list.length
        if (n >= 3 && list[n - 3] === pieceIndex && list[n - 2] + list[n - 1] === at) {
          list[n - 1] += g.edgeCount
        } else {
          list.push(pieceIndex, at, g.edgeCount)
        }
        at += g.edgeCount
      }

      const posAttr = new BufferAttribute(positions, 3)
      const indexAttr = new BufferAttribute(index, 1)
      const geom = new BufferGeometry()
      geom.setAttribute('position', posAttr)
      geom.setIndex(indexAttr)
      geom.computeBoundingSphere()
      geom.setDrawRange(0, 0)
      // The accent overlay shares the positions and keeps its own, much smaller index.
      const selIndex = new Uint32Array(0)
      const selAttr = new BufferAttribute(selIndex, 1)
      const selGeom = new BufferGeometry()
      selGeom.setAttribute('position', posAttr)
      selGeom.setIndex(selAttr)
      selGeom.boundingSphere = geom.boundingSphere
      selGeom.setDrawRange(0, 0)

      const line = new LineSegments(geom, materials.edge)
      const selLine = new LineSegments(selGeom, materials.selEdge)
      line.renderOrder = RENDER_ORDER_EDGE
      selLine.renderOrder = RENDER_ORDER_EDGE
      line.visible = false
      selLine.visible = false
      group.add(line, selLine)
      pieces.push({
        modelKey,
        positions,
        index,
        indexAttr,
        geom,
        selGeom,
        selIndex,
        selAttr,
        line,
        selLine,
        vertexCount,
        removed: false
      })
    },

    rebuild: (draw) => {
      const cursor = new Uint32Array(pieces.length)
      for (const [id, list] of ranges) {
        if (!draw(id)) continue
        for (let i = 0; i < list.length; i += 3) {
          const piece = pieces[list[i]]
          if (piece.removed) continue
          let c = cursor[list[i]]
          const start = list[i + 1]
          for (let k = 0; k < list[i + 2]; k++) piece.index[c++] = start + k
          cursor[list[i]] = c
        }
      }
      for (let p = 0; p < pieces.length; p++) {
        const piece = pieces[p]
        if (piece.removed) continue
        piece.indexAttr.needsUpdate = true
        piece.geom.setDrawRange(0, cursor[p])
        piece.line.visible = cursor[p] > 0
      }
    },

    setSelection: (ids, draw) => {
      const wanted: number[][] = pieces.map(() => [])
      for (const id of ids) {
        const list = ranges.get(id)
        if (!list || !draw(id)) continue
        for (let i = 0; i < list.length; i += 3) {
          const piece = pieces[list[i]]
          if (piece.removed) continue
          const start = list[i + 1]
          const out = wanted[list[i]]
          for (let k = 0; k < list[i + 2]; k++) out.push(start + k)
        }
      }
      for (let p = 0; p < pieces.length; p++) {
        const piece = pieces[p]
        if (piece.removed) continue
        const want = wanted[p]
        if (want.length > piece.selIndex.length) {
          piece.selIndex = new Uint32Array(want.length)
          piece.selAttr = new BufferAttribute(piece.selIndex, 1)
          piece.selGeom.setIndex(piece.selAttr)
        }
        piece.selIndex.set(want)
        piece.selAttr.needsUpdate = true
        piece.selGeom.setDrawRange(0, want.length)
        piece.selLine.visible = want.length > 0
      }
    },

    forEachSegment: (id, visit) => {
      const list = ranges.get(id)
      if (!list) return
      for (let i = 0; i < list.length; i += 3) {
        const piece = pieces[list[i]]
        if (piece.removed) continue
        const p = piece.positions
        // Two vertices per segment, laid down back to back by `addChunk`.
        for (let k = 0; k + 1 < list[i + 2]; k += 2) {
          const a = (list[i + 1] + k) * 3
          visit(p[a], p[a + 1], p[a + 2], p[a + 3], p[a + 4], p[a + 5])
        }
      }
    },

    drawObjects: () => {
      let n = 0
      for (const piece of pieces) {
        if (piece.removed) continue
        if (piece.line.visible) n++
        if (piece.selLine.visible) n++
      }
      return n
    },

    removeModel: (modelKey) => {
      for (const piece of pieces) {
        if (piece.removed || piece.modelKey !== modelKey) continue
        group.remove(piece.line, piece.selLine)
        // The objects first: the renderer's per-object state keeps its vertex buffers alive.
        piece.line.dispose()
        piece.selLine.dispose()
        piece.geom.dispose()
        piece.selGeom.dispose()
        piece.removed = true
        // The piece stays in `pieces` (ranges index it by position), so its CPU arrays are let
        // go here; otherwise an unloaded model's edge positions live on.
        piece.geom.deleteAttribute('position')
        piece.geom.setIndex(null)
        piece.selGeom.deleteAttribute('position')
        piece.selGeom.setIndex(null)
        piece.positions = new Float32Array(0)
        piece.index = piece.selIndex = new Uint32Array(0)
        piece.indexAttr = piece.selAttr = new BufferAttribute(piece.index, 1)
      }
      for (const [id, list] of ranges) {
        if (list.length && pieces[list[0]].removed) ranges.delete(id)
      }
    },

    relabel: (from, to) => {
      for (const piece of pieces) if (piece.modelKey === from) piece.modelKey = to
    },

    dispose: () => {
      for (const piece of pieces) {
        if (piece.removed) continue
        group.remove(piece.line, piece.selLine)
        piece.geom.dispose()
        piece.selGeom.dispose()
        piece.removed = true
      }
      pieces.length = 0
      ranges.clear()
    }
  }
}
