/**
 * 2026-11-11 — an element's box **square with the building**, beside `IfcElement.bbox` (the
 * owner's "option A").
 *
 * Since 2026-11-07 every model is drawn at its file's own world coordinates and only the camera's
 * plan frame turns by ρ (`shared/plan-rotation.ts`). `IfcElement.bbox` is the world-axis box, so
 * on a building turned 43° a 6.0 × 0.1 m wall's box is 4.4 × 4.2 m. The property card reads
 * `viewer.elementPlanBox(id)` — the element's own vertices turned by −ρ about the scene origin —
 * and this module hands the assistant's box tools and the SQL `plan_box` table the same box, so
 * the card and the assistant cannot disagree. It walks no vertex of its own: the viewer's rule
 * is the only one.
 *
 * **Plan coordinates** `(u, v, z)` are a world point turned by −ρ about the world Z axis through
 * the world origin: `u = x·cos ρ + y·sin ρ`, `v = −x·sin ρ + y·cos ρ`, z unchanged — which is the
 * viewer's plan box (scene coordinates) plus the federation offset turned the same way. They
 * compare only with other plan coordinates of the same ρ.
 *
 * At ρ = 0 the frame is `'world'` and a box is the element's own `bbox` array, the same reference,
 * so nothing an unturned building's tools report can drift by a rounding.
 */

/** `[minX, minY, minZ, maxX, maxY, maxZ]`, metres. */
export type Box6 = readonly [number, number, number, number, number, number]

/** What one tool call reads boxes through. */
export interface PlanFrame {
  frame: 'world' | 'plan'
  rotationDeg: number
  /** The element's box in this frame; `null` only for an element with no geometry. */
  box(e: { id: number; bbox?: Box6 }): Box6 | null
}

/** The one viewer method this reads — `Viewer.elementPlanBox`, structurally. */
interface PlanBoxSource {
  elementPlanBox(id: number): { box: { min: Vec; max: Vec }; rho: number } | null
}
interface Vec {
  x: number
  y: number
  z: number
}

/** A viewer's ρ (radians) counts as this frame's when it is the same angle to the last bits. */
const RHO_TOL = 1e-12

/**
 * The frame one tool call reads, from the store's `planRotationDeg` and `offset` and the live
 * viewer. A box the viewer has none for at this ρ — no viewer, `null`, or a box taken for another
 * rotation — is the plan-coordinate box of the world box's four footprint corners: larger than
 * the element, never smaller, never `null`.
 */
export function planFrameOf(
  rotationDeg: number,
  offset: readonly number[],
  viewer: PlanBoxSource | null
): PlanFrame {
  if (rotationDeg === 0) return { frame: 'world', rotationDeg: 0, box: (e) => e.bbox ?? null }
  const rho = (rotationDeg * Math.PI) / 180
  const c = Math.cos(rho)
  const s = Math.sin(rho)
  // The offset turned by −ρ: what takes a scene-plan point to plan coordinates.
  const t = [offset[0] * c + offset[1] * s, -offset[0] * s + offset[1] * c, offset[2]]
  const seen = new Map<number, Box6>()
  const fromViewer = (id: number): Box6 | null => {
    // A stand-in viewer may answer `undefined`; only a box for this very ρ is read.
    const got = viewer?.elementPlanBox(id)
    if (!got || Math.abs(got.rho - rho) > RHO_TOL) return null
    const { min, max } = got.box
    return [min.x + t[0], min.y + t[1], min.z + t[2], max.x + t[0], max.y + t[1], max.z + t[2]]
  }
  const footprint = (b: Box6): Box6 => {
    let u0 = Infinity
    let v0 = Infinity
    let u1 = -Infinity
    let v1 = -Infinity
    for (const [x, y] of [
      [b[0], b[1]],
      [b[3], b[1]],
      [b[0], b[4]],
      [b[3], b[4]]
    ]) {
      const u = x * c + y * s
      const v = -x * s + y * c
      u0 = Math.min(u0, u)
      u1 = Math.max(u1, u)
      v0 = Math.min(v0, v)
      v1 = Math.max(v1, v)
    }
    return [u0, v0, b[2], u1, v1, b[5]]
  }
  return {
    frame: 'plan',
    rotationDeg,
    box: (e) => {
      if (!e.bbox) return null
      let b = seen.get(e.id)
      if (!b) {
        b = fromViewer(e.id) ?? footprint(e.bbox)
        seen.set(e.id, b)
      }
      return b
    }
  }
}

/**
 * The SQL index's `plan_box` rows (`worker/sql-schema.ts`): one id and six plan coordinates per
 * element that has a box, in `elements` order. `undefined` for the world frame, where `plan_box`
 * is `bbox` itself.
 */
export function planBoxRows(
  frame: PlanFrame,
  elements: readonly { id: number; bbox?: Box6 }[]
): { rotationDeg: number; ids: Float64Array; boxes: Float64Array } | undefined {
  if (frame.frame === 'world') return undefined
  const ids: number[] = []
  const boxes: number[] = []
  for (const e of elements) {
    const b = frame.box(e)
    if (!b) continue
    ids.push(e.id)
    boxes.push(...b)
  }
  return { rotationDeg: frame.rotationDeg, ids: new Float64Array(ids), boxes: new Float64Array(boxes) }
}
