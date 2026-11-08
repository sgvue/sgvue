/**
 * The thinking trace's pure core — `src/renderer/ai/trace.ts`.
 *
 * The specification is the owner's "Ask Vee" handoff, kept unchanged in
 * `design-reference/ask-vee/`. Its `ask-thinking-hex.jsx` is the whole choreography as pure
 * functions of a time `T` on fixed data; the app drives the same choreography from real events.
 * So the port is checked **against the handoff itself**: its constants, its cells, its `p`,
 * `lin`, `beamAt` and `hexState` are cut out of the jsx and run (`trace-fixtures.ts`), its scene
 * is rebuilt as a real turn — the events a real one would deliver, at the handoff's own cue times
 * — and `traceFrame` has to draw what the jsx draws, at every instant sampled across the 11.4 s
 * between Send and the end of the hold.
 *
 * Then what the handoff leaves open and the brief fixes: the cue mapping from real events, the
 * answer that is never delayed, steps that pile up, bucketing on a large model, whole device
 * pixels, reduced motion, and what a finished reply keeps.
 *
 * **2026-11-08 ("Vee Messages", stage 1b): the handoff is the specification up to its Answer cue
 * only.** From the answer on, the app's own answer phase (spike 4, `answerFrame`) replaces the
 * handoff's — the narration folds into one line and the reply's parts land, all within half a
 * second — and the trace's own animations are simply at their end. So the comparisons against the
 * jsx run until the answer; what follows it is checked against the new phase's rules: the answer
 * is never delayed, everything queued is at its end at `done`, nothing animates for ever, and the
 * parts land ≤ 110 ms apart on whole device pixels. The ticker is a list now (the diary): every
 * step the turn has shown stays, ticked once the next has begun, with the ticker's own counts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ANSWER_TOTAL_S,
  answerEnd,
  answerFrame,
  answerRows,
  beamAt,
  columnsIn,
  foldText,
  H_THINK,
  J,
  MATRIX_BAND,
  MATRIX_TOP,
  MOTION,
  PART_STAGGER_MAX_S,
  partStagger,
  planWidth,
  ROW_CELLS,
  rowLayout,
  STEP_S,
  TRACE_PALETTE,
  traceCues,
  traceFrame,
  traceLattice,
  traceNextCue,
  traceReduce,
  traceSend,
  traceStatus,
  traceSummary,
  type CellRole,
  type DiaryStep,
  type Timeline,
  type TraceCell,
  type TraceEvent,
  type TraceFrame,
  type TraceLayout,
  type WidthHold
} from '../../src/renderer/ai/trace'
import { readFacts, toolFacts, type ToolFacts } from '../../src/renderer/ai/trace-facts'
import type { Rule } from '../../src/shared/rules'
import {
  CUES,
  federationOf,
  reference,
  referenceFederation,
  REFERENCE_RULES,
  type RefCell,
  type Sketch
} from './trace-fixtures'

const R = reference()

/** A timeline from a list of events. */
const turn = (events: TraceEvent[]): Timeline => {
  let tl: Timeline | null = null
  for (const ev of events) tl = traceReduce(tl, ev)
  if (!tl) throw new Error('the events left no timeline')
  return tl
}

/* ────────────────────────── the handoff's scene, as a real turn ────────────────────────── */

const fed = referenceFederation()
const WALL_FACTS = toolFacts('query_elements', { rules: REFERENCE_RULES }, fed)

/**
 * Send, then the first tool starting when the reference's Read does, its data existing a moment
 * later, and `done` when the reference's Answer starts. Nothing else is told to the reducer: the
 * Filter and the Check cues have to come out of the designed durations.
 */
const SCENE = turn([
  { type: 'begin', at: CUES.Send, read: readFacts(fed) },
  { type: 'tool_start', at: CUES.Read },
  { type: 'tool_exec', at: CUES.Read + 0.4, facts: WALL_FACTS },
  { type: 'done', at: CUES.Answer, words: R.ANSWER.length, table: false }
])

/**
 * The handoff's own layout: its 429 px matrix ÷ 1.5, its numbers left as they are (no device
 * pixel ratio), and an answer text as tall as its two 28 px lines — which puts the rows where its
 * `ROW_Y0` does.
 */
const REF_LAYOUT: TraceLayout = { width: J(R.MW), dpr: null, textH: J(R.ROW_Y0) - 16, reduced: false }

/** The reference's colours, by the role each plays (`trace.ts`, `CellRole`). */
const HEX: Record<CellRole, string> = {
  cell: '#354544',
  flash: '#7E9693',
  ready: '#405351',
  dim: '#2D3B3A',
  hit: '#35C4B6'
}
const rgb = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const mixed = (a: CellRole, b: CellRole, t: number): number[] => {
  const [A, B] = [rgb(HEX[a]), rgb(HEX[b])]
  const u = R.clamp(t, 0, 1)
  return A.map((v, i) => v + (B[i] - v) * u)
}

interface Drawn {
  x: number
  y: number
  size: number
  scale: number
  opacity: number
  colour: number[]
  ring: number
  /** A scope cell before the Filter cue: the one place the port knowingly differs (see below). */
  early: boolean
}

/**
 * The reference's cell loop (`ask-thinking-hex.jsx:187–234`, `full` on), transcribed with the
 * handoff's own helpers and constants. Positions and sizes are returned ÷ 1.5 and measured from
 * the bubble's inner left, which is where `traceFrame` measures from.
 */
function referenceCells(T: number): Drawn[] {
  const { p, lin, lerp, clamp, MOTION: M } = R
  const out: Drawn[] = []
  for (const c of R.CELLS as RefCell[]) {
    const ta = CUES.Read + 0.35 + (c.col / 103) * 1.0
    const sp = p(T, ta, 0.3, M.pop)
    let x = c.xA + R.MX
    let y = c.yA + R.MY
    let size = R.SIZE_A
    let scale = sp
    let op = clamp(sp, 0, 1)
    let colour = mixed('flash', 'cell', lin(T, ta + 0.08, 0.45))
    let ring = -1
    if (c.k == null) {
      const d = p(T, CUES.Filter + 0.1 + (c.col / 103) * 0.45, 0.3, M.enter)
      scale *= 1 - d
      op *= 1 - d
    } else {
      const m = p(T, CUES.Filter + 0.35 + (c.k / 86) * 0.35, 0.7, M.glide)
      x = lerp(x, c.xB! + R.MX, m)
      y = lerp(y, c.yB! + R.MY, m)
      size = lerp(R.SIZE_A, R.SIZE_B, m)
      const tb = R.beamAt(CUES, c.xB! + R.SIZE_B / 2)
      if (c.f == null) {
        const hit = 1 - lin(T, tb, 0.4)
        colour = T < tb ? mixed('cell', 'ready', m) : mixed('dim', 'flash', hit)
        const d = p(T, CUES.Answer + 0.05 + (c.k / 86) * 0.25, 0.28, M.enter)
        scale *= 1 - d
        op *= 1 - d
      } else {
        if (T >= tb) {
          colour = mixed('hit', 'hit', 0)
          scale = lerp(0.45, 1, p(T, tb, 0.45, M.pop))
          const rr = p(T, tb, 0.6, M.enter)
          // The reference's last ring is thrown 0.52 s before its Answer cue and takes 0.6 s, so
          // 0.08 s of it — under a ten-thousandth of its opacity — runs on into the answer. The
          // port finishes every animation of the trace at the answer; that tail is the one
          // thing of the reference it does not draw, and it is checked to be nothing.
          if (rr < 1 && T >= CUES.Answer) expect(0.8 * (1 - rr)).toBeLessThan(1e-4)
          else if (rr < 1) ring = rr
        } else colour = mixed('cell', 'ready', m)
        const sx = 61 + R.FLAG_SLOT[c.f] * 14
        const sy = R.ROW_Y0 + R.FLAG_LEVEL[c.f] * R.ROW_H + 8
        const tf = CUES.Answer + 0.5 + c.f * 0.05
        const fx = p(T, tf, 0.75, M.glide)
        const fy = p(T, tf, 0.75, M.enter)
        x = lerp(x, sx, fx)
        y = lerp(y, sy, fy)
        size = lerp(size, 10, fx)
      }
    }
    // The reference returns `null` here for all but its flagged cells, which it draws at
    // opacity 0; neither is anything on screen.
    if (op <= 0.001) continue
    out.push({
      x: (x - R.MX) / 1.5,
      y: y / 1.5,
      size: size / 1.5,
      scale,
      opacity: op,
      colour,
      ring,
      early: c.k != null && T < CUES.Filter
    })
  }
  return out
}

const drawn = (c: TraceCell): Drawn => ({
  x: c.x,
  y: c.y,
  size: c.size,
  scale: c.scale,
  opacity: c.opacity,
  colour: mixed(c.a, c.b, c.t),
  ring: c.ring,
  early: false
})

/** Left to right, then top to bottom — x compared to a millionth, so float dust cannot reorder a column. */
const byPlace = (a: Drawn, b: Drawn): number => Math.round(a.x * 1e6) - Math.round(b.x * 1e6) || a.y - b.y

/** Sample times that fall on no cue and no round number. */
const SAMPLES = (() => {
  const out: number[] = []
  for (let T = CUES.Send - 0.31; T < CUES.Hold + 1.2; T += 0.0371) out.push(T)
  return out
})()
/** The samples the handoff is still the specification for: until its Answer cue (stage 1b). */
const BEFORE = SAMPLES.filter((T) => T < CUES.Answer)
/** A diary step as text: its label, its mono, and its count. */
const stepText = (st: DiaryStep): string => `${st.label}${st.mono}${st.count ? ` · ${st.count.text} ${st.count.unit}` : ''}`

const frameAt = (T: number, layout = REF_LAYOUT): TraceFrame => traceFrame(SCENE, T, layout)

describe('the handoff’s scene, driven by events', () => {
  it('reads the reference’s data out of the handoff itself', () => {
    expect(CUES).toEqual({ Open: 0, Send: 2.6, Think: 3.6, Read: 5, Filter: 6.8, Check: 8.4, Answer: 10.8, Hold: 14 })
    expect(R.CELLS).toHaveLength(412)
    expect(R.WALLS).toHaveLength(86)
    expect(R.FLAGGED).toHaveLength(9)
    expect(R.MODEL_COLS).toEqual([35, 61, 5, 2])
    expect(R.LEVELS).toEqual([['L1', 3], ['L2', 2], ['L3', 2], ['L4', 2]])
    // The three curves are the reference's own.
    for (const t of [0, 0.13, 0.5, 0.77, 1]) {
      expect(MOTION.enter(t)).toBeCloseTo(R.MOTION.enter(t), 12)
      expect(MOTION.glide(t)).toBeCloseTo(R.MOTION.glide(t), 12)
      expect(MOTION.pop(t)).toBeCloseTo(R.MOTION.pop(t), 12)
    }
  })

  it('finds the reference’s numbers in real elements: 412 in 4 models, 86 walls, 9 with no fire rating', () => {
    expect(readFacts(fed)).toEqual({ models: [140, 244, 20, 8], total: 412 })
    const r = WALL_FACTS.rules!
    expect(r.filter).toEqual({ what: 'IfcWall', count: 86, noun: 'wall' })
    // The file's own spelling since 2026-11-08 (the owner's IFC-term decision).
    expect(r.check).toEqual({ props: 'FireRating', count: 9, unit: 'missing' })
    expect(r.scope).toEqual(R.WALLS)
    expect(r.matched).toEqual(R.FLAGGED.map((k) => R.WALLS[k]))
    expect(r.rows.map((row) => [row.label, row.n])).toEqual(R.LEVELS)
  })

  it('derives the reference’s cues from the events: Think 1 s after Send, Filter and Check from the designed durations', () => {
    const cues = traceCues(SCENE)
    expect(cues.send).toBe(CUES.Send)
    expect(cues.think).toBeCloseTo(CUES.Think, 12)
    expect(cues.read).toBe(CUES.Read)
    expect(cues.steps.map((s) => [s.kind, Number(s.at.toFixed(9))])).toEqual([
      ['read', CUES.Read],
      ['filter', CUES.Filter],
      ['check', CUES.Check]
    ])
    expect(cues.answer).toBe(CUES.Answer)
    // The Check has had its whole 2.4 s when the answer arrives, as in the reference.
    expect(CUES.Check + STEP_S.check).toBeCloseTo(CUES.Answer, 12)
  })

  /**
   * The whole matrix, cell for cell, at 330 instants: where each stands, how large, its scale,
   * its opacity, its colour and its ring.
   *
   * One knowing difference. During Read the reference already knows which cells will be walls and
   * gives those 86 no flash (its code overwrites their colour before the wave is over); the app
   * cannot know what a question will filter to before the tool has run, so every cell flashes —
   * which is what the handoff's README describes. Those cells are compared in everything but
   * colour until the Filter cue.
   */
  it('draws the reference’s cells until its Answer: place, size, scale, opacity, colour and ring — then holds them at their end', () => {
    let compared = 0
    for (const T of BEFORE) {
      const want = referenceCells(T).sort(byPlace)
      const got = frameAt(T).cells.map(drawn).sort(byPlace)
      expect([T, got.length]).toEqual([T, want.length])
      got.forEach((g, i) => {
        const w = want[i]
        const where = `T ${T.toFixed(4)} cell ${i}`
        expect([where, g.x]).toEqual([where, expect.closeTo(w.x, 6)])
        expect([where, g.y]).toEqual([where, expect.closeTo(w.y, 6)])
        expect([where, g.size]).toEqual([where, expect.closeTo(w.size, 6)])
        expect([where, g.scale]).toEqual([where, expect.closeTo(w.scale, 6)])
        expect([where, g.opacity]).toEqual([where, expect.closeTo(w.opacity, 6)])
        expect([where, g.ring]).toEqual([where, expect.closeTo(w.ring, 6)])
        if (!w.early) g.colour.forEach((v, k) => expect([where, k, v]).toEqual([where, k, expect.closeTo(w.colour[k], 4)]))
        compared++
      })
    }
    expect(compared).toBeGreaterThan(20_000)
    // From the answer on the matrix is the Check's end, and nothing of it moves again: the nine
    // findings lit, the other 77 walls dimmed, each in its place in the filter grid.
    const end = frameAt(CUES.Answer).cells
    expect(end).toHaveLength(86)
    expect(end.filter((c) => c.a === 'hit' && c.scale === 1 && c.ring === -1)).toHaveLength(9)
    expect(end.filter((c) => c.a === 'dim' && c.t === 0)).toHaveLength(77)
    for (const T of SAMPLES.filter((t) => t >= CUES.Answer)) expect([T, frameAt(T).cells]).toEqual([T, end])
  }, 20_000) // the whole matrix at every sample: ~1.3 s alone, past vitest's 5 s default at full parallelism on a busy PC or a slower CI runner

  it('spot-checks the two grids and the rows against the reference’s formulas ÷ 1.5', () => {
    // Read, the wave over: every cell at `col × PITCH_A + g × GAP_G + (PITCH_A − SIZE_A) / 2`.
    const read = frameAt(CUES.Filter - 0.01).cells
    expect(read).toHaveLength(412)
    const cellAt = (cells: TraceCell[], x: number, y: number): TraceCell | undefined =>
      cells.find((c) => Math.abs(c.x - x) < 1e-6 && Math.abs(c.y - y) < 1e-6)
    for (const i of [0, 3, 139, 140, 383, 384, 404, 411]) {
      const c = R.CELLS[i]
      const found = cellAt(read, c.xA / 1.5, (c.yA + R.MY) / 1.5)
      expect([i, !!found]).toEqual([i, true])
      expect(found!.size).toBeCloseTo(R.SIZE_A / 1.5, 9)
    }
    // The last column of the last model stands just inside the bubble's 286 px.
    const right = Math.max(...read.map((c) => c.x + c.size))
    expect(right).toBeLessThanOrEqual(J(R.MW))
    expect(right).toBeGreaterThan(J(R.MW) - 1)
    // Filter, the glide over: 86 cells in 2 × 43, `floor(k / 2) × PITCH_B`, 7 ÷ 1.5 px.
    const filter = frameAt(CUES.Check - 0.01).cells
    expect(filter).toHaveLength(86)
    for (const k of [0, 1, 42, 85]) {
      const c = R.CELLS[R.WALLS[k]]
      const found = cellAt(filter, c.xB! / 1.5, (c.yB! + R.MY) / 1.5)
      expect([k, !!found]).toEqual([k, true])
      expect(found!.size).toBeCloseTo(R.SIZE_B / 1.5, 9)
    }
    // Done: the nine findings stay where the beam lit them, in the filter grid — no cell flies
    // into rows since stage 1b: the rows are a card of their own.
    const done = frameAt(CUES.Hold).cells
    expect(done).toHaveLength(86)
    for (const k of R.FLAGGED) {
      const c = R.CELLS[R.WALLS[k]]
      expect(cellAt(done, c.xB! / 1.5, (c.yB! + R.MY) / 1.5)).toMatchObject({ a: 'hit', b: 'hit', opacity: 1, scale: 1, ring: -1 })
    }
    expect(MATRIX_TOP).toBeCloseTo(R.MY / 1.5, 12)
    // The diary's canvas is the old bubble's band the matrix stood in: the beam's top to its foot.
    expect(MATRIX_BAND).toEqual({ top: MATRIX_TOP - J(6), height: expect.closeTo(H_THINK - MATRIX_TOP + J(6), 9) })
    for (const c of [...frameAt(CUES.Filter - 0.01).cells, ...done]) {
      expect(c.y).toBeGreaterThanOrEqual(MATRIX_BAND.top)
      expect(c.y + c.size).toBeLessThanOrEqual(MATRIX_BAND.top + MATRIX_BAND.height)
    }
  })

  it('shows typing dots from Think, then opens the diary at Read, fading in as the reference’s bubble did', () => {
    const { p, clamp, MOTION: M } = R
    for (const T of BEFORE) {
      const bIn = p(T, CUES.Read, 0.45, M.enter)
      const f = frameAt(T)
      expect([T, f.bubble]).toEqual([T, { wide: true, opacity: expect.closeTo(clamp(bIn * 1.6, 0, 1), 6) }])
      expect([T, f.dots]).toEqual([T, T >= CUES.Think && T < CUES.Read])
    }
    expect(frameAt(CUES.Hold).bubble).toEqual({ wide: true, opacity: 1 })
    expect(frameAt(CUES.Hold).dots).toBe(false)
    expect(H_THINK).toBeCloseTo(52, 12)
  })

  it('lists Reading, Filtering and Checking as the diary’s steps, with the reference’s counts, each ticked once the next begins', () => {
    const { p, lin, lerp, MOTION: M } = R
    for (const T of BEFORE) {
      const n1 = Math.round(412 * lin(T, CUES.Read + 0.35, 1.1))
      const n2 = Math.round(lerp(412, 86, p(T, CUES.Filter + 0.15, 0.9, M.enter)))
      const missing = R.FLAGGED.filter((k) => T >= R.beamAt(CUES, R.CELLS[R.WALLS[k]].xB! + R.SIZE_B / 2)).length
      const want = [
        { at: CUES.Read, roll: CUES.Read + 0.1, label: 'Reading 4 models', mono: '', n: n1, unit: n1 === 1 ? 'element' : 'elements', accent: false, next: CUES.Filter },
        { at: CUES.Filter, roll: CUES.Filter, label: 'Filtering ', mono: 'IfcWall', n: n2, unit: 'walls', accent: false, next: CUES.Check },
        { at: CUES.Check, roll: CUES.Check, label: 'Checking ', mono: 'FireRating', n: missing, unit: 'missing', accent: missing > 0, next: Infinity }
      ].filter((w) => T >= w.at)
      const f = frameAt(T)
      expect([T, f.steps.map((l) => l.label + l.mono)]).toEqual([T, want.map((w) => w.label + w.mono)])
      f.steps.forEach((step, i) => {
        const w = want[i]
        const a = p(T, w.roll, 0.42, M.enter)
        expect([T, step.y]).toEqual([T, expect.closeTo((1 - a) * 8, 6)])
        expect([T, step.opacity]).toEqual([T, expect.closeTo(a, 6)])
        expect([T, step.done]).toEqual([T, T >= w.next])
        expect([T, step.count]).toEqual([T, { n: w.n, text: String(w.n), unit: w.unit, accent: w.accent }])
      })
    }
    // Chosen instants, in words.
    const said = (T: number): string => frameAt(T).steps.map(stepText).join(' | ')
    expect(said(CUES.Read + 0.9)).toBe('Reading 4 models · 206 elements')
    expect(said(CUES.Filter - 0.1)).toBe('Reading 4 models · 412 elements')
    expect(said(CUES.Filter + 1.2)).toBe('Reading 4 models · 412 elements | Filtering IfcWall · 86 walls')
    expect(said(CUES.Check + 0.35)).toBe('Reading 4 models · 412 elements | Filtering IfcWall · 86 walls | Checking FireRating · 0 missing')
    expect(said(CUES.Check + 2.3)).toMatch(/Checking FireRating · 9 missing$/)
    // The number lights only once it is above 0.
    expect(frameAt(CUES.Check + 0.35).steps[2].count!.accent).toBe(false)
    expect(frameAt(CUES.Check + 1.0).steps[2].count!.accent).toBe(true)
    // At the answer every step is ticked, at its end, and in place.
    expect(frameAt(CUES.Answer).steps.map((st) => [stepText(st), st.done, st.y, st.opacity])).toEqual([
      ['Reading 4 models · 412 elements', true, 0, 1],
      ['Filtering IfcWall · 86 walls', true, 0, 1],
      ['Checking FireRating · 9 missing', true, 0, 1]
    ])
  })

  it('sweeps the beam left to right in 1.7 s, 6 ÷ 1.5 px beyond either side', () => {
    const { p, lin, lerp, MOTION: M } = R
    for (const T of SAMPLES) {
      const op = p(T, CUES.Check + 0.2, 0.2, M.enter) * (1 - p(T, CUES.Check + 1.9, 0.25, M.enter))
      const f = frameAt(T)
      if (op <= 0 || T >= CUES.Answer) {
        expect([T, f.beam]).toEqual([T, null])
        continue
      }
      expect([T, f.beam!.opacity]).toEqual([T, expect.closeTo(op, 6)])
      expect([T, f.beam!.x]).toEqual([T, expect.closeTo(lerp(-6, R.MW + 6, lin(T, CUES.Check + 0.3, 1.7)) / 1.5, 6)])
    }
    expect(frameAt(CUES.Check + 0.3).beam!.x).toBeCloseTo(-4, 9)
    expect(frameAt(CUES.Check + 2.0).beam!.x).toBeCloseTo(J(R.MW) + 4, 9)
    // The beam's time at a cell is the reference's `beamAt`.
    for (const k of R.FLAGGED) {
      const c = R.CELLS[R.WALLS[k]]
      expect(beamAt(CUES.Check, (c.xB! + R.SIZE_B / 2) / 1.5, J(R.MW))).toBeCloseTo(R.beamAt(CUES, c.xB! + R.SIZE_B / 2), 9)
    }
  })

  it('takes Vee through thinking, reading, a hop at each of the nine findings, and done', () => {
    for (const T of SAMPLES) expect([T, frameAt(T).sprite.state]).toEqual([T, R.hexState(T, CUES)])
    expect(frameAt(CUES.Think + 0.5).sprite.state).toBe('thinking')
    expect(frameAt(CUES.Read + 0.5).sprite.state).toBe('reading')
    expect(frameAt(CUES.Filter + 0.5).sprite.state).toBe('reading')
    // Each finding: `found` from the moment the beam reaches the cell, for half a second.
    const hits = R.FLAGGED.map((k) => R.beamAt(CUES, R.CELLS[R.WALLS[k]].xB! + R.SIZE_B / 2))
    expect(hits).toHaveLength(9)
    for (const tb of hits) {
      expect([tb, frameAt(tb + 0.01).sprite.state]).toEqual([tb, 'found'])
      expect([tb, frameAt(tb + 0.49).sprite.state]).toEqual([tb, 'found'])
    }
    expect(frameAt(hits[0] - 0.01).sprite.state).toBe('reading')
    expect(frameAt(hits[8] + 0.51).sprite.state).toBe('reading')
    expect(frameAt(CUES.Answer + 0.29).sprite.state).toBe('reading')
    expect(frameAt(CUES.Answer + 0.31).sprite.state).toBe('done')
    expect(frameAt(CUES.Hold + 5).sprite.state).toBe('done')
  })

  it('brings the sprite in as the reference does, and shimmers `Thinking` beside the seconds until the answer', () => {
    const { p, clamp, MOTION: M } = R
    for (const T of SAMPLES) {
      const f = frameAt(T)
      const hexIn = p(T, CUES.Think, 0.5, M.pop)
      expect([T, f.sprite.scale]).toEqual([T, expect.closeTo(hexIn, 6)])
      expect([T, f.sprite.opacity]).toEqual([T, expect.closeTo(clamp(hexIn, 0, 1), 6)])
      // The shimmer sweeps once every 1.6 s for as long as the turn runs.
      if (T > CUES.Think && T < CUES.Answer) expect([T, f.thinking.shimmer]).toEqual([T, expect.closeTo(((T - CUES.Think) / 1.6) % 1, 9)])
      else expect([T, f.thinking.shimmer]).toEqual([T, null])
      // The seconds since Send, whole; held at the answer.
      expect([T, f.thinking.seconds]).toEqual([T, Math.max(0, Math.floor(Math.min(T, CUES.Answer) - CUES.Send))])
    }
    // The pop overshoots: Vee is larger than life for a moment as it arrives.
    expect(Math.max(...SAMPLES.map((T) => frameAt(T).sprite.scale))).toBeGreaterThan(1.05)
  })

  it('lands the reply’s parts at the answer: ≤ 110 ms apart, all in under 0.5 s, the diary folding in 0.22 s', () => {
    const { p, MOTION: M } = R
    for (const n of [1, 3, 5]) {
      for (const T of SAMPLES) {
        const a = answerFrame(SCENE, T, n, { dpr: null, reduced: false })
        if (T < CUES.Answer) {
          expect([T, a.fold, a.parts.every((q) => q.opacity === 0 && q.y === 6), a.settled]).toEqual([T, 0, true, false])
          continue
        }
        expect([T, a.fold]).toEqual([T, expect.closeTo(p(T, CUES.Answer, 0.22, M.enter), 9)])
        a.parts.forEach((q, k) => {
          const e = p(T, CUES.Answer + k * partStagger(n), 0.24, M.enter)
          expect([T, k, q.opacity]).toEqual([T, k, expect.closeTo(e, 9)])
          expect([T, k, q.y]).toEqual([T, k, expect.closeTo((1 - e) * 6, 9)])
        })
      }
    }
    expect(partStagger(3)).toBe(PART_STAGGER_MAX_S)
    expect(partStagger(1)).toBe(0)
  })

  it('lifts the question, presses the button and turns it to stop, as the reference does', () => {
    const { p, MOTION: M } = R
    for (const T of SAMPLES) {
      const f = traceSend(SCENE, T, false)
      expect([T, f.lift]).toEqual([T, expect.closeTo(p(T, CUES.Send + 0.05, 0.7, M.glide), 9)])
      expect([T, f.press]).toEqual([T, expect.closeTo(p(T, CUES.Send, 0.32, M.pop), 9)])
      expect([T, f.bubble]).toEqual([T, expect.closeTo(p(T, CUES.Send + 0.4, 0.4, M.enter), 9)])
      expect([T, f.you]).toEqual([T, expect.closeTo(p(T, CUES.Send + 0.55, 0.35, M.enter), 9)])
      expect([T, f.placeholder]).toEqual([T, expect.closeTo(p(T, CUES.Send + 0.5, 0.4, M.enter), 9)])
      expect([T, f.busy]).toEqual([
        T,
        expect.closeTo(p(T, CUES.Send + 0.25, 0.3, M.enter) * (1 - p(T, CUES.Answer + 0.1, 0.3, M.enter)), 9)
      ])
    }
    expect(traceSend(SCENE, CUES.Think, false)).toMatchObject({ lift: 1, bubble: 1, you: 1, placeholder: 1, busy: 1 })
    expect(traceSend(SCENE, CUES.Answer + 0.5, false)).toMatchObject({ busy: 0, settled: true })
  })

  it('says `checked 86 walls`, folds to `412 read · 86 walls · 9 missing`, and the seconds the turn really took', () => {
    // 2.6 → 10.8 on the reference's own clock is 8.2 s. (Its still reads `7s`: a drawn string.)
    expect(traceStatus(SCENE)).toBe('checked 86 walls · 8s')
    expect(foldText(SCENE)).toBe('412 read · 86 walls · 9 missing · 8s')
    expect(traceSummary(SCENE)).toEqual({
      status: 'checked 86 walls · 8s',
      wide: true,
      noun: 'wall',
      rows: R.LEVELS.map(([label, n]) => ({ label, n, ids: expect.any(Array) })),
      fold: '412 read · 86 walls · 9 missing · 8s',
      steps: [
        { label: 'Reading 4 models', mono: '', n: 412, unit: 'elements' },
        { label: 'Filtering ', mono: 'IfcWall', n: 86, unit: 'walls' },
        { label: 'Checking ', mono: 'FireRating', n: 9, unit: 'missing' }
      ],
      title: 'FireRating · missing'
    })
    expect(traceSummary(SCENE).rows.flatMap((r) => r.ids)).toHaveLength(9)
  })

  it('stops moving under half a second after the answer, and says so', () => {
    // Five parts: the fifth starts 4 × 0.11 s in and takes 0.24 s — 0.68 s is too long, so the
    // stagger shrinks to keep all five under 0.5 s.
    const n = 5
    expect(answerEnd(SCENE, n) - CUES.Answer).toBeLessThan(ANSWER_TOTAL_S)
    expect(answerFrame(SCENE, answerEnd(SCENE, n) - 0.001, n, { dpr: 1, reduced: false }).settled).toBe(false)
    expect(answerFrame(SCENE, answerEnd(SCENE, n), n, { dpr: 1, reduced: false })).toEqual({
      fold: 1,
      parts: Array(n).fill({ opacity: 1, y: 0 }),
      settled: true
    })
    // Nothing of the trace differs between the answer and any later instant.
    expect(frameAt(CUES.Answer + 0.6)).toEqual(frameAt(CUES.Answer + 60))
    // While the turn runs it is never settled.
    const live = turn([{ type: 'begin', at: 0, read: readFacts(fed) }])
    expect(answerFrame(live, 500, 3, { dpr: 1, reduced: false }).settled).toBe(false)
    expect(answerEnd(live, 3)).toBe(Number.POSITIVE_INFINITY)
  })
})

/* ────────────────────────────── real events ────────────────────────────── */

const READ = readFacts(fed)
const NOTE = (name: string): ToolFacts => toolFacts(name, {}, fed)
const RULED = (rules: readonly Rule[]): ToolFacts => toolFacts('query_elements', { rules }, fed)

describe('the cues, from real events', () => {
  it('starts Read at the first tool, but not before Think + 0.4 s', () => {
    const early = turn([{ type: 'begin', at: 10, read: READ }, { type: 'tool_start', at: 10.2 }])
    expect(traceCues(early)).toMatchObject({ send: 10, think: 11, read: 11.4 })
    const late = turn([{ type: 'begin', at: 10, read: READ }, { type: 'tool_start', at: 17.5 }])
    expect(traceCues(late).read).toBe(17.5)
    // No tool yet: no Read, no bubble — `Thinking` only.
    const none = turn([{ type: 'begin', at: 10, read: READ }])
    expect(traceCues(none)).toMatchObject({ read: null, steps: [], answer: null, last: -1 })
    const f = traceFrame(none, 14, REF_LAYOUT)
    expect(f.bubble).toEqual({ wide: false, opacity: 0 })
    // Typing dots, and nothing else.
    expect([f.sprite.state, f.cells, f.steps, f.dots]).toEqual(['thinking', [], [], true])
    // A tool that ran without announcing itself still opens the trace.
    const quiet = turn([{ type: 'begin', at: 10, read: READ }, { type: 'tool_exec', at: 12, facts: NOTE('get_view_state') }])
    expect(traceCues(quiet).read).toBe(12)
  })

  it('starts each step when its data exists and the step before has had its time', () => {
    const tl = turn([
      { type: 'begin', at: 0, read: READ },
      { type: 'tool_start', at: 2 },
      { type: 'tool_exec', at: 2.1, facts: NOTE('get_model_info') },
      { type: 'tool_exec', at: 9, facts: WALL_FACTS },
      { type: 'tool_exec', at: 20, facts: NOTE('set_view') }
    ])
    expect(traceCues(tl).steps).toEqual([
      { kind: 'read', at: 2, call: -1 },
      // The note waits for Read's 1.8 s.
      { kind: 'note', at: 3.8, call: 0 },
      // The Filter starts when its data exists; the Check 1.6 s after it.
      { kind: 'filter', at: 9, call: 1 },
      { kind: 'check', at: 10.6, call: 1 },
      { kind: 'note', at: 20, call: 2 }
    ])
    // The note is the busy row's own phrase, capitalised, with no count; the matrix is untouched.
    const f = traceFrame(tl, 5, REF_LAYOUT)
    expect(f.steps.map((l) => [l.label, l.mono, l.count?.n ?? null, l.done])).toEqual([
      ['Reading 4 models', '', 412, true],
      ['Reading the file header', '', null, false]
    ])
    expect(f.cells).toHaveLength(412)
    expect(traceFrame(tl, 21, REF_LAYOUT).steps.map((l) => l.label + l.mono)).toEqual([
      'Reading 4 models',
      'Reading the file header',
      'Filtering IfcWall',
      'Checking FireRating',
      'Moving the camera'
    ])
    // …and under a note that follows a Check the matrix stays as the Check left it.
    expect(traceFrame(tl, 21, REF_LAYOUT).cells.filter((c) => c.a === 'hit')).toHaveLength(9)
  })

  it('shows only the latest of the calls that pile up behind a step', () => {
    const tl = turn([
      { type: 'begin', at: 0, read: READ },
      { type: 'tool_start', at: 2 },
      // Three calls in one round, all there before Read has had its 1.8 s.
      { type: 'tool_exec', at: 2.1, facts: NOTE('get_model_info') },
      { type: 'tool_exec', at: 2.2, facts: NOTE('get_spatial_tree') },
      { type: 'tool_exec', at: 2.3, facts: WALL_FACTS },
      // One more arrives while the Filter runs; it waits its turn.
      { type: 'tool_exec', at: 4, facts: NOTE('set_view') }
    ])
    expect(traceCues(tl).steps.map((s) => [s.kind, Number(s.at.toFixed(9)), s.call])).toEqual([
      ['read', 2, -1],
      ['filter', 3.8, 2],
      ['check', 5.4, 2],
      ['note', 7.8, 3]
    ])
    // A later rule-bearing call restarts from the read layout — no wave — and plays its own.
    const again = turn([
      { type: 'begin', at: 0, read: READ },
      { type: 'tool_start', at: 2 },
      { type: 'tool_exec', at: 2.1, facts: WALL_FACTS },
      { type: 'tool_exec', at: 12, facts: RULED([{ prop: 'Model', op: '=', val: 'STR' }]) }
    ])
    expect(traceCues(again).steps.map((s) => [s.kind, Number(s.at.toFixed(9)), s.call])).toEqual([
      ['read', 2, -1],
      ['filter', 3.8, 0],
      ['check', 5.4, 0],
      ['filter', 12, 1]
    ])
    expect(traceFrame(again, 11.9, REF_LAYOUT).cells).toHaveLength(86)
    const restart = traceFrame(again, 12.05, REF_LAYOUT)
    expect(restart.cells).toHaveLength(412)
    expect(restart.cells.every((c) => c.scale === 1 && c.opacity === 1 && c.size === J(3.2))).toBe(true)
    expect(restart.steps.slice(-2).map((l) => l.label + l.mono)).toEqual(['Checking FireRating', 'Filtering STR'])
    // The Check before it keeps its final count in the diary.
    expect(restart.steps[2].count!.n).toBe(9)
    // 244 elements of STR: more than the 86 the filter grid holds one each, so 3 to a cell.
    const settled = traceFrame(again, 14, REF_LAYOUT)
    expect(settled.cells).toHaveLength(82)
    expect(settled.steps.at(-1)!.count).toEqual({ n: 244, text: '244', unit: 'elements', accent: false })
  })
})

describe('the answer is never delayed by animation', () => {
  /** `done` 0.5 s into the Filter: the walls are mid-glide, the Check has not begun. */
  const SNAP = turn([
    { type: 'begin', at: 0, read: READ },
    { type: 'tool_start', at: 2 },
    { type: 'tool_exec', at: 2.2, facts: WALL_FACTS },
    { type: 'done', at: 4.3, words: 13, table: false }
  ])

  it('finishes everything queued or in flight at the instant `done` arrives', () => {
    expect(traceCues(SNAP).steps.map((s) => [s.kind, Number(s.at.toFixed(9))])).toEqual([['read', 2], ['filter', 3.8]])
    // An instant before: 86 walls on their way, the rest dropping out, nothing checked.
    const before = traceFrame(SNAP, 4.299, REF_LAYOUT)
    expect(before.cells.some((c) => c.a === 'hit')).toBe(false)
    expect(before.cells.length).toBeGreaterThan(86)
    expect(before.steps.map((l) => l.label + l.mono)).toEqual(['Reading 4 models', 'Filtering IfcWall'])
    expect(answerFrame(SNAP, 4.299, 4, { dpr: 1, reduced: false }).parts.every((q) => q.opacity === 0)).toBe(true)
    // At the answer: the Check that never ran is at its end. The nine findings are lit, the
    // other 77 walls dimmed, each in its place in the filter grid; every step shown is ticked at
    // its end; no beam.
    const at = traceFrame(SNAP, 4.3, REF_LAYOUT)
    expect(at.cells).toHaveLength(86)
    expect(at.cells.filter((c) => c.a === 'hit' && c.scale === 1 && c.ring === -1)).toHaveLength(9)
    expect(at.cells.filter((c) => c.a === 'dim' && c.t === 0)).toHaveLength(77)
    for (const c of at.cells) expect(c.size).toBeCloseTo(J(7), 9)
    expect(at.beam).toBeNull()
    expect(at.steps.map((l) => [l.label + l.mono, l.count!.n, l.done, l.y, l.opacity])).toEqual([
      ['Reading 4 models', 412, true, 0, 1],
      ['Filtering IfcWall', 86, true, 0, 1]
    ])
    expect(at.bubble).toEqual({ wide: true, opacity: 1 })
    // …and the answer's own motion starts there: the first part lands from the answer itself.
    const { p, MOTION: M } = R
    for (const dt of [0.02, 0.1, 0.2, 0.4]) {
      const a = answerFrame(SNAP, 4.3 + dt, 4, { dpr: null, reduced: false })
      expect(a.parts[0].opacity).toBeCloseTo(p(dt, 0, 0.24, M.enter), 9)
      expect(a.fold).toBeCloseTo(p(dt, 0, 0.22, M.enter), 9)
    }
    expect(traceFrame(SNAP, 4.3 + 0.31, REF_LAYOUT).sprite.state).toBe('done')
    expect(traceStatus(SNAP)).toBe('checked 86 walls · 4s')
    // The fold says what the last call found, whether or not its Check was ever shown.
    expect(foldText(SNAP)).toBe('412 read · 86 walls · 9 missing · 4s')
    // Nothing of the trace moves after the answer: only Vee turns `done`, 0.3 s on.
    expect({ ...traceFrame(SNAP, 30, REF_LAYOUT), sprite: at.sprite }).toEqual(at)
    expect(answerFrame(SNAP, 30, 4, { dpr: 1, reduced: false }).settled).toBe(true)
  })

  it('answers a turn whose tools all ran in an instant: no Think wait, no Read wait', () => {
    // The dev harness's turn — everything within a few milliseconds of Send.
    const tl = turn([
      { type: 'begin', at: 100, read: READ },
      { type: 'tool_exec', at: 100.002, facts: WALL_FACTS },
      { type: 'done', at: 100.004, words: 4, table: false }
    ])
    const cues = traceCues(tl)
    expect(cues.think).toBe(100.004)
    expect(cues.read).toBeNull()
    expect(cues.steps).toEqual([])
    const at = traceFrame(tl, 100.004, REF_LAYOUT)
    expect(at.bubble).toEqual({ wide: true, opacity: 1 })
    expect(at.cells.filter((c) => c.a === 'hit')).toHaveLength(9)
    expect(at.steps).toEqual([])
    // The lift from the composer is what runs longest: settled once it is over, 0.95 s after Send.
    expect(answerEnd(tl, 3)).toBeCloseTo(100 + 0.95, 9)
    expect(answerFrame(tl, 100.96, 3, { dpr: 1, reduced: false }).settled).toBe(true)
    expect(traceStatus(tl)).toBe('checked 86 walls · 1s')
  })

  it('ignores whatever arrives after the answer, and a failed turn leaves no timeline', () => {
    const late = traceReduce(SNAP, { type: 'tool_exec', at: 9, facts: NOTE('set_view') })
    expect(late).toBe(SNAP)
    expect(traceReduce(SNAP, { type: 'tool_start', at: 9 })).toBe(SNAP)
    expect(traceReduce(SNAP, { type: 'fail' })).toBeNull()
    expect(traceReduce(null, { type: 'tool_start', at: 1 })).toBeNull()
  })
})

describe('a turn with no tool', () => {
  const tl = turn([
    { type: 'begin', at: 0, read: READ },
    { type: 'done', at: 3.4, words: 30, table: false }
  ])
  const layout: TraceLayout = { ...REF_LAYOUT, textH: 58 }

  it('opens no diary: typing dots until the answer, then the parts land', () => {
    expect(traceFrame(tl, 3.39, layout)).toMatchObject({ bubble: { wide: false, opacity: 0 }, dots: true, steps: [], cells: [] })
    for (const dt of [0, 0.05, 0.2, 1]) {
      const f = traceFrame(tl, 3.4 + dt, layout)
      expect([f.bubble, f.dots, f.cells, f.steps, f.beam]).toEqual([{ wide: false, opacity: 0 }, false, [], [], null])
    }
    expect(answerFrame(tl, 3.4, 2, { dpr: 1, reduced: false }).parts.map((q) => q.opacity)).toEqual([0, 0])
    expect(answerFrame(tl, 3.45, 2, { dpr: 1, reduced: false }).parts[0].opacity).toBeGreaterThan(0)
    expect(traceStatus(tl)).toBe('3s')
    expect(traceSummary(tl)).toEqual({ status: '3s', wide: false, rows: [], noun: 'element', fold: '3s', steps: [] })
    expect(traceFrame(tl, 3.4 + 0.31, layout).sprite.state).toBe('done')
  })

  it('keeps a reply of any length under half a second: the stagger shrinks to fit', () => {
    for (const n of [1, 2, 3, 4, 5, 8, 20, 200]) {
      expect(partStagger(n)).toBeLessThanOrEqual(PART_STAGGER_MAX_S)
      expect(answerEnd(tl, n) - 3.4).toBeLessThan(ANSWER_TOTAL_S)
      const end = answerFrame(tl, answerEnd(tl, n), n, { dpr: 1, reduced: false })
      expect(end.parts.every((q) => q.opacity === 1 && q.y === 0)).toBe(true)
    }
    expect(partStagger(5)).toBeCloseTo((0.5 - 0.24 - 0.001) / 4, 12)
  })

  it('lands every part on whole device pixels, in order, never going back', () => {
    for (const dpr of [1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
      let prev: number[] = []
      for (let T = 3.39; T < 4; T += 0.007) {
        const f = answerFrame(tl, T, 6, { dpr, reduced: false })
        for (const q of f.parts) expect(Math.abs(q.y * dpr - Math.round(q.y * dpr))).toBeLessThan(1e-9)
        for (let k = 1; k < f.parts.length; k++) expect(f.parts[k].opacity).toBeLessThanOrEqual(f.parts[k - 1].opacity)
        f.parts.forEach((q, k) => expect(q.opacity).toBeGreaterThanOrEqual(prev[k] ?? 0))
        prev = f.parts.map((q) => q.opacity)
      }
    }
  })

  it('ends the loop ≤ 1.95 s after `done` for any turn, and ≤ 0.5 s for one that took a second or more', () => {
    let seed = 12345
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    for (let i = 0; i < 2000; i++) {
      const toolAt = rnd() * 4
      const A = Math.max(0.001, toolAt + rnd() * 10)
      const n = 1 + Math.floor(rnd() * 30)
      const t = turn([
        { type: 'begin', at: 0, read: READ },
        { type: 'tool_start', at: toolAt },
        { type: 'tool_exec', at: toolAt + 0.2, facts: WALL_FACTS },
        { type: 'done', at: A, words: 30, table: false }
      ])
      expect(answerEnd(t, n) - t.answer!).toBeLessThanOrEqual(1.95)
      if (t.answer! >= 1) expect(answerEnd(t, n) - t.answer!).toBeLessThan(ANSWER_TOTAL_S)
    }
  })
})

/* ────────────────────────────── a large model ────────────────────────────── */

/** `count` elements over the given models; every `wallEvery`-th is a wall, some with no rating. */
function largeFederation(counts: number[], isWall: (i: number) => boolean, flagged: (i: number) => boolean): ReturnType<typeof federationOf> {
  const sketches: Sketch[] = []
  const storeys = Array.from({ length: 12 }, (_, i) => `Level ${String(i + 1).padStart(2, '0')}`)
  counts.forEach((count, m) => {
    for (let j = 0; j < count; j++) {
      const i = sketches.length
      sketches.push({
        model: `M${m}`,
        type: isWall(i) ? 'IfcWall' : 'IfcBuildingElementProxy',
        storey: storeys[Math.floor(i / 36) % storeys.length],
        props: flagged(i) ? {} : { FireRating: '1 HR' }
      })
    }
  })
  return federationOf(sketches, storeys)
}

describe('a large model: each cell stands for several elements, and every number stays exact', () => {
  // 100 000 elements in three models, one of them tiny; 2 767 walls — every 36th element up to
  // the 99 581st; 395 of those, spread over all twelve storeys, with no fire rating.
  const big = largeFederation(
    [61_993, 38_000, 7],
    (i) => i % 36 === 5 && i < 99_582,
    (i) => Math.floor(i / 36) % 7 === 2
  )
  const facts = toolFacts('query_elements', { rules: REFERENCE_RULES }, big)
  const tl = turn([
    { type: 'begin', at: 0, read: readFacts(big) },
    { type: 'tool_start', at: 2 },
    { type: 'tool_exec', at: 2.5, facts },
    { type: 'done', at: 9, words: 12, table: false }
  ])

  it('counts what the rules really match', () => {
    expect(readFacts(big)).toEqual({ models: [61_993, 38_000, 7], total: 100_000 })
    expect(facts.rules!.filter).toEqual({ what: 'IfcWall', count: 2_767, noun: 'wall' })
    const unrated = big.elements.filter((e) => e.type === 'IfcWall' && !('FireRating' in (e.psets.Pset_Common ?? {})))
    expect(unrated).toHaveLength(395)
    expect(facts.rules!.check).toEqual({ props: 'FireRating', count: 395, unit: 'missing' })
    expect(facts.rules!.matched).toHaveLength(395)
  })

  it('reads 100 000 elements into the same grid: 244 to a cell, every model with a column of its own', () => {
    // Three models leave room for 104 columns of four. `ceil(100 000 / 416)` is 241 elements to
    // a cell, but each model starts a column of its own and at 241, 242 and 243 the three need
    // 105 between them — so 244: 255 cells, 156 cells and 1, in 64 + 39 + 1 columns.
    const design = traceLattice(null)
    expect(columnsIn(REF_LAYOUT.width, design.a, 2 * design.gap)).toBe(104)
    const f = traceFrame(tl, 3.75, REF_LAYOUT)
    expect(f.cells).toHaveLength(Math.ceil(61_993 / 244) + Math.ceil(38_000 / 244) + 1)
    expect(f.cells).toHaveLength(255 + 156 + 1)
    expect(new Set(f.cells.map((c) => c.x.toFixed(4))).size).toBe(64 + 39 + 1)
    expect(Math.max(...f.cells.map((c) => c.x + c.size))).toBeLessThanOrEqual(REF_LAYOUT.width)
    // The seven elements of the third model have the last column to themselves.
    const last = Math.max(...f.cells.map((c) => c.x))
    expect(f.cells.filter((c) => c.x === last)).toHaveLength(1)
    // The count beside the matrix is the federation's own — a cell stands for 244, the number
    // for nothing but itself.
    const said = traceFrame(tl, 3.79, REF_LAYOUT).steps[0]
    expect([said.label, said.count]).toEqual(['Reading 3 models', { n: 100_000, text: '100,000', unit: 'elements', accent: false }])
  })

  it('filters 2 767 walls into 84 cells of 33, and ends the count on the exact 395', () => {
    const cues = traceCues(tl)
    expect(cues.steps.map((s) => [s.kind, Number(s.at.toFixed(9))])).toEqual([['read', 2], ['filter', 3.8], ['check', 5.4]])
    const filtered = traceFrame(tl, 5.39, REF_LAYOUT)
    // ceil(2 767 / 86) = 33 to a cell → 84 cells.
    expect(filtered.cells).toHaveLength(Math.ceil(2_767 / 33))
    expect(filtered.steps.at(-1)!.count).toEqual({ n: 2_767, text: '2,767', unit: 'walls', accent: false })
    // The Check: the count rises cell by cell as the beam passes and ends on the matched size.
    const counts = [5.45, 5.9, 6.4, 6.9, 7.3, 7.79].map((T) => traceFrame(tl, T, REF_LAYOUT).steps.at(-1)!.count!.n)
    expect(counts[0]).toBe(0)
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1])
    expect(counts.at(-1)).toBe(395)
    expect(new Set(counts).size).toBeGreaterThan(3)
    // Every flagged cell holds at least one match; together they hold all 395.
    const lit = traceFrame(tl, 7.79, REF_LAYOUT).cells.filter((c) => c.a === 'hit')
    expect(lit.length).toBeGreaterThan(0)
    expect(lit.length).toBeLessThanOrEqual(84)
    expect(traceStatus(tl)).toBe('checked 2,767 walls · 9s')
  })

  it('answers with eight rows at most, the eighth summing the rest, and cells that stand for several', () => {
    const rows = answerRows(tl)
    expect(rows).toHaveLength(8)
    expect(rows.slice(0, 7).map((r) => r.label)).toEqual(['Level 01', 'Level 02', 'Level 03', 'Level 04', 'Level 05', 'Level 06', 'Level 07'])
    expect(rows[7].label).toBe('+5 more levels')
    expect(rows.reduce((n, r) => n + r.n, 0)).toBe(395)
    expect(rows[7].n).toBe(395 - rows.slice(0, 7).reduce((n, r) => n + r.n, 0))
    const lay = rowLayout(rows, 'wall', REF_LAYOUT)
    const largest = Math.max(...rows.map((r) => r.n))
    expect(lay.per).toBe(Math.ceil(largest / lay.cap))
    expect(lay.cap).toBeLessThanOrEqual(ROW_CELLS)
    // Settled, the matrix is the Check's end in the filter grid: the lit cells hold all 395.
    const end = traceFrame(tl, 30, REF_LAYOUT)
    expect(end.cells).toHaveLength(84)
    expect(end.steps.at(-1)!.count!.n).toBe(395)
    expect(answerEnd(tl, 6) - 9).toBeLessThan(ANSWER_TOTAL_S)
  })
})

/* ────────────────────────────── a narrower panel, a real display ────────────────────────────── */

describe('the layout', () => {
  it('has fewer columns in a narrower bubble, and buckets sooner', () => {
    const design = traceLattice(null)
    expect(columnsIn(286, design.a, 3 * design.gap)).toBe(103)
    expect(columnsIn(286, design.b)).toBe(43)
    expect(columnsIn(192, design.a, 3 * design.gap)).toBe(68)
    expect(columnsIn(192, design.b)).toBe(29)
    // The reference's 412 elements in the 240 px panel's 192 px: two to a cell, 53 columns.
    const narrow = traceFrame(SCENE, CUES.Filter - 0.01, { ...REF_LAYOUT, width: 192 })
    expect(narrow.cells).toHaveLength(70 + 122 + 10 + 4)
    expect(new Set(narrow.cells.map((c) => c.x.toFixed(4))).size).toBe(18 + 31 + 3 + 1)
    expect(Math.max(...narrow.cells.map((c) => c.x + c.size))).toBeLessThanOrEqual(192)
    // 86 walls in 2 × 29: two to a cell.
    expect(traceFrame(SCENE, CUES.Check - 0.01, { ...REF_LAYOUT, width: 192 }).cells).toHaveLength(43)
    // The count does not change with the panel.
    expect(traceFrame(SCENE, CUES.Check - 0.01, { ...REF_LAYOUT, width: 192 }).steps.at(-1)!.count!.n).toBe(86)
  })

  it('rounds the lattice to whole device pixels — at 150 %, the handoff’s own numbers rounded', () => {
    const at = (dpr: number): Record<string, number[]> => {
      const l = traceLattice(dpr)
      const px = (v: number): number => Number((v * dpr).toFixed(6))
      return {
        read: [px(l.a.pitch), px(l.a.size), px(l.a.rowPitch), px(l.gap)],
        filter: [px(l.b.pitch), px(l.b.size), px(l.b.rowPitch)],
        row: [px(l.row.pitch), px(l.row.size)]
      }
    }
    // jsx px are device px at 150 %: 4.05 / 3.2 / 5.2 / 4 · 9.98 / 7 / 10 · 14 / 10.
    expect(at(1.5)).toEqual({ read: [4, 3, 5, 4], filter: [10, 7, 10], row: [14, 10] })
    expect(at(1)).toEqual({ read: [3, 2, 3, 3], filter: [7, 5, 7], row: [9, 7] })
    expect(at(1.25)).toEqual({ read: [3, 2, 4, 3], filter: [8, 6, 8], row: [12, 8] })
    expect(at(2)).toEqual({ read: [5, 4, 7, 5], filter: [13, 9, 13], row: [19, 13] })
    // Always at least one device pixel between two cells, in both directions.
    for (const dpr of [1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
      const l = traceLattice(dpr)
      for (const g of [l.a, l.b]) {
        expect((g.pitch - g.size) * dpr).toBeGreaterThanOrEqual(1 - 1e-9)
        expect((g.rowPitch - g.size) * dpr).toBeGreaterThanOrEqual(1 - 1e-9)
      }
      expect((l.row.pitch - l.row.size) * dpr).toBeGreaterThanOrEqual(1 - 1e-9)
    }
    // With no ratio the numbers are the handoff's, untouched.
    const design = traceLattice(null)
    expect([design.a.pitch, design.a.size, design.b.pitch, design.b.size, design.gap]).toEqual([
      R.PITCH_A / 1.5, R.SIZE_A / 1.5, R.PITCH_B / 1.5, R.SIZE_B / 1.5, R.GAP_G / 1.5
    ])
  })

  it('puts every cell at rest on whole device pixels, at every ratio', () => {
    const whole = (v: number, dpr: number): boolean => Math.abs(v * dpr - Math.round(v * dpr)) < 1e-6
    for (const dpr of [1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
      for (const width of [282, 274, 192]) {
        const layout: TraceLayout = { width, dpr, textH: 38.75, reduced: false }
        // The read grid, the filter grid with the nine lit, and the rows under the answer.
        for (const T of [CUES.Filter - 0.01, CUES.Check - 0.01, CUES.Answer - 0.01, CUES.Hold]) {
          const cells = traceFrame(SCENE, T, layout).cells
          expect(cells.length).toBeGreaterThan(0)
          for (const c of cells) {
            const where = `${dpr} × ${width} at ${T}`
            expect([where, whole(c.x, dpr), whole(c.y, dpr), whole(c.size, dpr)]).toEqual([where, true, true, true])
            expect(c.x).toBeGreaterThanOrEqual(0)
            expect(c.x + c.size).toBeLessThanOrEqual(width + 1e-6)
          }
        }
      }
    }
  })

  it('keeps the reference’s 412 cells one to an element where the display has the pixels for it', () => {
    const cellsAt = (dpr: number, width: number): number =>
      traceFrame(SCENE, CUES.Filter - 0.01, { width, dpr, textH: 38, reduced: false }).cells.length
    // The app's bubble is 282 px inside (the reference's, 286). At 125, 150 and 200 % every
    // element has a cell; at 100 % a 2 px cell needs 3 px a column and 103 of them need 318, so
    // each cell stands for two.
    expect([1.25, 1.5, 2].map((dpr) => cellsAt(dpr, 282))).toEqual([412, 412, 412])
    expect(cellsAt(1, 282)).toBe(206)
    // The 80 walls of the demo building fit the filter grid one each at 100 %: 2 × 40.
    expect(columnsIn(282, traceLattice(1).b)).toBe(40)
  })

  it('starts the rows’ cells clear of the longest storey name, and gives them what the count leaves', () => {
    // The reference: `L1` … `L4` and `3 walls` — the cells start where the handoff starts them.
    const ref = rowLayout([{ label: 'L1', n: 3 }, { label: 'L4', n: 2 }], 'wall', REF_LAYOUT)
    expect(ref.x0).toBeCloseTo(J(61 - 17), 9)
    expect([ref.per, ref.cap]).toEqual([1, 12])
    // A long name pushes them right; the count column is as wide as its longest text.
    const long = rowLayout([{ label: 'Level 02 - Garden Roof Deck', n: 14 }], 'wall', { width: 282, dpr: 1 })
    expect(long.x0).toBeGreaterThan(J(44))
    expect(long.x0).toBe('Level 02 - Garden Roof Deck'.length * 6 + 9)
    expect(long.cap).toBe(6)
    expect(long.per).toBe(3)
    // A long count does the same from the other side: the label gives way first.
    const wide = rowLayout([{ label: 'Level 02 - Garden', n: 14 }], 'building element proxy', { width: 282, dpr: 1 })
    expect(wide.labelMax).toBe(282 - '14 building element proxies'.length * 6 - 2 * 9 - 6 * 9)
    expect(wide.x0).toBe(wide.labelMax + 9)
    expect(wide.cap).toBe(6)
    // Thirteen in the largest row: two to a cell, seven cells.
    const thirteen = rowLayout([{ label: 'L1', n: 13 }, { label: 'L2', n: 4 }], 'wall', REF_LAYOUT)
    expect(thirteen.per).toBe(2)
    // A very long name is cut, so that six cells and the count still fit.
    const cut = rowLayout([{ label: 'x'.repeat(80), n: 3 }], 'wall', { width: 192, dpr: 1 })
    expect(cut.labelMax).toBeLessThan(80 * 6)
    expect(cut.x0 + 6 * traceLattice(1).row.pitch + '3 walls'.length * 6).toBeLessThanOrEqual(192)
    expect(cut.cap).toBeGreaterThanOrEqual(6)
  })
})

/* ────────────────────────────── reduced motion ────────────────────────────── */

describe('reduced motion: every state at its end, and nothing in between', () => {
  const layout: TraceLayout = { ...REF_LAYOUT, reduced: true }
  /** A hair past `T`: a cue is a sum of durations, and must not be missed by a rounding. */
  const at = (T: number): TraceFrame => traceFrame(SCENE, T + 1e-6, layout)

  it('shows each state the moment its cue is reached, already settled', () => {
    // Send → Think: nothing yet.
    expect(at(CUES.Think - 0.01).sprite.opacity).toBe(0)
    expect(at(CUES.Think - 0.01).dots).toBe(false)
    // Think: the sprite and the dots are simply there — no pop, no shimmer.
    const think = at(CUES.Think)
    expect([think.sprite, think.dots, think.thinking.shimmer]).toEqual([{ state: 'thinking', scale: 1, opacity: 1 }, true, null])
    // Read: the diary open, all 412 cells at rest, the whole count.
    const read = at(CUES.Read)
    expect(read.bubble).toEqual({ wide: true, opacity: 1 })
    expect(read.dots).toBe(false)
    expect(read.cells).toHaveLength(412)
    expect(read.cells.every((c) => c.scale === 1 && c.opacity === 1 && c.t === 1 && c.b === 'cell')).toBe(true)
    expect(read.steps).toEqual([
      { label: 'Reading 4 models', mono: '', terms: [], count: { n: 412, text: '412', unit: 'elements', accent: false }, done: false, y: 0, opacity: 1 }
    ])
    expect(read.sprite.state).toBe('reading')
    // Filter: 86 cells in the filter grid, nothing else.
    const filter = at(CUES.Filter)
    expect(filter.cells).toHaveLength(86)
    expect(filter.cells.every((c) => c.size === J(7) && c.b === 'ready' && c.t === 1)).toBe(true)
    expect(filter.steps.map((l) => [l.label + l.mono, l.count!.n, l.done, l.y, l.opacity])).toEqual([
      ['Reading 4 models', 412, true, 0, 1],
      ['Filtering IfcWall', 86, false, 0, 1]
    ])
    // Check: all nine lit at once, the count whole, no beam; Vee hops once.
    const check = at(CUES.Check)
    expect(check.beam).toBeNull()
    expect(check.cells.filter((c) => c.a === 'hit' && c.scale === 1 && c.ring === -1)).toHaveLength(9)
    expect(check.cells.filter((c) => c.a === 'dim' && c.t === 0)).toHaveLength(77)
    expect(check.steps.at(-1)).toMatchObject({ label: 'Checking ', mono: 'FireRating', count: { n: 9, text: '9', unit: 'missing', accent: true } })
    expect(check.sprite.state).toBe('found')
    expect(at(CUES.Check + 0.51).sprite.state).toBe('reading')
    // Answer: the final state, at once — the diary folded and every part in.
    const answer = at(CUES.Answer)
    expect(answerFrame(SCENE, CUES.Answer, 4, { dpr: 1, reduced: true })).toEqual({
      fold: 1,
      parts: Array(4).fill({ opacity: 1, y: 0 }),
      settled: true
    })
    expect(answerFrame(SCENE, CUES.Answer - 0.001, 4, { dpr: 1, reduced: true }).parts.every((q) => q.opacity === 0)).toBe(true)
    expect(answer).toEqual(traceFrame(SCENE, CUES.Hold + 60, REF_LAYOUT))
    expect(answer.sprite.state).toBe('done')
  })

  it('never draws a frame that differs from the state’s end between two cues', () => {
    const cuts = [CUES.Think, CUES.Read, CUES.Filter, CUES.Check, CUES.Check + 0.5, CUES.Answer]
    for (let i = 0; i < cuts.length; i++) {
      const [from, to] = [cuts[i], cuts[i + 1] ?? cuts[i] + 5]
      // The seconds since Send are a clock, not motion: they are the one thing that moves.
      const still = (f: TraceFrame): TraceFrame => ({ ...f, thinking: { ...f.thinking, seconds: 0 } })
      const first = still(at(from))
      for (let T = from; T < to - 1e-3; T += (to - from) / 17) expect([T, still(at(T))]).toEqual([T, first])
    }
    // The view is told when to look again: at each cue, and when Vee's hop is over.
    const wakes: number[] = []
    for (let T = CUES.Send; ; ) {
      const next = traceNextCue(SCENE, T)
      if (next === null) break
      wakes.push(Number(next.toFixed(6)))
      T = next
    }
    expect(wakes).toEqual([3.6, 5, 6.8, 8.4, 8.9, 10.8])
    // Outside the reply: the row and the composer are simply in place; the button is a stop.
    expect(traceSend(SCENE, CUES.Send, true)).toEqual({ lift: 1, press: 1, bubble: 1, you: 1, placeholder: 1, busy: 1, settled: false })
    expect(traceSend(SCENE, CUES.Answer, true)).toMatchObject({ busy: 0, settled: true })
  })
})

/* ────────────────────────────── the rest of a reply ────────────────────────────── */

describe('what the answer carries', () => {
  it('has no rows beside a table, and none when nothing matched', () => {
    const table = turn([
      { type: 'begin', at: 0, read: READ },
      { type: 'tool_exec', at: 2, facts: WALL_FACTS },
      { type: 'done', at: 9, words: 5, table: true }
    ])
    expect(answerRows(table)).toEqual([])
    expect(traceSummary(table)).toMatchObject({ status: 'checked 86 walls · 9s', wide: true, rows: [] })
    // The matrix keeps the Check's end — what the folded diary reopens to.
    expect(traceFrame(table, 9.01, REF_LAYOUT).cells.filter((c) => c.a === 'hit')).toHaveLength(9)
    expect(traceFrame(table, 12, REF_LAYOUT).cells).toEqual(traceFrame(table, 9.01, REF_LAYOUT).cells)

    const nothing = turn([
      { type: 'begin', at: 0, read: READ },
      { type: 'tool_exec', at: 2, facts: RULED([{ prop: 'IfcEntity', op: '=', val: 'IfcPipeSegment' }, { prop: 'FireRating', op: 'absent', val: null }]) },
      { type: 'done', at: 9, words: 5, table: false }
    ])
    expect(answerRows(nothing)).toEqual([])
    expect(traceStatus(nothing)).toBe('checked 0 pipe segments · 9s')
  })

  it('takes its rows and its status from the last rule-bearing call, whatever came after', () => {
    const tl = turn([
      { type: 'begin', at: 0, read: READ },
      { type: 'tool_exec', at: 2, facts: RULED([{ prop: 'Model', op: '=', val: 'SIT' }]) },
      { type: 'tool_exec', at: 5, facts: WALL_FACTS },
      { type: 'tool_exec', at: 6, facts: NOTE('set_view') },
      { type: 'done', at: 12.4, words: 5, table: false }
    ])
    expect(traceCues(tl).last).toBe(1)
    expect(traceStatus(tl)).toBe('checked 86 walls · 12s')
    expect(answerRows(tl).map((r) => r.n)).toEqual([3, 2, 2, 2])
  })

  it('rests a filter’s cells in the filter grid, waiting, when there is no Check', () => {
    // "How many walls, by level?" — a Filter and no Check: every wall is a match.
    const filterOnly = RULED([{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }])
    const tl = turn([
      { type: 'begin', at: 0, read: READ },
      { type: 'tool_start', at: 2 },
      { type: 'tool_exec', at: 2, facts: filterOnly },
      { type: 'done', at: 9, words: 5, table: false }
    ])
    expect(traceStatus(tl)).toBe('found 86 walls · 9s')
    expect(foldText(tl)).toBe('412 read · 86 walls · 9s')
    expect(traceCues(tl).steps.map((s) => s.kind)).toEqual(['read', 'filter'])
    // No beam, no finding, no lit cell — before the answer or after it.
    for (const T of [4, 6, 8.9, 9, 30]) {
      const f = traceFrame(tl, T, REF_LAYOUT)
      expect([f.beam, f.cells.some((c) => c.a === 'hit')]).toEqual([null, false])
    }
    expect(traceFrame(tl, 30, REF_LAYOUT).cells.every((c) => c.b === 'ready' && c.t === 1)).toBe(true)
    expect(answerRows(tl).map((r) => r.n)).toEqual([80, 2, 2, 2])
    // No Check, so the storey-rows card keeps its own title.
    expect(traceSummary(tl).title).toBeUndefined()
  })

  it('scans the read grid when the call has no scope rule', () => {
    const checkOnly = RULED([{ prop: 'FireRating', op: 'absent', val: null }])
    expect(checkOnly.rules).toMatchObject({ filter: null, scope: null, scopeCount: 412, noun: 'element' })
    const tl = turn([
      { type: 'begin', at: 0, read: READ },
      { type: 'tool_start', at: 2 },
      { type: 'tool_exec', at: 2, facts: checkOnly },
      { type: 'done', at: 9, words: 5, table: false }
    ])
    expect(traceCues(tl).steps.map((s) => [s.kind, Number(s.at.toFixed(9))])).toEqual([['read', 2], ['check', 3.8]])
    const mid = traceFrame(tl, 3.8 + 1.2, REF_LAYOUT)
    expect(mid.cells).toHaveLength(412)
    expect(mid.cells.every((c) => c.size === J(3.2))).toBe(true)
    expect(mid.beam).not.toBeNull()
    const end = traceFrame(tl, 8.9, REF_LAYOUT)
    expect(end.cells.filter((c) => c.a === 'hit')).toHaveLength(9)
    expect(end.steps.map((l) => [l.label + l.mono, l.count!.n, l.count!.unit])).toEqual([
      ['Reading 4 models', 412, 'elements'],
      ['Checking FireRating', 9, 'missing']
    ])
    expect(traceStatus(tl)).toBe('checked 412 elements · 9s')
  })
})

/* ────────────────────────────── the colours, and a reply at rest ────────────────────────────── */

describe('the cells’ colours', () => {
  const ROOT = join(__dirname, '..', '..')
  const CSS = readFileSync(join(ROOT, 'src/renderer/styles/design.css'), 'utf8')
  const JSX = readFileSync(join(ROOT, 'design-reference/ask-vee/ask-thinking-hex.jsx'), 'utf8')
  /** `--name: value` pairs of one rule of `styles/design.css`. */
  const tokens = (rule: RegExp): Record<string, string> =>
    Object.fromEntries([...rule.exec(CSS)![1].matchAll(/(--[\w-]+):([^;}]+)/g)].map((m) => [m[1], m[2].trim()]))
  const DARK = tokens(/:root\{([^}]*)\}/)
  const LIGHT = { ...DARK, ...tokens(/:root\[data-theme="light"\]\{([^}]*)\}/) }
  const resolve = (theme: 'dark' | 'light'): Record<CellRole, string> => {
    const from = theme === 'dark' ? DARK : LIGHT
    return Object.fromEntries(
      Object.entries(TRACE_PALETTE[theme]).map(([role, v]) => [role, (v.startsWith('--') ? from[v] : v).toUpperCase()])
    ) as Record<CellRole, string>
  }
  /** How far `c` stands from `a` toward `b`, channel by channel. */
  const along = (a: string, b: string, c: string): number[] => {
    const [A, B, C] = [rgb(a), rgb(b), rgb(c)]
    return A.map((v, i) => (C[i] - v) / (B[i] - v))
  }

  it('are the handoff’s in the dark theme: its cell and its accent through the app’s tokens, its three greys as written', () => {
    expect(resolve('dark')).toEqual(HEX)
    expect(TRACE_PALETTE.dark).toEqual({ cell: '--border-strong', flash: '#7E9693', ready: '#405351', dim: '#2D3B3A', hit: '--accent' })
    // The three greys are literals of the reference's cell loop; the two tokens are its `C`'s.
    for (const grey of ['#7E9693', '#405351', '#2D3B3A']) expect([grey, JSX.includes(`'${grey}'`)]).toEqual([grey, true])
    expect(JSX).toMatch(/borderStrong:\s*'#354544'/)
    expect(JSX).toMatch(/accent:\s*'#35C4B6'/)
  })

  it('keep each grey in the same place between the same neighbours in the light theme', () => {
    expect(TRACE_PALETTE.light.cell).toBe(TRACE_PALETTE.dark.cell)
    expect(TRACE_PALETTE.light.hit).toBe(TRACE_PALETTE.dark.hit)
    for (const theme of ['dark', 'light'] as const) {
      const c = resolve(theme)
      const from = theme === 'dark' ? DARK : LIGHT
      for (const colour of Object.values(c)) expect([theme, /^#[0-9A-F]{6}$/.test(colour)]).toEqual([theme, true])
      const near = (got: number[], want: number): void =>
        got.forEach((v) => expect([theme, want, Math.abs(v - want) < 0.05]).toEqual([theme, want, true]))
      // The flash: 46 % of the way from the cell to the ink.
      near(along(c.cell, from['--ink'], c.flash), 0.46)
      // A scope cell waiting for the beam: 16 % from the cell to the flash.
      near(along(c.cell, c.flash, c.ready), 0.16)
      // Checked and not flagged: 65 % from the bubble to the cell — fainter than a cell at rest.
      near(along(from['--step-bg'], c.cell, c.dim), 0.65)
    }
  })
})

/* ────────────────────────────── the window resized under a turn ────────────────────────────── */

describe('a resize mid-turn (stage 1b): the matrix keeps its width while a Check’s beam runs', () => {
  // Windows of 300 (the new minimum), 330 (the default) and 420 px: the diary's canvas is the
  // window less the thread's 10 px gutters, the avatar's 22 px and the card's 10 px padding a side.
  const WIDTHS = [300, 330, 420].map((w) => w - 2 * 10 - 22 - 2 * 10)
  // The 100 000-element model, where a cell stands for many and the count rises by cells.
  const big = largeFederation(
    [61_993, 38_000, 7],
    (i) => i % 36 === 5 && i < 99_582,
    (i) => Math.floor(i / 36) % 7 === 2
  )
  const facts = toolFacts('query_elements', { rules: REFERENCE_RULES }, big)
  const tl = turn([
    { type: 'begin', at: 0, read: readFacts(big) },
    { type: 'tool_start', at: 2 },
    { type: 'tool_exec', at: 2.5, facts },
    { type: 'done', at: 9, words: 12, table: false }
  ])
  const check = traceCues(tl).steps.find((st) => st.kind === 'check')!.at
  const countAt = (T: number, width: number): number | null =>
    traceFrame(tl, T, { width, dpr: 1, textH: 0, reduced: false }).steps.at(-1)?.count?.n ?? null

  it('says the same words at every width, and the same count everywhere but inside the beam', () => {
    let inside = 0
    for (let T = 1; T < 8.99; T += 0.05) {
      if (T >= check && T <= check + 2.01 && new Set(WIDTHS.map((w) => countAt(T, w))).size > 1) inside++
      const said = WIDTHS.map((width) => traceFrame(tl, T, { width, dpr: 1, textH: 0, reduced: false }).steps.map((st) => st.label + st.mono))
      expect([T, said[1]]).toEqual([T, said[0]])
      expect([T, said[2]]).toEqual([T, said[0]])
      if (T < check || T > check + 2.01) {
        const n = WIDTHS.map((w) => countAt(T, w))
        expect([T, new Set(n).size]).toEqual([T, 1])
      }
    }
    // …and every width ends on the exact 395. Inside the beam they do disagree — spike 4 measured
    // a gap of up to 13 — which is why a Check keeps the width it started with (below).
    for (const w of WIDTHS) expect(countAt(8.98, w)).toBe(395)
    expect(inside).toBeGreaterThan(0)
  })

  it('holds the width a Check started with, so a resize under the beam never makes its count jump back or skip', () => {
    for (const [from, to] of [
      [WIDTHS[1], WIDTHS[0]],
      [WIDTHS[1], WIDTHS[2]],
      [WIDTHS[2], WIDTHS[0]]
    ]) {
      let hold: WidthHold | null = null
      let prev = -1
      const seen: number[] = []
      for (let T = check - 0.5; T < 8.99; T += 0.01) {
        // The window is resized a third of the way through the sweep.
        const measured = T < check + 0.9 ? from : to
        hold = planWidth(tl, T, measured, hold)
        const n = countAt(T, hold.width)
        if (T >= check && T < check + STEP_S.check) {
          // Inside the Check the width it started with is kept, so the count is exactly the
          // count of an unresized window — rising, never falling.
          expect([T, hold.width]).toEqual([T, from])
          expect([T, n]).toEqual([T, countAt(T, from)])
          expect(n!).toBeGreaterThanOrEqual(prev)
          prev = n!
          seen.push(n!)
        }
      }
      expect(seen.at(-1)).toBe(395)
      // At the next step boundary — here the answer — the plan follows the window again.
      expect(planWidth(tl, 9, to, hold)).toEqual({ step: -2, width: to })
    }
  })

  it('plans every other step for the width measured now', () => {
    const read = traceCues(tl).steps[0].at
    expect(planWidth(tl, read + 0.5, 250, { step: 0, width: 300 })).toEqual({ step: 0, width: 250 })
    expect(planWidth(tl, 0.5, 250, null)).toEqual({ step: -1, width: 250 })
    // A Check that started under another hold takes the width measured as it starts.
    const ci = traceCues(tl).steps.findIndex((st) => st.kind === 'check')
    expect(planWidth(tl, check + 0.01, 260, { step: ci - 1, width: 300 })).toEqual({ step: ci, width: 260 })
    expect(planWidth(tl, check + 1, 200, { step: ci, width: 260 })).toEqual({ step: ci, width: 260 })
  })
})
