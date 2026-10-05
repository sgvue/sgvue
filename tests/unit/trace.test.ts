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
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  answerHeight,
  answerRows,
  beamAt,
  columnsIn,
  flyStagger,
  H_THINK,
  J,
  MATRIX_TOP,
  MOTION,
  ROW_CELLS,
  ROW_H,
  rowCells,
  rowLayout,
  rowTop,
  STEP_S,
  TRACE_PALETTE,
  traceCues,
  traceEnd,
  traceFrame,
  traceLattice,
  traceNextCue,
  traceReduce,
  traceSend,
  traceStatus,
  traceSummary,
  wordStagger,
  type CellRole,
  type Timeline,
  type TraceCell,
  type TraceEvent,
  type TraceFrame,
  type TraceLayout
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
    expect(r.check).toEqual({ props: 'Fire Rating', count: 9, unit: 'missing' })
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
  it('draws the reference’s cells: place, size, scale, opacity, colour and ring', () => {
    let compared = 0
    for (const T of SAMPLES) {
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
    // Done: nine cells of 10 ÷ 1.5 px at a 14 ÷ 1.5 pitch, 44 ÷ 1.5 from the text's edge, each
    // row's 8 ÷ 1.5 px under its top.
    const done = frameAt(CUES.Hold).cells
    expect(done).toHaveLength(9)
    R.FLAGGED.forEach((_, f) => {
      const x = (61 - R.MX + R.FLAG_SLOT[f] * 14) / 1.5
      const y = (R.ROW_Y0 + R.FLAG_LEVEL[f] * R.ROW_H + 8) / 1.5
      const found = cellAt(done, x, y)
      expect([f, !!found]).toEqual([f, true])
      expect(found).toMatchObject({ a: 'hit', b: 'hit', opacity: 1, scale: 1, ring: -1 })
      expect(found!.size).toBeCloseTo(10 / 1.5, 9)
    })
    expect(rowTop(REF_LAYOUT.textH, 0)).toBeCloseTo(R.ROW_Y0 / 1.5, 9)
    expect(ROW_H).toBeCloseTo(R.ROW_H / 1.5, 12)
    expect(MATRIX_TOP).toBeCloseTo(R.MY / 1.5, 12)
  })

  it('opens the bubble 0 → 52 px, then glides it to the answer’s height', () => {
    const { p, lerp, clamp, MOTION: M } = R
    for (const T of SAMPLES) {
      const bIn = p(T, CUES.Read, 0.45, M.enter)
      const bGrow = p(T, CUES.Answer + 0.15, 0.7, M.glide)
      const f = frameAt(T)
      expect([T, f.bubble.height]).toEqual([T, expect.closeTo(lerp(lerp(0, 78, bIn), R.H_ANSWER, bGrow) / 1.5, 6)])
      expect([T, f.bubble.opacity]).toEqual([T, expect.closeTo(clamp(bIn * 1.6, 0, 1), 6)])
      expect(f.bubble.wide).toBe(true)
    }
    expect(frameAt(CUES.Read - 0.2).bubble.height).toBe(0)
    expect(frameAt(CUES.Filter).bubble.height).toBeCloseTo(52, 9)
    expect(H_THINK).toBeCloseTo(52, 12)
    expect(frameAt(CUES.Hold).bubble.height).toBeCloseTo(130, 9)
    expect(answerHeight(REF_LAYOUT.textH, 4)).toBeCloseTo(R.H_ANSWER / 1.5, 9)
  })

  it('rolls the ticker through Reading, Filtering and Checking, with the reference’s counts', () => {
    const { p, lin, lerp, MOTION: M } = R
    const roll = (T: number, tin: number, tout: number | null): { y: number; opacity: number } | null => {
      const a = p(T, tin, 0.42, M.enter)
      const b = tout == null ? 0 : p(T, tout, 0.32, M.enter)
      return a <= 0 || b >= 1 ? null : { y: ((1 - a) * 22 - b * 22) / 1.5, opacity: a * (1 - b) }
    }
    for (const T of SAMPLES) {
      const n1 = Math.round(412 * lin(T, CUES.Read + 0.35, 1.1))
      const n2 = Math.round(lerp(412, 86, p(T, CUES.Filter + 0.15, 0.9, M.enter)))
      const missing = R.FLAGGED.filter((k) => T >= R.beamAt(CUES, R.CELLS[R.WALLS[k]].xB! + R.SIZE_B / 2)).length
      const want = [
        { r: roll(T, CUES.Read + 0.1, CUES.Filter), label: 'Reading 4 models', mono: '', n: n1, unit: n1 === 1 ? 'element' : 'elements', accent: false },
        { r: roll(T, CUES.Filter, CUES.Check), label: 'Filtering ', mono: 'IfcWall', n: n2, unit: 'walls', accent: false },
        { r: roll(T, CUES.Check, null), label: 'Checking Fire Rating', mono: '', n: missing, unit: 'missing', accent: missing > 0 }
      ].filter((w) => w.r)
      const f = frameAt(T)
      expect([T, f.ticker.opacity]).toEqual([T, expect.closeTo(1 - p(T, CUES.Answer, 0.28, M.enter), 6)])
      if (f.ticker.opacity <= 0) continue
      expect([T, f.ticker.lines.map((l) => l.label + l.mono)]).toEqual([T, want.map((w) => w.label + w.mono)])
      f.ticker.lines.forEach((line, i) => {
        const w = want[i]
        expect([T, line.y]).toEqual([T, expect.closeTo(w.r!.y, 6)])
        expect([T, line.opacity]).toEqual([T, expect.closeTo(w.r!.opacity, 6)])
        expect([T, line.count]).toEqual([T, { n: w.n, text: String(w.n), unit: w.unit, accent: w.accent }])
      })
    }
    // Chosen instants, in words.
    const said = (T: number): string =>
      frameAt(T).ticker.lines.map((l) => `${l.label}${l.mono} · ${l.count!.text} ${l.count!.unit}`).join(' | ')
    expect(said(CUES.Read + 0.9)).toBe('Reading 4 models · 206 elements')
    expect(said(CUES.Filter - 0.1)).toBe('Reading 4 models · 412 elements')
    expect(said(CUES.Filter + 1.2)).toBe('Filtering IfcWall · 86 walls')
    expect(said(CUES.Check + 0.35)).toBe('Checking Fire Rating · 0 missing')
    expect(said(CUES.Check + 2.3)).toBe('Checking Fire Rating · 9 missing')
    // Two lines only while one rolls out under the other.
    expect(frameAt(CUES.Filter + 0.1).ticker.lines.map((l) => l.label)).toEqual(['Reading 4 models', 'Filtering '])
    expect(frameAt(CUES.Check + 0.1).ticker.lines.map((l) => l.label)).toEqual(['Filtering ', 'Checking Fire Rating'])
    // The number lights only once it is above 0.
    expect(frameAt(CUES.Check + 0.35).ticker.lines[0].count!.accent).toBe(false)
    expect(frameAt(CUES.Check + 1.0).ticker.lines[0].count!.accent).toBe(true)
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

  it('brings the author row, the sprite and the status in as the reference does', () => {
    const { p, clamp, MOTION: M } = R
    const roll = (a: number, b: number): { y: number; opacity: number } | null =>
      a <= 0 || b >= 1 ? null : { y: ((1 - a) * 20 - b * 20) / 1.5, opacity: a * (1 - b) }
    for (const T of SAMPLES) {
      const f = frameAt(T)
      const lblIn = p(T, CUES.Think, 0.4, M.enter)
      const hexIn = p(T, CUES.Think, 0.5, M.pop)
      expect([T, f.label.opacity]).toEqual([T, expect.closeTo(lblIn, 6)])
      expect([T, f.label.y]).toEqual([T, expect.closeTo(((1 - lblIn) * 6) / 1.5, 6)])
      expect([T, f.sprite.scale]).toEqual([T, expect.closeTo(hexIn, 6)])
      expect([T, f.sprite.opacity]).toEqual([T, expect.closeTo(clamp(hexIn, 0, 1), 6)])
      const thinking = roll(p(T, CUES.Think + 0.15, 0.42, M.enter), p(T, CUES.Answer, 0.32, M.enter))
      const final = roll(p(T, CUES.Answer + 0.26, 0.42, M.enter), 0)
      for (const [name, got, want] of [['thinking', f.status.thinking, thinking], ['final', f.status.final, final]] as const) {
        if (!want) expect([T, name, got]).toEqual([T, name, null])
        else expect([T, name, got]).toEqual([T, name, { y: expect.closeTo(want.y, 6), opacity: expect.closeTo(want.opacity, 6) }])
      }
      // The shimmer sweeps once every 1.6 s for as long as `Thinking` shows.
      if (thinking && T > CUES.Think) expect([T, f.status.shimmer]).toEqual([T, expect.closeTo(((T - CUES.Think) / 1.6) % 1, 9)])
      else expect([T, f.status.shimmer]).toEqual([T, null])
    }
    // The pop overshoots: Vee is larger than life for a moment as it arrives.
    expect(Math.max(...SAMPLES.map((T) => frameAt(T).sprite.scale))).toBeGreaterThan(1.05)
  })

  it('reveals the answer word by word and the rows from the left, as the reference does', () => {
    const { p, MOTION: M } = R
    for (const T of SAMPLES) {
      const f = frameAt(T)
      if (T < CUES.Answer) {
        expect([T, f.words, f.rows, f.rule]).toEqual([T, [], [], 0])
        continue
      }
      expect(f.words).toHaveLength(13)
      f.words.forEach((a, j) => expect([T, j, a]).toEqual([T, j, expect.closeTo(p(T, CUES.Answer + 0.35 + j * 0.065, 0.36, M.enter), 6)]))
      f.rows.forEach((a, L) => expect([T, L, a]).toEqual([T, L, expect.closeTo(p(T, CUES.Answer + 0.95 + L * 0.08, 0.4, M.enter), 6)]))
      expect([T, f.rule]).toEqual([T, expect.closeTo(p(T, CUES.Answer + 0.9, 0.4, M.enter), 6)])
    }
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

  it('says `checked 86 walls` and the seconds the turn really took', () => {
    // 2.6 → 10.8 on the reference's own clock is 8.2 s. (Its still reads `7s`: a drawn string.)
    expect(traceStatus(SCENE)).toBe('checked 86 walls · 8s')
    expect(frameAt(CUES.Hold).status.text).toBe('checked 86 walls · 8s')
    expect(traceSummary(SCENE)).toEqual({
      status: 'checked 86 walls · 8s',
      wide: true,
      noun: 'wall',
      rows: R.LEVELS.map(([label, n]) => ({ label, n, ids: expect.any(Array) }))
    })
    expect(traceSummary(SCENE).rows.flatMap((r) => r.ids)).toHaveLength(9)
  })

  it('stops moving 1.65 s after the answer, and says so', () => {
    // The last thing to land is the ninth cell: 0.5 + 8 × 0.05 + 0.75 s after the answer.
    expect(traceEnd(SCENE, 9)).toBeCloseTo(CUES.Answer + 1.65, 9)
    expect(frameAt(CUES.Answer + 1.64).settled).toBe(false)
    expect(frameAt(CUES.Answer + 1.66).settled).toBe(true)
    // Nothing differs between the settled frame and any later one.
    expect(frameAt(CUES.Answer + 1.66)).toEqual(frameAt(CUES.Answer + 60))
    // While the turn runs it is never settled: `Thinking` shimmers.
    const live = turn([{ type: 'begin', at: 0, read: readFacts(fed) }])
    expect(traceFrame(live, 500, REF_LAYOUT).settled).toBe(false)
    expect(traceEnd(live)).toBe(Number.POSITIVE_INFINITY)
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
    expect(f.bubble).toEqual({ wide: false, height: 0, opacity: 0 })
    expect([f.sprite.state, f.cells, f.ticker.lines, f.status.thinking]).toEqual(['thinking', [], [], { y: 0, opacity: 1 }])
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
    expect(f.ticker.lines.map((l) => [l.label, l.mono, l.count])).toEqual([['Reading the file header', '', null]])
    expect(f.cells).toHaveLength(412)
    expect(traceFrame(tl, 21, REF_LAYOUT).ticker.lines.map((l) => l.label)).toEqual(['Moving the camera'])
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
    expect(restart.ticker.lines.map((l) => l.label + l.mono)).toEqual(['Checking Fire Rating', 'Filtering STR'])
    // 244 elements of STR: more than the 86 the filter grid holds one each, so 3 to a cell.
    const settled = traceFrame(again, 14, REF_LAYOUT)
    expect(settled.cells).toHaveLength(82)
    expect(settled.ticker.lines[0].count).toEqual({ n: 244, text: '244', unit: 'elements', accent: false })
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
    expect(before.ticker.lines.map((l) => l.label + l.mono)).toEqual(['Filtering IfcWall'])
    expect(before.words).toEqual([])
    // At the answer: the Check that never ran is at its end. The nine findings are lit, the
    // other 77 walls dimmed, each in its place in the filter grid; the ticker has gone on to the
    // Check with its final count; no beam.
    const at = traceFrame(SNAP, 4.3, REF_LAYOUT)
    expect(at.cells).toHaveLength(86)
    expect(at.cells.filter((c) => c.a === 'hit' && c.scale === 1 && c.ring === -1)).toHaveLength(9)
    expect(at.cells.filter((c) => c.a === 'dim' && c.t === 0)).toHaveLength(77)
    for (const c of at.cells) expect(c.size).toBeCloseTo(J(7), 9)
    expect(at.beam).toBeNull()
    expect(at.ticker.lines.map((l) => [l.label, l.count!.n, l.y, l.opacity])).toEqual([['Checking Fire Rating', 9, 0, 1]])
    expect(at.bubble.height).toBeCloseTo(52, 9)
    expect(at.bubble.opacity).toBe(1)
    // …and the answer's own choreography starts there, on the reference's offsets.
    const { p, MOTION: M } = R
    for (const dt of [0.1, 0.4, 0.8, 1.2]) {
      const f = traceFrame(SNAP, 4.3 + dt, REF_LAYOUT)
      expect(f.words[0]).toBeCloseTo(p(dt, 0.35, 0.36, M.enter), 9)
      expect(f.ticker.opacity).toBeCloseTo(1 - p(dt, 0, 0.28, M.enter), 9)
      expect(f.rows[0]).toBeCloseTo(p(dt, 0.95, 0.4, M.enter), 9)
    }
    expect(traceFrame(SNAP, 4.3 + 0.31, REF_LAYOUT).sprite.state).toBe('done')
    expect(traceStatus(SNAP)).toBe('checked 86 walls · 4s')
    // The rows are the real ones, whether or not the Check was ever shown.
    const end = traceFrame(SNAP, 30, REF_LAYOUT)
    expect(end.cells).toHaveLength(9)
    expect(end.settled).toBe(true)
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
    expect(at.bubble).toEqual({ wide: true, height: expect.closeTo(52, 9), opacity: 1 })
    expect(at.cells.filter((c) => c.a === 'hit')).toHaveLength(9)
    expect(at.ticker.lines.map((l) => l.label)).toEqual(['Checking Fire Rating'])
    // Settled 1.65 s later, as any answer is.
    expect(traceFrame(tl, 100.004 + 1.66, REF_LAYOUT).settled).toBe(true)
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

  it('opens no trace bubble: the reply’s own bubble opens at the answer, word by word', () => {
    const { p, clamp, MOTION: M } = R
    expect(traceFrame(tl, 3.39, layout).bubble).toEqual({ wide: false, height: 0, opacity: 0 })
    for (const dt of [0.05, 0.2, 0.44, 1]) {
      const f = traceFrame(tl, 3.4 + dt, layout)
      const bIn = p(dt, 0, 0.45, M.enter)
      expect(f.bubble.wide).toBe(false)
      expect(f.bubble.height).toBeCloseTo(bIn * (8 + 58 + 8), 9)
      expect(f.bubble.opacity).toBeCloseTo(clamp(bIn * 1.6, 0, 1), 9)
      expect([f.cells, f.ticker.lines, f.beam, f.rows, f.rule]).toEqual([[], [], null, [], 0])
    }
    expect(traceStatus(tl)).toBe('3s')
    expect(traceSummary(tl)).toEqual({ status: '3s', wide: false, rows: [], noun: 'element' })
    expect(traceFrame(tl, 3.4 + 0.31, layout).sprite.state).toBe('done')
  })

  it('shortens the stagger of a long reply so the whole reveal takes at most 1.6 s', () => {
    expect(wordStagger(13)).toBe(0.065)
    expect(wordStagger(20)).toBe(0.065)
    expect(wordStagger(30)).toBeCloseTo(1.24 / 29, 12)
    expect(wordStagger(1)).toBe(0)
    for (const n of [2, 13, 20, 21, 30, 400]) expect((n - 1) * wordStagger(n) + 0.36).toBeLessThanOrEqual(1.6 + 1e-9)
    const f = traceFrame(tl, 3.4 + 0.35 + 1.6 - 0.001, layout)
    expect(f.words).toHaveLength(30)
    expect(f.words[29]).toBeGreaterThan(0.999)
    // 400 words: every one is in, and the frame is settled, within two seconds of the answer.
    const long = turn([{ type: 'begin', at: 0, read: READ }, { type: 'done', at: 3.4, words: 400, table: false }])
    expect(traceEnd(long)).toBeCloseTo(3.4 + 0.35 + 1.6, 9)
    expect(traceFrame(long, 3.4 + 1.96, layout).settled).toBe(true)
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
    expect(facts.rules!.check).toEqual({ props: 'Fire Rating', count: 395, unit: 'missing' })
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
    const said = traceFrame(tl, 3.79, REF_LAYOUT).ticker.lines[0]
    expect([said.label, said.count]).toEqual(['Reading 3 models', { n: 100_000, text: '100,000', unit: 'elements', accent: false }])
  })

  it('filters 2 767 walls into 84 cells of 33, and ends the count on the exact 395', () => {
    const cues = traceCues(tl)
    expect(cues.steps.map((s) => [s.kind, Number(s.at.toFixed(9))])).toEqual([['read', 2], ['filter', 3.8], ['check', 5.4]])
    const filtered = traceFrame(tl, 5.39, REF_LAYOUT)
    // ceil(2 767 / 86) = 33 to a cell → 84 cells.
    expect(filtered.cells).toHaveLength(Math.ceil(2_767 / 33))
    expect(filtered.ticker.lines[0].count).toEqual({ n: 2_767, text: '2,767', unit: 'walls', accent: false })
    // The Check: the count rises cell by cell as the beam passes and ends on the matched size.
    const counts = [5.45, 5.9, 6.4, 6.9, 7.3, 7.79].map((T) => traceFrame(tl, T, REF_LAYOUT).ticker.lines.at(-1)!.count!.n)
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
    // Settled: each row holds `ceil(n / per)` cells, no more than the cap, all the accent.
    const end = traceFrame(tl, 30, { ...REF_LAYOUT, textH: 40 })
    expect(end.settled).toBe(true)
    const perRow = rows.map((_, L) => end.cells.filter((c) => Math.abs(c.y - (rowTop(40, L) + (ROW_H - J(10)) / 2)) < 1e-6))
    perRow.forEach((cells, L) => {
      const distinct = new Set(cells.map((c) => c.x.toFixed(4))).size
      expect([L, distinct]).toEqual([L, Math.ceil(rows[L].n / lay.per)])
      expect(distinct).toBeLessThanOrEqual(lay.cap)
    })
    expect(perRow.flat()).toHaveLength(end.cells.length)
    expect(end.cells.every((c) => c.b === 'hit' && c.t === 1)).toBe(true)
    // However many cells fly, their stagger is bounded: all are home 1.95 s after the answer.
    expect(flyStagger(9)).toBe(0.05)
    expect(flyStagger(15)).toBeCloseTo(0.05, 12)
    expect(flyStagger(16)).toBeLessThan(0.05)
    expect(flyStagger(200) * 199).toBeCloseTo(0.7, 12)
    expect(traceEnd(tl, 200)).toBeCloseTo(9 + 1.95, 9)
    expect(traceEnd(tl)).toBeCloseTo(9 + 1.95, 9)
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
    expect(traceFrame(SCENE, CUES.Check - 0.01, { ...REF_LAYOUT, width: 192 }).ticker.lines[0].count!.n).toBe(86)
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
    expect(at(CUES.Think - 0.01).label.opacity).toBe(0)
    expect(at(CUES.Think - 0.01).sprite.opacity).toBe(0)
    // Think: the row, the sprite and `Thinking` are simply there — no rise, no pop, no shimmer.
    const think = at(CUES.Think)
    expect([think.label, think.sprite, think.status.thinking, think.status.shimmer]).toEqual([
      { opacity: 1, y: 0 },
      { state: 'thinking', scale: 1, opacity: 1 },
      { y: 0, opacity: 1 },
      null
    ])
    // Read: the bubble open, all 412 cells at rest, the whole count.
    const read = at(CUES.Read)
    expect(read.bubble).toEqual({ wide: true, height: H_THINK, opacity: 1 })
    expect(read.cells).toHaveLength(412)
    expect(read.cells.every((c) => c.scale === 1 && c.opacity === 1 && c.t === 1 && c.b === 'cell')).toBe(true)
    expect(read.ticker.lines).toEqual([{ label: 'Reading 4 models', mono: '', count: { n: 412, text: '412', unit: 'elements', accent: false }, y: 0, opacity: 1 }])
    expect(read.sprite.state).toBe('reading')
    // Filter: 86 cells in the filter grid, nothing else.
    const filter = at(CUES.Filter)
    expect(filter.cells).toHaveLength(86)
    expect(filter.cells.every((c) => c.size === J(7) && c.b === 'ready' && c.t === 1)).toBe(true)
    expect(filter.ticker.lines.map((l) => [l.label + l.mono, l.count!.n, l.y, l.opacity])).toEqual([['Filtering IfcWall', 86, 0, 1]])
    // Check: all nine lit at once, the count whole, no beam; Vee hops once.
    const check = at(CUES.Check)
    expect(check.beam).toBeNull()
    expect(check.cells.filter((c) => c.a === 'hit' && c.scale === 1 && c.ring === -1)).toHaveLength(9)
    expect(check.cells.filter((c) => c.a === 'dim' && c.t === 0)).toHaveLength(77)
    expect(check.ticker.lines.map((l) => [l.label, l.count])).toEqual([['Checking Fire Rating', { n: 9, text: '9', unit: 'missing', accent: true }]])
    expect(check.sprite.state).toBe('found')
    expect(at(CUES.Check + 0.51).sprite.state).toBe('reading')
    // Answer: the final state, at once.
    const answer = at(CUES.Answer)
    expect(answer.settled).toBe(true)
    expect(answer).toEqual(traceFrame(SCENE, CUES.Hold + 60, REF_LAYOUT))
    expect(answer.sprite.state).toBe('done')
    expect(answer.words.every((a) => a === 1)).toBe(true)
  })

  it('never draws a frame that differs from the state’s end between two cues', () => {
    const cuts = [CUES.Think, CUES.Read, CUES.Filter, CUES.Check, CUES.Check + 0.5, CUES.Answer]
    for (let i = 0; i < cuts.length; i++) {
      const [from, to] = [cuts[i], cuts[i + 1] ?? cuts[i] + 5]
      const first = at(from)
      for (let T = from; T < to - 1e-3; T += (to - from) / 17) expect([T, at(T)]).toEqual([T, first])
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
    // With nowhere to fly to, the lit cells fold away with the rest.
    expect(traceFrame(table, 9.01, REF_LAYOUT).cells.filter((c) => c.a === 'hit')).toHaveLength(9)
    expect(traceFrame(table, 12, REF_LAYOUT).cells).toEqual([])
    expect(traceFrame(table, 12, REF_LAYOUT).bubble.height).toBeCloseTo(8 + REF_LAYOUT.textH + 8, 9)

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

  it('flies a filter’s cells into rows too, turning the accent on the way', () => {
    // "How many walls, by level?" — a Filter and no Check: every wall is a match.
    const filterOnly = RULED([{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }])
    const tl = turn([
      { type: 'begin', at: 0, read: READ },
      { type: 'tool_start', at: 2 },
      { type: 'tool_exec', at: 2, facts: filterOnly },
      { type: 'done', at: 9, words: 5, table: false }
    ])
    expect(traceStatus(tl)).toBe('found 86 walls · 9s')
    expect(traceCues(tl).steps.map((s) => s.kind)).toEqual(['read', 'filter'])
    // No beam, no finding, no lit cell before the answer.
    for (const T of [4, 6, 8.9]) {
      const f = traceFrame(tl, T, REF_LAYOUT)
      expect([f.beam, f.sprite.state, f.cells.some((c) => c.a === 'hit')]).toEqual([null, 'reading', false])
    }
    // 86 walls: 80 on L1 and two on each of the three levels above — seven to a cell, twelve
    // cells in the first row.
    const lay = rowLayout(answerRows(tl), 'wall', REF_LAYOUT)
    expect(answerRows(tl).map((r) => r.n)).toEqual([80, 2, 2, 2])
    expect(lay.per).toBe(7)
    const mid = traceFrame(tl, 9 + 0.9, REF_LAYOUT)
    expect(mid.cells.some((c) => c.a === 'ready' && c.b === 'hit' && c.t > 0 && c.t < 1)).toBe(true)
    const end = traceFrame(tl, 30, REF_LAYOUT)
    expect(end.cells.every((c) => c.b === 'hit' && c.t === 1)).toBe(true)
    expect(new Set(end.cells.map((c) => `${c.x.toFixed(3)},${c.y.toFixed(3)}`)).size).toBe(12 + 1 + 1 + 1)
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
    expect(end.ticker.lines.map((l) => [l.label, l.count!.n, l.count!.unit])).toEqual([['Checking Fire Rating', 9, 'missing']])
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

describe('a finished reply, at rest', () => {
  it('draws its rows’ cells exactly where the fly-in left them', () => {
    const kept = traceSummary(SCENE)
    expect(kept).toMatchObject({ wide: true, noun: 'wall' })
    expect(kept.rows.map((r) => [r.label, r.n])).toEqual(R.LEVELS)
    /**
     * What a list of cells puts on the canvas: each distinct square — its place and side to a
     * millionth of a pixel (float dust), its colour, its opacity and scale — in order. Several
     * cells that flew to one place are one square.
     */
    const placed = (cells: readonly TraceCell[]): string[] =>
      [
        ...new Set(
          cells.map((c) => `${c.y.toFixed(6)} ${c.x.toFixed(6)} ${c.size.toFixed(6)} ${mixed(c.a, c.b, c.t).join(',')} ${c.opacity} ${c.scale} ${c.ring}`)
        )
      ].sort()
    for (const layout of [REF_LAYOUT, { width: 282, dpr: 1, textH: 38.75, reduced: false }, { width: 282, dpr: 1.5, textH: 38.75, reduced: false }]) {
      const settled = traceFrame(SCENE, CUES.Hold + 30, layout)
      expect(settled.settled).toBe(true)
      const rest = rowCells(kept.rows, kept.noun, layout)
      expect(rest).toHaveLength(9)
      expect(placed(rest)).toEqual(placed(settled.cells))
    }
    // The same for cells that stand for several: 86 walls, seven to a cell.
    const tl = turn([
      { type: 'begin', at: 0, read: READ },
      { type: 'tool_exec', at: 2, facts: RULED([{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }]) },
      { type: 'done', at: 9, words: 5, table: false }
    ])
    const many = traceSummary(tl)
    const rest = rowCells(many.rows, many.noun, REF_LAYOUT)
    expect(rest).toHaveLength(12 + 1 + 1 + 1)
    expect(placed(rest)).toHaveLength(15)
    expect(placed(rest)).toEqual(placed(traceFrame(tl, 60, REF_LAYOUT).cells))
  })
})
