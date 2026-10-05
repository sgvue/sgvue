/**
 * Dev utility — NOT application code. Loads the built renderer exactly as production does,
 * drives it through a list of named states, and writes a PNG per state.
 *
 *   npm run build && npx electron scripts/screenshot.cjs
 *   SGVUE_STATES=iso,plan,north,section-C,highlight,activate,isolate \
 *   SGVUE_HASH=mock SGVUE_OUT=tests/parity/phase2a/app SGVUE_SIZE=1440x900 \
 *   npx electron scripts/screenshot.cjs
 *
 * Environment:
 *   SGVUE_URL      http(s) URL to load instead of the built file (a dev server, say)
 *   SGVUE_HASH     location hash to append, e.g. `mock` for the design's mock federation
 *   SGVUE_OUT      output directory or, with one state, a .png path
 *   SGVUE_SIZE     WxH content size, default 1440x900
 *   SGVUE_STATES   comma-separated state names (see STATES below); default `shell`
 *   SGVUE_THEMES   comma-separated themes to capture each state in; default `dark,light`
 *   SGVUE_SETTLE   ms to wait after each state before capturing; default 1400
 *   SGVUE_UPDATE_LATEST  a version number: the landing page shows its update notice for it
 *
 * It lives outside `src/` on purpose: `tests/readonly-guard.test.ts` allows disk writes only
 * from the three enumerated writers, and a screenshot must not become a fourth.
 * CommonJS on purpose too: with an ESM entry, `app.enableSandbox()` leaves `whenReady()`
 * pending forever. electron-vite emits the real main as CJS, so the app is unaffected.
 *
 * Requires a build made with VITE_SGVUE_DEVTOOLS=1 for anything beyond `shell`: the mock
 * federation and `window.__sgvueDev` are absent from a production bundle by design.
 *
 * 2026-10-01: the `sections-*` states (`APP_ONLY_STATES`) drive the two-plane Section card — a
 * gridline cut and a level cut together, one previewed, one cleared, `Clear all` — reaching a
 * plane's controls through its block (`secIn`). The `vee-*` states are the assistant's name and
 * its pixel mascot: the pill, the open panel, the bottom row's lane and a sheet of the sprite's
 * five states, each with the sprite clock pinned and an enlarged crop of every sprite on screen.
 * The `trace-*` states are the assistant's thinking trace: one turn stepped through with the
 * trace's clock pinned (`D.trace.pin`, `D.chat.step`), held at the eight instants the handoff's
 * stills show, each with a crop of the panel at 1× and at 3×.
 */
const { app, BrowserWindow, ipcMain } = require('electron')
const { mkdir, writeFile } = require('node:fs/promises')
const { dirname, join, resolve } = require('node:path')
const { installGuard } = require('./lib/electron-guard.cjs')
const { resolveBackend } = require('./lib/backend.cjs')

const ROOT = join(__dirname, '..')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const SIZE = (process.env.SGVUE_SIZE || '1440x860').split('x').map(Number)
const STATES = (process.env.SGVUE_STATES || 'shell').split(',').filter(Boolean)
const THEMES = (process.env.SGVUE_THEMES || 'dark,light').split(',').filter(Boolean)
const SETTLE = Number(process.env.SGVUE_SETTLE || 1400)
const OUT = resolve(ROOT, process.env.SGVUE_OUT || 'out/phase0.png')
// WebGL2 unless `SGVUE_BACKEND=webgpu` **and** `SGVUE_ALLOW_WEBGPU=1` **and** this is the
// mock federation — see `scripts/lib/backend.cjs` for why that is three conditions.
const { hash: HASH } = resolveBackend(process.env.SGVUE_HASH || '')

// A capture run visits many states, so it needs more wall clock than the guard's 25 s default
// — but not one megabyte more memory. `SGVUE_MAX_SECONDS` / `SGVUE_MAX_GPU_MB` still win.
const guard = installGuard({ label: 'screenshot', maxSeconds: 180 })

// The mouse coordinates, the DOM helpers and every state table the prototype also runs are one
// shared file, so the two sides cannot drift apart.
const {
  MOVE,
  CLICK,
  DBLCLICK,
  CUBE,
  HOVER,
  SECOND,
  CORNER,
  UI,
  CHROME_STATES,
  PROP_STATES,
  FILTER_STATES,
  ANNOTATION_STATES,
  COLOR_STATES,
  LANDING_STATES,
  CHAT_STATES,
  RECTS,
  sendInput
} = require('./lib/parity-states.cjs')

/**
 * 2026-10-01: a button of one named block of the app's Section card — "Along a gridline" or
 * "At a level". Each block carries its own `cut`, `flip side` and `Clear`, so the shared
 * `secBtn` (first match in the card) only ever reaches the gridline block's.
 */
const SEC_IN =
  `const secIn = (label, t) => [...sectionCard().querySelector('[role="group"][aria-label="' + label + '"]')` +
  `.querySelectorAll('button')].find((b) => txt(b) === t);`

/**
 * 2026-10-01: Vee's sprite clock stopped at frame 0 (`window.__sgvueDev.vee.pin`), so a capture
 * never catches a blink; and the sheet an earlier `vee-sheet` state left over the window removed.
 */
const VEE_PIN =
  `{ const old = document.getElementById('vee-sheet'); if (old) old.remove(); if (D.vee) D.vee.pin(0); }`

/**
 * 2026-10-01: a sheet of the sprite's five states, laid over the whole window. Drawn by the
 * app's own painter (`D.vee.paint`: `veeGrid` in the live theme's colours), so what is shown is
 * what the app would draw; the small sprite of each row is at the app's own size — one size for
 * every sprite — which the sheet **asks the app for** (`D.vee.cell()`, `veeCell`) rather than
 * restating the rule here. A build from before that hook draws the two enlarged frames only.
 */
const VEE_SHEET = `if (D.vee) {
  const make = (tag, css, text) => { const e = document.createElement(tag); e.style.cssText = css;
    if (text != null) e.textContent = text; return e; };
  const sprite = (state, frame, cell) => { const c = document.createElement('canvas');
    D.vee.paint(c, state, frame, cell); const px = 16 * cell / devicePixelRatio;
    c.style.cssText = 'flex:none;display:block;image-rendering:pixelated;width:' + px + 'px;height:' + px + 'px';
    return c; };
  const APP_CELL = D.vee.cell ? D.vee.cell() : 0;
  const STATES = [['idle', [5, 0]], ['thinking', [0, 7]], ['reading', [0, 5]], ['found', [0, 2]], ['done', [0, 2]]];
  const sheet = make('div', 'position:fixed;inset:0;z-index:100;display:flex;gap:16px;padding:20px;' +
    'background:var(--ground);font:400 11px/1.3 var(--mono);color:var(--muted)');
  sheet.id = 'vee-sheet';
  for (const token of ['--card', '--step-bg']) {
    const col = make('div', 'flex:1;display:flex;flex-direction:column;gap:12px;padding:16px;' +
      'border:1px solid var(--border);border-radius:10px;background:var(' + token + ')');
    col.append(make('div', 'color:var(--ink)', 'Vee on ' + token + ' · ' + document.documentElement.dataset.theme +
      ' · ' + devicePixelRatio + ' device px per CSS px'));
    for (const [state, frames] of STATES) {
      const row = make('div', 'display:flex;align-items:center;gap:14px');
      row.append(make('div', 'width:60px', state));
      for (const f of frames) row.append(sprite(state, f, Math.round(5 * devicePixelRatio)));
      row.append(make('div', 'width:8px'));
      if (APP_CELL) row.append(sprite(state, frames[0], APP_CELL));
      row.append(make('div', '', 'frames ' + frames.join(', ') +
        (APP_CELL ? ' · then ' + frames[0] + ' at the app’s size, ' + APP_CELL + ' device px a cell' : '')));
      col.append(row);
    }
    const roles = make('div', 'display:flex;flex-wrap:wrap;gap:10px;margin-top:auto');
    for (const [role, colour] of Object.entries(D.vee.colours())) {
      const chip = make('div', 'display:flex;align-items:center;gap:5px');
      chip.append(make('div', 'width:14px;height:14px;border:1px solid var(--border-strong);background:' + colour));
      chip.append(make('div', '', role + ' ' + colour));
      roles.append(chip);
    }
    col.append(roles);
    sheet.append(col);
  }
  document.body.append(sheet);
}`

/* ── 2026-10-01: the thinking trace ─────────────────────────────────────────────
 * One turn on the mock federation, **stepped through with the trace's clock pinned**
 * (`D.trace.pin`, `ai/trace-store.ts`) so that each capture is the same on every run: the
 * question typed, sent at `T0`, the first tool starting 2.4 s later — where the reference's Read
 * begins — its data 0.1 s after that, and the answer when the Check has had its 2.4 s. The
 * Filter and the Check start where the trace's own rule puts them (Read + 1.8 s, + 1.6 s).
 *
 * The handoff's question is "Which walls have no fire rating?" on invented numbers (86 walls, 9
 * of them). The mock's real numbers answer a different question the same way: 80 walls, 24 with
 * no `ThermalTransmittance` — 12 in each of two models, on five storeys.
 * ──────────────────────────────────────────────────────────────────────────── */
const TRACE = {
  T0: 100,
  question: 'Which walls have no thermal transmittance?',
  rules:
    `{ rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' },` +
    ` { prop: 'ThermalTransmittance', op: 'absent', val: null }] }`,
  answer: '**24 of 80 walls** have no Thermal Transmittance. 12 are in `SB_ARC_R25` and 12 in `SB_STR_R25`.'
}
/** The trace's cues for that turn, as offsets from `T0`: Read, Filter, Check, Answer. */
const CUE = { read: 2.4, filter: 4.2, check: 5.8, answer: 8.2 }
const traceAt = (t) => `D.trace.pin(${TRACE.T0} + ${t})`
const TRACE_INPUT = `$('[data-role="chatinput"]')`

/**
 * States the **prototype has no counterpart for**, so they are deliberately outside
 * `FILTER_STATES` — which both sides take from `lib/parity-states.cjs`. They are captured for a reviewer to look at, never differenced.
 *
 * `filter-absent` is the 2026-09-20 operator (user-approved): a rule whose value field is
 * inert because the operator ignores it. Driven through the designed controls, by their own
 * copy, exactly as every state above is.
 */
const APP_ONLY_STATES = {
  'filter-absent':
    `click(tbBtn('Filter elements by parameter')); await sleep(300);` +
    ` click(byText('button', '+ add filter step')); await sleep(250);` +
    ` pickOption(filterCard().querySelector('select'), 'FireRating'); await sleep(250);` +
    ` pickOption(filterCard().querySelectorAll('select')[1], 'absent'); await sleep(300)`,

  /* ── 2026-10-01: the owner's five main-window requests ────────────────────────
   * `tests/parity/2026-10-01-ui/README.md` has the commands and the measurements. Captured at
   * `SGVUE_SIZE=1280x820` — the default window — so the canvas points below are **that**
   * window's CSS pixels, not the 1440 × 860 every other table assumes. Two chains, each on a
   * fresh window per theme:
   *
   *   default, view-plan, ui-tree-open, ui-propcard     the toolbar, the tree, the card
   *   ui-marks, ui-actionbar, ui-laser                  the bottom edge
   * ──────────────────────────────────────────────────────────────────────────── */
  // The tree's first group, open: its header row and its first element rows.
  'ui-tree-open':
    `click(tbBtn('3D perspective (Home)')); await sleep(1200);` +
    ` click($('[role="tree"] [role="treeitem"]'))`,
  // A tree (`IfcGeographicElement`): the longest IfcEntity and property-set names the mock has,
  // so the identity tile and the set headers are clipped — which is what gained a `title`.
  'ui-propcard':
    `click($('[role="tree"] [role="treeitem"]')); typeInto(search(), 'Angsana'); await sleep(300);` +
    ` click($('[role="tree"] [role="treeitem"][aria-level="2"]'))`,
  // A storey hidden (so undo, and the reset pill), a colour-by legend and three laser measures…
  'ui-marks': {
    js:
      `colorBy('Level'); await sleep(400); click(byTitle('Show / hide storey')[2]);` +
      ` await sleep(600); click($('button[data-tip^="Laser meter"]'))`,
    input: [CLICK(760, 300), CLICK(860, 300), CLICK(660, 420)],
    after: `click($('button[data-tip^="Select (Esc)"]'))`
  },
  // …then two spots, and the Markups card open over the left lane.
  'ui-actionbar': {
    js: `click($('button[data-tip="Spot coordinate (C)"]'))`,
    input: [CLICK(760, 480), CLICK(860, 480)],
    after:
      `click($('button[data-tip^="Select (Esc)"]')); await sleep(300);` +
      ` click($('button[data-tip="Open the markups list"]'))`
  },
  // …then the Markups card closed and the laser tool again: all five pieces of the bottom row
  // (`app/BottomRow.tsx`) on screen — both bars, the hint, the reset pill above it, the Ask pill.
  'ui-laser':
    `click($('button[data-tip="Open the markups list"]')); await sleep(300);` +
    ` click($('button[data-tip^="Laser meter"]'))`,

  /* ── 2026-10-01: two section planes — the gridline cut and the level cut together ──
   * `tests/parity/2026-10-01-two-sections/README.md` has the commands and the measurements.
   * One chain, in order, on a fresh window per theme; every step is a designed control of the
   * Section card, clicked by its own copy. `secBtn` takes the card's first match — the gridline
   * block's — and `secIn(label, …)` the named block's, by the `aria-label` each block carries.
   * ──────────────────────────────────────────────────────────────────────────── */
  // The card at rest: two blocks, each with its own offset row and its own cut / flip side /
  // Clear, a rule between the two grid families, and Clear all beside the ×.
  'sections-card': `click(tbBtn('Section from gridline / level'))`,
  // Grid C cut and flipped — the kept half is the one whose cut face the 3D camera sees — and
  // level L2 cut at the design's 1 200 mm, in the 3D view: both cut faces, both outlines.
  'sections-both-3d':
    `${SEC_IN} click(secBtn('C')); await sleep(900); click(secIn('Along a gridline', 'flip side'));` +
    ` await sleep(900); click(secBtn('L2')); await sleep(900);` +
    ` click(tbBtn('3D perspective (Home)'))`,
  // The same two cuts in the east elevation: square on to the gridline cut, which the level
  // cut stops at L2 + 1.2 m.
  'sections-both-east': `click(tbBtn('East elevation'))`,
  // The level plane previewed (its own `cut` off) while the gridline plane still cuts: the
  // level's sheet over a model cut only along grid C.
  'sections-grid-cut-level-preview':
    `${SEC_IN} click(tbBtn('3D perspective (Home)')); await sleep(900);` +
    ` click(secIn('At a level', 'cut'))`,
  // The level plane's own Clear: the gridline cut stays exactly as it was.
  'sections-level-cleared': `${SEC_IN} click(secIn('At a level', 'Clear'))`,
  // Clear all: both planes gone, the card as it opened.
  'sections-clear-all': `click(secBtn('Clear all'))`,

  /* ── 2026-10-01: Vee — the assistant's name and its pixel mascot ───────────────
   * `tests/parity/2026-10-01-vee/README.md` has the commands and the measurements. Captured at
   * `SGVUE_SIZE=1280x820`, one chain in order on a fresh window per theme. Every state pins the
   * sprite clock first (`D.vee.pin(0)`, `app/Vee.tsx`), so the header's sprite, each label's and
   * the pill's stand at their own frames 5, 11 and 17 — eyes open — on every run. Each capture
   * also writes one 8× crop per mounted sprite (`spriteCrops` below). A build from before Vee
   * has no `D.vee` and no sprite; the first three states capture it as it was.
   * ──────────────────────────────────────────────────────────────────────────── */
  // The stage at rest: the pill closed.
  'vee-closed': `${VEE_PIN}`,
  // The panel opened from its pill, the boot audit as its one message: the header's sprite, a
  // reply label's, and the lit pill's.
  'vee-open': `${VEE_PIN} click(chatPill())`,
  // …then the four things that used to meet: a storey hidden (the reset pill), an element
  // selected (the property card, and the panel in its lane) and the laser tool (its hint under
  // the pill). The row's centre is two levels tall, so the panel and the card stop above it.
  'vee-lane':
    `${VEE_PIN} click(byTitle('Show / hide storey')[2]); await sleep(600);` +
    ` click($('[role="tree"] [role="treeitem"]')); await sleep(300);` +
    ` click($('[role="tree"] [role="treeitem"][aria-level="2"]')); await sleep(900);` +
    ` click($('button[data-tip^="Laser meter"]'))`,
  // All five states of the sprite on `--card` and on `--step-bg`, in the live theme's colours:
  // two frames of each at 5 px a cell, then the first at the app's own size (one for every
  // sprite, `D.vee.cell()`), and the seven roles.
  'vee-sheet': `${VEE_PIN} ${VEE_SHEET}`,

  /* ── 2026-10-01: the thinking trace — the app's counterparts of the handoff's stills ──
   * `tests/parity/2026-10-01-vee/README.md` § 5 has the commands and the comparison. One chain,
   * in order, on a fresh window per theme, at `SGVUE_SIZE=1280x820 SGVUE_DPR=1`. Each state
   * pins the trace's clock; the sprite clock is pinned at 0 throughout, so a sprite shows frame
   * 0 of whatever state the trace puts it in. Each capture also writes the panel alone, at 1×
   * and enlarged 3× without smoothing (`panelCrops` below).
   * ──────────────────────────────────────────────────────────────────────────── */
  // 01 — at rest, the question being typed: `Which wall`, the composer focused.
  'trace-01-typing':
    `${VEE_PIN} ${traceAt(-1)}; click(chatPill()); await sleep(400);` +
    ` typeInto(${TRACE_INPUT}, 'Which wall'); ${TRACE_INPUT}.focus();` +
    ` ${TRACE_INPUT}.setSelectionRange(10, 10)`,
  // 02 — sent 0.45 s ago: the typed line two thirds of its way up, its bubble just starting to
  // show, the button a stop, the placeholder not yet back.
  'trace-02-lift':
    `typeInto(${TRACE_INPUT}, ${JSON.stringify(TRACE.question)}); await sleep(100); ${traceAt(0)};` +
    ` D.chat.step.begin(${JSON.stringify(TRACE.question)}); ${traceAt(0.45)}`,
  // 03 — Think + 0.9 s: Vee beside its name, `Thinking` mid-shimmer, no bubble yet.
  'trace-03-thinking': `${traceAt(1.9)}`,
  // 04 — Read + 1.3 s, the still's own instant: the bubble open, the wave almost across, the
  // count at 356 of 412.
  'trace-04-reading':
    `${traceAt(CUE.read)}; D.chat.step.start(); ${traceAt(CUE.read + 0.1)};` +
    ` await D.chat.step.exec('query_elements', ${TRACE.rules}); ${traceAt(CUE.read + 1.3)}`,
  // 05 — Filter + 1.1 s: the walls regrouped, the last of them still landing.
  'trace-05-filtering': `${traceAt(CUE.filter + 1.1)}`,
  // 06 — Check + 1.35 s: the beam two thirds across, a ring at the cell it has just found.
  'trace-06-checking': `${traceAt(CUE.check + 1.35)}`,
  // 07 — Answer + 0.6 s, the still's own instant: the first three words in and the fourth half
  // way, the first flagged cells leaving for their rows.
  'trace-07-answer':
    `${traceAt(CUE.answer)}; D.chat.step.done(${JSON.stringify(TRACE.answer)}); ${traceAt(CUE.answer + 0.6)}`,
  // 08 — done: the answer, its rows, the status, Vee with its V lit.
  'trace-08-done': `${traceAt(CUE.answer + 3)}`
}

/**
 * Each state is either JavaScript run in the renderer against `window.__sgvueDev`, or
 * `{ js, input }` where `input` is a list of real mouse events delivered through Chromium's
 * own input pipeline (`webContents.sendInputEvent`). 2b's states are driven that way on
 * purpose: `scripts/parity-prototype.cjs` sends the *same* events to the prototype, so both
 * sides go through their real pointer handlers rather than through a hook only one of them
 * has. Coordinates are CSS pixels in a 1440 × 860 window, and the stage fills it on both
 * sides, so one pair of numbers means the same place in both.
 */
const STATE_JS = {
  shell: 'true',
  iso: 'D.setView("iso")',
  plan: 'D.setView("top")',
  north: 'D.setView("north")',
  east: 'D.setView("east")',
  'section-C': 'D.setView("iso"); D.setSection("grid", "C", true)',
  'section-off': 'D.setSection(null)',
  // Highlight mode: STR matched in the accent, everything else ghosted with edges off.
  highlight: 'D.setView("iso"); D.setSection(null); D.highlightModel("STR")',
  'highlight-off': 'D.highlightModel(null)',
  // Activate mode: every model but ARC drawn inert at 0.08 grey.
  activate: 'D.setView("iso"); D.highlightModel(null); D.activate("ARC")',
  'activate-off': 'D.activate(null)',
  // Isolate: the 220 ms crossfade, settled.
  isolate:
    'D.activate(null); D.setVisibility((el) => el.model === "ARC" || el.model === "STR")',
  'isolate-off': 'D.setVisibility(null)',
  ortho: 'D.setProjection("ortho")',
  persp: 'D.setProjection("persp")',

  /* ── Phase 2b: picking, snapping and the view cube ───────────────────────────
   * These run **in order** and build on one another (select → multiselect is a toggle), and
   * `scripts/parity-prototype.cjs` runs the identical list against the prototype. The
   * coordinates are explained in `tests/parity/phase2b/README.md`.
   * ──────────────────────────────────────────────────────────────────────────── */
  hover: {
    js: 'D.setView("iso"); D.select(null); D.setTool("select")',
    input: [MOVE(HOVER[0], HOVER[1])]
  },
  select: { js: '', input: [CLICK(HOVER[0], HOVER[1])] },
  multiselect: { js: '', input: [CLICK(SECOND[0], SECOND[1], { ctrl: true })] },
  'dblclick-frame': { js: '', input: [DBLCLICK(HOVER[0], HOVER[1]), { wait: 900 }] },
  // The **spot** tool, not measure: it draws the snap marker and nothing else, so the frame
  // shows exactly what 2b owns. `snap-measure` below adds the reference's Phase 6 laser.
  'snap-corner': {
    js: 'D.setView("iso"); D.select(null); D.setTool("spot"); D.setSnap(true)',
    input: [MOVE(CORNER[0], CORNER[1])]
  },
  'snap-measure': { js: 'D.setTool("measure")', input: [MOVE(CORNER[0], CORNER[1])] },
  'cube-hover': {
    js: 'D.setTool("select"); D.setView("iso")',
    input: [MOVE(CUBE.e[0], CUBE.e[1])]
  },
  'cube-click-east': { js: '', input: [CLICK(CUBE.e[0], CUBE.e[1]), { wait: 1200 }] },

  ...CHROME_STATES,
  ...PROP_STATES,
  ...FILTER_STATES,
  ...APP_ONLY_STATES,
  ...ANNOTATION_STATES,
  ...COLOR_STATES,
  ...LANDING_STATES,
  ...CHAT_STATES
}

/**
 * 2026-10-01: one crop per mounted sprite of the assistant's mascot (`[data-role="vee"]`, in
 * document order: the panel's header, each reply label, the pill), 6 px of its surroundings
 * included, enlarged 8× without smoothing — `<stem>-sprite-<n>-<slot>px.png`. The enlargement is
 * done by the page (a canvas with `imageSmoothingEnabled = false`), because `nativeImage` only
 * resizes with a filter.
 */
async function spriteCrops(win, dir, stem) {
  const PAD = 6
  const slots = JSON.parse(
    await win.webContents.executeJavaScript(
      `JSON.stringify([...document.querySelectorAll('[data-role="vee"]')].map((e) => {` +
        ` const b = e.getBoundingClientRect(); return { slot: Math.round(b.width), box: [b.x, b.y, b.width, b.height] } }))`
    )
  )
  for (const [n, { slot, box }] of slots.entries()) {
    const crop = await win.webContents.capturePage({
      x: Math.floor(box[0] - PAD),
      y: Math.floor(box[1] - PAD),
      width: Math.ceil(box[2] + 2 * PAD),
      height: Math.ceil(box[3] + 2 * PAD)
    })
    const zoomed = await win.webContents.executeJavaScript(
      `(async () => { const img = new Image(); img.src = ${JSON.stringify(crop.toDataURL())}; await img.decode();` +
        ` const c = document.createElement('canvas'); c.width = img.width * 8; c.height = img.height * 8;` +
        ` const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0, c.width, c.height);` +
        ` return c.toDataURL('image/png') })()`
    )
    await writeFile(join(dir, `${stem}-sprite-${n}-${slot}px.png`), Buffer.from(zoomed.split(',')[1], 'base64'))
  }
}

/**
 * 2026-10-01: the chat panel alone — its box and the pill under it — at 1× and enlarged 3×
 * without smoothing: `<stem>-panel.png`, `<stem>-panel-3x.png`. The handoff's stills are frames
 * of a video zoomed onto the panel; these are what stands beside them.
 */
async function panelCrops(win, dir, stem) {
  const box = JSON.parse(
    await win.webContents.executeJavaScript(
      `(() => { const log = document.querySelector('[data-role="chatlog"]'); if (!log) return 'null';` +
        ` const p = log.parentElement.getBoundingClientRect(); const stage = document.querySelector('[data-role="stage"]').getBoundingClientRect();` +
        ` return JSON.stringify([Math.floor(p.x) - 8, Math.floor(p.y) - 8, Math.ceil(p.width) + 16, Math.ceil(stage.bottom - p.y) + 8]) })()`
    )
  )
  if (!box) return
  const crop = await win.webContents.capturePage({ x: box[0], y: box[1], width: box[2], height: box[3] })
  await writeFile(join(dir, `${stem}-panel.png`), crop.toPNG())
  const zoomed = await win.webContents.executeJavaScript(
    `(async () => { const img = new Image(); img.src = ${JSON.stringify(crop.toDataURL())}; await img.decode();` +
      ` const c = document.createElement('canvas'); c.width = img.width * 3; c.height = img.height * 3;` +
      ` const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0, c.width, c.height);` +
      ` return c.toDataURL('image/png') })()`
  )
  await writeFile(join(dir, `${stem}-panel-3x.png`), Buffer.from(zoomed.split(',')[1], 'base64'))
}

app.enableSandbox()

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE[0],
    height: SIZE[1],
    useContentSize: true,
    // Frameless and placed at the top-left corner: this Mac's *work area* is only 1512×879,
    // so a normal 1440×900 window is clamped and the capture comes back short. A frameless
    // window may sit under the menu bar, and the display itself is 1512×982.
    frame: false,
    x: 0,
    y: 0,
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
  win.setContentSize(SIZE[0], SIZE[1])
  win.setBounds({ x: 0, y: 0, width: SIZE[0], height: SIZE[1] })

  win.webContents.on('console-message', (e) => console.log(`[renderer:${e.level}] ${e.message}`))

  // 2026-10-01 — the landing page asks main whether a newer version is out (`update:check`,
  // `src/main/updates.ts`). This harness is its own main process and makes no request: it
  // answers "no", as the app does when nothing newer exists, or — with `SGVUE_UPDATE_LATEST`
  // set — with that version, which is what puts the notice in a capture.
  ipcMain.handle('update:check', () =>
    process.env.SGVUE_UPDATE_LATEST ? { latest: process.env.SGVUE_UPDATE_LATEST } : null
  )

  // Phase 5 persists saved filter sets and viewpoints to `localStorage` under the design's own
  // keys, so a second capture run would start with the first run's sets already in the card.
  // Both sides clear it before loading, which is what makes `filter-saved-set` and
  // `viewpoints-one-saved` say the same thing on every run.
  await win.webContents.session.clearStorageData({ storages: ['localstorage'] })

  if (process.env.SGVUE_URL) {
    await win.loadURL(process.env.SGVUE_URL + (HASH ? `#${HASH}` : ''))
  } else {
    await win.loadFile(join(ROOT, 'out/renderer/index.html'), HASH ? { hash: HASH } : undefined)
  }
  // This Mac's work area is 1512×879, so a 1440×900 *window* is clamped and the capture
  // comes back short. Device emulation sizes the renderer's view instead, which is what
  // `capturePage` grabs — so both parity sets are exactly SIZE at the chosen scale factor.
  win.webContents.enableDeviceEmulation({
    screenPosition: 'desktop',
    screenSize: { width: SIZE[0], height: SIZE[1] },
    viewSize: { width: SIZE[0], height: SIZE[1] },
    deviceScaleFactor: Number(process.env.SGVUE_DPR || 2),
    viewPosition: { x: 0, y: 0 },
    scale: 1
  })
  await wait(2500) // fonts, renderer init, mock federation upload

  const single = STATES.length === 1 && THEMES.length === 1 && OUT.endsWith('.png')
  const dir = single ? dirname(OUT) : OUT
  await mkdir(dir, { recursive: true })

  const run = (js) =>
    win.webContents.executeJavaScript(
      `(async () => { const D = window.__sgvueDev; if (!D) return 'no-devtools'; ${UI}\n${js}; return 'ok'; })()`
    )

  for (const theme of THEMES) {
    await win.webContents.executeJavaScript(
      `(() => { const D = window.__sgvueDev; if (D) D.setTheme(${JSON.stringify(theme)});` +
        ` else document.documentElement.dataset.theme = ${JSON.stringify(theme)}; return 'ok' })()`
    )
    await wait(400)
    for (const state of STATES) {
      const entry = STATE_JS[state]
      if (entry === undefined) {
        console.log(`unknown state "${state}" — known: ${Object.keys(STATE_JS).join(', ')}`)
        continue
      }
      const { js, input, after } = typeof entry === 'string' ? { js: entry } : entry
      const said = js ? await run(js) : 'ok'
      if (input) {
        // The state's own JavaScript may have started a 620 ms camera flight; hover is
        // evaluated where the pointer is *when it moves*, so wait for the camera first.
        await wait(SETTLE)
        for (const step of input) await sendInput(win, step)
      }
      // Phase 4: a menu the mouse has just opened, then chosen from.
      if (after) await run(after)
      await wait(SETTLE)
      const image = await win.webContents.capturePage()
      const path = single ? OUT : join(dir, `${state}-${theme}.png`)
      await writeFile(path, image.toPNG())
      // The chrome's own geometry, beside the frame — the parity diff masks to it.
      if (!single) {
        await writeFile(join(dir, `${state}-${theme}.json`), await win.webContents.executeJavaScript(RECTS))
      }
      // 2026-10-01 — and each of Vee's sprites on screen, enlarged, so its pixels can be read.
      // Not under `vee-sheet`, which covers them with its own, already enlarged.
      if (!single && state.startsWith('vee-') && state !== 'vee-sheet') {
        await spriteCrops(win, dir, `${state}-${theme}`)
      }
      // 2026-10-01 — and, for the thinking trace, the panel alone.
      if (!single && state.startsWith('trace-')) await panelCrops(win, dir, `${state}-${theme}`)
      const size = image.getSize()
      console.log(`saved ${path} (${size.width}×${size.height}, ${said})`)
    }
  }

  const debug = await win.webContents.executeJavaScript(
    `window.__sgvueDev ? JSON.stringify(window.__sgvueDev.debug()) : '"no-devtools"'`
  )
  const stats = await win.webContents.executeJavaScript(
    `window.__sgvueDev ? JSON.stringify(window.__sgvueDev.stats()) : 'null'`
  )
  console.log('debug =', debug)
  console.log('stats =', stats)
  guard.sample('done')
  guard.stop()
  app.exit(0)
})
