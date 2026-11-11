/**
 * The federating indicator's arithmetic — 2026-11-12, owner-requested (*"create a new simple yet
 * cool techy loading animation when model view is federating the new upload model."*), the
 * owner's pick of three: **"B" · Edge trace** — a 2 px line of five segments along the top of the
 * 3D stage and a caption chip in the bottom row's centre zone (`app/FedTrace.tsx`).
 *
 * It shows only what the app really knows, and all of it is read off the shell store's upload
 * rows (`ShellState.uploads`, written by `model/upload-pipeline.ts`, which this does not touch):
 * which rows are in flight, the stage each row **shows** (`STAGES`, the design's words), whether
 * a row left done (joined), turned into an error row (failed) or left while still loading
 * (cancelled), and how many elements the federation grew by over the batch. Never a percentage,
 * never a count while parsing.
 *
 * **Only a load into an open viewer.** A row is tracked only if it is first seen while `booted`
 * is true and is not an error row at first sight; every other row is remembered as ignored for
 * as long as it stays. So the landing page's first load — whose ticked rows stay until the
 * reveal, after `booted` turns true — and a refused file's error row never start it.
 *
 * Pure: a step from (previous state, a snapshot of the store) to the next, the time each phase
 * holds, what a hold ends in, and what is drawn. `model/fed-trace-store.ts` feeds it and owns
 * the two timers; nothing here knows about time or the DOM.
 */
import { thin } from './fmt'
import { STAGES } from './upload'

export type FedPhase = 'idle' | 'loading' | 'joined' | 'failed' | 'leaving'

/** The fields of an upload row this reads (`UploadRow`, `state/shell.ts`). */
export interface FedRow {
  id: string
  name: string
  stage: string
  done?: boolean
  error?: boolean
}

export interface FedSnapshot {
  booted: boolean
  uploads: readonly FedRow[]
  /** The federation's element count. */
  elementCount: number
}

/** What became of one tracked row: in flight (`flight`, or `ready` — done, waiting to join). */
type Fate = 'flight' | 'ready' | 'joined' | 'failed' | 'gone'

export interface FedTrace {
  phase: FedPhase
  /** What is drawn — while `leaving`, what was drawn before the exit began. */
  shows: 'loading' | 'joined' | 'failed'
  /** Counts the batches; a new one is a new indicator (the components are keyed by it). */
  batch: number
  /** This batch's tracked rows, by id. */
  rows: Readonly<Record<string, Fate>>
  /** Rows seen and not tracked, while they stay in the list. */
  ignored: readonly string[]
  /** The element count when the batch started. */
  base: number
  /** The stage shown (0 … 4): the furthest-behind row's; at a failure, the last one shown. */
  stage: number
  /** The one row's file name, or `N models`. */
  name: string
  /** At the end of the batch: elements added, rows joined, rows failed. */
  added: number
  joined: number
  failed: number
}

/* ────────────────────────────── copy and timings ────────────────────────────── */

/** The joined state's hold, the failed state's, and the exit (the renderer's 220 ms fade). */
export const FED_JOINED_HOLD_MS = 900
export const FED_FAILED_HOLD_MS = 1600
export const FED_EXIT_MS = 220

export const FED_FAILED = 'could not open — see Models'
export const FED_JOINED = 'joined'
export const fedModels = (n: number): string => `${n} models`
/** Grouped with thin spaces (`thin`), as the approved prototype showed it: `+4 082 elements`. */
export const fedAdded = (n: number): string => `+${thin(n)} ${n === 1 ? 'element' : 'elements'}`
export const fedCouldNot = (n: number): string => `${n} could not open`

/* ────────────────────────────── the step ────────────────────────────── */

export const FED_IDLE: FedTrace = {
  phase: 'idle',
  shows: 'loading',
  batch: 0,
  rows: {},
  ignored: [],
  base: 0,
  stage: 0,
  name: '',
  added: 0,
  joined: 0,
  failed: 0
}

const LAST = STAGES.length - 1

/** The stage a row shows, 0 … 4: done (`ready`) is the last, `federating`. */
function stageOf(row: FedRow): number {
  if (row.done) return LAST
  const i = STAGES.findIndex(([, text]) => text === row.stage)
  return i < 0 ? 0 : i
}

/** A cancel, or a batch that ended with nothing joined and nothing failed. */
const out = (t: FedTrace, reduced: boolean): FedTrace =>
  reduced ? idleFrom(t) : { ...t, phase: 'leaving' }

/** Back to idle, keeping what must outlive a batch: the ignored rows and the batch count. */
const idleFrom = (t: FedTrace): FedTrace => ({ ...FED_IDLE, batch: t.batch, ignored: t.ignored })

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i])

function sameRows(a: Readonly<Record<string, Fate>>, b: Readonly<Record<string, Fate>>): boolean {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k])
}

/**
 * The next state for a snapshot of the store. Returns `prev` itself when nothing it draws or
 * remembers changed, so an unrelated store change re-renders nothing.
 */
export function fedStep(prev: FedTrace, snap: FedSnapshot, reduced = false): FedTrace {
  const present = new Map(snap.uploads.map((u) => [u.id, u]))
  const ignored = prev.ignored.filter((id) => present.has(id))
  const fresh: FedRow[] = []
  for (const u of snap.uploads) {
    if (u.id in prev.rows || ignored.includes(u.id)) continue
    if (snap.booted && !u.error) fresh.push(u)
    else ignored.push(u.id)
  }

  let t: FedTrace = { ...prev, ignored }
  if (fresh.length && prev.phase !== 'loading') {
    // A new batch — from idle, or dropping a hold or an exit at once. The old batch's rows that
    // are still listed (its error rows) are no longer this indicator's.
    for (const id of Object.keys(prev.rows)) if (present.has(id)) ignored.push(id)
    t = { ...FED_IDLE, ignored, phase: 'loading', batch: prev.batch + 1, base: snap.elementCount }
  }
  if (t.phase !== 'loading') {
    return sameList(ignored, prev.ignored) ? prev : t
  }
  if (!snap.booted) return out({ ...t, rows: {} }, reduced)

  const rows: Record<string, Fate> = { ...t.rows }
  for (const u of fresh) rows[u.id] = 'flight'
  for (const [id, fate] of Object.entries(rows)) {
    if (fate !== 'flight' && fate !== 'ready') continue
    const u = present.get(id)
    rows[id] = u ? (u.error ? 'failed' : u.done ? 'ready' : 'flight') : fate === 'ready' ? 'joined' : 'gone'
  }
  const flying = snap.uploads.filter((u) => rows[u.id] === 'flight' || rows[u.id] === 'ready')

  let next: FedTrace
  if (flying.length) {
    next = {
      ...t,
      rows,
      stage: Math.min(...flying.map(stageOf)),
      name: flying.length === 1 ? flying[0].name : fedModels(flying.length)
    }
  } else {
    const fates = Object.values(rows)
    const joined = fates.filter((f) => f === 'joined').length
    const failed = fates.filter((f) => f === 'failed').length
    const ended: FedTrace = { ...t, rows, joined, failed, added: snap.elementCount - t.base }
    if (joined) next = { ...ended, phase: 'joined', shows: 'joined' }
    else if (failed) next = { ...ended, phase: 'failed', shows: 'failed' }
    else return out(ended, reduced)
  }
  const same =
    next.phase === prev.phase &&
    next.batch === prev.batch &&
    next.stage === prev.stage &&
    next.name === prev.name &&
    sameRows(next.rows, prev.rows) &&
    sameList(next.ignored, prev.ignored)
  return same ? prev : next
}

/** How long a phase holds before `fedExpire`, or `null` for one that waits on the store. */
export function fedHoldMs(t: FedTrace): number | null {
  switch (t.phase) {
    case 'joined':
      return FED_JOINED_HOLD_MS
    case 'failed':
      return FED_FAILED_HOLD_MS
    case 'leaving':
      return FED_EXIT_MS
    case 'idle':
    case 'loading':
      return null
  }
}

/** The end of a hold: the exit, and after it idle; under reduced motion no exit. */
export function fedExpire(t: FedTrace, reduced = false): FedTrace {
  if (t.phase === 'leaving' || reduced) return idleFrom(t)
  if (t.phase === 'joined' || t.phase === 'failed') return { ...t, phase: 'leaving' }
  return t
}

/* ────────────────────────────── what is drawn ────────────────────────────── */

export type FedSegment = 'pending' | 'current' | 'done' | 'ok' | 'warn'

export type FedCaptionView =
  | { kind: 'loading'; name: string; stage: string; step: string }
  | { kind: 'joined'; added: string; failed: string | null }
  | { kind: 'failed'; text: string }

export interface FedView {
  batch: number
  leaving: boolean
  segments: FedSegment[]
  /** The segment that carries the glint, or −1: only the current one, only while it runs. */
  glint: number
  caption: FedCaptionView
}

/** What the line and the caption draw, or `null` — nothing at all — while idle. */
export function fedView(t: FedTrace, reduced = false): FedView | null {
  if (t.phase === 'idle') return null
  const leaving = t.phase === 'leaving'
  const segs = (at: FedSegment): FedSegment[] =>
    STAGES.map((_, i) => (i < t.stage ? 'done' : i === t.stage ? at : 'pending'))
  switch (t.shows) {
    case 'loading':
      return {
        batch: t.batch,
        leaving,
        segments: segs('current'),
        glint: leaving || reduced ? -1 : t.stage,
        caption: {
          kind: 'loading',
          name: t.name,
          stage: STAGES[t.stage][1],
          step: `${t.stage + 1}/${STAGES.length}`
        }
      }
    case 'joined':
      return {
        batch: t.batch,
        leaving,
        segments: STAGES.map(() => 'ok'),
        glint: -1,
        caption: {
          kind: 'joined',
          added: t.added > 0 ? fedAdded(t.added) : FED_JOINED,
          failed: t.failed ? fedCouldNot(t.failed) : null
        }
      }
    case 'failed':
      return {
        batch: t.batch,
        leaving,
        segments: segs('warn'),
        glint: -1,
        caption: { kind: 'failed', text: FED_FAILED }
      }
  }
}
