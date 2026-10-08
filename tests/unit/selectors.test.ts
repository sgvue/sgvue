/**
 * The sidebar's derived values — the arithmetic `SGVue.dc.html:1782–1833` does inside
 * `renderVals()`, checked against the design's own rules.
 */
import { describe, expect, it } from 'vitest'
import type { FederatedElement } from '../../src/shared/federate'
import { federate } from '../../src/shared/federate'
import type { Storey } from '../../src/shared/model-index.types'
import { NO_PLANE, NO_SECTIONS } from '../../src/shared/sections'
import { mockModelIndex, SAMPLE_FILES } from '../../src/renderer/dev/mock-adapter'
import {
  groupKey,
  matchesSearch,
  rowMeta,
  rowWindow,
  treeGroups
} from '../../src/renderer/state/selectors/tree'
import { soloStoreyName, storeyRows } from '../../src/renderer/state/selectors/storeys'
import { addableRows, baseSwatch, modelRows } from '../../src/renderer/state/selectors/models'
import { spatialCards, unitsLine, DASH } from '../../src/renderer/state/selectors/spatial'
import {
  hasActionBar,
  matHint,
  nativeToggle,
  on,
  projectHeader,
  sceneSummary,
  statusValues,
  toolbarFlags,
  treeTitle,
  viewFlags
} from '../../src/renderer/state/selectors/status'
import {
  abar,
  brow,
  browFrom,
  ACTION_LANE,
  BOTTOM_GAP,
  cardTopFrom,
  centrePlace,
  chatRight,
  HINT_MIN,
  rlane,
  ROW_CLEAR,
  ROW_ROOM
} from '../../src/renderer/state/selectors/lanes'
import { visibilityFrame } from '../../src/renderer/state/selectors/visibility'

let nextId = 1
function element(patch: Partial<FederatedElement>): FederatedElement {
  const id = patch.id ?? nextId++
  return {
    id,
    localId: id,
    expressId: id,
    guid: `g${id}`,
    guidValid: true,
    tag: '',
    model: 'ARC',
    name: `Element ${id}`,
    description: '',
    type: 'IfcWall',
    predefinedType: 'NOTDEFINED',
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
    ...patch
  }
}

const storey = (name: string, elev: number): Storey => ({
  expressId: 0,
  guid: '',
  name,
  elev
})

const base = {
  treeMode: 'entity' as const,
  search: '',
  expanded: {} as Record<string, boolean>,
  hidden: {} as Record<number | string, boolean>,
  selIds: [] as number[]
}

describe('tree selectors', () => {
  const els = [
    element({ id: 1, type: 'IfcWall', predefinedType: 'SOLIDWALL', objectType: 'Basic Wall', storey: 'L1' }),
    element({ id: 2, type: 'IfcWall', predefinedType: 'NOTDEFINED', objectType: '', storey: 'L2' }),
    element({ id: 3, type: 'IfcDoor', predefinedType: 'DOOR', objectType: 'Single', storey: 'L1' })
  ]

  it('groups by entity and by predefined type, sorted by key', () => {
    expect(treeGroups({ ...base, elements: els }).map((g) => g.key)).toEqual(['IfcDoor', 'IfcWall'])
    expect(treeGroups({ ...base, elements: els, treeMode: 'type' }).map((g) => g.key)).toEqual([
      'DOOR',
      'NOTDEFINED',
      'SOLIDWALL'
    ])
  })

  it('falls back to NOTDEFINED for a missing predefined type', () => {
    expect(groupKey(element({ predefinedType: '' }), 'type')).toBe('NOTDEFINED')
  })

  it('builds the two-line meta the design specifies, dropping falsy parts and NOTDEFINED', () => {
    expect(rowMeta(els[0], 'entity')).toBe('SOLIDWALL · Basic Wall · L1')
    // NOTDEFINED omitted and an empty ObjectType dropped: only the level is left.
    expect(rowMeta(els[1], 'entity')).toBe('L2')
    expect(rowMeta(els[0], 'type')).toBe('Wall · Basic Wall · L1')
    expect(rowMeta(els[2], 'type')).toBe('Door · Single · L1')
  })

  it('searches name, entity, object type, predefined type and storey', () => {
    expect(matchesSearch(els[0], 'solidwall')).toBe(true)
    expect(matchesSearch(els[0], 'basic')).toBe(true)
    expect(matchesSearch(els[0], 'ifcwall')).toBe(true)
    expect(matchesSearch(els[0], 'l1')).toBe(true)
    expect(matchesSearch(els[0], 'element 1')).toBe(true)
    expect(matchesSearch(els[0], 'zzz')).toBe(false)
  })

  it('opens a small group automatically while searching, and only then', () => {
    const closed = treeGroups({ ...base, elements: els })
    expect(closed.every((g) => !g.open)).toBe(true)
    expect(closed[0].items).toEqual([])
    const searched = treeGroups({ ...base, elements: els, search: 'wall' })
    expect(searched.map((g) => g.key)).toEqual(['IfcWall'])
    expect(searched[0].open).toBe(true)
    expect(searched[0].items).toHaveLength(2)
  })

  it('leaves a group with more than 40 hits closed under search', () => {
    const many = Array.from({ length: 41 }, (_, i) => element({ id: 100 + i, type: 'IfcWall' }))
    const [g] = treeGroups({ ...base, elements: many, search: 'wall' })
    expect(g.count).toBe(41)
    expect(g.open).toBe(false)
  })

  it('a group is hidden only when every element in it is hidden', () => {
    const half = treeGroups({ ...base, elements: els, hidden: { 1: true }, expanded: { IfcWall: true } })
    const wall = half.find((g) => g.key === 'IfcWall')!
    expect(wall.vis).toBe(true)
    expect(wall.opacity).toBe(1)
    expect(wall.items[0].hid).toBe(true)
    expect(wall.items[0].opacity).toBe(0.5)
    const all = treeGroups({ ...base, elements: els, hidden: { 1: true, 2: true } })
    expect(all.find((g) => g.key === 'IfcWall')!.vis).toBe(false)
  })

  it('marks the selected rows with the accent edge', () => {
    const [, wall] = treeGroups({ ...base, elements: els, expanded: { IfcWall: true }, selIds: [2] })
    expect(wall.items.find((i) => i.id === 2)!.edge).toBe('var(--accent)')
    expect(wall.items.find((i) => i.id === 1)!.edge).toBe('transparent')
  })
})

describe('storey selectors', () => {
  const storeys = [storey('L1', 0), storey('L2', 3.5), storey('B1', -1)]
  const els = [
    element({ id: 1, storey: 'L1' }),
    element({ id: 2, storey: 'L1' }),
    element({ id: 3, storey: 'L2' })
  ]

  it('formats signed elevations in millimetres with a real minus sign', () => {
    const rows = storeyRows({ storeys, elements: els, storeyVis: {}, active: null })
    expect(rows.map((r) => r.elev)).toEqual(['+0', '+3 500', '−1 000'])
    expect(rows.map((r) => r.count)).toEqual([2, 1, 0])
  })

  it('reports a storey as solo only when it is the single visible one', () => {
    expect(soloStoreyName(storeys, {})).toBe(null)
    expect(soloStoreyName(storeys, { L1: true, L2: false, B1: false })).toBe('L1')
    expect(soloStoreyName(storeys, { L2: false })).toBe(null)
    const rows = storeyRows({
      storeys,
      elements: els,
      storeyVis: { L1: true, L2: false, B1: false },
      active: null
    })
    expect(rows.find((r) => r.name === 'L1')).toMatchObject({
      solo: true,
      edge: 'var(--accent)',
      bg: 'var(--sel-bg)',
      fg: 'var(--sel-ink)'
    })
    expect(rows.find((r) => r.name === 'L2')).toMatchObject({ vis: false, opacity: 0.5 })
  })

  it('drops storeys with nothing in them while activate mode is on', () => {
    const rows = storeyRows({ storeys, elements: els, storeyVis: {}, active: 'ARC' })
    expect(rows.map((r) => r.name)).toEqual(['L1', 'L2'])
  })
})

describe('model and library selectors', () => {
  const federation = federate([mockModelIndex('ARC'), mockModelIndex('STR')])
  const library = SAMPLE_FILES.map((f) => ({
    key: f.key,
    name: f.name,
    file: f.file,
    swatch: f.swatch
  }))
  const input = {
    federation,
    // The design's mock federation has no file behind any model.
    files: [] as { key: string; path: string }[],
    library,
    modelVis: {},
    modelColors: {},
    nativeMats: true,
    uploadNames: {},
    active: null,
    palette: null,
    confirmRemove: null
  }

  it('reads name, file, count and swatch from the library and the federation', () => {
    const rows = modelRows(input)
    expect(rows.map((r) => r.key)).toEqual(['ARC', 'STR'])
    expect(rows[0]).toMatchObject({
      name: 'Architecture',
      file: 'SB_ARC_R25.ifc',
      swatch: '#D8D2C6',
      canRemove: true,
      vis: true
    })
    expect(rows[0].count + rows[1].count).toBe(federation.elements.length)
  })

  it('gives a model with no library entry a stable colour from the override palette', () => {
    expect(baseSwatch('ARC', 0, library)).toBe('#D8D2C6')
    expect(baseSwatch('Sample Ifc Model', 0, [])).toBe('#8A9492')
    expect(baseSwatch('Sample Ifc Model', 1, [])).toBe('#35C4B6')
  })

  it('rings the swatch only while an override is actually being shown', () => {
    const over = modelRows({ ...input, modelColors: { ARC: '#E05A6B' } })
    // nativeMats is on, so the override is set but not live.
    expect(over[0]).toMatchObject({ swatch: '#E05A6B', swatchRing: 'none' })
    const live = modelRows({ ...input, modelColors: { ARC: '#E05A6B' }, nativeMats: false })
    expect(live[0].swatchRing).toBe('0 0 0 1.5px var(--accent)')
    expect(live[0].colors.find((c) => c.c === '#E05A6B')!.ring).not.toBe('none')
  })

  it('prefers an upload name over the library name, extension stripped', () => {
    const rows = modelRows({ ...input, uploadNames: { ARC: 'Tower A.ifc' } })
    expect(rows[0]).toMatchObject({ name: 'Tower A', file: 'Tower A.ifc' })
  })

  it('offers only unloaded library files, and nothing at all when the library is empty', () => {
    expect(addableRows(library, ['ARC', 'STR']).map((f) => f.key)).toEqual(['SIT', 'MEP'])
    expect(addableRows(library, ['ARC', 'STR', 'SIT', 'MEP'])).toEqual([])
    expect(addableRows([], [])).toEqual([])
  })

  it('hides the unload × while only one model is loaded', () => {
    const one = federate([mockModelIndex('ARC')])
    expect(modelRows({ ...input, federation: one })[0].canRemove).toBe(false)
  })

  it('carries each model’s own file path for its hover title, by model key (2026-10-01)', () => {
    const rows = modelRows({
      ...input,
      files: [
        { key: 'STR', path: 'D:\\Shared\\Tower\\Struct.ifc' },
        { key: 'ARC', path: 'C:\\Models\\Tower\\Arch.ifc' },
        // A file whose model is not in the federation is nobody's path.
        { key: 'MEP', path: 'C:\\Models\\Tower\\Mech.ifc' }
      ]
    })
    expect(rows.map((r) => [r.key, r.path])).toEqual([
      ['ARC', 'C:\\Models\\Tower\\Arch.ifc'],
      ['STR', 'D:\\Shared\\Tower\\Struct.ifc']
    ])
    // The path is the title only: the row still shows the name and the file name.
    expect(rows[0]).toMatchObject({ name: 'Architecture', file: 'SB_ARC_R25.ifc' })
  })

  it('has no path — so no title, never a placeholder — for a model with no file behind it', () => {
    // The demo building and the `#mock` federation: `sessionFiles()` names neither.
    expect(modelRows(input).map((r) => r.path)).toEqual(['', ''])
    // One real file beside the demo's: only that row gains a path.
    const mixed = modelRows({
      ...input,
      files: [{ key: 'STR', path: 'C:\\Models\\Tower\\Struct.ifc' }]
    })
    expect(mixed.map((r) => r.path)).toEqual(['', 'C:\\Models\\Tower\\Struct.ifc'])
  })

  it('hands the popover each recent with its path, and the design’s own entries without one', () => {
    // `upload-pipeline.ts`'s `libraryOf`: a recent's key is its path.
    const path = 'C:\\Models\\Tower\\Arch.ifc'
    const recent = { key: path, name: 'Arch', file: 'Arch.ifc', swatch: '#35C4B6', path }
    expect(addableRows([...library, recent], ['ARC', 'STR', 'SIT', 'MEP'])).toEqual([recent])
    expect(addableRows(library, []).every((f) => f.path === undefined)).toBe(true)
  })
})

describe('spatial structure card', () => {
  const federation = federate([mockModelIndex('ARC'), mockModelIndex('STR')])
  const library = SAMPLE_FILES.map((f) => ({
    key: f.key,
    name: f.name,
    file: f.file,
    swatch: f.swatch
  }))
  const cards = spatialCards({
    federation,
    library,
    coords: { E: null, N: null, Z: null, angle: null },
    uploadNames: {}
  })

  it('lists one IfcProject per file, then the shared site and building', () => {
    expect(cards.map((c) => c.type)).toEqual([
      'IfcProject',
      'IfcProject',
      'IfcSite',
      'IfcBuilding'
    ])
    expect(cards[2].shared).toBe(true)
    expect(cards[3].shared).toBe(true)
  })

  it('composes the units line from the file’s own IfcUnitAssignment', () => {
    expect(unitsLine(mockModelIndex('ARC').units)).toBe(
      'MILLI.METRE · SQUARE_METRE · CUBIC_METRE'
    )
    expect(cards[0].rows.find((r) => r.k === 'Units')!.v).toBe(
      'MILLI.METRE · SQUARE_METRE · CUBIC_METRE'
    )
  })

  it('shows an em dash rather than inventing a value the file does not carry', () => {
    // The mock federation has no GlobalIds, no georeferencing and no CompositionType.
    expect(cards[0].rows.find((r) => r.k === 'GlobalId')!.v).toBe(DASH)
    expect(cards[2].rows.find((r) => r.k === 'RefElevation')!.v).toBe(DASH)
    expect(cards[2].rows.find((r) => r.k === 'True north')!.v).toBe(DASH)
    expect(cards[2].rows.find((r) => r.k === 'CompositionType')!.v).toBe(DASH)
    expect(cards[3].rows.find((r) => r.k === 'CompositionType')!.v).toBe(DASH)
  })

  it('fills CompositionType from IfcSite / IfcBuilding when the file states one', () => {
    const arc = mockModelIndex('ARC')
    const withComposition = spatialCards({
      federation: federate([
        {
          ...arc,
          site: { ...arc.site!, compositionType: 'COMPLEX' },
          building: { ...arc.building!, compositionType: 'ELEMENT' }
        }
      ]),
      library,
      coords: { E: null, N: null, Z: null, angle: null },
      uploadNames: {}
    })
    expect(withComposition[1].rows.find((r) => r.k === 'CompositionType')!.v).toBe('COMPLEX')
    expect(withComposition[2].rows.find((r) => r.k === 'CompositionType')!.v).toBe('ELEMENT')
  })

  it('fills the coordinate rows when the file does georeference', () => {
    const withCoords = spatialCards({
      federation,
      library,
      coords: { E: 28500, N: 30200, Z: 102.5, angle: 12.5 },
      uploadNames: {}
    })
    const site = withCoords[2]
    expect(site.rows.find((r) => r.k === 'RefElevation')!.v).toBe('102.500 m')
    expect(site.rows.find((r) => r.k === 'Easting / Northing')!.v).toBe(
      '28,500.000 E · 30,200.000 N (SVY21)'
    )
    expect(site.rows.find((r) => r.k === 'True north')!.v).toBe(
      '12.50° clockwise from project north'
    )
  })

  it('reports the storey ladder and the element totals from the federation', () => {
    const building = cards[3]
    expect(building.rows.find((r) => r.k === 'Storeys')!.v).toBe(
      `${federation.storeys.length} IfcBuildingStorey`
    )
    expect(building.rows.find((r) => r.k === 'Declared in')!.v).toBe(
      'SB_ARC_R25.ifc  ·  SB_STR_R25.ifc'
    )
    expect(building.rows.find((r) => r.k === 'Elements')!.v).toBe(
      federation.elements.length.toLocaleString('en-US')
    )
  })
})

describe('toolbar, status bar and lanes', () => {
  const toolbar = {
    tool: 'select' as const,
    snap: true,
    card: null,
    sections: NO_SECTIONS,
    grids: true,
    levels: false,
    shadows: true,
    groundGrid: true,
    stack: []
  }

  it('lights the active tool, snap, grids and shadows, and nothing else', () => {
    const tb = toolbarFlags(toolbar)
    expect(tb.select).toEqual(on(true))
    expect(tb.measure).toEqual(on(false))
    expect(tb.snap).toEqual(on(true))
    expect(tb.grids).toEqual(on(true))
    expect(tb.levels).toEqual(on(false))
    expect(tb.shadows).toEqual(on(true))
    expect(tb.section).toEqual(on(false))
    expect(tb.groundGrid).toEqual(on(true))
  })

  it('lights the canvas grid toggle from its own flag (2026-09-24)', () => {
    expect(toolbarFlags({ ...toolbar, groundGrid: false }).groundGrid).toEqual(on(false))
    // The IFC gridlines' button is a different flag, and does not follow it.
    expect(toolbarFlags({ ...toolbar, groundGrid: false }).grids).toEqual(on(true))
  })

  it('lights Section for a live section as well as for its open card', () => {
    expect(toolbarFlags({ ...toolbar, card: 'section' }).section).toEqual(on(true))
    // 2026-10-01: either plane lights it — the gridline cut, the level cut, or both.
    const grid = { ...NO_PLANE, name: 'C' }
    const level = { ...NO_PLANE, name: 'L2' }
    for (const sections of [
      { grid, level: NO_PLANE },
      { grid: NO_PLANE, level },
      { grid, level }
    ]) {
      expect(toolbarFlags({ ...toolbar, sections }).section).toEqual(on(true))
    }
    // An offset, a flip or a cut left on a plane with no name is not a section.
    expect(
      toolbarFlags({ ...toolbar, sections: { grid: { ...NO_PLANE, cut: true, offset: 500 }, level: NO_PLANE } })
        .section
    ).toEqual(on(false))
  })

  it('lights exactly one view button', () => {
    const vw = viewFlags('top')
    expect(vw.top).toEqual(on(true))
    expect(Object.values(vw).filter((f) => f.fg === 'var(--sel-ink)')).toHaveLength(1)
    expect(Object.values(viewFlags(null)).every((f) => f.fg === 'var(--muted)')).toBe(true)
  })

  it('reports the unit from state rather than a hard-coded mm (plan §3.5 item 4)', () => {
    const federation = federate([mockModelIndex('ARC')])
    const s = {
      stats: { fps: 61, backend: 'WebGL2' as const, calls: 17 },
      visibleCount: 40,
      federation,
      units: 'm' as const,
      bootGeoref: null
    }
    expect(statusValues(s)).toEqual({
      backend: 'WebGL2',
      fps: 61,
      visibleCount: 40,
      total: federation.elements.length,
      units: 'm',
      // The mock federation has no georeferencing, so the CRS chip is the design's own em dash
      // rather than its literal `SVY21` (`shared/georef.ts`).
      crs: '—'
    })
  })

  /* ── the action bar (2026-10-01): what the design appended to the status bar ── */

  it('draws the action bar only while one of its buttons exists', () => {
    const none = { canUndo: false, canRedo: false, measureCount: 0, spotCount: 0 }
    expect(hasActionBar(none)).toBe(false)
    expect(hasActionBar({ ...none, canUndo: true })).toBe(true)
    // Redo alone: everything was undone, and there is still something to step forward to.
    expect(hasActionBar({ ...none, canRedo: true })).toBe(true)
    expect(hasActionBar({ ...none, measureCount: 1 })).toBe(true)
    expect(hasActionBar({ ...none, spotCount: 2 })).toBe(true)
    expect(hasActionBar({ canUndo: true, canRedo: true, measureCount: 3, spotCount: 2 })).toBe(true)
  })

  it('reserves the action bar’s lane only while the bar is drawn', () => {
    // 27 px of bar — the status bar's own measured height — and the legend's 3 px gap.
    expect(ACTION_LANE).toBe(27 + 3)
    expect(abar(true)).toBe('30px')
    // `0px`, not nothing: `calc(42px + 0px)` is the design's own `bottom:42px`.
    expect(abar(false)).toBe('0px')
  })

  /* ── the bottom row (2026-10-01): where its centre zone stands ── */

  it('stands the bottom row’s centre between the side zones while it fits, above them when it does not', () => {
    // Measured on the mock: the status bar 287 px, the Ask pill 89 (67 until 2026-10-01, while
    // it read `Ask` beside a sparkle), the reset pill 183.
    const [status, ask, pill] = [287, 89, 183]
    expect(BOTTOM_GAP).toBe(10)
    // The default window (the row is 940 px): the pill fits between them, with 544 px to stand in.
    expect(centrePlace(940, status, ask, pill)).toBe('between')
    // A 900 px one (576): 180 px are left, 3 short of the pill, which does not wrap. With the
    // 67 px Ask pill there were 202, and it stood between.
    expect(centrePlace(576, status, ask, pill)).toBe('above')
    expect(centrePlace(576, status, 67, pill)).toBe('between')
    // 760 px with the sidebar open (436): 40 px are left.
    expect(centrePlace(436, status, ask, pill)).toBe('above')
    // Exactly enough — the pill and a gap on either side of it — is enough; a pixel less is not.
    const fits = status + ask + pill + 2 * BOTTOM_GAP
    expect(centrePlace(fits, status, ask, pill)).toBe('between')
    expect(centrePlace(fits - 1, status, ask, pill)).toBe('above')
    // Nothing in the centre is nothing to place, however little room there is.
    expect(centrePlace(940, status, ask, 0)).toBe('empty')
    expect(centrePlace(100, status, ask, 0)).toBe('empty')
  })

  it('lets a hint wrap, but never narrower than HINT_MIN', () => {
    const [status, ask] = [287, 89]
    expect(HINT_MIN).toBe(200)
    // A 922 px window (the row is 598): 202 px are left beside the bars, so the hint wraps where
    // it stands…
    expect(centrePlace(598, status, ask, HINT_MIN)).toBe('between')
    // …and behind a status bar 3 px wider there are 199, so it stands above them instead — as
    // it does at 900 px (576), where 180 are left.
    expect(centrePlace(598, status + 3, ask, HINT_MIN)).toBe('above')
    expect(centrePlace(576, status, ask, HINT_MIN)).toBe('above')
  })

  /* ── the bottom row's lane (2026-10-01): what its centre zone stands above one line ── */

  it('declares no lane for a one-line row, and what a taller centre zone needs above it', () => {
    // The design stops the chat panel 52 px above the stage's foot and 6 px above the Ask pill.
    expect([ROW_ROOM, ROW_CLEAR]).toEqual([52, 6])
    // The argument is measured: the stage's foot up to the centre zone's top. Nothing in the
    // centre; a one-line hint alone (14 + 32.8); the reset pill alone (14 + 35.5) — the
    // design's own layout, and the most that fits under the panel's line.
    for (const top of [0, 46.8, 49.5, 52]) expect([top, browFrom(top)]).toEqual([top, 0])
    // The reset pill over a one-line hint, 14 + 32.8 + 6 + 35.5 = 88.3 px up: the panel's foot
    // has to stand 94.3 px up to clear it by 6, which is 42.3 more than its 52.
    expect(browFrom(88.3)).toBe(43)
    // 900 px: the pill alone above both bars (110.5), and over a one-line hint there (149.3).
    expect(browFrom(110.5)).toBe(65)
    expect(browFrom(149.3)).toBe(104)
    // 760 px: the pill over a two-line hint, above both bars (166.09).
    expect(browFrom(166.09)).toBe(121)
    // Whole pixels, and once there is a lane it always clears by the 6 px — never by 7.
    expect(browFrom(52.01)).toBe(7)
    for (const top of [52.5, 53, 60.2, 80.39, 88.3, 110.5, 149.3, 166.09, 400]) {
      const lane = browFrom(top)
      expect(Number.isInteger(lane)).toBe(true)
      const clear = ROW_ROOM + lane - top
      expect([top, clear >= ROW_CLEAR && clear < ROW_CLEAR + 1]).toEqual([top, true])
    }
    // On the stage: `0px`, not nothing — `calc(52px + 0px)` is the design's own `bottom:52px`.
    expect(brow(0)).toBe('0px')
    expect(brow(43)).toBe('43px')
  })

  /* ── the canvas's text alternative (Phase 10) ── */

  it('describes an empty stage without claiming anything is in it', () => {
    const federation = federate([])
    expect(
      sceneSummary({ federation, visibleCount: 0, selIds: [], byId: new Map(), loaded: [] })
    ).toBe('A 3D view. No model is open.')
  })

  it('describes the federation with the same numbers the designed surfaces show', () => {
    const federation = federate([mockModelIndex('ARC'), mockModelIndex('STR')])
    const byId = new Map(federation.elements.map((e) => [e.id, e]))
    const total = federation.elements.length
    const one = federation.elements[0]
    const plain = sceneSummary({
      federation,
      visibleCount: total,
      selIds: [],
      byId,
      loaded: ['ARC', 'STR']
    })
    expect(plain).toContain('2 models')
    expect(plain).toContain(`${total.toLocaleString('en-US')} elements`)
    expect(plain).toContain(`${federation.storeys.length} storeys`)
    expect(plain).toContain(
      `${total.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} visible.`
    )
    // Nothing selected: the sentence simply ends.
    expect(plain).not.toContain('selected')

    const single = sceneSummary({
      federation,
      visibleCount: total - 1,
      selIds: [one.id],
      byId,
      loaded: ['ARC', 'STR']
    })
    expect(single).toContain(`${one.name} is selected.`)
    const many = sceneSummary({
      federation,
      visibleCount: total,
      selIds: federation.elements.slice(0, 3).map((e) => e.id),
      byId,
      loaded: ['ARC', 'STR']
    })
    expect(many).toContain('3 elements are selected.')
  })

  it('writes the project meta line as "{n} models · {files}"', () => {
    const federation = federate([mockModelIndex('ARC'), mockModelIndex('STR')])
    expect(projectHeader({ federation, loaded: ['ARC', 'STR'] })).toEqual({
      name: federation.project.name,
      file: `2 models · ${federation.project.file}`,
      schema: federation.project.schema
    })
    expect(projectHeader({ federation, loaded: ['ARC'] }).file).toMatch(/^1 model · /)
  })

  it('carries the three Original-materials hints (the toggle-off one since 2026-09-24)', () => {
    expect(matHint(true, {})).toBe('Surface colours as authored in the IFC files')
    expect(matHint(false, {})).toBe('Coloured by IFC class')
    expect(matHint(false, { ARC: '#35C4B6' })).toBe('Showing per-model colour overrides')
    expect(nativeToggle(true).x).toBe(14)
    expect(nativeToggle(false).x).toBe(0)
  })

  it('names the tree by mode', () => {
    expect(treeTitle('entity')).toBe('Elements by Entity')
    expect(treeTitle('type')).toBe('Elements by PredefinedType')
  })

  it('reserves the right lane only with a selection on a wide enough stage', () => {
    expect(rlane(true, 1000)).toBe('332px')
    expect(rlane(true, 420)).toBe('332px')
    expect(rlane(true, 419)).toBe('0px')
    expect(rlane(false, 1000)).toBe('0px')
    expect(chatRight(true, 1000)).toBe(344)
    expect(chatRight(false, 1000)).toBe(12)
    expect(cardTopFrom(40)).toBe(64)
    expect(cardTopFrom(40.4)).toBe(64)
    expect(cardTopFrom(75)).toBe(99)
  })
})

describe('temporary-state frame', () => {
  const els = [
    element({ id: 1, storey: 'L1' }),
    element({ id: 2, storey: 'L1' }),
    element({ id: 3, storey: 'L2' }),
    element({ id: 4, storey: 'L2' })
  ]
  const input = { elements: els, hidden: {}, storeyVis: {}, stack: [], visibleCount: 4 }

  it('stays out of the way while everything is visible', () => {
    expect(visibilityFrame(input).hiddenCount).toBe(0)
  })

  it('counts hidden elements and hidden storeys, in amber', () => {
    const v = visibilityFrame({ ...input, hidden: { 1: true }, storeyVis: { L2: false }, visibleCount: 1 })
    expect(v.hiddenCount).toBe(3)
    expect(v.label).toBe('3 elements hidden')
    expect(v.line).toBe('var(--warn-line)')
    expect(v.fg).toBe('var(--warn-ink)')
  })

  it('says "element" in the singular', () => {
    expect(visibilityFrame({ ...input, hidden: { 1: true }, visibleCount: 3 }).label).toBe(
      '1 element hidden'
    )
  })

  it('does not count a model switched off with its eye — the design does not either', () => {
    // `modelVis` is deliberately absent from `hiddenCount` (`SGVue.dc.html:1874`).
    expect(visibilityFrame({ ...input, visibleCount: 0 }).hiddenCount).toBe(0)
  })

  it('switches to the accent and the step count once a filter step is live', () => {
    const v = visibilityFrame({
      ...input,
      stack: [{ id: 'f1', on: true, action: 'isolate', rules: [{ prop: 'Level', op: '=', val: 'L1' }] }],
      visibleCount: 2
    })
    expect(v.hiddenCount).toBe(2)
    expect(v.label).toBe('1 filter step — 2 hidden')
    expect(v.line).toBe('var(--accent)')
  })

  it('counts the live steps, and a disabled one is not one of them', () => {
    const iso = {
      id: 'f1',
      on: true,
      action: 'isolate' as const,
      rules: [{ prop: 'Level', op: '=' as const, val: 'L1' }]
    }
    const v = visibilityFrame({
      ...input,
      stack: [iso, { ...iso, id: 'f2' }, { ...iso, id: 'f3', on: false }],
      visibleCount: 2
    })
    expect(v.label).toBe('2 filter steps — 2 hidden')
  })

  it('stays amber for a highlight-only stack — highlight hides nothing', () => {
    const v = visibilityFrame({
      ...input,
      hidden: { 1: true },
      stack: [
        {
          id: 'h1',
          on: true,
          action: 'highlight',
          rules: [{ prop: 'Level', op: '=', val: 'L1' }]
        }
      ],
      visibleCount: 3
    })
    expect(v.label).toBe('1 element hidden')
    expect(v.line).toBe('var(--warn-line)')
  })
})

describe('row windowing', () => {
  // 6 805 rows of 37 px in a 600 px viewport, 10 rows of overscan.
  const W = (viewTop: number): [number, number] => rowWindow(viewTop, 600, 37, 6805, 10)

  it('renders the whole list until a row height has been measured', () => {
    expect(rowWindow(0, 600, 0, 6805, 10)).toEqual([0, 6805])
  })

  it('keeps the slice bounded no matter how long the list is', () => {
    const [s0, e0] = W(0)
    expect(s0).toBe(0)
    expect(e0 - s0).toBeLessThan(40)
    const [s1, e1] = W(6805 * 37 - 600) // scrolled to the very bottom
    expect(e1).toBe(6805)
    expect(e1 - s1).toBeLessThan(40)
  })

  it('moves with the scroll and always covers the viewport plus the overscan', () => {
    const [s, e] = W(3700) // exactly 100 rows scrolled past
    expect(s).toBe(90)
    // 600 px of viewport is 16.2 rows, so the last visible row is 116; +10 overscan.
    expect(e).toBe(127)
    // every row the viewport can show is inside the slice
    expect(s * 37).toBeLessThanOrEqual(3700)
    expect(e * 37).toBeGreaterThanOrEqual(3700 + 600)
  })

  it('clamps at both ends and never inverts', () => {
    expect(W(-2000)[0]).toBe(0)
    const [s, e] = W(6805 * 37 + 5000)
    expect(s).toBeLessThanOrEqual(e)
    expect(e).toBe(6805)
  })
})
