/**
 * The Spatial-structure card — `SGVue.dc.html:1747–1781` (`spatial()`), as a pure function.
 *
 * Same cards, same order, same row labels. **Every value is read from the file**, which is
 * the one place this cannot be a literal port: the prototype has no files behind its mock, so
 * it manufactures a GlobalId from a hash (`guid(seed)`, `:1740`) and writes
 * `MILLI.METRE · SQUARE_METRE · CUBIC_METRE` and `CompositionType: ELEMENT` as constants. The
 * fidelity contract forbids that here (§"No visible additions" — "never a placeholder"), so a
 * value the file does not carry shows the design's own em dash, exactly as `p.site || '—'`
 * already does one row above.
 *
 * `CompositionType` is read from `IfcSite` / `IfcBuilding` since Phase 4 (`index-builder.ts`);
 * a file that leaves the optional attribute unset still shows the dash.
 */
import { DASH, group, group3 } from '../../../shared/fmt'
import type { Federation } from '../../../shared/federate'
import type { Units } from '../../../shared/model-index.types'
import type { CoordState, LibraryFile } from '../shell'
import { baseSwatch, modelLabel } from './models'

/** What the design prints when a value is absent (`SGVue.dc.html:1765`). */
export { DASH }

export interface SpatialRow {
  k: string
  v: string
}

export interface SpatialCard {
  type: string
  name: string
  swatch?: string
  shared?: boolean
  rows: SpatialRow[]
}

export interface SpatialInput {
  federation: Federation
  library: readonly LibraryFile[]
  coords: CoordState
  uploadNames: Record<string, string>
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
const num3 = (v: number | null): string => (v == null ? DASH : group3(v))

export function spatialCards(input: SpatialInput): SpatialCard[] {
  const { federation: m, library, coords: co, uploadNames } = input
  if (!m.models.length) return []
  const p = m.project
  const top = m.storeys.length ? m.storeys[m.storeys.length - 1] : null
  const counts = new Map<string, number>()
  for (const e of m.elements) counts.set(e.model, (counts.get(e.model) ?? 0) + 1)
  const names = m.models.map((x) => uploadNames[x.meta.modelKey] || x.meta.fileName)

  // Each loaded file carries its own IfcProject; site and building are the shared parents.
  const projects: SpatialCard[] = m.models.map((x) => {
    const key = x.meta.modelKey
    const lib = library.find((f) => f.key === key)
    const fileName = uploadNames[key] || (lib?.file ?? x.meta.fileName)
    const label = modelLabel(key, x.meta.fileName, library, uploadNames[key])
    return {
      type: 'IfcProject',
      name: label,
      swatch: baseSwatch(key, x.slot, library),
      rows: [
        { k: 'Name', v: `${p.name} — ${label}` },
        { k: 'GlobalId', v: or(x.meta.project?.guid) },
        { k: 'File', v: fileName },
        { k: 'Schema', v: or(p.schema) },
        { k: 'Units', v: unitsLine(x.meta.units) },
        { k: 'Elements', v: group(counts.get(key) ?? 0) }
      ]
    }
  })

  const first = m.models[0].meta
  return [
    ...projects,
    {
      type: 'IfcSite',
      name: or(p.site),
      shared: true,
      rows: [
        { k: 'Name', v: or(p.site) },
        { k: 'GlobalId', v: or(first.site?.guid) },
        { k: 'CompositionType', v: or(first.site?.compositionType) },
        { k: 'RefElevation', v: co.Z == null ? DASH : `${group3(co.Z)} m` },
        {
          k: 'Easting / Northing',
          v:
            co.E == null || co.N == null
              ? DASH
              : `${group3(co.E)} E · ${group3(co.N)} N (SVY21)`
        },
        {
          k: 'True north',
          v: co.angle == null ? DASH : `${co.angle.toFixed(2)}° clockwise from project north`
        }
      ]
    },
    {
      type: 'IfcBuilding',
      name: p.building || p.name,
      shared: true,
      rows: [
        { k: 'Name', v: or(p.building || p.name) },
        { k: 'GlobalId', v: or(first.building?.guid) },
        { k: 'CompositionType', v: or(first.building?.compositionType) },
        { k: 'Storeys', v: `${m.storeys.length} IfcBuildingStorey` },
        { k: 'Declared in', v: names.join('  ·  ') || DASH },
        { k: 'Height to top', v: top ? `${num3(top.elev)} m (${top.name})` : DASH },
        { k: 'Elements', v: group(m.elements.length) }
      ]
    }
  ]
}
