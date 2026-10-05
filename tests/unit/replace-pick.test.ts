/**
 * 2026-09-24 — after boot, a pick whose model is already open or loading is confirmed and then
 * replaces it. The owner, in these words: *"Dont do this. Just ask user to confirm then remove
 * the old version."* — "this" being the `name (2)` the same file used to join as.
 *
 * No Electron here: the native "Replace model?" box is `window.sgvue.confirmReplace`, stubbed
 * to answer Replace or Cancel, and the parse is `federation.prepare`, stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockGeometryChunks, mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import {
  FederationController,
  federation,
  type BatchItem
} from '../../src/renderer/model/federation-store'
import {
  confirmPick,
  disposeUploads,
  dropFiles,
  keysFor,
  openDemo,
  type ChosenFile
} from '../../src/renderer/model/upload-pipeline'
import { useShell } from '../../src/renderer/state/shell'
import type { ModelIndex } from '../../src/shared/model-index.types'
import { NO_SECTIONS } from '../../src/shared/sections'
import { resetShell, stubViewer } from './stub-viewer'

const INITIAL = useShell.getState()

const chosen = (name: string, size = 10): ChosenFile => ({ path: `C:\\m\\${name}`, name, size })

describe('confirmPick — one question per colliding file', () => {
  const run = async (
    names: string[],
    busyKeys: string[],
    answers: Record<string, boolean>
  ): Promise<{ kept: string[]; asked: string[] }> => {
    const asked: string[] = []
    const kept = await confirmPick(
      names.map((n) => chosen(n)),
      (key) => busyKeys.includes(key),
      async (name) => {
        asked.push(name)
        return answers[name] ?? false
      }
    )
    return { kept: kept.map((f) => f.name), asked }
  }

  it('asks about a file whose model is open, by its file name, and keeps it on Replace', async () => {
    expect(await run(['tiny.ifc'], ['tiny'], { 'tiny.ifc': true })).toEqual({
      kept: ['tiny.ifc'],
      asked: ['tiny.ifc']
    })
  })

  it('drops it on Cancel, and the rest of the pick continues', async () => {
    expect(await run(['tiny.ifc', 'other.ifc'], ['tiny'], { 'tiny.ifc': false })).toEqual({
      kept: ['other.ifc'],
      asked: ['tiny.ifc']
    })
  })

  it('asks nothing when nothing collides', async () => {
    expect(await run(['tiny.ifc', 'other.ifc'], [], {})).toEqual({
      kept: ['tiny.ifc', 'other.ifc'],
      asked: []
    })
  })

  it('asks once per colliding file', async () => {
    const r = await run(['a.ifc', 'b.ifc'], ['a', 'b'], { 'a.ifc': true, 'b.ifc': false })
    expect(r).toEqual({ kept: ['a.ifc'], asked: ['a.ifc', 'b.ifc'] })
  })

  it('does not ask again for a second file of a stem already kept from this pick', async () => {
    const r = await run(['tiny.ifc', 'tiny.ifczip'], ['tiny'], { 'tiny.ifc': true })
    expect(r).toEqual({ kept: ['tiny.ifc', 'tiny.ifczip'], asked: ['tiny.ifc'] })
  })

  it('does ask again when the first file of that stem was cancelled', async () => {
    const r = await run(['tiny.ifc', 'tiny.ifczip'], ['tiny'], { 'tiny.ifczip': true })
    expect(r).toEqual({ kept: ['tiny.ifczip'], asked: ['tiny.ifc', 'tiny.ifczip'] })
  })

  it('never asks about a file validate refuses — it goes on to its error row', async () => {
    const r = await run(['tiny.ifcxml'], ['tiny'], {})
    expect(r).toEqual({ kept: ['tiny.ifcxml'], asked: [] })
  })
})

describe('keysFor — the stem, and a suffix only within one pick', () => {
  it('keeps the stem even when it is busy: that is the replacement', () => {
    expect(keysFor([{ name: 'tiny.ifc' }], (k) => k === 'tiny')).toEqual(['tiny'])
  })

  it('gives a second file of the same stem in one pick ` (2)`', () => {
    expect(keysFor([{ name: 'tiny.ifc' }, { name: 'tiny.ifczip' }], () => false)).toEqual([
      'tiny',
      'tiny (2)'
    ])
  })

  it('skips a suffix that is already taken', () => {
    const keys = keysFor(
      [{ name: 'tiny.ifc' }, { name: 'tiny.ifczip' }],
      (k) => k === 'tiny (2)'
    )
    expect(keys).toEqual(['tiny', 'tiny (3)'])
  })
})

/* ────────────────────────────── the pipeline, dialog stubbed ────────────────────────────── */

describe('a pick after boot, with the native box stubbed', () => {
  let answer = true
  let asked: string[] = []

  beforeEach(() => {
    vi.useFakeTimers()
    answer = true
    asked = []
    useShell.setState({ ...INITIAL, uploads: [], initErr: '', booted: true })
    vi.stubGlobal('window', {
      sgvue: {
        pathForFile: () => '',
        admitPaths: async () => [],
        addRecent: async () => [],
        confirmReplace: async (name: string) => {
          asked.push(name)
          return answer
        }
      }
    })
  })

  afterEach(() => {
    disposeUploads()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  const file = (): File => new File(['ISO-10303-21;'], 'tiny.ifc')
  const rows = (): string[] => useShell.getState().uploads.map((u) => u.name)

  it('Cancel: the pick is dropped silently — no row, no warning, no parse', async () => {
    answer = false
    vi.spyOn(federation, 'isOpen').mockImplementation((k) => k === 'tiny')
    const prepare = vi.spyOn(federation, 'prepare')
    await dropFiles([file()])
    await vi.advanceTimersByTimeAsync(0)
    expect(asked).toEqual(['tiny.ifc'])
    expect(rows()).toEqual([])
    expect(useShell.getState().initErr).toBe('')
    expect(prepare).not.toHaveBeenCalled()
  })

  it('Replace: the file loads under the same key — never `tiny (2)`', async () => {
    vi.spyOn(federation, 'isOpen').mockImplementation((k) => k === 'tiny')
    const keys: (string | undefined)[] = []
    vi.spyOn(federation, 'prepare').mockImplementation((f) => {
      keys.push(f.key)
      return new Promise(() => {})
    })
    await dropFiles([file()])
    await vi.advanceTimersByTimeAsync(0)
    expect(asked).toEqual(['tiny.ifc'])
    expect(rows()).toEqual(['tiny.ifc'])
    expect(keys).toEqual(['tiny'])
  })

  it('a model still loading: the newer pick wins, and parses once the older one is done', async () => {
    vi.spyOn(federation, 'isOpen').mockReturnValue(false)
    const forget = vi.spyOn(federation, 'forget').mockImplementation(() => {})
    let finishFirst = (_: BatchItem): void => {}
    const calls: string[] = []
    vi.spyOn(federation, 'prepare').mockImplementation((f) => {
      calls.push(f.key!)
      return calls.length === 1
        ? new Promise<BatchItem>((done) => (finishFirst = done))
        : new Promise<BatchItem>(() => {})
    })

    await dropFiles([file()])
    await vi.advanceTimersByTimeAsync(0)
    expect(asked).toEqual([]) // nothing open or loading yet
    const firstRow = useShell.getState().uploads[0].id

    await dropFiles([file()])
    await vi.advanceTimersByTimeAsync(0)
    expect(asked).toEqual(['tiny.ifc']) // it is loading: asked
    // The older row went at once; one row, the newer one.
    expect(rows()).toEqual(['tiny.ifc'])
    expect(useShell.getState().uploads[0].id).not.toBe(firstRow)
    // Two parses never share a key: the newer one waits.
    expect(calls).toEqual(['tiny'])

    finishFirst({
      index: { modelKey: 'tiny', sha256: 'aa' } as ModelIndex,
      chunks: [],
      offset: [0, 0, 0],
      frame: null
    })
    await vi.advanceTimersByTimeAsync(0)
    // The older result is discarded — closed in the worker — and only then does the newer parse.
    expect(forget).toHaveBeenCalledWith('tiny')
    expect(calls).toEqual(['tiny', 'tiny'])
  })
})

/* ────────────────────────────── the controller's half ────────────────────────────── */

describe('FederationController — the replacement joins in the old one’s place', () => {
  const calls: string[] = []
  const viewer = stubViewer({
    addModel: async (key: string) => void calls.push(`addModel:${key}`),
    removeModel: (key: string) => {
      calls.push(`removeModel:${key}`)
      return []
    },
    frameExtents: () => calls.push('frameExtents'),
    debug: () => ({}),
    elementIds: () => []
  })

  const item = (key: string, path: string): BatchItem => ({
    index: mockModelIndex(key),
    chunks: mockGeometryChunks(key),
    offset: [0, 0, 0],
    frame: null,
    file: { key, path, name: `${key}.ifc`, sha256: path }
  })

  let fed: FederationController
  beforeEach(() => {
    resetShell()
    calls.length = 0
    fed = new FederationController()
    fed.attach(viewer)
  })

  it('one model under the key, the camera kept, never back to the landing page', async () => {
    await fed.addBatch([item('ARC', '/old/ARC.ifc')])
    const seeded = useShell.getState().chatMsgs
    expect(seeded.length).toBeGreaterThan(0)
    calls.length = 0
    await fed.addBatch([item('ARC', '/new/ARC.ifc')])
    // The viewer swaps the old model's parts for the new one's itself, once the new one is in
    // (refactor pass 2): the controller asks it to remove nothing.
    expect(calls).toEqual(['addModel:ARC'])
    expect(fed.current.models.map((m) => m.meta.modelKey)).toEqual(['ARC'])
    expect(useShell.getState()).toMatchObject({ booted: true, loaded: ['ARC'] })
    // Not a boot: the assistant's conversation is not re-seeded.
    expect(useShell.getState().chatMsgs).toBe(seeded)
    // The session names the file that is now on screen.
    expect(fed.sessionFiles().map((f) => f.path)).toEqual(['/new/ARC.ifc'])
  })

  it('prunes what a removal would: hidden ids, colour and the active model of the old one', async () => {
    await fed.addBatch([item('ARC', '/a'), item('STR', '/s')])
    const arcId = fed.current.elements.find((e) => e.model === 'ARC')!.id
    const strId = fed.current.elements.find((e) => e.model === 'STR')!.id
    useShell.setState({
      hidden: { [arcId]: true, [strId]: true },
      modelColors: { ARC: '#35C4B6', STR: '#E8A33D' },
      active: 'ARC'
    })
    await fed.addBatch([item('ARC', '/a2')])
    // The replacement joined beside the old one, on a slot of its own: the old ids are gone.
    expect(fed.current.byId.has(arcId)).toBe(false)
    const s = useShell.getState()
    expect(s.hidden).toEqual({ [strId]: true })
    expect(s.modelColors).toEqual({ STR: '#E8A33D' })
    expect(s.active).toBeNull()
    expect(s.loaded).toEqual(['STR', 'ARC'])
  })
})

/* ────────────────────────────── refactor pass 2, P10: a failed join undoes itself ────────────────────────────── */

describe('FederationController — a batch whose join fails undoes itself', () => {
  const calls: string[] = []
  let failNext: string | null = null
  const viewer = stubViewer({
    addModel: async (key: string) => {
      if (failNext === key) {
        failNext = null
        throw new Error('out of memory')
      }
      calls.push(`addModel:${key}`)
    },
    removeModel: (key: string) => {
      calls.push(`removeModel:${key}`)
      return []
    },
    frameExtents: () => calls.push('frameExtents'),
    debug: () => ({}),
    elementIds: () => []
  })

  const item = (key: string, path: string): BatchItem => ({
    index: mockModelIndex(key),
    chunks: mockGeometryChunks(key),
    offset: [0, 0, 0],
    frame: null,
    file: { key, path, name: `${key}.ifc`, sha256: path }
  })

  let fed: FederationController
  beforeEach(() => {
    resetShell()
    calls.length = 0
    failNext = null
    fed = new FederationController()
    fed.attach(viewer)
  })

  it('a replacement that fails to join leaves the model on screen as it was', async () => {
    await fed.addBatch([item('ARC', '/old/ARC.ifc'), item('STR', '/s')])
    const before = fed.current
    const hidden = { [before.elements[0].id]: true }
    useShell.setState({ hidden, colorBy: null })
    calls.length = 0
    failNext = 'ARC'
    await expect(fed.addBatch([item('ARC', '/new/ARC.ifc')])).rejects.toThrow('out of memory')
    // Nothing was removed from the scene, and the federation is the one before, slot for slot.
    expect(calls).toEqual([])
    expect(fed.current.models.map((m) => [m.meta.modelKey, m.slot])).toEqual(
      before.models.map((m) => [m.meta.modelKey, m.slot])
    )
    expect(fed.sessionFiles().map((f) => f.path)).toEqual(['/old/ARC.ifc', '/s'])
    // Still booted, no longer loading, and nothing the user had set was touched.
    expect(useShell.getState()).toMatchObject({ booted: true, ready: true, loaded: ['ARC', 'STR'], hidden })
  })

  it('a model that fails takes the ones joined before it in the same batch back out', async () => {
    await fed.addBatch([item('ARC', '/a')])
    calls.length = 0
    failNext = 'MEP'
    await expect(fed.addBatch([item('STR', '/s'), item('MEP', '/m')])).rejects.toThrow('out of memory')
    expect(calls).toEqual(['addModel:STR', 'removeModel:STR'])
    expect(fed.current.models.map((m) => m.meta.modelKey)).toEqual(['ARC'])
    expect(fed.isOpen('STR')).toBe(false)
    expect(fed.sessionFiles().map((f) => f.path)).toEqual(['/a'])
    expect(useShell.getState()).toMatchObject({ booted: true, ready: true, loaded: ['ARC'] })
  })

  it('a boot that fails leaves nothing behind: no models, no offset, nothing committed', async () => {
    failNext = 'STR'
    const at: [number, number, number] = [100, 200, 0]
    const boot = [{ ...item('ARC', '/a'), offset: at }, { ...item('STR', '/s'), offset: at }]
    await expect(fed.addBatch(boot)).rejects.toThrow('out of memory')
    expect(calls).toEqual(['addModel:ARC', 'removeModel:ARC'])
    expect(fed.current.models).toHaveLength(0)
    expect(useShell.getState()).toMatchObject({ booted: false, loaded: [], offset: [0, 0, 0] })
  })
})

/* ────────────────────────────── the pipeline's half: P9 and P10 ────────────────────────────── */

describe('the pipeline with the controller live and the native box stubbed', () => {
  let asked: string[] = []
  const calls: string[] = []
  const viewer = stubViewer({
    addModel: async (key: string) => void calls.push(`addModel:${key}`),
    removeModel: (key: string) => {
      calls.push(`removeModel:${key}`)
      return []
    },
    setSections: (cfg: { grid: unknown; level: unknown }) =>
      calls.push(`setSections:${JSON.stringify(cfg)}`),
    clearMeasures: () => calls.push('clearMeasures'),
    clearSpots: () => calls.push('clearSpots'),
    debug: () => ({}),
    elementIds: () => []
  })

  beforeEach(() => {
    vi.useFakeTimers()
    asked = []
    calls.length = 0
    useShell.setState({ ...INITIAL, uploads: [], initErr: '' }, true)
    vi.stubGlobal('window', {
      sgvue: {
        pathForFile: () => '',
        admitPaths: async () => [],
        addRecent: async () => [],
        confirmReplace: async (name: string) => {
          asked.push(name)
          return true
        }
      }
    })
    federation.attach(viewer)
  })

  afterEach(() => {
    disposeUploads()
    federation.resetUnshown()
    federation.attach(null)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  const file = (): File => new File(['ISO-10303-21;'], 'tiny.ifc')

  it('P9 — a real pick while the demo is on screen replaces it: a fresh load, nothing asked', async () => {
    await openDemo()
    expect(useShell.getState()).toMatchObject({ booted: true })
    const demoKeys = [...useShell.getState().loaded]
    expect(demoKeys.length).toBeGreaterThan(0)
    // Review state that names the demo's storeys and scene — both section planes among it.
    useShell.setState({
      storeyVis: { L2: false },
      sections: {
        grid: { name: 'C', offset: 500, flip: true, cut: true },
        level: { name: 'L2', offset: 0, flip: false, cut: true }
      }
    })
    const keys: (string | undefined)[] = []
    vi.spyOn(federation, 'prepare').mockImplementation((f) => {
      keys.push(f.key)
      return new Promise(() => {})
    })
    calls.length = 0
    await dropFiles([file()])
    await vi.advanceTimersByTimeAsync(0)
    expect(asked).toEqual([])
    // The demo left the scene and the federation, and the landing page's own load began.
    for (const key of demoKeys) expect(calls).toContain(`removeModel:${key}`)
    expect(calls).toEqual(
      expect.arrayContaining(['setSections:{"grid":null,"level":null}', 'clearMeasures', 'clearSpots'])
    )
    expect(federation.current.models).toHaveLength(0)
    expect(useShell.getState()).toMatchObject({
      booted: false,
      loaded: [],
      storeyVis: {},
      offset: [0, 0, 0],
      frame: null
    })
    // Both planes are gone with the demo, not just one of them.
    expect(useShell.getState().sections).toEqual(NO_SECTIONS)
    expect(keys).toEqual(['tiny'])
  })

  it('P10 — a boot refused after it committed (no geometry) is the landing banner, and is unloaded', async () => {
    vi.spyOn(federation, 'prepare').mockResolvedValue({
      index: { ...mockModelIndex('ARC'), elements: [] },
      chunks: [],
      offset: [0, 0, 0],
      frame: null
    })
    await dropFiles([file()])
    await vi.advanceTimersByTimeAsync(20_000)
    const s = useShell.getState()
    expect(s.booted).toBe(false)
    expect(s.initErr).toBe('Could not open that model — the model contains no geometry.')
    expect(s.uploads).toEqual([])
    expect(federation.current.models).toHaveLength(0)
    expect(calls).toContain('removeModel:ARC')
  })

  it('P10 — after boot, a join that fails is the designed error row, never the landing page', async () => {
    useShell.setState({ booted: true, ready: true })
    vi.spyOn(federation, 'isOpen').mockReturnValue(false)
    vi.spyOn(federation, 'prepare').mockResolvedValue({
      index: mockModelIndex('ARC'),
      chunks: [],
      offset: [0, 0, 0],
      frame: null
    })
    vi.spyOn(federation, 'addBatch').mockRejectedValue(new Error('out of memory'))
    await dropFiles([file()])
    await vi.advanceTimersByTimeAsync(20_000)
    const s = useShell.getState()
    expect(s.booted).toBe(true)
    expect(s.initErr).toBe('')
    expect(s.uploads).toHaveLength(1)
    expect(s.uploads[0]).toMatchObject({ error: true, stage: 'out of memory', dismiss: true })
  })
})
