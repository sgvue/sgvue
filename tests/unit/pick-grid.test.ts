/**
 * The pick grid must not change a single answer.
 *
 * `pick-grid.ts` exists because the label occlusion sweep fires one ray per grid bubble and
 * the flat box scan measured 1.1 ms a ray on the 137.9 MB reference model — 83.8 ms a sweep,
 * on one frame in four, with the camera standing still. The grid makes a ray see only the
 * candidates along it; what it may **not** do is answer differently. So the whole of this file
 * is one comparison: the accelerated picker against `bruteForce: true`, which is the flat scan
 * this file had before, on the design's own federation, over thousands of seeded random rays —
 * hits and misses, the camera inside the building and outside it, a section plane cutting (and,
 * since 2026-10-01, two at once: a gridline cut and a level cut), and with two thirds of the
 * model hidden.
 *
 * Equality is exact. Not "within a tolerance": the same element id, the same distance to the
 * last bit, the same point and the same face normal, because the grid only decides *which
 * candidates are tested* and the test itself is unchanged.
 */
import { MeshBasicMaterial, PerspectiveCamera, Vector2, Vector3 } from 'three/webgpu'
import { Box3, Ray } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { mockGeometryChunks } from '../../src/renderer/dev/mock-adapter'
import type { BatchStore, ElementRecord } from '../../src/renderer/viewer/batches'
import { createBatchStore } from '../../src/renderer/viewer/batches'
import { createPartState } from '../../src/renderer/viewer/part-state'
import type { ClipPlane, PickHit } from '../../src/renderer/viewer/picking'
import { createPicker } from '../../src/renderer/viewer/picking'
import { buildPickGrid } from '../../src/renderer/viewer/pick-grid'

const KEYS = ['ARC', 'STR', 'SIT', 'MEP'] as const

function federation(): BatchStore {
  const store = createBatchStore()
  const materials = {
    parts: createPartState(),
    solid: new MeshBasicMaterial(),
    ghost: new MeshBasicMaterial(),
    glass: new MeshBasicMaterial()
  }
  KEYS.forEach((key, slot) => {
    for (const chunk of mockGeometryChunks(key)) store.addChunk(chunk, slot, materials)
    store.finishModel(key)
  })
  return store
}

/** Deterministic, so a failure is reproducible and a green run means something. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** No plane is cutting. `clip()` hands the picker the planes that are: none, one or two. */
const NO_CLIP: ClipPlane[] = []

const same = (a: PickHit | null, b: PickHit | null): boolean => {
  if (!a || !b) return a === b
  return (
    a.id === b.id &&
    a.distance === b.distance &&
    a.point.equals(b.point) &&
    a.normal.equals(b.normal)
  )
}

const describeHit = (h: PickHit | null): string =>
  h ? `${h.id}@${h.distance.toFixed(6)} ${h.point.toArray().join(',')}` : 'null'

describe('the pick grid on the design federation', () => {
  const store = federation()
  const box = store.bbox.clone()
  const centre = box.getCenter(new Vector3())
  const radius = box.getSize(new Vector3()).length() / 2

  /** Both pickers share the section planes and the visibility rule, so only the filter differs. */
  let clip: ClipPlane[] = NO_CLIP
  const hidden = new Set<number>()
  const hittable = (rec: ElementRecord): boolean => !hidden.has(rec.id)
  const options = { store, clip: () => clip, hittable }
  const accel = createPicker(options)
  const brute = createPicker({ ...options, bruteForce: true })

  /** Rays that mostly meet the building: from outside the sphere towards a point inside it. */
  const rays = (seed: number, n: number, wild = 0.25): { o: Vector3; d: Vector3 }[] => {
    const rnd = mulberry32(seed)
    const out: { o: Vector3; d: Vector3 }[] = []
    const unit = (): Vector3 => {
      const z = rnd() * 2 - 1
      const t = rnd() * Math.PI * 2
      const r = Math.sqrt(Math.max(0, 1 - z * z))
      return new Vector3(r * Math.cos(t), r * Math.sin(t), z)
    }
    for (let i = 0; i < n; i++) {
      const o = unit().multiplyScalar(radius * (1.05 + rnd() * 1.5)).add(centre)
      const aim =
        rnd() < wild
          ? unit().multiplyScalar(radius * 3).add(centre)
          : new Vector3(
              box.min.x + rnd() * (box.max.x - box.min.x),
              box.min.y + rnd() * (box.max.y - box.min.y),
              box.min.z + rnd() * (box.max.z - box.min.z)
            )
      out.push({ o, d: aim.sub(o).normalize() })
    }
    return out
  }

  it('is built over every element, with more than one cell', () => {
    accel.rebuild()
    brute.rebuild()
    expect(accel.size).toBe(store.elements.size)
    expect(brute.size).toBe(accel.size)
    const grid = buildPickGrid([...store.elements.values()].map((r) => r.bbox))
    expect(grid.items).toBe(store.elements.size)
    expect(grid.cells).toBeGreaterThan(1)
    expect(grid.dims.every((d) => d >= 1)).toBe(true)
  })

  it('answers `ray` and `anyHit` exactly as the flat scan does — 3 000 rays', () => {
    clip = NO_CLIP
    hidden.clear()
    accel.rebuild()
    brute.rebuild()
    const far = radius * 8
    let hits = 0
    for (const { o, d } of rays(1, 3000)) {
      const a = accel.ray(o, d, far)
      const b = brute.ray(o, d, far)
      if (!same(a, b)) {
        throw new Error(`ray ${o.toArray()} → ${d.toArray()}: ${describeHit(a)} vs ${describeHit(b)}`)
      }
      if (a) hits++
      expect(accel.anyHit(o, d, far)).toBe(brute.anyHit(o, d, far))
    }
    // A comparison that never hits anything proves nothing.
    expect(hits).toBeGreaterThan(1000)
  })

  it('agrees from inside the building, and with a near bound', () => {
    clip = NO_CLIP
    hidden.clear()
    accel.rebuild()
    brute.rebuild()
    const rnd = mulberry32(7)
    for (let i = 0; i < 800; i++) {
      const o = new Vector3(
        box.min.x + rnd() * (box.max.x - box.min.x),
        box.min.y + rnd() * (box.max.y - box.min.y),
        box.min.z + rnd() * (box.max.z - box.min.z)
      )
      const d = new Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize()
      const near = rnd() < 0.5 ? 0 : radius * 0.05
      expect(same(accel.ray(o, d, radius * 4, near), brute.ray(o, d, radius * 4, near))).toBe(true)
      expect(accel.anyHit(o, d, radius * 4)).toBe(brute.anyHit(o, d, radius * 4))
    }
  })

  it('agrees while a section plane is cutting', () => {
    hidden.clear()
    accel.rebuild()
    brute.rebuild()
    const planes: ClipPlane[] = [
      { n: new Vector3(1, 0, 0), c: -centre.x },
      { n: new Vector3(-1, 0, 0), c: centre.x },
      { n: new Vector3(0, 1, 0), c: -centre.y },
      { n: new Vector3(0, 0, 1), c: -(box.min.z + (box.max.z - box.min.z) * 0.4) },
      { n: new Vector3(0.6, -0.8, 0).normalize(), c: -centre.x * 0.6 + centre.y * 0.8 }
    ]
    for (const plane of planes) {
      clip = [plane]
      let cut = 0
      for (const { o, d } of rays(11, 400)) {
        const a = accel.ray(o, d, radius * 8)
        const b = brute.ray(o, d, radius * 8)
        expect(same(a, b)).toBe(true)
        if (a) cut++
        // `anyHit` deliberately ignores the plane (`viewer-core.js` L720): still the same.
        expect(accel.anyHit(o, d, radius * 8)).toBe(brute.anyHit(o, d, radius * 8))
      }
      expect(cut).toBeGreaterThan(50)
    }
    clip = NO_CLIP
  })

  it('agrees while two section planes are cutting, and never hits what either cut away', () => {
    hidden.clear()
    accel.rebuild()
    brute.rebuild()
    const level = (share: number): ClipPlane => ({
      n: new Vector3(0, 0, -1),
      c: box.min.z + (box.max.z - box.min.z) * share
    })
    // A gridline cut with a level cut — the pair the Section card makes — at a right angle, on
    // the skew, and two that keep only a slab between them.
    const pairs: ClipPlane[][] = [
      [{ n: new Vector3(1, 0, 0), c: -centre.x }, level(0.4)],
      [{ n: new Vector3(0, -1, 0), c: centre.y }, level(0.7)],
      [{ n: new Vector3(0.6, -0.8, 0).normalize(), c: -centre.x * 0.6 + centre.y * 0.8 }, level(0.5)],
      [
        { n: new Vector3(1, 0, 0), c: -(centre.x - 3) },
        { n: new Vector3(-1, 0, 0), c: centre.x + 3 }
      ]
    ]
    const kept = (p: Vector3, plane: ClipPlane): boolean => p.dot(plane.n) + plane.c >= -1e-6
    for (const pair of pairs) {
      clip = pair
      let both = 0
      let fewer = 0
      for (const { o, d } of rays(17, 400)) {
        const a = accel.ray(o, d, radius * 8)
        const b = brute.ray(o, d, radius * 8)
        if (!same(a, b)) {
          throw new Error(`ray ${o.toArray()} → ${d.toArray()}: ${describeHit(a)} vs ${describeHit(b)}`)
        }
        if (a) {
          both++
          // The point of two planes: a hit is on the kept side of each of them.
          expect(kept(a.point, pair[0]) && kept(a.point, pair[1])).toBe(true)
        }
        // And the second plane really takes something away: one plane alone hits what two do not.
        clip = [pair[0]]
        const one = accel.ray(o, d, radius * 8)
        clip = pair
        if (one && (!a || a.distance !== one.distance)) fewer++
        expect(accel.anyHit(o, d, radius * 8)).toBe(brute.anyHit(o, d, radius * 8))
      }
      expect(both).toBeGreaterThan(20)
      expect(fewer).toBeGreaterThan(10)
    }
    clip = NO_CLIP
  })

  it('follows per-element visibility exactly as the flat scan does', () => {
    clip = NO_CLIP
    const rnd = mulberry32(99)
    hidden.clear()
    for (const rec of store.elements.values()) if (rnd() < 0.66) hidden.add(rec.id)
    accel.rebuild()
    brute.rebuild()
    expect(accel.size).toBe(brute.size)
    expect(accel.size).toBeLessThan(store.elements.size)
    for (const { o, d } of rays(5, 800)) {
      expect(same(accel.ray(o, d, radius * 8), brute.ray(o, d, radius * 8))).toBe(true)
      expect(accel.anyHit(o, d, radius * 8)).toBe(brute.anyHit(o, d, radius * 8))
      // Nothing hidden may ever come back.
      const hit = accel.ray(o, d, radius * 8)
      if (hit) expect(hidden.has(hit.id)).toBe(false)
    }
    hidden.clear()
    accel.rebuild()
    brute.rebuild()
  })

  it('answers `pick` through a camera exactly as the flat scan does', () => {
    clip = NO_CLIP
    hidden.clear()
    accel.rebuild()
    brute.rebuild()
    const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 5000)
    camera.up.set(0, 0, 1)
    const rnd = mulberry32(23)
    const ndc = new Vector2()
    for (let i = 0; i < 600; i++) {
      const t = rnd() * Math.PI * 2
      const phi = 0.2 + rnd() * 1.2
      camera.position.set(
        centre.x + Math.sin(phi) * Math.cos(t) * radius * 2,
        centre.y + Math.sin(phi) * Math.sin(t) * radius * 2,
        centre.z + Math.cos(phi) * radius * 2
      )
      camera.lookAt(centre)
      camera.updateMatrixWorld(true)
      ndc.set(rnd() * 1.6 - 0.8, rnd() * 1.6 - 0.8)
      expect(same(accel.pick(ndc, camera), brute.pick(ndc, camera))).toBe(true)
    }
  })

  it('keeps up with a model being removed', () => {
    clip = NO_CLIP
    hidden.clear()
    store.removeModel('STR')
    accel.rebuild()
    brute.rebuild()
    expect(accel.size).toBe(brute.size)
    expect(accel.size).toBe(store.elements.size)
    for (const { o, d } of rays(3, 600)) {
      expect(same(accel.ray(o, d, radius * 8), brute.ray(o, d, radius * 8))).toBe(true)
      expect(accel.anyHit(o, d, radius * 8)).toBe(brute.anyHit(o, d, radius * 8))
    }
  })
})

describe('buildPickGrid', () => {
  const rnd = mulberry32(4242)
  const boxes: Box3[] = []
  for (let i = 0; i < 500; i++) {
    const c = new Vector3(rnd() * 100 - 50, rnd() * 100 - 50, rnd() * 20)
    const h = new Vector3(rnd() * 4 + 0.1, rnd() * 4 + 0.1, rnd() * 4 + 0.1)
    boxes.push(new Box3(c.clone().sub(h), c.clone().add(h)))
  }
  // One box around everything: the oversize case, which must still be visited by every query.
  boxes.push(new Box3(new Vector3(-60, -60, -5), new Vector3(60, 60, 30)))
  const grid = buildPickGrid(boxes)

  it('never misses a box the ray actually meets', () => {
    const rnd2 = mulberry32(88)
    const ray = new Ray()
    let checked = 0
    for (let i = 0; i < 2000; i++) {
      ray.origin.set(rnd2() * 300 - 150, rnd2() * 300 - 150, rnd2() * 80 - 20)
      ray.direction
        .set(rnd2() * 2 - 1, rnd2() * 2 - 1, rnd2() * 2 - 1)
        .normalize()
      const seen = new Set<number>()
      grid.query(ray, 0, 400, (item) => seen.add(item))
      for (let b = 0; b < boxes.length; b++) {
        const hit = new Vector3()
        if (ray.intersectBox(boxes[b], hit) && ray.origin.distanceTo(hit) <= 400) {
          checked++
          expect(seen.has(b)).toBe(true)
        }
      }
    }
    expect(checked).toBeGreaterThan(500)
  })

  it('visits each item at most once per query, and prunes', () => {
    const ray = new Ray(new Vector3(-200, 0, 5), new Vector3(1, 0, 0))
    const seen: number[] = []
    grid.query(ray, 0, 1000, (item) => seen.push(item))
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen.length).toBeLessThan(boxes.length)
  })

  it('keeps an item too large to bin, and still visits it', () => {
    // 5 000 small boxes make a grid of more than OVERSIZE_CELLS cells, so the one box around
    // them all cannot be binned — it goes to `oversize` and every query sees it.
    const rnd3 = mulberry32(555)
    const many: Box3[] = []
    for (let i = 0; i < 5000; i++) {
      const c = new Vector3(rnd3() * 100 - 50, rnd3() * 100 - 50, rnd3() * 20)
      many.push(new Box3(c.clone().subScalar(0.5), c.clone().addScalar(0.5)))
    }
    many.push(new Box3(new Vector3(-60, -60, -5), new Vector3(60, 60, 30)))
    const big = buildPickGrid(many)
    expect(big.oversize).toBe(1)
    const seen = new Set<number>()
    big.query(new Ray(new Vector3(-500, -500, 200), new Vector3(1, 1, -1).normalize()), 0, 10, (i) =>
      seen.add(i)
    )
    // The ray stops 10 units from the origin, nowhere near the grid — the oversize item is
    // still offered, because it is never filtered out here. `picking.ts` box-tests it.
    expect(seen.has(many.length - 1)).toBe(true)
  })

  it('is empty for an empty federation', () => {
    const empty = buildPickGrid([])
    expect(empty.items).toBe(0)
    let visited = 0
    empty.query(new Ray(new Vector3(), new Vector3(1, 0, 0)), 0, 10, () => visited++)
    expect(visited).toBe(0)
  })
})
