/**
 * Audit B6 — `set_storeys` obeys the scope guard and compares first, like every other tool that
 * can hide elements (`set_models`, `apply_visibility`, `manage_filters`).
 *
 *   · a change that would leave nothing visible is refused in words, with no pending row;
 *   · one that would leave under `SCOPE_GUARD` (5 %) is held behind the chat's Apply button —
 *     nothing changes until the user applies it, and then it is one undo step;
 *   · a change that only brings a storey back is exempt;
 *   · asked for what is already so, nothing changes and the result says so.
 *
 * Driven through `executeTool`, the one door a model's call comes through, on the design's own
 * mock federation (412 elements: Foundation 20, L1 112, L2 92, L3 92, L4 91, Roof 5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { federate } from '../../src/shared/federate'
import { visFn } from '../../src/shared/rules'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { executeTool, newTurnState, type ToolContext } from '../../src/renderer/ai/executors'
import { SCOPE_GUARD } from '../../src/renderer/ai/executors/view'
import { historyDepth, setViewer, useShell, type ShellState } from '../../src/renderer/state/shell'
import { memoryStorage, resetShell, stubViewer } from './stub-viewer'

const KEYS = ['ARC', 'STR', 'SIT', 'MEP'] as const
const full = federate(KEYS.map((k) => mockModelIndex(k)))
const NAMES = ['Foundation', 'L1', 'L2', 'L3', 'L4', 'Roof']

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
const run = async (input: unknown): Promise<Body> => (await executeTool('set_storeys', input, ctx())) as Body
const fresh = (): void => void Object.assign(turn, newTurnState())

const st = (): ShellState => useShell.getState()
const visible = (): number => st().federation.elements.filter(visFn(st())).length
const onStorey = (name: string): number[] => full.elements.filter((e) => e.storey === name).map((e) => e.id)
const only = (name: string): Record<string, boolean> => Object.fromEntries(NAMES.map((n) => [n, n === name]))

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  resetShell()
  setViewer(stubViewer())
  st().commitModels(full)
  fresh()
})
afterEach(() => {
  setViewer(null)
  vi.unstubAllGlobals()
})

describe('the mock federation this file relies on', () => {
  it('has 412 elements on the six storeys, Roof holding 5 and Foundation 20', () => {
    expect(st().federation.elements).toHaveLength(412)
    expect(st().federation.storeys.map((s) => s.name)).toEqual(NAMES)
    expect(onStorey('Roof')).toHaveLength(5)
    expect(onStorey('Foundation')).toHaveLength(20)
    expect(5 / 412).toBeLessThan(SCOPE_GUARD)
  })
})

describe('set_storeys and the scope guard', () => {
  it('(a) holds a change that would leave under 5 % behind Apply, and Apply makes it one undo step', async () => {
    const before = st().storeyVis
    const depth = historyDepth()

    const body = await run({ visible: ['Roof'] })

    expect(st().storeyVis).toEqual(before)
    expect(historyDepth()).toEqual(depth)
    expect(visible()).toBe(412)
    expect(body).toMatchObject({ applied: false, pending: true, wouldLeaveVisible: 5, totalElements: 412 })
    expect(turn.pending).not.toBeNull()
    expect(turn.pending!.patch).toEqual({ storeyVis: only('Roof') })
    expect(turn.pending!.label).toContain('Roof')
    expect(turn.pending!.label).toContain('5 of 412')

    // The Apply button: the reply committed with the turn's pending row, then `applyPending`.
    st().chatFinish('…', { pending: turn.pending! }, st().chatBegin('only the roof', null))
    const at = st().chatMsgs.length - 1
    st().applyPending(at)
    expect(visible()).toBe(5)
    expect(st().storeyVis).toEqual(only('Roof'))
    expect(historyDepth().undo).toBe(depth.undo + 1)
    expect(st().chatMsgs[at].pending).toBeNull()
  })

  it('(b) refuses, with no pending row, a change that would leave nothing visible', async () => {
    st().hide(onStorey('Roof'))
    expect(visible()).toBe(407)
    const before = st().storeyVis
    const depth = historyDepth()

    const body = await run({ visible: ['Roof'] })

    expect(st().storeyVis).toEqual(before)
    expect(historyDepth()).toEqual(depth)
    expect(visible()).toBe(407)
    expect(turn.pending).toBeNull()
    expect(body).toMatchObject({ applied: false, wouldLeaveVisible: 0 })
    expect(body.message).toMatch(/would leave nothing visible/i)
  })

  it('(c) applies an ordinary change at once, and an empty list shows every storey', async () => {
    const depth = historyDepth()

    const body = await run({ visible: ['L2'] })

    expect(st().storeyVis).toEqual(only('L2'))
    expect(body.message).toBe('Showing L2.')
    expect(body.storeysShown).toEqual(['L2'])
    expect(historyDepth().undo).toBe(depth.undo + 1)
    expect(turn.pending).toBeNull()

    fresh()
    const all = await run({ visible: [] })
    expect(st().storeyVis).toEqual({})
    expect(all.message).toBe('All storeys visible.')
  })

  it('(d) exempts a change that only brings a storey back, even under 5 %', async () => {
    // Hidden by hand first: then only Roof showing, as the storey eye's solo click leaves it.
    st().hide(onStorey('Foundation').slice(0, 10))
    st().soloStorey('Roof', false, NAMES)
    expect(st().storeyVis).toEqual(only('Roof'))
    expect(visible()).toBe(5)

    const body = await run({ visible: ['Roof', 'Foundation'] })

    // 15 of 412 is 3.6 % — under the guard, but nothing was taken out of view.
    expect(15 / 412).toBeLessThan(SCOPE_GUARD)
    expect(turn.pending).toBeNull()
    expect(st().storeyVis.Foundation).not.toBe(false)
    expect(st().storeyVis.Roof).not.toBe(false)
    expect(visible()).toBe(15)
    expect(body.pending).not.toBe(true)
  })

  it('(e) compares first: asked for what is already so, it changes nothing and says so', async () => {
    await run({ visible: ['L2'] })
    const shown = st().storeyVis
    const depth = historyDepth()

    fresh()
    const again = await run({ visible: ['L2'] })
    expect(historyDepth()).toEqual(depth)
    expect(st().storeyVis).toEqual(shown)
    expect(again.applied).toBe(false)
    expect(again.message).toContain('already')

    // Every storey showing, asked to show every storey.
    st().allStoreys()
    expect(st().storeyVis).toEqual({})
    const allDepth = historyDepth()
    fresh()
    const all = await run({ visible: [] })
    expect(historyDepth()).toEqual(allDepth)
    expect(st().storeyVis).toEqual({})
    expect(all.applied).toBe(false)
    expect(all.message).toContain('already')
  })

  it('(f) an unknown storey changes nothing and lists the valid names', async () => {
    const before = st().storeyVis
    const depth = historyDepth()

    const body = await run({ visible: ['Level 9'] })

    expect(st().storeyVis).toEqual(before)
    expect(historyDepth()).toEqual(depth)
    expect(turn.pending).toBeNull()
    expect(body.valid_values).toEqual(NAMES)
  })
})
