/**
 * The cut outline's arithmetic (2026-09-28, owner-requested): where the section plane meets
 * each element's triangles. `section-cut.ts` is pure, so the rules at the plane are checked on
 * numbers — a box gives a closed rectangle of four segments, a vertex or an edge on the plane
 * gives no duplicate and no zero-length piece, a triangle lying in the plane gives nothing —
 * and then through the real batch store: box culling, what `include` leaves out, `IfcSpace`,
 * and one known wall of the design's own mock federation.
 *
 * 2026-10-01 (two section planes): each plane's outline is trimmed to the kept side of the
 * other cutting plane — a segment that straddles it is cut at the crossing, one it removed is
 * dropped — and an element the other plane removed whole is not walked at all.
 */
import { MeshBasicMaterial } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { planeFromLevel, planeFromSegment } from '../../src/shared/annotate'
import { ID_STRIDE } from '../../src/shared/federate'
import type {
  GeometryChunk,
  GeometryRecord,
  PartRecord
} from '../../src/shared/geometry-contract.types'
import { mockGeometryChunks, mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { createBatchStore } from '../../src/renderer/viewer/batches'
import { createPartState } from '../../src/renderer/viewer/part-state'
import {
  ON_PLANE_EPS,
  boxStraddles,
  cutTriangles,
  sectionCut,
  segmentList,
  type CutPlane
} from '../../src/renderer/viewer/section-cut'

type V3 = [number, number, number]

/** A box as the mock and web-ifc write one: four vertices a face, two triangles a face. */
function box(min: V3, max: V3): { position: number[]; index: number[] } {
  const [x0, y0, z0] = min
  const [x1, y1, z1] = max
  const faces: V3[][] = [
    [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
    [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]],
    [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]],
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    [[x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]]
  ]
  const position: number[] = []
  const index: number[] = []
  for (const f of faces) {
    const base = position.length / 3
    for (const p of f) position.push(...p)
    index.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  return { position, index }
}

function cut(position: number[], index: number[], plane: CutPlane): number[][] {
  const out = segmentList(1)
  cutTriangles(position, index, 0, index.length, plane, out)
  const f = out.take()
  const segs: number[][] = []
  for (let i = 0; i < out.count; i++) segs.push([...f.subarray(i * 6, i * 6 + 6)])
  return segs
}

const key = (x: number, y: number, z: number): string =>
  [x, y, z].map((v) => v.toFixed(5)).join(',')

/** Every endpoint is shared by exactly two segments, and none has zero length. */
function expectClosedLoop(segs: number[][]): void {
  const ends = new Map<string, number>()
  for (const s of segs) {
    expect(Math.hypot(s[3] - s[0], s[4] - s[1], s[5] - s[2])).toBeGreaterThan(1e-6)
    for (const k of [key(s[0], s[1], s[2]), key(s[3], s[4], s[5])]) ends.set(k, (ends.get(k) ?? 0) + 1)
  }
  for (const n of ends.values()) expect(n).toBe(2)
}

/** The segments as sorted, rounded strings — order-independent comparison. */
const asSet = (segs: number[][]): string[] =>
  segs
    .map((s) => [key(s[0], s[1], s[2]), key(s[3], s[4], s[5])].sort().join(' – '))
    .sort()

describe('cutTriangles', () => {
  const b = box([0, 0, 0], [2, 1, 3])

  it('cuts a box across into a closed rectangle of four segments', () => {
    const segs = cut(b.position, b.index, planeFromLevel(1.2, false))
    expect(segs).toHaveLength(4)
    expectClosedLoop(segs)
    expect(asSet(segs)).toEqual(
      asSet([
        [0, 0, 1.2, 2, 0, 1.2],
        [2, 0, 1.2, 2, 1, 1.2],
        [2, 1, 1.2, 0, 1, 1.2],
        [0, 1, 1.2, 0, 0, 1.2]
      ])
    )
    // A vertical plane at any angle, the same way — a grid through the box.
    const grid = planeFromSegment([0.5, -5], [1.5, 5], 0, false, [1, 0.5])!
    const g = cut(b.position, b.index, { n: grid.n, c: grid.c })
    expect(g).toHaveLength(4)
    expectClosedLoop(g)
    for (const s of g) {
      for (const p of [s.slice(0, 3), s.slice(3)]) {
        // On the plane, to float32 (the segments are handed to the GPU as Float32).
        expect(Math.abs(p[0] * grid.n[0] + p[1] * grid.n[1] + p[2] * grid.n[2] + grid.c)).toBeLessThan(1e-6)
      }
    }
  })

  it('gives nothing for a plane that misses', () => {
    expect(cut(b.position, b.index, planeFromLevel(5, false))).toHaveLength(0)
    expect(cut(b.position, b.index, planeFromLevel(-0.5, true))).toHaveLength(0)
  })

  it('takes a vertex on the plane once, and never a zero-length piece', () => {
    // One vertex on the plane, the other two on either side: vertex to opposite edge.
    const tri = [0, 0, 1, 1, 0, 0, -1, 1, 2]
    const one = cut(tri, [0, 1, 2], planeFromLevel(1, false))
    expect(one).toHaveLength(1)
    expect(asSet(one)).toEqual(asSet([[0, 0, 1, 0, 0.5, 1]]))
    // One vertex on the plane, the other two on the same side: it only touches.
    expect(cut([0, 0, 1, 1, 0, 0, -1, 0, 0], [0, 1, 2], planeFromLevel(1, false))).toHaveLength(0)
    // A plane through two opposite corners of the box's front face — through vertices, and
    // along the face's own diagonal — still gives a closed loop of whole segments.
    const diag = planeFromSegment([0, 0], [2, 1], 0, false, [1, 5])!
    const d = cut(b.position, b.index, { n: diag.n, c: diag.c })
    expectClosedLoop(d)
    expect(d).toHaveLength(4)
  })

  it('takes an edge on the plane once: a surface crossing along it, and a solid resting on it', () => {
    // Two triangles sharing the edge (0,0,1)–(1,0,1), one above and one below: one segment.
    const strip = [0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 2]
    const crossing = cut(strip, [0, 1, 2, 1, 0, 3], planeFromLevel(1, false))
    expect(asSet(crossing)).toEqual(asSet([[0, 0, 1, 1, 0, 1]]))
    // The box's top face is the plane. Kept below, the box rests on the plane from the kept side
    // and is outlined once; kept above, it is on the removed side and gives nothing.
    const below = cut(b.position, b.index, planeFromLevel(3, false))
    expect(below).toHaveLength(4)
    expectClosedLoop(below)
    expect(cut(b.position, b.index, planeFromLevel(3, true))).toHaveLength(0)
  })

  it('gives nothing for a triangle lying in the plane', () => {
    // The rule: a coplanar triangle contributes no segment; its outline, where it bounds a
    // solid, comes from the neighbours that leave the plane (the test above).
    expect(cut([0, 0, 1, 1, 0, 1, 0, 1, 1], [0, 1, 2], planeFromLevel(1, false))).toHaveLength(0)
    expect(cut([0, 0, 1, 1, 0, 1, 0, 1, 1], [0, 1, 2], planeFromLevel(1, true))).toHaveLength(0)
    // Within the tolerance counts as in the plane.
    const near = [0, 0, 1 + ON_PLANE_EPS / 2, 1, 0, 1, 0, 1, 1 - ON_PLANE_EPS / 2]
    expect(cut(near, [0, 1, 2], planeFromLevel(1, false))).toHaveLength(0)
  })

  it('keeps a bend in a curved surface as separate segments', () => {
    // A half-octagon prism: eight side faces sharing their vertical edges' vertices.
    const pos: number[] = []
    const idx: number[] = []
    const k = 8
    for (let i = 0; i <= k; i++) {
      const a = (Math.PI * i) / k
      pos.push(Math.cos(a), Math.sin(a), 0, Math.cos(a), Math.sin(a), 2)
    }
    for (let i = 0; i < k; i++) {
      const v = i * 2
      idx.push(v, v + 2, v + 3, v, v + 3, v + 1)
    }
    const segs = cut(pos, idx, planeFromLevel(1, false))
    expect(segs).toHaveLength(k)
  })
})

/* ── 2026-10-01: trimmed by the other cutting plane ───────────────────────── */

/** `cutTriangles` with the other planes to trim by, as `sectionCut` calls it. */
function cutTrimmed(
  position: number[],
  index: number[],
  plane: CutPlane,
  trimBy: CutPlane[]
): number[][] {
  const out = segmentList(1)
  cutTriangles(position, index, 0, index.length, plane, out, trimBy)
  const f = out.take()
  const segs: number[][] = []
  for (let i = 0; i < out.count; i++) segs.push([...f.subarray(i * 6, i * 6 + 6)])
  return segs
}

/** A gridline plane at x = `at`, keeping the side `x >= at` (or, flipped, `x <= at`). */
const gridAt = (at: number, flip = false): CutPlane => {
  const p = planeFromSegment([at, -5], [at, 5], 0, flip, [at + 100, 0])!
  return { n: p.n, c: p.c }
}

describe('cutTriangles, trimmed by the other cutting plane', () => {
  const b = box([0, 0, 0], [2, 1, 3])
  const level = planeFromLevel(1.2, false)

  it('cuts a segment that straddles the other plane at the crossing, and drops what it removed', () => {
    // The level cut's rectangle at z = 1.2, with a gridline plane at x = 1 keeping x >= 1: the
    // two long sides straddle it and are cut at x = 1, the side at x = 2 is whole, the side at
    // x = 0 is gone. Three segments, open towards the other plane.
    const segs = cutTrimmed(b.position, b.index, level, [gridAt(1)])
    expect(asSet(segs)).toEqual(
      asSet([
        [1, 0, 1.2, 2, 0, 1.2],
        [2, 0, 1.2, 2, 1, 1.2],
        [2, 1, 1.2, 1, 1, 1.2]
      ])
    )
    // The other way round: the gridline plane's rectangle at x = 1, kept only below the level.
    const grid = cutTrimmed(b.position, b.index, gridAt(1), [level])
    expect(asSet(grid)).toEqual(
      asSet([
        [1, 0, 0, 1, 1, 0],
        [1, 0, 0, 1, 0, 1.2],
        [1, 1, 0, 1, 1, 1.2]
      ])
    )
    // The kept side flipped keeps the other half of each straddling segment.
    expect(asSet(cutTrimmed(b.position, b.index, level, [gridAt(1, true)]))).toEqual(
      asSet([
        [0, 0, 1.2, 1, 0, 1.2],
        [0, 1, 1.2, 0, 0, 1.2],
        [1, 1, 1.2, 0, 1, 1.2]
      ])
    )
  })

  it('is the untrimmed cut when the other plane removes nothing, and nothing when it removes all', () => {
    const whole = cut(b.position, b.index, level)
    expect(asSet(cutTrimmed(b.position, b.index, level, [gridAt(-1)]))).toEqual(asSet(whole))
    expect(asSet(cutTrimmed(b.position, b.index, level, []))).toEqual(asSet(whole))
    expect(cutTrimmed(b.position, b.index, level, [gridAt(5)])).toHaveLength(0)
  })

  it('keeps an end that lies on the other plane, and drops a segment that only touches it', () => {
    // The other plane is the box's own face at x = 2, keeping x >= 2: the rectangle's side in
    // that face has both ends on the plane and stays; the two long sides only touch it.
    expect(asSet(cutTrimmed(b.position, b.index, level, [gridAt(2)]))).toEqual(
      asSet([[2, 0, 1.2, 2, 1, 1.2]])
    )
    // Within the tolerance of the plane counts as on it.
    expect(cutTrimmed(b.position, b.index, level, [gridAt(2 + ON_PLANE_EPS / 2)])).toHaveLength(1)
    // Kept the other way, the whole rectangle is on the kept side, touching included.
    expect(cutTrimmed(b.position, b.index, level, [gridAt(2, true)])).toHaveLength(4)
  })

  it('trims by every other plane, one after the other', () => {
    // x >= 0.5 and x <= 1.5: only the middle of each long side is left.
    const segs = cutTrimmed(b.position, b.index, level, [gridAt(0.5), gridAt(1.5, true)])
    expect(asSet(segs)).toEqual(
      asSet([
        [0.5, 0, 1.2, 1.5, 0, 1.2],
        [0.5, 1, 1.2, 1.5, 1, 1.2]
      ])
    )
  })
})

describe('boxStraddles', () => {
  it('is true when the box reaches the plane, touching included', () => {
    const min = { x: 0, y: 0, z: 0 }
    const max = { x: 1, y: 1, z: 3 }
    expect(boxStraddles(min, max, planeFromLevel(1.5, false))).toBe(true)
    expect(boxStraddles(min, max, planeFromLevel(3, false))).toBe(true)
    expect(boxStraddles(min, max, planeFromLevel(3.01, false))).toBe(false)
    expect(boxStraddles(min, max, planeFromLevel(-0.01, true))).toBe(false)
    const grid = planeFromSegment([0.5, -5], [0.5, 5], 0, false, [0, 0])!
    expect(boxStraddles(min, max, { n: grid.n, c: grid.c })).toBe(true)
  })
})

/* ── through the real batch store ─────────────────────────────────────────── */

const MATERIALS = {
  parts: createPartState(),
  solid: new MeshBasicMaterial(),
  ghost: new MeshBasicMaterial(),
  glass: new MeshBasicMaterial(),
  space: new MeshBasicMaterial()
}

/** Boxes as parts of one chunk, each its own element; `alpha < 1` is glass. */
function boxChunk(
  items: { id: number; min: V3; max: V3; alpha?: number; space?: boolean }[]
): GeometryChunk {
  const positions: number[] = []
  const indices: number[] = []
  const geoms: GeometryRecord[] = []
  const parts: PartRecord[] = []
  for (const it of items) {
    const b = box(it.min, it.max)
    const vertexOffset = positions.length / 3
    const indexOffset = indices.length
    positions.push(...b.position)
    indices.push(...b.index.map((i) => i + vertexOffset))
    geoms.push({
      geometryExpressId: it.id,
      vertexOffset,
      vertexCount: b.position.length / 3,
      indexOffset,
      indexCount: b.index.length,
      edgeOffset: 0,
      edgeCount: 0
    })
    parts.push({
      elementId: it.id,
      geomIdx: geoms.length - 1,
      matrix16: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      rgba: [0.5, 0.5, 0.5, it.alpha ?? 1] as [number, number, number, number],
      bbox6: [...it.min, ...it.max] as [number, number, number, number, number, number],
      ...(it.space ? { isSpace: true } : {})
    })
  }
  return {
    header: { modelKey: 'M', index: 0, total: 1 },
    positions: new Float32Array(positions),
    normals: new Float32Array(positions.length),
    indices: new Uint32Array(indices),
    edges: new Float32Array(0),
    geoms,
    parts
  }
}

describe('sectionCut', () => {
  const store = createBatchStore()
  store.addChunk(
    boxChunk([
      { id: 1, min: [0, 0, 0], max: [1, 1, 3] },
      { id: 2, min: [2, 0, 0], max: [3, 1, 3] },
      // Above the cut: its box never reaches the plane.
      { id: 3, min: [4, 0, 2], max: [5, 1, 3] },
      // Glass is cut too — a glazing panel in section.
      { id: 4, min: [6, 0, 0], max: [6.02, 1, 3], alpha: 0.4 },
      // A room is not.
      { id: 5, min: [0, 2, 0], max: [3, 5, 3], space: true }
    ]),
    0,
    MATERIALS
  )
  const plane = planeFromLevel(1.2, false)

  it('walks only the elements whose box reaches the plane, and never a space', () => {
    const r = sectionCut(store, [plane], () => true)
    expect(r.elements).toBe(3)
    expect(r.triangles).toBe(36)
    expect(r.count).toBe(12)
    expect(r.segments).toHaveLength(12 * 6)
    for (let i = 2; i < r.segments.length; i += 3) expect(r.segments[i]).toBeCloseTo(1.2, 6)
  })

  it('leaves out what `include` leaves out — a hidden element has no outline', () => {
    const hidden = new Set([2])
    const r = sectionCut(store, [plane], (rec) => !hidden.has(rec.id))
    expect(r.elements).toBe(2)
    expect(r.count).toBe(8)
    // None of what is left is element 2's (x from 2 to 3).
    for (let i = 0; i < r.segments.length; i += 3) {
      expect(r.segments[i] >= 2 - 1e-6 && r.segments[i] <= 3 + 1e-6).toBe(false)
    }
    expect(sectionCut(store, [plane], () => false).count).toBe(0)
    // No plane cutting: nothing is walked.
    expect(sectionCut(store, [], () => true)).toMatchObject({ count: 0, elements: 0, triangles: 0 })
  })

  it("cuts one known wall of the design's mock into its 250 × 3 500 rectangle", () => {
    // `Core Wall W L1` (`sample-model.js`): one 0.25 × 3.5 box at (12.5, 8.25), on L1 at 0 m.
    const mock = createBatchStore()
    for (const chunk of mockGeometryChunks('STR')) mock.addChunk(chunk, 1, MATERIALS)
    const wall = mockModelIndex('STR').elements.find((e) => e.name === 'Core Wall W L1')!
    const id = 1 * ID_STRIDE + wall.expressId
    const r = sectionCut(mock, [planeFromLevel(0 + 1.2, false)], (rec) => rec.id === id)
    expect(r.elements).toBe(1)
    expect(r.count).toBe(4)
    const segs: number[][] = []
    for (let i = 0; i < r.count; i++) segs.push([...r.segments.subarray(i * 6, i * 6 + 6)])
    expectClosedLoop(segs)
    expect(asSet(segs)).toEqual(
      asSet([
        [12.375, 6.5, 1.2, 12.625, 6.5, 1.2],
        [12.625, 6.5, 1.2, 12.625, 10, 1.2],
        [12.625, 10, 1.2, 12.375, 10, 1.2],
        [12.375, 10, 1.2, 12.375, 6.5, 1.2]
      ])
    )
  })

  /* ── 2026-10-01: both planes cutting ── */

  const segsOf = (r: { segments: Float32Array; count: number }): number[][] => {
    const segs: number[][] = []
    for (let i = 0; i < r.count; i++) segs.push([...r.segments.subarray(i * 6, i * 6 + 6)])
    return segs
  }

  it('outlines both planes, each trimmed to what the other kept', () => {
    // The level cut at z = 1.2 with a gridline cut at x = 2.5 keeping x >= 2.5.
    const grid = gridAt(2.5)
    const r = sectionCut(store, [grid, plane], () => true)
    // Level: element 1 (x 0–1) is wholly on the gridline plane's removed side and is not walked;
    // element 2 (x 2–3) straddles it, so 3 of its 4 sides are left; the glass (x 6) keeps all 4.
    // Gridline: element 2 only, its rectangle kept below the level — 3 segments.
    expect(r.elements).toBe(3)
    expect(r.triangles).toBe(36)
    expect(r.count).toBe(3 + 4 + 3)
    const segs = segsOf(r)
    // Nothing is outlined where either plane cut the model away.
    for (const s of segs) {
      for (const p of [s.slice(0, 3), s.slice(3)]) {
        expect(p[0]).toBeGreaterThanOrEqual(2.5 - 1e-6)
        expect(p[2]).toBeLessThanOrEqual(1.2 + 1e-6)
      }
    }
    // Element 2's two outlines, exactly: one open rectangle on each plane, meeting at x = 2.5.
    expect(asSet(segs.filter((s) => s[0] < 5))).toEqual(
      asSet([
        [2.5, 0, 1.2, 3, 0, 1.2],
        [3, 0, 1.2, 3, 1, 1.2],
        [3, 1, 1.2, 2.5, 1, 1.2],
        [2.5, 0, 0, 2.5, 1, 0],
        [2.5, 0, 0, 2.5, 0, 1.2],
        [2.5, 1, 0, 2.5, 1, 1.2]
      ])
    )
    // Either order of the planes gives the same segments.
    expect(asSet(segsOf(sectionCut(store, [plane, grid], () => true)))).toEqual(asSet(segs))
  })

  it('follows the other plane when it is flipped, and one plane alone is the single cut', () => {
    // The gridline plane keeping x <= 2.5 instead: element 1 whole, element 2's other half,
    // the glass not at all.
    const r = sectionCut(store, [gridAt(2.5, true), plane], () => true)
    expect(r.count).toBe(4 + 3 + 3)
    for (const s of segsOf(r)) expect(Math.max(s[0], s[3])).toBeLessThanOrEqual(2.5 + 1e-6)
    // One plane: nothing to trim by, and the segments are the single-plane cut, float for float.
    const one = sectionCut(store, [plane], () => true)
    expect(one.count).toBe(12)
    expect([...sectionCut(store, [plane], () => true).segments]).toEqual([...one.segments])
    expect(sectionCut(store, [gridAt(2.5)], () => true).count).toBe(4)
  })

  it("trims the mock's core wall where the level cut and a gridline cut both pass through it", () => {
    // `Core Wall W L1` again: x 12.375–12.625, y 6.5–10, z 0–3.5. The level cut at 1.2 m and a
    // gridline plane at x = 12.5 — grid C (x = 12) moved 500 mm — keeping the side x >= 12.5.
    const mock = createBatchStore()
    for (const chunk of mockGeometryChunks('STR')) mock.addChunk(chunk, 1, MATERIALS)
    const wall = mockModelIndex('STR').elements.find((e) => e.name === 'Core Wall W L1')!
    const id = 1 * ID_STRIDE + wall.expressId
    const r = sectionCut(mock, [gridAt(12.5), planeFromLevel(1.2, false)], (rec) => rec.id === id)
    expect(r.elements).toBe(2)
    expect(asSet(segsOf(r))).toEqual(
      asSet([
        // the gridline plane's rectangle, below the level cut
        [12.5, 6.5, 0, 12.5, 10, 0],
        [12.5, 6.5, 0, 12.5, 6.5, 1.2],
        [12.5, 10, 0, 12.5, 10, 1.2],
        // the level cut's rectangle, on the kept side of the gridline plane
        [12.5, 6.5, 1.2, 12.625, 6.5, 1.2],
        [12.625, 6.5, 1.2, 12.625, 10, 1.2],
        [12.625, 10, 1.2, 12.5, 10, 1.2]
      ])
    )
  })
})
