/**
 * The right-click menu — `SGVue.dc.html:1898–1921`, checked item by item.
 *
 * The menu is the one surface where a wrong label is also a wrong *action*: "Hide similar"
 * reads the ObjectType and "Hide similar entity" the IFC entity, and the two are one word
 * apart in the markup.
 */
import { describe, expect, it } from 'vitest'
import type { FederatedElement } from '../../src/shared/federate'
import {
  CTX_EDGE_GAP,
  clampCtxX,
  clampCtxY,
  ctxItems,
  ctxTargets,
  shortList,
  type CtxInput
} from '../../src/renderer/state/selectors/ctx'

let nextId = 1
function element(patch: Partial<FederatedElement>): FederatedElement {
  const id = patch.id ?? nextId++
  return {
    id,
    localId: id,
    expressId: id,
    guid: `guid${id}`,
    guidValid: true,
    tag: '',
    model: 'ARC',
    name: `Element ${id}`,
    description: '',
    type: 'IfcWall',
    predefinedType: 'NOTDEFINED',
    effectivePredefinedType: patch.predefinedType ?? 'NOTDEFINED',
    objectType: 'Basic Wall:EW200',
    typeName: '',
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
    ...patch
  }
}

const WALL_A = element({ id: 1, type: 'IfcWall', objectType: 'Basic Wall:EW200' })
const WALL_B = element({ id: 2, type: 'IfcWall', objectType: 'Basic Wall:EW200' })
const DOOR = element({ id: 3, type: 'IfcDoor', objectType: 'Single Door:D1' })
const COLUMN = element({ id: 4, type: 'IfcColumn', objectType: 'Column:C1' })
const BEAM = element({ id: 5, type: 'IfcBeam', objectType: 'Beam:B1' })
const ELEMENTS = [WALL_A, WALL_B, DOOR, COLUMN, BEAM]
const BY_ID = new Map(ELEMENTS.map((e) => [e.id, e]))

const input = (patch: Partial<CtxInput> = {}): CtxInput => ({
  elements: ELEMENTS,
  byId: BY_ID,
  ctxId: null,
  selIds: [],
  hidden: {},
  ...patch
})

const labels = (i: CtxInput): string[] => ctxItems(i).map((x) => x.label)

describe('what the menu acts on', () => {
  it('acts on the clicked element when it is not part of a multi-selection', () => {
    expect(ctxTargets(input({ ctxId: 1, selIds: [3] }))).toEqual([1])
    expect(ctxTargets(input({ ctxId: 1, selIds: [1] }))).toEqual([1])
  })

  it('acts on the whole selection when the clicked element is part of it', () => {
    expect(ctxTargets(input({ ctxId: 1, selIds: [1, 2, 3] }))).toEqual([1, 2, 3])
  })

  it('acts on nothing when the click missed', () => {
    expect(ctxTargets(input({ ctxId: null, selIds: [1, 2] }))).toEqual([])
    // An id that is no longer in the federation is a miss too.
    expect(ctxTargets(input({ ctxId: 999 }))).toEqual([])
  })
})

describe('the items', () => {
  it('is the design’s twelve, in order, on a single element', () => {
    expect(labels(input({ ctxId: 1 }))).toEqual([
      'Hide',
      'Hide similar · Basic Wall:EW200',
      'Hide similar entity · Wall',
      'Isolate',
      'Isolate similar · Basic Wall:EW200',
      'Isolate similar entity · Wall',
      'Select similar · Basic Wall:EW200',
      'Zoom to',
      'Properties',
      'Ask about this',
      'Show all hidden',
      'Zoom extents'
    ])
  })

  it('carries the shortcuts and the three separators', () => {
    const items = ctxItems(input({ ctxId: 1 }))
    expect(items.map((x) => x.key)).toEqual([
      'H', '', '', 'I', '', '', '', 'F', '', '', '⇧H', 'Home'
    ])
    const rule = '1px solid var(--border)'
    expect(items.filter((x) => x.top === rule).map((x) => x.label)).toEqual([
      'Isolate',
      'Select similar · Basic Wall:EW200',
      'Ask about this',
      'Show all hidden'
    ])
    expect(items.every((x) => x.fg === 'var(--ink)')).toBe(true)
  })

  it('is only the last two when the click missed, with no separator above them', () => {
    const items = ctxItems(input({ ctxId: null }))
    expect(items.map((x) => x.label)).toEqual(['Show all hidden', 'Zoom extents'])
    expect(items.map((x) => x.top)).toEqual(['0', '0'])
  })

  it('suffixes the selection count on the three items that take one', () => {
    const three = labels(input({ ctxId: 1, selIds: [1, 2, 3] }))
    expect(three[0]).toBe('Hide (3)')
    expect(three[3]).toBe('Isolate (3)')
    expect(three[9]).toBe('Ask about this (3)')
    // Not on the "similar" items, which act on a family rather than on the selection.
    expect(three[1]).toBe('Hide similar · Basic Wall:EW200, Single Door:D1')
    // A selection of one carries no suffix.
    expect(labels(input({ ctxId: 1, selIds: [1] }))[0]).toBe('Hide')
  })

  it('collapses more than two names to a count', () => {
    expect(shortList([])).toBe('')
    expect(shortList(['A'])).toBe('A')
    expect(shortList(['A', 'B'])).toBe('A, B')
    expect(shortList(['A', 'B', 'C'])).toBe('3 types')
    const four = labels(input({ ctxId: 1, selIds: [1, 3, 4, 5] }))
    expect(four[1]).toBe('Hide similar · 4 types')
    expect(four[2]).toBe('Hide similar entity · 4 types')
    // Two walls are one ObjectType and one entity, so both stay spelled out.
    const two = labels(input({ ctxId: 1, selIds: [1, 2] }))
    expect(two[1]).toBe('Hide similar · Basic Wall:EW200')
    expect(two[2]).toBe('Hide similar entity · Wall')
  })
})

/**
 * 2026-11-11 — the owner, asked "Should right-click 'similar' match by the type name first, as
 * other viewers do?": *"Yes, by type"*. "Similar" is the same type object's Name; the element's
 * own ObjectType only when it has no type; and an element with neither gets no "similar · …"
 * item — never a blank label that takes every element with nothing.
 */
describe('"similar" is by the type, then by ObjectType, and never by nothing', () => {
  const T1 = element({ id: 11, type: 'IfcWall', typeName: 'Family A:Type 1', objectType: 'CODE_A' })
  const T2 = element({ id: 12, type: 'IfcWall', typeName: 'Family A:Type 1', objectType: 'CODE_B' })
  const T3 = element({ id: 13, type: 'IfcSlab', typeName: 'Family B:Type 2', objectType: 'CODE_A' })
  const T4 = element({ id: 14, type: 'IfcWall', typeName: 'Family A:Type 1', objectType: '' })
  const U1 = element({ id: 15, type: 'IfcBuildingElementProxy', typeName: '', objectType: 'CODE_A' })
  const U2 = element({ id: 16, type: 'IfcBuildingElementProxy', typeName: '', objectType: 'CODE_A' })
  const E1 = element({ id: 17, type: 'IfcBeam', typeName: '', objectType: '' })
  const E2 = element({ id: 18, type: 'IfcColumn', typeName: '', objectType: '' })
  const ALL = [T1, T2, T3, T4, U1, U2, E1, E2]
  const on = (patch: Partial<CtxInput>): CtxInput =>
    input({ elements: ALL, byId: new Map(ALL.map((e) => [e.id, e])), ...patch })
  const ids = (i: CtxInput, label: string): number[] | undefined =>
    (ctxItems(i).find((x) => x.label.startsWith(label))?.action as { ids: number[] } | undefined)?.ids

  it('a typed element: the label is the type’s Name and it takes that type, whatever each ObjectType is', () => {
    const i = on({ ctxId: 11 })
    expect(labels(i)).toContain('Hide similar · Family A:Type 1')
    expect(labels(i)).toContain('Isolate similar · Family A:Type 1')
    expect(labels(i)).toContain('Select similar · Family A:Type 1')
    // T2 has another ObjectType and T4 none: same type, so similar. T3, U1 and U2 share T1's
    // ObjectType but not its type: not similar.
    expect(ids(i, 'Hide similar ·')).toEqual([11, 12, 14])
    expect(ids(i, 'Isolate similar ·')).toEqual([11, 12, 14])
    expect(ids(i, 'Select similar ·')).toEqual([11, 12, 14])
  })

  it('a typed element with no ObjectType of its own is still similar to its type', () => {
    const i = on({ ctxId: 14 })
    expect(labels(i)).toContain('Hide similar · Family A:Type 1')
    expect(ids(i, 'Hide similar ·')).toEqual([11, 12, 14])
  })

  it('an element with no type: by its own ObjectType, among elements with no type', () => {
    const i = on({ ctxId: 15 })
    expect(labels(i)).toContain('Hide similar · CODE_A')
    expect(ids(i, 'Hide similar ·')).toEqual([15, 16])
  })

  it('an element with neither gets no "similar · …" item, and the rest of the menu stands', () => {
    const i = on({ ctxId: 17 })
    expect(labels(i)).toEqual([
      'Hide',
      'Hide similar entity · Beam',
      'Isolate',
      'Isolate similar entity · Beam',
      'Zoom to',
      'Properties',
      'Ask about this',
      'Show all hidden',
      'Zoom extents'
    ])
    // No label ends in the separator dot with nothing after it.
    expect(labels(i).some((l) => /·\s*$/.test(l))).toBe(false)
    // The rule above the Select group moves to its next item; no rule is doubled or lost.
    const top = (label: string): string => ctxItems(i).find((x) => x.label === label)!.top
    expect(top('Zoom to')).toBe('1px solid var(--border)')
    expect(top('Isolate')).toBe('1px solid var(--border)')
    expect(top('Ask about this')).toBe('1px solid var(--border)')
    // With the item present, the rule is where the design has it.
    const typed = ctxItems(on({ ctxId: 11 }))
    expect(typed.find((x) => x.label.startsWith('Select similar ·'))!.top).toBe('1px solid var(--border)')
    expect(typed.find((x) => x.label === 'Zoom to')!.top).toBe('0')
  })

  it('a multi-selection names only the kinds it has, and one with none has no "similar · …" item', () => {
    const mixed = on({ ctxId: 11, selIds: [11, 15, 17] })
    expect(labels(mixed)).toContain('Hide similar · Family A:Type 1, CODE_A')
    expect(ids(mixed, 'Hide similar ·')).toEqual([11, 12, 14, 15, 16])
    const none = on({ ctxId: 17, selIds: [17, 18] })
    expect(labels(none).some((l) => l.includes('similar ·'))).toBe(false)
    expect(labels(none)).toContain('Hide similar entity · Beam, Column')
  })

  it('never takes the elements with neither, whatever is clicked', () => {
    for (const e of ALL) {
      const got = ids(on({ ctxId: e.id }), 'Hide similar ·') ?? []
      if (e.id !== 17) expect(got).not.toContain(17)
      if (e.id !== 18) expect(got).not.toContain(18)
    }
  })
})

describe('the actions', () => {
  const act = (i: CtxInput, label: string): unknown =>
    ctxItems(i).find((x) => x.label.startsWith(label))!.action

  it('hides and isolates the target, and "similar" widens to the family', () => {
    const i = input({ ctxId: 1, selIds: [1, 3] })
    expect(act(i, 'Hide (')).toEqual({ kind: 'hide', ids: [1, 3] })
    expect(act(i, 'Isolate (')).toEqual({ kind: 'isolate', ids: [1, 3] })
    // ObjectType: the two walls and the door. Entity: the same set, by IfcWall / IfcDoor.
    expect(act(i, 'Hide similar ·')).toEqual({ kind: 'hide', ids: [1, 2, 3] })
    expect(act(i, 'Hide similar entity')).toEqual({ kind: 'hide', ids: [1, 2, 3] })
    expect(act(i, 'Isolate similar ·')).toEqual({ kind: 'isolate', ids: [1, 2, 3] })
  })

  it('"Select similar" skips what is hidden', () => {
    expect(act(input({ ctxId: 1 }), 'Select similar')).toEqual({ kind: 'select', ids: [1, 2] })
    expect(act(input({ ctxId: 1, hidden: { 2: true } }), 'Select similar')).toEqual({
      kind: 'select',
      ids: [1]
    })
  })

  it('"Properties" selects only the clicked element, even inside a multi-selection', () => {
    expect(act(input({ ctxId: 1, selIds: [1, 2, 3] }), 'Properties')).toEqual({
      kind: 'select',
      ids: [1]
    })
    expect(act(input({ ctxId: 1, selIds: [1, 2, 3] }), 'Zoom to')).toEqual({
      kind: 'zoomTo',
      ids: [1, 2, 3]
    })
    expect(act(input({ ctxId: 1, selIds: [1, 2, 3] }), 'Ask about this')).toEqual({
      kind: 'ask',
      ids: [1, 2, 3]
    })
  })
})

describe('position', () => {
  it('keeps the design\u2019s 220 px right margin', () => {
    expect(clampCtxX(400, 1440)).toBe(400)
    expect(clampCtxX(1400, 1440)).toBe(1220)
  })

  /**
   * The design clamps the top to `innerHeight - 260` whatever the menu holds (`:1901`), and
   * the element menu is 385 px tall \u2014 so a right-click low in an 860 px window opened a menu
   * whose last three items were off the bottom. Phase 10 clamps against the measured height.
   */
  it('leaves a menu that already fits exactly where the pointer was', () => {
    expect(clampCtxY(300, 385, 860)).toBe(300)
    expect(clampCtxY(467, 385, 860)).toBe(467)
  })

  it('lifts a menu that would run off the bottom by exactly what it overflows', () => {
    // 800 + 385 = 1185, well past 860: the top becomes 860 - 385 - 8.
    expect(clampCtxY(800, 385, 860)).toBe(860 - 385 - CTX_EDGE_GAP)
    // The design would have put this two-item menu at 600; it fits at the pointer.
    expect(clampCtxY(800, 80, 860)).toBe(860 - 80 - CTX_EDGE_GAP)
  })

  it('never lifts a menu past the top edge, however tall it is', () => {
    expect(clampCtxY(500, 2000, 860)).toBe(CTX_EDGE_GAP)
  })
})
