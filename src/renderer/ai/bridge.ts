/**
 * The renderer's half of the assistant.
 *
 * It does three things and nothing else:
 *
 * 1. **Runs tools.** Main forwards every call here (`ai:tool:exec`) because main never holds
 *    model data. The executor runs against the frozen index, the SQL worker and the view
 *    store, and only its `forModel` JSON goes back.
 * 2. **Turns events into panel state.** `text_delta` streams into the message being written,
 *    `done` commits the turn with its chips, table and pending patch, `error` and `aborted`
 *    leave the transcript alone and say why.
 * 3. **Keeps the last request snapshot**, which is what Preferences → "Data sent to AI"
 *    shows. It is held in memory only and is never written anywhere.
 * 4. **Feeds the thinking trace** (2026-10-01, `ai/trace-store.ts`). The moments the turn
 *    already passes through here are the trace's events: `sendChat` is `begin`, the stream's
 *    `tool_start` is the first sign of a tool, `executeTool` reports each call it is about to
 *    run (through the context's `trace`, with the names already the file's own), and `done` is
 *    the answer — whose summary (`ChatTrace`: the status, the rows) goes onto the committed
 *    message. `aborted` and `error` end the trace with the turn. The design narrated a busy
 *    row from `tool_start` instead (`:1336`); that row is the assistant's live reply now.
 *
 * The API key is not here, has never been here, and cannot be asked for from here.
 */
import type { AiEvent, AiToolExec } from '../../shared/ipc-contract'
import { chatSchema, chatViewState, type CameraPose } from '../../shared/ai-schema'
import { visFn } from '../../shared/rules'
import { gateOf, isViewTool } from '../../shared/tool-schemas'
import { federation } from '../model/federation-store'
import { getViewer, useShell } from '../state/shell'
import { authorOf } from '../state/selectors/chat'
import type { TurnSnapshot } from '../state/selectors/snapshot'
import { executeTool, newTurnState, type ToolContext, type TurnState } from './executors'
import { scheduleBriefOf } from './executors/schedule'
import { traceBegin, traceDone, traceFail, traceToolExec, traceToolStart } from './trace-store'
import { api } from '../api'
/**
 * `DEVTOOLS` (`dev/flags.ts`) is statically `false` in a production build, so Rollup drops
 * everything guarded by it — including the turn recorder below, whose only caller is
 * `window.__sgvueDev.chat.record`.
 */
import { DEVTOOLS } from '../dev/flags'


/** The request as main built it, minus the key it never contained. In memory only. */
let lastSnapshot = ''
export const lastRequestSnapshot = (): string => lastSnapshot

/**
 * The last turn's tool calls and token usage.
 *
 * It exists for `scripts/ai-acceptance.cjs`, which has to be able to say *which* tool was
 * called and whether the second identical turn read the cache — neither of which is visible
 * in the panel. Bounded, in memory, and never written anywhere.
 */
export interface TurnUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreateTokens: number
  /** How many API round trips the four totals above were summed from. */
  rounds: number
  /**
   * The model the API says **served** the turn, which with `fallbacks: 'default'` need not be
   * the one the request named. `scripts/ai-eval.cjs` used to read the request snapshot and
   * therefore recorded what was asked for. 2026-09-20.
   */
  model?: string
}

export interface TurnLog {
  tools: { name: string; ms: number; ok: boolean }[]
  /**
   * The turn's **total**, not its last round (2026-09-20).
   *
   * A `usage` event arrives per round, and this used to be overwritten by each one — so a
   * twelve-round turn reported the twelfth round's tokens as though they were the turn's, and
   * the one thing the acceptance run exists to check (a non-zero cache read, against what the
   * turn actually cost) was measured on a twelfth of the evidence. The four counters stay
   * separate because they are billed at four different rates.
   */
  usage: TurnUsage | null
}
let turnLog: TurnLog = { tools: [], usage: null }
export const lastTurnLog = (): TurnLog => turnLog

/* ────────────────────────────── the turn recorder (dev only) ────────────────────────────── */

/**
 * One tool call of a recorded turn, with the **arguments the model sent** and the JSON that
 * went back. `TurnLog.tools` above carries a name, a duration and a flag, which is what the
 * acceptance run needs and is not enough to grade a turn: "isolate the doors on L2" and
 * "isolate everything" are both one `set_filter_stack` call.
 */
export interface TurnCall {
  name: string
  input: unknown
  ok: boolean
  ms: number
  /** `forModel` — the same JSON that crossed IPC. Bounded; nothing exceeds ~8 000 tokens. */
  result?: unknown
  error?: string
}

/** How a recorded turn ended, which the panel deliberately does not keep. */
export interface TurnOutcome {
  type: 'done' | 'aborted' | 'error'
  kind?: string
  message?: string
  rounds?: number
}

export interface TurnRecord {
  calls: TurnCall[]
  outcome: TurnOutcome | null
}

/**
 * **Off by default, and dropped from a production build.**
 *
 * `scripts/ai-eval.cjs` grades a turn on what the model actually did — the tool names, their
 * arguments, their order and what came back — and on how the turn ended. None of that is
 * anywhere else: only `forModel` crosses IPC, the panel keeps a reply and its chips, and
 * `TurnLog` keeps names and durations. Recording is opt-in through
 * `window.__sgvueDev.chat.record(true)`, so with `DEVTOOLS` false this whole block is
 * unreachable and Rollup removes it; with `DEVTOOLS` true and recording off it costs one
 * boolean test per tool call and retains nothing.
 */
let recording = false
let turnRecord: TurnRecord = { calls: [], outcome: null }

export function setTurnRecording(on: boolean): void {
  recording = on
  turnRecord = { calls: [], outcome: null }
}

export const lastTurnRecord = (): TurnRecord => turnRecord

/** One round's `usage` event folded into the turn's running total. Pure, so it is testable. */
export function addUsage(
  so_far: TurnUsage | null,
  round: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreateTokens: number
    model?: string
  }
): TurnUsage {
  const base = so_far ?? {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    rounds: 0
  }
  return {
    inputTokens: base.inputTokens + round.inputTokens,
    outputTokens: base.outputTokens + round.outputTokens,
    cacheReadTokens: base.cacheReadTokens + round.cacheReadTokens,
    cacheCreateTokens: base.cacheCreateTokens + round.cacheCreateTokens,
    rounds: base.rounds + 1,
    // The **last** round's served model, not the first: a fallback can happen mid-turn, and
    // the model that wrote the reply is the one worth recording. 2026-09-20.
    ...(round.model ? { model: round.model } : base.model ? { model: base.model } : {})
  }
}

/** The turn being written, or null between turns. */
interface LiveTurn {
  id: string
  /** The review state from before the turn, which its `revert` is measured against. */
  before: TurnSnapshot
  text: string
  turn: TurnState
  resolve: () => void
}
let live: LiveTurn | null = null

/**
 * Where the camera stands, for the per-turn view state (2026-10-02): the viewer's own, since the
 * store does not hold it — or `null` before there is a viewer.
 */
const cameraPose = (): CameraPose | null => getViewer()?.getCamera() ?? null

/** The schema is a cache breakpoint, so it is sent only when the federation has changed. */
let sentSchemaFor = ''

const federationStamp = (): string => {
  const s = useShell.getState()
  return `${s.loaded.join('|')}#${s.federation.elements.length}`
}

/**
 * The trace is narration. Nothing it does may cost a tool its result or a turn its answer: if
 * working out what to show ever fails, the failure is logged, the trace is dropped — the reply
 * then arrives as a plain one — and the turn goes on.
 */
function narrated<T>(tell: () => T, otherwise: T): T {
  try {
    return tell()
  } catch (error) {
    console.error('[trace]', error)
    traceFail()
    return otherwise
  }
}

/**
 * What an executor is handed. `traced` is a call of the turn the panel is showing: the trace is
 * told of it. A harness's throwaway call, or a call for a turn that is no longer running, is not.
 */
function context(turn: TurnState, traced = false): ToolContext {
  return {
    state: () => useShell.getState(),
    sql: (sql) => federation.query(sql),
    rawLine: (modelKey, expressId) => federation.rawLine(modelKey, expressId),
    turn,
    ...(traced
      ? {
          trace: (name: string, input: Readonly<Record<string, unknown>>): void =>
            narrated(() => traceToolExec(name, input, useShell.getState().federation), undefined)
        }
      : {})
  }
}

/* ────────────────────────────── sending a turn ────────────────────────────── */

/**
 * `SGVue.dc.html:1591`'s `chatSend`. The reply quote travels with the turn so the model can
 * resolve "those" against the right message, and the pre-turn snapshot is taken **before**
 * anything runs so ↺ can put the view back.
 */
export async function sendChat(text?: string): Promise<void> {
  const bridge = api()
  const s = useShell.getState()
  const q = (text ?? s.chatInput ?? '').trim()
  if (!q || s.chatBusy || !s.federation.elements.length) return
  if (!bridge) {
    useShell.getState().chatFail('The assistant is unavailable.')
    return
  }

  // A reply carries its target inline, truncated exactly as the design truncates it (`:1597`).
  // Its author is the name the panel shows — `Vee` for the assistant since 2026-10-01.
  const target = s.chatReplyTo == null ? null : s.chatMsgs[s.chatReplyTo]
  const quote = target
    ? {
        who: authorOf(target),
        text: target.text.length > 220 ? target.text.slice(0, 220) + '…' : target.text
      }
    : null

  const before = useShell.getState().chatBegin(q, quote)
  // Send: the trace begins with the turn. The live reply takes the place the assistant's
  // message will get — the slot after the user's, which `chatBegin` has just pushed.
  narrated(() => traceBegin(useShell.getState().federation, useShell.getState().chatMsgs.length), undefined)
  const turnId = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const stamp = federationStamp()
  const sendSchema = stamp !== sentSchemaFor

  const after = useShell.getState()
  turnLog = { tools: [], usage: null }
  if (DEVTOOLS && recording) turnRecord = { calls: [], outcome: null }
  const done = new Promise<void>((resolve) => {
    live = { id: turnId, before, text: '', turn: newTurnState(), resolve }
  })

  try {
    await bridge.aiTurn({
      turnId,
      userText: q,
      quote,
      viewState: chatViewState(
        after,
        after.federation,
        visFn(after),
        scheduleBriefOf(),
        cameraPose()
      ) as unknown as Record<string, unknown>,
      ...(sendSchema
        ? { schema: chatSchema(after.federation) as unknown as Record<string, unknown> }
        : {})
    })
    sentSchemaFor = stamp
  } catch (error) {
    live = null
    traceFail()
    useShell.getState().chatFail(error instanceof Error ? error.message : String(error))
    return
  }
  await done
}

/** The panel's stop control. Main rolls its transcript back to the pre-turn length. */
export function abortChat(): void {
  const id = live?.id
  if (id) void api()?.aiAbort(id)
}

/* ────────────────────────────── wiring ────────────────────────────── */

/** Called once from the shell's mount effect. Returns the teardown. */
export function installAi(): () => void {
  const bridge = api()
  if (!bridge) return () => {}

  const offExec = bridge.onAiToolExec((call: AiToolExec) => {
    void runToolCall(call)
  })

  const offEvent = bridge.onAiEvent((event: AiEvent) => handleEvent(event))

  return () => {
    offExec?.()
    offEvent?.()
  }
}

/**
 * Run one tool outside a conversation, for the dev harnesses (`window.__sgvueDev.tool`).
 *
 * It goes through the same `executeTool` and the same context the model's calls do — so what
 * `scripts/shell-sanity.cjs` reads back on a real model is what the assistant would be handed
 * — with a throwaway turn, so nothing it produces reaches the panel. Dev only: its one caller
 * lives behind the `DEVTOOLS` constant and is dropped from a production bundle.
 */
export function runToolOnce(name: string, input: unknown): Promise<unknown> {
  return executeTool(name, input, context(newTurnState()))
}

/**
 * Run one tool and hand back **both** halves of its outcome, for the dev harnesses
 * (`window.__sgvueDev.toolUi`).
 *
 * `runToolOnce` above returns only `forModel`, which is all that crosses IPC — so the chips,
 * the table and the pending patch a tool hands the *panel* are invisible to a harness. That is
 * exactly what `scripts/ai-audit.cjs` has to measure. Same `executeTool`, same context, a
 * throwaway turn: nothing it produces reaches the transcript. Dev only, on the same footing as
 * `runToolOnce` — its one caller is behind the `DEVTOOLS` constant.
 */
export async function runToolWithUi(
  name: string,
  input: unknown
): Promise<{ forModel: unknown; ui: TurnState }> {
  const turn = newTurnState()
  const forModel = await executeTool(name, input, context(turn))
  return { forModel, ui: turn }
}

/**
 * The two payloads a turn sends, built by the app's own functions, for the dev harnesses
 * (`window.__sgvueDev.chat.payloads`).
 *
 * `scripts/ai-audit.cjs` measures what the cached schema block and the per-turn view-state
 * message actually cost on a real federation. Reimplementing either in the harness would
 * measure the harness; this measures the app. Dev only.
 */
export function chatPayloads(): { schema: unknown; viewState: unknown } {
  const s = useShell.getState()
  return {
    schema: chatSchema(s.federation),
    viewState: chatViewState(s, s.federation, visFn(s), scheduleBriefOf(), cameraPose())
  }
}

/** One call's outcome, as a harness reads it back. */
export interface HarnessResult {
  name: string
  ok: boolean
  forModel?: unknown
  error?: string
  ms: number
}

/** The turn a harness is stepping through, or null. */
let scripted: { before: TurnSnapshot; turn: TurnState } | null = null

/**
 * One turn without the API, **a step at a time**, for the dev harnesses
 * (`window.__sgvueDev.chat.step`) — 2026-10-01.
 *
 * The panel's own path: `begin` is `chatBegin` and the trace's Send; `start` is the stream's
 * `tool_start`; `exec` runs one tool through `executeTool` into the turn's one `TurnState`, the
 * trace hearing of it as it does of a real call; `done` commits the reply through `chatFinish`
 * with the trace's summary; `fail` is `chatFail`. Each step is stamped with the trace's clock,
 * so a harness that pins that clock (`window.__sgvueDev.trace.pin`) decides exactly when each
 * one happened — which is how a capture holds the turn at any instant of its choreography.
 * Dev only: its callers are behind the `DEVTOOLS` constant.
 */
export const scriptedTurn = {
  begin(userText: string): void {
    const before = useShell.getState().chatBegin(userText, null)
    traceBegin(useShell.getState().federation, useShell.getState().chatMsgs.length)
    scripted = { before, turn: newTurnState() }
  },
  start(): void {
    if (scripted) traceToolStart()
  },
  async exec(name: string, input: unknown = {}): Promise<HarnessResult> {
    const turn = scripted?.turn ?? newTurnState()
    const started = performance.now()
    try {
      const forModel = await executeTool(name, input, context(turn, !!scripted))
      return { name, ok: true, forModel, ms: performance.now() - started }
    } catch (error) {
      return {
        name,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        ms: performance.now() - started
      }
    }
  },
  /** Commit the reply. Returns the committed message's index, or −1 with no turn begun. */
  done(reply: string): number {
    if (!scripted) return -1
    const { before, turn } = scripted
    scripted = null
    const trace = narrated(() => traceDone(reply, !!turn.table), null)
    useShell.getState().chatFinish(reply, { ...turn, trace }, before)
    return useShell.getState().chatMsgs.length - 1
  },
  fail(message: string): void {
    scripted = null
    traceFail()
    useShell.getState().chatFail(message)
  }
}

/**
 * Simulate one whole turn's tool sequence, for the dev harnesses
 * (`window.__sgvueDev.chat.turn`).
 *
 * The panel's own path without the API: `chatBegin` takes the pre-turn snapshot, every call
 * accumulates into **one** `TurnState` exactly as a real turn's rounds do — which is what makes
 * `apply_visibility`'s "append rather than replace on a second call in the same turn" rule
 * reachable at all — and `chatFinish` commits the message with its chips, table, pending patch
 * and undo snapshot. Returns the committed message's index so the harness can drive the
 * designed `applyPending` / `dismissPending` / `revertTurn` controls against it. Dev only.
 *
 * It is `scriptedTurn` above run straight through — so the whole turn happens within a few
 * milliseconds of its Send, and its reply is the trace's "answered at once" case.
 */
export async function runTurnOnce(
  userText: string,
  calls: readonly { name: string; input?: unknown }[],
  reply = '(harness)'
): Promise<{ index: number; results: HarnessResult[] }> {
  scriptedTurn.begin(userText)
  const results: HarnessResult[] = []
  for (const call of calls) results.push(await scriptedTurn.exec(call.name, call.input ?? {}))
  return { index: scriptedTurn.done(reply), results }
}

/**
 * What a call that would have asked the user is answered with when its turn is no longer the
 * live one — 2026-10-02, the consent gate's review.
 */
export const STOPPED_ASK = 'The turn was stopped, so nothing was asked.'

/**
 * And what any other **view** call is answered with there — phase 4, the same review's
 * leftover. A stale call's throwaway `TurnState` belongs to no reply: an isolate, a camera move
 * or a theme switch that landed after Stop, or under a newer turn, changed the view with no
 * reply to say so and no `revert` to put it back. A read changes nothing, so it still runs.
 */
export const STOPPED_VIEW = 'The turn was stopped, so nothing was changed.'

/**
 * The answer to a call main forwards for a turn that is not the live one, or `null` when the
 * call may run all the same — which is every read, and nothing else.
 */
export function staleAnswer(
  name: string,
  input?: Readonly<Record<string, unknown>> | null
): Record<string, unknown> | null {
  if (gateOf(name, input)) return { message: STOPPED_ASK, applied: false, pending: false }
  return isViewTool(name) ? { message: STOPPED_VIEW, applied: false } : null
}

async function runToolCall(call: AiToolExec): Promise<void> {
  const bridge = api()
  if (!bridge) return
  // A call for a turn that is no longer running still gets an answer: leaving a `tool_use`
  // without its `tool_result` is the one thing the transcript may never contain.
  const ours = live !== null && live.id === call.turnId
  const turn = ours && live ? live.turn : newTurnState()
  // Folded to `0` in a production build, so the clock is not read there at all.
  const started = DEVTOOLS && recording ? performance.now() : 0
  try {
    // …but a call that only **asks** is not run for it. A stale call has a throwaway
    // `TurnState`, so the one-request-a-turn rule cannot see it and nothing it put up would
    // belong to a reply: after Stop, or under a newer turn, `open_files` would still have
    // raised the Open dialog and `unload_model` the sidebar's strip. It is answered in words.
    // Phase 4: so is every other view tool — only a read is still run (`staleAnswer`).
    const result =
      (ours ? null : staleAnswer(call.name, call.input)) ??
      (await executeTool(call.name, call.input, context(turn, ours)))
    if (DEVTOOLS && recording) {
      turnRecord.calls.push({
        name: call.name,
        input: call.input,
        ok: true,
        ms: performance.now() - started,
        result
      })
    }
    bridge.aiToolResult({ turnId: call.turnId, callId: call.callId, ok: true, result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (DEVTOOLS && recording) {
      turnRecord.calls.push({
        name: call.name,
        input: call.input,
        ok: false,
        ms: performance.now() - started,
        error: message
      })
    }
    bridge.aiToolResult({
      turnId: call.turnId,
      callId: call.callId,
      ok: false,
      message
    })
  }
}

export function handleEvent(event: AiEvent): void {
  const shell = useShell.getState()
  if (event.type === 'request_snapshot') {
    lastSnapshot = event.json
    return
  }
  if (!live || live.id !== event.turnId) return

  switch (event.type) {
    case 'text_delta':
      live.text += event.text
      return
    case 'tool_start':
      // The first of these is where the trace's Read begins; what the tool is and what it
      // matches comes with its execution (`context`'s `trace`).
      traceToolStart()
      return
    case 'tool_done':
      turnLog.tools.push({ name: event.name, ms: event.ms, ok: event.ok })
      return
    case 'usage':
      turnLog.usage = addUsage(turnLog.usage, event)
      return
    case 'done': {
      const t = live
      live = null
      if (DEVTOOLS && recording) turnRecord.outcome = { type: 'done', rounds: event.rounds }
      const reply = event.text || t.text.trim() || 'Done.'
      // The answer: the trace stops at once and hands over what the reply keeps of it.
      const trace = narrated(() => traceDone(reply, !!t.turn.table), null)
      shell.chatFinish(reply, { ...t.turn, trace }, t.before)
      t.resolve()
      return
    }
    case 'aborted': {
      const t = live
      live = null
      if (DEVTOOLS && recording) turnRecord.outcome = { type: 'aborted' }
      traceFail()
      shell.chatFail('Stopped.')
      t.resolve()
      return
    }
    case 'error': {
      const t = live
      live = null
      if (DEVTOOLS && recording) {
        turnRecord.outcome = { type: 'error', kind: event.kind, message: event.message }
      }
      traceFail()
      shell.chatFail(event.message)
      t.resolve()
      return
    }
  }
}
