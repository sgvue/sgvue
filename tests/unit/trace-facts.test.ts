/**
 * What a tool call contributes to the thinking trace — `src/renderer/ai/trace-facts.ts`.
 *
 * The handoff's video is scripted: 412 elements, 86 walls, 9 with no fire rating. The app's
 * numbers have to be real, so each of them is derived here from a tool's own rules and the
 * federation, and checked against a plain count over the elements. The federation is the
 * design's mock — the demo building, which is what the captures show — and a synthetic one where
 * the rule needs a case the mock does not have.
 *
 * 2026-10-02: a note's words can depend on the call (`toolPhrase`) — clearing the selection and
 * undoing are not what their tools' one phrase says — and no input can make them throw.
 */
import { describe, expect, it } from 'vitest'
import { federate } from '../../src/shared/federate'
import { attr } from '../../src/shared/attr'
import { matchFn, type Rule } from '../../src/shared/rules'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { TOOL_STAGE, toolPhrase } from '../../src/renderer/ai/stages'
import { TOOLS } from '../../src/shared/tool-schemas'
import {
  capRows,
  classNoun,
  nounFor,
  noteFor,
  pluralOf,
  readFacts,
  ROW_CAP,
  SCOPE_PROPS,
  scopeRules,
  splitRules,
  statusText,
  storeyRows,
  toolFacts,
  type RuleFacts
} from '../../src/renderer/ai/trace-facts'
import { federationOf, type Sketch } from './trace-fixtures'

const mock = federate(['ARC', 'STR', 'SIT', 'MEP'].map((k) => mockModelIndex(k)))
const els = mock.elements
const rule = (prop: string, op: Rule['op'], val: Rule['val'] = null, join?: Rule['join']): Rule => ({ prop, op, val, join })
const facts = (rules: Rule[], name = 'query_elements'): RuleFacts => toolFacts(name, { rules }, mock).rules!
const idsAt = (at: readonly number[]): number[] => at.map((i) => els[i].id)

describe('Read: the federation as it stands', () => {
  it('counts the demo building as the handoff does: 4 models of 140, 244, 20 and 8', () => {
    expect(readFacts(mock)).toEqual({ models: [140, 244, 20, 8], total: 412 })
  })

  it('lists a model’s elements together, in the federation’s own order', () => {
    const two = federationOf(
      [{ model: 'B', type: 'IfcWall' }, { model: 'B', type: 'IfcWall' }, { model: 'A', type: 'IfcSlab' }],
      []
    )
    expect(readFacts(two)).toEqual({ models: [2, 1], total: 3 })
  })
})

describe('scope rules and check rules', () => {
  it('takes the five built-in properties as scope, and everything else as a check', () => {
    expect(SCOPE_PROPS).toEqual(['Model', 'IfcEntity', 'PredefinedType', 'ObjectType', 'Level'])
    const split = splitRules([
      rule('IfcEntity', '=', 'IfcWall'),
      rule('Level', '=', 'L2', 'and'),
      rule('FireRating', 'absent', null, 'and'),
      // `Name` and `Material` are attributes, and not what a question is *about*: checks.
      rule('Name', '~', 'core', 'and'),
      rule('Material', '=', 'Concrete', 'and')
    ])
    expect(split.scope.map((r) => r.prop)).toEqual(['IfcEntity', 'Level'])
    expect(split.check.map((r) => r.prop)).toEqual(['FireRating', 'Name', 'Material'])
    expect(split.groups).toHaveLength(1)
  })

  it('splits OR group by OR group, and only counts live rules', () => {
    const split = splitRules([
      rule('IfcEntity', '=', 'IfcWall'),
      rule('FireRating', '=', '2 HR', 'and'),
      // No value: not a rule at all (`isLiveRule`).
      rule('Level', '=', '', 'and'),
      rule('IfcEntity', '=', 'IfcDoor', 'or'),
      rule('FireExit', '=', 'true', 'and')
    ])
    expect(split.groups.map((g) => [g.scope.map((r) => r.val), g.check.map((r) => r.prop)])).toEqual([
      [['IfcWall'], ['FireRating']],
      [['IfcDoor'], ['FireExit']]
    ])
    // The scope list reads back the same way through `matchFn`: walls OR doors.
    const scoped = scopeRules(split)!
    expect(scoped.map((r) => [r.prop, r.val, r.join])).toEqual([
      ['IfcEntity', 'IfcWall', 'and'],
      ['IfcEntity', 'IfcDoor', 'or']
    ])
    expect(els.filter(matchFn(scoped)!)).toHaveLength(80 + 17)
  })

  it('matches everything when an OR group is left with no scope rule', () => {
    // "walls, or anything with no fire rating": the second group is satisfied by every class.
    const split = splitRules([rule('IfcEntity', '=', 'IfcWall'), rule('FireRating', 'absent', null, 'or')])
    expect(scopeRules(split)).toBeNull()
    expect(scopeRules(splitRules([rule('FireRating', 'absent')]))).toBeNull()
    expect(scopeRules(splitRules([]))).toBeNull()
    // So that call has a scope rule and no Filter: "Filtering IfcWall · 412 elements" would be false.
    const f = facts([rule('IfcEntity', '=', 'IfcWall'), rule('FireRating', 'absent', null, 'or')])
    expect(f.filter).toBeNull()
    expect([f.scope, f.scopeCount, f.noun]).toEqual([null, 412, 'element'])
    // What it matches is still the rule list's own: the 80 walls, and the 51 other elements
    // that carry no fire rating.
    expect(f.matched).toHaveLength(els.filter((e) => e.type === 'IfcWall' || attr(e, 'FireRating') === undefined).length)
    expect(f.matched).toHaveLength(131)
    expect(f.check).toEqual({ props: 'Fire Rating', count: 131, unit: 'missing' })
  })
})

describe('Filter and Check, from one call’s rules', () => {
  it('“which walls have no thermal transmittance?” — 80 walls, 24 missing, by storey', () => {
    const f = facts([rule('IfcEntity', '=', 'IfcWall'), rule('ThermalTransmittance', 'absent', null, 'and')])
    expect(f.filter).toEqual({ what: 'IfcWall', count: 80, noun: 'wall' })
    expect(f.check).toEqual({ props: 'Thermal Transmittance', count: 24, unit: 'missing' })
    expect([f.total, f.models, f.scopeCount, f.noun]).toEqual([412, [140, 244, 20, 8], 80, 'wall'])
    // The scope and the matched set are positions in the read order, ascending — and exactly
    // what a plain count over the elements finds.
    const walls = els.flatMap((e, i) => (e.type === 'IfcWall' ? [i] : []))
    const missing = walls.filter((i) => attr(els[i], 'ThermalTransmittance') === undefined)
    expect(f.scope).toEqual(walls)
    expect(f.matched).toEqual(missing)
    expect(f.rows.map((r) => [r.label, r.n])).toEqual([['L1', 5], ['L2', 5], ['L3', 5], ['L4', 5], ['Roof', 4]])
    for (const row of f.rows) {
      expect(row.ids).toEqual(idsAt(row.at))
      expect(row.at.every((i) => els[i].storey === row.label && missing.includes(i))).toBe(true)
    }
  })

  it('counts `found` unless every check asks for a missing value', () => {
    expect(facts([rule('IfcEntity', '=', 'IfcWall'), rule('AcousticRating', '=', 'STC 45', 'and')]).check).toEqual({
      props: 'Acoustic Rating',
      count: 8,
      unit: 'found'
    })
    // One `absent`, one not: found.
    const mixed = facts([rule('IfcEntity', '=', 'IfcWall'), rule('AcousticRating', 'absent', null, 'and'), rule('LoadBearing', '=', 'true', 'and')])
    expect(mixed.check).toEqual({ props: 'Acoustic Rating, Load Bearing', count: 12, unit: 'found' })
    // Three properties are counted, not listed; a repeated one is one.
    const three = facts([
      rule('FireRating', '=', '2 HR'),
      rule('LoadBearing', '=', 'true', 'and'),
      rule('IsExternal', '=', 'false', 'and'),
      rule('FireRating', '!=', '-', 'and')
    ])
    expect(three.check!.props).toBe('3 properties')
    expect(three.filter).toBeNull()
  })

  it('names what is filtered: the classes, two at most — else the first scope rule’s value', () => {
    expect(facts([rule('IfcEntity', '=', 'IfcDoor')]).filter).toEqual({ what: 'IfcDoor', count: 17, noun: 'door' })
    // Two classes are named and counted as elements; three are counted as classes.
    expect(facts([rule('IfcEntity', '=', 'IfcWall'), rule('IfcEntity', '=', 'IfcSlab', 'or')]).filter).toEqual({
      what: 'IfcWall, IfcSlab',
      count: 85,
      noun: 'element'
    })
    expect(
      facts([rule('IfcEntity', '=', 'IfcWall'), rule('IfcEntity', '=', 'IfcSlab', 'or'), rule('IfcEntity', '=', 'IfcDoor', 'or')]).filter
    ).toEqual({ what: '3 classes', count: 102, noun: 'element' })
    // The class with a storey: still the class that is named and counted in.
    expect(facts([rule('IfcEntity', '=', 'IfcDoor'), rule('Level', '=', 'L2', 'and')]).filter).toEqual({ what: 'IfcDoor', count: 4, noun: 'door' })
    // No class: the first scope rule's value, in elements.
    expect(facts([rule('Level', '=', 'L2')]).filter).toEqual({ what: 'L2', count: 92, noun: 'element' })
    expect(facts([rule('Model', '=', 'MEP')]).filter).toEqual({ what: 'MEP', count: 8, noun: 'element' })
    // …with its operator when it is not `=`, so the words stay true.
    expect(facts([rule('Level', '!=', 'L1')]).filter).toEqual({ what: '≠ L1', count: 300, noun: 'element' })
    expect(facts([rule('IfcEntity', '~', 'wall')]).filter).toEqual({ what: '~ wall', count: 80, noun: 'element' })
    // A class written in another case is the federation's own spelling.
    expect(facts([rule('IfcEntity', '=', 'ifcwall')]).filter).toEqual({ what: 'IfcWall', count: 80, noun: 'wall' })
  })

  it('is a note — the busy row’s own phrase, capitalised — for a call with no live top-level rule', () => {
    expect(toolFacts('audit_model', {}, mock)).toEqual({ name: 'audit_model', note: 'Auditing model data', rules: null })
    expect(toolFacts('query_elements', { rules: [] }, mock).rules).toBeNull()
    expect(toolFacts('query_elements', { rules: [rule('Level', '=', '')] }, mock).rules).toBeNull()
    // `set_filter_stack` carries its rules inside `steps`: not top-level, so a note.
    expect(toolFacts('set_filter_stack', { steps: [{ action: 'isolate', rules: [rule('Level', '=', 'L2')] }] }, mock)).toMatchObject({
      note: 'Building filter steps',
      rules: null
    })
    expect(noteFor('get_view_state')).toBe('Reading the current view')
    expect(noteFor('some_new_tool')).toBe('Running some_new_tool')
    // Every tool in the catalogue has a phrase of its own.
    for (const tool of TOOLS) expect([tool.name, TOOL_STAGE[tool.name] !== undefined]).toEqual([tool.name, true])
  })

  /**
   * 2026-10-02 — parity with the user, phase 1. Two tools now do things their one phrase would
   * misstate, so the ticker reads the call: clearing a selection is not "Selecting elements",
   * and an undo is not "Updating the view". Everything else is the tool's own phrase.
   */
  it('says what a call does when the tool’s one phrase would misstate it', () => {
    expect(toolFacts('select_elements', { mode: 'clear' }, mock)).toEqual({
      name: 'select_elements',
      note: 'Clearing the selection',
      rules: null
    })
    expect(noteFor('select_elements', { mode: 'add', ids: [1, 2] })).toBe('Changing the selection')
    expect(noteFor('select_elements', { mode: 'remove', selection: true })).toBe('Changing the selection')
    expect(noteFor('select_elements', { mode: 'replace' })).toBe('Selecting elements')
    expect(noteFor('select_elements', {})).toBe('Selecting elements')
    expect(noteFor('apply_visibility', { action: 'undo' })).toBe('Undoing the last change')
    expect(noteFor('apply_visibility', { action: 'redo' })).toBe('Redoing the last change')
    expect(noteFor('apply_visibility', { action: 'reset' })).toBe('Updating the view')
    // The two new tools, and the switches, in their own words.
    expect(toolFacts('set_models', { visible: ['ARC'] }, mock)).toEqual({
      name: 'set_models',
      note: 'Showing and hiding models',
      rules: null
    })
    expect(toolFacts('set_interface', { theme: 'light', search: 'wall' }, mock)).toEqual({
      name: 'set_interface',
      note: 'Adjusting the interface',
      rules: null
    })
    expect(noteFor('toggle_display', { groundGrid: false })).toBe('Toggling display')
    // `add` with rules is narrated from the rules, exactly as a replace is.
    expect(toolFacts('select_elements', { mode: 'add', rules: [rule('IfcEntity', '=', 'IfcDoor')] }, mock).rules?.filter).toEqual({
      what: 'IfcDoor',
      count: 17,
      noun: 'door'
    })
  })

  it('cannot be made to throw by a call’s input', () => {
    const odd: unknown[] = [null, undefined, 7, 'clear', [], { mode: null }, { mode: {} }, { action: 42 }, { mode: ['clear'] }]
    for (const input of odd) {
      for (const name of ['select_elements', 'apply_visibility', 'set_interface', 'set_models', 'constructor', '__proto__']) {
        expect(() => toolPhrase(name, input as never)).not.toThrow()
        expect(() => noteFor(name, input as never)).not.toThrow()
      }
    }
    // A name that is not a tool has no phrase — never something inherited from `Object`.
    expect(toolPhrase('constructor')).toBeUndefined()
    expect(toolPhrase('toString', {})).toBeUndefined()
    expect(noteFor('constructor')).toBe('Running constructor')
    expect(toolPhrase('set_models')).toBe('showing and hiding models')
  })
})

describe('the noun a class is counted in', () => {
  it('drops the prefix, splits the camel case and takes the plural of the last word', () => {
    const cases: [string, string, string][] = [
      ['IfcWall', 'wall', 'walls'],
      ['IfcBuildingElementProxy', 'building element proxy', 'building element proxies'],
      ['IfcDuctSegment', 'duct segment', 'duct segments'],
      ['IfcGeographicElement', 'geographic element', 'geographic elements'],
      ['IfcElementAssembly', 'element assembly', 'element assemblies'],
      ['IfcBuildingStorey', 'building storey', 'building storeys'],
      ['IfcChimney', 'chimney', 'chimneys'],
      ['IfcCovering', 'covering', 'coverings'],
      ['IfcWallStandardCase', 'wall standard case', 'wall standard cases'],
      ['ifcslab', 'slab', 'slabs']
    ]
    for (const [entity, one, many] of cases) {
      expect([entity, classNoun(entity)]).toEqual([entity, one])
      expect([entity, pluralOf(classNoun(entity))]).toEqual([entity, many])
    }
    expect(['box', 'mesh', 'class', 'switch', 'element'].map(pluralOf)).toEqual(['boxes', 'meshes', 'classes', 'switches', 'elements'])
    expect(classNoun('Ifc')).toBe('element')
  })

  it('is singular for exactly one', () => {
    expect([0, 1, 2, 86].map((n) => nounFor(n, 'wall'))).toEqual(['walls', 'wall', 'walls', 'walls'])
    expect(nounFor(1, 'building element proxy')).toBe('building element proxy')
  })
})

describe('the status a finished turn rolls to', () => {
  const walls = facts([rule('IfcEntity', '=', 'IfcWall'), rule('ThermalTransmittance', 'absent', null, 'and')])

  it('says `checked {scope} · {s}s` after a Check, `found … · {s}s` after a Filter alone, else the seconds', () => {
    expect(statusText(walls, 7.2)).toBe('checked 80 walls · 7s')
    expect(statusText(facts([rule('IfcEntity', '=', 'IfcDoor')]), 3.4)).toBe('found 17 doors · 3s')
    expect(statusText(null, 4.6)).toBe('5s')
    // A Check with no Filter checked everything.
    expect(statusText(facts([rule('FireRating', '=', '2 HR')]), 2)).toBe('checked 412 elements · 2s')
  })

  it('counts whole seconds, to the nearest, and never less than one', () => {
    expect([0.004, 0.4, 0.6, 1.49, 1.5, 59.5].map((s) => statusText(null, s))).toEqual(['1s', '1s', '1s', '1s', '2s', '60s'])
    // One of something is singular; a large count is grouped as the panel groups its own.
    const one = facts([rule('IfcEntity', '=', 'IfcDoor'), rule('FireExit', '=', 'true', 'and')])
    expect(one.matched).toHaveLength(1)
    expect(statusText({ ...walls, scopeCount: 1 }, 2)).toBe('checked 1 wall · 2s')
    expect(statusText({ ...walls, scopeCount: 2767 }, 2)).toBe('checked 2,767 walls · 2s')
  })
})

describe('the rows under an answer', () => {
  it('follows the federation’s storey order, whatever order the elements come in', () => {
    // The mock's ladder is Foundation, L1 … L4, Roof; its footings come after its walls.
    const f = facts([rule('LoadBearing', '=', 'true')])
    expect(mock.storeys.map((s) => s.name)).toEqual(['Foundation', 'L1', 'L2', 'L3', 'L4', 'Roof'])
    const labels = f.rows.map((r) => r.label)
    expect(labels).toEqual(mock.storeys.map((s) => s.name).filter((name) => labels.includes(name)))
    expect(f.rows.reduce((n, r) => n + r.n, 0)).toBe(f.matched.length)
    expect(new Set(f.rows.flatMap((r) => r.ids)).size).toBe(f.matched.length)
  })

  it('puts a storey the ladder does not carry after it, and elements on no storey last, under the em dash', () => {
    const sketches: Sketch[] = [
      { model: 'A', type: 'IfcWall' },
      { model: 'A', type: 'IfcWall', storey: 'Mezzanine' },
      { model: 'A', type: 'IfcWall', storey: 'L2' },
      { model: 'A', type: 'IfcWall', storey: 'L1' },
      { model: 'A', type: 'IfcWall', storey: 'L2' },
      { model: 'A', type: 'IfcWall' }
    ]
    const fed = federationOf(sketches, ['L1', 'L2'])
    expect(storeyRows(fed, [0, 1, 2, 3, 4, 5]).map((r) => [r.label, r.n, r.at])).toEqual([
      ['L1', 1, [3]],
      ['L2', 2, [2, 4]],
      ['Mezzanine', 1, [1]],
      ['—', 2, [0, 5]]
    ])
  })

  it('caps at eight: the eighth is `+{k} more levels`, with what they hold', () => {
    expect(ROW_CAP).toBe(8)
    const rows = Array.from({ length: 11 }, (_, i) => ({ label: `L${i + 1}`, n: i + 1, ids: [100 + i], at: [i] }))
    expect(capRows(rows.slice(0, 8))).toEqual(rows.slice(0, 8))
    const capped = capRows(rows)
    expect(capped).toHaveLength(8)
    expect(capped.slice(0, 7)).toEqual(rows.slice(0, 7))
    expect(capped[7]).toEqual({ label: '+4 more levels', n: 8 + 9 + 10 + 11, ids: [107, 108, 109, 110], at: [7, 8, 9, 10] })
    expect(capRows(rows.slice(0, 9))[7].label).toBe('+2 more levels')
  })
})
