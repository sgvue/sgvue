/**
 * The manual streaming loop, driven by an injected fake client. No network, no key.
 *
 * The property every one of these protects is the same: **the API transcript never contains a
 * `tool_use` without its `tool_result`.** Once it does, every later turn of that conversation
 * 400s and the only way out is losing the conversation — so abort, refusal, `max_tokens`, the
 * round cap and a thrown error all roll the transcript back to where the turn started, and a
 * tool that fails comes back as `is_error: true` rather than as a dropped block.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  AiGateway,
  REQUEST_MAX_RETRIES,
  REQUEST_TIMEOUT_MS,
  TURN_TIMEOUT_MS,
  classifyError,
  foldSystemMessages,
  trimOldest
} from '../../src/main/ai/gateway'
import type { AiEvent } from '../../src/shared/ipc-contract'

type Block = Record<string, unknown>

const msg = (
  content: Block[],
  stop_reason: string,
  extra: Record<string, unknown> = {}
): never =>
  ({
    id: 'm1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content,
    stop_reason,
    stop_details: null,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 4, cache_creation_input_tokens: 0 },
    ...extra
  }) as never

const text = (t: string): Block => ({ type: 'text', text: t })
const toolUse = (id: string, name: string, input: unknown): Block => ({
  type: 'tool_use',
  id,
  name,
  input
})

interface Harness {
  gateway: AiGateway
  events: AiEvent[]
  requests: { messages: { role: string; content: unknown }[]; tools?: unknown[] }[]
  toolCalls: { name: string; input: unknown }[]
}

function harness(
  replies: (unknown | Error)[],
  options: {
    runTool?: (name: string, input: Record<string, unknown>) => Promise<{
      ok: boolean
      result?: unknown
      message?: string
    }>
    maxRounds?: number
    turnTimeoutMs?: number
  } = {}
): Harness {
  const events: AiEvent[] = []
  const requests: Harness['requests'] = []
  const toolCalls: Harness['toolCalls'] = []
  let n = 0
  const gateway = new AiGateway({
    client: {
      stream(request) {
        // A structural clone, so a later `messages.push` cannot rewrite what was recorded.
        requests.push(JSON.parse(JSON.stringify(request)))
        const reply = replies[n++]
        return {
          onText: (fn) => fn('…'),
          onToolStart: (fn) => {
            const blocks = (reply as { content?: Block[] })?.content ?? []
            for (const b of blocks) if (b.type === 'tool_use') fn(b.name as string)
          },
          final: () => (reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply as never)),
          abort: () => {}
        }
      }
    },
    settings: () => ({ model: 'claude-opus-5', effort: 'medium', cacheOneHour: false }),
    runTool: async (name, input) => {
      toolCalls.push({ name, input })
      return options.runTool ? options.runTool(name, input) : { ok: true, result: { ok: 1 } }
    },
    emit: (e) => events.push(e),
    maxRounds: options.maxRounds,
    turnTimeoutMs: options.turnTimeoutMs
  })
  return { gateway, events, requests, toolCalls }
}

const turn = (overrides: Record<string, unknown> = {}): never =>
  ({ turnId: 't1', userText: 'how many walls?', viewState: {}, schema: {}, ...overrides }) as never

const kinds = (events: AiEvent[]): string[] => events.map((e) => e.type)
const errorOf = (events: AiEvent[]): Extract<AiEvent, { type: 'error' }> =>
  events.find((e) => e.type === 'error') as Extract<AiEvent, { type: 'error' }>

describe('the loop', () => {
  it('runs a tool, feeds its result back, and finishes on end_turn', async () => {
    const h = harness([
      msg([toolUse('u1', 'query_elements', { rules: [] })], 'tool_use'),
      msg([text('18 walls.')], 'end_turn')
    ])
    await h.gateway.run(turn())

    expect(h.toolCalls).toEqual([{ name: 'query_elements', input: { rules: [] } }])
    expect(kinds(h.events)).toContain('tool_start')
    expect(kinds(h.events)).toContain('tool_done')
    const done = h.events.find((e) => e.type === 'done') as Extract<AiEvent, { type: 'done' }>
    expect(done.text).toBe('18 walls.')
    expect(done.rounds).toBe(1)

    // The assistant content went back unchanged, and the result came back in a user message.
    const second = h.requests[1].messages
    expect(second[second.length - 2]).toEqual({
      role: 'assistant',
      content: [toolUse('u1', 'query_elements', { rules: [] })]
    })
    const results = second[second.length - 1] as { role: string; content: Block[] }
    expect(results.role).toBe('user')
    expect(results.content[0].type).toBe('tool_result')
    expect(results.content[0].tool_use_id).toBe('u1')
  })

  it('answers two tool calls in ONE user message, in order', async () => {
    const h = harness([
      msg(
        [toolUse('u1', 'query_elements', { rules: [] }), toolUse('u2', 'audit_model', {})],
        'tool_use'
      ),
      msg([text('done')], 'end_turn')
    ])
    await h.gateway.run(turn())

    expect(h.toolCalls.map((c) => c.name)).toEqual(['query_elements', 'audit_model'])
    const results = h.requests[1].messages.at(-1) as { role: string; content: Block[] }
    expect(results.role).toBe('user')
    expect(results.content).toHaveLength(2)
    expect(results.content.map((b) => b.tool_use_id)).toEqual(['u1', 'u2'])
  })

  it('never drops a failed tool — it comes back as is_error', async () => {
    const h = harness(
      [
        msg([toolUse('u1', 'query_sql', { sql: 'DROP TABLE element' })], 'tool_use'),
        msg([text('refused')], 'end_turn')
      ],
      { runTool: async () => ({ ok: false, message: 'only SELECT and WITH are allowed' }) }
    )
    await h.gateway.run(turn())

    const results = h.requests[1].messages.at(-1) as { content: Block[] }
    expect(results.content[0].is_error).toBe(true)
    expect(JSON.stringify(results.content[0])).toContain('only SELECT and WITH are allowed')
    const toolDone = h.events.find((e) => e.type === 'tool_done') as Extract<
      AiEvent,
      { type: 'tool_done' }
    >
    expect(toolDone.ok).toBe(false)
  })

  it('continues through pause_turn without inventing a tool result', async () => {
    const h = harness([
      msg([text('thinking…')], 'pause_turn'),
      msg([text('here it is')], 'end_turn')
    ])
    await h.gateway.run(turn())
    expect(errorOf(h.events)).toBeUndefined()
    const second = h.requests[1].messages
    expect(second.at(-1)).toEqual({ role: 'assistant', content: [text('thinking…')] })
  })

  it('stops at the round cap rather than looping', async () => {
    const forever = Array.from({ length: 10 }, () =>
      msg([toolUse('u', 'audit_model', {})], 'tool_use')
    )
    const h = harness(forever, { maxRounds: 3 })
    await h.gateway.run(turn())
    expect(errorOf(h.events).kind).toBe('round_cap')
    expect(h.gateway.transcriptLength).toBe(0)
  })
})

describe('what ends a turn badly', () => {
  it('surfaces a refusal with its category and explanation, and commits nothing', async () => {
    const h = harness([
      msg([text('')], 'refusal', {
        stop_details: { type: 'refusal', category: 'cyber', explanation: 'Declined.' }
      })
    ])
    await h.gateway.run(turn())
    expect(errorOf(h.events).kind).toBe('refusal')
    expect(errorOf(h.events).message).toBe('Declined. (cyber)')
    expect(h.gateway.transcriptLength).toBe(0)
  })

  it('says a reply was cut off when it hits max_tokens', async () => {
    const h = harness([msg([text('half a sen')], 'max_tokens')])
    await h.gateway.run(turn())
    expect(errorOf(h.events).kind).toBe('max_tokens')
    expect(errorOf(h.events).message).toContain('cut off')
  })

  it('rolls the transcript back when aborted mid-tool, leaving no orphan tool_use', async () => {
    let gateway: AiGateway | null = null
    const h = harness(
      [
        msg([toolUse('u1', 'clash_check', { modelA: 'ARC', modelB: 'STR' })], 'tool_use'),
        msg([text('never reached')], 'end_turn')
      ],
      {
        runTool: async () => {
          gateway!.abort()
          return { ok: true, result: {} }
        }
      }
    )
    gateway = h.gateway
    await h.gateway.run(turn())

    expect(kinds(h.events)).toContain('aborted')
    expect(h.gateway.transcriptLength).toBe(0)
    // One request only: the loop never asked again after the abort.
    expect(h.requests).toHaveLength(1)
  })

  it('commits the whole turn on success, with the breakpoint stripped from history', async () => {
    const h = harness([msg([text('18 walls.')], 'end_turn')])
    await h.gateway.run(turn())
    // history + user + view-state system message + assistant reply
    expect(h.gateway.transcriptLength).toBe(3)

    const h2 = harness([msg([text('and 4 doors.')], 'end_turn')])
    // A second turn on the same gateway keeps at most three breakpoints in total.
    await h.gateway.run(turn({ turnId: 't2', userText: 'and the doors?' }))
    expect(h2).toBeTruthy()
    const second = h.requests[1]
    const marks = JSON.stringify(second).match(/"cache_control"/g) ?? []
    expect(marks).toHaveLength(3)
  })
})

describe('recoveries', () => {
  it('retries once without strict tools when the schema is refused', async () => {
    const bad = Object.assign(new Error('tools.0.custom.input_schema: enum is not supported under strict'), {
      name: 'BadRequestError',
      status: 400
    })
    const h = harness([bad, msg([text('fine')], 'end_turn')])
    await h.gateway.run(turn())
    expect(errorOf(h.events)).toBeUndefined()
    expect(h.gateway.fallbacks.strictTools).toBe(false)
    expect((h.requests[1].tools as { strict?: boolean }[]).some((t) => t.strict)).toBe(false)
  })

  it('retries once with the view state folded into the user turn when role:"system" is refused', async () => {
    const bad = Object.assign(new Error("role 'system' is not supported on this model"), {
      name: 'BadRequestError',
      status: 400
    })
    const h = harness([bad, msg([text('fine')], 'end_turn')])
    await h.gateway.run(turn())
    expect(h.gateway.fallbacks.systemMessages).toBe(false)
    expect(h.requests[1].messages.some((m) => m.role === 'system')).toBe(false)
    const user = h.requests[1].messages.at(-1) as { role: string; content: Block[] }
    expect(user.role).toBe('user')
    expect(user.content).toHaveLength(2)
  })

  it('drops the oldest turns once when the prompt no longer fits', async () => {
    const tooLong = Object.assign(new Error('prompt is too long: 1100000 tokens > 1000000'), {
      name: 'BadRequestError',
      status: 400
    })
    const h = harness([msg([text('one')], 'end_turn'), tooLong, msg([text('two')], 'end_turn')])
    await h.gateway.run(turn())
    await h.gateway.run(turn({ turnId: 't2' }))
    expect(errorOf(h.events)).toBeUndefined()
    expect(h.requests[2].messages.length).toBeLessThan(h.requests[1].messages.length)
    expect(h.requests[2].messages[0].role).toBe('user')
  })
})

describe('error mapping', () => {
  it('reads the SDK’s classes first, then the status', () => {
    expect(classifyError({ name: 'AuthenticationError', status: 401 }).kind).toBe('auth')
    expect(classifyError({ status: 403 }).kind).toBe('auth')
    expect(classifyError({ name: 'RateLimitError', status: 429 }).kind).toBe('rate_limit')
    expect(classifyError({ status: 529 }).kind).toBe('overloaded')
    expect(classifyError({ name: 'BadRequestError', status: 400, message: 'bad' }).kind).toBe(
      'bad_request'
    )
    expect(classifyError({ name: 'APIConnectionError', message: 'socket hang up' }).kind).toBe(
      'connection'
    )
    expect(classifyError({ status: 500, message: 'server' }).kind).toBe('unknown')
  })

  it('turns a thrown connection failure into one event and no transcript', async () => {
    const h = harness([
      Object.assign(new Error('socket hang up'), { name: 'APIConnectionError' })
    ])
    await h.gateway.run(turn())
    expect(errorOf(h.events).kind).toBe('connection')
    expect(h.gateway.transcriptLength).toBe(0)
  })

  it('reports usage so a second identical prefix can be checked for a cache read', async () => {
    const h = harness([msg([text('hi')], 'end_turn')])
    await h.gateway.run(turn())
    const usage = h.events.find((e) => e.type === 'usage') as Extract<AiEvent, { type: 'usage' }>
    expect(usage.cacheReadTokens).toBe(4)
    expect(usage.inputTokens).toBe(10)
  })
})

describe('request surgery', () => {
  it('folds a system message into the user turn before it', () => {
    const request = {
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'q' }] },
        { role: 'system', content: 'Current view state: {}' }
      ]
    } as never
    foldSystemMessages(request)
    const r = request as unknown as { messages: { role: string; content: Block[] }[] }
    expect(r.messages).toHaveLength(1)
    expect(r.messages[0].content.map((b) => b.text)).toEqual(['q', 'Current view state: {}'])
  })

  it('trims to a legal start rather than leaving an orphan tool_result first', () => {
    const request = {
      messages: [
        { role: 'user', content: [{ type: 'text', text: '1' }] },
        { role: 'assistant', content: [toolUse('u1', 'x', {})] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u1' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
        { role: 'user', content: [{ type: 'text', text: '2' }] }
      ]
    } as never
    trimOldest(request)
    const r = request as unknown as { messages: { role: string }[] }
    expect(r.messages[0].role).toBe('user')
    expect(JSON.stringify(r.messages)).not.toContain('tool_result')
  })
})

/* ══════════════════════════ 2026-09-20 — the turn's own wall clock ══════════════════════════ */

describe('the turn deadline', () => {
  it('fits two SDK attempts inside the turn budget', () => {
    expect(REQUEST_TIMEOUT_MS * (REQUEST_MAX_RETRIES + 1)).toBeLessThan(TURN_TIMEOUT_MS)
  })

  it('aborts a stream that is still in flight, and rolls the transcript back', async () => {
    const events: AiEvent[] = []
    let aborted = false
    let rejectStream: ((e: unknown) => void) | null = null
    const gateway = new AiGateway({
      client: {
        stream() {
          return {
            onText: () => {},
            onToolStart: () => {},
            // A request that never answers on its own — only the abort ends it, which is
            // what the SDK does: `stream.abort()` rejects whatever is awaiting `final()`.
            final: () =>
              new Promise((_resolve, reject) => {
                rejectStream = reject
              }),
            abort: () => {
              aborted = true
              rejectStream?.(
                Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' })
              )
            }
          }
        }
      },
      settings: () => ({ model: 'claude-opus-5', effort: 'medium', cacheOneHour: false }),
      runTool: async () => ({ ok: true, result: {} }),
      emit: (e) => events.push(e),
      // Short enough for a test; the mechanism is the same at 120 s.
      turnTimeoutMs: 40
    })

    await gateway.run(turn())

    expect(aborted).toBe(true)
    const error = errorOf(events)
    expect(error.kind).toBe('timeout')
    expect(error.message).toContain('was stopped')
    // The one invariant: nothing half-written is left behind.
    expect(gateway.transcriptLength).toBe(0)
  })

  it('a user abort is still an abort, not a timeout', async () => {
    const events: AiEvent[] = []
    let rejectStream: ((e: unknown) => void) | null = null
    // Resolved once the request is in flight, so the abort below lands on a live stream
    // without guessing how long that takes.
    let inFlight!: () => void
    const streaming = new Promise<void>((r) => (inFlight = r))
    const gateway = new AiGateway({
      client: {
        stream() {
          return {
            onText: () => {},
            onToolStart: () => {},
            final: () =>
              new Promise((_r, reject) => {
                rejectStream = reject
                inFlight()
              }),
            abort: () =>
              rejectStream?.(Object.assign(new Error('aborted'), { name: 'APIUserAbortError' }))
          }
        }
      },
      settings: () => ({ model: 'claude-opus-5', effort: 'medium', cacheOneHour: false }),
      runTool: async () => ({ ok: true, result: {} }),
      emit: (e) => events.push(e),
      turnTimeoutMs: 5_000
    })

    const running = gateway.run(turn())
    await streaming
    gateway.abort()
    await running

    expect(kinds(events)).toContain('aborted')
    expect(events.find((e) => e.type === 'error')).toBeUndefined()
    expect(gateway.transcriptLength).toBe(0)
  })

  it('does not leave its timer armed once the turn finishes', async () => {
    const h = harness([msg([text('done')], 'end_turn')], { turnTimeoutMs: 30 })
    await h.gateway.run(turn())
    // Well past the deadline: a timer still armed would fire into a finished turn.
    await new Promise((r) => setTimeout(r, 60))
    expect(kinds(h.events).filter((k) => k === 'error')).toHaveLength(0)
    expect(h.gateway.transcriptLength).toBeGreaterThan(0)
  })

  it('does not leave its timer armed when building the request throws (B2)', async () => {
    // Before the fix the 120 s timer was armed ahead of the `try`, so a throw here left it
    // running, and it fired into — and aborted — whichever turn came next.
    vi.useFakeTimers()
    try {
      const events: AiEvent[] = []
      const gateway = new AiGateway({
        client: { stream: () => { throw new Error('unreachable') } },
        settings: () => {
          throw new Error('settings unreadable')
        },
        runTool: async () => ({ ok: true }),
        emit: (e) => events.push(e),
        turnTimeoutMs: 30
      })
      await gateway.run(turn())
      expect(vi.getTimerCount()).toBe(0)
      // …and the failure is an event for the panel, not a rejection nobody reads.
      expect(errorOf(events).message).toBe('settings unreadable')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('classifyError separates the status-less failures', () => {
  it('an abort is not a network failure', () => {
    expect(classifyError({ name: 'APIUserAbortError', message: 'Request was aborted.' })).toEqual({
      kind: 'timeout',
      message: 'The request was stopped before it finished.'
    })
  })

  it('a request timeout says so, with the limit', () => {
    const out = classifyError({ name: 'APIConnectionTimeoutError', message: 'Request timed out.' })
    expect(out.kind).toBe('timeout')
    expect(out.message).toContain(String(Math.round(REQUEST_TIMEOUT_MS / 1000)))
  })

  it('a genuine connection failure keeps the design’s own sentence', () => {
    expect(classifyError({ name: 'APIConnectionError', message: 'fetch failed' })).toEqual({
      kind: 'connection',
      message: 'Could not reach the API. Check the network.'
    })
  })

  it('an unreadable stream is reported as unreadable, not as unreachable', () => {
    const out = classifyError(new SyntaxError('Unexpected token } in JSON at position 4'))
    expect(out.kind).toBe('unknown')
    expect(out.message).toContain('could not be read')
  })

  it('anything else with no status is our own failure, and says what it was', () => {
    const out = classifyError(new TypeError('x is not a function'))
    expect(out.kind).toBe('unknown')
    expect(out.message).toBe('x is not a function')
    expect(out.message).not.toContain('Check the network')
  })

  it('still classifies the HTTP statuses first', () => {
    expect(classifyError({ status: 401 }).kind).toBe('auth')
    expect(classifyError({ status: 429 }).kind).toBe('rate_limit')
    expect(classifyError({ status: 529 }).kind).toBe('overloaded')
    expect(classifyError({ status: 400, message: 'bad' }).kind).toBe('bad_request')
  })
})
