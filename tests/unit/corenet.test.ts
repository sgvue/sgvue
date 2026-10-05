/**
 * The CORENET X / IFC-SG readout, against the thresholds `check_corenet_sg()` uses.
 *
 * The distinction the whole thing exists for: a file can be correctly georeferenced by IFC's
 * own rules — `IfcMapConversion`, which is what most authoring tools write — and still fail
 * CORENET X, which reads `IfcSite.ObjectPlacement`. Neither is "wrong", and the readout says
 * which is present rather than grading the file.
 */
import { describe, expect, it } from 'vitest'
import { corenetReadout, SG_E_MAX, SG_N_MIN } from '../../src/shared/corenet'
import type { Georeference } from '../../src/shared/model-index.types'

const svy21 = {
  name: 'SVY21 / Singapore TM',
  description: 'EPSG:3414',
  geodeticDatum: 'SVY21',
  verticalDatum: 'SHD',
  mapProjection: 'TM',
  mapZone: ''
}

const geo = (over: Partial<Georeference>): Georeference => ({
  source: 'IfcSite',
  sources: ['IfcSite'],
  method: 'IfcSite placement',
  ...over
})

describe('corenetReadout', () => {
  it('passes a file that places IfcSite in SVY21 and declares the CRS', () => {
    const out = corenetReadout(
      geo({ crs: svy21, site: { placement: [28500, 30200, 102.5], elevation: 102.5 } })
    )
    expect(out.isSg).toBe(true)
    expect(out.status).toBe('pass')
    expect(out.checks.map((c) => c.pass)).toEqual([true, true, true, true, true])
    expect(out.checks[0].value).toBe('E 28500.000, N 30200.000')
  })

  it('fails a Singapore file whose site sits at the origin', () => {
    const out = corenetReadout(geo({ crs: svy21, site: { placement: [0, 0, 0] } }))
    expect(out.status).toBe('fail')
    expect(out.checks[0]).toMatchObject({ pass: false, value: 'Site at origin' })
    expect(out.note).toContain('CORENET X reads IfcSite.ObjectPlacement, not IfcMapConversion')
  })

  it('fails a Singapore file that georeferences only through IfcMapConversion', () => {
    const out = corenetReadout(
      geo({
        source: 'IfcMapConversion',
        sources: ['IfcMapConversion'],
        crs: svy21,
        eastings: 28500,
        northings: 30200,
        orthogonalHeight: 102.5
      })
    )
    expect(out.isSg).toBe(true)
    expect(out.status).toBe('fail')
    // The first three checks are about the site placement, which this file does not carry.
    expect(out.checks.slice(0, 3).every((c) => !c.pass)).toBe(true)
    expect(out.checks[4].pass).toBe(true)
  })

  it('recognises Singapore from the reference latitude and longitude alone', () => {
    const out = corenetReadout(
      geo({ site: { latitude: 1.3521, longitude: 103.8198, placement: [28500, 30200, 0] } })
    )
    expect(out.isSg).toBe(true)
    expect(out.checks[4].pass).toBe(false)
  })

  it('reports `na` for a model that is not in Singapore, and says why', () => {
    const out = corenetReadout(geo({ site: { latitude: 51.5, longitude: -0.12 } }))
    expect(out.status).toBe('na')
    expect(out.isSg).toBe(false)
    expect(out.checks).toEqual([])
    expect(out.note).toContain('CORENET X does not apply')
  })

  it('reports `na` for a file with no georeferencing at all — never a default origin', () => {
    expect(corenetReadout(undefined).status).toBe('na')
    expect(corenetReadout(geo({ source: 'none', sources: [], method: 'none' })).status).toBe('na')
  })

  it('applies ifcgref’s own SVY21 bounds', () => {
    const outside = corenetReadout(
      geo({ crs: svy21, site: { placement: [SG_E_MAX + 1, SG_N_MIN - 1, 0] } })
    )
    expect(outside.checks[1].pass).toBe(false)
    expect(outside.checks[2].pass).toBe(false)
  })
})
