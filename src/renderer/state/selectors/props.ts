/**
 * The property card's derived values — `SGVue.dc.html:1834–1873` and `:1985–1990`, as pure
 * functions so the ordering, the prettifier, the dedupe and the formatting can be tested
 * without a DOM.
 *
 * The design builds these inside `renderVals()` with the click handlers attached; here the
 * data is separated from the handlers, exactly as `selectors/tree.ts` already does. Nothing
 * about the result changes.
 *
 * Two places where the design's own arithmetic cannot be copied literally, both for the
 * fidelity contract's "never a placeholder":
 *
 * · The **Centroid** row. The prototype's `coords` is a typed-in base point
 *   (`{ E: 28500, N: 30200, Z: 102.5, angle: 12.5 }`, `:849`), so it always prints a map
 *   coordinate. Here `coords` is filled from `IfcMapConversion` / `IfcSite` and is `null` when
 *   the file is not georeferenced — and then the row shows the design's own em dash.
 * · The box is read from the renderer, which works in **scene** coordinates (the federation
 *   offset already subtracted — `shared/geometry-contract.types.ts`). Every row here reports
 *   the element in the file's own coordinates, so the offset is added back. `Bounding box`,
 *   `Footprint` and `Box volume` are differences and are unaffected either way.
 */
import { DASH, fixed2, fixed3, fmtV } from '../../../shared/fmt'
import type { FederatedElement, Federation } from '../../../shared/federate'
import { toMap } from '../../../shared/georef'
import { areaIn, areaUnit, coordIn, formatLength, volumeIn, volumeUnit } from '../../../shared/units'
import type { CoordState, Units } from '../shell'

/* ────────────────────────────── shapes ────────────────────────────── */

export interface PsetRow {
  k: string
  v: string
  /** `border-top` of the row: a hairline on every row but the first. `:1871`. */
  top: string
}

export type PsetKindBadge = 'SGPset' | 'Pset' | 'Qto'

export interface PsetBox {
  name: string
  kind: PsetKindBadge
  /** SGPset → Pset → Qto, then alphabetical by full name. `:1866`, `:1873`. */
  rank: number
  short: string
  badgeFg: string
  badgeBg: string
  badgeLine: string
  rows: PsetRow[]
}

/** One containment chip; `sep` is the `›` that follows it. `:1857`. */
export interface PathChip {
  v: string
  sep: boolean
}

/** A "Related" row. The design closes over `pick`; the component binds `ids`. `:1859`. */
export interface RelRow {
  k: string
  v: string
  ids: number[]
}

export interface GeoRow {
  k: string
  v: string
}

/** The minimum of a `three` `Box3` this module needs, so the selector stays DOM-free. */
export interface BoxLike {
  min: { x: number; y: number; z: number }
  max: { x: number; y: number; z: number }
}

export type Vec3 = readonly [number, number, number]

/** `sel` in the design: the element, spread, plus everything the card derives. `:1854`. */
export interface SelectionCard {
  id: number
  name: string
  type: string
  predefinedType: string
  objectType: string
  storey: string
  guid: string
  tag: string
  model: string
  material: string
  path: PathChip[]
  psets: PsetBox[]
  psetCount: number
  noPsets: boolean
  relRows: RelRow[]
  geoRows: GeoRow[]
}

/* ────────────────────────────── pieces ────────────────────────────── */

/** `Pset_WallCommon` → `Wall Common`: strip the prefix, split camelCase. `:1867`. */
export const prettyName = (name: string): string =>
  name.replace(/^(SGPset_|Pset_|Qto_)/, '').replace(/([a-z])([A-Z])/g, '$1 $2')

/** `GrossSideArea` → `Gross Side Area`. The same split, without a prefix. `:1871`. */
export const prettyKey = (key: string): string => key.replace(/([a-z])([A-Z])/g, '$1 $2')

/** Which badge a set name earns. `:1865`. */
export const badgeKind = (name: string): PsetKindBadge =>
  name.startsWith('SGPset_') ? 'SGPset' : name.startsWith('Qto_') ? 'Qto' : 'Pset'

/**
 * `psets` then `qto`, each set as one bordered box, sorted SGPset → Pset → Qto and then
 * alphabetically. `:1863–1873`.
 *
 * A type-level (inherited) set is shown like any other — the card has no badge for it, and
 * inventing one would be a visible addition (fidelity contract §"No visible additions").
 */
export function psetBoxes(element: FederatedElement): PsetBox[] {
  return [...Object.entries(element.psets), ...Object.entries(element.qto)]
    .map(([name, p]) => {
      const kind = badgeKind(name)
      return {
        name,
        kind,
        rank: kind === 'SGPset' ? 0 : kind === 'Pset' ? 1 : 2,
        short: prettyName(name),
        badgeFg:
          kind === 'SGPset' ? 'var(--sel-ink)' : kind === 'Qto' ? 'var(--muted)' : 'var(--step-ink)',
        badgeBg: kind === 'SGPset' ? 'var(--sel-bg)' : 'var(--step-bg)',
        badgeLine: kind === 'SGPset' ? 'var(--accent)' : 'var(--border)',
        rows: Object.entries(p).map(([k, v], i) => ({
          k: prettyKey(k),
          v: fmtV(v),
          top: i ? '1px solid var(--border)' : 'none'
        }))
      }
    })
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
}

/**
 * `Project › Site › Building › Storey`, with falsy parts dropped and duplicates removed
 * **globally** — first occurrence wins, not just adjacent (BUILD_PLAN Phase 3.2). `›` renders
 * only between items, which is what `sep` says. `:1855–1857`.
 */
export function pathChips(federation: Federation, storey: string): PathChip[] {
  const p = federation.project
  return [p.name, p.site, p.building, storey]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .map((v, i, a) => ({ v, sep: i < a.length - 1 }))
}

/** "Same ObjectType" / "Same PredefinedType", with their counts and their matches. `:1852–1861`. */
export function relRows(
  elements: readonly FederatedElement[],
  element: FederatedElement
): RelRow[] {
  const sameType = elements.filter((e) => e.objectType === element.objectType)
  const samePdt = elements.filter(
    (e) => (e.predefinedType || '') === (element.predefinedType || '')
  )
  return [
    { k: 'Same ObjectType', v: sameType.length.toLocaleString('en-US'), ids: sameType.map((e) => e.id) },
    { k: 'Same PredefinedType', v: samePdt.length.toLocaleString('en-US'), ids: samePdt.map((e) => e.id) }
  ]
}

/**
 * The six geometry rows. `:1839–1851`.
 *
 * `box` is in scene coordinates and `offset` puts it back into the file's own; `coords` is the
 * project base point read from the file, or `null` fields where the file states none.
 *
 * 2026-10-09: every row the app computes follows the display unit (`shared/units.ts`) — the
 * box's size and its base / top as lengths, the footprint and the box volume in m² / m³ or
 * ft² / ft³, the centroid as a coordinate. `mm` is what the rows always printed.
 */
export function geoRows(
  box: BoxLike | null,
  solids: number,
  coords: CoordState,
  offset: Vec3,
  units: Units = 'mm'
): GeoRow[] {
  if (!box) return []
  const [ox, oy, oz] = offset
  const mn = { x: box.min.x + ox, y: box.min.y + oy, z: box.min.z + oz }
  const mx = { x: box.max.x + ox, y: box.max.y + oy, z: box.max.z + oz }
  const sz = { x: mx.x - mn.x, y: mx.y - mn.y, z: mx.z - mn.z }
  const c = { x: (mn.x + mx.x) / 2, y: (mn.y + mx.y) / 2, z: (mn.z + mx.z) / 2 }
  // `shared/georef.ts`'s `toMap` is the design's own L409 expression, shared with the spot
  // coordinate labels so the two readouts cannot drift. `IfcMapConversion.XAxisAbscissa` /
  // `XAxisOrdinate` are optional; a file that omits them states no rotation, so the angle is
  // 0 — never defaulted when the file does state one.
  const map = toMap(coords, c.x, c.y, c.z)
  const len = (v: number): string => formatLength(v, units)
  const xyz = (v: number): string => fixed3(coordIn(v, units))
  return [
    { k: 'Bounding box', v: `${len(sz.x)} × ${len(sz.y)} × ${len(sz.z)}` },
    { k: 'Footprint', v: fixed2(areaIn(sz.x * sz.y, units)) + ' ' + areaUnit(units) },
    { k: 'Box volume', v: fixed3(volumeIn(sz.x * sz.y * sz.z, units)) + ' ' + volumeUnit(units) },
    { k: 'Base / top', v: `${len(mn.z)} → ${len(mx.z)}` },
    {
      k: 'Centroid',
      v: map ? `${xyz(map.E)} E · ${xyz(map.N)} N · ${xyz(map.Z)} Z` : DASH
    },
    { k: 'Geometry', v: `${solids} solid${solids === 1 ? '' : 's'}` }
  ]
}

/* ────────────────────────────── the card ────────────────────────────── */

export interface SelectionInput {
  federation: Federation
  /** The last element clicked — the design's `selEl` (`:1834`). */
  element: FederatedElement | null
  /** `viewer.elementBox(id)`, scene coordinates. `null` before geometry has landed. */
  box: BoxLike | null
  solids: number
  coords: CoordState
  offset: Vec3
  /** The display unit the geometry rows are written in (2026-10-09); `mm` when not given. */
  units?: Units
}

/** The design's `sel` object, or `null` when nothing is selected. `:1854–1873`. */
export function selectionCard(input: SelectionInput): SelectionCard | null {
  const { federation, element } = input
  if (!element) return null
  const psets = psetBoxes(element)
  return {
    id: element.id,
    name: element.name,
    type: element.type,
    predefinedType: element.predefinedType,
    objectType: element.objectType,
    storey: element.storey,
    guid: element.guid,
    tag: element.tag,
    model: element.model,
    material: element.material,
    path: pathChips(federation, element.storey),
    psets,
    // `psetCount` counts *sets*, not boxes — the same number, stated the design's way. `:1985`.
    psetCount: Object.keys(element.psets).length + Object.keys(element.qto).length,
    noPsets: psets.length === 0,
    relRows: relRows(federation.elements, element),
    geoRows: geoRows(input.box, input.solids, input.coords, input.offset, input.units)
  }
}

/**
 * The native `title` of a text the card clips with an ellipsis (2026-10-01, owner-requested):
 * the whole text — or none at all for a blank and for the em dash a missing value shows,
 * because a tooltip on a placeholder would be one more placeholder.
 */
export const fullText = (text: string): string | undefined =>
  text && text !== DASH ? text : undefined

/** `Properties`, or `3 selected · showing last`. `:1989`. */
export const selTitle = (selCount: number): string =>
  selCount > 1 ? `${selCount} selected · showing last` : 'Properties'

/** The `dims` button's three colours. `:1976`. */
export const dimBtn = (
  dims: boolean
): { fg: string; bg: string; line: string } => ({
  fg: dims ? 'var(--sel-ink)' : 'var(--muted)',
  bg: dims ? 'var(--sel-bg)' : 'transparent',
  line: dims ? 'var(--accent)' : 'var(--border)'
})

/**
 * The pre-fill `Ask about this` writes into the composer. `:1650–1655`. Exported so the text
 * is testable without the panel, which is Phase 9.
 */
export function askAboutText(elements: readonly FederatedElement[]): string {
  const one = elements[0]
  const ref =
    elements.length === 1
      ? `${one.name} (${one.type}, ${one.objectType || DASH}, ${one.storey})`
      : `${elements.length} selected elements (${[...new Set(elements.map((e) => e.type))].join(', ')})`
  return `About ${ref}: `
}
