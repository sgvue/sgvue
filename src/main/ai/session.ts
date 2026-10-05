/**
 * One assistant session per window: the gateway, its client, and the bridge that forwards
 * every tool call to that window's renderer.
 *
 * Main holds the API transcript and the key. It holds **no model data** — `runTool` below is
 * the whole of its relationship with the model: a name, an arguments object, and whatever
 * JSON the renderer sends back. A tool that does not answer inside its budget is answered
 * for it, because a `tool_use` left without a `tool_result` would poison the transcript for
 * the rest of the conversation.
 */
import { ipcMain, type WebContents } from 'electron'
import {
  AI_JSON_MAX_CHARS,
  AiToolResult,
  AiTurnAbort,
  AiTurnStart,
  type AiErrorKind,
  type AiEvent
} from '../../shared/ipc-contract'
import {
  CH_AI_EVENT,
  CH_AI_TOOL_EXEC,
  CH_AI_TOOL_RESULT,
  CH_AI_TURN_ABORT,
  CH_AI_TURN_START
} from '../../shared/ipc-channels'
import { apiKey, view as settingsView } from '../settings'
import { AiGateway, anthropicClient, classifyError, type AiClient } from './gateway'

type Answer = { ok: boolean; result?: unknown; message?: string }

interface Pending {
  resolve(answer: Answer): void
  timer: NodeJS.Timeout
}

interface Session {
  gateway: AiGateway
  pending: Map<string, Pending>
  nextCall: number
  /** The key the client was built with, so a key change rebuilds it. */
  builtWith: string
  /** The turn a tool call belongs to, for the renderer's own bookkeeping, and for abort. */
  currentTurn: string
  /** Answer every outstanding call, stop the gateway and drop the window listener. */
  dispose(): void
}

const sessions = new Map<number, Session>()

/**
 * The length of `value` as JSON, or `Infinity` when it is not JSON at all (a cycle, a BigInt)
 * — measured the way `main/sessions.ts` measures a session.
 */
function jsonLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/** A session whose client is still being built, per window. */
const building = new Map<number, { key: string; session: Promise<Session> }>()

/**
 * The window's session, or a new one. The SDK client is built only here, when a session is
 * created — the first turn, or the first after the key changed — not on every turn. Two turns
 * that arrive while one build is in flight share it rather than each building (and the second
 * disposing the first's) session.
 */
function sessionFor(wc: WebContents, key: string): Promise<Session> {
  const existing = sessions.get(wc.id)
  if (existing && existing.builtWith === key) return Promise.resolve(existing)
  const inFlight = building.get(wc.id)
  if (inFlight && inFlight.key === key) return inFlight.session
  // The key changed: the old session's calls are answered and its listener goes with it —
  // before the wait, so nothing that starts during the build can be caught by it.
  existing?.dispose()
  const entry = {
    key,
    session: anthropicClient(key).then((client) => createSession(wc, key, client))
  }
  building.set(wc.id, entry)
  const settled = (): void => {
    if (building.get(wc.id) === entry) building.delete(wc.id)
  }
  entry.session.then(settled, settled)
  return entry.session
}

function createSession(wc: WebContents, key: string, client: AiClient): Session {
  // A build for an older key that finished first is replaced, not left listening.
  sessions.get(wc.id)?.dispose()

  const emit = (event: AiEvent): void => {
    if (!wc.isDestroyed()) wc.send(CH_AI_EVENT, event)
  }
  const onDestroyed = (): void => session.dispose()
  const session: Session = {
    pending: new Map(),
    nextCall: 1,
    builtWith: key,
    currentTurn: '',
    dispose() {
      wc.off('destroyed', onDestroyed)
      for (const p of session.pending.values()) {
        clearTimeout(p.timer)
        p.resolve({ ok: false, message: 'The assistant was restarted before the tool answered.' })
      }
      session.pending.clear()
      session.gateway.abort()
      if (sessions.get(wc.id) === session) sessions.delete(wc.id)
    },
    gateway: new AiGateway({
      client,
      settings: () => {
        const s = settingsView()
        return { model: s.model, effort: s.effort, cacheOneHour: s.cacheOneHour }
      },
      runTool: (name, input, timeoutMs) =>
        new Promise((resolve) => {
          if (wc.isDestroyed()) {
            resolve({ ok: false, message: 'The window closed before the tool could run.' })
            return
          }
          const callId = `c${session.nextCall++}`
          const timer = setTimeout(() => {
            session.pending.delete(callId)
            resolve({
              ok: false,
              message: `${name} did not answer within ${Math.round(timeoutMs / 1000)} s.`
            })
          }, timeoutMs)
          session.pending.set(callId, { resolve, timer })
          wc.send(CH_AI_TOOL_EXEC, { turnId: session.currentTurn, callId, name, input })
        }),
      emit
    })
  }
  sessions.set(wc.id, session)
  wc.once('destroyed', onDestroyed)
  return session
}

export function registerAiIpc(): void {
  ipcMain.handle(CH_AI_TURN_START, async (event, raw: unknown) => {
    const turn = AiTurnStart.parse(raw)
    const wc = event.sender
    const fail = (kind: AiErrorKind, message: string): void =>
      wc.send(CH_AI_EVENT, { type: 'error', turnId: turn.turnId, kind, message } satisfies AiEvent)

    const key = apiKey() ?? ''
    if (!key) {
      fail(
        'no_key',
        'No API key. Open Preferences… (⌘,) and paste an Anthropic API key, or set ANTHROPIC_API_KEY in the environment.'
      )
      return
    }
    // Bounded before anything is kept: the schema is held for the whole conversation.
    for (const [what, value] of [
      ['view state', turn.viewState],
      ['model schema', turn.schema]
    ] as const) {
      if (jsonLength(value) > AI_JSON_MAX_CHARS) {
        fail('bad_request', `The ${what} is too large to send (over ${AI_JSON_MAX_CHARS} characters).`)
        return
      }
    }
    let session: Session
    try {
      session = await sessionFor(wc, key)
    } catch (error) {
      // The SDK could not be loaded or constructed: the panel is told, like any failed turn.
      const { kind, message } = classifyError(error)
      fail(kind, message)
      return
    }
    session.currentTurn = turn.turnId
    await session.gateway.run({
      turnId: turn.turnId,
      userText: turn.userText,
      quote: turn.quote ?? null,
      viewState: turn.viewState,
      schema: turn.schema ?? undefined
    })
  })

  // Only the turn it names: an abort that arrives after a newer turn has started stops nothing.
  ipcMain.handle(CH_AI_TURN_ABORT, (event, raw: unknown) => {
    const parsed = AiTurnAbort.safeParse(raw)
    const session = sessions.get(event.sender.id)
    if (parsed.success && session?.currentTurn === parsed.data.turnId) session.gateway.abort()
  })

  ipcMain.on(CH_AI_TOOL_RESULT, (event, raw: unknown) => {
    const parsed = AiToolResult.safeParse(raw)
    if (!parsed.success) return
    const session = sessions.get(event.sender.id)
    const pending = session?.pending.get(parsed.data.callId)
    if (!session || !pending) return
    session.pending.delete(parsed.data.callId)
    clearTimeout(pending.timer)
    const { ok, result, message } = parsed.data
    const length = jsonLength(ok ? (result ?? null) : (message ?? ''))
    pending.resolve(
      length > AI_JSON_MAX_CHARS
        ? {
            ok: false,
            message: `The result was too large to return (over ${AI_JSON_MAX_CHARS} characters). Ask for fewer rows or a narrower selection.`
          }
        : { ok, result, message }
    )
  })
}
