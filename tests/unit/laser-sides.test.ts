/**
 * 2026-10-08 — the laser meter reads each side of its point (owner-requested: *"show left and
 * right dimension from the spot, rather than overall"*).
 *
 * The annotation layer itself (`viewer/annotations.ts`), on a stub host whose rays hit faces at
 * fixed coordinates and a stub overlay that keeps its labels in a list: the record it publishes,
 * the labels it draws and where they stand, the live reading under the pointer, and a dropped
 * measurement taking every one of its labels with it. The label markup is
 * `shared/annotate.ts`'s, checked character by character in `annotate.test.ts`.
 *
 * Each side is measured **along the axis** from the point (the review of 2026-10-08): the ray
 * starts `LASER_LIFT` off the surface, and across the axis that lift is no part of a length. So
 * the two sides add up to the whole ray exactly, which every case below pins.
 */
import { Box3, Vector3 } from 'three/webgpu'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  LASER_LIFT,
  laserLabelHtml,
  laserLabelOffset,
  laserLiveHtml,
  type LaserAxis
} from '../../src/shared/annotate'
import {
  createAnnotations,
  type AnnotationHost,
  type Annotations,
  type MeasureRecord
} from '../../src/renderer/viewer/annotations'
import type { Label, LabelOverlay } from '../../src/renderer/viewer/overlay'

/**
 * The faces the rays meet, by direction: a room 3.5 m across in X (−1.2 … 2.3), 2.7 m tall
 * (floor −0.9, ceiling 1.8), and open to +Y — a ray that way hits nothing.
 */
const FACES: Readonly<Record<string, number>> = { '+X': 2.3, '-X': -1.2, '-Y': -4, '+Z': 1.8, '-Z': -0.9 }
const AXIS_INDEX: Record<LaserAxis, 0 | 1 | 2> = { X: 0, Y: 1, Z: 2 }

let faces: Record<string, number>
let labels: Label[]
let published: MeasureRecord[]
let ann: Annotations

/** A label as the overlay would make it, minus the DOM: what the layer wrote into it is kept. */
function stubOverlay(): LabelOverlay {
  return {
    labels,
    labelBase: () => ({ border: '1px solid var(--border-strong)' }),
    mkLabel: (pos, html, style = {}, dx = 0, dy = 0) => {
      const el = { innerHTML: html, style: { ...style }, title: '', addEventListener: () => {} }
      const label: Label = {
        el: el as unknown as HTMLDivElement,
        pos: pos.clone(),
        dx,
        dy,
        on: true,
        remove: () => {
          labels.splice(labels.indexOf(label), 1)
        }
      }
      labels.push(label)
      return label
    },
    mkElement: () => {
      throw new Error('not used by the laser')
    },
    update: () => {},
    updateOcclusion: () => false,
    dispose: () => {}
  }
}

function stubHost(): AnnotationHost {
  return {
    overlay: stubOverlay(),
    materials: { laser: {}, laserPreview: {} } as unknown as AnnotationHost['materials'],
    bbox: new Box3(new Vector3(-8, -8, -1), new Vector3(32, 26, 15.5)),
    scale: () => 1,
    frame: new Box3(new Vector3(-8, -8, -1), new Vector3(32, 26, 15.5)),
    frameScale: () => 1,
    groundZ: () => 0,
    camera: () => {
      throw new Error('not used by the laser')
    },
    view: () => ({ theta: 0, phi: 1 }),
    size: () => ({ w: 1280, h: 820 }),
    grids: () => [],
    storeys: () => [],
    elementBox: () => null,
    isVisible: () => true,
    // The nearest face along an axis-aligned ray, as `picking.ts` would answer it.
    ray: (origin, dir, far, near) => {
      const axis = (['X', 'Y', 'Z'] as const).find((a) => dir.getComponent(AXIS_INDEX[a]) !== 0)!
      const sign = dir.getComponent(AXIS_INDEX[axis]) > 0 ? '+' : '-'
      const at = faces[sign + axis]
      if (at === undefined) return null
      const distance = (at - origin.getComponent(AXIS_INDEX[axis])) / dir.getComponent(AXIS_INDEX[axis])
      if (distance < near || distance > far) return null
      return { id: 7, point: origin.clone().addScaledVector(dir, distance), distance }
    },
    offset: () => [0, 0, 0],
    invalidate: () => {},
    on: { measure: (list) => (published = list) }
  }
}

/** The labels that carry a reading — everything but the origin mark, the end dots and the live label. */
const readings = (): Label[] => labels.slice(1).filter((l) => l.el.innerHTML.includes('<b'))

/** Every axis of a record: its two sides add up to its whole ray, to the last bit. */
function sumsExactly(m: MeasureRecord): void {
  for (const k of ['x', 'y', 'z'] as const) {
    const s = m.sides[k]
    expect([k, s === undefined]).toEqual([k, m[k] === undefined])
    if (s) expect([k, (s.minus ?? 0) + (s.plus ?? 0)]).toEqual([k, m[k]])
  }
}

beforeEach(() => {
  faces = { ...FACES }
  labels = []
  published = []
  ann = createAnnotations(stubHost())
})

describe('a laser measurement, split at its point', () => {
  // A point on a wall facing −Y: the +Y ray would go into the wall and is not fired (L376).
  const P = new Vector3(0, 0, 0)
  const WALL = new Vector3(0, -1, 0)

  it('records each axis whole and, beside it, the distance along the axis from the point to each face', () => {
    ann.addLaser(P, WALL, -1)
    expect(published).toHaveLength(1)
    const [m] = published
    expect(m.p).toEqual([0, 0, 0])
    expect(Object.keys(m.sides)).toEqual(['x', 'y', 'z'])
    // Along the axis: the 3 mm the ray starts off the wall (L372) is across X and Z, so it is
    // in neither side — the faces are exactly 1.2 and 2.3 m away along X, 0.9 and 1.8 along Z.
    expect(m.sides.x).toEqual({ minus: 1.2, plus: 2.3 })
    // Y: only the − side was fired, along the wall's normal, and it reached a face.
    expect(m.sides.y).toEqual({ minus: 4, plus: null })
    expect(m.sides.z).toEqual({ minus: 0.9, plus: 1.8 })
    // The whole ray is the two sides together.
    expect(m.x).toBeCloseTo(3.5, 12)
    expect(m.y).toBe(4)
    expect(m.z).toBeCloseTo(2.7, 12)
    sumsExactly(m)
  })

  it('reads a one-sided axis across the face without the lift, so it too is the sum of its sides', () => {
    // Nothing to the −X side: X reads its + side alone. Its far end is the point itself, which
    // stands 3 mm off the ray — so the design's `a.distanceTo(b)` (L383) read the hypotenuse.
    delete faces['-X']
    ann.addLaser(P, WALL, -1)
    const [m] = published
    expect(m.sides.x).toEqual({ minus: null, plus: 2.3 })
    expect(m.x).toBe(2.3)
    expect(Math.hypot(2.3, LASER_LIFT)).toBeGreaterThan(2.3)
    sumsExactly(m)
  })

  it('draws one reading at the middle of each half that reached a face, at the design’s offsets', () => {
    ann.addLaser(P, WALL, -1)
    const got = readings().map((l) => ({
      html: l.el.innerHTML,
      at: l.pos.toArray().map((v) => +v.toFixed(4)),
      dx: l.dx,
      dy: l.dy,
      border: l.el.style.borderColor
    }))
    const lift = -LASER_LIFT / 2
    const expected: [LaserAxis, number, number[]][] = [
      ['X', 1.2, [-0.6, lift, 0]],
      ['X', 2.3, [1.15, lift, 0]],
      ['Y', 4, [0, -2, 0]],
      ['Z', 0.9, [0, lift, -0.45]],
      ['Z', 1.8, [0, lift, 0.9]]
    ]
    expect(got).toEqual(
      expected.map(([axis, len, at]) => ({
        html: laserLabelHtml(axis, len),
        at: at.map((v) => +v.toFixed(4)),
        ...laserLabelOffset(axis),
        border: 'var(--accent)'
      }))
    )
    // Whole millimetres, as the design prints them.
    expect(got.map((g) => g.html.match(/<b[^>]*>([^<]*)<\/b>/)![1].replace(/ /g, ' '))).toEqual([
      '1 200 mm',
      '2 300 mm',
      '4 000 mm',
      '900 mm',
      '1 800 mm'
    ])
    // The origin mark, then per axis its readings and its two end dots — the dots and the mark
    // are the design's, so 1 + 3 × 2 of them, and five readings where the design drew three.
    expect(labels.length - 1).toBe(1 + 5 + 6)
  })

  it('reads a + side alone where only that side was fired — the floor under a ceiling', () => {
    const floor = new Vector3(0.5, 0.5, -0.9)
    ann.addLaser(floor, new Vector3(0, 0, 1), -1)
    const [m] = published
    // Along the normal the lift is part of the length: from the floor itself to the ceiling.
    expect(m.sides.z).toEqual({ minus: null, plus: expect.closeTo(2.7, 12) })
    sumsExactly(m)
    const z = readings().filter((l) => l.el.innerHTML.includes('>Z<'))
    expect(z).toHaveLength(1)
    expect(z[0].pos.toArray().map((v) => +v.toFixed(4))).toEqual([0.5, 0.5, 0.45])
  })

  it('takes every one of its labels away when it is deleted', () => {
    ann.addLaser(P, WALL, -1)
    ann.addLaser(new Vector3(0.5, 0.5, -0.9), new Vector3(0, 0, 1), -1)
    // The live label, then the wall's 12 and the floor's 11: X two readings, Y and Z one each,
    // its origin mark and six end dots.
    expect(labels).toHaveLength(1 + 12 + 11)
    const first = published[0].id
    ann.dropMeasure(first)
    expect(published.map((m) => m.id)).not.toContain(first)
    // None of the wall's readings is left; the floor's are.
    expect(labels).toHaveLength(1 + 11)
    expect(readings().some((l) => l.pos.y === -2)).toBe(false)
    ann.clearMeasures()
    expect(labels).toHaveLength(1)
  })

  it('reads both sides under the pointer, and reports them to debug()', () => {
    ann.previewLaser(P, WALL, -1)
    expect(labels[0].on).toBe(true)
    const rays = [
      { axis: 'X' as const, minus: 1.2, plus: 2.3 },
      { axis: 'Y' as const, minus: 4, plus: null },
      { axis: 'Z' as const, minus: 0.9, plus: 1.8 }
    ]
    expect(labels[0].el.innerHTML).toBe(laserLiveHtml(rays))
    expect(ann.debug().preview).toEqual([
      { axis: 'X', len: 3.5, minus: 1.2, plus: 2.3 },
      { axis: 'Y', len: 4, minus: 4, plus: null },
      { axis: 'Z', len: 2.7, minus: 0.9, plus: 1.8 }
    ])
  })
})
