/**
 * 2026-11-23 — the Spatial-structure card's data, end to end from the file: every attribute and
 * property set of `IfcProject`, the spatial-root `IfcSite` and its `IfcBuilding` that the card
 * compares, against IfcOpenShell's raw reading.
 *
 * `scripts/make-container-fixtures.py` writes two files — `full-ifc4.ifc`, every attribute
 * authored, in millimetres, and `sparse-ifc2x3.ifc`, most of them absent — and
 * `tests/fixtures/containers/ifcopenshell.json` is IfcOpenShell 0.8.4's reading of them
 * (`expected-from-ifcopenshell.py --containers`), raw attributes only. Each file goes through
 * web-ifc under Node and `buildModelIndex`, and the meta must carry every value as written: a
 * text unset is `''`, a number unset absent, a length in the file's own unit (not converted), a
 * compound angle as its list, and an address as its authored parts on one line.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { ModelIndex } from '../../src/shared/model-index.types'
import { createReadOnlyIfcSource } from '../../src/worker/ifc-source'
import { buildModelIndex } from '../../src/worker/index-builder'

const DIR = join(__dirname, '..', 'fixtures', 'containers')

type Raw = string | number | boolean | null | readonly Raw[]
interface Entity {
  attributes: Record<string, Raw>
  psets: Record<string, Record<string, Raw>>
}
interface Truth {
  generatedBy: string
  files: Record<
    string,
    {
      sha256: string
      schema: string
      lengthUnitMetres: number
      project: Entity
      site: Entity & { SiteAddress: [string, Raw][] | null }
      building: Entity & { BuildingAddress: [string, Raw][] | null }
    }
  >
}
const truth = JSON.parse(readFileSync(join(DIR, 'ifcopenshell.json'), 'utf8')) as Truth

const FILES = ['full-ifc4.ifc', 'sparse-ifc2x3.ifc']

/** A text attribute as the meta holds it: `''` when the file leaves it unset. */
const txt = (v: Raw | undefined): string => (v == null ? '' : String(v))
/** A number or a list as the meta holds it: absent when unset. */
const opt = (v: Raw | undefined): Raw | undefined => (v == null ? undefined : v)
/** The address rule, from the raw pairs: every authored part, in schema order, `, `-joined. */
const line = (pairs: [string, Raw][] | null): string =>
  (pairs ?? [])
    .map(([, v]) => v)
    .filter((v) => v != null && !(Array.isArray(v) && v.length === 0))
    .map((v) => (Array.isArray(v) ? v.join(', ') : String(v)))
    .join(', ')

describe(`the spatial containers vs ${truth.generatedBy}`, () => {
  it('covers both fixtures, and the truth is of these bytes', () => {
    expect(Object.keys(truth.files).sort()).toEqual([...FILES].sort())
    for (const f of FILES) {
      const sha = createHash('sha256').update(readFileSync(join(DIR, f))).digest('hex')
      expect(sha, `${f}: ifcopenshell.json is stale — regenerate it with --containers`).toBe(truth.files[f].sha256)
    }
  })

  for (const file of FILES) {
    const want = truth.files[file]
    describe(`${file} (${want.schema})`, () => {
      let index: ModelIndex
      beforeAll(async () => {
        const src = await createReadOnlyIfcSource()
        const id = src.openFromBuffer(new Uint8Array(readFileSync(join(DIR, file))))
        index = buildModelIndex(src, id, { modelKey: 'C', fileName: file, sha256: '' })
        src.close(id)
        src.dispose()
      })

      it('reads the schema and the length unit the truth names', () => {
        expect(index.schema).toBe(want.schema)
        expect(index.units.length).toBeCloseTo(want.lengthUnitMetres, 12)
      })

      it('IfcProject: Name, LongName, Description, ObjectType, Phase, GlobalId and its property sets', () => {
        const a = want.project.attributes
        expect({
          name: index.project?.name,
          longName: index.project?.longName,
          description: index.project?.description,
          objectType: index.containers?.project?.objectType,
          phase: index.project?.phase,
          guid: index.project?.guid
        }).toEqual({
          name: txt(a.Name),
          longName: txt(a.LongName),
          description: txt(a.Description),
          objectType: txt(a.ObjectType),
          phase: txt(a.Phase),
          guid: txt(a.GlobalId)
        })
        expect(index.containers?.project?.psets).toEqual(want.project.psets)
      })

      it('IfcSite: every attribute the card shows, its address on one line, and its property sets', () => {
        const a = want.site.attributes
        const c = index.containers?.site
        expect({
          name: index.site?.name,
          longName: index.site?.longName,
          description: c?.description,
          objectType: c?.objectType,
          compositionType: index.site?.compositionType ?? '',
          guid: index.site?.guid,
          refLatitude: c?.refLatitude,
          refLongitude: c?.refLongitude,
          refElevation: c?.refElevation,
          landTitleNumber: c?.landTitleNumber,
          address: c?.address
        }).toEqual({
          name: txt(a.Name),
          longName: txt(a.LongName),
          description: txt(a.Description),
          objectType: txt(a.ObjectType),
          compositionType: txt(a.CompositionType),
          guid: txt(a.GlobalId),
          refLatitude: opt(a.RefLatitude),
          refLongitude: opt(a.RefLongitude),
          refElevation: opt(a.RefElevation),
          landTitleNumber: txt(a.LandTitleNumber),
          address: line(want.site.SiteAddress)
        })
        expect(c?.psets).toEqual(want.site.psets)
      })

      it('IfcBuilding: every attribute the card shows, its address on one line, and its property sets', () => {
        const a = want.building.attributes
        const c = index.containers?.building
        expect({
          name: index.building?.name,
          longName: index.building?.longName,
          description: c?.description,
          objectType: c?.objectType,
          compositionType: index.building?.compositionType ?? '',
          guid: index.building?.guid,
          elevationOfRefHeight: c?.elevationOfRefHeight,
          elevationOfTerrain: c?.elevationOfTerrain,
          address: c?.address
        }).toEqual({
          name: txt(a.Name),
          longName: txt(a.LongName),
          description: txt(a.Description),
          objectType: txt(a.ObjectType),
          compositionType: txt(a.CompositionType),
          guid: txt(a.GlobalId),
          elevationOfRefHeight: opt(a.ElevationOfRefHeight),
          elevationOfTerrain: opt(a.ElevationOfTerrain),
          address: line(want.building.BuildingAddress)
        })
        expect(c?.psets).toEqual(want.building.psets)
      })
    })
  }

  it('the fixtures cover what they say: one with every value, one with most absent', () => {
    const full = truth.files['full-ifc4.ifc']
    const sparse = truth.files['sparse-ifc2x3.ifc']
    for (const e of [full.project, full.site, full.building]) {
      expect(Object.values(e.attributes).every((v) => v != null)).toBe(true)
      expect(Object.keys(e.psets).length).toBeGreaterThan(0)
    }
    expect(full.site.SiteAddress!.every(([, v]) => v != null)).toBe(true)
    const absent = [sparse.project, sparse.site, sparse.building].flatMap((e) => Object.values(e.attributes)).filter((v) => v == null)
    expect(absent.length).toBeGreaterThan(10)
    // An authored zero is a value, not an absence.
    expect(sparse.building.attributes.ElevationOfRefHeight).toBe(0)
  })
})
