/**
 * `src/shared/georef.ts` — the project frame, the project base point, and the CRS chips.
 *
 * The design has a literal base point and two literal chips. Every case below is one of the
 * three readings the fidelity contract's "never a placeholder" forces instead: read it from
 * the file, take the user's own typing, or show the em dash.
 *
 * The numbers in the "reference model" cases are the real file's, read independently with
 * IfcOpenShell (`scripts/expected-from-ifcopenshell.py` writes the same ones into the
 * fixture): site placement `(12 345 457, 23 456 766, 5 050) mm` rotated −43.4102777…° about Z,
 * an `IfcMapConversion` that converts nothing, `TrueNorth (0, 1)`.
 */
import { describe, expect, it } from 'vitest'
import { DASH } from '../../src/shared/fmt'
import {
  composeFrames,
  coordsFromGeoref,
  crsChip,
  detectMethod,
  federationFrame,
  frameKey,
  invertFrame,
  isIdentityMapConversion,
  isIdentitySitePlacement,
  isLocated,
  isSvy21,
  mapPlacement,
  mapRotationDeg,
  modelFrame,
  normaliseDeg,
  projectFrame,
  sameBasePoint,
  toMap,
  toProject,
  toWorld,
  worldToProjectMatrix,
  type ProjectFrame
} from '../../src/shared/georef'
import type { Georeference } from '../../src/shared/model-index.types'
import { lengthUnitFromLabel, US_SURVEY_FOOT } from '../../src/shared/units'

const none: Georeference = { source: 'none', sources: ['none'], method: 'none' }

/** The reference model's own header: `IFCPROJECTEDCRS('EPSG:3414','SVY21 / Singapore TM','SVY21',…)`. */
const svy21Crs = {
  name: 'EPSG:3414',
  description: 'SVY21 / Singapore TM',
  geodeticDatum: 'SVY21',
  verticalDatum: '',
  mapProjection: '',
  mapZone: ''
}

/** The 137.9 MB reference model, field for field. */
const SAMPLE_ROTATION = -43.41027777777736
const sample: Georeference = {
  source: 'IfcMapConversion',
  sources: ['IfcMapConversion', 'IfcSite'],
  method: 'IfcSite placement',
  eastings: 0,
  northings: 0,
  orthogonalHeight: 0,
  xAxisAbscissa: 1,
  xAxisOrdinate: 6.123233995736766e-17,
  rotationDeg: 3.5087e-15,
  scale: 0.001,
  crs: svy21Crs,
  site: {
    expressId: 91,
    placement: [12345.457, 23456.766, 5.05],
    rotationDeg: SAMPLE_ROTATION
  },
  trueNorth: [6.123233995736766e-17, 1]
}

describe('toMap', () => {
  it('is the design’s own L409 expression', () => {
    // 12.5°, the prototype's own angle: E = E0 + x·cos a − y·sin a.
    const base = { E: 28500, N: 30200, Z: 102.5, angle: 12.5 }
    const m = toMap(base, 13.26, -2.74, 7.38)!
    expect(m.E).toBeCloseTo(28513.539, 3)
    expect(m.N).toBeCloseTo(30200.195, 3)
    expect(m.Z).toBeCloseTo(109.88, 3)
  })

  it('rotates project north onto map north, not the other way', () => {
    const base = { E: 0, N: 0, Z: 0, angle: 90 }
    const m = toMap(base, 1, 0, 0)!
    expect(m.E).toBeCloseTo(0, 9)
    expect(m.N).toBeCloseTo(1, 9)
  })

  it('treats a missing angle as no rotation, and a missing coordinate as no map at all', () => {
    expect(toMap({ E: 10, N: 20, Z: 30, angle: null }, 1, 2, 3)).toEqual({ E: 11, N: 22, Z: 33 })
    expect(toMap({ E: null, N: 20, Z: 30, angle: 0 }, 1, 2, 3)).toBeNull()
    expect(isLocated({ E: 1, N: 2, Z: 3, angle: null })).toBe(true)
    expect(isLocated({ E: 1, N: 2, Z: null, angle: 4 })).toBe(false)
  })

  it('takes a project point to the file’s own world coordinates on the reference model', () => {
    // A point 20 m along the building's own +X and 5 m along its +Y, 3 m up. The base point is
    // the site placement, so `toMap` and `toWorld` must be the same arithmetic.
    const base = coordsFromGeoref(sample)!
    const m = toMap(base, 20, 5, 3)!
    const [wx, wy, wz] = toWorld(projectFrame(sample), 20, 5, 3)
    // The base point's angle is kept to 1e-4°, so the two agree to a fraction of a
    // millimetre rather than exactly — which is the tolerance every readout is checked at.
    expect(Math.hypot(m.E - wx, m.N - wy, m.Z - wz)).toBeLessThan(0.001)
  })
})

describe('the project frame', () => {
  it('reads the reference model’s site placement as project → world', () => {
    const f = projectFrame(sample)!
    expect(f.origin).toEqual([12345.457, 23456.766, 5.05])
    expect(f.rotationDeg).toBeCloseTo(SAMPLE_ROTATION, 9)
  })

  it('is null when the site leaves the two frames the same', () => {
    expect(projectFrame(none)).toBeNull()
    expect(projectFrame({ ...none, site: { placement: [0, 0, 0] } })).toBeNull()
    expect(isIdentitySitePlacement({ ...none, site: { placement: [0, 0, 0] } })).toBe(true)
    expect(isIdentitySitePlacement(sample)).toBe(false)
  })

  it('keeps a tilted placement’s translation and reads it as no rotation', () => {
    const tilted = projectFrame({
      ...none,
      site: { placement: [10, 20, 30], rotationDeg: 17, pureZRotation: false }
    })!
    expect(tilted.origin).toEqual([10, 20, 30])
    expect(tilted.rotationDeg).toBe(0)
  })

  it('round-trips a point and matches the matrix the streamer composes', () => {
    const f = projectFrame(sample)!
    const p: [number, number, number] = [12.5, -7.25, 3]
    const w = toWorld(f, ...p)
    const back = toProject(f, ...w)
    back.forEach((v, i) => expect(v).toBeCloseTo(p[i], 9))

    const m = worldToProjectMatrix(f)!
    const [x, y, z] = w
    const mx = m[0] * x + m[4] * y + m[8] * z + m[12]
    const my = m[1] * x + m[5] * y + m[9] * z + m[13]
    const mz = m[2] * x + m[6] * y + m[10] * z + m[14]
    expect(mx).toBeCloseTo(p[0], 9)
    expect(my).toBeCloseTo(p[1], 9)
    expect(mz).toBeCloseTo(p[2], 9)
    expect(worldToProjectMatrix(null)).toBeNull()
  })

  it('turns a world direction back onto the building’s own axes', () => {
    // The reference model's two grid families run at 46.59° and 136.59° in world coordinates;
    // undoing the site rotation must put them on 90° and 180°, i.e. square with the building.
    const f = projectFrame(sample)!
    const dir = (deg: number): number => {
      const r = (deg * Math.PI) / 180
      const a = toProject(f, f.origin[0], f.origin[1], 0)
      const b = toProject(f, f.origin[0] + Math.cos(r), f.origin[1] + Math.sin(r), 0)
      const d = (((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI) % 180 + 180) % 180
      // A line has no sense, so 180° and 0° are the same direction.
      return d > 179.999999 ? d - 180 : d
    }
    expect(dir(46.58972222222264)).toBeCloseTo(90, 9)
    expect(dir(136.58972222222264)).toBeCloseTo(0, 9)
  })

  it('marks a payload with the frame its camera was recorded in', () => {
    expect(frameKey(null)).toBe('identity')
    expect(frameKey(projectFrame(sample))).toBe('12345.457,23456.766,5.050@-43.4103')
    // Two runs over the same file agree; a different site does not.
    expect(frameKey(projectFrame(sample))).toBe(frameKey(projectFrame({ ...sample })))
    expect(frameKey(projectFrame({ ...sample, site: { placement: [1, 2, 3] } }))).not.toBe(
      frameKey(projectFrame(sample))
    )
  })

  it('normalises degrees into (−180, 180]', () => {
    expect(normaliseDeg(0)).toBe(0)
    expect(normaliseDeg(-43.41)).toBeCloseTo(-43.41, 9)
    expect(normaliseDeg(190)).toBeCloseTo(-170, 9)
    expect(normaliseDeg(-190)).toBeCloseTo(170, 9)
    expect(normaliseDeg(180)).toBe(180)
    expect(normaliseDeg(-180)).toBe(180)
    expect(normaliseDeg(540)).toBe(180)
  })
})

describe('detectMethod', () => {
  const mapOnly: Georeference = {
    source: 'IfcMapConversion',
    sources: ['IfcMapConversion'],
    method: 'none',
    eastings: 28500,
    northings: 30200,
    orthogonalHeight: 102.5,
    xAxisAbscissa: Math.cos(Math.PI / 6),
    xAxisOrdinate: Math.sin(Math.PI / 6)
  }

  it('names the site placement when the map conversion converts nothing', () => {
    // The reference model's own case, and the whole reason the card read 0 / 0 / 0 / 0.
    expect(isIdentityMapConversion(sample)).toBe(true)
    expect(detectMethod(sample)).toBe('IfcSite placement')
  })

  it('names the map conversion when the site sits at the origin', () => {
    expect(isIdentityMapConversion(mapOnly)).toBe(false)
    expect(detectMethod(mapOnly)).toBe('IfcMapConversion')
  })

  it('names both when both move the model', () => {
    const both: Georeference = {
      ...mapOnly,
      sources: ['IfcMapConversion', 'IfcSite'],
      site: { placement: [30, 40, 5], rotationDeg: 45 }
    }
    expect(detectMethod(both)).toBe('IfcMapConversion + IfcSite placement')
  })

  it('names the IFC2X3 pset by its own name', () => {
    const epset: Georeference = {
      source: 'ePset',
      sources: ['ePset'],
      method: 'none',
      epsetName: 'ePset_MapConversion',
      eastings: 12345.678,
      northings: 23456.789,
      orthogonalHeight: 3.2
    }
    expect(detectMethod(epset)).toBe('ePset_MapConversion')
  })

  it('is none for a file that states nothing, and for one that states only zeros', () => {
    expect(detectMethod(none)).toBe('none')
    expect(detectMethod(null)).toBe('none')
    expect(
      detectMethod({
        source: 'IfcMapConversion',
        sources: ['IfcMapConversion'],
        method: 'none',
        eastings: 0,
        northings: 0,
        orthogonalHeight: 0,
        xAxisAbscissa: 1,
        xAxisOrdinate: 0
      })
    ).toBe('none')
  })

  it('reads the rotation off the two axis components, or off the stated angle', () => {
    expect(mapRotationDeg(mapOnly)).toBeCloseTo(30, 9)
    expect(mapRotationDeg({ ...none, rotationDeg: 43 })).toBe(43)
    expect(mapRotationDeg(none)).toBeNull()
  })
})

describe('coordsFromGeoref', () => {
  it('reads IfcMapConversion, rotation included', () => {
    const g: Georeference = {
      source: 'IfcMapConversion',
      sources: ['IfcMapConversion'],
      method: 'IfcMapConversion',
      eastings: 28500,
      northings: 30200,
      orthogonalHeight: 102.5,
      rotationDeg: 12.5,
      crs: svy21Crs
    }
    expect(coordsFromGeoref(g)).toEqual({ E: 28500, N: 30200, Z: 102.5, angle: 12.5 })
  })

  it('reads a map conversion with offsets and a 30° X axis over an identity site', () => {
    const g: Georeference = {
      source: 'IfcMapConversion',
      sources: ['IfcMapConversion'],
      method: 'IfcMapConversion',
      eastings: 28500,
      northings: 30200,
      orthogonalHeight: 102.5,
      xAxisAbscissa: Math.cos(Math.PI / 6),
      xAxisOrdinate: Math.sin(Math.PI / 6),
      site: { placement: [0, 0, 0] }
    }
    expect(coordsFromGeoref(g)).toEqual({ E: 28500, N: 30200, Z: 102.5, angle: 30 })
  })

  it('keeps a MapConversion whose values are genuinely zero', () => {
    // `IFCMAPCONVERSION(#24,#30,0.,0.,0.,1.,6.12e-17,0.001)` with nothing on the site: the
    // file's own local coordinates are SVY21 and the base point is genuinely the origin.
    const g: Georeference = {
      source: 'IfcMapConversion',
      sources: ['IfcMapConversion'],
      method: 'none',
      eastings: 0,
      northings: 0,
      orthogonalHeight: 0,
      rotationDeg: 0,
      crs: svy21Crs
    }
    expect(coordsFromGeoref(g)).toEqual({ E: 0, N: 0, Z: 0, angle: 0 })
  })

  it('composes the map conversion over the site placement when both move the model', () => {
    const g: Georeference = {
      source: 'IfcMapConversion',
      sources: ['IfcMapConversion', 'IfcSite'],
      method: 'IfcMapConversion + IfcSite placement',
      eastings: 1000,
      northings: 2000,
      orthogonalHeight: 10,
      xAxisAbscissa: 0,
      xAxisOrdinate: 1,
      site: { placement: [30, 40, 5], rotationDeg: 45 }
    }
    // The map conversion turns by +90°, so the site's (30, 40) lands on (−40, 30).
    expect(coordsFromGeoref(g)).toEqual({ E: 960, N: 2030, Z: 15, angle: 135 })
  })

  it('reads the reference model: the site carries the position AND the rotation', () => {
    expect(coordsFromGeoref(sample)).toEqual({
      E: 12345.457,
      N: 23456.766,
      Z: 5.05,
      angle: -43.4103
    })
  })

  it('falls back to IfcSite.ObjectPlacement, which is the CORENET X convention', () => {
    const g: Georeference = {
      source: 'IfcSite',
      sources: ['IfcSite'],
      method: 'IfcSite placement',
      site: { latitude: 1.35, longitude: 103.87, elevation: 12, placement: [8744, 32721, 5.55] }
    }
    // The placement does not rotate and no conversion states an angle, so `angle` stays absent
    // rather than becoming 0.
    expect(coordsFromGeoref(g)).toEqual({ E: 8744, N: 32721, Z: 5.55, angle: null })
  })

  it('takes RefElevation alone when there is no placement', () => {
    const g: Georeference = {
      source: 'IfcSite',
      sources: ['IfcSite'],
      method: 'none',
      site: { elevation: 12 }
    }
    expect(coordsFromGeoref(g)).toEqual({ E: null, N: null, Z: 12, angle: null })
  })

  it('takes TrueNorth only when nothing else states a rotation', () => {
    const tn: Georeference = { ...none, trueNorth: [0.5, Math.sqrt(3) / 2] }
    expect(coordsFromGeoref(tn)).toEqual({ E: null, N: null, Z: null, angle: 30 })
    // `(0, 1)` is "true north is project north" and states nothing.
    expect(coordsFromGeoref({ ...none, trueNorth: [0, 1] })).toBeNull()
    // A map conversion and a TrueNorth that disagree: the conversion wins, because it is what
    // the E / N readouts are computed with.
    const both: Georeference = {
      source: 'IfcMapConversion',
      sources: ['IfcMapConversion'],
      method: 'IfcMapConversion',
      eastings: 10,
      northings: 20,
      orthogonalHeight: 0,
      rotationDeg: 5,
      trueNorth: [0.5, Math.sqrt(3) / 2]
    }
    expect(coordsFromGeoref(both)!.angle).toBe(5)
  })

  it('reads the IFC2X3 ePset the same way', () => {
    const g: Georeference = {
      source: 'ePset',
      sources: ['ePset'],
      method: 'ePset_MapConversion',
      epsetName: 'ePset_MapConversion',
      eastings: 12345.678,
      northings: 23456.789,
      orthogonalHeight: 3.2,
      xAxisAbscissa: Math.cos((-10 * Math.PI) / 180),
      xAxisOrdinate: Math.sin((-10 * Math.PI) / 180)
    }
    expect(coordsFromGeoref(g)).toEqual({ E: 12345.678, N: 23456.789, Z: 3.2, angle: -10 })
  })

  it('is null for a file with no georeferencing at all — never a default origin', () => {
    expect(coordsFromGeoref(none)).toBeNull()
    expect(coordsFromGeoref(null)).toBeNull()
    expect(coordsFromGeoref(undefined)).toBeNull()
    // A source that carries nothing usable is the same answer.
    expect(
      coordsFromGeoref({ source: 'IfcSite', sources: ['IfcSite'], method: 'none', site: {} })
    ).toBeNull()
  })

  it('keeps a rotation that arrives on its own', () => {
    const g: Georeference = {
      source: 'IfcMapConversion',
      sources: ['IfcMapConversion'],
      method: 'none',
      rotationDeg: 43
    }
    expect(coordsFromGeoref(g)).toEqual({ E: null, N: null, Z: null, angle: 43 })
  })

  it('compares two base points field for field', () => {
    const a = { E: 1, N: 2, Z: 3, angle: 4 }
    expect(sameBasePoint(a, { ...a })).toBe(true)
    expect(sameBasePoint(a, { ...a, angle: null })).toBe(false)
  })
})

describe('crsChip', () => {
  const withCrs = (crs: Partial<typeof svy21Crs>): Georeference => ({
    source: 'IfcMapConversion',
    sources: ['IfcMapConversion'],
    method: 'IfcMapConversion',
    crs: { ...svy21Crs, ...crs }
  })

  it('keeps the design’s own two chips for an SVY21 file', () => {
    expect(crsChip(withCrs({}), false)).toEqual({ short: 'SVY21', long: 'SVY21 · EPSG:3414' })
    expect(isSvy21(withCrs({}))).toBe(true)
    // However the file spells it.
    expect(isSvy21(withCrs({ name: 'SVY 21', description: '', geodeticDatum: '' }))).toBe(true)
    expect(isSvy21(withCrs({ name: 'EPSG:3414', description: '', geodeticDatum: '' }))).toBe(true)
  })

  it('names another CRS rather than claiming SVY21', () => {
    const g = withCrs({ name: 'EPSG:32648', description: 'WGS 84 / UTM zone 48N', geodeticDatum: 'WGS 84' })
    expect(isSvy21(g)).toBe(false)
    expect(crsChip(g, false)).toEqual({ short: 'EPSG:32648', long: 'EPSG:32648' })
    // …even when the user has typed a base point as well: the file's declaration wins.
    expect(crsChip(g, true).short).toBe('EPSG:32648')
  })

  it('keeps the design’s status chip once the user has typed a base point', () => {
    expect(crsChip(none, true)).toEqual({ short: 'SVY21', long: DASH })
    expect(crsChip(null, true).short).toBe('SVY21')
  })

  it('is the em dash with no georeferencing and nothing typed', () => {
    expect(crsChip(none, false)).toEqual({ short: DASH, long: DASH })
    expect(crsChip(null, false)).toEqual({ short: DASH, long: DASH })
    // Georeferenced, but with no projected CRS to name.
    const site: Georeference = {
      source: 'IfcSite',
      sources: ['IfcSite'],
      method: 'IfcSite placement',
      site: { placement: [1, 2, 3] }
    }
    expect(crsChip(site, false).short).toBe(DASH)
  })
})

/* ────────────────────────── 2026-10-08: the federation in map space ────────────────────────── */

/** The repository's synthetic map position — the one the `tests/fixtures/georef/` set carries. */
const O = [12345.457, 23456.766, 5.05] as const
const A = -43.4103
const SITE_KEY = '12345.457,23456.766,5.050@-43.4103'
const rad = (d: number): number => (d * Math.PI) / 180

/** Placed by `IfcMapConversion` over a site at the file's zero (Revit "Project Base Point"). */
const byConversion = (extra: Partial<Georeference> = {}): Georeference => ({
  source: 'IfcMapConversion',
  sources: ['IfcMapConversion'],
  method: 'IfcMapConversion',
  eastings: O[0],
  northings: O[1],
  orthogonalHeight: O[2],
  xAxisAbscissa: Math.cos(rad(A)),
  xAxisOrdinate: Math.sin(rad(A)),
  scale: 0.001,
  ...extra
})

/** The same building placed by its site, beside Revit's zero conversion ("Shared Coordinates"). */
const bySite: Georeference = {
  ...sample,
  site: { expressId: 91, placement: [O[0], O[1], O[2]], rotationDeg: A }
}

/** A survey point: a local site offset that carries the turn, the survey point in the conversion. */
const bySurveyPoint: Georeference = {
  ...byConversion({
    eastings: O[0] + 8,
    northings: O[1] - 3,
    xAxisAbscissa: 1,
    xAxisOrdinate: 6.123233995736766e-17
  }),
  sources: ['IfcMapConversion', 'IfcSite'],
  site: { placement: [-8, 3, 0], rotationDeg: A }
}

/** The same building with its map position stated in feet. */
const inFeet = (): Georeference =>
  byConversion({
    eastings: O[0] / 0.3048,
    northings: O[1] / 0.3048,
    orthogonalHeight: O[2] / 0.3048,
    mapUnit: { name: 'FOOT', metres: 0.3048 }
  })

const near = (a: readonly number[], b: readonly number[], tol = 1e-9): void => {
  expect(a.length).toBe(b.length)
  a.forEach((v, i) => expect(Math.abs(v - b[i]), `[${i}] ${v} vs ${b[i]}`).toBeLessThan(tol))
}
const sameOp = (a: ProjectFrame | null, b: ProjectFrame | null): void => {
  expect(!!a).toBe(!!b)
  if (!a || !b) return
  near(a.origin, b.origin)
  expect(Math.abs(normaliseDeg(a.rotationDeg - b.rotationDeg))).toBeLessThan(1e-9)
}

describe('mapPlacement — one model’s own world → map operation (2026-10-08)', () => {
  it('reads IfcMapConversion as T(E·u, N·u, H·u) · Rz(θ), anticlockwise', () => {
    const m = mapPlacement(byConversion())
    expect(m.placedBy).toBe('IfcMapConversion')
    expect(m.metresPerMapUnit).toBe(1)
    expect(m.mapUnit).toBeNull()
    near(m.operation!.origin, O)
    expect(m.operation!.rotationDeg).toBeCloseTo(A, 9)
    // World +X is the conversion's X axis on the map; world +Y a quarter turn anticlockwise of it.
    near(toWorld(m.operation, 1, 0, 0), [O[0] + Math.cos(rad(A)), O[1] + Math.sin(rad(A)), O[2]])
    near(toWorld(m.operation, 0, 1, 2), [O[0] - Math.sin(rad(A)), O[1] + Math.cos(rad(A)), O[2] + 2])
  })

  it('reads IFC2X3’s ePset the same way, under its own name', () => {
    const epset: Georeference = {
      ...byConversion(),
      source: 'ePset',
      sources: ['ePset'],
      method: 'ePset_MapConversion'
    }
    const m = mapPlacement(epset)
    expect(m.placedBy).toBe('ePset_MapConversion')
    sameOp(m.operation, mapPlacement(byConversion()).operation)
  })

  it('is the identity for a model placed by its site, and for one that states nothing', () => {
    expect(mapPlacement(bySite)).toMatchObject({ operation: null, placedBy: 'site placement' })
    expect(mapPlacement(sample)).toMatchObject({ operation: null, placedBy: 'site placement' })
    expect(mapPlacement(none)).toMatchObject({ operation: null, placedBy: 'none', metresPerMapUnit: 1 })
    expect(mapPlacement(null)).toMatchObject({ operation: null, placedBy: 'none' })
  })

  it('turns by atan2(ordinate, abscissa) in all four quadrants', () => {
    for (const d of [30, 120, -150, 210, -60]) {
      const m = mapPlacement(
        byConversion({ xAxisAbscissa: Math.cos(rad(d)), xAxisOrdinate: Math.sin(rad(d)) })
      )
      expect(m.operation!.rotationDeg, `${d}°`).toBeCloseTo(normaliseDeg(d), 9)
      near(toWorld(m.operation, 1, 0, 0), [O[0] + Math.cos(rad(d)), O[1] + Math.sin(rad(d)), O[2]])
      near(toWorld(m.operation, 0, 1, 0), [O[0] - Math.sin(rad(d)), O[1] + Math.cos(rad(d)), O[2]])
    }
  })

  it('takes only the axis vector’s direction: it need not be unit length', () => {
    const unit = mapPlacement(byConversion({ xAxisAbscissa: 0.6, xAxisOrdinate: 0.8 })).operation!
    const long = mapPlacement(byConversion({ xAxisAbscissa: 3, xAxisOrdinate: 4 })).operation!
    const short = mapPlacement(byConversion({ xAxisAbscissa: 3e-4, xAxisOrdinate: 4e-4 })).operation!
    sameOp(long, unit)
    sameOp(short, unit)
    expect(unit.rotationDeg).toBeCloseTo((Math.atan2(4, 3) * 180) / Math.PI, 12)
    // A point 1 m along world +X stays 1 m from the origin on the map: nothing is scaled.
    const [x, y] = toWorld(long, 1, 0, 0)
    expect(Math.hypot(x - O[0], y - O[1])).toBeCloseTo(1, 12)
  })

  it('multiplies E, N and H by the map unit — an SI prefix, the foot, the US survey foot', () => {
    const inUnit = (metres: number, name: string): Georeference =>
      byConversion({
        eastings: O[0] / metres,
        northings: O[1] / metres,
        orthogonalHeight: O[2] / metres,
        mapUnit: { name, metres }
      })
    for (const [metres, name] of [
      [0.001, 'MILLIMETRE'],
      [1000, 'KILOMETRE'],
      [0.3048, 'FOOT'],
      [US_SURVEY_FOOT, 'US SURVEY FOOT']
    ] as const) {
      const m = mapPlacement(inUnit(metres, name))
      expect(m.metresPerMapUnit, name).toBe(metres)
      expect(m.mapUnit).toBe(name)
      expect(m.mapUnitKnown).toBe(true)
      near(m.operation!.origin, O, 1e-6)
    }
    // The two feet differ by 2 ppm — 25 mm at a 12 km easting, which is why both are exact.
    const survey = mapPlacement({ ...inFeet(), mapUnit: { name: 'US SURVEY FOOT', metres: US_SURVEY_FOOT } })
    expect(Math.abs(survey.operation!.origin[0] - O[0])).toBeGreaterThan(0.02)
    expect(lengthUnitFromLabel('US survey foot')).toBe(US_SURVEY_FOOT)
  })

  it('reads E, N and H as metres when the map unit is absent — and when it cannot be read, says so', () => {
    expect(mapPlacement(byConversion()).metresPerMapUnit).toBe(1)
    const unknown = mapPlacement(byConversion({ mapUnit: { name: 'CHAIN' } }))
    expect(unknown).toMatchObject({ metresPerMapUnit: 1, mapUnit: 'CHAIN', mapUnitKnown: false })
    near(unknown.operation!.origin, O)
  })

  it('places a model identically whether Scale is absent, 0.001 or 1000 — and reports it as written', () => {
    const at = (scale: number | undefined): ReturnType<typeof mapPlacement> =>
      mapPlacement(byConversion({ scale }))
    expect(at(undefined).operation).toEqual(at(0.001).operation)
    expect(at(1000).operation).toEqual(at(0.001).operation)
    expect([at(undefined).scale, at(0.001).scale, at(1000).scale]).toEqual([null, 0.001, 1000])
  })

  it('takes Revit’s zero conversion and its 6.12e-17 ordinate for the identity — nothing turns twice', () => {
    const revit: Georeference = {
      source: 'IfcMapConversion',
      sources: ['IfcMapConversion'],
      method: 'none',
      eastings: 0,
      northings: 0,
      orthogonalHeight: 0,
      xAxisAbscissa: 1,
      xAxisOrdinate: 6.123233995736766e-17,
      scale: 0.001
    }
    expect(isIdentityMapConversion(revit)).toBe(true)
    expect(mapPlacement(revit).operation).toBeNull()
    expect(mapPlacement({ ...revit, xAxisOrdinate: 0 }).operation).toBeNull()
    expect(
      mapPlacement({ ...revit, xAxisAbscissa: undefined, xAxisOrdinate: undefined }).operation
    ).toBeNull()
    // …and with the shared coordinates on its site, P is that site placement, untouched.
    expect(federationFrame({ ...revit, site: bySite.site })).toEqual(projectFrame(bySite))
  })

  it('never stacks TrueNorth on a conversion, and places nothing by it alone', () => {
    const north: readonly [number, number] = [Math.sin(rad(A)), Math.cos(rad(A))]
    expect(mapPlacement(byConversion({ trueNorth: north })).operation).toEqual(
      mapPlacement(byConversion()).operation
    )
    expect(federationFrame(byConversion({ trueNorth: north }))).toEqual(federationFrame(byConversion()))
    const onlyNorth: Georeference = { ...none, trueNorth: [0.5, Math.sqrt(3) / 2] }
    expect(mapPlacement(onlyNorth).operation).toBeNull()
    expect(federationFrame(onlyNorth)).toBeNull()
  })
})

describe('P, the federation frame, and each model’s frame M_i⁻¹ ∘ P (2026-10-08)', () => {
  it('is the boot model’s site frame itself when its map operation is the identity — frameKey unchanged', () => {
    // The reference model and every Revit "Shared Coordinates" export: exactly today's key.
    expect(federationFrame(sample)).toEqual(projectFrame(sample))
    expect(frameKey(federationFrame(sample))).toBe('12345.457,23456.766,5.050@-43.4103')
    expect(frameKey(federationFrame(bySite))).toBe(frameKey(projectFrame(bySite)))
    // The design's mock and every file that states nothing: the identity.
    expect(federationFrame(none)).toBeNull()
    expect(frameKey(federationFrame(none))).toBe('identity')
    expect(frameKey(federationFrame(null))).toBe('identity')
  })

  it('composes the map conversion over the site placement', () => {
    const both: Georeference = {
      source: 'IfcMapConversion',
      sources: ['IfcMapConversion', 'IfcSite'],
      method: 'IfcMapConversion + IfcSite placement',
      eastings: 1000,
      northings: 2000,
      orthogonalHeight: 10,
      xAxisAbscissa: 0,
      xAxisOrdinate: 1,
      site: { placement: [30, 40, 5], rotationDeg: 45 }
    }
    const P = federationFrame(both)!
    // The map conversion turns by +90°, so the site's (30, 40) lands on (−40, 30).
    near(P.origin, [960, 2030, 15])
    expect(P.rotationDeg).toBeCloseTo(135, 9)
  })

  it('gives a model placed by its site and one placed by IfcMapConversion the same P', () => {
    for (const g of [byConversion(), byConversion({ scale: undefined }), bySurveyPoint, inFeet()]) {
      sameOp(federationFrame(g), federationFrame(bySite))
      expect(frameKey(federationFrame(g))).toBe(SITE_KEY)
    }
  })

  it('gives a boot model placed by a map conversion a new frameKey — its camera then falls back', () => {
    // Its own stream is unchanged (its frame is its site frame, below); only the key moves, from
    // the site frame it used to record to P.
    expect(frameKey(projectFrame(byConversion()))).toBe('identity')
    expect(frameKey(federationFrame(byConversion()))).toBe(SITE_KEY)
    expect(frameKey(projectFrame(bySurveyPoint))).toBe('-8.000,3.000,0.000@-43.4103')
    expect(frameKey(federationFrame(bySurveyPoint))).toBe(SITE_KEY)
  })

  it('is the boot model’s site frame, exactly, for every model placed the way the boot is', () => {
    expect(modelFrame(bySite, bySite)).toEqual(projectFrame(bySite))
    expect(modelFrame(sample, none)).toEqual(projectFrame(sample))
    expect(modelFrame(sample, bySite)).toEqual(projectFrame(sample))
    expect(modelFrame(byConversion(), byConversion())).toEqual(projectFrame(byConversion()))
    // `Scale` is no part of the operation, so a different one is the same placement.
    expect(modelFrame(byConversion(), byConversion({ scale: 1000 }))).toBeNull()
    expect(modelFrame(bySurveyPoint, bySurveyPoint)).toEqual(projectFrame(bySurveyPoint))
    expect(modelFrame(null, null)).toBeNull()
  })

  it('round-trips: world → project through frame_i, then P, lands where the model’s own declaration puts it', () => {
    const models = [bySite, sample, byConversion(), inFeet(), bySurveyPoint, none]
    const world: [number, number, number][] = [
      [0, 0, 0],
      [20, 12, 4],
      [-3.5, 7.25, -1],
      [12346, 23457, 6]
    ]
    for (const boot of models) {
      const P = federationFrame(boot)
      for (const m of models) {
        const frame = modelFrame(boot, m)
        const matrix = worldToProjectMatrix(frame)
        const own = mapPlacement(m).operation
        for (const w of world) {
          const p = toProject(frame, ...w)
          // Through P onto the map: exactly where model m's own operation puts its world point.
          near(toWorld(P, ...p), toWorld(own, ...w), 1e-6)
          // Back again, and the matrix the streamer composes agrees.
          near(toWorld(frame, ...p), w, 1e-6)
          if (!matrix) continue
          const [x, y, z] = w
          near(
            [
              matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
              matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
              matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]
            ],
            p,
            1e-6
          )
        }
      }
    }
  })

  it('composes and inverts', () => {
    const f: ProjectFrame = { origin: [12345.457, 23456.766, 5.05], rotationDeg: A }
    const g: ProjectFrame = { origin: [-8, 3, 1], rotationDeg: 120 }
    const id = composeFrames(invertFrame(f), f)!
    near(id.origin, [0, 0, 0], 1e-9)
    expect(Math.abs(id.rotationDeg)).toBeLessThan(1e-9)
    // A null side is the identity and hands the other back as it is — the same object.
    expect(composeFrames(null, f)).toBe(f)
    expect(composeFrames(f, null)).toBe(f)
    expect(composeFrames(null, null)).toBeNull()
    expect(invertFrame(null)).toBeNull()
    // (f ∘ g)(p) = f(g(p)).
    near(toWorld(composeFrames(f, g), 1, 2, 3), toWorld(f, ...toWorld(g, 1, 2, 3)), 1e-9)
  })

  it('reads the base point off P, the map unit included', () => {
    const want = { E: O[0], N: O[1], Z: O[2], angle: A }
    expect(coordsFromGeoref(inFeet())).toEqual(want)
    expect(coordsFromGeoref(byConversion())).toEqual(want)
    expect(coordsFromGeoref(bySurveyPoint)).toEqual(want)
    expect(coordsFromGeoref(bySite)).toEqual(want)
    // `Scale` moves nothing here either.
    expect(coordsFromGeoref(byConversion({ scale: 1000 }))).toEqual(want)
  })
})
