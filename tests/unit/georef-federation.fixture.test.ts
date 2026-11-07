/**
 * Origin to origin (2026-11-07) on real files: the committed synthetic fixtures in
 * `tests/fixtures/georef/`, through the real index builder and geometry streamer under Node, as
 * `geometry-streamer.fixture.test.ts` runs them — and through `federation-store.ts`'s own `metaOf`
 * for the grids and the storeys.
 *
 * The fixtures are **one** building at the repository's synthetic map position (site
 * 12345.457 / 23456.766 / 5.05 m, −43.4103°), written the eleven ways an exporter can say where
 * it is (`scripts/make-tiny-ifc.py` has each): (a) on its site placement beside a zero
 * conversion, (b) in an `IfcMapConversion` over a site at the file's zero, (c) as (b) with no
 * `Scale`, (d) with `Scale` 1000, (e) with the map unit the foot, (f) IFC2X3's property sets,
 * (g) a local site offset that carries the turn, the survey point in the conversion, and a decoy
 * conversion on a 2D `Plan` context written first, (h) as (g) with the survey point's conversion
 * on the `Model` context's `Body` sub-context, (i) Revit "Project Base Point" with no EPSG code:
 * no conversion, the base point's E / N / H on the `Model` context's `WorldCoordinateSystem` and
 * the turn only in `TrueNorth`, (j) the same in IFC2X3, (k) a `WorldCoordinateSystem` beside a
 * conversion.
 *
 * The owner, 2026-11-07: *"only focus on the internal origin of the model like how Naviswork
 * do"*. So each is drawn at its **file's own coordinates** — its site placement, as web-ifc
 * applies it, and nothing a file says about the map — whatever was opened before it; only (a),
 * whose coordinates are its map position, stands at the map position, and the Coordinate-system
 * card's note names the other ten. Until then they were assembled in map space (a and b 26 km
 * apart by world coordinates, together by map coordinates); the map readings are still tested
 * here, as readings.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { federate } from '../../src/shared/federate'
import { composeFrames, georefSourceOf, mapPlacement, projectFrame, toWorld } from '../../src/shared/georef'
import { foldQuarter, planRotationDeg } from '../../src/shared/plan-rotation'
import type { FederationOffset, GeometryChunk } from '../../src/shared/geometry-contract.types'
import type { ModelIndex } from '../../src/shared/model-index.types'
import { elementBoxes } from '../../src/renderer/model/element-boxes'
import { drawnCentreOf, metaOf } from '../../src/renderer/model/federation-store'
import { lineUpNote, notLinedUp } from '../../src/renderer/state/selectors/status'
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
/** A millimetre. */
const MM = 0.001
/**
 * A micrometre: part boxes are composed in Float64, so a world box read back through any whole-
 * metre offset is the same to far better than this.
 */
const UM = 1e-6

interface Opened {
  file: string
  modelID: number
  index: ModelIndex
}

interface Streamed {
  offset: FederationOffset
  chunks: GeometryChunk[]
  bbox6: readonly [number, number, number, number, number, number] | null
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

/**
 * Stream one model the way `FederationController.prepare` does: with the offset in force and
 * nothing else — no other model's georeferencing, no frame (2026-11-07).
 */
function stream(src: ReadOnlyIfcSource, m: Opened, offset: FederationOffset | null): Streamed {
  const chunks: GeometryChunk[] = []
  const summary = streamGeometry(src, m.modelID, { modelKey: m.file, offset, onChunk: (c) => chunks.push(c) })
  return { offset: summary.offset, chunks, bbox6: summary.bbox6 }
}

/** Every element's vertices in the file's world coordinates — the scene plus the offset — by GlobalId. */
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
          k[0] * x + k[4] * y + k[8] * z + k[12] + s.offset[0],
          k[1] * x + k[5] * y + k[9] * z + k[13] + s.offset[1],
          k[2] * x + k[6] * y + k[10] * z + k[14] + s.offset[2]
        )
      }
      out.set(guid.get(part.elementId)!, list)
    }
  }
  return out
}

/** Each element's box in the file's world coordinates — the app's own union (`element-boxes.ts`). */
function boxes(m: Opened, s: Streamed): Map<string, readonly number[]> {
  const guid = new Map(m.index.elements.map((e) => [e.expressId, e.guid]))
  return new Map([...elementBoxes(s.chunks, s.offset)].map(([id, g]) => [guid.get(id)!, g.box]))
}

const worst = (a: readonly number[], b: readonly number[]): number => {
  expect(a.length).toBe(b.length)
  return a.reduce((w, v, i) => Math.max(w, Math.abs(v - b[i])), 0)
}

/** Every number of `a` within `tol` (a millimetre) of `b`'s. */
const within = (a: readonly number[], b: readonly number[], what: string, tol = MM): void => {
  expect(worst(a, b), what).toBeLessThan(tol)
}

/** Each part's own box in world coordinates, Float64 (`PartRecord.bbox6` + the offset), in stream order. */
function partBoxes(s: Streamed): number[] {
  const out: number[] = []
  for (const chunk of s.chunks) {
    for (const part of chunk.parts) part.bbox6.forEach((v, i) => out.push(v + s.offset[i % 3]))
  }
  return out
}

/** A small deterministic generator, so the shuffles below are the same every run. */
function shuffled<T>(list: readonly T[], seed: number): T[] {
  const out = [...list]
  let x = seed
  for (let i = out.length - 1; i > 0; i--) {
    x = (x * 1103515245 + 12345) % 2147483648
    const j = x % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Every order of `list`. */
const permutations = <T>(list: readonly T[]): T[][] =>
  list.length <= 1
    ? [[...list]]
    : list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [x, ...rest]))

describe('origin to origin — the synthetic fixtures through the real index builder', () => {
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
    // same placement both times. Since 2026-11-07 nothing in the app applies it either — a model
    // is drawn at its file's own coordinates — so if an upgrade starts to apply it, this fails
    // before files placed that way start to move.
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
    // …while the index builder does read it, and `mapPlacement` reads it as the map position.
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

  it('declares the same map position in every one of them — read, not applied', async () => {
    for (const f of FILES) {
      const g = (await byFile(f)).index.georef
      // M ∘ Site: the file's map operation over its site placement — the Coordinate-system card's
      // base point — is the synthetic map position, eleven ways.
      const declared = composeFrames(mapPlacement(g).operation, projectFrame(g))!
      declared.origin.forEach((v, i) => expect(Math.abs(v - SITE[i]), f).toBeLessThan(MM))
      expect(declared.rotationDeg, f).toBeCloseTo(-43.4103, 4)
    }
  })

  it('draws each model at its file’s own coordinates: its site placement, and nothing a file says about the map', async () => {
    const { src } = await ready
    for (const f of FILES) {
      const m = await byFile(f)
      const own = stream(src, m, null)
      // Slab L1 is 20 × 12 × 0.2 m from the project origin; in world coordinates it is that box
      // taken through the file's own site placement — which web-ifc applies — and no further.
      const slab = m.index.elements.find((e) => e.name === 'Slab L1')!
      const site = projectFrame(m.index.georef)
      const corners = [0, 20].flatMap((x) => [0, 12].flatMap((y) => [0, 0.2].map((z) => toWorld(site, x, y, z))))
      const box = [0, 1, 2].map((a) => Math.min(...corners.map((c) => c[a])))
      box.push(...[0, 1, 2].map((a) => Math.max(...corners.map((c) => c[a]))))
      within(boxes(m, own).get(slab.guid)!, box, `${f} Slab L1`)
      // The grids and storeys reach the viewer as the file has them.
      const meta = metaOf(m.index, own.offset)
      expect(meta.grids, f).toEqual(m.index.grids.map((g) => ({ name: g.name, start: [...g.start], end: [...g.end] })))
      expect(meta.storeys!.map((x) => x.elev), f).toEqual(m.index.storeys.map((x) => x.placement?.[2] ?? x.elev))
    }
    // (a) is placed by its site, at the map position; (b) stands at the file's zero, 26 km off.
    const a = await byFile('a-site-placement.ifc')
    const b = await byFile('b-map-conversion.ifc')
    const slabA = boxes(a, stream(src, a, null)).get(a.index.elements.find((e) => e.name === 'Slab L1')!.guid)!
    const slabB = boxes(b, stream(src, b, null)).get(b.index.elements.find((e) => e.name === 'Slab L1')!.guid)!
    within(slabB, [0, 0, 0, 20, 12, 0.2], 'b Slab L1 at the origin')
    expect(Math.hypot(slabA[0] - SITE[0], slabA[1] - SITE[1])).toBeLessThan(25)
  })

  it('draws every model the same whatever was opened before it — all 24 orders of four, and shuffles of all eleven', async () => {
    const { src } = await ready
    /** Each model alone: its own offset, its world part boxes, its world vertices. */
    const alone = new Map<string, { parts: number[]; verts: Map<string, number[]> }>()
    for (const f of FILES) {
      const m = await byFile(f)
      const s = stream(src, m, null)
      alone.set(f, { parts: partBoxes(s), verts: vertices(m, s) })
    }
    const four = ['a-site-placement.ifc', 'b-map-conversion.ifc', 'i-wcs-base-point.ifc', 'k-wcs-and-conversion.ifc'] as const
    const orders: string[][] = [...permutations([...four]), ...[1, 2, 3, 4, 5, 6].map((seed) => shuffled([...FILES], seed))]
    expect(orders).toHaveLength(30)
    let compared = 0
    for (const order of orders) {
      let offset: FederationOffset | null = null
      for (const f of order) {
        const m = await byFile(f as (typeof FILES)[number])
        const s = stream(src, m, offset)
        offset ??= s.offset
        expect(s.offset).toEqual(offset)
        const ref = alone.get(f)!
        const at = `${order.map((x) => x[0]).join('')}: ${f}`
        // Float64 part boxes: the same to a micrometre through any offset.
        within(partBoxes(s), ref.parts, `${at} parts`, UM)
        // Float32 vertices: the same to a millimetre — a whole-metre offset changes only how a
        // far translation rounds into the 32-bit matrix the GPU is handed.
        const verts = vertices(m, s)
        expect([...verts.keys()].sort(), at).toEqual([...ref.verts.keys()].sort())
        for (const [guid, list] of verts) within(list, ref.verts.get(guid)!, `${at} vertices ${guid}`)
        compared++
      }
    }
    expect(compared).toBe(24 * 4 + 6 * FILES.length)
  })

  it('turns only the camera: one plan rotation, to the bit, in every load order, square with the grids', async () => {
    const all = await Promise.all(FILES.map((f) => byFile(f)))
    const plan = (list: readonly Opened[]): number => planRotationDeg(list.map((o) => o.index))
    /** Every grid of `list`, in the plan `deg` stands at, is at 0° or 90° within 0.01°. */
    const square = (list: readonly Opened[], deg: number, what: string): void => {
      for (const o of list) {
        for (const g of o.index.grids) {
          const d = (Math.atan2(g.end[1] - g.start[1], g.end[0] - g.start[0]) * 180) / Math.PI
          expect(Math.abs(foldQuarter(d - deg)), `${what} ${o.file} grid ${g.name}`).toBeLessThan(0.01)
        }
      }
    }
    // Drawn at their file's own coordinates, (a), (g) and (h) stand at the synthetic −43.41° —
    // the site placement carries the turn — and the other eight at the file's own axes.
    const turned = ['a-site-placement.ifc', 'g-survey-point.ifc', 'h-sub-context.ifc']
    for (const o of all) {
      const deg = plan([o])
      if (turned.includes(o.file)) expect(deg, o.file).toBeCloseTo(-43.4103, 4)
      else expect(deg, o.file).toBe(0)
      square([o], deg, 'alone')
    }
    // The same order set as the placement test: every order of four, and six shuffles of all
    // eleven — the same number, ===, every time.
    const four = all.filter((o) => ['a-site-placement.ifc', 'b-map-conversion.ifc', 'i-wcs-base-point.ifc', 'k-wcs-and-conversion.ifc'].includes(o.file))
    const orders = [...permutations(four), ...[1, 2, 3, 4, 5, 6].map((seed) => shuffled(all, seed))]
    const fourDeg = plan(four)
    const allDeg = plan(all)
    for (const order of orders) expect(plan(order)).toBe(order.length === 4 ? fourDeg : allDeg)
    // A federation of the ones drawn turned is squared by it, in every order.
    const same = all.filter((o) => turned.includes(o.file))
    const sameDeg = plan(same)
    for (const order of permutations(same)) expect(plan(order)).toBe(sameDeg)
    square(same, sameDeg, 'together')
  })

  it('names in the card’s note exactly the fixtures whose map position is not where their file puts them', async () => {
    const { src } = await ready
    const indexes: ModelIndex[] = []
    let offset: FederationOffset | null = null
    for (const f of FILES) {
      const m = await byFile(f)
      const s = stream(src, m, offset)
      offset ??= s.offset
      indexes.push({ ...m.index, drawnCentre: drawnCentreOf(s.bbox6!, s.offset) })
    }
    const named = notLinedUp({ federation: federate(indexes), library: [], uploadNames: {} })
    /**
     * Derived from what each file states, one line each:
     *  a — not named: its map position is its site placement, which is what draws it;
     *  b, c, d — an IfcMapConversion over a site at the file's zero: 26.5 km and 43.41° away;
     *  e — the same in US survey feet: the same distance once the foot is applied;
     *  f — IFC2X3's ePset_MapConversion, as (b);
     *  g, h — a local site offset with the turn, the survey point's conversion on top: 26.5 km;
     *  i, j — the WorldCoordinateSystem is the map position and TrueNorth the turn (rule 4);
     *  k — a conversion beside a WorldCoordinateSystem, read with the WCS undone first.
     */
    const expected = FILES.filter((f) => f !== 'a-site-placement.ifc')
    expect(named.map((x) => x.key)).toEqual(expected)
    for (const x of named) {
      expect(x.metres, x.key).toBeGreaterThan(26_000)
      expect(x.metres, x.key).toBeLessThan(27_000)
    }
    // The line the card shows for (b) beside (a) — what the end-to-end test reads in the app.
    const ab = notLinedUp({ federation: federate([indexes[1], indexes[0]]), library: [], uploadNames: {} })
    expect(lineUpNote(ab)).toBe(
      "b-map-conversion.ifc's map position is 26.5 km from where its file places it — ask for a Shared Coordinates export."
    )
    // …and the card's file is (a), by key, whichever was opened first: the two tie on elements.
    expect(indexes[0].counts.elements).toBe(indexes[1].counts.elements)
    expect(georefSourceOf([indexes[1], indexes[0]])!.modelKey).toBe('a-site-placement.ifc')
    // Where IfcOpenShell computed the map position independently, the note agrees with it: a
    // fixture is named exactly when IfcOpenShell's map point for its site is not its world one.
    const expectedMap = JSON.parse(readFileSync(join(DIR, 'ifcopenshell-map.json'), 'utf8')) as {
      files: Record<string, Record<string, [number, number, number]>>
      wcsFiles: Record<string, Record<string, [number, number, number]>>
    }
    const sections = { ...expectedMap.files, ...expectedMap.wcsFiles }
    for (const [file, points] of Object.entries(sections)) {
      const m = await byFile(file as (typeof FILES)[number])
      let moved = 0
      for (const id of src.idsWithType(m.modelID, src.typeCode('IFCPRODUCT'), true)) {
        const line = src.line(m.modelID, id)
        const guid = (line?.GlobalId as { value?: string } | undefined)?.value
        const placement = (line?.ObjectPlacement as { value?: number } | undefined)?.value
        if (!guid || !placement || !points[guid]) continue
        const w = placementMatrix(src, m.modelID, placement, m.index.units.length)
        moved = Math.max(moved, Math.hypot(points[guid][0] - w[12], points[guid][1] - w[13], points[guid][2] - w[14]))
      }
      expect([file, moved > 1]).toEqual([file, named.some((x) => x.key === file)])
    }
  })

  it('reads each map position as IfcOpenShell does, product by product: auto_xyz2enh on (a), (b), (f) and (k), its WCS and TrueNorth readings on (i) and (j)', async () => {
    // A reading only since 2026-11-07 — it is what the note measures against, never where a model
    // is drawn. `scripts/make-tiny-ifc.py` wrote these with `ifcopenshell.util.geolocation.auto_xyz2enh`:
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
