/**
 * 2026-10-09 — the display unit (owner-requested: *"Why model units not automatically using the
 * units provided by model? in other countries are feets"*; of the options offered, *"auto unit +
 * feet"* — start in the first model's unit, add feet and inches beside mm and m, and show
 * coordinates in the file's map unit; *"Singapore mm models look exactly as now"*).
 *
 * One rule (`shared/units.ts`): in `mm` every readout prints what it printed before, byte for
 * byte; in `m` what printed millimetres prints metres to three decimals and what printed metres is
 * unchanged; in `ft` a length, a dimension or an elevation is feet and inches to the nearest
 * sixteenth, a coordinate is decimal feet, and an area or a volume the app computes is ft² / ft³.
 * Values the file authored are never converted.
 *
 * Here: the two feet formatters, the boot model's unit, every readout in each of the three
 * units, the Section card's field, the Coordinate-system card's map unit, the annotation layer
 * re-rendering its labels, the boot setting the unit, a session carrying it, and the assistant.
 */
import { Box3, Vector3 } from 'three/webgpu'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  laserLabelHtml,
  laserLiveHtml,
  levelTagHtml,
  spotGridHtml,
  spotLevelHtml,
  type LaserAxis
} from '../../src/shared/annotate'
import { FOOT, ftIn, MINUS, mmPlain, mmTxt, mmv, signedFtIn, signedMm, THIN_SPACE } from '../../src/shared/fmt'
import { coordsFromGeoref, mapUnitOf } from '../../src/shared/georef'
import type { Georeference, Units, UnitEntry } from '../../src/shared/model-index.types'
import { sessionPatch, sessionPayload, type SessionSource } from '../../src/shared/session-codec'
import { NO_PLANE } from '../../src/shared/sections'
import {
  areaIn,
  coordIn,
  DISPLAY_UNITS,
  displayUnitOf,
  formatDim,
  formatElevation,
  formatLength,
  IDENTITY_UNITS,
  isDisplayUnit,
  lengthNumber,
  lengthSuffix,
  unitLabel,
  US_SURVEY_FOOT,
  volumeIn
} from '../../src/shared/units'
import { chatViewState, sparseViewState } from '../../src/shared/ai-schema'
import { federate } from '../../src/shared/federate'
import { visFn } from '../../src/shared/rules'
import { mockGeometryChunks, mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { measureRows, spotRows } from '../../src/renderer/state/selectors/markups'
import { geoRows } from '../../src/renderer/state/selectors/props'
import {
  nudgeLabel,
  nudgeOffset,
  offsetText,
  parseFeet,
  parseOffset
} from '../../src/renderer/state/selectors/section'
import { spatialCards } from '../../src/renderer/state/selectors/spatial'
import { storeyRows } from '../../src/renderer/state/selectors/storeys'
import { markupsState } from '../../src/renderer/ai/executors/saved'
import { executeTool, newTurnState, type ToolContext } from '../../src/renderer/ai/executors'
import { FederationController, type BatchItem } from '../../src/renderer/model/federation-store'
import { createAnnotations, type AnnotationHost, type MeasureRecord, type SpotRecord } from '../../src/renderer/viewer/annotations'
import type { Label, LabelOverlay } from '../../src/renderer/viewer/overlay'
import { setViewer, useShell, type ShellState } from '../../src/renderer/state/shell'
import { disposeFederation, resetShell, stubViewer } from './stub-viewer'

/** Inches → metres, which is what every formatter takes. */
const inch = (n: number): number => n * 0.0254
const T = THIN_SPACE

/* ────────────────────────────── feet and inches ────────────────────────────── */

describe('feet and inches, to the nearest sixteenth', () => {
  it('writes feet, a hyphen, whole inches and a reduced fraction', () => {
    expect(ftIn(inch(150.5))).toBe(`12'-6 1/2"`)
    expect(ftIn(inch(60))).toBe(`5'-0"`)
    expect(ftIn(inch(61))).toBe(`5'-1"`)
    // No whole inches: the fraction alone, as the owner's own example has it — at any number
    // of feet.
    expect(ftIn(inch(0.75))).toBe(`0'-3/4"`)
    expect(ftIn(inch(60.125))).toBe(`5'-1/8"`)
    expect(ftIn(inch(36.5))).toBe(`3'-1/2"`)
    // Every sixteenth reduces as far as it goes, and an odd one stays in sixteenths.
    const sixteenths = [1, 2, 3, 4, 6, 8, 10, 12, 14, 15].map((n) => ftIn(inch(3 + n / 16)))
    expect(sixteenths).toEqual([
      `0'-3 1/16"`,
      `0'-3 1/8"`,
      `0'-3 3/16"`,
      `0'-3 1/4"`,
      `0'-3 3/8"`,
      `0'-3 1/2"`,
      `0'-3 5/8"`,
      `0'-3 3/4"`,
      `0'-3 7/8"`,
      `0'-3 15/16"`
    ])
  })

  it('rounds to the nearest sixteenth, carrying into the next inch and the next foot', () => {
    // A third of a sixteenth either side rounds to the sixteenth itself.
    expect(ftIn(inch(6 + 1 / 16 + 1 / 48))).toBe(`0'-6 1/16"`)
    expect(ftIn(inch(6 + 1 / 16 - 1 / 48))).toBe(`0'-6 1/16"`)
    // 6.97" is nearer 7" than 6 15/16": the inch carries.
    expect(ftIn(inch(6.97))).toBe(`0'-7"`)
    // 11 15/16" is itself; 11.97" rounds to 12" — the next foot.
    expect(ftIn(inch(143.9375))).toBe(`11'-11 15/16"`)
    expect(ftIn(inch(143.97))).toBe(`12'-0"`)
    expect(ftIn(inch(11.97))).toBe(`1'-0"`)
  })

  it('reads metres: a storey 3.2004 m up is 10′-6″, the international foot 0.3048 m', () => {
    expect(FOOT).toBe(0.3048)
    expect(ftIn(3.2004)).toBe(`10'-6"`)
    expect(ftIn(0.3048)).toBe(`1'-0"`)
    expect(ftIn(2.4)).toBe(`7'-10 1/2"`)
  })

  it('reads zero with no sign, and a negative with U+2212 — the hyphen is the separator', () => {
    expect(ftIn(0)).toBe(`0'-0"`)
    expect(ftIn(-0)).toBe(`0'-0"`)
    // Less than half a sixteenth either way is zero, and zero has no sign.
    expect(ftIn(-inch(0.01))).toBe(`0'-0"`)
    expect(ftIn(-inch(0.75))).toBe(`${MINUS}0'-3/4"`)
    expect(ftIn(-3.2004)).toBe(`${MINUS}10'-6"`)
  })

  it('groups the feet of a large value with the thin space every number here uses', () => {
    expect(ftIn(12345.5 * FOOT)).toBe(`12${T}345'-6"`)
    expect(ftIn(1000 * FOOT)).toBe(`1${T}000'-0"`)
    expect(ftIn(999 * FOOT)).toBe(`999'-0"`)
  })

  it('signs an elevation as the millimetre one is signed: + or U+2212, and +0′-0″ for zero', () => {
    expect(signedFtIn(3.2004)).toBe(`+10'-6"`)
    expect(signedFtIn(-0.9144)).toBe(`${MINUS}3'-0"`)
    expect(signedFtIn(0)).toBe(`+0'-0"`)
    expect(signedFtIn(-inch(0.01))).toBe(`+0'-0"`)
    expect(signedMm(0)).toBe('+0')
  })
})

/* ────────────────────────────── the boot model's unit ────────────────────────────── */

const si = (name: string, prefix: string, factor: number): UnitEntry => ({
  unitType: 'LENGTHUNIT',
  entity: 'IfcSIUnit',
  name,
  prefix,
  factor
})
const conv = (name: string, factor?: number): UnitEntry => ({
  unitType: 'LENGTHUNIT',
  entity: 'IfcConversionBasedUnit',
  name,
  prefix: '',
  ...(factor !== undefined ? { factor } : {})
})
const withLength = (lu: UnitEntry | null): Units => ({
  ...IDENTITY_UNITS,
  byType: lu ? { LENGTHUNIT: lu } : {},
  length: lu?.factor ?? 1
})

describe('the unit the boot model starts the app in', () => {
  it('is mm for a millimetre or a centimetre, m for a metre or longer, ft for a foot or an inch', () => {
    expect(displayUnitOf(withLength(si('METRE', 'MILLI', 0.001)))).toBe('mm')
    expect(displayUnitOf(withLength(si('METRE', 'CENTI', 0.01)))).toBe('mm')
    expect(displayUnitOf(withLength(si('METRE', '', 1)))).toBe('m')
    expect(displayUnitOf(withLength(si('METRE', 'KILO', 1000)))).toBe('m')
    expect(displayUnitOf(withLength(conv('FOOT', 0.3048)))).toBe('ft')
    expect(displayUnitOf(withLength(conv('INCH', 0.0254)))).toBe('ft')
  })

  it('knows a foot by its name or, for a name it does not know, by its factor', () => {
    expect(displayUnitOf(withLength(conv('US SURVEY FOOT', US_SURVEY_FOOT)))).toBe('ft')
    expect(displayUnitOf(withLength(conv('feet', 0.3048)))).toBe('ft')
    // A name it does not know, a foot's factor.
    expect(displayUnitOf(withLength(conv('ft', 0.3048)))).toBe('ft')
    // A foot whose factor did not resolve is still a foot.
    expect(displayUnitOf(withLength(conv('FOOT')))).toBe('ft')
    // A conversion-based unit that is not imperial goes by its size.
    expect(displayUnitOf(withLength(conv('MILLIMETRE', 0.001)))).toBe('mm')
  })

  it('is null when the file states no length unit that resolves, so the design’s mm stands', () => {
    expect(displayUnitOf(IDENTITY_UNITS)).toBeNull()
    expect(displayUnitOf(withLength(conv('PARSEC')))).toBeNull()
  })

  it('is one of the three the toggle has, in the toggle’s order', () => {
    expect(DISPLAY_UNITS).toEqual(['mm', 'm', 'ft'])
    expect(DISPLAY_UNITS.every(isDisplayUnit)).toBe(true)
    for (const v of ['MM', 'feet', 'in', '', null, 1]) expect([v, isDisplayUnit(v)]).toEqual([v, false])
  })
})

/* ────────────────────────────── one rule for every readout ────────────────────────────── */

describe('one rule for every readout', () => {
  const lengths = [0, 0.04, 1.2, 2.4, 1234.5678, -1.5]

  it('in mm prints exactly what each readout printed before', () => {
    for (const v of lengths) {
      expect([v, formatLength(v, 'mm')]).toEqual([v, mmv(v)])
      expect([v, formatDim(v, 'mm')]).toEqual([v, mmTxt(v)])
      expect([v, lengthNumber(v, 'mm')]).toEqual([v, mmPlain(v)])
      expect([v, formatElevation(v, 'mm')]).toEqual([v, signedMm(v)])
      expect([v, coordIn(v, 'mm')]).toEqual([v, v])
    }
    expect(lengthSuffix('mm')).toBe(' mm')
    expect([areaIn(12.5, 'mm'), volumeIn(12.5, 'mm')]).toEqual([12.5, 12.5])
  })

  it('in m prints metres where it printed millimetres, and leaves metres alone', () => {
    expect(formatLength(2.4, 'm')).toBe('2.400 m')
    expect(formatDim(2.4, 'm')).toBe(`2.400${T}m`)
    expect(lengthNumber(2.4, 'm')).toBe('2.400')
    expect(lengthSuffix('m')).toBe(' m')
    expect(formatElevation(4, 'm')).toBe('+4.000')
    expect(formatElevation(-1.2, 'm')).toBe(`${MINUS}1.200`)
    // A coordinate, an area and a volume were metres already.
    expect(coordIn(12345.457, 'm')).toBe(12345.457)
    expect([areaIn(12.5, 'm'), volumeIn(12.5, 'm')]).toEqual([12.5, 12.5])
  })

  it('in ft prints feet and inches for a length, decimal feet for a coordinate, ft² and ft³', () => {
    expect(formatLength(2.4, 'ft')).toBe(`7'-10 1/2"`)
    expect(formatDim(6.096, 'ft')).toBe(`20'-0"`)
    expect(lengthNumber(1.2, 'ft')).toBe(`3'-11 1/4"`)
    // Feet and inches say their own unit.
    expect(lengthSuffix('ft')).toBe('')
    expect(formatElevation(4, 'ft')).toBe(`+13'-1 1/2"`)
    expect(coordIn(12345.457, 'ft')).toBeCloseTo(40503.46784776903, 9)
    expect(areaIn(1, 'ft')).toBeCloseTo(10.763910416709722, 12)
    expect(volumeIn(1, 'ft')).toBeCloseTo(35.31466672148859, 12)
  })
})

describe('a total’s unit, as the file writes it', () => {
  const byType = (entries: UnitEntry[]): Units => ({
    ...IDENTITY_UNITS,
    byType: Object.fromEntries(entries.map((e) => [e.unitType, e]))
  })
  const named = (unitType: string, name: string): UnitEntry => ({
    unitType,
    entity: 'IfcConversionBasedUnit',
    name,
    prefix: ''
  })

  it('writes an imperial length, area or volume with its symbol, however the exporter spells it', () => {
    const imperial = byType([named('LENGTHUNIT', 'FOOT'), named('AREAUNIT', 'SQUARE FOOT'), named('VOLUMEUNIT', 'CUBIC FOOT')])
    expect([unitLabel(imperial, 'length'), unitLabel(imperial, 'area'), unitLabel(imperial, 'volume')]).toEqual(['ft', 'ft²', 'ft³'])
    expect(unitLabel(byType([named('AREAUNIT', 'square_foot')]), 'area')).toBe('ft²')
    expect(unitLabel(byType([named('LENGTHUNIT', 'Inches')]), 'length')).toBe('in')
    expect(unitLabel(byType([named('VOLUMEUNIT', 'CUBIC YARD')]), 'volume')).toBe('yd³')
    // Anything else is the file's own name, as before.
    expect(unitLabel(byType([named('PLANEANGLEUNIT', 'DEGREE')]), 'angle')).toBe('degree')
  })
})

/* ────────────────────────────── the 3D labels ────────────────────────────── */

describe('the labels in the 3D view', () => {
  it('level tags print the authored elevation in the unit', () => {
    expect(levelTagHtml('L2', 4)).toBe(levelTagHtml('L2', 4, 'mm'))
    expect(levelTagHtml('L2', 4, 'mm')).toContain(`${signedMm(4)}`)
    expect(levelTagHtml('L2', 4, 'm')).toMatch(/&nbsp; \+4\.000$/)
    expect(levelTagHtml('L2', 4, 'ft')).toMatch(/&nbsp; \+13'-1 1\/2"$/)
  })

  it('a laser reading prints each side in the unit, and the live one writes its unit once', () => {
    expect(laserLabelHtml('X', 1.2)).toBe(laserLabelHtml('X', 1.2, 'mm'))
    expect(laserLabelHtml('X', 1.2, 'mm')).toContain(`>1${T}200 mm<`)
    expect(laserLabelHtml('X', 1.2, 'm')).toContain('>1.200 m<')
    expect(laserLabelHtml('X', 1.2, 'ft')).toContain(`>3'-11 1/4"<`)
    const rays = [
      { axis: 'X' as LaserAxis, minus: 0.3048, plus: inch(36.5) },
      { axis: 'Z' as LaserAxis, minus: null, plus: 1.2 }
    ]
    const mm = laserLiveHtml(rays)
    expect(laserLiveHtml(rays, 'mm')).toBe(mm)
    expect(mm.endsWith('<span style="color:var(--faint)"> mm</span>')).toBe(true)
    expect(laserLiveHtml(rays, 'm').endsWith('<span style="color:var(--faint)"> m</span>')).toBe(true)
    const ft = laserLiveHtml(rays, 'ft')
    expect(ft).toContain(`<b style="font-weight:500">1'-0"</b>`)
    expect(ft).toContain(`<b style="font-weight:500">3'-1/2"</b>`)
    expect(ft).toContain(`<b style="font-weight:500">3'-11 1/4"</b>`)
    // No unit after feet and inches.
    expect(ft.endsWith('</b>')).toBe(true)
  })

  it('a spot tag prints coordinates: metres in mm and m, decimal feet in ft', () => {
    const f = { x: 1.2345, y: -2.5, z: 3.2004 }
    const m = { E: 12345.457, N: 23456.766, Z: 5.05 }
    expect(spotGridHtml(f, m)).toBe(spotGridHtml(f, m, 'mm'))
    // The design's, as it always was: E / N / Z in metres, xyz in whole millimetres.
    expect(spotGridHtml(f, m, 'mm')).toContain(`>12${T}345.457<`)
    expect(spotGridHtml(f, m, 'mm')).toContain('>1235, -2500, 3200<')
    // m: E / N / Z unchanged, the millimetre row in metres.
    expect(spotGridHtml(f, m, 'm')).toContain(`>12${T}345.457<`)
    expect(spotGridHtml(f, m, 'm')).toContain('>1.234, -2.500, 3.200<')
    // ft: decimal feet, both.
    expect(spotGridHtml(f, m, 'ft')).toContain(`>40${T}503.468<`)
    expect(spotGridHtml(f, m, 'ft')).toContain('>4.050, -8.202, 10.500<')
    expect(spotLevelHtml(10.5)).toBe(spotLevelHtml(10.5, 'mm'))
    expect(spotLevelHtml(10.5, 'm')).toContain('>+10.500<')
    expect(spotLevelHtml(10.5, 'ft')).toContain('>+34.449<')
  })
})

/* ────────────────────────────── the cards ────────────────────────────── */

describe('the Markups card', () => {
  const measures: MeasureRecord[] = [
    { id: 1, p: [0, 0, 0], x: 0.3048 + inch(36.5), sides: { x: { minus: 0.3048, plus: inch(36.5) } } },
    { id: 2, p: [0, 0, 0], z: 1.2, sides: { z: { minus: null, plus: 1.2 } } }
  ]

  it('lists laser readings in the unit — feet and inches with no unit after them in ft', () => {
    expect(measureRows(measures, 'mm').map((r) => r.v)).toEqual([`X 305 + 927 mm`, `Z 1${T}200 mm`])
    expect(measureRows(measures, 'm').map((r) => r.v)).toEqual(['X 0.305 + 0.927 m', 'Z 1.200 m'])
    expect(measureRows(measures, 'ft').map((r) => r.v)).toEqual([`X 1'-0" + 3'-1/2"`, `Z 3'-11 1/4"`])
  })

  it('lists spot coordinates in metres in mm and m, and in decimal feet in ft', () => {
    const spots: SpotRecord[] = [{ id: 3, p: [0, 0, 0], E: 12345.457, N: 23456.766, Z: 5.05, x: 0, y: 0, z: 0 }]
    expect(spotRows(spots)[0].v).toBe('12345.457 E · 23456.766 N · 5.050 Z')
    expect(spotRows(spots, 'm')[0].v).toBe('12345.457 E · 23456.766 N · 5.050 Z')
    expect(spotRows(spots, 'ft')[0].v).toBe('40503.468 E · 76957.894 N · 16.568 Z')
  })
})

describe('the property card’s geometry rows', () => {
  // A wall 2.4 × 0.2 × 3 m, its base 1.2 m below the file's zero, at a base point.
  const box = { min: { x: 0, y: 0, z: -1.2 }, max: { x: 2.4, y: 0.2, z: 1.8 } }
  const coords = { E: 100, N: 200, Z: 10, angle: 0 }
  const rows = (u: 'mm' | 'm' | 'ft'): string[] => geoRows(box, 1, coords, [0, 0, 0], u).map((r) => `${r.k}: ${r.v}`)

  it('prints what it always printed in mm', () => {
    expect(rows('mm')).toEqual(geoRows(box, 1, coords, [0, 0, 0]).map((r) => `${r.k}: ${r.v}`))
    expect(rows('mm').slice(0, 5)).toEqual([
      `Bounding box: 2${T}400 mm × 200 mm × 3${T}000 mm`,
      'Footprint: 0.48 m²',
      'Box volume: 1.440 m³',
      `Base / top: -1${T}200 mm → 1${T}800 mm`,
      'Centroid: 101.200 E · 200.100 N · 10.300 Z'
    ])
  })

  it('prints metres in m, where it printed millimetres', () => {
    expect(rows('m').slice(0, 5)).toEqual([
      'Bounding box: 2.400 m × 0.200 m × 3.000 m',
      'Footprint: 0.48 m²',
      'Box volume: 1.440 m³',
      'Base / top: -1.200 m → 1.800 m',
      'Centroid: 101.200 E · 200.100 N · 10.300 Z'
    ])
  })

  it('prints feet and inches, square and cubic feet and decimal-feet coordinates in ft', () => {
    expect(rows('ft').slice(0, 5)).toEqual([
      `Bounding box: 7'-10 1/2" × 0'-7 7/8" × 9'-10 1/8"`,
      'Footprint: 5.17 ft²',
      'Box volume: 50.853 ft³',
      `Base / top: ${MINUS}3'-11 1/4" → 5'-10 7/8"`,
      'Centroid: 332.021 E · 656.496 N · 33.793 Z'
    ])
  })
})

describe('the storey list', () => {
  const federation = federate([mockModelIndex('ARC')])
  const elev = (u?: 'mm' | 'm' | 'ft'): string[] =>
    storeyRows({ storeys: federation.storeys, elements: federation.elements, storeyVis: {}, active: null, units: u }).map((r) => r.elev)

  it('prints each storey’s elevation in the unit, as the level tags do', () => {
    expect(elev()).toEqual(federation.storeys.map((s) => signedMm(s.elev)))
    expect(elev('mm')).toEqual(elev())
    expect(elev('m')).toEqual(federation.storeys.map((s) => formatElevation(s.elev, 'm')))
    expect(elev('ft')).toEqual(federation.storeys.map((s) => signedFtIn(s.elev)))
    // The mock's L2 is 4 m up.
    expect(elev('ft')[federation.storeys.findIndex((s) => s.elev === 4)]).toBe(`+13'-1 1/2"`)
  })
})

describe('the Spatial-structure card', () => {
  const federation = federate([mockModelIndex('ARC')])
  const rows = (u?: 'mm' | 'm' | 'ft'): Record<string, string> => {
    const cards = spatialCards({ federation, library: [], coords: { E: 12345.457, N: 23456.766, Z: 5.05, angle: 0 }, uploadNames: {}, units: u })
    return Object.fromEntries(cards.flatMap((c) => c.rows.map((r) => [`${c.type}.${r.k}`, r.v])))
  }

  it('prints the site’s height and position, and the height to the top storey, in the unit', () => {
    const mm = rows('mm')
    expect(rows()).toEqual(mm)
    expect(rows('m')).toEqual(mm)
    expect(mm['IfcSite.RefElevation']).toBe('5.050 m')
    expect(mm['IfcSite.Easting / Northing']).toBe('12,345.457 E · 23,456.766 N (SVY21)')
    const ft = rows('ft')
    expect(ft['IfcSite.RefElevation']).toBe('16.568 ft')
    expect(ft['IfcSite.Easting / Northing']).toBe('40,503.468 E · 76,957.894 N (SVY21)')
    const top = federation.storeys[federation.storeys.length - 1]
    expect(mm['IfcBuilding.Height to top']).toBe(`${top.elev.toFixed(3)} m (${top.name})`)
    expect(ft['IfcBuilding.Height to top']).toBe(`${ftIn(top.elev)} (${top.name})`)
  })
})

describe('the Section card’s offset field', () => {
  it('shows millimetres in mm, metres in m and feet and inches in ft — the plane holds millimetres', () => {
    expect(offsetText(1200, 'mm')).toBe('1200')
    expect(offsetText(1200, 'm')).toBe('1.2')
    expect(offsetText(-500, 'm')).toBe('-0.5')
    // At rest in ft the field is written as its nudges are: feet and inches.
    expect(offsetText(1200, 'ft')).toBe(`3'-11 1/4"`)
    expect(offsetText(3810, 'ft')).toBe(`12'-6"`)
    expect(offsetText(0, 'ft')).toBe(`0'-0"`)
    expect(offsetText(-500, 'ft')).toBe(`${MINUS}1'-7 11/16"`)
  })

  it('reads its own text back in ft, to the sixteenth it is written to — the minus sign and the feet’s thin spaces included', () => {
    // Past 1 000 ft the field's own text groups the feet with a thin space.
    expect(offsetText(304800, 'ft')).toBe(`1${THIN_SPACE}000'-0"`)
    expect(offsetText(304800000, 'ft')).toBe(`1${THIN_SPACE}000${THIN_SPACE}000'-0"`)
    for (const mm of [0, 1200, 1809.6, 3810, -500, -1066.8, 12345.6, 304800, 305123.4, -305123.4, 1234567.8, 304800123.4]) {
      const back = parseOffset(offsetText(mm, 'ft'), 'ft')!
      // Half a sixteenth of an inch is 0.79 mm.
      expect([mm, Math.abs(back - mm) <= 0.8]).toEqual([mm, true])
    }
  })

  it('reads decimal feet, and feet and inches as a person types them', () => {
    expect(parseFeet('12.5')).toBe(12.5)
    expect(parseFeet(`12'-6"`)).toBe(12.5)
    expect(parseFeet(`12' 6"`)).toBe(12.5)
    expect(parseFeet(`12'6"`)).toBe(12.5)
    expect(parseFeet(`12'-6`)).toBe(12.5)
    expect(parseFeet(`12'`)).toBe(12)
    expect(parseFeet(`6"`)).toBe(0.5)
    expect(parseFeet(`12'-6 1/2"`)).toBeCloseTo(12 + 6.5 / 12, 12)
    expect(parseFeet(`12'-6-1/2"`)).toBeCloseTo(12 + 6.5 / 12, 12)
    expect(parseFeet(`0'-3/4"`)).toBeCloseTo(0.0625, 12)
    expect(parseFeet(`-3'-6"`)).toBe(-3.5)
    expect(parseFeet(`${MINUS}3'-6"`)).toBe(-3.5)
    // A thin space that groups the feet is no separator; any other is read as a space.
    expect(parseFeet(`1${THIN_SPACE}000'-6"`)).toBe(1000.5)
    expect(parseFeet(`${MINUS}1${THIN_SPACE}000${THIN_SPACE}000'-0"`)).toBe(-1000000)
    expect(parseFeet(`1${THIN_SPACE}000.25`)).toBe(1000.25)
    expect(parseFeet(`12'-6${THIN_SPACE}1/2"`)).toBeCloseTo(12 + 6.5 / 12, 12)
    for (const bad of ['', 'abc', `'`, `12'-6 1/`, `12'-6 1`, `1/0"`]) expect([bad, Number.isNaN(parseFeet(bad))]).toEqual([bad, true])
  })

  it('turns what is typed into millimetres: the design’s rule in mm, nothing until it reads in m and ft', () => {
    expect(parseOffset('1500', 'mm')).toBe(1500)
    expect(parseOffset('abc', 'mm')).toBe(0)
    expect(parseOffset('', 'mm')).toBe(0)
    expect(parseOffset('1.5', 'm')).toBe(1500)
    expect(parseOffset('1.', 'm')).toBe(1000)
    expect(parseOffset('1.1', 'm')).toBe(1100)
    for (const t of ['', '-', 'abc']) expect([t, parseOffset(t, 'm')]).toEqual([t, null])
    expect(parseOffset(`12'-6"`, 'ft')).toBe(3810)
    expect(parseOffset('12.5', 'ft')).toBe(3810)
    expect(parseOffset(`0'-3/4"`, 'ft')).toBe(19.05)
    expect(parseOffset(`-3'-6"`, 'ft')).toBe(-1066.8)
    expect(parseOffset(`12'-6 1/`, 'ft')).toBeNull()
  })

  it('nudges by the design’s 500 mm in mm and m, and by 2′-0″ in ft', () => {
    expect(nudgeOffset(1200, -1, 'mm')).toBe(700)
    expect(nudgeOffset(1200, 1, 'm')).toBe(1700)
    expect(nudgeOffset(1200, 1, 'ft')).toBe(1809.6)
    expect(nudgeOffset(1809.6, 1, 'ft')).toBe(2419.2)
    expect(nudgeOffset(0, -1, 'ft')).toBe(-609.6)
    expect(nudgeLabel(-1, 'mm')).toEqual({ text: `${MINUS}500`, title: `${MINUS}500 mm` })
    expect(nudgeLabel(1, 'mm')).toEqual({ text: '+500', title: '+500 mm' })
    expect(nudgeLabel(-1, 'm')).toEqual({ text: `${MINUS}0.5`, title: `${MINUS}0.5 m` })
    expect(nudgeLabel(1, 'ft')).toEqual({ text: `+2'-0"`, title: `+2'-0"` })
  })
})

describe('the Coordinate-system card speaks the file’s own map unit', () => {
  const g = (mapUnit?: { name: string; metres?: number }, k = 1): Georeference => ({
    source: 'IfcMapConversion',
    sources: ['IfcMapConversion'],
    method: 'IfcMapConversion',
    eastings: 12345.457 * k,
    northings: 23456.766 * k,
    orthogonalHeight: 5.05 * k,
    ...(mapUnit ? { mapUnit } : {})
  })

  it('knows a foot from a rounded factor, and still tells the two feet apart', () => {
    // An exporter's rounded US survey foot, 1.3e-9 off — which a tolerance of 1e-9 missed.
    expect(mapUnitOf(g({ name: 'US SURVEY FOOT', metres: 0.30480061 }))).toEqual({ label: 'US ft', metres: 0.30480061 })
    expect(mapUnitOf(g({ name: 'FOOT', metres: 0.30480001 })).label).toBe('ft')
    // The two feet differ by 2e-6: 0.3048006 is the survey foot, 0.3048 the international one.
    expect(mapUnitOf(g({ name: 'x', metres: 0.3048006 })).label).toBe('US ft')
    expect(mapUnitOf(g({ name: 'x', metres: 0.3048 })).label).toBe('ft')
    // The same tolerance decides the boot unit for a length unit known only by its factor.
    expect(displayUnitOf(withLength(conv('FT US', 0.30480061)))).toBe('ft')
    expect(displayUnitOf(withLength(conv('LENGTH', 0.0254000001)))).toBe('ft')
    expect(displayUnitOf(withLength(conv('LENGTH', 0.305)))).toBe('mm')
  })

  it('names the metre, the foot and the US survey foot — and the metre for anything else', () => {
    expect(mapUnitOf(null)).toEqual({ label: 'm', metres: 1 })
    expect(mapUnitOf(g())).toEqual({ label: 'm', metres: 1 })
    expect(mapUnitOf(g({ name: 'METRE', metres: 1 }))).toEqual({ label: 'm', metres: 1 })
    expect(mapUnitOf(g({ name: 'FOOT', metres: 0.3048 }))).toEqual({ label: 'ft', metres: 0.3048 })
    expect(mapUnitOf(g({ name: 'US SURVEY FOOT', metres: US_SURVEY_FOOT }))).toEqual({ label: 'US ft', metres: US_SURVEY_FOOT })
    expect(mapUnitOf(g({ name: 'MILLIMETRE', metres: 0.001 }))).toEqual({ label: 'm', metres: 1 })
  })

  it('reads the base point back as the file authored it, in that unit', () => {
    // In metres, the numbers every read-out computes with are what they were.
    expect(coordsFromGeoref(g())).toEqual({ E: 12345.457, N: 23456.766, Z: 5.05, angle: null })
    expect(coordsFromGeoref(g(), 1)).toEqual(coordsFromGeoref(g()))
    // A position authored in US survey feet: metres for the read-outs, US feet for the card.
    const us = g({ name: 'US SURVEY FOOT', metres: US_SURVEY_FOOT }, 1 / US_SURVEY_FOOT)
    expect(coordsFromGeoref(us)).toEqual({ E: 12345.457, N: 23456.766, Z: 5.05, angle: null })
    expect(coordsFromGeoref(us, mapUnitOf(us).metres)).toEqual({ E: 40503.387, N: 76957.74, Z: 16.568, angle: null })
    // And in international feet.
    const ft = g({ name: 'FOOT', metres: FOOT }, 1 / FOOT)
    expect(coordsFromGeoref(ft, mapUnitOf(ft).metres)).toEqual({ E: 40503.468, N: 76957.894, Z: 16.568, angle: null })
  })
})

/* ────────────────────────────── the annotation layer ────────────────────────────── */

describe('the annotation layer re-renders every label in the unit', () => {
  let labels: Label[]

  function host(): AnnotationHost {
    const overlay: LabelOverlay = {
      labelBase: () => ({}),
      mkLabel: (pos, html, style = {}, dx = 0, dy = 0) => {
        const el = { innerHTML: html, style: { ...style }, title: '', addEventListener: () => {} }
        const label: Label = {
          el: el as unknown as HTMLDivElement,
          pos: pos.clone(),
          dx,
          dy,
          on: true,
          remove: () => void labels.splice(labels.indexOf(label), 1)
        }
        labels.push(label)
        return label
      },
      mkElement: () => {
        throw new Error('not used')
      },
      update: () => {},
      updateOcclusion: () => false,
      dispose: () => {}
    } as unknown as LabelOverlay
    return {
      overlay,
      materials: {} as unknown as AnnotationHost['materials'],
      bbox: new Box3(new Vector3(-2, -2, -1), new Vector3(14, 10, 8)),
      scale: () => 1,
      frame: new Box3(new Vector3(-2, -2, -1), new Vector3(14, 10, 8)),
      frameScale: () => 1,
      groundZ: () => 0,
      camera: () => {
        throw new Error('not used')
      },
      view: () => ({ theta: 0, phi: 1 }),
      size: () => ({ w: 1280, h: 820 }),
      // Two parallel grids 6.096 m (20 ft) apart, and one across them.
      grids: () => [
        { name: 'A', p0: [0, -1], p1: [0, 9] },
        { name: 'B', p0: [6.096, -1], p1: [6.096, 9] },
        { name: '1', p0: [-1, 0], p1: [13, 0] }
      ],
      storeys: () => [{ name: 'L2', elev: 3.2004, authored: 3.2004 }],
      elementBox: () => null,
      isVisible: () => true,
      // A room: a face 1.2 m to −X and 0.3048 m to +X of the origin, nothing else.
      ray: (origin, dir) => {
        if (dir.x === 0) return null
        const at = dir.x > 0 ? 0.3048 : -1.2
        const distance = (at - origin.x) / dir.x
        return { id: 9, point: origin.clone().addScaledVector(dir, distance), distance }
      },
      offset: () => [0, 0, 0],
      invalidate: () => {},
      on: {}
    }
  }

  beforeEach(() => {
    labels = []
  })

  const texts = (): string[] => labels.map((l) => l.el.innerHTML)

  it('prints the design’s millimetres until told, and every unit after', () => {
    const ann = createAnnotations(host())
    ann.rebuild()
    ann.setLevels(true)
    ann.addLaser(new Vector3(0, 0, 0), new Vector3(0, 0, 1), -1)
    ann.addSpot(new Vector3(1, 2, 3.2004))
    ann.previewLaser(new Vector3(0, 0, 0), new Vector3(0, 0, 1), -1)
    const mm = texts()
    expect(ann.debug().units).toBe('mm')
    expect(mm.some((t) => t.includes(`>1${T}200 mm<`))).toBe(true)
    expect(mm.some((t) => t.includes(`>305 mm<`))).toBe(true)
    expect(mm.some((t) => t.includes(`${signedMm(3.2004)}`) && t.includes('L2'))).toBe(true)
    expect(mm).toContain(`6${T}096${T}mm`)
    expect(mm.some((t) => t.includes('>+3.200<'))).toBe(true)

    // The same unit again changes nothing.
    ann.setUnits('mm')
    expect(texts()).toEqual(mm)

    ann.setUnits('ft')
    const ft = texts()
    expect(ann.debug().units).toBe('ft')
    // The laser's two readings and the live one.
    expect(ft.some((t) => t.includes(`>3'-11 1/4"<`))).toBe(true)
    expect(ft.some((t) => t.includes(`>1'-0"<`))).toBe(true)
    expect(ft.some((t) => t.includes(`<b style="font-weight:500">3'-11 1/4"</b>`) && !t.includes(' mm<'))).toBe(true)
    // The level tag and the grid dimension, re-derived.
    expect(ft.some((t) => t.includes('L2') && t.includes(`+10'-6"`))).toBe(true)
    expect(ft).toContain(`20'-0"`)
    // The spot tag's level, in decimal feet.
    expect(ft.some((t) => t.includes('>+10.500<'))).toBe(true)
    // Nothing printed in millimetres is left.
    expect(ft.filter((t) => / mm<|mm$/.test(t))).toEqual([])

    ann.setUnits('m')
    const m = texts()
    expect(m.some((t) => t.includes('>1.200 m<'))).toBe(true)
    expect(m).toContain(`6.096${T}m`)
    expect(m.some((t) => t.includes('L2') && t.includes('+3.200'))).toBe(true)
    expect(m.some((t) => t.includes('>+3.200<'))).toBe(true)

    ann.setUnits('mm')
    expect(texts().sort()).toEqual([...mm].sort())
  })
})

/* ────────────────────────────── the boot sets it ────────────────────────────── */

describe('the boot starts in the boot model’s unit', () => {
  let fed: FederationController
  const units: string[] = []
  const item = (key: string, length: UnitEntry | null): BatchItem => ({
    index: { ...mockModelIndex(key), units: withLength(length) },
    chunks: mockGeometryChunks(key),
    offset: [0, 0, 0],
    frame: null
  })
  const FT = conv('FOOT', 0.3048)
  const M = si('METRE', '', 1)
  const MM = si('METRE', 'MILLI', 0.001)

  beforeEach(() => {
    resetShell()
    units.length = 0
    fed = new FederationController()
    fed.attach(stubViewer({ setUnits: (u: string) => units.push(u), debug: () => ({}), elementIds: () => [] }))
  })
  afterEach(() => disposeFederation(fed))

  it('in ft for a model in feet, and tells the viewer', async () => {
    expect(useShell.getState().units).toBe('mm')
    await fed.addBatch([item('ARC', FT)])
    expect(useShell.getState().units).toBe('ft')
    expect(units).toEqual(['ft'])
  })

  it('in m for a model in metres, and in mm for a millimetre model or one that names no unit', async () => {
    await fed.addBatch([item('ARC', M)])
    expect(useShell.getState().units).toBe('m')
    await fed.removeModel('ARC')
    await fed.addBatch([item('STR', MM)])
    expect(useShell.getState().units).toBe('mm')
    await fed.removeModel('STR')
    useShell.getState().setUnits('ft')
    await fed.addBatch([item('MEP', null)])
    expect(useShell.getState().units).toBe('mm')
  })

  it('takes the first model of a boot batch, and a model that joins later changes nothing', async () => {
    await fed.addBatch([item('ARC', FT), item('STR', MM)])
    expect(useShell.getState().units).toBe('ft')
    // The user's own choice stands.
    useShell.getState().setUnits('m')
    await fed.addBatch([item('MEP', FT)])
    expect(useShell.getState().units).toBe('m')
  })
})

/* ────────────────────────────── a session carries it ────────────────────────────── */

describe('a session and a link carry the unit', () => {
  const source = (units: 'mm' | 'm' | 'ft'): SessionSource => ({
    uploadNames: {},
    hidden: {},
    storeyVis: {},
    modelVis: {},
    active: null,
    modelColors: {},
    nativeMats: true,
    treeMode: 'entity',
    grids: true,
    levels: false,
    shadows: true,
    theme: 'dark',
    snap: true,
    dims: false,
    sections: { grid: NO_PLANE, level: NO_PLANE },
    stack: [],
    hlColor: '#35C4B6',
    view: 'iso',
    coords: { E: null, N: null, Z: null, angle: null },
    units
  })

  it('writes it, and restores it over the boot model’s — or keeps the boot model’s when it states none', () => {
    expect(sessionPayload(source('ft'), [], [], null, 'identity').units).toBe('ft')
    const live = source('ft')
    expect(sessionPatch({ units: 'm' }, live).units).toBe('m')
    // Every payload written before 2026-10-09 has none: the live unit — the boot model's — stays.
    expect(sessionPatch({}, live).units).toBe('ft')
    // A pasted link is text: anything that is not one of the three is no unit.
    expect(sessionPatch({ units: 'yards' as never }, live).units).toBe('ft')
    expect(sessionPatch({ units: 'MM' as never }, source('mm')).units).toBe('mm')
  })

  it('the store’s restore sets it through the toggle’s own action, so the viewer hears', () => {
    resetShell()
    const heard: string[] = []
    setViewer(stubViewer({ setUnits: (u: string) => heard.push(u) }))
    try {
      useShell.getState().setUnits('ft')
      useShell.getState().applySession({ units: 'm' })
      expect(useShell.getState().units).toBe('m')
      useShell.getState().applySession({})
      expect(useShell.getState().units).toBe('m')
      expect(heard).toEqual(['ft', 'm'])
    } finally {
      setViewer(null)
    }
  })
})

/* ────────────────────────────── the assistant ────────────────────────────── */

describe('the assistant reaches the unit as the user does', () => {
  const full = federate(['ARC', 'STR', 'SIT', 'MEP'].map((k) => mockModelIndex(k)))
  const turn = newTurnState()
  const ctx = (): ToolContext => ({
    state: () => useShell.getState(),
    sql: (async () => ({ columns: [], rows: [], truncated: false, ms: 0 })) as never,
    rawLine: async () => null,
    turn
  })
  const run = async (name: string, input: unknown = {}): Promise<Record<string, unknown>> =>
    (await executeTool(name, input, ctx())) as Record<string, unknown>
  const st = (): ShellState => useShell.getState()

  beforeEach(() => {
    resetShell()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
    st().commitModels(full)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('set_interface sets ft, and get_view_state reads it back', async () => {
    const set = await run('set_interface', { units: 'ft' })
    expect(st().units).toBe('ft')
    expect(String(set.message)).toContain('units ft')
    const view = await run('get_view_state')
    expect(view.units).toBe('ft')
    expect((view.interface as { units: string }).units).toBe('ft')
    expect(String((await run('set_interface', { units: 'ft' })).message)).toContain('units already ft')
  })

  it('the per-turn view state names the unit only while it is not mm', () => {
    const perTurn = (): Record<string, unknown> =>
      chatViewState(st(), st().federation, visFn(st()), null) as unknown as Record<string, unknown>
    expect(sparseViewState(st(), st().federation)).toEqual({})
    expect('units' in perTurn()).toBe(false)
    st().setUnits('ft')
    expect(sparseViewState(st(), st().federation)).toEqual({ units: 'ft' })
    expect(perTurn().units).toBe('ft')
    st().setUnits('m')
    expect(perTurn().units).toBe('m')
    st().setUnits('mm')
    expect('units' in perTurn()).toBe(false)
  })

  it('manage_markups lists laser lengths in decimal feet while the card shows ft, and spots in metres', () => {
    useShell.setState({
      units: 'ft',
      measures: [{ id: 1, p: [0, 0, 0], x: 1.2 + 0.3048, sides: { x: { minus: 1.2, plus: 0.3048 } } }],
      measureCount: 1,
      spots: [{ id: 2, p: [0, 0, 0], E: null, N: null, Z: null, x: 0, y: 0, z: 3.2004 }],
      spotCount: 1
    })
    const state = markupsState(st())
    expect(state.units).toBe('ft')
    expect(state.measures[0]).toEqual({ name: 'M1', x: 4.937, sides: { x: { minus: 3.937, plus: 1 } } })
    expect(state.spots[0]).toEqual({ name: 'C1', level: 3.2 })
  })
})
