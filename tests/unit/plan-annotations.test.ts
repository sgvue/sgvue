/**
 * 2026-11-07 — what the annotation layer draws as a plan rectangle turns with the plan rotation
 * (`shared/plan-rotation.ts`), so a building drawn turned at its file's own coordinates still has
 * its gridlines clipped square, its bubbles in rows and its level rings and tags on its own
 * rectangle. Checked by equivariance: the same grids and storeys, once square in the scene at
 * ρ = 0 and once turned by ρ with the plan rotation ρ, must put every label exactly where the
 * first put it, turned by ρ.
 */
import { Box3, Vector3 } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { turnXY } from '../../src/shared/plan-rotation'
import { createAnnotations, type AnnotationHost } from '../../src/renderer/viewer/annotations'
import type { Label, LabelOverlay } from '../../src/renderer/viewer/overlay'

/** The building's own rectangle, in the plan frame. */
const PLAN_BOX = new Box3(new Vector3(-2, -2, -1), new Vector3(14, 10, 8))
/** Two grid families, square in the plan. */
const PLAN_GRIDS: { name: string; p0: [number, number]; p1: [number, number] }[] = [
  { name: 'A', p0: [0, -1], p1: [0, 9] },
  { name: 'B', p0: [6, -1], p1: [6, 9] },
  { name: 'C', p0: [12, -1], p1: [12, 9] },
  { name: '1', p0: [-1, 0], p1: [13, 0] },
  { name: '2', p0: [-1, 8], p1: [13, 8] }
]

function labelsFor(rho: number): Label[] {
  const labels: Label[] = []
  const overlay = {
    labels,
    labelBase: () => ({}),
    mkLabel: (pos: Vector3, html: string, style = {}, dx = 0, dy = 0) => {
      const el = { innerHTML: html, style: { ...style }, title: '', addEventListener: () => {} }
      const label: Label = {
        el: el as unknown as HTMLDivElement,
        pos: pos.clone(),
        dx,
        dy,
        on: true,
        remove: () => void labels.splice(labels.indexOf(label), 1)
      }
      labels.push(label)
      return label
    },
    mkElement: () => {
      throw new Error('not used')
    },
    update: () => {},
    updateOcclusion: () => false,
    dispose: () => {}
  } as unknown as LabelOverlay
  const turned = (p: readonly [number, number]): [number, number] => turnXY(p, rho)
  // The scene's own box of the turned building — what `store.bbox` would be.
  const corners = [PLAN_BOX.min, PLAN_BOX.max].flatMap((a) =>
    [PLAN_BOX.min, PLAN_BOX.max].map((b) => turned([a.x, b.y]))
  )
  const bbox = new Box3(
    new Vector3(Math.min(...corners.map((c) => c[0])), Math.min(...corners.map((c) => c[1])), PLAN_BOX.min.z),
    new Vector3(Math.max(...corners.map((c) => c[0])), Math.max(...corners.map((c) => c[1])), PLAN_BOX.max.z)
  )
  const host: AnnotationHost = {
    overlay,
    materials: {} as unknown as AnnotationHost['materials'],
    bbox,
    scale: () => 1,
    frame: PLAN_BOX,
    frameScale: () => 1,
    plan: () => rho,
    groundZ: () => 0,
    camera: () => {
      throw new Error('not used')
    },
    // A plan view, turned with the plan.
    view: () => ({ theta: -Math.PI / 2 + rho, phi: 0.0001 }),
    size: () => ({ w: 1280, h: 820 }),
    grids: () => PLAN_GRIDS.map((g) => ({ name: g.name, p0: turned(g.p0), p1: turned(g.p1) })),
    storeys: () => [
      { name: 'L1', elev: 0, authored: 0 },
      { name: 'L2', elev: 3.2, authored: 3.2 }
    ],
    elementBox: () => null,
    isVisible: () => true,
    ray: () => null,
    offset: () => [0, 0, 0],
    invalidate: () => {},
    on: {}
  }
  const ann = createAnnotations(host)
  ann.setLevels(true)
  ann.rebuild()
  return labels
}

describe('the plan rectangles turn with the plan rotation', () => {
  it('places every bubble, grid dimension and level tag where the square plan places it, turned', () => {
    const square = labelsFor(0)
    expect(square.length).toBeGreaterThan(PLAN_GRIDS.length * 2)
    for (const deg of [-43.4103, 17, 45]) {
      const rho = (deg * Math.PI) / 180
      const turned = labelsFor(rho)
      expect(turned.map((l) => l.el.innerHTML).sort()).toEqual(square.map((l) => l.el.innerHTML).sort())
      // Matched as a set: a grid's own sense (`canonicalDir`) can flip with the turn, which swaps
      // the order its two bubbles are made in, never where they stand.
      for (const l of turned) {
        const match = square.some((q) => {
          const want = turnXY([q.pos.x, q.pos.y], rho)
          return (
            q.el.innerHTML === l.el.innerHTML &&
            Math.abs(l.pos.x - want[0]) < 1e-9 &&
            Math.abs(l.pos.y - want[1]) < 1e-9 &&
            q.pos.z === l.pos.z
          )
        })
        expect([deg, l.el.innerHTML, l.pos.x, l.pos.y, match]).toEqual([deg, l.el.innerHTML, l.pos.x, l.pos.y, true])
      }
    }
  })
})
