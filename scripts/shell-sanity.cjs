/**
 * Dev utility — NOT application code. Phase 3's one run against a real model.
 *
 *   VITE_SGVUE_DEVTOOLS=1 npm run build
 *   SGVUE_IFC="samples/Sample Ifc Model.ifc" node scripts/safe-run.cjs shell-sanity.cjs
 *
 * Loads a real IFC file through the app's own pipeline, then reads the **designed sidebar** back
 * out of the DOM — the models row, the storey ladder with its elevations and counts, the element
 * groups with their counts, and the status bar — so a Build Report can quote what the shell
 * actually filled in rather than what it was expected to.
 *
 * It also times the thing a real index makes expensive and the mock cannot: expanding the
 * largest element group (thousands of rows), click to two frames later, and the frame times of
 * a scroll through the opened list.
 *
 * WebGL2 only and guarded, like every other Electron script here — see
 * `scripts/lib/electron-guard.cjs` for the three kernel panics that put it there. The memory
 * limits are the guard's defaults; only the wall clock is raised, because a 138 MB parse plus
 * the readout does not fit in 25 s.
 *
 * 2026-10-01: the Section card has two planes. The section readouts name both (`planes`,
 * `secSummaries`), the gridline chips are read with their family rows and rules, and the card
 * is cleared with `Clear all`.
 */
const { app, BrowserWindow, protocol, net } = require('electron')
const { existsSync, readFileSync } = require('node:fs')
const { writeFile } = require('node:fs/promises')
const { basename, join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { installGuard } = require('./lib/electron-guard.cjs')
const { resolveBackend } = require('./lib/backend.cjs')

const ROOT = join(__dirname, '..')
/**
 * `SGVUE_IFC=mock` runs the same readout against the design's mock federation instead of a
 * file. With `SGVUE_ROWS=<n>` it is also how the windowed row path is exercised without
 * touching a real model — the mock's largest group is 124 rows, under the 200-row threshold.
 */
const MOCK = process.env.SGVUE_IFC === 'mock'
const MODEL = resolve(ROOT, process.env.SGVUE_IFC || 'samples/Sample Ifc Model.ifc')
const OUT = resolve(ROOT, process.env.SGVUE_OUT || 'tests/parity/phase3/big-model.png')
/**
 * The IfcOpenShell ground truth for the same file, when it has been generated
 * (`python3 scripts/expected-from-ifcopenshell.py`). The `frame` block compares the app's own
 * readouts against it; without it that block reports what it can and skips the comparisons.
 */
const EXPECTED_JSON = resolve(
  ROOT,
  'tests/fixtures',
  basename(MODEL).replace(/\.[^.]+$/, '') + '.expected.json'
)
const REFERENCE = existsSync(EXPECTED_JSON) ? JSON.parse(readFileSync(EXPECTED_JSON, 'utf8')) : null
const SIZE = (process.env.SGVUE_SIZE || '1440x860').split('x').map(Number)
const { hash: BACKEND_HASH } = resolveBackend(MOCK ? 'mock' : '')
const HASH = [BACKEND_HASH, process.env.SGVUE_ROWS ? `rows=${process.env.SGVUE_ROWS}` : '']
  .filter(Boolean)
  .join('&')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
/** `SGVUE_ONLY=annotate,colors` runs the sidebar readout and the named blocks only. */
const ONLY = (process.env.SGVUE_ONLY || '').split(',').filter(Boolean)
const wants = (block) => !ONLY.length || ONLY.includes(block)

// Raised again in Phase 6: after the filter block the run walks the gridlines, two section
// planes and one laser measurement, and orbits for three more seconds. Memory limits are still
// the guard's defaults.
const guard = installGuard({ label: `shell-sanity ${basename(MODEL)}`, maxSeconds: 300 })

app.enableSandbox()
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'sgvue-file',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  }
])

/** Read the designed sidebar back out of the DOM, by the copy and titles the port keeps. */
const READOUT = `(() => {
  const $$ = (s) => [...document.querySelectorAll(s)];
  const txt = (e) => (e.textContent || '').trim();
  const rowOf = (btn) => btn.parentElement;
  const models = $$('button').filter((b) => b.title === 'Show / hide model')
    .map((b) => [...rowOf(b).children].map(txt).filter(Boolean).join(' | '));
  const storeys = $$('button').filter((b) => b.title === 'Show / hide storey')
    .map((b) => [...rowOf(b).children].map(txt).filter(Boolean).join(' | '));
  const groups = $$('button').filter((b) => b.title === 'Show / hide group')
    .map((b) => [...rowOf(b).children].map(txt).filter(Boolean).join(' '));
  // 2026-10-01: the status bar is a zone of the bottom row and no longer positions itself.
  const status = document.querySelector('[data-role="statusbar"]');
  const header = $$('button').find((b) => b.dataset.tip === 'Project, site and building information');
  return JSON.stringify({ header: header ? [...header.children].map(txt) : null,
    models, storeys, groups, status: status ? txt(status) : null });
})()`

/**
 * Expand the biggest group and time it: the click, then two animation frames, which is when the
 * new rows have been laid out and painted. Then scroll the list and report the frame times.
 */
const EXPAND = `(async () => {
  const $$ = (s) => [...document.querySelectorAll(s)];
  const txt = (e) => (e.textContent || '').trim();
  const eyes = $$('button').filter((b) => b.title === 'Show / hide group');
  let best = null, bestN = 0;
  for (const b of eyes) {
    const row = b.parentElement, n = Number(txt(row.children[2]).replace(/[^0-9]/g, ''));
    if (n > bestN) { bestN = n; best = row; }
  }
  if (!best) return JSON.stringify({ error: 'no groups' });
  const label = txt(best.children[1]);
  const frame = () => new Promise((r) => requestAnimationFrame(() => r(performance.now())));
  const t0 = performance.now();
  best.click();
  await frame(); const painted = await frame();
  const rows = $$('button').filter((b) => b.title === 'Show / hide').length;
  const list = best.parentElement.parentElement;
  const times = [];
  let last = await frame();
  for (let i = 0; i < 40; i++) { list.scrollTop += 240; const t = await frame(); times.push(t - last); last = t; }
  times.sort((a, b) => a - b);
  // Leave the scroll a third of the way down the expanded group, so the screenshot that
  // follows shows the windowed slice in the middle of the list rather than its end.
  list.scrollTop = best.offsetTop + (bestN / 3) * 37;
  await frame(); await frame();
  return JSON.stringify({ label, count: bestN, expandMs: +(painted - t0).toFixed(1), rows,
    scrollMedianMs: +times[20].toFixed(1), scrollMaxMs: +times[times.length - 1].toFixed(1) });
})()`

/**
 * Phase 4, on a real index: open the `IfcWall` group, click its first row, and read the
 * **property card** back out of the DOM — how tall its content is against the 620 px box it
 * lives in, and every line it drew. A real wall carries far more property sets than the mock's
 * one, so this is the only place the card's own scrolling is exercised at all.
 */
const CARD = `(async () => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const txt = (e) => (e.textContent || '').trim();
  const frame = () => new Promise((r) => requestAnimationFrame(() => r(performance.now())));
  const group = $$('button').filter((b) => b.title === 'Show / hide group')
    .map((b) => b.parentElement).find((row) => txt(row.children[1]) === 'IfcWall');
  if (!group) return JSON.stringify({ error: 'no IfcWall group' });
  group.click(); await frame(); await frame();
  // A group of 3 314 rows is windowed: off-screen it renders none, so bring it into view first.
  group.scrollIntoView({ block: 'start' }); await frame(); await frame();
  // Inside *this* group: the biggest group is already expanded by EXPAND above, so the first
  // element row in the document belongs to that one, not to IfcWall.
  const row = group.parentElement.querySelector('button[title="Show / hide"]');
  if (!row) return JSON.stringify({ error: 'no element rows' });
  const t0 = performance.now();
  row.parentElement.click();
  await frame(); const painted = await frame();
  const card = $('[data-role="propcard"]');
  if (!card) return JSON.stringify({ error: 'no property card' });
  const body = card.lastElementChild;
  // Every collapsible section open, which is the tallest the card ever gets.
  for (const label of ['Identifiers', 'Related', 'Geometry']) {
    const head = $$('span').find((s) => txt(s) === label);
    if (head) { head.parentElement.click(); await frame(); await frame(); }
  }
  const lines = (card.innerText || '').split('\\n').map((t) => t.trim()).filter(Boolean);
  body.scrollTop = 99999; await frame(); await frame();
  return JSON.stringify({
    selectMs: +(painted - t0).toFixed(1),
    card: card.getBoundingClientRect().height,
    content: body.scrollHeight, view: body.clientHeight,
    scrolledTo: body.scrollTop, scrollable: body.scrollHeight > body.clientHeight,
    atBottom: body.scrollTop + body.clientHeight >= body.scrollHeight - 1,
    // innerText applies the card's own text-transform, so the label reads upper-case.
    psetCount: lines[lines.indexOf('PROPERTY SETS') + 1] || null,
    lines
  });
})()`

/**
 * Phase 5, on a real index: build two filter steps **through the designed card** — isolate the
 * busiest storey, then highlight `IfcWall` — and time each one from the keystroke that
 * completes it to the frame that shows it. The mock cannot answer this: 412 elements re-paint
 * inside one frame whatever the predicate, where a 26 761-element federation has to re-walk
 * every element, re-write the part-state texture and rebuild the edge index.
 */
const FILTER = `(async () => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const txt = (e) => (e.textContent || '').trim();
  const byText = (sel, t) => $$(sel).find((e) => txt(e) === t);
  const click = (e) => { if (!e) throw new Error('filter: no such control'); e.click(); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r(performance.now())));
  const setValue = (proto, el, v, ev) => {
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event(ev, { bubbles: true }));
  };
  const laneCards = () => $$('div').filter((e) => { const c = getComputedStyle(e);
    return c.position === 'absolute' && c.zIndex === '14'; });
  const card = () => laneCards().find((e) => /^Filter/.test(txt(e)));
  const status = () => txt(document.querySelector('[data-role="statusbar"]'));
  const matchLine = () => (txt(card()).match(/\\d[\\d,\\u2009 ]* of [\\d,\\u2009 ]*\\d match/) || [null])[0];

  // The storey with the most elements — the isolate worth timing.
  let storey = null, best = -1;
  for (const b of $$('button').filter((x) => x.title === 'Show / hide storey')) {
    const r = b.parentElement, n = Number(txt(r.children[3]).replace(/[^0-9]/g, ''));
    if (n > best) { best = n; storey = txt(r.children[1]); }
  }

  const step = async (prop, val, action) => {
    click(byText('button', '+ add filter step')); await sleep(250);
    setValue(window.HTMLSelectElement.prototype, card().querySelector('select'), prop, 'change');
    await sleep(250);
    const t0 = performance.now();
    setValue(window.HTMLInputElement.prototype, card().querySelector('input[placeholder="value"]'), val, 'input');
    await frame(); const painted = await frame();
    let actionMs = null;
    if (action) {
      await sleep(400);
      const t1 = performance.now();
      click(byText('button', action));
      await frame(); const p2 = await frame();
      actionMs = +(p2 - t1).toFixed(1);
    }
    await sleep(600);
    return { rule: prop + ' = ' + val, applyMs: +(painted - t0).toFixed(1), actionMs,
      match: matchLine(), status: status() };
  };

  click($('button[data-tip="Filter elements by parameter"]')); await sleep(400);
  const isolate = await step('Level', storey, null);
  const highlight = await step('IfcEntity', 'IfcWall', 'highlight');
  // fps while orbiting with both steps live.
  await window.__sgvueDev.spin(4);
  await sleep(500);
  return JSON.stringify({ storey, storeyCount: best, isolate, highlight,
    stats: window.__sgvueDev.stats(), debug: window.__sgvueDev.debug() });
})()`

/* ────────────────────────────── Phase 6, on a real index ──────────────────────────────
 * The mock federation cannot answer any of this: its grid is axis-aligned and 9 axes wide,
 * where the reference model's runs at ~43° with **no** axis-aligned axis at all, and its 412
 * elements make a laser cast free.
 *
 * Four blocks, so the outer script can screenshot between them. Each one is driven through the
 * designed controls, by the same copy the parity harness uses.
 * ──────────────────────────────────────────────────────────────────────────────────────── */
const ANN_HELPERS = `
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const txt = (e) => (e.textContent || '').trim();
  const byText = (sel, t) => $$(sel).find((e) => txt(e) === t);
  const click = (e) => { if (!e) throw new Error('annotate: no such control'); e.click(); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r(performance.now())));
  const tbBtn = (tip) => $('button[data-tip="' + tip + '"]');
  const laneCards = () => $$('div').filter((e) => { const c = getComputedStyle(e);
    return c.position === 'absolute' && c.zIndex === '14'; });
  const secCard = () => laneCards().find((e) => /^Section/.test(txt(e)));
  const secBtn = (t) => [...secCard().querySelectorAll('button')].find((b) => txt(b) === t);
  // 2026-10-01: the card has two planes. Each block has its own summary line, the gridline
  // block's first, and the viewer reports both clip planes (a parked one is 0, 0, 1, 100000).
  const secSummaries = () => [...secCard().querySelectorAll('span')].map(txt)
    .filter((t) => /^offset mm · /.test(t)).join(' | ');
  const planes = () => D.debug().planes.map((p) => p.map((v) => +v.toFixed(4)));
  const bubbles = () => $$('div').filter((e) => /^Show plane of grid /.test(e.title || ''));
  const shown = (list) => list.filter((e) => getComputedStyle(e).display !== 'none');
  const D = window.__sgvueDev;
`

/** Gridlines and their bubbles on a rotated grid, plus the level rings. */
const ANN_GRIDS = `(async () => {
  ${ANN_HELPERS}
  // Leave the filter behind: Phase 5's block ends with its card open and two live steps.
  const filterCard = () => laneCards().find((e) => /^Filter/.test(txt(e)));
  if (!filterCard()) { click(tbBtn('Filter elements by parameter')); await sleep(500); }
  const clear = byText('button', 'clear');
  if (clear) { click(clear); await sleep(900); }
  if (filterCard()) { click(tbBtn('Filter elements by parameter')); await sleep(400); }
  const fed = D.federation();
  // These are the INDEX's grids, in the file's own world coordinates, so on a
  // shared-coordinates export they read 46.59° / 136.59° — the file's truth, kept. What the
  // viewer actually draws is \`annotations.gridFamilyDeg\` in the same blob below, which is the
  // project frame and reads 0° / 90°.
  const axes = fed.grids.map((g) => {
    const a = (Math.atan2(g.end[1] - g.start[1], g.end[0] - g.start[0]) * 180) / Math.PI;
    return { name: g.name, axis: g.axis, deg: +(((a % 180) + 180) % 180).toFixed(2) };
  });
  const families = [...new Set(axes.map((a) => Math.round(a.deg / 10) * 10))];
  click(tbBtn('Levels (L)')); await sleep(600);
  await frame(); await frame();
  return JSON.stringify({
    gridAxes: axes.length, axisAligned: axes.filter((a) => a.axis).length,
    degrees: [...new Set(axes.map((a) => a.deg))].sort((x, y) => x - y), families,
    sample: axes.slice(0, 8),
    bubbles: bubbles().length, bubblesDrawn: shown(bubbles()).length,
    annotations: D.debug().annotations
  });
})()`

/** A section along one **rotated** grid, timed from the chip click to the painted frame. */
const ANN_SECTION_GRID = `(async () => {
  ${ANN_HELPERS}
  click(tbBtn('Levels (L)')); await sleep(400);
  click(tbBtn('Section from gridline / level')); await sleep(500);
  const chips = [...secCard().querySelectorAll('button')];
  const names = D.federation().grids.map((g) => g.name);
  const chip = chips.find((b) => names.includes(txt(b)));
  const t0 = performance.now();
  click(chip); await frame(); const painted = await frame();
  await sleep(1200);
  return JSON.stringify({ grid: txt(chip), applyMs: +(painted - t0).toFixed(1),
    planes: planes(), section: D.debug().section,
    summary: secSummaries(), visible: D.debug().visible, calls: D.debug().calls });
})()`

/**
 * …and along one storey, at the design's own 1 200 mm above the slab. The gridline cut is
 * cleared first (its own Clear, the card's first): since 2026-10-01 a level chip no longer
 * replaces it, and this block has always timed one plane.
 */
const ANN_SECTION_LEVEL = `(async () => {
  ${ANN_HELPERS}
  click(secBtn('Clear')); await sleep(600);
  const chips = [...secCard().querySelectorAll('button')];
  const names = D.federation().storeys.map((s) => s.name);
  const chip = chips.find((b) => names.includes(txt(b)));
  const t0 = performance.now();
  click(chip); await frame(); const painted = await frame();
  await sleep(1200);
  return JSON.stringify({ level: txt(chip), applyMs: +(painted - t0).toFixed(1),
    planes: planes(), section: D.debug().section,
    summary: secSummaries(),
    visible: D.debug().visible, calls: D.debug().calls });
})()`

/**
 * Clear the section, pick the biggest slab and the laser meter.
 *
 * The measurement is taken on the slab's **edge**, not its top face, and that is the whole
 * point: the reference's laser never reads the clicked element's own dimension *along* the
 * face normal, because the ray pointing into the surface is not fired (`viewer-core.js` L376).
 * On a vertical edge face the two perpendicular axes do cross the element, so the Z reading is
 * the slab's own thickness — a number the file states for itself in
 * `Qto_SlabBaseQuantities.Depth`, which is what makes this a check and not just a screenshot.
 *
 * A 700 mm slab 167 m across is not a box: its outline has a 1 547 m perimeter, so the AABB's
 * side faces are not all solid. The outer script therefore probes: aim at one AABB side face,
 * hover a few points, and take the first that actually reports the slab under the pointer.
 */
const ANN_LASER_PICK = `(async () => {
  ${ANN_HELPERS}
  const card = secCard();
  if (card) { click(secBtn('Clear all')); await sleep(600);
    click(tbBtn('Section from gridline / level')); await sleep(400); }
  const fed = D.federation();
  let best = null, area = -1;
  for (const e of fed.elements) {
    if (e.type !== 'IfcSlab') continue;
    const b = D.elementBox(e.id); if (!b) continue;
    const a = (b[3] - b[0]) * (b[4] - b[1]);
    if (a > area) { area = a; best = e; }
  }
  if (!best) return JSON.stringify({ error: 'no IfcSlab with geometry' });
  click($('button[data-tip^="Laser meter"]')); await sleep(300);
  const r = $('[data-role="viewport"]').getBoundingClientRect();
  return JSON.stringify({ id: best.id, name: best.name, type: best.type,
    box: D.elementBox(best.id).map((v) => +v.toFixed(3)),
    qto: best.qto, psets: Object.keys(best.psets || {}),
    viewport: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
})()`

/**
 * Frame the whole federation from the designed 3D view and pick the laser meter, so the probe
 * below has the building in front of it.
 *
 * **Aiming at a chosen element's AABB side face does not work and is not worth retrying**: the
 * biggest slab in the reference model is a 700 mm floor 167 m across whose outline has a
 * 1 547 m perimeter, so three of its four AABB side faces are in open air and a tight probe
 * window around them finds nothing. The probe reads the **live laser preview** instead, which
 * is the same number the reading will commit, and takes the first point that has one.
 */
const ANN_LASER_AIM = `(async () => {
  ${ANN_HELPERS}
  click(tbBtn('3D perspective (Home)')); await sleep(1400);
  click($('button[data-tip^="Laser meter"]')); await sleep(300);
  return JSON.stringify({ camera: D.debug().cam, tool: D.debug().tool });
})()`

/** What the pointer is over, and what the live laser reads there. */
const ANN_PROBE = `JSON.stringify({ hovered: window.__sgvueDev.debug().hovered,
  preview: window.__sgvueDev.debug().annotations.preview })`

/* ────────────────────────────── the project frame, on a real index ──────────────────────
 * The one thing only a real file can answer: is the model standing square with itself?
 *
 * The reference file is a Revit shared-coordinates export on the CORENET X convention — its
 * world axes are SVY21 map axes and the building sits at 43.41° to them, on the spatial-root
 * `IfcSite.ObjectPlacement` — so every check here fails by that angle, or by the site's own
 * 5.05 m elevation, if the frame is not undone.
 *
 * `reference` is `tests/fixtures/<stem>.expected.json`, written independently by IfcOpenShell
 * (`scripts/expected-from-ifcopenshell.py`). It carries, per sample element, the world box,
 * one exact world vertex and the same vertices in the project frame — so the app's readouts
 * are compared against an implementation that has never seen this code.
 * ──────────────────────────────────────────────────────────────────────────────────────── */
const FRAME = (reference) => `(async () => {
  ${ANN_HELPERS}
  const REF = ${JSON.stringify(reference)};
  const on = (tip) => { const b = tbBtn(tip); return getComputedStyle(b).backgroundColor; };
  const dbg = () => D.debug();

  /* 1. Gridlines. Both families must come back to the building's own axes. */
  const grids0 = dbg().annotations;
  if (!grids0.grids) { click(tbBtn('Gridlines (G)')); await sleep(500); }
  await frame(); await frame();
  const gridFamilyDeg = dbg().annotations.gridFamilyDeg;

  /* 2. Level rings against the floor geometry of the storey they name. */
  if (!dbg().annotations.levels) { click(tbBtn('Levels (L)')); await sleep(600); }
  await frame(); await frame();
  const ann = dbg().annotations;
  const fed = D.federation();
  const rings = fed.storeys.map((s, i) => {
    // A storey's floor: the tops of the IfcSlabs assigned to it. A storey holds ramps and
    // landings as well as its floor plate, so the measure is the top NEAREST the ring and how
    // many of them agree with it — not the highest, which is whatever ramp climbs furthest.
    const tops = [];
    for (const e of fed.elements) {
      if (e.storey !== s.name || e.type !== 'IfcSlab') continue;
      const b = D.elementBox(e.id);
      if (b) tops.push(b[5]);
    }
    const z = ann.levelZ[i];
    const near = tops.length ? tops.reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a)) : null;
    return { storey: s.name, ladder: +s.elev.toFixed(3), ringZ: z,
      slabs: tops.length,
      nearestSlabTopZ: near === null ? null : +near.toFixed(4),
      deltaMm: near === null ? null : Math.round((z - near) * 1000),
      within50mm: tops.filter((t) => Math.abs(t - z) <= 0.05).length };
  });

  /* 3. The Coordinate-system card: the four fields and the caption. */
  click(tbBtn('Coordinate system & true north')); await sleep(500);
  const coordsCard = laneCards().find((e) => /^Coordinate system/.test(txt(e)));
  const fields = [...coordsCard.querySelectorAll('label')].map((l) =>
    ({ label: txt(l.querySelector('span')), value: l.querySelector('input').value }));
  const caption = [...coordsCard.querySelectorAll('span')]
    .map(txt).find((t) => /^project base point/.test(t));
  const chip = txt([...coordsCard.querySelectorAll('span')][1]);
  // It must fit the designed 300 px card in both themes.
  const captionEl = [...coordsCard.querySelectorAll('span')]
    .find((e) => /^project base point/.test(txt(e)));
  const fitsIn = () => {
    const card = coordsCard.getBoundingClientRect();
    const row = captionEl.parentElement.getBoundingClientRect();
    const me = captionEl.getBoundingClientRect();
    return { cardW: Math.round(card.width), rowW: Math.round(row.width),
      overflowPx: Math.round(me.right - (card.right - 14)), captionH: Math.round(me.height) };
  };
  const fitDark = fitsIn();
  D.setTheme('light'); await sleep(350); await frame();
  const fitLight = fitsIn();
  D.setTheme('dark'); await sleep(350);
  click(tbBtn('Coordinate system & true north')); await sleep(300);

  /* 4. The property card on the reference wall: Length × Width from the file's own grid. */
  let wall = null;
  const want = REF && REF.samples ? REF.samples.IfcWall : null;
  if (want) {
    const el = fed.elements.find((e) => e.guid === want.guid);
    if (el) {
      D.select([el.id]); await sleep(700);
      // The Geometry section is collapsed by default, so its rows are not in the
      // DOM until its header is clicked — the same control a reader clicks.
      const head = [...document.querySelectorAll('span')].find((x) => txt(x) === 'Geometry');
      if (head) { head.parentElement.click(); await frame(); await frame(); await sleep(300); }
      const rows = {};
      for (const k of ['Bounding box', 'Base / top', 'Centroid']) {
        const label = [...document.querySelectorAll('span')].find((x) => txt(x) === k);
        rows[k] = label && label.nextElementSibling ? txt(label.nextElementSibling) : null;
      }
      const b = D.elementBox(el.id);
      wall = { guid: el.guid, name: el.name, rows,
        sceneBox: b ? b.map((v) => +v.toFixed(4)) : null,
        sizeM: b ? [b[3] - b[0], b[4] - b[1], b[5] - b[2]].map((v) => +v.toFixed(4)) : null,
        ifcOpenShellProjectSizeM: [want.projectBox[3] - want.projectBox[0],
          want.projectBox[4] - want.projectBox[1], want.projectBox[5] - want.projectBox[2]]
          .map((v) => +v.toFixed(4)),
        ifcOpenShellWorldSizeM: [want.worldBox[3] - want.worldBox[0],
          want.worldBox[4] - want.worldBox[1], want.worldBox[5] - want.worldBox[2]]
          .map((v) => +v.toFixed(4)) };
    }
  }

  /* 5. Spot coordinates on a vertex IfcOpenShell named, through the real spot record.
   *    Eight spots, one per corner of that element's project-frame box; one of them IS the
   *    vertex, and its E / N / Z must be the world coordinates IfcOpenShell computed. */
  let vertex = null;
  if (want && want.worldVertex) {
    const off = dbg().offset;
    const V = D.viewer.dev.annotations;
    const P = D.viewer.dev.camera().position.clone();
    const before = D.spots().length;
    const b = want.projectBox;
    for (const i of [0, 3]) for (const j of [1, 4]) for (const k of [2, 5]) {
      P.set(b[i] - off[0], b[j] - off[1], b[k] - off[2]);
      V.addSpot(P.clone());
    }
    await sleep(400);
    const spots = D.spots().slice(before);
    let best = null;
    for (const s of spots) {
      if (s.E == null) continue;
      const d = Math.hypot(s.E - want.worldVertex[0], s.N - want.worldVertex[1],
        s.Z - want.worldVertex[2]);
      if (!best || d < best.errorMm) best = { errorMm: d, E: s.E, N: s.N, Z: s.Z };
    }
    if (best) best.errorMm = +(best.errorMm * 1000).toFixed(3);
    vertex = { ifcOpenShell: want.worldVertex.map((v) => +v.toFixed(6)),
      spots: spots.length, nearest: best };
    for (const s of spots) D.viewer.dev.annotations.dropSpot(s.id);
    await sleep(200);
  }

  /* 6. The N / S / E / W views look along the grid. */
  const views = {};
  for (const [name, tip] of [['north', 'North elevation'], ['south', 'South elevation'],
    ['east', 'East elevation'], ['west', 'West elevation']]) {
    click(tbBtn(tip)); await sleep(1500);
    const d = dbg();
    const dir = [d.target[0] - d.cam[0], d.target[1] - d.cam[1]];
    const deg = ((((Math.atan2(dir[1], dir[0]) * 180) / Math.PI) % 180) + 180) % 180;
    views[name] = +(deg > 179.99 ? deg - 180 : deg).toFixed(3);
  }
  click(tbBtn('3D perspective (Home)')); await sleep(1400);
  D.select(null); await sleep(300);

  return JSON.stringify({
    method: REF && REF.georeference ? REF.georeference.source : null,
    frame: dbg().frame, offset: dbg().offset,
    gridFamilyDeg, rings, chip, caption, fields, fitDark, fitLight, wall, vertex, views
  });
})()`

/* ────────────────────────────── per-element boxes, on a real file ──────────────────────
 * 2026-09-20. `IfcElement.bbox` and `solidCount` used to be filled only by the dev mock, so on
 * a real model `measure_between` had nothing to measure with, the SQL `bbox` table was empty
 * and `get_element` reported no solid count while the property card showed one. Both are now
 * taken off the geometry stream's parts as the chunks land
 * (`renderer/model/element-boxes.ts`).
 *
 * Six readings, all on the real file:
 *   1. how many elements have a box, how many do not, and whether `SELECT COUNT(*) FROM bbox`
 *      agrees with the index;
 *   1b. the index's `solidCount` against `viewer.solidCount(id)` for **every** boxed element —
 *      the two numbers the assistant and the property card each show — plus the distribution,
 *      and that no element without geometry carries a count at all;
 *   2. `measure_between` through the **real executor**, cross-checked against the viewer's own
 *      `elementBox()` for the same two ids (scene coordinates, so the offset goes back on);
 *   3. one element per IfcOpenShell sample class: our project box against its exact one, in
 *      millimetres, and the same box carried to world coordinates through the project frame;
 *   4. `get_element`'s box report, including the map coordinates of its centre;
 *   5. a question the assistant would plausibly ask in SQL — the ten tallest elements by box
 *      height, with their entity and storey — and what it cost.
 * ──────────────────────────────────────────────────────────────────────────────────────── */
const BOXES = (reference) => `(async () => {
  ${ANN_HELPERS}
  const REF = ${JSON.stringify(reference)};
  const fed = D.federation();
  const dbg = D.debug();
  const off = dbg.offset;
  const projFrame = dbg.frame;
  const mm = (v) => Math.round(v * 1000);

  /* Project → world, the same rotation shared/georef.ts's toWorld applies. */
  const toWorld = (x, y, z) => {
    if (!projFrame) return [x, y, z];
    const a = (projFrame.rotationDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    return [projFrame.origin[0] + x * c - y * s, projFrame.origin[1] + x * s + y * c, projFrame.origin[2] + z];
  };
  /** The AABB of the eight project-frame corners taken to world — inflated by the rotation. */
  const worldBoxOf = (b) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const i of [0, 3]) for (const j of [1, 4]) for (const k of [2, 5]) {
      const p = toWorld(b[i], b[j], b[k]);
      for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); }
    }
    return [...lo, ...hi];
  };

  /* 1. Coverage — the index against the database. */
  const withBox = fed.elements.filter((e) => e.bbox);
  const t0 = performance.now();
  const count = await D.sql('SELECT COUNT(*) AS n FROM bbox');
  const countMs = +(performance.now() - t0).toFixed(1);
  const sane = await D.sql(
    'SELECT COUNT(*) AS n FROM bbox WHERE min_x <= max_x AND min_y <= max_y AND min_z <= max_z');
  const orphan = await D.sql(
    'SELECT COUNT(*) AS n FROM bbox LEFT JOIN element ON element.id = bbox.element WHERE element.id IS NULL');
  const coverage = {
    elements: fed.elements.length,
    withBox: withBox.length,
    withoutBox: fed.elements.length - withBox.length,
    sqlRows: count.rows[0][0],
    sqlSaneRows: sane.rows[0][0],
    sqlOrphanRows: orphan.rows[0][0],
    countMs
  };

  /* 1b. solidCount: the index against the viewer, for EVERY boxed element.
   * The property card shows viewer.solidCount(id) and get_element shows the index's own
   * number. One mismatch is one place the assistant and the card would disagree. */
  let mismatches = 0, zeros = 0, missing = 0, total = 0;
  let min = Infinity, max = -Infinity;
  const all = [];
  const examples = [];
  for (const e of withBox) {
    const mine = e.solidCount;
    const theirs = D.viewer.solidCount(e.id);
    if (mine === undefined || mine === null) { missing++; continue; }
    if (mine === 0) zeros++;
    if (mine !== theirs) {
      mismatches++;
      if (examples.length < 5) examples.push({ id: e.id, type: e.type, index: mine, viewer: theirs });
    }
    all.push(mine); total += mine; min = Math.min(min, mine); max = Math.max(max, mine);
  }
  all.sort((x, y) => x - y);
  // An element with no geometry must carry no count at all — never a zero placeholder.
  const noGeometryWithCount = fed.elements
    .filter((e) => !e.bbox && e.solidCount !== undefined).length;
  const solids = {
    checked: all.length, mismatches, missingCount: missing, zeroCounts: zeros,
    noGeometryWithCount,
    min: all.length ? min : null,
    median: all.length ? all[all.length >> 1] : null,
    max: all.length ? max : null,
    totalParts: total,
    examples
  };

  /* 2. measure_between, against the viewer's own box for the same two ids. */
  // Two real elements far enough apart to have a gap on every axis: the lowest-z and the
  // highest-z boxed element, which on any building is a foundation and a roof member.
  const byZ = [...withBox].sort((a, b) => a.bbox[2] - b.bbox[2]);
  const a = byZ[0], b = byZ[byZ.length - 1];
  const measured = await D.tool('measure_between', { a: a.id, b: b.id });
  const viewerBox = (e) => { const v = D.elementBox(e.id);
    return v ? [v[0] + off[0], v[1] + off[1], v[2] + off[2],
      v[3] + off[0], v[4] + off[1], v[5] + off[2]] : null; };
  const centre = (x) => [(x[0] + x[3]) / 2, (x[1] + x[4]) / 2, (x[2] + x[5]) / 2];
  const va = viewerBox(a), vb = viewerBox(b);
  const cross = va && vb
    ? (() => { const ca = centre(va), cb = centre(vb);
        return { viewerCentreToCentreM: +Math.hypot(cb[0] - ca[0], cb[1] - ca[1], cb[2] - ca[2]).toFixed(4),
          indexVsViewerMaxMm: Math.max(...a.bbox.map((v, i) => Math.abs(v - va[i])),
            ...b.bbox.map((v, i) => Math.abs(v - vb[i]))) * 1000 }; })()
    : null;
  const between = {
    a: { id: a.id, name: a.name, type: a.type },
    b: { id: b.id, name: b.name, type: b.type },
    centreToCentreM: +measured.centreToCentreMetres.toFixed(4),
    boxClearanceM: +measured.boxClearanceMetres.toFixed(4),
    boxGapM: Object.fromEntries(Object.entries(measured.boxGapMetres).map(([k, v]) => [k, +v.toFixed(4)])),
    boxesOverlap: measured.boxesOverlap,
    frame: measured.frame,
    message: measured.message,
    crossCheck: cross ? { ...cross, indexVsViewerMaxMm: +cross.indexVsViewerMaxMm.toFixed(3) } : null
  };

  /* 3. Against IfcOpenShell, per sample class. */
  const samples = [];
  for (const [cls, want] of Object.entries((REF && REF.samples) || {})) {
    if (!want.projectBox) continue;
    const el = fed.elements.find((e) => e.guid === want.guid);
    if (!el || !el.bbox) continue;
    samples.push({
      cls, guid: el.guid, id: el.id,
      projectBoxM: el.bbox.map((v) => +v.toFixed(4)),
      // Positive = our box is outside IfcOpenShell's on that face, i.e. conservative.
      projectSlackMm: el.bbox.map((v, i) => mm(i < 3 ? want.projectBox[i] - v : v - want.projectBox[i])),
      worldSlackMm: (() => { const w = worldBoxOf(el.bbox);
        return w.map((v, i) => mm(i < 3 ? want.worldBox[i] - v : v - want.worldBox[i])); })()
    });
  }

  /* 4. get_element's own box report. */
  const wall = (REF && REF.samples && REF.samples.IfcWall)
    ? fed.elements.find((e) => e.guid === REF.samples.IfcWall.guid) : null;
  const record = wall ? await D.tool('get_element', { id: wall.id }) : null;
  const element = record ? {
    id: record.id, name: record.name, type: record.type,
    bboxFrame: record.bboxFrame,
    boxSizeM: Object.fromEntries(Object.entries(record.boxSizeMetres).map(([k, v]) => [k, +v.toFixed(4)])),
    boxVolumeM3: +record.boxVolumeM3.toFixed(4),
    boxCentreM: Object.fromEntries(Object.entries(record.boxCentreMetres).map(([k, v]) => [k, +v.toFixed(3)])),
    boxCentreMap: record.boxCentreMap
      ? Object.fromEntries(Object.entries(record.boxCentreMap).map(([k, v]) => [k, +v.toFixed(3)]))
      : null,
    boxMethod: record.boxMethod,
    // What get_element says, what the viewer says, and what the property card's own row
    // renders from it — three readings of one number.
    solidCount: record.solidCount,
    viewerSolidCount: D.viewer.solidCount(wall.id),
    cardGeometryRow: (() => {
      const n = D.viewer.solidCount(wall.id);
      return n + ' solid' + (n === 1 ? '' : 's');
    })(),
    solidCountMethod: record.solidCountMethod
  } : null;

  /* 5. The question the assistant would ask. */
  const t1 = performance.now();
  const tallest = await D.sql(
    'SELECT element.type, element.storey, element.name, ' +
    'ROUND(bbox.max_z - bbox.min_z, 3) AS height_m ' +
    'FROM bbox JOIN element ON element.id = bbox.element ' +
    'ORDER BY height_m DESC LIMIT 10');
  const tallestMs = +(performance.now() - t1).toFixed(1);

  return JSON.stringify({ coverage, solids, between, samples, element,
    tallest: { columns: tallest.columns, rows: tallest.rows, ms: tallestMs } });
})()`

/* ────────────────────────────── Phase 7, on a real index ──────────────────────────────
 * Colour by property at a real size. The mock federation has 412 elements and ten entity
 * types; this file has tens of thousands and a property-set vocabulary the design's model
 * cannot produce, which is the only place the `SCHEME[i % 11]` wrap and the cost of writing a
 * colour for every element are actually exercised.
 *
 * The pset key is **discovered from the file**, not named: the widest-spread key that is not
 * one of the seven named attributes. Nothing here is sized to a particular model.
 * ──────────────────────────────────────────────────────────────────────────────────────── */
const COLORS = `(async () => {
  ${ANN_HELPERS}
  const fed = D.federation();
  const legendBox = () => $$('div').filter((e) => { const c = getComputedStyle(e);
    return c.position === 'absolute' && c.zIndex === '11'; }).pop();
  const legendRows = () => { const b = legendBox(); return !b ? [] :
    [...b.querySelectorAll('button[data-tip="Select these elements"]')]
      .map((x) => (x.innerText || '').replace(/\\s+/g, ' ').trim()); };
  // Click to painted frame, the same measurement Phase 5's filter block makes.
  const apply = async (prop) => {
    const t0 = performance.now();
    const scheme = D.colorBy(prop);
    await frame(); const painted = await frame();
    await sleep(500);
    return { prop, groups: scheme ? scheme.groups.length : 0,
      coloured: scheme ? scheme.groups.reduce((a, g) => a + g.n, 0) : 0,
      top: scheme ? scheme.groups.slice(0, 5).map((g) => g.v + ' ' + g.n) : [],
      applyMs: +(painted - t0).toFixed(1), rows: legendRows().length,
      legendTop: legendRows().slice(0, 3) };
  };
  // The key the most elements carry, across every pset and qto — read from the file.
  const spread = new Map();
  for (const e of fed.elements) {
    const seen = new Set();
    for (const bag of [e.psets, e.qto]) for (const p of Object.values(bag)) {
      for (const k of Object.keys(p)) if (!seen.has(k)) { seen.add(k); spread.set(k, (spread.get(k) || 0) + 1); }
    }
  }
  const psetKey = [...spread.entries()].sort((a, b) => b[1] - a[1])[0];
  const byEntity = await apply('IfcEntity');
  const byPset = psetKey ? await apply(psetKey[0]) : null;
  // fps while orbiting with the scheme live, then the legend's own × clears it.
  await D.spin(4);
  await sleep(400);
  const spinning = { stats: D.stats(), calls: D.debug().calls };
  const x = [...(legendBox() ? legendBox().querySelectorAll('button') : [])]
    .find((b) => b.title === 'Clear colour scheme');
  const t0 = performance.now();
  click(x);
  await frame(); const painted = await frame();
  await sleep(500);
  return JSON.stringify({ elements: fed.elements.length, propKeys: fed.propKeys.length,
    psetKey: psetKey ? { key: psetKey[0], carriedBy: psetKey[1] } : null,
    byEntity, byPset, spinning,
    clearMs: +(painted - t0).toFixed(1), clearedRows: legendRows().length,
    stats: D.stats(), debug: D.debug() });
})()`

/** What the committed measurement reads, against what the element says it is. */
const ANN_LASER_READ = (id) => `(async () => {
  ${ANN_HELPERS}
  await sleep(600);
  const list = D.measures();
  const el = D.federation().byId.get(${id});
  await D.spin(3);
  await sleep(500);
  return JSON.stringify({ measures: list,
    qtoDepthMM: el && el.qto && el.qto.Qto_SlabBaseQuantities
      ? el.qto.Qto_SlabBaseQuantities.Depth : null,
    boxThicknessMM: (() => { const b = D.elementBox(${id});
      return b ? +((b[5] - b[2]) * 1000).toFixed(1) : null; })(),
    stats: D.stats(), annotations: D.debug().annotations,
    calls: D.debug().calls, hoverMs: D.debug().hoverMs });
})()`

/* ────────────────────────────── two pictures, for the eye ──────────────────────────────
 * The frame block above answers in numbers. This one answers the question the user actually
 * asked — *does it look right?* — with two captures of the real model: the Plan with its grid
 * bubbles, level rings and the Coordinate-system card, and the default 3D with one laser
 * measurement on the building.
 *
 * Nothing here is measured; it exists so a reviewer can look. Run it with `SGVUE_ONLY=shots`.
 * ──────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Wait until the scene has stopped moving, then let two more frames land.
 *
 * The renderer draws **on demand** (2026-09-19), so a capture is not a re-render: it returns
 * whatever the compositor last got. A camera flight eases in, the occlusion sweep settles the
 * grid bubbles one frame after the camera arrives, and the DOM labels are placed in that same
 * frame — so the capture has to follow the last invalidation, not merely a fixed sleep. The
 * camera's own pose is the thing to watch: `cam.tick` snaps onto its goal within a microradian.
 */
const SETTLE = `(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const D = window.__sgvueDev;
  const pose = () => { const d = D.debug(); return JSON.stringify([d.cam, d.target, d.dist, d.half]); };
  let last = pose(), still = 0, waited = 0;
  // 8 s is far longer than any flight; it is a cap, not a wait.
  while (still < 6 && waited < 8000) {
    await frame(); await new Promise((r) => setTimeout(r, 50));
    waited += 50;
    const now = pose();
    still = now === last ? still + 1 : 0;
    last = now;
  }
  // The sweep that hides an occluded bubble runs the frame after the camera stops; these two
  // are the frame that does it and the frame that shows the result.
  await frame(); await frame();
  return JSON.stringify({ settledAfterMs: waited, labels: D.debug().labels });
})()`

/** Plan, grids and levels on, the Coordinate-system card open. */
const SHOT_PLAN = `(async () => {
  ${ANN_HELPERS}
  D.select(null);
  if (!D.debug().annotations.grids) { click(tbBtn('Gridlines (G)')); await sleep(400); }
  if (!D.debug().annotations.levels) { click(tbBtn('Levels (L)')); await sleep(400); }
  const card = () => laneCards().find((e) => /^Coordinate system/.test(txt(e)));
  if (!card()) { click(tbBtn('Coordinate system & true north')); await sleep(400); }
  click(tbBtn('Plan')); await sleep(600);
  return JSON.stringify({ view: 'plan', grids: D.debug().annotations.grids,
    levels: D.debug().annotations.levels, rings: D.debug().annotations.levelRings,
    bubbles: shown(bubbles()).length + ' of ' + bubbles().length,
    card: !!card() });
})()`

/** Back to the default 3D, the card closed, the laser tool armed. Returns the viewport. */
const SHOT_ISO_PREP = `(async () => {
  ${ANN_HELPERS}
  const card = () => laneCards().find((e) => /^Coordinate system/.test(txt(e)));
  if (card()) { click(tbBtn('Coordinate system & true north')); await sleep(400); }
  click(tbBtn('3D perspective (Home)')); await sleep(1600);
  click($('button[data-tip^="Laser meter"]')); await sleep(300);
  const r = $('[data-role="viewport"]').getBoundingClientRect();
  return JSON.stringify({ viewport: [Math.round(r.x), Math.round(r.y),
    Math.round(r.width), Math.round(r.height)] });
})()`

/** Drop the pointer and go back to select, so only the committed reading is drawn. */
const SHOT_ISO_DONE = `(async () => {
  ${ANN_HELPERS}
  D.setTool('select');
  await sleep(400);
  // The level tags as drawn, read off the overlay by the storey names the ladder uses. They
  // print the storey's AUTHORED elevation, so these must be the ladder's own numbers — the
  // federation offset must not appear in them.
  const names = new Set(D.federation().storeys.map((s) => s.name));
  const ov = $('[data-role="overlay"]');
  const tags = !ov ? [] : [...ov.children]
    .map((e) => (e.innerText || '').replace(/\\s+/g, ' ').trim())
    .filter((t) => [...names].some((n) => t.startsWith(n + ' ')));
  return JSON.stringify({ measures: D.measures(), rings: D.debug().annotations.levelRings,
    grids: D.debug().annotations.grids, levels: D.debug().annotations.levels,
    levelTags: tags,
    ladder: D.federation().storeys.map((s) => s.name + ' ' + s.elev) });
})()`

/**
 * Every bubble the overlay is actually drawing, with its box — the declutter sweep's answer as
 * the viewer sees it, not as the code claims it. `BUBBLES(n)` also dollies in by `n`, so the
 * same readout shows the hidden ones coming back.
 */
const BUBBLES = (zoom) => `(async () => {
  ${ANN_HELPERS}
  // Always from the pose the sweep started at, never from the last one — compounding the
  // factor dollies straight past the grid and every bubble leaves the frame.
  const base = window.__sgvueBubbleBase || D.viewer.getCamera();
  window.__sgvueBubbleBase = base;
  D.viewer.setCamera({ ...base, dist: base.dist / ${zoom}, half: base.half / ${zoom} });
  await sleep(1800);
  await frame(); await frame();
  const all = bubbles();
  const vis = all.filter((e) => getComputedStyle(e).display !== 'none')
    .map((e) => { const b = e.getBoundingClientRect();
      return { name: txt(e), left: +b.left.toFixed(1), top: +b.top.toFixed(1),
        right: +b.right.toFixed(1), bottom: +b.bottom.toFixed(1) }; });
  // Every visible pair, in screen space. One intersection is a defect.
  let clashes = 0, worst = null;
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
    const a = vis[i], b = vis[j];
    if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
      clashes++; if (!worst) worst = [a.name, b.name];
    }
  }
  const numbered = vis.filter((v) => /^[0-9]+$/.test(v.name)).map((v) => v.name);
  const numberedAxes = new Set(D.federation().grids.map((g) => g.name).filter((n) => /^[0-9]+$/.test(n)));
  // What the SWEEP is hiding, as opposed to what is simply off screen: \`crowded\` is set only
  // for a bubble the sweep itself dropped this frame.
  // Bubbles only: a grid-dimension label (\`declutter.after\`) is decided by the same sweep.
  const marks = D.viewer.dev.overlay.labels.filter((x) => x.declutter && !x.declutter.after);
  const numberedMarks = marks.filter((x) => /^[0-9]+$/.test((x.el.textContent || '').trim()));
  const crowded = marks.filter((x) => x.crowded).length;
  const crowdedNumbered = numberedMarks.filter((x) => x.crowded).length;
  return JSON.stringify({ zoom: ${zoom}, dist: +(base.dist / ${zoom}).toFixed(1),
    drawn: vis.length, of: all.length, clashes, worst,
    numberedVisible: [...new Set(numbered)].length, numberedAxes: numberedAxes.size,
    hiddenBySweep: crowded, numberedHiddenBySweep: crowdedNumbered,
    names: vis.map((v) => v.name).join(' ') });
})()`

/**
 * The sidebar's own vertical budget — the 40 % split (2026-09-20).
 *
 * With twelve storeys the STOREYS block used to take most of the aside and leave the element
 * tree two rows, because the design's aside is a column flexbox in which the tree is the only
 * thing that can give. This reads the shares straight out of the DOM, at whatever window size
 * the run is using, and checks that nothing spills past the aside.
 */
const SIDEBAR = `((restoreOld) => {
  ${ANN_HELPERS}
  const aside = [...document.querySelectorAll('aside')][0];
  const tree = document.querySelector('[role="tree"]');
  const storeyEyes = $$('button').filter((b) => b.title === 'Show / hide storey');
  // The wrapper is the nearest ancestor of the first row that contains every row — a model
  // row is nested one deeper than a storey row, so counting parents would read the wrong box.
  const wrapperOf = (els) => { let n = els[0].parentElement;
    while (n && !els.every((e) => n.contains(e))) n = n.parentElement; return n; };
  const rowsBox = storeyEyes.length ? wrapperOf(storeyEyes) : null;
  const modelEyes = $$('button').filter((b) => b.title === 'Show / hide model');
  // With a single model the containment walk stops at the row, so the MODELS wrapper is found
  // by the one thing only it carries: the design's own \`position:relative\` (\`:98\`).
  const modelBox = modelEyes.length
    ? modelEyes[0].closest('div[style*="position: relative"]') || wrapperOf(modelEyes)
    : null;
  const box = (e) => { const r = e.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }; };
  const a = box(aside), t = box(tree);
  // A row counts as visible when its whole box is inside its scroller.
  const fully = (rows, scroller) => { const s = scroller.getBoundingClientRect();
    return rows.filter((e) => { const r = e.getBoundingClientRect();
      return r.top >= s.top - 0.5 && r.bottom <= s.bottom + 0.5; }).length; };
  const treeRows = $$('[role="treeitem"]');
  const storeyRows = storeyEyes.map((b) => b.parentElement);
  // What the same window showed before the split: put the design's own two declarations back
  // for one measurement, then undo it. This is the number the user was looking at.
  let before = null;
  if (restoreOld && rowsBox) {
    const keep = [tree.style.minHeight, rowsBox.style.cssText];
    tree.style.minHeight = '0px';
    rowsBox.style.flex = '';
    rowsBox.style.minHeight = '';
    rowsBox.style.overflow = 'visible';
    void tree.offsetHeight;
    const keepModel = modelBox ? modelBox.style.cssText : null;
    if (modelBox) { modelBox.style.flex = ''; modelBox.style.overflow = 'visible'; }
    void tree.offsetHeight;
    before = { tree: box(tree).h, treeShare: +(box(tree).h / a.h).toFixed(3),
      treeRowsFullyVisible: fully(treeRows, tree),
      storeyBox: box(rowsBox).h, storeysFullyVisible: fully(storeyRows, rowsBox),
      // The geometry the MODELS rows must come back to exactly: no gutter, no shift.
      modelRowW: modelEyes.length ? +modelEyes[0].parentElement.getBoundingClientRect().width.toFixed(2) : null,
      modelRowRight: modelEyes.length ? +modelEyes[0].parentElement.getBoundingClientRect().right.toFixed(2) : null };
    if (modelBox && keepModel !== null) modelBox.style.cssText = keepModel;
    tree.style.minHeight = keep[0];
    rowsBox.style.cssText = keep[1];
    void tree.offsetHeight;
  }
  return JSON.stringify({
    before,
    window: [window.innerWidth, window.innerHeight],
    aside: a.h, tree: t.h, treeShare: +(t.h / a.h).toFixed(3),
    storeyBox: rowsBox ? box(rowsBox).h : null,
    storeyScrollH: rowsBox ? rowsBox.scrollHeight : null,
    storeyScrolls: rowsBox ? rowsBox.scrollHeight > rowsBox.clientHeight + 1 : null,
    // Everything that cannot give: the header, the search, MODELS and the two section titles.
    rigid: rowsBox ? a.h - t.h - box(rowsBox).h : null,
    modelClient: modelBox ? modelBox.clientHeight : null,
    modelScrollH: modelBox ? modelBox.scrollHeight : null,
    // Exact, not "within a pixel": a gutter is what a leaked fraction of a pixel produces.
    modelExact: modelBox ? modelBox.clientHeight === modelBox.scrollHeight : null,
    modelRowW: modelEyes.length ? +modelEyes[0].parentElement.getBoundingClientRect().width.toFixed(2) : null,
    modelRowRight: modelEyes.length ? +modelEyes[0].parentElement.getBoundingClientRect().right.toFixed(2) : null,
    asideOverflows: aside.scrollHeight > aside.clientHeight + 1,
    models: $$('button').filter((b) => b.title === 'Show / hide model').length,
    storeys: storeyRows.length, storeysFullyVisible: rowsBox ? fully(storeyRows, rowsBox) : 0,
    treeRows: treeRows.length, treeRowsFullyVisible: fully(treeRows, tree),
    // Nothing may hang out of the aside.
    overflowPx: Math.max(0, Math.round(box(tree).bottom - a.bottom)),
    lastChildBottom: Math.round(box(aside.lastElementChild).bottom - a.bottom)
  });
})`

/** Scroll the storey list to its end, then solo the bottom storey and the top one. */
const SIDEBAR_SOLO = `(async () => {
  ${ANN_HELPERS}
  const eyes = () => $$('button').filter((b) => b.title === 'Show / hide storey');
  const rowsBox = eyes()[0].parentElement.parentElement;
  const status = () => txt(document.querySelector('[data-role="statusbar"]'));
  rowsBox.scrollTop = rowsBox.scrollHeight;
  await sleep(300);
  const atEnd = rowsBox.scrollTop + rowsBox.clientHeight >= rowsBox.scrollHeight - 1;
  const lastRow = eyes()[eyes().length - 1].parentElement;
  const lastName = txt(lastRow.children[1]);
  lastRow.click(); await sleep(700);
  const soloLast = { name: lastName, status: status() };
  lastRow.click(); await sleep(500);
  // …and the first one, from the top of the same scroller.
  rowsBox.scrollTop = 0;
  await sleep(300);
  const firstRow = eyes()[0].parentElement;
  const firstName = txt(firstRow.children[1]);
  firstRow.click(); await sleep(700);
  const soloFirst = { name: firstName, status: status() };
  firstRow.click(); await sleep(500);
  // Keyboard: focus the last storey's eye and check the scroller brought it into view.
  rowsBox.scrollTop = 0; await sleep(200);
  const lastEye = eyes()[eyes().length - 1];
  lastEye.focus(); await sleep(250);
  const r = lastEye.getBoundingClientRect(), b = rowsBox.getBoundingClientRect();
  return JSON.stringify({ scrolledToEnd: atEnd, soloLast, soloFirst,
    focusScrolledIntoView: r.top >= b.top - 1 && r.bottom <= b.bottom + 1,
    scrollTopAfterFocus: Math.round(rowsBox.scrollTop) });
})()`

/**
 * Orbit slowly and count how often a bubble changes state.
 *
 * The sweep is deterministic given the rects, and the rects move smoothly, so a bubble whose
 * pitch crosses the threshold should flip **once** and stay — that is the reappearance the
 * user asked for. Flicker would be the same bubble toggling over and over on sub-pixel
 * jitter, and it is the only thing that would justify carrying hysteresis through the
 * previous frame's answer.
 */
const BUBBLE_FLICKER = `(async () => {
  ${ANN_HELPERS}
  const base = D.viewer.getCamera();
  const seen = new Map();
  const flips = new Map();
  const t0 = performance.now();
  let frames = 0;
  while (performance.now() - t0 < 4000) {
    const t = (performance.now() - t0) / 1000;
    D.viewer.setCamera({ ...base, theta: base.theta + t * 0.12 });
    await frame();
    frames++;
    for (const e of bubbles()) {
      const on = getComputedStyle(e).display !== 'none';
      const k = txt(e) + '@' + Math.round(e.getBoundingClientRect().top / 1000);
      const was = seen.get(k);
      if (was !== undefined && was !== on) flips.set(k, (flips.get(k) || 0) + 1);
      seen.set(k, on);
    }
  }
  D.viewer.setCamera(base);
  await sleep(900);
  const counts = [...flips.values()];
  return JSON.stringify({ frames, bubblesTracked: seen.size,
    everFlipped: counts.length, totalFlips: counts.reduce((a, b) => a + b, 0),
    maxFlipsForOneBubble: counts.length ? Math.max(...counts) : 0 });
})()`

/**
 * The Section card's "Along a gridline" chips, in the order the card renders them.
 *
 * The design fills them from the federation's grid list (`SGVue.dc.html:1994`); a Revit export
 * lists its axes in creation order, so on this model the first U axis is `L` and the first V
 * axis is `22`. `shared/federate.ts` orders that list now, and this reads back what the card
 * actually draws — then clicks one chip to prove the cut still follows it.
 */
const SECTION_CHIPS = `(async () => {
  ${ANN_HELPERS}
  D.select(null);
  if (!secCard()) { click(tbBtn('Section from gridline / level')); await sleep(600); }
  const names = new Set(D.federation().grids.map((g) => g.name));
  // The gridline block only (2026-10-01): a storey may be named like a grid.
  const block = secCard().querySelector('[role="group"][aria-label="Along a gridline"]');
  const chips = [...block.querySelectorAll('button')].filter((b) => names.has(txt(b)));
  const order = chips.map(txt);
  // The chips must be exactly the federation's list, in its order.
  const federationOrder = D.federation().grids.map((g) => g.name);
  // One chip row a grid family, a rule between two of them.
  const rows = [...block.children].filter((e) => e.tagName === 'DIV' &&
    [...e.children].some((b) => b.tagName === 'BUTTON' && names.has(txt(b))));
  const rules = [...block.children].filter((e) => e.getAttribute('aria-hidden') === 'true').length;
  const pick = chips[Math.floor(chips.length / 2)];
  const picked = txt(pick);
  const t0 = performance.now();
  click(pick);
  await frame(); const painted = await frame();
  await sleep(1000);
  return JSON.stringify({ chips: order.length, order: order.join(' '),
    matchesFederation: JSON.stringify(order) === JSON.stringify(federationOrder),
    families: rows.map((r) => r.children.length), rules,
    clicked: picked, applyMs: +(painted - t0).toFixed(1),
    section: D.debug().section, planes: planes() });
})()`

/** Click the first bubble the overlay is drawing, and report whether the Section card opened. */
const BUBBLE_CLICK = `(async () => {
  ${ANN_HELPERS}
  const vis = bubbles().filter((e) => getComputedStyle(e).display !== 'none');
  if (!vis.length) return JSON.stringify({ error: 'no bubble drawn' });
  const name = txt(vis[0]);
  vis[0].click();
  await sleep(700);
  const card = laneCards().find((e) => /^Section/.test(txt(e)));
  return JSON.stringify({ clicked: name, sectionCardOpened: !!card,
    section: D.debug().section });
})()`

/**
 * Move the pointer over the viewport until the live laser preview actually reads, and return
 * where that was. Lifted out of the `annotate` block below, which is its other caller: aiming
 * at a chosen element's AABB side face does not work on this model (the biggest slab is a
 * 700 mm floor 167 m across whose outline has a 1 547 m perimeter, so three of its four side
 * faces are in open air), so the probe reads the preview instead and takes the first point
 * that has one.
 */
async function findLaserPoint(win, js, viewport) {
  const wc = win.webContents
  const [vx, vy, vw, vh] = viewport
  const cx = Math.round(vx + vw / 2)
  const cy = Math.round(vy + vh / 2)
  const probe = async (x, y) => {
    wc.sendInputEvent({ type: 'mouseMove', x: x - 4, y: y - 4 })
    await wait(90)
    wc.sendInputEvent({ type: 'mouseMove', x, y })
    await wait(240)
    return JSON.parse(await js(ANN_PROBE))
  }
  let landed = null
  let fallback = null
  for (let iy = -2; iy <= 2 && !landed; iy++) {
    for (let ix = -3; ix <= 3 && !landed; ix++) {
      const x = cx + ix * Math.round(vw * 0.12)
      const y = cy + iy * Math.round(vh * 0.14)
      const at = await probe(x, y)
      const rays = (at.preview || []).length
      if (rays >= 3) landed = { x, y, ...at }
      else if (rays >= 2 && !fallback) fallback = { x, y, ...at }
    }
  }
  return landed || fallback
}

app.whenReady().then(async () => {
  protocol.handle('sgvue-file', () => net.fetch(pathToFileURL(MODEL).toString()))
  const win = new BrowserWindow({
    width: SIZE[0],
    height: SIZE[1],
    useContentSize: true,
    frame: true,
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
  win.webContents.on('console-message', (e) => console.log(`[renderer] ${e.message}`))
  await win.loadFile(join(ROOT, 'out/renderer/index.html'), HASH ? { hash: HASH } : undefined)
  win.webContents.enableDeviceEmulation({
    screenPosition: 'desktop',
    screenSize: { width: SIZE[0], height: SIZE[1] },
    viewSize: { width: SIZE[0], height: SIZE[1] },
    deviceScaleFactor: 1,
    viewPosition: { x: 0, y: 0 },
    scale: 1
  })
  await wait(2500)

  const js = (code) => win.webContents.executeJavaScript(code)
  if (!(await js('!!window.__sgvueDev'))) {
    console.log('no __sgvueDev — rebuild with VITE_SGVUE_DEVTOOLS=1')
    return app.exit(1)
  }

  const t0 = Date.now()
  if (MOCK) {
    // `#mock` loads the federation during start-up; by now it is already in the batches.
    await js(`window.__sgvueDev.elementIds().length`)
  } else {
    await js(
      `window.__sgvueDev.open('sgvue-file://model/${encodeURIComponent(basename(MODEL))}', ${JSON.stringify(basename(MODEL))})`
    )
  }
  console.log(`load to first frame  ${((Date.now() - t0) / 1000).toFixed(2)} s`)
  guard.sample('loaded')
  await wait(1500)

  const readout = JSON.parse(await js(READOUT))
  console.log('header  ', readout.header)
  console.log('models  ', readout.models)
  console.log(`storeys (${readout.storeys.length})`)
  for (const s of readout.storeys) console.log('   ', s)
  console.log(`groups  (${readout.groups.length}):`, readout.groups.join('  ·  '))
  console.log('status  ', readout.status)

  await writeFile(OUT, (await win.webContents.capturePage()).toPNG())
  console.log(`saved ${OUT}`)

  if (wants('expand')) {
    console.log('expand  ', await js(EXPAND))
    await wait(400)
    const expanded = OUT.replace(/\.png$/, '-expanded.png')
    await writeFile(expanded, (await win.webContents.capturePage()).toPNG())
    console.log(`saved ${expanded}`)
  }

  // Phase 4: the property card on a real element.
  if (wants('card')) {
    const card = JSON.parse(await js(CARD))
    const { lines, ...card0 } = card
    console.log('card    ', JSON.stringify(card0))
    for (const line of lines || []) console.log('    ', line)
    await wait(300)
    const cardShot = OUT.replace(/\.png$/, '-card.png')
    await writeFile(cardShot, (await win.webContents.capturePage()).toPNG())
    console.log(`saved ${cardShot}`)
  }

  // Phase 5: the filter card on a real federation.
  if (wants('filter')) {
    await js(`window.__sgvueDev.select(null)`)
    await wait(400)
    const filter = JSON.parse(await js(FILTER))
    console.log('filter  ', JSON.stringify({ storey: filter.storey, storeyCount: filter.storeyCount }))
    console.log('  isolate  ', JSON.stringify(filter.isolate))
    console.log('  highlight', JSON.stringify(filter.highlight))
    console.log('  stats    ', JSON.stringify(filter.stats))
    console.log('  visible  ', filter.debug.visible, 'of', filter.debug.elements, '· calls', filter.debug.calls)
    guard.sample('filter')
    await wait(300)
    const filterShot = OUT.replace(/\.png$/, '-filter.png')
    await writeFile(filterShot, (await win.webContents.capturePage()).toPNG())
    console.log(`saved ${filterShot}`)
  }

  const shot = async (suffix) => {
    const path = OUT.replace(/\.png$/, `-${suffix}.png`)
    await writeFile(path, (await win.webContents.capturePage()).toPNG())
    console.log(`saved ${path}`)
  }

  // Phase 6: gridlines on a rotated grid, two section planes and one laser measurement.
  if (wants('annotate')) {
  const grids = JSON.parse(await js(ANN_GRIDS))
  console.log('grids   ', JSON.stringify(grids))
  await wait(300)
  await shot('grids')

  const secGrid = JSON.parse(await js(ANN_SECTION_GRID))
  console.log('section grid ', JSON.stringify(secGrid))
  await wait(300)
  await shot('section-grid')

  const secLevel = JSON.parse(await js(ANN_SECTION_LEVEL))
  console.log('section level', JSON.stringify(secLevel))
  await wait(300)
  await shot('section-level')

  const prep = JSON.parse(await js(ANN_LASER_PICK))
  console.log('laser target ', JSON.stringify(prep))
  if (!prep.error) {
    const wc = win.webContents
    console.log('laser aim', await js(ANN_LASER_AIM))
    // A coarse grid over the middle of the viewport. The first point whose live preview reads
    // all three axes wins; a point that reads two is kept as the fallback.
    const landed = await findLaserPoint(win, js, prep.viewport)
    if (!landed) {
      console.log('laser   ', JSON.stringify({ error: 'no probe point produced a reading' }))
    } else {
      console.log('laser at ', JSON.stringify(landed))
      wc.sendInputEvent({ type: 'mouseDown', x: landed.x, y: landed.y, button: 'left', clickCount: 1 })
      wc.sendInputEvent({ type: 'mouseUp', x: landed.x, y: landed.y, button: 'left', clickCount: 1 })
      await wait(700)
      await shot('laser')
      const laser = JSON.parse(await js(ANN_LASER_READ(landed.hovered)))
      console.log('laser   ', JSON.stringify(laser))
    }
  }
  guard.sample('annotate')
  }

  // 2026-09-20: the project frame. Grid families, level rings, the card and its caption, the
  // property card's own dimensions, a spot on a vertex IfcOpenShell named, the elevations.
  if (wants('frame')) {
    await js(`window.__sgvueDev.select(null)`)
    await wait(300)
    const f = JSON.parse(await js(FRAME(REFERENCE)))
    console.log('frame   ', JSON.stringify({ frame: f.frame, offset: f.offset }))
    console.log('  grid families', JSON.stringify(f.gridFamilyDeg), '(project degrees, mod 180)')
    for (const r of f.rings) console.log('  ring', JSON.stringify(r))
    console.log('  card chip   ', JSON.stringify(f.chip))
    console.log('  card caption', JSON.stringify(f.caption))
    console.log('  card fields ', JSON.stringify(f.fields))
    console.log('  caption fits', JSON.stringify({ dark: f.fitDark, light: f.fitLight }))
    console.log('  wall        ', JSON.stringify(f.wall))
    console.log('  vertex      ', JSON.stringify(f.vertex))
    console.log('  elevations  ', JSON.stringify(f.views))
    guard.sample('frame')
    await wait(300)
    await js(`window.__sgvueDev.viewer.setView('iso')`)
    await wait(1200)
    await shot('frame')
    // The card itself, in both themes: the caption is the one visible addition in the port.
    const openCard = `(() => { document.querySelector(
      'button[data-tip="Coordinate system & true north"]').click(); return 1 })()`
    await js(openCard)
    await wait(700)
    await shot('coords-dark')
    await js(`window.__sgvueDev.setTheme('light')`)
    await wait(800)
    await shot('coords-light')
    await js(`window.__sgvueDev.setTheme('dark')`)
    await wait(500)
    await js(openCard)
    await wait(300)
  }

  // 2026-09-20: one bounding box per element, on a real file — the coverage, the two tools
  // that read it, IfcOpenShell's own numbers, and the SQL table the assistant queries.
  // Read-only throughout: nothing here selects, hides or moves anything.
  if (wants('boxes')) {
    const bx = JSON.parse(await js(BOXES(REFERENCE)))
    console.log('boxes   ', JSON.stringify(bx.coverage))
    console.log('  solidCount vs viewer', JSON.stringify(bx.solids))
    console.log('  measure_between', JSON.stringify(bx.between))
    for (const s of bx.samples) console.log('  vs IfcOpenShell', JSON.stringify(s))
    console.log('  get_element    ', JSON.stringify(bx.element))
    console.log(`  tallest by box height (${bx.tallest.ms} ms):`, bx.tallest.columns.join(' · '))
    for (const row of bx.tallest.rows) console.log('   ', JSON.stringify(row))
    guard.sample('boxes')
  }

  // 2026-09-20: two pictures for the reviewer's eye. Nothing measured — the `frame` block
  // above does that; this is "does it look right?", which is what the user actually asked.
  if (wants('shots')) {
    console.log('plan    ', await js(SHOT_PLAN))
    console.log('  settle', await js(SETTLE))
    await shot('plan')
    // The declutter sweep, as the overlay actually drew it: zero intersections among the
    // bubbles on screen, and the hidden ones coming back as the view dollies in.
    // Dollying in widens the pitch in pixels, so the hidden bubbles come back — until the
    // row itself starts leaving the viewport, which is the pre-existing off-screen rule and
    // not the sweep. 24 axes need 23 × 28 px = 644 px of row to all clear the gap.
    for (const zoom of [1, 1.4, 1.8, 2.2, 2.6]) {
      console.log('  bubbles', await js(BUBBLES(zoom)))
      if (zoom === 1) await shot('plan-declutter')
    }
    await js(`window.__sgvueDev.viewer.zoomExtents()`)
    await wait(1800)
    console.log('  flicker', await js(BUBBLE_FLICKER))
    // The sidebar's 40 % split, at this window and at the launch size 1280 × 820.
    // The Section card's gridline chips, in the order the card draws them.
    console.log('  chips  ', await js(SECTION_CHIPS))
    await wait(400)
    await shot('card')
    await js(`(() => { const b = [...document.querySelectorAll('button')]
      .find((x) => (x.textContent || '').trim() === 'Clear all'); if (b) b.click(); return 1 })()`)
    await wait(700)
    await js(`document.querySelector('button[data-tip="Section from gridline / level"]').click()`)
    await wait(400)
    console.log('  sidebar', await js(SIDEBAR + '(true)'))
    // The launch size, which is the smallest the app ever opens at. Device emulation is what
    // fixes the viewport in this harness, so it is what has to be re-issued.
    const emulate = (w, h) =>
      win.webContents.enableDeviceEmulation({
        screenPosition: 'desktop',
        screenSize: { width: w, height: h },
        viewSize: { width: w, height: h },
        deviceScaleFactor: 1,
        viewPosition: { x: 0, y: 0 },
        scale: 1
      })
    emulate(1280, 820)
    await wait(800)
    console.log('  sidebar@1280x820', await js(SIDEBAR + '(true)'))
    console.log('  storeys', await js(SIDEBAR_SOLO))
    await wait(400)
    await shot('storeys')
    // Shorter than the app ever opens, to find where the budget runs out. The multi-model
    // half of the extreme is read from the mock federation, which has four models
    // (`SGVUE_IFC=mock SGVUE_ONLY=shots`); `rigid` below is what makes the two combine.
    for (const h of [860, 720, 620, 520]) {
      emulate(1280, h)
      await wait(700)
      console.log(`  sidebar@1280x${h}`, await js(SIDEBAR + '(false)'))
    }
    emulate(SIZE[0], SIZE[1])
    await wait(700)
    console.log('  click  ', await js(BUBBLE_CLICK))
    await wait(400)

    const prep = JSON.parse(await js(SHOT_ISO_PREP))
    const landed = await findLaserPoint(win, js, prep.viewport)
    if (!landed) {
      console.log('iso     ', JSON.stringify({ warning: 'no probe point produced a laser reading' }))
    } else {
      const wc = win.webContents
      wc.sendInputEvent({ type: 'mouseDown', x: landed.x, y: landed.y, button: 'left', clickCount: 1 })
      wc.sendInputEvent({ type: 'mouseUp', x: landed.x, y: landed.y, button: 'left', clickCount: 1 })
      await wait(700)
      // Off the model, so the live preview is not drawn over the committed reading.
      wc.sendInputEvent({ type: 'mouseMove', x: prep.viewport[0] + 8, y: prep.viewport[1] + 8 })
      await wait(300)
      console.log('iso     ', await js(SHOT_ISO_DONE))
    }
    console.log('  settle', await js(SETTLE))
    await shot('iso')
    guard.sample('shots')
  }

  // Phase 7: colour by property at a real size — an attribute, then the file's own widest pset
  // key, the legend they fill, the fps while the scheme is live and the legend's × clearing it.
  if (wants('colors')) {
    await js(`window.__sgvueDev.select(null)`)
    await wait(300)
    const colors = JSON.parse(await js(COLORS))
    console.log('colours ', JSON.stringify({ elements: colors.elements, propKeys: colors.propKeys, psetKey: colors.psetKey }))
    console.log('  by IfcEntity', JSON.stringify(colors.byEntity))
    console.log('  by pset key ', JSON.stringify(colors.byPset))
    console.log('  spinning    ', JSON.stringify(colors.spinning))
    console.log('  cleared     ', JSON.stringify({ clearMs: colors.clearMs, rows: colors.clearedRows }))
    console.log('  debug       ', colors.debug.visible, 'of', colors.debug.elements, '· calls', colors.debug.calls)
    // The screenshot is taken with the scheme live, so re-apply it after the × above.
    await js(`window.__sgvueDev.colorBy(${JSON.stringify('IfcEntity')})`)
    await wait(700)
    await shot('colorby')
    guard.sample('colors')
  }
  guard.sample('done')
  guard.stop()
  app.exit(0)
})
