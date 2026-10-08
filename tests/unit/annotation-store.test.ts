/**
 * The store's annotation actions — `SGVue.dc.html:1035–1039`, `:895` and `:2059–2071`, driven
 * against a recording viewer stub so the millimetre → metre conversion, the bubble's toggle and
 * the two lists can be asserted without a renderer.
 *
 * 2026-10-01: two section planes — `setSec` patches one and leaves the other, `clearSections`
 * clears both, and a grid bubble never touches the level plane.
 *
 * 2026-10-02 (phase 4 of the assistant's parity work): `placeSpot`, `placeMeasure` and
 * `showSpot` — the viewer's own commit for a click, at a project-frame point the store turns
 * into the scene's.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { setViewer, useShell, type Sections } from '../../src/renderer/state/shell'
import type { SectionsConfig, Viewer } from '../../src/renderer/viewer/viewer-core'
import type { MeasureRecord, SpotRecord } from '../../src/renderer/viewer/annotations'
import type { BasePoint } from '../../src/shared/georef'
import type { Georeference } from '../../src/shared/model-index.types'
import { NO_PLANE, NO_SECTIONS } from '../../src/shared/sections'
import { resetShell, stubViewer } from './stub-viewer'

interface Recorder {
  /** Every `setSections` call: both planes each time, the gridline cut and the level cut. */
  sections: SectionsConfig[]
  coords: Partial<BasePoint>[]
  calls: string[]
}

function stub(): { viewer: Viewer; rec: Recorder } {
  const rec: Recorder = { sections: [], coords: [], calls: [] }
  const viewer = stubViewer({
    setSections: (cfg: SectionsConfig) => rec.sections.push(cfg),
    setCoords: (c: Partial<BasePoint>) => rec.coords.push(c),
    clearMeasures: () => rec.calls.push('clearMeasures'),
    clearSpots: () => rec.calls.push('clearSpots'),
    dropMeasure: (id: number) => rec.calls.push(`dropMeasure:${id}`),
    dropSpot: (id: number) => rec.calls.push(`dropSpot:${id}`),
    focusPoint: (p: number[]) => rec.calls.push(`focusPoint:${p.join(',')}`),
    setDims: () => rec.calls.push('setDims')
  })
  return { viewer, rec }
}

let rec: Recorder

beforeEach(() => {
  resetShell()
  const s = stub()
  rec = s.rec
  setViewer(s.viewer)
})

const sections = (): Sections => useShell.getState().sections

describe('setSec', () => {
  it('starts with neither plane set', () => {
    expect(sections()).toEqual(NO_SECTIONS)
  })

  it('divides the card’s millimetres by 1000 exactly once (`:1037`)', () => {
    useShell.getState().setSec('grid', { name: 'C', offset: 1500, cut: true })
    expect(sections().grid.offset).toBe(1500)
    expect(rec.sections.at(-1)).toEqual({
      grid: { kind: 'grid', name: 'C', offset: 1.5, flip: false, cut: true },
      level: null
    })
  })

  it('maps the card’s "level" onto the renderer’s "storey"', () => {
    useShell.getState().setSec('level', { name: 'L2', offset: 1200, cut: true })
    expect(rec.sections.at(-1)).toEqual({
      grid: null,
      level: { kind: 'storey', name: 'L2', offset: 1.2, flip: false, cut: true }
    })
  })

  it('patches rather than replaces, so a nudge keeps the plane', () => {
    const st = useShell.getState()
    st.setSec('grid', { name: 'C', offset: 0, cut: true })
    st.setSec('grid', { offset: -500 })
    expect(sections().grid).toEqual({ name: 'C', offset: -500, flip: false, cut: true })
    expect(rec.sections.at(-1)!.grid).toMatchObject({ name: 'C', offset: -0.5 })
  })

  it('changes only the plane it names: the two cuts are independent (2026-10-01)', () => {
    const st = useShell.getState()
    st.setSec('grid', { name: 'C', offset: 0, cut: true })
    st.setSec('level', { name: 'L2', offset: 1200, cut: true })
    // Both are on, and the viewer is handed both in one call.
    expect(sections()).toEqual({
      grid: { name: 'C', offset: 0, flip: false, cut: true },
      level: { name: 'L2', offset: 1200, flip: false, cut: true }
    })
    expect(rec.sections.at(-1)).toEqual({
      grid: { kind: 'grid', name: 'C', offset: 0, flip: false, cut: true },
      level: { kind: 'storey', name: 'L2', offset: 1.2, flip: false, cut: true }
    })

    // An offset, a flip and the cut switch on one plane: the other is the same object still.
    const grid = sections().grid
    st.setSec('level', { offset: 1700 })
    st.setSec('level', { flip: true })
    st.setSec('level', { cut: false })
    expect(sections().grid).toBe(grid)
    expect(sections().level).toEqual({ name: 'L2', offset: 1700, flip: true, cut: false })
    expect(rec.sections.at(-1)).toEqual({
      grid: { kind: 'grid', name: 'C', offset: 0, flip: false, cut: true },
      level: { kind: 'storey', name: 'L2', offset: 1.7, flip: true, cut: false }
    })
    const level = sections().level
    st.setSec('grid', { offset: -500, flip: true })
    expect(sections().level).toBe(level)
    expect(sections().grid).toEqual({ name: 'C', offset: -500, flip: true, cut: true })
  })

  it('a plane’s own Clear leaves the other standing, and Clear all takes both', () => {
    const st = useShell.getState()
    st.setSec('grid', { name: 'C', offset: 250, flip: true, cut: true })
    st.setSec('level', { name: 'L2', offset: 1200, cut: true })
    st.setSec('level', NO_PLANE)
    expect(sections()).toEqual({ grid: { name: 'C', offset: 250, flip: true, cut: true }, level: NO_PLANE })
    expect(rec.sections.at(-1)).toEqual({
      grid: { kind: 'grid', name: 'C', offset: 0.25, flip: true, cut: true },
      level: null
    })

    st.setSec('level', { name: 'L3', offset: 1200, cut: true })
    st.clearSections()
    expect(sections()).toEqual(NO_SECTIONS)
    expect(rec.sections.at(-1)).toEqual({ grid: null, level: null })
  })

  it('sends null for a plane once it is cleared', () => {
    const st = useShell.getState()
    st.setSec('grid', { name: 'C', cut: true })
    st.setSec('grid', NO_PLANE)
    expect(rec.sections.at(-1)).toEqual({ grid: null, level: null })
  })

  it('a plane with controls touched but no name is still no plane', () => {
    // The card's controls stay live with nothing chosen, as the design's do with no section.
    const st = useShell.getState()
    st.setSec('grid', { offset: 500 })
    st.setSec('grid', { cut: true })
    st.setSec('level', { flip: true })
    expect(sections()).toEqual({
      grid: { name: '', offset: 500, flip: false, cut: true },
      level: { name: '', offset: 0, flip: true, cut: false }
    })
    expect(rec.sections.at(-1)).toEqual({ grid: null, level: null })
  })

  it('opens the Section card only when asked to', () => {
    useShell.getState().setSec('grid', { name: 'C' })
    expect(useShell.getState().card).toBeNull()
    useShell.getState().setSec('level', { name: 'L2' }, true)
    expect(useShell.getState().card).toBe('section')
  })
})

describe('gridClick', () => {
  it('sections that grid previewed, and opens the card (`:895`)', () => {
    useShell.getState().gridClick('C')
    expect(sections().grid).toEqual({ name: 'C', offset: 0, flip: false, cut: false })
    expect(useShell.getState().card).toBe('section')
    expect(rec.sections.at(-1)!.grid).toMatchObject({ kind: 'grid', name: 'C', cut: false })
  })

  it('clears the gridline plane when the bubble of the live grid is clicked again', () => {
    const st = useShell.getState()
    st.gridClick('C')
    useShell.getState().gridClick('C')
    expect(sections().grid.name).toBe('')
    expect(rec.sections.at(-1)).toEqual({ grid: null, level: null })
  })

  it('moves the plane when a different bubble is clicked', () => {
    const st = useShell.getState()
    st.gridClick('C')
    useShell.getState().gridClick('2')
    expect(sections().grid).toMatchObject({ name: '2', cut: false })
  })

  it('resets the offset and keeps the side, as the design’s patch does', () => {
    const st = useShell.getState()
    st.setSec('grid', { name: 'C', offset: 1500, flip: true, cut: true })
    st.gridClick('D')
    expect(sections().grid).toEqual({ name: 'D', offset: 0, flip: true, cut: false })
  })

  it('never touches the level plane (2026-10-01)', () => {
    const st = useShell.getState()
    st.setSec('level', { name: 'L2', offset: 1200, flip: true, cut: true })
    const level = sections().level
    st.gridClick('C')
    expect(sections().level).toBe(level)
    expect(rec.sections.at(-1)).toEqual({
      grid: { kind: 'grid', name: 'C', offset: 0, flip: false, cut: false },
      level: { kind: 'storey', name: 'L2', offset: 1.2, flip: true, cut: true }
    })
    // The live grid's bubble again: the gridline plane goes, the level cut stays.
    st.gridClick('C')
    expect(sections().level).toBe(level)
    expect(rec.sections.at(-1)).toEqual({
      grid: null,
      level: { kind: 'storey', name: 'L2', offset: 1.2, flip: true, cut: true }
    })
  })
})

/**
 * 2026-10-08 — the owner: *"Maybe just make the coordinates system toggle a read only, dont let
 * user change anything."* The design's `setCoord` (`:1039`) is gone; the base point is the boot
 * file's, written with the federation's frame (`setOffset`) and nowhere else.
 */
describe('the base point is read-only', () => {
  const FILE: Georeference = {
    source: 'IfcMapConversion',
    sources: ['IfcMapConversion'],
    method: 'IfcMapConversion',
    eastings: 12345.457,
    northings: 23456.766,
    orthogonalHeight: 5.05,
    xAxisAbscissa: 1,
    xAxisOrdinate: 0
  }

  it('has no action that sets a field, as the design’s setCoord did', () => {
    expect('setCoord' in useShell.getState()).toBe(false)
  })

  it('is written with the frame, from the declaration that defined it, and pushed to the viewer', () => {
    useShell.getState().setOffset([10, 20, 0], null, FILE)
    expect(useShell.getState()).toMatchObject({
      bootGeoref: FILE,
      coords: { E: 12345.457, N: 23456.766, Z: 5.05, angle: 0 }
    })
    expect(rec.coords.at(-1)).toEqual({ E: 12345.457, N: 23456.766, Z: 5.05, angle: 0 })
    // Cleared with the frame when nothing is loaded — never left standing for the next boot.
    useShell.getState().setOffset([0, 0, 0], null, null)
    expect(useShell.getState()).toMatchObject({ bootGeoref: null, coords: { E: null, N: null, Z: null, angle: null } })
    expect(rec.coords.at(-1)).toEqual({ E: null, N: null, Z: null, angle: null })
  })

  it('is not moved by a session, a link or a reply’s revert carrying a base point of its own', () => {
    useShell.getState().setOffset([0, 0, 0], null, FILE)
    const coords = useShell.getState().coords
    rec.coords.length = 0
    useShell.getState().applySession({ coords: { E: 28500, N: 30200, Z: 102.5, angle: 12.5 } })
    expect(useShell.getState().coords).toBe(coords)
    expect(rec.coords).toEqual([])
  })
})

describe('the two markup lists', () => {
  const M: MeasureRecord[] = [{ id: 1, p: [1, 2, 3], x: 1.66, sides: { x: { minus: 0.5, plus: 1.16 } } }]
  const S: SpotRecord[] = [
    { id: 2, p: [4, 5, 6], E: 1, N: 2, Z: 3, x: 4, y: 5, z: 6 }
  ]

  it('keep the list and its count together (`:894`)', () => {
    const st = useShell.getState()
    st.setMeasures(M)
    st.setSpots(S)
    expect(useShell.getState()).toMatchObject({
      measures: M,
      measureCount: 1,
      spots: S,
      spotCount: 1
    })
    useShell.getState().setMeasures([])
    expect(useShell.getState()).toMatchObject({ measures: [], measureCount: 0 })
  })

  it('delegate every mutation to the viewer, which owns them (`:2064`, `:2071`)', () => {
    const st = useShell.getState()
    st.clearMeasures()
    st.clearSpots()
    st.dropMeasure(1)
    st.dropSpot(2)
    st.focusPoint([1, 2, 3])
    expect(rec.calls).toEqual([
      'clearMeasures',
      'clearSpots',
      'dropMeasure:1',
      'dropSpot:2',
      'focusPoint:1,2,3'
    ])
  })

  it('the unit toggle is one state key, which the status bar reads too', () => {
    useShell.getState().setUnits('m')
    expect(useShell.getState().units).toBe('m')
    useShell.getState().setUnits('mm')
    expect(useShell.getState().units).toBe('mm')
  })
})

describe('placing a markup at a named point (2026-10-02)', () => {
  it('hands the viewer the scene point — the project-frame point less the whole-metre offset', () => {
    const placed: unknown[][] = []
    setViewer(
      stubViewer({
        placeSpot: (p: number[]) => placed.push(['spot', p]),
        placeMeasure: (p: number[], normal: number[] | null, selfId: number) => {
          placed.push(['measure', p, normal, selfId])
          return selfId !== 7
        }
      })
    )
    const st = useShell.getState()
    expect(st.placeSpot([4, 14, 3.3])).toBe(true)
    // The repository's synthetic offset: the scene stands tens of kilometres off the frame.
    st.setOffset([12345, 23456, 5], null, null)
    expect(useShell.getState().placeSpot([12347.5, 23458.25, 8.5])).toBe(true)
    expect(useShell.getState().placeMeasure([12347.5, 23458.25, 8.5], [0, 0, 1], 42)).toBe(true)
    // The face and the element are the caller's to say, and go through as given.
    expect(useShell.getState().placeMeasure([12345, 23456, 5], null, -1)).toBe(true)
    expect(placed).toEqual([
      ['spot', [4, 14, 3.3]],
      ['spot', [2.5, 2.25, 3.5]],
      ['measure', [2.5, 2.25, 3.5], [0, 0, 1], 42],
      ['measure', [0, 0, 0], null, -1]
    ])
    // The viewer's own answer — "no ray read anything" — is the store's.
    expect(useShell.getState().placeMeasure([12345, 23456, 5], null, 7)).toBe(false)
  })

  it('places nothing without a 3D view, and has no spot tag to set', () => {
    setViewer(null)
    const st = useShell.getState()
    expect(st.placeSpot([1, 2, 3])).toBe(false)
    expect(st.placeMeasure([1, 2, 3], null, -1)).toBe(false)
    expect(st.showSpot(1, true)).toBe('missing')
  })

  it('a spot tag’s state is the viewer’s to keep: the answer is passed straight through', () => {
    const asked: [number, boolean][] = []
    setViewer(
      stubViewer({
        showSpot: (id: number, full: boolean) => {
          asked.push([id, full])
          return id === 1 ? 'changed' : id === 2 ? 'already' : 'missing'
        }
      })
    )
    const st = useShell.getState()
    expect([st.showSpot(1, true), st.showSpot(2, false), st.showSpot(3, true)]).toEqual(['changed', 'already', 'missing'])
    expect(asked).toEqual([
      [1, true],
      [2, false],
      [3, true]
    ])
  })
})
