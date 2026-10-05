/**
 * The SQL bridge's one `loading` slot (refactor pass 2, P11). A query that times out kills the
 * worker and restores the kept bytes into a new one; a build asked for while that restore is
 * still running must wait for it — before, the restore's `restored` resolved the build, early
 * and with nothing built.
 *
 * No worker here: `Worker` is a stub that records what it was sent and answers when told to.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SQL_TIMEOUT_MS, SqlBridge } from '../../src/renderer/model/sql-bridge'
import type { SqlPayload } from '../../src/worker/sql-schema'
import type { SqlRequest, SqlResponse } from '../../src/worker/sql.worker'

class FakeWorker {
  static all: FakeWorker[] = []
  sent: SqlRequest[] = []
  onmessage: ((e: { data: SqlResponse }) => void) | null = null
  onerror: ((e: { message: string }) => void) | null = null
  terminated = false
  constructor() {
    FakeWorker.all.push(this)
  }
  postMessage(request: SqlRequest): void {
    this.sent.push(request)
  }
  terminate(): void {
    this.terminated = true
  }
  answer(data: SqlResponse): void {
    this.onmessage?.({ data })
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('SqlBridge — one build or restore at a time', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeWorker.all = []
    vi.stubGlobal('Worker', FakeWorker)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('a build asked for during a timeout’s restore waits for it, and resolves with its own answer', async () => {
    const bridge = new SqlBridge()
    const payload = {} as SqlPayload
    const first = bridge.build(payload)
    await flush()
    FakeWorker.all[0].answer({ type: 'ready', bytes: new Uint8Array([1]), elements: 10, ms: 1 })
    expect(await first).toEqual({ elements: 10, ms: 1 })

    // A query that never answers: the worker is killed and the kept bytes restored.
    const q = bridge.query('SELECT 1')
    q.catch(() => {})
    await flush()
    await vi.advanceTimersByTimeAsync(SQL_TIMEOUT_MS)
    await expect(q).rejects.toThrow(/cancelled/)
    await flush()
    const second = FakeWorker.all[1]
    expect(second.sent.map((r) => r.type)).toEqual(['restore'])

    // A build now: not sent until the restore has settled.
    let built: unknown = null
    const next = bridge.build(payload).then((r) => (built = r))
    await flush()
    expect(second.sent.map((r) => r.type)).toEqual(['restore'])

    second.answer({ type: 'restored', ms: 2 })
    await flush()
    expect(built).toBeNull()
    expect(second.sent.map((r) => r.type)).toEqual(['restore', 'build'])

    second.answer({ type: 'ready', bytes: new Uint8Array([2]), elements: 20, ms: 3 })
    await next
    expect(built).toEqual({ elements: 20, ms: 3 })
  })

  it('a build after a failed one still goes ahead', async () => {
    const bridge = new SqlBridge()
    const a = bridge.build({} as SqlPayload)
    a.catch(() => {})
    await flush()
    FakeWorker.all[0].answer({ type: 'error', message: 'boom' })
    await expect(a).rejects.toThrow('boom')
    const b = bridge.build({} as SqlPayload)
    await flush()
    expect(FakeWorker.all[0].sent.map((r) => r.type)).toEqual(['build', 'build'])
    FakeWorker.all[0].answer({ type: 'ready', bytes: new Uint8Array([1]), elements: 1, ms: 1 })
    expect(await b).toEqual({ elements: 1, ms: 1 })
  })
})
