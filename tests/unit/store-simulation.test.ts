/**
 * Core protection #5 — the store simulation (`docs/plans/core-protection.md`, Tier 1).
 *
 * Seeded, model-based: fast-check generates sequences of user and assistant actions
 * (`fc.commands`; up to 400, about 165 on average — 60 runs, some 9 900 actions), runs each
 * against the **real** store (`state/shell.ts`) on the design's mock federation (412 elements,
 * four models) with a stub viewer, and against a small model of its own (`Model` below) at the
 * same time. After **every** action the two are compared, and the
 * invariants the recorded decisions state are checked:
 *
 *   · **undo is exact** — an undo leaves the five `VIS_KEYS` byte for byte as they were before
 *     the change it undoes (the snapshot string is compared), and a redo re-applies it;
 *   · **visibility is the rule** — what the viewer is told is visible, and `visibleCount`, equal
 *     an independent oracle written here from the decisions (hidden by hand, model eye, storey
 *     eye, every enabled isolate / hide step, OR binding looser than AND, `absent`) — never
 *     `visFn` called back;
 *   · **the caps** — the undo and redo stacks never pass 50, saved filter sets never pass 12,
 *     the oldest going first and a same-named set replaced;
 *   · **the 5 % scope guard** — an assistant action (`executeTool`, the one door a model's call
 *     comes through) never takes anything out of view and leaves under 5 % of the model — or
 *     nothing — unless the user's Apply is in between; and an action that would leave 5 % or more
 *     is not held.
 *
 * Why `fc.commands` rather than a seeded action array: a failure is **shrunk** to the shortest
 * sequence that still fails, and the printed counterexample is that sequence, each step named.
 * The seed and the number of runs are fixed, so CI runs the same sequences every time; on a
 * failure fast-check prints the seed and the path that replays it. A user's Apply on a held
 * change is not simulated: it is the user's own action, and `ai-parity*.test.ts` cover it.
 *
 * Two sources of non-determinism in the store are pinned for each run: `Date.now()` (the store's
 * viewpoint and filter-set ids) advances by exactly 1 ms an action, and `Math.random()` (a new
 * filter step's id) is a fixed low-discrepancy sequence.
 */
import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { federate, type FederatedElement } from '../../src/shared/federate'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { historyDepth, setViewer, useShell, type ShellState } from '../../src/renderer/state/shell'
import { snapVis } from '../../src/shared/undo'
import { NO_SECTIONS, type SecKind, type SecPlane, type Sections } from '../../src/shared/sections'
import type { FilterStep, Rule, RuleOp, StepAction } from '../../src/shared/rules'
import { executeTool, newTurnState, type ToolContext, type TurnState } from '../../src/renderer/ai/executors'
import type { CameraState } from '../../src/renderer/viewer/camera'
import { memoryStorage, resetShell, stubViewer } from './stub-viewer'

/* ────────────────────────────── the numbers the decisions state ────────────────────────────── */

/** `UNDO_CAP` — "cap 50 undo" (CLAUDE.md, fidelity contract rule 2). Written out, not imported. */
const UNDO_CAP = 50
/** "cap 12 filter sets" (the same list). */
const SETS_CAP = 12
/** The assistant's scope guard: under 5 % of the model waits for the user's Apply. */
const GUARD = 0.05

/** Fixed, so CI runs the same sequences every time. */
const SEED = 20261107
const RUNS = 60
/** `fc.commands` draws a length up to this; with the checks that skip, ~165 actions a run. */
const MAX_COMMANDS = 400

/* ────────────────────────────── the fixture ────────────────────────────── */

const full = federate(['ARC', 'STR', 'SIT', 'MEP'].map((k) => mockModelIndex(k)))
const ELS: readonly FederatedElement[] = full.elements
const N = ELS.length
const ALL_IDS = ELS.map((e) => e.id)
const KEYS = full.models.map((m) => m.meta.modelKey)
const st = (): ShellState => useShell.getState()

/** A value the store would read as a number takes another path in `matchFn`; none is used. */
const numeric = (v: string): boolean => /^-?[\d.]+$/.test(v.trim())
const distinct = (f: (e: FederatedElement) => string): string[] =>
  [...new Set(ELS.map(f))].filter((v) => !numeric(v)).sort()
const VALUES: Record<string, string[]> = {
  IfcEntity: distinct((e) => e.type),
  Level: distinct((e) => e.storey),
  Model: distinct((e) => e.model)
}
const STOREYS = [...new Set(ELS.map((e) => e.storey))]
const GRIDS = full.grids.map((g) => g.name)

/* ────────────────────────────── the independent oracle ────────────────────────────── */

const fieldOf = (e: FederatedElement, prop: string): string | undefined =>
  prop === 'IfcEntity' ? e.type : prop === 'Level' ? e.storey : prop === 'Model' ? e.model : undefined

/** A rule counts once it has a value — `absent` has none to carry. */
const liveRule = (r: Rule): boolean => r.op === 'absent' || (r.val !== '' && r.val != null)

function ruleHolds(e: FederatedElement, r: Rule): boolean {
  const v = fieldOf(e, r.prop)
  if (r.op === 'absent') return v === undefined || v.trim() === ''
  // A missing attribute matches only `!=`.
  if (v === undefined) return r.op === '!='
  const a = v.toLowerCase()
  const b = String(r.val).toLowerCase()
  if (r.op === '=') return a === b
  if (r.op === '!=') return a !== b
  if (r.op === '~') return a.includes(b)
  return false
}

/** `null` when no rule is live; else OR binds looser than AND. */
function matches(e: FederatedElement, rules: readonly Rule[]): boolean | null {
  const live = rules.filter(liveRule)
  if (!live.length) return null
  const groups: Rule[][] = []
  live.forEach((r, i) => {
    if (i === 0 || r.join === 'or') groups.push([r])
    else groups[groups.length - 1].push(r)
  })
  return groups.some((g) => g.every((r) => ruleHolds(e, r)))
}

interface MStep {
  id: string
  on: boolean
  action: StepAction
  rules: readonly Rule[]
}

/** The five `VIS_KEYS`, as sets. */
interface Vis {
  hidden: Set<number>
  storeyOff: Set<string>
  modelOff: Set<string>
  stack: MStep[]
  active: string | null
}

function visibleOf(v: Vis): Set<number> {
  const out = new Set<number>()
  for (const e of ELS) {
    if (v.hidden.has(e.id) || v.modelOff.has(e.model) || v.storeyOff.has(e.storey)) continue
    let shown = true
    for (const s of v.stack) {
      if (!s.on || s.action === 'highlight') continue
      const m = matches(e, s.rules)
      if (m === null) continue
      if ((s.action === 'isolate' && !m) || (s.action === 'hide' && m)) {
        shown = false
        break
      }
    }
    if (shown) out.add(e.id)
  }
  return out
}

const takesOut = (before: Set<number>, after: Set<number>): boolean => [...before].some((id) => !after.has(id))

/* ────────────────────────────── the model ────────────────────────────── */

interface Snap {
  /** `snapVis` of the store when the change was made — what an undo must give back exactly. */
  raw: string
  vis: Vis
}

interface Model {
  vis: Vis
  undo: Snap[]
  redo: Snap[]
  views: { id: number; name: string; vis: Vis; sections: Sections }[]
  sets: { id: number; label: string; stack: MStep[] }[]
  sections: Sections
  colorBy: string | null
  modelColors: Record<string, string>
  nativeMats: boolean
  selIds: number[]
}

const copyVis = (v: Vis): Vis => ({
  hidden: new Set(v.hidden),
  storeyOff: new Set(v.storeyOff),
  modelOff: new Set(v.modelOff),
  stack: v.stack.map((s) => ({ ...s })),
  active: v.active
})

const freshModel = (): Model => ({
  vis: { hidden: new Set(), storeyOff: new Set(), modelOff: new Set(), stack: [], active: null },
  undo: [],
  redo: [],
  views: [],
  sets: [],
  sections: NO_SECTIONS,
  colorBy: null,
  modelColors: {},
  nativeMats: true,
  selIds: []
})

const normStep = (s: FilterStep): MStep => ({ id: s.id, on: s.on, action: s.action, rules: s.rules })

/** The store's five keys, read the way the model holds them. */
function storeVis(): Vis {
  const s = st()
  const off = (r: Record<string, boolean>): Set<string> =>
    new Set(Object.keys(r).filter((k) => r[k] === false))
  return {
    hidden: new Set(Object.keys(s.hidden).filter((k) => s.hidden[k]).map(Number)),
    storeyOff: off(s.storeyVis),
    modelOff: off(s.modelVis),
    stack: s.stack.map(normStep),
    active: s.active
  }
}

/**
 * A visibility change the store snapshots first: the model records it the same moment — `raw` is
 * the store's snapshot from before the change.
 */
function push(m: Model, raw: string = snapVis(st())): void {
  m.undo = [...m.undo, { raw, vis: copyVis(m.vis) }].slice(-UNDO_CAP)
  m.redo = []
}

/**
 * One step through the model's history — `back` is undo — given the store's snapshot from just
 * before the store stepped (`hereRaw`), which the other side keeps. `false` when that side is empty.
 */
function stepModel(m: Model, back: boolean, hereRaw: string): boolean {
  const from = back ? m.undo : m.redo
  if (!from.length) return false
  const target = from[from.length - 1]
  const here: Snap = { raw: hereRaw, vis: copyVis(m.vis) }
  if (back) {
    m.undo = from.slice(0, -1)
    m.redo = [...m.redo, here].slice(-UNDO_CAP)
  } else {
    m.redo = from.slice(0, -1)
    m.undo = [...m.undo, here].slice(-UNDO_CAP)
  }
  m.vis = copyVis(target.vis)
  return true
}

/** The step a user or tool just made: what the store's step id is, read back. */
const lastStoreStep = (): FilterStep => st().stack[st().stack.length - 1]

/* ────────────────────────────── the run's harness ────────────────────────────── */

/** What the viewer was last told is visible: the predicate `applyVis` hands `setVisibility`. */
let viewerVisible: ((e: { id: number; model: string }) => boolean) | null = null
const CAM: CameraState = { theta: 1, phi: 0.5, dist: 70, half: 30, target: [1, 2, 3], proj: 'persp' }

/** What the runs reached, so the test can prove it exercised each boundary. */
const reached = { actions: 0, runs: 0, undoDepth: 0, redoDepth: 0, sets: 0, setsAtCap: 0, held: 0, refused: 0, aiApplied: 0, restores: 0 }

let rnd = 0
/** `Math.random()` for the store: a fixed golden-ratio sequence, distinct at every call. */
const nextRandom = (): number => {
  rnd = (rnd + 0.6180339887498949) % 1
  return rnd
}

function setup(): void {
  resetShell()
  vi.stubGlobal('localStorage', memoryStorage())
  vi.setSystemTime(new Date('2026-11-07T00:00:00Z'))
  rnd = 0
  viewerVisible = null
  setViewer(
    stubViewer({
      getCamera: () => CAM,
      setVisibility: (f: (e: { id: number; model: string }) => boolean) => {
        viewerVisible = f
      }
    })
  )
  st().commitModels(full)
}

/** Every invariant, after every action. */
function verify(m: Model): void {
  const s = st()
  // The five keys are what the model says they are.
  expect(storeVis()).toEqual(m.vis)
  // Each step id names one step: `updStep` and `dropStep` find a step by it.
  expect(new Set(s.stack.map((x) => x.id)).size).toBe(s.stack.length)

  // Visibility: what the viewer was told, and the count, against the oracle.
  const want = visibleOf(m.vis)
  const told = viewerVisible
  expect(told).not.toBeNull()
  const shown = new Set(ELS.filter((e) => told!({ id: e.id, model: e.model })).map((e) => e.id))
  expect(shown).toEqual(want)
  expect(s.visibleCount).toBe(want.size)

  // History: the depth the model expects, never past the cap, and the two flags the bar reads.
  const depth = historyDepth()
  expect(depth).toEqual({ undo: m.undo.length, redo: m.redo.length })
  expect(depth.undo).toBeLessThanOrEqual(UNDO_CAP)
  expect(depth.redo).toBeLessThanOrEqual(UNDO_CAP)
  expect([s.canUndo, s.canRedo]).toEqual([m.undo.length > 0, m.redo.length > 0])
  reached.undoDepth = Math.max(reached.undoDepth, depth.undo)
  reached.redoDepth = Math.max(reached.redoDepth, depth.redo)

  // Saved filter sets: the model's list, never past twelve, no two of one name.
  expect(s.filterSets.map((f) => ({ id: f.id, label: f.label, stack: f.stack.map(normStep) }))).toEqual(m.sets)
  expect(s.filterSets.length).toBeLessThanOrEqual(SETS_CAP)
  expect(new Set(s.filterSets.map((f) => f.label)).size).toBe(s.filterSets.length)
  reached.sets = Math.max(reached.sets, s.filterSets.length)

  // Everything else the actions touch, none of it undoable.
  expect(s.views.map((v) => ({ id: v.id, name: v.name }))).toEqual(m.views.map((v) => ({ id: v.id, name: v.name })))
  expect(s.sections).toEqual(m.sections)
  expect(s.colorBy?.prop ?? null).toBe(m.colorBy)
  expect(s.modelColors).toEqual(m.modelColors)
  expect(s.nativeMats).toBe(m.nativeMats)
  expect(s.selIds).toEqual(m.selIds)
  expect(s.sel).toBe(m.selIds.length ? m.selIds[m.selIds.length - 1] : null)
}

/* ────────────────────────────── commands ────────────────────────────── */

type Real = Record<string, never>

class Act implements fc.AsyncCommand<Model, Real> {
  constructor(
    private readonly label: string,
    private readonly body: (m: Model) => void | Promise<void>,
    private readonly can: (m: Model) => boolean = () => true
  ) {}
  check(m: Readonly<Model>): boolean {
    return this.can(m as Model)
  }
  async run(m: Model): Promise<void> {
    vi.setSystemTime(Date.now() + 1)
    reached.actions++
    await this.body(m)
    verify(m)
  }
  toString(): string {
    return this.label
  }
}

/* ── element sets ── */

interface IdSpec {
  kind: 'pick' | 'window' | 'allBut'
  picks: number[]
  start: number
  k: number
}
const windowOf = (start: number, k: number): number[] =>
  Array.from({ length: k }, (_, i) => ALL_IDS[(start + i) % N])
function idsOf(x: IdSpec): number[] {
  if (x.kind === 'pick') return x.picks.map((i) => ALL_IDS[i])
  const w = windowOf(x.start, x.k)
  if (x.kind === 'window') return w
  const keep = new Set(w)
  return ALL_IDS.filter((id) => !keep.has(id))
}
const idText = (x: IdSpec): string =>
  x.kind === 'pick' ? `[${x.picks.join(',')}]` : `${x.kind}(${x.start},${x.k})`
const idSpec: fc.Arbitrary<IdSpec> = fc.record({
  kind: fc.constantFrom<IdSpec['kind']>('pick', 'window', 'allBut'),
  picks: fc.uniqueArray(fc.nat({ max: N - 1 }), { minLength: 1, maxLength: 12 }),
  start: fc.nat({ max: N - 1 }),
  // Around the guard's 20.6 elements of 412.
  k: fc.integer({ min: 1, max: 45 })
})

/* ── rules ── */

const PROPS = ['IfcEntity', 'Level', 'Model'] as const
interface RuleSpec {
  prop: (typeof PROPS)[number]
  op: RuleOp
  pick: number
  join: 'and' | 'or'
  blank: boolean
}
function ruleOf(r: RuleSpec): Rule {
  const values = VALUES[r.prop]
  const v = values[r.pick % values.length]
  const val = r.op === 'absent' || r.blank ? '' : r.op === '~' ? v.slice(0, 3) : v
  return { prop: r.prop, op: r.op, val, join: r.join }
}
const ruleSpec = (live: boolean): fc.Arbitrary<RuleSpec> =>
  fc.record({
    prop: fc.constantFrom(...PROPS),
    op: fc.constantFrom<RuleOp>('=', '=', '!=', '~', 'absent'),
    pick: fc.nat(),
    join: fc.constantFrom<'and' | 'or'>('and', 'and', 'or'),
    // One rule in seven has no value yet, as a rule just added in the card has.
    blank: live ? fc.constant(false) : fc.nat({ max: 6 }).map((n) => n === 0)
  })
const rulesArb = (live: boolean): fc.Arbitrary<Rule[]> =>
  fc.array(ruleSpec(live), { minLength: 1, maxLength: 3 }).map((rs) => rs.map(ruleOf))
const ruleText = (rs: readonly Rule[]): string =>
  rs.map((r, i) => `${i ? r.join + ' ' : ''}${r.prop}${r.op}${JSON.stringify(r.val)}`).join(' ')
const actionArb = fc.constantFrom<StepAction>('isolate', 'isolate', 'hide', 'highlight')

/* ── the user ── */

/** The card's Save, or `manage_filters`' `save_set` with a name: what the model expects of it. */
function saveSet(m: Model, name: string | undefined): void {
  vi.setSystemTime(Date.now() + 1)
  const live = m.vis.stack.filter((x) => x.rules.some(liveRule))
  st().saveFilterSet(name)
  // Nothing to save is no save.
  if (!live.length) return
  const made = st().filterSets[st().filterSets.length - 1]
  const label = name?.trim() ? name.trim() : made.label
  expect(made.label).toBe(label)
  const was = m.sets.length
  // A set of the same name is replaced; the last twelve are kept, the oldest going first.
  m.sets = [...m.sets.filter((f) => f.label !== label), { id: made.id, label, stack: live.map((x) => ({ ...x })) }].slice(
    -SETS_CAP
  )
  if (was === SETS_CAP && m.sets.length === SETS_CAP) reached.setsAtCap++
}

const hasStack = (m: Model): boolean => m.vis.stack.length > 0
const at = <T,>(list: readonly T[], i: number): T => list[i % list.length]

const userCommands: fc.Arbitrary<fc.AsyncCommand<Model, Real>>[] = [
  idSpec.map(
    (x) =>
      new Act(`hide ${idText(x)}`, (m) => {
        const ids = idsOf(x)
        push(m)
        st().hide(ids)
        for (const id of ids) m.vis.hidden.add(id)
      })
  ),
  idSpec.map(
    (x) =>
      new Act(`show ${idText(x)}`, (m) => {
        const ids = idsOf(x)
        push(m)
        st().show(ids)
        for (const id of ids) m.vis.hidden.delete(id)
      })
  ),
  idSpec.map(
    (x) =>
      new Act(`isolate ${idText(x)}`, (m) => {
        const keep = new Set(idsOf(x))
        push(m)
        st().isolate([...keep])
        m.vis.hidden = new Set(ALL_IDS.filter((id) => !keep.has(id)))
        m.vis.storeyOff = new Set()
      })
  ),
  fc.constant(
    new Act('showAll', (m) => {
      push(m)
      st().showAll()
      m.vis.hidden = new Set()
      m.vis.storeyOff = new Set()
      m.vis.modelOff = new Set()
      m.vis.stack = m.vis.stack.map((s) => ({ ...s, on: false }))
    })
  ),
  fc.tuple(actionArb, rulesArb(false)).map(
    ([action, rules]) =>
      new Act(`addStep ${action} ${ruleText(rules)}`, (m) => {
        push(m)
        st().addStep(action, rules)
        m.vis.stack.push({ id: lastStoreStep().id, on: true, action, rules })
      })
  ),
  fc.tuple(fc.nat(), fc.oneof(fc.constant('toggle' as const), actionArb, rulesArb(false))).map(
    ([i, what]) =>
      new Act(
        `updStep #${i} ${typeof what === 'string' ? what : ruleText(what)}`,
        (m) => {
          const step = at(m.vis.stack, i)
          const patch: Partial<MStep> =
            what === 'toggle' ? { on: !step.on } : typeof what === 'string' ? { action: what } : { rules: what }
          push(m)
          if ('rules' in patch) st().setStepRules(step.id, patch.rules!)
          else st().updStep(step.id, patch)
          Object.assign(step, patch)
        },
        hasStack
      )
  ),
  fc.tuple(fc.nat(), fc.constantFrom(-2, -1, 1, 2)).map(
    ([i, d]) =>
      new Act(
        `moveStep #${i} by ${d}`,
        (m) => {
          const from = i % m.vis.stack.length
          const to = from + d
          const id = m.vis.stack[from].id
          // The ends do not wrap: a move that would leave the array is no move, and no snapshot.
          if (to >= 0 && to < m.vis.stack.length) {
            push(m)
            const [moved] = m.vis.stack.splice(from, 1)
            m.vis.stack.splice(to, 0, moved)
          }
          st().moveStep(id, d)
        },
        hasStack
      )
  ),
  fc.nat().map(
    (i) =>
      new Act(
        `dropStep #${i}`,
        (m) => {
          const step = at(m.vis.stack, i)
          push(m)
          st().dropStep(step.id)
          m.vis.stack = m.vis.stack.filter((s) => s !== step)
        },
        hasStack
      )
  ),
  fc.constant(
    new Act('clearStack', (m) => {
      push(m)
      st().clearStack()
      m.vis.stack = []
    })
  ),
  fc.nat().map(
    (i) =>
      new Act(`toggleStorey #${i}`, (m) => {
        const name = at(STOREYS, i)
        push(m)
        st().toggleStorey(name)
        if (m.vis.storeyOff.has(name)) m.vis.storeyOff.delete(name)
        else m.vis.storeyOff.add(name)
      })
  ),
  fc.nat().map(
    (i) =>
      new Act(`toggleModel #${i}`, (m) => {
        const key = at(KEYS, i)
        push(m)
        st().toggleModel(key)
        if (m.vis.modelOff.has(key)) m.vis.modelOff.delete(key)
        else m.vis.modelOff.add(key)
      })
  ),
  fc.option(fc.nat(), { nil: null }).map(
    (i) =>
      new Act(`activate ${i === null ? 'null' : '#' + i}`, (m) => {
        const key = i === null ? null : at(KEYS, i)
        push(m)
        st().activate(key)
        m.vis.active = m.vis.active === key ? null : key
        const active = m.vis.active
        if (active) m.selIds = m.selIds.filter((id) => full.byId.get(id)?.model === active)
      })
  ),
  fc.constant(
    new Act('undo', (m) => {
      const target = m.undo[m.undo.length - 1]
      const here = snapVis(st())
      st().step(true)
      if (stepModel(m, true, here)) expect(snapVis(st())).toBe(target.raw)
    })
  ),
  fc.constant(
    new Act('redo', (m) => {
      const target = m.redo[m.redo.length - 1]
      const here = snapVis(st())
      st().step(false)
      if (stepModel(m, false, here)) expect(snapVis(st())).toBe(target.raw)
    })
  ),
  // A run of undos, then of redos: how the history's far end, and the redo side, are reached.
  fc.tuple(fc.constantFrom(true, false), fc.integer({ min: 2, max: 60 })).map(
    ([back, n]) =>
      new Act(`${back ? 'undo' : 'redo'} ×${n}`, (m) => {
        for (let i = 0; i < n; i++) {
          const side = back ? m.undo : m.redo
          const target = side[side.length - 1]
          const here = snapVis(st())
          st().step(back)
          if (!stepModel(m, back, here)) break
          expect(snapVis(st())).toBe(target.raw)
        }
      })
  ),
  fc.constant(
    new Act('saveView', (m) => {
      const n = m.views.length
      st().saveView()
      const v = st().views[n]
      expect(v.name).toBe(`Viewpoint ${n + 1}`)
      m.views.push({ id: v.id, name: v.name, vis: copyVis(m.vis), sections: m.sections })
    })
  ),
  fc.nat().map(
    (i) =>
      new Act(
        `restoreView #${i}`,
        (m) => {
          const saved = at(m.views, i)
          const v = st().views.find((x) => x.id === saved.id)!
          push(m)
          st().restoreView(v)
          m.vis = copyVis(saved.vis)
          // A viewpoint carries both section planes, which are not undoable.
          m.sections = saved.sections
          reached.restores++
        },
        (m) => m.views.length > 0
      )
  ),
  fc.tuple(fc.nat(), fc.constantFrom('Lobby', '  Lobby ', '', 'Core', 'Viewpoint 1')).map(
    ([i, name]) =>
      new Act(
        `renameView #${i} ${JSON.stringify(name)}`,
        (m) => {
          const v = at(m.views, i)
          st().renameView(v.id, name)
          if (name.trim()) v.name = name.trim()
        },
        (m) => m.views.length > 0
      )
  ),
  // One save, or several under different names in a row — how the cap of twelve is reached.
  fc
    .array(fc.option(fc.constantFrom(...'ABCDEFGHIJKLMNOP'.split(''), ' A '), { nil: undefined, freq: 4 }), {
      minLength: 1,
      maxLength: 8
    })
    .map(
      (names) =>
        new Act(`saveFilterSet ${names.map((n) => (n === undefined ? '(auto)' : JSON.stringify(n))).join(' ')}`, (m) => {
          for (const name of names) saveSet(m, name)
        })
    ),
  fc.nat().map(
    (i) =>
      new Act(
        `applyFilterSet #${i}`,
        (m) => {
          const saved = at(m.sets, i)
          const set = st().filterSets.find((f) => f.id === saved.id)!
          push(m)
          st().applyFilterSet(set)
          // Every step switched on, each with a fresh id.
          const ids = st().stack.map((x) => x.id)
          m.vis.stack = saved.stack.map((x, k) => ({ id: ids[k], on: true, action: x.action, rules: x.rules }))
        },
        (m) => m.sets.length > 0
      )
  ),
  fc.nat().map(
    (i) =>
      new Act(
        `forgetFilterSet #${i}`,
        (m) => {
          const saved = at(m.sets, i)
          st().forgetFilterSet(saved.id)
          m.sets = m.sets.filter((f) => f !== saved)
        },
        (m) => m.sets.length > 0
      )
  ),
  fc
    .record({
      kind: fc.constantFrom<SecKind>('grid', 'level'),
      pick: fc.nat(),
      blank: fc.boolean(),
      offset: fc.option(fc.integer({ min: -3000, max: 3000 }), { nil: undefined }),
      flip: fc.option(fc.boolean(), { nil: undefined }),
      cut: fc.option(fc.boolean(), { nil: undefined })
    })
    .map(
      (x) =>
        new Act(`setSec ${JSON.stringify(x)}`, (m) => {
          const names = x.kind === 'grid' ? GRIDS : STOREYS
          const patch: Partial<SecPlane> = { name: x.blank ? '' : at(names, x.pick) }
          if (x.offset !== undefined) patch.offset = x.offset
          if (x.flip !== undefined) patch.flip = x.flip
          if (x.cut !== undefined) patch.cut = x.cut
          st().setSec(x.kind, patch)
          m.sections = { ...m.sections, [x.kind]: { ...m.sections[x.kind], ...patch } }
        })
    ),
  fc.constant(
    new Act('clearSections', (m) => {
      st().clearSections()
      m.sections = NO_SECTIONS
    })
  ),
  fc.constantFrom('IfcEntity', 'Level', 'Model', 'Material', 'NoSuchProperty', null).map(
    (prop) =>
      new Act(`setColorBy ${String(prop)}`, (m) => {
        st().setColorBy(prop)
        if (!prop) m.colorBy = null
        // A property nothing carries leaves the live scheme exactly as it was.
        else if (ELS.some((e) => (prop === 'Material' ? e.material : fieldOf(e, prop)))) m.colorBy = prop
      })
  ),
  fc.tuple(fc.nat(), fc.option(fc.constantFrom('#D8D2C6', '#8FA3B5', '#35C4B6'), { nil: null })).map(
    ([i, c]) =>
      new Act(`setModelColor #${i} ${String(c)}`, (m) => {
        const key = at(KEYS, i)
        st().setModelColor(key, c)
        const map = { ...m.modelColors }
        if (c) map[key] = c
        else delete map[key]
        m.modelColors = map
        if (c) m.nativeMats = false
      })
  ),
  fc.uniqueArray(fc.nat({ max: N - 1 }), { maxLength: 4 }).map(
    (picks) =>
      new Act(`select [${picks.join(',')}]`, (m) => {
        const ids = picks.map((i) => ALL_IDS[i])
        st().select(ids)
        m.selIds = ids
      })
  )
]

/* ── the assistant, through `executeTool` ── */

const sqlStub = (async () => ({ columns: [], rows: [], truncated: false, ms: 0 })) as unknown as ToolContext['sql']

/** One tool call, as one fresh turn. */
async function ai(name: string, input: unknown): Promise<TurnState> {
  const turn = newTurnState()
  const ctx: ToolContext = { state: () => useShell.getState(), sql: sqlStub, rawLine: async () => null, turn }
  await executeTool(name, input, ctx)
  return turn
}

/** Under the guard, or nothing at all: what may never be applied without the user's Apply. */
const underGuard = (n: number): boolean => n === 0 || n / N < GUARD

/**
 * One assistant call, checked three ways: the scope guard's safety rule (independent of what the
 * tool is), the verdict this model predicts (`applies`), and — when it was not applied — that
 * nothing of the five keys moved and that a held change is offered behind Apply.
 */
async function assistant(
  m: Model,
  name: string,
  input: unknown,
  /** What the model expects of the call: `null` when it should change nothing and ask nothing. */
  predict: () => { applies: boolean; apply: (raw: string) => void } | null
): Promise<void> {
  const before = visibleOf(m.vis)
  const raw = snapVis(st())
  const depth = historyDepth()
  const p = predict()
  const turn = await ai(name, input)
  if (turn.acted) {
    expect(p?.applies, `${name} was applied where the model expected it held, refused or a no-op`).toBe(true)
    p!.apply(raw)
    reached.aiApplied++
  } else {
    expect(p?.applies ?? false, `${name} was not applied where the model expected it applied`).toBe(false)
    expect(snapVis(st())).toBe(raw)
    expect(historyDepth()).toEqual(depth)
    if (turn.pending) reached.held++
    else reached.refused++
  }
  // The guard itself, whatever the tool: nothing taken out of view leaves under 5 % or nothing.
  const after = visibleOf(m.vis)
  if (takesOut(before, after)) {
    expect(underGuard(after.size), `${name} left ${after.size} of ${N} visible without Apply`).toBe(false)
  }
}

const assistantCommands: fc.Arbitrary<fc.AsyncCommand<Model, Real>>[] = [
  fc.tuple(fc.constantFrom<'hide' | 'isolate'>('hide', 'isolate'), idSpec).map(
    ([mode, x]) =>
      new Act(`AI ${mode} ids ${idText(x)}`, (m) => {
        const ids = idsOf(x)
        const next = copyVis(m.vis)
        if (mode === 'hide') for (const id of ids) next.hidden.add(id)
        else {
          const keep = new Set(ids)
          next.hidden = new Set(ALL_IDS.filter((id) => !keep.has(id)))
          next.storeyOff = new Set()
        }
        return assistant(m, 'apply_visibility', { action: mode, ids }, () => ({
          applies: !underGuard(visibleOf(next).size),
          apply: (was) => {
            push(m, was)
            m.vis = next
          }
        }))
      })
  ),
  fc.tuple(fc.constantFrom<'hide' | 'isolate'>('hide', 'isolate'), rulesArb(true)).map(
    ([mode, rules]) =>
      new Act(`AI ${mode} rules ${ruleText(rules)}`, (m) => {
        const hit = ELS.filter((e) => matches(e, rules)).length
        const next = copyVis(m.vis)
        next.stack = [{ id: '', on: true, action: mode, rules }]
        return assistant(m, 'apply_visibility', { action: mode, rules }, () =>
          hit
            ? {
                applies: !underGuard(visibleOf(next).size),
                apply: (was) => {
                  push(m, was)
                  // A fresh stack of one step, with the store's id and the rules as the tool read them.
                  expect(st().stack).toHaveLength(1)
                  expect(st().stack[0].action).toBe(mode)
                  m.vis.stack = [normStep(st().stack[0])]
                }
              }
            : null
        )
      })
  ),
  fc.constantFrom(true, false).map(
    (back) =>
      new Act(`AI ${back ? 'undo' : 'redo'}`, (m) => {
        const side = back ? m.undo : m.redo
        const target = side[side.length - 1]
        const here = snapVis(st())
        return assistant(m, 'apply_visibility', { action: back ? 'undo' : 'redo' }, () => {
          if (!target) return null
          const now = visibleOf(m.vis)
          const would = visibleOf(target.vis)
          return {
            // A step that only reveals is exempt, as `show` is.
            applies: !takesOut(now, would) || !underGuard(would.size),
            // A step is a move through the history, not a change on top of it.
            apply: () => {
              stepModel(m, back, here)
              expect(snapVis(st())).toBe(target.raw)
            }
          }
        })
      })
  ),
  fc.nat().map(
    (i) =>
      new Act(
        `AI enable step #${i}`,
        (m) => {
          const k = i % m.vis.stack.length
          const step = m.vis.stack[k]
          return assistant(m, 'manage_filters', { op: 'enable', step: k + 1 }, () => {
            if (step.on) return null
            const next = copyVis(m.vis)
            next.stack[k].on = true
            return {
              applies: step.action === 'highlight' || !underGuard(visibleOf(next).size),
              apply: (was) => {
                push(m, was)
                m.vis.stack[k].on = true
              }
            }
          })
        },
        hasStack
      )
  )
]

/* ────────────────────────────── the property ────────────────────────────── */

describe('store simulation — seeded action sequences against the real store', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.spyOn(Math, 'random').mockImplementation(nextRandom)
  })
  afterEach(() => {
    setViewer(null)
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps undo exact, visibility to the rule, the caps and the scope guard, after every action', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.commands([...userCommands, ...assistantCommands], { maxCommands: MAX_COMMANDS, size: 'max' }),
        async (cmds) => {
          setup()
          reached.runs++
          await fc.asyncModelRun(() => ({ model: freshModel(), real: {} }), cmds)
        }
      ),
      { seed: SEED, numRuns: RUNS }
    )
    // The runs reached every boundary the invariants are about — or the test would prove nothing.
    expect(reached.undoDepth).toBe(UNDO_CAP)
    expect(reached.redoDepth).toBeGreaterThan(20)
    expect(reached.sets).toBe(SETS_CAP)
    expect(reached.setsAtCap).toBeGreaterThan(0)
    expect(reached.held).toBeGreaterThan(0)
    expect(reached.refused).toBeGreaterThan(0)
    expect(reached.aiApplied).toBeGreaterThan(0)
    expect(reached.restores).toBeGreaterThan(0)
  }, 60_000)
})
