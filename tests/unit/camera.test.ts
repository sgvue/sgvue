/**
 * The camera controller's maths, against the numbers in
 * `design-reference/design/viewer-core.js` L258–327.
 *
 * These are the values the design's motion is made of — the 14/5 easing rates, the 620 ms
 * flight, the 1.08 fit margin, the seven-view table and the dist ↔ half conversion — so they
 * are checked as numbers rather than looked at in a screenshot. `camera.ts` deliberately
 * touches no renderer, canvas or DOM, which is what lets this run under Node.
 */
import { Box3, Vector3 } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import {
  EASE_RATE,
  FIT_MARGIN,
  FLY_MS,
  FLY_RATE,
  FOV,
  REFERENCE_RADIUS,
  VIEWS,
  createCameraRig,
  dirOf,
  easeK,
  wrapNear
} from '../../src/renderer/viewer/camera'

/** The design's own mock federation: −8…32 × −8…26 × −1…15.5 m, radius 27.5 m. */
const MOCK = new Box3(new Vector3(-8, -8, -1), new Vector3(32, 26, 15.5))
const rad = (d: number): number => (d * Math.PI) / 180

describe('camera — the design’s constants', () => {
  it('keeps the reference’s field of view, rates, flight and margin', () => {
    expect(FOV).toBe(50)
    expect(EASE_RATE).toBe(14)
    expect(FLY_RATE).toBe(5)
    expect(FLY_MS).toBe(620)
    expect(FIT_MARGIN).toBe(1.08)
  })

  it('has the seven views the design offers, at the design’s angles', () => {
    expect(Object.keys(VIEWS)).toEqual(['iso', 'top', 'bottom', 'north', 'south', 'east', 'west'])
    expect(VIEWS.iso).toEqual([-Math.PI / 4, 1.05])
    expect(VIEWS.top).toEqual([-Math.PI / 2, 0.0001])
    expect(VIEWS.north).toEqual([Math.PI / 2, Math.PI / 2])
    expect(VIEWS.east).toEqual([0, Math.PI / 2])
  })
})

describe('camera — easing', () => {
  it('is 1 − exp(−dt · rate), frame-rate independent', () => {
    expect(easeK(1 / 60, EASE_RATE)).toBeCloseTo(1 - Math.exp(-14 / 60), 12)
    expect(easeK(1 / 60, FLY_RATE)).toBeCloseTo(1 - Math.exp(-5 / 60), 12)
    // Two half-steps equal one whole step: that is the property the form exists for.
    const one = easeK(1 / 30, EASE_RATE)
    const half = easeK(1 / 60, EASE_RATE)
    expect(1 - (1 - half) * (1 - half)).toBeCloseTo(one, 12)
  })

  it('a flight eases more slowly than direct manipulation', () => {
    expect(easeK(1 / 60, FLY_RATE)).toBeLessThan(easeK(1 / 60, EASE_RATE))
  })

  it('walks `cur` towards `goal` and gets there', () => {
    const rig = createCameraRig({ scale: 1, bbox: MOCK })
    rig.setAspect(1440 / 860)
    rig.goal.theta = 1
    rig.goal.dist = 100
    const now = performance.now()
    for (let i = 0; i < 400; i++) rig.tick(1 / 60, now + i * 16.7)
    expect(rig.cur.theta).toBeCloseTo(1, 6)
    expect(rig.cur.dist).toBeCloseTo(100, 6)
  })
})

describe('camera — wrapNear', () => {
  it('brings an angle within half a turn of the reference', () => {
    expect(wrapNear(0, 0)).toBe(0)
    expect(wrapNear(3 * Math.PI, 0)).toBeCloseTo(Math.PI, 12)
    expect(wrapNear(-3 * Math.PI, 0)).toBeCloseTo(-Math.PI, 12)
    // 350° and 10° are 20° apart, not 340°.
    const a = wrapNear(rad(350), rad(10))
    expect(Math.abs(a - rad(10))).toBeLessThanOrEqual(Math.PI)
    expect(a).toBeCloseTo(rad(-10), 12)
  })

  it('leaves an angle already near the reference alone', () => {
    for (const a of [-3, -1, 0, 0.5, 2, 3]) expect(wrapNear(a, a + 0.1)).toBeCloseTo(a, 12)
  })
})

describe('camera — fitBox', () => {
  it('fits the bounding sphere to the cone of vision: r / sin(fov/2) × 1.08', () => {
    const rig = createCameraRig({ scale: 1, bbox: MOCK })
    rig.setAspect(1440 / 860)
    rig.fitBox(MOCK)
    const r = MOCK.getSize(new Vector3()).length() / 2
    expect(r).toBeCloseTo(REFERENCE_RADIUS, 0)
    expect(rig.goal.dist).toBeCloseTo((r / Math.sin(rad(FOV / 2))) * FIT_MARGIN, 10)
    // The prototype reports exactly this for its own federation.
    expect(+rig.goal.dist.toFixed(2)).toBe(70.31)
    expect(rig.goal.target.toArray()).toEqual([12, 9, 7.25])
  })

  it('divides the ortho half-height by the aspect only when it is narrower than 1', () => {
    const wide = createCameraRig({ scale: 1, bbox: MOCK })
    wide.setAspect(1440 / 860)
    wide.fitBox(MOCK)
    const r = MOCK.getSize(new Vector3()).length() / 2
    expect(wide.goal.half).toBeCloseTo(r * FIT_MARGIN, 10)
    expect(+wide.goal.half.toFixed(2)).toBe(29.72)

    const tall = createCameraRig({ scale: 1, bbox: MOCK })
    tall.setAspect(0.5)
    tall.fitBox(MOCK)
    expect(tall.goal.half).toBeCloseTo((r * FIT_MARGIN) / 0.5, 10)
  })

  it('scales its floors with the scene, so a small model is not clamped to a big one’s', () => {
    const tiny = new Box3(new Vector3(0, 0, 0), new Vector3(0.1, 0.1, 0.1))
    const rig = createCameraRig({ scale: 0.2, bbox: tiny })
    rig.setAspect(1)
    rig.fitBox(tiny)
    // r is itself floored at 0.5 × scale, so the framing never collapses on a single wall.
    const r = 0.5 * 0.2
    expect(rig.goal.dist).toBeCloseTo((r / Math.sin(rad(FOV / 2))) * FIT_MARGIN, 10)
    expect(rig.goal.half).toBeCloseTo(r * FIT_MARGIN, 10)
    expect(rig.goal.dist).toBeGreaterThan(1 * 0.2)
  })
})

describe('camera — projection', () => {
  it('converts dist ↔ half and back without moving the framing', () => {
    const rig = createCameraRig({ scale: 1, bbox: MOCK })
    rig.setAspect(1440 / 860)
    rig.fitBox(MOCK)
    const dist = rig.goal.dist
    rig.setProjection('ortho')
    expect(rig.projection).toBe('ortho')
    expect(rig.goal.half).toBeCloseTo(dist * Math.tan(rad(FOV / 2)), 10)
    rig.setProjection('persp')
    expect(rig.projection).toBe('persp')
    expect(rig.goal.dist).toBeCloseTo(dist, 10)
  })

  it('reports the swap to the listener each time', () => {
    const seen: string[] = []
    const rig = createCameraRig({ scale: 1, bbox: MOCK, onProjection: (p) => seen.push(p) })
    rig.setAspect(1)
    rig.setProjection('ortho')
    rig.setProjection('ortho') // already there — no second report
    rig.setProjection('persp')
    expect(seen).toEqual(['ortho', 'persp'])
  })

  it('setView switches projection the way the design does', () => {
    const rig = createCameraRig({ scale: 1, bbox: MOCK })
    rig.setAspect(1)
    expect(rig.projection).toBe('persp')
    rig.setView('north')
    expect(rig.projection).toBe('ortho')
    expect(rig.goal.theta).toBeCloseTo(Math.PI / 2, 12)
    expect(rig.goal.phi).toBeCloseTo(Math.PI / 2, 12)
    rig.setView('iso')
    expect(rig.projection).toBe('persp')
    rig.setView('nonsense')
    expect(rig.goal.theta).toBeCloseTo(-Math.PI / 4, 12)
  })
})

describe('camera — placement', () => {
  it('dirOf is the Z-up spherical direction', () => {
    const v = new Vector3()
    expect(dirOf(0, Math.PI / 2, v).toArray().map((x) => +x.toFixed(9))).toEqual([1, 0, 0])
    expect(dirOf(Math.PI / 2, Math.PI / 2, v).toArray().map((x) => +x.toFixed(9))).toEqual([0, 1, 0])
    expect(dirOf(0, 0, v).toArray().map((x) => +x.toFixed(9))).toEqual([0, 0, 1])
  })

  it('places the camera at dist along that direction, looking at the target, Z-up', () => {
    const rig = createCameraRig({ scale: 1, bbox: MOCK })
    rig.setAspect(1440 / 860)
    rig.fitBox(MOCK)
    rig.cur.theta = rig.goal.theta
    rig.cur.phi = rig.goal.phi
    rig.cur.dist = rig.goal.dist
    rig.cur.target.copy(rig.goal.target)
    rig.place()
    // The prototype's own `debug()` on the same federation.
    expect(rig.camera.position.toArray().map((v) => +v.toFixed(2))).toEqual([55.13, -34.13, 42.24])
    expect(rig.camera.up.toArray()).toEqual([0, 0, 1])
  })

  it('clamps the dolly proportionally to the scene', () => {
    const rig = createCameraRig({ scale: 1, bbox: MOCK })
    rig.setAspect(1)
    rig.goal.dist = 1
    rig.dolly(0.3, null) // 0.3 m — under the 0.4 floor, refused
    expect(rig.goal.dist).toBe(1)
    rig.goal.dist = 800
    rig.dolly(2, null) // 1600 m — over the 900 ceiling, refused
    expect(rig.goal.dist).toBe(800)
    rig.dolly(1.1, null)
    expect(rig.goal.dist).toBeCloseTo(880, 6)
    // And it dollies about the target rather than collapsing it to the world origin, which
    // is what the reference's `hit || t` aliasing does when nothing is under the cursor.
    expect(rig.goal.target.toArray()).toEqual([12, 9, 7.25])
  })

  it('orbits about the target when no pivot is given, without moving it', () => {
    const rig = createCameraRig({ scale: 1, bbox: MOCK })
    rig.setAspect(1)
    rig.fitBox(MOCK)
    const before = rig.goal.dist
    rig.orbit(40, 0, null)
    expect(rig.goal.target.toArray().map((v) => +v.toFixed(6))).toEqual([12, 9, 7.25])
    expect(rig.goal.dist).toBeCloseTo(before, 6)
    expect(rig.goal.theta).not.toBeCloseTo(-Math.PI / 4, 3)
  })

  it('never lets φ reach the pole, so the up vector cannot flip', () => {
    const rig = createCameraRig({ scale: 1, bbox: MOCK })
    rig.setAspect(1)
    for (let i = 0; i < 200; i++) rig.orbit(0, -60, null)
    expect(rig.goal.phi).toBeGreaterThanOrEqual(0.03)
    for (let i = 0; i < 400; i++) rig.orbit(0, 60, null)
    expect(rig.goal.phi).toBeLessThanOrEqual(Math.PI - 0.03)
  })

  it('getCamera / setCamera round-trips the whole state', () => {
    const rig = createCameraRig({ scale: 1, bbox: MOCK })
    rig.setAspect(1)
    rig.fitBox(MOCK)
    const state = rig.getCamera()
    rig.goal.theta = 2
    rig.goal.dist = 5
    rig.setCamera(state)
    expect(rig.getCamera()).toEqual(state)
  })

  it('easeIn starts 1.6× out, as the reference does on first load', () => {
    const rig = createCameraRig({ scale: 1, bbox: MOCK })
    rig.setAspect(1)
    rig.fitBox(MOCK)
    rig.easeIn()
    expect(rig.cur.dist).toBeCloseTo(rig.goal.dist * 1.6, 10)
    expect(rig.cur.target.toArray()).toEqual(rig.goal.target.toArray())
  })
})

describe('camera — the building box (2026-09-24)', () => {
  /** A 25 × 19 m building standing on the mock's 40 × 34 m site. */
  const BUILDING = new Box3(new Vector3(-0.8, -0.8, -1), new Vector3(24.8, 18.8, 15.5))

  it('frames the box it is given for a view preset, and starts on its centre', () => {
    const rig = createCameraRig({ scale: 1, bbox: BUILDING, nearScale: () => 0.6 })
    rig.setAspect(1)
    expect(rig.goal.target.toArray()).toEqual([12, 9, 7.25])
    rig.goal.target.set(0, 0, 0)
    rig.setView('top')
    const r = BUILDING.getSize(new Vector3()).length() / 2
    expect(rig.goal.target.toArray()).toEqual([12, 9, 7.25])
    expect(rig.goal.dist).toBeCloseTo((r / Math.sin(rad(FOV / 2))) * FIT_MARGIN, 10)
  })

  it('takes the near limits from nearScale and keeps the far ones on scale', () => {
    const rig = createCameraRig({ scale: 1, bbox: MOCK, nearScale: () => 0.5 })
    rig.setAspect(1)
    rig.goal.dist = 1
    rig.dolly(0.3, null) // 0.3 m — above 0.4 × 0.5 = 0.2, allowed
    expect(rig.goal.dist).toBeCloseTo(0.3, 10)
    rig.goal.dist = 800
    rig.dolly(2, null) // 1600 m — still over the whole scene's 900 ceiling
    expect(rig.goal.dist).toBe(800)
    // The clip planes cover the whole scene, not the building.
    expect(rig.persp.near).toBe(0.1)
    expect(rig.persp.far).toBe(3000)
  })

  it('floors a fit on nearScale, so a small element can be framed closer', () => {
    const tiny = new Box3(new Vector3(0, 0, 0), new Vector3(0.01, 0.01, 0.01))
    const rig = createCameraRig({ scale: 1, bbox: MOCK, nearScale: () => 0.3 })
    rig.setAspect(1)
    rig.fitBox(tiny)
    expect(rig.goal.dist).toBeCloseTo(Math.max(0.3, ((0.5 * 0.3) / Math.sin(rad(FOV / 2))) * FIT_MARGIN), 10)
    // Below scale / 4 it is clamped: 0.2 frames as 0.25 does.
    const clamped = createCameraRig({ scale: 1, bbox: MOCK, nearScale: () => 0.2 })
    clamped.setAspect(1)
    clamped.fitBox(tiny)
    expect(clamped.goal.dist).toBeCloseTo(((0.5 * 0.25) / Math.sin(rad(FOV / 2))) * FIT_MARGIN, 10)
  })

  it('never lets a dolly reach inside the near clip plane, however small nearScale is', () => {
    const rig = createCameraRig({ scale: 1, bbox: MOCK, nearScale: () => 0.01 })
    rig.setAspect(1)
    rig.goal.dist = 1
    rig.dolly(0.09, null) // 0.09 m — under 0.4 × (1 / 4) = 0.1, refused
    expect(rig.goal.dist).toBe(1)
    rig.dolly(0.1, null) // exactly the floor — allowed, and settled at 0.5 × (1 / 4)
    expect(rig.goal.dist).toBeCloseTo(0.125, 10)
    expect(rig.goal.dist).toBeGreaterThanOrEqual(rig.persp.near)
    // The same for a huge site: scale 60, a 10 m building (nearScale 0.36) floors at 6 m.
    const big = createCameraRig({ scale: 60, bbox: MOCK, nearScale: () => 0.36 })
    big.setAspect(1)
    big.goal.dist = 10
    big.dolly(0.5, null)
    expect(big.goal.dist).toBe(10)
    expect(0.4 * 15).toBeGreaterThanOrEqual(big.persp.near)
  })
})
