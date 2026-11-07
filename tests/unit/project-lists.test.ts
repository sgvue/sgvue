/**
 * The `.sgvue` project file, phase 3 (plan D9) — the project's own lists and its markups,
 * through the real store, the real federation controller and the real `model/project.ts`:
 *
 *   · **The round trip**: a project's saved viewpoints, named filter sets and saved schedules
 *     replace what the app shows when it opens; every save, rename and delete acts on them, makes
 *     the project unsaved and writes nothing to `localStorage`; a save writes them; reopened, the
 *     same lists are back.
 *   · **Closing** brings the app's own `localStorage` lists back, byte for byte as they were.
 *   · **The one-time import**: a Save As from a session with no project takes the lists the app
 *     shows into the project.
 *   · **Markups**: each spot is placed again, and each measurement measured again, through the
 *     store's `placeSpot` / `placeMeasure` at the stored world point — firing only the directions
 *     it read; one on a missing model is carried, not placed.
 *   · **Viewpoint ids are the project's own**: a viewpoint the file had and the user deleted gives
 *     nothing of the file's to a new one saved under the same id.
 *
 * The upload pipeline's parse is the one seam replaced: Node has no worker, so a project's
 * admitted files join as the design's mock models, through the real `addBatch`, and the restore
 * runs as the pipeline runs it, once they have.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { federation, type BatchItem } from '../../src/renderer/model/federation-store'
import {
  closeProject,
  installProject,
  lastProjectScheduleFit,
  lastProjectRestore,
  measureReplay,
  onLoadedElements,
  openProjectMessage,
  projectStatus,
  snapshotFor,
  uniqueIds
} from '../../src/renderer/model/project'
import { projectSchedules, receive } from '../../src/renderer/model/schedule-link'
import { laserDirections } from '../../src/shared/annotate'
import { projectListsOn, useShell, type ShellState } from '../../src/renderer/state/shell'
import type { Viewpoint } from '../../src/renderer/state/selectors/views'
import { SAVED_KEY } from '../../src/renderer/schedule-ui/schedules'
import { emptySchedule, parseScheduleDef, type ScheduleDef } from '../../src/schedule/schedule/def'
import { projectText, readProject, type ProjectFile } from '../../src/shared/project-file'
import type { ProjectModelFile, ProjectSnapshot } from '../../src/shared/ipc-contract'
import type { MeasureRecord, SpotRecord } from '../../src/renderer/viewer/annotations'
import { memoryStorage, resetShell, stubViewer } from './stub-viewer'

/** The one seam: a project's admitted files join as mock models, and its restore then runs. */
const join = vi.hoisted(() => ({ items: null as null | ((paths: readonly string[]) => BatchItem[]) }))
vi.mock('../../src/renderer/model/upload-pipeline', async (orig) => {
  const real = await orig<typeof import('../../src/renderer/model/upload-pipeline')>()
  return {
    ...real,
    openProjectFiles: async (
      files: readonly { path: string }[],
      _refused: unknown,
      after: { order: readonly string[]; then: () => Promise<void> }
    ): Promise<boolean> => {
      if (!files.length) return false
      await federation.addBatch(join.items!(after.order))
      await after.then()
      return true
    }
  }
})

const st = (): ShellState => useShell.getState()
const OFFSET: [number, number, number] = [100, 200, 0]
const KEYS = ['ARC', 'STR'] as const
const pathOf = (key: string): string => `/projects/synthetic/review/models/${key}.ifc`
const shaOf = (key: string): string => key.toLowerCase().padEnd(64, '0').replace(/[^0-9a-f]/g, 'a')
const sizeOf = (key: string): number => 1000 + key.length
const itemOf = (key: string): BatchItem => ({
  index: mockModelIndex(key),
  chunks: [],
  offset: OFFSET,
  file: { key, path: pathOf(key), name: `${key}.ifc`, sha256: shaOf(key), size: sizeOf(key), slot: 0 }
})
join.items = (paths) => paths.map((p) => itemOf(/([^/]+)\.ifc$/.exec(p)![1]))

/* ── the viewer: what the store asks of it, recorded; markups fed back as the real one does ── */
const spotsAt: number[][] = []
const measuresAt: { p: number[]; normal: readonly number[] | null; only: unknown }[] = []
let nextMark = 1
const viewerMethods: Record<string, unknown> = {
  getCamera: () => ({ theta: -0.8, phi: 1.05, dist: 60, half: 12, target: [3, 4, 5], proj: 'persp' }),
  debug: () => ({}),
  elementIds: () => [],
  placeSpot: (p: number[]) => {
    spotsAt.push([...p])
    const rec: SpotRecord = { id: nextMark++, p: [p[0], p[1], p[2]], E: null, N: null, Z: null, x: 0, y: 0, z: 0 }
    st().setSpots([...st().spots, rec])
  },
  placeMeasure: (p: number[], normal: readonly number[] | null, _self: number, only?: { axis: string; sign: number }[]) => {
    measuresAt.push({ p: [...p], normal, only })
    const sides: MeasureRecord['sides'] = {}
    for (const d of only ?? []) {
      const k = d.axis.toLowerCase() as 'x' | 'y' | 'z'
      const s = (sides[k] ??= { minus: null, plus: null })
      if (d.sign > 0) s.plus = 1.5
      else s.minus = 0.5
    }
    // Fired with a face and no direction filter, the real laser records that face.
    const face = normal && !only ? { normal: [normal[0], normal[1], normal[2]] as [number, number, number] } : {}
    st().setMeasures([...st().measures, { id: nextMark++, p: [p[0], p[1], p[2]], sides, ...face }])
    return true
  },
  clearSpots: () => st().setSpots([]),
  clearMeasures: () => st().setMeasures([])
}
const viewer = stubViewer(viewerMethods)

/* ── the bridge, as far as the project's half uses it ── */
const dirtyCalls: boolean[] = []
let savedCb: ((m: { n: number }) => void) | null = null
let storage: Storage

beforeAll(() => {
  vi.stubGlobal('__APP_VERSION__', '0.0.0-test')
  storage = memoryStorage()
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('window', {
    sgvue: {
      closeProject: async () => undefined,
      setProjectDirty: async (d: boolean) => void dirtyCalls.push(d),
      onProjectSnapshotRequest: () => () => undefined,
      onProjectOpened: () => () => undefined,
      onProjectSaved: (fn: (m: { n: number }) => void) => {
        savedCb = fn
        return () => undefined
      }
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  })
  federation.attach(viewer)
})
afterAll(() => {
  federation.attach(null)
  vi.unstubAllGlobals()
})

let uninstall: () => void = () => undefined
beforeEach(async () => {
  closeProject()
  resetShell()
  federation.attach(viewer)
  storage.clear()
  spotsAt.length = 0
  measuresAt.length = 0
  dirtyCalls.length = 0
  uninstall = installProject()
  federation.resetUnshown()
  await federation.addBatch(KEYS.map(itemOf))
})
afterEach(() => {
  uninstall()
  closeProject()
  vi.restoreAllMocks()
})

/** The app's own lists — through the real actions with no project open, so `localStorage` holds them. */
function ownLists(): void {
  st().saveView()
  st().renameView(st().views[0].id, 'Own lobby')
  st().addStep('hide', [{ prop: 'IfcEntity', op: '=', val: 'IfcDoor' }])
  st().saveFilterSet('Own doors')
  const own: ScheduleDef = { ...emptySchedule('Own walls', ['IfcWall']), columns: [{ field: { kind: 'core', key: 'name' } }] }
  storage.setItem(SAVED_KEY, JSON.stringify([{ name: 'Own walls', def: own, savedAt: '2026-11-01T00:00:00Z' }]))
}

/** Everything the app keeps in `localStorage`, as text. */
const stored = (): Record<string, string> =>
  Object.fromEntries(Array.from({ length: storage.length }, (_, i) => storage.key(i)!).map((k) => [k, storage.getItem(k)!]))

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
/**
 * The last dirty flag main heard, once the 250 ms debounce has run — waited for, up to 3 s, so a
 * busy machine's late timer reads as late, not as wrong.
 */
async function dirty(want?: boolean): Promise<boolean | undefined> {
  await sleep(300)
  if (want !== undefined) {
    await vi.waitFor(() => expect(dirtyCalls.at(-1)).toBe(want), { timeout: 3000, interval: 50 })
  }
  return dirtyCalls.at(-1)
}

let snapN = 100
/** File › Save Project, as main runs it: the snapshot, then "saved". */
function save(): { snap: ProjectSnapshot; file: ProjectFile } {
  const n = ++snapN
  const snap = snapshotFor(n)
  if (!snap.text) throw new Error(`nothing to save: ${snap.reason}`)
  savedCb!({ n })
  const read = readProject(snap.text)
  if (!read.ok) throw new Error(read.message)
  return { snap, file: read.project }
}

/** File › Open Project…, as main hands a read project over — with every model admitted unless named. */
async function open(file: ProjectFile, missing: readonly string[] = []): Promise<void> {
  const models: ProjectModelFile[] = file.models.map((m) => ({
    id: m.id,
    file: missing.includes(m.name) ? null : { path: pathOf(m.name.replace(/\.ifc$/, '')), name: m.name, size: m.size },
    refused: null
  }))
  await openProjectMessage({ ok: true, name: 'review', text: JSON.stringify(file), models })
  expect(projectStatus()).toEqual({ open: true, loading: false })
}

const names = (): { views: string[]; sets: string[]; schedules: string[] } => ({
  views: st().views.map((v) => v.name),
  sets: st().filterSets.map((f) => f.label),
  schedules: (projectSchedules()?.saved ?? []).map((e) => e.name)
})

/* ────────────────────────────── the one-time import, editing, closing ────────────────────────────── */

describe('a project’s lists are its own', () => {
  it('a first save imports the lists the app shows; while open every change is the project’s; closing brings localStorage’s back untouched', async () => {
    ownLists()
    const before = stored()
    expect(Object.keys(before).sort()).toEqual(
      ['ifc-viewer:filtersets', 'ifc-viewer:viewpoints:' + (st().federation.project.building || 'model'), SAVED_KEY].sort()
    )
    expect(projectListsOn()).toBe(false)

    // Save As from a session with no project: the one-time import.
    const first = save().file
    expect(first.viewpoints.map((v) => v.name)).toEqual(['Own lobby'])
    expect(first.filterSets.map((f) => f.label)).toEqual(['Own doors'])
    expect(first.schedules.saved.map((e) => e.name)).toEqual(['Own walls'])
    expect(projectListsOn()).toBe(true)
    expect(names()).toEqual({ views: ['Own lobby'], sets: ['Own doors'], schedules: ['Own walls'] })
    expect(await dirty()).toBe(false)

    // Every kind of change, through the real actions: the project's, and unsaved.
    st().saveView()
    st().renameView(st().views[1].id, 'Project core')
    st().dropView(st().views[0].id)
    st().saveFilterSet('Project doors')
    st().forgetFilterSet(st().filterSets[0].id)
    expect(names().views).toEqual(['Project core'])
    expect(names().sets).toEqual(['Project doors'])
    expect(await dirty(true)).toBe(true)
    // …and the Schedules window's save, reported over the port.
    const def: ScheduleDef = { ...emptySchedule('Project doors', ['IfcDoor']), columns: [{ field: { kind: 'core', key: 'mark' } }] }
    receive({ type: 'projectSaved', saved: [{ name: 'Project doors', def, savedAt: '2026-11-07T00:00:00Z' }] })
    expect(names().schedules).toEqual(['Project doors'])
    // localStorage: exactly as it was.
    expect(stored()).toEqual(before)

    const second = save().file
    expect(await dirty()).toBe(false)
    expect(second.viewpoints.map((v) => v.name)).toEqual(['Project core'])
    expect(second.filterSets.map((f) => f.label)).toEqual(['Project doors'])
    expect(second.schedules.saved.map((e) => e.name)).toEqual(['Project doors'])

    // Closed: the app's own lists, read back from localStorage, which the project never wrote.
    closeProject()
    expect(projectListsOn()).toBe(false)
    expect(projectSchedules()).toBeNull()
    expect(names().views).toEqual(['Own lobby'])
    expect(names().sets).toEqual(['Own doors'])
    expect(stored()).toEqual(before)

    // Reopened: the project's lists replace them, and come back as they were saved.
    await open(second)
    expect(names()).toEqual({ views: ['Project core'], sets: ['Project doors'], schedules: ['Project doors'] })
    expect(await dirty()).toBe(false)
    // A save straight after writes the same lists.
    const third = save().file
    expect(JSON.stringify(third.viewpoints)).toBe(JSON.stringify(second.viewpoints))
    expect(JSON.stringify(third.filterSets)).toBe(JSON.stringify(second.filterSets))
    expect(JSON.stringify(third.schedules)).toBe(JSON.stringify(second.schedules))
    // A rename in the reopened project is unsaved, and still touches nothing stored.
    st().renameView(st().views[0].id, 'Renamed')
    expect(await dirty(true)).toBe(true)
    closeProject()
    expect(stored()).toEqual(before)
    expect(names().views).toEqual(['Own lobby'])
  })

  it('with no project open, every save writes localStorage as it always has', () => {
    st().saveView()
    const key = 'ifc-viewer:viewpoints:' + (st().federation.project.building || 'model')
    expect((JSON.parse(storage.getItem(key)!) as Viewpoint[]).length).toBe(1)
    st().addStep('hide', [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }])
    st().saveFilterSet('x')
    expect((JSON.parse(storage.getItem('ifc-viewer:filtersets')!) as unknown[]).length).toBe(1)
    expect(projectListsOn()).toBe(false)
  })

  it('an opened project’s open schedule is held, and saved, whether or not the Schedules window is open', async () => {
    const def: ScheduleDef = { ...emptySchedule('Doors', ['IfcDoor']), columns: [{ field: { kind: 'core', key: 'name' } }] }
    const { file } = save()
    await open({ ...file, schedules: { saved: [], open: def } })
    expect(projectSchedules()?.open).toEqual(parseScheduleDef(def))
    expect(save().file.schedules.open).toEqual(parseScheduleDef(def))
  })
})

/* ────────────────────────────── markups ────────────────────────────── */

describe('markups come back through the viewer’s own commit', () => {
  /** An element's box centre top, world coordinates — a point on a loaded element. */
  const onTop = (key: string): [number, number, number] => {
    const el = st().federation.elements.find((e) => e.model === key && e.bbox)!
    const b = el.bbox!
    return [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, b[5]]
  }

  it('places each spot at its point and measures each measurement again, firing only what it read', async () => {
    const { file } = save()
    const at = onTop('ARC')
    const withMarks: ProjectFile = {
      ...file,
      markups: {
        spots: [{ at: [110, 210, 3] }],
        measures: [{ at, x: 4, z: 2.5, sides: { x: { minus: 1, plus: 3 }, z: { minus: null, plus: 2.5 } } }]
      }
    }
    await open(withMarks)
    // The store subtracts the offset: the viewer is handed scene points.
    expect(spotsAt).toEqual([[10, 10, 3]])
    expect(measuresAt).toHaveLength(1)
    expect(measuresAt[0].p).toEqual([at[0] - OFFSET[0], at[1] - OFFSET[1], at[2] - OFFSET[2]])
    expect(measuresAt[0].only).toEqual([
      { axis: 'X', sign: 1 },
      { axis: 'X', sign: -1 },
      { axis: 'Z', sign: 1 }
    ])
    expect(measuresAt[0].normal).toEqual([0, 0, 1])
    expect(lastProjectRestore()).toEqual({ spots: 1, spotsCarried: 0, measured: 1, carried: 0, unread: 0 })
    // What the viewer recorded is the project's now, and a save writes it back in world coordinates.
    expect(await dirty()).toBe(false)
    const again = save().file
    expect(again.markups.spots).toEqual([{ at: [110, 210, 3] }])
    expect(again.markups.measures.map((m) => m.at)).toEqual([at])
  })

  it('carries a measurement that stood on a missing model into every save, unplaced', async () => {
    const { file } = save()
    const onArc = onTop('ARC')
    const onStr = onTop('STR')
    const strMeasure = { at: onStr, z: 2, sides: { z: { minus: null, plus: 2 } } }
    const withMarks: ProjectFile = {
      ...file,
      markups: { spots: [], measures: [{ at: onArc, z: 1, sides: { z: { minus: null, plus: 1 } } }, strMeasure] }
    }
    federation.resetUnshown()
    join.items = (paths) => paths.map((p) => itemOf(/([^/]+)\.ifc$/.exec(p)![1]))
    // STR's file is not found.
    await open(withMarks, ['STR.ifc'])
    expect(st().loaded).toEqual(['ARC'])
    expect(measuresAt.map((m) => m.p)).toEqual([[onArc[0] - 100, onArc[1] - 200, onArc[2]]])
    expect(lastProjectRestore()).toEqual({ spots: 0, spotsCarried: 0, measured: 1, carried: 1, unread: 0 })
    const saved = save().file
    expect(saved.markups.measures).toHaveLength(2)
    expect(saved.markups.measures[1]).toEqual(strMeasure)
  })
})

describe('review fixes — markups survive a failed restore, and a stored normal', () => {
  const onTop = (key: string): [number, number, number] => {
    const el = st().federation.elements.find((e) => e.model === key && e.bbox)!
    const b = el.bbox!
    return [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, b[5]]
  }

  it('a restore that throws before the markups are placed keeps every spot and measurement for the next save', async () => {
    const { file } = save()
    const marks: ProjectFile['markups'] = {
      spots: [{ at: [110, 210, 3] }],
      measures: [{ at: onTop('ARC'), z: 1, sides: { z: { minus: null, plus: 1 } } }]
    }
    vi.spyOn(st(), 'applySession').mockImplementation(() => {
      throw new Error('restore failed')
    })
    await expect(open({ ...file, markups: marks })).rejects.toThrow('restore failed')
    vi.restoreAllMocks()
    expect(projectStatus()).toEqual({ open: true, loading: false })
    expect(spotsAt).toEqual([])
    expect(save().file.markups).toEqual(marks)
  })

  it('a spot the viewer could not place is carried, not dropped', async () => {
    const { file } = save()
    federation.attach(stubViewer({ ...viewerMethods, placeSpot: () => undefined }))
    // The store's own `placeSpot` says false with no 3D view; here the viewer is present and
    // records nothing, so the store is asked to say false instead.
    vi.spyOn(st(), 'placeSpot').mockReturnValue(false)
    await open({ ...file, markups: { spots: [{ at: [1, 2, 3] }], measures: [] } })
    expect(lastProjectRestore()?.spotsCarried).toBe(1)
    expect(save().file.markups.spots).toEqual([{ at: [1, 2, 3] }])
    vi.restoreAllMocks()
    federation.attach(viewer)
  })

  it('a wall face with open space beyond it is fired from its stored normal, never into the wall', async () => {
    const { file } = save()
    const at = onTop('ARC')
    // Clicked on the wall's +Y face, looking out at the sky: Y read nothing either way, so no
    // inference could say which side the wall is on. The stored normal does.
    const wall = { at, x: 4, z: 3, sides: { x: { minus: 2, plus: 2 }, z: { minus: 1, plus: 2 } }, normal: [0, 1, 0] as [number, number, number] }
    expect(measureReplay(wall).only.some((d) => d.axis === 'Y')).toBe(false)
    await open({ ...file, markups: { spots: [], measures: [wall] } })
    expect(measuresAt).toHaveLength(1)
    expect(measuresAt[0].normal).toEqual([0, 1, 0])
    // No filter: the laser fires what a click on that face fires — every way but into the wall.
    expect(measuresAt[0].only).toBeUndefined()
    expect(laserDirections([0, 1, 0]).some((d) => d.axis === 'Y' && d.sign === -1)).toBe(false)
    expect(laserDirections([0, 1, 0]).some((d) => d.axis === 'Y' && d.sign === 1)).toBe(true)
    // The laser's own normal is written back.
    expect(save().file.markups.measures[0].normal).toEqual([0, 1, 0])
  })

  it('the normal is optional, bounded and checked: a unit vector of finite numbers or nothing', () => {
    const { file } = save()
    const base = { at: [1, 2, 3] as [number, number, number], sides: {} }
    const read = (m: unknown) => readProject(projectText({ ...file, markups: { spots: [], measures: [m as never] } }))
    expect(read(base).ok).toBe(true)
    expect(read({ ...base, normal: [0, 0, 1] }).ok).toBe(true)
    expect(read({ ...base, normal: [0, 0.7071, 0.7071] }).ok).toBe(true)
    for (const bad of [[0, 0, 2], [0, 0, 0], [0, 1], [0, 0, 1, 0], ['0', '0', '1'], [0, 0, 1e400]]) {
      const r = read({ ...base, normal: bad })
      expect(r.ok, JSON.stringify(bad)).toBe(false)
    }
    // The writer leaves out what it could not check: a store measure with a bad normal.
    useShell.setState({ measures: [{ id: 1, p: [0, 0, 0], sides: {}, normal: [0, 0, 3] }] })
    expect(save().file.markups.measures[0]).not.toHaveProperty('normal')
  })
})

describe('review fixes — the Schedules window is never handed a list it must refuse', () => {
  it('a first save’s import clips a name past the port’s bound, leaves out what cannot cross, and counts it', async () => {
    const ok: ScheduleDef = { ...emptySchedule('x', ['IfcWall']), columns: [{ field: { kind: 'core', key: 'name' } }] }
    const long = 'L'.repeat(1500)
    const tooWide = { ...ok, columns: Array.from({ length: 201 }, () => ({ field: { kind: 'core', key: 'name' } })) }
    storage.setItem(
      SAVED_KEY,
      JSON.stringify([
        { name: long, def: { ...ok, name: long }, savedAt: '' },
        { name: 'Wide', def: tooWide, savedAt: '' },
        { name: 'Fine', def: { ...ok, name: 'Fine' }, savedAt: '' }
      ])
    )
    save()
    expect(names().schedules).toEqual(['L'.repeat(1000), 'Fine'])
    expect(projectSchedules()!.saved[0].def.name).toBe('L'.repeat(1000))
    expect(lastProjectScheduleFit()).toEqual({ dropped: 1, openDropped: false })
  })

  it('a schedule the Schedules window chose by itself does not become the project’s open one', async () => {
    const { file } = save()
    await open({ ...file, schedules: { saved: [], open: null } })
    expect(await dirty()).toBe(false)
    const def: ScheduleDef = { ...emptySchedule('Wall Schedule', ['IfcWall']), columns: [{ field: { kind: 'core', key: 'name' } }] }
    receive({ type: 'current', def, rowCount: 4, fromDefault: true })
    expect(projectSchedules()?.open).toBeNull()
    expect(await dirty()).toBe(false)
    // Once someone changes it, it is the project's — and unsaved.
    receive({ type: 'current', def: { ...def, name: 'Walls' }, rowCount: 4 })
    expect(projectSchedules()?.open?.name).toBe('Walls')
    expect(await dirty(true)).toBe(true)
  })
})

/* ────────────────────────────── viewpoint ids ────────────────────────────── */

describe('a viewpoint id is the project’s own', () => {
  it('a viewpoint deleted and another saved under its id gains nothing of a missing model', async () => {
    // A review of ARC and STR, with a viewpoint hiding three of STR's elements.
    const strIds = st().federation.elements.filter((e) => e.model === 'STR').map((e) => e.id)
    const { file } = save()
    const vp = {
      id: 7,
      name: 'Cores',
      sub: '3D',
      cam: null,
      hidden: Object.fromEntries(strIds.slice(0, 3).map((id) => [id, true])),
      storeyVis: {},
      modelVis: { STR: false },
      stack: [],
      active: null,
      grids: true,
      levels: true,
      frame: 'identity',
      idStride: 1_000_000_000
    }
    useShell.setState({ views: [vp] })
    const original = save().file
    expect(original.viewpoints[0].hidden.filter(([m]) => m === file.models[1].id)).toHaveLength(3)

    // Opened with STR missing: the viewpoint is the file's, and its STR refs are carried.
    await open(original, ['STR.ifc'])
    expect(save().file.viewpoints[0].hidden).toHaveLength(3)

    // Deleted, and a new viewpoint saved under the same id: it is a new viewpoint.
    st().dropView(7)
    vi.spyOn(Date, 'now').mockReturnValue(7)
    st().saveView()
    expect(st().views.map((v) => v.id)).toEqual([7])
    const saved = save().file
    expect(saved.viewpoints).toHaveLength(1)
    expect(saved.viewpoints[0].hidden).toEqual([])
    expect(saved.viewpoints[0].modelVis).toEqual({})
  })

  it('an id the file repeats is made unique, the first keeping it', () => {
    expect(uniqueIds([{ id: 3 }, { id: 3 }, { id: 9 }, { id: 3 }]).map((x) => x.id)).toEqual([3, 10, 9, 11])
    const plain = [{ id: 1 }, { id: 2 }]
    expect(uniqueIds(plain)).toEqual(plain)
  })

  it('a project whose file repeats a viewpoint id deletes only the one asked', async () => {
    const { file } = save()
    const one = {
      id: 5,
      name: 'A',
      sub: '3D',
      camera: null,
      sections: { grid: { name: '', offset: 0, flip: false, cut: false }, level: { name: '', offset: 0, flip: false, cut: false } },
      hidden: [],
      storeyVis: {},
      modelVis: {},
      stack: [],
      active: null,
      grids: true,
      levels: true
    }
    await open({ ...file, viewpoints: [one, { ...one, name: 'B' }] })
    expect(st().views.map((v) => [v.id, v.name])).toEqual([
      [5, 'A'],
      [6, 'B']
    ])
    st().dropView(5)
    expect(st().views.map((v) => v.name)).toEqual(['B'])
  })
})

/* ────────────────────────────── the pure parts ────────────────────────────── */

describe('measureReplay — how a saved measurement is measured again', () => {
  it('fires only the directions that read, and lifts off the face the missing side names', () => {
    expect(measureReplay({ sides: { x: { minus: 1, plus: 2 }, y: { minus: null, plus: 3 } } })).toEqual({
      only: [
        { axis: 'X', sign: 1 },
        { axis: 'X', sign: -1 },
        { axis: 'Y', sign: 1 }
      ],
      normal: [0, 1, 0]
    })
  })

  it('an exterior wall face — nothing beyond it — never fires into the wall', () => {
    // Clicked on the wall's +Y face, looking out to the sky: Y read nothing either way.
    const r = measureReplay({ sides: { x: { minus: 2, plus: 2 }, z: { minus: 1, plus: 2 } } })
    expect(r.only.some((d) => d.axis === 'Y')).toBe(false)
    expect(r.normal).toBeNull()
  })

  it('two axes that each read one side give a normal between them', () => {
    const r = measureReplay({ sides: { x: { minus: null, plus: 1 }, z: { minus: null, plus: 1 } } })
    expect(r.normal![0]).toBeCloseTo(Math.SQRT1_2)
    expect(r.normal![2]).toBeCloseTo(Math.SQRT1_2)
  })
})

describe('onLoadedElements', () => {
  const els = [
    { model: 'A', bbox: [0, 0, 0, 1, 1, 1] },
    { model: 'B', bbox: [10, 10, 0, 11, 11, 1] },
    { model: 'B', bbox: [20, 20, 0, 21, 21, 1] },
    { model: 'B' }
  ]
  it('is true on a box or within 5 cm of it, false elsewhere', () => {
    const on = onLoadedElements(els)
    expect(on([0.5, 0.5, 1])).toBe(true)
    expect(on([1.04, 0.5, 0.5])).toBe(true)
    expect(on([1.06, 0.5, 0.5])).toBe(false)
    // Inside model B's union box, on none of its elements.
    expect(on([15, 15, 0.5])).toBe(false)
    expect(on([5, 5, 0.5])).toBe(false)
    expect(on([10.5, 10.5, 0.5])).toBe(true)
    expect(onLoadedElements([])([0, 0, 0])).toBe(false)
  })
})
