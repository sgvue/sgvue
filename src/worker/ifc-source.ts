/**
 * The read-only web-ifc adapter — **the only module in the app that may import web-ifc**
 * (`tests/readonly-guard.test.ts` fails the build if another one does).
 *
 * Two things happen here and nowhere else:
 *
 *  1. web-ifc is initialised (single-threaded: the multithreaded build needs cross-origin
 *     isolation headers we do not set).
 *  2. Every method named in `FORBIDDEN_IFC_WRITE_API` is replaced on the instance — and on
 *     `api.properties` for the two `set*` names — with a function that throws
 *     `ReadOnlyViolation`. The replacements are non-writable and non-configurable, so
 *     nothing later in the process can put the originals back.
 *
 * The names themselves are never spelled in this file; they come from the array, which is
 * the guard test's condition for the whole `src/` tree.
 *
 * Runs in both environments unchanged: web-ifc's `exports` map resolves `import 'web-ifc'`
 * to the browser ESM build under Vite and to `web-ifc-api-node` under Node, so the worker
 * and the vitest fixture harness share this file. The only difference is `locateFile`,
 * which the browser needs (Vite hands us the `.wasm` asset URL) and Node does not.
 */
import * as WebIFC from 'web-ifc'
import { FORBIDDEN_IFC_WRITE_API } from '../shared/readonly-list'

/** Thrown when anything tries to reach a web-ifc write API through this adapter. */
export class ReadOnlyViolation extends Error {
  constructor(method: string) {
    super(
      `SGVue is a viewer: web-ifc's ${method} is sealed. ` +
        'If you need this, the answer is no — see docs/SYSTEM_SPEC.md §6.'
    )
    this.name = 'ReadOnlyViolation'
  }
}

/** A shallow `GetLine` result: attributes plus web-ifc's reference handles. */
export interface IfcLine {
  expressID: number
  type: number
  [attribute: string]: unknown
}

/**
 * web-ifc's STEP token tags, as they appear on a shallow `GetLine` result. Only `REF` is
 * needed outside this file: it is how a reference handle (`{ value: 42, type: REF }`) is
 * told apart from an authored value (`{ value: 'NOTDEFINED', type: ENUM }`).
 */
export const STEP_TOKEN = {
  STRING: WebIFC.STRING,
  LABEL: WebIFC.LABEL,
  ENUM: WebIFC.ENUM,
  REAL: WebIFC.REAL,
  REF: WebIFC.REF,
  INTEGER: WebIFC.INTEGER
} as const

/** web-ifc returns `<web-ifc-type-unknown>` for a code the schema does not define. */
export const UNKNOWN_TYPE_NAME = '<web-ifc-type-unknown>'

/* ────────────────────────────── geometry ────────────────────────────── */

/**
 * One placed instance of a tessellated shape, copied out of web-ifc's `PlacedGeometry`.
 *
 * `flatTransformation` already applies the file's length unit **and** the IFC Z-up →
 * three.js Y-up conversion. Scaling or rotating again shrinks a 415 m warehouse into a
 * 40 cm box, or lays the building on its side. Both happened; neither is visible in a
 * browser (`CLAUDE.md` → web-ifc traps).
 */
export interface PlacedGeometryRecord {
  geometryExpressId: number
  /** RGBA 0–1 as web-ifc places it. Surface-style transparency is **not** folded into `a`. */
  color: readonly [number, number, number, number]
  /** Column-major 4×4, metres. `[12..14]` is the translation. */
  flatTransformation: readonly number[]
}

/** One product's placements, already copied off the wasm heap. */
export interface MeshRecord {
  expressId: number
  placements: readonly PlacedGeometryRecord[]
}

export type MeshVisitor = (mesh: MeshRecord) => void

/** A tessellated shape, copied off the wasm heap. */
export interface GeometryData {
  /** web-ifc's interleaved layout: `px py pz nx ny nz` per vertex. */
  vertexData: Float32Array
  indexData: Uint32Array
}

/** ISO 10303-21 header record type codes, for `headerLine`. */
export const HEADER = {
  FILE_DESCRIPTION: WebIFC.FILE_DESCRIPTION,
  FILE_NAME: WebIFC.FILE_NAME,
  FILE_SCHEMA: WebIFC.FILE_SCHEMA
} as const

/**
 * Loader settings every open uses.
 *
 * `COORDINATE_TO_ORIGIN: false` is not a preference: `true` recentres each model
 * independently and `GetCoordinationMatrix` then returns identity, so the offsets between
 * federated models are silently lost. `MEMORY_LIMIT` is the spec's 3.5 GB ceiling.
 */
export const LOADER_SETTINGS: WebIFC.LoaderSettings = {
  COORDINATE_TO_ORIGIN: false,
  MEMORY_LIMIT: 3.5 * 1024 * 1024 * 1024
}

/** Reads a slice of the file. Must return the bytes synchronously. */
export type ReadBytes = (offset: number, size: number) => Uint8Array

export interface ReadOnlyIfcSource {
  /** Stream a file in without ever holding all of it: the parse worker's path. */
  openFromCallback(read: ReadBytes, settings?: WebIFC.LoaderSettings): number
  /** Open from bytes already in memory: the Node fixture harness's path. */
  openFromBuffer(bytes: Uint8Array, settings?: WebIFC.LoaderSettings): number
  close(modelID: number): void
  isOpen(modelID: number): boolean
  /** Frees the wasm module. `createReadOnlyIfcSource` must be called again after this. */
  dispose(): void

  schema(modelID: number): string
  /** One header record, e.g. `headerLine(id, HEADER.FILE_DESCRIPTION)`. */
  headerLine(modelID: number, headerType: number): IfcLine | null
  /** Shallow `GetLine`. Never the recursive flatten — it throws on real Revit exports. */
  line(modelID: number, expressId: number): IfcLine | null
  lineType(modelID: number, expressId: number): number
  /** `2391406946` → `IfcWall`. `UNKNOWN_TYPE_NAME` when the schema has no such code. */
  typeName(typeCode: number): string
  /** `'IFCWALL'` (upper case) → its code, or `0` when this schema has no such entity. */
  typeCode(typeName: string): number
  /** Every expressId of a type. The wasm vector is freed before returning. */
  idsWithType(modelID: number, typeCode: number, includeInherited?: boolean): number[]
  /** How many STEP lines the file has. */
  lineCount(modelID: number): number
  expressIdFromGuid(modelID: number, guid: string): number | undefined

  /**
   * Every product's placements, one product at a time. `IfcSpace` and `IfcOpeningElement`
   * are excluded by web-ifc — stream spaces with `streamMeshesWithTypes`.
   *
   * The visitor never sees a wasm object: each mesh is copied and the placement vector is
   * freed before the visitor runs, so nothing can outlive the callback.
   */
  streamAllMeshes(modelID: number, visit: MeshVisitor): void
  /** The same, restricted to the given type codes — how `IfcSpace` geometry is reached. */
  streamMeshesWithTypes(modelID: number, typeCodes: readonly number[], visit: MeshVisitor): void
  /**
   * One tessellated shape, copied off the heap and released. `GetVertexArray` and
   * `GetIndexArray` hand back views into wasm memory that are invalidated under you, so
   * both are `.slice()`d here and the `IfcGeometry` is deleted before returning.
   */
  readGeometry(modelID: number, geometryExpressId: number): GeometryData | null
  /** `GetCoordinationMatrix` — identity while `COORDINATE_TO_ORIGIN` is false. Recorded, not applied. */
  coordinationMatrix(modelID: number): number[]

  /**
   * The sealed write APIs, by name. Not a write path: calling any of them throws. It is
   * here so the read-only guarantee can be *tested* without exposing the `IfcAPI` object.
   */
  readonly sealedWriteApi: ReadonlyMap<string, (...args: unknown[]) => never>
}

export interface IfcSourceOptions {
  /**
   * Browser only: where `web-ifc.wasm` lives. The parse worker passes Vite's asset URL.
   * Under Node, web-ifc resolves its own wasm and this stays undefined.
   */
  locateFile?: WebIFC.LocateFileHandlerFn
}

/** Replace every forbidden method with a throwing, unrestorable stub. */
function seal(api: WebIFC.IfcAPI): Map<string, (...args: unknown[]) => never> {
  const stubs = new Map<string, (...args: unknown[]) => never>()
  const targets: Record<string, unknown>[] = [api as unknown as Record<string, unknown>]
  const properties = api.properties as unknown as Record<string, unknown> | undefined

  for (const method of FORBIDDEN_IFC_WRITE_API) {
    const stub = (): never => {
      throw new ReadOnlyViolation(method)
    }
    stubs.set(method, stub)
    // The two `set*` names live on `api.properties`; the rest on the API object itself.
    const hosts = method.startsWith('set') && properties ? [properties] : targets
    for (const host of hosts) {
      Object.defineProperty(host, method, {
        value: stub,
        writable: false,
        configurable: false,
        enumerable: false
      })
    }
  }
  return stubs
}

/**
 * Copy one streamed mesh off the wasm heap and free its placement vector.
 *
 * The `FlatMesh` handed to a stream callback owns a `geometries` vector that leaks unless
 * it is deleted — one per product, so a 26 000-element model leaks 26 000 of them. The
 * `FlatMesh` itself has no `delete` in web-ifc 0.0.77 (checked: the property is
 * `undefined`); the vector does, and it is the one that holds memory.
 */
function copyMesh(mesh: WebIFC.FlatMesh): MeshRecord {
  const vector = mesh.geometries
  try {
    const placements: PlacedGeometryRecord[] = new Array(vector.size())
    for (let i = 0; i < placements.length; i++) {
      const placed = vector.get(i)
      const c = placed.color
      placements[i] = {
        geometryExpressId: placed.geometryExpressID,
        color: [c.x, c.y, c.z, c.w],
        flatTransformation: [...placed.flatTransformation]
      }
    }
    return { expressId: mesh.expressID, placements }
  } finally {
    ;(vector as unknown as { delete?: () => void }).delete?.()
  }
}

/**
 * Initialise web-ifc, seal its write APIs, and hand back read methods only.
 *
 * `await`ed once per worker (or once per test file); `Init` compiles the wasm module, which
 * is worth paying for once even when several models are opened.
 */
export async function createReadOnlyIfcSource(
  options: IfcSourceOptions = {}
): Promise<ReadOnlyIfcSource> {
  const api = new WebIFC.IfcAPI()
  await api.Init(options.locateFile, true)
  const sealedWriteApi = seal(api)

  const settingsFor = (s?: WebIFC.LoaderSettings): WebIFC.LoaderSettings => ({
    ...LOADER_SETTINGS,
    ...s
  })

  return {
    openFromCallback: (read, s) => api.OpenModelFromCallback(read, settingsFor(s)),
    openFromBuffer: (bytes, s) => api.OpenModel(bytes, settingsFor(s)),
    close: (modelID) => api.CloseModel(modelID),
    isOpen: (modelID) => api.IsModelOpen(modelID),
    dispose: () => api.Dispose(),

    schema: (modelID) => api.GetModelSchema(modelID),

    headerLine: (modelID, headerType) => {
      try {
        return (api.GetHeaderLine(modelID, headerType) as IfcLine | null) ?? null
      } catch {
        return null
      }
    },

    line: (modelID, expressId) => {
      if (!expressId) return null
      try {
        return (api.GetLine(modelID, expressId) as IfcLine | null) ?? null
      } catch {
        return null
      }
    },

    lineType: (modelID, expressId) => {
      try {
        return api.GetLineType(modelID, expressId) as number
      } catch {
        return 0
      }
    },

    typeName: (typeCode) => {
      try {
        return api.GetNameFromTypeCode(typeCode)
      } catch {
        return UNKNOWN_TYPE_NAME
      }
    },

    typeCode: (typeName) => {
      // GetTypeCodeFromName hashes anything it is given, so an entity this schema does not
      // define comes back as a plausible-looking number. Round-trip it to find out.
      const code = api.GetTypeCodeFromName(typeName)
      if (!code) return 0
      return api.GetNameFromTypeCode(code) === UNKNOWN_TYPE_NAME ? 0 : code
    },

    idsWithType: (modelID, typeCode, includeInherited = false) => {
      if (!typeCode) return []
      const vector = api.GetLineIDsWithType(modelID, typeCode, includeInherited)
      try {
        const out = new Array<number>(vector.size())
        for (let i = 0; i < out.length; i++) out[i] = vector.get(i)
        return out
      } finally {
        // The vector is wasm-heap memory; leaking one per type leaks the whole model.
        ;(vector as unknown as { delete?: () => void }).delete?.()
      }
    },

    lineCount: (modelID) => {
      const vector = api.GetAllLines(modelID)
      try {
        return vector.size()
      } finally {
        ;(vector as unknown as { delete?: () => void }).delete?.()
      }
    },

    streamAllMeshes: (modelID, visit) => {
      api.StreamAllMeshes(modelID, (mesh) => visit(copyMesh(mesh)))
    },

    streamMeshesWithTypes: (modelID, typeCodes, visit) => {
      const types = typeCodes.filter((code) => code > 0)
      if (!types.length) return
      api.StreamAllMeshesWithTypes(modelID, [...types], (mesh) => visit(copyMesh(mesh)))
    },

    readGeometry: (modelID, geometryExpressId) => {
      const geometry = api.GetGeometry(modelID, geometryExpressId)
      try {
        const vertexData = api
          .GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize())
          .slice()
        const indexData = api
          .GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize())
          .slice()
        return vertexData.length && indexData.length ? { vertexData, indexData } : null
      } finally {
        geometry.delete()
      }
    },

    coordinationMatrix: (modelID) => [...api.GetCoordinationMatrix(modelID)],

    expressIdFromGuid: (modelID, guid) => {
      try {
        const id = api.GetExpressIdFromGuid(modelID, guid)
        return typeof id === 'number' ? id : undefined
      } catch {
        return undefined
      }
    },

    sealedWriteApi
  }
}
