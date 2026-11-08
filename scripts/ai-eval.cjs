/**
 * Dev utility — NOT application code. **The assistant's evaluation suite.**
 *
 *   VITE_SGVUE_DEVTOOLS=1 npm run build
 *   SGVUE_MAX_SECONDS=900 node scripts/safe-run.cjs ai-eval.cjs --dry-run
 *
 * It asks the assistant the thirty-odd questions in `eval/cases.cjs` — one turn each, through
 * the **real** gateway in `src/main/ai/`, the **real** tools and the **real** store — and
 * grades what came back with the pure functions in `eval/graders.cjs`. Results land in
 * `.claude/hillclimb/<flow>/<variant>/` — `results.jsonl`, `metrics.json` and `traces/` — in
 * the shape `docs/AI_EVAL.md` describes ("What a run leaves"), and the summary is printed at
 * the end.
 * There is no HTML report: the builder that made one was vendored from an external evaluation
 * toolkit whose licence was never recorded, so it is not distributed (2026-10-05).
 *
 * **Three properties, and everything else follows from them:**
 *
 * 1. **One window per case.** A fresh `WebContents` is a fresh conversation — `session.ts`
 *    keys a gateway by window id, and there is no other way to clear the API transcript — and
 *    a fresh renderer is a fresh view state. Cases are independent by construction rather
 *    than by a reset function somebody has to keep correct.
 * 2. **Ground truth at grade time.** Every number a case checks comes out of the model
 *    database or a read-only tool call, seconds before the grading, on the fixture that is
 *    actually loaded. Nothing is typed in.
 * 3. **It cannot spend money by accident.** `--dry-run` and `--null` make no request at all,
 *    and before they start the runner **deletes `ANTHROPIC_API_KEY` from its own environment**,
 *    so even a bug that reached `ai:turn:start` would meet main's "no API key" branch. A live
 *    run refuses to start unless the key is already in the environment; it never asks for one
 *    and never reads one from disk.
 *
 * Modes:
 *   --dry-run   the ORACLE. Replays each case's ideal tool sequence through the real
 *               executors and fills its reply template from the truth probes. Must score
 *               100 %: it is the proof that the tools, the graders and the ground truth agree.
 *   --null      an agent that does nothing. Must score 0 on every case.
 *   (neither)   LIVE. Needs ANTHROPIC_API_KEY already in the environment. Spends real money.
 *
 * Flags: --regrade=<variant dir> (plain Node, no request — `eval/regrade.cjs`), --pilot[=<ids>], --only=<ids|groups|tags>, --fixture=<mock|mock-hostile|mock-messy>, --variant=v1,
 *        --flow=DIR, --reps=N, --timeout-s=N, --retries=N, --approve-harness, --model=<id>;
 *        --no-report is accepted and does nothing (there has been no report since 2026-10-05).
 * Env:   SGVUE_APP_OUT=<dir> runs the suite against a saved build directory instead of `out/`.
 *        SGVUE_IFC=<path>    the optional, opt-in real-model fixture (see docs/AI_EVAL.md).
 *
 * WebGL2 only and guarded, like every Electron script here.
 *
 * On Windows and Linux one hidden, empty window is kept open for the whole run (2026-10-01):
 * the real main quits there on `window-all-closed`, and the suite is without a window between
 * the probe and the first case and between any two cases — so until then it ended before its
 * first case. macOS, which does not quit there, gets no such window and is unchanged.
 *
 * 2026-10-02: the view a grader reads (`VIEW_EXPR`) also carries what the assistant can now set
 * — the display switches, the hidden models, each model's colour override, the section planes,
 * the undo history's two flags and the interface — all from `get_view_state`.
 *
 * The same day, phase 2: it carries the camera as `get_view_state` reads it back (direction,
 * named view, projection), the saved viewpoints, and — off the viewer itself, rounded — where
 * the camera stands and how far out, so a fit that does not turn can be graded. And **a case
 * starts with empty `localStorage`**: the assistant can now save a viewpoint, a viewpoint is
 * kept per building in `localStorage`, and every window of a run shares one storage partition —
 * so without that a case would meet the viewpoints (and the named filter sets) an earlier case
 * saved. Cleared before the window loads, in `openFixture`.
 *
 * Phase 3, the consent gate: the view also carries the loaded models and the base point (both
 * from `get_view_state` — the base point read-only since 2026-10-08, so only "nothing moved"
 * reads it), and the store the saved filter sets by name and what the sidebar's
 * unload confirmation reads, if it is up — so a case can show that a request left all of it
 * alone, and what the user's Apply then did. The Apply is the store's own `applyPending`, as it
 * always was here; a request that needs a real click — a clipboard write wants user activation —
 * is asked for and not applied by the runner.
 *
 * Phase 4: the store also carries the Markups card's two lists — each record's id and where it
 * stands — read off the app's own store, because the assistant can place one now.
 *
 * 2026-11-08, the Ask Vee eval cases:
 *   · **a conversation** — a case's `turns` are user turns sent before its own `prompt`, in the
 *     same window and so the same conversation; each is graded on its own `expect` where it has
 *     one, the last on the case's, and the row's usage is every turn's, summed;
 *   · **a Schedules window** — a case with `harness.schedules` gets the dev stand-in for it
 *     (`src/renderer/dev/schedules-standin.ts`), joined before its setup runs, and the view
 *     carries what it shows and was asked for (`store.schedules`);
 *   · **the messy fixture** — `#mock&messy` (`src/renderer/dev/messy.ts`);
 *   · **run counts** — each case runs `runsOf(case)` times (`cases.cjs`: three for the tagged
 *     new and tricky cases, one for the rest) unless `--reps=N` sets one count for all;
 *     `--pilot` is five named cases, once each; and before a run starts the runner prints what
 *     it should roughly cost, and writes it, beside what it measured per case, to `metrics.json`;
 *   · **stage 2** — a case that needs what is not built yet is n/a, with the reason printed.
 */
/*
 * 2026-11-08 — `--regrade=<variant dir>`: re-score a saved run with the graders as they are now,
 * under plain Node — no Electron, no window, no request (`eval/regrade.cjs`). It writes
 * `results.regrade.jsonl` and `metrics.regrade.json` beside the run's own files and touches none.
 */
const REGRADE = process.argv.find((a) => a.startsWith('--regrade='))
if (REGRADE) {
  const { join: joinPath, resolve: resolvePath } = require('node:path')
  const dir = resolvePath(REGRADE.slice('--regrade='.length))
  require('./eval/regrade.cjs')
    .regradeDir(dir, joinPath(__dirname, '..'), require('./eval/cases.cjs').CASES)
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2))
      console.log(`\nai-eval: re-graded ${summary.scored} of ${summary.rows} row(s) in ${dir} — written to metrics.regrade.json`)
      process.exit(0)
    })
    .catch((error) => {
      console.error(`ai-eval: --regrade failed — ${error.message}`)
      process.exit(70)
    })
  return
}

const { app, BrowserWindow } = require('electron')
const { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { createHash } = require('node:crypto')
const { basename, join, resolve } = require('node:path')

const ROOT = join(__dirname, '..')
const { CASES, PILOT_IDS, PILOT_MAX, runsOf, selectCases } = require('./eval/cases.cjs')
const { capabilityTags, missingCapabilities, whyMissing } = require('./eval/capabilities.cjs')
const { TRANSIENT_KINDS, failureClass, gradeCase } = require('./eval/graders.cjs')
const { estimateRun, measuredTurn, money, pricedUsage, turnCost } = require('./eval/cost.cjs')
const { rowsOfRun, summarise } = require('./eval/summary.cjs')
const { collectTruth, lateTruth, nullTurn, observation, oracleTurn, scriptedCalls, skippedTurn, turnsOf, withEarlier } = require('./eval/observe.cjs')

/* ────────────────────────────── arguments ────────────────────────────── */

function parseArgs(argv) {
  const a = {
    mode: 'live',
    flow: null,
    variant: 'baseline',
    // null: each case runs `runsOf(case)` times; a number from --reps sets one count for all.
    reps: null,
    pilot: false,
    timeoutS: 240,
    retries: 3,
    only: [],
    fixture: null,
    approveHarness: false,
    // 2026-11-09 — the model this run asks for, set in the run's own throwaway settings; null
    // keeps whatever the app's settings say (its default, in safe-run's fresh `userData`).
    model: null
  }
  for (const raw of argv) {
    const [k, v] = raw.includes('=') ? [raw.slice(0, raw.indexOf('=')), raw.slice(raw.indexOf('=') + 1)] : [raw, null]
    if (k === '--dry-run') a.mode = 'oracle'
    else if (k === '--null') a.mode = 'null'
    else if (k === '--live') a.mode = 'live'
    else if (k === '--pilot') {
      // `--pilot` is the five in PILOT_IDS; `--pilot=a,b,c` names its own (at most PILOT_MAX).
      const named = v ? String(v).split(',').map((x) => x.trim()).filter(Boolean) : PILOT_IDS
      if (!named.length || named.length > PILOT_MAX) {
        console.error(`ai-eval: --pilot takes 1 to ${PILOT_MAX} case ids, got ${named.length}`)
        process.exit(64)
      }
      const unknown = named.filter((id) => !CASES.some((c) => c.id === id))
      if (unknown.length) {
        console.error(`ai-eval: --pilot names no such case: ${unknown.join(', ')}`)
        process.exit(64)
      }
      a.pilot = true
      a.only = a.only.concat(named)
    }
    else if (k === '--only') a.only = a.only.concat(String(v || '').split(','))
    else if (k === '--fixture') a.fixture = v
    else if (k === '--flow') a.flow = v
    else if (k === '--variant') a.variant = v
    else if (k === '--reps') a.reps = Number(v)
    else if (k === '--timeout-s') a.timeoutS = Number(v)
    else if (k === '--retries') a.retries = Number(v)
    else if (k === '--approve-harness') a.approveHarness = true
    else if (k === '--model') a.model = v
    // A no-op: there has been no report since 2026-10-05. Accepted so old command lines still run.
    else if (k === '--no-report') continue
    else if (k.startsWith('--user-data-dir')) continue // safe-run's own switch
    else if (k.startsWith('--')) {
      console.error(`ai-eval: unknown argument ${k}`)
      process.exit(64)
    }
  }
  if (a.reps !== null && !(Number.isInteger(a.reps) && a.reps >= 1)) {
    console.error(`ai-eval: --reps must be a whole number of at least 1, got ${a.reps}`)
    process.exit(64)
  }
  // A model id is a short slug (`MODEL_ID_MAX` in the app's settings contract is 200).
  if (a.model !== null && !/^[a-z0-9][a-z0-9.-]{0,199}$/.test(String(a.model))) {
    console.error(`ai-eval: --model must be a model id such as claude-sonnet-5-5, got '${a.model}'`)
    process.exit(64)
  }
  if (!/^(baseline|v[1-9]\d*)$/.test(a.variant)) {
    console.error(`ai-eval: --variant must be 'baseline' or 'v<N>', got '${a.variant}'`)
    process.exit(64)
  }
  // The wiring proofs write beside the live flow, never into it: an oracle's 100 % and a null
  // agent's 0 % in the same directory as the baseline would corrupt the only numbers a live
  // run exists to produce.
  if (!a.flow) {
    a.flow =
      a.mode === 'oracle'
        ? '.claude/hillclimb/assistant-oracle'
        : a.mode === 'null'
          ? '.claude/hillclimb/assistant-null'
          : '.claude/hillclimb/assistant'
  }
  return a
}

const ARGS = parseArgs(process.argv.slice(2))
const LIVE = ARGS.mode === 'live'

/* ────────────────────────────── the money gate ────────────────────────────── */

if (LIVE && !process.env.ANTHROPIC_API_KEY) {
  console.log(
    'ai-eval: a live run needs ANTHROPIC_API_KEY already in the environment. It is never asked\n' +
      '         for and never read from disk. Run the wiring proofs instead:\n' +
      '           node scripts/safe-run.cjs ai-eval.cjs --dry-run\n' +
      '           node scripts/safe-run.cjs ai-eval.cjs --null'
  )
  process.exit(0)
}
if (!LIVE) {
  // Belt and braces: with no key in the environment and safe-run's throwaway `userData` (so no
  // stored key either), an accidental `ai:turn:start` meets main's own "no API key" branch.
  delete process.env.ANTHROPIC_API_KEY
}

/* ────────────────────────────── the app under test ────────────────────────────── */

const APP_OUT = process.env.SGVUE_APP_OUT ? resolve(process.env.SGVUE_APP_OUT) : join(ROOT, 'out')
for (const p of ['main/index.js', 'preload/index.js', 'renderer/index.html']) {
  if (!existsSync(join(APP_OUT, p))) {
    console.error(`ai-eval: ${join(APP_OUT, p)} is missing — run \`VITE_SGVUE_DEVTOOLS=1 npm run build\` first`)
    process.exit(66)
  }
}

const { installGuard } = require('./lib/electron-guard.cjs')
const { resolveBackend } = require('./lib/backend.cjs')

const MODEL_PATH = process.env.SGVUE_IFC && process.env.SGVUE_IFC !== 'mock' ? process.env.SGVUE_IFC : null

/**
 * **The real main process.** Requiring the built bundle is what puts the actual gateway, the
 * actual IPC table and the actual settings path behind the window — an eval that re-wired any
 * of them would be measuring the harness.
 *
 * electron-vite externalises main's `dependencies`, so the bundle does `require('zod')` and
 * `require('@anthropic-ai/sdk')` at load and Node resolves those by walking **up from the
 * bundle**. A build directory copied somewhere with no `node_modules` above it therefore
 * fails here, at load, with a stack nobody would read as "put it inside the checkout".
 */
try {
  require(join(APP_OUT, 'main/index.js'))
} catch (error) {
  console.error(`ai-eval: could not load ${join(APP_OUT, 'main/index.js')} — ${error.message}`)
  if (error.code === 'MODULE_NOT_FOUND') {
    console.error(
      '        SGVUE_APP_OUT must point at a build directory that has a node_modules above it —\n' +
        `        keep a saved baseline inside the checkout, e.g. ${join(ROOT, 'out-baseline')}.`
    )
  }
  process.exit(66)
}

const { hash: BACKEND_HASH } = resolveBackend('mock')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const guard = installGuard({
  label: `ai-eval (${ARGS.mode})`,
  maxSeconds: Number(process.env.SGVUE_MAX_SECONDS || 900)
})

/* ────────────────────────────── the run directory ────────────────────────────── */

const FLOW = resolve(ROOT, ARGS.flow)
const VDIR = join(FLOW, ARGS.variant)
const RESULTS = join(VDIR, 'results.jsonl')
const ERRORS = join(VDIR, 'errors.jsonl')
const STATE = join(FLOW, '_state.json')

const METRICS = [
  { id: 'pass', label: 'pass', kind: 'binary' },
  { id: 'no_write', label: 'no write', kind: 'binary' },
  { id: 'facts', label: 'facts', kind: 'float', scale: 1 },
  { id: 'tools_ok', label: 'tool use', kind: 'binary' }
]
const PERF_FIELDS = [
  { id: 'cost_usd', label: 'cost', unit: '$' },
  { id: 'latency_s', label: 'wall', unit: 's' },
  { id: 'rounds', label: 'rounds' },
  { id: 'tool_calls', label: 'tools' },
  { id: 'in_tokens', label: 'in tok' },
  { id: 'out_tokens', label: 'out tok' },
  { id: 'cache_read_tokens', label: 'cache rd' },
  { id: 'cache_write_tokens', label: 'cache wr' }
]
/** Files the harness-integrity sha covers, relative to the repository root. */
const HARNESS_PATHS = [
  'scripts/ai-eval.cjs',
  'scripts/eval/cases.cjs',
  'scripts/eval/graders.cjs',
  'scripts/eval/capabilities.cjs',
  'scripts/eval/cost.cjs',
  // 2026-11-08: the conversation and the heads-up are read there.
  'scripts/eval/observe.cjs',
  // 2026-11-09: `metrics.json` is built there, from every row.
  'scripts/eval/summary.cjs'
]

function readState() {
  if (!existsSync(STATE)) return {}
  try {
    return JSON.parse(readFileSync(STATE, 'utf8')) || {}
  } catch (error) {
    console.error(`ai-eval: ${STATE} exists but is not valid JSON (${error.message})`)
    process.exit(2)
  }
}

/**
 * The harness-integrity gate, on **live runs only**.
 *
 * Its point is that an unattended, allowlisted round cannot execute harness code nobody read
 * (`runner-scaffold.mjs`). The two offline modes exist to be run over and over, make no
 * request and spend nothing, so gating them would buy nothing and cost the wiring proof.
 * A live run spends money and is the one a hillclimb would later drive, so it is gated.
 */
function checkHarness(state) {
  const h = createHash('sha256')
  const hashed = []
  for (const rel of [...HARNESS_PATHS].sort()) {
    const p = join(ROOT, rel)
    if (!existsSync(p)) continue
    h.update(rel).update('\0').update(readFileSync(p)).update('\0')
    hashed.push(rel)
  }
  const sha = h.digest('hex')
  if (state.harness_sha === sha) return state
  if (ARGS.approveHarness) {
    state.harness_sha = sha
    state.harness_paths = HARNESS_PATHS
    mkdirSync(FLOW, { recursive: true })
    writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n')
    console.error(`ai-eval: harness approved — sha256 ${sha.slice(0, 12)} over ${hashed.length} file(s)`)
    return state
  }
  console.error(
    state.harness_sha == null
      ? `ai-eval: no approved harness sha in ${ARGS.flow}/_state.json (computed ${sha.slice(0, 12)}).\n` +
          '         Review the runner, the cases and the graders, then run once with --approve-harness.'
      : `ai-eval: the harness changed since the last approved run (approved ${String(state.harness_sha).slice(0, 12)}, now ${sha.slice(0, 12)}).\n` +
          '         Re-run with --approve-harness after reading the diff.'
  )
  process.exit(2)
}

function ensureState() {
  mkdirSync(join(VDIR, 'traces'), { recursive: true })
  let state = readState()
  state.metrics = METRICS
  state.perf_fields = PERF_FIELDS
  state.harness_paths = HARNESS_PATHS
  if (LIVE) state = checkHarness(state)
  writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n')
  // A hard crash can leave a torn final line; isolate it before appending anything.
  for (const p of [RESULTS, ERRORS]) {
    if (!existsSync(p)) continue
    const buf = readFileSync(p)
    if (buf.length && buf[buf.length - 1] !== 0x0a) appendFileSync(p, '\n')
  }
}

/** `(case, rep)` → the row's status, so resume can tell a scored row from an `n/a` one. */
function doneKeys() {
  const done = new Map()
  if (!existsSync(RESULTS)) return done
  for (const line of readFileSync(RESULTS, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line)
      done.set(`${row.prompt_id}\u0000${row.rep}`, row.status || 'ok')
    } catch {
      /* a torn line is not a completed case */
    }
  }
  return done
}

/** Every row already in this variant's `results.jsonl` — the measured basis for the estimate. */
function readRows() {
  if (!existsSync(RESULTS)) return []
  const rows = []
  for (const line of readFileSync(RESULTS, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      rows.push(JSON.parse(line))
    } catch {
      /* a torn line is not a row */
    }
  }
  return rows
}

/* ────────────────────────────── driving one window ────────────────────────────── */

const WIN_OPTS = {
  width: 1280,
  height: 820,
  useContentSize: true,
  // Shown, exactly as every other harness here shows its window: a hidden renderer is
  // throttled by Chromium and the viewer's first frame is part of loading a federation.
  show: true,
  backgroundColor: '#0F1516',
  webPreferences: {
    preload: join(APP_OUT, 'preload/index.js'),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webviewTag: false
  }
}

/** A window loaded on one fixture, with the federation on screen — and nothing in `localStorage`. */
async function openFixture(fixture) {
  const win = new BrowserWindow(WIN_OPTS)
  // Saved viewpoints and named filter sets live in `localStorage`, which every window of the
  // run shares: what one case saved must not be there for the next (2026-10-02).
  await win.webContents.session.clearStorageData({ storages: ['localstorage'] })
  win.webContents.on('console-message', (e) => {
    if (/error|Error/.test(e.message)) console.log(`   [renderer] ${e.message}`)
  })
  if (MODEL_PATH) {
    await win.loadFile(join(APP_OUT, 'renderer/index.html'), BACKEND_HASH ? { hash: BACKEND_HASH } : undefined)
  } else {
    const variant = fixture === 'mock-hostile' ? 'hostile' : fixture === 'mock-messy' ? 'messy' : ''
    const hash = ['mock', variant, BACKEND_HASH].filter(Boolean).join('&')
    await win.loadFile(join(APP_OUT, 'renderer/index.html'), { hash })
  }
  const js = (code) => win.webContents.executeJavaScript(code)
  if (!(await js('!!window.__sgvueDev'))) {
    throw new Error('no window.__sgvueDev — rebuild with VITE_SGVUE_DEVTOOLS=1')
  }
  if (MODEL_PATH) {
    await js(
      `window.__sgvueDev.openPath(${JSON.stringify(resolve(ROOT, MODEL_PATH))}).then(() => null)`
    )
  }
  for (let i = 0; i < 200; i++) {
    const n = await js('window.__sgvueDev.federation().elements.length')
    if (n > 0) return { win, js }
    await wait(100)
  }
  throw new Error('the federation never loaded')
}

/**
 * Read a value out of the renderer as JSON.
 *
 * `Promise.resolve(...)` is not decoration: half of these expressions are tool calls, and
 * `JSON.stringify(aPromise)` is `{}` — silently, with no error anywhere.
 */
const jsonOf = async (js, expr) =>
  JSON.parse(await js(`Promise.resolve(${expr}).then((v) => JSON.stringify(v === undefined ? null : v))`))

/**
 * Everything a grader reads about the view, in one round trip.
 *
 * 2026-10-02: plus what the assistant can now set and `get_view_state` reads back — the display
 * switches, which models are hidden, each model's colour override, the section planes, the undo
 * history's two flags and the interface. A build from before that reports none of them, and
 * `undefined` is simply not in the JSON.
 *
 * Phase 2, the same day: the camera's read-back and the saved viewpoints, from `get_view_state`;
 * and `store.pose` — the camera's target, distance and orthographic half-height, read off the
 * viewer and rounded to the millimetre — because the read-back says which way the camera looks
 * and not how far out it stands, and "fit this without turning" is graded on exactly that.
 *
 * Phase 3: the loaded models and the base point from `get_view_state`; the saved filter sets'
 * names from `manage_filters`' own `list_sets` (a read); and the text of the sidebar's inline
 * "Unload …?" confirmation, read off the page — `null` while it is not up.
 *
 * Phase 4: `store.markups` — the laser measurements and the spot coordinates, each with its
 * own id and, rounded to the millimetre, what it reads: a measurement's three lengths, a spot's
 * point in the file's own coordinates.
 *
 * After its review: a measurement also carries `p`, the point it was taken from, in the file's
 * own coordinates like a spot's — three lengths say nothing about where it stands, so a
 * measurement placed anywhere passed. The viewer keeps that point in scene coordinates
 * (`MeasureRecord.p`), which stand the scene's whole-metre offset off the file's; the offset is
 * added here, as the viewer adds it for a spot.
 */
const VIEW_EXPR = `(async () => {
  const dev = window.__sgvueDev
  const view = await dev.tool('get_view_state', {})
  const scheme = dev.scheme()
  return {
    view: {
      filterStack: view.filterStack,
      visibleElements: view.visibleElements,
      totalElements: view.totalElements,
      hiddenManually: view.hiddenManually,
      storeysShown: view.storeysShown,
      activeModel: view.activeModel,
      view: view.view,
      projection: view.projection,
      section: view.section,
      selectedCount: view.selectedCount,
      display: view.display,
      modelsHidden: view.modelsHidden,
      models: view.models,
      sectionPlanes: view.sectionPlanes,
      history: view.history,
      interface: view.interface,
      camera: view.camera,
      viewpoints: view.viewpoints,
      loadedModels: view.loadedModels,
      basePoint: view.basePoint,
      ifcsg: view.ifcsg
    },
    store: {
      stack: dev.evalStack(),
      filterSets: ((await dev.tool('manage_filters', { op: 'list_sets' })).sets || []).map((x) => x.name),
      unloadAsk: (() => {
        const strip = document.querySelector('aside [role="dialog"][aria-modal="false"] span')
        // (Doubled: this is inside a template literal, where a lone backslash-s is just "s".)
        return strip ? (strip.textContent || '').replace(/\\s+/g, ' ').trim() : null
      })(),
      colorBy: scheme ? { prop: scheme.prop, groups: scheme.groups.map((g) => ({ v: g.v, n: g.n, color: g.color })) } : null,
      markups: (() => {
        const mm = (n) => (typeof n === 'number' ? Math.round(n * 1000) / 1000 : null)
        const off = dev.debug().offset || [0, 0, 0]
        const at = (p) => (Array.isArray(p) ? [0, 1, 2].map((i) => mm(p[i] + off[i])) : null)
        return {
          measures: dev.measures().map((m) => ({ id: m.id, x: mm(m.x), y: mm(m.y), z: mm(m.z), p: at(m.p) })),
          spots: dev.spots().map((p) => ({ id: p.id, x: mm(p.x), y: mm(p.y), z: mm(p.z) }))
        }
      })(),
      pose: (() => {
        const mm = (n) => Math.round(n * 1000) / 1000
        const cam = dev.viewer.getCamera()
        return { target: cam.target.map(mm), dist: mm(cam.dist), half: mm(cam.half), proj: cam.proj }
      })(),
      schedules: dev.schedules ? await dev.schedules.state() : null
    }
  }
})()`

const readView = (js) => jsonOf(js, VIEW_EXPR)

/* ────────────────────────────── ground truth ────────────────────────────── */

/**
 * The window's answers to a case's probes: a SELECT through the app's own SQL worker, a read
 * through the real executor. `collectTruth` itself is in `eval/observe.cjs`, shared with the
 * headless runner (2026-11-07).
 */
const probesIn = (js) => ({
  sql: (statement) => jsonOf(js, `window.__sgvueDev.sql(${JSON.stringify(statement)})`),
  tool: (name, input) => jsonOf(js, `window.__sgvueDev.tool(${JSON.stringify(name)}, ${JSON.stringify(input || {})})`)
})

/* ────────────────────────────── running one case ────────────────────────────── */

const lastAssistant = `(() => {
  const msgs = window.__sgvueDev.chat.messages()
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'assistant') return { i, m: msgs[i] }
  return null
})()`

/**
 * One user turn of a case — the case itself, or one of its earlier `turns` (`turnsOf`), each
 * `{ prompt, oracle, choice? }`. In one window, so every turn of a case is one conversation.
 *
 * `choice` (stage 2) is a quick reply the user clicks before the turn's text is sent — the
 * IFC+SG question's Yes or No — through `window.__sgvueDev.chat.choose`, which a stage-2 build
 * provides; a case that has one is n/a on any earlier build, so it is never reached there.
 */
async function runTurn(js, turn, truth) {
  if (ARGS.mode === 'null') return nullTurn()
  if (turn.choice !== undefined) {
    if (!(await js('typeof window.__sgvueDev.chat.choose === "function"'))) {
      throw new Error('this build has no window.__sgvueDev.chat.choose, which a case with a quick reply needs')
    }
    // 2026-11-09 — a quick reply is clicked only when a question was shown: with none to answer
    // (`chooseReply` says false) the user has no button, so the turn is not taken, and it is
    // recorded as skipped (`skippedTurn`) rather than sending the reply's text into a conversation
    // that never asked — what the v4 / v5 runs did.
    const chose = await js(`window.__sgvueDev.chat.choose(${JSON.stringify(turn.choice)})`)
    if (chose !== true) return skippedTurn(turn.choice)
  }
  if (ARGS.mode === 'oracle') {
    const { calls, reply } = oracleTurn(turn, truth)
    const out = await jsonOf(
      js,
      `window.__sgvueDev.chat.turn(${JSON.stringify(turn.prompt)}, ${JSON.stringify(calls)}, ${JSON.stringify(reply)})`
    )
    return {
      reply,
      calls: scriptedCalls(calls, out.results),
      outcome: { type: 'done', rounds: out.results.length ? 1 : 0 },
      usage: null,
      model: null,
      index: out.index
    }
  }
  // Live: the panel's own path, recorded.
  await js('window.__sgvueDev.chat.record(true)')
  await js(`window.__sgvueDev.chat.send(${JSON.stringify(turn.prompt)})`)
  const record = await jsonOf(js, 'window.__sgvueDev.chat.recorded()')
  const log = await jsonOf(js, 'window.__sgvueDev.chat.log()')
  const msg = await jsonOf(js, lastAssistant)
  const snapshot = await js('window.__sgvueDev.chat.snapshot()')
  let requested = null
  try {
    requested = JSON.parse(snapshot).model || null
  } catch {
    /* no snapshot is a harness failure, reported by the missing model */
  }
  /**
   * 2026-09-20. The model that **served** the turn, carried on the `usage` event from the
   * response itself. `fallbacks: 'default'` is on, so the request's model is what was asked
   * for and need not be what answered — which is the gap `docs/AI_EVAL.md` recorded under
   * "What the suite does not do". The request snapshot stays as the fallback.
   */
  const served = (log.usage && log.usage.model) || null
  const model = served || requested
  const error = await js('window.__sgvueDev.chat.error()')
  return {
    reply: msg && msg.m ? msg.m.text : '',
    calls: record.calls || [],
    outcome: record.outcome || (error ? { type: 'error', kind: 'unknown', message: error } : { type: 'done' }),
    usage: log.usage,
    model,
    modelServed: served,
    modelRequested: requested,
    index: msg ? msg.i : -1,
    snapshotBytes: snapshot.length
  }
}

/** One case, start to finish, in its own window. */
async function runCase(kase, rep, caps, settings) {
  const started = Date.now()
  const { win, js } = await openFixture(kase.fixture)
  try {
    // A Schedules window for the cases that need one: the stand-in joins before the setup runs.
    if (kase.harness && kase.harness.schedules) await js('window.__sgvueDev.schedules.attach()')
    for (const step of kase.setup || []) {
      await jsonOf(
        js,
        `window.__sgvueDev.tool(${JSON.stringify(step.tool)}, ${JSON.stringify(step.input || {})})`
      )
    }
    const asked = await collectTruth(kase, probesIn(js))
    const start = await readView(js)
    // Every user turn in order, one conversation; the last is the case's own.
    const all = turnsOf(kase)
    const earlier = []
    let before = start
    let turn = null
    let after = start
    let message = null
    for (let i = 0; i < all.length; i++) {
      turn = await runTurn(js, all[i], asked)
      after = await readView(js)
      message = turn.index >= 0 ? await jsonOf(js, `window.__sgvueDev.chat.messages()[${turn.index}]`) : null
      if (i < all.length - 1) {
        earlier.push(observation(turn, before, after, message))
        before = after
      }
    }
    const obs = withEarlier(observation(turn, before, after, message), earlier, start)

    // The scope guard's Apply button, clicked only where the case says the user would.
    if (kase.applyPending && obs.store.pending && turn.index >= 0) {
      await js(`window.__sgvueDev.chat.apply(${turn.index})`)
      const applied = await readView(js)
      obs.afterApply = { view: applied.view, store: applied.store }
    }

    const kindOf = (name) => {
      const t = caps.tools.find((x) => x.name === name)
      return t ? t.kind : 'unknown'
    }
    // A probe that follows the turn's own call is run again now (`lateTruth`, 2026-11-08 F6).
    const truth = await lateTruth(kase, asked, obs.calls, probesIn(js))
    const graded = gradeCase(kase, obs, truth, kindOf)
    // Priced per request (`pricedUsage`): Haiku 5.5's rate card is chosen by one request's prompt.
    const cost = turnCost(pricedUsage(obs), turn.model || settings.model, settings.cacheOneHour)
    return {
      obs,
      truth,
      graded,
      cost,
      model: turn.model || settings.model,
      // Which of the two the `model` column is, so a reader never has to guess.
      modelSource: turn.modelServed ? 'served' : turn.model ? 'requested' : 'settings',
      ...(turn.modelServed && turn.modelRequested && turn.modelServed !== turn.modelRequested
        ? { modelRequested: turn.modelRequested }
        : {}),
      latency_s: (Date.now() - started) / 1000,
      snapshotBytes: turn.snapshotBytes || 0
    }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

/* ────────────────────────────── the trace ────────────────────────────── */

const pretty = (v) => {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

/** `traces/<id>_rep<k>.json` — `{role, content, name?}` turns. */
function traceOf(kase, obs, truth) {
  const turns = [
    {
      role: 'system',
      content:
        `fixture: ${kase.fixture}\n` +
        `group: ${kase.group}\n` +
        (kase.setup ? `setup: ${kase.setup.map((s) => s.tool).join(', ')}\n` : '') +
        `ground truth (computed at grade time):\n${pretty(truth)}\n` +
        `view before the ${obs.earlier ? 'first ' : ''}turn:\n${pretty(obs.viewStart || obs.viewBefore)}`
    },
  ]
  // A conversation's earlier turns first, each with its own calls and reply.
  turnsOf(kase).slice(0, -1).forEach((t, i) => {
    const e = (obs.earlier || [])[i] || { calls: [], reply: '' }
    turns.push({ role: 'user', content: t.prompt + (t.choice ? `  (quick reply: ${t.choice})` : '') + (e.skipped ? `  — ${e.skipped}` : '') })
    for (const c of e.calls) {
      turns.push({ role: 'tool_call', name: c.name, content: pretty(c.input) })
      turns.push({ role: 'tool_result', content: c.ok ? pretty(c.result) : `ERROR: ${c.error}` })
    }
    turns.push({ role: 'assistant', content: e.reply || '(no reply)' })
  })
  turns.push({ role: 'user', content: kase.prompt })
  for (const c of obs.calls) {
    turns.push({ role: 'tool_call', name: c.name, content: pretty(c.input) })
    turns.push({ role: 'tool_result', content: c.ok ? pretty(c.result) : `ERROR: ${c.error}` })
  }
  turns.push({ role: 'assistant', content: obs.reply || '(no reply)' })
  turns.push({
    role: 'system',
    content:
      `view after the turn:\n${pretty(obs.view)}\n` +
      `stack:\n${pretty(obs.store.stack)}\n` +
      `table: ${obs.store.table ? pretty(obs.store.table) : 'none'}\n` +
      `pending: ${obs.store.pending ? obs.store.pending.label : 'none'}` +
      (obs.afterApply ? `\nview after Apply:\n${pretty(obs.afterApply.view)}` : '')
  })
  return turns
}

/* ────────────────────────────── the run ────────────────────────────── */


/**
 * Windows and Linux only: the hidden window that keeps the app from quitting mid-run (below).
 * Held here, and never read, so that the window cannot be collected.
 */
let keepAlive = null

app.whenReady().then(async () => {
  // The real main created its own window before this callback ran. It is loaded without a
  // fixture and no turn has ever been sent through it, so it is simply closed once the probe's
  // window exists.
  const strays = BrowserWindow.getAllWindows()
  // After that the run is without a window twice over: between the probe and the first case's
  // window, and between any two cases (one window per case). On macOS that is harmless. On
  // Windows and Linux the real main quits on `window-all-closed` (`src/main/index.ts`), so the
  // run ended before its first case — the next `loadFile` failed with ERR_FAILED (-2) and the
  // process exited 0 (2026-10-01). One hidden, empty window kept open for the whole run is
  // what stops that. It is made after `strays` was taken, so it is not closed with them; it
  // loads nothing, takes no turn and is in no case; and macOS gets none, so nothing changes
  // there. Every way out of this function is `app.exit`, which does not wait for it.
  if (process.platform !== 'darwin') {
    keepAlive = new BrowserWindow({ show: false, width: 200, height: 100 })
  }

  ensureState()
  const cases = selectCases(ARGS.only).filter((c) => !ARGS.fixture || c.fixture === ARGS.fixture)
  if (!cases.length) {
    console.error('ai-eval: no cases matched')
    return app.exit(64)
  }

  let probe
  try {
    probe = await openFixture(cases[0].fixture)
  } catch (error) {
    console.error(`ai-eval: could not open the fixture — ${error.message}`)
    return app.exit(70)
  }
  for (const w of strays) if (!w.isDestroyed()) w.destroy()

  const caps = await jsonOf(probe.js, 'window.__sgvueDev.capabilities()')
  // 2026-11-09 — `--model`: the run's own settings (safe-run's throwaway `userData`) name the
  // model, through the same call Preferences makes; the app's default is untouched. Every case's
  // window reads it from there, as the app does on every turn.
  if (ARGS.model) await jsonOf(probe.js, `window.sgvue.setSettings({ model: ${JSON.stringify(ARGS.model)} })`)
  const settings = await jsonOf(probe.js, 'window.sgvue.getSettings()')
  if (ARGS.model && settings.model !== ARGS.model) {
    console.error(`ai-eval: asked for --model=${ARGS.model} but the app's settings say ${settings.model}`)
    return app.exit(70)
  }
  const have = capabilityTags(caps)
  probe.win.destroy()

  const fixtures = [...new Set(cases.map((c) => c.fixture))]
  console.log(`\nai-eval — ${ARGS.mode} run`)
  // How many times each case runs: --reps for all of them, else its own count (`runsOf`), and a
  // pilot once each — its point is the first measured cost, not an error bar.
  const repsOf = (kase) => (ARGS.reps !== null ? ARGS.reps : ARGS.pilot ? 1 : runsOf(kase))
  const plan = cases
    .filter((c) => !missingCapabilities(c.requires, have))
    .map((c) => ({ id: c.id, runs: repsOf(c), turns: turnsOf(c).length }))
  const estimate = estimateRun(plan, settings.model, measuredTurn(readRows()))
  const tripled = plan.filter((p) => p.runs > 1).length
  console.log(
    `  cases        ${cases.length} (${plan.length} scorable) · ${estimate.runs} run(s)` +
      (ARGS.reps !== null ? ` — ${ARGS.reps} each (--reps)` : ARGS.pilot ? ' — once each (pilot)' : ` — ${tripled} case(s) run ${Math.max(1, ...plan.map((p) => p.runs))}×, the rest once`) +
      ` · ${estimate.turns} user turn(s)`
  )
  console.log(
    `  estimate     ~${(estimate.inTokens / 1e6).toFixed(2)} M in / ~${(estimate.outTokens / 1e6).toFixed(3)} M out tokens · ` +
      `${money(estimate.usdList)} at list prices with no cache discount` +
      (estimate.usdMeasured == null ? '' : ` · ${money(estimate.usdMeasured)} at the measured cost per turn`) +
      `\n               (${estimate.basis}${LIVE ? '' : '; this mode makes no request'})`
  )
  console.log(`  fixture      ${MODEL_PATH ? `REAL MODEL ${basename(MODEL_PATH)}` : fixtures.join(', ')}`)
  console.log(`  build        ${APP_OUT}`)
  console.log(`  capabilities ${have.join(', ')}`)
  console.log(`  model        ${settings.model}${ARGS.model ? ' (--model)' : ' (the app’s settings)'}`)
  console.log(`  results      ${ARGS.flow}/${ARGS.variant}/`)
  if (ARGS.model && ARGS.variant === 'baseline') {
    console.log('  note         --model without --variant writes into baseline/; give each model its own v<N>')
  }
  console.log(
    '  compare      like for like: every model run of this suite takes the same cases, each the same\n' +
      '               number of times (`runsOf`, or --reps), on the same fixture — compare variants that\n' +
      '               were run with the same --only / --reps / --pilot'
  )
  if (MODEL_PATH) {
    console.log(
      '\n  WARNING: a real model is loaded. Its vocabulary — storey, grid, entity, object-type\n' +
        '  and property-set names — and every tool result travel to api.anthropic.com on a live\n' +
        '  run. Nothing of it is written into this repository.'
    )
  }
  if (LIVE) {
    console.log(
      `\n  LIVE: ${estimate.turns} turns against ${settings.model} will be billed to the key in your\n` +
        '  environment. The first honest cost figure comes from the pilot — see docs/AI_EVAL.md.'
    )
  }
  console.log('')

  const already = doneKeys()
  const rows = []
  const naRows = []
  const errorRows = []

  for (const kase of cases) {
    for (let rep = 0; rep < repsOf(kase); rep++) {
      const missing = missingCapabilities(kase.requires, have)
      const prior = already.get(`${kase.id}\u0000${rep}`)
      if (prior !== undefined) {
        // An `n/a` row is a fact about the build that recorded it. If this build has grown the
        // capability since, resume would keep the stale row for ever — so say so rather than
        // appending a second row at the same (case, rep) key, which a reader of `results.jsonl`
        // would take for two reps of one case.
        if (prior === 'na' && !missing) {
          console.log(
            `  !  ${kase.id} rep${rep} — recorded n/a by an earlier build, and this one has ` +
              `${(kase.requires || []).join(', ')}. Delete ${ARGS.flow}/${ARGS.variant}/ to re-run it.`
          )
        } else {
          console.log(`  ·  ${kase.id} rep${rep} — already done, skipped`)
        }
        continue
      }
      if (missing) {
        const row = {
          prompt_id: kase.id,
          rep,
          prompt: kase.prompt,
          tags: kase.tags,
          status: 'na',
          grade: {},
          meta: { requires: kase.requires, missing, fixture: kase.fixture }
        }
        appendFileSync(RESULTS, JSON.stringify(row) + '\n')
        naRows.push(row)
        console.log(`  n/a ${kase.id} — ${whyMissing(missing)}`)
        continue
      }

      let out = null
      let lastError = null
      let retries = 0
      for (let attempt = 0; attempt <= ARGS.retries; attempt++) {
        try {
          out = await Promise.race([
            runCase(kase, rep, caps, settings),
            wait(ARGS.timeoutS * 1000).then(() => {
              const e = new Error(`exceeded the ${ARGS.timeoutS} s per-case ceiling`)
              e.failure_class = 'timeout'
              throw e
            })
          ])
          const kind = out.obs.outcome && out.obs.outcome.kind
          if (kind && TRANSIENT_KINDS.has(kind) && attempt < ARGS.retries) {
            const delay = Math.min(60_000, 1000 * 2 ** attempt) * (0.5 + Math.random())
            retries++
            console.log(`  ↻  ${kase.id} — ${kind}, backing off ${Math.round(delay)} ms`)
            await wait(delay)
            out = null
            continue
          }
          break
        } catch (error) {
          lastError = error
          out = null
          if (attempt >= ARGS.retries) break
          const delay = Math.min(60_000, 1000 * 2 ** attempt) * (0.5 + Math.random())
          retries++
          console.log(`  ↻  ${kase.id} — ${error.message}, retrying in ${Math.round(delay)} ms`)
          await wait(delay)
        }
      }

      if (!out) {
        const row = {
          prompt_id: kase.id,
          rep,
          failure_class: (lastError && lastError.failure_class) || 'harness',
          error: lastError ? String(lastError.message) : 'unknown',
          retries
        }
        appendFileSync(ERRORS, JSON.stringify(row) + '\n')
        errorRows.push(row)
        console.log(`  ✕  ${kase.id} rep${rep} FAILED: ${row.error}`)
        continue
      }

      const cls = failureClass(out.obs, out.graded.grade)
      // An attempt that never produced a scorable answer is plumbing, not a model failure.
      if (cls === 'harness' || cls === 'timeout') {
        const row = {
          prompt_id: kase.id,
          rep,
          failure_class: cls,
          error: (out.obs.outcome && out.obs.outcome.message) || cls,
          retries,
          model: out.model,
          usage: out.obs.usage,
          latency_s: out.latency_s
        }
        appendFileSync(ERRORS, JSON.stringify(row) + '\n')
        errorRows.push(row)
        console.log(`  ✕  ${kase.id} rep${rep} ${cls}: ${row.error}`)
        continue
      }

      // Token and cost columns exist only where a request was actually billed. The offline
      // modes make none, and a row of zeros there would read as a measurement.
      const usage = out.obs.usage
      const billed = usage
        ? {
            model: out.model,
            model_source: out.modelSource,
            ...(out.modelRequested ? { model_requested: out.modelRequested } : {}),
            usage,
            in_tokens: usage.inputTokens || 0,
            out_tokens: usage.outputTokens || 0,
            cache_read_tokens: usage.cacheReadTokens || 0,
            cache_write_tokens: usage.cacheCreateTokens || 0,
            ...(out.cost.usd == null ? {} : { cost_usd: Number(out.cost.usd.toFixed(6)) })
          }
        : {}
      const row = {
        prompt_id: kase.id,
        rep,
        prompt: kase.prompt,
        tags: kase.tags,
        ...(cls === 'truncated' ? { status: 'truncated' } : {}),
        stop_reason:
          out.obs.outcome && out.obs.outcome.type === 'done'
            ? 'end_turn'
            : (out.obs.outcome && out.obs.outcome.kind) || 'unknown',
        max_tokens_hit: !!(out.obs.outcome && out.obs.outcome.kind === 'max_tokens'),
        ...billed,
        grade: cls === 'truncated' ? {} : out.graded.grade,
        explanation: { pass: out.graded.reasons.join(' · ') || 'every check passed' },
        failure_class: cls,
        latency_s: Number(out.latency_s.toFixed(2)),
        rounds: (out.obs.outcome && out.obs.outcome.rounds) || 0,
        tool_calls: out.obs.calls.length + (out.obs.earlier || []).reduce((n, e) => n + e.calls.length, 0),
        // 2026-11-08: a conversation's user turns, and each one's own usage beside the summed one.
        turns: turnsOf(kase).length,
        ...(out.obs.earlier && usage ? { usage_turns: [...out.obs.earlier.map((e) => e.usage), out.obs.usageLast] } : {}),
        meta: {
          mode: ARGS.mode,
          fixture: kase.fixture,
          group: kase.group,
          truth: out.truth,
          tools: out.obs.calls.map((c) => c.name),
          ...(retries ? { retries } : {}),
          ...(usage && out.cost.rates ? { cache_ttl: out.cost.rates.ttl } : {})
        }
      }
      appendFileSync(RESULTS, JSON.stringify(row) + '\n')
      writeFileSync(
        join(VDIR, 'traces', `${kase.id}_rep${rep}.json`),
        JSON.stringify(traceOf(kase, out.obs, out.truth), null, 2)
      )
      rows.push(row)
      const mark = row.grade.pass === 1 ? '✓' : cls === 'truncated' ? '…' : '✗'
      console.log(
        `  ${mark}  ${kase.id.padEnd(22)} ${String(out.obs.calls.length).padStart(2)} call(s)` +
          `  ${out.latency_s.toFixed(1)}s  ${money(out.cost.usd)}` +
          (row.grade.pass === 1 ? '' : `\n         ${out.graded.reasons.join('\n         ')}`)
      )
      guard.sample(kase.id)
    }
  }

  // Every row the variant holds — a resumed run's earlier rows too (`rowsOfRun`, 2026-11-09).
  const run = rowsOfRun(existsSync(RESULTS) ? readFileSync(RESULTS, 'utf8') : '', existsSync(ERRORS) ? readFileSync(ERRORS, 'utf8') : '')
  const summary = { ...summarise(run.rows, run.naRows, run.errorRows), estimate, model_asked: settings.model }
  if (run.rows.length + run.naRows.length !== rows.length + naRows.length) {
    console.log(`   resumed    the summary covers all ${run.rows.length + run.naRows.length} row(s) of results.jsonl, ${rows.length + naRows.length} of them this run's`)
  }
  writeFileSync(join(VDIR, 'metrics.json'), JSON.stringify(summary, null, 2) + '\n')

  console.log(`\n── ${ARGS.mode} run, ${ARGS.flow}/${ARGS.variant}`)
  console.log(`   scored     ${summary.scored} of ${summary.scored + summary.errors}`)
  console.log(
    `   pass       ${summary.pass}/${summary.scored}` +
      (summary.pass_rate == null ? '' : ` (${(summary.pass_rate * 100).toFixed(0)} %)`)
  )
  for (const [g, v] of Object.entries(summary.by_group)) {
    console.log(`     ${g.padEnd(10)} ${v.pass}/${v.n}`)
  }
  console.log(`   n/a        ${summary.na}   errors ${summary.errors}`)
  if (LIVE) {
    console.log(
      `   measured   ${money(summary.cost_usd)} over ${summary.tokens.in} in / ${summary.tokens.out} out / ` +
        `${summary.tokens.cacheRead} cache-read / ${summary.tokens.cacheWrite} cache-write tokens` +
        (summary.unpriced ? `  (${summary.unpriced} row(s) had no rate card)` : '')
    )
    console.log(`   estimated  ${money(estimate.usdList)} before the run (${estimate.basis})`)
    for (const [m, l] of Object.entries(summary.latency_by_model)) {
      console.log(`   latency    ${m}: median ${l.median_s} s · p90 ${l.p90_s} s · ${l.s_per_turn} s a turn over ${l.turns} turn(s)`)
    }
    for (const [id, c] of Object.entries(summary.by_case)) {
      console.log(`     ${id.padEnd(30)} ${c.runs} run(s)  ${money(c.cost_usd)}`)
    }
  }

  guard.sample('done')
  app.exit(summary.errors ? 1 : 0)
})
