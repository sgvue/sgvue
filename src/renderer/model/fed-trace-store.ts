/**
 * The federating indicator's state (2026-11-12, the owner's pick "B"): the shell store's upload
 * rows, fed through `shared/fed-trace.ts`'s step, and the two timers that end a hold and an exit.
 *
 * **Not in the shell store**, like `ai/trace-store.ts`: it is view state of one indicator, never
 * saved in a session, link, viewpoint or project, and no assistant tool reads or writes it.
 *
 * **It costs nothing between loads.** It listens to the shell store only while a component is
 * listening to it (the line in the stage and the caption in the bottom row, mounted with the
 * shell), and a store change it has no use for returns the same state and wakes no one. A timer
 * exists only during a hold (joined 900 ms, failed 1 600 ms) or an exit (220 ms) — never while
 * idle or loading — and there is no frame loop and no interval: the motion is CSS. Nothing here
 * calls the viewer: the 3D frame loop draws on demand and must not be woken by this.
 */
import { fedExpire, fedHoldMs, fedStep, FED_IDLE, type FedTrace } from '../../shared/fed-trace'
import { useShell, type ShellState } from '../state/shell'

let state: FedTrace = FED_IDLE
let timer: ReturnType<typeof setTimeout> | null = null
let unsubscribe: (() => void) | null = null
let seen: { booted: boolean; uploads: ShellState['uploads']; count: number } | null = null
const listeners = new Set<() => void>()

/** `prefers-reduced-motion: reduce` — read when a step is taken, as the design's CSS reads it. */
export const reduced = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export const fedTraceState = (): FedTrace => state

function stopTimer(): void {
  if (timer !== null) clearTimeout(timer)
  timer = null
}

function commit(next: FedTrace): void {
  if (next === state) return
  const phaseChanged = next.phase !== state.phase
  state = next
  if (phaseChanged) {
    stopTimer()
    const ms = fedHoldMs(state)
    if (ms !== null) {
      timer = setTimeout(() => {
        timer = null
        commit(fedExpire(state, reduced()))
      }, ms)
    }
  }
  for (const fn of [...listeners]) fn()
}

/** One store change: only the three things the step reads, and only when one of them changed. */
function feed(st: ShellState): void {
  const count = st.federation.elements.length
  if (seen && seen.booted === st.booted && seen.uploads === st.uploads && seen.count === count) return
  seen = { booted: st.booted, uploads: st.uploads, count }
  commit(fedStep(state, { booted: st.booted, uploads: st.uploads, elementCount: count }, reduced()))
}

/**
 * Hear every change; returns the way to stop hearing (`useSyncExternalStore`'s shape). The first
 * listener starts listening to the shell store; the last one to leave stops it and clears all.
 */
export function onFedTrace(fn: () => void): () => void {
  listeners.add(fn)
  if (!unsubscribe) {
    unsubscribe = useShell.subscribe(feed)
    feed(useShell.getState())
  }
  return () => {
    listeners.delete(fn)
    if (listeners.size || !unsubscribe) return
    unsubscribe()
    unsubscribe = null
    stopTimer()
    seen = null
    state = FED_IDLE
  }
}
