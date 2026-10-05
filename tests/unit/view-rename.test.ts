/**
 * Renaming a saved viewpoint (2026-09-24, owner-requested: *"allow double click to edit saved
 * view name."*). The card's field commits through `renameView`; this is the commit logic —
 * trimmed, blank or unchanged keeps the old name and writes nothing — and the persistence,
 * which is the list's own (`storeViews`, per building). Esc's cancel is the card's and is
 * covered end to end (`tests/e2e/smoke.spec.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { federate } from '../../src/shared/federate'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { loadViews, viewsKeyFor } from '../../src/renderer/state/persist'
import { renameViews, type Viewpoint } from '../../src/renderer/state/selectors/views'
import { setViewer, useShell } from '../../src/renderer/state/shell'
import { memoryStorage, resetShell, stubViewer } from './stub-viewer'

const v = (id: number, name: string): Viewpoint =>
  ({ id, name, sub: '3D', cam: null }) as unknown as Viewpoint

describe('renameViews', () => {
  const list = [v(1, 'Viewpoint 1'), v(2, 'Viewpoint 2')]

  it('renames one view, trimmed, and leaves the rest as they were', () => {
    const next = renameViews(list, 2, '  Level 3 plan  ')
    expect(next.map((x) => x.name)).toEqual(['Viewpoint 1', 'Level 3 plan'])
    expect(next[0]).toBe(list[0])
    expect(list[1].name).toBe('Viewpoint 2')
  })

  it('keeps the old name for a blank entry, and returns the same list', () => {
    expect(renameViews(list, 1, '')).toBe(list)
    expect(renameViews(list, 1, '   ')).toBe(list)
  })

  it('returns the same list when nothing changes or the id is unknown', () => {
    expect(renameViews(list, 1, 'Viewpoint 1')).toBe(list)
    expect(renameViews(list, 99, 'x')).toBe(list)
  })

  it('applies no repeated-name rule — two views may share a name', () => {
    expect(renameViews(list, 2, 'Viewpoint 1').map((x) => x.name)).toEqual([
      'Viewpoint 1',
      'Viewpoint 1'
    ])
  })
})

describe('renameView — the store action', () => {
  const full = federate([mockModelIndex('ARC')])

  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
    resetShell()
    setViewer(
      stubViewer({
        getCamera: () => ({ theta: 1, phi: 0.5, dist: 70, half: 30, target: [0, 0, 0], proj: 'persp' })
      })
    )
    useShell.getState().commitModels(full)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('persists the new name with the list, per building', () => {
    const st = useShell.getState()
    st.saveView()
    const [saved] = useShell.getState().views
    useShell.getState().renameView(saved.id, ' Entrance ')
    expect(useShell.getState().views[0].name).toBe('Entrance')
    expect(loadViews(viewsKeyFor(full.project.building))[0].name).toBe('Entrance')
  })

  it('writes nothing for a blank name', () => {
    useShell.getState().saveView()
    const before = useShell.getState().views
    useShell.getState().renameView(before[0].id, '  ')
    expect(useShell.getState().views).toBe(before)
    expect(loadViews(viewsKeyFor(full.project.building))[0].name).toBe('Viewpoint 1')
  })
})
