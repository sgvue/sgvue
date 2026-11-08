// Reachability tripwire: every key and sub-key of the saved ScheduleDef must be WRITTEN by
// at least one action in schedule/actions.ts. The key list is read from def.ts's own
// interfaces, so a key added to the schema joins the list by itself; the writes are
// observed by running each action on a rich definition and diffing what changed. A UI
// rewrite that drops the action behind a setting fails here, by name.
//
// Second tripwire: every action must be CALLED from src/ui (or main.ts, the composition
// root). An action nobody calls is a setting the redesign dropped from the screen.
//
// Proven to fail: removing `bold` from the updateConditionalRule sample below (so no action
// is seen writing it) fails with "columns[].conditional[].bold" uncovered.
//
// Ported from ifcTable's `tests/reachability.test.ts` (Yong Yen) for SGVue v1.5.0, phase 1.
// The second tripwire is SKIPPED until phase 2: the Schedules window's handlers
// (`renderer/schedule-ui/events.ts`) still edit the definition in place, and phase 2 rebuilds
// them on these actions. Unskip it then — it is already pointed at SGVue's UI.

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as act from '../../../src/schedule/schedule/actions';
import type { ScheduleDef } from '../../../src/schedule/schedule/def';
import { allCases } from './support/fixture';
import { HELPERS } from './support/sim';

/** Not settable by any edit, on purpose — each with the reason. */
const NOT_EDITS: Record<string, string> = {
  version: 'frozen constant (SCHEDULE_VERSION)',
  entity: 'chosen by a wholesale replacement (category / template / load), not an edit',
  meta: 'provenance written by scheduleFromPreset; not user-editable today',
  'meta.corpusVersion': 'provenance; not user-editable today',
  'meta.notes': 'provenance written by scheduleFromPreset; not user-editable today',
  // setColumnFormat CAN write these, but no control in the UI sends them; the sample below
  // mirrors what the UI sends, so they are listed rather than claimed as reachable.
  'columns[].format.prefix': 'no control today (only presets/imports carry it)',
  'columns[].format.suffix': 'no control today (only presets/imports carry it)',
};

/** Every key path in def.ts's ScheduleDef, recursing into the interfaces it names. */
function schemaKeys(): string[] {
  const src = readFileSync(new URL('../../../src/schedule/schedule/def.ts', import.meta.url), 'utf8');
  const ifaces = new Map<string, [string, string][]>();
  for (const m of src.matchAll(/export interface (\w+)[^{]*\{([\s\S]*?)\n\}/g)) {
    const props = [...m[2].matchAll(/^ {2}(\w+)\??:\s*(.+?);?$/gm)].map((p) => [p[1], p[2]] as [string, string]);
    ifaces.set(m[1], props);
  }
  const out: string[] = [];
  const walk = (name: string, prefix: string) => {
    for (const [key, type] of ifaces.get(name) ?? []) {
      const path = prefix + key;
      out.push(path);
      const inline = /^\{(.*)\}$/.exec(type.trim());
      if (inline) for (const k of inline[1].matchAll(/(\w+)\??:/g)) out.push(`${path}.${k[1]}`);
      const base = type.replace(/\[\]$/, '');
      if (ifaces.has(base)) walk(base, `${path}${type.endsWith('[]') ? '[]' : ''}.`);
    }
  };
  walk('ScheduleDef', '');
  return out;
}

const norm = (path: string) => path.replace(/\.\d+/g, '[]').replace(/^\./, '');

/** Paths (indices folded to []) where `b` differs from `a`, plus every leaf of anything new. */
function changed(a: unknown, b: unknown, path = ''): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  const leaves = (v: unknown, p: string): string[] => (v && typeof v === 'object'
    ? [p, ...Object.entries(v).flatMap(([k, x]) => leaves(x, `${p}.${k}`))] : [p]);
  if (Array.isArray(a) && Array.isArray(b)) {
    // A reorder writes only the order, not the contents of what moved.
    const sorted = (xs: unknown[]) => xs.map((x) => JSON.stringify(x)).sort().join('\u0000');
    if (a.length === b.length && sorted(a) === sorted(b)) return [path];
    if (a.length === b.length) return a.flatMap((x, i) => changed(x, b[i], `${path}.${i}`));
    const old = new Set(a.map((x) => JSON.stringify(x)));
    return [path, ...b.filter((x) => !old.has(JSON.stringify(x))).flatMap((x, i) => leaves(x, `${path}.${i}`))];
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) => changed((a as never)[k], (b as never)[k], `${path}.${k}`));
  }
  return b && typeof b === 'object' ? leaves(b, path) : [path];
}

/** A definition with something in every list, and a legacy yes/no flag to clear. */
function rich(): ScheduleDef {
  const d = structuredClone(allCases().find((c) => c.id === 'hand-kitchen-sink')!.def);
  d.calculated!.push({ id: 'old', name: 'Legacy', kind: 'formula', formula: 'W > 1', yesNo: true });
  d.filters.push({ field: { kind: 'core', key: 'storey' }, op: 'between', values: [1, 2] });
  d.sort.splice(2, 1); // the kitchen sink sits at the 4-level cap; leave addSortLevel room
  return d;
}

const W = { kind: 'prop', pset: '*', prop: 'Width' } as const;

/** One call per action, chosen to write everything that action can write. */
const SAMPLES: Record<string, unknown[]> = {
  addColumns: [[{ field: { kind: 'core', key: 'guid' } }]],
  removeColumn: [0],
  moveColumn: [0, 2],
  remapColumn: [1, W],
  setHeading: [0, 'Renamed'],
  setHeadingOrientation: [0, 'horizontal'],
  setAlign: [0, 'right'],
  setColumnFormat: [0, {
    display: 'm', decimals: 4, thousands: false, showSymbol: true, suppressZero: true,
    boolStyle: 'Y/N',
  }],
  setTotal: [0, 'sum'],
  setHidden: [0, true],
  setWidths: [[[1, 140]]],
  addConditionalRule: [0],
  removeConditionalRule: [2, 0],
  updateConditionalRule: [2, 0, { op: '!=', value: 'x', bg: '#000000', fg: '#ffffff', bold: false }],
  addFilterRule: [],
  removeFilterRule: [0],
  setFilterMode: ['and'],
  setFilterField: [0, { kind: 'core', key: 'mark' }],
  setFilterOp: [1, 'in'],
  setFilterValue: [1, 2.5],
  setFilterRange: [3, 1, 9],
  setFilterValues: [3, ['a', 'b']],
  addSortLevel: [],
  removeSortLevel: [0],
  moveSortLevel: [0, 1],
  setSortField: [0, W],
  setSortDir: [0, 'desc'],
  setGroupOptions: [2, { header: true, footer: 'count', blankLine: true }],
  setItemize: [true],
  setGrandTotal: [false],
  setGrandTotalTitle: ['Everything'],
  setAppearance: [{
    title: 'T', showTitle: true, gridLines: true, outline: true, blankRowBeforeData: false,
    zebra: true, fontSize: 20, headerBold: true, bodyFont: 'plex',
  }],
  setName: ['Renamed'],
  addCalculated: ['formula'],
  removeCalculated: ['c1'],
  updateCalculated: ['p1', { name: 'N', formula: 'W * 3', ofField: { kind: 'core', key: 'mark' } }],
  setCalculatedResult: ['old', 'length'],
  setCalculatedUnitKind: ['c2', 'volume'],
};

const ACTIONS = Object.keys(act).filter((k) => !HELPERS.includes(k));
const call = (name: string, d: ScheduleDef) =>
  (act[name as keyof typeof act] as unknown as (d: ScheduleDef, ...a: unknown[]) => ScheduleDef)(d, ...structuredClone(SAMPLES[name]));

describe('every ScheduleDef setting is written by at least one action', () => {
  it('reads a plausible key list from def.ts', () => {
    const keys = schemaKeys();
    // Spot checks that the parser found the nested interfaces, not just the top level.
    for (const k of ['columns[].format.decimals', 'columns[].conditional[].bold', 'filters[].values',
      'sort[].footer', 'appearance.bodyFont', 'calculated[].ofField', 'meta.notes']) expect(keys).toContain(k);
  });

  it('has one sample per exported action, and each sample changes the definition', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...ACTIONS].sort());
    for (const name of ACTIONS) {
      const d = rich();
      expect(changed(d, call(name, d)).length, `${name} sample changed nothing`).toBeGreaterThan(0);
    }
  });

  it('covers every key except the documented non-edits', () => {
    const written = new Set<string>();
    for (const name of ACTIONS) {
      const d = rich();
      for (const p of changed(d, call(name, d))) {
        // A write to a.b.c is also a write under a.b and a.
        const parts = norm(p).split('.');
        for (let i = 1; i <= parts.length; i++) {
          const prefix = parts.slice(0, i).join('.');
          written.add(prefix).add(prefix.replace(/\[\]$/, ''));
        }
      }
    }
    const missing = schemaKeys().filter((k) => !written.has(k) && !(k in NOT_EDITS));
    expect(missing, 'settings no action writes').toEqual([]);
    // And the exemptions must stay true: if an action starts writing one, say so here.
    expect(Object.keys(NOT_EDITS).filter((k) => written.has(k))).toEqual([]);
  });

  // Phase 2: unskip. Every action must be CALLED from the Schedules window's UI
  // (`src/renderer/schedule-ui/`, its `main.ts` the composition root). Today none is.
  it.skip('every action is called from src/renderer/schedule-ui', () => {
    const files = (dir: URL): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      (e.isDirectory() ? files(new URL(`${e.name}/`, dir)) : e.name.endsWith('.ts') ? [readFileSync(new URL(e.name, dir), 'utf8')] : []));
    const ui = files(new URL('../../../src/renderer/schedule-ui/', import.meta.url))
      .filter((src) => /from '[./\w]*schedule\/actions'/.test(src))
      .join('\n');
    const uncalled = ACTIONS.filter((name) => !new RegExp(`\\b(act\\.)?${name}\\(`).test(ui));
    expect(uncalled, 'actions no UI code calls').toEqual([]);
  });
});
