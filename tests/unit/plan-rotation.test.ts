/**
 * The plan rotation — 2026-11-07, the owner: *"I dont want my gridlines to be place diagonally
 * relative to my building."* Only the camera turns (`shared/plan-rotation.ts`): the dominant grid
 * direction, length-weighted, folded modulo 90° by a 4θ circular mean, summed in a canonical order
 * so every load order gives the same number to the bit; with no grids the site rotation the most
 * elements share; else 0. And the camera's named views and read-back stand on it
 * (`shared/view-angles.ts`, `viewer/camera.ts`).
 */
import { Box3, Vector3 } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import {
  SQUARE_EPSILON_DEG,
  foldQuarter,
  gridPlanRotationDeg,
  planRotationDeg,
  sitePlanRotationDeg,
  turnXY,
  type PlanModel
} from '../../src/shared/plan-rotation'
import { VIEWS, anglesOf, roundedAngles, sphericalOf, viewOn, viewTheta, wrapPi } from '../../src/shared/view-angles'
import { createCameraRig, dirOf } from '../../src/renderer/viewer/camera'
import type { Georeference } from '../../src/shared/model-index.types'

const none: Georeference = { source: 'none', sources: [], method: 'none' }
const rad = (d: number): number => (d * Math.PI) / 180

/** A grid segment `len` long at `deg`, through `at`. */
const seg = (name: string, deg: number, len = 30, at: readonly [number, number] = [0, 0]) => ({
  name,
  start: [at[0], at[1]] as const,
  end: [at[0] + len * Math.cos(rad(deg)), at[1] + len * Math.sin(rad(deg))] as const
})
const model = (
  modelKey: string,
  grids: PlanModel['grids'],
  elements = 100,
  georef: Georeference = none
): PlanModel => ({ modelKey, grids, georef, counts: { elements } })
const turnedSite = (deg: number): Georeference => ({
  source: 'IfcSite',
  sources: ['IfcSite'],
  method: 'IfcSite placement',
  site: { placement: [1, 2, 0], rotationDeg: deg }
})

/** Every order of `list`. */
const permutations = <T>(list: readonly T[]): T[][] =>
  list.length <= 1
    ? [[...list]]
    : list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [x, ...rest]))

describe('foldQuarter — an angle modulo 90°, in (−45°, 45°]', () => {
  it('keeps 0, folds 90 onto 0, and keeps 45 on the +45 side', () => {
    expect(foldQuarter(0)).toBe(0)
    expect(foldQuarter(90)).toBe(0)
    expect(foldQuarter(-90)).toBe(0)
    expect(foldQuarter(45)).toBe(45)
    expect(foldQuarter(-45)).toBe(45)
    expect(foldQuarter(44.99)).toBeCloseTo(44.99, 9)
    expect(foldQuarter(45.01)).toBeCloseTo(-44.99, 9)
    expect(foldQuarter(89.99)).toBeCloseTo(-0.01, 9)
    expect(foldQuarter(136.5897)).toBeCloseTo(-43.4103, 9)
  })
})

describe('the grids’ vote — a length-weighted 4θ mean', () => {
  it('is exactly 0 for axis-aligned grids, and for 89.99° it is −0.01°', () => {
    expect(gridPlanRotationDeg([model('A', [seg('A', 0), seg('1', 90)])])).toBe(0)
    expect(gridPlanRotationDeg([model('A', [seg('A', 89.99)])])).toBeCloseTo(-0.01, 9)
  })

  it('reads two square families as one plan: 46.59° and 136.59° are −43.41°', () => {
    const deg = planRotationDeg([model('A', [seg('A', 46.5897), seg('B', 46.5897, 30, [5, 0]), seg('1', 136.5897)])])
    expect(deg).toBeCloseTo(-43.4103, 9)
    // In that plan, every grid runs at 0° or 90°.
    for (const d of [46.5897, 136.5897]) expect(Math.abs(foldQuarter(d - deg))).toBeLessThan(1e-9)
  })

  it('takes 44.99° and 45.01° to opposite ends of the range — the same plan, a hair either side', () => {
    expect(gridPlanRotationDeg([model('A', [seg('A', 44.99)])])).toBeCloseTo(44.99, 9)
    expect(gridPlanRotationDeg([model('A', [seg('A', 45.01)])])).toBeCloseTo(-44.99, 9)
  })

  it('weights by length, so a long family outvotes a short stray one', () => {
    const deg = gridPlanRotationDeg([model('A', [seg('A', 10, 100), seg('B', 100, 100), seg('X', 30, 10)])])!
    expect(deg).toBeGreaterThan(10)
    expect(deg).toBeLessThan(12)
  })

  it('leaves a segment under 2.5 m out — it states a direction, not an extent', () => {
    expect(gridPlanRotationDeg([model('A', [seg('A', 0), seg('S', 30, 2)])])).toBe(0)
    expect(gridPlanRotationDeg([model('A', [seg('S', 30, 2)])])).toBeNull()
  })

  it('says nothing when two families 45° apart cancel, and the site decides', () => {
    const models = [model('A', [seg('A', 0), seg('B', 45)], 10, turnedSite(20))]
    expect(gridPlanRotationDeg(models)).toBeNull()
    expect(planRotationDeg(models)).toBe(20)
  })

  it('is the same number, to the bit, in every order — across models and within one', () => {
    const models = [
      model('ARC', [seg('A', 12.3, 41), seg('1', 102.3, 17.5, [3, 4]), seg('2', 102.3, 17.5, [9, 4])]),
      model('STR', [seg('A', 12.31, 40), seg('B', 12.29, 40, [1, 7])]),
      model('MEP', [seg('C', 101.9, 13)]),
      model('SIT', [seg('Z', 13.4, 77)])
    ]
    const want = planRotationDeg(models)
    for (const order of permutations(models)) {
      expect(planRotationDeg(order)).toBe(want)
      // …and with each model's own grids reversed.
      expect(planRotationDeg(order.map((m) => ({ ...m, grids: [...m.grids].reverse() })))).toBe(want)
    }
  })
})

describe('with no grids, the site rotation the most elements share — else 0', () => {
  it('takes the folded site turn with the most elements behind it, a model with no turn voting 0', () => {
    const models = [
      model('A', [], 300, turnedSite(-43.4103)),
      model('B', [], 200, turnedSite(46.5897)),
      model('C', [], 400, none)
    ]
    // −43.4103 and 46.5897 are one plan: 500 elements against the 400 at 0°.
    expect(sitePlanRotationDeg(models)).toBeCloseTo(-43.4103, 9)
    expect(planRotationDeg(models)).toBeCloseTo(-43.4103, 9)
    for (const order of permutations(models)) expect(planRotationDeg(order)).toBe(planRotationDeg(models))
  })

  it('breaks a tie by the smallest model key, and reads a tilted site as no turn', () => {
    const tie = [model('Z', [], 100, turnedSite(30)), model('M', [], 100, turnedSite(-20))]
    expect(planRotationDeg(tie)).toBeCloseTo(-20, 9)
    expect(planRotationDeg([...tie].reverse())).toBe(planRotationDeg(tie))
    const tilted: Georeference = { ...turnedSite(30), site: { placement: [1, 2, 0], rotationDeg: 30, pureZRotation: false } }
    expect(planRotationDeg([model('T', [], 10, tilted)])).toBe(0)
  })

  it('is 0 with nothing loaded, and for a site at a hair of a turn', () => {
    expect(planRotationDeg([])).toBe(0)
    expect(planRotationDeg([model('A', [], 10, turnedSite(SQUARE_EPSILON_DEG / 2))])).toBe(0)
  })
})

describe('turnXY', () => {
  it('turns anticlockwise, and hands a point back untouched at 0', () => {
    const p: [number, number] = [3.25, -7.5]
    expect(turnXY(p, 0)).toEqual(p)
    const q = turnXY([1, 0], rad(90))
    expect(q[0]).toBeCloseTo(0, 12)
    expect(q[1]).toBeCloseTo(1, 12)
    const back = turnXY(turnXY(p, 0.7), -0.7)
    expect(back[0]).toBeCloseTo(p[0], 12)
    expect(back[1]).toBeCloseTo(p[1], 12)
  })
})

describe('the camera on a turned plan', () => {
  const RHO = rad(-43.4103)
  const BOX = new Box3(new Vector3(-10, -10, 0), new Vector3(10, 10, 6))

  it('says azimuth against project north — the plan’s +Y — and round-trips', () => {
    for (const [az, el] of [
      [0, 0],
      [90, 0],
      [215.5, 30],
      [315, 29.8],
      [12, -45]
    ]) {
      const { theta, phi } = sphericalOf(az, el, RHO)
      const back = anglesOf(theta, phi, RHO)
      expect(back.azimuthDeg).toBeCloseTo(az, 9)
      expect(back.elevationDeg).toBeCloseTo(el, 9)
      // The same direction in the world is the plan's turned by ρ.
      expect(wrapPi(theta - sphericalOf(az, el).theta - RHO)).toBeCloseTo(0, 12)
    }
    // Looking at project north, in the world, looks along the plan's +Y.
    const north = sphericalOf(0, 0, RHO)
    const d = dirOf(north.theta, north.phi, new Vector3()).negate()
    expect(d.x).toBeCloseTo(Math.cos(RHO + Math.PI / 2), 12)
    expect(d.y).toBeCloseTo(Math.sin(RHO + Math.PI / 2), 12)
  })

  it('recognises every named view after the turn, and only in the plan it was asked in', () => {
    for (const name of Object.keys(VIEWS)) {
      const theta = viewTheta(name, RHO)!
      expect(viewOn(theta, VIEWS[name][1], RHO)).toBe(name)
      // Read against the unturned table it is no view at all.
      if (name !== 'top' && name !== 'bottom') expect(viewOn(theta, VIEWS[name][1], 0)).toBeNull()
    }
    expect(viewTheta('nowhere', RHO)).toBeNull()
    const south = roundedAngles(viewTheta('south', RHO)!, VIEWS.south[1], RHO)
    expect(south).toEqual({ azimuthDeg: 0, elevationDeg: 0 })
  })

  it('puts the rig’s presets on the turned plan: Plan has project north up the screen, the iso starts turned', () => {
    let rho = RHO
    const rig = createCameraRig({ scale: 1, bbox: BOX, planRotation: () => rho })
    rig.setAspect(1.5)
    expect(viewOn(rig.goal.theta, rig.goal.phi, RHO)).toBe('iso')
    for (const name of ['top', 'north', 'south', 'east', 'west', 'iso']) {
      rig.setView(name)
      expect(viewOn(rig.goal.theta, rig.goal.phi, RHO)).toBe(name)
    }
    rig.setView('top')
    rig.tick(10, performance.now() + 10_000)
    rig.place()
    rig.camera.updateMatrixWorld()
    // Screen up is the camera's +Y: the plan's +Y, turned by ρ in the world.
    const up = new Vector3(0, 1, 0).applyQuaternion(rig.camera.quaternion)
    expect(up.x).toBeCloseTo(Math.cos(RHO + Math.PI / 2), 3)
    expect(up.y).toBeCloseTo(Math.sin(RHO + Math.PI / 2), 3)
    // Straight down from the cube's TOP face is the same Plan.
    rig.viewDir(new Vector3(0, 0, 1))
    expect(viewOn(rig.goal.theta, rig.goal.phi, RHO)).toBe('top')
    // At ρ = 0 the table is the design's own.
    rho = 0
    rig.setView('north')
    expect(rig.goal.theta).toBe(VIEWS.north[0])
  })
})

describe('the assistant reads the camera back against project north', () => {
  it('names the view and says its azimuth in the turned plan', async () => {
    const { cameraBrief } = await import('../../src/shared/ai-schema')
    const rho = rad(-43.4103)
    const west = cameraBrief({ theta: viewTheta('west', rho)!, phi: VIEWS.west[1], proj: 'ortho', rho })
    expect(west).toEqual({ view: 'west', projection: 'ortho', azimuthDeg: 90, elevationDeg: 0 })
    // Without the plan rotation the same pose is no named view, at the world's bearing.
    const world = cameraBrief({ theta: viewTheta('west', rho)!, phi: VIEWS.west[1], proj: 'ortho' })
    expect(world.view).toBeNull()
    expect(world.azimuthDeg).toBeCloseTo(133.4, 1)
  })
})
