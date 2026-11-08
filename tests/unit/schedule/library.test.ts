// The Templates library: one list and one action set for built-in and saved templates, in place
// of the template gallery and My templates — v1.5.0, phase 3. Ported from ifcTable's
// `tests/library.test.ts` (Yong Yen, 2026-11-07, after d3c4989: no start screen, no arming).
//
// Markup is checked as strings; the controls are fired through the REAL wiring on the fake DOM
// (support/fakeDom.ts — it proves which handler runs and what it writes, not hit-testing). A
// trusted pointer click in the window is still the proof of the clicks.
//
// What SGVue changes, and so what is tested differently: ifcTable's confirm sheets are this
// window's own dialog (dialog.ts, stood in for here by a recording one a test answers) — the
// same question the assistant's request raises; Import is main's native Open dialog (the
// preload's `openScheduleFile`, stood in for), and the file goes into Mine; a built-in's
// definition is what Use applies here, with the `Model` column on a federation.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { record, resetHistory } from '../../../src/schedule/history';
import { StoreBuilder, type ModelStore } from '../../../src/schedule/ifc/store';
import type { Cell, ElemCore, ModelMeta } from '../../../src/schedule/ifc/types';
import { emptySchedule, type Column, type ScheduleDef } from '../../../src/schedule/schedule/def';
import { state, type AppState } from '../../../src/renderer/schedule-ui/state';
import { buildCoverage, clearCoverageCache, peekCoverage } from '../../../src/renderer/schedule-ui/coverage';
import { flash } from '../../../src/renderer/schedule-ui/dom';
import { wireApp } from '../../../src/renderer/schedule-ui/events';
import {
  clearLibraryCache, computePreview, previewOf, PREVIEW_DELAY, wantPreview,
} from '../../../src/renderer/schedule-ui/libraryCache';
import { libraryKey, opensLibrary, type KeyInfo, type LibCtx } from '../../../src/renderer/schedule-ui/libraryKeys';
import { classCount, READ_ONLY, saveNote, templates } from '../../../src/renderer/schedule-ui/libraryModel';
import { renderLibrary } from '../../../src/renderer/schedule-ui/overlays/library';
import { renderOverlay } from '../../../src/renderer/schedule-ui/overlays';
import { renderHeader } from '../../../src/renderer/schedule-ui/header';
import { CAP, FULL_MESSAGE, listSaved, saveSchedule } from '../../../src/renderer/schedule-ui/schedules';
import { buildFederationStore, buildStore } from './support/fixture';
import { FakeEl, installFakeDom } from './support/fakeDom';

vi.mock('../../../src/renderer/schedule-ui/dom', async (orig) => ({
  ...(await orig<typeof import('../../../src/renderer/schedule-ui/dom')>()), flash: vi.fn(),
}));

/** This window's dialog, recorded: every question asked, and a way to answer the one that is up. */
const dialog = vi.hoisted(() => ({
  open: false,
  asked: [] as { message: string; confirm: string; danger: boolean; title: string; forAssistant: boolean }[],
  answer: (_ok: boolean): void => undefined,
}));
vi.mock('../../../src/renderer/schedule-ui/dialog', () => ({
  dialogOpen: () => dialog.open,
  confirmDialog: (message: string, confirm: string, danger = false, how: { title?: string; forAssistant?: boolean } = {}) =>
    new Promise<boolean>((resolve) => {
      dialog.open = true;
      dialog.asked.push({ message, confirm, danger, title: how.title ?? 'Schedules', forAssistant: how.forAssistant === true });
      dialog.answer = (ok) => { dialog.open = false; resolve(ok); };
    }),
  promptDialog: async () => null,
}));

const { root, win, dispatch } = installFakeDom();
const store = buildStore();
const cell = new Map<string, string>();
/** What the native Open dialog hands back next: a file's text, or null for Cancel. */
let picked: string | null = null;

const col: Column = { field: { kind: 'core', key: 'name' }, heading: 'Name' };
const def = (name: string, entity = ['IfcDoor']): ScheduleDef => ({ ...emptySchedule(name, entity), columns: [col] });
const names = () => listSaved().map((s) => s.name);
const flashed = () => vi.mocked(flash).mock.calls.map((c) => c[0]);

/** A model holding doors and nothing else — for what a template finds missing. */
function doorsOnly(): ModelStore {
  const meta: ModelMeta = {
    fileName: 'f.ifc', schema: 'IFC4', projectName: '', authoringTool: '',
    lengthUnit: 'mm', unitSystem: 'metric', elementCount: 0, parseMs: 0,
  };
  const core: ElemCore = {
    entity: 'IfcDoor', name: 'D1', description: '', mark: '', typeName: 'T', family: 'F',
    objectType: '', predefinedType: '', guid: 'g1', storey: 'L1', storeyElevation: 0,
    building: '', site: '', space: '', material: '', discipline: 'ARC',
  };
  const b = new StoreBuilder();
  b.add([core], [{} as Record<string, Cell>]);
  return b.finish(meta);
}

beforeAll(() => {
  Object.assign(win, {
    sgvueSchedule: {
      saveExport: async () => ({ saved: false }),
      openScheduleFile: async () => (picked === null ? null : { text: picked }),
    },
  });
  wireApp(root as unknown as HTMLElement, {
    pickRow: () => {}, rowMenu: () => {}, headMenu: () => {}, moveRow: () => {}, frameSelection: () => {},
  });
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(flash).mockClear();
  dialog.open = false;
  dialog.asked = [];
  picked = null;
  cell.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (cell.has(k) ? cell.get(k)! : null),
      setItem: (k: string, v: string) => { cell.set(k, String(v)); },
      removeItem: (k: string) => { cell.delete(k); },
    },
  });
  Object.assign(state, {
    store, def: def('Door Schedule'), overlay: 'library', dirty: false,
    templateId: null, savedName: null, libraryQuery: '', librarySel: null, libraryFolds: [],
    libraryDraft: null, librarySort: { by: 'count', dir: -1 },
  } satisfies Partial<AppState>);
  resetHistory(state.def);
  clearLibraryCache();
});
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

const pane = new FakeEl('div', {}, root);
/** Fire a control: a fresh element carrying these data-* attributes. */
const click = (data: Record<string, string>, detail = 1) => {
  const el = new FakeEl('button', data, pane);
  dispatch(el, 'click', { detail });
  return el;
};
const key = (target: FakeEl, k: string, mods: { metaKey?: boolean; ctrlKey?: boolean } = {}) =>
  dispatch(target, 'keydown', { key: k, ...mods });
const input = (data: Record<string, string>, value = '') => {
  const el = new FakeEl('input', data, pane);
  el.value = value;
  return el;
};

/** The acts drawn in the pane's bottom bar, in order. */
const barActs = (html: string) => [...html.slice(html.indexOf('class="pane-bar"')).matchAll(/data-act="([a-z-]+)"/g)].map((m) => m[1]);

describe('one row design and one action set for both sources', () => {
  it('draws built-in and saved rows the same way, with the same acts', () => {
    saveSchedule(def('Door setup'), null);
    const html = renderLibrary(state, store);
    expect(html).toMatch(/class="lib-row[^"]*"[^>]*data-act="library-row" data-id="m:Door setup"/);
    expect(html).toMatch(/class="lib-row[^"]*"[^>]*data-act="library-row" data-id="b:door-schedule"/);
    expect(html).toContain('>Mine<');
    expect(html).toContain('>Built-in<');
    // It is the overlay a 'library' state draws.
    expect(renderOverlay(state, store, buildCoverage(store, ['IfcDoor']))).toContain('class="overlay-card lib-card"');
  });

  it('gives a built-in the same slots, with Rename and Delete greyed and labelled read-only', () => {
    saveSchedule(def('Door setup'), null);
    const builtin = renderLibrary({ ...state, librarySel: 'b:door-schedule' }, store);
    const mine = renderLibrary({ ...state, librarySel: 'm:Door setup' }, store);
    expect(barActs(builtin)).toEqual(barActs(mine));
    expect(barActs(mine)).toEqual(['library-duplicate', 'library-rename-start', 'library-export', 'library-delete', 'library-use']);
    const bar = (h: string) => h.slice(h.indexOf('class="pane-bar"'));
    expect(bar(builtin)).toMatch(/data-act="library-rename-start" aria-disabled="true"/);
    expect(bar(builtin)).toMatch(/data-act="library-delete" aria-disabled="true"/);
    expect(bar(builtin)).toContain('Read-only');
    expect(bar(builtin)).toContain('aria-label="Duplicate to Mine"');
    expect(bar(mine)).not.toContain('aria-disabled');
    expect(bar(mine)).toContain('aria-label="Duplicate"');
  });

  it('every icon button says what it does, in words', () => {
    saveSchedule(def('Door setup'), null);
    const html = renderLibrary({ ...state, librarySel: 'm:Door setup' }, store);
    for (const m of html.matchAll(/<button class="icon-btn[^>]*>/g)) {
      expect([m[0].slice(0, 60), /aria-label="[^"]+"/.test(m[0]), /title="[^"]+"/.test(m[0])])
        .toEqual([m[0].slice(0, 60), true, true]);
    }
  });

  it('answers a greyed Rename or Delete with the read-only message, and opens nothing', () => {
    click({ act: 'library-rename-start', id: 'b:door-schedule' });
    click({ act: 'library-delete', id: 'b:door-schedule' });
    expect(state.libraryDraft).toBe(null);
    expect(dialog.asked).toEqual([]);
    expect(flashed()).toEqual([READ_ONLY, READ_ONLY]);
  });

  it('marks the template in use, and EDITED once changed', () => {
    saveSchedule(def('Door setup'), null);
    expect(renderLibrary({ ...state, savedName: 'Door setup' }, store)).toContain('>IN USE<');
    expect(renderLibrary({ ...state, savedName: 'Door setup', dirty: true }, store)).toContain('>EDITED<');
    expect(renderLibrary({ ...state, templateId: 'door-schedule' }, store)).toContain('>IN USE<');
  });

  it('folds a template whose class is missing under "Not in this model", and search opens it', () => {
    saveSchedule(def('Doors'), null);
    saveSchedule(def('Ducts', ['IfcDuctSegment']), null);
    const doors = doorsOnly();
    const html = renderLibrary(state, doors);
    expect(html).toContain('Not in this model');
    expect(html).not.toContain('data-id="m:Ducts"');
    expect(renderLibrary({ ...state, libraryQuery: 'duct' }, doors)).toContain('data-id="m:Ducts"');
    expect(renderLibrary({ ...state, libraryFolds: ['abs:mine'] }, doors)).toContain('data-id="m:Ducts"');
  });

  it('searches names and classes, ignoring case, and says so when nothing matches', () => {
    saveSchedule(def('Door setup'), null);
    saveSchedule(def('Wall setup', ['IfcWall']), null);
    expect(renderLibrary({ ...state, libraryQuery: 'DOOR' }, store)).not.toContain('m:Wall setup');
    expect(renderLibrary({ ...state, libraryQuery: 'ifcwall' }, store)).toContain('m:Wall setup');
    expect(renderLibrary({ ...state, libraryQuery: 'zzz' }, store)).toContain('No template matches “zzz”.');
  });

  it('says what to do when nothing is saved', () => {
    expect(renderLibrary(state, store)).toContain('Save the schedule on screen');
  });

  it('shows IFC-SG only with a model that has its class', () => {
    expect(renderLibrary(state, store)).toContain('IFC-SG');
    expect(renderLibrary(state, doorsOnly())).not.toContain('>IFC-SG<');
  });

  it('escapes a name, like everything else built from user text', () => {
    saveSchedule(def('"><img src=x onerror=alert(1)>'), null);
    const html = renderLibrary(state, store);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('lists a long Mine without losing anyone', () => {
    for (let i = 0; i < 40; i++) saveSchedule(def(`Setup ${i}`), null);
    expect([...renderLibrary(state, store).matchAll(/data-id="m:Setup \d+"/g)]).toHaveLength(40);
  });

  it('SGVue: on a federation a built-in previews what Use gives — the Model column first', () => {
    const fed = buildFederationStore();
    const door = templates(fed).find((t) => t.key === 'b:door-schedule')!;
    expect(door.def.columns[0].field).toEqual({ kind: 'core', key: 'model' });
    expect(templates(store).find((t) => t.key === 'b:door-schedule')!.def.columns[0].field)
      .not.toEqual({ kind: 'core', key: 'model' });
  });
});

describe('the ways in: the rail, the header and T', () => {
  it('the header offers the library and Save, as icon buttons that say what they do', () => {
    const html = renderHeader(state);
    expect(html).toMatch(/data-act="open-library" data-tip="Templates library \(T\)" aria-label="Templates library \(T\)"/);
    expect(html).toMatch(/data-act="save-schedule"/);
    expect(html).not.toContain('open-templates');
    expect(html).not.toContain('open-saved');
    // Auto-fit and Equal width are icon buttons now, still with their words.
    expect(html).toMatch(/data-act="fit-all" aria-label="Auto-fit columns"/);
    expect(html).toMatch(/data-act="fit-equal" disabled aria-label="Equal width"/);
  });

  it('opens on the template in use', () => {
    state.overlay = null;
    state.templateId = 'wall-schedule';
    click({ act: 'open-library' });
    expect([state.overlay, state.librarySel, state.libraryDraft]).toEqual(['library', 'b:wall-schedule', null]);
  });
});

describe('saving: silent over the one you loaded, numbered when the name is taken', () => {
  it('says live what Enter would do', () => {
    saveSchedule(def('Door Schedule'), null);
    expect(saveNote('  ', null)).toEqual({ note: 'A name is needed', error: true });
    expect(saveNote('Door Schedule', null).note).toBe('Name taken — saves as “Door Schedule (2)”');
    expect(saveNote('Door Schedule', 'Door Schedule').note).toBe('Replaces the saved one you loaded');
    expect(saveNote('Fresh', null).error).toBe(false);
  });

  it('numbers a taken name from the Save row, and the schedule is then that entry', () => {
    saveSchedule(def('Door Schedule'), null);
    state.libraryDraft = { kind: 'save', target: null, text: 'Door Schedule', error: '' };
    key(input({ act: 'library-save-name' }, 'Door Schedule'), 'Enter');
    expect(names().sort()).toEqual(['Door Schedule', 'Door Schedule (2)']);
    expect(state.savedName).toBe('Door Schedule (2)');
    expect(state.def.name).toBe('Door Schedule (2)');
    expect(state.libraryDraft).toBe(null);
    expect(state.librarySel).toBe('m:Door Schedule (2)');
    expect(flashed().at(-1)).toContain('Saved as “Door Schedule (2)”');
  });

  it('saves under the name typed in the row, not the schedule’s', () => {
    state.libraryDraft = { kind: 'save', target: null, text: 'Ward doors', error: '' };
    key(input({ act: 'library-save-name' }, 'Ward doors'), 'Enter');
    expect(names()).toEqual(['Ward doors']);
    expect([state.savedName, state.def.name]).toEqual(['Ward doors', 'Ward doors']);
  });

  it('saves silently over the loaded entry from the header', () => {
    saveSchedule(def('Door Schedule'), null);
    Object.assign(state, { overlay: null, savedName: 'Door Schedule', dirty: true, def: { ...def('Door Schedule'), columns: [col, col] } });
    click({ act: 'save-schedule' });
    expect(names()).toEqual(['Door Schedule']);
    expect(listSaved()[0].def.columns).toHaveLength(2);
    expect(state.dirty).toBe(false);
    expect(state.overlay).toBe(null);
    expect(flashed().at(-1)).toBe('Saved “Door Schedule”.');
  });

  it('opens the Save row instead when the schedule is not a saved one', () => {
    state.overlay = null;
    click({ act: 'save-schedule' });
    expect(state.overlay).toBe('library');
    expect(state.libraryDraft).toEqual({ kind: 'save', target: null, text: 'Door Schedule', error: '' });
  });

  it('keeps the row open with the reason when a name is missing', () => {
    state.libraryDraft = { kind: 'save', target: null, text: '  ', error: '' };
    key(input({ act: 'library-save-name' }, '  '), 'Enter');
    expect(state.libraryDraft?.error).toBe('A name is needed');
    expect(names()).toEqual([]);
  });
});

describe('at the 100-entry cap, nothing is dropped', () => {
  const fill = () => { for (let i = 0; i < CAP; i++) saveSchedule(def(`Setup ${i}`), null); };

  it('refuses Save, Duplicate and Import with the cap message', async () => {
    fill();
    state.libraryDraft = { kind: 'save', target: null, text: 'Newcomer', error: '' };
    key(input({ act: 'library-save-name' }, 'Newcomer'), 'Enter');
    click({ act: 'library-duplicate', id: 'b:door-schedule' });
    click({ act: 'library-duplicate', id: 'm:Setup 3' });
    picked = JSON.stringify(def('Imported'));
    click({ act: 'import-schedule' });
    await vi.runAllTimersAsync();
    expect(names()).toHaveLength(100);
    expect(names()).toContain('Setup 0');
    expect(flashed()).toEqual([FULL_MESSAGE, FULL_MESSAGE, FULL_MESSAGE, FULL_MESSAGE]);
    expect(saveNote('Newcomer', null)).toEqual({ note: FULL_MESSAGE, error: true });
  });
});

describe('import adds to Mine and selects it — the schedule on screen stays', () => {
  it('adds, numbers a taken name, selects it and leaves the schedule alone', async () => {
    const onScreen = state.def;
    Object.assign(state, { overlay: null, dirty: true });
    picked = JSON.stringify(def('Ward doors'));
    click({ act: 'import-schedule' });
    await vi.runAllTimersAsync();
    expect(names()).toEqual(['Ward doors']);
    expect(state.def).toBe(onScreen);
    expect(state.dirty).toBe(true);
    expect(state.overlay).toBe('library');
    expect(state.librarySel).toBe('m:Ward doors');

    click({ act: 'import-schedule' });
    await vi.runAllTimersAsync();
    expect(state.librarySel).toBe('m:Ward doors (2)');
    expect(flashed().at(-1)).toBe('Imported “Ward doors (2)” into Mine — “Ward doors” was taken.');
  });

  it('opens "Not in this model" for one whose class the model lacks', async () => {
    state.store = doorsOnly();
    picked = JSON.stringify(def('Pipes', ['IfcPipeSegment']));
    click({ act: 'import-schedule' });
    await vi.runAllTimersAsync();
    expect(state.libraryFolds).toContain('abs:mine');
    expect(flashed().at(-1)).toContain('this model has no IfcPipeSegment');
  });

  it('with no model open, the file still goes into Mine — and the toast says so', async () => {
    Object.assign(state, { store: null, overlay: null });
    picked = JSON.stringify(def('Loose doors'));
    click({ act: 'import-schedule' });
    await vi.runAllTimersAsync();
    expect(names()).toEqual(['Loose doors']);
    // No library to show it in without a model: nothing else changes.
    expect(state.overlay).toBe(null);
    expect(flashed().at(-1)).toBe('Imported “Loose doors” into Mine.');
  });

  it('a file that is not a schedule adds nothing, and says so', async () => {
    picked = '{"nope": true}';
    click({ act: 'import-schedule' });
    await vi.runAllTimersAsync();
    expect(names()).toEqual([]);
    expect(vi.mocked(flash).mock.calls.at(-1)?.[1]).toBe(true);
  });
});

describe('duplicating and renaming', () => {
  it('copies a built-in under the template name, numbers it when taken, and opens the name', () => {
    click({ act: 'library-duplicate', id: 'b:door-schedule' });
    expect(names()).toEqual(['Door Schedule']);
    expect(listSaved()[0].def.columns.length).toBeGreaterThan(1);
    expect(state.librarySel).toBe('m:Door Schedule');
    expect(state.libraryDraft).toEqual({ kind: 'rename', target: 'm:Door Schedule', text: 'Door Schedule', error: '' });
    click({ act: 'library-duplicate', id: 'b:door-schedule' });
    expect(names()).toContain('Door Schedule (2)');
  });

  it('copies a saved one directly after it, with its name open', () => {
    saveSchedule(def('A'), null);
    click({ act: 'library-duplicate', id: 'm:A' });
    expect(names()).toEqual(['A', 'A (2)']);
    expect(state.libraryDraft).toEqual({ kind: 'rename', target: 'm:A (2)', text: 'A (2)', error: '' });
  });

  it('renames in place, refusing a taken name inline', () => {
    saveSchedule(def('A'), null);
    saveSchedule(def('B'), null);
    state.libraryDraft = { kind: 'rename', target: 'm:A', text: 'B', error: '' };
    key(input({ act: 'library-rename', id: 'm:A' }, 'B'), 'Enter');
    expect(state.libraryDraft?.error).toBe('Another saved template has that name');
    key(input({ act: 'library-rename', id: 'm:A' }, 'C'), 'Enter');
    expect(names().sort()).toEqual(['B', 'C']);
    expect(state.librarySel).toBe('m:C');
    expect(state.libraryDraft).toBe(null);
    expect(flashed().at(-1)).toBe('Renamed to “C”.');
  });

  it('the marker follows a rename of the setup in use, and that is no undo step', () => {
    saveSchedule(def('A'), null);
    Object.assign(state, { savedName: 'A', def: def('A') });
    resetHistory(state.def);
    state.libraryDraft = { kind: 'rename', target: 'm:A', text: 'Z', error: '' };
    key(input({ act: 'library-rename', id: 'm:A' }, 'Z'), 'Enter');
    expect([state.savedName, state.def.name]).toEqual(['Z', 'Z']);
  });
});

describe('deleting asks in this window’s own dialog — the user’s, so its own label and default', () => {
  it('Delete in the list asks; only the dialog’s Delete deletes', async () => {
    saveSchedule(def('Door setup'), null);
    state.librarySel = 'm:Door setup';
    // Never in the search box, where it deletes text.
    key(input({ act: 'library-search' }), 'Delete');
    expect(dialog.asked).toEqual([]);
    expect(libraryKey(k({ key: 'Delete', inText: true, inSearch: true }), c())).toBe(null);
    key(new FakeEl('div', { act: 'library-list' }, pane), 'Delete');
    expect(dialog.asked).toEqual([{
      message: 'Delete the saved template “Door setup”? This cannot be undone.',
      confirm: 'Delete', danger: true, title: 'Schedules', forAssistant: false,
    }]);
    expect(names()).toEqual(['Door setup']);
    dialog.answer(false);
    await vi.runAllTimersAsync();
    expect(names()).toEqual(['Door setup']);
    click({ act: 'library-delete', id: 'm:Door setup' });
    dialog.answer(true);
    await vi.runAllTimersAsync();
    expect(names()).toEqual([]);
    expect(flashed().at(-1)).toBe('Deleted “Door setup”.');
  });
});

describe('after a delete the selection moves to the neighbouring row, as ifcTable’s doDelete does', () => {
  it('to the row after it, else the one before, and only when the deleted row was selected', async () => {
    for (const n of ['A', 'B', 'C']) saveSchedule(def(n), null);
    const order = () => [...renderLibrary(state, store).matchAll(/data-act="library-row" data-id="([^"]+)"/g)].map((m) => m[1]);
    expect(order().slice(0, 3)).toEqual(['m:A', 'm:B', 'm:C']);

    state.librarySel = 'm:B';
    click({ act: 'library-delete', id: 'm:B' });
    dialog.answer(true);
    await vi.runAllTimersAsync();
    expect(names()).not.toContain('B');
    expect(state.librarySel).toBe('m:C');

    // The last row drawn (the other sections folded): the one before it.
    state.libraryFolds = ['sec:general', 'sec:ifcsg'];
    expect(order()).toEqual(['m:A', 'm:C']);
    click({ act: 'library-delete', id: 'm:C' });
    dialog.answer(true);
    await vi.runAllTimersAsync();
    expect(state.librarySel).toBe('m:A');

    // Cancelled: the selection stays where it was.
    click({ act: 'library-delete', id: 'm:A' });
    dialog.answer(false);
    await vi.runAllTimersAsync();
    expect([names(), state.librarySel]).toEqual([['A'], 'm:A']);

    // Another row selected: deleting this one leaves it alone.
    saveSchedule(def('D'), null);
    state.librarySel = 'b:door-schedule';
    click({ act: 'library-delete', id: 'm:D' });
    dialog.answer(true);
    await vi.runAllTimersAsync();
    expect(state.librarySel).toBe('b:door-schedule');
  });
});

describe('coverage is cached per class set for the model’s lifetime', () => {
  it('keeps one entry per class set, and lets go when the model changes or closes', () => {
    clearCoverageCache();
    const doors = buildCoverage(store, ['IfcDoor']);
    const walls = buildCoverage(store, ['IfcWall', 'IfcWallStandardCase']);
    // Walking the list does not evict the first: both are still there.
    expect(buildCoverage(store, ['IfcDoor'])).toBe(doors);
    expect(peekCoverage(store, ['IfcWall', 'IfcWallStandardCase'])).toBe(walls);
    const other = buildStore();
    expect(peekCoverage(other, ['IfcDoor'])).toBeUndefined();
    expect(buildCoverage(other, ['IfcDoor'])).not.toBe(doors);
    expect(peekCoverage(store, ['IfcDoor'])).toBeUndefined();
    clearCoverageCache();
    expect(peekCoverage(other, ['IfcDoor'])).toBeUndefined();
  });
});

describe('the preview: cached per template, run once the selection settles', () => {
  const tpl = (key: string) => templates(store).find((t) => t.key === key)!;

  it('counts a filtered template over its own rows, not the whole class', () => {
    const planting = tpl('b:sg-planting');
    const p = computePreview(store, planting);
    expect(p.matched).toBeLessThan(classCount(store, planting));
    expect(p.found).toHaveLength(planting.def.columns.length);
    for (const n of p.found!) expect(n).toBeLessThanOrEqual(p.matched);
    expect(computePreview(store, tpl('b:door-schedule')).found).toBeUndefined();
  });

  it('runs only the template the selection stops on, once', () => {
    wantPreview(store, tpl('b:wall-schedule'));
    vi.advanceTimersByTime(PREVIEW_DELAY / 2);
    wantPreview(store, tpl('b:door-schedule'));
    vi.advanceTimersByTime(PREVIEW_DELAY);
    expect(previewOf(store, tpl('b:wall-schedule'))).toBeUndefined();
    const door = previewOf(store, tpl('b:door-schedule'));
    expect(door?.matched).toBe(classCount(store, tpl('b:door-schedule')));
    wantPreview(store, tpl('b:door-schedule'));
    expect(previewOf(store, tpl('b:door-schedule'))).toBe(door);
    // A different model is a different cache.
    expect(previewOf(buildStore(), tpl('b:door-schedule'))).toBeUndefined();
  });
});

const k = (over: Partial<KeyInfo>): KeyInfo => ({
  key: '', mod: false, alt: false, inText: false, inList: false, inSearch: false, inDraft: false, onButton: false, ...over,
});
const c = (over: Partial<LibCtx> = {}): LibCtx => ({ draft: false, query: '', ...over });

describe('the keyboard', () => {
  it('T opens the library only when not typing, with a model open and nothing on top', () => {
    const base = { key: 't', mod: false, alt: false, inText: false };
    const ctx = { store: true, overlay: false, menu: false };
    expect(opensLibrary(base, ctx)).toBe(true);
    expect(opensLibrary({ ...base, inText: true }, ctx)).toBe(false);
    expect(opensLibrary({ ...base, mod: true }, ctx)).toBe(false);
    expect(opensLibrary(base, { ...ctx, store: false })).toBe(false);
    expect(opensLibrary(base, { ...ctx, overlay: true })).toBe(false);
    expect(opensLibrary(base, { ...ctx, menu: true })).toBe(false);

    state.overlay = null;
    key(new FakeEl('input', {}, pane), 't');
    expect(state.overlay).toBe(null);
    key(new FakeEl('div', {}, pane), 't');
    expect(state.overlay).toBe('library');
    // Not over this window's own dialog either.
    state.overlay = null;
    dialog.open = true;
    key(new FakeEl('div', {}, pane), 't');
    expect(state.overlay).toBe(null);
  });

  it('Esc closes the name row, then clears the search, then the library', () => {
    const list = new FakeEl('div', { act: 'library-list' }, pane);
    Object.assign(state, {
      libraryDraft: { kind: 'save', target: null, text: 'x', error: '' },
      libraryQuery: 'door',
    });
    key(list, 'Escape');
    expect(state.libraryDraft).toBe(null);
    expect(state.libraryQuery).toBe('door');
    key(list, 'Escape');
    expect(state.libraryQuery).toBe('');
    expect(state.overlay).toBe('library');
    key(list, 'Escape');
    expect(state.overlay).toBe(null);
  });

  it('⌘Z and ⌘Y never undo the schedule behind an open library — in a text box or out', () => {
    // wireHistory asks whether the target is a text box with `instanceof`, which Node has no
    // class for: an <input> here is a fake element, and nothing is an HTMLInputElement.
    vi.stubGlobal('HTMLElement', FakeEl);
    vi.stubGlobal('HTMLInputElement', class {});
    const before = def('Before');
    const after = { ...def('After'), columns: [col, col] };
    resetHistory(before);
    record(after);
    state.def = after;
    key(new FakeEl('div', { act: 'library-list' }, pane), 'z', { metaKey: true });
    key(input({ act: 'library-search' }), 'z', { ctrlKey: true });
    key(new FakeEl('div', {}, pane), 'y', { metaKey: true });
    expect(state.def).toBe(after);
    // With the library closed the same key does undo — so the test can fail.
    state.overlay = null;
    key(new FakeEl('div', {}, pane), 'z', { metaKey: true });
    expect(state.def.name).toBe('Before');
    vi.unstubAllGlobals();
    expect(libraryKey(k({ key: 'z', mod: true }), c())).toBe('swallow');
    expect(libraryKey(k({ key: 'z', mod: true, inText: true }), c())).toBe(null);
  });

  it('moves with the arrows, uses with Enter, and has no ⌘D or ⌘S', () => {
    expect(libraryKey(k({ key: 'ArrowDown', inSearch: true }), c())).toBe('down');
    expect(libraryKey(k({ key: 'Home', inSearch: true }), c())).toBe(null);
    expect(libraryKey(k({ key: 'Home', inList: true }), c())).toBe('home');
    expect(libraryKey(k({ key: 'Enter', inList: true }), c())).toBe('use');
    expect(libraryKey(k({ key: 'Enter', inList: true, onButton: true }), c())).toBe(null);
    expect(libraryKey(k({ key: 'F2', inList: true }), c())).toBe('rename');
    expect(libraryKey(k({ key: 'd', mod: true, inList: true }), c())).toBe(null);
    expect(libraryKey(k({ key: 's', mod: true, inList: true }), c())).toBe(null);

    const first = state.librarySel;
    key(input({ act: 'library-search' }), 'ArrowDown');
    expect(state.librarySel).not.toBe(first);
  });
});

describe('closing the library', () => {
  it('leaves no name row behind, whichever way it closes', () => {
    for (const act of ['close-overlay', 'overlay-backdrop']) {
      Object.assign(state, { overlay: 'library', libraryDraft: { kind: 'save', target: null, text: 'x', error: '' } });
      const el = new FakeEl('div', { act }, pane);
      dispatch(el, 'pointerdown');
      dispatch(el, 'click');
      expect(state.overlay, act).toBe(null);
      expect(state.libraryDraft, act).toBe(null);
    }
  });
});

describe('using a template', () => {
  it('asks before replacing an edited schedule — the window’s own dialog — and Use replaces it on yes', async () => {
    Object.assign(state, { dirty: true, librarySel: 'b:wall-schedule' });
    click({ act: 'library-use' });
    expect(dialog.asked.at(-1)).toMatchObject({
      message: 'Replace the edited “Door Schedule”? Changes not saved to it are lost.', confirm: 'Replace', title: 'Schedules',
    });
    expect(state.templateId).toBe(null);
    dialog.answer(true);
    await vi.runAllTimersAsync();
    expect(state.templateId).toBe('wall-schedule');
    expect(state.def.name).toBe('Wall Schedule');
    expect(state.overlay).toBe(null);
  });

  it('reverts the one in use after asking', async () => {
    Object.assign(state, { dirty: true, templateId: 'door-schedule', librarySel: 'b:door-schedule' });
    expect(renderLibrary(state, store)).toContain('Revert to saved');
    click({ act: 'library-use' });
    expect(dialog.asked.at(-1)).toMatchObject({ confirm: 'Discard changes', danger: true });
    dialog.answer(false);
    await vi.runAllTimersAsync();
    expect(state.dirty).toBe(true);
  });

  it('a second click on the selected row uses it; a saved one loads as its setup', () => {
    state.librarySel = 'b:wall-schedule';
    click({ act: 'library-row', id: 'b:window-schedule' });
    expect(state.librarySel).toBe('b:window-schedule');
    expect(state.overlay).toBe('library');
    click({ act: 'library-row', id: 'b:window-schedule' }, 2);
    expect(state.templateId).toBe('window-schedule');

    saveSchedule(def('Mine A'), null);
    state.overlay = 'library';
    click({ act: 'library-row', id: 'm:Mine A' });
    click({ act: 'library-row', id: 'm:Mine A' }, 2);
    expect([state.savedName, state.templateId, state.overlay]).toEqual(['Mine A', null, null]);
  });
});
