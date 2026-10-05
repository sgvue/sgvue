/**
 * The design-parity harness. If these counts drift, the app is no longer rendering the same
 * federation the prototype renders and every parity screenshot from here on is worthless.
 *
 * The numbers come from the design itself (`CLAUDE.md`, plan §4 Phase 1 acceptance):
 * 412 elements, 6 storeys, 9 grids, ARC 140 / STR 244 / SIT 20 / MEP 8.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { attr } from '../../src/shared/attr'
import { mockGeometryChunks, mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { buildDisciplineModel, federate } from '../../src/renderer/dev/sample-model.js'
import { checkGeometryChunks } from './geometry-contract'

const ROOT = join(__dirname, '..', '..')
const KEYS = ['ARC', 'STR', 'SIT', 'MEP'] as const

describe('sample-model copy', () => {
  it('is byte-identical to the design bundle', () => {
    // src/renderer/dev/sample-model.js exists only because design-reference/ is read-only
    // and cannot carry the .d.ts the TypeScript build needs. It must never drift.
    const design = readFileSync(join(ROOT, 'design-reference/design/sample-model.js'))
    const copy = readFileSync(join(ROOT, 'src/renderer/dev/sample-model.js'))
    expect(copy.equals(design)).toBe(true)
  })
})

describe('mock adapter', () => {
  it('reproduces the design federation exactly', () => {
    const perModel = Object.fromEntries(
      KEYS.map((key) => [key, mockModelIndex(key).elements.length])
    )
    expect(perModel).toEqual({ ARC: 140, STR: 244, SIT: 20, MEP: 8 })
    expect(Object.values(perModel).reduce((a, b) => a + b, 0)).toBe(412)

    // Storeys and grids are federation-level: each discipline carries only what it uses.
    const federation = federate(KEYS.map((key) => buildDisciplineModel(key)))
    expect(federation.storeys).toHaveLength(6)
    expect(federation.grids).toHaveLength(9)
    expect(federation.elements).toHaveLength(412)
  })

  it('carries the design element shape through unchanged', () => {
    const arc = mockModelIndex('ARC')
    const source = buildDisciplineModel('ARC')
    const window = arc.elements.find((e) => e.name === 'Window S A-B L1')!
    const origin = source.elements.find((e) => e.name === 'Window S A-B L1')!

    expect(window.type).toBe('IfcWindow')
    expect(window.predefinedType).toBe('WINDOW')
    expect(window.objectType).toBe('W1 2400x1500')
    expect(window.storey).toBe('L1')
    expect(window.material).toBe('Aluminium, double glazed')
    expect(window.model).toBe('ARC')
    expect(window.guidValid).toBe(true)

    // psets and qtos are passed through as authored — same object content, no conversion.
    expect(window.psets).toEqual(origin.psets)
    expect(window.qto).toEqual(origin.qto)
    expect(window.psets.Pset_WindowCommon).toEqual({
      Reference: 'W1',
      IsExternal: true,
      FireRating: '-',
      GlazingAreaFraction: 0.82,
      ThermalTransmittance: 2.6,
      SmokeStop: false
    })
    expect(window.qto.Qto_WindowBaseQuantities).toEqual({ Width: 2400, Height: 1500, Area: 3.6 })
    expect(window.psetMeta.Qto_WindowBaseQuantities.kind).toBe('Qto')
    expect(window.psetMeta.Pset_WindowCommon.kind).toBe('Pset')

    // The resolver reaches pset keys on the mock exactly as it will on a real file.
    expect(attr(window, 'GlazingAreaFraction')).toBe(0.82)
    expect(attr(window, 'Level')).toBe('L1')
  })

  it('tags IFC-SG property sets on the site model', () => {
    const sit = mockModelIndex('SIT')
    const tree = sit.elements.find((e) => e.predefinedType === 'VEGETATION')!
    expect(tree.type).toBe('IfcGeographicElement')
    expect(tree.psetMeta.SGPset_Planting.kind).toBe('SGPset')
    expect(sit.propKeys).toContain('SpeciesBotanicalName')
  })

  it('invents nothing the mock has no source for', () => {
    const arc = mockModelIndex('ARC')
    expect(arc.sha256).toBe('')
    expect(arc.counts.entities).toBe(0)
    expect(arc.georef.source).toBe('none')
    expect(arc.georef.sources).toEqual([])
  })

  it('emits geometry chunks in the shape the renderer will receive', () => {
    for (const key of KEYS) {
      const chunks = mockGeometryChunks(key)
      expect(chunks.length).toBeGreaterThan(0)
      const elementIds = new Set(mockModelIndex(key).elements.map((e) => e.id))

      // The same contract check the worker's own streamer is held to, so the parity
      // harness and the real pipeline cannot drift apart (tests/unit/geometry-contract.ts).
      expect(checkGeometryChunks(chunks), key).toEqual([])

      for (const chunk of chunks) {
        expect(chunk.header.modelKey).toBe(key)
        expect(chunk.header.total).toBe(chunks.length)

        for (const geom of chunk.geoms) {
          // One geometry is a whole colour group, merged as `viewer-core.js:119` merges it:
          // a whole number of boxes, each 6 faces × 4 vertices, 12 triangles, 12 creases.
          const boxes = geom.vertexCount / 24
          expect(Number.isInteger(boxes) && boxes >= 1).toBe(true)
          expect(geom.indexCount).toBe(36 * boxes)
          expect(geom.edgeCount).toBe(24 * boxes)
        }
        for (const part of chunk.parts) expect(elementIds.has(part.elementId)).toBe(true)
      }
    }
  })

  it('merges each colour group into one part, as the reference merges each into one mesh', () => {
    const index = mockModelIndex('ARC')
    const parts = mockGeometryChunks('ARC').flatMap((c) => c.parts)

    // `wallBoxes` splits an external wall around its window into four boxes of one colour;
    // the prototype draws one mesh and its card reads "1 solid" (viewer-core.js:115–122).
    const wall = index.elements.find((e) => e.name === 'Ext Wall S A-B L1')!
    expect(wall.solidCount).toBe(1)
    expect(parts.filter((p) => p.elementId === wall.id)).toHaveLength(1)

    // A window is two groups — frame and glass — so it is two solids and two parts, which is
    // also what keeps the glass leaf's alpha < 1 on a part of its own.
    const window = index.elements.find((e) => e.name === 'Window S A-B L1')!
    expect(window.solidCount).toBe(2)
    expect(parts.filter((p) => p.elementId === window.id)).toHaveLength(2)

    // The merged part's box is the group's whole extent, not one box's.
    const wallPart = parts.find((p) => p.elementId === wall.id)!
    expect(wallPart.bbox6).toEqual(wall.bbox)
  })

  it('takes colour and transparency from the design palette', () => {
    const parts = mockGeometryChunks('ARC').flatMap((c) => c.parts)
    const index = mockModelIndex('ARC')
    const byId = new Map(index.elements.map((e) => [e.id, e]))

    // COLORS.extwall = 0xd8d2c6, opaque.
    const wall = index.elements.find((e) => e.objectType === 'EW 200 Brick')!
    const wallPart = parts.find((p) => p.elementId === wall.id)!
    expect(wallPart.rgba.map((v) => Math.round(v * 255))).toEqual([0xd8, 0xd2, 0xc6, 255])

    // COLORS.glass = 0x7fb5b0 at 0.42 — the glass leaf of a window, which must stay < 1
    // so the renderer puts it in the transparent batch.
    const glass = parts.find((p) => byId.get(p.elementId)?.type === 'IfcWindow' && p.rgba[3] < 1)!
    expect(glass.rgba[3]).toBeCloseTo(0.42, 6)
  })

  it('dedupes repeated shapes instead of storing them again', () => {
    const chunks = mockGeometryChunks('STR')
    const parts = chunks.reduce((n, c) => n + c.parts.length, 0)
    const geoms = chunks.reduce((n, c) => n + c.geoms.length, 0)
    // The structural model is mostly repeated columns and beams: far fewer distinct shapes
    // than placements, which is exactly what the instancing path exists for.
    expect(geoms).toBeLessThan(parts / 2)
  })
})
