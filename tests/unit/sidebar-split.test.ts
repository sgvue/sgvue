/**
 * The sidebar's drag handle (2026-09-24) — the clamp a drag settles on, the style a sized
 * section gains, and the store's session-only size — and, since 2026-11-07, the collapsible
 * MODELS section and the tight sidebar. `src/renderer/state/selectors/sidebar.ts`.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clampSection,
  floorPx,
  LOOSE_COLUMN,
  sidebarTight,
  sizedTail,
  TIGHT_COLUMN,
  tightTree,
  TREE_MIN,
  treeMinFor
} from '../../src/renderer/state/selectors/sidebar'
import { disclosure } from '../../src/renderer/state/selectors/tree'
import { useShell } from '../../src/renderer/state/shell'
import { resetShell } from './stub-viewer'

beforeEach(resetShell)

describe('clampSection', () => {
  it('follows the pointer inside the bounds, in whole pixels', () => {
    expect(clampSection(120, 30.4, 42, 400)).toBe(150)
    expect(clampSection(120, -30.6, 42, 400)).toBe(89)
  })

  it('never goes under one row', () => {
    expect(clampSection(120, -500, 42, 400)).toBe(42)
  })

  it('grows only by what the tree can give above its three rows, so the aside never overflows', () => {
    expect(TREE_MIN).toBe(116)
    expect(clampSection(120, 1000, 42, 400)).toBe(120 + 400 - TREE_MIN)
  })

  it('cannot grow at all when the tree is already at its floor, but can still shrink', () => {
    expect(clampSection(120, 50, 42, 80)).toBe(120)
    expect(clampSection(120, -50, 42, 80)).toBe(70)
  })

  it('keeps its floor on a sidebar too small for anything', () => {
    expect(clampSection(30, 10, 42, 0)).toBe(42)
  })
})

describe('sizedTail', () => {
  it('pins the height as the flex base, keeps the floor, and scrolls inside', () => {
    expect(sizedTail(150, 42)).toBe(';flex:0 1 150px;min-height:42px;overflow:auto')
  })
})

describe('the store', () => {
  it('starts automatic, so every style string is the design’s', () => {
    expect(useShell.getState().sideStoreys).toBeNull()
    // 2026-11-07: MODELS has no size of its own any more.
    expect('sideModels' in useShell.getState()).toBe(false)
  })

  it('sizes the STOREYS section and resets it', () => {
    useShell.getState().setSideStoreys({ h: 90, min: 42 })
    expect(useShell.getState().sideStoreys).toEqual({ h: 90, min: 42 })
    useShell.getState().setSideStoreys(null)
    expect(useShell.getState().sideStoreys).toBeNull()
  })
})

describe('the tree’s floor (2026-11-07)', () => {
  it('is the design’s 0, 40 % above six storeys, and three rows once STOREYS is sized', () => {
    expect(treeMinFor(false, false)).toBe('0')
    expect(treeMinFor(true, false)).toBe('40%')
    expect(treeMinFor(false, true)).toBe(`${TREE_MIN}px`)
    // One handle left: a storeys drag gives three rows above six storeys too, as the first drag
    // — which pinned both lists — always did.
    expect(treeMinFor(true, true)).toBe(`${TREE_MIN}px`)
  })

  it('reads in pixels against the aside', () => {
    expect(floorPx('0', 755)).toBe(0)
    expect(floorPx('40%', 755)).toBeCloseTo(302)
    expect(floorPx('116px', 755)).toBe(116)
  })
})

describe('sidebarTight (2026-11-07)', () => {
  // The default window: an aside 755 px tall; 211 px above the MODELS rows (brand, project,
  // search, MODELS header), a model row 41 px, the rows' padding 10 and Original materials 53,
  // the two section titles 21 each, three storey rows 106.
  const above = 211 + 21 + 21
  const models = (n: number): number => 10 + 41 * n + 53

  it('is loose while the usual rules fit', () => {
    // Six storeys (202 px), four models: the tree takes what is left, as designed.
    expect(sidebarTight(above + models(4), 202, 0, 755)).toBe(false)
    // Twelve storeys and one model in a 900 px aside: storeys at three rows and the tree at
    // 40 % fit (357 + 106 + 360 = 823).
    expect(sidebarTight(above + models(1), 106, 360, 900)).toBe(false)
  })

  it('is tight once full MODELS rows, the storeys’ floor and the tree’s floor exceed the aside', () => {
    // Twelve storeys and four models — the reference federation at the default window.
    expect(sidebarTight(above + models(4), 106, 302, 755)).toBe(true)
    // Six storeys and ten models: the tree would be pushed out even at the design’s 0.
    expect(sidebarTight(above + models(10), 202, 0, 755)).toBe(true)
  })

  it('takes half a pixel of fractional layout as fitting', () => {
    expect(sidebarTight(300.4, 100, 354, 755)).toBe(false)
    expect(sidebarTight(301, 100, 355, 755)).toBe(true)
  })
})

describe('the tight column (2026-11-07)', () => {
  it('lays out nothing while loose, and scrolls everything under the MODELS header when tight', () => {
    expect(LOOSE_COLUMN).toBe('display:contents')
    expect(TIGHT_COLUMN).toBe('flex:1;min-height:0;display:flex;flex-direction:column;overflow-y:auto')
  })

  it('makes the tree’s floor its preferred height, and keeps three rows', () => {
    expect(tightTree(302.4)).toBe(`flex:1 1 302px;min-height:${TREE_MIN}px`)
    expect(tightTree(0)).toBe(`flex:1 1 0px;min-height:${TREE_MIN}px`)
  })
})

describe('the MODELS section (2026-11-07)', () => {
  it('starts expanded, and its chevron is the tree group row’s', () => {
    expect(useShell.getState().modelsOpen).toBe(true)
    expect(disclosure(true)).toEqual({ rot: 90, chevColor: 'var(--accent-ink)' })
    expect(disclosure(false)).toEqual({ rot: 0, chevColor: 'var(--faint)' })
  })

  it('collapses and expands, and collapsing puts away what lives in it', () => {
    useShell.setState({ palette: 'ARC', confirmRemove: null })
    useShell.getState().toggleModels()
    expect(useShell.getState()).toMatchObject({
      modelsOpen: false,
      palette: null,
      confirmRemove: null
    })
    useShell.getState().toggleModels()
    expect(useShell.getState().modelsOpen).toBe(true)
  })

  it('expands for the unload confirmation, so the assistant’s unload_model is seen', () => {
    useShell.getState().toggleModels()
    useShell.getState().askRemove('ARC')
    expect(useShell.getState()).toMatchObject({ modelsOpen: true, confirmRemove: 'ARC' })
    // Taking the confirmation away leaves the section as it is.
    useShell.getState().askRemove('ARC')
    expect(useShell.getState()).toMatchObject({ modelsOpen: true, confirmRemove: null })
  })

  // 2026-11-08: the `library` popover, which also expanded the section, is not in the port.
  it('expands for a new upload row', () => {
    useShell.getState().toggleModels()
    expect(useShell.getState().modelsOpen).toBe(false)
    useShell.getState().addUpload({ id: 'u1', name: 'a.ifc', stage: 'reading file', pct: 5 })
    expect(useShell.getState().modelsOpen).toBe(true)
  })
})
