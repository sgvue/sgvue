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
 *   SGVUE_IFC      an .ifc to open instead of the mock (2026-10-09): served over a `sgvue-file:`
 *                  URL of this harness's own and loaded with `D.open`, as `shell-sanity.cjs` does
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
 *
 * 2026-10-08: the `laser-sides-*` and `laser-onesided-*` states are the laser meter reading each
 * side of its point — the live reading, the committed labels, the Markups card in mm and in m,
 * and a reading whose every axis has one side only, which must not change at all. The `fmt-*`
 * states are a reply's own format: one answered in a plain sentence, then one answered with a
 * sentence, a bulleted list and a table, mid-reveal and settled, and one whose tool carries rules,
 * so the trace's rows stand under its blocks.
 *
 * 2026-11-08 ("Vee Messages"): since 2026-11-07 the chat is the **Ask Vee window**, a child window
 * main opens (`main/vee-window.ts`), and this harness is its own main — so it opens that window
 * itself when the page asks (`vee:open` / `vee:close`), joins the two pages with a private port as
 * main does, and answers `settings:get` with a key or none (`SGVUE_VEE_*` below). The `vm-*`
 * states are the approved prototype's shots one for one — `vm-01-first` beside
 * `prototypes/vee-messages/full/shots/393-dark-01-first.png`, `vm-ifc-2-fire-answer` beside
 * `ifc-393-dark-2-fire-answer.png`, `vm-sg-1-asked` beside `sg-393-dark-1-asked.png` — and each
 * is captured **from the Ask Vee window** at the shot's window size (`<state>-<theme>.png`; the
 * main window beside it as `-main.png`). Every other state captures the main window as before,
 * plus the Ask Vee window as `-vee.png` while it is open; the `trace-*` and `fmt-*` states read and
 * crop that window instead of the old in-stage panel.
 *
 *   SGVUE_VEE_RM   1 — the Ask Vee window asks for reduced motion: every sprite holds frame 0 and
 *                  every state is at its end — the prototype's `-rm-` shots. Without it a sprite
 *                  there runs on its own clock (that window has no dev harness to pin it), and one
 *                  capture in about fourteen can catch a blink.
 */
const { app, BrowserWindow, MessageChannelMain, ipcMain, net, protocol } = require('electron')
const { mkdir, writeFile } = require('node:fs/promises')
const { basename, dirname, join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
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

/* ── 2026-11-08: "Vee Messages" — the Ask Vee window beside the approved prototype ────────
 * One chain, in order, on a fresh window per theme (`SGVUE_THEMES=dark`, then `light`), on the
 * mock federation. Each `vm-*` state is named after the prototype's shot it stands beside
 * (`prototypes/vee-messages/full/shots/`, the window inside each shot) and captured from the Ask
 * Vee window at that shot's window size: 330 × 420, and 420 × 640 for the `ifc-` and `sg-` shots.
 * The turns are stepped with the trace's clock pinned, as the `trace-*` states are, on the mock's
 * own numbers: the prototype's fire-rating turn is its scripted walls; here it is the mock's D2
 * entrance doors, whose `FireRating` is "-" — so the reply carries the app's heads-up, and
 * isolating them is held by the 5 % guard behind a consent card. A key comes and goes through
 * Preferences, as it does in the app: `key` sets what `settings:get` answers and opens Preferences,
 * which tells the store, and the state closes it again.
 * ──────────────────────────────────────────────────────────────────────────── */
const VM = { T0: 1000, small: [330, 420], large: [420, 640] }
const vmAt = (t) => `D.trace.pin(${VM.T0} + ${t})`
/** Preferences, opened by the harness for a key change, closed again by its own Escape. */
const PREFS_CLOSE =
  `await sleep(700); { const d = document.querySelector('[data-role="prefs"]');` +
  ` if (d) d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } await sleep(300)`
/** How many of the mock's doors say "-" as their FireRating: the reply's words count them. */
const DASH_DOORS =
  `D.federation().elements.filter((e) => e.type === 'IfcDoor' && ((e.psets || {}).Pset_DoorCommon || {}).FireRating === '-').length`
const DOORS_Q = 'Which doors have no real fire rating? Show only those.'
const DOORS_CALL =
  `{ action: 'isolate', rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcDoor' }, { prop: 'FireRating', op: '=', val: '-' }] }`
/** The doors turn from Send until `at` seconds in: Read, Filter and Check at the cues of `CUE`. */
const doorsTurn = (base, at) =>
  `${vmAt(base)}; D.chat.step.begin(${JSON.stringify(DOORS_Q)}); ${vmAt(base + CUE.read)}; D.chat.step.start();` +
  ` ${vmAt(base + CUE.read + 0.1)}; await D.chat.step.exec('apply_visibility', ${DOORS_CALL}); ${vmAt(base + at)}`
/** …and its answer, settled: `reply` is a JavaScript expression of `n`, the doors counted. */
const doorsDone = (base, reply) =>
  `const n = ${DASH_DOORS}; ${vmAt(base + CUE.answer)}; D.chat.step.done(${reply}); ${vmAt(base + CUE.answer + 3)}`
const DOORS_REPLY =
  `'**' + n + ' doors** have no real fire rating: their \`FireRating\` reads “-”.\\n\\n` +
  `Showing only them leaves ' + n + ' of 412 on screen, so it waits for your OK.'`
const DOORS_REPLY_TERMS =
  `'**' + n + ' doors** have no real fire rating: their \`FireRating\` reads “-”.\\n\\n` +
  `All of them are \`IfcDoor\` of type \`D2 Double 2400x2400\`.'`
/** The newest reply's consent card's own buttons, in the Ask Vee window. */
const LAST_CARD = `[...document.querySelectorAll('[data-role="chatlog"] > [data-row]')].pop().querySelector('[data-role="consent"]')`

/** The Ask Vee window open, then every model gone, then a fresh conversation (`vm-02`, `vm-04`). */
const NO_MODEL =
  `D.chat.setState({ chatOpen: true }); await sleep(1500);` +
  ` for (const key of D.federation().models.map((m) => m.meta.modelKey)) { await D.unload(key); await sleep(400) }` +
  ` await sleep(800); D.chat.reset(); await sleep(300)`

const VM_STATES = {
  // 01 — first open: the header, the board, today, the boot audit, the suggestions.
  'vm-01-first': { size: VM.small, js: `${VEE_PIN} ${vmAt(-1)}; click(chatPill())`, shot: true },
  // 03 — not ready, no key: Vee's one line, the composer disabled, no suggestions; the board stays.
  'vm-03-nokey': { size: VM.small, key: false, js: PREFS_CLOSE, shot: true },
  // 06 — the key back, and a plain answer with no tool: typing dots gave way to two bubbles.
  'vm-06-plain': {
    size: VM.small,
    key: true,
    js:
      `${PREFS_CLOSE}; ${vmAt(100)}; D.chat.step.begin('What can you do?'); ${vmAt(101.6)};` +
      ` D.chat.step.done('I find, count and check what is in the model, show or hide it, colour it and cut sections.\\n\\n` +
      `I only look: nothing in the model ever changes.'); ${vmAt(104.6)}`,
    shot: true
  },
  // 02a — the doors turn, the Check 1.2 s in: the diary with every step and its live count.
  'vm-02a-fire-checking': { size: VM.small, js: doorsTurn(200, CUE.check + 1.2), shot: true },
  // 05b — its answer: bubbles, the storey rows, the heads-up and the taped consent card.
  'vm-05b-fire-answer': { size: VM.small, js: doorsDone(200, DOORS_REPLY), shot: true },
  // 05d — the user's Apply: the stub torn, the stamp landed, Revert on it, the board isolated.
  'vm-05d-fire-applied': { size: VM.small, js: '', vee: `click(${LAST_CARD}.querySelector('button.vm-go'))`, shot: true },
  // 05e — Revert on the stamp: REVERTED, and the board back to all of it.
  'vm-05e-fire-reverted': { size: VM.small, js: '', vee: `click(${LAST_CARD}.querySelector('.vm-done button.vm-rv'))`, shot: true },
  // ifc-1 — the doors again, larger, the Check running: `Checking`, the matrix under it.
  'vm-ifc-1-fire-diary': { size: VM.large, js: doorsTurn(300, CUE.check + 1.2), shot: true },
  // ifc-2 — its answer: the diary folded to one line, IFC terms in their one colour, the heads-up.
  'vm-ifc-2-fire-answer': { size: VM.large, js: doorsDone(300, DOORS_REPLY_TERMS), shot: true },
  // sg-1 — the trees read by rule, then the IFC+SG question: Vee's lead-in, the app's question,
  // Yes and No.
  'vm-sg-1-asked': {
    size: VM.large,
    js:
      `${vmAt(400)}; D.chat.step.begin('What types are the trees?'); ${vmAt(400 + CUE.read)}; D.chat.step.start();` +
      ` ${vmAt(400 + CUE.read + 0.1)};` +
      ` await D.chat.step.exec('query_elements', ${JSON.stringify({ rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcGeographicElement' }] })});` +
      ` await D.chat.step.exec('ask_choice', ${JSON.stringify({ lead: 'These elements carry `SGPset_Planting` and `SGPset_SoftLandscape` values.' })});` +
      ` ${vmAt(400 + CUE.answer)}; D.chat.step.done('One thing first.'); ${vmAt(400 + CUE.answer + 3)}`,
    shot: true
  },
  // 02 — no model open: one line, no board, no suggestions; the composer stays — on a fresh
  // conversation, as the prototype's shot is. As the real case goes: the Ask Vee window open first
  // (there is no Ask pill once no model is open, so it is opened while one still is — through the
  // panel's own `chatOpen`, as the pill sets it, whether or not an earlier state left it open),
  // then every model unloaded through the dev harness's `D.unload` (the sidebar's own delete: the
  // app offers no × for the last model, so the sidebar alone always left the demo's MEP — 8
  // elements — on screen), then a fresh conversation.
  'vm-02-nomodel': { size: VM.small, js: NO_MODEL, shot: true },
  // 04 — and no key either: the key line wins. The same steps first, so it stands on its own too.
  'vm-04-nokeynomodel': { size: VM.small, key: false, js: `${PREFS_CLOSE}; ${NO_MODEL}`, shot: true }
}

/* ── 2026-10-08: a reply's own format ───────────────────────────────────────────
 * The owner: "the Ask VEE ai assistant answer are in one sentence, which is extremely difficult
 * to read". Three turns on the mock federation, the trace's clock pinned as above. The first has
 * no tool and is answered in one plain sentence; the second runs `query_sql` — a note in the
 * ticker, and no rows under its answer — and is answered with a sentence, a bulleted list and a
 * table, the mock's real numbers: 80 walls, 19 on each of L1 … L4 and 4 on the roof; 24 with no
 * `ThermalTransmittance`, five a level and all four on the roof, 12 in each of two models. The
 * third runs the trace's own `query_elements`, so its answer — a sentence and a list — has the
 * trace's rows under it.
 * ──────────────────────────────────────────────────────────────────────────── */
const FMT = {
  plain: { question: 'hello', reply: 'Hello. Ask me about the model.' },
  question: 'How many walls are on each level, and which have no thermal transmittance?',
  sql: `{ sql: "SELECT storey, COUNT(*) AS walls FROM element WHERE type = 'IfcWall' GROUP BY storey" }`,
  reply: [
    '**24 of 80 walls** have no Thermal Transmittance, and every level has some.',
    '',
    '- 12 are in `SB_ARC_R25` and 12 in `SB_STR_R25`.',
    '- All 4 walls on the roof are missing it.',
    '- Every `EW 200 Brick` wall carries one.',
    '',
    '| Level | Walls | Missing |',
    '|---|---:|---:|',
    '| L1 | 19 | 5 |',
    '| L2 | 19 | 5 |',
    '| L3 | 19 | 5 |',
    '| L4 | 19 | 5 |',
    '| Roof | 4 | 4 |'
  ].join('\n'),
  /** The second turn, on the trace's clock: Send, its tool's start, and the answer. */
  send: 10,
  start: 12.4,
  answer: 15.2,
  /** The third turn's answer, under which the trace puts its rows. */
  rows: [
    '**24 of 80 walls** have no Thermal Transmittance.',
    '',
    '- 12 are in `SB_ARC_R25`.',
    '- 12 are in `SB_STR_R25`.'
  ].join('\n')
}
/**
 * What a `fmt-*` capture also measures, printed as `[fmt] {…}` — **run in the Ask Vee window**
 * since 2026-11-08, where a reply is one bubble per block (`ai/parts.ts`): each bubble's box and
 * what it holds, how many of the reply's parts are still landing (`data-land`) and how many are
 * wholly in, and the table's box and the log, each as client and scroll width — CSS px, read from
 * the DOM.
 */
const FMT_READ =
  `{ const row = [...document.querySelectorAll('[data-role="chatlog"] > [data-row]')].pop();` +
  ` const r = (e) => { const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map((v) => Math.round(v * 100) / 100) };` +
  ` const bubbles = [...row.querySelectorAll('.vm-stack > .vm-b.vm-tx')]; const table = row.querySelector('table'); const log = row.parentElement;` +
  ` const lands = [...row.querySelectorAll('[data-land]')].map((e) => (e.style.opacity === '' ? 1 : Number(e.style.opacity)));` +
  ` console.log('[fmt] ' + JSON.stringify({ bubbles: bubbles.map((e) => [e.querySelector('table') ? 'table' : e.querySelector('ul, ol') ? 'list' : 'p', ...r(e)]),` +
  ` cards: [...row.querySelectorAll('.vm-stack > .vm-card')].map((e) => [e.getAttribute('data-role'), ...r(e)]),` +
  ` lands: lands.length, in: lands.filter((o) => o >= 1).length,` +
  ` table: table ? { client: table.parentElement.clientWidth, scroll: table.parentElement.scrollWidth } : null,` +
  ` log: { client: log.clientWidth, scroll: log.scrollWidth } })) }`

/**
 * States the **prototype has no counterpart for**, so they are deliberately outside
 * `FILTER_STATES` — which both sides take from `lib/parity-states.cjs`. They are captured for a reviewer to look at, never differenced.
 *
 * `filter-absent` is the 2026-09-20 operator (user-approved): a rule whose value field is
 * inert because the operator ignores it. Driven through the designed controls, by their own
 * copy, exactly as every state above is.
 */
/**
 * 2026-10-09: the display unit set through the Markups card's own toggle — the card opened, the
 * unit's button clicked by its copy, the card closed again (`D.tool` is the assistant's own
 * `set_interface`, `card`, which is what reaches the card before there is a markup to open it).
 */
const UNIT_STATE = (unit) =>
  `await D.tool('set_interface', { card: 'measure' }); await sleep(300);` +
  ` click(byText('button', ${JSON.stringify(unit)})); await sleep(300);` +
  ` await D.tool('set_interface', { card: 'none' })`

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

  /* ── 2026-10-08: the laser meter reads each side of its point ─────────────────
   * Captured at `SGVUE_SIZE=1280x820 SGVUE_DPR=1`, so the canvas points are that window's CSS
   * pixels. Two chains, each on a fresh window per theme, every step a designed control or a
   * real pointer event:
   *
   *   laser-sides-hover, laser-sides, laser-sides-markups, laser-sides-markups-m, laser-sides-zoom
   *       `Ext Wall E 1-2 L4` at (906, 440): Y and Z each read both sides of the point
   *   laser-onesided-hover, laser-onesided, laser-onesided-markups
   *       `Floor Slab L2` at (682, 560): every axis reads one side only, so nothing differs
   * ──────────────────────────────────────────────────────────────────────────── */
  // The laser tool over the wall: the live preview, its reading and the snap marker.
  'laser-sides-hover': {
    js: `click($('button[data-tip^="Laser meter"]'))`,
    input: [MOVE(906, 440)]
  },
  // The click commits it; the pointer leaves for open sky and the select tool takes over, so
  // what is left is the measurement alone.
  'laser-sides': {
    js: '',
    input: [CLICK(906, 440), MOVE(800, 150)],
    after: `click($('button[data-tip^="Select (Esc)"]'))`
  },
  // The Markups card, from the action bar, in millimetres…
  'laser-sides-markups': `click($('button[data-tip="Open the markups list"]'))`,
  // …and in metres.
  'laser-sides-markups-m': `click(byText('button', 'm'))`,
  // Back to mm, and the row's tag zooms to the measurement: the labels at a readable size.
  'laser-sides-zoom':
    `click(byText('button', 'mm')); await sleep(300);` +
    ` click($('button[data-tip="Zoom to this measurement"]'))`,
  'laser-onesided-hover': {
    js: `click($('button[data-tip^="Laser meter"]'))`,
    input: [MOVE(682, 560)]
  },
  'laser-onesided': {
    js: '',
    input: [CLICK(682, 560), MOVE(800, 150)],
    after: `click($('button[data-tip^="Select (Esc)"]'))`
  },
  'laser-onesided-markups': `click($('button[data-tip="Open the markups list"]'))`,

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
   * main window's sprite clock first (`D.vee.pin(0)`, `app/Vee.tsx`), so the pill's sprite stands
   * at its frame 17 — eyes open — on every run. Each capture also writes one 8× crop per mounted
   * sprite (`spriteCrops` below). A build from before Vee has no `D.vee` and no sprite; the first
   * three states capture it as it was. Since 2026-11-07 the panel is the Ask Vee window: `vee-open`
   * opens it, and it is captured beside the main window (`-vee.png`, its sprites cropped from it);
   * `vee-lane` is the main window's bottom row and property card, which no panel shares any more.
   * ──────────────────────────────────────────────────────────────────────────── */
  // The stage at rest: the pill closed.
  'vee-closed': `${VEE_PIN}`,
  // The panel opened from its pill, the boot audit as its one message: the header's sprite, a
  // reply label's, and the lit pill's.
  'vee-open': `${VEE_PIN} click(chatPill())`,
  // …then the four things that used to meet: a storey hidden (the reset pill), an element
  // selected (the property card in its lane) and the laser tool (its hint under the pill). The
  // row's centre is two levels tall, so the card stops above it; since 2026-11-07 the panel is a
  // window of its own and meets none of them.
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
   * pins the trace's clock; the main window's sprite clock is pinned at 0 throughout. Each
   * capture also writes the Ask Vee window alone, at 1× and enlarged 3× without smoothing
   * (`veeCrops` below).
   *
   * 2026-11-08 ("Vee Messages", stage 1b): the handoff is the specification up to its Answer cue
   * and no further — the app's answer is its own. So 01–06 are the handoff's instants in the Ask
   * Vee window (03 now typing dots, 04–06 the diary), and 07–08 are the app's answer: its parts
   * landing, 0.15 s in, and the diary folded once all is settled.
   * ──────────────────────────────────────────────────────────────────────────── */
  // 01 — at rest, the question being typed in the Ask Vee window: `Which wall`, the composer focused.
  'trace-01-typing': {
    js: `${VEE_PIN} ${traceAt(-1)}; click(chatPill())`,
    vee: `typeInto(${TRACE_INPUT}, 'Which wall'); ${TRACE_INPUT}.focus(); ${TRACE_INPUT}.setSelectionRange(10, 10)`
  },
  // 02 — sent 0.45 s ago: the typed line on its slant up to its bubble on the right, the bubble
  // just starting to show, the button a stop, the placeholder not yet back.
  'trace-02-lift': `${traceAt(0)}; D.chat.step.begin(${JSON.stringify(TRACE.question)}); ${traceAt(0.45)}`,
  // 03 — Think + 0.9 s: Vee's typing dots, no diary yet.
  'trace-03-thinking': `${traceAt(1.9)}`,
  // 04 — Read + 1.3 s, the still's own instant: the diary open, the wave almost across, the
  // count at 356 of 412.
  'trace-04-reading':
    `${traceAt(CUE.read)}; D.chat.step.start(); ${traceAt(CUE.read + 0.1)};` +
    ` await D.chat.step.exec('query_elements', ${TRACE.rules}); ${traceAt(CUE.read + 1.3)}`,
  // 05 — Filter + 1.1 s: Reading ticked, the walls regrouped, the last of them still landing.
  'trace-05-filtering': `${traceAt(CUE.filter + 1.1)}`,
  // 06 — Check + 1.35 s: the beam two thirds across, a ring at the cell it has just found.
  'trace-06-checking': `${traceAt(CUE.check + 1.35)}`,
  // 07 — Answer + 0.15 s: the diary folding into its line, the first part landed, the next landing.
  'trace-07-answer':
    `${traceAt(CUE.answer)}; D.chat.step.done(${JSON.stringify(TRACE.answer)}); ${traceAt(CUE.answer + 0.15)}`,
  // 08 — done: the folded line, the answer's bubbles and its storey rows, Vee with its V lit.
  'trace-08-done': `${traceAt(CUE.answer + 3)}`,

  /* ── 2026-10-08: a reply's own format — one chain, in order, on a fresh window per theme, at
   * `SGVUE_SIZE=1280x820 SGVUE_DPR=1`, the sprite clock pinned at 0. (The panel was first made
   * 640 px tall through the store's `chatH`; since 2026-11-07 it is the Ask Vee window, whose
   * size is the window's, and the store has no such field.)
   * On a build from before 2026-10-08 the same states draw that reply as it was drawn then.
   * ──────────────────────────────────────────────────────────────────────────── */
  // A turn with no tool, answered in one plain sentence: its bubble hugs its text.
  'fmt-plain':
    `${VEE_PIN} ${traceAt(-1)}; click(chatPill()); await sleep(400);` +
    ` ${traceAt(0)}; D.chat.step.begin(${JSON.stringify(FMT.plain.question)}); ${traceAt(1.5)};` +
    ` D.chat.step.done(${JSON.stringify(FMT.plain.reply)}); ${traceAt(4.5)}`,
  // A second turn answered with a sentence, a bulleted list and a table — 0.2 s into the answer,
  // its bubbles still landing (since 2026-11-08 they are all in by 0.5 s).
  'fmt-mid': {
    js:
      `${traceAt(FMT.send)}; D.chat.step.begin(${JSON.stringify(FMT.question)}); ${traceAt(FMT.start)};` +
      ` D.chat.step.start(); ${traceAt(FMT.start + 0.1)}; await D.chat.step.exec('query_sql', ${FMT.sql});` +
      ` ${traceAt(FMT.answer)}; D.chat.step.done(${JSON.stringify(FMT.reply)}); ${traceAt(FMT.answer + 0.2)}`,
    vee: `await sleep(200); ${FMT_READ}`
  },
  // …and settled.
  'fmt-done': { js: `${traceAt(FMT.answer + 3)}`, vee: `await sleep(200); ${FMT_READ}` },
  // A third turn whose tool carries rules — the trace's own walls — answered with a sentence and a
  // list: the storey-rows card stands under its bubbles.
  'fmt-rows': {
    js:
      `${traceAt(FMT.send + 10)}; D.chat.step.begin(${JSON.stringify(TRACE.question)}); ${traceAt(FMT.start + 10)};` +
      ` D.chat.step.start(); ${traceAt(FMT.start + 10.1)}; await D.chat.step.exec('query_elements', ${TRACE.rules});` +
      ` ${traceAt(FMT.start + 10 + 5.8)}; D.chat.step.done(${JSON.stringify(FMT.rows)}); ${traceAt(FMT.start + 10 + 8.8)}`,
    vee: `await sleep(200); ${FMT_READ}`
  },

  /* ── 2026-10-09: the display unit — mm, m and feet and inches ────────────────
   * `tests/parity/2026-10-09-units/README.md` has the commands and the measurements. A chain
   * starts with one of `units-mm`, `units-m` or `units-ft` — the Markups card opened (through
   * the assistant's own `set_interface`, since the card's button lives in the action bar only
   * once there is a markup), its unit button clicked by its own copy, the card closed — and then
   * runs the annotation and laser chains, so every label is captured in that unit. The
   * `units-*` states that follow are for any model, the feet fixture among them
   * (`SGVUE_IFC=tests/fixtures/feet.ifc`): levels on, a level cut in the Section card, and the
   * Coordinate-system card.
   * ──────────────────────────────────────────────────────────────────────────── */
  'units-mm': UNIT_STATE('mm'),
  'units-m': UNIT_STATE('m'),
  'units-ft': UNIT_STATE('ft'),
  'units-levels': `click(tbBtn('3D perspective (Home)')); await sleep(900); click(tbBtn('Levels (L)'))`,
  // The second level's chip — `L1` on the mock, `Level 2` on the feet fixture — at the card's own
  // 1 200 mm: the offset field, its nudges and the summary, in the unit.
  'units-section-level':
    `click(tbBtn('Levels (L)')); await sleep(300); click(tbBtn('Section from gridline / level')); await sleep(400);` +
    ` click([...sectionCard().querySelector('[role="group"][aria-label="At a level"]').querySelectorAll('button')]` +
    `.filter((b) => b.className.includes('hv-accent-line') && txt(b) !== 'cut')[1])`,
  'units-coords-card':
    `click(secClear()); await sleep(300); click(tbBtn('Coordinate system & true north'))`,
  // A laser measurement from the top of the model's first slab — the viewer's own commit for a
  // click, through the assistant's `manage_markups` — and the Markups card it lands in.
  'units-place-laser':
    `click(tbBtn('Coordinate system & true north')); await sleep(300);` +
    ` const slab = D.federation().elements.find((e) => e.type === 'IfcSlab');` +
    ` await D.tool('manage_markups', { op: 'place_measure', id: slab.id, at: 'top' }); await sleep(600);` +
    ` click($('button[data-tip="Open the markups list"]'))`,
  // A spot on top of the same slab, its tag opened to the full E / N / Z and the file's own xyz.
  'units-place-spot':
    ` const slab = D.federation().elements.find((e) => e.type === 'IfcSlab');` +
    ` await D.tool('manage_markups', { op: 'place_spot', id: slab.id, at: 'top', show: 'full' })`,
  // Every collapsed spot tag opened — the tag's own click.
  'units-spot-full': `$$('div').filter((e) => e.title === 'Show E, N and Z').forEach((e) => e.click())`
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
  ...CHAT_STATES,
  ...VM_STATES
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
  const { view, slots } = JSON.parse(
    await win.webContents.executeJavaScript(
      `JSON.stringify({ view: [innerWidth, innerHeight], slots: [...document.querySelectorAll('[data-role="vee"]')].map((e) => {` +
        ` const b = e.getBoundingClientRect(); return { slot: Math.round(b.width), box: [b.x, b.y, b.width, b.height] } }) })`
    )
  )
  for (const [n, { slot, box }] of slots.entries()) {
    // 2026-11-08 — only what is in the view. A sprite scrolled out of a long thread stands above
    // the page's top, and a rectangle reaching outside the view is what `capturePage` failed on
    // with `UnknownVizError` (the `vm-02a-fire-checking` run, whose thread scrolls).
    const x0 = Math.max(0, Math.floor(box[0] - PAD))
    const y0 = Math.max(0, Math.floor(box[1] - PAD))
    const x1 = Math.min(view[0], Math.ceil(box[0] + box[2] + PAD))
    const y1 = Math.min(view[1], Math.ceil(box[1] + box[3] + PAD))
    if (x1 - x0 < 4 || y1 - y0 < 4) {
      console.log(`[crop] ${stem} sprite ${n}: out of view, skipped`)
      continue
    }
    let crop
    try {
      crop = await win.webContents.capturePage({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 })
    } catch (error) {
      console.log(`[crop] ${stem} sprite ${n}: not captured (${error.message})`)
      continue
    }
    if (crop.isEmpty()) continue
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
 * 2026-10-01: the chat panel alone, at 1× and enlarged 3× without smoothing: `<stem>-panel.png`,
 * `<stem>-panel-3x.png`. The handoff's stills are frames of a video zoomed onto the panel; these
 * are what stands beside them. Since 2026-11-07 the panel is the Ask Vee window, so the crop is
 * that window's whole page (`image`, its own capture).
 */
async function veeCrops(page, image, dir, stem) {
  await writeFile(join(dir, `${stem}-panel.png`), image.toPNG())
  const zoomed = await page.webContents.executeJavaScript(
    `(async () => { const img = new Image(); img.src = ${JSON.stringify(image.toDataURL())}; await img.decode();` +
      ` const c = document.createElement('canvas'); c.width = img.width * 3; c.height = img.height * 3;` +
      ` const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0, c.width, c.height);` +
      ` return c.toDataURL('image/png') })()`
  )
  await writeFile(join(dir, `${stem}-panel-3x.png`), Buffer.from(zoomed.split(',')[1], 'base64'))
}

/* ── 2026-11-08: the Ask Vee window, opened by this harness as main opens it ─────────────────
 * `main/vee-window.ts` in miniature: one child window of the main window, `out/renderer/vee.html`
 * on `out/preload/vee.js`, sandboxed as the app's; a fresh `MessageChannelMain` pair whenever it
 * loads, one end to each page on `vee:port`; and, when it closes, the same post with no port, so
 * the main window's panel closes. Its view is emulated at the main window's scale factor, so a
 * capture is the window's content box × `SGVUE_DPR`.
 * ──────────────────────────────────────────────────────────────────────────── */
const DPR = Number(process.env.SGVUE_DPR || 2)
const VEE_RM = process.env.SGVUE_VEE_RM === '1'
let veeWin = null
let veeSize = [330, 420]
/** What `settings:get` says: whether a key is stored. A state's `key` changes it. */
let veeKey = true

/**
 * Device emulation for the Ask Vee window's view — **only once its page has loaded**. The first
 * run of this harness called it on a window that had not navigated yet, right after creating it,
 * and the whole process ended on SIGSEGV the moment the first `vm-*` state opened the window: a
 * `webContents` with no page has no view to emulate. The main window is emulated only after its
 * `loadFile` resolves for the same reason, and the app's own `main/vee-window.ts` never emulates.
 */
function emulateVee(w) {
  if (w.isDestroyed() || w.webContents.isDestroyed() || w.webContents.isLoading() || !w.webContents.getURL()) {
    console.log('[vee] emulation deferred: the page has not loaded yet')
    return
  }
  console.log(`[vee] emulating ${veeSize[0]} × ${veeSize[1]} at ${DPR}x`)
  w.webContents.enableDeviceEmulation({
    screenPosition: 'desktop',
    screenSize: { width: SIZE[0], height: SIZE[1] },
    viewSize: { width: veeSize[0], height: veeSize[1] },
    deviceScaleFactor: DPR,
    viewPosition: { x: 0, y: 0 },
    scale: 1
  })
}

/** Size the open Ask Vee window to `veeSize`, standing where the panel stood in the main window. */
function placeVee(w) {
  w.setContentBounds({
    x: Math.max(0, SIZE[0] - 12 - veeSize[0]),
    y: Math.max(0, SIZE[1] - 52 - veeSize[1]),
    width: veeSize[0],
    height: veeSize[1]
  })
}

/** A new size for the open window: its bounds, then its emulated view to match. */
function resizeVee(w) {
  placeVee(w)
  emulateVee(w)
}

function openVeeWindow(main, theme) {
  if (veeWin && !veeWin.isDestroyed()) {
    veeWin.focus()
    return
  }
  console.log(`[vee] open: ${veeSize[0]} × ${veeSize[1]}, ${theme}`)
  // As `main/vee-window.ts` builds it: a child of the main window, not shown until it can paint.
  const w = new BrowserWindow({
    parent: main,
    title: 'Ask Vee',
    width: veeSize[0],
    height: veeSize[1],
    minWidth: 300,
    minHeight: 380,
    useContentSize: true,
    modal: false,
    resizable: true,
    fullscreenable: false,
    show: false,
    backgroundColor: theme === 'light' ? '#FFFFFF' : '#171F20',
    webPreferences: {
      preload: join(ROOT, 'out/preload/vee.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false
    }
  })
  veeWin = w
  placeVee(w)
  w.removeMenu()
  w.on('ready-to-show', () => {
    console.log('[vee] ready to show')
    if (!w.isDestroyed()) w.show()
  })
  w.webContents.on('console-message', (e) => console.log(`[vee:${e.level}] ${e.message}`))
  w.webContents.on('render-process-gone', (_e, d) => console.log(`[vee] page gone: ${d.reason}`))
  w.webContents.on('did-finish-load', async () => {
    console.log('[vee] loaded')
    if (w.isDestroyed()) return
    emulateVee(w)
    console.log('[vee] emulated')
    if (VEE_RM) {
      // Reduced motion, asked for by this window alone, as the e2e suite asks for it.
      try {
        if (!w.webContents.debugger.isAttached()) w.webContents.debugger.attach('1.3')
        await w.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
        })
      } catch (error) {
        console.log(`[vee] reduced motion not set: ${error.message}`)
      }
    }
    // As `connectVee` does: a fresh pair at every load, one end to each live page.
    if (main.isDestroyed() || main.webContents.isDestroyed() || w.isDestroyed() || w.webContents.isDestroyed()) return
    const { port1, port2 } = new MessageChannelMain()
    main.webContents.postMessage('vee:port', null, [port1])
    w.webContents.postMessage('vee:port', null, [port2])
    console.log('[vee] port joined')
  })
  w.on('closed', () => {
    console.log('[vee] closed')
    if (veeWin !== w) return
    veeWin = null
    if (!main.isDestroyed() && !main.webContents.isDestroyed()) main.webContents.postMessage('vee:port', null, [])
  })
  w.loadFile(join(ROOT, 'out/renderer/vee.html'), { hash: `theme=${theme}` }).catch((error) =>
    console.log(`[vee] load failed: ${error.message}`)
  )
}

/** Until the Ask Vee window has loaded and drawn its log — or `false` after `ms`. */
async function veeReady(ms = 8000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (veeWin && !veeWin.isDestroyed() && !veeWin.webContents.isLoading()) {
      const drawn = await veeWin.webContents
        .executeJavaScript(`!!document.querySelector('[data-role="chatlog"]')`)
        .catch(() => false)
      if (drawn) return true
    }
    await wait(100)
  }
  return false
}

app.enableSandbox()

/** 2026-10-09: a real file to open instead of the mock — the feet fixture, say. */
const IFC = process.env.SGVUE_IFC ? resolve(ROOT, process.env.SGVUE_IFC) : null
if (IFC) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'sgvue-file',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
    }
  ])
}

app.whenReady().then(async () => {
  if (IFC) protocol.handle('sgvue-file', () => net.fetch(pathToFileURL(IFC).toString()))
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

  // 2026-11-08 — the Ask Vee window, as main opens and closes it (`main/vee-window.ts`), and the
  // settings it reads `hasKey` from: a stand-in that names no key and stores nothing.
  ipcMain.handle('vee:open', (_event, raw) => {
    console.log('[vee] open asked')
    openVeeWindow(win, raw && raw.theme === 'light' ? 'light' : 'dark')
  })
  ipcMain.handle('vee:close', () => {
    console.log('[vee] close asked')
    if (veeWin && !veeWin.isDestroyed()) veeWin.close()
  })
  ipcMain.handle('settings:get', () => ({
    model: 'claude-opus-5',
    effort: 'medium',
    cacheOneHour: false,
    backend: 'auto',
    preferNvidia: true,
    hasKey: veeKey,
    envKey: false,
    keyStorageAvailable: true
  }))

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
  if (IFC) {
    // The parse and the stream, then the landing page's fade.
    const name = basename(IFC)
    const said = await win.webContents.executeJavaScript(
      `window.__sgvueDev ? window.__sgvueDev.open('sgvue-file://model/${encodeURIComponent(name)}', ${JSON.stringify(name)}).then(() => 'ok') : 'no-devtools'`
    )
    console.log(`opened ${name}: ${said}`)
    await wait(2500)
  }

  const single = STATES.length === 1 && THEMES.length === 1 && OUT.endsWith('.png')
  const dir = single ? dirname(OUT) : OUT
  await mkdir(dir, { recursive: true })

  const run = (js) =>
    win.webContents.executeJavaScript(
      `(async () => { const D = window.__sgvueDev; if (!D) return 'no-devtools'; ${UI}\n${js}; return 'ok'; })()`
    )
  // 2026-11-08 — the same in the Ask Vee window, which has the DOM helpers and no dev harness.
  const runVee = (js) =>
    veeWin && !veeWin.isDestroyed()
      ? veeWin.webContents.executeJavaScript(`(async () => { ${UI}\n${js}; return 'ok'; })()`)
      : Promise.resolve('no-vee-window')

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
      // 2026-11-08 — one state that fails (a capture the compositor refuses, a control that is not
      // there) is logged and the run goes on to the next, instead of ending every capture after it.
      try {
        const { js, input, after, vee, size, key, shot } = typeof entry === 'string' ? { js: entry } : entry
        // 2026-11-08 — step logs: the last line before a crash names the state and the step it reached.
        console.log(`[state] ${state} (${theme}): start`)
        // 2026-11-08 — the Ask Vee window's size for this state, and a key that comes or goes the
        // way it does in the app: through Preferences, which tells the store (the state closes it).
        if (size && (size[0] !== veeSize[0] || size[1] !== veeSize[1])) {
          veeSize = size
          if (veeWin && !veeWin.isDestroyed()) resizeVee(veeWin)
        }
        if (key !== undefined) {
          veeKey = key
          win.webContents.send('settings:open')
        }
        const said = js ? await run(js) : 'ok'
        if (input) {
          // The state's own JavaScript may have started a 620 ms camera flight; hover is
          // evaluated where the pointer is *when it moves*, so wait for the camera first.
          await wait(SETTLE)
          for (const step of input) await sendInput(win, step)
        }
        // Phase 4: a menu the mouse has just opened, then chosen from.
        if (after) await run(after)
        // 2026-11-08 — what this state does in the Ask Vee window, once that window is up.
        const veeUp = vee || shot || (veeWin && !veeWin.isDestroyed()) ? await veeReady() : false
        if ((vee || shot) && !veeUp) console.log(`[vee] ${state}: the Ask Vee window did not open`)
        if (vee && veeUp) console.log(`[vee] ${state}: ${await runVee(vee)}`)
        await wait(SETTLE)
        console.log(`[state] ${state}: capturing`)
        const own = await win.webContents.capturePage()
        // A `vm-*` state is the Ask Vee window's capture; the main window stands beside it.
        // One handle for the whole capture: `veeWin` goes null the moment the window closes.
        const shotWin = veeUp && veeWin && !veeWin.isDestroyed() && !veeWin.webContents.isDestroyed() ? veeWin : null
        const veeImage = shotWin ? await shotWin.webContents.capturePage() : null
        // A `vm-*` state is the Ask Vee window's capture or none: never the main window in its place.
        if (shot && !veeImage) throw new Error('the Ask Vee window is not open, so there is nothing of it to capture')
        const image = shot ? veeImage : own
        const path = single ? OUT : join(dir, `${state}-${theme}.png`)
        await writeFile(path, image.toPNG())
        if (!single && veeImage) {
          if (shot) await writeFile(join(dir, `${state}-${theme}-main.png`), own.toPNG())
          else await writeFile(join(dir, `${state}-${theme}-vee.png`), veeImage.toPNG())
        }
        // The chrome's own geometry, beside the frame — the parity diff masks to it.
        if (!single) {
          await writeFile(join(dir, `${state}-${theme}.json`), await win.webContents.executeJavaScript(RECTS))
        }
        // 2026-10-01 — and each of Vee's sprites on screen, enlarged, so its pixels can be read.
        // Not under `vee-sheet`, which covers them with its own, already enlarged. Since 2026-11-08
        // the Ask Vee window's sprites too — its header's and its avatars' — for every `vm-*` state.
        if (!single && state.startsWith('vee-') && state !== 'vee-sheet') {
          await spriteCrops(win, dir, `${state}-${theme}`)
        }
        if (!single && veeImage && !shotWin.isDestroyed() && (state.startsWith('vee-') || shot)) {
          await spriteCrops(shotWin, dir, `${state}-${theme}-vee`)
        }
        // 2026-10-01 — and, for the thinking trace, the panel alone: since 2026-11-07, the Ask Vee window.
        if (!single && veeImage && !shotWin.isDestroyed() && (state.startsWith('trace-') || state.startsWith('fmt-'))) {
          await veeCrops(shotWin, veeImage, dir, `${state}-${theme}`)
        }
        const shape = image.getSize()
        console.log(`saved ${path} (${shape.width}×${shape.height}, ${said})`)
      } catch (error) {
        console.log(`[state] ${state} (${theme}): failed — ${error && error.message ? error.message : error}; on to the next state`)
      }
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
