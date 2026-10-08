/**
 * Map-space federation (2026-10-08) on real files: the committed synthetic fixtures in
 * `tests/fixtures/georef/`, through the real index builder and geometry streamer under Node, as
 * `geometry-streamer.fixture.test.ts` runs them — and through `federation-store.ts`'s own
 * `metaOf` for the grids and the storeys.
 *
 * The fixtures are **one** building at the repository's synthetic map position (site
 * 12345.457 / 23456.766 / 5.05 m, −43.4103°), written the eight ways an exporter can say where
 * it is (`scripts/make-tiny-ifc.py` has each): (a) on its site placement beside a zero
 * conversion, (b) in an `IfcMapConversion` over a site at the file's zero, (c) as (b) with no
 * `Scale`, (d) with `Scale` 1000, (e) with the map unit the foot, (f) IFC2X3's property sets,
 * (g) a local site offset that carries the turn, the survey point in the conversion, and a decoy
 * conversion on a 2D `Plan` context written first, (h) as (g) with the survey point's conversion
 * on the `Model` context's `Body` sub-context — and, since rule 4 (coordinates part 2, the same
 * day), (i) Revit "Project Base Point" with no EPSG code: no conversion, the base point's E / N / H
 * on the `Model` context's `WorldCoordinateSystem` and the turn only in `TrueNorth`, (j) the same
 * in IFC2X3, (k) a `WorldCoordinateSystem` beside a conversion, read as IfcOpenShell reads it.
 *
 * Federated by world coordinates, as the app did before, (a) and (b) land 26 km apart. Every
 * ordered pair here must land within a millimetre: vertices, element boxes, grid segments and
 * storey heights.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  federationFrame,
  frameKey,
  mapPlacement,
  modelFrame,
  toWorld,
  type ProjectFrame
} from '../../src/shared/georef'
import type { FederationOffset, GeometryChunk } from '../../src/shared/geometry-contract.types'
import type { ModelIndex } from '../../src/shared/model-index.types'
import { elementBoxes } from '../../src/renderer/model/element-boxes'
import { metaOf } from '../../src/renderer/model/federation-store'
import { streamGeometry } from '../../src/worker/geometry-streamer'
import { createReadOnlyIfcSource, type ReadOnlyIfcSource } from '../../src/worker/ifc-source'
import { buildModelIndex, placementMatrix } from '../../src/worker/index-builder'

const DIR = join(__dirname, '..', 'fixtures', 'georef')
const FILES = [
  'a-site-placement.ifc',
  'b-map-conversion.ifc',
  'c-scale-absent.ifc',
  'd-scale-1000.ifc',
  'e-map-unit-foot.ifc',
  'f-ifc2x3-epset.ifc',
  'g-survey-point.ifc',
  'h-sub-context.ifc',
  'i-wcs-base-point.ifc',
  'j-ifc2x3-wcs.ifc',
  'k-wcs-and-conversion.ifc'
] as const

/** The repository's synthetic map position — what every fixture states, one way or another. */
const SITE = [12345.457, 23456.766, 5.05] as const
const SITE_KEY = '12345.457,23456.766,5.050@-43.4103'
/** A millimetre. */
const MM = 0.001

interface Opened {
  file: string
  modelID: number
  index: ModelIndex
}

interface Streamed {
  offset: FederationOffset
  chunks: GeometryChunk[]
  frame: ProjectFrame | null
}

const ready = (async () => {
  const src = await createReadOnlyIfcSource()
  const opened: Opened[] = FILES.map((file) => {
    const modelID = src.openFromBuffer(new Uint8Array(readFileSync(join(DIR, file))))
    const index = buildModelIndex(src, modelID, { modelKey: file, fileName: file, sha256: '' })
    return { file, modelID, index }
  })
  return { src, opened }
})()

const byFile = async (file: (typeof FILES)[number]): Promise<Opened> =>
  (await ready).opened.find((o) => o.file === file)!

/** Stream one model the way `FederationController.prepare` does: its own frame against the boot's. */
function stream(
  src: ReadOnlyIfcSource,
  boot: Opened,
  m: Opened,
  offset: FederationOffset | null
): Streamed {
  const frame = modelFrame(boot.index.georef, m.index.georef)
  const chunks: GeometryChunk[] = []
  const summary = streamGeometry(src, m.modelID, {
    modelKey: m.file,
    offset,
    frame,
    onChunk: (c) => chunks.push(c)
  })
  return { offset: summary.offset, chunks, frame }
}

/** Every element's vertices in the scene, part by part, keyed by GlobalId. */
function vertices(m: Opened, s: Streamed): Map<string, number[]> {
  const guid = new Map(m.index.elements.map((e) => [e.expressId, e.guid]))
  const out = new Map<string, number[]>()
  for (const chunk of s.chunks) {
    for (const part of chunk.parts) {
      const g = chunk.geoms[part.geomIdx]
      const k = part.matrix16
      const list = out.get(guid.get(part.elementId)!) ?? []
      for (let v = g.vertexOffset; v < g.vertexOffset + g.vertexCount; v++) {
        const x = chunk.positions[v * 3]
        const y = chunk.positions[v * 3 + 1]
        const z = chunk.positions[v * 3 + 2]
        list.push(
          k[0] * x + k[4] * y + k[8] * z + k[12],
          k[1] * x + k[5] * y + k[9] * z + k[13],
          k[2] * x + k[6] * y + k[10] * z + k[14]
        )
      }
      out.set(guid.get(part.elementId)!, list)
    }
  }
  return out
}

/** Each element's box in the project frame — the app's own union (`element-boxes.ts`). */
function boxes(m: Opened, s: Streamed): Map<string, readonly number[]> {
  const guid = new Map(m.index.elements.map((e) => [e.expressId, e.guid]))
  return new Map([...elementBoxes(s.chunks, s.offset)].map(([id, g]) => [guid.get(id)!, g.box]))
}

const worst = (a: readonly number[], b: readonly number[]): number => {
  expect(a.length).toBe(b.length)
  return a.reduce((w, v, i) => Math.max(w, Math.abs(v - b[i])), 0)
}

/** Every number of `a` within a millimetre of `b`'s. */
const within = (a: readonly number[], b: readonly number[], what: string): void => {
  expect(worst(a, b), what).toBeLessThan(MM)
}

describe('map-space federation — the synthetic fixtures through the real index builder', () => {
  it('reads each declaration where the file puts it', async () => {
    const read = Object.fromEntries(
      await Promise.all(FILES.map(async (f) => [f, (await byFile(f)).index.georef] as const))
    )
    const conversions = [
      'b-map-conversion.ifc',
      'c-scale-absent.ifc',
      'd-scale-1000.ifc',
      'e-map-unit-foot.ifc'
    ] as const
    expect(mapPlacement(read['a-site-placement.ifc']).placedBy).toBe('site placement')
    // Revit's zero conversion and its `(1, 6.12e-17)` X axis are the identity: nothing is turned twice.
    expect(mapPlacement(read['a-site-placement.ifc']).operation).toBeNull()
    for (const f of conversions) expect(mapPlacement(read[f]).placedBy, f).toBe('IfcMapConversion')
    expect(mapPlacement(read['f-ifc2x3-epset.ifc']).placedBy).toBe('ePset_MapConversion')
    expect(mapPlacement(read['g-survey-point.ifc']).placedBy).toBe('IfcMapConversion')
    expect(mapPlacement(read['h-sub-context.ifc']).placedBy).toBe('IfcMapConversion')

    // `Scale` is recorded as written — and only recorded.
    expect(read['b-map-conversion.ifc'].scale).toBe(0.001)
    expect(read['c-scale-absent.ifc'].scale).toBeUndefined()
    expect(read['d-scale-1000.ifc'].scale).toBe(1000)

    // The map unit: none named in (b), so metres; the foot through its conversion factor; the
    // metre as an SI unit (g); IFC2X3's name in `ePset_ProjectedCRS` (f).
    expect(read['b-map-conversion.ifc'].mapUnit).toBeUndefined()
    expect(read['e-map-unit-foot.ifc'].mapUnit).toEqual({ name: 'FOOT', metres: 0.3048 })
    expect(read['f-ifc2x3-epset.ifc'].mapUnit).toEqual({ name: 'METRE', metres: 1 })
    expect(mapPlacement(read['e-map-unit-foot.ifc']).metresPerMapUnit).toBe(0.3048)

    // (g) carries a decoy conversion on a 2D `Plan` context, written first: the one taken is
    // the 3D `Model` context's — and in (h), whose real one hangs off the `Model` context's
    // `Body` sub-context, the sub-context's, judged by its parent.
    for (const f of ['g-survey-point.ifc', 'h-sub-context.ifc'] as const) {
      expect(read[f].eastings, f).toBeCloseTo(SITE[0] + 8, 9)
      expect(read[f].northings, f).toBeCloseTo(SITE[1] - 3, 9)
      expect(read[f].mapUnit, f).toEqual({ name: 'METRE', metres: 1 })
    }

    // Rule 4 — (i) and (j) carry no conversion: the WorldCoordinateSystem is the map position, in
    // metres through the millimetre unit, and `TrueNorth` is the turn, since nothing else turns.
    for (const f of ['i-wcs-base-point.ifc', 'j-ifc2x3-wcs.ifc'] as const) {
      const p = mapPlacement(read[f])
      expect([f, p.placedBy, p.ambiguous]).toEqual([f, 'WorldCoordinateSystem', false])
      expect(read[f].method, f).toBe('WorldCoordinateSystem + IfcSite placement')
      expect(read[f].sources, f).toEqual(['WorldCoordinateSystem', 'IfcSite'])
      expect(p.wcs!.readAs, f).toBe('map position')
      // The base point's E / N / H, in metres — a turned site offset short of the synthetic position.
      expect(Math.abs(read[f].wcs!.origin[0] - 12344.2692407191), f).toBeLessThan(1e-9)
      expect(Math.abs(read[f].wcs!.origin[1] - 23461.3310003166), f).toBeLessThan(1e-9)
      expect(read[f].wcs!.origin[2], f).toBeCloseTo(5.05, 12)
      expect(p.trueNorthDeg!, f).toBeCloseTo(-43.4103, 9)
      expect(p.operation!.rotationDeg, f).toBeCloseTo(-43.4103, 9)
    }
    // (k) — a conversion beside a WorldCoordinateSystem: the conversion places it, the WCS is undone
    // before it, the pair is marked ambiguous, and `TrueNorth` turns nothing (rule 5).
    const k = mapPlacement(read['k-wcs-and-conversion.ifc'])
    expect([k.placedBy, k.ambiguous, k.wcs!.readAs, k.trueNorthDeg]).toEqual([
      'IfcMapConversion',
      true,
      'undone before the conversion',
      null
    ])
    expect(read['k-wcs-and-conversion.ifc'].method).toBe('IfcMapConversion')
    // Every file from before rule 4 keeps an identity WorldCoordinateSystem, and so its old reading.
    for (const f of FILES.slice(0, 8)) {
      expect([f, read[f].wcs, mapPlacement(read[f]).wcs]).toEqual([f, undefined, null])
    }
  })

  it('pins that web-ifc 0.0.77 applies neither the WorldCoordinateSystem’s move nor its turn', async () => {
    // One slab, in metres, its site at the origin; the context's WorldCoordinateSystem first the
    // identity, then moved 1 km / 2 km / 300 m and turned 30° about +Z. web-ifc streams the very
    // same placement both times — which is why `mapPlacement` applies it, once. If an upgrade
    // starts to apply it, this fails before the map position is added twice.
    const { src } = await ready
    const file = (location: string, ref: string): Uint8Array =>
      new TextEncoder().encode(
        [
          'ISO-10303-21;',
          'HEADER;',
          "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
          "FILE_NAME('wcs-probe.ifc','2026-10-08T00:00:00',('SGVue test'),('SGVue'),'','','');",
          "FILE_SCHEMA(('IFC4'));",
          'ENDSEC;',
          'DATA;',
          '#1=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);',
          '#2=IFCUNITASSIGNMENT((#1));',
          `#3=IFCCARTESIANPOINT((${location}));`,
          '#4=IFCDIRECTION((0.,0.,1.));',
          `#5=IFCDIRECTION((${ref}));`,
          '#6=IFCAXIS2PLACEMENT3D(#3,#4,#5);',
          "#7=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#6,$);",
          "#8=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#7,$,.MODEL_VIEW.,$);",
          "#9=IFCPROJECT('0000000000000000000001',$,'Probe',$,$,$,$,(#7),#2);",
          '#10=IFCCARTESIANPOINT((0.,0.,0.));',
          '#11=IFCAXIS2PLACEMENT3D(#10,$,$);',
          '#12=IFCLOCALPLACEMENT($,#11);',
          "#13=IFCSITE('0000000000000000000002',$,'Site',$,$,#12,$,$,.ELEMENT.,$,$,$,$,$);",
          "#14=IFCRELAGGREGATES('0000000000000000000003',$,$,$,#9,(#13));",
          '#15=IFCCARTESIANPOINT((2.,1.,0.));',
          '#16=IFCAXIS2PLACEMENT3D(#15,$,$);',
          '#17=IFCLOCALPLACEMENT(#12,#16);',
          '#18=IFCRECTANGLEPROFILEDEF(.AREA.,$,$,6.,4.);',
          '#19=IFCCARTESIANPOINT((3.,2.,0.));',
          '#20=IFCAXIS2PLACEMENT3D(#19,$,$);',
          '#21=IFCEXTRUDEDAREASOLID(#18,#20,#4,0.2);',
          "#22=IFCSHAPEREPRESENTATION(#8,'Body','SweptSolid',(#21));",
          '#23=IFCPRODUCTDEFINITIONSHAPE($,$,(#22));',
          "#24=IFCSLAB('0000000000000000000004',$,'Slab',$,$,#17,#23,$,.FLOOR.);",
          "#25=IFCRELCONTAINEDINSPATIALSTRUCTURE('0000000000000000000005',$,$,$,(#24),#13);",
          'ENDSEC;',
          'END-ISO-10303-21;'
        ].join('\n')
      )
    // Each probe model is closed again, so none outlives the test in the shared source.
    const placed = (bytes: Uint8Array): number[][] => {
      const id = src.openFromBuffer(bytes)
      try {
        const out: number[][] = []
        src.streamAllMeshes(id, (mesh) => mesh.placements.forEach((p) => out.push([...p.flatTransformation])))
        return out
      } finally {
        src.close(id)
      }
    }
    const plain = placed(file('0.,0.,0.', '1.,0.,0.'))
    const moved = placed(file('1000.,2000.,300.', '0.866025403784439,0.5,0.'))
    expect(plain).toHaveLength(1)
    expect(moved).toEqual(plain)
    // …while the index builder does read it, and `mapPlacement` is what applies it.
    const id = src.openFromBuffer(file('1000.,2000.,300.', '0.866025403784439,0.5,0.'))
    try {
      const index = buildModelIndex(src, id, { modelKey: 'probe', fileName: 'probe.ifc', sha256: '' })
      expect(index.georef.wcs!.origin).toEqual([1000, 2000, 300])
      expect(index.georef.wcs!.rotationDeg).toBeCloseTo(30, 9)
      expect(mapPlacement(index.georef).placedBy).toBe('WorldCoordinateSystem')
    } finally {
      src.close(id)
    }
  })

  it('gives every one of them the same federation frame P — the synthetic map position', async () => {
    for (const f of FILES) {
      const P = federationFrame((await byFile(f)).index.georef)!
      expect(frameKey(P), f).toBe(SITE_KEY)
      P.origin.forEach((v, i) => expect(Math.abs(v - SITE[i]), f).toBeLessThan(MM))
    }
  })

  it('federates every pair within a millimetre, in either boot order', async () => {
    const { src } = await ready
    let pairs = 0
    for (const bootFile of FILES) {
      const boot = await byFile(bootFile)
      const first = stream(src, boot, boot, null)
      const firstMeta = metaOf(boot.index, first.offset, first.frame)
      const firstVerts = vertices(boot, first)
      const firstBoxes = boxes(boot, first)

      // The building stands square with its own axes in every federation, with P taking its
      // origin to the synthetic map position: Slab L1 is 20 × 12 m from the project origin.
      const slab = boot.index.elements.find((e) => e.name === 'Slab L1')!
      within(firstBoxes.get(slab.guid)!, [0, 0, 0, 20, 12, 0.2], `${bootFile} Slab L1`)
      within(toWorld(federationFrame(boot.index.georef), 0, 0, 0), SITE, bootFile)

      for (const joinFile of FILES) {
        if (joinFile === bootFile) continue
        const join = await byFile(joinFile)
        const joined = stream(src, boot, join, first.offset)
        const at = `${bootFile} + ${joinFile}`
        expect(joined.offset, at).toEqual(first.offset)

        const verts = vertices(join, joined)
        expect([...verts.keys()].sort(), at).toEqual([...firstVerts.keys()].sort())
        for (const [guid, list] of verts) within(list, firstVerts.get(guid)!, `${at} vertices ${guid}`)

        for (const [guid, box] of boxes(join, joined)) within(box, firstBoxes.get(guid)!, `${at} box ${guid}`)

        const meta = metaOf(join.index, joined.offset, joined.frame)
        const names = (list: typeof meta.grids): string[] => list!.map((g) => g.name).sort()
        const grid = (name: string, list: typeof meta.grids): number[] => {
          const g = list!.find((x) => x.name === name)!
          return [...g.start, ...g.end]
        }
        expect(names(meta.grids), at).toEqual(names(firstMeta.grids))
        for (const { name } of meta.grids!) {
          within(grid(name, meta.grids), grid(name, firstMeta.grids), `${at} grid ${name}`)
        }
        for (const s of meta.storeys!) {
          const twin = firstMeta.storeys!.find((x) => x.name === s.name)!
          expect(Math.abs(s.elev - twin.elev), `${at} storey ${s.name}`).toBeLessThan(MM)
        }
        pairs++
      }
    }
    expect(pairs).toBe(FILES.length * (FILES.length - 1))
  })

  it('agrees with IfcOpenShell product by product: auto_xyz2enh on (a), (b), (f) and (k), its WCS and TrueNorth readings on (i) and (j)', async () => {
    // `scripts/make-tiny-ifc.py` wrote these with `ifcopenshell.util.geolocation.auto_xyz2enh`:
    // each product's placement origin, in map metres. IfcOpenShell trusts `Scale`, which is right
    // for (a), (b), (f) and (k); ours never reads it, and must land on the same points. For (k) it
    // undoes the WorldCoordinateSystem before the conversion — the reading `mapPlacement` takes.
    // (i) and (j) carry no conversion, which `auto_xyz2enh` returns unmoved, so the script read
    // them with IfcOpenShell's own `get_wcs` and `get_true_north`, composed as Revit writes them.
    const { src } = await ready
    const expected = JSON.parse(readFileSync(join(DIR, 'ifcopenshell-map.json'), 'utf8')) as {
      files: Record<string, Record<string, [number, number, number]>>
      wcsFiles: Record<string, Record<string, [number, number, number]>>
    }
    const sections = { ...expected.files, ...expected.wcsFiles }
    expect(Object.keys(sections).sort()).toEqual([
      'a-site-placement.ifc',
      'b-map-conversion.ifc',
      'f-ifc2x3-epset.ifc',
      'i-wcs-base-point.ifc',
      'j-ifc2x3-wcs.ifc',
      'k-wcs-and-conversion.ifc'
    ])
    let checked = 0
    for (const [file, points] of Object.entries(sections)) {
      const m = await byFile(file as (typeof FILES)[number])
      const operation = mapPlacement(m.index.georef).operation
      const product = src.typeCode('IFCPRODUCT')
      const before = checked
      for (const id of src.idsWithType(m.modelID, product, true)) {
        const line = src.line(m.modelID, id)
        const guid = (line?.GlobalId as { value?: string } | undefined)?.value
        const placement = (line?.ObjectPlacement as { value?: number } | undefined)?.value
        if (!guid || !placement || !points[guid]) continue
        const w = placementMatrix(src, m.modelID, placement, m.index.units.length)
        within(toWorld(operation, w[12], w[13], w[14]), points[guid], `${file} ${guid}`)
        checked++
      }
      expect([file, checked - before]).toEqual([file, Object.keys(points).length])
    }
    expect(checked).toBe(Object.values(sections).reduce((n, p) => n + Object.keys(p).length, 0))
  })
})
