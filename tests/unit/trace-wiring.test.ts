/**
 * The thinking trace, fed by a real turn — `ai/trace-store.ts`, and where `ai/bridge.ts`,
 * `executeTool` and the shell store touch it.
 *
 * `trace.test.ts` checks the arithmetic on a timeline it builds by hand. This checks that a turn
 * as the app runs one — `sendChat`, the events main forwards, a tool executed through the real
 * executor — produces that timeline, that the clock can be pinned, and that the reply a finished
 * turn commits carries what its trace left: the status, the rows, the width.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { federate } from '../../src/shared/federate'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { useShell, type ChatMessage } from '../../src/renderer/state/shell'
import { handleEvent, installAi, runTurnOnce, scriptedTurn, sendChat } from '../../src/renderer/ai/bridge'
import { traceCues, traceFrame } from '../../src/renderer/ai/trace'
import { onTrace, pinTrace, traceFail, traceNow, traceState } from '../../src/renderer/ai/trace-store'
import { chatRow, veeStateOf } from '../../src/renderer/state/selectors/chat'
import type { AiEvent, AiToolExec, AiToolResult } from '../../src/shared/ipc-contract'
import { resetShell } from './stub-viewer'

const full = federate(['ARC', 'STR', 'SIT', 'MEP'].map((k) => mockModelIndex(k)))

/** "Which walls have no thermal transmittance?" — 80 walls, 24 with none. */
const WALLS = {
  rules: [
    { prop: 'IfcEntity', op: '=', val: 'IfcWall' },
    { prop: 'ThermalTransmittance', op: 'absent', val: null }
  ]
}

let sent: { turnId: string; userText: string }[] = []
let aborted: string[] = []
/** What main would do: forward a tool call, forward an event, and hear a tool's result. */
let exec: ((call: AiToolExec) => void) | null = null
let emit: ((event: AiEvent) => void) | null = null
let results: AiToolResult[] = []
let onResult: (() => void) | null = null

beforeEach(() => {
  resetShell()
  useShell.getState().commitModels(full)
  traceFail()
  pinTrace(null)
  sent = []
  aborted = []
  results = []
  exec = emit = onResult = null
  ;(globalThis as { window?: unknown }).window = {
    sgvue: {
      aiTurn: (request: { turnId: string; userText: string }) => {
        sent.push(request)
        return Promise.resolve()
      },
      aiAbort: (turnId: string) => {
        aborted.push(turnId)
        return Promise.resolve()
      },
      onAiToolExec: (fn: (call: AiToolExec) => void) => {
        exec = fn
        return () => {
          exec = null
        }
      },
      onAiEvent: (fn: (event: AiEvent) => void) => {
        emit = fn
        return () => {
          emit = null
        }
      },
      aiToolResult: (result: AiToolResult) => {
        results.push(result)
        onResult?.()
      }
    }
  }
})

/** Forward one tool call as main does, and wait for the renderer's answer to it. */
const call = (c: AiToolExec): Promise<AiToolResult> =>
  new Promise((resolve) => {
    onResult = () => resolve(results[results.length - 1])
    exec!(c)
  })

afterEach(() => {
  traceFail()
  pinTrace(null)
  delete (globalThis as { window?: unknown }).window
})

const messages = (): ChatMessage[] => useShell.getState().chatMsgs
const last = (): ChatMessage => messages()[messages().length - 1]

describe('the clock', () => {
  it('is the page’s own, in seconds — and stands still while pinned', () => {
    const a = traceNow()
    expect(Math.abs(a - performance.now() / 1000)).toBeLessThan(0.05)
    pinTrace(42.5)
    expect(traceNow()).toBe(42.5)
    expect(traceNow()).toBe(42.5)
    expect(traceState().pinned).toBe(42.5)
    pinTrace(null)
    expect(Math.abs(traceNow() - performance.now() / 1000)).toBeLessThan(0.05)
  })

  it('tells its listeners of a pin, and of nothing when nothing changed', () => {
    let heard = 0
    const stop = onTrace(() => heard++)
    pinTrace(3)
    pinTrace(3)
    pinTrace(4)
    stop()
    pinTrace(null)
    expect(heard).toBe(2)
  })
})

describe('a real turn, as the trace hears it', () => {
  it('begins at `sendChat`, with the federation as it stands and the reply’s place in the transcript', () => {
    pinTrace(100)
    useShell.setState({ chatInput: 'which walls have no thermal transmittance?' })
    void sendChat()
    expect(sent).toHaveLength(1)
    // The boot audit is message 0 and the question message 1: the reply will be message 2.
    expect(messages().map((m) => m.role)).toEqual(['assistant', 'user'])
    const { timeline, index } = traceState()
    expect(index).toBe(2)
    expect(timeline).toMatchObject({ send: 100, read: { models: [140, 244, 20, 8], total: 412 }, tool: null, calls: [], answer: null })
    expect(useShell.getState().chatBusy).toBe(true)
  })

  it('takes Read from the stream’s `tool_start`, a step from each executed tool, and the answer from `done`', async () => {
    const stop = installAi()
    pinTrace(100)
    useShell.setState({ chatInput: 'which walls have no thermal transmittance?' })
    void sendChat()
    const turnId = sent[0].turnId

    pinTrace(103)
    emit!({ type: 'tool_start', turnId, name: 'query_elements' })
    expect(traceState().timeline!.tool).toBe(103)
    // A second `tool_start` does not move Read.
    pinTrace(103.5)
    emit!({ type: 'tool_start', turnId, name: 'get_view_state' })
    expect(traceState().timeline!.tool).toBe(103)

    // Main forwards the call; the renderer runs it through the real executor and answers.
    pinTrace(103.2)
    const answer = await call({ turnId, callId: 'c1', name: 'query_elements', input: WALLS })
    expect(answer).toMatchObject({ turnId, callId: 'c1', ok: true })
    const tl = traceState().timeline!
    expect(tl.calls).toHaveLength(1)
    expect(tl.calls[0]).toMatchObject({
      at: 103.2,
      facts: {
        name: 'query_elements',
        rules: {
          filter: { what: 'IfcWall', count: 80, noun: 'wall' },
          check: { props: 'Thermal Transmittance', count: 24, unit: 'missing' }
        }
      }
    })
    expect(traceCues(tl).steps.map((s) => [s.kind, Number(s.at.toFixed(6))])).toEqual([
      ['read', 103],
      ['filter', 104.8],
      ['check', 106.4]
    ])

    // A call for a turn that is no longer this one is still answered — and is not the trace's.
    const stray = await call({ turnId: 'some-other-turn', callId: 'c9', name: 'get_view_state', input: {} })
    expect(stray.ok).toBe(true)
    expect(traceState().timeline!.calls).toHaveLength(1)

    pinTrace(109)
    emit!({ type: 'done', turnId, text: '**24 of 80 walls** have no Thermal Transmittance.', rounds: 2 })
    expect(traceState().timeline).toMatchObject({ answer: 109, words: 8, table: false })
    expect(useShell.getState().chatBusy).toBe(false)
    expect(last().trace!.status).toBe('checked 80 walls · 9s')
    stop()
  })

  it('hears a property in the file’s own spelling: the names are resolved before the trace is told', async () => {
    scriptedTurn.begin('walls with no thermal transmittance')
    // The assistant's guess at the name; the file authors `ThermalTransmittance`.
    await scriptedTurn.exec('query_elements', {
      rules: [
        { prop: 'IfcEntity', op: '=', val: 'IfcWall' },
        { prop: 'thermal transmittance', op: 'absent', val: null }
      ]
    })
    expect(traceState().timeline!.calls[0].facts.rules!.check).toEqual({
      props: 'Thermal Transmittance',
      count: 24,
      unit: 'missing'
    })
    scriptedTurn.fail('Stopped.')
  })

  it('is not told of a harness’s throwaway call, nor of anything once the turn is answered', async () => {
    // No turn: nothing to add to.
    await scriptedTurn.exec('query_elements', WALLS)
    expect(traceState().timeline).toBeNull()
    await runTurnOnce('q', [{ name: 'get_view_state' }], 'Done.')
    const answered = traceState().timeline
    expect(answered!.calls.map((c) => c.facts.name)).toEqual(['get_view_state'])
    await scriptedTurn.exec('query_elements', WALLS)
    expect(traceState().timeline).toBe(answered)
  })
})

describe('what a finished reply keeps', () => {
  it('carries the status, the rows and the width its trace left — and the store’s own fields as before', async () => {
    pinTrace(50)
    scriptedTurn.begin('which walls have no thermal transmittance?')
    scriptedTurn.start()
    await scriptedTurn.exec('query_elements', WALLS)
    pinTrace(57.2)
    scriptedTurn.done('**24 of 80 walls** have no Thermal Transmittance.')
    const reply = last()
    expect(reply).toMatchObject({ role: 'assistant', text: '**24 of 80 walls** have no Thermal Transmittance.', undoSnap: null })
    expect(reply.trace).toEqual({
      status: 'checked 80 walls · 7s',
      wide: true,
      noun: 'wall',
      rows: [
        { label: 'L1', n: 5, ids: expect.any(Array) },
        { label: 'L2', n: 5, ids: expect.any(Array) },
        { label: 'L3', n: 5, ids: expect.any(Array) },
        { label: 'L4', n: 5, ids: expect.any(Array) },
        { label: 'Roof', n: 4, ids: expect.any(Array) }
      ]
    })
    // The rows' ids are the federation's, and they are exactly the walls that carry no value.
    const ids = reply.trace!.rows.flatMap((r) => r.ids)
    expect(ids).toHaveLength(24)
    expect(ids.every((id) => full.byId.get(id)?.type === 'IfcWall')).toBe(true)
    // …which is what a click on a row selects.
    useShell.getState().select(reply.trace!.rows[4].ids, false)
    expect(useShell.getState().selIds).toHaveLength(4)

    const row = chatRow(reply, 2)
    expect(row).toMatchObject({ traced: true, status: 'checked 80 walls · 7s', wide: true, who: 'Vee' })
  })

  it('has no rows beside a table, and keeps the table', async () => {
    scriptedTurn.begin('walls by level')
    await scriptedTurn.exec('summarize_elements', {
      groupBy: 'Level',
      rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }]
    })
    scriptedTurn.done('Walls by level.')
    expect(last().table).not.toBeNull()
    expect(last().trace).toMatchObject({ rows: [], wide: true, noun: 'wall' })
    expect(last().trace!.status).toMatch(/^found 80 walls · \d+s$/)
  })

  it('is a plain reply with a time when no tool ran, and carries no trace at all when no turn produced it', () => {
    pinTrace(10)
    scriptedTurn.begin('hello')
    pinTrace(12.6)
    scriptedTurn.done('Hello.')
    expect(last().trace).toEqual({ status: '3s', wide: false, rows: [], noun: 'element' })
    expect(chatRow(last(), 2)).toMatchObject({ traced: true, status: '3s', wide: false })
    // The boot audit was written by no turn.
    expect(messages()[0].trace).toBeUndefined()
    expect(chatRow(messages()[0], 0)).toMatchObject({ traced: false, status: '', wide: false })
    // A user's message never is, whatever it carries.
    expect(chatRow({ role: 'user', text: 'x', trace: last().trace }, 1)).toMatchObject({ traced: false, status: '' })
  })

  it('draws the answer from the moment `done` arrives, whatever the trace was doing', async () => {
    pinTrace(20)
    scriptedTurn.begin('which walls have no thermal transmittance?')
    scriptedTurn.start()
    await scriptedTurn.exec('query_elements', WALLS)
    // 0.3 s in: `Thinking` has not even come up. The answer arrives.
    pinTrace(20.3)
    scriptedTurn.done('Twenty-four.')
    const tl = traceState().timeline!
    const layout = { width: 282, dpr: 1, textH: 19.375, reduced: false }
    const at = traceFrame(tl, 20.3, layout)
    expect(at.bubble).toMatchObject({ wide: true, opacity: 1 })
    expect(at.bubble.height).toBeCloseTo(52, 9)
    expect(at.ticker.lines.map((l) => [l.label, l.count!.n])).toEqual([['Checking Thermal Transmittance', 24]])
    // Two seconds later it is the finished reply, and nothing moves.
    expect(traceFrame(tl, 22.3, layout).settled).toBe(true)
    expect(last().trace!.status).toBe('checked 80 walls · 1s')
  })
})

describe('a turn that fails or is stopped', () => {
  it('leaves the transcript as it was and takes the trace away', () => {
    useShell.setState({ chatInput: 'how many walls?' })
    void sendChat()
    const turnId = sent[0].turnId
    expect(traceState().timeline).not.toBeNull()
    handleEvent({ type: 'aborted', turnId })
    expect(traceState().timeline).toBeNull()
    expect(useShell.getState()).toMatchObject({ chatBusy: false, chatErr: 'Stopped.' })
    expect(messages().map((m) => m.role)).toEqual(['assistant', 'user'])

    useShell.setState({ chatInput: 'and doors?' })
    void sendChat()
    expect(traceState().timeline).not.toBeNull()
    handleEvent({ type: 'error', turnId: sent[1].turnId, kind: 'no_key', message: 'No API key.' })
    expect(traceState().timeline).toBeNull()
    expect(useShell.getState().chatErr).toBe('No API key.')
  })

  it('commits a real turn’s `done` with the trace’s summary', () => {
    pinTrace(5)
    useShell.setState({ chatInput: 'hello' })
    void sendChat()
    pinTrace(9.4)
    handleEvent({ type: 'done', turnId: sent[0].turnId, text: 'Hello.', rounds: 1 })
    expect(last()).toMatchObject({ role: 'assistant', text: 'Hello.', trace: { status: '4s', wide: false, rows: [] } })
    expect(useShell.getState().chatBusy).toBe(false)
    expect(traceState().timeline).toMatchObject({ send: 5, answer: 9.4 })
  })
})

describe('the trace is narration', () => {
  it('never costs a tool its result or the turn its answer when it fails', async () => {
    const stop = installAi()
    const said = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      useShell.setState({ chatInput: 'which walls have no thermal transmittance?' })
      void sendChat()
      const turnId = sent[0].turnId
      expect(traceState().timeline).not.toBeNull()
      // A federation the trace cannot read — it has no storey ladder — and the executor can.
      useShell.setState({ federation: { ...full, storeys: undefined as never } })
      const answer = await call({ turnId, callId: 'c1', name: 'query_elements', input: WALLS })
      // The tool answered as it would have, the failure was said out loud, and the trace is gone.
      expect(answer).toMatchObject({ turnId, callId: 'c1', ok: true })
      expect(said).toHaveBeenCalledTimes(1)
      expect(said.mock.calls[0][0]).toBe('[trace]')
      expect(traceState().timeline).toBeNull()
      expect(useShell.getState().chatBusy).toBe(true)
      // The answer still commits — as a plain reply, with nothing of a trace on it.
      emit!({ type: 'done', turnId, text: 'Twenty-four of them.', rounds: 2 })
      expect(useShell.getState().chatBusy).toBe(false)
      expect(last()).toMatchObject({ role: 'assistant', text: 'Twenty-four of them.' })
      expect(last().trace).toBeUndefined()
      expect(chatRow(last(), 2)).toMatchObject({ traced: false, status: '' })
    } finally {
      said.mockRestore()
      stop()
    }
  })
})

describe('Vee, in front of a reply that is not being written', () => {
  const reply = (extra: Partial<ChatMessage> = {}): ChatMessage => ({ role: 'assistant', text: 'x', ...extra })
  const turn = { status: '3s', wide: false, rows: [], noun: 'element' }

  it('is `done` only on a turn’s reply that is the newest message', () => {
    const msgs: ChatMessage[] = [reply(), { role: 'user', text: 'q' }, reply({ trace: turn })]
    expect([0, 1, 2].map((i) => veeStateOf(msgs, i))).toEqual(['idle', 'idle', 'done'])
    // The next question makes it an older reply.
    const more: ChatMessage[] = [...msgs, { role: 'user', text: 'again' }]
    expect([0, 1, 2, 3].map((i) => veeStateOf(more, i))).toEqual(['idle', 'idle', 'idle', 'idle'])
    // The boot audit alone was produced by no turn: at rest.
    expect(veeStateOf([reply()], 0)).toBe('idle')
    expect(veeStateOf([], 0)).toBe('idle')
  })
})
