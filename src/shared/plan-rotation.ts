/**
 * The plan rotation — 2026-11-07, the owner: *"I dont want my gridlines to be place diagonally
 * relative to my building."*
 *
 * Every model is drawn at its file's own world coordinates since that day (origin to origin,
 * `shared/georef.ts`), so a Revit "Shared Coordinates" export stands at its angle to true north —
 * 43° on the reference model — and its grids run diagonally across the screen. No model is ever
 * turned to fix that. **Only the camera turns**: the plan rotation ρ is the angle the camera's
 * plan frame stands at in the world, so that in Plan the gridlines run screen-vertical and
 * -horizontal, the six named views and the view cube face the grids square, and everything the
 * app draws as an axis-aligned plan rectangle — the grid extent, the level rings, the ground grid,
 * the framing box, the laser's X and Y — is square with them. Coordinates are untouched: a
 * readout is still the file's own world point.
 *
 * ρ is a pure function of **every loaded model**, and the same number to the bit whatever order
 * they were opened in:
 *
 *  1. **The grids.** Every grid segment of every model at least `GRID_EXTENT_MIN` long (the
 *     2.5 m rule that keeps a direction-only `IfcLine` out of the grid extent) votes for its
 *     direction, weighted by its length, folded modulo 90° — a grid family and the one square to
 *     it are the same plan — by the standard 4θ circular mean: ρ = atan2(Σ L sin 4θ, Σ L cos 4θ) / 4,
 *     in (−45°, 45°]. The votes are **sorted canonically** — by model key, grid name, then the
 *     endpoints — before they are summed, because a floating-point sum depends on its order.
 *  2. **No grids** (or votes that cancel): the spatial-root `IfcSite` rotation, folded the same
 *     way, that the most elements share across the loaded models — a model with no turned site
 *     votes 0° — ties broken by the smallest model key.
 *  3. Nothing at all: 0.
 *
 * A result within `SQUARE_EPSILON_DEG` of 0 is exactly 0, so an axis-aligned federation — the
 * design's own mock included — draws byte for byte what it drew before.
 */
import { GRID_EXTENT_MIN } from './annotate'
import type { Georeference } from './model-index.types'

/** One loaded model, as the rule reads it — `FederatedModel['meta']` fits. */
export interface PlanModel {
  modelKey: string
  grids: readonly { name: string; start: readonly [number, number]; end: readonly [number, number] }[]
  georef: Georeference
  counts: { elements: number }
}

/** Below this the plan is square with the world: 0, exactly. A millionth of a degree. */
export const SQUARE_EPSILON_DEG = 1e-6

const DEG = 180 / Math.PI

/**
 * An angle in degrees folded modulo 90° into (−45°, 45°], by the same 4θ form the mean uses, so
 * 45° stays 45° and 45.01° becomes −44.99°.
 */
export function foldQuarter(deg: number): number {
  const r = ((((deg + 45) % 90) + 90) % 90) - 45
  // `r` is in [−45, 45): −45 is the same plan as +45, which is the end the range keeps.
  return r === -45 ? 45 : r
}

const snap = (deg: number): number => (Math.abs(deg) < SQUARE_EPSILON_DEG ? 0 : deg)

/** `a` before `b` in plain code-unit order — never locale order, which can differ by machine. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

interface Vote {
  key: string
  name: string
  start: readonly [number, number]
  end: readonly [number, number]
}

const voteOrder = (a: Vote, b: Vote): number =>
  cmp(a.key, b.key) ||
  cmp(a.name, b.name) ||
  a.start[0] - b.start[0] ||
  a.start[1] - b.start[1] ||
  a.end[0] - b.end[0] ||
  a.end[1] - b.end[1]

/** The grids' own vote, in degrees, or `null` when they cast none (or cancel out). */
export function gridPlanRotationDeg(models: readonly PlanModel[]): number | null {
  const votes: Vote[] = []
  for (const m of models) for (const g of m.grids) votes.push({ key: m.modelKey, name: g.name, start: g.start, end: g.end })
  votes.sort(voteOrder)
  let c = 0
  let s = 0
  let w = 0
  for (const v of votes) {
    const dx = v.end[0] - v.start[0]
    const dy = v.end[1] - v.start[1]
    const len = Math.hypot(dx, dy)
    if (!(len >= GRID_EXTENT_MIN)) continue
    const a = 4 * Math.atan2(dy, dx)
    c += len * Math.cos(a)
    s += len * Math.sin(a)
    w += len
  }
  // Votes that cancel — two families exactly 45° apart and as long as each other — say nothing.
  if (!(w > 0) || Math.hypot(c, s) < 1e-9 * w) return null
  return snap(foldQuarter((Math.atan2(s, c) / 4) * DEG))
}

/** The site rotation the most elements share, folded, or 0 with no model. */
export function sitePlanRotationDeg(models: readonly PlanModel[]): number {
  const groups = new Map<string, { deg: number; weight: number; key: string }>()
  for (const m of models) {
    const site = m.georef.site
    const turn = site && site.pureZRotation !== false && typeof site.rotationDeg === 'number' ? site.rotationDeg : 0
    const deg = snap(foldQuarter(turn))
    // Grouped to 1e-4°, the precision every other angle here is kept to (`shared/georef.ts`).
    const at = deg.toFixed(4)
    const g = groups.get(at)
    if (!g) groups.set(at, { deg, weight: m.counts.elements, key: m.modelKey })
    else {
      g.weight += m.counts.elements
      if (cmp(m.modelKey, g.key) < 0) {
        g.key = m.modelKey
        g.deg = deg
      }
    }
  }
  let best: { deg: number; weight: number; key: string } | null = null
  for (const g of groups.values()) {
    if (!best || g.weight > best.weight || (g.weight === best.weight && cmp(g.key, best.key) < 0)) best = g
  }
  return best ? best.deg : 0
}

/** ρ, in degrees, anticlockwise about +Z, in (−45°, 45°]. */
export function planRotationDeg(models: readonly PlanModel[]): number {
  return gridPlanRotationDeg(models) ?? sitePlanRotationDeg(models)
}

/** A plan point turned by `rad` about the origin; the point itself, untouched, for 0. */
export function turnXY(p: readonly [number, number], rad: number): [number, number] {
  if (rad === 0) return [p[0], p[1]]
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]
}
