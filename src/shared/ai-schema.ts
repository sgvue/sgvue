/**
 * What the assistant is told about the model and about the view —
 * `SGVue.dc.html:1216–1229` (`chatSchema`) and `:1232–1244` (`chatViewState`), as pure
 * functions so the prompt can be tested without a store.
 *
 * The two are cached very differently and that is the whole reason they are separate:
 *
 *   · **The schema is a cache breakpoint.** It changes only when the federation changes, so
 *     it sits in `system[1]` behind `cache_control` and is re-sent byte for byte on every
 *     turn of a conversation. That is what makes `cache_read_input_tokens` non-zero.
 *   · **The view state changes every turn.** It travels as a `role:'system'` message appended
 *     after the user turn, which is the supported way to add an operator instruction
 *     mid-conversation without invalidating the cached prefix in front of it.
 *
 * The design's own comment on `chatViewState` says why it exists at all: the assistant is
 * blind across turns unless it is told what is currently applied, and without it "add X also"
 * reads as a brand-new request and silently replaces the previous filter.
 *
 * 2026-10-01: the view state's `section` names every cut that is on — `grid C`, `level L2`,
 * `grid C + level L2` — or is `null`; the gridline cut and the level cut are two planes now
 * (`sectionsLabel`, `shared/sections.ts`).
 *
 * 2026-10-02 — **reading back what the assistant can set** (the owner: *"assistant should possess
 * everything user can do on the app"*). The assistant could turn shadows off, preview a plane or
 * have a model hidden and then not see that it had. The rule is **sparse per turn, full on
 * demand**: the per-turn view state gains a field only while something is *not at its default* —
 * a display switch, the armed tool, a hidden model, a section's offset, side or preview
 * (`sparseViewState`) — so a view at its defaults costs the bytes it always did, and
 * `get_view_state` reports every one of them in full (`displayState`, `sectionPlanes`).
 *
 * 2026-10-02, phase 2 — **the camera.** The assistant can now turn it to any direction, so it
 * has to be able to read one back: `cameraBrief` says where the camera stands as `set_view`
 * takes it — the named view it is on, if any, and its azimuth and elevation
 * (`shared/view-angles.ts`). Per turn it is listed only while the camera is **not** standing on
 * the view that `view` names, which is where a click on a view button leaves it; the camera
 * itself is the viewer's, so the caller hands it in, as it hands in the open schedule. And the
 * per-turn list of hidden models is capped (`MODELS_HIDDEN_CAP`), with a count of the rest.
 */
import type { Federation } from './federate'
import {
  ABSENT_LABEL,
  ABSENT_OP,
  isLiveRule,
  type FilterStep,
  type Rule,
  type VisElement,
  type VisState
} from './rules'
import {
  LEVEL_DEFAULT_OFFSET_MM,
  sectionsLabel,
  type SecKind,
  type SecPlane,
  type Sections
} from './sections'
import { DEFAULT_DISPLAY_UNIT } from './units'
import { roundedAngles, viewOn } from './view-angles'

/** Values per category before the schema truncates. Plan §4 Phase 9. */
export const SCHEMA_VALUE_CAP = 150

/**
 * Property names before the schema truncates — 2026-09-28, its own cap.
 *
 * At 150 a real Revit export lost its tail: names are listed in the order the file first uses
 * them, the reference model has 197, and the shared parameters a user adds tend to come last —
 * so `Includes As GFA` was one of the "… N more" and the assistant guessed `includesGFA`
 * instead. A thousand lists every name of any export we have seen. The block is the cached
 * `system[1]`, and an entry is `"Name (count)",` — measured at about 22 bytes, ~5–6 tokens —
 * so a thousand names made the whole schema block 22 653 B (~5 700 tokens), written once per
 * federation and read at the cache price on every turn after. `docs/DECISIONS.md` has the
 * measurement.
 */
export const SCHEMA_KEY_CAP = 1000

export interface ChatSchema {
  models: { key: string; name: string }[]
  storeys: string[]
  grids: string[]
  entities: string[]
  predefinedTypes: string[]
  objectTypes: string[]
  psetKeys: string[]
  elementCount: number
}

/** The sentence a truncated category ends with, so the model knows where the rest is. */
const moreLine = (n: number): string => `… ${n} more — use list_values`

/** The same for property names, which `list_values` does not list and `find_properties` does. */
const moreKeysLine = (n: number): string => `… ${n} more — use find_properties`

/**
 * Distinct values of one element field, sorted the design's way (`[...new Set(...)].sort()`)
 * and rendered `value (count)` so a count is never something the model has to guess.
 */
function category(
  elements: readonly VisElement[],
  of: (e: VisElement) => string | undefined
): string[] {
  const counts = new Map<string, number>()
  for (const e of elements) {
    const v = of(e)
    if (!v) continue
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  const keys = [...counts.keys()].sort()
  const head = keys.slice(0, SCHEMA_VALUE_CAP).map((k) => `${k} (${counts.get(k)})`)
  if (keys.length > SCHEMA_VALUE_CAP) head.push(moreLine(keys.length - SCHEMA_VALUE_CAP))
  return head
}

/** Property-set keys, counted by how many elements carry the key at all. */
function psetKeyCategory(
  elements: readonly VisElement[],
  propKeys: readonly string[]
): string[] {
  const counts = new Map<string, number>()
  for (const e of elements) {
    for (const ps of [e.psets, e.qto]) {
      for (const p of Object.values(ps)) {
        for (const k of Object.keys(p)) counts.set(k, (counts.get(k) ?? 0) + 1)
      }
    }
  }
  // `propKeys` is the federation's own list and leads with the seven attributes, which are
  // not pset keys and carry no count of their own — they are named in the instructions.
  const keys = propKeys.filter((k) => counts.has(k))
  const head = keys.slice(0, SCHEMA_KEY_CAP).map((k) => `${k} (${counts.get(k)})`)
  if (keys.length > SCHEMA_KEY_CAP) head.push(moreKeysLine(keys.length - SCHEMA_KEY_CAP))
  return head
}

/**
 * `SGVue.dc.html:1216`. The design reads its model list from `SAMPLE_FILES`; the desktop
 * reads it from the federation, which is the same list for the mock and a real one otherwise.
 */
export function chatSchema(federation: Federation): ChatSchema {
  const els = federation.elements as readonly VisElement[]
  return {
    models: federation.files.map((f) => ({ key: f.key, name: f.name || f.file })),
    storeys: federation.storeys.map((s) => s.name),
    grids: federation.grids.map((g) => g.name),
    entities: category(els, (e) => e.type),
    predefinedTypes: category(els, (e) => e.predefinedType),
    objectTypes: category(els, (e) => e.objectType),
    psetKeys: psetKeyCategory(els, federation.propKeys),
    elementCount: federation.elements.length
  }
}

/* ────────────────────────────── the live view ────────────────────────────── */

/**
 * The schedule open in the Schedules window, as the view state names it — 2026-09-28. Small on
 * purpose: it rides on every turn, outside the cached prefix. `get_schedule` has the rest.
 */
export interface ScheduleBrief {
  title: string
  /** The IFC classes it lists. */
  category: string[]
  /** Its visible column headings, as the table shows them. */
  columns: string[]
  /** Its filter rules as the Filter tab words them, or "". */
  filters: string
  /** Rows the table shows. */
  rowCount: number
}

export interface ChatViewState {
  filterStack: { step: number; enabled: boolean; action: string; rules: readonly Rule[] }[]
  visibleElements: number
  totalElements: number
  hiddenManually: number
  storeysShown: string[]
  activeModel: string | null
  view: string | null
  projection: string
  /**
   * One string for both planes (2026-10-01): `grid C`, `level L2`, `grid C + level L2`, or
   * `null` — `shared/sections.ts`. With one plane it is the design's own `${kind} ${name}`.
   */
  section: string | null
  selectedCount: number
  /** 2026-09-28 — "this schedule": the Schedules window's open schedule, or null. */
  schedule: ScheduleBrief | null
  /** 2026-10-02 — only the switches that are **not** at their default; absent when all are. */
  display?: Partial<DisplayState>
  /** 2026-10-02 — the armed tool, only while it is not `select`. */
  tool?: string
  /**
   * 2026-10-02 — the keys of loaded models whose eye is off; absent when every model shows.
   * At most `MODELS_HIDDEN_CAP` of them, in the federation's order.
   */
  modelsHidden?: string[]
  /** …and how many more are hidden than `modelsHidden` lists; absent when it lists them all. */
  modelsHiddenMore?: number
  /**
   * 2026-10-02 — what `section` cannot say: a set plane's offset, side or preview, each only
   * when it is not the Section card's default for that plane. Absent when both planes are.
   */
  sectionPlanes?: SparsePlanes
  /**
   * 2026-10-02 — where the camera stands, only while that is **not** the view `view` names: the
   * named view it is on (or `null`) and its direction. Absent while it stands on `view`.
   */
  camera?: Omit<CameraBrief, 'projection'>
  /**
   * 2026-10-09 — the display unit, only while it is not the design's `mm`: `m`, or `ft` — what a
   * length, an elevation or a coordinate stated to the user is written in. A model in feet
   * starts in `ft`, so its every turn says so.
   */
  units?: string
}

/* ────────────────────────────── display and section read-back ────────────────────────────── */

/**
 * The seven display switches, named as `toggle_display` names its inputs and in its order — so
 * what the assistant sets and what it reads back are the same words.
 */
export interface DisplayState {
  grids: boolean
  levels: boolean
  shadows: boolean
  dims: boolean
  groundGrid: boolean
  snap: boolean
  /** The store's `nativeMats`: the files' own surface materials. */
  originalMaterials: boolean
}

/**
 * What each switch is when the app starts — the store's own first values
 * (`renderer/state/shell.ts`; `tests/unit/ai-readback.test.ts` holds the two together). The
 * per-turn view state names a switch only while it differs from this.
 */
export const DISPLAY_DEFAULTS: Readonly<DisplayState> = Object.freeze({
  grids: true,
  levels: false,
  shadows: true,
  dims: false,
  groundGrid: true,
  snap: true,
  originalMaterials: true
})

/** The tool a click on the model uses when nothing else is armed. */
export const DEFAULT_TOOL = 'select'

/** The store fields the switches are read from. */
export interface DisplaySource {
  grids: boolean
  levels: boolean
  shadows: boolean
  dims: boolean
  snap: boolean
  groundGrid: boolean
  nativeMats: boolean
}

/** Every switch, as it stands. */
export const displayState = (s: DisplaySource): DisplayState => ({
  grids: s.grids,
  levels: s.levels,
  shadows: s.shadows,
  dims: s.dims,
  groundGrid: s.groundGrid,
  snap: s.snap,
  originalMaterials: s.nativeMats
})

/** One section plane as the assistant reads it: millimetres, as `set_section` takes them. */
export interface PlaneState {
  name: string
  offsetMm: number
  flip: boolean
  cut: boolean
}

/** A set plane in full, or `null` for no plane. */
export const planeState = (plane: SecPlane | undefined): PlaneState | null =>
  plane?.name ? { name: plane.name, offsetMm: plane.offset, flip: plane.flip, cut: plane.cut } : null

/** Both planes in full — `get_view_state`'s `sectionPlanes`. */
export const sectionPlanes = (
  s: Sections | undefined
): { grid: PlaneState | null; level: PlaneState | null } => ({
  grid: planeState(s?.grid),
  level: planeState(s?.level)
})

/**
 * What a plane the Section card has just set looks like: cutting, not flipped, on the gridline
 * itself or `LEVEL_DEFAULT_OFFSET_MM` above the storey (`state/selectors/section.ts`
 * `planePatch`, which is also where `set_section` starts from).
 */
export const planeDefaults = (kind: SecKind): Omit<PlaneState, 'name'> => ({
  offsetMm: kind === 'level' ? LEVEL_DEFAULT_OFFSET_MM : 0,
  flip: false,
  cut: true
})

/** The parts of a set plane that are not its default. Its name is in `section` already. */
export type SparsePlane = Partial<Omit<PlaneState, 'name'>>
export interface SparsePlanes {
  grid?: SparsePlane
  level?: SparsePlane
}

function sparsePlane(kind: SecKind, plane: SecPlane | undefined): SparsePlane | null {
  const p = planeState(plane)
  if (!p) return null
  const d = planeDefaults(kind)
  const out: SparsePlane = {}
  if (p.offsetMm !== d.offsetMm) out.offsetMm = p.offsetMm
  if (p.flip !== d.flip) out.flip = p.flip
  if (p.cut !== d.cut) out.cut = p.cut
  return Object.keys(out).length ? out : null
}

/** Everything `chatViewState` reads, which is the view store and the federation. */
export interface ViewStateSource extends VisState, DisplaySource {
  stack: readonly FilterStep[]
  active: string | null
  view: string | null
  proj: string
  sections: Sections
  selIds: readonly number[]
  tool: string
  /** The display unit (2026-10-09). */
  units?: string
}

/* ────────────────────────────── the camera ────────────────────────────── */

/** What the viewer's camera offers a read-back: the rig's two angles and its projection. */
export interface CameraPose {
  theta: number
  phi: number
  proj: string
}

/**
 * The camera as the assistant reads it back, in `set_view`'s own terms: the named view it stands
 * on — or `null` once it has been orbited, turned or restored off one — its projection, and its
 * direction as azimuth and elevation in degrees, to one decimal (`shared/view-angles.ts`).
 */
export interface CameraBrief {
  view: string | null
  projection: string
  azimuthDeg: number
  elevationDeg: number
}

export const cameraBrief = (cam: CameraPose): CameraBrief => ({
  view: viewOn(cam.theta, cam.phi),
  projection: cam.proj,
  ...roundedAngles(cam.theta, cam.phi)
})

/** Hidden models the per-turn view state names before it counts the rest. */
export const MODELS_HIDDEN_CAP = 20

/** The fields the per-turn view state carries only while something is off its default. */
export type SparseViewState = Pick<
  ChatViewState,
  'display' | 'tool' | 'modelsHidden' | 'modelsHiddenMore' | 'sectionPlanes' | 'camera' | 'units'
>

/**
 * The per-turn view state's sparse half (2026-10-02): **a field only while it is not at its
 * default.** A view at its defaults adds nothing — not a key, not a byte — because this rides
 * on every turn and stays in the transcript afterwards. Keys, booleans and numbers only: a
 * model's *name* is file text, and is `get_view_state`'s to report, on demand.
 *
 * `camera` is the viewer's own, or `null` where there is no viewer; the default it is measured
 * against is "standing on the view `view` names".
 */
export function sparseViewState(
  s: ViewStateSource,
  federation: Federation,
  camera: CameraPose | null = null
): SparseViewState {
  const out: SparseViewState = {}

  const now = displayState(s)
  const display: Partial<DisplayState> = {}
  for (const k of Object.keys(DISPLAY_DEFAULTS) as (keyof DisplayState)[]) {
    if (now[k] !== DISPLAY_DEFAULTS[k]) display[k] = now[k]
  }
  if (Object.keys(display).length) out.display = display

  if (s.tool && s.tool !== DEFAULT_TOOL) out.tool = s.tool

  const hidden = federation.files.map((f) => f.key).filter((k) => s.modelVis?.[k] === false)
  if (hidden.length) {
    out.modelsHidden = hidden.slice(0, MODELS_HIDDEN_CAP)
    if (hidden.length > MODELS_HIDDEN_CAP) out.modelsHiddenMore = hidden.length - MODELS_HIDDEN_CAP
  }

  const grid = sparsePlane('grid', s.sections?.grid)
  const level = sparsePlane('level', s.sections?.level)
  if (grid || level) out.sectionPlanes = { ...(grid ? { grid } : {}), ...(level ? { level } : {}) }

  if (camera) {
    const { view, azimuthDeg, elevationDeg } = cameraBrief(camera)
    if (view === null || view !== s.view) out.camera = { view, azimuthDeg, elevationDeg }
  }

  // The design's own `mm` (`SGVue.dc.html:851`) is the one the view state leaves unsaid.
  if (s.units && s.units !== DEFAULT_DISPLAY_UNIT) out.units = s.units

  return out
}

/**
 * `SGVue.dc.html:1232`, field for field — plus `schedule` (2026-09-28), which the design has
 * no Schedules window to report. The caller works it out (`executors/schedule.ts`), because
 * the open schedule lives in the Schedules window, not in the view store. `section` names both
 * planes since 2026-10-01 (`grid C + level L2`); with one it reads as the design's does.
 *
 * These eleven fields are always there, and `get_view_state` builds on them
 * (`executors/read.ts`).
 */
export function viewStateCore(
  s: ViewStateSource,
  federation: Federation,
  visible: (el: VisElement) => boolean,
  schedule: ScheduleBrief | null = null
): ChatViewState {
  const els = federation.elements as readonly VisElement[]
  return {
    filterStack: (s.stack ?? []).map((x, i) => ({
      step: i + 1,
      enabled: x.on,
      action: x.action,
      rules: x.rules
    })),
    visibleElements: els.filter(visible).length,
    totalElements: els.length,
    hiddenManually: Object.keys(s.hidden ?? {}).length,
    storeysShown: federation.storeys
      .filter((st) => s.storeyVis[st.name] !== false)
      .map((st) => st.name),
    activeModel: s.active,
    view: s.view,
    projection: s.proj,
    section: s.sections ? sectionsLabel(s.sections) : null,
    selectedCount: s.selIds.length,
    schedule
  }
}

/**
 * What a turn is told about the view: the design's fields, then — only while something is not
 * at its default — the sparse ones (2026-10-02, `sparseViewState`).
 */
export function chatViewState(
  s: ViewStateSource,
  federation: Federation,
  visible: (el: VisElement) => boolean,
  schedule: ScheduleBrief | null = null,
  camera: CameraPose | null = null
): ChatViewState {
  return {
    ...viewStateCore(s, federation, visible, schedule),
    ...sparseViewState(s, federation, camera)
  }
}

/* ────────────────────────────── shared helpers ────────────────────────────── */

/**
 * `SGVue.dc.html:1274`'s `chatGroups`. Rules split into OR groups; reporting each group's
 * count separately is what lets the model notice that one of the categories it asked for
 * matched nothing.
 */
export function ruleGroups(rules: readonly Rule[] | undefined): Rule[][] {
  const rs = (rules ?? []).filter(isLiveRule)
  const groups: Rule[][] = []
  rs.forEach((r, i) => {
    if (i === 0 || r.join === 'or') groups.push([r])
    else groups[groups.length - 1].push(r)
  })
  return groups
}

/** `SGVue.dc.html:1277`'s label for one OR group. `absent` ignores `val`, so it prints none. */
export const groupLabel = (g: readonly Rule[]): string =>
  g
    .map((r) => (r.op === ABSENT_OP ? `${r.prop} ${ABSENT_LABEL}` : `${r.prop}${r.op}${r.val}`))
    .join(' AND ')

