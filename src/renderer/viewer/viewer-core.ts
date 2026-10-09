/**
 * The viewer — `design-reference/design/viewer-core.js` ported to TypeScript.
 *
 * Same public API, same callbacks, same numbers. What is different is invisible and is
 * forced by size: the reference builds one `THREE.Mesh` and one `LineSegments` per part and
 * swaps `mesh.material` per element, which is ~26 500 draw calls and about 12 fps on a real
 * 144 MB model (`CLAUDE.md`, rendering traps). Here parts are merged into a few dozen slot
 * meshes (`batches.ts`), edges are index ranges in per-chunk line buffers (`edges.ts`), and
 * the whole material bank collapses into a per-part RGBA texture (`part-state.ts`) —
 * `applyElement` below is the reference's `applyMat` (L487–498) with a colour written instead
 * of a material assigned.
 *
 * The other structural difference: the reference is handed its finished federation at
 * construction. This one is streamed — `addModel(modelKey, slot, chunks)` — so the scene
 * constants that derive from the bounding box are rebuilt whenever the box changes, with the
 * camera carried across.
 *
 * 2a built the scene; 2b added the interaction layer — `picking.ts` (hit testing),
 * `input.ts` (the pointer model), `snap.ts` (snapping and its marker), `overlay.ts` (the DOM
 * label system) and `cube.ts` (the view cube). Phase 6 adds the annotation layer:
 * `annotations.ts` (gridlines and their bubbles, level rings and tags, the laser meter, spot
 * coordinates and the selection dimensions) and `section.ts` (the cut plane, its outline and
 * the preview sheet), with `shared/annotate.ts` holding the arithmetic.
 *
 * 2026-10-01 (owner-requested): the section is **two planes** — the gridline cut and the level
 * cut — set together through `setSections({ grid, level })`. The planes that are cutting are
 * kept here in one list, which the materials (`setClip`), the picker and the laser ray, the
 * snap and the cut outline all read.
 *
 * 2026-10-02 — the assistant's camera (`set_view`, through the store's `fitView` and
 * `aimCamera`): `zoomExtents` and `zoomTo` take an optional zoom factor on their fit, and
 * `lookAlong(theta, phi)` turns the camera to any direction. Each asks for a frame.
 *
 * The same day, phase 4 — the assistant's markups (`manage_markups`): `placeSpot` and
 * `placeMeasure` run the very commit a click with the spot tool or the laser meter runs
 * (`commitSpot` / `commitLaser`), at a scene point the caller names instead of one the pointer
 * found, and `showSpot` sets a spot tag's state as a click on the tag toggles it. Nothing is
 * imitated: the records, the labels, the numbering and the rays are the click's own.
 */
import type { Object3D } from 'three/webgpu'
import { Box3, Vector2, Vector3 } from 'three/webgpu'
import type { BasePoint, ProjectFrame } from '../../shared/georef'
import type { GeometryChunk } from '../../shared/geometry-contract.types'
import type { Annotations, MeasureRecord, SpotRecord, SpotShown } from './annotations'
import { createAnnotations } from './annotations'
import type { DimRect } from '../../shared/annotate'
import { fedId } from '../../shared/federate'
import type { DisplayUnit } from '../../shared/units'
import type { BatchStore, ElementRecord } from './batches'
import { createBatchStore } from './batches'
import type { CameraRig, CameraState, Projection } from './camera'
import { createCameraRig, dirOf } from './camera'
import type { ViewCube } from './cube'
import { createViewCube } from './cube'
import type { EdgeStore } from './edges'
import { createEdgeStore } from './edges'
import type { InputHandle } from './input'
import { attachInput, canvasNdc } from './input'
import type { ElementColour, ThemeName } from './materials'
import {
  FADE_IN_FROM,
  FADE_IN_TO,
  FADE_OUT_FROM,
  FADE_SECONDS,
  GHOST_GREY,
  SEE_THROUGH_BELOW,
  createMaterials,
  elementColour,
  partAlpha
} from './materials'
import type { LabelOverlay } from './overlay'
import { createLabelOverlay } from './overlay'
import { createPartState } from './part-state'
import type { ClipPlane, Picker } from './picking'
import { createPicker } from './picking'
import type { Backend, BackendPreference, SceneRig } from './scene'
import { buildScene, createRenderer, glRendererName, sceneScale } from './scene'
import type { GridSegment, SectionConfig, SectionsConfig, SectionVisuals } from './section'
import { createSection } from './section'
import type { CutPlane } from './section-cut'
import { sectionCut } from './section-cut'
import type { Snapper } from './snap'
import { createSnapper } from './snap'
/** Statically `false` in a production build, so `viewer.dev` below never exists there. */
import { DEVTOOLS } from '../dev/flags'

/**
 * What a visibility / pickable predicate is given. The design's own predicates read exactly
 * these two (`(el) => el.model === active`, and `vis(el)` over the federation's elements),
 * and the renderer deliberately holds no other element metadata — the store does.
 */
export interface ViewerElement {
  id: number
  model: string
}

export interface ViewerStats {
  fps: number
  backend: Backend
  calls: number
}

export type { SectionConfig, SectionsConfig }

export interface ViewerCallbacks {
  stats?: (s: ViewerStats) => void
  camera?: (c: unknown) => void
  projection?: (p: Projection) => void
  cubeView?: () => void
  /**
   * `viewer-core.js` L588, L602 and L533. A click, a double-click, or a selection the viewer
   * had to trim because what was selected has just been hidden. The viewer does **not** apply
   * it — the shell owns the selection and calls `setSelected` back, exactly as the design's
   * `select(id, zoom, mode)` does.
   */
  select?: (id: number | number[] | null, mode: 'toggle' | 'replace') => void
  /** L605. The element under the pointer, or `null`. Fires once per frame at most. */
  hover?: (id: number | null) => void
  /** L575 and L587. Where to open the context menu, or `null` to close it. */
  context?: (c: { x: number; y: number; id: number | null } | null) => void
  /** L531. The hint bar's text for the current tool and snap setting. */
  hint?: (text: string) => void
  /** L405 and L415. The committed measurements / spot coordinates, after every change. */
  measure?: (list: MeasureRecord[]) => void
  spot?: (list: SpotRecord[]) => void
  /** L187. A grid bubble was clicked, by its axis tag. */
  gridClick?: (name: string) => void
}

/** `viewer-core.js` L486. */
export type Tool = 'select' | 'measure' | 'spot'

/**
 * Grids and storeys in the **project frame**; `offset` is what puts them in the scene.
 *
 * The caller has already put both through the model's own frame — the same transform the
 * geometry went through in the worker (`renderer/model/federation-store.ts`'s `metaOf`) — so
 * everything here is square with the building, and all that is left is the offset.
 *
 * A grid is its two plan endpoints, not the design's `{ axis, v }`: a real `IfcGridAxis` is a
 * curve and the reference model's grid runs at ~43° in the file's own world coordinates
 * (`shared/annotate.ts`).
 */
export interface ModelMeta {
  offset?: readonly [number, number, number]
  /**
   * The frame this model's coordinates were brought into the project frame with — its own,
   * project → its world (M_i⁻¹ ∘ P since 2026-10-08) — carried beside the offset so anything
   * converting scene ↔ project ↔ world has both. `null`/absent is the identity.
   */
  frame?: ProjectFrame | null
  grids?: readonly {
    name: string
    start: readonly [number, number]
    end: readonly [number, number]
  }[]
  storeys?: readonly {
    name: string
    /** The storey's floor in the project frame, metres; the viewer subtracts the offset. */
    elev: number
    /**
     * `IfcBuildingStorey.Elevation` as authored, metres — what the sidebar ladder shows and
     * what the 3D level tag prints. It is **not** `elev`: the tag is a readout, and printing
     * a scene height makes it disagree with the ladder by the federation offset.
     */
    authored: number
  }[]
  /**
   * The model-local `expressId`s of its **site** elements (`shared/site.ts`, 2026-09-24). They
   * are drawn, picked and hidden like any other; they are only left out of the building box
   * the camera frames and the annotations are sized from.
   */
  site?: readonly number[]
}

export interface ViewerOptions {
  canvas: HTMLCanvasElement
  /** The design's `[data-role="cube"]`, 148 px. Without it there is simply no view cube. */
  cubeCanvas?: HTMLCanvasElement | null
  /** The design's `[data-role="overlay"]`: where DOM labels and the snap marker live. */
  overlay?: HTMLElement | null
  theme?: ThemeName
  /** `'auto'` is WebGL2 since 2026-09-17; `'webgpu'` is opt-in only (`scene.ts`). */
  backend?: BackendPreference
  shadows?: boolean
  on?: ViewerCallbacks
}

/**
 * A crossfade rewrites every part in the changed set on every frame for 220 ms. Past this many
 * parts that costs more than the animation is worth, so the change is instant — the same
 * escape the design takes under `prefers-reduced-motion`.
 */
export const FADE_PART_BUDGET = 20_000

/** Appended to a replacement's key while it streams in beside the model it replaces. */
const INCOMING = '\u0000incoming'

const srgbOf = (hex: string | number): [number, number, number] => {
  const v = typeof hex === 'number' ? hex : parseInt(String(hex).replace('#', ''), 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

/** The direction the view cube is looked at from, recomputed each frame (L684). */
const _cubeDir = new Vector3()

/**
 * The renderer's own parts, for `scripts/profile-frame.cjs` — which has to answer where a
 * frame's time goes, and cannot from the public API: "hide the edges", "hide the glass
 * family", "stop rendering the view cube", "stop the per-frame label occlusion test" and
 * "drop the pixel ratio to 1" are not things a *user* may do (no designed surface has a
 * control for any of them), so they must not become public methods. Handing the profiler the
 * modules themselves lets it turn each one off from the outside, and leaves the frame loop
 * byte for byte what it was — no flag, no branch, nothing added to the hot path.
 *
 * Present only in a build made with `VITE_SGVUE_DEVTOOLS=1`. Nothing in `src/` reads it.
 */
export interface ViewerDev {
  renderer: import('three/webgpu').WebGPURenderer
  store: BatchStore
  edges: EdgeStore
  overlay: LabelOverlay
  annotations: Annotations
  picker: Picker
  materials: import('./materials').Materials
  cube: ViewCube | null
  scene(): import('three/webgpu').Scene
  camera(): CameraRig['camera']
  /**
   * A second picker over the same store with the spatial grid **off** — the flat box scan
   * this file used before `pick-grid.ts`. `scripts/pick-parity.cjs` builds one on a real model
   * and checks that the two answer identically, which is the one thing a unit test on the
   * mock federation cannot do at 26 539 elements. It is created on demand and rebuilt by its
   * caller; nothing in `src/` reads it.
   */
  bruteForcePicker(): Picker
}

export interface Viewer {
  readonly backend: Backend
  readonly bbox: Box3
  addModel(
    modelKey: string,
    slot: number,
    chunks: Iterable<GeometryChunk> | AsyncIterable<GeometryChunk>,
    meta?: ModelMeta
  ): Promise<void>
  removeModel(modelKey: string): number[]
  /**
   * Run `fn` — synchronous, a run of setters — and repaint, rebuild the edges and rebuild the
   * picker **once** at the end, however many of its setters asked for them (refactor pass 2).
   * What is drawn is the same as calling the setters one by one; nests.
   */
  batch(fn: () => void): void
  /**
   * Frame the building and ease in — the design's boot framing, on `frameBox` since
   * 2026-09-24. The caller decides when a boot batch is complete; `addModel` never frames.
   */
  frameExtents(): void
  elementIds(): number[]
  elementBox(id: number): Box3 | null
  solidCount(id: number): number
  isVisible(id: number): boolean
  setTheme(t: ThemeName): void
  setVisibility(fn: (el: ViewerElement) => boolean): void
  setSelected(ids: number | number[] | null): void
  setHighlight(ids: Iterable<number> | null): void
  setHighlightColor(c: string | null): void
  setElementColors(map: Record<number, string> | null): void
  setModelColors(map: Record<string, string> | null, native?: boolean): void
  /**
   * 2026-09-24: each element's IFC class colour (`shared/colors.ts`, `classColors`), drawn
   * wherever "Original materials" is off and no colour-by or model swatch says otherwise.
   */
  setClassColors(map: Record<number, string> | null): void
  setPickable(fn: ((el: ViewerElement) => boolean) | null): void
  setTool(t: Tool): void
  /** Escape: abandon whatever the current tool was building. */
  cancel(): void
  setShadows(b: boolean): void
  /**
   * The fine ground grid under the model (2026-09-24) and, with it, the ground veil
   * (2026-10-08). Not the IFC grids — `setGrids`.
   */
  setGroundGrid(b: boolean): void
  /**
   * Both section planes in one call (2026-10-01): the gridline cut and the level cut, each a
   * configuration or `null` for none. A plane handed over unchanged stays exactly as it was —
   * its cut, its outline, and the camera, which is re-aimed only at a plane that moved.
   */
  setSections(cfg: SectionsConfig): void
  setCoords(c: Partial<BasePoint>): void
  /**
   * The display unit the labels print in (2026-10-09): the laser's readings, the spot tags, the
   * grid and selection dimensions and the level tags (`annotations.ts`). `mm` until told.
   */
  setUnits(u: DisplayUnit): void
  setDims(ids: readonly number[] | null, on?: boolean | null, avoid?: readonly DimRect[]): void
  setSnap(b: boolean): void
  setGrids(b: boolean): void
  setLevels(b: boolean): void
  /** L407, L427, L417, L422 — the Markups card's `clear` and `×`, and the action bar's. */
  clearMeasures(): void
  clearSpots(): void
  dropMeasure(id: number): void
  dropSpot(id: number): void
  /**
   * 2026-10-02 — place a markup at a **scene** point, as a click with the spot tool or the
   * laser meter does once it has its point: the click's own commit, so the record, the labels
   * and the number in the Markups card are the ones a click makes. For the assistant's
   * `manage_markups`, which has no pointer. `normal` is the face the point sits on — the laser
   * does not fire into it — or `null`; `selfId` the element it sits on, or −1 for none. The
   * rays are the laser tool's: the same picker, the same section clipping.
   *
   * `placeMeasure` is false when no ray read anything, which places nothing — as such a click
   * places nothing.
   */
  placeSpot(p: readonly number[]): void
  placeMeasure(p: readonly number[], normal: readonly number[] | null, selfId: number): boolean
  /** One spot tag's state, set — what a click on the tag toggles (`annotations.ts`). */
  showSpot(id: number, full: boolean): SpotShown
  getCamera(): CameraState
  setCamera(c: CameraState): void
  setView(name: string): void
  setProjection(p: Projection): void
  /**
   * Frame the building, or some elements, from where the camera looks — a double-click on empty
   * space, and F. `zoom` (2026-10-02, the assistant's `set_view`) is a factor on that fit: 2 is
   * twice as close. Omitted, both are exactly what they were.
   */
  zoomExtents(zoom?: number): void
  zoomTo(id: number | number[], zoom?: number): void
  focusPoint(p: number[]): void
  /**
   * 2026-10-02 — turn the camera to any direction, by the rig's own θ and φ, about what it is
   * looking at and at its present distance: an orbit, flown. The view cube reaches 26
   * directions and a drag every one; this is the same reach for the store's `aimCamera`.
   */
  lookAlong(theta: number, phi: number): void
  debug(): Record<string, unknown>
  /** `undefined` in a production build — see `ViewerDev`. */
  dev?: ViewerDev
  dispose(): void
}

export async function createViewer(options: ViewerOptions): Promise<Viewer> {
  const { canvas, on = {} } = options
  let themeName: ThemeName = options.theme ?? 'dark'

  const { renderer, backend } = await createRenderer(canvas, options.backend ?? 'auto')
  // The per-part colour/state table the family materials read and the store writes.
  const partState = createPartState()
  const materials = createMaterials(themeName, partState)
  const store: BatchStore = createBatchStore()
  const edges: EdgeStore = createEdgeStore()

  const reduceMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  let shadowsOn = options.shadows !== false
  store.castShadows(shadowsOn)
  /** Lives here, not in the rig: the rig is rebuilt on every rescale (`restage`). */
  let groundGridOn = true

  /* ── interaction state (the reference's L81, L106, L486) ────────────────── */
  let tool: Tool = 'select'
  let hovered: number | null = null
  let selected = new Set<number>()
  let highlight: Set<number> | null = null
  let hlColor: string | null = null
  let elColors: Record<number, string> = {}
  let modelColors: Record<string, string> = {}
  let classColors: Record<number, string> = {}
  let nativeMats = true
  let pickOk: ((el: ViewerElement) => boolean) | null = null
  /**
   * `viewer-core.js` L408, without its literal base point: a value is read from the file or
   * typed by the user, and `null` otherwise (the fidelity contract's "never a placeholder").
   */
  let coords: BasePoint = { E: null, N: null, Z: null, angle: null }
  /**
   * Whole metres the geometry pipeline subtracted; the spot readouts add them back to reach
   * the **project** frame, which is the frame the design's `toMap` takes its input in.
   */
  let offset: readonly [number, number, number] = [0, 0, 0]
  /** The project frame those coordinates are in, carried beside the offset. */
  let projFrame: ProjectFrame | null = null

  /**
   * Grids and storeys in scene coordinates, kept per model and re-unioned on every add and
   * removal — the same union `shared/federate.ts` does for the shell, for the same reason: a
   * grid named `C` exists in every discipline file, so drawing them all overprints, and
   * unloading one model must not take the survivors' copy with it.
   */
  const gridsByModel = new Map<string, GridSegment[]>()
  /** `elev` is the scene height the ring is drawn at; `authored` is what the tag prints. */
  type StoreyLine = { name: string; elev: number; authored: number }
  const storeysByModel = new Map<string, StoreyLine[]>()
  let grids: GridSegment[] = []
  let storeys: StoreyLine[] = []

  const unionGridsAndStoreys = (): void => {
    const g = new Map<string, GridSegment>()
    for (const list of gridsByModel.values()) for (const x of list) if (!g.has(x.name)) g.set(x.name, x)
    grids = [...g.values()]
    const s = new Map<string, StoreyLine>()
    for (const list of storeysByModel.values()) for (const x of list) if (!s.has(x.name)) s.set(x.name, x)
    storeys = [...s.values()].sort((a, b) => a.elev - b.elev)
  }

  /**
   * The **building box** (2026-09-24, owner-requested: *"frame the camera on the building, not
   * the site"*): every element's box except the site's (`shared/site.ts`), or the whole box
   * when that leaves nothing. It is what the camera frames — boot, zoom extents, the view
   * presets, the cube, a section's re-aim, a double-click on empty space — and what the level
   * rings and the bubbles' gap and lift are sized from. Everything that must still cover
   * what is drawn — the clip planes, the shadow frustum, the ground, the section sheet, the
   * occlusion sweep, the laser's reach — keeps `store.bbox`. One object, updated in place, so
   * the camera rig and the annotations read it live.
   */
  const frameBox = new Box3()
  /** Federation ids of every model's site elements. */
  const siteByModel = new Map<string, Set<number>>()
  let frameScale = sceneScale(frameBox)
  const refreshFrameBox = (): void => {
    frameBox.makeEmpty()
    for (const rec of store.elements.values()) {
      if (!siteByModel.get(rec.modelKey)?.has(rec.id)) frameBox.union(rec.bbox)
    }
    if (frameBox.isEmpty()) frameBox.copy(store.bbox)
    frameScale = sceneScale(frameBox)
  }

  /* ── scene, cameras, section visuals ────────────────────────────────────── */
  /**
   * The one way the rig is built — at construction and on every `restage`. Its last argument is
   * the project frame's own zero in scene coordinates (scene = project − offset), which is where
   * the ground stands; scene z = 0 is only where the first placement streamed happened to be
   * (2026-10-01, `scene.ts` `groundLevel`).
   */
  const buildRig = (): SceneRig =>
    buildScene(store.bbox, materials, themeName, groundGridOn, 0 - offset[2])
  let rig: SceneRig = buildRig()
  let cam: CameraRig = createCameraRig({
    scale: rig.scale,
    bbox: frameBox,
    nearScale: () => frameScale,
    reduceMotion,
    onProjection: (p) => on.projection?.(p)
  })
  /**
   * The section visuals and the annotation group, once they exist. They are created after the
   * overlay and the picker they depend on, and `restage` moves them to the rebuilt scene.
   */
  let extras: Object3D[] = []

  const attachAll = (): void => {
    rig.scene.add(store.group, edges.group, ...extras)
  }
  attachAll()

  /** Viewport size in CSS pixels; `resize` below owns them. */
  let W = 1
  let H = 1

  /* ── what a frame is for (L699–744) ─────────────────────────────────────── */

  /**
   * **Anything that changes what is drawn must call `invalidate()`.**
   *
   * The reference renders every frame because it always has something to render — its own
   * federation is 590 parts. A real one is 14.6 million vertices and 2.7 million edge
   * segments, and drawing that again unchanged sixty times a second costs the GPU process
   * about 8 ms a frame for a picture nobody asked for. So the frame *loop* is untouched — it
   * runs at the display's rate, the clock ticks, the fps counter counts frame callbacks and
   * `on.camera` fires, exactly as before — and only the drawing is skipped: `renderer.render`,
   * the grid-view update, the occlusion sweep, the labels and the view cube.
   *
   * A frame is needed when the camera is not at rest (`cam.tick` says so, which covers easing,
   * flights, drags, the wheel and a projection swap), when a fade is ticking or any part state
   * was uploaded (hide, select, hover, ghost, colour), when a model arrives or leaves, when
   * the pointer moved over the viewport, when the canvas resized or the device pixel ratio
   * changed, when the window became visible again, when the GL context came back — and after
   * every setter below. Two frames are drawn after the last invalidation rather than one, so
   * an upload that lands between the frame and the compositor cannot leave a stale image.
   */
  const EXTRA_FRAMES = 2
  let pending = EXTRA_FRAMES
  /** The occlusion sweep's answer may have changed: the camera, the occluders or the labels. */
  let occDirty = true

  const invalidate = (): void => {
    pending = EXTRA_FRAMES
  }
  /** Every occluder or label change is also a frame. */
  const invalidateOcclusion = (): void => {
    occDirty = true
    pending = EXTRA_FRAMES
  }

  /**
   * The section planes that are **cutting** right now — none, one or two (2026-10-01) — in two
   * spellings of the same numbers: `clipPlanes` is what the picker, the laser ray and the snap
   * clamp by, `cutPlanes` what the cut outline is computed at. A preview (`cut: false`) and a
   * cleared plane are in neither. `section.ts` hands them over on every apply (`setClips`).
   *
   * The cut outline (2026-09-28, owner-requested): anything that moves a plane or changes what
   * is cut marks it dirty, and the frame loop recomputes it **once**, before it draws: an offset
   * typed fast, or `set_section` from the assistant, costs one recompute a frame and the last
   * value wins. `cutStat` covers both planes.
   */
  let clipPlanes: ClipPlane[] = []
  let cutPlanes: CutPlane[] = []
  let cutDirty = false
  let cutStat = { segments: 0, elements: 0, triangles: 0, ms: 0, planes: 0 }
  const markCut = (): void => {
    cutDirty = true
    invalidate()
  }


  /** Rebuild scene + camera whenever the federation box changes; carry the view across. */
  let stageScale = rig.scale
  const restage = (first: boolean): void => {
    const want = sceneScale(store.bbox)
    const state = cam.getCamera()
    if (!first && Math.abs(Math.log(want / stageScale)) < 0.1) {
      // Same order of magnitude: keep the scene, just re-aim the camera's extents.
      return
    }
    rig.scene.remove(store.group, edges.group, ...extras)
    rig.dispose()
    rig = buildRig()
    stageScale = rig.scale
    cam = createCameraRig({
      scale: rig.scale,
      bbox: frameBox,
      nearScale: () => frameScale,
      reduceMotion,
      onProjection: (p) => on.projection?.(p)
    })
    cam.setAspect(W / H)
    attachAll()
    if (!first) cam.setCamera(state)
  }

  /* ── colour composition: the reference's `applyMat`, L487–498 ───────────── */

  /** The crossfade's own state: the reference's grey at one opacity (L103–104). */
  const fadeAt = (alpha: number): ElementColour => ({ color: GHOST_GREY, alpha, lift: false })
  const FADE_IN_START = fadeAt(FADE_IN_FROM)
  const FADE_OUT_START = fadeAt(FADE_OUT_FROM)

  /**
   * Write one decision to every part of an element. `color: null` keeps the part's own colour
   * from the file and `alpha: null` its own opacity — which is what makes an override, a
   * highlight step's colour and a colour-by group all leave glass translucent. The hover lift
   * is a **tag** on the alpha rather than a value in it (`materials.ts`), because the
   * reference's hover keeps the element's colour and adds a flat accent on top of it.
   */
  const paint = (rec: ElementRecord, d: ElementColour): void => {
    const rgb = d.color === null ? null : srgbOf(d.color)
    for (let i = 0; i < rec.slotOf.length; i++) {
      const r = rgb ? rgb[0] : rec.rgba[i * 4]
      const g = rgb ? rgb[1] : rec.rgba[i * 4 + 1]
      const b = rgb ? rgb[2] : rec.rgba[i * 4 + 2]
      store.setPartState(rec, i, r, g, b, partAlpha(d, rec.rgba[i * 4 + 3]))
    }
  }

  const asElement = (rec: ElementRecord): ViewerElement => ({ id: rec.id, model: rec.modelKey })
  const isInert = (rec: ElementRecord): boolean => !!pickOk && !pickOk(asElement(rec))

  /**
   * Which of a slot's two meshes rasterises this element is decided in the shader, from the
   * alpha `paint` wrote (`materials.ts`). All this has to do is keep the count of see-through
   * elements, so the see-through meshes can be left out of the frame entirely when — as is
   * usually the case — nothing is ghosted, inert or fading.
   */
  let seeThroughCount = 0
  const setSeeThrough = (rec: ElementRecord, seeThrough: boolean): void => {
    if (rec.seeThrough === seeThrough) return
    rec.seeThrough = seeThrough
    seeThroughCount += seeThrough ? 1 : -1
    store.setGhostActive(seeThroughCount > 0)
  }

  /**
   * The reference's `applyMat` (L487–498) and `baseFor` (L91–96), with a colour written
   * instead of a material assigned. The decision itself is pure and lives in `materials.ts`,
   * so the whole precedence of `BUILD_PLAN.md` §1.4 — native file colours ← model override ←
   * colour-by scheme ← highlight steps ← hover / selection — is unit-tested rather than
   * inferred from a screenshot.
   *
   * The alpha it settles on is also the state channel (`materials.ts`): above 1 the element is
   * opaque and glowing by the excess (1.35 is `selMat`, 1.15 is `hlMat`), and below 0.5 it
   * moves to its slot's see-through mesh — which is where `ghostMat`, `inertMat` and the two
   * fade materials went.
   */
  const decide = (rec: ElementRecord): ElementColour =>
    elementColour({
      visible: rec.visible,
      selected: selected.has(rec.id),
      hovered: rec.id === hovered,
      inert: isInert(rec),
      highlight: highlight !== null,
      hl: rec.hl,
      elColor: elColors[rec.id],
      // L94: "Original materials" is resolved here, so the pure decision never sees the flag.
      modelColor: nativeMats ? null : modelColors[rec.modelKey],
      classColor: nativeMats ? null : classColors[rec.id],
      hlColor,
      accent: materials.theme.accent
    })

  function applyElement(rec: ElementRecord): void {
    if (rec.fading) return
    const d = decide(rec)
    paint(rec, d)
    // Hidden is alpha 0 and **both** materials discard it, so a hidden element is not a
    // see-through one: counting it would keep every see-through mesh in the frame for nothing.
    setSeeThrough(rec, rec.visible && d.alpha !== null && d.alpha < SEE_THROUGH_BELOW)
  }

  const applyAll = (): void => {
    for (const rec of store.elements.values()) applyElement(rec)
  }

  /** Edges follow `applyMat`'s own rule (L497), plus: nothing draws while it is fading. */
  const drawsSelEdge = (id: number): boolean => {
    const rec = store.elements.get(id)
    if (!rec || !rec.visible || rec.fading) return false
    if (isInert(rec)) return false
    if (highlight && !rec.hl) return false
    return true
  }
  /**
   * 2026-09-24: an `IfcSpace` draws no grey edges — its outline is every wall's, doubled — but
   * keeps the accent outline when it is selected, which is what makes a selected room legible.
   */
  const drawsEdge = (id: number): boolean => drawsSelEdge(id) && !store.elements.get(id)!.space
  /**
   * The cut outline is drawn for exactly the elements whose grey edges are drawn: visible, not
   * inert, not ghosted by highlight mode, not fading, not a space. So wherever the edges are
   * rebuilt — visibility, a fade landing, highlight, activate, a model in or out — so is the cut.
   */
  const rebuildEdges = (): void => {
    edges.rebuild(drawsEdge)
    edges.setSelection(selected, drawsSelEdge)
    markCut()
  }

  /* ── the interaction layer (2b) ─────────────────────────────────────────── */
  const overlay: LabelOverlay = createLabelOverlay(options.overlay ?? null)
  const pickOptions = {
    store,
    // The planes that are cutting, read when a ray is cast — not the uniforms, which hold a
    // parked plane for every slot that is not.
    clip: () => clipPlanes,
    // `viewer-core.js` L133: visible, and not filtered out by `setPickable`. See-through is
    // not part of it — the reference's ghost meshes are in `pickList` like any other.
    hittable: (rec: ElementRecord) => rec.visible && !isInert(rec),
    // 2026-09-24: only the building hides a grid bubble or a grid dimension — never the site.
    occludes: (rec: ElementRecord) => !siteByModel.get(rec.modelKey)?.has(rec.id)
  }
  const picker: Picker = createPicker(pickOptions)
  // 2026-09-28: the snap's depth rule reads the scene scale and the same section planes.
  const snapper: Snapper = createSnapper(edges, overlay, {
    scale: () => stageScale,
    clips: pickOptions.clip
  })

  /* ── coalescing (refactor pass 2) ───────────────────────────────────────── */
  /**
   * Inside `batch(fn)` a setter that would repaint every element, rebuild the edge index or
   * rebuild the picker only marks it, and the batch does each at most once, when it ends. All
   * three are functions of the state the setters leave behind, so doing them once at the end
   * draws what doing them after every setter drew. Outside a batch each runs at once, as it
   * always has. One exception keeps the pick list's fade rule: a visibility change that starts
   * a crossfade first settles a picker rebuild already asked for (`setVisibility`).
   */
  let batchDepth = 0
  let needPaint = false
  let needEdges = false
  let needPicker = false
  const requestPaint = (): void => {
    if (batchDepth) needPaint = true
    else applyAll()
  }
  const requestEdges = (): void => {
    if (batchDepth) needEdges = true
    else rebuildEdges()
  }
  const requestPicker = (): void => {
    if (batchDepth) needPicker = true
    else picker.rebuild()
  }
  const flushPicker = (): void => {
    if (!needPicker) return
    needPicker = false
    picker.rebuild()
  }
  function batch(fn: () => void): void {
    batchDepth++
    try {
      fn()
    } finally {
      if (--batchDepth === 0) {
        if (needPaint) {
          needPaint = false
          applyAll()
        }
        if (needEdges) {
          needEdges = false
          rebuildEdges()
        }
        flushPicker()
      }
    }
  }

  /* ── the annotation layer (6) ───────────────────────────────────────────── */
  const section: SectionVisuals = createSection(
    {
      bbox: store.bbox,
      scale: () => stageScale,
      grids: () => grids,
      storeys: () => storeys,
      // One entry per slot — the gridline cut, the level cut — `null` where it is not cutting.
      setClips: (planes) => {
        clipPlanes = []
        cutPlanes = []
        planes.forEach((plane, i) => {
          if (!plane) return materials.clearClip(i)
          const n = new Vector3(plane.n[0], plane.n[1], plane.n[2])
          materials.setClip(i, n, plane.c)
          clipPlanes.push({ n, c: plane.c })
          cutPlanes.push(plane)
        })
        markCut()
      },
      // L254: the plane moved, so look at it square on and reframe.
      reaim: (normal) => {
        cam.viewDir(normal)
        cam.fitBox(frameBox)
        on.cubeView?.()
      }
    },
    materials
  )

  const annotations: Annotations = createAnnotations({
    overlay,
    materials,
    bbox: store.bbox,
    scale: () => stageScale,
    frame: frameBox,
    frameScale: () => frameScale,
    groundZ: () => rig.groundZ,
    camera: () => cam.camera,
    view: () => ({ theta: cam.cur.theta, phi: cam.cur.phi }),
    size: () => ({ w: W, h: H }),
    grids: () => grids,
    storeys: () => storeys,
    elementBox: (id) => store.elements.get(id)?.bbox ?? null,
    isVisible: (id) => !!store.elements.get(id)?.visible,
    ray: (origin, dir, far, near) => picker.ray(origin, dir, far, near),
    offset: () => offset,
    invalidate,
    on: {
      measure: (l) => on.measure?.(l),
      spot: (l) => on.spot?.(l),
      gridClick: (name) => on.gridClick?.(name)
    }
  })

  extras = [...section.objects, annotations.group]
  rig.scene.add(...extras)

  /** The frame loop's half of the cut outline: recompute from the live planes, or clear it. */
  const updateCut = (): void => {
    if (!cutPlanes.length) {
      if (cutStat.segments) section.setCut(null, 0)
      cutStat = { segments: 0, elements: 0, triangles: 0, ms: 0, planes: 0 }
      return
    }
    const t = performance.now()
    const r = sectionCut(store, cutPlanes, (rec) => drawsEdge(rec.id))
    section.setCut(r.segments, r.count)
    cutStat = {
      segments: r.count,
      elements: r.elements,
      triangles: r.triangles,
      ms: +(performance.now() - t).toFixed(2),
      planes: cutPlanes.length
    }
  }

  /**
   * What a click with the spot tool or the laser meter commits once it has its point
   * (`viewer-core.js` L588–590) — and, since 2026-10-02, what `placeSpot` / `placeMeasure` run
   * for the assistant: one function each, two callers. A new label joins the overlay, and the
   * laser is new geometry in the scene, so each asks for the occlusion sweep and a frame.
   */
  const commitSpot = (p: Vector3): void => {
    annotations.addSpot(p)
    invalidateOcclusion()
  }
  /** False when no ray read anything: `addLaser` then adds nothing. */
  const commitLaser = (p: Vector3, normal: Vector3 | null, selfId: number): boolean => {
    const had = annotations.measureCount
    annotations.addLaser(p, normal, selfId)
    invalidateOcclusion()
    return annotations.measureCount > had
  }

  /** `viewer-core.js` L501. */
  function setHovered(id: number | null): void {
    if (id === hovered) return
    const prev = hovered
    hovered = id
    if (prev != null) {
      const rec = store.elements.get(prev)
      if (rec) applyElement(rec)
    }
    if (id != null) {
      const rec = store.elements.get(id)
      if (rec) applyElement(rec)
    }
    canvas.style.cursor =
      id != null && tool === 'select' ? 'pointer' : tool === 'select' ? '' : 'crosshair'
  }

  /** `viewer-core.js` L532, copy for copy. */
  const hintFor = (): string =>
    tool === 'measure'
      ? snapper.on
        ? 'Click a surface — the laser reads X, Y and Z to the nearest faces. Snaps to corners and edges.'
        : 'Click a surface — the laser reads X, Y and Z. Snapping off: reads the exact point clicked.'
      : tool === 'spot'
        ? snapper.on
          ? 'Click to pin coordinates — snaps to the nearest corner or edge.'
          : 'Click to pin the exact coordinates of that point.'
        : ''

  /** `viewer-core.js` L531. */
  function setTool(t: Tool): void {
    tool = t
    annotations.clearPreview()
    snapper.hide()
    canvas.style.cursor = t === 'select' ? '' : 'crosshair'
    on.hint?.(hintFor())
    invalidate()
  }

  const ndc = new Vector2()
  let lastMove: { x: number; y: number } | null = null
  let needHover = false
  /** How long the last hover evaluation took, in ms — read by `debug()`. */
  let hoverMs = 0

  /**
   * `viewer-core.js` L603–620. Evaluated once per frame off the last pointer move rather than
   * per event, which is what keeps a 120 Hz mouse from casting three rays a frame.
   */
  function doHover(): void {
    if (!lastMove) return
    const { px, py } = canvasNdc(canvas, lastMove.x, lastMove.y, ndc)
    const hit = picker.pick(ndc, cam.camera)
    const id = hit ? hit.id : null
    setHovered(tool === 'select' ? id : null)
    on.hover?.(id)
    if (tool !== 'measure' && tool !== 'spot') return
    if (!hit) {
      snapper.hide()
      annotations.clearPreview()
      return
    }
    const snapped = snapper.snap(hit.id, hit.point, hit.normal, px, py, null, cam.camera, W, H)
    snapper.show(snapped, cam.camera, W, H)
    // L614–618: the laser preview and its live reading, from the same snapped point.
    if (tool === 'measure') annotations.previewLaser(snapped.p, hit.normal, hit.id)
  }

  const input: InputHandle = attachInput(
    {
      canvas,
      height: () => H,
      camera: () => cam.camera,
      target: () => cam.goal.target,
      groundZ: () => rig.groundZ,
      scale: () => stageScale,
      pick: (at) => picker.pick(at, cam.camera),
      orbit: (dx, dy, pivot) => cam.orbit(dx, dy, pivot),
      pan: (dx, dy, height) => cam.pan(dx, dy, height),
      dolly: (k, at) => cam.dolly(k, at),
      // L597–602: double-click frames what was clicked and selects it; empty space frames all.
      frame: (id) => {
        const rec = id == null ? null : (store.elements.get(id) ?? null)
        invalidate()
        if (!rec) {
          cam.fitBox(frameBox)
          cam.fly()
          return
        }
        cam.fitBox(rec.bbox.clone().expandByScalar(0.6))
        cam.fly()
        if (tool === 'select') on.select?.(rec.id, 'replace')
      },
      hoverAt: (x, y) => {
        lastMove = { x, y }
      },
      hoverLater: () => {
        needHover = true
      },
      hoverOut: () => {
        setHovered(null)
        snapper.hide()
        invalidate()
      },
      // `input.ts`: a camera gesture started, so drop a hover that has not been evaluated yet.
      hoverCancel: () => {
        needHover = false
      },
      select: (id, mode) => on.select?.(id, mode),
      context: (c) => on.context?.(c),
      // L588–590. The snap is resolved here so the point committed is the one the marker showed.
      toolClick: (hit, px, py) => {
        const snapped = snapper.snap(
          hit.id,
          hit.point,
          hit.normal,
          px,
          py,
          null,
          cam.camera,
          W,
          H
        )
        if (tool === 'spot') commitSpot(snapped.p)
        else if (tool === 'measure') commitLaser(snapped.p, hit.normal, hit.id)
      },
      tool: () => tool
    },
    ndc
  )

  /** The 148 px view cube, on its own canvas as the design's markup has it. */
  let cube: ViewCube | null = null
  if (options.cubeCanvas) {
    cube = await createViewCube({
      canvas: options.cubeCanvas,
      // Both renderers on one graphics path: a WebGL2 main renderer with a WebGPU cube would
      // mean two devices for one window.
      forceWebGL: backend === 'WebGL2',
      theme: themeName,
      // L685. No `fly()`: the reference lets a cube click ease at the normal rate.
      onView: (dir) => {
        cam.viewDir(dir)
        cam.fitBox(frameBox)
        on.cubeView?.()
      }
    })
    cube.setCompass(coords.angle ?? 0)
  }


  /* ── crossfade (L503–530, L731) ─────────────────────────────────────────── */
  let fadeOut: ElementRecord[] = []
  let fadeIn: ElementRecord[] = []
  let fadeT = 0
  let fadingBatch = false

  function finishFades(): void {
    fadingBatch = false
    fadeT = 0
    for (const rec of [...fadeOut, ...fadeIn]) {
      rec.fading = false
      // `applyElement` writes alpha 0 for the ones that have faded out, which is the hidden
      // state; the ones that faded in compose normally.
      applyElement(rec)
    }
    fadeOut = []
    fadeIn = []
    requestEdges()
    // L509: the pick list holds the *old* set for the length of a fade, then catches up.
    requestPicker()
    annotations.drawDims()
    invalidateOcclusion()
  }

  function setVisibility(fn: (el: ViewerElement) => boolean): void {
    if (fadingBatch) finishFades()
    const want = new Map<number, boolean>()
    let changing = 0
    for (const rec of store.elements.values()) {
      const w = !!fn(asElement(rec))
      want.set(rec.id, w)
      if (w !== rec.visible) changing += rec.slotOf.length
    }
    const instant = reduceMotion || changing > FADE_PART_BUDGET
    // A fade keeps the pick list as it stood before it (L509), so a rebuild an earlier setter
    // in this batch asked for is done now, against the visibility it was asked under.
    if (!instant && changing > 0) flushPicker()
    if (instant) {
      for (const rec of store.elements.values()) rec.visible = want.get(rec.id)!
    } else {
      for (const rec of store.elements.values()) {
        const w = want.get(rec.id)!
        if (w === rec.visible) continue
        rec.visible = w
        rec.fading = true
        // A fading element is see-through the whole way, in or out, so it is drawn by the
        // see-through mesh for the duration — which is what stops it occluding during the fade.
        setSeeThrough(rec, true)
        paint(rec, w ? FADE_IN_START : FADE_OUT_START)
        ;(w ? fadeIn : fadeOut).push(rec)
      }
      fadingBatch = fadeOut.length > 0 || fadeIn.length > 0
    }
    // Every element that is not fading is composed again; a fading one keeps its fade paint.
    requestPaint()
    // Edges are rebuilt now either way: a fading element draws none until the fade lands,
    // and `finishFades` rebuilds again when it does.
    requestEdges()
    // L527: the dimensions are re-placed the moment the change lands, or when the fade does.
    if (!fadingBatch) {
      requestPicker()
      annotations.drawDims()
    }
    // What is visible is what occludes a label, and the dimensions moved with it.
    invalidateOcclusion()
    const keep = [...selected].filter((id) => store.elements.get(id)?.visible)
    if (keep.length !== selected.size) {
      // L534: the viewer trims a selection whose elements have just been hidden, and says so.
      setSelected(keep)
      on.select?.(keep, 'replace')
    }
  }

  function tickFade(dt: number): void {
    if (!fadingBatch) return
    fadeT += dt / FADE_SECONDS
    if (fadeT >= 1) {
      finishFades()
      return
    }
    // One decision per list per frame, not one per element: a fade can touch 20 000 of them.
    const out = fadeAt(FADE_OUT_FROM * (1 - fadeT))
    const into = fadeAt(FADE_IN_FROM + (FADE_IN_TO - FADE_IN_FROM) * fadeT)
    for (const rec of fadeOut) paint(rec, out)
    for (const rec of fadeIn) paint(rec, into)
  }

  /* ── selection / highlight (L500–502) ───────────────────────────────────── */
  function setSelected(ids: number | number[] | null): void {
    const next = new Set(ids == null ? [] : Array.isArray(ids) ? ids : [ids])
    const touched = [...selected, ...next]
    selected = next
    for (const id of touched) {
      const rec = store.elements.get(id)
      if (rec) applyElement(rec)
    }
    edges.setSelection(selected, drawsSelEdge)
    invalidate()
  }

  function setHighlight(ids: Iterable<number> | null): void {
    highlight = ids ? new Set(ids) : null
    for (const rec of store.elements.values()) rec.hl = !!(highlight && highlight.has(rec.id))
    requestPaint()
    requestEdges()
    invalidate()
  }

  /* ── resize + frame loop (L699–744) ─────────────────────────────────────── */
  const resize = (): void => {
    const p = canvas.parentElement
    const w = Math.max(1, p ? p.clientWidth : canvas.clientWidth)
    const h = Math.max(1, p ? p.clientHeight : canvas.clientHeight)
    if (w !== W || h !== H) {
      W = w
      H = h
      renderer.setSize(w, h, false)
    }
    cam.setAspect(w / h)
    invalidateOcclusion()
  }
  const observed = canvas.parentElement ?? canvas
  const observer = new ResizeObserver(resize)
  observer.observe(observed)
  resize()

  /**
   * A move to a display with a different pixel ratio changes what the canvas must draw without
   * changing its CSS size, so no `ResizeObserver` fires. The media query is re-armed each time
   * because it names the ratio it was built for.
   */
  let dprQuery: MediaQueryList | null = null
  const onDpr = (): void => {
    armDpr()
    invalidate()
  }
  function armDpr(): void {
    dprQuery?.removeEventListener('change', onDpr)
    dprQuery =
      typeof matchMedia === 'function'
        ? matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
        : null
    dprQuery?.addEventListener('change', onDpr)
  }
  armDpr()

  /** A restored context has a blank canvas and stale GPU state; draw again. */
  const onContextRestored = (): void => invalidate()
  canvas.addEventListener('webglcontextrestored', onContextRestored)

  /**
   * The view cube keeps its own hover tint on its own canvas (`cube.ts` L673–679) and is drawn
   * by this loop, so a pointer over it has to ask for a frame. Listening here rather than
   * inside the cube keeps the cube exactly as it was ported.
   */
  const onCubePointer = (): void => invalidate()
  options.cubeCanvas?.addEventListener('pointermove', onCubePointer)
  options.cubeCanvas?.addEventListener('pointerleave', onCubePointer)

  /**
   * `WebGLBackend.draw()` takes its `info` parameter commented out, so the WebGL2 path never
   * calls `info.update` and `renderer.info.render.drawCalls` can read 0 there however much
   * was drawn. Count the objects we submitted as well — on that path one
   * `WEBGL_multi_draw` per batch *is* the draw count — and report the larger of the two, so
   * the dev `stats()` hook's count never reads zero and never under-reports WebGPU, where the
   * renderer's own figure is per instance and much higher. No designed surface shows it.
   */
  const drawCalls = (): number => {
    let n = store.drawObjects() + edges.drawObjects() + annotations.drawObjects()
    n += section.drawn
    n += 1 + (groundGridOn ? 2 : 0) // the ground plane, and its veil and grid helper when on
    // The larger of the two is right in both cases: on WebGPU the renderer's own count is
    // per instance and far higher; on WebGL2 it can be zero, and ours is what was submitted.
    return Math.max(renderer.info.render.drawCalls, n)
  }

  let last = performance.now()
  let frames = 0
  let fpsT = last
  let running = true
  let raf = 0

  /**
   * A hidden window must not keep drawing. Chromium throttles `requestAnimationFrame` for a
   * backgrounded *tab*, but an Electron window that is merely occluded or on another Space is
   * not always backgrounded — and a frame of this scene is expensive enough that the GPU
   * process should not be paying for one nobody can see (`src/main/gpu-guard.ts`). `frame`
   * clears its own handle first, so going hidden simply ends the loop; `visibilitychange`
   * starts it again, with the clock reset so the first fps sample is not a long stall.
   */
  function frame(now: number): void {
    raf = 0
    if (!running || document.hidden) return
    raf = requestAnimationFrame(frame)
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    tickFade(dt)
    // The camera is the one thing that moves on its own: an ease, a flight, or a drag the
    // pointer handler has already written into `goal`. Its own arithmetic decides.
    const moving = cam.tick(dt, now)
    if (moving) invalidateOcclusion()
    if (needHover) {
      needHover = false
      // Timed only on the frames a hover is actually evaluated — at most one per frame, and
      // only while the pointer is moving. It is what `scripts/bench.cjs` reads to report the
      // cost of a hover on a real model; nothing visible depends on it.
      const t = performance.now()
      doHover()
      hoverMs = performance.now() - t
      // The snap marker, the laser preview and the hovered element's own colour.
      invalidate()
    }
    on.camera?.(cam.camera)
    // One texture upload per frame in which a colour actually changed, and none otherwise —
    // every `paint` above only marks the table dirty. A part's alpha is also what the family
    // materials discard on in the **shadow** pass, so an upload is exactly when the shadow
    // map has to be drawn again; a camera move is not (`scene.ts`, `sun.shadow.autoUpdate`).
    if (partState.flush()) {
      rig.invalidateShadows()
      invalidate()
    }
    // At most one recompute of the cut outline a frame, from whatever the plane is now.
    if (cutDirty) {
      cutDirty = false
      updateCut()
    }
    if (pending > 0) {
      pending--
      // The grid dimensions stand a fixed number of pixels off the bubbles, so they are placed
      // for this frame's camera before it is drawn.
      annotations.placeGridDims()
      renderer.render(rig.scene, cam.camera)
      // L737–740, in the reference's order: the grid view, then occlusion, then the labels,
      // then the cube.
      annotations.updateGridView()
      if (occDirty) {
        const swept = overlay.updateOcclusion(
          cam.camera,
          store.bbox,
          (origin, direction, far) => picker.anyHit(origin, direction, far),
          moving
        )
        // While the camera moves the answer goes stale again immediately; at rest one sweep
        // settles it until something else changes.
        if (swept && !moving) occDirty = false
      }
      overlay.update(cam.camera, W, H)
      // A grid dimension's run is drawn only while its label is; if the sweep or the occlusion
      // test just changed a label, the run follows on the next frame.
      if (annotations.gridDimsStale()) invalidate()
      if (cube) {
        dirOf(cam.cur.theta, cam.cur.phi, _cubeDir)
        cube.render(_cubeDir, cam.camera.quaternion)
      }
    }
    frames++
    if (now - fpsT > 1000) {
      on.stats?.({ fps: Math.round((frames * 1000) / (now - fpsT)), backend, calls: drawCalls() })
      frames = 0
      fpsT = now
    }
  }
  const onVisibility = (): void => {
    if (document.hidden || !running || raf) return
    last = performance.now()
    fpsT = last
    frames = 0
    // Whatever was on screen when the window went away is not to be trusted on the way back.
    invalidateOcclusion()
    raf = requestAnimationFrame(frame)
  }
  document.addEventListener('visibilitychange', onVisibility)
  raf = requestAnimationFrame(frame)

  /* ── models ─────────────────────────────────────────────────────────────── */
  async function addModel(
    modelKey: string,
    slot: number,
    chunks: Iterable<GeometryChunk> | AsyncIterable<GeometryChunk>,
    meta?: ModelMeta
  ): Promise<void> {
    const first = store.elements.size === 0
    /*
     * Refactor pass 2: a model already here under this key is being **replaced**. The new one
     * streams in beside it under a label of its own, and the old one leaves only once every
     * chunk is in — so a replacement that fails to join leaves the model on screen as it was.
     * Either way, whatever a failed stream put in is taken out again before the error goes on.
     */
    const replacing = gridsByModel.has(modelKey)
    const label = replacing ? `${modelKey}${INCOMING}` : modelKey
    const take = (chunk: GeometryChunk): void => {
      store.addChunk(chunk, slot, materials, label)
      edges.addChunk(chunk, slot, materials, label)
    }
    try {
      if (Symbol.asyncIterator in (chunks as object)) {
        for await (const chunk of chunks as AsyncIterable<GeometryChunk>) take(chunk)
      } else {
        for (const chunk of chunks as Iterable<GeometryChunk>) take(chunk)
      }
    } catch (err) {
      const dropped = store.removeModel(label)
      edges.removeModel(label)
      // As `forget` does: the ids are the slot's, so a later model on it must not inherit a cache.
      snapper.invalidate(dropped)
      if (!store.elements.size) partState.reset()
      picker.rebuild()
      // A cut recomputed mid-stream may hold this model's segments; the next frame drops them.
      markCut()
      // A streamed model may have been drawn part-way in; the next frame draws it gone.
      rig.invalidateShadows()
      invalidate()
      throw err
    }
    if (replacing) {
      forget(modelKey)
      store.relabel(label, modelKey)
      edges.relabel(label, modelKey)
    }
    store.finishModel(modelKey)
    // New casters in the scene.
    rig.invalidateShadows()

    const [ox, oy, oz] = meta?.offset ?? [0, 0, 0]
    offset = meta?.offset ?? offset
    if (meta && 'frame' in meta) projFrame = meta.frame ?? null
    // A grid at any angle is drawable: its two plan endpoints come across and the annotation
    // layer clips the line they define to the padded footprint (`shared/annotate.ts`).
    gridsByModel.set(
      modelKey,
      (meta?.grids ?? []).map((g) => ({
        name: g.name,
        p0: [g.start[0] - ox, g.start[1] - oy] as [number, number],
        p1: [g.end[0] - ox, g.end[1] - oy] as [number, number]
      }))
    )
    storeysByModel.set(
      modelKey,
      // `elev` is the scene height the ring is drawn at; `authored` is the number the tag
      // prints, and the offset must never reach it.
      (meta?.storeys ?? []).map((s) => ({ name: s.name, elev: s.elev - oz, authored: s.authored }))
    )
    unionGridsAndStoreys()
    siteByModel.set(modelKey, new Set((meta?.site ?? []).map((x) => fedId(slot, x))))
    refreshFrameBox()

    restage(first)
    applyAll()
    rebuildEdges()
    picker.rebuild()
    // The design builds every annotation once, at construction, with the whole federation in
    // hand; streamed models mean the box, the grid set and the ladder all move, so the lines,
    // the bubbles, the rings and the tags are re-derived here — and the section plane, whose
    // quad is sized from the same box, is re-applied without re-aiming the camera.
    annotations.rebuild()
    section.refresh()
    invalidateOcclusion()
  }

  /**
   * Frame the building box (`frameBox`) and ease in, which is the design's boot
   * (`SGVue.dc.html:1096`):
   * `buildFederation` finishes **first**, the viewer is created with every model present, and
   * the reference's `Object.assign(cur, { dist: goal.dist * 1.6 })` plays once.
   *
   * It is not `addModel`'s job, and it used to be: with models streamed in one at a time, the
   * first of them framed on its own bounding box and the rest only carried that camera across,
   * so a four-model boot ended up framed on whichever discipline arrived first. The caller
   * knows what a boot batch is (`model/federation-store.ts`); the viewer does not.
   */
  function frameExtents(): void {
    cam.fitBox(frameBox)
    cam.easeIn()
    invalidate()
  }

  /** The bookkeeping half of `removeModel`: the model's parts, edges and per-model entries. */
  function forget(modelKey: string): number[] {
    const dropped = store.removeModel(modelKey)
    edges.removeModel(modelKey)
    gridsByModel.delete(modelKey)
    storeysByModel.delete(modelKey)
    siteByModel.delete(modelKey)
    for (const id of dropped) {
      selected.delete(id)
      delete elColors[id]
    }
    // The see-through count is per element, so it has to be taken again once elements are
    // gone — otherwise the see-through meshes stay in the frame with nothing to draw.
    seeThroughCount = 0
    for (const rec of store.elements.values()) if (rec.seeThrough) seeThroughCount++
    store.setGhostActive(seeThroughCount > 0)
    snapper.invalidate(dropped)
    // Nothing left: the next model starts at part 0 rather than after every part ever loaded.
    if (!store.elements.size) partState.reset()
    return dropped
  }

  function removeModel(modelKey: string): number[] {
    const dropped = forget(modelKey)
    unionGridsAndStoreys()
    refreshFrameBox()
    rig.invalidateShadows()
    restage(store.elements.size === 0)
    rebuildEdges()
    picker.rebuild()
    annotations.rebuild()
    section.refresh()
    invalidateOcclusion()
    return dropped
  }

  /* ── the API ────────────────────────────────────────────────────────────── */
  return {
    ...(DEVTOOLS
      ? {
          dev: {
            renderer,
            store,
            edges,
            overlay,
            annotations,
            picker,
            bruteForcePicker: () => createPicker({ ...pickOptions, bruteForce: true }),
            materials,
            cube,
            scene: () => rig.scene,
            camera: () => cam.camera
          } satisfies ViewerDev
        }
      : null),
    backend,
    get bbox() {
      return store.bbox
    },
    addModel,
    removeModel,
    batch,
    elementIds: () => [...store.elements.keys()],
    elementBox: (id) => store.elements.get(id)?.bbox ?? null,
    solidCount: (id) => store.elements.get(id)?.solidCount ?? 0,
    isVisible: (id) => !!store.elements.get(id)?.visible,

    setTheme: (t) => {
      themeName = t
      materials.setTheme(t)
      rig.setTheme(t)
      cube?.setTheme(t)
      requestPaint()
      invalidate()
    },
    frameExtents,
    setVisibility,
    setSelected,
    setHighlight,
    setHighlightColor: (c) => {
      hlColor = c
      requestPaint()
      invalidate()
    },
    setElementColors: (map) => {
      elColors = map ?? {}
      requestPaint()
      invalidate()
    },
    setModelColors: (map, native) => {
      modelColors = map ?? {}
      if (native != null) nativeMats = !!native
      requestPaint()
      invalidate()
    },
    setClassColors: (map) => {
      classColors = map ?? {}
      if (!nativeMats) requestPaint()
      invalidate()
    },
    // L752–753: non-pickable elements stay rendered but drop out of hit-testing — hover,
    // click and the context menu — and are drawn inert (0.08 grey, edges off).
    setPickable: (fn) => {
      pickOk = fn ?? null
      const stale = hovered != null && store.elements.get(hovered)
      if (stale && isInert(stale)) setHovered(null)
      requestPaint()
      requestEdges()
      requestPicker()
      // The pick list *is* the occluder list (`overlay.ts`).
      invalidateOcclusion()
    },
    setTool,
    // L764.
    cancel: () => {
      annotations.clearPreview()
      on.hint?.(hintFor())
      invalidate()
    },
    setShadows: (b) => {
      shadowsOn = b
      store.castShadows(b)
      rig.invalidateShadows()
      invalidate()
    },
    setGroundGrid: (b) => {
      groundGridOn = b
      // The grid helper and the ground veil (2026-10-08). Neither casts, so the shadow map —
      // casters only — is unchanged and a frame is all this needs.
      rig.setGroundGrid(b)
      invalidate()
    },
    setSections: (cfg) => {
      section.apply(cfg)
      rig.invalidateShadows()
      invalidateOcclusion()
    },
    // L428. The compass follows the angle; every spot label is re-rendered and re-published.
    setCoords: (c) => {
      coords = { ...coords, ...c }
      cube?.setCompass(coords.angle ?? 0)
      annotations.setCoords(coords)
      invalidateOcclusion()
    },
    // 2026-10-09. Every label that prints a length or a coordinate, re-rendered in the unit.
    setUnits: (u) => {
      annotations.setUnits(u)
      invalidateOcclusion()
    },
    // L751.
    setDims: (ids, onOff, avoid) => {
      annotations.setDims(ids, onOff, avoid)
      invalidateOcclusion()
    },
    // L754.
    setSnap: (b) => {
      snapper.setOn(b)
      on.hint?.(hintFor())
      invalidate()
    },
    // L763.
    setGrids: (b) => {
      annotations.setGrids(b)
      invalidateOcclusion()
    },
    setLevels: (b) => {
      annotations.setLevels(b)
      invalidateOcclusion()
    },
    clearMeasures: () => {
      annotations.clearMeasures()
      invalidateOcclusion()
    },
    clearSpots: () => {
      annotations.clearSpots()
      invalidateOcclusion()
    },
    dropMeasure: (id) => {
      annotations.dropMeasure(id)
      invalidateOcclusion()
    },
    dropSpot: (id) => {
      annotations.dropSpot(id)
      invalidateOcclusion()
    },
    // 2026-10-02 — the click's own commit, for a point the assistant names.
    placeSpot: (p) => commitSpot(new Vector3().fromArray(p)),
    placeMeasure: (p, normal, selfId) =>
      commitLaser(
        new Vector3().fromArray(p),
        normal ? new Vector3().fromArray(normal) : null,
        selfId
      ),
    // The tag redraws itself and asks for its own frame (`annotations.ts`, `setExpanded`).
    showSpot: (id, full) => annotations.showSpot(id, full),

    getCamera: () => cam.getCamera(),
    setCamera: (c) => {
      cam.setCamera(c)
      invalidate()
    },
    setView: (n) => {
      cam.setView(n)
      invalidate()
    },
    setProjection: (p) => {
      cam.setProjection(p)
      invalidate()
    },
    zoomExtents: (zoom) => {
      cam.fitBox(frameBox, zoom)
      cam.fly()
      invalidate()
    },
    zoomTo: (id, zoom) => {
      const ids = Array.isArray(id) ? id : [id]
      const b = new Box3()
      for (const i of ids) {
        const rec = store.elements.get(i)
        if (rec) b.union(rec.bbox)
      }
      if (!b.isEmpty()) {
        cam.fitBox(b.expandByScalar(0.6), zoom)
        cam.fly()
        invalidate()
      }
    },
    focusPoint: (p) => {
      const v = new Vector3().fromArray(p)
      cam.fitBox(new Box3().setFromCenterAndSize(v, new Vector3(6, 6, 6)))
      cam.fly()
      invalidate()
    },
    // 2026-10-02. A flight, like every other camera move that is asked for rather than dragged.
    lookAlong: (theta, phi) => {
      cam.setAngles(theta, phi)
      cam.fly()
      invalidate()
    },

    debug: () => ({
      cam: cam.camera.position.toArray().map((v) => +v.toFixed(2)),
      target: cam.goal.target.toArray().map((v) => +v.toFixed(2)),
      dist: +cam.goal.dist.toFixed(2),
      half: +cam.goal.half.toFixed(2),
      proj: cam.projection,
      // Both slots' uniforms, the gridline cut first; a parked one reads [0, 0, 1, 100000].
      planes: materials.clip.map((u) => [...u.n.value.toArray(), u.c.value]),
      // `{ grid, level }`, each a configuration or null.
      section: section.current,
      cut: { ...cutStat },
      theme: themeName,
      backend,
      gpu: glRendererName(renderer),
      scale: +stageScale.toFixed(3),
      bbox: store.bbox.isEmpty()
        ? null
        : [...store.bbox.min.toArray(), ...store.bbox.max.toArray()].map((v) => +v.toFixed(2)),
      slots: store.slots.filter((s) => !s.removed).length,
      elements: store.elements.size,
      // Expanded vertices actually uploaded: deduplication is the cost of merging.
      vertices: store.vertices,
      parts: partState.count,
      visible: [...store.elements.values()].filter((r) => r.visible).length,
      shadows: shadowsOn,
      groundGrid: groundGridOn,
      /** Scene z of the ground plane; the file's own height of it is this plus `offset[2]`. */
      ground: store.bbox.isEmpty() ? null : +rig.groundZ.toFixed(3),
      frameBox: frameBox.isEmpty()
        ? null
        : [...frameBox.min.toArray(), ...frameBox.max.toArray()].map((v) => +v.toFixed(2)),
      frameScale: +frameScale.toFixed(3),
      seeThrough: seeThroughCount,
      offset,
      frame: projFrame,
      annotations: annotations.debug(),
      tool,
      hovered,
      selected: [...selected],
      pickable: picker.size,
      hoverMs: +hoverMs.toFixed(3),
      labels: overlay.labels.length,
      cube: !!cube,
      snap: snapper.on,
      calls: drawCalls(),
      reportedCalls: renderer.info.render.drawCalls
    }),

    dispose: () => {
      running = false
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
      options.cubeCanvas?.removeEventListener('pointermove', onCubePointer)
      options.cubeCanvas?.removeEventListener('pointerleave', onCubePointer)
      dprQuery?.removeEventListener('change', onDpr)
      observer.disconnect()
      input.dispose()
      picker.dispose()
      snapper.dispose()
      annotations.dispose()
      overlay.dispose()
      cube?.dispose()
      rig.scene.remove(store.group, edges.group, ...extras)
      store.dispose()
      edges.dispose()
      section.dispose()
      rig.dispose()
      materials.dispose()
      partState.dispose()
      renderer.dispose()
    }
  }
}
