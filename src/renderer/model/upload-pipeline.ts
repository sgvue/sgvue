/**
 * The upload pipeline — `SGVue.dc.html:1152–1200`, with a real parser behind it.
 *
 * The design's control flow is kept exactly: validate, stagger by 500 ms, one row per file,
 * five stages, a green tick held for 1 100 ms, and the federation forming only once every row
 * has finished. What changed is what drives the stages — a worker on a real file rather than
 * a timer — and `shared/upload.ts` states the two rules that reconcile them: a stage is never
 * shown ahead of real progress, and never for less than the design's minimum.
 *
 * One prototype defect is fixed, and it is visible: `finishUpload` (`:1186`) waits for every
 * row that is not `done`, and a **rejected** row is never `done` — so dropping one bad file
 * alongside a good one left the good one parsed and never loaded until the rejection was
 * dismissed by hand. Error rows are excluded here.
 *
 * Two owner-approved changes, 2026-09-24 (`CLAUDE.md`, allowed desktop deviations):
 *
 * · the federation is built **during** the last tick's 1 100 ms hold rather than after it, and
 *   the finished rows stay on screen, ticked, until the viewer is revealed — which is at
 *   whichever of the two finishes last. The page is never left standing with nothing moving;
 * · on the landing page a new pick **replaces** whatever is still loading (`freshStart`): the
 *   owner wants to be certain which model is on screen. After boot a pick joins the federation
 *   — and a pick whose model is already open or loading is **confirmed in a native message
 *   box and then replaces it** (`confirmPick`, the claims below): *"Just ask user to confirm
 *   then remove the old version."*
 *
 * 2026-10-01: the review state a replaced demo takes with it (`forgetDemoView`) includes
 * **both** section planes — the gridline cut and the level cut.
 *
 * 2026-10-02 — the assistant can **ask** for two of these entry points, and neither is done
 * for it (the consent gate, `ai/executors/request.ts`): `openDialog`, whose pick is the user's,
 * and `openRecent`, which runs from the user's click on Apply. `openDialogUp` is how a second
 * dialog is refused while one is up, and `openPaths` says whether main admitted anything.
 */
import type { AdmitResult, PickedFile, RefusedFile } from '../../shared/ipc-contract'
import { NO_SECTIONS } from '../../shared/sections'
import { projectDrop, PROJECT_NOT_ON_DISK, type ProjectDrop } from '../../shared/project-drop'
import { restorableIds, sessionOrder, type SessionPayload } from '../../shared/session-codec'
import * as up from '../../shared/upload'
import { getViewer, resetHistory, useShell, type LibraryFile } from '../state/shell'
import { afterPaint, federation as fed, modelKeyOf, type BatchItem } from './federation-store'
import { applySession, verifyHashes } from './session'
import { api } from '../api'

/** A file the user chose, however they chose it. `file` is set only by a native drop. */
export interface ChosenFile {
  path: string
  name: string
  size: number
  file?: File
  /**
   * A drop main did not admit: it still loads from its `File`, but its path is the drop's own
   * spelling, so it is never remembered — every stored path has passed `admit()` (2026-09-21).
   */
  unadmitted?: true
  /**
   * 2026-10-09 — main turned this file down (the Open dialog, a Recent pill, a link) for a
   * reason the drop zone gives too. It has no path, is never opened, and gets the designed
   * error row with that reason (`rejectOf`).
   */
  refused?: up.RejectReason
  /**
   * 2026-11-08 (project phase 4, D4) — a file located for a project's missing model: it loads under
   * that model's key, `modelKeyOf` of the project's file name (the key a restore already gave the
   * model's `Model` rules), and is named as the project named it, whatever the picked file is
   * called. A key already open is asked about as any pick's is ("Replace model?").
   */
  as?: { key: string; name: string }
}

/** The model key a chosen file asks for: the project's, for a located file, else its stem. */
const keyOfChosen = (f: ChosenFile): string => f.as?.key ?? modelKeyOf(f.name)

/** Why a chosen file gets the designed error row instead of a load — `null` when it loads. */
const rejectOf = (f: ChosenFile): up.RejectReason | null => f.refused ?? up.validate(f.name, f.size)

/** Main's answer to an admit, or nothing admitted when there is no bridge to ask. */
const admitResult = (r: AdmitResult | null | undefined): AdmitResult => ({
  files: r?.files ?? [],
  refused: r?.refused ?? []
})

/**
 * A refused file as the queue takes it: its name and main's reason, no path. Main sends no size,
 * and none is read: `rejectOf` takes the reason before it would look at one.
 */
const refusedOf = (r: RefusedFile): ChosenFile => ({
  path: '',
  name: r.name,
  size: 0,
  refused: r.reason
})

/* ────────────────────────────── one live row ────────────────────────────── */

interface Live {
  id: string
  /** The furthest of the design's five stages the real pipeline has reached. */
  real: number
  /** Which one is on screen. */
  shown: number
  shownAt: number
  /** The real work is finished and the model is waiting to join. */
  ready: boolean
  timer?: ReturnType<typeof setTimeout>
}

const live = new Map<string, Live>()

/** Parsed models waiting for every row to finish, and what they were called. */
let pending: BatchItem[] = []
let pendingNames: Record<string, string> = {}
/** A session or share link that asked for this load, restored once the batch has joined. */
let pendingSession: SessionPayload | null = null
/**
 * 2026-11-07 — a project that asked for this load (`model/project.ts`): the batch is ordered by
 * the project's own model order (`order`, by path), and `then` restores the project once the
 * batch has joined, where a session's payload is applied.
 */
export interface AfterJoin {
  order: readonly string[]
  then: () => Promise<void>
  /**
   * 2026-11-11 — the batch failed to join (`addBatch` threw, or the boot was refused after it
   * committed), so `then` will never run. Called once the federation is in its final state, only
   * while the load that queued it is still the current one (`epoch`).
   */
  failed?: () => void | Promise<void>
}

const report = (err: unknown): void => console.error('[sgvue] project restore failed —', err)

/** One `AfterJoin.failed`, never throwing: a failure inside it is logged, not passed on. */
const runFailed = async (a: AfterJoin | null): Promise<void> => {
  try {
    await a?.failed?.()
  } catch (err) {
    report(err)
  }
}

/**
 * 2026-11-08 (phase 4) — a second `AfterJoin` for the same batch (a model located while the
 * project's own models still load) runs after the first: both orders, both restores, in turn.
 */
export const chainAfter = (a: AfterJoin | null, b: AfterJoin): AfterJoin =>
  a
    ? {
        order: [...a.order, ...b.order],
        then: async () => {
          await a.then().catch(report)
          await b.then()
        },
        failed: async () => {
          await runFailed(a)
          await runFailed(b)
        }
      }
    : b
let pendingAfter: AfterJoin | null = null

/** Timers started by `queue`'s 500 ms stagger, so a dispose can cancel them. */
const staggered = new Set<ReturnType<typeof setTimeout>>()

/**
 * Bumped by every `disposeUploads`. Work that finds it changed belongs to a load that was
 * replaced or torn down, and ends without a row, a banner or a join.
 */
let epoch = 0

/* ────────────────────────────── one model per key ────────────────────────────── */

/**
 * 2026-09-24 — the upload that owns each model key, from the moment it is queued until it
 * joins or fails. A newer pick of the same key takes the claim over: the older row goes at
 * once, and a parsed model still waiting to join leaves `pending`. A parse still running
 * cannot be stopped on its own — the one parse worker also holds every loaded model's file
 * open, and `cancel()` terminates the worker — so it runs out, its result is discarded, and
 * the newer upload waits for it before it parses (`settled`), so two parses never share a key.
 */
interface Claim {
  superseded: boolean
  /** 2026-11-12 — the chosen file's path (`''` when a dropped file could not be named), for `locateOver`. */
  path: string
  rowId?: string
  /** The parsed model, once it waits in `pending`. */
  item?: BatchItem
  /** Resolves once this upload, and every older one for the key, can no longer touch it. */
  settled: Promise<void>
  settle: () => void
}

const claims = new Map<string, Claim>()

/** A key that is on screen, joining, parsing, or queued. */
const busy = (key: string): boolean => fed.isOpen(key) || claims.has(key)

function claim(key: string, path: string): { mine: Claim; prior: Promise<void> } {
  const old = claims.get(key)
  if (old) supersede(key, old)
  let settle = (): void => {}
  const settled = new Promise<void>((done) => (settle = done))
  const mine: Claim = { superseded: false, path, settled, settle }
  claims.set(key, mine)
  return { mine, prior: old?.settled ?? Promise.resolve() }
}

/**
 * 2026-11-12 — the paths of files located into a project (`locateFile`) that the pipeline queued.
 * With `claims`, it tells a located load that is over from one still on its way in (`locateOver`).
 * A path leaves it when the same file is located again, before anything awaits. It is **not**
 * cleared by `disposeUploads`: a torn-down load is over too (its claim went with it), and it runs
 * only where the project closes or reopens (forgetting what it located) or the window is torn down.
 * It only ever holds paths the user located in this run.
 */
const located = new Set<string>()

/**
 * 2026-11-12 — whether the located file at `path` was queued and its load has ended without it:
 * no claim holds it any more — not queued, parsing, waiting to join or joining. A claim leaves the
 * map when its parse fails, once its batch has joined or been refused, when a newer pick of its
 * key takes it over, and on `disposeUploads`. Whether it ended **open** is the caller's to ask
 * (`model/project.ts`, `releaseDead`). A file this pipeline never saw queued is never over.
 */
export function locateOver(path: string): boolean {
  if (!located.has(path)) return false
  for (const c of claims.values()) if (c.path === path) return false
  return true
}

function supersede(key: string, old: Claim): void {
  old.superseded = true
  if (old.rowId) {
    const l = live.get(old.rowId)
    if (l?.timer) clearTimeout(l.timer)
    live.delete(old.rowId)
    useShell.getState().dropUpload(old.rowId)
  }
  if (old.item && pending.includes(old.item)) {
    pending = pending.filter((i) => i !== old.item)
    fed.forget(key)
  }
}

/**
 * 2026-09-24 — after boot, which files of a pick go ahead. One whose model key is already open
 * or still loading is asked about, one question per file, and dropped silently on Cancel. A
 * file of the same stem as one **already kept from this pick** is not asked about — nothing of
 * it is open yet — and `queue` gives it ` (2)`. A file `validate` refuses — or main refused,
 * 2026-10-09 — is not asked about either: it goes on to its designed error row.
 */
export async function confirmPick(
  files: readonly ChosenFile[],
  isBusy: (key: string) => boolean,
  ask: (name: string) => Promise<boolean>
): Promise<ChosenFile[]> {
  const kept: ChosenFile[] = []
  const keptKeys = new Set<string>()
  for (const f of files) {
    const key = keyOfChosen(f)
    const valid = !rejectOf(f)
    if (valid && !keptKeys.has(key) && isBusy(key) && !(await ask(f.as?.name ?? f.name))) continue
    if (valid) keptKeys.add(key)
    kept.push(f)
  }
  return kept
}

/**
 * Each file's model key: its stem, or — for a second file of the same stem in one pick —
 * ` (2)`, ` (3)`, … whichever is free. The one place a suffix is still given.
 */
export function keysFor(
  files: readonly { name: string; as?: { key: string } }[],
  isBusy: (key: string) => boolean
): string[] {
  const used = new Set<string>()
  return files.map((f) => {
    const stem = f.as?.key ?? modelKeyOf(f.name)
    let key = stem
    for (let n = 2; used.has(key) || (key !== stem && isBusy(key)); n++) key = `${stem} (${n})`
    used.add(key)
    return key
  })
}

const askReplace = (name: string): Promise<boolean> =>
  api()?.confirmReplace(name).catch(() => false) ?? Promise.resolve(false)

/* ────────────────────────────── the queue ────────────────────────────── */

/**
 * `SGVue.dc.html:1152`. Validation copy verbatim; a rejected file gets a row of its own rather
 * than disappearing silently, and the rest start 500 ms apart.
 */
export function queue(files: readonly ChosenFile[]): number {
  let n = 0
  const valid = files.filter((f) => {
    const bad = rejectOf(f)
    if (bad) addError(f.name, bad)
    return !bad
  })
  const keys = keysFor(valid, busy)
  valid.forEach((f, i) => {
    const { mine, prior } = claim(keys[i], f.path)
    const at = n++ * up.STAGGER_MS
    const timer = setTimeout(() => {
      staggered.delete(timer)
      startUpload(f, keys[i], mine, prior)
    }, at)
    staggered.add(timer)
  })
  return n
}

/**
 * `SGVue.dc.html:1167`. 2026-11-08 (project phase 4, D4): `locate`, the id of a project's model no
 * file was admitted for — the row then offers `Locate…`.
 */
export function addError(name: string, msg: string, locate?: string): void {
  useShell.getState().addUpload({
    id: up.uploadId('e'),
    name,
    stage: msg,
    pct: 0,
    error: true,
    dismiss: true,
    ...(locate !== undefined ? { locate } : {})
  })
}

/* ────────────────────────────── one upload ────────────────────────────── */

/** `SGVue.dc.html:1171`. The row appears at once, on `reading file`, at 5 %. */
function startUpload(chosen: ChosenFile, key: string, own: Claim, prior: Promise<void>): void {
  const mine = epoch
  // Superseded while it waited out the stagger: no row, and nothing to wait for but the older.
  if (own.superseded) return void prior.then(own.settle)
  const id = up.uploadId('u')
  own.rowId = id
  useShell.getState().addUpload({
    id,
    name: chosen.name,
    kb: up.kbOf(chosen.size),
    pct: up.START_PCT,
    stage: up.STAGES[0][1]
  })
  const row: Live = { id, real: 0, shown: 0, shownAt: Date.now() + up.FIRST_TICK_MS, ready: false }
  live.set(id, row)
  // `:1177` — the first stage row settles a beat after the upload is queued.
  row.timer = setTimeout(() => tick(id), up.FIRST_TICK_MS)

  void (async () => {
    try {
      const blob = await bytesOf(chosen)
      // An older upload of the same key parses first, and is discarded when it is done.
      await prior
      if (mine !== epoch || own.superseded) return
      const item = await fed.prepare(
        { path: chosen.path, name: chosen.name, blob, key },
        (stage) => {
          const l = live.get(id)
          if (l) l.real = Math.max(l.real, stage)
        }
      )
      if (mine !== epoch) return
      if (own.superseded) return fed.forget(key)
      own.item = item
      pending.push(item)
      // A located file is named as the project named its model (phase 4, D4).
      pendingNames[item.index.modelKey] = chosen.as?.name ?? chosen.name
      if (!chosen.unadmitted) {
        void api()
          ?.addRecent({
            path: chosen.path,
            name: chosen.name,
            size: chosen.size,
            sha256: item.index.sha256
          })
          .then((list) => useShell.getState().setLibrary(libraryOf(list)))
          .catch(() => {
            /* recents are a convenience; a failed write must not fail the load */
          })
      }
      const l = live.get(id)
      if (l) {
        l.real = up.STAGES.length - 1
        l.ready = true
      }
    } catch (err) {
      if (claims.get(key) === own) claims.delete(key)
      if (mine === epoch && !own.superseded) fail(id, err)
    } finally {
      void prior.then(own.settle)
    }
  })()
}

/** The file's bytes: a native drop already has them; anything else streams over the protocol. */
async function bytesOf(chosen: ChosenFile): Promise<Blob> {
  if (chosen.file) return chosen.file
  const bridge = api()
  if (!bridge) throw new Error('no file bridge')
  const { url } = await bridge.fileUrl(chosen.path)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`could not read the file (${response.status})`)
  return response.blob()
}

/**
 * One step of the stage animation. `stageStep` decides; this only schedules the next look.
 */
function tick(id: string): void {
  const l = live.get(id)
  if (!l) return
  const now = Date.now()
  const elapsed = now - l.shownAt
  const next = up.stageStep({ shown: l.shown, real: l.real, elapsedMs: elapsed })
  if (next !== l.shown) {
    l.shown = next
    l.shownAt = now
    useShell.getState().patchUpload(id, { pct: up.STAGES[next][0], stage: up.STAGES[next][1] })
    l.timer = setTimeout(() => tick(id), up.MIN_STAGE_MS)
    return
  }
  // The last stage still owes its minimum before the tick can turn green (`:1191`).
  if (l.ready && l.shown === up.STAGES.length - 1 && elapsed >= up.MIN_STAGE_MS) {
    return finishUpload(id)
  }
  l.timer = setTimeout(() => tick(id), l.shown < l.real ? up.stageWait(elapsed) : 80)
}

/**
 * `SGVue.dc.html:1180`. A finished upload holds its tick for a beat before it joins — and since
 * 2026-09-24 the join starts at once, under the tick, and reveals when both are done.
 */
function finishUpload(id: string): void {
  const l = live.get(id)
  if (l?.timer) clearTimeout(l.timer)
  live.delete(id)
  useShell.getState().patchUpload(id, { pct: 100, stage: 'ready', done: true })
  // The design waits for every row that is not `done`; a rejected row never is, which left
  // a good file parsed and unloaded behind a bad one. Error rows are excluded.
  if (useShell.getState().uploads.some((u) => !u.done && !u.error)) return
  const mine = epoch
  const hold = new Promise((held) => setTimeout(held, up.READY_HOLD_MS))
  // The tick is painted first: putting a large model into the scene holds the main thread for
  // most of a second, and the tick must be on screen for that, not arrive at the end of it.
  void afterPaint().then(() => {
    if (mine === epoch) void join(hold)
  })
}

/**
 * One batch, however many files it took — so the camera is framed once (`boot`, `:1096`).
 * The ticked rows it came from are dropped when the batch is revealed, not before.
 */
async function join(hold: Promise<unknown>): Promise<void> {
  const mine = epoch
  const rows = useShell
    .getState()
    .uploads.filter((u) => u.done)
    .map((u) => u.id)
  const session = pendingSession
  const afterJoin = pendingAfter
  // A session's element ids are numbered by slot, and slots go in batch order: the session's
  // own file order, not the order the parses happened to finish in (refactor pass 2, P5). A
  // project's models take their slots in the project's order the same way.
  const items = session
    ? sessionOrder(pending, (i) => i.file?.path, session.files ?? [])
    : afterJoin
      ? sessionOrder(pending, (i) => i.file?.path, afterJoin.order.map((path, slot) => ({ key: '', path, name: '', sha256: '', slot })))
      : pending
  const names = pendingNames
  pending = []
  pendingNames = {}
  pendingSession = null
  pendingAfter = null
  const dropRows = (): void => {
    if (mine === epoch) for (const id of rows) useShell.getState().dropUpload(id)
  }
  if (!items.length) return dropRows()
  const shell = useShell.getState()
  shell.setInitErr('')
  useShell.setState({ uploadNames: { ...shell.uploadNames, ...names } })
  // Whether a model was on screen before this batch — not after it: a boot commits before the
  // checks below, so reading `booted` in the catch would take a failed boot for one after boot.
  const wasBooted = shell.booted
  try {
    const shown = await fed.addBatch(items, hold).finally(() => {
      // Joined (or refused): the keys are the federation's now, not an upload's.
      for (const [key, c] of claims) if (c.item && items.includes(c.item)) claims.delete(key)
    })
    dropRows()
    // Replaced by a newer pick on the landing page: nothing of this load is shown.
    if (!shown) return
    const after = useShell.getState()
    // `:1107` — the design's own check, in the design's own words.
    if (!after.federation.elements.length) throw new Error('the model contains no geometry')
    if (session) {
      // The hashes are only knowable once the files have been parsed — rehashing 138 MB before
      // the rows appear would be the whole read again. A file whose bytes have changed since
      // the session was saved therefore lands here, and the session cannot be honoured: its
      // hidden ids, its section and its camera describe a building that is no longer this one.
      // The models are unloaded and the landing page says which file changed, which is the
      // designed surface for it and leaves the drop zone right there.
      const changed = verifyHashes(session)
      if (changed) return void discard(changed)
      // Its ids only where they still name the same elements (`restorableIds` has the rule); a
      // payload from before 2026-10-09 is read against the elements that are really here.
      const live = fed.current.byId
      applySession({ ...session, ...restorableIds(session, fed.sessionFiles(), (id) => live.has(id)) })
    }
    // A restore that fails leaves the models on screen, as a session's never unloads them for it.
    if (afterJoin) await afterJoin.then().catch((err: unknown) => console.error('[sgvue] project restore failed —', err))
  } catch (err) {
    // Refactor pass 2, P10: the batch has undone itself (`addBatch`). With a model already on
    // screen that model stays, and the rows say what went wrong — the designed error row, not
    // the landing page over a loaded federation. Only a boot that failed goes back to it.
    if (mine === epoch && wasBooted) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(err)
      for (const id of rows) {
        useShell.getState().patchUpload(id, { pct: 0, stage: message, error: true, dismiss: true, done: false })
      }
      await runFailed(afterJoin)
      return
    }
    dropRows()
    // A boot refused after it committed (no geometry) is still in the scene and the store:
    // unloaded here, so the landing page does not stand over it. 2026-11-11 — unloaded as
    // `discard` does, model by model, never with `resetUnshown`: a model located into a project
    // meanwhile may be prepared in `pending` against this offset, or still streaming, and
    // `resetUnshown` would hand the offset back under it (the next one choosing its own, kilometres
    // off) and cancel the worker under it. `removeModel` keeps the offset while one is on its way.
    if (mine === epoch) for (const m of [...fed.current.models]) await fed.removeModel(m.meta.modelKey)
    bootFailed(err)
    // 2026-11-11 — `then` will not run: whoever queued the batch (a project) is told, so it is not
    // left loading. Not for a load that was replaced or torn down meanwhile.
    if (mine === epoch) await runFailed(afterJoin)
  }
}

/** Unload everything and go back to the landing page with a reason in the designed banner. */
async function discard(message: string): Promise<void> {
  for (const key of [...useShell.getState().loaded]) await fed.removeModel(key)
  useShell.setState({ booted: false, ready: false, initErr: message })
}

/** `SGVue.dc.html:1114`, verbatim, and back to the landing page. */
export function bootFailed(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  console.error(err)
  useShell.setState({
    booted: false,
    ready: false,
    initErr: 'Could not open that model — ' + message + '.'
  })
}

/** A file that would not parse: the designed error row, and the banner if nothing is open. */
function fail(id: string, err: unknown): void {
  const l = live.get(id)
  if (l?.timer) clearTimeout(l.timer)
  live.delete(id)
  const message = err instanceof Error ? err.message : String(err)
  console.error(err)
  useShell.getState().patchUpload(id, { pct: 0, stage: message, error: true, dismiss: true })
  if (!useShell.getState().booted) {
    useShell.getState().setInitErr('Could not open that model — ' + message + '.')
  }
}

/* ────────────────────────────── entry points ────────────────────────────── */

/**
 * 2026-09-24 — on the landing page a new pick replaces whatever is still loading: the rows,
 * the stagger, the parsed models waiting to join, a join waiting out its tick, the parse worker
 * and the banner all go, and only the new pick loads. Called once the pick is known — a
 * cancelled dialog cancels nothing — and with no `await` between it and `queue`, so of two
 * quick picks the later always wins. After boot a pick joins the federation, as designed.
 */
function freshStart(forProject = false): void {
  const demo = demoShown
  if (useShell.getState().booted && !demo) return
  // 2026-11-07 — a fresh start that is not a project's own closes the open project
  // (`model/project.ts`): what loads next is not it.
  if (!forProject) freshStartListener?.()
  disposeUploads()
  fed.resetUnshown()
  if (demo) forgetDemoView()
  useShell.setState({ uploads: [], initErr: '' })
}

/**
 * 2026-11-07 — told of every fresh start that is not a project's own (`model/project.ts`, which
 * imports this module, hands it in): the open project, if any, is closed.
 */
let freshStartListener: (() => void) | null = null
export const onFreshStart = (fn: (() => void) | null): void => {
  freshStartListener = fn
}

/**
 * Refactor pass 2, P9 — the demo building is on screen. It is not the user's model, and a real
 * file joining it would join the demo's federation: the demo's offset, its display unit and its
 * review state, which every link cut from it would carry. So a real pick **replaces** the demo, exactly as a pick on the
 * landing page replaces whatever is still loading (`freshStart`) — no question asked, because
 * nothing of the user's is lost. Set once the demo has joined; cleared by that fresh start.
 */
let demoShown = false

/**
 * What of the demo's review state would still point into the demo once it has gone: storey and
 * model switches by the demo's names, the filter stack, both section planes, the undo history,
 * the measurements and spot coordinates in the demo's scene. The rest — hidden ids, model colours,
 * `active`, the colour-by scheme, the selection — the empty commit in `resetUnshown` has
 * already pruned, and a user preference (theme, grids, shadows) is not the demo's.
 */
function forgetDemoView(): void {
  demoShown = false
  resetHistory()
  useShell.setState({
    storeyVis: {},
    modelVis: {},
    stack: [],
    stepSel: null,
    sections: NO_SECTIONS,
    canUndo: false,
    canRedo: false
  })
  const viewer = getViewer()
  viewer?.setSections({ grid: null, level: null })
  viewer?.clearMeasures()
  viewer?.clearSpots()
}

/**
 * Every pick's last step. On the landing page: a fresh start, then the queue, with no `await`
 * in between. After boot: a native "Replace model?" for each file whose model is already open
 * or loading, then the queue.
 */
async function begin(
  files: readonly ChosenFile[],
  session?: SessionPayload,
  after?: AfterJoin,
  join = false
): Promise<number> {
  // `join` (a located model, phase 4) never starts fresh: it joins what is loading and leaves the
  // landing page's rows — the other missing models and their Locate… — where they are.
  if (join && !useShell.getState().booted) {
    /* nothing to replace: a pick that is not the project's would have closed it */
  } else if (!useShell.getState().booted || demoShown) freshStart(after !== undefined)
  else files = await confirmPick(files, busy, askReplace)
  if (session) pendingSession = session
  const before = pendingAfter
  if (after) pendingAfter = join ? chainAfter(before, after) : after
  // A session whose every file was rejected must not be left waiting for the *next* upload.
  const n = queue(files)
  if (!n) {
    if (session) pendingSession = null
    if (after) pendingAfter = join ? before : null
  }
  return n
}

/**
 * Open dialogs asked for and not yet answered — and, with each, the "Replace model?" question
 * that a pick made in it leads to (`openDialog` counts until its `begin` has returned). The
 * same question reached another way — a drop, a Recent pill, a link — is **not** counted: no
 * Open dialog is up then.
 */
let dialogs = 0

/**
 * 2026-10-02 — whether an Open dialog is up: the user's own, or one the assistant asked for.
 * The dialog is modal to the window, so a person cannot raise two; a tool call could, and
 * `request_user_action` asks this first.
 */
export const openDialogUp = (): boolean => dialogs > 0

/**
 * 2026-11-08 (project phase 4) — another Open dialog of the app's, counted as `openDialog`'s is:
 * a missing model's Locate…, which main shows (`model/project.ts`).
 */
export async function inOpenDialog<T>(ask: () => Promise<T>): Promise<T> {
  dialogs++
  try {
    return await ask()
  } finally {
    dialogs--
  }
}

/**
 * The designed `upload` control and the drop zone, behind Electron's native Open dialog.
 *
 * 2026-10-09 — a file main refused (larger than 600 MB, empty, not an IFC file, ifcXML) comes
 * back with its reason and gets the designed error row, exactly as a drop of it does; it used to
 * be dropped by main and the dialog closed on nothing at all.
 */
export async function openDialog(): Promise<void> {
  dialogs++
  try {
    const { files, refused } = admitResult(await api()?.openDialog())
    const picked = [...files.map(chosenOf), ...refused.map(refusedOf)]
    if (!picked.length) return
    await begin(picked)
  } finally {
    dialogs--
  }
}

/**
 * A native drop. The `File` carries the bytes; `webUtils.getPathForFile` (preload) carries the
 * path, which is what makes the file resumable from a session and worth remembering.
 *
 * That raw path is admitted first — one call per file, so which answer belongs to which drop
 * is known — because the path main gives back is its own `realpath` and a path stored without
 * it cannot be matched against one later: a file dropped through a junction or an 8.3 short
 * name was afterwards refused as moved by its own session and share link. A file main does
 * **not** admit keeps what the drop said and still reaches `queue`, which gives it the
 * designed error row. **Asking is per file and never fatal**: a `File` the preload cannot name
 * — `webUtils.getPathForFile()` answers `''` for one that is not backed by a disk file, such
 * as a mail attachment or something dragged out of a zip view — is not asked about at all,
 * because the contract refuses an empty path, and one refused answer must not lose the drop.
 */
export async function dropFiles(files: readonly File[]): Promise<void> {
  const bridge = api()
  // 2026-11-08 (phase 5, D10) — a `.sgvue` in the drop: the project opens, alone (`projectDrop`).
  const plan = projectDrop(files.map((f) => f.name))
  if (plan) return dropProject(files, plan)
  const chosen: ChosenFile[] = []
  for (const file of files) {
    const raw = bridge?.pathForFile(file) ?? ''
    let one: PickedFile | undefined
    if (raw) {
      try {
        // A file main refuses is judged by `validate` on the drop's own name and size, which
        // gives the same reason (2026-10-09): main's `refused` is not needed here.
        one = admitResult(await bridge?.admitPaths([raw])).files[0]
      } catch {
        /* not admitted: this file keeps what the drop said, and the rest of the drop stands */
      }
    }
    chosen.push(
      one
        ? { ...chosenOf(one), file }
        : { path: raw, name: file.name, size: file.size, file, unadmitted: true }
    )
  }
  if (!chosen.length) return
  await begin(chosen)
}

/**
 * 2026-11-08 (phase 5, plan D10) — a drop with a project file in it. The project's path comes the
 * IFC drop's way — the preload's `webUtils.getPathForFile` — and main opens it as File › Open
 * Project… opens a pick: the unsaved-changes question first, then the file, then each model
 * through `admit()` (`main/projects.ts`). The rest of the drop is not opened, and each file of it
 * gets the designed error row saying why — once main has sent the project (or its refusal), after
 * the project's own fresh start, so that start does not take the rows away; a Cancel in the
 * question, or a second hearing of the same drop while the first is under way, adds none. A
 * dropped project that is not a file on disk names no path, and is its own error row.
 */
async function dropProject(files: readonly File[], plan: ProjectDrop): Promise<void> {
  const bridge = api()
  const project = files[plan.project]
  const path = bridge?.pathForFile(project) ?? ''
  if (!path) return addError(project.name, PROJECT_NOT_ON_DISK)
  let sent = false
  try {
    sent = (await bridge?.openDroppedProject(path)) === true
  } catch {
    /* refused by main's contract: nothing was opened, and nothing is said about the rest */
  }
  if (!sent) return
  for (const { index, reason } of plan.ignored) addError(files[index].name, reason)
}

/**
 * A landing pill, a library row, a recents entry: a path the user has already chosen once.
 * Resolves `false` when main admitted none of them — the banner says so on the landing page,
 * and after boot, where that banner is not on screen, the caller can (2026-10-02).
 *
 * 2026-10-09 — a file main refused for a reason the drop zone gives (it has grown past 600 MB,
 * say) gets the designed error row with that reason, as a drop does, rather than the banner's
 * "no longer where it was"; it counts as answered, so this resolves `true`.
 */
export async function openPaths(paths: readonly string[], session?: SessionPayload): Promise<boolean> {
  const { files, refused } = admitResult(await api()?.admitPaths(paths))
  if (!files.length && !refused.length) {
    useShell
      .getState()
      .setInitErr('That file is no longer where it was. Pick it again to start.')
    return false
  }
  await begin([...files.map(chosenOf), ...refused.map(refusedOf)], session)
  return true
}

/**
 * 2026-10-09 — files main refused while a session or a share link was being checked
 * (`model/session.ts`, `probeFiles`): each gets the designed error row with its reason, through
 * the same `begin` a pick takes.
 */
export async function showRefused(refused: readonly RefusedFile[]): Promise<void> {
  if (refused.length) await begin(refused.map(refusedOf))
}

/**
 * 2026-11-07 — **a project replaces what is open** (`model/project.ts`, plan phase 2): the
 * landing page's fresh start, taken whether or not a model is on screen. Whatever is loading is
 * cancelled, every loaded model leaves the scene, and the review state that would point into the
 * old federation goes with it — the demo's own rule (`forgetDemoView`): storey and model
 * switches, the filter stack, both section planes, the undo history, the markups. The empty
 * commit that follows prunes the rest and puts the landing page back, from which the project's
 * own models then boot.
 */
export function startOver(): void {
  disposeUploads()
  fed.resetUnshown()
  forgetDemoView()
  useShell.setState({ uploads: [], initErr: '' })
}

/**
 * 2026-11-07 — a project's models, after `startOver`: the files main admitted for it, and those
 * it refused with the drop zone's own reason (the designed error row), through the same `begin`
 * every pick takes. `after` restores the project once the batch has joined. Resolves `false`
 * when nothing was queued — no file was admitted — and `after` will then never run.
 *
 * `after` is handed to `begin` **whatever the number of files**: it is what marks this fresh start
 * as the project's own, so it does not close the project it is loading (`onFreshStart`). With no
 * file queued, `begin` drops it again, so it never waits for a later pick's batch.
 */
export async function openProjectFiles(
  files: readonly PickedFile[],
  refused: readonly RefusedFile[],
  after: AfterJoin
): Promise<boolean> {
  await begin([...files.map(chosenOf), ...refused.map(refusedOf)], undefined, after)
  return files.length > 0
}

/**
 * 2026-11-08 (phase 4, plan D4) — a file the user located for a project's missing model, loading
 * **into the open project as that model**: under the model's key and name (`ChosenFile.as`), and
 * never as a fresh start — on the landing page it starts the boot without clearing the other
 * missing models' rows, and while the project's own models still load it joins their batch, its
 * `after` run behind theirs (`chainAfter`). After boot it is a pick like any other: it joins the
 * federation, and "Replace model?" is asked if its key is taken. `after` binds and restores it
 * once it has joined. Resolves `false` when nothing was queued.
 */
export async function locateFile(
  file: PickedFile,
  as: { key: string; name: string },
  after: AfterJoin
): Promise<boolean> {
  // 2026-11-12 — a fresh attempt is not over, also while "Replace model?" is up: cleared before
  // `begin` awaits anything, and marked again only once the pipeline has queued it.
  located.delete(file.path)
  const queued = (await begin([{ ...chosenOf(file), as }], undefined, after, true)) > 0
  if (queued) located.add(file.path)
  return queued
}

/**
 * 2026-10-02 — a recent file the assistant proposed and the user applied (`state/shell.ts`,
 * `applyPending`; the consent gate). The request carries the path the app's own list had for
 * the file; it is looked up again on **main's recents list**, read fresh, and only an entry
 * that is still on it is opened — through `openPaths`, the function a Recent pill's
 * `openLibrary` calls for a real file, so main's `admit()`, the "Replace model?" question for a
 * model that is already open, and the demo's fresh start all apply as they do to the pill.
 *
 * A file path is therefore admitted here by a user act, as everywhere else: the user's click on
 * Apply, for a file the user had opened before. No path ever comes from the model.
 */
export async function openRecent(path: string): Promise<'opening' | 'gone' | 'moved'> {
  const bridge = api()
  const list = (await bridge?.listRecents().catch(() => [])) ?? []
  if (!list.some((r) => r.path === path)) return 'gone'
  return (await openPaths([path])) ? 'opening' : 'moved'
}

const chosenOf = (p: PickedFile): ChosenFile => ({ path: p.path, name: p.name, size: p.size })

/**
 * A landing pill, or "open all N as a federation →".
 *
 * An entry with a `path` is a real file and goes through the whole pipeline; one without is
 * the design's own mock federation, which `#mock` registers as a loader (dev only).
 */
export async function openLibrary(entries: readonly LibraryFile[]): Promise<void> {
  const paths = entries.map((e) => e.path).filter(Boolean) as string[]
  const keys = entries.filter((e) => !e.path).map((e) => e.key)
  if (paths.length) await openPaths(paths)
  if (keys.length) {
    try {
      await fed.addLibraryFiles(keys)
    } catch (err) {
      // The batch has undone itself; the landing page only when nothing was on screen (P10).
      if (useShell.getState().booted) console.error(err)
      else bootFailed(err)
    }
  }
}

/**
 * The landing page's "try the demo building →" (2026-09-24, owner-requested): the design's
 * own four-model federation (`model/demo.ts`), loaded as the dev `#mock` entry loads it — one
 * library batch, framed once.
 *
 * It is a pick like any other on the landing page, so it starts fresh: whatever is still
 * loading is cancelled (`freshStart`). The demo's chunk is fetched after that, and if another
 * pick has started fresh in the meantime the demo gives way to it — the later pick wins, as it
 * does between two files. Nothing is added to the recents.
 */
export async function openDemo(): Promise<void> {
  if (!useShell.getState().booted) freshStart()
  const mine = epoch
  const { DEMO_KEYS, demoLoader } = await import('./demo')
  if (mine !== epoch) return
  fed.setLibraryLoader(demoLoader())
  try {
    await fed.addLibraryFiles(DEMO_KEYS)
    // Joined and on screen, not replaced by a newer pick while it waited: a real pick now
    // replaces it (P9).
    if (mine === epoch && useShell.getState().booted) demoShown = true
  } catch (err) {
    bootFailed(err)
  }
}

/**
 * The recents list as the designed library: same pills, same popover, same "open all N" copy
 * (fidelity contract, allowed deviations). The swatch is the design's own model palette by
 * position, skipping its grey, so two pills never share a colour.
 */
export function libraryOf(
  recents: readonly { path: string; name: string }[]
): { key: string; name: string; file: string; swatch: string; path: string }[] {
  const SWATCH = ['#35C4B6', '#E8A33D', '#E05A6B', '#7B8CF0', '#6BC96B', '#D96BD0']
  return recents.map((r, i) => ({
    key: r.path,
    name: r.name.replace(/\.[^.]+$/, ''),
    file: r.name,
    swatch: SWATCH[i % SWATCH.length],
    path: r.path
  }))
}

/**
 * Cancel everything in flight — the window is going away, or (`freshStart`) a new pick on the
 * landing page replaces it.
 */
export function disposeUploads(): void {
  epoch++
  demoShown = false
  for (const timer of staggered) clearTimeout(timer)
  staggered.clear()
  for (const l of live.values()) if (l.timer) clearTimeout(l.timer)
  live.clear()
  claims.clear()
  pending = []
  pendingNames = {}
  pendingSession = null
  pendingAfter = null
}
