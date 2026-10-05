/**
 * The sidebar's drag handles (2026-09-24) — the clamp a drag settles on, the style a sized
 * section gains, and the store's session-only sizes. `src/renderer/state/selectors/sidebar.ts`.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { clampSection, sizedTail, TREE_MIN } from '../../src/renderer/state/selectors/sidebar'
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
    expect(useShell.getState().sideModels).toBeNull()
    expect(useShell.getState().sideStoreys).toBeNull()
  })

  it('sizes one section and resets it on its own', () => {
    useShell.getState().setSideSize('models', { h: 150, min: 51 })
    useShell.getState().setSideSize('storeys', { h: 90, min: 42 })
    expect(useShell.getState().sideModels).toEqual({ h: 150, min: 51 })
    useShell.getState().setSideSize('models', null)
    expect(useShell.getState().sideModels).toBeNull()
    expect(useShell.getState().sideStoreys).toEqual({ h: 90, min: 42 })
  })
})
