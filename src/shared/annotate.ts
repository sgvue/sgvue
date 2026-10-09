/**
 * Annotation arithmetic — every number `design-reference/design/viewer-core.js` uses to place
 * a gridline, a level tag, a laser ray or a dimension label, with no three.js and no DOM in
 * sight so `tests/unit/annotate.test.ts` can check it on plain numbers.
 *
 * Source lines: grids L173–213, levels L214–222, section L231–257, laser L367–407, spot
 * coordinates L411, dimensions L430–483.
 *
 * **Grids are segments here, not constant coordinates.** The design's model carries
 * `{ name, axis: 'x' | 'y', v }` because its mock federation is axis-aligned; a real
 * `IfcGridAxis` is a curve, and the 137.9 MB reference model's grid runs at ~43° with **no**
 * axis-aligned axis at all. So a grid is a point and a plan direction, and the design's two
 * branches fall out of the general case:
 *
 * · the drawn line is the grid's infinite line **clipped to the padded footprint**, which for
 *   `axis: 'x'` is exactly the design's `(v, mn.y − pad) → (v, mx.y + pad)`;
 * · the "family" is a direction group rather than an axis letter;
 * · the elevation rule compares each family's direction against the camera's plan direction,
 *   which for the axis-aligned case reduces to the design's `|cos θ| > |sin θ|`;
 * · the near-side bubble is the end further along the camera's plan direction, which reduces
 *   to the design's `nearSign`.
 *
 * Handedness is the one thing that cannot be derived. The design's offset moves the plane
 * along **+x** for an `axis: 'x'` grid and **+y** for an `axis: 'y'` one — two perpendiculars
 * of opposite handedness — so no single rotation of the line direction reproduces both.
 * `planNormal` states the convention instead: of a segment's two plan normals, take the one
 * pointing into the positive half-plane. That is `(1, 0)` and `(0, 1)` for those two cases,
 * which is the design exactly, and it is well defined at 43°.
 */
import { DASH, FOOT, signedF3 } from './fmt'
import {
  coord3,
  coordIn,
  formatElevation,
  formatLength,
  lengthNumber,
  lengthSuffix,
  type DisplayUnit
} from './units'

/** A plan point or direction: `[x, y]`, metres. */
export type XY = readonly [number, number]

/* ────────────────────────────── grids ────────────────────────────── */

/** `viewer-core.js` L175. "keep annotation off the geometry: at least 2.5 m". */
export const GRID_PAD_MIN = 2.5
export const GRID_PAD_FRACTION = 0.06

/**
 * How far past the footprint a gridline, a level ring and a level tag reach.
 *
 * Not scaled by the renderer's `radius / 27.5` factor, unlike the scene constants in
 * `scene.ts`: the rule is already footprint-relative, and its 2.5 m floor is an absolute
 * clearance between annotation and geometry rather than a size taken from the design's own
 * mock. On a 425 m model the 6 % term gives 25.5 m and the floor never applies.
 *
 * `BUILD_PLAN.md` §5 states `max(6 m, 12 % of footprint)` for the level rings specifically;
 * `viewer-core.js` L215 uses this same `pad` for them, and the prototype is what parity is
 * measured against, so this is what both use.
 */
export const gridPad = (sizeX: number, sizeY: number): number =>
  Math.max(GRID_PAD_MIN, Math.max(sizeX, sizeY) * GRID_PAD_FRACTION)

/**
 * A grid segment shorter than this states a direction, not an extent: an `IfcLine` of
 * magnitude 1 is a metre long however big the building is (`clipLineToRect` below). The
 * design's own clearance floor, so a grid counts only if it is longer than the padding.
 */
export const GRID_EXTENT_MIN = GRID_PAD_MIN

/**
 * The plan rectangle the grids' **own authored extents** cover — the union of every usable
 * segment's two ends — or `null` when no grid has one (2026-09-24, owner-requested: *"the
 * gridline bubbles are too far away from my uploaded real model"*). Until then the lines were
 * clipped to the whole model's footprint, and a large site put the bubbles 93–173 m from the
 * reference model's building. The caller pads it with `padRect` and falls back to the
 * building's footprint, never the whole model's.
 */
export function gridExtentRect(segments: readonly { p0: XY; p1: XY }[]): Rect | null {
  let r: Rect | null = null
  for (const { p0, p1 } of segments) {
    if (!(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) >= GRID_EXTENT_MIN)) continue
    r ??= { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    r.minX = Math.min(r.minX, p0[0], p1[0])
    r.minY = Math.min(r.minY, p0[1], p1[1])
    r.maxX = Math.max(r.maxX, p0[0], p1[0])
    r.maxY = Math.max(r.maxY, p0[1], p1[1])
  }
  return r
}

/** `rect` grown by `gridPad` of its own size on every side, and that pad. */
export function padRect(rect: Rect): { rect: Rect; pad: number } {
  const pad = gridPad(rect.maxX - rect.minX, rect.maxY - rect.minY)
  return {
    rect: { minX: rect.minX - pad, minY: rect.minY - pad, maxX: rect.maxX + pad, maxY: rect.maxY + pad },
    pad
  }
}

/** L182. A bubble sits this far beyond its end of the line, along the line. */
export const BUBBLE_GAP = 1.1
/** L185. The elevation-view stem stops this far short of the lifted bubble. */
export const STEM_DROP = 0.7
/** L198. Inside this much of the horizon, the view counts as an elevation. */
export const ELEVATION_PHI_BAND = 0.25
/** Two grids belong to the same family when their plan directions agree within this. */
export const FAMILY_TOLERANCE_DEG = 10

const EPS = 1e-9

/**
 * A segment's unit plan direction, flipped into the positive half-plane so that two records
 * of the same axis written in opposite order give the same direction — which is what makes
 * family grouping and the near-end test stable.
 *
 * `[0, 0]` for a degenerate segment; every caller treats that as "no line".
 */
export function canonicalDir(p0: XY, p1: XY): XY {
  let dx = p1[0] - p0[0]
  let dy = p1[1] - p0[1]
  const len = Math.hypot(dx, dy)
  if (len < EPS) return [0, 0]
  dx /= len
  dy /= len
  const flip = dx < -EPS || (Math.abs(dx) <= EPS && dy < 0)
  return flip ? [-dx, -dy] : [dx, dy]
}

/**
 * The plan normal the section offset runs along: of the two perpendiculars, the one pointing
 * into the positive half-plane. See the module note for why this is a stated convention and
 * not a rotation of the direction.
 */
export function planNormal(dir: XY): XY {
  const a: XY = [dir[1], -dir[0]]
  if (a[0] > EPS) return a
  if (a[0] < -EPS) return [-a[0], -a[1]]
  return a[1] >= 0 ? a : [-a[0], -a[1]]
}

/** The padded footprint a gridline is drawn across. */
export interface Rect {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * The stretch of the infinite line `point + t · dir` that lies inside `rect`, as its two
 * endpoints in increasing `t`. `null` when the line misses the rectangle.
 *
 * This is what makes a rotated grid drawable: the design's endpoints are the footprint's
 * padded edges, never the `IfcGridAxis` curve's own extent (an `IfcLine` with magnitude 1 is
 * a metre long however big the building is).
 */
export function clipLineToRect(point: XY, dir: XY, rect: Rect): [XY, XY] | null {
  if (Math.abs(dir[0]) < EPS && Math.abs(dir[1]) < EPS) return null
  let tmin = -Infinity
  let tmax = Infinity
  const slab = (o: number, d: number, lo: number, hi: number): boolean => {
    if (Math.abs(d) < EPS) return o >= lo && o <= hi
    let t0 = (lo - o) / d
    let t1 = (hi - o) / d
    if (t0 > t1) [t0, t1] = [t1, t0]
    if (t0 > tmin) tmin = t0
    if (t1 < tmax) tmax = t1
    return tmin <= tmax
  }
  if (!slab(point[0], dir[0], rect.minX, rect.maxX)) return null
  if (!slab(point[1], dir[1], rect.minY, rect.maxY)) return null
  if (!Number.isFinite(tmin) || !Number.isFinite(tmax)) return null
  return [
    [point[0] + dir[0] * tmin, point[1] + dir[1] * tmin],
    [point[0] + dir[0] * tmax, point[1] + dir[1] * tmax]
  ]
}

/**
 * Group plan directions into families, within `FAMILY_TOLERANCE_DEG` and modulo 180°.
 * Returns the family index of each input, and each family's own direction (its first member's).
 */
export function gridFamilies(
  dirs: readonly XY[],
  toleranceDeg = FAMILY_TOLERANCE_DEG
): { family: number[]; dirs: XY[] } {
  const cos = Math.cos((toleranceDeg * Math.PI) / 180)
  const famDirs: XY[] = []
  const family = dirs.map((d) => {
    if (Math.abs(d[0]) < EPS && Math.abs(d[1]) < EPS) return -1
    for (let i = 0; i < famDirs.length; i++) {
      // Both are canonical, so |dot| and dot agree; |dot| keeps it safe either way.
      if (Math.abs(d[0] * famDirs[i][0] + d[1] * famDirs[i][1]) >= cos) return i
    }
    famDirs.push(d)
    return famDirs.length - 1
  })
  return { family, dirs: famDirs }
}

/** L198. `|phi − π/2| < 0.25` — the camera is within 14° of the horizon. */
export const isElevation = (phi: number): boolean =>
  Math.abs(phi - Math.PI / 2) < ELEVATION_PHI_BAND

/**
 * L199–204, generalised. In an elevation only one grid family is meaningful: the family whose
 * **lines run along the view direction**, because its members sit at different distances
 * across the screen. The other family's lines run across the screen at one screen position
 * each and overprint one another.
 *
 * (An east elevation shows bubbles 1, 2, 3, 4 — the grids running east–west — not A…E. That
 * is the design's `keepAxis = alongX ? 'y' : 'x'`: `axis: 'y'` is the family whose lines run
 * along **x**, which is the view direction when the camera is east.)
 *
 * `u` is the camera's plan direction, `(cos θ, sin θ)`. Returns the family index, or −1 when
 * there are none.
 */
export function keepFamily(famDirs: readonly XY[], u: XY): number {
  let best = -1
  let bestDot = -1
  for (let i = 0; i < famDirs.length; i++) {
    const dot = Math.abs(famDirs[i][0] * u[0] + famDirs[i][1] * u[1])
    if (dot > bestDot) {
      bestDot = dot
      best = i
    }
  }
  return best
}

/**
 * L200 and L209, generalised: which end of the line carries the bubble in an elevation — the
 * one nearer the camera. `+1` is `p1`, `−1` is `p0`.
 */
export const nearEndSign = (p0: XY, p1: XY, u: XY): 1 | -1 =>
  (p1[0] - p0[0]) * u[0] + (p1[1] - p0[1]) * u[1] > 0 ? 1 : -1

/* ────────────────────────────── section plane ────────────────────────────── */

/** A world-space half-space: `dot(p, n) + c >= 0` is kept, as `materials.ts` holds it. */
export interface SectionPlane {
  n: readonly [number, number, number]
  c: number
  /** The plan normal the offset ran along, and the in-plane direction — the quad needs both. */
  nrm: XY
  dir: XY
  /** `dot(pointOnPlane, nrm)`, i.e. where along `nrm` the plane sits. */
  at: number
}

/**
 * L236–242, generalised to a segment. `offset` is metres along `planNormal`, `flip` swaps
 * which side is kept, and `centre` is the federation's own centre — the design keeps the side
 * that holds the model, then lets `flip` reverse it.
 */
export function planeFromSegment(
  p0: XY,
  p1: XY,
  offset: number,
  flip: boolean,
  centre: XY
): SectionPlane | null {
  const dir = canonicalDir(p0, p1)
  if (dir[0] === 0 && dir[1] === 0) return null
  const nrm = planNormal(dir)
  const at = p0[0] * nrm[0] + p0[1] * nrm[1] + offset
  const toward = centre[0] * nrm[0] + centre[1] * nrm[1] >= at ? 1 : -1
  const sgn = flip ? -toward : toward
  return { n: [nrm[0] * sgn, nrm[1] * sgn, 0], c: -sgn * at, nrm, dir, at }
}

/** L246. A level plane: `flip` keeps what is above `v` instead of what is below. */
export const planeFromLevel = (
  v: number,
  flip: boolean
): { n: readonly [number, number, number]; c: number } => ({
  n: [0, 0, flip ? 1 : -1],
  c: flip ? -v : v
})

/* ────────────────────────────── bubble declutter ────────────────────────────── */

/**
 * Clear space demanded between two grid bubbles, in screen pixels.
 *
 * The design has no rule here and needs none: its mock grid is nine well-spaced axes. A real
 * one is not — the reference model's numbered family is **24 axes**, which in plan puts 26 px
 * bubbles about 20 px apart, so they overprint and their labels clip. The user asked for the
 * crowded ones to be hidden and to come back as the view zooms in.
 */
export const BUBBLE_DECLUTTER_GAP = 2

/** A label's measured box in viewport pixels. */
export interface BubbleRect {
  left: number
  top: number
  right: number
  bottom: number
}

/** One bubble that is otherwise visible this frame, and where it landed. */
export interface BubbleItem {
  /** Stable identity, so a caller can carry the answer across frames. */
  key: string
  /**
   * Bubbles in different rows never hide one another. A row is one family at one end of the
   * grid: the two ends of the same grid are decided independently, because a bubble crowded
   * at the near end may be perfectly clear at the far one.
   */
  row: string
  /** The grid's own axis order along the row. The sweep is greedy in this order. */
  order: number
  rect: BubbleRect
  /**
   * A grid-dimension label (2026-09-24) rather than a bubble. These are decided **after**
   * every bubble, against every kept box in every row, so a bubble is never hidden by one and
   * the bubbles' own answer is exactly what it was without them.
   */
  after?: boolean
}

const grow = (r: BubbleRect, by: number): BubbleRect => ({
  left: r.left - by,
  top: r.top - by,
  right: r.right + by,
  bottom: r.bottom + by
})

const overlaps = (a: BubbleRect, b: BubbleRect): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

/**
 * Which of this frame's bubbles to draw: the keys to keep.
 *
 * Greedy in axis order within each row — keep the first, hide any whose box would come within
 * `BUBBLE_DECLUTTER_GAP` of one already kept — so the survivors are the same axes frame after
 * frame at a given zoom, and zooming in simply lets more of them through. At a 20 px pitch
 * with 26 px bubbles that keeps every other one; at 30 px it keeps them all.
 *
 * `items` carries **only** the bubbles that would otherwise be drawn: one that is off screen
 * or occluded is not passed, and so reserves no space for itself.
 */
export function declutterBubbles(items: readonly BubbleItem[]): Set<string> {
  const shown = new Set<string>()
  const keptByRow = new Map<string, BubbleRect[]>()
  const byRow = (a: BubbleItem, b: BubbleItem): number =>
    a.row < b.row ? -1 : a.row > b.row ? 1 : a.order - b.order
  const ordered = items.filter((x) => !x.after).sort(byRow)
  for (const item of ordered) {
    const kept = keptByRow.get(item.row)
    if (kept?.some((k) => overlaps(item.rect, grow(k, BUBBLE_DECLUTTER_GAP)))) continue
    if (kept) kept.push(item.rect)
    else keptByRow.set(item.row, [item.rect])
    shown.add(item.key)
  }
  // Grid-dimension labels: the same greedy rule, but against everything kept in any row.
  const all = [...keptByRow.values()].flat()
  for (const item of items.filter((x) => x.after).sort(byRow)) {
    if (all.some((k) => overlaps(item.rect, grow(k, BUBBLE_DECLUTTER_GAP)))) continue
    all.push(item.rect)
    shown.add(item.key)
  }
  return shown
}

/* ────────────────────────────── grid dimensions ────────────────────────────── */

/**
 * Two neighbouring grids are dimensioned only when their plan directions agree within this.
 * A family groups directions within `FAMILY_TOLERANCE_DEG`, which lets a radial grid's
 * neighbours in; their spacing is not one number, so they get no dimension.
 */
export const GRID_DIM_PARALLEL_DEG = 0.5
/** A grid bubble's radius on screen (`BUBBLE_STYLE` is 26 px across). */
export const BUBBLE_RADIUS_PX = 13
/** Clear space between a bubble's edge and the nearest edge of a grid-dimension label. */
export const GRID_DIM_CLEAR_PX = 8

/**
 * How far, in screen pixels, a grid dimension stands inward of its bubble row: the bubble's
 * radius, the clearance, and the label's own half-extent **along the grid** — `(ux, uy)` is
 * the grid's inward direction on screen, unit length. A grid that runs up the screen puts the
 * label's half-height between it and the bubbles (13 + 8 + 10.5 ≈ 32 px); one that runs across
 * the screen puts its half-width there (≈ 54 px), which is what keeps a sideways family's
 * labels off their own bubbles.
 */
export function gridDimStandoffPx(ux: number, uy: number, halfW: number, halfH: number): number {
  return BUBBLE_RADIUS_PX + GRID_DIM_CLEAR_PX + Math.abs(ux) * halfW + Math.abs(uy) * halfH
}

/** One drawn gridline: its clipped segment, `p0` the start end (the `−1` bubble's end). */
export interface GridDimLine {
  p0: XY
  p1: XY
  family: number
}

/**
 * One dimension between two adjacent, parallel grids of one family, at the start end.
 *
 * `at` lies on line `i` at the row of the **inner** of the two start bubbles (for an
 * axis-aligned family every bubble is on one row, so a family's runs make one straight
 * string; a rotated grid clipped to the axis-aligned footprint steps with the bubbles).
 * The renderer adds its screen-space offset along `dir`; the run is then `at → at + span`.
 */
export interface GridDimRun {
  family: number
  /** Indices into the input, `i` before `j` across the family. */
  i: number
  j: number
  /** Perpendicular spacing, metres, Float64 from the grid segments. */
  spacing: number
  at: XY
  /** From line `i` to line `j`, perpendicular to the grids; its length is `spacing`. */
  span: XY
  /** Unit direction along line `i`, pointing inward from the start end. */
  dir: XY
}

/**
 * The dimension runs for every family: each family's lines sorted across the family, each
 * adjacent pair that is parallel within `toleranceDeg` and not coincident dimensioned.
 * `gap` is the bubble's distance beyond the line end (`BUBBLE_GAP × scale`).
 */
export function gridDimRuns(
  lines: readonly GridDimLine[],
  gap: number,
  toleranceDeg = GRID_DIM_PARALLEL_DEG
): GridDimRun[] {
  const sinTol = Math.sin((toleranceDeg * Math.PI) / 180)
  const byFamily = new Map<number, number[]>()
  lines.forEach((l, k) => {
    const d = canonicalDir(l.p0, l.p1)
    if (l.family < 0 || (d[0] === 0 && d[1] === 0)) return
    const list = byFamily.get(l.family)
    if (list) list.push(k)
    else byFamily.set(l.family, [k])
  })
  const out: GridDimRun[] = []
  for (const family of [...byFamily.keys()].sort((a, b) => a - b)) {
    const members = byFamily.get(family)!
    // Across the family along its plan normal, so an axis-aligned family runs in +x or +y — at
    // each segment's **midpoint**: a family admits lines 10° apart, and two such lines can
    // cross near one end, so their ends can be in the other order from the lines themselves.
    const fn = planNormal(canonicalDir(lines[members[0]].p0, lines[members[0]].p1))
    const across = (k: number): number =>
      ((lines[k].p0[0] + lines[k].p1[0]) / 2) * fn[0] + ((lines[k].p0[1] + lines[k].p1[1]) / 2) * fn[1]
    const sorted = [...members].sort((a, b) => across(a) - across(b) || a - b)
    for (let k = 0; k + 1 < sorted.length; k++) {
      const i = sorted[k]
      const j = sorted[k + 1]
      const di = canonicalDir(lines[i].p0, lines[i].p1)
      const dj = canonicalDir(lines[j].p0, lines[j].p1)
      if (Math.abs(di[0] * dj[1] - di[1] * dj[0]) > sinTol) continue
      // Near the canonical flip (a direction at ±90°) two parallel lines can be recorded in
      // opposite senses; then line j's start end is its `p1`.
      const sj = di[0] * dj[0] + di[1] * dj[1] >= 0 ? lines[j].p0 : lines[j].p1
      const pi = lines[i].p0
      const ni: XY = [-di[1], di[0]]
      const s = (sj[0] - pi[0]) * ni[0] + (sj[1] - pi[1]) * ni[1]
      if (Math.abs(s) < 1e-6) continue
      const ui = pi[0] * di[0] + pi[1] * di[1]
      const uj = sj[0] * di[0] + sj[1] * di[1]
      const t = Math.max(ui, uj) - gap - ui
      out.push({
        family,
        i,
        j,
        spacing: Math.abs(s),
        at: [pi[0] + di[0] * t, pi[1] + di[1] * t],
        span: [ni[0] * s, ni[1] * s],
        dir: di
      })
    }
  }
  return out
}

/**
 * How far, in metres along the grids, a run stands inward of the bubble row: `px` screen
 * pixels (`gridDimStandoffPx`) at the run's own scale (`pxPerMetre`), never more than `cap`.
 * Seen end-on, where a metre along the grid is almost no pixels, the cap is what holds.
 */
export function gridDimOffset(pxPerMetre: number, cap: number, px: number): number {
  if (!(pxPerMetre > 0)) return cap
  return Math.min(cap, px / pxPerMetre)
}

/* ────────────────────────────── levels ────────────────────────────── */

/**
 * L219. The level tag's anchor: the padded rectangle's `(min x, max y)` corner, at the
 * storey's elevation. `dx = −30` is applied in screen space by the label itself.
 */
export const levelTagAnchor = (rect: Rect): XY => [rect.minX, rect.maxY]

/** L219. The tag's screen-space nudge, in pixels. */
export const LEVEL_TAG_DX = -30

/**
 * L219. The level tag's own markup: the storey's name, then its elevation.
 *
 * The design prints `s.elev` — the same number its sidebar ladder prints — because its mock
 * federation is authored at the origin, so the scene height and the authored elevation are one
 * value. On a real file they are not: the geometry pipeline subtracts a whole-metre federation
 * offset, so the tag drawn beside a ring at scene `z` must still print the storey's **authored**
 * `IfcBuildingStorey.Elevation`, or it disagrees with the ladder two panels away (measured on
 * the reference model: the tag read `+1 000` for the storey the ladder calls `+0`).
 *
 * So the ring's height and the tag's number are two arguments, not one. `signedMm` is the
 * design's own formatter, U+2212 and thin spaces included — and since 2026-10-09 the display
 * unit's (`shared/units.ts`, `formatElevation`): `+4.000` in `m`, `+13'-1 1/2"` in `ft`.
 */
export const levelTagHtml = (name: string, authoredElevation: number, unit: DisplayUnit = 'mm'): string =>
  `<b style="font-weight:500;color:var(--ink)">${name}</b>&nbsp; ${formatElevation(authoredElevation, unit)}`

/* ────────────────────────────── laser meter ────────────────────────────── */

/** L367. The three axes the laser fires along, in the design's order. */
export const LASER_AXES = ['X', 'Y', 'Z'] as const
export type LaserAxis = (typeof LASER_AXES)[number]

/** L372. The ray starts this far off the surface it was fired from. */
export const LASER_LIFT = 0.003
/** L378. A hit nearer than this is the surface itself. */
export const LASER_MIN_DISTANCE = 0.01
/** L378. A hit on the element the ray started from, nearer than this, is self-intersection. */
export const LASER_SELF_DISTANCE = 0.05
/** L368. How far a ray reaches, before the scene-scale factor. */
export const LASER_FAR = 1000

/**
 * L376. A ray pointing into the surface it sits on is not fired. `normal` is the hit face's
 * normal; with none, all six directions are fired.
 *
 * Returns the six `[axis, sign]` pairs that survive, in the design's order (each axis `+1`
 * then `−1`).
 */
export function laserDirections(
  normal: readonly [number, number, number] | null
): { axis: LaserAxis; sign: 1 | -1 }[] {
  const out: { axis: LaserAxis; sign: 1 | -1 }[] = []
  LASER_AXES.forEach((axis, i) => {
    for (const sign of [1, -1] as const) {
      // `d · n` where d is the signed unit axis is just the normal's own component.
      if (normal && (normal[i] ?? 0) * sign < -0.5) continue
      out.push({ axis, sign })
    }
  })
  return out
}

/**
 * L403. The measure label's offset from its anchor, in pixels — since 2026-10-08 the middle of
 * each half of the ray, the same offset for both.
 */
export const laserLabelOffset = (axis: LaserAxis): { dx: number; dy: number } =>
  axis === 'Z' ? { dx: 46, dy: 0 } : { dx: 0, dy: -16 }

/**
 * 2026-10-08, owner-requested (*"show left and right dimension from the spot, rather than
 * overall"*): one axis of a reading split at the point it was taken from. `minus` is the
 * distance along the axis from that point to the face the axis's − ray hit, `plus` to the face
 * its + ray hit, in metres; `null` for a side that hit nothing, whose end is the point itself
 * (L382). Their sum is the whole ray, the design's one number per axis.
 */
export interface LaserSides {
  minus: number | null
  plus: number | null
}

/** The sides that reached a face, − side first: what is drawn, listed and read for an axis. */
export const laserSideLengths = (s: LaserSides): number[] =>
  [s.minus, s.plus].filter((v): v is number => v != null)

/**
 * L395. One reading in the 3D view — the axis in `--faint`, the length in `--ink`, as the
 * design's label for the whole ray. Since 2026-10-08 one such label stands at the middle of
 * each half of the ray that reached a face; since 2026-10-09 in the display unit
 * (`formatLength`: `2 300 mm` · `2.300 m` · `7'-6 1/2"`).
 */
export const laserLabelHtml = (axis: LaserAxis, metres: number, unit: DisplayUnit = 'mm'): string =>
  `<span style="color:var(--faint)">${axis}</span>&nbsp;` +
  `<b style="font-weight:500;color:var(--ink)">${formatLength(metres, unit)}</b>`

/**
 * L617. The reading that follows the pointer: per axis, since 2026-10-08, its two sides joined
 * by a `+` in `--faint` (the axis letter's and the unit's colour) — or the one side that reached
 * a face — with the design's `·` between axes and its ` mm` once at the end. Since 2026-10-09 in
 * the display unit: ` m` once at the end in `m`, and in `ft` no unit at all — feet and inches
 * say their own.
 */
export const laserLiveHtml = (
  rays: readonly ({ axis: LaserAxis } & LaserSides)[],
  unit: DisplayUnit = 'mm'
): string =>
  rays
    .map(
      (r) =>
        `<span style="color:var(--faint)">${r.axis}</span> ` +
        laserSideLengths(r)
          .map((v) => `<b style="font-weight:500">${lengthNumber(v, unit)}</b>`)
          .join('<span style="color:var(--faint)"> + </span>')
    )
    .join('<span style="color:var(--border-strong)"> · </span>') +
  (lengthSuffix(unit) ? `<span style="color:var(--faint)">${lengthSuffix(unit)}</span>` : '')

/* ────────────────────────────── spot coordinates ────────────────────────────── */

/**
 * L411. The spot tag's full reading — E, N and Z, then the file's own xyz in millimetres — with
 * the em dash where the design prints its own default base point. `f` is the point in the
 * file's coordinates (metres), `m` its map coordinates or `null` when the file states no base
 * point. Since 2026-09-28 this is the tag's **expanded** form, byte for byte what it always was.
 *
 * 2026-10-09: in the display unit, by the one rule (`shared/units.ts`) — E, N and Z are
 * coordinates, so metres in `mm` and `m` and decimal feet in `ft`; the xyz row printed whole
 * millimetres, so it prints metres to three decimals in `m` and decimal feet in `ft`, ungrouped
 * as it always was.
 */
export function spotGridHtml(
  f: { x: number; y: number; z: number },
  m: { E: number; N: number; Z: number } | null,
  unit: DisplayUnit = 'mm'
): string {
  const v = (n: number | null | undefined): string => (n == null ? DASH : coord3(n, unit))
  const xyz = (n: number): string =>
    unit === 'mm' ? String(Math.round(n * 1000)) : (unit === 'ft' ? n / FOOT : n).toFixed(3)
  const rule = 'border-top:1px solid var(--border);padding-top:3px;margin-top:1px'
  return (
    '<div style="display:grid;grid-template-columns:auto auto;gap:2px 10px;text-align:right">' +
    `<span style="color:var(--faint)">E</span><span style="color:var(--ink)">${v(m?.E)}</span>` +
    `<span style="color:var(--faint)">N</span><span style="color:var(--ink)">${v(m?.N)}</span>` +
    `<span style="color:var(--faint)">Z</span><span style="color:var(--ink)">${v(m?.Z)}</span>` +
    `<span style="color:var(--faint);${rule}">xyz</span>` +
    `<span style="${rule}">${xyz(f.x)}, ${xyz(f.y)}, ` +
    `${xyz(f.z)}</span></div>`
  )
}

/**
 * 2026-09-28, owner-requested. The level mark before a collapsed spot tag's number: `▽`, drawn
 * rather than typed, in the E / N / Z labels' `--faint`. The self-hosted IBM Plex Mono maps no
 * triangle at all — its only glyphs in U+2190–25FF are ↑ ↓ − ∕ — so a typed `▽` would come from
 * whichever fallback font the OS has. Sized to the mono's digits at 11 px, standing on the
 * baseline.
 */
export const SPOT_LEVEL_MARK =
  '<svg width="8" height="7" viewBox="0 0 8 7" style="color:var(--faint)">' +
  '<path d="M.5.5h7L4 6.5z" fill="none" stroke="currentColor"/></svg>'

/**
 * 2026-09-28, owner-requested: the spot tag's **collapsed** form, its level only — `▽ +10.500`.
 * `z` is the number the grid's Z row prints (the map Z) or, with no base point, the file's own
 * z in metres; `signedF3` is `f3` with an explicit sign. A coordinate, so since 2026-10-09 it is
 * metres in `mm` and `m` and decimal feet in `ft` (`coordIn`).
 */
export const spotLevelHtml = (z: number, unit: DisplayUnit = 'mm'): string =>
  `${SPOT_LEVEL_MARK} <span style="color:var(--ink)">${signedF3(coordIn(z, unit))}</span>`

/* ────────────────────── a markup placed on an element's box (2026-10-02) ────────────────────── */

/**
 * Where on an element's bounding box the assistant's `manage_markups` takes a point: the middle
 * of its top face, of the box itself, or of its underside. A person places a markup by clicking
 * a surface; a tool has no pointer, so it names an element and one of these.
 */
export const BOX_PLACES = ['top', 'centre', 'base'] as const
export type BoxPlace = (typeof BOX_PLACES)[number]

/**
 * The point `place` names on an axis-aligned box `[x0, y0, z0, x1, y1, z1]` (Z up), and the
 * normal of the box face it sits on — what a click hands the laser meter, which does not fire
 * a ray into the surface it stands on (`laserDirections`). The box's centre is on no face, so
 * it has no normal and all six rays are fired.
 *
 * It is the **box**, not the solid: for a sloped roof or an L-shaped slab the middle of the top
 * face can be off the element's real surface, and the tool's description says so.
 */
export function boxPlace(
  box: readonly [number, number, number, number, number, number],
  place: BoxPlace
): { p: [number, number, number]; normal: [number, number, number] | null } {
  const [x0, y0, z0, x1, y1, z1] = box
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  if (place === 'top') return { p: [cx, cy, z1], normal: [0, 0, 1] }
  if (place === 'base') return { p: [cx, cy, z0], normal: [0, 0, -1] }
  return { p: [cx, cy, (z0 + z1) / 2], normal: null }
}

/* ────────────────────────────── selection dimensions ────────────────────────────── */

/** L448. How far a dimension run stands off the box. */
export const DIM_OFF_MIN = 0.12
export const DIM_OFF_FRACTION = 0.07
/** L448. Tick half-length, as a share of the stand-off. */
export const DIM_TICK_FRACTION = 0.3

export const dimOffset = (sizeX: number, sizeY: number, sizeZ: number): number =>
  Math.max(DIM_OFF_MIN, Math.max(sizeX, sizeY, sizeZ) * DIM_OFF_FRACTION)

/** L454. Half the label box, in pixels — the search tests this rectangle, not the real one. */
export const LABEL_HALF_W = 44
export const LABEL_HALF_H = 13
/** L461. Where along the run the anchor may sit. */
export const DIM_T_CANDIDATES = [0.5, 0.72, 0.28, 0.9, 0.1] as const
/** L462. Vertical escapes, in whole label heights. */
export const DIM_K_STEPS = [0, 1, -1, 2, -2, 3, -3] as const

/** A measured obstruction, in viewport pixels — the design's `dimAvoid` entries. */
export interface DimRect {
  x: number
  y: number
  w: number
  h: number
}

/** One candidate placement: where along the run, and the pixel push from there. */
export interface DimCandidate {
  t: number
  dx: number
  dy: number
}

/** L458. Does a label centred at `q` overlap anything already taken? */
export function blockedBy(
  q: { x: number; y: number },
  taken: readonly DimRect[]
): DimRect | undefined {
  return taken.find(
    (r) =>
      q.x + LABEL_HALF_W > r.x &&
      q.x - LABEL_HALF_W < r.x + r.w &&
      q.y + LABEL_HALF_H > r.y &&
      q.y - LABEL_HALF_H < r.y + r.h
  )
}

/**
 * L459–467. The screen-space search: every anchor position crossed with every push direction,
 * then the whole set again one label height up, one down, two up… The first candidate whose
 * rectangle clears `taken` wins; if none does, the first candidate is used anyway, which is
 * the design's own last resort.
 *
 * `at` projects a candidate to viewport pixels — the caller owns the camera.
 */
export function placeDimLabel(
  dirs: readonly (readonly [number, number])[],
  at: (c: DimCandidate) => { x: number; y: number },
  taken: readonly DimRect[]
): DimCandidate {
  const cands: DimCandidate[] = []
  for (const t of DIM_T_CANDIDATES) for (const d of dirs) cands.push({ t, dx: d[0], dy: d[1] })
  for (const k of DIM_K_STEPS) {
    for (const c of cands) {
      const cand: DimCandidate = { t: c.t, dx: c.dx, dy: c.dy + k * 2 * LABEL_HALF_H }
      if (!blockedBy(at(cand), taken)) return cand
    }
  }
  return cands[0]
}

/** L479. The rectangle a placed label becomes for the runs after it. */
export const dimLabelRect = (q: { x: number; y: number }): DimRect => ({
  x: q.x - LABEL_HALF_W,
  y: q.y - LABEL_HALF_H,
  w: LABEL_HALF_W * 2,
  h: LABEL_HALF_H * 2
})

/** L469–471. The three runs' push directions, in the design's order and preference. */
export const DIM_RUN_DIRS = {
  x: [
    [0, 15],
    [0, -16]
  ],
  y: [
    [42, 0],
    [-42, 0],
    [0, -20]
  ],
  z: [
    [-42, 0],
    [42, 0],
    [0, -20]
  ]
} as const
