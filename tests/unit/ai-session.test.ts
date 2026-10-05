/**
 * `src/main/ai/session.ts` — the IPC half of the assistant (S2, C1).
 *
 * `electron`'s `ipcMain` is replaced by a table the test calls directly, a window is an
 * `EventEmitter` with a `send` spy, the key comes from a stubbed `settings`, and the SDK client
 * is a fake whose stream the test finishes or leaves hanging. The gateway is the real one.
 */
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (event: unknown, raw?: unknown) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, raw?: unknown) => unknown) =>
      handlers.set(channel, fn),
    on: (channel: string, fn: (event: unknown, raw?: unknown) => unknown) =>
      handlers.set(channel, fn)
  }
}))

let key = 'sk-ant-one'
vi.mock('../../src/main/settings', () => ({
  apiKey: () => key,
  view: () => ({ model: 'claude-opus-5', effort: 'medium', cacheOneHour: false })
}))

type Reply = Record<string, unknown>
/** What the next stream answers with; `null` leaves it hanging until aborted. */
let script: (Reply | null)[] = []
const requests: { messages: { role: string; content: unknown }[] }[] = []

vi.mock('../../src/main/ai/gateway', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/main/ai/gateway')>()
  return {
    ...real,
    anthropicClient: vi.fn(async () => ({
      stream(request: { messages: { role: string; content: unknown }[] }) {
        requests.push(JSON.parse(JSON.stringify(request)))
        const reply = script.shift() ?? null
        let reject: (e: Error) => void = () => {}
        const final = new Promise((resolve, rej) => {
          reject = rej
          if (reply) resolve(reply)
        })
        return {
          onText: () => {},
          onToolStart: () => {},
          final: () => final,
          abort: () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        }
      }
    }))
  }
})

const { registerAiIpc } = await import('../../src/main/ai/session')
const { anthropicClient } = await import('../../src/main/ai/gateway')
const { AI_JSON_MAX_CHARS } = await import('../../src/shared/ipc-contract')
const ch = await import('../../src/shared/ipc-channels')

registerAiIpc()

const message = (content: Reply[], stop_reason: string): Reply => ({
  id: 'm',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5',
  content,
  stop_reason,
  stop_details: null,
  usage: { input_tokens: 1, output_tokens: 1 }
})

let nextId = 1
/** A window. `answer` is what its renderer sends back for every tool call. */
function window(answer?: (call: { turnId: string; callId: string }) => unknown) {
  const wc = Object.assign(new EventEmitter(), {
    id: nextId++,
    isDestroyed: () => false,
    sent: [] as [string, Record<string, unknown>][],
    send(channel: string, payload: Record<string, unknown>) {
      wc.sent.push([channel, payload])
      if (channel === ch.CH_AI_TOOL_EXEC && answer) {
        const call = payload as { turnId: string; callId: string }
        queueMicrotask(() => handlers.get(ch.CH_AI_TOOL_RESULT)!({ sender: wc }, answer(call)))
      }
    }
  })
  return wc
}
type Win = ReturnType<typeof window>

const start = (wc: Win, turnId: string, extra: Record<string, unknown> = {}): Promise<unknown> =>
  handlers.get(ch.CH_AI_TURN_START)!(
    { sender: wc },
    { turnId, userText: 'how many walls?', viewState: {}, schema: {}, ...extra }
  ) as Promise<unknown>
const abort = (wc: Win, turnId: string): unknown =>
  handlers.get(ch.CH_AI_TURN_ABORT)!({ sender: wc }, { turnId })
const events = (wc: Win): Record<string, unknown>[] =>
  wc.sent.filter(([c]) => c === ch.CH_AI_EVENT).map(([, e]) => e)
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  script = []
  requests.length = 0
  key = 'sk-ant-one'
  vi.mocked(anthropicClient).mockClear()
})

describe('size caps (S2)', () => {
  it('turns an oversized tool result into a short is_error the model can read', async () => {
    script = [
      message([{ type: 'tool_use', id: 'u1', name: 'audit_model', input: {} }], 'tool_use'),
      message([{ type: 'text', text: 'ok' }], 'end_turn')
    ]
    const wc = window((call) => ({
      ...call,
      ok: true,
      result: { rows: 'x'.repeat(AI_JSON_MAX_CHARS) }
    }))
    await start(wc, 't1')
    const results = requests[1].messages.at(-1) as { content: Record<string, unknown>[] }
    expect(results.content[0].is_error).toBe(true)
    const body = JSON.stringify(results.content[0])
    expect(body).toContain('too large')
    expect(body.length).toBeLessThan(1000)
  })

  it('passes a result under the cap through untouched', async () => {
    script = [
      message([{ type: 'tool_use', id: 'u1', name: 'audit_model', input: {} }], 'tool_use'),
      message([{ type: 'text', text: 'ok' }], 'end_turn')
    ]
    const wc = window((call) => ({ ...call, ok: true, result: { walls: 18 } }))
    await start(wc, 't1')
    const results = requests[1].messages.at(-1) as { content: Record<string, unknown>[] }
    expect(results.content[0].is_error).toBeUndefined()
    expect(JSON.stringify(results.content[0])).toContain('walls')
  })

  it('refuses a turn whose view state or schema is oversized, before any request', async () => {
    const big = { blob: 'x'.repeat(AI_JSON_MAX_CHARS) }
    for (const extra of [{ viewState: big }, { schema: big }]) {
      const wc = window()
      await start(wc, 't1', extra)
      expect(events(wc)).toEqual([
        expect.objectContaining({ type: 'error', turnId: 't1', kind: 'bad_request' })
      ])
    }
    expect(requests).toHaveLength(0)
    expect(anthropicClient).not.toHaveBeenCalled()
  })
})

describe('abort honours its turnId (S2)', () => {
  it('a late abort for an older turn does not stop the newer one', async () => {
    const wc = window()
    script = [message([{ type: 'text', text: 'first' }], 'end_turn'), null]
    await start(wc, 't1')
    const second = start(wc, 't2')
    await flush()
    abort(wc, 't1') // late: t1 finished long ago
    await flush()
    expect(events(wc).some((e) => e.type === 'aborted')).toBe(false)
    abort(wc, 't2')
    await second
    expect(events(wc).at(-1)).toEqual({ type: 'aborted', turnId: 't2' })
  })
})

describe('one client per session (C1)', () => {
  it('builds the SDK client once, not once a turn', async () => {
    const wc = window()
    script = [
      message([{ type: 'text', text: 'a' }], 'end_turn'),
      message([{ type: 'text', text: 'b' }], 'end_turn')
    ]
    await start(wc, 't1')
    await start(wc, 't2')
    expect(anthropicClient).toHaveBeenCalledTimes(1)
  })

  it('rebuilds on a key change and lets the old session go', async () => {
    const wc = window()
    script = [
      message([{ type: 'text', text: 'a' }], 'end_turn'),
      message([{ type: 'text', text: 'b' }], 'end_turn')
    ]
    await start(wc, 't1')
    expect(wc.listenerCount('destroyed')).toBe(1)
    key = 'sk-ant-two'
    await start(wc, 't2')
    expect(anthropicClient).toHaveBeenCalledTimes(2)
    expect(anthropicClient).toHaveBeenLastCalledWith('sk-ant-two')
    // The old session's `destroyed` listener went with it.
    expect(wc.listenerCount('destroyed')).toBe(1)
  })
})

describe('building the client (C1, review)', () => {
  it('two turns racing on a fresh key share one build and neither aborts the other', async () => {
    const wc = window()
    script = [
      message([{ type: 'text', text: 'a' }], 'end_turn'),
      message([{ type: 'text', text: 'b' }], 'end_turn')
    ]
    await Promise.all([start(wc, 't1'), start(wc, 't2')])
    expect(anthropicClient).toHaveBeenCalledTimes(1)
    const done = events(wc).filter((e) => e.type === 'done').map((e) => e.turnId)
    expect(done.sort()).toEqual(['t1', 't2'])
    expect(events(wc).some((e) => e.type === 'aborted' || e.type === 'error')).toBe(false)
    expect(wc.listenerCount('destroyed')).toBe(1)
  })

  it('a client that cannot be built is an error event, not a rejected invoke', async () => {
    vi.mocked(anthropicClient).mockRejectedValueOnce(new Error('Cannot find module @anthropic-ai/sdk'))
    const wc = window()
    await expect(start(wc, 't1')).resolves.toBeUndefined()
    expect(events(wc)).toEqual([
      expect.objectContaining({ type: 'error', turnId: 't1', message: expect.stringContaining('Cannot find module') })
    ])
    // …and the failed build is not remembered: the next turn builds again.
    script = [message([{ type: 'text', text: 'ok' }], 'end_turn')]
    await start(wc, 't2')
    expect(anthropicClient).toHaveBeenCalledTimes(2)
    expect(events(wc).at(-1)).toMatchObject({ type: 'done', turnId: 't2' })
  })
})
