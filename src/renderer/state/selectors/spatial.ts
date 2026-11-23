/**
 * The Spatial-structure card — `SGVue.dc.html:1747–1781` (`spatial()`), as a pure function.
 *
 * **2026-11-23 — the card compares the models** (`docs/DEVIATIONS.md`; the owner's approved
 * prototype, `prototype/project-card/`). The design's card lists one `IfcProject` per file and then
 * the site and building of the *first* model, labelled "shared". Now every loaded model has a
 * column of its own, and every row — every attribute of `IfcProject`, the spatial-root `IfcSite`
 * and its `IfcBuilding`, their property sets, and the file's own lines — is read from that model's
 * own file. A value the file does not carry is the design's em dash (`p.site || '—'`, `:1765`),
 * never a placeholder: no manufactured GlobalId, no `CompositionType: ELEMENT` by default, no
 * building name borrowed from the project.
 *
 * The difference rule is the prototype's (HANDOFF.md, "Difference rule"): a row differs when its
 * values are not all identical, the em dash counting as a value; the cells marked are those off
 * the most common value, the leftmost winning a tie; identity rows — the three GlobalIds, File and
 * Elements — never count; a row equal across every model prints once (`merged`). With one model
 * nothing is compared.
 */
import { DASH, fmtV, group, group3 } from '../../../shared/fmt'
import type { Federation } from '../../../shared/federate'
import { coordsFromGeoref, crsChip } from '../../../shared/georef'
import type { ModelIndexMeta, PropValue, Units } from '../../../shared/model-index.types'
import { coordIn, coordUnit, formatLength, type DisplayUnit } from '../../../shared/units'
import type { LibraryFile } from '../shell'
import { libraryEntry, modelLabel, pathOf, rowSwatch, type ModelFiles } from './models'

/** What the design prints when a value is absent (`SGVue.dc.html:1765`). */
export { DASH }

/** One model's column: its MODELS row's swatch and label, and its file as the hover title. */
export interface SpatialColumn {
  key: string
  label: string
  file: string
  swatch: string
}

/** One attribute or property, a cell per model. */
export interface SpatialRow {
  kind: 'row'
  k: string
  /** One per column; `DASH` where that model's file does not carry the value. */
  cells: string[]
  /** GlobalId, File, Elements: expected to differ, so never compared, merged or marked. */
  ident: boolean
  /** A GlobalId — printed muted and never wrapped. */
  gid: boolean
  /** Not identical across the models (multi-model, non-identity rows only). */
  diff: boolean
  /** Per cell: off the most common value, so tinted. */
  off: boolean[]
  /** Identical across two or more models: printed once across the model columns. */
  merged: boolean
}

/** A property-set heading. */
export interface SpatialSet {
  kind: 'set'
  name: string
  /** Per column: whether that model carries the set. */
  has: boolean[]
  /** One of its rows differs. */
  diff: boolean
}

export type SpatialLine = SpatialRow | SpatialSet

export interface SpatialGroup {
  type: 'IfcProject' | 'IfcSite' | 'IfcBuilding' | 'File'
  /** The one-model heading's right-hand name: the model, the site, the building, the file. */
  name: string
  lines: SpatialLine[]
  /** One of its rows differs. */
  diff: boolean
}

export interface SpatialTable {
  columns: SpatialColumn[]
  groups: SpatialGroup[]
  /** How many rows differ — the "differences only" count. */
  diffs: number
}

export interface SpatialInput {
  federation: Federation
  library: readonly LibraryFile[]
  /**
   * Each loaded model's file, by model key (`sessionFiles()`): how a real file finds its library
   * entry, which is keyed by its path (`libraryEntry`). Absent, only the design's own entries —
   * keyed by model key — are found.
   */
  files?: ModelFiles
  uploadNames: Record<string, string>
  /** The MODELS rows' colour overrides, so a column's swatch is its row's. */
  modelColors?: Record<string, string>
  /** 2026-11-07 (plan D12) — colours given to models added to an open project; the MODELS row's. */
  assigned?: Record<string, string>
  /**
   * The display unit (2026-10-09): heights and positions are coordinates — metres, or decimal
   * feet in `ft` — and the height to the top storey an elevation, in feet and inches in `ft`.
   */
  units?: DisplayUnit
}

/** `MILLI.METRE · SQUARE_METRE · CUBIC_METRE` from the file's own `IfcUnitAssignment`. */
export function unitsLine(units: Units): string {
  const one = (t: string): string => {
    const u = units.byType[t]
    if (!u) return ''
    return u.prefix ? `${u.prefix}.${u.name}` : u.name
  }
  const parts = [one('LENGTHUNIT'), one('AREAUNIT'), one('VOLUMEUNIT')].filter(Boolean)
  return parts.length ? parts.join(' · ') : DASH
}

const or = (v: string | undefined | null): string => (v ? v : DASH)

/**
 * An `IfcCompoundPlaneAngleMeasure` as written — degrees, minutes, seconds and, when authored,
 * millionths of a second — as `12° 34′ 56.789000″ N`. Every component carries the sign, so the
 * hemisphere is the sign's: S or W for a negative one.
 */
export function dms(angle: readonly number[] | undefined, pos: 'N' | 'E', neg: 'S' | 'W'): string {
  if (!angle?.length) return DASH
  let [d = 0, m = 0, s = 0] = angle.map((v) => Math.abs(v))
  const raw = angle.length > 3 ? Math.abs(angle[3]) : undefined
  let micro = raw === undefined ? 0 : Math.round(raw)
  // Millionths that round up to a whole second carry, and so on up: never `3.1000000″`.
  if (micro >= 1e6) [s, micro] = [s + Math.floor(micro / 1e6), micro % 1e6]
  if (s >= 60) [m, s] = [m + Math.floor(s / 60), s % 60]
  if (m >= 60) [d, m] = [d + Math.floor(m / 60), m % 60]
  const sec = raw === undefined ? `${s}` : `${s}.${String(micro).padStart(6, '0')}`
  return `${d}° ${m}′ ${sec}″ ${angle.some((v) => v < 0) ? neg : pos}`
}

/** The most common value is the reference (ties: leftmost); a cell is off when it is not that. */
function compare(cells: readonly string[]): { diff: boolean; off: boolean[] } {
  const count = new Map<string, number>()
  for (const v of cells) count.set(v, (count.get(v) ?? 0) + 1)
  if (count.size <= 1) return { diff: false, off: cells.map(() => false) }
  let ref = cells[0]
  let best = 0
  for (const v of cells) {
    const n = count.get(v)!
    if (n > best) {
      best = n
      ref = v
    }
  }
  return { diff: true, off: cells.map((v) => v !== ref) }
}

type Psets = Record<string, Record<string, PropValue>>

export function spatialTable(input: SpatialInput): SpatialTable | null {
  const { federation: fed, library, files = [], uploadNames, modelColors = {}, assigned = {}, units = 'mm' } = input
  if (!fed.models.length) return null
  const multi = fed.models.length > 1
  const metas: ModelIndexMeta[] = fed.models.map((x) => x.meta)
  const cu = coordUnit(units)
  /** A coordinate, comma-grouped to three decimals as the design's own `f3` here (`:1749`). */
  const xyz = (metres: number): string => group3(coordIn(metres, units))
  /** A length the file states in its own unit, converted, in the display unit. */
  const len = (meta: ModelIndexMeta, v: number | undefined): string =>
    v === undefined ? DASH : `${xyz(v * meta.units.length)} ${cu}`

  const counts = new Map<string, number>()
  for (const e of fed.elements) counts.set(e.model, (counts.get(e.model) ?? 0) + 1)

  const columns: SpatialColumn[] = fed.models.map((x) => {
    const key = x.meta.modelKey
    const path = pathOf(key, files)
    return {
      key,
      label: modelLabel(key, x.meta.fileName, library, uploadNames[key]),
      file: uploadNames[key] || (libraryEntry(key, path, library)?.file ?? x.meta.fileName),
      swatch: rowSwatch(key, x.slot, library, modelColors, path, assigned)
    }
  })

  let diffs = 0
  const row = (k: string, cells: string[], kind: 'plain' | 'ident' | 'gid' = 'plain'): SpatialRow => {
    const ident = kind !== 'plain'
    const c = ident || !multi ? { diff: false, off: cells.map(() => false) } : compare(cells)
    if (c.diff) diffs++
    return { kind: 'row', k, cells, ident, gid: kind === 'gid', diff: c.diff, off: c.off, merged: multi && !ident && !c.diff }
  }
  const per = (f: (meta: ModelIndexMeta, i: number) => string): string[] => metas.map(f)

  /** Each entity's property sets after its attributes: the union of set names, sorted, then of their keys. */
  const sets = (of: (meta: ModelIndexMeta) => Psets | undefined): SpatialLine[] => {
    const all = metas.map((m) => of(m) ?? {})
    // Own keys only: a set or a property a file names `constructor` must not find Object's.
    const setOf = (p: Psets, name: string): Record<string, PropValue> | undefined =>
      Object.hasOwn(p, name) ? p[name] : undefined
    const names = [...new Set(all.flatMap((p) => Object.keys(p)))].sort()
    const out: SpatialLine[] = []
    for (const name of names) {
      const keys = [...new Set(all.flatMap((p) => Object.keys(setOf(p, name) ?? {})))]
      const rows = keys.map((k) =>
        row(
          k,
          all.map((p) => {
            const set = setOf(p, name)
            const v = set && Object.hasOwn(set, k) ? set[k] : undefined
            return v === undefined || v === null || v === '' ? DASH : fmtV(v)
          })
        )
      )
      out.push({ kind: 'set', name, has: all.map((p) => setOf(p, name) !== undefined), diff: rows.some((r) => r.diff) }, ...rows)
    }
    return out
  }

  const groupOf = (type: SpatialGroup['type'], name: string, lines: SpatialLine[]): SpatialGroup => ({
    type,
    name,
    lines,
    diff: lines.some((l) => l.diff)
  })

  const first = metas[0]
  const project = groupOf('IfcProject', columns[0].label, [
    row('Name', per((m) => or(m.project?.name))),
    row('LongName', per((m) => or(m.project?.longName))),
    row('Description', per((m) => or(m.project?.description))),
    row('ObjectType', per((m) => or(m.containers?.project?.objectType))),
    row('Phase', per((m) => or(m.project?.phase))),
    row('GlobalId', per((m) => or(m.project?.guid)), 'gid'),
    ...sets((m) => m.containers?.project?.psets)
  ])

  // The Easting / Northing and True north the Coordinate-system card prints, from each model's
  // own georeferencing through the same functions (`coordsFromGeoref`, `crsChip`).
  const position = (m: ModelIndexMeta): string => {
    const co = coordsFromGeoref(m.georef)
    if (co?.E == null || co.N == null) return DASH
    const crs = crsChip(m.georef).short
    return `${xyz(co.E)} E · ${xyz(co.N)} N${crs && crs !== DASH ? ` (${crs})` : ''}`
  }
  const north = (m: ModelIndexMeta): string => {
    const angle = coordsFromGeoref(m.georef)?.angle
    return angle == null ? DASH : `${angle.toFixed(2)}° clockwise from project north`
  }
  const site = groupOf('IfcSite', or(first.site?.name), [
    row('Name', per((m) => or(m.site?.name))),
    row('LongName', per((m) => or(m.site?.longName))),
    row('Description', per((m) => or(m.containers?.site?.description))),
    row('ObjectType', per((m) => or(m.containers?.site?.objectType))),
    row('CompositionType', per((m) => or(m.site?.compositionType))),
    row('GlobalId', per((m) => or(m.site?.guid)), 'gid'),
    row('RefLatitude', per((m) => dms(m.containers?.site?.refLatitude, 'N', 'S'))),
    row('RefLongitude', per((m) => dms(m.containers?.site?.refLongitude, 'E', 'W'))),
    row('RefElevation', per((m) => len(m, m.containers?.site?.refElevation))),
    row('LandTitleNumber', per((m) => or(m.containers?.site?.landTitleNumber))),
    row('SiteAddress', per((m) => or(m.containers?.site?.address))),
    row('Easting / Northing', per(position)),
    row('True north', per(north)),
    ...sets((m) => m.containers?.site?.psets)
  ])

  const top = (m: ModelIndexMeta): string => {
    let t: (typeof m.storeys)[number] | null = null
    for (const s of m.storeys) if (!t || s.elev >= t.elev) t = s
    if (!t) return DASH
    // An elevation: what it printed in `mm` and `m`, feet and inches in `ft`.
    return `${units === 'ft' ? formatLength(t.elev, units) : `${group3(t.elev)} m`} (${t.name})`
  }
  const building = groupOf('IfcBuilding', or(first.building?.name), [
    row('Name', per((m) => or(m.building?.name))),
    row('LongName', per((m) => or(m.building?.longName))),
    row('Description', per((m) => or(m.containers?.building?.description))),
    row('ObjectType', per((m) => or(m.containers?.building?.objectType))),
    row('CompositionType', per((m) => or(m.building?.compositionType))),
    row('GlobalId', per((m) => or(m.building?.guid)), 'gid'),
    row('ElevationOfRefHeight', per((m) => len(m, m.containers?.building?.elevationOfRefHeight))),
    row('ElevationOfTerrain', per((m) => len(m, m.containers?.building?.elevationOfTerrain))),
    row('BuildingAddress', per((m) => or(m.containers?.building?.address))),
    row('Storeys', per((m) => `${m.storeys.length} IfcBuildingStorey`)),
    row('Height to top', per(top)),
    ...sets((m) => m.containers?.building?.psets)
  ])

  const file = groupOf('File', columns[0].file, [
    row('File', columns.map((c) => c.file), 'ident'),
    row('Schema', per((m) => or(m.schema))),
    row('Units', per((m) => unitsLine(m.units))),
    row('Elements', per((m) => group(counts.get(m.modelKey) ?? 0)), 'ident')
  ])

  return { columns, groups: [project, site, building, file], diffs }
}
