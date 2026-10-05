/**
 * Everything the viewer draws that is not the model — `design-reference/design/viewer-core.js`
 * L168–222 (grids and levels), L361–428 (the laser meter and spot coordinates) and L430–483
 * (selection dimensions), ported as written.
 *
 * Three-dimensional geometry is `three`; every readable label is a DOM element in
 * `[data-role="overlay"]` (`overlay.ts`), which is what gives it the shell's own type, borders
 * and shadows. `shared/annotate.ts` holds the arithmetic, so the rules — the padding, the
 * family grouping, the elevation test, the near-side bubble, the label-placement search, which
 * laser rays are fired — are unit-tested on numbers rather than on a screenshot.
 *
 * **What is not the design's, and why.**
 *
 * · A grid is a **segment**, not `{ axis: 'x' | 'y', v }`. The design's mock federation is
 *   axis-aligned; a real `IfcGridAxis` is a curve, and the 137.9 MB reference model's grid runs
 *   at ~43° with no axis-aligned axis at all. The drawn line is the grid's own infinite line
 *   clipped to the padded footprint, which for an axis-aligned grid is the design's literal
 *   endpoints. Since 2026-09-24 that footprint is the grids' own authored extent (else the
 *   building's), not the whole model's — a site must not carry the bubbles away. See
 *   `shared/annotate.ts` for the family, near-end and plan-normal conventions.
 * · The design builds all of this once, because its renderer is handed a finished federation.
 *   Ours is streamed, so `rebuild()` re-derives the lines, rings and tags whenever the box, the
 *   grid set or the storey ladder changes, carrying the on/off state across.
 * · Spot coordinates report the **file's** coordinates, not the scene's: the geometry pipeline
 *   subtracts whole metres so float32 resolves millimetres 33 km out, and `offset()` adds them
 *   back — the same correction the property card's Base / top and Centroid rows make. With no
 *   base point in the file the E/N/Z rows show the design's em dash rather than an origin
 *   nobody authored.
 * · A spot tag shows its **level only** (`▽ +10.500`) until it is clicked, and a click toggles
 *   it to the design's full grid and back (2026-09-28, owner-requested).
 * · Scene-scale constants (the bubble gap, the stem drop, the laser's reach, the section
 *   margin) are the reference's value × `radius / 27.5`, as everything in `scene.ts` is. The
 *   footprint padding and the dimension stand-off are **not**: both are already
 *   footprint-relative with an absolute clearance floor.
 */
import type { Box3, Group as GroupType, Object3D } from 'three/webgpu'
import { BufferAttribute, BufferGeometry, Group, Line, LineSegments, Vector2, Vector3 } from 'three/webgpu'
import {
  BUBBLE_GAP,
  DIM_RUN_DIRS,
  DIM_TICK_FRACTION,
  LABEL_HALF_H,
  LABEL_HALF_W,
  LASER_AXES,
  LASER_FAR,
  LASER_LIFT,
  LASER_MIN_DISTANCE,
  LASER_SELF_DISTANCE,
  LEVEL_TAG_DX,
  STEM_DROP,
  canonicalDir,
  clipLineToRect,
  dimLabelRect,
  dimOffset,
  gridDimOffset,
  gridDimRuns,
  gridDimStandoffPx,
  gridFamilies,
  gridExtentRect,
  isElevation,
  keepFamily,
  laserDirections,
  laserLabelOffset,
  levelTagAnchor,
  levelTagHtml,
  nearEndSign,
  padRect,
  placeDimLabel,
  spotGridHtml,
  spotLevelHtml,
  type DimRect,
  type GridDimRun,
  type LaserAxis,
  type Rect,
  type XY
} from '../../shared/annotate'
import { fmtMM, mmPlain, mmTxt } from '../../shared/fmt'
import { toMap, type BasePoint } from '../../shared/georef'
import type { Materials } from './materials'
import type { Label, LabelOverlay, ViewerCamera } from './overlay'
import { toPixels } from './overlay'
import type { GridSegment } from './section'

/* ────────────────────────────── shapes the shell reads ────────────────────────────── */

/**
 * One committed laser measurement, as `on.measure` hands it over (`viewer-core.js` L397).
 * `x` / `y` / `z` are the **lengths** the three rays read, in metres, and absent for an axis
 * that had no reading at all. `p` is the origin in **scene** coordinates, which is what
 * `focusPoint` takes back.
 */
export interface MeasureRecord {
  id: number
  p: [number, number, number]
  x?: number
  y?: number
  z?: number
}

/**
 * One spot coordinate, as `on.spot` hands it over (L412). `p` is the **scene** point;
 * `x` / `y` / `z` are the same point in the **file's** own coordinates, and `E` / `N` / `Z` its
 * map coordinates — `null` when the file states no base point.
 */
export interface SpotRecord {
  id: number
  p: [number, number, number]
  E: number | null
  N: number | null
  Z: number | null
  x: number
  y: number
  z: number
}

/** What became of a request to set a spot tag's state (`showSpot`). */
export type SpotShown = 'changed' | 'already' | 'missing'

/** One ray of a measurement: the two ends it hit and the distance between them. */
export interface LaserRay {
  axis: LaserAxis
  a: Vector3
  b: Vector3
  len: number
}

export interface AnnotationHost {
  overlay: LabelOverlay
  materials: Materials
  /** The federation's box, in scene coordinates. Live — `rebuild()` re-reads it. */
  bbox: Box3
  /** `radius / 27.5`. */
  scale(): number
  /**
   * The **building** box (2026-09-24): every element's box but the site's (`shared/site.ts`),
   * or the whole box when nothing else is left. Live. The level rings, the bubbles' gap and
   * lift, and the grid fallback are sized from it, so a large site cannot push them away.
   */
  frame: Box3
  /** `scale()` for `frame`. */
  frameScale(): number
  /** Z of the ground plane; the reference's literal z = 0. */
  groundZ(): number
  camera(): ViewerCamera
  /**
   * The camera controller's own `cur.theta` / `cur.phi` — the azimuth and the inclination of
   * where the camera sits relative to what it looks at, which is what the design's
   * `updateGridView` reads (L198–200).
   */
  view(): { theta: number; phi: number }
  size(): { w: number; h: number }
  grids(): readonly GridSegment[]
  /** `elev` is the scene height the ring is drawn at; `authored` is what the tag prints. */
  storeys(): readonly { name: string; elev: number; authored: number }[]
  elementBox(id: number): Box3 | null
  isVisible(id: number): boolean
  /** Nearest hit along a world ray, section-clipped — `picking.ts`. */
  ray(
    origin: Vector3,
    dir: Vector3,
    far: number,
    near: number
  ): { id: number; point: Vector3; distance: number } | null
  /** Whole metres the geometry pipeline subtracted from every placement. */
  offset(): readonly [number, number, number]
  /** Ask for a frame: a label changed in a way only `overlay.update` places (2026-09-28). */
  invalidate(): void
  on: {
    measure?: (list: MeasureRecord[]) => void
    spot?: (list: SpotRecord[]) => void
    gridClick?: (name: string) => void
  }
}

export interface Annotations {
  /** Added to the scene once; holds the grid, level, measure and dimension sub-groups. */
  group: GroupType
  /** Re-derive grid lines, bubbles, level rings and tags. Box / grids / storeys changed. */
  rebuild(): void
  setGrids(b: boolean): void
  setLevels(b: boolean): void
  /** `updateGridView`, L197–213. Called every frame; memoised on the camera. */
  updateGridView(force?: boolean): void
  /**
   * Place the dimensions between gridlines for the camera about to be drawn (2026-09-24). Their
   * stand-off from the bubble row is a fixed screen distance, so it moves with the zoom; call it
   * before `renderer.render` on every drawn frame.
   */
  placeGridDims(): void
  /**
   * True when the declutter sweep or the occlusion test has, since `placeGridDims`, hidden or
   * restored a label whose run was drawn the other way — the caller then draws one more frame.
   */
  gridDimsStale(): boolean
  /** `setCoords`, L428: re-render every spot label and re-publish the list. */
  setCoords(c: BasePoint): void
  /** L398. A click with the laser tool. */
  addLaser(p: Vector3, normal: Vector3 | null, selfId: number): void
  /** L413. A click with the spot tool. */
  addSpot(p: Vector3): void
  /** L615–617. The live preview under the pointer. */
  previewLaser(p: Vector3, normal: Vector3 | null, selfId: number): void
  /** L619 and L531: drop the preview and its reading. */
  clearPreview(): void
  clearMeasures(): void
  clearSpots(): void
  dropMeasure(id: number): void
  dropSpot(id: number): void
  /**
   * 2026-10-02 — one spot tag's state, set: `full` its E / N / Z grid, otherwise its level
   * alone. What a click on the tag toggles, through the same function. Says whether anything
   * changed, or that no spot has that id.
   */
  showSpot(id: number, full: boolean): SpotShown
  /** L751. */
  setDims(ids: readonly number[] | null, on?: boolean | null, avoid?: readonly DimRect[]): void
  /** L440. Re-place the dimension labels — a visibility change or a new selection. */
  drawDims(): void
  readonly measureCount: number
  readonly spotCount: number
  /** Objects this module will submit, for the draw count. */
  drawObjects(): number
  debug(): Record<string, unknown>
  dispose(): void
}

/* ────────────────────────────── label styles, L176, L145, L393–394 ────────────────────────────── */

const BUBBLE_STYLE: Partial<CSSStyleDeclaration> = {
  width: '26px',
  height: '26px',
  padding: '0',
  boxSizing: 'border-box',
  borderRadius: '50%',
  lineHeight: '24px',
  textAlign: 'center',
  fontWeight: '500',
  fontSize: '11.5px',
  color: 'var(--ink)',
  pointerEvents: 'auto',
  cursor: 'pointer',
  userSelect: 'none'
}
const DOT_STYLE: Partial<CSSStyleDeclaration> = {
  width: '7px',
  height: '7px',
  borderRadius: '50%',
  background: 'var(--accent)',
  border: '2px solid var(--card)'
}
const ORIGIN_STYLE: Partial<CSSStyleDeclaration> = {
  width: '9px',
  height: '9px',
  borderRadius: '2px',
  background: 'var(--card)',
  border: '2px solid var(--accent)'
}
/**
 * L413 — the spot tag's look, plus (2026-09-28) the grid bubble's own three clickable-label
 * properties (L176), because a click on the tag now toggles it.
 */
const SPOT_STYLE: Partial<CSSStyleDeclaration> = {
  lineHeight: '1.3',
  padding: '6px 8px',
  pointerEvents: 'auto',
  cursor: 'pointer',
  userSelect: 'none'
}
/** L413. The expanded tag's offset from its point, in pixels: its corner sits on the dot. */
const SPOT_GRID_OFFSET = { dx: 70, dy: -34 }
/**
 * 2026-09-28. The collapsed tag's offset, chosen the same way: the design's (70, −34) puts the
 * grid's bottom-left corner 6.5 px left of and 7 px below the dot, and this puts a
 * `▽ +10.500` tag's corner there too, so a click grows the tag from the corner it stands on.
 */
const SPOT_LEVEL_OFFSET = { dx: 33, dy: -7 }

/** L395. */
const rayHtml = (r: LaserRay): string =>
  `<span style="color:var(--faint)">${r.axis}</span>&nbsp;` +
  `<b style="font-weight:500;color:var(--ink)">${fmtMM(r.len)}</b>`

/** L617. */
const liveHtml = (rays: readonly LaserRay[]): string =>
  rays
    .map(
      (r) =>
        `<span style="color:var(--faint)">${r.axis}</span> ` +
        `<b style="font-weight:500">${mmPlain(r.len)}</b>`
    )
    .join('<span style="color:var(--border-strong)"> · </span>') +
  '<span style="color:var(--faint)"> mm</span>'

/* ────────────────────────────── internals ────────────────────────────── */

interface GridEnd {
  label: Label
  stem: Line
  /** `+1` is the segment's `p1` end, `−1` its `p0` end. */
  sign: 1 | -1
}
interface GridRecord {
  name: string
  p0: XY
  p1: XY
  family: number
  line: Line
  ends: GridEnd[]
}
interface Measurement {
  id: number
  p: Vector3
  rays: LaserRay[]
  lines: Line[]
  labels: Label[]
}
interface Spot {
  id: number
  p: Vector3
  labels: Label[]
  /** 2026-09-28: showing the full grid rather than the level only. Per spot, session only. */
  expanded: boolean
}

const _px = new Vector2()
const _origin = new Vector3()
const _dir = new Vector3()
const _mid = new Vector3()
/** L367. The three axes, as unit vectors. */
const AXIS_VECTORS: Record<LaserAxis, Vector3> = {
  X: new Vector3(1, 0, 0),
  Y: new Vector3(0, 1, 0),
  Z: new Vector3(0, 0, 1)
}
const Z_UP = new Vector3(0, 0, 1)

export function createAnnotations(host: AnnotationHost): Annotations {
  const { overlay, materials } = host
  const group = new Group()
  const gridGroup = new Group()
  const levelGroup = new Group()
  const measGroup = new Group()
  const dimGroup = new Group()
  group.add(gridGroup, levelGroup, measGroup, dimGroup)
  levelGroup.visible = false

  let gridsOn = true
  let levelsOn = false
  let gridKey = ''
  let pad = 0
  let coords: BasePoint = { E: null, N: null, Z: null, angle: null }

  const gridRecs: GridRecord[] = []
  let famDirs: XY[] = []
  /** The dimensions between adjacent parallel gridlines: one run, one label each. */
  let gridDims: { run: GridDimRun; label: Label; halfW: number; halfH: number }[] = []
  /** All their lines and ticks in one draw; rewritten by `placeGridDims`. */
  let gridDimSegs: LineSegments | null = null
  /** The gridlines' z and the bubble gap, from the last `rebuild`. */
  let gridZ = 0
  let gridGap = 0
  const levelLines: Line[] = []
  let levelLabels: Label[] = []

  /* ── the live laser preview, L366 ──────────────────────────────────────── */
  const laserGeom = new BufferGeometry().setAttribute(
    'position',
    new BufferAttribute(new Float32Array(18), 3)
  )
  const laser = new LineSegments(laserGeom, materials.laserPreview)
  laser.visible = false
  laser.renderOrder = 5
  laser.frustumCulled = false
  group.add(laser)

  /** L391. The reading that follows the pointer. */
  const liveLabel = overlay.mkLabel(
    new Vector3(),
    '',
    { ...overlay.labelBase(), color: 'var(--ink)', borderColor: 'var(--accent)' },
    0,
    -22
  )
  liveLabel.on = false

  const measures: Measurement[] = []
  const spots: Spot[] = []
  let mid = 0

  let dimIds: number[] = []
  let dimOn = false
  let dimAvoid: readonly DimRect[] = []
  let dimLabels: Label[] = []

  /** What the live preview last read, for `debug()` — nothing visible depends on it. */
  let preview: { axis: LaserAxis; len: number }[] = []

  const toPx = (p: Vector3): Vector2 => {
    const { w, h } = host.size()
    return toPixels(p, host.camera(), w, h, _px)
  }

  /* ────────────────────────────── grids and levels ────────────────────────────── */

  const clearGrids = (): void => {
    for (const r of gridRecs) {
      gridGroup.remove(r.line)
      r.line.geometry.dispose()
      for (const e of r.ends) {
        e.label.remove()
        gridGroup.remove(e.stem)
        e.stem.geometry.dispose()
      }
    }
    gridRecs.length = 0
    famDirs = []
    for (const d of gridDims) d.label.remove()
    gridDims = []
    if (gridDimSegs) {
      gridGroup.remove(gridDimSegs)
      gridDimSegs.geometry.dispose()
      gridDimSegs = null
    }
  }

  const clearLevels = (): void => {
    for (const l of levelLines) {
      levelGroup.remove(l)
      l.geometry.dispose()
    }
    levelLines.length = 0
    for (const l of levelLabels) l.remove()
    levelLabels = []
  }

  const buildGrids = (rect: Rect, lineZ: number, stemTop: number, gap: number): void => {
    const segments = host.grids()
    const dirs = segments.map((g) => canonicalDir(g.p0, g.p1))
    const grouped = gridFamilies(dirs)
    famDirs = grouped.dirs

    segments.forEach((g, i) => {
      const dir = dirs[i]
      if (dir[0] === 0 && dir[1] === 0) return
      const span = clipLineToRect(g.p0, dir, rect)
      if (!span) return
      const [a, b] = span
      // Drawn on to each bubble's centre (2026-09-24), so the line meets the bubble's edge at
      // every zoom; the bubble's opaque card covers the part inside it. `p0` / `p1` below stay
      // the clipped ends, which is what every rule that reads them means.
      const line = new Line(
        new BufferGeometry().setFromPoints([
          new Vector3(a[0] - dir[0] * gap, a[1] - dir[1] * gap, lineZ),
          new Vector3(b[0] + dir[0] * gap, b[1] + dir[1] * gap, lineZ)
        ]),
        materials.gridLine
      )
      gridGroup.add(line)
      const rec: GridRecord = { name: g.name, p0: a, p1: b, family: grouped.family[i], line, ends: [] }

      // L182: a bubble sits `BUBBLE_GAP` beyond each end, along the line.
      const ends: { at: XY; sign: 1 | -1 }[] = [
        { at: [a[0] - dir[0] * gap, a[1] - dir[1] * gap], sign: -1 },
        { at: [b[0] + dir[0] * gap, b[1] + dir[1] * gap], sign: 1 }
      ]
      for (const { at, sign } of ends) {
        const label = overlay.mkLabel(new Vector3(at[0], at[1], lineZ), g.name, {
          ...overlay.labelBase(),
          ...BUBBLE_STYLE
        })
        label.el.title = `Show plane of grid ${g.name}`
        label.occlude = true
        // Each end of each family is its own row, and the axis's own order decides who wins
        // when a real grid puts more bubbles along a row than there is room for.
        label.declutter = { row: `${rec.family}:${sign}`, order: i }
        label.el.addEventListener('click', (e) => {
          e.stopPropagation()
          host.on.gridClick?.(g.name)
        })
        label.el.addEventListener('pointerenter', () => {
          label.el.style.borderColor = 'var(--accent)'
          label.el.style.color = 'var(--accent-ink)'
        })
        label.el.addEventListener('pointerleave', () => {
          label.el.style.borderColor = 'var(--border-strong)'
          label.el.style.color = 'var(--ink)'
        })
        // L185: the elevation-view stem, from the ground up to the lifted bubble.
        const stem = new Line(
          new BufferGeometry().setFromPoints([
            new Vector3(at[0], at[1], lineZ),
            new Vector3(at[0], at[1], stemTop)
          ]),
          materials.gridLine
        )
        stem.visible = false
        gridGroup.add(stem)
        rec.ends.push({ label, stem, sign })
      }
      gridRecs.push(rec)
    })
    buildGridDims(lineZ, gap)
  }

  /**
   * The dimensions between gridlines (2026-09-24, owner-requested): the selection dimension's
   * own material, tick share and label look, one run per adjacent parallel pair, at the start
   * end of each family (`shared/annotate.ts`, `gridDimRuns`).
   */
  const buildGridDims = (lineZ: number, gap: number): void => {
    gridZ = lineZ
    gridGap = gap
    const runs = gridDimRuns(gridRecs, gap)
    if (!runs.length) return
    const labels = runs.map((run, k) => {
      const label = overlay.mkLabel(new Vector3(run.at[0], run.at[1], lineZ), mmTxt(run.spacing), {
        ...overlay.labelBase(),
        color: 'var(--ink)',
        borderColor: 'var(--accent)',
        fontWeight: '500'
      })
      // Decided after every bubble, by the bubbles' own greedy rule (`declutterBubbles`), and
      // hidden behind the building exactly as a bubble is.
      label.declutter = { row: `dim:${run.family}`, order: k, after: true }
      label.occlude = true
      label.on = false
      // Laid out but invisible, so its box can be measured — below, all at once.
      label.el.style.visibility = 'hidden'
      label.el.style.display = ''
      return label
    })
    // Each label's own box, measured once — the stand-off needs it before the label is ever
    // drawn, and the text never changes. Every write above and below, every read here: one
    // layout for all of them rather than one per label (refactor pass 2).
    const boxes = labels.map((label) => ({
      halfW: (label.el.offsetWidth || 2 * LABEL_HALF_W) / 2,
      halfH: (label.el.offsetHeight || 2 * LABEL_HALF_H) / 2
    }))
    gridDims = labels.map((label, k) => {
      label.el.style.display = 'none'
      label.el.style.visibility = ''
      return { run: runs[k], label, ...boxes[k] }
    })
    // Six vertices a run: the run itself, then a tick across each grid.
    const geom = new BufferGeometry().setAttribute(
      'position',
      new BufferAttribute(new Float32Array(runs.length * 18), 3)
    )
    gridDimSegs = new LineSegments(geom, materials.dim)
    // Rewritten every frame, so its bounding sphere is never current.
    gridDimSegs.frustumCulled = false
    gridGroup.add(gridDimSegs)
  }

  const _a = new Vector2()
  /** Which runs the last `placeGridDims` drew, so `gridDimsStale` can ask for one more frame. */
  let dimDrawn: boolean[] = []
  /**
   * A run is drawn only while its label is: not in an elevation (the bubbles are lifted over
   * the roof there and the runs would be left on the ground), and not hidden by the declutter
   * sweep or by the building. The label's own `on` leaves the last two out, so it keeps taking
   * part in both and comes back when they let it.
   */
  const dimLabelOn = (i: number): boolean =>
    gridsOn && !isElevation(host.view().phi) && gridRecs[i].line.visible
  const dimDrawnNow = (d: { run: GridDimRun; label: Label }): boolean =>
    dimLabelOn(d.run.i) && !d.label.crowded && !d.label.occluded

  function placeGridDims(): void {
    if (!gridDimSegs) return
    const camera = host.camera()
    camera.updateMatrixWorld()
    const pa = gridDimSegs.geometry.getAttribute('position') as BufferAttribute
    const z = gridZ
    // The furthest a run may stand in from its bubbles: the footprint padding, which keeps it
    // off the building when a metre along the grid is almost no pixels (seen end-on).
    const cap = pad
    dimDrawn = gridDims.map(dimDrawnNow)
    // Uploaded only when a vertex actually moved (refactor pass 2): this runs on every drawn
    // frame, and with the grids off or the camera still nothing does.
    const arr = pa.array as Float32Array
    let moved = false
    const put = (v: number, x: number, y: number, zz: number): void => {
      const i = v * 3
      if (arr[i] === Math.fround(x) && arr[i + 1] === Math.fround(y) && arr[i + 2] === Math.fround(zz)) return
      pa.setXYZ(v, x, y, zz)
      moved = true
    }
    gridDims.forEach(({ run, label, halfW, halfH }, k) => {
      label.on = dimLabelOn(run.i)
      const base = k * 6
      const collapse = (): void => {
        for (let v = 0; v < 6; v++) put(base + v, run.at[0], run.at[1], z)
      }
      if (!label.on) return collapse()
      const mx = run.at[0] + run.span[0] / 2
      const my = run.at[1] + run.span[1] / 2
      _a.copy(toPx(_mid.set(mx, my, z)))
      const step = gridGap > 0 ? gridGap : 1
      const b = toPx(_mid.set(mx + run.dir[0] * step, my + run.dir[1] * step, z))
      const len = Math.hypot(b.x - _a.x, b.y - _a.y)
      const px = len > 0 ? gridDimStandoffPx((b.x - _a.x) / len, (b.y - _a.y) / len, halfW, halfH) : 0
      const off = gridDimOffset(len / step, cap, px)
      const x0 = run.at[0] + run.dir[0] * off
      const y0 = run.at[1] + run.dir[1] * off
      const x1 = x0 + run.span[0]
      const y1 = y0 + run.span[1]
      // The label still moves with the run while it is hidden, so the sweep and the occlusion
      // test keep judging it where it would be drawn.
      label.pos.set((x0 + x1) / 2, (y0 + y1) / 2, z)
      if (!dimDrawn[k]) return collapse()
      const tx = run.dir[0] * off * DIM_TICK_FRACTION
      const ty = run.dir[1] * off * DIM_TICK_FRACTION
      put(base, x0, y0, z)
      put(base + 1, x1, y1, z)
      put(base + 2, x0 - tx, y0 - ty, z)
      put(base + 3, x0 + tx, y0 + ty, z)
      put(base + 4, x1 - tx, y1 - ty, z)
      put(base + 5, x1 + tx, y1 + ty, z)
    })
    if (moved) pa.needsUpdate = true
  }

  /** The sweep or the occlusion test changed a label after its run was placed for this frame. */
  const gridDimsStale = (): boolean => gridDims.some((d, k) => dimDrawnNow(d) !== dimDrawn[k])

  const buildLevels = (rect: Rect): void => {
    for (const s of host.storeys()) {
      const z = s.elev
      const ring = new Line(
        new BufferGeometry().setFromPoints([
          new Vector3(rect.minX, rect.minY, z),
          new Vector3(rect.maxX, rect.minY, z),
          new Vector3(rect.maxX, rect.maxY, z),
          new Vector3(rect.minX, rect.maxY, z),
          new Vector3(rect.minX, rect.minY, z)
        ]),
        materials.levelLine
      )
      levelGroup.add(ring)
      levelLines.push(ring)
      const anchor = levelTagAnchor(rect)
      const tag = overlay.mkLabel(
        new Vector3(anchor[0], anchor[1], z),
        levelTagHtml(s.name, s.authored),
        overlay.labelBase(),
        LEVEL_TAG_DX,
        0
      )
      tag.clamp = true
      tag.stack = true
      tag.on = levelsOn
      levelLabels.push(tag)
    }
  }

  const rebuild = (): void => {
    clearGrids()
    clearLevels()
    const box = host.bbox
    if (box.isEmpty()) {
      gridKey = ''
      return
    }
    const s = host.scale()
    // 2026-09-24: the gridlines span the grids' own authored extent, else the building's
    // footprint; the level rings the building's footprint. Never the whole model's, which a
    // large site makes hundreds of metres wider than the building. Both padded as before.
    const frame = host.frame
    const fs = host.frameScale()
    const footprint: Rect = { minX: frame.min.x, minY: frame.min.y, maxX: frame.max.x, maxY: frame.max.y }
    const grid = padRect(gridExtentRect(host.grids()) ?? footprint)
    pad = grid.pad
    const lineZ = host.groundZ() + 0.01 * s
    buildGrids(grid.rect, lineZ, frame.max.z + pad - STEM_DROP * fs, BUBBLE_GAP * fs)
    buildLevels(padRect(footprint).rect)
    gridKey = ''
    updateGridView(true)
  }

  /** `updateGridView`, L197–213, with the family rule generalised (`shared/annotate.ts`). */
  function updateGridView(force = false): void {
    if (!gridRecs.length) return
    const { theta, phi } = host.view()
    const up = isElevation(phi)
    const u: XY = [Math.cos(theta), Math.sin(theta)]
    const keep = up ? keepFamily(famDirs, u) : -1
    const signs = gridRecs.map((r) => (up ? nearEndSign(r.p0, r.p1, u) : 1))
    const key =
      `${gridsOn}|${up}|${up ? keep : ''}|` +
      (up ? signs.map((s) => (s > 0 ? '+' : '-')).join('') : '')
    if (key === gridKey && !force) return
    gridKey = key
    const z = up ? host.frame.max.z + pad : host.groundZ() + 0.01 * host.scale()
    gridRecs.forEach((r, i) => {
      const show = gridsOn && (!up || r.family === keep)
      r.line.visible = show
      for (const e of r.ends) {
        const on = show && (!up || e.sign === signs[i])
        e.label.on = on
        e.label.pos.z = z
        e.stem.visible = on && up
      }
    })
  }

  /* ────────────────────────────── the laser meter ────────────────────────────── */

  /**
   * L371–386. From a surface point, fire ±X ±Y ±Z to the nearest visible faces. A ray pointing
   * into the surface it sits on is not fired; a direction with no hit ends at the point itself;
   * an axis with no reading at all is dropped.
   *
   * `selfId` replaces the reference's `hit.object` identity check. A merged slot mesh holds
   * thousands of elements (`batches.ts`), so object identity would reject far too much; the
   * element the ray started from is what the reference's 5 cm window is actually about.
   */
  function laserFrom(p: Vector3, normal: Vector3 | null, selfId: number): LaserRay[] {
    const far = LASER_FAR * host.scale()
    _origin.copy(p).addScaledVector(normal ?? Z_UP, LASER_LIFT)
    const n = normal ? ([normal.x, normal.y, normal.z] as [number, number, number]) : null
    const ends = new Map<LaserAxis, (Vector3 | null)[]>()
    for (const { axis, sign } of laserDirections(n)) {
      _dir.copy(AXIS_VECTORS[axis]).multiplyScalar(sign)
      let hit = host.ray(_origin, _dir, far, LASER_MIN_DISTANCE)
      // L378's `!(x.object === self && x.distance < 0.05)`: step past the surface we are on.
      if (hit && hit.id === selfId && hit.distance < LASER_SELF_DISTANCE) {
        hit = host.ray(_origin, _dir, far, LASER_SELF_DISTANCE)
      }
      let slot = ends.get(axis)
      if (!slot) ends.set(axis, (slot = [null, null]))
      slot[sign > 0 ? 0 : 1] = hit ? hit.point.clone() : null
    }
    const out: LaserRay[] = []
    for (const axis of LASER_AXES) {
      const slot = ends.get(axis)
      if (!slot || (!slot[0] && !slot[1])) continue
      const a = slot[1] ?? p.clone()
      const b = slot[0] ?? p.clone()
      out.push({ axis, a, b, len: a.distanceTo(b) })
    }
    return out
  }

  /** L387. Three segments, degenerate where an axis has no reading. */
  function fillLaser(rays: readonly LaserRay[], p: Vector3): void {
    const pa = laserGeom.getAttribute('position') as BufferAttribute
    LASER_AXES.forEach((axis, i) => {
      const r = rays.find((x) => x.axis === axis)
      const a = r ? r.a : p
      const b = r ? r.b : p
      pa.setXYZ(i * 2, a.x, a.y, a.z)
      pa.setXYZ(i * 2 + 1, b.x, b.y, b.z)
    })
    pa.needsUpdate = true
    laser.visible = rays.length > 0
  }

  const measureList = (): MeasureRecord[] =>
    measures.map((m) => {
      const out: MeasureRecord = { id: m.id, p: m.p.toArray() as [number, number, number] }
      for (const r of m.rays) out[r.axis.toLowerCase() as 'x' | 'y' | 'z'] = r.len
      return out
    })

  const publishMeasures = (): void => host.on.measure?.(measureList())

  /* ────────────────────────────── spot coordinates ────────────────────────────── */

  /** The scene point in the file's own coordinates — `offset()` is what the pipeline removed. */
  const filePoint = (p: Vector3): { x: number; y: number; z: number } => {
    const [ox, oy, oz] = host.offset()
    return { x: p.x + ox, y: p.y + oy, z: p.z + oz }
  }

  /**
   * L411's tag, since 2026-09-28 (owner-requested) in two states: collapsed, the level only —
   * the map Z the grid's Z row prints, or with no base point the file's own z — and, once
   * clicked, the design's full grid, byte for byte (`shared/annotate.ts`).
   */
  const renderSpot = (s: Spot): void => {
    const f = filePoint(s.p)
    const m = toMap(coords, f.x, f.y, f.z)
    const tag = s.labels[0]
    tag.el.innerHTML = s.expanded ? spotGridHtml(f, m) : spotLevelHtml(m ? m.Z : f.z)
    tag.el.title = s.expanded ? 'Show level only' : 'Show E, N and Z'
    const o = s.expanded ? SPOT_GRID_OFFSET : SPOT_LEVEL_OFFSET
    tag.dx = o.dx
    tag.dy = o.dy
  }

  /** The tag's two states, set: its own click toggles through here, and so does `showSpot`. */
  const setExpanded = (s: Spot, full: boolean): void => {
    s.expanded = full
    renderSpot(s)
    host.invalidate()
  }

  const spotList = (): SpotRecord[] =>
    spots.map((s) => {
      const f = filePoint(s.p)
      const m = toMap(coords, f.x, f.y, f.z)
      return {
        id: s.id,
        p: s.p.toArray() as [number, number, number],
        E: m ? m.E : null,
        N: m ? m.N : null,
        Z: m ? m.Z : null,
        ...f
      }
    })

  const publishSpots = (): void => host.on.spot?.(spotList())

  /* ────────────────────────────── selection dimensions ────────────────────────────── */

  const clearDims = (): void => {
    while (dimGroup.children.length) {
      const c = dimGroup.children.pop() as Object3D & { geometry?: { dispose(): void } }
      c.geometry?.dispose()
    }
    for (const l of dimLabels) l.remove()
    dimLabels = []
  }

  /** L440–483. */
  function drawDims(): void {
    clearDims()
    if (!dimOn || !dimIds.length) return
    let min: Vector3 | null = null
    let max: Vector3 | null = null
    for (const id of dimIds) {
      const b = host.elementBox(id)
      if (!b || !host.isVisible(id)) continue
      if (!min || !max) {
        min = b.min.clone()
        max = b.max.clone()
        continue
      }
      min.min(b.min)
      max.max(b.max)
    }
    if (!min || !max) return
    const mn = min
    const mx = max
    const size = new Vector3().subVectors(mx, mn)
    const off = dimOffset(size.x, size.y, size.z)
    const t = off * DIM_TICK_FRACTION

    // The box, as the reference's `Box3Helper` draws it: the twelve edges of the AABB.
    const corner = (i: number): Vector3 =>
      new Vector3(i & 1 ? mx.x : mn.x, i & 2 ? mx.y : mn.y, i & 4 ? mx.z : mn.z)
    const BOX_EDGES = [0, 1, 1, 3, 3, 2, 2, 0, 4, 5, 5, 7, 7, 6, 6, 4, 0, 4, 1, 5, 3, 7, 2, 6]
    dimGroup.add(
      new LineSegments(
        new BufferGeometry().setFromPoints(BOX_EDGES.map(corner)),
        materials.dimBox
      )
    )

    const V = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z)
    const runs = [
      {
        a: V(mn.x, mn.y - off, mn.z),
        b: V(mx.x, mn.y - off, mn.z),
        v: size.x,
        tick: V(0, t, 0),
        dirs: DIM_RUN_DIRS.x
      },
      {
        a: V(mx.x + off, mn.y, mn.z),
        b: V(mx.x + off, mx.y, mn.z),
        v: size.y,
        tick: V(t, 0, 0),
        dirs: DIM_RUN_DIRS.y
      },
      {
        a: V(mn.x - off, mn.y - off, mn.z),
        b: V(mn.x - off, mn.y - off, mx.z),
        v: size.z,
        tick: V(t, 0, 0),
        dirs: DIM_RUN_DIRS.z
      }
    ]

    // L456: obstacles grow as labels are placed, so a later run never lands on an earlier one.
    const taken: DimRect[] = [...dimAvoid]
    const pts: Vector3[] = []
    for (const r of runs) {
      if (r.v < 1e-4) continue
      pts.push(r.a, r.b)
      pts.push(
        r.a.clone().sub(r.tick),
        r.a.clone().add(r.tick),
        r.b.clone().sub(r.tick),
        r.b.clone().add(r.tick)
      )
      const at = (c: { t: number; dx: number; dy: number }): { x: number; y: number } => {
        const q = toPx(_mid.copy(r.a).lerp(r.b, c.t))
        return { x: q.x + c.dx, y: q.y + c.dy }
      }
      const c = placeDimLabel(r.dirs, at, taken)
      taken.push(dimLabelRect(at(c)))
      dimLabels.push(
        overlay.mkLabel(
          r.a.clone().lerp(r.b, c.t),
          mmTxt(r.v),
          {
            ...overlay.labelBase(),
            color: 'var(--ink)',
            borderColor: 'var(--accent)',
            fontWeight: '500'
          },
          c.dx,
          c.dy
        )
      )
    }
    if (pts.length) {
      dimGroup.add(new LineSegments(new BufferGeometry().setFromPoints(pts), materials.dim))
    }
  }

  /* ────────────────────────────── the API ────────────────────────────── */

  const countVisible = (g: GroupType): number => {
    if (!g.visible) return 0
    let n = 0
    for (const c of g.children) if (c.visible) n++
    return n
  }

  return {
    group,
    rebuild,
    updateGridView,
    placeGridDims,
    gridDimsStale,

    setGrids: (b) => {
      gridsOn = !!b
      gridGroup.visible = gridsOn
      updateGridView(true)
    },

    setLevels: (b) => {
      levelsOn = !!b
      levelGroup.visible = levelsOn
      for (const l of levelLabels) l.on = levelsOn
    },

    setCoords: (c) => {
      coords = { ...coords, ...c }
      for (const s of spots) renderSpot(s)
      publishSpots()
    },

    addLaser: (p, normal, selfId) => {
      const rays = laserFrom(p, normal, selfId)
      if (!rays.length) return
      const m: Measurement = {
        id: ++mid,
        p: p.clone(),
        rays,
        lines: [],
        labels: [overlay.mkLabel(p, '', ORIGIN_STYLE)]
      }
      for (const r of rays) {
        const line = new Line(
          new BufferGeometry().setFromPoints([r.a, r.b]),
          materials.laser
        )
        line.renderOrder = 5
        measGroup.add(line)
        m.lines.push(line)
        const off = laserLabelOffset(r.axis)
        m.labels.push(
          overlay.mkLabel(
            r.a.clone().lerp(r.b, 0.5),
            rayHtml(r),
            { ...overlay.labelBase(), borderColor: 'var(--accent)' },
            off.dx,
            off.dy
          ),
          overlay.mkLabel(r.a, '', DOT_STYLE),
          overlay.mkLabel(r.b, '', DOT_STYLE)
        )
      }
      measures.push(m)
      publishMeasures()
    },

    addSpot: (p) => {
      const tag = overlay.mkLabel(p, '', { ...overlay.labelBase(), ...SPOT_STYLE })
      const s: Spot = {
        id: ++mid,
        p: p.clone(),
        labels: [tag, overlay.mkLabel(p, '', DOT_STYLE)],
        expanded: false
      }
      // The overlay sits above the canvas, so the click never reaches the viewport's own
      // handlers: no orbit, no pick, no new spot or measurement.
      tag.el.addEventListener('click', (e) => {
        e.stopPropagation()
        setExpanded(s, !s.expanded)
      })
      renderSpot(s)
      spots.push(s)
      publishSpots()
    },

    previewLaser: (p, normal, selfId) => {
      const rays = laserFrom(p, normal, selfId)
      preview = rays.map((r) => ({ axis: r.axis, len: +r.len.toFixed(4) }))
      fillLaser(rays, p)
      liveLabel.on = rays.length > 0
      liveLabel.pos.copy(p)
      liveLabel.el.innerHTML = liveHtml(rays)
    },

    clearPreview: () => {
      preview = []
      laser.visible = false
      liveLabel.on = false
    },

    /** L407. */
    clearMeasures: () => {
      for (const m of measures) {
        for (const l of m.lines) {
          measGroup.remove(l)
          l.geometry.dispose()
        }
        for (const l of m.labels) l.remove()
      }
      measures.length = 0
      laser.visible = false
      liveLabel.on = false
      publishMeasures()
    },

    /** L427. */
    clearSpots: () => {
      for (const s of spots) for (const l of s.labels) l.remove()
      spots.length = 0
      publishSpots()
    },

    /** L417. */
    dropMeasure: (id) => {
      const i = measures.findIndex((m) => m.id === id)
      if (i < 0) return
      const m = measures[i]
      for (const l of m.lines) {
        measGroup.remove(l)
        l.geometry.dispose()
      }
      for (const l of m.labels) l.remove()
      measures.splice(i, 1)
      publishMeasures()
    },

    /** L422. */
    dropSpot: (id) => {
      const i = spots.findIndex((s) => s.id === id)
      if (i < 0) return
      for (const l of spots[i].labels) l.remove()
      spots.splice(i, 1)
      publishSpots()
    },

    showSpot: (id, full) => {
      const s = spots.find((x) => x.id === id)
      if (!s) return 'missing'
      if (s.expanded === full) return 'already'
      setExpanded(s, full)
      return 'changed'
    },

    setDims: (ids, on, avoid) => {
      dimIds = ids ? [...ids] : []
      if (on != null) dimOn = !!on
      if (avoid !== undefined) dimAvoid = avoid ?? []
      drawDims()
    },
    drawDims,

    get measureCount() {
      return measures.length
    },
    get spotCount() {
      return spots.length
    },

    drawObjects: () =>
      countVisible(gridGroup) +
      countVisible(levelGroup) +
      countVisible(measGroup) +
      countVisible(dimGroup) +
      (laser.visible ? 1 : 0),

    debug: () => ({
      pad: +pad.toFixed(3),
      grids: gridsOn,
      levels: levelsOn,
      gridLines: gridRecs.length,
      gridFamilies: famDirs.length,
      /** Dimensions between gridlines, and the spacings they print (mm). */
      gridDims: gridDims.map((d) => Math.round(d.run.spacing * 1000)),
      /**
       * The drawn direction of each family, in scene degrees mod 180 — the number that says
       * whether the model is standing square with its own grid. Two decimals, which is 2 cm
       * over a 100 m axis.
       */
      gridFamilyDeg: famDirs.map((d) => {
        const deg = ((((Math.atan2(d[1], d[0]) * 180) / Math.PI) % 180) + 180) % 180
        // A line has no sense, so 180° is 0°: report the direction, not the winding.
        return +(deg > 179.99 ? deg - 180 : deg).toFixed(2)
      }),
      gridKey,
      levelRings: levelLines.length,
      /** The scene z of every level ring, which is where the storey's floor geometry is. */
      levelZ: host.storeys().map((s) => +s.elev.toFixed(4)),
      measures: measures.length,
      spots: spots.length,
      preview,
      dims: { on: dimOn, ids: dimIds.length, avoid: dimAvoid.length, labels: dimLabels.length },
      coords
    }),

    dispose: () => {
      clearGrids()
      clearLevels()
      for (const m of measures) {
        for (const l of m.lines) l.geometry.dispose()
        for (const l of m.labels) l.remove()
      }
      measures.length = 0
      for (const s of spots) for (const l of s.labels) l.remove()
      spots.length = 0
      clearDims()
      liveLabel.remove()
      laserGeom.dispose()
    }
  }
}
