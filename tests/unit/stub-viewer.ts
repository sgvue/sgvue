/**
 * Shared test helpers — not a test on its own (the name does not end in `.test.ts`).
 *
 * - `stubViewer(overrides)` — a `Viewer` for store tests. Every method the test does not name
 *   is a no-op returning `undefined`, and `batch(fn)` runs `fn`, as the real one does; the
 *   methods a test records or answers with are passed in as `overrides`. `then` and symbol keys
 *   read `undefined`, so the stub is never mistaken for a promise or an iterable, and so do the
 *   Viewer's non-method members (`backend`, `bbox`, `dev`) unless a test passes them.
 * - `memoryStorage()` — an in-memory `localStorage`, so persistence can be asserted.
 * - `resetShell()` — the store back to its first state, and the undo stacks with it.
 */
import { resetHistory, useShell } from '../../src/renderer/state/shell'
import type { Viewer } from '../../src/renderer/viewer/viewer-core'

/** The Viewer members that are values, not methods: a no-op function would lie about them. */
const NOT_METHODS = new Set(['then', 'backend', 'bbox', 'dev'])

export function stubViewer(overrides: Record<string, unknown> = {}): Viewer {
  const known: Record<string, unknown> = { batch: (fn: () => void) => fn(), ...overrides }
  return new Proxy(known, {
    get(target, key) {
      if (typeof key === 'string' && key in target) return target[key]
      if (typeof key === 'symbol' || NOT_METHODS.has(key)) return undefined
      return () => undefined
    }
  }) as unknown as Viewer
}

/** A memory `localStorage`, so the persistence round-trips can be asserted. */
export function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    }
  } as Storage
}

/** Captured when this module is first imported — before any test has touched the store. */
const INITIAL = useShell.getState()

export function resetShell(): void {
  useShell.setState(INITIAL, true)
  resetHistory()
}
