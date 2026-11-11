/**
 * 2026-11-08 — the `.sgvue` project file, phase 4 (plan D4): the upload pipeline's half of
 * Locate… (`locateFile`). A located file loads **into the open project as that model**: under the
 * project's key for it and never as a fresh start, so on the landing page the other missing
 * models' rows — and their Locate… — stay, and the open project is not closed. After boot it is a
 * pick like any other, asked about by the project's name for the model when that key is taken.
 *
 * No Electron and no worker: the bridge is stubbed and the parse is `federation.prepare`, stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { federation, type BatchItem } from '../../src/renderer/model/federation-store'
import {
  addError,
  chainAfter,
  disposeUploads,
  keysFor,
  locateFile,
  onFreshStart,
  openProjectFiles
} from '../../src/renderer/model/upload-pipeline'
import { useShell } from '../../src/renderer/state/shell'
import { federate } from '../../src/shared/federate'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'

const INITIAL = useShell.getState()
const FILE = { path: '/projects/synthetic/elsewhere/STR moved.ifc', name: 'STR moved.ifc', size: 10 }
const AS = { key: 'STR', name: 'STR.ifc' }
const after = { order: [FILE.path], then: async () => undefined }

let asked: string[] = []
let keys: string[] = []
const freshStarts = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  asked = []
  keys = []
  freshStarts.mockClear()
  onFreshStart(freshStarts)
  vi.stubGlobal('window', {
    sgvue: {
      fileUrl: async () => ({ url: 'sgvue-file://t/x' }),
      addRecent: async () => [],
      confirmReplace: async (name: string) => {
        asked.push(name)
        return true
      }
    }
  })
  vi.stubGlobal('fetch', async () => new Response('ISO-10303-21;'))
  vi.spyOn(federation, 'prepare').mockImplementation((f) => {
    keys.push(f.key!)
    return new Promise<BatchItem>(() => {})
  })
})

afterEach(() => {
  onFreshStart(null)
  disposeUploads()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const rows = (): [string, string | undefined][] => useShell.getState().uploads.map((u) => [u.name, u.locate])

describe('locateFile — a located model joins the open project', () => {
  it('on the landing page: no fresh start — the other missing rows and the banner stay, and it loads under the project’s key', async () => {
    useShell.setState({ ...INITIAL, uploads: [], booted: false, initErr: "None of this project's models could be opened: ARC.ifc, STR.ifc." })
    vi.spyOn(federation, 'isOpen').mockReturnValue(false)
    addError('ARC.ifc', 'not found where the project says it is', 'm1')
    addError('STR.ifc', 'not found where the project says it is', 'm2')

    expect(await locateFile(FILE, AS, after)).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(freshStarts).not.toHaveBeenCalled()
    expect(rows()).toEqual([
      ['ARC.ifc', 'm1'],
      ['STR.ifc', 'm2'],
      ['STR moved.ifc', undefined]
    ])
    expect(useShell.getState().initErr).toContain('None of this project')
    expect(keys).toEqual(['STR'])
    expect(asked).toEqual([])
  })

  it('after boot, a key already open is asked about by the project’s name for the model', async () => {
    useShell.setState({ ...INITIAL, uploads: [], booted: true })
    vi.spyOn(federation, 'isOpen').mockImplementation((k) => k === 'STR')
    await locateFile(FILE, AS, after)
    await vi.advanceTimersByTimeAsync(0)
    expect(asked).toEqual(['STR.ifc'])
    expect(keys).toEqual(['STR'])
    expect(freshStarts).not.toHaveBeenCalled()
  })

  it('keysFor takes the project’s key for a located file, and is unchanged for any other', () => {
    expect(keysFor([{ name: 'STR moved.ifc', as: AS }], () => false)).toEqual(['STR'])
    expect(keysFor([{ name: 'STR moved.ifc' }], () => false)).toEqual(['STR moved'])
  })
})

describe('chainAfter — a located model’s restore behind the project’s, in one batch', () => {
  it('runs the project’s first and the located one after, even when the first fails; orders concatenate', async () => {
    const calls: string[] = []
    const a = { order: ['/a.ifc'], then: async () => void calls.push('project') }
    const b = { order: ['/b.ifc'], then: async () => void calls.push('located') }
    const ab = chainAfter(a, b)
    expect(ab.order).toEqual(['/a.ifc', '/b.ifc'])
    await ab.then()
    expect(calls).toEqual(['project', 'located'])

    calls.length = 0
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing = { order: [], then: async () => Promise.reject(new Error('restore failed')) }
    await chainAfter(failing, b).then()
    expect(calls).toEqual(['located'])
    expect(chainAfter(null, b)).toBe(b)
  })

  it('a file located while the project’s own model still loads joins its batch: one join, both restores, the project’s first', async () => {
    useShell.setState({ ...INITIAL, uploads: [], booted: false })
    vi.spyOn(federation, 'isOpen').mockReturnValue(false)
    vi.mocked(federation.prepare).mockImplementation(async (f) => {
      keys.push(f.key!)
      return { index: mockModelIndex(f.key!), chunks: [], offset: [0, 0, 0], file: { key: f.key!, path: f.path, name: f.name, sha256: 'a'.repeat(64) } }
    })
    const batches: string[][] = []
    vi.spyOn(federation, 'addBatch').mockImplementation(async (items) => {
      batches.push(items.map((i) => i.index.modelKey))
      useShell.getState().commitModels(federate(items.map((i) => i.index)))
      return true
    })
    const calls: string[] = []
    await openProjectFiles([{ path: '/projects/synthetic/models/ARC.ifc', name: 'ARC.ifc', size: 10 }], [], {
      order: ['/projects/synthetic/models/ARC.ifc'],
      then: async () => void calls.push('project')
    })
    await locateFile(FILE, AS, { order: [FILE.path], then: async () => void calls.push('located') })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(batches).toEqual([['ARC', 'STR']])
    expect(calls).toEqual(['project', 'located'])
  })
})

describe('AfterJoin.failed — a batch that fails to join says so to whoever queued it', () => {
  /**
   * 2026-11-11 — `then` runs only once a batch has joined; when the join fails, `failed` is called
   * instead, once the federation is in its final state, and only for the load that is still the
   * current one (`epoch`): a load torn down or replaced meanwhile calls nothing.
   */
  const ARC = { path: '/projects/synthetic/models/ARC.ifc', name: 'ARC.ifc', size: 10 }
  let rejectJoin: (err: Error) => void = () => undefined

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(federation, 'isOpen').mockReturnValue(false)
    vi.mocked(federation.prepare).mockImplementation(async (f) => {
      keys.push(f.key!)
      return { index: mockModelIndex(f.key!), chunks: [], offset: [0, 0, 0], file: { key: f.key!, path: f.path, name: f.name, sha256: 'a'.repeat(64) } }
    })
    vi.spyOn(federation, 'addBatch').mockImplementation(
      () => new Promise<boolean>((_, reject) => (rejectJoin = reject))
    )
  })

  const joinStarted = async (): Promise<void> => {
    for (let i = 0; i < 100 && !vi.mocked(federation.addBatch).mock.calls.length; i++) await vi.advanceTimersByTimeAsync(500)
    expect(federation.addBatch).toHaveBeenCalledTimes(1)
  }

  it('a boot that fails: `failed` runs once, after the landing page is back, and `then` never', async () => {
    useShell.setState({ ...INITIAL, uploads: [], booted: false })
    const calls: string[] = []
    await openProjectFiles([ARC], [], {
      order: [ARC.path],
      then: async () => void calls.push('then'),
      failed: () => void calls.push(`failed booted=${useShell.getState().booted} err=${/scene/.test(useShell.getState().initErr)}`)
    })
    await joinStarted()
    rejectJoin(new Error('the scene could not take ARC'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toEqual(['failed booted=false err=true'])
  })

  it('after boot: `failed` runs once, after the rows say what went wrong', async () => {
    useShell.setState({ ...INITIAL, uploads: [], booted: true })
    const calls: string[] = []
    await locateFile(FILE, AS, {
      order: [FILE.path],
      then: async () => void calls.push('then'),
      failed: () => void calls.push(`failed rows=${JSON.stringify(useShell.getState().uploads.map((u) => [u.name, u.error]))}`)
    })
    await joinStarted()
    rejectJoin(new Error('the scene could not take STR'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toEqual(['failed rows=[["STR moved.ifc",true]]'])
  })

  it('chained: both `failed` run, the first’s throwing stops neither the second nor the pipeline', async () => {
    useShell.setState({ ...INITIAL, uploads: [], booted: false })
    const calls: string[] = []
    await openProjectFiles([ARC], [], {
      order: [ARC.path],
      then: async () => void calls.push('project then'),
      failed: () => {
        calls.push('project failed')
        throw new Error('settling failed')
      }
    })
    await locateFile(FILE, AS, { order: [FILE.path], then: async () => void calls.push('located then'), failed: () => void calls.push('located failed') })
    await joinStarted()
    rejectJoin(new Error('the scene could not take ARC'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toEqual(['project failed', 'located failed'])
  })

  it('a load torn down while its batch was joining: its `failed` is never called', async () => {
    useShell.setState({ ...INITIAL, uploads: [], booted: false })
    const calls: string[] = []
    await openProjectFiles([ARC], [], { order: [ARC.path], then: async () => void calls.push('then'), failed: () => void calls.push('failed') })
    await joinStarted()
    disposeUploads()
    rejectJoin(new Error('the scene could not take ARC'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toEqual([])
  })
})
