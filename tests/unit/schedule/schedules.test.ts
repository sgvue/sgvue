// The save rule — ported from ifcTable's `tests/schedules.test.ts` with the Schedules window's
// saved setups (2026-09-25, phase 2). The three download-name cases (`exportName`) came back
// with phase 4's export. v1.5.0, phase 3: the cap refuses rather than dropping the oldest
// (ifcTable 2026-11-07), and the panel these once drew is the Templates library
// (tests/unit/schedule/library.test.ts).
//
// Save used to overwrite whatever entry had the same name — and since picking a category
// always names the schedule "Door Schedule", a user could keep exactly one setup per IFC
// class and lost the others without being told. These prove the replacement rule: a save
// replaces only the entry it was loaded from, and every other collision gets a number.

import { beforeEach, describe, expect, it } from 'vitest';
import { StoreBuilder, type ModelStore } from '../../../src/schedule/ifc/store';
import type { Cell, ElemCore, ModelMeta } from '../../../src/schedule/ifc/types';
import { emptySchedule, type Column, type ScheduleDef } from '../../../src/schedule/schedule/def';
import { state as blankState, type AppState } from '../../../src/renderer/schedule-ui/state';
import { renderLibrary } from '../../../src/renderer/schedule-ui/overlays/library';
import { EXPORT_NAME_MAX, exportName } from '../../../src/renderer/schedule-ui/dom';
import { ExportSaveRequest } from '../../../src/shared/ipc-contract';
import {
  CAP, deleteSchedule, duplicateSchedule, FULL_MESSAGE, isFull, listSaved, refusal, renameSchedule,
  saveSchedule, SAVED_KEY, STORAGE_MESSAGE, uniqueName,
} from '../../../src/renderer/schedule-ui/schedules';

// schedule-ui/schedules.ts reads the global lazily inside its functions, so this is enough — the
// module touches no DOM at load time, and vitest runs in Node with no localStorage.
const cell = new Map<string, string>();
beforeEach(() => {
  cell.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (cell.has(k) ? cell.get(k)! : null),
      setItem: (k: string, v: string) => { cell.set(k, String(v)); },
      removeItem: (k: string) => { cell.delete(k); },
    },
  });
});

const col: Column = { field: { kind: 'core', key: 'name' }, heading: 'Name' };
const def = (name: string, entity = ['IfcDoor']): ScheduleDef =>
  ({ ...emptySchedule(name, entity), columns: [col] });
const names = () => listSaved().map((s) => s.name);

describe('uniqueName', () => {
  it('hands back a name nobody has taken', () => {
    expect(uniqueName('Door Schedule', ['Wall Schedule'])).toBe('Door Schedule');
  });

  it('numbers a collision', () => {
    expect(uniqueName('Door Schedule', ['Door Schedule'])).toBe('Door Schedule (2)');
  });

  it('carries on counting instead of stacking suffixes', () => {
    // Duplicating "Door Schedule (2)" must give (3), never "Door Schedule (2) (2)".
    const taken = ['Door Schedule', 'Door Schedule (2)'];
    expect(uniqueName('Door Schedule (2)', taken)).toBe('Door Schedule (3)');
    expect(uniqueName('Door Schedule', taken)).toBe('Door Schedule (3)');
  });
});

describe('saving never overwrites anything but the entry you loaded', () => {
  it('replaces the entry named by `own`', () => {
    expect(saveSchedule(def('Door Schedule'), null)).toBe('Door Schedule');
    const edited = { ...def('Door Schedule'), columns: [col, col] };
    expect(saveSchedule(edited, 'Door Schedule')).toBe('Door Schedule');
    expect(names()).toEqual(['Door Schedule']);
    expect(listSaved()[0].def.columns).toHaveLength(2);
  });

  it('numbers a collision with someone else, and leaves that someone else alone', () => {
    saveSchedule(def('Door Schedule'), null);
    // A second door setup, started from a category click: same name, nothing loaded.
    const second = { ...def('Door Schedule'), columns: [col, col] };
    expect(saveSchedule(second, null)).toBe('Door Schedule (2)');
    expect(names().sort()).toEqual(['Door Schedule', 'Door Schedule (2)']);
    expect(listSaved().find((s) => s.name === 'Door Schedule')!.def.columns).toHaveLength(1);
  });

  it('adds an untouched entry when the name is free', () => {
    saveSchedule(def('Door Schedule'), null);
    expect(saveSchedule(def('Wall Schedule', ['IfcWall']), 'Door Schedule')).toBe('Wall Schedule');
    expect(names().sort()).toEqual(['Door Schedule', 'Wall Schedule']);
  });

  it('numbers a rename onto a name someone else owns, and leaves both alone', () => {
    // Loaded "Door Schedule", then typed a name another saved setup already owns. The
    // loaded entry may be replaced — but only under ITS name, not the namesake's.
    saveSchedule(def('Door Schedule'), null);
    saveSchedule({ ...def('Fire doors'), columns: [col, col] }, null);
    const renamed = { ...def('Fire doors'), columns: [col, col, col] };
    expect(saveSchedule(renamed, 'Door Schedule')).toBe('Fire doors (2)');
    expect(names().sort()).toEqual(['Door Schedule', 'Fire doors', 'Fire doors (2)']);
    const at = (n: string) => listSaved().find((s) => s.name === n)!;
    expect(at('Door Schedule').def.columns).toHaveLength(1);
    expect(at('Door Schedule').def.name).toBe('Door Schedule');
    expect(at('Fire doors').def.columns).toHaveLength(2);
    expect(at('Fire doors (2)').def.columns).toHaveLength(3);
  });

  it('stores the name it returned on the definition too', () => {
    saveSchedule(def('Door Schedule'), null);
    const name = saveSchedule(def('Door Schedule'), null)!;
    expect(name).toBe('Door Schedule (2)');
    const entry = listSaved().find((s) => s.name === name)!;
    expect(entry.def.name).toBe(name);
  });

  it('falls back to a name rather than saving an empty one', () => {
    expect(saveSchedule(def('   '), null)).toBe('Untitled schedule');
  });
});

describe('renaming and duplicating', () => {
  it('renames in place, definition included', () => {
    saveSchedule(def('A'), null);
    saveSchedule(def('B'), null);
    expect(renameSchedule('A', ' Doors, level 3 ')).toBe('ok');
    const entry = listSaved().find((s) => s.name === 'Doors, level 3')!;
    expect(entry.def.name).toBe('Doors, level 3');
    // B was saved last, so it sits on top — and a rename must not reorder the list.
    expect(names()).toEqual(['B', 'Doors, level 3']);
  });

  it('refuses a name another entry already has, an empty one, and a missing entry', () => {
    saveSchedule(def('A'), null);
    saveSchedule(def('B'), null);
    expect(renameSchedule('A', 'B')).toBe('taken');
    expect(renameSchedule('A', '  ')).toBe('taken');
    expect(renameSchedule('nobody', 'C')).toBe('missing');
    expect(names()).toEqual(['B', 'A']);
  });

  it('puts the copy directly after the original', () => {
    saveSchedule(def('A'), null);
    saveSchedule(def('Door Schedule'), null);
    expect(duplicateSchedule('Door Schedule')).toBe('Door Schedule (2)');
    expect(names()).toEqual(['Door Schedule', 'Door Schedule (2)', 'A']);
    expect(listSaved()[1].def.name).toBe('Door Schedule (2)');
    expect(duplicateSchedule('nobody')).toBe(null);
  });

  it('deletes by name and leaves the rest', () => {
    saveSchedule(def('A'), null);
    saveSchedule(def('B'), null);
    deleteSchedule('A');
    expect(names()).toEqual(['B']);
  });
});

describe('the 100-entry cap refuses instead of dropping the oldest (ifcTable, 2026-11-07)', () => {
  /** Saves unshift, so this leaves ["Setup 99", …, "Setup 0"] — oldest last. */
  const fill = () => { for (let i = 0; i < CAP; i++) saveSchedule(def(`Setup ${i}`), null); };

  it('is 100, and the list fills to it', () => {
    expect(CAP).toBe(100);
    fill();
    expect(names()).toHaveLength(100);
    expect(isFull()).toBe(true);
  });

  it('refuses a 101st save and keeps every entry, oldest included', () => {
    fill();
    expect(saveSchedule(def('Newcomer'), null)).toBe(null);
    const list = names();
    expect(list).toHaveLength(100);
    expect(list).toContain('Setup 0');
    expect(list).not.toContain('Newcomer');
    // A numbered save would ADD an entry too, so it is refused the same way.
    expect(saveSchedule(def('Setup 5'), null)).toBe(null);
    expect(refusal()).toBe(FULL_MESSAGE);
    expect(FULL_MESSAGE).toBe('Saved templates are full (100). Delete one to make room.');
  });

  it('still lets the entry you loaded be saved over — that never grows the list', () => {
    fill();
    const edited = { ...def('Setup 7'), columns: [col, col] };
    expect(isFull('Setup 7')).toBe(false);
    expect(saveSchedule(edited, 'Setup 7')).toBe('Setup 7');
    expect(names()).toHaveLength(100);
    expect(listSaved().find((s) => s.name === 'Setup 7')!.def.columns).toHaveLength(2);
    // Loaded from it but renamed on screen: that is a new entry, and it is refused.
    expect(saveSchedule(def('Setup 7 b'), 'Setup 7')).toBe(null);
  });

  it('refuses a duplicate at the cap, and the original stays', () => {
    fill();
    expect(duplicateSchedule('Setup 0')).toBe(null);
    expect(names()).toHaveLength(100);
    expect(names()).toContain('Setup 0');
    expect(names()).not.toContain('Setup 0 (2)');
  });

  it('says storage, not the cap, when the write itself was refused', () => {
    expect(refusal()).toBe(STORAGE_MESSAGE);
  });

  it('puts the copy directly after the original under the cap', () => {
    for (let i = 0; i < CAP - 1; i++) saveSchedule(def(`Setup ${i}`), null);
    expect(duplicateSchedule('Setup 0')).toBe('Setup 0 (2)');
    const list = names();
    expect(list).toHaveLength(100);
    expect(list.indexOf('Setup 0 (2)')).toBe(list.indexOf('Setup 0') + 1);
  });
});

describe('the key is the Schedules window\'s own', () => {
  it('writes under the sgvue.schedules. prefix and nowhere else', () => {
    saveSchedule(def('Door Schedule'), null);
    expect(SAVED_KEY).toBe('sgvue.schedules.saved.v1');
    expect([...cell.keys()]).toEqual([SAVED_KEY]);
  });

  it('never reads ifcTable\'s keys', () => {
    cell.set('ifctable.saved.v1', JSON.stringify([{ name: 'X', def: def('X'), savedAt: '' }]));
    cell.set('open-schedule.saved.v1', JSON.stringify([{ name: 'Y', def: def('Y'), savedAt: '' }]));
    expect(listSaved()).toEqual([]);
  });

  it('drops an entry that is not a schedule, instead of blanking the window', () => {
    // Review, 2026-09-25: these threw inside a paint (the rail, My templates — now the
    // Templates library — load).
    cell.set(SAVED_KEY, JSON.stringify([
      { name: 'empty', def: {}, savedAt: '' },
      { name: 'bad columns', def: { entity: 'IfcDoor', columns: 'nope' }, savedAt: '' },
      { name: 'no def', savedAt: '' },
      { name: 'good', def: def('good'), savedAt: '2026-09-25T00:00:00Z' },
    ]));
    expect(names()).toEqual(['good']);
    const entry = listSaved()[0];
    expect(Array.isArray(entry.def.entity)).toBe(true);
    expect(Array.isArray(entry.def.columns)).toBe(true);
    // The library renders over it without throwing.
    expect(() => renderLibrary({ ...blankState, overlay: 'library' } as AppState, model())).not.toThrow();
  });

  it('fills what a saved def left out, and keeps its name as the identity', () => {
    const bare = { version: 1, name: 'other', entity: 'IfcDoor', columns: [col] };
    cell.set(SAVED_KEY, JSON.stringify([{ name: 'Bare', def: bare }]));
    const [entry] = listSaved();
    expect(entry.name).toBe('Bare');
    expect(entry.def.name).toBe('Bare');
    expect(entry.def.entity).toEqual(['IfcDoor']);
    expect(entry.def.filters).toEqual([]);
    expect(entry.savedAt).toBe('');
  });

  it('refuses to save a setup with no columns — it could never be loaded back', () => {
    expect(saveSchedule({ ...def('Nothing'), columns: [] }, null)).toBe(null);
    expect(names()).toEqual([]);
  });

  it('survives corrupt storage', () => {
    cell.set(SAVED_KEY, '{not json');
    expect(listSaved()).toEqual([]);
    cell.set(SAVED_KEY, JSON.stringify([{ name: 1 }, null, { name: 'ok', def: def('ok'), savedAt: '' }]));
    expect(names()).toEqual(['ok']);
  });
});

// Restored with phase 4's export (2026-09-25): the Save dialog's suggested name.
describe('every download says what it is and when it was taken', () => {
  const day = new Date(2026, 8, 11, 23, 30);

  it('joins the parts and dates them', () => {
    expect(exportName(['Door Schedule'], 'csv', day)).toBe('Door Schedule — 2026-09-11.csv');
    expect(exportName(['Tower', 'schedules'], 'xlsx', day))
      .toBe('Tower — schedules — 2026-09-11.xlsx');
    expect(exportName(['Door Schedule'], 'schedule.json', day))
      .toBe('Door Schedule — 2026-09-11.schedule.json');
  });

  it('keeps the user out of the filename characters, and never has an empty name', () => {
    expect(exportName(['L3 / Doors: east'], 'csv', day)).toBe('L3  Doors east — 2026-09-11.csv');
    expect(exportName(['   '], 'csv', day)).toBe('schedule — 2026-09-11.csv');
  });

  it('uses the local calendar day, not UTC', () => {
    // Late on the 11th in Singapore, toISOString() already says the 12th while every
    // calendar in the room says the 11th.
    const late = new Date(2026, 8, 11, 23, 59, 59);
    expect(exportName(['S'], 'csv', late)).toContain('2026-09-11');
  });

  it("fits main's 200-character cap however long the schedule's name is", () => {
    // 2026-09-28 review item: a 200-character name plus ` — YYYY-MM-DD.ext` used to fail
    // `ExportSaveRequest`, so the export failed. Each part is cut; the date and extension stay.
    const long = 'Door Schedule '.repeat(20).slice(0, 200);
    for (const ext of ['csv', 'xlsx', 'schedule.json']) {
      for (const parts of [[long], [long, 'schedules'], [long, long]]) {
        const name = exportName(parts, ext, day);
        expect(name.length).toBeLessThanOrEqual(EXPORT_NAME_MAX);
        expect(name.endsWith(` — 2026-09-11.${ext}`)).toBe(true);
        expect(name.startsWith('Door Schedule Door')).toBe(true);
        const req = { kind: 'csv', suggestedName: name, bytes: new Uint8Array(1) };
        expect(ExportSaveRequest.safeParse(req).success).toBe(true);
      }
    }
    // A name that fits is untouched.
    expect(exportName(['Door Schedule'], 'csv', day)).toBe('Door Schedule — 2026-09-11.csv');
  });
});

// ---------------------------------------------------------------- a model for the library

const meta: ModelMeta = {
  fileName: 'f.ifc', schema: 'IFC4', projectName: '', authoringTool: '',
  lengthUnit: 'mm', unitSystem: 'metric', elementCount: 0, parseMs: 0,
};

/** A model holding one IfcDoor. */
function model(): ModelStore {
  const b = new StoreBuilder();
  const cores: ElemCore[] = [{
    entity: 'IfcDoor', name: 'D1', description: '', mark: '', typeName: 'T', family: 'F',
    objectType: '', predefinedType: '', guid: 'g1', storey: 'L1', storeyElevation: 0,
    building: '', site: '', space: '', material: '', discipline: 'ARC',
  }];
  const cells: Record<string, Cell>[] = [{}];
  b.add(cores, cells);
  return b.finish(meta);
}
