/**
 * The federation merge.
 *
 * Two things here are load-bearing well beyond this file:
 *
 *  · **Slots.** Marumi's worst bug was ids that shifted when a model was deleted, because
 *    the next model's id block was `models.length`. A slot is found by free-slot search and
 *    kept, so removing a model leaves every surviving id exactly where it was.
 *  · **Parity.** The project header, the storey ladder and the id arithmetic must reproduce
 *    `design-reference/design/sample-model.js` `federate` on the prototype's own four
 *    discipline models, because that is the federation every parity screenshot is taken of —
 *    the id blocks by the wider stride since 2026-10-09 (`ID_STRIDE`), which no surface shows.
 */
import { describe, expect, it } from 'vitest'
import { ID_STRIDE, LEGACY_ID_STRIDE, federate, removeModel } from '../../src/shared/federate'
import type {
  GridAxisRecord,
  IfcElement,
  ModelIndex,
  Storey
} from '../../src/shared/model-index.types'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { chatSchema } from '../../src/shared/ai-schema'
import { sectionGridFamilies } from '../../src/renderer/state/selectors/section'
import { NO_PLANE } from '../../src/shared/sections'
import { buildDisciplineModel, federate as designFederate } from '../../src/renderer/dev/sample-model.js'

const KEYS = ['ARC', 'STR', 'SIT', 'MEP'] as const

/* ────────────────────────────── a minimal index ────────────────────────────── */

function element(id: number, type = 'IfcWall'): IfcElement {
  return {
    id,
    expressId: id,
    guid: `G${id}`,
    guidValid: true,
    tag: '',
    model: '',
    name: `E${id}`,
    description: '',
    type,
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
    psetMeta: {}
  }
}

function index(
  modelKey: string,
  options: {
    ids?: number[]
    storeys?: Storey[]
    building?: string
    grids?: GridAxisRecord[]
  } = {}
): ModelIndex {
  const node = (type: string, name: string): ModelIndex['building'] => ({
    expressId: 0,
    guid: '',
    type,
    name,
    longName: '',
    children: []
  })
  return {
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
    project: { expressId: 0, guid: '', name: `${modelKey} project`, longName: '', phase: '', description: '' },
    site: node('IfcSite', 'Site'),
    building: node('IfcBuilding', options.building ?? 'Block 1'),
    spatial: null,
    storeys: options.storeys ?? [],
    grids: options.grids ?? [],
    georef: { source: 'none', sources: [], method: 'none' },
    propKeys: [],
    counts: {
      entities: 0,
      elements: 0,
      spaces: 0,
      openings: 0,
      psets: 0,
      quantitySets: 0,
      byType: {}
    },
    elements: (options.ids ?? [1, 2]).map((id) => element(id))
  }
}

const storey = (name: string, elev: number, guid = ''): Storey => ({
  expressId: 0,
  guid,
  name,
  elev
})

/* ────────────────────────────── ids and slots ────────────────────────────── */

describe('federate — ids', () => {
  it('numbers elements slot * ID_STRIDE + localId and keeps localId', () => {
    const federation = federate([index('A', { ids: [7, 8] }), index('B', { ids: [7] })])
    expect(federation.elements.map((e) => e.id)).toEqual([7, 8, ID_STRIDE + 7])
    expect(federation.elements.map((e) => e.localId)).toEqual([7, 8, 7])
    expect(federation.elements.map((e) => e.model)).toEqual(['A', 'A', 'B'])
    expect(federation.byId.get(ID_STRIDE + 7)?.model).toBe('B')
  })

  it('refuses two models under one key rather than colliding their ids', () => {
    expect(() => federate([index('A'), index('A')])).toThrow(/share the key/)
  })
})

describe('federate — slots survive a removal', () => {
  it('keeps every surviving id and reports the dropped ones', () => {
    const first = federate([index('A'), index('B'), index('C')])
    expect(first.models.map((m) => m.slot)).toEqual([0, 1, 2])
    const before = first.elements.filter((e) => e.model !== 'B').map((e) => e.id)

    const { federation: after, droppedIds } = removeModel(first, 'B')
    expect(after.elements.map((e) => e.id)).toEqual(before)
    expect(droppedIds).toEqual([ID_STRIDE + 1, ID_STRIDE + 2])
    expect(after.models.map((m) => m.slot)).toEqual([0, 2])
  })

  it('gives a new model the freed slot, never models.length', () => {
    const first = federate([index('A'), index('B'), index('C')])
    const { federation: after } = removeModel(first, 'B')
    // models.length is 2 here; slot 2 is taken, so a naive scheme would collide with C.
    const withD = federate(
      [index('A'), index('C'), index('D')],
      after
    )
    const slots = Object.fromEntries(withD.models.map((m) => [m.meta.modelKey, m.slot]))
    expect(slots).toEqual({ A: 0, C: 2, D: 1 })
    expect(withD.elements.filter((e) => e.model === 'C').map((e) => e.id)).toEqual(
      first.elements.filter((e) => e.model === 'C').map((e) => e.id)
    )
  })

  it('removing an unknown model changes nothing', () => {
    const first = federate([index('A')])
    const { federation, droppedIds } = removeModel(first, 'nope')
    expect(federation).toBe(first)
    expect(droppedIds).toEqual([])
  })

  it('removing the last model leaves an empty federation', () => {
    const { federation } = removeModel(federate([index('A')]), 'A')
    expect(federation.models).toEqual([])
    expect(federation.elements).toEqual([])
    expect(federation.project.file).toBe('')
  })
})

/* ────────────────────────────── storeys and grids ────────────────────────────── */

describe('federate — storey union', () => {
  it('matches by GlobalId first, whatever the name says', () => {
    const a = index('A', { storeys: [storey('Level 1', 0, 'GUID-L1')] })
    const b = index('B', { storeys: [storey('L01', 0.4, 'GUID-L1')] })
    const federation = federate([a, b])
    expect(federation.storeys.map((s) => s.name)).toEqual(['Level 1'])
  })

  it('matches by name within a millimetre when there is no shared GlobalId', () => {
    const a = index('A', { storeys: [storey('L1', 0), storey('L2', 3.5)] })
    // 0.9 mm above L2 is the same level; 2 mm is a different one.
    const b = index('B', { storeys: [storey('L2', 3.5009), storey('L3', 7)] })
    const c = index('C', { storeys: [storey('L2', 3.502)] })
    const federation = federate([a, b, c])
    expect(federation.storeys.map((s) => `${s.name}@${s.elev}`)).toEqual([
      'L1@0',
      'L2@3.5',
      'L2@3.502',
      'L3@7'
    ])
  })

  it('sorts the ladder by elevation, as the design does', () => {
    const a = index('A', { storeys: [storey('Roof', 10), storey('B1', -3), storey('L1', 0)] })
    expect(federate([a]).storeys.map((s) => s.name)).toEqual(['B1', 'L1', 'Roof'])
  })
})

describe('federate — grid order', () => {
  /** One axis; only `name` and `family` decide the order. */
  const axis = (name: string, family: 'u' | 'v' | 'w' = 'u'): GridAxisRecord => ({
    name,
    axis: null,
    v: null,
    start: [0, 0],
    end: [1, 1],
    family,
    gridExpressId: 1
  })
  const order = (grids: GridAxisRecord[]): string[] =>
    federate([index('A', { grids })]).grids.map((g) => g.name)

  it('sorts a jumbled ladder naturally, numbers before words at the same place', () => {
    expect(
      order([
        axis('10'),
        axis('2'),
        axis('C1'),
        axis('1'),
        axis('A1'),
        axis("1'"),
        axis('2a'),
        axis('b'),
        axis('A'),
        axis('24'),
        axis('3')
      ])
    ).toEqual(['1', "1'", '2', '2a', '3', '10', '24', 'A', 'A1', 'b', 'C1'])
  })

  it('is case-insensitive but deterministic between two spellings of one name', () => {
    expect(order([axis('b'), axis('B1'), axis('B')])).toEqual(['B', 'b', 'B1'])
  })

  it('never interleaves the families: every U axis before every V before every W', () => {
    expect(
      order([axis('22', 'v'), axis('L', 'u'), axis('Z', 'w'), axis('1', 'v'), axis('A', 'u')])
    ).toEqual(['A', 'L', '1', '22', 'Z'])
  })

  it('keeps the design’s own mock order exactly: A…E then 1…4', () => {
    const federation = federate(KEYS.map((key) => mockModelIndex(key)))
    // The design's own list is `[...gx, ...gy]` (`sample-model.js:17–18`), so the ordering is
    // a no-op on the mock — which is what keeps the Section card's chips and the assistant's
    // grid list exactly as the prototype renders them.
    const DESIGN = ['A', 'B', 'C', 'D', 'E', '1', '2', '3', '4']
    expect(federation.grids.map((g) => g.name)).toEqual(DESIGN)
    // The Section card's chips and the assistant's schema both read that one list. No plane is
    // set, so no chip is active — the labels are all this reads; the card draws one row a family.
    const rows = sectionGridFamilies(federation, NO_PLANE).map((row) => row.map((c) => c.name))
    expect(rows).toEqual([DESIGN.slice(0, 5), DESIGN.slice(5)])
    expect(rows.flat()).toEqual(DESIGN)
    expect(chatSchema(federation).grids).toEqual(DESIGN)
  })

  it('still unions by name once when two models repeat the grid', () => {
    const a = index('A', { grids: [axis('2', 'v'), axis('A')] })
    const b = index('B', { grids: [axis('A'), axis('1', 'v'), axis('2', 'v')] })
    const federation = federate([a, b])
    expect(federation.grids.map((g) => g.name)).toEqual(['A', '1', '2'])
    expect(federation.grids).toHaveLength(3)
  })
})

/* ────────────────────────────── design parity ────────────────────────────── */

describe('federate — the prototype federation', () => {
  const ours = federate(KEYS.map((key) => mockModelIndex(key)))
  const theirs = designFederate(KEYS.map((key) => buildDisciplineModel(key)))

  it('composes the project header exactly as the design does', () => {
    expect(ours.project.name).toBe(theirs.project.name)
    expect(ours.project.file).toBe(theirs.project.file)
    expect(ours.project.schema).toBe(theirs.project.schema)
    expect(ours.project.site).toBe(theirs.project.site)
    expect(ours.project.building).toBe(theirs.project.building)
    // Named here too, so a drift in either side is obvious in the failure message.
    expect(ours.project.name).toBe('Block 1')
    expect(ours.project.file).toBe(
      'SB_ARC_R25.ifc + SB_STR_R25.ifc + SB_SIT_R25.ifc + SB_MEP_R25.ifc'
    )
  })

  it('lists the same files the design lists', () => {
    expect(ours.files.map((f) => f.file)).toEqual(theirs.files.map((p) => p.file))
    expect(ours.files.map((f) => f.key)).toEqual([...KEYS])
  })

  it('reproduces the design counts: 412 elements, 6 storeys, 9 grids', () => {
    expect(ours.elements).toHaveLength(412)
    expect(ours.storeys).toHaveLength(6)
    expect(ours.grids).toHaveLength(9)
    expect(theirs.elements).toHaveLength(412)
    expect(theirs.storeys).toHaveLength(6)
    expect(theirs.grids).toHaveLength(9)
    expect(ours.storeys.map((s) => s.name)).toEqual(theirs.storeys.map((s) => s.name))
    expect(ours.grids.map((g) => g.name)).toEqual(theirs.grids.map((g) => g.name))
    expect(ours.counts).toMatchObject({ models: 4, elements: 412, spaces: 0 })
  })

  it("assigns the design's own id blocks, numbered by the wider stride (2026-10-09)", () => {
    // The design numbers block i from i × 1 000 000; ours from slot × ID_STRIDE. The same model
    // in the same block, the same local id — only the stride differs, and no surface shows it.
    expect(ours.elements.map((e) => e.id)).toEqual(
      theirs.elements.map((e) => Math.floor(e.id / LEGACY_ID_STRIDE) * ID_STRIDE + e.localId)
    )
    expect(ours.elements.map((e) => e.localId)).toEqual(theirs.elements.map((e) => e.localId))
    expect(ours.elements.map((e) => e.model)).toEqual(theirs.elements.map((e) => e.model))
  })

  it('collects propKeys across the whole federation', () => {
    // Every model's keys, not just the first file's.
    for (const key of KEYS) {
      for (const k of mockModelIndex(key).propKeys) expect(ours.propKeys).toContain(k)
    }
  })
})
