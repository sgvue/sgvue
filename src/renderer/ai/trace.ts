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
 *   `traceFrame`    timeline, `T`, layout → **everything visible at `T`**: Vee's state, the
 *                   status and its roll, the ticker's lines and counts, the bubble's height,
 *                   every cell, the beam, the answer's words and rows. `traceSend` is the same
 *                   for what stands outside the reply: the lift, the send button, the user row.
 *
 * The arithmetic is the reference's — the three curves (`enter` easeOutQuart, `glide`
 * easeInOutCubic, `pop` easeOutBack), every duration, stagger and offset — and its sizes are the
 * reference's px ÷ 1.5 (`J`).
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
  readPlanFor,
  rowLayout,
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
/** The reply's reveal: 65 ms a word, 0.36 s each; a long reply takes at most this much in all. */
export const WORD_STAGGER_S = 0.065
export const WORD_S = 0.36
export const WORD_REVEAL_MAX_S = 1.6
/** The fly-in: 0.75 s each, 50 ms apart; many flyers share at most this much stagger. */
export const FLY_S = 0.75
export const FLY_STAGGER_S = 0.05
export const FLY_STAGGER_MAX_S = 0.7
/** Vee hops for this long at each finding. */
export const FOUND_S = 0.5
/** The shimmer's sweep. */
export const SHIMMER_S = 1.6

/** The stagger between two words of an `n`-word reply. */
export const wordStagger = (n: number): number =>
  n <= 1 ? 0 : Math.min(WORD_STAGGER_S, (WORD_REVEAL_MAX_S - WORD_S) / (n - 1))

/** The stagger between two of `n` flying cells. */
export const flyStagger = (n: number): number =>
  n <= 1 ? 0 : Math.min(FLY_STAGGER_S, FLY_STAGGER_MAX_S / (n - 1))

/* ────────────────────────────── sizes (app px) ────────────────────────────── */

/** The bubble's own padding — the existing reply bubble's `8px 11px`. */
export const PAD_X = 11
export const PAD_TOP = 8
export const PAD_BOTTOM = 8
/** `:156` — the bubble while the trace runs: ticker plus matrix. */
export const H_THINK = J(78)
/** `:178` — the ticker: its top, its height (which is also how far a line rolls). */
export const TICK_TOP = J(13)
export const TICK_H = J(22)
/** `:330` — the status beside the name: its height, and how far it rolls. */
export const STATUS_H = J(20)
/** `:327` — the author row rises this far as it fades in. */
export const LABEL_RISE = J(6)
/** `:241` — a word rises this far as it fades in. */
export const WORD_RISE = J(7)
/** `:250` — a row slides in from this far left. */
export const ROW_SLIDE = J(8)
/** `:43` — a row's height under the answer. (The matrix's top, `MATRIX_TOP`, is the planner's.) */
export const ROW_H = J(26)
/** `:256`, `:43` — the rows start this far under the answer's text; the rule 4 px above them. */
export const ROWS_GAP = J(12)
export const RULE_GAP = J(6)
/** `:43` — and the bubble ends this far under the last row. */
export const ROWS_BOTTOM = J(10)
/** `:44`, `:166` — the beam starts and ends this far outside the matrix. */
export const BEAM_PAD = J(6)

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
  /** The reply's words, for the reveal. */
  words: number
  /** The turn produced a table, so its answer carries no rows. */
  table: boolean
}

export type TraceEvent =
  | { type: 'begin'; at: number; read: ReadFacts }
  | { type: 'tool_start'; at: number }
  | { type: 'tool_exec'; at: number; facts: ToolFacts }
  | { type: 'done'; at: number; words: number; table: boolean }
  | { type: 'fail' }

/**
 * One event folded into the timeline. `begin` starts a new one; `fail` — a stopped or failed
 * turn — ends in none, because the live reply and its trace go away; nothing changes a turn
 * that has already been answered.
 */
export function traceReduce(tl: Timeline | null, ev: TraceEvent): Timeline | null {
  if (ev.type === 'begin') {
    return { send: ev.at, read: ev.read, tool: null, calls: [], answer: null, words: 0, table: false }
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
      return { ...tl, answer: Math.max(ev.at, tl.send), words: ev.words, table: ev.table }
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

/** What the finished turn leaves on its reply. */
export function traceSummary(tl: Timeline): ChatTrace {
  const rules = lastRules(tl)
  return {
    status: traceStatus(tl),
    wide: hasTrace(tl),
    rows: answerRows(tl).map(({ label, n, ids }) => ({ label, n, ids })),
    noun: rules?.noun ?? 'element'
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

/** One line of the ticker, or of the status: where it stands in its roll. */
export interface Roll {
  /** How far below its place it stands (negative: above), in CSS px. */
  y: number
  opacity: number
}

export interface TickLine extends Roll {
  /** `Reading 4 models`, `Filtering `, `Checking Fire Rating`, a note. */
  label: string
  /** What follows the label in the mono face: `IfcWall`. */
  mono: string
  /** The count on the right, or `null`: its number as printed, its unit, and whether it is lit. */
  count: { n: number; text: string; unit: string; accent: boolean } | null
}

export interface TraceFrame {
  /** The author row: it rises and fades in at Think. */
  label: { opacity: number; y: number }
  /** Vee: its state, and the pop it enters with. */
  sprite: { state: VeeState; scale: number; opacity: number }
  status: {
    /** `Thinking` — and where its shimmer stands, 0…1, or `null` for none. */
    thinking: Roll | null
    shimmer: number | null
    /** The status the turn rolls to, once it is answered. */
    final: Roll | null
    text: string
  }
  bubble: {
    /** The turn opened the trace bubble: it stays full width. */
    wide: boolean
    height: number
    opacity: number
  }
  ticker: { opacity: number; lines: TickLine[] }
  cells: TraceCell[]
  /** The scan beam: its x from the bubble's inner left, and its opacity. */
  beam: { x: number; opacity: number } | null
  /** Each word of the answer: its opacity; it stands `(1 − opacity) × WORD_RISE` low. */
  words: number[]
  /** The rule above the rows, and each row: its opacity; it stands `(1 − opacity) × ROW_SLIDE` left. */
  rule: number
  rows: number[]
  /** The answer is in and nothing is moving any more. */
  settled: boolean
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

/**
 * The cells of the rows under an answer, at rest: where the fly-in ends, and what a finished
 * reply shows for as long as it is in the transcript.
 */
export function rowCells(
  rows: readonly { label: string; n: number }[],
  noun: string,
  layout: Pick<TraceLayout, 'width' | 'dpr' | 'textH'>
): TraceCell[] {
  const lat = traceLattice(layout.dpr)
  const { per, x0 } = rowLayout(rows, noun, layout)
  const cells: TraceCell[] = []
  rows.forEach((row, L) => {
    const y = lat.snap(rowTop(layout.textH, L) + (ROW_H - lat.row.size) / 2)
    for (let slot = 0; slot < Math.ceil(row.n / per); slot++) {
      cells.push({ x: x0 + slot * lat.row.pitch, y, size: lat.row.size, a: 'hit', b: 'hit', t: 1, opacity: 1, scale: 1, ring: -1 })
    }
  })
  return cells
}

/** `:44` — when the beam of a Check that started at `check` reaches the x `xc`. */
export const beamAt = (check: number, xc: number, width: number): number =>
  check + 0.3 + ((xc + BEAM_PAD) / (width + 2 * BEAM_PAD)) * 1.7

/** The bubble's height once the answer is in: its text, and its rows if it has any. */
export const answerHeight = (textH: number, rows: number): number =>
  PAD_TOP + textH + (rows ? ROWS_GAP + rows * ROW_H + ROWS_BOTTOM : PAD_BOTTOM)

/** A row's top inside the bubble. */
export const rowTop = (textH: number, row: number): number => PAD_TOP + textH + ROWS_GAP + row * ROW_H

/** The rule group the matrix is showing, with the times its two steps started. */
interface Scene {
  call: number
  /** Its Filter's and its Check's start, or `null` for a step it does not have. */
  filter: number | null
  check: number | null
}

/**
 * Everything visible at time `T`.
 *
 * The port of `Reply`, `Piece` and `hexState` (`ask-thinking-hex.jsx:155–259`, `:261–336`,
 * `:81–89`). Under `layout.reduced` every animation is at its end from the moment its cue is
 * reached: the states still follow each other, with nothing in between.
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
  /** An animation of the answer, `off` seconds into it. */
  const post = (off: number, dur: number, ease: Ease): number =>
    !answered ? 0 : reduced ? 1 : p(T, A + off, dur, ease)
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
  /** The rows under the answer — nothing of them shows before it. */
  const rows = answered && plan ? plan.rows : []
  const flying = rows.length > 0
  const textH = layout.textH

  if (readPlan && (answered || (read !== null && T >= read))) {
    const ga = lat.a
    const gb = lat.b
    const readAt = read ?? 0
    /**
     * One cell of the grid the Check runs on — the filter grid, or the read grid when the call
     * has no Filter: waiting, lit as the beam finds a match in it, dimmed as the beam passes it
     * by; and at the answer folded away, unless it leaves for a row.
     */
    const checked = (c: PlanCell, x: number, y: number, size: number, m: number, share: number): void => {
      const tb = beamTime(c.x, hasFilter ? gb.size : ga.size)
      const hit = passed(tb)
      if (hit && c.matched) counted += c.matched
      if (c.matched && !answered && !reduced && checking && T >= tb && T < tb + FOUND_S) finding = true
      let scale = 1
      let opacity = 1
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
      if (answered) {
        // The matched cells leave for their rows; with no rows to go to they fold away as well.
        if (c.matched && flying) return
        const d = post(0.05 + share * 0.25, 0.28, MOTION.enter)
        scale *= 1 - d
        opacity *= 1 - d
      }
      if (opacity <= 0.001) return
      cells.push({ x, y, size, a, b, t, opacity, scale, ring })
    }

    if (!plan) {
      // Read: the wave, left to right over a second, each cell flashing and settling.
      for (const c of readPlan.cells) {
        const share = c.order / readPlan.cols
        const sp = pre(readAt, 0.35 + share, 0.3, MOTION.pop)
        let scale = sp
        let opacity = clamp(sp, 0, 1)
        if (answered) {
          const d = post(0.05 + share * 0.25, 0.28, MOTION.enter)
          scale *= 1 - d
          opacity *= 1 - d
        }
        if (opacity <= 0.001) continue
        cells.push({
          x: c.x,
          y: c.y,
          size: ga.size,
          a: 'flash',
          b: 'cell',
          t: preLin(readAt, 0.35 + share + 0.08, 0.45),
          opacity,
          scale,
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
        checked(c, lerp(from.x, c.x, m), lerp(from.y, c.y, m), lerp(ga.size, gb.size, m), m, share)
      }
    } else {
      // A Check with no Filter: the beam scans the read grid.
      for (const c of readPlan.cells) checked(c, c.x, c.y, ga.size, 0, c.order / readPlan.cols)
    }

    if (flying && plan) {
      // Into the rows: x on `glide`, y on `enter`, so the path curves; growing to the row's size.
      // A cell the beam lit is already the accent; one that was only filtered turns it on the way.
      const stagger = flyStagger(plan.flyers.length)
      const lit = !!sceneRules!.check
      const fromSize = plan.filter ? gb.size : ga.size
      plan.flyers.forEach((f, i) => {
        const c = plan.end[f.from]
        const start = 0.5 + i * stagger
        const fx = post(start, FLY_S, MOTION.glide)
        const fy = post(start, FLY_S, MOTION.enter)
        const toX = plan.rowX0 + f.slot * lat.row.pitch
        const toY = lat.snap(rowTop(textH, f.row) + (ROW_H - lat.row.size) / 2)
        cells.push({
          x: lerp(c.x, toX, fx),
          y: lerp(c.y, toY, fy),
          size: lerp(fromSize, lat.row.size, fx),
          a: lit ? 'hit' : 'ready',
          b: 'hit',
          t: lit ? 1 : fx,
          opacity: 1,
          scale: 1,
          ring: -1
        })
      })
    }
  }

  /* ── the beam ── */
  let beam: TraceFrame['beam'] = null
  if (checking && !answered && !reduced) {
    const opacity = p(T, tc + 0.2, 0.2, MOTION.enter) * (1 - p(T, tc + 1.9, 0.25, MOTION.enter))
    if (opacity > 0) beam = { x: lerp(-BEAM_PAD, W + BEAM_PAD, lin(T, tc + 0.3, 1.7)), opacity }
  }

  /* ── the ticker ── */
  const lineOf = (step: TraceStep): Omit<TickLine, keyof Roll> => {
    if (step.kind === 'read') {
      const models = tl.read.models.filter((n) => n > 0).length
      const n = Math.round(tl.read.total * preLin(step.at, 0.35, 1.1))
      return {
        label: `Reading ${countText(models)} ${nounFor(models, 'model')}`,
        mono: '',
        count: { n, text: countText(n), unit: nounFor(n, 'element'), accent: false }
      }
    }
    const facts = tl.calls[step.call].facts
    const r = facts.rules
    if (step.kind === 'filter' && r?.filter) {
      const n = Math.round(lerp(r.total, r.filter.count, pre(step.at, 0.15, 0.9, MOTION.enter)))
      return {
        label: 'Filtering ',
        mono: r.filter.what,
        count: { n, text: countText(n), unit: nounFor(n, r.filter.noun), accent: false }
      }
    }
    if (step.kind === 'check' && r?.check) {
      // The count rises as the beam passes each flagged cell, and ends on the matched size.
      const n = answered || scene?.call !== step.call ? r.check.count : counted
      return {
        label: `Checking ${r.check.props}`,
        mono: '',
        count: { n, text: countText(n), unit: r.check.unit, accent: n > 0 }
      }
    }
    return { label: facts.note, mono: '', count: null }
  }
  const lines: TickLine[] = []
  let tickFade = 1
  if (answered) {
    // The ticker's end state is its last step — queued or not — fading out as the answer starts.
    tickFade = 1 - post(0, 0.28, MOTION.enter)
    if (wide && tickFade > 0) {
      const lastCall = tl.calls.length - 1
      const kinds = lastCall >= 0 ? kindsOf(tl.calls[lastCall]) : []
      const step: TraceStep = kinds.length
        ? { kind: kinds[kinds.length - 1], at: 0, call: lastCall }
        : { kind: 'read', at: 0, call: -1 }
      lines.push({ ...lineOf(step), y: 0, opacity: 1 })
    }
  } else {
    // `Roll` (`:128`): a line enters from below over 0.42 s and leaves upward over 0.32 s.
    steps.forEach((step, i) => {
      if (step.at > T) return
      const next = steps[i + 1]
      const out = !!next && next.at <= T
      const a = reduced ? 1 : p(T, step.at + (i === 0 ? 0.1 : 0), 0.42, MOTION.enter)
      const b = !out ? 0 : reduced ? 1 : p(T, next.at, 0.32, MOTION.enter)
      if (a <= 0 || b >= 1) return
      lines.push({ ...lineOf(step), y: (1 - a) * TICK_H - b * TICK_H, opacity: a * (1 - b) })
    })
  }

  /* ── the bubble ── */
  const words = Array.from({ length: answered ? tl.words : 0 }, (_, j) =>
    post(0.35 + j * wordStagger(tl.words), WORD_S, MOTION.enter)
  )
  const hAnswer = answerHeight(textH, rows.length)
  let height: number
  let opacity: number
  if (wide) {
    const bIn = read === null ? (answered ? 1 : 0) : pre(read, 0, 0.45, MOTION.enter)
    height = lerp(lerp(0, H_THINK, bIn), hAnswer, post(0.15, 0.7, MOTION.glide))
    opacity = clamp(bIn * 1.6, 0, 1)
  } else {
    // No tool ran: there is no trace to fold, so the reply's own bubble opens at the answer.
    const bIn = post(0, 0.45, MOTION.enter)
    height = lerp(0, hAnswer, bIn)
    opacity = clamp(bIn * 1.6, 0, 1)
  }

  /* ── Vee, and the status beside the name ── */
  let state: VeeState = 'thinking'
  if (A !== null && T >= A + (reduced ? 0 : 0.3)) state = 'done'
  else if (read !== null && T >= read) {
    const hop = reduced && checking && !answered && T < tc + FOUND_S && plan!.end.some((c) => c.matched)
    state = finding || hop ? 'found' : 'reading'
  }
  const hexIn = at(think, 0.5, MOTION.pop)
  const lblIn = at(think, 0.4, MOTION.enter)
  const roll = (a: number, b: number): Roll | null =>
    a <= 0 || b >= 1 ? null : { y: (1 - a) * STATUS_H - b * STATUS_H, opacity: a * (1 - b) }
  const thinking = roll(
    at(think + (reduced ? 0 : 0.15), 0.42, MOTION.enter),
    A === null ? 0 : at(A, 0.32, MOTION.enter)
  )
  const final = A === null ? null : roll(at(A + (reduced ? 0 : 0.26), 0.42, MOTION.enter), 0)
  const shimmer = thinking && !reduced && T > think ? ((T - think) / SHIMMER_S) % 1 : null

  /* ── the rows ── */
  const rule = rows.length ? post(0.9, 0.4, MOTION.enter) : 0
  const rowIn = rows.map((_, L) => post(0.95 + L * 0.08, 0.4, MOTION.enter))

  return {
    label: { opacity: lblIn, y: (1 - lblIn) * LABEL_RISE },
    sprite: { state, scale: hexIn, opacity: clamp(hexIn, 0, 1) },
    status: { thinking, shimmer, final, text: traceStatus(tl) },
    bubble: { wide, height, opacity },
    ticker: { opacity: tickFade, lines },
    cells,
    beam,
    words,
    rule,
    rows: rowIn,
    settled: A !== null && (reduced || T >= traceEnd(tl, plan ? plan.flyers.length : 0))
  }
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
 * The last moving instant of an answered turn: the latest end among the answer's animations and
 * the entrances that may still be running if the answer came early. `flyers` is how many cells
 * fly into the rows — the layout's to say; left out, the most their stagger can take is assumed.
 *
 * **Never more than 1.95 s after the answer** for a turn that took longer than a second: the
 * words take at most 0.35 + 1.6 s, the flyers 0.5 + 0.7 + 0.75 s, eight rows 0.95 + 0.56 + 0.4 s.
 */
export function traceEnd(tl: Timeline, flyers?: number): number {
  if (tl.answer === null) return Number.POSITIVE_INFINITY
  const A = tl.answer
  const rows = answerRows(tl)
  let end = A + 0.15 + 0.7 // the bubble
  end = Math.max(end, A + 0.26 + 0.42) // the status
  if (tl.words) end = Math.max(end, A + 0.35 + (tl.words - 1) * wordStagger(tl.words) + WORD_S)
  if (rows.length) {
    end = Math.max(end, A + 0.95 + (rows.length - 1) * 0.08 + 0.4)
    const stagger = flyers === undefined ? FLY_STAGGER_MAX_S : (flyers - 1) * flyStagger(flyers)
    end = Math.max(end, A + 0.5 + Math.max(0, stagger) + FLY_S)
  }
  return Math.max(end, traceCues(tl).think + 0.5, tl.send + SEND_SETTLE_S)
}

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
