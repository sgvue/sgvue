/**
 * The pointer model — `design-reference/design/viewer-core.js` L533–603.
 *
 * The decisions the reference makes on every event — one finger or two, orbit or pan, toggle
 * or replace, how far the wheel dollies — are exported as plain functions so they can be
 * checked here. The event wiring around them is as thin as the reference's and is exercised
 * by the parity captures instead.
 */
import { Box3, Plane, Ray, Raycaster, Vector2, Vector3 } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { createCameraRig, type CameraRig } from '../../src/renderer/viewer/camera'
import {
  DOLLY_RATE,
  DRAG_THRESHOLD,
  PINCH_DEADZONE,
  PINCH_MAX,
  PINCH_MIN,
  createTouchTracker,
  dollyFactor,
  dragMode,
  pinchFactor,
  attachInput,
  selectMode,
  type InputHost
} from '../../src/renderer/viewer/input'
import type { PickHit } from '../../src/renderer/viewer/picking'

const pt = (pointerId: number, clientX: number, clientY: number): { pointerId: number; clientX: number; clientY: number } => ({
  pointerId,
  clientX,
  clientY
})

describe('the touch tracker — one finger vs two (L536–548)', () => {
  it('reports no pinch with one finger down', () => {
    const t = createTouchTracker()
    t.add(pt(1, 100, 100))
    expect(t.size).toBe(1)
    expect(t.two()).toBeNull()
  })

  it('reports the span and midpoint with exactly two fingers', () => {
    const t = createTouchTracker()
    t.add(pt(1, 100, 100))
    t.add(pt(2, 100, 200))
    expect(t.two()).toEqual({ d: 100, x: 100, y: 150 })
  })

  it('reports no pinch again with three fingers down', () => {
    const t = createTouchTracker()
    t.add(pt(1, 0, 0))
    t.add(pt(2, 0, 100))
    t.add(pt(3, 100, 0))
    expect(t.size).toBe(3)
    expect(t.two()).toBeNull()
  })

  it('tracks a finger by its id, so moving one updates rather than adds', () => {
    const t = createTouchTracker()
    t.add(pt(1, 0, 0))
    t.add(pt(2, 0, 100))
    t.add(pt(1, 0, -100))
    expect(t.size).toBe(2)
    expect(t.two()!.d).toBe(200)
  })

  it('only knows the fingers that went down on the canvas (L544)', () => {
    const t = createTouchTracker()
    t.add(pt(1, 0, 0))
    expect(t.has(pt(1, 0, 0))).toBe(true)
    expect(t.has(pt(9, 0, 0))).toBe(false)
    t.remove(pt(1, 0, 0))
    expect(t.has(pt(1, 0, 0))).toBe(false)
  })

  it('forgets a lifted finger and clears every one at once', () => {
    const t = createTouchTracker()
    t.add(pt(1, 0, 0))
    t.add(pt(2, 0, 100))
    t.remove(pt(2, 0, 100))
    expect(t.size).toBe(1)
    expect(t.two()).toBeNull()
    t.clear()
    expect(t.size).toBe(0)
  })
})

describe('dragMode (L583)', () => {
  it('pans on a plain left drag', () => {
    expect(dragMode(0, false, 'mouse')).toBe('pan')
  })

  it('orbits on Shift + left', () => {
    expect(dragMode(0, true, 'mouse')).toBe('orbit')
  })

  it('orbits on any touch drag, Shift or not', () => {
    expect(dragMode(0, false, 'touch')).toBe('orbit')
    expect(dragMode(2, false, 'touch')).toBe('orbit')
  })

  it('pans on Shift + a button other than the left one', () => {
    // The reference tests `down.btn === 0 && e.shiftKey`, so Shift + right still pans.
    expect(dragMode(2, true, 'mouse')).toBe('pan')
    expect(dragMode(1, true, 'mouse')).toBe('pan')
  })
})

describe('selectMode (L588)', () => {
  it('replaces with no modifier and toggles with Ctrl or ⌘', () => {
    expect(selectMode(false, false)).toBe('replace')
    expect(selectMode(true, false)).toBe('toggle')
    expect(selectMode(false, true)).toBe('toggle')
    expect(selectMode(true, true)).toBe('toggle')
  })
})

describe('dollyFactor (L594)', () => {
  it('is exp(deltaY × 0.0011), so a still wheel changes nothing', () => {
    expect(dollyFactor(0)).toBe(1)
    expect(dollyFactor(100)).toBeCloseTo(Math.exp(100 * DOLLY_RATE), 12)
    expect(DOLLY_RATE).toBe(0.0011)
  })

  it('is symmetric: scrolling back undoes scrolling forward', () => {
    expect(dollyFactor(120) * dollyFactor(-120)).toBeCloseTo(1, 12)
  })

  it('pushes the camera out scrolling down and pulls it in scrolling up', () => {
    expect(dollyFactor(120)).toBeGreaterThan(1)
    expect(dollyFactor(-120)).toBeLessThan(1)
  })
})

describe('pinchFactor (L551)', () => {
  it('dollies in when the fingers move apart', () => {
    // previous / now: a larger span now gives a factor below 1.
    expect(pinchFactor(100, 200)).toBeCloseTo(0.5, 12)
    expect(pinchFactor(200, 100)).toBeCloseTo(2, 12)
  })

  it('clamps a wild jump to [0.5, 2]', () => {
    expect(pinchFactor(100, 1000)).toBe(PINCH_MIN)
    expect(pinchFactor(1000, 100)).toBe(PINCH_MAX)
    expect([PINCH_MIN, PINCH_MAX]).toEqual([0.5, 2])
  })
})

describe('the thresholds', () => {
  it('are the reference\'s 3 px drag and 0.5 px pinch deadzone', () => {
    expect(DRAG_THRESHOLD).toBe(3)
    expect(PINCH_DEADZONE).toBe(0.5)
  })
})

/* ── 2026-11-15: the orbit point re-anchored at each gesture's start ──────────────────────────
 *
 * The design sizes a perspective pan to the distance to its hidden orbit point (`viewer-core.js`
 * L290) and lets the wheel drag that point to wherever the cursor meets the ground (L593). Both
 * are deviations now (`docs/DEVIATIONS.md`, 2026-11-15). These checks drive the real
 * `attachInput` with a real camera rig: the canvas is a bare `EventTarget` and `pick` is a ray
 * against the test's own surfaces — the only stand-ins, for the DOM and the GPU picker.
 */

/** The investigation's building: 60 × 40 × 20 m, standing on z = 0, at scale 1. */
const BUILDING = new Box3(new Vector3(-30, -20, 0), new Vector3(30, 20, 20))
const W = 1200
const H = 800
const PLAN_DIAGONAL = Math.hypot(60, 40)

type Surface = { kind: 'box'; box: Box3 } | { kind: 'plane'; plane: Plane }

class FakeCanvas extends EventTarget {
  style: Record<string, string> = {}
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: W, height: H }
  }
  setPointerCapture(): void {}
  releasePointerCapture(): void {}
}

interface Stage {
  rig: CameraRig
  /** What `pick` sees; replace it to change the world. */
  surfaces: Surface[]
  settle(): void
  wheel(x: number, y: number, deltaY: number): void
  drag(x0: number, y0: number, x1: number, y1: number, shift?: boolean): void
  click(x: number, y: number): void
  screen(p: Vector3): Vector2
  rayAt(x: number, y: number): Ray
}

function stage(): Stage {
  const rig = createCameraRig({ scale: 1, bbox: BUILDING })
  rig.setAspect(W / H)
  rig.fitBox(BUILDING)
  const canvas = new FakeCanvas()
  const surfaces: Surface[] = [{ kind: 'box', box: BUILDING }]
  const raycaster = new Raycaster()
  const tmp = new Vector3()
  const settle = (): void => {
    const now = performance.now() + 1e6
    for (let i = 0; i < 240; i++) rig.tick(1 / 60, now + i * 16.7)
    // The renderer does this every drawn frame; the picker's ray reads it.
    rig.camera.updateMatrixWorld()
  }
  const pick = (ndc: Vector2): PickHit | null => {
    raycaster.setFromCamera(ndc, rig.camera)
    let best: PickHit | null = null
    for (const s of surfaces) {
      const p =
        s.kind === 'box' ? raycaster.ray.intersectBox(s.box, tmp) : raycaster.ray.intersectPlane(s.plane, tmp)
      if (!p) continue
      const d = p.distanceTo(raycaster.ray.origin)
      if (!best || d < best.distance) best = { id: 1, point: p.clone(), normal: new Vector3(0, 0, 1), distance: d }
    }
    return best
  }
  const host = {
    canvas: canvas as unknown as HTMLCanvasElement,
    height: () => H,
    camera: () => rig.camera,
    target: () => rig.goal.target,
    groundZ: () => 0,
    scale: () => 1,
    building: () => BUILDING,
    nearScale: () => rig.nearScale(),
    anchor: (depth: number) => rig.anchor(depth),
    pick,
    orbit: (dx: number, dy: number, pivot: Vector3 | null) => rig.orbit(dx, dy, pivot),
    pan: (dx: number, dy: number, h: number) => rig.pan(dx, dy, h),
    dolly: (k: number, at: Vector3 | null) => rig.dolly(k, at),
    frame: () => {},
    hoverAt: () => {},
    hoverLater: () => {},
    hoverCancel: () => {},
    hoverOut: () => {},
    select: () => {},
    context: () => {},
    toolClick: () => {},
    tool: () => 'select'
  }
  attachInput(host as InputHost, new Vector2())
  settle()
  const fire = (type: string, props: Record<string, unknown>): void => {
    canvas.dispatchEvent(
      Object.assign(new Event(type, { cancelable: true }), {
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        ...props
      })
    )
  }
  return {
    rig,
    surfaces,
    settle,
    wheel: (x, y, deltaY) => {
      fire('wheel', { clientX: x, clientY: y, deltaY })
      settle()
    },
    drag: (x0, y0, x1, y1, shift = false) => {
      fire('pointerdown', { clientX: x0, clientY: y0, shiftKey: shift })
      fire('pointermove', { clientX: x1, clientY: y1, shiftKey: shift })
      fire('pointerup', { clientX: x1, clientY: y1, shiftKey: shift })
      settle()
    },
    click: (x, y) => {
      fire('pointerdown', { clientX: x, clientY: y })
      fire('pointerup', { clientX: x, clientY: y })
    },
    screen: (p) => {
      const n = p.clone().project(rig.camera)
      return new Vector2(((n.x + 1) / 2) * W, ((1 - n.y) / 2) * H)
    },
    rayAt: (x, y) => {
      raycaster.setFromCamera(new Vector2((x / W) * 2 - 1, -(y / H) * 2 + 1), rig.camera)
      return raycaster.ray.clone()
    }
  }
}

const forward = (rig: CameraRig): Vector3 => new Vector3(0, 0, -1).applyQuaternion(rig.camera.quaternion)
const groundAt = (s: Stage, x: number, y: number): Vector3 | null =>
  s.rayAt(x, y).intersectPlane(new Plane(new Vector3(0, 0, 1), 0), new Vector3())
const centre = BUILDING.getCenter(new Vector3())

describe('the re-anchored orbit point (2026-11-15) — done line 1: zoom close, then pan far', () => {
  it('pans a surface 88 m away at 1.00× the cursor, and still zooms in towards it', () => {
    const s = stage()
    // A surface 6 m ahead, square to the view, under a cursor at the screen's centre.
    const pos = s.rig.camera.position.clone()
    const fwd = forward(s.rig)
    const near = pos.clone().addScaledVector(fwd, 6)
    s.surfaces.splice(0, s.surfaces.length, {
      kind: 'plane',
      plane: new Plane().setFromNormalAndCoplanarPoint(fwd.clone().negate(), near)
    })
    for (let i = 0; i < 40; i++) s.wheel(W / 2, H / 2, -100)
    // Now a surface 88 m ahead — what the user turns to look at.
    const pos2 = s.rig.camera.position.clone()
    const fwd2 = forward(s.rig)
    const far = pos2.clone().addScaledVector(fwd2, 88)
    s.surfaces.splice(0, s.surfaces.length, {
      kind: 'plane',
      plane: new Plane().setFromNormalAndCoplanarPoint(fwd2.clone().negate(), far)
    })
    const at = s.screen(far)
    s.drag(at.x, at.y, at.x + 100, at.y)
    const moved = s.screen(far).sub(at)
    expect(moved.x / 100).toBeGreaterThan(0.98)
    expect(moved.x / 100).toBeLessThan(1.02)
    expect(Math.abs(moved.y)).toBeLessThan(2)
    // A further notch towards it is taken: the camera comes 10.4 % of the way closer.
    const now = s.screen(far)
    const before = s.rig.camera.position.distanceTo(far)
    s.wheel(now.x, now.y, -100)
    const after = s.rig.camera.position.distanceTo(far)
    expect(after / before).toBeCloseTo(Math.exp(-100 * DOLLY_RATE), 3)
  })
})

describe('the re-anchored orbit point (2026-11-15) — done line 2: zoom out over the ground', () => {
  for (const [where, x, y] of [
    ['in front of the building', W / 2, H - 20],
    ['beside the building', W - 20, H - 20]
  ] as const) {
    it(`pans the building at 0.9–1.1× the cursor after 12 notches out with the cursor ${where}`, () => {
      const s = stage()
      // The cursor is on the ground, not on the building.
      const g = groundAt(s, x, y)
      expect(g).not.toBeNull()
      expect(s.rayAt(x, y).intersectsBox(BUILDING)).toBe(false)
      for (let i = 0; i < 12; i++) s.wheel(x, y, 100)
      // Pressed on empty space: the top-left corner, off the building (the ground is not picked).
      expect(s.rayAt(40, 40).intersectsBox(BUILDING)).toBe(false)
      const at = s.screen(centre)
      s.drag(40, 40, 140, 40)
      const ratio = s.screen(centre).sub(at).x / 100
      expect(ratio).toBeGreaterThan(0.9)
      expect(ratio).toBeLessThan(1.1)
    })
  }
})

describe('the re-anchored orbit point (2026-11-15) — done line 3: the cursor on ground far away', () => {
  /** The pixel whose ray meets the ground 300 m beyond the building's centre, straight back. */
  const farPixel = (s: Stage): Vector2 => {
    const back = forward(s.rig).setZ(0).normalize()
    return s.screen(centre.clone().setZ(0).addScaledVector(back, 300))
  }
  for (const [dir, deltaY] of [
    ['in', -100],
    ['out', 100]
  ] as const) {
    it(`keeps the orbit point within the plan diagonal of the building over 12 notches ${dir}`, () => {
      const s = stage()
      const px = farPixel(s)
      expect(px.x).toBeGreaterThan(0)
      expect(px.x).toBeLessThan(W)
      expect(px.y).toBeGreaterThan(0)
      expect(px.y).toBeLessThan(H)
      for (let i = 0; i < 12; i++) {
        s.wheel(px.x, px.y, deltaY)
        expect(BUILDING.distanceToPoint(s.rig.goal.target)).toBeLessThanOrEqual(PLAN_DIAGONAL)
      }
    })
  }
})

describe('the re-anchored orbit point (2026-11-15) — done line 4: a click re-anchors nothing', () => {
  it('leaves goal and cur unchanged on a press and release with no drag', () => {
    const s = stage()
    const goal = s.rig.getCamera()
    const cur = { dist: s.rig.cur.dist, target: s.rig.cur.target.clone() }
    s.click(W / 2, H / 2)
    s.click(40, 40)
    expect(s.rig.getCamera()).toEqual(goal)
    expect(s.rig.cur.dist).toBe(cur.dist)
    expect(s.rig.cur.target.equals(cur.target)).toBe(true)
  })

  it('does not re-anchor on a 2 px wobble, which is still a click', () => {
    const s = stage()
    const goal = s.rig.getCamera()
    const pos = s.rig.camera.position.clone()
    const at = s.screen(centre)
    s.drag(at.x, at.y, at.x + 2, at.y)
    expect(s.rig.getCamera()).toEqual(goal)
    expect(s.rig.camera.position.distanceTo(pos)).toBeLessThan(1e-6)
  })

  it('re-anchors when the drag starts without the camera jumping: a pan there and back moves nothing', () => {
    const s = stage()
    const pos = s.rig.camera.position.clone()
    const q = s.rig.camera.quaternion.clone()
    const at = s.screen(centre)
    // Past the threshold and back: the drag starts (re-anchor), then a pan of net 0 px.
    s.drag(at.x, at.y, at.x + 10, at.y)
    s.drag(at.x + 10, at.y, at.x, at.y)
    expect(s.rig.camera.position.distanceTo(pos)).toBeLessThan(1e-6)
    expect(Math.abs(s.rig.camera.quaternion.dot(q))).toBeGreaterThan(1 - 1e-12)
  })
})

