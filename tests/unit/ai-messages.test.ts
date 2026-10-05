/**
 * Refactor pass 3 — the exact text of the replies that were written out by hand in several
 * places, pinned **before** they were folded into one helper each: "Not loaded: X" (four
 * tools) and the 5 % scope guard's refusal and confirmation (three view paths). Byte for byte,
 * because the assistant reads them and the eval suite grades on them. Also the model clamp
 * `step()` and `revertTurn()` share.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { federate } from '../../src/shared/federate'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { useShell } from '../../src/renderer/state/shell'
import { pickableFor } from '../../src/renderer/state/selectors/models'
import { turnSnapshot, type TurnUndo } from '../../src/renderer/state/selectors/snapshot'
import { executeTool, newTurnState, type ToolContext } from '../../src/renderer/ai/executors'
import { resetShell } from './stub-viewer'

const full = federate(['ARC', 'STR', 'SIT', 'MEP'].map((k) => mockModelIndex(k)))
const turn = newTurnState()
const ctx = (): ToolContext => ({
  state: () => useShell.getState(),
  sql: async () => ({ columns: [], rows: [], truncated: false, ms: 0 }) as never,
  rawLine: async () => null,
  turn
})
const run = async (name: string, input: unknown = {}): Promise<Record<string, unknown>> =>
  (await executeTool(name, input, ctx())) as Record<string, unknown>

beforeEach(() => {
  resetShell()
  useShell.getState().commitModels(full)
  Object.assign(turn, newTurnState())
})

const NOT_LOADED = {
  message: 'Not loaded: HVAC. Loaded: ARC, STR, SIT, MEP',
  valid_values: ['ARC', 'STR', 'SIT', 'MEP']
}

describe('"Not loaded" is the same reply from every tool that says it', () => {
  it.each([
    ['get_entity_raw', { model: 'HVAC', expressId: 1 }],
    ['get_spatial_tree', { model: 'HVAC' }],
    ['get_model_info', { model: 'HVAC' }],
    ['activate_model', { key: 'HVAC' }]
  ])('%s', async (name, input) => {
    expect(await run(name, input)).toEqual(NOT_LOADED)
  })
})

describe('the 5 % scope guard, word for word', () => {
  const CONFIRM =
    'Needs confirmation: this would leave only 3 of 412 elements visible. The user has been shown an Apply button — tell them briefly what is waiting.'

  it('set_filter_stack refuses a blank view', async () => {
    const body = await run('set_filter_stack', {
      steps: [{ action: 'hide', rules: [{ prop: 'Model', op: '!=', val: 'nothing' }] }]
    })
    expect(body.message).toBe(
      'That stack would leave nothing visible, so it was not applied. 1. hide Model != nothing → 412 match. Check which step matches nothing and fix its rules.'
    )
    expect(body.applied).toBe(false)
    expect(body.pending).toBeUndefined()
  })

  it('set_filter_stack holds back a change under 5 %', async () => {
    const body = await run('set_filter_stack', {
      steps: [{ action: 'isolate', rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcStair' }] }]
    })
    expect(body.message).toBe(
      'Needs confirmation: leaves only 3 of 412 visible. 1. isolate IfcEntity = IfcStair → 3 match. The user has an Apply button.'
    )
    expect(body.pending).toBe(true)
    expect(turn.pending!.label).toBe('1 filter step — leaves 3 of 412 visible')
  })

  it('apply_visibility (rules) refuses a blank view', async () => {
    await run('apply_visibility', {
      rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }],
      action: 'isolate'
    })
    const body = await run('apply_visibility', {
      rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWindow' }],
      action: 'isolate',
      combine: 'append'
    })
    expect(body.message).toMatch(
      /^That would leave nothing visible, so it was not applied\. \d+ elements match — .+ — but appended to 1 live step\(s\) it narrows to nothing\. Check the rules, or pass combine:"replace" to start a fresh stack\.$/
    )
    expect(body.applied).toBe(false)
    expect(turn.pending).toBeNull()
  })

  it('apply_visibility (rules) holds back a change under 5 %, and exempts highlight', async () => {
    const rules = [{ prop: 'IfcEntity', op: '=', val: 'IfcStair' }]
    const body = await run('apply_visibility', { rules, action: 'isolate' })
    expect(body.message).toBe(CONFIRM)
    expect(body.pending).toBe(true)
    expect(turn.pending!.label).toBe('isolate 3 elements — leaves 3 of 412 visible')
    Object.assign(turn, newTurnState())
    expect((await run('apply_visibility', { rules, action: 'highlight' })).applied).toBe(true)
  })

  it('apply_visibility (ids) refuses a blank view, and exempts show', async () => {
    const all = useShell.getState().federation.elements.map((e) => e.id)
    const body = await run('apply_visibility', { action: 'hide', ids: all })
    expect(body.message).toBe(
      'That would leave nothing visible, so it was not applied. Check the ids, or use action:"reset" to start from the whole model.'
    )
    expect(body.applied).toBe(false)
    expect((await run('apply_visibility', { action: 'show', ids: all })).applied).toBe(true)
  })

  it('apply_visibility refuses a blank view in words for what named the set: the selection has no ids to check', async () => {
    // 2026-10-02 (the review's leftover of the parity work's phase 4). The schedule's wording
    // is pinned beside the schedule itself, in `ai-parity-4-bound.test.ts`.
    const all = useShell.getState().federation.elements.map((e) => e.id)
    useShell.getState().select(all)
    const body = await run('apply_visibility', { action: 'hide', selection: true })
    expect(body.message).toBe(
      'That would leave nothing visible, so it was not applied. Check the selection, or use action:"reset" to start from the whole model.'
    )
    expect([body.applied, body.target, body.matched, body.wouldLeaveVisible]).toEqual([false, 'selection', 412, 0])
    expect(turn.pending).toBeNull()
  })

  it('apply_visibility (ids) holds back a change under 5 %', async () => {
    const stairs = useShell
      .getState()
      .federation.elements.filter((e) => e.type === 'IfcStair')
      .map((e) => e.id)
    const body = await run('apply_visibility', { action: 'isolate', ids: stairs })
    expect(body.message).toBe(CONFIRM)
    expect(body.pending).toBe(true)
    expect(turn.pending!.label).toBe('isolate 3 elements — leaves 3 of 412 visible')
  })
})

describe('step() and revertTurn() drop an active model that is no longer loaded', () => {
  const unloadStr = (): void => useShell.setState({ loaded: ['ARC', 'SIT', 'MEP'] })

  it('step()', () => {
    const s = useShell.getState()
    s.activate('STR')
    useShell.getState().activate('STR') // toggles off, with STR active on the undo stack
    expect(useShell.getState().active).toBeNull()
    unloadStr()
    useShell.getState().step(true)
    expect(useShell.getState().active).toBeNull()
  })

  it('step() keeps a model that is still loaded', () => {
    useShell.getState().activate('STR')
    useShell.getState().activate('STR')
    useShell.getState().step(true)
    expect(useShell.getState().active).toBe('STR')
  })

  /**
   * 2026-10-02: a reply's undo is the review state from before it and the parts it changed
   * (`selectors/snapshot.ts`), where it was the five visibility keys as a string. The rule this
   * pins is unchanged: a model that has gone is not made active again.
   */
  const undoWithStrActive = (): TurnUndo => ({
    before: turnSnapshot({ ...useShell.getState(), active: 'STR' }, null),
    changed: ['vis']
  })

  it('revertTurn()', () => {
    useShell.setState({ chatMsgs: [{ role: 'assistant', text: 'x', undoSnap: undoWithStrActive() }] })
    unloadStr()
    useShell.getState().revertTurn(0)
    expect(useShell.getState().active).toBeNull()
    expect(useShell.getState().chatMsgs[0].reverted).toBe(true)
  })

  it('revertTurn() keeps a model that is still loaded', () => {
    useShell.setState({ chatMsgs: [{ role: 'assistant', text: 'x', undoSnap: undoWithStrActive() }] })
    useShell.getState().revertTurn(0)
    expect(useShell.getState().active).toBe('STR')
  })
})

describe('pickableFor — activate mode’s one pick rule', () => {
  it('is null with no model active, and picks only the active model’s elements otherwise', () => {
    expect(pickableFor(null)).toBeNull()
    expect(pickableFor(undefined)).toBeNull()
    const only = pickableFor('STR')!
    expect([only({ model: 'STR' }), only({ model: 'ARC' })]).toEqual([true, false])
  })
})
