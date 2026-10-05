/**
 * The filter rules, against the design's own semantics (`SGVue.dc.html:938–1001`).
 *
 * The last test is a property test, and it pins the asymmetry the filter stack is built on:
 * isolate/hide steps commute (visibility is a conjunction of independent predicates), while
 * highlight does not — `applyColors` walks the stack in order and the later step wins.
 */
import { describe, expect, it } from 'vitest'
import {
  hlFn,
  isLiveRule,
  matchFn,
  visFn,
  type FilterStep,
  type Rule,
  type VisElement
} from '../../src/shared/rules'

let nextId = 1
const el = (over: Partial<VisElement> = {}): VisElement => ({
  id: nextId++,
  model: 'ARC',
  type: 'IfcWall',
  predefinedType: 'SOLIDWALL',
  objectType: 'EW 200 Brick',
  storey: 'L2',
  name: 'Ext Wall S',
  material: 'Clay brick',
  psets: { Pset_WallCommon: { FireRating: '1 HR', IsExternal: true, Thickness: '300mm' } },
  qto: { Qto_WallBaseQuantities: { Length: 5600 } },
  ...over
})

const rule = (prop: string, op: Rule['op'], val: Rule['val'], join: Rule['join'] = 'and'): Rule => ({
  prop,
  op,
  val,
  join
})

const state = (stack: FilterStep[] = [], over: Partial<Parameters<typeof visFn>[0]> = {}) => ({
  hidden: {},
  modelVis: {},
  storeyVis: {},
  stack,
  ...over
})

const step = (
  id: string,
  action: FilterStep['action'],
  rules: Rule[],
  color?: string
): FilterStep => ({ id, on: true, action, rules, color })

describe('matchFn', () => {
  it('returns null when no rule carries a value', () => {
    expect(matchFn([])).toBeNull()
    expect(matchFn([rule('IfcEntity', '=', '')])).toBeNull()
    expect(matchFn([rule('IfcEntity', '=', null)])).toBeNull()
  })

  it('compares text case-insensitively for = and !=', () => {
    const wall = el()
    expect(matchFn([rule('IfcEntity', '=', 'ifcwall')])!(wall)).toBe(true)
    expect(matchFn([rule('IfcEntity', '=', 'IfcSlab')])!(wall)).toBe(false)
    expect(matchFn([rule('IfcEntity', '!=', 'IfcSlab')])!(wall)).toBe(true)
  })

  it('matches ~ as a substring', () => {
    expect(matchFn([rule('Name', '~', 'wall s')])!(el())).toBe(true)
    expect(matchFn([rule('Name', '~', 'roof')])!(el())).toBe(false)
  })

  it('compares numerically only when the rule value is a bare number', () => {
    const wall = el()
    expect(matchFn([rule('Length', '>', 5000)])!(wall)).toBe(true)
    expect(matchFn([rule('Length', '<', 5000)])!(wall)).toBe(false)
    expect(matchFn([rule('Length', '=', '5600')])!(wall)).toBe(true)
    // "300mm" is not a bare number, so Thickness compares as text and > is false.
    expect(matchFn([rule('Thickness', '>', '200mm')])!(wall)).toBe(false)
    expect(matchFn([rule('Thickness', '=', '300MM')])!(wall)).toBe(true)
  })

  it('matches a missing attribute only with !=', () => {
    const wall = el()
    for (const op of ['=', '~', '>', '<'] as const) {
      expect(matchFn([rule('Nonexistent', op, 'anything')])!(wall), op).toBe(false)
    }
    expect(matchFn([rule('Nonexistent', '!=', 'anything')])!(wall)).toBe(true)
  })

  it('binds OR looser than AND', () => {
    const wall = el()
    // (IfcEntity = IfcSlab) or (IfcEntity = IfcWall and Level = L2) → true
    const looser = matchFn([
      rule('IfcEntity', '=', 'IfcSlab'),
      rule('IfcEntity', '=', 'IfcWall', 'or'),
      rule('Level', '=', 'L2')
    ])!
    expect(looser(wall)).toBe(true)
    // The same rules with the second group's AND failing → false.
    expect(looser(el({ storey: 'L3' }))).toBe(false)
  })
})

describe('visFn', () => {
  it('hides by hand, by model and by storey', () => {
    const wall = el()
    expect(visFn(state())(wall)).toBe(true)
    expect(visFn(state([], { hidden: { [wall.id]: true } }))(wall)).toBe(false)
    expect(visFn(state([], { modelVis: { ARC: false } }))(wall)).toBe(false)
    expect(visFn(state([], { storeyVis: { L2: false } }))(wall)).toBe(false)
    // Only an explicit `false` hides — an absent key means visible.
    expect(visFn(state([], { modelVis: { STR: false } }))(wall)).toBe(true)
  })

  it('applies isolate and hide steps, and ignores steps that are off', () => {
    const wall = el()
    const slab = el({ type: 'IfcSlab' })
    const isolateWalls = step('a', 'isolate', [rule('IfcEntity', '=', 'IfcWall')])
    expect(visFn(state([isolateWalls]))(wall)).toBe(true)
    expect(visFn(state([isolateWalls]))(slab)).toBe(false)
    expect(visFn(state([{ ...isolateWalls, on: false }]))(slab)).toBe(true)

    const hideWalls = step('b', 'hide', [rule('IfcEntity', '=', 'IfcWall')])
    expect(visFn(state([hideWalls]))(wall)).toBe(false)
  })

  it('ignores highlight steps', () => {
    const slab = el({ type: 'IfcSlab' })
    expect(visFn(state([step('c', 'highlight', [rule('IfcEntity', '=', 'IfcWall')])]))(slab)).toBe(
      true
    )
  })
})

describe('hlFn', () => {
  it('is null with no active highlight step, and matches any of them otherwise', () => {
    expect(hlFn(state())).toBeNull()
    expect(hlFn(state([step('a', 'isolate', [rule('IfcEntity', '=', 'IfcWall')])]))).toBeNull()
    const hl = hlFn(
      state([
        step('a', 'highlight', [rule('IfcEntity', '=', 'IfcWall')]),
        step('b', 'highlight', [rule('IfcEntity', '=', 'IfcSlab')])
      ])
    )!
    expect(hl(el())).toBe(true)
    expect(hl(el({ type: 'IfcSlab' }))).toBe(true)
    expect(hl(el({ type: 'IfcDoor' }))).toBe(false)
  })
})

describe('order (property test)', () => {
  // A small deterministic PRNG, so a failure is reproducible.
  const rng = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0x100000000
  }

  const TYPES = ['IfcWall', 'IfcSlab', 'IfcDoor', 'IfcColumn']
  const LEVELS = ['L1', 'L2', 'L3']
  const MODELS = ['ARC', 'STR']

  const permutations = <T>(items: T[]): T[][] =>
    items.length <= 1
      ? [items]
      : items.flatMap((item, i) =>
          permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest])
        )

  it('visFn gives the same visibility for any order of isolate/hide steps', () => {
    const random = rng(20260916)
    for (let trial = 0; trial < 200; trial++) {
      const elements = Array.from({ length: 12 }, () =>
        el({
          type: TYPES[Math.floor(random() * TYPES.length)],
          storey: LEVELS[Math.floor(random() * LEVELS.length)],
          model: MODELS[Math.floor(random() * MODELS.length)]
        })
      )
      const stack = Array.from({ length: 3 }, (_, i) =>
        step(
          `s${i}`,
          random() < 0.5 ? 'isolate' : 'hide',
          [
            rule(
              ['IfcEntity', 'Level', 'Model'][Math.floor(random() * 3)],
              random() < 0.5 ? '=' : '!=',
              [...TYPES, ...LEVELS, ...MODELS][Math.floor(random() * 9)]
            )
          ]
        )
      )
      const baseline = elements.map(visFn(state(stack)))
      for (const order of permutations(stack)) {
        expect(elements.map(visFn(state(order)))).toEqual(baseline)
      }
    }
  })

  it('highlight precedence depends on stack order — the later step wins', () => {
    const wall = el()
    // Both steps match the same wall; the design resolves the overlap to the later colour.
    const red = step('a', 'highlight', [rule('IfcEntity', '=', 'IfcWall')], '#f00')
    const blue = step('b', 'highlight', [rule('Level', '=', 'L2')], '#00f')
    const colorOf = (stack: FilterStep[]): string | undefined =>
      stack
        .filter((s) => s.on && s.action === 'highlight')
        .filter((s) => matchFn(s.rules)?.(wall))
        .at(-1)?.color

    expect(colorOf([red, blue])).toBe('#00f')
    expect(colorOf([blue, red])).toBe('#f00')
    // hlFn itself only answers "is it highlighted", which does not depend on order.
    expect(hlFn(state([red, blue]))!(wall)).toBe(hlFn(state([blue, red]))!(wall))
  })
})

/* ══════════════════════════ 2026-09-20 — the `absent` operator ══════════════════════════ */

/**
 * The one operator the design does not have, and the reason it had to exist: on the reference
 * model 2 767 of 3 314 walls carry no `FireRating` at all, and `!=` — the only operator a
 * missing attribute matched — also matches every wall whose rating is merely *different*.
 */
describe('absent', () => {
  const noRating = el({ psets: { Pset_WallCommon: { IsExternal: true } } })
  const emptyRating = el({ psets: { Pset_WallCommon: { FireRating: '' } } })
  const blankRating = el({ psets: { Pset_WallCommon: { FireRating: '   ' } } })
  const rated = el({ psets: { Pset_WallCommon: { FireRating: '2 HR' } } })
  const zero = el({ psets: { Pset_WallCommon: { FireRating: 0 } } })
  const absent = matchFn([rule('FireRating', 'absent', '')])!

  it('matches a missing key, an empty string and a whitespace string', () => {
    expect([noRating, emptyRating, blankRating].map(absent)).toEqual([true, true, true])
  })

  it('does not match an authored value, including a falsy one', () => {
    expect([rated, zero].map(absent)).toEqual([false, false])
    // The zero is the point: "no value" is not "a value of nothing".
    expect(absent(el({ psets: { Pset_WallCommon: { FireRating: false } } }))).toBe(false)
  })

  it('is the question `!=` cannot ask', () => {
    const ne = matchFn([rule('FireRating', '!=', '2 HR')])!
    // `!=` says yes to both, which is why the audit called this a gap rather than a nicety.
    expect([noRating, el({ psets: { P: { FireRating: '1 HR' } } })].map(ne)).toEqual([true, true])
    expect([noRating, el({ psets: { P: { FireRating: '1 HR' } } })].map(absent)).toEqual([
      true,
      false
    ])
  })

  it('counts as a live rule although it carries no value', () => {
    // Every other operator with a blank value is dropped, and the whole list with it.
    expect(matchFn([rule('FireRating', '=', '')])).toBeNull()
    expect(matchFn([rule('FireRating', 'absent', '')])).not.toBeNull()
    expect(isLiveRule(rule('FireRating', 'absent', ''))).toBe(true)
    expect(isLiveRule(rule('FireRating', '=', ''))).toBe(false)
  })

  it('ignores whatever value is sent with it', () => {
    for (const val of ['', 'anything', '0', null]) {
      expect([val, matchFn([rule('FireRating', 'absent', val)])!(noRating)]).toEqual([val, true])
      expect([val, matchFn([rule('FireRating', 'absent', val)])!(rated)]).toEqual([val, false])
    }
  })

  it('ANDs and ORs like any other rule, and binds the same way', () => {
    const wallsWithout = matchFn([
      rule('IfcEntity', '=', 'IfcWall'),
      rule('FireRating', 'absent', '')
    ])!
    expect(wallsWithout(noRating)).toBe(true)
    expect(wallsWithout(rated)).toBe(false)
    expect(wallsWithout(el({ type: 'IfcDoor', psets: {} }))).toBe(false)

    const either = matchFn([
      rule('FireRating', 'absent', ''),
      rule('IfcEntity', '=', 'IfcDoor', 'or')
    ])!
    expect([noRating, rated, el({ type: 'IfcDoor', psets: { P: { FireRating: '2 HR' } } })].map(either)).toEqual([
      true,
      false,
      true
    ])
  })

  it('works through visFn and hlFn, which is what makes it a filter step', () => {
    const hide = step('h', 'hide', [rule('FireRating', 'absent', '')])
    expect(visFn(state([hide]))(noRating)).toBe(false)
    expect(visFn(state([hide]))(rated)).toBe(true)
    const highlight = step('x', 'highlight', [rule('FireRating', 'absent', '')])
    expect(hlFn(state([highlight]))!(noRating)).toBe(true)
    expect(hlFn(state([highlight]))!(rated)).toBe(false)
  })

  it('answers a real attribute as well as a pset key', () => {
    const noType = matchFn([rule('PredefinedType', 'absent', '')])!
    expect(noType(el({ predefinedType: '' }))).toBe(true)
    expect(noType(el({ predefinedType: 'SOLIDWALL' }))).toBe(false)
  })
})
