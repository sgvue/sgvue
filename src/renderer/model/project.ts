/**
 * The renderer's half of the `.sgvue` project file — `docs/plans/project-file.md`, phase 2
 * (Save and Open, D8; the fourth writer, D11). The format and its arithmetic are
 * `shared/project-file.ts`; the file on disk is `main/projects.ts`. This is the wiring between
 * them and the store.
 *
 * **Saving.** The page never asks main to write and never names a path. File › Save Project makes
 * main ask for the project as it stands (`onProjectSnapshotRequest`); this builds it from the
 * store — the fields `sessionSource` reads, plus what a session does not carry — and each loaded
 * model's path, SHA-256 and size (`federation.projectFiles()`), through `projectOf` and
 * `projectText`, and answers with the text. `relPath` is left `null` here: main works it out
 * against the folder it is writing to, which only main knows. A viewpoint saved before
 * 2026-10-09 (no `idStride`) is renumbered through `viewpointHidden` before it is written, so
 * its hidden elements are not dropped. What `projectOf` could not write is counted
 * (`dropped`) and kept as `lastProjectWrite()` — data for later; there is no surface for it yet.
 *
 * **Opening.** Main reads the file the user picked, refuses it with the reader's sentence or
 * hands over its text and, per model, the file `admit()` let through (`onProjectOpened`) — the
 * page is never handed a path from the file that `admit()` did not pass. A project **replaces
 * what is open** (`startOver`, the landing page's fresh start), its models load through the
 * upload pipeline like any pick, and once they have joined `restorePlanOf` maps the file onto
 * them by GlobalId and the store's own `applySession` puts the state back (`RESTORE_ORDER`). For
 * now a model that is missing, refused, or changed (another size, or another SHA-256 once
 * parsed) is left out and named — in the landing page's banner when nothing could be opened, in
 * the designed error row otherwise. Locate… and the full wording are phase 4. **Such a model is
 * never dropped by a save**: its entry and every reference to it are carried forward from the
 * opened file, exactly as that file had them (`Carried`, `carryForward`).
 *
 * **The project's own lists (phase 3, plan D9).** While a project is open its saved viewpoints and
 * named filter sets are the store's lists (`setProjectLists`) and its saved schedule setups and
 * open schedule are held by the Schedules link (`setProjectSchedules`), which the Schedules
 * window shows: every save, rename, delete or cap rule — the controls' and the assistant's, through
 * the same actions — acts on the project's lists, writes nothing to `localStorage`, and makes the
 * project unsaved. When it closes the app's own `localStorage` lists come back, untouched. A Save
 * As from a session with no project takes the lists the app shows at that moment into the new
 * project, once (the plan's one-time import). With no project open nothing here runs.
 *
 * **Markups (phase 3).** A spot is placed again at its stored point, and a laser measurement is
 * **measured again** there through the viewer's own commit (`placeSpot` / `placeMeasure`), so it
 * reads the model as it is now, along the plan axes it has now — firing only the directions it
 * read when saved, because the file holds no surface normal and a ray fired into the face the
 * point sits on reads that element's own thickness (`measureReplay`). A measurement standing on
 * no loaded element while a model is missing is taken to be that model's: it is not measured,
 * and is carried into every save as the file had it, as the model is. One whose rays read
 * nothing now is not placed, and is counted (`lastProjectRestore`).
 *
 * **Unsaved changes.** While a project is open the review state it saves is compared with the
 * state as it was opened or last saved (`projectStateKey`, by value), and main is told when that
 * flips (`setProjectDirty`) — the title's `•` and the question on quit. The theme, the
 * selection, sizes and anything else a project does not save never make it dirty.
 *
 * **D12 — a model added to an open project** is given the palette colour its loaded neighbours'
 * rows use least (`assignColours`), in the store's `assignedColors` — not the user's override.
 * It is written `assigned: true` and comes back as assigned on reopen. With no project open
 * nothing is assigned, so nothing changes.
 */
import { MC } from '../../shared/colors'
import type { LaserDirection } from '../../shared/annotate'
import { turnXY } from '../../shared/plan-rotation'
import { ID_STRIDE, modelKeyOf } from '../../shared/federate'
import { IDENTITY_FRAME_KEY } from '../../shared/georef'
import type {
  PickedFile,
  ProjectModelFile,
  ProjectNothing,
  ProjectOpened,
  ProjectSnapshot,
  RefusedFile
} from '../../shared/ipc-contract'
import {
  carryForward,
  leastUsedColour,
  MAX_MARKUPS,
  PROJECT_MAX_BYTES,
  projectOf,
  projectText,
  readProject,
  restorePlanOf,
  type ProjectContext,
  type ProjectFile,
  type ProjectMeasure,
  type ProjectModelInfo,
  type ProjectSavedSchedule,
  type ProjectSource,
  type ProjectWrite,
  type RestorePlan
} from '../../shared/project-file'
import { idNumbering, type SessionCamera, type SessionFile } from '../../shared/session-codec'
import type { ScheduleDef } from '../../schedule/schedule/def'
import { listSaved } from '../schedule-ui/schedules'
import { modelLabel, rowSwatch } from '../state/selectors/models'
import { viewpointHidden } from '../state/selectors/views'
import { getViewer, useShell, type ShellState } from '../state/shell'
import { api } from '../api'
import { afterPaint, federation as fed } from './federation-store'
import { onProjectSchedules, openSchedule, projectSchedules, setProjectSchedules } from './schedule-link'
import { addError, onFreshStart, openProjectFiles, startOver } from './upload-pipeline'

/** A loaded model's file, as the project records it (`federation.projectFiles()`). */
export type ProjectFileInfo = SessionFile & { size?: number }

/** Everything a snapshot is cut from: the store, and what only the viewer and the Schedules window know. */
export interface SnapshotInputs {
  state: ShellState
  cam: SessionCamera | null
  files: readonly ProjectFileInfo[]
  schedules: readonly ProjectSavedSchedule[]
  openSchedule: ScheduleDef | null
}

/** The palette D12 assigns from: the design's model palette less its neutral grey, as the Recent pills' is. */
export const ASSIGN_PALETTE: readonly string[] = MC.slice(1)

/** The copy of the designed error row for a model a project names and could not open. */
export const MODEL_MISSING = 'not found where the project says it is'
export const MODEL_CHANGED = 'changed since the project was saved'

/* ────────────────────────────── the snapshot (pure) ────────────────────────────── */

/**
 * What a project saves, read off the store (`ProjectSource`). A viewpoint saved before
 * 2026-10-09 (no `idStride`) is renumbered onto the live federation first (`viewpointHidden`) —
 * `projectOf` reads only this build's numbering and would drop its hidden elements.
 */
export function projectSourceOf(i: SnapshotInputs): ProjectSource {
  const s = i.state
  const slots = s.federation.models.map((m) => m.slot)
  const views = s.views.map((v) =>
    idNumbering(v.idStride) === 'legacy'
      ? { ...v, hidden: viewpointHidden(v, slots, (id) => s.byId.has(id)), idStride: ID_STRIDE }
      : v
  )
  return {
    hidden: s.hidden,
    storeyVis: s.storeyVis,
    modelVis: s.modelVis,
    active: s.active,
    modelColors: s.modelColors,
    nativeMats: s.nativeMats,
    treeMode: s.treeMode,
    grids: s.grids,
    levels: s.levels,
    shadows: s.shadows,
    snap: s.snap,
    dims: s.dims,
    sections: s.sections,
    stack: s.stack,
    view: s.view,
    units: s.units,
    groundGrid: s.groundGrid,
    cam: i.cam,
    views,
    filterSets: s.filterSets,
    schedules: i.schedules,
    openSchedule: i.openSchedule,
    spots: s.spots,
    measures: s.measures
  }
}

/** Each loaded model with a file, as `projectOf` takes it: the MODELS row's label and colour. */
export function projectModelsOf(s: ShellState, files: readonly ProjectFileInfo[]): ProjectModelInfo[] {
  const byKey = new Map(s.federation.models.map((m) => [m.meta.modelKey, m]))
  return files.flatMap((f) => {
    const m = byKey.get(f.key)
    if (!m) return []
    return [
      {
        key: f.key,
        path: f.path,
        name: f.name,
        sha256: f.sha256,
        // A file parsed without its size cannot be named by the project: `projectOf` leaves it
        // out and counts it, rather than write a size that is not the file's.
        size: f.size ?? -1,
        label: modelLabel(f.key, m.meta.fileName, s.library, s.uploadNames[f.key]),
        colour: rowSwatch(f.key, m.slot, s.library, s.modelColors, f.path, s.assignedColors),
        // D12: written `assigned: true`, so a reopen gives the same colour back. A colour the user
        // picked wins, and is written as their own instead (`projectOf`).
        assigned: !s.modelColors[f.key] && Object.hasOwn(s.assignedColors, f.key)
      }
    ]
  })
}

/**
 * What only the live app knows, for `projectOf`. `projectPath` is `''`, so every `relPath` is
 * written `null`: main — the one side that knows where the file is going — works them out.
 */
export function projectContextOf(
  s: ShellState,
  files: readonly ProjectFileInfo[],
  savedAt: string,
  savedBy: string
): ProjectContext {
  return {
    projectPath: '',
    savedBy,
    savedAt,
    models: projectModelsOf(s, files),
    offset: s.offset,
    elementRef: (id) => {
      const el = s.byId.get(id)
      return el ? { model: el.model, guid: el.guid } : null
    }
  }
}

/**
 * The models of an opened project that are not open — missing, refused, changed: the file they came
 * from and their ids in it. A save writes them back as that file had them (`carryForward`).
 */
export interface Carried {
  file: ProjectFile
  ids: readonly string[]
  /**
   * 2026-11-07 (phase 3) — which of the project's viewpoints are the opened file's, and still that
   * viewpoint: live viewpoint id → its index in `file.viewpoints`. An id leaves it when its
   * viewpoint is deleted, so one saved later under the same id gains nothing of the file's.
   * Absent, viewpoints are paired by id (`carryForward`).
   */
  views?: Map<number, number>
  /**
   * 2026-11-07 (phase 3) — the file's markups that are not on screen, written back as it had
   * them: every one of them from the moment the project opens until `placeMarkups` has placed
   * what it could — so a restore that fails half way loses none — and after that the
   * measurements that stood on a missing model, and anything the viewer could not place.
   */
  measures?: readonly ProjectFile['markups']['measures'][number][]
  spots?: readonly ProjectFile['markups']['spots'][number][]
}

/**
 * The project, as `projectOf` builds it, from a snapshot of the inputs — with the opened file's
 * models that are not open carried forward (`carried`), so a save never drops a model, or a
 * reference to one of its elements, only because its file could not be found. A carried model
 * whose key is open again is the open one's.
 */
export function buildProject(i: SnapshotInputs, savedAt: string, savedBy: string, carried?: Carried | null): ProjectWrite {
  const loaded = new Set(i.state.federation.models.map((m) => m.meta.modelKey))
  const keep = (carried?.file.models ?? [])
    .filter((m) => carried!.ids.includes(m.id))
    .map((m) => ({ id: m.id, key: modelKeyOf(m.name) }))
    .filter((c) => !loaded.has(c.key))
  const ctx = { ...projectContextOf(i.state, i.files, savedAt, savedBy), carried: keep }
  const built = projectOf(projectSourceOf(i), ctx)
  if (!carried) return built
  let project = built.project
  if (keep.length) {
    project = carryForward(
      project,
      carried.file,
      keep.map((c) => c.id),
      carried.views
    )
  }
  if (carried.measures?.length || carried.spots?.length) {
    const measures = [...project.markups.measures, ...(carried.measures ?? [])]
    const spots = [...project.markups.spots, ...(carried.spots ?? [])]
    project = { ...project, markups: { spots: spots.slice(0, MAX_MARKUPS), measures: measures.slice(0, MAX_MARKUPS) } }
  }
  return { ...built, project }
}

/** JSON with every object's keys sorted, so two equal values always read the same. */
export function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, (x as Record<string, unknown>)[k]])
        )
      : x
  )
}

/**
 * The saved review state as one string, compared by value: two states that would write the same
 * project read the same. Only what a project saves is in it — never the theme, the selection, a
 * size, the open card or anything else D5 leaves out — and a model is its file (key, path,
 * digest) and its colour as the user or the project gave it, not a colour by position.
 */
export function projectStateKey(i: SnapshotInputs): string {
  const src = projectSourceOf(i)
  // A storey or model eye that is on reads the same as one never touched: only `false` is a state.
  const offOnly = (m: Record<string, boolean>): string[] =>
    Object.keys(m)
      .filter((k) => m[k] === false)
      .sort()
  return canonical({
    ...src,
    storeyVis: offOnly(src.storeyVis),
    modelVis: offOnly(src.modelVis),
    spots: src.spots.map((sp) => sp.p),
    measures: src.measures.map((m) => [m.p, m.x, m.y, m.z, m.sides, m.normal ?? null]),
    models: i.files.map((f) => [f.key, f.path, f.sha256]),
    assigned: i.state.assignedColors
  })
}

/**
 * D12 — the colours for models that joined an open project since it was opened or saved
 * (`known`): each the palette colour the other loaded models' rows use least, in slot order, each
 * counted for the next. Assigned colours of models no longer loaded are dropped. `null` when
 * nothing changes.
 */
export function assignColours(
  s: Pick<ShellState, 'federation' | 'library' | 'modelColors' | 'assignedColors'>,
  files: readonly { key: string; path: string }[],
  known: ReadonlySet<string>
): Record<string, string> | null {
  const loaded = new Set(s.federation.models.map((m) => m.meta.modelKey))
  const next: Record<string, string> = {}
  let changed = false
  for (const [k, c] of Object.entries(s.assignedColors)) {
    if (loaded.has(k)) next[k] = c
    else changed = true
  }
  const pathOf = (key: string): string | undefined => files.find((f) => f.key === key)?.path
  const models = [...s.federation.models].sort((a, b) => a.slot - b.slot)
  for (const m of models) {
    const key = m.meta.modelKey
    if (known.has(key) || Object.hasOwn(next, key)) continue
    const used = models
      .filter((o) => o.meta.modelKey !== key)
      .map((o) => rowSwatch(o.meta.modelKey, o.slot, s.library, s.modelColors, pathOf(o.meta.modelKey), next))
    const colour = leastUsedColour(ASSIGN_PALETTE, used)
    if (!colour) continue
    next[key] = colour
    changed = true
  }
  return changed ? next : null
}

/* ────────────────────────────── restoring ────────────────────────────── */

/**
 * A list whose ids each name one entry (phase 3): an id the file repeats is given the next one
 * free, so deleting, renaming or restoring one entry never acts on another. The first of a
 * repeated id keeps it; a list with no repeat is returned as it is.
 */
export function uniqueIds<T extends { id: number }>(xs: readonly T[]): T[] {
  const seen = new Set<number>()
  let next = Math.max(0, ...xs.map((x) => x.id)) + 1
  let changed = false
  const out = xs.map((x) => {
    if (!seen.has(x.id)) {
      seen.add(x.id)
      return x
    }
    changed = true
    const id = next++
    seen.add(id)
    return { ...x, id }
  })
  return changed ? out : [...xs]
}

/**
 * How a saved measurement with **no stored normal** is measured again (phase 3) — a file written
 * before the normal was, or a measurement fired with no face — from what the file holds of it, a
 * point and each side's reading. (With a normal, `placeMarkups` fires exactly as the click did.)
 *
 *  · `only` — the directions that read something when it was saved, and no others. The laser
 *    never fires into the face its point sits on (`laserDirections`); with no normal to tell
 *    which face that is, a ray fired every way would run into it and read the element's own
 *    thickness. A direction into the face always read nothing, so it is never among these.
 *  · `normal` — for the ray's 3 mm lift off the surface, plan frame: on each axis that read one
 *    side and not the other, towards the side that read (the other is where the face is). Absent
 *    when no axis says — the laser then lifts the point straight up, as for a point with no face.
 */
export function measureReplay(m: Pick<ProjectMeasure, 'sides'>): {
  only: LaserDirection[]
  normal: [number, number, number] | null
} {
  const only: LaserDirection[] = []
  const n: [number, number, number] = [0, 0, 0]
  ;(['X', 'Y', 'Z'] as const).forEach((axis, i) => {
    const side = m.sides[axis.toLowerCase() as 'x' | 'y' | 'z']
    const plus = side?.plus != null
    const minus = side?.minus != null
    if (plus) only.push({ axis, sign: 1 })
    if (minus) only.push({ axis, sign: -1 })
    if (plus !== minus) n[i] = plus ? 1 : -1
  })
  const len = Math.hypot(n[0], n[1], n[2])
  return { only, normal: len ? [n[0] / len, n[1] / len, n[2] / len] : null }
}

/** How far off an element's box a saved point may stand and still be on it: the laser's self window. */
export const ON_SURFACE_M = 0.05

/**
 * Whether a world point stands on — inside, or within `ON_SURFACE_M` of — the box of a loaded
 * element (`bbox`, world coordinates): a test made once for the elements, asked once a point.
 * Box arithmetic, conservative as every box is: a point that passes may still be in the air
 * beside a rotated part, never the other way round.
 */
export function onLoadedElements(
  elements: readonly { model: string; bbox?: readonly number[] }[]
): (p: readonly [number, number, number]) => boolean {
  const t = ON_SURFACE_M
  const inside = (p: readonly number[], b: readonly number[]): boolean =>
    p[0] >= b[0] - t && p[0] <= b[3] + t && p[1] >= b[1] - t && p[1] <= b[4] + t && p[2] >= b[2] - t && p[2] <= b[5] + t
  // Each model's union box first, so a point far from a model never walks its elements.
  const byModel = new Map<string, { box: number[]; boxes: (readonly number[])[] }>()
  for (const el of elements) {
    const b = el.bbox
    if (!b || b.length !== 6) continue
    let m = byModel.get(el.model)
    if (!m) byModel.set(el.model, (m = { box: [...b], boxes: [] }))
    for (let k = 0; k < 3; k++) {
      m.box[k] = Math.min(m.box[k], b[k])
      m.box[k + 3] = Math.max(m.box[k + 3], b[k + 3])
    }
    m.boxes.push(b)
  }
  const models = [...byModel.values()]
  return (p) => models.some((m) => inside(p, m.box) && m.boxes.some((b) => inside(p, b)))
}

/** What the last restore did with the file's markups — for the dev harness and the tests. */
export interface MarkupRestore {
  spots: number
  /** Spots the viewer did not place (there was no 3D view): carried, unplaced. */
  spotsCarried: number
  /** Measured again and placed. */
  measured: number
  /** Standing on no loaded element while a model is missing: carried into every save, unplaced. */
  carried: number
  /** Measured again and read nothing — no ray reached a face. Not placed. */
  unread: number
}
let lastRestore: MarkupRestore | null = null
export const lastProjectRestore = (): MarkupRestore | null => lastRestore

/**
 * Put the file's markups back through the viewer's own commit (`placeSpot` / `placeMeasure`, the
 * store's, at the stored **world** point — the store subtracts the offset). A spot is placed as it
 * was. A measurement is measured again: with its stored normal exactly as the click fired it,
 * else by `measureReplay` — unless a model is missing and its point is on no loaded element; then
 * it is returned, to be carried, as is a spot the viewer did not place. Spot tags come back
 * collapsed.
 */
export function placeMarkups(
  file: ProjectFile,
  elements: readonly { model: string; bbox?: readonly number[] }[],
  anyMissing: boolean
): {
  carried: ProjectFile['markups']['measures'][number][]
  spots: ProjectFile['markups']['spots'][number][]
  counts: MarkupRestore
} {
  const shell = useShell.getState()
  const counts: MarkupRestore = { spots: 0, spotsCarried: 0, measured: 0, carried: 0, unread: 0 }
  const carried: ProjectFile['markups']['measures'][number][] = []
  const spots: ProjectFile['markups']['spots'][number][] = []
  for (const sp of file.markups.spots) {
    if (shell.placeSpot(sp.at)) counts.spots++
    else {
      spots.push(sp)
      counts.spotsCarried++
    }
  }
  const rho = (useShell.getState().planRotationDeg * Math.PI) / 180
  const onLoaded = anyMissing && file.markups.measures.length ? onLoadedElements(elements) : null
  for (const m of file.markups.measures) {
    if (onLoaded && !onLoaded(m.at)) {
      carried.push(m)
      counts.carried++
      continue
    }
    let placed: boolean
    if (m.normal) {
      // The face it was fired from, as the click had it: every direction it allows, as a click.
      placed = useShell.getState().placeMeasure(m.at, m.normal, -1)
    } else {
      const { only, normal } = measureReplay(m)
      // The inferred normal is the plan's; the viewer takes it in the scene's frame and turns it back.
      const scene: [number, number, number] | null = normal
        ? [...turnXY([normal[0], normal[1]], rho), normal[2]]
        : null
      placed = only.length > 0 && useShell.getState().placeMeasure(m.at, scene, -1, only)
    }
    if (placed) counts.measured++
    else counts.unread++
  }
  return { carried, spots, counts }
}

/**
 * Put a project's restored state back through the store's own restore path (`applySession`, which
 * follows `RESTORE_ORDER`): what is hidden, the storey and model eyes, activate mode, the user's
 * own model colours and Original materials, the colours the project assigned (D12), the tree's grouping, the display switches, both
 * section planes, the filter stack, the named view, the unit and the camera — the camera only
 * when the file has one, so the boot framing stands otherwise. The canvas grid is not a session
 * key, so it is set through its own toolbar action. The theme (D7), the highlight colour and the
 * upload names are left as they are.
 *
 * The restored maps are null-prototype (`restorePlanOf`); the store only spreads, indexes and
 * enumerates them, so a storey named `__proto__` is an ordinary entry there too.
 *
 * The lists and the markups are not this function's: the lists are the project's own while it is
 * open (`enterLists`), and the markups are placed by the viewer once this has run (`placeMarkups`).
 */
export function applyProjectRestore(plan: RestorePlan): void {
  const st = plan.state
  const shell = useShell.getState()
  shell.applySession({
    hidden: st.hidden,
    storeyVis: st.storeyVis,
    modelVis: st.modelVis,
    active: st.active,
    modelColors: st.modelColors,
    nativeMats: st.nativeMats,
    treeMode: st.treeMode,
    grids: st.grids,
    levels: st.levels,
    snap: st.snap,
    dims: st.dims,
    shadows: st.shadows,
    sections: st.sections,
    stack: st.stack,
    view: st.view,
    units: st.units,
    uploadNames: shell.uploadNames,
    ...(st.cam ? { cam: st.cam, frame: IDENTITY_FRAME_KEY } : {})
  })
  if (useShell.getState().groundGrid !== st.groundGrid) useShell.getState().setGroundGrid(st.groundGrid)
  // D12 — the colours the project assigned come back as assigned, never as the user's own.
  useShell.setState({ assignedColors: { ...st.assignedColors } })
}

/* ────────────────────────────── the live wiring ────────────────────────────── */

const project = {
  /** A project is open: opened this run, or saved. */
  open: false,
  /** Its models are loading and it has not been restored yet: nothing is compared or assigned. */
  loading: false,
  /** The model keys that are the project's own — loaded with it, or there when it was saved. */
  known: new Set<string>(),
  /** The state as it was opened or last saved (`projectStateKey`). */
  baseline: '',
  /** What main was last told. */
  dirty: false,
  /** An upload row of this project's has appeared — so "no row left" means its load is over. */
  sawRows: false
}

/** The opened project's models that are not open, carried into every save (`buildProject`). */
let carried: Carried | null = null

/** The snapshots handed to main, by request number, until main says one was saved. */
const snapshots = new Map<number, { key: string; keys: string[] }>()

/** The last project written: what `projectOf` could not write, by count. */
let lastWrite: { dropped: ProjectWrite['dropped'] } | null = null
/** For the dev harness and the tests: the last save's `dropped` counts. */
export const lastProjectWrite = (): { dropped: ProjectWrite['dropped'] } | null => lastWrite

/**
 * The saved schedule setups and the open schedule a save writes: an open project's own (held by
 * the Schedules link), else — a Save As from a session with no project, the one-time import —
 * the Schedules window's `localStorage` list and the schedule it shows.
 */
function liveSchedules(): { schedules: ProjectSavedSchedule[]; openSchedule: ScheduleDef | null } {
  const held = project.open ? projectSchedules() : null
  if (held) return { schedules: [...held.saved], openSchedule: held.open }
  return { schedules: listSaved(), openSchedule: openSchedule()?.def ?? null }
}

const liveInputs = (): SnapshotInputs => ({
  state: useShell.getState(),
  cam: getViewer()?.getCamera() ?? null,
  files: fed.projectFiles(),
  ...liveSchedules()
})

/** The things the key is computed from, by reference: while none changed the key cannot have. */
let lastRefs: unknown[] = []
let lastKey = ''
function liveKey(force = false): string {
  const s = useShell.getState()
  const cam = getViewer()?.getCamera() ?? null
  const refs: unknown[] = [
    s.hidden, s.storeyVis, s.modelVis, s.active, s.modelColors, s.nativeMats, s.treeMode, s.grids,
    s.levels, s.shadows, s.snap, s.dims, s.sections, s.stack, s.view, s.units, s.groundGrid,
    s.views, s.filterSets, s.spots, s.measures, s.federation, s.assignedColors, s.library,
    // The project's schedules are a new object whenever the Schedules window changes them.
    s.uploadNames, projectSchedules(), cam ? JSON.stringify(cam) : null
  ]
  if (!force && refs.length === lastRefs.length && refs.every((r, i) => r === lastRefs[i])) return lastKey
  lastRefs = refs
  lastKey = projectStateKey(liveInputs())
  return lastKey
}

/** Tell main whether the open project has unsaved changes — when that flips, or when `force`d. */
function checkDirty(force = false): void {
  if (!project.open || project.loading) return
  const dirty = liveKey() !== project.baseline
  if (dirty === project.dirty && !force) return
  project.dirty = dirty
  void api()?.setProjectDirty(dirty).catch(() => undefined)
}

let checkTimer: ReturnType<typeof setTimeout> | undefined
const scheduleCheck = (): void => {
  clearTimeout(checkTimer)
  checkTimer = setTimeout(() => checkDirty(), 250)
}

/** A safe name for the Save dialog's default: the building's, else the first model's, else none. */
function suggestedName(s: ShellState): string {
  const raw = s.federation.project.name || s.federation.models[0]?.meta.fileName.replace(/\.[^.]+$/, '') || ''
  // The characters no file name may hold, as `ProjectSnapshot.suggestedName` refuses them.
  return raw.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').trim().slice(0, 120)
}

/**
 * Main's request: the project as it stands — or `text: null` and why there is nothing to save
 * (`reason`), which main needs when the user chose Save in the question on close, quit or Open:
 * with no model open there is nothing unsaved; anything else keeps the window and says so.
 */
export function snapshotFor(n: number): ProjectSnapshot {
  const nothing = (reason: ProjectNothing): ProjectSnapshot => ({ n, text: null, suggestedName: '', reason })
  try {
    const s = useShell.getState()
    if (project.loading) return nothing('loading')
    if (!s.booted) return nothing('no-models')
    const inputs = liveInputs()
    // A project names files: the demo building has none.
    if (!inputs.files.length) return nothing('no-files')
    const built = buildProject(inputs, new Date().toISOString(), `SGVue ${__APP_VERSION__}`, carried)
    const text = projectText(built.project)
    if (text.length > PROJECT_MAX_BYTES) return nothing('too-large')
    lastWrite = { dropped: built.dropped }
    const d = built.dropped
    if (d.elements || d.cameras || d.items) console.info('[sgvue] project saved without', d)
    snapshots.set(n, { key: projectStateKey(inputs), keys: s.federation.models.map((m) => m.meta.modelKey) })
    return { n, text, suggestedName: suggestedName(s), reason: null }
  } catch (err) {
    console.error('[sgvue] the project could not be built —', err)
    return nothing('failed')
  }
}

function answerSnapshot(n: number): void {
  void api()
    ?.answerProjectSnapshot(snapshotFor(n))
    .catch((err: unknown) => console.error('[sgvue] the project could not be handed over —', err))
}

let interval: ReturnType<typeof setInterval> | undefined
/** The camera changes outside the store: looked at once a second. */
const watch = (): void => {
  if (interval === undefined) interval = setInterval(() => checkDirty(), 1000)
}

/**
 * The first save of a session with no project (phase 3, the plan's one-time import): from now on
 * the lists the app shows are the new project's — the same lists, which nothing writes to
 * `localStorage` any more. `localStorage` keeps what it had, and is the app's again once the
 * project closes.
 */
function importLists(): void {
  const s = useShell.getState()
  s.setProjectLists({ views: s.views, filterSets: s.filterSets })
  // Only what the Schedules window's port can carry: a setup that cannot cross it is left out
  // and counted (`setProjectSchedules`), never sent to be refused.
  scheduleFit = setProjectSchedules({ saved: listSaved(), open: openSchedule()?.def ?? null })
}

/** What the last hand-over of a project's schedules left out (`setProjectSchedules`). */
let scheduleFit: { dropped: number; openDropped: boolean } | null = null
/** For the dev harness and the tests: what the last hand-over of a project's schedules left out. */
export const lastProjectScheduleFit = (): { dropped: number; openDropped: boolean } | null => scheduleFit

/** Main says the snapshot `n` is on disk: that is the state to compare with from now on. */
function onSaved(n: number): void {
  const snap = snapshots.get(n)
  snapshots.clear()
  if (!snap) return
  if (!project.open) importLists()
  project.open = true
  project.loading = false
  project.baseline = snap.key
  for (const k of snap.keys) project.known.add(k)
  watch()
  checkDirty(true)
}

/** A refusal, on the surface there is: the landing page's banner, or the designed error row. */
function refuse(name: string, message: string): void {
  const s = useShell.getState()
  if (s.booted) addError(`${name}.sgvue`, message)
  else s.setInitErr(message)
}

/**
 * The project's models that loaded are in; restore the project onto them. Exported for the tests,
 * which make it fail and see that the load still ends.
 */
export async function restore(file: ProjectFile, admittedAs: ReadonlyMap<string, string>): Promise<void> {
  // Whatever fails below, the load is over: never a project stuck "loading", which would answer
  // every Save with nothing and never track a change.
  try {
    await restoreOnto(file, admittedAs)
  } finally {
    settle()
  }
}

async function restoreOnto(file: ProjectFile, admittedAs: ReadonlyMap<string, string>): Promise<void> {
  const files = fed.projectFiles()
  const keyOfPath = new Map(files.map((f) => [f.path, f.key]))
  const bind = new Map<string, string>()
  for (const [id, path] of admittedAs) {
    const key = keyOfPath.get(path)
    if (key !== undefined) bind.set(id, key)
  }
  // A model whose bytes differ from the ones the project was saved with is left out, for now
  // (phase 4 opens it anyway and says what no longer matched, D3).
  for (const m of file.models) {
    const key = bind.get(m.id)
    const live = key !== undefined ? files.find((f) => f.key === key) : undefined
    if (key === undefined || !live || live.sha256 === m.sha256) continue
    bind.delete(m.id)
    await fed.removeModel(key)
    addError(m.name, MODEL_CHANGED)
  }
  useShell.setState({ assignedColors: {} })
  const f = fed.current
  const plan = restorePlanOf(file, { models: f.models, elements: f.elements }, { bind, offset: useShell.getState().offset })
  if (Object.keys(plan.unmatched).length) console.info('[sgvue] project references that matched nothing:', plan.unmatched)
  // The project's lists, now that its viewpoints' elements can be named by the ids they have.
  const views = enterLists(plan, true)
  // What is not open — missing, refused, changed — is carried into every save, unchanged.
  // The file's markups stay carried until they are placed: a restore that throws before then
  // must not let the next save drop them.
  carried = { file, ids: plan.missing, views, measures: file.markups.measures, spots: file.markups.spots }
  if (f.models.length) applyProjectRestore(plan)
  await afterPaint()
  if (!f.models.length) return
  // The markups last, so the laser reads the view the project restored.
  const placed = placeMarkups(file, f.elements, plan.missing.length > 0)
  lastRestore = placed.counts
  carried = { ...carried, measures: placed.carried, spots: placed.spots }
  const c = placed.counts
  if (c.carried || c.unread || c.spotsCarried) console.info('[sgvue] project markups not placed:', c)
}

/**
 * The project's saved viewpoints, named filter sets and saved schedules become the lists the app
 * shows (plan D9) — viewpoints and filter sets in the store, schedules through the Schedules
 * link, and, with `show`, its open schedule on screen. An id the file repeats is made unique
 * (`uniqueIds`). Returns which live viewpoint is which of the file's (`Carried.views`).
 */
function enterLists(plan: RestorePlan, show: boolean): Map<number, number> {
  const views = uniqueIds(plan.state.views)
  useShell.getState().setProjectLists({ views, filterSets: uniqueIds(plan.state.filterSets) })
  scheduleFit = setProjectSchedules({ saved: plan.state.schedules, open: plan.state.openSchedule }, show)
  return new Map(views.map((v, i) => [v.id, i]))
}

/** Loading is over, restored or not: from here the state is the project's as opened. */
function settle(): void {
  // Closed while it loaded (a fresh start that was not the project's own): nothing to settle.
  if (!project.open) return
  project.loading = false
  project.known = new Set(useShell.getState().federation.models.map((m) => m.meta.modelKey))
  project.baseline = liveKey(true)
  watch()
  checkDirty(true)
}

/**
 * The open project is closed — a fresh start on the landing page that is not the project's own (a
 * file dropped or picked, a Recent pill, the demo) replaces it, whether it had loaded or was still
 * loading. Nothing of it stays: not its baseline, its carried models or its assigned colours; and
 * main is told, so the title and the question on quit go too.
 */
export function closeProject(): void {
  if (!project.open) return
  project.open = false
  project.loading = false
  project.known = new Set()
  project.baseline = ''
  project.dirty = false
  project.sawRows = false
  carried = null
  snapshots.clear()
  useShell.setState({ assignedColors: {} })
  // The app's own lists again — `localStorage`'s, which the project never wrote.
  useShell.getState().setProjectLists(null)
  setProjectSchedules(null)
  void api()?.closeProject().catch(() => undefined)
}

/** The opened project's models that are not open, as the next save will carry them — for the tests. */
export const projectCarried = (): Carried | null => carried

/** Whether a project is open, and whether its models are still loading — for the tests. */
export const projectStatus = (): { open: boolean; loading: boolean } => ({ open: project.open, loading: project.loading })

/** Main read a project (or refused one): replace what is open with it. */
export async function openProjectMessage(msg: ProjectOpened): Promise<void> {
  if (!msg.ok) return refuse(msg.name, msg.message)
  const read = readProject(msg.text)
  // Main read the same text with the same reader; this cannot refuse, but is never trusted to.
  if (!read.ok) return refuse(msg.name, read.message)
  const file = read.project
  project.open = true
  project.loading = true
  project.known = new Set()
  project.baseline = ''
  project.sawRows = false
  snapshots.clear()
  startOver()
  useShell.setState({ assignedColors: {} })
  // Its lists are the app's from now on — before any model has loaded, so a federation change
  // never reads the building's `localStorage` list over them — and every model of the file is
  // one that is not open until the restore says otherwise.
  const views = enterLists(restorePlanOf(file, { models: [], elements: [] }), false)
  carried = {
    file,
    ids: file.models.map((m) => m.id),
    views,
    measures: file.markups.measures,
    spots: file.markups.spots
  }
  lastRestore = null

  const sent = new Map<string, ProjectModelFile>(msg.models.map((m) => [m.id, m]))
  const files: PickedFile[] = []
  const refused: RefusedFile[] = []
  const left: { name: string; why: string }[] = []
  const admittedAs = new Map<string, string>()
  for (const m of file.models) {
    const got = sent.get(m.id)
    if (got?.file && got.file.size === m.size) {
      files.push(got.file)
      admittedAs.set(m.id, got.file.path)
    } else if (got?.file) left.push({ name: m.name, why: MODEL_CHANGED })
    else if (got?.refused) refused.push(got.refused)
    else left.push({ name: m.name, why: MODEL_MISSING })
  }
  const queued = await openProjectFiles(files, refused, {
    order: files.map((f) => f.path),
    then: () => restore(file, admittedAs)
  })
  for (const l of left) addError(l.name, l.why)
  if (!queued) {
    if (left.length) {
      const names = left.map((l) => l.name).join(', ')
      useShell.getState().setInitErr(`None of this project's models could be opened: ${names}.`)
    }
    settle()
  }
}

/**
 * Called once from the shell's mount (`model/boot.ts`). Returns the teardown.
 */
export function installProject(): () => void {
  const bridge = api()
  const offRequest = bridge?.onProjectSnapshotRequest(({ n }) => answerSnapshot(n))
  const offOpened = bridge?.onProjectOpened((msg) => void openProjectMessage(msg))
  const offSaved = bridge?.onProjectSaved(({ n }) => onSaved(n))
  onFreshStart(closeProject)
  // The Schedules window changed the project's saved setups or its open schedule.
  onProjectSchedules(() => {
    if (project.open && !project.loading) scheduleCheck()
  })
  const offStore = useShell.subscribe((s, prev) => {
    if (!project.open) return
    // A viewpoint the file had and the user deleted is gone for good: one saved later under the
    // same id is a new viewpoint, and gains nothing of the file's (`carryForward`).
    if (s.views !== prev.views && carried?.views?.size) {
      const live = new Set(s.views.map((v) => v.id))
      for (const id of [...carried.views.keys()]) if (!live.has(id)) carried.views.delete(id)
    }
    if (project.loading) {
      // Every one of the project's files failed to load: no batch joined, so no restore will
      // run. The landing page is back with the rows saying why, and that is the project as opened.
      const inFlight = s.uploads.some((u) => !u.error)
      if (inFlight) project.sawRows = true
      else if (project.sawRows && !s.booted) settle()
      return
    }
    if (s.federation !== prev.federation) {
      const next = assignColours(s, fed.projectFiles(), project.known)
      if (next) useShell.setState({ assignedColors: next })
    }
    scheduleCheck()
  })
  return () => {
    offRequest?.()
    offOpened?.()
    offSaved?.()
    onFreshStart(null)
    onProjectSchedules(null)
    offStore()
    clearTimeout(checkTimer)
    if (interval !== undefined) clearInterval(interval)
    interval = undefined
  }
}
