/**
 * One bounding box and one part count per element, taken off the geometry stream's parts.
 *
 * The walk is the whole of `renderer/model/element-boxes.ts`, and it is pure, so everything
 * here is numbers: several parts becoming one box and one count, mixed opaque and transparent
 * parts counting as one set, the federation offset going back on, an element with no geometry
 * staying absent, and — the check that matters for the parity harness — the design's own mock
 * federation producing, through this path, exactly the boxes and the solid counts it already
 * composes for itself. Same frame (the identity), same units, same numbers.
 *
 * The federation half (two models keeping distinct ids, a removal taking its boxes with it) is
 * checked against the real `federate` / `removeModel`, because that is where an id could
 * collide.
 */
import { describe, expect, it } from 'vitest'
import { elementBoxes } from '../../src/renderer/model/element-boxes'
import { federate, removeModel } from '../../src/shared/federate'
import { mockGeometryChunks, mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import type {
  GeometryChunk,
  PartRecord
} from '../../src/shared/geometry-contract.types'
import type { IfcElement, ModelIndex } from '../../src/shared/model-index.types'

/**
 * A part with nothing in it but the fields the walk reads. `alpha` is what splits `batches.ts`
 * into its two families, so it is here to prove the count does **not** split with it.
 */
const part = (
  elementId: number,
  bbox6: [number, number, number, number, number, number],
  alpha = 1
): PartRecord => ({
  elementId,
  geomIdx: 0,
  matrix16: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  rgba: [1, 1, 1, alpha],
  bbox6
})

const chunk = (parts: PartRecord[]): GeometryChunk => ({
  header: { modelKey: 'M', index: 1, total: 1 },
  positions: new Float32Array(0),
  normals: new Float32Array(0),
  indices: new Uint32Array(0),
  edges: new Float32Array(0),
  geoms: [],
  parts
})

describe('elementBoxes', () => {
  it('unions every part of an element, across chunks', () => {
    const boxes = elementBoxes(
      [
        chunk([part(7, [0, 0, 0, 1, 1, 1]), part(7, [-2, 0, 0, 0, 0.5, 3])]),
        chunk([part(7, [0, -4, 0, 0.5, 0, 0.5])])
      ],
      [0, 0, 0]
    )
    expect(boxes.get(7)!.box).toEqual([-2, -4, 0, 1, 1, 3])
    expect(boxes.get(7)!.parts).toBe(3)
  })

  it('adds the federation offset back, so the box is in the project frame', () => {
    // The stream subtracts the offset from every placement; `IfcElement.bbox` is declared
    // *before* that subtraction, which is the frame the storey ladder and the grids are in.
    const boxes = elementBoxes([chunk([part(1, [0, 0, 0, 2, 3, 4])])], [313, -76, -1])
    expect(boxes.get(1)!.box).toEqual([313, -76, -1, 315, -73, 3])
  })

  it('gives an element with no part no box at all — never a placeholder', () => {
    const boxes = elementBoxes([chunk([part(1, [0, 0, 0, 1, 1, 1])])], [0, 0, 0])
    expect(boxes.has(2)).toBe(false)
    expect(boxes.size).toBe(1)
  })

  it('keeps each element apart, and returns nothing for an empty stream', () => {
    const boxes = elementBoxes(
      [chunk([part(1, [0, 0, 0, 1, 1, 1]), part(2, [10, 10, 10, 11, 11, 11])])],
      [0, 0, 0]
    )
    expect(boxes.get(1)!.box).toEqual([0, 0, 0, 1, 1, 1])
    expect(boxes.get(2)!.box).toEqual([10, 10, 10, 11, 11, 11])
    expect([...boxes.values()].map((g) => g.parts)).toEqual([1, 1])
    expect(elementBoxes([], [0, 0, 0]).size).toBe(0)
    expect(elementBoxes([chunk([])], [5, 5, 5]).size).toBe(0)
  })

  it('counts every part of an element, whatever family it will be drawn in', () => {
    // `batches.ts` splits parts into `solid` and `glass` by the file's own alpha and then does
    // `rec.solidCount++` in both, so a window's frame and its pane count two. Counting only
    // the opaque ones here would make the assistant and the property card disagree.
    const boxes = elementBoxes(
      [
        chunk([
          part(4, [0, 0, 0, 1, 2, 1]),
          part(4, [0.1, 0.1, 0.1, 0.9, 1.9, 0.9], 0.35),
          part(5, [9, 9, 9, 9.5, 9.5, 9.5], 0.2)
        ])
      ],
      [0, 0, 0]
    )
    expect(boxes.get(4)!.parts).toBe(2)
    expect(boxes.get(4)!.box).toEqual([0, 0, 0, 1, 2, 1])
    // An element that is glass and nothing else still counts, and still gets a box.
    expect(boxes.get(5)!.parts).toBe(1)
  })

  it('reproduces the mock federation’s own boxes and solid counts exactly — same frame, same units', () => {
    // The mock composes `IfcElement.bbox` from the sample boxes directly and its part boxes
    // from the same numbers, at offset [0,0,0] and the identity frame. If this ever diverges,
    // the real pipeline and the parity harness are measuring in two different frames.
    for (const key of ['ARC', 'STR', 'SIT', 'MEP']) {
      const index = mockModelIndex(key)
      const boxes = elementBoxes(mockGeometryChunks(key), [0, 0, 0])
      const withGeometry = index.elements.filter((e) => e.bbox)
      expect(boxes.size).toBe(withGeometry.length)
      for (const element of withGeometry) {
        const own = boxes.get(element.id)!
        for (let i = 0; i < 6; i++) expect(own.box[i]).toBeCloseTo(element.bbox![i], 9)
        // The mock's own `solidCountOf` counts colour groups and it emits one part per group,
        // so the two must agree — which is what keeps the property card's Geometry row and the
        // parity captures exactly as the prototype draws them.
        expect(own.parts).toBe(element.solidCount)
      }
    }
  })
})

/* ────────────────────────────── the federation half ────────────────────────────── */

const el = (id: number, bbox?: [number, number, number, number, number, number]): IfcElement =>
  ({
    id,
    expressId: id,
    guid: `G${id}`,
    guidValid: true,
    tag: '',
    model: '',
    name: `E${id}`,
    description: '',
    type: 'IfcWall',
    predefinedType: '',
    objectType: '',
    typeGuid: '',
    storey: 'L1',
    material: '',
    materials: [],
    classifications: [],
    systems: [],
    decomposition: { children: [], openings: [], fillings: [] },
    psets: {},
    qto: {},
    psetMeta: {},
    ...(bbox ? { bbox } : {})
  }) as IfcElement

const index = (modelKey: string, elements: IfcElement[]): ModelIndex =>
  ({
    modelKey,
    fileName: `${modelKey}.ifc`,
    sha256: '',
    schema: 'IFC4',
    header: {
      description: [],
      viewDefinition: '',
      implementationLevel: '',
      name: '',
      timeStamp: '',
      author: [],
      organization: [],
      preprocessorVersion: '',
      originatingSystem: '',
      authorization: '',
      fileSchema: ['IFC4']
    },
    units: { byType: {}, length: 1, area: 1, volume: 1, angle: 1 },
    project: null,
    site: null,
    building: null,
    spatial: null,
    storeys: [],
    grids: [],
    georef: { source: 'none', sources: [], method: 'none' },
    propKeys: [],
    counts: {
      entities: 0,
      elements: elements.length,
      spaces: 0,
      openings: 0,
      psets: 0,
      quantitySets: 0,
      byType: {}
    },
    elements
  }) as ModelIndex

describe('boxes through the federation', () => {
  it('keeps two models’ boxes on distinct ids, and a removal takes its own with it', () => {
    const a = index('A', [el(1, [0, 0, 0, 1, 1, 1]), el(2)])
    const b = index('B', [el(1, [10, 10, 10, 11, 11, 11])])
    const fed = federate([a, b])

    // Same local id in both files; the slot is what keeps them apart, boxes included.
    const ids = fed.elements.filter((e) => e.bbox).map((e) => e.id)
    expect(new Set(ids).size).toBe(2)
    expect(fed.byId.get(ids[0])!.bbox).toEqual([0, 0, 0, 1, 1, 1])
    expect(fed.byId.get(ids[1])!.bbox).toEqual([10, 10, 10, 11, 11, 11])
    // The element with no geometry federates with no box.
    expect(fed.elements.filter((e) => !e.bbox)).toHaveLength(1)

    const after = removeModel(fed, 'A').federation
    expect(after.elements.filter((e) => e.bbox).map((e) => e.bbox)).toEqual([
      [10, 10, 10, 11, 11, 11]
    ])
    // B's id did not move, so nothing that stored it has to be remapped.
    expect(after.elements[0].id).toBe(ids[1])
  })
})
