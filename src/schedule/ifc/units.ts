// Reads IfcUnitAssignment and returns the factor that converts each measure kind
// to SI base units (m, m², m³, rad, kg).
//
// Each unit type carries its OWN scale — a model can be authored in millimetres for
// length while still reporting areas in m². Never assume one global factor.

import type { UnitKind } from './types';

const SI_PREFIX: Record<string, number> = {
  EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 1e1,
  DECI: 1e-1, CENTI: 1e-2, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9, PICO: 1e-12,
  FEMTO: 1e-15, ATTO: 1e-18,
};

/** UnitType string → our UnitKind, plus the exponent the prefix is raised to. */
const UNIT_TYPE: Record<string, { kind: UnitKind; exp: number }> = {
  LENGTHUNIT: { kind: 'length', exp: 1 },
  AREAUNIT: { kind: 'area', exp: 2 },
  VOLUMEUNIT: { kind: 'volume', exp: 3 },
  PLANEANGLEUNIT: { kind: 'angle', exp: 1 },
  MASSUNIT: { kind: 'mass', exp: 1 },
};

export type UnitScales = Record<UnitKind, number>;

export function defaultScales(): UnitScales {
  return { length: 1, area: 1, volume: 1, angle: 1, mass: 1, count: 1, none: 1 };
}

/**
 * @param units  the resolved IfcUnitAssignment.Units lines
 * @param resolve  fetches a line by express id (for IfcConversionBasedUnit factors)
 */
export function readUnitScales(units: any[], resolve: (id: number) => any): UnitScales {
  const scales = defaultScales();
  for (const u of units) {
    if (!u) continue;
    const typeName: string | undefined = u.UnitType?.value;
    const hit = typeName ? UNIT_TYPE[typeName] : undefined;
    if (!hit) continue;

    if (u.Prefix !== undefined || u.Name?.value) {
      // IfcSIUnit: metre/square metre/... optionally with an SI prefix.
      const prefix = u.Prefix?.value ? SI_PREFIX[u.Prefix.value] : undefined;
      if (prefix !== undefined) {
        scales[hit.kind] = Math.pow(prefix, hit.exp);
        continue;
      }
      if (u.Name?.value === 'RADIAN') { scales.angle = 1; continue; }
      if (u.Name?.value === 'GRAM') { scales.mass = 1e-3; continue; }
      // plain SI unit with no prefix — already base
      scales[hit.kind] = 1;
    }

    // IfcConversionBasedUnit: degrees, feet, inches ... ConversionFactor is an
    // IfcMeasureWithUnit whose ValueComponent is the multiplier to the SI unit.
    if (u.ConversionFactor) {
      const mwu = typeof u.ConversionFactor === 'object' && 'value' in u.ConversionFactor
        ? resolve(u.ConversionFactor.value)
        : u.ConversionFactor;
      const factor = mwu?.ValueComponent?.value;
      if (typeof factor === 'number' && factor > 0) scales[hit.kind] = factor;
      else if (u.Name?.value === 'DEGREE') scales.angle = Math.PI / 180;
    }
  }
  return scales;
}

/** Which system of units the file was authored in — what new columns should default to. */
export type UnitSystem = 'metric' | 'imperial';

/**
 * Conversion-based length units that mean the file was drawn in feet and inches, and the
 * symbol each one reads as. Revit writes FOOT (or INCH); YARD and MILE complete the set of
 * imperial lengths IFC names, so a site model in yards is not mistaken for a metric one.
 */
export const IMPERIAL_LENGTH: Record<string, string> = {
  INCH: 'in', FOOT: 'ft', YARD: 'yd', MILE: 'mi',
};

/**
 * The symbol an imperial length unit displays with, or undefined for anything else — an
 * IfcSIUnit keeps its SI prefix symbol, which `extract.ts` owns. Only an
 * IfcConversionBasedUnit counts, and it is recognised by carrying a ConversionFactor:
 * no SI unit is ever named FOOT, but requiring the factor is what makes this the same
 * test `readUnitScales` applies when it scales the values.
 */
export function imperialLengthSymbol(units: any[]): string | undefined {
  const lu = units.find((u) => u?.UnitType?.value === 'LENGTHUNIT');
  if (!lu?.ConversionFactor) return undefined;
  return IMPERIAL_LENGTH[String(lu.Name?.value ?? '').trim().toUpperCase()];
}

/**
 * Imperial only when LENGTH itself is a conversion-based foot or inch. An area declared in
 * square feet beside metres is one exporter's quirk, not a model anyone expects to read in
 * feet — and a file that declares no units at all is metric, which is what IFC assumes.
 *
 * @param units  the resolved IfcUnitAssignment.Units lines — the same list readUnitScales takes
 */
export function unitSystemOf(units: any[]): UnitSystem {
  return imperialLengthSymbol(units) ? 'imperial' : 'metric';
}

/** IFC measure type name (e.g. "IFCLENGTHMEASURE") → the dimension it carries. */
export function measureKind(typeName: string | undefined): UnitKind {
  if (!typeName) return 'none';
  const n = typeName.toUpperCase();
  if (n.includes('LENGTHMEASURE')) return 'length';
  if (n.includes('AREAMEASURE')) return 'area';
  if (n.includes('VOLUMEMEASURE')) return 'volume';
  if (n.includes('PLANEANGLEMEASURE')) return 'angle';
  if (n.includes('MASSMEASURE')) return 'mass';
  if (n.includes('COUNTMEASURE')) return 'count';
  return 'none';
}
