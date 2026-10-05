/**
 * The landing page's state: the upload rows' derived values, the drop zone, the warning banner
 * and the rule that every failure comes back here.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_FEDERATION } from '../../src/shared/federate'
import { bootFailed } from '../../src/renderer/model/upload-pipeline'
import { uploadRows } from '../../src/renderer/state/selectors/uploads'
import { useShell } from '../../src/renderer/state/shell'

const initial = useShell.getState()

beforeEach(() => {
  useShell.setState({
    ...initial,
    uploads: [],
    booted: false,
    ready: false,
    initErr: '',
    dragging: false,
    federation: EMPTY_FEDERATION,
    byId: EMPTY_FEDERATION.byId
  })
})

describe('uploadRows — `renderVals()`’s upload block (`:1926`)', () => {
  it('derives busy, size, percentage label and the two colours', () => {
    const [row] = uploadRows([
      { id: 'u1', name: 'arc.ifc', stage: 'parsing entities', pct: 38, kb: 2048 }
    ])
    expect(row).toMatchObject({
      busy: true,
      size: '2.0 MB',
      pctLabel: '38%',
      barColor: 'var(--accent)',
      stageColor: 'var(--faint)'
    })
  })

  it('a finished row is not busy and turns green', () => {
    const [row] = uploadRows([
      { id: 'u1', name: 'arc.ifc', stage: 'ready', pct: 100, kb: 10, done: true }
    ])
    expect(row).toMatchObject({
      busy: false,
      barColor: 'var(--ok-ink)',
      stageColor: 'var(--ok-ink)',
      pctLabel: '100%'
    })
  })

  it('a rejected row is not busy, prints no percentage and is amber', () => {
    const [row] = uploadRows([
      { id: 'e1', name: 'plan.rvt', stage: 'not an IFC file', pct: 0, error: true, dismiss: true }
    ])
    expect(row).toMatchObject({
      busy: false,
      pctLabel: '',
      stageColor: 'var(--warn-ink)',
      dismiss: true,
      size: ''
    })
  })
})

describe('the store’s landing keys', () => {
  it('starts on the landing page with nothing loaded (`showLanding: !booted`)', () => {
    expect(useShell.getState().booted).toBe(false)
    expect(useShell.getState().library).toEqual([])
    expect(useShell.getState().uploads).toEqual([])
  })

  it('setDragging is what turns the drop zone accent', () => {
    useShell.getState().setDragging(true)
    expect(useShell.getState().dragging).toBe(true)
    useShell.getState().setDragging(false)
    expect(useShell.getState().dragging).toBe(false)
  })

  it('adds, patches and drops one row', () => {
    const st = useShell.getState()
    st.addUpload({ id: 'u1', name: 'a.ifc', stage: 'reading file', pct: 5 })
    st.addUpload({ id: 'u2', name: 'b.ifc', stage: 'reading file', pct: 5 })
    st.patchUpload('u1', { pct: 64, stage: 'building geometry' })
    expect(useShell.getState().uploads[0]).toMatchObject({ pct: 64, stage: 'building geometry' })
    expect(useShell.getState().uploads[1]).toMatchObject({ pct: 5 })
    st.dropUpload('u1')
    expect(useShell.getState().uploads.map((u) => u.id)).toEqual(['u2'])
  })

  it('the banner is dismissible, as `:753` is', () => {
    useShell.getState().setInitErr('boom')
    expect(useShell.getState().initErr).toBe('boom')
    useShell.getState().setInitErr('')
    expect(useShell.getState().initErr).toBe('')
  })
})

describe('failure routing — never leave the user on a broken viewer', () => {
  it('bootFailed returns to the landing page with the design’s own sentence (`:1114`)', () => {
    useShell.setState({ booted: true, ready: true })
    bootFailed(new Error('the model contains no geometry'))
    const st = useShell.getState()
    expect(st.booted).toBe(false)
    expect(st.ready).toBe(false)
    expect(st.initErr).toBe('Could not open that model — the model contains no geometry.')
  })

  it('accepts a thrown non-Error too', () => {
    bootFailed('WebGL context lost')
    expect(useShell.getState().initErr).toBe('Could not open that model — WebGL context lost.')
  })

  it('an empty federation is not booted, so unloading the last model shows the landing', () => {
    useShell.setState({ booted: true, ready: true })
    useShell.getState().commitModels(EMPTY_FEDERATION)
    expect(useShell.getState().booted).toBe(false)
    expect(useShell.getState().ready).toBe(false)
  })
})
