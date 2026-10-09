/**
 * View state — the design's logic class (`design-reference/design/SGVue.dc.html:843–1213`)
 * ported method by method into one Zustand store.
 *
 * Names and semantics are the design's. What differs is invisible:
 *
 * · `model` / `byId` / `loaded` / `propKeys` are store fields rather than instance fields on
 *   the component, because React has to re-render when the federation changes and Zustand is
 *   where that subscription lives. The design got the same re-render from the `setState` that
 *   always followed `buildFederation`.
 * · `setState(patch, cb)` becomes `set(patch)` followed by the callback — Zustand's `set` is
 *   synchronous, so the two are equivalent.
 * · The derived values the design computes inside `renderVals()` live in
 *   `state/selectors/` instead, so they can be unit-tested without a DOM.
 *
 * And one difference is visible, and the owner's (2026-10-01): the design's one `section` is
 * `sections: { grid, level }` — the gridline cut and the level cut, independent of each other
 * and both able to be on. `setSec(kind, patch)` changes one plane, `clearSections()` both, and
 * `gridClick` only ever the gridline plane.
 *
 * And one field of the design's is gone, the owner's too (2026-10-01, the "Ask Vee" handoff):
 * `chatStage`, the busy row's line. A running turn is shown by the assistant's reply being
 * written, whose timeline lives in `ai/trace-store.ts` rather than here; what a finished reply
 * keeps of it — its status, its rows — is `ChatMessage.trace`.
 *
 * Undo is one place: `pushUndo()` snapshots the five `VIS_KEYS`, and every mutation of them
 * reaches it through `up()` — or calls it directly, exactly where the design does.
 *
 * 2026-10-02 — the assistant reaches more of this store (the owner: *"assistant should possess
 * everything user can do on the app"*): the canvas grid, snap, original materials, the model
 * eye, undo and redo, the theme, units, tree mode, sidebar, cards, the armed tool and the tree's
 * search. **No action was added or changed for it** — every tool calls the action its control
 * calls. The one thing added is a reader, `peekHistory(back)`: what a step through the undo
 * history would restore, without taking it, so an undo is held to the scope guard.
 *
 * 2026-10-02, phase 2 — the camera, and a revert that restores what a reply changed.
 *
 * · **Two actions for the camera**, because the controls that move it are not store actions at
 *   all — a double-click, F, a drag and the view cube all live in the viewer: `fitView` (frame
 *   the building or the selection without turning) and `aimCamera` (turn to any direction, by
 *   azimuth and elevation — `shared/view-angles.ts`). The assistant's `set_view` calls these
 *   rather than reaching into the viewer behind the store.
 * · **`applySession` is a store action now**, as it is a method of the design's own logic class
 *   (`SGVue.dc.html:1690`); `model/session.ts` kept only the wiring to main. It moved so that the
 *   chat's per-turn `revert` restores through the same path a session does.
 * · **`revert` puts back everything the reply changed** — the owner, 2026-10-01: *"correct."* —
 *   where the design's restored the five `VIS_KEYS` only: sections, the camera, the display
 *   switches, model colours, colour-by, the selection and the interface settings as well. A
 *   reply's `undoSnap` is the state before it and the parts it changed
 *   (`selectors/snapshot.ts`), so it puts back those parts and nothing the reply left alone.
 *
 * 2026-10-02, phase 3 — **the consent gate.** What reaches outside the view or cannot be undone
 * is never done by the assistant: it asks, and the user's click does it (the owner, asked how
 * the assistant should handle those — *the assistant proposes, and you click Apply in the chat
 * or pick in the Windows dialog* — *"correct."*). The design's pending row carries the request:
 *
 * · **`applyPending` performs an action as well as a patch** (`performGated`). It is the one
 *   place a gated action is performed, it runs only from the row's Apply button, and it takes
 *   the row first — so a request is applied once, by that click, or never. Nothing in `ai/`
 *   calls the actions behind it; `tests/readonly-guard.test.ts` reads the source to hold that.
 * · **Two of those actions are not the store's** — opening a recent file and copying the share
 *   link belong to the model layer, which imports this module — so it hands them in
 *   (`setOutsideActions`), as the viewer is handed in.
 * · **`copyGuid` says whether it copied**, and flashes only when it did: the design's flashed
 *   on a rejected write, and in this app every write was rejected (`../clipboard.ts`).
 *
 * 2026-10-08 — **the base point is read-only.** The owner: *"Maybe just make the coordinates
 * system toggle a read only, dont let user change anything."* The design's `setCoord` (`:1039`)
 * is gone, and with it the card's `onChange`, the assistant's request to change the base point
 * and a session's or a reply's revert putting one back: `coords` is written in exactly one place,
 * `setOffset`, from `bootGeoref` — the boot model's georeferencing, the declaration that defined
 * the federation's frame — and stays right after any unload.
 */
import { create } from 'zustand'
import * as fstack from '../../shared/filter-stack'
import type { FilterSet } from '../../shared/filter-stack'
import { coordsFromGeoref, type BasePoint, type ProjectFrame } from '../../shared/georef'
import type { Georeference } from '../../shared/model-index.types'
import { classColors, colorBy, colorByGroups, colorByIds, HL, type ColorByState } from '../../shared/colors'
import {
  hlFn,
  visFn,
  type FilterStep,
  type Predicate,
  type Rule,
  type StepAction
} from '../../shared/rules'
import { createUndoHistory, pendingPatch, snapVis, VIS_KEYS } from '../../shared/undo'
import type { FederatedElement, Federation } from '../../shared/federate'
import { EMPTY_FEDERATION } from '../../shared/federate'
import { elementColors } from './selectors/filter'
import {
  applyRestore,
  sectionsOf,
  sessionPatch,
  type SessionPayload
} from '../../shared/session-codec'
import { frameKey } from '../../shared/georef'
import { NO_SECTIONS, type SecKind, type SecPlane, type Sections } from '../../shared/sections'
import type { DisplayUnit } from '../../shared/units'
import { sphericalOf } from '../../shared/view-angles'
import {
  mergeUndo,
  revertNote,
  revertPlan,
  turnSnapshot,
  turnUndo,
  type TurnPart,
  type TurnSnapshot,
  type TurnUndo
} from './selectors/snapshot'
import { renameViews, viewpointFrameMatches, viewpointOf, type Viewpoint } from './selectors/views'
import { askAboutText } from './selectors/props'
import { tableCsv } from './selectors/chat'
import { pickableFor } from './selectors/models'
import { el } from '../dom'
import { copyText } from '../clipboard'
import {
  loadFilterSets,
  loadViews,
  storeFilterSets,
  storeViews,
  viewsKeyFor
} from './persist'
import type { ChatChip, ChatPending, ChatTable, PendingAction, PlacedMarkup } from '../ai/executors/context'
import type { ChatTrace } from '../ai/trace-facts'
import { seedAudit } from '../ai/analysis'
import type { MeasureRecord, SpotRecord, SpotShown } from '../viewer/annotations'
import type {
  SectionConfig,
  SectionsConfig,
  Tool,
  Viewer,
  ViewerStats
} from '../viewer/viewer-core'

/**
 * What the status bar reads. `ViewerStats.backend` is a union of the two real backends; the
 * design starts at `'…'` before the renderer has answered (`SGVue.dc.html:849`), so the store
 * widens the field by exactly that much.
 */
export interface Stats {
  fps: number
  backend: ViewerStats['backend'] | '…'
  calls: number
}

export type Theme = 'dark' | 'light'
export type TreeMode = 'entity' | 'type'
export type Projection = 'persp' | 'ortho'
export type CardName = 'project' | 'section' | 'filter' | 'coords' | 'views' | 'measure'
/**
 * The design's mm / m toggle (`SGVue.dc.html:851`), and since 2026-10-09 `ft` — one type with
 * every readout that follows it (`shared/units.ts`).
 */
export type Units = DisplayUnit

/**
 * The design's one `section` (`SGVue.dc.html:848`) is two planes since 2026-10-01
 * (owner-requested): `sections.grid` and `sections.level`, each a `SecPlane` whose `name: ''`
 * means "no plane". `shared/sections.ts` owns the shapes; the card's millimetres become the
 * viewer's metres in `sectionConfigOf` below.
 */
export type { SecKind, SecPlane, Sections }

/**
 * `SGVue.dc.html:849`'s `coords`, but **without the prototype's literal defaults** — plan
 * §3.5 item 5 and the fidelity contract's "never a placeholder". A value is filled from the
 * file's georeferencing when it is there and stays `null` when it is not — and since 2026-10-08
 * nothing else fills it: the card is read-only (`setOffset`).
 *
 * `shared/georef.ts` owns the shape, because the viewer's spot labels and the property card's
 * Centroid row read the same four numbers through the same `toMap`.
 */
export type CoordState = BasePoint

/** No base point: every field blank, never a zero. */
const NO_COORDS: CoordState = { E: null, N: null, Z: null, angle: null }

/** Where the context menu wants to open. The menu itself is Phase 4. `:892`. */
export interface CtxState {
  x: number
  y: number
  id: number | null
}

/**
 * One entry of the sample library behind the `library` popover and the landing pills.
 *
 * `path` is the desktop's: the fidelity contract's allowed deviations back the library with
 * real files the user provides, and here that is the recents list (`main/sessions.ts`). The
 * design's own mock federation has no paths, which is what `#mock` loads instead.
 */
export interface LibraryFile {
  key: string
  name: string
  file: string
  swatch: string
  path?: string
}

/** One background upload row under MODELS (`:1165`) and on the landing page (`:775`). */
export interface UploadRow {
  id: string
  name: string
  stage: string
  pct: number
  kb?: number | null
  done?: boolean
  error?: boolean
  dismiss?: boolean
}

export { VIS_KEYS }

/**
 * One turn in the panel's own transcript (`SGVue.dc.html:1604`). It is **not** the API
 * transcript — main owns that, byte for byte — and it carries the things only the panel
 * needs: the quote a reply was aimed at, the chips and table a tool produced, a patch the
 * scope guard held back, and the view as it stood before the turn so ↺ can put it back.
 */
export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  quote?: { who: string; text: string } | null
  chips?: ChatChip[]
  table?: ChatTable | null
  pending?: ChatPending | null
  /**
   * `:1613`. What `revert` on this reply puts back, or null when the turn changed nothing it
   * could. The design's was `snapVis()`, the five visibility keys as a string; since 2026-10-02
   * it is the whole review state from before the turn and the parts the turn changed
   * (`selectors/snapshot.ts`).
   */
  undoSnap?: TurnUndo | null
  /**
   * 2026-10-02 — the markups this reply's own calls placed (`manage_markups` `place_spot` /
   * `place_measure`), each by its record's own id. A spot or a measurement drawn in the 3D view
   * is session view state, so `revert` takes away the ones that are still there — these, and no
   * markup the user or another reply placed. Absent when the reply placed none; given up with
   * `undoSnap` once the reply is reverted.
   */
  placed?: readonly PlacedMarkup[] | null
  reverted?: boolean
  /**
   * 2026-10-01 — what the turn's thinking trace leaves on its reply (`ai/trace-facts.ts`): the
   * status beside the name (`checked 86 walls · 7s`), the rows under the answer, and whether
   * the reply keeps the trace bubble's full width. Absent on a message no turn produced — the
   * boot audit — which is how the panel tells the two apart.
   */
  trace?: ChatTrace | null
}

/** What one finished turn adds to its assistant message. */
export interface ChatResult {
  chips?: ChatChip[]
  table?: ChatTable | null
  pending?: ChatPending | null
  acted?: boolean
  /**
   * 2026-10-02 — the parts of the review state the turn's own tool calls changed
   * (`TurnState.parts`). Absent means "not measured": every part that differs is the turn's.
   */
  parts?: readonly TurnPart[]
  /** 2026-10-02 — the markups the turn's own calls placed (`TurnState.placed`), by record id. */
  placed?: readonly PlacedMarkup[]
  /** 2026-10-01 — the trace's summary, from `traceDone` (`ai/trace-store.ts`). */
  trace?: ChatTrace | null
}

/** A hand-sized sidebar section: its height and its floor, in CSS pixels. */
export interface SideSize {
  h: number
  min: number
}

export interface ShellState {
  /* ── federation (the design's `this.model` / `byId` / `loaded` / `propKeys`) ── */
  federation: Federation
  byId: ReadonlyMap<number, FederatedElement>
  propKeys: readonly string[]
  loaded: readonly string[]
  /** The sample library. Empty unless real sample files exist — BUILD_PLAN pitfall 25. */
  library: readonly LibraryFile[]
  /**
   * Whole metres the geometry pipeline subtracted from every placement so the scene sits near
   * the origin (`shared/geometry-contract.types.ts`). The design has no equivalent: its mock
   * federation is authored at the origin. Anything that reports an absolute coordinate — the
   * property card's Base / top and Centroid rows — adds it back to reach the project frame.
   */
  offset: readonly [number, number, number]
  /**
   * The federation's frame, P: the boot model's project frame expressed in map coordinates —
   * its own map operation over its spatial-root `IfcSite.ObjectPlacement`, project → map
   * (`shared/georef.ts`'s `federationFrame`, 2026-10-08) — which the geometry pipeline undid so
   * the scene stands square with the building. For a boot model whose map operation is the
   * identity it is that site placement, as it always was. `null` is the identity.
   *
   * It is here, beside the offset, because the session, the share link and every saved
   * viewpoint store a camera in **scene** coordinates — so each of them records which frame
   * that was (`shared/georef.ts`'s `frameKey`) and a payload from another one restores
   * everything except the camera.
   */
  frame: ProjectFrame | null
  /**
   * 2026-10-08 — the boot model's georeferencing: **the declaration that defined P** (`frame`),
   * set with it and the offset at boot (`setOffset`) and kept after that model is unloaded, as the
   * frame is. The base point (`coords`), the Coordinate-system card's chip and caption, the status
   * bar's CRS chip and `basePointSource` are all read off it, so they describe the frame actually
   * in use — after any unload, and after a boot model whose own geometry failed once another model
   * stood in its frame. `null` while nothing is loaded, and for a federation with no file behind
   * its boot model (the design's mock, the demo building).
   */
  bootGeoref: Georeference | null

  /* ── the design's `state` (`:846–853`), in its own order ── */
  theme: Theme
  panelOpen: boolean
  treeMode: TreeMode
  search: string
  expanded: Record<string, boolean>
  storeyVis: Record<string, boolean>
  modelVis: Record<string, boolean>
  addOpen: boolean
  hidden: Record<number | string, boolean>
  sel: number | null
  selIds: readonly number[]
  tool: Tool
  /** Which property-card sections are open, by `'ids' | 'rel' | 'geo'`. `:848`, `:1978`. */
  propOpen: Record<string, boolean>
  /** The GlobalId copy button's 1 400 ms flash. `:1990–1993`. */
  copied: boolean
  grids: boolean
  levels: boolean
  view: string | null
  proj: Projection
  card: CardName | null
  /** The gridline cut and the level cut — independent, and both can be on. */
  sections: Sections
  coords: CoordState
  ctx: CtxState | null
  /** `:894`. The two lists and their counts, straight from the viewer's callbacks. */
  measures: readonly MeasureRecord[]
  spots: readonly SpotRecord[]
  measureCount: number
  spotCount: number
  stats: Stats
  shadows: boolean
  /**
   * The fine ground grid under the model (2026-09-24, owner-requested: *"Add an option to
   * toggle off canvas gridline."*). Not the IFC grids — that is `grids`. Off, the ground veil
   * goes with it (2026-10-08, owner-requested), so nothing below grade is dimmed. Not saved in a
   * session. It was recorded then as not reachable by the assistant; since 2026-10-02 it is
   * (`toggle_display`'s `groundGrid`, through `setGroundGrid` below) — the owner's direction
   * of 2026-10-01, *"assistant should possess everything user can do on the app"*.
   */
  groundGrid: boolean
  modelColors: Record<string, string>
  nativeMats: boolean
  palette: string | null
  dims: boolean
  active: string | null
  confirmRemove: string | null
  snap: boolean
  uploads: readonly UploadRow[]
  uploadNames: Record<string, string>
  booted: boolean
  /** `:853`. The landing drop zone is under the pointer with files (`:1143`). */
  dragging: boolean
  /** `:851`. What the landing page's warning banner says, or `''`. */
  initErr: string
  /** `:851`. "link copied" stands for 1 600 ms (`:1718`). */
  linkCopied: boolean
  /**
   * `:852`. The highlight colour pushed to the renderer, saved and restored by the session.
   * Nothing in the prototype ever wrote it; `setStepColor` does here, because it is already
   * the call that tells the viewer (`:2002`) and the recorded value should agree with it.
   */
  hlColor: string
  /**
   * `:850`. Phase 9 owns the panel; `askAbout` already opens it and writes the composer's
   * pre-fill, which is what the context menu's "Ask about this" is.
   */
  chatOpen: boolean
  chatInput: string
  chatMsgs: ChatMessage[]
  chatBusy: boolean
  chatErr: string
  /** Index of the message a reply is aimed at, or null. `:1595`. */
  chatReplyTo: number | null
  /** The panel's own size, dragged by its top-left corner. `:850`, `:1127`. */
  chatW: number
  chatH: number
  /**
   * 2026-09-24 — the suggestion row, once the conversation has a user turn, folds behind one
   * `suggestions` chip; this is whether that chip has it open. `chipsFolded` decides.
   */
  chatSuggestOpen: boolean
  /**
   * 2026-09-24 — the sidebar's MODELS and STOREYS rows, sized by hand with their drag handles
   * (`selectors/sidebar.ts`): the height and the one-row floor, or `null` for the design's
   * automatic layout. For this app session only; never written to disk.
   */
  sideModels: SideSize | null
  sideStoreys: SideSize | null
  vpW: number
  units: Units
  canUndo: boolean
  canRedo: boolean
  stack: readonly FilterStep[]
  /** Which step the rule builder is editing. `SGVue.dc.html:852`, `:957`. */
  stepSel: string | null
  /**
   * The colour-by-property scheme behind the legend. `SGVue.dc.html:852`, written at `:1355`.
   * **Not** a `VIS_KEY` — it changes no element's visibility, so ⌘Z does not walk it back
   * (`:1013`, and `shared/undo.ts`).
   */
  colorBy: ColorByState | null
  /** Saved filter sets, capped at twelve. `:851`, `:1667`. */
  filterSets: readonly FilterSet[]
  /** Saved viewpoints for the current building. `:850`, `:1102`. */
  views: readonly Viewpoint[]
  /** The viewpoint restored last, which marks its row. `:1731`, `:1958`. */
  activeView: number | null
  hint: string
  ready: boolean
  loadMsg: string
  visibleCount: number
  cardTop: number
  /**
   * 2026-10-01 — the bottom row's lane, in CSS pixels: what its centre zone stands above the
   * one-line row (`selectors/lanes.ts`, `browFrom`). Measured by `app/BottomRow.tsx`, declared
   * on the stage as `--brow`; `0` whenever the row is one line. Layout only, never saved.
   */
  brow: number

  /* ── actions ── */
  setTheme: (theme: Theme) => void
  togglePanel: () => void
  setTreeMode: (mode: TreeMode) => void
  setSearch: (search: string) => void
  toggleGroup: (key: string) => void
  toggleStorey: (name: string) => void
  soloStorey: (name: string, solo: boolean, names: readonly string[]) => void
  allStoreys: () => void
  toggleModel: (key: string) => void
  setModelColor: (key: string, c: string | null) => void
  togglePalette: (key: string) => void
  askRemove: (key: string) => void
  cancelRemove: () => void
  toggleNative: () => void
  toggleAdd: () => void
  activate: (key: string | null) => void
  setTool: (tool: Tool) => void
  toggleSnap: () => void
  toggleGrids: () => void
  toggleLevels: () => void
  setShadows: (b: boolean) => void
  setGroundGrid: (b: boolean) => void
  setView: (name: string) => void
  toggleProj: () => void
  /**
   * 2026-10-02 — frame the building (`extents`) or everything selected (`selection`) without
   * turning the camera: a double-click on empty space, and F. `zoom` is a factor on that fit.
   */
  fitView: (what: 'extents' | 'selection', zoom?: number) => void
  /**
   * 2026-10-02 — turn the camera to a direction, as the view cube does for its 26: azimuth and
   * elevation in degrees, in the project frame (`shared/view-angles.ts`). One left `undefined`
   * keeps the camera's own.
   */
  aimCamera: (azimuthDeg: number | undefined, elevationDeg: number | undefined) => void
  openCard: (name: CardName) => void
  closeCard: () => void

  /* ── annotation (Phase 6) ── */
  /**
   * `SGVue.dc.html:1035`, per plane: only `kind`'s plane changes, the other is untouched.
   * `open` also brings the Section card up — a grid bubble does that.
   */
  setSec: (kind: SecKind, patch: Partial<SecPlane>, open?: boolean) => void
  /** Both planes back to nothing: the card's `Clear all`. */
  clearSections: () => void
  /**
   * `:895`. A grid bubble was clicked: toggle the **gridline** plane, previewed, and open the
   * card. The level plane is never touched by a bubble.
   */
  gridClick: (name: string) => void
  /**
   * `:2060`. The Markups card's mm / m toggle — and `ft` since 2026-10-09. Also set once at
   * every boot, to the boot model's own unit (`model/federation-store.ts`).
   */
  setUnits: (units: Units) => void
  /** `:894`. The viewer's `on.measure` / `on.spot`. */
  setMeasures: (list: readonly MeasureRecord[]) => void
  setSpots: (list: readonly SpotRecord[]) => void
  /** `:2071` and `:713–714`, and the Markups card's rows. */
  clearMeasures: () => void
  clearSpots: () => void
  dropMeasure: (id: number) => void
  dropSpot: (id: number) => void
  /** `:2064`. Zoom to a markup. */
  focusPoint: (p: readonly number[]) => void
  /**
   * 2026-10-02, phase 4 — a markup placed at a **project-frame** point (metres, Z up: the frame
   * an element's box is reported in), for the assistant's `manage_markups`. It is the viewer's
   * own commit for a click with the spot tool or the laser meter (`viewer-core.ts`), at a point
   * that is named rather than clicked — so the record, its labels and its number are a click's.
   * `normal` is the face the point sits on, or `null`; `selfId` the element it sits on, or −1.
   * False when nothing was placed: there is no 3D view, or — for a measurement — no ray read
   * anything.
   */
  placeSpot: (p: readonly [number, number, number]) => boolean
  placeMeasure: (
    p: readonly [number, number, number],
    normal: readonly [number, number, number] | null,
    selfId: number
  ) => boolean
  /** One spot tag's state, set — its level alone, or its full E / N / Z: a click on the tag. */
  showSpot: (id: number, full: boolean) => SpotShown
  select: (id: number | number[] | null, zoom?: boolean, mode?: 'replace' | 'toggle') => void
  setCtx: (ctx: CtxState | null) => void
  /** `SGVue.dc.html:1981` — one property-card section opens or closes. */
  toggleProp: (key: string) => void
  /**
   * `SGVue.dc.html:1991` — copy a GlobalId and flash "Copied" for 1 400 ms. Since 2026-10-02 it
   * resolves to whether the text reached the clipboard, and flashes only when it did.
   */
  copyGuid: (guid: string) => Promise<boolean>
  /**
   * `SGVue.dc.html:2029` — the chat table's `copy csv`. Resolves to whether the CSV reached the
   * clipboard; the control has no flash, so a copy that did not is said in the panel's status
   * line (phase 4 — until then it called the API this app always refuses, and copied nothing).
   */
  copyTable: (table: ChatTable) => Promise<boolean>
  /** `SGVue.dc.html:1650` — open the assistant with the designed pre-fill. Panel: Phase 9. */
  askAbout: (ids: readonly number[]) => void
  setChatOpen: (open: boolean) => void
  setChatInput: (text: string) => void
  setChatReplyTo: (index: number | null) => void
  /** What one corner drag settles on. `:1132`. */
  setChatSize: (chatW: number, chatH: number) => void
  setChatSuggestOpen: (open: boolean) => void
  setSideSize: (which: 'models' | 'storeys', size: SideSize | null) => void
  /** Push the user turn and take the pre-turn snapshot. Returns it. `:1599`. */
  chatBegin: (text: string, quote?: { who: string; text: string } | null) => TurnSnapshot
  chatFinish: (reply: string, result: ChatResult, before: TurnSnapshot) => void
  chatFail: (message: string) => void
  applyPending: (index: number) => void
  dismissPending: (index: number) => void
  revertTurn: (index: number) => void
  /**
   * `SGVue.dc.html:1690`. Put a session payload back: the state patch, then the renderer calls
   * in `RESTORE_ORDER`. A share link and the chat's revert both come through here.
   */
  applySession: (p: Partial<SessionPayload>) => void
  /** The local audit that greets a fresh federation, as the first turn. `:1642`. */
  seedChat: () => void
  hide: (ids: readonly number[]) => void
  show: (ids: readonly number[]) => void
  isolate: (ids: readonly number[]) => void
  showAll: () => void
  toggleDims: () => void
  applyVis: () => void
  /** `SGVue.dc.html:1001` — the one composed element-colour map, pushed to the viewer. */
  applyColors: (s?: ShellState, vis?: Predicate) => void
  /** `SGVue.dc.html:1015` — snapshot the five `VIS_KEYS` and drop the redo branch. */
  pushUndo: () => void
  /** `SGVue.dc.html:1023` — ⌘Z (`back`) / ⇧⌘Z. */
  step: (back: boolean) => void
  /** `SGVue.dc.html:1019` — every `VIS_KEYS` mutation goes through here. */
  up: (patch: Partial<ShellState>, noUndo?: boolean) => void

  /* ── the filter stack (`SGVue.dc.html:949–974`, `:1997–2007`) ── */
  addStep: (action?: StepAction, rules?: readonly Rule[]) => void
  updStep: (id: string, patch: Partial<FilterStep>) => void
  moveStep: (id: string, d: number) => void
  dropStep: (id: string) => void
  pickStep: (id: string) => void
  clearStack: () => void
  setStepRules: (id: string, rules: readonly Rule[]) => void
  setStepColor: (id: string, color: string) => void

  /* ── colour by property (`SGVue.dc.html:1339–1356`, `:2042–2044`) ── */
  /**
   * A distinct colour per distinct value of `prop`, plus the legend. Returns the scheme, as
   * the design returns its groups so `color_by_property` can report them (`:1553`), and
   * **`null` when nothing carries the property — leaving any live scheme alone**, which is
   * what makes that tool able to answer "nothing carries X" without clearing the legend.
   */
  setColorBy: (prop: string | null, rules?: readonly Rule[]) => ColorByState | null
  /** The same, over a found set rather than a rule list. 2026-09-20. */
  setColorByIds: (prop: string | null, ids: readonly number[]) => ColorByState | null
  /**
   * 2026-09-25 — the Schedules window's "Colour 3D by this column": groups whose values were
   * read there (a column's displayed text), coloured by `colorBy`'s own rule.
   */
  setColorByGroups: (
    prop: string,
    groups: readonly { value: string; ids: readonly number[] }[]
  ) => ColorByState | null
  /** `:1340` and the legend's × (`:2044`). */
  clearColorBy: () => void

  /* ── saved filter sets (`:1659–1673`) ── */
  saveFilterSet: (name?: string) => void
  applyFilterSet: (set: FilterSet) => void
  forgetFilterSet: (id: number) => void

  /* ── viewpoints (`:1722–1735`) ── */
  saveView: () => void
  restoreView: (v: Viewpoint) => void
  dropView: (id: number) => void
  /** 2026-09-24: a double-clicked name, committed. Trimmed; blank keeps the old name. */
  renameView: (id: number, name: string) => void

  /* ── the landing page and the upload rows (`:1143–1200`, `:1930–1940`) ── */
  /** `:1143`, `:1145`. The drop zone's accent border and "Release to load". */
  setDragging: (dragging: boolean) => void
  /** `:1114`, `:2055`. The landing page's warning banner, and its `dismiss`. */
  setInitErr: (initErr: string) => void
  /** `:1167`. A rejected file gets a dismissible row rather than disappearing. */
  addUpload: (row: UploadRow) => void
  /** `:1174`. One row's stage, percentage or state. */
  patchUpload: (id: string, patch: Partial<UploadRow>) => void
  /** `:1169`. The row's × . */
  dropUpload: (id: string) => void
  /** `:1718`. The 1 600 ms "link copied" flash. */
  setLinkCopied: (linkCopied: boolean) => void

  /* ── federation plumbing (`buildFederation` / `boot` / `setModels`) ── */
  setLibrary: (files: readonly LibraryFile[]) => void
  /**
   * The federation's offset, its frame P and the declaration that defined P — fixed together at
   * boot, and cleared together when nothing is loaded. **The one place `coords` is written**
   * (2026-10-08, the read-only card): the base point is P read off `bootGeoref`.
   */
  setOffset: (
    offset: readonly [number, number, number],
    frame: ProjectFrame | null,
    bootGeoref: Georeference | null
  ) => void
  beginModels: (loadMsg: string) => void
  commitModels: (federation: Federation) => void

  /* ── viewer callbacks (`initViewer`'s `on` map, `:890–896`) ── */
  setStats: (stats: ViewerStats) => void
  setHint: (hint: string) => void
  setProjection: (proj: Projection) => void
  clearView: () => void
  setCardTop: (cardTop: number) => void
  setVpW: (vpW: number) => void
  setBrow: (brow: number) => void
}

/**
 * The viewer handle. The design keeps it as `this.viewer` — an instance field, never state,
 * because it is an imperative object and re-rendering on it would mean nothing.
 */
let viewer: Viewer | null = null
export const setViewer = (v: Viewer | null): void => {
  viewer = v
}
export const getViewer = (): Viewer | null => viewer

/**
 * The two gated actions the store cannot perform by itself (2026-10-02, the consent gate): they
 * are the model layer's, and `model/` imports this module. `model/boot.ts` hands them in when
 * the shell mounts — as the viewer handle is handed in — and with none handed in, Apply on such
 * a request does nothing and says so.
 */
export interface OutsideActions {
  /**
   * Open one file of **main's own recents list**, by the path that list has for it — the Recent
   * pill's route, so `admit()` and the "Replace model?" question apply. `gone` when the file is
   * no longer on that list, `moved` when main no longer admits it (deleted, renamed, replaced).
   */
  openRecent: (path: string) => Promise<'opening' | 'gone' | 'moved'>
  /** The Viewpoints card's "copy link to this state". `false` when the clipboard refused. */
  copyLink: () => Promise<boolean>
}
let outside: OutsideActions | null = null
export const setOutsideActions = (actions: OutsideActions | null): void => {
  outside = actions
}

/**
 * Run a sequence of viewer calls as one `viewer.batch` — one repaint, one edge rebuild and one
 * picker rebuild at the end, however many of the calls asked for them. Without a viewer the
 * calls still run (they are the store's as much as the viewer's).
 */
export const batched = (fn: () => void): void => {
  if (viewer) viewer.batch(fn)
  else fn()
}

/**
 * The whole review state as it stands, for the chat's per-turn revert — the store's fields and
 * the camera, which only the viewer knows (`selectors/snapshot.ts`).
 */
const snapshot = (s: ShellState): TurnSnapshot => turnSnapshot(s, viewer?.getCamera() ?? null)

/**
 * A `VIS_KEYS` snapshot to restore, for `step()`. A snapshot older than the current federation
 * can name a model that has since been unloaded; activating one would make every remaining model
 * inert with no control left to undo it, so that `active` becomes `null`. (`revertTurn` keeps the
 * same rule, in `selectors/snapshot.ts`'s `revertPlan`.)
 */
export function restoredVis(
  snap: string,
  loaded: readonly string[]
): Pick<ShellState, (typeof VIS_KEYS)[number]> {
  const o = JSON.parse(snap) as Pick<ShellState, (typeof VIS_KEYS)[number]>
  return { ...o, active: o.active && loaded.includes(o.active) ? o.active : null }
}

/** The frame loop's latest draw count — `setStats` — for the dev `stats()` hook only. */
let drawCalls = 0
export const lastDrawCalls = (): number => drawCalls

/**
 * The undo and redo stacks. **Outside reactive state**, as the design keeps them
 * (`SGVue.dc.html:1016` — `this.undoStack`, an instance field): only `canUndo` / `canRedo`
 * are state, so a snapshot re-renders nothing.
 */
const history = createUndoHistory()

/** For tests: the two stacks are module state, so a fresh store needs a fresh history. */
export const resetHistory = (): void => history.reset()
export const historyDepth = (): { undo: number; redo: number } => history.depth()
/**
 * 2026-10-02 — the `VIS_KEYS` snapshot `step(back)` would restore, or `null` when there is
 * nothing on that side. A read: nothing moves. The assistant's undo / redo asks before it steps,
 * so that a step which would blank the view is held to the scope guard like any other change
 * (`ai/executors/view.ts`).
 */
export const peekHistory = (back: boolean): string | null => history.peek(back)

/** The storage key `views` is read from and written to — one list per building (`:1102`). */
let viewsKey = viewsKeyFor('')

/** How long "Copied" stands on the GlobalId button. `SGVue.dc.html:1991`. */
export const COPIED_MS = 1400
let copyTimer: ReturnType<typeof setTimeout> | undefined

/**
 * One of the card's planes as the viewer wants it: millimetres become metres (`:1037`, `:1703`,
 * `:1733` all divide by 1000 — this is the one place the port does), and the design's `'level'`
 * is the viewer's `'storey'` — the renderer was ported from `viewer-core.js`, which names the
 * same plane after the entity it comes from. A plane with no name is no plane: `null`.
 */
function sectionConfigOf(kind: SecKind, plane: SecPlane): SectionConfig | null {
  if (!plane?.name) return null
  return {
    kind: kind === 'level' ? 'storey' : 'grid',
    name: plane.name,
    offset: plane.offset / 1000,
    flip: plane.flip,
    cut: plane.cut
  }
}

/** Both planes, for `viewer.setSections`. */
const sectionsConfigOf = (s: Sections): SectionsConfig => ({
  grid: sectionConfigOf('grid', s.grid),
  level: sectionConfigOf('level', s.level)
})

/**
 * `SGVue.dc.html:1063`. The cube and the property card own the right-hand strip of the
 * viewport, so the dimension labels are told to keep clear of them — measured rectangles, not
 * a guess (`BUILD_PLAN.md` §6 pitfall 13).
 */
function pushDims(ids: readonly number[], dims: boolean): void {
  if (!viewer) return
  const c = el('viewport')
  if (!c) return
  const cr = c.getBoundingClientRect()
  const avoid: { x: number; y: number; w: number; h: number }[] = []
  for (const role of ['cube', 'propcard']) {
    const e = el(role)
    if (!e) continue
    const r = e.getBoundingClientRect()
    if (r.width) avoid.push({ x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height })
  }
  // The card mounts in the same commit as the selection, so fall back to its known geometry.
  if (ids.length && !el('propcard')) avoid.push({ x: cr.width - 332, y: 184, w: 320, h: 300 })
  viewer.setDims([...ids], dims && ids.length > 0, avoid)
}

/** What the panel's status line says when a copy the user applied did not reach the clipboard. */
export const CLIPBOARD_REFUSED = 'The clipboard could not be written, so nothing was copied.'

/**
 * Perform one gated action — **called only by `applyPending`, which only the pending row's Apply
 * button calls** (2026-10-02, the consent gate). Each branch is the action the control of that
 * thing calls: the action bar's Undo, a Viewpoints row and its ×, a Markups row's × and a
 * list's `clear`, the Filter card's × on a saved set and its Save where that forgets one, the
 * property card's Copy — and, handed in by the model layer, a Recent pill and "copy link to this
 * state". (The Coordinate-system card's fields were one until 2026-10-08, when the card became
 * read-only and nothing in the app could change the base point any more.)
 *
 * A request is fixed to what it named when it was made. When that is no longer there at the
 * click — a viewpoint deleted since, a markup list that has changed, an undo history that has
 * moved on — **nothing is done**, and the sentence returned says so; `''` means it was done (or,
 * for the three that finish later, started: those report a failure through `fail`).
 */
function performGated(a: PendingAction, get: () => ShellState, fail: (note: string) => void): string {
  const s = get()
  /** The list is exactly the one the request counted. */
  const same = (ids: readonly number[], now: readonly { id: number }[]): boolean =>
    ids.length === now.length && now.every((m, i) => m.id === ids[i])
  switch (a.kind) {
    case 'undo':
    case 'redo': {
      const back = a.kind === 'undo'
      if (history.peek(back) !== a.snap) {
        return `What can be ${back ? 'undone' : 'redone'} has changed since that was asked, so nothing was ${back ? 'undone' : 'redone'} — the action bar’s own ${back ? 'Undo' : 'Redo'} takes the step there is now.`
      }
      s.step(back)
      return ''
    }
    case 'restore_view': {
      const view = s.views.find((v) => v.id === a.id)
      if (!view) return 'That viewpoint is no longer in the list, so nothing was restored.'
      if (!viewer) return 'There is no 3D view to restore a viewpoint in.'
      s.restoreView(view)
      return ''
    }
    case 'delete_view':
      if (!s.views.some((v) => v.id === a.id)) return 'That viewpoint is no longer in the list, so nothing was deleted.'
      s.dropView(a.id)
      return ''
    case 'delete_measure':
      if (!s.measures.some((m) => m.id === a.id)) return 'That measurement is no longer there, so nothing was deleted.'
      s.dropMeasure(a.id)
      return ''
    case 'delete_spot':
      if (!s.spots.some((m) => m.id === a.id)) return 'That spot coordinate is no longer there, so nothing was deleted.'
      s.dropSpot(a.id)
      return ''
    case 'clear_measures':
      if (!same(a.ids, s.measures)) return 'The laser measurements have changed since that was asked, so none was deleted.'
      s.clearMeasures()
      return ''
    case 'clear_spots':
      if (!same(a.ids, s.spots)) return 'The spot coordinates have changed since that was asked, so none was deleted.'
      s.clearSpots()
      return ''
    case 'delete_filter_set':
      if (!s.filterSets.some((f) => f.id === a.id)) return 'That filter set is no longer saved, so nothing was forgotten.'
      s.forgetFilterSet(a.id)
      return ''
    case 'save_filter_set': {
      // The card's own Save — only while a save under that name would still forget exactly the
      // sets the request named: not another one, and not none because the filter has gone.
      const gone = fstack.forgottenBySave(s.filterSets, s.stack, a.name).map((f) => f.id)
      if (gone.length !== a.forgets.length || gone.some((id, i) => id !== a.forgets[i])) {
        return 'The saved filter sets, or the filter itself, have changed since that was asked, so nothing was saved.'
      }
      s.saveFilterSet(a.name)
      return ''
    }
    case 'copy_guids':
      void s.copyGuid(a.text).then((ok) => {
        if (!ok) fail(CLIPBOARD_REFUSED)
      })
      return ''
    case 'copy_link':
      if (!outside) return 'A link cannot be copied from here.'
      void outside.copyLink().then(
        (ok) => {
          if (!ok) fail(CLIPBOARD_REFUSED)
        },
        () => fail(CLIPBOARD_REFUSED)
      )
      return ''
    case 'open_recent':
      if (!outside) return 'A file cannot be opened from here.'
      void outside.openRecent(a.path).then(
        (how) => {
          if (how === 'gone') fail('That file is no longer on the recent list, so nothing was opened.')
          else if (how === 'moved') fail('That file is no longer where it was, so nothing was opened.')
        },
        () => fail('That file could not be opened.')
      )
      return ''
  }
}

/**
 * A selector for exactly these store fields, for `useShell(useShallow(pick(…)))`: the
 * component re-renders when one of them changes and on no other store write. Build it once,
 * at module level — `useShallow` hands back the previous object while every field is the same.
 */
export const pick =
  <K extends keyof ShellState>(...keys: K[]) =>
  (st: ShellState): Pick<ShellState, K> => {
    const o = {} as Pick<ShellState, K>
    for (const k of keys) o[k] = st[k]
    return o
  }

export const useShell = create<ShellState>((set, get) => ({
  federation: EMPTY_FEDERATION,
  byId: EMPTY_FEDERATION.byId,
  propKeys: [],
  loaded: [],
  library: [],
  offset: [0, 0, 0],
  frame: null,
  bootGeoref: null,

  theme: 'dark',
  panelOpen: true,
  treeMode: 'entity',
  search: '',
  expanded: {},
  storeyVis: {},
  modelVis: {},
  addOpen: false,
  hidden: {},
  sel: null,
  selIds: [],
  tool: 'select',
  propOpen: {},
  copied: false,
  grids: true,
  levels: false,
  view: 'iso',
  proj: 'persp',
  card: null,
  sections: NO_SECTIONS,
  coords: NO_COORDS,
  ctx: null,
  measures: [],
  spots: [],
  measureCount: 0,
  spotCount: 0,
  stats: { fps: 0, backend: '…', calls: 0 },
  shadows: true,
  groundGrid: true,
  modelColors: {},
  nativeMats: true,
  palette: null,
  dims: false,
  active: null,
  confirmRemove: null,
  snap: true,
  uploads: [],
  uploadNames: {},
  booted: false,
  dragging: false,
  initErr: '',
  linkCopied: false,
  hlColor: HL[0],
  chatOpen: false,
  chatInput: '',
  chatMsgs: [],
  chatBusy: false,
  chatErr: '',
  chatReplyTo: null,
  chatW: 330,
  chatH: 420,
  chatSuggestOpen: false,
  sideModels: null,
  sideStoreys: null,
  vpW: 0,
  units: 'mm',
  canUndo: false,
  canRedo: false,
  stack: [],
  stepSel: null,
  colorBy: null,
  // `loadFilterSets()` at mount (`SGVue.dc.html:864`); the store is created once, at import.
  filterSets: loadFilterSets(),
  views: [],
  activeView: null,
  hint: '',
  ready: false,
  loadMsg: 'Loading model…',
  visibleCount: 0,
  cardTop: 64,
  brow: 0,

  /* ────────────────────────────── visibility ────────────────────────────── */

  /** `SGVue.dc.html:991`. */
  applyVis: () => {
    const v = viewer
    if (!v) return
    const s = get()
    const vis = visFn(s)
    const hl = hlFn(s)
    const byId = s.byId
    // One repaint for the three calls, not one each (refactor pass 2, `viewer.batch`).
    batched(() => {
      // The renderer only knows `{ id, model }` per element (`ViewerElement`); the predicate the
      // design writes reads the whole element, so it is resolved through the federation here.
      v.setVisibility((e) => {
        const full = byId.get(e.id)
        return full ? vis(full) : true
      })
      v.setHighlight(
        hl ? s.federation.elements.filter((e) => vis(e) && hl(e)).map((e) => e.id) : null
      )
      s.applyColors(s, vis)
    })
    const n = s.federation.elements.filter(vis).length
    if (n !== s.visibleCount) set({ visibleCount: n })
  },

  /**
   * `SGVue.dc.html:1001`. One map, composed: the colour-by scheme underneath, then each enabled
   * highlight step's own colour in stack order. The two parameters are the design's own — the
   * caller that has already computed `vis` passes it rather than making `visFn` run twice.
   */
  applyColors: (state, vis) => {
    if (!viewer) return
    const s = state ?? get()
    viewer.setElementColors(
      elementColors(s.federation.elements, s.stack, vis ?? visFn(s), s.colorBy)
    )
  },

  /** `SGVue.dc.html:1015`. */
  pushUndo: () => {
    const s = get()
    history.push(snapVis(s))
    if (!s.canUndo || s.canRedo) set({ canUndo: true, canRedo: false })
  },

  /**
   * `SGVue.dc.html:1023`. Restores only the five `VIS_KEYS`, then re-applies pickability —
   * activate mode is one of them and `setPickable` is imperative, so the viewer has to be told.
   */
  step: (back) => {
    const s = get()
    const moved = history.step(back, snapVis(s))
    if (!moved) return
    const o = restoredVis(moved.snap, s.loaded)
    const { active } = o
    set({ ...o, canUndo: moved.canUndo, canRedo: moved.canRedo })
    batched(() => {
      viewer?.setPickable(pickableFor(active))
      get().applyVis()
    })
  },

  /** `SGVue.dc.html:1019`. */
  up: (patch, noUndo) => {
    if (!noUndo && VIS_KEYS.some((k) => k in patch)) get().pushUndo()
    set(patch)
    get().applyVis()
  },

  /* ────────────────────────────── the filter stack ────────────────────────────── */

  /** `SGVue.dc.html:959`. A new step is selected the moment it is added. */
  addStep: (action = 'isolate', rules) => {
    const s = get()
    const st = fstack.newStep(s.stack, action, rules)
    s.up({ stack: [...s.stack, st], stepSel: st.id })
  },

  /** `SGVue.dc.html:958`. */
  updStep: (id, patch) => get().up({ stack: fstack.updStep(get().stack, id, patch) }),

  /** `SGVue.dc.html:960`. */
  moveStep: (id, d) => {
    const s = get()
    const stack = fstack.moveStep(s.stack, id, d)
    if (stack === s.stack) return
    s.up({ stack })
  },

  /** `SGVue.dc.html:966`. */
  dropStep: (id) => get().up(fstack.dropStep(get().stack, id)),

  /** `SGVue.dc.html:1892` — clicking a step row selects it; `stepSel` is not a `VIS_KEY`. */
  pickStep: (id) => set({ stepSel: id }),

  /** `SGVue.dc.html:2000`. */
  clearStack: () => get().up({ stack: [], stepSel: null }),

  setStepRules: (id, rules) => get().updStep(id, { rules }),

  /**
   * `SGVue.dc.html:2002`. The design also pushes the colour to the viewer, which is what
   * paints a step whose own colour is not in the element-colour map yet.
   */
  setStepColor: (id, color) => {
    get().updStep(id, { color })
    set({ hlColor: color })
    viewer?.setHighlightColor(color)
  },

  /* ────────────────────────────── colour by property ────────────────────────────── */

  /**
   * `SGVue.dc.html:1339`. The design has one method for both directions, so a falsy property
   * clears — which is the path `color_by_property(null)` takes (`:1552`).
   */
  setColorBy: (prop, rules) => {
    if (!prop) {
      get().clearColorBy()
      return null
    }
    const next = colorBy(get().federation.elements, prop, rules)
    // `:1350` returns before its own `setState`: nothing carries the property, so the live
    // scheme — if there is one — is left exactly as it was.
    if (!next) return null
    set({ colorBy: next })
    get().applyColors()
    return next
  },

  /** The `ids` half of the same action, on the same two rules. 2026-09-20. */
  setColorByIds: (prop, ids) => {
    if (!prop) {
      get().clearColorBy()
      return null
    }
    const next = colorByIds(get().federation.elements, prop, ids)
    if (!next) return null
    set({ colorBy: next })
    get().applyColors()
    return next
  },

  /**
   * The same action again, over groups the Schedules window read — 2026-09-25. Same two rules:
   * nothing to colour leaves the live scheme alone, and the legend is the one that clears it.
   */
  setColorByGroups: (prop, groups) => {
    const next = colorByGroups(prop, groups)
    if (!next) return null
    set({ colorBy: next })
    get().applyColors()
    return next
  },

  /** `SGVue.dc.html:1340`. */
  clearColorBy: () => {
    set({ colorBy: null })
    get().applyColors()
  },

  /* ────────────────────────────── saved filter sets ────────────────────────────── */

  /**
   * `SGVue.dc.html:1663`. Nothing to save is a no-op, as the design returns early.
   *
   * `name` is the 2026-09-20 addition and is only ever passed by `manage_filters`: the card's
   * own button derives the label from the stack and passes nothing. The type guard is not
   * decoration — a bare `onClick={st.saveFilterSet}` would hand this a `MouseEvent`.
   */
  saveFilterSet: (name) => {
    const label = typeof name === 'string' ? name : undefined
    const sets = get().filterSets
    /**
     * The design's id is `Date.now()` (`:1667`) and `forgetFilterSet` filters by it — which is
     * fine for a person clicking a button and not for two saves in the same millisecond, which
     * `manage_filters` can now do. One monotonic step keeps every id distinct without changing
     * what an id is.
     */
    const now = Math.max(Date.now(), ...sets.map((f) => f.id + 1))
    const next = fstack.saveFilterSet(sets, get().stack, now, label)
    if (!next) return
    set({ filterSets: next })
    storeFilterSets(next)
  },

  /** `SGVue.dc.html:1670`. */
  applyFilterSet: (setEntry) => get().up(fstack.applyFilterSet(setEntry)),

  /** `SGVue.dc.html:2057`. */
  forgetFilterSet: (id) => {
    const next = get().filterSets.filter((f) => f.id !== id)
    set({ filterSets: next })
    storeFilterSets(next)
  },

  /* ────────────────────────────── viewpoints ────────────────────────────── */

  /**
   * `SGVue.dc.html:1723`.
   *
   * The design's id is `Date.now()`, and `renameView` / `dropView` find a viewpoint by it —
   * fine for a person clicking a button, and not for two saves in the same millisecond, which
   * `manage_views` can make (2026-10-02). One monotonic step keeps every id distinct without
   * changing what an id is; it is the rule `saveFilterSet` has had since 2026-09-20.
   */
  saveView: () => {
    if (!viewer) return
    const s = get()
    // The list is whatever `localStorage` held, so an id that is not a number counts for nothing.
    const now = Math.max(Date.now(), ...s.views.map((v) => (Number.isFinite(v.id) ? v.id + 1 : 0)))
    const views = [...s.views, viewpointOf(s, viewer.getCamera(), now)]
    set({ views })
    storeViews(viewsKey, views)
  },

  /**
   * `SGVue.dc.html:1729`, with two corrections the plan asks for:
   * · the filter `stack` and `active` are restored (plan §3.5 defect 1 — the prototype saved
   *   three keys its own state no longer had, and kept whatever filter was live);
   * · it **snapshots undo first**. Restoring a viewpoint rewrites all five `VIS_KEYS`; the
   *   design's own `activate` calls `pushUndo()` for exactly this reason (`:1051`), and
   *   without it a restore is the one visibility change ⌘Z cannot walk back.
   *
   * A viewpoint's camera is scene coordinates and the scene is the project frame, so one
   * recorded against another frame — or before the frame was recorded at all — restores
   * everything *except* the camera and frames the extents instead. Pointing the camera at
   * numbers that meant something else is worse than showing the whole model.
   *
   * 2026-10-01: a viewpoint carries both section planes; one saved before then carries the
   * design's single `section`, which `sectionsOf` maps onto the plane of its kind — and coerces,
   * because the list is whatever `localStorage` held.
   */
  restoreView: (v) => {
    if (!viewer) return
    const s = get()
    s.pushUndo()
    const sections = sectionsOf(v) ?? NO_SECTIONS
    set({
      sections,
      hidden: v.hidden ?? {},
      storeyVis: v.storeyVis ?? {},
      modelVis: v.modelVis ?? {},
      stack: v.stack ?? [],
      active: v.active ?? null,
      grids: v.grids,
      levels: v.levels,
      view: null,
      activeView: v.id
    })
    const vw = viewer
    vw.batch(() => {
      vw.setGrids(v.grids)
      vw.setLevels(v.levels)
      vw.setPickable(pickableFor(v.active))
      vw.setSections(sectionsConfigOf(sections))
      if (v.cam && viewpointFrameMatches(v, s.frame)) vw.setCamera(v.cam)
      else if (v.cam) vw.frameExtents()
      get().applyVis()
    })
  },

  /** `SGVue.dc.html:1958`. */
  dropView: (id) => {
    const views = get().views.filter((x) => x.id !== id)
    set({ views, activeView: get().activeView === id ? null : get().activeView })
    storeViews(viewsKey, views)
  },

  /**
   * 2026-09-24 (owner-requested: *"allow double click to edit saved view name."*). Written
   * where `saveView` and `dropView` write, so the name persists with the list, per building.
   */
  renameView: (id, name) => {
    const views = renameViews(get().views, id, name)
    if (views === get().views) return
    set({ views })
    storeViews(viewsKey, views)
  },

  /* ────────────────────────────── shell ────────────────────────────── */

  /** `SGVue.dc.html:1033`. */
  setTheme: (theme) => {
    set({ theme })
    if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme
    viewer?.setTheme(theme)
  },

  togglePanel: () => set({ panelOpen: !get().panelOpen }),
  setTreeMode: (treeMode) => set({ treeMode }),
  setSearch: (search) => set({ search }),
  toggleGroup: (key) => set({ expanded: { ...get().expanded, [key]: !get().expanded[key] } }),

  /* ────────────────────────────── storeys (`:1792`) ────────────────────────────── */

  toggleStorey: (name) => {
    const s = get()
    get().up({ storeyVis: { ...s.storeyVis, [name]: s.storeyVis[name] === false } })
  },
  soloStorey: (name, solo, names) => {
    if (solo) return get().up({ storeyVis: {} })
    const sv: Record<string, boolean> = {}
    for (const n of names) sv[n] = n === name
    get().up({ storeyVis: sv })
  },
  allStoreys: () => get().up({ storeyVis: {} }),

  /* ────────────────────────────── models (`:1797–1815`) ────────────────────────────── */

  toggleModel: (key) => {
    const s = get()
    get().up({ modelVis: { ...s.modelVis, [key]: s.modelVis[key] === false } })
  },

  /** `SGVue.dc.html:1202`. Picking an override implies overrides are what you want to see. */
  setModelColor: (key, c) => {
    const map = { ...get().modelColors }
    if (c) map[key] = c
    else delete map[key]
    const native = c ? false : get().nativeMats
    set({ modelColors: map, nativeMats: native, palette: null })
    viewer?.setModelColors(map, native)
  },

  togglePalette: (key) =>
    set({ palette: get().palette === key ? null : key, confirmRemove: null }),
  askRemove: (key) =>
    set({ confirmRemove: get().confirmRemove === key ? null : key, palette: null }),
  cancelRemove: () => set({ confirmRemove: null }),

  /** `SGVue.dc.html:1209`. */
  toggleNative: () => {
    const native = !get().nativeMats
    set({ nativeMats: native })
    viewer?.setModelColors(get().modelColors, native)
  },

  toggleAdd: () => set({ addOpen: !get().addOpen }),

  /** `SGVue.dc.html:1049`. One model owns the lists and the picker; the rest stay inert. */
  activate: (key) => {
    const s = get()
    const active = s.active === key ? null : key
    s.pushUndo()
    set({ active, ctx: null, palette: null })
    viewer?.setPickable(pickableFor(active))
    if (active) {
      const keep = s.selIds.filter((id) => s.byId.get(id)?.model === active)
      if (keep.length !== s.selIds.length) get().select(keep)
    }
  },

  /* ────────────────────────────── tools and display ────────────────────────────── */

  /** `SGVue.dc.html:1034`. */
  setTool: (tool) => {
    set({ tool, ctx: null })
    viewer?.setTool(tool)
  },
  /** `SGVue.dc.html:1094`. */
  toggleSnap: () => {
    const snap = !get().snap
    set({ snap })
    viewer?.setSnap(snap)
  },
  /** `SGVue.dc.html:1736`. */
  toggleGrids: () => {
    const grids = !get().grids
    set({ grids })
    viewer?.setGrids(grids)
  },
  /** `SGVue.dc.html:1737`. */
  toggleLevels: () => {
    const levels = !get().levels
    set({ levels })
    viewer?.setLevels(levels)
  },
  /** `SGVue.dc.html:1093`. */
  setShadows: (b) => {
    set({ shadows: b })
    viewer?.setShadows(b)
  },
  setGroundGrid: (b) => {
    set({ groundGrid: b })
    viewer?.setGroundGrid(b)
  },
  /** `SGVue.dc.html:1079` (`view(name)`). */
  setView: (name) => {
    set({ view: name })
    viewer?.setView(name)
  },
  /** `SGVue.dc.html:1962`. The viewer answers with `on.projection`, which sets `proj`. */
  toggleProj: () => viewer?.setProjection(get().proj === 'persp' ? 'ortho' : 'persp'),

  /**
   * 2026-10-02 — frame without turning. `extents` is the viewer's own answer to a double-click
   * on empty space (`zoomExtents`); `selection` is F and the context menu's Zoom to (`zoomTo`),
   * for everything selected. The named view the toolbar lights stays lit: the camera has not
   * turned, which is exactly what those two gestures leave.
   */
  fitView: (what, zoom) => {
    if (!viewer) return
    if (what === 'selection') viewer.zoomTo([...get().selIds], zoom)
    else viewer.zoomExtents(zoom)
  },

  /**
   * 2026-10-02 — turn the camera to any direction, about what it is looking at and at its
   * present distance. The view cube offers 26 directions and a drag every one; this is the same
   * reach, said as two angles (`shared/view-angles.ts`). An angle left out keeps the camera's
   * own. Like a click on the cube (`clearView`), no named view is current afterwards.
   */
  aimCamera: (azimuthDeg, elevationDeg) => {
    if (!viewer) return
    const cam = viewer.getCamera()
    const to = sphericalOf(azimuthDeg ?? 0, elevationDeg ?? 0)
    viewer.lookAlong(
      azimuthDeg === undefined ? cam.theta : to.theta,
      elevationDeg === undefined ? cam.phi : to.phi
    )
    set({ view: null })
  },

  openCard: (name) => set({ card: get().card === name ? null : name }),
  closeCard: () => set({ card: null }),

  /* ────────────────────────────── annotation (`:1035–1039`, `:2059–2071`) ────────────────────────────── */

  /**
   * `SGVue.dc.html:1035`, per plane. Millimetres in the card; the viewer is handed metres, and
   * both planes in one call — the one that did not change arrives as it was, so it neither
   * moves nor re-aims the camera (`viewer/section.ts`).
   */
  setSec: (kind, patch, open) => {
    const cur = get().sections
    const sections = { ...cur, [kind]: { ...cur[kind], ...patch } }
    set({ sections, ...(open ? { card: 'section' as CardName } : {}) })
    viewer?.setSections(sectionsConfigOf(sections))
  },

  /** `Clear all`: each plane as its own `Clear` leaves it. */
  clearSections: () => {
    set({ sections: NO_SECTIONS })
    viewer?.setSections(sectionsConfigOf(NO_SECTIONS))
  },

  /**
   * `SGVue.dc.html:895`, on the gridline plane only. Clicking the bubble of the grid already
   * sectioned clears it; any other bubble sections that grid **previewed** (`cut: false`) and
   * opens the card. `offset` is reset; `flip` and `cut` are the design's own patch, which
   * leaves `flip` where it was. A level cut, if there is one, stays exactly as it is.
   */
  gridClick: (name) => {
    get().setSec(
      'grid',
      get().sections.grid.name === name ? { name: '' } : { name, offset: 0, cut: false },
      true
    )
  },

  // 2026-10-09: the 3D labels follow the unit too, so the viewer is told — the design's toggle
  // changed the Markups card's list alone.
  setUnits: (units) => {
    set({ units })
    viewer?.setUnits(units)
  },

  setMeasures: (list) => set({ measures: list, measureCount: list.length }),
  setSpots: (list) => set({ spots: list, spotCount: list.length }),

  clearMeasures: () => viewer?.clearMeasures(),
  clearSpots: () => viewer?.clearSpots(),
  dropMeasure: (id) => viewer?.dropMeasure(id),
  dropSpot: (id) => viewer?.dropSpot(id),
  focusPoint: (p) => viewer?.focusPoint([...p]),

  // The scene stands whole metres off the project frame (`offset`): scene = project − offset.
  placeSpot: (p) => {
    if (!viewer) return false
    const o = get().offset
    viewer.placeSpot([p[0] - o[0], p[1] - o[1], p[2] - o[2]])
    return true
  },
  placeMeasure: (p, normal, selfId) => {
    if (!viewer) return false
    const o = get().offset
    return viewer.placeMeasure([p[0] - o[0], p[1] - o[1], p[2] - o[2]], normal, selfId)
  },
  showSpot: (id, full) => viewer?.showSpot(id, full) ?? 'missing',

  /* ────────────────────────────── selection (`:1041`) ────────────────────────────── */

  select: (id, zoom, mode = 'replace') => {
    const s = get()
    let ids = id == null ? [] : Array.isArray(id) ? id : [id]
    if (mode === 'toggle' && ids.length === 1) {
      const cur = s.selIds
      ids = cur.includes(ids[0]) ? cur.filter((x) => x !== ids[0]) : [...cur, ids[0]]
    }
    const sel = ids.length ? ids[ids.length - 1] : null
    set({ sel, selIds: ids, ctx: null, copied: false })
    if (viewer) {
      viewer.setSelected(ids)
      pushDims(ids, s.dims)
      if (zoom && ids.length) viewer.zoomTo(ids)
    }
  },

  setCtx: (ctx) => set({ ctx }),

  /** `SGVue.dc.html:1981`. */
  toggleProp: (key) => set({ propOpen: { ...get().propOpen, [key]: !get().propOpen[key] } }),

  /**
   * `SGVue.dc.html:1991–1993`, including the `execCommand` fallback the design keeps — which is
   * `copyText` now, shared with the Schedules window (`../clipboard.ts`).
   *
   * 2026-10-02 — **the flash is truthful.** The design flashes `Copied` whether or not the write
   * went through, and here it never did: the async API is refused in this app, and the fallback
   * was only reached where that API does not exist. It flashes now only when the text is on the
   * clipboard, and resolves to the same answer.
   */
  copyGuid: async (guid) => {
    const ok = await copyText(guid)
    if (!ok) return false
    clearTimeout(copyTimer)
    set({ copied: true })
    copyTimer = setTimeout(() => set({ copied: false }), COPIED_MS)
    return true
  },

  /**
   * `SGVue.dc.html:2029` — `copy csv` under a reply's table. The design's line is
   * `if (navigator.clipboard) navigator.clipboard.writeText(csv)`, and in this app that API is
   * always refused (`../clipboard.ts`), so the button copied nothing and said nothing. It goes
   * through `copyText` now, which copies from the user's own click. The design gives the button
   * no flash and it still has none; a copy that did not reach the clipboard is said in the
   * panel's status line — the one a refused copy from Apply uses — and one that did takes that
   * sentence away again, and leaves any other.
   */
  copyTable: async (table) => {
    const ok = await copyText(tableCsv(table, get().units))
    if (!ok) set({ chatErr: CLIPBOARD_REFUSED })
    else if (get().chatErr === CLIPBOARD_REFUSED) set({ chatErr: '' })
    return ok
  },

  /**
   * `SGVue.dc.html:1650–1656`. The menu item opens the panel with the composer pre-filled, and
   * 60 ms later — after the panel has mounted — focuses it with the caret at the end, so the
   * question can be finished by typing. The element is found by the `data-role` the port keeps
   * verbatim, which is the design's own `el('chatinput')` (`:855`).
   */
  askAbout: (ids) => {
    const s = get()
    const els = ids.map((i) => s.byId.get(i)).filter(Boolean) as FederatedElement[]
    if (!els.length) return
    set({ chatOpen: true, ctx: null, chatInput: askAboutText(els) })
    setTimeout(() => {
      const input = el('chatinput')
      if (input instanceof HTMLInputElement) {
        input.focus()
        input.setSelectionRange(input.value.length, input.value.length)
      }
    }, 60)
  },

  /* ────────────────────────────── the assistant (`:1591–1649`) ────────────────────────────── */

  setChatOpen: (chatOpen) => set({ chatOpen }),
  setChatInput: (chatInput) => set({ chatInput }),
  setChatReplyTo: (chatReplyTo) => set({ chatReplyTo }),
  setChatSize: (chatW, chatH) => set({ chatW, chatH }),
  setChatSuggestOpen: (chatSuggestOpen) => set({ chatSuggestOpen }),
  setSideSize: (which, size) => set(which === 'models' ? { sideModels: size } : { sideStoreys: size }),

  /**
   * `SGVue.dc.html:1599`. The accumulators are reset by the caller (`ai/bridge.ts` holds them);
   * what the store does here is push the user turn and hand back the view as it stood before
   * it, so a turn that changes something can be reverted on its own.
   *
   * The design also set a `chatStage` here — the busy row's line (`:1336`, `:1602`). Since
   * 2026-10-01 a running turn is shown by the assistant's live reply and its thinking trace
   * (`ai/trace-store.ts`, fed by `ai/bridge.ts`), so the store keeps no stage.
   */
  chatBegin: (text, quote) => {
    const before = snapshot(get())
    set((st) => ({
      chatMsgs: [...st.chatMsgs, { role: 'user' as const, text, quote: quote ?? null }],
      chatInput: '',
      chatBusy: true,
      chatErr: '',
      chatReplyTo: null,
      chatSuggestOpen: false
    }))
    return before
  },

  /**
   * `SGVue.dc.html:1609`. Chips are capped at six, exactly as the design caps them.
   *
   * 2026-10-02: the reply gets a `revert` exactly when it changed something a revert can put
   * back. A tool says that it changed something (`acted`); what the reply as a whole changed is
   * then read off the state itself — the snapshot from before the turn against the state now,
   * over the parts its own tool calls changed (`result.parts`) — so a reply that hid something
   * and showed it again offers nothing, one that only opened the Schedules window, which no
   * revert closes, offers nothing either, and what the user did by hand meanwhile is left out.
   *
   * The same day, after phase 4: a markup the reply placed is something a revert can put back —
   * by taking it away — so the reply keeps the ids of the ones its calls placed (`placed`), and
   * is offered `revert` for them even when it changed nothing else (`selectors/chat.ts`).
   */
  chatFinish: (reply, result, before) => {
    const undoSnap = result.acted ? turnUndo(before, snapshot(get()), result.parts) : null
    set((st) => ({
      chatBusy: false,
      chatMsgs: [
        ...st.chatMsgs,
        {
          role: 'assistant' as const,
          text: reply,
          chips: (result.chips ?? []).slice(0, 6),
          table: result.table ?? null,
          pending: result.pending ?? null,
          undoSnap,
          ...(result.placed?.length ? { placed: [...result.placed] } : {}),
          // Only a turn that had a trace carries one; a message without is drawn as it always was.
          ...(result.trace ? { trace: result.trace } : {})
        }
      ]
    }))
  },

  /** `SGVue.dc.html:1617`. A failed turn leaves the transcript alone and says why. */
  chatFail: (message) =>
    set({ chatBusy: false, chatErr: message || 'The assistant is unavailable.' }),

  /**
   * `SGVue.dc.html:1632`. The pending entry carries the **patch**, which goes straight to
   * `up()` — not a label and a patch that can drift apart (`BUILD_PLAN.md` §6 pitfall 21).
   *
   * 2026-10-02: what the patch changed **joins** what the reply had already changed
   * (`mergeUndo`), so one revert puts back both. The design replaced the reply's snapshot with
   * one taken here, which left whatever else the reply had done beyond its own revert.
   *
   * Phase 3, the same day — **or it carries an action** (`PendingAction`): something that
   * reaches outside the view or cannot be undone, which the assistant could only ask for. This
   * is the user's click, and the one place such an action is performed (`performGated`).
   * **The row is taken before anything runs**, so a request is applied once — a second click,
   * or anything the action sets off, finds nothing waiting on that reply. What the action
   * changed that a revert can put back (an undo, a viewpoint, the base point) joins the reply's
   * undo exactly as a patch does; a deletion joins nothing, which is why it was asked for. What
   * could not be done — the thing has gone, the history has moved on — is said in the panel's
   * own status line, the one a failed turn uses.
   *
   * After review: **a patch is visibility and nothing else.** It reaches `up()` cut down to
   * `PENDING_PATCH_KEYS` (`shared/undo.ts`), so whatever object a pending entry carries, Apply
   * cannot set the viewpoints, the saved filter sets, the base point or any other key of the
   * store through it. Those have actions, and an action says what it is.
   */
  applyPending: (index) => {
    const msg = get().chatMsgs[index]
    const pending = msg?.pending
    if (!pending) return
    const before = snapshot(get())
    set((st) => ({
      chatMsgs: st.chatMsgs.map((m, j) => (j === index ? { ...m, pending: null } : m))
    }))
    let note = ''
    if (pending.action) note = performGated(pending.action, get, (said) => set({ chatErr: said }))
    else if (pending.patch) get().up(pendingPatch(pending.patch))
    // A reply already reverted is never offered `revert` again (the design's rule: it stays
    // dimmed), so it is given no snapshot to hold. Since the gate's review `revertTurn` drops a
    // reverted reply's request with it, so no row is left on one to click: this is the guard
    // for an entry that reached the transcript some other way.
    const undoSnap = msg.reverted ? null : mergeUndo(msg.undoSnap, before, snapshot(get()))
    set((st) => ({
      chatMsgs: st.chatMsgs.map((m, j) => (j === index ? { ...m, undoSnap } : m)),
      ...(note ? { chatErr: note } : {})
    }))
  },

  /** `SGVue.dc.html:1637`. */
  dismissPending: (index) =>
    set((st) => ({
      chatMsgs: st.chatMsgs.map((m, j) => (j === index ? { ...m, pending: null } : m))
    })),

  /**
   * `SGVue.dc.html:1622`. Per-turn revert: what that reply changed, put back as it was before
   * it, without unwinding anything done afterwards through the normal undo stack.
   *
   * 2026-10-02 (the owner: *"correct."*): everything the reply changed, where the design put
   * back the five visibility keys only — and only what it changed, so a part the reply left
   * alone is not moved (`selectors/snapshot.ts` has the parts and the rules). The session's
   * part of it goes through `applySession`, the path a share link restores through; what a
   * session does not carry goes through the action its own control calls, compared first.
   * Visibility still goes on the undo stack, as it always did — and nothing else does, because
   * nothing else is on that stack. What could not be put back — a model unloaded since, a
   * camera recorded in another scene — is said in the panel's own status line.
   *
   * A request the reply left waiting behind Apply is dropped with it (the consent gate's
   * review): the reply has been taken back, and so has what it asked for.
   *
   * After phase 4 — **and the markups it placed are taken away** (`ChatMessage.placed`). A spot
   * or a measurement drawn in the 3D view is session view state, the most visible thing a reply
   * can add, so it goes with the reply: exactly the ones that reply's calls placed, by their own
   * ids, through `dropMeasure` / `dropSpot` — what the Markups card's × runs. A markup the user
   * placed, or another reply did, stays; one the user has already removed is nothing to do, and
   * nothing is said. A reply that only placed a markup has no `undoSnap`, and reverts all the
   * same. (What is *saved* is not session state and is never taken back: a viewpoint, a filter
   * set, a schedule setup. Nor is a spot tag's state put back.)
   */
  revertTurn: (index) => {
    const s = get()
    const msg = s.chatMsgs[index]
    const undo = msg?.undoSnap
    const placed = msg?.placed ?? []
    if (!undo && !placed.length) return
    let note = ''
    if (undo) {
      const plan = revertPlan(undo, snapshot(s))
      if (undo.changed.includes('vis')) s.pushUndo()
      get().applySession(plan.payload)
      // A section that starts cutting again unlights the toolbar's view button on its way
      // (`on.cubeView`, as its re-aim is a cube move). Which button is lit is the plan's to say.
      if (plan.payload.view !== undefined && get().view !== plan.payload.view) {
        set({ view: plan.payload.view })
      }

      const x = plan.extra
      if (x.groundGrid !== undefined && x.groundGrid !== get().groundGrid) get().setGroundGrid(x.groundGrid)
      if (x.panelOpen !== undefined && x.panelOpen !== get().panelOpen) get().togglePanel()
      if ('card' in x && x.card !== get().card) {
        // `openCard` on a card that is not up opens it; nothing here is asked to toggle one shut.
        if (x.card) get().openCard(x.card)
        else get().closeCard()
      }
      if (x.tool !== undefined && x.tool !== get().tool) get().setTool(x.tool)
      if (x.search !== undefined && x.search !== get().search) get().setSearch(x.search)
      if ('activeView' in x && x.activeView !== get().activeView) set({ activeView: x.activeView })
      if ('colorBy' in x) {
        // The legend's own two paths: the scheme's groups as they were, or its ×.
        if (x.colorBy) {
          get().setColorByGroups(
            x.colorBy.prop,
            x.colorBy.groups.map((g) => ({ value: g.v, ids: g.ids }))
          )
        } else get().clearColorBy()
      }
      // Last: `select` also re-places the dimension labels, which follow `dims` and the
      // selection.
      if (x.selIds) get().select([...x.selIds])
      else if (undo.changed.includes('dims')) pushDims(get().selIds, get().dims)

      note = revertNote(plan.lost)
    }

    // The markups that reply placed and that are still there — the Markups card's own ×, by
    // the record's id. One the user removed since is skipped in silence.
    for (const mark of placed) {
      if (mark.kind === 'measure') {
        if (get().measures.some((m) => m.id === mark.id)) get().dropMeasure(mark.id)
      } else if (get().spots.some((p) => p.id === mark.id)) get().dropSpot(mark.id)
    }

    set((st) => ({
      // The snapshot goes with the control: a reverted reply is never offered `revert` again
      // (`chatRow`), so it does not go on holding the old `hidden`, `stack` and colour scheme —
      // nor the ids of the markups it placed, which a second press must not look for again.
      // So does a request the reply left waiting (after the gate's review): it was part of the
      // reply that has just been taken back, and applied afterwards it would have been on no
      // stack — a reverted reply is given no snapshot, so a base point set from it could never
      // have been reverted.
      chatMsgs: st.chatMsgs.map((m, j) =>
        j === index ? { ...m, reverted: true, undoSnap: null, placed: null, pending: null } : m
      ),
      ...(note ? { chatErr: note } : {})
    }))
  },

  /**
   * `SGVue.dc.html:1690`. The state patch first, then the renderer calls in `RESTORE_ORDER`.
   * `theme` is the port's one addition and is plan §3.5 item 2.
   *
   * Moved here from `model/session.ts` on 2026-10-02, unchanged, so that a session, a share link
   * and the chat's per-turn revert are one restore path. Without a viewer the state is still
   * put back and the renderer calls are simply not made.
   */
  applySession: (p) => {
    const s = get()
    const n = sessionPatch(p, s)
    // `setTheme` writes `document.documentElement.dataset.theme` and tells the viewer, which is
    // what the prototype's own `:1033` does — restoring the key alone would change nothing.
    if (n.theme !== s.theme) s.setTheme(n.theme)
    // 2026-10-09: the display unit, the same way — the viewer's labels print in it.
    if (n.units !== s.units) s.setUnits(n.units)
    set({
      hidden: n.hidden,
      storeyVis: n.storeyVis,
      modelVis: n.modelVis,
      active: n.active,
      modelColors: n.modelColors,
      nativeMats: n.nativeMats,
      treeMode: n.treeMode,
      grids: n.grids,
      levels: n.levels,
      snap: n.snap,
      dims: n.dims,
      sections: n.sections,
      stack: n.stack,
      hlColor: n.hlColor,
      view: n.view,
      // No `coords` (2026-10-08): the base point is the boot file's, read-only, and a payload's
      // own is not read back (`shared/session-codec.ts`, `sessionPatch`).
      uploadNames: n.uploadNames
    })
    const v = viewer
    // One repaint for the whole restore, not one per step (`viewer.batch`, refactor pass 2).
    batched(() =>
      applyRestore(
        n,
        p,
        {
          grids: (on) => v?.setGrids(on),
          levels: (on) => v?.setLevels(on),
          snap: (on) => v?.setSnap(on),
          modelColors: (map, native) => v?.setModelColors(map, native),
          highlightColor: (c) => v?.setHighlightColor(c),
          pickable: (active) => v?.setPickable(pickableFor(active)),
          // An empty patch merges nothing and re-pushes **both** planes: the millimetre → metre
          // conversion the design does inline at `:1703` lives in one place in the port
          // (`sectionConfigOf`, above).
          section: () => get().setSec('grid', {}),
          shadows: (on) => get().setShadows(on),
          camera: (cam) => v?.setCamera(cam),
          frameExtents: () => v?.frameExtents(),
          visibility: () => get().applyVis()
        },
        // The frame the live federation is in, which `commitModels` has already recorded: the
        // models are loaded before a payload is applied.
        frameKey(get().frame)
      )
    )
  },

  /** `SGVue.dc.html:1642`. Local arithmetic, seeded as the first turn — never a model call. */
  seedChat: () => {
    const s = get()
    if (!s.federation.elements.length) return
    const seed = seedAudit(s.federation.elements, s.federation.storeys, s.loaded)
    set({
      chatMsgs: [{ role: 'assistant', text: seed.text, chips: seed.chips }],
      chatErr: '',
      chatBusy: false
    })
  },

  /* ────────────────────────────── hide / show (`:1075–1078`) ────────────────────────────── */

  hide: (ids) => {
    const hidden = { ...get().hidden }
    ids.forEach((i) => (hidden[i] = true))
    get().up({ hidden, ctx: null })
  },
  show: (ids) => {
    const hidden = { ...get().hidden }
    ids.forEach((i) => delete hidden[i])
    get().up({ hidden, ctx: null })
  },
  isolate: (ids) => {
    const keep = new Set(ids)
    const hidden: Record<number, boolean> = {}
    get().federation.elements.forEach((e) => {
      if (!keep.has(e.id)) hidden[e.id] = true
    })
    get().up({ hidden, storeyVis: {}, ctx: null })
  },
  showAll: () =>
    get().up({
      hidden: {},
      storeyVis: {},
      modelVis: {},
      stack: get().stack.map((x) => ({ ...x, on: false })),
      ctx: null
    }),

  /** `SGVue.dc.html:1057`. */
  toggleDims: () => {
    const dims = !get().dims
    set({ dims })
    pushDims(get().selIds, dims)
  },

  /* ────────────────── the landing page and the upload rows (`:1143–1200`) ────────────────── */

  setDragging: (dragging) => {
    if (get().dragging !== dragging) set({ dragging })
  },

  setInitErr: (initErr) => set({ initErr }),

  /** `SGVue.dc.html:1167`, `:1179`. */
  addUpload: (row) => set({ uploads: [...get().uploads, row] }),

  /** `SGVue.dc.html:1174`. */
  patchUpload: (id, patch) =>
    set({ uploads: get().uploads.map((u) => (u.id === id ? { ...u, ...patch } : u)) }),

  /** `SGVue.dc.html:1169`. */
  dropUpload: (id) => set({ uploads: get().uploads.filter((u) => u.id !== id) }),

  setLinkCopied: (linkCopied) => set({ linkCopied }),

  /* ────────────────────────────── federation ────────────────────────────── */

  setLibrary: (library) => set({ library }),

  setOffset: (offset, frame, bootGeoref) => {
    const coords = coordsFromGeoref(bootGeoref) ?? NO_COORDS
    set({ offset, frame, bootGeoref, coords })
    viewer?.setCoords(coords)
  },

  beginModels: (loadMsg) => set({ ready: false, loadMsg }),

  /**
   * `SGVue.dc.html:917`'s `setModels` and `:1096`'s `boot`, reduced to the part that is the
   * store's: the design rebuilds the whole viewer here because its renderer is handed a
   * finished federation at construction. Ours is streamed, so `federation-store.ts` adds and
   * removes models on the live viewer and the camera is never disturbed.
   *
   * The pruning rules are the design's, verbatim: `hidden` keeps only ids that still exist,
   * `modelColors` only keys that are still loaded, `active` is dropped when its model went,
   * the **colour-by scheme is cleared** (`:923` — its groups hold ids from the federation that
   * has just been replaced), and the selection, the context menu, the palette and the remove
   * confirmation all close.
   */
  commitModels: (federation) => {
    const s = get()
    const keys = federation.models.map((m) => m.meta.modelKey)
    const hidden: Record<number | string, boolean> = {}
    Object.keys(s.hidden).forEach((id) => {
      if (federation.byId.has(+id)) hidden[id] = true
    })
    const modelColors: Record<string, string> = {}
    Object.keys(s.modelColors).forEach((k) => {
      if (keys.includes(k)) modelColors[k] = s.modelColors[k]
    })
    // `boot` (`SGVue.dc.html:1102`): viewpoints are stored per building, so the list follows
    // the federation. Re-read only when the key actually changes — an add or a removal inside
    // the same building must not disturb what is on screen.
    const nextViewsKey = viewsKeyFor(federation.project.building)
    const viewsChanged = nextViewsKey !== viewsKey
    if (viewsChanged) viewsKey = nextViewsKey
    set({
      federation,
      byId: federation.byId,
      propKeys: federation.propKeys,
      loaded: keys,
      hidden,
      modelColors,
      colorBy: null,
      sel: null,
      selIds: [],
      ctx: null,
      palette: null,
      confirmRemove: null,
      active: s.active && keys.includes(s.active) ? s.active : null,
      booted: keys.length > 0,
      ready: keys.length > 0,
      visibleCount: federation.elements.length,
      ...(viewsChanged ? { views: loadViews(nextViewsKey), activeView: null } : {})
    })
    batched(() => {
      if (viewer) {
        viewer.setSelected([])
        // 2026-09-24: what "Original materials" off shows — one colour per IFC class, the same
        // assignment colour-by-entity makes, so the toggle and the assistant's tool agree.
        viewer.setClassColors(classColors(federation.elements))
        viewer.setModelColors(modelColors, get().nativeMats)
        const active = get().active
        viewer.setPickable(pickableFor(active))
      }
      get().applyVis()
    })
    // `SGVue.dc.html:1096` seeds the audit once, when `boot()` finishes. The equivalent
    // moment here is the batch that takes the federation from empty to loaded — a later
    // add or removal must not wipe the conversation that is already on screen.
    if (keys.length && !s.loaded.length) get().seedChat()
  },

  /* ────────────────────────────── viewer callbacks ────────────────────────────── */

  /**
   * Once a second from the frame loop. The status bar shows the frame rate and the backend, so
   * only a change in either is state; the draw count is shown nowhere (the dev `stats()` hook
   * reads it from `lastDrawCalls`), and setting it alone re-rendered every subscriber.
   */
  setStats: (stats) => {
    drawCalls = stats.calls
    const cur = get().stats
    if (cur.fps === stats.fps && cur.backend === stats.backend) return
    set({ stats })
  },
  setHint: (hint) => set({ hint }),
  setProjection: (proj) => set({ proj }),
  /** `on.cubeView` (`:895`): the cube moved the camera, so no named view is current. */
  clearView: () => set({ view: null }),
  setCardTop: (cardTop) => set({ cardTop }),
  setVpW: (vpW) => set({ vpW }),
  /** Written only when it changes: the row measures itself after every render of its own. */
  setBrow: (brow) => {
    if (brow !== get().brow) set({ brow })
  }
}))
