/**
 * The `ModelIndex` — everything the app knows about one IFC file except its geometry.
 *
 * Shape follows plan §1 (the IFC conformance matrix) and §3.3. The element shape is the
 * design's own (`design-reference/BUILD_PLAN.md` §2.1: `id, guid, tag, model, name, type,
 * predefinedType, objectType, storey, material, psets, qto`) plus the provenance the
 * assistant and the exports need.
 *
 * Two rules govern every field here:
 *   · **Nothing is invented.** A value the file does not carry is `''` or `undefined`,
 *     never a placeholder, a default origin or a synthesised GUID.
 *   · **Values are as authored.** Property and quantity values keep the file's own units;
 *     `measures` names the IFC measure type so `shared/units.ts` can convert for display.
 */

/* ────────────────────────────── immutability ────────────────────────────── */

/**
 * Recursive `readonly`. Typed arrays and buffers pass through untouched — freezing them
 * is meaningless (the elements stay writable) and mapping over them destroys the type.
 */
export type DeepReadonly<T> = T extends ArrayBuffer | ArrayBufferView
  ? T
  : // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    T extends Function
    ? T
    : T extends (infer R)[]
      ? readonly DeepReadonly<R>[]
      : T extends object
        ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
        : T

/* ────────────────────────────── primitives ────────────────────────────── */

/** A property value exactly as the file authored it. Lists stay lists. */
export type PropValue = string | number | boolean | readonly (string | number | boolean)[]

/** Prefix families the conformance matrix asks us to tell apart. */
export type PsetKind = 'SGPset' | 'Pset' | 'Qto' | 'other'

/** One property set or quantity set as it landed on one element. */
export interface PsetInstance {
  /** expressId of the `IfcPropertySet` / `IfcElementQuantity` the values came from. */
  sourceExpressId: number
  /** True when the set arrived through the element's type object, not the occurrence. */
  inherited: boolean
  kind: PsetKind
  /** `IfcElementQuantity.MethodOfMeasurement`, when the file states one. */
  methodOfMeasurement?: string
  /**
   * Per key, the IFC measure type as authored — `IFCLENGTHMEASURE`, `IFCAREAMEASURE`,
   * `IFCTHERMALTRANSMITTANCEMEASURE`, … Keys with no measure type are absent. This is
   * what lets a number be converted with the model's own unit assignment.
   */
  measures: Record<string, string>
}

/* ────────────────────────────── units ────────────────────────────── */

/** One entry of `IfcUnitAssignment`, kept whole. */
export interface UnitEntry {
  /** `LENGTHUNIT`, `AREAUNIT`, `PLANEANGLEUNIT`, … */
  unitType: string
  /** `IfcSIUnit` | `IfcConversionBasedUnit` | `IfcDerivedUnit`. */
  entity: string
  /** `METRE`, `DEGREE`, … as authored. */
  name: string
  /** SI prefix, e.g. `MILLI`. `''` when there is none. */
  prefix: string
  /**
   * SI units per file unit: 0.001 for millimetres, 0.0174532925… for degrees. `undefined`
   * for a derived unit we do not resolve — the value is still reported as authored.
   */
  factor?: number
}

/** The file's unit assignment, plus the three scales the viewer needs constantly. */
export interface Units {
  /** By `unitType`, e.g. `byType.LENGTHUNIT`. */
  byType: Record<string, UnitEntry>
  /** Metres per file length unit. */
  length: number
  /** Square metres per file area unit — read, never derived from `length²`. */
  area: number
  /** Cubic metres per file volume unit. */
  volume: number
  /** Radians per file plane-angle unit. */
  angle: number
}

/* ────────────────────────────── header ────────────────────────────── */

/** ISO 10303-21 header, read verbatim. */
export interface IfcHeader {
  /** `FILE_DESCRIPTION` description strings, in file order. */
  description: readonly string[]
  /** The MVD inside `ViewDefinition[…]`, e.g. `ReferenceView_V1.2`. `''` when absent. */
  viewDefinition: string
  implementationLevel: string
  /** `FILE_NAME` fields. */
  name: string
  timeStamp: string
  author: readonly string[]
  organization: readonly string[]
  preprocessorVersion: string
  originatingSystem: string
  authorization: string
  /** `FILE_SCHEMA` identifiers, e.g. `['IFC4']`. */
  fileSchema: readonly string[]
}

/* ────────────────────────────── spatial structure ────────────────────────────── */

export interface SpatialNode {
  expressId: number
  guid: string
  /** `IfcProject` | `IfcSite` | `IfcBuilding` | `IfcBuildingStorey` | `IfcSpace`. */
  type: string
  name: string
  longName: string
  /**
   * `IfcSpatialStructureElement.CompositionType` as authored — `COMPLEX` | `ELEMENT` |
   * `PARTIAL`. Absent on `IfcProject`, which is not a spatial structure element, and on any
   * file that leaves the optional attribute unset.
   */
  compositionType?: string
  /** Storeys only: `IfcBuildingStorey.Elevation` converted to metres. */
  elevation?: number
  children: readonly SpatialNode[]
}

/** The design's storey row (`{ name, elev, h }`), elevations in metres. */
export interface Storey {
  expressId: number
  guid: string
  name: string
  /** `IfcBuildingStorey.Elevation` as authored, converted to metres. What the ladder shows. */
  elev: number
  /**
   * The storey's own `IfcLocalPlacement` translation in world coordinates, metres, Z-up —
   * where its floor geometry actually is. Absent when the file gives the storey no placement.
   *
   * It is **not** `elev`: `Elevation` is stated relative to whatever the storey is placed in,
   * so on a Revit shared-coordinates export — where the site placement carries a 5.05 m
   * elevation as well as the rotation — the two differ by exactly that. The level ring and the
   * level section plane come from here, put through the project frame; the ladder keeps
   * displaying the authored `Elevation`.
   */
  placement?: readonly [number, number, number]
  /** `IfcBuildingStorey.CompositionType` as authored; absent when the file leaves it unset. */
  compositionType?: string
  /**
   * Metres to the next storey up. Derived from consecutive elevations — a real file does
   * not declare a storey height — and `undefined` for the topmost storey.
   */
  h?: number
}

/* ────────────────────────────── grids ────────────────────────────── */

export type XY = readonly [number, number]

/**
 * One `IfcGridAxis`, in metres, with its `IfcLocalPlacement` chain applied by hand
 * (web-ifc bakes placements into geometry only).
 */
export interface GridAxisRecord {
  /** `IfcGridAxis.AxisTag`. */
  name: string
  /** `'x'` = the line sits at constant X (the design's convention). `null` = not axis-aligned. */
  axis: 'x' | 'y' | null
  /** The constant coordinate, metres. `null` when the axis is not axis-aligned. */
  v: number | null
  start: XY
  end: XY
  family: 'u' | 'v' | 'w'
  gridExpressId: number
}

/* ────────────────────────────── georeferencing ────────────────────────────── */

export type GeorefSource = 'IfcMapConversion' | 'IfcSite' | 'ePset' | 'WorldCoordinateSystem' | 'none'

/**
 * Which declaration actually carries the model's position — `shared/georef.ts`'s
 * `detectMethod`. `source` / `sources` say what was *found*; this says what is *in force*,
 * because a file can declare an `IfcMapConversion` that converts nothing (the reference model
 * does) while its site placement carries the real position and rotation.
 *
 * The values are the strings the Coordinate-system card appends to its caption and
 * `get_model_info` reports, so there is one spelling and it cannot drift. The two
 * `WorldCoordinateSystem` ones are 2026-10-08's (rule 4): a Revit export from the Survey Point,
 * Project Base Point or Internal Origin with no EPSG code, and every Revit IFC2X3 one, carries its
 * map position there and nowhere else.
 */
export type GeorefMethod =
  | 'IfcSite placement'
  | 'IfcMapConversion'
  | 'IfcMapConversion + IfcSite placement'
  | 'ePset_MapConversion'
  | 'WorldCoordinateSystem'
  | 'WorldCoordinateSystem + IfcSite placement'
  | 'none'

export interface ProjectedCrs {
  name: string
  description: string
  geodeticDatum: string
  verticalDatum: string
  mapProjection: string
  mapZone: string
}

/**
 * The **spatial-root** `IfcSite` — the one `IfcProject` aggregates.
 *
 * Not the first by expressId: a Revit export can carry a dozen more (the reference model has
 * 16, the extras being road-marking families exported as sites), and only one of them is the
 * spatial root whose placement everything else chains up to.
 */
export interface SiteGeoref {
  /** The spatial-root site's own `expressId`, so a reader can check which one this is. */
  expressId?: number
  /** Decimal degrees, converted from the `IfcCompoundPlaneAngleMeasure` DMS list. */
  latitude?: number
  longitude?: number
  /** `RefElevation`, metres. */
  elevation?: number
  /**
   * `IfcSite.ObjectPlacement` translation in world coordinates, metres — the CORENET X
   * convention. Absent when the site sits at the file's own origin.
   */
  placement?: readonly [number, number, number]
  /**
   * Rotation of the placement about `+Z`, degrees, counter-clockwise positive. Absent when
   * the placement does not rotate. A Revit shared-coordinates export carries the project's
   * rotation to true north here, alongside the translation — both, not one or the other.
   */
  rotationDeg?: number
  /**
   * False when the placement is not a pure rotation about `+Z` (a tilted site). The rotation
   * is then not usable as one angle and is read as none; the translation still stands.
   */
  pureZRotation?: boolean
}

/**
 * The 3D `Model` context's `WorldCoordinateSystem` (2026-10-08), recorded only when it is not the
 * identity — which IFC says it normally is. Revit writes the chosen point's Easting, Northing and
 * Elevation as its `Location`, in project length units, whenever it writes no `IfcMapConversion`.
 * web-ifc does not apply it to any placement (`docs/TRAPS.md`), so it is applied — or, beside a
 * map conversion, undone — in `shared/georef.ts`'s `mapPlacement`.
 */
export interface WcsGeoref {
  /** Its `Location`, metres (the project length unit applied). */
  origin: readonly [number, number, number]
  /** Its turn about `+Z`, degrees, counter-clockwise positive. Absent when it does not turn. */
  rotationDeg?: number
  /** False when its axes are not a pure turn about `+Z`: the turn is then read as none. */
  pureZRotation?: boolean
}

/**
 * Where the file's coordinates come from. `source` is the strongest declaration present;
 * `sources` lists every one found, so a declared CRS can be told from an inferred one.
 * A file with none reports `'none'` — never a default origin.
 */
export interface Georeference {
  source: GeorefSource
  sources: readonly GeorefSource[]
  /**
   * Which declaration is actually in force — `shared/georef.ts`'s `detectMethod` over the
   * fields below. `'none'` when every one of them is identity.
   */
  method: GeorefMethod
  /**
   * `IfcMapConversion`, as written, in the map unit (`mapUnit`; the metre when the file names
   * none). Not scaled by the model's length unit, nor by `scale`.
   */
  eastings?: number
  northings?: number
  orthogonalHeight?: number
  xAxisAbscissa?: number
  xAxisOrdinate?: number
  /**
   * Degrees anticlockwise about `+Z`, from map east to the engineering `+X` axis:
   * `atan2(xAxisOrdinate, xAxisAbscissa)`, derived from the two axis components.
   */
  rotationDeg?: number
  /**
   * `IfcMapConversion.Scale` as written. Reported, **never applied** (2026-10-08): exporters
   * write it as absent, 0.001 and 1000 for the same millimetre model in a metre CRS.
   */
  scale?: number
  /**
   * `IfcProjectedCRS.MapUnit` — IFC2X3: `ePset_ProjectedCRS`'s `MapUnit`, a name — as the file
   * names it (an SI unit as prefix + name, `MILLIMETRE`), and `metres` per one of it when it
   * reads as a length. Absent when the file names no map unit: Eastings, Northings and
   * OrthogonalHeight are then metres (`shared/georef.ts`, `mapPlacement`).
   */
  mapUnit?: { name: string; metres?: number }
  crs?: ProjectedCrs
  site?: SiteGeoref
  /**
   * The `Model` `IfcGeometricRepresentationContext`'s `TrueNorth` direction, normalised, in
   * that context's own coordinates. `(0, 1)` — which is what a file whose world coordinates
   * are already map-aligned states — means "true north is context north".
   */
  trueNorth?: readonly [number, number]
  /** The `Model` context's `WorldCoordinateSystem`, when it is not the identity (2026-10-08). */
  wcs?: WcsGeoref
  /** The IFC2X3 pset the values came from, e.g. `ePset_MapConversion`. */
  epsetName?: string
}

/* ────────────────────────────── elements ────────────────────────────── */

export interface MaterialRef {
  /** `IfcMaterial` | `IfcMaterialLayerSet` | `IfcMaterialLayerSetUsage` | … */
  kind: string
  name: string
  /** Layer / profile / constituent parts, in file order. */
  layers?: readonly { name: string; material: string; thickness?: number }[]
}

export interface ClassificationRef {
  /** `IfcClassification.Name`, e.g. `Uniformat`. */
  system: string
  /** `Identification` (IFC4+) or `ItemReference` (IFC2X3). */
  identification: string
  name: string
  location: string
}

export interface GroupRef {
  expressId: number
  guid: string
  /** `IfcSystem` | `IfcZone` | `IfcGroup` | … */
  type: string
  name: string
}

export interface Decomposition {
  /** `IfcRelAggregates.RelatingObject` — the assembly this element is part of. */
  parent?: number
  /** `IfcRelAggregates.RelatedObjects` — the parts of this assembly. */
  children: readonly number[]
  /** `IfcRelVoidsElement` — openings cut into this element. */
  openings: readonly number[]
  /**
   * `IfcRelFillsElement`. For a door or window, the opening it fills; for an opening, what
   * fills it. Openings are not indexed as elements, so in practice this is the first form.
   */
  fillings: readonly number[]
}

export interface IfcElement {
  /** Federation-unique id. Equal to `expressId` until the federation offsets it (1b). */
  id: number
  expressId: number
  /** `IfcRoot.GlobalId`, verbatim — never regenerated. */
  guid: string
  /** False when the GlobalId is not 22 characters of the IFC base-64 alphabet. */
  guidValid: boolean
  tag: string
  /** Source file key — drives colour, visibility and activate. */
  model: string
  name: string
  description: string
  /** Exact IFC entity, e.g. `IfcWall`. */
  type: string
  /** `USERDEFINED` resolved to `ObjectType` / the type object's `ElementType`. */
  predefinedType: string
  /** Type family: `IfcTypeObject.Name`, falling back to the occurrence's `ObjectType`. */
  objectType: string
  /** `IfcTypeObject.GlobalId`, when the element has a type object. */
  typeGuid: string
  storey: string
  /** The single display string the design shows. `''` when the file names no material. */
  material: string
  materials: readonly MaterialRef[]
  classifications: readonly ClassificationRef[]
  systems: readonly GroupRef[]
  decomposition: Decomposition
  /** `psets[setName][key]` = value as authored. */
  psets: Record<string, Record<string, PropValue>>
  /** Same shape, for `IfcElementQuantity`. */
  qto: Record<string, Record<string, PropValue>>
  /** Provenance per set name, covering both `psets` and `qto`. */
  psetMeta: Record<string, PsetInstance>
  /** True for `IfcSpace`: recorded, but not a physical element. */
  isSpace?: boolean
  /**
   * Axis-aligned bounding box in the **project frame**, metres, Z-up — the frame the scene is
   * drawn in, before the federation offset is subtracted.
   *
   * It is the union of the element's part boxes from the geometry stream, written onto the
   * index by `renderer/model/element-boxes.ts` as the chunks land and before the index is
   * frozen; the dev mock federation composes the same box from its own boxes, in the same
   * frame (the identity) and the same units. A part box is the AABB of the *transformed local*
   * AABB, so a part rotated about anything but `+Z` reports a box at least as large as the
   * exact one — every consumer states that it is box arithmetic.
   *
   * Absent when the element has no geometry. Never a placeholder.
   */
  bbox?: readonly [number, number, number, number, number, number]
  /** Number of solids in the element's tessellation (1b). */
  solidCount?: number
}

/* ────────────────────────────── the index ────────────────────────────── */

export interface ModelCounts {
  /** Every STEP line in the file. */
  entities: number
  elements: number
  spaces: number
  openings: number
  psets: number
  quantitySets: number
  byType: Record<string, number>
}

export interface ProjectInfo {
  expressId: number
  guid: string
  name: string
  longName: string
  phase: string
  description: string
}

export interface ModelIndexMeta {
  /** Stable key for this loaded file; the element's `model` field. */
  modelKey: string
  fileName: string
  /** Lower-case hex SHA-256 of the file's bytes. */
  sha256: string
  /** `IFC2X3` | `IFC4` | `IFC4X3` … as web-ifc reports it. */
  schema: string
  header: IfcHeader
  units: Units
  project: ProjectInfo | null
  site: SpatialNode | null
  building: SpatialNode | null
  /** `IfcProject` root of the aggregation tree, or `null` when the file has no project. */
  spatial: SpatialNode | null
  storeys: readonly Storey[]
  grids: readonly GridAxisRecord[]
  georef: Georeference
  /**
   * 2026-10-08 — how far, in metres, the centre of what this model drew stands from the
   * federation offset another model set, when that is past `FAR_PLACEMENT_METRES` (the geometry
   * stream's `farPlacement` warning, `worker/geometry-streamer.ts`). Written by the renderer once
   * the model has streamed and before the index is frozen (`model/federation-store.ts`), as each
   * element's `bbox` is. Absent when it is nearer, when this model set the offset itself, and
   * before it has streamed. It is what says a model "sits 12.3 km from the others".
   */
  farPlacementMetres?: number
  /** The seven design attributes plus every pset/qto key in this model. */
  propKeys: readonly string[]
  counts: ModelCounts
}

/** The full index: the metadata above plus every element. */
export interface ModelIndex extends ModelIndexMeta {
  elements: readonly IfcElement[]
}

/** What the renderer stores: the same thing, frozen. */
export type FrozenModelIndex = DeepReadonly<ModelIndex>
