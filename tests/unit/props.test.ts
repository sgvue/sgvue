/**
 * The property card's derived values — `SGVue.dc.html:1834–1873`, `:1985–1990` and
 * `:1650–1655` — checked against the design's own rules without a DOM.
 */
import { describe, expect, it } from 'vitest'
import { federate, type FederatedElement } from '../../src/shared/federate'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import type { CoordState } from '../../src/renderer/state/shell'
import {
  askAboutText,
  badgeKind,
  dimBtn,
  fullText,
  geoRows,
  pathChips,
  prettyKey,
  prettyName,
  psetBoxes,
  relRows,
  selectionCard,
  selTitle
} from '../../src/renderer/state/selectors/props'
import { DASH } from '../../src/renderer/state/selectors/spatial'

let nextId = 1
function element(patch: Partial<FederatedElement>): FederatedElement {
  const id = patch.id ?? nextId++
  return {
    id,
    localId: id,
    expressId: id,
    guid: `guid${id}`,
    guidValid: true,
    tag: '',
    model: 'ARC',
    name: `Element ${id}`,
    description: '',
    type: 'IfcWall',
    predefinedType: 'NOTDEFINED',
    objectType: '',
    typeGuid: '',
    storey: 'L1',
    material: '',
    materials: [],
    classifications: [],
    systems: [],
    decomposition: { children: [], openings: [], fillings: [] },
    psets: {},
    qto: {},
    psetMeta: {},
    ...patch
  }
}

const GEOREF: CoordState = { E: 28500, N: 30200, Z: 102.5, angle: 12.5 }
const NOWHERE: CoordState = { E: null, N: null, Z: null, angle: null }
const box = (
  min: [number, number, number],
  max: [number, number, number]
): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } => ({
  min: { x: min[0], y: min[1], z: min[2] },
  max: { x: max[0], y: max[1], z: max[2] }
})

describe('property set boxes', () => {
  it('orders SGPset → Pset → Qto, then alphabetically inside each rank', () => {
    const e = element({
      psets: {
        Pset_WallCommon: { Reference: 'EW200' },
        SGPset_Planting: { SpeciesCommonName: 'Tembusu' },
        Pset_AirTerminalTypeCommon: { Shape: 'ROUND' },
        SGPset_Accessibility: { Accessible: true }
      },
      qto: { Qto_WallBaseQuantities: { Length: 5600 }, Qto_BeamBaseQuantities: { Length: 10 } }
    })
    expect(psetBoxes(e).map((p) => p.name)).toEqual([
      'SGPset_Accessibility',
      'SGPset_Planting',
      'Pset_AirTerminalTypeCommon',
      'Pset_WallCommon',
      'Qto_BeamBaseQuantities',
      'Qto_WallBaseQuantities'
    ])
    expect(psetBoxes(e).map((p) => p.kind)).toEqual([
      'SGPset',
      'SGPset',
      'Pset',
      'Pset',
      'Qto',
      'Qto'
    ])
  })

  it('badges an SGPset in the accent and everything else on the step background', () => {
    expect(badgeKind('SGPset_Planting')).toBe('SGPset')
    expect(badgeKind('Qto_WallBaseQuantities')).toBe('Qto')
    expect(badgeKind('Pset_WallCommon')).toBe('Pset')
    // A set with no recognised prefix is still a Pset — `:1865` tests only the two prefixes.
    expect(badgeKind('ArchiCADProperties')).toBe('Pset')
    const [sg, qto, pset] = ['SGPset_X', 'Qto_X', 'Pset_X'].map(
      (n) => psetBoxes(element({ psets: { [n]: { A: 1 } } }))[0]
    )
    expect(sg).toMatchObject({ badgeLine: 'var(--accent)', badgeBg: 'var(--sel-bg)' })
    expect(qto).toMatchObject({ badgeLine: 'var(--border)', badgeFg: 'var(--muted)' })
    expect(pset).toMatchObject({ badgeLine: 'var(--border)', badgeFg: 'var(--step-ink)' })
  })

  it('strips the prefix and splits camelCase in names and in keys', () => {
    expect(prettyName('Pset_WallCommon')).toBe('Wall Common')
    expect(prettyName('SGPset_SoftLandscape')).toBe('Soft Landscape')
    expect(prettyName('Qto_DuctSegmentBaseQuantities')).toBe('Duct Segment Base Quantities')
    expect(prettyKey('GrossSideArea')).toBe('Gross Side Area')
    // An all-caps run has no lower→upper boundary, so it is left alone, as the design leaves it.
    expect(prettyKey('IFCGUID')).toBe('IFCGUID')
  })

  it('formats values the design’s way and hairlines every row but the first', () => {
    const rows = psetBoxes(
      element({ psets: { Pset_WallCommon: { IsExternal: true, LoadBearing: false, Length: 12500 } } })
    )[0].rows
    expect(rows.map((r) => r.v)).toEqual(['True', 'False', '12 500'])
    expect(rows.map((r) => r.top)).toEqual(['none', '1px solid var(--border)', '1px solid var(--border)'])
  })

  it('shows an inherited (type-level) set exactly like any other — no extra badge', () => {
    const e = element({
      psets: { Pset_WallCommon: { Reference: 'EW200' } },
      psetMeta: {
        Pset_WallCommon: {
          sourceExpressId: 42,
          inherited: true,
          kind: 'Pset',
          measures: {}
        }
      }
    })
    const [only] = psetBoxes(e)
    expect(only.kind).toBe('Pset')
    expect(Object.keys(only)).toEqual([
      'name',
      'kind',
      'rank',
      'short',
      'badgeFg',
      'badgeBg',
      'badgeLine',
      'rows'
    ])
  })
})

describe('containment chips', () => {
  const fed = (project: string, site: string, building: string) =>
    ({ project: { name: project, site, building, file: '', schema: '' } }) as never

  it('renders `›` only between items', () => {
    const chips = pathChips(fed('Sample Block', 'Lot 12521', 'Block A'), 'L2')
    expect(chips.map((c) => c.v)).toEqual(['Sample Block', 'Lot 12521', 'Block A', 'L2'])
    expect(chips.map((c) => c.sep)).toEqual([true, true, true, false])
  })

  it('deduplicates globally, not only adjacently, and drops empty parts', () => {
    // Project and building share a name with the storey between them: the design's
    // `a.indexOf(v) === i` keeps the first and drops both later copies.
    const chips = pathChips(fed('Block A', '', 'Block A'), 'Block A')
    expect(chips).toEqual([{ v: 'Block A', sep: false }])
  })
})

describe('related rows', () => {
  it('counts every element in the federation sharing the ObjectType / PredefinedType', () => {
    const elements = [
      element({ objectType: 'Basic Wall:EW200', predefinedType: 'SOLIDWALL' }),
      element({ objectType: 'Basic Wall:EW200', predefinedType: 'PARTITIONING' }),
      element({ objectType: 'Basic Wall:IW150', predefinedType: 'SOLIDWALL' }),
      element({ objectType: 'Basic Wall:IW150', predefinedType: 'SOLIDWALL' })
    ]
    const rows = relRows(elements, elements[0])
    expect(rows.map((r) => [r.k, r.v])).toEqual([
      ['Same ObjectType', '2'],
      ['Same PredefinedType', '3']
    ])
    expect(rows[0].ids).toEqual([elements[0].id, elements[1].id])
    expect(rows[1].ids).toEqual([elements[0].id, elements[2].id, elements[3].id])
  })

  it('groups the count with commas, as the design does', () => {
    const many = Array.from({ length: 1200 }, () => element({ objectType: 'Tree' }))
    expect(relRows(many, many[0])[0].v).toBe('1,200')
  })
})

describe('geometry rows', () => {
  it('formats the six rows exactly as the design does', () => {
    const rows = geoRows(box([0, 0, 0], [2.4, 0.2, 3]), 1, GEOREF, [0, 0, 0])
    expect(rows.map((r) => r.k)).toEqual([
      'Bounding box',
      'Footprint',
      'Box volume',
      'Base / top',
      'Centroid',
      'Geometry'
    ])
    expect(rows[0].v).toBe('2 400 mm × 200 mm × 3 000 mm')
    expect(rows[1].v).toBe('0.48 m²')
    expect(rows[2].v).toBe('1.440 m³')
    expect(rows[3].v).toBe('0 mm → 3 000 mm')
    expect(rows[5].v).toBe('1 solid')
    expect(geoRows(box([0, 0, 0], [1, 1, 1]), 3, GEOREF, [0, 0, 0])[5].v).toBe('3 solids')
  })

  it('places the centroid with the file’s own base point and rotation', () => {
    const [E, N, Z] = [GEOREF.E!, GEOREF.N!, GEOREF.Z!]
    const a = (GEOREF.angle! * Math.PI) / 180
    // Centre of the box below is (1, 2, 1.5).
    const want =
      `${(E + 1 * Math.cos(a) - 2 * Math.sin(a)).toFixed(3)} E · ` +
      `${(N + 1 * Math.sin(a) + 2 * Math.cos(a)).toFixed(3)} N · ` +
      `${(Z + 1.5).toFixed(3)} Z`
    expect(geoRows(box([0, 0, 0], [2, 4, 3]), 1, GEOREF, [0, 0, 0])[4].v).toBe(want)
  })

  it('shows the em dash when the file is not georeferenced — never a typed-in origin', () => {
    const rows = geoRows(box([0, 0, 0], [2, 4, 3]), 1, NOWHERE, [0, 0, 0])
    expect(rows[4]).toEqual({ k: 'Centroid', v: DASH })
    // Everything that does not need a base point still reads.
    expect(rows[0].v).toBe('2 000 mm × 4 000 mm × 3 000 mm')
    expect(rows[3].v).toBe('0 mm → 3 000 mm')
  })

  it('adds the federation offset back, so the rows are in the file’s coordinates', () => {
    const offset = [12520, 23186, 4] as const
    const rows = geoRows(box([0, 0, -1], [2, 4, 2]), 1, GEOREF, offset)
    // Sizes are differences and do not move …
    expect(rows[0].v).toBe('2 000 mm × 4 000 mm × 3 000 mm')
    // … while base / top come back to the storey ladder's own frame.
    expect(rows[3].v).toBe('3 000 mm → 6 000 mm')
    const a = (GEOREF.angle! * Math.PI) / 180
    const [cx, cy] = [12521, 23188]
    expect(rows[4].v).toBe(
      `${(GEOREF.E! + cx * Math.cos(a) - cy * Math.sin(a)).toFixed(3)} E · ` +
        `${(GEOREF.N! + cx * Math.sin(a) + cy * Math.cos(a)).toFixed(3)} N · ` +
        `${(GEOREF.Z! + 4.5).toFixed(3)} Z`
    )
  })

  it('is empty when the element has no geometry yet', () => {
    expect(geoRows(null, 0, GEOREF, [0, 0, 0])).toEqual([])
  })
})

describe('the card as a whole', () => {
  const fed = federate([mockModelIndex('ARC')])
  const wall = fed.elements.find((e) => e.type === 'IfcWall')!

  it('counts sets rather than boxes, and says so when there are none', () => {
    const card = selectionCard({
      federation: fed,
      element: wall,
      box: null,
      solids: 0,
      coords: NOWHERE,
      offset: [0, 0, 0]
    })!
    expect(card.psetCount).toBe(
      Object.keys(wall.psets).length + Object.keys(wall.qto).length
    )
    expect(card.psetCount).toBe(card.psets.length)
    expect(card.noPsets).toBe(false)

    const bare = selectionCard({
      federation: fed,
      element: { ...wall, psets: {}, qto: {} },
      box: null,
      solids: 0,
      coords: NOWHERE,
      offset: [0, 0, 0]
    })!
    expect(bare).toMatchObject({ psetCount: 0, noPsets: true, psets: [] })
  })

  it('is null with nothing selected', () => {
    expect(
      selectionCard({
        federation: fed,
        element: null,
        box: null,
        solids: 0,
        coords: NOWHERE,
        offset: [0, 0, 0]
      })
    ).toBeNull()
  })
})

describe('header', () => {
  it('names the multi-selection and its "showing last" rule', () => {
    expect(selTitle(0)).toBe('Properties')
    expect(selTitle(1)).toBe('Properties')
    expect(selTitle(3)).toBe('3 selected · showing last')
  })

  it('lights the dims button from the flag', () => {
    expect(dimBtn(false)).toEqual({
      fg: 'var(--muted)',
      bg: 'transparent',
      line: 'var(--border)'
    })
    expect(dimBtn(true)).toEqual({
      fg: 'var(--sel-ink)',
      bg: 'var(--sel-bg)',
      line: 'var(--accent)'
    })
  })
})

describe('the hover title of a clipped text (2026-10-01)', () => {
  it('is the whole text, however long', () => {
    expect(fullText('IfcBuildingElementProxy')).toBe('IfcBuildingElementProxy')
    expect(fullText('Pset_GeographicElementCommon')).toBe('Pset_GeographicElementCommon')
  })

  it('is absent for a blank and for the em dash — never a tooltip on a placeholder', () => {
    expect(fullText('')).toBeUndefined()
    expect(fullText(DASH)).toBeUndefined()
  })

  it('titles a set header with the set’s own full name, not the prettified one shown', () => {
    const [box] = psetBoxes(element({ psets: { Pset_WallCommon: { IsExternal: true } } }))
    expect(box.short).toBe('Wall Common')
    expect(fullText(box.name)).toBe('Pset_WallCommon')
  })
})

describe('"Ask about this" pre-fill', () => {
  it('names one element by identity', () => {
    const e = element({
      name: 'External Wall 3',
      type: 'IfcWall',
      objectType: 'Basic Wall:EW200',
      storey: 'L2'
    })
    expect(askAboutText([e])).toBe('About External Wall 3 (IfcWall, Basic Wall:EW200, L2): ')
  })

  it('falls back to the em dash for a missing ObjectType', () => {
    expect(askAboutText([element({ name: 'W1', objectType: '', storey: 'L1' })])).toBe(
      `About W1 (IfcWall, ${DASH}, L1): `
    )
  })

  it('names a multi-selection by count and distinct entity', () => {
    const els = [
      element({ type: 'IfcWall' }),
      element({ type: 'IfcDoor' }),
      element({ type: 'IfcWall' })
    ]
    expect(askAboutText(els)).toBe('About 3 selected elements (IfcWall, IfcDoor): ')
  })
})
