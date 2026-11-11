/**
 * The assistant's box tools agree with the property card on a building turned in the world —
 * "option A", owner-approved 2026-11-11.
 *
 * The property card's geometry rows read `viewer.elementPlanBox(id)` — the element's box in the
 * plan frame, square with the building (`selection-dims-plan-frame.test.ts`). `get_element`,
 * `measure_between` and `find_nearby` still read `IfcElement.bbox`, the world-axis box, so on a
 * building turned −43.4103° a 6.0 × 0.1 m wall reads 4.4 × 4.2 m to the assistant while the card
 * says 6.0 × 0.1, and two walls a metre apart "overlap". The fix keeps `bbox` and its keys, and
 * adds the plan-frame box beside it (`model/plan-boxes.ts`, `planFrameOf(state.planRotationDeg,
 * state.offset, getViewer())`) — plan coordinates being a world point turned by −ρ about the
 * world origin, which is the viewer's plan box plus the offset turned the same way.
 *
 * Driven through the **real** `viewer-core.ts` and `batches.ts` on a model streamed through the
 * real `streamGeometry` from an IFC written on the synthetic site (`synthetic-boxes.ts`), with the
 * federation offset tens of kilometres out as the streamer chooses it, and the tools through the
 * real `executeTool` and store. The stand-ins are the harness of `selection-dims-plan-frame.test.ts`
 * (only what needs a GPU or a DOM). Every expected number is the file's own (`BoxSpec`, `boxCentre`)
 * or hand arithmetic on it — and, where it says so, the viewer's own box, which is the card's.
 *
 * `NOT YET IN src/`: `get_element`'s `planBox…` keys and `planRotationDeg`; `measure_between`'s and
 * `find_nearby`'s plan frame; `nearbyElementsBrute`'s fourth argument, `boxOf`.
 */
import { Vector3 } from 'three/webgpu'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { GeometryChunk } from '../../src/shared/geometry-contract.types'
import { federate, type FederatedElement, type Federation } from '../../src/shared/federate'
import { streamGeometry } from '../../src/worker/geometry-streamer'
import { createReadOnlyIfcSource } from '../../src/worker/ifc-source'
import { buildModelIndex } from '../../src/worker/index-builder'
import type { ModelIndex } from '../../src/shared/model-index.types'
import { elementBoxes } from '../../src/renderer/model/element-boxes'
import { nearbyElementsBrute } from '../../src/renderer/ai/analysis'
import { boxCentre, boxModel, SITE_TURN_DEG, type BoxSpec } from './synthetic-boxes'

/* ────────────────────────────── the stand-ins (as selection-dims-plan-frame.test.ts) ────────────────────────────── */

vi.mock('../../src/renderer/viewer/scene', async () => {
  const loose = (o: Record<string, unknown>): unknown =>
    new Proxy(o, { get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : () => undefined) })
  return {
    createRenderer: () => ({
      backend: 'WebGL2',
      renderer: loose({ render: () => undefined, info: { render: { drawCalls: 0 } }, dispose: () => Promise.resolve() })
    }),
    buildScene: () => loose({ scene: loose({ add: () => undefined }), scale: 1, groundZ: 0 }),
    glRendererName: () => 'stub',
    sceneScale: () => 1
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
  ...(await importOriginal<typeof import('../../src/renderer/viewer/overlay')>()),
  createLabelOverlay: () => ({
    labels: [],
    labelBase: () => ({}),
    mkLabel: (pos: unknown, html: string) => ({
      el: { innerHTML: html, style: {}, title: '', addEventListener: () => undefined },
      pos,
      dx: 0,
      dy: 0,
      on: true,
      remove: () => undefined
    }),
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
const { useShell, setViewer } = await import('../../src/renderer/state/shell')
const { executeTool, newTurnState } = await import('../../src/renderer/ai/executors')
const { resetShell } = await import('./stub-viewer')

/* ────────────────────────────── the model ────────────────────────────── */

const MM = 1e-3
type V3 = [number, number, number]
type B6 = [number, number, number, number, number, number]

/**
 * Four box walls, square with the building (so diagonal in world axes), mm in the site's frame:
 *   WA 6.0 × 0.2 × 3.0 · WB parallel, 1.000 m clear of WA along the building's y ·
 *   WC parallel, 4.000 m from WA · WD 0.2 × 1.4, 1.000 m clear of WA's end along the building's x.
 */
const WA: BoxSpec = { name: 'Wall A', at: [0, 0, 0], size: [6000, 200, 3000] }
const WB: BoxSpec = { name: 'Wall B', at: [0, 1200, 0], size: [6000, 200, 3000] }
const WC: BoxSpec = { name: 'Wall C', at: [0, 4200, 0], size: [6000, 200, 2500] }
const WD: BoxSpec = { name: 'Wall D', at: [7000, 0, 500], size: [200, 1400, 2500] }
const WALLS = [WA, WB, WC, WD]

let index: ModelIndex
let chunks: GeometryChunk[]
let offset: V3
let fed: Federation
let viewer: Viewer
let rhoDeg: number
const idOf = new Map<string, number>()

const canvas = {
  style: {},
  parentElement: { clientWidth: 1280, clientHeight: 820 },
  clientWidth: 1280,
  clientHeight: 820,
  addEventListener: () => undefined,
  removeEventListener: () => undefined
}

beforeAll(async () => {
  const src = await createReadOnlyIfcSource()
  try {
    const id = src.openFromBuffer(new TextEncoder().encode(boxModel({ name: 'Turned', guidPrefix: '7', boxes: WALLS })))
    index = buildModelIndex(src, id, { modelKey: 'TURNED', fileName: 'Turned.ifc', sha256: '' })
    chunks = []
    const summary = streamGeometry(src, id, { modelKey: 'TURNED', offset: null, onChunk: (c) => chunks.push(c) })
    src.close(id)
    offset = [...summary.offset] as V3
  } finally {
    src.dispose()
  }
  // The boxes onto the index, as `FederationController.prepare` writes them.
  const geometry = elementBoxes(chunks, offset)
  for (const e of index.elements) {
    const g = geometry.get(e.id)
    if (g) {
      e.bbox = g.box
      e.solidCount = g.parts
    }
  }
  fed = federate([index])
  for (const e of fed.elements) if (e.name.startsWith('Wall')) idOf.set(e.name, e.id)

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
  await viewer.addModel('TURNED', 0, chunks, metaOf(index, offset))

  resetShell()
  setViewer(null)
  useShell.getState().setOffset(offset)
  useShell.getState().commitModels(fed)
  rhoDeg = useShell.getState().planRotationDeg
  viewer.setPlanRotation(rhoDeg)
  setViewer(viewer)
})
afterAll(() => {
  setViewer(null)
  viewer?.dispose()
  vi.unstubAllGlobals()
})

interface Body {
  message?: string
  [key: string]: unknown
}
const turn = newTurnState()
const run = async (name: string, input: unknown): Promise<Body> =>
  (await executeTool(name, input, {
    state: () => useShell.getState(),
    sql: async () => ({ columns: [], rows: [], truncated: false, ms: 0 }),
    rawLine: async () => null,
    turn
  })) as Body

const wall = (b: BoxSpec): FederatedElement => fed.byId.get(idOf.get(b.name)!)!
const trueSize = (b: BoxSpec): V3 => b.size.map((v) => v / 1000) as V3

/**
 * An element's plan-coordinate box, by hand: the viewer's own plan box (scene turned by −ρ) plus
 * the federation offset turned by −ρ. `null` when the viewer has none.
 */
function planBoxByHand(e: FederatedElement): B6 | null {
  const got = viewer.elementPlanBox(e.id)
  if (!got) return null
  const r = got.rho
  const t = [offset[0] * Math.cos(r) + offset[1] * Math.sin(r), -offset[0] * Math.sin(r) + offset[1] * Math.cos(r), offset[2]]
  const { min, max } = got.box
  return [min.x + t[0], min.y + t[1], min.z + t[2], max.x + t[0], max.y + t[1], max.z + t[2]]
}

/* ────────────────────────────── the fixture ────────────────────────────── */

describe('the fixture (passes today)', () => {
  it('ρ is the building’s turn, the offset is far out, and every wall’s world box is far from its true size', () => {
    expect(Math.abs(rhoDeg - SITE_TURN_DEG)).toBeLessThan(1e-6)
    expect(Math.hypot(offset[0], offset[1])).toBeGreaterThan(10_000)
    for (const b of [WA, WB, WC]) {
      const w = wall(b).bbox!
      expect(Math.abs(w[3] - w[0] - trueSize(b)[0]), b.name).toBeGreaterThan(1)
    }
  })

  it('the card’s source, viewer.elementPlanBox, has each wall’s true size', () => {
    for (const b of WALLS) {
      const size = viewer.elementPlanBox(wall(b).id)!.box.getSize(new Vector3()).toArray()
      expect(size.map((v, k) => Math.abs(v - trueSize(b)[k]) < MM), b.name).toEqual([true, true, true])
    }
  })

  it('with world boxes, WA and WB overlap although they stand a metre apart', () => {
    const a = wall(WA).bbox!
    const b = wall(WB).bbox!
    const gaps = [0, 1, 2].map((k) => Math.max(b[k] - a[k + 3], a[k] - b[k + 3]))
    expect(gaps.every((g) => g < 0)).toBe(true)
  })

  it('with world boxes, find_nearby’s reference reads WC within 1.5 m of WA, which it is not', () => {
    const pool = fed.elements.filter((e) => e.type !== 'IfcSpace')
    const ids = nearbyElementsBrute(pool, [wall(WA)], 1.5).map((n) => n.el.id)
    expect(ids).toContain(wall(WC).id)
  })
})

/* ────────────────────────────── 1. agrees with the card ────────────────────────────── */

describe('get_element agrees with the property card (NOT YET IN src/)', () => {
  for (const b of WALLS) {
    it(`${b.name}: planBoxSizeMetres is its true size and the card’s; planBoxCentreMetres its true centre`, async () => {
      const e = wall(b)
      const body = await run('get_element', { id: e.id })
      const size = body.planBoxSizeMetres as { x: number; y: number; z: number } | undefined
      expect(size, 'no planBoxSizeMetres').toBeDefined()
      const want = trueSize(b)
      expect([size!.x, size!.y, size!.z].map((v, k) => Math.abs(v - want[k]) < MM)).toEqual([true, true, true])
      // The card's own number. Not bit-exact: the plan box is the viewer's box *moved by the turned
      // offset* (tens of kilometres), and (max + t) − (min + t) rounds — a nanometre is the bound.
      const card = viewer.elementPlanBox(e.id)!.box.getSize(new Vector3())
      expect(Math.abs(size!.x - card.x)).toBeLessThan(1e-9)
      expect(Math.abs(size!.y - card.y)).toBeLessThan(1e-9)
      expect(Math.abs(size!.z - card.z)).toBeLessThan(1e-9)
      // The volume is held to the card's own box, not to the file's exact volume: that box is taken
      // from Float32 vertices and is already ~1e-6 m³ off the true volume. (a) It is the card's box
      // volume, to a relative 1e-9. (b) It is within what the Done line's 1 mm a side allows:
      // (a+e)(b+e)(c+e) − abc = e(ab+bc+ca) + e²(a+b+c) + e³, with e = 1 mm.
      const vol = body.planBoxVolumeM3 as number
      const cardVol = card.x * card.y * card.z
      expect(Math.abs(vol - cardVol)).toBeLessThanOrEqual(1e-9 * cardVol)
      const [sa, sb, sc] = want
      const bound = MM * (sa * sb + sb * sc + sc * sa) + MM * MM * (sa + sb + sc) + MM ** 3
      expect(Math.abs(vol - sa * sb * sc)).toBeLessThanOrEqual(bound)
      // The centre, back in world metres: the file's own.
      const c = body.planBoxCentreMetres as { x: number; y: number; z: number }
      const wc = boxCentre(b)
      expect([c.x - wc[0], c.y - wc[1], c.z - wc[2]].map((d) => Math.abs(d) < MM)).toEqual([true, true, true])
      expect('planBoxCentreMap' in body).toBe(true)
      expect(body.planBoxCentreMap).toEqual(body.boxCentreMap === null ? null : expect.anything())
      expect((body.planRotationDeg as number).toFixed(4)).toBe('-43.4103')
      expect(String(body.planBoxMethod)).toMatch(/square with the building|building['’]s own axes|plan frame/i)
      // The world keys still describe the world box.
      expect(body.bboxMetres).toEqual(e.bbox)
      expect(body.bboxFrame).toBe('world')
      const ws = body.boxSizeMetres as { x: number; y: number; z: number }
      expect(ws.x).toBe(e.bbox![3] - e.bbox![0])
      expect(ws.y).toBe(e.bbox![4] - e.bbox![1])
    })
  }
})

/* ────────────────────────────── 3. gaps and neighbours ────────────────────────────── */

describe('measure_between and find_nearby read the turned walls square with the building (NOT YET IN src/)', () => {
  it('WA to WB: 1.000 m clear, no overlap, in the plan frame', async () => {
    const body = await run('measure_between', { a: wall(WA).id, b: wall(WB).id })
    expect(body.boxesOverlap, body.message).toBe(false)
    expect(Math.abs((body.boxClearanceMetres as number) - 1)).toBeLessThan(MM)
    expect(body.frame).toBe('plan')
    expect((body.planRotationDeg as number).toFixed(4)).toBe('-43.4103')
    expect(String(body.method)).toMatch(/square with the building|building['’]s own axes|plan frame/i)
    expect(String(body.method)).toContain('not solid geometry')
    // aBoxMetres / bBoxMetres are the plan boxes: 6.0 m along the building.
    const a = body.aBoxMetres as B6
    expect(Math.abs(a[3] - a[0] - 6)).toBeLessThan(MM)
    expect(Math.abs(a[4] - a[1] - 0.2)).toBeLessThan(MM)
    const hand = planBoxByHand(wall(WA))!
    expect(a.map((v, k) => Math.abs(v - hand[k]) < 1e-6)).toEqual([true, true, true, true, true, true])
  })

  it('WA to WD: 1.000 m clear along the building’s x', async () => {
    const body = await run('measure_between', { a: wall(WA).id, b: wall(WD).id })
    expect(body.boxesOverlap, body.message).toBe(false)
    expect(Math.abs((body.boxClearanceMetres as number) - 1)).toBeLessThan(MM)
  })

  it('find_nearby round WA at 1.5 m: WB and WD at 1.000 m, and the reference over the same plan boxes', async () => {
    const body = await run('find_nearby', { id: wall(WA).id, distance: 1.5, limit: 100 })
    type N = { id: number; gapMetres: number }
    const got = new Map((body.neighbours as N[]).map((n) => [n.id, n.gapMetres]))
    expect([...got.keys()].sort(), body.message).toEqual([wall(WB).id, wall(WD).id].sort())
    for (const g of got.values()) expect(Math.abs(g - 1)).toBeLessThan(MM)
    expect(body.frame).toBe('plan')
    expect((body.planRotationDeg as number).toFixed(4)).toBe('-43.4103')
    // NOT YET IN src/: `nearbyElementsBrute`'s fourth argument.
    const pool = fed.elements.filter((e) => e.type !== 'IfcSpace')
    const ref = nearbyElementsBrute(pool, [wall(WA)], 1.5, planBoxByHand)
    expect(ref.map((n) => n.el.id).sort()).toEqual([...got.keys()].sort())
    for (const n of ref) expect(Math.abs(got.get(n.el.id)! - n.gap)).toBeLessThan(1e-9)
  })
})

/* ────────────────────────────── ρ = 0 on the same model ────────────────────────────── */

describe('ρ = 0 on the same model: no plan keys, the world frame (passes today)', () => {
  it('get_element, measure_between and find_nearby read the world box, as today', async () => {
    const before = useShell.getState().planRotationDeg
    useShell.setState({ planRotationDeg: 0 })
    viewer.setPlanRotation(0)
    try {
      const g = await run('get_element', { id: wall(WA).id })
      expect(Object.keys(g).filter((k) => /^plan/.test(k))).toEqual([])
      const m = await run('measure_between', { a: wall(WA).id, b: wall(WB).id })
      expect(m.frame).toBe('world')
      expect(m.boxesOverlap).toBe(true)
      const f = await run('find_nearby', { id: wall(WA).id, distance: 1.5 })
      expect(f.frame).toBe('world')
    } finally {
      useShell.setState({ planRotationDeg: before })
      viewer.setPlanRotation(before)
    }
  })
})

