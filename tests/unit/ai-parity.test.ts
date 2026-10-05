/**
 * Parity with the user, phase 1 — 2026-10-02. The owner: *"assistant should possess everything
 * user can do on the app."*
 *
 * Every tool this phase extends or adds, on the design's own mock federation (412 elements,
 * four models), through `executeTool` — the one door a model's call comes through — with a
 * recording stub viewer, so what is asserted is the store **and** that the control's own action
 * ran (the viewer is told by the action, never by the executor).
 *
 * Three rules are checked for everything here:
 *
 *   · **through the control's own action** — the state a call leaves is the state the click
 *     leaves, and the viewer hears of it the way it hears of a click;
 *   · **idempotent** — a toggle is compared first, so the same call twice changes nothing the
 *     second time: no store write, no viewer call, no undo entry, no ↺;
 *   · **guarded** — anything that can hide runs `scopeCheck`: a blank view is refused, under
 *     5 % waits for the user's Apply, and the pending entry is the patch the action would have
 *     written.
 *
 * Phase 3, the same day: an undo or a redo the guard catches is **held behind Apply** — as an
 * action, the user's click taking the real step — where it was refused in words; and "one held
 * change per turn" is one request of any kind (`ai-parity-3.test.ts` has the gate itself).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { federate } from '../../src/shared/federate'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { historyDepth, peekHistory, setViewer, useShell, type ShellState } from '../../src/renderer/state/shell'
import {
  executeTool,
  newTurnState,
  oneHeld,
  type ToolContext,
  type ToolOutcome
} from '../../src/renderer/ai/executors'
import { SCOPE_GUARD, scopeCheck } from '../../src/renderer/ai/executors/view'
import { CONNECT_WAIT_MS } from '../../src/renderer/ai/executors/schedule'
import { connect } from '../../src/renderer/model/schedule-link'
import { DISPLAY_DEFAULTS, displayState, type DisplayState } from '../../src/shared/ai-schema'
import { visFn, type FilterStep, type Rule } from '../../src/shared/rules'
import * as fstack from '../../src/shared/filter-stack'
import { resetShell, stubViewer } from './stub-viewer'

const KEYS = ['ARC', 'STR', 'SIT', 'MEP'] as const
const full = federate(KEYS.map((k) => mockModelIndex(k)))

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
const run = async (name: string, input: unknown = {}): Promise<Body> =>
  (await executeTool(name, input, ctx())) as Body

/** Every viewer call the store's actions make, in order. */
let calls: [string, ...unknown[]][] = []
const called = (name: string): unknown[][] => calls.filter((c) => c[0] === name).map((c) => c.slice(1))
const recorder = (...names: string[]): Record<string, (...args: unknown[]) => void> =>
  Object.fromEntries(names.map((n) => [n, (...args: unknown[]) => void calls.push([n, ...args])]))

const st = (): ShellState => useShell.getState()
const is = (prop: string, val: string): Rule => ({ prop, op: '=', val })
const idsOf = (pred: (e: (typeof full.elements)[number]) => boolean): number[] =>
  full.elements.filter(pred).map((e) => e.id)
const visibleIds = (): number[] => st().federation.elements.filter(visFn(st())).map((e) => e.id)
const visible = (): number => visibleIds().length

const STAIRS = idsOf((e) => e.type === 'IfcStair')
const DOORS_L2 = idsOf((e) => e.type === 'IfcDoor' && e.storey === 'L2')
const MEP = idsOf((e) => e.model === 'MEP')
const ALL = full.elements.map((e) => e.id)

beforeEach(() => {
  resetShell()
  setViewer(
    stubViewer(
      recorder(
        'setGroundGrid',
        'setSnap',
        'setGrids',
        'setLevels',
        'setShadows',
        'setModelColors',
        'setTheme',
        'setTool',
        'setSelected',
        'zoomTo',
        'setPickable',
        'setVisibility'
      )
    )
  )
  st().commitModels(full)
  Object.assign(turn, newTurnState())
  calls = []
})
afterEach(() => {
  setViewer(null)
  connect(null)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/* ────────────────────────────── the fixture this file leans on ────────────────────────────── */

describe('the mock, as these cases need it', () => {
  it('has 412 elements in four models, three stairs, four doors on L2 and eight MEP elements', () => {
    expect(full.elements).toHaveLength(412)
    expect(st().loaded).toEqual(['ARC', 'STR', 'SIT', 'MEP'])
    expect([STAIRS.length, DOORS_L2.length, MEP.length]).toEqual([3, 4, 8])
    // Under the guard's threshold, each of them: the three sets the held cases use.
    for (const n of [3, 4, 8]) expect(n / 412).toBeLessThan(SCOPE_GUARD)
  })
})

/* ────────────────────────────── 1. toggle_display ────────────────────────────── */

describe('toggle_display — the canvas grid, snap and original materials', () => {
  it('turns each of the three off through its own action, and tells the viewer as a click does', async () => {
    const body = await run('toggle_display', { groundGrid: false, snap: false, originalMaterials: false })
    expect(body.message).toBe('canvas grid off, snap off, original materials off.')
    expect(body.changed).toEqual(['canvas grid off', 'snap off', 'original materials off'])
    expect(body.already).toEqual([])
    expect([st().groundGrid, st().snap, st().nativeMats]).toEqual([false, false, false])
    // `setGroundGrid`, `toggleSnap` and `toggleNative` each tell the viewer themselves.
    expect(called('setGroundGrid')).toEqual([[false]])
    expect(called('setSnap')).toEqual([[false]])
    expect(called('setModelColors')).toEqual([[{}, false]])
    // …and the result reads every switch back.
    expect(body.display).toEqual({ ...DISPLAY_DEFAULTS, groundGrid: false, snap: false, originalMaterials: false })
    expect(turn.acted).toBe(true)
    // None of them is a visibility key: nothing was hidden and nothing went on the undo stack.
    expect(visible()).toBe(412)
    expect(historyDepth()).toEqual({ undo: 0, redo: 0 })
  })

  it('leaves the state a click on the control leaves', async () => {
    await run('toggle_display', { groundGrid: false, snap: false, originalMaterials: false })
    const byTool = displayState(st())
    resetShell()
    st().commitModels(full)
    // The toolbar's canvas-grid button, its snap button, and the sidebar's switch.
    st().setGroundGrid(!st().groundGrid)
    st().toggleSnap()
    st().toggleNative()
    expect(displayState(st())).toEqual(byTool)
  })

  it('changes nothing the second time, for every one of the seven switches', async () => {
    const keys = Object.keys(DISPLAY_DEFAULTS) as (keyof DisplayState)[]
    expect(keys).toEqual(['grids', 'levels', 'shadows', 'dims', 'groundGrid', 'snap', 'originalMaterials'])
    for (const key of keys) {
      const want = !DISPLAY_DEFAULTS[key]
      const first = await run('toggle_display', { [key]: want })
      expect([key, (first.changed as string[]).length, first.already]).toEqual([key, 1, []])
      expect([key, displayState(st())[key]]).toEqual([key, want])

      // The same call again: reported, not flipped.
      Object.assign(turn, newTurnState())
      const before = st()
      const viewerCalls = calls.length
      const second = await run('toggle_display', { [key]: want })
      expect([key, second.changed]).toEqual([key, []])
      expect([key, second.already]).toEqual([key, first.changed])
      expect([key, String(second.message)]).toEqual([key, `${String(first.message).replace(/ (on|off)\.$/, ' already $1.')}`])
      // No store write at all, no viewer call, and no ↺ for nothing.
      expect([key, st() === before]).toEqual([key, true])
      expect([key, calls.length]).toEqual([key, viewerCalls])
      expect([key, turn.acted]).toEqual([key, false])
    }
  })

  it('says "already" for dims too — it used to say nothing at all', async () => {
    const body = await run('toggle_display', { dims: false })
    expect(body.message).toBe('dimensions already off.')
    expect(body.already).toEqual(['dimensions off'])
    expect(body.changed).toEqual([])
    expect(st().dims).toBe(false)
    // A mix: what moved and what did not, in the switches' own order.
    const mixed = await run('toggle_display', { snap: true, grids: false, dims: true, levels: false })
    expect(mixed.message).toBe('grids off, levels already off, dimensions on, snap already on.')
    expect(mixed.changed).toEqual(['grids off', 'dimensions on'])
    expect(mixed.already).toEqual(['levels off', 'snap on'])
  })

  it('does not call setShadows for a shadow that is already as asked', async () => {
    await run('toggle_display', { shadows: true })
    expect(called('setShadows')).toEqual([])
    await run('toggle_display', { shadows: false })
    expect(called('setShadows')).toEqual([[false]])
  })
})

/* ────────────────────────────── 2. select_elements ────────────────────────────── */

describe('select_elements — replace, add, remove, clear', () => {
  it('adds a set to the selection there already is, as Ctrl-clicking each one would', async () => {
    await run('select_elements', { ids: STAIRS, zoom: false })
    calls = []
    const body = await run('select_elements', { mode: 'add', rules: [is('IfcEntity', 'IfcDoor'), is('Level', 'L2')] })
    expect(body).toMatchObject({ added: 4, selectionCount: 7, target: 'rules' })
    expect(body.message).toBe('Added 4 elements to the selection — 7 selected now.')
    expect(st().selIds).toEqual([...STAIRS, ...DOORS_L2])
    // One call to the viewer for the whole set, and the camera stays where it is.
    expect(called('setSelected')).toEqual([[[...STAIRS, ...DOORS_L2]]])
    expect(called('zoomTo')).toEqual([])
    expect(turn.chips[turn.chips.length - 1]).toEqual({ label: '7 selected', ids: [...STAIRS, ...DOORS_L2] })

    // The same state the user reaches by Ctrl-clicking the four doors one at a time.
    const byTool = [...st().selIds]
    st().select(STAIRS, false)
    for (const id of DOORS_L2) st().select(id, false, 'toggle')
    expect(st().selIds).toEqual(byTool)
    expect(st().sel).toBe(DOORS_L2[DOORS_L2.length - 1])
  })

  it('adding what is already selected changes nothing the second time', async () => {
    await run('select_elements', { ids: STAIRS, zoom: false })
    await run('select_elements', { mode: 'add', ids: DOORS_L2 })
    Object.assign(turn, newTurnState())
    calls = []
    const before = st()
    const again = await run('select_elements', { mode: 'add', ids: DOORS_L2 })
    expect(again.message).toBe('All 4 elements are already selected — the selection is unchanged.')
    expect(again).toMatchObject({ added: 0, selectionCount: 7 })
    expect(st()).toBe(before)
    expect(calls).toEqual([])
    expect(turn.acted).toBe(false)
    // Part of the set new, part of it selected already: only the new ones are added.
    const part = await run('select_elements', { mode: 'add', ids: [DOORS_L2[0], MEP[0]] })
    expect(part).toMatchObject({ added: 1, selectionCount: 8 })
    expect(part.message).toBe('Added 1 element to the selection — 8 selected now. 1 were already selected.')
  })

  it('zooms on add only when asked, and then to the whole selection', async () => {
    await run('select_elements', { ids: STAIRS, zoom: false })
    calls = []
    await run('select_elements', { mode: 'add', ids: DOORS_L2, zoom: true })
    expect(called('zoomTo')).toEqual([[[...STAIRS, ...DOORS_L2]]])
  })

  it('removes a set from the selection, and says so when none of it was selected', async () => {
    await run('select_elements', { ids: [...STAIRS, ...DOORS_L2], zoom: false })
    calls = []
    const body = await run('select_elements', { mode: 'remove', ids: STAIRS })
    expect(body).toMatchObject({ removed: 3, selectionCount: 4 })
    expect(body.message).toBe('Removed 3 elements from the selection — 4 selected now.')
    expect(st().selIds).toEqual(DOORS_L2)
    expect(called('zoomTo')).toEqual([])

    Object.assign(turn, newTurnState())
    const before = st()
    const again = await run('select_elements', { mode: 'remove', ids: STAIRS })
    expect(again.message).toBe('None of those 3 elements are selected — the selection is unchanged.')
    expect(again).toMatchObject({ removed: 0, selectionCount: 4 })
    expect(st()).toBe(before)
    expect(turn.acted).toBe(false)

    // Removing everything that is selected leaves no selection at all.
    await run('select_elements', { mode: 'remove', selection: true })
    expect(st().selIds).toEqual([])
    expect(st().sel).toBeNull()
  })

  it('clears the selection as Esc does, needing no set — and ignoring one', async () => {
    await run('select_elements', { ids: STAIRS, zoom: false })
    Object.assign(turn, newTurnState())
    calls = []
    const body = await run('select_elements', { mode: 'clear' })
    expect(body).toEqual({ message: 'Selection cleared — 3 elements deselected.', cleared: 3, selectionCount: 0 })
    expect(st().selIds).toEqual([])
    expect(st().sel).toBeNull()
    expect(called('setSelected')).toEqual([[[]]])
    expect(turn.chips).toEqual([])
    expect(turn.acted).toBe(true)

    // Nothing selected: reported, and `select` is not called.
    Object.assign(turn, newTurnState())
    calls = []
    const again = await run('select_elements', { mode: 'clear' })
    expect(again).toEqual({ message: 'Nothing was selected — nothing changed.', cleared: 0, selectionCount: 0 })
    expect(calls).toEqual([])
    expect(turn.acted).toBe(false)

    // A set sent with `clear` is not selected: clear means clear.
    await run('select_elements', { ids: STAIRS, zoom: false })
    await run('select_elements', { mode: 'clear', rules: [is('IfcEntity', 'IfcWall')] })
    expect(st().selIds).toEqual([])
  })

  it('keeps replace as it was, and leaves the selection alone on a miss in any mode', async () => {
    const body = await run('select_elements', { rules: [is('IfcEntity', 'IfcStair')] })
    expect(body).toMatchObject({ selected: 3, selectionCount: 3, target: 'rules' })
    expect(body.message).toBe('Selected 3 elements.')
    // Replace still zooms unless told not to.
    expect(called('zoomTo')).toEqual([[STAIRS]])
    expect((await run('select_elements', { mode: 'replace', ids: DOORS_L2, zoom: false })).selected).toBe(4)
    expect(st().selIds).toEqual(DOORS_L2)

    for (const mode of ['add', 'remove', 'replace']) {
      const miss = await run('select_elements', { mode, rules: [is('IfcEntity', 'IfcTeleporter')] })
      expect([mode, miss.selectionCount, st().selIds]).toEqual([mode, 4, DOORS_L2])
      expect([mode, String(miss.message).includes('The selection is unchanged.')]).toEqual([mode, true])
    }
    expect((await run('select_elements', { mode: 'remove', ids: [999_999] })).message).toContain('nothing was deselected')
  })
})

/* ────────────────────────────── 3. undo and redo ────────────────────────────── */

describe('apply_visibility — undo and redo', () => {
  const isolateWalls = (): Promise<Body> =>
    run('apply_visibility', { action: 'isolate', rules: [is('IfcEntity', 'IfcWall')] })

  it('says so when there is nothing to step to, and changes nothing', async () => {
    const before = st()
    for (const action of ['undo', 'redo']) {
      const body = await run('apply_visibility', { action })
      expect(body).toEqual({
        message: `Nothing to ${action} — nothing changed.`,
        applied: false,
        action,
        history: { canUndo: false, canRedo: false }
      })
    }
    expect(st()).toBe(before)
    expect(turn.acted).toBe(false)
  })

  it('steps back and forward through the store’s own history, and reports the two flags before and after', async () => {
    await isolateWalls()
    expect(visible()).toBe(80)
    expect([st().canUndo, st().canRedo]).toEqual([true, false])

    const undo = await run('apply_visibility', { action: 'undo' })
    expect(undo).toEqual({
      message: 'Undid one change — 412 of 412 visible (was 80). Nothing further to undo.',
      applied: true,
      action: 'undo',
      visibleElements: 412,
      visibleBefore: 80,
      totalElements: 412,
      historyBefore: { canUndo: true, canRedo: false },
      history: { canUndo: false, canRedo: true }
    })
    expect(st().stack).toEqual([])
    expect([st().canUndo, st().canRedo]).toEqual([false, true])
    expect(turn.acted).toBe(true)

    const redo = await run('apply_visibility', { action: 'redo' })
    expect(redo).toMatchObject({
      message: 'Redid one change — 80 of 412 visible (was 412). Nothing further to redo.',
      applied: true,
      historyBefore: { canUndo: false, canRedo: true },
      history: { canUndo: true, canRedo: false }
    })
    expect(visible()).toBe(80)
    expect((await run('apply_visibility', { action: 'redo' })).message).toBe('Nothing to redo — nothing changed.')
  })

  it('is the action bar’s own step: the same state, the same stacks', async () => {
    await isolateWalls()
    await run('set_storeys', { visible: ['L2'] })
    await run('apply_visibility', { action: 'undo' })
    const byTool = { vis: visibleIds(), depth: historyDepth(), storeyVis: st().storeyVis }

    resetShell()
    st().commitModels(full)
    Object.assign(turn, newTurnState())
    await isolateWalls()
    await run('set_storeys', { visible: ['L2'] })
    st().step(true) // ⌘Z
    expect({ vis: visibleIds(), depth: historyDepth(), storeyVis: st().storeyVis }).toEqual(byTool)
    expect(byTool.depth).toEqual({ undo: 1, redo: 1 })
  })

  it('undoes whoever changed the view last — a storey eye, the model eye, activate mode', async () => {
    st().toggleStorey('L3')
    st().toggleModel('MEP')
    st().activate('STR')
    calls = []
    await run('apply_visibility', { action: 'undo' })
    expect(st().active).toBeNull()
    // `step` re-applies pickability, because `active` is one of the keys it restores.
    expect(called('setPickable')).toHaveLength(1)
    await run('apply_visibility', { action: 'undo' })
    expect(st().modelVis.MEP).not.toBe(false)
    await run('apply_visibility', { action: 'undo' })
    expect(st().storeyVis.L3).not.toBe(false)
    expect(visible()).toBe(412)
  })

  it('takes nothing else: rules and ids sent with it are not acted on', async () => {
    await isolateWalls()
    await run('apply_visibility', { action: 'undo', rules: [is('IfcEntity', 'IfcDoor')], ids: STAIRS })
    expect(st().stack).toEqual([])
    expect(st().hidden).toEqual({})
    expect(visible()).toBe(412)
  })

  /**
   * An undo can hide — it brings back whatever the user's "show all" undid. So it is held to
   * the scope guard, by peeking at what the step would restore before taking it.
   *
   * Phase 3: held behind Apply, as an **action** — the entry the step would restore travels
   * with the request, and the user's click takes the real step. (Until the pending row could
   * hold an action it was refused in words: Apply applied a patch, and an undo is a step.)
   */
  it('holds a step that would leave under 5 % visible behind Apply, and moves nothing in the history', async () => {
    st().isolate(STAIRS) // the user's own right-click Isolate: 3 of 412
    st().showAll() // …and then "show all"
    expect(visible()).toBe(412)
    const before = st()
    const depth = historyDepth()

    const body = await run('apply_visibility', { action: 'undo' })
    expect(body).toEqual({
      message:
        'Needs confirmation: this would leave only 3 of 412 elements visible. The user has been shown an Apply button — tell them briefly what is waiting.',
      applied: false,
      pending: true,
      action: 'undo',
      wouldLeaveVisible: 3,
      totalElements: 412,
      history: { canUndo: true, canRedo: false }
    })
    expect(st()).toBe(before)
    expect(historyDepth()).toEqual(depth)
    expect(turn.acted).toBe(false)
    // Held as an action, fixed to the entry it would restore — not as a patch.
    expect(turn.pending!.label).toBe('undo one change — leaves 3 of 412 visible')
    expect(turn.pending!.patch).toBeUndefined()
    expect(turn.pending!.action).toEqual({ kind: 'undo', snap: peekHistory(true) })

    // The user's click on Apply takes the store's own step: the same state ⌘Z leaves.
    st().chatFinish('…', { pending: turn.pending! }, st().chatBegin('undo that', null))
    const at = st().chatMsgs.length - 1
    st().applyPending(at)
    expect(visible()).toBe(3)
    expect(historyDepth()).toEqual({ undo: depth.undo - 1, redo: depth.redo + 1 })
    expect(st().chatMsgs[at].pending).toBeNull()
    // What it changed joins the reply's undo, as an applied patch does.
    expect(st().chatMsgs[at].undoSnap?.changed).toEqual(['vis'])
    // …and from there the assistant may undo freely, because that step only reveals.
    Object.assign(turn, newTurnState())
    const out = await run('apply_visibility', { action: 'undo' })
    expect(out).toMatchObject({ applied: true, visibleElements: 412, visibleBefore: 3 })
  })

  it('takes no step on Apply when the history has moved on since it was asked', async () => {
    st().isolate(STAIRS)
    st().showAll()
    await run('apply_visibility', { action: 'undo' })
    st().chatFinish('…', { pending: turn.pending! }, st().chatBegin('undo that', null))
    const at = st().chatMsgs.length - 1
    // Meanwhile the user hides a door: the step there is to take now is not the one that was held.
    st().hide([DOORS_L2[0]])
    const depth = historyDepth()
    st().applyPending(at)
    expect(visible()).toBe(411)
    expect(historyDepth()).toEqual(depth)
    expect(st().chatMsgs[at].pending).toBeNull()
    expect(st().chatErr).toBe(
      'What can be undone has changed since that was asked, so nothing was undone — the action bar’s own Undo takes the step there is now.'
    )
  })

  it('takes a step that only brings elements back, however few it leaves — as `show` is exempt', async () => {
    st().isolate(STAIRS) // the user's: 3 of 412
    st().hide([STAIRS[0]]) // …and one of those hidden: 2 of 412
    expect(visible()).toBe(2)
    // Undo restores the third stair. Still under 5 %, and nothing is taken out of view.
    const body = await run('apply_visibility', { action: 'undo' })
    expect(body).toMatchObject({ applied: true, visibleElements: 3, visibleBefore: 2 })
    expect(scopeCheck(3, 412)).toBe('confirm')
    // A blank view the user made can be left the same way: the step hides nothing.
    st().hide(visibleIds())
    expect(visible()).toBe(0)
    st().step(true)
    st().step(false)
    expect(visible()).toBe(0)
    expect((await run('apply_visibility', { action: 'undo' })).applied).toBe(true)
    expect(visible()).toBe(3)
  })

  it('holds a step that would leave nothing visible, in either direction — a view the user made is theirs to go back to', async () => {
    st().hide(ALL) // the user hid everything by hand
    st().showAll()
    const undo = await run('apply_visibility', { action: 'undo' })
    expect(undo).toMatchObject({ applied: false, pending: true, wouldLeaveVisible: 0 })
    expect(undo.message).toContain('this would leave only 0 of 412 elements visible')
    expect(turn.pending!.label).toBe('undo one change — leaves 0 of 412 visible')
    expect(visible()).toBe(412)

    // Redo: the user steps back to the blank view and forward again, then back; redo is blank.
    st().step(true) // blank
    st().step(true) // before the hide: everything
    expect(visible()).toBe(412)
    Object.assign(turn, newTurnState())
    const redo = await run('apply_visibility', { action: 'redo' })
    expect(redo).toMatchObject({ applied: false, pending: true, action: 'redo', wouldLeaveVisible: 0 })
    expect(turn.pending!.action).toEqual({ kind: 'redo', snap: peekHistory(false) })
    expect(visible()).toBe(412)
    // Apply is the action bar's Redo.
    st().chatFinish('…', { pending: turn.pending! }, st().chatBegin('redo', null))
    st().applyPending(st().chatMsgs.length - 1)
    expect(visible()).toBe(0)
  })
})

/* ────────────────────────────── 4. models ────────────────────────────── */

describe('set_models — the eye beside each model', () => {
  it('hides a model through one undoable change, and says what is showing', async () => {
    const body = await run('set_models', { visible: ['ARC', 'STR', 'SIT'] })
    expect(body).toEqual({
      message: 'Showing ARC, STR, SIT; hidden: MEP. 404 of 412 elements visible.',
      applied: true,
      modelsShown: ['ARC', 'STR', 'SIT'],
      modelsHidden: ['MEP'],
      visibleElements: 404,
      totalElements: 412
    })
    expect(st().modelVis).toEqual({ ARC: true, STR: true, SIT: true, MEP: false })
    expect(visible()).toBe(404)
    expect(turn.acted).toBe(true)
    // One request, one undo step — and ⌘Z brings the model back.
    expect(historyDepth()).toEqual({ undo: 1, redo: 0 })
    st().step(true)
    expect(visible()).toBe(412)
  })

  it('leaves exactly what the eye leaves', async () => {
    await run('set_models', { visible: ['ARC', 'STR', 'SIT'] })
    const byTool = visibleIds()
    resetShell()
    st().commitModels(full)
    st().toggleModel('MEP') // the eye
    expect(visibleIds()).toEqual(byTool)
  })

  it('changes nothing the second time: no undo entry, no viewer call, no ↺', async () => {
    await run('set_models', { visible: ['ARC', 'STR', 'SIT'] })
    Object.assign(turn, newTurnState())
    calls = []
    const before = st()
    const depth = historyDepth()
    const again = await run('set_models', { visible: ['SIT', 'ARC', 'STR', 'ARC'] })
    expect(again).toEqual({
      message: 'Showing ARC, STR, SIT; hidden: MEP — that is how it already was, so nothing changed.',
      applied: false,
      modelsShown: ['ARC', 'STR', 'SIT'],
      modelsHidden: ['MEP'],
      visibleElements: 404,
      totalElements: 412
    })
    expect(st()).toBe(before)
    expect(historyDepth()).toEqual(depth)
    expect(calls).toEqual([])
    expect(turn.acted).toBe(false)
  })

  it('shows every model for an empty list, or for a list that names them all', async () => {
    expect((await run('set_models', { visible: [] })).message).toBe(
      'All models showing — that is how it already was, so nothing changed.'
    )
    await run('set_models', { visible: ['ARC'] })
    expect(visible()).toBe(140)
    const all = await run('set_models', { visible: [] })
    expect(all).toMatchObject({ applied: true, modelsHidden: [], visibleElements: 412 })
    expect(all.message).toBe('All models showing. 412 of 412 elements visible.')
    // The map's first state, which is also what "show all" writes.
    expect(st().modelVis).toEqual({})

    await run('set_models', { visible: ['ARC'] })
    await run('set_models', { visible: ['MEP', 'SIT', 'STR', 'ARC'] })
    expect(st().modelVis).toEqual({})
    expect(visible()).toBe(412)
  })

  it('refuses a key that is not loaded with the valid list, and changes nothing', async () => {
    const before = st()
    const body = await run('set_models', { visible: ['ARC', 'HVAC', 'Plumbing'] })
    expect(body).toEqual({
      message: 'Not loaded: HVAC, Plumbing. Nothing changed. Loaded: ARC, STR, SIT, MEP',
      valid_values: ['ARC', 'STR', 'SIT', 'MEP']
    })
    expect(st()).toBe(before)
    // A long list of wrong keys comes back counted, not echoed.
    const many = await run('set_models', { visible: Array.from({ length: 30 }, (_, i) => `Nope${i}`) })
    expect(many.message).toContain('Nope9, … 20 more. Nothing changed.')
  })

  it('holds a change under the 5 % guard behind Apply, with the patch the action would have written', async () => {
    const body = await run('set_models', { visible: ['MEP'] })
    expect(body).toEqual({
      message:
        'Needs confirmation: this would leave only 8 of 412 elements visible. The user has been shown an Apply button — tell them briefly what is waiting.',
      applied: false,
      pending: true,
      wouldLeaveVisible: 8,
      totalElements: 412
    })
    // Nothing changed yet…
    expect(st().modelVis).toEqual({})
    expect(visible()).toBe(412)
    expect(historyDepth()).toEqual({ undo: 0, redo: 0 })
    expect(turn.acted).toBe(false)
    // …and the pending entry is the patch — exactly `modelVis`, nothing else.
    expect(turn.pending).toEqual({
      label: 'show 1 of 4 models — leaves 8 of 412 visible',
      patch: { modelVis: { ARC: false, STR: false, SIT: false, MEP: true } }
    })
    // Apply hands it to `up()`: the same view three clicks on the other eyes leave.
    st().up(turn.pending!.patch!)
    const byPatch = visibleIds()
    expect(byPatch).toEqual(MEP)
    resetShell()
    st().commitModels(full)
    for (const k of ['ARC', 'STR', 'SIT']) st().toggleModel(k)
    expect(visibleIds()).toEqual(byPatch)
  })

  it('refuses outright a change that would leave nothing visible', async () => {
    st().hide(MEP) // every MEP element hidden by hand
    const before = st()
    const body = await run('set_models', { visible: ['MEP'] })
    expect(body).toEqual({
      message:
        'That would leave nothing visible, so it was not applied. Every model is showing now. Check the storeys and the filter stack, or use apply_visibility with action:"reset" to start from the whole model.',
      applied: false,
      wouldLeaveVisible: 0,
      totalElements: 412
    })
    expect(st()).toBe(before)
    expect(turn.pending).toBeNull()
  })

  it('never holds a call that only brings models back — it can only reveal more', async () => {
    // The user's own doing: three eyes off, and the site's elements hidden by hand as well.
    for (const k of ['ARC', 'STR', 'SIT']) st().toggleModel(k)
    st().hide(idsOf((e) => e.model === 'SIT'))
    expect(visible()).toBe(8)
    // Showing SIT again reveals nothing here and still leaves 8 of 412 — under 5 %, not held.
    const body = await run('set_models', { visible: ['MEP', 'SIT'] })
    expect(body).toMatchObject({ applied: true, visibleElements: 8, modelsHidden: ['ARC', 'STR'] })
    expect(turn.pending).toBeNull()
    expect(scopeCheck(8, 412)).toBe('confirm')
  })
})

describe('color_models — one model’s reset', () => {
  beforeEach(async () => {
    await run('color_models', { map: { ARC: '#E05A6B', STR: '#4C8DF6' } })
    Object.assign(turn, newTurnState())
    calls = []
  })

  it('clears one override with null — the palette’s own reset — and leaves the others', async () => {
    const body = await run('color_models', { map: { STR: null } })
    expect(body).toEqual({
      message: 'Cleared the override on STR.',
      models: { ARC: '#E05A6B' },
      originalMaterials: false
    })
    expect(st().modelColors).toEqual({ ARC: '#E05A6B' })
    // `setModelColor(key, null)` leaves Original materials as it was, as the palette's reset does.
    expect(st().nativeMats).toBe(false)
    expect(called('setModelColors')).toEqual([[{ ARC: '#E05A6B' }, false]])
    expect(turn.acted).toBe(true)

    // The same state the sidebar's `reset` leaves.
    const byTool = { ...st().modelColors }
    st().setModelColor('STR', '#4C8DF6')
    st().setModelColor('STR', null)
    expect(st().modelColors).toEqual(byTool)
  })

  it('changes nothing the second time, and says which keys were already so', async () => {
    await run('color_models', { map: { STR: null } })
    Object.assign(turn, newTurnState())
    calls = []
    const before = st()
    const again = await run('color_models', { map: { STR: null, ARC: '#E05A6B' } })
    expect(again.message).toBe('Unchanged: STR has no override, ARC is already #E05A6B.')
    expect(st()).toBe(before)
    expect(calls).toEqual([])
    expect(turn.acted).toBe(false)
  })

  it('colours and clears in one call', async () => {
    const body = await run('color_models', { map: { SIT: '#35C4B6', ARC: null } })
    expect(body.message).toBe('Coloured SIT. Cleared the override on ARC.')
    expect(st().modelColors).toEqual({ STR: '#4C8DF6', SIT: '#35C4B6' })
  })

  it('still counts the same colour as a change while Original materials hides it', async () => {
    st().toggleNative() // the user turned the files' own materials back on
    expect(st().nativeMats).toBe(true)
    const body = await run('color_models', { map: { ARC: '#E05A6B' } })
    expect(body.message).toBe('Coloured ARC.')
    // Picking a swatch turns the overrides on — that is what `setModelColor` does for a click.
    expect(st().nativeMats).toBe(false)
  })

  it('keeps the empty map as "clear every override", and refuses a null for a model that is not loaded', async () => {
    const bad = await run('color_models', { map: { HVAC: null } })
    expect(bad.message).toContain('Unusable: HVAC')
    expect(bad.message).toContain('or null to clear one')
    expect(st().modelColors).toEqual({ ARC: '#E05A6B', STR: '#4C8DF6' })

    const all = await run('color_models', { map: {} })
    expect(all).toEqual({ message: 'Colour overrides cleared.', models: {} })
    expect(st().modelColors).toEqual({})
    expect(st().nativeMats).toBe(true)
  })
})

describe('activate_model — the active key stays active', () => {
  it('no longer leaves activate mode when handed the key that is already active', async () => {
    expect((await run('activate_model', { key: 'STR' })).message).toBe('Activated STR.')
    expect(st().active).toBe('STR')
    Object.assign(turn, newTurnState())
    calls = []
    const depth = historyDepth()

    const again = await run('activate_model', { key: 'STR' })
    expect(again).toEqual({ message: 'STR is already the active model — nothing changed.', activeModel: 'STR' })
    // The defect: this used to be `null`, under a message that said "Activated STR."
    expect(st().active).toBe('STR')
    expect(historyDepth()).toEqual(depth)
    expect(calls).toEqual([])
    expect(turn.acted).toBe(false)
  })

  it('still switches to another model, and still leaves through null', async () => {
    await run('activate_model', { key: 'STR' })
    expect((await run('activate_model', { key: 'ARC' })).activeModel).toBe('ARC')
    const left = await run('activate_model', { key: null })
    expect(left).toEqual({ message: 'Left activate mode.', activeModel: null })
    expect(st().active).toBeNull()

    // Nothing active: `null` changes nothing, and pushes no undo entry for it.
    const depth = historyDepth()
    Object.assign(turn, newTurnState())
    const again = await run('activate_model', { key: null })
    expect(again).toEqual({ message: 'No model was active — nothing changed.', activeModel: null })
    expect(historyDepth()).toEqual(depth)
    expect(turn.acted).toBe(false)
    expect((await run('activate_model', { key: '' })).message).toContain('Not loaded: ')
  })
})

/* ────────────────────────────── 5. set_interface ────────────────────────────── */

describe('set_interface — the app’s own settings', () => {
  it('sets each one through the action its control calls, and reads all of them back', async () => {
    const body = await run('set_interface', {
      theme: 'light',
      units: 'm',
      treeMode: 'type',
      sidebar: 'collapsed',
      card: 'filter',
      tool: 'measure',
      search: 'wall'
    })
    expect(body.changed).toEqual([
      'sidebar collapsed',
      'theme light',
      'units m',
      'tree by PredefinedType',
      'filter card open',
      'measure tool armed',
      'tree search "wall"'
    ])
    expect(body.already).toEqual([])
    expect(body.message).toBe(
      'sidebar collapsed, theme light, units m, tree by PredefinedType, filter card open, measure tool armed, tree search "wall". The sidebar is collapsed, so the element tree is not on screen.'
    )
    const s = st()
    expect([s.theme, s.units, s.treeMode, s.panelOpen, s.card, s.tool, s.search]).toEqual([
      'light',
      'm',
      'type',
      false,
      'filter',
      'measure',
      'wall'
    ])
    // `setTheme` and `setTool` tell the viewer, as the toolbar's buttons do.
    expect(called('setTheme')).toEqual([['light']])
    expect(called('setTool')).toEqual([['measure']])
    expect(body.interface).toEqual({
      theme: 'light',
      units: 'm',
      treeMode: 'type',
      sidebar: 'collapsed',
      card: 'filter',
      tool: 'measure',
      search: 'wall',
      schedulesWindow: 'closed'
    })
  })

  it('changes nothing the second time, setting by setting', async () => {
    const asks: Record<string, unknown>[] = [
      { theme: 'light' },
      { units: 'm' },
      { treeMode: 'type' },
      { sidebar: 'collapsed' },
      { card: 'section' },
      { tool: 'spot' },
      { search: 'beam' }
    ]
    for (const ask of asks) {
      const first = await run('set_interface', ask)
      expect([ask, (first.changed as string[]).length, first.already]).toEqual([ask, 1, []])
      const before = st()
      const viewerCalls = calls.length
      const second = await run('set_interface', ask)
      expect([ask, second.changed, second.already]).toEqual([ask, [], first.changed])
      expect([ask, st() === before]).toEqual([ask, true])
      expect([ask, calls.length]).toEqual([ask, viewerCalls])
    }
    // The defaults, asked for on a fresh app: all already so.
    resetShell()
    st().commitModels(full)
    const before = st()
    const body = await run('set_interface', {
      theme: 'dark',
      units: 'mm',
      treeMode: 'entity',
      sidebar: 'open',
      card: 'none',
      tool: 'select',
      search: ''
    })
    expect(body.changed).toEqual([])
    expect(body.message).toBe(
      'sidebar already open, theme already dark, units already mm, tree already by entity, no card was open, select tool already armed, tree search already empty.'
    )
    expect(st()).toBe(before)
  })

  it('never closes the card it was asked to open — `openCard` is a toggle, and is not called twice', async () => {
    await run('set_interface', { card: 'filter' })
    await run('set_interface', { card: 'filter' })
    expect(st().card).toBe('filter')
    // The control itself would have closed it:
    st().openCard('filter')
    expect(st().card).toBeNull()

    // One card at a time: asking for another swaps it, `none` closes whichever is up.
    await run('set_interface', { card: 'views' })
    await run('set_interface', { card: 'measure' })
    expect(st().card).toBe('measure')
    expect((await run('set_interface', { card: 'none' })).changed).toEqual(['card closed'])
    expect(st().card).toBeNull()
    expect((await run('set_interface', { card: 'none' })).message).toBe('no card was open.')
  })

  it('collapses and opens the sidebar without toggling it the wrong way', async () => {
    expect((await run('set_interface', { sidebar: 'open' })).message).toBe('sidebar already open.')
    expect(st().panelOpen).toBe(true)
    await run('set_interface', { sidebar: 'collapsed' })
    await run('set_interface', { sidebar: 'collapsed' })
    expect(st().panelOpen).toBe(false)
    await run('set_interface', { sidebar: 'open' })
    expect(st().panelOpen).toBe(true)
  })

  it('arms a tool and puts select back, and clears the tree’s search with ""', async () => {
    await run('set_interface', { tool: 'spot', search: 'duct' })
    expect([st().tool, st().search]).toEqual(['spot', 'duct'])
    const back = await run('set_interface', { tool: 'select', search: '' })
    expect(back.changed).toEqual(['select tool armed', 'tree search cleared'])
    expect([st().tool, st().search]).toEqual(['select', ''])
    expect(called('setTool')).toEqual([['spot'], ['select']])
  })

  it('changes nothing about the model or what is visible, and marks the turn only for what ↺ can put back', async () => {
    await run('set_interface', { theme: 'light', units: 'm', tool: 'measure', card: 'coords', sidebar: 'collapsed' })
    expect(visible()).toBe(412)
    expect(st().selIds).toEqual([])
    expect(st().stack).toEqual([])
    expect(historyDepth()).toEqual({ undo: 0, redo: 0 })
    // Phase 2 (2026-10-02): ↺ restores the interface settings as well as what is visible, so a
    // call that changed one marks the turn. Until then it restored the five visibility keys
    // only, and this asserted `false`.
    expect(turn.acted).toBe(true)
    // A call that changed nothing marks nothing.
    Object.assign(turn, newTurnState())
    expect((await run('set_interface', {})).message).toBe('Nothing to change.')
    await run('set_interface', { theme: 'light', units: 'm' })
    expect(turn.acted).toBe(false)
  })

  it('opens the Schedules window through the toolbar button’s own call', async () => {
    // No bridge here at all: said, not thrown.
    const none = await run('set_interface', { schedulesWindow: 'open' })
    expect(none.message).toBe('The Schedules window cannot be opened here.')
    expect(none.changed).toEqual([])

    // The bridge opens it and the window joins.
    const port = { postMessage: () => undefined, close: () => undefined, onmessage: null } as unknown as MessagePort
    const openSchedules = vi.fn(async () => {
      setTimeout(() => connect(port), 20)
    })
    vi.stubGlobal('window', { sgvue: { openSchedules } })
    const opened = await run('set_interface', { schedulesWindow: 'open' })
    expect(openSchedules).toHaveBeenCalledTimes(1)
    expect(opened.message).toBe('Schedules window open.')
    expect(opened.changed).toEqual(['Schedules window open'])
    expect((opened.interface as { schedulesWindow: string }).schedulesWindow).toBe('open')
    // A window that was opened is the one thing here no revert closes: the turn is not marked.
    expect(turn.acted).toBe(false)

    // Already open: the button's call brings it forward, and the result says it was open.
    const again = await run('set_interface', { schedulesWindow: 'open' })
    expect(openSchedules).toHaveBeenCalledTimes(2)
    expect(again.message).toBe('Schedules window already open — brought to the front.')
    expect(again.changed).toEqual([])
    expect(again.already).toEqual(['Schedules window open'])
  })

  it('says so when the Schedules window never joins', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { sgvue: { openSchedules: async () => undefined } })
    const pending = run('set_interface', { schedulesWindow: 'open', theme: 'light' })
    await vi.advanceTimersByTimeAsync(CONNECT_WAIT_MS)
    const body = await pending
    expect(body.message).toBe(
      `theme light. The Schedules window did not open within ${CONNECT_WAIT_MS / 1000} s; the user can open it from the toolbar's schedules button.`
    )
    expect(body.changed).toEqual(['theme light'])
    expect((body.interface as { schedulesWindow: string }).schedulesWindow).toBe('closed')
  })
})

/* ────────────────────────────── 6. the guard on manage_filters ────────────────────────────── */

describe('manage_filters — enable and apply_set are held to the scope guard', () => {
  const steps = (): readonly FilterStep[] => st().stack
  /** Two steps the user built by hand; the store's own actions are not guarded. */
  const build = (a: Rule[], b: Rule[], second: 'isolate' | 'hide' | 'highlight' = 'isolate'): void => {
    st().addStep('isolate', a)
    st().addStep(second, b)
    st().updStep(steps()[1].id, { on: false })
    Object.assign(turn, newTurnState())
  }

  it('refuses to enable a step that would leave nothing visible', async () => {
    build([is('IfcEntity', 'IfcWall')], [is('IfcEntity', 'IfcWindow')])
    expect(visible()).toBe(80)
    const before = st()
    const body = await run('manage_filters', { op: 'enable', step: 2 })
    expect(body).toEqual({
      message:
        'Enabling step 2 would leave nothing visible, so it was not done. The stack it would make: 1. isolate — IfcEntity = IfcWall; 2. isolate — IfcEntity = IfcWindow.',
      applied: false,
      wouldLeaveVisible: 0,
      totalElements: 412
    })
    expect(st()).toBe(before)
    expect(steps()[1].on).toBe(false)
    expect(turn.pending).toBeNull()
    expect(turn.acted).toBe(false)
  })

  it('holds an enable that would leave under 5 % behind Apply, with the patch updStep would write', async () => {
    build([is('Level', 'L2')], [is('IfcEntity', 'IfcDoor')])
    expect(visible()).toBe(92)
    const body = await run('manage_filters', { op: 'enable', step: 2 })
    expect(body).toMatchObject({ applied: false, pending: true, wouldLeaveVisible: 4, totalElements: 412 })
    expect(body.message).toContain('Needs confirmation: this would leave only 4 of 412 elements visible.')
    expect(steps()[1].on).toBe(false)
    expect(visible()).toBe(92)
    expect(turn.pending!.label).toBe('enabling step 2 — leaves 4 of 412 visible')
    expect(Object.keys(turn.pending!.patch!)).toEqual(['stack'])

    // Apply → `up(patch)`: exactly what the Filter card's own switch leaves.
    const id = steps()[1].id
    st().up(turn.pending!.patch!)
    const byPatch = visibleIds()
    expect(byPatch).toEqual(DOORS_L2)
    st().step(true)
    st().updStep(id, { on: true })
    expect(visibleIds()).toEqual(byPatch)
  })

  it('lets an enable through when it leaves enough, and when the step is a highlight', async () => {
    build([is('Level', 'L2')], [is('IfcEntity', 'IfcDoor')], 'hide')
    const ok = await run('manage_filters', { op: 'enable', step: 2 })
    expect(ok).toEqual({ message: 'Step 2 enabled.' })
    expect(steps()[1].on).toBe(true)
    expect(visible()).toBe(88)
    expect(turn.acted).toBe(true)

    // A highlight hides nothing, so it is exempt even in a view that is already under 5 %.
    resetShell()
    st().commitModels(full)
    build([is('IfcEntity', 'IfcStair')], [is('IfcEntity', 'IfcStair')], 'highlight')
    expect(visible()).toBe(3)
    expect((await run('manage_filters', { op: 'enable', step: 2 })).message).toBe('Step 2 enabled.')
    expect(turn.pending).toBeNull()
  })

  it('reports a step that is already on, or already off, without a second undo entry', async () => {
    build([is('IfcEntity', 'IfcWall')], [is('Level', 'L2')])
    const depth = historyDepth()
    const on = await run('manage_filters', { op: 'enable', step: 1 })
    expect(on.message).toBe('Step 1 is already enabled — nothing changed.')
    const off = await run('manage_filters', { op: 'disable', step: 2 })
    expect(off.message).toBe('Step 2 is already disabled — nothing changed.')
    expect(historyDepth()).toEqual(depth)
    expect(turn.acted).toBe(false)
    // Disable still disables — it can only reveal, so it is never held.
    expect((await run('manage_filters', { op: 'disable', step: 1 })).message).toBe('Step 1 disabled.')
    expect(visible()).toBe(412)
  })

  it('holds a recalled filter set that would leave under 5 %, and refuses one that would leave nothing', async () => {
    // Two sets the user saved from the Filter card.
    st().addStep('isolate', [is('IfcEntity', 'IfcStair')])
    st().saveFilterSet('stairs only')
    st().clearStack()
    st().addStep('isolate', [is('IfcEntity', 'IfcWall')])
    st().addStep('isolate', [is('IfcEntity', 'IfcWindow')])
    st().saveFilterSet('walls and windows')
    st().clearStack()
    Object.assign(turn, newTurnState())
    expect(visible()).toBe(412)

    const held = await run('manage_filters', { op: 'apply_set', name: 'stairs only' })
    expect(held).toMatchObject({
      applied: false,
      pending: true,
      wouldLeaveVisible: 3,
      totalElements: 412,
      name: 'stairs only'
    })
    expect(steps()).toEqual([])
    expect(turn.pending!.label).toBe('applying the filter set "stairs only" — leaves 3 of 412 visible')
    expect(Object.keys(turn.pending!.patch!).sort()).toEqual(['stack', 'stepSel'])
    // Apply leaves what the card's own "apply" leaves.
    st().up(turn.pending!.patch!)
    expect(visibleIds()).toEqual(STAIRS)
    st().step(true)
    st().applyFilterSet(st().filterSets.find((f) => f.label === 'stairs only')!)
    expect(visibleIds()).toEqual(STAIRS)

    st().clearStack()
    Object.assign(turn, newTurnState())
    const refused = await run('manage_filters', { op: 'apply_set', name: 'walls and windows' })
    expect(refused).toMatchObject({ applied: false, wouldLeaveVisible: 0, name: 'walls and windows' })
    expect(refused.message).toContain('Applying the filter set "walls and windows" would leave nothing visible, so it was not done.')
    expect(steps()).toEqual([])
    expect(turn.pending).toBeNull()
  })

  /**
   * `remove` and `move` go through the same guard and are exempt, because they cannot hide:
   * visibility is a conjunction of the enabled steps, so taking one away can only reveal and
   * reordering changes nothing. This is that proof, on every stack of three the mock allows.
   */
  it('exempts remove and move, which cannot hide — proved over every step and every order', async () => {
    const rules: [string, 'isolate' | 'hide' | 'highlight', Rule[]][] = [
      ['L2', 'isolate', [is('Level', 'L2')]],
      ['doors', 'hide', [is('IfcEntity', 'IfcDoor')]],
      ['walls', 'isolate', [is('IfcEntity', 'IfcWall')]],
      ['slabs', 'highlight', [is('IfcEntity', 'IfcSlab')]],
      ['ARC', 'isolate', [is('Model', 'ARC')]],
      ['windows', 'hide', [is('IfcEntity', 'IfcWindow')]]
    ]
    const seen = (stack: readonly FilterStep[]): Set<number> =>
      new Set(full.elements.filter(visFn({ ...st(), stack })).map((e) => e.id))
    let checked = 0
    for (const a of rules) for (const b of rules) for (const c of rules) {
      const stack = [a, b, c].map(([, action, r], i) => fstack.newStep([], action, r, undefined, `s${i}`))
      const before = seen(stack)
      for (const x of stack) {
        const after = seen(fstack.dropStep(stack, x.id).stack)
        // Removing a step never hides anything that was visible.
        for (const id of before) expect(after.has(id)).toBe(true)
        for (const d of [-2, -1, 1, 2]) {
          const moved = seen(fstack.moveStep(stack, x.id, d))
          expect(moved.size).toBe(before.size)
          for (const id of before) expect(moved.has(id)).toBe(true)
        }
        checked++
      }
    }
    expect(checked).toBe(6 * 6 * 6 * 3)

    // So in a view that is already under 5 % — the user's own doing — they are not held.
    st().addStep('isolate', [is('IfcEntity', 'IfcStair')])
    st().addStep('hide', [is('Level', 'L2')])
    Object.assign(turn, newTurnState())
    const few = visible()
    expect(few).toBeGreaterThan(0)
    expect(few / 412).toBeLessThan(SCOPE_GUARD)
    expect((await run('manage_filters', { op: 'move', step: 2, to: 1 })).message).toBe('Step 2 moved to position 1.')
    expect(visible()).toBe(few)
    expect((await run('manage_filters', { op: 'remove', step: 1 })).message).toBe('Step 1 removed. 1 left.')
    expect(visible()).toBe(3)
    expect(turn.pending).toBeNull()
  }, 20_000) // 216 stacks × 16 visibility passes: ~1.3 s alone, past vitest's 5 s default at full parallelism on a busy PC or a slower CI runner
})

/* ────────────────────────────── 7. one held change per turn ────────────────────────────── */

describe('one held change per turn', () => {
  const isolateStairs = (): Promise<Body> =>
    run('apply_visibility', { action: 'isolate', rules: [is('IfcEntity', 'IfcStair')] })

  it('refuses a second held change in words, and keeps the first behind its Apply button', async () => {
    const first = await isolateStairs()
    expect(first.pending).toBe(true)
    const waiting = turn.pending
    expect(waiting!.label).toBe('isolate 3 elements — leaves 3 of 412 visible')

    // A second change the guard would also hold — through three different tools.
    const seconds = [
      await run('set_models', { visible: ['MEP'] }),
      await run('apply_visibility', { action: 'isolate', ids: DOORS_L2 }),
      await run('set_filter_stack', { steps: [{ action: 'isolate', rules: [is('Model', 'MEP')] }] })
    ]
    for (const second of seconds) {
      expect(second).toEqual({
        message:
          'A request is already waiting for the user’s own click from earlier in this turn (isolate 3 elements — leaves 3 of 412 visible). Only one can wait at a time, so this one was not made and nothing was changed. Tell the user what is waiting; once they have answered it they can ask for this one again.',
        applied: false,
        pending: false,
        alreadyWaiting: 'isolate 3 elements — leaves 3 of 412 visible'
      })
    }
    // The first still has the slot — the very same entry — and nothing was applied.
    expect(turn.pending).toBe(waiting)
    expect(visible()).toBe(412)
    expect(st().modelVis).toEqual({})
    expect(st().stack).toEqual([])
  })

  it('still applies a change that needs no confirmation while one is waiting', async () => {
    await isolateStairs()
    const waiting = turn.pending
    const grid = await run('toggle_display', { groundGrid: false })
    expect(grid.changed).toEqual(['canvas grid off'])
    const walls = await run('select_elements', { rules: [is('IfcEntity', 'IfcWall')], zoom: false })
    expect(walls.selected).toBe(80)
    expect(turn.pending).toBe(waiting)
  })

  it('holds one again in the next turn', async () => {
    await isolateStairs()
    Object.assign(turn, newTurnState())
    const next = await run('set_models', { visible: ['MEP'] })
    expect(next.pending).toBe(true)
    expect(turn.pending!.label).toBe('show 1 of 4 models — leaves 8 of 412 visible')
  })

  it('oneHeld passes through everything that is not a second held change', () => {
    const held: ToolOutcome = { forModel: { pending: true }, ui: { pending: { label: 'b', patch: {} } } }
    const plain: ToolOutcome = { forModel: { message: 'x' }, ui: { acted: true } }
    const empty = newTurnState()
    expect(oneHeld(held, empty)).toBe(held)
    expect(oneHeld(plain, empty)).toBe(plain)
    const busy = { ...newTurnState(), pending: { label: 'a', patch: {} } }
    expect(oneHeld(plain, busy)).toBe(plain)
    // The second's chips survive; only its pending patch and its "Apply button" words go.
    const second: ToolOutcome = {
      forModel: { pending: true },
      ui: { pending: { label: 'b', patch: {} }, chips: [{ label: 'c', ids: [1] }] }
    }
    const out = oneHeld(second, busy)
    expect(out.ui).toEqual({ chips: [{ label: 'c', ids: [1] }] })
    expect((out.forModel as { alreadyWaiting: string }).alreadyWaiting).toBe('a')
  })
})
