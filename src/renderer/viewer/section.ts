/**
 * The section planes — `design-reference/design/viewer-core.js` L224–256 (`setSection`, the
 * outline and the preview sheet), lifted out of `viewer-core.ts` now that a grid is a segment
 * rather than a constant coordinate.
 *
 * The cut itself is a TSL uniform pair per plane in `materials.ts` (`dot(p, n) + c >= 0` is
 * kept), so all this owns is the plane arithmetic, the accent outline, the translucent sheet the
 * design shows while `cut` is off, and the design's "the plane moved, so look at it" camera
 * re-aim.
 *
 * `shared/annotate.ts` holds the arithmetic: `planeFromSegment` generalises the design's two
 * axis branches to any angle, and the quad is the plane's own frame — the in-plane direction
 * over the footprint's extent, and z over the box — which reproduces the design's two literal
 * quads exactly for an axis-aligned grid.
 *
 * 2026-09-28 (owner-requested): a third object, the **cut outline** — where the plane meets
 * every visible element, in the accent, ~2.5 px wide. `section-cut.ts` computes the segments
 * and `viewer-core.ts` hands them to `setCut`; this file only draws them.
 *
 * 2026-10-01 (owner-requested: *"add the section cut along gridline as another cut also"*):
 * **two planes** — the gridline cut and the level cut — set together by `apply({ grid, level })`
 * and independent of each other. Each has its own outline quad and its own preview sheet, each
 * is the design's single plane arithmetic, and the model is kept where both cutting planes keep
 * it. The design's re-aim rule (L253) is applied **per plane**: a plane that starts cutting, or
 * whose kind, name or flip changed while cutting, re-aims the camera at itself; an offset, a
 * clear, or anything the *other* plane does never re-aims. If both moved in one call — a
 * restore — the camera is re-aimed once, at the gridline plane. One cut outline serves both.
 */
import type { Box3, Material, Object3D } from 'three/webgpu'
import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Line,
  Mesh,
  Vector3
} from 'three/webgpu'
import { planeFromLevel, planeFromSegment, type XY } from '../../shared/annotate'
import type { CutPlane } from './section-cut'

/** `viewer-core.js` L235. How far past the box the outline and the sheet reach. */
export const SECTION_MARGIN = 1.5

/**
 * The cut outline's place in the **opaque** list: after the batches (0), so it depth-tests
 * against every solid, and before the ground veil (`scene.ts`, 10), so below grade it is dimmed
 * with the parts it outlines.
 */
export const RENDER_ORDER_CUT = 5

/** One plane, as the design's `setSection` takes it. */
export interface SectionConfig {
  kind: 'grid' | 'storey'
  name: string
  /** Metres along the plane normal, as the design's card supplies it (mm ÷ 1000). */
  offset?: number
  flip?: boolean
  /** `false` previews the plane as a translucent sheet without cutting. */
  cut?: boolean
}

/** Both planes at once (2026-10-01): the gridline cut and the level cut, each set or `null`. */
export interface SectionsConfig {
  grid: SectionConfig | null
  level: SectionConfig | null
}

/** The two slots, in the order everything indexes them by: materials' clip 0 and 1. */
export const SECTION_SLOTS = ['grid', 'level'] as const

/** One grid axis in scene coordinates: a name and the two plan endpoints of its own curve. */
export interface GridSegment {
  name: string
  p0: XY
  p1: XY
}

export interface SectionHost {
  bbox: Box3
  /** `radius / 27.5` — `SECTION_MARGIN` is the reference's value × this. */
  scale(): number
  grids(): readonly GridSegment[]
  storeys(): readonly { name: string; elev: number }[]
  /**
   * The cutting plane of each slot (`SECTION_SLOTS` order), or `null` where that slot is not
   * cutting — cleared, previewed, or naming a grid or storey the federation does not have.
   * Called once on every apply.
   */
  setClips(planes: readonly (CutPlane | null)[]): void
  /** The design's `viewDir(n.negate()); fitBox(bbox); on.cubeView()` (L254). */
  reaim(normal: Vector3): void
}

export interface SectionVisuals {
  /** Every object, for the scene to add and remove in one go. */
  objects: Object3D[]
  /** The live configuration of both planes — what `debug()` reports. */
  readonly current: SectionsConfig
  /** Objects drawn — the outlines, the sheets and the cut outline; the draw count reads it. */
  readonly drawn: number
  apply(cfg: SectionsConfig): void
  /** Re-apply the current configuration — the box or the grid set has changed. */
  refresh(): void
  /**
   * Replace the cut outline: `count` segments, six floats each, or none. The previous
   * geometry is disposed here, every time.
   */
  setCut(segments: Float32Array | null, count: number): void
  dispose(): void
}

const _n = new Vector3()

/** The quad's four corners, in the design's order: (tmin, zmin) → (tmax, zmin) → … */
function quadFor(
  dir: XY,
  nrm: XY,
  at: number,
  corners: readonly XY[],
  zMin: number,
  zMax: number,
  margin: number
): number[][] {
  let tMin = Infinity
  let tMax = -Infinity
  for (const c of corners) {
    const t = c[0] * dir[0] + c[1] * dir[1]
    if (t < tMin) tMin = t
    if (t > tMax) tMax = t
  }
  tMin -= margin
  tMax += margin
  // A point on the plane at in-plane coordinate `t`: {dir, nrm} is an orthonormal plan frame.
  const xy = (t: number): XY => [dir[0] * t + nrm[0] * at, dir[1] * t + nrm[1] * at]
  const a = xy(tMin)
  const b = xy(tMax)
  return [
    [a[0], a[1], zMin - margin],
    [b[0], b[1], zMin - margin],
    [b[0], b[1], zMax + margin],
    [a[0], a[1], zMax + margin]
  ]
}

/**
 * One draw for every segment: three's fat-line layout (`examples/jsm/lines/LineSegmentsGeometry.js`
 * — the same eight-vertex template, the same `instanceStart` / `instanceEnd` pair), which
 * `Line2NodeMaterial` expands to a screen-space ribbon with round caps. It is written out here
 * rather than imported because that example imports the classic `three` entry.
 */
function cutGeometry(segments: Float32Array | null, count: number): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry()
  g.setIndex([0, 2, 1, 2, 3, 1, 2, 4, 3, 4, 5, 3, 4, 6, 5, 6, 7, 5])
  g.setAttribute(
    'position',
    new Float32BufferAttribute([-1, 2, 0, 1, 2, 0, -1, 1, 0, 1, 1, 0, -1, 0, 0, 1, 0, 0, -1, -1, 0, 1, -1, 0], 3)
  )
  g.setAttribute('uv', new Float32BufferAttribute([-1, 2, 1, 2, -1, 1, 1, 1, -1, -1, 1, -1, -1, -2, 1, -2], 2))
  if (segments && count > 0) {
    const buf = new InstancedInterleavedBuffer(segments, 6, 1)
    g.setAttribute('instanceStart', new InterleavedBufferAttribute(buf, 3, 0))
    g.setAttribute('instanceEnd', new InterleavedBufferAttribute(buf, 3, 3))
  }
  g.instanceCount = segments ? count : 0
  return g
}

export function createSection(
  host: SectionHost,
  materials: { section: Material; sectionSheet: Material; sectionCut: Material }
): SectionVisuals {
  // Per plane — five points: the quad, closed. Six: two triangles over the same four corners
  // (L229). Both planes share the two materials; neither is clip-gated, as the reference's
  // are not, so a plane's outline and sheet stay whole where the other plane cuts.
  const visuals = SECTION_SLOTS.map(() => {
    const line = new Line(
      new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(15), 3)),
      materials.section
    )
    const sheet = new Mesh(
      new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(18), 3)),
      materials.sectionSheet
    )
    line.visible = false
    sheet.visible = false
    sheet.renderOrder = 3
    line.frustumCulled = false
    sheet.frustumCulled = false
    return { line, sheet }
  })
  // The template's own bounds are a unit quad at the origin, so three must not cull it; it
  // casts nothing, and nothing picks it — the picker walks the batches only (`picking.ts`).
  const cut = new Mesh(cutGeometry(null, 0), materials.sectionCut)
  cut.visible = false
  cut.frustumCulled = false
  cut.renderOrder = RENDER_ORDER_CUT

  let current: SectionsConfig = { grid: null, level: null }

  /** One plane against the live box, grids and storeys — or `null`: nothing to cut or draw. */
  const planeOf = (cfg: SectionConfig): (CutPlane & { quad: number[][] }) | null => {
    const box = host.bbox
    if (box.isEmpty()) return null
    const margin = SECTION_MARGIN * host.scale()
    if (cfg.kind === 'grid') {
      const g = host.grids().find((x) => x.name === cfg.name)
      if (!g) return null
      const centre = box.getCenter(new Vector3())
      const plane = planeFromSegment(g.p0, g.p1, cfg.offset || 0, !!cfg.flip, [centre.x, centre.y])
      if (!plane) return null
      const corners: XY[] = [
        [box.min.x, box.min.y],
        [box.max.x, box.min.y],
        [box.max.x, box.max.y],
        [box.min.x, box.max.y]
      ]
      return {
        n: plane.n,
        c: plane.c,
        quad: quadFor(plane.dir, plane.nrm, plane.at, corners, box.min.z, box.max.z, margin)
      }
    }
    const s = host.storeys().find((x) => x.name === cfg.name)
    if (!s) return null
    const v = s.elev + (cfg.offset || 0)
    const plane = planeFromLevel(v, !!cfg.flip)
    return {
      n: plane.n,
      c: plane.c,
      quad: [
        [box.min.x - margin, box.min.y - margin, v],
        [box.max.x + margin, box.min.y - margin, v],
        [box.max.x + margin, box.max.y + margin, v],
        [box.min.x - margin, box.max.y + margin, v]
      ]
    }
  }

  const apply = (next: SectionsConfig, previous = current): void => {
    current = next
    const clips: (CutPlane | null)[] = []
    /** The normal of the first plane that moved, in slot order — so the gridline plane wins. */
    let aim: CutPlane['n'] | null = null
    for (let i = 0; i < SECTION_SLOTS.length; i++) {
      const slot = SECTION_SLOTS[i]
      const { line, sheet } = visuals[i]
      line.visible = false
      sheet.visible = false
      const cfg = next[slot]
      const plane = cfg && planeOf(cfg)
      if (!cfg || !plane) {
        clips.push(null)
        continue
      }
      const { quad } = plane
      const cutting = cfg.cut !== false
      clips.push(cutting ? { n: plane.n, c: plane.c } : null)

      const pa = line.geometry.getAttribute('position') as BufferAttribute
      quad.forEach((p, k) => pa.setXYZ(k, p[0], p[1], p[2]))
      pa.setXYZ(4, quad[0][0], quad[0][1], quad[0][2])
      pa.needsUpdate = true
      line.visible = true

      const sp = sheet.geometry.getAttribute('position') as BufferAttribute
      ;[0, 1, 2, 0, 2, 3].forEach((k, j) => sp.setXYZ(j, quad[k][0], quad[k][1], quad[k][2]))
      sp.needsUpdate = true
      sheet.visible = !cutting

      // L253, per plane: it only moved if it is cutting *and* something about it changed. An
      // offset alone is not a move, which is why nudging by ±500 mm does not re-aim the camera
      // — and neither does anything the other plane does.
      const prev = previous[slot]
      const moved =
        cutting &&
        (!prev ||
          prev.cut === false ||
          prev.kind !== cfg.kind ||
          prev.name !== cfg.name ||
          !!prev.flip !== !!cfg.flip)
      if (moved && !aim) aim = plane.n
    }
    host.setClips(clips)
    if (aim) host.reaim(_n.set(-aim[0], -aim[1], -aim[2]))
  }

  return {
    objects: [...visuals.flatMap((v) => [v.line, v.sheet]), cut],
    get current() {
      return current
    },
    get drawn() {
      let n = cut.visible ? 1 : 0
      for (const v of visuals) n += (v.line.visible ? 1 : 0) + (v.sheet.visible ? 1 : 0)
      return n
    },
    apply: (cfg) => apply(cfg),
    // The same configuration against a new box: pass it as its own predecessor so nothing
    // "moved" and a model arriving does not steal the camera.
    refresh: () => apply(current, current),
    setCut: (segments, count) => {
      const old = cut.geometry
      cut.geometry = cutGeometry(segments, count)
      old.dispose()
      cut.visible = !!segments && count > 0
    },
    dispose: () => {
      for (const v of visuals) {
        v.line.geometry.dispose()
        v.sheet.geometry.dispose()
      }
      cut.geometry.dispose()
      cut.dispose()
    }
  }
}
