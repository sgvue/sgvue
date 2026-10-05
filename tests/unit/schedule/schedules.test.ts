// The save rule, and the panel that exists because of it — ported from ifcTable's
// `tests/schedules.test.ts` with the Schedules window's saved setups (2026-09-25, phase 2).
// The three download-name cases (`exportName`) came back with phase 4's export.
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
import { savedPanel } from '../../../src/renderer/schedule-ui/overlays/savedPanel';
import { EXPORT_NAME_MAX, exportName } from '../../../src/renderer/schedule-ui/dom';
import { ExportSaveRequest } from '../../../src/shared/ipc-contract';
import {
  deleteSchedule, duplicateSchedule, listSaved, renameSchedule, saveSchedule, SAVED_KEY, uniqueName,
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

describe('the 100-entry cap', () => {
  /** Saves unshift, so this leaves ["Setup 99", …, "Setup 0"] — oldest last. */
  const fill = () => { for (let i = 0; i < 100; i++) saveSchedule(def(`Setup ${i}`), null); };

  it('drops the oldest when a 101st is saved', () => {
    fill();
    expect(saveSchedule(def('Newcomer'), null)).toBe('Newcomer');
    const list = names();
    expect(list).toHaveLength(100);
    expect(list[0]).toBe('Newcomer');
    expect(list).not.toContain('Setup 0');
    expect(list[99]).toBe('Setup 1');
  });

  it('keeps a copy of the LAST entry — the cap may never eat what was just made', () => {
    fill();
    // The original sits last, so the copy lands past the cap. `.slice(0, 100)` threw it
    // straight back out and the caller still flashed "Copied to …". The copy stays, and
    // so does the original it sits behind — duplicating must not delete what you copied
    // — so the entry that goes is the oldest one that is neither of them.
    expect(duplicateSchedule('Setup 0')).toBe('Setup 0 (2)');
    const list = names();
    expect(list).toHaveLength(100);
    expect(list).toContain('Setup 0 (2)');
    expect(list.indexOf('Setup 0 (2)')).toBe(list.indexOf('Setup 0') + 1);
    expect(list).not.toContain('Setup 1');
  });

  it('stays at 100 when the FIRST entry is duplicated', () => {
    fill();
    expect(duplicateSchedule('Setup 99')).toBe('Setup 99 (2)');
    const list = names();
    expect(list).toHaveLength(100);
    expect(list[1]).toBe('Setup 99 (2)');
    expect(list).not.toContain('Setup 0');
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
    // Review, 2026-09-25: these threw inside a paint (the rail, My templates, load).
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
    // The panel and the rail render over it without throwing.
    expect(() => panel()).not.toThrow();
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

// ---------------------------------------------------------------- the panel

const meta: ModelMeta = {
  fileName: 'f.ifc', schema: 'IFC4', projectName: '', authoringTool: '',
  lengthUnit: 'mm', unitSystem: 'metric', elementCount: 0, parseMs: 0,
};

/** A model holding one IfcDoor — the panel reads nothing but byEntity. */
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

const panel = (over: Partial<AppState> = {}) =>
  savedPanel({ ...blankState, ...over } as AppState, model());

describe('the my-templates panel', () => {
  it('says so when nothing is saved, and when nothing matches', () => {
    expect(panel()).toContain('Nothing saved yet');
    saveSchedule(def('Door Schedule'), null);
    expect(panel({ savedQuery: 'zzz' })).toContain('No template matches that.');
  });

  it('groups by the classes a setup schedules, and counts each group', () => {
    saveSchedule(def('Door Schedule'), null);
    saveSchedule(def('Entrance doors'), null);
    saveSchedule(def('Wall Schedule', ['IfcWall', 'IfcCurtainWall']), null);
    const html = panel();
    expect(html).toContain('IfcWall + IfcCurtainWall');
    // Doors group before walls, and inside the door group the names sort too.
    expect(html.indexOf('IfcDoor')).toBeLessThan(html.indexOf('IfcWall + IfcCurtainWall'));
    expect(html.indexOf('Door Schedule')).toBeLessThan(html.indexOf('Entrance doors'));
  });

  it('marks the setup in use, and says EDITED once it has been changed', () => {
    saveSchedule(def('Door Schedule'), null);
    expect(panel({ savedName: 'Door Schedule' })).toContain('>IN USE<');
    expect(panel({ savedName: 'Door Schedule', dirty: true })).toContain('>EDITED<');
    expect(panel()).not.toContain('IN USE');
  });

  it('warns before the click that a setup names a class this model lacks', () => {
    saveSchedule(def('Pipe Schedule', ['IfcPipeSegment']), null);
    saveSchedule(def('Door Schedule'), null);
    expect(panel()).toContain('not in this model');
    expect(panel({ savedQuery: 'door' })).not.toContain('not in this model');
  });

  it('filters by name and by class, ignoring case', () => {
    saveSchedule(def('Door Schedule'), null);
    saveSchedule(def('Wall Schedule', ['IfcWall']), null);
    expect(panel({ savedQuery: 'DOOR' })).not.toContain('Wall Schedule');
    expect(panel({ savedQuery: 'ifcwall' })).toContain('Wall Schedule');
  });

  it('shows the column count and the day it was saved', () => {
    saveSchedule(def('Door Schedule'), null);
    const html = panel();
    expect(html).toContain('1 column · saved ');
    expect(html).toContain(listSaved()[0].savedAt.slice(0, 10));
  });

  it('escapes a name, the same as everything else built from user text', () => {
    saveSchedule(def('"><img src=x onerror=alert(1)>'), null);
    const html = panel();
    expect(html).not.toContain('<img');
    expect(html).not.toContain('"><img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&quot;&gt;&lt;img');
  });

  it('renders a long list without losing anyone', () => {
    for (let i = 0; i < 40; i++) saveSchedule(def(`Setup ${i}`), null);
    const html = panel();
    expect([...html.matchAll(/data-act="load-saved"/g)]).toHaveLength(40);
  });
});
