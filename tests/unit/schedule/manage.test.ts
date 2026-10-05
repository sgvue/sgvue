// The Schedules window's side of Ask Vee's `manage_schedules` (2026-10-02, phase 4 of the
// assistant's parity work): a request that arrives over the port names one of this window's own
// controls, and what runs is that control's own handler (`schedule-ui/actions.ts`) — the same
// function the click runs. Three things are only ever put in front of the user here (deleting
// a saved setup, printing, opening a schedule file), and so is a save or a duplicate that would
// take a saved setup away.
//
// Runs in Node: `localStorage`, the toast's `document`, `window.print` and the preload's
// bridge are stood in for, and this window's own dialog is a recording one a test answers.
//
// The follow-up of the same day: every question raised for the assistant is asked as one —
// under its name and with no default button (`FOR_ASSISTANT`; what that does to the focus is
// `dialog.test.ts`) — and `print` asks in this window's own confirm before the print dialog.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetHistory, undoDepth, redoDepth } from '../../../src/schedule/history';
import { StoreBuilder } from '../../../src/schedule/ifc/store';
import type { ElemCore, ModelMeta } from '../../../src/schedule/ifc/types';
import {
  FromSchedules, isSafeName, MANAGE_ACK_MS, MANAGE_FRESH_MS, MANAGE_NAME_MAX, MANAGE_OPS, MANAGE_RESULTS,
  MANAGE_SAVED_MAX, ManageAckMessage, ManageMessage, SafeName, ToSchedules, type ManageRequest,
} from '../../../src/schedule/messages';
import { emptySchedule, type Column, type ScheduleDef } from '../../../src/schedule/schedule/def';
import { presetsFor } from '../../../src/schedule/schedule/presets';
import {
  applyTemplate, askDeleteSaved, duplicateSaved, loadSaved, printSchedule, renameSaved, saveCurrent, stepHistory,
} from '../../../src/renderer/schedule-ui/actions';
import { ASKER, FOR_ASSISTANT, manageFromChat } from '../../../src/renderer/schedule-ui/manage';
import {
  CAP, forgottenByDuplicate, forgottenBySave, listSaved, SAVED_KEY, saveSchedule,
} from '../../../src/renderer/schedule-ui/schedules';
import { state, update } from '../../../src/renderer/schedule-ui/state';

/** This window's dialog, recorded: every question asked, and a way to answer the one that is up. */
const dialog = vi.hoisted(() => ({
  open: false,
  /** `forAssistant`: asked with no default button — the focus on the card, not on the confirm. */
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

const meta: ModelMeta = {
  fileName: 'f.ifc', schema: 'IFC4', projectName: '', authoringTool: '',
  lengthUnit: 'mm', unitSystem: 'metric', elementCount: 0, parseMs: 0,
};
const core = (entity: string, name: string): ElemCore => ({
  entity, name, description: '', mark: '', typeName: 'T', family: 'F', objectType: '', predefinedType: '',
  guid: name, storey: 'L1', storeyElevation: 0, building: '', site: '', space: '', material: '', discipline: 'ARC',
} as ElemCore);
function doorStore() {
  const b = new StoreBuilder();
  b.add([core('IfcDoor', 'D1'), core('IfcDoor', 'D2'), core('IfcWall', 'W1')], [{}, {}, {}]);
  return b.finish(meta);
}

const col: Column = { field: { kind: 'core', key: 'name' }, heading: 'Name' };
const def = (name: string, entity = ['IfcDoor']): ScheduleDef => ({ ...emptySchedule(name, entity), columns: [col] });
const names = (): string[] => listSaved().map((s) => s.name);

const cell = new Map<string, string>();
/** Toasts, in order: the same sentence whoever asked is the point of sharing the handler. */
let toasts: { text: string; bad: boolean }[] = [];
let printed = 0;
/** Every Open dialog main was asked for, with the answer the test gives it. */
let opened: ((text: string | null) => void)[] = [];
let n = 0;
const ask = (op: ManageRequest['op'], more: Partial<ManageRequest> = {}): ManageRequest =>
  ({ type: 'manage', n: ++n, at: Date.now(), op, ask: true, ...more });

beforeEach(() => {
  // The toast's 2.6 s timer (`flash`) on a fake clock, which `afterEach` drops: nothing is left running.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  cell.clear();
  toasts = [];
  printed = 0;
  opened = [];
  dialog.open = false;
  dialog.asked = [];
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (cell.has(k) ? cell.get(k)! : null),
    setItem: (k: string, v: string) => { cell.set(k, String(v)); },
    removeItem: (k: string) => { cell.delete(k); },
  });
  vi.stubGlobal('window', {
    print: () => { printed++; },
    sgvueSchedule: {
      saveExport: async () => ({ saved: false }),
      openScheduleFile: () => new Promise<{ text: string } | null>((resolve) => {
        opened.push((text) => resolve(text === null ? null : { text }));
      }),
    },
  });
  vi.stubGlobal('document', {
    createElement: () => {
      const el = {
        className: '', textContent: '',
        setAttribute: () => undefined, remove: () => undefined,
      };
      toasts.push(el as never);
      return el;
    },
    body: { appendChild: () => undefined },
  });
  state.store = doorStore();
  state.def = def('Door Schedule');
  state.savedName = null;
  state.templateId = null;
  state.dirty = false;
  state.overlay = null;
  resetHistory(state.def);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  state.store = null;
});

/** What the last toast said. `flash` writes `textContent` and a class on the element it made. */
const lastToast = (): string => (toasts.at(-1) as unknown as { textContent: string }).textContent;

/* ────────────────────────────── the port's messages ────────────────────────────── */

describe('the `manage` and `manageAck` messages', () => {
  it('carry an operation, a request number, when it was asked, at most two names and one flag — and nothing else', () => {
    const ok = { type: 'manage', n: 1, at: 1_700_000_000_000, op: 'rename', name: 'Doors', to: 'Doors L2', ask: true };
    expect(ManageMessage.parse(ok)).toEqual(ok);
    expect(ToSchedules.safeParse(ok).success).toBe(true);
    for (const op of MANAGE_OPS) expect([op, ManageMessage.safeParse({ ...ok, op }).success]).toEqual([op, true]);
    // Strict: a definition, a path, file content or element ids make it no message at all.
    for (const extra of [{ def: {} }, { path: 'C:/x.schedule.json' }, { text: '{}' }, { ids: [1] }, { kind: 'isolate' }]) {
      expect([JSON.stringify(extra), ManageMessage.safeParse({ ...ok, ...extra }).success]).toEqual([JSON.stringify(extra), false]);
    }
    for (const bad of [
      { ...ok, op: 'open' }, // opening the window is the main window's, never this side's
      { ...ok, op: 'act' },
      { ...ok, op: 'export' },
      { ...ok, n: -1 },
      { ...ok, n: 1.5 },
      { ...ok, at: 'now' },
      { ...ok, ask: 'yes' },
      { ...ok, ask: undefined },
      { ...ok, name: '' },
      { ...ok, name: 'x'.repeat(MANAGE_NAME_MAX + 1) },
      { ...ok, to: 'two\nlines' },
      { ...ok, to: 'turned\u202Eround' },
    ]) {
      expect([JSON.stringify(bad), ManageMessage.safeParse(bad).success]).toEqual([JSON.stringify(bad), false]);
    }
    // The asker waits longer than the window will still act: an answer always comes in time.
    expect(MANAGE_FRESH_MS).toBeLessThan(MANAGE_ACK_MS);
  });

  it('a name crosses only as it can be shown: bounded, with no control or direction character', () => {
    for (const name of ['Door Schedule', 'Doors — level 3 (2)', 'é 楼 العربية', 'x'.repeat(MANAGE_NAME_MAX)]) {
      expect([name, isSafeName(name)]).toEqual([name, true]);
    }
    for (const name of ['', 'x'.repeat(MANAGE_NAME_MAX + 1), 'a\nb', 'a\tb', 'a\u0000b', 'a\u007Fb', 'a\u0085b',
      'a\u200Bb', 'a\u200Fb', 'a\u202Ab', 'a\u202Eb', 'a\u2066b', 'a\u2069b', 7, null, undefined]) {
      expect([JSON.stringify(name), isSafeName(name)]).toEqual([JSON.stringify(name), false]);
    }
    expect(SafeName.safeParse('ok').success).toBe(true);
  });

  it('the answer is a result and, per operation, a name, a count or one bounded list — strict, field by field', () => {
    const ack = { type: 'manageAck', n: 3, result: 'done' };
    expect(FromSchedules.safeParse(ack).success).toBe(true);
    for (const result of MANAGE_RESULTS) expect([result, ManageAckMessage.safeParse({ ...ack, result }).success]).toEqual([result, true]);
    const saved = { name: 'Doors', classes: ['IfcDoor'], columns: 3, saved: '2026-10-02', inUse: true, lacks: false };
    const template = { id: 'door-schedule', name: 'Door Schedule', classes: ['IfcDoor'], columns: 7, fit: 5, elements: 17, inUse: false };
    expect(ManageAckMessage.safeParse({ ...ack, saved: [saved], unlisted: 2, templates: [template], undo: 3, redo: 0, lacks: 1,
      name: 'Doors', forgets: 'replace', gone: 'Doors' }).success).toBe(true);
    for (const bad of [
      { ...ack, result: 'opened' },
      { ...ack, def: {} },
      { ...ack, text: '{}' },
      { ...ack, path: 'C:/x' },
      { ...ack, name: 'a\nb' },
      { ...ack, gone: 'x'.repeat(MANAGE_NAME_MAX + 1) },
      { ...ack, forgets: 'delete' },
      { ...ack, undo: -1 },
      { ...ack, undo: 1001 },
      { ...ack, saved: Array(MANAGE_SAVED_MAX + 1).fill(saved) },
      { ...ack, saved: [{ ...saved, name: 'two\nlines' }] },
      { ...ack, saved: [{ ...saved, def: {} }] },
      { ...ack, saved: [{ ...saved, saved: 'yesterday' }] },
      { ...ack, saved: [{ ...saved, classes: Array(13).fill('IfcDoor') }] },
      { ...ack, templates: [{ ...template, elements: -1 }] },
      { ...ack, templates: [{ ...template, note: 'x' }] },
      { ...ack, unlisted: MANAGE_SAVED_MAX + 1 },
    ]) {
      expect([JSON.stringify(bad).slice(0, 80), ManageAckMessage.safeParse(bad).success]).toEqual([JSON.stringify(bad).slice(0, 80), false]);
    }
  });
});

/* ────────────────────────────── the shared handlers ────────────────────────────── */

describe('the window’s own actions, as one function each', () => {
  it('stepHistory undoes and redoes the schedule, says how many steps are left, and drops both markers', () => {
    update({ def: { ...state.def, name: 'Edited' } });
    state.savedName = 'Door Schedule';
    state.templateId = 'door-schedule';
    expect(undoDepth()).toBe(1);
    expect(stepHistory(false)).toBe(true);
    expect(state.def.name).toBe('Door Schedule');
    expect([state.savedName, state.templateId]).toEqual([null, null]);
    expect(lastToast()).toBe('Undo — 0 steps left.');
    expect(stepHistory(false)).toBe(false);
    expect(lastToast()).toBe('Nothing to undo.');
    expect(stepHistory(true)).toBe(true);
    expect(state.def.name).toBe('Edited');
    expect(lastToast()).toBe('Redo — 0 steps left.');
    expect(stepHistory(true)).toBe(false);
    expect(lastToast()).toBe('Nothing to redo.');
  });

  it('applyTemplate and loadSaved each replace the schedule as one undo step, and mark where it came from', () => {
    const [preset] = presetsFor(state.store!.byEntity);
    applyTemplate(preset);
    expect([state.templateId, state.savedName, state.dirty]).toEqual([preset.id, null, false]);
    expect(lastToast()).toBe(`Applied “${preset.name}”.`);
    expect(undoDepth()).toBe(1);

    const entry = { name: 'Mine', def: def('Mine'), savedAt: '' };
    expect(loadSaved(entry)).toEqual([]);
    expect([state.savedName, state.templateId, state.def.name]).toEqual(['Mine', null, 'Mine']);
    // A copy: editing the schedule on screen never reaches the saved entry it came from.
    expect(state.def).not.toBe(entry.def);
    expect(lastToast()).toBe('Loaded “Mine”.');
    expect(undoDepth()).toBe(2);
    // Saved against another model: said, and the classes it lacks are handed back.
    expect(loadSaved({ name: 'Slabs', def: def('Slabs', ['IfcSlab', 'IfcDoor']), savedAt: '' })).toEqual(['IfcSlab']);
    expect(lastToast()).toBe('Loaded, but this model has no IfcSlab.');
  });

  it('saveCurrent saves under the schedule’s title, numbers a clash, and says what it did', () => {
    expect(saveCurrent()).toEqual({ result: 'done', name: 'Door Schedule' });
    expect([state.savedName, state.dirty, names()]).toEqual(['Door Schedule', false, ['Door Schedule']]);
    expect(lastToast()).toBe('Saved “Door Schedule”.');
    // Another schedule of the same title, loaded from nothing: a numbered copy, the first left alone.
    state.savedName = null;
    expect(saveCurrent()).toEqual({ result: 'done', name: 'Door Schedule (2)' });
    expect(lastToast()).toBe('Saved as “Door Schedule (2)” — “Door Schedule” is a different template and was left alone.');
    expect(names()).toEqual(['Door Schedule (2)', 'Door Schedule']);
    // Nothing to save, and a storage that refuses.
    state.def = { ...state.def, columns: [] };
    expect(saveCurrent()).toEqual({ result: 'nothing' });
    expect(lastToast()).toBe('Nothing to save — add a column first.');
    state.def = def('Other');
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('full'); } });
    expect(saveCurrent()).toEqual({ result: 'failed' });
    expect(lastToast()).toBe('Could not save — storage is unavailable or full.');
  });

  it('renameSaved and duplicateSaved are My templates’ own, and askDeleteSaved deletes only on its Delete button', async () => {
    saveSchedule(def('A'), null);
    saveSchedule(def('B'), null);
    state.savedName = 'A';
    state.def = def('A');
    expect(renameSaved('A', 'B')).toBe('taken');
    expect(lastToast()).toBe('A template called “B” already exists.');
    expect(renameSaved('Nope', 'C')).toBe('missing');
    expect(renameSaved('A', 'Doors')).toBe('ok');
    // The marker follows the name; the schedule on screen is called what its setup is.
    expect([state.savedName, state.def.name, names()]).toEqual(['Doors', 'Doors', ['B', 'Doors']]);
    expect(duplicateSaved('B')).toBe('B (2)');
    expect(lastToast()).toBe('Copied to “B (2)”.');
    expect(duplicateSaved('Nope')).toBeNull();

    // The user's own click: the window's label, and its confirm button takes the focus as ever.
    askDeleteSaved('Doors');
    expect(dialog.asked).toEqual([
      { message: 'Delete the saved template “Doors”? This cannot be undone.', confirm: 'Delete', danger: true, title: 'Schedules', forAssistant: false },
    ]);
    // Asked, and nothing is gone.
    expect(names()).toContain('Doors');
    dialog.answer(false);
    await Promise.resolve();
    expect(names()).toContain('Doors');
    // Raised for the assistant: the same words, under its name — and with no default button.
    expect(FOR_ASSISTANT).toEqual({ title: ASKER, forAssistant: true });
    askDeleteSaved('Doors', FOR_ASSISTANT);
    expect(dialog.asked[1]).toEqual({ ...dialog.asked[0], title: 'Ask Vee', forAssistant: true });
    dialog.answer(true);
    await vi.waitFor(() => expect(names()).not.toContain('Doors'));
    // The setup the marker pointed at is gone, and the marker with it.
    expect(state.savedName).toBeNull();
  });

  it('printSchedule is the native print dialog, and nothing else', () => {
    printSchedule();
    expect(printed).toBe(1);
  });
});

/* ────────────────────────────── what a save would forget ────────────────────────────── */

describe('a save, or a duplicate, that would take a saved setup away', () => {
  it('a save forgets nothing while the title is free or belongs to someone else — and replaces only its own', () => {
    expect(forgottenBySave(def('Doors'), null)).toEqual({ name: 'Doors', replaced: null, evicted: [] });
    saveSchedule(def('Doors'), null);
    // Not loaded from it: numbered, nothing replaced.
    expect(forgottenBySave(def('Doors'), null)).toEqual({ name: 'Doors (2)', replaced: null, evicted: [] });
    // Loaded from it: the saved copy is what a save replaces.
    expect(forgottenBySave(def('Doors'), 'Doors')).toEqual({ name: 'Doors', replaced: 'Doors', evicted: [] });
    // It says, and the save does: exactly this plan is what `saveSchedule` writes.
    expect(saveSchedule({ ...def('Doors'), columns: [col, col] }, 'Doors')).toBe('Doors');
    expect(listSaved()).toHaveLength(1);
  });

  it('at the cap a new one pushes the oldest off the end — and a duplicate does too', () => {
    for (let i = 1; i <= CAP; i++) saveSchedule(def(`S${i}`), null);
    expect(names()).toHaveLength(CAP);
    // Saves unshift: the oldest is last.
    expect(names().at(-1)).toBe('S1');
    expect(forgottenBySave(def('New'), null)).toEqual({ name: 'New', replaced: null, evicted: ['S1'] });
    // Replacing its own at the cap pushes nothing out.
    expect(forgottenBySave(def('S50'), 'S50')).toEqual({ name: 'S50', replaced: 'S50', evicted: [] });
    expect(forgottenByDuplicate('S100')).toEqual(['S1']);
    expect(forgottenByDuplicate('Nope')).toEqual([]);
    // One below the cap, neither forgets anything.
    cell.set(SAVED_KEY, JSON.stringify(listSaved().slice(0, CAP - 1)));
    expect(forgottenBySave(def('New'), null).evicted).toEqual([]);
    expect(forgottenByDuplicate('S100')).toEqual([]);
  });
});

/* ────────────────────────────── a request from chat ────────────────────────────── */

describe('manage_schedules, in the Schedules window', () => {
  it('undo and redo run the header buttons’ own handler and report the steps left', () => {
    update({ def: { ...state.def, name: 'Edited' } });
    expect(manageFromChat(ask('undo'))).toEqual({ ack: { result: 'done', undo: 0, redo: 1 } });
    expect(state.def.name).toBe('Door Schedule');
    expect(lastToast()).toBe('Undo — 0 steps left.');
    expect(manageFromChat(ask('undo'))).toEqual({ ack: { result: 'nothing', undo: 0, redo: 1 } });
    expect(manageFromChat(ask('redo'))).toEqual({ ack: { result: 'done', undo: 1, redo: 0 } });
    expect(state.def.name).toBe('Edited');
    expect([undoDepth(), redoDepth()]).toEqual([1, 0]);
  });

  it('lists the gallery’s templates for this model, and applies one by its id or its name', () => {
    const offered = presetsFor(state.store!.byEntity);
    expect(offered.length).toBeGreaterThan(0);
    const { ack } = manageFromChat(ask('templates'));
    expect(ack.result).toBe('done');
    expect(ack.templates!.map((t) => t.id)).toEqual(offered.map((p) => p.id));
    for (const t of ack.templates!) {
      expect([t.id, t.fit <= t.columns, t.elements > 0, t.inUse]).toEqual([t.id, true, true, false]);
    }
    // It crosses the port as it stands.
    expect(ManageAckMessage.safeParse({ type: 'manageAck', n: 1, ...ack }).success).toBe(true);

    const preset = offered[0];
    expect(manageFromChat(ask('apply_template', { name: preset.name.toUpperCase() }))).toEqual({
      ack: { result: 'done', name: preset.name },
    });
    expect([state.templateId, undoDepth()]).toEqual([preset.id, 1]);
    expect(lastToast()).toBe(`Applied “${preset.name}”.`);
    expect(manageFromChat(ask('templates')).ack.templates!.find((t) => t.id === preset.id)!.inUse).toBe(true);
    expect(manageFromChat(ask('apply_template', { name: preset.id })).ack).toEqual({ result: 'done', name: preset.name });
    // Only what the gallery offers for this model: a template for a class it lacks is not one.
    expect(manageFromChat(ask('apply_template', { name: 'No such template' })).ack).toEqual({ result: 'missing' });
    expect(manageFromChat(ask('apply_template')).ack).toEqual({ result: 'missing' });
  });

  it('lists the saved setups — names that can be shown — and counts the ones that cannot', () => {
    expect(manageFromChat(ask('saved_list')).ack).toEqual({ result: 'done', saved: [], unlisted: 0 });
    saveSchedule(def('Slabs', ['IfcSlab']), null);
    saveSchedule(def('Doors'), null);
    state.savedName = 'Doors';
    cell.set(SAVED_KEY, JSON.stringify([
      ...listSaved(),
      { name: 'two\nlines', def: def('two\nlines'), savedAt: '' },
      { name: 'x'.repeat(MANAGE_NAME_MAX + 1), def: def('long'), savedAt: '' },
    ]));
    const { ack } = manageFromChat(ask('saved_list'));
    expect(ack).toEqual({
      result: 'done',
      saved: [
        { name: 'Doors', classes: ['IfcDoor'], columns: 1, saved: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), inUse: true, lacks: false },
        { name: 'Slabs', classes: ['IfcSlab'], columns: 1, saved: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), inUse: false, lacks: true },
      ],
      unlisted: 2,
    });
    expect(ManageAckMessage.safeParse({ type: 'manageAck', n: 1, ...ack }).success).toBe(true);
  });

  it('loads a saved setup by its name, in any case, as one undo step', () => {
    saveSchedule({ ...def('Fire doors'), columns: [col, col] }, null);
    saveSchedule(def('Slabs', ['IfcSlab']), null);
    expect(manageFromChat(ask('load', { name: 'fire DOORS' })).ack).toEqual({ result: 'done', name: 'Fire doors', lacks: 0 });
    expect([state.savedName, state.def.columns.length, undoDepth()]).toEqual(['Fire doors', 2, 1]);
    expect(manageFromChat(ask('load', { name: 'Slabs' })).ack).toEqual({ result: 'done', name: 'Slabs', lacks: 1 });
    expect(manageFromChat(ask('load', { name: 'Nope' })).ack).toEqual({ result: 'missing' });
    expect(manageFromChat(ask('load')).ack).toEqual({ result: 'missing' });
  });

  it('saves when nothing is taken away, renames and duplicates — each the panel’s own action', () => {
    expect(manageFromChat(ask('save'))).toEqual({ ack: { result: 'done', name: 'Door Schedule' } });
    expect([names(), state.savedName]).toEqual([['Door Schedule'], 'Door Schedule']);
    expect(manageFromChat(ask('rename', { name: 'door schedule', to: 'Doors' })).ack).toEqual({ result: 'done', name: 'Doors' });
    expect([names(), state.savedName, state.def.name]).toEqual([['Doors'], 'Doors', 'Doors']);
    expect(manageFromChat(ask('rename', { name: 'Doors', to: 'Doors' })).ack).toEqual({ result: 'nothing', name: 'Doors' });
    expect(manageFromChat(ask('rename', { name: 'Doors' })).ack).toEqual({ result: 'nothing', name: 'Doors' });
    expect(manageFromChat(ask('duplicate', { name: 'Doors' })).ack).toEqual({ result: 'done', name: 'Doors (2)' });
    expect(manageFromChat(ask('rename', { name: 'Doors', to: 'Doors (2)' })).ack).toEqual({ result: 'taken' });
    expect(manageFromChat(ask('rename', { name: 'Nope', to: 'X' })).ack).toEqual({ result: 'missing' });
    expect(manageFromChat(ask('duplicate', { name: 'Nope' })).ack).toEqual({ result: 'missing' });
    // No dialog was raised for any of them.
    expect(dialog.asked).toEqual([]);
    // Nothing to save: no columns.
    state.def = { ...state.def, columns: [] };
    expect(manageFromChat(ask('save')).ack).toEqual({ result: 'nothing' });
  });

  it('a save over the setup the schedule was loaded from only asks — this window’s own question, and its Save', async () => {
    saveSchedule(def('Doors'), null);
    state.def = { ...def('Doors'), columns: [col, col] };
    state.savedName = 'Doors';
    const { ack, then } = manageFromChat(ask('save'));
    expect(ack).toEqual({ result: 'asked', forgets: 'replace', name: 'Doors', gone: 'Doors' });
    // Answered before anything is raised, and nothing was saved.
    expect(dialog.asked).toEqual([]);
    expect(listSaved()[0].def.columns).toHaveLength(1);
    then!();
    expect(dialog.asked).toEqual([{
      message: 'Save over the saved template “Doors”? What it holds now is replaced, and cannot be brought back.',
      confirm: 'Save', danger: false, title: 'Ask Vee', forAssistant: true,
    }]);
    // Cancel: nothing is saved.
    dialog.answer(false);
    await Promise.resolve();
    expect(listSaved()[0].def.columns).toHaveLength(1);
    // Asked again, and this time the user's own click saves it.
    manageFromChat(ask('save')).then!();
    dialog.answer(true);
    await vi.waitFor(() => expect(listSaved()[0].def.columns).toHaveLength(2));
    expect(lastToast()).toBe('Saved “Doors”.');
  });

  it('…and saves nothing if what would be forgotten has changed by the time of the click', async () => {
    saveSchedule(def('Doors'), null);
    state.def = { ...def('Doors'), columns: [col, col] };
    state.savedName = 'Doors';
    manageFromChat(ask('save')).then!();
    // The user loads something else while the question is up: the question is about another save now.
    state.savedName = null;
    dialog.answer(true);
    await vi.waitFor(() => expect(lastToast()).toBe('The schedule or the saved templates changed since that was asked — nothing was saved.'));
    expect(names()).toEqual(['Doors']);
    expect(listSaved()[0].def.columns).toHaveLength(1);
  });

  it('at the cap a save or a duplicate that would push the oldest out asks, naming it', async () => {
    for (let i = 1; i <= CAP; i++) saveSchedule(def(`S${i}`), null);
    state.def = def('New');
    const save = manageFromChat(ask('save'));
    expect(save.ack).toEqual({ result: 'asked', forgets: 'evict', name: 'New', gone: 'S1' });
    expect(names()).not.toContain('New');
    save.then!();
    expect(dialog.asked[0]).toEqual({
      message: 'Save “New” to My templates? Only 100 are kept, so the oldest — “S1” — would be forgotten, and cannot be brought back.',
      confirm: 'Save', danger: false, title: 'Ask Vee', forAssistant: true,
    });
    dialog.answer(false);
    await Promise.resolve();
    const copy = manageFromChat(ask('duplicate', { name: 'S100' }));
    expect(copy.ack).toEqual({ result: 'asked', forgets: 'evict', name: 'S100', gone: 'S1' });
    copy.then!();
    expect(dialog.asked[1]).toEqual({
      message: 'Duplicate the saved template “S100”? Only 100 are kept, so the oldest — “S1” — would be forgotten, and cannot be brought back.',
      confirm: 'Duplicate', danger: false, title: 'Ask Vee', forAssistant: true,
    });
    dialog.answer(true);
    await vi.waitFor(() => expect(names()).toContain('S100 (2)'));
    expect(names()).not.toContain('S1');
    expect(names()).toHaveLength(CAP);
  });

  it('quotes a name in its question without control or direction characters', async () => {
    // A setup the user saved long ago under a name that turns text round and breaks the line.
    const RLO = String.fromCharCode(0x202e);
    const hostile = `Doors${RLO} — nothing is replaced${String.fromCharCode(10)}really`;
    cell.set(SAVED_KEY, JSON.stringify([{ name: hostile, def: def(hostile), savedAt: '' }]));
    state.def = { ...def(hostile), columns: [col, col] };
    state.savedName = hostile;
    const { ack, then } = manageFromChat(ask('save'));
    // The name cannot cross the port, so the answer names nothing…
    expect(ack).toEqual({ result: 'asked', forgets: 'replace' });
    then!();
    // …and the question shows it with nothing unseen in it.
    expect(dialog.asked[0].message).toBe(
      'Save over the saved template “Doors — nothing is replacedreally”? What it holds now is replaced, and cannot be brought back.',
    );
    expect(/[\u0000-\u001f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/.test(dialog.asked[0].message)).toBe(false);
    dialog.answer(false);
    await Promise.resolve();
  });

  it('holds such a save when the turn has already asked for something: nothing is raised, nothing saved', () => {
    saveSchedule(def('Doors'), null);
    state.def = { ...def('Doors'), columns: [col, col] };
    state.savedName = 'Doors';
    const held = manageFromChat(ask('save', { ask: false }));
    expect(held).toEqual({ ack: { result: 'held', forgets: 'replace', name: 'Doors', gone: 'Doors' } });
    expect(held.then).toBeUndefined();
    expect(dialog.asked).toEqual([]);
    expect(listSaved()[0].def.columns).toHaveLength(1);
    // A save that forgets nothing needs no question, and is done whatever the flag says.
    state.savedName = null;
    expect(manageFromChat(ask('save', { ask: false })).ack).toEqual({ result: 'done', name: 'Doors (2)' });
  });

  it('delete, print and open_file only ask: answered at once, and the dialog comes afterwards', async () => {
    vi.useFakeTimers();
    saveSchedule(def('Doors'), null);
    const del = manageFromChat(ask('delete', { name: 'doors' }));
    expect(del.ack).toEqual({ result: 'asked', name: 'Doors' });
    expect([dialog.asked, names()]).toEqual([[], ['Doors']]);
    del.then!();
    expect(dialog.asked).toEqual([
      { message: 'Delete the saved template “Doors”? This cannot be undone.', confirm: 'Delete', danger: true, title: 'Ask Vee', forAssistant: true },
    ]);
    // Still there: only the user's click on Delete removes it.
    expect(names()).toEqual(['Doors']);
    dialog.answer(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(names()).toEqual(['Doors']);
    expect(manageFromChat(ask('delete', { name: 'Nope' })).ack).toEqual({ result: 'missing' });

    // Print asks in this window's own confirm first: the native print dialog's default button
    // prints, so it is never raised straight from chat.
    const print = manageFromChat(ask('print'));
    expect(print.ack).toEqual({ result: 'asked' });
    expect(printed).toBe(0);
    print.then!();
    expect(dialog.asked.at(-1)).toEqual({
      message: 'Open the print dialog for this schedule?', confirm: 'Print…', danger: false, title: 'Ask Vee', forAssistant: true,
    });
    // Asked, and no print dialog — not now, and not on a later task either.
    await vi.advanceTimersByTimeAsync(1000);
    expect(printed).toBe(0);
    // While it is up, the window is the user's.
    expect(manageFromChat(ask('print')).ack).toEqual({ result: 'busy' });
    // Cancel: nothing opens.
    dialog.answer(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(printed).toBe(0);
    // Asked again, and the user's click on Print… is what opens the print dialog — once.
    manageFromChat(ask('print')).then!();
    expect(printed).toBe(0);
    dialog.answer(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(printed).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(printed).toBe(1);

    const open = manageFromChat(ask('open_file'));
    expect(open.ack).toEqual({ result: 'asked' });
    expect(opened).toHaveLength(0);
    open.then!();
    expect(opened).toHaveLength(1);
    // While that Open dialog is up, a second request raises nothing.
    expect(manageFromChat(ask('open_file')).ack).toEqual({ result: 'busy' });
    expect(manageFromChat(ask('print')).ack).toEqual({ result: 'busy' });
    expect(manageFromChat(ask('delete', { name: 'Doors' })).ack).toEqual({ result: 'busy' });
    // …and nothing is changed under it either (the review's leftover): a native dialog is one of
    // the window's own dialogs, and while one is up the window is the user's — the operations
    // that act at once are busy too, as they are under its own confirm. (They ran until then.)
    update({ def: { ...state.def, name: 'Edited' } });
    const [was, steps] = [state.def, undoDepth()];
    for (const [op, more] of [
      ['load', { name: 'Doors' }], ['undo', {}], ['redo', {}], ['apply_template', { name: 'door-schedule' }],
      ['save', {}], ['rename', { name: 'Doors', to: 'X' }], ['duplicate', { name: 'Doors' }],
    ] as const) {
      expect([op, manageFromChat(ask(op, more)).ack]).toEqual([op, { result: 'busy' }]);
    }
    expect([state.def, state.savedName, undoDepth(), names()]).toEqual([was, null, steps, ['Doors']]);
    // It still lists: reading changes nothing.
    expect(manageFromChat(ask('saved_list')).ack.result).toBe('done');
    expect(manageFromChat(ask('templates')).ack.result).toBe('done');
    // The file the user picks becomes the schedule — this window's own "Open schedule file…".
    opened[0](JSON.stringify(def('From a file')));
    await vi.waitFor(() => expect(state.def.name).toBe('From a file'));
    expect(manageFromChat(ask('open_file')).ack).toEqual({ result: 'asked' });
  });

  it('with ask:false none of the three is raised; they are held', () => {
    saveSchedule(def('Doors'), null);
    for (const [op, more] of [['delete', { name: 'Doors' }], ['print', {}], ['open_file', {}]] as const) {
      const out = manageFromChat(ask(op, { ...more, ask: false }));
      expect([op, out.ack.result, out.then]).toEqual([op, 'held', undefined]);
    }
    expect([dialog.asked, printed, opened.length, names()]).toEqual([[], 0, 0, ['Doors']]);
  });

  it('while one of the window’s own dialogs is up it changes nothing — but still lists', () => {
    saveSchedule(def('Doors'), null);
    update({ def: { ...state.def, name: 'Edited' } });
    dialog.open = true;
    for (const [op, more] of [
      ['undo', {}], ['redo', {}], ['apply_template', { name: 'door-schedule' }], ['load', { name: 'Doors' }], ['save', {}],
      ['rename', { name: 'Doors', to: 'X' }], ['duplicate', { name: 'Doors' }], ['delete', { name: 'Doors' }], ['print', {}], ['open_file', {}],
    ] as const) {
      expect([op, manageFromChat(ask(op, more)).ack]).toEqual([op, { result: 'busy' }]);
    }
    expect([state.def.name, names(), printed, opened.length]).toEqual(['Edited', ['Doors'], 0, 0]);
    expect(manageFromChat(ask('saved_list')).ack.result).toBe('done');
    expect(manageFromChat(ask('templates')).ack.result).toBe('done');
  });

  it('says so when the window shows no schedule', () => {
    state.store = null;
    for (const op of ['undo', 'redo', 'templates', 'apply_template', 'load', 'save', 'print', 'open_file'] as const) {
      expect([op, manageFromChat(ask(op, { name: 'x' })).ack]).toEqual([op, { result: 'no_schedule' }]);
    }
    // The saved setups are this computer's, model or no model.
    expect(manageFromChat(ask('saved_list')).ack).toEqual({ result: 'done', saved: [], unlisted: 0 });
  });

  it('every answer it can give crosses the port as it stands', () => {
    for (let i = 1; i <= CAP; i++) saveSchedule(def(`S${i}`), null);
    state.def = def('New');
    for (const m of [
      ask('undo'), ask('redo'), ask('templates'), ask('saved_list'), ask('apply_template', { name: 'x' }),
      ask('load', { name: 'S7' }), ask('save'), ask('save', { ask: false }), ask('rename', { name: 'S1', to: 'S2' }),
      ask('duplicate', { name: 'S3' }), ask('delete', { name: 'S4' }), ask('print', { ask: false }), ask('open_file', { ask: false }),
    ]) {
      const { ack } = manageFromChat(m);
      const parsed = ManageAckMessage.safeParse({ type: 'manageAck', n: m.n, ...ack });
      expect([m.op, parsed.success]).toEqual([m.op, true]);
      dialog.open = false;
    }
  });
});
