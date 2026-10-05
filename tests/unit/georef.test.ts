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
  coordsFromGeoref,
  crsChip,
  detectMethod,
  frameKey,
  isIdentityMapConversion,
  isIdentitySitePlacement,
  isLocated,
  isSvy21,
  mapRotationDeg,
  normaliseDeg,
  projectFrame,
  sameBasePoint,
  toMap,
  toProject,
  toWorld,
  worldToProjectMatrix
} from '../../src/shared/georef'
import type { Georeference } from '../../src/shared/model-index.types'

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
