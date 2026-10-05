/**
 * Crease edges at 20°.
 *
 * The design's drawn-edge look is `new THREE.EdgesGeometry(geo, 20)`
 * (`design-reference/design/viewer-core.js:123`). The worker cannot load three.js, so the
 * algorithm is replicated in `geometry-streamer.ts` — and "replicated" is only worth
 * anything if it is checked against the original, which is what the last block here does.
 */
import { BufferAttribute, BufferGeometry, EdgesGeometry } from 'three'
import { describe, expect, it } from 'vitest'
import { creaseEdges } from '../../src/worker/geometry-streamer'

/** A unit cube centred on the origin, 8 shared corners and 12 triangles. */
function sharedCube(): { positions: Float32Array; indices: Uint32Array } {
  const positions = new Float32Array([
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5,
    -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5
  ])
  const indices = new Uint32Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1,
    2, 6, 1, 6, 5
  ])
  return { positions, indices }
}

/**
 * The same cube with every face carrying its own four vertices — which is what web-ifc
 * hands back, and the reason the algorithm has to weld by rounded position rather than by
 * index.
 */
function splitCube(): { positions: Float32Array; indices: Uint32Array } {
  const shared = sharedCube()
  const positions = new Float32Array(shared.indices.length * 3)
  const indices = new Uint32Array(shared.indices.length)
  for (let i = 0; i < shared.indices.length; i++) {
    const from = shared.indices[i] * 3
    positions[i * 3] = shared.positions[from]
    positions[i * 3 + 1] = shared.positions[from + 1]
    positions[i * 3 + 2] = shared.positions[from + 2]
    indices[i] = i
  }
  return { positions, indices }
}

const segments = (edges: Float32Array): [number, number, number][][] => {
  const out: [number, number, number][][] = []
  for (let i = 0; i < edges.length; i += 6) {
    out.push([
      [edges[i], edges[i + 1], edges[i + 2]],
      [edges[i + 3], edges[i + 4], edges[i + 5]]
    ])
  }
  return out
}

/** A segment of a unit cube is an edge when exactly one coordinate differs. */
const differingAxes = ([a, b]: [number, number, number][]): number =>
  [0, 1, 2].filter((k) => Math.abs(a[k] - b[k]) > 1e-6).length

describe('crease edges — a cube', () => {
  it('finds the 12 edges and nothing across a face', () => {
    const { positions, indices } = sharedCube()
    const edges = creaseEdges(positions, indices)
    const found = segments(edges)
    expect(found).toHaveLength(12)
    // A face diagonal differs in two axes and a body diagonal in three; neither is an edge.
    expect(found.map(differingAxes)).toEqual(new Array(12).fill(1))
  })

  it('welds split vertices, so web-ifc output gives the same 12 edges', () => {
    const { positions, indices } = splitCube()
    expect(positions.length / 3).toBe(36)
    expect(segments(creaseEdges(positions, indices))).toHaveLength(12)
  })
})

describe('crease edges — flat surfaces', () => {
  it('keeps only the boundary of two coplanar triangles', () => {
    // A 2×1 quad in the XY plane, split along its diagonal.
    const positions = new Float32Array([0, 0, 0, 2, 0, 0, 2, 1, 0, 0, 1, 0])
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3])
    const found = segments(creaseEdges(positions, indices))
    // Four boundary edges; the shared diagonal is dropped because the faces are coplanar.
    expect(found).toHaveLength(4)
    const hasDiagonal = found.some(
      ([a, b]) =>
        (a[0] === 0 && a[1] === 0 && b[0] === 2 && b[1] === 1) ||
        (a[0] === 2 && a[1] === 1 && b[0] === 0 && b[1] === 0)
    )
    expect(hasDiagonal).toBe(false)
  })

  it('keeps a fold once it passes 20° and not before', () => {
    // Two triangles hinged along the Y axis; the second is lifted by `angle`.
    const hinge = (angle: number): Float32Array => {
      const rad = (angle * Math.PI) / 180
      return new Float32Array([
        -1, 0, 0, 0, 0, 0, 0, 1, 0, -1, 1, 0, Math.cos(rad), 0, Math.sin(rad), Math.cos(rad), 1,
        Math.sin(rad)
      ])
    }
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3, 1, 4, 5, 1, 5, 2])
    expect(segments(creaseEdges(hinge(10), indices)).some(isHinge)).toBe(false)
    expect(segments(creaseEdges(hinge(30), indices)).some(isHinge)).toBe(true)
  })
})

/** The hinge runs from (0,0,0) to (0,1,0). */
function isHinge([a, b]: [number, number, number][]): boolean {
  const at = (p: [number, number, number], y: number): boolean =>
    Math.abs(p[0]) < 1e-6 && Math.abs(p[1] - y) < 1e-6 && Math.abs(p[2]) < 1e-6
  return (at(a, 0) && at(b, 1)) || (at(a, 1) && at(b, 0))
}

describe('crease edges — against three.js itself', () => {
  /** three's own `EdgesGeometry`, as the reference renderer builds it. */
  const reference = (positions: Float32Array, indices: Uint32Array): Float32Array => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    geometry.setIndex(new BufferAttribute(indices, 1))
    const edges = new EdgesGeometry(geometry, 20)
    return edges.getAttribute('position').array as Float32Array
  }

  /** Segments as a canonical, order-independent set. */
  const canonical = (edges: Float32Array): string[] =>
    segments(edges)
      .map(([a, b]) => {
        const key = (p: number[]): string => p.map((v) => v.toFixed(5)).join(',')
        return [key(a), key(b)].sort().join('|')
      })
      .sort()

  for (const [name, build] of [
    ['a shared-vertex cube', sharedCube],
    ['a split-vertex cube', splitCube]
  ] as const) {
    it(`produces the same segments as EdgesGeometry(geo, 20) for ${name}`, () => {
      const { positions, indices } = build()
      expect(canonical(creaseEdges(positions, indices))).toEqual(
        canonical(reference(positions, indices))
      )
    })
  }

  it('agrees on a lumpy mesh, where the threshold actually decides', () => {
    // A 12×12 grid displaced by a coarse sine, so many folds sit either side of 20°.
    const n = 12
    const positions = new Float32Array((n + 1) * (n + 1) * 3)
    for (let y = 0; y <= n; y++) {
      for (let x = 0; x <= n; x++) {
        const i = (y * (n + 1) + x) * 3
        positions[i] = x / n
        positions[i + 1] = y / n
        positions[i + 2] = 0.12 * Math.sin(x * 1.1) * Math.cos(y * 0.9)
      }
    }
    const indices = new Uint32Array(n * n * 6)
    let at = 0
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const a = y * (n + 1) + x
        indices[at++] = a
        indices[at++] = a + 1
        indices[at++] = a + n + 2
        indices[at++] = a
        indices[at++] = a + n + 2
        indices[at++] = a + n + 1
      }
    }
    const mine = canonical(creaseEdges(positions, indices))
    const theirs = canonical(reference(positions, indices))
    expect(mine.length).toBeGreaterThan(n * 4)
    expect(mine).toEqual(theirs)
  })
})
