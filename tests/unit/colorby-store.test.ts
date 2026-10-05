/**
 * Colour by property in the store — `setColorBy` / `clearColorBy` / `applyColors`, against
 * `SGVue.dc.html:1339–1356`, `:1001–1011` and `:923`.
 *
 * What is asserted here is everything the pure `colorBy` (`colors.test.ts`) cannot be: that the
 * scheme reaches the viewer as one composed map **underneath** the highlight steps, that it is
 * **not** an undoable key, that nothing carries the property leaves a live scheme alone, and
 * that a federation change clears it — which it must, because its groups hold ids from the
 * federation that has just been replaced.
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { federate, removeModel } from '../../src/shared/federate'
import { HL, SCHEME } from '../../src/shared/colors'
import { VIS_KEYS } from '../../src/shared/undo'
import type { FilterStep } from '../../src/shared/rules'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { setViewer, useShell, type ShellState } from '../../src/renderer/state/shell'
import { resetShell, stubViewer } from './stub-viewer'

const full = federate([mockModelIndex('ARC'), mockModelIndex('STR'), mockModelIndex('SIT')])
const st = (): ShellState => useShell.getState()

/** Every element-colour map the store has pushed, in order. */
let colors: Record<number, string>[] = []
const last = (): Record<number, string> => colors[colors.length - 1]

function recordColors(): void {
  colors = []
  setViewer(stubViewer({ setElementColors: (m: Record<number, string> | null) => colors.push(m ?? {}) }))
}

beforeEach(() => {
  resetShell()
  setViewer(null)
  st().commitModels(full)
  recordColors()
})
afterEach(() => setViewer(null))

const speciesIds = (): number[] =>
  full.elements.filter((e) => e.psets.SGPset_Planting?.SpeciesCommonName).map((e) => e.id)

const highlightWalls = (over: Partial<FilterStep> = {}): FilterStep => ({
  id: 'h',
  on: true,
  action: 'highlight',
  color: HL[1],
  rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWall', join: 'and' }],
  ...over
})

describe('setColorBy', () => {
  it('stores the scheme and pushes it to the viewer as one id → hex map', () => {
    const scheme = st().setColorBy('SpeciesCommonName')
    expect(scheme).not.toBeNull()
    expect(st().colorBy).toEqual(scheme)
    expect(st().colorBy!.groups.map((g) => g.v)).toEqual(['Angsana', 'Tembusu'])
    const map = last()
    expect(Object.keys(map)).toHaveLength(16)
    for (const id of speciesIds()) expect(map[id]).toMatch(/^#(35C4B6|E8A33D)$/)
  })

  it('returns the scheme, as the design returns its groups for the assistant to report', () => {
    const scheme = st().setColorBy('Level')!
    expect(scheme.prop).toBe('Level')
    expect(scheme.groups[0].n).toBeGreaterThan(0)
    expect(scheme.groups[0].color).toBe(SCHEME[0])
  })

  it('nothing carries the property: null, and a live scheme is left exactly as it was', () => {
    const live = st().setColorBy('SpeciesCommonName')!
    const before = colors.length
    expect(st().setColorBy('NoSuchProperty')).toBeNull()
    expect(st().colorBy).toEqual(live)
    // No state change means no re-push: the viewer is not told anything happened (`:1350`).
    expect(colors).toHaveLength(before)
  })

  it('a falsy property clears, which is the assistant tool’s `property: null` (`:1552`)', () => {
    st().setColorBy('Level')
    expect(st().setColorBy(null)).toBeNull()
    expect(st().colorBy).toBeNull()
    expect(last()).toEqual({})
  })

  it('rules narrow the pool', () => {
    const scheme = st().setColorBy('Level', [
      { prop: 'Model', op: '=', val: 'ARC', join: 'and' }
    ])!
    const ids = scheme.groups.flatMap((g) => g.ids)
    for (const id of ids) expect(full.byId.get(id)!.model).toBe('ARC')
  })
})

describe('clearColorBy', () => {
  it('drops the scheme and re-pushes a map without it — the legend’s ×', () => {
    st().setColorBy('SpeciesCommonName')
    expect(Object.keys(last()).length).toBe(16)
    st().clearColorBy()
    expect(st().colorBy).toBeNull()
    expect(last()).toEqual({})
  })
})

describe('applyColors — the scheme sits underneath the highlight steps', () => {
  it('a highlight step overwrites the scheme’s colour where the two overlap', () => {
    st().setColorBy('IfcEntity')
    const scheme = st().colorBy!
    const wallGroup = scheme.groups.find((g) => g.v === 'IfcWall')!
    const slabGroup = scheme.groups.find((g) => g.v === 'IfcSlab')!
    expect(last()[wallGroup.ids[0]]).toBe(wallGroup.color)

    st().up({ stack: [highlightWalls()] })
    const map = last()
    // Walls take the step's colour; slabs keep the scheme's.
    expect(map[wallGroup.ids[0]]).toBe(HL[1])
    expect(map[slabGroup.ids[0]]).toBe(slabGroup.color)
  })

  it('the scheme is written for every id it names, visible or not (`:1004` has no vis filter)', () => {
    st().setColorBy('IfcEntity')
    const wallGroup = st().colorBy!.groups.find((g) => g.v === 'IfcWall')!
    const id = wallGroup.ids[0]
    st().hide([id])
    expect(last()[id]).toBe(wallGroup.color)
  })

  it('a highlight step, by contrast, only colours what is visible (`:1009`)', () => {
    const wall = full.elements.find((e) => e.type === 'IfcWall')!
    st().up({ stack: [highlightWalls()] })
    expect(last()[wall.id]).toBe(HL[1])
    st().hide([wall.id])
    expect(last()[wall.id]).toBeUndefined()
  })

  it('the stack changing re-composes the map with the scheme still underneath', () => {
    st().setColorBy('IfcEntity')
    const slab = st().colorBy!.groups.find((g) => g.v === 'IfcSlab')!
    st().up({ stack: [highlightWalls()] })
    st().up({ stack: [] })
    expect(last()[slab.ids[0]]).toBe(slab.color)
  })
})

describe('colorBy is not a visibility key', () => {
  it('is absent from VIS_KEYS, so ⌘Z does not walk a colour scheme back (`:1013`)', () => {
    expect([...VIS_KEYS]).toEqual(['hidden', 'storeyVis', 'modelVis', 'stack', 'active'])
    expect(VIS_KEYS as readonly string[]).not.toContain('colorBy')
  })

  it('setting a scheme pushes no undo entry, and undo leaves it alone', () => {
    st().hide([full.elements[0].id])
    st().setColorBy('IfcEntity')
    expect(st().canUndo).toBe(true)
    st().step(true)
    // The hide is undone; the scheme is untouched.
    expect(st().hidden).toEqual({})
    expect(st().colorBy!.prop).toBe('IfcEntity')
  })
})

describe('a federation change clears it (`:923`)', () => {
  it('unloading a model drops the scheme, because its ids named the old federation', () => {
    st().setColorBy('SpeciesCommonName')
    expect(st().colorBy).not.toBeNull()
    st().commitModels(removeModel(full, 'SIT').federation)
    expect(st().colorBy).toBeNull()
    expect(last()).toEqual({})
  })

  it('adding a model clears it too — the design clears on any setModels', () => {
    st().commitModels(removeModel(full, 'SIT').federation)
    st().setColorBy('IfcEntity')
    expect(st().colorBy).not.toBeNull()
    st().commitModels(full)
    expect(st().colorBy).toBeNull()
  })
})
