/**
 * Every path the renderer stores or compares has passed through `admit()`.
 *
 * Main is the only place that canonicalises — `admit()` answers with a path's own `realpath` —
 * so a path the renderer keeps in its own spelling can never be matched against one main gives
 * back. Measured on Windows: the same file through a directory junction, or through the 8.3
 * short name `%TEMP%` has for a user whose name contains a space, was refused by its own
 * session as *"no longer where the session left it"*, and the SHA-256 comparison behind that
 * was skipped in silence.
 *
 * No Electron here: `window.sgvue` is a stub that admits what it is told to admit, and the
 * federation's `sessionFiles()` is stubbed to whatever the parse would have found.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { probeFiles, verifyHashes } from '../../src/renderer/model/session'
import { disposeUploads, dropFiles } from '../../src/renderer/model/upload-pipeline'
import { federation } from '../../src/renderer/model/federation-store'
import { useShell } from '../../src/renderer/state/shell'
import { STAGGER_MS } from '../../src/shared/upload'
import type { SessionFile, SessionPayload } from '../../src/shared/session-codec'

/** `%TEMP%` as Windows spells it for a user named `Jane Doe`, and the same file spelled in full. */
const SHORT = 'C:\\Users\\JANEDO~1\\m\\arc.ifc'
const LONG = 'C:\\Users\\Jane Doe\\m\\arc.ifc'

/** What main would admit: requested path → the `realpath` it answers with. */
let admits = new Map<string, string>()

/** Paths main answers with a rejected promise, as the IPC contract does for an empty one. */
let rejects = new Set<string>()

/** Every `admitPaths` request, so "it was never asked about `''`" is checkable. */
let admitCalls: string[][] = []

const sgvue = {
  admitPaths: async (paths: readonly string[]) => {
    admitCalls.push([...paths])
    // `AdmitRequest` is `z.array(z.string().min(1))`: an empty path is a zod failure in main,
    // and `ipcRenderer.invoke` hands that back as a rejection.
    if (!paths[0]) throw new Error('paths: too small')
    if (rejects.has(paths[0])) throw new Error('main refused')
    const real = admits.get(paths[0])
    // Main's answer since 2026-10-09 (`AdmitResult`); its `refused` half is
    // `tests/unit/admit-refusals.test.ts`'s.
    const files = real ? [{ path: real, name: real.split(/[\\/]/).pop() ?? '', size: 10 }] : []
    return { files, refused: [] }
  },
  pathForFile: (file: File) => dropped.get(file.name) ?? '',
  addRecent: async (file: { path: string }) => {
    recentCalls.push(file.path)
    return []
  }
}

/** Every path `addRecent` was asked to remember. */
let recentCalls: string[] = []

/** The raw path a native drop would hand over for each `File`. */
let dropped = new Map<string, string>()

const INITIAL = useShell.getState()

const payload = (...files: SessionFile[]): SessionPayload =>
  ({ models: files.map((f) => f.key), files }) as unknown as SessionPayload

const session = (path: string, sha256 = 'aa', key = 'ARC', name = 'arc.ifc'): SessionFile => ({
  key,
  path,
  name,
  sha256
})

beforeEach(() => {
  admits = new Map()
  rejects = new Set()
  admitCalls = []
  dropped = new Map()
  recentCalls = []
  useShell.setState({ ...INITIAL, uploads: [], initErr: '' })
  vi.stubGlobal('window', { sgvue })
})

afterEach(() => {
  disposeUploads()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('probeFiles', () => {
  it('admits each file and carries the admitted spelling into the payload', async () => {
    admits.set(SHORT, LONG)
    const probe = await probeFiles(payload(session(SHORT)))
    expect(probe.ok).toBe(true)
    expect(probe.message).toBe('')
    expect(probe.paths).toEqual([LONG])
    // What `openPaths` hands on to `verifyHashes` and `applySession`.
    expect(probe.payload.files).toEqual([session(LONG)])
  })

  it('refuses a file main did not admit, by name, in the designed copy', async () => {
    const probe = await probeFiles(payload(session(SHORT)))
    expect(probe.ok).toBe(false)
    expect(probe.paths).toEqual([])
    expect(probe.message).toContain('arc.ifc')
    expect(probe.message).toContain('no longer where the session left it')
  })

  it('still refuses a session with no files in it', async () => {
    const probe = await probeFiles({ models: [], files: [] } as unknown as SessionPayload)
    expect(probe.ok).toBe(false)
    expect(probe.message).toBe('That session had no models in it. Pick a file to start again.')
  })

  it('treats a rejected admission as "not admitted", and refuses by name instead of throwing', async () => {
    const str = session('/m/str.ifc', 'bb', 'STR', 'str.ifc')
    rejects.add(SHORT)
    admits.set('/m/str.ifc', '/m/str.ifc')
    const probe = await probeFiles(payload(session(SHORT), str))
    expect(probe.ok).toBe(false)
    expect(probe.message).toContain('arc.ifc')
    expect(probe.message).toContain('no longer where the session left it')
    // The second file was still asked about — one refusal does not end the probe.
    expect(admitCalls).toEqual([[SHORT], ['/m/str.ifc']])
  })
})

describe('verifyHashes, against the payload probeFiles handed on', () => {
  beforeEach(() => {
    // The parse hashed the file main admitted, so the live federation knows it by that path.
    vi.spyOn(federation, 'sessionFiles').mockReturnValue([session(LONG, 'ZZ')])
    admits.set(SHORT, LONG)
  })

  it('names a file whose bytes have changed since the session was saved', async () => {
    const probe = await probeFiles(payload(session(SHORT)))
    const changed = verifyHashes(probe.payload)
    expect(changed).toContain('arc.ifc')
    expect(changed).toContain('has changed since the session was saved')
  })

  it('had nothing to compare while the session kept its own spelling', () => {
    // The defect this fixes: `live.get(f.path)` missed, so the digest was never compared.
    expect(verifyHashes(payload(session(SHORT)))).toBeNull()
  })
})

describe('dropFiles', () => {
  it('stores the path main admitted, not the one the drop handed over', async () => {
    vi.useFakeTimers()
    const seen: string[] = []
    vi.spyOn(federation, 'prepare').mockImplementation(
      (file) =>
        new Promise(() => {
          seen.push(file.path)
        })
    )
    const file = new File(['ISO-10303-21;'], 'arc.ifc')
    dropped.set('arc.ifc', SHORT)
    admits.set(SHORT, LONG)

    await dropFiles([file])
    await vi.advanceTimersByTimeAsync(0)

    expect(seen).toEqual([LONG])
    expect(useShell.getState().uploads.map((u) => u.name)).toEqual(['arc.ifc'])
    disposeUploads()
    vi.useRealTimers()
  })

  it('never asks about a `File` the preload could not name, and keeps the rest of the drop', async () => {
    vi.useFakeTimers()
    const seen: string[] = []
    vi.spyOn(federation, 'prepare').mockImplementation(
      (file) =>
        new Promise(() => {
          seen.push(file.path)
        })
    )
    // `webUtils.getPathForFile()` answers `''` for a `File` that is not backed by a disk file
    // — a mail attachment, something dragged out of a zip view — and `AdmitRequest` refuses an
    // empty path, so asking would reject and take the whole drop with it.
    const pathless = new File(['ISO-10303-21;'], 'attachment.ifc')
    const good = new File(['ISO-10303-21;'], 'arc.ifc')
    dropped.set('arc.ifc', SHORT)
    admits.set(SHORT, LONG)

    await dropFiles([pathless, good])
    await vi.advanceTimersByTimeAsync(STAGGER_MS)

    expect(admitCalls).toEqual([[SHORT]])
    expect(seen).toEqual(['', LONG])
    expect(useShell.getState().uploads.map((u) => u.name)).toEqual(['attachment.ifc', 'arc.ifc'])
    disposeUploads()
    vi.useRealTimers()
  })

  it('queues every file even when one file’s admission rejects', async () => {
    vi.useFakeTimers()
    const seen: string[] = []
    vi.spyOn(federation, 'prepare').mockImplementation(
      (file) =>
        new Promise(() => {
          seen.push(file.path)
        })
    )
    const bad = new File(['ISO-10303-21;'], 'str.ifc')
    const good = new File(['ISO-10303-21;'], 'arc.ifc')
    dropped.set('str.ifc', 'C:\\m\\str.ifc')
    dropped.set('arc.ifc', SHORT)
    rejects.add('C:\\m\\str.ifc')
    admits.set(SHORT, LONG)

    await dropFiles([bad, good])
    await vi.advanceTimersByTimeAsync(STAGGER_MS)

    // The refused one keeps exactly what the drop said; the other still gets its real path.
    expect(seen).toEqual(['C:\\m\\str.ifc', LONG])
    expect(useShell.getState().uploads.map((u) => u.name)).toEqual(['str.ifc', 'arc.ifc'])
    disposeUploads()
    vi.useRealTimers()
  })

  it('remembers only an admitted drop — a refused one loads but never reaches recents', async () => {
    vi.useFakeTimers()
    vi.spyOn(federation, 'prepare').mockImplementation(async (file) => ({
      index: { modelKey: file.name, sha256: 'aa' }
    }) as never)
    // A literal network path: main refuses it (S1), so the drop keeps its own spelling.
    const unc = new File(['ISO-10303-21;'], 'str.ifc')
    const good = new File(['ISO-10303-21;'], 'arc.ifc')
    dropped.set('str.ifc', '\\\\server\\share\\str.ifc')
    dropped.set('arc.ifc', SHORT)
    admits.set(SHORT, LONG)

    await dropFiles([unc, good])
    await vi.advanceTimersByTimeAsync(STAGGER_MS)

    expect(recentCalls).toEqual([LONG])
    disposeUploads()
    vi.useRealTimers()
  })

  it('still gives a file main refuses its designed error row', async () => {
    const file = new File(['<xml/>'], 'plan.ifcxml')
    dropped.set('plan.ifcxml', 'C:\\m\\plan.ifcxml')

    await dropFiles([file])

    expect(useShell.getState().uploads).toHaveLength(1)
    expect(useShell.getState().uploads[0]).toMatchObject({
      name: 'plan.ifcxml',
      stage: 'ifcXML is not supported',
      error: true,
      dismiss: true
    })
  })
})
