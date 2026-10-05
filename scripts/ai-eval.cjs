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
 * Flags: --pilot, --only=<ids|groups|tags>, --fixture=<mock|mock-hostile>, --variant=v1,
 *        --flow=DIR, --reps=N, --timeout-s=N, --retries=N, --approve-harness.
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
 * from `get_view_state`), and the store the saved filter sets by name and what the sidebar's
 * unload confirmation reads, if it is up — so a case can show that a request left all of it
 * alone, and what the user's Apply then did. The Apply is the store's own `applyPending`, as it
 * always was here; a request that needs a real click — a clipboard write wants user activation —
 * is asked for and not applied by the runner.
 *
 * Phase 4: the store also carries the Markups card's two lists — each record's id and where it
 * stands — read off the app's own store, because the assistant can place one now.
 */
const { app, BrowserWindow } = require('electron')
const { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { createHash } = require('node:crypto')
const { basename, join, resolve } = require('node:path')

const ROOT = join(__dirname, '..')
const { CASES, PILOT_IDS, selectCases } = require('./eval/cases.cjs')
const { capabilityTags, missingCapabilities } = require('./eval/capabilities.cjs')
const { TRANSIENT_KINDS, failureClass, gradeCase } = require('./eval/graders.cjs')
const { money, runCost, turnCost } = require('./eval/cost.cjs')

/* ────────────────────────────── arguments ────────────────────────────── */

function parseArgs(argv) {
  const a = {
    mode: 'live',
    flow: null,
    variant: 'baseline',
    reps: 1,
    timeoutS: 240,
    retries: 3,
    only: [],
    fixture: null,
    approveHarness: false
  }
  for (const raw of argv) {
    const [k, v] = raw.includes('=') ? [raw.slice(0, raw.indexOf('=')), raw.slice(raw.indexOf('=') + 1)] : [raw, null]
    if (k === '--dry-run') a.mode = 'oracle'
    else if (k === '--null') a.mode = 'null'
    else if (k === '--live') a.mode = 'live'
    else if (k === '--pilot') a.only = a.only.concat(PILOT_IDS)
    else if (k === '--only') a.only = a.only.concat(String(v || '').split(','))
    else if (k === '--fixture') a.fixture = v
    else if (k === '--flow') a.flow = v
    else if (k === '--variant') a.variant = v
    else if (k === '--reps') a.reps = Number(v)
    else if (k === '--timeout-s') a.timeoutS = Number(v)
    else if (k === '--retries') a.retries = Number(v)
    else if (k === '--approve-harness') a.approveHarness = true
    // A no-op: there has been no report since 2026-10-05. Accepted so old command lines still run.
    else if (k === '--no-report') continue
    else if (k.startsWith('--user-data-dir')) continue // safe-run's own switch
    else if (k.startsWith('--')) {
      console.error(`ai-eval: unknown argument ${k}`)
      process.exit(64)
    }
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
 * of them would be measuring the harness (`build-eval.md`, "Reimplementing the app").
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
  'scripts/eval/cost.cjs'
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
    const hash = ['mock', fixture === 'mock-hostile' ? 'hostile' : '', BACKEND_HASH].filter(Boolean).join('&')
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
      basePoint: view.basePoint
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
      })()
    }
  }
})()`

const readView = (js) => jsonOf(js, VIEW_EXPR)

/* ────────────────────────────── ground truth ────────────────────────────── */

/** A dot path, `len:<path>` or `max:<path>.<field>` into a tool's `forModel`. */
function pickFrom(result, expr) {
  const dot = (obj, path) => String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
  if (expr.startsWith('len:')) {
    const v = dot(result, expr.slice(4))
    return Array.isArray(v) ? v.length : null
  }
  if (expr.startsWith('max:')) {
    const rest = expr.slice(4)
    const cut = rest.lastIndexOf('.')
    const list = dot(result, rest.slice(0, cut))
    const field = rest.slice(cut + 1)
    if (!Array.isArray(list) || !list.length) return null
    return Math.max(...list.map((x) => Number(x[field])).filter((n) => Number.isFinite(n)))
  }
  const v = dot(result, expr)
  return v === undefined ? null : v
}

/**
 * Every probe a case declares, run **after** its setup and **before** its turn, so a case with
 * a pre-existing selection or filter is graded against the state it was actually given.
 */
async function collectTruth(js, kase) {
  const truth = {}
  for (const [name, probe] of Object.entries(kase.truth || {})) {
    if (probe.sql) {
      const r = await jsonOf(js, `window.__sgvueDev.sql(${JSON.stringify(probe.sql)})`)
      const rows = r.rows || []
      truth[name] =
        probe.shape === 'pairs'
          ? rows.map((row) => [row[0], row[1]])
          : probe.shape === 'column'
            ? rows.map((row) => row[0])
            : probe.shape === 'rows'
              ? rows
              : rows.length
                ? rows[0][0]
                : null
    } else if (probe.tool) {
      const r = await jsonOf(
        js,
        `window.__sgvueDev.tool(${JSON.stringify(probe.tool)}, ${JSON.stringify(probe.input || {})})`
      )
      truth[name] = probe.pick ? pickFrom(r, probe.pick) : r
    }
  }
  return truth
}

/** `{key}` in an oracle's reply or tool input, filled from the probes. */
function fillTemplate(value, truth) {
  if (typeof value === 'string') {
    const whole = /^\{([A-Za-z0-9_]+)\}$/.exec(value)
    if (whole) return truth[whole[1]]
    return value.replace(/\{([A-Za-z0-9_]+)\}/g, (m, k) => (k in truth ? String(truth[k]) : m))
  }
  if (Array.isArray(value)) return value.map((v) => fillTemplate(v, truth))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillTemplate(v, truth)]))
  }
  return value
}

/* ────────────────────────────── running one case ────────────────────────────── */

const lastAssistant = `(() => {
  const msgs = window.__sgvueDev.chat.messages()
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'assistant') return { i, m: msgs[i] }
  return null
})()`

async function runTurn(js, kase, truth) {
  if (ARGS.mode === 'null') {
    return { reply: '', calls: [], outcome: { type: 'done', rounds: 0 }, usage: null, model: null, index: -1 }
  }
  if (ARGS.mode === 'oracle') {
    const calls = (kase.oracle.calls || []).map((c) => ({ name: c.name, input: fillTemplate(c.input || {}, truth) }))
    const reply = fillTemplate(kase.oracle.reply || '', truth)
    const out = await jsonOf(
      js,
      `window.__sgvueDev.chat.turn(${JSON.stringify(kase.prompt)}, ${JSON.stringify(calls)}, ${JSON.stringify(reply)})`
    )
    return {
      reply,
      calls: out.results.map((r, i) => ({
        name: r.name,
        input: calls[i] ? calls[i].input : {},
        ok: r.ok,
        ms: r.ms,
        result: r.forModel,
        error: r.error
      })),
      outcome: { type: 'done', rounds: out.results.length ? 1 : 0 },
      usage: null,
      model: null,
      index: out.index
    }
  }
  // Live: the panel's own path, recorded.
  await js('window.__sgvueDev.chat.record(true)')
  await js(`window.__sgvueDev.chat.send(${JSON.stringify(kase.prompt)})`)
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
    for (const step of kase.setup || []) {
      await jsonOf(
        js,
        `window.__sgvueDev.tool(${JSON.stringify(step.tool)}, ${JSON.stringify(step.input || {})})`
      )
    }
    const truth = await collectTruth(js, kase)
    const before = await readView(js)
    const turn = await runTurn(js, kase, truth)
    const after = await readView(js)

    const message =
      turn.index >= 0 ? await jsonOf(js, `window.__sgvueDev.chat.messages()[${turn.index}]`) : null
    const store = {
      ...after.store,
      table: message ? message.table || null : null,
      pending: message ? message.pending || null : null,
      chips: message && message.chips ? message.chips.map((c) => ({ label: c.label, n: c.ids.length })) : []
    }

    const obs = {
      reply: turn.reply,
      calls: turn.calls,
      outcome: turn.outcome,
      usage: turn.usage,
      view: after.view,
      viewBefore: before.view,
      store,
      storeBefore: before.store
    }

    // The scope guard's Apply button, clicked only where the case says the user would.
    if (kase.applyPending && store.pending && turn.index >= 0) {
      await js(`window.__sgvueDev.chat.apply(${turn.index})`)
      const applied = await readView(js)
      obs.afterApply = { view: applied.view, store: applied.store }
    }

    const kindOf = (name) => {
      const t = caps.tools.find((x) => x.name === name)
      return t ? t.kind : 'unknown'
    }
    const graded = gradeCase(kase, obs, truth, kindOf)
    const cost = turnCost(turn.usage, turn.model || settings.model, settings.cacheOneHour)
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
        `view before the turn:\n${pretty(obs.viewBefore)}`
    },
    { role: 'user', content: kase.prompt }
  ]
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

function summarise(rows, naRows, errorRows) {
  const scored = rows.filter((r) => r.status == null || r.status === 'ok')
  const byGroup = new Map()
  for (const r of scored) {
    const g = r.tags[0]
    const acc = byGroup.get(g) || { n: 0, pass: 0 }
    acc.n++
    acc.pass += r.grade.pass
    byGroup.set(g, acc)
  }
  const cost = runCost(scored)
  return {
    rows: rows.length + naRows.length,
    scored: scored.length,
    na: naRows.length,
    errors: errorRows.length,
    pass: scored.length ? scored.filter((r) => r.grade.pass === 1).length : 0,
    pass_rate: scored.length ? scored.filter((r) => r.grade.pass === 1).length / scored.length : null,
    no_write_rate: scored.length ? scored.filter((r) => r.grade.no_write === 1).length / scored.length : null,
    by_group: Object.fromEntries([...byGroup].map(([g, v]) => [g, { n: v.n, pass: v.pass }])),
    tokens: cost.tokens,
    cost_usd: cost.usd,
    unpriced: cost.unpriced
  }
}

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
  const settings = await jsonOf(probe.js, 'window.sgvue.getSettings()')
  const have = capabilityTags(caps)
  probe.win.destroy()

  const fixtures = [...new Set(cases.map((c) => c.fixture))]
  console.log(`\nai-eval — ${ARGS.mode} run`)
  console.log(`  cases        ${cases.length} × ${ARGS.reps} rep(s)`)
  console.log(`  fixture      ${MODEL_PATH ? `REAL MODEL ${basename(MODEL_PATH)}` : fixtures.join(', ')}`)
  console.log(`  build        ${APP_OUT}`)
  console.log(`  capabilities ${have.join(', ')}`)
  console.log(`  results      ${ARGS.flow}/${ARGS.variant}/`)
  if (MODEL_PATH) {
    console.log(
      '\n  WARNING: a real model is loaded. Its vocabulary — storey, grid, entity, object-type\n' +
        '  and property-set names — and every tool result travel to api.anthropic.com on a live\n' +
        '  run. Nothing of it is written into this repository.'
    )
  }
  if (LIVE) {
    console.log(
      `\n  LIVE: ${cases.length * ARGS.reps} turns against ${settings.model} will be billed to the key in your\n` +
        '  environment. The first honest cost figure comes from the pilot — see docs/AI_EVAL.md.'
    )
  }
  console.log('')

  const already = doneKeys()
  const rows = []
  const naRows = []
  const errorRows = []

  for (const kase of cases) {
    for (let rep = 0; rep < ARGS.reps; rep++) {
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
        console.log(`  n/a ${kase.id} — needs ${missing.join(', ')}`)
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
      // modes make none, and a row of zeros there would read as a measurement
      // (`eval-audit.md` §3, and build-eval's "Trusting a zero").
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
        tool_calls: out.obs.calls.length,
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

  const summary = summarise(rows, naRows, errorRows)
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
  }

  guard.sample('done')
  app.exit(summary.errors ? 1 : 0)
})
