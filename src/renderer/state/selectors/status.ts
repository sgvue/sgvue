/**
 * Toolbar active states, the view segmented control, the project header line, the status bar
 * and the action bar above it — `SGVue.dc.html:1924`, `:1951`, `:1960–1963`, `:2009`, and the
 * status bar's own markup at `:705–715`.
 *
 * 2026-10-01: there are two section planes, so the toolbar's Section button is lit while the
 * card is open or **either** plane is set.
 */
import { filterIsLive } from '../../../shared/filter-stack'
import { labelText } from '../../../shared/fmt'
import { coordsFromGeoref, crsChip, mapPlacement } from '../../../shared/georef'
import type { Georeference } from '../../../shared/model-index.types'
import type { ShellState } from '../shell'
import { modelFile } from './models'

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
   * rule: the projected CRS the boot file declares, the design's chip when that CRS is SVY21 /
   * EPSG:3414, and the em dash when it declares none.
   */
  crs: string
}

/**
 * The Coordinate-system card's caption suffix — the one visible addition in the port, the
 * user's own request (2026-09-20, *"auto detect which way the model is using and show it"*):
 * ` · ` and the detected georeferencing method, appended to the design's `project base point`.
 * `''` when the file carries no georeferencing. When it is not empty the card's row gains
 * `flex-wrap:wrap`.
 *
 * `georef` is the store's `bootGeoref`: the declaration that defined the federation's frame,
 * whose base point the four fields are. Until 2026-10-08 the fields could be typed into, and the
 * caption had to stop naming the file the moment they stopped being its numbers; the card is
 * read-only since then, so the fields are always the file's and only the method is asked.
 */
export function coordsCaption(georef: Georeference | null): string {
  const method = georef?.method ?? 'none'
  return method === 'none' ? '' : ` · ${method}`
}

/**
 * Whose the base point is, for the assistant's `get_view_state` (2026-10-02): `file` when the
 * declaration that defined the federation's frame states one — the only place it comes from since
 * 2026-10-08, when the Coordinate-system card became read-only — and `none` when it states none.
 * (`user`, for numbers typed into the card or applied from a reply, cannot happen any more.)
 */
export function basePointSource(bootGeoref: Georeference | null): 'file' | 'none' {
  return coordsFromGeoref(bootGeoref) ? 'file' : 'none'
}

/* ───────────────── the Coordinate-system card's note (2026-10-08, owner-chosen) ───────────────── */

/** A model's name as the note prints it: file text, through `labelText`, and clipped there. */
export const LINE_UP_NAME_CHARS = 120

/** One loaded model that could not be lined up with the others, and why. */
export interface NotLinedUp {
  /** The model's key. */
  key: string
  /**
   * Its file's name as the sidebar's model row shows it under the model's name (`modelFile`:
   * the picked file's, else the library's, else the index's) — file text, so through `labelText`.
   */
  name: string
  /**
   * `no map position` — its file states none (`placedBy` is `none`) while another loaded model's
   * does; `far` — the geometry stream's `farPlacement`: it lands more than 5 km from the
   * federation offset another model set.
   */
  reason: 'no map position' | 'far'
  /** For `far`: how far it stands, in metres. */
  metres?: number
}

/**
 * Which loaded models could not be lined up, and why — the fact the Coordinate-system card's note
 * says and `get_model_info` / `get_view_state` report (2026-10-08). Asked for by the owner: of the
 * ways offered to say so, *"One-line note on screen"*.
 *
 * Nothing to say with one model loaded: lining up is about the others. Then, per model:
 *
 *  · **no map position** — its own declaration places it nowhere (`mapPlacement`'s `none`) while
 *    another loaded model's does. Its world coordinates were taken as map coordinates, which for
 *    a genuinely local file is the wrong place. This reason wins over `far`, which follows from it.
 *  · **far** — its geometry landed more than `FAR_PLACEMENT_METRES` from the federation offset
 *    (`ModelIndexMeta.farPlacementMetres`, the stream's own warning): a map position in another
 *    unit, a doubled offset, a datum from another survey.
 *
 * **When the boot model is the one without a map position**, the scene's origin is that model's
 * own, and every model that does have one lands kilometres from it: it is the boot model that is
 * named, and no distance is — a model that stands where its own map position puts it is not
 * the one that could not be lined up. `bootGeoref` is the declaration that defined the frame, so
 * this holds after the boot model is unloaded too.
 */
export function notLinedUp(
  s: Pick<ShellState, 'bootGeoref' | 'library' | 'uploadNames'> & {
    federation: Pick<ShellState['federation'], 'models'>
  }
): NotLinedUp[] {
  const models = s.federation.models
  if (models.length < 2) return []
  const placed = (g: Georeference | null): boolean => mapPlacement(g).placedBy !== 'none'
  const somePlaced = models.some((m) => placed(m.meta.georef))
  const frameUnplaced = somePlaced && !placed(s.bootGeoref)
  const out: NotLinedUp[] = []
  for (const { meta } of models) {
    const file = modelFile(meta.modelKey, meta.fileName, s.library, s.uploadNames[meta.modelKey])
    const name = labelText(file || meta.modelKey, LINE_UP_NAME_CHARS)
    if (somePlaced && !placed(meta.georef)) {
      out.push({ key: meta.modelKey, name, reason: 'no map position' })
    } else if (!frameUnplaced && meta.farPlacementMetres != null) {
      out.push({ key: meta.modelKey, name, reason: 'far', metres: meta.farPlacementMetres })
    }
  }
  return out
}

/** A distance as the note says it: kilometres, to a tenth. */
const km = (metres: number): string => (metres / 1000).toFixed(1)

/**
 * The note's one line — `''` when there is nothing to say, and then the card draws nothing:
 *
 *   `Tower B.ifc could not be lined up — it has no map position.`
 *   `STR.ifc could not be lined up — it sits 12.3 km from the others.`
 *   `2 models could not be lined up: Tower B.ifc (no map position), STR.ifc (12.3 km away).`
 */
export function lineUpNote(issues: readonly NotLinedUp[]): string {
  if (!issues.length) return ''
  if (issues.length === 1) {
    const [one] = issues
    return one.reason === 'far'
      ? `${one.name} could not be lined up — it sits ${km(one.metres ?? 0)} km from the others.`
      : `${one.name} could not be lined up — it has no map position.`
  }
  const each = issues.map((m) =>
    m.reason === 'far' ? `${m.name} (${km(m.metres ?? 0)} km away)` : `${m.name} (no map position)`
  )
  return `${issues.length} models could not be lined up: ${each.join(', ')}.`
}

export type StatusState = Pick<
  ShellState,
  'stats' | 'visibleCount' | 'federation' | 'units' | 'bootGeoref'
>

export function statusValues(s: StatusState): StatusValues {
  return {
    backend: s.stats.backend,
    fps: s.stats.fps,
    visibleCount: s.visibleCount,
    total: s.federation.elements.length,
    units: s.units,
    crs: crsChip(s.bootGeoref).short
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
