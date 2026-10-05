/**
 * The federation, as the schedule engine's input — 2026-09-25, the Schedules window.
 *
 * ifcTable parsed its own IFC (`ifc/extract.ts`, web-ifc 0.0.68). SGVue has already parsed
 * every loaded file into a frozen `ModelIndex`, so that extractor is not ported: this pure
 * function reads the federation instead and produces what the extractor produced — one
 * `ElemCore` and one `Record<"Pset.Prop", Cell>` per element, numbers in SI — plus the one
 * thing ifcTable never had, `rowIds`: store row `i` is federation element `rowIds[i]`, which
 * is what lets a clicked row select its element in the 3D view.
 *
 * Field by field against `extract.ts`, and where SGVue's index cannot say the same thing the
 * field is left empty rather than guessed (SGVue's rule: nothing is invented):
 *
 *   entity          `IfcElement.type` — already canonical case, the sidebar's own spelling
 *   name, description, guid     verbatim
 *   mark            `tag`
 *   family/typeName `objectType` split on the first ':' — SGVue's `objectType` is exactly
 *                   ifcTable's `fullType` (type Name, falling back to the occurrence's)
 *   objectType      the same string. ifcTable reads the occurrence's raw `ObjectType`; the
 *                   index keeps only the type-first one (gap)
 *   predefinedType  as indexed, where `USERDEFINED` is already resolved (gap: ifcTable keeps
 *                   the raw token)
 *   storey          `storey` (the index's `Name || LongName`; ifcTable reads LongName first)
 *   storeyElevation / building / site   from the model's own spatial tree, by storey name
 *   space           an `IfcSpace`'s own `LongName || Name`; for everything else '' — the
 *                   index keeps neither space containment nor `IfcRelSpaceBoundary` (gap)
 *   material        every distinct layer / profile / constituent material, ', '-joined, as
 *                   `matNames` does
 *   discipline      `disciplineForEntity`, as ifcTable
 *   model           the model's name as the sidebar's MODELS list shows it (`modelLabel`),
 *                   passed in by the caller as `labels`; the model key when none is given.
 *                   SGVue addition — phase 3 makes it the first column when more than one
 *                   model is loaded
 *
 * Skipped exactly as ifcTable skips them: `IfcVirtualElement` (openings, annotations and
 * grids are never federation elements to begin with). ifcTable's `IfcSite` / `IfcBuilding` /
 * `IfcBuildingStorey` rows do not exist here: they are not elements of the federation, so a
 * row for one could never be shown in 3D (gap).
 */
import type { Federation, FederatedElement } from '../shared/federate'
import type { PropValue, PsetInstance, SpatialNode, Units } from '../shared/model-index.types'
import { unitLabel } from '../shared/units'
import { disciplineForEntity } from './ifc/entities'
import type { Cell, ElemCore, ModelMeta, UnitKind } from './ifc/types'
import { IMPERIAL_LENGTH, measureKind, type UnitScales } from './ifc/units'

/** What the main window sends the Schedules window: the store's input, and row → element. */
export interface ScheduleSnapshot {
  meta: ModelMeta
  cores: ElemCore[]
  cells: Record<string, Cell>[]
  /** Federation element id of each store row. Same length as `cores`. */
  rowIds: number[]
}

/** ifcTable's `SKIP` list, less what a federation never holds. */
const SKIP = new Set(['IfcVirtualElement'])

/** The symbol of an imperial length unit, or undefined — ifcTable's `imperialLengthSymbol`. */
function imperialSymbol(units: Units): string | undefined {
  const lu = units.byType.LENGTHUNIT
  return lu?.entity === 'IfcConversionBasedUnit' ? IMPERIAL_LENGTH[lu.name.trim().toUpperCase()] : undefined
}

/**
 * SI per file unit for each kind the engine converts; mass in kilograms, ifcTable's SI.
 *
 * The index's `length`, `area`, `volume` and `angle` are already metres, m², m³ and radians
 * per file unit, for SI and conversion-based units alike (`index-builder.ts` multiplies a
 * conversion's value by its base unit's `siFactor`). **Mass is the exception:** the SI unit
 * IFC names is the GRAM, so the index's mass factor is **grams** per file unit in both
 * branches — 1 for GRAM, 1 000 for KILO GRAM, 453.59237 for a POUND over KILO GRAM — and
 * kilograms are that ÷ 1 000.
 */
function scalesOf(units: Units): UnitScales {
  const massFactor = units.byType.MASSUNIT?.factor
  return {
    length: units.length,
    area: units.area,
    volume: units.volume,
    angle: units.angle,
    mass: massFactor !== undefined ? massFactor / 1000 : 1,
    count: 1,
    none: 1
  }
}

/** ifcTable's `str()`: booleans spell TRUE / FALSE. */
const str = (v: string | number | boolean): string =>
  typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v)

/** ifcTable's `toCell`, over a value SGVue has already read. `null` = no cell. */
function toCell(value: PropValue, measure: string | undefined, scales: UnitScales): Cell | null {
  if (Array.isArray(value)) {
    const parts = value.map(str).filter(Boolean)
    return parts.length ? { v: parts.join(', ') } : null
  }
  if (typeof value === 'boolean') return { v: value }
  if (typeof value === 'number') {
    const kind: UnitKind = measureKind(measure)
    return kind === 'none' ? { v: value } : { v: value * scales[kind], k: kind }
  }
  const text = value as string
  if (text === '') return null
  if (text === '.T.') return { v: true }
  if (text === '.F.') return { v: false }
  return { v: text }
}

interface Place {
  elevation: number | null
  building: string
  site: string
}

const label = (n: SpatialNode): string => n.longName || n.name

/** Storey name → where it sits, and space expressId → its name, from one walk of the tree. */
function walkSpatial(root: SpatialNode | null): { storeys: Map<string, Place>; spaces: Map<number, string> } {
  const storeys = new Map<string, Place>()
  const spaces = new Map<number, string>()
  const visit = (n: SpatialNode, building: string, site: string, depth: number): void => {
    if (depth > 64) return
    if (n.type === 'IfcSite') site = label(n)
    if (n.type === 'IfcBuilding') building = label(n)
    if (n.type === 'IfcBuildingStorey') {
      // The index names a storey `Name || LongName`, so that is the key an element carries.
      const key = n.name || n.longName
      if (!storeys.has(key)) storeys.set(key, { elevation: n.elevation ?? null, building, site })
    }
    if (n.type === 'IfcSpace') spaces.set(n.expressId, label(n))
    for (const c of n.children) visit(c, building, site, depth + 1)
  }
  if (root) visit(root, '', '', 0)
  return { storeys, spaces }
}

/** One element's material string, as ifcTable's `matNames` joins it. */
function materialOf(el: FederatedElement): string {
  const names: string[] = []
  for (const m of el.materials) {
    if (m.layers?.length) for (const l of m.layers) names.push(l.material)
    else names.push(m.name)
  }
  return [...new Set(names.filter(Boolean))].join(', ')
}

export function snapshotOf(
  federation: Federation,
  labels: Readonly<Record<string, string>> = {}
): ScheduleSnapshot {
  const first = federation.models[0]?.meta
  const units = first?.units
  const cores: ElemCore[] = []
  const cells: Record<string, Cell>[] = []
  const rowIds: number[] = []

  // Interned keys, as `extract.ts` interns them: one 'Pset_DoorCommon.FireRating' string.
  const keyCache = new Map<string, string>()
  const key = (set: string, prop: string): string => {
    const k = set + '.' + prop
    const hit = keyCache.get(k)
    if (hit) return hit
    keyCache.set(k, k)
    return k
  }

  // A property set shared by many elements (a type's) converts once, and its cells stay
  // shared — a structured clone keeps shared objects shared, so they also cross once.
  const converted = new WeakMap<object, { name: string; entries: [string, Cell][] }>()

  const setCells = (
    name: string,
    set: Record<string, PropValue>,
    meta: PsetInstance | undefined,
    scales: UnitScales,
    into: Record<string, Cell>
  ): void => {
    let hit = converted.get(set)
    if (!hit || hit.name !== name) {
      const entries: [string, Cell][] = []
      for (const prop in set) {
        const cell = toCell(set[prop], meta?.measures[prop], scales)
        if (cell) entries.push([key(name, prop), cell])
      }
      hit = { name, entries }
      converted.set(set, hit)
    }
    for (const [k, c] of hit.entries) into[k] = c
  }

  // What each model contributes, looked up per element in the one pass below.
  const byModel = new Map(
    federation.models.map((m) => [m.meta.modelKey, { scales: scalesOf(m.meta.units), ...walkSpatial(m.meta.spatial) }])
  )

  for (const el of federation.elements) {
    const model = byModel.get(el.model)
    if (!model || SKIP.has(el.type)) continue
    const { scales, storeys, spaces } = model
    const colon = el.objectType.indexOf(':')
    const place = el.storey ? storeys.get(el.storey) : undefined
    const row: Record<string, Cell> = {}
    for (const name in el.psets) setCells(name, el.psets[name], el.psetMeta[name], scales, row)
    for (const name in el.qto) setCells(name, el.qto[name], el.psetMeta[name], scales, row)

    cores.push({
      entity: el.type,
      name: el.name,
      description: el.description,
      mark: el.tag,
      typeName: colon > 0 ? el.objectType.slice(colon + 1) : el.objectType,
      family: colon > 0 ? el.objectType.slice(0, colon) : '',
      objectType: el.objectType,
      predefinedType: el.predefinedType,
      guid: el.guid,
      storey: el.storey,
      storeyElevation: place?.elevation ?? null,
      building: place?.building ?? '',
      site: place?.site ?? '',
      space: el.isSpace ? (spaces.get(el.expressId) ?? el.name) : '',
      material: materialOf(el),
      discipline: disciplineForEntity(el.type),
      model: labels[el.model] ?? el.model
    })
    cells.push(row)
    rowIds.push(el.id)
  }

  const meta: ModelMeta = {
    fileName: federation.project.file,
    schema: federation.project.schema,
    projectName: first?.project?.name || first?.project?.longName || '',
    authoringTool: first?.header.originatingSystem ?? '',
    lengthUnit: (units && (imperialSymbol(units) ?? unitLabel(units, 'length'))) || 'm',
    unitSystem: units && imperialSymbol(units) ? 'imperial' : 'metric',
    elementCount: cores.length,
    parseMs: 0
  }
  return { meta, cores, cells, rowIds }
}
