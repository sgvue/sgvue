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
import { MAP_SHIFT_METRES, coordsFromGeoref, crsChip, mapMisplaced, mapShift } from '../../../shared/georef'
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
 * `georef` is the store's `georefSource` (2026-11-07: the loaded model `georefSourceOf` picks,
 * whatever the load order), whose base point the four fields are. Until 2026-10-08 the fields
 * could be typed into, and the caption had to stop naming the file the moment they stopped being
 * its numbers; the card is read-only since then, so only the method is asked.
 */
export function coordsCaption(georef: Georeference | null): string {
  const method = georef?.method ?? 'none'
  return method === 'none' ? '' : ` · ${method}`
}

/**
 * Whose the base point is, for the assistant's `get_view_state` (2026-10-02): `file` when the
 * georeferencing the card shows (`georefSource`) states one — the only place it comes from since
 * 2026-10-08, when the Coordinate-system card became read-only — and `none` when it states none.
 * (`user`, for numbers typed into the card or applied from a reply, cannot happen any more.)
 */
export function basePointSource(georefSource: Georeference | null): 'file' | 'none' {
  return coordsFromGeoref(georefSource) ? 'file' : 'none'
}

/* ───────────────── the Coordinate-system card's note (2026-10-08, owner-chosen) ───────────────── */

/** A model's name as the note prints it: file text, through `labelText`, and clipped there. */
export const LINE_UP_NAME_CHARS = 120

/**
 * One loaded model whose own map position is not where it is drawn (2026-11-07). The scene is
 * every file's own world coordinates, origin to origin, so a file whose georeferencing would
 * move it — an `IfcMapConversion` over a site at the file's zero, a `WorldCoordinateSystem` that
 * is its map position, a turned conversion — stands where its coordinates put it, and that is not
 * its place on the map: every map readout over it is its file coordinates, and a neighbour whose
 * map position *is* its coordinates does not line up with it.
 */
export interface NotLinedUp {
  /** The model's key. */
  key: string
  /**
   * Its file's name as the sidebar's model row shows it under the model's name (`modelFile`:
   * the picked file's, else the library's, else the index's) — file text, so through `labelText`.
   */
  name: string
  /** How far its map position moves the centre of what it draws, in metres. */
  metres: number
  /** How far its map position turns it, in degrees, 0 to 180. */
  degrees: number
}

/**
 * The loaded models whose map position is not where they are drawn — the fact the
 * Coordinate-system card's note says and `get_model_info` / `get_view_state` report. Per model,
 * on its own: its file's map operation (`shared/georef.ts`'s `mapPlacement`) applied to the
 * centre of what it drew (`drawnCentre`), against that centre, past a metre or a tenth of a
 * degree (`mapMisplaced`). It does not depend on the other models or their order, and it holds
 * with one model loaded too, since its map readouts are then its file coordinates. A model that
 * drew nothing has nowhere to be misplaced.
 *
 * Until 2026-11-07 the federation was assembled in the boot model's map space and this said
 * which models could not be put there (no map position while another had one, or more than 5 km
 * from the offset); both reasons went with it.
 */
export function notLinedUp(
  s: Pick<ShellState, 'library' | 'uploadNames'> & {
    federation: Pick<ShellState['federation'], 'models'>
  }
): NotLinedUp[] {
  const out: NotLinedUp[] = []
  for (const { meta } of s.federation.models) {
    if (!meta.drawnCentre) continue
    const shift = mapShift(meta.georef, meta.drawnCentre)
    if (!mapMisplaced(shift)) continue
    const file = modelFile(meta.modelKey, meta.fileName, s.library, s.uploadNames[meta.modelKey])
    const name = labelText(file || meta.modelKey, LINE_UP_NAME_CHARS)
    out.push({ key: meta.modelKey, name, ...shift })
  }
  return out
}

/** A displacement as the note says it: kilometres to a tenth from a kilometre, else metres to a tenth. */
export const distanceText = (metres: number): string =>
  metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${metres.toFixed(1)} m`

/** A turn as the note says it, to a tenth of a degree. */
const turnText = (degrees: number): string => `${degrees.toFixed(1)}°`

/** One model's half of the note: how far, else how much turned. */
const shiftText = (m: NotLinedUp): string =>
  m.metres > MAP_SHIFT_METRES ? distanceText(m.metres) : `turned ${turnText(m.degrees)}`

/**
 * The note's one line — `''` when there is nothing to say, and then the card draws nothing:
 *
 *   `Tower B.ifc's map position is 12.3 km from where its file places it — ask for a Shared Coordinates export.`
 *   `Tower B.ifc's map position is turned 30.0° from how its file places it — ask for a Shared Coordinates export.`
 *   `2 models' map positions are not where their files place them: Tower B.ifc (12.3 km), STR.ifc (turned 30.0°) — ask for Shared Coordinates exports.`
 *
 * The distance is said whenever it is past a metre — a turn about the file's origin moves the
 * building too, so a turn alone is said only for a model that it leaves within a metre.
 */
export function lineUpNote(issues: readonly NotLinedUp[]): string {
  if (!issues.length) return ''
  if (issues.length === 1) {
    const [one] = issues
    return one.metres > MAP_SHIFT_METRES
      ? `${one.name}'s map position is ${distanceText(one.metres)} from where its file places it — ask for a Shared Coordinates export.`
      : `${one.name}'s map position is turned ${turnText(one.degrees)} from how its file places it — ask for a Shared Coordinates export.`
  }
  const each = issues.map((m) => `${m.name} (${shiftText(m)})`)
  return `${issues.length} models' map positions are not where their files place them: ${each.join(', ')} — ask for Shared Coordinates exports.`
}

export type StatusState = Pick<
  ShellState,
  'stats' | 'visibleCount' | 'federation' | 'units' | 'georefSource'
>

export function statusValues(s: StatusState): StatusValues {
  return {
    backend: s.stats.backend,
    fps: s.stats.fps,
    visibleCount: s.visibleCount,
    total: s.federation.elements.length,
    units: s.units,
    crs: crsChip(s.georefSource).short
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
