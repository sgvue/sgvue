/**
 * A part 32.5 km from its file's origin keeps its position to 0.1 mm (2026-11-07, core
 * protection #8).
 *
 * Revit shared coordinates put a model tens of kilometres out, where a float32 coordinate
 * resolves about 4 mm (`docs/TRAPS.md`, geometry and units: *subtract a shared origin in
 * Float64*). `geometry-streamer.ts` therefore composes every placement in Float64, takes the
 * whole-metre federation offset off the translation, and only then writes the Float32 `matrix16`
 * the GPU sees. Nothing failed if a Float32 crept in anywhere before that subtraction — a
 * `Float32Array` for `composed`, a copy of web-ifc's `flatTransformation` through one, an offset
 * stored as float32 — because a building that moved by a millimetre still looks like a building.
 *
 * So this streams a tiny model, generated here, through the **real** path — web-ifc under Node
 * (`createReadOnlyIfcSource`, the worker's own adapter) and `streamGeometry` — and holds where
 * each part's centre is drawn in the scene (the Float32 `matrix16` applied to its own vertices) to
 * the value worked out by hand in Float64 from the file's own
 * numbers, within 0.1 mm. The model sits on the repository's synthetic site (`CLAUDE.md`, Rules:
 * `12345.457 / 23456.766 / 5.05`, −43.4103°, the same lines as `tests/fixtures/reference.ifc`)
 * and places its two parts 6 km further out along the same bearing, through the building's, the
 * storey's and the part's own placements — 32.5 km from the origin, where Revit's shared
 * coordinates sit. The federation offset (the shared origin) is chosen by the streamer, as for
 * the first model of a federation, and also passed in, as for every later one.
 *
 * Every number written here is the synthetic site's or below the privacy scan's coordinate band
 * (`scripts/privacy.cjs`, rule 4): the 32.5 km is reached by composing placements, never written.
 *
 * And it shows the check can fail: the same stream with web-ifc's placement passed through a
 * `Float32Array` on its way in — the creep this guards against — misses by more than 0.1 mm.
 */
import { describe, expect, it } from 'vitest'
import type { FederationOffset, GeometryChunk, GeometrySummary, PartRecord } from '../../src/shared/geometry-contract.types'
import { streamGeometry } from '../../src/worker/geometry-streamer'
import { createReadOnlyIfcSource, type ReadOnlyIfcSource } from '../../src/worker/ifc-source'

/** 0.1 mm, in the metres the contract speaks. */
const TOLERANCE_M = 1e-4

/** The synthetic site (mm), and its x axis — `reference.ifc` `#12` and `#14`, verbatim. */
const SITE_MM = [12345457, 23456766, 5050] as const
const SITE_X = [0.726451142256412, -0.687218115240245] as const

/**
 * The building's placement in the site, and the storey's in the building (mm): 1 999 m each
 * along the site's own bearing, outward.
 */
const STEP = [-539323.2705, 1924871.7905, 0] as const

/**
 * Each part's placement in the storey (mm): another ~2 km out, with digits below the millimetre
 * that float32 cannot hold 32.5 km out. Part B stands ~40 m from part A, so its scene-local
 * centre is not a rounding remainder.
 */
const PARTS = {
  A: [-539324.505, 1924872.4694, 1234.5678],
  B: [-502201.0483, 1912526.7905, 1987.6543]
} as const

/** A part's placement in the site's frame: the building's, the storey's and its own, summed. */
const inSite = (p: readonly number[]): number[] => p.map((v, k) => v + 2 * STEP[k])

/** A minimal IFC4 file in millimetres: the site, a building, a storey and the two parts. */
function farModel(): string {
  const lines: string[] = []
  let n = 0
  const add = (entity: string): number => {
    lines.push(`#${++n}=${entity};`)
    return n
  }
  const f = (v: number): string => (Number.isInteger(v) ? `${v}.` : String(v))
  const point = (p: readonly number[]): number => add(`IFCCARTESIANPOINT((${p.map(f).join(',')}))`)
  const gid = (i: number): string => `'${String(i).padStart(22, '0')}'`

  const mm = add('IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)')
  const units = add(`IFCUNITASSIGNMENT((#${mm}))`)
  const ctxPlace = add(`IFCAXIS2PLACEMENT3D(#${point([0, 0, 0])},$,$)`)
  const ctx = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#${ctxPlace},$)`)
  const body = add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#${ctx},$,.MODEL_VIEW.,$)`)
  const project = add(`IFCPROJECT(${gid(1)},$,'Far',$,$,$,$,(#${ctx}),#${units})`)
  const up = add('IFCDIRECTION((0.,0.,1.))')
  const siteX = add(`IFCDIRECTION((${SITE_X.map(f).join(',')},0.))`)
  const sitePlace = add(`IFCLOCALPLACEMENT($,#${add(`IFCAXIS2PLACEMENT3D(#${point(SITE_MM)},#${up},#${siteX})`)})`)
  const site = add(`IFCSITE(${gid(2)},$,'Site',$,$,#${sitePlace},$,$,.ELEMENT.,$,$,$,$,$)`)
  const at = (parent: number, p: readonly number[]): number =>
    add(`IFCLOCALPLACEMENT(#${parent},#${add(`IFCAXIS2PLACEMENT3D(#${point(p)},$,$)`)})`)
  const buildingPlace = at(sitePlace, STEP)
  const building = add(`IFCBUILDING(${gid(3)},$,'Building',$,$,#${buildingPlace},$,$,.ELEMENT.,$,$,$)`)
  const storeyPlace = at(buildingPlace, STEP)
  const storey = add(`IFCBUILDINGSTOREY(${gid(4)},$,'Level 1',$,$,#${storeyPlace},$,$,.ELEMENT.,0.)`)
  add(`IFCRELAGGREGATES(${gid(5)},$,$,$,#${project},(#${site}))`)
  add(`IFCRELAGGREGATES(${gid(6)},$,$,$,#${site},(#${building}))`)
  add(`IFCRELAGGREGATES(${gid(7)},$,$,$,#${building},(#${storey}))`)
  const proxies: number[] = []
  for (const [i, p] of Object.values(PARTS).entries()) {
    // A 1 m cube whose own geometry starts at the part's placement: the solid at the origin.
    const profile = add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,#${add(`IFCAXIS2PLACEMENT2D(#${add('IFCCARTESIANPOINT((500.,500.))')},$)`)},1000.,1000.)`)
    const solid = add(`IFCEXTRUDEDAREASOLID(#${profile},#${add(`IFCAXIS2PLACEMENT3D(#${point([0, 0, 0])},$,$)`)},#${up},1000.)`)
    const shape = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${add(`IFCSHAPEREPRESENTATION(#${body},'Body','SweptSolid',(#${solid}))`)}))`)
    proxies.push(add(`IFCBUILDINGELEMENTPROXY(${gid(10 + i)},$,'Part ${'AB'[i]}',$,$,#${at(storeyPlace, p)},#${shape},$,.NOTDEFINED.)`))
  }
  add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${gid(8)},$,$,$,(${proxies.map((id) => `#${id}`).join(',')}),#${storey})`)
  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
    "FILE_NAME('far.ifc','2026-11-07T00:00:00',('SGVue test fixture'),('SGVue'),'tests/unit/float64-far-origin.test.ts','none','none');",
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;',
    ...lines,
    'ENDSEC;',
    'END-ISO-10303-21;',
    ''
  ].join('\n')
}

/**
 * A point in the site's frame (mm) in world metres, IFC Z-up, worked out in Float64 from the
 * file's numbers alone: the site's point plus the site's rotation of it.
 */
function worldOf(p: readonly number[]): [number, number, number] {
  const len = Math.hypot(SITE_X[0], SITE_X[1])
  const [cx, sx] = [SITE_X[0] / len, SITE_X[1] / len]
  // x axis (cx, sx); y axis = z × x = (−sx, cx).
  return [
    (SITE_MM[0] + cx * p[0] - sx * p[1]) / 1000,
    (SITE_MM[1] + sx * p[0] + cx * p[1]) / 1000,
    (SITE_MM[2] + p[2]) / 1000
  ]
}

/** A source whose every placement goes through a `Float32Array` first — the creep, simulated. */
function float32Placements(src: ReadOnlyIfcSource): ReadOnlyIfcSource {
  const round = (visit: Parameters<ReadOnlyIfcSource['streamAllMeshes']>[1]): typeof visit => (mesh) =>
    visit({
      ...mesh,
      placements: mesh.placements.map((pl) => ({ ...pl, flatTransformation: [...new Float32Array(pl.flatTransformation)] }))
    })
  return {
    ...src,
    streamAllMeshes: (id, visit) => src.streamAllMeshes(id, round(visit)),
    streamMeshesWithTypes: (id, types, visit) => src.streamMeshesWithTypes(id, types, round(visit))
  }
}

interface Streamed {
  summary: GeometrySummary
  /**
   * Each part's cube centre in the scene, by its element's name (A or B): `matrix16` — the
   * Float32 matrix the GPU is handed — applied to the centre of the part's own Float32 vertices.
   * The centre, not the matrix's translation, because web-ifc may move a shape's origin into its
   * vertices or out of them; what is drawn is the product of the two either way.
   */
  centres: Map<string, [number, number, number]>
}

/** `matrix16 × centre of the part's vertices`: where the GPU draws the middle of the part. */
function sceneCentre(chunk: GeometryChunk, part: PartRecord): [number, number, number] {
  const g = chunk.geoms[part.geomIdx]
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let v = g.vertexOffset; v < g.vertexOffset + g.vertexCount; v++) {
    for (let k = 0; k < 3; k++) {
      const x = chunk.positions[v * 3 + k]
      lo[k] = Math.min(lo[k], x)
      hi[k] = Math.max(hi[k], x)
    }
  }
  const c = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2)
  const m = part.matrix16
  return [0, 1, 2].map((r) => m[r] * c[0] + m[4 + r] * c[1] + m[8 + r] * c[2] + m[12 + r]) as [number, number, number]
}

async function stream(offset: FederationOffset | null, creep = false): Promise<Streamed> {
  const src = await createReadOnlyIfcSource()
  try {
    const modelID = src.openFromBuffer(new TextEncoder().encode(farModel()))
    const chunks: GeometryChunk[] = []
    const summary = streamGeometry(creep ? float32Placements(src) : src, modelID, {
      modelKey: 'FAR',
      offset,
      onChunk: (chunk) => chunks.push(chunk)
    })
    const centres = new Map<string, [number, number, number]>()
    for (const chunk of chunks) {
      for (const part of chunk.parts) {
        const name = String((src.line(modelID, part.elementId)?.Name as { value?: unknown } | null)?.value ?? '')
        centres.set(name.replace('Part ', ''), sceneCentre(chunk, part))
      }
    }
    src.close(modelID)
    return { summary, centres }
  } finally {
    src.dispose()
  }
}

/** Per part and axis, how far its scene-local cube centre is from the Float64 value (m). */
function misses({ summary, centres }: Streamed): { part: string; axis: string; got: number; want: number; miss: number }[] {
  const out: { part: string; axis: string; got: number; want: number; miss: number }[] = []
  for (const [name, local] of Object.entries(PARTS)) {
    const centre = centres.get(name)
    if (!centre) throw new Error(`part ${name} was not streamed`)
    // The cube's centre is half its 1 000 mm side along each of its placement's axes.
    const world = worldOf(inSite([local[0] + 500, local[1] + 500, local[2] + 500]))
    for (let k = 0; k < 3; k++) {
      const got = centre[k]
      const want = world[k] - summary.offset[k]
      out.push({ part: name, axis: 'xyz'[k], got, want, miss: Math.abs(got - want) })
    }
  }
  return out
}

const report = (rows: ReturnType<typeof misses>): string =>
  rows.map((r) => `${r.part}.${r.axis}: got ${r.got.toFixed(6)} m, Float64 ${r.want.toFixed(6)} m, off by ${(r.miss * 1000).toFixed(3)} mm`).join('\n')

describe('Float64 at 32.5 km: a far part survives the offset subtraction to 0.1 mm', () => {
  it('the model really is ~33 km out, and the offset chosen for it is whole metres there', async () => {
    const s = await stream(null)
    for (const local of Object.values(PARTS)) {
      const d = Math.hypot(...worldOf(inSite(local)).slice(0, 2))
      expect(d).toBeGreaterThan(32_000)
      expect(d).toBeLessThan(33_000)
    }
    expect(s.summary.offset.every(Number.isInteger)).toBe(true)
    expect(Math.hypot(s.summary.offset[0], s.summary.offset[1])).toBeGreaterThan(32_000)
    // Float32 itself cannot hold these coordinates to 0.1 mm — the premise of the whole check.
    const worst = Math.max(...Object.values(PARTS).flatMap((p) => worldOf(inSite(p)).map((v) => Math.abs(Math.fround(v) - v))))
    expect(worst).toBeGreaterThan(TOLERANCE_M)
  })

  it('with the offset the streamer picks (the first model of a federation)', async () => {
    const rows = misses(await stream(null))
    expect(rows.filter((r) => r.miss > TOLERANCE_M), report(rows)).toEqual([])
  })

  it('with a far shared origin handed in (every later model of a federation)', async () => {
    // A whole-metre shared origin ~170 m from the parts — another model's first placement, as
    // close as a federation's models stand. (Float32 holds 0.1 mm only within ~2 km of the
    // offset; past that the subtraction is not the limit, the scene's own float32 is.) Taken from
    // the offset the streamer picks, so no coordinate is written here.
    const own = (await stream(null)).summary.offset
    const shared: FederationOffset = [own[0] - 123, own[1] + 121, own[2] - 2]
    const s = await stream(shared)
    expect(s.summary.offset).toEqual(shared)
    const rows = misses(s)
    expect(rows.filter((r) => r.miss > TOLERANCE_M), report(rows)).toEqual([])
  })

  it('fails when a Float32 creeps in before the subtraction (the check can fail)', async () => {
    const rows = misses(await stream(null, true))
    expect(Math.max(...rows.map((r) => r.miss)), report(rows)).toBeGreaterThan(TOLERANCE_M)
  })
})
