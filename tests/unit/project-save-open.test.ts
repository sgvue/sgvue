/**
 * The `.sgvue` project file, phase 2 — the renderer's half (`src/renderer/model/project.ts`),
 * through the real store on the design's own mock federation.
 *
 *   · **The round trip**: a review state is built into a project (`buildProject` → `projectText`),
 *     read back (`readProject`), mapped onto a federation opened **in another order** — every
 *     element id different — by GlobalId (`restorePlanOf`), and put back through the store's own
 *     restore path (`applyProjectRestore`). What a project saves comes back; what it does not is
 *     left as it stands.
 *   · **Dirty tracking** (`projectStateKey`): which changes make an open project unsaved and which
 *     never do — the theme, the selection, sizes, the open card, the armed tool, the tree's search.
 *   · **D12** (`assignColours`): a model added to an open project takes the colour its neighbours
 *     use least, under the user's override; one that never got a colour keeps the grey's accent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MC } from '../../src/shared/colors'
import { federate } from '../../src/shared/federate'
import { projectText, readProject, restorePlanOf, type ProjectFile } from '../../src/shared/project-file'
import type { SessionCamera } from '../../src/shared/session-codec'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { setViewer, useShell, type ShellState } from '../../src/renderer/state/shell'
import { cutSwatch, modelRows, rowSwatch } from '../../src/renderer/state/selectors/models'
import {
  applyProjectRestore,
  ASSIGN_PALETTE,
  assignColours,
  buildProject,
  canonical,
  type Carried,
  closeProject,
  installProject,
  MODEL_MISSING,
  openProjectMessage,
  projectCarried,
  projectStatus,
  restore,
  snapshotFor,
  projectStateKey,
  type ProjectFileInfo,
  type SnapshotInputs
} from '../../src/renderer/model/project'
import { resetShell, stubViewer } from './stub-viewer'
import { disposeUploads, showRefused } from '../../src/renderer/model/upload-pipeline'
import { TOO_LARGE } from '../../src/shared/upload'
import { carryForward, projectOf } from '../../src/shared/project-file'
import { projectContextOf, projectSourceOf } from '../../src/renderer/model/project'

const KEYS = ['ARC', 'STR', 'SIT', 'MEP'] as const
const st = (): ShellState => useShell.getState()

const CAM: SessionCamera = { theta: -0.8, phi: 1.05, dist: 60, half: 12, target: [3, 4, 5], proj: 'ortho' }
let cam: SessionCamera = CAM
let camerasSet: SessionCamera[] = []

const filesOf = (keys: readonly string[]): ProjectFileInfo[] =>
  keys.map((key, slot) => ({
    key,
    path: `/projects/synthetic/review/models/${key}.ifc`,
    name: `${key}.ifc`,
    sha256: key.toLowerCase().padEnd(64, '0').replace(/[^0-9a-f]/g, 'a'),
    size: 1000 + slot,
    slot
  }))

function boot(keys: readonly string[]): void {
  resetShell()
  cam = CAM
  camerasSet = []
  setViewer(
    stubViewer({
      getCamera: () => cam,
      setCamera: (c: SessionCamera) => void camerasSet.push(c)
    })
  )
  st().commitModels(federate(keys.map((k) => mockModelIndex(k))))
}

const inputs = (keys: readonly string[] = KEYS): SnapshotInputs => ({
  state: st(),
  cam,
  files: filesOf(keys),
  schedules: [],
  openSchedule: null
})

/** The hidden elements, by model and GlobalId — the identity that survives another load order. */
const hiddenGuids = (): string[] =>
  Object.keys(st().hidden)
    .map((id) => st().byId.get(Number(id))!)
    .map((e) => `${e.model}/${e.guid}`)
    .sort()

const idsWhere = (pred: (e: ShellState['federation']['elements'][number]) => boolean): number[] =>
  st().federation.elements.filter(pred).map((e) => e.id)

beforeEach(() => boot(KEYS))

/* ────────────────────────────── the round trip ────────────────────────────── */

describe('save → projectOf → readProject → restore, through the real store', () => {
  function reviewState(): void {
    st().hide(idsWhere((e) => e.type === 'IfcDoor').slice(0, 5))
    st().setModelColor('STR', MC[3])
    st().toggleGrids()
    st().toggleLevels()
    st().setSec('grid', { name: 'C', offset: 500, cut: true, flip: true })
    st().setUnits('m')
    st().toggleStorey('L2')
    st().addStep('hide', [{ prop: 'IfcEntity', op: '=', val: 'IfcWindow' }])
    st().addStep('isolate', [{ prop: 'Model', op: '=', val: 'ARC' }])
    st().setGroundGrid(true)
    st().setTreeMode('type')
    st().toggleDims()
    cam = { ...CAM, theta: 0.4, target: [7, 8, 9] }
  }

  it('brings back what a project saves, by GlobalId, onto a federation opened in another order', () => {
    reviewState()
    const before = {
      hidden: hiddenGuids(),
      modelColors: { ...st().modelColors },
      nativeMats: st().nativeMats,
      grids: st().grids,
      levels: st().levels,
      sections: st().sections,
      units: st().units,
      storeyVis: { ...st().storeyVis },
      stack: st().stack.map((x) => ({ action: x.action, on: x.on, rules: x.rules })),
      groundGrid: st().groundGrid,
      treeMode: st().treeMode,
      dims: st().dims,
      theme: st().theme
    }
    const { project, dropped } = buildProject(inputs(), '2026-11-07T10:00:00Z', 'SGVue test')
    expect(dropped).toEqual({ elements: 0, cameras: 0, items: 0 })
    const read = readProject(projectText(project))
    if (!read.ok) throw new Error(read.message)
    // The `Model` rule names a model of the file, not a key.
    expect(read.project.visibility.stack[1].rules[0].val).toEqual({ model: 'm1' })

    // Another load order: every element id is different now.
    const order = ['MEP', 'SIT', 'STR', 'ARC']
    boot(order)
    st().setTheme('light')
    const bind = new Map(read.project.models.map((m) => [m.id, m.name.replace(/\.ifc$/, '')]))
    const f = st().federation
    const plan = restorePlanOf(read.project, { models: f.models, elements: f.elements }, { bind, offset: st().offset })
    expect(plan.unmatched).toEqual({})
    applyProjectRestore(plan)

    expect(hiddenGuids()).toEqual(before.hidden)
    expect(st().modelColors).toEqual(before.modelColors)
    expect(st().nativeMats).toBe(before.nativeMats)
    expect([st().grids, st().levels, st().groundGrid, st().dims]).toEqual([
      before.grids,
      before.levels,
      before.groundGrid,
      before.dims
    ])
    expect(st().sections).toEqual(before.sections)
    expect(st().units).toBe('m')
    expect(st().treeMode).toBe('type')
    expect({ ...st().storeyVis }).toEqual(before.storeyVis)
    expect(st().stack.map((x) => ({ action: x.action, on: x.on, rules: x.rules }))).toEqual(before.stack)
    // The camera is put back through the viewer, as a session's is.
    expect(camerasSet.at(-1)).toEqual({ ...CAM, theta: 0.4, target: [7, 8, 9] })
    // Not saved, so not restored: the theme is the viewer's own (D7).
    expect(st().theme).toBe('light')
  })

  it('writes a model the user never coloured as not its own, and restores no colour for it', () => {
    const { project } = buildProject(inputs(), 'now', 'test')
    expect(project.models.map((m) => [m.name, m.own])).toEqual([
      ['ARC.ifc', false],
      ['STR.ifc', false],
      ['SIT.ifc', false],
      ['MEP.ifc', false]
    ])
    // The row's colour is recorded — the grey of the first slot included.
    expect(project.models[0].colour).toBe(rowSwatch('ARC', 0, [], {}))
    const f = st().federation
    const plan = restorePlanOf(project, { models: f.models, elements: f.elements }, {
      bind: new Map(project.models.map((m, i) => [m.id, KEYS[i]]))
    })
    expect({ ...plan.state.modelColors }).toEqual({})
    expect(cutSwatch('ARC', 0, [], plan.state.modelColors)).toBeNull()
  })

  it('renumbers a viewpoint saved before 2026-10-09 before writing it, rather than dropping its elements', () => {
    const doors = idsWhere((e) => e.type === 'IfcDoor' && e.model === 'ARC').slice(0, 3)
    // Slot 0's ids are the same under either stride: the design's own numbering.
    const legacy = {
      id: 1,
      name: 'Old',
      sub: '3D',
      cam: null,
      hidden: Object.fromEntries(doors.map((id) => [id, true])),
      storeyVis: {},
      modelVis: {},
      stack: [],
      active: null,
      grids: true,
      levels: true
    }
    useShell.setState({ views: [legacy] })
    const { project, dropped } = buildProject(inputs(), 'now', 'test')
    expect(dropped.elements).toBe(0)
    expect(project.viewpoints[0].hidden).toHaveLength(3)
  })
})

/* ────────────────────────────── dirty tracking ────────────────────────────── */

describe('projectStateKey — what makes an open project unsaved', () => {
  const key = (): string => projectStateKey(inputs())

  it('never changes for what a project does not save', () => {
    const base = key()
    st().setTheme('light')
    st().select(idsWhere((e) => e.type === 'IfcWall').slice(0, 2))
    st().setSideStoreys({ h: 120, min: 22 })
    st().openCard('filter')
    st().setTool('measure')
    st().setSearch('door')
    st().setChatOpen(true)
    st().toggleModels()
    st().togglePanel()
    st().setVpW(900)
    st().setHint('a hint')
    expect(key()).toBe(base)
  })

  it('changes for every kind of saved state, and comes back when the change is undone', () => {
    const base = key()
    const changes: [string, () => void][] = [
      ['grids', () => st().toggleGrids()],
      ['levels', () => st().toggleLevels()],
      ['snap', () => st().toggleSnap()],
      ['shadows', () => st().setShadows(!st().shadows)],
      ['groundGrid', () => st().setGroundGrid(!st().groundGrid)],
      ['units', () => st().setUnits('ft')],
      ['tree', () => st().setTreeMode('type')],
      ['hide', () => st().hide(idsWhere((e) => e.type === 'IfcDoor').slice(0, 1))],
      ['storey', () => st().toggleStorey('L2')],
      ['model eye', () => st().toggleModel('STR')],
      ['colour', () => st().setModelColor('STR', MC[4])],
      ['section', () => st().setSec('level', { name: 'L2', offset: 1200, cut: true })],
      ['filter', () => st().addStep('hide')],
      ['camera', () => (cam = { ...CAM, dist: 70 })],
      ['assigned', () => useShell.setState({ assignedColors: { MEP: MC[5] } })]
    ]
    for (const [what, change] of changes) {
      boot(KEYS)
      const fresh = key()
      expect(fresh, what).toBe(base)
      change()
      expect(key() === base, what).toBe(false)
    }
    // By value: switched off and on again is the state that was saved.
    boot(KEYS)
    st().toggleGrids()
    st().toggleGrids()
    expect(key()).toBe(base)
    // …and an eye switched off and on reads as one never touched.
    st().toggleStorey('L2')
    st().toggleStorey('L2')
    st().toggleModel('STR')
    st().toggleModel('STR')
    expect(key()).toBe(base)
  })

  it('changes when a model is added or another file stands behind one', () => {
    const base = projectStateKey(inputs())
    expect(projectStateKey(inputs(['ARC', 'STR', 'SIT']))).not.toBe(base)
    const files = filesOf(KEYS).map((f, i) => (i === 0 ? { ...f, sha256: 'f'.repeat(64) } : f))
    expect(projectStateKey({ ...inputs(), files })).not.toBe(base)
  })

  it('reads two equal values alike, however their keys were inserted', () => {
    expect(canonical({ b: 1, a: { d: 2, c: 3 } })).toBe(canonical({ a: { c: 3, d: 2 }, b: 1 }))
    const bare = Object.create(null) as Record<string, boolean>
    bare.__proto__ = true
    expect(canonical(bare)).toBe('{"__proto__":true}')
  })
})

/* ────────────────────────────── D12 ────────────────────────────── */

describe('assignColours — a model added to an open project (D12)', () => {
  const files = filesOf(KEYS)

  it('gives a model the project did not have the colour its neighbours use least, never the grey', () => {
    // ARC on the grey slot, STR overridden to MC[3], SIT on MC[2]: MC[1] is the one unused.
    st().setModelColor('STR', MC[3])
    const next = assignColours(st(), files, new Set(['ARC', 'STR', 'SIT']))
    expect(next).toEqual({ MEP: MC[1] })
    expect(ASSIGN_PALETTE).not.toContain(MC[0])
  })

  it('counts each colour it gives for the next, and leaves the project’s own models alone', () => {
    const next = assignColours(st(), files, new Set(['ARC']))!
    expect(Object.keys(next).sort()).toEqual(['MEP', 'SIT', 'STR'])
    expect(new Set(Object.values(next)).size).toBe(3)
    for (const c of Object.values(next)) expect(ASSIGN_PALETTE).toContain(c)
    expect(assignColours({ ...st(), assignedColors: next }, files, new Set(['ARC']))).toBeNull()
  })

  it('sits under the user’s override, and a model never assigned keeps the accent', () => {
    useShell.setState({ assignedColors: { STR: MC[5] } })
    const rows = (s: ShellState) =>
      modelRows({ ...s, files, assigned: s.assignedColors }).map((r) => [r.key, r.swatch])
    expect(Object.fromEntries(rows(st())).STR).toBe(MC[5])
    st().setModelColor('STR', MC[2])
    expect(Object.fromEntries(rows(st())).STR).toBe(MC[2])
    expect(cutSwatch('ARC', 0, [], {}, undefined, st().assignedColors)).toBeNull()
    expect(cutSwatch('STR', 1, [], {}, undefined, st().assignedColors)).toBe(MC[5])
  })

  it('with nothing assigned — no project open — every row is what it was', () => {
    const plain = modelRows({ ...st(), files })
    expect(modelRows({ ...st(), files, assigned: {} })).toEqual(plain)
  })

  it('drops the colour of a model that is no longer loaded', () => {
    useShell.setState({ assignedColors: { GONE: MC[2] } })
    expect(assignColours(st(), files, new Set(KEYS))).toEqual({})
  })
})

/** A compile-time check that the restore's state type is what the file holds. */
export type _Read = ProjectFile

/* ────────────────────────────── opening: the surfaces ────────────────────────────── */

describe('openProjectMessage — a refusal and missing models, on the existing surfaces', () => {
  it('a refused project goes to the landing page’s banner, and after boot to the error row', async () => {
    resetShell()
    await openProjectMessage({ ok: false, name: 'review', message: 'This project file is damaged: it is not valid JSON.' })
    expect(st().initErr).toBe('This project file is damaged: it is not valid JSON.')
    boot(KEYS)
    await openProjectMessage({ ok: false, name: 'review', message: 'nope' })
    expect(st().uploads.map((u) => [u.name, u.stage, u.error])).toEqual([['review.sgvue', 'nope', true]])
    expect(st().loaded).toEqual([...KEYS])
  })

  it('a project none of whose models could be found replaces what was open and names each', async () => {
    const { project } = buildProject(inputs(), 'now', 'test')
    await openProjectMessage({
      ok: true,
      name: 'review',
      text: projectText(project),
      models: project.models.map((m) => ({ id: m.id, file: null, refused: null }))
    })
    expect(st().loaded).toEqual([])
    expect(st().booted).toBe(false)
    expect(st().initErr).toBe("None of this project's models could be opened: ARC.ifc, STR.ifc, SIT.ifc, MEP.ifc.")
    expect(st().uploads.map((u) => [u.name, u.stage])).toEqual(
      KEYS.map((k) => [`${k}.ifc`, MODEL_MISSING])
    )
  })
})

/* ────────────────────────────── a missing model survives a save ────────────────────────────── */

describe('a project opened with a model missing keeps that model, and every reference to it, on save', () => {
  it('writes the missing model and its references back byte for byte, whatever else changed', () => {
    // The original review, saved with both models open: STR coloured, its eye off, two of its
    // elements hidden, a `Model` rule naming it, and a viewpoint hiding one of its elements.
    boot(['ARC', 'STR'])
    const strIds = idsWhere((e) => e.model === 'STR')
    st().hide([...strIds.slice(0, 2), ...idsWhere((e) => e.model === 'ARC').slice(0, 1)])
    st().setModelColor('STR', MC[3])
    st().toggleModel('STR')
    st().addStep('hide', [{ prop: 'Model', op: '=', val: 'STR' }])
    useShell.setState({
      views: [
        {
          id: 7,
          name: 'Cores',
          sub: '3D',
          cam: null,
          hidden: { [strIds[2]]: true },
          storeyVis: {},
          modelVis: { STR: false },
          stack: [],
          active: null,
          grids: true,
          levels: true,
          frame: 'identity',
          idStride: 1_000_000_000
        }
      ]
    })
    const original = readOrThrow(projectText(buildProject(inputs(['ARC', 'STR']), 'then', 'test').project))
    const m2 = original.models.find((m) => m.name === 'STR.ifc')!
    expect(m2.id).toBe('m2')

    // Opened again with STR missing: only ARC loads, and the restore leaves STR out.
    boot(['ARC'])
    const f = st().federation
    const plan = restorePlanOf(original, { models: f.models, elements: f.elements }, {
      bind: new Map([['m1', 'ARC']]),
      offset: st().offset
    })
    expect(plan.missing).toEqual(['m2'])
    applyProjectRestore(plan)
    // Viewpoints are restored in phase 3; the same list stands in for the one the user has.
    useShell.setState({ views: plan.state.views })
    const carried: Carried = { file: original, ids: plan.missing }

    // Something else changes, and the project is saved.
    st().toggleGrids()
    st().hide(idsWhere((e) => e.model === 'ARC').slice(1, 3))
    const saved = readOrThrow(projectText(buildProject(inputs(['ARC']), 'now', 'test', carried).project))

    const ofM2 = (refs: readonly (readonly [string, string])[]) => JSON.stringify(refs.filter(([m]) => m === 'm2'))
    expect(JSON.stringify(saved.models.find((m) => m.id === 'm2'))).toBe(JSON.stringify(m2))
    expect(ofM2(saved.visibility.hidden)).toBe(ofM2(original.visibility.hidden))
    expect(JSON.parse(ofM2(original.visibility.hidden))).toHaveLength(2)
    expect(ofM2(saved.viewpoints[0].hidden)).toBe(ofM2(original.viewpoints[0].hidden))
    expect(saved.viewpoints[0].modelVis.m2).toBe(false)
    expect(JSON.stringify(saved.visibility.stack.map((x) => x.rules))).toContain('{"model":"m2"}')
    // The open model is written as it now stands.
    expect(saved.view.grids).toBe(!original.view.grids)
    expect(saved.models.map((m) => m.id)).toEqual(['m1', 'm2'])
    // Without the carried models, the same save would have lost them: what this guards against.
    expect(buildProject(inputs(['ARC']), 'now', 'test').project.models.map((m) => m.id)).toEqual(['m1'])
  })
})

/* ────────────────────────────── D12 survives a reopen ────────────────────────────── */

describe('an assigned colour is written as assigned and comes back as one', () => {
  it('own → modelColors, assigned → assignedColors, the rest → nothing', () => {
    useShell.setState({ assignedColors: { SIT: MC[4], STR: MC[6] } })
    st().setModelColor('STR', MC[2])
    const { project } = buildProject(inputs(), 'now', 'test')
    expect(project.models.map((m) => [m.name, m.own, m.assigned ?? false])).toEqual([
      ['ARC.ifc', false, false],
      ['STR.ifc', true, false],
      ['SIT.ifc', false, true],
      ['MEP.ifc', false, false]
    ])
    boot(KEYS)
    const f = st().federation
    const read = readOrThrow(projectText(project))
    const plan = restorePlanOf(read, { models: f.models, elements: f.elements }, {
      bind: new Map(read.models.map((m, i) => [m.id, KEYS[i]]))
    })
    applyProjectRestore(plan)
    expect({ ...st().modelColors }).toEqual({ STR: MC[2] })
    expect(st().assignedColors).toEqual({ SIT: MC[4] })
    expect(Object.fromEntries(modelRows({ ...st(), files: filesOf(KEYS), assigned: st().assignedColors }).map((r) => [r.key, r.swatch])).SIT).toBe(MC[4])
  })
})

function readOrThrow(text: string): ProjectFile {
  const r = readProject(text)
  if (!r.ok) throw new Error(r.message)
  return r.project
}

/* ────────────────────────────── a load that cannot get stuck ────────────────────────────── */

describe('a project never stays "loading"', () => {
  const closed = vi.fn(async () => undefined)
  let uninstall: () => void = () => undefined
  beforeEach(() => {
    closed.mockClear()
    vi.stubGlobal('__APP_VERSION__', '0.0.0-test')
    // The bridge, as far as the project's half uses it.
    vi.stubGlobal('window', {
      sgvue: {
        projectReady: async () => undefined,
        closeProject: closed,
        setProjectDirty: async () => undefined,
        onProjectSnapshotRequest: () => () => undefined,
        onProjectOpened: () => () => undefined,
        onProjectSaved: () => () => undefined
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    })
    uninstall = installProject()
  })
  afterEach(() => {
    uninstall()
    closeProject()
    disposeUploads()
    vi.unstubAllGlobals()
  })

  /** A project whose one model main admitted: its models start to load, and it is "loading". */
  async function loading(): Promise<ProjectFile> {
    const { project } = buildProject(inputs(['ARC']), 'now', 'test')
    const file = readOrThrow(projectText(project))
    const m = file.models[0]
    await openProjectMessage({
      ok: true,
      name: 'review',
      text: projectText(project),
      models: [{ id: m.id, file: { path: '/projects/synthetic/review/models/ARC.ifc', name: 'ARC.ifc', size: m.size }, refused: null }]
    })
    expect(projectStatus()).toEqual({ open: true, loading: true })
    return file
  }

  it('a restore that throws still ends the load, so Save and dirty work again', async () => {
    const file = await loading()
    expect(snapshotFor(1).reason).toBe('loading')
    const broken = { ...file, models: null } as unknown as ProjectFile
    await expect(restore(broken, new Map())).rejects.toThrow()
    expect(projectStatus()).toEqual({ open: true, loading: false })
    // No model is open now: a Save answers why, instead of "loading" for ever.
    expect(snapshotFor(2)).toMatchObject({ text: null, reason: 'no-models' })
  })

  it('a pick on the landing page while the project loads closes the project, and main hears of it', async () => {
    await loading()
    useShell.setState({ assignedColors: { ARC: MC[2] } })
    await showRefused([{ name: 'other.ifc', reason: TOO_LARGE }])
    expect(projectStatus()).toEqual({ open: false, loading: false })
    expect(closed).toHaveBeenCalledTimes(1)
    expect(st().assignedColors).toEqual({})
    // The project's own load does not close it: it was open, and loading, right after its begin.
  })

  it('the project’s own fresh start leaves it open', async () => {
    await loading()
    expect(closed).not.toHaveBeenCalled()
  })

  it('a project none of whose models could be opened stays open, names them, and keeps them for the next save', async () => {
    // A moved folder (D4): main admitted none of the three.
    boot(['ARC', 'STR', 'SIT'])
    st().hide(idsWhere((e) => e.model === 'STR').slice(0, 2))
    st().setModelColor('SIT', MC[4])
    const { project } = buildProject(inputs(['ARC', 'STR', 'SIT']), 'then', 'test')
    const original = readOrThrow(projectText(project))
    resetShell()
    await openProjectMessage({
      ok: true,
      name: 'review',
      text: projectText(project),
      models: original.models.map((m) => ({ id: m.id, file: null, refused: null }))
    })
    expect(projectStatus()).toEqual({ open: true, loading: false })
    expect(closed).not.toHaveBeenCalled()
    expect(st().initErr).toBe("None of this project's models could be opened: ARC.ifc, STR.ifc, SIT.ifc.")
    // The next save — once a model is open to save beside them — carries all three as the file had them.
    const kept = projectCarried()
    expect(kept?.ids).toEqual(['m1', 'm2', 'm3'])
    boot(['MEP'])
    const saved = readOrThrow(projectText(buildProject(inputs(['MEP']), 'now', 'test', kept).project))
    for (const m of original.models) {
      expect(JSON.stringify(saved.models.find((x) => x.id === m.id))).toBe(JSON.stringify(m))
    }
    const refs = (p: ProjectFile) => JSON.stringify(p.visibility.hidden.filter(([id]) => id !== 'm4'))
    expect(refs(saved)).toBe(refs(original))
    expect(saved.models.map((m) => m.id)).toEqual(['m4', 'm1', 'm2', 'm3'])
  })

  it('answers why there is nothing to save: no model open, none with a file', () => {
    resetShell()
    expect(snapshotFor(3)).toEqual({ n: 3, text: null, suggestedName: '', reason: 'no-models' })
    boot(KEYS)
    // The store holds the mock's models, and no file stands behind any of them: the demo's case.
    expect(snapshotFor(4)).toMatchObject({ text: null, reason: 'no-files' })
  })
})

/* ────────── a loaded model the project did not bind, under a carried model's key ────────── */

describe('a carried model and an unbound loaded model of the same key: nothing is merged by key', () => {
  /** Another file named STR.ifc, elsewhere on disk: same model key, a different file. */
  const OTHER_STR: ProjectFileInfo = {
    key: 'STR',
    path: '/projects/synthetic/review/other/STR.ifc',
    name: 'STR.ifc',
    sha256: 'f'.repeat(64),
    size: 2000,
    slot: 1
  }

  /**
   * The setup of the "STR missing" case above: saved with ARC and STR open (STR coloured, its eye
   * off, two of its elements hidden, a `Model` rule naming it, a viewpoint hiding one of its
   * elements and its eye), then reopened with STR (m2) missing. `live` is what is loaded at the
   * reopen; only ARC is bound to the project.
   */
  function openedWithStrMissing(live: readonly string[]): { original: ProjectFile; m2: ProjectFile['models'][number]; carried: Carried } {
    boot(['ARC', 'STR'])
    const strIds = idsWhere((e) => e.model === 'STR')
    st().hide([...strIds.slice(0, 2), ...idsWhere((e) => e.model === 'ARC').slice(0, 1)])
    st().setModelColor('STR', MC[3])
    st().toggleModel('STR')
    st().addStep('hide', [{ prop: 'Model', op: '=', val: 'STR' }])
    useShell.setState({
      views: [
        {
          id: 7,
          name: 'Cores',
          sub: '3D',
          cam: null,
          hidden: { [strIds[2]]: true },
          storeyVis: {},
          modelVis: { STR: false },
          stack: [],
          active: null,
          grids: true,
          levels: true,
          frame: 'identity',
          idStride: 1_000_000_000
        }
      ]
    })
    const original = readOrThrow(projectText(buildProject(inputs(['ARC', 'STR']), 'then', 'test').project))
    const m2 = original.models.find((m) => m.name === 'STR.ifc')!
    expect(m2.id).toBe('m2')

    boot(live)
    const f = st().federation
    const plan = restorePlanOf(original, { models: f.models, elements: f.elements }, {
      bind: new Map([['m1', 'ARC']]),
      offset: st().offset
    })
    expect(plan.missing).toEqual(['m2'])
    applyProjectRestore(plan)
    useShell.setState({ views: plan.state.views })
    return { original, m2, carried: { file: original, ids: plan.missing } }
  }

  const ofId = (refs: readonly (readonly [string, string])[], id: string): string => JSON.stringify(refs.filter(([m]) => m === id))
  const arcOnlyIds = (): Map<string, string> => new Map([['ARC', 'm1']])

  it('a. the other STR.ifc, opened as an ordinary pick, is saved as a model of its own; m2 and its references are written as the file had them', () => {
    const { original, m2, carried } = openedWithStrMissing(['ARC', 'STR'])
    // One of the other file's elements hidden on screen.
    const otherEl = st().byId.get(idsWhere((e) => e.model === 'STR')[5])!
    st().hide([otherEl.id])

    const i: SnapshotInputs = { ...inputs(['ARC']), files: [...filesOf(['ARC']), OTHER_STR], ids: arcOnlyIds() }
    const text = projectText(buildProject(i, 'now', 'test', carried).project)
    const saved = readOrThrow(text)

    expect.soft(JSON.stringify(saved.models.find((m) => m.id === 'm2')), 'm2 written exactly as the opened file had it').toBe(JSON.stringify(m2))
    expect.soft(ofId(saved.visibility.hidden, 'm2'), 'm2’s hidden references').toBe(ofId(original.visibility.hidden, 'm2'))
    expect.soft(ofId(saved.viewpoints[0]?.hidden ?? [], 'm2'), 'm2’s references in the viewpoint').toBe(ofId(original.viewpoints[0].hidden, 'm2'))
    expect.soft(saved.viewpoints[0]?.modelVis.m2, 'm2’s eye in the viewpoint').toBe(original.viewpoints[0].modelVis.m2)
    const others = saved.models.filter((m) => m.name === 'STR.ifc' && m.id !== 'm2')
    expect.soft(others.map((m) => [m.absPath, m.sha256]), 'the other STR.ifc, one model of its own').toEqual([[OTHER_STR.path, OTHER_STR.sha256]])
    const otherId = others[0]?.id
    expect.soft(otherId, 'the other STR.ifc’s id').not.toBe('m2')
    expect.soft(
      saved.visibility.hidden.filter(([, g]) => g === otherEl.guid).map(([m]) => m),
      'the element hidden on screen, written under the other file’s id'
    ).toContain(otherId)
    expect.soft(ofId(saved.visibility.hidden, 'm2'), 'nothing of the other file written under m2').not.toContain(`"${otherEl.guid}"`)
    const ids = saved.models.map((m) => m.id)
    expect.soft(new Set(ids).size, `model ids unique: ${ids.join(', ')}`).toBe(ids.length)
  })

  it('b. guard — the loaded STR is the project’s m2 (bound): one m2, the live file’s path, no duplicate', () => {
    const { original } = openedWithStrMissing(['ARC', 'STR'])
    const carried: Carried = { file: original, ids: [] }
    const i: SnapshotInputs = { ...inputs(['ARC']), files: [...filesOf(['ARC']), OTHER_STR], ids: new Map([['ARC', 'm1'], ['STR', 'm2']]) }
    const saved = readOrThrow(projectText(buildProject(i, 'now', 'test', carried).project))
    expect(saved.models.filter((m) => m.name === 'STR.ifc').map((m) => [m.id, m.absPath])).toEqual([['m2', OTHER_STR.path]])
    expect(saved.models.map((m) => m.id)).toEqual(['m1', 'm2'])
  })

  it('c. guard — m2 still carried while the loaded STR is bound to m2: m2 written once, ids unique', () => {
    const { original } = openedWithStrMissing(['ARC', 'STR'])
    const carried: Carried = { file: original, ids: ['m2'] }
    const i: SnapshotInputs = { ...inputs(['ARC']), files: [...filesOf(['ARC']), OTHER_STR], ids: new Map([['ARC', 'm1'], ['STR', 'm2']]) }
    const saved = readOrThrow(projectText(buildProject(i, 'now', 'test', carried).project))
    const ids = saved.models.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.filter((id) => id === 'm2')).toHaveLength(1)
  })

  it('d. guard — with no key collision, a save is byte for byte the composition the writer makes today', () => {
    const { original, carried } = openedWithStrMissing(['ARC'])
    st().toggleGrids()
    st().hide(idsWhere((e) => e.model === 'ARC').slice(1, 3))
    const i = inputs(['ARC'])
    const built = projectText(buildProject(i, 'now', 'test', carried).project)
    // Written out by hand from the shared functions: m2 carried by its key, then carried forward.
    const ctx = { ...projectContextOf(i.state, i.files, 'now', 'test', i.ids), carried: [{ id: 'm2', key: 'STR' }] }
    const hand = carryForward(projectOf(projectSourceOf(i), ctx).project, original, ['m2'], carried.views)
    expect(built).toBe(projectText(hand))
  })
})
