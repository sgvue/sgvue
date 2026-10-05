/**
 * `schedule: true`, however long the schedule — 2026-10-02, the follow-up to phase 4 of the
 * assistant's parity work.
 *
 * `MAX_TOOL_IDS` (2 000) bounds the ids **the model sends**: an id list costs tokens on the
 * wire, and a longer one is refused whole. Phase 4 held the open schedule's rows to the same
 * bound, and that was a mistake of its brief: this set never travels through the model. The
 * app holds it — exactly as it holds the selection, which has no cap — and the model only
 * points at it. With the cap, "isolate what this schedule lists" failed for any schedule of
 * more than 2 000 rows: every wall of a real model, which the user does from the row menu.
 *
 * So a schedule that lists more than 2 000 elements is acted on **whole**, and the scope guard
 * holds or refuses exactly as it does for any other set. The design's mock federation has 412
 * elements, so this file builds one of 45 000 on the mock's own element; everything else is
 * the real path a model's call takes (`executeTool` → `targets.ts` → the store's own actions).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { federate } from '../../src/shared/federate'
import type { ModelIndex } from '../../src/shared/model-index.types'
import { visFn } from '../../src/shared/rules'
import { MAX_TOOL_IDS } from '../../src/shared/tool-schemas'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { executeTool, newTurnState, type PendingAction, type ToolContext } from '../../src/renderer/ai/executors'
import { SCOPE_GUARD } from '../../src/renderer/ai/executors/view'
import { resolveTargets } from '../../src/renderer/ai/executors/targets'
import { connect, receive } from '../../src/renderer/model/schedule-link'
import { historyDepth, useShell } from '../../src/renderer/state/shell'
import { emptySchedule, type ScheduleDef } from '../../src/schedule/schedule/def'
import { memoryStorage, resetShell } from './stub-viewer'

/** A model of 45 000: 2 500 walls (5.6 % of it), 2 050 doors (4.6 %) and the rest slabs. */
const TOTAL = 45_000
const WALLS = 2_500
const DOORS = 2_050
const typeAt = (i: number): string => (i < WALLS ? 'IfcWall' : i < WALLS + DOORS ? 'IfcDoor' : 'IfcSlab')

const arc = mockModelIndex('ARC')
const like = arc.elements.find((e) => e.type === 'IfcWall')!
const big: ModelIndex = {
  ...arc,
  modelKey: 'BIG',
  fileName: 'BIG.ifc',
  elements: Array.from({ length: TOTAL }, (_, i) => ({
    ...like,
    id: i + 1,
    expressId: i + 1,
    // 22 characters of IFC's own alphabet: a valid GlobalId, and a different one each.
    guid: `G${String(i + 1).padStart(21, '0')}`,
    guidValid: true,
    model: 'BIG',
    name: `${typeAt(i).slice(3)} ${i + 1}`,
    type: typeAt(i)
  }))
}
const full = federate([big])
const idsOf = (type: string): number[] => full.elements.filter((e) => e.type === type).map((e) => e.id)
const walls = idsOf('IfcWall')
const doors = idsOf('IfcDoor')

const turn = newTurnState()
const ctx = (): ToolContext => ({
  state: () => useShell.getState(),
  sql: (async () => ({ columns: [], rows: [], truncated: false, ms: 0 })) as never,
  rawLine: async () => null,
  turn
})
type Body = { message: string; [k: string]: unknown }
const run = async (name: string, input: unknown): Promise<Body> => (await executeTool(name, input, ctx())) as Body
const fresh = (): void => void Object.assign(turn, newTurnState())
const st = () => useShell.getState()
const visible = (): number => st().federation.elements.filter(visFn(st())).length
const schedule = (...entity: string[]): ScheduleDef => ({
  ...emptySchedule('S', entity),
  columns: [{ field: { kind: 'core', key: 'name' } }]
})
/** The Schedules window says which schedule it shows. */
const shows = (def: ScheduleDef, rowCount: number): void => receive({ type: 'current', def, rowCount })
const port = { postMessage: () => undefined, close: () => undefined, onmessage: null } as unknown as MessagePort
const sorted = (ids: readonly number[]): number[] => [...ids].sort((a, b) => a - b)

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  resetShell()
  st().commitModels(full)
  fresh()
  connect(port)
})
afterEach(() => {
  connect(null)
  vi.unstubAllGlobals()
})

describe('schedule:true is not bounded by MAX_TOOL_IDS — the app holds the set, as it holds the selection', () => {
  it('the three sets are what they are meant to be: both over the bound, one each side of the guard', () => {
    expect(MAX_TOOL_IDS).toBe(2000)
    expect([full.elements.length, walls.length, doors.length]).toEqual([TOTAL, WALLS, DOORS])
    expect(Math.min(walls.length, doors.length)).toBeGreaterThan(MAX_TOOL_IDS)
    expect(walls.length / TOTAL).toBeGreaterThanOrEqual(SCOPE_GUARD)
    expect(doors.length / TOTAL).toBeLessThan(SCOPE_GUARD)
  })

  it('a schedule that lists more than 2 000 elements is the whole set — every one of them, and nothing refused', () => {
    shows(schedule('IfcWall'), walls.length)
    const t = resolveTargets({ schedule: true }, st())
    expect([t.source, t.asked, t.unknown, t.refused]).toEqual(['schedule', WALLS, [], undefined])
    // Not the first two thousand: all of them, each once.
    expect(sorted(t.hit.map((e) => e.id))).toEqual(walls)
  })

  it('…and is isolated, hidden, shown and selected whole — through the store, on the undo stack', async () => {
    shows(schedule('IfcWall'), walls.length)
    const depth = historyDepth().undo
    expect(await run('apply_visibility', { action: 'isolate', schedule: true })).toMatchObject({
      message: `Isolated the ${WALLS} elements the open schedule lists — ${WALLS} of ${TOTAL} visible.`,
      applied: true,
      target: 'schedule',
      matched: WALLS,
      visibleElements: WALLS,
      totalElements: TOTAL
    })
    expect(visible()).toBe(WALLS)
    expect(st().federation.elements.filter(visFn(st())).every((e) => e.type === 'IfcWall')).toBe(true)
    // One step on the main window's own undo stack, as a right-click Isolate is.
    expect(historyDepth().undo).toBe(depth + 1)
    st().step(true)
    expect(visible()).toBe(TOTAL)

    expect((await run('apply_visibility', { action: 'hide', schedule: true })).applied).toBe(true)
    expect(visible()).toBe(TOTAL - WALLS)
    expect((await run('apply_visibility', { action: 'show', schedule: true })).applied).toBe(true)
    expect(visible()).toBe(TOTAL)

    expect(await run('select_elements', { schedule: true, zoom: false })).toMatchObject({ target: 'schedule' })
    expect(sorted(st().selIds)).toEqual(walls)
    expect(turn.pending).toBeNull()
  })

  it('the 5 % guard still holds a set that would leave under 5 % visible: behind Apply, the whole set in its patch', async () => {
    shows(schedule('IfcDoor'), doors.length)
    const before = st().chatBegin('isolate what this schedule lists', null)
    expect(await run('apply_visibility', { action: 'isolate', schedule: true })).toMatchObject({
      message: `Needs confirmation: this would leave only ${DOORS} of ${TOTAL} elements visible. The user has been shown an Apply button — tell them briefly what is waiting.`,
      applied: false,
      pending: true,
      target: 'schedule',
      matched: DOORS,
      wouldLeaveVisible: DOORS,
      totalElements: TOTAL
    })
    // Nothing changed, and the row carries a visibility patch — never an action.
    expect([visible(), historyDepth().undo]).toEqual([TOTAL, 0])
    expect(turn.pending?.label).toBe(`isolate the ${DOORS} elements the open schedule lists — leaves ${DOORS} of ${TOTAL} visible`)
    expect(turn.pending?.action).toBeUndefined()
    st().chatFinish('…', { ...turn }, before)
    // The user's own click applies exactly that: all 2 050, and only them.
    st().applyPending(st().chatMsgs.length - 1)
    expect(visible()).toBe(DOORS)
    expect(st().federation.elements.filter(visFn(st())).every((e) => e.type === 'IfcDoor')).toBe(true)
  })

  it('…and still refuses a blank view outright, as for any set', async () => {
    shows(schedule('IfcWall', 'IfcDoor', 'IfcSlab'), TOTAL)
    // Worded for what named the set (the review's leftover): there are no ids to check here.
    expect(await run('apply_visibility', { action: 'hide', schedule: true })).toEqual({
      message:
        'That would leave nothing visible, so it was not applied. Check what the open schedule lists, or use action:"reset" to start from the whole model.',
      applied: false,
      target: 'schedule',
      matched: TOTAL,
      wouldLeaveVisible: 0,
      totalElements: TOTAL
    })
    expect([visible(), turn.pending, turn.acted, historyDepth().undo]).toEqual([TOTAL, null, false, 0])
  })

  it('copy_guids takes what the schedule lists exactly as it takes an equally large selection', async () => {
    shows(schedule('IfcWall'), walls.length)
    const fromSchedule = await run('request_user_action', { action: 'copy_guids', schedule: true })
    const asked = turn.pending
    expect(fromSchedule).toMatchObject({ applied: false, pending: true, target: 'schedule', count: WALLS })
    const action = asked?.action as Extract<PendingAction, { kind: 'copy_guids' }>
    expect(action.kind).toBe('copy_guids')
    // Every GlobalId, one per line — in the request, never in what the model reads.
    expect(action.text.split('\n').sort()).toEqual(full.elements.filter((e) => e.type === 'IfcWall').map((e) => e.guid).sort())
    expect(JSON.stringify(fromSchedule)).not.toContain(full.elements[0].guid)

    // The same 2 500, selected by the user: the same request in every respect but its source.
    fresh()
    st().select(walls)
    const fromSelection = await run('request_user_action', { action: 'copy_guids', selection: true })
    expect(fromSelection).toEqual({ ...fromSchedule, target: 'selection' })
    expect(turn.pending?.label).toBe(asked?.label)
    expect(turn.pending?.label).toBe(`copy the GlobalIds of ${WALLS} elements to the clipboard, one per line`)
    const again = turn.pending?.action as Extract<PendingAction, { kind: 'copy_guids' }>
    expect(again.text.split('\n').sort()).toEqual(action.text.split('\n').sort())
  })

  it('an id list — which the model does send — is still bounded: refused before any executor runs', async () => {
    await expect(run('apply_visibility', { action: 'hide', ids: walls.slice(0, MAX_TOOL_IDS + 1) })).rejects.toThrow(
      /apply_visibility: ids — at most 2000 ids/
    )
    expect(visible()).toBe(TOTAL)
    // At the bound it runs.
    expect((await run('apply_visibility', { action: 'hide', ids: walls.slice(0, MAX_TOOL_IDS) })).applied).toBe(true)
    expect(visible()).toBe(TOTAL - MAX_TOOL_IDS)
  })
})
