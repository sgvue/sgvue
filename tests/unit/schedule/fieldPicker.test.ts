// The field picker: the values that ride on the coverage pass, the list it builds, and the
// keyboard flow through the real wiring on the fake DOM (tests/support/fakeDom.ts).
//
// Proven to fail: (1) dropping the min/max branch from valuesOf fails "a capped number field
// shows its range"; (2) building pick-commit's columns with `{ field }` instead of columnFor
// fails "the picker adds the columns a hand-added field gets"; (3) answering an arrow key with
// refreshPicker() fails "arrow keys and hover move the strip, never the list".
//
// Ported from ifcTable's `tests/fieldPicker.test.ts` (Yong Yen, 2026-11-05) for SGVue v1.5.0,
// phase 2. SGVue's rows carry the window's hover class (`prow hv-step`), which the markup
// expectations name; the wiring is SGVue's, hooks and the one pending edit included.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreBuilder, type ModelStore } from '../../../src/schedule/ifc/store';
import type { Cell, ElemCore, ModelMeta } from '../../../src/schedule/ifc/types';
import * as act from '../../../src/schedule/schedule/actions';
import { emptySchedule, type Column, type ScheduleDef } from '../../../src/schedule/schedule/def';
import { columnForProp } from '../../../src/schedule/schedule/columns';
import { suggestedFor } from '../../../src/schedule/schedule/presets';
import { state } from '../../../src/renderer/schedule-ui/state';
import { buildCoverage, SAMPLE_CAP, valuesOf } from '../../../src/renderer/schedule-ui/coverage';
import { wireApp } from '../../../src/renderer/schedule-ui/events';
import { pickedIds, renderPicker, resetPicker } from '../../../src/renderer/schedule-ui/fieldPicker';
import { MAX_ROWS, pickerModel, type PickerQuery } from '../../../src/renderer/schedule-ui/pickerModel';
import { wirePending } from '../../../src/renderer/schedule-ui/pending';
import { closePopover, wirePopover } from '../../../src/renderer/schedule-ui/popover';
import { openChip } from '../../../src/renderer/schedule-ui/viewBar';
import { FakeEl, installFakeDom } from './support/fakeDom';

const N = 80;
function doors(): ModelStore {
  const b = new StoreBuilder();
  const cores: ElemCore[] = [];
  const cells: Record<string, Cell>[] = [];
  for (let i = 0; i < N; i++) {
    cores.push({
      entity: 'IfcDoor', name: `D${i}`, description: '', mark: `M${i % 3}`, typeName: 'Single', family: 'Door',
      objectType: '', predefinedType: '', guid: `g${i}`, storey: i % 2 ? 'L1' : 'L2', storeyElevation: 0,
      building: '', site: '', space: '', material: '', discipline: 'ARC',
    });
    cells.push({
      // 80 distinct widths, past the cap: a range.
      'Qto_DoorBaseQuantities.Width': { v: 0.075 + i * 0.6, k: 'length' },
      // The same name in a second pset, with few values: a top three.
      'Dimensions.Width': { v: [0.9, 0.9, 0.9, 1.0, 1.0, 1.2][i % 6], k: 'length' },
      // 80 distinct texts: a top three and "…".
      'Pset_DoorCommon.Reference': { v: `R${String(i).padStart(2, '0')}` },
      'Pset_DoorCommon.FireRating': { v: ['2HR', '2HR', '1HR', 'FD30'][i % 4] },
      ...(i < 20 ? { 'Pset_DoorCommon.IsExternal': { v: i % 2 === 0 } } : {}),
    });
  }
  b.add(cores, cells);
  const meta: ModelMeta = {
    fileName: 'd.ifc', schema: 'IFC4', projectName: '', authoringTool: '', lengthUnit: 'mm',
    unitSystem: 'metric', elementCount: N, parseMs: 0,
  };
  return b.finish(meta);
}

const store = doors();
const cov = buildCoverage(store, ['IfcDoor']);
const base: ScheduleDef = { ...emptySchedule('Doors', ['IfcDoor']), columns: [{ field: { kind: 'core', key: 'mark' } }] as Column[] };
const q = (over: Partial<PickerQuery> = {}): PickerQuery =>
  ({ query: '', single: false, view: 'list', showEmpty: false, shut: new Set(), ...over });

describe('values ride on the coverage pass', () => {
  it('is built once per category and reused', () => {
    expect(buildCoverage(store, ['IfcDoor'])).toBe(cov);
    expect(cov.total).toBe(N);
  });

  it('three commonest values, as the table shows them, in the default unit', () => {
    expect(valuesOf(cov, { kind: 'prop', pset: 'Dimensions', prop: 'Width' }, 'metric'))
      .toEqual({ top: ['900 mm', '1,000 mm', '1,200 mm'], more: 0, capped: false, range: '' });
    expect(valuesOf(cov, { kind: 'prop', pset: 'Pset_DoorCommon', prop: 'FireRating' }, 'metric')?.top).toEqual(['2HR', '1HR', 'FD30']);
    expect(valuesOf(cov, { kind: 'core', key: 'mark' }, 'metric')?.top).toEqual(['M0', 'M1', 'M2']);
  });

  it('a capped number field shows its range — over every value, not just the tracked ones', () => {
    const t = cov.tallies.get('Qto_DoorBaseQuantities.Width')!;
    expect(t.capped).toBe(true);
    expect(t.counts.size).toBe(SAMPLE_CAP);
    expect(valuesOf(cov, { kind: 'prop', pset: 'Qto_DoorBaseQuantities', prop: 'Width' }, 'metric'))
      .toEqual({ top: [], more: 0, capped: true, range: '75 – 47,475 mm' });
  });

  it('a capped text field keeps its top three and says there is more', () => {
    expect(valuesOf(cov, { kind: 'prop', pset: 'Pset_DoorCommon', prop: 'Reference' }, 'metric'))
      .toEqual({ top: ['R00', 'R01', 'R02'], more: SAMPLE_CAP - 3, capped: true, range: '' });
  });

  it('an empty field has no values', () => {
    expect(valuesOf(cov, { kind: 'core', key: 'description' }, 'metric')).toBe(null);
  });
});

describe('what the picker lists', () => {
  const rowsOf = (m: ReturnType<typeof pickerModel>) => m.sections.flatMap((s) => s.rows.map((r) => r.label));

  it('two psets with one name are two rows, told apart by source', () => {
    const labels = rowsOf(pickerModel(base, store, cov, q()));
    expect(labels).toContain('Width (Qto)');
    expect(labels).toContain('Width (Dimensions)');
  });

  it('0% fields wait behind "Show N empty fields"', () => {
    const m = pickerModel(base, store, cov, q());
    expect(rowsOf(m)).not.toContain('Description');
    expect(m.emptyHidden).toBeGreaterThan(0);
    expect(rowsOf(pickerModel(base, store, cov, q({ showEmpty: true })))).toContain('Description');
  });

  it('a search that hits only empty fields says so', () => {
    const m = pickerModel(base, store, cov, q({ query: 'descr' }));
    expect(m.pickable).toEqual([]);
    expect(m.onlyEmpty).toBe(1);
  });

  it('"qto ar"-style search: every token starts a word of the name or the pset', () => {
    const m = pickerModel(base, store, cov, q({ query: 'qto wid' }));
    expect(m.pickable.map((r) => r.label)).toEqual(['Width (Qto)']);
    expect(pickerModel(base, store, cov, q({ query: 'idth' })).pickable).toEqual([]);
  });

  it('a value finds the fields that hold it', () => {
    const m = pickerModel(base, store, cov, q({ query: 'FD30' }));
    const hit = m.sections.find((s) => s.title.startsWith('Contains'))!.rows[0];
    expect(hit.label).toBe('FireRating');
    expect(hit.hit).toEqual({ n: N / 4, example: 'FD30' });
  });

  it('multi-pick lists columns apart; single-pick offers them too', () => {
    const multi = pickerModel(base, store, cov, q());
    expect(multi.sections[0]).toMatchObject({ title: 'In this table', table: true });
    expect(multi.pickable.some((r) => r.id === 'core|mark')).toBe(false);
    expect(pickerModel(base, store, cov, q({ single: true })).pickable.some((r) => r.id === 'core|mark')).toBe(true);
  });

  it('"Suggested" is what the category’s templates ask for, matched by name across psets', () => {
    expect(suggestedFor(['IfcDoor']).map((f) => (f.kind === 'core' ? f.key : f.kind === 'prop' ? f.prop : '')))
      .toEqual(['mark', 'typeName', 'storey', 'Width', 'Height', 'FireRating']);
    const sug = pickerModel(base, store, cov, q()).sections.find((s) => s.title === 'Suggested for Door')!;
    expect(sug.rows.map((r) => r.label)).toEqual(['Type', 'Level', 'Width (Qto)', 'Width (Dimensions)', 'FireRating']);
    expect(suggestedFor(['IfcBuildingElementProxy'])).toEqual([]);
  });

  it('a column asking by name across psets (a template column) counts as that field', () => {
    // The Door template's FireRating is { pset: '*' }. Proven to fail: with an exact-key test
    // it was still offered — Suggested listed it and a tick added a duplicate column.
    const tpl: ScheduleDef = { ...base, columns: [...base.columns, { field: { kind: 'prop', pset: '*', prop: 'firerating' } }] };
    const m = pickerModel(tpl, store, cov, q());
    expect(m.pickable.some((r) => r.name === 'FireRating')).toBe(false);
    expect(m.sections.find((s) => s.title === 'Suggested for Door')!.rows.map((r) => r.label)).not.toContain('FireRating');
    expect(pickerModel(tpl, store, cov, q({ query: 'fire' })).pickable).toEqual([]);
    // Single-pick still offers it: a filter may use a column's field.
    expect(pickerModel(tpl, store, cov, q({ single: true })).pickable.some((r) => r.name === 'FireRating')).toBe(true);
  });

  it('"In this table" rows carry Hide or Show; only a twin carries a source tag', () => {
    state.store = store;
    state.def = { ...base, columns: [{ field: { kind: 'core', key: 'mark' }, hidden: true },
      { field: { kind: 'prop', pset: '*', prop: 'Width' } }, { field: { kind: 'prop', pset: 'Dimensions', prop: 'Width' } }] };
    resetPicker('picker');
    const html = renderPicker(store, cov);
    expect(html).toMatch(/data-act="cm-show" data-defcol="0">Show</);
    expect(html).toMatch(/data-act="cm-hide" data-defcol="1"/);
    // An any-pset column resolves by name, so it is no twin; the exact-pset one is.
    expect(html.match(/<span class="twin"[^>]*>[^<]*<\/span>/g)).toEqual(['<span class="twin" title="Dimensions">Dimensions</span>']);
    expect(html).not.toMatch(/class="pset"/);
  });

  it('rows are one line: name, twin tag, coverage only below 100% — no samples, no bar', () => {
    state.store = store;
    state.def = structuredClone(base);
    resetPicker('picker');
    const html = renderPicker(store, cov);
    const row = (id: string) => html.split('<div class="prow hv-step').find((r) => r.includes(`data-id="${id}"`))?.split('</div>')[0] ?? '';
    expect(row('prop|Qto_DoorBaseQuantities|Width')).toMatch(/<span class="pname">Width<\/span><span class="twin" title="Qto_DoorBaseQuantities">Qto<\/span>$/);
    // IsExternal is on 20 of 80 doors: 25%, warn colour.
    expect(row('prop|Pset_DoorCommon|IsExternal')).toMatch(/<span class="cov">25%<\/span>$/);
    expect(html.split('class="pstrip"')[0]).not.toMatch(/class="(psamp|pcov|bar)"/);
    // The strip follows the highlight: the top row, with its full source and its coverage.
    expect(html).toMatch(/<div class="pstrip"[^>]*><div class="s1"><span class="sn">Type<\/span><span class="sp">Identity &amp; location<\/span>/);
    expect(html).toMatch(/80 of 80 Door/);
  });

  it('draws at most MAX_ROWS rows and counts the rest', () => {
    const many = new StoreBuilder();
    const cores: ElemCore[] = [{ entity: 'IfcDoor', guid: 'x', name: '', description: '', mark: '', typeName: '', family: '', objectType: '', predefinedType: '', storey: '', storeyElevation: 0, building: '', site: '', space: '', material: '', discipline: 'ARC' }];
    const row: Record<string, Cell> = {};
    for (let i = 0; i < 120; i++) row[`P.F${i}`] = { v: i };
    many.add(cores, [row]);
    const s = many.finish({ ...store.meta });
    const m = pickerModel({ ...base, columns: [] }, s, buildCoverage(s, ['IfcDoor']), q());
    expect(m.pickable.length).toBe(MAX_ROWS);
    expect(m.more).toBeGreaterThan(60);
  });
});

describe('picking with the keyboard, through the real wiring', () => {
  const { root, win, dispatch } = installFakeDom();
  const popover = new FakeEl('div', {}, root);
  popover.attrs.id = 'popover';
  let box: FakeEl;

  beforeAll(() => {
    wirePending(root as unknown as EventTarget, win as unknown as EventTarget);
    wirePopover(root as unknown as HTMLElement);
    wireApp(root as unknown as HTMLElement, {
      pickRow: () => {}, rowMenu: () => {}, headMenu: () => {}, moveRow: () => {}, frameSelection: () => {},
    });
  });
  beforeEach(() => {
    vi.useFakeTimers();
    state.store = store;
    state.def = structuredClone(base);
    closePopover();
    // Open it the way the chip does, then type into its search box.
    const chip = new FakeEl('button', { act: 'vb-open', v: 'picker', id: 'chip' }, root);
    dispatch(chip, 'click');
    box = new FakeEl('input', { act: 'pick-search' }, popover);
  });
  afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

  const type = (text: string) => { box.value = text; dispatch(box, 'input'); };
  const key = (k: string, ctrlKey = false) => dispatch(box, 'keydown', { key: k, ctrlKey });

  it('Enter ticks the top match and clears the box; Enter on the empty box ticks too; Ctrl+Enter adds', () => {
    expect(openChip()).toEqual({ kind: 'picker', i: undefined });
    type('fire'); key('Enter');
    expect(box.value).toBe('');
    type('qto wid'); key('Enter');
    expect(pickedIds()).toEqual(['prop|Pset_DoorCommon|FireRating', 'prop|Qto_DoorBaseQuantities|Width']);
    // Nothing typed: Enter still ticks the highlighted row (Type, top of Suggested), and a
    // second Enter unticks it. Nothing is added until Ctrl+Enter.
    key('Enter');
    expect(pickedIds()).toEqual(['prop|Pset_DoorCommon|FireRating', 'prop|Qto_DoorBaseQuantities|Width', 'core|typeName']);
    key('Enter');
    expect(pickedIds()).toHaveLength(2);
    expect(state.def.columns).toHaveLength(1);
    key('Enter', true);
    expect(state.def.columns.map((c) => c.field)).toEqual([
      { kind: 'core', key: 'mark' },
      { kind: 'prop', pset: 'Pset_DoorCommon', prop: 'FireRating' },
      { kind: 'prop', pset: 'Qto_DoorBaseQuantities', prop: 'Width' },
    ]);
    expect(openChip()).toBe(null);
  });

  it('Backspace on the empty box unticks the last; Ctrl+Enter adds with text still typed', () => {
    type('fire'); key('Enter');
    type('ref'); key('Enter');
    key('Backspace');
    expect(pickedIds()).toEqual(['prop|Pset_DoorCommon|FireRating']);
    type('something');
    key('Enter', true);
    expect(state.def.columns).toHaveLength(2);
  });

  it('↓ moves the highlight, and Enter ticks the highlighted row', () => {
    type('width');
    key('ArrowDown'); key('Enter');
    // Width (Dimensions) sorts first; ↓ lands on Width (Qto).
    expect(pickedIds()).toEqual(['prop|Qto_DoorBaseQuantities|Width']);
  });

  it('the picker adds the columns a hand-added field gets — units, decimals, alignment', () => {
    // Before M4 this compared against the Add-fields modal's Add button; both used columnFor,
    // which builds exactly these: columnForProp from the field's stats, in the model's units.
    type('fire'); key('Enter');
    type('qto wid'); key('Enter');
    type('ext'); key('Enter');
    key('Enter', true);
    const stat = (k: string) => store.propCatalog.get(k)!;
    const want = act.addColumns(base, ['Pset_DoorCommon.FireRating', 'Qto_DoorBaseQuantities.Width', 'Pset_DoorCommon.IsExternal']
      .map((k) => columnForProp({ ...stat(k), count: 0 }, 'metric')));
    expect(state.def).toEqual(want);
    expect(state.def.columns[2].format).toMatchObject({ display: 'mm' });
  });

  it('arrow keys and hover move the strip, never the list', () => {
    const list = new FakeEl('div', {}, popover); list.classes.push('pick-list');
    const strip = new FakeEl('div', {}, popover); strip.classes.push('pstrip');
    type('width');
    // What refreshPicker drew, as elements (the fake DOM does not parse innerHTML).
    const rows = ['prop|Dimensions|Width', 'prop|Qto_DoorBaseQuantities|Width'].map((id) => {
      const r = new FakeEl('div', { act: 'pick-toggle', id }, list); r.classes.push('prow'); return r;
    });
    expect(strip.innerHTML).toMatch(/<span class="sp">Dimensions<\/span>/);
    const painted = list.writes;
    key('ArrowDown');
    expect(list.writes, 'an arrow key repainted the list').toBe(painted);
    expect(document.querySelector('#popover .pick-list')).toBe(list);
    expect(rows.map((r) => r.classes.includes('sel'))).toEqual([false, true]);
    expect(strip.innerHTML).toMatch(/<span class="sp">Qto_DoorBaseQuantities<\/span>/);
    // Hover previews the other row without moving the highlight; leaving hands it back.
    dispatch(rows[0], 'mouseover');
    expect(strip.innerHTML).toMatch(/<span class="sp">Dimensions<\/span>/);
    expect(rows[1].classes).toContain('sel');
    expect(strip.attrs['aria-live'], 'a hover is not announced').toBe('off');
    dispatch(rows[0], 'mouseout', { relatedTarget: root });
    expect(strip.innerHTML).toMatch(/<span class="sp">Qto_DoorBaseQuantities<\/span>/);
    // A section heading inside the list is no row: the strip goes back to the highlight.
    const head = new FakeEl('div', {}, list); head.classes.push('psec');
    dispatch(rows[0], 'mouseover');
    dispatch(head, 'mouseover');
    expect(strip.innerHTML).toMatch(/<span class="sp">Qto_DoorBaseQuantities<\/span>/);
    key('ArrowUp'); key('ArrowDown');
    expect(strip.attrs['aria-live'], 'a keyboard move is announced').toBe('polite');
    expect(list.writes, 'hover repainted the list').toBe(painted);
    // Enter drops the hover: the strip follows the keyboard highlight again.
    dispatch(rows[0], 'mouseover');
    key('Enter');
    expect(pickedIds()).toEqual(['prop|Qto_DoorBaseQuantities|Width']);
    // The box cleared, so the highlight is the full list's top row — not the hovered one.
    expect(strip.innerHTML).toMatch(/<span class="sn">Type<\/span>/);
    popover.children = popover.children.filter((c) => c !== list && c !== strip);
  });

  it('a value hit shows that value, highlighted, in the strip', () => {
    const strip = new FakeEl('div', {}, popover); strip.classes.push('pstrip');
    const list = new FakeEl('div', {}, popover); list.classes.push('pick-list');
    type('FD3');
    expect(strip.innerHTML).toMatch(/<span class="pval hit"><mark>FD3<\/mark>0<\/span><span class="pval more">20 elements<\/span>/);
    popover.children = popover.children.filter((c) => c !== list && c !== strip);
  });

  it('Ctrl+K with the picker open goes back to its search — nothing typed or ticked is lost', () => {
    type('fire'); key('Enter');
    type('wid');
    dispatch(new FakeEl('div', {}, root), 'keydown', { key: 'k', ctrlKey: true });
    expect(pickedIds()).toEqual(['prop|Pset_DoorCommon|FireRating']);
    expect(openChip()).toEqual({ kind: 'picker', i: undefined });
  });

  it('Hide on an "In this table" row hides that column', () => {
    dispatch(new FakeEl('button', { act: 'cm-hide', defcol: '0' }, popover), 'click');
    expect(state.def.columns[0].hidden).toBe(true);
  });

  it('in single-pick mode Enter starts a filter rule on the top match', () => {
    closePopover();
    dispatch(new FakeEl('button', { act: 'vb-open', v: 'add-filter' }, root), 'click');
    type('fire'); key('Enter');
    expect(state.def.filters).toEqual([{ field: { kind: 'prop', pset: 'Pset_DoorCommon', prop: 'FireRating' }, op: 'hasValue' }]);
    expect(openChip()).toEqual({ kind: 'filter', i: 0 });
  });
});
