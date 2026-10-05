/**
 * `IfcSpace` see-through by default (2026-09-24, owner-requested: *"make them transparent by
 * default. They are space anyway."*).
 *
 * The store puts every space part in its own family — never casting, alpha stored as 1 so the
 * space material's `SPACE_ALPHA` is the whole opacity — and the picker prefers the nearest
 * **non-space** hit anywhere on the ray, taking a space only when it is the one thing hit. The
 * flat box scan (`bruteForce`) must answer identically, because `scripts/pick-parity.cjs`
 * holds the accelerated picker to it on a real model.
 */
import { BoxGeometry, MeshBasicMaterial, PerspectiveCamera, Vector2, Vector3 } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import type { GeometryChunk, PartRecord } from '../../src/shared/geometry-contract.types'
import type { BatchStore, ElementRecord } from '../../src/renderer/viewer/batches'
import { RENDER_ORDER_SPACE, createBatchStore } from '../../src/renderer/viewer/batches'
import type { ClipPlane, Picker } from '../../src/renderer/viewer/picking'
import { createPicker } from '../../src/renderer/viewer/picking'
import { createPartState } from '../../src/renderer/viewer/part-state'

const SPACE_MAT = new MeshBasicMaterial()
const materials = {
  parts: createPartState(),
  solid: new MeshBasicMaterial(),
  ghost: new MeshBasicMaterial(),
  glass: new MeshBasicMaterial(),
  space: SPACE_MAT
}

/** Unit boxes along +x; `size` scales a box, `space` marks it an `IfcSpace`. */
function chunk(parts: { elementId: number; x: number; size?: number; space?: boolean; alpha?: number }[]): GeometryChunk {
  const box = new BoxGeometry(1, 1, 1)
  const position = box.getAttribute('position').array as Float32Array
  const index = box.getIndex()!.array
  const records: PartRecord[] = parts.map((p) => {
    const k = p.size ?? 1
    const r: PartRecord = {
      elementId: p.elementId,
      geomIdx: 0,
      matrix16: [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, p.x, 0, 0, 1],
      rgba: [0.5, 0.6, 0.7, p.alpha ?? 1],
      bbox6: [p.x - k / 2, -k / 2, -k / 2, p.x + k / 2, k / 2, k / 2]
    }
    if (p.space) r.isSpace = true
    return r
  })
  return {
    header: { modelKey: 'M', index: 1, total: 1 },
    positions: new Float32Array(position),
    normals: new Float32Array(box.getAttribute('normal').array as Float32Array),
    indices: new Uint32Array(index),
    edges: new Float32Array([-0.5, -0.5, -0.5, 0.5, -0.5, -0.5]),
    geoms: [
      {
        geometryExpressId: 1,
        vertexOffset: 0,
        vertexCount: position.length / 3,
        indexOffset: 0,
        indexCount: index.length,
        edgeOffset: 0,
        edgeCount: 2
      }
    ],
    parts: records
  }
}

const SPACE = 1
const WALL = 2
const NO_CLIP: ClipPlane[] = []
const CENTRE = new Vector2(0, 0)

/** A room (a 4 m space box around x = 0) with a wall standing inside it at x = 1. */
function room(): { store: BatchStore; camera: PerspectiveCamera } {
  const store = createBatchStore()
  store.addChunk(
    chunk([
      { elementId: SPACE, x: 0, size: 4, space: true, alpha: 0.3 },
      { elementId: WALL, x: 1 }
    ]),
    0,
    materials
  )
  const camera = new PerspectiveCamera(50, 1, 0.1, 500)
  camera.up.set(0, 0, 1)
  camera.position.set(-20, 0, 0)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  return { store, camera }
}

const pickers = (store: BatchStore): Picker[] =>
  [false, true].map((bruteForce) =>
    createPicker({ store, clip: () => NO_CLIP, hittable: (rec) => rec.visible, bruteForce })
  )

describe('the space family', () => {
  it('puts a space part in its own slot: no shadow, drawn before glass, alpha stored as 1', () => {
    const { store } = room()
    const slot = store.slots.find((s) => s.family === 'space')!
    expect(slot).toBeDefined()
    expect(slot.mesh.material).toBe(SPACE_MAT)
    expect(slot.mesh.castShadow).toBe(false)
    expect(slot.mesh.receiveShadow).toBe(false)
    expect(slot.ghost).toBeNull()
    expect(slot.mesh.renderOrder).toBe(RENDER_ORDER_SPACE)
    const rec = store.elements.get(SPACE)!
    expect(rec.space).toBe(true)
    expect(rec.rgba).toEqual([0.5, 0.6, 0.7, 1])
    expect(store.elements.get(WALL)!.space).toBe(false)
    store.castShadows(true)
    expect(slot.mesh.castShadow).toBe(false)
  })
})

describe('picking with spaces', () => {
  it('prefers the wall inside the room, although the room’s face is nearer', () => {
    const { store, camera } = room()
    for (const p of pickers(store)) {
      p.rebuild()
      const hit = p.pick(CENTRE, camera)!
      expect(hit.id).toBe(WALL)
      expect(hit.point.x).toBeCloseTo(0.5, 5)
    }
  })

  it('picks the room when it is the only thing on the ray', () => {
    const { store, camera } = room()
    ;(store.elements.get(WALL) as ElementRecord).visible = false
    for (const p of pickers(store)) {
      p.rebuild()
      const hit = p.pick(CENTRE, camera)!
      expect(hit.id).toBe(SPACE)
      expect(hit.point.x).toBeCloseTo(-2, 5)
    }
  })

  it('picks the room where the ray misses the wall', () => {
    const { store, camera } = room()
    const off = new Vector2(0, 0)
    // A ray through the room, above the unit wall: aim at (0, 0, 1.5).
    const p = new Vector3(0, 0, 1.5).project(camera)
    off.set(p.x, p.y)
    for (const picker of pickers(store)) {
      picker.rebuild()
      expect(picker.pick(off, camera)!.id).toBe(SPACE)
    }
  })

  it('applies the same rule to `ray`, and both pickers agree', () => {
    const { store } = room()
    const answers = pickers(store).map((p) => {
      p.rebuild()
      return p.ray(new Vector3(-20, 0, 0), new Vector3(1, 0, 0), 100)!.id
    })
    expect(answers).toEqual([WALL, WALL])
  })

  it('hits nothing when nothing is there', () => {
    const { store, camera } = room()
    for (const p of pickers(store)) {
      p.rebuild()
      expect(p.pick(new Vector2(0.9, 0.9), camera)).toBeNull()
    }
  })
})

/**
 * Refactor pass 2, P12: when no solid is hit, the fallback walks the spaces alone rather than
 * every live element again. Held to the rule, stated independently with two filtered pickers —
 * a solids-only one, and a spaces-only one asked only when it missed — on a seeded scatter of
 * rooms and walls, some inside each other, along a few thousand rays.
 */
describe('the space fallback answers what the old second cast did', () => {
  it('same id, same distance, same point, on every ray', () => {
    let a = 0x2468ace >>> 0
    const rnd = (): number => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const store = createBatchStore()
    const parts = Array.from({ length: 60 }, (_, i) => ({
      elementId: i + 1,
      x: rnd() * 40 - 20,
      size: 0.5 + rnd() * (i % 3 === 0 ? 6 : 2),
      space: i % 3 === 0
    }))
    store.addChunk(chunk(parts), 0, materials)
    for (const rec of store.elements.values()) rec.visible = rnd() > 0.1
    const make = (only?: 'solid' | 'space'): Picker =>
      createPicker({
        store,
        clip: () => NO_CLIP,
        hittable: (rec) => rec.visible && (!only || (only === 'space') === rec.space)
      })
    const picker = make()
    const solids = make('solid')
    const spaces = make('space')
    for (const p of [picker, solids, spaces]) p.rebuild()
    let hits = 0
    let spaceHits = 0
    for (let i = 0; i < 3000; i++) {
      const o = new Vector3(rnd() * 60 - 30, rnd() * 20 - 10, rnd() * 20 - 10)
      const d = new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize()
      const got = picker.ray(o, d, 100)
      const want = solids.ray(o, d, 100) ?? spaces.ray(o, d, 100)
      expect(got?.id ?? null).toBe(want?.id ?? null)
      if (got && want) {
        expect(got.distance).toBe(want.distance)
        expect(got.point.equals(want.point)).toBe(true)
        expect(got.normal.equals(want.normal)).toBe(true)
        hits++
        if (store.elements.get(got.id)!.space) spaceHits++
      }
    }
    // The scatter really exercises both branches.
    expect(hits).toBeGreaterThan(300)
    expect(spaceHits).toBeGreaterThan(30)
  })
})
