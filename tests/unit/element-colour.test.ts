/**
 * The colour precedence, layer pair by layer pair — `elementColour` / `baseColour` /
 * `partAlpha` in `src/renderer/viewer/materials.ts`, against `viewer-core.js` `baseFor`
 * (L91–96) and `applyMat` (L487–498), and `BUILD_PLAN.md` §1.4:
 *
 * ```
 * native IFC materials            (base)
 *   ← per-model override          (setModelColors)
 *   ← colour-by-property scheme   (legend)
 *   ← each enabled highlight step, in stack order   (later step wins)
 *   ← hover / selection           (renderer-owned, always on top)
 * ```
 *
 * The scheme and the highlight steps reach the renderer through the *same* channel —
 * `setElementColors`, one composed `id → hex` map (`state/selectors/filter.ts` composes it, and
 * `filter-stack.test.ts` covers the composition) — so on this side the last three layers are
 * one input, `elColor`, and what is tested here is how that input beats a model override and
 * how hover and selection beat it in turn.
 *
 * `alpha: null` is the load-bearing value: it means "keep the part's own opacity from the
 * file", which is the reference's "the source material's opacity is kept so overridden models
 * still read correctly" (L86). Glass stays glass under every override.
 */
import { describe, expect, it } from 'vitest'
import {
  GHOST_ALPHA,
  GHOST_GREY,
  HIDDEN_ALPHA,
  HIGHLIGHT_GLOW,
  HOVER_TAG,
  INERT_ALPHA,
  SEE_THROUGH_BELOW,
  SELECT_GLOW,
  THEMES,
  baseColour,
  elementColour,
  partAlpha,
  type ElementColour,
  type ElementColourInput
} from '../../src/renderer/viewer/materials'

const ACCENT = THEMES.dark.accent

/** An ordinary visible element, nothing on. */
const base = (over: Partial<ElementColourInput> = {}): ElementColourInput => ({
  visible: true,
  selected: false,
  hovered: false,
  inert: false,
  highlight: false,
  hl: false,
  accent: ACCENT,
  ...over
})

/** The alpha of a 40 %-opaque pane of glass, as the geometry pipeline stores it. */
const GLASS = 0.4
/** The alpha of an ordinary opaque wall. */
const SOLID = 1

const OVERRIDE = '#E05A6B'
const SCHEME_COLOUR = '#6BC96B'
const STEP_COLOUR = '#E8A33D'

/** Does this decision move the element to its slot's see-through mesh? */
const seeThrough = (d: ElementColour): boolean => d.alpha !== null && d.alpha < SEE_THROUGH_BELOW

describe('layer 1 — native IFC materials', () => {
  it('with nothing overriding, both colour and opacity come from the file', () => {
    const d = elementColour(base())
    expect(d).toEqual({ color: null, alpha: null, lift: false })
    // `paint` therefore writes the part's own RGBA, whatever it is.
    expect(partAlpha(d, GLASS)).toBe(GLASS)
    expect(partAlpha(d, SOLID)).toBe(SOLID)
    expect(seeThrough(d)).toBe(false)
  })
})

describe('layer 2 — a per-model override, over the native materials', () => {
  it('replaces the colour and keeps the file’s opacity: glass stays glass', () => {
    const d = elementColour(base({ modelColor: OVERRIDE }))
    expect(d.color).toBe(OVERRIDE)
    expect(d.alpha).toBeNull()
    expect(partAlpha(d, GLASS)).toBe(GLASS)
    expect(partAlpha(d, SOLID)).toBe(SOLID)
  })

  it('“Original materials” is resolved before this function, so the override is simply absent', () => {
    // `viewer-core.ts` passes `nativeMats ? null : modelColors[model]` (the reference's L94).
    // The override is *remembered* in the store while the toggle is on; the renderer is told
    // nothing about the flag.
    expect(elementColour(base({ modelColor: null })).color).toBeNull()
    expect(elementColour(base({ modelColor: undefined })).color).toBeNull()
  })
})

describe('layer 3 — the colour-by scheme, over the model override', () => {
  it('an element colour wins over the model’s', () => {
    expect(baseColour(base({ elColor: SCHEME_COLOUR, modelColor: OVERRIDE }))).toBe(SCHEME_COLOUR)
    const d = elementColour(base({ elColor: SCHEME_COLOUR, modelColor: OVERRIDE }))
    expect(d.color).toBe(SCHEME_COLOUR)
    // …and still keeps the file's opacity, so a coloured-by-property window is translucent.
    expect(d.alpha).toBeNull()
    expect(partAlpha(d, GLASS)).toBe(GLASS)
  })

  it('an element the scheme does not name falls back to the model override', () => {
    expect(elementColour(base({ modelColor: OVERRIDE })).color).toBe(OVERRIDE)
  })
})

describe('layer 4 — highlight steps, over the scheme', () => {
  it('a highlighted element carrying a colour is drawn in *that* colour, opaque', () => {
    // The composed map has already resolved "later step wins" and "the step's colour over the
    // scheme's" (`state/selectors/filter.ts`); what this branch does is stop highlight mode
    // flattening it to the accent (the reference's L492).
    const d = elementColour(base({ highlight: true, hl: true, elColor: STEP_COLOUR }))
    expect(d).toEqual({ color: STEP_COLOUR, alpha: null, lift: false })
    expect(seeThrough(d)).toBe(false)
  })

  it('a highlighted element with no colour of its own takes the picked highlight colour', () => {
    expect(elementColour(base({ highlight: true, hl: true, hlColor: STEP_COLOUR }))).toEqual({
      color: STEP_COLOUR,
      alpha: 1 + HIGHLIGHT_GLOW,
      lift: false
    })
    // …and the theme accent when none is picked — the reference's `hlMat`, emissive × 0.15.
    expect(elementColour(base({ highlight: true, hl: true }))).toEqual({
      color: ACCENT,
      alpha: 1 + HIGHLIGHT_GLOW,
      lift: false
    })
  })

  it('everything else is ghosted at 10 % grey and moves to the see-through mesh', () => {
    const d = elementColour(base({ highlight: true, hl: false, elColor: SCHEME_COLOUR }))
    expect(d).toEqual({ color: GHOST_GREY, alpha: GHOST_ALPHA, lift: false })
    // A scheme colour does **not** rescue an unmatched element from the ghost: highlight mode
    // is about what matched, and the reference ghosts everything that did not (L493).
    expect(seeThrough(d)).toBe(true)
  })
})

describe('layer 5 — hover and selection, over everything', () => {
  it('selection is the accent, opaque and glowing by 0.35 — the reference’s selMat', () => {
    const d = elementColour(
      base({ selected: true, elColor: SCHEME_COLOUR, modelColor: OVERRIDE, highlight: true, hl: true })
    )
    expect(d).toEqual({ color: ACCENT, alpha: 1 + SELECT_GLOW, lift: false })
    // Even a pane of glass is opaque while selected, as the reference's `selMat` is.
    expect(partAlpha(d, GLASS)).toBe(1 + SELECT_GLOW)
  })

  it('hover keeps the element’s own colour and tags the alpha: a flat accent lift', () => {
    const d = elementColour(base({ hovered: true, elColor: SCHEME_COLOUR, modelColor: OVERRIDE }))
    expect(d).toEqual({ color: SCHEME_COLOUR, alpha: null, lift: true })
    // The tag rides on the file's own opacity, so hovering glass does not make it opaque.
    expect(partAlpha(d, GLASS)).toBe(GLASS + HOVER_TAG)
    expect(partAlpha(d, SOLID)).toBe(SOLID + HOVER_TAG)
  })

  it('hover is decided before highlight (L491): hovering a ghost brings it back', () => {
    const d = elementColour(base({ hovered: true, highlight: true, hl: false, modelColor: OVERRIDE }))
    expect(d.color).toBe(OVERRIDE)
    expect(d.alpha).toBeNull()
    expect(d.lift).toBe(true)
  })

  it('selection beats hover, and both beat the highlight ghost', () => {
    expect(elementColour(base({ selected: true, hovered: true })).lift).toBe(false)
    expect(elementColour(base({ selected: true, hovered: true })).color).toBe(ACCENT)
  })
})

describe('the two states that outrank the colour stack entirely', () => {
  it('hidden is alpha 0, whatever else is true of the element', () => {
    const d = elementColour(
      base({ visible: false, selected: true, hovered: true, elColor: SCHEME_COLOUR })
    )
    expect(d).toEqual({ color: null, alpha: HIDDEN_ALPHA, lift: false })
    expect(partAlpha(d, GLASS)).toBe(0)
  })

  it('inert — a model outside activate mode — is 8 % grey, over selection and hover both', () => {
    const d = elementColour(
      base({ inert: true, selected: true, hovered: true, elColor: SCHEME_COLOUR, modelColor: OVERRIDE })
    )
    expect(d).toEqual({ color: GHOST_GREY, alpha: INERT_ALPHA, lift: false })
    expect(seeThrough(d)).toBe(true)
  })
})

describe('the reference’s own branch order, read out of viewer-core.js', () => {
  it('is inert, selected, hovered, highlighted-with-a-colour, highlight, base', () => {
    // One case per branch, in the order `applyMat` tests them, each one with every *earlier*
    // condition false and every *later* one true — so a reordering of the branches fails here.
    const all = { elColor: SCHEME_COLOUR, modelColor: OVERRIDE, highlight: true, hl: true }
    expect(elementColour(base({ ...all, inert: true, selected: true, hovered: true })).color).toBe(
      GHOST_GREY
    )
    expect(elementColour(base({ ...all, selected: true, hovered: true })).color).toBe(ACCENT)
    expect(elementColour(base({ ...all, hovered: true })).lift).toBe(true)
    expect(elementColour(base(all)).color).toBe(SCHEME_COLOUR)
    expect(elementColour(base({ ...all, elColor: null })).color).toBe(ACCENT)
    expect(elementColour(base({ modelColor: OVERRIDE })).color).toBe(OVERRIDE)
  })
})
