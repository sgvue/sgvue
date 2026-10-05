/**
 * Toolbar active states, the view segmented control, the project header line, the status bar
 * and the action bar above it — `SGVue.dc.html:1924`, `:1951`, `:1960–1963`, `:2009`, and the
 * status bar's own markup at `:705–715`.
 *
 * 2026-10-01: there are two section planes, so the toolbar's Section button is lit while the
 * card is open or **either** plane is set.
 */
import { filterIsLive } from '../../../shared/filter-stack'
import { coordsFromGeoref, crsChip, sameBasePoint } from '../../../shared/georef'
import type { Georeference } from '../../../shared/model-index.types'
import type { CoordState, ShellState } from '../shell'

export interface OnOff {
  bg: string
  fg: string
}

/** `SGVue.dc.html:1784`. The one accent/plain pair every toolbar control uses. */
export const on = (b: boolean): OnOff => ({
  bg: b ? 'var(--sel-bg)' : 'transparent',
  fg: b ? 'var(--sel-ink)' : 'var(--muted)'
})

export interface ToolbarFlags {
  select: OnOff
  measure: OnOff
  spot: OnOff
  snap: OnOff
  section: OnOff
  filter: OnOff
  coords: OnOff
  grids: OnOff
  levels: OnOff
  views: OnOff
  shadows: OnOff
  groundGrid: OnOff
}

export type ToolbarState = Pick<
  ShellState,
  'tool' | 'snap' | 'card' | 'sections' | 'grids' | 'levels' | 'shadows' | 'groundGrid' | 'stack'
>

/** `SGVue.dc.html:1951` (`tb`). */
export function toolbarFlags(s: ToolbarState): ToolbarFlags {
  return {
    select: on(s.tool === 'select'),
    measure: on(s.tool === 'measure'),
    spot: on(s.tool === 'spot'),
    snap: on(s.snap),
    // The design's `on(s.card === 'section' || !!s.section.kind)`, over both planes since
    // 2026-10-01: lit while the card is open or either plane is set.
    section: on(s.card === 'section' || !!s.sections.grid.name || !!s.sections.level.name),
    // The design writes `on(s.card === 'filter' || s.filterOn)` (`:1951`). `filterOn` is one of
    // the undeclared keys plan §3.5 defect 8 drops — nothing ever set it, so the prototype's
    // button only ever lit for the open card. The intent is plain from the pairing one control
    // over, `section: on(s.card === 'section' || !!s.section.kind)`: a live filter should light
    // the button the same way a live section does. `filterIsLive` is that right-hand side.
    filter: on(s.card === 'filter' || filterIsLive(s.stack)),
    coords: on(s.card === 'coords'),
    grids: on(s.grids),
    levels: on(s.levels),
    views: on(s.card === 'views'),
    shadows: on(s.shadows),
    groundGrid: on(s.groundGrid)
  }
}

export const VIEW_NAMES = ['iso', 'top', 'north', 'south', 'east', 'west'] as const
export type ViewName = (typeof VIEW_NAMES)[number]

/** `SGVue.dc.html:1960` (`vw`). */
export function viewFlags(view: string | null): Record<ViewName, OnOff> {
  return {
    iso: on(view === 'iso'),
    top: on(view === 'top'),
    north: on(view === 'north'),
    south: on(view === 'south'),
    east: on(view === 'east'),
    west: on(view === 'west')
  }
}

export interface StatusValues {
  backend: string
  fps: number
  visibleCount: number
  total: number
  /** The design hard-codes `mm`; plan §3.5 item 4 says respect `units`. */
  units: string
  /**
   * The design hard-codes `SVY21` (`SGVue.dc.html:710`). `shared/georef.ts` states the data
   * rule: the file's projected CRS when it declares one, the design's chip when that CRS is
   * SVY21 / EPSG:3414 or the user has typed a base point this session, and the em dash when
   * there is neither.
   */
  crs: string
}

/**
 * Whether the base point in state came from the user rather than from a file. The first model
 * to carry georeferencing fills `coords` (`federation-store.ts`), and a federation that carries
 * none leaves every field `null` until the Coordinate-system card is typed into — so a value
 * with no file behind it is the user's own.
 */
export const hasManualCoords = (
  coords: CoordState,
  federation: ShellState['federation']
): boolean =>
  (coords.E != null || coords.N != null || coords.Z != null || coords.angle != null) &&
  !federation.models.some((m) => m.meta.georef.source !== 'none')

/**
 * The Coordinate-system card's caption suffix — the one visible addition in the port, the
 * user's own request (2026-09-20, *"auto detect which way the model is using and show it"*):
 * ` · ` and the detected georeferencing method, appended to the design's `project base point`.
 * `''` when the file carries no georeferencing, and `''` again the moment the four fields
 * stop showing what the file said — the caption names where *these numbers* came from, so it
 * must not keep claiming the file once they are the user's own. When it is not empty the
 * card's row gains `flex-wrap:wrap`.
 */
export function coordsCaption(georef: Georeference | null, coords: CoordState): string {
  const fromFile = coordsFromGeoref(georef)
  const method = georef?.method ?? 'none'
  return method !== 'none' && !!fromFile && sameBasePoint(fromFile, coords) ? ` · ${method}` : ''
}

/**
 * Whose the base point is (2026-10-02 — the assistant reads it back, and may ask to change it):
 * `file` while the four fields are exactly what the federation's georeferencing states — the
 * caption's own test, on the model the Coordinate-system card reads — `none` while every field
 * is blank, and `user` otherwise: somebody has typed into the card, or applied a change to it.
 */
export function basePointSource(
  coords: CoordState,
  federation: ShellState['federation']
): 'file' | 'user' | 'none' {
  if (coords.E == null && coords.N == null && coords.Z == null && coords.angle == null) return 'none'
  const georef = federation.models.find((m) => m.meta.georef.source !== 'none')?.meta.georef
  const fromFile = coordsFromGeoref(georef ?? null)
  return fromFile && sameBasePoint(fromFile, coords) ? 'file' : 'user'
}

export type StatusState = Pick<
  ShellState,
  'stats' | 'visibleCount' | 'federation' | 'units' | 'coords'
>

export function statusValues(s: StatusState): StatusValues {
  const georef = s.federation.models.find((m) => m.meta.georef.source !== 'none')?.meta.georef
  return {
    backend: s.stats.backend,
    fps: s.stats.fps,
    visibleCount: s.visibleCount,
    total: s.federation.elements.length,
    units: s.units,
    crs: crsChip(georef ?? null, hasManualCoords(s.coords, s.federation)).short
  }
}

export type ActionBarState = Pick<
  ShellState,
  'canUndo' | 'canRedo' | 'measureCount' | 'spotCount'
>

/**
 * Whether the action bar is drawn (2026-10-01, owner-requested). It holds what the design
 * appended to the status bar (`SGVue.dc.html:711–714`) — undo, redo and the two markup counts
 * with their `clear` — so it exists exactly while one of those does, and the stage reserves its
 * lane (`selectors/lanes.ts`, `--abar`) for exactly as long.
 */
export const hasActionBar = (s: ActionBarState): boolean =>
  s.canUndo || s.canRedo || s.measureCount > 0 || s.spotCount > 0

export interface ProjectHeader {
  name: string
  file: string
  schema: string
}

/**
 * The IfcProject button's three lines. `SGVue.dc.html:1924`: the meta line is
 * `{n} models · {joined file names}`, and the design's `'Sample Block'` fallback is the
 * design tool's placeholder for an unbooted shell — unreachable at runtime, because the
 * landing page covers `!booted`.
 */
export function projectHeader(s: Pick<ShellState, 'federation' | 'loaded'>): ProjectHeader {
  const p = s.federation.project
  const n = s.loaded.length
  return {
    name: p.name,
    file: n ? `${n} model${n === 1 ? '' : 's'} · ${p.file}` : '',
    schema: p.schema
  }
}

/** `SGVue.dc.html:1949`. */
export const treeTitle = (treeMode: 'entity' | 'type'): string =>
  treeMode === 'entity' ? 'Elements by Entity' : 'Elements by PredefinedType'

/**
 * `SGVue.dc.html:1945`, with one copy change (2026-09-24, owner-requested): with the toggle off
 * and no model colour picked, everything is coloured by its IFC class, and the hint says so
 * instead of the design's "Overrides on — no model colour set yet".
 */
export function matHint(nativeMats: boolean, modelColors: Record<string, string>): string {
  if (nativeMats) return 'Surface colours as authored in the IFC files'
  return Object.keys(modelColors).length
    ? 'Showing per-model colour overrides'
    : 'Coloured by IFC class'
}

/** `SGVue.dc.html:1946` (`nat`). */
export function nativeToggle(nativeMats: boolean): {
  track: string
  line: string
  knob: string
  x: number
} {
  return {
    track: nativeMats ? 'var(--accent)' : 'var(--step-bg)',
    line: nativeMats ? 'var(--accent)' : 'var(--border-strong)',
    knob: nativeMats ? 'var(--card)' : 'var(--faint)',
    x: nativeMats ? 14 : 0
  }
}

/** `SGVue.dc.html:1941` (`projBtn`). */
export function projectButton(active: boolean): { fg: string; bg: string; line: string } {
  return {
    fg: active ? 'var(--sel-ink)' : 'var(--muted)',
    bg: active ? 'var(--sel-bg)' : 'transparent',
    line: active ? 'var(--accent)' : 'transparent'
  }
}

/* ───────────────────────── the canvas's text alternative (Phase 10) ───────────────────────── */

export type SceneState = Pick<
  ShellState,
  'federation' | 'visibleCount' | 'selIds' | 'byId' | 'loaded'
>

/**
 * What a screen reader is told the 3D canvas contains — `BUILD_PLAN.md` §3 Phase 9, "the 3D
 * canvas needs a described alternative for the model contents".
 *
 * It renders nothing: `App.tsx` puts it in an `.sr-only` node the canvas points at with
 * `aria-describedby`. Every number in it is one the designed surfaces already show — the
 * project header's name and model count (`:1924`), the tree's visible / total (`:1959`), the
 * storey ladder's length — so the description can never disagree with the window.
 */
export function sceneSummary(s: SceneState): string {
  const n = s.loaded.length
  if (!n) return 'A 3D view. No model is open.'
  const total = s.federation.elements.length
  const num = (v: number): string => v.toLocaleString('en-US')
  const parts = [
    `${num(n)} model${n === 1 ? '' : 's'}`,
    `${num(total)} element${total === 1 ? '' : 's'}`,
    `${num(s.federation.storeys.length)} storey${s.federation.storeys.length === 1 ? '' : 's'}`
  ]
  const sel = s.selIds.length
  const selected =
    sel === 1
      ? ` ${s.byId.get(s.selIds[0])?.name ?? 'One element'} is selected.`
      : sel > 1
        ? ` ${num(sel)} elements are selected.`
        : ''
  return (
    `A 3D view of ${s.federation.project.name}: ${parts.join(', ')}. ` +
    `${num(s.visibleCount)} of ${num(total)} visible.${selected}`
  )
}
