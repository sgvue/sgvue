/**
 * Units: the reading half (SI prefixes per measure kind) and the display half (the design's
 * millimetre/metre rule). A prefix on an area unit applies to its underlying length, which
 * is the trap that divides every area by a million when it is missed.
 */
import { describe, expect, it } from 'vitest'
import type { Units } from '../../src/shared/model-index.types'
import { THIN_SPACE } from '../../src/shared/fmt'
import {
  IDENTITY_UNITS,
  US_SURVEY_FOOT,
  formatLength,
  formatValue,
  lengthUnitFromLabel,
  measureKind,
  prefixPower,
  siFactor,
  toSI,
  unitLabel
} from '../../src/shared/units'

const units: Units = {
  byType: {},
  length: 0.001,
  area: 1,
  volume: 1,
  angle: Math.PI / 180
}

describe('unit scales', () => {
  it('applies an SI prefix at the right power', () => {
    expect(prefixPower('METRE')).toBe(1)
    expect(prefixPower('SQUARE_METRE')).toBe(2)
    expect(prefixPower('CUBIC_METRE')).toBe(3)
    expect(siFactor('METRE', 'MILLI')).toBeCloseTo(0.001, 12)
    expect(siFactor('SQUARE_METRE', 'MILLI')).toBeCloseTo(1e-6, 12)
    expect(siFactor('CUBIC_METRE', 'MILLI')).toBeCloseTo(1e-9, 15)
    expect(siFactor('METRE', 'CENTI')).toBeCloseTo(0.01, 12)
  })

  it('leaves a unit with no prefix alone, and ignores an unknown one', () => {
    expect(siFactor('METRE', '')).toBe(1)
    expect(siFactor('METRE', 'NOTAPREFIX')).toBe(1)
  })

  it('converts a measure to SI only when its kind is one we resolve', () => {
    expect(toSI(5600, 'IFCLENGTHMEASURE', units)).toBeCloseTo(5.6, 12)
    expect(toSI(5600, 'IfcPositiveLengthMeasure', units)).toBeCloseTo(5.6, 12)
    expect(toSI(36.04, 'IFCAREAMEASURE', units)).toBeCloseTo(36.04, 12)
    expect(toSI(90, 'IFCPLANEANGLEMEASURE', units)).toBeCloseTo(Math.PI / 2, 12)
    // Thermal transmittance has no resolved factor: the value stays as authored.
    expect(toSI(1.9, 'IFCTHERMALTRANSMITTANCEMEASURE', units)).toBeNull()
  })
})

describe('display', () => {
  it('shows lengths the way the design does', () => {
    // SGVue.dc.html:2063 — mm by default, metres behind the unit toggle.
    expect(formatLength(2.4, 'mm')).toBe(`2${THIN_SPACE}400 mm`)
    expect(formatLength(2.4, 'm')).toBe('2.400 m')
  })

  it('converts a length property with the model unit, and leaves everything else authored', () => {
    expect(formatValue(5600, 'IFCLENGTHMEASURE', units, 'mm')).toBe(`5${THIN_SPACE}600 mm`)
    expect(formatValue(5600, 'IFCLENGTHMEASURE', units, 'm')).toBe('5.600 m')
    expect(formatValue(36.044, 'IFCAREAMEASURE', units, 'mm')).toBe('36.044')
    expect(formatValue(1.9, undefined, units, 'mm')).toBe('1.9')
    expect(formatValue(true, undefined, units, 'mm')).toBe('True')
    expect(formatValue('2 HR', undefined, units, 'mm')).toBe('2 HR')
    expect(formatValue(['A', 'B'], undefined, units, 'mm')).toBe('A, B')
  })
})

/* ══════════════════════════ 2026-09-20 — naming the file's own unit ══════════════════════════ */

describe('unitLabel', () => {
  const units = (byType: Units['byType']): Units => ({ ...IDENTITY_UNITS, byType })
  const si = (unitType: string, name: string, prefix = ''): Units['byType'][string] => ({
    unitType,
    entity: 'IfcSIUnit',
    name,
    prefix
  })

  it('writes the prefix once, with the power staying on the unit', () => {
    expect(unitLabel(units({ LENGTHUNIT: si('LENGTHUNIT', 'METRE', 'MILLI') }), 'length')).toBe('mm')
    expect(unitLabel(units({ LENGTHUNIT: si('LENGTHUNIT', 'METRE') }), 'length')).toBe('m')
    expect(unitLabel(units({ AREAUNIT: si('AREAUNIT', 'SQUARE_METRE') }), 'area')).toBe('m²')
    expect(unitLabel(units({ AREAUNIT: si('AREAUNIT', 'SQUARE_METRE', 'MILLI') }), 'area')).toBe(
      'mm²'
    )
    expect(unitLabel(units({ VOLUMEUNIT: si('VOLUMEUNIT', 'CUBIC_METRE') }), 'volume')).toBe('m³')
    expect(unitLabel(units({ LENGTHUNIT: si('LENGTHUNIT', 'METRE', 'KILO') }), 'length')).toBe('km')
  })

  it('names a conversion-based unit by what the file called it', () => {
    const byType = {
      PLANEANGLEUNIT: {
        unitType: 'PLANEANGLEUNIT',
        entity: 'IfcConversionBasedUnit',
        name: 'DEGREE',
        prefix: ''
      }
    }
    expect(unitLabel(units(byType), 'angle')).toBe('degree')
  })

  it('returns null rather than a guess when the file does not say', () => {
    expect(unitLabel(IDENTITY_UNITS, 'length')).toBeNull()
    expect(unitLabel(IDENTITY_UNITS, 'area')).toBeNull()
    // An SI unit we have no symbol for is also a null, not a made-up one.
    expect(unitLabel(units({ LENGTHUNIT: si('LENGTHUNIT', 'PARSEC') }), 'length')).toBeNull()
  })

  it('reads the millimetre-lengths / square-metre-areas combination a Revit export writes', () => {
    const revit = units({
      LENGTHUNIT: si('LENGTHUNIT', 'METRE', 'MILLI'),
      AREAUNIT: si('AREAUNIT', 'SQUARE_METRE'),
      VOLUMEUNIT: si('VOLUMEUNIT', 'CUBIC_METRE')
    })
    expect([
      unitLabel(revit, 'length'),
      unitLabel(revit, 'area'),
      unitLabel(revit, 'volume')
    ]).toEqual(['mm', 'm²', 'm³'])
  })
})

describe('measureKind', () => {
  it('maps the measure types a quantity can carry, and nothing else', () => {
    expect(measureKind('IFCAREAMEASURE')).toBe('area')
    expect(measureKind('ifcvolumemeasure')).toBe('volume')
    expect(measureKind('IFCPOSITIVELENGTHMEASURE')).toBe('length')
    expect(measureKind('IFCTHERMALTRANSMITTANCEMEASURE')).toBeNull()
    expect(measureKind('')).toBeNull()
  })
})

describe('lengthUnitFromLabel — a map unit IFC2X3 can only name (2026-10-08)', () => {
  it('reads the metre with or without an SI prefix, however it is spelt', () => {
    for (const label of ['METRE', 'metre', 'Meter', 'METRES', '.METRE.', 'm', 'M']) {
      expect(lengthUnitFromLabel(label), label).toBe(1)
    }
    expect(lengthUnitFromLabel('MILLIMETRE')).toBe(1e-3)
    expect(lengthUnitFromLabel('MILLI METRE')).toBe(1e-3)
    expect(lengthUnitFromLabel('mm')).toBe(1e-3)
    expect(lengthUnitFromLabel('CENTIMETRE')).toBe(1e-2)
    expect(lengthUnitFromLabel('KILOMETRE')).toBe(1e3)
  })

  it('tells the international foot from the US survey foot', () => {
    for (const label of ['FOOT', 'foot', 'feet', 'ft', 'International Foot']) {
      expect(lengthUnitFromLabel(label), label).toBe(0.3048)
    }
    for (const label of ['US survey foot', 'US_SURVEY_FOOT', 'US Survey Feet', 'foot_us', 'usfoot', 'ftUS']) {
      expect(lengthUnitFromLabel(label), label).toBe(US_SURVEY_FOOT)
    }
    expect(US_SURVEY_FOOT).toBe(1200 / 3937)
  })

  it('knows nothing it was not told — never a guess', () => {
    for (const label of ['', 'CHAIN', 'YARD', 'SQUARE_METRE', 'BOGUSMETRE', 'constructor']) {
      expect(lengthUnitFromLabel(label), label).toBeUndefined()
    }
  })
})
