/**
 * The `.sgvue` project file, phase 4 (plan D3 and D4) — changed and missing models, through the
 * real store, the real federation controller and the real `model/project.ts`:
 *
 *   · **D3, a changed model** (another SHA-256 or size): opened anyway, its references put back by
 *     GlobalId, its designed error row saying once that it changed and how many saved items no
 *     longer matched; the project unsaved; the next save writes the new hash and size, same id.
 *   · **D4, Locate…**: a missing model's row offers it; the pick — main's Open dialog and
 *     `admit()`, stubbed here — loads into the open project as that model: the same id, its
 *     references restored, out of `carried`, the project unsaved; the next save writes the new
 *     path, hash and size and no second entry. A changed pick is D3; a cancel or a refusal changes
 *     nothing; with every model missing, the first one located boots the viewer, project open.
 *   · With no project open, nothing of this runs.
 *
 * The upload pipeline's two loads are the one seam replaced, as in phase 3's tests: Node has no
 * worker, so the files join as the design's mock models through the real `addBatch`, and the
 * restore runs as the pipeline runs it once they have. The pipeline's own half of Locate… is
 * `project-locate-pipeline.test.ts`.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MC } from '../../src/shared/colors'
import { THIN_SPACE } from '../../src/shared/fmt'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { federation, type BatchItem } from '../../src/renderer/model/federation-store'
import {
  buildProject,
  changedText,
  closeProject,
  installProject,
  LOCATE_ALREADY_OPEN,
  locateModel,
  MODEL_MISSING,
  openProjectMessage,
  projectCarried,
  projectStatus,
  snapshotFor
} from '../../src/renderer/model/project'
import { useShell, type ShellState } from '../../src/renderer/state/shell'
import { projectText, readProject, type ProjectFile, type ProjectRef } from '../../src/shared/project-file'
import type { PickedFile, ProjectLocated, ProjectModelFile, ProjectSnapshot } from '../../src/shared/ipc-contract'
import { TOO_LARGE } from '../../src/shared/upload'
import { memoryStorage, resetShell, stubViewer } from './stub-viewer'

/* ── the seam: both loads join as mock models, then run their restore ── */
const seam = vi.hoisted(() => ({
  /** The SHA-256 the next located file parses to, by key; else its usual one. */
  locatedSha: {} as Record<string, string>,
  /** Run between the project's own models joining and their restore — the join's hold. */
  duringHold: null as null | (() => Promise<void>),
  /** The located file is still parsing: it never joins. */
  hang: false,
  located: [] as { file: { path: string; name: string; size: number }; as: { key: string; name: string } }[]
}))
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
      await federation.addBatch(after.order.map((p) => itemOf(/([^/]+)\.ifc$/.exec(p)![1])))
      await seam.duringHold?.()
      await after.then()
      return true
    },
    locateFile: async (
      file: { path: string; name: string; size: number },
      as: { key: string; name: string },
      after: { then: () => Promise<void> }
    ): Promise<boolean> => {
      seam.located.push({ file, as })
      if (seam.hang) return true
      const item = itemOf(as.key)
      item.file = { ...item.file!, path: file.path, name: file.name, size: file.size, sha256: seam.locatedSha[as.key] ?? shaOf(as.key) }
      await federation.addBatch([item])
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
const OTHER_SHA = 'f'.repeat(64)
const sizeOf = (key: string): number => 1000 + key.length
const itemOf = (key: string): BatchItem => ({
  index: mockModelIndex(key),
  chunks: [],
  offset: OFFSET,
  file: { key, path: pathOf(key), name: `${key}.ifc`, sha256: shaOf(key), size: sizeOf(key), slot: 0 }
})

const viewer = stubViewer({
  getCamera: () => ({ theta: -0.8, phi: 1.05, dist: 60, half: 12, target: [3, 4, 5], proj: 'persp' }),
  debug: () => ({}),
  elementIds: () => [],
  placeSpot: () => undefined,
  placeMeasure: () => false
})

/* ── the bridge ── */
const dirtyCalls: boolean[] = []
const closed = vi.fn(async () => undefined)
let savedCb: ((m: { n: number }) => void) | null = null
let locateAnswer: ProjectLocated | null = null
const locateCalls: string[] = []

beforeAll(() => {
  vi.stubGlobal('__APP_VERSION__', '0.0.0-test')
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('window', {
    sgvue: {
      closeProject: closed,
      setProjectDirty: async (d: boolean) => void dirtyCalls.push(d),
      onProjectSnapshotRequest: () => () => undefined,
      onProjectOpened: () => () => undefined,
      onProjectSaved: (fn: (m: { n: number }) => void) => {
        savedCb = fn
        return () => undefined
      },
      locateProjectModel: async (name: string) => {
        locateCalls.push(name)
        return locateAnswer
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
  dirtyCalls.length = 0
  locateCalls.length = 0
  seam.located.length = 0
  seam.locatedSha = {}
  seam.duringHold = null
  seam.hang = false
  locateAnswer = null
  closed.mockClear()
  uninstall = installProject()
  federation.resetUnshown()
  await federation.addBatch(KEYS.map(itemOf))
})
afterEach(() => {
  uninstall()
  closeProject()
  vi.restoreAllMocks()
})

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
/** The last dirty flag main heard, once the 250 ms debounce has run. */
async function dirty(want: boolean): Promise<void> {
  await sleep(300)
  await vi.waitFor(() => expect(dirtyCalls.at(-1)).toBe(want), { timeout: 3000, interval: 50 })
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

/** File › Open Project…, every model admitted at its usual path unless named missing. */
async function open(file: ProjectFile, missing: readonly string[] = []): Promise<void> {
  const models: ProjectModelFile[] = file.models.map((m) => ({
    id: m.id,
    file: missing.includes(m.name) ? null : { path: pathOf(m.name.replace(/\.ifc$/, '')), name: m.name, size: m.size },
    refused: null
  }))
  await openProjectMessage({ ok: true, name: 'review', text: projectText(file), models })
  expect(projectStatus()).toEqual({ open: true, loading: false })
}

const idsOf = (key: string, n: number, from = 0): number[] =>
  st()
    .federation.elements.filter((e) => e.model === key && e.guid)
    .slice(from, from + n)
    .map((e) => e.id)
/** The hidden elements of `key`, by GlobalId. */
const hiddenGuids = (key: string, hidden: Record<string, boolean> = st().hidden): string[] =>
  Object.keys(hidden)
    .map((id) => st().byId.get(Number(id)))
    .filter((e) => e?.model === key)
    .map((e) => e!.guid)
    .sort()
const refsOf = (refs: readonly ProjectRef[], id: string): string => JSON.stringify(refs.filter(([m]) => m === id))
const rows = (): [string, string, string | undefined][] => st().uploads.map((u) => [u.name, u.stage, u.locate])

/**
 * The review this file's tests start from, saved with both models open: two ARC and two STR
 * elements hidden, STR coloured by the user, and a viewpoint hiding a third STR element.
 */
async function original(): Promise<ProjectFile> {
  st().hide([...idsOf('STR', 1, 2)])
  st().saveView()
  st().showAll()
  st().hide([...idsOf('ARC', 2), ...idsOf('STR', 2)])
  st().setModelColor('STR', MC[3])
  st().setUnits('m')
  const file = save().file
  closeProject()
  st().setUnits('mm')
  expect(file.models.map((m) => [m.id, m.name])).toEqual([
    ['m1', 'ARC.ifc'],
    ['m2', 'STR.ifc']
  ])
  expect(JSON.parse(refsOf(file.visibility.hidden, 'm2'))).toHaveLength(2)
  expect(JSON.parse(refsOf(file.viewpoints[0].hidden, 'm2'))).toHaveLength(1)
  return file
}

/** `file` with saved references that name nothing in `id`'s model: `hidden` in the view, `views` in the viewpoint. */
function withGone(file: ProjectFile, id: string, hidden: number, views: number): ProjectFile {
  const gone = (n: number, tag: string): ProjectRef[] => Array.from({ length: n }, (_, i) => [id, `GONE-${tag}-${i}`])
  return {
    ...file,
    visibility: { ...file.visibility, hidden: [...file.visibility.hidden, ...gone(hidden, 'h')] },
    viewpoints: file.viewpoints.map((v, i) => (i === 0 ? { ...v, hidden: [...v.hidden, ...gone(views, 'v')] } : v))
  }
}

/* ────────────────────────────── D3 ────────────────────────────── */

describe('D3 — a model whose file changed since the project was saved', () => {
  it('opens anyway, restores by GlobalId, says once how many saved items no longer match, and is unsaved until the new hash is written', async () => {
    const file = await original()
    const strHidden = hiddenGuids('STR')
    st().showAll()
    // STR's bytes changed: another digest and size in the file than the one it now parses to,
    // and three of the saved references to it name GlobalIds the new file does not have.
    const stale = withGone(file, 'm2', 2, 1)
    const changed: ProjectFile = {
      ...stale,
      models: stale.models.map((m) => (m.id === 'm2' ? { ...m, sha256: OTHER_SHA, size: 999 } : m))
    }
    await open(changed)

    expect(st().loaded).toEqual(['ARC', 'STR'])
    expect(hiddenGuids('STR')).toEqual(strHidden)
    expect({ ...st().modelColors }).toEqual({ STR: MC[3] })
    expect(rows()).toEqual([['STR.ifc', 'changed since the project was saved — 3 saved items no longer match', undefined]])
    expect(projectCarried()?.ids).toEqual([])
    await dirty(true)

    const saved = save().file
    const str = saved.models.find((m) => m.id === 'm2')!
    expect([str.name, str.sha256, str.size]).toEqual(['STR.ifc', shaOf('STR'), sizeOf('STR')])
    expect(saved.models.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(refsOf(saved.visibility.hidden, 'm2')).toBe(refsOf(file.visibility.hidden, 'm2'))
    await dirty(false)
  })

  it('words the count for none, one and many', () => {
    expect(changedText(0)).toBe('changed since the project was saved')
    expect(changedText(1)).toBe('changed since the project was saved — 1 saved item no longer matches')
    expect(changedText(12345)).toBe(`changed since the project was saved — 12${THIN_SPACE}345 saved items no longer match`)
  })

  it('a model that did not change opens with no row and the project saved', async () => {
    const file = await original()
    await open(file)
    expect(rows()).toEqual([])
    await dirty(false)
  })
})

/* ────────────────────────────── D4 ────────────────────────────── */

const MOVED: PickedFile = { path: '/projects/synthetic/elsewhere/STR moved.ifc', name: 'STR moved.ifc', size: sizeOf('STR') }

describe('D4 — Locate… binds a missing model as the same model', () => {
  it('restores its references by GlobalId, takes it out of carried, and the next save writes the new path and hash under the same id, once', async () => {
    const file = await original()
    const strHidden = hiddenGuids('STR')
    await open(file, ['STR.ifc'])
    expect(st().loaded).toEqual(['ARC'])
    expect(rows()).toEqual([['STR.ifc', MODEL_MISSING, 'm2']])
    expect(projectCarried()?.ids).toEqual(['m2'])
    await dirty(false)
    const vpId = st().views[0].id

    locateAnswer = { file: MOVED, refused: null }
    await locateModel('m2')

    expect(locateCalls).toEqual(['STR.ifc'])
    expect(seam.located.map((l) => [l.file.path, l.as])).toEqual([[MOVED.path, { key: 'STR', name: 'STR.ifc' }]])
    expect(st().loaded).toEqual(['ARC', 'STR'])
    expect(hiddenGuids('STR')).toEqual(strHidden)
    expect(hiddenGuids('STR', st().views.find((v) => v.id === vpId)!.hidden)).toHaveLength(1)
    expect({ ...st().modelColors }).toEqual({ STR: MC[3] })
    // A model of the project's own, not a newcomer: no D12 colour.
    expect(st().assignedColors).toEqual({})
    expect(projectCarried()?.ids).toEqual([])
    expect(rows()).toEqual([])
    await dirty(true)

    const saved = save().file
    expect(saved.models.map((m) => m.id)).toEqual(['m1', 'm2'])
    const str = saved.models.find((m) => m.id === 'm2')!
    expect([str.absPath, str.name, str.sha256, str.size, str.own]).toEqual([MOVED.path, MOVED.name, shaOf('STR'), MOVED.size, true])
    expect(refsOf(saved.visibility.hidden, 'm2')).toBe(refsOf(file.visibility.hidden, 'm2'))
    expect(refsOf(saved.viewpoints[0].hidden, 'm2')).toBe(refsOf(file.viewpoints[0].hidden, 'm2'))
    await dirty(false)
  })

  it('the first model located after the second keeps its id: neither model takes the other’s', async () => {
    const file = await original()
    await open(file, ['ARC.ifc'])
    locateAnswer = { file: { path: '/projects/synthetic/elsewhere/ARC.ifc', name: 'ARC.ifc', size: sizeOf('ARC') }, refused: null }
    await locateModel('m1')
    // ARC joined after STR, so it has the later slot — and still its own id.
    expect(st().loaded).toEqual(['STR', 'ARC'])
    const saved = save().file
    expect(saved.models.map((m) => [m.id, m.name]).sort()).toEqual([
      ['m1', 'ARC.ifc'],
      ['m2', 'STR.ifc']
    ])
    expect(refsOf(saved.visibility.hidden, 'm1')).toBe(refsOf(file.visibility.hidden, 'm1'))
    expect(refsOf(saved.visibility.hidden, 'm2')).toBe(refsOf(file.visibility.hidden, 'm2'))
  })

  it('a pick that joins during the project’s own join hold — its restore first — is bound with the rest, and the next save keeps its references', async () => {
    const file = await original()
    const strHidden = hiddenGuids('STR')
    // The pick lands after the project's models have joined and before their restore has run: the
    // located batch's restore runs first, the project's after it.
    seam.duringHold = async () => {
      seam.duringHold = null
      expect(projectStatus()).toEqual({ open: true, loading: true })
      locateAnswer = { file: MOVED, refused: null }
      await locateModel('m2')
    }
    await open(file, ['STR.ifc'])
    expect(seam.located).toHaveLength(1)
    expect(st().loaded).toEqual(['ARC', 'STR'])
    expect(hiddenGuids('STR')).toEqual(strHidden)
    expect(projectCarried()?.ids).toEqual([])
    expect(rows()).toEqual([])
    await dirty(true)
    const saved = save().file
    expect(saved.models.map((m) => [m.id, m.absPath])).toEqual([
      ['m1', pathOf('ARC')],
      ['m2', MOVED.path]
    ])
    expect(refsOf(saved.visibility.hidden, 'm2')).toBe(refsOf(file.visibility.hidden, 'm2'))
    expect(refsOf(saved.viewpoints[0].hidden, 'm2')).toBe(refsOf(file.viewpoints[0].hidden, 'm2'))
  })

  it('a pick that is already open, or already being located, loads nothing: the row says why and Locate… stays', async () => {
    const file = await original()
    await open(file, ['STR.ifc'])
    // ARC.ifc is one of the open models.
    locateAnswer = { file: { path: pathOf('ARC'), name: 'ARC.ifc', size: sizeOf('ARC') }, refused: null }
    await locateModel('m2')
    expect(seam.located).toEqual([])
    expect(rows()).toEqual([
      ['STR.ifc', MODEL_MISSING, 'm2'],
      ['ARC.ifc', LOCATE_ALREADY_OPEN, undefined]
    ])
    expect(projectCarried()?.ids).toEqual(['m2'])
    expect(st().loaded).toEqual(['ARC'])
    await dirty(false)

    // A file still loading for this model is not loaded a second time.
    seam.hang = true
    locateAnswer = { file: MOVED, refused: null }
    await locateModel('m2')
    await locateModel('m2')
    expect(seam.located).toHaveLength(1)
    expect(rows().at(-1)).toEqual([MOVED.name, LOCATE_ALREADY_OPEN, undefined])
  })

  it('a located file whose bytes changed is a changed model (D3): its row says what no longer matched', async () => {
    const file = withGone(await original(), 'm2', 1, 1)
    await open(file, ['STR.ifc'])
    seam.locatedSha.STR = OTHER_SHA
    locateAnswer = { file: MOVED, refused: null }
    await locateModel('m2')
    expect(st().loaded).toEqual(['ARC', 'STR'])
    expect(rows()).toEqual([['STR.ifc', 'changed since the project was saved — 2 saved items no longer match', undefined]])
    expect(projectCarried()?.ids).toEqual([])
    await dirty(true)
    expect(save().file.models.find((m) => m.id === 'm2')!.sha256).toBe(OTHER_SHA)
  })

  it('cancelled: nothing changes — the row stays, nothing loads, the project is still saved', async () => {
    const file = await original()
    await open(file, ['STR.ifc'])
    locateAnswer = null
    await locateModel('m2')
    expect(locateCalls).toEqual(['STR.ifc'])
    expect(seam.located).toEqual([])
    expect(rows()).toEqual([['STR.ifc', MODEL_MISSING, 'm2']])
    expect(projectCarried()?.ids).toEqual(['m2'])
    await dirty(false)
  })

  it('a pick admit() refuses gets the designed error row with its reason, and the model stays missing', async () => {
    const file = await original()
    await open(file, ['STR.ifc'])
    locateAnswer = { file: null, refused: { name: 'STR huge.ifc', reason: TOO_LARGE } }
    await locateModel('m2')
    expect(seam.located).toEqual([])
    expect(rows()).toEqual([
      ['STR.ifc', MODEL_MISSING, 'm2'],
      ['STR huge.ifc', TOO_LARGE, undefined]
    ])
    expect(projectCarried()?.ids).toEqual(['m2'])
    // Refused for no reason the drop zone gives: nothing at all.
    locateAnswer = { file: null, refused: null }
    await locateModel('m2')
    expect(rows()).toHaveLength(2)
    await dirty(false)
  })

  it('every model missing: the banner names them, each row offers Locate…, and the first located boots the viewer with the project open', async () => {
    const file = await original()
    const arcHidden = hiddenGuids('ARC')
    await open(file, ['ARC.ifc', 'STR.ifc'])
    closed.mockClear()
    expect(st().booted).toBe(false)
    expect(st().initErr).toBe("None of this project's models could be opened: ARC.ifc, STR.ifc.")
    expect(rows()).toEqual([
      ['ARC.ifc', MODEL_MISSING, 'm1'],
      ['STR.ifc', MODEL_MISSING, 'm2']
    ])

    locateAnswer = { file: { path: '/projects/synthetic/elsewhere/ARC.ifc', name: 'ARC.ifc', size: sizeOf('ARC') }, refused: null }
    await locateModel('m1')
    expect(st().booted).toBe(true)
    expect(st().loaded).toEqual(['ARC'])
    expect(projectStatus()).toEqual({ open: true, loading: false })
    expect(closed).not.toHaveBeenCalled()
    // The whole project, restored onto it: ARC's hidden elements and the project's viewpoint.
    expect(hiddenGuids('ARC')).toEqual(arcHidden)
    expect(st().views.map((v) => v.name)).toEqual(file.viewpoints.map((v) => v.name))
    expect(st().units).toBe('m')
    expect(rows()).toEqual([['STR.ifc', MODEL_MISSING, 'm2']])
    expect(projectCarried()?.ids).toEqual(['m2'])
    await dirty(true)

    const saved = save().file
    expect(saved.models.map((m) => [m.id, m.absPath])).toEqual([
      ['m1', '/projects/synthetic/elsewhere/ARC.ifc'],
      ['m2', pathOf('STR')]
    ])
    expect(refsOf(saved.visibility.hidden, 'm2')).toBe(refsOf(file.visibility.hidden, 'm2'))
  })
})

/* ────────────────────────────── ids, and no project ────────────────────────────── */

describe('a model keeps its id in the project', () => {
  it('the writer keeps an id it is given, and gives the next free one to a model with none, a repeated one or an invalid one', () => {
    const files = KEYS.map((key, slot) => ({ key, path: pathOf(key), name: `${key}.ifc`, sha256: shaOf(key), size: sizeOf(key), slot }))
    const inputs = (ids?: Map<string, string>) => ({ state: st(), cam: null, files, schedules: [], openSchedule: null, ids })
    const idsOf = (ids?: Map<string, string>): string[] => buildProject(inputs(ids), 'now', 'test').project.models.map((m) => m.id)
    expect(idsOf()).toEqual(['m1', 'm2'])
    expect(idsOf(new Map([['ARC', 'm7']]))).toEqual(['m7', 'm1'])
    expect(idsOf(new Map([['ARC', 'm2'], ['STR', 'm1']]))).toEqual(['m2', 'm1'])
    expect(idsOf(new Map([['ARC', 'm3'], ['STR', 'm3']]))).toEqual(['m3', 'm1'])
    expect(idsOf(new Map([['ARC', 'model-1']]))).toEqual(['m1', 'm2'])
  })
})

describe('with no project open', () => {
  it('Locate… does nothing and asks main nothing; error rows offer no Locate…; a save names models in slot order', async () => {
    await locateModel('m1')
    expect(locateCalls).toEqual([])
    expect(seam.located).toEqual([])
    expect(st().uploads).toEqual([])
    expect(save().file.models.map((m) => m.id)).toEqual(['m1', 'm2'])
  })
})
