/**
 * The assistant gateway — the manual streaming loop, and the only place the Anthropic SDK
 * and the API key exist.
 *
 * Three properties are the reason this is hand-written rather than the SDK's tool runner:
 *
 * 1. **Main never holds model data.** Every tool call is forwarded to the renderer, which
 *    runs it against the frozen index, the SQL worker and the view store and sends back JSON.
 *    Main sees tool names, arguments and results — never an element, never a file.
 * 2. **Main owns a byte-stable API transcript**, and rolls it back to its pre-turn length on
 *    abort or error. The one thing that must never happen is a `tool_use` left in the
 *    transcript with no `tool_result` after it: the next turn would 400 forever, and the only
 *    way out would be losing the conversation.
 * 3. **The renderer's display transcript is its own.** It is keyed by `turnId` and driven by
 *    events, so a turn that fails leaves the panel with a message and the API transcript with
 *    nothing.
 *
 * The loop follows the documented contract exactly: `end_turn` finishes; `tool_use` pushes the
 * assistant content **unchanged** (thinking blocks included), runs the calls **sequentially in
 * order**, and pushes **one** user message carrying **every** result (`is_error: true` for a
 * failure — never a dropped one); `pause_turn` pushes the content and continues; `refusal`
 * reads `stop_details`; `max_tokens` says it was cut off.
 */
import type { Anthropic } from '@anthropic-ai/sdk'
import type { AiErrorKind, AiEvent } from '../../shared/ipc-contract'
import { apiTools, toolByName, toolTimeoutMs } from '../../shared/tool-schemas'
import { buildRequest, requestSnapshot, viewStateText, type PromptInput } from './prompt'

type BetaMessage = Anthropic.Beta.BetaMessage
type BetaMessageParam = Anthropic.Beta.BetaMessageParam
type BetaContentBlockParam = Anthropic.Beta.BetaContentBlockParam
type BetaToolResultBlockParam = Anthropic.Beta.BetaToolResultBlockParam
type StreamingParams = Anthropic.Beta.Messages.MessageCreateParamsStreaming

/* ────────────────────────────── caps ────────────────────────────── */

/** Tool rounds in one turn. Plan §4 Phase 9. */
export const MAX_TOOL_ROUNDS = 12
/** Wall clock for one whole turn, tool time included. */
export const TURN_TIMEOUT_MS = 120_000
/**
 * Output tokens.
 *
 * **Thinking counts against this** on `claude-opus-5`, and the request always streams, where
 * the documented default is ~64 000 — a timeout is not the concern a non-streaming request has.
 * At 16 000 a long table or a twelve-round turn could be cut off mid-answer, and this loop
 * treats `stop_reason: max_tokens` as a failed turn and rolls the transcript back, so the cost
 * of the cap is the whole turn rather than a short reply (2026-09-20).
 */
export const MAX_TOKENS = 64_000

/**
 * One request's own timeout, and how many times the SDK may retry it.
 *
 * The SDK's defaults are ten minutes and two retries, which is thirty minutes of wall clock
 * for a turn this loop says lasts 120 seconds — and the panel has no stop control, by design.
 * Two attempts at 50 s fit inside `TURN_TIMEOUT_MS` with room for the tools; a unit test holds
 * that arithmetic. The deadline timer below is the backstop, not the plan.
 */
export const REQUEST_TIMEOUT_MS = 50_000
export const REQUEST_MAX_RETRIES = 1

/* ────────────────────────────── the client seam ────────────────────────────── */

/**
 * The gateway talks to this, not to the SDK. `anthropicClient()` below is the one adapter;
 * every test injects a fake, so the loop is exercised without a network or a key.
 */
export interface StreamHandle {
  onText(fn: (delta: string) => void): void
  /** The tool name, from the `content_block_start` event — before the arguments finish. */
  onToolStart(fn: (name: string) => void): void
  final(): Promise<BetaMessage>
  abort(): void
}

export interface AiClient {
  stream(request: StreamingParams): StreamHandle
}

/** Wrap the real SDK. The only place `@anthropic-ai/sdk` is constructed. */
export async function anthropicClient(apiKey: string): Promise<AiClient> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({
    apiKey,
    // Milliseconds in the TypeScript SDK. Both are bounded so one wedged request cannot
    // outlive the turn that is waiting for it.
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: REQUEST_MAX_RETRIES
  })
  return {
    stream(request) {
      const stream = client.beta.messages.stream({
        ...request,
        // A policy refusal is re-routed server side rather than surfacing as a dead turn.
        // The scalar form pairs with the `-07-01` header; pairing it with `-06-01` is a 400.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default'
      })
      return {
        onText: (fn) => {
          stream.on('text', (delta) => fn(delta))
        },
        onToolStart: (fn) => {
          stream.on('streamEvent', (event) => {
            if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
              fn(event.content_block.name)
            }
          })
        },
        final: () => stream.finalMessage(),
        abort: () => stream.abort()
      }
    }
  }
}

/* ────────────────────────────── errors ────────────────────────────── */

interface StatusLike {
  status?: number
  name?: string
  message?: string
}

/**
 * Map a thrown error onto the kind the panel shows. Most specific first: the SDK's own
 * classes when they are what was thrown, then the HTTP status, then the message.
 *
 * The SDK already retries 408/409/429/5xx twice on its own, so anything that reaches here
 * has already been retried.
 */
export function classifyError(error: unknown): { kind: AiErrorKind; message: string } {
  const e = (error ?? {}) as StatusLike
  const name = e.name ?? ''
  const status = e.status
  const raw = e.message || String(error)

  if (name === 'AuthenticationError' || status === 401) {
    return { kind: 'auth', message: 'That API key was rejected. Check it in Preferences.' }
  }
  if (name === 'PermissionDeniedError' || status === 403) {
    return { kind: 'auth', message: 'That API key is not allowed to use this model.' }
  }
  if (name === 'RateLimitError' || status === 429) {
    return { kind: 'rate_limit', message: 'Rate limited by the API. Try again in a moment.' }
  }
  if (status === 529 || /overloaded/i.test(raw)) {
    return { kind: 'overloaded', message: 'The API is overloaded. Try again in a moment.' }
  }
  if (name === 'BadRequestError' || status === 400) {
    return { kind: 'bad_request', message: raw }
  }
  // No HTTP status: it never reached the API, or it did not come back. These used to collapse
  // into one "Could not reach the API", which is a lie for four of the five (2026-09-20).
  if (name === 'APIUserAbortError' || name === 'AbortError' || /\babort/i.test(raw)) {
    return { kind: 'timeout', message: 'The request was stopped before it finished.' }
  }
  if (name === 'APIConnectionTimeoutError' || /\btimed? ?out\b/i.test(raw)) {
    return {
      kind: 'timeout',
      message: `The API did not answer within ${Math.round(REQUEST_TIMEOUT_MS / 1000)} s.`
    }
  }
  if (name === 'APIConnectionError') {
    return { kind: 'connection', message: 'Could not reach the API. Check the network.' }
  }
  if (name === 'SyntaxError' || /\bJSON\b|Unexpected token|unterminated|malformed/i.test(raw)) {
    return { kind: 'unknown', message: `The reply could not be read: ${raw}` }
  }
  if (status === undefined) {
    // Everything left with no status is ours, not the network's — a bug here reads as one.
    return { kind: 'unknown', message: raw || 'The assistant failed for an unknown reason.' }
  }
  return { kind: 'unknown', message: raw }
}

/** A 400 that is really "the prompt no longer fits". */
const isContextOverflow = (message: string): boolean =>
  /context|too long|exceed|max.*token/i.test(message)

/** A 400 that is really "this tool schema is not acceptable under strict". */
const isSchemaRefusal = (message: string): boolean =>
  /strict|schema|additionalProperties|\benum\b/i.test(message)

/** A 400 that is really "this model does not take a system message in `messages`". */
const isSystemRoleRefusal = (message: string): boolean =>
  /role.*system|system.*role|system.*not supported/i.test(message)

/* ────────────────────────────── the session ────────────────────────────── */

export interface TurnRequest {
  turnId: string
  userText: string
  quote?: { who: string; text: string } | null
  viewState: unknown
  /** Sent only when the federation changed; main keeps the last one otherwise. */
  schema?: unknown
}

export interface GatewaySettings {
  model: string
  effort: PromptInput['effort']
  cacheOneHour: boolean
}

export interface GatewayDeps {
  client: AiClient
  settings: () => GatewaySettings
  /** Run one tool in the renderer. Rejects on timeout; never throws for a tool's own failure. */
  runTool: (
    name: string,
    input: Record<string, unknown>,
    timeoutMs: number
  ) => Promise<{ ok: boolean; result?: unknown; message?: string }>
  emit: (event: AiEvent) => void
  now?: () => number
  maxRounds?: number
  turnTimeoutMs?: number
}

/**
 * Strip every `cache_control` from a message before it becomes history.
 *
 * A breakpoint rides on the current user turn, and the API allows at most four in a request.
 * Leaving the old one in place would mean five by the third turn and a 400 — so the
 * breakpoint is removed the moment the turn it belonged to stops being the current one.
 */
function decache(message: BetaMessageParam): BetaMessageParam {
  if (typeof message.content === 'string') return message
  const content = message.content.map((block) => {
    if (block && typeof block === 'object' && 'cache_control' in block) {
      const { cache_control: _drop, ...rest } = block as unknown as Record<string, unknown>
      return rest as unknown as BetaContentBlockParam
    }
    return block
  })
  return { ...message, content }
}

/**
 * The fallback when the API refuses `role:'system'` inside `messages`: every system message
 * is folded into the **preceding** user turn as a trailing text block, so the operator
 * instruction still reaches the model and no turn loses its view state.
 */
export function foldSystemMessages(request: StreamingParams): void {
  const out: BetaMessageParam[] = []
  for (const message of request.messages) {
    if (message.role !== 'system') {
      out.push(message)
      continue
    }
    const text = typeof message.content === 'string' ? message.content : viewStateText({})
    const host = out[out.length - 1]
    if (!host || host.role !== 'user') continue
    const blocks: BetaContentBlockParam[] =
      typeof host.content === 'string' ? [{ type: 'text', text: host.content }] : [...host.content]
    blocks.push({ type: 'text', text })
    out[out.length - 1] = { role: 'user', content: blocks }
  }
  request.messages = out
}

/**
 * Drop the oldest messages once, when the prompt no longer fits.
 *
 * Two, then as many more as it takes to leave a legal start: `messages[0]` must be a `user`
 * message that is not a bare list of `tool_result`s, or the very first request would 400 on
 * an orphan.
 */
export function trimOldest(request: StreamingParams): void {
  const messages = request.messages.slice(Math.min(2, request.messages.length))
  const orphan = (m: BetaMessageParam): boolean =>
    m.role !== 'user' ||
    (Array.isArray(m.content) &&
      m.content.length > 0 &&
      m.content.every((b) => typeof b === 'object' && b !== null && b.type === 'tool_result'))
  while (messages.length > 1 && orphan(messages[0])) messages.shift()
  request.messages = messages
}

/** The text blocks of a finished message, joined — what the panel shows as the reply. */
const replyText = (message: BetaMessage): string =>
  message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()

export class AiGateway {
  /** The byte-stable API transcript. Never contains a `tool_use` without its `tool_result`. */
  private history: BetaMessageParam[] = []
  /** The last schema the renderer sent. Re-sent byte for byte so the prefix stays cached. */
  private schema: unknown = {}
  /** Falls to false permanently for this session once the API refuses `role:'system'`. */
  private systemMessages = true
  /** Falls to false permanently once the API refuses a strict tool schema. */
  private strictTools = true
  private aborted = false
  /**
   * Why the turn stopped: the user asked, or the wall clock ran out. Both kill the stream the
   * same way and the transcript rolls back the same way; only what the panel is told differs.
   */
  private stopKind: 'user' | 'deadline' | null = null
  private running: StreamHandle | null = null

  constructor(private readonly deps: GatewayDeps) {}

  /** The renderer asked to stop. Kills the stream; the loop rolls the transcript back. */
  abort(): void {
    this.stopKind ??= 'user'
    this.aborted = true
    this.running?.abort()
  }

  /**
   * The turn's wall clock ran out **while a request was in flight** (2026-09-20).
   *
   * Testing `now() > deadline` between rounds cannot stop a stream that is already open, so the
   * 120 s cap was only ever a cap on the gaps between rounds. This aborts the live stream, which
   * rejects `final()`, which lands in the loop's own catch — the same path an abort takes, so
   * the transcript rolls back to its pre-turn length exactly as it does everywhere else.
   */
  private expire(): void {
    if (this.aborted) return
    this.stopKind = 'deadline'
    this.aborted = true
    this.running?.abort()
  }

  get transcriptLength(): number {
    return this.history.length
  }

  /** For the report and the tests: which fallbacks this session has had to take. */
  get fallbacks(): { systemMessages: boolean; strictTools: boolean } {
    return { systemMessages: this.systemMessages, strictTools: this.strictTools }
  }

  async run(turn: TurnRequest): Promise<void> {
    const { emit } = this.deps
    const now = this.deps.now ?? Date.now
    const maxRounds = this.deps.maxRounds ?? MAX_TOOL_ROUNDS
    const wallClock = this.deps.turnTimeoutMs ?? TURN_TIMEOUT_MS
    const deadline = now() + wallClock
    const baseLength = this.history.length
    if (turn.schema !== undefined && turn.schema !== null) this.schema = turn.schema
    this.aborted = false
    this.stopKind = null
    let droppedOldestOnce = false
    let rounds = 0
    let text = ''
    // Armed inside the `try`, so the `finally` that clears it covers everything after it: a
    // throw while building the request used to leave it armed, and it aborted the next turn.
    let expiry: ReturnType<typeof setTimeout> | undefined

    try {
      // The backstop the between-rounds test cannot be: it fires while a stream is open.
      expiry = setTimeout(() => this.expire(), wallClock)

      const settings = this.deps.settings()
      const request: StreamingParams = buildRequest({
        model: settings.model,
        effort: settings.effort,
        maxTokens: MAX_TOKENS,
        schema: this.schema,
        viewState: turn.viewState,
        history: this.history,
        userText: turn.userText,
        quote: turn.quote,
        cacheOneHour: settings.cacheOneHour,
        systemMessages: this.systemMessages,
        strictTools: this.strictTools
      })
      emit({ type: 'request_snapshot', turnId: turn.turnId, json: requestSnapshot(request) })

      for (;;) {
        if (this.aborted) return this.finishStopped(turn.turnId, baseLength, wallClock)
        if (now() > deadline) {
          return this.finishError(turn.turnId, baseLength, {
            kind: 'timeout',
            message: `The turn ran past ${Math.round(wallClock / 1000)} s and was stopped.`
          })
        }

        let message: BetaMessage
        try {
          message = await this.stream(request, turn.turnId, (delta) => {
            text += delta
            emit({ type: 'text_delta', turnId: turn.turnId, text: delta })
          })
        } catch (error) {
          if (this.aborted) return this.finishStopped(turn.turnId, baseLength, wallClock)
          const failure = classifyError(error)

          // Three recoveries, each taken at most once per session, each an edit to the
          // request in place — rebuilding it from scratch mid-loop would orphan a `tool_use`.
          if (failure.kind === 'bad_request' && this.systemMessages && isSystemRoleRefusal(failure.message)) {
            this.systemMessages = false
            foldSystemMessages(request)
            this.snapshot(turn.turnId, request)
            continue
          }
          if (failure.kind === 'bad_request' && this.strictTools && isSchemaRefusal(failure.message)) {
            this.strictTools = false
            request.tools = apiTools({ strict: false })
            this.snapshot(turn.turnId, request)
            continue
          }
          if (failure.kind === 'bad_request' && !droppedOldestOnce && isContextOverflow(failure.message)) {
            droppedOldestOnce = true
            trimOldest(request)
            this.snapshot(turn.turnId, request)
            continue
          }
          return this.finishError(turn.turnId, baseLength, failure)
        }

        const usage = message.usage
        emit({
          type: 'usage',
          turnId: turn.turnId,
          inputTokens: usage?.input_tokens ?? 0,
          outputTokens: usage?.output_tokens ?? 0,
          cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
          cacheCreateTokens: usage?.cache_creation_input_tokens ?? 0,
          // What actually served the round. With `fallbacks: 'default'` on, that need not be
          // the model the request named, and until now nothing anywhere recorded which it was
          // — `docs/AI_EVAL.md` "What the suite does not do". 2026-09-20.
          ...(message.model ? { model: String(message.model) } : {})
        })

        if (message.stop_reason === 'refusal') {
          const details = message.stop_details
          const why = details?.explanation || 'The request was declined.'
          const category = details?.category ? ` (${details.category})` : ''
          return this.finishError(turn.turnId, baseLength, {
            kind: 'refusal',
            message: `${why}${category}`
          })
        }

        if (message.stop_reason === 'max_tokens') {
          return this.finishError(turn.turnId, baseLength, {
            kind: 'max_tokens',
            message: 'The reply was cut off before it finished. Ask for less at a time.'
          })
        }

        if (message.stop_reason === 'tool_use') {
          if (rounds >= maxRounds) {
            return this.finishError(turn.turnId, baseLength, {
              kind: 'round_cap',
              message: `The assistant asked for more than ${maxRounds} rounds of tools and was stopped.`
            })
          }
          rounds++
          // The assistant content goes back **unchanged**, thinking blocks and all.
          request.messages.push({ role: 'assistant', content: message.content })
          const results = await this.runTools(message, turn.turnId)
          if (this.aborted) return this.finishStopped(turn.turnId, baseLength, wallClock)
          // **One** user message carrying **every** result, in order.
          request.messages.push({ role: 'user', content: results })
          continue
        }

        if (message.stop_reason === 'pause_turn') {
          request.messages.push({ role: 'assistant', content: message.content })
          continue
        }

        // `end_turn`, `stop_sequence`, or a stop reason we have no special handling for.
        request.messages.push({ role: 'assistant', content: message.content })
        this.history = request.messages.map(decache)
        emit({
          type: 'done',
          turnId: turn.turnId,
          text: replyText(message) || text.trim() || 'Done.',
          rounds
        })
        return
      }
    } catch (error) {
      return this.finishError(turn.turnId, baseLength, classifyError(error))
    } finally {
      clearTimeout(expiry)
      this.running = null
    }
  }

  /* ────────────────────────────── internals ────────────────────────────── */

  private snapshot(turnId: string, request: StreamingParams): void {
    this.deps.emit({ type: 'request_snapshot', turnId, json: requestSnapshot(request) })
  }

  private stream(
    request: StreamingParams,
    turnId: string,
    onText: (delta: string) => void
  ): Promise<BetaMessage> {
    const handle = this.deps.client.stream(request)
    this.running = handle
    handle.onText(onText)
    handle.onToolStart((name) => this.deps.emit({ type: 'tool_start', turnId, name }))
    return handle.final()
  }

  /** Sequentially, in order. A failure becomes `is_error: true` — it is never dropped. */
  private async runTools(message: BetaMessage, turnId: string): Promise<BetaContentBlockParam[]> {
    const calls = message.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use'
    )
    const out: BetaToolResultBlockParam[] = []
    for (const call of calls) {
      const started = (this.deps.now ?? Date.now)()
      let ok = false
      let body: string
      if (!toolByName(call.name)) {
        body = JSON.stringify({ error: `No tool named "${call.name}".` })
      } else if (this.aborted) {
        body = JSON.stringify({ error: 'The turn was stopped before this tool ran.' })
      } else {
        try {
          // `call.input` is the SDK's parsed object — never re-parsed from the raw JSON.
          const answer = await this.deps.runTool(
            call.name,
            (call.input ?? {}) as Record<string, unknown>,
            toolTimeoutMs(call.name)
          )
          ok = answer.ok
          body = ok
            ? JSON.stringify(answer.result ?? null)
            : JSON.stringify({ error: answer.message ?? 'The tool failed.' })
        } catch (error) {
          body = JSON.stringify({
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
      const ms = (this.deps.now ?? Date.now)() - started
      this.deps.emit({ type: 'tool_done', turnId, name: call.name, ms, ok })
      out.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: [{ type: 'text', text: body }],
        ...(ok ? {} : { is_error: true })
      })
    }
    return out
  }

  /**
   * The turn stopped early. Either way the transcript goes back to its pre-turn length — a
   * `tool_use` with no `tool_result` after it is the one thing it may never contain — and only
   * what the panel is told differs: the user's own stop is not an error, the wall clock is.
   */
  private finishStopped(turnId: string, baseLength: number, wallClock: number): void {
    this.history = this.history.slice(0, baseLength)
    if (this.stopKind === 'deadline') {
      this.deps.emit({
        type: 'error',
        turnId,
        kind: 'timeout',
        message: `The turn ran past ${Math.round(wallClock / 1000)} s and was stopped.`
      })
      return
    }
    this.deps.emit({ type: 'aborted', turnId })
  }

  private finishError(
    turnId: string,
    baseLength: number,
    failure: { kind: AiErrorKind; message: string }
  ): void {
    this.history = this.history.slice(0, baseLength)
    this.deps.emit({ type: 'error', turnId, kind: failure.kind, message: failure.message })
  }
}
