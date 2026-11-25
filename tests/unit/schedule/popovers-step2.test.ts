// Step 2 of the one-line bar (2026-11-25): the popovers get fewer, combined controls.
//   A. Rows: one three-way choice — Every element | Merge identical | One row per sort value —
//      one undo step, one line of hint, the grand-total label box while the total is on.
//   B. A sort level: field, move, remove; More… holds header, footer, what it shows, blank line.
//   C. Style: Title with Show title, Text size; More… holds the rest.
//   D. The column menu: align as three icons; group, filter, colour rules, hide, remove in one
//      icon row.
//   E. Every icon-only button in a popover or an overlay names itself in a fast tooltip — one
//      fixed tip element outside the scroll container — never in a native `title`.
//   G. An empty result names the filter that empties it, with the way back.
// Through the REAL wiring on the fake DOM; how it looks needs a window.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { record, undoDepth } from '../../../src/schedule/history';
import * as act from '../../../src/schedule/schedule/actions';
import { emptySchedule, type Column, type FilterRule, type ScheduleDef } from '../../../src/schedule/schedule/def';
import { runSchedule } from '../../../src/schedule/schedule/engine';
import { state } from '../../../src/renderer/schedule-ui/state';
import { buildCoverage } from '../../../src/renderer/schedule-ui/coverage';
import { menuColumn, renderColumnMenu, setMenuView, toggleColumnMenu, toggleMore } from '../../../src/renderer/schedule-ui/columnMenu';
import { wireApp } from '../../../src/renderer/schedule-ui/events';
import { flushPending, wirePending } from '../../../src/renderer/schedule-ui/pending';
import { anchorPopover, closePopover, wirePopover } from '../../../src/renderer/schedule-ui/popover';
import { renderSchedule } from '../../../src/renderer/schedule-ui/tableView';
import { renderStatus } from '../../../src/renderer/schedule-ui/header';
import { toCsv } from '../../../src/schedule/export/csv';
import { fullResult, toRows } from '../../../src/schedule/export/rows';
import { wireTips } from '../../../src/renderer/schedule-ui/tips';
import { openChip, shortWords } from '../../../src/renderer/schedule-ui/viewBar';
import { renderViewPopover } from '../../../src/renderer/schedule-ui/viewPopovers';
import { buildStore } from './support/fixture';
import { FakeEl, installFakeDom } from './support/fakeDom';

const { root, win, dispatch } = installFakeDom();
Object.assign(globalThis, { innerWidth: 1280, innerHeight: 800 });
const store = buildStore();
const W = { kind: 'prop', pset: 'Qto_DoorBaseQuantities', prop: 'Width' } as const;
const FR = { kind: 'prop', pset: 'Pset_DoorCommon', prop: 'FireRating' } as const;
const EXT = { kind: 'prop', pset: 'Pset_DoorCommon', prop: 'IsExternal' } as const;
const MARK = { kind: 'core', key: 'mark' } as const;
const LEVEL = { kind: 'core', key: 'storey' } as const;
const base: ScheduleDef = {
  ...emptySchedule('Doors', ['IfcDoor']),
  grandTotal: false,
  columns: [{ field: MARK }, { field: W }, { field: FR }, { field: EXT }] as Column[],
  sort: [{ field: LEVEL, dir: 'asc' }, { field: MARK, dir: 'asc' }],
};

const popover = new FakeEl('div', {}, root);
popover.attrs.id = 'popover';
const head = new FakeEl('div', {}, root);
head.attrs.id = 'centre-head';
const tip = new FakeEl('div', {}, root);
tip.attrs.id = 'pop-tip';

beforeAll(() => {
  wirePending(root as unknown as EventTarget, win as unknown as EventTarget);
  wirePopover(root as unknown as HTMLElement);
  wireApp(root as unknown as HTMLElement, {
    pickRow: () => {}, rowMenu: () => {}, headMenu: () => {}, moveRow: () => {}, frameSelection: () => {},
  });
  wireTips(root as unknown as HTMLElement);
});
beforeEach(() => {
  vi.useFakeTimers();
  flushPending();
  state.store = store;
  state.def = structuredClone(base);
  closePopover();
  head.children = [];
  popover.children = [];
});
afterEach(() => { flushPending(); vi.runOnlyPendingTimers(); vi.useRealTimers(); });

const click = (el: FakeEl) => { dispatch(el, 'pointerdown'); dispatch(el, 'pointerup'); dispatch(el, 'click'); };
const cov = () => buildCoverage(store, state.def.entity);
const open = (kind: string, i?: string) => {
  const el = new FakeEl('button', { act: 'vb-open', v: kind, ...(i === undefined ? {} : { i }) }, head);
  click(el);
};
const body = () => renderViewPopover(state, store, cov()).replace(/\s+/g, ' ');
const fire = (data: Record<string, string>) => {
  const el = new FakeEl('button', data, popover);
  click(el);
  popover.children.splice(popover.children.indexOf(el), 1);
};
const actsIn = (html: string) => [...html.matchAll(/data-act="([a-z][a-z0-9-]*)"/g)].map((m) => m[1]);

describe('A. Rows: one three-way choice', () => {
  const MODES = [['every', 'Every element'], ['merge', 'Merge identical'], ['sort', 'One row per sort value']];
  const choice = (html: string) => [...html.matchAll(/<button class="seg-btn( on)?" data-act="rows-mode" data-v="(\w+)" aria-pressed="(\w+)">([^<]*)<\/button>/g)]
    .map((m) => [m[2], m[4], !!m[1], m[3]]);
  const defs: Record<string, ScheduleDef> = {
    every: { ...base, itemize: true },
    merge: { ...base, itemize: false },
    sort: { ...base, itemize: false, combine: 'sort' },
  };

  it('draws the current mode, and nothing else for it: no Itemise switch, no Combine row', () => {
    for (const [mode] of MODES) {
      state.def = structuredClone(defs[mode]);
      open('rows');
      const html = body();
      expect(choice(html), mode).toEqual(MODES.map(([v, t]) => [v, t, v === mode, String(v === mode)]));
      expect(html).not.toMatch(/data-act="(itemize|combine)"|Itemise every instance|>\s*Combine\s*</);
      closePopover();
    }
  });

  it('each choice from each other mode writes itemize / combine in ONE undo step', () => {
    const want: Record<string, (d: ScheduleDef) => ScheduleDef> = {
      every: (d) => act.setItemize(d, true),
      merge: (d) => act.setCombine(act.setItemize(d, false), 'identical'),
      sort: (d) => act.setCombine(act.setItemize(d, false), 'sort'),
    };
    for (const [from] of MODES) {
      for (const [to] of MODES) {
        if (from === to) continue;
        state.def = structuredClone(defs[from]);
        const before = state.def;
        // The history's own view of where it starts, and out of any typing burst.
        record(before, true);
        vi.advanceTimersByTime(5000);
        const d0 = undoDepth();
        fire({ act: 'rows-mode', v: to });
        expect(state.def, `${from} → ${to}`).toEqual(want[to](before));
        expect(undoDepth() - d0, `${from} → ${to}`).toBe(1);
      }
    }
  });

  it('one line of hint for the selected mode', () => {
    const hint = (d: ScheduleDef) => {
      state.def = d;
      open('rows');
      const m = /<p class="hint rows-hint">([^<]*(?:&lt;varies&gt;[^<]*)?)<\/p>/.exec(body());
      closePopover();
      return m?.[1];
    };
    expect(hint(defs.every)).toBe('Every matching element gets its own row.');
    expect(hint(defs.merge)).toBe('Rows identical in every shown column become one; a Count column says how many.');
    expect(hint(defs.sort)).toBe('One row per Level + Tag (Revit ID). A cell that differs reads &lt;varies&gt;; a column with a total shows it. A Count column says how many.');
    expect(hint({ ...defs.sort, sort: [] })).toBe('No sort level, so everything is one row. Add a sort level to split it.');
  });

  it('the grand-total label box only while the total is on', () => {
    state.def = { ...base, grandTotal: true, grandTotalTitle: 'All doors' };
    open('rows');
    expect(body()).toMatch(/data-act="grand-title" value="All doors" placeholder="Grand total" aria-label="Grand total label"/);
    closePopover();
    state.def = { ...base, grandTotal: false };
    open('rows');
    expect(body()).not.toMatch(/grand-title/);
  });
});

describe('B. A sort level: field, move, remove; More… holds the grouping', () => {
  it('shut: the field, earlier / later and remove — no Order pair, no grouping switches', () => {
    open('sort', '1');
    const html = body();
    expect(actsIn(html)).toEqual(['sort-field', 'sort-move', 'sort-move', 'sort-remove', 'vb-more']);
    expect(html).toMatch(/<button class="fold hv-step shut" data-act="vb-more" aria-expanded="false">/);
  });

  it('open: header, footer, what it shows, blank line — and a repaint keeps it open and keeps focus', () => {
    state.def = act.setGroupOptions(base, 1, { footer: 'title' });
    open('sort', '1');
    fire({ act: 'vb-more' });
    const html = body();
    expect(html).toMatch(/data-act="vb-more" aria-expanded="true"/);
    expect(actsIn(html.slice(html.indexOf('data-act="vb-more"')))).toEqual(['vb-more', 'sort-header', 'sort-footer', 'sort-footer-style', 'sort-blank']);
    // An edit repaints: the fold stays open.
    fire({ act: 'sort-move', i: '1', v: '-1' });
    expect(openChip()).toEqual({ kind: 'sort', i: 0 });
    expect(body()).toMatch(/data-act="vb-more" aria-expanded="true"/);
  });

  it('another chip’s popover opens shut', () => {
    open('sort', '0');
    fire({ act: 'vb-more' });
    closePopover();
    open('style');
    expect(body()).toMatch(/data-act="vb-more" aria-expanded="false"/);
  });
});

describe('C. Style: title and size; More… holds the rest', () => {
  it('shut, then open', () => {
    open('style');
    expect(actsIn(body())).toEqual(['app-showtitle', 'app-title', 'app-fontsize', 'vb-more']);
    fire({ act: 'vb-more' });
    expect(actsIn(body())).toEqual(['app-showtitle', 'app-title', 'app-fontsize', 'vb-more', 'app-outline', 'app-headerbold', 'app-blankfirst', 'app-font']);
    expect(body()).toMatch(/class="sub hint-under"/);
  });
});

describe('D. The column menu', () => {
  const menu = (i = 1) => {
    if (menuColumn() !== i) toggleColumnMenu(i);
    const res = runSchedule(store, state.def);
    return renderColumnMenu(state, store, cov(), res).replace(/\s+/g, ' ');
  };
  it('align is three icon buttons, the current one lit', () => {
    const html = menu(1);
    const align = [...html.matchAll(/<button class="icon-btn sm hv-step( on)?" data-act="fmt-align" data-v="(\w+)"[^>]*aria-pressed="(\w+)"/g)]
      .map((m) => [m[2], !!m[1], m[3]]);
    // Width carries no format or total here, so it reads left (`alignOf`).
    expect(align).toEqual([['left', true, 'true'], ['center', false, 'false'], ['right', false, 'false']]);
    state.def = act.setAlign(base, 1, 'center');
    expect(menu(1)).toMatch(/class="icon-btn sm hv-step on" data-act="fmt-align" data-v="center"/);
  });
  it('group, filter, colour rules (with its count), hide, remove: one icon row; no text items', () => {
    state.def = act.addConditionalRule(act.addConditionalRule(base, 1), 1);
    const html = menu(1);
    expect(html).not.toMatch(/Group by this<|Filter by this…<|Colour rules<span/);
    const row = /<div class="icon-row cm-actions">(.*?)<\/div>/.exec(html)![1];
    expect(actsIn(row)).toEqual(['cm-group', 'cm-filter', 'cm-view', 'cm-hide', 'col-remove']);
    expect(row).toMatch(/data-act="cm-view" data-v="colour"[^>]*>.*?<span class="n">2<\/span><\/button>/);
    expect(row).toMatch(/<span class="spacer"><\/span>/);
  });
  it('group is lit when the column is grouped; a hidden column offers show', () => {
    state.def = act.setGroupOptions(act.setSortField(base, 0, W), 0, { header: true });
    expect(menu(1)).toMatch(/class="icon-btn sm hv-step on" data-act="cm-group"/);
    state.def = act.setHidden(base, 1, true);
    expect(menu(1)).toMatch(/data-act="cm-show"/);
  });
  it('More… is kept, with what it holds', () => {
    menu(1);
    toggleMore();
    const html = menu(1);
    for (const a of ['cm-orient', 'fmt-width', 'fmt-thousands', 'cm-move']) expect(html).toContain(`data-act="${a}"`);
  });
  afterEach(() => { if (menuColumn() !== null) closePopover(); setMenuView('main'); });
});

describe('E. Fast descriptions inside popovers and overlays', () => {
  // Every icon-only button the window draws inside a popover or an overlay, read straight from
  // the source: an opening <button> tag whose whole content is one icon.
  // Paths in `/` form on every system, so the names below match on Windows too.
  const UI = resolve(__dirname, '../../../src/renderer/schedule-ui').replace(/\\/g, '/');
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const f = join(dir, n).replace(/\\/g, '/');
    return statSync(f).isDirectory() ? walk(f) : f.endsWith('.ts') ? [f] : [];
  });
  // The bar (step 1), the header and the rail keep their own tooltips; the table's headings
  // are not buttons.
  const OUTSIDE = ['viewBar.ts', 'header.ts', 'rail.ts', 'tableView.ts'];
  const files = walk(UI).filter((f) => !OUTSIDE.some((o) => f.endsWith(`/${o}`)));
  const iconButtons = files.flatMap((f) => [...readFileSync(f, 'utf8')
    .matchAll(/<(button|label)\b((?:[^<>]|\$\{[^}]*\})*?class="[^"]*\bicon-btn\b(?:[^<>]|\$\{[^}]*\})*)>\s*(?:<input[^>]*>\s*)?\$\{(?:ICON\.\w+|icon|grip)\}/g)]
    .map((m) => ({ file: f.slice(UI.length + 1), tag: m[0] })));

  it('found them, so the test is not vacuously passing', () => {
    expect(iconButtons.length).toBeGreaterThan(15);
  });
  it('each has a data-tip and an aria-label (on itself or its input), and no title', () => {
    for (const { file, tag } of iconButtons) {
      expect(tag, file).toMatch(/data-tip=/);
      expect(tag, file).toMatch(/aria-label=/);
      expect(tag, file).not.toMatch(/\stitle=/);
    }
  });

  it('as drawn: every icon-only button in the column menu, the sort popover and both +N lists', () => {
    const drawn: string[] = [];
    toggleColumnMenu(1);
    toggleMore();
    drawn.push(renderColumnMenu(state, store, cov(), runSchedule(store, state.def)));
    toggleMore();
    closePopover();
    state.def = { ...base, filters: Array.from({ length: 5 }, () => ({ field: FR, op: 'hasValue' }) as FilterRule) };
    for (const [k, i] of [['sort', '0'], ['fold', undefined], ['sfold', undefined], ['filter', '0']] as const) {
      open(k, i);
      drawn.push(renderViewPopover(state, store, cov()));
      closePopover();
    }
    const icons = drawn.flatMap((h) => [...h.matchAll(/<button\b[^>]*>\s*<svg[\s\S]*?<\/svg>\s*<\/button>/g)].map((m) => /<button\b[^>]*>/.exec(m[0])![0]));
    expect(icons.length).toBeGreaterThan(10);
    for (const t of icons) {
      expect(t).toMatch(/data-tip="[^"]+"/);
      expect(t).toMatch(/aria-label="[^"]+"/);
      expect(t).not.toMatch(/\stitle=/);
    }
  });

  it('one tip element, outside the popover, shows on hover and hides on leave, scroll and close', () => {
    const btn = new FakeEl('button', { act: 'cm-hide', tip: 'Hide column' }, popover);
    btn.rect = { left: 100, right: 128, top: 50, bottom: 78, width: 28, height: 28 };
    dispatch(btn, 'pointerover');
    expect(popover.contains(tip)).toBe(false);
    expect(tip.attrs.hidden).toBeUndefined();
    expect((tip as unknown as { textContent: string }).textContent).toBe('Hide column');
    expect(tip.classList.contains('on')).toBe(true);
    dispatch(btn, 'pointerout', { relatedTarget: popover });
    expect(tip.classList.contains('on')).toBe(false);
    dispatch(btn, 'pointerover');
    dispatch(popover, 'scroll');
    expect(tip.classList.contains('on')).toBe(false);
    dispatch(btn, 'pointerover');
    closePopover();
    expect(tip.classList.contains('on')).toBe(false);
  });
  it('the bar’s own tooltips are not doubled by it', () => {
    const btn = new FakeEl('button', { act: 'grand-total', tip: 'Grand total' }, head);
    dispatch(btn, 'pointerover');
    expect(tip.classList.contains('on')).toBe(false);
  });
  it('the CSS: the tip is fixed, the design’s look and timing; ::after tips are off inside popovers and overlays', () => {
    const css = readFileSync(resolve(UI, 'schedule.css'), 'utf8');
    expect(css).toMatch(/\.pop-tip \{[^}]*position: fixed;[^}]*transition: opacity \.1s ease \.04s/);
    expect(css).toMatch(/#popover \[data-tip\]::after, #overlay-root \[data-tip\]::after, #rail-pane \[data-tip\]::after, #output-pane \[data-tip\]::after \{ display: none; \}/);
    expect(readFileSync(resolve(UI, '../schedule.html'), 'utf8')).toMatch(/<div id="pop-tip" class="pop-tip" aria-hidden="true"><\/div>/);
  });
});

describe('G. An empty result names its cause', () => {
  const table = (filters: FilterRule[], logic: 'and' | 'or' = 'and') => {
    state.def = { ...base, filters, filterLogic: logic };
    return renderSchedule(state, runSchedule(store, state.def), cov()).replace(/\s+/g, ' ');
  };
  // Fix round 1: the headings stay; the note is one full-width row under them that selects
  // nothing and is never data.
  const noteRow = (html: string) => /<tr class="empty-row"><td colspan="(\d+)">(.*?)<\/td><\/tr>/.exec(html);
  it('one rule removes every row: it is named, with the way back — under the headings', () => {
    const r: FilterRule = { field: W, op: '>=', value: 5 };
    const html = table([{ field: FR, op: 'hasValue' }, r]);
    expect(html).toMatch(/<th[^>]* data-defcol="0"/);
    expect(html).toMatch(/data-act="vb-open" data-v="picker" data-id="th"/);
    const note = noteRow(html)!;
    expect(note, 'the note row').not.toBeNull();
    expect(Number(note[1])).toBe(state.def.columns.length);
    expect(html).not.toMatch(/<tr[^>]*class="empty-row"[^>]*data-row/);
    expect(note[2]).toContain(`<div class="empty-note">No rows. “${shortWords(store, state.def, r)}” removes every one.`);
    expect(html).toMatch(/<button class="btn" data-act="open-filter" data-i="1">Change that filter<\/button>/);
  });
  it('several together: said so, and the button opens the first rule', () => {
    const html = table([{ field: W, op: '>=', value: 5 }, { field: W, op: '>=', value: 6 }]);
    expect(html).toContain('<div class="empty-note">No rows match these filters.');
    expect(html).toMatch(/<button class="btn" data-act="open-filter" data-i="0">Change the first filter<\/button>/);
  });
  it('rows left: no note', () => {
    expect(table([{ field: FR, op: 'hasValue' }])).not.toMatch(/No rows|empty-row/);
  });
  it('a heading still opens its column menu', () => {
    state.def = { ...base, filters: [{ field: W, op: '>=', value: 5 }] };
    const th = new FakeEl('th', { defcol: '2' }, root);
    click(th);
    expect(menuColumn()).toBe(2);
    closePopover();
  });
  it('the note is not data: absent from the CSV and workbook rows, and the status line counts 0 rows', () => {
    state.def = { ...base, filters: [{ field: W, op: '>=', value: 5 }] };
    const rows = toRows(fullResult(store, state.def));
    expect(rows.map((r) => r.kind)).not.toContain('empty');
    expect(toCsv(rows)).not.toMatch(/No rows|Change that filter/);
    const res = runSchedule(store, state.def);
    expect(renderStatus(state, res, cov())).toMatch(/<span>0 rows<\/span>/);
  });
  it('the button opens that rule’s editor — on its chip, or on +N when it is folded', () => {
    state.def = { ...base, filters: Array.from({ length: 5 }, (_, n) => ({ field: W, op: '>=', value: n }) as FilterRule) };
    const fold = new FakeEl('button', { act: 'vb-open', v: 'fold' }, head);
    fold.attrs['aria-haspopup'] = 'dialog';
    const el = new FakeEl('button', { act: 'open-filter', i: '4' }, root);
    click(el);
    expect(openChip()).toEqual({ kind: 'filter', i: 4 });
    anchorPopover();
    expect(fold.attrs['aria-expanded']).toBe('true');
  });
});

describe('one tooltip rule for the whole window: no title on a control (fix round 1)', () => {
  // Every `title="…"` the window's source writes, by file and the tag that carries it. A title may
  // stay only where it is not a control and carries content's full text (or, for the Vee dot, the
  // three-line hover the 2026-11-24 deviation records).
  // Paths in `/` form on every system, so the names below match on Windows too.
  const UI = resolve(__dirname, '../../../src/renderer/schedule-ui').replace(/\\/g, '/');
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const f = join(dir, n).replace(/\\/g, '/');
    return statSync(f).isDirectory() ? walk(f) : f.endsWith('.ts') ? [f] : [];
  });
  const found = walk(UI).flatMap((f) => {
    const src = readFileSync(f, 'utf8');
    return [...src.matchAll(/\stitle="/g)].map((m) => {
      const open = src.lastIndexOf('<', m.index);
      const tag = /^<(\w+)(?:[^>]*?class="([^"]*)")?/.exec(src.slice(open))!;
      return `${f.slice(UI.length + 1)} ${tag[1]}.${(tag[2] ?? '').split(' ')[0]}`;
    });
  });
  // The one control on the list is a column heading: its title is a paragraph of mouse and
  // keyboard help, and at the fast tooltip's 0.14 s it would cover the table every time the
  // pointer crossed the header row. It stays the slow native title it was before this build.
  it('only the listed exceptions', () => {
    expect(found.sort()).toEqual([
      'fieldPicker.ts span.twin', // the property set a shortened tag ("Qto") stands for
      'overlays/libraryList.ts span.cls', // every class of a template whose row shows only the first
      'overlays/libraryList.ts span.twin', // the full filter a "filtered" tag stands for
      'rail.ts div.rail-item', // the open schedule's name, cut short in the rail
      'tableView.ts span.th-dot', // "Calculated by Vee", its note and formula: the 2026-11-24 hover
      'tableView.ts th.${cls}', // a column heading's long mouse-and-keyboard help (see above)
    ]);
  });
});
