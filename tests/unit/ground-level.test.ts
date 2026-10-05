/**
 * 2026-10-01 — where the ground stands (`src/renderer/viewer/scene.ts`, `groundLevel`).
 *
 * The owner's report: a Tekla steel export federated behind another model stood above the canvas
 * grid, and opened alone it hung under it. The cause: the ground was drawn at scene z = 0, and
 * scene z = 0 is the height of the first placement web-ifc streams from the boot model (the
 * federation offset is rounded from it) — near a file's own zero in most exports, a member
 * high in the structure in that one.
 *
 * Three levels: the rule itself; `buildScene`, which is what places the ground, the veil and
 * the grid helper; and the real geometry streamer on a committed fixture whose first streamed
 * product is its highest (`tests/fixtures/high-first.ifc`, `scripts/make-tiny-ifc.py`).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Box3, MeshStandardMaterial, Vector3, type Object3D } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import type { Materials } from '../../src/renderer/viewer/materials'
import { buildScene, groundLevel } from '../../src/renderer/viewer/scene'
import type { GeometryChunk } from '../../src/shared/geometry-contract.types'
import { streamGeometry } from '../../src/worker/geometry-streamer'
import { createReadOnlyIfcSource } from '../../src/worker/ifc-source'

describe('groundLevel — the project frame’s zero, or the bottom of the box', () => {
  it('is the datum whenever the box spans it', () => {
    expect(groundLevel(0, -1, 15.5)).toBe(0)
    // An offset whose Z is 12: the file's zero is scene −12, and the box runs −13 … 0.2.
    expect(groundLevel(-12, -13, 0.2)).toBe(-12)
    expect(groundLevel(7, -3, 40)).toBe(7)
    // Its two ends count as spanning it.
    expect(groundLevel(0, 0, 9)).toBe(0)
    expect(groundLevel(9, 0, 9)).toBe(9)
  })

  it('is the bottom of a box that stands wholly above the datum', () => {
    expect(groundLevel(0, 3, 9)).toBe(3)
    expect(groundLevel(-12, 4, 30)).toBe(4)
  })

  it('is the bottom of a box that lies wholly below the datum — never its top', () => {
    expect(groundLevel(0, -9, -3)).toBe(-9)
    expect(groundLevel(-12, -40, -20)).toBe(-40)
  })

  it('keeps a flat box on its own plane', () => {
    expect(groundLevel(0, 2, 2)).toBe(2)
    expect(groundLevel(2, 2, 2)).toBe(2)
    expect(groundLevel(0, -2, -2)).toBe(-2)
  })

  it('reads −∞ for an empty box, as the clamp it replaced did: nothing loaded, nothing drawn', () => {
    const empty = new Box3()
    expect(empty.isEmpty()).toBe(true)
    expect(groundLevel(0, empty.min.z, empty.max.z)).toBe(-Infinity)
    expect(groundLevel(-12, empty.min.z, empty.max.z)).toBe(-Infinity)
    expect(Math.min(Math.max(0, empty.min.z), empty.max.z)).toBe(-Infinity)
  })

  it('with the datum at scene 0 it is the old clamp wherever the box reaches zero or stands above it', () => {
    const clamp = (min: number, max: number): number => Math.min(Math.max(0, min), max)
    for (const [min, max] of [
      [-1, 15.5],
      [0, 6.4],
      [-13, 0],
      [-0.2, 0.2],
      [0.3, 12],
      [5, 5]
    ]) {
      expect([min, max, groundLevel(0, min, max)]).toEqual([min, max, clamp(min, max)])
    }
  })
})

/** Just what `buildScene` reads off the material bank: the ground's two layers. */
const materials = {
  ground: new MeshStandardMaterial(),
  groundVeil: new MeshStandardMaterial()
} as unknown as Materials

const box = (minZ: number, maxZ: number): Box3 => new Box3(new Vector3(0, 0, minZ), new Vector3(6, 4, maxZ))
const helperOf = (children: readonly Object3D[]): Object3D => children.find((c) => c.type === 'GridHelper')!
/** The ground and its veil: the two meshes on the one plane geometry. */
const planesOf = (children: readonly Object3D[]): Object3D[] =>
  children.filter((c) => (c as { geometry?: { type?: string } }).geometry?.type === 'PlaneGeometry')

describe('buildScene — the ground, its veil and the grid helper stand at the datum', () => {
  it('puts all three at the file’s zero when the offset’s Z is not 0', () => {
    // Offset Z 12: the first placement streamed was 12 m up, so scene 0 is up there.
    const rig = buildScene(box(-13, 0.2), materials, 'dark', true, 0 - 12)
    const s = rig.scale
    expect(rig.groundZ).toBe(-12)
    // Back in the file's own coordinates that is zero — not 12, the first placement's height.
    expect(rig.groundZ + 12).toBe(0)
    const planes = planesOf(rig.scene.children)
    expect(planes).toHaveLength(2)
    expect(planes).toContain(rig.ground)
    for (const plane of planes) expect(plane.position.z).toBeCloseTo(-12 - 0.02 * s, 12)
    expect(helperOf(rig.scene.children).position.z).toBeCloseTo(-12 - 0.005 * s, 12)
    rig.dispose()
  })

  it('keeps it there through a theme change, which rebuilds the grid helper', () => {
    const rig = buildScene(box(-13, 0.2), materials, 'dark', true, -12)
    const before = helperOf(rig.scene.children)
    rig.setTheme('light')
    const after = helperOf(rig.scene.children)
    expect(after).not.toBe(before)
    expect(after.position.z).toBeCloseTo(-12 - 0.005 * rig.scale, 12)
    expect(rig.groundZ).toBe(-12)
    rig.dispose()
  })

  it('stands at the bottom of a model wholly above, or wholly below, its datum', () => {
    const above = buildScene(box(4, 30), materials, 'dark', true, -12)
    expect(above.groundZ).toBe(4)
    above.dispose()
    const below = buildScene(box(-40, -20), materials, 'dark', true, -12)
    expect(below.groundZ).toBe(-40)
    below.dispose()
  })

  it('is at scene 0 when the offset’s Z is 0 — the design’s mock, whose box is −1 … 15.5', () => {
    const mock = new Box3(new Vector3(-8, -8, -1), new Vector3(32, 26, 15.5))
    const explicit = buildScene(mock, materials, 'dark', true, 0 - 0)
    const defaulted = buildScene(mock, materials, 'dark')
    for (const rig of [explicit, defaulted]) {
      expect(Object.is(rig.groundZ, 0)).toBe(true)
      expect(rig.ground.position.z).toBe(-0.02 * rig.scale)
      expect(helperOf(rig.scene.children).position.z).toBe(-0.005 * rig.scale)
      rig.dispose()
    }
  })
})

describe('high-first.ifc — the first product streamed is the highest', () => {
  const FIXTURE = join(__dirname, '..', 'fixtures', 'high-first.ifc')

  it('takes its offset from the roof, and still stands the ground at the file’s zero', async () => {
    const src = await createReadOnlyIfcSource()
    const modelID = src.openFromBuffer(new Uint8Array(readFileSync(FIXTURE)))
    const chunks: GeometryChunk[] = []
    const summary = streamGeometry(src, modelID, {
      modelKey: 'HIGH',
      offset: null,
      frame: null,
      onChunk: (chunk) => chunks.push(chunk)
    })
    const first = chunks[0].parts[0]
    const firstName = src.typeName(src.lineType(modelID, first.elementId))
    src.close(modelID)
    src.dispose()

    // The fixture's premise: the first part streamed is the roof slab, 12 m above the file's
    // zero, so the whole-metre offset's Z is 12 and scene z = 0 is the roof.
    expect(firstName).toBe('IfcSlab')
    expect(summary.offset).toEqual([3, 0, 12])
    expect(summary.parts).toBe(5)
    const [x0, y0, z0, x1, y1, z1] = summary.bbox6!
    // In scene coordinates the model runs from the footing's foot (file −1) to the roof's top.
    expect(z0).toBeCloseTo(-13, 6)
    expect(z1).toBeCloseTo(0.2, 6)

    const rig = buildScene(
      new Box3(new Vector3(x0, y0, z0), new Vector3(x1, y1, z1)),
      materials,
      'dark',
      true,
      0 - summary.offset[2]
    )
    // The file's own zero, with the slab on it and only the footing below — not scene 0, the
    // first placement's height, where it stood before with four of the five elements under it.
    expect(rig.groundZ).toBe(-12)
    expect(rig.groundZ + summary.offset[2]).toBe(0)
    rig.dispose()
  })
})
