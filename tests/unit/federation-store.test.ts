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
import {
  coordsFromGeoref,
  federationFrame,
  frameKey,
  modelFrame,
  projectFrame,
  type ProjectFrame
} from '../../src/shared/georef'
import type { FederationOffset, GeometryChunk } from '../../src/shared/geometry-contract.types'
import type { Georeference } from '../../src/shared/model-index.types'
import { FederationController, type BatchItem } from '../../src/renderer/model/federation-store'
import {
  basePointSource,
  coordsCaption,
  lineUpNote,
  notLinedUp
} from '../../src/renderer/state/selectors/status'
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

/**
 * 2026-10-08 — the federation is assembled in map space. `prepare` streams each model through
 * its own frame against the boot model's (M_i⁻¹ ∘ P), the store holds P, and the base point is
 * set once, at boot, from the boot model — never from a model that joins later. The worker is
 * replaced by a fake that hands back an index and records the frame it was asked to stream with.
 */
describe('map-space federation: the boot model fixes P, each model streams through its own frame', () => {
  const SITE = { placement: [12345.457, 23456.766, 5.05] as const, rotationDeg: -43.4103 }
  const bySite: Georeference = {
    source: 'IfcSite',
    sources: ['IfcSite'],
    method: 'IfcSite placement',
    site: { placement: [...SITE.placement], rotationDeg: SITE.rotationDeg }
  }
  const byConversion: Georeference = {
    source: 'IfcMapConversion',
    sources: ['IfcMapConversion'],
    method: 'IfcMapConversion',
    eastings: SITE.placement[0],
    northings: SITE.placement[1],
    orthogonalHeight: SITE.placement[2],
    xAxisAbscissa: Math.cos((SITE.rotationDeg * Math.PI) / 180),
    xAxisOrdinate: Math.sin((SITE.rotationDeg * Math.PI) / 180),
    scale: 0.001
  }
  const elsewhere: Georeference = { ...byConversion, eastings: 1000, northings: 2000 }

  /**
   * A parse worker that never runs: each key's index, and the frames it was asked to stream with.
   * A key's geometry can be made to wait for `gates[key]` first — which may reject, as a stream
   * that runs out of memory does.
   */
  function fakeParse(
    georefs: Record<string, Georeference>,
    gates: Record<string, Promise<unknown>> = {},
    far: Record<string, number> = {}
  ): { asked: Record<string, ProjectFrame | null>; askedOffset: Record<string, FederationOffset | null> } {
    const asked: Record<string, ProjectFrame | null> = {}
    const askedOffset: Record<string, FederationOffset | null> = {}
    const parse = {
      load: async (_blob: Blob, key: string) => ({ ...mockModelIndex('ARC'), modelKey: key, georef: georefs[key] }),
      geometry: async (key: string, offset: FederationOffset | null, frame: ProjectFrame | null, onChunk: (c: GeometryChunk) => void) => {
        asked[key] = frame
        askedOffset[key] = offset
        await gates[key]
        for (const chunk of mockGeometryChunks('ARC')) onChunk({ ...chunk, header: { ...chunk.header, modelKey: key } })
        // `far[key]`: the stream's own `farPlacement` warning, in metres.
        const warnings = far[key] ? [{ kind: 'farPlacement', detail: '', metres: far[key] }] : []
        return { offset: offset ?? [10, 20, 0], offsetFromThisModel: offset === null, frame, chunks: 0, warnings }
      },
      close: () => {},
      cancel: () => {}
    }
    ;(fed as unknown as { parse: typeof parse }).parse = parse
    return { asked, askedOffset }
  }
  const pick = (key: string): { path: string; name: string; blob: Blob; key: string } => ({
    path: `/x/${key}.ifc`,
    name: `${key}.ifc`,
    blob: new Blob([]),
    key
  })

  it('streams the boot model through its own site frame and a map-converted model through M⁻¹ ∘ P', async () => {
    const { asked } = fakeParse({ SITE: bySite, CONV: byConversion })
    const a = await fed.prepare(pick('SITE'), () => {})
    const b = await fed.prepare(pick('CONV'), () => {})
    expect(asked.SITE).toEqual(projectFrame(bySite))
    expect(asked.CONV).toEqual(modelFrame(bySite, byConversion))
    expect(b.frame).toEqual(asked.CONV)
    await fed.addBatch([a, b])
    // The store holds P — for a boot model placed by its site, its site frame, key and all.
    expect(useShell.getState().frame).toEqual(federationFrame(bySite))
    expect(frameKey(useShell.getState().frame)).toBe('12345.457,23456.766,5.050@-43.4103')
    // Each model's grids and storeys went through that model's own frame.
    expect(stub.metas.get('SITE')!.frame).toEqual(projectFrame(bySite))
    expect(stub.metas.get('CONV')!.frame).toEqual(asked.CONV)
  })

  it('takes P from a boot model placed by IfcMapConversion — a new frameKey, the same building', async () => {
    const { asked } = fakeParse({ CONV: byConversion, SITE: bySite })
    const a = await fed.prepare(pick('CONV'), () => {})
    const b = await fed.prepare(pick('SITE'), () => {})
    // The boot model streams as it always did: its site is at the file's zero.
    expect(asked.CONV).toBeNull()
    expect(asked.SITE).toEqual(modelFrame(byConversion, bySite))
    await fed.addBatch([a, b])
    expect(frameKey(useShell.getState().frame)).toBe('12345.457,23456.766,5.050@-43.4103')
  })

  it('sets the base point once, at boot, from the boot model — a later model never fills it', async () => {
    fakeParse({ PLAIN: { source: 'none', sources: [], method: 'none' }, CONV: byConversion, FAR: elsewhere })
    await fed.addBatch([await fed.prepare(pick('PLAIN'), () => {})])
    // The boot model states nothing, so P is the identity and the card stays blank…
    expect(useShell.getState().coords).toEqual({ E: null, N: null, Z: null, angle: null })
    await fed.addBatch([await fed.prepare(pick('CONV'), () => {})])
    // …and a georeferenced model that joins later does not fill it with numbers that describe
    // its own frame rather than the scene's.
    expect(useShell.getState().coords).toEqual({ E: null, N: null, Z: null, angle: null })
    expect(useShell.getState().frame).toBeNull()
  })

  it('takes the base point from P when the boot model states one', async () => {
    fakeParse({ CONV: byConversion, FAR: elsewhere })
    await fed.addBatch([await fed.prepare(pick('CONV'), () => {})])
    expect(useShell.getState().coords).toEqual(coordsFromGeoref(byConversion))
    expect(stub.calls).toContain('setCoords')
    await fed.addBatch([await fed.prepare(pick('FAR'), () => {})])
    expect(useShell.getState().coords).toEqual(coordsFromGeoref(byConversion))
  })

  /**
   * 2026-10-08 — the part-1 review's deferred item. The store keeps the declaration that defined
   * P beside it (`bootGeoref`), and the base point, the chips, the caption and `basePointSource`
   * are read off that — so they stay right after the boot model is unloaded, and describe the
   * frame in use.
   */
  it('keeps the base point, the chip, the caption and whose it is after the boot model is unloaded', async () => {
    fakeParse({ CONV: byConversion, SITE: bySite })
    await fed.addBatch([await fed.prepare(pick('CONV'), () => {}), await fed.prepare(pick('SITE'), () => {})])
    const coords = useShell.getState().coords
    expect(useShell.getState().bootGeoref).toBe(byConversion)
    await fed.removeModel('CONV')
    expect(useShell.getState().loaded).toEqual(['SITE'])
    // The frame stays — SITE stands in it — and so does what describes it.
    expect(useShell.getState().frame).toEqual(federationFrame(byConversion))
    expect(useShell.getState().bootGeoref).toBe(byConversion)
    expect(useShell.getState().coords).toBe(coords)
    expect(coordsCaption(useShell.getState().bootGeoref)).toBe(' · IfcMapConversion')
    expect(basePointSource(useShell.getState().bootGeoref)).toBe('file')
  })

  it('describes the frame in use when the boot model failed after another stood in it', async () => {
    let fail = (_e: Error): void => {}
    const held = new Promise((_ok, no) => (fail = no))
    fakeParse({ BAD: elsewhere, B: bySite }, { BAD: held })
    const bad = fed.prepare(pick('BAD'), () => {})
    const b = await fed.prepare(pick('B'), () => {})
    fail(new Error('out of memory'))
    await expect(bad).rejects.toThrow('out of memory')
    await fed.addBatch([b])
    // BAD's declaration defined the frame B was placed in: the base point is that frame's.
    expect(useShell.getState().bootGeoref).toBe(elsewhere)
    expect(useShell.getState().coords).toEqual(coordsFromGeoref(elsewhere))
  })

  it('clears the base point with the frame when nothing is loaded, and the next boot sets its own', async () => {
    fakeParse({ CONV: byConversion, SITE: bySite })
    await fed.addBatch([await fed.prepare(pick('CONV'), () => {})])
    await fed.removeModel('CONV')
    // It used to stay standing here, and the next boot — finding it set — kept it.
    expect(useShell.getState()).toMatchObject({ bootGeoref: null, coords: { E: null, N: null, Z: null, angle: null } })
    await fed.addBatch([await fed.prepare(pick('SITE'), () => {})])
    expect(useShell.getState().bootGeoref).toBe(bySite)
    expect(useShell.getState().coords).toEqual(coordsFromGeoref(bySite))
  })

  it('records how far a model landed from the offset another model set — never the one that set it', async () => {
    fakeParse({ A: bySite, B: elsewhere }, {}, { A: 7_000, B: 25_524 })
    const a = await fed.prepare(pick('A'), () => {})
    const b = await fed.prepare(pick('B'), () => {})
    // A set the offset: its distance is from its own first part, which says nothing about others.
    expect(a.index.farPlacementMetres).toBeUndefined()
    expect(b.index.farPlacementMetres).toBe(25_524)
    await fed.addBatch([a, b])
    expect(lineUpNote(notLinedUp({ ...useShell.getState(), federation: fed.current }))).toBe(
      // The fake parse hands back the mock's own file name for every key.
      'SB_ARC_R25.ifc could not be lined up — it sits 25.5 km from the others.'
    )
  })
  it('hands the frame back when the boot model fails before anything stands in it', async () => {
    // The first file parsed chooses the frame, and its stream then fails: nothing is loaded and
    // nothing else was streamed in that frame, so the next file chooses afresh — its own site
    // frame, its own offset, and the card's base point from it, not from a file that is not there.
    const { asked, askedOffset } = fakeParse(
      { BAD: elsewhere, GOOD: bySite },
      { BAD: Promise.reject(new Error('out of memory')) }
    )
    await expect(fed.prepare(pick('BAD'), () => {})).rejects.toThrow('out of memory')
    const good = await fed.prepare(pick('GOOD'), () => {})
    expect(asked.GOOD).toEqual(projectFrame(bySite))
    expect(askedOffset.GOOD).toBeNull()
    await fed.addBatch([good])
    expect(useShell.getState().frame).toEqual(federationFrame(bySite))
    expect(useShell.getState().coords).toEqual(coordsFromGeoref(bySite))
  })

  it('keeps the frame once another model stands in it, so nothing it placed moves', async () => {
    let fail = (_e: Error): void => {}
    const held = new Promise((_ok, no) => (fail = no))
    const { asked } = fakeParse({ BAD: elsewhere, B: bySite, C: byConversion }, { BAD: held })
    const bad = fed.prepare(pick('BAD'), () => {})
    // BAD's parse finishes first and chooses the frame; B is streamed in it while BAD's own
    // stream is still running.
    const b = await fed.prepare(pick('B'), () => {})
    expect(b.frame).toEqual(modelFrame(elsewhere, bySite))
    fail(new Error('out of memory'))
    await expect(bad).rejects.toThrow('out of memory')
    // B was placed in BAD's frame, so that frame stays: a later model lands beside B, and the
    // store describes the frame B is in.
    const c = await fed.prepare(pick('C'), () => {})
    expect(asked.C).toEqual(modelFrame(elsewhere, byConversion))
    await fed.addBatch([b, c])
    expect(useShell.getState().frame).toEqual(federationFrame(elsewhere))
  })
})
