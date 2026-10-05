// The Schedules window's side of Ask SGVue's `export_schedule` (2026-09-28): an export asked
// for from chat runs the Export menu's own action (`EXPORT_ACTIONS`, which the menu itself
// calls) and is refused by the menu's own rules (`exportRefusal`). Runs in Node: the preload's
// bridge, the toast's `document` and `localStorage` are stood in for.
//
// 2026-10-02 (the review's leftover of the parity work's phase 4): it is also refused while
// this window's own confirm or prompt is up — whether that card is, is stood in for here.
//
// The same day (the last leftover before the release): and while this window's native Open
// dialog is up — raised here by the real `openScheduleFile`, over a bridge whose Open dialog
// the test answers.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreBuilder } from '../../../src/schedule/ifc/store';
import type { ModelMeta } from '../../../src/schedule/ifc/types';
import { emptySchedule, type ScheduleDef } from '../../../src/schedule/schedule/def';
import { EXPORT_FORMATS, type ExportFormat, type ExportRefusal } from '../../../src/schedule/messages';
import { EXPORT_ACTIONS, exportRefusal, openScheduleFile } from '../../../src/renderer/schedule-ui/exporting';
import { SAVED_KEY } from '../../../src/renderer/schedule-ui/schedules';
import { state } from '../../../src/renderer/schedule-ui/state';

/** Whether this window's own dialog — its confirm or its prompt — is up. */
const dialog = vi.hoisted(() => ({ open: false }));
vi.mock('../../../src/renderer/schedule-ui/dialog', () => ({ dialogOpen: () => dialog.open }));

const meta: ModelMeta = {
  fileName: 'f.ifc', schema: 'IFC4', projectName: '', authoringTool: '',
  lengthUnit: 'mm', unitSystem: 'metric', elementCount: 0, parseMs: 0,
};

function doorStore() {
  const b = new StoreBuilder();
  b.add([{ entity: 'IfcDoor', name: 'D1', description: '', mark: '', typeName: 'T', family: 'F',
    objectType: '', predefinedType: '', guid: 'g1', storey: 'L1', storeyElevation: 0, building: '',
    site: '', space: '', material: '', discipline: 'ARC' }], [{}]);
  return b.finish(meta);
}
const doors: ScheduleDef = { ...emptySchedule('Doors', ['IfcDoor']), columns: [{ field: { kind: 'core', key: 'name' } }] };

const cell = new Map<string, string>();
/** Every `saveExport` main was asked for, with the answer the test gives it. */
let asked: { kind: string; suggestedName: string; bytes: Uint8Array; answer: (saved: boolean) => void }[] = [];
/** Every Open dialog main was asked for, with the answer the test gives it — null is Cancel. */
let opened: ((picked: { text: string } | null) => void)[] = [];

/**
 * A request from chat, as `main.ts`' `exportFromChat` runs it: the answer it posts back at once,
 * and the menu's own action only when that answer is not a refusal.
 */
function fromChat(format: ExportFormat): { refused: ExportRefusal | null; running: Promise<void> | null } {
  const refused = exportRefusal(format);
  return { refused, running: refused ? null : EXPORT_ACTIONS[format]() };
}

beforeEach(() => {
  // The toast's 2.6 s timer (`flash`) on a fake clock, which `afterEach` drops: nothing is left running.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  cell.clear();
  asked = [];
  opened = [];
  dialog.open = false;
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (cell.has(k) ? cell.get(k)! : null),
    setItem: (k: string, v: string) => { cell.set(k, String(v)); },
    removeItem: (k: string) => { cell.delete(k); },
  });
  vi.stubGlobal('window', {
    sgvueSchedule: {
      saveExport: (req: { kind: string; suggestedName: string; bytes: Uint8Array }) =>
        new Promise<{ saved: boolean }>((resolve) => asked.push({ ...req, answer: (saved) => resolve({ saved }) })),
      openScheduleFile: () => new Promise<{ text: string } | null>((resolve) => opened.push(resolve)),
    },
  });
  vi.stubGlobal('document', {
    createElement: () => ({ setAttribute: () => undefined, remove: () => undefined }),
    body: { appendChild: () => undefined },
  });
  state.store = doorStore();
  state.def = doors;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  state.store = null;
});

describe('export_schedule, in the Schedules window', () => {
  it('has one action per Export menu entry — the four formats the tool names', () => {
    expect(Object.keys(EXPORT_ACTIONS)).toEqual([...EXPORT_FORMATS]);
  });

  it('is refused by the menu’s own rules: no schedule on screen, and nothing saved for all_saved', () => {
    state.store = null;
    for (const f of EXPORT_FORMATS) expect([f, exportRefusal(f)]).toEqual([f, 'no_schedule']);
    state.store = doorStore();
    expect(exportRefusal('all_saved')).toBe('nothing_saved');
    for (const f of ['xlsx', 'csv', 'schedule_file'] as const) expect([f, exportRefusal(f)]).toEqual([f, null]);
    cell.set(SAVED_KEY, JSON.stringify([{ name: 'Doors', def: doors, savedAt: '' }]));
    expect(exportRefusal('all_saved')).toBeNull();
  });

  it('runs the menu’s own export — one Save request to main, with a kind, a name and bytes — and is busy until it is answered', async () => {
    const running = EXPORT_ACTIONS.csv();
    expect(exportRefusal('xlsx')).toBe('busy');
    // Let the bytes be built and the request reach main.
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0].kind).toBe('csv');
    expect(asked[0].suggestedName).toMatch(/^Doors — \d{4}-\d{2}-\d{2}\.csv$/);
    expect(new TextDecoder().decode(asked[0].bytes)).toContain('D1');
    // Still busy while the dialog is open: a second export is not started.
    expect(exportRefusal('schedule_file')).toBe('busy');
    await EXPORT_ACTIONS.schedule_file();
    expect(asked).toHaveLength(1);
    asked[0].answer(false);
    await running;
    expect(exportRefusal('xlsx')).toBeNull();
  });

  it('is busy while this window’s own confirm or prompt is up — no Save dialog is raised over a question', async () => {
    cell.set(SAVED_KEY, JSON.stringify([{ name: 'Doors', def: doors, savedAt: '' }]));
    for (const f of EXPORT_FORMATS) expect([f, exportRefusal(f)]).toEqual([f, null]);
    dialog.open = true;
    for (const f of EXPORT_FORMATS) expect([f, exportRefusal(f)]).toEqual([f, 'busy']);
    // Busy is said first, as for an export under way: whatever else would have refused it.
    state.store = null;
    expect(exportRefusal('csv')).toBe('busy');
    // The card answered or cancelled: the menu's other rules again, and then nothing.
    dialog.open = false;
    expect(exportRefusal('csv')).toBe('no_schedule');
    state.store = doorStore();
    expect(exportRefusal('csv')).toBeNull();

    // The refusal is the request's alone (`main.ts`, `exportFromChat`). The menu's own action
    // never asks it — a click cannot reach the menu under that card — so it is as it was.
    dialog.open = true;
    const running = EXPORT_ACTIONS.csv();
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    asked[0].answer(false);
    await running;
  });

  it('is busy while this window’s native Open dialog is up — a request from chat exports nothing, and no Save dialog is raised over it', async () => {
    cell.set(SAVED_KEY, JSON.stringify([{ name: 'Doors', def: doors, savedAt: '' }]));
    for (const f of EXPORT_FORMATS) expect([f, exportRefusal(f)]).toEqual([f, null]);
    // "Open schedule file…" — the user's own click, or an earlier turn's `manage_schedules`
    // `open_file`. Main's Open dialog is up until the test answers it.
    const picking = openScheduleFile();
    expect(opened).toHaveLength(1);
    for (const f of EXPORT_FORMATS) expect([f, exportRefusal(f)]).toEqual([f, 'busy']);
    // So a request from chat is answered `busy` and starts nothing…
    expect(fromChat('csv')).toEqual({ refused: 'busy', running: null });
    // …and when the user cancels the Open dialog, main has been asked for no Save dialog.
    opened[0](null);
    await picking;
    expect(asked).toHaveLength(0);
    // The same request now exports: the first Save dialog main hears of.
    const after = fromChat('csv');
    expect(after.refused).toBeNull();
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0].kind).toBe('csv');
    asked[0].answer(false);
    await after.running;
  });
});
