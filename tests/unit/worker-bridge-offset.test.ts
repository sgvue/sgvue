/**
 * `ParseWorkerBridge.geometry` serialises `offset: null` requests among themselves, per worker
 * (2026-11-11): a `null` request made while an earlier one is unsettled waits for it and is sent
 * with the offset that stream chose, or with `null` when it failed. A request with an offset, or
 * a `null` one with nothing unsettled before it, is sent at once. So two models can never each
 * choose an offset, whatever order the worker's messages arrive in.
 *
 * A fake `Worker` records every posted request; the test answers them by hand.
 */
import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FederationOffset, GeometrySummary } from '../../src/shared/geometry-contract.types'
import type { ParseRequest, ParseResponse } from '../../src/worker/parse.worker'
import { ParseWorkerBridge } from '../../src/renderer/model/worker-bridge'

class FakeWorker {
  static all: FakeWorker[] = []
  onmessage: ((e: MessageEvent<ParseResponse>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  posted: ParseRequest[] = []
  terminated = false
  constructor() {
    FakeWorker.all.push(this)
  }
  postMessage(request: ParseRequest): void {
    if (this.terminated) throw new Error('posted to a terminated worker')
    this.posted.push(request)
  }
  terminate(): void {
    this.terminated = true
  }
  answer(message: ParseResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<ParseResponse>)
  }
}

const summaryOf = (offset: FederationOffset): GeometrySummary =>
  ({ offset, offsetFromThisModel: true, chunks: 0, warnings: [], bbox6: null }) as unknown as GeometrySummary

/** The geometry requests posted so far: key and offset, in order. */
const geometryPosted = (w: FakeWorker): [string, FederationOffset | null][] =>
  w.posted.flatMap((r) => (r.type === 'geometry' ? [[r.modelKey, r.offset] as [string, FederationOffset | null]] : []))

/** Let every queued microtask run. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

const A_OFF: FederationOffset = [12345, 23456, 5]
const B_OFF: FederationOffset = [12385, 23441, 8]

let bridge: ParseWorkerBridge
let worker: FakeWorker

beforeEach(() => {
  FakeWorker.all = []
  vi.stubGlobal('Worker', FakeWorker)
  bridge = new ParseWorkerBridge()
})
afterEach(() => {
  bridge.cancel('test over')
  vi.unstubAllGlobals()
})

/** Start a geometry request, and the worker it went to. */
function ask(key: string, offset: FederationOffset | null): Promise<GeometrySummary> {
  const p = bridge.geometry(key, offset)
  worker = FakeWorker.all[FakeWorker.all.length - 1]
  return p
}

describe('ParseWorkerBridge.geometry: null-offset requests choose one offset between them', () => {
  it('1. two null requests: the second is posted only after the first is done, with its offset', async () => {
    const a = ask('A', null)
    const b = ask('B', null)
    await flush()
    expect(geometryPosted(worker)).toEqual([['A', null]])
    worker.answer({ type: 'geometryDone', modelKey: 'A', summary: summaryOf(A_OFF) })
    expect((await a).offset).toEqual(A_OFF)
    await flush()
    expect(geometryPosted(worker)).toEqual([
      ['A', null],
      ['B', A_OFF]
    ])
    worker.answer({ type: 'geometryDone', modelKey: 'B', summary: summaryOf(A_OFF) })
    expect((await b).offset).toEqual(A_OFF)
  })

  it('2. the first fails: the second is posted with null and chooses itself', async () => {
    const a = ask('A', null)
    const b = ask('B', null)
    worker.answer({ type: 'error', modelKey: 'A', message: 'out of memory' })
    await expect(a).rejects.toThrow('out of memory')
    await flush()
    expect(geometryPosted(worker)).toEqual([
      ['A', null],
      ['B', null]
    ])
    worker.answer({ type: 'geometryDone', modelKey: 'B', summary: summaryOf(B_OFF) })
    expect((await b).offset).toEqual(B_OFF)
  })

  it('3. four in a row: each waits for the one before it and takes its offset, a failure included', async () => {
    const a = ask('A', null)
    const b = ask('B', null)
    const c = ask('C', null)
    const d = ask('D', null)
    await flush()
    expect(geometryPosted(worker)).toEqual([['A', null]])
    worker.answer({ type: 'geometryDone', modelKey: 'A', summary: summaryOf(A_OFF) })
    await a
    await flush()
    // C still waits for B, which was sent with A's offset.
    expect(geometryPosted(worker)).toEqual([
      ['A', null],
      ['B', A_OFF]
    ])
    worker.answer({ type: 'geometryDone', modelKey: 'B', summary: summaryOf(A_OFF) })
    await b
    await flush()
    expect(geometryPosted(worker).at(-1)).toEqual(['C', A_OFF])
    // C fails, having been sent with A's offset: D is sent with A's offset too — never `null`,
    // which would let it choose one of its own (review round 1).
    worker.answer({ type: 'error', modelKey: 'C', message: 'refused' })
    await expect(c).rejects.toThrow('refused')
    await flush()
    expect(geometryPosted(worker).at(-1)).toEqual(['D', A_OFF])
    worker.answer({ type: 'geometryDone', modelKey: 'D', summary: summaryOf(A_OFF) })
    expect((await d).offset).toEqual(A_OFF)
    expect(geometryPosted(worker)).toHaveLength(4)
  })

  it('4. a request with an offset is posted at once, even while a null one is unsettled', async () => {
    const a = ask('A', null)
    const b = ask('B', A_OFF)
    expect(geometryPosted(worker)).toEqual([
      ['A', null],
      ['B', A_OFF]
    ])
    worker.answer({ type: 'geometryDone', modelKey: 'B', summary: summaryOf(A_OFF) })
    worker.answer({ type: 'geometryDone', modelKey: 'A', summary: summaryOf(A_OFF) })
    await Promise.all([a, b])
  })

  it('5. a null request after the previous one settled is posted at once, as null', async () => {
    const a = ask('A', null)
    worker.answer({ type: 'geometryDone', modelKey: 'A', summary: summaryOf(A_OFF) })
    await a
    await flush()
    const b = ask('B', null)
    // At once — not a microtask later.
    expect(geometryPosted(worker)).toEqual([
      ['A', null],
      ['B', null]
    ])
    worker.answer({ type: 'geometryDone', modelKey: 'B', summary: summaryOf(B_OFF) })
    expect((await b).offset).toEqual(B_OFF)
  })

  it('6. cancel() while one is held rejects it, and nothing is posted afterwards', async () => {
    const a = ask('A', null)
    const b = ask('B', null)
    const first = worker
    bridge.cancel('replaced by a new pick')
    await expect(a).rejects.toThrow('replaced by a new pick')
    await expect(b).rejects.toThrow('replaced by a new pick')
    await flush()
    expect(first.terminated).toBe(true)
    expect(geometryPosted(first)).toEqual([['A', null]])
    // A fresh worker starts with nobody to wait for.
    const c = ask('C', null)
    expect(worker).not.toBe(first)
    expect(geometryPosted(worker)).toEqual([['C', null]])
    worker.answer({ type: 'geometryDone', modelKey: 'C', summary: summaryOf(B_OFF) })
    expect((await c).offset).toEqual(B_OFF)
  })

  it('a second request for a held key is refused as before', async () => {
    const a = ask('A', null)
    const b = ask('B', null)
    await expect(bridge.geometry('B', null)).rejects.toThrow('already streaming geometry for "B"')
    worker.answer({ type: 'geometryDone', modelKey: 'A', summary: summaryOf(A_OFF) })
    await a
    await flush()
    worker.answer({ type: 'geometryDone', modelKey: 'B', summary: summaryOf(A_OFF) })
    await b
    expect(geometryPosted(worker)).toEqual([
      ['A', null],
      ['B', A_OFF]
    ])
  })

  it('(a) a held request rejected alone, its predecessor still streaming: the next still gets the predecessor’s outcome', async () => {
    const a = ask('A', null)
    const b = ask('B', null)
    const c = ask('C', null)
    // B is answered by an error while it is held — never sent.
    worker.answer({ type: 'error', modelKey: 'B', message: 'closed' })
    await expect(b).rejects.toThrow('closed')
    await flush()
    expect(geometryPosted(worker)).toEqual([['A', null]])
    worker.answer({ type: 'geometryDone', modelKey: 'A', summary: summaryOf(A_OFF) })
    await a
    await flush()
    expect(geometryPosted(worker)).toEqual([
      ['A', null],
      ['C', A_OFF]
    ])
    worker.answer({ type: 'geometryDone', modelKey: 'C', summary: summaryOf(A_OFF) })
    expect((await c).offset).toEqual(A_OFF)
  })

  it('(b) a first request that fails having been sent null: the next is sent null', async () => {
    const a = ask('A', null)
    const b = ask('B', null)
    worker.answer({ type: 'error', modelKey: 'A', message: 'no geometry' })
    await expect(a).rejects.toThrow('no geometry')
    await flush()
    expect(geometryPosted(worker)).toEqual([
      ['A', null],
      ['B', null]
    ])
    worker.answer({ type: 'geometryDone', modelKey: 'B', summary: summaryOf(B_OFF) })
    await b
  })
})

/* ────────────────────────────── the simulation ────────────────────────────── */

const SEED = process.env.SIM_SEED === undefined ? 20261111 : Number(process.env.SIM_SEED)
const RUNS = Number(process.env.BRIDGE_RUNS ?? 300)

type Step = { kind: 'ask' | 'answer' | 'fail' | 'dropHeld'; pick: number }

describe('null-offset requests under every order of asks, answers and failures (fast-check)', () => {
  /**
   * Each request is made as the controller makes it — `null` until some stream has settled with
   * an offset, that offset after — at a random moment, and the worker answers posted requests in a
   * random order, each a success or a failure; a held request is sometimes answered by an error
   * alone. Invariant: once any stream has chosen an offset, every request posted after carries it
   * and every success reports it; and every request settles.
   */
  it(`seed ${SEED}: once a stream has chosen an offset, everything posted after carries it, and everything settles`, async () => {
    const tally = { failedAfterChosen: 0, droppedHeld: 0, runs: 0 }
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 6 }),
        fc.array(fc.record({ kind: fc.constantFrom<Step['kind']>('ask', 'answer', 'fail', 'dropHeld'), pick: fc.nat() }), {
          maxLength: 40
        }),
        async (n, steps) => {
          const b = new ParseWorkerBridge()
          const w = (): FakeWorker => FakeWorker.all[FakeWorker.all.length - 1]
          const settled = new Map<string, boolean>()
          const asked: string[] = []
          const answered = new Set<string>()
          let fresh = 0
          let chosen: FederationOffset | null = null
          const problems: string[] = []
          let seenPosts = 0
          /** Posted and not yet answered, in post order. */
          const open = (): { key: string; offset: FederationOffset | null }[] =>
            geometryPosted(w())
              .filter(([k]) => !answered.has(k))
              .map(([key, offset]) => ({ key, offset }))
          const held = (): string[] => asked.filter((k) => !answered.has(k) && !geometryPosted(w()).some(([p]) => p === k))
          const checkPosts = (): void => {
            const posts = geometryPosted(w())
            for (; seenPosts < posts.length; seenPosts++) {
              const [k, o] = posts[seenPosts]
              if (chosen && JSON.stringify(o) !== JSON.stringify(chosen))
                problems.push(`${k} posted with ${JSON.stringify(o)} after ${JSON.stringify(chosen)} was chosen`)
            }
          }
          const ask1 = (): void => {
            const key = `M${asked.length}`
            asked.push(key)
            settled.set(key, false)
            // As the controller does: `null` until a stream has chosen the offset, then that offset
            // (`federation-store.ts` records it when the stream settles).
            b.geometry(key, chosen).then(
              (summary) => {
                settled.set(key, true)
                if (!chosen) chosen = summary.offset
                else if (JSON.stringify(summary.offset) !== JSON.stringify(chosen))
                  problems.push(`${key} settled with ${JSON.stringify(summary.offset)}, ${JSON.stringify(chosen)} was chosen`)
              },
              () => void settled.set(key, true)
            )
          }
          const answer = (key: string, offset: FederationOffset | null, ok: boolean): void => {
            answered.add(key)
            if (!ok) {
              if (offset) tally.failedAfterChosen++
              w().answer({ type: 'error', modelKey: key, message: 'failed' })
              return
            }
            // A stream given an offset echoes it; one given null chooses its own, unlike any other.
            const o: FederationOffset = offset ?? [1000 + ++fresh, 2000, 3]
            w().answer({ type: 'geometryDone', modelKey: key, summary: summaryOf(o) })
          }
          try {
            ask1()
            for (const step of steps) {
              await flush()
              checkPosts()
              if (step.kind === 'ask') {
                if (asked.length < n) ask1()
              } else if (step.kind === 'dropHeld') {
                const h = held()
                if (h.length) {
                  tally.droppedHeld++
                  const key = h[step.pick % h.length]
                  answered.add(key)
                  w().answer({ type: 'error', modelKey: key, message: 'closed' })
                }
              } else {
                const o = open()
                if (o.length) {
                  const { key, offset } = o[step.pick % o.length]
                  answer(key, offset, step.kind === 'answer')
                }
              }
            }
            // Everything left: asked, then answered as it is posted, until nothing is outstanding.
            while (asked.length < n) ask1()
            for (let guard = 0; guard < 100 && [...settled.values()].some((v) => !v); guard++) {
              await flush()
              checkPosts()
              for (const { key, offset } of open()) answer(key, offset, true)
            }
            await flush()
            checkPosts()
            const hung = [...settled].filter(([, v]) => !v).map(([k]) => k)
            if (hung.length) problems.push(`never settled: ${hung.join(', ')}`)
            tally.runs++
            expect(problems, `posted: ${JSON.stringify(geometryPosted(w()))}`).toEqual([])
          } finally {
            b.cancel('run over')
          }
        }
      ),
      { seed: SEED, numRuns: RUNS }
    )
    // The two branches the review was about were reached.
    expect(tally.failedAfterChosen).toBeGreaterThan(0)
    expect(tally.droppedHeld).toBeGreaterThan(0)
  }, 60_000)
})
