/**
 * The thinking trace — its pure core (2026-10-01, the owner's "Ask Vee" handoff,
 * `design-reference/ask-vee/`: `README.md` is the specification, `ask-thinking-hex.jsx` the
 * reference code). No DOM, no React, no clock of its own: `tests/unit/trace.test.ts` runs it
 * beside the handoff's own code.
 *
 * The handoff is a 16 s scripted video on fixed data — `Reply`, `Piece` and `hexState` as pure
 * functions of a time `T`. **This is the same choreography driven by a real turn.** Three parts:
 *
 *   `traceReduce`   turn events (`begin`, `tool_start`, `tool_exec`, `done`, `fail`) → a
 *                   **timeline**: when each thing happened, and the facts each call brought
 *                   (`ai/trace-facts.ts`).
 *   `traceCues`     the timeline → cue times: Send, Think, Read, each step, Answer.
 *   `traceFrame`    timeline, `T`, layout → **everything of the trace visible at `T`**: Vee's
 *                   state, the typing dots, `Thinking` and the seconds, the diary's steps and
 *                   their counts, every cell, the beam. `traceSend` is the same for what stands
 *                   outside the reply: the lift, the send button, the user row.
 *   `answerFrame`   2026-11-08 (stage 1b) — the answer's own motion: the diary folding into one
 *                   line, and the reply's parts landing one after another (spike 4).
 *
 * The arithmetic is the reference's — the three curves (`enter` easeOutQuart, `glide`
 * easeInOutCubic, `pop` easeOutBack), every duration, stagger and offset — and its sizes are the
 * reference's px ÷ 1.5 (`J`). **Up to the answer.** Since 2026-11-08 ("Vee Messages", stage 1b)
 * the handoff's answer — the bubble gliding to the answer's height, the words one by one, the
 * cells flying into rows — is not drawn: from `done` on, every animation of the trace is at its
 * end, and the answer is `answerFrame`'s.
 *
 * **What lives here, and what does not** (2026-10-02). This file is the part that is read beside
 * `ask-thinking-hex.jsx`: the curves, the durations and the sizes with the handoff's own line
 * references, and the port of `Reply`, `Piece` and `hexState`. **Where each cell stands** — the
 * lattice on whole device pixels, how many elements one cell stands for, the read grid and the
 * filter grid, the rows under an answer and the cells that fly into them — is planned in
 * `ai/trace-plan.ts`. That is the app's own: the handoff has one fixed table of 412 cells in its
 * place, so there is nothing of its to read a planner beside. `traceFrame` asks for a plan
 * (`readPlanFor`, `rulePlanFor`) and animates what comes back. The planner imports nothing from
 * this file — a cycle would have one of the two load against the other's uninitialised
 * constants — so the five leaf values both need (`clamp`, `J`, `MATRIX_TOP`, `MONO_CH`,
 * `ROW_CELLS`) are declared there, and every public name that moved is re-exported below:
 * whatever imports `ai/trace` finds what it always did.
 *
 * **The cues, from real events.** Send is `chatBegin`. Think is Send + 1 s. Read is the turn's
 * first `tool_start`, not before Think + 0.4 s. Each later step starts when its data exists and
 * the step before it has had its designed time (Read 1.8 s, Filter 1.6 s, Check 2.4 s, a note
 * 0.6 s); calls that pile up behind a step are not replayed one by one — the ticker moves on to
 * the latest. Answer is `done`.
 *
 * **The answer is never delayed by animation.** Whatever is queued or in flight when `done`
 * arrives is finished at that instant — every pre-answer animation reads as complete from
 * `Answer` on — and the answer's own choreography starts there.
 */
import type { VeeState } from '../app/vee-grid'
import {
  capRows,
  countText,
  nounFor,
  statusText,
  type ChatTrace,
  type ReadFacts,
  type RuleFacts,
  type ToolFacts,
  type TraceRowData
} from './trace-facts'
import {
  clamp,
  J,
  MATRIX_TOP,
  readPlanFor,
  rulePlanFor,
  traceLattice,
  type PlanCell,
  type TraceLayout
} from './trace-plan'

/**
 * The planner's public names, as this module always exported them (`ai/trace-plan.ts`, moved
 * there on 2026-10-02): the lattice, the rows' layout, and the five leaf values both files use.
 */
export {
  clamp,
  columnsIn,
  J,
  MATRIX_TOP,
  MONO_CH,
  ROW_CELLS,
  rowLayout,
  traceLattice,
  type Grid,
  type Lattice,
  type RowLayout,
  type TraceLayout
} from './trace-plan'

/* ────────────────────────────── motion ────────────────────────────── */

/** `ask-thinking-hex.jsx:14` — the three curves; nothing moves through anything else. */
export const MOTION = {
  /** easeOutQuart: arrivals and fades. */
  enter: (t: number): number => {
    const u = t - 1
    return 1 - u * u * u * u
  },
  /** easeInOutCubic: moves, resizes, scroll. */
  glide: (t: number): number => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  /** easeOutBack: emphasis and entrances. It overshoots 1. */
  pop: (t: number): number => {
    const c1 = 1.70158
    const c3 = c1 + 1
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
  }
} as const

type Ease = (t: number) => number

/** `:15` — progress of an animation starting at `s` and lasting `d`, through `ease`. */
export const p = (T: number, s: number, d: number, ease: Ease): number =>
  T <= s ? 0 : T >= s + d ? 1 : ease((T - s) / d)
/** `:16` — the same, linear. */
export const lin = (T: number, s: number, d: number): number => clamp((T - s) / d, 0, 1)
/** `:17`. */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/* ────────────────────────────── durations (seconds) ────────────────────────────── */

/** The reference's Send phase: what Think waits after Send. */
export const SEND_S = 1.0
/** Read never starts sooner than this after Think. */
export const THINK_MIN_S = 0.4
/** Each step's designed time (`README.md`, "Interactions & behaviour"), and a note's. */
export const STEP_S = { read: 1.8, filter: 1.6, check: 2.4, note: 0.6 } as const
/** Vee hops for this long at each finding. */
export const FOUND_S = 0.5
/** The shimmer's sweep. */
export const SHIMMER_S = 1.6

/*
 * 2026-11-08 — the answer phase of "Vee Messages" (stage 1b), proved by spike 4
 * (`spikes/vee-messages/answer-phase.ts`) before it was built. At the answer the diary's
 * narration folds into one line over `FOLD_S`, and the reply's parts — a bubble a block, then
 * its cards — land one after another: `PART_S` each, at most `PART_STAGGER_MAX_S` apart, all of
 * them in before `ANSWER_TOTAL_S`. It replaces the handoff's answer — the bubble gliding to the
 * answer's height, the words one by one, the cells flying into rows — which stage 1a could only
 * hand over to the parts with one visible re-layout once it had settled.
 */
export const FOLD_S = 0.22
export const PART_S = 0.24
export const PART_STAGGER_MAX_S = 0.11
/** The parts are all in strictly before this long after the answer. */
export const ANSWER_TOTAL_S = 0.5
/** How far below its place a part stands as it starts to land, in CSS px (the prototype's `pop`). */
export const PART_RISE = 6

/** The stagger for `n` parts: 110 ms while that fits, else what keeps the total under 0.5 s. */
export const partStagger = (n: number): number =>
  n <= 1 ? 0 : Math.min(PART_STAGGER_MAX_S, (ANSWER_TOTAL_S - PART_S - 1e-3) / (n - 1))

/* ────────────────────────────── sizes (app px) ────────────────────────────── */

/** The bubble's own padding — the existing reply bubble's `8px 11px`. */
export const PAD_X = 11
/** `:156` — the trace's bubble while it ran: ticker plus matrix. The matrix's band ends here. */
export const H_THINK = J(78)
/** `:44`, `:166` — the beam starts and ends this far outside the matrix. */
export const BEAM_PAD = J(6)
/**
 * 2026-11-08 — the band of the old bubble the matrix stands in, which the diary draws on its own
 * canvas: from the beam's top (`MATRIX_TOP − BEAM_PAD`) to the bubble's foot. A cell's `y` is
 * still measured from the old bubble's top, so the canvas is painted `MATRIX_BAND.top` up.
 */
export const MATRIX_BAND = { top: MATRIX_TOP - BEAM_PAD, height: H_THINK - (MATRIX_TOP - BEAM_PAD) } as const
/** How far a diary step rises as it rolls in (the prototype's `roll`, 8 px). */
export const STEP_RISE = 8

/* ────────────────────────────── the timeline ────────────────────────────── */

/** One executed tool call: when its data existed, and what it brought. */
export interface TraceCall {
  at: number
  facts: ToolFacts
}

/** One turn, as the events that happened and when. Times are seconds on the trace's clock. */
export interface Timeline {
  /** Send — `chatBegin`. */
  send: number
  /** The federation as it stood at Send. */
  read: ReadFacts
  /** When the turn's first tool started: its `tool_start`, or its execution if that came first. */
  tool: number | null
  calls: readonly TraceCall[]
  /** Answer — when `done` arrived. `null` while the turn runs. */
  answer: number | null
  /** The turn produced a table, so its answer carries no rows. */
  table: boolean
}

export type TraceEvent =
  | { type: 'begin'; at: number; read: ReadFacts }
  | { type: 'tool_start'; at: number }
  | { type: 'tool_exec'; at: number; facts: ToolFacts }
  | { type: 'done'; at: number; table: boolean }
  | { type: 'fail' }

/**
 * One event folded into the timeline. `begin` starts a new one; `fail` — a stopped or failed
 * turn — ends in none, because the live reply and its trace go away; nothing changes a turn
 * that has already been answered.
 */
export function traceReduce(tl: Timeline | null, ev: TraceEvent): Timeline | null {
  if (ev.type === 'begin') {
    return { send: ev.at, read: ev.read, tool: null, calls: [], answer: null, table: false }
  }
  if (ev.type === 'fail') return null
  if (!tl || tl.answer !== null) return tl
  switch (ev.type) {
    case 'tool_start':
      return tl.tool === null ? { ...tl, tool: Math.max(ev.at, tl.send) } : tl
    case 'tool_exec': {
      const at = Math.max(ev.at, tl.send)
      return { ...tl, tool: tl.tool ?? at, calls: [...tl.calls, { at, facts: ev.facts }] }
    }
    case 'done':
      return { ...tl, answer: Math.max(ev.at, tl.send), table: ev.table }
  }
}

/* ────────────────────────────── the cues ────────────────────────────── */

export type StepKind = 'read' | 'filter' | 'check' | 'note'

/** One thing the ticker says, and when it starts saying it. */
export interface TraceStep {
  kind: StepKind
  at: number
  /** Which call it belongs to — an index into `calls` — or −1 for Read. */
  call: number
}

export interface TraceCues {
  send: number
  think: number
  /** Read, or `null`: no tool has started — or the answer came before Read could. */
  read: number | null
  /** The steps the ticker shows, in order. One still to come has an `at` in the future. */
  steps: TraceStep[]
  answer: number | null
  /** The turn's last rule-bearing call — where the answer's rows and status come from — or −1. */
  last: number
}

/** The steps one call shows: its Filter and its Check, or one note. */
const kindsOf = (call: TraceCall): StepKind[] => {
  const rules = call.facts.rules
  if (!rules) return ['note']
  const kinds: StepKind[] = []
  if (rules.filter) kinds.push('filter')
  if (rules.check) kinds.push('check')
  return kinds.length ? kinds : ['note']
}

const cueCache = new WeakMap<Timeline, TraceCues>()

export function traceCues(tl: Timeline): TraceCues {
  const known = cueCache.get(tl)
  if (known) return known
  const answer = tl.answer
  const before = (t: number): boolean => answer === null || t < answer
  const think = answer === null ? tl.send + SEND_S : Math.min(tl.send + SEND_S, answer)
  const steps: TraceStep[] = []
  let read: number | null = null
  if (tl.tool !== null) {
    const at = Math.max(tl.tool, think + THINK_MIN_S)
    if (before(at)) {
      read = at
      steps.push({ kind: 'read', at, call: -1 })
      let free = at + STEP_S.read
      for (let i = 0; i < tl.calls.length; ) {
        const start = Math.max(tl.calls[i].at, free)
        // Everything whose data exists by then has piled up behind the step before: the ticker
        // can honestly show only the latest of them.
        let j = i
        while (j + 1 < tl.calls.length && tl.calls[j + 1].at <= start) j++
        let t = start
        for (const kind of kindsOf(tl.calls[j])) {
          if (!before(t)) break
          steps.push({ kind, at: t, call: j })
          t += STEP_S[kind]
        }
        if (!before(start)) break
        free = t
        i = j + 1
      }
    }
  }
  let last = -1
  tl.calls.forEach((c, i) => {
    if (c.facts.rules) last = i
  })
  const cues: TraceCues = { send: tl.send, think, read, steps, answer, last }
  cueCache.set(tl, cues)
  return cues
}

/** The facts the answer's rows and status come from: the turn's last rule-bearing call. */
export const lastRules = (tl: Timeline): RuleFacts | null => {
  const { last } = traceCues(tl)
  return last < 0 ? null : tl.calls[last].facts.rules
}

/** Whether the turn opened the trace bubble: a tool ran. */
export const hasTrace = (tl: Timeline): boolean => tl.tool !== null

/** The rows under the answer: the last rule-bearing call's, capped — and none beside a table. */
export function answerRows(tl: Timeline): TraceRowData[] {
  const rules = lastRules(tl)
  return !rules || tl.table || !rules.matched.length ? [] : capRows(rules.rows)
}

/** The status the turn rolls to. `''` while it runs. */
export const traceStatus = (tl: Timeline): string =>
  tl.answer === null ? '' : statusText(lastRules(tl), tl.answer - tl.send)

/**
 * 2026-11-08 — the diary's one folded line: what was read, what the last rule-bearing call
 * scoped and found, and how long the turn took — `412 read · 80 walls · 12 missing · 7s`. A turn
 * with no tool is its seconds alone. `''` while it runs.
 */
export function foldText(tl: Timeline): string {
  if (tl.answer === null) return ''
  const bits: string[] = []
  if (hasTrace(tl)) bits.push(`${countText(tl.read.total)} read`)
  const r = lastRules(tl)
  if (r?.filter) bits.push(`${countText(r.filter.count)} ${nounFor(r.filter.count, r.filter.noun)}`)
  if (r?.check) bits.push(`${countText(r.check.count)} ${r.check.unit}`)
  bits.push(`${Math.max(1, Math.round(tl.answer - tl.send))}s`)
  return bits.join(' · ')
}

/** The steps a finished reply keeps, at most: its diary reopens on the latest of them. */
export const DIARY_STEPS_MAX = 20

/** What a finished turn leaves on its reply. */
export function traceSummary(tl: Timeline): ChatTrace {
  const rules = lastRules(tl)
  const steps = tl.answer === null ? [] : diarySteps(tl, tl.answer, (step) => stepCount(tl, step, null))
  return {
    status: traceStatus(tl),
    wide: hasTrace(tl),
    rows: answerRows(tl).map(({ label, n, ids }) => ({ label, n, ids })),
    noun: rules?.noun ?? 'element',
    fold: foldText(tl),
    steps: steps.slice(-DIARY_STEPS_MAX).map((st) => ({
      label: st.label,
      mono: st.mono,
      n: st.count ? st.count.n : null,
      unit: st.count ? st.count.unit : ''
    })),
    // The storey-rows card is titled by the property the Check looked at, when there was one.
    ...(rules?.check ? { title: `${rules.check.props} · ${rules.check.unit}` } : {})
  }
}

/* ────────────────────────────── the frame ────────────────────────────── */

/**
 * What a cell is, which decides its colour: `cell` at rest · `flash` as the wave or the beam
 * passes · `ready` a scope cell waiting for the beam · `dim` checked and not flagged · `hit`
 * flagged. A cell is `a` blended toward `b` by `t`.
 */
export type CellRole = 'cell' | 'flash' | 'ready' | 'dim' | 'hit'

export interface TraceCell {
  /** Its left edge from the bubble's inner left, its top from the bubble's top, its side. CSS px. */
  x: number
  y: number
  size: number
  a: CellRole
  b: CellRole
  t: number
  opacity: number
  scale: number
  /** The ring a flagged cell throws as the beam finds it: its progress 0…1, or −1 for none. */
  ring: number
}

/** A count as a diary step prints it: its number, its unit, and whether it is lit. */
export interface StepCount {
  n: number
  text: string
  unit: string
  accent: boolean
}

/**
 * 2026-11-08 — one step of the diary (the handoff's ticker line, kept as a list: every step the
 * turn has shown stays, ticked once the next has begun).
 */
export interface DiaryStep {
  /** `Reading 4 models`, `Filtering `, `Checking `, a note. */
  label: string
  /**
   * What follows the label in the mono face, as the file spells it: `IfcWall`, `FireRating`
   * (since 2026-11-08 a Check's property is here, not prettified in the label).
   */
  mono: string
  /** The names in `mono` that are IFC terms of the loaded models: drawn in the one IFC-term colour. */
  terms: readonly string[]
  /** The count on the right, or `null`. */
  count: StepCount | null
  /** A later step has begun (or the turn is answered): the step is ticked. */
  done: boolean
  /** Its roll in: how far below its place it stands, in CSS px, and its opacity. */
  y: number
  opacity: number
}

export interface TraceFrame {
  /** Vee: its state, and the pop it enters with. */
  sprite: { state: VeeState; scale: number; opacity: number }
  /** 2026-11-08 — typing dots: from Think until Read, or until the answer when no tool runs. */
  dots: boolean
  /** The diary's header while the turn runs: `Thinking`, its shimmer (0…1 or `null`) and the seconds since Send. */
  thinking: { shimmer: number | null; seconds: number }
  bubble: {
    /** The diary's fade in at Read. */
    opacity: number
  }
  steps: DiaryStep[]
  cells: TraceCell[]
  /** The scan beam: its x from the bubble's inner left, and its opacity. */
  beam: { x: number; opacity: number } | null
}

/**
 * Each role's colour, per theme: a design token (a name starting `--`, read from the document
 * when the matrix is drawn) or a constant of the trace's own — as `VEE_PALETTE` is for the
 * mascot.
 *
 * **Dark** is the handoff's (`ask-thinking-hex.jsx:191`, `:203`, `:210`): the cell at rest is
 * `C.borderStrong` — the app's `--border-strong` — and the flagged cell `C.accent`; the three
 * greys between them have no token.
 *
 * **Light** is the port's — the handoff is dark only — with each grey in the same place between
 * the same neighbours: `flash` 46 % of the way from the cell to `--ink`, `ready` 16 % from the
 * cell to the flash, `dim` 65 % from the bubble (`--step-bg`) to the cell. Those are the
 * fractions the dark values stand at.
 */
export const TRACE_PALETTE: Readonly<Record<'dark' | 'light', Readonly<Record<CellRole, string>>>> = {
  dark: { cell: '--border-strong', flash: '#7E9693', ready: '#405351', dim: '#2D3B3A', hit: '--accent' },
  light: { cell: '--border-strong', flash: '#748382', ready: '#B3C3C0', dim: '#CFDCD9', hit: '--accent' }
}

/** `:44` — when the beam of a Check that started at `check` reaches the x `xc`. */
export const beamAt = (check: number, xc: number, width: number): number =>
  check + 0.3 + ((xc + BEAM_PAD) / (width + 2 * BEAM_PAD)) * 1.7

/** The rule group the matrix is showing, with the times its two steps started. */
interface Scene {
  call: number
  /** Its Filter's and its Check's start, or `null` for a step it does not have. */
  filter: number | null
  check: number | null
}

const NO_TERMS: readonly string[] = []

/**
 * A step's label and mono, at its end. 2026-11-08 — the names a step shows are the file's own
 * (`Checking FireRating`, the owner's IFC-term decision), in the mono part, with the ones that are
 * IFC terms listed.
 */
function stepWords(tl: Timeline, step: TraceStep): { label: string; mono: string; terms: readonly string[] } {
  if (step.kind === 'read') {
    const models = tl.read.models.filter((n) => n > 0).length
    return { label: `Reading ${countText(models)} ${nounFor(models, 'model')}`, mono: '', terms: NO_TERMS }
  }
  const facts = tl.calls[step.call].facts
  const r = facts.rules
  if (step.kind === 'filter' && r?.filter) return { label: 'Filtering ', mono: r.filter.what, terms: r.filter.terms ?? NO_TERMS }
  if (step.kind === 'check' && r?.check) return { label: 'Checking ', mono: r.check.props, terms: r.check.terms ?? NO_TERMS }
  return { label: facts.note, mono: '', terms: NO_TERMS }
}

/**
 * A step's count: `live` its number as it stands now (the read counting up, the filter down, the
 * check rising with the beam), else — `null` — its end.
 */
function stepCount(tl: Timeline, step: TraceStep, live: number | null): StepCount | null {
  const r = step.call >= 0 ? tl.calls[step.call].facts.rules : null
  if (step.kind === 'read') {
    const n = live ?? tl.read.total
    return { n, text: countText(n), unit: nounFor(n, 'element'), accent: false }
  }
  if (step.kind === 'filter' && r?.filter) {
    const n = live ?? r.filter.count
    return { n, text: countText(n), unit: nounFor(n, r.filter.noun), accent: false }
  }
  if (step.kind === 'check' && r?.check) {
    const n = live ?? r.check.count
    return { n, text: countText(n), unit: r.check.unit, accent: n > 0 }
  }
  return null
}

/** The diary's steps at `T`: each one shown by then, with its count as `count` gives it. */
function diarySteps(tl: Timeline, T: number, count: (step: TraceStep) => StepCount | null): DiaryStep[] {
  const { steps, answer } = traceCues(tl)
  const answered = answer !== null && T >= answer
  const out: DiaryStep[] = []
  steps.forEach((step, i) => {
    if (step.at > T) return
    const next = steps[i + 1]
    out.push({ ...stepWords(tl, step), count: count(step), done: answered || (!!next && next.at <= T), y: 0, opacity: 1 })
  })
  return out
}

/**
 * Everything visible at time `T`, until the answer — the port of `Reply`, `Piece` and `hexState`
 * (`ask-thinking-hex.jsx:155–259`, `:261–336`, `:81–89`) up to its Answer cue — and from the
 * answer on, the end of every one of those animations: the matrix as the last rule-bearing call
 * left it, every step at its final count. What the answer itself moves — the fold, the parts —
 * is `answerFrame`'s.
 *
 * Under `layout.reduced` every animation is at its end from the moment its cue is reached: the
 * states still follow each other, with nothing in between.
 */
export function traceFrame(tl: Timeline, T: number, layout: TraceLayout): TraceFrame {
  const cues = traceCues(tl)
  const { think, read, steps } = cues
  const A = cues.answer
  const reduced = layout.reduced
  const lat = traceLattice(layout.dpr)
  const W = layout.width
  const answered = A !== null && T >= A

  /** An animation of the trace, belonging to `cue`: complete from the answer on. */
  const pre = (cue: number, off: number, dur: number, ease: Ease): number =>
    answered ? 1 : reduced ? (T >= cue ? 1 : 0) : p(T, cue + off, dur, ease)
  const preLin = (cue: number, off: number, dur: number): number =>
    answered ? 1 : reduced ? (T >= cue ? 1 : 0) : lin(T, cue + off, dur)
  /** Anything else that starts at a time of its own. */
  const at = (start: number, dur: number, ease: Ease): number =>
    reduced ? (T >= start ? 1 : 0) : p(T, start, dur, ease)

  const wide = hasTrace(tl)

  /* ── which rule group the matrix shows ── */
  // Answered: the last rule-bearing call, shown or not, at its end. Before that: the latest
  // group a step of which has started — a later one restarts from the read layout — and a note
  // changes nothing.
  const scene = ((): Scene | null => {
    if (answered) return cues.last >= 0 ? { call: cues.last, filter: null, check: null } : null
    let now: Scene | null = null
    for (const step of steps) {
      if (step.at > T) break
      if (step.kind === 'filter') now = { call: step.call, filter: step.at, check: null }
      else if (step.kind === 'check') {
        now = { call: step.call, filter: now && now.call === step.call ? now.filter : null, check: step.at }
      }
    }
    return now
  })()
  const sceneRules = scene ? tl.calls[scene.call].facts.rules! : null
  const plan = sceneRules ? rulePlanFor(sceneRules, tl.table, layout) : null
  const readPlan = plan ? plan.read : wide ? readPlanFor(tl.read, layout) : null
  /** The scene's two cue times, as `pre` wants them: a step that is over or was never shown is 0. */
  const tf = scene?.filter ?? 0
  const tc = scene?.check ?? 0
  const hasFilter = !!(plan && plan.filter)
  const hasCheck = !!(sceneRules && sceneRules.check)
  const checking = hasCheck && (answered || scene!.check !== null)

  /** When the beam reaches a cell at `x` of side `size`, and whether it has. */
  const beamTime = (x: number, size: number): number => beamAt(tc, x + size / 2, W)
  const passed = (tb: number): boolean => checking && (answered || (reduced ? T >= tc : T >= tb))

  /* ── the cells ── */
  const cells: TraceCell[] = []
  let counted = 0
  let finding = false

  if (readPlan && (answered || (read !== null && T >= read))) {
    const ga = lat.a
    const gb = lat.b
    const readAt = read ?? 0
    /**
     * One cell of the grid the Check runs on — the filter grid, or the read grid when the call
     * has no Filter: waiting, lit as the beam finds a match in it, dimmed as the beam passes it by.
     */
    const checked = (c: PlanCell, x: number, y: number, size: number, m: number): void => {
      const tb = beamTime(c.x, hasFilter ? gb.size : ga.size)
      const hit = passed(tb)
      if (hit && c.matched) counted += c.matched
      if (c.matched && !answered && !reduced && checking && T >= tb && T < tb + FOUND_S) finding = true
      let scale = 1
      let ring = -1
      let a: CellRole = 'cell'
      let b: CellRole = hasFilter ? 'ready' : 'cell'
      let t = m
      if (hit && c.matched) {
        a = b = 'hit'
        scale = lerp(0.45, 1, answered || reduced ? 1 : p(T, tb, 0.45, MOTION.pop))
        const rr = answered || reduced ? 1 : p(T, tb, 0.6, MOTION.enter)
        if (rr < 1) ring = rr
      } else if (hit) {
        a = 'dim'
        b = 'flash'
        t = answered || reduced ? 0 : 1 - lin(T, tb, 0.4)
      }
      cells.push({ x, y, size, a, b, t, opacity: 1, scale, ring })
    }

    if (!plan) {
      // Read: the wave, left to right over a second, each cell flashing and settling.
      for (const c of readPlan.cells) {
        const share = c.order / readPlan.cols
        const sp = pre(readAt, 0.35 + share, 0.3, MOTION.pop)
        const opacity = clamp(sp, 0, 1)
        if (opacity <= 0.001) continue
        cells.push({
          x: c.x,
          y: c.y,
          size: ga.size,
          a: 'flash',
          b: 'cell',
          t: preLin(readAt, 0.35 + share + 0.08, 0.45),
          opacity,
          scale: sp,
          ring: -1
        })
      }
    } else if (plan.filter) {
      // Filter: what is not in scope drops out, left to right; the scope regroups, larger.
      if (!answered) {
        readPlan.cells.forEach((c, i) => {
          if (plan.kept![i]) return
          const share = c.order / readPlan.cols
          const d = pre(tf, 0.1 + share * 0.45, 0.3, MOTION.enter)
          if (1 - d <= 0.001) return
          cells.push({
            x: c.x,
            y: c.y,
            size: ga.size,
            // The wave's last columns are still settling from their flash when the Filter starts.
            a: 'flash',
            b: 'cell',
            t: preLin(readAt, 0.35 + share + 0.08, 0.45),
            opacity: 1 - d,
            scale: 1 - d,
            ring: -1
          })
        })
      }
      for (const c of plan.filter) {
        const share = c.order / plan.endOf
        const m = pre(tf, 0.35 + share * 0.35, 0.7, MOTION.glide)
        const from = readPlan.cells[c.src]
        checked(c, lerp(from.x, c.x, m), lerp(from.y, c.y, m), lerp(ga.size, gb.size, m), m)
      }
    } else {
      // A Check with no Filter: the beam scans the read grid.
      for (const c of readPlan.cells) checked(c, c.x, c.y, ga.size, 0)
    }
  }

  /* ── the beam ── */
  let beam: TraceFrame['beam'] = null
  if (checking && !answered && !reduced) {
    const opacity = p(T, tc + 0.2, 0.2, MOTION.enter) * (1 - p(T, tc + 1.9, 0.25, MOTION.enter))
    if (opacity > 0) beam = { x: lerp(-BEAM_PAD, W + BEAM_PAD, lin(T, tc + 0.3, 1.7)), opacity }
  }

  /* ── the diary's steps ── */
  // Each step rolls in from below over 0.42 s (`Roll`, `:128`) and stays; its count is the
  // handoff's ticker's: the read counting up, the filter down, the check rising with the beam.
  const live = (step: TraceStep): StepCount | null => {
    if (answered) return stepCount(tl, step, null)
    const r = step.call >= 0 ? tl.calls[step.call].facts.rules : null
    if (step.kind === 'read') return stepCount(tl, step, Math.round(tl.read.total * preLin(step.at, 0.35, 1.1)))
    if (step.kind === 'filter' && r?.filter) {
      return stepCount(tl, step, Math.round(lerp(r.total, r.filter.count, pre(step.at, 0.15, 0.9, MOTION.enter))))
    }
    // The count rises as the beam passes each flagged cell, and ends on the matched size.
    if (step.kind === 'check' && r?.check) return stepCount(tl, step, scene?.call !== step.call ? r.check.count : counted)
    return null
  }
  const diary = diarySteps(tl, T, live).map((st, i) => {
    const a = answered || reduced ? 1 : p(T, steps[i].at + (i === 0 ? 0.1 : 0), 0.42, MOTION.enter)
    return { ...st, y: (1 - a) * STEP_RISE, opacity: a }
  })

  /* ── the diary, and the dots before it ── */
  const bIn = !wide ? 0 : read === null ? (answered ? 1 : 0) : pre(read, 0, 0.45, MOTION.enter)
  const dots = !answered && T >= think && (read === null || T < read)

  /* ── Vee, and `Thinking` ── */
  let state: VeeState = 'thinking'
  if (A !== null && T >= A + (reduced ? 0 : 0.3)) state = 'done'
  else if (read !== null && T >= read) {
    const hop = reduced && checking && !answered && T < tc + FOUND_S && plan!.end.some((c) => c.matched)
    state = finding || hop ? 'found' : 'reading'
  }
  const hexIn = at(think, 0.5, MOTION.pop)
  const shimmer = !answered && !reduced && T > think ? ((T - think) / SHIMMER_S) % 1 : null

  return {
    sprite: { state, scale: hexIn, opacity: clamp(hexIn, 0, 1) },
    dots,
    thinking: { shimmer, seconds: Math.max(0, Math.floor((answered ? A! : T) - tl.send)) },
    bubble: { opacity: clamp(bIn * 1.6, 0, 1) },
    steps: diary,
    cells,
    beam
  }
}

/* ────────────────────────────── the answer ────────────────────────────── */

export interface AnswerFrame {
  /** The diary's fold into one line, 0…1 (0 while the turn runs). */
  fold: number
  /** Each part: its opacity, and how far below its place it stands — on whole device pixels. */
  parts: { opacity: number; y: number }[]
  /** The answer is in and nothing is moving any more. */
  settled: boolean
}

/**
 * 2026-11-08 — the answer's own motion, for a reply drawn as `n` parts (spike 4): the fold, and
 * each part landing `partStagger(n)` after the one before. **Never delays the answer**: at the
 * instant `done` arrives the first part starts landing, and everything of the trace before it is
 * already at its end (`traceFrame`). Under reduced motion it is the end state from the answer on.
 */
export function answerFrame(tl: Timeline, T: number, n: number, opts: { dpr: number | null; reduced: boolean }): AnswerFrame {
  const A = tl.answer
  const snap = (v: number): number => (opts.dpr ? Math.round(v * opts.dpr) / opts.dpr : v)
  if (A === null || T < A) return { fold: 0, parts: Array.from({ length: n }, () => ({ opacity: 0, y: snap(PART_RISE) })), settled: false }
  if (opts.reduced) return { fold: 1, parts: Array.from({ length: n }, () => ({ opacity: 1, y: 0 })), settled: true }
  const s = partStagger(n)
  const parts = Array.from({ length: n }, (_, k) => {
    const e = p(T, A + k * s, PART_S, MOTION.enter)
    return { opacity: e, y: snap((1 - e) * PART_RISE) }
  })
  return { fold: p(T, A, FOLD_S, MOTION.enter), parts, settled: T >= answerEnd(tl, n) }
}

/**
 * The last moving instant of an answered turn, drawn as `n` parts: the fold and the parts are in
 * before `A + 0.5`; an entrance still running from an early answer (Think's pop, the lift) can end
 * later — **never more than 1.95 s after the answer** (the lift's 0.95 s, for a turn answered at
 * once). `+∞` while the turn runs.
 */
export function answerEnd(tl: Timeline, n: number): number {
  if (tl.answer === null) return Number.POSITIVE_INFINITY
  const A = tl.answer
  const own = Math.max(A + FOLD_S, A + Math.max(0, n - 1) * partStagger(n) + PART_S)
  return Math.max(own, traceCues(tl).think + 0.5, tl.send + SEND_SETTLE_S)
}

/* ────────────────────────────── the width a plan is made for ────────────────────────────── */

/** The width the matrix was last planned for, and the step it was taken in. */
export interface WidthHold {
  /** The index of the step in `traceCues(tl).steps`, −1 before Read, −2 once answered. */
  step: number
  width: number
}

/**
 * 2026-11-08 — the width to plan the matrix for at `T`, with the window being resized under it.
 *
 * A plan is laid out for one width, and where the beam stands — so how far the Check's count has
 * risen — depends on it: re-planned mid-sweep, the count could jump by a dozen at once (measured
 * by spike 4: up to 13 of 395 on a 100 000-element model). So **while a Check runs, the width it
 * started with is kept**, and the plan follows the window again at the next step boundary — the
 * next step, or the answer. Every other step plans for the width measured now.
 */
export function planWidth(tl: Timeline, T: number, measured: number, hold: WidthHold | null): WidthHold {
  const { steps, answer } = traceCues(tl)
  if (answer !== null && T >= answer) return { step: -2, width: measured }
  let step = -1
  for (let i = 0; i < steps.length && steps[i].at <= T; i++) step = i
  if (step >= 0 && steps[step].kind === 'check' && hold && hold.step === step) return hold
  return { step, width: measured }
}

/* ────────────────────────────── outside the reply ────────────────────────────── */

/** What stands outside the reply at time `T`: the lift, the user's row, the composer. */
export interface SendFrame {
  /** The typed line's way from the composer to its bubble, 0…1. */
  lift: number
  /** The send button's press, 0…1 (it overshoots): it scales 0.9 → 1. */
  press: number
  /** The user's bubble: it fades in and scales 0.94 → 1. */
  bubble: number
  /** `You`: it fades in, rising. */
  you: number
  /** The placeholder's opacity as it returns. */
  placeholder: number
  /** The arrow cross-faded to the stop square, 0…1. */
  busy: number
  settled: boolean
}

/** `Piece`'s own motion (`ask-thinking-hex.jsx:278–289`). */
export function traceSend(tl: Timeline, T: number, reduced: boolean): SendFrame {
  const S = tl.send
  const A = tl.answer
  if (reduced) {
    return { lift: 1, press: 1, bubble: 1, you: 1, placeholder: 1, busy: A === null || T < A ? 1 : 0, settled: A !== null && T >= A }
  }
  return {
    lift: p(T, S + 0.05, 0.7, MOTION.glide),
    press: p(T, S, 0.32, MOTION.pop),
    bubble: p(T, S + 0.4, 0.4, MOTION.enter),
    you: p(T, S + 0.55, 0.35, MOTION.enter),
    placeholder: p(T, S + 0.5, 0.4, MOTION.enter),
    busy: p(T, S + 0.25, 0.3, MOTION.enter) * (A === null ? 1 : 1 - p(T, A + 0.1, 0.3, MOTION.enter)),
    settled: A !== null && T >= Math.max(S + 0.95, A + 0.4)
  }
}

/** The lift and the user's row are in place by this long after Send. */
export const SEND_SETTLE_S = 0.95

/**
 * The next time after `T` at which the trace changes state: what a view that draws no motion —
 * reduced motion — has to wake for. `null` when nothing more will change by itself.
 */
export function traceNextCue(tl: Timeline, T: number): number | null {
  const cues = traceCues(tl)
  const times = [cues.think, ...cues.steps.flatMap((s) => (s.kind === 'check' ? [s.at, s.at + FOUND_S] : [s.at]))]
  if (cues.answer !== null) times.push(cues.answer)
  let next: number | null = null
  for (const t of times) if (t > T && (next === null || t < next)) next = t
  return next
}
