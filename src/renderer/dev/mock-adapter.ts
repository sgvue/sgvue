/**
 * The design-parity adapter — and, since 2026-09-24, the landing page's demo building.
 *
 * The fidelity contract (`CLAUDE.md`) requires the app to render the prototype's own mock
 * federation through the app's real contract, so every phase can be reviewed side by side
 * against the prototype at the same size and state. This module is the bridge: it turns
 * `buildDisciplineModel(key)` from the design's `sample-model.js` into a `ModelIndex` and a
 * stream of geometry chunks shaped exactly like the ones the parse worker will send in 1b.
 *
 * **It ships.** 2026-09-24 (owner-requested: *"keep our sample model on the home page for
 * demo"*): the landing page's "try the demo building →" loads this federation in a production
 * build, through `model/demo.ts`, which is its one production importer and a lazy chunk. It
 * stays in `dev/` because the tests and the parity harnesses import it from here; what is
 * dev-only is the `#mock` entry in `App.tsx` and the hostile fixture, which lives in
 * `dev/hostile.ts` so its text is not in the production bundle.
 *
 * The mock has no file behind it, so everything a file would carry and this does not — the
 * SHA-256, the STEP entity count, georeferencing — stays empty rather than being made up.
 */
import type {
  GeometryChunk,
  GeometryRecord,
  PartRecord
} from '../../shared/geometry-contract.types'
import { collectPropKeys } from '../../shared/attr'
import type {
  GridAxisRecord,
  IfcElement,
  ModelCounts,
  ModelIndex,
  SpatialNode,
  Storey,
  Units
} from '../../shared/model-index.types'
import {
  COLORS,
  SAMPLE_FILES,
  buildDisciplineModel,
  type SampleBox,
  type SampleElement,
  type SampleModel
} from './sample-model.js'

export { SAMPLE_FILES }

/** Parts per geometry chunk, matching the worker's own chunking rule (plan §3.7). */
const PARTS_PER_CHUNK = 5000
/** Vertices per geometry chunk. */
const VERTICES_PER_CHUNK = 1_000_000

/**
 * The unit assignment the mock's numbers are authored in: its geometry is in metres, its
 * quantities in millimetres (`Length: 1500` for a 1.5 m footing) and square/cubic metres —
 * the same combination a Revit export writes.
 */
const MOCK_UNITS: Units = {
  byType: {
    LENGTHUNIT: {
      unitType: 'LENGTHUNIT',
      entity: 'IfcSIUnit',
      name: 'METRE',
      prefix: 'MILLI',
      factor: 0.001
    },
    AREAUNIT: {
      unitType: 'AREAUNIT',
      entity: 'IfcSIUnit',
      name: 'SQUARE_METRE',
      prefix: '',
      factor: 1
    },
    VOLUMEUNIT: {
      unitType: 'VOLUMEUNIT',
      entity: 'IfcSIUnit',
      name: 'CUBIC_METRE',
      prefix: '',
      factor: 1
    },
    PLANEANGLEUNIT: {
      unitType: 'PLANEANGLEUNIT',
      entity: 'IfcConversionBasedUnit',
      name: 'DEGREE',
      prefix: '',
      factor: Math.PI / 180
    }
  },
  length: 0.001,
  area: 1,
  volume: 1,
  angle: Math.PI / 180
}

/** The colour groups of one element: `{ color, boxes }`, whichever form the design used. */
function groupsOf(element: SampleElement): { color: string; boxes: SampleBox[] }[] {
  if (element.parts) return element.parts
  if (element.boxes) return [{ color: element.color ?? '', boxes: element.boxes }]
  return []
}

function bboxOf(element: SampleElement): [number, number, number, number, number, number] | null {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity
  for (const group of groupsOf(element)) {
    for (const b of group.boxes) {
      minX = Math.min(minX, b.p[0] - b.s[0] / 2)
      minY = Math.min(minY, b.p[1] - b.s[1] / 2)
      minZ = Math.min(minZ, b.p[2] - b.s[2] / 2)
      maxX = Math.max(maxX, b.p[0] + b.s[0] / 2)
      maxY = Math.max(maxY, b.p[1] + b.s[1] / 2)
      maxZ = Math.max(maxZ, b.p[2] + b.s[2] / 2)
    }
  }
  return minX === Infinity ? null : [minX, minY, minZ, maxX, maxY, maxZ]
}

/**
 * How many solids the property card reports. **One per colour group**, not one per box:
 * `viewer-core.js:119` merges each group's boxes into a single mesh with `mergeBoxes`, so the
 * prototype counts groups — a wall split around its opening by `wallBoxes`
 * (`sample-model.js:26–33`) is one solid there. That is also what the row means on a real
 * file, where it is the count of tessellated solids web-ifc reports for the product.
 */
const solidCountOf = (element: SampleElement): number => groupsOf(element).length

/**
 * How a caller may vary the mock. **Dev-only**: nothing in the production demo passes any of
 * it (`model/demo.ts`); the `#mock&hostile` fixture (`dev/hostile.ts`) is the one user.
 */
export interface MockOptions {
  /** Rewrite each element on its way into the index. */
  element?: (e: IfcElement) => IfcElement
  /** Appended to the `IfcBuilding` node's name. */
  buildingSuffix?: string
}

/* ────────────────────────────── the index ────────────────────────────── */

/** `buildDisciplineModel(key)` as a `ModelIndex`, with the design's own field values. */
export function mockModelIndex(key: string, options?: MockOptions): ModelIndex {
  const model: SampleModel = buildDisciplineModel(key)
  const file = SAMPLE_FILES.find((f) => f.key === key)

  const storeys: Storey[] = model.storeys.map((s) => ({
    expressId: 0,
    guid: '',
    name: s.name,
    elev: s.elev,
    h: s.h
  }))

  const base: IfcElement[] = model.elements.map((e) => {
    const bbox = bboxOf(e)
    return {
      id: e.id,
      expressId: e.id,
      guid: e.guid,
      guidValid: /^[0-9A-Za-z_$]{22}$/.test(e.guid),
      tag: e.tag,
      model: key,
      name: e.name,
      description: '',
      type: e.type,
      predefinedType: e.predefinedType,
      objectType: e.objectType,
      typeGuid: '',
      storey: e.storey,
      material: e.material,
      materials: e.material ? [{ kind: 'IfcMaterial', name: e.material }] : [],
      classifications: [],
      systems: [],
      decomposition: { children: [], openings: [], fillings: [] },
      psets: e.psets,
      qto: e.qto,
      // The mock's sets have no STEP lines behind them, so there is no source id to give.
      psetMeta: Object.fromEntries([
        ...Object.keys(e.psets).map((name) => [
          name,
          {
            sourceExpressId: 0,
            inherited: false,
            kind: /^sgpset/i.test(name) ? 'SGPset' : /^pset_/i.test(name) ? 'Pset' : 'other',
            measures: {}
          }
        ]),
        ...Object.keys(e.qto).map((name) => [
          name,
          { sourceExpressId: 0, inherited: false, kind: 'Qto', measures: {} }
        ])
      ]),
      ...(bbox ? { bbox, solidCount: solidCountOf(e) } : {})
    }
  })
  const elements: IfcElement[] = options?.element ? base.map(options.element) : base

  // Grid axes are `{ name, axis, v }` in the design; the contract also wants the segment,
  // so it is drawn across this model's own extent rather than an arbitrary length.
  const extent = elements.reduce(
    (acc, e) =>
      e.bbox
        ? {
            minX: Math.min(acc.minX, e.bbox[0]),
            minY: Math.min(acc.minY, e.bbox[1]),
            maxX: Math.max(acc.maxX, e.bbox[3]),
            maxY: Math.max(acc.maxY, e.bbox[4])
          }
        : acc,
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  )
  const grids: GridAxisRecord[] = model.grids.map((g) => ({
    name: g.name,
    axis: g.axis,
    v: g.v,
    start: g.axis === 'x' ? [g.v, extent.minY] : [extent.minX, g.v],
    end: g.axis === 'x' ? [g.v, extent.maxY] : [extent.maxX, g.v],
    family: g.axis === 'x' ? 'u' : 'v',
    gridExpressId: 0
  }))

  const storeyNodes: SpatialNode[] = storeys.map((s) => ({
    expressId: 0,
    guid: '',
    type: 'IfcBuildingStorey',
    name: s.name,
    longName: '',
    elevation: s.elev,
    children: []
  }))
  const building: SpatialNode = {
    expressId: 0,
    guid: '',
    type: 'IfcBuilding',
    name: model.project.building + (options?.buildingSuffix ?? ''),
    longName: '',
    children: storeyNodes
  }
  const site: SpatialNode = {
    expressId: 0,
    guid: '',
    type: 'IfcSite',
    name: model.project.site,
    longName: '',
    children: [building]
  }
  const spatial: SpatialNode = {
    expressId: 0,
    guid: '',
    type: 'IfcProject',
    name: model.project.name,
    longName: '',
    children: [site]
  }

  const byType: Record<string, number> = {}
  let psetCount = 0
  let qtoCount = 0
  for (const e of elements) {
    byType[e.type] = (byType[e.type] ?? 0) + 1
    psetCount += Object.keys(e.psets).length
    qtoCount += Object.keys(e.qto).length
  }
  const counts: ModelCounts = {
    entities: 0,
    elements: elements.length,
    spaces: 0,
    openings: 0,
    psets: psetCount,
    quantitySets: qtoCount,
    byType
  }

  return {
    modelKey: key,
    fileName: model.project.file,
    sha256: '',
    schema: model.project.schema,
    header: {
      description: [],
      viewDefinition: '',
      implementationLevel: '',
      name: model.project.file,
      timeStamp: '',
      author: [],
      organization: [],
      preprocessorVersion: '',
      originatingSystem: '',
      authorization: '',
      fileSchema: [model.project.schema]
    },
    units: MOCK_UNITS,
    project: {
      expressId: 0,
      guid: '',
      name: file?.name ?? model.project.name,
      longName: '',
      phase: '',
      description: ''
    },
    site,
    building,
    spatial,
    storeys,
    grids,
    georef: { source: 'none', sources: [], method: 'none' },
    propKeys: collectPropKeys(elements),
    counts,
    elements
  }
}

/* ────────────────────────────── the geometry ────────────────────────────── */

/** Unit cube face definitions: normal, then the four corners in `±0.5` units. */
const FACES: { n: [number, number, number]; c: [number, number, number][] }[] = [
  { n: [1, 0, 0], c: [[0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [0.5, -0.5, 0.5]] },
  { n: [-1, 0, 0], c: [[-0.5, 0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5]] },
  { n: [0, 1, 0], c: [[0.5, 0.5, -0.5], [-0.5, 0.5, -0.5], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5]] },
  { n: [0, -1, 0], c: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]] },
  { n: [0, 0, 1], c: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
  { n: [0, 0, -1], c: [[-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.5, -0.5, -0.5], [-0.5, -0.5, -0.5]] }
]

/** The 12 edges of a box, as index pairs into its 8 corners. */
const EDGE_PAIRS: [number, number][] = [
  [0, 1], [1, 3], [3, 2], [2, 0],
  [4, 5], [5, 7], [7, 6], [6, 4],
  [0, 4], [1, 5], [2, 6], [3, 7]
]
const CORNERS: [number, number, number][] = [
  [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5],
  [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5]
]

interface BoxMesh {
  positions: number[]
  normals: number[]
  indices: number[]
  edges: number[]
}

/**
 * One colour group as a single mesh — the reference's `mergeBoxes` (`viewer-core.js:11`,
 * used at `:119`). Each box contributes 12 triangles with four vertices per face, so every
 * face keeps its own flat normal, plus the 12 crease edges a 20° `EdgesGeometry` gives a
 * cuboid. Vertices are written relative to `origin`, so the part carries the placement and
 * two identically-shaped groups still share one geometry.
 */
function groupMesh(boxes: readonly SampleBox[], origin: [number, number, number]): BoxMesh {
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  const edges: number[] = []
  for (const b of boxes) {
    const [sx, sy, sz] = b.s
    const ox = b.p[0] - origin[0]
    const oy = b.p[1] - origin[1]
    const oz = b.p[2] - origin[2]
    for (const face of FACES) {
      const base = positions.length / 3
      for (const [cx, cy, cz] of face.c) {
        positions.push(cx * sx + ox, cy * sy + oy, cz * sz + oz)
        normals.push(...face.n)
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
    for (const [a, b2] of EDGE_PAIRS) {
      for (const corner of [CORNERS[a], CORNERS[b2]]) {
        edges.push(corner[0] * sx + ox, corner[1] * sy + oy, corner[2] * sz + oz)
      }
    }
  }
  return { positions, normals, indices, edges }
}

/** The group's world-space AABB, and the corner the local vertices are measured from. */
function groupBox(boxes: readonly SampleBox[]): {
  min: [number, number, number]
  bbox6: [number, number, number, number, number, number]
} {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const b of boxes) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], b.p[i] - b.s[i] / 2)
      max[i] = Math.max(max[i], b.p[i] + b.s[i] / 2)
    }
  }
  return { min, bbox6: [min[0], min[1], min[2], max[0], max[1], max[2]] }
}

/** `0x9aa5a3` plus the palette's optional opacity, as 0–1 RGBA. */
function rgbaOf(colorKey: string): [number, number, number, number] {
  const entry = COLORS[colorKey]
  if (!entry) return [1, 1, 1, 1]
  return [
    ((entry.color >> 16) & 0xff) / 255,
    ((entry.color >> 8) & 0xff) / 255,
    (entry.color & 0xff) / 255,
    entry.opacity ?? 1
  ]
}

const translation = (x: number, y: number, z: number): number[] =>
  [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]

/**
 * The model's geometry as chunks shaped like the worker's (plan §3.7): **one part per colour
 * group**, its boxes merged into one deduplicated mesh, colours from the design's `COLORS`
 * table — the same composition `viewer-core.js:115–122` makes, so `solidCount` reads as the
 * prototype's does and a wall with an opening is one solid rather than four.
 */
export function mockGeometryChunks(key: string): GeometryChunk[] {
  const model: SampleModel = buildDisciplineModel(key)

  interface Pending {
    positions: number[]
    normals: number[]
    indices: number[]
    edges: number[]
    geoms: GeometryRecord[]
    parts: PartRecord[]
    byShape: Map<string, number>
  }
  const fresh = (): Pending => ({
    positions: [],
    normals: [],
    indices: [],
    edges: [],
    geoms: [],
    parts: [],
    byShape: new Map()
  })

  let pending = fresh()
  const finished: Pending[] = []
  let nextGeometryId = 1

  const flush = (): void => {
    if (!pending.parts.length) return
    finished.push(pending)
    pending = fresh()
  }

  for (const element of model.elements) {
    for (const group of groupsOf(element)) {
      if (!group.boxes.length) continue
      if (
        pending.parts.length >= PARTS_PER_CHUNK ||
        pending.positions.length / 3 >= VERTICES_PER_CHUNK
      ) {
        flush()
      }
      const { min, bbox6 } = groupBox(group.boxes)
      // The shape key is the group's *local* geometry, so two identical groups placed
      // anywhere share one mesh — the reference's merge keeps no such table, but the
      // contract's instancing is the thing the real pipeline is measured on.
      const shape = group.boxes
        .map((b) => `${b.s.join(',')}@${b.p.map((v, i) => v - min[i]).join(',')}`)
        .join('|')
      let geomIdx = pending.byShape.get(shape)
      if (geomIdx === undefined) {
        const mesh = groupMesh(group.boxes, min)
        const vertexOffset = pending.positions.length / 3
        geomIdx = pending.geoms.length
        pending.geoms.push({
          geometryExpressId: nextGeometryId++,
          vertexOffset,
          vertexCount: mesh.positions.length / 3,
          indexOffset: pending.indices.length,
          indexCount: mesh.indices.length,
          edgeOffset: pending.edges.length / 3,
          edgeCount: mesh.edges.length / 3
        })
        pending.positions.push(...mesh.positions)
        pending.normals.push(...mesh.normals)
        // Indices are chunk-relative, so the deduplicated mesh's own base is added in.
        for (const i of mesh.indices) pending.indices.push(i + vertexOffset)
        pending.edges.push(...mesh.edges)
        pending.byShape.set(shape, geomIdx)
      }
      pending.parts.push({
        elementId: element.id,
        geomIdx,
        matrix16: translation(min[0], min[1], min[2]),
        rgba: rgbaOf(group.color),
        bbox6
      })
    }
  }
  flush()

  return finished.map((chunk, index) => ({
    header: { modelKey: key, index, total: finished.length },
    positions: new Float32Array(chunk.positions),
    normals: new Float32Array(chunk.normals),
    indices: new Uint32Array(chunk.indices),
    edges: new Float32Array(chunk.edges),
    geoms: chunk.geoms,
    parts: chunk.parts
  }))
}
