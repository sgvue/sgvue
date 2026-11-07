/**
 * Render on demand, headless (core protection, plan item 7): **the real `viewer-core.ts`**, with
 * everything that needs a GPU or a DOM — the renderer, the scene rig, the batch and edge stores,
 * the picker, the overlay, the annotation layer, the section visuals, the camera rig — replaced
 * by counting stand-ins, and `requestAnimationFrame` driven by hand.
 *
 * CLAUDE.md: "anything that changes what is drawn must call `invalidate()`. The frame loop draws
 * on demand." So the loop is run until it is idle, one member is called, and the loop is run
 * again: a **setter** must draw exactly the frames one `invalidate()` asks for — none is a stale
 * view, more is a loop that never settles — and must do the expensive passes `viewer.batch`
 * coalesces (a repaint of every element, an edge-index rebuild, a picker rebuild) exactly as
 * often as `viewer-contract.ts` says, which is what `shell-viewer-batch.test.ts` charges the
 * store's calls with. Every member of the object `createViewer` returns must be in that contract,
 * so a new setter without a line there fails here.
 */
import { Box3, Vector3 } from 'three/webgpu'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SETTERS, VIEWER_MEMBERS, type Work } from './viewer-contract'
import type { Viewer } from '../../src/renderer/viewer/viewer-core'

/**
 * The counters, and what the viewer handed its collaborators. Hoisted, because the module mocks
 * below are, and they write here.
 */
const h = vi.hoisted(() => ({
  renders: 0,
  edges: 0,
  picker: 0,
  /** Repaints of the sentinel element — one per `applyAll`, since nothing else touches it. */
  sentinelPaints: 0,
  /** The section layer's `setClips`, so a test can make a plane cut as `section.ts` does. */
  setClips: null as null | ((planes: unknown[]) => void),
  /** The annotation layer's `invalidate`, which its own spot-tag toggle calls. */
  annotationsInvalidate: null as null | (() => void),
  elements: new Map<number, unknown>()
}))

/** A stand-in: the members a test names, and a no-op function for every other key. */
vi.mock('../../src/renderer/viewer/scene', async () => {
  const { Box3: B } = await import('three/webgpu')
  const loose = (o: Record<string, unknown>): unknown =>
    new Proxy(o, {
      get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : () => undefined)
    })
  return {
    createRenderer: () => ({
      backend: 'WebGL2',
      renderer: loose({
        render: () => void h.renders++,
        info: { render: { drawCalls: 0 } },
        dispose: () => Promise.resolve()
      })
    }),
    buildScene: () => loose({ scene: loose({}), scale: 1, groundZ: 0 }),
    glRendererName: () => 'stub',
    sceneScale: (b: InstanceType<typeof B>) => (b.isEmpty() ? 1 : 1)
  }
})
vi.mock('../../src/renderer/viewer/materials', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/viewer/materials')>()
  return {
    ...real,
    createMaterials: () => ({
      theme: { accent: '#35C4B6' },
      clip: [],
      setTheme: () => undefined,
      setClip: () => undefined,
      clearClip: () => undefined,
      dispose: () => undefined
    })
  }
})
vi.mock('../../src/renderer/viewer/batches', async () => {
  const { Box3: B } = await import('three/webgpu')
  return {
    createBatchStore: () => ({
      elements: h.elements,
      bbox: new B(),
      slots: [],
      vertices: 0,
      group: {},
      castShadows: () => undefined,
      setGhostActive: () => undefined,
      setPartState: (rec: { id: number }) => {
        if (rec.id === 5) h.sentinelPaints++
      },
      addChunk: () => undefined,
      removeModel: () => [],
      finishModel: () => undefined,
      relabel: () => undefined,
      drawObjects: () => 0,
      dispose: () => undefined
    })
  }
})
vi.mock('../../src/renderer/viewer/edges', () => ({
  createEdgeStore: () => ({
    group: {},
    rebuild: () => void h.edges++,
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
    rebuild: () => void h.picker++,
    pick: () => null,
    ray: () => null,
    anyHit: () => false,
    size: 0,
    dispose: () => undefined
  })
}))
vi.mock('../../src/renderer/viewer/part-state', () => ({
  createPartState: () => ({ flush: () => false, reset: () => undefined, dispose: () => undefined, count: 0 })
}))
vi.mock('../../src/renderer/viewer/overlay', () => ({
  createLabelOverlay: () => ({
    labels: [],
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
  createSection: (deps: { setClips: (p: unknown[]) => void }) => {
    h.setClips = deps.setClips
    return {
      objects: [],
      current: { grid: null, level: null },
      drawn: 0,
      apply: () => undefined,
      refresh: () => undefined,
      setCut: () => undefined,
      dispose: () => undefined
    }
  }
}))
vi.mock('../../src/renderer/viewer/section-cut', () => ({
  sectionCut: () => ({ segments: new Float32Array(0), count: 0, elements: 0, triangles: 0, models: [] }),
  cutColours: () => new Float32Array(0)
}))
vi.mock('../../src/renderer/viewer/annotations', () => ({
  createAnnotations: (deps: { invalidate: () => void }) => {
    h.annotationsInvalidate = deps.invalidate
    const noop = (): undefined => undefined
    return {
      group: {},
      measureCount: 0,
      // `annotations.ts` `setExpanded`: the tag redraws itself and asks for its own frame.
      showSpot: () => {
        deps.invalidate()
        return 'expanded'
      },
      gridDimsStale: () => false,
      drawObjects: () => 0,
      debug: () => ({}),
      ...Object.fromEntries(
        [
          'addSpot', 'addLaser', 'clearPreview', 'previewLaser', 'drawDims', 'placeGridDims',
          'updateGridView', 'setCoords', 'setUnits', 'setDims', 'setGrids', 'setLevels',
          'clearMeasures', 'clearSpots', 'dropMeasure', 'dropSpot', 'rebuild', 'dispose'
        ].map((k) => [k, noop])
      )
    }
  }
}))
vi.mock('../../src/renderer/viewer/camera', async () => {
  const { Vector3: V } = await import('three/webgpu')
  return {
    dirOf: () => undefined,
    createCameraRig: () => {
      const state = { theta: 0.5, phi: 1, dist: 10, half: 5, target: [0, 0, 0], proj: 'persp' }
      return {
        camera: { quaternion: {}, position: new V() },
        cur: { theta: 0.5, phi: 1 },
        goal: { theta: 0.5, phi: 1, target: new V(), dist: 10, half: 5 },
        projection: 'persp',
        // At rest: a frame is drawn only when something asked for one.
        tick: () => false,
        getCamera: () => state,
        ...Object.fromEntries(
          [
            'setAspect', 'place', 'orbit', 'pan', 'dolly', 'fitBox', 'fly', 'setView', 'viewDir',
            'setAngles', 'setProjection', 'setCamera', 'easeIn'
          ].map((k) => [k, () => undefined])
        )
      }
    }
  }
})

const { createViewer } = await import('../../src/renderer/viewer/viewer-core')

/** `viewer-core.ts`'s `EXTRA_FRAMES`: one `invalidate()` draws this many frames, then rests. */
const FRAMES_PER_INVALIDATE = 2

let queue: ((now: number) => void)[] = []
let clock = 0
/** Run the frame loop for a while — far longer than any one request should keep it drawing. */
function run(frames = 12): void {
  for (let i = 0; i < frames; i++) {
    const due = queue
    queue = []
    clock += 16
    for (const f of due) f(clock)
  }
}

/** What one call cost: frames drawn and the three passes, from idle to idle. */
function cost(fn: () => void): { frames: number } & Work {
  run()
  const before = { r: h.renders, e: h.edges, p: h.picker, s: h.sentinelPaints }
  fn()
  run()
  return {
    frames: h.renders - before.r,
    paint: h.sentinelPaints - before.s,
    edges: h.edges - before.e,
    picker: h.picker - before.p
  }
}

/** An element as the batch store keeps one: one part, visible, at rest. */
const element = (id: number): unknown => ({
  id,
  modelKey: 'ARC',
  slotOf: [0],
  partOf: [id],
  rgba: [0.5, 0.5, 0.5, 1],
  bbox: new Box3(new Vector3(0, 0, 0), new Vector3(1, 1, 1)),
  solidCount: 1,
  space: false,
  visible: true,
  seeThrough: false,
  fading: false,
  hl: false
})

let viewer: Viewer
const canvas = {
  style: {},
  parentElement: { clientWidth: 800, clientHeight: 600 },
  addEventListener: () => undefined,
  removeEventListener: () => undefined
}

beforeEach(async () => {
  Object.assign(h, { renders: 0, edges: 0, picker: 0, sentinelPaints: 0 })
  h.elements.clear()
  // Five elements; id 5 is never selected or hovered, so its paints count the full repaints.
  for (let id = 1; id <= 5; id++) h.elements.set(id, element(id))
  queue = []
  vi.stubGlobal('requestAnimationFrame', (f: (now: number) => void) => queue.push(f))
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
})
afterEach(() => {
  viewer.dispose()
  vi.unstubAllGlobals()
})

/** One call per setter, with arguments that change something. */
/** Partial by type; `every setter has a call here` below makes it total at run time. */
const CALL: Partial<Record<keyof Viewer, (v: Viewer) => unknown>> = {
  addModel: (v) => v.addModel('MEP', 2, []),
  removeModel: (v) => v.removeModel('ARC'),
  frameExtents: (v) => v.frameExtents(),
  setTheme: (v) => v.setTheme('light'),
  setVisibility: (v) => v.setVisibility(() => true),
  setSelected: (v) => v.setSelected([1, 2]),
  setHighlight: (v) => v.setHighlight([1]),
  setHighlightColor: (v) => v.setHighlightColor('#E8A33D'),
  setElementColors: (v) => v.setElementColors({ 1: '#E8A33D' }),
  setModelColors: (v) => v.setModelColors({ ARC: '#D8D2C6' }),
  setClassColors: (v) => v.setClassColors({ 1: '#D8D2C6' }),
  setCutColors: (v) => v.setCutColors({ ARC: '#D8D2C6' }),
  setPickable: (v) => v.setPickable((e) => e.model === 'ARC'),
  setTool: (v) => v.setTool('measure'),
  cancel: (v) => v.cancel(),
  setShadows: (v) => v.setShadows(false),
  setGroundGrid: (v) => v.setGroundGrid(true),
  setSections: (v) => v.setSections({ grid: { kind: 'grid', name: 'C' }, level: null }),
  setCoords: (v) => v.setCoords({ angle: 10 }),
  setPlanRotation: (v) => v.setPlanRotation(12),
  setUnits: (v) => v.setUnits('ft'),
  setDims: (v) => v.setDims([1], true),
  setSnap: (v) => v.setSnap(false),
  setGrids: (v) => v.setGrids(true),
  setLevels: (v) => v.setLevels(false),
  clearMeasures: (v) => v.clearMeasures(),
  clearSpots: (v) => v.clearSpots(),
  dropMeasure: (v) => v.dropMeasure(1),
  dropSpot: (v) => v.dropSpot(1),
  placeSpot: (v) => v.placeSpot([1, 2, 3]),
  placeMeasure: (v) => v.placeMeasure([1, 2, 3], null, -1),
  showSpot: (v) => v.showSpot(1, true),
  setCamera: (v) => v.setCamera({ theta: 1, phi: 1, dist: 9, half: 4, target: [0, 0, 0], proj: 'persp' }),
  setView: (v) => v.setView('top'),
  setProjection: (v) => v.setProjection('ortho'),
  zoomExtents: (v) => v.zoomExtents(),
  zoomTo: (v) => v.zoomTo(1),
  focusPoint: (v) => v.focusPoint([1, 2, 3]),
  lookAlong: (v) => v.lookAlong(1, 1)
}

describe('the contract lists every member the viewer has', () => {
  it('no member of the real viewer is missing from viewer-contract.ts, and none is listed that it lacks', () => {
    // `dev` exists only in a dev build (`DEVTOOLS`); everything else is on the object itself.
    const real = Object.keys(viewer).filter((k) => k !== 'dev')
    const listed = Object.keys(VIEWER_MEMBERS).filter((k) => k !== 'dev')
    expect(real.sort()).toEqual(listed.sort())
  })

  it('every setter has a call here', () => {
    expect(Object.keys(CALL).sort()).toEqual([...SETTERS].sort())
  })
})

describe('every setter asks for a frame, and only the passes the contract names', () => {
  it.each(SETTERS)('%s', (name) => {
    const call = CALL[name]
    if (!call) throw new Error(`no call for ${name}`)
    const got = cost(() => void call(viewer))
    const member = VIEWER_MEMBERS[name]
    if (member.kind !== 'setter') throw new Error('not a setter')
    // setCutColors draws nothing while no plane cuts: its frame is tested below, with a cut.
    const frames = name === 'setCutColors' ? 0 : FRAMES_PER_INVALIDATE
    expect(got, `${name}: frames drawn and passes run, idle to idle`).toEqual({ frames, ...member.work })
  })
})

describe('the conditions in the contract', () => {
  it('setCutColors asks for a frame while a plane cuts', () => {
    h.setClips!([{ n: [0, 0, 1], c: 0 }, null])
    expect(cost(() => viewer.setCutColors({ ARC: '#D8D2C6' })).frames).toBe(FRAMES_PER_INVALIDATE)
  })
  it('setClassColors repaints every element while Original materials is off', () => {
    viewer.setModelColors({}, false)
    expect(cost(() => viewer.setClassColors({ 1: '#D8D2C6' }))).toMatchObject({ frames: FRAMES_PER_INVALIDATE, paint: 1 })
  })
  it('setPlanRotation to the angle it already has draws nothing', () => {
    viewer.setPlanRotation(12)
    expect(cost(() => viewer.setPlanRotation(12)).frames).toBe(0)
  })
  it('zoomTo an id the scene does not have draws nothing', () => {
    expect(cost(() => viewer.zoomTo(999)).frames).toBe(0)
  })
  it('the annotation layer is handed the viewer’s own invalidate', () => {
    expect(cost(() => h.annotationsInvalidate!()).frames).toBe(FRAMES_PER_INVALIDATE)
  })
  it('a still viewer draws nothing', () => {
    expect(cost(() => undefined)).toEqual({ frames: 0, paint: 0, edges: 0, picker: 0 })
  })
})

describe('viewer.batch', () => {
  /** Every setter that repaints, rebuilds the edges or rebuilds the picker, called in a row. */
  const heavy = (v: Viewer): void => {
    v.setHighlightColor('#E8A33D')
    v.setElementColors({ 1: '#E8A33D' })
    v.setModelColors({ ARC: '#D8D2C6' })
    v.setTheme('light')
    v.setHighlight([1])
    v.setPickable(() => true)
    v.setVisibility(() => true)
  }

  it('runs each pass once for a run of setters, and asks for one frame’s worth of drawing', () => {
    expect(cost(() => viewer.batch(() => heavy(viewer)))).toEqual({
      frames: FRAMES_PER_INVALIDATE,
      paint: 1,
      edges: 1,
      picker: 1
    })
  })

  it('nests: the passes wait for the outermost batch', () => {
    expect(cost(() => viewer.batch(() => viewer.batch(() => heavy(viewer))))).toMatchObject({
      paint: 1,
      edges: 1,
      picker: 1
    })
  })

  it('without it, each setter runs its own passes — what the store must not do', () => {
    // The frames still coalesce — seven invalidate()s in one task draw what one does — but the
    // passes do not.
    expect(cost(() => heavy(viewer))).toEqual({ frames: FRAMES_PER_INVALIDATE, paint: 7, edges: 3, picker: 2 })
  })
})
