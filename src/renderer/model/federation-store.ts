/**
 * The federation controller — everything that owns model *data* on the renderer side, in one
 * place: the frozen indexes, the parse worker, the SQL index, the geometry stream and the live
 * `Viewer` handle.
 *
 * It is the design's `buildFederation` / `boot` / `setModels` (`SGVue.dc.html:909–928`) with
 * one structural difference, and it is invisible: the design hands its renderer a finished
 * federation at construction, so adding or removing a model rebuilds the whole viewer and then
 * restores the camera. Ours is streamed — `viewer.addModel` / `viewer.removeModel` — so the
 * camera is never disturbed in the first place and there is nothing to restore.
 *
 * The store (`state/shell.ts`) is told about a new federation through `commitModels`, which
 * applies the design's own pruning rules.
 */
import {
  federate,
  localIdRefusal,
  removeModel,
  EMPTY_FEDERATION,
  type Federation
} from '../../shared/federate'
import {
  federationFrame,
  mapPlacement,
  modelFrame,
  toProject,
  type ProjectFrame
} from '../../shared/georef'
import { isSiteLike } from '../../shared/site'
import type { FederationOffset, GeometryChunk } from '../../shared/geometry-contract.types'
import type { Georeference, ModelIndex, Units } from '../../shared/model-index.types'
import { DEFAULT_DISPLAY_UNIT, displayUnitOf } from '../../shared/units'
import type { SessionFile } from '../../shared/session-codec'
import { useShell, setViewer } from '../state/shell'
import type { ModelMeta, Viewer } from '../viewer/viewer-core'
import { elementBoxes } from './element-boxes'
import { deepFreeze } from './store'
import { SqlBridge, type SqlQueryResult } from './sql-bridge'
import { ParseWorkerBridge, type ParseProgress } from './worker-bridge'
import type { RawLine } from '../../worker/index-builder'

const n = (value: number): string => value.toLocaleString('en-US')

/** One model in an `addBatch` call: its index, its geometry and where the federation sits. */
export interface BatchItem {
  index: ModelIndex
  chunks: GeometryChunk[]
  offset: FederationOffset
  /**
   * The frame the chunks were streamed in — this model's own, project → its world
   * (`shared/georef.ts`'s `modelFrame`, M_i⁻¹ ∘ P since 2026-10-08) — which its grids and
   * storeys go through too. `null` is the identity.
   */
  frame: ProjectFrame | null
  /**
   * The file it came from, for the session and the share link. Recorded when the model
   * **joins**, not when it parses: a replacement parses under the key of the model still on
   * screen, and that model's file is the one a session saved in between must name.
   */
  file?: SessionFile
}

/** A chosen file, its bytes already streamed over `sgvue-file://` (`main/file-protocol.ts`). */
export interface PreparedFile {
  path: string
  name: string
  blob: Blob
  /** The model key the pipeline chose (`upload-pipeline.ts`). Omitted, it is the file's stem. */
  key?: string
}

/**
 * A model's key: the file's stem. It is the identity the federation, the store, the worker
 * and the session all key on, and a path would leak into the sidebar rows. Since 2026-09-24 a
 * pick whose key is already open or loading is **confirmed and replaces it** rather than
 * joining as `name (2)`; only a second file of the same stem **within one pick** gets ` (2)`.
 */
export const modelKeyOf = (fileName: string): string =>
  fileName.replace(/\.[^.]+$/, '') || fileName

/**
 * What `addModel` needs from an index to place grids and storeys in scene coordinates.
 *
 * A grid is its **segment**, not the design's `{ axis, v }`: a real `IfcGridAxis` is a curve
 * and the 137.9 MB reference model's grid runs at ~43° with no axis-aligned axis at all
 * (`shared/annotate.ts`). The viewer clips each one to the padded footprint itself.
 *
 * Both come out of the index in the file's **world** coordinates — `readGrids` applies the
 * placement chain by hand, and a storey's placement is the world position of its floor — so
 * both go through the model's own frame here (`BatchItem.frame`, M_i⁻¹ ∘ P), which is the same
 * transform the geometry went through in the worker. The viewer then subtracts the offset, as
 * before. Exported for `tests/unit/georef-federation.fixture.test.ts`.
 *
 * A storey with no placement of its own falls back to its authored `Elevation`, which is what
 * the ladder shows: the ring is then where the file's own number puts it rather than nowhere.
 */
export const metaOf = (
  index: ModelIndex,
  offset: FederationOffset,
  frame: ProjectFrame | null
): ModelMeta => ({
  offset,
  frame,
  grids: index.grids.map((g) => {
    const [sx, sy] = toProject(frame, g.start[0], g.start[1], 0)
    const [ex, ey] = toProject(frame, g.end[0], g.end[1], 0)
    return { name: g.name, start: [sx, sy] as const, end: [ex, ey] as const }
  }),
  storeys: index.storeys.map((s) => ({
    name: s.name,
    elev: s.placement ? toProject(frame, s.placement[0], s.placement[1], s.placement[2])[2] : s.elev,
    // The authored `Elevation`, untouched by the frame and by the offset: the ladder's number,
    // and the one the 3D level tag prints beside the ring.
    authored: s.elev
  })),
  // 2026-09-24: the site's elements, which the viewer leaves out of the box it frames.
  site: index.elements.filter(isSiteLike).map((e) => e.expressId)
})

/** What one `prepare` has done so far, for its failure path. */
interface Preparing {
  /** Its file was parsed: the worker holds it open under its key. */
  done: boolean
  /** The choice of frame (`frameEpoch`) it was streamed in, or `null` before its stream. */
  epoch: number | null
}

/**
 * 2026-10-09 — refuse a model whose ids would not fit inside its own block of federation ids
 * (`shared/federate.ts`, `ID_STRIDE`), with the sentence its upload row shows. Thrown from
 * `prepare`, so the row is the file's own and nothing of the model has reached the scene.
 */
function refuseUnnumberable(ids: Iterable<number>): void {
  const refusal = localIdRefusal(ids)
  if (refusal) throw new Error(refusal)
}

/** Every element id a model's geometry parts name, chunk by chunk. */
function* partElementIds(chunks: readonly GeometryChunk[]): Generator<number> {
  for (const chunk of chunks) for (const part of chunk.parts) yield part.elementId
}

/** The lowest slot no loaded model holds — the slot `federate` gives a new key. */
const freeSlot = (federation: Federation): number => {
  const used = new Set(federation.models.map((m) => m.slot))
  let slot = 0
  while (used.has(slot)) slot++
  return slot
}

export class FederationController {
  private readonly parse = new ParseWorkerBridge()
  private readonly sql = new SqlBridge()
  private readonly indexes: ModelIndex[] = []
  /** modelKey → the file it came from, for the session and the share link. */
  private readonly files = new Map<string, SessionFile>()
  /** The first model's first mesh fixes this; every later model is placed against it. */
  private offset: FederationOffset | null = null
  /**
   * The georeferencing of the first model *prepared* — the boot model — which fixes the
   * federation's frame, P = M_boot ∘ Site_boot (`shared/georef.ts`'s `federationFrame`), and
   * the base point that describes it. Every model, that one included, is streamed through its
   * own `modelFrame(boot, its georef)` = M_i⁻¹ ∘ P: since 2026-10-08 the federation lines up in
   * **map** space — each model where its own declaration puts it — while the scene stands
   * square with the first building.
   *
   * `null` is a legitimate value (a model loaded with no file behind it), so a separate flag
   * records that it has been chosen rather than `??=` asking again on the next model.
   */
  private bootGeoref: Georeference | null = null
  /**
   * 2026-10-09 — the same model's unit assignment, taken with `bootGeoref`: the display unit the
   * app starts in (`shared/units.ts`, `displayUnitOf`). Cleared with it.
   */
  private bootUnits: Units | null = null
  private frameChosen = false
  /**
   * How many models have been streamed in the frame `bootGeoref` fixes, and which choice of
   * frame that is. A model that then fails to prepare gives the choice back when it was the last
   * of them and nothing is loaded (`handBack`); any other stands in that frame, and keeps it.
   */
  private frameUsers = 0
  private frameEpoch = 0
  private federation: Federation = EMPTY_FEDERATION
  private viewer: Viewer | null = null
  /**
   * The newest SQL build, chained so two never overlap. `query` waits on it, so a question
   * asked while the index is still being built — it builds after the reveal since
   * 2026-09-24 — waits for the index of the federation on screen rather than failing or
   * reading an older one. Never rejects: a failed build is logged, and the query then fails
   * with the bridge's own "no model database" sentence.
   */
  private sqlReady: Promise<void> = Promise.resolve()
  /**
   * Bumped by `resetUnshown` and `dispose`. A `prepare` or an `addBatch` that finds it changed
   * belongs to a load the landing page has replaced, and stops without touching anything.
   */
  private gen = 0
  /**
   * How a path-less key becomes a loaded model: the design's own federation. The landing
   * page's demo button registers it in production builds (`upload-pipeline.ts` `openDemo`),
   * and `#mock` does in a dev build, which is what makes the parity states reachable. A real
   * library entry carries a path and goes through the upload pipeline, never through here.
   */
  private libraryLoader: ((key: string) => Promise<BatchItem>) | null = null

  attach(viewer: Viewer | null): void {
    this.viewer = viewer
    setViewer(viewer)
  }

  setLibraryLoader(fn: ((key: string) => Promise<BatchItem>) | null): void {
    this.libraryLoader = fn
  }

  /** The demo building and the `#mock` entry: one boot batch. */
  async addLibraryFiles(keys: readonly string[]): Promise<void> {
    if (!this.libraryLoader) return
    const items: BatchItem[] = []
    for (const key of keys) items.push(await this.libraryLoader(key))
    await this.addBatch(items)
  }

  get current(): Federation {
    return this.federation
  }

  /** Put one already-parsed model into the federation and the scene, as a batch of one. */
  addModel(
    index: ModelIndex,
    chunks: GeometryChunk[],
    offset: FederationOffset,
    frame: ProjectFrame | null = null
  ): Promise<void> {
    return this.addBatch([{ index, chunks, offset, frame }]).then(() => undefined)
  }

  /**
   * Add several models as **one batch**, which is what decides the camera.
   *
   * `SGVue.dc.html:1096` (`boot`) builds the whole federation, *then* creates the viewer, so
   * the framing happens once with every model present; `:917` (`setModels`) reads the camera,
   * rebuilds, and puts it back, so every later change preserves it. Streaming the models in
   * one at a time loses that distinction unless it is stated here: a batch that takes the
   * federation from empty is a boot and frames at the end; any other batch keeps the camera,
   * which our streaming renderer does for free because it is never rebuilt.
   *
   * This is also the only place the federation changes shape, so it is the only place
   * `commitModels` is called — once per batch, as the design commits once per boot.
   *
   * 2026-09-24 — `reveal`, when given, is what the commit waits for once every model is in the
   * scene: the landing page's 1 100 ms tick hold, so the build overlaps the hold rather than
   * following it. Resolves `false` when nothing was committed — no viewer, nothing to add, or
   * the landing page replaced this load with a newer pick while it waited (`resetUnshown`).
   */
  async addBatch(items: readonly BatchItem[], reveal?: Promise<unknown>): Promise<boolean> {
    if (!this.viewer || !items.length) return false
    const gen = this.gen
    const boot = this.federation.models.length === 0
    useShell.getState().beginModels(boot ? 'Building federation…' : 'Rebuilding federation…')
    // The first model of a boot fixes the federation offset for the session — every later
    // model is streamed against it. The store keeps it so the property card can report a box
    // in the file's own coordinates rather than the scene's — and, beside it, P, whose
    // `frameKey` marks every camera a session, a link or a viewpoint saves, and the boot
    // model's georeferencing that defined P, which the base point is read off (2026-10-08: set
    // once, here, and never by a model that joins later — the card is read-only).
    if (boot) {
      useShell.getState().setOffset(items[0].offset, federationFrame(this.bootGeoref), this.bootGeoref)
      // 2026-10-09 (owner-requested: *"Starts in the first model's unit"*): every boot starts in
      // the boot model's own length unit — `mm`, `m` or `ft` — and the design's `mm` when it
      // names none. A model that joins later leaves the unit alone; a session or a link that
      // states one restores it over this, after the batch (`upload-pipeline.ts`). The demo and
      // `#mock` choose no frame (they are not parsed), so their first model is the boot model.
      const units = this.frameChosen ? this.bootUnits : items[0].index.units
      useShell.getState().setUnits((units && displayUnitOf(units)) ?? DEFAULT_DISPLAY_UNIT)
    }
    /** Keys this batch joined, and which of them replaced a model, for the undo below. */
    const joined: string[] = []
    const replaced = new Set<string>()
    let at = ''
    try {
      for (const item of items) {
        at = item.index.modelKey
        const how = await this.joinOne(item, gen)
        // Replaced by a newer pick on the landing page while it streamed in (`resetUnshown`),
        // which took out everything joined before it: nothing of this batch is shown.
        if (how === 'stale') return false
        if (how === 'replaced') replaced.add(at)
        joined.push(at)
      }
    } catch (err) {
      this.undoBatch(at, joined, replaced, boot)
      throw err
    }
    if (boot) this.viewer.frameExtents()
    if (reveal) await reveal
    if (gen !== this.gen) return false
    useShell.getState().commitModels(this.federation)
    // The SQL property index is rebuilt once per batch rather than once per model: it is
    // built from the whole federation, so N models joining together cost one build. Since
    // 2026-09-24 it builds **after** the commit, behind the model already on screen.
    this.rebuildSql()
    return true
  }

  /**
   * One model into the scene and the federation, and whether it replaced one — or `stale`
   * when the landing page replaced the whole load while it streamed in.
   *
   * It takes the lowest free slot, which is what `federate` would give it. A replacement
   * (2026-09-24, `upload-pipeline.ts`) keeps the key but takes a slot **beside** the model it
   * replaces: the viewer streams it in next to the old one and drops the old one only once
   * every chunk is in (refactor pass 2), so a replacement that fails to join leaves the model
   * on screen as it was. Not a boot: the camera, the offset and the frame all stay.
   */
  private async joinOne(
    { index, chunks, offset, frame, file }: BatchItem,
    gen: number
  ): Promise<'joined' | 'replaced' | 'stale'> {
    const key = index.modelKey
    const replacing = this.isOpen(key)
    const slot = freeSlot(this.federation)
    await this.viewer!.addModel(key, slot, chunks, metaOf(index, offset, frame))
    if (gen !== this.gen) {
      this.viewer!.removeModel(key)
      return 'stale'
    }
    if (replacing) this.dropReplaced(key)
    if (file) this.files.set(key, file)
    this.indexes.push(index)
    // The slot is the one the viewer was given: `federate` keeps a model on the slot the
    // previous federation had it on, so it is handed that — the freed one may be lower.
    this.federation = federate(this.indexes, {
      ...this.federation,
      models: [...this.federation.models, { slot, meta: index }]
    })
    return replacing ? 'replaced' : 'joined'
  }

  /**
   * Refactor pass 2 — a batch whose join failed undoes itself. The model that failed has
   * already taken itself out of the scene (`viewer.addModel`), and its file is closed in the
   * worker: a replacement's file had already taken the key there, and the model left on screen
   * is the old one. Every model this batch added before it is removed again. One that
   * **replaced** a model stays — the model it replaced is gone — so the federation is committed
   * again when anything changed, and otherwise the loading state simply ends. A boot that
   * fails leaves nothing behind, and the landing page takes it from there.
   */
  private undoBatch(failed: string, joined: readonly string[], replaced: ReadonlySet<string>, boot: boolean): void {
    this.parse.close(failed)
    for (const key of [...joined].reverse()) {
      if (replaced.has(key)) continue
      this.unjoin(key)
      this.files.delete(key)
      this.parse.close(key)
    }
    if (!this.federation.models.length) this.resetFrame()
    if (boot) return
    if (replaced.size) {
      useShell.getState().commitModels(this.federation)
      this.rebuildSql()
    } else {
      useShell.setState({ ready: true })
    }
  }

  /**
   * Nothing is loaded: the next model to boot chooses the offset and the frame afresh — and the
   * base point goes with them (2026-10-08: it used to stay, and the next boot left it standing).
   */
  private resetFrame(): void {
    this.offset = null
    this.bootGeoref = null
    this.bootUnits = null
    this.frameChosen = false
    this.frameEpoch++
    this.frameUsers = 0
    useShell.getState().setOffset([0, 0, 0], null, null)
  }

  /**
   * 2026-10-08 — a model that fails to prepare after it was streamed gives back what it fixed of
   * the federation — the choice of frame its parse may have made, and the offset its stream may
   * have set — when it was the last model streamed in that frame and nothing is loaded. The next
   * model then chooses afresh, so the frame, every camera's `frameKey` and the base point never
   * describe a model that is not there. A model that has been streamed in that frame stands in
   * it, so while one does, the frame stays.
   */
  private handBack(preparing: Preparing): void {
    if (preparing.epoch !== this.frameEpoch) return
    this.frameUsers--
    if (this.frameUsers > 0 || this.federation.models.length) return
    this.offset = null
    this.bootGeoref = null
    this.bootUnits = null
    this.frameChosen = false
    this.frameEpoch++
  }

  /**
   * Rebuild the SQL index for the federation as it now stands, a painted frame after the
   * commit so the build's hand-off to its worker cannot hold up the reveal.
   *
   * It is deliberately not fatal. The index is what the assistant queries (Phase 9); the
   * model renders, is selectable and is reviewable without it, so a worker that will not
   * start must not turn a loaded model into a landing-page error.
   */
  private rebuildSql(): void {
    const gen = this.gen
    this.sqlReady = this.sqlReady.then(async () => {
      try {
        await afterPaint()
        if (gen !== this.gen) return
        const built = await this.buildSql()
        const boxed = this.federation.elements.filter((e) => e.bbox).length
        console.log(
          `[sgvue] SQL index ${built.ms} ms · ${n(built.elements)} elements · ` +
            `${n(boxed)} with a bounding box`
        )
      } catch (err) {
        console.error('[sgvue] SQL index unavailable —', err)
      }
    })
  }

  /** What the session remembers about each loaded model — `shared/session-codec.ts`. */
  sessionFiles(): SessionFile[] {
    const out: SessionFile[] = []
    for (const m of this.federation.models) {
      const file = this.files.get(m.meta.modelKey)
      // The slot is what the element ids in the same session are numbered by (P5).
      if (file) out.push({ ...file, slot: m.slot })
    }
    return out
  }

  /**
   * `SGVue.dc.html:1813`'s `md.remove`. Every surviving element keeps the id it had — that is
   * what the federation slot is for — so the store only *prunes*, never remaps.
   */
  async removeModel(modelKey: string): Promise<void> {
    if (!this.viewer || !this.isOpen(modelKey)) return
    useShell.getState().beginModels('Rebuilding federation…')
    this.unjoin(modelKey)
    this.files.delete(modelKey)
    this.parse.close(modelKey)
    if (!this.federation.models.length) this.resetFrame()
    useShell.getState().commitModels(this.federation)
    // Queued behind any build still running, and `query` waits for it: a question asked in
    // between is answered from the federation that is left, never the one before the removal.
    this.rebuildSql()
  }

  /** True while a model with this key is in the federation (or joining it, under a hold). */
  isOpen(modelKey: string): boolean {
    return this.indexes.some((x) => x.modelKey === modelKey)
  }

  /**
   * The scene half of a removal: the index, the viewer's parts and the federation's rows.
   * `scene: false` leaves the viewer alone — it has already swapped the model out itself.
   */
  private unjoin(modelKey: string, scene = true): readonly number[] {
    const at = this.indexes.findIndex((x) => x.modelKey === modelKey)
    if (at >= 0) this.indexes.splice(at, 1)
    if (scene) this.viewer?.removeModel(modelKey)
    const { federation, droppedIds } = removeModel(this.federation, modelKey)
    this.federation = federation
    return droppedIds
  }

  /**
   * 2026-09-24 — `removeModel` for a model a confirmed pick replaces. The worker's open file
   * already belongs to the replacement, which parsed under the same key, and the viewer has
   * already swapped the old model's parts for the new one's (`joinOne`), so only the index and
   * the federation's rows go here; and the batch's one commit stands in for the removal's own,
   * so the federation is never committed empty — which would drop the viewer back to the
   * landing page and re-seed the assistant. What that commit prunes by key or by id is pruned
   * now instead, so nothing of the old model's — hidden ids, its colour, `active` — carries
   * over to the new one.
   */
  private dropReplaced(modelKey: string): void {
    const gone = new Set(this.unjoin(modelKey, false))
    // Not redundant although the replacement now has a slot of its own: the old model's slot
    // is free from here on, and a later model of the same batch can take it — and with it the
    // very ids that would otherwise inherit the old model's hidden elements.
    const s = useShell.getState()
    const hidden: Record<number | string, boolean> = {}
    for (const id of Object.keys(s.hidden)) if (!gone.has(+id)) hidden[id] = true
    const modelColors = { ...s.modelColors }
    delete modelColors[modelKey]
    useShell.setState({ hidden, modelColors, active: s.active === modelKey ? null : s.active })
  }

  /**
   * 2026-09-24 — a parse that finished after a newer pick of the same key superseded it: its
   * file is closed in the worker before the newer one opens. Its store entry is simply
   * overwritten by the newer one's.
   */
  forget(modelKey: string): void {
    this.parse.close(modelKey)
  }

  /**
   * 2026-09-24 — the landing page's fresh start: forget every model that has not been shown
   * yet — still parsing, parsed and waiting to join, or joined behind the landing page during
   * the tick hold — and terminate the parse worker, so the next pick starts from nothing and
   * none of the replaced load's frame, offset, keys or coordinates carries over. Called only
   * while nothing is booted, or while the demo building is what is on screen (refactor pass 2,
   * P9); after boot a new file joins the federation instead.
   */
  resetUnshown(): void {
    this.gen++
    this.parse.cancel('replaced by a new pick')
    for (const m of this.federation.models) this.viewer?.removeModel(m.meta.modelKey)
    this.files.clear()
    this.indexes.length = 0
    this.federation = EMPTY_FEDERATION
    this.offset = null
    this.bootGeoref = null
    this.bootUnits = null
    this.frameChosen = false
    this.frameEpoch++
    this.frameUsers = 0
    // The offset, the frame, the declaration that defined it and the base point, all cleared.
    useShell.getState().setOffset([0, 0, 0], null, null)
    // A batch that committed and was then refused (`bootFailed`) is still in the store's lists.
    if (useShell.getState().loaded.length) useShell.getState().commitModels(this.federation)
  }

  /**
   * Parse one chosen file into a `BatchItem`, reporting the **real** milestone it has reached
   * as an index into the design's five stages (`shared/upload.ts`). It does not join the
   * federation: that is `addBatch`, called once for every file in the drop, so the camera is
   * framed once — Phase 3's finding, and the design's own `boot` / `setModels` split.
   *
   * `modelKey` is the one the pipeline chose (`modelKeyOf`). When it is already open this is
   * a confirmed replacement: the model on screen is left alone until the new one joins, and a
   * parse that fails leaves it there. The worker swaps the old file for the new one only once
   * the new one has parsed; a failure after that — the geometry stream — closes the new one,
   * so the key never answers raw-line requests from a file that is not on screen.
   */
  async prepare(file: PreparedFile, onStage: (index: number) => void): Promise<BatchItem> {
    const gen = this.gen
    const modelKey = file.key ?? modelKeyOf(file.name)
    const parsed: Preparing = { done: false, epoch: null }
    try {
      return await this.parseInto(file, modelKey, gen, onStage, parsed)
    } catch (err) {
      if (parsed.done && gen === this.gen) this.parse.close(modelKey)
      if (gen === this.gen) this.handBack(parsed)
      throw err
    }
  }

  private async parseInto(
    file: PreparedFile,
    modelKey: string,
    gen: number,
    onStage: (index: number) => void,
    parsed: Preparing
  ): Promise<BatchItem> {
    const replaced = (): Error => new Error('replaced by a new pick')
    const started = performance.now()
    onStage(0)
    let sawIndexStage = false
    const index = await this.parse.load(file.blob, modelKey, (p: ParseProgress) => {
      // The worker's first non-`reading` stage is web-ifc walking the entity graph.
      if (!sawIndexStage && p.stage !== 'reading') {
        sawIndexStage = true
        onStage(1)
      }
    })
    parsed.done = true
    if (gen !== this.gen) throw replaced()
    // 2026-10-09 — a model whose ids would not fit its block is refused here, in its own upload
    // row, before it can number into another model's (`shared/federate.ts`, `ID_STRIDE`).
    refuseUnnumberable(index.elements.map((e) => e.id))
    onStage(2)
    // The first model prepared is the boot model: its georeferencing fixes the federation's
    // frame P. Every model — that one included — streams through its own frame, M_i⁻¹ ∘ P, so
    // the federation lines up by map coordinates, each model by its own declaration.
    if (!this.frameChosen) {
      this.bootGeoref = index.georef
      this.bootUnits = index.units
      this.frameChosen = true
      this.frameEpoch++
      this.frameUsers = 0
    }
    const frame = modelFrame(this.bootGeoref, index.georef)
    this.frameUsers++
    parsed.epoch = this.frameEpoch
    const chunks: GeometryChunk[] = []
    const summary = await this.parse.geometry(modelKey, this.offset, frame, (chunk) =>
      chunks.push(chunk)
    )
    if (gen !== this.gen) throw replaced()
    // A product drawn but not indexed (a site's own terrain, an annotation) is numbered too.
    refuseUnnumberable(partElementIds(chunks))
    this.offset = summary.offset
    /*
     * The two halves of the model meet here. The parse cannot fill `IfcElement.bbox` or
     * `solidCount`, because geometry is a second worker request (2026-09-17) and the index has
     * already been sent by the time the first part exists; the geometry stream cannot write
     * them either, because it has no index. So both are taken off the parts that have just
     * landed, in one pass, and written onto the index **before** it is frozen into the store
     * below — the same place and the same shape the mock adapter fills its own. Every consumer
     * of `bbox` — `clash_check`, `measure_between`, `get_element` and the SQL `bbox` table —
     * therefore needs no second path. (The property card is not one of them: it reads
     * `viewer.elementBox()` and `viewer.solidCount()`, the same two numbers taken from the same
     * parts on the renderer's side, and `scripts/shell-sanity.cjs`'s `boxes` block checks the
     * two against each other on a real model.)
     *
     * An element with no geometry keeps neither — never a zero count and never a placeholder
     * box, which is what those consumers already test for.
     */
    const geometry = elementBoxes(chunks, summary.offset)
    for (const element of index.elements) {
      const own = geometry.get(element.id)
      if (!own) continue
      element.bbox = own.box
      element.solidCount = own.parts
    }
    // 2026-10-08 — how far this model landed from the offset another model set, when the stream
    // said it was far: the Coordinate-system card's note reads it. The model that set the offset
    // measured against its own first part, which says nothing about the others, so it has none.
    const far = summary.warnings.find((w) => w.kind === 'farPlacement')
    if (far && !summary.offsetFromThisModel) index.farPlacementMetres = far.metres
    // Freezing the index walks every element and every property set it carries — `deepFreeze`
    // — which is what "indexing properties" is on this side.
    onStage(3)
    const { elements, ...meta } = index
    deepFreeze(meta)
    for (const element of elements) deepFreeze(element)
    onStage(4)
    if (summary.frame) {
      const f = summary.frame
      console.log(
        `[sgvue] model frame · origin ${f.origin.map((v) => v.toFixed(3)).join(', ')} m · ` +
          `${f.rotationDeg.toFixed(4)}° · ${index.georef.method} · placed by ` +
          mapPlacement(index.georef).placedBy
      )
    }
    console.log(
      `[sgvue] ${file.name} parsed in ${((performance.now() - started) / 1000).toFixed(2)} s · ` +
        `${n(index.elements.length)} elements · ${index.schema} · ` +
        `${summary.chunks} geometry chunks · sha-256 ${index.sha256.slice(0, 12)}`
    )
    return {
      index,
      chunks,
      offset: summary.offset,
      frame: summary.frame,
      file: { key: modelKey, path: file.path, name: file.name, sha256: index.sha256 }
    }
  }

  /**
   * One read-only SQL query, for the assistant's `query_sql` tool. The guard's own refusal
   * and the ten-second kill both arrive as a rejection with the sentence that explains them.
   */
  query(sql: string): Promise<SqlQueryResult> {
    return this.sqlReady.then(() => this.sql.query(sql))
  }

  /**
   * One shallow STEP line with its references resolved a single level, for
   * `get_entity_raw`. Read-only by construction: `ReadOnlyIfcSource` seals every write API.
   */
  rawLine(modelKey: string, expressId: number): Promise<RawLine | null> {
    return this.parse.rawLine(modelKey, expressId)
  }

  private buildSql(): Promise<{ elements: number; ms: number }> {
    return this.sql.build({
      models: this.federation.models,
      elements: this.federation.elements
    })
  }

  dispose(): void {
    this.gen++
    this.sqlReady = Promise.resolve()
    this.parse.cancel('window unmounted')
    this.sql.dispose()
    this.files.clear()
    this.indexes.length = 0
    this.federation = EMPTY_FEDERATION
    this.offset = null
    this.bootGeoref = null
    this.bootUnits = null
    this.frameChosen = false
    this.frameEpoch++
    this.frameUsers = 0
    this.attach(null)
  }
}

/**
 * Resolves once the frame already scheduled has been painted — or after 250 ms, because a
 * hidden window paints nothing and the work must still happen. Outside a window (the unit
 * tests) there is no frame to wait for.
 */
export const afterPaint = (): Promise<void> =>
  new Promise((done) => {
    if (typeof requestAnimationFrame !== 'function') return void setTimeout(done, 0)
    const fallback = setTimeout(done, 250)
    requestAnimationFrame(() =>
      setTimeout(() => {
        clearTimeout(fallback)
        done()
      }, 0)
    )
  })

/**
 * One controller per window, as the design has one component instance. Both its workers are
 * spawned on first use, so importing this costs nothing.
 */
export const federation = new FederationController()
