/**
 * 2026-11-23 — the Spatial-structure card compares the models (`docs/DEVIATIONS.md`, the owner's
 * approved prototype `prototype/project-card/`): a column per model, every IfcProject / IfcSite /
 * IfcBuilding attribute and property set, each cell from that model's own file, matching rows
 * printed once, differing rows marked.
 *
 * `spatialTable` (`state/selectors/spatial.ts`) is the whole of it as a pure function; the card
 * draws what it returns. The difference rule is the prototype's (HANDOFF.md "Difference rule"):
 * identity rows (the three GlobalIds, File, Elements) never count; the em dash is a value; the
 * cells tinted are those off the most common value, the leftmost winning a tie; a row equal across
 * every model is one merged cell; with one model nothing is marked or merged.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { DASH, fmtV, group } from '../../src/shared/fmt'
import { federate } from '../../src/shared/federate'
import type { ModelIndex, Storey } from '../../src/shared/model-index.types'
import { formatLength } from '../../src/shared/units'
import { mockModelIndex, SAMPLE_FILES } from '../../src/renderer/dev/mock-adapter'
import {
  dms,
  spatialTable,
  unitsLine,
  type SpatialGroup,
  type SpatialRow,
  type SpatialSet,
  type SpatialTable
} from '../../src/renderer/state/selectors/spatial'
import { rowSwatch } from '../../src/renderer/state/selectors/models'
import { createReadOnlyIfcSource } from '../../src/worker/ifc-source'
import { buildModelIndex } from '../../src/worker/index-builder'

const FIXTURES = join(__dirname, '..', 'fixtures')

/** The design's own library entries, as the landing page's demo has them: the labels the MODELS rows show. */
const LIBRARY = SAMPLE_FILES.map((f) => ({ key: f.key, name: f.name, file: f.file, swatch: f.swatch }))

const table = (models: ModelIndex[], extra: Partial<Parameters<typeof spatialTable>[0]> = {}): SpatialTable =>
  spatialTable({ federation: federate(models), library: LIBRARY, uploadNames: {}, ...extra })!

const groupOf = (t: SpatialTable, type: SpatialGroup['type']): SpatialGroup => t.groups.find((g) => g.type === type)!
const rowsOf = (g: SpatialGroup): SpatialRow[] => g.lines.filter((l): l is SpatialRow => l.kind === 'row')
const row = (t: SpatialTable, type: SpatialGroup['type'], k: string): SpatialRow => {
  const r = rowsOf(groupOf(t, type)).find((x) => x.k === k)
  expect(r, `${type}.${k}`).toBeDefined()
  return r!
}
const setOf = (t: SpatialTable, type: SpatialGroup['type'], name: string): SpatialSet =>
  groupOf(t, type).lines.find((l): l is SpatialSet => l.kind === 'set' && l.name === name)!

/** A mock model with its own project, site and building texts, on one shared storey ladder. */
const LADDER = mockModelIndex('ARC').storeys
function model(key: string, o: { project?: string; longName?: string; phase?: string; site?: string; building?: string } = {}): ModelIndex {
  const m = mockModelIndex(key)
  return {
    ...m,
    project: { ...m.project!, guid: `${key}-project-guid`, name: o.project ?? 'Sample Tower', longName: o.longName ?? '', phase: o.phase ?? '' },
    site: { ...m.site!, guid: `${key}-site-guid`, name: o.site ?? 'Site Plot A' },
    building: { ...m.building!, guid: `${key}-building-guid`, name: o.building ?? 'Tower C' },
    storeys: LADDER
  }
}

describe('the groups and their rows, in order', () => {
  const t = table([model('ARC')])

  it('IfcProject, IfcSite, IfcBuilding, File', () => {
    expect(t.groups.map((g) => g.type)).toEqual(['IfcProject', 'IfcSite', 'IfcBuilding', 'File'])
  })

  it('every attribute row, in the approved order', () => {
    expect(rowsOf(groupOf(t, 'IfcProject')).map((r) => r.k)).toEqual(['Name', 'LongName', 'Description', 'ObjectType', 'Phase', 'GlobalId'])
    expect(rowsOf(groupOf(t, 'IfcSite')).map((r) => r.k)).toEqual([
      'Name',
      'LongName',
      'Description',
      'ObjectType',
      'CompositionType',
      'GlobalId',
      'RefLatitude',
      'RefLongitude',
      'RefElevation',
      'LandTitleNumber',
      'SiteAddress',
      'Easting / Northing',
      'True north'
    ])
    expect(rowsOf(groupOf(t, 'IfcBuilding')).map((r) => r.k)).toEqual([
      'Name',
      'LongName',
      'Description',
      'ObjectType',
      'CompositionType',
      'GlobalId',
      'ElevationOfRefHeight',
      'ElevationOfTerrain',
      'BuildingAddress',
      'Storeys',
      'Height to top'
    ])
    expect(rowsOf(groupOf(t, 'File')).map((r) => r.k)).toEqual(['File', 'Schema', 'Units', 'Elements'])
  })

  it('the property sets follow each entity’s attributes', () => {
    const arc = model('ARC')
    const withSets = table([
      { ...arc, containers: { project: { objectType: '', psets: { Zeta: { A: 1 }, Alpha: { B: 'x' } } } } }
    ])
    const lines = groupOf(withSets, 'IfcProject').lines
    expect(lines.map((l) => (l.kind === 'set' ? `set:${l.name}` : l.k))).toEqual([
      'Name', 'LongName', 'Description', 'ObjectType', 'Phase', 'GlobalId', 'set:Alpha', 'B', 'set:Zeta', 'A'
    ])
  })
})

describe('one cell per model, each from that model’s own file', () => {
  const t = table([
    model('ARC', { project: 'Sample Tower', site: 'Site Plot A', building: 'Tower C' }),
    model('STR', { project: 'Sample Tower Structure', site: 'Site Plot A', building: 'Tower C' }),
    model('MEP', { project: 'Sample Tower', site: 'Default Site', building: '' })
  ])

  it('the columns are the federation’s models, in its order', () => {
    expect(t.columns.map((c) => c.key)).toEqual(['ARC', 'STR', 'MEP'])
    expect(t.columns.map((c) => c.label)).toEqual(['Architecture', 'Structure', 'Mechanical'])
  })

  it('Name is each file’s own IfcProject / IfcSite / IfcBuilding Name, never a fallback', () => {
    expect(row(t, 'IfcProject', 'Name').cells).toEqual(['Sample Tower', 'Sample Tower Structure', 'Sample Tower'])
    expect(row(t, 'IfcSite', 'Name').cells).toEqual(['Site Plot A', 'Site Plot A', 'Default Site'])
    // No building name: the dash, not the project's name.
    expect(row(t, 'IfcBuilding', 'Name').cells).toEqual(['Tower C', 'Tower C', DASH])
  })

  it('GlobalIds are each file’s', () => {
    expect(row(t, 'IfcSite', 'GlobalId').cells).toEqual(['ARC-site-guid', 'STR-site-guid', 'MEP-site-guid'])
  })

  it('Storeys and Height to top are each model’s own storeys', () => {
    const storeys = (names: [string, number][]): Storey[] => names.map(([name, elev]) => ({ expressId: 0, guid: '', name, elev }))
    const a = { ...model('ARC'), storeys: storeys([['L1', 0], ['ROOF', 52.2]]) }
    const b = { ...model('STR'), storeys: storeys([['L1', 0], ['L2', 4], ['PLINTH', 54.6]]) }
    const two = table([a, b])
    expect(row(two, 'IfcBuilding', 'Storeys').cells).toEqual(['2 IfcBuildingStorey', '3 IfcBuildingStorey'])
    expect(row(two, 'IfcBuilding', 'Height to top').cells).toEqual(['52.200 m (ROOF)', '54.600 m (PLINTH)'])
    expect(row(table([a, b], { units: 'ft' }), 'IfcBuilding', 'Height to top').cells).toEqual([
      `${formatLength(52.2, 'ft')} (ROOF)`,
      `${formatLength(54.6, 'ft')} (PLINTH)`
    ])
  })

  it('File, Schema, Units and Elements are each file’s', () => {
    const fed = federate([model('ARC'), model('STR')])
    const two = spatialTable({ federation: fed, library: [], uploadNames: { STR: 'Struct v2.ifc' } })!
    expect(row(two, 'File', 'File').cells).toEqual(['SB_ARC_R25.ifc', 'Struct v2.ifc'])
    expect(row(two, 'File', 'Schema').cells).toEqual(fed.models.map((m) => m.meta.schema))
    expect(row(two, 'File', 'Units').cells).toEqual(fed.models.map((m) => unitsLine(m.meta.units)))
    expect(row(two, 'File', 'Elements').cells).toEqual(
      fed.models.map((m) => group(fed.elements.filter((e) => e.model === m.meta.modelKey).length))
    )
  })

  it('a column is headed by its MODELS row’s swatch and label, the file its title', () => {
    const library = [{ key: 'ARC', name: 'Architecture', file: 'SB_ARC_R25.ifc', swatch: '#D8D2C6' }]
    const fed = federate([model('ARC'), model('STR')])
    const two = spatialTable({ federation: fed, library, uploadNames: {}, modelColors: { STR: '#E05A6B' } })!
    expect(two.columns.map((c) => c.swatch)).toEqual(fed.models.map((m) => rowSwatch(m.meta.modelKey, m.slot, library, { STR: '#E05A6B' })))
    expect(two.columns[1].swatch).toBe('#E05A6B')
    expect(two.columns.map((c) => c.file)).toEqual(['SB_ARC_R25.ifc', 'SB_STR_R25.ifc'])
  })
})

describe('the difference rule', () => {
  const t = table([
    model('ARC', { phase: 'Construction Documents', longName: 'Long' }),
    model('STR', { phase: 'Construction Documents', longName: '' }),
    model('MEP', { phase: 'Design Development', longName: 'Long' })
  ])

  it('a row equal across every model is one merged cell, not marked', () => {
    const r = row(t, 'IfcProject', 'Name')
    expect(r).toMatchObject({ diff: false, merged: true, off: [false, false, false] })
  })

  it('a differing row stays split; the cells off the most common value are tinted', () => {
    expect(row(t, 'IfcProject', 'Phase')).toMatchObject({ diff: true, merged: false, off: [false, false, true] })
  })

  it('the em dash is a value: a model that lacks one the others carry differs', () => {
    const r = row(t, 'IfcProject', 'LongName')
    expect(r.cells).toEqual(['Long', DASH, 'Long'])
    expect(r).toMatchObject({ diff: true, merged: false, off: [false, true, false] })
  })

  it('every model without a value: one merged dash', () => {
    const r = row(t, 'IfcProject', 'ObjectType')
    expect(r).toMatchObject({ cells: [DASH, DASH, DASH], diff: false, merged: true })
  })

  it('a tie goes to the leftmost value', () => {
    const two = table([model('ARC', { phase: 'A' }), model('STR', { phase: 'B' })])
    expect(row(two, 'IfcProject', 'Phase')).toMatchObject({ diff: true, off: [false, true] })
  })

  it('identity rows never count, never merge and are never tinted', () => {
    for (const [type, k] of [
      ['IfcProject', 'GlobalId'],
      ['IfcSite', 'GlobalId'],
      ['IfcBuilding', 'GlobalId'],
      ['File', 'File'],
      ['File', 'Elements']
    ] as const) {
      const r = row(t, type, k)
      expect(r, `${type}.${k}`).toMatchObject({ ident: true, diff: false, merged: false, off: [false, false, false] })
    }
    expect(row(t, 'IfcProject', 'GlobalId').gid).toBe(true)
    expect(row(t, 'File', 'File').gid).toBe(false)
    // Schema and Units are not identity rows: they count.
    expect(row(t, 'File', 'Schema').ident).toBe(false)
    expect(row(t, 'File', 'Units').ident).toBe(false)
  })

  it('counts the differing rows, and marks a group that has one', () => {
    const marked = t.groups.flatMap((g) => rowsOf(g)).filter((r) => r.diff)
    expect(t.diffs).toBe(marked.length)
    expect(marked.map((r) => r.k)).toEqual(['LongName', 'Phase'])
    expect(t.groups.map((g) => g.diff)).toEqual([true, false, false, false])
  })
})

describe('property sets: the union across the models', () => {
  const arc = model('ARC')
  const str = model('STR')
  const mep = model('MEP')
  const t = table([
    { ...arc, containers: { site: { objectType: '', description: '', landTitleNumber: '', address: '', psets: { Pset_SiteCommon: { TotalArea: 8420, BuildableArea: 6100 }, SGPset_Site: { CXBlockID: '1' } } } } },
    { ...str, containers: { site: { objectType: '', description: '', landTitleNumber: '', address: '', psets: { Pset_SiteCommon: { TotalArea: 8420, SiteCoverageRatio: 0.38 } } } } },
    { ...mep, containers: { site: { objectType: '', description: '', landTitleNumber: '', address: '', psets: { SGPset_Site: { CXBlockID: '1' } } } } }
  ])

  it('set names sorted; each heading says which models carry it', () => {
    const sets = groupOf(t, 'IfcSite').lines.filter((l): l is SpatialSet => l.kind === 'set')
    expect(sets.map((s) => s.name)).toEqual(['Pset_SiteCommon', 'SGPset_Site'])
    expect(setOf(t, 'IfcSite', 'Pset_SiteCommon').has).toEqual([true, true, false])
    expect(setOf(t, 'IfcSite', 'SGPset_Site').has).toEqual([true, false, true])
  })

  it('properties are the union in first-seen order; a model without one shows the dash', () => {
    const lines = groupOf(t, 'IfcSite').lines
    const at = lines.findIndex((l) => l.kind === 'set' && l.name === 'Pset_SiteCommon')
    const props = lines.slice(at + 1, at + 4) as SpatialRow[]
    expect(props.map((p) => p.k)).toEqual(['TotalArea', 'BuildableArea', 'SiteCoverageRatio'])
    expect(props[0].cells).toEqual([fmtV(8420), fmtV(8420), DASH])
    expect(props[1].cells).toEqual([fmtV(6100), DASH, DASH])
    expect(props[2].cells).toEqual([DASH, fmtV(0.38), DASH])
  })

  it('a set heading is marked when one of its rows differs', () => {
    expect(setOf(t, 'IfcSite', 'Pset_SiteCommon').diff).toBe(true)
    // CXBlockID: '1', —, '1' — differs too, through the model that lacks the set.
    expect(setOf(t, 'IfcSite', 'SGPset_Site').diff).toBe(true)
    const same = table([
      { ...arc, containers: { project: { objectType: '', psets: { P: { A: true } } } } },
      { ...str, containers: { project: { objectType: '', psets: { P: { A: true } } } } }
    ])
    expect(setOf(same, 'IfcProject', 'P')).toMatchObject({ has: [true, true], diff: false })
    expect(row(same, 'IfcProject', 'A')).toMatchObject({ cells: ['True', 'True'], merged: true })
  })

  it('a set or key named like an Object member is read as the file’s own, never inherited', () => {
    // `constructor` on model A only: B and C carry no such set, and must not read
    // `Object.prototype.constructor` (or its `name` / `length`) as one.
    const t3 = table([
      { ...arc, containers: { project: { objectType: '', psets: { constructor: { name: 'A', length: 1, other: 'x' } } } } },
      { ...str, containers: { project: { objectType: '', psets: { P: { toString: 'y' } } } } },
      mep
    ])
    expect(setOf(t3, 'IfcProject', 'constructor').has).toEqual([true, false, false])
    const lines = groupOf(t3, 'IfcProject').lines
    const at = lines.findIndex((l) => l.kind === 'set' && l.name === 'constructor')
    expect((lines.slice(at + 1, at + 4) as SpatialRow[]).map((r) => [r.k, r.cells])).toEqual([
      ['name', ['A', DASH, DASH]],
      ['length', [fmtV(1), DASH, DASH]],
      ['other', ['x', DASH, DASH]]
    ])
    // A key named like an Object member, in a set the others lack.
    expect(row(t3, 'IfcProject', 'toString').cells).toEqual([DASH, 'y', DASH])
  })

  it('values go through the property card’s own formatter', () => {
    const one = table([{ ...arc, containers: { project: { objectType: '', psets: { P: { n: 1250000.5, b: false, s: 'P-0001', l: ['a', 'b'] } } } } }])
    expect(rowsOf(groupOf(one, 'IfcProject')).slice(-4).map((r) => r.cells[0])).toEqual([
      fmtV(1250000.5),
      'False',
      'P-0001',
      fmtV(['a', 'b'])
    ])
  })
})

describe('one model', () => {
  const t = table([model('ARC', { phase: 'A' })])

  it('nothing is marked, merged or counted; one column', () => {
    expect(t.columns).toHaveLength(1)
    expect(t.diffs).toBe(0)
    for (const r of t.groups.flatMap(rowsOf)) expect(r, r.k).toMatchObject({ diff: false, merged: false, off: [false] })
  })

  it('each heading names what today’s card names: the model, the site, the building, the file', () => {
    expect(t.groups.map((g) => g.name)).toEqual(['Architecture', 'Site Plot A', 'Tower C', 'SB_ARC_R25.ifc'])
    const none = table([{ ...model('ARC'), site: { ...model('ARC').site!, name: '' } }])
    expect(groupOf(none, 'IfcSite').name).toBe(DASH)
  })

  it('no models: no table', () => {
    expect(spatialTable({ federation: federate([]), library: [], uploadNames: {} })).toBeNull()
  })
})

describe('dms', () => {
  it('millionths that round up to a whole second carry into the seconds, and on up', () => {
    expect(dms([1, 2, 3, 999999.6], 'N', 'S')).toBe('1° 2′ 4.000000″ N')
    expect(dms([1, 59, 59, 999999.7], 'N', 'S')).toBe('2° 0′ 0.000000″ N')
    expect(dms([-1, -2, -3, -999999.6], 'E', 'W')).toBe('1° 2′ 4.000000″ W')
    expect(dms([1, 2, 3, 4.4], 'N', 'S')).toBe('1° 2′ 3.000004″ N')
  })
})

/* ─────────────── from the fixtures: each attribute as the file states it ─────────────── */

const open = async (files: string[]): Promise<ModelIndex[]> => {
  const src = await createReadOnlyIfcSource()
  const out = files.map((f, i) => {
    const id = src.openFromBuffer(new Uint8Array(readFileSync(join(FIXTURES, f))))
    const index = buildModelIndex(src, id, { modelKey: `M${i}`, fileName: f.split('/').pop()!, sha256: '' })
    src.close(id)
    return index
  })
  src.dispose()
  return out
}

describe('the fixtures, through the table', () => {
  let full: ModelIndex
  let sparse: ModelIndex
  beforeAll(async () => {
    ;[full, sparse] = await open(['containers/full-ifc4.ifc', 'containers/sparse-ifc2x3.ifc'])
  })

  it('the full file: every attribute printed, lengths in the display unit, angles as DMS', () => {
    const t = table([full])
    const v = (type: SpatialGroup['type'], k: string): string => row(t, type, k).cells[0]
    expect(v('IfcProject', 'Name')).toBe('Synthetic Project')
    expect(v('IfcProject', 'LongName')).toBe('Synthetic Project — Long Name')
    expect(v('IfcProject', 'ObjectType')).toBe('SYNTHETIC_PROJECT_TYPE')
    expect(v('IfcProject', 'Phase')).toBe('Construction Documents')
    expect(v('IfcSite', 'RefLatitude')).toBe('12° 34′ 56.789000″ N')
    expect(v('IfcSite', 'RefLongitude')).toBe('98° 7′ 6.543210″ E')
    // 4700 in millimetres: the attribute, not the site placement's Z of 5 050 (the base point).
    expect(v('IfcSite', 'RefElevation')).toBe('4.700 m')
    expect(row(table([full], { units: 'ft' }), 'IfcSite', 'RefElevation').cells[0]).toBe('15.420 ft')
    expect(v('IfcSite', 'LandTitleNumber')).toBe('LOT-0001-A')
    expect(v('IfcSite', 'SiteAddress')).toBe(
      'SITE, Main gate, Deliveries, Gate 2, 1 Example Avenue, Block C, PO 12, Example Town, Example Region, 000001, Example Country'
    )
    expect(v('IfcBuilding', 'ElevationOfRefHeight')).toBe('5.050 m')
    expect(v('IfcBuilding', 'ElevationOfTerrain')).toBe('4.800 m')
    expect(v('IfcBuilding', 'BuildingAddress')).toBe('1 Example Avenue, 000001, Example Country')
    expect(v('IfcBuilding', 'Storeys')).toBe('2 IfcBuildingStorey')
    expect(v('IfcBuilding', 'Height to top')).toBe('4.000 m (Level 2)')
    expect(groupOf(t, 'IfcBuilding').lines.filter((l) => l.kind === 'set').map((l) => (l as SpatialSet).name)).toEqual([
      'Pset_BuildingCommon',
      'SGPset_Building'
    ])
  })

  it('the sparse file: the dash for what it leaves out, an authored zero and a metre length printed, S and W', () => {
    const t = table([sparse])
    const v = (type: SpatialGroup['type'], k: string): string => row(t, type, k).cells[0]
    for (const k of ['LongName', 'Description', 'ObjectType', 'Phase']) expect(v('IfcProject', k), k).toBe(DASH)
    expect(v('IfcSite', 'RefLatitude')).toBe('12° 34′ 56″ S')
    expect(v('IfcSite', 'RefLongitude')).toBe('98° 7′ 6″ W')
    expect(v('IfcSite', 'RefElevation')).toBe(DASH)
    expect(v('IfcSite', 'SiteAddress')).toBe(DASH)
    expect(v('IfcBuilding', 'Name')).toBe(DASH)
    expect(v('IfcBuilding', 'ElevationOfRefHeight')).toBe('0.000 m')
    // 2.5 in metres: the conversion pinned for a metre file too.
    expect(v('IfcBuilding', 'ElevationOfTerrain')).toBe('2.500 m')
    expect(row(table([sparse], { units: 'ft' }), 'IfcBuilding', 'ElevationOfTerrain').cells[0]).toBe('8.202 ft')
    expect(groupOf(t, 'IfcProject').lines.some((l) => l.kind === 'set')).toBe(false)
  })

  it('the two side by side: the counts, the merged rows and the union of sets', () => {
    const t = table([full, sparse])
    expect(row(t, 'IfcProject', 'Name')).toMatchObject({ merged: true, cells: ['Synthetic Project', 'Synthetic Project'] })
    expect(row(t, 'File', 'Schema')).toMatchObject({ diff: true, cells: ['IFC4', 'IFC2X3'] })
    expect(setOf(t, 'IfcProject', 'Project_Information').has).toEqual([true, false])
    expect(setOf(t, 'IfcSite', 'Pset_SiteCommon').has).toEqual([true, true])
    expect(t.diffs).toBe(t.groups.flatMap(rowsOf).filter((r) => r.diff).length)
  })
})

/**
 * For one model, Easting / Northing and True north print exactly what the old card printed for
 * the same file: the strings below were captured from the selector as it stood before 2026-11-23
 * (`spatialCards`, fed the store's `coords` and `crsChip(georefSource).short` as `ProjectCard`
 * fed it), one per fixture and display unit.
 */
describe('Easting / Northing and True north: what the old card printed, for one model', () => {
  const OLD: Record<string, [string, string, string, string]> = {
    'georef/a-site-placement.ifc': [
      '12,345.457 E · 23,456.766 N (SVY21)',
      '40,503.468 E · 76,957.894 N (SVY21)',
      '-43.41° clockwise from project north',
      '-43.41° clockwise from project north'
    ],
    'georef/b-map-conversion.ifc': [
      '12,345.457 E · 23,456.766 N (SVY21)',
      '40,503.468 E · 76,957.894 N (SVY21)',
      '-43.41° clockwise from project north',
      '-43.41° clockwise from project north'
    ],
    'georef/e-map-unit-foot.ifc': [
      '12,345.457 E · 23,456.766 N (SVY21)',
      '40,503.468 E · 76,957.894 N (SVY21)',
      '-43.41° clockwise from project north',
      '-43.41° clockwise from project north'
    ],
    'georef/i-wcs-base-point.ifc': [
      '12,345.457 E · 23,456.766 N',
      '40,503.468 E · 76,957.894 N',
      '-43.41° clockwise from project north',
      '-43.41° clockwise from project north'
    ],
    'georef/j-ifc2x3-wcs.ifc': [
      '12,345.457 E · 23,456.766 N',
      '40,503.468 E · 76,957.894 N',
      '-43.41° clockwise from project north',
      '-43.41° clockwise from project north'
    ],
    'containers/full-ifc4.ifc': [
      '12,345.457 E · 23,456.766 N',
      '40,503.468 E · 76,957.894 N',
      '-43.41° clockwise from project north',
      '-43.41° clockwise from project north'
    ],
    'containers/sparse-ifc2x3.ifc': [DASH, DASH, DASH, DASH],
    'tiny.ifc': [DASH, DASH, DASH, DASH],
    'feet.ifc': [
      '12,345.457 E · 23,456.766 N (Synthetic test CRS)',
      '40,503.468 E · 76,957.894 N (Synthetic test CRS)',
      '-43.41° clockwise from project north',
      '-43.41° clockwise from project north'
    ]
  }
  const files = Object.keys(OLD)
  let indexes: ModelIndex[] = []
  beforeAll(async () => {
    indexes = await open(files)
  })

  it('every fixture, in mm and in ft', () => {
    files.forEach((f, i) => {
      const mm = table([indexes[i]])
      const ft = table([indexes[i]], { units: 'ft' })
      expect(
        [
          row(mm, 'IfcSite', 'Easting / Northing').cells[0],
          row(ft, 'IfcSite', 'Easting / Northing').cells[0],
          row(mm, 'IfcSite', 'True north').cells[0],
          row(ft, 'IfcSite', 'True north').cells[0]
        ],
        f
      ).toEqual(OLD[f])
    })
  })

  it('a site placed by its placement but with no RefElevation prints the dash, not the placement’s Z', () => {
    const a = indexes[files.indexOf('georef/a-site-placement.ifc')]
    expect(a.containers?.site?.refElevation).toBeUndefined()
    // The base point does state a height (5.05 m) — the row must not borrow it.
    expect(row(table([a]), 'IfcSite', 'RefElevation').cells).toEqual([DASH])
  })

  it('beside another model each column is its own file’s, whichever the Coordinate-system card describes', () => {
    const a = indexes[files.indexOf('georef/a-site-placement.ifc')]
    const tiny = indexes[files.indexOf('tiny.ifc')]
    const t = table([tiny, a])
    expect(row(t, 'IfcSite', 'Easting / Northing').cells).toEqual([DASH, OLD['georef/a-site-placement.ifc'][0]])
    expect(row(t, 'IfcSite', 'True north').cells).toEqual([DASH, OLD['georef/a-site-placement.ifc'][2]])
  })
})
