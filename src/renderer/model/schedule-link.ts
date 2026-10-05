/**
 * The main window's end of the Schedules window's private port — 2026-09-25.
 *
 * Main hands this page one end of a `MessageChannelMain` pair when the Schedules window has
 * loaded (the preload re-posts it into the page as `CH_SCHEDULE_PORT`); an empty post means
 * the window closed. While a port is held, this sends the federation as a schedule snapshot
 * (`schedule/adapter.ts`) and the theme — on connect and whenever either changes — and turns
 * a `select` from the Schedules window into the same `select(ids, zoom)` the element tree
 * calls, so undo, the property card and the viewer behave exactly as for a tree click.
 *
 * Phase 3 (2026-09-25) adds, over the same port:
 *   · `selection` — `selIds`, on connect and on every change, **coalesced to one post per
 *     frame** (a rubber band or a Select-similar can change it many times in one task). A
 *     `setTimeout` backs the frame up: an occluded window gets no frames, and a selection the
 *     table made must still come back to it. `quiet` says the table must not scroll to it —
 *     the change came from the table, or is a re-send.
 *   · `vis` — the manual hidden set and two flags, so the row menu can disable what would do
 *     nothing; coalesced with the selection.
 *   · `colours` — the live colour-by scheme's value → colour map when it is the one the table
 *     asked for, and whether any scheme is live.
 *   · from the table, `act` — the main ContextMenu's own store actions (`select`, `zoomTo`,
 *     `isolate`, `hide`, `show`, `showAll`), so ⌘Z in the main window reverts them — and
 *     `colourBy` / `clearColours`, through `setColorByGroups` / `clearColorBy`, the legend's
 *     own path.
 * Every message is validated with zod here, and every id is admitted against `byId`
 * (`admitIds` / `admitGroups`). The Model field is the sidebar's own model name.
 *
 * 2026-09-28 — the assistant sees and makes schedules, over the same port:
 *   · from the table, `current` — the schedule on screen and the rows it shows, kept here
 *     (`openSchedule()`) after `parseScheduleDef` has read it, and dropped with the port. Not in
 *     the view store, a session or a share link: it is the Schedules window's, and lives exactly
 *     as long. The per-turn view state is built from this alone — no store, no engine run.
 *   · to the table, `define` — a schedule `make_schedule` built (`defineSchedule()`).
 *   · `scheduleStore()` — the federation as the engine's store, for `get_schedule` and
 *     `make_schedule` to run the engine on in this renderer: the adapter's own `snapshotOf`,
 *     indexed by ifcTable's own `StoreBuilder`, built the first time one of them runs and held
 *     (one slot) until the federation changes or the Schedules window closes — released then,
 *     not on the next call.
 *   · to the table, `export` — `export_schedule`'s request (`requestExport()`): the Export
 *     menu's own action runs there, native Save dialog and all; from the table, `exportAck`,
 *     at once, says whether it started. Nothing about the file ever comes back.
 *   · `colourByColumn()` — the heading menu's `colourBy`, which `color_by_schedule_column`
 *     applies through too.
 *
 * 2026-10-02 — parity with the user, phase 4:
 *   · to the table, `manage` — `manage_schedules`' request (`requestManage()`): one of that
 *     window's own actions, by name — undo, redo, a template, a saved setup, Print, Open
 *     schedule file; from the table, `manageAck`, at once, says what became of it. The two
 *     lists (templates, saved setups) come back in it, bounded, and only when asked for.
 *   · **`act` is still the row menu's alone.** It has no scope guard, and nothing the assistant
 *     does goes through it: `schedule:true` (`ai/executors/targets.ts`) resolves the open
 *     schedule's rows to ids in this renderer and acts through the store's own guarded actions.
 *
 * Nothing is built while no Schedules window is open, and the assistant's store only when the
 * assistant asks.
 */
import { CH_SCHEDULE_PORT } from '../../shared/ipc-channels'
import type { ColorByState } from '../../shared/colors'
import type { Federation } from '../../shared/federate'
import { snapshotOf } from '../../schedule/adapter'
import { StoreBuilder, type ModelStore } from '../../schedule/ifc/store'
import {
  admitGroups,
  admitIds,
  FromSchedules,
  type ColourGroup,
  type DEFINE_KINDS,
  type ExportFormat,
  type ExportRefusal,
  type ManageAck,
  type ManageOp,
  type ManageResult
} from '../../schedule/messages'
import { parseScheduleDef, type ScheduleDef } from '../../schedule/schedule/def'
import { modelLabel } from '../state/selectors/models'
import { useShell, type ShellState } from '../state/shell'

/** The schedule the Schedules window shows, and how many rows its table shows. */
export interface OpenSchedule {
  def: ScheduleDef
  rowCount: number
}

let port: MessagePort | null = null
let unsubscribe: (() => void) | null = null

/** Set while a change the table asked for is being applied, so its echo is `quiet`. */
let fromTable = false
/** The column key of a `colourBy` being applied right now: the scheme it makes is the table's. */
let asking: string | null = null
/**
 * The colour-by scheme the table asked for, and the column key it came with. Kept across a
 * reconnect, so a reopened window still finds its column; dropped the moment any other scheme
 * (or none) is live.
 */
let ours: { scheme: ColorByState; key: string } | null = null

/** The schedule the Schedules window last said it shows, read by `parseScheduleDef`. */
let current: OpenSchedule | null = null
/** `make_schedule` waiting for a window it opened to connect. */
const waiters = new Set<() => void>()
/** `export_schedule` waiting for the Schedules window's `exportAck`, and the last request number. */
let exportWait: { n: number; done: (answer: ExportAnswer) => void } | null = null
let exportN = 0
/** `manage_schedules` waiting for its `manageAck`, and the last request number. */
let manageWait: { n: number; done: (answer: ManageAnswer) => void } | null = null
let manageN = 0
/** The assistant's store: one slot, keyed by the federation and the model names it was built with. */
let aiStore: { federation: Federation; labels: string; store: ModelStore; rowIds: number[] } | null = null
/** Watches the federation while the slot is full, to empty it the moment it changes. */
let unwatchStore: (() => void) | null = null

/** What the next coalesced post carries. */
const dirty = { sel: false, vis: false }
/** Whether the queued `selection` may be marked without scrolling the table. */
let quiet = false
let frame = 0
let timer: ReturnType<typeof setTimeout> | undefined

/** Each loaded model's name as the sidebar's MODELS list shows it. */
function labelsOf(s: ShellState): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of s.federation.models) {
    const key = m.meta.modelKey
    out[key] = modelLabel(key, m.meta.fileName, s.library, s.uploadNames[key])
  }
  return out
}
let sentLabels = ''

function sendStore(): void {
  const s = useShell.getState()
  const labels = labelsOf(s)
  sentLabels = JSON.stringify(labels)
  port?.postMessage({ type: 'store', snapshot: snapshotOf(s.federation, labels) })
  // Store rows are per snapshot, so the table's marks are rebuilt from the same selection,
  // re-sent: quiet. After a federation change `commitModels` has also emptied the selection in
  // the same `set`, which queues it as a change (loud) — harmless, there is nothing to scroll to.
  queueSelection(true)
}

function sendTheme(): void {
  port?.postMessage({ type: 'theme', theme: useShell.getState().theme })
}

function sendColours(): void {
  const s = useShell.getState()
  // A scheme a `colourBy` is making right now is the table's, keyed by its column — so the one
  // post the change causes already carries the key.
  if (asking !== null && s.colorBy) ours = { scheme: s.colorBy, key: asking }
  const mine = s.colorBy && ours && s.colorBy === ours.scheme ? ours.key : null
  if (!mine) ours = null
  port?.postMessage({
    type: 'colours',
    live: !!s.colorBy,
    key: mine,
    entries: mine && s.colorBy ? s.colorBy.groups.map((g) => ({ value: g.v, color: g.color })) : []
  })
}

/** Nothing queued: no frame, no timer, nothing dirty. */
function settle(): void {
  if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
  clearTimeout(timer)
  frame = 0
  timer = undefined
}

function flush(): void {
  settle()
  if (!port) return
  const s = useShell.getState()
  if (dirty.sel) port.postMessage({ type: 'selection', ids: [...s.selIds], quiet })
  if (dirty.vis) {
    const hidden = Object.keys(s.hidden)
      .filter((k) => s.hidden[k])
      .map(Number)
    const storeysClean = !Object.values(s.storeyVis).some((v) => v === false)
    port.postMessage({
      type: 'vis',
      hidden,
      total: s.federation.elements.length,
      storeysClean,
      allShown:
        !hidden.length &&
        storeysClean &&
        !Object.values(s.modelVis).some((v) => v === false) &&
        !s.stack.some((x) => x.on)
    })
  }
  dirty.sel = dirty.vis = false
  quiet = false
}

/**
 * Queue the selection. `calm` is said every time: `true` only for a change the table itself
 * made, or a re-send of the selection it already has; anything else (a pick in 3D, the tree,
 * the assistant, the window opening on an existing selection) scrolls the table to it. Within
 * one frame a loud reason wins over a quiet one.
 */
function queueSelection(calm: boolean): void {
  quiet = dirty.sel ? quiet && calm : calm
  dirty.sel = true
  schedule()
}

function queueVis(): void {
  dirty.vis = true
  schedule()
}

/** One post per frame, whatever changed in between. */
function schedule(): void {
  if (frame || timer) return
  if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(flush)
  timer = setTimeout(flush, 100)
}

/**
 * One message from the Schedules window. Anything that fails its schema is ignored; ids are
 * admitted against the federation first. Exported for the unit tests.
 */
export function receive(data: unknown): void {
  const msg = FromSchedules.safeParse(data)
  if (!msg.success) return
  const s = useShell.getState()
  const m = msg.data
  if (m.type === 'current') {
    current = null
    if (m.def) {
      try {
        current = { def: parseScheduleDef(m.def), rowCount: m.rowCount }
      } catch {
        // Not a schedule: nothing is open, as far as the assistant can tell.
      }
    }
    return
  }
  if (m.type === 'exportAck') {
    if (exportWait?.n === m.n) exportWait.done(m.refused ?? 'opened')
    return
  }
  if (m.type === 'manageAck') {
    // The answer to the one request that is waiting, and to no other: an ack with another
    // number — a late one, after its request timed out — is dropped.
    if (manageWait?.n === m.n) {
      const { type: _type, n: _n, ...answer } = m
      manageWait.done(answer)
    }
    return
  }
  if (m.type === 'clearColours') return s.clearColorBy()
  if (m.type === 'colourBy') {
    colourByColumn(m.label, m.key, m.groups)
    return
  }
  if (m.type === 'act' && m.kind === 'showAll') return s.showAll()
  const ids = admitIds(m.ids, s.byId)
  if (!ids) return
  // An act on nothing is refused: `isolate([])` would hide the whole federation — reachable
  // when a model is unloaded between the table's right-click and its next snapshot. A
  // `select` of nothing is a deselect, and stays.
  if (m.type === 'act' && !ids.length) return
  if (m.type === 'select' || m.kind === 'select' || m.kind === 'zoom') {
    const zoom = m.type === 'select' ? m.zoom : m.kind === 'zoom'
    fromTable = true
    try {
      s.select(ids, zoom)
    } finally {
      fromTable = false
    }
    return
  }
  // The right-click menu's own actions (`app/ContextMenu.tsx`), so the main window's ⌘Z
  // reverts them. No 5 % scope guard: that guard is the assistant's, and the menu has none.
  if (m.kind === 'isolate') s.isolate(ids)
  else if (m.kind === 'hide') s.hide(ids)
  else if (m.kind === 'show') s.show(ids)
}

/**
 * A colour-by from a schedule column — the heading menu's `colourBy` and, since 2026-09-28, the
 * assistant's `color_by_schedule_column`, through this one function: the ids admitted against
 * `byId`, then the legend's own `setColorByGroups`, the column key kept so the table draws its
 * swatches. Returns the scheme, or null when nothing was coloured (and the live one is left).
 */
export function colourByColumn(
  label: string,
  key: string,
  groups: readonly ColourGroup[]
): ColorByState | null {
  const s = useShell.getState()
  const admitted = admitGroups(groups, s.byId)
  if (!admitted) return null
  // The subscription posts the new scheme; `asking` tells it the scheme is this column's.
  asking = key
  try {
    return s.setColorByGroups(label, admitted)
  } finally {
    asking = null
  }
}

/** Take a port (or `null`: the window closed). Exported for the unit tests. */
export function connect(next: MessagePort | null): void {
  // An export still waiting for its answer was asked of the page that is going — and so was
  // a request of `manage_schedules`.
  exportWait?.done('closed')
  manageWait?.done({ result: 'closed' })
  unsubscribe?.()
  unsubscribe = null
  settle()
  dirty.sel = dirty.vis = false
  port?.close()
  port = next
  // A new port is a new page: what it shows arrives as its own `current`.
  current = null
  if (!port) {
    releaseScheduleStore()
    return
  }

  port.onmessage = (event: MessageEvent): void => receive(event.data)
  sendTheme()
  sendStore()
  // Loud: a window opening on an existing selection scrolls to it.
  queueSelection(false)
  queueVis()
  sendColours()
  unsubscribe = useShell.subscribe((s, prev) => {
    if (s.theme !== prev.theme) sendTheme()
    if (s.federation !== prev.federation) sendStore()
    else if (
      (s.library !== prev.library || s.uploadNames !== prev.uploadNames) &&
      JSON.stringify(labelsOf(s)) !== sentLabels
    )
      sendStore()
    if (s.selIds !== prev.selIds) queueSelection(fromTable)
    if (
      s.hidden !== prev.hidden ||
      s.storeyVis !== prev.storeyVis ||
      s.modelVis !== prev.modelVis ||
      s.stack !== prev.stack ||
      s.federation !== prev.federation
    )
      queueVis()
    if (s.colorBy !== prev.colorBy) sendColours()
  })
  // Last, so a schedule sent by a waiter lands after the snapshot it is a schedule of.
  for (const w of [...waiters]) w()
}

/* ────────────────────────────── the assistant (2026-09-28) ────────────────────────────── */

/** The schedule the Schedules window shows and its row count, or null when it is closed or shows none. */
export const openSchedule = (): OpenSchedule | null => current

/** A Schedules window is open and joined to this one. */
export const scheduleConnected = (): boolean => port !== null

/** Resolves true once a Schedules window is joined — at once if one is — or false after `ms`. */
export function whenScheduleConnected(ms: number): Promise<boolean> {
  if (port) return Promise.resolve(true)
  return new Promise((resolve) => {
    const done = (ok: boolean): void => {
      clearTimeout(giveUp)
      waiters.delete(ready)
      resolve(ok)
    }
    const ready = (): void => done(true)
    const giveUp = setTimeout(() => done(false), ms)
    waiters.add(ready)
  })
}

/**
 * Show `def` in the Schedules window as its current, unsaved schedule — on its own undo
 * history, with its own toast. Kept here at once as the open schedule, with the row count the
 * caller's own engine run found, so the next turn sees it before the window's echo arrives.
 * False when no window is joined.
 */
export function defineSchedule(
  def: ScheduleDef,
  kind: (typeof DEFINE_KINDS)[number],
  rowCount: number
): boolean {
  if (!port) return false
  port.postMessage({ type: 'define', kind, def })
  current = { def, rowCount }
  return true
}

/**
 * What became of an `export_schedule` request: `opened` — the Export menu's action started and
 * its Save dialog is asked for — or the menu's reason not to (`busy`, `no_schedule`,
 * `nothing_saved`), or `closed` (no window, or it went), or `timeout` (no answer in time).
 */
export type ExportAnswer = 'opened' | ExportRefusal | 'closed' | 'timeout'

/**
 * Ask the Schedules window to run the Export menu's own action for `format`, and resolve with
 * its answer — which it sends at once, not when the dialog closes. One request at a time: a
 * second while the first awaits its answer is `busy` without being sent, so a runaway loop
 * cannot stack dialogs on either side of the port.
 */
export function requestExport(format: ExportFormat, ms: number): Promise<ExportAnswer> {
  if (!port) return Promise.resolve('closed')
  if (exportWait) return Promise.resolve('busy')
  const n = ++exportN
  const sent = port
  return new Promise((resolve) => {
    const done = (answer: ExportAnswer): void => {
      clearTimeout(giveUp)
      if (exportWait?.n === n) exportWait = null
      resolve(answer)
    }
    const giveUp = setTimeout(() => done('timeout'), ms)
    exportWait = { n, done }
    sent.postMessage({ type: 'export', n, format })
  })
}

/**
 * What became of a `manage_schedules` request (2026-10-02): the Schedules window's own answer
 * (`schedule/messages.ts`, `ManageAckMessage` — already validated, field by field), or `closed`
 * (no window, or it went) or `timeout` (no answer in time). `busy` is the window's — one of its
 * dialogs is up — or this side's: another request is still waiting for its answer.
 */
export interface ManageAnswer extends Omit<ManageAck, 'type' | 'n' | 'result'> {
  result: ManageResult | 'closed' | 'timeout'
}

/**
 * Ask the Schedules window to run one of its own actions (`schedule-ui/manage.ts`), and resolve
 * with its answer — which it sends at once, never after a dialog. What is sent is the action's
 * name, at most two names and one flag; `ask` is whether the window may put a question of its
 * own in front of the user for it. One request at a time, as `requestExport` is: a second while
 * the first awaits its answer is `busy` without being sent.
 */
export function requestManage(
  op: ManageOp,
  args: { name?: string; to?: string; ask: boolean },
  ms: number
): Promise<ManageAnswer> {
  if (!port) return Promise.resolve({ result: 'closed' })
  if (manageWait) return Promise.resolve({ result: 'busy' })
  const n = ++manageN
  const sent = port
  return new Promise((resolve) => {
    const done = (answer: ManageAnswer): void => {
      clearTimeout(giveUp)
      if (manageWait?.n === n) manageWait = null
      resolve(answer)
    }
    const giveUp = setTimeout(() => done({ result: 'timeout' }), ms)
    manageWait = { n, done }
    sent.postMessage({
      type: 'manage',
      n,
      // The Schedules window drops a request it gets to too late (`MANAGE_FRESH_MS`).
      at: Date.now(),
      op,
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.to !== undefined ? { to: args.to } : {}),
      ask: args.ask
    })
  })
}

/** The federation as the engine's store, and store row → federation id. */
export function scheduleStore(s: ShellState): { store: ModelStore; rowIds: number[] } {
  const labels = labelsOf(s)
  const key = JSON.stringify(labels)
  if (!aiStore || aiStore.federation !== s.federation || aiStore.labels !== key) {
    const snap = snapshotOf(s.federation, labels)
    const b = new StoreBuilder()
    b.add(snap.cores, snap.cells)
    aiStore = { federation: s.federation, labels: key, store: b.finish(snap.meta), rowIds: snap.rowIds }
    // Its own watch, port or no port: `make_schedule` fills the slot before a window it opens
    // has joined, and one that never joins must not keep a stale federation alive.
    unwatchStore ??= useShell.subscribe((next, prev) => {
      if (next.federation !== prev.federation) releaseScheduleStore()
    })
  }
  return aiStore
}

/** Empty the assistant's store slot and stop watching for it. */
export function releaseScheduleStore(): void {
  aiStore = null
  unwatchStore?.()
  unwatchStore = null
}

/** Tests only: whether the assistant's store slot is full. */
export const scheduleStoreHeld = (): boolean => aiStore !== null

/** Listen for the port. Called once, before the app renders. */
export function installScheduleLink(): void {
  window.addEventListener('message', (event: MessageEvent) => {
    // Only the preload's own re-post: same window, the channel's name as the data.
    if (event.source !== window || event.data !== CH_SCHEDULE_PORT) return
    connect(event.ports[0] ?? null)
  })
}
