// Audit A2 — the schedule-definition reader must not mistake what every JavaScript object
// inherits for a real key.
//
// `cleanField` (def.ts) accepts a core field when `key in CORE_LABELS`; `fonts.ts` uses
// `key in LEGACY` and `LEGACY[key ?? '']`. `in` and a plain index also find inherited members
// (`constructor`, `toString`, `valueOf`, `hasOwnProperty`, `isPrototypeOf`, `__proto__`).
// `parseScheduleDef` is the one gate for a `.schedule.json`, a saved setup, a project file,
// the port and the assistant's definitions.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CORE_KEYS,
  CORE_LABELS,
  defaultHeading,
  emptySchedule,
  parseScheduleDef,
  ScheduleImportError,
  type ScheduleDef,
} from '../../../src/schedule/schedule/def';
import { BODY_FONTS, fontStack, isBodyFont, normaliseFont } from '../../../src/schedule/schedule/fonts';

const INHERITED = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', '__proto__'] as const;

/** A definition with the given columns, built from emptySchedule's own shape. */
const defWith = (columns: unknown[]): Record<string, unknown> => ({ ...emptySchedule('A2'), columns });
const core = (key: string): { field: { kind: 'core'; key: string } } => ({ field: { kind: 'core', key } });

/** The same definition, through JSON.parse, so the input is what a file on disk gives. */
const viaJson = (columnsJson: string): unknown =>
  JSON.parse(`{"version":1,"name":"A2","entity":[],"columns":${columnsJson}}`) as unknown;

/** What parseScheduleDef throws for a definition with no usable column, read today. */
const refusal = ((): { cls: unknown; message: string } => {
  try {
    parseScheduleDef(defWith([core('nope')]));
  } catch (error) {
    return { cls: (error as object).constructor, message: (error as Error).message };
  }
  throw new Error('parseScheduleDef accepted an unknown core key — the baseline changed');
})();

const expectRefused = (input: unknown): void => {
  let thrown: unknown;
  try {
    parseScheduleDef(input);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ScheduleImportError);
  expect((thrown as object).constructor).toBe(refusal.cls);
  expect((thrown as Error).message).toBe(refusal.message);
};

describe('A2 — baseline read today', () => {
  it('an unknown core key alone is refused with "Schedule has no usable columns."', () => {
    expect(refusal.cls).toBe(ScheduleImportError);
    expect(refusal.message).toBe('Schedule has no usable columns.');
  });
});

describe('A2 — DEFECT: an inherited member is not a core field', () => {
  for (const name of INHERITED) {
    it(`"${name}" as the only column is refused like an unknown key (object literal)`, () => {
      expectRefused(defWith([core(name)]));
    });

    it(`"${name}" as the only column is refused like an unknown key (JSON.parse)`, () => {
      expectRefused(viaJson(`[{"field":{"kind":"core","key":${JSON.stringify(name)}}}]`));
    });

    it(`"${name}" beside one good column leaves only the good column (object literal)`, () => {
      const def = parseScheduleDef(defWith([core('name'), core(name)]));
      expect(def.columns).toHaveLength(1);
      expect(def.columns[0].field).toEqual({ kind: 'core', key: 'name' });
    });

    it(`"${name}" beside one good column leaves only the good column (JSON.parse)`, () => {
      const def = parseScheduleDef(
        viaJson(`[{"field":{"kind":"core","key":"name"}},{"field":{"kind":"core","key":${JSON.stringify(name)}}}]`),
      );
      expect(def.columns).toHaveLength(1);
      expect(def.columns[0].field).toEqual({ kind: 'core', key: 'name' });
    });
  }
});

describe('A2 — DEFECT: an inherited member is not a body font', () => {
  // Today's answers for an unknown name.
  const unknownNormalised = normaliseFont('nope');
  const unknownStack = fontStack('nope');

  it('baseline: an unknown font name normalises to "plex" and takes the first stack', () => {
    expect(unknownNormalised).toBe('plex');
    expect(unknownStack).toBe(BODY_FONTS[0].stack);
  });

  for (const name of INHERITED) {
    it(`isBodyFont("${name}") is false`, () => {
      expect(isBodyFont(name)).toBe(false);
    });

    it(`normaliseFont("${name}") is the unknown-name string`, () => {
      const v: unknown = normaliseFont(name);
      expect(typeof v).toBe('string');
      expect(v).toBe(unknownNormalised);
    });

    it(`fontStack("${name}") is the unknown-name string`, () => {
      const v: unknown = fontStack(name);
      expect(typeof v).toBe('string');
      expect(v).toBe(unknownStack);
    });
  }
});

describe('A2 — PIN: real keys keep working', () => {
  it('every CORE_KEYS key is accepted as a core column and gets its CORE_LABELS heading', () => {
    expect(CORE_KEYS.length).toBeGreaterThan(0);
    for (const key of CORE_KEYS) {
      const def: ScheduleDef = parseScheduleDef(defWith([core(key)]));
      expect(def.columns, key).toHaveLength(1);
      expect(def.columns[0].field, key).toEqual({ kind: 'core', key });
      expect(defaultHeading(def.columns[0].field, def), key).toBe(CORE_LABELS[key]);
    }
  });

  it('every BODY_FONTS key is a body font and normalises to itself', () => {
    for (const { key, stack } of BODY_FONTS) {
      expect(isBodyFont(key), key).toBe(true);
      expect(normaliseFont(key), key).toBe(key);
      expect(fontStack(key), key).toBe(stack);
    }
  });

  // LEGACY is not exported; these are the two names it maps in fonts.ts today.
  it('the legacy font names still normalise as today', () => {
    const georgia = BODY_FONTS.find((f) => f.key === 'georgia')!.stack;
    const plex = BODY_FONTS.find((f) => f.key === 'plex')!.stack;
    expect(isBodyFont('sans')).toBe(true);
    expect(isBodyFont('serif')).toBe(true);
    expect(normaliseFont('sans')).toBe('plex');
    expect(normaliseFont('serif')).toBe('georgia');
    expect(fontStack('sans')).toBe(plex);
    expect(fontStack('serif')).toBe(georgia);
  });

  it('undefined is "plex" and the first stack, as today', () => {
    expect(normaliseFont(undefined)).toBe('plex');
    expect(fontStack(undefined)).toBe(BODY_FONTS[0].stack);
    expect(BODY_FONTS[0].key).toBe('plex');
  });
});

describe('A2 — PIN: the compat corpus schedule files still parse', () => {
  const root = join(__dirname, '../../fixtures/compat');
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      return statSync(path).isDirectory() ? walk(path) : entry.endsWith('.schedule.json') ? [path] : [];
    });
  const files = walk(root);

  it('finds the corpus files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file.slice(root.length + 1)} parses and every core column is a CORE_KEYS key`, () => {
      const def = parseScheduleDef(JSON.parse(readFileSync(file, 'utf8')) as unknown);
      expect(def.columns.length).toBeGreaterThan(0);
      for (const col of def.columns) {
        if (col.field.kind === 'core') expect(CORE_KEYS).toContain(col.field.key);
      }
    });
  }
});
