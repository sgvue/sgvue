/**
 * A file main refuses reaches the designed upload row on every route — the second defect the
 * 2026-10-09 capacity measurement found (`reports/Large model capacity.md`, local).
 *
 * A 610 MB file picked in the native Open dialog was dropped by main's `admit()`, and the
 * renderer's `openDialog` returned on an empty list: no row, no banner, nothing. The same file
 * dropped on the window got the designed row, `larger than 600 MB`. Main now answers the files it
 * refused with the drop zone's own reason (`main/file-protocol.ts`), and the Open dialog, a Recent
 * pill and a share link show the row a drop shows.
 *
 * No Electron here: `window.sgvue` is a stub that answers as main does (`AdmitResult`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdmitResult, RefusedFile } from '../../src/shared/ipc-contract'
import { MAX_FILE_BYTES, type RejectReason } from '../../src/shared/upload'
import type { SessionPayload } from '../../src/shared/session-codec'
import { federation } from '../../src/renderer/model/federation-store'
import {
  disposeUploads,
  dropFiles,
  openDialog,
  openPaths,
  openRecent
} from '../../src/renderer/model/upload-pipeline'
import { probeFiles } from '../../src/renderer/model/session'
import { openPayload } from '../../src/renderer/model/boot'
import { useShell } from '../../src/renderer/state/shell'

const INITIAL = useShell.getState()

/** The measured file, `cap-610.ifc` (639 475 090 bytes): main answers its name and reason, not its size. */
const OVERSIZE: RefusedFile = { name: 'cap-610.ifc', reason: 'larger than 600 MB' }

/** What main answers for each path, and every path it was asked about. */
let answers = new Map<string, AdmitResult>()
let dialogAnswer: AdmitResult = { files: [], refused: [] }
let asked: string[] = []
let replaceAsked: string[] = []

beforeEach(() => {
  vi.useFakeTimers()
  answers = new Map()
  dialogAnswer = { files: [], refused: [] }
  asked = []
  replaceAsked = []
  useShell.setState({ ...INITIAL, uploads: [], initErr: '', booted: false }, true)
  vi.stubGlobal('window', {
    sgvue: {
      openDialog: async () => dialogAnswer,
      admitPaths: async (paths: readonly string[]) => {
        asked.push(...paths)
        const out: AdmitResult = { files: [], refused: [] }
        for (const p of paths) {
          const a = answers.get(p)
          if (a) {
            out.files.push(...a.files)
            out.refused.push(...a.refused)
          }
        }
        return out
      },
      listRecents: async () => [{ path: 'C:\\m\\cap-610.ifc', name: 'cap-610.ifc' }],
      // An admitted file's bytes: a token, then the stream (`upload-pipeline.ts`, `bytesOf`).
      fileUrl: async () => ({ url: 'sgvue-file://t/token' }),
      pathForFile: () => '',
      addRecent: async () => [],
      confirmReplace: async (name: string) => {
        replaceAsked.push(name)
        return true
      }
    }
  })
  vi.stubGlobal('fetch', async () => new Response('ISO-10303-21;'))
})

afterEach(() => {
  disposeUploads()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** The rows as the landing page and the sidebar draw them, less the id they are keyed by. */
const rows = (): Record<string, unknown>[] =>
  useShell.getState().uploads.map(({ id: _id, ...row }) => row)

/** A dropped `File` of a given size, as a drop hands the renderer its name and size. */
const droppedFile = (name: string, size: number): File => ({ name, size }) as File

describe('the Open dialog', () => {
  it('shows the drop zone’s row for a file over 600 MB — the row a drop of it shows', async () => {
    dialogAnswer = { files: [], refused: [OVERSIZE] }
    await openDialog()
    expect(rows()).toEqual([
      { name: 'cap-610.ifc', stage: 'larger than 600 MB', pct: 0, error: true, dismiss: true }
    ])
    const fromDialog = rows()

    useShell.setState({ uploads: [] })
    await dropFiles([droppedFile('cap-610.ifc', 639_475_090)])
    expect(rows()).toEqual(fromDialog)
  })

  it('gives every reason a drop gives, in the drop’s own words', async () => {
    const reasons: RejectReason[] = ['larger than 600 MB', 'file is empty', 'not an IFC file', 'ifcXML is not supported']
    dialogAnswer = {
      files: [],
      refused: [
        OVERSIZE,
        { name: 'empty.ifc', reason: 'file is empty' },
        { name: 'notes.txt', reason: 'not an IFC file' },
        { name: 'plan.ifcxml', reason: 'ifcXML is not supported' }
      ]
    }
    await openDialog()
    expect(useShell.getState().uploads.map((u) => u.stage)).toEqual(reasons)

    useShell.setState({ uploads: [] })
    await dropFiles([
      droppedFile('cap-610.ifc', MAX_FILE_BYTES + 1),
      droppedFile('empty.ifc', 0),
      droppedFile('notes.txt', 5),
      droppedFile('plan.ifcxml', 9)
    ])
    expect(useShell.getState().uploads.map((u) => u.stage)).toEqual(reasons)
  })

  it('still loads what it admitted beside a refused file, and never opens the refused one', async () => {
    const prepared: string[] = []
    vi.spyOn(federation, 'prepare').mockImplementation((file) => {
      prepared.push(file.name)
      return new Promise(() => {})
    })
    dialogAnswer = { files: [{ path: 'C:\\m\\small.ifc', name: 'small.ifc', size: 2048 }], refused: [OVERSIZE] }
    await openDialog()
    await vi.advanceTimersByTimeAsync(0)
    expect(useShell.getState().uploads.map((u) => [u.name, u.error ?? false])).toEqual([
      ['cap-610.ifc', true],
      ['small.ifc', false]
    ])
    expect(prepared).toEqual(['small.ifc'])
  })

  it('after boot: the row, and no "Replace model?" for a file that cannot open', async () => {
    useShell.setState({ booted: true })
    vi.spyOn(federation, 'isOpen').mockReturnValue(true)
    dialogAnswer = { files: [], refused: [OVERSIZE] }
    await openDialog()
    expect(replaceAsked).toEqual([])
    expect(rows()).toEqual([
      { name: 'cap-610.ifc', stage: 'larger than 600 MB', pct: 0, error: true, dismiss: true }
    ])
  })

  it('a cancelled dialog still changes nothing', async () => {
    await openDialog()
    expect(rows()).toEqual([])
    expect(useShell.getState().initErr).toBe('')
  })
})

describe('a Recent pill, and the assistant’s open_recent', () => {
  it('a recent file that has grown past 600 MB gets the row, not "no longer where it was"', async () => {
    answers.set('C:\\m\\cap-610.ifc', { files: [], refused: [OVERSIZE] })
    expect(await openPaths(['C:\\m\\cap-610.ifc'])).toBe(true)
    expect(rows()).toEqual([
      { name: 'cap-610.ifc', stage: 'larger than 600 MB', pct: 0, error: true, dismiss: true }
    ])
    expect(useShell.getState().initErr).toBe('')
  })

  it('a recent file that is gone is still "no longer where it was"', async () => {
    expect(await openPaths(['C:\\m\\gone.ifc'])).toBe(false)
    expect(rows()).toEqual([])
    expect(useShell.getState().initErr).toBe('That file is no longer where it was. Pick it again to start.')
  })

  it('Apply on open_recent: the row says why, and the chat is not told the file moved', async () => {
    answers.set('C:\\m\\cap-610.ifc', { files: [], refused: [OVERSIZE] })
    expect(await openRecent('C:\\m\\cap-610.ifc')).toBe('opening')
    expect(useShell.getState().uploads.map((u) => u.stage)).toEqual(['larger than 600 MB'])
  })
})

describe('a session or a share link', () => {
  const payload = (...files: { path: string; name: string; key: string }[]): SessionPayload =>
    ({ models: files.map((f) => f.key), files: files.map((f) => ({ ...f, sha256: 'aa' })) }) as unknown as SessionPayload

  it('a file refused with a reason is not called moved', async () => {
    answers.set('C:\\m\\cap-610.ifc', { files: [], refused: [OVERSIZE] })
    const probe = await probeFiles(payload({ path: 'C:\\m\\cap-610.ifc', name: 'cap-610.ifc', key: 'cap-610' }))
    expect(probe).toMatchObject({ ok: false, message: '', paths: [], refused: [OVERSIZE] })
  })

  it('opening it: the drop zone’s row, no banner, nothing loaded', async () => {
    const prepare = vi.spyOn(federation, 'prepare')
    answers.set('C:\\m\\cap-610.ifc', { files: [], refused: [OVERSIZE] })
    await openPayload(payload({ path: 'C:\\m\\cap-610.ifc', name: 'cap-610.ifc', key: 'cap-610' }))
    expect(rows()).toEqual([
      { name: 'cap-610.ifc', stage: 'larger than 600 MB', pct: 0, error: true, dismiss: true }
    ])
    expect(useShell.getState().initErr).toBe('')
    expect(prepare).not.toHaveBeenCalled()
  })

  it('one file refused and one gone: the row for the first, the banner names only the second', async () => {
    const prepare = vi.spyOn(federation, 'prepare')
    answers.set('C:\\m\\cap-610.ifc', { files: [], refused: [OVERSIZE] })
    await openPayload(
      payload(
        { path: 'C:\\m\\cap-610.ifc', name: 'cap-610.ifc', key: 'cap-610' },
        { path: 'C:\\m\\str.ifc', name: 'str.ifc', key: 'str' }
      )
    )
    expect(useShell.getState().uploads.map((u) => u.name)).toEqual(['cap-610.ifc'])
    expect(useShell.getState().initErr).toBe(
      'str.ifc is no longer where the session left it. Pick the file again to start.'
    )
    expect(prepare).not.toHaveBeenCalled()
  })

  it('every file admitted: it opens as before', async () => {
    const prepared: string[] = []
    vi.spyOn(federation, 'prepare').mockImplementation((file) => {
      prepared.push(file.path)
      return new Promise(() => {})
    })
    answers.set('C:\\m\\arc.ifc', { files: [{ path: 'C:\\m\\arc.ifc', name: 'arc.ifc', size: 10 }], refused: [] })
    await openPayload(payload({ path: 'C:\\m\\arc.ifc', name: 'arc.ifc', key: 'arc' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(prepared).toEqual(['C:\\m\\arc.ifc'])
    expect(useShell.getState().initErr).toBe('')
  })
})
