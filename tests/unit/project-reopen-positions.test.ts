/**
 * A federation reopened from a `.sgvue` project is drawn exactly where it was drawn before it was
 * saved — every element of every model, to 1 mm — and where its files put it. Nothing lines the
 * models up but the files.
 *
 * Since 2026-11-07 every model is drawn at its file's own world coordinates against **one** shared
 * whole-metre Float64 offset (scene = world − offset; `geometry-streamer.ts`). The first model's
 * first placement chooses it, and every later model must be streamed against it: the viewer never
 * re-bases a model (`viewer-core.ts` `addModel`), and the store keeps the first batch item's
 * offset as the one every readout adds back (`federation-store.ts` `addBatch`).
 *
 * The defect this holds: `FederationController.parseInto` sends a model's geometry request with
 * the offset it has **at that moment**, and sets it only when that model's stream finishes. The
 * parse worker handles its messages one at a time, in arrival order. A project queues all its
 * models together, 500 ms apart (`upload-pipeline.ts` `queue`); when the first parse outlasts the
 * stagger, the second parse is already queued behind it, so the worker runs `parse A, parse B,
 * geometry A, geometry B` — and the renderer, told "B parsed" before "A's geometry done", sends
 * B's geometry with `offset: null`. B then chooses an offset of its own, and is drawn shifted by
 * the difference. Adding the models one at a time after boot does not race, and is the baseline.
 *
 * Driven through the **real** code: `upload-pipeline.ts`, the `federation` controller, the real
 * `ParseWorkerBridge`, `project.ts` (`snapshotFor` → `readProject` → `openProjectMessage` →
 * `restore` / `locateModel` / `restoreLocated`) and the real store. Replaced, and only these:
 *
 *   · the global `Worker` — an in-process parse worker (`FakeParseWorker`) that speaks the real
 *     `ParseRequest` / `ParseResponse` protocol and does the real work with web-ifc under Node
 *     (`createReadOnlyIfcSource`, `buildModelIndex`, `streamGeometry`), scheduled as the real one
 *     is (see its comment); the SQL worker is refused, as Node has none;
 *   · the viewer — a stand-in that keeps, per model, every part's `matrix16` and vertices from the
 *     chunks `addModel` receives and the `meta.offset` it was handed, and records every method
 *     called on it;
 *   · `window.sgvue` (the file bridge), `fetch`, `localStorage` and the timers (fake).
 *
 * The two models are written here (`synthetic-boxes.ts`) on the synthetic site, ~43 m apart, so
 * each would choose a different whole-metre offset; every expected position is worked out in
 * Float64 from the files' own numbers.
 */
import { createHash } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FederationOffset, GeometryChunk, GeometrySummary } from '../../src/shared/geometry-contract.types'
import type { ParseRequest, ParseResponse } from '../../src/worker/parse.worker'
import { streamGeometry } from '../../src/worker/geometry-streamer'
import { createReadOnlyIfcSource, type ReadOnlyIfcSource } from '../../src/worker/ifc-source'
import { buildModelIndex } from '../../src/worker/index-builder'
import { federation } from '../../src/renderer/model/federation-store'
import { disposeUploads, openPaths } from '../../src/renderer/model/upload-pipeline'
import {
  closeProject,
  installProject,
  locateModel,
  openProjectMessage,
  projectStatus,
  snapshotFor
} from '../../src/renderer/model/project'
import { useShell } from '../../src/renderer/state/shell'
import { readProject, type ProjectFile } from '../../src/shared/project-file'
import type { ProjectLocated, ProjectModelFile } from '../../src/shared/ipc-contract'
import type { Viewer } from '../../src/renderer/viewer/viewer-core'
import { boxCentre, boxCorners, boxModel, type BoxSpec, type ModelSpec } from './synthetic-boxes'
import { memoryStorage, resetShell } from './stub-viewer'

/** 1 mm, in the metres the contract speaks. */
const TOL_M = 1e-3

/* ────────────────────────────── the two files ────────────────────────────── */

/**
 * Two models of one building on the synthetic site, ~43 m apart: ARC's first part stands at
 * (1, 2, 0) m in the site's frame, STR's at (40, −15, 3) m — so streamed with `offset: null` each
 * chooses its own whole-metre offset, ~43 m from the other's (checked below, not assumed).
 */
const SPECS: Record<'ARC' | 'STR', ModelSpec> = {
  ARC: {
    name: 'ARC',
    guidPrefix: '1',
    boxes: [
      { name: 'ARC wall 1', at: [1000, 2000, 0], size: [6000, 200, 3000] },
      { name: 'ARC wall 2', at: [8000, 2000, 0], size: [200, 5000, 3000] },
      { name: 'ARC wall 3', at: [1000, 6800, 0], size: [6000, 200, 3000] }
    ]
  },
  STR: {
    name: 'STR',
    guidPrefix: '2',
    boxes: [
      { name: 'STR slab', at: [40000, -15000, 3000], size: [3000, 3000, 300] },
      { name: 'STR column', at: [44000, -15000, 3000], size: [400, 400, 3000] }
    ]
  }
}
type Key = keyof typeof SPECS
const KEYS = Object.keys(SPECS) as Key[]
const pathOf = (key: Key): string => `/projects/synthetic/review/models/${key}.ifc`
const BYTES: Record<Key, Uint8Array> = {
  ARC: new TextEncoder().encode(boxModel(SPECS.ARC)),
  STR: new TextEncoder().encode(boxModel(SPECS.STR))
}
const keyOfPath = (path: string): Key => KEYS.find((k) => pathOf(k) === path)!
const picked = (key: Key): { path: string; name: string; size: number } => ({
  path: pathOf(key),
  name: `${key}.ifc`,
  size: BYTES[key].length
})
/** A box by its element's name. */
const boxNamed = (name: string): BoxSpec => KEYS.flatMap((k) => SPECS[k].boxes).find((b) => b.name === name)!

/* ────────────────────────────── the parse worker ────────────────────────────── */

/** The bytes behind each Blob the stubbed `fetch` hands out, for the worker to read. */
const blobBytes = new WeakMap<Blob, Uint8Array>()

/**
 * The work each request holds the worker's one thread for, in (fake) milliseconds. A parse is the
 * one that matters: a real model's parse takes seconds — 30–50 s above ~300 MB
 * (`docs/releases/1.3.0.md`) — so it outlasts the pipeline's 500 ms stagger, which is what lets a
 * second file's parse queue up behind the first. 2 s is a small model's.
 */
const COST_MS: Record<ParseRequest['type'], number> = { parse: 2000, geometry: 400, rawLine: 0, close: 0 }

interface WorkerLog {
  /** Every geometry request, in the order the worker handled it, with the offset it asked for. */
  geometry: { modelKey: string; offset: FederationOffset | null; summary: GeometrySummary | null }[]
  /** Every request the worker handled, in order. */
  handled: string[]
}
const log: WorkerLog = { geometry: [], handled: [] }

let ifc: ReadOnlyIfcSource

/**
 * An in-process stand-in for `src/worker/parse.worker.ts`, faithful to its scheduling:
 *
 *   · **one thread, strict FIFO.** A worker's messages are delivered to its one event loop in the
 *     order they were posted, and `ctx.onmessage` handles one before the next is dequeued.
 *   · **each request atomic.** `parse()` reads the file through `FileReaderSync` and runs web-ifc's
 *     `OpenModelFromCallback` and `buildModelIndex` synchronously; its only `await`s are
 *     `source()` (resolved after the first parse) and hash-wasm's `createSHA256()` at its very
 *     start, before it has posted anything. The `geometry` case is one synchronous
 *     `streamGeometry` call. So no later request runs in the middle of one — the model here; the
 *     one exception is noted in the report that came with this file.
 *   · **responses asynchronous, in order.** What a request posts reaches the renderer once that
 *     request's work is done, each message its own task, in the order posted.
 *
 * It is the worker's own protocol over the real `ParseWorkerBridge`; the work is the real
 * `buildModelIndex` and `streamGeometry`, so the offset each geometry request is streamed with is
 * the one the streamer really chooses or is handed.
 */
class FakeParseWorker {
  onmessage: ((e: MessageEvent<ParseResponse>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  private readonly queue: ParseRequest[] = []
  private busy = false
  private dead = false
  private readonly open = new Map<string, number>()

  constructor(url: URL | string) {
    // The SQL index's worker is not faked: Node has no `Worker`, and the build logs and goes on.
    if (!String(url).includes('parse.worker')) throw new Error('no worker but the parse worker in this test')
  }

  postMessage(request: ParseRequest): void {
    if (this.dead) return
    this.queue.push(request)
    if (!this.busy) this.next()
  }

  terminate(): void {
    this.dead = true
    this.queue.length = 0
    for (const id of this.open.values()) ifc.close(id)
    this.open.clear()
  }

  private next(): void {
    const request = this.queue.shift()
    if (!request || this.dead) {
      this.busy = false
      return
    }
    this.busy = true
    log.handled.push(`${request.type} ${'modelKey' in request ? request.modelKey : ''}`)
    const out = this.handle(request)
    setTimeout(() => {
      if (this.dead) return
      for (const message of out) setTimeout(() => !this.dead && this.onmessage?.({ data: message } as MessageEvent<ParseResponse>), 0)
      this.next()
    }, COST_MS[request.type])
  }

  private handle(request: ParseRequest): ParseResponse[] {
    try {
      switch (request.type) {
        case 'parse': {
          const bytes = blobBytes.get(request.file)
          if (!bytes) throw new Error(`no bytes for ${request.fileName}`)
          const sha256 = createHash('sha256').update(bytes).digest('hex')
          const id = ifc.openFromBuffer(bytes)
          const index = buildModelIndex(ifc, id, { modelKey: request.modelKey, fileName: request.fileName, sha256 })
          const replaced = this.open.get(request.modelKey)
          if (replaced !== undefined) ifc.close(replaced)
          this.open.set(request.modelKey, id)
          const { elements, ...meta } = index
          // Structured-cloned, as `postMessage` does.
          return [
            { type: 'progress', modelKey: request.modelKey, stage: 'parsing entities', detail: 'IFC4', fraction: 1 },
            { type: 'meta', modelKey: request.modelKey, meta: structuredClone(meta) },
            { type: 'elements', modelKey: request.modelKey, chunk: 0, chunks: 1, elements: structuredClone([...elements]) },
            { type: 'done', modelKey: request.modelKey, sha256, counts: structuredClone(index.counts), ms: COST_MS.parse }
          ]
        }
        case 'geometry': {
          const id = this.open.get(request.modelKey)
          if (id === undefined) throw new Error(`no open model "${request.modelKey}" — parse it first`)
          const out: ParseResponse[] = []
          const entry: WorkerLog['geometry'][number] = { modelKey: request.modelKey, offset: request.offset, summary: null }
          log.geometry.push(entry)
          const summary = streamGeometry(ifc, id, {
            modelKey: request.modelKey,
            offset: request.offset,
            onChunk: (chunk) => out.push({ type: 'geometryChunk', modelKey: request.modelKey, chunk: structuredClone(chunk) })
          })
          entry.summary = summary
          out.push({ type: 'geometryDone', modelKey: request.modelKey, summary: structuredClone(summary) })
          return out
        }
        case 'close': {
          const id = this.open.get(request.modelKey)
          if (id !== undefined) ifc.close(id)
          this.open.delete(request.modelKey)
          return []
        }
        case 'rawLine':
          return [{ type: 'rawLine', requestId: request.requestId, line: null }]
      }
    } catch (err) {
      return [
        {
          type: 'error',
          modelKey: 'modelKey' in request ? request.modelKey : undefined,
          requestId: 'requestId' in request ? request.requestId : undefined,
          message: err instanceof Error ? err.message : String(err)
        }
      ]
    }
  }
}

/* ────────────────────────────── the viewer stand-in ────────────────────────────── */

interface DrawnPart {
  elementId: number
  matrix16: number[]
  /** The part's own Float32 vertices, xyz interleaved. */
  vertices: Float32Array
}
interface DrawnModel {
  slot: number
  offset: readonly number[] | undefined
  parts: DrawnPart[]
}

/** What the viewer was handed, per model key, as it stands. */
const drawnModels = new Map<string, DrawnModel>()
/** Every viewer method called, in order, by name. */
const viewerCalls: string[] = []

const CAM = { theta: -0.8, phi: 1.05, dist: 60, half: 12, target: [3, 4, 5] as [number, number, number], proj: 'persp' as const }

const viewerImpl: Record<string, (...args: never[]) => unknown> = {
  batch: (fn: () => void) => fn(),
  addModel: (key: string, slot: number, chunks: Iterable<GeometryChunk>, meta?: { offset?: readonly number[] }) => {
    const parts: DrawnPart[] = []
    for (const chunk of chunks) {
      for (const part of chunk.parts) {
        const g = chunk.geoms[part.geomIdx]
        parts.push({
          elementId: part.elementId,
          matrix16: [...part.matrix16],
          vertices: chunk.positions.slice(g.vertexOffset * 3, (g.vertexOffset + g.vertexCount) * 3)
        })
      }
    }
    drawnModels.set(key, { slot, offset: meta?.offset ? [...meta.offset] : undefined, parts })
    return Promise.resolve()
  },
  removeModel: (key: string) => {
    drawnModels.delete(key)
    return []
  },
  getCamera: () => CAM,
  elementIds: () => [],
  placeMeasure: () => false,
  debug: () => ({})
}
const viewer = new Proxy(viewerImpl, {
  get(target, key) {
    if (typeof key === 'symbol' || key === 'then' || key === 'backend' || key === 'bbox' || key === 'dev') return undefined
    return (...args: never[]) => {
      viewerCalls.push(key)
      return key in target ? target[key](...args) : undefined
    }
  }
}) as unknown as Viewer

/**
 * Every viewer method an open, a restore and a locate call today. A call outside this list — a
 * future "align", "move model" or "set model transform" — fails the test: nothing may move or
 * turn a model but its file. `setPlanRotation`, `frameExtents`, `setCamera` and the view setters
 * move the **camera** only (`viewer-core.ts`).
 */
const ALLOWED_VIEWER_CALLS = new Set<string>([
  // Models in and out — each streamed in exactly as its file and the shared offset give it.
  'addModel', 'removeModel', 'batch',
  // The camera: framing, the plan rotation (which turns only the camera's plan frame), a pose.
  'frameExtents', 'getCamera', 'setCamera', 'setPlanRotation',
  // What is shown and how — colours, visibility, selection, sections, switches, units.
  'setVisibility', 'setSelected', 'setHighlight', 'setHighlightColor', 'setElementColors',
  'setModelColors', 'setClassColors', 'setCutColors', 'setPickable', 'setSections', 'setGrids',
  'setLevels', 'setShadows', 'setSnap', 'setUnits', 'setCoords', 'setDims', 'setGroundGrid',
  // The markups: cleared, and a project's own put back where the file says.
  'clearMeasures', 'clearSpots', 'elementIds', 'placeMeasure', 'placeSpot',
  // A read: the element's box in the plan frame, for the SQL `plan_box` table — it moves nothing.
  'elementPlanBox'
])

/* ────────────────────────────── where things are drawn ────────────────────────────── */

type V3 = [number, number, number]
/** `modelKey#expressId` → every vertex drawn for that element, world coordinates (Float64). */
type Positions = Map<string, V3[]>

/**
 * Where each element is drawn in the file's world coordinates: each part's Float32 `matrix16`
 * applied to its own vertices — in the one shared scene — plus the store's `offset`, in Float64.
 */
function drawnWorld(): Positions {
  const [ox, oy, oz] = useShell.getState().offset
  const out: Positions = new Map()
  for (const [key, m] of drawnModels) {
    for (const p of m.parts) {
      const id = `${key}#${p.elementId}`
      const list = out.get(id) ?? []
      const M = p.matrix16
      for (let v = 0; v < p.vertices.length; v += 3) {
        const [x, y, z] = [p.vertices[v], p.vertices[v + 1], p.vertices[v + 2]]
        list.push([
          M[0] * x + M[4] * y + M[8] * z + M[12] + ox,
          M[1] * x + M[5] * y + M[9] * z + M[13] + oy,
          M[2] * x + M[6] * y + M[10] * z + M[14] + oz
        ])
      }
      out.set(id, list)
    }
  }
  return out
}

/** Each element's express id, by its name, read off the store's federation. */
function idsByName(): Map<string, string> {
  const out = new Map<string, string>()
  for (const e of useShell.getState().federation.elements) out.set(e.name, `${e.model}#${e.expressId}`)
  return out
}

const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const fmt = (p: V3): string => `(${p.map((v) => v.toFixed(4)).join(', ')})`
const centreOf = (pts: readonly V3[]): V3 =>
  [0, 1, 2].map((k) => (Math.min(...pts.map((p) => p[k])) + Math.max(...pts.map((p) => p[k]))) / 2) as V3

/** Every element whose drawn vertices are more than 1 mm from the baseline's, with how far. */
function moved(base: Positions, now: Positions): string[] {
  const out: string[] = []
  for (const [id, pts] of base) {
    const got = now.get(id)
    if (!got) {
      out.push(`${id}: not drawn`)
      continue
    }
    if (got.length !== pts.length) {
      out.push(`${id}: ${got.length} vertices drawn, ${pts.length} before`)
      continue
    }
    let worst = 0
    for (let i = 0; i < pts.length; i++) worst = Math.max(worst, dist(pts[i], got[i]))
    if (worst > TOL_M) out.push(`${id}: drawn ${(worst * 1000).toFixed(1)} mm from where it was; centre ${fmt(centreOf(got))}, was ${fmt(centreOf(pts))}`)
  }
  for (const id of now.keys()) if (!base.has(id)) out.push(`${id}: drawn now, not before`)
  return out
}

/* ────────────────────────────── the bridge ────────────────────────────── */

let savedCb: ((m: { n: number }) => void) | null = null
let locateAnswer: ProjectLocated | null = null

function installBridge(): void {
  vi.stubGlobal('window', {
    sgvue: {
      fileUrl: async (path: string) => ({ url: `sgvue-file://t/${encodeURIComponent(path)}` }),
      admitPaths: async (paths: string[]) => ({ files: paths.map((p) => picked(keyOfPath(p))), refused: [] }),
      addRecent: async () => [],
      listRecents: async () => [],
      confirmReplace: async () => true,
      projectReady: async () => undefined,
      closeProject: async () => undefined,
      setProjectDirty: async () => undefined,
      answerProjectSnapshot: async () => undefined,
      onProjectSnapshotRequest: () => () => undefined,
      onProjectOpened: () => () => undefined,
      onProjectSaved: (fn: (m: { n: number }) => void) => {
        savedCb = fn
        return () => undefined
      },
      locateProjectModel: async () => locateAnswer
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  })
  vi.stubGlobal('fetch', async (url: string) => {
    const key = keyOfPath(decodeURIComponent(url.replace('sgvue-file://t/', '')))
    const blob = new Blob([BYTES[key] as BlobPart])
    blobBytes.set(blob, BYTES[key])
    return { ok: true, status: 200, blob: async () => blob }
  })
  vi.stubGlobal('Worker', FakeParseWorker)
}

/* ────────────────────────────── the flows ────────────────────────────── */

/** Run the fake clock until `done()` holds, or say what never happened. */
async function until(what: string, done: () => boolean, maxMs = 60_000): Promise<void> {
  for (let t = 0; t < maxMs; t += 50) {
    if (done()) return
    await vi.advanceTimersByTimeAsync(50)
  }
  throw new Error(`timed out waiting for ${what}`)
}

const loadedKeys = (): string[] => useShell.getState().federation.models.map((m) => m.meta.modelKey).sort()
const settled = (keys: readonly string[]): boolean => {
  const s = useShell.getState()
  return s.booted && s.ready && JSON.stringify(loadedKeys()) === JSON.stringify([...keys].sort()) && !projectStatus().loading
}

/** The safe way: one model at a time, each awaited — the first boots, the next joins after boot. */
async function loadOneByOne(order: readonly Key[]): Promise<void> {
  for (const [i, key] of order.entries()) {
    await openPaths([pathOf(key)])
    await until(`${key} to load`, () => settled(order.slice(0, i + 1)))
  }
}

let snapN = 0
/** File › Save Project, as main runs it: the snapshot, re-read through the real reader, then "saved". */
function save(): ProjectFile {
  const n = ++snapN
  const snap = snapshotFor(n)
  if (!snap.text) throw new Error(`nothing to save: ${snap.reason}`)
  savedCb?.({ n })
  const read = readProject(snap.text)
  if (!read.ok) throw new Error(read.message)
  return read.project
}

/** File › Open Project…, every model admitted at its path unless named missing. */
async function reopen(file: ProjectFile, missing: readonly Key[] = []): Promise<void> {
  const models: ProjectModelFile[] = file.models.map((m) => {
    const key = m.name.replace(/\.ifc$/, '') as Key
    return { id: m.id, file: missing.includes(key) ? null : picked(key), refused: null }
  })
  await openProjectMessage({ ok: true, name: 'review', text: JSON.stringify(file), models })
}

/** A fresh window: nothing loaded, no project, the store as it starts. */
function freshWindow(): void {
  closeProject()
  disposeUploads()
  federation.resetUnshown()
  resetShell()
  federation.attach(viewer)
  drawnModels.clear()
  viewerCalls.length = 0
  log.geometry.length = 0
  log.handled.length = 0
}

/* ────────────────────────────── the independent truth ────────────────────────────── */

/**
 * Each element's world corners from the file's numbers, and whether what is drawn has exactly
 * them: every drawn vertex is a corner and every corner is drawn, within 1 mm.
 */
function offFile(now: Positions): string[] {
  const out: string[] = []
  const ids = idsByName()
  for (const key of KEYS) {
    for (const b of SPECS[key].boxes) {
      const id = ids.get(b.name)
      const pts = id ? now.get(id) : undefined
      if (!pts) {
        out.push(`${b.name}: not drawn`)
        continue
      }
      const corners = boxCorners(b)
      for (const c of corners) if (!pts.some((p) => dist(p, c) <= TOL_M)) out.push(`${b.name}: no drawn vertex at its corner ${fmt(c)}`)
      const stray = pts.filter((p) => !corners.some((c) => dist(p, c) <= TOL_M))
      if (stray.length) out.push(`${b.name}: ${stray.length} drawn vertices on none of its corners, e.g. ${fmt(stray[0])} — centre drawn ${fmt(centreOf(pts))}, the file's ${fmt(boxCentre(b))}`)
    }
  }
  return out
}

/** The offset each model was streamed against, and what it was handed, against the store's. */
function offsets(): string[] {
  const store = useShell.getState().offset
  const out: string[] = []
  for (const g of log.geometry) {
    if (JSON.stringify(g.summary?.offset) !== JSON.stringify(store))
      out.push(`${g.modelKey} streamed against offset ${JSON.stringify(g.summary?.offset)} (asked for ${JSON.stringify(g.offset)}); the store's is ${JSON.stringify(store)}`)
  }
  for (const [key, m] of drawnModels) {
    if (JSON.stringify(m.offset) !== JSON.stringify(store)) out.push(`${key} handed to the viewer with meta.offset ${JSON.stringify(m.offset)}; the store's is ${JSON.stringify(store)}`)
  }
  return out
}

/** Each part's `matrix16`, as a solo stream of that file against the store's offset gives it. */
function soloMatrices(key: Key, offset: FederationOffset): number[][] {
  const id = ifc.openFromBuffer(BYTES[key])
  try {
    const out: number[][] = []
    streamGeometry(ifc, id, { modelKey: key, offset, onChunk: (c) => c.parts.forEach((p) => out.push([...p.matrix16])) })
    return out
  } finally {
    ifc.close(id)
  }
}

/** ARC wall 1's centre to STR slab's centre, as drawn, against the files' own numbers. */
function separationProblem(now: Positions): string | null {
  const ids = idsByName()
  const a = now.get(ids.get('ARC wall 1')!)
  const b = now.get(ids.get('STR slab')!)
  if (!a || !b) return 'a reference element is not drawn'
  const drawn = centreOf(b).map((v, k) => v - centreOf(a)[k]) as V3
  const file = boxCentre(boxNamed('STR slab')).map((v, k) => v - boxCentre(boxNamed('ARC wall 1'))[k]) as V3
  return dist(drawn, file) <= TOL_M
    ? null
    : `drawn ${fmt(drawn)} m apart, the files put them ${fmt(file)} apart — ${(dist(drawn, file) * 1000).toFixed(1)} mm off`
}

/* ────────────────────────────── setup ────────────────────────────── */

let uninstall: () => void = () => undefined

beforeAll(async () => {
  ifc = await createReadOnlyIfcSource()
  vi.stubGlobal('__APP_VERSION__', '0.0.0-test')
  vi.stubGlobal('localStorage', memoryStorage())
})
afterAll(() => {
  ifc.dispose()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  vi.useFakeTimers()
  installBridge()
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  // The SQL index cannot build without a worker; it says so and the model is unaffected.
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  freshWindow()
  uninstall = installProject()
})
afterEach(async () => {
  uninstall()
  freshWindow()
  await vi.advanceTimersByTimeAsync(2000)
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/* ────────────────────────────── the checks ────────────────────────────── */

describe('the fixture: two models that would each choose a different offset', () => {
  it('streamed alone with offset: null, ARC and STR choose whole-metre offsets tens of metres apart', () => {
    const chosen = KEYS.map((key) => {
      const id = ifc.openFromBuffer(BYTES[key])
      try {
        return streamGeometry(ifc, id, { modelKey: key, offset: null, onChunk: () => undefined }).offset
      } finally {
        ifc.close(id)
      }
    })
    expect(chosen.every((o) => o.every(Number.isInteger))).toBe(true)
    expect(Math.hypot(chosen[0][0] - chosen[1][0], chosen[0][1] - chosen[1][1], chosen[0][2] - chosen[1][2])).toBeGreaterThan(10)
  })
})

describe.each([
  { order: ['ARC', 'STR'] as Key[] },
  { order: ['STR', 'ARC'] as Key[] }
])('saved with $order in the project, reopened with every model queued together', ({ order }) => {
  it('1. baseline — loaded one at a time, every element is drawn where its file puts it', async () => {
    await loadOneByOne(order)
    expect(offFile(drawnWorld())).toEqual([])
    expect(offsets()).toEqual([])
  })

  it('2–5. reopened: every element where it was and where its file puts it, one offset, nothing moved', async () => {
    await loadOneByOne(order)
    const base = drawnWorld()
    const file = save()
    expect(file.models.map((m) => m.name)).toEqual(order.map((k) => `${k}.ifc`))
    expect(separationProblem(base)).toBeNull()

    freshWindow()
    await reopen(file)
    await until('the project to reopen', () => settled(order))
    const calls = new Set(viewerCalls)
    const now = drawnWorld()
    const store = useShell.getState().offset as FederationOffset

    // 4. One offset: every model streamed against it, handed it, and it is the store's.
    expect.soft(offsets(), `geometry requests in the order the worker took them: ${log.handled.join(', ')}`).toEqual([])
    // 2. Every element where it was before the save.
    expect.soft(moved(base, now)).toEqual([])
    // 5. Exactly as far apart as the files say …
    expect.soft(separationProblem(now)).toBeNull()
    expect.soft(offFile(now)).toEqual([])
    // … each part's matrix the one a solo stream of its file against that offset gives …
    for (const key of KEYS) {
      expect.soft(drawnModels.get(key)?.parts.map((p) => p.matrix16), `${key}'s part matrices`).toEqual(soloMatrices(key, store))
    }
    // … and the viewer was asked for nothing that could move or turn a model.
    expect.soft([...calls].filter((c) => !ALLOWED_VIEWER_CALLS.has(c)).sort()).toEqual([])
  })
})

describe('3. Locate…: a model missing at the open, brought in through the real locate path', () => {
  it('located after the project has booted: every element where the baseline drew it', async () => {
    await loadOneByOne(['ARC', 'STR'])
    const base = drawnWorld()
    const file = save()
    freshWindow()
    await reopen(file, ['STR'])
    await until('ARC to boot alone', () => settled(['ARC']))
    locateAnswer = { file: picked('STR'), refused: null }
    await locateModel(file.models.find((m) => m.name === 'STR.ifc')!.id)
    await until('STR to be located and join', () => settled(['ARC', 'STR']))
    expect.soft(offsets(), log.handled.join(', ')).toEqual([])
    expect.soft(moved(base, drawnWorld())).toEqual([])
    expect.soft(separationProblem(drawnWorld())).toBeNull()
    expect.soft([...new Set(viewerCalls)].filter((c) => !ALLOWED_VIEWER_CALLS.has(c)).sort()).toEqual([])
  })

  it('located while the project’s own model is still parsing: every element where the baseline drew it', async () => {
    await loadOneByOne(['ARC', 'STR'])
    const base = drawnWorld()
    const file = save()
    freshWindow()
    await reopen(file, ['STR'])
    // ARC's parse holds the worker for 2 s; Locate… is answered well inside it.
    await vi.advanceTimersByTimeAsync(300)
    expect(useShell.getState().booted).toBe(false)
    locateAnswer = { file: picked('STR'), refused: null }
    await locateModel(file.models.find((m) => m.name === 'STR.ifc')!.id)
    await until('both to load together', () => settled(['ARC', 'STR']))
    expect.soft(offsets(), log.handled.join(', ')).toEqual([])
    expect.soft(moved(base, drawnWorld())).toEqual([])
    expect.soft(separationProblem(drawnWorld())).toBeNull()
    expect.soft([...new Set(viewerCalls)].filter((c) => !ALLOWED_VIEWER_CALLS.has(c)).sort()).toEqual([])
  })
})

describe('three models opened together, the middle one’s geometry failing', () => {
  /**
   * 2026-11-11, review round 1: ARC, STR and MEP parse before ARC's geometry is done, so STR's
   * geometry waits behind ARC's and MEP's behind STR's (`worker-bridge.ts` `geometry`). ARC
   * chooses the offset; STR is sent with it and its stream fails; MEP must still be sent with
   * ARC's offset — not with `null`, which would let it choose one of its own and be drawn shifted.
   * STR's stream is made to fail the way a real one can: its model is closed in the worker
   * (`federation.forget`) after it parsed and before its held request reaches the worker.
   */
  const MEP: ModelSpec = {
    name: 'MEP',
    guidPrefix: '3',
    boxes: [
      { name: 'MEP duct', at: [20000, 25000, 6000], size: [5000, 600, 400] },
      { name: 'MEP riser', at: [26000, 25000, 0], size: [500, 500, 6000] }
    ]
  }
  const ALL = { ARC: SPECS.ARC, STR: SPECS.STR, MEP } as const
  type Three = keyof typeof ALL
  const THREE = Object.keys(ALL) as Three[]
  const bytes3 = Object.fromEntries(THREE.map((k) => [k, new TextEncoder().encode(boxModel(ALL[k]))])) as Record<Three, Uint8Array>
  const path3 = (k: Three): string => `/projects/synthetic/review/models/${k}.ifc`
  const key3 = (path: string): Three => THREE.find((k) => path3(k) === path)!

  beforeEach(() => {
    const w = window as unknown as { sgvue: Record<string, unknown> }
    w.sgvue.admitPaths = async (paths: string[]) => ({
      files: paths.map((p) => ({ path: p, name: `${key3(p)}.ifc`, size: bytes3[key3(p)].length })),
      refused: []
    })
    vi.stubGlobal('fetch', async (url: string) => {
      const key = key3(decodeURIComponent(url.replace('sgvue-file://t/', '')))
      const blob = new Blob([bytes3[key] as BlobPart])
      blobBytes.set(blob, bytes3[key])
      return { ok: true, status: 200, blob: async () => blob }
    })
  })

  it('the two that load share one offset, the store’s; MEP is where its file puts it; STR shows its error row', async () => {
    await openPaths(THREE.map(path3))
    // Every parse is in the worker's queue ahead of ARC's geometry: STR is open there.
    await until('MEP’s parse to start', () => log.handled.includes('parse MEP'))
    expect(log.handled.includes('geometry ARC')).toBe(false)
    federation.forget('STR')
    const s = (): ReturnType<typeof useShell.getState> => useShell.getState()
    await until('ARC and MEP to load, STR to fail', () => {
      const keys = loadedKeys()
      return s().booted && s().ready && keys.join() === 'ARC,MEP' && s().uploads.some((u) => u.name === 'STR.ifc' && u.error)
    })
    const store = s().offset
    const streamed = log.geometry.filter((g) => g.summary).map((g) => [g.modelKey, g.summary!.offset])
    expect.soft(streamed.map(([k]) => k).sort()).toEqual(['ARC', 'MEP'])
    for (const [key, offset] of streamed) expect.soft(offset, `${String(key)} streamed against`).toEqual(store)
    for (const key of ['ARC', 'MEP']) expect.soft(drawnModels.get(key)?.offset, `${key} handed to the viewer`).toEqual([...store])
    // Every element of MEP (and ARC) has exactly its file's corners, within 1 mm.
    const now = drawnWorld()
    const ids = idsByName()
    const off: string[] = []
    for (const key of ['ARC', 'MEP'] as const) {
      for (const b of ALL[key].boxes) {
        const pts = now.get(ids.get(b.name) ?? '')
        if (!pts) {
          off.push(`${b.name}: not drawn`)
          continue
        }
        const corners = boxCorners(b)
        for (const c of corners) if (!pts.some((p) => dist(p, c) <= TOL_M)) off.push(`${b.name}: no drawn vertex at its corner ${fmt(c)}`)
        const stray = pts.filter((p) => !corners.some((c) => dist(p, c) <= TOL_M))
        if (stray.length) off.push(`${b.name}: ${stray.length} drawn vertices on none of its corners, e.g. ${fmt(stray[0])}`)
      }
    }
    expect.soft(off, log.handled.join(', ')).toEqual([])
    expect.soft(drawnModels.has('STR')).toBe(false)
  })
})
