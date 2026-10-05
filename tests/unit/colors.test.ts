/**
 * Colour by property — `src/shared/colors.ts` against `SGVue.dc.html:1338–1356`.
 *
 * `SCHEME` is parsed out of the design itself rather than retyped, for the same reason
 * `materials-palette.test.ts` parses `THEMES`: a copy drifts, and eleven hexes are exactly the
 * sort of thing that drifts by one character and shows up three phases later as a legend row
 * in the wrong colour.
 *
 * The rest is the bucketing contract: the shared `attr` resolver (so a pset key is groupable —
 * BUILD_PLAN pitfall 17), values skipped when absent or empty, groups largest first, colours
 * `SCHEME[i % 11]`, and `null` when nothing carries the property.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HL, SCHEME, colorBy, colorByGroups } from '../../src/shared/colors'
import { federate } from '../../src/shared/federate'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import type { Rule, VisElement } from '../../src/shared/rules'

const DESIGN = join(__dirname, '..', '..', 'design-reference', 'design', 'SGVue.dc.html')

const fed = federate([
  mockModelIndex('ARC'),
  mockModelIndex('STR'),
  mockModelIndex('SIT'),
  mockModelIndex('MEP')
])
const els = fed.elements

const rule = (prop: string, val: string, join: Rule['join'] = 'and'): Rule => ({
  prop,
  op: '=',
  val,
  join
})

describe('SCHEME', () => {
  it('is the design’s own eleven-colour literal, in order', () => {
    const source = readFileSync(DESIGN, 'utf8')
    const at = source.indexOf('SCHEME = [')
    expect(at, 'SCHEME not found in SGVue.dc.html').toBeGreaterThan(-1)
    const list = source.slice(source.indexOf('[', at), source.indexOf(']', at) + 1)
    expect(JSON.parse(list.replace(/'/g, '"')) as string[]).toEqual([...SCHEME])
  })

  it('opens with the six highlight colours, so one scheme and one step never clash by accident', () => {
    expect(SCHEME.slice(0, HL.length)).toEqual([...HL])
    expect(SCHEME).toHaveLength(11)
    // Every colour distinct: two groups with the same hex would be two groups you cannot tell
    // apart, which is the one thing the scheme exists to prevent.
    expect(new Set(SCHEME).size).toBe(11)
  })
})

describe('colorBy — buckets, order, colours', () => {
  it('no property is no scheme', () => {
    expect(colorBy(els, null)).toBeNull()
    expect(colorBy(els, '')).toBeNull()
    expect(colorBy(els, undefined)).toBeNull()
  })

  it('groups by a named attribute and orders them largest first', () => {
    const scheme = colorBy(els, 'IfcEntity')
    expect(scheme).not.toBeNull()
    expect(scheme!.prop).toBe('IfcEntity')
    const counts = scheme!.groups.map((g) => g.n)
    expect([...counts].sort((a, b) => b - a)).toEqual(counts)
    // Every element of the federation carries `type`, so nothing is dropped.
    expect(counts.reduce((a, b) => a + b, 0)).toBe(els.length)
    // The ids of a group really are the elements with that value.
    for (const g of scheme!.groups) {
      expect(g.ids).toHaveLength(g.n)
      for (const id of g.ids) expect(fed.byId.get(id)!.type).toBe(g.v)
    }
  })

  it('colours group i with SCHEME[i % 11]', () => {
    // `Name` is nearly unique on the mock federation, so it is the case with far more groups
    // than colours — which is the case the modulo exists for.
    const scheme = colorBy(els, 'Name')!
    expect(scheme.groups.length).toBeGreaterThan(SCHEME.length)
    scheme.groups.forEach((g, i) => expect(g.color).toBe(SCHEME[i % SCHEME.length]))
    // The twelfth group is the first colour again — the modulo, not a run off the end.
    expect(scheme.groups[11].color).toBe(SCHEME[0])
  })

  it('groups by a property-set key through the shared attr resolver (pitfall 17)', () => {
    // The design's flagship example: the SIT model's trees, by species.
    const scheme = colorBy(els, 'SpeciesCommonName')!
    expect(scheme.groups.map((g) => g.v)).toEqual(['Angsana', 'Tembusu'])
    expect(scheme.groups.map((g) => g.n)).toEqual([8, 8])
    expect(scheme.groups.map((g) => g.color)).toEqual([SCHEME[0], SCHEME[1]])
    // Only the sixteen trees carry it; nothing else joins a group of its own.
    expect(scheme.groups.reduce((a, g) => a + g.n, 0)).toBe(16)
  })

  it('groups by Level, which is the other value people ask for by name', () => {
    const scheme = colorBy(els, 'Level')!
    expect(new Set(scheme.groups.map((g) => g.v))).toEqual(
      new Set(els.map((e) => e.storey).filter(Boolean))
    )
  })

  it('skips undefined and the empty string rather than making them a group', () => {
    const one = (over: Partial<VisElement>): VisElement =>
      ({
        id: 1,
        model: 'ARC',
        type: 'IfcWall',
        predefinedType: '',
        objectType: '',
        storey: 'L1',
        name: 'w',
        material: '',
        psets: {},
        qto: {},
        ...over
      }) as VisElement
    const list = [
      one({ id: 1, name: 'a' }),
      one({ id: 2, name: '' }),
      one({ id: 3, name: 'a' }),
      one({ id: 4, name: '', psets: { P: { K: 'x' } } })
    ]
    // `Name` is '' on one element, so that element is not in any group.
    expect(colorBy(list, 'Name')!.groups).toEqual([
      { v: 'a', n: 2, color: SCHEME[0], ids: [1, 3] }
    ])
    // Nothing carries `Missing` at all.
    expect(colorBy(list, 'Missing')).toBeNull()
    // A pset key on one element is still a scheme of one group.
    expect(colorBy(list, 'K')!.groups).toEqual([{ v: 'x', n: 1, color: SCHEME[0], ids: [4] }])
  })

  it('numbers are keyed by String(v), so 200 and "200" are one group', () => {
    const scheme = colorBy(els, 'GirthAtBreastHeight')!
    expect(scheme.groups.map((g) => g.v)).toEqual(['200', '150'])
    expect(scheme.groups.map((g) => g.n)).toEqual([8, 8])
  })

  it('rules narrow the pool before bucketing', () => {
    const all = colorBy(els, 'Level')!
    const arc = colorBy(els, 'Level', [rule('Model', 'ARC')])!
    expect(arc.groups.reduce((a, g) => a + g.n, 0)).toBe(
      els.filter((e) => e.model === 'ARC').length
    )
    expect(arc.groups.reduce((a, g) => a + g.n, 0)).toBeLessThan(
      all.groups.reduce((a, g) => a + g.n, 0)
    )
    for (const g of arc.groups) for (const id of g.ids) expect(fed.byId.get(id)!.model).toBe('ARC')
  })

  it('a rule list where nothing carries a value matches nothing, not everything (`:1269`)', () => {
    // `chatMatch` returns `[]` when `matchFn` is null, so the pool is empty and the answer is
    // `null` — the one case where "some rules" is not "narrow it a bit".
    expect(colorBy(els, 'IfcEntity', [{ prop: 'Level', op: '=', val: '' }])).toBeNull()
    expect(colorBy(els, 'IfcEntity', [{ prop: 'Level', op: '=', val: null }])).toBeNull()
    // An empty list, on the other hand, is "no rules" and the pool is the federation.
    expect(colorBy(els, 'IfcEntity', [])!.groups.reduce((a, g) => a + g.n, 0)).toBe(els.length)
  })

  it('OR binds looser than AND in the pool, as everywhere else', () => {
    const scheme = colorBy(els, 'Model', [
      rule('IfcEntity', 'IfcWall'),
      rule('IfcEntity', 'IfcSlab', 'or')
    ])!
    const want = els.filter((e) => e.type === 'IfcWall' || e.type === 'IfcSlab').length
    expect(scheme.groups.reduce((a, g) => a + g.n, 0)).toBe(want)
  })

  it('is a pure function of its inputs — same answer twice, and no element mutated', () => {
    const before = JSON.stringify(els.map((e) => [e.id, e.type, e.storey]))
    const a = colorBy(els, 'IfcEntity')
    const b = colorBy(els, 'IfcEntity')
    expect(a).toEqual(b)
    expect(JSON.stringify(els.map((e) => [e.id, e.type, e.storey]))).toBe(before)
  })
})

describe('colorByGroups — a scheme over values the Schedules window read (2026-09-25)', () => {
  it('is colorBy’s rule: biggest group first, SCHEME[i % 11], empty values skipped, one value one group', () => {
    const scheme = colorByGroups('Level', [
      { value: 'L1', ids: [1] },
      { value: '', ids: [2, 3, 4, 5] },
      { value: 'L2', ids: [6, 7] },
      { value: 'L1', ids: [8, 9] },
      { value: 'L3', ids: [] },
    ])!
    expect(scheme.prop).toBe('Level')
    expect(scheme.groups).toEqual([
      { v: 'L1', n: 3, color: SCHEME[0], ids: [1, 8, 9] },
      { v: 'L2', n: 2, color: SCHEME[1], ids: [6, 7] },
    ])
  })

  it('wraps the palette after eleven groups, and says null when there is nothing to colour', () => {
    const many = colorByGroups('N', Array.from({ length: 12 }, (_, i) => ({ value: `v${i}`, ids: [i] })))!
    expect(many.groups[11].color).toBe(SCHEME[0])
    expect(colorByGroups('N', [])).toBeNull()
    expect(colorByGroups('N', [{ value: '', ids: [1] }])).toBeNull()
    expect(colorByGroups('', [{ value: 'a', ids: [1] }])).toBeNull()
  })
})
