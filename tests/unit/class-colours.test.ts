/**
 * "Original materials" off → coloured by IFC class (2026-09-24, owner-requested: *"The toggle
 * off are suppose to be coloured in different ifcentity."*).
 *
 * Two things have to hold. The class colour is the **bottom** override — an active colour-by
 * (or a highlight step: both arrive as `elColor`) beats a model swatch the user picked, which
 * beats the class colour, which beats the file's own colour — and it is exactly what
 * `colorBy(elements, 'IfcEntity')` gives, so the toggle and the assistant's colour-by-entity
 * can never disagree.
 */
import { describe, expect, it } from 'vitest'
import { classColors, colorBy, SCHEME } from '../../src/shared/colors'
import { federate } from '../../src/shared/federate'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import {
  THEMES,
  baseColour,
  elementColour,
  type ElementColourInput
} from '../../src/renderer/viewer/materials'
import { matHint } from '../../src/renderer/state/selectors/status'

const base = (over: Partial<ElementColourInput> = {}): ElementColourInput => ({
  visible: true,
  selected: false,
  hovered: false,
  inert: false,
  highlight: false,
  hl: false,
  accent: THEMES.dark.accent,
  ...over
})

const CLASS = '#E8A33D'
const SWATCH = '#7B8CF0'
const COLOUR_BY = '#6BC96B'

describe('the colour precedence with the class colour', () => {
  it('toggle on (no class colour given): the file’s own colour', () => {
    expect(baseColour(base())).toBeNull()
  })

  it('toggle off, no swatch, no colour-by: the IFC class colour', () => {
    expect(baseColour(base({ classColor: CLASS }))).toBe(CLASS)
  })

  it('a model swatch the user picked beats the class colour', () => {
    expect(baseColour(base({ classColor: CLASS, modelColor: SWATCH }))).toBe(SWATCH)
  })

  it('an active colour-by beats both', () => {
    expect(baseColour(base({ classColor: CLASS, modelColor: SWATCH, elColor: COLOUR_BY }))).toBe(
      COLOUR_BY
    )
    expect(baseColour(base({ classColor: CLASS, elColor: COLOUR_BY }))).toBe(COLOUR_BY)
  })

  it('keeps the part’s own opacity, so glass stays glass', () => {
    expect(elementColour(base({ classColor: CLASS }))).toEqual({
      color: CLASS,
      alpha: null,
      lift: false
    })
  })

  it('selection still draws over it', () => {
    expect(elementColour(base({ classColor: CLASS, selected: true })).color).toBe(
      THEMES.dark.accent
    )
  })
})

describe('classColors', () => {
  const fed = federate(['ARC', 'STR', 'MEP', 'SIT'].map((k) => mockModelIndex(k)))

  it('is exactly colour-by IfcEntity over the whole federation', () => {
    const map = classColors(fed.elements)
    const scheme = colorBy(fed.elements, 'IfcEntity')!
    let n = 0
    for (const g of scheme.groups) {
      for (const id of g.ids) {
        expect(map[id]).toBe(g.color)
        n++
      }
    }
    expect(Object.keys(map)).toHaveLength(n)
    expect(n).toBe(fed.elements.length)
  })

  it('gives two elements of one class one colour, and the biggest class SCHEME[0]', () => {
    const map = classColors(fed.elements)
    const walls = fed.elements.filter((e) => e.type === 'IfcWall')
    expect(new Set(walls.map((e) => map[e.id])).size).toBe(1)
    const counts = new Map<string, number>()
    for (const e of fed.elements) counts.set(e.type, (counts.get(e.type) ?? 0) + 1)
    const biggest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
    expect(map[fed.elements.find((e) => e.type === biggest)!.id]).toBe(SCHEME[0])
  })

  it('is empty for an empty federation', () => {
    expect(classColors([])).toEqual({})
  })
})

describe('the hint under the toggle', () => {
  it('says the view is coloured by IFC class when no model colour is set', () => {
    expect(matHint(false, {})).toBe('Coloured by IFC class')
  })
})
