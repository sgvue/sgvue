/**
 * The viewer's contract as the render-on-demand checks read it — not a test on its own (the name
 * does not end in `.test.ts`); `viewer-invalidate.test.ts` and `shell-viewer-batch.test.ts`
 * share it (core protection, plan item 7).
 *
 * Every member of `Viewer` is listed here — the mapped type makes a member left out a type error
 * in `npm run typecheck`, and `viewer-invalidate.test.ts` also compares the list with the object
 * `createViewer` really returns. A member is either a **setter** — every call asks for a frame
 * (`invalidate()`, CLAUDE.md: "anything that changes what is drawn must call `invalidate()`") and
 * may ask for the three expensive passes `viewer.batch` coalesces — or **not a setter**, with the
 * reason it draws nothing new.
 *
 * `work` is what one call outside a batch costs on a viewer in its first state (Original
 * materials on, nothing cutting): full repaints of every element (`applyAll`), edge-index
 * rebuilds and picker rebuilds. `viewer-invalidate.test.ts` measures the real `viewer-core.ts`
 * against it; `shell-viewer-batch.test.ts` charges the store's calls with it.
 */
import type { Viewer } from '../../src/renderer/viewer/viewer-core'

export interface Work {
  paint: number
  edges: number
  picker: number
}

export type Member =
  | { kind: 'setter'; work: Work; when?: string }
  | { kind: 'not a setter'; why: string }

const frame = (when?: string): Member => ({ kind: 'setter', work: { paint: 0, edges: 0, picker: 0 }, when })
const work = (paint: number, edges: number, picker: number): Member => ({
  kind: 'setter',
  work: { paint, edges, picker }
})
const no = (why: string): Member => ({ kind: 'not a setter', why })

export const VIEWER_MEMBERS: { [K in keyof Viewer]-?: Member } = {
  backend: no('a value: the graphics backend, fixed at creation'),
  bbox: no('a value: the federation box, read by the store'),
  addModel: work(1, 1, 1),
  removeModel: work(0, 1, 1),
  batch: no('the coalescing wrapper itself; its own test is in viewer-invalidate.test.ts'),
  frameExtents: frame(),
  elementIds: no('a read'),
  elementBox: no('a read'),
  elementPlanBox: no('a read'),
  solidCount: no('a read'),
  isVisible: no('a read'),
  setTheme: work(1, 0, 0),
  setVisibility: work(1, 1, 1),
  setSelected: frame('repaints only the elements whose selection changed, never every element'),
  setHighlight: work(1, 1, 0),
  setHighlightColor: work(1, 0, 0),
  setElementColors: work(1, 0, 0),
  setModelColors: work(1, 0, 0),
  setClassColors: frame('repaints every element only while Original materials is off'),
  setCutColors: frame('asks for a frame only while a plane cuts — otherwise nothing it colours is drawn'),
  setPickable: work(1, 1, 1),
  setTool: frame(),
  cancel: frame(),
  setShadows: frame(),
  setGroundGrid: frame(),
  setSections: frame(),
  setCoords: frame(),
  setPlanRotation: frame('nothing at all when the angle is the one it has'),
  setUnits: frame(),
  setDims: frame(),
  setSnap: frame(),
  setGrids: frame(),
  setLevels: frame(),
  clearMeasures: frame(),
  clearSpots: frame(),
  dropMeasure: frame(),
  dropSpot: frame(),
  placeSpot: frame(),
  placeMeasure: frame(),
  showSpot: frame('through the annotation layer’s own invalidate, which is the viewer’s'),
  getCamera: no('a read'),
  setCamera: frame(),
  setView: frame(),
  setProjection: frame(),
  zoomExtents: frame(),
  zoomTo: frame('nothing when none of the ids is in the scene — the camera does not move'),
  focusPoint: frame(),
  lookAlong: frame(),
  debug: no('a read, for the dev hook'),
  dev: no('dev builds only, absent in production; nothing in src/ reads it'),
  dispose: no('the end of the viewer: nothing is drawn after it')
}

/** The names of the setters, for the tests that walk them. */
export const SETTERS = (Object.keys(VIEWER_MEMBERS) as (keyof Viewer)[]).filter(
  (k) => VIEWER_MEMBERS[k].kind === 'setter'
)
