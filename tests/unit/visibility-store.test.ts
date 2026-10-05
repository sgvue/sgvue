/**
 * Phase 5 in the store — undo/redo, the filter stack, activate mode, saved sets and
 * viewpoints, driven without a viewer or a DOM (`SGVue.dc.html:1012–1055`, `:1659–1673`,
 * `:1722–1735`).
 *
 * The undo stacks are module state, exactly as the design keeps them on the instance, so each
 * test starts from `resetHistory()` as well as from a fresh store.
 *
 * 2026-10-01: a viewpoint keeps both section planes (and the old single `section` beside them),
 * names them `grid C + level L2`, and one saved before there were two still restores.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { federate } from '../../src/shared/federate'
import { HL } from '../../src/shared/colors'
import { UNDO_CAP } from '../../src/shared/undo'
import { visFn, type FilterStep } from '../../src/shared/rules'
import { NO_PLANE, NO_SECTIONS } from '../../src/shared/sections'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { historyDepth, setViewer, useShell, type ShellState } from '../../src/renderer/state/shell'
import { FSETS_KEY, viewsKeyFor } from '../../src/renderer/state/persist'
import type { Viewpoint } from '../../src/renderer/state/selectors/views'
import type { CameraState } from '../../src/renderer/viewer/camera'
import { memoryStorage, resetShell as reset, stubViewer } from './stub-viewer'

const full = federate([mockModelIndex('ARC'), mockModelIndex('STR')])
const st = (): ShellState => useShell.getState()

/** Enough of a viewer to record what the store asks of it. */
const CAM: CameraState = { theta: 1, phi: 0.5, dist: 70, half: 30, target: [1, 2, 3], proj: 'persp' }
interface Recorder {
  pickable: unknown[]
  colors: unknown[]
  sections: unknown[]
  cameras: unknown[]
  highlightColors: unknown[]
}
function recordViewer(): Recorder {
  const rec: Recorder = { pickable: [], colors: [], sections: [], cameras: [], highlightColors: [] }
  setViewer(
    stubViewer({
      setHighlightColor: (c: unknown) => rec.highlightColors.push(c),
      setElementColors: (m: unknown) => rec.colors.push(m),
      setPickable: (f: unknown) => rec.pickable.push(f),
      // Both planes in one call: `{ grid, level }`, each a configuration or null.
      setSections: (c: unknown) => rec.sections.push(c),
      setCamera: (c: unknown) => rec.cameras.push(c),
      getCamera: () => CAM
    })
  )
  return rec
}

beforeEach(() => {
  reset()
  setViewer(null)
  st().commitModels(full)
})
afterEach(() => {
  setViewer(null)
  vi.unstubAllGlobals()
})

const wallStep = (over: Partial<FilterStep> = {}): FilterStep => ({
  id: 'w',
  on: true,
  action: 'isolate',
  color: HL[0],
  rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWall', join: 'and' }],
  ...over
})

describe('undo and redo', () => {
  it('⌘Z unwinds one visibility change and ⇧⌘Z puts it back', () => {
    const ids = full.elements.slice(0, 3).map((e) => e.id)
    st().hide(ids)
    expect(Object.keys(st().hidden)).toHaveLength(3)
    expect(st()).toMatchObject({ canUndo: true, canRedo: false })

    st().step(true)
    expect(st().hidden).toEqual({})
    expect(st()).toMatchObject({ canUndo: false, canRedo: true })

    st().step(false)
    expect(Object.keys(st().hidden).map(Number)).toEqual(ids)
    expect(st()).toMatchObject({ canUndo: true, canRedo: false })
  })

  it('unwinds one step at a time, in order', () => {
    const [a, b, c] = full.elements.slice(0, 3).map((e) => e.id)
    st().hide([a])
    st().hide([b])
    st().hide([c])
    expect(Object.keys(st().hidden)).toHaveLength(3)
    st().step(true)
    expect(Object.keys(st().hidden).map(Number)).toEqual([a, b])
    st().step(true)
    expect(Object.keys(st().hidden).map(Number)).toEqual([a])
  })

  it('restores only the five VIS_KEYS — the camera, selection and theme are not undoable', () => {
    st().hide([full.elements[0].id])
    useShell.setState({ theme: 'light', search: 'wall', propOpen: { geo: true } })
    st().select(full.elements[1].id)
    st().step(true)
    expect(st()).toMatchObject({
      theme: 'light',
      search: 'wall',
      sel: full.elements[1].id,
      hidden: {}
    })
    expect(st().propOpen).toEqual({ geo: true })
  })

  it('a new change after an undo clears the redo branch', () => {
    st().hide([full.elements[0].id])
    st().step(true)
    expect(st().canRedo).toBe(true)
    st().hide([full.elements[1].id])
    expect(st()).toMatchObject({ canUndo: true, canRedo: false })
    st().step(false)
    expect(Object.keys(st().hidden).map(Number)).toEqual([full.elements[1].id])
  })

  it('stops at fifty snapshots', () => {
    for (let i = 0; i < UNDO_CAP + 10; i++) st().hide([full.elements[i].id])
    expect(historyDepth().undo).toBe(UNDO_CAP)
    for (let i = 0; i < UNDO_CAP; i++) st().step(true)
    expect(st().canUndo).toBe(false)
    // Fifty steps back from sixty leaves the first ten hides standing.
    expect(Object.keys(st().hidden)).toHaveLength(10)
  })

  it('a step with nothing to undo is a no-op', () => {
    expect(st().canUndo).toBe(false)
    st().step(true)
    expect(st()).toMatchObject({ canUndo: false, canRedo: false, hidden: {} })
  })

  it('undoing activate mode tells the viewer to re-apply pickability', () => {
    const rec = recordViewer()
    st().activate('ARC')
    expect(st().active).toBe('ARC')
    st().step(true)
    expect(st().active).toBe(null)
    // `setPickable` is imperative, so the viewer has to be told as well as the store.
    expect(rec.pickable.at(-1)).toBe(null)
    st().step(false)
    expect(st().active).toBe('ARC')
    expect(typeof rec.pickable.at(-1)).toBe('function')
  })

  it('never re-activates a model that has since been unloaded', () => {
    recordViewer()
    st().activate('STR')
    st().hide([full.elements[0].id])
    st().commitModels(federate([mockModelIndex('ARC')]))
    expect(st().active).toBe(null)
    st().step(true)
    st().step(true)
    expect(st().active).toBe(null)
  })
})

describe('the filter stack through the store', () => {
  it('adding a step selects it, snapshots undo and re-applies visibility', () => {
    recordViewer()
    st().addStep('hide')
    const s = st()
    expect(s.stack).toHaveLength(1)
    expect(s.stepSel).toBe(s.stack[0].id)
    expect(s.stack[0]).toMatchObject({ on: true, action: 'hide', color: HL[0] })
    expect(s.canUndo).toBe(true)
    st().step(true)
    expect(st().stack).toEqual([])
  })

  it('an isolate step drives visibleCount and the temporary-state frame', () => {
    recordViewer()
    useShell.setState({ stack: [wallStep()] })
    st().applyVis()
    const walls = full.elements.filter((e) => e.type === 'IfcWall').length
    expect(st().visibleCount).toBe(walls)
    expect(full.elements.filter(visFn(st())).length).toBe(walls)
  })

  it('a highlight step writes one colour map and an isolate step writes none', () => {
    const rec = recordViewer()
    useShell.setState({ stack: [wallStep({ action: 'highlight', color: HL[4] })] })
    st().applyVis()
    const map = rec.colors.at(-1) as Record<number, string>
    const walls = full.elements.filter((e) => e.type === 'IfcWall')
    expect(Object.keys(map)).toHaveLength(walls.length)
    expect(map[walls[0].id]).toBe(HL[4])
    // Highlight never hides anything.
    expect(st().visibleCount).toBe(full.elements.length)

    useShell.setState({ stack: [wallStep()] })
    st().applyVis()
    expect(rec.colors.at(-1)).toEqual({})
  })

  it('moving, disabling, dropping and clearing all go through one undo hook', () => {
    recordViewer()
    st().addStep('isolate')
    st().addStep('hide')
    const [a, b] = st().stack.map((x) => x.id)
    st().moveStep(b, -1)
    expect(st().stack.map((x) => x.id)).toEqual([b, a])
    st().updStep(b, { on: false })
    expect(st().stack.find((x) => x.id === b)!.on).toBe(false)
    st().dropStep(b)
    expect(st().stack.map((x) => x.id)).toEqual([a])
    expect(st().stepSel).toBe(a)
    st().clearStack()
    expect(st()).toMatchObject({ stack: [], stepSel: null })
    // Five mutations, five snapshots — plus the two `addStep`s.
    expect(historyDepth().undo).toBe(6)
  })

  it('a move that cannot happen does not snapshot', () => {
    recordViewer()
    st().addStep('isolate')
    const before = historyDepth().undo
    st().moveStep(st().stack[0].id, -1)
    expect(historyDepth().undo).toBe(before)
  })

  it('picking a step is not a visibility change', () => {
    st().addStep('isolate')
    st().addStep('hide')
    const before = historyDepth().undo
    st().pickStep(st().stack[0].id)
    expect(st().stepSel).toBe(st().stack[0].id)
    expect(historyDepth().undo).toBe(before)
  })

  it('setting a step colour also pushes it to the viewer', () => {
    const rec = recordViewer()
    st().addStep('highlight')
    st().setStepColor(st().stack[0].id, HL[2])
    expect(st().stack[0].color).toBe(HL[2])
    expect(rec.highlightColors.at(-1)).toBe(HL[2])
  })
})

describe('activate mode', () => {
  it('scopes the picker to one model and prunes the selection to it', () => {
    const rec = recordViewer()
    const arc = full.elements.filter((e) => e.model === 'ARC').slice(0, 2)
    const str = full.elements.filter((e) => e.model === 'STR').slice(0, 2)
    st().select([...arc, ...str].map((e) => e.id))
    st().activate('STR')
    expect(st().selIds).toEqual(str.map((e) => e.id))
    const pick = rec.pickable.at(-1) as (e: { id: number; model: string }) => boolean
    expect(pick({ id: 1, model: 'STR' })).toBe(true)
    expect(pick({ id: 2, model: 'ARC' })).toBe(false)
  })

  it('leaving activate mode clears the picker and leaves the selection alone', () => {
    const rec = recordViewer()
    const str = full.elements.filter((e) => e.model === 'STR').slice(0, 2).map((e) => e.id)
    st().activate('STR')
    st().select(str)
    st().activate('STR')
    expect(st()).toMatchObject({ active: null, selIds: str })
    expect(rec.pickable.at(-1)).toBe(null)
  })

  it('closes the context menu and the colour popover, and snapshots once', () => {
    recordViewer()
    useShell.setState({ ctx: { x: 1, y: 2, id: 3 }, palette: 'ARC' })
    st().activate('ARC')
    expect(st()).toMatchObject({ ctx: null, palette: null })
    expect(historyDepth().undo).toBe(1)
  })

  it('an activation is dropped when its model unloads', () => {
    recordViewer()
    st().activate('STR')
    st().commitModels(federate([mockModelIndex('ARC')]))
    expect(st().active).toBe(null)
  })
})

describe('saved filter sets', () => {
  it('round-trips through storage under the design’s own key', () => {
    const store = memoryStorage()
    vi.stubGlobal('localStorage', store)
    recordViewer()
    useShell.setState({ stack: [wallStep()] })
    st().saveFilterSet()

    expect(st().filterSets).toHaveLength(1)
    expect(st().filterSets[0].label).toBe('isolate IfcEntity = IfcWall')
    const stored = JSON.parse(store.getItem(FSETS_KEY)!)
    expect(stored[0].stack[0].rules[0]).toEqual({
      prop: 'IfcEntity',
      op: '=',
      val: 'IfcWall',
      join: 'and'
    })

    // Applying the stored set rebuilds a live stack from it.
    useShell.setState({ stack: [] })
    st().applyFilterSet(stored[0])
    expect(st().stack).toHaveLength(1)
    expect(st().stack[0]).toMatchObject({ on: true, action: 'isolate' })
    expect(st().stepSel).toBe(st().stack[0].id)
    expect(st().visibleCount).toBe(full.elements.filter((e) => e.type === 'IfcWall').length)
  })

  it('keeps at most twelve, and forgetting one writes the shorter list back', () => {
    const store = memoryStorage()
    vi.stubGlobal('localStorage', store)
    recordViewer()
    // A set's id is the design's `Date.now()` (`:1667`), so the clock has to move between
    // saves for them to be distinguishable — no person can save two sets inside one
    // millisecond, but a loop can.
    vi.useFakeTimers()
    for (let i = 0; i < 15; i++) {
      vi.advanceTimersByTime(1)
      useShell.setState({
        stack: [wallStep({ rules: [{ prop: 'Name', op: '=', val: `w${i}`, join: 'and' }] })]
      })
      st().saveFilterSet()
    }
    vi.useRealTimers()
    expect(st().filterSets).toHaveLength(12)
    expect(JSON.parse(store.getItem(FSETS_KEY)!)).toHaveLength(12)

    st().forgetFilterSet(st().filterSets[0].id)
    expect(st().filterSets).toHaveLength(11)
    expect(JSON.parse(store.getItem(FSETS_KEY)!)).toHaveLength(11)
  })

  it('saving a stack with no values is a no-op', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    recordViewer()
    st().addStep('isolate')
    st().saveFilterSet()
    expect(st().filterSets).toEqual([])
  })
})

describe('viewpoints', () => {
  it('saves the camera and all five VIS_KEYS, the filter stack included', () => {
    const store = memoryStorage()
    vi.stubGlobal('localStorage', store)
    recordViewer()
    const hiddenId = full.elements[0].id
    useShell.setState({
      hidden: { [hiddenId]: true },
      storeyVis: { L2: false },
      modelVis: { STR: false },
      stack: [wallStep()],
      active: 'ARC',
      grids: false,
      levels: true,
      sections: { grid: NO_PLANE, level: { name: 'L2', offset: 1200, flip: false, cut: true } },
      view: 'top'
    })
    st().saveView()

    const [v] = st().views
    expect(v).toMatchObject({ name: 'Viewpoint 1', sub: 'level L2 · 1 hidden · top', active: 'ARC' })
    expect(v.cam).toEqual(CAM)
    // 2026-10-01: both planes, and the design's single `section` beside them for a build that
    // knows no other — the level plane here, because no gridline plane is set.
    expect(v.sections).toEqual({
      grid: NO_PLANE,
      level: { name: 'L2', offset: 1200, flip: false, cut: true }
    })
    expect(v.section).toEqual({ kind: 'level', name: 'L2', offset: 1200, flip: false, cut: true })
    // Plan §3.5 defect 1: the prototype lost the filter stack here.
    expect(v.stack).toHaveLength(1)
    expect(v.stack[0].rules[0].val).toBe('IfcWall')

    const key = viewsKeyFor(full.project.building)
    expect(JSON.parse(store.getItem(key)!)[0].stack[0].rules[0].val).toBe('IfcWall')
  })

  it('says "3D" when there is nothing to describe, and numbers each viewpoint', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    recordViewer()
    st().saveView()
    st().saveView()
    expect(st().views.map((v) => v.name)).toEqual(['Viewpoint 1', 'Viewpoint 2'])
    expect(st().views[0].sub).toBe('3D')
  })

  it('restoring puts every key back, re-applies the viewer and snapshots undo', () => {
    const store = memoryStorage()
    vi.stubGlobal('localStorage', store)
    const rec = recordViewer()
    const hiddenId = full.elements[0].id
    useShell.setState({ hidden: { [hiddenId]: true }, stack: [wallStep()], grids: false })
    st().saveView()
    const saved = st().views[0]

    // Move everything away from what was saved.
    st().showAll()
    useShell.setState({ hidden: {}, stack: [], grids: true, view: 'north' })
    st().restoreView(saved)

    const s = st()
    expect(s.hidden).toEqual({ [hiddenId]: true })
    expect(s.stack).toHaveLength(1)
    expect(s).toMatchObject({ grids: false, view: null, activeView: saved.id })
    expect(rec.cameras.at(-1)).toEqual(CAM)
    expect(rec.sections.at(-1)).toEqual({ grid: null, level: null })
    // …and the restore itself is undoable.
    st().step(true)
    expect(st().hidden).toEqual({})
  })

  it('converts the card’s millimetres and its "level" to what the viewer wants', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    const rec = recordViewer()
    useShell.setState({
      sections: { grid: NO_PLANE, level: { name: 'L2', offset: 1200, flip: true, cut: true } }
    })
    st().saveView()
    st().restoreView(st().views[0])
    expect(rec.sections.at(-1)).toEqual({
      grid: null,
      level: { kind: 'storey', name: 'L2', offset: 1.2, flip: true, cut: true }
    })
  })

  it('names both planes in the sub-line, and restores both (2026-10-01)', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    const rec = recordViewer()
    const both = {
      grid: { name: 'C', offset: -500, flip: true, cut: true },
      level: { name: 'L2', offset: 1200, flip: false, cut: false }
    }
    useShell.setState({ sections: both })
    st().saveView()
    const [v] = st().views
    expect(v.sub).toBe('grid C + level L2')
    // The legacy key is the gridline plane when both are set.
    expect(v.section).toEqual({ kind: 'grid', name: 'C', offset: -500, flip: true, cut: true })

    st().clearSections()
    expect(st().sections).toEqual(NO_SECTIONS)
    st().restoreView(v)
    expect(st().sections).toEqual(both)
    expect(rec.sections.at(-1)).toEqual({
      grid: { kind: 'grid', name: 'C', offset: -0.5, flip: true, cut: true },
      level: { kind: 'storey', name: 'L2', offset: 1.2, flip: false, cut: false }
    })
  })

  it('restores a viewpoint saved before there were two planes onto the plane of its kind', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    const rec = recordViewer()
    // What a build from before 2026-10-01 wrote: one `section`, no `sections`.
    const old = (section: unknown): Viewpoint =>
      ({
        id: 7,
        name: 'Viewpoint 1',
        sub: 'grid C',
        cam: null,
        section,
        hidden: {},
        storeyVis: {},
        modelVis: {},
        stack: [],
        active: null,
        grids: true,
        levels: false
      }) as unknown as Viewpoint
    // A level cut is live; the old viewpoint's gridline section replaces the whole view's.
    useShell.setState({
      sections: { grid: NO_PLANE, level: { name: 'L3', offset: 0, flip: false, cut: true } }
    })
    st().restoreView(old({ kind: 'grid', name: 'C', offset: 1500, flip: true, cut: true }))
    expect(st().sections).toEqual({
      grid: { name: 'C', offset: 1500, flip: true, cut: true },
      level: NO_PLANE
    })
    expect(rec.sections.at(-1)).toEqual({
      grid: { kind: 'grid', name: 'C', offset: 1.5, flip: true, cut: true },
      level: null
    })

    st().restoreView(old({ kind: 'level', name: 'L2', offset: 1200, flip: false, cut: false }))
    expect(st().sections).toEqual({
      grid: NO_PLANE,
      level: { name: 'L2', offset: 1200, flip: false, cut: false }
    })
    expect(rec.sections.at(-1)).toEqual({
      grid: null,
      level: { kind: 'storey', name: 'L2', offset: 1.2, flip: false, cut: false }
    })

    // The old "none" object, a viewpoint with no section key at all, and one whose section is
    // not an object: no plane, and nothing thrown — the list is whatever localStorage held.
    for (const section of [
      { kind: null, name: '', offset: 0, flip: false, cut: false },
      undefined,
      'grid C',
      { kind: 'grid', name: 42, offset: 'far', flip: 'yes', cut: 1 }
    ]) {
      st().restoreView(old(section))
      expect(st().sections).toEqual(NO_SECTIONS)
      expect(rec.sections.at(-1)).toEqual({ grid: null, level: null })
    }
  })

  it('deleting one writes the shorter list back and releases the marker', () => {
    const store = memoryStorage()
    vi.stubGlobal('localStorage', store)
    recordViewer()
    st().saveView()
    const saved = st().views[0]
    st().restoreView(saved)
    expect(st().activeView).toBe(saved.id)
    st().dropView(saved.id)
    expect(st()).toMatchObject({ views: [], activeView: null })
    expect(JSON.parse(store.getItem(viewsKeyFor(full.project.building))!)).toEqual([])
  })

  it('a viewpoint from an older build, with keys missing, restores to sane defaults', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    recordViewer()
    const legacy = {
      id: 1,
      name: 'Viewpoint 1',
      sub: '3D',
      cam: null,
      section: { kind: null, name: '', offset: 0, flip: false, cut: false },
      grids: true,
      levels: false
    } as unknown as Viewpoint
    useShell.setState({ hidden: { 1: true }, active: 'ARC' })
    st().restoreView(legacy)
    expect(st()).toMatchObject({ hidden: {}, storeyVis: {}, modelVis: {}, active: null })
    expect(st().stack).toEqual([])
  })
})
