/**
 * Units — the file's own unit assignment, and the display conversion the design does.
 *
 * Two separate jobs, deliberately in one module so there is a single unit vocabulary:
 *
 *  1. **Reading.** SI prefixes and measure kinds, used by `worker/index-builder.ts` to turn
 *     `IfcUnitAssignment` into `Units`. Values stay as authored; only the scale is recorded.
 *  2. **Display.** The design shows lengths in millimetres by default and metres when the
 *     measure card's unit toggle says `m` (`SGVue.dc.html:2060–2063`). Nothing else in the
 *     design is unit-switchable.
 *
 * Geometry never passes through here: web-ifc already returns metres.
 */
import { fixed3, mmv, thin } from './fmt'
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
  // A conversion-based or derived unit is named by the file; `DEGREE` and `FOOT` are the
  // common ones and neither has an SI symbol to compose.
  return entry.name ? entry.name.toLowerCase() : null
}

/* ────────────────────────────── display ────────────────────────────── */

/** The design's unit toggle. Default `mm` (`SGVue.dc.html:851`). */
export type DisplayUnit = 'mm' | 'm'

/**
 * A length in metres, shown the way the design shows it:
 * `mm` → `"2 400 mm"`, `m` → `"2.400 m"` (`SGVue.dc.html:2063`).
 */
export function formatLength(metres: number, unit: DisplayUnit): string {
  return unit === 'm' ? fixed3(metres) + ' m' : mmv(metres)
}

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
