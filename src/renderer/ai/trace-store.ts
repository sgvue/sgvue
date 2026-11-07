/**
 * The live thinking trace — one turn's timeline, the clock it is stamped with, and whoever is
 * listening (2026-10-01, the owner's "Ask Vee" handoff). `ai/trace.ts` is the arithmetic and
 * `ai/trace-facts.ts` the facts; this is the little state between them and the view.
 *
 * **It is not in the shell store on purpose.** A turn delivers a handful of events, and the view
 * that draws them repaints sixty times a second from a clock; neither is something every
 * `ShellState` consumer should hear about. `ai/bridge.ts` feeds the events in where it already
 * handles the turn, `app/ChatPanel.tsx` subscribes, and what a finished reply needs to keep —
 * its status and its rows — leaves here as a `ChatTrace` and is stored on the `ChatMessage`.
 *
 * **The clock is injectable.** Every event is stamped with `traceNow()`, and the view asks the
 * same function what time it is. The dev harness can pin it (`window.__sgvueDev.trace.pin`,
 * behind `DEVTOOLS`): a pinned clock stands still, so a capture or a check can put the turn at
 * any instant — and step it through one — with the same result on every run.
 *
 * **2026-11-07 — it is mirrored in the Ask Vee window.** The chat panel moved into a window of its
 * own (`main/vee-window.ts`); the turn still runs here, so the trace is fed here, and every
 * change this store makes is handed to `onTraceChange` listeners — `model/vee-link.ts`, which
 * posts it over the window's port. That window's own copy of this module takes each change
 * through `traceMirror`, folding the same events through the same `traceReduce`, so its panel
 * draws the turn on its own frame loop exactly as this window's panel did. Each page's clock
 * starts at its own load, so the times are moved by the difference between the two starts on
 * the wall clock (`traceEpoch`, `shiftChange`).
 */
import type { Federation } from '../../shared/federate'
import { wordCount } from './blocks'
import { traceReduce, traceSummary, type Timeline, type TraceEvent } from './trace'
import { readFacts, toolFacts, type ChatTrace } from './trace-facts'

/** What the view reads. A new object whenever any of it changes. */
export interface TraceState {
  /** The turn's timeline: while it runs, and after it is answered until the next turn begins. */
  timeline: Timeline | null
  /** The place its reply has, or will have, in the transcript. */
  index: number
  /** The pinned time, or `null` while the clock runs. */
  pinned: number | null
}

let state: TraceState = { timeline: null, index: -1, pinned: null }
const listeners = new Set<() => void>()

const set = (patch: Partial<TraceState>): void => {
  state = { ...state, ...patch }
  for (const fn of [...listeners]) fn()
}

/** The trace's time, in seconds: the pinned one, else the page's own clock. */
export const traceNow = (): number => state.pinned ?? performance.now() / 1000

export const traceState = (): TraceState => state

/** Hear every change; returns the way to stop hearing. (`useSyncExternalStore`'s shape.) */
export function onTrace(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** One change this store made: an event folded in (with the reply's place, for `begin`), or a pin. */
export type TraceChange =
  | { kind: 'sync'; timeline: Timeline | null; index: number; pinned: number | null }
  | { kind: 'event'; ev: TraceEvent; index?: number }
  | { kind: 'pin'; T: number | null }

const taps = new Set<(change: TraceChange) => void>()

/** Hear every change as it is made — for a mirror in another window. Returns the way to stop. */
export function onTraceChange(fn: (change: TraceChange) => void): () => void {
  taps.add(fn)
  return () => {
    taps.delete(fn)
  }
}

const tell = (change: TraceChange): void => {
  for (const fn of [...taps]) fn(change)
}

const feed = (ev: TraceEvent): void => {
  const timeline = traceReduce(state.timeline, ev)
  if (timeline !== state.timeline) set({ timeline })
  tell({ kind: 'event', ev })
}

/** Send: a turn begins. `index` is the place its reply will take in the transcript. */
export function traceBegin(federation: Federation, index: number): void {
  const ev: TraceEvent = { type: 'begin', at: traceNow(), read: readFacts(federation) }
  set({ timeline: traceReduce(null, ev), index })
  tell({ kind: 'event', ev, index })
}

/** The turn's model started a tool call — its name is known, its arguments are not yet. */
export const traceToolStart = (): void => feed({ type: 'tool_start', at: traceNow() })

/**
 * A tool is being executed. `input` is the executor's own, after `resolveNames`, so a property
 * is spelled as the file spells it; the facts are worked out here, once, against the federation
 * as it stands.
 */
export function traceToolExec(
  name: string,
  input: Readonly<Record<string, unknown>>,
  federation: Federation
): void {
  // Nothing to add to a turn that is not running — and no reason to walk the elements for it.
  if (!state.timeline || state.timeline.answer !== null) return
  feed({ type: 'tool_exec', at: traceNow(), facts: toolFacts(name, input, federation) })
}

/**
 * `done`: the answer is here. Returns what the reply keeps of its trace — or `null` when there
 * was no turn to answer.
 */
export function traceDone(reply: string, table: boolean): ChatTrace | null {
  if (!state.timeline || state.timeline.answer !== null) return null
  feed({ type: 'done', at: traceNow(), words: wordCount(reply), table })
  return state.timeline ? traceSummary(state.timeline) : null
}

/** The turn failed or was stopped: its live reply and its trace go away. */
export const traceFail = (): void => feed({ type: 'fail' })

/**
 * Dev harness only: hold the clock at `T` seconds — every event is then stamped `T`, and the
 * view draws the turn as it stands at `T` — or let it run again with `null`.
 *
 * Released, the clock is the page's own again, which knows nothing of the times a harness
 * pinned: a turn stamped with times of the harness's choosing is then drawn at whatever the
 * page's clock happens to say. A harness that pins a turn to its own times ends that turn (or
 * the window) before it lets the clock go; one that pins relative to the turn's own Send —
 * `scripts/lib/parity-states.cjs` — can release at any time.
 */
export function pinTrace(T: number | null): void {
  if (T === state.pinned) return
  set({ pinned: T })
  tell({ kind: 'pin', T })
}

/* ────────────────────────────── the mirror (2026-11-07) ────────────────────────────── */

/** The whole state as one change — what a window that joins is sent first. */
export const traceSnapshot = (): TraceChange => ({ kind: 'sync', ...state })

/**
 * Seconds from this page's trace clock to the wall clock both windows share: each page's
 * `performance.now()` counts from its own load (`performance.timeOrigin`).
 */
export const traceEpoch = (): number =>
  typeof performance === 'undefined' ? 0 : performance.timeOrigin / 1000

/** A change with every time it holds moved by `dt` seconds. */
export function shiftChange(change: TraceChange, dt: number): TraceChange {
  const by = (t: number | null): number | null => (t === null ? null : t + dt)
  if (change.kind === 'pin') return { kind: 'pin', T: by(change.T) }
  if (change.kind === 'event') {
    const ev = change.ev
    return ev.type === 'fail' ? change : { ...change, ev: { ...ev, at: ev.at + dt } }
  }
  const tl = change.timeline
  return {
    kind: 'sync',
    index: change.index,
    pinned: by(change.pinned),
    timeline: tl && {
      ...tl,
      send: tl.send + dt,
      tool: by(tl.tool),
      answer: by(tl.answer),
      calls: tl.calls.map((c) => ({ ...c, at: c.at + dt }))
    }
  }
}

/**
 * The Ask Vee window: take one change the main window's store made, already on this page's
 * clock. An event goes through the same `traceReduce`, so the two timelines are the same.
 */
export function traceMirror(change: TraceChange): void {
  if (change.kind === 'sync') {
    set({ timeline: change.timeline, index: change.index, pinned: change.pinned })
    return
  }
  if (change.kind === 'pin') {
    if (change.T !== state.pinned) set({ pinned: change.T })
    return
  }
  const timeline = traceReduce(state.timeline, change.ev)
  if (timeline !== state.timeline || change.index !== undefined) {
    set({ timeline, ...(change.index !== undefined ? { index: change.index } : {}) })
  }
}
