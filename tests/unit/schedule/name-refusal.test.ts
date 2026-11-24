// The Schedules window shows a refused name, and a formula loop, the way it shows a formula
// that does not parse (2026-11-24): the calculated-value editor's `.tip-error` under the box,
// the column menu's `.pop-note.bad`. Names are untrusted, so they reach the markup escaped.

import { describe, expect, it } from 'vitest';
import { StoreBuilder, type ModelStore } from '../../../src/schedule/ifc/store';
import type { Cell, ElemCore, ModelMeta } from '../../../src/schedule/ifc/types';
import { emptySchedule, type Calculated, type Column, type ScheduleDef } from '../../../src/schedule/schedule/def';
import { calcNameProblem, headingProblem } from '../../../src/schedule/schedule/calcNames';
import { runSchedule } from '../../../src/schedule/schedule/engine';
import { renderColumnMenu, toggleColumnMenu } from '../../../src/renderer/schedule-ui/columnMenu';
import { buildCoverage } from '../../../src/renderer/schedule-ui/coverage';
import { calcEditor } from '../../../src/renderer/schedule-ui/overlays/calcEditor';
import { closePopover } from '../../../src/renderer/schedule-ui/popover';
import { state as blankState, type AppState } from '../../../src/renderer/schedule-ui/state';
import { installFakeDom } from './support/fakeDom';

installFakeDom();

const meta: ModelMeta = {
  fileName: 'f.ifc', schema: 'IFC4', projectName: '', authoringTool: '',
  lengthUnit: 'mm', unitSystem: 'metric', elementCount: 0, parseMs: 0,
};
function build(): ModelStore {
  const b = new StoreBuilder();
  const cores: ElemCore[] = [];
  const cells: Record<string, Cell>[] = [];
  for (let i = 0; i < 2; i++) {
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
const store = build();
const colW: Column = { field: { kind: 'prop', pset: 'P', prop: 'W' }, heading: '<b>W' };
const f = (id: string, name: string, formula: string): Calculated => ({ id, name, kind: 'formula', formula });
const schedule = (calculated: Calculated[]): ScheduleDef => ({
  ...emptySchedule('Walls', ['IfcWall']),
  columns: [colW, ...calculated.map((c): Column => ({ field: { kind: 'formula', id: c.id } }))],
  calculated,
});
const menuOf = (state: AppState, i: number): string => {
  toggleColumnMenu(i);
  try {
    return renderColumnMenu(state, store, buildCoverage(store, ['IfcWall']), runSchedule(store, state.def));
  } finally {
    closePopover();
  }
};

describe('a refused name', () => {
  it('the editor keeps what was typed in the box and says why, escaped', () => {
    const def = schedule([f('c1', 'Double', '[<b>W] * 2')]);
    const problem = calcNameProblem(def, 'c1', '<B>w')!;
    expect(problem).toBe('Another column is already called "<B>w" — each calculated column needs a name of its own.');
    const state = { ...blankState, store, def, nameRefusal: { key: 'calc:c1', text: '<B>w', problem, def } } as AppState;
    const html = calcEditor(state, store);
    expect(html).toContain('value="&lt;B&gt;w"');
    expect(html).toContain('<div class="sub tip-error">Another column is already called &quot;&lt;B&gt;w&quot;');
    expect(html).toContain('class="subcard bad"');
    expect(html).not.toContain('<B>');
    // Lapsed once the definition on screen is another one.
    const later = { ...state, def: structuredClone(def) } as AppState;
    expect(calcEditor(later, store)).not.toContain('tip-error');
  });

  it('the column menu keeps the heading typed and says why in its bad note', () => {
    const def = schedule([f('c1', 'Double', '[<b>W] * 2')]);
    const problem = headingProblem(def, 0, 'double')!;
    expect(problem).toBe('A calculated column is already called "Double" — give this column another heading.');
    const state = { ...blankState, store, def, nameRefusal: { key: 'col:0', text: 'double', problem, def } } as AppState;
    const html = menuOf(state, 0);
    expect(html).toContain('value="double"');
    expect(html).toContain('<div class="pop-note bad"><span class="grow-1">A calculated column is already called &quot;Double&quot;');
  });

  it('a loop shows on each member’s column menu as a formula that does not parse does', () => {
    const def = schedule([f('a', 'A<i>', '[B<i>] + 1'), f('b', 'B<i>', '[A<i>] + 1')]);
    const state = { ...blankState, store, def } as AppState;
    for (const i of [1, 2]) {
      const html = menuOf(state, i);
      expect(html).toContain('<div class="pop-note bad"><span class="grow-1">&quot;A&lt;i&gt;&quot; and &quot;B&lt;i&gt;&quot; use each other in a loop');
    }
    expect(runSchedule(store, def).rows.filter((r) => r.kind === 'data').map((r) => (r as { cells: string[] }).cells.slice(1)))
      .toEqual([['', ''], ['', '']]);
  });
  // 2026-11-25 — the review's fixes, where their messages show (F1, F2, F3), escaped.
  it('a model heading another column has, while a formula uses it, is refused in the bad note', () => {
    const colH: Column = { field: { kind: 'prop', pset: 'P', prop: 'H' }, heading: '<i>H' };
    const calc = f('c1', 'Double', '[<b>W] * 2');
    const def: ScheduleDef = { ...schedule([calc]), columns: [colW, colH, { field: { kind: 'formula', id: 'c1' } }] };
    const problem = headingProblem(def, 0, '<I>h')!;
    expect(problem).toBe('Another column is already called "<i>H", and a formula uses one of the two — give this column another heading.');
    const state = { ...blankState, store, def, nameRefusal: { key: 'col:0', text: '<I>h', problem, def } } as AppState;
    const html = menuOf(state, 0);
    expect(html).toContain('value="&lt;I&gt;h"');
    expect(html).toContain('<div class="pop-note bad"><span class="grow-1">Another column is already called &quot;&lt;i&gt;H&quot;, and a formula uses one of the two');
    expect(html).not.toContain('<i>');
  });

  it('a calculated column’s heading another column has is refused in the bad note', () => {
    const def = schedule([f('c1', 'Double', '[<b>W] * 2')]);
    const problem = headingProblem(def, 1, '<B>w')!;
    expect(problem).toBe('Another column is already called "<b>W" — give this column another heading.');
    const state = { ...blankState, store, def, nameRefusal: { key: 'col:1', text: '<B>w', problem, def } } as AppState;
    expect(menuOf(state, 1)).toContain('<div class="pop-note bad"><span class="grow-1">Another column is already called &quot;&lt;b&gt;W&quot; — give this column another heading.');
  });

  it('a value blank behind a broken one says which, on its column menu and in the editor', () => {
    const def = schedule([f('a', 'A<i>', '[A<i>] + 1'), f('d', 'D', '[A<i>] * 2')]);
    const state = { ...blankState, store, def } as AppState;
    const said = 'Cannot be worked out: &quot;A&lt;i&gt;&quot; has a problem.';
    expect(menuOf(state, 2)).toContain(`<div class="pop-note bad"><span class="grow-1">${said}`);
    const editor = calcEditor(state, store);
    expect(editor).toContain(said);
    expect(editor).not.toContain('<i>');
  });
});
