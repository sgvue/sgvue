/**
 * `attr` is the design's single property resolver (BUILD_PLAN §2.3). Filter rules, grouping
 * and colour-by all go through it, so its fallback order is load-bearing: the seven named
 * attributes, then psets in insertion order, then qtos, then `undefined`.
 */
import { describe, expect, it } from 'vitest'
import { ATTR_KEYS, attr, collectPropKeys, type AttrElement } from '../../src/shared/attr'

const element = (over: Partial<AttrElement> = {}): AttrElement => ({
  model: 'ARC',
  type: 'IfcWall',
  predefinedType: 'SOLIDWALL',
  objectType: 'EW 200 Brick',
  storey: 'L2',
  name: 'Ext Wall S A-B L2',
  material: 'Clay brick, plastered',
  psets: { Pset_WallCommon: { Reference: 'EW200', IsExternal: true, FireRating: '1 HR' } },
  qto: { Qto_WallBaseQuantities: { Length: 5600, Width: 200 } },
  ...over
})

describe('attr', () => {
  it('answers the seven named attributes', () => {
    const el = element()
    expect(ATTR_KEYS.map((k) => attr(el, k))).toEqual([
      'ARC',
      'IfcWall',
      'SOLIDWALL',
      'EW 200 Brick',
      'L2',
      'Ext Wall S A-B L2',
      'Clay brick, plastered'
    ])
  })

  it('falls through to property sets, then to quantities', () => {
    const el = element()
    expect(attr(el, 'FireRating')).toBe('1 HR')
    expect(attr(el, 'IsExternal')).toBe(true)
    expect(attr(el, 'Length')).toBe(5600)
  })

  it('prefers property sets over quantities when both carry the key', () => {
    const el = element({
      psets: { Pset_WallCommon: { Width: 'from pset' } },
      qto: { Qto_WallBaseQuantities: { Width: 200 } }
    })
    expect(attr(el, 'Width')).toBe('from pset')
  })

  it('returns undefined for a key nothing carries — not an empty string', () => {
    expect(attr(element(), 'Nonexistent')).toBeUndefined()
  })

  it('keeps a falsy authored value rather than falling through', () => {
    const el = element({ psets: { Pset_WallCommon: { LoadBearing: false } } })
    expect(attr(el, 'LoadBearing')).toBe(false)
  })

  it('collects propKeys: the seven attributes plus every pset and qto key', () => {
    const keys = collectPropKeys([element()])
    expect(keys.slice(0, 7)).toEqual([...ATTR_KEYS])
    expect(keys).toContain('FireRating')
    expect(keys).toContain('Length')
    // No duplicates, whatever the elements repeat.
    expect(new Set(collectPropKeys([element(), element()])).size).toBe(keys.length)
  })
})
