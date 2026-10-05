/**
 * IFC conformance: the index builder against IfcOpenShell.
 *
 * `scripts/expected-from-ifcopenshell.py` reads the same file with IfcOpenShell — the
 * reference implementation buildingSMART's own validation service uses — and writes
 * `tests/fixtures/<stem>.expected.json`. This test builds the index over the same file with
 * web-ifc under Node and compares. A divergence is a defect to fix or to document
 * (SYSTEM_SPEC §5), never to hide.
 *
 * `samples/` is git-ignored, so on a machine without the model this test reports itself as
 * skipped rather than failing.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { coordsFromGeoref, detectMethod, projectFrame } from '../../src/shared/georef'
import type { ModelIndex } from '../../src/shared/model-index.types'
import { createReadOnlyIfcSource } from '../../src/worker/ifc-source'
import { buildModelIndex } from '../../src/worker/index-builder'

const ROOT = join(__dirname, '..', '..')
const SAMPLES = join(ROOT, 'samples')
const FIXTURES = join(ROOT, 'tests', 'fixtures')

interface ExpectedSample {
  expressId: number
  guid: string
  type: string
  name: string
  tag: string
  predefinedType: string
  objectType: string
  typeGuid: string
  storey: string
  material: string
  classifications: { system: string; identification: string; name: string; location: string }[]
  psets: Record<string, Record<string, unknown>>
  qtos: Record<string, Record<string, unknown>>
}

interface Expected {
  generatedBy: string
  file: string
  sha256: string
  schema: string
  header: Record<string, unknown>
  units: Record<string, { entity: string; name: string; prefix: string; factor: number | null }>
  counts: {
    elements: number
    openings: number
    spaces: number
    propertySets: number
    quantitySets: number
    byType: Record<string, number>
  }
  storeys: {
    expressId: number
    guid: string
    name: string
    elevation: number
    /** The storey's own `ObjectPlacement` translation in world metres. */
    placement?: number[] | null
    compositionType?: string
  }[]
  /** `CompositionType` of the first `IfcSite` / `IfcBuilding`; added in Phase 4. */
  composition?: { IfcSite: string; IfcBuilding: string }
  georeference: Record<string, unknown>
  samples: Record<string, ExpectedSample>
}

/** Every `<stem>.expected.json` whose `samples/<stem>.ifc` is actually present. */
function fixtures(): { ifc: string; expected: Expected }[] {
  if (!existsSync(FIXTURES) || !existsSync(SAMPLES)) return []
  return readdirSync(FIXTURES)
    .filter((name) => name.endsWith('.expected.json'))
    .map((name) => {
      const stem = name.slice(0, -'.expected.json'.length)
      const expected = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Expected
      return { ifc: join(SAMPLES, expected.file || `${stem}.ifc`), expected }
    })
    .filter(({ ifc }) => existsSync(ifc))
}

const FOUND = fixtures()

if (FOUND.length === 0) {
  // Written straight to stderr because vitest's default reporter swallows `console` output
  // from passing tests. `samples/` is git-ignored, so on another machine this notice is the
  // only sign that the conformance check did not actually run.
  process.stderr.write(
    '[fixture] skipped: no fixture — put a model in samples/ and run ' +
      'scripts/expected-from-ifcopenshell.py to write tests/fixtures/<stem>.expected.json. ' +
      'Both are git-ignored: the model is a real project file and the expected.json carries ' +
      'its metadata, so neither ships in the repository.\n'
  )
  describe('IFC conformance fixture', () => {
    it.skip('skipped: no fixture in samples/', () => {})
  })
}

for (const { ifc, expected } of FOUND) {
  describe(`IFC conformance — ${basename(ifc)} vs ${expected.generatedBy}`, () => {
    let index: ModelIndex
    let sha256: string

    // One parse for the whole file: opening a 144 MB model costs about a second.
    const ready = (async () => {
      const bytes = readFileSync(ifc)
      sha256 = createHash('sha256').update(bytes).digest('hex')
      const src = await createReadOnlyIfcSource()
      const modelID = src.openFromBuffer(new Uint8Array(bytes))
      index = buildModelIndex(src, modelID, {
        modelKey: 'FIXTURE',
        fileName: basename(ifc),
        sha256
      })
      src.close(modelID)
      src.dispose()
    })()

    it('agrees on the schema, the header and the MVD', async () => {
      await ready
      expect(index.schema).toBe(expected.schema)
      expect(index.header.viewDefinition).toBe(expected.header.viewDefinition)
      expect(index.header.description).toEqual(expected.header.description)
      expect(index.header.implementationLevel).toBe(expected.header.implementationLevel)
      expect(index.header.name).toBe(expected.header.name)
      expect(index.header.timeStamp).toBe(expected.header.timeStamp)
      expect(index.header.preprocessorVersion).toBe(expected.header.preprocessorVersion)
      expect(index.header.originatingSystem).toBe(expected.header.originatingSystem)
      expect(index.header.fileSchema).toEqual(expected.header.fileSchema)
    })

    it('agrees on the SHA-256', async () => {
      await ready
      expect(index.sha256).toBe(expected.sha256)
    })

    it('agrees on the unit assignment', async () => {
      await ready
      for (const [unitType, want] of Object.entries(expected.units)) {
        const got = index.units.byType[unitType]
        expect(got, `missing ${unitType}`).toBeDefined()
        expect(got.entity).toBe(want.entity)
        expect(got.name).toBe(want.name)
        expect(got.prefix).toBe(want.prefix)
        if (want.factor === null) expect(got.factor).toBeUndefined()
        else expect(got.factor!).toBeCloseTo(want.factor, 12)
      }
      const length = expected.units.LENGTHUNIT?.factor
      if (length != null) expect(index.units.length).toBeCloseTo(length, 12)
      const area = expected.units.AREAUNIT?.factor
      if (area != null) expect(index.units.area).toBeCloseTo(area, 12)
      const volume = expected.units.VOLUMEUNIT?.factor
      if (volume != null) expect(index.units.volume).toBeCloseTo(volume, 12)
      const angle = expected.units.PLANEANGLEUNIT?.factor
      if (angle != null) expect(index.units.angle).toBeCloseTo(angle, 12)
    })

    it('agrees on the entity counts, by type', async () => {
      await ready
      expect(index.counts.elements).toBe(expected.counts.elements)
      expect(index.counts.openings).toBe(expected.counts.openings)
      expect(index.counts.spaces).toBe(expected.counts.spaces)
      expect(index.counts.psets).toBe(expected.counts.propertySets)
      expect(index.counts.quantitySets).toBe(expected.counts.quantitySets)

      // The index also records IfcSpace, which is a spatial element and not an IfcElement,
      // so it is not in the ground truth's element counts.
      const { IfcSpace: _space, ...byType } = index.counts.byType
      expect(byType).toEqual(expected.counts.byType)
      expect(index.elements).toHaveLength(expected.counts.elements + expected.counts.spaces)
    })

    it('agrees on the storeys and their elevations in metres', async () => {
      await ready
      expect(index.storeys.map((s) => s.name)).toEqual(expected.storeys.map((s) => s.name))
      expect(index.storeys.map((s) => s.guid)).toEqual(expected.storeys.map((s) => s.guid))
      index.storeys.forEach((storey, i) => {
        expect(storey.elev, storey.name).toBeCloseTo(expected.storeys[i].elevation, 9)
      })
    })

    it('agrees on where each storey’s floor actually is', async () => {
      await ready
      // `Elevation` is stated relative to whatever the storey is placed in; the placement is
      // where the floor is in the file's own world. On a shared-coordinates export the two
      // differ by the site's own elevation, which is exactly how far the level rings were out.
      index.storeys.forEach((storey, i) => {
        const want = expected.storeys[i].placement
        if (!want) return
        expect(storey.placement, storey.name).toBeDefined()
        storey.placement!.forEach((v, k) => expect(v, storey.name).toBeCloseTo(want[k], 6))
      })
    })

    it('agrees on CompositionType for the site, the building and every storey', async () => {
      await ready
      // `''` in the ground truth means the file leaves the optional attribute unset, and the
      // index leaves the field absent rather than defaulting it to ELEMENT.
      const want = expected.composition
      if (want) {
        expect(index.site?.compositionType ?? '').toBe(want.IfcSite)
        expect(index.building?.compositionType ?? '').toBe(want.IfcBuilding)
      }
      if (expected.storeys.some((s) => s.compositionType !== undefined)) {
        expect(index.storeys.map((s) => s.compositionType ?? '')).toEqual(
          expected.storeys.map((s) => s.compositionType ?? '')
        )
      }
    })

    it('agrees on georeferencing, and names its source', async () => {
      await ready
      const want = expected.georeference
      expect(index.georef.source).toBe(want.source)
      expect([...index.georef.sources].sort()).toEqual([...(want.sources as string[])].sort())
      for (const key of [
        'eastings',
        'northings',
        'orthogonalHeight',
        'xAxisAbscissa',
        'xAxisOrdinate',
        'scale'
      ] as const) {
        if (want[key] == null) continue
        expect(index.georef[key], key).toBeCloseTo(want[key] as number, 9)
      }
      if (want.crs) expect(index.georef.crs).toEqual(want.crs)
      const site = want.site as Record<string, number | number[]> | undefined
      if (site) {
        if (site.latitude != null)
          expect(index.georef.site!.latitude!).toBeCloseTo(site.latitude as number, 9)
        if (site.longitude != null)
          expect(index.georef.site!.longitude!).toBeCloseTo(site.longitude as number, 9)
        if (site.elevation != null)
          expect(index.georef.site!.elevation!).toBeCloseTo(site.elevation as number, 9)
        if (site.placement) {
          const placement = site.placement as number[]
          index.georef.site!.placement!.forEach((v, i) => expect(v).toBeCloseTo(placement[i], 6))
        }
        // The spatial-root site, not the first by expressId — this file carries 16 of them.
        if (site.expressId != null) expect(index.georef.site!.expressId).toBe(site.expressId)
        // The rotation the site placement carries. Losing it left the model at 43° to its grid.
        if (site.rotationDeg != null) {
          expect(index.georef.site!.rotationDeg!).toBeCloseTo(site.rotationDeg as number, 9)
        } else {
          expect(index.georef.site!.rotationDeg ?? 0).toBe(0)
        }
      }
      const tn = want.trueNorth as number[] | undefined
      if (tn) {
        expect(index.georef.trueNorth).toBeDefined()
        index.georef.trueNorth!.forEach((v, i) => expect(v).toBeCloseTo(tn[i], 9))
      }
      // And what the app actually reads off all of that: which declaration is in force, and
      // the map coordinates of the project frame's origin.
      expect(index.georef.method).toBe(detectMethod(index.georef))
      const frame = projectFrame(index.georef)
      const base = coordsFromGeoref(index.georef)
      process.stderr.write(
        `[georef] ${basename(ifc)} · method ${index.georef.method} · ` +
          `frame ${frame ? `[${frame.origin.map((v) => v.toFixed(3)).join(', ')}] ${frame.rotationDeg.toFixed(4)}°` : 'identity'} · ` +
          `base point ${base ? `E ${base.E} N ${base.N} Z ${base.Z} angle ${base.angle}` : 'none'}\n`
      )
    })

    for (const [ifcClass, want] of Object.entries(expected.samples)) {
      it(`agrees on the first ${ifcClass}: identity, type, material, classification`, async () => {
        await ready
        const got = index.elements.find((e) => e.expressId === want.expressId)
        expect(got, `expressId ${want.expressId} missing from the index`).toBeDefined()
        expect(got!.guid).toBe(want.guid)
        expect(got!.guidValid).toBe(true)
        expect(got!.type).toBe(want.type)
        expect(got!.name).toBe(want.name)
        expect(got!.tag).toBe(want.tag)
        expect(got!.predefinedType).toBe(want.predefinedType)
        expect(got!.objectType).toBe(want.objectType)
        expect(got!.typeGuid).toBe(want.typeGuid)
        expect(got!.storey).toBe(want.storey)
        expect(got!.material).toBe(want.material)
        expect(got!.classifications).toEqual(want.classifications)
      })

      it(`agrees on the first ${ifcClass}'s property and quantity sets, as authored`, async () => {
        await ready
        const got = index.elements.find((e) => e.expressId === want.expressId)!
        expect(Object.keys(got.psets).sort()).toEqual(Object.keys(want.psets).sort())
        expect(Object.keys(got.qto).sort()).toEqual(Object.keys(want.qtos).sort())
        for (const [setName, properties] of Object.entries(want.psets)) {
          expect(got.psets[setName], setName).toEqual(properties)
        }
        for (const [setName, quantities] of Object.entries(want.qtos)) {
          expect(got.qto[setName], setName).toEqual(quantities)
        }
        // Every set names the line it came from, and says whether it was inherited.
        for (const setName of Object.keys(got.psets)) {
          expect(got.psetMeta[setName].sourceExpressId, setName).toBeGreaterThan(0)
        }
      })
    }
  })
}
