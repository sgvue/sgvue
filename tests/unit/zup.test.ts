/**
 * The one place web-ifc's frame meets the app's.
 *
 * `flatTransformation` hands back **Y-up** world geometry — web-ifc folds a Z-up → Y-up swap
 * into it. Everything else in this project is **Z-up**: IFC itself, the design's renderer
 * (`viewer-core.js` sets `camera.up = (0,0,1)` and reads storey elevations off `z`), the mock
 * federation, and every number in `PROGRESS.md`. `geometry-streamer.ts` therefore composes
 * the inverse rotation on the left of every placement, once.
 *
 * Getting this wrong lays the building on its side, which looks like a plausible building
 * until you notice the storeys stack sideways — so it is checked here on numbers, not by eye.
 */
import { describe, expect, it } from 'vitest'
import { Z_UP_FROM_Y_UP, toZUp } from '../../src/worker/geometry-streamer'

/** Apply a column-major 4×4 to a point. */
const apply = (m: ArrayLike<number>, p: readonly [number, number, number]): number[] => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
]

const close = (got: readonly number[], want: readonly number[]): void => {
  expect(got.length).toBe(want.length)
  got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 10))
}

describe('Y-up → Z-up', () => {
  it('turns a Y-up point into the Z-up point (x, −z, y)', () => {
    const out = new Float64Array(16)
    // A pure translation: web-ifc placed the thing at Y-up (3, 10, −7).
    const yUp = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 10, -7, 1]
    toZUp(yUp, out)
    // Up was Y = 10, so in Z-up it is z = 10; and y = −(−7) = 7.
    close([out[12], out[13], out[14]], [3, 7, 10])
    close(apply(out, [0, 0, 0]), [3, 7, 10])
  })

  it('is the constant rotation it documents', () => {
    const out = new Float64Array(16)
    toZUp([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], out)
    close([...out], [...Z_UP_FROM_Y_UP])
  })

  it('takes the Y-up up-axis to +z and leaves x alone', () => {
    const out = new Float64Array(16)
    toZUp([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], out)
    close(apply(out, [1, 0, 0]), [1, 0, 0]) // east stays east
    close(apply(out, [0, 1, 0]), [0, 0, 1]) // Y-up becomes Z-up
    close(apply(out, [0, 0, 1]), [0, -1, 0]) // Y-up's +z is IFC's −y
  })

  it('rotates the linear part too, so a Y-up-tall box becomes Z-up-tall', () => {
    const out = new Float64Array(16)
    // Scale 2 × 8 × 3 about the origin: in Y-up the long axis is Y.
    toZUp([2, 0, 0, 0, 0, 8, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1], out)
    // A unit cube's corner (0.5, 0.5, 0.5) → Y-up (1, 4, 1.5) → Z-up (1, −1.5, 4).
    close(apply(out, [0.5, 0.5, 0.5]), [1, -1.5, 4])
    // The transformed AABB of ±0.5 now spans 2 × 3 × 8: the tall axis is z.
    const corners: [number, number, number][] = []
    for (let c = 0; c < 8; c++) {
      corners.push([c & 1 ? 0.5 : -0.5, c & 2 ? 0.5 : -0.5, c & 4 ? 0.5 : -0.5])
    }
    const pts = corners.map((p) => apply(out, p))
    const span = [0, 1, 2].map(
      (k) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k]))
    )
    close(span, [2, 3, 8])
  })

  it('preserves handedness and lengths (it is a rotation, determinant +1)', () => {
    const out = new Float64Array(16)
    toZUp([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], out)
    const det =
      out[0] * (out[5] * out[10] - out[9] * out[6]) -
      out[4] * (out[1] * out[10] - out[9] * out[2]) +
      out[8] * (out[1] * out[6] - out[5] * out[2])
    expect(det).toBeCloseTo(1, 12)
    const p = apply(out, [3, -4, 12])
    expect(Math.hypot(...p)).toBeCloseTo(13, 10)
  })

  it('reproduces the reference model’s recorded offset and bbox swap', () => {
    // Phase 1b measured, in the old Y-up contract: offset [12520, 4, −23186] m and a recentred
    // bbox of −317.9…107.1 × −4.9…56.0 × −289.8…122.5. The building is 56 m tall, so the
    // small "up" value sat in Y. Under Z-up the same numbers have to read as a 425 m
    // footprint with the height on z.
    const out = new Float64Array(16)
    toZUp([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 12520, 4, -23186, 1], out)
    close([out[12], out[13], out[14]], [12520, 23186, 4])

    const yUpBox: [number, number, number][] = []
    for (const x of [-317.9, 107.1]) {
      for (const y of [-4.9, 56.0]) for (const z of [-289.8, 122.5]) yUpBox.push([x, y, z])
    }
    const id = new Float64Array(16)
    toZUp([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], id)
    const pts = yUpBox.map((p) => apply(id, p))
    const lo = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k])))
    const hi = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])))
    close(lo, [-317.9, -122.5, -4.9])
    close(hi, [107.1, 289.8, 56.0])
    // Up is z, and it is the short axis of a 425 × 412 × 61 m building.
    expect(hi[2] - lo[2]).toBeCloseTo(60.9, 6)
    expect(hi[0] - lo[0]).toBeGreaterThan(hi[2] - lo[2])
  })
})
