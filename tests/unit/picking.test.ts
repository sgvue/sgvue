/**
 * Hit testing — `design-reference/design/viewer-core.js` L133 and L335–336.
 *
 * Built on a real `BatchStore` with two boxes on one ray, because the four things that have
 * to be right are all about *which* of them comes back: the nearest wins, a hidden element
 * never does, an unpickable one never does, and a box on the cut-away side of the section
 * neither wins nor blocks the one behind it. The last is the Marumi lesson recorded in
 * `CLAUDE.md` — filtering hits after the raycast lets a clipped-away roof block everything
 * under it — and it is the reason the clip is an interval on the ray rather than a test on
 * the result.
 *
 * Since the parts are merged with their placement baked in, the precise phase walks the
 * slot's world-space vertices directly — so a part placed by a matrix must be hit where the
 * matrix put it, which is what the two boxes five metres apart are for.
 *
 * 2026-10-01: `clip()` hands over a list — the gridline cut and the level cut can both be on —
 * and the ray is kept where every plane keeps it (`clipSpan`), in the accelerated picker and in
 * the brute-force one alike.
 */
import { BoxGeometry, MeshBasicMaterial, PerspectiveCamera, Vector2, Vector3 } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import type {
  GeometryChunk,
  GeometryRecord,
  PartRecord
} from '../../src/shared/geometry-contract.types'
import type { BatchStore, ElementRecord } from '../../src/renderer/viewer/batches'
import { createBatchStore } from '../../src/renderer/viewer/batches'
import type { ClipPlane } from '../../src/renderer/viewer/picking'
import { boxInterval, clipInterval, clipSpan, createPicker } from '../../src/renderer/viewer/picking'
import { createPartState } from '../../src/renderer/viewer/part-state'
import { Box3, Ray } from 'three/webgpu'

const materials = {
  parts: createPartState(),
  solid: new MeshBasicMaterial(),
  ghost: new MeshBasicMaterial(),
  glass: new MeshBasicMaterial()
}

/** One unit box as the contract's buffers: local vertices, an index, a crease edge. */
function boxChunk(parts: { elementId: number; x: number }[]): GeometryChunk {
  const box = new BoxGeometry(1, 1, 1)
  const position = box.getAttribute('position').array as Float32Array
  const normal = box.getAttribute('normal').array as Float32Array
  const index = box.getIndex()!.array
  const geoms: GeometryRecord[] = [
    {
      geometryExpressId: 1,
      vertexOffset: 0,
      vertexCount: position.length / 3,
      indexOffset: 0,
      indexCount: index.length,
      edgeOffset: 0,
      edgeCount: 2
    }
  ]
  const records: PartRecord[] = parts.map((p) => ({
    elementId: p.elementId,
    geomIdx: 0,
    // Column-major translation by x, as `PartRecord.matrix16` is.
    matrix16: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p.x, 0, 0, 1],
    rgba: [0.5, 0.5, 0.5, 1],
    bbox6: [p.x - 0.5, -0.5, -0.5, p.x + 0.5, 0.5, 0.5]
  }))
  return {
    header: { modelKey: 'M', index: 1, total: 1 },
    positions: new Float32Array(position),
    normals: new Float32Array(normal),
    indices: new Uint32Array(index),
    // Two vertices, one crease segment — the picker never reads them, `snap.ts` does.
    edges: new Float32Array([-0.5, -0.5, -0.5, 0.5, -0.5, -0.5]),
    geoms,
    parts: records
  }
}

/** Boxes at x = 0 and x = 5; the camera stands at x = −20 and looks along +x. */
function stage(): { store: BatchStore; camera: PerspectiveCamera } {
  const store = createBatchStore()
  store.addChunk(boxChunk([{ elementId: 1, x: 0 }, { elementId: 2, x: 5 }]), 0, materials)
  const camera = new PerspectiveCamera(50, 1, 0.1, 500)
  camera.up.set(0, 0, 1)
  camera.position.set(-20, 0, 0)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  return { store, camera }
}

const NEAR_ID = 1
const FAR_ID = 2
const CENTRE = new Vector2(0, 0)
/** No plane is cutting. `clip()` hands the picker the planes that are: none, one or two. */
const NO_CLIP: ClipPlane[] = []

describe('picking', () => {
  it('returns the nearest element on the ray, with its point and normal', () => {
    const { store, camera } = stage()
    const picker = createPicker({
      store,
      clip: () => NO_CLIP,
      hittable: (rec) => rec.visible
    })
    picker.rebuild()
    expect(picker.size).toBe(2)

    const hit = picker.pick(CENTRE, camera)!
    expect(hit).not.toBeNull()
    expect(hit.id).toBe(NEAR_ID)
    // The near face of the box at the origin.
    expect(hit.point.x).toBeCloseTo(-0.5, 5)
    expect(hit.distance).toBeCloseTo(19.5, 4)
    // The face normal points back at the camera.
    expect(hit.normal.x).toBeCloseTo(-1, 5)
    picker.dispose()
  })

  it('skips a hidden element and falls through to the one behind it', () => {
    const { store, camera } = stage()
    const picker = createPicker({
      store,
      clip: () => NO_CLIP,
      hittable: (rec) => rec.visible
    })
    ;(store.elements.get(NEAR_ID) as ElementRecord).visible = false
    picker.rebuild()
    expect(picker.size).toBe(1)
    expect(picker.pick(CENTRE, camera)!.id).toBe(FAR_ID)
    picker.dispose()
  })

  it('skips an element `setPickable` rejects, and hits nothing when both are rejected', () => {
    const { store, camera } = stage()
    let pickOk: (id: number) => boolean = () => true
    const picker = createPicker({
      store,
      clip: () => NO_CLIP,
      hittable: (rec) => rec.visible && pickOk(rec.id)
    })
    picker.rebuild()
    expect(picker.pick(CENTRE, camera)!.id).toBe(NEAR_ID)

    pickOk = (id) => id !== NEAR_ID
    picker.rebuild()
    expect(picker.pick(CENTRE, camera)!.id).toBe(FAR_ID)

    pickOk = () => false
    picker.rebuild()
    expect(picker.size).toBe(0)
    expect(picker.pick(CENTRE, camera)).toBeNull()
    picker.dispose()
  })

  it('clamps the ray to the section, so a cut-away box neither wins nor blocks', () => {
    const { store, camera } = stage()
    // Keep x ≥ 2: the box at the origin is entirely on the cut-away side.
    let clip: ClipPlane[] = NO_CLIP
    const picker = createPicker({
      store,
      clip: () => clip,
      hittable: (rec) => rec.visible
    })
    picker.rebuild()
    expect(picker.pick(CENTRE, camera)!.id).toBe(NEAR_ID)

    clip = [{ n: new Vector3(1, 0, 0), c: -2 }]
    const hit = picker.pick(CENTRE, camera)!
    // This is the whole point: not `null`, and not the near box — the far one.
    expect(hit.id).toBe(FAR_ID)
    expect(hit.point.x).toBeCloseTo(4.5, 5)

    // A plane that keeps nothing on the ray at all returns nothing.
    clip = [{ n: new Vector3(-1, 0, 0), c: -100 }]
    expect(picker.pick(CENTRE, camera)).toBeNull()
    picker.dispose()
  })

  it('clamps the ray by two planes at once: kept only where both keep it (2026-10-01)', () => {
    const { store, camera } = stage()
    let clip: ClipPlane[] = NO_CLIP
    const options = { store, clip: () => clip, hittable: (rec: ElementRecord) => rec.visible }
    const picker = createPicker(options)
    // The flat scan the grid is checked against shares the clamp: it is the same file.
    const brute = createPicker({ ...options, bruteForce: true })
    picker.rebuild()
    brute.rebuild()
    const from = new Vector3(-20, 0, 0)
    const along = new Vector3(1, 0, 0)
    const keepFrom = (x: number): ClipPlane => ({ n: new Vector3(1, 0, 0), c: -x })
    const keepUpTo = (x: number): ClipPlane => ({ n: new Vector3(-1, 0, 0), c: x })
    const both = (): (number | null)[] =>
      [picker.pick(CENTRE, camera), brute.pick(CENTRE, camera), picker.ray(from, along, 1000), brute.ray(from, along, 1000)].map(
        (h) => h && h.id
      )

    // x ≥ 2 cuts the near box away; x ≤ 5 leaves the far box's front face (x = 4.5) kept.
    clip = [keepFrom(2), keepUpTo(5)]
    expect(both()).toEqual([FAR_ID, FAR_ID, FAR_ID, FAR_ID])
    expect(picker.pick(CENTRE, camera)!.point.x).toBeCloseTo(4.5, 5)
    // The same two planes in the other order: the kept stretch is an intersection.
    clip = [keepUpTo(5), keepFrom(2)]
    expect(both()).toEqual([FAR_ID, FAR_ID, FAR_ID, FAR_ID])

    // x ≥ 2 and x ≤ 4: the slab between the two boxes holds no surface. Either plane alone
    // still hits a box — it is the second plane that takes the far one away.
    clip = [keepFrom(2), keepUpTo(4)]
    expect(both()).toEqual([null, null, null, null])
    clip = [keepUpTo(4)]
    expect(both()).toEqual([NEAR_ID, NEAR_ID, NEAR_ID, NEAR_ID])

    // x ≥ 5 alone meets the far box's back face (the materials are double-sided) …
    clip = [keepFrom(5)]
    expect(picker.pick(CENTRE, camera)!.point.x).toBeCloseTo(5.5, 5)
    // … and x ≤ 5.2 beside it leaves only the inside of that box: nothing to hit.
    clip = [keepFrom(5), keepUpTo(5.2)]
    expect(both()).toEqual([null, null, null, null])

    // Two planes that keep no common point never hit, whatever stands there.
    clip = [keepFrom(2), keepUpTo(1)]
    expect(both()).toEqual([null, null, null, null])

    // A gridline cut with a level cut, as the card sets them: the level plane keeps z ≤ 0.2,
    // which the ray at z = 0 is inside all the way; lowered below the ray, it keeps none of it.
    clip = [keepFrom(2), { n: new Vector3(0, 0, -1), c: 0.2 }]
    expect(both()).toEqual([FAR_ID, FAR_ID, FAR_ID, FAR_ID])
    clip = [keepFrom(2), { n: new Vector3(0, 0, -1), c: -1 }]
    expect(both()).toEqual([null, null, null, null])
    picker.dispose()
    brute.dispose()
  })

  it('walks only the hit part’s own index range, so a second part is found at its placement', () => {
    const { store, camera } = stage()
    const picker = createPicker({
      store,
      clip: () => NO_CLIP,
      hittable: (rec) => rec.visible
    })
    // Both boxes are one merged geometry; only the recorded index range tells them apart.
    const slot = store.slots[0]
    expect(slot.count).toBe(2)
    expect(slot.partRange[1]).toBe(slot.partRange[3])
    expect(slot.partRange[2]).toBe(slot.partRange[1])

    ;(store.elements.get(NEAR_ID) as ElementRecord).visible = false
    picker.rebuild()
    const hit = picker.pick(CENTRE, camera)!
    expect(hit.id).toBe(FAR_ID)
    // The far box's vertices carry its own translation; nothing transforms them at pick time.
    expect(hit.point.x).toBeCloseTo(4.5, 5)
    picker.dispose()
  })

  it('never hits a removed model’s elements again', () => {
    const { store, camera } = stage()
    const picker = createPicker({
      store,
      clip: () => NO_CLIP,
      hittable: (rec) => rec.visible
    })
    picker.rebuild()
    expect(picker.pick(CENTRE, camera)).not.toBeNull()

    store.removeModel('M')
    picker.rebuild()
    expect(picker.size).toBe(0)
    expect(picker.pick(CENTRE, camera)).toBeNull()
    picker.dispose()
  })

  it('still hits a see-through element', () => {
    const { store, camera } = stage()
    const picker = createPicker({
      store,
      clip: () => NO_CLIP,
      hittable: (rec) => rec.visible
    })
    const near = store.elements.get(NEAR_ID) as ElementRecord
    // The reference's ghost meshes are in `pickList` like any other, so ghosting must not
    // make an element unclickable — and the geometry the picker walks is the same one the
    // see-through mesh draws.
    near.seeThrough = true
    picker.rebuild()
    const hit = picker.pick(CENTRE, camera)!
    expect(hit.id).toBe(NEAR_ID)
    expect(hit.point.x).toBeCloseTo(-0.5, 5)
    picker.dispose()
  })

  it('answers occlusion along a bare ray, ignoring the section (L720–721)', () => {
    const { store } = stage()
    const picker = createPicker({
      store,
      // Clips that keep nothing: `anyHit` must not consult them, as the reference does not.
      clip: () => [
        { n: new Vector3(1, 0, 0), c: -1e5 },
        { n: new Vector3(0, 0, -1), c: -1e5 }
      ],
      hittable: (rec) => rec.visible
    })
    picker.rebuild()
    const along = new Vector3(1, 0, 0)
    expect(picker.anyHit(new Vector3(-20, 0, 0), along, 100)).toBe(true)
    // Stops short of the first box.
    expect(picker.anyHit(new Vector3(-20, 0, 0), along, 10)).toBe(false)
    // Aimed past both of them.
    expect(picker.anyHit(new Vector3(-20, 40, 0), along, 100)).toBe(false)
    picker.dispose()
  })

  it('lets only the occluding elements hide a label, and still picks the others (2026-09-24)', () => {
    const { store, camera } = stage()
    const site = new Set([NEAR_ID, FAR_ID])
    const picker = createPicker({
      store,
      clip: () => NO_CLIP,
      hittable: (rec) => rec.visible,
      // Both boxes are "site": nothing may hide a label, but both can still be picked.
      occludes: (rec) => !site.has(rec.id)
    })
    picker.rebuild()
    const along = new Vector3(1, 0, 0)
    expect(picker.anyHit(new Vector3(-20, 0, 0), along, 100)).toBe(false)
    expect(picker.pick(CENTRE, camera)!.id).toBe(NEAR_ID)
    expect(picker.ray(new Vector3(-20, 0, 0), along, 100)!.id).toBe(NEAR_ID)
    // The far box is building: it hides the label through the near, site one.
    site.delete(FAR_ID)
    picker.rebuild()
    expect(picker.anyHit(new Vector3(-20, 0, 0), along, 100)).toBe(true)
    expect(picker.anyHit(new Vector3(-20, 0, 0), along, 10)).toBe(false)
    picker.dispose()
  })

  it('casts a world ray for the laser meter, honouring its near bound and the section', () => {
    const { store } = stage()
    let clip: ClipPlane[] = NO_CLIP
    const picker = createPicker({ store, clip: () => clip, hittable: (rec) => rec.visible })
    picker.rebuild()
    const along = new Vector3(1, 0, 0)
    // From inside the near box, looking along +x: the first face it meets is its own far side.
    const from = new Vector3(0, 0, 0)
    const own = picker.ray(from, along, 1000, 0.01)!
    expect(own.id).toBe(NEAR_ID)
    expect(own.point.x).toBeCloseTo(0.5, 5)
    // `viewer-core.js` L378's self-hit window: raising the near bound past it steps through to
    // the next element, which is what makes a laser fired off a surface read the room.
    const next = picker.ray(from, along, 1000, 0.6)!
    expect(next.id).toBe(FAR_ID)
    expect(next.point.x).toBeCloseTo(4.5, 5)
    // Out of reach.
    expect(picker.ray(from, along, 0.2, 0.01)).toBeNull()
    // The cut-away side is not measured, exactly as `pick` does not return it.
    clip = [{ n: new Vector3(-1, 0, 0), c: 0.2 }]
    expect(picker.ray(from, along, 1000, 0.01)).toBeNull()
    picker.dispose()
  })
})

describe('boxInterval', () => {
  const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1))

  it('returns the entry and exit distances of a ray that crosses the box', () => {
    const span = boxInterval(new Ray(new Vector3(-10, 0, 0), new Vector3(1, 0, 0)), box)!
    expect(span.near).toBeCloseTo(9, 9)
    expect(span.far).toBeCloseTo(11, 9)
  })

  it('returns a negative entry when the origin is already inside — three\'s own returns null', () => {
    const span = boxInterval(new Ray(new Vector3(0, 0, 0), new Vector3(1, 0, 0)), box)!
    expect(span.near).toBeLessThan(0)
    expect(span.far).toBeCloseTo(1, 9)
  })

  it('misses a box the ray passes beside', () => {
    expect(boxInterval(new Ray(new Vector3(-10, 5, 0), new Vector3(1, 0, 0)), box)).toBeNull()
  })

  it('handles a ray exactly parallel to an axis, inside and outside the slab', () => {
    // Parallel to x, at y = 0 (inside the y slab) — crosses.
    expect(boxInterval(new Ray(new Vector3(-10, 0, 0), new Vector3(1, 0, 0)), box)).not.toBeNull()
    // Parallel to x, at y = 5 (outside the y slab) — never enters, whatever x does.
    expect(boxInterval(new Ray(new Vector3(-10, 5, 0), new Vector3(1, 0, 0)), box)).toBeNull()
  })
})

describe('clipInterval', () => {
  const ray = (ox: number, dx: number): Ray =>
    new Ray(new Vector3(ox, 0, 0), new Vector3(dx, 0, 0))

  it('is a half line starting where the ray crosses into the kept side', () => {
    // Keep x ≥ 2, travelling +x from x = −20.
    const span = clipInterval(ray(-20, 1), { n: new Vector3(1, 0, 0), c: -2 })!
    expect(span.near).toBeCloseTo(22, 9)
    expect(span.far).toBe(Infinity)
  })

  it('is a half line ending where the ray leaves the kept side', () => {
    // Keep x ≤ 2 (n = −x, c = 2), travelling +x from x = −20.
    const span = clipInterval(ray(-20, 1), { n: new Vector3(-1, 0, 0), c: 2 })!
    expect(span.near).toBe(-Infinity)
    expect(span.far).toBeCloseTo(22, 9)
  })

  it('keeps or rejects the whole ray when it runs parallel to the plane', () => {
    const parallel = new Ray(new Vector3(0, 0, 5), new Vector3(1, 0, 0))
    // Plane z ≥ 0: the ray sits at z = 5, entirely kept.
    expect(clipInterval(parallel, { n: new Vector3(0, 0, 1), c: 0 })).toEqual({
      near: -Infinity,
      far: Infinity
    })
    // Plane z ≤ 0: entirely cut away.
    expect(clipInterval(parallel, { n: new Vector3(0, 0, -1), c: 0 })).toBeNull()
  })
})

describe('clipSpan — every cutting plane at once (2026-10-01)', () => {
  const ray = new Ray(new Vector3(-20, 0, 0), new Vector3(1, 0, 0))
  const from = (x: number): ClipPlane => ({ n: new Vector3(1, 0, 0), c: -x })
  const upTo = (x: number): ClipPlane => ({ n: new Vector3(-1, 0, 0), c: x })

  it('keeps the whole line when no plane is cutting', () => {
    expect(clipSpan(ray, [])).toEqual({ near: -Infinity, far: Infinity })
  })

  it('is the one plane’s own interval when one is cutting', () => {
    expect(clipSpan(ray, [from(2)])).toEqual(clipInterval(ray, from(2)))
    expect(clipSpan(ray, [upTo(2)])).toEqual(clipInterval(ray, upTo(2)))
  })

  it('is the intersection of two intervals, in either order', () => {
    for (const planes of [
      [from(2), upTo(5)],
      [upTo(5), from(2)]
    ]) {
      const span = clipSpan(ray, planes)!
      expect(span.near).toBeCloseTo(22, 9)
      expect(span.far).toBeCloseTo(25, 9)
    }
    // A plane the ray runs parallel to and inside changes nothing; one it is outside ends it.
    expect(clipSpan(ray, [from(2), { n: new Vector3(0, 0, 1), c: 1 }])).toEqual(clipInterval(ray, from(2)))
    expect(clipSpan(ray, [from(2), { n: new Vector3(0, 0, 1), c: -1 }])).toBeNull()
  })

  it('is null when the two kept sides share no part of the ray', () => {
    expect(clipSpan(ray, [from(5), upTo(2)])).toBeNull()
  })
})
