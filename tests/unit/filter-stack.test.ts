/**
 * The filter stack, the undo history and the Filter card's derived values —
 * `src/shared/filter-stack.ts`, `src/shared/undo.ts` and
 * `src/renderer/state/selectors/filter.ts`, against `SGVue.dc.html:949–1032` and `:1876–2007`.
 *
 * The two properties worth stating out loud, because they are what the stack is *for*:
 * visibility is a conjunction and therefore order-independent, and highlight colour is not.
 *
 * 2026-10-02: the undo history gained a reader, `peek(back)` — what a step would restore,
 * without taking it — for the assistant's undo and redo; one case, beside the history's own.
 */
import { describe, expect, it } from 'vitest'
import { HL } from '../../src/shared/colors'
import {
  FILTER_SETS_CAP,
  applyFilterSet,
  curStep,
  dropStep,
  filterIsLive,
  filterSetLabel,
  forgottenBySave,
  liveRules,
  moveStep,
  newStep,
  saveFilterSet,
  stepLabel,
  updStep,
  type FilterSet
} from '../../src/shared/filter-stack'
import {
  ABSENT_LABEL,
  ABSENT_LABEL_SHORT,
  hlFn,
  matchFn,
  ruleText,
  visFn,
  type FilterStep,
  type Rule
} from '../../src/shared/rules'
import { createUndoHistory, snapVis, UNDO_CAP, VIS_KEYS } from '../../src/shared/undo'
import { federate } from '../../src/shared/federate'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import {
  VALUE_LIST_CAP,
  actionFlags,
  elementColors,
  hlColorChips,
  matchCount,
  ruleRows,
  stackRows,
  stepTitle,
  stepToggle,
  valueOptions
} from '../../src/renderer/state/selectors/filter'

const fed = federate([mockModelIndex('ARC'), mockModelIndex('STR')])
const els = fed.elements

/** A deterministic id factory, so a test can name the steps it made. */
const ids = (): (() => string) => {
  let n = 0
  return () => `s${++n}`
}

const rule = (prop: string, val: string, join: Rule['join'] = 'and'): Rule => ({
  prop,
  op: '=',
  val,
  join
})

const step = (over: Partial<FilterStep> = {}): FilterStep => ({
  id: 'x',
  on: true,
  action: 'isolate',
  color: HL[0],
  rules: [rule('IfcEntity', 'IfcWall')],
  ...over
})

describe('filter-stack — step operations', () => {
  it('auto-picks the next unused highlight colour, then walks the palette round', () => {
    const stack: FilterStep[] = []
    // Six steps take the six palette colours in order.
    for (let i = 0; i < HL.length; i++) stack.push(newStep(stack, 'highlight', undefined, undefined, `s${i}`))
    expect(stack.map((x) => x.color)).toEqual([...HL])
    // The seventh has nothing unused left, so it is `HL[used.length % HL.length]` — `:954`.
    expect(newStep(stack, 'highlight', undefined, undefined, 's6').color).toBe(HL[6 % HL.length])
    // A gap in the middle is filled before the palette wraps.
    const withGap = stack.filter((x) => x.color !== HL[2])
    expect(newStep(withGap, 'highlight', undefined, undefined, 'g').color).toBe(HL[2])
  })

  it('an explicit colour wins over the auto-pick', () => {
    expect(newStep([], 'highlight', undefined, '#123456', 'a').color).toBe('#123456')
  })

  it('a new step starts on, isolating, with one empty IfcEntity rule', () => {
    const st = newStep([], undefined, undefined, undefined, 'a')
    expect(st).toMatchObject({ id: 'a', on: true, action: 'isolate' })
    expect(st.rules).toEqual([{ prop: 'IfcEntity', op: '=', val: '', join: 'and' }])
  })

  it('curStep is the selected step, else the first, else nothing', () => {
    const a = step({ id: 'a' })
    const b = step({ id: 'b' })
    expect(curStep([a, b], 'b')).toBe(b)
    expect(curStep([a, b], null)).toBe(a)
    // A selection that no longer exists falls back to the first, not to nothing.
    expect(curStep([a, b], 'gone')).toBe(a)
    expect(curStep([], 'a')).toBe(null)
  })

  it('updStep patches one step and leaves the others identical', () => {
    const a = step({ id: 'a' })
    const b = step({ id: 'b' })
    const next = updStep([a, b], 'a', { on: false })
    expect(next[0]).toMatchObject({ id: 'a', on: false, action: 'isolate' })
    expect(next[1]).toBe(b)
  })

  it('moveStep reorders, and does nothing at either end', () => {
    const s = ['a', 'b', 'c'].map((id) => step({ id }))
    expect(moveStep(s, 'a', 1).map((x) => x.id)).toEqual(['b', 'a', 'c'])
    expect(moveStep(s, 'c', -1).map((x) => x.id)).toEqual(['a', 'c', 'b'])
    expect(moveStep(s, 'a', -1).map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(moveStep(s, 'c', 1).map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(moveStep(s, 'nope', 1).map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })

  it('dropStep selects the last step that is left, and null when none is', () => {
    const s = ['a', 'b', 'c'].map((id) => step({ id }))
    expect(dropStep(s, 'b')).toMatchObject({ stepSel: 'c' })
    expect(dropStep(s, 'b').stack.map((x) => x.id)).toEqual(['a', 'c'])
    expect(dropStep([step({ id: 'a' })], 'a')).toEqual({ stack: [], stepSel: null })
  })

  it('stepLabel reads the live rules and their joins, and says so when there are none', () => {
    expect(stepLabel(step({ rules: [] }))).toBe('no conditions')
    expect(stepLabel(step({ rules: [rule('IfcEntity', '')] }))).toBe('no conditions')
    expect(
      stepLabel(
        step({
          rules: [rule('IfcEntity', 'IfcWall'), rule('Level', 'L2'), rule('Level', 'L3', 'or')]
        })
      )
    ).toBe('IfcEntity = IfcWall and Level = L2 or Level = L3')
  })

  it('filterIsLive is any step switched on, highlight steps included', () => {
    expect(filterIsLive([])).toBe(false)
    expect(filterIsLive([step({ on: false })])).toBe(false)
    expect(filterIsLive([step({ on: false }), step({ id: 'b', action: 'highlight' })])).toBe(true)
  })
})

describe('filter-stack — saved sets', () => {
  it('names a set after its first live step and counts the rest', () => {
    const one = step({ rules: [rule('IfcEntity', 'IfcWall')] })
    expect(filterSetLabel([one])).toBe('isolate IfcEntity = IfcWall')
    expect(filterSetLabel([one, one])).toBe('isolate IfcEntity = IfcWall +1 step')
    expect(filterSetLabel([one, one, one])).toBe('isolate IfcEntity = IfcWall +2 steps')
  })

  it('saves only steps that carry a value, and refuses a stack with none', () => {
    expect(saveFilterSet([], [step({ rules: [rule('IfcEntity', '')] })])).toBe(null)
    const saved = saveFilterSet([], [step({ rules: [rule('IfcEntity', '')] }), step({ id: 'b' })], 7)
    expect(saved).toHaveLength(1)
    expect(saved![0]).toMatchObject({ id: 7, label: 'isolate IfcEntity = IfcWall' })
    expect(saved![0].stack.map((x) => x.id)).toEqual(['b'])
  })

  it('replaces a set with the same label instead of adding a second', () => {
    const first = saveFilterSet([], [step()], 1)!
    const again = saveFilterSet(first, [step()], 2)!
    expect(again).toHaveLength(1)
    expect(again[0].id).toBe(2)
  })

  it('keeps the last twelve', () => {
    let sets: FilterSet[] = []
    for (let i = 0; i < 20; i++) {
      sets = saveFilterSet(sets, [step({ rules: [rule('Name', `w${i}`)] })], i)!
    }
    expect(sets).toHaveLength(FILTER_SETS_CAP)
    expect(sets[0].label).toBe('isolate Name = w8')
    expect(sets[FILTER_SETS_CAP - 1].label).toBe('isolate Name = w19')
  })

  /**
   * 2026-10-02 — which sets a save would forget. Both of the rules above take a saved set away,
   * and the assistant's `save_set` waits for the user whenever this is not empty.
   */
  it('says which sets a save would forget: the one of the same name, or the oldest of twelve', () => {
    const named = (label: string, id: number): FilterSet => ({ id, label, stack: [step()] })
    const two = [named('a', 1), named('b', 2)]
    // A new name with room to spare only adds.
    expect(forgottenBySave(two, [step()], 'c')).toEqual([])
    expect(forgottenBySave([], [step()], 'c')).toEqual([])
    // The same name: that set, and no other.
    expect(forgottenBySave(two, [step()], 'b')).toEqual([two[1]])
    // No name given is the card's own label, which can be one that is already saved.
    const derived = named(filterSetLabel([step()]), 3)
    expect(forgottenBySave([...two, derived], [step()])).toEqual([derived])
    // Twelve saved and a new name: the oldest.
    const full = Array.from({ length: FILTER_SETS_CAP }, (_, i) => named(`s${i}`, i + 1))
    expect(forgottenBySave(full, [step()], 'new')).toEqual([full[0]])
    // Twelve saved and one of their names: only that one — nothing is pushed out.
    expect(forgottenBySave(full, [step()], 's5')).toEqual([full[5]])
    // Nothing to save forgets nothing.
    expect(forgottenBySave(full, [step({ rules: [rule('IfcEntity', '')] })], 'new')).toEqual([])
    // A list that somehow holds a name twice loses both, and this says so.
    const twice = [named('a', 1), named('a', 2), named('b', 3)]
    expect(forgottenBySave(twice, [step()], 'a')).toEqual([twice[0], twice[1]])
  })

  it('agrees with what a save then does, for every list length and both kinds of name', () => {
    for (let n = 0; n <= FILTER_SETS_CAP; n++) {
      const sets: FilterSet[] = Array.from({ length: n }, (_, i) => ({ id: i + 1, label: `s${i}`, stack: [step()] }))
      for (const label of ['new', 's0', `s${n - 1}`]) {
        const gone = forgottenBySave(sets, [step()], label)
        const after = saveFilterSet(sets, [step()], 99, label)!
        // Exactly the sets it named are missing afterwards, and every other is the same object.
        expect(sets.filter((f) => !after.includes(f))).toEqual(gone)
        expect(after.filter((f) => f.id !== 99).every((f) => sets.includes(f))).toBe(true)
      }
    }
  })

  it('applying a set switches every step on and gives each a fresh id and colour', () => {
    const saved: FilterSet = {
      id: 1,
      label: 'x',
      stack: [
        step({ id: 'old1', on: false, action: 'highlight', color: HL[3] }),
        step({ id: 'old2', on: false, action: 'hide' })
      ]
    }
    const { stack, stepSel } = applyFilterSet(saved, ids())
    expect(stack.map((x) => x.id)).toEqual(['s1', 's2'])
    expect(stack.every((x) => x.on)).toBe(true)
    expect(stack.map((x) => x.action)).toEqual(['highlight', 'hide'])
    // Colours are re-picked, and — unlike the prototype, which reads the *live* stack for
    // every step of the map and hands them all the same colour — they come out distinct.
    expect(stack.map((x) => x.color)).toEqual([HL[0], HL[1]])
    expect(stepSel).toBe('s2')
  })

  it('reads a set saved before the stack existed', () => {
    const legacy: FilterSet = { id: 1, label: 'x', stack: undefined as never, mode: 'hide', rules: [rule('Level', 'L2')] }
    const { stack } = applyFilterSet(legacy, ids())
    expect(stack).toHaveLength(1)
    expect(stack[0]).toMatchObject({ action: 'hide', on: true })
    expect(stack[0].rules).toEqual([rule('Level', 'L2')])
  })
})

describe('visibility is order-independent, highlight colour is not', () => {
  const isolateL2 = step({ id: 'a', action: 'isolate', rules: [rule('Level', 'L2')] })
  const hideWindows = step({ id: 'b', action: 'hide', rules: [rule('IfcEntity', 'IfcWindow')] })

  it('isolate then hide gives exactly the same visible set as hide then isolate', () => {
    const base = { hidden: {}, modelVis: {}, storeyVis: {} }
    const one = visFn({ ...base, stack: [isolateL2, hideWindows] })
    const other = visFn({ ...base, stack: [hideWindows, isolateL2] })
    const a = els.filter(one).map((e) => e.id)
    const b = els.filter(other).map((e) => e.id)
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(0)
    expect(a.length).toBeLessThan(els.length)
  })

  it('a disabled step stops constraining, so step 2 re-expands', () => {
    const base = { hidden: {}, modelVis: {}, storeyVis: {} }
    const both = els.filter(visFn({ ...base, stack: [isolateL2, hideWindows] })).length
    const off = els.filter(
      visFn({ ...base, stack: [{ ...isolateL2, on: false }, hideWindows] })
    ).length
    expect(off).toBeGreaterThan(both)
  })

  it('where two highlight steps overlap the later one wins', () => {
    const all = step({ id: 'h1', action: 'highlight', color: HL[0], rules: [rule('Level', 'L2')] })
    const walls = step({
      id: 'h2',
      action: 'highlight',
      color: HL[2],
      rules: [rule('IfcEntity', 'IfcWall')]
    })
    const vis = (): boolean => true
    const wallOnL2 = els.find((e) => e.type === 'IfcWall' && e.storey === 'L2')!

    expect(elementColors(els, [all, walls], vis)[wallOnL2.id]).toBe(HL[2])
    expect(elementColors(els, [walls, all], vis)[wallOnL2.id]).toBe(HL[0])
  })

  it('a highlight step colours only what is visible, and only while it is on', () => {
    const walls = step({ id: 'h', action: 'highlight', color: HL[1], rules: [rule('IfcEntity', 'IfcWall')] })
    const wall = els.find((e) => e.type === 'IfcWall')!
    const visible = visFn({ hidden: { [wall.id]: true }, modelVis: {}, storeyVis: {} })
    expect(elementColors(els, [walls], visible)[wall.id]).toBeUndefined()
    expect(elementColors(els, [{ ...walls, on: false }], () => true)).toEqual({})
    // …and an isolate step never writes a colour at all.
    expect(elementColors(els, [{ ...walls, action: 'isolate' }], () => true)).toEqual({})
  })

  it('hlFn matches any enabled highlight step, and is null when there is none', () => {
    const walls = step({ id: 'h', action: 'highlight', rules: [rule('IfcEntity', 'IfcWall')] })
    const base = { hidden: {}, modelVis: {}, storeyVis: {} }
    expect(hlFn({ ...base, stack: [] })).toBe(null)
    expect(hlFn({ ...base, stack: [{ ...walls, on: false }] })).toBe(null)
    const hl = hlFn({ ...base, stack: [walls] })!
    expect(els.filter(hl).every((e) => e.type === 'IfcWall')).toBe(true)
  })
})

describe('the Filter card’s derived values', () => {
  it('a step row carries its number, label, live count and a fixed ink on the badge', () => {
    const walls = step({ id: 'a', action: 'highlight', color: HL[2] })
    const [row] = stackRows([walls], els, 'a')
    expect(row).toMatchObject({ n: '1', label: 'IfcEntity = IfcWall', action: 'highlight' })
    expect(row.count).toBe(String(els.filter(matchFn(walls.rules)!).length))
    // Pitfall 7: the HL palette is fixed hex in both themes, so its ink must be too.
    expect(row.aFg).toBe('#0F1516')
    expect(row.aBg).toBe(HL[2])
    expect(row.edge).toBe('var(--accent)')
    expect(row.opacity).toBe(1)
  })

  it('an isolate or hide badge uses theme tokens, and a disabled step goes faint', () => {
    const [iso] = stackRows([step({ id: 'a' })], els, null)
    expect(iso).toMatchObject({ aFg: 'var(--sel-ink)', aBg: 'var(--sel-bg)', eyeFg: 'var(--accent-ink)' })
    const [off] = stackRows([step({ id: 'a', on: false, action: 'highlight' })], els, null)
    expect(off).toMatchObject({
      aFg: 'var(--faint)',
      aBg: 'var(--step-bg)',
      eyeFg: 'var(--faint)',
      opacity: 0.45
    })
  })

  it('a step with no conditions matches nothing and says so', () => {
    const [row] = stackRows([step({ rules: [rule('IfcEntity', '')] })], els, null)
    expect(row).toMatchObject({ label: 'no conditions', count: '0' })
  })

  it('the value list is the distinct values of that property, sorted and capped at 60', () => {
    const entities = valueOptions(els, 'IfcEntity')
    expect(entities).toEqual([...entities].sort())
    expect(new Set(entities).size).toBe(entities.length)
    expect(entities).toContain('IfcWall')
    // A key only some elements carry still lists the values of the ones that do.
    expect(valueOptions(els, 'FireRating')).toContain('2 HR')
    // A key nothing carries lists nothing, rather than throwing.
    expect(valueOptions(els, 'NoSuchKey')).toEqual([])
    const many = valueOptions(els, 'Name')
    expect(many).toHaveLength(VALUE_LIST_CAP)
  })

  it('a rule row knows its datalist, its place and its join label', () => {
    const rows = ruleRows([rule('IfcEntity', 'IfcWall'), rule('Level', 'L2', 'or')], els)
    expect(rows[0]).toMatchObject({ listId: 'fv0', first: true, notFirst: false, joinLabel: 'AND' })
    expect(rows[1]).toMatchObject({ listId: 'fv1', first: false, notFirst: true, joinLabel: 'OR' })
    expect(rows[0].values).toEqual(valueOptions(els, 'IfcEntity'))
  })

  it('the title, the action control and the on/off pill follow the selected step', () => {
    const a = step({ id: 'a' })
    const b = step({ id: 'b', action: 'hide', on: false })
    expect(stepTitle([a, b], b)).toBe('Step 2 conditions')
    expect(stepTitle([a, b], null)).toBe('')
    expect(actionFlags(a).isolate.fg).toBe('var(--sel-ink)')
    expect(actionFlags(a).hide.fg).toBe('var(--muted)')
    expect(actionFlags(null).highlight.fg).toBe('var(--muted)')
    expect(stepToggle(a)).toMatchObject({ label: 'step on', line: 'var(--accent)' })
    expect(stepToggle(b)).toMatchObject({ label: 'step off', line: 'var(--border)' })
    expect(stepToggle(null).label).toBe('step off')
  })

  it('the colour chips ring the step’s own colour', () => {
    const chips = hlColorChips(step({ color: HL[3] }))
    expect(chips).toHaveLength(HL.length)
    expect(chips.filter((c) => c.ring === 'var(--ink)').map((c) => c.c)).toEqual([HL[3]])
    expect(hlColorChips(null).every((c) => c.ring === 'transparent')).toBe(true)
  })

  it('matchCount is federation-wide, not scoped by activate mode', () => {
    const arcWalls = step({ rules: [rule('IfcEntity', 'IfcWall')] })
    const n = matchCount(arcWalls, els)
    expect(n).toBe(els.filter((e) => e.type === 'IfcWall').length)
    expect(matchCount(null, els)).toBe(0)
  })
})

describe('undo history', () => {
  it('snapshots exactly the five VIS_KEYS and nothing else', () => {
    const state = {
      hidden: { 1: true },
      storeyVis: {},
      modelVis: {},
      stack: [],
      active: 'ARC',
      sel: 7,
      theme: 'light'
    }
    const snap = JSON.parse(snapVis(state))
    expect(Object.keys(snap)).toEqual([...VIS_KEYS])
    expect(snap.sel).toBeUndefined()
    expect(snap.theme).toBeUndefined()
  })

  it('a push clears the redo branch', () => {
    const h = createUndoHistory()
    h.push('a')
    h.step(true, 'b')
    expect(h.canRedo).toBe(true)
    h.push('c')
    expect(h.canRedo).toBe(false)
  })

  it('undo and redo walk the same chain back and forth', () => {
    const h = createUndoHistory()
    h.push('s0')
    h.push('s1')
    expect(h.step(true, 's2')).toMatchObject({ snap: 's1', canUndo: true, canRedo: true })
    expect(h.step(true, 's1')).toMatchObject({ snap: 's0', canUndo: false, canRedo: true })
    expect(h.step(true, 's0')).toBe(null)
    expect(h.step(false, 's0')).toMatchObject({ snap: 's1', canUndo: true, canRedo: true })
    expect(h.step(false, 's1')).toMatchObject({ snap: 's2', canUndo: true, canRedo: false })
    expect(h.step(false, 's2')).toBe(null)
  })

  it('caps at fifty and drops the oldest', () => {
    const h = createUndoHistory()
    for (let i = 0; i < UNDO_CAP + 20; i++) h.push(`s${i}`)
    expect(h.depth().undo).toBe(UNDO_CAP)
    // The newest is still on top…
    expect(h.step(true, 'now')!.snap).toBe(`s${UNDO_CAP + 19}`)
    // …and the oldest reachable one is `s20`, not `s0`.
    for (let i = 0; i < UNDO_CAP - 2; i++) h.step(true, 'x')
    expect(h.step(true, 'x')!.snap).toBe('s20')
    expect(h.canUndo).toBe(false)
  })

  it('a long redo chain cannot grow the undo stack past the cap either', () => {
    const h = createUndoHistory(3)
    for (let i = 0; i < 3; i++) h.push(`s${i}`)
    for (let i = 0; i < 3; i++) h.step(true, 'x')
    expect(h.depth()).toEqual({ undo: 0, redo: 3 })
    for (let i = 0; i < 3; i++) h.step(false, 'y')
    expect(h.depth()).toEqual({ undo: 3, redo: 0 })
  })

  it('reset empties both sides', () => {
    const h = createUndoHistory()
    h.push('a')
    h.step(true, 'b')
    h.reset()
    expect(h.depth()).toEqual({ undo: 0, redo: 0 })
  })

  /**
   * 2026-10-02. The assistant's undo and redo ask what a step would restore before taking it,
   * so that the scope guard can decide on it. A read: neither stack moves.
   */
  it('peek reads the snapshot a step would apply, and moves nothing', () => {
    const h = createUndoHistory()
    expect(h.peek(true)).toBe(null)
    expect(h.peek(false)).toBe(null)
    h.push('s0')
    h.push('s1')
    expect(h.peek(true)).toBe('s1')
    expect(h.peek(false)).toBe(null)
    expect(h.depth()).toEqual({ undo: 2, redo: 0 })
    // What peek said is what step applies.
    expect(h.step(true, 's2')!.snap).toBe('s1')
    expect(h.peek(true)).toBe('s0')
    expect(h.peek(false)).toBe('s2')
    expect(h.depth()).toEqual({ undo: 1, redo: 1 })
    expect(h.step(false, 's1')!.snap).toBe('s2')
    expect(h.peek(false)).toBe(null)
  })
})

/* ══════════════════════════ 2026-09-20 — the absent operator and named sets ══════════════════════════ */

describe('a step built on `absent`', () => {
  const absentStep = (over: Partial<FilterStep> = {}): FilterStep =>
    step({ rules: [{ prop: 'FireRating', op: 'absent', val: '' }], ...over })

  /**
   * Two lengths, one operator (2026-09-20). The Filter card's operator `<select>` is 64 px —
   * the design's own grid column — so the control's own text is the short label; everywhere
   * with room for the phrase gets the phrase, which is what a person reads back.
   */
  it('reads as the phrase wherever there is room for it', () => {
    expect(ABSENT_LABEL).toBe('is empty')
    expect(ABSENT_LABEL_SHORT).toBe('empty')
    expect(stepLabel(absentStep())).toBe(`FireRating ${ABSENT_LABEL}`)
    expect(ruleText({ prop: 'FireRating', op: 'absent', val: '' })).toBe('FireRating is empty')
    // No trailing value, and no bare token: `FireRating absent ` would be the naive render.
    expect(stepLabel(absentStep())).not.toContain('absent')
    expect(stepLabel(absentStep())).not.toMatch(/\s$/)
    // The short label is what fits, and it is a prefix of the phrase — so the two cannot
    // drift into saying different things.
    expect(ABSENT_LABEL.endsWith(ABSENT_LABEL_SHORT)).toBe(true)
    expect(ABSENT_LABEL_SHORT.length).toBeLessThan('contains'.length)
  })

  it('joins with an ordinary rule in the label, in the design’s own shape', () => {
    const both = step({
      rules: [
        { prop: 'IfcEntity', op: '=', val: 'IfcWall', join: 'and' },
        { prop: 'FireRating', op: 'absent', val: '' }
      ]
    })
    expect(stepLabel(both)).toBe('IfcEntity = IfcWall and FireRating is empty')
  })

  it('counts as a live step, so it is saveable and the toolbar lights for it', () => {
    expect(liveRules(absentStep())).toHaveLength(1)
    expect(filterIsLive([absentStep()])).toBe(true)
    const saved = saveFilterSet([], [absentStep()], 1)
    expect(saved).toHaveLength(1)
    expect(saved![0].label).toBe('isolate FireRating is empty')
  })

  it('survives a save and an apply, rule for rule', () => {
    const saved = saveFilterSet([], [absentStep({ action: 'hide' })], 1)!
    const { stack } = applyFilterSet(saved[0], ids())
    expect(stack[0].rules).toEqual([{ prop: 'FireRating', op: 'absent', val: '' }])
    expect(stack[0].action).toBe('hide')
  })

  it('leaves the card’s value field inert, and only for this operator', () => {
    const rows = ruleRows(
      [
        { prop: 'FireRating', op: 'absent', val: '' },
        { prop: 'IfcEntity', op: '=', val: 'IfcWall' }
      ],
      els
    )
    expect(rows.map((r) => r.valueUnused)).toEqual([true, false])
  })
})

describe('saveFilterSet under a name', () => {
  it('uses the name instead of the derived label, and keeps every other rule', () => {
    const saved = saveFilterSet([], [step()], 1, 'L3 minus windows')!
    expect(saved[0].label).toBe('L3 minus windows')
    expect(saved[0].stack.map((x) => x.action)).toEqual(['isolate'])
  })

  it('trims the name, and falls back to the derived label when it is blank', () => {
    expect(saveFilterSet([], [step()], 1, '  padded  ')![0].label).toBe('padded')
    expect(saveFilterSet([], [step()], 1, '   ')![0].label).toBe('isolate IfcEntity = IfcWall')
  })

  it('replaces a set of the same name, and still keeps only twelve', () => {
    const first = saveFilterSet([], [step()], 1, 'mine')!
    const again = saveFilterSet(first, [step({ action: 'hide' })], 2, 'mine')!
    expect(again).toHaveLength(1)
    expect(again[0]).toMatchObject({ id: 2, label: 'mine' })
    let sets: FilterSet[] = []
    for (let i = 0; i < 20; i++) sets = saveFilterSet(sets, [step()], i, `set ${i}`)!
    expect(sets).toHaveLength(FILTER_SETS_CAP)
    expect(sets[0].label).toBe('set 8')
  })

  it('still refuses a stack with nothing in it', () => {
    expect(saveFilterSet([], [step({ rules: [rule('IfcEntity', '')] })], 1, 'mine')).toBe(null)
  })
})
