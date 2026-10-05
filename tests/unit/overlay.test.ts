/**
 * The DOM label maths — `design-reference/design/viewer-core.js` L147–165.
 *
 * Three corrections, each a fidelity number: the ±1.3 NDC cull, the `[hw+6, w−hw−6]` clamp
 * and the `2·hh + 3` stacking gap. All three are exported as pure functions precisely so they
 * can be checked here without a document.
 */
import { PerspectiveCamera, Vector2, Vector3 } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import {
  CLAMP_MARGIN,
  NDC_CULL,
  OCCLUSION_EVERY,
  STACK_GAP,
  clampLabel,
  projectLabel,
  stackLabel,
  toPixels
} from '../../src/renderer/viewer/overlay'

const W = 1000
const H = 500

/** Z-up, looking along +y from −y, as the viewer's cameras are set up. */
function camera(): PerspectiveCamera {
  const c = new PerspectiveCamera(50, W / H, 0.1, 1000)
  c.up.set(0, 0, 1)
  c.position.set(0, -20, 0)
  c.lookAt(0, 0, 0)
  c.updateMatrixWorld(true)
  c.updateProjectionMatrix()
  return c
}

describe('projectLabel', () => {
  it('puts the centre of the frustum in the centre of the viewport', () => {
    const p = projectLabel(new Vector3(0, 0, 0), camera(), W, H)
    expect(p.x).toBeCloseTo(W / 2, 4)
    expect(p.y).toBeCloseTo(H / 2, 4)
    expect(p.behind).toBe(false)
    expect(p.off).toBe(false)
  })

  it('adds the label offset in pixels, after the projection', () => {
    const p = projectLabel(new Vector3(0, 0, 0), camera(), W, H, 7, -22)
    expect(p.x).toBeCloseTo(W / 2 + 7, 4)
    expect(p.y).toBeCloseTo(H / 2 - 22, 4)
  })

  it('reports a point behind the camera as behind, never merely off', () => {
    // 40 m the other side of a camera standing at y = −20 looking at +y.
    const p = projectLabel(new Vector3(0, -60, 0), camera(), W, H)
    expect(p.behind).toBe(true)
    expect(p.off).toBe(true)
  })

  it('culls outside ±1.3 NDC and keeps what is inside it', () => {
    const cam = camera()
    // Walk +z until the projected NDC y crosses 1.3, and check the flag flips with it.
    const v = new Vector3()
    let inside: Vector3 | null = null
    let outside: Vector3 | null = null
    for (let z = 0; z < 60; z += 0.25) {
      v.set(0, 0, z)
      const ndcY = v.clone().project(cam).y
      if (ndcY < NDC_CULL - 0.05) inside = new Vector3(0, 0, z)
      if (ndcY > NDC_CULL + 0.05 && !outside) outside = new Vector3(0, 0, z)
    }
    expect(projectLabel(inside!, cam, W, H).off).toBe(false)
    expect(projectLabel(outside!, cam, W, H).off).toBe(true)
    expect(NDC_CULL).toBe(1.3)
  })
})

describe('clampLabel', () => {
  it('leaves a label that is already inside alone', () => {
    expect(clampLabel(500, 250, 40, 10, W, H)).toEqual({ x: 500, y: 250 })
  })

  it('pins a label 6 px inside each edge, by its own half-size', () => {
    expect(clampLabel(-300, -80, 40, 10, W, H)).toEqual({
      x: 40 + CLAMP_MARGIN,
      y: 10 + CLAMP_MARGIN
    })
    expect(clampLabel(9000, 9000, 40, 10, W, H)).toEqual({
      x: W - 40 - CLAMP_MARGIN,
      y: H - 10 - CLAMP_MARGIN
    })
    expect(CLAMP_MARGIN).toBe(6)
  })
})

describe('stackLabel', () => {
  it('never moves the first label: `lastStack` starts at Infinity', () => {
    expect(stackLabel(300, 10, Infinity)).toBe(300)
  })

  it('pushes a label up so it clears the one below by 2·hh + 3', () => {
    const hh = 10
    // The label below settled at 300; anything lower than 300 − 23 is pushed to exactly that.
    expect(stackLabel(299, hh, 300)).toBe(300 - (2 * hh + STACK_GAP))
    expect(stackLabel(400, hh, 300)).toBe(277)
    expect(STACK_GAP).toBe(3)
  })

  it('leaves a label that already clears the one below where it is', () => {
    expect(stackLabel(200, 10, 300)).toBe(200)
  })

  it('stacks a column monotonically upwards', () => {
    const hh = 10
    let last = Infinity
    const ys: number[] = []
    for (const want of [400, 400, 400, 120]) {
      last = stackLabel(want, hh, last)
      ys.push(last)
    }
    expect(ys).toEqual([400, 377, 354, 120])
  })
})

describe('toPixels', () => {
  it('agrees with projectLabel when there is no offset', () => {
    const cam = camera()
    const p = new Vector3(3, 1, 2)
    const out = toPixels(p, cam, W, H, new Vector2())
    const ref = projectLabel(p, cam, W, H)
    expect(out.x).toBeCloseTo(ref.x, 6)
    expect(out.y).toBeCloseTo(ref.y, 6)
  })
})

describe('the occlusion throttle', () => {
  it('is every fourth frame (L708)', () => {
    expect(OCCLUSION_EVERY).toBe(4)
  })
})
