/**
 * Refactor pass 3 — selectors pulled out of components or split for speed, each checked to
 * say exactly what the code it replaced said.
 */
import { describe, expect, it } from 'vitest'
import type { Georeference } from '../../src/shared/model-index.types'
import { federate } from '../../src/shared/federate'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { group } from '../../src/shared/fmt'
import type { FilterStep } from '../../src/shared/rules'
import { coordsCaption } from '../../src/renderer/state/selectors/status'
import { groupTree, treeGroups, withSelection } from '../../src/renderer/state/selectors/tree'
import { ruleRows, valueOptions } from '../../src/renderer/state/selectors/filter'
import {
  visibilityFrame,
  visibilityFrameOnce,
  type VisFrame,
  type VisFrameInput
} from '../../src/renderer/state/selectors/visibility'

describe('coordsCaption — the 2026-09-20 caption rule', () => {
  const FILE = { E: 28500, N: 30200, Z: 102.5, angle: 12.5 }
  const conversion = (method: Georeference['method']): Georeference => ({
    source: 'IfcMapConversion',
    sources: ['IfcMapConversion'],
    method,
    eastings: 28500,
    northings: 30200,
    orthogonalHeight: 102.5,
    rotationDeg: 12.5
  })

  it.each([
    'IfcSite placement',
    'IfcMapConversion',
    'IfcMapConversion + IfcSite placement',
    'ePset_MapConversion'
  ] as const)('names %s while the fields show what the file said', (method) => {
    expect(coordsCaption(conversion(method), FILE)).toBe(` · ${method}`)
  })

  it('appends nothing when the file carries no georeferencing', () => {
    expect(coordsCaption(null, { E: null, N: null, Z: null, angle: null })).toBe('')
    expect(coordsCaption(conversion('none'), FILE)).toBe('')
  })

  it('appends nothing once the fields are the user’s own', () => {
    expect(coordsCaption(conversion('IfcMapConversion'), { ...FILE, E: 28501 })).toBe('')
    expect(coordsCaption(conversion('IfcMapConversion'), { ...FILE, angle: null })).toBe('')
  })
})

describe('the element tree: grouping and selection apart', () => {
  const elements = federate(['ARC', 'STR'].map((k) => mockModelIndex(k))).elements
  const base = {
    elements,
    treeMode: 'entity' as const,
    search: '',
    expanded: { IfcWall: true, IfcSlab: true },
    hidden: {}
  }

  it('is the same as grouping with the selection in one pass', () => {
    const walls = elements.filter((e) => e.type === 'IfcWall').map((e) => e.id)
    const selIds = [walls[0], walls[2]]
    const split = withSelection(groupTree(base), selIds)
    const old = treeGroups({ ...base, selIds })
    expect(split).toEqual(old)
    const rows = split.find((g) => g.key === 'IfcWall')!.items.filter((it) => it.sel)
    expect(rows.map((it) => [it.id, it.edge, it.bg, it.fg])).toEqual(
      selIds.map((id) => [id, 'var(--accent)', 'var(--sel-bg)', 'var(--sel-ink)'])
    )
  })

  it('leaves groups without a selected row, and an empty selection, untouched', () => {
    const grouped = groupTree(base)
    expect(withSelection(grouped, [])).toBe(grouped)
    const wall = elements.find((e) => e.type === 'IfcWall')!.id
    const out = withSelection(grouped, [wall])
    const slab = grouped.findIndex((g) => g.key === 'IfcSlab')
    expect(out[slab]).toBe(grouped[slab])
  })
})

describe('ruleRows reuses the value list per federation and property', () => {
  const elements = federate(['ARC'].map((k) => mockModelIndex(k))).elements

  it('returns the same list for the same property, equal to a fresh scan', () => {
    const rule = { prop: 'IfcEntity', op: '=', val: 'IfcW' } as const
    const [a] = ruleRows([rule], elements)
    const [b] = ruleRows([{ ...rule, val: 'IfcWa' }], elements)
    expect(b.values).toBe(a.values)
    expect(a.values).toEqual(valueOptions(elements, 'IfcEntity'))
  })
})

/**
 * 2026-10-02 — the refactor pass. The frame and its reset pill (`app/VisibilityFrame.tsx`) each
 * ran `visibilityFrame` through a `useMemo` of their own, and its body built an N-element array
 * only to count it. The count is a loop now, and the two share one remembered answer.
 */
describe('the visibility frame is computed once, whoever asks', () => {
  const elements = federate(['ARC', 'STR', 'SIT', 'MEP'].map((k) => mockModelIndex(k))).elements
  const storeys = [...new Set(elements.map((e) => e.storey))]
  const isolate: FilterStep = { id: 'f1', on: true, action: 'isolate', rules: [{ prop: 'Level', op: '=', val: storeys[0] }] }

  /** The selector's body as it was before the pass, word for word: what the new one has to say. */
  const before = (s: VisFrameInput): VisFrame => {
    const total = s.elements.length
    const manual = s.elements.filter((e) => s.hidden[e.id] || s.storeyVis[e.storey] === false).length
    const live = s.stack.filter((x) => x.on && x.action !== 'highlight')
    const hiddenCount = manual + (live.length ? total - s.visibleCount - manual : 0)
    const n = group(hiddenCount)
    const label = live.length
      ? `${live.length} filter step${live.length === 1 ? '' : 's'} — ${n} hidden`
      : `${n} element${hiddenCount === 1 ? '' : 's'} hidden`
    return live.length
      ? {
          hiddenCount,
          line: 'var(--accent)',
          glow: 'var(--sel-bg)',
          bg: 'var(--sel-bg)',
          fg: 'var(--sel-ink)',
          label
        }
      : {
          hiddenCount,
          line: 'var(--warn-line)',
          glow: 'var(--warn-bg)',
          bg: 'var(--warn-bg)',
          fg: 'var(--warn-ink)',
          label
        }
  }

  const onStorey = (name: string, n: number): Record<number, boolean> =>
    Object.fromEntries(elements.filter((e) => e.storey === name).slice(0, n).map((e) => [e.id, true]))
  /** What is hidden by hand, several ways — each with and without a live filter step. */
  const CASES: Pick<VisFrameInput, 'hidden' | 'storeyVis'>[] = [
    { hidden: {}, storeyVis: {} },
    { hidden: { [elements[0].id]: true, [elements[7].id]: true, [elements[411].id]: true }, storeyVis: {} },
    // A key that is there and false hides nothing, and a storey that is there and true neither.
    { hidden: { [elements[3].id]: false }, storeyVis: { [storeys[0]]: true } },
    { hidden: {}, storeyVis: { [storeys[1]]: false } },
    // Both, overlapping: an element hidden by hand on a storey that is off is counted once.
    { hidden: onStorey(storeys[1], 5), storeyVis: { [storeys[1]]: false, [storeys[2]]: false } },
    { hidden: Object.fromEntries(elements.map((e) => [e.id, true])), storeyVis: {} }
  ]

  it('counts what the expression it replaced counted, on the mock federation', () => {
    expect(elements).toHaveLength(412)
    const counts: number[] = []
    for (const { hidden, storeyVis } of CASES) {
      const manual = elements.filter((e) => hidden[e.id] || storeyVis[e.storey] === false).length
      counts.push(manual)
      // No live filter step: the frame's count is the manual one.
      const input: VisFrameInput = { elements, hidden, storeyVis, stack: [], visibleCount: 412 - manual }
      expect(visibilityFrame(input).hiddenCount).toBe(manual)
      expect(visibilityFrame(input)).toEqual(before(input))
      // A live step: `total − visibleCount`, the manual hides counted once inside it.
      const filtered: VisFrameInput = { ...input, stack: [isolate], visibleCount: 100 }
      expect(visibilityFrame(filtered)).toEqual(before(filtered))
      expect(visibilityFrame(filtered).hiddenCount).toBe(312)
    }
    // The cases are not all the same case: nothing, three, none, a storey, two storeys, all.
    expect(counts[0]).toBe(0)
    expect(counts[1]).toBe(3)
    expect(counts[2]).toBe(0)
    expect(counts[3]).toBe(elements.filter((e) => e.storey === storeys[1]).length)
    expect(counts[4]).toBe(elements.filter((e) => e.storey === storeys[1] || e.storey === storeys[2]).length)
    expect(counts[5]).toBe(412)
    expect(counts[3]).toBeGreaterThan(0)
    expect(counts[4]).toBeGreaterThan(counts[3])
  })

  it('answers the same inputs with the same object, in one pass — and a changed input with a new one', () => {
    // One pass over the elements is one computation: every way of walking an array reads its
    // first entry once, so that read is what is counted.
    let passes = 0
    const counted = new Proxy(elements, {
      get(target, prop, receiver) {
        if (prop === '0') passes++
        return Reflect.get(target, prop, receiver)
      }
    })
    const input: VisFrameInput = { elements: counted, hidden: { [elements[0].id]: true }, storeyVis: {}, stack: [], visibleCount: 411 }

    const first = visibilityFrameOnce(input)
    expect(passes).toBe(1)
    expect(first).toEqual(before({ ...input, elements }))
    // The frame and its pill ask about the same store, each with an object of its own.
    const second = visibilityFrameOnce({ ...input })
    expect(second).toBe(first)
    expect(visibilityFrameOnce({ ...input })).toBe(first)
    expect(passes).toBe(1)

    // Each of the five inputs is part of the key: a new one is a new computation, with its values.
    let was = first
    const changes: Partial<VisFrameInput>[] = [
      { hidden: { [elements[0].id]: true, [elements[1].id]: true } },
      { storeyVis: { [storeys[1]]: false } },
      { stack: [isolate] },
      { visibleCount: 100 }
    ]
    let now = input
    changes.forEach((change, i) => {
      now = { ...now, ...change }
      const frame = visibilityFrameOnce(now)
      expect([i, frame === was, passes]).toEqual([i, false, i + 2])
      expect(frame).toEqual(before({ ...now, elements }))
      // …and asked again, it is that one.
      expect(visibilityFrameOnce({ ...now })).toBe(frame)
      expect(passes).toBe(i + 2)
      was = frame
    })
    // The federation replaced: the same elements in a new array are a new input.
    const replaced = visibilityFrameOnce({ ...now, elements: [...elements] })
    expect(replaced).not.toBe(was)
    expect(replaced).toEqual(was)

    // One entry: going back to inputs asked about earlier computes again — and says the same.
    const again = visibilityFrameOnce(input)
    expect(again).not.toBe(first)
    expect(again).toEqual(first)
    expect(passes).toBe(6)
  })

  it('keeps the references it was asked about, not the caller’s object', () => {
    const input: VisFrameInput = { elements, hidden: {}, storeyVis: {}, stack: [], visibleCount: 412 }
    const none = visibilityFrameOnce(input)
    expect(none.hiddenCount).toBe(0)
    // The same object handed back with one field replaced is a different input.
    input.hidden = { [elements[0].id]: true }
    input.visibleCount = 411
    const one = visibilityFrameOnce(input)
    expect(one).not.toBe(none)
    expect(one.label).toBe('1 element hidden')
  })
})
