/**
 * The session and the share link — `SGVue.dc.html:1676–1721`, as pure functions.
 *
 * Everything here is arithmetic on plain objects: no store, no viewer, no `localStorage`, no
 * IPC. That is the point — the restore *order* is the part of `applySession` that is easy to
 * get subtly wrong and impossible to see in a screenshot, so it is stated once, here, and
 * driven by `tests/unit/session-codec.test.ts` against a recording stub.
 *
 * Three things differ from the prototype, and each is forced by the desktop:
 *
 * 1. **`files`.** The design's `models` is a list of keys into its own fixed `SAMPLE_FILES`
 *    table, so "reopen these models" is a table lookup. A desktop session names real files, so
 *    each model carries `{ key, path, name, sha256 }` and `checkFiles` below is the decision
 *    that a file has moved or changed — never silently open a different one.
 * 2. **base64url.** `encodeState` is the design's own byte-wise encoder with the URL-safe
 *    alphabet (plan §3.5 item 9), because the payload travels in a `sgvue://s=…` URL rather
 *    than in a location hash.
 * 3. **`theme` is restored** (plan §3.5 item 2). The prototype saved it and never applied it.
 *
 * And one is the owner's (2026-10-01, two section planes): a payload carries **`sections`** —
 * the gridline cut and the level cut — **and** the design's single `section`, so a build from
 * before the change still restores one plane; `sectionsOf` reads either, coercing as it goes.
 *
 * 2026-10-02: the payload is also what the chat's per-turn revert snapshots, and `applyRestore`
 * what it restores through (`renderer/state/selectors/snapshot.ts`). `slotMapOf` and
 * `renumberId`, at the end of the element-id section, are that revert's half of `restorableIds`:
 * the same renumbering, for a snapshot taken and put back inside one app session.
 */
import { ID_STRIDE } from './federate'
import type { FilterStep } from './rules'
import { NO_PLANE, type SecPlane, type Sections } from './sections'

/** One loaded model's file, as the session remembers it. */
export interface SessionFile {
  /** The federation's `modelKey`, so a file lines up with its entry in `models`. */
  key: string
  path: string
  name: string
  /** Lower-case hex SHA-256 of the bytes that were parsed. */
  sha256: string
  /**
   * The federation slot the model had when the session was saved (refactor pass 2). Element
   * ids are `slot × 1 000 000 + expressId`, so this is what says whether the session's ids —
   * `hidden` — still name this file's elements once it is open again (`restorableIds`).
   * Absent in a payload written before it existed.
   */
  slot?: number
}

/** The camera, exactly as `viewer.getCamera()` returns it. Opaque here. */
export interface SessionCamera {
  theta: number
  phi: number
  dist: number
  half: number
  target: number[]
  proj: 'persp' | 'ortho'
}

/**
 * The design's single section plane (`SGVue.dc.html:848`) — what a payload carried before
 * 2026-10-01, and what one still carries beside `sections` for a build from before then.
 */
export interface SessionSection {
  kind: 'grid' | 'level' | null
  name: string
  offset: number
  flip: boolean
  cut: boolean
}

export interface SessionCoords {
  E: number | null
  N: number | null
  Z: number | null
  angle: number | null
}

/**
 * `SGVue.dc.html:1677–1684`, key for key and in the design's own order, plus `files`.
 *
 * `hlColor` is the design's and is kept: nothing in the prototype ever wrote it (it is always
 * `'#35C4B6'`), but it is a declared key, it is saved, and `applySession` pushes it to the
 * renderer — so the port keeps the key, the store field and the restore step rather than
 * deciding for a later phase that no one will ever set a highlight colour.
 *
 * `section` is the design's key in its single-plane shape and is **written for older builds
 * only** (`legacySection`); `sections` is what this build restores (`sectionsOf`).
 */
export interface SessionPayload {
  models: readonly string[]
  files: readonly SessionFile[]
  uploadNames: Record<string, string>
  hidden: Record<number | string, boolean>
  storeyVis: Record<string, boolean>
  modelVis: Record<string, boolean>
  active: string | null
  modelColors: Record<string, string>
  nativeMats: boolean
  treeMode: 'entity' | 'type'
  grids: boolean
  levels: boolean
  shadows: boolean
  theme: 'dark' | 'light'
  snap: boolean
  dims: boolean
  section: SessionSection
  /** 2026-10-01 — the gridline cut and the level cut, independent. Absent in an older payload. */
  sections: Sections
  stack: readonly FilterStep[]
  hlColor: string
  view: string | null
  /**
   * The base point — **written, never read back** since 2026-10-08, when the owner made the
   * Coordinate-system card read-only: the base point always comes from the boot file
   * (`sessionPatch` leaves it out). It is still written, as the boot file states it, for a build
   * from before then, which restores it over its own reading of the same file — the same numbers
   * for every file that build can read, and the base point of the frame the camera was saved in
   * for one it cannot (a Revit export placed by its `WorldCoordinateSystem`).
   */
  coords: SessionCoords
  cam: SessionCamera | null
  /**
   * Which project frame `cam` was recorded in — `shared/georef.ts`'s `frameKey`.
   *
   * The camera is scene coordinates, and the scene is the federation's project frame minus
   * its offset. A payload written against a different boot model, or by a build from before
   * the frame existed, describes a camera pose in someone else's coordinates: everything else
   * restores and the camera does not (`applyRestore`).
   */
  frame?: string
}

/**
 * What `sessionPayload()` reads off the state (`:1678`). The state holds `sections`; the legacy
 * `section` key is derived from it on the way out and is never read back into it.
 */
export type SessionSource = Omit<SessionPayload, 'models' | 'files' | 'cam' | 'frame' | 'section'>

/**
 * What a restore writes back (`sessionPatch`): everything a session saves but the base point,
 * which since 2026-10-08 is the boot file's alone and is never restored from a payload.
 */
export type SessionRestore = Omit<SessionSource, 'coords'>

/* ────────────────────────────── the two section planes ────────────────────────────── */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * The longest plane name read from a payload. A grid's `AxisTag` and a storey's name are a few
 * characters; a share link is a string a person pasted, and a name is printed — the Section
 * card's summary, a viewpoint's sub-line, the assistant's view state — so a longer one is
 * treated as no plane rather than carried.
 */
export const PLANE_NAME_MAX = 200

/**
 * One plane out of anything: a name that is a string of at most `PLANE_NAME_MAX` characters, a
 * finite offset, two real booleans.
 */
function planeOf(v: unknown): SecPlane {
  const o = isRecord(v) ? v : {}
  return {
    name: typeof o.name === 'string' && o.name.length <= PLANE_NAME_MAX ? o.name : '',
    offset: typeof o.offset === 'number' && Number.isFinite(o.offset) ? o.offset : 0,
    flip: o.flip === true,
    cut: o.cut === true
  }
}

/**
 * The section planes a payload or a saved viewpoint carries — **the one normaliser**, used by
 * the session, the share link and the viewpoint restore.
 *
 * `sections` when it is there; else the legacy `section` (written before 2026-10-01) mapped onto
 * the plane of its `kind`, the other plane cleared; else `null`, and the caller keeps what it
 * has. A link is a string a person pasted and a viewpoint is whatever was in `localStorage`, so
 * the input is **coerced, never trusted**: a name that is not a string — or is longer than
 * `PLANE_NAME_MAX` — is no plane, an offset that is not a finite number is 0, `flip` and `cut`
 * are true only when they are `true`, and every other key is ignored. A name the live
 * federation does not have draws nothing.
 */
export function sectionsOf(
  p: { sections?: unknown; section?: unknown } | null | undefined
): Sections | null {
  if (!p) return null
  if (isRecord(p.sections)) {
    return { grid: planeOf(p.sections.grid), level: planeOf(p.sections.level) }
  }
  if (isRecord(p.section)) {
    const plane = planeOf(p.section)
    if (p.section.kind === 'grid') return { grid: plane, level: NO_PLANE }
    if (p.section.kind === 'level') return { grid: NO_PLANE, level: plane }
    return { grid: NO_PLANE, level: NO_PLANE }
  }
  return null
}

/**
 * The same planes in the design's single-plane shape, for a build that knows no other, which
 * restores one plane rather than reading a shape it has never seen. Which one: **the plane that
 * is cutting**, when exactly one of the two set planes is — a previewed gridline beside a level
 * cut is restored as the level cut, the one that changes what is seen. When neither cuts or
 * both do, the gridline plane if it is set, else the level plane; with neither set, the design's
 * own "none" object.
 */
export function legacySection(s: Sections): SessionSection {
  const set = (p: SecPlane): boolean => p.name !== ''
  const cuts = (p: SecPlane): boolean => set(p) && p.cut
  const kind =
    cuts(s.level) && !cuts(s.grid) ? 'level' : set(s.grid) ? 'grid' : set(s.level) ? 'level' : null
  if (!kind) return { kind: null, name: '', offset: 0, flip: false, cut: false }
  const { name, offset, flip, cut } = s[kind]
  return { kind, name, offset, flip, cut }
}

/** `SGVue.dc.html:1677`. The state, the loaded keys, the files and the camera, in one object. */
export function sessionPayload(
  s: SessionSource,
  models: readonly string[],
  files: readonly SessionFile[],
  cam: SessionCamera | null,
  frame: string
): SessionPayload {
  return {
    models: [...models],
    files: [...files],
    uploadNames: s.uploadNames,
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
    theme: s.theme,
    snap: s.snap,
    dims: s.dims,
    section: legacySection(s.sections),
    sections: s.sections,
    stack: s.stack,
    hlColor: s.hlColor,
    view: s.view,
    coords: s.coords,
    cam,
    frame
  }
}

/* ────────────────────────────── restore ────────────────────────────── */

/**
 * The state `applySession` writes **before** it touches the renderer (`:1694–1697`), with the
 * design's own `pick(k, d)` rule: a key the payload does not carry keeps the default, and the
 * defaults are the design's literals where it states one and the live state where it does not.
 *
 * `theme` is the port's one addition, and it is plan §3.5 item 2: the prototype persisted it
 * and then never applied it, so a session saved in light came back dark.
 *
 * `coords` is the one key the design restores (`:1697`) that this does not, since 2026-10-08:
 * the Coordinate-system card is read-only and the base point always comes from the boot file, so
 * a payload's own — typed into a build from before then, or written by this one — is ignored.
 */
export function sessionPatch(
  p: Partial<SessionPayload>,
  s: Pick<SessionSource, 'treeMode' | 'grids' | 'levels' | 'sections' | 'hlColor' | 'view' | 'theme'>
): SessionRestore {
  const pick = <K extends keyof SessionPayload>(k: K, d: SessionPayload[K]): SessionPayload[K] =>
    p[k] === undefined ? d : (p[k] as SessionPayload[K])
  return {
    hidden: pick('hidden', {}),
    storeyVis: pick('storeyVis', {}),
    modelVis: pick('modelVis', {}),
    active: pick('active', null),
    modelColors: pick('modelColors', {}),
    nativeMats: pick('nativeMats', true),
    treeMode: pick('treeMode', s.treeMode),
    grids: pick('grids', s.grids),
    levels: pick('levels', s.levels),
    snap: pick('snap', true),
    dims: pick('dims', false),
    // `pick`'s own rule — a payload that carries neither key keeps the live planes — through the
    // normaliser, which also reads a payload written before there were two.
    sections: sectionsOf(p) ?? s.sections,
    stack: pick('stack', []),
    hlColor: pick('hlColor', s.hlColor),
    view: pick('view', s.view),
    // `:1699` never restored these two; the design saves both (`:1682`) and the plan asks for
    // them back. `shadows` still goes through its own restore step below, because the design
    // routes it through `setShadows` rather than through the state patch.
    theme: pick('theme', s.theme),
    shadows: pick('shadows', true),
    uploadNames: pick('uploadNames', {})
  }
}

/**
 * What `applySession`'s callback does to the renderer, in order (`:1699–1707`).
 *
 * The order is load-bearing: `setSection` before `setCamera` (a cut plane that arrives after a
 * camera flight re-frames nothing), `setShadows` before the camera, and `applyVis` **last**,
 * because it is the call that reads every one of the keys the patch has just written.
 *
 * The design's third step, `setCoords`, is not here since 2026-10-08: a restore never changes
 * the base point, which is the boot file's (`sessionPatch`).
 */
export const RESTORE_ORDER = [
  'grids',
  'levels',
  'snap',
  'modelColors',
  'highlightColor',
  'pickable',
  'section',
  'shadows',
  'camera',
  /** Taken **instead of** `camera` when the payload's frame is not the live one. */
  'frameExtents',
  'visibility'
] as const

export type RestoreStep = (typeof RESTORE_ORDER)[number]

/** One call per `RESTORE_ORDER` entry. `applyRestore` invokes them in exactly that order. */
export interface RestoreTarget {
  grids(on: boolean): void
  levels(on: boolean): void
  snap(on: boolean): void
  modelColors(map: Record<string, string>, native: boolean): void
  highlightColor(c: string): void
  pickable(active: string | null): void
  /** Both planes, in one call. The step keeps the design's name. */
  section(sections: Sections): void
  shadows(on: boolean): void
  camera(cam: SessionCamera): void
  /** Fit the whole federation — what a camera from another project frame is replaced with. */
  frameExtents(): void
  visibility(): void
}

/**
 * `SGVue.dc.html:1699–1707`. `shadows` and `camera` are conditional there and stay conditional
 * here — a payload with no camera must not move the one the boot framing just chose.
 *
 * `liveFrame` is the federation's project frame as `frameKey` spells it. A payload whose own
 * marker differs — or which has none, because it was written before the frame existed — keeps
 * every other key and frames the extents rather than pointing the camera with numbers that
 * meant something else.
 */
export function applyRestore(
  n: SessionRestore,
  p: Partial<SessionPayload>,
  t: RestoreTarget,
  liveFrame: string
): RestoreStep[] {
  const ran: RestoreStep[] = []
  const did = (step: RestoreStep): void => void ran.push(step)
  t.grids(n.grids)
  did('grids')
  t.levels(n.levels)
  did('levels')
  t.snap(n.snap)
  did('snap')
  t.modelColors(n.modelColors || {}, n.nativeMats)
  did('modelColors')
  t.highlightColor(n.hlColor)
  did('highlightColor')
  t.pickable(n.active)
  did('pickable')
  t.section(n.sections)
  did('section')
  if (p.shadows != null) {
    t.shadows(p.shadows)
    did('shadows')
  }
  if (p.cam && p.frame === liveFrame) {
    t.camera(p.cam)
    did('camera')
  } else if (p.cam) {
    t.frameExtents()
    did('frameExtents')
  }
  t.visibility()
  did('visibility')
  return ran
}

/* ────────────────────────────── element ids (refactor pass 2) ────────────────────────────── */

/**
 * The slot a session's file expects: the one recorded for it, or — in a payload from before
 * slots were recorded — its place in `files`, which is the slot a boot of those files in that
 * order gives it.
 */
const expectedSlot = (f: SessionFile, i: number): number => f.slot ?? i

/**
 * A session's batch, in the order of the slots its files had: a boot hands slots out lowest
 * first, in batch order, so a reopened session usually gets its own numbering back rather than
 * the order the parses happened to finish in. Anything the session does not name goes last, in
 * the order it came. `restorableIds` renumbers the ids whatever slots the files end up on.
 */
export function sessionOrder<T>(
  items: readonly T[],
  pathOf: (item: T) => string | undefined,
  files: readonly SessionFile[]
): T[] {
  const rank = new Map(files.map((f, i) => [f.path, expectedSlot(f, i)]))
  const of = (item: T): number => rank.get(pathOf(item) ?? '') ?? Infinity
  return [...items].sort((a, b) => of(a) - of(b))
}

/**
 * A session's **element ids**, renumbered for the federation its files have just joined.
 *
 * An id is `slot × ID_STRIDE + expressId`, and a file need not come back on the slot it had:
 * a model replaced before the save sat on a slot of its own (2026-09-24, refactor pass 2), a
 * removal leaves gaps, and a link opened with other models loaded joins on whatever slots are
 * free. So each id is moved from its file's **saved** slot to that file's **live** slot, matched
 * by path — the same element, whatever slot it now has. The rule for restoring at all: **every**
 * one of the session's files must be open; if one is not, no id is restored (`hidden` empty,
 * `active` unset), because a slot left unmatched could be any model's. An id whose slot belonged
 * to no file of the session (the demo has none) is dropped. Everything by name — storeys,
 * models, the stack, the section, the camera — restores as before.
 *
 * A payload from before slots were recorded takes each file's place in `files` as its saved
 * slot, which is what a boot of those files in that order gave it. `active` is the saved
 * model key, carried to the key its file is open under now, and cleared when no file had it.
 * `live` is `sessionFiles()` as it stands after the join.
 */
export function restorableIds(
  p: Partial<SessionPayload>,
  live: readonly SessionFile[]
): Pick<SessionPayload, 'hidden' | 'active'> {
  const files = p.files ?? []
  const byPath = new Map(live.map((f) => [f.path, f]))
  const slotMap = new Map<number, number>()
  const keyMap = new Map<string, string>()
  for (let i = 0; i < files.length; i++) {
    const now = byPath.get(files[i].path)
    if (!now || now.slot === undefined) return { hidden: {}, active: null }
    slotMap.set(expectedSlot(files[i], i), now.slot)
    keyMap.set(files[i].key, now.key)
  }
  const hidden: Record<string, boolean> = {}
  for (const [id, on] of Object.entries(p.hidden ?? {})) {
    const n = Number(id)
    const to = slotMap.get(Math.floor(n / ID_STRIDE))
    if (to !== undefined) hidden[to * ID_STRIDE + (n % ID_STRIDE)] = on
  }
  const active = p.active != null ? (keyMap.get(p.active) ?? null) : null
  return { hidden, active }
}

/* ────────────────────── element ids, inside one app session (2026-10-02) ────────────────────── */

/**
 * One loaded model, as a snapshot of element ids has to remember it: which model it is, and the
 * slot its ids were numbered by. `sha256` is the digest of the bytes that were parsed (`''` for
 * the demo building, which has no file), so a file replaced by a changed version is a different
 * model although its key is the same.
 */
export interface SlotRecord {
  key: string
  sha256: string
  slot: number
}

/**
 * The per-turn revert's half of `restorableIds` — the same rule, *an id is moved from the slot
 * its model had to the slot that model has now*, for a snapshot taken and restored inside one
 * app session (`renderer/state/selectors/snapshot.ts`).
 *
 * Two things differ from a session reopened from disk, and both make it safe to restore **part**
 * of what was saved where `restorableIds` restores all or nothing. The slot of every model is
 * always recorded, so an id whose slot matches no model is *known* to belong to a model that has
 * gone — never "could be any model's". And a model is the same one only when its key **and** its
 * digest are: a slot freed by an unload can be taken by another file, and a pick that replaces a
 * model lands on a slot of its own, so "the id still exists" proves nothing.
 *
 * `slots` maps a saved slot to the live one; `gone` names the saved models that are no longer
 * loaded, in the order they were saved.
 */
export function slotMapOf(
  saved: readonly SlotRecord[],
  live: readonly SlotRecord[]
): { slots: Map<number, number>; gone: string[] } {
  const slots = new Map<number, number>()
  const gone: string[] = []
  for (const was of saved) {
    const now = live.find((m) => m.key === was.key && m.sha256 === was.sha256)
    if (now) slots.set(was.slot, now.slot)
    else gone.push(was.key)
  }
  return { slots, gone }
}

/** One id on the slot its model has now, or `null` when that model is no longer loaded. */
export function renumberId(id: number, slots: ReadonlyMap<number, number>): number | null {
  const to = slots.get(Math.floor(id / ID_STRIDE))
  return to === undefined ? null : to * ID_STRIDE + (id % ID_STRIDE)
}

/* ────────────────────────────── the link ────────────────────────────── */

/**
 * `SGVue.dc.html:1709`, with the URL-safe alphabet: the design's `btoa(encodeURIComponent(j)
 * .replace(/%(..)/g, …))` is a UTF-8 → binary-string round trip, kept exactly, then `+/=`
 * become `-_` and the padding is dropped so the result survives a `sgvue://s=…` URL.
 */
export function encodeState(payload: SessionPayload): string {
  const json = JSON.stringify(payload)
  const binary = encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, h: string) =>
    String.fromCharCode(parseInt(h, 16))
  )
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * `SGVue.dc.html:1713`. Tolerant by contract: anything that is not a payload gives `null`,
 * because this reads a string a person pasted.
 */
export function decodeState(b: string): SessionPayload | null {
  try {
    const padded = b.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    const json = decodeURIComponent(
      [...binary].map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
    )
    const value: unknown = JSON.parse(json)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    return value as SessionPayload
  } catch {
    return null
  }
}

/** `sgvue://s=<base64url>`. The registered scheme, so the OS hands it back to the app. */
export const LINK_PREFIX = 'sgvue://s='

export const linkFor = (payload: SessionPayload): string => LINK_PREFIX + encodeState(payload)

/**
 * A share link's shape, its base64url code captured. One pattern for the renderer
 * (`payloadFromLink`) and for main (`launchHash` in `main/deep-link.ts`).
 */
export const LINK_PATTERN = /^sgvue:(?:\/\/)?s=([A-Za-z0-9\-_]+)/

/**
 * The payload inside a `sgvue://s=…` URL, or `null`. Accepts the `sgvue://s=…?x` and
 * `sgvue://s=…#x` forms an OS may hand over, and the `sgvue:s=…` one Windows produces when the
 * argument has no authority component.
 */
export function payloadFromLink(url: string): SessionPayload | null {
  const m = LINK_PATTERN.exec(url.trim())
  return m ? decodeState(m[1]) : null
}

/* ────────────────────────────── the file checks ────────────────────────────── */

/** What is actually on disk for one of the session's files. */
export interface FileProbe {
  path: string
  /** `false` when `fs.stat` said no. */
  exists: boolean
  /** The file's SHA-256 now, or `null` when it was not rehashed. */
  sha256?: string | null
}

export type FileVerdict =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'changed'; files: readonly SessionFile[]; message: string }

/**
 * A session's files lined up with what main admitted, one answer per file.
 *
 * `admit()` (`main/file-protocol.ts`) replies with each path's own `realpath`, which need not
 * be the spelling the session stored: a directory junction, an 8.3 short name such as
 * `C:\Users\JANEDO~1\…`, a mapped drive. Comparing the two by string reported the file as
 * moved and skipped its hash check. So the caller admits one path at a time — `admitted[i]` is
 * what came back for `files[i]`, or `null` when main refused it — and this rewrites each file
 * to the path main gave back, so everything downstream talks about the same spelling. A
 * refused file keeps its own path and is `exists: false`, which `checkFiles` turns into the
 * banner's copy.
 */
export function canonicalFiles(
  files: readonly SessionFile[],
  admitted: readonly (string | null | undefined)[]
): { files: SessionFile[]; probes: FileProbe[] } {
  const out = files.map((f, i) => {
    const real = admitted[i]
    return real ? { ...f, path: real } : f
  })
  return { files: out, probes: out.map((f, i) => ({ path: f.path, exists: !!admitted[i] })) }
}

/**
 * The decision the landing page's error banner is built from, as a pure function.
 *
 * A session or a link that names a file which has moved, or whose bytes have changed since,
 * is **refused by name** — never silently resolved to something else, which is the one way a
 * viewer can show a person the wrong building and look right doing it.
 */
export function checkFiles(
  files: readonly SessionFile[],
  probes: readonly FileProbe[]
): FileVerdict {
  const by = new Map(probes.map((p) => [p.path, p]))
  const missing = files.filter((f) => !by.get(f.path)?.exists)
  if (missing.length) {
    return {
      ok: false,
      reason: 'missing',
      files: missing,
      message: `${nameList(missing)} ${missing.length === 1 ? 'is' : 'are'} no longer where the session left ${missing.length === 1 ? 'it' : 'them'}. Pick the file again to start.`
    }
  }
  const changed = files.filter((f) => {
    const probe = by.get(f.path)
    return probe?.sha256 != null && f.sha256 !== '' && probe.sha256 !== f.sha256
  })
  if (changed.length) {
    return {
      ok: false,
      reason: 'changed',
      files: changed,
      message: `${nameList(changed)} ${changed.length === 1 ? 'has' : 'have'} changed since the session was saved. Open ${changed.length === 1 ? 'it' : 'them'} again to review the new version.`
    }
  }
  return { ok: true }
}

const nameList = (files: readonly SessionFile[]): string =>
  files.length <= 2
    ? files.map((f) => f.name).join(' and ')
    : `${files[0].name} and ${files.length - 1} other files`
