/**
 * Parity with the user, phase 4 of 4 — 2026-10-02: **the Schedules window, and placing markups.**
 *
 * The owner's direction is that the assistant should be able to do whatever the user can do in
 * the app. This phase is the last of what it could not reach:
 *
 *   · a stale call — for a turn the user stopped, or one a newer turn replaced — no longer runs
 *     when it would change the view (phase 3's review; a read still runs);
 *   · the rows of the open schedule are a set the view tools act on (`schedule: true`), through
 *     the store's own guarded actions — never the Schedules port's `act` message;
 *   · `manage_schedules` reaches that window's own controls over the private port: what crosses
 *     is an operation and a name, what comes back, at once, is what became of it — and deleting
 *     a saved setup, printing and opening a file are only ever asked for there;
 *   · `manage_markups` places a spot coordinate or a laser measurement through the store's own
 *     actions, at a point named on an element's box or in the project frame — and (the follow-up
 *     of the same day) that reply's `revert` takes away what it placed, and nothing else.
 *
 * Everything runs through `executeTool`, the one door a model's call comes through, on the
 * design's own mock federation. The Schedules window is a recording port that answers as the
 * window does (`schedule-ui/manage.ts`, whose own tests are `schedule/manage.test.ts`); the
 * viewer is a stub whose markups follow its calls as the real one's `on.spot` / `on.measure`
 * do, with the real arithmetic behind them (`shared/annotate.ts`, `shared/georef.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { boxPlace, laserDirections, LASER_AXES } from '../../src/shared/annotate'
import { federate } from '../../src/shared/federate'
import { toMap } from '../../src/shared/georef'
import type { AiEvent, AiToolExec, AiToolResult } from '../../src/shared/ipc-contract'
import { visFn } from '../../src/shared/rules'
import { MARKUPS_PLACE_CAP, MAX_TOOL_IDS } from '../../src/shared/tool-schemas'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { STOPPED_ASK, STOPPED_VIEW, installAi, sendChat, staleAnswer } from '../../src/renderer/ai/bridge'
import { executeTool, newTurnState, type PendingAction, type ToolContext } from '../../src/renderer/ai/executors'
import { CONNECT_WAIT_MS } from '../../src/renderer/ai/executors/schedule'
import { emptyTargetMessage, namesSet, resolveTargets } from '../../src/renderer/ai/executors/targets'
import { TOOL_STAGE, toolPhrase } from '../../src/renderer/ai/stages'
import { connect, openSchedule, receive, requestManage, scheduleConnected } from '../../src/renderer/model/schedule-link'
import { chatRow } from '../../src/renderer/state/selectors/chat'
import { historyDepth, setViewer, useShell, type ShellState } from '../../src/renderer/state/shell'
import type { MeasureRecord, SpotRecord } from '../../src/renderer/viewer/annotations'
import {
  MANAGE_ACK_MS,
  ManageMessage,
  ToSchedules,
  type ManageRequest
} from '../../src/schedule/messages'
import { emptySchedule, type ScheduleDef } from '../../src/schedule/schedule/def'
import { memoryStorage, resetShell, stubViewer } from './stub-viewer'

const KEYS = ['ARC', 'STR', 'SIT', 'MEP'] as const
const full = federate(KEYS.map((k) => mockModelIndex(k)))
const of = (type: string): (typeof full.elements)[number][] => full.elements.filter((e) => e.type === type)
const doors = of('IfcDoor')
const beams = of('IfcBeam')

interface Body {
  message?: string
  [key: string]: unknown
}
const turn = newTurnState()
const ctx = (): ToolContext => ({
  state: () => useShell.getState(),
  sql: (async () => ({ columns: [], rows: [], truncated: false, ms: 0 })) as never,
  rawLine: async () => null,
  turn
})
const run = async (name: string, input: unknown = {}): Promise<Body> => (await executeTool(name, input, ctx())) as Body
const fresh = (): void => void Object.assign(turn, newTurnState())
const st = (): ShellState => useShell.getState()
const visible = (): number => st().federation.elements.filter(visFn(st())).length

/* ────────────────────────────── a recording Schedules window ────────────────────────────── */

type Sent = { type: string; [k: string]: unknown }
function fakePort(): { port: MessagePort; sent: Sent[] } {
  const sent: Sent[] = []
  const port = { postMessage: (m: never) => sent.push(m), close: () => undefined, onmessage: null }
  return { port: port as unknown as MessagePort, sent }
}
/** What the window would answer to one request — everything of a `manageAck` but its envelope. */
type Answer = Record<string, unknown> | null
/**
 * A port that answers every `manage` as the Schedules window does: at once, with the request's
 * own number. `answer` returns the ack's fields, or `null` to say nothing at all (a window that
 * is held up).
 */
function managingPort(answer: (m: ManageRequest) => Answer): { port: MessagePort; sent: Sent[]; asked: ManageRequest[] } {
  const { port, sent } = fakePort()
  const asked: ManageRequest[] = []
  const post = port.postMessage.bind(port)
  ;(port as unknown as { postMessage: (m: Sent) => void }).postMessage = (m) => {
    post(m as never)
    if (m.type !== 'manage') return
    asked.push(m as unknown as ManageRequest)
    const ack = answer(m as unknown as ManageRequest)
    if (ack) queueMicrotask(() => receive({ type: 'manageAck', n: m.n, ...ack }))
  }
  return { port, sent, asked }
}

const scheduleOf = (entity: string, more: Partial<ScheduleDef> = {}): ScheduleDef => ({
  ...emptySchedule(`${entity.replace(/^Ifc/, '')} Schedule`, [entity]),
  columns: [{ field: { kind: 'core', key: 'name' } }, { field: { kind: 'core', key: 'storey' } }],
  ...more
})
/** The Schedules window says which schedule it shows. */
const shows = (def: ScheduleDef, rowCount = 0): void => receive({ type: 'current', def, rowCount })

/* ────────────────────────────── a viewer whose markups follow its calls ────────────────────────────── */

let placedSpots: number[][] = []
let placedLasers: { p: number[]; normal: number[] | null; selfId: number }[] = []
let shown: [number, boolean][] = []
let nextId = 100
/** How far every laser ray that is fired reads, in metres — or `null` for "no ray hits anything". */
let reach: number | null = 2
/** Which spot tags stand expanded, as the annotation layer keeps it. */
let expanded = new Set<number>()
/** Every markup the viewer was told to remove, in order — the Markups card's ×, by record id. */
let dropped: ['spot' | 'measure', number][] = []

function markupViewer(): ReturnType<typeof stubViewer> {
  return stubViewer({
    // `annotations.ts` `dropSpot` / `dropMeasure`: the record goes, and the list is published.
    dropSpot: (id: number) => {
      dropped.push(['spot', id])
      st().setSpots(st().spots.filter((s) => s.id !== id))
    },
    dropMeasure: (id: number) => {
      dropped.push(['measure', id])
      st().setMeasures(st().measures.filter((m) => m.id !== id))
    },
    // `annotations.ts` `spotList`: the scene point, the file's own coordinates, the map's.
    placeSpot: (p: number[]) => {
      placedSpots.push(p)
      const [ox, oy, oz] = st().offset
      const f = { x: p[0] + ox, y: p[1] + oy, z: p[2] + oz }
      const m = toMap(st().coords, f.x, f.y, f.z)
      const rec: SpotRecord = { id: ++nextId, p: p as [number, number, number], E: m ? m.E : null, N: m ? m.N : null, Z: m ? m.Z : null, ...f }
      st().setSpots([...st().spots, rec])
    },
    // `annotations.ts` `laserFrom`, with a ray that reads `reach` in every direction it is fired:
    // which directions are fired is the laser's own rule, from the normal it is handed.
    placeMeasure: (p: number[], normal: number[] | null, selfId: number) => {
      placedLasers.push({ p, normal, selfId })
      if (reach === null) return false
      const fired = laserDirections(normal as [number, number, number] | null)
      const rec: MeasureRecord = { id: ++nextId, p: p as [number, number, number] }
      for (const axis of LASER_AXES) {
        const n = fired.filter((d) => d.axis === axis).length
        if (n) rec[axis.toLowerCase() as 'x' | 'y' | 'z'] = n * reach
      }
      st().setMeasures([...st().measures, rec])
      return true
    },
    showSpot: (id: number, full: boolean) => {
      shown.push([id, full])
      if (!st().spots.some((s) => s.id === id)) return 'missing'
      if (expanded.has(id) === full) return 'already'
      if (full) expanded.add(id)
      else expanded.delete(id)
      return 'changed'
    }
  })
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  resetShell()
  placedSpots = []
  placedLasers = []
  shown = []
  nextId = 100
  reach = 2
  expanded = new Set()
  dropped = []
  setViewer(markupViewer())
  st().commitModels(full)
  fresh()
})
afterEach(() => {
  setViewer(null)
  connect(null)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/* ────────────────────────────── 1. a stale view call does not run ────────────────────────────── */

/**
 * Phase 3's review, the first leftover. A call main forwards for a turn that is no longer the
 * live one still gets an answer — a `tool_use` may never be left without its `tool_result` — but
 * it used to be *run*, with a throwaway turn: an isolate, a camera move or a theme switch landed
 * after Stop with no reply to say so and no `revert` to put it back.
 */
describe('a view call for a turn that is no longer live', () => {
  let exec: ((call: AiToolExec) => void) | null = null
  let emit: ((event: AiEvent) => void) | null = null
  let results: AiToolResult[] = []
  let sent: { turnId: string }[] = []
  let openSchedules: Mock<() => Promise<void>>
  let stop: () => void = () => undefined

  beforeEach(() => {
    exec = emit = null
    results = []
    sent = []
    openSchedules = vi.fn(async () => undefined)
    vi.stubGlobal('window', {
      sgvue: {
        aiTurn: (request: { turnId: string }) => {
          sent.push(request)
          return Promise.resolve()
        },
        aiAbort: () => Promise.resolve(),
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
        aiToolResult: (result: AiToolResult) => void results.push(result),
        openSchedules
      }
    })
    stop = installAi()
  })
  afterEach(() => stop())

  const call = async (c: AiToolExec): Promise<AiToolResult> => {
    const n = results.length
    exec!(c)
    await vi.waitFor(() => expect(results.length).toBe(n + 1))
    return results[n]
  }
  const begin = (question: string): string => {
    useShell.setState({ chatInput: question })
    void sendChat()
    return sent[sent.length - 1].turnId
  }
  const stopped = { message: STOPPED_VIEW, applied: false }

  it('says which calls are answered in words: every view tool, and no read', () => {
    expect(STOPPED_VIEW).toBe('The turn was stopped, so nothing was changed.')
    expect(staleAnswer('apply_visibility', { action: 'reset' })).toEqual(stopped)
    expect(staleAnswer('set_view', { view: 'top' })).toEqual(stopped)
    expect(staleAnswer('manage_schedules', { op: 'undo' })).toEqual(stopped)
    expect(staleAnswer('manage_markups', { op: 'place_spot', id: 1 })).toEqual(stopped)
    // A call that only asks keeps the sentence phase 3 gave it.
    expect(staleAnswer('manage_schedules', { op: 'print' })).toEqual({ message: STOPPED_ASK, applied: false, pending: false })
    expect(staleAnswer('request_user_action', { action: 'copy_link' })).toEqual({ message: STOPPED_ASK, applied: false, pending: false })
    // A read may run: it changes nothing.
    for (const name of ['get_view_state', 'query_elements', 'get_schedule', 'summarize_elements', 'query_sql', 'nope']) {
      expect([name, staleAnswer(name, {})]).toEqual([name, null])
    }
  })

  it('is answered in words and changes nothing — after Stop, and under a newer turn', async () => {
    const { port, sent: posted } = managingPort(() => ({ result: 'done', undo: 0, redo: 1 }))
    connect(port)
    shows(scheduleOf('IfcBeam'), beams.length)
    const first = begin('isolate the beams')
    emit!({ type: 'aborted', turnId: first })
    const quiet = st()
    const before = posted.length
    for (const [name, input] of [
      ['apply_visibility', { action: 'isolate', rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcBeam' }] }],
      ['apply_visibility', { action: 'hide', schedule: true }],
      ['set_filter_stack', { steps: [{ action: 'hide', rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }] }] }],
      ['select_elements', { ids: [doors[0].id] }],
      ['set_view', { view: 'top' }],
      ['set_section', { kind: 'storey', name: 'L2' }],
      ['toggle_display', { shadows: false }],
      ['set_interface', { theme: 'light' }],
      ['set_models', { visible: ['ARC'] }],
      ['color_by_property', { property: 'IfcEntity' }],
      ['manage_views', { op: 'save' }],
      ['manage_markups', { op: 'place_spot', id: doors[0].id }],
      ['manage_markups', { op: 'place_measure', point: { x: 1, y: 2, z: 3 } }],
      ['make_schedule', { category: ['IfcDoor'], columns: [{ field: 'Name' }] }],
      ['color_by_schedule_column', { column: 'Level' }],
      ['manage_schedules', { op: 'undo' }],
      ['manage_schedules', { op: 'save' }],
      ['manage_schedules', { op: 'open' }]
    ] as const) {
      const answer = await call({ turnId: first, callId: 'c1', name, input })
      expect([name, answer]).toEqual([name, { turnId: first, callId: 'c1', ok: true, result: stopped }])
    }
    // Not one write to the store, nothing placed, nothing sent to the Schedules window, and
    // that window was not opened or raised.
    expect(st()).toBe(quiet)
    expect(visible()).toBe(full.elements.length)
    expect([placedSpots, placedLasers]).toEqual([[], []])
    expect(posted.length).toBe(before)
    expect(openSchedules).not.toHaveBeenCalled()

    // Under a newer turn, the older turn's call is answered the same way…
    const second = begin('and hide the doors')
    expect(second).not.toBe(first)
    const stale = await call({ turnId: first, callId: 'c2', name: 'apply_visibility', input: { action: 'hide', ids: doors.map((d) => d.id) } })
    expect(stale.result).toEqual(stopped)
    expect(visible()).toBe(full.elements.length)
    // …while the live turn's own call runs as ever.
    const live = await call({ turnId: second, callId: 'c3', name: 'apply_visibility', input: { action: 'hide', ids: doors.map((d) => d.id) } })
    expect(live.result).toMatchObject({ applied: true })
    expect(visible()).toBe(full.elements.length - doors.length)

    // A stale read is still run and answered, as it always was.
    const read = await call({ turnId: first, callId: 'c4', name: 'get_view_state', input: {} })
    expect(read.ok).toBe(true)
    expect((read.result as { visibleElements: number }).visibleElements).toBe(full.elements.length - doors.length)
    const sched = await call({ turnId: first, callId: 'c5', name: 'get_schedule', input: {} })
    expect((sched.result as { rowCount: number }).rowCount).toBe(beams.length)
    emit!({ type: 'done', turnId: second, text: 'Hidden.', rounds: 2 })
  })
})

/* ────────────────────────────── 2. the open schedule's rows, as a set ────────────────────────────── */

describe('schedule:true — the elements the open schedule lists', () => {
  it('needs a Schedules window, and a schedule in it', async () => {
    expect(await run('apply_visibility', { action: 'isolate', schedule: true })).toEqual({
      message: 'No Schedules window is open, so there is no open schedule whose rows could be acted on. Nothing was isolated.',
      applied: false,
      target: 'schedule',
      matched: 0
    })
    connect(fakePort().port)
    expect((await run('select_elements', { schedule: true })).message).toBe(
      'The Schedules window shows no schedule yet, so there are no schedule rows to act on. Nothing was selected. The selection is unchanged.'
    )
    shows(scheduleOf('IfcBeam', { filters: [{ field: { kind: 'core', key: 'storey' }, op: '=', value: 'Nowhere' }] }))
    expect((await run('apply_visibility', { action: 'hide', schedule: true })).message).toBe(
      'The open schedule lists no elements, so nothing was hidden.'
    )
    expect(visible()).toBe(full.elements.length)
    expect(st().selIds).toEqual([])
  })

  it('isolates, hides and shows what the schedule lists — through the store, on the undo stack', async () => {
    const { port, sent } = fakePort()
    connect(port)
    shows(scheduleOf('IfcBeam'), beams.length)
    expect(beams.length / full.elements.length).toBeGreaterThan(0.05)
    const depth = historyDepth().undo
    const iso = await run('apply_visibility', { action: 'isolate', schedule: true })
    expect(iso).toMatchObject({ applied: true, target: 'schedule', matched: beams.length })
    expect(iso.message).toContain(`the ${beams.length} elements the open schedule lists`)
    expect(visible()).toBe(beams.length)
    expect(st().federation.elements.filter(visFn(st())).every((e) => e.type === 'IfcBeam')).toBe(true)
    // The main window's own undo puts it back, as for a right-click Isolate.
    expect(historyDepth().undo).toBe(depth + 1)
    expect(turn.acted).toBe(true)
    st().step(true)
    expect(visible()).toBe(full.elements.length)

    // The filters of the schedule are the set's: only the beams of one level.
    const level = beams[0].storey
    const onLevel = beams.filter((b) => b.storey === level)
    shows(scheduleOf('IfcBeam', { filters: [{ field: { kind: 'core', key: 'storey' }, op: '=', value: level }] }), onLevel.length)
    await run('apply_visibility', { action: 'hide', schedule: true })
    expect(visible()).toBe(full.elements.length - onLevel.length)
    expect((await run('apply_visibility', { action: 'show', schedule: true })).applied).toBe(true)
    expect(visible()).toBe(full.elements.length)

    // Nothing of it went over the port: the row menu's `act` has no scope guard, and is not used.
    expect(sent.filter((m) => m.type === 'act' || m.type === 'manage' || m.type === 'define')).toEqual([])
  })

  it('runs the scope guard: a schedule that lists under 5 % of the model is held behind Apply', async () => {
    connect(fakePort().port)
    shows(scheduleOf('IfcDoor'), doors.length)
    expect(doors.length / full.elements.length).toBeLessThan(0.05)
    const before = st().chatBegin('isolate what this schedule lists', null)
    const body = await run('apply_visibility', { action: 'isolate', schedule: true })
    expect(body).toMatchObject({ applied: false, pending: true, target: 'schedule', wouldLeaveVisible: doors.length })
    // Nothing changed, and the row carries a visibility patch — never an action.
    expect(visible()).toBe(full.elements.length)
    expect(turn.pending?.patch).toBeDefined()
    expect(turn.pending?.action).toBeUndefined()
    st().chatFinish('…', { ...turn }, before)
    // The user's own click applies exactly that.
    st().applyPending(st().chatMsgs.length - 1)
    expect(visible()).toBe(doors.length)
  })

  it('selects, colours and asks to copy the GlobalIds of what the schedule lists', async () => {
    connect(fakePort().port)
    shows(scheduleOf('IfcDoor'), doors.length)
    const sel = await run('select_elements', { schedule: true })
    expect(st().selIds).toEqual(doors.map((d) => d.id))
    expect(sel.message).toContain(String(doors.length))

    const col = await run('color_by_property', { property: 'FireRating', schedule: true })
    const groups = st().colorBy!.groups
    expect(groups.reduce((a, g) => a + g.n, 0)).toBe(doors.length)
    expect(new Set(groups.flatMap((g) => g.ids))).toEqual(new Set(doors.map((d) => d.id)))
    expect(col.message).toBeDefined()

    fresh()
    const copy = await run('request_user_action', { action: 'copy_guids', schedule: true })
    expect(copy).toMatchObject({ applied: false, pending: true, target: 'schedule', count: doors.length })
    const action = turn.pending?.action as Extract<PendingAction, { kind: 'copy_guids' }>
    expect(action.kind).toBe('copy_guids')
    expect(action.text.split('\n')).toEqual(doors.map((d) => d.guid))
    // The GlobalIds are in the request, never in what the model reads.
    expect(JSON.stringify(copy)).not.toContain(doors[0].guid)
  })

  it('ids come first, then the selection, then the schedule, then rules', async () => {
    connect(fakePort().port)
    shows(scheduleOf('IfcDoor'), doors.length)
    st().select([beams[0].id, beams[1].id])
    const rules = [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }]
    expect(await run('select_elements', { ids: [beams[2].id], selection: true, schedule: true, rules })).toMatchObject({ target: 'ids' })
    expect(st().selIds).toEqual([beams[2].id])
    st().select([beams[0].id, beams[1].id])
    expect(await run('select_elements', { selection: true, schedule: true, rules, mode: 'replace' })).toMatchObject({ target: 'selection' })
    expect(await run('select_elements', { schedule: true, rules })).toMatchObject({ target: 'schedule' })
    expect(st().selIds).toEqual(doors.map((d) => d.id))
    // `schedule: false` names nothing: the rules are the set.
    await run('select_elements', { schedule: false, rules })
    expect(st().selIds).toEqual(of('IfcWall').map((w) => w.id))
  })

  it('says how to name a set when none is named — the schedule among the ways', () => {
    const none = resolveTargets({}, st())
    expect(none.source).toBe('none')
    expect(emptyTargetMessage(none, 'hidden')).toBe(
      'No set was named, so nothing was hidden. Pass rules, or ids, or selection:true, or schedule:true.'
    )
    expect(namesSet({ schedule: true })).toBe(true)
    expect(namesSet({ schedule: false })).toBe(false)
    expect(MAX_TOOL_IDS).toBe(2000)
  })
})

/* ────────────────────────────── 3. the Schedules window's own controls ────────────────────────────── */

describe('manage_schedules — asked of the Schedules window, over the port', () => {
  let openSchedules: Mock<() => Promise<void>>
  beforeEach(() => {
    openSchedules = vi.fn(async () => undefined)
    vi.stubGlobal('window', { sgvue: { openSchedules } })
  })

  it('needs the window: every operation but open is refused in words, and nothing is sent', async () => {
    for (const op of ['undo', 'redo', 'templates', 'apply_template', 'saved_list', 'load', 'save', 'rename', 'duplicate'] as const) {
      expect([op, await run('manage_schedules', { op, name: 'Doors', to: 'X' })]).toEqual([
        op,
        {
          message: 'No Schedules window is open, so nothing was done. op:"open" opens it, and make_schedule opens it with a schedule.',
          done: false,
          open: false
        }
      ])
    }
    // The three that only ask: refused too, and the turn has asked for nothing.
    for (const op of ['delete', 'print', 'open_file'] as const) {
      expect([op, (await run('manage_schedules', { op, name: 'Doors' })).done]).toEqual([op, false])
    }
    expect(turn.asked).toBeNull()
    expect(openSchedules).not.toHaveBeenCalled()
  })

  it('open is the toolbar button’s own call: it opens the window, or brings an open one forward', async () => {
    const { port } = fakePort()
    openSchedules.mockImplementation(async () => {
      setTimeout(() => connect(port), 30)
    })
    expect(await run('manage_schedules', { op: 'open' })).toEqual({ message: 'Opened the Schedules window.', done: true, open: true })
    expect(scheduleConnected()).toBe(true)
    openSchedules.mockImplementation(async () => undefined)
    shows(scheduleOf('IfcDoor'), doors.length)
    const again = await run('manage_schedules', { op: 'open' })
    expect(again.message).toBe('The Schedules window was already open — it was brought to the front.')
    // What it shows is read back with it.
    expect(again.schedule).toMatchObject({ title: 'Door Schedule', rowCount: doors.length })
    expect(openSchedules).toHaveBeenCalledTimes(2)
    // Opening a window is not something a reply's revert puts back, and asks the user nothing.
    expect([turn.acted, turn.asked, turn.pending]).toEqual([false, null, null])
  })

  it('says so when the window cannot be opened here, or never joins', async () => {
    vi.stubGlobal('window', {})
    expect(await run('manage_schedules', { op: 'open' })).toEqual({
      message: 'The Schedules window cannot be opened here.',
      done: false,
      open: false
    })
    vi.stubGlobal('window', { sgvue: { openSchedules } })
    vi.useFakeTimers()
    const pending = run('manage_schedules', { op: 'open' })
    await vi.advanceTimersByTimeAsync(CONNECT_WAIT_MS)
    expect((await pending).message).toBe(
      `The Schedules window did not open within ${CONNECT_WAIT_MS / 1000} s; the user can open it from the toolbar's schedules button.`
    )
  })

  it('sends an operation, at most two names and one flag — a message the window’s own schema accepts', async () => {
    const { port, asked } = managingPort(() => ({ result: 'done', name: 'Doors L2' }))
    connect(port)
    const t0 = Date.now()
    await run('manage_schedules', { op: 'rename', name: '  Doors ', to: ' Doors L2 ' })
    await run('manage_schedules', { op: 'undo', name: 'ignored', to: 'ignored' })
    await run('manage_schedules', { op: 'load', name: 'Doors', to: 'ignored' })
    expect(asked.map(({ at: _at, n: _n, ...rest }) => rest)).toEqual([
      { type: 'manage', op: 'rename', name: 'Doors', to: 'Doors L2', ask: true },
      // Only what the operation is about crosses: an undo names nothing, a load one name.
      { type: 'manage', op: 'undo', ask: true },
      { type: 'manage', op: 'load', name: 'Doors', ask: true }
    ])
    for (const m of asked) {
      expect(ManageMessage.parse(m)).toEqual(m)
      expect(ToSchedules.safeParse(m).success).toBe(true)
      expect(m.at).toBeGreaterThanOrEqual(t0)
    }
    expect(new Set(asked.map((m) => m.n)).size).toBe(3)
  })

  it('asks for a name where the operation needs one, before anything is sent', async () => {
    const { port, asked } = managingPort(() => ({ result: 'done' }))
    connect(port)
    for (const op of ['load', 'rename', 'duplicate', 'delete'] as const) {
      expect([op, (await run('manage_schedules', { op, name: '  ' })).message]).toEqual([
        op,
        'Say which saved setup: pass its name. Nothing was done — op:"saved_list" lists them.'
      ])
    }
    expect((await run('manage_schedules', { op: 'apply_template' })).message).toBe(
      'Say which template: pass its name. Nothing was done — op:"templates" lists them.'
    )
    expect((await run('manage_schedules', { op: 'rename', name: 'Doors' })).message).toBe(
      'Pass the new name in to — "Doors" was not renamed.'
    )
    expect(asked).toEqual([])
    expect(turn.asked).toBeNull()
  })

  it('reports what the window did: undo and redo, a template, a saved setup loaded, saved, renamed, copied', async () => {
    const answers: Record<string, Answer> = {
      undo: { result: 'done', undo: 2, redo: 1 },
      redo: { result: 'nothing', undo: 3, redo: 0 },
      apply_template: { result: 'done', name: 'Door Schedule' },
      load: { result: 'done', name: 'Fire doors', lacks: 2 },
      save: { result: 'done', name: 'Door Schedule (2)' },
      rename: { result: 'done', name: 'Doors L2' },
      duplicate: { result: 'done', name: 'Doors (2)' }
    }
    connect(managingPort((m) => answers[m.op]).port)
    shows(scheduleOf('IfcDoor'), doors.length)
    const brief = { title: 'Door Schedule', rowCount: doors.length }

    const undo = await run('manage_schedules', { op: 'undo' })
    expect(undo).toMatchObject({ done: true, undoSteps: 2, redoSteps: 1, schedule: brief })
    expect(undo.message).toBe('Undid one step in the Schedules window — 2 to undo and 1 to redo are left there.')
    expect(await run('manage_schedules', { op: 'redo' })).toEqual({
      message: 'There is nothing to redo in the Schedules window.',
      done: false,
      undoSteps: 3,
      redoSteps: 0
    })
    const tpl = await run('manage_schedules', { op: 'apply_template', name: 'door schedule' })
    expect(tpl).toMatchObject({ done: true, name: 'Door Schedule', schedule: brief })
    expect(tpl.message).toBe(
      'Started the schedule from the template "Door Schedule" in the Schedules window. It replaced the schedule that was open, which the user can undo there.'
    )
    const load = await run('manage_schedules', { op: 'load', name: 'fire doors' })
    expect(load).toMatchObject({ done: true, name: 'Fire doors', classesNotInModel: 2 })
    expect(load.message).toBe(
      'Loaded the saved setup "Fire doors" in the Schedules window. It replaced the schedule that was open, which the user can undo there. It was saved against another model: this one has none of 2 of the classes it names.'
    )
    const save = await run('manage_schedules', { op: 'save' })
    expect(save).toMatchObject({ done: true, name: 'Door Schedule (2)' })
    expect(save.message).toContain('Saved the open schedule to My templates as "Door Schedule (2)".')
    expect((await run('manage_schedules', { op: 'rename', name: 'Doors', to: 'Doors L2' })).message).toBe(
      'Renamed the saved setup "Doors" to "Doors L2".'
    )
    expect((await run('manage_schedules', { op: 'duplicate', name: 'Doors' })).message).toBe(
      'Copied the saved setup "Doors" to "Doors (2)".'
    )
    // None of it is the main window's state: no ↺ on the reply, and nothing was asked of the user.
    expect([turn.acted, turn.parts, turn.asked, turn.pending]).toEqual([false, [], null, null])
  })

  it('lists the templates and the saved setups as the window sent them, and counts what could not be named', async () => {
    const saved = [
      { name: 'Doors', classes: ['IfcDoor'], columns: 3, saved: '2026-10-02', inUse: true, lacks: false },
      { name: 'Slabs', classes: ['IfcSlab'], columns: 2, saved: '', inUse: false, lacks: true }
    ]
    const templates = [{ id: 'door-schedule', name: 'Door Schedule', classes: ['IfcDoor'], columns: 7, fit: 5, elements: 17, inUse: false }]
    connect(managingPort((m) => (m.op === 'saved_list' ? { result: 'done', saved, unlisted: 1 } : { result: 'done', templates })).port)
    expect(await run('manage_schedules', { op: 'saved_list' })).toEqual({
      message:
        '2 saved setups in My templates, newest first. 1 more cannot be listed here: their names are too long, or hold characters that cannot be shown — the user reaches them in the Schedules window.',
      done: true,
      saved,
      total: 3,
      truncated: true
    })
    expect(await run('manage_schedules', { op: 'templates' })).toEqual({
      message:
        '1 template fit the loaded models. fit is how many of a template’s columns this model has data for, and elements how many it would list.',
      done: true,
      templates
    })
    connect(managingPort(() => ({ result: 'done', saved: [], unlisted: 0 })).port)
    expect(await run('manage_schedules', { op: 'saved_list' })).toMatchObject({
      message: 'There are no saved setups in My templates.',
      saved: [],
      total: 0,
      truncated: false
    })
  })

  it('passes on what the window refuses: a name it does not have, one that is taken, a full storage, a dialog of its own, no schedule', async () => {
    let result = 'missing'
    connect(managingPort(() => ({ result })).port)
    expect((await run('manage_schedules', { op: 'load', name: 'Nope' })).message).toBe(
      'No saved setup is called "Nope". Nothing was done — op:"saved_list" lists them.'
    )
    expect((await run('manage_schedules', { op: 'apply_template', name: 'Nope' })).message).toBe(
      'No template for the loaded models is called "Nope". Nothing was done — op:"templates" lists them.'
    )
    result = 'taken'
    // A rename onto a name another setup has is refused there, and must never read as done.
    expect(await run('manage_schedules', { op: 'rename', name: 'Doors', to: 'Walls' })).toEqual({
      message: 'A saved setup is already called "Walls", so "Doors" was not renamed.',
      done: false
    })
    result = 'failed'
    expect((await run('manage_schedules', { op: 'save' })).message).toBe(
      'This computer’s storage for saved setups is unavailable or full, so nothing was saved.'
    )
    result = 'busy'
    expect((await run('manage_schedules', { op: 'undo' })).message).toBe(
      'The Schedules window has a dialog of its own up, or is still answering another request. Nothing was done — the user finishes that first.'
    )
    result = 'no_schedule'
    expect((await run('manage_schedules', { op: 'undo' })).message).toBe('The Schedules window shows no schedule yet. Nothing was done.')
    result = 'nothing'
    expect((await run('manage_schedules', { op: 'save' })).message).toBe('The open schedule has no columns, so there was nothing to save.')
    expect((await run('manage_schedules', { op: 'rename', name: 'Doors', to: 'Doors' })).done).toBe(false)
  })

  it('delete, print and open_file only ask: the window is raised, the turn’s one request is taken, and nothing is claimed', async () => {
    const { port, asked } = managingPort((m) => ({ result: 'asked', ...(m.op === 'delete' ? { name: 'Doors' } : {}) }))
    connect(port)
    const del = await run('manage_schedules', { op: 'delete', name: 'doors' })
    expect(del).toEqual({
      message:
        'Asked, not done: the Schedules window, brought to the front, is asking whether to delete the saved setup "Doors", which cannot be undone. Nothing is deleted unless the user clicks Delete there, and this turn is not told what they choose — so say what is being asked, never that it was done.',
      done: false,
      asked: true,
      name: 'Doors'
    })
    expect(turn.asked).toBe('the Schedules window — it is asking whether to delete the saved setup "Doors", which cannot be undone')
    expect(openSchedules).toHaveBeenCalledTimes(1)
    expect(asked).toHaveLength(1)
    expect(asked[0].ask).toBe(true)

    // One request a turn: a second gated call is refused before it reaches the window.
    for (const op of ['print', 'open_file', 'delete'] as const) {
      const more = await run('manage_schedules', { op, name: 'Doors' })
      expect([op, more.alreadyWaiting]).toEqual([op, turn.asked])
    }
    expect(asked).toHaveLength(1)
    expect(openSchedules).toHaveBeenCalledTimes(1)

    fresh()
    // Printing is asked in that window's own confirm, as a deletion is — not in the print
    // dialog, whose default button prints: so no `dialog`, and the words say what opens when.
    const print = await run('manage_schedules', { op: 'print' })
    expect(print).toEqual({
      message:
        'Asked, not done: the Schedules window, brought to the front, is asking whether to open the print dialog for the schedule it shows. The print dialog does not open, and nothing is printed, unless the user clicks Print… there, and this turn is not told what they choose — so say what is being asked, never that it was done.',
      done: false,
      asked: true
    })
    expect(turn.asked).toBe('the Schedules window — it is asking whether to open the print dialog for the schedule it shows')
    fresh()
    const open = await run('manage_schedules', { op: 'open_file' })
    expect(open).toMatchObject({ done: false, asked: true, dialog: true })
    expect(open.message).toContain(
      'is opening its Open dialog for a schedule file (.schedule.json). The file the user picks there becomes the open schedule, and nothing changes if they cancel'
    )
    // No file name, no path and no definition is in any of it — there is none to carry.
    expect(JSON.stringify([del, print, open])).not.toMatch(/[A-Za-z]:[\\/]|\.json"|"def"/)
  })

  it('a save or a duplicate that would forget a saved setup is asked there too — or held, when the turn has already asked', async () => {
    const forgets: Record<string, Answer> = {
      save: { result: 'asked', forgets: 'replace', name: 'Doors', gone: 'Doors' },
      duplicate: { result: 'asked', forgets: 'evict', name: 'S100', gone: 'S1' }
    }
    const { port, asked } = managingPort((m) => (m.ask ? forgets[m.op] : { ...forgets[m.op], result: 'held' }))
    connect(port)
    const save = await run('manage_schedules', { op: 'save' })
    expect(save).toMatchObject({ done: false, asked: true, name: 'Doors', wouldForget: 'Doors' })
    expect(save.message).toContain(
      'is asking whether to save over the saved setup "Doors", whose present contents cannot be brought back. Nothing is saved unless the user clicks Save there'
    )
    expect(turn.asked).toContain('save over the saved setup "Doors"')

    // The turn has asked: the next is sent with ask:false, the window holds it, and it is refused in words.
    const dup = await run('manage_schedules', { op: 'duplicate', name: 'S100' })
    expect(asked.map((m) => [m.op, m.ask])).toEqual([
      ['save', true],
      ['duplicate', false]
    ])
    expect(dup).toMatchObject({ applied: false, pending: false, alreadyWaiting: turn.asked })
    expect(openSchedules).toHaveBeenCalledTimes(1)

    fresh()
    const copy = await run('manage_schedules', { op: 'duplicate', name: 'S100' })
    expect(copy.message).toContain(
      'is asking whether to duplicate "S100", because only a hundred are kept and the oldest, "S1", would be forgotten. Nothing is saved unless the user clicks Duplicate there'
    )
    // A held change behind the chat's own Apply counts as the turn's request as well.
    fresh()
    turn.pending = { label: 'isolate 3 elements', patch: {} }
    await run('manage_schedules', { op: 'save' })
    expect(asked.at(-1)).toMatchObject({ op: 'save', ask: false })
  })

  it('waits three seconds for an answer and no longer, never stacks a second request, and drops a late or a foreign answer', async () => {
    vi.useFakeTimers()
    const { port, sent } = fakePort()
    connect(port)
    const manages = (): Sent[] => sent.filter((m) => m.type === 'manage')
    const first = run('manage_schedules', { op: 'undo' })
    await vi.advanceTimersByTimeAsync(0)
    expect(manages()).toHaveLength(1)
    // A second while the first waits is not sent.
    expect((await run('manage_schedules', { op: 'redo' })).message).toMatch(/^The Schedules window has a dialog of its own up, or is still answering another request/)
    expect(manages()).toHaveLength(1)
    // An answer to another request, or one that is not an answer at all, is not this one's.
    const n = manages()[0].n as number
    receive({ type: 'manageAck', n: n + 7, result: 'done' })
    receive({ type: 'manageAck', n, result: 'done', name: 'two\nlines' })
    receive({ type: 'manageAck', n, result: 'done', def: {} })
    receive({ type: 'manageAck', n, result: 'saved' })
    await vi.advanceTimersByTimeAsync(MANAGE_ACK_MS - 1)
    let settled = false
    void first.then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect((await first).message).toBe(
      'The Schedules window did not answer within 3 s. It drops a request it gets to that late, so most likely nothing was done — read get_schedule, or saved_list, before saying either way.'
    )
    // Its answer arriving now is nobody's; the next request is answered by its own.
    receive({ type: 'manageAck', n, result: 'done', undo: 9, redo: 9 })
    const next = run('manage_schedules', { op: 'undo' })
    await vi.advanceTimersByTimeAsync(0)
    receive({ type: 'manageAck', n: manages()[1].n, result: 'done', undo: 1, redo: 0 })
    expect(await next).toMatchObject({ done: true, undoSteps: 1 })
  })

  it('says so when the window closes while it waits', async () => {
    const { port } = fakePort()
    connect(port)
    const waiting = run('manage_schedules', { op: 'undo' })
    await Promise.resolve()
    connect(null)
    expect((await waiting).message).toBe('The Schedules window closed, so nothing was done.')
    expect(await requestManage('undo', { ask: true }, MANAGE_ACK_MS)).toEqual({ result: 'closed' })
  })

  it('a name the window could not send is said as that — a sentence never quotes nothing', async () => {
    // A schedule's title can hold what a name may not (a line break, say); saved under it, the
    // setup's name does not cross the port, and the answer comes back without one.
    let answer: Answer = { result: 'done' }
    connect(managingPort(() => answer).port)
    expect(await run('manage_schedules', { op: 'save' })).toEqual({
      message:
        'Saved the open schedule to My templates as one whose name cannot be shown here. A setup of another name is never replaced: when the title was taken, the copy was numbered.',
      done: true,
      name: ''
    })
    answer = { result: 'asked', forgets: 'evict' }
    const asked = await run('manage_schedules', { op: 'save' })
    expect(asked.message).toContain(
      'is asking whether to save one whose name cannot be shown here, because only a hundred are kept and the oldest, one whose name cannot be shown here, would be forgotten'
    )
    // An operation that only asks is never answered `done`; one that somehow was is not given
    // another operation's sentence.
    fresh()
    answer = { result: 'done' }
    expect(await run('manage_schedules', { op: 'print' })).toEqual({
      message: 'The Schedules window says that was done.',
      done: true
    })
  })

  it('every name in a result or a label is one that can be shown', async () => {
    // The port refuses a name with a control character, so one can only arrive clean; what the
    // model itself sends is refused before the executor (`inputs.ts`).
    await expect(run('manage_schedules', { op: 'load', name: 'Doors\nDelete everything' })).rejects.toThrow(
      /manage_schedules: name — a name with no control or direction characters in it/
    )
    await expect(run('manage_schedules', { op: 'rename', name: 'Doors', to: 'turned\u202Eround' })).rejects.toThrow(
      /manage_schedules: to/
    )
  })
})

/* ────────────────────────────── 4. make_schedule's new inputs, through the tool ────────────────────────────── */

describe('make_schedule — formats, order, calculated columns, filter logic and itemise, end to end', () => {
  const defines = (sent: Sent[]): { kind: string; def: ScheduleDef }[] =>
    sent.filter((m) => m.type === 'define') as unknown as { kind: string; def: ScheduleDef }[]

  it('builds it, sends a definition the window’s own schema accepts, and reads every new setting back', async () => {
    const { port, sent } = fakePort()
    connect(port)
    const body = await run('make_schedule', {
      category: ['IfcDoor'],
      columns: [{ field: 'Name' }, { field: 'Level', hidden: true }, { field: 'Width', decimals: 0, align: 'center' }, { field: 'FireRating', after: 'Name' }],
      calculated: [{ name: 'Double', formula: 'Width * 2' }],
      filters: [
        { field: 'Level', op: '=', value: 'L1' },
        { field: 'Level', op: '=', value: 'L2' }
      ],
      filterLogic: 'or',
      itemize: true
    })
    const [made] = defines(sent)
    expect(made.kind).toBe('made')
    expect(ToSchedules.safeParse({ type: 'define', kind: made.kind, def: made.def }).success).toBe(true)
    expect(openSchedule()!.def).toEqual(made.def)
    const onTwo = doors.filter((d) => d.storey === 'L1' || d.storey === 'L2').length
    expect(body).toMatchObject({ headings: ['Name', 'FireRating', 'Width', 'Double'], elementCount: onTwo })
    expect(body.schedule).toMatchObject({
      columns: [
        { field: 'Name', heading: 'Name' },
        { field: 'FireRating', heading: 'FireRating' },
        { field: 'Level', heading: 'Level', hidden: true },
        { field: 'Width', heading: 'Width', decimals: 0, align: 'center' },
        { field: 'Double', heading: 'Double', calculated: true }
      ],
      filterLogic: 'or',
      calculated: [{ name: 'Double', formula: 'Width * 2', result: 'number' }]
    })
    // The same shape again, on the open schedule: collapsed, and the logic back to every rule.
    const edit = await run('make_schedule', { base: 'open', itemize: false, filterLogic: 'and', filters: [] })
    expect(defines(sent)[1].kind).toBe('edited')
    expect(edit.schedule).toMatchObject({ itemize: false })
    expect((edit.schedule as Record<string, unknown>).filterLogic).toBeUndefined()
    expect(edit.elementCount).toBe(doors.length)
  })

  it('refuses a formula that does not parse with the engine’s reason — and sends nothing', async () => {
    const { port, sent } = fakePort()
    connect(port)
    const body = await run('make_schedule', {
      category: ['IfcDoor'],
      columns: [{ field: 'Name' }, { field: 'Width' }],
      calculated: [{ name: 'Bad', formula: 'Width *' }]
    })
    expect(body.message).toBe(
      'Nothing was changed. Calculated column "Bad": "*" is missing a value. A formula names other columns by their headings — [Clear Width] for one with a space — and this schedule\'s are Name, Width.'
    )
    expect(body.valid_values).toEqual({ columns: ['Name', 'Width'] })
    expect(defines(sent)).toEqual([])
    expect(openSchedule()).toBeNull()
  })
})

/* ────────────────────────────── 5. placing markups ────────────────────────────── */

describe('manage_markups — placing a spot coordinate and a laser measurement', () => {
  const slab = full.elements.find((e) => e.type === 'IfcSlab' && e.bbox)!
  const box = slab.bbox!
  const mid = { x: (box[0] + box[3]) / 2, y: (box[1] + box[4]) / 2 }

  it('places a spot at the middle of an element’s box top — through the store’s own action, as a click’s record', async () => {
    const body = await run('manage_markups', { op: 'place_spot', id: slab.id })
    expect(placedSpots).toEqual([[mid.x, mid.y, box[5]]])
    expect(st().spots).toHaveLength(1)
    // With no base point the spot's tag, and the result, read the file's own level.
    expect(body).toMatchObject({
      placed: true,
      name: 'C1',
      spot: { name: 'C1', level: +box[5].toFixed(3) },
      pointMetres: { x: +mid.x.toFixed(3), y: +mid.y.toFixed(3), z: +box[5].toFixed(3) },
      pointFrame: 'project',
      element: slab.id,
      at: 'top',
      on: 'bounding box'
    })
    expect(body.message).toContain(`Placed spot coordinate C1 at the middle of the top face of the bounding box of "${slab.name}"`)
    expect(body.message).toContain('the model has no base point')
    expect(body.message).toContain('It is in the Markups card, where the user can delete it, and this reply’s revert takes it away again.')
    // What it placed is reported to the turn by the record's own id — the one the viewer gave
    // it — and that is all: no part of the review state changed, nothing is on the visibility
    // undo stack, nothing was asked.
    expect(turn.placed).toEqual([{ kind: 'spot', id: st().spots[0].id }])
    expect([turn.acted, turn.parts, turn.pending, turn.asked]).toEqual([false, [], null, null])
    expect(historyDepth().undo).toBe(0)
  })

  it('takes the place asked for — top, centre or base — and the point is the arithmetic’s own', async () => {
    for (const at of ['top', 'centre', 'base'] as const) {
      await run('manage_markups', { op: 'place_spot', id: slab.id, at })
      expect([at, placedSpots.at(-1)]).toEqual([at, boxPlace(box, at).p])
    }
    expect(placedSpots.map((p) => p[2])).toEqual([box[5], (box[2] + box[5]) / 2, box[2]])
    expect(st().spots.map((s) => s.z)).toEqual([box[5], (box[2] + box[5]) / 2, box[2]])
    // The card numbers them by position, and the result names each as the card does.
    const last = await run('manage_markups', { op: 'place_spot', id: slab.id, at: 'base' })
    expect(last.name).toBe('C4')
  })

  it('the scene stands whole metres off the project frame: the point handed to the viewer is project − offset', async () => {
    st().setOffset([28000, 30000, 100], null, null)
    const body = await run('manage_markups', { op: 'place_spot', point: { x: 28010.5, y: 30020.25, z: 103.2 } })
    expect(placedSpots).toEqual([[10.5, 20.25, 3.2000000000000028]])
    // What comes back is the point that was asked for, in the frame it was asked in.
    expect(body).toMatchObject({ placed: true, pointMetres: { x: 28010.5, y: 30020.25, z: 103.2 }, pointFrame: 'project' })
    expect(body.message).toContain('at the point given')
    expect(body.element).toBeUndefined()
    expect(st().spots[0]).toMatchObject({ x: 28010.5, y: 30020.25 })
  })

  it('with a base point the spot reads E, N and Z — the map coordinates the card’s row shows', async () => {
    // The repository's synthetic set, never a real site's — stated by the file, which is the only
    // place a base point comes from since the card became read-only (2026-10-08).
    st().setOffset([0, 0, 0], null, {
      source: 'IfcMapConversion',
      sources: ['IfcMapConversion'],
      method: 'IfcMapConversion',
      eastings: 12345.457,
      northings: 23456.766,
      orthogonalHeight: 5.05,
      xAxisAbscissa: 1,
      xAxisOrdinate: 0
    })
    expect(st().coords).toEqual({ E: 12345.457, N: 23456.766, Z: 5.05, angle: 0 })
    const body = await run('manage_markups', { op: 'place_spot', point: { x: 1, y: 2, z: 3 }, show: 'full' })
    const m = toMap(st().coords, 1, 2, 3)!
    expect(body.spot).toEqual({ name: 'C1', E: +m.E.toFixed(3), N: +m.N.toFixed(3), Z: +m.Z.toFixed(3) })
    expect(body.message).toContain('Its tag shows the full E, N and Z.')
    // `show:"full"` on the new tag is the tag's own click, by the record's id.
    expect(shown).toEqual([[st().spots[0].id, true]])
  })

  it('places a laser measurement: the face the point sits on is not fired into, and the element is its own surface', async () => {
    const top = await run('manage_markups', { op: 'place_measure', id: slab.id, at: 'top' })
    expect(placedLasers.at(-1)).toEqual({ p: [mid.x, mid.y, box[5]], normal: [0, 0, 1], selfId: slab.id })
    // The laser's own rule (`laserDirections`): from a top face no ray goes down, so Z reads one
    // way and X and Y both — with every ray reading 2 m, that is 4 000 · 4 000 · 2 000 mm.
    expect(top).toMatchObject({ placed: true, name: 'M1', measure: { name: 'M1', x: 4000, y: 4000, z: 2000 }, at: 'top' })
    // The card's own row text, in the card's unit.
    expect(top.message).toMatch(
      new RegExp(`^Placed laser measurement M1 at the middle of the top face of the bounding box of "${slab.name}": X 4.?000 mm Y 4.?000 mm Z 2.?000 mm\\. `)
    )
    expect(top.message).toContain('Each length is the distance between the nearest visible faces either side of that point along the axis.')
    expect(turn.placed).toEqual([{ kind: 'measure', id: st().measures[0].id }])

    await run('manage_markups', { op: 'place_measure', id: slab.id, at: 'base' })
    expect(placedLasers.at(-1)).toEqual({ p: [mid.x, mid.y, box[2]], normal: [0, 0, -1], selfId: slab.id })
    // The middle of the box is on no surface: every ray is fired, and nothing is stepped past.
    const centre = await run('manage_markups', { op: 'place_measure', id: slab.id, at: 'centre' })
    expect(placedLasers.at(-1)).toEqual({ p: [mid.x, mid.y, (box[2] + box[5]) / 2], normal: null, selfId: -1 })
    expect(centre.measure).toEqual({ name: 'M3', x: 4000, y: 4000, z: 4000 })
    const point = await run('manage_markups', { op: 'place_measure', point: { x: 1, y: 2, z: 3 } })
    expect(placedLasers.at(-1)).toEqual({ p: [1, 2, 3], normal: null, selfId: -1 })
    expect(point.name).toBe('M4')
    expect(st().measures).toHaveLength(4)
  })

  it('places nothing when no ray reads anything — as such a click places nothing', async () => {
    reach = null
    expect(await run('manage_markups', { op: 'place_measure', id: slab.id })).toEqual({
      message:
        'No ray from that point reached a visible face — the laser reads the distance to the nearest faces along X, Y and Z, and found none. Nothing was placed.',
      placed: false
    })
    expect(st().measures).toEqual([])
    // Nothing was placed, so the turn has nothing to take away.
    expect(turn.placed).toEqual([])
  })

  it('refuses in words: no element, no geometry, both an element and a point, neither, no 3D view', async () => {
    const no = async (input: Record<string, unknown>): Promise<string> => {
      const body = await run('manage_markups', { op: 'place_spot', ...input })
      expect(body.placed).toBe(false)
      return body.message!
    }
    expect(await no({ id: 987654321 })).toBe('No element has id 987654321 — ids are per session, so query again. Nothing was placed.')
    expect(await no({})).toBe(
      'Say where: pass the element’s id (and at: top, centre or base), or a point in project-frame metres. Nothing was placed.'
    )
    expect(await no({ id: slab.id, point: { x: 1, y: 2, z: 3 } })).toBe('Pass either id (with at) or point — not both. Nothing was placed.')
    const bare = full.elements.find((e) => !e.bbox)
    if (bare) expect(await no({ id: bare.id })).toMatch(/has no geometry, so there is nowhere on it to place a markup\. Nothing was placed\.$/)
    setViewer(null)
    expect(await no({ id: slab.id })).toBe('There is no 3D view to place a markup in. Nothing was placed.')
    expect([placedSpots, st().spots]).toEqual([[], []])
  })

  it('says when the element is hidden, and stops adding at the cap — which is what one result can list', async () => {
    st().hide([slab.id])
    const hidden = await run('manage_markups', { op: 'place_spot', id: slab.id })
    expect(hidden).toMatchObject({ placed: true, elementHidden: true })
    expect(hidden.message).toContain('The element is hidden in the current view, so the markup stands where nothing is drawn.')

    const many: SpotRecord[] = Array.from({ length: MARKUPS_PLACE_CAP }, (_, i) => ({ id: 1000 + i, p: [0, 0, 0], E: null, N: null, Z: null, x: 0, y: 0, z: i }))
    st().setSpots(many)
    placedSpots = []
    expect(await run('manage_markups', { op: 'place_spot', id: slab.id })).toEqual({
      message: `There are already ${MARKUPS_PLACE_CAP} spot coordinates — the user can delete some from the Markups card first. Nothing was placed.`,
      placed: false
    })
    expect(placedSpots).toEqual([])
    // The cap is per list: a laser measurement can still be placed.
    expect((await run('manage_markups', { op: 'place_measure', id: slab.id })).placed).toBe(true)
  })

  it('show sets one spot tag, or every one — a click on the tag, and idempotent', async () => {
    await run('manage_markups', { op: 'place_spot', id: slab.id, at: 'top' })
    await run('manage_markups', { op: 'place_spot', id: slab.id, at: 'base' })
    const [a, b] = st().spots.map((s) => s.id)
    shown = []
    expect(await run('manage_markups', { op: 'show', name: 'c2', show: 'full' })).toEqual({
      message: 'C2 now shows the full E, N and Z.',
      show: 'full',
      changed: 1
    })
    expect(shown).toEqual([[b, true]])
    expect((await run('manage_markups', { op: 'show', name: 'C2', show: 'full' })).message).toBe(
      'C2 already shows the full E, N and Z — nothing changed.'
    )
    expect((await run('manage_markups', { op: 'show', show: 'full' })).message).toBe(
      '1 of 2 spot tags now shows the full E, N and Z; the rest already did.'
    )
    expect(expanded).toEqual(new Set([a, b]))
    expect((await run('manage_markups', { op: 'show', show: 'level' })).message).toBe('2 of 2 spot tags now show the level alone.')
    expect((await run('manage_markups', { op: 'show', show: 'level' })).message).toBe(
      'Every spot tag already shows the level alone — nothing changed.'
    )
    expect(expanded.size).toBe(0)
    // What it cannot mean is said, and changes nothing.
    expect((await run('manage_markups', { op: 'show', name: 'C9', show: 'full' })).message).toMatch(/^There is no C9\. Nothing changed\./)
    expect((await run('manage_markups', { op: 'show', name: 'M1', show: 'full' })).message).toMatch(
      /^"M1" is not a spot coordinate — they are C1, C2 …; a laser measurement has no tag to change\./
    )
    expect((await run('manage_markups', { op: 'show', name: 'C1' })).message).toMatch(/^Say which: show:"full"/)
    // A tag's state is not something a reply's revert puts back.
    expect([turn.acted, turn.parts]).toEqual([false, []])
  })

  it('a markup it placed is deleted the way any markup is: asked for, behind Apply', async () => {
    await run('manage_markups', { op: 'place_spot', id: slab.id })
    const id = st().spots[0].id
    const body = await run('manage_markups', { op: 'delete', name: 'C1' })
    expect(body).toMatchObject({ applied: false, pending: true })
    expect(turn.pending?.action).toEqual({ kind: 'delete_spot', id })
    expect(st().spots).toHaveLength(1)
  })
})

/* ────────────────────────────── 5b. …and the reply's revert takes it away ────────────────────────────── */

/**
 * The follow-up of the same day. Phase 4 left a placed markup standing — "an addition to the
 * user's list, like a saved viewpoint". The line is the other way: a spot or a measurement drawn
 * in the 3D view is **session view state**, the most visible thing a reply can add, and a
 * reply's `revert` puts back everything that reply changed. Saved lists are what a revert does
 * not touch — viewpoints, filter sets, saved schedule setups.
 *
 * A turn here runs as `ai/bridge.ts` runs one (`chatBegin`, each call through `executeTool` into
 * the turn's accumulators, `chatFinish`), and the removal is the Markups card's own ×: the
 * store's `dropSpot` / `dropMeasure`, which the stub viewer answers as the real one does.
 */
describe('a markup a reply placed is taken away by that reply’s revert', () => {
  const slab = full.elements.find((e) => e.type === 'IfcSlab' && e.bbox)!
  type Call = [name: string, input: unknown]
  const SPOT: Call = ['manage_markups', { op: 'place_spot', id: slab.id }]
  const MEASURE: Call = ['manage_markups', { op: 'place_measure', id: slab.id }]

  /** One turn: the calls, what the user does meanwhile, the reply committed. Its index. */
  async function reply(calls: readonly Call[], meanwhile?: () => void): Promise<number> {
    fresh()
    const before = st().chatBegin('q', null)
    for (const [name, input] of calls) await run(name, input)
    meanwhile?.()
    st().chatFinish('done', { ...turn }, before)
    return st().chatMsgs.length - 1
  }
  /** Does the panel draw `revert` on that reply? The row's own rule (`selectors/chat.ts`). */
  const offersRevert = (at: number): boolean => chatRow(st().chatMsgs[at], at).canRevert
  const ids = (): { spots: number[]; measures: number[] } => ({
    spots: st().spots.map((s) => s.id),
    measures: st().measures.map((m) => m.id)
  })

  it('place, then revert: the spot and the measurement that reply placed are gone — by id, through the card’s own ×', async () => {
    const at = await reply([SPOT, MEASURE])
    const placed = ids()
    expect([placed.spots.length, placed.measures.length]).toEqual([1, 1])
    // The reply keeps the real records' ids — the ones the viewer gave them.
    expect(st().chatMsgs[at].placed).toEqual([
      { kind: 'spot', id: placed.spots[0] },
      { kind: 'measure', id: placed.measures[0] }
    ])
    st().revertTurn(at)
    expect(ids()).toEqual({ spots: [], measures: [] })
    expect(dropped).toEqual([
      ['spot', placed.spots[0]],
      ['measure', placed.measures[0]]
    ])
    // Reverted like any reply: dimmed, the record given up with the control, nothing said, and
    // nothing on the visibility undo stack — a markup was never on it.
    expect(st().chatMsgs[at]).toMatchObject({ reverted: true, placed: null, undoSnap: null })
    expect(chatRow(st().chatMsgs[at], at).opacity).toBe('0.5')
    expect([st().chatErr, historyDepth().undo]).toEqual(['', 0])
  })

  it('a reply that only placed a markup is offered revert — it changed something that can be put back', async () => {
    const read = await reply([['manage_markups', { op: 'list' }]])
    const placed = await reply([SPOT])
    // No part of the review state changed, so it has no snapshot to restore — and a revert all the same.
    expect(st().chatMsgs[placed].undoSnap).toBeNull()
    expect([offersRevert(read), offersRevert(placed)]).toEqual([false, true])
    st().revertTurn(placed)
    expect(offersRevert(placed)).toBe(false)
    expect(st().spots).toEqual([])
  })

  it('not offered where nothing was placed: a measurement no ray read, or a spot tag’s state — which no revert puts back', async () => {
    reach = null
    const none = await reply([MEASURE])
    expect(st().chatMsgs[none].placed).toBeUndefined()
    expect(offersRevert(none)).toBe(false)
    // The user's own spot, and a reply that only opened its tag.
    st().placeSpot([1, 2, 3])
    const shownAt = await reply([['manage_markups', { op: 'show', name: 'C1', show: 'full' }]])
    expect(expanded.size).toBe(1)
    expect(offersRevert(shownAt)).toBe(false)
    st().revertTurn(shownAt)
    // Nothing to revert: the tag stays as that reply left it, and the spot is the user's.
    expect([expanded.size, st().spots.length, dropped]).toEqual([1, 1, []])
  })

  it('takes away exactly that reply’s: the user’s own markups, and an earlier reply’s, stay', async () => {
    // The user's own clicks first — the same commit, by hand.
    st().placeSpot([1, 2, 3])
    st().placeMeasure([1, 2, 3], null, -1)
    const mine = ids()
    const first = await reply([['manage_markups', { op: 'place_spot', id: slab.id, at: 'base' }]])
    const firstSpot = ids().spots[1]
    const second = await reply([SPOT, MEASURE])
    const [, , secondSpot] = ids().spots
    const [, secondMeasure] = ids().measures
    // …and one more by hand, after both replies.
    st().placeSpot([4, 5, 6])
    const later = ids().spots[3]
    expect([ids().spots.length, ids().measures.length]).toEqual([4, 2])

    st().revertTurn(second)
    expect(ids()).toEqual({ spots: [mine.spots[0], firstSpot, later], measures: mine.measures })
    expect(dropped).toEqual([
      ['spot', secondSpot],
      ['measure', secondMeasure]
    ])
    // The earlier reply's is still its own to take away — and only that.
    expect(offersRevert(first)).toBe(true)
    st().revertTurn(first)
    expect(ids()).toEqual({ spots: [mine.spots[0], later], measures: mine.measures })
  })

  it('one the user already removed is nothing to do, and nothing is said', async () => {
    const at = await reply([SPOT, MEASURE])
    const placed = ids()
    // The user's own × on the spot's row in the Markups card, before the revert.
    st().dropSpot(placed.spots[0])
    dropped = []
    st().revertTurn(at)
    // The measurement goes; the spot is not asked for again.
    expect(dropped).toEqual([['measure', placed.measures[0]]])
    expect(ids()).toEqual({ spots: [], measures: [] })
    expect([st().chatErr, st().chatMsgs[at].reverted]).toEqual(['', true])

    // Both gone by the user's own hand: the revert still closes the reply, and removes nothing.
    const again = await reply([SPOT])
    st().dropSpot(ids().spots[0])
    dropped = []
    st().revertTurn(again)
    expect([dropped, st().chatErr, st().chatMsgs[again].reverted, offersRevert(again)]).toEqual([[], '', true, false])
  })

  it('a second revert does nothing: the record went with the first', async () => {
    const at = await reply([SPOT])
    st().revertTurn(at)
    // Another spot, by hand. A second press — which the panel no longer offers — must not touch it.
    st().placeSpot([1, 2, 3])
    dropped = []
    const state = st()
    st().revertTurn(at)
    expect(st()).toBe(state)
    expect([dropped, st().spots.length]).toEqual([[], 1])
  })

  it('happens in the same click as the rest of the revert: the view is put back and the markup goes', async () => {
    const hide = doors.map((d) => d.id)
    const at = await reply([['apply_visibility', { action: 'hide', ids: hide }], SPOT])
    expect(visible()).toBe(full.elements.length - doors.length)
    expect(st().chatMsgs[at].undoSnap?.changed).toEqual(['vis'])
    expect(st().chatMsgs[at].placed).toHaveLength(1)
    st().revertTurn(at)
    expect([visible(), st().spots]).toEqual([full.elements.length, []])
    expect(st().chatMsgs[at]).toMatchObject({ reverted: true, placed: null, undoSnap: null })
  })

  it('a saved viewpoint is not session view state: a reply that saved one is offered no revert, and keeps it', async () => {
    const at = await reply([['manage_views', { op: 'save', name: 'Here' }]])
    expect(offersRevert(at)).toBe(false)
    st().revertTurn(at)
    expect(st().views.map((v) => v.name)).toEqual(['Here'])
  })
})

/* ────────────────────────────── 6. the ticker's words ────────────────────────────── */

describe('the phrases the thinking trace says for the new calls', () => {
  it('says what a manage_schedules call is working — and that the three which only ask are asking', () => {
    expect(TOOL_STAGE.manage_schedules).toBe('working in the Schedules window')
    expect(toolPhrase('manage_schedules', { op: 'undo' })).toBe('undoing in the Schedules window')
    expect(toolPhrase('manage_schedules', { op: 'saved_list' })).toBe('reading the saved schedules')
    expect(toolPhrase('manage_schedules', { op: 'apply_template' })).toBe('applying a schedule template')
    expect(toolPhrase('manage_schedules', { op: 'delete' })).toBe('asking to delete a saved schedule')
    expect(toolPhrase('manage_schedules', { op: 'print' })).toBe('asking to open the print dialog')
    expect(toolPhrase('manage_schedules', { op: 'open_file' })).toBe('opening the Open dialog')
    // Never "deleting" or "printing": nothing is, until the user says so.
    for (const op of ['delete', 'print', 'open_file']) {
      expect(toolPhrase('manage_schedules', { op })).not.toMatch(/^(deleting|printing|opening a file)/)
    }
    expect(toolPhrase('manage_schedules', { op: 'constructor' })).toBe('working in the Schedules window')
    expect(toolPhrase('manage_schedules', null)).toBe('working in the Schedules window')
  })

  it('says a markup is being placed, not read', () => {
    expect(toolPhrase('manage_markups', { op: 'place_spot' })).toBe('placing a spot coordinate')
    expect(toolPhrase('manage_markups', { op: 'place_measure' })).toBe('placing a measurement')
    expect(toolPhrase('manage_markups', { op: 'show' })).toBe('changing a spot tag')
    expect(toolPhrase('manage_markups', { op: 'list' })).toBe('reading the markups')
  })
})
