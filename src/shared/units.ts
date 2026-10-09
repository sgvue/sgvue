/**
 * Units — the file's own unit assignment, and the display conversion the design does.
 *
 * Two separate jobs, deliberately in one module so there is a single unit vocabulary:
 *
 *  1. **Reading.** SI prefixes and measure kinds, used by `worker/index-builder.ts` to turn
 *     `IfcUnitAssignment` into `Units`. Values stay as authored; only the scale is recorded.
 *  2. **Display.** The design shows lengths in millimetres by default and metres when the
 *     measure card's unit toggle says `m` (`SGVue.dc.html:2060–2063`), and changes only that
 *     card's list with it. Since 2026-10-09 (owner-requested: *"Why model units not
 *     automatically using the units provided by model? in other countries are feets"*) the
 *     toggle has a third unit, `ft`, the app starts in the boot model's own (`displayUnitOf`),
 *     and every length, elevation, coordinate, area and volume the app itself computes follows
 *     it — one rule, below, with `mm` byte for byte what every readout printed before.
 *
 * Geometry never passes through here: web-ifc already returns metres.
 */
import {
  f3,
  FOOT,
  fixed3,
  ftIn,
  mmPlain,
  mmTxt,
  mmv,
  signedF3,
  signedFtIn,
  signedMm,
  thin,
  THIN_SPACE
} from './fmt'
import type { PropValue, Units } from './model-index.types'

/** `IfcSIPrefix` → multiplier. */
export const SI_PREFIX: Readonly<Record<string, number>> = {
  EXA: 1e18,
  PETA: 1e15,
  TERA: 1e12,
  GIGA: 1e9,
  MEGA: 1e6,
  KILO: 1e3,
  HECTO: 1e2,
  DECA: 1e1,
  DECI: 1e-1,
  CENTI: 1e-2,
  MILLI: 1e-3,
  MICRO: 1e-6,
  NANO: 1e-9,
  PICO: 1e-12,
  FEMTO: 1e-15,
  ATTO: 1e-18
}

/**
 * How a prefix applies to a unit name: squared for areas, cubed for volumes.
 * `MILLI` + `SQUARE_METRE` is a millionth of a square metre, not a thousandth.
 */
export function prefixPower(unitName: string): number {
  if (unitName.startsWith('SQUARE_')) return 2
  if (unitName.startsWith('CUBIC_')) return 3
  return 1
}

/** SI units per file unit for an `IfcSIUnit`, e.g. `MILLI` `METRE` → 0.001. */
export function siFactor(unitName: string, prefix: string): number {
  if (!prefix) return 1
  const base = SI_PREFIX[prefix]
  if (base === undefined) return 1
  return Math.pow(base, prefixPower(unitName))
}

/**
 * The US survey foot, exactly: 1200 / 3937 m. The international foot is 0.3048 m — `FOOT` in
 * `fmt.ts`, which the `ft` display unit is written in.
 */
export const US_SURVEY_FOOT = 1200 / 3937

/**
 * How near a file's factor has to be to one of the feet above to be that foot, relatively
 * (2026-10-09). The two feet differ by 2e-6, so 1e-7 still tells them apart, and it takes an
 * exporter's rounded `0.30480061` for the US survey foot, which 1e-9 did not.
 */
export const FOOT_FACTOR_TOLERANCE = 1e-7

/** Length units by label, with every character but a letter taken out. */
const LENGTH_LABEL: Readonly<Record<string, number>> = {
  M: 1,
  MM: 1e-3,
  CM: 1e-2,
  DM: 1e-1,
  KM: 1e3,
  FT: 0.3048,
  FOOT: 0.3048,
  INTERNATIONALFOOT: 0.3048,
  USFT: US_SURVEY_FOOT,
  FTUS: US_SURVEY_FOOT,
  USFOOT: US_SURVEY_FOOT,
  FOOTUS: US_SURVEY_FOOT,
  SURVEYFOOT: US_SURVEY_FOOT,
  USSURVEYFOOT: US_SURVEY_FOOT
}

/**
 * Metres per one of a length unit that is only **named** — IFC2X3's `ePset_ProjectedCRS`
 * `MapUnit`, which a property set can hold only as text: `METRE`, `MILLIMETRE`, `FOOT`,
 * `US survey foot`, `.METRE.`, … (2026-10-08). `undefined` for a label this does not know: the
 * caller decides what that means, and says so.
 */
export function lengthUnitFromLabel(label: string): number | undefined {
  const key = label
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .replace(/FEET/g, 'FOOT')
    .replace(/(METRE|METER)S$/, '$1')
  if (Object.hasOwn(LENGTH_LABEL, key)) return LENGTH_LABEL[key]
  const si = /^([A-Z]*?)(METRE|METER)$/.exec(key)
  if (!si) return undefined
  return si[1] ? (Object.hasOwn(SI_PREFIX, si[1]) ? SI_PREFIX[si[1]] : undefined) : 1
}

/** Units with nothing read from the file yet: metres, m², m³, radians. */
export const IDENTITY_UNITS: Units = {
  byType: {},
  length: 1,
  area: 1,
  volume: 1,
  angle: 1
}

/**
 * The measure types whose numeric values scale with a unit we resolve. Anything else
 * (thermal transmittance, pressure, counts, …) is reported exactly as authored.
 */
const MEASURE_UNIT_TYPE: Readonly<Record<string, keyof Omit<Units, 'byType'>>> = {
  IFCLENGTHMEASURE: 'length',
  IFCPOSITIVELENGTHMEASURE: 'length',
  IFCNONNEGATIVELENGTHMEASURE: 'length',
  IFCAREAMEASURE: 'area',
  IFCVOLUMEMEASURE: 'volume',
  IFCPLANEANGLEMEASURE: 'angle',
  IFCPOSITIVEPLANEANGLEMEASURE: 'angle'
}

/** SI value of an authored measure, or `null` when its unit is not one we resolve. */
export function toSI(value: number, measure: string, units: Units): number | null {
  const kind = MEASURE_UNIT_TYPE[measure.toUpperCase()]
  if (!kind) return null
  return value * units[kind]
}

/** The unit kind a measure type belongs to, or `null` when it is not one we resolve. */
export const measureKind = (measure: string): UnitKind | null =>
  MEASURE_UNIT_TYPE[measure.toUpperCase()] ?? null

/* ────────────────────────────── naming the file's own unit ────────────────────────────── */

export type UnitKind = keyof Omit<Units, 'byType'>

/** `IfcUnitAssignment`'s own `unitType` for each kind. */
const UNIT_TYPE: Readonly<Record<UnitKind, string>> = {
  length: 'LENGTHUNIT',
  area: 'AREAUNIT',
  volume: 'VOLUMEUNIT',
  angle: 'PLANEANGLEUNIT'
}

/** `IfcSIPrefix` → the symbol that is written in front of the unit. */
const PREFIX_SYMBOL: Readonly<Record<string, string>> = {
  EXA: 'E',
  PETA: 'P',
  TERA: 'T',
  GIGA: 'G',
  MEGA: 'M',
  KILO: 'k',
  HECTO: 'h',
  DECA: 'da',
  DECI: 'd',
  CENTI: 'c',
  MILLI: 'm',
  MICRO: 'µ',
  NANO: 'n',
  PICO: 'p',
  FEMTO: 'f',
  ATTO: 'a'
}

/** `IfcSIUnitName` → its symbol, for the three the viewer ever totals. */
const SI_SYMBOL: Readonly<Record<string, string>> = {
  METRE: 'm',
  SQUARE_METRE: 'm²',
  CUBIC_METRE: 'm³',
  RADIAN: 'rad'
}

/**
 * How the file's own unit for one kind is written — `mm`, `m²`, `ft`, `°` — or **`null` when
 * the file does not say**.
 *
 * It exists so a total can be reported in the unit it is actually in. The index stores every
 * quantity **as authored** (`worker/sql-schema.ts`), and a Revit export routinely writes
 * lengths in millimetres beside areas in square metres — so a label taken from `length` and
 * applied to an area, or a constant `m²` written into a sentence, is wrong on a real file.
 * `null` is reported as no unit at all rather than as a guess.
 */
export function unitLabel(units: Units, kind: UnitKind): string | null {
  const entry = units.byType[UNIT_TYPE[kind]]
  if (!entry) return null
  if (entry.entity === 'IfcSIUnit') {
    const base = SI_SYMBOL[entry.name]
    if (!base) return null
    if (!entry.prefix) return base
    const symbol = PREFIX_SYMBOL[entry.prefix]
    // The prefix is written once and the power stays on the unit: MILLI + SQUARE_METRE is mm².
    return symbol ? symbol + base : null
  }
  // A conversion-based or derived unit is named by the file. An imperial length, area or volume
  // is written with its own symbol (2026-10-09: a model in feet totals in `ft²`, not in
  // "square foot"); any other name — `DEGREE` among them — as the file wrote it.
  if (!entry.name) return null
  return IMPERIAL_SYMBOL[unitWords(entry.name)] ?? entry.name.toLowerCase()
}

/** A unit's name as words: `SQUARE_FOOT`, `square foot` and `Square-Foot` are `SQUARE FOOT`. */
const unitWords = (name: string): string =>
  name
    .toUpperCase()
    .replace(/[^A-Z]+/g, ' ')
    .trim()
    .replace(/\bFEET\b/g, 'FOOT')
    .replace(/\bINCHES\b/g, 'INCH')

/** The imperial units an exporter names, by `unitWords`, and the symbol each is written with. */
const IMPERIAL_SYMBOL: Readonly<Record<string, string>> = {
  FOOT: 'ft',
  INCH: 'in',
  YARD: 'yd',
  MILE: 'mi',
  'SQUARE FOOT': 'ft²',
  'SQUARE INCH': 'in²',
  'SQUARE YARD': 'yd²',
  'CUBIC FOOT': 'ft³',
  'CUBIC INCH': 'in³',
  'CUBIC YARD': 'yd³'
}

/* ────────────────────────────── display ────────────────────────────── */

/**
 * The design's unit toggle — `mm` and `m` (`SGVue.dc.html:851`, `:2060`) — and, since
 * 2026-10-09 (owner-requested), `ft`: feet and inches. The order is the toggle's.
 */
export const DISPLAY_UNITS = ['mm', 'm', 'ft'] as const
export type DisplayUnit = (typeof DISPLAY_UNITS)[number]

/** The design's own default, `SGVue.dc.html:851` — and what a boot model that names no unit starts in. */
export const DEFAULT_DISPLAY_UNIT: DisplayUnit = 'mm'

export const isDisplayUnit = (v: unknown): v is DisplayUnit =>
  (DISPLAY_UNITS as readonly unknown[]).includes(v)

/** Metres per foot, inch, yard and mile — US survey foot included — the lengths that mean `ft`. */
const IMPERIAL_METRES = [FOOT, US_SURVEY_FOOT, 0.0254, 0.9144, 1609.344]

/**
 * The display unit a model's own length unit starts the app in (2026-10-09, owner-requested:
 * *"Starts in the first model's unit"*): a millimetre or a centimetre — anything shorter than a
 * metre — `mm`; a metre or longer `m`; a foot or an inch, which IFC writes as an
 * `IfcConversionBasedUnit`, `ft`. `null` when the file states no length unit that resolves:
 * the caller then keeps the design's own default.
 */
export function displayUnitOf(units: Units): DisplayUnit | null {
  const lu = units.byType.LENGTHUNIT
  if (!lu) return null
  const f = lu.factor
  if (lu.entity === 'IfcConversionBasedUnit') {
    // By name — FOOT, INCH, US SURVEY FOOT … — or, for a name nothing here knows, by its factor.
    if (/\b(FOOT|INCH|YARD|MILE)\b/.test(unitWords(lu.name))) return 'ft'
    if (f !== undefined && IMPERIAL_METRES.some((m) => Math.abs(f / m - 1) < FOOT_FACTOR_TOLERANCE)) return 'ft'
  }
  if (f === undefined || !(f > 0)) return null
  return f < 1 ? 'mm' : 'm'
}

/*
 * **The one rule** (2026-10-09). Every readout keeps its own style — its grouping, its spacing,
 * its decimals, where it writes the unit — and only its quantity and unit follow the display
 * unit:
 *
 *  · `mm` — exactly what each readout printed before, byte for byte;
 *  · `m` — what printed millimetres prints metres to three decimals, as the Markups card's `m`
 *    always did; what already printed metres (a coordinate, the spot tag's level) is unchanged;
 *  · `ft` — a length, a dimension or an elevation in feet and inches to the nearest 1/16"
 *    (`ftIn`); a coordinate in decimal feet to three decimals; an area or a volume the app
 *    computes in ft² / ft³. The international foot, 0.3048 m.
 *
 * Values read from the file — a property, a quantity — are never converted: they are as
 * authored, in the file's own unit.
 */

/**
 * A length, plain space before its unit (`viewer-core.js:9`'s `fmtMM`, the property card's
 * `mmv`): `2 400 mm` · `2.400 m` · `7'-10 1/2"`. The laser's labels, the box's size and height.
 */
export function formatLength(metres: number, unit: DisplayUnit): string {
  return unit === 'ft' ? ftIn(metres) : unit === 'm' ? fixed3(metres) + ' m' : mmv(metres)
}

/** A dimension label, a **thin** space before its unit (`mmTxt`): grid and selection dimensions. */
export function formatDim(metres: number, unit: DisplayUnit): string {
  return unit === 'ft' ? ftIn(metres) : unit === 'm' ? fixed3(metres) + THIN_SPACE + 'm' : mmTxt(metres)
}

/** A length with no unit (`mmPlain`), where a reading writes its unit once — `lengthSuffix`. */
export function lengthNumber(metres: number, unit: DisplayUnit): string {
  return unit === 'ft' ? ftIn(metres) : unit === 'm' ? fixed3(metres) : mmPlain(metres)
}

/** What follows such numbers: ` mm`, ` m` — and nothing for feet and inches, which say their own. */
export const lengthSuffix = (unit: DisplayUnit): string => (unit === 'ft' ? '' : ' ' + unit)

/** An elevation with its sign (`signedMm`): `+4 000` · `+4.000` · `+13'-1 1/2"`. */
export function formatElevation(metres: number, unit: DisplayUnit): string {
  return unit === 'ft' ? signedFtIn(metres) : unit === 'm' ? signedF3(metres) : signedMm(metres)
}

/**
 * A coordinate held in metres, as the number a readout prints: metres in `mm` and `m` — a
 * coordinate always printed metres — and decimal feet in `ft`.
 */
export const coordIn = (metres: number, unit: DisplayUnit): number =>
  unit === 'ft' ? metres / FOOT : metres

/** The unit a coordinate is printed in: `m`, or `ft`. */
export const coordUnit = (unit: DisplayUnit): 'm' | 'ft' => (unit === 'ft' ? 'ft' : 'm')

/** An area the app computes, held in m², in the display unit's square: m², or ft². */
export const areaIn = (m2: number, unit: DisplayUnit): number => (unit === 'ft' ? m2 / (FOOT * FOOT) : m2)
export const areaUnit = (unit: DisplayUnit): string => (unit === 'ft' ? 'ft²' : 'm²')

/** A volume the app computes, held in m³, in the display unit's cube: m³, or ft³. */
export const volumeIn = (m3: number, unit: DisplayUnit): number =>
  unit === 'ft' ? m3 / (FOOT * FOOT * FOOT) : m3
export const volumeUnit = (unit: DisplayUnit): string => (unit === 'ft' ? 'ft³' : 'm³')

/** `coordIn`, printed as `f3` prints it: thin-space grouped, three decimals. */
export const coord3 = (metres: number, unit: DisplayUnit): string => f3(coordIn(metres, unit))

/**
 * A property or quantity value for display. Numbers whose measure type resolves to a
 * length are converted with the model's own unit assignment; everything else keeps the
 * authored number, because the file's unit is the one the reader expects to see.
 */
export function formatValue(
  value: PropValue,
  measure: string | undefined,
  units: Units,
  unit: DisplayUnit
): string {
  if (Array.isArray(value)) return value.map((v) => formatValue(v, measure, units, unit)).join(', ')
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (typeof value !== 'number') return String(value)
  if (measure && MEASURE_UNIT_TYPE[measure.toUpperCase()] === 'length') {
    return formatLength(value * units.length, unit)
  }
  return thin(value)
}
