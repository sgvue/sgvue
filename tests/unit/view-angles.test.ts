/**
 * The camera's direction as azimuth and elevation — 2026-10-02 (parity with the user, phase 2).
 *
 * The assistant turns the camera with two angles in degrees and reads its direction back the
 * same way; the rig keeps a direction as θ and φ about the point it looks at
 * (`viewer/camera.ts`). `shared/view-angles.ts` is the one place the two meet, and this file is
 * what holds the convention still:
 *
 *   · azimuth is the bearing the camera **looks towards**, clockwise from project north (+Y);
 *   · elevation is how far it looks **down** from level;
 *   · the six named views, said as those two angles, are the camera the view buttons give —
 *     checked on the real rig, by where the camera ends up, not by comparing two formulas;
 *   · the view cube's 26 directions are all reachable, each landing where a click on the cube
 *     lands.
 */
import { Box3, Vector3 } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { VIEW_DIRECTIONS, VIEW_ZOOM_MAX, VIEW_ZOOM_MIN } from '../../src/shared/tool-schemas'
import {
  ON_VIEW_TOLERANCE,
  POLE_PHI,
  VIEWS,
  anglesOf,
  roundedAngles,
  sphericalOf,
  viewOn,
  wrapPi
} from '../../src/shared/view-angles'
import { VIEWS as RIG_VIEWS, createCameraRig, dirOf, type CameraRig } from '../../src/renderer/viewer/camera'
import { cubeZones, FACE_DEFS } from '../../src/renderer/viewer/cube'

const MOCK = new Box3(new Vector3(-8, -8, -1), new Vector3(32, 26, 15.5))
const rad = (d: number): number => (d * Math.PI) / 180
const SIX = ['iso', 'top', 'north', 'south', 'east', 'west'] as const

const newRig = (): CameraRig => {
  const rig = createCameraRig({ scale: 1, bbox: MOCK })
  rig.setAspect(1440 / 860)
  rig.fitBox(MOCK)
  return rig
}
/** Let the ease run out, then read where the camera is and how it is turned. */
const settled = (rig: CameraRig): number[] => {
  const now = performance.now()
  for (let i = 0; i < 600; i++) rig.tick(1 / 60, now + 5000 + i * 16.7)
  return [...rig.camera.position.toArray(), ...rig.camera.quaternion.toArray()].map((v) => +v.toFixed(6))
}

describe('the convention', () => {
  it('azimuth is the bearing the camera looks towards, clockwise from project north', () => {
    // The camera stands opposite to where it looks: looking north, it is south of the target.
    const from = (az: number, el = 0): number[] => {
      const { theta, phi } = sphericalOf(az, el)
      return dirOf(theta, phi, new Vector3()).toArray().map((v) => +v.toFixed(9) + 0)
    }
    expect(from(0)).toEqual([0, -1, 0]) // looks north: stands at −Y
    expect(from(90)).toEqual([-1, 0, 0]) // looks east: stands at −X
    expect(from(180)).toEqual([0, 1, 0]) // looks south: stands at +Y
    expect(from(270)).toEqual([1, 0, 0]) // looks west: stands at +X
    // North-east is between north and east, clockwise: the camera stands south-west.
    const ne = from(45)
    expect(ne[0]).toBeCloseTo(-Math.SQRT1_2, 9)
    expect(ne[1]).toBeCloseTo(-Math.SQRT1_2, 9)
  })

  it('elevation is how far it looks down: 0 level, 90 straight down, −90 straight up', () => {
    const z = (el: number): number => {
      const { theta, phi } = sphericalOf(0, el)
      return dirOf(theta, phi, new Vector3()).z
    }
    expect(z(0)).toBeCloseTo(0, 9)
    // Looking down, the camera is above its target; looking up, below.
    expect(z(30)).toBeCloseTo(Math.sin(rad(30)), 9)
    expect(z(90)).toBeCloseTo(1, 6)
    expect(z(-90)).toBeCloseTo(-1, 6)
    // The rig's own clamp: straight down is `POLE_PHI` off vertical, never on it.
    expect(sphericalOf(0, 90).phi).toBe(POLE_PHI)
    expect(sphericalOf(0, -90).phi).toBe(Math.PI - POLE_PHI)
    expect(sphericalOf(0, 400).phi).toBe(POLE_PHI)
    expect(POLE_PHI).toBe(0.0001)
  })

  it('is against the project frame: the cube’s labelled faces are those bearings', () => {
    // `FACE_DEFS` is the direction each face looks **from**: N from +Y, E from +X.
    const face = Object.fromEntries(FACE_DEFS.map(([label, d]) => [label, d]))
    expect([face.N, face.E, face.S, face.W]).toEqual([
      [0, 1, 0],
      [1, 0, 0],
      [0, -1, 0],
      [-1, 0, 0]
    ])
    // From the north face the camera looks south: azimuth 180.
    const fromNorth = sphericalOf(180, 0)
    expect(dirOf(fromNorth.theta, fromNorth.phi, new Vector3()).toArray().map((v) => +v.toFixed(9) + 0)).toEqual(face.N)
  })

  it('goes there and back: every angle reads back as it was set', () => {
    for (const az of [0, 12.5, 45, 90, 135, 180, 225, 270, 315, 359.9]) {
      for (const el of [-89, -45, 0, 12.3, 29.8, 45, 60, 89]) {
        const { theta, phi } = sphericalOf(az, el)
        const back = anglesOf(theta, phi)
        expect([az, el, back.azimuthDeg, back.elevationDeg].map((v) => +v.toFixed(8))).toEqual([az, el, az, el])
        // θ is kept in the range the named views are written in.
        expect(theta).toBeGreaterThan(-Math.PI - 1e-12)
        expect(theta).toBeLessThanOrEqual(Math.PI + 1e-12)
      }
    }
    // A whole turn is no turn, either way round.
    expect(anglesOf(sphericalOf(360, 0).theta, Math.PI / 2).azimuthDeg).toBeCloseTo(0, 9)
    expect(anglesOf(sphericalOf(-90, 0).theta, Math.PI / 2).azimuthDeg).toBeCloseTo(270, 9)
    expect(anglesOf(sphericalOf(725, 0).theta, Math.PI / 2).azimuthDeg).toBeCloseTo(5, 9)
  })

  it('wrapPi keeps an angle in (−π, π]', () => {
    expect(wrapPi(0)).toBe(0)
    expect(wrapPi(Math.PI)).toBe(Math.PI)
    expect(wrapPi(-Math.PI)).toBe(Math.PI)
    expect(wrapPi(3 * Math.PI)).toBeCloseTo(Math.PI, 12)
    expect(wrapPi(-Math.PI / 2 - 2 * Math.PI)).toBeCloseTo(-Math.PI / 2, 12)
  })

  it('reports to one decimal, and never an azimuth of 360', () => {
    expect(roundedAngles(...VIEWS.iso)).toEqual({ azimuthDeg: 315, elevationDeg: 29.8 })
    expect(roundedAngles(...VIEWS.top)).toEqual({ azimuthDeg: 0, elevationDeg: 90 })
    expect(roundedAngles(...VIEWS.bottom)).toEqual({ azimuthDeg: 0, elevationDeg: -90 })
    // 359.97° rounds up to a whole turn, which is 0 — and a −0 is 0.
    const nearly = sphericalOf(359.97, 0)
    expect(roundedAngles(nearly.theta, nearly.phi)).toEqual({ azimuthDeg: 0, elevationDeg: 0 })
    expect(Object.is(roundedAngles(-Math.PI / 2, Math.PI / 2).elevationDeg, 0)).toBe(true)
    expect(Object.is(roundedAngles(-Math.PI / 2, Math.PI / 2).azimuthDeg, 0)).toBe(true)
  })
})

describe('the named views, said as angles', () => {
  it('is the rig’s own table — moved, not copied', () => {
    expect(RIG_VIEWS).toBe(VIEWS)
    expect(Object.keys(VIEWS)).toEqual(['iso', 'top', 'bottom', 'north', 'south', 'east', 'west'])
  })

  it('are the numbers set_view’s description gives — as they are read back, and as they are taken', () => {
    expect(Object.keys(VIEW_DIRECTIONS).sort()).toEqual([...SIX].sort())
    for (const name of SIX) {
      const [az, el] = VIEW_DIRECTIONS[name]
      // Read back: a camera on that view reports exactly the description's two numbers.
      expect([name, roundedAngles(...VIEWS[name])]).toEqual([name, { azimuthDeg: az, elevationDeg: el }])
      // Taken: the description's two numbers, sent back as a direction, are that view — which
      // `iso` was not while it was quoted as 315 / 30 (0.003 rad off; the tolerance is 0.001).
      const sent = sphericalOf(az, el)
      expect([name, viewOn(sent.theta, sent.phi)]).toEqual([name, name])
    }
    const thirty = sphericalOf(315, 30)
    expect(viewOn(thirty.theta, thirty.phi)).toBeNull()
    // The elevations of the four elevations are exactly level, and their bearings exact.
    expect(anglesOf(...VIEWS.south)).toEqual({ azimuthDeg: 0, elevationDeg: 0 })
    expect(anglesOf(...VIEWS.north).azimuthDeg).toBeCloseTo(180, 9)
    expect(anglesOf(...VIEWS.east).azimuthDeg).toBeCloseTo(270, 9)
    expect(anglesOf(...VIEWS.west).azimuthDeg).toBeCloseTo(90, 9)
  })

  it('each of the six, expressed as azimuth and elevation, lands on the same camera', () => {
    for (const name of SIX) {
      // The view button: turn, frame the building, take the view's own projection.
      const byName = newRig()
      byName.setView(name)
      // The same camera asked for as a direction, a fit and a projection.
      const { azimuthDeg, elevationDeg } = anglesOf(...VIEWS[name])
      const { theta, phi } = sphericalOf(azimuthDeg, elevationDeg)
      const byAngle = newRig()
      byAngle.setAngles(theta, phi)
      byAngle.fitBox(MOCK)
      byAngle.setProjection(name === 'iso' ? 'persp' : 'ortho')

      expect([name, byAngle.projection]).toEqual([name, byName.projection])
      expect([name, +byAngle.goal.phi.toFixed(9), +wrapPi(byAngle.goal.theta - byName.goal.theta).toFixed(9) + 0]).toEqual([
        name,
        +byName.goal.phi.toFixed(9),
        0
      ])
      // …and it is the same picture: position and orientation, once the ease has run out.
      expect([name, settled(byAngle)]).toEqual([name, settled(byName)])
    }
  })

  it('names the view a direction stands on, and nothing for one that is merely near', () => {
    for (const [name, [theta, phi]] of Object.entries(VIEWS)) expect([name, viewOn(theta, phi)]).toEqual([name, name])
    // The same direction a whole turn round is the same view.
    expect(viewOn(VIEWS.west[0] - 2 * Math.PI, VIEWS.west[1])).toBe('west')
    expect(viewOn(-Math.PI, Math.PI / 2)).toBe('west')
    // A degree off is on no view; a tenth of the tolerance off still is.
    expect(viewOn(VIEWS.iso[0] + rad(1), VIEWS.iso[1])).toBeNull()
    expect(viewOn(VIEWS.iso[0], VIEWS.iso[1] + rad(1))).toBeNull()
    expect(viewOn(VIEWS.iso[0] + ON_VIEW_TOLERANCE / 10, VIEWS.iso[1])).toBe('iso')
    // Straight down with east up the screen is not the plan view: north is up in that one.
    expect(viewOn(sphericalOf(90, 90).theta, POLE_PHI)).toBeNull()
    expect(viewOn(sphericalOf(0, 90).theta, POLE_PHI)).toBe('top')
  })
})

describe('the rig takes any direction, and a zoom on its fit', () => {
  it('setAngles reaches all 26 of the view cube’s directions, each where a click on the cube lands', () => {
    const zones = cubeZones()
    expect(zones).toHaveLength(26)
    for (const { sign } of zones) {
      const [x, y, z] = sign
      // A click on the cube: look **from** this direction.
      const byCube = newRig()
      byCube.viewDir(new Vector3(x, y, z))
      // The same, said as a bearing and a tilt: the camera looks along −sign.
      const flat = Math.hypot(x, y)
      const azimuth = flat ? (Math.atan2(-x, -y) * 180) / Math.PI : 0
      const elevation = (Math.atan2(z, flat) * 180) / Math.PI
      const to = sphericalOf(azimuth, elevation)
      const byAngle = newRig()
      byAngle.setAngles(to.theta, to.phi)
      expect([sign, +byAngle.goal.phi.toFixed(9), +wrapPi(byAngle.goal.theta - byCube.goal.theta).toFixed(9) + 0]).toEqual([
        sign,
        +byCube.goal.phi.toFixed(9),
        0
      ])
    }
  })

  it('setAngles keeps the bearing it is given at a pole, which viewDir cannot', () => {
    // Straight down with east up the screen: `viewDir` has only a vector, and chooses north.
    const east = sphericalOf(90, 90)
    const rig = newRig()
    rig.setAngles(east.theta, east.phi)
    expect(rig.goal.phi).toBe(POLE_PHI)
    expect(wrapPi(rig.goal.theta - east.theta)).toBeCloseTo(0, 12)
    expect(anglesOf(rig.goal.theta, rig.goal.phi).azimuthDeg).toBeCloseTo(90, 9)
    const byVector = newRig()
    byVector.viewDir(new Vector3(0, 0, 1))
    expect(byVector.goal.theta).toBe(-Math.PI / 2)
    // φ is held clear of both poles whatever is asked.
    rig.setAngles(0, -3)
    expect(rig.goal.phi).toBe(POLE_PHI)
    rig.setAngles(0, 9)
    expect(rig.goal.phi).toBe(Math.PI - POLE_PHI)
  })

  it('setAngles turns the camera where it stands: the target and the distance stay', () => {
    const rig = newRig()
    rig.goal.target.set(3, 4, 5)
    rig.goal.dist = 22
    const to = sphericalOf(200, 15)
    rig.setAngles(to.theta, to.phi)
    expect(rig.goal.target.toArray()).toEqual([3, 4, 5])
    expect(rig.goal.dist).toBe(22)
    // It takes the short way round: `cur` is brought within half a turn of the goal.
    expect(Math.abs(rig.cur.theta - rig.goal.theta)).toBeLessThanOrEqual(Math.PI)
  })

  it('fitBox with a zoom scales the fit, and without one is exactly what it was', () => {
    const plain = newRig()
    const dist = plain.goal.dist
    const half = plain.goal.half
    const same = newRig()
    same.fitBox(MOCK, 1)
    expect([same.goal.dist, same.goal.half]).toEqual([dist, half])

    const closer = newRig()
    closer.fitBox(MOCK, 2)
    expect(closer.goal.dist).toBeCloseTo(dist / 2, 10)
    expect(closer.goal.half).toBeCloseTo(half / 2, 10)
    expect(closer.goal.target.toArray()).toEqual(plain.goal.target.toArray())
    const wider = newRig()
    wider.fitBox(MOCK, 0.5)
    expect(wider.goal.dist).toBeCloseTo(dist * 2, 10)
    // Both are scaled, so a projection swap keeps the framing at any zoom.
    closer.setProjection('ortho')
    expect(closer.goal.half).toBeCloseTo((dist / 2) * Math.tan(rad(25)), 10)
  })

  it('holds a zoom to the limits the wheel is held to', () => {
    // The tool's own range cannot reach them on the mock…
    const rig = newRig()
    rig.fitBox(MOCK, VIEW_ZOOM_MAX)
    expect(rig.goal.dist).toBeCloseTo(70.31 / VIEW_ZOOM_MAX, 2)
    rig.fitBox(MOCK, VIEW_ZOOM_MIN)
    expect(rig.goal.dist).toBeCloseTo(703.1, 0)
    // …but a tiny box can: the camera never comes inside 0.4 × the near scale, nor an ortho
    // half-height under 0.15 × it, and never goes past 900 × / 400 × the scene's scale.
    const tiny = new Box3(new Vector3(0, 0, 0), new Vector3(0.1, 0.1, 0.1))
    rig.fitBox(tiny, 1000)
    expect(rig.goal.dist).toBe(0.4)
    expect(rig.goal.half).toBe(0.15)
    rig.fitBox(MOCK, 0.0001)
    expect(rig.goal.dist).toBe(900)
    expect(rig.goal.half).toBe(400)
    // A zoom that is not a positive number is no zoom.
    rig.fitBox(MOCK, 0)
    expect(+rig.goal.dist.toFixed(2)).toBe(70.31)
    rig.fitBox(MOCK, -3)
    expect(+rig.goal.dist.toFixed(2)).toBe(70.31)
  })
})
