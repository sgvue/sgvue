// The unit types and tables the Schedules adapter (`adapter.ts`) reads units with. ifcTable's
// own IfcUnitAssignment reader (`readUnitScales`, `unitSystemOf`, `imperialLengthSymbol`) was
// never used by SGVue and was removed; `adapter.ts` reads the units itself (`scalesOf`).
//
// Each unit type carries its OWN scale — a model can be authored in millimetres for
// length while still reporting areas in m². Never assume one global factor.

import type { UnitKind } from './types';

export type UnitScales = Record<UnitKind, number>;

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

/** IFC measure type name (e.g. "IFCLENGTHMEASURE") → the dimension it carries. */
export function measureKind(typeName: string | undefined): UnitKind {
  if (!typeName) return 'none';
  return MEASURE_KIND[typeName.toUpperCase()] ?? 'none';
}

/**
 * The measures `measureKind` converts, by exact name — never a substring (2026-11-08):
 * `IfcMassPerLengthMeasure` is not a length, `IfcRotationalMassMeasure` not a mass and
 * `IfcCompoundPlaneAngleMeasure` not a plane angle. These are exactly the measures, across
 * IFC2X3, IFC4 and IFC4X3, whose unit type (`measureUnitType`, IfcOpenShell's
 * `get_measure_unit_type`) is one of the six named kinds. Every other measure is `none`:
 * converted only through a derived unit the file assigns (`adapter.ts`), else kept as written.
 */
const MEASURE_KIND: Readonly<Record<string, UnitKind>> = {
  IFCLENGTHMEASURE: 'length',
  IFCPOSITIVELENGTHMEASURE: 'length',
  IFCNONNEGATIVELENGTHMEASURE: 'length',
  IFCAREAMEASURE: 'area',
  IFCVOLUMEMEASURE: 'volume',
  IFCPLANEANGLEMEASURE: 'angle',
  IFCPOSITIVEPLANEANGLEMEASURE: 'angle',
  IFCMASSMEASURE: 'mass',
  IFCCOUNTMEASURE: 'count',
};

/**
 * IFC measure type → the `IfcUnitEnum` its unit is assigned under — IfcOpenShell's
 * `get_measure_unit_type`: `IfcThermalTransmittanceMeasure` → `THERMALTRANSMITTANCEUNIT`,
 * `IfcPositiveLengthMeasure` → `LENGTHUNIT`; `IfcNumericMeasure` → `USERDEFINED`. Any case in.
 */
export function measureUnitType(typeName: string): string {
  const n = typeName.toUpperCase();
  if (n === 'IFCNUMERICMEASURE') return 'USERDEFINED';
  return n
    .replace(/^IFC/, '')
    .replace(/MEASURE$/, '')
    .replace(/^NON/, '')
    .replace(/^(POSITIVE|NEGATIVE)/, '') + 'UNIT';
}
