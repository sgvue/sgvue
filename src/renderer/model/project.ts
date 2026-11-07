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
 * **Written in phase 2, restored in phase 3:** viewpoints, filter sets, schedules and markups.
 * They are in every file this saves; `applyProjectRestore` deliberately does not put them back yet.
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
  PROJECT_MAX_BYTES,
  projectOf,
  projectText,
  readProject,
  restorePlanOf,
  type ProjectContext,
  type ProjectFile,
  type ProjectModelInfo,
  type ProjectSavedSchedule,
  type ProjectSource,
  type ProjectWrite,
  type RestorePlan
} from '../../shared/project-file'
import { idNumbering, type SessionCamera, type SessionFile } from '../../shared/session-codec'
import type { ScheduleDef } from '../../schedule/schedule/def'
import { listSaved, SAVED_KEY } from '../schedule-ui/schedules'
import { modelLabel, rowSwatch } from '../state/selectors/models'
import { viewpointHidden } from '../state/selectors/views'
import { getViewer, useShell, type ShellState } from '../state/shell'
import { api } from '../api'
import { afterPaint, federation as fed } from './federation-store'
import { openSchedule } from './schedule-link'
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
  if (!carried || !keep.length) return built
  return {
    ...built,
    project: carryForward(
      built.project,
      carried.file,
      keep.map((c) => c.id)
    )
  }
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
    measures: src.measures.map((m) => [m.p, m.x, m.y, m.z, m.sides]),
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
 * **Not restored yet — phase 3:** the viewpoints, filter sets, saved schedules, the open schedule
 * and the markups (`state.views`, `filterSets`, `schedules`, `openSchedule`, `spots`,
 * `measures`). Phase 2 writes them; phase 3 moves those lists into the project (D9).
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

const savedSchedules = (): ProjectSavedSchedule[] => listSaved()

const liveInputs = (): SnapshotInputs => ({
  state: useShell.getState(),
  cam: getViewer()?.getCamera() ?? null,
  files: fed.projectFiles(),
  schedules: savedSchedules(),
  openSchedule: openSchedule()?.def ?? null
})

/** The raw stored schedules, cheap to read, for the short-circuit below. */
function rawSaved(): string | null {
  try {
    return localStorage.getItem(SAVED_KEY)
  } catch {
    return null
  }
}

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
    s.uploadNames, openSchedule(), rawSaved(), cam ? JSON.stringify(cam) : null
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
/** The camera and the Schedules window's lists change outside the store: looked at once a second. */
const watch = (): void => {
  if (interval === undefined) interval = setInterval(() => checkDirty(), 1000)
}

/** Main says the snapshot `n` is on disk: that is the state to compare with from now on. */
function onSaved(n: number): void {
  const snap = snapshots.get(n)
  snapshots.clear()
  if (!snap) return
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
  // What is not open — missing, refused, changed — is carried into every save, unchanged.
  carried = plan.missing.length ? { file, ids: plan.missing } : null
  if (f.models.length) applyProjectRestore(plan)
  await afterPaint()
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
  // Until the restore says otherwise, every model of the file is one that is not open.
  carried = { file, ids: file.models.map((m) => m.id) }
  startOver()
  useShell.setState({ assignedColors: {} })

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
  const offStore = useShell.subscribe((s, prev) => {
    if (!project.open) return
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
  // The Schedules window saves its setups in this origin's storage, and says so here.
  const onStorage = (): void => scheduleCheck()
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  return () => {
    offRequest?.()
    offOpened?.()
    offSaved?.()
    onFreshStart(null)
    offStore()
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
    clearTimeout(checkTimer)
    if (interval !== undefined) clearInterval(interval)
    interval = undefined
  }
}
