/**
 * The view store's actions — the logic-class methods at `SGVue.dc.html:1041–1213` and
 * `:1792–1813`, driven without a viewer or a DOM.
 *
 * Every one of these was an easy thing to get subtly wrong: a solo click that does not release
 * on the second press, a palette pick that leaves native materials on, a model removal that
 * strays into remapping ids instead of pruning them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { federate, removeModel } from '../../src/shared/federate'
import { visFn } from '../../src/shared/rules'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { COPIED_MS, lastDrawCalls, useShell, VIS_KEYS } from '../../src/renderer/state/shell'
import { resetShell } from './stub-viewer'

const reset = resetShell

// A test that fails part-way must not leave fake timers or a stubbed global to the next one.
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const ARC = mockModelIndex('ARC')
const STR = mockModelIndex('STR')
const full = federate([ARC, STR])

beforeEach(reset)

describe('storey visibility', () => {
  it('solo isolates one storey and a second click releases every storey', () => {
    const names = ['L1', 'L2', 'L3']
    const st = useShell.getState()
    st.soloStorey('L2', false, names)
    expect(useShell.getState().storeyVis).toEqual({ L1: false, L2: true, L3: false })
    // The row now reports itself as solo, and the design passes that back in.
    useShell.getState().soloStorey('L2', true, names)
    expect(useShell.getState().storeyVis).toEqual({})
  })

  it('the eye toggles one storey without touching the others', () => {
    useShell.getState().toggleStorey('L2')
    expect(useShell.getState().storeyVis).toEqual({ L2: false })
    useShell.getState().toggleStorey('L2')
    expect(useShell.getState().storeyVis).toEqual({ L2: true })
    useShell.getState().allStoreys()
    expect(useShell.getState().storeyVis).toEqual({})
  })

  it('a hidden storey hides its elements through the one visibility predicate', () => {
    useShell.setState({ federation: full, byId: full.byId })
    useShell.getState().toggleStorey('L2')
    const vis = visFn(useShell.getState())
    const onL2 = full.elements.filter((e) => e.storey === 'L2')
    expect(onL2.length).toBeGreaterThan(0)
    expect(onL2.every((e) => !vis(e))).toBe(true)
    expect(full.elements.filter((e) => e.storey !== 'L2').every(vis)).toBe(true)
  })
})

describe('model colour palette', () => {
  it('picking a colour drops out of native-material mode and closes the popover', () => {
    useShell.setState({ palette: 'ARC' })
    useShell.getState().setModelColor('ARC', '#E05A6B')
    expect(useShell.getState()).toMatchObject({
      modelColors: { ARC: '#E05A6B' },
      nativeMats: false,
      palette: null
    })
  })

  it('reset removes the override and leaves native materials as they were', () => {
    useShell.getState().setModelColor('ARC', '#E05A6B')
    useShell.getState().setModelColor('ARC', null)
    expect(useShell.getState().modelColors).toEqual({})
    expect(useShell.getState().nativeMats).toBe(false)
  })

  it('the swatch button and the unload × close each other', () => {
    useShell.getState().togglePalette('ARC')
    expect(useShell.getState().palette).toBe('ARC')
    useShell.getState().askRemove('ARC')
    expect(useShell.getState()).toMatchObject({ palette: null, confirmRemove: 'ARC' })
    useShell.getState().togglePalette('STR')
    expect(useShell.getState()).toMatchObject({ palette: 'STR', confirmRemove: null })
    useShell.getState().togglePalette('STR')
    expect(useShell.getState().palette).toBe(null)
  })

  it('toggling Original materials does not disturb the overrides', () => {
    useShell.setState({ modelColors: { ARC: '#35C4B6' }, nativeMats: true })
    useShell.getState().toggleNative()
    expect(useShell.getState()).toMatchObject({
      nativeMats: false,
      modelColors: { ARC: '#35C4B6' }
    })
  })
})

describe('commitModels — the design’s setModels pruning', () => {
  it('keeps every surviving id and prunes only what went with the model', () => {
    useShell.getState().commitModels(full)
    const arc = full.elements.find((e) => e.model === 'ARC')!
    const str = full.elements.find((e) => e.model === 'STR')!
    useShell.setState({
      hidden: { [arc.id]: true, [str.id]: true },
      modelColors: { ARC: '#35C4B6', STR: '#E8A33D' },
      active: 'STR',
      sel: str.id,
      selIds: [str.id],
      palette: 'ARC',
      confirmRemove: 'ARC'
    })

    const { federation: left, droppedIds } = removeModel(full, 'STR')
    expect(droppedIds).toContain(str.id)
    useShell.getState().commitModels(left)

    const s = useShell.getState()
    expect(s.hidden).toEqual({ [arc.id]: true })
    expect(s.modelColors).toEqual({ ARC: '#35C4B6' })
    // `active` named a model that is gone, so it drops; the selection and popovers close.
    expect(s).toMatchObject({
      active: null,
      sel: null,
      selIds: [],
      palette: null,
      confirmRemove: null,
      ctx: null,
      ready: true,
      booted: true
    })
    expect(s.loaded).toEqual(['ARC'])
    // Every surviving element kept the id it had — the slot never moves.
    expect(left.elements.every((e) => full.byId.get(e.id)?.localId === e.localId)).toBe(true)
  })

  it('keeps an active model that is still loaded', () => {
    useShell.getState().commitModels(full)
    useShell.setState({ active: 'ARC' })
    useShell.getState().commitModels(removeModel(full, 'STR').federation)
    expect(useShell.getState().active).toBe('ARC')
  })

  it('reports an empty federation as unbooted', () => {
    useShell.getState().commitModels(full)
    useShell.getState().commitModels(removeModel(removeModel(full, 'STR').federation, 'ARC').federation)
    expect(useShell.getState()).toMatchObject({ booted: false, ready: false, loaded: [] })
  })
})

describe('hide, show, isolate and activate', () => {
  beforeEach(() => useShell.getState().commitModels(full))

  it('hide and show move ids in and out of one map', () => {
    const ids = full.elements.slice(0, 3).map((e) => e.id)
    useShell.getState().hide(ids)
    expect(Object.keys(useShell.getState().hidden).map(Number)).toEqual(ids)
    useShell.getState().show(ids.slice(0, 2))
    expect(Object.keys(useShell.getState().hidden).map(Number)).toEqual([ids[2]])
  })

  it('isolate hides everything else and clears the storey filter', () => {
    useShell.setState({ storeyVis: { L1: false } })
    const keep = full.elements.slice(0, 2).map((e) => e.id)
    useShell.getState().isolate(keep)
    const s = useShell.getState()
    expect(s.storeyVis).toEqual({})
    expect(Object.keys(s.hidden)).toHaveLength(full.elements.length - 2)
    const vis = visFn(s)
    expect(full.elements.filter(vis).map((e) => e.id)).toEqual(keep)
  })

  it('showAll clears every visibility source and switches the stack off', () => {
    useShell.setState({
      hidden: { 1: true },
      storeyVis: { L1: false },
      modelVis: { STR: false },
      stack: [{ id: 'f1', on: true, action: 'isolate', rules: [] }]
    })
    useShell.getState().showAll()
    const s = useShell.getState()
    expect(s).toMatchObject({ hidden: {}, storeyVis: {}, modelVis: {} })
    expect(s.stack[0].on).toBe(false)
  })

  it('activate is a toggle and trims the selection to the activated model', () => {
    const strIds = full.elements.filter((e) => e.model === 'STR').slice(0, 2).map((e) => e.id)
    const arcIds = full.elements.filter((e) => e.model === 'ARC').slice(0, 2).map((e) => e.id)
    useShell.getState().select([...arcIds, ...strIds])
    useShell.getState().activate('ARC')
    expect(useShell.getState().active).toBe('ARC')
    expect(useShell.getState().selIds).toEqual(arcIds)
    useShell.getState().activate('ARC')
    expect(useShell.getState().active).toBe(null)
  })
})

describe('selection', () => {
  beforeEach(() => useShell.getState().commitModels(full))

  it('replace, toggle-add and toggle-remove, with sel following the last id', () => {
    const [a, b] = full.elements.slice(0, 2).map((e) => e.id)
    useShell.getState().select(a)
    expect(useShell.getState()).toMatchObject({ sel: a, selIds: [a] })
    useShell.getState().select(b, false, 'toggle')
    expect(useShell.getState()).toMatchObject({ sel: b, selIds: [a, b] })
    useShell.getState().select(b, false, 'toggle')
    expect(useShell.getState()).toMatchObject({ sel: a, selIds: [a] })
    useShell.getState().select(null)
    expect(useShell.getState()).toMatchObject({ sel: null, selIds: [] })
  })

  it('a toggle of a list is a replace — only a single id toggles', () => {
    const [a, b, c] = full.elements.slice(0, 3).map((e) => e.id)
    useShell.getState().select([a, b])
    useShell.getState().select([b, c], false, 'toggle')
    expect(useShell.getState().selIds).toEqual([b, c])
  })

  it('closes the context menu and resets the copy flash', () => {
    useShell.setState({ ctx: { x: 10, y: 10, id: 1 }, copied: true })
    useShell.getState().select(full.elements[0].id)
    expect(useShell.getState()).toMatchObject({ ctx: null, copied: false })
  })

  it('is cleared when a model is added as well as when one is removed', () => {
    const arcOnly = federate([ARC])
    useShell.getState().commitModels(arcOnly)
    useShell.getState().select(arcOnly.elements.slice(0, 3).map((e) => e.id))
    expect(useShell.getState().selIds).toHaveLength(3)
    // The design's `setModels` runs on both directions of a federation change (`:924`).
    useShell.getState().commitModels(full)
    expect(useShell.getState()).toMatchObject({ sel: null, selIds: [] })
  })
})

describe('the property card and the context menu — Phase 4 state', () => {
  beforeEach(() => useShell.getState().commitModels(full))

  it('remembers which sections are open, one key at a time', () => {
    useShell.getState().toggleProp('geo')
    expect(useShell.getState().propOpen).toEqual({ geo: true })
    useShell.getState().toggleProp('ids')
    expect(useShell.getState().propOpen).toEqual({ geo: true, ids: true })
    useShell.getState().toggleProp('geo')
    expect(useShell.getState().propOpen).toEqual({ geo: false, ids: true })
  })

  it('copies a GlobalId and flashes "Copied" for 1 400 ms', async () => {
    vi.useFakeTimers()
    const written: string[] = []
    vi.stubGlobal('navigator', {
      clipboard: { writeText: (v: string) => (written.push(v), Promise.resolve()) }
    })
    useShell.getState().copyGuid('3Kd8sT0WD0qxL1Hrz0Vabc')
    // The flash fires from the clipboard promise's own microtask — never from a timer, so
    // draining the microtask queue is enough and the fake clock stays where it is.
    await Promise.resolve()
    await Promise.resolve()
    expect(written).toEqual(['3Kd8sT0WD0qxL1Hrz0Vabc'])
    expect(useShell.getState().copied).toBe(true)
    vi.advanceTimersByTime(COPIED_MS - 1)
    expect(useShell.getState().copied).toBe(true)
    vi.advanceTimersByTime(1)
    expect(useShell.getState().copied).toBe(false)
  })

  it('"Ask about this" opens the assistant with the designed pre-fill', () => {
    // `askAbout` also starts the design's own 60 ms focus timer (`:1650`), whose callback
    // reaches `document` — which this environment does not have. Left on real timers it fires
    // while the file is still running and takes the whole run down with an unhandled
    // `ReferenceError`; on fake ones it is never reached, and that it was *scheduled* is the
    // part worth asserting without a DOM.
    vi.useFakeTimers()
    const wall = full.elements.find((e) => e.type === 'IfcWall')!
    useShell.setState({ ctx: { x: 10, y: 10, id: wall.id } })
    useShell.getState().askAbout([wall.id])
    expect(useShell.getState()).toMatchObject({
      chatOpen: true,
      ctx: null,
      chatInput: `About ${wall.name} (IfcWall, ${wall.objectType || '—'}, ${wall.storey}): `
    })
    expect(vi.getTimerCount()).toBe(1)
  })

  it('"Ask about this" does nothing when every id is stale', () => {
    useShell.getState().askAbout([999_999_999])
    expect(useShell.getState()).toMatchObject({ chatOpen: false, chatInput: '' })
  })
})

describe('undo routing', () => {
  it('every VIS_KEYS mutation goes through the one snapshot hook', () => {
    useShell.getState().commitModels(full)
    let pushes = 0
    useShell.setState({ pushUndo: () => void pushes++ })
    useShell.getState().hide([full.elements[0].id])
    useShell.getState().toggleStorey('L1')
    useShell.getState().toggleModel('STR')
    useShell.getState().activate('ARC')
    useShell.getState().showAll()
    expect(pushes).toBe(5)
    // …and a change that is not visibility-shaped does not.
    useShell.getState().setSearch('wall')
    useShell.getState().setTreeMode('type')
    expect(pushes).toBe(5)
  })

  it('names exactly the design’s five keys', () => {
    expect([...VIS_KEYS]).toEqual(['hidden', 'storeyVis', 'modelVis', 'stack', 'active'])
  })
})

describe('setStats — the frame loop’s once-a-second report (refactor pass 2, P2)', () => {
  it('is state only when the frame rate or the backend moved; the draw count is kept aside', () => {
    const st = useShell.getState()
    st.setStats({ fps: 60, backend: 'WebGL2', calls: 40 })
    const first = useShell.getState().stats
    expect(first).toMatchObject({ fps: 60, backend: 'WebGL2' })
    const seen = vi.fn()
    const off = useShell.subscribe(seen)
    useShell.getState().setStats({ fps: 60, backend: 'WebGL2', calls: 90 })
    expect(seen).not.toHaveBeenCalled()
    expect(useShell.getState().stats).toBe(first)
    expect(lastDrawCalls()).toBe(90)
    useShell.getState().setStats({ fps: 59, backend: 'WebGL2', calls: 90 })
    expect(seen).toHaveBeenCalledTimes(1)
    expect(useShell.getState().stats.fps).toBe(59)
    off()
  })
})
