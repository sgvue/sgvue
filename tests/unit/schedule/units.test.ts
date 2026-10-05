// What the file says its lengths are in, and what that means for the defaults.
//
// The scales and the SYSTEM are two different readings of the same unit assignment: the
// scales decide what a value means, the system decides what unit it is shown in. Both are
// read here so a change to one cannot quietly move the other.

import { describe, expect, it } from 'vitest';
import { imperialLengthSymbol, readUnitScales, unitSystemOf } from '../../../src/schedule/ifc/units';

/** An IfcConversionBasedUnit as web-ifc hands it over: a name and a resolved factor. */
const conversion = (unitType: string, name: string, factor: number) => ({
  UnitType: { value: unitType },
  Name: { value: name },
  ConversionFactor: { ValueComponent: { value: factor } },
});

/** An IfcSIUnit, optionally prefixed. */
const si = (unitType: string, name: string, prefix?: string) => ({
  UnitType: { value: unitType },
  Name: { value: name },
  ...(prefix ? { Prefix: { value: prefix } } : {}),
});

const FOOT = conversion('LENGTHUNIT', 'FOOT', 0.3048);
const INCH = conversion('LENGTHUNIT', 'inch', 0.0254);
const MILLIMETRE = si('LENGTHUNIT', 'METRE', 'MILLI');

describe('unitSystemOf', () => {
  it('reads a conversion-based foot or inch as imperial, whatever the case', () => {
    expect(unitSystemOf([FOOT])).toBe('imperial');
    expect(unitSystemOf([INCH])).toBe('imperial');
  });

  it('reads an SI length as metric', () => {
    expect(unitSystemOf([MILLIMETRE])).toBe('metric');
    expect(unitSystemOf([si('LENGTHUNIT', 'METRE')])).toBe('metric');
  });

  it('calls a file with no units at all metric', () => {
    expect(unitSystemOf([])).toBe('metric');
  });

  it('ignores a conversion-based unit that is not the LENGTH one', () => {
    // Square feet beside metres is one exporter's quirk, not a model to read in feet.
    const units = [MILLIMETRE, conversion('AREAUNIT', 'SQUARE FOOT', 0.09290304)];
    expect(unitSystemOf(units)).toBe('metric');
  });

  it('ignores DEGREE, which every metric file also declares this way', () => {
    expect(unitSystemOf([MILLIMETRE, conversion('PLANEANGLEUNIT', 'DEGREE', Math.PI / 180)]))
      .toBe('metric');
  });
});

describe('imperialLengthSymbol', () => {
  it('names the unit the file itself uses', () => {
    expect(imperialLengthSymbol([FOOT])).toBe('ft');
    expect(imperialLengthSymbol([INCH])).toBe('in');
  });

  it('reads through stray spaces around the name', () => {
    // An exporter that writes " foot " still drew the model in feet.
    const padded = conversion('LENGTHUNIT', ' foot ', 0.3048);
    expect(imperialLengthSymbol([padded])).toBe('ft');
    expect(unitSystemOf([padded])).toBe('imperial');
  });

  it('says nothing about an SI length — the SI prefix is read elsewhere', () => {
    expect(imperialLengthSymbol([MILLIMETRE])).toBeUndefined();
    expect(imperialLengthSymbol([])).toBeUndefined();
  });
});

describe('the scales are read the same way whatever the system', () => {
  it('still converts a foot file to metres', () => {
    // Detection must never change what a value MEANS: 3 ft is 0.9144 m either way.
    const scales = readUnitScales([FOOT], () => undefined);
    expect(scales.length).toBeCloseTo(0.3048, 6);
    expect(readUnitScales([MILLIMETRE], () => undefined).length).toBeCloseTo(1e-3, 9);
  });
});
