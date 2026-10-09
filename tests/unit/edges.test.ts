/**
 * The edge batch: visibility is an index rewrite, never a rebuilt mesh.
 *
 * Marumi and Aquila both learned that hiding must not re-merge geometry, so each chunk's
 * crease segments are placed once in world space and every visibility change only rewrites
 * the index and the draw range. A selection is a second, small index over the *same*
 * positions, which is what keeps clicking an element off the four-million-entry path.
 */
import { LineBasicMaterial, type LineSegments } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import type { GeometryChunk } from '../../src/shared/geometry-contract.types'
import { ID_STRIDE } from '../../src/shared/federate'
import { createEdgeStore } from '../../src/renderer/viewer/edges'

const materials = { edge: new LineBasicMaterial(), selEdge: new LineBasicMaterial() }

/** One geometry with `segments` crease segments, instanced once per part. */
function chunk(elementIds: number[], segments = 1, modelKey = 'M'): GeometryChunk {
  const edges: number[] = []
  for (let s = 0; s < segments; s++) edges.push(0, 0, s, 1, 0, s)
  return {
    header: { modelKey, index: 1, total: 1 },
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    edges: new Float32Array(edges),
    geoms: [
      {
        geometryExpressId: 1,
        vertexOffset: 0,
        vertexCount: 3,
        indexOffset: 0,
        indexCount: 3,
        edgeOffset: 0,
        edgeCount: segments * 2
      }
    ],
    parts: elementIds.map((id, i) => ({
      elementId: id,
      geomIdx: 0,
      matrix16: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, i * 10, 0, 0, 1],
      rgba: [1, 1, 1, 1],
      bbox6: [i * 10, 0, 0, i * 10 + 1, 1, 1]
    }))
  }
}

interface DrawnLine {
  visible: boolean
  geometry: {
    drawRange: { start: number; count: number }
    getIndex(): { array: ArrayLike<number> } | null
    getAttribute(name: string): { array: Float32Array }
  }
}
const drawn = (store: ReturnType<typeof createEdgeStore>, at: number): DrawnLine =>
  store.group.children[at] as unknown as DrawnLine

const lines = (store: ReturnType<typeof createEdgeStore>): { edge: number; sel: number } => {
  const edge = drawn(store, 0)
  const sel = drawn(store, 1)
  return {
    edge: edge.visible ? edge.geometry.drawRange.count : 0,
    sel: sel.visible ? sel.geometry.drawRange.count : 0
  }
}

describe('edge batch', () => {
  it('places every part’s segments in world space and records a range per element', () => {
    const store = createEdgeStore()
    store.addChunk(chunk([5, 5, 6], 2), 2, materials)
    // Federation ids, and the two parts of element 5 merged into one contiguous range.
    expect([...store.ranges.keys()].sort((a, b) => a - b)).toEqual([2 * ID_STRIDE + 5, 2 * ID_STRIDE + 6])
    expect(store.ranges.get(2 * ID_STRIDE + 5)).toEqual([0, 0, 8])
    expect(store.ranges.get(2 * ID_STRIDE + 6)).toEqual([0, 8, 4])
    store.dispose()
  })

  it('rebuilds the index from a visibility predicate', () => {
    const store = createEdgeStore()
    store.addChunk(chunk([5, 6, 7], 1), 0, materials)
    const none = () => false

    store.rebuild(() => true)
    store.setSelection([], () => true)
    expect(lines(store)).toEqual({ edge: 6, sel: 0 }) // three parts × one segment × 2 vertices

    store.rebuild((id) => id === 6)
    expect(lines(store)).toEqual({ edge: 2, sel: 0 })

    store.rebuild(none)
    expect(lines(store)).toEqual({ edge: 0, sel: 0 })

    store.rebuild(() => true)
    expect(lines(store)).toEqual({ edge: 6, sel: 0 })
    store.dispose()
  })

  it('draws the right vertices, not just the right count', () => {
    const store = createEdgeStore()
    store.addChunk(chunk([5, 6], 1), 0, materials)
    store.rebuild((id) => id === 6)
    const geom = drawn(store, 0).geometry
    const index = geom.getIndex()!.array
    // Element 6 is the second part, so its two vertices are 2 and 3.
    expect(Array.from(index).slice(0, geom.drawRange.count)).toEqual([2, 3])
    store.dispose()
  })

  it('keeps the accent overlay to the selection, and only while it is drawn', () => {
    const store = createEdgeStore()
    store.addChunk(chunk([5, 6, 7], 1), 0, materials)
    const drawAll = (): boolean => true
    store.rebuild(drawAll)
    store.setSelection([2, 6], drawAll) // 2 is not an element here; 6 is
    expect(lines(store)).toEqual({ edge: 6, sel: 2 })

    // Hiding the selected element takes it out of both.
    store.rebuild((id) => id !== 6)
    store.setSelection([6], (id) => id !== 6)
    expect(lines(store)).toEqual({ edge: 4, sel: 0 })
    store.dispose()
  })

  it('carries a part’s placement into the world-space positions', () => {
    const store = createEdgeStore()
    store.addChunk(chunk([5, 6], 1), 0, materials)
    const p = drawn(store, 0).geometry.getAttribute('position').array
    expect([p[0], p[1], p[2]]).toEqual([0, 0, 0])
    expect([p[3], p[4], p[5]]).toEqual([1, 0, 0])
    // The second part is translated 10 m along x by its matrix.
    expect([p[6], p[7], p[8]]).toEqual([10, 0, 0])
    expect([p[9], p[10], p[11]]).toEqual([11, 0, 0])
    store.dispose()
  })

  it('drops a model’s pieces and ranges when it is removed', () => {
    const store = createEdgeStore()
    store.addChunk(chunk([5], 1, 'M'), 0, materials)
    store.addChunk(chunk([5], 1, 'N'), 1, materials)
    expect(store.group.children).toHaveLength(4)
    store.removeModel('N')
    expect(store.ranges.has(ID_STRIDE + 5)).toBe(false)
    expect(store.ranges.has(5)).toBe(true)
    store.rebuild(() => true)
    expect(lines(store)).toEqual({ edge: 2, sel: 0 })
    store.dispose()
  })

  it('lets go of a removed piece’s CPU arrays, and a relabelled piece goes with its new model', () => {
    const store = createEdgeStore()
    store.addChunk(chunk([5], 1, 'M'), 0, materials, 'M+incoming')
    const line = store.group.children[0] as LineSegments
    store.relabel('M+incoming', 'M')
    store.removeModel('M')
    expect(store.group.children).toHaveLength(0)
    expect(line.geometry.getAttribute('position')).toBeUndefined()
    expect(line.geometry.getIndex()).toBeNull()
    store.dispose()
  })

  it('adds nothing for a chunk whose geometry has no creases', () => {
    const store = createEdgeStore()
    store.addChunk(chunk([5], 0), 0, materials)
    expect(store.group.children).toHaveLength(0)
    expect(store.ranges.size).toBe(0)
    store.dispose()
  })
})
