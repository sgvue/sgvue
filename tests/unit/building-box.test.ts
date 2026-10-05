/**
 * 2026-09-24, owner-requested: the camera frames the **building**, not the site, and the grid
 * bubbles sit at the grids' own authored extent rather than the whole model's footprint.
 *
 * `shared/site.ts` decides which elements are the site; `shared/annotate.ts` builds the grid
 * rectangle. Both are pure, so they are checked on plain records here.
 */
import { describe, expect, it } from 'vitest'
import { GRID_EXTENT_MIN, GRID_PAD_MIN, gridExtentRect, padRect } from '../../src/shared/annotate'
import { SITE_CLASSES, isSiteLike } from '../../src/shared/site'

describe('isSiteLike — which elements are left out of the building box', () => {
  it('takes the site classes whatever they are called', () => {
    for (const type of [
      'IfcSite',
      'IfcGeographicElement',
      'IfcCivilElement',
      'IfcExternalSpatialElement',
      'IfcSpace'
    ]) {
      expect(isSiteLike({ type, name: 'Anything' })).toBe(true)
    }
    expect(SITE_CLASSES.size).toBe(5)
  })

  it('keeps every building class, whatever it is called', () => {
    for (const type of ['IfcWall', 'IfcSlab', 'IfcColumn', 'IfcBeam', 'IfcRoof', 'IfcRailing', 'IfcDoor']) {
      expect(isSiteLike({ type, name: 'Site wall', objectType: 'Topography' })).toBe(false)
    }
  })

  it('takes a proxy only when its name or type says it is the ground', () => {
    const proxy = (name: string, objectType = ''): boolean =>
      isSiteLike({ type: 'IfcBuildingElementProxy', name, objectType })
    // Revit's `Family:Type:ElementId` shapes; the names and ids are made up for this test.
    expect(proxy('Topography:12345')).toBe(true)
    expect(proxy('Toposolid:TS01 Foot Path:200001')).toBe(true)
    expect(proxy('SITE COVERAGE 2:7000002')).toBe(true)
    expect(proxy('Site 2:Site 1:4000003')).toBe(true)
    expect(proxy('', 'Topography')).toBe(true)
    // A word that merely contains "site" is not the site.
    expect(proxy('Opposite Door Proxy')).toBe(false)
    expect(proxy('Website Kiosk')).toBe(false)
    expect(proxy('Authority Envelope Control:10000004')).toBe(false)
    expect(proxy('Generic Model:Plinth')).toBe(false)
  })

  it('tolerates missing name and type', () => {
    expect(isSiteLike({ type: 'IfcBuildingElementProxy' })).toBe(false)
    expect(isSiteLike({ type: 'IfcGeographicElement' })).toBe(true)
  })
})

describe('gridExtentRect — the rectangle the gridlines are drawn across', () => {
  it('is the union of every grid segment’s two ends', () => {
    const r = gridExtentRect([
      { p0: [0, -3], p1: [0, 40] },
      { p0: [60, -3], p1: [60, 40] },
      { p0: [-4, 0], p1: [64, 0] },
      { p0: [-4, 36], p1: [64, 36] }
    ])
    expect(r).toEqual({ minX: -4, minY: -3, maxX: 64, maxY: 40 })
  })

  it('reads a segment written end-first the same way', () => {
    expect(gridExtentRect([{ p0: [10, 50], p1: [10, 0] }])).toEqual({ minX: 10, minY: 0, maxX: 10, maxY: 50 })
  })

  it('covers a rotated grid by its ends, not by a line through the model', () => {
    const c = Math.cos((-43.4103 * Math.PI) / 180)
    const s = Math.sin((-43.4103 * Math.PI) / 180)
    const r = gridExtentRect([{ p0: [0, 0], p1: [100 * c, 100 * s] }])!
    expect(r.minX).toBeCloseTo(0, 9)
    expect(r.maxX).toBeCloseTo(100 * c, 9)
    expect(r.minY).toBeCloseTo(100 * s, 9)
    expect(r.maxY).toBeCloseTo(0, 9)
  })

  it('ignores a segment too short to be an extent (an IfcLine of magnitude 1)', () => {
    expect(GRID_EXTENT_MIN).toBe(GRID_PAD_MIN)
    const r = gridExtentRect([
      { p0: [0, 0], p1: [0, 30] },
      { p0: [500, 500], p1: [501, 500] }
    ])
    expect(r).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 30 })
  })

  it('is null when no grid has a usable extent, so the caller falls back to the building', () => {
    expect(gridExtentRect([])).toBeNull()
    expect(gridExtentRect([{ p0: [5, 5], p1: [6, 5] }])).toBeNull()
    expect(gridExtentRect([{ p0: [5, 5], p1: [5, 5] }])).toBeNull()
    expect(gridExtentRect([{ p0: [Number.NaN, 0], p1: [10, 0] }])).toBeNull()
  })
})

describe('padRect — the design’s padding, on the rectangle it is given', () => {
  it('grows every side by gridPad of its own size', () => {
    // 6 % of 300 m = 18 m.
    expect(padRect({ minX: 0, minY: 0, maxX: 300, maxY: 120 })).toEqual({
      rect: { minX: -18, minY: -18, maxX: 318, maxY: 138 },
      pad: 18
    })
  })

  it('keeps the 2.5 m clearance floor on a small or degenerate rectangle', () => {
    expect(padRect({ minX: 10, minY: 0, maxX: 10, maxY: 20 })).toEqual({
      rect: { minX: 7.5, minY: -2.5, maxX: 12.5, maxY: 22.5 },
      pad: 2.5
    })
  })
})
