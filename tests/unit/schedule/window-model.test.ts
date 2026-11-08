// The Schedules window as a state machine — v1.5.0, check 3 of the Schedules safety net.
//
// Model-based (`fc.commands`, fast-check 4.10.2): sequences of what a user and the assistant do
// in that window are run against the REAL window — its composition root `schedule-ui/main.ts`
// on the fake DOM (`support/windowHarness.ts`), fed over its real port handler — and against a
// small model of what must hold, compared after EVERY command. A failure is shrunk to the
// shortest sequence that still fails, and fast-check prints the seed and path that replay it
// (`SIM_SEED=<seed>` reruns that seed here).
//
// What runs, and through which door:
//   · column / filter / sort edits — the delegated click handlers of `events.ts` (`col-remove`,
//     a heading's click that opens its column menu, `filter-remove`, `filter-logic`, `sort-dir`,
//     `undo`, `redo`, `close-overlay`) dispatched on the fake DOM, and `state.ts` `updateDef`
//     with the pure action for the controls that type or pick (add a column, a filter, a sort
//     level; a heading; hide);
//   · the assistant: `define` and `manage` (undo, redo, save, delete) arriving on the port —
//     main.ts's own `receive`;
//   · the Templates library: `libraryActions.ts` (`quickSave` → `commitSave`) and `actions.ts`
//     (`applyTemplate`, `loadSaved`, `renameSaved`, `duplicateSaved`, `askDeleteSaved`) — the
//     bodies the library's buttons run; the confirm dialog is answered yes or no by the command;
//   · Import: `exporting.ts` `openScheduleFile`, the native Open dialog stubbed to hand back a
//     schedule file's text (or junk);
//   · a project's lists opening and closing, and a model reload — `projectSchedules` and
//     `store` on the port.
//
// After every command:
//   · the definition on screen is the model's, byte for byte, and so are the undo and redo
//     depths; an undo or redo lands on exactly the definition the model holds — the one that
//     was on screen before the change it undoes; the history never holds more than 60
//     (`history.ts` LIMIT, written out here);
//   · the saved list never loses an entry except by a confirmed delete (a "no" leaves it byte
//     for byte), a confirmed save-over replaces content but no name, a rename moves one name,
//     and at the cap of 100 anything that would add one is refused;
//   · while a project's list is open, `localStorage` is never written and every write is
//     reported back as `projectSaved`; with none open nothing is reported, and closing the
//     project gives back exactly the window's own list;
//   · the column menu, when open, names a column that exists; no dialog is left up.

import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { snapshotOf, type ScheduleSnapshot } from '../../../src/schedule/adapter';
import { redoDepth, setClock, undoDepth } from '../../../src/schedule/history';
import { StoreBuilder, type ModelStore } from '../../../src/schedule/ifc/store';
import * as act from '../../../src/schedule/schedule/actions';
import { columnForCore, openingSchedule } from '../../../src/schedule/schedule/columns';
import { CORE_KEYS, parseScheduleDef, type ScheduleDef } from '../../../src/schedule/schedule/def';
import { presetsFor } from '../../../src/schedule/schedule/presets';
import { federate } from '../../../src/shared/federate';
import { mockModelIndex } from '../../../src/renderer/dev/mock-adapter';
import { FakeEl } from './support/fakeDom';
import { allCases } from './support/fixture';
import { dialogModule, fakePort, installWindow, type DialogMock, type FakePort, type Window } from './support/windowHarness';

const dialog = vi.hoisted(() => ({ open: false, asked: [], answer: () => undefined }) as unknown as DialogMock);
vi.mock('../../../src/renderer/schedule-ui/dialog', () => dialogModule(dialog));

/** `history.ts`'s LIMIT and `schedules.ts`'s CAP — written out, not imported. */
const HISTORY_LIMIT = 60;
const SAVED_CAP = 100;
const SAVED_KEY = 'sgvue.schedules.saved.v1';

const SEED = process.env.SIM_SEED === undefined ? 20261108 : Number(process.env.SIM_SEED);
const RUNS = Number(process.env.WINDOW_RUNS ?? 40);
const MAX_COMMANDS = 60;

/* ────────────────────────────── the window under test ────────────────────────────── */

type Mods = {
  state: typeof import('../../../src/renderer/schedule-ui/state');
  actions: typeof import('../../../src/renderer/schedule-ui/actions');
  library: typeof import('../../../src/renderer/schedule-ui/libraryActions');
  schedules: typeof import('../../../src/renderer/schedule-ui/schedules');
  exporting: typeof import('../../../src/renderer/schedule-ui/exporting');
  columnMenu: typeof import('../../../src/renderer/schedule-ui/columnMenu');
  popover: typeof import('../../../src/renderer/schedule-ui/popover');
};
let W: Window;
let M: Mods;
let port: FakePort;
/** Everything the window posted to the main window, in order. */
const sent: { type: string; [k: string]: unknown }[] = [];
let clock = 1_000_000;
let n = 0;

const SNAPS: Record<'doors' | 'site', ScheduleSnapshot> = {
  doors: snapshotOf(federate(['ARC', 'STR'].map((k) => mockModelIndex(k)))),
  site: snapshotOf(federate(['SIT'].map((k) => mockModelIndex(k)))),
};
const storeOf = (s: ScheduleSnapshot): ModelStore => {
  const b = new StoreBuilder();
  b.add(s.cores, s.cells);
  return b.finish(s.meta);
};
const CASES = allCases();

/** A message from the main window, delivered the way the real port delivers: one at a time. */
const deliver = (data: unknown) => port.onmessage!({ data: structuredClone(data) });
const defJson = () => JSON.stringify(M.state.state.def);
const names = () => M.schedules.listSaved().map((s) => s.name);
const savedJson = () => JSON.stringify(M.schedules.listSaved());

/** A click on a control the window draws — a fake element carrying its data attributes. */
function click(tag: string, data: Record<string, string>) {
  const pane = W.pane('output-pane');
  const el = new FakeEl(tag, data, pane);
  W.dispatch(el, 'click', {});
  // A repaint in between rebuilt the pane's children already.
  const at = pane.children.indexOf(el);
  if (at >= 0) pane.children.splice(at, 1);
}

/** A click on a heading the table drew (support/windowHarness.ts builds them from its markup). */
function clickHeading(defcol: number): boolean {
  const th = W.pane('output-pane').children.find((c) => c.tag === 'th' && c.dataset.defcol === String(defcol));
  if (th) W.dispatch(th, 'click', {});
  return !!th;
}

/** Let promise chains (a dialog's answer) and the window's own short timers run. */
async function settle() {
  await vi.advanceTimersByTimeAsync(300);
}

beforeAll(async () => {
  vi.useFakeTimers();
  W = installWindow();
  await import('../../../src/renderer/schedule-ui/main');
  M = {
    state: await import('../../../src/renderer/schedule-ui/state'),
    actions: await import('../../../src/renderer/schedule-ui/actions'),
    library: await import('../../../src/renderer/schedule-ui/libraryActions'),
    schedules: await import('../../../src/renderer/schedule-ui/schedules'),
    exporting: await import('../../../src/renderer/schedule-ui/exporting'),
    columnMenu: await import('../../../src/renderer/schedule-ui/columnMenu'),
    popover: await import('../../../src/renderer/schedule-ui/popover'),
  };
  setClock(() => clock);
});
afterAll(() => {
  vi.useRealTimers();
});

/* ────────────────────────────── the model ────────────────────────────── */

interface Model {
  /** The definition on screen, as JSON — and the one the history holds as current. */
  screen: string;
  undo: string[];
  redo: string[];
  projectOn: boolean;
  /** The window's own list, as stored, while a project's list stands in for it. */
  localRaw: string | null;
  store: 'doors' | 'site';
}

/** A change the window records: what was on screen goes on the undo stack, unless nothing changed. */
function recorded(m: Model, after: string) {
  if (after !== m.screen) {
    m.undo.push(m.screen);
    if (m.undo.length > HISTORY_LIMIT) m.undo.shift();
    m.redo = [];
  }
  m.screen = after;
}

/**
 * A change the window makes to the definition on screen that is not an undo step — a save under
 * a numbered name, a rename of the setup on screen. The history holds it as current from here.
 */
function unrecorded(m: Model) {
  m.screen = defJson();
}

/** An undo or a redo: the step the model holds, exactly. */
function step(m: Model, from: string[], to: string[]) {
  if (!from.length) return;
  to.push(m.screen);
  m.screen = from.pop()!;
}

const reached = { undoTop: 0, redoTop: 0, atCap: 0, capRefused: 0, deletesYes: 0, deletesNo: 0, saveOverYes: 0,
  saveOverNo: 0, imports: 0, projectWrites: 0, reloadsReset: 0, menusOpen: 0, defines: 0, renamesOfOpen: 0 };

/* ────────────────────────────── the commands ────────────────────────────── */

type Cmd = fc.AsyncCommand<Model, object>;

/** One command: `run` does it to the real window and to the model, then every invariant is checked. */
function command(label: string, run: (m: Model) => Promise<void> | void, can: (m: Model) => boolean = () => true): Cmd {
  return {
    check: can,
    toString: () => label,
    run: async (m) => {
      clock += 1000;
      const posts = sent.length;
      await run(m);
      await settle();
      invariants(m, posts);
    },
  };
}

function invariants(m: Model, postsBefore: number) {
  const def = M.state.state.def;
  expect(defJson(), 'the definition on screen is not the model\'s').toBe(m.screen);
  expect([undoDepth(), redoDepth()], 'undo / redo depth').toEqual([m.undo.length, m.redo.length]);
  expect(undoDepth()).toBeLessThanOrEqual(HISTORY_LIMIT);
  reached.undoTop = Math.max(reached.undoTop, undoDepth());
  reached.redoTop = Math.max(reached.redoTop, redoDepth());
  const open = M.columnMenu.menuColumn();
  if (open !== null) {
    reached.menusOpen++;
    expect(open, 'the column menu names a column that is gone').toBeLessThan(def.columns.length);
  }
  expect(dialog.open, 'a dialog was left up').toBe(false);
  const list = M.schedules.listSaved();
  expect(list.length).toBeLessThanOrEqual(SAVED_CAP);
  if (list.length === SAVED_CAP) reached.atCap++;
  const reported = sent.slice(postsBefore).filter((x) => x.type === 'projectSaved');
  if (m.projectOn) {
    expect(W.storage.get(SAVED_KEY) ?? null, 'localStorage written while a project\'s list is open').toBe(m.localRaw);
    if (reported.length) {
      reached.projectWrites++;
      expect(JSON.stringify((reported.at(-1)!.saved as unknown[]).map((e) => (e as { name: string }).name)))
        .toBe(JSON.stringify(names()));
    }
  } else {
    expect(reported, 'a project write reported with no project open').toEqual([]);
  }
}

/** The saved list may only change as `allowed` says; anything else is a lost or invented entry. */
function listChange(before: string[], after: string[], allowed: { add?: number; remove?: string; rename?: [string, string] }) {
  let want = [...before];
  if (allowed.remove !== undefined) want = want.filter((x) => x !== allowed.remove);
  if (allowed.rename) want = want.map((x) => (x === allowed.rename![0] ? allowed.rename![1] : x));
  // Every entry that should still be there is.
  for (const name of want) expect(after, `the saved setup "${name}" was lost`).toContain(name);
  expect(after.length - want.length, 'entries added').toBeLessThanOrEqual(allowed.add ?? 0);
  expect(after.length - want.length).toBeGreaterThanOrEqual(0);
}

const defOf = (m: Model): ScheduleDef => JSON.parse(m.screen) as ScheduleDef;
const hasCols = (m: Model) => defOf(m).columns.length > 0;

/** A user edit through the pure action `updateDef` runs: recorded, and exactly that action. */
const edit = (label: string, fn: (d: ScheduleDef) => ScheduleDef, can?: (m: Model) => boolean) =>
  command(label, (m) => {
    const want = JSON.stringify(fn(defOf(m)));
    M.state.updateDef(fn);
    expect(defJson(), `${label}: not the action's result`).toBe(want);
    recorded(m, want);
  }, can);

/** A user edit through a click on the control `events.ts` delegates from. */
const clickEdit = (label: string, tag: string, data: (d: ScheduleDef) => Record<string, string>,
  fn: (d: ScheduleDef) => ScheduleDef, can: (m: Model) => boolean) =>
  command(label, (m) => {
    const d = defOf(m);
    const want = JSON.stringify(fn(d));
    click(tag, data(d));
    expect(defJson(), `${label}: not the action's result`).toBe(want);
    recorded(m, want);
  }, can);

const idx = (k: number, len: number) => ((k % len) + len) % len;

const edits = [
  fc.constantFrom(...CORE_KEYS).map((key) => edit(`add column ${key}`, (d) => act.addColumns(d, [columnForCore(key)]))),
  fc.nat().map((k) => clickEdit(`remove column #${k}`, 'button', (d) => ({ act: 'col-remove', i: String(idx(k, d.columns.length)) }),
    (d) => act.removeColumn(d, idx(k, d.columns.length)), hasCols)),
  fc.nat().map((k) => command(`click heading #${k}`, (m) => {
    clickHeading(idx(k, defOf(m).columns.length));
  }, hasCols)),
  fc.tuple(fc.nat(), fc.constantFrom('Renamed', 'W', '', 'Ünïcode m²')).map(([k, t]) => edit(`heading #${k} "${t}"`,
    (d) => act.setHeading(d, idx(k, d.columns.length), t), hasCols)),
  fc.tuple(fc.nat(), fc.boolean()).map(([k, on]) => edit(`hide #${k} ${on}`, (d) => act.setHidden(d, idx(k, d.columns.length), on), hasCols)),
  fc.constant(edit('add filter', (d) => act.addFilterRule(d))),
  fc.nat().map((k) => clickEdit(`remove filter #${k}`, 'button', (d) => ({ act: 'filter-remove', i: String(idx(k, d.filters.length)) }),
    (d) => act.removeFilterRule(d, idx(k, d.filters.length)), (m) => defOf(m).filters.length > 0)),
  fc.constantFrom('and', 'or').map((v) => clickEdit(`filter logic ${v}`, 'button', () => ({ act: 'filter-logic', v }),
    (d) => act.setFilterMode(d, v as 'and' | 'or'), () => true)),
  fc.constant(edit('add sort level', (d) => act.addSortLevel(d))),
  fc.tuple(fc.nat(), fc.constantFrom('asc', 'desc')).map(([k, v]) => clickEdit(`sort #${k} ${v}`, 'button',
    (d) => ({ act: 'sort-dir', i: String(idx(k, d.sort.length)), v }),
    (d) => act.setSortDir(d, idx(k, d.sort.length), v as 'asc' | 'desc'), (m) => defOf(m).sort.length > 0)),
];

const history = [
  fc.constantFrom('undo', 'redo').map((which) => command(which, (m) => {
    const from = which === 'undo' ? m.undo : m.redo;
    const to = which === 'undo' ? m.redo : m.undo;
    click('button', { act: which });
    step(m, from, to);
  })),
  // The assistant's `manage_schedules` undo / redo, over the port: the same step, and the answer.
  fc.constantFrom('undo', 'redo').map((op) => command(`assistant ${op}`, (m) => {
    const from = op === 'undo' ? m.undo : m.redo;
    const to = op === 'undo' ? m.redo : m.undo;
    const was = sent.length;
    deliver({ type: 'manage', n: ++n, at: Date.now(), op, ask: true });
    const ack = sent.slice(was).find((x) => x.type === 'manageAck');
    expect(ack?.n).toBe(n);
    expect(ack?.result).toBe(from.length ? 'done' : 'nothing');
    step(m, from, to);
  })),
];

// Long runs of steps, so the history's cap (60) and a deep redo stack are reached.
history.push(
  fc.integer({ min: 5, max: 40 }).map((k) => command(`${k} edits`, (m) => {
    for (let i = 0; i < k; i++) {
      clock += 1000;
      const fn = (d: ScheduleDef) => act.setName(d, `Run ${clock}`);
      M.state.updateDef(fn);
      recorded(m, defJson());
    }
  })),
  fc.integer({ min: 2, max: 30 }).map((k) => command(`undo ×${k}`, (m) => {
    for (let i = 0; i < k; i++) {
      click('button', { act: 'undo' });
      step(m, m.undo, m.redo);
      expect(defJson(), `undo ${i + 1} of ${k}`).toBe(m.screen);
    }
  })),
);

const assistant = [
  fc.tuple(fc.nat(), fc.constantFrom('made', 'edited')).map(([k, kind]) => command(`define ${CASES[k % CASES.length].id} (${kind})`, (m) => {
    const raw = CASES[k % CASES.length].def;
    deliver({ type: 'define', kind, def: raw });
    reached.defines++;
    expect(M.state.state.def.name).toBe(raw.name);
    expect(M.columnMenu.menuColumn(), 'a define leaves no menu over the old columns').toBeNull();
    recorded(m, defJson());
  })),
];

/** Pick a saved entry by index, or skip when the list is empty. */
const someSaved = () => names().length > 0;
const savedAt = (k: number) => names()[idx(k, names().length)];

const libraryCmds = [
  // The user's Save: the header's / the library's — `quickSave`, and the name row's `commitSave`.
  fc.constant(command('user save', (m) => {
    const before = names();
    const was = savedJson();
    M.library.quickSave();
    if (M.state.state.libraryDraft?.kind === 'save') M.library.commitSave();
    if (M.state.state.overlay) click('button', { act: 'close-overlay' });
    const after = names();
    listChange(before, after, { add: 1 });
    if (before.length >= SAVED_CAP && after.length === before.length && savedJson() === was) reached.capRefused++;
    // A save is not an edit: whatever the save did to the name on screen is not on the history.
    unrecorded(m);
  }, hasCols)),
  fc.nat().map((k) => command(`load saved #${k}`, (m) => {
    const entry = M.schedules.listSaved().find((s) => s.name === savedAt(k))!;
    M.actions.loadSaved(entry);
    recorded(m, defJson());
  }, someSaved)),
  fc.tuple(fc.nat(), fc.constantFrom('Doors L2', 'Walls', 'Door Schedule', ' ')).map(([k, to]) => command(`rename saved #${k} → "${to}"`, (m) => {
    const before = names();
    const old = savedAt(k);
    const wasOpen = M.state.state.savedName === old;
    const result = M.actions.renameSaved(old, to);
    listChange(before, names(), result === 'ok' ? { rename: [old, to.trim()] } : {});
    if (result === 'ok' && wasOpen) reached.renamesOfOpen++;
    unrecorded(m);
  }, someSaved)),
  fc.nat().map((k) => command(`duplicate saved #${k}`, () => {
    const before = names();
    const copy = M.actions.duplicateSaved(savedAt(k));
    listChange(before, names(), { add: 1 });
    if (copy === 'full') { reached.capRefused++; expect(names()).toEqual(before); }
  }, someSaved)),
  fc.tuple(fc.nat(), fc.boolean()).map(([k, yes]) => command(`delete saved #${k}, answer ${yes ? 'yes' : 'no'}`, async () => {
    const was = savedJson();
    const before = names();
    const name = savedAt(k);
    M.actions.askDeleteSaved(name);
    expect(dialog.open, 'Delete asks first').toBe(true);
    expect(names(), 'deleted before the answer').toEqual(before);
    dialog.answer(yes);
    await settle();
    if (yes) { reached.deletesYes++; listChange(before, names(), { remove: name }); expect(names()).not.toContain(name); }
    else { reached.deletesNo++; expect(savedJson(), 'a "no" changed the saved list').toBe(was); }
  }, someSaved)),
  // The assistant's save — over the setup it was loaded from, that asks first.
  fc.boolean().map((yes) => command(`assistant save, answer ${yes ? 'yes' : 'no'}`, async (m) => {
    const was = savedJson();
    const before = names();
    const at = sent.length;
    deliver({ type: 'manage', n: ++n, at: Date.now(), op: 'save', ask: true });
    const ack = sent.slice(at).find((x) => x.type === 'manageAck')!;
    if (ack.result === 'asked') {
      expect(names(), 'saved over before the answer').toEqual(before);
      expect(savedJson()).toBe(was);
      dialog.answer(yes);
      await settle();
      if (yes) { reached.saveOverYes++; listChange(before, names(), {}); } else {
        reached.saveOverNo++;
        expect(savedJson(), 'a "no" changed the saved list').toBe(was);
      }
    } else listChange(before, names(), { add: 1 });
    unrecorded(m);
  }, hasCols)),
  fc.tuple(fc.nat(), fc.boolean()).map(([k, yes]) => command(`assistant delete #${k}, answer ${yes ? 'yes' : 'no'}`, async () => {
    const was = savedJson();
    const before = names();
    const name = savedAt(k);
    const at = sent.length;
    deliver({ type: 'manage', n: ++n, at: Date.now(), op: 'delete', name, ask: true });
    const ack = sent.slice(at).find((x) => x.type === 'manageAck')!;
    if (ack.result !== 'asked') { expect(savedJson()).toBe(was); return; }
    expect(dialog.open).toBe(true);
    dialog.answer(yes);
    await settle();
    if (yes) listChange(before, names(), { remove: name }); else expect(savedJson()).toBe(was);
  }, () => someSaved() && names().every((x) => /^[^\p{Cc}]{1,200}$/u.test(x)))),
  fc.nat().map((k) => command(`use template #${k}`, (m) => {
    const presets = presetsFor(M.state.state.store!.byEntity);
    if (!presets.length) return;
    M.actions.applyTemplate(presets[k % presets.length]);
    recorded(m, defJson());
  })),
  // Import: the Open dialog hands back a schedule file's text, or something that is not one.
  fc.tuple(fc.nat(), fc.boolean()).map(([k, good]) => command(`import ${good ? CASES[k % CASES.length].id : 'junk'}`, async () => {
    const before = names();
    const was = savedJson();
    const done = M.exporting.openScheduleFile();
    expect(W.opened.length).toBe(1);
    W.opened.shift()!(good ? JSON.stringify(CASES[k % CASES.length].def) : '{"not": "a schedule"}');
    await done;
    await settle();
    if (M.state.state.overlay) click('button', { act: 'close-overlay' });
    listChange(before, names(), { add: good ? 1 : 0 });
    if (!good) expect(savedJson()).toBe(was);
    else if (names().length > before.length) reached.imports++;
  })),
  // Fill the window's own list to near the cap, as a long-used window's storage would be.
  fc.constant(command('storage near the cap', () => {
    const list = JSON.parse(W.storage.get(SAVED_KEY) ?? '[]') as { name: string; def: unknown; savedAt: string }[];
    const def = CASES[0].def;
    // Names the window could have written: never one already in the list (a name is the identity).
    const taken = new Set(list.map((e) => e.name));
    for (let i = 0; list.length < SAVED_CAP - 1; i++) {
      if (!taken.has(`Old ${i}`)) list.push({ name: `Old ${i}`, def: { ...def, name: `Old ${i}` }, savedAt: '2026-01-01' });
    }
    W.storage.set(SAVED_KEY, JSON.stringify(list));
  }, (m) => !m.projectOn && names().length < SAVED_CAP - 1)),
];

const environment = [
  fc.tuple(fc.integer({ min: 0, max: 4 }), fc.boolean()).map(([count, withOpen]) => command(
    `project opens (${count} setups${withOpen ? ', with its schedule' : ''})`, (m) => {
      const saved = Array.from({ length: count }, (_, i) => ({ name: `Project ${i}`, def: { ...CASES[i + 3].def, name: `Project ${i}` }, savedAt: '2026-11-07' }));
      const open = withOpen ? CASES[(count * 7) % CASES.length].def : undefined;
      if (!m.projectOn) m.localRaw = W.storage.get(SAVED_KEY) ?? null;
      m.projectOn = true;
      deliver({ type: 'projectSchedules', saved, ...(open ? { open } : {}) });
      expect(names()).toEqual(saved.map((s) => s.name));
      if (open) {
        expect(defJson()).toBe(JSON.stringify(parseScheduleDef(structuredClone(open))));
        recorded(m, defJson());
      }
    })),
  fc.constant(command('project closes', (m) => {
    deliver({ type: 'projectSchedules', saved: null });
    m.projectOn = false;
    // The window's own list comes back exactly as it was left.
    const own = JSON.parse(m.localRaw ?? '[]') as { name: string }[];
    expect(names()).toEqual(own.map((e) => e.name).filter((x, i, a) => a.indexOf(x) === i));
  }, (m) => m.projectOn)),
  fc.constantFrom('doors' as const, 'site' as const).map((which) => command(`model reload (${which})`, (m) => {
    const fits = openingSchedule(storeOf(SNAPS[which]), defOf(m)).fits;
    deliver({ type: 'store', snapshot: SNAPS[which] });
    m.store = which;
    if (!fits) {
      reached.reloadsReset++;
      m.undo = [];
      m.redo = [];
      m.screen = defJson();
      expect(M.columnMenu.menuColumn(), 'a reload that replaces the schedule leaves no menu').toBeNull();
    } else recorded(m, defJson());
  })),
];

/** A fresh window for each run: no project, empty storage, the doors federation, no history. */
function freshModel(): Model {
  dialog.open = false;
  dialog.asked = [];
  W.opened.length = 0;
  W.storage.clear();
  sent.length = 0;
  port?.close();
  port = fakePort((d) => sent.push(d as { type: string }));
  W.connect(port);
  M.popover.closePopover();
  M.state.state.store = null;
  deliver({ type: 'store', snapshot: SNAPS.doors });
  return { screen: defJson(), undo: [], redo: [], projectOn: false, localRaw: null, store: 'doors' };
}

describe('the Schedules window as a state machine (fc.commands)', () => {
  it(`seed ${SEED}: ${RUNS} runs of up to ${MAX_COMMANDS} commands keep history, the saved list and the lists apart`, async () => {
    process.stderr.write(`[window model] seed ${SEED} (replay: SIM_SEED=${SEED})\n`);
    let commands = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.commands([...edits, ...history, ...assistant, ...libraryCmds, ...environment], { maxCommands: MAX_COMMANDS, size: 'max' }),
        async (cmds) => {
          await fc.asyncModelRun(() => ({ model: freshModel(), real: {} }), cmds);
          commands += [...cmds].length;
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
    process.stderr.write(`[window model] ${RUNS} runs, ${commands} commands; reached ${JSON.stringify(reached)}\n`);
    // Every boundary the invariants are about was reached — or this would prove nothing.
    expect(reached.atCap).toBeGreaterThan(0);
    expect(reached.capRefused).toBeGreaterThan(0);
    expect(reached.deletesYes).toBeGreaterThan(0);
    expect(reached.deletesNo).toBeGreaterThan(0);
    expect(reached.projectWrites).toBeGreaterThan(0);
    expect(reached.reloadsReset).toBeGreaterThan(0);
    expect(reached.menusOpen).toBeGreaterThan(0);
    expect(reached.imports).toBeGreaterThan(0);
    expect(reached.undoTop).toBe(HISTORY_LIMIT);
    // The rarer boundaries are reached by the default seed's sweep; a replayed seed (`SIM_SEED`)
    // may reach none of them, as `totals-oracle.test.ts` allows — it replays a failure, it does not
    // re-prove the sweep.
    if (process.env.SIM_SEED === undefined) {
      expect(reached.redoTop).toBeGreaterThan(20);
      expect(reached.saveOverYes).toBeGreaterThan(0);
      expect(reached.saveOverNo).toBeGreaterThan(0);
      expect(reached.renamesOfOpen).toBeGreaterThan(0);
    }
  }, 240_000);

  // Found by this check (2026-11-08): a Save that has to number its name ("Door Schedule" is
  // taken → "Door Schedule (2)"), and renaming the saved setup that is on screen, wrote the new
  // name onto the definition outside the history, so the next change recorded the PRE-save
  // definition and Undo brought the old name back. Neither is an undo step (`restate`), and the
  // history holds the new name from then on.
  it('a numbered save is no undo step, and the next undo keeps the saved name', () => {
    /** A fresh window whose schedule's name is already taken, saved: it is numbered. */
    const savedNumbered = () => {
      freshModel();
      const name = M.state.state.def.name;
      W.storage.set(SAVED_KEY, JSON.stringify([{ name, def: M.state.state.def, savedAt: '2026-11-01' }]));
      clock += 1000;
      expect(M.actions.saveCurrent()).toEqual({ result: 'done', name: `${name} (2)` });
      expect(M.state.state.def.name).toBe(`${name} (2)`);
      expect(undoDepth(), 'the save is not an undo step').toBe(0);
      return `${name} (2)`;
    };
    // An edit after the save is undone to the definition on screen right after the save.
    let saved = savedNumbered();
    clock += 1000;
    M.state.updateDef((d) => act.setHidden(d, 0, true));
    click('button', { act: 'undo' });
    expect(M.state.state.def.columns[0].hidden).toBeUndefined();
    expect(M.state.state.def.name, 'what was on screen before the edit').toBe(saved);
    // A change that changes nothing makes no undo step.
    saved = savedNumbered();
    clock += 1000;
    M.state.updateDef((d) => d);
    expect(undoDepth()).toBe(0);
    expect(M.state.state.def.name).toBe(saved);
  });

  it('renaming the saved setup on screen is no undo step, and the next undo keeps the new name', () => {
    freshModel();
    const name = M.state.state.def.name;
    clock += 1000;
    expect(M.actions.saveCurrent()).toEqual({ result: 'done', name });
    expect(M.actions.renameSaved(name, 'Renamed setup')).toBe('ok');
    expect(M.state.state.def.name).toBe('Renamed setup');
    expect(undoDepth()).toBe(0);
    clock += 1000;
    M.state.updateDef((d) => d);
    expect(undoDepth(), 'a change that changes nothing').toBe(0);
    M.state.updateDef((d) => act.setHidden(d, 0, true));
    click('button', { act: 'undo' });
    expect(M.state.state.def.name).toBe('Renamed setup');
  });
});
