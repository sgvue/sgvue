/**
 * Pointer and wheel handling — `design-reference/design/viewer-core.js` L533–603, ported as
 * written, including the parts that look like accidents and are not — except the perspective
 * mouse drag's and wheel's orbit point, a deviation since 2026-11-15 (below).
 *
 * **Mouse.** Dragging pans; Shift-dragging orbits; the wheel dollies by `exp(deltaY·0.0011)`
 * towards whatever is under the cursor. A press that never moves more than 3 px is a click,
 * and a click selects — Ctrl (⌘ on macOS) toggling rather than replacing. Right-click asks
 * the shell for its context menu; *pressing* any button closes one first. Double-click frames
 * the element under the cursor, or the whole federation over empty space.
 *
 * **Touch.** One finger orbits, two pinch-zoom and pan. The two-finger branch listens in the
 * capture phase and calls `stopPropagation`, which is what stops the one-finger orbit handler
 * below it from seeing the same move and spinning the model during a pinch.
 *
 * **The pivot.** Orbit and dolly turn around what you are pointing at: the pick, or failing
 * that the point where the ray meets the ground plane, and only if that point is somewhere
 * near the model. Two of the reference's constants are sized to its own 27.5 m federation and
 * are therefore kept as *that value × scale*, exactly as every other scene constant is
 * (`camera.ts`, `scene.ts`): its 400 m and 300 m range limits, and its ground plane at
 * **z = 0** — which becomes `rig.groundZ`, the same plane the ground disc is actually drawn
 * on. They coincide on the design's own mock, whose offset is zero and whose box straddles its
 * file's zero. A literal 0 would be neither: scene z = 0 is only the height of the first
 * placement streamed (`scene.ts`, `groundLevel`), so it would put the fallback pivot in mid-air
 * on any file whose first part is high in the structure, and on a model that sits entirely
 * above or below its own zero — the class of bug `CLAUDE.md` records as slicing the roof off a
 * 56 m warehouse.
 *
 * **The orbit point, 2026-11-15** (`docs/DEVIATIONS.md`, owner: *"Yes, fix both"*). In
 * perspective the design's pan speed is the distance to the orbit point, and its wheel pivot is
 * the ground under the cursor whenever that lies within 300 × scale of the orbit point. A zoom
 * towards a near surface left the orbit point a metre from the lens, so a later pan over a
 * façade 88 m away crept at 1/75 of the cursor; with the cursor on the ground, each notch out
 * dragged the orbit point sideways into the site, and the building slid at 1.3 × the cursor.
 * Now a mouse drag, the moment it starts, and every wheel notch first re-anchor the orbit point
 * (`CameraRig.anchor`) at the depth of what is under the cursor, or else of the building box's
 * centre (`anchorDepth`); and with nothing under the cursor the pivot is the ground only within
 * the building's reach, else none, so the notch zooms along the view axis (`groundPivot`).
 * Orthographic, touch and the pinch keep the design's rule (`pivotAt`).
 *
 * The maths is exported as plain functions so `tests/unit/input.test.ts` can check the
 * one-finger/two-finger split, the Shift branch and the toggle modifier under Node; the rest
 * of the file is the event wiring, which is as thin as the reference's.
 */
import type { Box3, Ray, Vector2 } from 'three/webgpu'
import { Plane, Raycaster, Vector3 } from 'three/webgpu'
import { Z_AXIS } from './camera'
import type { ViewerCamera } from './overlay'
import type { PickHit } from './picking'

/** L572. Movement below this many pixels is still a click, not a drag. */
export const DRAG_THRESHOLD = 3
/** L593. The wheel's dolly exponent. */
export const DOLLY_RATE = 0.0011
/** L551. Pinch factors are clamped to this range per move event. */
export const PINCH_MIN = 0.5
export const PINCH_MAX = 2
/** L551. A pinch under half a pixel of change is noise. */
export const PINCH_DEADZONE = 0.5
/**
 * L565 and L593, before scaling: how far the ground-plane fallback pivot may be from the target.
 * Since 2026-11-15 only orthographic and touch use them; a perspective mouse gesture's no-hit
 * pivot is `groundPivot`'s.
 */
export const PIVOT_RANGE = 400
export const WHEEL_PIVOT_RANGE = 300

/** Where a camera looks: its −Z, from its quaternion, as `CameraRig.pan` reads it. */
const forwardOf = (camera: ViewerCamera, out: Vector3): Vector3 =>
  out.set(0, 0, -1).applyQuaternion(camera.quaternion)

/** How far in front of the camera `p` is, along its view axis. */
export function depthOf(camera: ViewerCamera, p: Vector3): number {
  return forwardOf(camera, new Vector3()).dot(new Vector3().subVectors(p, camera.position))
}

/**
 * 2026-11-15. The depth to re-anchor the orbit point at when a gesture starts: that of the pick
 * under the cursor; else that of the building box's centre, if it is at least 0.5 × `nearScale`
 * in front (the nearest the rig lets the orbit point be); else `null`, and the gesture keeps the
 * orbit point it has.
 */
export function anchorDepth(
  camera: ViewerCamera,
  hit: Vector3 | null,
  building: Box3,
  nearScale: number
): number | null {
  if (hit) return depthOf(camera, hit)
  if (building.isEmpty()) return null
  const d = depthOf(camera, building.getCenter(new Vector3()))
  return d >= 0.5 * nearScale ? d : null
}

/**
 * 2026-11-15. Is a ground point within the building's reach: inside its plan extent grown on
 * every side by half its plan diagonal?
 */
export function withinReach(p: Vector3, building: Box3): boolean {
  if (building.isEmpty()) return false
  const g = 0.5 * Math.hypot(building.max.x - building.min.x, building.max.y - building.min.y)
  return (
    p.x >= building.min.x - g && p.x <= building.max.x + g && p.y >= building.min.y - g && p.y <= building.max.y + g
  )
}

/**
 * 2026-11-15. The perspective wheel's and mouse orbit's pivot when nothing is under the cursor:
 * the ground (the plane z = `groundZ`) where the cursor's ray meets it, if that is within the
 * building's reach; else `null` — the design's own fallback (L593), so the notch zooms along the
 * view axis about the re-anchored orbit point and the building stays where it is on screen.
 */
export function groundPivot(ray: Ray, groundZ: number, building: Box3): Vector3 | null {
  const ground = ray.intersectPlane(new Plane(Z_AXIS.clone(), -groundZ), new Vector3())
  return ground && withinReach(ground, building) ? ground : null
}

/** L593. */
export const dollyFactor = (deltaY: number): number => Math.exp(deltaY * DOLLY_RATE)

/** L551. `pinch / now`: fingers moving apart give a factor below 1, which dollies in. */
export const pinchFactor = (previous: number, now: number): number =>
  Math.max(PINCH_MIN, Math.min(PINCH_MAX, previous / now))

/** L588. Ctrl or ⌘ adds to the selection instead of replacing it. */
export const selectMode = (ctrlKey: boolean, metaKey: boolean): 'toggle' | 'replace' =>
  ctrlKey || metaKey ? 'toggle' : 'replace'

/** L575. Shift-drag with the left button orbits; so does any touch drag. Everything else pans. */
export const dragMode = (
  button: number,
  shiftKey: boolean,
  pointerType: string
): 'orbit' | 'pan' => ((button === 0 && shiftKey) || pointerType === 'touch' ? 'orbit' : 'pan')

/** Just enough of a `PointerEvent` for the tracker; keeps it testable without a DOM. */
export interface PointerLike {
  pointerId: number
  clientX: number
  clientY: number
}

/** The reference's two-finger reading (L537): the span between the fingers and their midpoint. */
export interface TwoFinger {
  d: number
  x: number
  y: number
}

/** L536–537. The live touch points, and the pinch state derived from the first two. */
export interface TouchTracker {
  readonly size: number
  add(e: PointerLike): void
  /** L544: is this finger one that went down on the canvas? */
  has(e: PointerLike): boolean
  remove(e: PointerLike): void
  clear(): void
  /** `null` unless exactly two fingers are down. */
  two(): TwoFinger | null
}

export function createTouchTracker(): TouchTracker {
  const points = new Map<number, { x: number; y: number }>()
  return {
    get size() {
      return points.size
    },
    add: (e) => {
      points.set(e.pointerId, { x: e.clientX, y: e.clientY })
    },
    has: (e) => points.has(e.pointerId),
    remove: (e) => {
      points.delete(e.pointerId)
    },
    clear: () => points.clear(),
    two: () => {
      if (points.size !== 2) return null
      const [a, b] = [...points.values()]
      return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    }
  }
}

/** L332. Client coordinates → NDC, plus the pixel position inside the canvas. */
export function canvasNdc(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  out: Vector2
): { px: number; py: number } {
  const r = canvas.getBoundingClientRect()
  out.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
  return { px: clientX - r.left, py: clientY - r.top }
}

/** What the viewer hands the input layer. Every one of these is one line in the reference. */
export interface InputHost {
  canvas: HTMLCanvasElement
  /** Current viewport height — `pan` needs it to convert pixels to world units. */
  height(): number
  camera(): ViewerCamera
  /** Where the camera is heading; the pivot fallback must land near it. */
  target(): Vector3
  /** Z of the ground plane the fallback pivot uses (the reference's z = 0). */
  groundZ(): number
  /** `radius / 27.5`: the pivot ranges are the reference's × this (see `camera.ts`). */
  scale(): number
  /** 2026-11-15. The world building box (the site left out): what the no-hit pivot keeps near. */
  building(): Box3
  /** 2026-11-15. The rig's near-limit scale (`CameraRig.nearScale`). */
  nearScale(): number
  /** 2026-11-15. Re-anchor the orbit point at this depth (`CameraRig.anchor`); moves nothing. */
  anchor(depth: number): void
  /** NDC → hit, through `picking.ts`. */
  pick(ndc: Vector2): PickHit | null
  orbit(dx: number, dy: number, pivot: Vector3 | null): void
  pan(dx: number, dy: number, height: number): void
  dolly(k: number, at: Vector3 | null): void
  /** Frame this element (double-click on geometry) or the whole federation (empty space). */
  frame(id: number | null): void
  /** L566: where the pointer now is (the reference's `lastEvt`), recorded on every move. */
  hoverAt(clientX: number, clientY: number): void
  /** Evaluate hover on the next frame (the reference's `needHover`). */
  hoverLater(): void
  /**
   * Drop a hover that was asked for but not yet evaluated, because a camera gesture has
   * started. The reference's rule is `down.on` (L566): while a drag is running, a move does
   * not set `needHover`. This extends it to the two gestures that reach the same camera calls
   * by another route — a pinch, whose fingers leave `down.on` false, and the wheel, which the
   * pointer can move through — and to a hover queued by a move in the same frame. A ray into
   * 26 539 elements costs 8.6 ms of the frame a drag is trying to finish in 16.
   */
  hoverCancel(): void
  /** The pointer left the canvas. */
  hoverOut(): void
  /** L588: a click landed. */
  select(id: number | null, mode: 'toggle' | 'replace'): void
  /** L587 and L575: the context menu, and `null` to close it. */
  context(c: { x: number; y: number; id: number | null } | null): void
  /** L589–591: a click with a non-select tool. Phase 6 turns this into a spot or a laser. */
  toolClick(hit: PickHit, px: number, py: number): void
  /** `'select'` suppresses `toolClick`. */
  tool(): string
}

export interface InputHandle {
  dispose(): void
}

const _plane = new Plane(Z_AXIS.clone(), 0)
const _ground = new Vector3()

export function attachInput(host: InputHost, ndc: Vector2): InputHandle {
  const { canvas } = host
  const raycaster = new Raycaster()

  /**
   * L565 and L593: the pick point, else the ground plane if it is near the model. Orthographic
   * and touch only since 2026-11-15; a perspective mouse gesture uses `reanchorAt`.
   */
  const pivotAt = (range: number): Vector3 | null => {
    const hit = host.pick(ndc)
    if (hit) return hit.point.clone()
    raycaster.setFromCamera(ndc, host.camera())
    _plane.normal.copy(Z_AXIS)
    _plane.constant = -host.groundZ()
    if (!raycaster.ray.intersectPlane(_plane, _ground)) return null
    return _ground.distanceTo(host.target()) < range * host.scale() ? _ground.clone() : null
  }

  /**
   * 2026-11-15. A perspective mouse gesture's start: the pick, the depth to re-anchor at and the
   * pivot (`anchorDepth`, `groundPivot`). `null` in orthographic, whose rule is `pivotAt`'s.
   */
  const reanchorAt = (): { depth: number | null; pivot: Vector3 | null } | null => {
    const camera = host.camera()
    if (!('isPerspectiveCamera' in camera)) return null
    const hit = host.pick(ndc)
    const depth = anchorDepth(camera, hit ? hit.point : null, host.building(), host.nearScale())
    if (hit) return { depth, pivot: hit.point.clone() }
    raycaster.setFromCamera(ndc, camera)
    return { depth, pivot: groundPivot(raycaster.ray, host.groundZ(), host.building()) }
  }

  /* ── touch: one finger orbits, two pinch-zoom and pan (L534–548) ────────── */
  const touches = createTouchTracker()
  let pinch = 0
  let pinchMid: { x: number; y: number } | null = null

  const down = {
    on: false,
    x: 0,
    y: 0,
    btn: 0,
    moved: false,
    pivot: null as Vector3 | null,
    /** 2026-11-15. The press's re-anchor depth, applied when the drag starts; never for a click. */
    depth: null as number | null
  }
  const handle: InputHandle = { dispose: () => {} }

  /**
   * A camera gesture is running — a drag past the threshold, a pinch, or the wheel.
   *
   * The reference's rule is `down.on` (L566): while a drag is running a move does not ask for
   * a hover, and the two other gestures reach the same camera calls by another route — a
   * pinch, whose second finger leaves `down.on` false, and the wheel, which a pointer move can
   * interleave with. Each of them also drops a hover queued earlier in the same frame, because
   * evaluating it would spend 8.6 ms of a frame the gesture needs (`picking.ts`). Hovering
   * resumes at the first pointer move that is none of the three.
   */
  const gesture = (): void => host.hoverCancel()

  const onTouchDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return
    touches.add(e)
    const t = touches.two()
    if (t) {
      pinch = t.d
      pinchMid = { x: t.x, y: t.y }
      down.on = false
    }
  }

  const onTouchMove = (e: PointerEvent): void => {
    // L544: a finger that never went down on the canvas is not one of ours — and without
    // this an already-lifted pointer's trailing move would put it back in the map.
    if (e.pointerType !== 'touch' || !touches.has(e)) return
    touches.add(e)
    const t = touches.two()
    if (!t) return
    // Stops the one-finger orbit handler below from seeing the same move (L544).
    e.stopPropagation()
    gesture()
    if (pinch > 0 && Math.abs(t.d - pinch) > PINCH_DEADZONE) host.dolly(pinchFactor(pinch, t.d), null)
    if (pinchMid) host.pan(t.x - pinchMid.x, t.y - pinchMid.y, host.height())
    pinch = t.d
    pinchMid = { x: t.x, y: t.y }
  }

  const onTouchEnd = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return
    touches.remove(e)
    if (touches.size < 2) {
      pinch = 0
      pinchMid = null
    }
  }

  /* ── mouse and one-finger (L566–603) ────────────────────────────────────── */
  const onContextMenu = (e: MouseEvent): void => e.preventDefault()

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button > 2) return
    // A synthetic pointer id (the parity harness, a test) is not a live pointer and cannot
    // be captured; the reference never meets one, and losing capture only means a drag that
    // leaves the canvas stops early.
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      /* not a live pointer */
    }
    down.on = true
    down.x = e.clientX
    down.y = e.clientY
    down.btn = e.button
    down.moved = false
    canvasNdc(canvas, e.clientX, e.clientY, ndc)
    const fresh = e.pointerType === 'touch' ? null : reanchorAt()
    down.pivot = fresh ? fresh.pivot : pivotAt(PIVOT_RANGE)
    down.depth = fresh ? fresh.depth : null
    host.context(null)
  }

  const onPointerMove = (e: PointerEvent): void => {
    // L566: the reference records `lastEvt` for *every* move, dragging or not, and only sets
    // `needHover` when it is not dragging. So a hover evaluated on the frame a drag begins
    // reads the pointer where it now is rather than where it was before the press.
    host.hoverAt(e.clientX, e.clientY)
    if (down.on) {
      const dx = e.clientX - down.x
      const dy = e.clientY - down.y
      if (!down.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        down.moved = true
        if (down.depth != null) host.anchor(down.depth)
      }
      if (!down.moved) return
      if (touches.size > 1) return
      gesture()
      if (dragMode(down.btn, e.shiftKey, e.pointerType) === 'orbit') {
        host.orbit(dx, dy, down.pivot)
      } else {
        host.pan(dx, dy, host.height())
      }
      down.x = e.clientX
      down.y = e.clientY
      return
    }
    // A pinch reaches here too: `onTouchDown` clears `down.on` for the second finger, and
    // `stopPropagation` in the capture phase does not stop another listener on the canvas.
    if (touches.size > 1) return
    host.hoverLater()
  }

  const onPointerUp = (e: PointerEvent): void => {
    if (!down.on) return
    down.on = false
    try {
      canvas.releasePointerCapture(e.pointerId)
    } catch {
      /* never captured */
    }
    if (down.moved) return
    const { px, py } = canvasNdc(canvas, e.clientX, e.clientY, ndc)
    const hit = host.pick(ndc)
    const id = hit ? hit.id : null
    if (e.button === 2) {
      host.context({ x: e.clientX, y: e.clientY, id })
      return
    }
    if (e.button !== 0) return
    if (host.tool() === 'select') {
      host.select(id, selectMode(e.ctrlKey, e.metaKey))
      return
    }
    if (!hit) return
    host.toolClick(hit, px, py)
  }

  const onPointerLeave = (): void => host.hoverOut()

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    gesture()
    canvasNdc(canvas, e.clientX, e.clientY, ndc)
    const fresh = reanchorAt()
    if (!fresh) {
      host.dolly(dollyFactor(e.deltaY), pivotAt(WHEEL_PIVOT_RANGE))
      return
    }
    if (fresh.depth != null) host.anchor(fresh.depth)
    host.dolly(dollyFactor(e.deltaY), fresh.pivot)
  }

  const onDoubleClick = (e: MouseEvent): void => {
    canvasNdc(canvas, e.clientX, e.clientY, ndc)
    const hit = host.pick(ndc)
    host.frame(hit ? hit.id : null)
  }

  canvas.style.touchAction = 'none'
  canvas.addEventListener('pointerdown', onTouchDown, true)
  canvas.addEventListener('pointermove', onTouchMove, true)
  canvas.addEventListener('pointerup', onTouchEnd, true)
  canvas.addEventListener('pointercancel', onTouchEnd, true)
  canvas.addEventListener('contextmenu', onContextMenu)
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointerleave', onPointerLeave)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('dblclick', onDoubleClick)

  handle.dispose = () => {
    canvas.removeEventListener('pointerdown', onTouchDown, true)
    canvas.removeEventListener('pointermove', onTouchMove, true)
    canvas.removeEventListener('pointerup', onTouchEnd, true)
    canvas.removeEventListener('pointercancel', onTouchEnd, true)
    canvas.removeEventListener('contextmenu', onContextMenu)
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointerleave', onPointerLeave)
    canvas.removeEventListener('wheel', onWheel)
    canvas.removeEventListener('dblclick', onDoubleClick)
    touches.clear()
  }
  return handle
}
