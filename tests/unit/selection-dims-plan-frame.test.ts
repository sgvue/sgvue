/**
 * The selection dimensions and the property card's geometry rows read a building turned in the
 * world as the building is drawn — in the **plan frame**, square with the building — not round
 * the world-axis box of a diagonal element.
 *
 * Since 2026-11-07 every model is drawn at its file's own world coordinates and only the camera's
 * plan frame turns (`shared/plan-rotation.ts`, ρ). `annotations.ts` `drawDims` still draws the
 * selection box and its three dimension runs from `host.elementBox(id)`, the element's
 * **world-axis** box: for a wall 6.000 × 0.200 × 3.000 m on a site turned −43.4103°, that is a
 * ~4.5 × 4.3 m box round the wall, and the labels read its extents. The property card's
 * `geoRows` (`state/selectors/props.ts`) reads the same box.
 *
 * Driven through the **real** `viewer-core.ts`, `batches.ts`, `annotations.ts` and
 * `shared/annotate.ts`, on a model streamed through the real `streamGeometry` from an IFC written
 * here on the synthetic site (`synthetic-boxes.ts`). Only what needs a GPU or a DOM is replaced:
 * the renderer and scene rig (`scene.ts` — the scene's `add` is how the annotation group is
 * caught), the label overlay (each label's anchor and text recorded), the input, the snapper, the
 * edge store, the picker, the section visuals and cut, the part-state texture, and
 * `requestAnimationFrame` / `document` / `ResizeObserver`. Every expected number is worked out in
 * Float64 from the file's own numbers (`synthetic-boxes.ts`), never from what the app computed.
 *
 * The interface the fix adds, and which this file is written against (it does not exist today, so
 * the cases that call it fail, and `npm run typecheck` names exactly these uses — marked
 * `NOT YET IN src/`):
 *   · `viewer.elementPlanBox(id): { box: Box3; rho: number } | null` — the element's box in the
 *     plan frame (scene turned by −ρ about the scene origin, Z up), `rho` in radians;
 *   · `geoRows(box, solids, coords, offset, units, rho = 0)` and `SelectionInput.rho`.
 */
import { Box3, LineSegments, Vector3, type Object3D } from 'three/webgpu'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { GeometryChunk } from '../../src/shared/geometry-contract.types'
import { dimOffset } from '../../src/shared/annotate'
import { federate } from '../../src/shared/federate'
import { planRotationOf } from '../../src/renderer/state/shell'
import { formatDim, formatLength, areaIn, areaUnit, volumeIn, volumeUnit, coordIn } from '../../src/shared/units'
import { fixed2, fixed3 } from '../../src/shared/fmt'
import { streamGeometry } from '../../src/worker/geometry-streamer'
import { createReadOnlyIfcSource } from '../../src/worker/ifc-source'
import { buildModelIndex } from '../../src/worker/index-builder'
import type { ModelIndex } from '../../src/shared/model-index.types'
import { boxCentre, boxCorners, boxModel, siteAxes, SITE_TURN_DEG, type BoxSpec } from './synthetic-boxes'

/* ────────────────────────────── the stand-ins ────────────────────────────── */

const h = vi.hoisted(() => ({
  /** Everything the viewer put into its scene — the annotation group among it. */
  added: [] as unknown[],
  labels: [] as { pos: { x: number; y: number; z: number }; html: string; removed: boolean }[],
  materials: null as null | Record<string, unknown>
}))

vi.mock('../../src/renderer/viewer/scene', async () => {
  const loose = (o: Record<string, unknown>): unknown =>
    new Proxy(o, { get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : () => undefined) })
  return {
    createRenderer: () => ({
      backend: 'WebGL2',
      renderer: loose({ render: () => undefined, info: { render: { drawCalls: 0 } }, dispose: () => Promise.resolve() })
    }),
    buildScene: () => loose({ scene: loose({ add: (...o: unknown[]) => void h.added.push(...o) }), scale: 1, groundZ: 0 }),
    glRendererName: () => 'stub',
    sceneScale: () => 1
  }
})
vi.mock('../../src/renderer/viewer/materials', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/viewer/materials')>()
  return {
    ...real,
    createMaterials: (...args: Parameters<typeof real.createMaterials>) => {
      const m = real.createMaterials(...args)
      h.materials = m as unknown as Record<string, unknown>
      return m
    }
  }
})
vi.mock('../../src/renderer/viewer/edges', () => ({
  createEdgeStore: () => ({
    group: {},
    rebuild: () => undefined,
    setSelection: () => undefined,
    addChunk: () => undefined,
    removeModel: () => undefined,
    relabel: () => undefined,
    drawObjects: () => 0,
    dispose: () => undefined
  })
}))
vi.mock('../../src/renderer/viewer/picking', () => ({
  createPicker: () => ({
    rebuild: () => undefined,
    pick: () => null,
    ray: () => null,
    anyHit: () => false,
    size: 0,
    dispose: () => undefined
  })
}))
vi.mock('../../src/renderer/viewer/overlay', async (importOriginal) => ({
  // `toPixels` is the real one: where a label is placed on screen is the camera's arithmetic.
  ...(await importOriginal<typeof import('../../src/renderer/viewer/overlay')>()),
  createLabelOverlay: () => ({
    labels: [],
    labelBase: () => ({}),
    mkLabel: (pos: { x: number; y: number; z: number }, html: string) => {
      const rec = { pos: { x: pos.x, y: pos.y, z: pos.z }, html, removed: false }
      h.labels.push(rec)
      return {
        el: { innerHTML: html, style: {}, title: '', addEventListener: () => undefined },
        pos,
        dx: 0,
        dy: 0,
        on: true,
        remove: () => void (rec.removed = true)
      }
    },
    mkElement: () => ({ style: {}, addEventListener: () => undefined }),
    update: () => undefined,
    updateOcclusion: () => true,
    dispose: () => undefined
  })
}))
vi.mock('../../src/renderer/viewer/snap', () => ({
  createSnapper: () => ({
    on: true,
    setOn: () => undefined,
    hide: () => undefined,
    show: () => undefined,
    snap: () => undefined,
    invalidate: () => undefined,
    dispose: () => undefined
  })
}))
vi.mock('../../src/renderer/viewer/input', () => ({
  attachInput: () => ({ dispose: () => undefined }),
  canvasNdc: () => ({ px: 0, py: 0 })
}))
vi.mock('../../src/renderer/viewer/section', () => ({
  createSection: () => ({
    objects: [],
    current: { grid: null, level: null },
    drawn: 0,
    apply: () => undefined,
    refresh: () => undefined,
    setCut: () => undefined,
    dispose: () => undefined
  })
}))
vi.mock('../../src/renderer/viewer/section-cut', () => ({
  sectionCut: () => ({ segments: new Float32Array(0), count: 0, elements: 0, triangles: 0, models: [] }),
  cutColours: () => new Float32Array(0)
}))

const { createViewer } = await import('../../src/renderer/viewer/viewer-core')
type Viewer = Awaited<ReturnType<typeof createViewer>>
const { metaOf } = await import('../../src/renderer/model/federation-store')
const { geoRows, selectionCard } = await import('../../src/renderer/state/selectors/props')

/* ────────────────────────────── the model ────────────────────────────── */

/** 1 mm, in the metres the scene speaks. */
const MM = 1e-3

/** A wall 6.000 × 0.200 × 3.000 m, square with the building — so diagonal in world axes. */
const WALL: BoxSpec = { name: 'Wall W1', at: [1000, 2000, 0], size: [6000, 200, 3000] }
/** A second wall beside it, for the union: 4.000 × 0.200 × 2.500 m, 3 m along the site's y. */
const WALL2: BoxSpec = { name: 'Wall W2', at: [2000, 5000, 500], size: [4000, 200, 2500] }
/** The union of the two, in the site's frame (mm): 6.000 × 3.200 × 3.000 m. */
const UNION: BoxSpec = { name: 'union', at: [1000, 2000, 0], size: [6000, 3200, 3000] }

interface Loaded {
  index: ModelIndex
  chunks: GeometryChunk[]
  offset: readonly [number, number, number]
  /** Express id of each wall, by name. */
  idOf: Map<string, number>
}

async function load(): Promise<Loaded> {
  const src = await createReadOnlyIfcSource()
  try {
    const bytes = new TextEncoder().encode(boxModel({ name: 'Turned', guidPrefix: '7', boxes: [WALL, WALL2] }))
    const id = src.openFromBuffer(bytes)
    const index = buildModelIndex(src, id, { modelKey: 'TURNED', fileName: 'Turned.ifc', sha256: '' })
    const chunks: GeometryChunk[] = []
    const summary = streamGeometry(src, id, { modelKey: 'TURNED', offset: null, onChunk: (c) => chunks.push(c) })
    src.close(id)
    const idOf = new Map(index.elements.filter((e) => e.name.startsWith('Wall')).map((e) => [e.name, e.expressId]))
    return { index, chunks, offset: summary.offset, idOf }
  } finally {
    src.dispose()
  }
}

/* ────────────────────────────── reading what is drawn ────────────────────────────── */

type V3 = [number, number, number]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a: V3): number => Math.hypot(...a)
const close = (a: V3, b: V3, tol = MM): boolean => len(sub(a, b)) <= tol
const fmt = (p: V3): string => `(${p.map((v) => v.toFixed(4)).join(', ')})`

/** Every line segment in a `LineSegments`, in scene coordinates (its world matrix applied). */
function segmentsOf(obj: LineSegments): [V3, V3][] {
  obj.updateWorldMatrix(true, false)
  const pos = obj.geometry.getAttribute('position')
  const out: [V3, V3][] = []
  const v = new Vector3()
  for (let i = 0; i + 1 < pos.count; i += 2) {
    const a = v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld).toArray() as V3
    const b = v.fromBufferAttribute(pos, i + 1).applyMatrix4(obj.matrixWorld).toArray() as V3
    out.push([a, b])
  }
  return out
}

/** The `LineSegments` drawn with a material, anywhere under what the viewer added to its scene. */
function linesWith(material: unknown): LineSegments[] {
  const out = new Set<LineSegments>()
  // Every rebuilt scene rig is handed the same groups again (`restage`): each object once.
  for (const o of new Set(h.added)) {
    if (!o || typeof (o as Object3D).traverse !== 'function') continue
    ;(o as Object3D).traverse((c) => {
      if (c instanceof LineSegments && c.material === material && c.visible) out.add(c)
    })
  }
  return [...out]
}

interface Drawn {
  /** The selection box's twelve edges, scene coordinates. */
  box: [V3, V3][]
  /** The three dimension runs: the segments whose two ends each carry a tick's midpoint. */
  runs: [V3, V3][]
  /** The live dimension labels. */
  labels: { pos: V3; html: string }[]
}

function drawn(): Drawn {
  const m = h.materials!
  const box = linesWith(m.dimBox).flatMap(segmentsOf)
  const all = linesWith(m.dim).flatMap(segmentsOf)
  const mid = (s: [V3, V3]): V3 => [(s[0][0] + s[1][0]) / 2, (s[0][1] + s[1][1]) / 2, (s[0][2] + s[1][2]) / 2]
  const mids = all.map(mid)
  // A run's ends are where its ticks are centred; a tick's ends are no segment's midpoint.
  const runs = all.filter((s) => [s[0], s[1]].every((end) => mids.some((q) => close(q, end, 1e-6))))
  const labels = h.labels
    .filter((l) => !l.removed)
    .filter((l) => runs.some(([a, b]) => onSegment([l.pos.x, l.pos.y, l.pos.z], a, b)))
    .map((l) => ({ pos: [l.pos.x, l.pos.y, l.pos.z] as V3, html: l.html }))
  return { box, runs, labels }
}

/** True when p lies on the segment a–b (within a micrometre). */
function onSegment(p: V3, a: V3, b: V3): boolean {
  const ab = sub(b, a)
  const t = dot(sub(p, a), ab) / dot(ab, ab)
  if (t < -1e-9 || t > 1 + 1e-9) return false
  return close(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t], 1e-6)
}

/** Every vertex drawn for an element: its parts' `matrix16` applied to their own vertices, scene coordinates. */
function drawnVertices(expressId: number): V3[] {
  const out: V3[] = []
  for (const chunk of loaded.chunks) {
    for (const part of chunk.parts) {
      if (part.elementId !== expressId) continue
      const g = chunk.geoms[part.geomIdx]
      const m = part.matrix16
      for (let v = g.vertexOffset; v < g.vertexOffset + g.vertexCount; v++) {
        const [x, y, z] = [0, 1, 2].map((k) => chunk.positions[v * 3 + k])
        out.push([0, 1, 2].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]) as V3)
      }
    }
  }
  return out
}

/* ────────────────────────────── the viewer ────────────────────────────── */

let loaded: Loaded
let viewer: Viewer
/** ρ, degrees, as the app computes it from the federation. */
let rhoDeg: number
const canvas = {
  style: {},
  parentElement: { clientWidth: 1280, clientHeight: 820 },
  clientWidth: 1280,
  clientHeight: 820,
  addEventListener: () => undefined,
  removeEventListener: () => undefined
}

beforeAll(async () => {
  loaded = await load()
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => undefined)
  vi.stubGlobal('document', { hidden: false, addEventListener: () => undefined, removeEventListener: () => undefined })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    }
  )
  viewer = await createViewer({ canvas: canvas as unknown as HTMLCanvasElement })
  await viewer.addModel('TURNED', 0, loaded.chunks, metaOf(loaded.index, loaded.offset))
  rhoDeg = planRotationOf(federate([loaded.index]))
  viewer.setPlanRotation(rhoDeg)
  viewer.setUnits('mm')
})
afterAll(() => {
  viewer?.dispose()
  vi.unstubAllGlobals()
})

/** A point in the file's world coordinates (m), in the scene the viewer draws: world − offset. */
const scene = (p: V3): V3 => sub(p, loaded.offset as V3)
const wallId = (): number => loaded.idOf.get('Wall W1')!
const wall2Id = (): number => loaded.idOf.get('Wall W2')!

function select(ids: number[]): Drawn {
  viewer.setDims(null, false)
  viewer.setDims(ids, true)
  return drawn()
}

/** The true extents of a box spec, metres, along the site's (the building's) own axes. */
const trueSize = (b: BoxSpec): V3 => b.size.map((v) => v / 1000) as V3

/**
 * Check a drawing against one box spec: the runs, the box, the labels. Returns a readable list of
 * what is wrong, empty when everything is right, so a failure shows the numbers drawn.
 */
function problems(d: Drawn, b: BoxSpec, unit: 'mm' | 'm' = 'mm'): string[] {
  const out: string[] = []
  const axes = siteAxes()
  const size = trueSize(b)
  const off = dimOffset(size[0], size[1], size[2])
  const corners = boxCorners(b).map(scene)
  const min = corners[0]
  /** A scene point in the building's frame: metres from the box's min corner along its own axes. */
  const local = (p: V3): V3 => axes.map((a) => dot(sub(p, min), a)) as V3

  // 1. Three runs, each along one of the building's axes, as long as the box is along it, from
  //    face to face, and standing the design's stand-off off the box — in the building's frame
  //    the design's own layout (`annotations.ts` L440–483): X at (y = min − off, z = min), Y at
  //    (x = max + off, z = min), Z at (x = min − off, y = min − off).
  if (d.runs.length !== 3) out.push(`${d.runs.length} dimension runs drawn, not 3`)
  const want: Record<number, (q: V3) => [number, number]> = {
    0: (q) => [q[1] - -off, q[2] - 0],
    1: (q) => [q[0] - (size[0] + off), q[2] - 0],
    2: (q) => [q[0] - -off, q[1] - -off]
  }
  const seen = new Set<number>()
  for (const [a, bb] of d.runs) {
    const v = sub(bb, a)
    const k = [0, 1, 2].reduce((best, i) => (Math.abs(dot(v, axes[i])) > Math.abs(dot(v, axes[best])) ? i : best), 0)
    seen.add(k)
    const along = Math.abs(dot(v, axes[k]))
    const across = len(sub(v, axes[k].map((x) => x * dot(v, axes[k])) as V3))
    const la = local(a)
    const lb = local(bb)
    const ends = [la[k], lb[k]].sort((p, q) => p - q)
    const tag = `run ${'XYZ'[k]} ${fmt(a)} → ${fmt(bb)}`
    if (Math.abs(len(v) - size[k]) > MM) out.push(`${tag}: ${len(v).toFixed(4)} m long, the element is ${size[k].toFixed(4)} m along it`)
    if (across > MM) out.push(`${tag}: ${(across * 1000).toFixed(1)} mm off parallel to the element's ${'XYZ'[k]} axis over ${along.toFixed(3)} m`)
    if (Math.abs(ends[0]) > MM || Math.abs(ends[1] - size[k]) > MM)
      out.push(`${tag}: its ends project to ${ends.map((e) => e.toFixed(4)).join(' / ')} m on the element's axis, its faces are at 0 / ${size[k].toFixed(4)}`)
    for (const q of [la, lb]) {
      const [e1, e2] = want[k](q)
      if (Math.abs(e1) > MM || Math.abs(e2) > MM)
        out.push(`${tag}: stands ${(e1 * 1000).toFixed(1)} / ${(e2 * 1000).toFixed(1)} mm from the design's stand-off of ${(off * 1000).toFixed(1)} mm off the face`)
    }
  }
  if (seen.size !== 3) out.push(`the runs lie along axes ${[...seen].map((k) => 'XYZ'[k]).join('')}, not X, Y and Z`)

  // 2. The selection box's eight corners are the element's eight corners.
  const boxPts = d.box.flat().filter((p, i, all) => all.findIndex((q) => close(p, q, 1e-9)) === i)
  for (const c of corners) if (!boxPts.some((p) => close(p, c))) out.push(`no selection-box corner at the element's corner ${fmt(c)}`)
  for (const p of boxPts) if (!corners.some((c) => close(p, c))) out.push(`a selection-box corner ${fmt(p)} is no corner of the element`)

  // 3. The labels read the true extents, in the app's own formatter.
  const texts = d.labels.map((l) => l.html).sort()
  const wantTexts = size.map((s) => formatDim(s, unit)).sort()
  if (JSON.stringify(texts) !== JSON.stringify(wantTexts)) out.push(`labels read ${JSON.stringify(texts)}, the element's extents are ${JSON.stringify(wantTexts)}`)
  return out
}

/* ────────────────────────────── the checks ────────────────────────────── */

describe('the fixture: a box-shaped wall square with a building turned −43.4103° in the world', () => {
  it('ρ is the building’s turn, and the wall’s world-axis extents are far from its true ones', () => {
    expect(rhoDeg).not.toBe(0)
    expect(Math.abs(rhoDeg - SITE_TURN_DEG)).toBeLessThan(1e-6)
    const corners = boxCorners(WALL)
    const world = [0, 1, 2].map((k) => Math.max(...corners.map((c) => c[k])) - Math.min(...corners.map((c) => c[k])))
    const [x, y, z] = trueSize(WALL)
    // ~4.50 × 4.27 × 3.00 against 6.00 × 0.20 × 3.00: no test below can pass on the world box.
    expect(Math.abs(world[0] - x)).toBeGreaterThan(1)
    expect(Math.abs(world[1] - y)).toBeGreaterThan(1)
    expect(Math.abs(world[2] - z)).toBeLessThan(MM)
    // The element the viewer holds is the file's: its world-axis box is that one.
    const b = viewer.elementBox(wallId())!
    const want = [0, 1, 2].map((k) => Math.min(...corners.map((c) => scene(c)[k])))
    expect(close(b.min.toArray() as V3, want as V3)).toBe(true)
    // And what is drawn of it — each part's Float32 `matrix16` applied to its own vertices — has
    // exactly the file's eight corners: "the element's drawn vertices" and the file's corners
    // are one set, so the checks below may compare against either.
    const drawnPts = drawnVertices(wallId())
    for (const c of corners.map(scene)) expect(drawnPts.some((p) => close(p, c)), `no drawn vertex at ${fmt(c)}`).toBe(true)
    for (const p of drawnPts) expect(corners.map(scene).some((c) => close(p, c)), `drawn vertex ${fmt(p)} is no corner`).toBe(true)
  })
})

describe('one element selected, ρ ≠ 0: the box and the runs are the element’s own', () => {
  it('three runs, each the element’s true extent along its own axis, face to face, at the design’s stand-off; the box on its corners; labels in mm', () => {
    viewer.setUnits('mm')
    expect(problems(select([wallId()]), WALL)).toEqual([])
  })

  it('the labels follow the display unit: m', () => {
    viewer.setUnits('m')
    try {
      expect(problems(select([wallId()]), WALL, 'm')).toEqual([])
    } finally {
      viewer.setUnits('mm')
    }
  })
})

describe('two elements selected: the box is their union in the plan frame', () => {
  it('reads 6.000 × 3.200 × 3.000 m, the two walls’ combined extents square with the building', () => {
    expect(problems(select([wallId(), wall2Id()]), UNION)).toEqual([])
  })
})

describe('viewer.elementPlanBox (NOT YET IN src/)', () => {
  it('returns ρ in radians and the element’s true extents', () => {
    // NOT YET IN src/: `elementPlanBox` — the interface the fix adds.
    const got = viewer.elementPlanBox(wallId())
    expect(got).not.toBeNull()
    expect(Math.abs(got!.rho - (rhoDeg * Math.PI) / 180)).toBeLessThan(1e-12)
    const size = got!.box.getSize(new Vector3()).toArray() as V3
    expect(close(size, trueSize(WALL)), `plan box size ${fmt(size)}`).toBe(true)
    // In the plan frame: the scene turned by −ρ about the scene origin.
    const c = scene(boxCentre(WALL))
    const r = -got!.rho
    const planCentre: V3 = [c[0] * Math.cos(r) - c[1] * Math.sin(r), c[0] * Math.sin(r) + c[1] * Math.cos(r), c[2]]
    expect(close(got!.box.getCenter(new Vector3()).toArray() as V3, planCentre)).toBe(true)
  })

  it('is null for an element with no geometry', () => {
    // NOT YET IN src/: `elementPlanBox`.
    expect(viewer.elementPlanBox(999_999)).toBeNull()
  })
})

describe('ρ = 0 changes nothing (guard)', () => {
  it('elementPlanBox is elementBox exactly, with rho 0', () => {
    viewer.setPlanRotation(0)
    try {
      const b = viewer.elementBox(wallId())!
      // NOT YET IN src/: `elementPlanBox`.
      const plan = viewer.elementPlanBox(wallId())
      expect(plan?.rho).toBe(0)
      expect(plan?.box.min.toArray()).toEqual(b.min.toArray())
      expect(plan?.box.max.toArray()).toEqual(b.max.toArray())
    } finally {
      viewer.setPlanRotation(rhoDeg)
    }
  })

  it('the dimension lines and labels at ρ = 0 are the world-axis box’s, as the design draws them (L440–483)', () => {
    viewer.setPlanRotation(0)
    try {
      const d = select([wallId()])
      const b = viewer.elementBox(wallId())!
      const mn = b.min
      const mx = b.max
      const size = new Vector3().subVectors(mx, mn)
      const off = dimOffset(size.x, size.y, size.z)
      const t = off * 0.3
      const f = (v: Vector3): V3 => [Math.fround(v.x), Math.fround(v.y), Math.fround(v.z)]
      const key = (s: [V3, V3]): string => s.map((p) => p.join(',')).sort().join(' | ')
      const corner = (i: number): Vector3 => new Vector3(i & 1 ? mx.x : mn.x, i & 2 ? mx.y : mn.y, i & 4 ? mx.z : mn.z)
      const E = [0, 1, 1, 3, 3, 2, 2, 0, 4, 5, 5, 7, 7, 6, 6, 4, 0, 4, 1, 5, 3, 7, 2, 6]
      const wantBox: [V3, V3][] = []
      for (let i = 0; i < E.length; i += 2) wantBox.push([f(corner(E[i])), f(corner(E[i + 1]))])
      const V = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z)
      const runs = [
        { a: V(mn.x, mn.y - off, mn.z), b: V(mx.x, mn.y - off, mn.z), tick: V(0, t, 0), v: size.x },
        { a: V(mx.x + off, mn.y, mn.z), b: V(mx.x + off, mx.y, mn.z), tick: V(t, 0, 0), v: size.y },
        { a: V(mn.x - off, mn.y - off, mn.z), b: V(mn.x - off, mn.y - off, mx.z), tick: V(t, 0, 0), v: size.z }
      ]
      const wantDim: [V3, V3][] = runs.flatMap((r) => [
        [f(r.a), f(r.b)] as [V3, V3],
        [f(r.a.clone().sub(r.tick)), f(r.a.clone().add(r.tick))] as [V3, V3],
        [f(r.b.clone().sub(r.tick)), f(r.b.clone().add(r.tick))] as [V3, V3]
      ])
      const gotDim = linesWith(h.materials!.dim).flatMap(segmentsOf)
      expect(d.box.map(key).sort()).toEqual(wantBox.map(key).sort())
      expect(gotDim.map(key).sort()).toEqual(wantDim.map(key).sort())
      expect(d.labels.map((l) => l.html).sort()).toEqual(runs.map((r) => formatDim(r.v, 'mm')).sort())
    } finally {
      viewer.setPlanRotation(rhoDeg)
    }
  })
})

describe('the property card’s geometry rows, given the plan box and ρ', () => {
  const COORDS = { E: 0, N: 0, Z: 0, angle: 0 }
  /** The wall's plan-frame box, from the file's numbers: its scene corners turned by −ρ. */
  function planBoxOf(b: BoxSpec, rho: number): Box3 {
    const r = -rho
    const pts = boxCorners(b)
      .map(scene)
      .map((c) => new Vector3(c[0] * Math.cos(r) - c[1] * Math.sin(r), c[0] * Math.sin(r) + c[1] * Math.cos(r), c[2]))
    return new Box3().setFromPoints(pts)
  }

  it('Bounding box, Footprint and Box volume read the true sizes; Centroid is the wall’s true world centre', () => {
    const rho = (rhoDeg * Math.PI) / 180
    const box = planBoxOf(WALL, rho)
    // NOT YET IN src/: the sixth argument, `rho`.
    const rows = geoRows(box, 1, COORDS, loaded.offset as V3, 'mm', rho)
    const [x, y, z] = trueSize(WALL)
    const c = boxCentre(WALL)
    const byKey = Object.fromEntries(rows.map((r) => [r.k, r.v]))
    expect(byKey['Bounding box']).toBe(`${formatLength(x, 'mm')} × ${formatLength(y, 'mm')} × ${formatLength(z, 'mm')}`)
    expect(byKey['Footprint']).toBe(fixed2(areaIn(x * y, 'mm')) + ' ' + areaUnit('mm'))
    expect(byKey['Box volume']).toBe(fixed3(volumeIn(x * y * z, 'mm')) + ' ' + volumeUnit('mm'))
    expect(byKey['Centroid']).toBe(`${fixed3(coordIn(c[0], 'mm'))} E · ${fixed3(coordIn(c[1], 'mm'))} N · ${fixed3(coordIn(c[2], 'mm'))} Z`)
  })

  it('through the card: SelectionInput.rho', () => {
    const rho = (rhoDeg * Math.PI) / 180
    const fed = federate([loaded.index])
    const element = fed.elements.find((e) => e.name === 'Wall W1')!
    const card = selectionCard({
      federation: fed,
      element,
      box: planBoxOf(WALL, rho),
      solids: 1,
      coords: COORDS,
      offset: loaded.offset as V3,
      units: 'mm',
      // NOT YET IN src/: `SelectionInput.rho`.
      rho
    })
    const c = boxCentre(WALL)
    const centroid = card!.geoRows.find((r) => r.k === 'Centroid')!.v
    expect(centroid).toBe(`${fixed3(coordIn(c[0], 'mm'))} E · ${fixed3(coordIn(c[1], 'mm'))} N · ${fixed3(coordIn(c[2], 'mm'))} Z`)
  })

  it('with ρ omitted or 0, every row is byte-identical to the five-argument form (guard)', () => {
    const box = viewer.elementBox(wallId())!
    const five = geoRows(box, 1, COORDS, loaded.offset as V3, 'mm')
    // NOT YET IN src/: the sixth argument, `rho`.
    expect(geoRows(box, 1, COORDS, loaded.offset as V3, 'mm', 0)).toEqual(five)
    // And the five-argument form is today's: the world-axis box, its own centre.
    const mn = box.min.toArray() as V3
    const mx = box.max.toArray() as V3
    const cx = (mn[0] + mx[0]) / 2 + loaded.offset[0]
    expect(five.find((r) => r.k === 'Centroid')!.v.startsWith(`${fixed3(coordIn(cx, 'mm'))} E`)).toBe(true)
  })
})
