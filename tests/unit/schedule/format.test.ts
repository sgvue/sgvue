import { describe, expect, it } from 'vitest';
import type { UnitKind } from '../../../src/schedule/ifc/types';
import type { UnitFormat } from '../../../src/schedule/schedule/def';
import {
  defaultDecimals, defaultUnit, displayNumber, formatCell, formatNumber, fromDisplay, toDisplay,
} from '../../../src/schedule/schedule/format';

describe('unit conversion', () => {
  it('converts SI metres to the display unit', () => {
    expect(toDisplay(0.9, 'length', 'mm')).toBeCloseTo(900);
    expect(toDisplay(0.9, 'length', 'm')).toBeCloseTo(0.9);
    expect(toDisplay(1, 'length', 'ft')).toBeCloseTo(3.28084, 4);
    expect(toDisplay(2.5, 'area', 'm²')).toBeCloseTo(2.5);
    expect(toDisplay(1, 'volume', 'L')).toBeCloseTo(1000);
    expect(toDisplay(Math.PI, 'angle', '°')).toBeCloseTo(180);
  });

  it('round-trips through fromDisplay', () => {
    for (const [kind, unit, v] of [['length', 'mm', 1234], ['area', 'ft²', 50], ['mass', 'lb', 10]] as const) {
      expect(toDisplay(fromDisplay(v, kind, unit), kind, unit)).toBeCloseTo(v, 6);
    }
  });

  it('passes through dimensionless values untouched', () => {
    expect(toDisplay(42, 'none', 'mm')).toBe(42);
    expect(toDisplay(42, 'count')).toBe(42);
  });

  it('falls back to the raw value for an unknown unit', () => {
    expect(toDisplay(0.9, 'length', 'furlong')).toBe(0.9);
  });
});

describe('formatNumber', () => {
  it('applies the default unit and decimals per dimension', () => {
    // a 900 mm door, stored as 0.9 m
    expect(formatNumber(0.9, 'length')).toBe('900');
    expect(formatNumber(2.5, 'area')).toBe('2.50');
  });

  it('honours decimals, grouping and symbol', () => {
    expect(formatNumber(12.3456, 'length', { display: 'm', decimals: 3 })).toBe('12.346');
    expect(formatNumber(12.3456, 'length', { display: 'mm', decimals: 0 })).toBe('12,346');
    expect(formatNumber(12.3456, 'length', { display: 'mm', decimals: 0, thousands: false })).toBe('12346');
    expect(formatNumber(0.9, 'length', { display: 'mm', decimals: 0, showSymbol: true })).toBe('900 mm');
  });

  it('never renders negative zero', () => {
    expect(formatNumber(-0.0001, 'length', { display: 'm', decimals: 2 })).toBe('0.00');
  });

  it('suppresses zero when asked', () => {
    expect(formatNumber(0, 'length', { suppressZero: true })).toBe('');
    expect(formatNumber(0, 'length')).toBe('0');
  });

  it('adds prefix and suffix', () => {
    expect(formatNumber(5, 'none', { decimals: 0, prefix: '$', suffix: ' ea' })).toBe('$5 ea');
  });
});

describe('displayNumber', () => {
  // A workbook holds this number where the schedule prints that text. They are the same
  // figure or the export is a lie, so both come out of one rounding.
  const both = (v: number, kind: UnitKind | undefined, f: UnitFormat = {}) =>
    [displayNumber(v, kind, f), formatNumber(v, kind, f)];

  it('is the figure the text shows', () => {
    expect(both(0.9, 'length', { display: 'mm', decimals: 0 })).toEqual([900, '900']);
    expect(both(12.3456, 'length', { display: 'mm', decimals: 0 })).toEqual([12346, '12,346']);
    expect(both(-2.5, 'length', { display: 'm', decimals: 2 })).toEqual([-2.5, '-2.50']);
    // Rounded to the decimals SHOWN — the text says 0.00, so the number is 0, not -0.004.
    expect(both(-0.004, 'length', { display: 'm', decimals: 2 })).toEqual([0, '0.00']);
    // Grouping, symbol and affixes decorate the text; the number is untouched by them.
    expect(both(0.9, 'length', { display: 'mm', decimals: 0, showSymbol: true, prefix: '~' }))
      .toEqual([900, '~900 mm']);
  });

  it('is null wherever the text is blank', () => {
    expect(both(Infinity, 'length')).toEqual([null, '']);
    expect(both(NaN, 'none')).toEqual([null, '']);
    expect(both(0, 'length', { suppressZero: true })).toEqual([null, '']);
  });
});

describe('formatCell', () => {
  it('renders booleans in the chosen style', () => {
    expect(formatCell({ v: true })).toBe('Yes');
    expect(formatCell({ v: false })).toBe('No');
    expect(formatCell({ v: true }, { boolStyle: 'TRUE/FALSE' })).toBe('TRUE');
    expect(formatCell({ v: false }, { boolStyle: 'Y/N' })).toBe('N');
  });

  it('renders missing values as blank, not "undefined"', () => {
    expect(formatCell(undefined)).toBe('');
    expect(formatCell({ v: '' })).toBe('');
  });

  it('converts a length cell using its own dimension', () => {
    expect(formatCell({ v: 1.1, k: 'length' }, { display: 'mm', decimals: 0 })).toBe('1,100');
  });

  it('leaves text alone', () => {
    expect(formatCell({ v: '1100x2400 (2HR) Metal' })).toBe('1100x2400 (2HR) Metal');
  });
});

describe('defaults follow the system the model was authored in', () => {
  it('reads a metric model in mm, m² and m³ — unchanged', () => {
    expect(defaultUnit('length')).toBe('mm');
    expect(defaultUnit('area')).toBe('m²');
    expect(defaultUnit('volume')).toBe('m³');
    expect(defaultUnit('mass')).toBe('kg');
    expect(defaultUnit('angle')).toBe('°');
    expect(defaultDecimals('length')).toBe(0);
    expect(defaultDecimals('area')).toBe(2);
  });

  it('reads an imperial model in ft, ft² and ft³', () => {
    expect(defaultUnit('length', 'imperial')).toBe('ft');
    expect(defaultUnit('area', 'imperial')).toBe('ft²');
    expect(defaultUnit('volume', 'imperial')).toBe('ft³');
    expect(defaultUnit('mass', 'imperial')).toBe('lb');
    // An angle is degrees in both systems.
    expect(defaultUnit('angle', 'imperial')).toBe('°');
  });

  it('gives a foot the decimals a millimetre does not need', () => {
    expect(defaultDecimals('length', 'imperial')).toBe(2);
    expect(defaultDecimals('area', 'imperial')).toBe(2);
    expect(defaultDecimals('volume', 'imperial')).toBe(2);
    expect(defaultDecimals('angle', 'imperial')).toBe(1);
    expect(defaultDecimals('count', 'imperial')).toBe(0);
  });

  it('offers every unit whatever the system — the default is a default, not a limit', () => {
    expect(defaultUnit('length', 'metric')).toBe('mm');
    expect(defaultUnit('count', 'imperial')).toBe('');
  });

  it('keeps its OWN fallback metric, so a saved schedule never shifts units', () => {
    // A column with no `display` is a saved or hand-written one. It renders in mm on an
    // imperial model exactly as it did on the metric one it was saved against.
    expect(formatNumber(0.9144, 'length')).toBe('914');
    expect(toDisplay(0.9144, 'length')).toBeCloseTo(914.4, 6);
  });
});
