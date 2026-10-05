/**
 * `ModelIndex` from an open model — the conformance matrix (plan §1, SYSTEM_SPEC §5) in code.
 *
 * Ported from Marumi's `src/ifc/parse.ts` (units, spatial walk, materials, georeferencing, grids,
 * placement chain) and Aquila's `src/properties.js` (the single forward pass over the property
 * relations) — Marumi and Aquila are the author's earlier IFC viewers. Both projects' traps
 * are honoured here and repeated in `CLAUDE.md`:
 *
 *   · **Shallow `GetLine` only.** The recursive flatten's batched line fetch throws
 *     `Cannot convert "1,2,3" to unsigned int` on real Revit exports.
 *   · **One forward pass over the relations**, never a per-element `getPropertySets` loop:
 *     that is O(elements × relations) and froze a 26k-element model permanently.
 *   · **`getPropertySets(…, includeTypeProperties)` replaces rather than adds**, which is
 *     why type and occurrence property sets are read separately and merged here.
 *   · **Never `getSpatialStructure`** — it dumps every element under each storey. The tree
 *     comes from `IfcRelAggregates`, the contents from `IfcRelContainedInSpatialStructure`.
 *   · **Storey `Elevation` is in the file's own length unit**, so it is converted.
 *   · Every `GetLineIDsWithType` vector is freed (inside `ifc-source.ts`).
 *
 * Runs unchanged in the parse worker and under Node in the fixture test: it only ever talks
 * to `ReadOnlyIfcSource`.
 */
import { collectPropKeys } from '../shared/attr'
import { detectMethod } from '../shared/georef'
import type {
  ClassificationRef,
  Decomposition,
  Georeference,
  GeorefSource,
  GridAxisRecord,
  IfcElement,
  IfcHeader,
  MaterialRef,
  ModelCounts,
  ModelIndex,
  ProjectInfo,
  PropValue,
  PsetInstance,
  PsetKind,
  SpatialNode,
  Storey,
  UnitEntry,
  Units,
  XY
} from '../shared/model-index.types'
import { siFactor } from '../shared/units'
import { HEADER, STEP_TOKEN, type IfcLine, type ReadOnlyIfcSource } from './ifc-source'

/* ────────────────────────────── stages ────────────────────────────── */

export type BuildStage =
  | 'parsing entities'
  | 'reading units'
  | 'spatial structure'
  | 'indexing properties'
  | 'indexing relations'
  | 'building elements'
  | 'georeferencing'

/** Every stage ends with a real value — a schema, a count — never a bare percentage. */
export type StageReport = (stage: BuildStage, detail: string, fraction: number) => void

export interface BuildOptions {
  modelKey: string
  fileName: string
  /** Lower-case hex SHA-256 of the file. Computed while reading; `''` when unknown. */
  sha256: string
  onStage?: StageReport
}

/* ────────────────────────────── value helpers ────────────────────────────── */

const isHandle = (v: unknown): v is { value: number } =>
  typeof v === 'object' &&
  v !== null &&
  (v as { type?: unknown }).type === STEP_TOKEN.REF &&
  typeof (v as { value?: unknown }).value === 'number'

/** The expressId behind a reference handle, or 0. */
function ref(v: unknown): number {
  return isHandle(v) ? v.value : 0
}

function refs(v: unknown): number[] {
  if (!Array.isArray(v)) return []
  const out: number[] = []
  for (const item of v) {
    const id = ref(item)
    if (id) out.push(id)
  }
  return out
}

/**
 * An attribute **as authored**: a string stays a string, a number a number, an enumeration
 * its own label, a list an array. Reference handles are not values and come back `null`.
 */
function authored(v: unknown): PropValue | null {
  if (v == null) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (Array.isArray(v)) {
    const out: (string | number | boolean)[] = []
    for (const item of v) {
      const a = authored(item)
      if (a === null) continue
      // Nested lists are flattened: an IfcCompoundPlaneAngleMeasure is one list of numbers.
      if (typeof a === 'object') out.push(...a)
      else out.push(a)
    }
    return out.length ? out : null
  }
  if (isHandle(v)) return null
  if (typeof v === 'object' && 'value' in (v as Record<string, unknown>)) {
    return authored((v as Record<string, unknown>).value)
  }
  return null
}

/** A text attribute, or `''` — never a placeholder. */
function text(v: unknown): string {
  const a = authored(v)
  if (a === null) return ''
  if (Array.isArray(a)) return a.join(', ')
  if (typeof a === 'boolean') return a ? 'TRUE' : 'FALSE'
  return String(a)
}

function numberOf(v: unknown): number | null {
  const a = authored(v)
  if (typeof a === 'number') return a
  if (typeof a === 'string') {
    const n = parseFloat(a)
    return isNaN(n) ? null : n
  }
  return null
}

/** The IFC measure type web-ifc records on a wrapped value, e.g. `IFCLENGTHMEASURE`. */
function measureName(v: unknown): string {
  if (typeof v !== 'object' || v === null) return ''
  const name = (v as { name?: unknown }).name
  return typeof name === 'string' ? name : ''
}

/** GlobalId: 22 characters of the IFC base-64 alphabet. Validated, never regenerated. */
const GUID_RE = /^[0-9A-Za-z_$]{22}$/
export const isValidGuid = (guid: string): boolean => GUID_RE.test(guid)

/* ────────────────────────────── the builder ────────────────────────────── */

export function buildModelIndex(
  src: ReadOnlyIfcSource,
  modelID: number,
  options: BuildOptions
): ModelIndex {
  const { modelKey, fileName, sha256, onStage } = options
  const stage: StageReport = onStage ?? (() => {})

  const line = (id: number): IfcLine | null => src.line(modelID, id)
  const typeOf = (id: number): string => src.typeName(src.lineType(modelID, id))
  const code = (name: string): number => src.typeCode(name)
  const ids = (name: string, inherited = false): number[] => {
    const c = code(name)
    return c ? src.idsWithType(modelID, c, inherited) : []
  }

  const schema = src.schema(modelID)
  const entityCount = src.lineCount(modelID)
  stage('parsing entities', `${schema} · ${entityCount.toLocaleString('en-US')} entities`, 1)

  /* ── header ───────────────────────────────────────────────────────── */
  const header = readHeader(src, modelID)

  /* ── project and units ────────────────────────────────────────────── */
  const projectId = ids('IFCPROJECT')[0] ?? 0
  const projectLine = line(projectId)
  const project: ProjectInfo | null = projectLine
    ? {
        expressId: projectId,
        guid: text(projectLine.GlobalId),
        name: text(projectLine.Name),
        longName: text(projectLine.LongName),
        phase: text(projectLine.Phase),
        description: text(projectLine.Description)
      }
    : null

  const units = readUnits(src, modelID, projectLine)
  stage(
    'reading units',
    Object.values(units.byType)
      .map((u) => `${u.unitType.replace('UNIT', '').toLowerCase()} ${u.prefix}${u.name}`)
      .join(' · ') || 'no unit assignment',
    1
  )

  /* ── decomposition: aggregation, nesting, voids, fills ────────────── */
  const aggregates = new Map<number, number[]>() // parent → children
  const aggregatedIn = new Map<number, number>() // child → parent
  for (const relId of ids('IFCRELAGGREGATES')) {
    const rel = line(relId)
    if (!rel) continue
    const parent = ref(rel.RelatingObject)
    if (!parent) continue
    const kids = refs(rel.RelatedObjects)
    const list = aggregates.get(parent)
    if (list) list.push(...kids)
    else aggregates.set(parent, [...kids])
    for (const k of kids) aggregatedIn.set(k, parent)
  }

  const nests = new Map<number, number[]>()
  const nestedIn = new Map<number, number>()
  for (const relId of ids('IFCRELNESTS')) {
    const rel = line(relId)
    if (!rel) continue
    const parent = ref(rel.RelatingObject)
    if (!parent) continue
    const kids = refs(rel.RelatedObjects)
    const list = nests.get(parent)
    if (list) list.push(...kids)
    else nests.set(parent, [...kids])
    for (const k of kids) nestedIn.set(k, parent)
  }

  const openingsOf = new Map<number, number[]>() // element → openings cut into it
  const voidedBy = new Map<number, number>() // opening → element
  for (const relId of ids('IFCRELVOIDSELEMENT')) {
    const rel = line(relId)
    if (!rel) continue
    const host = ref(rel.RelatingBuildingElement)
    const opening = ref(rel.RelatedOpeningElement)
    if (!host || !opening) continue
    const list = openingsOf.get(host)
    if (list) list.push(opening)
    else openingsOf.set(host, [opening])
    voidedBy.set(opening, host)
  }

  const fillsOf = new Map<number, number[]>() // opening → what fills it
  const fillsWhat = new Map<number, number>() // filler → opening
  for (const relId of ids('IFCRELFILLSELEMENT')) {
    const rel = line(relId)
    if (!rel) continue
    const opening = ref(rel.RelatingOpeningElement)
    const filler = ref(rel.RelatedBuildingElement)
    if (!opening || !filler) continue
    const list = fillsOf.get(opening)
    if (list) list.push(filler)
    else fillsOf.set(opening, [filler])
    fillsWhat.set(filler, opening)
  }

  /* ── spatial structure ────────────────────────────────────────────── */
  const spatialTypes = new Set([
    'IfcProject',
    'IfcSite',
    'IfcBuilding',
    'IfcBuildingStorey',
    'IfcSpace'
  ])

  const buildNode = (id: number, depth = 0): SpatialNode | null => {
    const row = line(id)
    if (!row) return null
    const type = typeOf(id)
    const elevation = row.Elevation != null ? numberOf(row.Elevation) : null
    // `IfcSpatialStructureElement.CompositionType` — an enumeration, so `text()` reads it the
    // same way `PredefinedType` is read. `IfcProject` does not declare it and files may leave
    // it unset; it is then absent, never defaulted to ELEMENT.
    const compositionType = text(row.CompositionType)
    const children: SpatialNode[] = []
    if (depth < 8) {
      for (const kid of aggregates.get(id) ?? []) {
        if (!spatialTypes.has(typeOf(kid))) continue
        const node = buildNode(kid, depth + 1)
        if (node) children.push(node)
      }
    }
    return {
      expressId: id,
      guid: text(row.GlobalId),
      type,
      name: text(row.Name),
      longName: text(row.LongName),
      ...(compositionType ? { compositionType } : {}),
      ...(elevation !== null ? { elevation: elevation * units.length } : {}),
      children
    }
  }

  const spatial = projectId ? buildNode(projectId) : null
  const findNode = (root: SpatialNode | null, type: string): SpatialNode | null => {
    if (!root) return null
    if (root.type === type) return root
    for (const kid of root.children) {
      const hit = findNode(kid, type)
      if (hit) return hit
    }
    return null
  }
  const site = findNode(spatial, 'IfcSite')
  const building = findNode(spatial, 'IfcBuilding')

  const storeyNodes: SpatialNode[] = []
  const collectStoreys = (node: SpatialNode | null): void => {
    if (!node) return
    if (node.type === 'IfcBuildingStorey') storeyNodes.push(node)
    node.children.forEach(collectStoreys)
  }
  collectStoreys(spatial)

  /**
   * Where a storey's floor geometry actually is, in world metres.
   *
   * `Elevation` is stated relative to whatever the storey is placed in, so on a shared-
   * coordinates export it is short by the site's own elevation — 5.05 m on the reference
   * model, which is exactly how far its level rings sat below its slabs. The ladder keeps
   * showing `Elevation`; the ring and the level section come from this.
   */
  const storeyPlacement = (id: number): readonly [number, number, number] | null => {
    const placementId = ref(line(id)?.ObjectPlacement)
    if (!placementId) return null
    const m = placementMatrix(src, modelID, placementId, units.length)
    return [m[12], m[13], m[14]]
  }

  const storeys: Storey[] = storeyNodes
    .map((n) => {
      const placement = storeyPlacement(n.expressId)
      return {
        expressId: n.expressId,
        guid: n.guid,
        name: n.name || n.longName,
        elev: n.elevation ?? 0,
        ...(placement ? { placement } : {}),
        ...(n.compositionType ? { compositionType: n.compositionType } : {})
      }
    })
    .sort((a, b) => a.elev - b.elev)
    .map((s, i, all) =>
      // `h` is derived from consecutive elevations — a file never declares a storey height.
      // The topmost storey has no next elevation, so it has no `h`.
      i + 1 < all.length ? { ...s, h: all[i + 1].elev - s.elev } : s
    )

  /* ── containment: element → storey ────────────────────────────────── */
  const storeySet = new Set(storeyNodes.map((n) => n.expressId))
  const storeyNameById = new Map(storeyNodes.map((n) => [n.expressId, n.name || n.longName]))
  const storeyOf = new Map<number, number>()
  // Elements are often contained in an IfcSpace rather than a storey, so spaces are
  // resolved to their own storey first and their contents inherit it.
  const inSpace: { space: number; elements: number[] }[] = []
  for (const relId of ids('IFCRELCONTAINEDINSPATIALSTRUCTURE')) {
    const rel = line(relId)
    if (!rel) continue
    const structure = ref(rel.RelatingStructure)
    const contents = refs(rel.RelatedElements)
    if (storeySet.has(structure)) for (const el of contents) storeyOf.set(el, structure)
    else inSpace.push({ space: structure, elements: contents })
  }
  for (const node of storeyNodes) for (const kid of node.children) storeyOf.set(kid.expressId, node.expressId)
  for (const { space, elements } of inSpace) {
    const storey = storeyOf.get(space) ?? aggregatedIn.get(space) ?? 0
    if (!storeySet.has(storey)) continue
    if (!storeyOf.has(space)) storeyOf.set(space, storey)
    for (const el of elements) if (!storeyOf.has(el)) storeyOf.set(el, storey)
  }
  // Aggregated children inherit their parent's storey (curtain-wall panels and mullions are
  // not contained in a storey at all; they hang off their curtain wall).
  let frontier = [...storeyOf.keys()]
  while (frontier.length) {
    const next: number[] = []
    for (const parent of frontier) {
      const storey = storeyOf.get(parent)!
      for (const kid of aggregates.get(parent) ?? []) {
        if (storeyOf.has(kid)) continue
        storeyOf.set(kid, storey)
        next.push(kid)
      }
    }
    frontier = next
  }
  stage(
    'spatial structure',
    `${site ? 1 : 0} site · ${building ? 1 : 0} building · ${storeys.length} storeys`,
    1
  )

  /* ── the element set ──────────────────────────────────────────────── */
  const openingCode = code('IFCOPENINGELEMENT')
  const allElementIds = ids('IFCELEMENT', true)
  const openingIds = new Set(openingCode ? src.idsWithType(modelID, openingCode, true) : [])
  const spaceIds = ids('IFCSPACE', true)
  const elementIds = allElementIds.filter((id) => !openingIds.has(id))
  const memberIds = [...elementIds, ...spaceIds]
  const memberSet = new Set(memberIds)
  // The property pass also covers the spatial containers: IFC2X3 puts the georeferencing
  // ePset on IfcSite, which is a spatial element and so not in `memberIds`.
  const containerIds = [projectId, site?.expressId ?? 0, building?.expressId ?? 0]
    .concat(storeyNodes.map((n) => n.expressId))
    .filter((id) => id > 0)
  const psetTargets = new Set([...memberIds, ...containerIds])

  /* ── type objects ─────────────────────────────────────────────────── */
  interface TypeInfo {
    expressId: number
    guid: string
    name: string
    elementType: string
    psetIds: number[]
  }
  const typeCache = new Map<number, TypeInfo | null>()
  const typeOfElement = new Map<number, number>()
  for (const relId of ids('IFCRELDEFINESBYTYPE')) {
    const rel = line(relId)
    if (!rel) continue
    const typeId = ref(rel.RelatingType)
    if (!typeId) continue
    for (const objId of refs(rel.RelatedObjects)) {
      if (memberSet.has(objId)) typeOfElement.set(objId, typeId)
    }
  }
  const typeInfo = (typeId: number): TypeInfo | null => {
    if (typeCache.has(typeId)) return typeCache.get(typeId)!
    const row = line(typeId)
    const info: TypeInfo | null = row
      ? {
          expressId: typeId,
          guid: text(row.GlobalId),
          name: text(row.Name),
          elementType: text(row.ElementType),
          psetIds: refs(row.HasPropertySets)
        }
      : null
    typeCache.set(typeId, info)
    return info
  }

  /* ── property and quantity sets: ONE forward pass ─────────────────── */
  const psetsOf = new Map<number, Record<string, Record<string, PropValue>>>()
  const qtoOf = new Map<number, Record<string, Record<string, PropValue>>>()
  const metaOf = new Map<number, Record<string, PsetInstance>>()
  const setCache = new Map<number, ResolvedSet | null>()

  const resolve = (setId: number): ResolvedSet | null => {
    if (setCache.has(setId)) return setCache.get(setId)!
    const resolved = resolveSet(src, modelID, setId)
    setCache.set(setId, resolved)
    return resolved
  }

  const applySet = (objId: number, set: ResolvedSet, inherited: boolean): void => {
    const store = set.isQuantity ? qtoOf : psetsOf
    let bucket = store.get(objId)
    if (!bucket) store.set(objId, (bucket = {}))
    let meta = metaOf.get(objId)
    if (!meta) metaOf.set(objId, (meta = {}))
    const existing = bucket[set.name]
    if (!existing) {
      // No collision: share the resolved entries. They are never mutated, and a structured
      // clone keeps the sharing, so a pset used by 200 elements travels once.
      bucket[set.name] = set.entries
      meta[set.name] = {
        sourceExpressId: set.expressId,
        inherited,
        kind: set.kind,
        ...(set.methodOfMeasurement ? { methodOfMeasurement: set.methodOfMeasurement } : {}),
        measures: set.measures
      }
      return
    }
    // A type set and an occurrence set share a name: the occurrence wins, key by key.
    const prior = meta[set.name]
    bucket[set.name] = inherited
      ? { ...set.entries, ...existing }
      : { ...existing, ...set.entries }
    meta[set.name] = {
      sourceExpressId: inherited ? prior.sourceExpressId : set.expressId,
      inherited: inherited ? prior.inherited : false,
      kind: set.kind,
      ...(set.methodOfMeasurement || prior.methodOfMeasurement
        ? { methodOfMeasurement: set.methodOfMeasurement || prior.methodOfMeasurement! }
        : {}),
      measures: inherited
        ? { ...set.measures, ...prior.measures }
        : { ...prior.measures, ...set.measures }
    }
  }

  // Phase A — type property sets, lowest precedence.
  for (const [objId, typeId] of typeOfElement) {
    const info = typeInfo(typeId)
    if (!info) continue
    for (const setId of info.psetIds) {
      const set = resolve(setId)
      if (set) applySet(objId, set, true)
    }
  }

  // Phase B — occurrence property sets, which override.
  const propRelIds = ids('IFCRELDEFINESBYPROPERTIES')
  for (let i = 0; i < propRelIds.length; i++) {
    if ((i & 8191) === 0) stage('indexing properties', `${i.toLocaleString('en-US')} relations`, i / propRelIds.length)
    const rel = line(propRelIds[i])
    if (!rel) continue
    // IFC4 allows a set of definitions here; 2X3 a single one.
    const defIds = Array.isArray(rel.RelatingPropertyDefinition)
      ? refs(rel.RelatingPropertyDefinition)
      : [ref(rel.RelatingPropertyDefinition)]
    for (const defId of defIds) {
      if (!defId) continue
      const set = resolve(defId)
      if (!set) continue
      for (const objId of refs(rel.RelatedObjects)) {
        if (psetTargets.has(objId)) applySet(objId, set, false)
      }
    }
  }
  const psetCount = ids('IFCPROPERTYSET').length
  const qtoCount = ids('IFCELEMENTQUANTITY').length
  stage(
    'indexing properties',
    `${psetCount.toLocaleString('en-US')} property sets · ${qtoCount.toLocaleString('en-US')} quantity sets`,
    1
  )

  /* ── materials, classifications, systems ──────────────────────────── */
  const materialsOf = new Map<number, MaterialRef[]>()
  for (const relId of ids('IFCRELASSOCIATESMATERIAL')) {
    const rel = line(relId)
    if (!rel) continue
    const material = readMaterial(src, modelID, ref(rel.RelatingMaterial), units)
    if (!material) continue
    for (const objId of refs(rel.RelatedObjects)) {
      if (!memberSet.has(objId)) continue
      const list = materialsOf.get(objId)
      if (list) list.push(material)
      else materialsOf.set(objId, [material])
    }
  }

  const classificationsOf = new Map<number, ClassificationRef[]>()
  for (const relId of ids('IFCRELASSOCIATESCLASSIFICATION')) {
    const rel = line(relId)
    if (!rel) continue
    const cls = readClassification(src, modelID, ref(rel.RelatingClassification))
    if (!cls) continue
    for (const objId of refs(rel.RelatedObjects)) {
      if (!memberSet.has(objId)) continue
      const list = classificationsOf.get(objId)
      if (list) list.push(cls)
      else classificationsOf.set(objId, [cls])
    }
  }

  const systemsOf = new Map<number, { expressId: number; guid: string; type: string; name: string }[]>()
  for (const relId of ids('IFCRELASSIGNSTOGROUP')) {
    const rel = line(relId)
    if (!rel) continue
    const groupId = ref(rel.RelatingGroup)
    const groupLine = line(groupId)
    if (!groupLine) continue
    const group = {
      expressId: groupId,
      guid: text(groupLine.GlobalId),
      type: typeOf(groupId),
      name: text(groupLine.Name) || text(groupLine.LongName)
    }
    for (const objId of refs(rel.RelatedObjects)) {
      if (!memberSet.has(objId)) continue
      const list = systemsOf.get(objId)
      if (list) list.push(group)
      else systemsOf.set(objId, [group])
    }
  }
  stage(
    'indexing relations',
    `${materialsOf.size.toLocaleString('en-US')} with material · ${classificationsOf.size} classified · ${systemsOf.size} grouped`,
    1
  )

  /* ── elements ─────────────────────────────────────────────────────── */
  const spaceSet = new Set(spaceIds)
  const elements: IfcElement[] = []
  const byType: Record<string, number> = {}

  for (let i = 0; i < memberIds.length; i++) {
    const id = memberIds[i]
    if ((i & 4095) === 0)
      stage('building elements', `${i.toLocaleString('en-US')} elements`, i / memberIds.length)
    const row = line(id)
    if (!row) continue
    const type = typeOf(id)
    byType[type] = (byType[type] ?? 0) + 1

    const typeId = typeOfElement.get(id) ?? 0
    const info = typeId ? typeInfo(typeId) : null
    const occurrenceObjectType = text(row.ObjectType)
    let predefinedType = text(row.PredefinedType)
    if (predefinedType === 'USERDEFINED') {
      predefinedType = occurrenceObjectType || info?.elementType || 'USERDEFINED'
    }

    const guid = text(row.GlobalId)
    const mats = materialsOf.get(id) ?? []
    const decomposition: Decomposition = {
      ...(aggregatedIn.has(id) || nestedIn.has(id)
        ? { parent: aggregatedIn.get(id) ?? nestedIn.get(id)! }
        : {}),
      children: [...(aggregates.get(id) ?? []), ...(nests.get(id) ?? [])],
      openings: openingsOf.get(id) ?? [],
      fillings: fillsWhat.has(id) ? [fillsWhat.get(id)!] : (fillsOf.get(id) ?? [])
    }

    elements.push({
      id,
      expressId: id,
      guid,
      guidValid: isValidGuid(guid),
      tag: text(row.Tag),
      model: modelKey,
      name: text(row.Name) || text(row.LongName),
      description: text(row.Description),
      type,
      predefinedType,
      objectType: info?.name || occurrenceObjectType,
      typeGuid: info?.guid ?? '',
      storey: storeyNameById.get(storeyOf.get(id) ?? 0) ?? '',
      material: materialDisplay(mats),
      materials: mats,
      classifications: classificationsOf.get(id) ?? [],
      systems: systemsOf.get(id) ?? [],
      decomposition,
      psets: psetsOf.get(id) ?? {},
      qto: qtoOf.get(id) ?? {},
      psetMeta: metaOf.get(id) ?? {},
      ...(spaceSet.has(id) ? { isSpace: true as const } : {})
    })
  }
  stage('building elements', `${elements.length.toLocaleString('en-US')} elements`, 1)

  /* ── grids and georeferencing ─────────────────────────────────────── */
  const grids = readGrids(src, modelID, units.length)
  const georef = readGeoreference(
    src,
    modelID,
    units,
    containerIds.map((id) => psetsOf.get(id)).filter((sets) => sets !== undefined),
    // The spatial root, never the first `IfcSite` by expressId: this file carries 16 of them.
    site?.expressId ?? 0
  )
  stage(
    'georeferencing',
    georef.method === 'none'
      ? 'not georeferenced'
      : `${georef.method}${georef.crs?.name ? ' · ' + georef.crs.name : ''}`,
    1
  )

  const counts: ModelCounts = {
    entities: entityCount,
    elements: elementIds.length,
    spaces: spaceIds.length,
    openings: openingIds.size,
    psets: psetCount,
    quantitySets: qtoCount,
    byType
  }

  return {
    modelKey,
    fileName,
    sha256,
    schema,
    header,
    units,
    project,
    site,
    building,
    spatial,
    storeys,
    grids,
    georef,
    propKeys: collectPropKeys(elements),
    counts,
    elements
  }
}

/* ────────────────────────────── header ────────────────────────────── */

function readHeader(src: ReadOnlyIfcSource, modelID: number): IfcHeader {
  const args = (headerType: number): unknown[] => {
    const l = src.headerLine(modelID, headerType)
    return (l?.arguments as unknown[]) ?? []
  }
  const list = (v: unknown): string[] => {
    const a = authored(v)
    if (a === null) return []
    return (Array.isArray(a) ? a : [a]).map(String).filter((s) => s !== '')
  }

  const fileDescription = args(HEADER.FILE_DESCRIPTION)
  const description = list(fileDescription[0])
  // The MVD the exporter declared, e.g. `ViewDefinition [ReferenceView_V1.2]`.
  const mvd = description.map((d) => /ViewDefinition\s*\[(.*?)\]/.exec(d)).find(Boolean)
  const fileName = args(HEADER.FILE_NAME)
  const fileSchema = args(HEADER.FILE_SCHEMA)

  return {
    description,
    viewDefinition: mvd ? mvd[1].trim() : '',
    implementationLevel: text(fileDescription[1]),
    name: text(fileName[0]),
    timeStamp: text(fileName[1]),
    author: list(fileName[2]),
    organization: list(fileName[3]),
    preprocessorVersion: text(fileName[4]),
    originatingSystem: text(fileName[5]),
    authorization: text(fileName[6]),
    fileSchema: list(fileSchema[0])
  }
}

/* ────────────────────────────── units ────────────────────────────── */

function readUnits(src: ReadOnlyIfcSource, modelID: number, projectLine: IfcLine | null): Units {
  const byType: Record<string, UnitEntry> = {}
  const assignment = src.line(modelID, ref(projectLine?.UnitsInContext))

  for (const unitId of refs(assignment?.Units)) {
    const unit = src.line(modelID, unitId)
    if (!unit) continue
    const entity = src.typeName(src.lineType(modelID, unitId))
    const unitType = text(unit.UnitType)
    if (!unitType) continue
    const name = text(unit.Name)
    const prefix = text(unit.Prefix)

    let factor: number | undefined
    if (entity === 'IfcSIUnit') {
      factor = siFactor(name, prefix)
    } else if (entity === 'IfcConversionBasedUnit') {
      // e.g. DEGREE = 0.01745… RADIAN, INCH = 0.0254 METRE, expressed against an SI unit.
      const conversion = src.line(modelID, ref(unit.ConversionFactor))
      const value = numberOf(conversion?.ValueComponent)
      const base = src.line(modelID, ref(conversion?.UnitComponent))
      const baseName = base ? text(base.Name) : ''
      const basePrefix = base ? text(base.Prefix) : ''
      if (value !== null) factor = value * siFactor(baseName, basePrefix)
    }
    // IfcDerivedUnit (thermal transmittance, …) is recorded but not resolved to an SI
    // factor: its values are reported exactly as authored.

    byType[unitType] = { unitType, entity, name, prefix, ...(factor !== undefined ? { factor } : {}) }
  }

  const factorOf = (unitType: string, fallback: number): number =>
    byType[unitType]?.factor ?? fallback

  const length = factorOf('LENGTHUNIT', 1)
  return {
    byType,
    length,
    // Read separately, never derived: a file can declare MILLI/METRE lengths and plain
    // SQUARE_METRE areas, and deriving area from length² divides every area by a million.
    area: factorOf('AREAUNIT', length * length),
    volume: factorOf('VOLUMEUNIT', length * length * length),
    angle: factorOf('PLANEANGLEUNIT', 1)
  }
}

/* ────────────── property / quantity set resolution ────────────── */

interface ResolvedSet {
  expressId: number
  name: string
  kind: PsetKind
  isQuantity: boolean
  methodOfMeasurement?: string
  entries: Record<string, PropValue>
  measures: Record<string, string>
}

/** The quantity attributes, in the order `IfcPhysicalSimpleQuantity` subtypes declare them. */
const QUANTITY_FIELDS = [
  'LengthValue',
  'AreaValue',
  'VolumeValue',
  'CountValue',
  'WeightValue',
  'TimeValue',
  'NumberValue'
] as const

/** `IfcRoot`'s own attributes are provenance, not properties of the set. */
const PREDEFINED_SKIP = new Set([
  'expressID',
  'type',
  'GlobalId',
  'OwnerHistory',
  'Name',
  'Description'
])

function psetKind(name: string, isQuantity: boolean): PsetKind {
  if (isQuantity) return 'Qto'
  if (/^sgpset/i.test(name)) return 'SGPset'
  if (/^pset_/i.test(name)) return 'Pset'
  return 'other'
}

/**
 * Resolve one `IfcPropertySet` or `IfcElementQuantity` to flat key → value pairs.
 *
 * Every `IfcValue` form in the conformance matrix is handled. Forms that carry more than
 * one value keep the design's flat shape through dotted keys:
 * `Thickness.LowerBound`, `Layer.Material`, `Rating.DefiningValues`.
 */
function resolveSet(src: ReadOnlyIfcSource, modelID: number, setId: number): ResolvedSet | null {
  const row = src.line(modelID, setId)
  if (!row) return null
  const name = text(row.Name)
  const entries: Record<string, PropValue> = {}
  const measures: Record<string, string> = {}

  const put = (key: string, value: PropValue | null, measure: string): void => {
    if (key === '' || value === null) return
    entries[key] = value
    // Only numbers need a measure type: it is what lets the unit assignment convert them.
    if (typeof value === 'number' && measure) measures[key] = measure
  }

  const readProperty = (propId: number, prefix: string, depth: number): void => {
    if (depth > 4) return
    const prop = src.line(modelID, propId)
    if (!prop) return
    const propName = text(prop.Name)
    if (!propName) return
    const key = prefix ? `${prefix}.${propName}` : propName

    if (prop.NominalValue !== undefined && prop.NominalValue !== null) {
      put(key, authored(prop.NominalValue), measureName(prop.NominalValue))
      return
    }
    if (Array.isArray(prop.EnumerationValues)) {
      const values = prop.EnumerationValues.map(authored).filter((v) => v !== null) as (
        | string
        | number
        | boolean
      )[]
      put(key, values.length === 1 ? values[0] : values, measureName(prop.EnumerationValues[0]))
      return
    }
    if (Array.isArray(prop.ListValues)) {
      const values = prop.ListValues.map(authored).filter((v) => v !== null) as (
        | string
        | number
        | boolean
      )[]
      put(key, values, measureName(prop.ListValues[0]))
      return
    }
    if (prop.UpperBoundValue != null || prop.LowerBoundValue != null || prop.SetPointValue != null) {
      put(`${key}.UpperBound`, authored(prop.UpperBoundValue), measureName(prop.UpperBoundValue))
      put(`${key}.LowerBound`, authored(prop.LowerBoundValue), measureName(prop.LowerBoundValue))
      put(`${key}.SetPoint`, authored(prop.SetPointValue), measureName(prop.SetPointValue))
      return
    }
    if (Array.isArray(prop.DefiningValues) || Array.isArray(prop.DefinedValues)) {
      const defining = (prop.DefiningValues as unknown[] | undefined) ?? []
      const defined = (prop.DefinedValues as unknown[] | undefined) ?? []
      put(
        `${key}.DefiningValues`,
        defining.map(authored).filter((v) => v !== null) as (string | number | boolean)[],
        ''
      )
      put(
        `${key}.DefinedValues`,
        defined.map(authored).filter((v) => v !== null) as (string | number | boolean)[],
        ''
      )
      return
    }
    if (prop.PropertyReference != null) {
      // IfcPropertyReferenceValue — the referenced entity's own name, or its line number.
      const target = src.line(modelID, ref(prop.PropertyReference))
      const label = target
        ? text(target.Name) || text(target.Identification) || `#${target.expressID}`
        : ''
      put(key, label || null, '')
      return
    }
    if (Array.isArray(prop.HasProperties)) {
      // IfcComplexProperty — nested, flattened with dotted keys.
      for (const nested of refs(prop.HasProperties)) readProperty(nested, key, depth + 1)
      return
    }
  }

  const readQuantity = (quantityId: number, prefix: string, depth: number): void => {
    if (depth > 4) return
    const q = src.line(modelID, quantityId)
    if (!q) return
    const qName = text(q.Name)
    if (!qName) return
    const key = prefix ? `${prefix}.${qName}` : qName
    if (Array.isArray(q.HasQuantities)) {
      // IfcPhysicalComplexQuantity.
      for (const nested of refs(q.HasQuantities)) readQuantity(nested, key, depth + 1)
      const discrimination = text(q.Discrimination)
      if (discrimination) put(`${key}.Discrimination`, discrimination, '')
      return
    }
    for (const field of QUANTITY_FIELDS) {
      const value = q[field]
      if (value == null) continue
      put(key, authored(value), measureName(value))
      return
    }
  }

  const hasProperties = Array.isArray(row.HasProperties)
  const hasQuantities = Array.isArray(row.Quantities)
  if (hasProperties) {
    for (const propId of refs(row.HasProperties)) readProperty(propId, '', 0)
  } else if (hasQuantities) {
    for (const qId of refs(row.Quantities)) readQuantity(qId, '', 0)
  } else {
    // IfcPreDefinedPropertySet — IfcDoorLiningProperties, IfcWindowPanelProperties and the
    // rest carry their values as their own attributes rather than as IfcProperty lines.
    // Skipping them loses real data (PanelOperation, LiningDepth, …) that IfcOpenShell
    // reports, so their scalar attributes become the set's entries.
    for (const [key, value] of Object.entries(row)) {
      if (PREDEFINED_SKIP.has(key)) continue
      put(key, authored(value), measureName(value))
    }
  }

  const methodOfMeasurement = text(row.MethodOfMeasurement)
  return {
    expressId: setId,
    name,
    kind: psetKind(name, hasQuantities),
    isQuantity: hasQuantities,
    ...(methodOfMeasurement ? { methodOfMeasurement } : {}),
    entries,
    measures
  }
}

/* ────────────────────────────── materials ────────────────────────────── */

/**
 * `IfcRelAssociatesMaterial.RelatingMaterial` in every form the matrix lists: a material,
 * a layer set (or its usage), a profile set (or its usage), a constituent set, a list.
 */
function readMaterial(
  src: ReadOnlyIfcSource,
  modelID: number,
  id: number,
  units: Units,
  depth = 0
): MaterialRef | null {
  if (!id || depth > 4) return null
  const row = src.line(modelID, id)
  if (!row) return null
  const kind = src.typeName(src.lineType(modelID, id))

  // The *Usage forms point at the set that carries the layers/profiles.
  const forSet = ref(row.ForLayerSet) || ref(row.ForProfileSet)
  if (forSet) {
    const inner = readMaterial(src, modelID, forSet, units, depth + 1)
    return inner ? { ...inner, kind } : { kind, name: '' }
  }

  const partIds = [
    ...refs(row.MaterialLayers),
    ...refs(row.MaterialProfiles),
    ...refs(row.MaterialConstituents)
  ]
  if (partIds.length) {
    const layers = partIds.map((partId) => {
      const part = src.line(modelID, partId)
      const material = part ? src.line(modelID, ref(part.Material)) : null
      const thickness = part ? numberOf(part.LayerThickness) : null
      return {
        name: part ? text(part.Name) : '',
        material: material ? text(material.Name) : '',
        ...(thickness !== null ? { thickness: thickness * units.length } : {})
      }
    })
    const setName = text(row.LayerSetName) || text(row.Name)
    return {
      kind,
      name: setName || [...new Set(layers.map((l) => l.material || l.name).filter(Boolean))].join(' + '),
      layers
    }
  }

  // IfcMaterialList — a bare list of materials, no thicknesses.
  const listIds = refs(row.Materials)
  if (listIds.length) {
    const names = listIds
      .map((m) => {
        const mat = src.line(modelID, m)
        return mat ? text(mat.Name) : ''
      })
      .filter(Boolean)
    return { kind, name: [...new Set(names)].join(' + ') }
  }

  const name = text(row.Name)
  return name ? { kind, name } : { kind, name: '' }
}

/** The design's single `material` display string. `''` when the file names none. */
function materialDisplay(materials: readonly MaterialRef[]): string {
  for (const m of materials) if (m.name) return m.name
  for (const m of materials) {
    const fromLayers = [...new Set((m.layers ?? []).map((l) => l.material || l.name).filter(Boolean))]
    if (fromLayers.length) return fromLayers.join(' + ')
  }
  return ''
}

/* ────────────────────────────── classification ────────────────────────────── */

function readClassification(
  src: ReadOnlyIfcSource,
  modelID: number,
  id: number
): ClassificationRef | null {
  const row = src.line(modelID, id)
  if (!row) return null
  // Schema-aware: IFC4 calls it `Identification`, IFC2X3 `ItemReference`.
  const identification = text(row.Identification) || text(row.ItemReference)
  const sourceLine = src.line(modelID, ref(row.ReferencedSource))
  const system = sourceLine ? text(sourceLine.Name) || text(sourceLine.Source) : ''
  const name = text(row.Name)
  const location = text(row.Location)
  if (!identification && !name && !system) return null
  return { system, identification, name, location }
}

/* ────────────────────────────── placements and grids ────────────────────────────── */

const IDENTITY_M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** parent · child, both column-major. */
function multiply(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(16)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[row] * b[col * 4] +
        a[4 + row] * b[col * 4 + 1] +
        a[8 + row] * b[col * 4 + 2] +
        a[12 + row] * b[col * 4 + 3]
    }
  }
  return out
}

/**
 * A product's world placement as a column-major 4×4, in metres.
 *
 * Geometry gets this for free — web-ifc bakes it into every mesh's `flatTransformation`.
 * Anything read out of the entity graph (grid axes, the site's placement) does not, and
 * without it a grid lands wherever the shared-coordinate offset happens to be — 33 km away
 * on the reference model.
 */
export function placementMatrix(
  src: ReadOnlyIfcSource,
  modelID: number,
  placementId: number,
  scale: number,
  depth = 0
): number[] {
  if (!placementId || depth > 24) return [...IDENTITY_M4]
  const p = src.line(modelID, placementId)
  if (!p) return [...IDENTITY_M4]

  const axis = src.line(modelID, ref(p.RelativePlacement))
  let local = [...IDENTITY_M4]
  if (axis) {
    const location = src.line(modelID, ref(axis.Location))
    const c = (location?.Coordinates as unknown[]) ?? []
    const zRow = src.line(modelID, ref(axis.Axis))?.DirectionRatios as unknown[] | undefined
    const xRow = src.line(modelID, ref(axis.RefDirection))?.DirectionRatios as unknown[] | undefined
    const n = (v: unknown): number => numberOf(v) ?? 0
    const norm = (v: number[]): number[] => {
      const l = Math.hypot(v[0], v[1], v[2]) || 1
      return [v[0] / l, v[1] / l, v[2] / l]
    }
    const z = zRow ? norm([n(zRow[0]), n(zRow[1]), n(zRow[2])]) : [0, 0, 1]
    let x = xRow ? [n(xRow[0]), n(xRow[1]), n(xRow[2])] : [1, 0, 0]
    // Gram-Schmidt: RefDirection need not be perpendicular to Axis, and often is not.
    const d = x[0] * z[0] + x[1] * z[1] + x[2] * z[2]
    x = norm([x[0] - d * z[0], x[1] - d * z[1], x[2] - d * z[2]])
    const y = [
      z[1] * x[2] - z[2] * x[1],
      z[2] * x[0] - z[0] * x[2],
      z[0] * x[1] - z[1] * x[0]
    ]
    local = [
      x[0], x[1], x[2], 0,
      y[0], y[1], y[2], 0,
      z[0], z[1], z[2], 0,
      n(c[0]) * scale, n(c[1]) * scale, n(c[2]) * scale, 1
    ]
  }

  return multiply(placementMatrix(src, modelID, ref(p.PlacementRelTo), scale, depth + 1), local)
}

const applyXY = (m: readonly number[], x: number, y: number): XY => [
  m[0] * x + m[4] * y + m[12],
  m[1] * x + m[5] * y + m[13]
]

/**
 * The endpoints of an `IfcGridAxis` curve, in metres. Three curve forms turn up in the wild:
 * `IfcIndexedPolyCurve` (what Revit writes — `Points` is ONE reference to a point list, not
 * a list of point references), `IfcPolyline`, and `IfcLine`.
 */
function axisSegment(
  src: ReadOnlyIfcSource,
  modelID: number,
  curveId: number,
  scale: number
): [XY, XY] | null {
  const curve = src.line(modelID, curveId)
  if (!curve) return null
  const pt = (x: unknown, y: unknown): XY => [(numberOf(x) ?? 0) * scale, (numberOf(y) ?? 0) * scale]

  const listId = ref(curve.Points)
  if (listId) {
    const list = src.line(modelID, listId)
    const coords = list?.CoordList as unknown[] | undefined
    if (Array.isArray(coords) && coords.length >= 2) {
      const a = coords[0] as unknown[]
      const b = coords[coords.length - 1] as unknown[]
      if (Array.isArray(a) && Array.isArray(b) && a.length >= 2 && b.length >= 2)
        return [pt(a[0], a[1]), pt(b[0], b[1])]
    }
  }

  const pts = refs(curve.Points)
  if (pts.length >= 2) {
    const a = src.line(modelID, pts[0])
    const b = src.line(modelID, pts[pts.length - 1])
    const ac = (a?.Coordinates as unknown[]) ?? []
    const bc = (b?.Coordinates as unknown[]) ?? []
    if (ac.length >= 2 && bc.length >= 2) return [pt(ac[0], ac[1]), pt(bc[0], bc[1])]
  }

  const origin = src.line(modelID, ref(curve.Pnt))
  const vector = src.line(modelID, ref(curve.Dir))
  if (origin && vector) {
    const oc = (origin.Coordinates as unknown[]) ?? []
    const dir = src.line(modelID, ref(vector.Orientation))
    const dc = (dir?.DirectionRatios as unknown[]) ?? []
    const magnitude = numberOf(vector.Magnitude) ?? 1
    if (oc.length >= 2 && dc.length >= 2) {
      const start = pt(oc[0], oc[1])
      return [
        start,
        [
          start[0] + (numberOf(dc[0]) ?? 0) * magnitude * scale,
          start[1] + (numberOf(dc[1]) ?? 0) * magnitude * scale
        ]
      ]
    }
  }
  return null
}

/** Within a millimetre over the axis's length, the line is axis-aligned. */
const AXIS_TOLERANCE_M = 0.001

export function readGrids(src: ReadOnlyIfcSource, modelID: number, scale: number): GridAxisRecord[] {
  const out: GridAxisRecord[] = []
  const seen = new Set<string>()
  const gridCode = src.typeCode('IFCGRID')
  if (!gridCode) return out

  for (const gridId of src.idsWithType(modelID, gridCode, true)) {
    const grid = src.line(modelID, gridId)
    if (!grid) continue
    const place = placementMatrix(src, modelID, ref(grid.ObjectPlacement), scale)
    for (const [family, key] of [
      ['u', 'UAxes'],
      ['v', 'VAxes'],
      ['w', 'WAxes']
    ] as const) {
      for (const axisId of refs(grid[key])) {
        const axis = src.line(modelID, axisId)
        if (!axis) continue
        const name = text(axis.AxisTag)
        const raw = axisSegment(src, modelID, ref(axis.AxisCurve), scale)
        if (!name || !raw) continue
        const start = applyXY(place, raw[0][0], raw[0][1])
        const end = applyXY(place, raw[1][0], raw[1][1])
        // Real files repeat the whole grid on every storey; one axis per tag is enough.
        const dedupe = family + ':' + name
        if (seen.has(dedupe)) continue
        seen.add(dedupe)

        // A grid axis is a segment, not a coordinate: one reference model's grid runs at 43°.
        const dx = Math.abs(end[0] - start[0])
        const dy = Math.abs(end[1] - start[1])
        const axisKind = dx <= AXIS_TOLERANCE_M ? 'x' : dy <= AXIS_TOLERANCE_M ? 'y' : null
        out.push({
          name,
          axis: axisKind,
          v: axisKind === 'x' ? start[0] : axisKind === 'y' ? start[1] : null,
          start,
          end,
          family,
          gridExpressId: gridId
        })
      }
    }
  }
  return out
}

/* ────────────────────────────── georeferencing ────────────────────────────── */

/** `IfcCompoundPlaneAngleMeasure` — degrees, minutes, seconds, millionths — to decimal. */
export function dmsToDecimal(dms: readonly number[]): number {
  const [d = 0, m = 0, s = 0, micro = 0] = dms
  const magnitude = Math.abs(d) + Math.abs(m) / 60 + Math.abs(s) / 3600 + Math.abs(micro) / 3.6e9
  const negative = dms.some((v) => v < 0)
  return negative ? -magnitude : magnitude
}

/**
 * The `Model` context's `TrueNorth`, normalised, or `null`. A file states it in the context's
 * own coordinates, so it is only a statement about the project frame when nothing else rotates
 * — which is the one case `shared/georef.ts` reads it in.
 */
function readTrueNorth(
  src: ReadOnlyIfcSource,
  modelID: number
): readonly [number, number] | null {
  const code = src.typeCode('IFCGEOMETRICREPRESENTATIONCONTEXT')
  if (!code) return null
  for (const id of src.idsWithType(modelID, code, true)) {
    const ctx = src.line(modelID, id)
    if (!ctx || text(ctx.ContextType).toLowerCase() !== 'model') continue
    const dir = src.line(modelID, ref(ctx.TrueNorth))
    const ratios = (dir?.DirectionRatios as unknown[]) ?? []
    if (ratios.length < 2) continue
    const x = numberOf(ratios[0]) ?? 0
    const y = numberOf(ratios[1]) ?? 0
    const length = Math.hypot(x, y)
    if (!length) continue
    return [x / length, y / length]
  }
  return null
}

/** Below this an `atan2` result is no rotation — the same epsilon `shared/georef.ts` uses. */
const ROTATION_EPSILON_DEG = 1e-9

/**
 * Where the model's coordinates come from. Every source found is recorded and none is
 * invented: a file with no georeferencing reports `'none'`, not a default origin.
 *
 * `method` — which of them is actually *in force* — is `shared/georef.ts`'s `detectMethod`
 * over what this reads, so the card's caption, the assistant's readout and the frame the
 * geometry is streamed in cannot disagree about what the file does.
 */
function readGeoreference(
  src: ReadOnlyIfcSource,
  modelID: number,
  units: Units,
  /** The property sets of the project, site, building and storeys, in that order. */
  containerPsets: readonly Record<string, Record<string, PropValue>>[],
  /** The spatial-root `IfcSite` — the one `IfcProject` aggregates. 0 when there is none. */
  rootSiteId: number
): Georeference {
  const sources: GeorefSource[] = []
  let out: Georeference = { source: 'none', sources: [], method: 'none' }

  /* IFC4 / IFC4X3 — IfcMapConversion + IfcProjectedCRS. */
  const conversionCode = src.typeCode('IFCMAPCONVERSION')
  const conversionId = conversionCode ? src.idsWithType(modelID, conversionCode, true)[0] : 0
  const conversion = conversionId ? src.line(modelID, conversionId) : null
  if (conversion) {
    sources.push('IfcMapConversion')
    // Eastings/Northings/Height are already in map units; `Scale` is the file-unit → map-unit
    // factor and is independent of the length unit, so none of these is scaled here.
    const abscissa = numberOf(conversion.XAxisAbscissa)
    const ordinate = numberOf(conversion.XAxisOrdinate)
    out = {
      ...out,
      source: 'IfcMapConversion',
      eastings: numberOf(conversion.Eastings) ?? undefined,
      northings: numberOf(conversion.Northings) ?? undefined,
      orthogonalHeight: numberOf(conversion.OrthogonalHeight) ?? undefined,
      ...(abscissa !== null ? { xAxisAbscissa: abscissa } : {}),
      ...(ordinate !== null ? { xAxisOrdinate: ordinate } : {}),
      ...(abscissa !== null && ordinate !== null
        ? { rotationDeg: (Math.atan2(ordinate, abscissa) * 180) / Math.PI }
        : {}),
      scale: numberOf(conversion.Scale) ?? undefined
    }
    const crsLine = src.line(modelID, ref(conversion.TargetCRS))
    if (crsLine) {
      out = {
        ...out,
        crs: {
          name: text(crsLine.Name),
          description: text(crsLine.Description),
          geodeticDatum: text(crsLine.GeodeticDatum),
          verticalDatum: text(crsLine.VerticalDatum),
          mapProjection: text(crsLine.MapProjection),
          mapZone: text(crsLine.MapZone)
        }
      }
    }
  }

  /* IFC2X3 — the ePset convention, either spelling. */
  if (!conversion) {
    // The IFC2X3 convention, spelled `ePset_MapConversion` or `ePSet_MapConversion`.
    for (const psets of containerPsets) {
      for (const [setName, entries] of Object.entries(psets)) {
        if (!/^epset_mapconversion$/i.test(setName)) continue
        sources.push('ePset')
        const n = (k: string): number | undefined => {
          const v = entries[k]
          if (typeof v === 'number') return v
          if (typeof v !== 'string') return undefined
          const parsed = parseFloat(v)
          return isNaN(parsed) ? undefined : parsed
        }
        out = {
          ...out,
          source: 'ePset',
          epsetName: setName,
          eastings: n('Eastings'),
          northings: n('Northings'),
          orthogonalHeight: n('OrthogonalHeight'),
          xAxisAbscissa: n('XAxisAbscissa'),
          xAxisOrdinate: n('XAxisOrdinate'),
          scale: n('Scale')
        }
        break
      }
      if (out.source === 'ePset') break
    }
  }

  /* IfcSite — RefLatitude/RefLongitude/RefElevation and the placement CORENET X uses. */
  const siteCode = src.typeCode('IFCSITE')
  // The spatial root if the project names one; only otherwise the first by expressId, which
  // is a guess a file with a single site makes correct and one with 16 does not.
  const siteId = rootSiteId || (siteCode ? src.idsWithType(modelID, siteCode, true)[0] : 0)
  const siteLine = siteId ? src.line(modelID, siteId) : null
  if (siteLine) {
    const lat = authored(siteLine.RefLatitude)
    const lon = authored(siteLine.RefLongitude)
    const elevation = numberOf(siteLine.RefElevation)
    const placementId = ref(siteLine.ObjectPlacement)
    const m = placementId ? placementMatrix(src, modelID, placementId, units.length) : null
    /*
     * A shared-coordinates export carries the project's rotation to true north on this
     * placement as well as its position, and dropping the rotation is what left the whole
     * model standing at 43° to its own grid. The rotation is read off the composed matrix's
     * X column; `pureZRotation` records whether one angle can express it at all — a tilted
     * site keeps its translation and is read as no rotation rather than a guessed one.
     */
    const rotationDeg = m ? (Math.atan2(m[1], m[0]) * 180) / Math.PI : 0
    const pureZ = m
      ? Math.abs(m[2]) < 1e-9 &&
        Math.abs(m[6]) < 1e-9 &&
        Math.abs(m[8]) < 1e-9 &&
        Math.abs(m[9]) < 1e-9 &&
        Math.abs(m[10] - 1) < 1e-9
      : true
    const site: Georeference['site'] = {
      ...(siteId ? { expressId: siteId } : {}),
      ...(Array.isArray(lat) ? { latitude: dmsToDecimal(lat.map(Number)) } : {}),
      ...(Array.isArray(lon) ? { longitude: dmsToDecimal(lon.map(Number)) } : {}),
      ...(elevation !== null ? { elevation: elevation * units.length } : {}),
      ...(m && (m[12] !== 0 || m[13] !== 0 || m[14] !== 0)
        ? { placement: [m[12], m[13], m[14]] as [number, number, number] }
        : {}),
      ...(Math.abs(rotationDeg) >= ROTATION_EPSILON_DEG ? { rotationDeg } : {}),
      ...(pureZ ? {} : { pureZRotation: false })
    }
    // `expressId` alone is not a georeferencing declaration, so it does not make a source.
    if (Object.keys(site).filter((k) => k !== 'expressId').length) {
      sources.push('IfcSite')
      out = { ...out, site, ...(out.source === 'none' ? { source: 'IfcSite' } : {}) }
    }
  }

  const trueNorth = readTrueNorth(src, modelID)
  const found: Georeference = { ...out, sources, ...(trueNorth ? { trueNorth } : {}) }
  return { ...found, method: detectMethod(found) }
}

/* ────────────────────────────── raw STEP lines, on demand ────────────────────────────── */

/** A referenced entity, one level deep: its own authored attributes, no further handles. */
export interface RawReference {
  expressId: number
  type: string
  values: Record<string, PropValue>
}

export type RawAttribute = PropValue | RawReference | readonly RawAttribute[] | null

export interface RawLine {
  expressId: number
  type: string
  attributes: Record<string, RawAttribute>
}

/**
 * The shallow `GetLine` for one entity with its references resolved **one level**, for the
 * assistant's `get_entity_raw` tool and for debugging a file by hand.
 *
 * One level, never recursive: the flatten path's batched line fetch throws
 * `Cannot convert "1,2,3" to unsigned int` on real Revit exports.
 */
export function readRawLine(
  src: ReadOnlyIfcSource,
  modelID: number,
  expressId: number
): RawLine | null {
  const row = src.line(modelID, expressId)
  if (!row) return null

  const reference = (id: number): RawReference | null => {
    const target = src.line(modelID, id)
    if (!target) return null
    const values: Record<string, PropValue> = {}
    for (const [key, value] of Object.entries(target)) {
      if (key === 'expressID' || key === 'type') continue
      const a = authored(value)
      if (a !== null) values[key] = a
    }
    return { expressId: id, type: src.typeName(src.lineType(modelID, id)), values }
  }

  const resolve = (value: unknown): RawAttribute => {
    if (Array.isArray(value)) return value.map(resolve)
    const id = ref(value)
    if (id) return reference(id)
    return authored(value)
  }

  const attributes: Record<string, RawAttribute> = {}
  for (const [key, value] of Object.entries(row)) {
    if (key === 'expressID' || key === 'type') continue
    attributes[key] = resolve(value)
  }
  return { expressId, type: src.typeName(src.lineType(modelID, expressId)), attributes }
}
