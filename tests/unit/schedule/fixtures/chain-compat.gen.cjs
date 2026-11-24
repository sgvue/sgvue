// Writes tests/unit/schedule/fixtures/chain-compat.json — what the Schedules engine AS IT WAS
// before chained formulas (commit e67e76e) works out for 70 seeded schedules that use only what
// that code supported, odd names included. `chain-compat.test.ts` holds the current engine to it.
//
// Run against a copy of the old source, never the working tree's:
//   mkdir -p <dir> && git archive e67e76e src | tar -x -C <dir>
//   node tests/unit/schedule/fixtures/chain-compat.gen.cjs <dir>/src tests/unit/schedule/fixtures/chain-compat.json
//
// Each case is labelled with what the 2026-11-24 spec says changes for it:
//   same                — every cell, value and problem as before;
//   chain               — a formula names another formula calculated value that no model column
//                         shadows: before "Unknown field", now it calculates;
//   percentage-message  — a formula names a percentage value: blank before and after, but the
//                         message is now "A percentage cannot be used in a formula: …".

const path = require('node:path');
const { writeFileSync } = require('node:fs');
const { createJiti } = require('jiti');

const [root, out] = process.argv.slice(2);
if (!root || !out) throw new Error('usage: chain-compat.gen.cjs <src-root> <out.json>');

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r, n) => Math.floor(r() * n);
const pick = (r, xs) => xs[int(r, xs.length)];
const shuffle = (r, xs) => { const o = xs.slice(); for (let i = o.length - 1; i > 0; i--) { const j = int(r, i + 1); [o[i], o[j]] = [o[j], o[i]]; } return o; };

const PROPS = [['P0', 'area'], ['P1', 'length'], ['P2', undefined], ['P3', 'length']];
const CATEGORIES = ['plain', 'model+calc', 'calc+calc', 'ambiguous', 'unknown', 'pct-ref', 'chain'];
const HEADINGS = ['Area', 'Height', 'Width', 'Clear Height', 'len_2', undefined];

function store(r) {
  const cores = [], cells = [];
  for (let i = 0; i < 10; i++) {
    cores.push({
      entity: 'IfcSpace', name: `S${i}`, description: '', mark: `M${i}`, typeName: pick(r, ['FD60', 'Plain']), family: 'F',
      objectType: '', predefinedType: '', guid: `g${i}`, storey: pick(r, ['L1', 'L2']), storeyElevation: 0,
      building: '', site: '', space: '', material: '', discipline: 'ARC',
    });
    const c = {};
    for (const [p, k] of PROPS) {
      if (r() < 0.2) continue;
      const v = Math.round((r() * 30 - 5) * 100) / 100;
      c[`Q.${p}`] = k ? { v, k } : { v };
    }
    cells.push(c);
  }
  return { cores, cells };
}

/** A formula over the given names, in the grammar the old code reads. */
function formula(r, names) {
  const n = () => { const h = pick(r, names); return /^[A-Za-z_]\w*$/.test(h) && r() < 0.5 ? h : `[${pick(r, [h, h.toLowerCase(), h.toUpperCase()])}]`; };
  return pick(r, [
    () => `${n()} * ${pick(r, [2, 1.1, 0.5])}`, () => `${n()} + ${n()}`, () => `round(${n()} / 3, 2)`,
    () => `if(${n()} > 5, ${n()}, 0)`, () => `max(${n()}, ${n()}) - 1`, () => `${n()} * ${n()}`,
  ])();
}

function makeCase(i) {
  const r = mulberry32(1000 + i);
  const category = CATEGORIES[i % CATEGORIES.length];
  const props = shuffle(r, PROPS).slice(0, 2 + int(r, 3));
  const used = new Set();
  const heads = props.map(() => { let h; do h = pick(r, HEADINGS); while (h && used.has(h.toLowerCase())); if (h) used.add(h.toLowerCase()); return h; });
  const columns = props.map(([p], j) => ({ field: { kind: 'prop', pset: 'Q', prop: p }, ...(heads[j] ? { heading: heads[j] } : {}) }));
  columns.unshift({ field: { kind: 'core', key: 'typeName' } });
  const shown = props.map(([p], j) => heads[j] ?? p);
  const calcs = [];
  const add = (name, f, more = {}) => { const id = `c${calcs.length + 1}`; calcs.push({ id, name, kind: 'formula', formula: f, ...more }); return id; };
  for (let k = 0, n = 1 + int(r, 3); k < n; k++) {
    const roll = r();
    if (roll < 0.15) add(`Fire ${k}`, `contains(Type, "FD")`, { result: 'yesNo' });
    else if (roll < 0.3) add(`Band ${k}`, `if(${formula(r, shown)} > 10, "Large", "Small")`, { result: 'text' });
    else add(pick(r, ['Calc', 'Net', 'x_', 'Höhe']) + k, formula(r, shown), r() < 0.3 ? { unitKind: 'area' } : {});
  }
  if (r() < 0.4) calcs.push({ id: `p${calcs.length + 1}`, name: 'Pct', kind: 'percentage', ofField: columns[1].field });

  const special = {};
  if (category === 'model+calc') {
    const h = pick(r, shown);
    add(pick(r, [h, h.toUpperCase(), ` ${h.toLowerCase()} `]), formula(r, shown));
    add('Uses shadowed', `[${h}] * 2`);
  }
  if (category === 'calc+calc') {
    add('Twin', formula(r, shown));
    add(' twin', formula(r, shown));
    add('Uses twin', 'Twin + 1');
  }
  if (category === 'ambiguous') {
    const [p] = pick(r, PROPS.filter(([x]) => !props.some(([y]) => y === x)).concat([['P0', 'area']]));
    columns.push({ field: { kind: 'prop', pset: 'Q', prop: p }, heading: shown[0] });
    add('Uses ambiguous', `[${shown[0]}] + 1`);
  }
  if (category === 'unknown') add('Uses nothing', 'Nowhere * 2');
  if (category === 'pct-ref') {
    calcs.push({ id: 'share', name: 'Share', kind: 'percentage', ofField: columns[1].field });
    special.refId = add('Uses share', 'Share * 2');
  }
  if (category === 'chain') {
    special.targetId = add('Base', formula(r, shown));
    special.refId = add('Uses base', 'Base * 3');
  }
  const calculated = shuffle(r, calcs);
  for (const c of calculated) if (r() < 0.8) columns.push({ field: { kind: 'formula', id: c.id }, format: { decimals: 3 }, ...(r() < 0.25 ? { hidden: true } : {}) });
  // The values the special cases are about are always shown, so their cells are pinned too.
  for (const id of [special.refId, special.targetId]) {
    if (!id) continue;
    const col = columns.find((c) => c.field.id === id);
    if (col) delete col.hidden;
    else columns.push({ field: { kind: 'formula', id }, format: { decimals: 3 } });
  }
  const def = {
    version: 1, name: `Compat ${i}`, entity: ['IfcSpace'], columns, calculated, filters: [], filterLogic: 'and',
    sort: [], itemize: true, grandTotal: false,
  };
  const expect = category === 'chain' ? 'chain' : category === 'pct-ref' ? 'percentage-message' : 'same';
  return { id: `compat-${i}-${category}`, category, expect, ...special, def };
}

(async () => {
  const jiti = createJiti(__filename);
  const load = (p) => jiti.import(path.resolve(root, p));
  const { StoreBuilder } = await load('schedule/ifc/store.ts');
  const { runSchedule } = await load('schedule/schedule/engine.ts');
  const { calcProblems, planComputed, withPercentages } = await load('schedule/schedule/computed.ts');

  const raw = store(mulberry32(7));
  const b = new StoreBuilder();
  b.add(raw.cores, raw.cells);
  const st = b.finish({
    fileName: 'compat.ifc', schema: 'IFC4', projectName: '', authoringTool: '', lengthUnit: 'mm',
    unitSystem: 'metric', elementCount: raw.cores.length, parseMs: 0,
  });
  const rows = raw.cores.map((_c, i) => i);
  const cases = Array.from({ length: 70 }, (_x, i) => makeCase(i)).map((c) => {
    const plan = withPercentages(planComputed(c.def), st, c.def, rows);
    const values = Object.fromEntries(c.def.calculated.map((x) => [x.id, rows.map((row) => plan.compute(st, row).get(`formula:${x.id}`)?.v ?? null)]));
    const res = runSchedule(st, c.def);
    return {
      ...c,
      visible: res.columns.map((x) => (x.field.kind === 'formula' ? x.field.id : null)),
      cells: res.rows.filter((x) => x.kind === 'data').map((x) => x.cells),
      problems: Object.fromEntries(calcProblems(st, c.def)),
      values,
    };
  });
  // One case a line, so a regenerated fixture reads as a diff.
  writeFileSync(out, `{"source":"e67e76e","store":${JSON.stringify(raw)},"cases":[\n${cases.map((c) => JSON.stringify(c)).join(',\n')}\n]}\n`);
  console.log(`wrote ${cases.length} cases to ${out}`);
})();
