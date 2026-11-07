/**
 * 2026-11-08 — the `.sgvue` project file, phase 5 (plan D10): a drop with a project in it. The
 * pure rule (`shared/project-drop.ts`) and the upload pipeline's routing (`dropFiles`): a project
 * goes to main by the IFC drop's own path route (`pathForFile`), alone; the rest of the drop gets
 * the designed error row, once main has sent the project; a drop with no project is today's.
 *
 * No Electron and no worker: the bridge is stubbed, and so is the parse (`federation.prepare`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { federation, type BatchItem } from '../../src/renderer/model/federation-store'
import { disposeUploads, dropFiles } from '../../src/renderer/model/upload-pipeline'
import { useShell } from '../../src/renderer/state/shell'
import {
  DROPPED_WITH_PROJECT,
  ONE_PROJECT_AT_A_TIME,
  PROJECT_NOT_ON_DISK,
  isProjectFileName,
  projectDrop
} from '../../src/shared/project-drop'

describe('projectDrop — the rule', () => {
  it('is nothing for a drop with no project in it: an IFC drop, as before', () => {
    expect(projectDrop([])).toBeNull()
    expect(projectDrop(['a.ifc', 'b.ifczip', 'notes.txt', 'x.sgvue.bak'])).toBeNull()
  })

  it('opens the project alone, and names every other file with why', () => {
    expect(projectDrop(['ARC.ifc', 'Review.SGVUE', 'Other.sgvue', 'STR.ifc'])).toEqual({
      project: 1,
      ignored: [
        { index: 0, reason: DROPPED_WITH_PROJECT },
        { index: 2, reason: ONE_PROJECT_AT_A_TIME },
        { index: 3, reason: DROPPED_WITH_PROJECT }
      ]
    })
    expect(projectDrop(['only.sgvue'])).toEqual({ project: 0, ignored: [] })
  })

  it('knows a project by its extension, any case', () => {
    expect(['a.sgvue', 'A.SGVUE', 'a.b.Sgvue'].map(isProjectFileName)).toEqual([true, true, true])
    expect(['a.sgv', 'sgvue', 'a.sgvue.json', 'a.ifc'].map(isProjectFileName)).toEqual([false, false, false, false])
  })
})

describe('dropFiles — routing', () => {
  const INITIAL = useShell.getState()
  let openDropped: ReturnType<typeof vi.fn>
  let admitPaths: ReturnType<typeof vi.fn>
  const file = (name: string): File => new File(['x'], name)
  const rows = (): [string, string][] => useShell.getState().uploads.map((u) => [u.name, u.stage])

  beforeEach(() => {
    vi.useFakeTimers()
    useShell.setState({ ...INITIAL, uploads: [], booted: true })
    openDropped = vi.fn(async () => true)
    admitPaths = vi.fn(async (paths: string[]) => ({
      files: paths.map((p) => ({ path: p, name: p.split('/').pop()!, size: 1 })),
      refused: []
    }))
    vi.stubGlobal('window', {
      sgvue: {
        pathForFile: (f: File) => (f.name.startsWith('mail-') ? '' : `/drop/${f.name}`),
        openDroppedProject: openDropped,
        admitPaths,
        fileUrl: async () => ({ url: 'sgvue-file://t/x' }),
        addRecent: async () => [],
        confirmReplace: async () => true
      }
    })
    vi.stubGlobal('fetch', async () => new Response('ISO-10303-21;'))
    vi.spyOn(federation, 'prepare').mockImplementation(() => new Promise<BatchItem>(() => {}))
    vi.spyOn(federation, 'isOpen').mockReturnValue(false)
  })

  afterEach(() => {
    disposeUploads()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('a project goes to main by its dropped path, and the rest of the drop is named, not opened', async () => {
    await dropFiles([file('ARC.ifc'), file('Review.sgvue'), file('Other.sgvue')])
    expect(openDropped).toHaveBeenCalledTimes(1)
    expect(openDropped).toHaveBeenCalledWith('/drop/Review.sgvue')
    expect(admitPaths).not.toHaveBeenCalled()
    expect(federation.prepare).not.toHaveBeenCalled()
    expect(rows()).toEqual([
      ['ARC.ifc', DROPPED_WITH_PROJECT],
      ['Other.sgvue', ONE_PROJECT_AT_A_TIME]
    ])
  })

  it('names nothing when main sent no project — a Cancel in the question, or the same drop heard twice', async () => {
    openDropped.mockResolvedValue(false)
    await dropFiles([file('ARC.ifc'), file('Review.sgvue')])
    expect(rows()).toEqual([])
  })

  it('a project that is not a file on disk names no path: its own row, and main is not asked', async () => {
    await dropFiles([file('mail-Review.sgvue')])
    expect(openDropped).not.toHaveBeenCalled()
    expect(rows()).toEqual([['mail-Review.sgvue', PROJECT_NOT_ON_DISK]])
  })

  it('a drop with no project is an IFC drop, exactly as before', async () => {
    await dropFiles([file('ARC.ifc')])
    await vi.advanceTimersByTimeAsync(0)
    expect(openDropped).not.toHaveBeenCalled()
    expect(admitPaths).toHaveBeenCalledWith(['/drop/ARC.ifc'])
  })
})
