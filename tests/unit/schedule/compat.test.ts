// V7 from PLAN.md: a .schedule.json written by the pre-cut build must still load.
//
// The fixture was captured BEFORE combined parameters and the typeMark/objectType/expressId
// core fields were removed. typeMark, expressId and the combined column are still gone and
// drop quietly; objectType came back [2026-09-02] and loads again. Everything else survives.

import { describe, expect, it } from 'vitest';
import { BODY_FONTS, fontStack } from '../../../src/schedule/schedule/fonts';
import legacy from './fixtures/legacy-v1.schedule.json';
import { parseScheduleDef } from '../../../src/schedule/schedule/def';

describe('legacy v1 schedule import', () => {
  const def = parseScheduleDef(legacy);

  it('loads without error', () => {
    expect(def.name).toBe('Legacy Door Schedule');
    expect(def.entity).toEqual(['IfcDoor']);
  });

  it('drops typeMark, expressId and combined, keeps objectType and the rest in order', () => {
    // was: storey, typeMark, objectType, expressId, FireRating, combined, formula
    expect(def.columns.map((c) => c.field)).toEqual([
      { kind: 'core', key: 'storey' },
      { kind: 'core', key: 'objectType' },
      { kind: 'prop', pset: '*', prop: 'FireRating' },
      { kind: 'formula', id: 'c1' },
    ]);
    expect(def.columns[2].total).toBe('count');
    expect(def.columns[3].format?.decimals).toBe(2);
  });

  it('keeps the formula, ignoring the removed byLevel key', () => {
    expect(def.calculated?.[0]?.formula).toBe('FireRating * 2');
  });

  it('carries no combined parameters', () => {
    expect((def as unknown as Record<string, unknown>).combined).toBeUndefined();
  });

  it('keeps filters, sorting and totals', () => {
    expect(def.filters).toHaveLength(1);
    expect(def.sort).toHaveLength(1);
    expect(def.grandTotal).toBe(true);
  });

  it('sanitises appearance, ignoring the removed headerItalic key', () => {
    expect(def.appearance?.fontSize).toBe(13);
    expect((def.appearance as Record<string, unknown>).headerItalic).toBeUndefined();
  });

});

describe('the retired wrapText key loads and drops', () => {
  // wrapText was an appearance switch for one day; wrapping now follows the column width,
  // so the key is gone. Removing it needed no version bump because cleanAppearance builds an
  // explicit object: a key it does not name is simply not copied across. This is the same
  // forward-leniency that lets a file from a NEWER build open here — proven from the other
  // direction, on a key that really did exist.
  it('parses a save carrying it, without the key and still at version 1', () => {
    const def = parseScheduleDef({
      version: 1, name: 'Wrapped', entity: ['IfcWall'],
      columns: [{ field: { kind: 'core', key: 'name' } }],
      filters: [], sort: [], itemize: true, grandTotal: false,
      appearance: { wrapText: true },
    });
    expect(def.version).toBe(1);
    expect(def.appearance).toBeDefined();
    expect('wrapText' in (def.appearance as object)).toBe(false);
  });
});

describe('the body-font list grew without breaking old saves', () => {
  // bodyFont used to be 'sans' | 'serif' | 'mono'. Widening it must not reject a schedule
  // saved before the picker grew — the save format is frozen on that promise.
  it('accepts the three legacy names and maps them to a real stack', () => {
    for (const [legacy, expect_] of [['sans', 'IBM Plex Sans'], ['serif', 'Georgia'], ['mono', 'Mono']] as const) {
      const def = parseScheduleDef({
        version: 1, name: 'Old', entity: ['IfcDoor'],
        columns: [{ field: { kind: 'core', key: 'name' } }],
        filters: [], sort: [], itemize: true, grandTotal: false,
        appearance: { bodyFont: legacy },
      });
      expect(def.appearance?.bodyFont, `${legacy} survives import`).toBe(legacy);
      expect(fontStack(legacy), `${legacy} resolves`).toContain(expect_);
    }
  });

  it('falls back rather than throwing on a font name it does not know', () => {
    const def = parseScheduleDef({
      version: 1, name: 'Future', entity: ['IfcDoor'],
      columns: [{ field: { kind: 'core', key: 'name' } }],
      filters: [], sort: [], itemize: true, grandTotal: false,
      appearance: { bodyFont: 'some-font-from-2030' },
    });
    expect(def.appearance?.bodyFont).toBe('plex');
    expect(fontStack(def.appearance?.bodyFont)).toContain('IBM Plex Sans');
  });

  it('every recommended font is listed before the rest', () => {
    const firstOther = BODY_FONTS.findIndex((f) => !f.recommended);
    expect(BODY_FONTS.slice(0, firstOther).every((f) => f.recommended)).toBe(true);
    expect(BODY_FONTS.slice(firstOther).every((f) => !f.recommended)).toBe(true);
  });

  it('every stack ends in a generic family, so a missing font degrades quietly', () => {
    for (const f of BODY_FONTS) {
      expect(f.stack, `${f.key} ends generic`).toMatch(/(sans-serif|serif|monospace)\s*$/);
    }
  });
});
