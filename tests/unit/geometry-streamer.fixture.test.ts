/**
 * The geometry streamer against a real file.
 *
 * Runs the same `geometry-streamer.ts` the worker runs, under `web-ifc-api-node` — web-ifc's
 * own `exports` map picks the Node build, so this is not a parallel implementation.
 *
 * It is here because the three defects this code exists to avoid are all invisible in a
 * browser: a model placed 33 km from the file origin quietly loses millimetres to float32, a
 * double-applied unit turns a 415 m building into a 40 cm one, and a missed axis swap lays
 * the building on its side — which looks like a plausible building until you notice the
 * storeys stack sideways. All three show up as a number in a Node harness and nowhere else.
 *
 * `samples/` is git-ignored — real project models never enter the repository — so with no
 * model present this reports itself as skipped rather than failing.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { projectFrame, toProject, type ProjectFrame } from '../../src/shared/georef'
import type { GeometryChunk, GeometrySummary } from '../../src/shared/geometry-contract.types'
import type { GridAxisRecord, Storey } from '../../src/shared/model-index.types'
import { elementBoxes, type ElementGeometry } from '../../src/renderer/model/element-boxes'
import { streamGeometry } from '../../src/worker/geometry-streamer'
import { createReadOnlyIfcSource } from '../../src/worker/ifc-source'
import { buildModelIndex } from '../../src/worker/index-builder'
import { checkGeometryChunks } from './geometry-contract'

const ROOT = join(__dirname, '..', '..')
const MODEL = join(ROOT, 'samples', 'Sample Ifc Model.ifc')
/** The IfcOpenShell ground truth for the same file, when it has been generated. */
const EXPECTED = join(ROOT, 'tests', 'fixtures', 'Sample Ifc Model.expected.json')

interface ExpectedSample {
  expressId: number
  type: string
  /** IfcOpenShell's own tessellation, axis-aligned, in the file's world coordinates. */
  worldBox?: number[]
  /** The same vertices in the project frame — what the app's element box must read. */
  projectBox?: number[]
  qtos?: Record<string, Record<string, number>>
}

if (!existsSync(MODEL)) {
  // vitest's default reporter swallows `console` from passing tests, and `samples/` is
  // git-ignored, so this notice is the only sign the check did not actually run.
  process.stderr.write(
    `[geometry] skipped: no model at ${MODEL} — drop an .ifc there to run the streamer ` +
      'against a real file. samples/ is git-ignored on purpose.\n'
  )
  describe('geometry streamer', () => {
    it.skip('skipped: no model in samples/', () => {})
  })
} else {
  // Streaming a 138 MB model takes about five seconds; the default 5 s per test is not it.
  vi.setConfig({ testTimeout: 120_000 })

  describe(`geometry streamer — ${basename(MODEL)}`, () => {
    const chunks: GeometryChunk[] = []
    let summary: GeometrySummary
    let storeys: readonly Storey[] = []
    let grids: readonly GridAxisRecord[] = []
    let frame: ProjectFrame | null = null
    let openMs = 0
    let bytes = 0
    /** Every element the index carries, by its model-local id — the key a part is joined on. */
    let elementIds: ReadonlySet<number> = new Set()
    /** Streamed part ids the index does not carry, counted by IFC entity. */
    let offIndex: Record<string, number> = {}

    // One parse and one stream for the whole file; both are measured in seconds.
    const ready = (async () => {
      const file = readFileSync(MODEL)
      bytes = statSync(MODEL).size
      const src = await createReadOnlyIfcSource()
      const openedAt = Date.now()
      const modelID = src.openFromBuffer(new Uint8Array(file))
      openMs = Date.now() - openedAt
      // The index comes first now, because the project frame is read from it — exactly as the
      // app does it: parse, take the frame off the georeferencing, then stream the geometry.
      const index = buildModelIndex(src, modelID, {
        modelKey: 'FIXTURE',
        fileName: basename(MODEL),
        sha256: ''
      })
      storeys = index.storeys
      grids = index.grids
      elementIds = new Set(index.elements.map((e) => e.id))
      frame = projectFrame(index.georef)
      summary = streamGeometry(src, modelID, {
        modelKey: 'FIXTURE',
        offset: null,
        frame,
        onChunk: (chunk) => chunks.push(chunk)
      })
      // `StreamAllMeshes` walks every product with a representation, which is a wider set than
      // the index's `IfcElement` (minus openings) plus `IfcSpace`. Name what the difference is
      // while the source is still open: those parts are drawn and picked, but they are not
      // elements, so they get no row in the index and no `bbox`.
      for (const id of new Set(chunks.flatMap((c) => c.parts.map((p) => p.elementId)))) {
        if (elementIds.has(id)) continue
        const name = src.typeName(src.lineType(modelID, id))
        offIndex[name] = (offIndex[name] ?? 0) + 1
      }
      src.close(modelID)
      src.dispose()
      process.stderr.write(
        `[geometry] ${basename(MODEL)} ${(bytes / 1048576).toFixed(1)} MB · open ${openMs} ms · ` +
          `stream ${summary.ms} ms · ${summary.chunks} chunks · ` +
          `${summary.geometries.toLocaleString('en-US')} geometries / ` +
          `${summary.parts.toLocaleString('en-US')} parts · ` +
          `${summary.vertices.toLocaleString('en-US')} vertices · ` +
          `${summary.triangles.toLocaleString('en-US')} triangles · ` +
          `${summary.edgeSegments.toLocaleString('en-US')} edge segments · ` +
          `method ${index.georef.method} · ` +
          `frame ${frame ? `[${frame.origin.map((v) => v.toFixed(3)).join(', ')}] ${frame.rotationDeg.toFixed(4)}°` : 'identity'} · ` +
          `offset [${summary.offset.join(', ')}] (project, Z-up) · ` +
          `bbox ${summary.bbox6 ? summary.bbox6.map((v) => v.toFixed(1)).join(', ') : 'empty'} · ` +
          `storeys ${storeys.length} ${storeys[0]?.elev.toFixed(2)}…${storeys[storeys.length - 1]?.elev.toFixed(2)} m · ` +
          `warnings ${summary.warnings.map((w) => w.kind).join(', ') || 'none'}\n`
      )
    })()

    const size = (b: readonly number[]): number[] => [b[3] - b[0], b[4] - b[1], b[5] - b[2]]
    const samples = (): Record<string, ExpectedSample> =>
      JSON.parse(readFileSync(EXPECTED, 'utf8')).samples
    /**
     * Every part of one element, unioned, with the offset added back: the app's own box.
     * This is the shipped function — `renderer/model/element-boxes.ts`, the one that fills
     * `IfcElement.bbox` — so the IfcOpenShell agreement below is a check of what the app
     * actually stores, not of a copy of it kept in a test.
     */
    const boxes = (): Map<number, ElementGeometry> => elementBoxes(chunks, summary.offset)
    const boxOf = (expressId: number): number[] | null => boxes().get(expressId)?.box ?? null

    it('streams meshes', async () => {
      await ready
      expect(summary.chunks).toBeGreaterThan(0)
      expect(summary.parts).toBeGreaterThan(0)
      expect(chunks).toHaveLength(summary.chunks)
      expect(chunks.reduce((sum, c) => sum + c.parts.length, 0)).toBe(summary.parts)
    })

    it('emits chunks that satisfy the geometry contract', async () => {
      await ready
      expect(checkGeometryChunks(chunks)).toEqual([])
    })

    it('instances repeats: fewer unique geometries than parts', async () => {
      await ready
      expect(summary.geometries).toBeLessThan(summary.parts)
    })

    it('carries crease edges on real geometry', async () => {
      await ready
      expect(summary.edgeSegments).toBeGreaterThan(0)
      // Not just on a handful of shapes: most solids have at least one crease.
      const withEdges = chunks
        .flatMap((c) => c.geoms)
        .filter((g) => g.edgeCount > 0).length
      const all = chunks.reduce((sum, c) => sum + c.geoms.length, 0)
      expect(withEdges / all).toBeGreaterThan(0.5)
    })

    it('applies the offset, so the model sits near the origin', async () => {
      await ready
      // The file itself is tens of kilometres out; after the offset the centre must be
      // within a few hundred metres of zero or the subtraction did not happen.
      expect(summary.offset.some((v) => Math.abs(v) > 1)).toBe(true)
      expect(summary.offset.every(Number.isInteger)).toBe(true)
      const box = summary.bbox6!
      expect(box.every(Number.isFinite)).toBe(true)
      const centre = [0, 1, 2].map((k) => (box[k] + box[k + 3]) / 2)
      expect(Math.hypot(...centre)).toBeLessThan(500)
    })

    it('gives every part a finite box that is not the whole model', async () => {
      await ready
      const box = summary.bbox6!
      const size = Math.max(box[3] - box[0], box[4] - box[1], box[5] - box[2])
      // A double-applied length unit would make this metres instead of hundreds of metres.
      expect(size).toBeGreaterThan(10)
      for (const chunk of chunks) {
        for (const part of chunk.parts) {
          expect(part.bbox6.every(Number.isFinite)).toBe(true)
          expect(part.bbox6[0]).toBeLessThanOrEqual(part.bbox6[3])
          expect(part.bbox6[1]).toBeLessThanOrEqual(part.bbox6[4])
          expect(part.bbox6[2]).toBeLessThanOrEqual(part.bbox6[5])
        }
      }
    })

    it('stands the model square with its own grid', async () => {
      await ready
      // The reference model's grid runs at 46.59° and 136.59° in the file's world coordinates,
      // because the site placement carries the project's rotation to true north. Put through
      // the project frame the two families must come back to the building's own axes — which
      // is what makes level rings, dimension lines and the N/S/E/W views mean anything.
      expect(grids.length).toBeGreaterThan(1)
      const deg = grids.map((g) => {
        const a = toProject(frame, g.start[0], g.start[1], 0)
        const b = toProject(frame, g.end[0], g.end[1], 0)
        const d = ((((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI) % 180) + 180) % 180
        return d > 179.99 ? d - 180 : d
      })
      const off = deg.map((d) => Math.min(Math.abs(d), Math.abs(d - 90)))
      expect(Math.max(...off)).toBeLessThan(0.01)
      // Both families are present — this is not one family read twice.
      expect(deg.some((d) => Math.abs(d) < 0.01)).toBe(true)
      expect(deg.some((d) => Math.abs(d - 90) < 0.01)).toBe(true)
    })

    it('puts every storey floor inside the geometry it belongs to', async () => {
      await ready
      const box = summary.bbox6!
      expect(storeys.every((s) => !!s.placement)).toBe(true)
      // The level ring's height: the storey's own placement, through the frame, less the
      // offset. `Elevation` alone is short by the site's own 5.05 m on this file.
      const rings = storeys.map(
        (s) => toProject(frame, s.placement![0], s.placement![1], s.placement![2])[2] - summary.offset[2]
      )
      expect(Math.min(...rings)).toBeGreaterThan(box[2] - 1)
      expect(Math.max(...rings)).toBeLessThan(box[5] + 1)
    })

    it('is Z-up: the storey ladder from IfcSite lands inside the geometry\u2019s z range', async () => {
      await ready
      const box = summary.bbox6!
      expect(storeys.length).toBeGreaterThan(1)
      // Storey floors in the project frame; the offset is the only thing between them and
      // the scene, and it is stated in the same Z-up project frame.
      const elev = storeys.map(
        (s) => toProject(frame, s.placement![0], s.placement![1], s.placement![2])[2] - summary.offset[2]
      )
      const lo = Math.min(...elev)
      const hi = Math.max(...elev)
      // Every storey sits within the geometry's z span (a slab hangs below the lowest one,
      // parapets above the highest, so a metre of slack each way).
      expect(lo).toBeGreaterThan(box[2] - 1)
      expect(hi).toBeLessThan(box[5] + 1)
      // And the ladder has to account for most of the building's height: if x or y were up,
      // the storeys would span a few metres of a 400 m footprint instead.
      const zSpan = box[5] - box[2]
      expect((hi - lo) / zSpan).toBeGreaterThan(0.5)
      // The footprint is the other two axes, and a building is wider than it is tall.
      expect(Math.max(box[3] - box[0], box[4] - box[1])).toBeGreaterThan(zSpan)
    })

    it('reports the coordination matrix without applying it', async () => {
      await ready
      // COORDINATE_TO_ORIGIN stays false, so web-ifc reports identity and the recentring is
      // ours alone. If this ever stops being identity, the offsets between models are gone.
      expect(summary.coordinationMatrix).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    })

    it('unions one box per element with geometry, on ids the index actually carries', async () => {
      await ready
      const boxed = boxes()
      // The join is `PartRecord.elementId` ↔ `IfcElement.id`, both the model-local expressId.
      // Most streamed ids are elements; the rest are products the index does not carry
      // (IfcAnnotation, IfcGrid, …) and they simply never meet an element, which is what
      // `FederationController.prepare` relies on — it reads the map by element id.
      const onIndex = [...boxed.keys()].filter((id) => elementIds.has(id))
      expect(onIndex.length).toBeGreaterThan(0)
      expect(onIndex.length).toBeLessThanOrEqual(elementIds.size)
      let counted = 0
      for (const { box, parts } of boxed.values()) {
        expect(box.every(Number.isFinite)).toBe(true)
        expect(box[0]).toBeLessThanOrEqual(box[3])
        expect(box[1]).toBeLessThanOrEqual(box[4])
        expect(box[2]).toBeLessThanOrEqual(box[5])
        // A box exists because a part made it, so the count is never zero.
        expect(parts).toBeGreaterThan(0)
        counted += parts
      }
      // Every streamed part is counted exactly once — the same total the summary reports.
      expect(counted).toBe(summary.parts)
      process.stderr.write(
        `[geometry] boxes ${onIndex.length.toLocaleString('en-US')} of ` +
          `${elementIds.size.toLocaleString('en-US')} elements · ` +
          `${(elementIds.size - onIndex.length).toLocaleString('en-US')} with no geometry · ` +
          `${(boxed.size - onIndex.length).toLocaleString('en-US')} streamed parts are not ` +
          `elements (${Object.entries(offIndex)
            .sort((a, b) => b[1] - a[1])
            .map(([k, n]) => `${k} ${n}`)
            .join(', ') || 'none'})\n`
      )
    })

    it('agrees with IfcOpenShell on an element’s box in the project frame', async () => {
      await ready
      if (!existsSync(EXPECTED)) {
        process.stderr.write('[geometry] no expected.json — project-box check skipped\n')
        return
      }
      let checked = 0
      for (const [ifcClass, want] of Object.entries(samples())) {
        if (!want.projectBox) continue
        const got = boxOf(want.expressId)
        if (!got) continue
        checked++
        process.stderr.write(
          `[geometry] ${ifcClass} #${want.expressId} project size ` +
            `${size(got).map((v) => v.toFixed(3)).join(' × ')} m · IfcOpenShell ` +
            `${size(want.projectBox).map((v) => v.toFixed(3)).join(' × ')} m · world ` +
            `${size(want.worldBox!).map((v) => v.toFixed(3)).join(' × ')} m\n`
        )
        for (let i = 0; i < 6; i++) {
          // A part's box is the AABB of its transformed local AABB (conservative for a part
          // whose own outline is not axis-aligned), so the app's box CONTAINS IfcOpenShell's.
          const slack = i < 3 ? want.projectBox[i] - got[i] : got[i] - want.projectBox[i]
          expect(slack, `${ifcClass}[${i}] contains`).toBeGreaterThan(-0.002)
          expect(slack, `${ifcClass}[${i}] slack`).toBeLessThan(0.05)
        }
      }
      expect(checked).toBeGreaterThan(0)
    })

    it('matches the file’s own base quantities once the frame is undone', async () => {
      await ready
      if (!existsSync(EXPECTED)) return
      const wall = samples().IfcWall
      const qto = Object.values(wall?.qtos ?? {}).find((q) => q.Length != null)
      const got = wall ? boxOf(wall.expressId) : null
      if (!got || !qto) return
      // The wall's world box is 87.5 × 82.8 m, because the file's world axes are map axes and
      // the wall runs at 43° to them. In the project frame it is the wall the file describes:
      // Qto_WallBaseQuantities Length 120 150 mm, Width 300 mm, Height 1 000 mm.
      const [dx, dy, dz] = size(got)
      process.stderr.write(
        `[geometry] IfcWall project ${dx.toFixed(3)} × ${dy.toFixed(3)} × ${dz.toFixed(3)} m · ` +
          `Qto ${((qto.Length as number) / 1000).toFixed(3)} × ${((qto.Width as number) / 1000).toFixed(3)} ` +
          `× ${((qto.Height as number) / 1000).toFixed(3)} m\n`
      )
      expect(dx).toBeCloseTo((qto.Length as number) / 1000, 2)
      expect(dy).toBeCloseTo((qto.Width as number) / 1000, 2)
      expect(dz).toBeCloseTo((qto.Height as number) / 1000, 2)
    })

    it('includes IfcSpace, which StreamAllMeshes leaves out', async () => {
      await ready
      const spaces = chunks.flatMap((c) => c.parts).filter((p) => p.isSpace)
      expect(spaces.length).toBeGreaterThan(0)
    })
  })
}
