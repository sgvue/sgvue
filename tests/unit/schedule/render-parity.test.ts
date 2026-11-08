// What the Schedules window DRAWS equals what the engine computed — v1.5.0, check 1 of the
// Schedules safety net. The golden master pins the engine's rows, the CSV and the workbook;
// nothing pinned the table the user actually reads. Here the real `renderSchedule`
// (schedule-ui/tableView.ts) writes its markup, `support/htmlTable.ts` reads it back the way
// a browser would lay it out, and every row is held against the `ScheduleResult` it came from:
//
//  · the headings are the visible columns' headings, in order, each carrying its def.columns
//    index (`data-defcol`) — a hidden column has no heading — then `Count` exactly when the
//    rows are collapsed, then the field picker's `+ Column`;
//  · one `<tr>` per engine row, in order (after the appearance's optional leading blank row):
//    a data row's cells are the engine's cell texts, verbatim, then its count; a group header
//    reads `label · count`; a footer or the grand total reads the engine's totals, its label in
//    the first cell when that column has no total of its own — and that row is the same text
//    the CSV export flattens it to (`toRows`), so the screen and the file cannot disagree;
//  · `data-row` is on data rows only, is the row's own index in `ScheduleResult.rows`, and the
//    elements behind the drawn rows are every matched element, each once (the federation
//    cases: through `rowIds` to a federation element with the same GlobalId);
//  · a cell a colour rule claims is painted with that rule's colours and nothing else, and the
//    painted cells per column are what the engine's `conditionalHits` counts;
//  · past `RENDER_CAP` rows the table stops drawing and SAYS so — a notice with both numbers —
//    while the grand total still counts every element.
//
// Cases: every golden case, the default schedule of every class of the committed reference
// model (the oracle's `reference.ifc`, parsed by web-ifc as the app parses it), and a seeded
// sweep of random definitions built from the golden cases by the simulation's own action
// generators (`support/sim.ts`) — `SIM_SEED=<n>` replays one seed.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { snapshotOf, type ScheduleSnapshot } from '../../../src/schedule/adapter';
import { toRows } from '../../../src/schedule/export/rows';
import { StoreBuilder, type ModelStore } from '../../../src/schedule/ifc/store';
import type { Cell, ElemCore, ModelMeta } from '../../../src/schedule/ifc/types';
import * as act from '../../../src/schedule/schedule/actions';
import { defaultColumnsFor } from '../../../src/schedule/schedule/columns';
import { firingRule } from '../../../src/schedule/schedule/conditional';
import { emptySchedule, type ScheduleDef } from '../../../src/schedule/schedule/def';
import { RENDER_CAP, runSchedule, type ScheduleResult } from '../../../src/schedule/schedule/engine';
import { federate, type Federation } from '../../../src/shared/federate';
import { mockModelIndex } from '../../../src/renderer/dev/mock-adapter';
import { buildCoverage, populated } from '../../../src/renderer/schedule-ui/coverage';
import { state as blankState, type AppState } from '../../../src/renderer/schedule-ui/state';
import { renderSchedule } from '../../../src/renderer/schedule-ui/tableView';
import { createReadOnlyIfcSource } from '../../../src/worker/ifc-source';
import { buildModelIndex } from '../../../src/worker/index-builder';
import { allCases, buildStores } from './support/fixture';
import { readTable, type HtmlRow } from './support/htmlTable';
import { GENS, mulberry32, type ActionName, type Ctx } from './support/sim';

const stores = buildStores();
const stateOf = (store: ModelStore, def: ScheduleDef): AppState =>
  ({ ...blankState, store, def, selected: new Set<number>(), removedBy: null, litBy: null, selectedCols: [] } as AppState);

/** Totals rows as the user reads them: the label in the first cell when that column shows no total. */
const totalsText = (r: { label: string; cells: (string | null)[] }) =>
  r.cells.map((c, i) => (i === 0 && (c === null || c === '') ? r.label : (c ?? '')));

/** The style a claimed cell is painted with, from the rule itself: `background`, `color`, bold. */
function paintOf(rule: { bg?: string; fg?: string; bold?: boolean } | undefined): string | undefined {
  if (!rule) return undefined;
  const bits = [rule.bg ? `background:${rule.bg}` : '', rule.fg ? `color:${rule.fg}` : '', rule.bold ? 'font-weight:700' : '']
    .filter(Boolean);
  return bits.length ? bits.join(';') : undefined;
}

export interface Tally { tables: number; rows: number; cells: number; truncated: number }

/**
 * Render `def` against `store` with the real renderer and hold every drawn row against the
 * engine's. Returns what it checked. `rowGuid` (federation cases) maps a store row to the
 * GlobalId of the federation element its `rowIds` entry names.
 */
function check(store: ModelStore, def: ScheduleDef, tally: Tally, what: string, rowGuid?: (r: number) => string | undefined): ScheduleResult {
  const res = runSchedule(store, def);
  const html = renderSchedule(stateOf(store, def), res, buildCoverage(store, def.entity));
  const t = readTable(html);
  const fail = (msg: string) => `${what}: ${msg}`;
  tally.tables++;

  if (!res.columns.length || !def.entity.length) {
    expect(t.empty, fail('no columns, but no empty note')).not.toBeNull();
    expect(t.body, fail('rows drawn with no columns')).toEqual([]);
    return res;
  }

  // ---- the headings ----
  const visible = def.columns.map((c, i) => (c.hidden ? -1 : i)).filter((i) => i >= 0);
  const heads = t.head.filter((h) => h.attrs['data-defcol'] !== undefined);
  // The badge is written as ` <span class="badge">0 values</span>`: its space is the badge's.
  for (const h of heads) if (h.badge !== null) expect(h.text.endsWith(' '), fail('badge separator')).toBe(true);
  expect(heads.map((h) => (h.badge === null ? h.text : h.text.slice(0, -1))), fail('headings')).toEqual(res.headings);
  // The badge is there exactly when coverage says no element of the category carries the field.
  const cov = buildCoverage(store, def.entity);
  expect(heads.map((h) => h.badge), fail('0 values badges'))
    .toEqual(res.columns.map((c) => (populated(cov, c.field) === 0 ? '0 values' : null)));
  expect(heads.map((h) => Number(h.attrs['data-defcol'])), fail('heading → def.columns index')).toEqual(visible);
  const rest = t.head.slice(heads.length).map((h) => h.text);
  expect(rest, fail('headings after the columns')).toEqual([...(res.countColumn ? ['Count'] : []), '+ Column']);
  // The headings come first, then the extras: nothing interleaved.
  expect(t.head.slice(0, heads.length), fail('heading order')).toEqual(heads);

  // ---- the rows ----
  const width = res.columns.length + (res.countColumn ? 1 : 0);
  let body: HtmlRow[] = t.body;
  if (def.appearance?.blankRowBeforeData) {
    expect(body[0]?.cls, fail('the leading blank row')).toBe('blank');
    body = body.slice(1);
  }
  expect(body.length, fail('row count')).toBe(res.rows.length);
  const elements: number[] = [];
  res.rows.forEach((r, i) => {
    const tr = body[i];
    const at = `row ${i} (${r.kind})`;
    tally.rows++;
    if (r.kind === 'data') {
      expect(tr.cls, fail(`${at}: class`)).toMatch(/^data hv-step( on)?$/);
      expect(tr.dataRow, fail(`${at}: data-row`)).toBe(i);
      expect(tr.cells.map((c) => c.text), fail(`${at}: cells`))
        .toEqual([...r.cells, ...(res.countColumn ? [r.count.toLocaleString()] : [])]);
      tally.cells += tr.cells.length;
      elements.push(...r.rows);
      // Colour rules: the cell the engine says a rule claims is painted with exactly it.
      res.columns.forEach((c, ci) => {
        const k = firingRule(c, r.cells[ci]);
        expect(tr.cells[ci].attrs.style, fail(`${at}: paint of column ${ci}`)).toBe(paintOf(k < 0 ? undefined : c.conditional![k]));
      });
      return;
    }
    expect(tr.dataRow, fail(`${at}: a ${r.kind} row selects nothing`)).toBeNull();
    if (r.kind === 'group') {
      expect(tr.cls, fail(`${at}: class`)).toBe(`group level-${r.level}`);
      expect(tr.cells.length).toBe(1);
      expect(tr.cells[0].attrs.colspan, fail(`${at}: span`)).toBe(String(width));
      expect(tr.cells[0].text, fail(`${at}: text`)).toBe(`${r.label} · ${r.count.toLocaleString()}`);
    } else if (r.kind === 'blank') {
      expect(tr.cls).toBe('blank');
      expect(tr.cells.map((c) => c.text)).toEqual(['']);
    } else {
      expect(tr.cls, fail(`${at}: class`)).toBe(r.kind === 'grand' ? 'grand' : `footer level-${r.level}`);
      const want = [...totalsText(r), ...(res.countColumn ? [r.count.toLocaleString()] : [])];
      expect(tr.cells.map((c) => c.text), fail(`${at}: totals`)).toEqual(want);
      tally.cells += tr.cells.length;
    }
  });

  // The export flattens the same result to the same text, row for row (header, group and the
  // count's own digit grouping aside): what is printed in a file is what was on screen.
  const csv = toRows(res).slice(1);
  res.rows.forEach((r, i) => {
    if (r.kind !== 'data' && r.kind !== 'footer' && r.kind !== 'grand') return;
    const screen = body[i].cells.slice(0, res.columns.length).map((c) => c.text);
    const file = csv[i].cells.slice(0, res.columns.length);
    expect(screen, fail(`row ${i} (${r.kind}): the screen and the export disagree`)).toEqual(file);
  });

  // ---- what the drawn rows stand for ----
  if (!res.truncated) {
    expect(elements.length, fail('each matched element once')).toBe(res.matchedElements);
    expect(new Set(elements).size).toBe(elements.length);
  }
  if (rowGuid) {
    for (const r of elements) expect(rowGuid(r), fail(`store row ${r} → federation element`)).toBe(store.cores[r].guid);
  }

  // ---- colour rules: painted cells per column = the engine's claim count ----
  for (const [di, { hits }] of Object.entries(res.conditionalHits ?? {})) {
    const col = def.columns[Number(di)];
    const vi = res.columns.indexOf(col);
    const painted = body.filter((tr) => tr.dataRow !== null && tr.cells[vi].attrs.style !== undefined).length;
    const paints = hits.reduce((n, h, k) => n + (paintOf(col.conditional![k]) ? h : 0), 0);
    if (!res.truncated) expect(painted, fail(`painted cells of column ${di}`)).toBe(paints);
  }

  // ---- the cap is stated, never silent ----
  const capNote = t.notices.find((n) => n.startsWith('Showing the first'));
  if (res.truncated) {
    tally.truncated++;
    expect(body.filter((r) => r.dataRow !== null).length, fail('rows drawn past the cap')).toBe(RENDER_CAP);
    expect(capNote, fail('a truncated table must say so')).toBe(
      `Showing the first ${RENDER_CAP.toLocaleString()} of ${res.totalDataRows.toLocaleString()} rows. `
      + 'Narrow the filters to see the rest — a printout always contains every row.');
  } else {
    expect(capNote, fail('a cap notice over a whole table')).toBeUndefined();
  }
  return res;
}

const newTally = (): Tally => ({ tables: 0, rows: 0, cells: 0, truncated: 0 });

describe('the drawn table is the engine result — golden cases', () => {
  const tally = newTally();
  const fed = federate(['ARC', 'STR', 'SIT', 'MEP'].map((k) => mockModelIndex(k)));
  const snap = snapshotOf(fed);
  const fedGuid = (r: number) => fed.byId.get(snap.rowIds[r])?.guid;
  for (const c of allCases()) {
    it(c.id, () => {
      check(stores[c.store], c.def, tally, c.id, c.store === 'federation' ? fedGuid : undefined);
    });
  }
  it('covered every row kind', () => {
    const kinds = new Set(allCases().flatMap((c) => runSchedule(stores[c.store], c.def).rows.map((r) => r.kind)));
    expect([...kinds].sort()).toEqual(['blank', 'data', 'footer', 'grand', 'group']);
    process.stderr.write(`[render parity] golden: ${tally.tables} tables, ${tally.rows} rows, ${tally.cells} cells\n`);
  });
});

describe('the drawn table is the engine result — the reference model', () => {
  it('every class\'s default schedule on reference.ifc', async () => {
    const bytes = readFileSync(join(__dirname, '..', '..', 'fixtures', 'reference.ifc'));
    const src = await createReadOnlyIfcSource();
    const modelID = src.openFromBuffer(new Uint8Array(bytes));
    const index = buildModelIndex(src, modelID, { modelKey: 'reference', fileName: 'reference.ifc', sha256: '' });
    src.close(modelID);
    src.dispose();
    const fed: Federation = federate([index]);
    const snap: ScheduleSnapshot = snapshotOf(fed, { reference: 'Reference model' });
    const b = new StoreBuilder();
    b.add(snap.cores, snap.cells);
    const store = b.finish(snap.meta);
    const guid = (r: number) => fed.byId.get(snap.rowIds[r])?.guid;
    const tally = newTally();
    for (const { entity } of store.entities) {
      const def: ScheduleDef = { ...emptySchedule(`${entity} Schedule`, [entity]), columns: defaultColumnsFor(store, [entity]) };
      check(store, def, tally, `reference ${entity}`, guid);
      // The same, grouped by level with totals on every column that has a number.
      let grouped = act.addSortLevel({ ...def, itemize: false, grandTotal: true });
      grouped = act.setSortField(grouped, 0, { kind: 'core', key: 'storey' });
      grouped = act.setGroupOptions(grouped, 0, { header: true, footer: 'titleCountTotals', blankLine: true });
      grouped.columns.forEach((_c, i) => { grouped = act.setTotal(grouped, i, i === 0 ? 'count' : 'countDistinct'); });
      check(store, grouped, tally, `reference ${entity} grouped`, guid);
    }
    expect(tally.tables).toBe(store.entities.length * 2);
    process.stderr.write(`[render parity] reference.ifc: ${tally.tables} tables, ${tally.rows} rows, ${tally.cells} cells\n`);
  }, 60_000);
});

describe('the cap: past RENDER_CAP rows the table stops and says so', () => {
  const meta: ModelMeta = {
    fileName: 'big.ifc', schema: 'IFC4', projectName: '', authoringTool: '',
    lengthUnit: 'mm', unitSystem: 'metric', elementCount: 0, parseMs: 0,
  };
  const N = RENDER_CAP + 137;
  const b = new StoreBuilder();
  const cores: ElemCore[] = [];
  const cells: Record<string, Cell>[] = [];
  for (let i = 0; i < N; i++) {
    cores.push({ entity: 'IfcDoor', name: `D${i}`, description: '', mark: String(i), typeName: `T${i % 7}`,
      family: 'F', objectType: '', predefinedType: '', guid: `G${i}`, storey: `L${i % 3}`, storeyElevation: i % 3,
      building: '', site: '', space: '', material: '', discipline: 'ARC' });
    cells.push({ 'Qto_DoorBaseQuantities.Width': { v: 0.8 + (i % 5) * 0.1, k: 'length' } });
  }
  b.add(cores, cells);
  const store = b.finish(meta);
  const base: ScheduleDef = {
    ...emptySchedule('Big', ['IfcDoor']),
    columns: [{ field: { kind: 'core', key: 'name' } }, { field: { kind: 'prop', pset: '*', prop: 'Width' }, total: 'sum' }],
    grandTotal: true,
  };

  it('itemised: 5 000 rows drawn, the notice names both numbers, the total counts every element', () => {
    const tally = newTally();
    const res = check(store, base, tally, 'cap itemised');
    expect(res.truncated).toBe(true);
    expect(res.totalDataRows).toBe(N);
    const grand = res.rows.at(-1)!;
    expect(grand.kind === 'grand' && grand.count).toBe(N);
    expect(tally.truncated).toBe(1);
  });

  it('grouped: footers and the grand total still cover the rows past the cap', () => {
    let def = act.addSortLevel(base);
    def = act.setSortField(def, 0, { kind: 'core', key: 'storey' });
    def = act.setGroupOptions(def, 0, { header: true, footer: 'titleCountTotals' });
    const tally = newTally();
    const res = check(store, def, tally, 'cap grouped');
    expect(res.truncated).toBe(true);
    const footers = res.rows.filter((r) => r.kind === 'footer');
    expect(footers.reduce((n, f) => n + f.count, 0)).toBe(N);
  });

  it('collapsed under the cap: no notice', () => {
    const tally = newTally();
    const res = check(store, { ...base, columns: [{ field: { kind: 'core', key: 'typeName' } }], itemize: false }, tally, 'cap collapsed');
    expect(res.truncated).toBe(false);
  });
});

describe('a blank first-column total gives its cell to the totals row\'s label, on screen as in the file', () => {
  // Found by the screen-vs-export comparison above (2026-11-08): a first column whose total
  // RENDERS blank (here `min` of a storey elevation that is 0, under `suppressZero`) left the
  // label off the screen while the export wrote it. Both now read `labelTakesFirstCell`.
  it('Level 1\'s footer and the grand total are labelled on screen and in the CSV', () => {
    const store = stores.metric;
    const def: ScheduleDef = {
      ...emptySchedule('Walls', ['IfcWall']),
      columns: [
        { field: { kind: 'core', key: 'storeyElevation' }, total: 'min', format: { suppressZero: true } },
        { field: { kind: 'core', key: 'name' } },
      ],
      sort: [{ field: { kind: 'core', key: 'storey' }, dir: 'asc', footer: 'titleCountTotals' }],
      grandTotal: true,
    };
    const res = runSchedule(store, def);
    const t = readTable(renderSchedule(stateOf(store, def), res, buildCoverage(store, def.entity)));
    const screen = t.body.filter((r) => r.cls.startsWith('footer') || r.cls === 'grand').map((r) => r.cells[0].text);
    const file = toRows(res).filter((r) => r.kind === 'footer' || r.kind === 'grand').map((r) => r.cells[0]);
    expect(file).toEqual(['Level 1: 2', '3,500', '31,500', 'Roof: 2', 'Grand total']);
    expect(screen).toEqual(file);
    check(store, def, newTally(), 'blank first total');
  });
});

// ---- a seeded sweep: random definitions the UI could reach, each one drawn and read back ----

const SEEDS = Number(process.env.RENDER_SEEDS ?? 120);
const STEPS = 12;
const ONLY = process.env.SIM_SEED === undefined ? undefined : Number(process.env.SIM_SEED);
const NAMES = Object.keys(GENS) as ActionName[];

describe('the drawn table is the engine result — seeded definitions', () => {
  const cases = allCases();
  const ctxs: Record<string, Ctx> = {
    metric: { store: stores.metric, system: 'metric' },
    imperial: { store: stores.imperial, system: 'imperial' },
    federation: { store: stores.federation, system: 'metric' },
  };
  const seeds = ONLY !== undefined ? [ONLY] : Array.from({ length: SEEDS }, (_, i) => i + 1);
  it(`${seeds.length} seed(s) × ${STEPS} actions, every step drawn and checked`, () => {
    const tally = newTally();
    for (const seed of seeds) {
      const r = mulberry32(seed * 7919);
      const start = cases[Math.floor(r() * cases.length)];
      const ctx = ctxs[start.store];
      let def = structuredClone(start.def);
      const log: string[] = [];
      try {
        for (let s = 0; s < STEPS; s++) {
          const offered = NAMES.map((n) => [n, GENS[n](def, r, ctx)] as const).filter(([, a]) => a !== null);
          const [name, args] = offered[Math.floor(r() * offered.length)] as [ActionName, unknown[]];
          log.push(name);
          def = (act[name] as (d: ScheduleDef, ...a: unknown[]) => ScheduleDef)(def, ...args);
          check(ctx.store, def, tally, `seed ${seed} step ${s}`);
        }
      } catch (e) {
        throw new Error(`SIM_SEED=${seed} (start ${start.id}) after ${JSON.stringify(log)}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    process.stderr.write(`[render parity] seeded: ${tally.tables} tables, ${tally.rows} rows, ${tally.cells} cells\n`);
  }, 120_000);
});
