// Combine by sort value (2026-11-24): the status line's collapse text, the one route a
// definition travels that `combine-by-sort.test.ts` does not cover — the main window's
// `portableSavedList`, which hands a project's saved setups to the Schedules window — and the
// compatibility corpus's `current/combined.schedule.json`, written by `make-corpus.cjs`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StoreBuilder } from '../../../src/schedule/ifc/store';
import type { ElemCore, ModelMeta } from '../../../src/schedule/ifc/types';
import { portableSavedList, readSavedList } from '../../../src/schedule/messages';
import { emptySchedule, parseScheduleDef, type ScheduleDef, type SortLevel } from '../../../src/schedule/schedule/def';
import { runSchedule } from '../../../src/schedule/schedule/engine';
import { buildCoverage } from '../../../src/renderer/schedule-ui/coverage';
import { renderStatus } from '../../../src/renderer/schedule-ui/header';
import { state as blankState, type AppState } from '../../../src/renderer/schedule-ui/state';

const meta: ModelMeta = {
  fileName: 'f.ifc', schema: 'IFC4', projectName: '', authoringTool: '',
  lengthUnit: 'mm', unitSystem: 'metric', elementCount: 0, parseMs: 0,
};
const DOORS: [string, string][] = [['D01', 'Level 1'], ['D01', 'Level 2'], ['D02', 'Level 1']];
const b = new StoreBuilder();
b.add(DOORS.map(([type, storey], i): ElemCore => ({
  entity: 'IfcDoor', name: `Door ${i}`, description: '', mark: String(i), typeName: type, family: 'F',
  objectType: '', predefinedType: 'DOOR', guid: `g${i}`, storey, storeyElevation: storey === 'Level 1' ? 0 : 3.5,
  building: '', site: '', space: '', material: '', discipline: 'ARC',
})), DOORS.map(() => ({})));
const store = b.finish(meta);

const TYPE = { kind: 'core', key: 'typeName' } as const;
const LEVEL = { kind: 'core', key: 'storey' } as const;
const def = (over: Partial<ScheduleDef>): ScheduleDef => ({
  ...emptySchedule('Doors', ['IfcDoor']), columns: [{ field: TYPE }, { field: LEVEL }], ...over,
});
const status = (d: ScheduleDef) => renderStatus({ ...blankState, store, def: d } as AppState,
  runSchedule(store, d), buildCoverage(store, ['IfcDoor'])).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const BY_LEVEL_TYPE: SortLevel[] = [{ field: LEVEL, dir: 'asc' }, { field: TYPE, dir: 'asc' }];

describe('the status line says how the rows combine', () => {
  it('itemise on and identical rows keep today’s exact texts', () => {
    expect(status(def({ sort: BY_LEVEL_TYPE }))).toContain('Every instance itemised');
    expect(status(def({ sort: BY_LEVEL_TYPE, itemize: true, combine: 'sort' }))).toContain('Every instance itemised');
    expect(status(def({ sort: BY_LEVEL_TYPE, itemize: false }))).toContain('Collapsed from 3 instances by 2 columns');
  });

  it('by sort value: the sort fields joined by " + ", or "into one row" with no sort level', () => {
    expect(status(def({ sort: BY_LEVEL_TYPE, itemize: false, combine: 'sort' }))).toContain('Collapsed from 3 instances by Level + Type');
    expect(status(def({ sort: [{ field: TYPE, dir: 'asc' }], itemize: false, combine: 'sort' }))).toContain('Collapsed from 3 instances by Type');
    expect(status(def({ sort: [], itemize: false, combine: 'sort' }))).toContain('Collapsed from 3 instances into one row');
  });

  it('one instance is singular', () => {
    const one = def({ sort: [], itemize: false, combine: 'sort', filters: [{ field: LEVEL, op: '=', value: 'Level 2' }] });
    expect(status(one)).toContain('Collapsed from 1 instance into one row');
  });
});

describe('portableSavedList keeps combine', () => {
  it('a saved setup combined by sort value crosses the port with the key', () => {
    const d = def({ sort: BY_LEVEL_TYPE, itemize: false, combine: 'sort' });
    const { saved, dropped } = portableSavedList([{ name: 'Doors', def: d, savedAt: '2026-11-24T00:00:00Z' }]);
    expect(dropped).toBe(0);
    expect(saved[0].def.combine).toBe('sort');
    expect(parseScheduleDef(readSavedList(saved)[0].def).combine).toBe('sort');
  });
});

describe('the compatibility corpus’s combined.schedule.json (current)', () => {
  const file = join(__dirname, '../../fixtures/compat/current/combined.schedule.json');
  const written = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  const opened = parseScheduleDef(written);

  it('opens with everything it was written with, combine kept beside itemize false, and is a fixed point', () => {
    expect(opened).toMatchObject(written);
    expect([opened.itemize, opened.combine, opened.sort.length > 0]).toEqual([false, 'sort', true]);
    expect(parseScheduleDef(JSON.parse(JSON.stringify(opened)))).toEqual(opened);
  });

  it('on a small made-up store it gives one data row per sort value', () => {
    const res = runSchedule(store, opened);
    const lines = res.rows.filter((r) => r.kind === 'data');
    const levels = new Set(DOORS.map(([, storey]) => storey));
    expect(lines).toHaveLength(levels.size);
    expect(lines.reduce((n, l) => n + (l.kind === 'data' ? l.count : 0), 0)).toBe(DOORS.length);
  });
});
