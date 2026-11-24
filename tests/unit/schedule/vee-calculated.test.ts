// A calculated column Vee made is marked on its heading and carries Vee's plain-words note
// (2026-11-24, checks written before the build).
//
// The agreed shape: `Calculated` gains two optional, additive keys — `by: 'vee'` and `note`
// (at most CALC_NOTE_CHARS, 160) — which `cleanCalculated` keeps; the heading of a Vee column
// carries `<span class="th-dot" …>` whose title is "Calculated by Vee", the note and the
// formula; the column menu says the same, and shows a user's own formula too; the user editing
// the formula (or a percentage's field) takes both keys away, and undo brings them back; every
// route a definition travels keeps them; and a file saved before opens exactly as it does today.
//
// The assistant's side (`make_schedule` setting `by` and storing the note) is in
// `assistant-vee-mark.test.ts`.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { record, resetHistory, setClock, undo } from '../../../src/schedule/history';
import { StoreBuilder, type ModelStore } from '../../../src/schedule/ifc/store';
import type { Cell, ElemCore, ModelMeta } from '../../../src/schedule/ifc/types';
import { ToSchedules } from '../../../src/schedule/messages';
import * as act from '../../../src/schedule/schedule/actions';
import {
  emptySchedule, parseScheduleDef, type Calculated, type Column, type ScheduleDef,
} from '../../../src/schedule/schedule/def';
import { runSchedule } from '../../../src/schedule/schedule/engine';
import { CALC_NOTE_CHARS } from '../../../src/shared/tool-schemas';
import { projectText, readProject } from '../../../src/shared/project-file';
import { renderColumnMenu, toggleColumnMenu } from '../../../src/renderer/schedule-ui/columnMenu';
import { buildCoverage } from '../../../src/renderer/schedule-ui/coverage';
import { parseScheduleText } from '../../../src/renderer/schedule-ui/exporting';
import { closePopover } from '../../../src/renderer/schedule-ui/popover';
import { listSaved, saveSchedule, setProjectList } from '../../../src/renderer/schedule-ui/schedules';
import { state as blankState, type AppState } from '../../../src/renderer/schedule-ui/state';
import { renderSchedule } from '../../../src/renderer/schedule-ui/tableView';
import { memoryStorage } from '../stub-viewer';
import { installFakeDom } from './support/fakeDom';

// The column menu and popover look their anchor up in the document; nothing here is clicked.
installFakeDom();

const meta: ModelMeta = {
  fileName: 'f.ifc', schema: 'IFC4', projectName: '', authoringTool: '',
  lengthUnit: 'mm', unitSystem: 'metric', elementCount: 0, parseMs: 0,
};

/** Three made-up walls, each with a width `W` (metres in the store). */
function build(): ModelStore {
  const b = new StoreBuilder();
  const cores: ElemCore[] = [];
  const cells: Record<string, Cell>[] = [];
  for (let i = 0; i < 3; i++) {
    cores.push({ entity: 'IfcWall', name: `Wall ${i}`, description: '', mark: '',
      typeName: 'T', family: 'F', objectType: '', predefinedType: '',
      guid: `g${i}`, storey: 'L1', storeyElevation: 0, building: '', site: '', space: '',
      material: '', discipline: 'ARC',
    });
    cells.push({ 'P.W': { v: 0.1 * (i + 1), k: 'length' } });
  }
  b.add(cores, cells);
  return b.finish(meta);
}

const NOTE = 'Twice the wall’s width.';
const colName: Column = { field: { kind: 'core', key: 'name' }, heading: 'Name' };
const colW: Column = { field: { kind: 'prop', pset: 'P', prop: 'W' }, heading: 'W' };
const calcCol = (id: string): Column => ({ field: { kind: 'formula', id } });

/** A calculated entry. Cast, because `by` and `note` are what the build adds to the type. */
const calc = (o: Record<string, unknown>): Calculated => ({ kind: 'formula', ...o }) as unknown as Calculated;
const vee = (o: Record<string, unknown> = {}) =>
  calc({ id: 'v1', name: 'Double', formula: 'W * 2', by: 'vee', note: NOTE, ...o });
const mine = (o: Record<string, unknown> = {}) => calc({ id: 'u1', name: 'Mine', formula: 'W * 3', ...o });

/** Walls: Name, W, then Vee's column and the user's own. */
const schedule = (calculated: Calculated[] = [vee(), mine()]): ScheduleDef => ({
  ...emptySchedule('Walls', ['IfcWall']),
  columns: [colName, colW, ...calculated.map((c) => calcCol(c.id))],
  calculated,
});

const store = build();
const tableOf = (def: ScheduleDef): string => {
  const state = { ...blankState, store, def } as AppState;
  return renderSchedule(state, runSchedule(store, def), buildCoverage(store, ['IfcWall']));
};
const menuOf = (def: ScheduleDef, i: number): string => {
  const state = { ...blankState, store, def } as AppState;
  toggleColumnMenu(i);
  try {
    return renderColumnMenu(state, store, buildCoverage(store, ['IfcWall']), runSchedule(store, def));
  } finally {
    closePopover();
  }
};
/** One heading cell's markup, by its def.columns index. */
const th = (html: string, i: number): string => {
  const m = html.match(new RegExp(`<th[^>]*data-defcol="${i}"[\\s\\S]*?</th>`));
  if (!m) throw new Error(`no heading ${i}`);
  return m[0];
};
/** The column menu's note: its text, up to the Edit formula button. */
const popNote = (html: string): { cls: string; body: string } => {
  const m = html.match(/<div class="(pop-note[^"]*)">([\s\S]*?)<button class="btn" data-act="open-calc"/);
  if (!m) throw new Error('no calculated-column note in the menu');
  return { cls: m[1], body: m[2] };
};
const dot = (title: string) =>
  `<span class="th-dot" role="img" aria-label="Calculated by Vee" title="${title}"></span>`;

/* ────────────────────────────── the save format ────────────────────────────── */

describe('Calculated keeps by and note, and drops a bad value rather than guess', () => {
  it('names the note’s cap once, at 160', () => {
    expect(CALC_NOTE_CHARS).toBe(160);
  });

  it('parseScheduleDef keeps by: "vee" and the note', () => {
    const def = parseScheduleDef(JSON.parse(JSON.stringify(schedule())));
    expect(def.calculated).toEqual([
      { id: 'v1', name: 'Double', kind: 'formula', formula: 'W * 2', by: 'vee', note: NOTE },
      { id: 'u1', name: 'Mine', kind: 'formula', formula: 'W * 3' },
    ]);
  });

  it('a by that is not the string "vee" is absent; a note that is not a string is absent', () => {
    for (const by of ['user', 'Vee', true, 1, null, {}, ['vee']]) {
      const [c] = parseScheduleDef(schedule([vee({ by })])).calculated!;
      expect([by, Object.hasOwn(c, 'by')]).toEqual([by, false]);
    }
    for (const note of [5, true, null, {}, ['a note']]) {
      const [c] = parseScheduleDef(schedule([vee({ note })])).calculated!;
      expect([note, Object.hasOwn(c, 'note')]).toEqual([note, false]);
      // The entry itself is kept: only the bad value goes.
      expect(c).toMatchObject({ id: 'v1', formula: 'W * 2', by: 'vee' });
    }
  });

  it('a note longer than the cap is cut, the way a formula is', () => {
    const long = 'a'.repeat(CALC_NOTE_CHARS + 40);
    const [c] = parseScheduleDef(schedule([vee({ note: long })])).calculated!;
    expect(c).toMatchObject({ note: 'a'.repeat(CALC_NOTE_CHARS) });
  });

  it('a note is trimmed; one that is only whitespace is absent, and leaves no empty line in the title', () => {
    const [blank] = parseScheduleDef(schedule([vee({ note: '   ' })])).calculated!;
    expect(Object.hasOwn(blank, 'note')).toBe(false);
    const [padded] = parseScheduleDef(schedule([vee({ note: `  ${NOTE}\n ` })])).calculated!;
    expect(padded.note).toBe(NOTE);
    const title = th(tableOf(parseScheduleDef(schedule([vee({ note: ' \n\t ' })]))), 2).match(/class="th-dot"[^>]*title="([^"]*)"/)![1];
    expect(title).toBe('Calculated by Vee\nW * 2');
    expect(title.split('\n').every((l) => l.trim().length > 0)).toBe(true);
    // A cut that lands on a space leaves no trailing space, so a second read gives the same note.
    const long = `${'a'.repeat(CALC_NOTE_CHARS - 1)} tail`;
    const [cut] = parseScheduleDef(schedule([vee({ note: long })])).calculated!;
    expect(cut.note).toBe('a'.repeat(CALC_NOTE_CHARS - 1));
    expect(parseScheduleDef(schedule([vee({ note: cut.note })])).calculated![0].note).toBe(cut.note);
  });

  it('a percentage keeps them too', () => {
    const pct = calc({ id: 'p1', name: 'Share', kind: 'percentage', ofField: colW.field, by: 'vee', note: 'Each wall’s share.' });
    const [c] = parseScheduleDef(schedule([pct])).calculated!;
    expect(c).toEqual({ id: 'p1', name: 'Share', kind: 'percentage', ofField: colW.field, by: 'vee', note: 'Each wall’s share.' });
  });
});

/* ────────────────────────────── the heading ────────────────────────────── */

describe('the heading of a column Vee made carries the dot (Done 1, 2)', () => {
  it('Vee’s column has the dot right after its heading text; the user’s and a model column do not', () => {
    const html = tableOf(schedule());
    expect(th(html, 2)).toContain(`Double${dot(`Calculated by Vee\n${NOTE}\nW * 2`)}`);
    expect(th(html, 3)).not.toContain('th-dot');
    expect(th(html, 0)).not.toContain('th-dot');
    expect(th(html, 1)).not.toContain('th-dot');
    expect(html.match(/class="th-dot"/g)).toHaveLength(1);
  });

  // A heading can be vertical (writing-mode: vertical-rl), where a physical left margin does
  // not separate the dot from the text; and a long unbroken formula must wrap in the 320 px menu.
  it('the stylesheet spaces the dot along the text and wraps the menu’s formula line', () => {
    const css = readFileSync(join(__dirname, '../../../src/renderer/schedule-ui/schedule.css'), 'utf8');
    const dotRule = css.match(/\.th-dot\s*\{([^}]*)\}/)![1];
    expect(dotRule).toContain('margin-inline-start: 6px');
    expect(dotRule).not.toMatch(/margin-left/);
    expect(css.match(/\.pop-note \.f\s*\{([^}]*)\}/)![1]).toContain('overflow-wrap: anywhere');
  });

  it('with no note the title is two lines; for a percentage there is no formula line', () => {
    const noNote = tableOf(schedule([vee({ note: undefined })]));
    expect(th(noNote, 2)).toContain(dot('Calculated by Vee\nW * 2'));
    const pct = calc({ id: 'p1', name: 'Share', kind: 'percentage', ofField: colW.field, by: 'vee', note: 'Each wall’s share.' });
    expect(th(tableOf(schedule([pct])), 2)).toContain(dot('Calculated by Vee\nEach wall’s share.'));
    const bare = calc({ id: 'p1', name: 'Share', kind: 'percentage', ofField: colW.field, by: 'vee' });
    expect(th(tableOf(schedule([bare])), 2)).toContain(dot('Calculated by Vee'));
  });

  it('a calculated column the user adds is unmarked', () => {
    const def = act.addCalculated({ ...emptySchedule('Walls', ['IfcWall']), columns: [colName, colW] }, 'formula');
    const added = def.calculated!.at(-1)!;
    expect(Object.hasOwn(added, 'by')).toBe(false);
    expect(Object.hasOwn(added, 'note')).toBe(false);
    const shown = { ...def, columns: [...def.columns, calcCol(added.id)] };
    expect(tableOf(shown)).not.toContain('th-dot');
  });
});

/* ────────────────────────────── the column menu ────────────────────────────── */

describe('the column menu says who made it, the note and the formula (Done 2)', () => {
  it('a Vee column: "Calculated by Vee", then the note, then the formula in <span class="f">', () => {
    const { cls, body } = popNote(menuOf(schedule(), 2));
    expect(cls).toBe('pop-note');
    const at = [body.indexOf('Calculated by Vee'), body.indexOf(NOTE), body.indexOf('<span class="f">W * 2</span>')];
    expect(at.every((n) => n >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('the user’s own column: "Calculated column" and its formula, not Vee', () => {
    const { body } = popNote(menuOf(schedule(), 3));
    expect(body).toContain('Calculated column');
    expect(body).toContain('<span class="f">W * 3</span>');
    expect(body).not.toContain('Calculated by Vee');
  });

  it('a formula problem still shows the problem text, marked bad', () => {
    const { cls, body } = popNote(menuOf(schedule([vee({ formula: 'Nope * 2' })]), 2));
    expect(cls).toBe('pop-note bad');
    expect(body).toMatch(/Nope/);
  });
});

/* ────────────────────────────── escaping ────────────────────────────── */

describe('a note, a formula and a name never reach the markup unescaped', () => {
  const hostile = 'He said "big" <img src=x onerror=1>';
  // A formula that parses and names a real heading, so the menu shows the note, not a problem.
  const def = schedule([vee({ note: hostile, name: `Odd "${'<b>'}" name`, formula: 'contains(Name, "<img src=x onerror=1>")' })]);

  it('in the heading', () => {
    const cell = th(tableOf(def), 2);
    expect(cell).toContain('th-dot');
    expect(cell).not.toContain('<img');
    expect(cell).not.toContain('<b>');
    expect(cell).not.toContain('"big"');
    expect(cell).toContain('He said &quot;big&quot; &lt;img src=x onerror=1&gt;');
    expect(cell).toContain('contains(Name, &quot;&lt;img src=x onerror=1&gt;&quot;)');
  });

  it('in the column menu', () => {
    const html = menuOf(def, 2);
    expect(popNote(html).cls).toBe('pop-note');
    expect(html).toContain('Calculated by Vee');
    expect(html).toContain('<span class="f">contains(Name, &quot;&lt;img src=x onerror=1&gt;&quot;)</span>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('"big"');
    expect(html).toContain('He said &quot;big&quot; &lt;img src=x onerror=1&gt;');
  });
});

/* ────────────────────────────── the user's edit, and undo ────────────────────────────── */

describe('the user editing the formula takes the mark away; undo brings it back (Done 3)', () => {
  const keys = (d: ScheduleDef, id = 'v1') => {
    const c = d.calculated!.find((x) => x.id === id)!;
    return { by: Object.hasOwn(c, 'by'), note: Object.hasOwn(c, 'note') };
  };

  it('a new formula text removes by and note, and the dot', () => {
    const next = act.updateCalculated(schedule(), 'v1', { formula: 'W * 4' });
    expect(keys(next)).toEqual({ by: false, note: false });
    expect(next.calculated![0]).toMatchObject({ formula: 'W * 4' });
    expect(tableOf(next)).not.toContain('th-dot');
    // The user's own entry is not touched.
    expect(next.calculated![1]).toEqual(mine());
  });

  it('a percentage’s field changed removes them', () => {
    const pct = calc({ id: 'v1', name: 'Share', kind: 'percentage', ofField: colW.field, by: 'vee', note: 'Each wall’s share.' });
    const next = act.updateCalculated(schedule([pct]), 'v1', { ofField: { kind: 'core', key: 'name' } });
    expect(keys(next)).toEqual({ by: false, note: false });
  });

  it('renaming it, or changing its result or unit, keeps them', () => {
    expect(keys(act.updateCalculated(schedule(), 'v1', { name: 'Twice' }))).toEqual({ by: true, note: true });
    expect(keys(act.setCalculatedResult(schedule(), 'v1', 'length'))).toEqual({ by: true, note: true });
    expect(keys(act.setCalculatedResult(schedule(), 'v1', 'yesno'))).toEqual({ by: true, note: true });
    expect(keys(act.setCalculatedUnitKind(schedule(), 'v1', 'area'))).toEqual({ by: true, note: true });
  });

  // Read from "changes a calculated entry's formula text": the editor's live text box hands the
  // action the box's text on input, so the same text again is not a change.
  it('the same formula text again keeps them', () => {
    expect(keys(act.updateCalculated(schedule(), 'v1', { formula: 'W * 2' }))).toEqual({ by: true, note: true });
  });

  it('undo restores by and note, and the dot', () => {
    let clock = 0;
    setClock(() => clock);
    const before = schedule();
    resetHistory(before);
    const edited = act.updateCalculated(before, 'v1', { formula: 'W * 4' });
    clock = 5000;
    record(edited);
    const back = undo()!;
    expect(back.calculated![0]).toEqual(vee());
    expect(th(tableOf(back), 2)).toContain('th-dot');
  });
});

/* ────────────────────────────── every route a definition travels ────────────────────────────── */

describe('by and note survive every route (Done 4)', () => {
  const def = schedule();
  const want = [
    { id: 'v1', name: 'Double', kind: 'formula', formula: 'W * 2', by: 'vee', note: NOTE },
    { id: 'u1', name: 'Mine', kind: 'formula', formula: 'W * 3' },
  ];

  it('a .schedule.json saved and opened again', () => {
    expect(parseScheduleText(JSON.stringify(def, null, 2)).calculated).toEqual(want);
  });

  it('the cross-window define message, then the window’s own reader', () => {
    const msg = ToSchedules.safeParse({ type: 'define', kind: 'made', def });
    expect(msg.success).toBe(true);
    if (!msg.success) return;
    const sent = (msg.data as unknown as { def: unknown }).def;
    expect(parseScheduleDef(sent).calculated).toEqual(want);
  });

  describe('the Templates library (saved setups)', () => {
    beforeEach(() => { vi.stubGlobal('localStorage', memoryStorage()); });
    afterEach(() => { setProjectList(null); vi.unstubAllGlobals(); });

    it('saved and listed again', () => {
      expect(saveSchedule(def, null)).toBe('Walls');
      expect(listSaved()[0].def.calculated).toEqual(want);
    });
  });

  it('a .sgvue project, its open schedule and a saved setup', () => {
    const text = readFileSync(join(__dirname, '../../fixtures/project/v1-synthetic.sgvue'), 'utf8');
    const raw = JSON.parse(text) as { schedules: { saved: { def: unknown }[]; open: unknown } };
    raw.schedules.open = def;
    raw.schedules.saved[0].def = { ...def, name: 'Wall Schedule' };
    const read = readProject(JSON.stringify(raw));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.project.schedules.open?.calculated).toEqual(want);
    expect(read.project.schedules.saved[0].def.calculated).toEqual(want);
    // Saved again and reopened: nothing moves.
    const again = readProject(projectText(read.project));
    expect(again.ok && again.project.schedules.open?.calculated).toEqual(want);
  });
});

/* ────────────────────────────── saved before: unchanged ────────────────────────────── */

describe('anything saved before opens exactly as today (Done 4) — these pass before the build', () => {
  // What today's parser makes of the old shapes, written out: an entry with neither key.
  const OLD = { id: 'c1', name: 'Double', kind: 'formula', formula: 'FireRating * 2' };

  it('the legacy v1 .schedule.json', () => {
    const legacy = readFileSync(join(__dirname, 'fixtures/legacy-v1.schedule.json'), 'utf8');
    const def = parseScheduleText(legacy);
    expect(def.calculated).toEqual([OLD]);
    expect(parseScheduleDef(JSON.parse(JSON.stringify(def)))).toEqual(def);
  });

  it('every corpus .schedule.json: no calculated entry gains a key', () => {
    const root = join(__dirname, '../../fixtures/compat');
    for (const v of ['v1.1.0-beta.1', 'v1.2.0', 'current']) {
      for (const f of ['doors.schedule.json', 'walls.schedule.json']) {
        const written = JSON.parse(readFileSync(join(root, v, f), 'utf8')) as ScheduleDef;
        const def = parseScheduleDef(written);
        for (const c of def.calculated ?? []) {
          expect([v, f, Object.hasOwn(c, 'by'), Object.hasOwn(c, 'note')]).toEqual([v, f, false, false]);
        }
      }
    }
  });

  it('a library entry saved before', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    try {
      const old = { ...emptySchedule('Old', ['IfcDoor']), columns: [{ field: { kind: 'formula', id: 'c1' } }], calculated: [OLD] };
      localStorage.setItem('sgvue.schedules.saved.v1', JSON.stringify([{ name: 'Old', def: old, savedAt: '2026-11-01T00:00:00Z' }]));
      expect(listSaved()[0].def.calculated).toEqual([OLD]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a .sgvue project saved before, with a calculated column', () => {
    const text = readFileSync(join(__dirname, '../../fixtures/project/v1-synthetic.sgvue'), 'utf8');
    const raw = JSON.parse(text) as { schedules: { open: { columns: unknown[]; calculated?: unknown[] } } };
    raw.schedules.open.columns.push({ field: { kind: 'formula', id: 'c1' } });
    raw.schedules.open.calculated = [OLD];
    const read = readProject(JSON.stringify(raw));
    expect(read.ok && read.project.schedules.open?.calculated).toEqual([OLD]);
  });
});

/*
 * The compatibility corpus (`tests/fixtures/compat/README.md`): a format change adds a folder,
 * written by that build's own encoders, never by today's. These two files do not exist before
 * the build — it generates them with `make-corpus.cjs`:
 *
 *   · `v1.6.1/calculated.schedule.json` — written by v1.6.1's own code (the last release), with
 *     at least one calculated entry (the user's, and one v1.6.1's `make_schedule` made): it must
 *     open with no `by` and no `note`, exactly as written;
 *   · `current/calculated.schedule.json` — today's, with a `by: "vee"` entry carrying a note and
 *     a user's entry without: both must come back as written.
 */
describe('the compatibility corpus carries a calculated column, old and new (Done 4)', () => {
  const root = join(__dirname, '../../fixtures/compat');
  const opened = (version: string) => {
    const file = join(root, version, 'calculated.schedule.json');
    expect(existsSync(file), `${version}/calculated.schedule.json — the build generates it`).toBe(true);
    const written = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    const def = parseScheduleDef(written);
    expect(def).toMatchObject(written);
    expect(parseScheduleDef(JSON.parse(JSON.stringify(def)))).toEqual(def);
    return def;
  };

  it('v1.6.1’s opens with no mark', () => {
    const def = opened('v1.6.1');
    expect(def.calculated?.length).toBeGreaterThan(0);
    for (const c of def.calculated!) expect([c.id, Object.hasOwn(c, 'by'), Object.hasOwn(c, 'note')]).toEqual([c.id, false, false]);
  });

  it('today’s keeps Vee’s mark and note, and the user’s stays unmarked', () => {
    const def = opened('current');
    const cs = def.calculated as unknown as Record<string, unknown>[];
    expect(cs.some((c) => c.by === 'vee' && typeof c.note === 'string' && c.note.length > 0)).toBe(true);
    expect(cs.some((c) => !Object.hasOwn(c, 'by') && !Object.hasOwn(c, 'note'))).toBe(true);
  });
});
