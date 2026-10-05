/**
 * The boot-batch framing rule.
 *
 * `SGVue.dc.html:1096` (`boot`) builds the whole federation before it creates the viewer, so
 * the camera is framed **once**, with every model present. `:917` (`setModels`) reads the
 * camera, rebuilds and puts it back, so every later change preserves it. Streaming the models
 * in one at a time silently loses that: the first model frames on its own bounding box and the
 * rest inherit it, which is how a four-discipline boot ended up framed on Architecture.
 *
 * These tests drive `FederationController` against a recording stub, so the rule is checked
 * without a GPU — the thing a parity screenshot only catches after the fact.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mockGeometryChunks, mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { FederationController, type BatchItem } from '../../src/renderer/model/federation-store'
import { useShell } from '../../src/renderer/state/shell'
import type { ModelMeta, Viewer } from '../../src/renderer/viewer/viewer-core'
import { disposeFederation, resetShell, stubViewer } from './stub-viewer'

/** Every viewer call the controller and `commitModels` make, in order. */
function recordingViewer(): { viewer: Viewer; calls: string[]; metas: Map<string, ModelMeta> } {
  const calls: string[] = []
  const metas = new Map<string, ModelMeta>()
  const viewer = stubViewer({
    addModel: async (modelKey: string, _slot: number, _chunks: unknown, meta?: ModelMeta) => {
      calls.push(`addModel:${modelKey}`)
      if (meta) metas.set(modelKey, meta)
    },
    removeModel: (modelKey: string) => {
      calls.push(`removeModel:${modelKey}`)
      return []
    },
    frameExtents: () => calls.push('frameExtents'),
    setCoords: () => calls.push('setCoords'),
    debug: () => ({}),
    elementIds: () => []
  })
  return { viewer, calls, metas }
}

const item = (key: string): BatchItem => ({
  index: mockModelIndex(key),
  chunks: mockGeometryChunks(key),
  offset: [0, 0, 0],
  frame: null
})

let fed: FederationController
let stub: ReturnType<typeof recordingViewer>

beforeEach(() => {
  resetShell()
  fed = new FederationController()
  stub = recordingViewer()
  fed.attach(stub.viewer)
})
// Each commit queues an SQL index build: it is stopped and settled here, never after the file.
afterEach(() => disposeFederation(fed))

describe('boot-batch framing', () => {
  it('frames once, after every model of the boot batch is in', async () => {
    await fed.addBatch([item('ARC'), item('STR'), item('SIT'), item('MEP')])
    expect(stub.calls.filter((c) => c === 'frameExtents')).toHaveLength(1)
    // …and only when the last one has landed, never on the first model's own box.
    expect(stub.calls.filter((c) => c.startsWith('addModel') || c === 'frameExtents')).toEqual([
      'addModel:ARC',
      'addModel:STR',
      'addModel:SIT',
      'addModel:MEP',
      'frameExtents'
    ])
    expect(fed.current.models.map((m) => m.meta.modelKey)).toEqual(['ARC', 'STR', 'SIT', 'MEP'])
  })

  it('gives the level tag the AUTHORED elevation, whatever the offset is', async () => {
    // The tag is a readout and the ring is geometry: one must never be the other. A storey the
    // ladder calls `+0` has to print `+0` beside a ring drawn at scene z = 1.
    await fed.addBatch([{ ...item('ARC'), offset: [10, 20, -1] }])
    const storeys = stub.metas.get('ARC')!.storeys!
    const authored = mockModelIndex('ARC').storeys
    expect(storeys.map((s) => s.authored)).toEqual(authored.map((s) => s.elev))
    // `elev` is the project height the ring is drawn from — the offset is the viewer's to
    // subtract — and it is untouched by the tag's number.
    expect(storeys.map((s) => s.elev)).toEqual(authored.map((s) => s.elev))
    expect(useShell.getState().offset).toEqual([10, 20, -1])
  })

  it('preserves the camera on a later addition — the design’s setModels', async () => {
    await fed.addBatch([item('ARC'), item('STR')])
    stub.calls.length = 0
    await fed.addBatch([item('SIT')])
    expect(stub.calls).toContain('addModel:SIT')
    expect(stub.calls).not.toContain('frameExtents')
  })

  it('preserves the camera on a removal', async () => {
    await fed.addBatch([item('ARC'), item('STR')])
    stub.calls.length = 0
    await fed.removeModel('STR')
    expect(stub.calls).toContain('removeModel:STR')
    expect(stub.calls).not.toContain('frameExtents')
    expect(fed.current.models.map((m) => m.meta.modelKey)).toEqual(['ARC'])
  })

  it('frames again for the batch that reopens an emptied federation', async () => {
    await fed.addBatch([item('ARC')])
    await fed.removeModel('ARC')
    expect(fed.current.models).toHaveLength(0)
    stub.calls.length = 0
    await fed.addBatch([item('STR')])
    expect(stub.calls.filter((c) => c === 'frameExtents')).toHaveLength(1)
  })

  it('a single model is a boot batch of one, and frames', async () => {
    await fed.addModel(mockModelIndex('ARC'), mockGeometryChunks('ARC'), [0, 0, 0])
    expect(stub.calls.filter((c) => c === 'frameExtents')).toHaveLength(1)
  })

  it('commits the store once per batch, with the whole federation', async () => {
    await fed.addBatch([item('ARC'), item('STR')])
    const s = useShell.getState()
    expect(s.loaded).toEqual(['ARC', 'STR'])
    expect(s.visibleCount).toBe(fed.current.elements.length)
    expect(s).toMatchObject({ booted: true, ready: true })
  })

  it('does nothing at all for an empty batch', async () => {
    await fed.addBatch([])
    expect(stub.calls).toEqual([])
  })
})

/**
 * 2026-09-24 — the landing page's hand-off. The build overlaps the tick hold, and the commit
 * (which is what reveals the viewer) waits for the hold; a new pick during the hold replaces
 * the load, so nothing of it may be committed.
 */
describe('reveal and the landing page fresh start', () => {
  const held = (): { hold: Promise<void>; release: () => void } => {
    let release = (): void => {}
    const hold = new Promise<void>((done) => (release = done))
    return { hold, release }
  }

  it('builds the scene at once but commits only when the reveal is due', async () => {
    const { hold, release } = held()
    const shown = fed.addBatch([item('ARC')], hold)
    await Promise.resolve()
    expect(stub.calls).toContain('addModel:ARC')
    expect(useShell.getState().booted).toBe(false)
    release()
    expect(await shown).toBe(true)
    expect(useShell.getState()).toMatchObject({ booted: true, loaded: ['ARC'] })
  })

  it('a reset during the hold commits nothing and takes the models back out of the scene', async () => {
    const { hold, release } = held()
    const shown = fed.addBatch([item('ARC'), item('STR')], hold)
    await Promise.resolve()
    fed.resetUnshown()
    release()
    expect(await shown).toBe(false)
    expect(useShell.getState()).toMatchObject({ booted: false, loaded: [] })
    expect(stub.calls).toEqual(expect.arrayContaining(['removeModel:ARC', 'removeModel:STR']))
    expect(fed.current.models).toHaveLength(0)
  })
})
