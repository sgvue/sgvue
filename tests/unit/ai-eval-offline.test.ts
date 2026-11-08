/**
 * The assistant's eval suite, offline: the oracle scores 100 % and the null agent 0 %, on every
 * push (2026-11-07, core protection #11).
 *
 * `scripts/ai-eval.cjs` grades the assistant on 85 cases (80 scorable today) with pure graders (`eval/graders.cjs`)
 * and has two offline modes that make no request: `--dry-run`, the **oracle**, replays each case's
 * ideal tool sequence and reply and must score 100 % — the proof that the tools, the graders and
 * the ground truth agree about what "right" means — and `--null`, an agent that does nothing,
 * must score 0 %. Both open one Electron window per case, so they only ran by hand, and a grader
 * edited into leniency (or strictness) failed nothing until somebody did.
 *
 * What this catches: a grader lenient enough that the null agent passes a **whole case**, or
 * strict enough that the oracle fails **one**. A sub-check made lenient is not caught while the
 * null agent still fails that case on another check — the per-check tests in
 * `ai-eval-graders.test.ts` are what hold each check.
 *
 * This runs both under Node, case for case, with the app's own parts: the real store
 * (`useShell`), the real executors through the dev harness's own entry points (`runToolOnce`,
 * `runTurnOnce` — what `window.__sgvueDev.tool` and `.chat.turn` call), the design's own mock
 * federation committed the way the parity tests commit it, the model database built by the
 * worker's own `buildDatabase` and queried by its own `runQuery` under sql.js, and a viewer
 * whose camera is the real rig (`rig-viewer.ts`). What the window reads with `VIEW_EXPR` is
 * read here from the same sources; what a case's probes ask, the oracle's turn, the null turn and
 * the observation are `eval/observe.cjs`, which the Electron runner uses too; and the grading is
 * `gradeCase`, untouched.
 *
 * **Where it differs from the window, and why that does not touch the grading:**
 *  - The viewer is the rig viewer. The two markup cases place through the viewer's commit, which
 *    raycasts the real geometry; here it is the stand-in `ai-parity-4.test.ts` uses, recording
 *    the point it is handed exactly as `annotations.ts` publishes it, and a laser that reads 2 m
 *    in every direction it fires. Graded is the count and where it was taken from, which come
 *    from the store's own `placeSpot` / `placeMeasure`.
 *  - The sidebar's unload confirmation is read off the store through the Sidebar's own selector
 *    (`modelRows`' `confirmOpen` and `name`, as `ConfirmUnload` prints them), not off the DOM.
 *  - Nothing is billed and nothing is written: no results directory, no trace.
 *
 * A case the build cannot run yet (`requires`) is n/a here as there, by the same
 * `missingCapabilities` over the same catalogue facts — and since 2026-11-08 each one shows as
 * a skipped test with its reason (`whyMissing`), so it cannot go quietly missing either.
 *
 * 2026-11-08, the Ask Vee eval cases: a case may be a conversation (`turns`, every turn through
 * `runTurnOnce` in order, as the window's `chat.turn` takes them), may run on the messy fixture
 * (`dev/messy.ts`), and may need a Schedules window — the same dev stand-in the window's
 * `__sgvueDev.schedules` joins (`dev/schedules-standin.ts`), joined here before the setup runs.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import initSqlJs, { type Database } from 'sql.js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { laserDirections, LASER_AXES } from '../../src/shared/annotate'
import { federate, type Federation } from '../../src/shared/federate'
import { readoutCoords, toMap } from '../../src/shared/georef'
import { RULES, TOOLS } from '../../src/shared/tool-schemas'
import { runToolOnce, runTurnOnce } from '../../src/renderer/ai/bridge'
import { HOSTILE_OPTIONS } from '../../src/renderer/dev/hostile'
import { MESSY_OPTIONS } from '../../src/renderer/dev/messy'
import { attachScheduleStandIn, detachScheduleStandIn, scheduleStandInState } from '../../src/renderer/dev/schedules-standin'
import { SAMPLE_FILES, mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { federation as fed } from '../../src/renderer/model/federation-store'
import { modelRows } from '../../src/renderer/state/selectors/models'
import { getViewer, setViewer, useShell } from '../../src/renderer/state/shell'
import type { MeasureRecord, SpotRecord } from '../../src/renderer/viewer/annotations'
import { buildDatabase } from '../../src/worker/sql-schema'
import { runQuery } from '../../src/worker/sql-query'
import { rigViewer } from './rig-viewer'
import { memoryStorage, resetShell } from './stub-viewer'

const req = createRequire(__filename)
type Json = Record<string, unknown>
interface Kase extends Json {
  id: string
  group: string
  fixture: 'mock' | 'mock-hostile' | 'mock-messy'
  prompt: string
  requires?: string[]
  setup?: { tool: string; input?: Json }[]
  applyPending?: boolean
  harness?: { schedules?: boolean }
  turns?: Json[]
}
interface Graded {
  grade: { pass: number }
  reasons: string[]
}
const { CASES } = req('../../scripts/eval/cases.cjs') as { CASES: Kase[] }
const { gradeCase } = req('../../scripts/eval/graders.cjs') as {
  gradeCase: (kase: Kase, obs: Json, truth: Json, kindOf: (name: string) => string) => Graded
}
const { capabilityTags, missingCapabilities, whyMissing } = req('../../scripts/eval/capabilities.cjs') as {
  capabilityTags: (snapshot: Json) => string[]
  missingCapabilities: (requires: string[] | undefined, have: string[]) => string[] | null
  whyMissing: (missing: string[]) => string
}
type Turn = { reply: string; calls: Json[]; outcome: Json; usage: unknown; index: number }
const O = req('../../scripts/eval/observe.cjs') as {
  collectTruth: (kase: Kase, ask: { sql: (s: string) => Promise<unknown>; tool: (n: string, i: Json) => Promise<unknown> }) => Promise<Json>
  lateTruth: (kase: Kase, truth: Json, calls: Json[], ask: { tool: (n: string, i: Json) => Promise<unknown> }) => Promise<Json>
  oracleTurn: (kase: Kase, truth: Json) => { calls: { name: string; input: Json }[]; reply: string }
  nullTurn: () => Turn
  skippedTurn: (choice: string) => Turn
  scriptedCalls: (calls: { name: string; input: Json }[], results: unknown[]) => Json[]
  observation: (turn: Turn, before: Snapshot, after: Snapshot, message: unknown) => Json & { store: Json }
  turnsOf: (kase: Kase) => (Json & { prompt: string; choice?: string })[]
  withEarlier: (obs: Json & { store: Json }, earlier: Json[], start: Snapshot) => Json & { store: Json }
}

const st = useShell.getState

/* ────────────────────────────── the fixture ────────────────────────────── */

const KEYS = SAMPLE_FILES.map((f) => f.key)
const FIXTURES: Record<Kase['fixture'], Federation> = {
  mock: federate(KEYS.map((k) => mockModelIndex(k))),
  'mock-hostile': federate(KEYS.map((k) => mockModelIndex(k, HOSTILE_OPTIONS))),
  'mock-messy': federate(KEYS.map((k) => mockModelIndex(k, MESSY_OPTIONS)))
}
const databases = new Map<Kase['fixture'], Database>()

/** The catalogue facts `window.__sgvueDev.capabilities()` hands the runner, from the same catalogue. */
const capabilities = {
  tools: TOOLS.map((t) => ({
    name: t.name,
    kind: t.kind,
    inputs: Object.keys(t.input_schema.properties ?? {}),
    enums: Object.fromEntries(
      Object.entries(t.input_schema.properties ?? {})
        .filter(([, v]) => Array.isArray((v as { enum?: unknown[] }).enum))
        .map(([k, v]) => [k, ((v as { enum: unknown[] }).enum ?? []).map(String)])
    )
  })),
  ruleOps: ((RULES.items?.properties?.op?.enum ?? []) as readonly unknown[]).map(String)
}
const kindOf = (name: string): string => TOOLS.find((t) => t.name === name)?.kind ?? 'unknown'

/** A viewer whose camera is the real rig and whose markups follow its calls (`ai-parity-4`'s stand-in). */
function viewer(): ReturnType<typeof rigViewer>['viewer'] {
  let nextId = 0
  return rigViewer({
    dropSpot: (id: number) => st().setSpots(st().spots.filter((s) => s.id !== id)),
    dropMeasure: (id: number) => st().setMeasures(st().measures.filter((m) => m.id !== id)),
    clearSpots: () => st().setSpots([]),
    clearMeasures: () => st().setMeasures([]),
    placeSpot: (p: number[]) => {
      const [ox, oy, oz] = st().offset
      const f = { x: p[0] + ox, y: p[1] + oy, z: p[2] + oz }
      const m = toMap(readoutCoords(st().coords), f.x, f.y, f.z)
      const rec: SpotRecord = { id: ++nextId, p: p as [number, number, number], E: m ? m.E : null, N: m ? m.N : null, Z: m ? m.Z : null, ...f }
      st().setSpots([...st().spots, rec])
    },
    placeMeasure: (p: number[], normal: number[] | null) => {
      const reach = 2
      const fired = laserDirections(normal as [number, number, number] | null)
      const rec: MeasureRecord = { id: ++nextId, p: p as [number, number, number], sides: {} }
      for (const axis of LASER_AXES) {
        const k = axis.toLowerCase() as 'x' | 'y' | 'z'
        const n = fired.filter((d) => d.axis === axis).length
        if (!n) continue
        const at = (sign: 1 | -1): number | null => (fired.some((d) => d.axis === axis && d.sign === sign) ? reach : null)
        rec[k] = n * reach
        rec.sides[k] = { minus: at(-1), plus: at(1) }
      }
      st().setMeasures([...st().measures, rec])
      return true
    }
  }).viewer
}

/**
 * One case's fresh window: an empty `localStorage`, the store at its first state, the fixture
 * loaded — and, for a case that needs one, a Schedules window (the stand-in), joined after it.
 */
function open(fixture: Kase['fixture'], schedules = false): void {
  detachScheduleStandIn()
  vi.stubGlobal('localStorage', memoryStorage())
  resetShell()
  setViewer(viewer())
  // `#mock`: the library is the design's four sample files, then the federation is committed.
  st().setLibrary(SAMPLE_FILES.map((f) => ({ key: f.key, name: f.name, file: f.file, swatch: f.swatch })))
  st().commitModels(FIXTURES[fixture])
  const db = databases.get(fixture)
  if (!db) throw new Error(`no database for ${fixture}`)
  // The app's SQL worker, answered in-process: the same `buildDatabase`, the same `runQuery`.
  fed.query = (statement: string) => Promise.resolve(runQuery(db, statement))
  if (schedules) attachScheduleStandIn()
}

/* ────────────────────────────── reading the view (`VIEW_EXPR`) ────────────────────────────── */

/** The view fields `VIEW_EXPR` takes from `get_view_state`, in its order. */
const VIEW_FIELDS = [
  'filterStack', 'visibleElements', 'totalElements', 'hiddenManually', 'storeysShown', 'activeModel', 'view',
  'projection', 'section', 'selectedCount', 'display', 'modelsHidden', 'models', 'sectionPlanes', 'history',
  'interface', 'camera', 'viewpoints', 'loadedModels', 'basePoint', 'ifcsg'
] as const
/** The store fields `VIEW_EXPR` reads, in its order. */
const STORE_FIELDS = ['stack', 'filterSets', 'unloadAsk', 'colorBy', 'markups', 'pose', 'schedules'] as const

interface Snapshot {
  view: Json
  store: Json
}

async function readView(): Promise<Snapshot> {
  const view = (await runToolOnce('get_view_state', {})) as Json
  const s = st()
  const scheme = s.colorBy
  const sets = (await runToolOnce('manage_filters', { op: 'list_sets' })) as { sets?: { name: string }[] }
  const mm = (n: unknown): number | null => (typeof n === 'number' ? Math.round(n * 1000) / 1000 : null)
  const off = s.offset
  const at = (p: unknown): (number | null)[] | null =>
    Array.isArray(p) ? [0, 1, 2].map((i) => mm((p[i] as number) + off[i])) : null
  const asking = modelRows({
    federation: s.federation,
    files: [],
    library: s.library,
    modelVis: s.modelVis,
    modelColors: s.modelColors,
    nativeMats: s.nativeMats,
    uploadNames: s.uploadNames,
    active: s.active,
    palette: s.palette,
    confirmRemove: s.confirmRemove
  }).find((m) => m.confirmOpen)
  const cam = getViewer()?.getCamera()
  const store: Record<(typeof STORE_FIELDS)[number], unknown> = {
    stack: s.stack.map((x) => ({ id: x.id, on: x.on, action: x.action, color: x.color })),
    filterSets: (sets.sets || []).map((x) => x.name),
    // `ConfirmUnload`'s one line of text, whitespace folded as the runner folds it.
    unloadAsk: asking ? `Unload ${asking.name}?`.replace(/\s+/g, ' ').trim() : null,
    colorBy: scheme ? { prop: scheme.prop, groups: scheme.groups.map((g) => ({ v: g.v, n: g.n, color: g.color })) } : null,
    markups: {
      measures: s.measures.map((m) => ({ id: m.id, x: mm(m.x), y: mm(m.y), z: mm(m.z), p: at(m.p) })),
      spots: s.spots.map((p) => ({ id: p.id, x: mm(p.x), y: mm(p.y), z: mm(p.z) }))
    },
    pose: cam ? { target: cam.target.map((n) => mm(n)), dist: mm(cam.dist), half: mm(cam.half), proj: cam.proj } : null,
    schedules: scheduleStandInState()
  }
  // JSON, as the window hands it over: `undefined` is not a value there.
  return JSON.parse(JSON.stringify({ view: Object.fromEntries(VIEW_FIELDS.map((k) => [k, view[k]])), store })) as Snapshot
}

/* ────────────────────────────── running one case (`runCase`) ────────────────────────────── */

/**
 * A quick reply the user clicks before a turn's text is sent — stage 2's IFC+SG Yes / No. The
 * window's runner calls `__sgvueDev.chat.choose`; here it is the store action a stage-2 build
 * gives that hook, `chooseReply`. Only a stage-2 case has one, and those are n/a until then.
 */
function choose(value: string): boolean {
  const act = (st() as unknown as { chooseReply?: (v: string) => boolean }).chooseReply
  if (typeof act !== 'function') throw new Error('this build has no chooseReply, which a case with a quick reply needs')
  return act(value) === true
}

async function runCase(kase: Kase, mode: 'oracle' | 'null'): Promise<Graded> {
  open(kase.fixture, !!kase.harness?.schedules)
  for (const step of kase.setup || []) await runToolOnce(step.tool, step.input || {})
  const truth = await O.collectTruth(kase, {
    sql: (statement) => fed.query(statement),
    tool: (name, input) => runToolOnce(name, input)
  })
  const start = await readView()
  // Every user turn in order, one conversation; the last is the case's own.
  const all = O.turnsOf(kase)
  const earlier: Json[] = []
  let before = start
  let after = start
  let turn: Turn = O.nullTurn()
  let message: unknown = null
  for (let i = 0; i < all.length; i++) {
    if (mode === 'null') turn = O.nullTurn()
    else {
      // As the window's runner: a quick reply with no question to answer is not clicked, and
      // its turn is not taken (`skippedTurn`, 2026-11-09).
      if (all[i].choice !== undefined && !choose(String(all[i].choice))) turn = O.skippedTurn(String(all[i].choice))
      else {
        const { calls, reply } = O.oracleTurn(all[i] as Kase, truth)
        const out = await runTurnOnce(all[i].prompt, calls, reply)
        turn = {
          reply,
          calls: O.scriptedCalls(calls, out.results),
          outcome: { type: 'done', rounds: out.results.length ? 1 : 0 },
          usage: null,
          index: out.index
        }
      }
    }
    after = await readView()
    message = turn.index >= 0 ? JSON.parse(JSON.stringify(st().chatMsgs[turn.index])) : null
    if (i < all.length - 1) {
      earlier.push(O.observation(turn, before, after, message))
      before = after
    }
  }
  const obs = O.withEarlier(O.observation(turn, before, after, message), earlier, start)
  // The scope guard's Apply button, clicked only where the case says the user would.
  if (kase.applyPending && obs.store.pending && turn.index >= 0) {
    st().applyPending(turn.index)
    await Promise.resolve()
    const applied = await readView()
    obs.afterApply = { view: applied.view, store: applied.store }
  }
  // A probe that follows the turn's own call is run again now, as the window's runner does.
  const graded = await O.lateTruth(kase, truth, obs.calls as Json[], { tool: (name, input) => runToolOnce(name, input) })
  return gradeCase(kase, JSON.parse(JSON.stringify(obs)) as Json, graded, kindOf)
}

/* ────────────────────────────── the two runs ────────────────────────────── */

const have = capabilityTags(capabilities)
const scored = CASES.filter((k) => !missingCapabilities(k.requires, have))
/** The cases that wait for stage 2 of the Ask Vee redesign (`capabilities.cjs`, `stage2`). */
const STAGE2 = ['hu-placeholder', 'hu-no-storey', 'hu-dup-guid', 'sg-ask-once', 'sg-never-asks']

beforeAll(async () => {
  const dist = dirname(req.resolve('sql.js'))
  const SQL = await initSqlJs({ locateFile: (file) => join(dist, file) })
  for (const [name, f] of Object.entries(FIXTURES)) {
    databases.set(name as Kase['fixture'], buildDatabase(SQL, { models: f.models, elements: f.elements }))
  }
})
afterAll(() => {
  detachScheduleStandIn()
  for (const db of databases.values()) db.close()
  setViewer(null)
  vi.unstubAllGlobals()
})

describe('the eval suite, offline', () => {
  it('reads the view the way the Electron runner does (the same fields as VIEW_EXPR)', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'scripts', 'ai-eval.cjs'), 'utf8')
    const expr = src.slice(src.indexOf('const VIEW_EXPR'), src.indexOf('const readView'))
    const viewKeys = [...expr.matchAll(/^\s{6}(\w+): view\.\1,?$/gm)].map((m) => m[1])
    const storeBlock = expr.slice(expr.indexOf('store: {'))
    const storeKeys = [...storeBlock.matchAll(/^\s{6}(\w+):/gm)].map((m) => m[1])
    expect(viewKeys).toEqual([...VIEW_FIELDS])
    expect(storeKeys).toEqual([...STORE_FIELDS])
  })

  it('runs every case it can: none silently missing', () => {
    // Exactly 87 (`docs/AI_EVAL.md`, "The cases": 65, then twenty Ask Vee cases on 2026-11-08 —
    // 66 until `op-base-point` went on 2026-10-08 — and two follow-ups on 2026-11-09), so a case
    // dropped from `cases.cjs` fails here rather than shrinking the run.
    expect(CASES.length).toBe(87)
    // n/a only for stage 2 of the Ask Vee redesign — its five cases until 2026-11-08, when the
    // catalogue gained `ask_choice` and they began to be scored with the rest, with no edit here.
    for (const kase of CASES.filter((k) => !scored.includes(k))) {
      expect([kase.id, STAGE2.includes(kase.id), missingCapabilities(kase.requires, have)]).toEqual([kase.id, true, ['stage2']])
    }
    expect(scored.length).toBeGreaterThanOrEqual(CASES.length - STAGE2.length)
    // Stage 2 is built: every case is scored.
    expect(scored.map((k) => k.id)).toEqual(expect.arrayContaining(STAGE2))
    expect(scored).toHaveLength(CASES.length)
  })

  // Each case this build cannot score yet, skipped where it can be seen, with its reason.
  for (const kase of CASES.filter((k) => !scored.includes(k))) {
    it.skip(`n/a: ${kase.id} — ${whyMissing(missingCapabilities(kase.requires, have) ?? [])}`, () => undefined)
  }

  it('the oracle scores 100 %', async () => {
    const failed: string[] = []
    for (const kase of scored) {
      const g = await runCase(kase, 'oracle')
      if (g.grade.pass !== 1) failed.push(`${kase.id}: ${g.reasons.join(' · ')}`)
    }
    expect(failed, `the oracle failed ${failed.length} of ${scored.length} — a grader, a tool or a case's truth disagrees:\n  ${failed.join('\n  ')}`).toEqual([])
  })

  it('the null agent scores 0 %', async () => {
    const passed: string[] = []
    for (const kase of scored) {
      const g = await runCase(kase, 'null')
      if (g.grade.pass !== 0) passed.push(kase.id)
    }
    expect(passed, `an agent that does nothing passed ${passed.length} of ${scored.length} — a grader passes vacuously:\n  ${passed.join('\n  ')}`).toEqual([])
  })
})
