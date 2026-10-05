/**
 * Dev utility — NOT application code. The assistant's own audit run.
 *
 *   VITE_SGVUE_DEVTOOLS=1 npm run build
 *   SGVUE_IFC="samples/Sample Ifc Model.ifc" node scripts/safe-run.cjs ai-audit.cjs
 *   SGVUE_IFC=mock                           node scripts/safe-run.cjs ai-audit.cjs
 *
 * It answers, on a **real** IFC model, the questions a reviewer of the AI assistant has to
 * settle with numbers rather than with reading:
 *
 *   `tools`    every one of the 25 tools, at least three inputs each — a realistic one, a
 *              no-match, a very large match, a malformed input, odd characters, and property
 *              keys discovered from the file itself. Per call: ok/error, latency, result bytes
 *              and approximate tokens, whether it truncates and says so, whether an empty
 *              result names the valid values, and whether units and frame are stated.
 *   `view`     the eleven view tools through the store, with the panel's half of the outcome
 *              (chips, table, pending patch) that `forModel` alone cannot show, and a
 *              before/after reading of the view they changed.
 *   `guard`    the 5 % scope guard on a 26 761-element federation: the pending patch, the
 *              designed Apply and Cancel, and the per-turn ↺.
 *   `flows`    eight review workflows walked end to end as scripted tool sequences.
 *   `payload`  what one turn costs on the wire: the tools block, the static contract, the
 *              cached schema block and the per-turn view-state message, in bytes and
 *              approximate tokens, plus whether the cached prefix is byte-stable across turns.
 *   `sql`      the model database — row counts per table, the six workflow queries with
 *              timings, how a 201-row cut is reported, and the ten-second timeout path.
 *   `gaps`     index fields that a real file leaves empty.
 *
 * `SGVUE_ONLY=tools,sql` runs named blocks only. `SGVUE_AUDIT_JSON=<path>` writes the whole
 * reading as one JSON file; it defaults to the system temp directory, **never** into the
 * repository, because everything here is computed from a real project model.
 *
 * Read-only throughout. Every tool it runs is one of the catalogue's 25, the SQL worker is
 * `PRAGMA query_only`, and the view tools go through the same store actions a button calls —
 * which is the point: this measures the app, not a copy of it.
 *
 * WebGL2 only and guarded, like every Electron script here. The wall clock is raised because
 * a 144 MB parse plus ~120 tool calls does not fit in 25 s; the memory limits are the guard's
 * own defaults.
 */
const { app, BrowserWindow, protocol, net } = require('electron')
const { writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { basename, join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { installGuard } = require('./lib/electron-guard.cjs')
const { resolveBackend } = require('./lib/backend.cjs')

const ROOT = join(__dirname, '..')
const MOCK = process.env.SGVUE_IFC === 'mock'
const MODEL = resolve(ROOT, process.env.SGVUE_IFC || 'samples/Sample Ifc Model.ifc')
const OUT_JSON = process.env.SGVUE_AUDIT_JSON || join(tmpdir(), 'sgvue-ai-audit.json')
const SIZE = (process.env.SGVUE_SIZE || '1440x860').split('x').map(Number)
const { hash: HASH } = resolveBackend(MOCK ? 'mock' : '')
const ONLY = (process.env.SGVUE_ONLY || '').split(',').filter(Boolean)
const wants = (block) => !ONLY.length || ONLY.includes(block)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const guard = installGuard({ label: `ai-audit ${MOCK ? 'mock' : basename(MODEL)}`, maxSeconds: 900 })

// The renderer is loaded from `file://` and Chromium refuses to fetch a custom scheme from it
// unless the scheme is CORS-enabled — the request never reaches the handler (2026-09-16).
app.enableSandbox()
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'sgvue-file',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  }
])

/* ══════════════════════════ the in-page toolkit ══════════════════════════ */

/**
 * Shared by every block below. `call` is the measurement: it runs one tool through the app's
 * own executor and records everything the audit asks for about the answer — never the answer
 * itself beyond a short preview, because a tool result on a real model can be megabytes.
 */
const KIT = `
  const D = window.__sgvueDev;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const enc = new TextEncoder();
  const json = (v) => JSON.stringify(v === undefined ? null : v);
  const size = (v) => { const s = json(v); return { bytes: enc.encode(s).length, tokens: Math.round(s.length / 4) }; };
  /** Does the result say, anywhere in it, that it was cut short? */
  const truncFlags = (o) => {
    const out = [];
    const walk = (v, path) => {
      if (!v || typeof v !== 'object') return;
      for (const [k, x] of Object.entries(v)) {
        if (/^(truncated|capped|more)$/.test(k) && x) out.push((path ? path + '.' : '') + k + '=' + x);
        if (/^(total|totalGroups|matched|candidates|rowCount)$/.test(k) && typeof x === 'number')
          out.push((path ? path + '.' : '') + k + '=' + x);
        if (x && typeof x === 'object' && !Array.isArray(x)) walk(x, (path ? path + '.' : '') + k);
      }
    };
    walk(o, '');
    return out;
  };
  const call = async (name, input, note) => {
    const t0 = performance.now();
    let ok = true, out = null, err = null;
    try { out = await D.tool(name, input); }
    catch (e) { ok = false; err = (e && e.message) ? e.message : String(e); }
    const ms = +(performance.now() - t0).toFixed(1);
    const body = ok ? out : { error: err };
    const s = size(body);
    const text = json(body);
    return {
      name, note, input: json(input).slice(0, 220), ok, ms,
      bytes: s.bytes, tokens: s.tokens,
      truncation: truncFlags(body),
      validValues: !!(body && typeof body === 'object' && 'valid_values' in body),
      message: (body && typeof body === 'object' && typeof body.message === 'string')
        ? body.message.slice(0, 300) : null,
      // Units and frame, said in structure rather than only in prose.
      statesUnits: /Metres|MetresM|M3|m²|m³|metres|Millimet|measure|units/i.test(text),
      statesFrame: /"frame"|bboxFrame|project frame/.test(text),
      statesMethod: /"method"|boxMethod|solidCountMethod/.test(text),
      keys: (body && typeof body === 'object' && !Array.isArray(body)) ? Object.keys(body).slice(0, 24) : null,
      preview: text.slice(0, 400)
    };
  };
  /** The same, with the panel's half of the outcome — chips, table, pending patch. */
  const callUi = async (name, input, note) => {
    const t0 = performance.now();
    let ok = true, out = null, err = null;
    try { out = await D.toolUi(name, input); }
    catch (e) { ok = false; err = (e && e.message) ? e.message : String(e); }
    const ms = +(performance.now() - t0).toFixed(1);
    if (!ok) return { name, note, ok, ms, error: err };
    const ui = out.ui;
    const s = size(out.forModel);
    return {
      name, note, ok, ms, bytes: s.bytes, tokens: s.tokens,
      message: (out.forModel && typeof out.forModel.message === 'string')
        ? out.forModel.message.slice(0, 260) : null,
      chips: ui.chips.map((c) => ({ label: c.label, ids: c.ids.length })),
      chipIdsTotal: ui.chips.reduce((a, c) => a + c.ids.length, 0),
      table: ui.table ? { groupBy: ui.table.groupBy, rows: ui.table.rows.length,
        idsTotal: ui.table.rows.reduce((a, r) => a + r.ids.length, 0),
        head: ui.table.rows.slice(0, 3).map((r) => r.k + ' ' + r.n +
          (r.area ? ' area=' + r.area.toFixed(1) : '') + (r.volume ? ' vol=' + r.volume.toFixed(1) : '')) } : null,
      pending: ui.pending ? { label: ui.pending.label, patchKeys: Object.keys(ui.pending.patch) } : null,
      acted: ui.acted, filtered: ui.filtered,
      preview: json(out.forModel).slice(0, 320)
    };
  };
  /** What the view actually looks like, read from the store through the same selectors. */
  const viewNow = () => {
    const v = D.debug();
    const f = D.federation();
    const st = D.chat.payloads().viewState;
    return { visible: st.visibleElements, total: st.totalElements,
      stack: st.filterStack.map((x) => x.step + ':' + x.action + (x.enabled ? '' : '(off)')).join(' '),
      storeysShown: st.storeysShown.length, of: f.storeys.length,
      active: st.activeModel, view: st.view, projection: st.projection,
      section: st.section, selected: st.selectedCount,
      colorBy: D.scheme() ? D.scheme().prop + ' x' + D.scheme().groups.length : null,
      drawnVisible: v.visible };
  };
`

/* ══════════════════════════ 0. what the file actually carries ══════════════════════════ */

/**
 * Nothing in this harness is named in advance. Every entity, storey, property key and element
 * id it uses is discovered here, from the file itself — which is the only way a run on another
 * model means anything.
 */
const DISCOVER = `(async () => {
  ${KIT}
  const f = D.federation();
  const els = f.elements;
  const count = (of) => { const m = new Map(); for (const e of els) { const v = of(e); if (v) m.set(v, (m.get(v) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const entities = count((e) => e.type);
  const predef = count((e) => e.predefinedType);
  const storeyCounts = count((e) => e.storey);
  // Property-set keys, by how many elements carry them, split by the IFC-SG / standard prefix.
  const keySpread = new Map();
  const setNames = new Map();
  for (const e of els) {
    const seen = new Set();
    for (const bag of [e.psets, e.qto]) for (const [setName, p] of Object.entries(bag)) {
      setNames.set(setName, (setNames.get(setName) || 0) + 1);
      for (const k of Object.keys(p)) if (!seen.has(k)) { seen.add(k); keySpread.set(k, (keySpread.get(k) || 0) + 1); }
    }
  }
  const keys = [...keySpread.entries()].sort((a, b) => b[1] - a[1]);
  const sets = [...setNames.entries()].sort((a, b) => b[1] - a[1]);
  const startsWith = (p) => keys.filter(([k]) => k.toLowerCase().startsWith(p)).slice(0, 12);
  // One element per interesting shape, so the tool matrix has real subjects.
  const withGeom = els.find((e) => e.bbox);
  const withoutGeom = els.find((e) => !e.bbox);
  const richest = els.reduce((best, e) => {
    const n = Object.keys(e.psets).length + Object.keys(e.qto).length;
    return !best || n > best.n ? { e, n } : best; }, null);
  const byZ = els.filter((e) => e.bbox).sort((a, b) => a.bbox[2] - b.bbox[2]);
  // A name with a character outside plain ASCII, if this file has one.
  const odd = els.find((e) => /[^\\x20-\\x7E]/.test(e.name));
  return JSON.stringify({
    models: f.files.map((x) => x.key), loaded: D.federation().models.map((m) => m.meta.modelKey),
    elements: els.length, storeys: f.storeys.length, grids: f.grids.length,
    propKeys: f.propKeys.length,
    entityTop: entities.slice(0, 14), entityCount: entities.length,
    predefTop: predef.slice(0, 8), predefCount: predef.length,
    storeyTop: storeyCounts.slice(0, 6),
    storeyNames: f.storeys.map((s) => s.name),
    gridNames: f.grids.map((g) => g.name),
    psetNames: sets.slice(0, 14), psetSetCount: sets.length,
    keyTop: keys.slice(0, 20), keyCount: keys.length,
    sgKeys: startsWith('sgpset') .concat(keys.filter(([k]) => /^sg/i.test(k)).slice(0, 10)),
    psetPrefixed: keys.filter(([k]) => /fire|rating|combust|material|area|volume|width|height|length/i.test(k)).slice(0, 16),
    setPrefixes: [...new Set(sets.map(([n]) => (n.match(/^[A-Za-z]+_/) || [n])[0]))].slice(0, 12),
    subjects: {
      withGeom: withGeom ? { id: withGeom.id, type: withGeom.type, expressId: withGeom.expressId, guid: withGeom.guid, model: withGeom.model } : null,
      withoutGeom: withoutGeom ? { id: withoutGeom.id, type: withoutGeom.type, expressId: withoutGeom.expressId, guid: withoutGeom.guid } : null,
      richest: richest ? { id: richest.e.id, type: richest.e.type, guid: richest.e.guid, sets: richest.n } : null,
      lowest: byZ.length ? byZ[0].id : null, highest: byZ.length ? byZ[byZ.length - 1].id : null,
      oddName: odd ? { id: odd.id, sample: odd.name.slice(0, 40) } : null
    },
    withBox: els.filter((e) => e.bbox).length,
    withSolidCount: els.filter((e) => e.solidCount !== undefined).length
  });
})()`

/* ══════════════════════════ 1. every tool, on the real model ══════════════════════════ */

const TOOLS = (matrix) => `(async () => {
  ${KIT}
  const MATRIX = ${JSON.stringify(matrix)};
  const out = [];
  for (const c of MATRIX) out.push(await call(c.name, c.input, c.note));
  return JSON.stringify(out);
})()`

/* ══════════════════════════ 2. the view tools, through the store ══════════════════════════ */

const VIEW = (v) => `(async () => {
  ${KIT}
  const V = ${JSON.stringify(v)};
  const steps = [];
  const run = async (name, input, note) => {
    const before = viewNow();
    const r = await callUi(name, input, note);
    await sleep(140);
    steps.push({ ...r, before, after: viewNow() });
    return r;
  };

  // A clean start: nothing hidden, nothing filtered, nothing selected.
  await run('apply_visibility', { action: 'reset' }, 'reset to a clean view');

  await run('set_filter_stack', { steps: [{ action: 'isolate', rules: [{ prop: 'Level', op: '=', val: V.busiestStorey }] }] }, 'isolate the busiest storey');
  await run('set_filter_stack', { steps: [{ action: 'highlight', rules: [{ prop: 'IfcEntity', op: '=', val: V.topEntity }] }], combine: 'append' }, 'append a highlight step');
  await run('manage_filters', { op: 'list' }, 'list the stack');
  await run('manage_filters', { op: 'disable', step: 1 }, 'disable step 1');
  await run('manage_filters', { op: 'enable', step: 1 }, 're-enable step 1');
  await run('manage_filters', { op: 'move', step: 2, to: 1 }, 'move step 2 to 1');
  await run('manage_filters', { op: 'remove', step: 1 }, 'remove step 1');
  await run('manage_filters', { op: 'clear' }, 'clear the stack');

  await run('apply_visibility', { rules: [{ prop: 'IfcEntity', op: '=', val: V.topEntity }], action: 'isolate' }, 'isolate one entity');
  await run('apply_visibility', { rules: [{ prop: 'IfcEntity', op: '=', val: V.secondEntity }], action: 'isolate', combine: 'append' }, 'append a second isolate (the "also" path)');
  await run('apply_visibility', { rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcTeleporter' }], action: 'isolate' }, 'no-match — nothing may change');
  await run('apply_visibility', { action: 'reset' }, 'reset');

  await run('select_elements', { rules: [{ prop: 'IfcEntity', op: '=', val: V.topEntity }], zoom: false }, 'select every ' + V.topEntity);
  await run('select_elements', { rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcTeleporter' }] }, 'select nothing');

  await run('set_storeys', { visible: V.twoStoreys }, 'show two storeys');
  await run('set_storeys', { visible: ['NoSuchStorey'] }, 'unknown storey');
  await run('set_storeys', { visible: [] }, 'all storeys again');

  await run('set_view', { view: 'top', projection: 'ortho' }, 'plan, orthographic');
  await sleep(900);
  await run('set_view', { view: 'iso', projection: 'persp' }, 'back to the default 3D');
  await sleep(900);

  await run('toggle_display', { grids: true, levels: true, shadows: false, dims: true }, 'four switches at once');
  await run('toggle_display', { grids: true }, 'a switch already in that state');
  await run('toggle_display', { grids: false, levels: false, shadows: true, dims: false }, 'back');

  if (V.grid) { await run('set_section', { kind: 'grid', name: V.grid }, 'section along a gridline'); await sleep(700); }
  await run('set_section', { kind: 'level', name: V.busiestStorey, offset: 1200 }, 'section at a level, 1200 mm up');
  await sleep(700);
  await run('set_section', { kind: 'grid', name: 'ZZ' }, 'unknown gridline');
  await run('set_section', { kind: null }, 'clear the section');
  await sleep(500);

  await run('color_by_property', { property: 'IfcEntity' }, 'colour by entity');
  await sleep(500);
  if (V.psetKey) { await run('color_by_property', { property: V.psetKey }, 'colour by the file\\'s widest pset key'); await sleep(500); }
  await run('color_by_property', { property: 'NoSuchPropertyZZ' }, 'colour by a key nothing carries');
  await run('color_by_property', { property: null }, 'clear the scheme');

  await run('color_models', { map: { [V.model]: '#35C4B6' } }, 'tint one model');
  await run('color_models', { map: { [V.model]: 'teal' } }, 'a colour that is not hex');
  await run('color_models', { map: { NoSuchModel: '#fff' } }, 'a model that is not loaded');
  await run('color_models', { map: {} }, 'clear the overrides');

  await run('activate_model', { key: V.model }, 'activate the model');
  await run('activate_model', { key: 'NoSuchModel' }, 'activate one that is not loaded');
  await run('activate_model', { key: null }, 'leave activate mode');

  return JSON.stringify(steps);
})()`

/* ══════════════════════════ 3. the 5 % scope guard, end to end ══════════════════════════ */

/**
 * The guard is the one place the assistant is held back, and the only way to see it work is to
 * ask for something narrow on a big federation. All three designed outcomes are exercised: the
 * outright refusal (nothing left visible), the pending patch with Apply, and the pending patch
 * with Cancel — then the per-turn ↺ on the applied one.
 */
const GUARD = (v) => `(async () => {
  ${KIT}
  const V = ${JSON.stringify(v)};
  const out = {};
  await D.tool('apply_visibility', { action: 'reset' });
  await D.chat.reset();
  await sleep(200);

  /* 1. A stack that leaves nothing visible — refused outright, no pending entry. */
  out.refused = await callUi('set_filter_stack', { steps: [
    { action: 'isolate', rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcTeleporter' }] }] }, 'leaves nothing visible');
  out.refusedView = viewNow();

  /* 2. Under 5 % — held back as a pending patch, then APPLIED through the designed button. */
  const t1 = await D.chat.turn('isolate the rare entity', [
    { name: 'set_filter_stack', input: { steps: [
      { action: 'isolate', rules: [{ prop: 'IfcEntity', op: '=', val: V.rareEntity }] }] } }]);
  const msgs1 = D.chat.messages();
  const m1 = msgs1[t1.index];
  out.pending = { index: t1.index, label: m1.pending ? m1.pending.label : null,
    patchKeys: m1.pending ? Object.keys(m1.pending.patch) : null,
    forModel: json(t1.results[0].forModel).slice(0, 320),
    viewBeforeApply: viewNow() };
  const t0 = performance.now();
  D.chat.apply(t1.index);
  await sleep(600);
  out.applied = { ms: +(performance.now() - t0).toFixed(1), view: viewNow(),
    pendingCleared: D.chat.messages()[t1.index].pending === null,
    undoSnapTaken: !!D.chat.messages()[t1.index].undoSnap };

  /* …and ↺ on that same message, which is the per-turn revert. */
  D.chat.revert(t1.index);
  await sleep(600);
  out.reverted = { view: viewNow(), flagged: !!D.chat.messages()[t1.index].reverted };

  /* 3. The same shape, CANCELLED. */
  const t2 = await D.chat.turn('isolate it again', [
    { name: 'set_filter_stack', input: { steps: [
      { action: 'isolate', rules: [{ prop: 'IfcEntity', op: '=', val: V.rareEntity }] }] } }]);
  const before = viewNow();
  D.chat.dismiss(t2.index);
  await sleep(400);
  out.cancelled = { before, after: viewNow(), pendingCleared: D.chat.messages()[t2.index].pending === null };

  /* 4. highlight is exempt: it changes no element's visibility, so it never pends. */
  out.highlightExempt = await callUi('apply_visibility', { rules: [
    { prop: 'IfcEntity', op: '=', val: V.rareEntity }], action: 'highlight' }, 'highlight the same rare entity');

  /* 5. A turn that changes the view gets an undo snapshot; a read-only turn does not. */
  const t3 = await D.chat.turn('how many are there?', [
    { name: 'query_elements', input: { rules: [{ prop: 'IfcEntity', op: '=', val: V.topEntity }] } }]);
  out.readOnlyTurn = { undoSnap: !!D.chat.messages()[t3.index].undoSnap,
    chips: (D.chat.messages()[t3.index].chips || []).map((c) => ({ label: c.label, ids: c.ids.length })) };

  await D.tool('apply_visibility', { action: 'reset' });
  D.chat.reset();
  await sleep(300);
  out.final = viewNow();
  return JSON.stringify(out);
})()`

/* ══════════════════════════ 4. eight review workflows ══════════════════════════ */

const FLOWS = (v) => `(async () => {
  ${KIT}
  const V = ${JSON.stringify(v)};
  const flows = [];
  const flow = async (id, title, calls, note) => {
    await D.tool('apply_visibility', { action: 'reset' });
    await D.tool('color_by_property', { property: null });
    D.chat.reset();
    await sleep(200);
    const t0 = performance.now();
    const turn = await D.chat.turn(title, calls);
    const ms = +(performance.now() - t0).toFixed(1);
    const msg = D.chat.messages()[turn.index];
    flows.push({ id, title, note, ms,
      calls: turn.results.map((r, i) => ({ tool: r.name, ok: r.ok, ms: +r.ms.toFixed(1),
        bytes: enc.encode(json(r.ok ? r.forModel : { error: r.error })).length,
        message: r.ok && r.forModel && typeof r.forModel.message === 'string'
          ? r.forModel.message.slice(0, 240) : (r.error || null),
        preview: json(r.ok ? r.forModel : { error: r.error }).slice(0, 300) })),
      chips: (msg.chips || []).map((c) => ({ label: c.label, ids: c.ids.length })),
      table: msg.table ? { groupBy: msg.table.groupBy, rows: msg.table.rows.length,
        head: msg.table.rows.slice(0, 6).map((r) => ({ k: r.k, n: r.n, area: r.area, volume: r.volume })) } : null,
      pending: msg.pending ? msg.pending.label : null,
      view: viewNow() });
  };

  /* 1. Doors per storey, as a table. */
  await flow('W1', 'doors per storey as a table',
    [{ name: 'summarize_elements', input: { groupBy: 'Level', rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcDoor' }] } }],
    'one call; the table is the answer');

  /* 2. Isolate structural columns on one storey and colour them by material. */
  await flow('W2', 'isolate columns on one storey and colour them by material', [
    { name: 'query_elements', input: { rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcColumn' }, { prop: 'Level', op: '=', val: V.columnStorey }] } },
    { name: 'set_filter_stack', input: { steps: [{ action: 'isolate', rules: [
      { prop: 'IfcEntity', op: '=', val: 'IfcColumn' }, { prop: 'Level', op: '=', val: V.columnStorey }] }] } },
    { name: 'color_by_property', input: { property: 'Material' } }
  ], 'three calls; the scope guard may hold the isolate back');

  /* 3. Walls with no fire rating, highlighted and tabulated.
   *    The rule grammar has no "absent" operator, so the only honest route is SQL — and SQL
   *    returns ids that no view tool accepts. Both halves are run, so the gap is measured. */
  await flow('W3', 'walls with no fire rating, highlighted and tabulated', [
    { name: 'list_values', input: { attr: V.fireKey || 'FireRating', rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }] } },
    { name: 'query_sql', input: { sql:
      "SELECT COUNT(*) AS walls_without_rating FROM element e WHERE e.type='IfcWall' AND NOT EXISTS (" +
      "SELECT 1 FROM property p WHERE p.element=e.id AND p.name LIKE '%FireRating%' AND p.value<>'')" } },
    { name: 'query_sql', input: { sql:
      "SELECT e.storey, COUNT(*) AS n FROM element e WHERE e.type='IfcWall' AND NOT EXISTS (" +
      "SELECT 1 FROM property p WHERE p.element=e.id AND p.name LIKE '%FireRating%' AND p.value<>'')" +
      ' GROUP BY e.storey ORDER BY n DESC' } },
    { name: 'apply_visibility', input: { rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }, { prop: V.fireKey || 'FireRating', op: '!=', val: '__no_such_value__' }], action: 'highlight' } }
  ], 'no rule operator for "property absent"; SQL can count it but no tool can select by id');

  /* 4. Total slab area by storey, with units. */
  await flow('W4', 'total slab area by storey with correct units', [
    { name: 'summarize_elements', input: { groupBy: 'Level', rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcSlab' }] } },
    { name: 'query_sql', input: { sql:
      "SELECT e.storey, COUNT(*) AS slabs, ROUND(SUM(q.value),2) AS total, q.measure, q.name" +
      " FROM element e JOIN quantity q ON q.element=e.id WHERE e.type='IfcSlab' AND q.name IN ('GrossArea','NetArea','Area')" +
      ' GROUP BY e.storey, q.name, q.measure ORDER BY total DESC' } }
  ], 'the table\\'s area column against the authored quantity and its measure type');

  /* 5. What lies within 2 m of a given element. */
  await flow('W5', 'what lies within 2 m of one element', [
    { name: 'get_element', input: { id: V.subject } },
    { name: 'query_sql', input: { sql:
      'SELECT e.type, e.name, e.storey, ROUND(MAX(MAX(b.min_x-s.max_x, s.min_x-b.max_x),' +
      ' MAX(b.min_y-s.max_y, s.min_y-b.max_y), MAX(b.min_z-s.max_z, s.min_z-b.max_z)),3) AS gap_m' +
      ' FROM bbox s JOIN bbox b ON b.element<>s.element JOIN element e ON e.id=b.element' +
      ' WHERE s.element=' + V.subject +
      ' AND b.min_x<=s.max_x+2 AND b.max_x>=s.min_x-2 AND b.min_y<=s.max_y+2 AND b.max_y>=s.min_y-2' +
      ' AND b.min_z<=s.max_z+2 AND b.max_z>=s.min_z-2 GROUP BY b.element ORDER BY gap_m LIMIT 25' } },
    { name: 'measure_between', input: { a: V.subject, b: V.neighbour } }
  ], 'no proximity tool; SQL over the bbox table is the only route');

  /* 6. A section at one gridline, showing one discipline only. */
  await flow('W6', 'section at a gridline showing one discipline', [
    { name: 'set_section', input: { kind: 'grid', name: V.grid } },
    { name: 'apply_visibility', input: { rules: [{ prop: 'Model', op: '=', val: V.model }], action: 'isolate' } },
    { name: 'set_view', input: { view: 'north', projection: 'ortho' } }
  ], 'three calls; with one file loaded the discipline filter is a no-op');

  /* 7. Save and re-apply a filter set by name. */
  await flow('W7', 'save this view as a filter set and re-apply it by name', [
    { name: 'set_filter_stack', input: { steps: [{ action: 'isolate', rules: [{ prop: 'IfcEntity', op: '=', val: V.topEntity }] }] } },
    { name: 'manage_filters', input: { op: 'list' } }
  ], 'no tool saves or names a filter set; the designed card does it and the assistant cannot');

  /* 8. A write request, refused — there is no tool that could do it. */
  await flow('W8', 'rename this wall', [
    { name: 'get_element', input: { id: V.subject } }
  ], 'no write tool exists; the refusal is the prompt\\'s second instruction line');

  await D.tool('apply_visibility', { action: 'reset' });
  D.chat.reset();
  return JSON.stringify(flows);
})()`

/* ══════════════════════════ 5. what a turn costs on the wire ══════════════════════════ */

const PAYLOADS = `(async () => {
  ${KIT}
  const p = D.chat.payloads();
  const schemaText = 'Model schema: ' + JSON.stringify(p.schema);
  const viewText = 'Current view state: ' + JSON.stringify(p.viewState);
  const cat = (name) => { const v = p.schema[name]; return Array.isArray(v)
    ? { values: v.length, bytes: enc.encode(JSON.stringify(v)).length,
        truncated: v.length ? /more — use list_values$/.test(v[v.length - 1]) : false,
        head: v.slice(0, 3) }
    : null; };
  // Twice, to show the schema is a pure function of the federation and so byte-stable.
  const again = 'Model schema: ' + JSON.stringify(D.chat.payloads().schema);
  return JSON.stringify({
    schema: { bytes: enc.encode(schemaText).length, tokens: Math.round(schemaText.length / 4),
      stable: again === schemaText,
      categories: Object.fromEntries(['storeys','grids','entities','predefinedTypes','objectTypes','psetKeys']
        .map((k) => [k, cat(k)])) },
    viewState: { bytes: enc.encode(viewText).length, tokens: Math.round(viewText.length / 4),
      text: viewText.slice(0, 400) }
  });
})()`

/** The same, with a filter stack live — the view-state message's worst case. */
const PAYLOAD_LOADED = (v) => `(async () => {
  ${KIT}
  const V = ${JSON.stringify(v)};
  await D.tool('set_filter_stack', { steps: [
    { action: 'isolate', rules: [{ prop: 'Level', op: '=', val: V.busiestStorey }] },
    { action: 'hide', rules: [{ prop: 'IfcEntity', op: '=', val: V.topEntity }] },
    { action: 'highlight', rules: [{ prop: 'IfcEntity', op: '=', val: V.secondEntity }, { prop: 'PredefinedType', op: '~', val: 'A', join: 'or' }] }] });
  await D.tool('select_elements', { rules: [{ prop: 'IfcEntity', op: '=', val: V.secondEntity }], zoom: false });
  await sleep(300);
  const p = D.chat.payloads();
  const viewText = 'Current view state: ' + JSON.stringify(p.viewState);
  const t0 = performance.now();
  const full = await D.tool('get_view_state', {});
  const ms = +(performance.now() - t0).toFixed(1);
  const fullText = JSON.stringify(full);
  await D.tool('apply_visibility', { action: 'reset' });
  await D.tool('select_elements', { rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcTeleporter' }] });
  return JSON.stringify({
    viewState: { bytes: enc.encode(viewText).length, tokens: Math.round(viewText.length / 4), text: viewText.slice(0, 600) },
    getViewState: { ms, bytes: enc.encode(fullText).length, tokens: Math.round(fullText.length / 4) }
  });
})()`

/* ══════════════════════════ 6. the model database ══════════════════════════ */

const SQL = (v) => `(async () => {
  ${KIT}
  const V = ${JSON.stringify(v)};
  const q = async (sql, note) => {
    const t0 = performance.now();
    try {
      const r = await D.sql(sql);
      const text = json(r.rows);
      return { note, ok: true, ms: +(performance.now() - t0).toFixed(1), workerMs: r.ms,
        rows: r.rows.length, truncated: r.truncated, columns: r.columns,
        bytes: enc.encode(text).length, tokens: Math.round(text.length / 4),
        head: r.rows.slice(0, 5) };
    } catch (e) {
      return { note, ok: false, ms: +(performance.now() - t0).toFixed(1),
        error: (e && e.message) ? e.message : String(e) };
    }
  };
  const tables = ['model','element','attribute','pset','property','quantity','relationship',
    'spatial','type_object','material','classification','bbox'];
  const counts = {};
  for (const t of tables) {
    const r = await q('SELECT COUNT(*) AS n FROM ' + t, 'count ' + t);
    // \`rows\` is the count of rows; the rows themselves are in \`head\`.
    counts[t] = r.ok ? r.head[0][0] : r.error;
  }
  const out = { counts, queries: [] };
  const add = async (sql, note) => { out.queries.push({ sql: sql.slice(0, 400), ...(await q(sql, note)) }); };

  /* Are the quantities numeric, and do they say what unit they are in? */
  await add("SELECT measure, COUNT(*) AS n, SUM(value IS NULL) AS non_numeric FROM quantity GROUP BY measure ORDER BY n DESC", 'quantity measures and how many are numeric');
  await add("SELECT name, measure, COUNT(*) AS n, ROUND(MIN(value),4) AS lo, ROUND(MAX(value),2) AS hi FROM quantity WHERE name IN ('GrossArea','NetArea','Area','GrossVolume','NetVolume','Volume','Length','Height','Width','Depth') GROUP BY name, measure ORDER BY n DESC LIMIT 20", 'the quantity names summarize_elements totals, with their measure and range');
  await add("SELECT measure, COUNT(*) AS n FROM property WHERE num IS NOT NULL GROUP BY measure ORDER BY n DESC LIMIT 12", 'numeric properties by measure type');

  /* The six workflow queries. */
  await add("SELECT e.storey, COUNT(*) AS doors FROM element e WHERE e.type='IfcDoor' GROUP BY e.storey ORDER BY doors DESC", 'W1 doors per storey');
  await add("SELECT e.storey, m.name AS material, COUNT(*) AS n FROM element e LEFT JOIN material m ON m.element=e.id AND m.layer IS NULL WHERE e.type='IfcColumn' GROUP BY e.storey, m.name ORDER BY n DESC LIMIT 30", 'W2 columns by storey and material');
  await add("SELECT COUNT(*) AS walls, SUM(EXISTS(SELECT 1 FROM property p WHERE p.element=e.id AND p.name LIKE '%FireRating%' AND p.value<>'')) AS with_rating FROM element e WHERE e.type='IfcWall'", 'W3 walls with and without a fire rating');
  await add("SELECT e.storey, q.name, q.measure, COUNT(*) AS n, ROUND(SUM(q.value),3) AS total FROM element e JOIN quantity q ON q.element=e.id WHERE e.type='IfcSlab' AND q.name LIKE '%Area%' GROUP BY e.storey, q.name, q.measure ORDER BY total DESC LIMIT 20", 'W4 slab area by storey, with the authored measure');
  await add('SELECT COUNT(*) AS within_2m FROM bbox s JOIN bbox b ON b.element<>s.element WHERE s.element=' + V.subject + ' AND b.min_x<=s.max_x+2 AND b.max_x>=s.min_x-2 AND b.min_y<=s.max_y+2 AND b.max_y>=s.min_y-2 AND b.min_z<=s.max_z+2 AND b.max_z>=s.min_z-2', 'W5 neighbours within 2 m of one element');
  await add("SELECT c.system, COUNT(DISTINCT c.element) AS classified FROM classification c GROUP BY c.system", 'classification coverage');

  /* How a cut at 201 rows is reported, and what the model can tell from it. */
  await add('SELECT id, type FROM element LIMIT 199', 'just under the cap');
  await add('SELECT id, type FROM element LIMIT 200', 'exactly at the cap');
  await add('SELECT id, type, name, storey FROM element', 'far over the cap — what does the model see?');

  /* The guard, on statements it must refuse. */
  for (const bad of [
    ['DELETE FROM element', 'a write'],
    ["SELECT 1; DROP TABLE element", 'two statements'],
    ['PRAGMA table_info(element)', 'a pragma'],
    ["SELECT name FROM element WHERE name='DELETE FROM x'", 'the word DELETE inside a literal — must PASS'],
    ['EXPLAIN QUERY PLAN SELECT * FROM element WHERE type=?', 'EXPLAIN with a bound parameter'],
    ['SELECT sqlite_version()', 'a scalar function']
  ]) await add(bad[0], 'guard: ' + bad[1]);

  return JSON.stringify(out);
})()`

/**
 * The ten-second limit, and what it costs to recover.
 *
 * Nothing can interrupt `sqlite3_step`, so the bridge terminates the worker and rebuilds from
 * the bytes it kept. This runs a join that cannot finish, then a trivial query afterwards — the
 * second one is the measurement that matters: the database has to still be there.
 */
const SQL_TIMEOUT = `(async () => {
  ${KIT}
  const t0 = performance.now();
  let killed = null;
  try { await D.sql('SELECT COUNT(*) FROM property a, property b'); }
  catch (e) { killed = (e && e.message) ? e.message : String(e); }
  const killMs = +(performance.now() - t0).toFixed(1);
  const t1 = performance.now();
  let after = null, afterErr = null;
  try { const r = await D.sql('SELECT COUNT(*) AS n FROM element'); after = r.rows[0][0]; }
  catch (e) { afterErr = (e && e.message) ? e.message : String(e); }
  return JSON.stringify({ killed, killMs, rebuildMs: +(performance.now() - t1).toFixed(1), after, afterErr });
})()`

/* ══════════════════ 8. Stage C — the 2026-09-20 capabilities, on a real file ══════════════════ */

/**
 * The three things the user asked to see measured on a real model once the capabilities
 * landed: the new proximity tool's cost, an isolate driven by a set `query_sql` found, and
 * "walls with no fire rating" written as a rule and checked against the database.
 *
 * Every number here is discovered from the file — the subject element, the wall entity name and
 * the fire-rating key all come from `DISCOVER` — so a run on another model still means
 * something. The view is put back at the end.
 */
const STAGE_C = (v) => `(async () => {
  ${KIT}
  const V = ${JSON.stringify(v)};
  const out = { nearby: [], ids: null, absent: null };

  /* ── the proximity tool: cost against the hand-written SQL it replaces ── */
  for (const d of [0.5, 2, 10]) {
    out.nearby.push({ distance: d, ...(await call('find_nearby', { id: V.subject, distance: d, limit: 25 }, 'find_nearby at ' + d + ' m')) });
  }
  out.nearby.push({ distance: 2, spaces: true, ...(await call('find_nearby', { id: V.subject, distance: 2, spaces: true, limit: 25 }, 'find_nearby at 2 m, spaces included')) });
  {
    const t0 = performance.now();
    const r = await D.sql('SELECT b.element, 0 AS gap FROM bbox s JOIN bbox b ON b.element<>s.element' +
      ' WHERE s.element=' + V.subject +
      ' AND b.min_x<=s.max_x+2 AND b.max_x>=s.min_x-2 AND b.min_y<=s.max_y+2 AND b.max_y>=s.min_y-2' +
      ' AND b.min_z<=s.max_z+2 AND b.max_z>=s.min_z-2');
    const text = json(r.rows);
    out.nearbySql = { ms: +(performance.now() - t0).toFixed(1), rows: r.rows.length,
      bytes: enc.encode(text).length, truncated: r.truncated };
  }

  /* ── act on a found set: SQL finds it, apply_visibility isolates exactly it ── */
  {
    D.chat.reset();
    await D.tool('apply_visibility', { action: 'reset' });
    await sleep(140);
    const before = viewNow();
    const sql = "SELECT e.id FROM element e WHERE e.type='" + V.topEntity + "' AND e.storey='" + V.busiestStorey + "'";
    const t0 = performance.now();
    const rows = await D.sql(sql);
    const sqlMs = +(performance.now() - t0).toFixed(1);
    const ids = rows.rows.map((r) => r[0]);
    // Hidden first, because it applies outright and therefore shows the exact arithmetic:
    // N found, N fewer visible. The isolate after it is the scope guard's own path.
    const hid = await callUi('apply_visibility', { action: 'hide', ids }, 'hide the ids the query returned');
    await sleep(160);
    const afterHide = viewNow();
    await D.tool('apply_visibility', { action: 'reset' });
    await sleep(140);
    const r = await callUi('apply_visibility', { action: 'isolate', ids }, 'isolate the ids the query returned');
    await sleep(160);
    const after = viewNow();
    // Every id the query returned is one the rule would have matched, so the two must agree.
    const byRule = await call('query_elements', { rules: [
      { prop: 'IfcEntity', op: '=', val: V.topEntity },
      { prop: 'Level', op: '=', val: V.busiestStorey }
    ] }, 'the same set as a rule');
    out.ids = { sql: sql.slice(0, 200), sqlMs, sqlRows: rows.rows.length, sqlTruncated: rows.truncated,
      hide: hid, afterHide, call: r, before, after,
      byRule: { ms: byRule.ms, message: byRule.message } };
    // …and a stale id must be reported, not dropped.
    out.staleIds = await call('apply_visibility', { action: 'isolate', ids: ids.slice(0, 3).concat([987654321, 987654322]) }, 'two ids that do not exist');
    await D.tool('apply_visibility', { action: 'reset' });
    await sleep(140);
  }

  /* ── "walls with no fire rating", as a rule, against SQL ── */
  if (V.wallEntity && V.fireKey) {
    const q = async (sql) => { const r = await D.sql(sql); return r.rows[0][0]; };
    const walls = await q("SELECT COUNT(*) FROM element WHERE type='" + V.wallEntity + "'");
    const carrying = await q("SELECT COUNT(*) FROM element e WHERE e.type='" + V.wallEntity +
      "' AND EXISTS (SELECT 1 FROM property p WHERE p.element=e.id AND p.name='" + V.fireKey +
      "' AND TRIM(COALESCE(p.value,''))<>'')");
    const rules = [
      { prop: 'IfcEntity', op: '=', val: V.wallEntity },
      { prop: V.fireKey, op: 'absent', val: '' }
    ];
    const t0 = performance.now();
    const asRule = await call('query_elements', { rules }, 'walls with no fire rating, as a rule');
    const ruleMs = +(performance.now() - t0).toFixed(1);
    const matched = parseInt(asRule.message || '', 10);
    const before = viewNow();
    const step = await callUi('set_filter_stack', { steps: [{ action: 'highlight', rules }] }, 'highlight them as a filter step');
    await sleep(160);
    out.absent = {
      wallEntity: V.wallEntity, fireKey: V.fireKey,
      sqlWalls: walls, sqlCarrying: carrying, sqlMissing: walls - carrying,
      ruleMs, ruleMessage: asRule.message, ruleTokens: asRule.tokens, ruleMatched: matched,
      agrees: matched === walls - carrying,
      step: { ms: step.ms, message: step.message, chips: step.chips },
      before, after: viewNow()
    };
    await D.tool('manage_filters', { op: 'clear' });
    await sleep(140);
  }

  /* ── a named filter set, saved and recalled through the card's own action ── */
  {
    await D.tool('set_filter_stack', { steps: [{ action: 'isolate', rules: [{ prop: 'Level', op: '=', val: V.busiestStorey }] }] });
    await sleep(140);
    const saved = await call('manage_filters', { op: 'save_set', name: 'audit set' }, 'save the live stack by name');
    await D.tool('manage_filters', { op: 'clear' });
    await sleep(140);
    const applied = await callUi('manage_filters', { op: 'apply_set', name: 'audit set' }, 'recall it by name');
    await sleep(160);
    out.filterSet = { saved, applied: { ms: applied.ms, message: applied.message }, after: viewNow() };
    await D.tool('manage_filters', { op: 'delete_set', name: 'audit set' });
    await D.tool('apply_visibility', { action: 'reset' });
    await sleep(140);
  }

  return JSON.stringify(out);
})()`

/* ══════════════════════════ 7. index fields a real file leaves empty ══════════════════════════ */

/**
 * The defect class `bbox` and `solidCount` were: a field the dev mock fills and the real parser
 * does not. This counts, over the whole federation, how many elements carry each field that an
 * assistant tool reads — so an empty column is visible rather than inferred.
 */
const GAPS = `(async () => {
  ${KIT}
  const f = D.federation();
  const els = f.elements;
  const n = els.length;
  const pct = (k) => +((k / n) * 100).toFixed(1);
  const has = (fn) => { let k = 0; for (const e of els) if (fn(e)) k++; return { n: k, pct: pct(k) }; };
  const meta = f.models.map((m) => m.meta);
  const metaField = (get) => meta.map((x) => { const v = get(x); return v === undefined || v === null || v === '' ||
    (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) ? null : (typeof v === 'object' ? 'set' : String(v).slice(0, 40)); });
  return JSON.stringify({
    elements: n,
    element: {
      guid: has((e) => e.guid), guidValid: has((e) => e.guidValid), tag: has((e) => e.tag),
      name: has((e) => e.name), description: has((e) => e.description),
      predefinedType: has((e) => e.predefinedType && e.predefinedType !== 'NOTDEFINED'),
      objectType: has((e) => e.objectType), typeGuid: has((e) => e.typeGuid),
      storey: has((e) => e.storey), material: has((e) => e.material),
      psets: has((e) => Object.keys(e.psets || {}).length),
      qto: has((e) => Object.keys(e.qto || {}).length),
      psetMeta: has((e) => Object.keys(e.psetMeta || {}).length),
      psetMetaMeasures: has((e) => Object.values(e.psetMeta || {}).some((m) => m && m.measures && Object.keys(m.measures).length)),
      psetMetaSource: has((e) => Object.values(e.psetMeta || {}).some((m) => m && m.sourceExpressId)),
      materials: has((e) => (e.materials || []).length),
      materialLayers: has((e) => (e.materials || []).some((m) => (m.layers || []).length)),
      classifications: has((e) => (e.classifications || []).length),
      systems: has((e) => (e.systems || []).length),
      decompParent: has((e) => e.decomposition && e.decomposition.parent !== undefined),
      decompChildren: has((e) => e.decomposition && (e.decomposition.children || []).length),
      decompOpenings: has((e) => e.decomposition && (e.decomposition.openings || []).length),
      decompFillings: has((e) => e.decomposition && (e.decomposition.fillings || []).length),
      bbox: has((e) => e.bbox), solidCount: has((e) => e.solidCount !== undefined),
      isSpace: has((e) => e.isSpace)
    },
    modelMeta: {
      sha256: metaField((m) => m.sha256), schema: metaField((m) => m.schema),
      viewDefinition: metaField((m) => m.header && m.header.viewDefinition),
      headerAuthor: metaField((m) => m.header && m.header.author),
      headerOriginatingSystem: metaField((m) => m.header && m.header.originatingSystem),
      headerTimeStamp: metaField((m) => m.header && m.header.timeStamp),
      project: metaField((m) => m.project && m.project.guid), site: metaField((m) => m.site && m.site.guid),
      building: metaField((m) => m.building && m.building.guid),
      spatial: metaField((m) => m.spatial), grids: meta.map((m) => (m.grids || []).length),
      storeys: meta.map((m) => (m.storeys || []).length),
      storeyPlacement: meta.map((m) => (m.storeys || []).filter((s) => s.placement).length),
      storeyHeight: meta.map((m) => (m.storeys || []).filter((s) => s.h !== undefined && s.h !== null).length),
      storeyComposition: meta.map((m) => (m.storeys || []).filter((s) => s.compositionType).length),
      georefMethod: metaField((m) => m.georef && m.georef.method),
      georefSources: meta.map((m) => (m.georef && m.georef.sources ? m.georef.sources.length : 0)),
      georefCrs: metaField((m) => m.georef && m.georef.crs),
      unitsByType: meta.map((m) => Object.keys((m.units && m.units.byType) || {}).length),
      counts: meta.map((m) => m.counts || null)
    },
    spatialNodes: meta.map((m) => { let k = 0, spaces = 0, withElev = 0;
      const walk = (x) => { if (!x) return; k++; if (x.type === 'IfcSpace') spaces++;
        if (x.elevation !== undefined && x.elevation !== null) withElev++;
        for (const c of x.children || []) walk(c); };
      walk(m.spatial); return { nodes: k, spaces, withElevation: withElev }; })
  });
})()`

/* ══════════════════════════ the prompt, measured in Node ══════════════════════════ */

/**
 * `contractText()` and `apiTools()` live in the main process and are never in the renderer
 * bundle, so they are measured here instead — by bundling the real modules with esbuild (which
 * Vite already ships) and calling them. Reimplementing them in the harness would measure the
 * harness.
 */
function promptModule() {
  const esbuild = require('esbuild')
  const built = esbuild.buildSync({
    entryPoints: [join(ROOT, 'src/main/ai/prompt.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    external: ['@anthropic-ai/sdk', 'sql.js'],
    logLevel: 'silent'
  })
  const code = built.outputFiles[0].text
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', code)(module, module.exports, require)
  return module.exports
}

const bytes = (s) => Buffer.byteLength(s, 'utf8')
const tokens = (s) => Math.round(s.length / 4)
const measure = (s) => ({ bytes: bytes(s), tokens: tokens(s) })

/** Everything about the request that does not need a model. */
function measurePrompt(schema, viewState) {
  const P = promptModule()
  const contract = P.contractText()
  const mk = (history, text) =>
    P.buildRequest({
      model: 'claude-opus-5',
      effort: 'medium',
      maxTokens: 16_000,
      schema,
      viewState,
      history,
      userText: text
    })

  const turn1 = mk([], 'how many doors are there?')
  const turn2 = mk([], 'how many doors are there?')
  const turn3 = mk(
    [
      { role: 'user', content: [{ type: 'text', text: 'how many doors are there?' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'There are 412.' }] }
    ],
    'and the windows?'
  )

  const toolsJson = JSON.stringify(turn1.tools)
  const whole = JSON.stringify(turn1)
  const cacheBlocks = (r) => {
    let n = 0
    const walk = (v) => {
      if (!v || typeof v !== 'object') return
      if (Array.isArray(v)) return v.forEach(walk)
      if ('cache_control' in v) n++
      for (const x of Object.values(v)) walk(x)
    }
    walk(r.system)
    walk(r.messages)
    walk(r.tools)
    return n
  }

  return {
    params: {
      model: turn1.model,
      max_tokens: turn1.max_tokens,
      thinking: turn1.thinking,
      output_config: turn1.output_config,
      tool_choice: turn1.tool_choice,
      stream: turn1.stream,
      keys: Object.keys(turn1).sort(),
      hasTemperature: 'temperature' in turn1,
      hasBudgetTokens: !!(turn1.thinking && turn1.thinking.budget_tokens)
    },
    tools: {
      count: turn1.tools.length,
      ...measure(toolsJson),
      sorted: turn1.tools.map((t) => t.name).join(',') === [...turn1.tools.map((t) => t.name)].sort().join(','),
      strict: turn1.tools.filter((t) => t.strict).length,
      notStrict: turn1.tools.filter((t) => !t.strict).map((t) => t.name),
      biggest: [...turn1.tools]
        .map((t) => ({ name: t.name, bytes: bytes(JSON.stringify(t)) }))
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 5),
      descriptions: turn1.tools.map((t) => ({ name: t.name, words: t.description.trim().split(/\s+/).length }))
    },
    contract: {
      ...measure(contract),
      lines: contract.split('\n').length,
      designLines: P.DESIGN_SYSTEM_LINES.length,
      // Which of the ten read-only additions the instructions actually name.
      namesExtraTools: [
        'get_element', 'get_entity_raw', 'list_values', 'search', 'get_spatial_tree',
        'get_relationships', 'get_model_info', 'get_view_state', 'measure_between', 'query_sql'
      ].filter((n) => contract.includes(n)),
      namesDesignTools: [
        'summarize_elements', 'audit_model', 'clash_check', 'set_filter_stack', 'manage_filters',
        'query_elements', 'apply_visibility', 'select_elements', 'set_storeys', 'activate_model',
        'set_view', 'set_section', 'toggle_display', 'color_by_property', 'color_models'
      ].filter((n) => contract.includes(n)),
      mentionsBoxCaveat: /bounding-box|bounding box|approximation/i.test(contract),
      mentionsUntrusted: /untrusted|treat .*as data|do not follow/i.test(contract),
      mentionsTableConvention: /table|csv|chip/i.test(contract),
      mentionsPreferSql: /query_sql for a join no other tool expresses/i.test(contract)
    },
    system: {
      blocks: turn1.system.length,
      each: turn1.system.map((b) => measure(b.text)),
      total: measure(turn1.system.map((b) => b.text).join('\n'))
    },
    whole: { ...measure(whole), cacheBreakpoints: cacheBlocks(turn1) },
    stability: {
      identicalTurns: JSON.stringify(turn1) === JSON.stringify(turn2),
      prefixStableAcrossTurns:
        JSON.stringify(turn1.tools) === JSON.stringify(turn3.tools) &&
        JSON.stringify(turn1.system) === JSON.stringify(turn3.system),
      breakpointsTurn3: cacheBlocks(turn3),
      systemRoleMessages: turn1.messages.filter((m) => m.role === 'system').length,
      lastMessageRole: turn1.messages[turn1.messages.length - 1].role
    }
  }
}

/* ══════════════════════════ the run ══════════════════════════ */

const report = { model: MOCK ? 'mock federation' : basename(MODEL), at: new Date().toISOString() }
const log = (...a) => console.log(...a)

/**
 * A block that throws must say where, not vanish into an unhandled rejection that trips the
 * guard — the run is long and re-running it costs a 10 s parse.
 */
/** Parse a block's answer, and stop loudly when the block itself threw. */
function parse(text, label) {
  const value = JSON.parse(text)
  if (value && value.__error) {
    log(`\nBLOCK "${label}" THREW: ${value.__error}`)
    log(`  ${value.stack}`)
    guard.stop()
    app.exit(3)
    throw new Error(`${label}: ${value.__error}`)
  }
  return value
}

const guarded = (code) => `(async () => {
  try { return await (${code}) }
  catch (e) { return JSON.stringify({ __error: (e && e.message) || String(e),
    stack: ((e && e.stack) || '').split('\\n').slice(0, 6).join(' | ') }) }
})()`

app.whenReady().then(async () => {
  protocol.handle('sgvue-file', () => net.fetch(pathToFileURL(MODEL).toString()))
  const win = new BrowserWindow({
    width: SIZE[0],
    height: SIZE[1],
    useContentSize: true,
    show: true,
    backgroundColor: '#0F1516',
    webPreferences: {
      preload: join(ROOT, 'out/preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false
    }
  })
  win.webContents.on('console-message', (e) => log(`[renderer] ${e.message}`))
  await win.loadFile(join(ROOT, 'out/renderer/index.html'), HASH ? { hash: HASH } : undefined)
  await wait(2500)

  const js = (code) => win.webContents.executeJavaScript(code)
  if (!(await js('!!window.__sgvueDev'))) {
    log('no __sgvueDev — rebuild with VITE_SGVUE_DEVTOOLS=1')
    return app.exit(1)
  }
  if (!(await js('!!window.__sgvueDev.toolUi'))) {
    log('no __sgvueDev.toolUi — rebuild: this harness needs the 2026-09-20 dev hooks')
    return app.exit(1)
  }

  const t0 = Date.now()
  if (MOCK) await js('window.__sgvueDev.elementIds().length')
  else
    await js(
      `window.__sgvueDev.open('sgvue-file://model/${encodeURIComponent(basename(MODEL))}', ${JSON.stringify(basename(MODEL))})`
    )
  log(`load to first frame  ${((Date.now() - t0) / 1000).toFixed(2)} s`)
  guard.sample('loaded')
  await wait(1800)

  /* ── what the file carries ── */
  const D = parse(await js(guarded(DISCOVER)), 'discover')
  report.discovery = D
  log('\n── the file ──')
  log(`  ${D.elements} elements · ${D.entityCount} entities · ${D.storeys} storeys · ${D.grids} grids · ${D.propKeys} propKeys`)
  log(`  entities   ${D.entityTop.map(([k, n]) => k + ' ' + n).join(', ')}`)
  log(`  pset names ${D.psetNames.map(([k, n]) => k + ' ' + n).join(', ')}`)
  log(`  set prefixes ${D.setPrefixes.join(' ')}`)
  log(`  widest keys ${D.keyTop.slice(0, 10).map(([k, n]) => k + ' ' + n).join(', ')}`)
  log(`  boxes ${D.withBox}/${D.elements} · solidCount ${D.withSolidCount}/${D.elements}`)

  /* The vocabulary every later block is parameterised by. Nothing is hard-coded. */
  const topEntity = D.entityTop[0][0]
  const secondEntity = (D.entityTop[1] || D.entityTop[0])[0]
  // The rarest entity with at least one element — what trips the 5 % scope guard.
  const rareEntity = D.entityTop[D.entityTop.length - 1][0]
  const busiestStorey = D.storeyTop.length ? D.storeyTop[0][0] : D.storeyNames[0]
  const psetKey = D.keyTop.length ? D.keyTop[0][0] : null
  const fireKey = (D.psetPrefixed.find(([k]) => /fire/i.test(k)) || [null])[0]
  const V = {
    model: D.models[0],
    topEntity,
    secondEntity,
    rareEntity,
    busiestStorey,
    columnStorey: busiestStorey,
    twoStoreys: D.storeyNames.slice(0, 2),
    grid: D.gridNames[0] || null,
    psetKey,
    fireKey,
    // The file's own wall entity, for the "no fire rating" rule below.
    wallEntity: (D.entityTop.find(([k]) => /^IfcWall/.test(k)) || [null])[0],
    subject: D.subjects.withGeom ? D.subjects.withGeom.id : null,
    neighbour: D.subjects.highest
  }
  report.vocabulary = V

  /* ── 1. every tool ── */
  if (wants('tools')) {
    const odd = D.subjects.oddName ? D.subjects.oddName.sample : 'Wärme — «Größe» ☃'
    const guid = D.subjects.withGeom ? D.subjects.withGeom.guid : ''
    const eid = D.subjects.withGeom ? D.subjects.withGeom.expressId : 1
    const id = V.subject
    const noGeom = D.subjects.withoutGeom ? D.subjects.withoutGeom.id : id
    const rich = D.subjects.richest ? D.subjects.richest.id : id
    const matrix = [
      /* summarize_elements */
      ['summarize_elements', { groupBy: 'IfcEntity' }, 'no rules — summarises what is VISIBLE'],
      ['summarize_elements', { groupBy: 'Level', rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcDoor' }] }, 'doors per storey'],
      ['summarize_elements', { groupBy: psetKey }, 'the file’s widest property-set key — large'],
      ['summarize_elements', { groupBy: 'Name' }, 'group by Name — one group per element, worst case'],
      ['summarize_elements', { groupBy: 'NoSuchKeyZZ' }, 'a key nothing carries'],
      ['summarize_elements', { groupBy: 'IfcEntity', rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcTeleporter' }] }, 'no match'],
      ['summarize_elements', { groupBy: 42 }, 'malformed: groupBy is a number'],
      ['summarize_elements', { groupBy: odd }, 'odd characters'],
      /* audit_model */
      ['audit_model', {}, 'the whole federation'],
      ['audit_model', {}, 'the same again — is it cached or recomputed?'],
      ['audit_model', { unexpected: 'x' }, 'an argument it does not declare'],
      /* clash_check */
      ['clash_check', { modelA: V.model, modelB: V.model }, 'the same model twice'],
      ['clash_check', { modelA: V.model, modelB: 'NoSuchModel' }, 'a model that is not loaded'],
      ['clash_check', { modelA: V.model, modelB: D.models[1] || 'NoSuchModel', tolerance: 0.01 }, 'a real two-model sweep (mock only)'],
      ['clash_check', { modelA: V.model }, 'malformed: modelB missing'],
      /* query_elements */
      ['query_elements', { rules: [{ prop: 'IfcEntity', op: '=', val: topEntity }] }, 'the commonest entity — a very large match'],
      ['query_elements', { rules: [{ prop: 'IfcEntity', op: '~', val: 'Ifc' }] }, 'every element in the file'],
      ['query_elements', { rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcDoor' }, { prop: 'Level', op: '=', val: busiestStorey }] }, 'doors on one storey'],
      ['query_elements', { rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcTeleporter' }] }, 'no match — does it name the valid values?'],
      ['query_elements', { rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcDoor' }, { prop: 'IfcEntity', op: '=', val: 'IfcWindow', join: 'or' }] }, 'two OR groups'],
      ['query_elements', { rules: 'IfcDoor' }, 'malformed: rules is a string'],
      ['query_elements', { rules: [{ prop: 'Name', op: '~', val: odd }] }, 'odd characters in the value'],
      /* get_element */
      ['get_element', { id }, 'by federation id'],
      ['get_element', { guid }, 'by GlobalId'],
      ['get_element', { id: rich }, 'the element with the most property sets — worst case'],
      ['get_element', { id: noGeom }, 'an element with no geometry'],
      ['get_element', { id: 999_999_999 }, 'an id that does not exist'],
      ['get_element', {}, 'neither id nor guid'],
      ['get_element', { guid: 'not-a-guid-☃' }, 'odd characters in the guid'],
      /* get_entity_raw */
      ['get_entity_raw', { expressId: eid }, 'one STEP line, model implied'],
      ['get_entity_raw', { guid }, 'by GlobalId'],
      ['get_entity_raw', { model: V.model, expressId: 1 }, 'line #1'],
      ['get_entity_raw', { model: 'NoSuchModel', expressId: eid }, 'a model that is not loaded'],
      ['get_entity_raw', {}, 'no arguments'],
      /* list_values */
      ['list_values', { attr: 'IfcEntity' }, 'every entity, with counts'],
      ['list_values', { attr: 'Name', limit: 200 }, 'every distinct Name — the largest list_values can return'],
      ['list_values', { attr: psetKey, limit: 200 }, 'the widest pset key at the cap'],
      ['list_values', { attr: 'Level', contains: 'l' }, 'a substring filter'],
      ['list_values', { attr: 'IfcEntity', limit: 5, offset: 5 }, 'paging'],
      ['list_values', { attr: 'IfcEntity', limit: 5000 }, 'a limit far over the cap'],
      ['list_values', { attr: 'NoSuchKeyZZ' }, 'a key nothing carries'],
      ['list_values', { attr: 'IfcEntity', limit: 'lots' }, 'malformed: limit is a string'],
      /* search */
      ['search', { text: 'wall' }, 'a common word — scans every property of every element'],
      ['search', { text: 'a', limit: 100 }, 'one letter — the worst case'],
      ['search', { text: guid }, 'a GlobalId'],
      ['search', { text: 'zzzzzznothing' }, 'no match'],
      ['search', { text: '' }, 'empty text'],
      ['search', { text: odd }, 'odd characters'],
      /* get_spatial_tree */
      ['get_spatial_tree', {}, 'every model'],
      ['get_spatial_tree', { counts: true }, 'with the element count under each storey'],
      ['get_spatial_tree', { model: 'NoSuchModel' }, 'a model that is not loaded'],
      /* get_relationships */
      ['get_relationships', { id }, 'by id'],
      ['get_relationships', { guid }, 'by GlobalId'],
      ['get_relationships', { id: 999_999_999 }, 'an id that does not exist'],
      /* get_model_info */
      ['get_model_info', {}, 'every loaded file'],
      ['get_model_info', { model: V.model }, 'one file'],
      ['get_model_info', { model: 'NoSuchModel' }, 'a file that is not loaded'],
      /* get_view_state */
      ['get_view_state', {}, 'the default view'],
      ['get_view_state', { unexpected: 1 }, 'an argument it does not declare'],
      /* measure_between */
      ['measure_between', { a: D.subjects.lowest, b: D.subjects.highest }, 'the lowest and the highest boxed element'],
      ['measure_between', { a: id, b: id }, 'an element against itself'],
      ['measure_between', { a: id, b: noGeom }, 'against an element with no geometry'],
      ['measure_between', { a: id }, 'malformed: b missing'],
      /* query_sql */
      ['query_sql', { sql: 'SELECT type, COUNT(*) AS n FROM element GROUP BY type ORDER BY n DESC' }, 'entities by count'],
      ['query_sql', { sql: 'SELECT id, name, storey FROM element' }, 'far over the 200-row cap'],
      ['query_sql', { sql: 'DELETE FROM element' }, 'refused by the guard'],
      ['query_sql', { sql: 'SELECT * FROM no_such_table' }, 'a SQLite error'],
      ['query_sql', { sql: '' }, 'empty']
    ].map(([name, input, note]) => ({ name, input, note }))
    const rows = parse(await js(guarded(TOOLS(matrix))), 'tools')
    report.tools = rows
    log('\n── every tool, on the real model ──')
    log('  tool                 ms      bytes    ~tok  ok  note')
    for (const r of rows) {
      log(
        `  ${r.name.padEnd(20)} ${String(r.ms).padStart(7)} ${String(r.bytes).padStart(8)} ${String(r.tokens).padStart(7)}  ${r.ok ? ' ok' : 'ERR'}  ${r.note}`
      )
    }
    const heavy = rows.filter((r) => r.tokens > 8000)
    const slow = rows.filter((r) => r.ms > 1000)
    log(`  over 8 000 tokens: ${heavy.length ? heavy.map((r) => `${r.name} (${r.tokens})`).join(', ') : 'none'}`)
    log(`  over 1 s:          ${slow.length ? slow.map((r) => `${r.name} (${r.ms} ms)`).join(', ') : 'none'}`)
    guard.sample('tools')
  }

  /* ── 2. the view tools ── */
  if (wants('view')) {
    const steps = parse(await js(guarded(VIEW(V))), 'view')
    report.view = steps
    log('\n── the view tools, through the store ──')
    for (const s of steps) {
      const b = s.before, a = s.after
      log(`  ${s.name.padEnd(19)} ${String(s.ms).padStart(7)} ms  ${s.note}`)
      log(
        `      visible ${b ? b.visible : '?'} → ${a ? a.visible : '?'} · stack "${a ? a.stack : ''}" · storeys ${a ? a.storeysShown + '/' + a.of : ''} · sec ${a ? a.section : ''} · colour ${a ? a.colorBy : ''} · sel ${a ? a.selected : ''} · ${a ? a.view + '/' + a.projection : ''}`
      )
      if (s.chips && s.chips.length) log(`      chips ${JSON.stringify(s.chips)} (ids carried: ${s.chipIdsTotal})`)
      if (s.table) log(`      table ${JSON.stringify(s.table)}`)
      if (s.pending) log(`      PENDING ${JSON.stringify(s.pending)}`)
      if (s.message) log(`      "${s.message}"`)
      if (s.error) log(`      ERROR ${s.error}`)
    }
    guard.sample('view')
  }

  /* ── 3. the scope guard ── */
  if (wants('guard')) {
    const g = parse(await js(guarded(GUARD(V))), 'guard')
    report.guard = g
    log('\n── the 5 % scope guard ──')
    log('  refused outright  ', JSON.stringify(g.refused && { message: g.refused.message, pending: g.refused.pending }))
    log('  pending           ', JSON.stringify(g.pending))
    log('  applied           ', JSON.stringify(g.applied))
    log('  reverted          ', JSON.stringify(g.reverted))
    log('  cancelled         ', JSON.stringify(g.cancelled))
    log('  highlight exempt  ', JSON.stringify(g.highlightExempt && { message: g.highlightExempt.message, pending: g.highlightExempt.pending, acted: g.highlightExempt.acted }))
    log('  read-only turn    ', JSON.stringify(g.readOnlyTurn))
    log('  final view        ', JSON.stringify(g.final))
    guard.sample('guard')
  }

  /* ── 4. the eight workflows ── */
  if (wants('flows')) {
    const flows = parse(await js(guarded(FLOWS(V))), 'flows')
    report.flows = flows
    log('\n── eight review workflows ──')
    for (const f of flows) {
      log(`\n  ${f.id}  ${f.title}   (${f.ms} ms, ${f.calls.length} call${f.calls.length === 1 ? '' : 's'})`)
      log(`      ${f.note}`)
      for (const c of f.calls) log(`      ${c.tool.padEnd(19)} ${String(c.ms).padStart(7)} ms ${String(c.bytes).padStart(7)} B  ${c.ok ? '' : 'ERR '}${(c.message || '').slice(0, 170)}`)
      if (f.table) log(`      table ${JSON.stringify(f.table)}`)
      if (f.chips.length) log(`      chips ${JSON.stringify(f.chips)}`)
      if (f.pending) log(`      PENDING ${f.pending}`)
      log(`      view  ${JSON.stringify(f.view)}`)
    }
    guard.sample('flows')
  }

  /* ── 5. what a turn costs ── */
  if (wants('payload')) {
    const p = parse(await js(guarded(PAYLOADS)), 'payloads')
    const loaded = parse(await js(guarded(PAYLOAD_LOADED(V))), 'payload-loaded')
    const prompt = measurePrompt(
      JSON.parse(await js('JSON.stringify(window.__sgvueDev.chat.payloads().schema)')),
      JSON.parse(await js('JSON.stringify(window.__sgvueDev.chat.payloads().viewState)'))
    )
    report.payload = { ...p, loaded, prompt }
    log('\n── what one turn costs ──')
    log(`  tools block   ${prompt.tools.bytes} B  ~${prompt.tools.tokens} tok  (${prompt.tools.count} tools, sorted=${prompt.tools.sorted}, strict on ${prompt.tools.strict})`)
    log(`  contract      ${prompt.contract.bytes} B  ~${prompt.contract.tokens} tok  (${prompt.contract.lines} lines)`)
    log(`  schema block  ${p.schema.bytes} B  ~${p.schema.tokens} tok  (byte-stable=${p.schema.stable})`)
    log(`  view state    ${p.viewState.bytes} B  ~${p.viewState.tokens} tok  (empty view)`)
    log(`  view state    ${loaded.viewState.bytes} B  ~${loaded.viewState.tokens} tok  (three live steps + a selection)`)
    log(`  get_view_state ${loaded.getViewState.bytes} B ~${loaded.getViewState.tokens} tok in ${loaded.getViewState.ms} ms`)
    log(`  whole request ${prompt.whole.bytes} B  ~${prompt.whole.tokens} tok  · ${prompt.whole.cacheBreakpoints} cache breakpoints`)
    log(`  params        ${JSON.stringify(prompt.params)}`)
    log(`  stability     ${JSON.stringify(prompt.stability)}`)
    log(`  contract names: ${prompt.contract.namesExtraTools.length}/10 extra tools, ${prompt.contract.namesDesignTools.length}/15 design tools`)
    log(`  schema categories`)
    for (const [k, c] of Object.entries(p.schema.categories)) if (c) log(`      ${k.padEnd(16)} ${String(c.values).padStart(5)} values ${String(c.bytes).padStart(7)} B  truncated=${c.truncated}`)
    log(`  biggest tool schemas ${JSON.stringify(prompt.tools.biggest)}`)
    guard.sample('payload')
  }

  /* ── 6. the model database ── */
  if (wants('sql')) {
    const s = parse(await js(guarded(SQL(V))), 'sql')
    report.sql = s
    log('\n── the model database ──')
    log('  rows  ' + Object.entries(s.counts).map(([t, n]) => `${t}=${n}`).join('  '))
    for (const q of s.queries) {
      log(`  ${q.ok ? 'ok ' : 'ERR'} ${String(q.ms).padStart(7)} ms  ${q.ok ? String(q.rows).padStart(4) + ' rows' + (q.truncated ? ' (CUT)' : '     ') + ' ' + String(q.bytes).padStart(7) + ' B' : ''}  ${q.note}`)
      if (!q.ok) log(`        ${q.error}`)
      else if (q.head && q.head.length) log(`        ${JSON.stringify(q.head.slice(0, 3))}`)
    }
    guard.sample('sql')
  }

  if (wants('sqltimeout')) {
    log('\n── the ten-second limit ──')
    const t = parse(await js(guarded(SQL_TIMEOUT)), 'sql-timeout')
    report.sqlTimeout = t
    log('  ' + JSON.stringify(t))
    guard.sample('sqltimeout')
  }

  /* ── 7. index fields a real file leaves empty ── */
  if (wants('gaps')) {
    const g = parse(await js(guarded(GAPS)), 'gaps')
    report.gaps = g
    log('\n── index coverage on a real file ──')
    for (const [k, v] of Object.entries(g.element)) log(`  element.${k.padEnd(22)} ${String(v.n).padStart(7)}  ${String(v.pct).padStart(6)} %`)
    log('  model meta')
    for (const [k, v] of Object.entries(g.modelMeta)) log(`      ${k.padEnd(24)} ${JSON.stringify(v)}`)
    log(`  spatial nodes ${JSON.stringify(g.spatialNodes)}`)
    guard.sample('gaps')
  }

  /* ── 8. Stage C: the 2026-09-20 capabilities ── */
  if (wants('stagec')) {
    const c = parse(await js(guarded(STAGE_C(V))), 'stagec')
    report.stageC = c
    log('\n── find_nearby, on a real file ──')
    for (const n of c.nearby) {
      log(`  ${String(n.distance).padStart(5)} m${n.spaces ? ' +spaces' : '        '}  ${String(n.ms).padStart(6)} ms  ${String(n.bytes).padStart(6)} B  ~${String(n.tokens).padStart(4)} tok  ${n.message ? n.message.slice(0, 120) : ''}`)
    }
    if (c.nearbySql) log(`  the bbox self-join it replaces: ${c.nearbySql.ms} ms, ${c.nearbySql.rows} rows, ${c.nearbySql.bytes} B`)

    log('\n── acting on a set query_sql found ──')
    if (c.ids) {
      log(`  SQL ${c.ids.sqlMs} ms → ${c.ids.sqlRows} ids (truncated=${c.ids.sqlTruncated})`)
      log(`  hide     ${c.ids.hide.ms} ms  ${c.ids.hide.bytes} B  ${c.ids.hide.message}`)
      log(`  view     ${c.ids.before.visible} → ${c.ids.afterHide.visible} visible  (${c.ids.before.visible - c.ids.afterHide.visible} hidden, ${c.ids.sqlRows} asked for)`)
      log(`  isolate  ${c.ids.call.ms} ms  ${c.ids.call.bytes} B  ${c.ids.call.message}`)
      log(`  view     ${c.ids.before.visible} → ${c.ids.after.visible} visible of ${c.ids.after.total}`)
      log(`  the same set as a rule: ${c.ids.byRule.message}`)
    }
    if (c.staleIds) log(`  stale ids: ${c.staleIds.message}`)

    log('\n── "walls with no fire rating", as a rule ──')
    if (c.absent) {
      const a = c.absent
      log(`  ${a.wallEntity} ${a.sqlWalls}; SQL says ${a.sqlCarrying} carry ${a.fireKey}, ${a.sqlMissing} do not`)
      log(`  the rule matched ${a.ruleMatched} in ${a.ruleMs} ms — agrees with SQL: ${a.agrees}`)
      log(`  as a highlight step: ${a.step.ms} ms — ${a.step.message}`)
    } else {
      log('  skipped: this file has no wall entity or no fire-rating key')
    }

    log('\n── a filter set by name ──')
    if (c.filterSet) {
      log(`  save   ${c.filterSet.saved.ms} ms — ${c.filterSet.saved.message}`)
      log(`  recall ${c.filterSet.applied.ms} ms — ${c.filterSet.applied.message}`)
    }
    guard.sample('stagec')
  }

  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2))
  log(`\nwrote ${OUT_JSON}`)
  guard.sample('done')
  guard.stop()
  app.exit(0)
})
