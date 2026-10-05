/**
 * The two things Phase 5 remembers between runs — saved filter sets and viewpoints —
 * with the design's own storage keys (`SGVue.dc.html:1660`, `:1102`).
 *
 * `localStorage`, as the design does, and deliberately so: they carry no paths and are
 * per-building rather than per-session, so they stayed here when Phase 8 put the session and
 * the recents behind the main process (`main/sessions.ts`, which says the same).
 *
 * Every call is wrapped: the design wraps each of its own four in `try {} catch (e) {}`,
 * because a renderer with storage disabled must still run.
 */
import type { FilterSet } from '../../shared/filter-stack'
import type { Viewpoint } from './selectors/views'

/** `SGVue.dc.html:1660`. */
export const FSETS_KEY = 'ifc-viewer:filtersets'

/** `SGVue.dc.html:1102`. One list of viewpoints per building, not per file set. */
export const viewsKeyFor = (building: string): string =>
  'ifc-viewer:viewpoints:' + (building || 'model')

function readArray<T>(key: string): T[] | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(v) ? (v as T[]) : null
  } catch {
    return null
  }
}

function writeArray(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage disabled or full — the design swallows this too */
  }
}

/** `loadFilterSets` (`:1661`). */
export const loadFilterSets = (): FilterSet[] => readArray<FilterSet>(FSETS_KEY) ?? []

/** `persistFilterSets` (`:1662`), minus the `setState` the store does itself. */
export const storeFilterSets = (sets: readonly FilterSet[]): void => writeArray(FSETS_KEY, sets)

/** `boot` (`:1103`). */
export const loadViews = (key: string): Viewpoint[] => readArray<Viewpoint>(key) ?? []

/** `persistViews` (`:1722`), minus the `setState`. */
export const storeViews = (key: string, views: readonly Viewpoint[]): void =>
  writeArray(key, views)
