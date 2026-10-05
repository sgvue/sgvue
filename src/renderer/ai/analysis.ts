/**
 * Deterministic analysis, run locally — `SGVue.dc.html:1281–1333` (`QK`, `qtoVal`,
 * `summarize`, `auditModel`, `clashPairs`), `:1572–1590` (`chatSuggest`) and `:1642–1649`
 * (`seedAudit`), as pure functions over the federation.
 *
 * The design's own comment says why they are local: **no model round-trip, no invented
 * numbers.** The audit that greets a freshly loaded federation, the quantity totals behind a
 * table and the clash sweep are arithmetic, and arithmetic is not something to ask a language
 * model for.
 *
 * One thing is not the design's: `clashPairs` runs on a uniform spatial hash rather than the
 * prototype's nested loop (plan §3.5 defect 6). The result is identical — `tests/unit/
 * clash.test.ts` checks it against brute force on random boxes — but the prototype's O(N×M)
 * gave up at 400 000 tested pairs, which on two real discipline models is reached long before
 * the answer is.
 */
import type { FederatedElement } from '../../shared/federate'
import { attr } from '../../shared/attr'
import type { Predicate } from '../../shared/rules'

/* ────────────────────────────── quantities ────────────────────────────── */

/** `SGVue.dc.html:1281`. The quantity names each metric is read from, in order. */
export const QK: Record<'area' | 'volume' | 'length', readonly string[]> = {
  area: ['GrossArea', 'NetArea', 'Area'],
  volume: ['GrossVolume', 'NetVolume', 'Volume'],
  length: ['Length', 'Span']
}

export type Metric = keyof typeof QK

export const METRICS: readonly Metric[] = ['area', 'volume', 'length']

/**
 * The quantity a metric is actually read from: its value **as authored**, the IFC measure type
 * the file stated for it, and where it came from.
 *
 * The measure type is the whole reason this exists. A total of `GrossArea` is in the file's
 * area unit and a total of `Length` is in its length unit, and a Revit export routinely writes
 * the second in millimetres beside the first in square metres — so a total has to carry the
 * measure it was summed from or it cannot be labelled honestly (2026-09-20).
 */
export interface QuantityHit {
  value: number
  /** `IFCAREAMEASURE`, `IFCLENGTHMEASURE`, … as the file stated it. `''` when it stated none. */
  measure: string
  set: string
  key: string
}

/** `SGVue.dc.html:1282`. First quantity set that carries a name from `QK`, parsed. */
export function qtoHit(el: FederatedElement, metric: Metric): QuantityHit | null {
  for (const [set, p] of Object.entries(el.qto ?? {})) {
    for (const k of QK[metric] ?? []) {
      if (k in p) {
        const n = parseFloat(String(p[k]))
        if (!isNaN(n)) {
          return { value: n, measure: el.psetMeta?.[set]?.measures?.[k] ?? '', set, key: k }
        }
      }
    }
  }
  return null
}

export interface SummaryRow {
  k: string
  n: number
  area: number
  volume: number
  length: number
  ids: number[]
  /**
   * How many of this group's `n` elements actually carried each quantity. A total summed from
   * 94 of 134 slabs is not the group's area, and a reader of the number alone cannot tell
   * (2026-09-20).
   */
  from: Record<Metric, number>
}

/** Which IFC measure types a summary's totals were summed from, per metric. */
export type SummaryMeasures = Record<Metric, string[]>

/**
 * `SGVue.dc.html:1287`. `groupBy` is any attribute **or** any property-set key, resolved
 * through the same `attr` the rules use — which is the whole of pitfall 17. Rows are sorted
 * by count, descending; an element that does not carry the key lands under the em dash.
 *
 * `measures` is the set of IFC measure types each metric was summed from, across the whole
 * answer, so the caller can name the unit rather than assume one.
 */
export function summarize(
  els: readonly FederatedElement[],
  groupBy: string
): { rows: SummaryRow[]; measures: SummaryMeasures } {
  const rows = new Map<string, SummaryRow>()
  const seen: Record<Metric, Set<string>> = { area: new Set(), volume: new Set(), length: new Set() }
  for (const e of els) {
    const v = attr(e, groupBy)
    const k = v === undefined || v === '' ? '—' : String(v)
    let row = rows.get(k)
    if (!row) {
      row = { k, n: 0, area: 0, volume: 0, length: 0, ids: [], from: { area: 0, volume: 0, length: 0 } }
      rows.set(k, row)
    }
    row.n++
    row.ids.push(e.id)
    for (const m of METRICS) {
      const hit = qtoHit(e, m)
      if (!hit) continue
      row[m] += hit.value
      row.from[m]++
      if (hit.measure) seen[m].add(hit.measure)
    }
  }
  return {
    rows: [...rows.values()].sort((a, b) => b.n - a.n),
    measures: {
      area: [...seen.area].sort(),
      volume: [...seen.volume].sort(),
      length: [...seen.length].sort()
    }
  }
}

/* ────────────────────────────── the audit ────────────────────────────── */

export interface AuditFinding {
  label: string
  n: number
  ids: number[]
  note: string
}

/** `SGVue.dc.html:1297`, finding for finding and in the design's own order. */
export function auditModel(
  elements: readonly FederatedElement[],
  storeys: readonly { name: string }[]
): AuditFinding[] {
  const out: AuditFinding[] = []
  const push = (label: string, ids: number[], note: string): void => {
    if (ids.length) out.push({ label, n: ids.length, ids, note })
  }
  push(
    'No PredefinedType',
    elements.filter((e) => !e.predefinedType || e.predefinedType === 'NOTDEFINED').map((e) => e.id),
    'Blocks entity-level classification'
  )
  push(
    'No ObjectType',
    elements.filter((e) => !e.objectType).map((e) => e.id),
    'No type family assigned'
  )
  push('No material', elements.filter((e) => !e.material).map((e) => e.id), 'Material not stated')
  push(
    'No property sets',
    elements.filter((e) => !e.psets || !Object.keys(e.psets).length).map((e) => e.id),
    'No Pset_ data to audit against'
  )
  push(
    'No quantities',
    elements.filter((e) => !e.qto || !Object.keys(e.qto).length).map((e) => e.id),
    'Cannot be included in quantity takeoff'
  )
  const named = new Map<string, number[]>()
  for (const e of elements) {
    const ids = named.get(e.name)
    if (ids) ids.push(e.id)
    else named.set(e.name, [e.id])
  }
  const dup = [...named.values()].filter((v) => v.length > 1).flat()
  push('Duplicate names', dup, 'Same Name on more than one element')
  const empty = storeys.filter((st) => !elements.some((e) => e.storey === st.name))
  if (empty.length) {
    out.push({
      label: 'Empty storeys',
      n: empty.length,
      ids: [],
      note: empty.map((s) => s.name).join(', ')
    })
  }
  return out
}

/** `SGVue.dc.html:1642`'s first-turn summary, as data. The panel renders it in 9b. */
export function seedAudit(
  elements: readonly FederatedElement[],
  storeys: readonly { name: string }[],
  loaded: readonly string[]
): { text: string; chips: { label: string; ids: number[] }[] } {
  const findings = auditModel(elements, storeys)
  const head = `${loaded.length} model${loaded.length === 1 ? '' : 's'}, ${elements.length.toLocaleString('en-US')} elements, ${storeys.length} storeys.`
  const text = findings.length
    ? `${head} Data completeness needs a look — ${findings.length} finding${findings.length === 1 ? '' : 's'}.`
    : `${head} No data-completeness issues found.`
  return {
    text,
    chips: findings
      .slice(0, 6)
      .map((x) => ({ label: `${x.label} (${x.n})`, ids: x.ids }))
      .filter((c) => c.ids.length)
  }
}

/* ────────────────────────────── clash candidates ────────────────────────────── */

export interface ClashPair {
  a: FederatedElement
  b: FederatedElement
  /** Overlap volume, cubic metres. */
  vol: number
}

/** `SGVue.dc.html:1318`'s own ceiling on how much work one sweep may do. */
export const CLASH_TEST_CAP = 400_000

type Box = readonly [number, number, number, number, number, number]

const boxOf = (e: FederatedElement): Box | null => (e.bbox ? (e.bbox as Box) : null)

/* ────────────────────────────── the uniform box hash ────────────────────────────── */

/**
 * One uniform spatial hash over a set of boxed elements, shared by `clashPairs` and
 * `nearbyElements` (2026-09-20 — the second was going to be a second copy of it).
 *
 * Every box is filed by its **centre**, and a query scans the cells its own half-extent, the
 * grid's largest half-extent and the query's own reach can touch — which is exactly the set a
 * flat scan would have tested, so nothing is missed and nothing is invented. The cell is the
 * mean extent, so a typical box lands in one cell and a large one in a few.
 */
export interface BoxGrid {
  cell: number
  /** The largest half-extent per axis, which is how far a filed centre can reach. */
  half: [number, number, number]
  buckets: Map<string, FederatedElement[]>
}

const cellKey = (i: number, j: number, k: number): string => `${i},${j},${k}`

export function buildBoxGrid(items: readonly FederatedElement[]): BoxGrid {
  let sum = 0
  const half: [number, number, number] = [0, 0, 0]
  for (const e of items) {
    const y = boxOf(e)!
    for (let ax = 0; ax < 3; ax++) {
      const extent = y[ax + 3] - y[ax]
      sum += extent
      half[ax] = Math.max(half[ax], extent / 2)
    }
  }
  const cell = items.length ? Math.max(sum / (items.length * 3), 1e-3) : 1
  const buckets = new Map<string, FederatedElement[]>()
  const at = (v: number): number => Math.floor(v / cell)
  for (const e of items) {
    const y = boxOf(e)!
    const k = cellKey(at((y[0] + y[3]) / 2), at((y[1] + y[4]) / 2), at((y[2] + y[5]) / 2))
    const bucket = buckets.get(k)
    if (bucket) bucket.push(e)
    else buckets.set(k, [e])
  }
  return { cell, half, buckets }
}

/**
 * Every filed element whose centre could be within `reach` of `box` on each axis. A superset
 * of the answer: the caller still applies the exact box test.
 */
export function queryBoxGrid(
  grid: BoxGrid,
  box: Box,
  reach: number,
  visit: (e: FederatedElement) => boolean | void
): void {
  const at = (v: number): number => Math.floor(v / grid.cell)
  const lo: number[] = []
  const hi: number[] = []
  let cells = 1
  for (let ax = 0; ax < 3; ax++) {
    const centre = (box[ax] + box[ax + 3]) / 2
    const span = (box[ax + 3] - box[ax]) / 2 + grid.half[ax] + reach
    lo[ax] = at(centre - span)
    hi[ax] = at(centre + span)
    cells *= hi[ax] - lo[ax] + 1
  }
  /**
   * A reach large enough to touch more cells than the grid has buckets costs more in empty
   * lookups than the scan it is avoiding — a 100 m radius on a metre-ish cell is 8 × 10⁶ cell
   * probes for a few hundred elements. Measured: `find_nearby` at distance 1 000 went from
   * 26 s to 2 ms. The answer is identical either way; the grid is a filter, never an answer.
   */
  if (cells > grid.buckets.size) {
    for (const bucket of grid.buckets.values()) {
      for (const e of bucket) if (visit(e) === false) return
    }
    return
  }
  for (let i = lo[0]; i <= hi[0]; i++) {
    for (let j = lo[1]; j <= hi[1]; j++) {
      for (let k = lo[2]; k <= hi[2]; k++) {
        const bucket = grid.buckets.get(cellKey(i, j, k))
        if (!bucket) continue
        for (const e of bucket) if (visit(e) === false) return
      }
    }
  }
}

/**
 * Axis-aligned bounding-box interference between two models.
 *
 * Deterministic, bbox-level only — it finds **candidates for review**, it is not a
 * solid-geometry clash engine, and every caller says so.
 *
 * The grid hashes each B box by its **centre**. A box from A then scans only the cells its
 * own half-extent, B's largest half-extent and the tolerance can reach, which is exactly the
 * set brute force would have tested — no pair is missed and none is invented.
 */
export function clashPairs(
  elements: readonly FederatedElement[],
  visible: Predicate,
  a: string,
  b: string,
  tol = 0
): { pairs: ClashPair[]; capped: boolean } {
  const of = (key: string): FederatedElement[] =>
    elements.filter((e) => e.model === key && e.bbox && visible(e))
  const A = of(a)
  const B = of(b)
  if (!A.length || !B.length) return { pairs: [], capped: false }

  const grid = buildBoxGrid(B)
  const pairs: ClashPair[] = []
  let tested = 0
  let capped = false
  for (const ea of A) {
    if (capped) break
    const x = boxOf(ea)!
    queryBoxGrid(grid, x, Math.abs(tol), (eb) => {
      if (++tested > CLASH_TEST_CAP) {
        capped = true
        return false
      }
      const y = boxOf(eb)!
      // `SGVue.dc.html:1322`, verbatim: tolerance shrinks the A box on both sides.
      if (x[3] - tol < y[0] || x[0] + tol > y[3]) return true
      if (x[4] - tol < y[1] || x[1] + tol > y[4]) return true
      if (x[5] - tol < y[2] || x[2] + tol > y[5]) return true
      const ox = Math.min(x[3], y[3]) - Math.max(x[0], y[0])
      const oy = Math.min(x[4], y[4]) - Math.max(x[1], y[1])
      const oz = Math.min(x[5], y[5]) - Math.max(x[2], y[2])
      pairs.push({ a: ea, b: eb, vol: ox * oy * oz })
      return true
    })
  }
  if (capped) return { pairs, capped: true }
  pairs.sort((p, q) => q.vol - p.vol)
  return { pairs, capped: false }
}

/* ────────────────────────────── proximity ────────────────────────────── */

export interface Neighbour {
  el: FederatedElement
  /** Metres between the two boxes, 0 when they touch or overlap. */
  gap: number
  /** Which of the asked-about elements this is a neighbour of. */
  of: number
}

/** Metres between two axis-aligned boxes; 0 when they overlap on every axis. */
export function boxGap(x: Box, y: Box): number {
  const g = [
    Math.max(y[0] - x[3], x[0] - y[3]),
    Math.max(y[1] - x[4], x[1] - y[4]),
    Math.max(y[2] - x[5], x[2] - y[5])
  ].map((v) => Math.max(v, 0))
  return Math.hypot(g[0], g[1], g[2])
}

/**
 * Every boxed element within `distance` metres of one of `seeds`, nearest first — 2026-09-20,
 * `docs/AI_REVIEW.md` §9 gap 7.
 *
 * Box arithmetic in the project frame, exactly as `measure_between` and `clash_check` are, on
 * the same uniform hash `clash_check` uses. A seed is never its own neighbour, and a duplicate
 * across two seeds is kept once, at its smallest gap.
 *
 * `pool` is the caller's — the executor passes the visible elements, minus `IfcSpace` unless
 * it was asked for, because a space overlaps everything standing in it.
 */
export function nearbyElements(
  pool: readonly FederatedElement[],
  seeds: readonly FederatedElement[],
  distance: number
): Neighbour[] {
  const seedIds = new Set(seeds.map((e) => e.id))
  const boxed = pool.filter((e) => e.bbox && !seedIds.has(e.id))
  if (!boxed.length || !seeds.length) return []
  const grid = buildBoxGrid(boxed)
  const best = new Map<number, Neighbour>()
  for (const seed of seeds) {
    const x = boxOf(seed)
    if (!x) continue
    queryBoxGrid(grid, x, distance, (e) => {
      const gap = boxGap(x, boxOf(e)!)
      if (gap > distance) return true
      const had = best.get(e.id)
      if (!had || gap < had.gap) best.set(e.id, { el: e, gap, of: seed.id })
      return true
    })
  }
  return [...best.values()].sort((p, q) => p.gap - q.gap || p.el.id - q.el.id)
}

/** The flat scan the grid must agree with, kept only as the test's reference. */
export function nearbyElementsBrute(
  pool: readonly FederatedElement[],
  seeds: readonly FederatedElement[],
  distance: number
): Neighbour[] {
  const seedIds = new Set(seeds.map((e) => e.id))
  const best = new Map<number, Neighbour>()
  for (const seed of seeds) {
    const x = boxOf(seed)
    if (!x) continue
    for (const e of pool) {
      if (seedIds.has(e.id) || !e.bbox) continue
      const gap = boxGap(x, boxOf(e)!)
      if (gap > distance) continue
      const had = best.get(e.id)
      if (!had || gap < had.gap) best.set(e.id, { el: e, gap, of: seed.id })
    }
  }
  return [...best.values()].sort((p, q) => p.gap - q.gap || p.el.id - q.el.id)
}

/** The prototype's nested loop, kept only so the test has something to compare against. */
export function clashPairsBrute(
  elements: readonly FederatedElement[],
  visible: Predicate,
  a: string,
  b: string,
  tol = 0
): ClashPair[] {
  const of = (key: string): FederatedElement[] =>
    elements.filter((e) => e.model === key && e.bbox && visible(e))
  const pairs: ClashPair[] = []
  for (const ea of of(a)) {
    const x = boxOf(ea)!
    for (const eb of of(b)) {
      const y = boxOf(eb)!
      if (x[3] - tol < y[0] || x[0] + tol > y[3]) continue
      if (x[4] - tol < y[1] || x[1] + tol > y[4]) continue
      if (x[5] - tol < y[2] || x[2] + tol > y[5]) continue
      const ox = Math.min(x[3], y[3]) - Math.max(x[0], y[0])
      const oy = Math.min(x[4], y[4]) - Math.max(x[1], y[1])
      const oz = Math.min(x[5], y[5]) - Math.max(x[2], y[2])
      pairs.push({ a: ea, b: eb, vol: ox * oy * oz })
    }
  }
  return pairs.sort((p, q) => q.vol - p.vol)
}

/* ────────────────────────────── suggestions ────────────────────────────── */

/** The slice of the panel one suggestion round reads. */
export interface SuggestInput {
  lastMessage: { table?: { clash?: boolean } | null; chips?: { label: string }[] } | null
  messageTexts: readonly string[]
  sel: { type: string; objectType: string; storey: string } | null
  stackLive: boolean
  hiddenCount: number
  loaded: readonly string[]
  files: readonly { key: string; name: string }[]
}

/**
 * `SGVue.dc.html:1572`. What you can usefully ask next depends on what is filtered, selected
 * and loaded — not on a fixed list. Ported rule for rule, including the order and the final
 * de-duplication.
 */
export function chatSuggest(input: SuggestInput): string[] {
  const out: string[] = []
  const last = input.lastMessage ?? {}
  const name = (k: string): string => input.files.find((f) => f.key === k)?.name || k
  const sel = input.sel
  if (sel) {
    out.push(`How many more like ${sel.objectType || sel.type}?`)
    out.push(`Isolate every ${sel.type.replace(/^Ifc/, '').toLowerCase()} on ${sel.storey}`)
  }
  if (last.table && !last.table.clash) out.push('Break that down by level instead')
  if (last.chips && last.chips.length && !sel) out.push('Isolate those elements')
  if (input.stackLive) {
    out.push('Add the slabs to that view as well')
    out.push('Reset the view')
  } else if (input.hiddenCount) out.push('Reset the view')
  if (input.loaded.length > 1 && !input.stackLive) {
    const [a, b] = input.loaded
    out.push(`Check ${name(a)} against ${name(b)}`)
  }
  if (input.loaded.includes('SIT')) out.push('How many trees, by species?')
  if (!input.messageTexts.some((t) => /audit/i.test(t))) out.push('Audit the model data')
  out.push('Slab area by level', 'Isolate the external walls', 'Section at grid C, north view')
  return [...new Set(out)]
}
