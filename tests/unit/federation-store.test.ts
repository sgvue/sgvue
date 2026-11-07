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
import { coordsFromGeoref, readoutCoords } from '../../src/shared/georef'
import type { FederationOffset, GeometryChunk } from '../../src/shared/geometry-contract.types'
import type { Georeference } from '../../src/shared/model-index.types'
import { FederationController, drawnCentreOf, type BatchItem } from '../../src/renderer/model/federation-store'
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
    setPlanRotation: (deg: number) => calls.push(`setPlanRotation:${deg}`),
    setCoords: (c: unknown) => calls.push(`setCoords:${JSON.stringify(c)}`),
    debug: () => ({}),
    elementIds: () => []
  })
  return { viewer, calls, metas }
}

const item = (key: string): BatchItem => ({
  index: mockModelIndex(key),
  chunks: mockGeometryChunks(key),
  offset: [0, 0, 0]
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
/**
 * 2026-11-07 — the plan rotation is the federation's: handed to the viewer before a boot frames,
 * so the camera starts square with the grids, and again at every commit; the store keeps it for
 * the assistant's read-back. Never a model moved — only the camera.
 */
describe('the plan rotation', () => {
  /** The mock's ARC with its grids turned by `deg` about the origin. */
  const turned = (key: string, deg: number): BatchItem => {
    const base = item(key)
    const a = (deg * Math.PI) / 180
    const t = (p: readonly [number, number]): [number, number] => [
      p[0] * Math.cos(a) - p[1] * Math.sin(a),
      p[0] * Math.sin(a) + p[1] * Math.cos(a)
    ]
    return {
      ...base,
      index: { ...base.index, grids: base.index.grids.map((g) => ({ ...g, start: t(g.start), end: t(g.end) })) }
    }
  }

  it('is handed over before the boot frames, and kept in the store', async () => {
    await fed.addBatch([turned('ARC', 30), turned('STR', 30)])
    const at = stub.calls.findIndex((c) => c.startsWith('setPlanRotation'))
    expect(at).toBeGreaterThanOrEqual(0)
    expect(at).toBeLessThan(stub.calls.indexOf('frameExtents'))
    expect(useShell.getState().planRotationDeg).toBeCloseTo(30, 9)
    expect(stub.calls[at]).toBe(`setPlanRotation:${useShell.getState().planRotationDeg}`)
  })

  it('is the same number whichever model boots, and 0 for the design’s square mock', async () => {
    await fed.addBatch([turned('ARC', 30), turned('STR', 12)])
    const one = useShell.getState().planRotationDeg
    await fed.removeModel('ARC')
    await fed.removeModel('STR')
    await fed.addBatch([turned('STR', 12), turned('ARC', 30)])
    expect(useShell.getState().planRotationDeg).toBe(one)
    await fed.removeModel('ARC')
    await fed.removeModel('STR')
    await fed.addBatch([item('ARC'), item('STR')])
    expect(useShell.getState().planRotationDeg).toBe(0)
  })
})

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
 * 2026-11-07 — origin to origin (the owner: *"only focus on the internal origin of the model like
 * how Naviswork do"*). `prepare` streams every model at its file's own coordinates — no frame is
 * asked for — and nothing of the georeferencing depends on which model was opened first: the base
 * point is the file `georefSourceOf` picks, recomputed at every commit, and the note names a
 * model whose own map position is not where it is drawn. The worker is replaced by a fake that
 * hands back an index and records what it was asked to stream with.
 */
describe('origin to origin: no model is moved, and nothing depends on load order', () => {
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
  const plain: Georeference = { source: 'none', sources: [], method: 'none' }
  /** The box every fake stream reports, in the scene: its centre is the offset plus (1, 1, 1). */
  const BOX = [0, 0, 0, 2, 2, 2] as const

  /**
   * A parse worker that never runs: each key's index — with `elements[key]` elements, when given
   * — and what it was asked to stream with. A key's geometry can be made to wait for `gates[key]`
   * first — which may reject, as a stream that runs out of memory does.
   */
  function fakeParse(
    georefs: Record<string, Georeference>,
    gates: Record<string, Promise<unknown>> = {},
    elements: Record<string, number> = {}
  ): { args: Record<string, unknown[]>; askedOffset: Record<string, FederationOffset | null> } {
    const args: Record<string, unknown[]> = {}
    const askedOffset: Record<string, FederationOffset | null> = {}
    const parse = {
      load: async (_blob: Blob, key: string) => {
        const index = mockModelIndex('ARC')
        const counts = elements[key] === undefined ? index.counts : { ...index.counts, elements: elements[key] }
        return { ...index, modelKey: key, georef: georefs[key], counts }
      },
      geometry: async (key: string, ...rest: unknown[]) => {
        args[key] = rest
        const offset = rest[0] as FederationOffset | null
        const onChunk = rest[1] as (c: GeometryChunk) => void
        askedOffset[key] = offset
        await gates[key]
        for (const chunk of mockGeometryChunks('ARC')) onChunk({ ...chunk, header: { ...chunk.header, modelKey: key } })
        return { offset: offset ?? [10, 20, 0], offsetFromThisModel: offset === null, chunks: 0, warnings: [], bbox6: BOX }
      },
      close: () => {},
      cancel: () => {}
    }
    ;(fed as unknown as { parse: typeof parse }).parse = parse
    return { args, askedOffset }
  }
  const pick = (key: string): { path: string; name: string; blob: Blob; key: string } => ({
    path: `/x/${key}.ifc`,
    name: `${key}.ifc`,
    blob: new Blob([]),
    key
  })
  const state = () => useShell.getState()

  it('streams every model with the offset alone — no frame — and hands grids and storeys over as the file has them', async () => {
    const { args } = fakeParse({ SITE: bySite, CONV: byConversion })
    const a = await fed.prepare(pick('SITE'), () => {})
    const b = await fed.prepare(pick('CONV'), () => {})
    // The offset and the chunk listener, and nothing that could move a model.
    expect(args.SITE).toHaveLength(2)
    expect(args.CONV).toHaveLength(2)
    expect(args.SITE[0]).toBeNull()
    expect(args.CONV[0]).toEqual([10, 20, 0])
    expect(Object.keys(a)).not.toContain('frame')
    await fed.addBatch([a, b])
    for (const key of ['SITE', 'CONV']) {
      const meta = stub.metas.get(key)!
      expect(Object.keys(meta)).not.toContain('frame')
      const index = key === 'SITE' ? a.index : b.index
      expect(meta.grids).toEqual(index.grids.map((g) => ({ name: g.name, start: [...g.start], end: [...g.end] })))
      expect(meta.storeys!.map((x) => x.elev)).toEqual(index.storeys.map((x) => (x.placement ? x.placement[2] : x.elev)))
    }
  })

  it('records where each model is drawn, the model that set the offset included', async () => {
    fakeParse({ A: bySite, B: byConversion })
    const a = await fed.prepare(pick('A'), () => {})
    const b = await fed.prepare(pick('B'), () => {})
    expect(a.index.drawnCentre).toEqual([11, 21, 1])
    expect(b.index.drawnCentre).toEqual([11, 21, 1])
    expect(drawnCentreOf([0, 0, 0, 2, 4, 6], [100, 200, 300])).toEqual([101, 202, 303])
  })

  it('takes the base point from the same file whatever the order the models are opened in', async () => {
    const seen: unknown[] = []
    for (const order of [
      ['PLAIN', 'SITE', 'CONV'],
      ['CONV', 'PLAIN', 'SITE'],
      ['SITE', 'CONV', 'PLAIN']
    ]) {
      resetShell()
      // SITE has the most elements of the two that state a georeferencing; PLAIN, the most of all.
      fakeParse({ PLAIN: plain, SITE: bySite, CONV: byConversion }, {}, { PLAIN: 900, SITE: 500, CONV: 400 })
      const items: BatchItem[] = []
      for (const key of order) items.push(await fed.prepare(pick(key), () => {}))
      await fed.addBatch(items)
      seen.push([state().georefSourceKey, state().georefSource, state().coords])
      expect(state().georefSourceKey).toBe('SITE')
      expect(state().coords).toEqual(coordsFromGeoref(bySite))
      for (const key of order) await fed.removeModel(key)
    }
    expect(seen[1]).toEqual(seen[0])
    expect(seen[2]).toEqual(seen[0])
  })

  it('follows the federation: a joining model with more elements takes the card, an unload hands it on', async () => {
    fakeParse({ CONV: byConversion, SITE: bySite, PLAIN: plain }, {}, { CONV: 400, SITE: 500, PLAIN: 900 })
    await fed.addBatch([await fed.prepare(pick('PLAIN'), () => {})])
    // The only model states nothing: the card is blank, and the readouts print dashes — as they
    // did before it loaded, so the viewer is not told anything.
    expect(state().coords).toEqual({ E: null, N: null, Z: null, angle: null })
    expect(readoutCoords(state().coords)).toEqual({ E: null, N: null, Z: null, angle: null })
    expect(stub.calls.filter((c) => c.startsWith('setCoords'))).toEqual([])
    await fed.addBatch([await fed.prepare(pick('CONV'), () => {})])
    expect([state().georefSourceKey, state().coords]).toEqual(['CONV', coordsFromGeoref(byConversion)])
    // The readouts are world coordinates, located now that a file states where it is.
    expect(stub.calls.filter((c) => c.startsWith('setCoords')).at(-1)).toBe(
      `setCoords:${JSON.stringify({ E: 0, N: 0, Z: 0, angle: 0 })}`
    )
    await fed.addBatch([await fed.prepare(pick('SITE'), () => {})])
    expect(state().georefSourceKey).toBe('SITE')
    expect(coordsCaption(state().georefSource)).toBe(' · IfcSite placement')
    // Still located: the readouts did not change, so the viewer was told once.
    expect(stub.calls.filter((c) => c.startsWith('setCoords'))).toHaveLength(1)
    await fed.removeModel('SITE')
    expect([state().georefSourceKey, state().coords]).toEqual(['CONV', coordsFromGeoref(byConversion)])
    expect(basePointSource(state().georefSource)).toBe('file')
    await fed.removeModel('CONV')
    expect([state().georefSourceKey, state().georefSource]).toEqual([null, null])
    expect(state().coords).toEqual({ E: null, N: null, Z: null, angle: null })
    expect(stub.calls.filter((c) => c.startsWith('setCoords')).at(-1)).toBe(
      `setCoords:${JSON.stringify({ E: null, N: null, Z: null, angle: null })}`
    )
  })

  it('names, in the card’s note, the model whose own map position is not where it is drawn', async () => {
    fakeParse({ SITE: bySite, CONV: byConversion })
    await fed.addBatch([await fed.prepare(pick('SITE'), () => {}), await fed.prepare(pick('CONV'), () => {})])
    const issues = notLinedUp({ ...state(), federation: fed.current })
    // SITE is drawn at its map position (its site placement is it); CONV's conversion would put
    // it 26.5 km from where its file's coordinates — near the origin — have it drawn.
    expect(issues.map((x) => x.key)).toEqual(['CONV'])
    expect(issues[0].degrees).toBeCloseTo(43.4103, 9)
    expect(lineUpNote(issues)).toBe(
      // The fake parse hands back the mock's own file name for every key.
      "SB_ARC_R25.ifc's map position is 26.5 km from where its file places it — ask for a Shared Coordinates export."
    )
  })

  it('hands the offset and the unit back when the first model fails before anything stands with it', async () => {
    const { askedOffset } = fakeParse(
      { BAD: byConversion, GOOD: bySite },
      { BAD: Promise.reject(new Error('out of memory')) }
    )
    await expect(fed.prepare(pick('BAD'), () => {})).rejects.toThrow('out of memory')
    const good = await fed.prepare(pick('GOOD'), () => {})
    expect(askedOffset.GOOD).toBeNull()
    await fed.addBatch([good])
    expect(state().georefSourceKey).toBe('GOOD')
    expect(state().coords).toEqual(coordsFromGeoref(bySite))
  })

  it('keeps the offset once another model has been streamed against it', async () => {
    let fail = (_e: Error): void => {}
    const held = new Promise((_ok, no) => (fail = no))
    const { askedOffset } = fakeParse({ BAD: byConversion, B: bySite, C: plain }, { BAD: held })
    const bad = fed.prepare(pick('BAD'), () => {})
    const b = await fed.prepare(pick('B'), () => {})
    fail(new Error('out of memory'))
    await expect(bad).rejects.toThrow('out of memory')
    const c = await fed.prepare(pick('C'), () => {})
    expect(askedOffset.C).toEqual(b.offset)
    await fed.addBatch([b, c])
    // BAD never joined, so nothing of it is described: the card is B's.
    expect(state().georefSourceKey).toBe('B')
  })
})
