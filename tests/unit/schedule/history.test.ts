// Undo/redo, including the rule that makes it feel right: typing collapses into one step,
// but adding or removing something never does.

import { beforeEach, describe, expect, it } from 'vitest';
import { record, redo, redoDepth, resetHistory, setClock, undo, undoDepth } from '../../../src/schedule/history';
import { emptySchedule, type ScheduleDef } from '../../../src/schedule/schedule/def';
// Phase 2 (2026-09-25): the reorder helper is ported now.
import { moveItem } from '../../../src/renderer/schedule-ui/dnd';

let clock = 0;
setClock(() => clock);

function base(): ScheduleDef {
  return {
    ...emptySchedule('Door Schedule', ['IfcDoor']),
    columns: [
      { field: { kind: 'core', key: 'name' } },
      { field: { kind: 'core', key: 'storey' } },
    ],
  };
}

let def: ScheduleDef;

beforeEach(() => {
  clock = 0;
  def = base();
  resetHistory(def);
});

describe('undo and redo', () => {
  it('returns the previous definition', () => {
    def.name = 'Renamed';
    clock = 5000;
    record(def);
    expect(undoDepth()).toBe(1);
    expect(undo()?.name).toBe('Door Schedule');
  });

  it('ignores a change that changes nothing', () => {
    record(def);
    expect(undoDepth()).toBe(0);
  });

  it('collapses a burst of typing into one step', () => {
    for (const name of ['D', 'Do', 'Doo', 'Door x']) {
      clock += 100; // inside the 700ms window
      def.name = name;
      record(def);
    }
    expect(undoDepth()).toBe(1);
    expect(undo()?.name).toBe('Door Schedule');
  });

  it('does not collapse typing separated by a pause', () => {
    clock += 100;
    def.name = 'One';
    record(def);
    clock += 5000;
    def.name = 'Two';
    record(def);
    expect(undoDepth()).toBe(2);
  });

  it('never collapses a structural change, however fast', () => {
    clock += 10;
    def.columns.push({ field: { kind: 'core', key: 'guid' } });
    record(def);
    clock += 10;
    def.columns.pop();
    record(def);
    expect(undoDepth()).toBe(2);
    expect(undo()?.columns).toHaveLength(3);
  });

  it('does not swallow a structural change into the typing that follows it', () => {
    // Reorder a column, then start typing straight away. Without the "the previous change
    // must also have been text" rule, the burst absorbed the reorder's entry and one undo
    // took back both — quietly reordering the schedule behind the user's back.
    clock += 100;
    def.columns.reverse();
    record(def);
    clock += 100; // well inside the burst window
    def.name = 'Renamed';
    record(def);
    expect(undoDepth()).toBe(2);
    expect(undo()?.name).toBe('Door Schedule');       // first undo: just the rename
    expect(undo()?.columns[0].field).toEqual({ kind: 'core', key: 'name' }); // then the reorder
  });

  it('gives a calculated value its own step, even mid-rename', () => {
    // Saying what a formula returns also re-aligns every column showing it. Neither the
    // declaration nor the alignment was in the shape signature, so this whole cascade could
    // merge into the rename typed a moment earlier — one undo then quietly moved columns
    // the user had not touched.
    def.calculated = [{ id: 'c1', name: 'Size', kind: 'formula', formula: 'Area > 10' }];
    def.columns.push({ field: { kind: 'formula', id: 'c1' }, align: 'right' });
    clock += 100;
    record(def);

    clock += 100;
    def.calculated[0].name = 'Room size';        // free text — mergeable on its own
    record(def);

    clock += 100;                                 // well inside the burst window
    def.calculated[0].result = 'text';
    def.columns[2].align = 'left';
    record(def);

    expect(undoDepth()).toBe(3);
    expect(undo()?.columns[2].align).toBe('right');   // first undo: only the declaration
    expect(undo()?.calculated?.[0].name).toBe('Size');
  });

  it('still merges a burst of typing inside a formula box', () => {
    def.calculated = [{ id: 'c1', name: 'Size', kind: 'formula', formula: '' }];
    clock += 100;
    record(def);
    for (const f of ['A', 'Ar', 'Are', 'Area']) {
      clock += 100;
      def.calculated[0].formula = f;
      record(def);
    }
    expect(undoDepth()).toBe(2);
  });

  it('redoes what it undid', () => {
    clock = 1000;
    def.name = 'Renamed';
    record(def);
    expect(undo()?.name).toBe('Door Schedule');
    expect(redoDepth()).toBe(1);
    expect(redo()?.name).toBe('Renamed');
    expect(undoDepth()).toBe(1);
  });

  it('drops the redo stack once a new edit lands', () => {
    clock = 1000;
    def.name = 'Renamed';
    record(def);
    const back = undo()!;
    expect(redoDepth()).toBe(1);
    clock = 9000;
    back.name = 'Different';
    record(back);
    expect(redoDepth()).toBe(0);
  });

  it('restoring a state does not itself become an undo step', () => {
    clock = 1000;
    def.name = 'Renamed';
    record(def);
    const prev = undo()!;
    record(prev); // this is what update() does after applying an undo
    expect(undoDepth()).toBe(0);
    expect(redoDepth()).toBe(1);
  });

  it('caps the stack so a long session cannot grow without bound', () => {
    for (let i = 0; i < 90; i++) {
      clock += 5000;
      def.columns.push({ field: { kind: 'core', key: 'guid' } });
      record(def);
    }
    expect(undoDepth()).toBe(60);
  });

  it('has nothing to undo after a reset', () => {
    clock = 1000;
    def.name = 'Renamed';
    record(def);
    resetHistory(def);
    expect(undoDepth()).toBe(0);
    expect(undo()).toBeNull();
  });

  it('hands back a copy, not the live object', () => {
    clock = 1000;
    def.name = 'Renamed';
    record(def);
    const prev = undo()!;
    prev.columns.push({ field: { kind: 'core', key: 'guid' } });
    expect(def.columns).toHaveLength(2);
  });
});

describe('moveItem', () => {
  it('moves an item and reports it', () => {
    const list = ['a', 'b', 'c'];
    expect(moveItem(list, 0, 2)).toBe(true);
    expect(list).toEqual(['b', 'c', 'a']);
  });

  it('refuses out-of-range and no-op moves, so arrow keys at the ends do nothing', () => {
    const list = ['a', 'b', 'c'];
    expect(moveItem(list, 0, -1)).toBe(false);
    expect(moveItem(list, 2, 3)).toBe(false);
    expect(moveItem(list, 1, 1)).toBe(false);
    expect(list).toEqual(['a', 'b', 'c']);
  });
});
