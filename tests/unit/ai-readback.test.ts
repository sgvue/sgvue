/**
 * Reading back what the assistant can set — 2026-10-02 (parity with the user, phase 1).
 *
 * Before this the assistant could turn shadows off, preview a section plane or have a model
 * hidden, and neither the view state it is sent each turn nor `get_view_state` said so. The
 * rule that closes it is **sparse per turn, full on demand**:
 *
 *   · the per-turn view state (`chatViewState`) gains a field **only while something is not at
 *     its default** — so a view at its defaults is byte for byte what it was before;
 *   · `get_view_state` reports every one of those things in full, whatever its state.
 *
 * And one structural check, so the next piece of review state cannot be forgotten: every key
 * the **session** saves (`SessionSource`, the app's own list of what a review is) is either
 * reported by `get_view_state` or named in an exclusion list here, with its reason.
 *
 * Phase 2, the same day: the camera's direction (per turn only while it is off the view `view`
 * names; in full on demand), the saved viewpoints and each highlight step's colour (on demand
 * only) — which takes `hlColor` off the exclusion list — and a bound on the per-turn list of
 * hidden models.
 *
 * Phase 3, the consent gate: the base point (`basePoint`: E, N, Z, angle and whose they are) is
 * reported, because the assistant may now ask to change it — which takes `coords`, the last
 * exclusion, off the list. Every key the session saves is read back.
 *
 * 2026-10-08: the Coordinate-system card is read-only — the base point is the boot file's, and
 * nothing in the app changes it — so `source` is `file` or `none`. It is still reported, and still
 * written into a session for older builds, so it stays on the list; and `notLinedUp` says which
 * loaded models could not be lined up, as the card's note does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { federate } from '../../src/shared/federate'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { setViewer, useShell, type ShellState } from '../../src/renderer/state/shell'
import { executeTool, newTurnState, type ToolContext } from '../../src/renderer/ai/executors'
import {
  VIEW_MODELS_CAP,
  VIEW_MODEL_NAME_CHARS
} from '../../src/renderer/ai/executors/read'
import {
  cameraBrief,
  chatViewState,
  DEFAULT_TOOL,
  DISPLAY_DEFAULTS,
  displayState,
  MODELS_HIDDEN_CAP,
  planeDefaults,
  sectionPlanes,
  sparseViewState,
  viewStateCore,
  type ChatViewState
} from '../../src/shared/ai-schema'
import { visFn } from '../../src/shared/rules'
import { LEVEL_DEFAULT_OFFSET_MM, NO_PLANE } from '../../src/shared/sections'
import { coordsFromGeoref } from '../../src/shared/georef'
import type { Georeference } from '../../src/shared/model-index.types'
import { sessionPayload, type SessionSource } from '../../src/shared/session-codec'
import {
  INTERFACE_SEARCH_MAX,
  VIEWPOINTS_CAP,
  VIEW_DIRECTIONS,
  VIEW_NAME_MAX
} from '../../src/shared/tool-schemas'
import { VIEWS } from '../../src/shared/view-angles'
import { planePatch } from '../../src/renderer/state/selectors/section'
import { modelRows } from '../../src/renderer/state/selectors/models'
import { basePointSource } from '../../src/renderer/state/selectors/status'
import { sessionSource } from '../../src/renderer/state/selectors/snapshot'
import { SAMPLE_FILES } from '../../src/renderer/dev/mock-adapter'
import { viewStateText } from '../../src/main/ai/prompt'
import { rigViewer } from './rig-viewer'
import { memoryStorage, resetShell } from './stub-viewer'

const KEYS = ['ARC', 'STR', 'SIT', 'MEP'] as const
const full = federate(KEYS.map((k) => mockModelIndex(k)))

/** A file that states a base point — the repository's synthetic set, never a real site's. */
const STATES_ONE: Georeference = {
  source: 'IfcMapConversion',
  sources: ['IfcMapConversion'],
  method: 'IfcMapConversion',
  eastings: 12345.457,
  northings: 23456.766,
  orthogonalHeight: 5.05
}

const turn = newTurnState()
const ctx = (): ToolContext => ({
  state: () => useShell.getState(),
  sql: (async () => ({ columns: [], rows: [], truncated: false, ms: 0 })) as never,
  rawLine: async () => null,
  turn
})
type Body = Record<string, unknown>
const run = async (name: string, input: unknown = {}): Promise<Body> =>
  (await executeTool(name, input, ctx())) as Body

const st = (): ShellState => useShell.getState()
const perTurn = (): ChatViewState => chatViewState(st(), st().federation, visFn(st()), null)
/** The name each model's row shows in the sidebar, in the federation's order. */
const sidebarNames = (): string[] =>
  modelRows({
    federation: st().federation,
    files: [],
    library: st().library,
    modelVis: st().modelVis,
    modelColors: st().modelColors,
    nativeMats: st().nativeMats,
    uploadNames: st().uploadNames,
    active: st().active,
    palette: st().palette,
    confirmRemove: st().confirmRemove
  }).map((m) => m.name)
const json = (v: unknown): string => JSON.stringify(v)

/** What a turn has always been told: the design's ten fields in its order, then `schedule`. */
const CORE_KEYS = [
  'filterStack',
  'visibleElements',
  'totalElements',
  'hiddenManually',
  'storeysShown',
  'activeModel',
  'view',
  'projection',
  'section',
  'selectedCount',
  'schedule'
]

beforeEach(() => {
  resetShell()
  st().commitModels(full)
  Object.assign(turn, newTurnState())
})
afterEach(() => resetShell())

/* ────────────────────────────── the defaults ────────────────────────────── */

describe('the defaults the sparse rule is measured against', () => {
  it('are the store’s own first values, switch for switch', () => {
    resetShell()
    expect(displayState(st())).toEqual(DISPLAY_DEFAULTS)
    expect(DISPLAY_DEFAULTS).toEqual({
      grids: true,
      levels: false,
      shadows: true,
      dims: false,
      groundGrid: true,
      snap: true,
      originalMaterials: true
    })
    expect(st().tool).toBe(DEFAULT_TOOL)
    expect(st().modelVis).toEqual({})
  })

  it('are the Section card’s own for a plane: what a chip writes, not flipped', () => {
    for (const kind of ['grid', 'level'] as const) {
      const chip = planePatch('X', kind)
      expect(planeDefaults(kind)).toEqual({ offsetMm: chip.offset, flip: NO_PLANE.flip, cut: chip.cut })
    }
    expect(planeDefaults('grid').offsetMm).toBe(0)
    expect(planeDefaults('level').offsetMm).toBe(LEVEL_DEFAULT_OFFSET_MM)
  })
})

/* ────────────────────────────── sparse, per turn ────────────────────────────── */

describe('the per-turn view state is sparse', () => {
  it('adds nothing at all while everything is at its default — not a key, not a byte', () => {
    const state = perTurn()
    expect(Object.keys(state)).toEqual(CORE_KEYS)
    expect(sparseViewState(st(), st().federation)).toEqual({})
    // Byte for byte the eleven fields a turn was sent before.
    expect(json(state)).toBe(json(viewStateCore(st(), st().federation, visFn(st()), null)))
    expect(viewStateText(state)).toBe(
      'Current view state: {"filterStack":[],"visibleElements":412,"totalElements":412,"hiddenManually":0,"storeysShown":["Foundation","L1","L2","L3","L4","Roof"],"activeModel":null,"view":"iso","projection":"persp","section":null,"selectedCount":0,"schedule":null}'
    )
  })

  it('stays that small through ordinary work: a filter, a selection, both cuts at their defaults', () => {
    st().addStep('isolate', [{ prop: 'Level', op: '=', val: 'L2' }])
    st().select(full.elements.slice(0, 3).map((e) => e.id))
    st().setSec('grid', planePatch('C', 'grid'))
    st().setSec('level', planePatch('L2', 'level'))
    const state = perTurn()
    expect(Object.keys(state)).toEqual(CORE_KEYS)
    expect(state.section).toBe('grid C + level L2')
  })

  it('names a display switch only while it is off its default, and drops it again when it is back', () => {
    const flip: Record<string, () => void> = {
      grids: () => st().toggleGrids(),
      levels: () => st().toggleLevels(),
      shadows: () => st().setShadows(!st().shadows),
      dims: () => st().toggleDims(),
      groundGrid: () => st().setGroundGrid(!st().groundGrid),
      snap: () => st().toggleSnap(),
      originalMaterials: () => st().toggleNative()
    }
    expect(Object.keys(flip)).toEqual(Object.keys(DISPLAY_DEFAULTS))
    for (const [key, toggle] of Object.entries(flip)) {
      toggle()
      const off = perTurn()
      // Exactly one more field, holding exactly the one switch.
      expect([key, Object.keys(off)]).toEqual([key, [...CORE_KEYS, 'display']])
      expect([key, off.display]).toEqual([key, { [key]: !DISPLAY_DEFAULTS[key as keyof typeof DISPLAY_DEFAULTS] }])
      toggle()
      expect([key, Object.keys(perTurn())]).toEqual([key, CORE_KEYS])
    }
    // Several at once are one object, in the switches' own order.
    st().toggleLevels()
    st().setShadows(false)
    st().toggleSnap()
    expect(perTurn().display).toEqual({ levels: true, shadows: false, snap: false })
    expect(json(perTurn().display)).toBe('{"levels":true,"shadows":false,"snap":false}')
  })

  it('names the armed tool only while it is not select', () => {
    st().setTool('measure')
    expect(Object.keys(perTurn())).toEqual([...CORE_KEYS, 'tool'])
    expect(perTurn().tool).toBe('measure')
    st().setTool('spot')
    expect(perTurn().tool).toBe('spot')
    st().setTool('select')
    expect(Object.keys(perTurn())).toEqual(CORE_KEYS)
  })

  it('names hidden models by key only, and only loaded ones', () => {
    st().toggleModel('MEP')
    st().toggleModel('STR')
    const state = perTurn()
    expect(Object.keys(state)).toEqual([...CORE_KEYS, 'modelsHidden'])
    // In the federation's own order, whatever order they were hidden in.
    expect(state.modelsHidden).toEqual(['STR', 'MEP'])
    // A key the eye map still carries for a model that is no longer loaded is not named.
    useShell.setState({ modelVis: { ...st().modelVis, GONE: false } })
    expect(perTurn().modelsHidden).toEqual(['STR', 'MEP'])
    st().toggleModel('MEP')
    st().toggleModel('STR')
    expect(Object.keys(perTurn())).toEqual(CORE_KEYS)
    // Keys, not names: a model's name is its file's, and that is `get_view_state`'s to report.
    st().toggleModel('ARC')
    expect(perTurn().modelsHidden).toEqual(['ARC'])
    for (const name of sidebarNames()) expect(json(perTurn())).not.toContain(name)
  })

  it('names a section’s offset, side and preview only where they are not the card’s default', () => {
    st().setSec('grid', planePatch('C', 'grid'))
    st().setSec('level', planePatch('L2', 'level'))
    expect(perTurn().sectionPlanes).toBeUndefined()

    st().setSec('grid', { offset: 500 })
    expect(Object.keys(perTurn())).toEqual([...CORE_KEYS, 'sectionPlanes'])
    expect(perTurn().sectionPlanes).toEqual({ grid: { offsetMm: 500 } })
    st().setSec('grid', { flip: true, cut: false })
    expect(perTurn().sectionPlanes).toEqual({ grid: { offsetMm: 500, flip: true, cut: false } })
    // The level plane at 1 200 mm is at its default; at 0 it is not.
    st().setSec('level', { offset: 0 })
    expect(perTurn().sectionPlanes).toEqual({
      grid: { offsetMm: 500, flip: true, cut: false },
      level: { offsetMm: 0 }
    })
    // A grid bubble's click previews its plane: that is the one thing said about it.
    st().clearSections()
    st().gridClick('D')
    expect(perTurn().section).toBe('grid D')
    expect(perTurn().sectionPlanes).toEqual({ grid: { cut: false } })
    // No plane, nothing to say — whatever the cleared plane's fields happen to hold.
    st().clearSections()
    expect(Object.keys(perTurn())).toEqual(CORE_KEYS)
  })

  it('costs a few dozen bytes when everything is off its default at once', () => {
    const before = viewStateText(perTurn()).length
    st().toggleGrids()
    st().toggleLevels()
    st().setShadows(false)
    st().toggleDims()
    st().toggleSnap()
    st().setGroundGrid(false)
    st().toggleNative()
    st().setTool('measure')
    st().toggleModel('STR')
    st().setSec('grid', { name: 'C', offset: 500, flip: true, cut: false })
    const state = perTurn()
    expect(Object.keys(state)).toEqual([...CORE_KEYS, 'display', 'tool', 'modelsHidden', 'sectionPlanes'])
    expect(state.display).toEqual({
      grids: false,
      levels: true,
      shadows: false,
      dims: true,
      groundGrid: false,
      snap: false,
      originalMaterials: false
    })
    // The whole sparse half, at its largest for one plane, is under 250 characters.
    const extra = json(sparseViewState(st(), st().federation)).length
    expect(extra).toBeLessThan(250)
    expect(viewStateText(state).length - before).toBeLessThan(250 + 'grid C'.length)
  })
})

/* ────────────────────────────── full, on demand ────────────────────────────── */

describe('get_view_state reads everything back, in full', () => {
  it('reports every switch, both planes, the history, each model and the interface at their defaults', async () => {
    const body = await run('get_view_state')
    expect(body.display).toEqual(DISPLAY_DEFAULTS)
    expect(body.sectionPlanes).toEqual({ grid: null, level: null })
    expect(body.history).toEqual({ canUndo: false, canRedo: false })
    // With no library, a model's name is its file's — exactly what its sidebar row reads.
    expect(body.models).toEqual([
      { key: 'ARC', name: 'SB_ARC_R25', visible: true, color: null, active: false },
      { key: 'STR', name: 'SB_STR_R25', visible: true, color: null, active: false },
      { key: 'SIT', name: 'SB_SIT_R25', visible: true, color: null, active: false },
      { key: 'MEP', name: 'SB_MEP_R25', visible: true, color: null, active: false }
    ])
    expect((body.models as { name: string }[]).map((m) => m.name)).toEqual(sidebarNames())
    expect(body.interface).toEqual({
      theme: 'dark',
      units: 'mm',
      treeMode: 'entity',
      sidebar: 'open',
      card: 'none',
      tool: 'select',
      search: '',
      schedulesWindow: 'closed'
    })
    // What it reported before is all still there, as it was.
    expect(body).toMatchObject({
      visibleElements: 412,
      totalElements: 412,
      section: null,
      selectedCount: 0,
      selectedIds: [],
      loadedModels: ['ARC', 'STR', 'SIT', 'MEP'],
      modelsHidden: [],
      colorBy: null,
      units: 'mm',
      theme: 'dark'
    })
    // None of the sparse per-turn fields is here a second time under another shape.
    expect(body.tool).toBeUndefined()
  })

  it('names a model as its sidebar row does — the library’s label when there is one', async () => {
    st().setLibrary(SAMPLE_FILES.map((f) => ({ key: f.key, name: f.name, file: f.file, swatch: f.swatch })))
    const names = ((await run('get_view_state')).models as { name: string }[]).map((m) => m.name)
    expect(names).toEqual(sidebarNames())
    expect(names).toEqual(['Architecture', 'Structure', 'Site & Landscape', 'Mechanical'])
  })

  it('reads back what each tool set', async () => {
    await run('toggle_display', { levels: true, shadows: false, groundGrid: false, snap: false, originalMaterials: false })
    await run('set_section', { kind: 'grid', name: 'C', offset: 500, flip: true, cut: false })
    await run('set_section', { kind: 'level', name: 'L2' })
    await run('set_models', { visible: ['ARC', 'STR', 'SIT'] })
    await run('color_models', { map: { ARC: '#E05A6B' } })
    await run('activate_model', { key: 'STR' })
    await run('set_interface', { theme: 'light', units: 'm', treeMode: 'type', card: 'section', tool: 'spot', search: 'wall' })
    await run('select_elements', { rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcStair' }], zoom: false })

    const body = await run('get_view_state')
    expect(body.display).toEqual({
      grids: true,
      levels: true,
      shadows: false,
      dims: false,
      groundGrid: false,
      snap: false,
      originalMaterials: false
    })
    // The one string the evaluation suite grades is unchanged; the detail is beside it.
    expect(body.section).toBe('grid C + level L2')
    expect(body.sectionPlanes).toEqual({
      grid: { name: 'C', offsetMm: 500, flip: true, cut: false },
      level: { name: 'L2', offsetMm: LEVEL_DEFAULT_OFFSET_MM, flip: false, cut: true }
    })
    expect(body.sectionPlanes).toEqual(sectionPlanes(st().sections))
    expect(body.history).toEqual({ canUndo: true, canRedo: false })
    expect(body.models).toEqual([
      { key: 'ARC', name: 'SB_ARC_R25', visible: true, color: '#E05A6B', active: false },
      { key: 'STR', name: 'SB_STR_R25', visible: true, color: null, active: true },
      { key: 'SIT', name: 'SB_SIT_R25', visible: true, color: null, active: false },
      { key: 'MEP', name: 'SB_MEP_R25', visible: false, color: null, active: false }
    ])
    expect(body.modelsHidden).toEqual(['MEP'])
    expect(body.activeModel).toBe('STR')
    expect(body.interface).toEqual({
      theme: 'light',
      units: 'm',
      treeMode: 'type',
      sidebar: 'open',
      card: 'section',
      tool: 'spot',
      search: 'wall',
      schedulesWindow: 'closed'
    })
    expect(body.selectedCount).toBe(3)

    // And an undo is read back the same way.
    await run('apply_visibility', { action: 'undo' })
    expect((await run('get_view_state')).history).toEqual({ canUndo: true, canRedo: true })
  })

  it('is a read: asking changes nothing', async () => {
    const before = st()
    await run('get_view_state')
    expect(st()).toBe(before)
    expect(turn.acted).toBe(false)
  })

  it('is bounded: a clipped search, a clipped model name, and at most fifty models', async () => {
    st().setSearch('x'.repeat(INTERFACE_SEARCH_MAX + 300))
    const long = 'N'.repeat(VIEW_MODEL_NAME_CHARS + 80)
    useShell.setState({ uploadNames: { ARC: `${long}.ifc` } })
    const body = await run('get_view_state')
    expect((body.interface as { search: string }).search).toHaveLength(INTERFACE_SEARCH_MAX)
    const arc = (body.models as { key: string; name: string }[])[0]
    expect(arc.name).toBe('N'.repeat(VIEW_MODEL_NAME_CHARS) + '…')
    expect(body.modelsTruncated).toBeUndefined()

    // Sixty models: fifty listed, and the result says it cut.
    const many = Array.from({ length: VIEW_MODELS_CAP + 10 }, (_, i) => ({
      ...full.models[0],
      slot: i,
      meta: { ...full.models[0].meta, modelKey: `K${i}`, fileName: `K${i}.ifc` }
    }))
    useShell.setState({ federation: { ...full, models: many }, loaded: many.map((m) => m.meta.modelKey) })
    const cut = await run('get_view_state')
    expect(cut.models).toHaveLength(VIEW_MODELS_CAP)
    expect(cut).toMatchObject({ modelsTotal: VIEW_MODELS_CAP + 10, modelsTruncated: true })
  })
})

/* ────────────────────────────── the structural check ────────────────────────────── */

/**
 * `SessionSource` is what a session and a share link save: the app's own answer to "what is the
 * state of a review?". If the assistant is to see what the user sees, `get_view_state` has to
 * report all of it — or leave a key out on purpose, by name.
 *
 * Each key below is either `change`, something that moves that key and that key alone, after
 * which `get_view_state` must read differently; or `excluded`, with the reason. A key added to
 * the session without a decision here fails the first test.
 */
describe('get_view_state covers the session’s own list of review state', () => {
  /** `setup`, when a key can only move from a state that is not the first one, comes first. */
  type Coverage = { change: () => void; setup?: () => void } | { excluded: string }

  const COVERAGE: Record<keyof SessionSource, Coverage> = {
    uploadNames: { change: () => useShell.setState({ uploadNames: { ARC: 'Renamed tower.ifc' } }) },
    hidden: { change: () => st().hide([full.elements[0].id]) },
    storeyVis: { change: () => st().toggleStorey('L3') },
    modelVis: { change: () => st().toggleModel('MEP') },
    active: { change: () => st().activate('STR') },
    modelColors: { change: () => useShell.setState({ modelColors: { ARC: '#E05A6B' } }) },
    nativeMats: { change: () => st().toggleNative() },
    treeMode: { change: () => st().setTreeMode('type') },
    grids: { change: () => st().toggleGrids() },
    levels: { change: () => st().toggleLevels() },
    shadows: { change: () => st().setShadows(false) },
    theme: { change: () => st().setTheme('light') },
    snap: { change: () => st().toggleSnap() },
    dims: { change: () => st().toggleDims() },
    sections: { change: () => st().setSec('grid', { name: 'C', offset: 250, flip: true, cut: true }) },
    stack: { change: () => st().addStep('highlight', [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }]) },
    view: { change: () => st().setView('north') },
    /**
     * Phase 2 (2026-10-02) — excluded until then. `hlColor` is the last highlight colour pushed
     * to the renderer, and the one thing that writes it is the Filter card's swatch
     * (`setStepColor`), which sets that step's own colour with it. The step's colour is what is
     * on screen, and `filterStack[].color` reports it: with a highlight step already there, the
     * swatch alone has to make the result read differently.
     */
    hlColor: {
      setup: () => st().addStep('highlight', [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }]),
      change: () => st().setStepColor(st().stack[0].id, '#E05A6B')
    },
    /**
     * Phase 3 (2026-10-02) — excluded until then, the last one. Every coordinate read-out follows
     * the base point, so the assistant has to see what it is. Since 2026-10-08 the one thing that
     * moves it is the boot file's own georeferencing, fixed with the federation's frame.
     */
    coords: { change: () => st().setOffset([0, 0, 0], null, STATES_ONE) }
  }

  it('decides every key the session saves, and no key it does not', () => {
    resetShell()
    // `sessionSource` builds a `SessionSource`: its keys are the type's, at run time — and they
    // are what a session writes (`coords` included, for older builds, though it is never read back).
    const saved = Object.keys(sessionSource(st())).sort()
    expect(Object.keys(COVERAGE).sort()).toEqual(saved)
    expect(saved).toHaveLength(19)
    const payload = sessionPayload(sessionSource(st()), [], [], null, 'identity')
    for (const key of saved) expect([key, key in payload]).toEqual([key, true])
  })

  it('excludes nothing any more: every key the session saves is read back', () => {
    // Two until phase 2 (`hlColor` is reported through each highlight step's own colour), one
    // until phase 3 (`coords`, the base point). A key added later may still be excluded here —
    // by name, with a reason of more than a few words.
    const excluded = Object.entries(COVERAGE).filter(([, c]) => 'excluded' in c)
    expect(excluded.map(([k]) => k).sort()).toEqual([])
    for (const [key, c] of excluded) {
      expect([key, 'excluded' in c && c.excluded.length > 40]).toEqual([key, true])
    }
  })

  it('reads differently after each reported key changes', async () => {
    for (const [key, c] of Object.entries(COVERAGE)) {
      if (!('change' in c)) continue
      resetShell()
      st().commitModels(full)
      c.setup?.()
      const before = json(await run('get_view_state'))
      c.change()
      const after = json(await run('get_view_state'))
      expect([key, after !== before]).toEqual([key, true])
    }
  })

  it('reads the base point back: the four fields, and that they are the file’s', async () => {
    // The mock states no georeferencing: every field blank, and it says so rather than zero.
    expect((await run('get_view_state')).basePoint).toEqual({ E: null, N: null, Z: null, angle: null, source: 'none' })
    // A boot file that states one (the repository's synthetic set, never a real site's): the four
    // fields are the file's, and since 2026-10-08 nothing else can make them anything else.
    st().setOffset([0, 0, 0], null, STATES_ONE)
    const fromFile = coordsFromGeoref(STATES_ONE)!
    expect((await run('get_view_state')).basePoint).toEqual({ ...fromFile, source: 'file' })
    expect(basePointSource(STATES_ONE)).toBe('file')
    expect(basePointSource(null)).toBe('none')
    // Numbers and one of two words: nothing a file authored reaches the model through it.
    expect(Object.keys((await run('get_view_state')).basePoint as object)).toEqual(['E', 'N', 'Z', 'angle', 'source'])
    // On demand only: the per-turn state does not carry it.
    expect(Object.keys(perTurn())).toEqual(CORE_KEYS)
  })

  it('reads back which loaded models could not be lined up, as the Coordinate-system card’s note says', async () => {
    // The mock's four models state no map position, and none landed far: nothing to say.
    expect((await run('get_view_state')).notLinedUp).toEqual([])
    // One of them is placed by a map conversion, and the others are not: they have no map position.
    const placed = {
      ...full,
      models: full.models.map((m, i) =>
        i === 0 ? { ...m, meta: { ...m.meta, georef: STATES_ONE } } : i === 1 ? { ...m, meta: { ...m.meta, farPlacementMetres: 12_345 } } : m
      )
    }
    useShell.setState({ federation: placed })
    st().setOffset([0, 0, 0], null, STATES_ONE)
    expect((await run('get_view_state')).notLinedUp).toEqual([
      { model: 'STR', reason: 'it has no map position', km: null },
      { model: 'SIT', reason: 'it has no map position', km: null },
      { model: 'MEP', reason: 'it has no map position', km: null }
    ])
    const info = (await run('get_model_info')).models as { model: string; georeferencing: { notLinedUp: unknown } }[]
    expect(info.map((m) => [m.model, m.georeferencing.notLinedUp])).toEqual([
      ['ARC', null],
      ['STR', { reason: 'it has no map position', km: null }],
      ['SIT', { reason: 'it has no map position', km: null }],
      ['MEP', { reason: 'it has no map position', km: null }]
    ])
  })
})

/* ────────────────────────── phase 2 — the camera, viewpoints, step colours ────────────────────────── */

/**
 * 2026-10-02, phase 2. The assistant can turn the camera to any direction, save and restore a
 * viewpoint and change one step's colour, so it has to be able to read each of them back — and
 * the per-turn list of hidden models, which had no bound, has one.
 */
describe('the camera, read back in set_view’s own terms', () => {
  const pose = (theta: number, phi: number, proj = 'persp'): { theta: number; phi: number; proj: string } => ({
    theta,
    phi,
    proj
  })
  const withCamera = (cam: { theta: number; phi: number; proj: string } | null): ChatViewState =>
    chatViewState(st(), st().federation, visFn(st()), null, cam)

  it('says nothing per turn while the camera stands on the view that `view` names', () => {
    // At boot: `view` is iso, and the camera is where the boot framing left it.
    expect(st().view).toBe('iso')
    expect(Object.keys(withCamera(pose(...VIEWS.iso)))).toEqual(CORE_KEYS)
    // …and so for every toolbar view, once that button has been clicked.
    for (const name of ['top', 'north', 'south', 'east', 'west']) {
      st().setView(name)
      expect([name, Object.keys(withCamera(pose(...VIEWS[name], 'ortho')))]).toEqual([name, CORE_KEYS])
    }
    // No viewer, no camera to read: nothing is said, and nothing is guessed.
    expect(Object.keys(withCamera(null))).toEqual(CORE_KEYS)
  })

  it('names the direction once the camera has been orbited off that view', () => {
    const [theta, phi] = VIEWS.iso
    const state = withCamera(pose(theta + 0.3, phi - 0.2))
    expect(Object.keys(state)).toEqual([...CORE_KEYS, 'camera'])
    // The toolbar's button is still lit — `view` is the view asked for last — and `camera` says
    // where the camera really is: on no named view, and which way it looks.
    expect(state.view).toBe('iso')
    expect(state.camera).toEqual({ view: null, azimuthDeg: 297.8, elevationDeg: 41.3 })
    // The projection is not said twice: it is `projection`, as it always was.
    expect(state.camera).not.toHaveProperty('projection')
  })

  it('names the view the camera is on when that is not the one `view` names', () => {
    // A click on the view cube's top face: the camera is on `top`, and no view button is lit.
    st().clearView()
    expect(withCamera(pose(...VIEWS.top)).camera).toEqual({ view: 'top', azimuthDeg: 0, elevationDeg: 90 })
    // The 3D button lit, the camera turned to the north elevation by hand or by a viewpoint.
    st().setView('iso')
    expect(withCamera(pose(...VIEWS.north)).camera).toEqual({ view: 'north', azimuthDeg: 180, elevationDeg: 0 })
  })

  it('reads the six named views as the angles set_view’s description gives them', () => {
    for (const [name, [az, el]] of Object.entries(VIEW_DIRECTIONS)) {
      const brief = cameraBrief(pose(...VIEWS[name]))
      expect([name, brief.view]).toEqual([name, name])
      // Exactly, not to the nearest degree: `iso` is 29.8, and was quoted as 30 until review.
      expect([name, brief.azimuthDeg, brief.elevationDeg]).toEqual([name, az, el])
    }
    expect(cameraBrief(pose(...VIEWS.iso, 'ortho'))).toEqual({
      view: 'iso',
      projection: 'ortho',
      azimuthDeg: 315,
      elevationDeg: 29.8
    })
  })

  it('get_view_state reports the camera in full from the viewer, and leaves it out with no viewer', async () => {
    expect(await run('get_view_state')).not.toHaveProperty('camera')
    const { viewer, rig } = rigViewer()
    setViewer(viewer)
    try {
      expect((await run('get_view_state')).camera).toEqual({
        view: 'iso',
        projection: 'persp',
        azimuthDeg: 315,
        elevationDeg: 29.8
      })
      // Orbited by hand: on no named view, though the store's `view` — the lit button — is iso.
      rig.orbit(120, 40, null)
      const body = await run('get_view_state')
      expect(body.view).toBe('iso')
      expect((body.camera as { view: string | null }).view).toBeNull()
      // What `set_view` sets is what is read back.
      await run('set_view', { azimuth: 45, elevation: 30 })
      expect((await run('get_view_state')).camera).toEqual({
        view: null,
        projection: 'persp',
        azimuthDeg: 45,
        elevationDeg: 30
      })
      await run('set_view', { view: 'north' })
      expect((await run('get_view_state')).camera).toEqual({
        view: 'north',
        projection: 'ortho',
        azimuthDeg: 180,
        elevationDeg: 0
      })
    } finally {
      setViewer(null)
    }
  })
})

describe('saved viewpoints and step colours, on demand only', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
    setViewer(rigViewer().viewer)
  })
  afterEach(() => {
    setViewer(null)
    vi.unstubAllGlobals()
  })

  it('reports the saved viewpoints as the card lists them: name, what each holds, which was restored', async () => {
    expect((await run('get_view_state')).viewpoints).toEqual([])
    st().saveView()
    st().setSec('grid', planePatch('C', 'grid'))
    st().hide(full.elements.slice(0, 2).map((e) => e.id))
    st().saveView()
    st().renameView(st().views[1].id, 'Section C')
    st().restoreView(st().views[1])
    const body = await run('get_view_state')
    expect(body.viewpoints).toEqual([
      { name: 'Viewpoint 1', sub: '3D', active: false },
      { name: 'Section C', sub: 'grid C · 2 hidden', active: true }
    ])
    expect(body).not.toHaveProperty('viewpointsTruncated')
    // Names are the user's own text: never in what rides on every turn.
    expect(json(perTurn())).not.toContain('Section C')
    expect(Object.keys(perTurn())).not.toContain('viewpoints')
  })

  it('lists at most twenty viewpoints, clips a long name, and says how many there are', async () => {
    for (let i = 0; i < VIEWPOINTS_CAP + 5; i++) st().saveView()
    st().renameView(st().views[0].id, 'N'.repeat(VIEW_NAME_MAX + 40))
    const body = await run('get_view_state')
    expect(body.viewpoints).toHaveLength(VIEWPOINTS_CAP)
    expect(body).toMatchObject({ viewpointsTotal: VIEWPOINTS_CAP + 5, viewpointsTruncated: true })
    expect((body.viewpoints as { name: string }[])[0].name).toBe('N'.repeat(VIEW_NAME_MAX) + '…')
  })

  it('reports a highlight step’s colour, and no colour for a step that tints nothing', async () => {
    st().addStep('isolate', [{ prop: 'Level', op: '=', val: 'L2' }])
    st().addStep('highlight', [{ prop: 'IfcEntity', op: '=', val: 'IfcDoor' }])
    st().addStep('highlight', [{ prop: 'IfcEntity', op: '=', val: 'IfcWindow' }])
    st().setStepColor(st().stack[2].id, '#D96BD0')
    const stack = (await run('get_view_state')).filterStack as Record<string, unknown>[]
    expect(stack.map((x) => [x.step, x.action, x.color])).toEqual([
      [1, 'isolate', undefined],
      [2, 'highlight', st().stack[1].color],
      [3, 'highlight', '#D96BD0']
    ])
    expect(stack[0]).not.toHaveProperty('color')
    // The per-turn stack is as it was: step, enabled, action, rules — a colour is on demand.
    expect(Object.keys(perTurn().filterStack[1])).toEqual(['step', 'enabled', 'action', 'rules'])
  })
})

describe('the per-turn list of hidden models is bounded', () => {
  it('names twenty keys and counts the rest', () => {
    const many = Array.from({ length: MODELS_HIDDEN_CAP + 7 }, (_, i) => ({
      ...full.models[0],
      slot: i,
      meta: { ...full.models[0].meta, modelKey: `K${i}`, fileName: `K${i}.ifc` }
    }))
    const files = many.map((m) => ({ ...full.files[0], key: m.meta.modelKey }))
    const loaded = many.map((m) => m.meta.modelKey)
    useShell.setState({
      federation: { ...full, models: many, files },
      loaded,
      modelVis: Object.fromEntries(loaded.map((k) => [k, false]))
    })
    const state = perTurn()
    expect(state.modelsHidden).toEqual(loaded.slice(0, MODELS_HIDDEN_CAP))
    expect(state.modelsHiddenMore).toBe(7)
    // Exactly at the cap nothing is counted: the list is the whole of it.
    useShell.setState({ modelVis: Object.fromEntries(loaded.slice(0, MODELS_HIDDEN_CAP).map((k) => [k, false])) })
    expect(perTurn().modelsHidden).toHaveLength(MODELS_HIDDEN_CAP)
    expect(perTurn()).not.toHaveProperty('modelsHiddenMore')
    expect(MODELS_HIDDEN_CAP).toBe(20)
  })
})
