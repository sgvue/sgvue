/**
 * 2026-11-11 — when the federation offset is handed back (`federation-store.ts`, `offset`): only
 * when nothing is loaded **and** no model streamed against it is still on its way to joining. A
 * model is on its way from its geometry request until its `prepare` fails, its item has been
 * through `addBatch` (whatever the outcome), or it is `forget`-ten. These pin each way out, with
 * the federation already emptied while the model was on its way: the last one to leave hands the
 * offset back, so the next model is asked with `null` and chooses its own.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mockGeometryChunks, mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import type { FederationOffset, GeometryChunk } from '../../src/shared/geometry-contract.types'
import { FederationController } from '../../src/renderer/model/federation-store'
import { disposeFederation, resetShell, stubViewer } from './stub-viewer'

let fed: FederationController
/** Keys whose join into the scene the viewer refuses. */
let refuse: Set<string>

beforeEach(() => {
  resetShell()
  refuse = new Set()
  fed = new FederationController()
  fed.attach(
    stubViewer({
      addModel: async (key: string) => {
        if (refuse.has(key)) throw new Error(`the scene could not take ${key}`)
      },
      removeModel: () => [],
      debug: () => ({}),
      elementIds: () => []
    })
  )
})
afterEach(() => disposeFederation(fed))

/**
 * A parse worker that never runs: a key's geometry waits for `gates[key]` first, and each stream
 * that is asked with `null` chooses the offset next in `chosen`, so a kept offset shows.
 */
function fakeParse(gates: Record<string, Promise<unknown>> = {}): Record<string, FederationOffset | null> {
  const asked: Record<string, FederationOffset | null> = {}
  let n = 0
  const parse = {
    load: async (_blob: Blob, key: string) => ({ ...mockModelIndex('ARC'), modelKey: key }),
    geometry: async (key: string, offset: FederationOffset | null, onChunk: (c: GeometryChunk) => void) => {
      asked[key] = offset
      await gates[key]
      for (const chunk of mockGeometryChunks('ARC')) onChunk({ ...chunk, header: { ...chunk.header, modelKey: key } })
      return { offset: offset ?? [100 * ++n, 0, 0], offsetFromThisModel: offset === null, chunks: 0, warnings: [], bbox6: [0, 0, 0, 2, 2, 2] }
    },
    close: () => {},
    cancel: () => {}
  }
  ;(fed as unknown as { parse: typeof parse }).parse = parse
  return asked
}
const pick = (key: string): { path: string; name: string; blob: Blob; key: string } => ({
  path: `/x/${key}.ifc`,
  name: `${key}.ifc`,
  blob: new Blob([]),
  key
})
const gate = (): { held: Promise<unknown>; fail: (e: Error) => void } => {
  let fail = (_e: Error): void => {}
  const held = new Promise((_ok, no) => (fail = no))
  held.catch(() => {})
  return { held, fail }
}

describe('the offset is kept while a model is on its way, and handed back by the last to leave', () => {
  it('kept through an unload while B streams; handed back when B’s prepare then fails', async () => {
    const b = gate()
    const asked = fakeParse({ B: b.held })
    await fed.addBatch([await fed.prepare(pick('A'), () => {})])
    const offsetA = asked.A ?? [100, 0, 0]
    const pending = fed.prepare(pick('B'), () => {})
    await Promise.resolve()
    expect(asked.B).toEqual(offsetA)
    await fed.removeModel('A')
    // Kept: B asked for its geometry against it.
    await fed.prepare(pick('K'), () => {}).then((k) => fed.forget(k.index.modelKey))
    expect(asked.K).toEqual(offsetA)
    b.fail(new Error('out of memory'))
    await expect(pending).rejects.toThrow('out of memory')
    // B was the last on its way and nothing is loaded: the next chooses its own.
    await fed.prepare(pick('C'), () => {})
    expect(asked.C).toBeNull()
  })

  it('handed back when the last prepared model is forgotten after an unload', async () => {
    const asked = fakeParse()
    await fed.addBatch([await fed.prepare(pick('A'), () => {})])
    const b = await fed.prepare(pick('B'), () => {})
    await fed.removeModel('A')
    const k = await fed.prepare(pick('K'), () => {})
    expect(asked.K).toEqual(b.offset)
    fed.forget('K')
    fed.forget('B')
    await fed.prepare(pick('C'), () => {})
    expect(asked.C).toBeNull()
    expect(k.offset).toEqual(b.offset)
  })

  it('handed back once a failed boot batch is over, its items gone with nothing loaded', async () => {
    const asked = fakeParse()
    refuse.add('A')
    const a = await fed.prepare(pick('A'), () => {})
    await expect(fed.addBatch([a])).rejects.toThrow('the scene could not take A')
    await fed.prepare(pick('C'), () => {})
    expect(asked.C).toBeNull()
  })

  it('handed back once a joined model is unloaded: joining ends its way', async () => {
    const asked = fakeParse()
    await fed.addBatch([await fed.prepare(pick('A'), () => {})])
    await fed.removeModel('A')
    await fed.prepare(pick('C'), () => {})
    expect(asked.C).toBeNull()
  })
})

describe('a model forgotten while its boot batch is joining keeps the offset', () => {
  /**
   * 2026-11-11, deep review: `forget` releases only a prepared item no batch holds (`joining`).
   * While a boot batch holding K's item is mid-join — the viewer's `addModel` for K not yet
   * resolved, the federation still empty — a `forget(K)` must not hand the offset back, or a model
   * prepared meanwhile is asked with `null` and chooses an origin of its own beside K.
   */
  let releaseJoin: () => void = () => {}
  beforeEach(() => {
    const held = new Promise<void>((ok) => (releaseJoin = ok))
    fed.attach(
      stubViewer({
        addModel: async (key: string) => {
          if (key === 'K') await held
        },
        removeModel: () => [],
        debug: () => ({}),
        elementIds: () => []
      })
    )
  })

  it('forget(K) mid-join: a model prepared after it is still asked with K’s offset', async () => {
    const asked = fakeParse()
    const k = await fed.prepare(pick('K'), () => {})
    expect(asked.K).toBeNull()
    const joining = fed.addBatch([k])
    await Promise.resolve()
    expect(fed.current.models).toHaveLength(0)
    fed.forget('K')
    await fed.prepare(pick('M'), () => {})
    expect(asked.M).toEqual(k.offset)
    releaseJoin()
    await joining
  })
})
