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
import {
  basePointSource,
  coordsCaption,
  LINE_UP_NAME_CHARS,
  lineUpNote,
  notLinedUp
} from '../../src/renderer/state/selectors/status'
import { groupTree, treeGroups, withSelection } from '../../src/renderer/state/selectors/tree'
import { ruleRows, valueOptions } from '../../src/renderer/state/selectors/filter'
import {
  visibilityFrame,
  visibilityFrameOnce,
  type VisFrame,
  type VisFrameInput
} from '../../src/renderer/state/selectors/visibility'

describe('coordsCaption — the 2026-09-20 caption rule', () => {
  const declared = (method: Georeference['method']): Georeference => ({
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
    'ePset_MapConversion',
    // 2026-10-08, rule 4 — Revit's exports with no EPSG code, and its IFC2X3 ones.
    'WorldCoordinateSystem',
    'WorldCoordinateSystem + IfcSite placement'
  ] as const)('names %s', (method) => {
    expect(coordsCaption(declared(method))).toBe(` · ${method}`)
  })

  it('appends nothing when the file carries no georeferencing', () => {
    expect(coordsCaption(null)).toBe('')
    expect(coordsCaption(declared('none'))).toBe('')
  })
})

/**
 * 2026-10-08 — the card, the CRS chips and `basePointSource` are read off the store's
 * `bootGeoref`, the declaration that defined the federation's frame; and the card is read-only, so
 * the four fields are always that declaration's base point. Whose they are is `file` or `none`.
 */
describe('basePointSource — the file’s, or none', () => {
  it('is the file’s when the declaration that defined the frame states one, else none', () => {
    const site: Georeference = {
      source: 'IfcSite',
      sources: ['IfcSite'],
      method: 'IfcSite placement',
      site: { placement: [12345.457, 23456.766, 5.05], rotationDeg: -43.4103 }
    }
    expect(basePointSource(site)).toBe('file')
    expect(basePointSource(mockModelIndex('ARC').georef)).toBe('none')
    expect(basePointSource(null)).toBe('none')
  })
})

/**
 * 2026-10-08 — the Coordinate-system card's one-line note, the owner's choice of the ways offered
 * to say that a model could not be lined up: *"One-line note on screen"*.
 */
describe('notLinedUp and lineUpNote — which model could not be lined up, in one line', () => {
  const site: Georeference = {
    source: 'IfcSite',
    sources: ['IfcSite'],
    method: 'IfcSite placement',
    site: { placement: [12345.457, 23456.766, 5.05], rotationDeg: -43.4103 }
  }
  const conversion: Georeference = {
    source: 'IfcMapConversion',
    sources: ['IfcMapConversion'],
    method: 'IfcMapConversion',
    eastings: 12345.457,
    northings: 23456.766,
    orthogonalHeight: 5.05
  }
  const none: Georeference = { source: 'none', sources: [], method: 'none' }
  const model = (
    key: string,
    fileName: string,
    georef: Georeference,
    farPlacementMetres?: number
  ): ReturnType<typeof mockModelIndex> => ({
    ...mockModelIndex(key),
    fileName,
    georef,
    ...(farPlacementMetres !== undefined ? { farPlacementMetres } : {})
  })
  const say = (models: ReturnType<typeof mockModelIndex>[], boot: Georeference | null): string =>
    lineUpNote(notLinedUp({ federation: federate(models), bootGeoref: boot, library: [], uploadNames: {} }))

  it('has nothing to say with one model loaded, or when every model lines up', () => {
    expect(say([model('ARC', 'Tower A.ifc', none, 9000)], none)).toBe('')
    expect(say([model('ARC', 'Tower A.ifc', site), model('STR', 'STR.ifc', conversion)], site)).toBe('')
    // Two local files: neither has a map position, so neither is the odd one out.
    expect(say([model('ARC', 'Tower A.ifc', none), model('STR', 'STR.ifc', none)], none)).toBe('')
    expect(notLinedUp({ federation: federate([]), bootGeoref: null, library: [], uploadNames: {} })).toEqual([])
  })

  it('names a model with no map position when another model has one', () => {
    expect(say([model('ARC', 'Tower A.ifc', site), model('STR', 'Tower B.ifc', none, 25_524)], site)).toBe(
      'Tower B.ifc could not be lined up — it has no map position.'
    )
  })

  it('counts a WorldCoordinateSystem tilted at the origin as no map position, as a tilted site is', () => {
    const tilted: Georeference = { ...none, wcs: { origin: [0, 0, 0], pureZRotation: false } }
    expect(say([model('ARC', 'Tower A.ifc', site), model('STR', 'Tilted.ifc', tilted)], site)).toBe(
      'Tilted.ifc could not be lined up — it has no map position.'
    )
  })

  it('names a model that landed far from the others, to a tenth of a kilometre', () => {
    expect(say([model('ARC', 'Tower A.ifc', site), model('STR', 'STR.ifc', conversion, 12_345.6)], site)).toBe(
      'STR.ifc could not be lined up — it sits 12.3 km from the others.'
    )
  })

  it('names them all in one line when there are several', () => {
    expect(
      say(
        [model('ARC', 'Tower A.ifc', site), model('STR', 'Tower B.ifc', none), model('SIT', 'STR.ifc', conversion, 12_345.6)],
        site
      )
    ).toBe('2 models could not be lined up: Tower B.ifc (no map position), STR.ifc (12.3 km away).')
  })

  it('names the boot model when it is the one with no map position — and no distance from it', () => {
    // The scene's origin is the boot model's own, so the model that has a map position lands
    // kilometres from it: that one stands where its file puts it, and is not named.
    const models = [model('ARC', 'Local.ifc', none), model('STR', 'STR.ifc', conversion, 25_524)]
    expect(say(models, none)).toBe('Local.ifc could not be lined up — it has no map position.')
    // The frame stays the boot model's after it is unloaded: what is left is not "far" either.
    expect(say([model('STR', 'STR.ifc', conversion, 25_524), model('MEP', 'MEP.ifc', site, 25_520)], none)).toBe('')
  })

  it('still says it after the boot model that has a map position is unloaded', () => {
    const models = [model('STR', 'STR.ifc', conversion), model('SIT', 'Local.ifc', none, 25_524)]
    expect(say(models, site)).toBe('Local.ifc could not be lined up — it has no map position.')
  })

  it('names a model by the file line its sidebar row shows: the picked file’s name, else the library’s', () => {
    // A file opened from disk is indexed under its key; the row shows the name it was picked by.
    const federation = federate([model('ARC', 'Tower A.ifc', site), model('STR', 'STR', none)])
    expect(lineUpNote(notLinedUp({ federation, bootGeoref: site, library: [], uploadNames: { STR: 'Tower B.ifc' } }))).toBe(
      'Tower B.ifc could not be lined up — it has no map position.'
    )
    const library = [{ key: 'STR', name: 'Structure', file: 'SB_STR_R25.ifc', swatch: '#9AA5A3' }]
    expect(lineUpNote(notLinedUp({ federation, bootGeoref: site, library, uploadNames: {} }))).toBe(
      'SB_STR_R25.ifc could not be lined up — it has no map position.'
    )
  })

  it('takes the file’s name through labelText: no control or direction characters, and clipped', () => {
    const hostile = 'Tower\u202E B\n.ifc'
    const long = 'N'.repeat(LINE_UP_NAME_CHARS + 30) + '.ifc'
    const issues = notLinedUp({
      federation: federate([model('ARC', 'Tower A.ifc', site), model('STR', hostile, none), model('SIT', long, none)]),
      bootGeoref: site,
      library: [],
      uploadNames: {}
    })
    expect(issues.map((x) => x.name)).toEqual(['Tower B.ifc', 'N'.repeat(LINE_UP_NAME_CHARS) + '…'])
    expect(lineUpNote(issues)).toBe(`2 models could not be lined up: Tower B.ifc (no map position), ${'N'.repeat(LINE_UP_NAME_CHARS)}… (no map position).`)
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
