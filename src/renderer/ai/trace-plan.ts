/**
 * The thinking trace's layout planner — where each cell of the matrix stands, and what it stands
 * for. Pure: no DOM, no React, no clock.
 *
 * Moved out of `ai/trace.ts` on 2026-10-02, unchanged. That file is the part of the trace that
 * is read beside the handoff's `ask-thinking-hex.jsx`: its curves, its durations and sizes, and
 * the port of `Reply`, `Piece` and `hexState`. **This is the app's own.** The handoff has one
 * fixed table in its place — `CELLS` (`ask-thinking-hex.jsx:26`): 412 cells, 86 of them walls,
 * nine flagged, on four levels — so there is no code of its to read this beside; only the
 * lattice's numbers (`REF`) are its. Given a turn's real facts (`ai/trace-facts.ts`), the
 * bubble's width and the display's ratio, the planner answers:
 *
 *   `traceLattice`   every pitch, size and origin of the three grids, on whole device pixels;
 *   `readPlanFor`    the read grid — one cell per element while there is room, grouped by model;
 *   `rulePlanFor`    one rule-bearing call — the filter grid and the read cell each of its cells
 *                    glides from, which cells hold a match, the rows under the answer and the
 *                    cells that fly into them;
 *   `rowLayout`      the rows' three columns: label, cells, count.
 *
 * `traceFrame` (`ai/trace.ts`) animates a plan; nothing here knows what time it is. A plan is
 * made once for a facts object and a layout (`cached`), because the frame loop asks every frame.
 *
 * **It imports nothing from `./trace`.** `trace.ts` imports this module, so an import back
 * would be a cycle — and `REF` below calls `J` while this module loads: whichever of the two
 * files was reached second would run against constants that are not initialised yet. So the
 * five leaf values both need are declared **here** — `clamp`, `J`, `MATRIX_TOP`, `MONO_CH`,
 * `ROW_CELLS` — and `trace.ts` re-exports them, with every other public name that moved, so
 * nothing that imports `ai/trace` changed.
 *
 * **Every number is real, and a cell may stand for several elements.** The matrix draws one cell
 * per element while the grid has room, and otherwise one cell per `ceil(count / capacity)`; a
 * count on screen is always the federation's own.
 *
 * **Whole device pixels.** The reference's cells are 2.13 px squares at a 2.7 px pitch — at 100 %
 * scaling, not a pixel grid. `traceLattice` rounds every pitch, size and origin to whole device
 * pixels for the display's ratio (at 150 %, the reference's own scale, they are its numbers
 * rounded: 4 and 3, 10 and 7, 14 and 10), so a cell at rest is crisp and the grid is regular;
 * with no ratio it leaves the reference's numbers as they are, which is what the unit test
 * compares with the handoff's code.
 */
import {
  capRows,
  countText,
  nounFor,
  type ReadFacts,
  type RuleFacts,
  type TraceRowData
} from './trace-facts'

/* ────────────────────────────── what both files need ────────────────────────────── */

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/** The scale between the handoff and the app: `ask-thinking-hex.jsx` px ÷ 1.5 = app px. */
export const J = (jsx: number): number => jsx / 1.5

/** `:43` — the matrix's top inside the bubble. */
export const MATRIX_TOP = J(45)
/** IBM Plex Mono's advance at the rows' 10 px: 0.6 em. */
export const MONO_CH = 6
/** A row's cells, at most (the brief's twelve). */
export const ROW_CELLS = 12

/* ────────────────────────────── the lattice ────────────────────────────── */

/** The handoff's own lattice numbers (`:23–25`, `:35`, `:38`, `:216`, `:220`), ÷ 1.5. */
const REF = {
  gap: J(4),
  a: { pitch: J((429 - 4 * 3) / 103), size: J(3.2), row0: J(1), rowPitch: J(5.2), rows: 4 },
  b: { pitch: J(429 / 43), size: J(7), row0: J(1.5), rowPitch: J(10), rows: 2 },
  r: { pitch: J(14), size: J(10), x0: J(61 - 17) }
} as const

/** Where the view stands: what the frame is laid out in. */
export interface TraceLayout {
  /** The bubble's inner width — its width less its padding either side — in CSS px. */
  width: number
  /**
   * The display's device pixel ratio: every pitch, size and origin is rounded to whole device
   * pixels for it. `null` leaves the handoff's own numbers.
   */
  dpr: number | null
  /** The answer text's measured height in CSS px; 0 before there is an answer. */
  textH: number
  /** `prefers-reduced-motion: reduce` — every state at its end, nothing in between. */
  reduced: boolean
}

/** One grid of the matrix: square cells of `size` at `pitch`, rows `rowPitch` apart. */
export interface Grid {
  pitch: number
  size: number
  /** A cell's left edge inside its pitch. */
  inset: number
  /** The first row's top, from the bubble's top. */
  y0: number
  rowPitch: number
  rows: number
}

export interface Lattice {
  /** The gap between two models' groups in the read grid. */
  gap: number
  /** The read grid (4 rows) and the filter grid (2 rows of larger cells). */
  a: Grid
  b: Grid
  /** A row's cells under the answer. */
  row: { pitch: number; size: number; x0: number }
  /** Any length, on the device-pixel grid. */
  snap: (v: number) => number
}

const lattices = new Map<string, Lattice>()

/** The lattice for a device pixel ratio, or the handoff's own for `null`. */
export function traceLattice(dpr: number | null): Lattice {
  const key = String(dpr)
  const known = lattices.get(key)
  if (known) return known
  const snap = (v: number): number => (dpr ? Math.round(v * dpr) / dpr : v)
  /** A pitch and the size inside it: whole device pixels, at least one of them between cells. */
  const cell = (pitch: number, size: number): { pitch: number; size: number; inset: number } => {
    if (!dpr) return { pitch, size, inset: (pitch - size) / 2 }
    const pitchPx = Math.max(2, Math.round(pitch * dpr))
    const sizePx = Math.min(Math.max(1, Math.round(size * dpr)), pitchPx - 1)
    return { pitch: pitchPx / dpr, size: sizePx / dpr, inset: 0 }
  }
  const rowPitch = (pitch: number, size: number): number =>
    dpr ? Math.max(Math.round(size * dpr) + 1, Math.round(pitch * dpr)) / dpr : pitch
  const a = cell(REF.a.pitch, REF.a.size)
  const b = cell(REF.b.pitch, REF.b.size)
  const r = cell(REF.r.pitch, REF.r.size)
  const lattice: Lattice = {
    gap: dpr ? Math.max(1, Math.round(REF.gap * dpr)) / dpr : REF.gap,
    a: { ...a, y0: snap(MATRIX_TOP + REF.a.row0), rowPitch: rowPitch(REF.a.rowPitch, a.size), rows: REF.a.rows },
    b: { ...b, y0: snap(MATRIX_TOP + REF.b.row0), rowPitch: rowPitch(REF.b.rowPitch, b.size), rows: REF.b.rows },
    row: { pitch: r.pitch, size: r.size, x0: snap(REF.r.x0) },
    snap
  }
  lattices.set(key, lattice)
  return lattice
}

/** Float dust: `278 / (278 / 103)` must be 103 columns, not 102. */
const EPS = 1e-6

/** How many columns of a grid fit in `width` once `gaps` px are taken by group gaps. */
export const columnsIn = (width: number, grid: Grid, gaps = 0): number =>
  Math.max(1, Math.floor((width - gaps - grid.inset - grid.size) / grid.pitch + 1 + EPS))

/* ────────────────────────────── the matrix, planned ────────────────────────────── */

/** One cell of the read grid or of the filter grid, at rest. */
export interface PlanCell {
  x: number
  y: number
  /** Its column (read) or its index (filter), and what that is counted out of. */
  order: number
  /** How many matched elements it holds. */
  matched: number
  /** Filter cells: the read cell it glides from. */
  src: number
}

export interface ReadPlan {
  cells: PlanCell[]
  /** Columns in all, which the wave is spread over. */
  cols: number
  /** Elements a cell stands for. */
  per: number
  /** Per group: the first cell, and the first read-order position. */
  groups: { cell: number; first: number; count: number }[]
}

function planRead(read: ReadFacts, lat: Lattice, width: number): ReadPlan {
  const counts = read.models.filter((n) => n > 0)
  const g = lat.a
  // Group gaps are worth having only while they leave the grid most of its width.
  const gap = counts.length > 1 && (counts.length - 1) * lat.gap <= width / 4 ? lat.gap : 0
  const maxCols = columnsIn(width, g, (counts.length - 1) * gap)
  const colsFor = (per: number): number =>
    counts.reduce((sum, n) => sum + Math.ceil(Math.ceil(n / per) / g.rows), 0)
  let per = 1
  if (colsFor(1) > maxCols) {
    // Each cell stands for `ceil(count / capacity)` elements — and one more while the columns
    // every model keeps for itself still do not fit.
    per = Math.max(2, Math.ceil(read.total / (maxCols * g.rows)))
    while (colsFor(per) > maxCols && per < read.total) per++
  }
  const cells: PlanCell[] = []
  const groups: ReadPlan['groups'] = []
  let col = 0
  let first = 0
  counts.forEach((n, gi) => {
    groups.push({ cell: cells.length, first, count: n })
    const inGroup = Math.ceil(n / per)
    for (let j = 0; j < inGroup; j++) {
      const c = col + Math.floor(j / g.rows)
      cells.push({
        x: c * g.pitch + gi * gap + g.inset,
        y: g.y0 + (j % g.rows) * g.rowPitch,
        order: c,
        matched: 0,
        src: -1
      })
    }
    col += Math.ceil(inGroup / g.rows)
    first += n
  })
  return { cells, cols: Math.max(1, col), per, groups }
}

/** The read cell that holds the element at read-order position `at`. */
function readCellOf(plan: ReadPlan, at: number): number {
  let lo = 0
  let hi = plan.groups.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (plan.groups[mid].first <= at) lo = mid
    else hi = mid - 1
  }
  const g = plan.groups[lo]
  return g.cell + Math.floor((at - g.first) / plan.per)
}

/** One cell on its way into a row under the answer. */
export interface Flyer {
  /** The matrix cell it leaves from. */
  from: number
  row: number
  slot: number
}

export interface RulePlan {
  read: ReadPlan
  /** The filter grid's cells, or `null` when the call has no Filter: the beam scans the read grid. */
  filter: PlanCell[] | null
  /** Which read cells a filter cell glides from; the others shrink away. */
  kept: Uint8Array | null
  /** The grid the Check runs on and the answer leaves from: the filter cells, or the read cells. */
  end: PlanCell[]
  /** What `order` is counted out of in `end`. */
  endOf: number
  /** The rows under the answer, the elements one of their cells stands for, and the cells in flight. */
  rows: TraceRowData[]
  rowPer: number
  rowX0: number
  flyers: Flyer[]
}

const planCache = new WeakMap<object, Map<string, RulePlan | ReadPlan>>()

function cached<T extends RulePlan | ReadPlan>(of: object, key: string, make: () => T): T {
  let byKey = planCache.get(of)
  if (!byKey) planCache.set(of, (byKey = new Map()))
  let plan = byKey.get(key) as T | undefined
  if (!plan) byKey.set(key, (plan = make()))
  return plan
}

const layoutKey = (layout: TraceLayout): string => `${layout.width}|${layout.dpr}`

export const readPlanFor = (read: ReadFacts, layout: TraceLayout): ReadPlan =>
  cached(read, layoutKey(layout), () => planRead(read, traceLattice(layout.dpr), layout.width))

/** How the rows under an answer are laid out: where their cells start, and what one stands for. */
export interface RowLayout {
  /** Elements one cell stands for: 1 while the largest row has no more than `cap`. */
  per: number
  /** Cells a row can hold: twelve, or fewer in a narrow panel. */
  cap: number
  /** The cells' left edge from the bubble's inner left, clear of the longest label. */
  x0: number
  /** The widest a label may be before it is cut with an ellipsis. */
  labelMax: number
}

/**
 * The rows' columns: label · cells · count. The cells start where the handoff starts them
 * unless a storey's name needs more; the count is as wide as the longest `{n} {noun}`; the cells
 * get what is left, twelve at most.
 */
export function rowLayout(
  rows: readonly { label: string; n: number }[],
  noun: string,
  layout: Pick<TraceLayout, 'width' | 'dpr'>
): RowLayout {
  const lat = traceLattice(layout.dpr)
  const chars = (text: string): number => [...text].length * MONO_CH
  const count = rows.reduce((w, r) => Math.max(w, chars(`${countText(r.n)} ${nounFor(r.n, noun)}`)), 0)
  const gap = lat.row.pitch
  // A label may take what six cells, the count and the two gaps leave.
  const labelMax = Math.max(MONO_CH * 2, layout.width - count - 2 * gap - 6 * lat.row.pitch)
  const label = Math.min(labelMax, rows.reduce((w, r) => Math.max(w, chars(r.label)), 0))
  const x0 = Math.max(lat.row.x0, lat.snap(label + gap))
  const cap = clamp(Math.floor((layout.width - x0 - count - gap) / lat.row.pitch + EPS), 1, ROW_CELLS)
  const largest = rows.reduce((m, r) => Math.max(m, r.n), 0)
  return { per: largest <= cap ? 1 : Math.ceil(largest / cap), cap, x0, labelMax }
}

function planRules(rules: RuleFacts, table: boolean, lat: Lattice, width: number, dpr: number | null): RulePlan {
  const read = planRead(rules, lat, width)
  let filter: PlanCell[] | null = null
  let kept: Uint8Array | null = null
  /** The matrix cell holding the element at position `at`. */
  let cellOf: (at: number) => number = (at) => readCellOf(read, at)

  if (rules.filter && rules.scope) {
    const g = lat.b
    const scope = rules.scope
    const capacity = columnsIn(width, g) * g.rows
    const per = scope.length <= capacity ? 1 : Math.ceil(scope.length / capacity)
    const count = Math.ceil(scope.length / per)
    kept = new Uint8Array(read.cells.length)
    filter = []
    for (let k = 0; k < count; k++) {
      const src = readCellOf(read, scope[k * per])
      kept[src] = 1
      filter.push({
        x: Math.floor(k / g.rows) * g.pitch + g.inset,
        y: g.y0 + (k % g.rows) * g.rowPitch,
        order: k,
        matched: 0,
        src
      })
    }
    cellOf = (at) => {
      // `scope` is ascending: the element's place in it, then the cell that place falls in.
      let lo = 0
      let hi = scope.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (scope[mid] < at) lo = mid + 1
        else hi = mid
      }
      return Math.floor(lo / per)
    }
  }
  const end = filter ?? read.cells
  for (const at of rules.matched) end[cellOf(at)].matched++

  /* ── the rows, and the cells that fly into them ── */
  const rows = table || !rules.matched.length ? [] : capRows(rules.rows)
  const { per: rowPer, x0: rowX0 } = rowLayout(rows, rules.noun, { width, dpr })
  const flyers: Flyer[] = []
  if (rows.length) {
    const sourced = new Uint8Array(end.length)
    const first = new Int32Array(end.length * 2).fill(-1)
    rows.forEach((row, L) => {
      row.at.forEach((at, i) => {
        const cell = cellOf(at)
        const slot = Math.floor(i / rowPer)
        if (first[cell * 2] < 0) {
          first[cell * 2] = L
          first[cell * 2 + 1] = slot
        }
        // A row cell leaves from the matrix cell that holds its first element.
        if (i % rowPer === 0) {
          flyers.push({ from: cell, row: L, slot })
          sourced[cell] = 1
        }
      })
    })
    // A matched cell that is no row cell's start flies to the row cell holding one of its own.
    end.forEach((c, i) => {
      if (c.matched && !sourced[i]) flyers.push({ from: i, row: first[i * 2], slot: first[i * 2 + 1] })
    })
    flyers.sort((a, b) => a.from - b.from || a.row - b.row || a.slot - b.slot)
  }
  return {
    read,
    filter,
    kept,
    end,
    endOf: filter ? Math.max(1, filter.length) : read.cols,
    rows,
    rowPer,
    rowX0,
    flyers
  }
}

export const rulePlanFor = (rules: RuleFacts, table: boolean, layout: TraceLayout): RulePlan =>
  cached(rules, `${layoutKey(layout)}|${table}`, () =>
    planRules(rules, table, traceLattice(layout.dpr), layout.width, layout.dpr)
  )
