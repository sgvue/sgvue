/**
 * The Markups card's rows, the Section card's chips and the status bar's CRS chip — the pure
 * selectors behind Phase 6's three cards.
 *
 * 2026-10-01: the Section card's chips are per plane — the gridline chips grouped by grid
 * family, each plane with its own summary and its own chip rule.
 */
import { describe, expect, it } from 'vitest'
import { DASH } from '../../src/shared/fmt'
import { federate } from '../../src/shared/federate'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import {
  measureRows,
  noMarks,
  spotRows
} from '../../src/renderer/state/selectors/markups'
import {
  LEVEL_DEFAULT_OFFSET_MM,
  chipPatch,
  planePatch,
  secCutStyle,
  secSummary,
  sectionGridFamilies,
  sectionLevelChips
} from '../../src/renderer/state/selectors/section'
import { hasManualCoords, statusValues } from '../../src/renderer/state/selectors/status'
import type { MeasureRecord, SpotRecord } from '../../src/renderer/viewer/annotations'
import type { SecPlane } from '../../src/renderer/state/shell'
import type { GridAxisRecord } from '../../src/shared/model-index.types'

const M: MeasureRecord[] = [
  { id: 1, p: [1, 2, 3], x: 1.66, y: 0.12, z: 1.44 },
  { id: 2, p: [4, 5, 6], x: 6, z: 2.04 }
]
const S: SpotRecord[] = [
  { id: 3, p: [1, 2, 3], E: 28513.539, N: 30200.195, Z: 109.88, x: 13.26, y: -2.74, z: 7.38 }
]

describe('measureRows', () => {
  it('numbers by position and prints millimetres by default', () => {
    const rows = measureRows(M, 'mm')
    expect(rows.map((r) => r.n)).toEqual(['M1', 'M2'])
    expect(rows[0].v).toBe('X 1 660 mm   Y 120 mm   Z 1 440 mm')
    // An axis with no reading is dropped, not printed as zero (the design's `filter`).
    expect(rows[1].v).toBe('X 6 000 mm   Z 2 040 mm')
  })

  it('prints three decimals of a metre under the m toggle', () => {
    expect(measureRows(M, 'm')[0].v).toBe('X 1.660 m   Y 0.120 m   Z 1.440 m')
    expect(measureRows(M, 'm')[1].v).toBe('X 6.000 m   Z 2.040 m')
  })

  it('renumbers when one is deleted, because the label is the row’s position', () => {
    expect(measureRows([M[1]], 'mm').map((r) => r.n)).toEqual(['M1'])
  })

  it('carries the record’s own id and its scene point through', () => {
    expect(measureRows(M, 'mm')[1]).toMatchObject({ id: 2, p: [4, 5, 6] })
  })
})

describe('spotRows', () => {
  it('prints E · N · Z to three decimals, in the design’s order', () => {
    expect(spotRows(S)[0]).toMatchObject({
      n: 'C1',
      id: 3,
      v: '28513.539 E · 30200.195 N · 109.880 Z'
    })
  })

  it('shows the em dash for a spot with no base point behind it', () => {
    const unlocated: SpotRecord[] = [
      { id: 4, p: [0, 0, 0], E: null, N: null, Z: null, x: 1, y: 2, z: 3 }
    ]
    expect(spotRows(unlocated)[0].v).toBe(`${DASH} E · ${DASH} N · ${DASH} Z`)
  })
})

describe('noMarks', () => {
  it('is the design’s own "nothing measured yet" condition', () => {
    expect(noMarks([], [])).toBe(true)
    expect(noMarks(M, [])).toBe(false)
    expect(noMarks([], S)).toBe(false)
  })
})

describe('the Section card', () => {
  const federation = federate([mockModelIndex('ARC'), mockModelIndex('STR')])
  /** One plane with nothing chosen. Since 2026-10-01 the card has two: gridline and level. */
  const off: SecPlane = { name: '', offset: 0, flip: false, cut: false }
  const names = (groups: { name: string }[][]): string[][] => groups.map((g) => g.map((c) => c.name))

  it('offers every grid and every storey the federation has', () => {
    expect(names(sectionGridFamilies(federation, off)).flat()).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
      '1',
      '2',
      '3',
      '4'
    ])
    expect(sectionLevelChips(federation, off).map((c) => c.name)).toEqual([
      'Foundation',
      'L1',
      'L2',
      'L3',
      'L4',
      'Roof'
    ])
  })

  it('groups the gridline chips by the grid’s own IFC family, one chip row a family', () => {
    // The design's mock: five `u` axes A…E, then four `v` axes 1…4.
    expect(names(sectionGridFamilies(federation, off))).toEqual([
      ['A', 'B', 'C', 'D', 'E'],
      ['1', '2', '3', '4']
    ])
    const grid = (name: string, family: GridAxisRecord['family']): GridAxisRecord => ({
      name,
      axis: null,
      v: null,
      start: [0, 0],
      end: [1, 0],
      family,
      gridExpressId: 0
    })
    const withGrids = (grids: GridAxisRecord[]) => ({ ...federation, grids })
    // A third family is a third row; one family is one row, so the card draws no rule.
    expect(
      names(
        sectionGridFamilies(
          withGrids([grid('A', 'u'), grid('B', 'u'), grid('1', 'v'), grid('R1', 'w'), grid('R2', 'w')]),
          off
        )
      )
    ).toEqual([['A', 'B'], ['1'], ['R1', 'R2']])
    expect(names(sectionGridFamilies(withGrids([grid('1', 'v'), grid('2', 'v')]), off))).toEqual([['1', '2']])
    // No grids at all: no row.
    expect(sectionGridFamilies(withGrids([]), off)).toEqual([])
  })

  it('lights only the live chip, each list from its own plane', () => {
    const live: SecPlane = { ...off, name: 'C', cut: true }
    const grids = sectionGridFamilies(federation, live).flat()
    expect(grids.filter((c) => c.on).map((c) => c.name)).toEqual(['C'])
    expect(grids.find((c) => c.name === 'C')).toMatchObject({
      line: 'var(--accent)',
      bg: 'var(--sel-bg)',
      fg: 'var(--sel-ink)'
    })
    // The level list reads the level plane, so a gridline cut lights nothing in it — and a
    // level cut lights its own chip while the gridline chip stays lit from its own plane.
    expect(sectionLevelChips(federation, off).some((c) => c.on)).toBe(false)
    const level: SecPlane = { ...off, name: 'L2', cut: true }
    expect(sectionLevelChips(federation, level).filter((c) => c.on).map((c) => c.name)).toEqual(['L2'])
    expect(sectionGridFamilies(federation, level).flat().some((c) => c.on)).toBe(false)
  })

  it('cuts at a grid with no offset and at a level 1 200 mm up (`:1875`)', () => {
    expect(chipPatch('C', 'grid', off)).toEqual({ name: 'C', offset: 0, cut: true })
    expect(chipPatch('L2', 'level', off)).toEqual({
      name: 'L2',
      offset: LEVEL_DEFAULT_OFFSET_MM,
      cut: true
    })
    expect(LEVEL_DEFAULT_OFFSET_MM).toBe(1200)
    // `flip` is not in the patch, so the plane keeps the side it had.
    expect(chipPatch('D', 'grid', { ...off, name: 'C', flip: true })).not.toHaveProperty('flip')
    // The set half of the rule on its own (`planePatch`) — what the assistant's `set_section`
    // starts from too, so a plane it sets is the plane the chip would have set.
    expect(planePatch('C', 'grid')).toEqual(chipPatch('C', 'grid', off))
    expect(planePatch('L2', 'level')).toEqual(chipPatch('L2', 'level', off))
    // It has no toggle in it: the live name gives the same patch, not a clear.
    expect(planePatch('C', 'grid')).toEqual({ name: 'C', offset: 0, cut: true })
  })

  it('clears its own plane when the live chip is clicked again — the name, as the design does', () => {
    const live: SecPlane = { ...off, name: 'C', cut: true }
    expect(chipPatch('C', 'grid', live)).toEqual({ name: '' })
    expect(chipPatch('D', 'grid', live)).toMatchObject({ name: 'D' })
    const level: SecPlane = { ...off, name: 'L2', offset: 1200, cut: true }
    expect(chipPatch('L2', 'level', level)).toEqual({ name: '' })
    expect(chipPatch('L3', 'level', level)).toEqual({ name: 'L3', offset: 1200, cut: true })
  })

  it('summarises each plane exactly as `:1922` does', () => {
    expect(secSummary('grid', off)).toBe('no section')
    expect(secSummary('level', off)).toBe('no section')
    expect(secSummary('grid', { ...off, name: 'C', cut: true })).toBe('grid C · cut')
    expect(secSummary('grid', { ...off, name: 'C' })).toBe('grid C · plane only')
    expect(secSummary('grid', { ...off, name: 'C', cut: true, flip: true })).toBe(
      'grid C · cut · flipped'
    )
    expect(secSummary('level', { ...off, name: 'L2', cut: true })).toBe('level L2 · cut')
  })

  it('lights the cut pill only while it is cutting (`:1996`)', () => {
    expect(secCutStyle(true)).toEqual({
      bg: 'var(--sel-bg)',
      fg: 'var(--sel-ink)',
      line: 'var(--accent)'
    })
    expect(secCutStyle(false)).toEqual({
      bg: 'transparent',
      fg: 'var(--muted)',
      line: 'var(--border)'
    })
  })
})

describe('the status bar’s CRS chip', () => {
  const federation = federate([mockModelIndex('ARC')])
  const base = {
    stats: { fps: 60, backend: 'WebGL2' as const, calls: 17 },
    visibleCount: 40,
    federation,
    units: 'mm' as const
  }

  it('is the em dash on a federation with no georeferencing and nothing typed', () => {
    // The design's mock has no CRS at all, which is why this is the parity difference.
    expect(statusValues({ ...base, coords: { E: null, N: null, Z: null, angle: null } }).crs).toBe(
      DASH
    )
  })

  it('keeps the design’s chip once the user has typed a base point', () => {
    const coords = { E: 28500, N: 30200, Z: 102.5, angle: 12.5 }
    expect(hasManualCoords(coords, federation)).toBe(true)
    expect(statusValues({ ...base, coords }).crs).toBe('SVY21')
  })

  it('does not call a file-supplied base point manual', () => {
    const georeferenced = federate([
      {
        ...mockModelIndex('ARC'),
        georef: {
          source: 'IfcMapConversion' as const,
          sources: ['IfcMapConversion' as const],
          method: 'IfcMapConversion' as const,
          eastings: 0,
          northings: 0,
          orthogonalHeight: 0,
          crs: {
            name: 'EPSG:3414',
            description: 'SVY21 / Singapore TM',
            geodeticDatum: 'SVY21',
            verticalDatum: '',
            mapProjection: '',
            mapZone: ''
          }
        }
      }
    ])
    const coords = { E: 0, N: 0, Z: 0, angle: 0 }
    expect(hasManualCoords(coords, georeferenced)).toBe(false)
    expect(statusValues({ ...base, federation: georeferenced, coords }).crs).toBe('SVY21')
  })
})
