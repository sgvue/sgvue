/**
 * Merged slot allocation.
 *
 * One mesh per product does not survive a real model — ~26 500 draw calls sat at about
 * 12 fps (`CLAUDE.md`, rendering traps) — and neither does a `BatchedMesh`, which costs one
 * *driver* draw per visible instance on ANGLE/Metal and on Dawn and flooded the GPU process
 * until this Mac kernel-panicked (`batches.ts`). So a chunk's parts are baked into federation
 * space and merged into a few slot geometries instead. The things that have to be right are
 * checked here on numbers: parts land in the family their file colour puts them in, a slot
 * never exceeds its caps, the merged buffers carry the placement and the part index, and an
 * element can be found again afterwards with its box, its part count and its index ranges.
 */
import { MeshBasicMaterial, Vector4 } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import type { GeometryChunk, GeometryRecord, PartRecord } from '../../src/shared/geometry-contract.types'
import {
  SLOT_MAX_PARTS,
  SLOT_MAX_VERTICES,
  createBatchStore,
  partitionParts
} from '../../src/renderer/viewer/batches'
import { linearRgba } from '../../src/renderer/viewer/materials'
import { createPartState } from '../../src/renderer/viewer/part-state'

/** A triangle: 3 vertices, 3 indices, 2 edge vertices. */
const TRI_V = 3
const TRI_I = 3

function chunk(
  parts: { elementId: number; geomIdx: number; alpha?: number; at?: [number, number, number] }[],
  geomCount = 1,
  vertsPerGeom = TRI_V
): GeometryChunk {
  const geoms: GeometryRecord[] = []
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  const edges: number[] = []
  for (let g = 0; g < geomCount; g++) {
    const vertexOffset = positions.length / 3
    for (let v = 0; v < vertsPerGeom; v++) {
      positions.push(v === 1 ? 1 : 0, v === 2 ? 1 : 0, 0)
      normals.push(0, 0, 1)
    }
    const indexOffset = indices.length
    for (let t = 0; t + 2 < vertsPerGeom; t++) {
      indices.push(vertexOffset, vertexOffset + t + 1, vertexOffset + t + 2)
    }
    const edgeOffset = edges.length / 3
    edges.push(0, 0, 0, 1, 0, 0)
    geoms.push({
      geometryExpressId: 100 + g,
      vertexOffset,
      vertexCount: vertsPerGeom,
      indexOffset,
      indexCount: indices.length - indexOffset,
      edgeOffset,
      edgeCount: 2
    })
  }
  const records: PartRecord[] = parts.map((p) => {
    const [x, y, z] = p.at ?? [0, 0, 0]
    return {
      elementId: p.elementId,
      geomIdx: p.geomIdx,
      matrix16: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1],
      rgba: [0.5, 0.5, 0.5, p.alpha ?? 1],
      bbox6: [x, y, z, x + 1, y + 1, z]
    }
  })
  return {
    header: { modelKey: 'M', index: 1, total: 1 },
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    edges: new Float32Array(edges),
    geoms,
    parts: records
  }
}

const mats = (): {
  parts: ReturnType<typeof createPartState>
  solid: MeshBasicMaterial
  ghost: MeshBasicMaterial
  glass: MeshBasicMaterial
} => ({
  parts: createPartState(),
  solid: new MeshBasicMaterial(),
  ghost: new MeshBasicMaterial(),
  glass: new MeshBasicMaterial()
})

describe('partitionParts', () => {
  it('keeps one chunk in one slot when it fits', () => {
    const c = chunk([
      { elementId: 1, geomIdx: 0 },
      { elementId: 1, geomIdx: 0 },
      { elementId: 2, geomIdx: 0 }
    ])
    const out = partitionParts(c, [...c.parts])
    expect(out).toHaveLength(1)
    expect(out[0].parts).toHaveLength(3)
    // Merging bakes the placement into the vertices, so a geometry used by three parts is
    // written three times. That lost deduplication is the price of not drawing per instance.
    expect(out[0].vertices).toBe(3 * TRI_V)
    expect(out[0].indices).toBe(3 * TRI_I)
  })

  it('splits when the part cap is reached', () => {
    const many = Array.from({ length: SLOT_MAX_PARTS + 5 }, (_, i) => ({
      elementId: 1 + i,
      geomIdx: 0
    }))
    const c = chunk(many)
    const out = partitionParts(c, [...c.parts])
    expect(out).toHaveLength(2)
    expect(out[0].parts).toHaveLength(SLOT_MAX_PARTS)
    expect(out[1].parts).toHaveLength(5)
  })

  it('splits when the vertex cap is reached, and never orphans a part', () => {
    const big = Math.ceil(SLOT_MAX_VERTICES / 3)
    const c = chunk(
      [
        { elementId: 1, geomIdx: 0 },
        { elementId: 2, geomIdx: 1 },
        { elementId: 3, geomIdx: 2 },
        { elementId: 4, geomIdx: 3 }
      ],
      4,
      big
    )
    const out = partitionParts(c, [...c.parts])
    expect(out.length).toBeGreaterThan(1)
    expect(out.every((p) => p.vertices <= SLOT_MAX_VERTICES)).toBe(true)
    expect(out.reduce((n, p) => n + p.parts.length, 0)).toBe(4)
  })

  it('gives a geometry larger than a whole slot a slot of its own', () => {
    const huge = SLOT_MAX_VERTICES + 600
    const c = chunk(
      [
        { elementId: 1, geomIdx: 0 },
        { elementId: 2, geomIdx: 1 }
      ],
      2,
      huge
    )
    const out = partitionParts(c, [...c.parts])
    expect(out).toHaveLength(2)
    expect(out[0].vertices).toBe(huge)
    expect(out[0].parts).toHaveLength(1)
    expect(out[1].parts).toHaveLength(1)
  })

  it('returns nothing for no parts', () => {
    expect(partitionParts(chunk([]), [])).toEqual([])
  })
})

describe('batch store', () => {
  it('splits the two families by the file’s own alpha, and only then', () => {
    const store = createBatchStore()
    const m = mats()
    store.addChunk(
      chunk([
        { elementId: 1, geomIdx: 0 },
        { elementId: 2, geomIdx: 0, alpha: 0.42 },
        { elementId: 3, geomIdx: 0 }
      ]),
      0,
      m
    )
    expect(store.slots.map((s) => s.family)).toEqual(['solid', 'glass'])
    // Only the opaque family needs a see-through mesh; glass never writes depth anyway.
    expect(store.slots[0].ghost).not.toBeNull()
    expect(store.slots[1].ghost).toBeNull()
    expect(store.slots[0].count).toBe(2)
    expect(store.slots[1].count).toBe(1)
    expect(store.slots[0].mesh.material).toBe(m.solid)
    expect(store.slots[0].ghost!.material).toBe(m.ghost)
    expect(store.slots[1].mesh.material).toBe(m.glass)
    // Only the opaque family casts, exactly the reference's rule.
    expect(store.slots[0].mesh.castShadow).toBe(true)
    expect(store.slots[0].ghost!.castShadow).toBe(false)
    expect(store.slots[1].mesh.castShadow).toBe(false)
    store.dispose()
  })

  it('the see-through mesh shares the solid one’s geometry rather than copying it', () => {
    const store = createBatchStore()
    store.addChunk(chunk([{ elementId: 1, geomIdx: 0 }]), 0, mats())
    const { mesh, ghost, geometry } = store.slots[0]
    expect(ghost!.geometry).toBe(mesh.geometry)
    expect(mesh.geometry).toBe(geometry)
    expect(ghost!.visible).toBe(false)
    store.dispose()
  })

  it('bakes the placement into the vertices and tags each one with its part', () => {
    const store = createBatchStore()
    store.addChunk(
      chunk([
        { elementId: 1, geomIdx: 0, at: [0, 0, 0] },
        { elementId: 1, geomIdx: 0, at: [4, 0, 2] }
      ]),
      0,
      mats()
    )
    const slot = store.slots[0]
    const pos = slot.geometry.getAttribute('position').array
    const idx = slot.geometry.getIndex()!.array
    const tag = slot.geometry.getAttribute('partIndex').array
    // Six vertices: the same triangle twice, the second moved by its own matrix.
    expect(pos).toHaveLength(6 * 3)
    expect([pos[0], pos[1], pos[2]]).toEqual([0, 0, 0])
    expect([pos[9], pos[10], pos[11]]).toEqual([4, 0, 2])
    // Indices are rebased onto this slot's own vertices, not the chunk's.
    expect([...idx]).toEqual([0, 1, 2, 3, 4, 5])
    // Every vertex of a part carries that part's global index — this is what the material reads.
    expect([...tag]).toEqual([0, 0, 0, 1, 1, 1])
    // And each part's slice of the index buffer is recorded for picking.
    expect([...slot.partRange]).toEqual([0, 3, 3, 3])
    expect(store.vertices).toBe(6)
    store.dispose()
  })

  it('offsets element ids by the federation slot and keeps every part', () => {
    const store = createBatchStore()
    store.addChunk(
      chunk([
        { elementId: 7, geomIdx: 0, at: [0, 0, 0] },
        { elementId: 7, geomIdx: 0, at: [4, 0, 0] },
        { elementId: 9, geomIdx: 0, at: [0, 0, 2] }
      ]),
      3,
      mats()
    )
    expect([...store.elements.keys()].sort((a, b) => a - b)).toEqual([3_000_007, 3_000_009])
    const rec = store.elements.get(3_000_007)!
    expect(rec.modelKey).toBe('M')
    expect(rec.solidCount).toBe(2)
    expect(rec.slotOf).toEqual([0, 0])
    expect(rec.partOf).toEqual([0, 1])
    expect(rec.rgba).toHaveLength(8)
    // The element box is the union of its parts' boxes, not one of them.
    expect(rec.bbox.min.toArray()).toEqual([0, 0, 0])
    expect(rec.bbox.max.toArray()).toEqual([5, 1, 0])
    expect(store.bbox.min.toArray()).toEqual([0, 0, 0])
    expect(store.bbox.max.toArray()).toEqual([5, 1, 2])
    store.dispose()
  })

  it('seeds every part with the file’s own colour, converted to working space', () => {
    const store = createBatchStore()
    const m = mats()
    store.addChunk(chunk([{ elementId: 1, geomIdx: 0 }]), 0, m)
    const out = new Vector4()
    m.parts.get(0, out)
    // The table is Float32, so the comparison is to float32 precision, not to the double.
    const want = linearRgba(0.5, 0.5, 0.5, 1).toArray()
    expect(out.toArray()).toEqual(want.map((v) => expect.closeTo(v, 6)))
    // sRGB 0.5 is not linear 0.5 — getting this wrong makes every surface too bright.
    expect(out.x).toBeLessThan(0.5)
    store.dispose()
  })

  it('writes one part’s state without touching its neighbours', () => {
    const store = createBatchStore()
    const m = mats()
    store.addChunk(
      chunk([
        { elementId: 1, geomIdx: 0 },
        { elementId: 2, geomIdx: 0 }
      ]),
      0,
      m
    )
    const rec = store.elements.get(2)!
    store.setPartState(rec, 0, 1, 0, 0, 1.35)
    const mine = new Vector4()
    const neighbour = new Vector4()
    m.parts.get(rec.partOf[0], mine)
    m.parts.get(store.elements.get(1)!.partOf[0], neighbour)
    expect(mine.w).toBeCloseTo(1.35, 6)
    expect(mine.x).toBeCloseTo(1, 6)
    expect(neighbour.w).toBe(1)
    store.dispose()
  })

  it('counts the objects it will submit, see-through meshes only when they are on', () => {
    const store = createBatchStore()
    store.addChunk(
      chunk([
        { elementId: 1, geomIdx: 0 },
        { elementId: 2, geomIdx: 0, alpha: 0.42 }
      ]),
      0,
      mats()
    )
    expect(store.drawObjects()).toBe(2) // solid + glass
    store.setGhostActive(true)
    expect(store.drawObjects()).toBe(3) // + the solid slot's see-through mesh
    store.setGhostActive(false)
    expect(store.drawObjects()).toBe(2)
    store.dispose()
  })

  it('removing a model frees its slots, drops its ids and shrinks the box', () => {
    const store = createBatchStore()
    const m = mats()
    store.addChunk(chunk([{ elementId: 1, geomIdx: 0, at: [0, 0, 0] }]), 0, m)
    const other = chunk([{ elementId: 1, geomIdx: 0, at: [50, 0, 0] }])
    ;(other.header as { modelKey: string }).modelKey = 'N'
    store.addChunk(other, 1, m)
    expect(store.slots).toHaveLength(2)
    expect(store.bbox.max.x).toBe(51)
    expect(store.vertices).toBe(6)

    const dropped = store.removeModel('N')
    expect(dropped).toEqual([1_000_001])
    expect(store.elements.has(1_000_001)).toBe(false)
    // Surviving records keep their slot indices, so the entry is marked rather than spliced.
    expect(store.slots).toHaveLength(2)
    expect(store.slots[1].removed).toBe(true)
    expect(store.slots[0].removed).toBe(false)
    expect(store.elements.get(1)!.slotOf).toEqual([0])
    expect(store.bbox.max.x).toBe(1)
    expect(store.vertices).toBe(3)
    store.dispose()
  })

  it('lets go of a removed slot’s CPU arrays (refactor pass 2)', () => {
    const store = createBatchStore()
    store.addChunk(chunk([{ elementId: 1, geomIdx: 0 }]), 0, mats())
    const slot = store.slots[0]
    expect(slot.geometry.getAttribute('position')).toBeDefined()
    store.removeModel('M')
    expect(slot.geometry.getAttribute('position')).toBeUndefined()
    expect(slot.geometry.getAttribute('normal')).toBeUndefined()
    expect(slot.geometry.getAttribute('partIndex')).toBeUndefined()
    expect(slot.geometry.getIndex()).toBeNull()
    expect(slot.partRange).toHaveLength(0)
    store.dispose()
  })

  it('a label given to addChunk is the parts’ model until relabelled (a replacement streaming in)', () => {
    const store = createBatchStore()
    const m = mats()
    store.addChunk(chunk([{ elementId: 1, geomIdx: 0 }]), 0, m)
    store.addChunk(chunk([{ elementId: 1, geomIdx: 0 }]), 1, m, 'M+incoming')
    expect(store.elements.get(1_000_001)!.modelKey).toBe('M+incoming')
    expect(store.removeModel('M')).toEqual([1])
    store.relabel('M+incoming', 'M')
    expect(store.slots[1].modelKey).toBe('M')
    expect(store.elements.get(1_000_001)!.modelKey).toBe('M')
    expect(store.removeModel('M')).toEqual([1_000_001])
    store.dispose()
  })

  it('keeps the whole chunk when one part is bigger than the caps allow', () => {
    const store = createBatchStore()
    const c = chunk(
      [
        { elementId: 1, geomIdx: 0 },
        { elementId: 2, geomIdx: 1 }
      ],
      2,
      SLOT_MAX_VERTICES + 90
    )
    store.addChunk(c, 0, mats())
    expect(store.slots).toHaveLength(2)
    expect(store.elements.size).toBe(2)
    store.dispose()
  })

  it('no longer reaches past three’s public API', async () => {
    // The `BatchedMesh` ghost twin borrowed eight private fields of three's and needed a test
    // of its own to survive an upgrade. The merged form borrows none: this is what replaces
    // that test, and what must fail if anyone reintroduces one.
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(
      new URL('../../src/renderer/viewer/batches.ts', import.meta.url),
      'utf8'
    )
    for (const borrowed of [
      '_instanceInfo',
      '_geometryInfo',
      '_geometryCount',
      '_geometryInitialized',
      '_matricesTexture',
      '_colorsTexture',
      '_indirectTexture',
      '_maxInstanceCount'
    ]) {
      expect(source, `batches.ts reaches for BatchedMesh's "${borrowed}" again`).not.toContain(borrowed)
    }
    // And the draw model itself: one driver draw per instance is what panicked the machine.
    expect(source.match(/new BatchedMesh\(/)).toBeNull()
  })
})
