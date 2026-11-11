/**
 * IFC conformance: the index builder against IfcOpenShell.
 *
 * `scripts/expected-from-ifcopenshell.py` reads the same file with IfcOpenShell — the
 * reference implementation buildingSMART's own validation service uses — and writes
 * `tests/fixtures/<stem>.expected.json`. This test builds the index over the same file with
 * web-ifc under Node and compares. A divergence is a defect to fix or to document
 * (SYSTEM_SPEC §5), never to hide.
 *
 * Two kinds of model run here. **`tests/fixtures/reference.ifc`** — the synthetic reference
 * model `scripts/make-reference-ifc.py` writes, and its committed `reference.expected.json` —
 * runs everywhere, CI included, and a missing file fails the test (2026-11-07). A **real model**
 * in `samples/` runs only where one is present: `samples/` and its expected.json are git-ignored,
 * so without one that part reports itself as skipped rather than failing.
 *
 * **Every element's identity, against IfcOpenShell's raw readings (2026-11-11).** The truth is
 * one key per attribute, as IfcOpenShell reads it (`identity()` in the script); a rule of the
 * app — a fallback — is one named entry of `APP_RULES` below, never baked into the truth. The
 * truth once wrote "the type's Name, else the occurrence's ObjectType" as `objectType`, which is
 * the app's own rule, so the check agreed with the bug it was there to catch: about one element
 * in five on a Revit export showed the type's "Family:Type" name as its ObjectType. Every other
 * committed `.ifc` under `tests/fixtures/` is held to `tests/fixtures/identities.json` the same
 * way (`--identities`): one with no truth fails by name, a stale truth by its SHA-256.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { coordsFromGeoref, detectMethod, projectFrame } from '../../src/shared/georef'
import type { ModelIndex } from '../../src/shared/model-index.types'
import { createReadOnlyIfcSource } from '../../src/worker/ifc-source'
import { buildModelIndex } from '../../src/worker/index-builder'

const ROOT = join(__dirname, '..', '..')
const SAMPLES = join(ROOT, 'samples')
const FIXTURES = join(ROOT, 'tests', 'fixtures')

/**
 * IfcOpenShell's raw reading of one indexed element (`identity()` in
 * `scripts/expected-from-ifcopenshell.py`, 2026-11-11): one key per attribute.
 */
interface Identity {
  expressId: number
  guid: string
  type: string
  name: string
  longName: string
  description: string
  tag: string
  /** The occurrence's own `ObjectType` attribute, as written. */
  objectType: string
  /** `get_type(element).Name`. */
  typeName: string
  typeGuid: string
  /** The code as written (`predefined_code`), the app's documented reading of the raw codes. */
  predefinedType: string
  /** `ifcopenshell.util.element.get_predefined_type`. */
  effectivePredefinedType: string
}

/** The identity values compared for every element, value for value. */
const COMPARED = [
  'guid',
  'type',
  'name',
  'description',
  'tag',
  'objectType',
  'typeName',
  'typeGuid',
  'predefinedType',
  'effectivePredefinedType'
] as const
type Compared = (typeof COMPARED)[number]

/**
 * The app's rules over the raw readings — the only places the index may say something other than
 * IfcOpenShell's own attribute. Anything not here is plain equality.
 */
const APP_RULES: Partial<Record<Compared, (want: Identity) => string>> = {
  // `index-builder.ts`: `text(row.Name) || text(row.LongName)`. Recorded as it is, a fallback
  // awaiting the owner's word — not a reading IfcOpenShell makes.
  name: (want) => want.name || want.longName
}

/**
 * A difference from IfcOpenShell that is recorded and accepted: `{ file, expressId, field, why }`.
 * Empty, and asserted empty — a difference is a defect to fix, not a line to add here.
 */
const KNOWN_DIFFERENCES: readonly { file: string; expressId: number; field: Compared; why: string }[] = []

const REGENERATE =
  'its identities predate 2026-11-11 (no `typeName`): regenerate it with ' +
  '`python3 scripts/expected-from-ifcopenshell.py <model>` (or `--identities` for a fixture)'

/** Whether a truth carries the 2026-11-11 identity shape. */
const currentShape = (want: Partial<Identity>): boolean => COMPARED.every((k) => k in want) && 'longName' in want

/**
 * Every element of `wants` against the index, field by field. Returns one line per field that
 * differs — the count and the first few elements — so a real model's thousands stay readable.
 */
function identityDifferences(index: ModelIndex, wants: readonly Identity[], file: string): string[] {
  const byExpressId = new Map(index.elements.map((e) => [e.expressId, e]))
  const lines: string[] = []
  const missing = wants.filter((w) => !byExpressId.has(w.expressId)).map((w) => `#${w.expressId}`)
  if (missing.length) lines.push(`${missing.length} element(s) IfcOpenShell indexes are missing: ${missing.slice(0, 8).join(', ')}`)
  for (const field of COMPARED) {
    const rule = APP_RULES[field]
    const bad: string[] = []
    for (const want of wants) {
      const got = byExpressId.get(want.expressId) as unknown as Record<string, unknown> | undefined
      if (!got) continue
      const expected = rule ? rule(want) : want[field]
      if (got[field] === expected) continue
      if (KNOWN_DIFFERENCES.some((k) => k.file === file && k.expressId === want.expressId && k.field === field)) continue
      bad.push(`#${want.expressId} got ${JSON.stringify(got[field])} want ${JSON.stringify(expected)}`)
    }
    if (bad.length) lines.push(`${field}: ${bad.length} of ${wants.length} differ — ${bad.slice(0, 5).join('; ')}`)
  }
  return lines
}

interface ExpectedSample extends Identity {
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
  /**
   * Every indexed element's identity, by GlobalId (2026-11-07; raw, one key per attribute, since
   * 2026-11-11 — `Identity`). Absent from, or of the old shape in, a file written before that.
   */
  identities?: Record<string, Identity>
}

/** The synthetic reference model, committed with its ground truth: always run, never skipped. */
const REFERENCE = 'reference'

function load(stem: string): Expected {
  return JSON.parse(readFileSync(join(FIXTURES, `${stem}.expected.json`), 'utf8')) as Expected
}

/** Every other `<stem>.expected.json` whose `samples/<stem>.ifc` is actually present. */
function samples(): { ifc: string; expected: Expected }[] {
  if (!existsSync(FIXTURES) || !existsSync(SAMPLES)) return []
  return readdirSync(FIXTURES)
    .filter((name) => name.endsWith('.expected.json') && name !== `${REFERENCE}.expected.json`)
    .map((name) => {
      const stem = name.slice(0, -'.expected.json'.length)
      const expected = load(stem)
      return { ifc: join(SAMPLES, expected.file || `${stem}.ifc`), expected }
    })
    .filter(({ ifc }) => existsSync(ifc))
}

const FOUND = samples()

if (FOUND.length === 0) {
  // Written straight to stderr because vitest's default reporter swallows `console` output
  // from passing tests. `samples/` is git-ignored, so on another machine this notice is the
  // only sign that the conformance check did not actually run.
  process.stderr.write(
    '[fixture] skipped: no fixture — put a model in samples/ and run ' +
      'scripts/expected-from-ifcopenshell.py to write tests/fixtures/<stem>.expected.json. ' +
      'Both are git-ignored: the model is a real project file and the expected.json carries ' +
      'its metadata, so neither ships in the repository. The synthetic reference model still ran.\n'
  )
  describe('IFC conformance fixture — a real model', () => {
    it.skip('skipped: no fixture in samples/', () => {})
  })
}

const ALL = [
  { ifc: join(FIXTURES, `${REFERENCE}.ifc`), expected: load(REFERENCE) },
  ...FOUND
]

for (const { ifc, expected } of ALL) {
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

    // Every element, not the first of each class (2026-11-07): the first wall of the reference
    // model states its code outright, so a USERDEFINED wall whose ObjectType had replaced its
    // PredefinedType was never compared. Every identity value since 2026-11-11, raw on one side.
    it('agrees on every element\'s identity, value for value, with IfcOpenShell\'s raw reading', async () => {
      const wants = Object.values(expected.identities ?? {})
      expect(
        expected.identities !== undefined && wants.every(currentShape),
        `${expected.file || basename(ifc)}: ${REGENERATE}`
      ).toBe(true)
      await ready
      // By GlobalId on both sides, so a file that repeats one counts it once on both.
      const byGuid = new Map(index.elements.map((e) => [e.guid, e]))
      expect(byGuid.size).toBe(wants.length)
      const differences = identityDifferences(index, wants, basename(ifc))
      expect(differences, basename(ifc)).toEqual([])
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
        if (want.effectivePredefinedType !== undefined)
          expect(got!.effectivePredefinedType).toBe(want.effectivePredefinedType)
        expect(got!.objectType).toBe(want.objectType)
        expect((got as unknown as Record<string, unknown>).typeName).toBe(want.typeName)
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

/* ── every other committed fixture model, against identities.json (2026-11-11) ───────────── */

interface IdentityFile {
  generatedBy: string
  files: Record<string, { sha256: string; schema: string; elements: Record<string, Identity> }>
}

/** Every `.ifc` under `tests/fixtures/`, by its path relative to it, `/`-separated. */
function fixtureModels(dir: string = FIXTURES): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...fixtureModels(path))
    else if (entry.name.endsWith('.ifc')) out.push(relative(FIXTURES, path).split(sep).join('/'))
  }
  return out.sort()
}

const IDENTITIES_PATH = join(FIXTURES, 'identities.json')
const IDENTITIES: IdentityFile = existsSync(IDENTITIES_PATH)
  ? (JSON.parse(readFileSync(IDENTITIES_PATH, 'utf8')) as IdentityFile)
  : { generatedBy: '(missing)', files: {} }
/** A model with an expected.json of its own beside it is checked against that, above. */
const hasOwnTruth = (rel: string): boolean => existsSync(join(FIXTURES, rel.replace(/\.ifc$/, '.expected.json')))

describe(`IFC conformance — every committed fixture model vs ${IDENTITIES.generatedBy}`, () => {
  const models = fixtureModels()

  it('records no accepted difference', () => {
    expect(KNOWN_DIFFERENCES).toEqual([])
  })

  it('has a truth for every fixture model, and none for a model that is gone', () => {
    const want = models.filter((m) => !hasOwnTruth(m))
    const without = want.filter((m) => !(m in IDENTITIES.files))
    expect(without, 'no truth — run `python3 scripts/expected-from-ifcopenshell.py --identities`').toEqual([])
    const gone = Object.keys(IDENTITIES.files).filter((m) => !want.includes(m))
    expect(gone, 'a truth for a model that is not a fixture any more — regenerate identities.json').toEqual([])
  })

  for (const rel of models.filter((m) => !hasOwnTruth(m))) {
    it(`${rel}: every element's identity agrees with IfcOpenShell's raw reading`, async () => {
      const truth = IDENTITIES.files[rel]
      expect(truth, `${rel}: no truth — run \`python3 scripts/expected-from-ifcopenshell.py --identities\``).toBeDefined()
      const wants = Object.values(truth.elements)
      expect(wants.every(currentShape), `${rel}: ${REGENERATE}`).toBe(true)
      const bytes = readFileSync(join(FIXTURES, rel))
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      expect(sha256, `${rel}: identities.json is stale — the file changed; regenerate it with --identities`).toBe(
        truth.sha256
      )
      const src = await createReadOnlyIfcSource()
      const modelID = src.openFromBuffer(new Uint8Array(bytes))
      const index = buildModelIndex(src, modelID, { modelKey: 'FIXTURE', fileName: basename(rel), sha256 })
      src.close(modelID)
      src.dispose()
      expect(index.schema).toBe(truth.schema)
      // The same elements on both sides, by expressId.
      expect(index.elements.map((e) => e.expressId).sort((a, b) => a - b)).toEqual(
        wants.map((w) => w.expressId).sort((a, b) => a - b)
      )
      for (const [key, want] of Object.entries(truth.elements)) expect(String(want.expressId), rel).toBe(key)
      expect(identityDifferences(index, wants, rel), rel).toEqual([])
    })
  }
})
